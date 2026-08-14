import {
  distortionProfile,
  fieldSurfaces,
  thirdOrderDistortionMm,
  thirdOrderSags,
} from "@telemicroscope/core/analysis";
import { buildSystem, type LensKind } from "./render";

/**
 * The two focal surfaces, and distortion — ROADMAP's v1 analyses line, and the
 * entry that line twice said was already closed.
 *
 * `analysis/field` landed as VALIDATION § 6ac with 22 rungs and had **no caller
 * anywhere in `packages/app`** until this file. ROADMAP's v1 list says "all six
 * v1 analyses have a surface" and only five did: the sentence was written when
 * the MTF panel landed and counted the entry that had landed one step *earlier*
 * as though its panel had come with it. Nothing was lost — the capability is
 * pinned — but the accounting was wrong, and this file is the half that makes it
 * true.
 *
 * ## What the surface is for
 *
 * Every other analysis in this app asks a question about ONE point in the field.
 * This one asks the question a *detector* asks: the image is not formed on a
 * plane, so where do you put the flat thing. An off-axis pencil has no single
 * focus — the fan in the plane containing the axis and the field point comes to
 * a line focus at one z, the fan at right angles to it at another — and the two
 * swept over field are two curved surfaces that a sensor has to sit between.
 *
 * ## The headline, which is about the lens the app ships rather than the physics
 *
 * **The achromat did not flatten the field.** It is this app's whole
 * demonstration — the lens that fixes the singlet's colour and its spherical
 * aberration — and against field curvature it does nothing at all: at 1.6° the
 * singlet's tangential surface is 1.4233 mm inside focus and the achromat's is
 * 1.4464, i.e. the corrected lens is **1.6% worse**. On the Petzval surface,
 * which is the part no amount of astigmatism balancing can move, it is 8.1%
 * worse (0.2575 against 0.2783), because that surface is Σφ/n over the elements
 * and adding glass to correct colour adds power to sum.
 *
 * What the achromat *does* fix here is the **chromatic variation** of it: the
 * singlet's Petzval sag moves 2.1% across the F-to-C band and the achromat's
 * 0.26%, eight times less. So the correction did reach this aberration — it made
 * the curved field the same curved field at every colour.
 *
 * The practical form of the headline is the same number in units a reader can
 * act on: at f/10 and 587.6 nm the quarter-wave depth of focus is ±0.1175 mm and
 * the corner of a ±1.6° frame is **12 of them** outside it, for both lenses
 * alike. Stopping to f/25 fixes it — not by flattening anything, but because the
 * depth of focus grows as the square of the focal ratio while these surfaces, as
 * below, do not move with aperture at all.
 *
 * ## Three quantities here have no aperture in them, which is unusual in this app
 *
 * The third-order surfaces are aperture-free identically — x_s, x_t and x_p are
 * ratios of Seidel sums to n′u′², and the aperture cancels — and traced
 * distortion is a chief-ray property, measured here as unchanged to five digits
 * between EPD 40 and 100. The TRACED surfaces are the interesting ones: they are
 * where a real fan's spot is smallest, and that does have an aperture in it.
 *
 * **How much is the panel's measurement of what else is in the lens.** Over EPD
 * 20 → 120 the singlet's traced tangential sag moves 0.63% and the achromat's
 * 0.04%, sixteen times less; the sagittal sags move 0.05% and 0.01%. This file
 * does not name which aberration that is, because the probe behind it did not
 * measure one — it measured an aperture dependence. What it does say is the part
 * that matters for reading the plot: the singlet's departure from the closed form
 * **changes sign** near EPD 35, so the two curves lying on top of each other at
 * one aperture is not a check on anything.
 *
 * ## The guard that fires on the app's own default, and what was actually checked
 *
 * `AstigmaticFocus.lost` is documented as invalidating the sags, and on the
 * shipped f/10 achromat it is **24** — Part B's aperture wall, the crown closing
 * on itself at 73% of its semi-diameter, which the MTF panel measures from the
 * other side. The sags are nonetheless right: this file re-traces the edge field
 * at a stopped-down aperture that loses nothing and reports how far the two
 * answers are apart (3e-4 relative).
 *
 * That is a control, not an explanation. It says the truncation did not move
 * this number; it does not say why, and the plausible reason — that a rim lost
 * evenly all the way round leaves the best-focus z alone — is a mechanism nothing
 * here measured. The panel prints the control and stops there.
 *
 * ## Two ways to get a plausible wrong answer, and neither is reachable
 *
 * Both hazards § 6ac measured are enforced by the module rather than documented,
 * so this adapter cannot commit them however it is called: the sags' on-axis
 * reference is traced inside `fieldSurfaces` with the same fan (a mismatched one
 * was 59× the signal), and `distortionProfile` picks the paraxial image plane
 * itself (the best-spot plane was 13×). The second is worth a number here because
 * this app's lenses are further from the hazard's own fixture than § 6ac's were:
 * the gap between the two planes is 0.0915 mm on the achromat and 2.545 mm on the
 * singlet, which as a pure scale error would be **218×** and **942×** the real
 * distortion at the edge of the field. A panel that had been allowed to choose
 * its own plane would have drawn a distortion curve that was three orders of
 * magnitude defocus.
 */

/** The lines a lens is conventionally quoted at, matching `mtf.ts`. */
export const CURVATURE_LINES: readonly { readonly nm: number; readonly name: string }[] = [
  { nm: 486.1327, name: "F (blue)" },
  { nm: 587.5618, name: "d (yellow)" },
  { nm: 656.2725, name: "C (red)" },
];

export interface CurvatureSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  readonly wavelengthNm: number;
  /** Half-field the plots run out to, in degrees. */
  readonly maxFieldDeg: number;
  /** Points along each curve, including the axis. */
  readonly fieldSteps: number;
  /** Rays per fan. One number serves both sections AND the axial reference. */
  readonly fanSamples: number;
}

/** One field point, traced and predicted, on both plots. */
export interface CurvatureSample {
  readonly fieldDeg: number;
  /** Traced, from `bestSpotZ` on each fan, measured from the on-axis focus. */
  readonly tangentialSagMm: number;
  readonly sagittalSagMm: number;
  /** (t + s)/2 — where the blur is roundest, and the surface a flat sensor chases. */
  readonly medialSagMm: number;
  /** The published third-order surfaces at the same field. */
  readonly thirdOrderTangentialMm: number;
  readonly thirdOrderSagittalMm: number;
  readonly petzvalMm: number;
  /** Traced chief-ray height error at the paraxial plane, in parts per million. */
  readonly distortionPpm: number;
  /** S_V/(2n′u′) at the same field, as the same fraction. */
  readonly thirdOrderDistortionPpm: number;
  /** Rays this field lost across both fans. */
  readonly lost: number;
}

export interface CurvatureResult {
  readonly samples: readonly CurvatureSample[];
  /** The outermost sample — every edge readout below is this one. */
  readonly edge: CurvatureSample;
  /** The on-axis best-spot focus the sags are measured from (mm). */
  readonly axialZ: number;
  /** The paraxial image plane the distortion is measured on (mm). */
  readonly paraxialZ: number;

  /** t − s at the edge: the astigmatic interval, and the blur a flat sensor cannot avoid. */
  readonly astigmaticIntervalMm: number;
  /**
   * (x_t − x_p)/(x_s − x_p) at the edge, with the traced surfaces and the
   * closed-form Petzval. Identically 3 in third order.
   */
  readonly petzvalRatio: number;
  /** traced/closed-form − 1 at the edge, per surface. */
  readonly tangentialDeparture: number;
  readonly sagittalDeparture: number;
  readonly distortionDeparture: number;

  /** ±λ/(2·NA²) = ±2λ(f/#)² — the QUARTER-WAVE (Rayleigh) depth of focus, mm. */
  readonly depthOfFocusMm: number;
  /** |edge tangential sag| in those depths — how far out the corner is. */
  readonly cornerDepths: number;
  /**
   * Midpoint of the medial surface's range over the sampled field, as a sag.
   * A midpoint, NOT a solve: no criterion was optimized to get it.
   */
  readonly flatPlaneMm: number;
  /** Worst |medial − flatPlane| over the field, in depths of focus. */
  readonly flatPlaneWorstDepths: number;

  /** Largest `lost` over the sampled fields — the guard, on the app's own lens. */
  readonly maxLost: number;
  /** The stopped-down aperture the edge sag was re-traced at (mm). */
  readonly controlApertureMm: number;
  readonly controlLost: number;
  /** Edge tangential sag at that aperture, relative to the one on the plot. */
  readonly controlDeparture: number;

  /**
   * |Δz/f| ÷ |edge distortion|, where Δz is the gap between the paraxial plane
   * and the on-axis best-spot plane. What reading distortion at the wrong plane
   * would have cost, as a multiple of the signal. Refused by the module.
   */
  readonly defocusLeverRatio: number;
  readonly elapsedMs: number;
}

/**
 * Apertures tried, as fractions of the panel's own, when looking for a control
 * that loses no rays. Stops at the first clean one; four is enough to clear the
 * shipped doublet's wall from anywhere in the panel's range.
 */
const CONTROL_FRACTIONS = [0.5, 0.35, 0.25, 0.15] as const;

export function fieldCurvature(spec: CurvatureSpec): CurvatureResult {
  const started = performance.now();

  // The SAME system the star image is made from — `rayfan.ts`'s reason: a plot
  // that explained a different lens would look exactly as convincing.
  const build = (apertureMm: number) =>
    buildSystem({
      lens: spec.lens,
      focalLengthMm: spec.focalLengthMm,
      apertureMm,
      sourceTemperatureK: spec.sourceTemperatureK,
      wavelengths: spec.wavelengths,
      pupilSamples: 64,
      whiteFraction: 1,
      seeingDOverR0: 0,
    });
  const system = build(spec.apertureMm);

  const fields: number[] = [];
  for (let i = 0; i < spec.fieldSteps; i++) {
    fields.push((spec.maxFieldDeg * i) / (spec.fieldSteps - 1));
  }

  const surfaces = fieldSurfaces(system, fields, spec.wavelengthNm, {
    fanSamples: spec.fanSamples,
  });
  const distortion = distortionProfile(system, fields, spec.wavelengthNm);

  const samples = fields.map((fieldDeg, i): CurvatureSample => {
    const focus = surfaces.foci[i]!;
    const sags = thirdOrderSags(system, fieldDeg, spec.wavelengthNm);
    const d = distortion.samples[i]!;
    // On axis both distortions are 0/0: the height they are a fraction OF is
    // zero. Reported as zero rather than as NaN, which is what a plot needs and
    // is also the right answer — a chief ray on the axis lands on the axis.
    const heightMm = d.paraxialHeightMm;
    return {
      fieldDeg,
      tangentialSagMm: focus.tangentialSagMm,
      sagittalSagMm: focus.sagittalSagMm,
      medialSagMm: (focus.tangentialSagMm + focus.sagittalSagMm) / 2,
      thirdOrderTangentialMm: sags.tangentialMm,
      thirdOrderSagittalMm: sags.sagittalMm,
      petzvalMm: sags.petzvalMm,
      distortionPpm: d.relative * 1e6,
      thirdOrderDistortionPpm:
        heightMm === 0
          ? 0
          : (thirdOrderDistortionMm(system, fieldDeg, spec.wavelengthNm) / heightMm) * 1e6,
      lost: focus.lost,
    };
  });

  const edge = samples[samples.length - 1]!;

  const fNumber = spec.focalLengthMm / spec.apertureMm;
  // ±λ/(2·NA²) with NA = 1/(2·f/#). The QUARTER-WAVE figure — the one that
  // answers "how far can the plane move before the image visibly softens" —
  // stated because the same quantity is quoted full-wave elsewhere and the two
  // differ by 2×, which is the kind of gap C6 spent a caption on.
  const depthOfFocusMm = 2 * spec.wavelengthNm * 1e-6 * fNumber * fNumber;

  const medials = samples.map((s) => s.medialSagMm);
  const flatPlaneMm = (Math.min(...medials) + Math.max(...medials)) / 2;
  const flatPlaneWorstDepths =
    Math.max(...medials.map((m) => Math.abs(m - flatPlaneMm))) / depthOfFocusMm;

  // The control: the same edge field at an aperture that loses nothing, so the
  // `lost` guard on the plot can be read against something. The first clean
  // aperture wins; if none is clean the last is reported with its own `lost`,
  // which keeps the readout honest rather than silently comparing two truncated
  // traces.
  let controlApertureMm = spec.apertureMm;
  let controlLost = edge.lost;
  let controlTangentialSagMm = edge.tangentialSagMm;
  if (edge.lost > 0) {
    for (const fraction of CONTROL_FRACTIONS) {
      const apertureMm = spec.apertureMm * fraction;
      const control = fieldSurfaces(build(apertureMm), [spec.maxFieldDeg], spec.wavelengthNm, {
        fanSamples: spec.fanSamples,
      });
      controlApertureMm = apertureMm;
      controlLost = control.foci[0]!.lost;
      controlTangentialSagMm = control.foci[0]!.tangentialSagMm;
      if (controlLost === 0) break;
    }
  }

  const relative = (traced: number, predicted: number) =>
    predicted === 0 ? 0 : traced / predicted - 1;

  const edgeDistortion = Math.abs(edge.distortionPpm) * 1e-6;
  const planeGapMm = distortion.paraxialZ - surfaces.axialZ;

  return {
    samples,
    edge,
    axialZ: surfaces.axialZ,
    paraxialZ: distortion.paraxialZ,
    astigmaticIntervalMm: edge.tangentialSagMm - edge.sagittalSagMm,
    petzvalRatio:
      (edge.tangentialSagMm - edge.petzvalMm) / (edge.sagittalSagMm - edge.petzvalMm),
    tangentialDeparture: relative(edge.tangentialSagMm, edge.thirdOrderTangentialMm),
    sagittalDeparture: relative(edge.sagittalSagMm, edge.thirdOrderSagittalMm),
    distortionDeparture: relative(edge.distortionPpm, edge.thirdOrderDistortionPpm),
    depthOfFocusMm,
    cornerDepths: Math.abs(edge.tangentialSagMm) / depthOfFocusMm,
    flatPlaneMm,
    flatPlaneWorstDepths,
    maxLost: Math.max(...samples.map((s) => s.lost)),
    controlApertureMm,
    controlLost,
    controlDeparture: relative(controlTangentialSagMm, edge.tangentialSagMm),
    defocusLeverRatio:
      edgeDistortion === 0
        ? 0
        : Math.abs(planeGapMm / spec.focalLengthMm) / edgeDistortion,
    elapsedMs: performance.now() - started,
  };
}
