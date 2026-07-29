import { refractorPair } from "@telemicroscope/core/designs";
import {
  applyPerturbation,
  applyPerturbations,
  bestFocus,
  sensitivity,
  toleranceBudget,
  withFocus,
  type PerturbTarget,
  type Perturbation,
} from "@telemicroscope/core/analysis";
import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { blackbodySpectrum, spectralSamples } from "@telemicroscope/core/photometry";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { psf, spectralStack } from "@telemicroscope/core/wave";
import { colorImageFromStack, integratedXyz, toSrgbBytes } from "@telemicroscope/core/imaging";
import type { LensKind } from "./render";

/**
 * Tolerancing, as one pure function — APP.md's Part B, and ROADMAP step 5's
 * named leftover: *"a slider per tolerance, the image degrading as the budget
 * predicts."*
 *
 * No DOM, no React, `render.ts`'s pattern for the seventh time. The engine side
 * is § 5t's `sensitivity` / `toleranceBudget` and **no capability is added
 * here**, so no validation-ladder rung is; what this file's own tests pin is the
 * wiring and the three claims the panel makes that no rung states.
 *
 * ## The one thing scoping got wrong, and it decides the panel
 *
 * APP.md said the moment worth showing is `rssWaves` and `combinedWaves`
 * *diverging when the modes stop being orthogonal* — combined running ABOVE the
 * budget's estimate. That happens, and it is the smaller half. Measured on the
 * app's own achromat at f = 100 / EPD 20, a conic error on the front surface and
 * a curvature error on the rear one — two perturbations of different parameters
 * on different surfaces, which every instinct reads as independent — each spend
 * half the Maréchal budget and **together spend almost none**: rss 0.0506 waves
 * against a combined 2.7e-4, so the RSS budget is **189× pessimistic**. Both
 * produce spherical aberration, of opposite sign. So the honest statement is not
 * "RSS under-reports when modes correlate" but **"RSS is not a bound in either
 * direction"**, and the panel's sliders go negative so a reader can walk into
 * both.
 *
 * How far it cancels is a property of the lens and not of the pair, which is why
 * nothing here quotes it: 189× on that config, 214× at f = 50 / EPD 14, 78× on
 * the singlet, and only 8× at f = 100 / EPD 10. The panel measures and prints
 * `independenceRatio` rather than promising a number — D8's rule about walls,
 * applied to a cancellation.
 *
 * ## Why the sliders are in budget fractions, and where that stops working
 *
 * A `PerturbTarget` is in its own unit — 1/mm for a curvature — and a slider in
 * 1/mm is a slider nobody can read. Each row is therefore scaled by the delta
 * that spends the whole Maréchal budget (σ = λ/14), **measured** rather than
 * chosen: `sensitivity` is called once at a tiny probe delta to read the linear
 * coefficient, and the budget delta is λ/14 divided by it.
 *
 * That extrapolation is legitimate because § 5t's δW *is* linear in the
 * perturbation — measured here, ratio 2.00000 per doubling for curvature,
 * conic, thickness, decenter and for a tilt of either OUTER surface, and the
 * bisected budget delta within 6% of the extrapolated one for **twelve of the
 * achromat's fifteen (surface, target) pairs** (of the other three, one is
 * inert, one is out of reach, and one is the row below). It is not legitimate
 * for that row, and the exception is diagnostic: a
 * tilt of the **cemented interface** has a linear coefficient 63× smaller than
 * the outer surfaces' (its index step is 0.103 against 0.517) while its
 * second-order term is not smaller at all, so the quadratic overtakes the linear
 * at 8e-3° and the extrapolation is **20× wrong** by the time it reaches the
 * budget. So the seed is always verified with one more trace and bisected when
 * it misses, and `RowScale.nonlinearity` — bisected ÷ extrapolated — is printed:
 * 0.96–1.06 for those twelve and 0.0504 for that one. The **singlet** is where
 * this stops being an exception at all: its curvature row reads 0.24 at f/10 and
 * climbs to 0.93 at f/3.3, so which rows are linear is a property of the lens.
 */

const FOCUS_NM = 550;
/** § 5t's own default, and the RMS-native diffraction limit it pins. */
const PUPIL_SAMPLES = 21;
export const MARECHAL_WAVES = 1 / 14;
/** § 5t's own convention: Maréchal's λ/14 rounded to Strehl 0.8. */
export const DIFFRACTION_LIMITED_STREHL = 0.8;

export interface ToleranceSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  /** Entrance pupil diameter. Bounded above by `apertureWallMm` — see there. */
  readonly apertureMm: number;
}

/** A row of the budget: which surface, which parameter, and how far it drifted. */
export interface Row {
  readonly surface: number;
  readonly target: PerturbTarget;
  /** In units of the row's own budget delta, so ±1 is the whole Maréchal budget. */
  readonly fraction: number;
}

export function buildNominal(spec: ToleranceSpec): OpticalSystem {
  const pair = refractorPair(spec.focalLengthMm, spec.apertureMm, spec.focalLengthMm);
  const base: OpticalSystem = {
    prescription: spec.lens === "singlet" ? pair.singlet : pair.achromat,
    aperture: { kind: "EPD", value: spec.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(5800), { count: 5 }),
    conjugate: { kind: "infinite" },
  };
  // Focused by the same criterion at the same wavelength `render.ts` uses, so a
  // star here and a star on the telescope panel are the same picture.
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return withFocus(base, focus.offsetFromLastVertex);
}

const GRID = pupilGrid(PUPIL_SAMPLES);

/** How many of the pupil grid's rays this system loses. 0 is a whole pupil. */
export function lostRays(system: OpticalSystem): number {
  return opdMap(system, 0, FOCUS_NM, GRID).lost;
}

export const gridPoints = (): number => GRID.length;

/**
 * The aperture at which the doublet's own glass runs out — bisected, not quoted.
 *
 * `refractorPair` gives the crown a **fixed 3 mm** centre thickness (5 mm for
 * the singlet) whatever the focal length, so past some semi-diameter the two
 * sags meet and the second surface is behind the first: the tracer reports
 * `miss` and the pupil goes hollow from the rim inward. That is a *mechanical*
 * wall, not an aberration one, and it therefore behaves nothing like the four
 * walls the microscope branch measured: it is **not a focal ratio**. Measured on
 * the achromat, f = 50 / 100 / 200 mm walls at EPD 16.11 / 22.99 / 32.65 — a
 * ratio of 1.427 and 1.420 per doubling against √2 = 1.414, i.e. the wall goes
 * as √f, which is what h = √(t·R) has to look like when t is fixed and R ∝ f.
 * The f-number at the wall therefore *loosens* with focal length, f/3.10 →
 * f/4.35 → f/6.13.
 *
 * It matters to this panel because past it the nominal is already losing rays,
 * and every σ downstream would be an RMS over a shrinking sub-pupil that
 * *shrinks toward zero* as the perturbation grows. A6's rule, on a new axis.
 */
export function apertureWallMm(spec: ToleranceSpec): number {
  const whole = (apertureMm: number): boolean => {
    try {
      return lostRays(buildNominal({ ...spec, apertureMm })) === 0;
    } catch {
      return false;
    }
  };
  let lo = 1;
  let hi = spec.focalLengthMm;
  if (!whole(lo)) return 0;
  // 20 halvings of a ≤200 mm bracket is under 2e-4 mm, four orders finer than
  // the millimetre the aperture control offers. Every step is a build and an
  // `opdMap`, so the count is a cost as well as a precision.
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (whole(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The unit a target's delta is quoted in, for a readout that is not a mystery. */
export const TARGET_UNIT: Record<PerturbTarget, string> = {
  curvature: "1/mm",
  conic: "",
  thickness: "mm",
  tiltX: "°",
  tiltY: "°",
  decenterX: "mm",
  decenterY: "mm",
};

/** Probe deltas small enough to be inside every row's linear range. */
const PROBE: Record<PerturbTarget, number> = {
  curvature: 1e-6,
  conic: 1e-4,
  thickness: 1e-4,
  tiltX: 1e-4,
  tiltY: 1e-4,
  decenterX: 1e-4,
  decenterY: 1e-4,
};

export interface RowScale {
  readonly surface: number;
  readonly target: PerturbTarget;
  /** Waves of σ per unit of the target, read at a probe delta. */
  readonly coefficientWavesPerUnit: number;
  /** The delta at fraction 1. The budget delta when `reachable`; the wall's when not. */
  readonly fullScaleDelta: number;
  /**
   * bisected ÷ extrapolated. 1 means δW really is linear out to the budget;
   * anything else is the second-order term, and the panel prints it.
   */
  readonly nonlinearity: number;
  /** False when no delta short of the ray wall reaches σ = λ/14. */
  readonly reachable: boolean;
  /** σ actually delivered at fraction 1 — the check on everything above. */
  readonly sigmaAtFullScale: number;
  /**
   * Set when the row cannot express a tolerance at all, with the reason. The
   * only member so far is the LAST surface's thickness: `withFocus` sets the
   * image plane as an offset from the last vertex, so that airspace is not
   * compensated by the focus solve, it is **inert** — `sigmaBeforeFocusWaves` is
   * exactly 0 too, which is what tells the two apart.
   */
  readonly inert?: string;
}

const sigmaOf = (
  nominal: OpticalSystem,
  surface: number,
  target: PerturbTarget,
  delta: number,
): number =>
  sensitivity(nominal, { surface, target, delta }, {
    pupilSamples: PUPIL_SAMPLES,
    wavelengthNm: FOCUS_NM,
  }).sigmaWaves;

/** Whether a delta keeps the pupil whole — the bound every search here stops at. */
const wholeAt = (
  nominal: OpticalSystem,
  surface: number,
  target: PerturbTarget,
  delta: number,
): boolean => {
  try {
    const perturbed: OpticalSystem = {
      ...nominal,
      prescription: applyPerturbation(nominal.prescription, { surface, target, delta }),
    };
    return lostRays(perturbed) === 0;
  } catch {
    return false;
  }
};

/**
 * Scale one row: read the linear coefficient, extrapolate to λ/14, then check.
 *
 * The check is not optional and it is not free-standing prose — `nonlinearity`
 * is what it returns, and the panel prints it. See the module header for the row
 * it catches.
 */
export function scaleRow(
  nominal: OpticalSystem,
  surface: number,
  target: PerturbTarget,
): RowScale {
  const last = nominal.prescription.surfaces.length - 1;
  if (target === "thickness" && surface === last) {
    return {
      surface,
      target,
      coefficientWavesPerUnit: 0,
      fullScaleDelta: 1,
      nonlinearity: 1,
      reachable: false,
      sigmaAtFullScale: 0,
      inert:
        "the image plane is an offset from the LAST vertex, so this airspace " +
        "is not compensated — it is unreachable by the model",
    };
  }

  // A fixed probe would sit under f64 noise on a long focal length and past the
  // linear range on a short one, so it is grown until σ is unambiguous.
  let probe = PROBE[target];
  let coefficient = 0;
  for (let i = 0; i < 5; i++) {
    coefficient = sigmaOf(nominal, surface, target, probe) / probe;
    if (coefficient * probe > 1e-8) break;
    probe *= 100;
  }
  if (!(coefficient > 0)) {
    return {
      surface,
      target,
      coefficientWavesPerUnit: 0,
      fullScaleDelta: 1,
      nonlinearity: 1,
      reachable: false,
      sigmaAtFullScale: 0,
      inert: "no measurable wavefront change — this parameter does not reach the image",
    };
  }

  const extrapolated = MARECHAL_WAVES / coefficient;

  // Search only where the pupil is whole: past the ray wall a σ is an RMS over a
  // sub-pupil and comparing it to a budget would be comparing two different
  // apertures.
  let hi = extrapolated * 4;
  while (hi > extrapolated * 1e-4 && !wholeAt(nominal, surface, target, hi)) hi /= 2;
  let sigmaHi = 0;
  try {
    sigmaHi = sigmaOf(nominal, surface, target, hi);
  } catch {
    sigmaHi = 0;
  }
  if (!(sigmaHi >= MARECHAL_WAVES)) {
    return {
      surface,
      target,
      coefficientWavesPerUnit: coefficient,
      fullScaleDelta: hi,
      nonlinearity: 1,
      reachable: false,
      sigmaAtFullScale: sigmaHi,
    };
  }

  let lo = 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (sigmaOf(nominal, surface, target, mid) < MARECHAL_WAVES) lo = mid;
    else hi = mid;
  }
  return {
    surface,
    target,
    coefficientWavesPerUnit: coefficient,
    fullScaleDelta: hi,
    nonlinearity: hi / extrapolated,
    reachable: true,
    sigmaAtFullScale: sigmaOf(nominal, surface, target, hi),
  };
}

export interface RowReadout {
  readonly surface: number;
  readonly target: PerturbTarget;
  readonly fraction: number;
  /** The physical drift, in `TARGET_UNIT[target]`. */
  readonly delta: number;
  /**
   * The radius the curvature slider actually asks for, and the change in it.
   * Absent for every other target, and for a flat surface — 1/0 is not a radius
   * and printing `Infinity` beside a tolerance would be inviting a reader to
   * believe it.
   */
  readonly radiusMm?: number;
  readonly radiusChangeMm?: number;
  /** § 5t's currency: δW with piston, tilt and defocus projected out. */
  readonly sigmaWaves: number;
  /** Before the focus compensator. `focusGain` is the ratio, and it is the story. */
  readonly sigmaBeforeFocusWaves: number;
  readonly focusGain: number;
  /** What a real focuser leaves — `bestFocus` re-run on the perturbed system. */
  readonly physicalRefocusWaves: number;
  readonly boresightRad: number;
  /** σᵢ²/Σσᵢ² — who spends what, which is the only sense in which a budget adds. */
  readonly varianceShare: number;
}

export interface ToleranceRequest {
  readonly spec: ToleranceSpec;
  readonly rows: readonly Row[];
  readonly scales: readonly RowScale[];
  /** Render the perturbed star at its OWN best focus, or at the nominal's. */
  readonly refocus: boolean;
  /** Display gain: white is the nominal star's peak divided by this. */
  readonly whiteDivisor: number;
  /** Points across the k axis of the rss-against-combined sweep. */
  readonly sweepPoints: number;
}

export interface SweepPoint {
  readonly k: number;
  readonly rssWaves: number;
  readonly combinedWaves: number;
}

/**
 * Which scaling a job ran on, echoed so a caller can tell.
 *
 * The scaling and the render are separate jobs, so a row change produces a
 * render against the OLD scaling (or against none) before the new scaling
 * lands — and that render is a perfectly plausible table of zeros. Comparing
 * this against the scaling on screen is what lets the panel withdraw it. Same
 * argument as `ScaleResult.targets` and the opposite direction.
 */
export function scaleSignature(scales: readonly RowScale[]): string {
  return scales.map((s) => `${s.surface}:${s.target}:${s.fullScaleDelta}`).join("|");
}

export interface ToleranceResult {
  readonly scaleSignature: string;
  /**
   * Which focus the perturbed frame was formed at, echoed for the same reason
   * `scaleSignature` is: the compensator decides the caption under the picture,
   * which σ the table prints large, and whether the Strehl-against-Maréchal
   * ratio is meaningful at all. Driving those from the control's state instead
   * would relabel the frame ~1–3 s before it is recomputed — A4's rule that a
   * stale reading may be greyed only when nothing on screen misdescribes it.
   */
  readonly refocus: boolean;
  readonly rows: readonly RowReadout[];
  readonly rssWaves: number;
  readonly combinedWaves: number;
  /** combined ÷ rss. 1 is quadrature; √2 is perfect correlation; 0 is cancellation. */
  readonly independenceRatio: number;
  readonly strehlMarechal: number;
  /** The real PSF Strehl of the nominal — not 1, because a real doublet is not perfect. */
  readonly strehlNominal: number;
  readonly strehlPerturbed: number;
  /** perturbed ÷ nominal, which is what the two pictures show. */
  readonly strehlRatio: number;
  /**
   * Whether that ratio means anything, and it does not always.
   *
   * A Strehl ratio reads what the tolerances cost only while the nominal is
   * itself diffraction-limited. Push this app's SINGLET to f/5 and its nominal
   * Strehl is **0.067** — the ratio is then two small numbers divided, and at
   * f/4 it reads 1.179, the perturbed system "better" than a nominal that is not
   * forming an image to begin with. § 5t's own convention supplies the line:
   * Strehl 0.8 is the diffraction limit, so below it the ratio is refused rather
   * than printed. Found by running the singlet, which the achromat-only rungs
   * never reached.
   */
  readonly strehlRatioMeaningful: boolean;
  readonly sweep: readonly SweepPoint[];
  readonly rgbaNominal: Uint8ClampedArray;
  readonly rgbaPerturbed: Uint8ClampedArray;
  readonly size: number;
  readonly pixelScaleMm: number;
  /** The XYZ-Y both frames were divided by — one reference, printed. */
  readonly exposureReferenceY: number;
  readonly nominalLost: number;
  readonly perturbedLost: number;
  readonly gridPoints: number;
  readonly truncatedFractionNominal: number;
  readonly truncatedFractionPerturbed: number;
  readonly geometricWeightNominal: number;
  readonly geometricWeightPerturbed: number;
  readonly elapsedMs: number;
}

export interface ToleranceJob {
  readonly seq: number;
  readonly request: ToleranceRequest;
}

export interface ToleranceDone {
  readonly seq: number;
  readonly result: ToleranceResult;
}

/** A row's physical perturbation. Zero-fraction rows are dropped, not traced. */
export function perturbationsOf(
  rows: readonly Row[],
  scales: readonly RowScale[],
): Perturbation[] {
  const out: Perturbation[] = [];
  rows.forEach((row, i) => {
    const scale = scales[i];
    if (!scale || scale.inert || row.fraction === 0) return;
    out.push({
      surface: row.surface,
      target: row.target,
      delta: row.fraction * scale.fullScaleDelta,
    });
  });
  return out;
}

const STACK = { pupilSamples: 32, padFactor: 4, traceSamples: 21 } as const;
const PSF_OPTIONS = { pupilSamples: 32, padFactor: 4 } as const;

/**
 * The whole panel in one job — numbers and both pictures.
 *
 * One job rather than two because the panel's claim is a *comparison*: A3's
 * argument for carrying its in-focus and defocused frames together, and here it
 * binds three things rather than two, since the σ table describes the perturbed
 * frame beside it. Two jobs could transiently show one lens's picture under
 * another's budget.
 */
export function runTolerance(request: ToleranceRequest): ToleranceResult {
  const started = performance.now();
  const nominal = buildNominal(request.spec);
  const perts = perturbationsOf(request.rows, request.scales);

  const budget =
    perts.length > 0
      ? toleranceBudget(nominal, perts, {
          pupilSamples: PUPIL_SAMPLES,
          wavelengthNm: FOCUS_NM,
        })
      : { contributions: [], rssWaves: 0, combinedWaves: 0, strehlMarechal: 1 };

  const totalVariance = budget.contributions.reduce((a, c) => a + c.sigmaWaves ** 2, 0);
  let taken = 0;
  const rows: RowReadout[] = request.rows.map((row, i): RowReadout => {
    const scale = request.scales[i];
    const delta = scale && !scale.inert ? row.fraction * scale.fullScaleDelta : 0;
    const surfaceSpec = nominal.prescription.surfaces[row.surface];
    const curvature = surfaceSpec?.curvature ?? 0;
    const radius =
      row.target === "curvature" && curvature !== 0
        ? {
            radiusMm: 1 / curvature,
            radiusChangeMm: 1 / (curvature + delta) - 1 / curvature,
          }
        : {};
    if (delta === 0) {
      return {
        surface: row.surface,
        target: row.target,
        fraction: row.fraction,
        delta,
        ...radius,
        sigmaWaves: 0,
        sigmaBeforeFocusWaves: 0,
        focusGain: 1,
        physicalRefocusWaves: 0,
        boresightRad: 0,
        varianceShare: 0,
      };
    }
    const s = sensitivity(
      nominal,
      { surface: row.surface, target: row.target, delta },
      { pupilSamples: PUPIL_SAMPLES, wavelengthNm: FOCUS_NM },
    );
    const share = totalVariance > 0 ? budget.contributions[taken]!.sigmaWaves ** 2 / totalVariance : 0;
    taken += 1;
    return {
      surface: row.surface,
      target: row.target,
      fraction: row.fraction,
      delta,
      ...radius,
      sigmaWaves: s.sigmaWaves,
      sigmaBeforeFocusWaves: s.sigmaBeforeFocusWaves,
      focusGain: s.sigmaWaves > 0 ? s.sigmaBeforeFocusWaves / s.sigmaWaves : 1,
      physicalRefocusWaves: s.physicalRefocusWaves,
      boresightRad: s.boresightRad,
      varianceShare: share,
    };
  });

  // The sweep scales EVERY row by one k. rss is linear in k by construction —
  // each σᵢ is, over the range the scaling measured — so any departure the
  // combined curve shows is the cross terms, drawn rather than asserted.
  const sweep: SweepPoint[] = [];
  for (let i = 0; i < request.sweepPoints; i++) {
    const k = (i / (request.sweepPoints - 1)) * 2;
    if (perts.length === 0) {
      sweep.push({ k, rssWaves: 0, combinedWaves: 0 });
      continue;
    }
    const scaled = perts.map((p) => ({ ...p, delta: p.delta * k }));
    const b = toleranceBudget(nominal, scaled, {
      pupilSamples: PUPIL_SAMPLES,
      wavelengthNm: FOCUS_NM,
    });
    sweep.push({ k, rssWaves: b.rssWaves, combinedWaves: b.combinedWaves });
  }

  const perturbedRaw: OpticalSystem =
    perts.length > 0
      ? { ...nominal, prescription: applyPerturbations(nominal.prescription, perts) }
      : nominal;
  const perturbed =
    request.refocus && perts.length > 0
      ? withFocus(
          perturbedRaw,
          bestFocus(perturbedRaw, "minRmsWavefront", { wavelengthNm: FOCUS_NM })
            .offsetFromLastVertex,
        )
      : perturbedRaw;

  const psfNominal = psf(nominal, 0, FOCUS_NM, PSF_OPTIONS);
  const psfPerturbed = psf(perturbed, 0, FOCUS_NM, PSF_OPTIONS);

  const stackNominal = spectralStack(nominal, 0, STACK);
  const stackPerturbed = spectralStack(perturbed, 0, STACK);
  const imageNominal = colorImageFromStack(stackNominal);
  const imagePerturbed = colorImageFromStack(stackPerturbed);

  // ONE exposure for both frames, taken from the NOMINAL. Exposing each on its
  // own total would re-brighten the degradation into invisibility — A3's shared
  // grey scale, on the axis where it decides whether the panel says anything.
  const referenceY = integratedXyz(imageNominal).y;
  const exposure = 1 / (referenceY / request.whiteDivisor);

  return {
    scaleSignature: scaleSignature(request.scales),
    refocus: request.refocus,
    rows,
    rssWaves: budget.rssWaves,
    combinedWaves: budget.combinedWaves,
    independenceRatio: budget.rssWaves > 0 ? budget.combinedWaves / budget.rssWaves : 1,
    strehlMarechal: budget.strehlMarechal,
    strehlNominal: psfNominal.strehl,
    strehlPerturbed: psfPerturbed.strehl,
    strehlRatio: psfNominal.strehl > 0 ? psfPerturbed.strehl / psfNominal.strehl : 0,
    strehlRatioMeaningful: psfNominal.strehl >= DIFFRACTION_LIMITED_STREHL,
    sweep,
    rgbaNominal: toSrgbBytes(imageNominal, { exposure }),
    rgbaPerturbed: toSrgbBytes(imagePerturbed, { exposure }),
    size: imageNominal.width,
    pixelScaleMm: imageNominal.pixelScaleMm,
    exposureReferenceY: referenceY,
    nominalLost: lostRays(nominal),
    perturbedLost: lostRays(perturbedRaw),
    gridPoints: GRID.length,
    truncatedFractionNominal: stackNominal.truncatedFraction,
    truncatedFractionPerturbed: stackPerturbed.truncatedFraction,
    geometricWeightNominal: Math.max(...stackNominal.planes.map((p) => p.geometricWeight)),
    geometricWeightPerturbed: Math.max(...stackPerturbed.planes.map((p) => p.geometricWeight)),
    elapsedMs: performance.now() - started,
  };
}

export interface ScaleRequest {
  readonly spec: ToleranceSpec;
  readonly targets: readonly { readonly surface: number; readonly target: PerturbTarget }[];
}

export interface ScaleResult {
  /**
   * The rows this answer is FOR, echoed back. A scaling is a statement about
   * (surface, target) pairs and an aperture, so a panel holding the last good
   * one while the next is in flight would print "±1 = 0.27 mm of decentre" under
   * a row that now says *curvature*. Echoing the question is what lets the
   * caller withdraw rather than mislabel — A4's rule, and the reason this is not
   * simply an array.
   */
  readonly targets: readonly { readonly surface: number; readonly target: PerturbTarget }[];
  readonly apertureMm: number;
  readonly scales: readonly RowScale[];
  readonly apertureWallMm: number;
  readonly nominalLost: number;
  readonly nominalRmsWaves: number;
  readonly elapsedMs: number;
}

export interface ScaleJob {
  readonly seq: number;
  readonly request: ScaleRequest;
}

export interface ScaleDone {
  readonly seq: number;
  readonly result: ScaleResult;
}

/**
 * Scale every row, plus the wall and the nominal's own wavefront.
 *
 * Its own job because it is keyed on strictly less than the render is: a slider
 * drag changes the fractions and not the scaling, and re-bisecting four rows to
 * move a slider would put a quarter-second under every frame of a drag.
 */
export function runScales(request: ScaleRequest): ScaleResult {
  const started = performance.now();
  const nominal = buildNominal(request.spec);
  const map = opdMap(nominal, 0, FOCUS_NM, GRID);
  return {
    targets: request.targets,
    apertureMm: request.spec.apertureMm,
    scales: request.targets.map((t) => scaleRow(nominal, t.surface, t.target)),
    apertureWallMm: apertureWallMm(request.spec),
    nominalLost: map.lost,
    nominalRmsWaves: map.rmsWaves,
    elapsedMs: performance.now() - started,
  };
}
