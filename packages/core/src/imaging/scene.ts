import { asCompiled } from "../trace/compile";
import { OpticalSystem, WavelengthSample } from "../trace/system";
import { traceRay } from "../trace/sequential";
import { AimOptions, chiefRay } from "../pupil/aiming";
import { imagePlaneZ, pupils } from "../pupil/pupils";
import { Vec3, add, scale } from "../math/vec3";

/**
 * What is being looked at, and where the optics puts it.
 *
 * ## Scenes live in field angle; images live in millimetres
 *
 * A scene is authored the way an observer thinks about it — this star is 0.3°
 * off axis — while every image the wave layer produces is in image-plane
 * millimetres. The bridge is the **chief ray**: trace it from the field point
 * through the stop and read where it crosses the image plane.
 *
 * That is not a convenience. Using EFL·tan θ instead would be the *definition*
 * of a distortion-free system, so distortion could never appear in a rendered
 * image no matter how much of it the prescription had. Going through the chief
 * ray means distortion arrives on its own, from the same trace as everything
 * else, without a term anywhere that names it.
 *
 * ## Spectral, not RGB
 *
 * A scene carries radiance per wavelength on the same sample grid the system
 * traces. Authoring in RGB and upsampling to a spectrum would put a colour
 * model *in front of* the physics, and the whole point of the chromatic work is
 * that colour is what comes out, not what goes in.
 *
 * ## The SED belongs to the source, and therefore NOT to the wavelength weights
 *
 * Every source in a scene has its own spectrum — that is what makes a red star
 * red next to a blue one — so the spectrum cannot live in
 * `system.wavelengths[i].weight`, which is shared by the whole frame. For a
 * scene render those weights must be **pure quadrature** (`quadratureSamples`),
 * with each source carrying its own `spectrum`.
 *
 * Handing a scene render the SED-weighted samples that the single-source PSF
 * path uses (`spectralSamples`) applies the spectrum twice and produces a
 * perfectly plausible image of the wrong colour. There is a rung for it.
 */

export interface PointSource {
  /** Field angle off axis, degrees, along the two image-plane axes. */
  readonly fieldXDeg: number;
  readonly fieldYDeg: number;
  /** Relative flux. Dimensionless until photometric zero points land. */
  readonly flux: number;
  /** Relative spectral power distribution. */
  readonly spectrum: (nm: number) => number;
}

/**
 * A scene as radiance on the image plane, one plane per wavelength.
 *
 * Already mapped through the optics' geometry, so a renderer only has to
 * convolve — the grid it is on is the grid the PSF is on.
 */
export interface ImagePlaneScene {
  readonly size: number;
  readonly pixelScaleMm: number;
  /** Radiance per wavelength, each `size`×`size`, row-major. */
  readonly planes: readonly Float64Array[];
  readonly samples: readonly WavelengthSample[];
  /** Field angle (degrees) at the centre of each patch-sized region. */
  readonly halfExtentMm: number;
}

/**
 * Where the chief ray from a field angle lands on the image plane.
 *
 * The engine's field spec is a single scalar because the systems are axially
 * symmetric; a 2-D field point is therefore traced at its radial angle and
 * rotated to its own azimuth. For an axially symmetric system that is exact,
 * and it is what lets one traced field value serve a whole ring of the frame.
 */
export function imagePointOf(
  system: OpticalSystem,
  fieldRadiusDeg: number,
  azimuthRad: number,
  wavelengthNm: number,
  options: AimOptions = {},
): { x: number; y: number } {
  if (fieldRadiusDeg === 0) return { x: 0, y: 0 };
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const chief = chiefRay(system, pupil, fieldRadiusDeg, wavelengthNm, options);
  const traced = traceRay(system.prescription, chief);
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(`chief ray failed (${traced.status}) at field ${fieldRadiusDeg}`);
  }
  const r = traced.ray;
  const planeZ = imagePlaneZ(c, system);
  const hit: Vec3 = add(r.origin, scale(r.dir, (planeZ - r.origin.z) / r.dir.z));
  // The traced field runs along +x by convention (`fieldDirection` tilts the
  // bundle in the x–z plane), so the radial distance is what carries over; the
  // azimuth rotates it into place.
  const radius = Math.hypot(hit.x, hit.y);
  return { x: radius * Math.cos(azimuthRad), y: radius * Math.sin(azimuthRad) };
}

/**
 * Rasterize point sources onto an image-plane radiance grid.
 *
 * Bilinear splatting, so a star between pixels lands between pixels rather than
 * snapping to one — a star field rendered with nearest-pixel placement shows a
 * spurious jitter in brightness as sources move, and the jitter looks exactly
 * like scintillation, which this engine will later model for real.
 */
export function rasterizePointSources(
  system: OpticalSystem,
  sources: readonly PointSource[],
  samples: readonly WavelengthSample[],
  options: { size: number; pixelScaleMm: number; aim?: AimOptions },
): ImagePlaneScene {
  const { size, pixelScaleMm } = options;
  const planes = samples.map(() => new Float64Array(size * size));
  const centre = size / 2;

  for (const source of sources) {
    const radius = Math.hypot(source.fieldXDeg, source.fieldYDeg);
    const azimuth = Math.atan2(source.fieldYDeg, source.fieldXDeg);
    for (let w = 0; w < samples.length; w++) {
      const nm = samples[w]!.nm;
      const point = imagePointOf(system, radius, azimuth, nm, options.aim ?? {});
      const px = centre + point.x / pixelScaleMm;
      const py = centre + point.y / pixelScaleMm;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= size || y0 + 1 >= size) continue;
      const fx = px - x0;
      const fy = py - y0;
      const value = source.flux * source.spectrum(nm);
      const plane = planes[w]!;
      plane[y0 * size + x0] = plane[y0 * size + x0]! + value * (1 - fx) * (1 - fy);
      plane[y0 * size + x0 + 1] = plane[y0 * size + x0 + 1]! + value * fx * (1 - fy);
      plane[(y0 + 1) * size + x0] = plane[(y0 + 1) * size + x0]! + value * (1 - fx) * fy;
      plane[(y0 + 1) * size + x0 + 1] = plane[(y0 + 1) * size + x0 + 1]! + value * fx * fy;
    }
  }

  return {
    size,
    pixelScaleMm,
    planes,
    samples,
    halfExtentMm: (size / 2) * pixelScaleMm,
  };
}
