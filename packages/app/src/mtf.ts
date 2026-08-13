import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { diffractionLimitedMtf, mtf, mtfProfile, mtfSections, psf } from "@telemicroscope/core/wave";
import { buildSystem, type LensKind } from "./render";

/**
 * The optical MTF — how much contrast survives, against detail, for the lens
 * itself rather than for the sensor behind it.
 *
 * ROADMAP's v1 analyses line, the LAST of the entries that had no surface. The
 * app already draws an MTF on the camera page and it is the **detector's** —
 * a pixel integrating over its own footprint — which is a different quantity
 * with a different cutoff, measured by different code. `core/wave/mtf` had no
 * caller anywhere in `packages/app` until this file.
 *
 * ## What this panel is for, in one line
 *
 * A spot diagram answers "how big is the blur" and a Zernike readout answers
 * "what shape is the wavefront". Neither answers the question people actually
 * buy a lens for — *can it separate these two things* — and that is what an MTF
 * curve is. It is also the only readout in the app whose perfect answer is
 * known in closed form and can be drawn behind the real one.
 *
 * ## Three claims, and only the first was expected
 *
 * 1. **Off axis there is no such thing as "the" MTF: there are two.** A comatic
 *    or astigmatic image is blurred more in one direction than the other, so
 *    contrast survives differently for bars running one way than the other. The
 *    engine's `mtfSections` (§ 6ad) reports both; the azimuthal average that
 *    existed before it is exact on axis and a summary off it. On the shipped
 *    achromat at 0.8° the two part by 1.5× at low frequency.
 *
 * 2. **The average is wrong by hiding the band, not by leaving it — and the
 *    first draft of this file had that backwards.** The obvious complaint about
 *    an azimuthal mean is that it runs over the 45° directions too, which on a
 *    comatic pupil are worse than either axis, so the summary should sit BELOW
 *    both curves it summarizes. Measured, that excursion is **3e-5 at 0.8° and
 *    0.0012 at 1.6°** — real, and three orders under the thing that matters.
 *    What actually matters is that the two sections are **0.28 apart** at 1.6°
 *    and the average sits neatly between them, reporting one number where the
 *    honest answer is two, and a number that neither orientation of a bar target
 *    gets. A summary is not discredited by being slightly outside its own range;
 *    it is discredited by there being a range.
 *
 *    The 0.015 that the first draft measured for that excursion turned out to be
 *    the profile's own **annulus binning** and not the optics at all, which is
 *    also how the `mtfProfile` refusal below was found. A claim about a
 *    summary's honesty that is really a claim about its bin width is exactly the
 *    kind of thing this panel exists to stop, so it is written down rather than
 *    quietly corrected.
 *
 * 3. **The cutoff the engine reports is the aperture you asked for, and the
 *    curve stops somewhere else.** `cutoffCyclesPerMm` is 2·NA/λ off the exit
 *    pupil radius. The array's real support is the aperture that survived the
 *    trace. On this app's own achromat at f/10 those differ by 27% — the crown
 *    element closes on itself at 73% of its semi-diameter (Part B's aperture
 *    wall), every ray past that is a `miss`, and the modulation reaches zero at
 *    ν = 0.73 while the readout still prints 170.27 c/mm. So this file measures
 *    the transmitted cutoff by scanning the curve, and the panel shows the two
 *    numbers side by side rather than one of them.
 *
 *    The engine is not wrong here and the panel does not treat it as a bug: the
 *    reported number is the right answer to "what is the cutoff of a 100 mm
 *    aperture", and the wall is a property of a design generator that hard-codes
 *    3 mm of crown. What would be wrong is a plot with ν on its axis and only
 *    one of the two numbers behind it.
 *
 * ## One thing on the plot that looks like a mistake and is not
 *
 * On axis the measured curve sits slightly ABOVE the closed-form perfect one —
 * 0.881 against 0.873 at ν = 0.1, about 0.009 of modulation. A lens cannot beat
 * its own aperture; this is the discrete pupil (64 samples across a circle, so
 * the rim is a staircase) plus the linear interpolation between frequency bins,
 * and it is inside the 0.01 that § 2b's own rung allows. The panel labels it
 * rather than hiding it, because on a chart with both curves drawn it is the
 * first thing a careful reader notices.
 */

/** The lines a lens is conventionally quoted at, matching `wavefront.ts`. */
export const MTF_LINES: readonly { readonly nm: number; readonly name: string }[] = [
  { nm: 486.1327, name: "F (blue)" },
  { nm: 587.5618, name: "d (yellow)" },
  { nm: 656.2725, name: "C (red)" },
];

export interface MtfSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  readonly fieldDeg: number;
  readonly wavelengthNm: number;
  /** Rays across the pupil diameter for the trace the wavefront is fitted from. */
  readonly traceSamples: number;
  /** Samples along each curve. */
  readonly bins: number;
}

export interface MtfCurves {
  /** Normalized frequency ν = f/f_c, spanning [0, 1]. */
  readonly nu: readonly number[];
  readonly frequencyCyclesPerMm: readonly number[];
  readonly tangential: readonly number[];
  readonly sagittal: readonly number[];
  /** The azimuthal average — drawn to be seen reporting one number for two. */
  readonly radial: readonly number[];
  /** The closed form for an unobstructed circular pupil at the same ν. */
  readonly perfect: readonly number[];
}

export interface MtfResult {
  readonly curves: MtfCurves;
  /** 2·NA/λ off the exit pupil radius — the aperture that was asked for. */
  readonly nominalCutoffCyclesPerMm: number;
  /**
   * Where the modulation actually reaches its floor, as a fraction of the
   * nominal cutoff. 1 when the whole pupil transmits; 0.73 on the shipped f/10
   * achromat, which is the aperture wall.
   */
  readonly transmittedCutoffFraction: number;
  /** The same in cycles/mm — the number a resolution claim should be made from. */
  readonly transmittedCutoffCyclesPerMm: number;
  /** Largest |T − S| over the band. 0 on axis to the f64 floor. */
  readonly largestSplit: number;
  /** ν at which that split is largest — where the two orientations differ most. */
  readonly splitAtNu: number;
  /**
   * How far the radial average drops below BOTH sections, at worst — the 45°
   * azimuths showing through. Genuinely tiny (3e-5 at 0.8°): the average's
   * problem is `largestSplit`, not this. Kept because it is the claim the first
   * draft got wrong, and a number on screen is harder to get wrong twice.
   */
  readonly averageBelowBoth: number;
  /**
   * Largest gap between the average and whichever section is further from it —
   * how much a single summary curve misstates one of the two real answers.
   */
  readonly averageMisstatesBy: number;
  /** Largest amount by which the measured curve exceeds the closed form. */
  readonly overshoot: number;
  /** Rays the trace lost in the pupil. Non-zero IS the truncation. */
  readonly lost: number;
  /** Largest pupil radius that survived the trace, in units of the nominal. */
  readonly tracedRadiusFraction: number;
  readonly strehl: number;
  readonly elapsedMs: number;
}

/** Below this a modulation is the transform's floor rather than contrast. */
export const MODULATION_FLOOR = 1e-4;

/**
 * Pupil samples on the FFT grid. Fixed rather than offered: `pupilSamples` sets
 * where the cutoff lands in frequency bins, so a control that moved it would be
 * moving the horizontal axis of the plot while looking like a quality setting.
 * `wavefront.ts` fixes it at 64 for the same reason.
 */
const PUPIL_SAMPLES = 64;

export function mtfCurves(spec: MtfSpec): MtfResult {
  const started = performance.now();

  // The SAME system the star image is made from — `rayfan.ts`'s reason: a plot
  // that explained a different lens would look exactly as convincing.
  const system = buildSystem({
    lens: spec.lens,
    focalLengthMm: spec.focalLengthMm,
    apertureMm: spec.apertureMm,
    sourceTemperatureK: spec.sourceTemperatureK,
    wavelengths: spec.wavelengths,
    pupilSamples: PUPIL_SAMPLES,
    whiteFraction: 1,
    seeingDOverR0: 0,
  });

  const p = psf(system, spec.fieldDeg, spec.wavelengthNm, {
    pupilSamples: PUPIL_SAMPLES,
    padFactor: 4,
    traceSamples: spec.traceSamples,
    zernikeTerms: 28,
  });
  const m = mtf(p);
  const sections = mtfSections(m, spec.bins, p.pupilSamples);
  // The two curves cannot share a bin count and the reason is not cosmetic. A
  // section is a point sample, so `bins` is just how smooth the line looks; the
  // average is a mean over an ANNULUS, so past `pupilSamples` bins the annuli
  // are narrower than a pixel and come back empty. Asking for 81 of them across
  // a 64-bin band is what found the engine refusal now in `mtfProfile` — it read
  // 0.51 of modulation below the sections, four times the real effect and in the
  // same direction, which is the worst kind of wrong number to draw.
  const profile = mtfProfile(m, Math.min(spec.bins, p.pupilSamples), p.pupilSamples);

  const nu = Array.from(sections.nu);
  const tangential = Array.from(sections.tangential);
  const sagittal = Array.from(sections.sagittal);
  const perfect = nu.map(diffractionLimitedMtf);

  // The average is on bin CENTRES and the sections on [0,1] endpoints, so it is
  // resampled onto the sections' abscissa rather than plotted against its own —
  // two curves on one chart at frequencies half a bin apart would show a
  // difference that is the binning and not the optics.
  const radial = nu.map((v) => sampleProfile(profile.nu, profile.modulation, v));

  let largestSplit = 0;
  let splitAtNu = 0;
  let averageBelowBoth = 0;
  let averageMisstatesBy = 0;
  let overshoot = 0;
  for (let b = 0; b < nu.length; b++) {
    const d = Math.abs(tangential[b]! - sagittal[b]!);
    if (d > largestSplit) {
      largestSplit = d;
      splitAtNu = nu[b]!;
    }
    averageBelowBoth = Math.max(
      averageBelowBoth,
      Math.min(tangential[b]!, sagittal[b]!) - radial[b]!,
    );
    averageMisstatesBy = Math.max(
      averageMisstatesBy,
      Math.abs(tangential[b]! - radial[b]!),
      Math.abs(sagittal[b]! - radial[b]!),
    );
    overshoot = Math.max(overshoot, Math.max(tangential[b]!, sagittal[b]!) - perfect[b]!);
  }

  // Where the curve actually stops. Scanned from the top so a dip to the floor
  // in the middle of the band — which a badly aberrated lens genuinely has —
  // does not read as the cutoff.
  let transmittedCutoffFraction = 0;
  for (let b = nu.length - 1; b >= 0; b--) {
    if (Math.max(tangential[b]!, sagittal[b]!) > MODULATION_FLOOR) {
      transmittedCutoffFraction = nu[b]!;
      break;
    }
  }

  // What the trace kept, measured independently of the transform: the two must
  // agree, and the panel prints both so that they can be seen agreeing.
  const map = opdMap(system, spec.fieldDeg, spec.wavelengthNm, pupilGrid(spec.traceSamples), {});
  let tracedRadiusFraction = 0;
  for (const s of map.samples) {
    tracedRadiusFraction = Math.max(tracedRadiusFraction, Math.hypot(s.px, s.py));
  }

  return {
    curves: {
      nu,
      frequencyCyclesPerMm: Array.from(sections.frequencyCyclesPerMm),
      tangential,
      sagittal,
      radial,
      perfect,
    },
    nominalCutoffCyclesPerMm: m.cutoffCyclesPerMm,
    transmittedCutoffFraction,
    transmittedCutoffCyclesPerMm: transmittedCutoffFraction * m.cutoffCyclesPerMm,
    largestSplit,
    splitAtNu,
    averageBelowBoth,
    averageMisstatesBy,
    overshoot,
    lost: map.lost,
    tracedRadiusFraction,
    strehl: p.strehl,
    elapsedMs: performance.now() - started,
  };
}

/** Linear interpolation of the binned profile onto an arbitrary ν. */
function sampleProfile(nu: Float64Array, values: Float64Array, at: number): number {
  const n = nu.length;
  if (at <= nu[0]!) return values[0]!;
  if (at >= nu[n - 1]!) return values[n - 1]!;
  let i = 0;
  while (i + 1 < n && nu[i + 1]! < at) i++;
  const t = (at - nu[i]!) / (nu[i + 1]! - nu[i]!);
  return values[i]! * (1 - t) + values[i + 1]! * t;
}
