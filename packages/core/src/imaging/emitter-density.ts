import type { AimOptions } from "../pupil/aiming";
import type { EmitterField } from "./fluorescence";
import { imagePointAt, type ObjectFieldFrame } from "./object-field";
import { requireRadialMapMatches, type RadialMap } from "./radial-map";

/**
 * The extended fluorescent specimen — `imaging/specimen`'s named deferral,
 * closed.
 *
 * § 6i's `rasterizeEmitters` images beads, and the reason it could is that a
 * **point** emitter is placed through its own traced chief ray: there is no
 * density to transform, so no Jacobian is needed and none is applied. § 6n then
 * built the warped-grid rasterizer for the other kind of specimen and was
 * careful to say why it carries no Jacobian either — an amplitude transmittance
 * is a property *of a point*, so warping it is pure coordinate substitution.
 * Between the two, the case that needs a Jacobian was named and left open: an
 * **extended** fluorescent specimen is an emitter density, and warping one
 * without det J moves flux between pixels.
 *
 * This module is that case. It adds no optics — every ray it needs was traced
 * by § 6s; what is new is that the map is **differentiated** rather than only
 * evaluated.
 *
 * ## The Jacobian is one-dimensional, and that is the axial symmetry
 *
 * § 5v reached this first, on the sky. A pixel at image radius r looks at object
 * height h(r) and covers `r·dr·dφ` of image plane against `h·dh·dφ` of specimen,
 * so
 *
 *     dA_object / dA_image = (h/r) · (dh/dr)
 *
 * — a **tangential** factor times a **radial** one, each a function of r alone.
 * No off-diagonal term exists to compute, because the systems are axially
 * symmetric. That is § 6m.4's anisotropy written as a product: the two scales
 * really do differ, and the determinant is still one scalar.
 *
 * On the axis both factors are the same limit, `h/r → dh/dr`, so the area factor
 * is `(dh/dr)²` exactly — **1/M² on a system that images at M**, which is a
 * number from outside the engine and is pinned as one (§ 6as.1). Under
 * third-order distortion `r = M·h·(1 + E·h²)` the tangential factor departs from
 * that axis value by −E·h² and the radial factor by −3E·h², so their departures
 * stand in the **ratio 3** — § 6m.4's number, in this currency, with nothing
 * fitted anywhere (§ 6as.2).
 *
 * ## The table is required, and that is the physics of a derivative
 *
 * `rasterizeSpecimen` takes a `RadialMap` as an *option*, because § 6n's rungs
 * pin the exact map and an interpolant underneath them would mean they pinned
 * the interpolant. Here the table is **required**, for the reason § 5v's header
 * gives: a Jacobian is a derivative, and a derivative differenced from a
 * per-pixel bisection carries √ε/h noise that would swamp the pins it exists to
 * be checked against. § 6as.3 measures that rather than asserting it — the
 * *best* step differencing `objectHeightForImageRadius` reaches 8.0e-12 against
 * the cubic's 1.3e-12, and which step is best is not knowable at a call site.
 *
 * So the required table is not a convenience. It costs `nodes + 1` bisections
 * for a whole frame where differencing would cost **two extra per pixel**, and
 * it is more accurate; the extended emitter is the one rasterizer here that is
 * cheaper than the exact path rather than dearer.
 *
 * **There is no `system` parameter,** and that is the same fact seen from the
 * call site: with the map required, nothing in this module traces. Taking a
 * system it never uses would advertise a trace that does not happen.
 *
 * ## Energy is a real witness here
 *
 * Because a density is being transformed, total flux is a genuine check — worth
 * saying given how often § 6g.2, § 6k.4 and § 6r.2 record that it is not. It is
 * a **converging** witness rather than an exact one, for § 5v.6's reason: the
 * density is point-sampled at each pixel's own object point — § 6n's convention,
 * so the warp stays in the *argument* and nothing is resampled — and a point
 * sample of a density integrates its cell only in the limit. § 6as.4 measures
 * the rate instead of asserting the conservation, and `discEmitter` keeps a hard
 * edge so that rate stays visible.
 */

/**
 * Emitted power per unit area of the **specimen**, in object millimetres.
 *
 * A density, where `Specimen` is a transmittance and `SkyRadiance` is a radiance
 * per solid angle — and the whole of this module is that distinction. Authored
 * in `Specimen`'s own unsigned-magnification coordinates, so one factory can
 * place a stain and an emitter at the same point of the same specimen.
 *
 * A callback rather than an array, for § 6n's reason: the warp then happens in
 * the **argument**, and no resampling kernel comes between the authored object
 * and the image. Dimensionless in the sense `PointEmitter.flux` is —
 * photometric zero points are § 3a's deferral, so what is physical is every
 * ratio and not the absolute value.
 */
export type EmitterDensity = (xMm: number, yMm: number) => number;

export interface RasterizeEmitterDensityOptions {
  /**
   * Required — see the header. The Jacobian is a derivative, and this is where
   * it comes from. Refused if its wavelength or its launch plane is not the
   * frame's, on § 6s's identity argument.
   */
  readonly radialMap: RadialMap;
  readonly aim?: AimOptions;
  /** Called once per row, for progress. */
  readonly onRow?: (done: number, total: number) => void;
}

/**
 * Rasterize an extended emitter density onto the frame's emitter grid.
 *
 * Produces the `EmitterField` `incoherentImage` and `renderFluorescence` already
 * consume, unchanged — this is the **authoring** path, and nothing downstream
 * learns that the specimen had an extent. That is the architectural point the
 * branch keeps making: the incoherent render, the emission kernel and the mosaic
 * were built before this and none of them moves for a stained section.
 *
 * The pixel convention is `rasterizeEmitters`' and `specimenPointAt`'s: index
 * `i` sits at offset `i − size/2` from the frame's centre, so the centre falls
 * **on** pixel `size/2`. § 6n.1 pinned the first two rasterizers against each
 * other for exactly this; § 6as.6 pins this third one to them.
 */
export function rasterizeEmitterDensity(
  frame: ObjectFieldFrame,
  density: EmitterDensity,
  options: RasterizeEmitterDensityOptions,
): EmitterField {
  const { size } = frame;
  const { radialMap } = options;
  requireRadialMapMatches(radialMap, frame, options.aim, "rasterizeEmitterDensity");

  const values = new Float64Array(size * size);
  const pixelAreaMm2 = frame.pixelScaleMm * frame.pixelScaleMm;

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const { x, y } = imagePointAt(frame, ix / size, iy / size);
      const imageRadius = Math.hypot(x, y);
      const azimuthRad = imageRadius > 0 ? Math.atan2(y, x) : 0;
      const heightMm = radialMap.heightAt(imageRadius);
      const rho = density(heightMm * Math.cos(azimuthRad), heightMm * Math.sin(azimuthRad));
      if (rho === 0) continue;
      // density × the object area this pixel covers. The Jacobian is what makes
      // this a flux; without it the grid would be a density wearing a flux's
      // units, wrong by exactly the distortion (§ 6as.5's negative control).
      values[iy * size + ix] = rho * radialMap.objectAreaPerImageArea(imageRadius) * pixelAreaMm2;
    }
    options.onRow?.(iy + 1, size);
  }

  return { size, values };
}

/**
 * A disc of uniform emitter density — the simplest extended emitter there is.
 *
 * Its total flux is `density · π · radiusMm²` in closed form, independently of
 * every optic the light later passes, and that is what § 6as.4 weighs the
 * rasterizer against.
 *
 * **The edge is hard, and that is deliberate.** A rasterizer that point-samples
 * a discontinuity is exactly where a density's flux stops being conserved
 * exactly, and § 6as.4 measures that convergence rather than hiding it behind a
 * soft edge — § 5v's `uniformDisc` made the same choice for the same reason.
 */
export function discEmitter(options: {
  readonly radiusMm: number;
  readonly density: number;
  readonly centreMm?: { readonly x: number; readonly y: number };
}): EmitterDensity {
  const { radiusMm, density } = options;
  if (!(radiusMm > 0)) throw new Error(`discEmitter: radiusMm must be positive, got ${radiusMm}`);
  if (!(density >= 0)) {
    throw new Error(`discEmitter: density must be non-negative, got ${density}`);
  }
  const centre = options.centreMm ?? { x: 0, y: 0 };
  const r2 = radiusMm * radiusMm;
  return (xMm, yMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    return dx * dx + dy * dy <= r2 ? density : 0;
  };
}

/**
 * A Gaussian emitter density, `peak · exp(−2r²/w²)` — the smooth counterpart.
 *
 * The `1/e²` convention a beam waist is quoted in, so `w` is the radius at which
 * the density has fallen to `e⁻²` of its peak. Its integral is `peak · π · w²/2`,
 * again in closed form — and because it has no edge, § 6as.4 can separate the
 * convergence a *discontinuity* costs from the convergence point-sampling costs
 * on its own.
 */
export function gaussianEmitter(options: {
  readonly waistMm: number;
  readonly peak: number;
  readonly centreMm?: { readonly x: number; readonly y: number };
}): EmitterDensity {
  const { waistMm, peak } = options;
  if (!(waistMm > 0)) throw new Error(`gaussianEmitter: waistMm must be positive, got ${waistMm}`);
  const centre = options.centreMm ?? { x: 0, y: 0 };
  const w2 = waistMm * waistMm;
  return (xMm, yMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    return peak * Math.exp((-2 * (dx * dx + dy * dy)) / w2);
  };
}
