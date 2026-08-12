import { spotAt, exitBundle } from "@telemicroscope/core/analysis";
import { imagePlaneZ, pupilFan } from "@telemicroscope/core/pupil";
import { asCompiled } from "@telemicroscope/core/trace";
import { buildSystem, type LensKind } from "./render";

/**
 * The ray fan — where each ray in the pupil actually lands, against where it
 * came into the pupil. ROADMAP step 7's *"coma flare → ray fan"*, one half of
 * APP.md Part H.
 *
 * No DOM, no React, `render.ts`'s pattern for the twelfth time. **No engine
 * capability is added**: `exitBundle` is step 2's aiming, `pupilFan` is the
 * diameter of pupil points it has always offered, and `spotAt` is step 1's
 * intersection. So no validation-ladder rung is added either, and what this
 * file's own tests pin is the wiring plus the two claims the panel makes that no
 * rung states.
 *
 * ## Why this is the plot the coma tail links to
 *
 * A ray fan is the only picture in the app where an aberration is separated by
 * the thing that *causes* it — pupil position — instead of summed over the pupil
 * the way a spot, a PSF or an image is. That separation is what makes coma
 * legible rather than merely present:
 *
 * - **Defocus** is a straight line through the fan (error ∝ ρ).
 * - **Spherical** is a cubic, and it is ODD: the ray at +ρ and the ray at −ρ miss
 *   by the same amount in opposite directions, so they still straddle a centre.
 * - **Coma** is the EVEN part — a quadratic — and even means the two rays miss on
 *   the *same side*. That is the whole of the flare: half a pupil's worth of
 *   light piled to one side of the chief ray, which is a comet and not a disc.
 *
 * So the readout this file exists for is `evenPeakMm`, the largest even
 * component of the tangential fan. On axis an axially symmetric system cannot
 * have one, and the number falls to the arithmetic's own floor — ~1e-16 mm,
 * thirteen orders under the Airy radius. It is not bitwise zero, and the reason
 * is the sampler rather than the lens: see `MIRROR_TOLERANCE`. Off axis it
 * grows, and the star it belongs to grows a tail.
 *
 * ## Tangential and sagittal, and which is which here
 *
 * `imagePointOf`'s note states the engine's convention: *"the traced field runs
 * along +x"*. So the plane holding the chief ray and the axis is x–z, and the
 * **tangential** fan is the pupil diameter along x with its x error — the fan
 * coma lives in. The **sagittal** fan is the y diameter with its y error, and it
 * has no even part at any field, which is not a bug and is the point: the tail
 * points radially, not sideways.
 *
 * ## Errors are relative to the chief ray, not to the axis
 *
 * Every curve is measured from where the ρ = 0 ray of that same wavelength
 * lands. Off axis the image height is hundreds of microns and the aberration is
 * a few, so a fan drawn from the axis would be a flat line at the field height
 * with the entire subject of the plot invisible inside its line width. Measuring
 * from the chief ray is also what makes the three wavelengths' curves separate:
 * their vertical offsets are lateral colour, which is a different artifact, and
 * this plot is not about it.
 */

/** The F, d and C lines — the three wavelengths a ray fan is conventionally drawn at. */
export const FAN_LINES: readonly { readonly nm: number; readonly name: string; readonly color: string }[] =
  [
    { nm: 486.1327, name: "F (blue)", color: "#2b5fd9" },
    { nm: 587.5618, name: "d (yellow)", color: "#c08a00" },
    { nm: 656.2725, name: "C (red)", color: "#c0392b" },
  ];

export interface RayFanSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  /** Field angle of the star this fan is about, degrees. */
  readonly fieldDeg: number;
  /** Ray samples across the full pupil diameter. Odd, so one ray is the chief ray. */
  readonly rays: number;
}

/** One wavelength's pair of fans. */
export interface FanCurve {
  readonly nm: number;
  readonly name: string;
  readonly color: string;
  /** [pupil coordinate −1…1, transverse error from the chief ray in mm]. */
  readonly tangential: readonly (readonly [number, number])[];
  readonly sagittal: readonly (readonly [number, number])[];
  /**
   * Largest even component of the tangential fan (mm) — coma, as a number.
   * Even part at ρ is ½·(Δ(ρ) + Δ(−ρ)): what the two opposite rays have in
   * common instead of cancelling.
   */
  readonly evenPeakMm: number;
  /** Its sign at the pupil rim: which side of the chief ray the pile-up is on. */
  readonly evenRimSign: number;
  /** Largest odd component (mm) — spherical and defocus, for scale beside it. */
  readonly oddPeakMm: number;
  /** Rays the aimer or the trace lost, summed over both fans. This IS vignetting. */
  readonly lost: number;
}

export interface RayFanResult {
  readonly curves: readonly FanCurve[];
  readonly fieldDeg: number;
  readonly fNumber: number;
  /** Diffraction's own scale at the d line, for the plot to draw a floor at. */
  readonly airyRadiusMm: number;
  readonly elapsedMs: number;
}

/**
 * How far apart two pupil coordinates may be and still be one ρ and its mirror.
 *
 * **A keyed lookup on `-rho` does not work, and the reason is worth stating
 * because the failure is silent.** `pupilFan` builds each coordinate as
 * `(i/(n−1))·2 − 1`, so at 41 rays the pair either side of centre comes out as
 * +0.10000000000000009 and −0.09999999999999998 — not negatives of each other in
 * f64. An exact lookup drops every such pair from the split, which on this lens
 * still found the right answer (a fan's extreme is at the rim, and ±1 *are*
 * exact) and on a lens whose fan peaks inboard would quietly report the largest
 * even value among the pairs that happened to survive. 1e-9 is ~7 orders above
 * that arithmetic's error and ~7 below the coarsest spacing this panel offers.
 */
const MIRROR_TOLERANCE = 1e-9;

/**
 * Even/odd split of a fan, paired by pupil coordinate rather than by index.
 *
 * By ρ and not by position because a vignetted fan is not symmetric: one lost
 * ray shifts every index after it, and an index-paired split would then subtract
 * ρ = +0.7 from ρ = −0.9 and report the difference as coma. A ρ with no partner
 * contributes to neither part — an unpaired ray cannot say what is even about
 * it.
 */
function evenOddPeaks(points: readonly (readonly [number, number])[]): {
  even: number;
  oddPeak: number;
  rimSign: number;
} {
  let even = 0;
  let oddPeak = 0;
  let rimSign = 0;
  let rimRho = 0;
  for (const [rho, value] of points) {
    if (rho <= 0) continue;
    let mirror: number | undefined;
    let best = MIRROR_TOLERANCE;
    for (const [otherRho, otherValue] of points) {
      const gap = Math.abs(otherRho + rho);
      if (gap <= best) {
        best = gap;
        mirror = otherValue;
      }
    }
    if (mirror === undefined) continue;
    const e = (value + mirror) / 2;
    const o = (value - mirror) / 2;
    if (Math.abs(e) > Math.abs(even)) even = e;
    if (Math.abs(o) > oddPeak) oddPeak = Math.abs(o);
    // The outermost surviving pair, which is where a fan says the most.
    if (rho > rimRho) {
      rimRho = rho;
      rimSign = Math.sign(e);
    }
  }
  return { even: Math.abs(even), oddPeak, rimSign };
}

/**
 * Trace one wavelength's fan along one pupil axis, as an error from the chief
 * ray of that same fan.
 *
 * A lost ray is dropped from the curve rather than drawn at zero: `exitBundle`
 * counts it, the count is carried out to the panel, and a fan with a hole in it
 * is what vignetting looks like. Zero-filling would draw a ray that does not
 * exist landing exactly on the chief ray, which is the most flattering possible
 * lie about a lens.
 */
function fanAlong(
  system: ReturnType<typeof buildSystem>,
  spec: RayFanSpec,
  nm: number,
  axis: "x" | "y",
): { points: (readonly [number, number])[]; lost: number } {
  const bundle = exitBundle(system, spec.fieldDeg, nm, pupilFan(spec.rays, axis));
  const spot = spotAt(bundle, imagePlaneZ(asCompiled(system.prescription), system));
  const read = (p: (typeof spot.points)[number]) => (axis === "x" ? p.x : p.y);
  const rho = (p: (typeof spot.points)[number]) => (axis === "x" ? p.px : p.py);

  // The chief ray is the ρ = 0 sample of this same bundle, so an odd `rays`
  // guarantees it exists; if the aimer lost it, there is no reference and the
  // fan is refused rather than referred to the nearest surviving ray.
  const chief = spot.points.find((p) => rho(p) === 0);
  if (chief === undefined) {
    throw new Error(`the chief ray was lost at field ${spec.fieldDeg}°: no reference for the fan`);
  }
  const origin = read(chief);
  return {
    points: spot.points.map((p) => [rho(p), read(p) - origin] as const),
    lost: bundle.lost,
  };
}

export function rayFan(spec: RayFanSpec): RayFanResult {
  const started = performance.now();
  if (spec.rays % 2 === 0) {
    throw new Error("a ray fan needs an odd sample count so one ray is the chief ray");
  }
  // The SAME system the image was made from — `buildSystem` is what `renderStar`
  // calls, handed the fields the teaching link carried. That is the whole reason
  // the plot is allowed to claim it explains that picture. The field renderer
  // builds its own system for a spectral reason (see `renderFieldScene`), but its
  // geometry is this one: `bestFocus` is given an explicit wavelength, so the
  // weights the two differ in cannot move the image plane.
  const system = buildSystem({
    lens: spec.lens,
    focalLengthMm: spec.focalLengthMm,
    apertureMm: spec.apertureMm,
    sourceTemperatureK: spec.sourceTemperatureK,
    wavelengths: spec.wavelengths,
    pupilSamples: 64,
    whiteFraction: 1,
    seeingDOverR0: 0,
  });

  const curves = FAN_LINES.map((line) => {
    const t = fanAlong(system, spec, line.nm, "x");
    const s = fanAlong(system, spec, line.nm, "y");
    const split = evenOddPeaks(t.points);
    return {
      nm: line.nm,
      name: line.name,
      color: line.color,
      tangential: t.points,
      sagittal: s.points,
      evenPeakMm: split.even,
      evenRimSign: split.rimSign,
      oddPeakMm: split.oddPeak,
      lost: t.lost + s.lost,
    };
  });

  const naImage = spec.apertureMm / (2 * spec.focalLengthMm);
  return {
    curves,
    fieldDeg: spec.fieldDeg,
    fNumber: spec.focalLengthMm / spec.apertureMm,
    // Same form `render.ts` prints beside the star, at the same d line the fan's
    // middle curve is drawn at, so the two surfaces quote one number.
    airyRadiusMm: (1.22 * 587.5618 * 1e-6) / (2 * naImage),
    elapsedMs: performance.now() - started,
  };
}
