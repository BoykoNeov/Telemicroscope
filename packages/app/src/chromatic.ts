import { paraxialImageOffset, spotDiagram } from "@telemicroscope/core/analysis";
import { pupilGrid } from "@telemicroscope/core/pupil";
import { buildSystem, FOCUS_NM, type LensKind, type RenderRequest } from "./render";

/**
 * Chromatic focal shift — where each colour focuses, and what that costs at the
 * one plane the picture was taken on. ROADMAP step 7's *"purple fringe →
 * chromatic focal shift"*, the other half of APP.md Part H.
 *
 * No DOM, no React. **No engine capability is added**: `paraxialImageOffset` is
 * step 2's first-order axis crossing and `spotDiagram` is step 1's trace on the
 * system's own image plane, so there is no new rung, and what the tests pin is
 * the wiring plus the claims the panel makes.
 *
 * ## Two curves, because the artifact needs both halves to be explained
 *
 * The halo in the star image is not "the blue focuses somewhere else". It is
 * "the blue focuses somewhere else **and the sensor is not there**". So this
 * draws:
 *
 * 1. **Where each wavelength focuses** — `paraxialImageOffset`, an exact
 *    first-order crossing, as a shift from the plane the image was actually
 *    rendered on. That plane is `buildSystem`'s `bestFocus` at 550 nm, the same
 *    call `renderStar` makes, so the curve crosses zero exactly where the
 *    picture is sharp. This is the *cause*.
 * 2. **How big the blur is there** — a real traced spot at that fixed plane, per
 *    wavelength. This is the *effect*, and it is the halo: it is what the
 *    picture's violet skirt is made of, measured in the same millimetres.
 *
 * The second is a trace and not the first one's arithmetic on purpose. The
 * defocus-blur formula δ·NA would have drawn a clean V and asserted the law
 * instead of producing it, and it would also have been wrong in a way nobody
 * would see: at the middle of the band the defocus is nearly nil and what is
 * left is the singlet's spherical aberration, which the formula does not know
 * about and the trace has all along.
 *
 * ## Why the shift is signed and quoted against the render's own plane
 *
 * `paraxialImageOffset` returns an offset from the last vertex, and so does the
 * focus solve; subtracting them gives a curve through zero whose sign says which
 * side. An unshifted absolute would put both lenses' curves near 96 mm with the
 * whole subject — a few tens of microns of separation between them — inside the
 * line width.
 *
 * ## Both lenses always, even when the link named one
 *
 * The star panel is a *comparison*, so its explanation is one too: an achromat's
 * curve is only remarkable next to the singlet's. The link's lens is marked as
 * the one that sent you rather than being the only one drawn.
 */

/** The visible band the curve is drawn across, nm. */
export const BAND_NM = { min: 420, max: 680 } as const;

/**
 * The two wavelengths an achromat is corrected at — F and C, by design.
 * Drawn as markers so the crossing the curve shows can be named rather than
 * merely noticed.
 */
export const CROSSING_LINES = { F: 486.1327, C: 656.2725 } as const;

export interface ChromaticSpec {
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  /** Curve samples across the band. */
  readonly samples: number;
  /** Pupil grid across the diameter for the traced spot. */
  readonly pupilSamples: number;
}

export interface ChromaticPoint {
  readonly nm: number;
  /** Where this colour focuses, relative to the plane the image was rendered on (mm). */
  readonly focusShiftMm: number;
  /** RMS spot radius at that rendered plane (mm) — the blur, traced. */
  readonly rmsSpotMm: number;
  /** Largest ray's distance from the centroid there (mm) — the skirt's edge. */
  readonly geoSpotMm: number;
}

export interface ChromaticCurve {
  readonly lens: LensKind;
  readonly points: readonly ChromaticPoint[];
  /**
   * The same three numbers at the wavelength the system was focused at, taken
   * as its own evaluation rather than read off the nearest sample — so the
   * panel's headline does not change when the curve's resolution does.
   *
   * Its `focusShiftMm` is the panel's most surprising readout and is not zero:
   * the plane the image sits on is the minimum-RMS-wavefront plane at this
   * wavelength, and the *paraxial* plane at the same wavelength is elsewhere.
   * The gap between them is the spherical aberration the focus solve is
   * balancing.
   */
  readonly atFocusWavelength: ChromaticPoint;
  /** Focus spread across the band (mm) — the secondary spectrum, as one number. */
  readonly focusSpreadMm: number;
  /** Worst RMS spot across the band, in Airy radii — the fringe, as one number. */
  readonly worstSpotAiryRadii: number;
  /** Rays lost anywhere in the sweep. Zero on axis unless something is clipping. */
  readonly lost: number;
}

export interface ChromaticResult {
  readonly curves: readonly ChromaticCurve[];
  readonly fNumber: number;
  /** Diffraction's own scale at the d line — the floor a curve is good against. */
  readonly airyRadiusMm: number;
  readonly elapsedMs: number;
}

const D_LINE_NM = 587.5618;

function requestFor(spec: ChromaticSpec, lens: LensKind): RenderRequest {
  return {
    lens,
    focalLengthMm: spec.focalLengthMm,
    apertureMm: spec.apertureMm,
    sourceTemperatureK: spec.sourceTemperatureK,
    wavelengths: spec.wavelengths,
    // Display-only fields of `RenderRequest`, and none of them reaches the
    // system: `buildSystem` reads the five above and nothing else.
    pupilSamples: 64,
    whiteFraction: 1,
    seeingDOverR0: 0,
  };
}

function curveFor(spec: ChromaticSpec, lens: LensKind, airyRadiusMm: number): ChromaticCurve {
  const system = buildSystem(requestFor(spec, lens));
  // The plane the image was rendered on, in the units `paraxialImageOffset`
  // answers in. Read off the system rather than recomputed, so the zero of the
  // curve IS the picture's focus by construction and not by agreement.
  const renderedPlane = system.imageSurface?.offsetFromLastVertex;
  if (renderedPlane === undefined) {
    // `buildSystem` focuses through `withFocus`, so this is unreachable; it is a
    // throw rather than a `?? 0` because a silent zero would quietly quote the
    // curve against the last vertex — about 96 mm from the answer — while every
    // number on screen still looked like millimetres of defocus.
    throw new Error("the rendered system has no image plane: nothing to quote a shift against");
  }
  const grid = pupilGrid(spec.pupilSamples);

  const at = (nm: number): { point: ChromaticPoint; lost: number } => {
    const spot = spotDiagram(system, 0, nm, grid);
    return {
      point: {
        nm,
        focusShiftMm: paraxialImageOffset(system, nm) - renderedPlane,
        rmsSpotMm: spot.rmsRadius,
        geoSpotMm: spot.geoRadius,
      },
      lost: spot.lost,
    };
  };

  const points: ChromaticPoint[] = [];
  let lost = 0;
  for (let i = 0; i < spec.samples; i++) {
    const nm =
      BAND_NM.min + ((BAND_NM.max - BAND_NM.min) * i) / Math.max(1, spec.samples - 1);
    const sample = at(nm);
    lost += sample.lost;
    points.push(sample.point);
  }

  const shifts = points.map((p) => p.focusShiftMm);
  const worstRms = Math.max(...points.map((p) => p.rmsSpotMm));
  return {
    lens,
    points,
    atFocusWavelength: at(FOCUS_NM).point,
    focusSpreadMm: Math.max(...shifts) - Math.min(...shifts),
    worstSpotAiryRadii: worstRms / airyRadiusMm,
    lost,
  };
}

export function chromaticShift(spec: ChromaticSpec): ChromaticResult {
  const started = performance.now();
  const naImage = spec.apertureMm / (2 * spec.focalLengthMm);
  const airyRadiusMm = (1.22 * D_LINE_NM * 1e-6) / (2 * naImage);
  const curves: ChromaticCurve[] = [
    curveFor(spec, "singlet", airyRadiusMm),
    curveFor(spec, "achromat", airyRadiusMm),
  ];
  return {
    curves,
    fNumber: spec.focalLengthMm / spec.apertureMm,
    airyRadiusMm,
    elapsedMs: performance.now() - started,
  };
}
