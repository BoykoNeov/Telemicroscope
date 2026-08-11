import {
  huygensEyepiece,
  plosslEyepiece,
  visualMicroscope,
  MAX_USEFUL_EXIT_PUPIL_MM,
  MIN_USEFUL_EXIT_PUPIL_MM,
  NEAR_POINT_MM,
  type ImageFormingMicroscope,
} from "@telemicroscope/core/designs";
import {
  exitVergenceDiopters,
  lagrangeExitPupilRadiusMm,
  microscopeVisualProperties,
  objectNumericalAperture,
  paraxialObjectNumericalAperture,
  pupils,
  usefulMagnificationRange,
  visualDetailRatio,
  visualMagnification,
  visualMicroscopeSystem,
} from "@telemicroscope/core/pupil";
import { afocalTelescope, spliceModules } from "@telemicroscope/core/trace";
import type { OpticalSystem, Prescription } from "@telemicroscope/core/trace";
import { buildMicroscope, type BuildSpec } from "./builder";
import { LAMBDA_NM } from "./microscope";
import { refusalOf, type Refusal as SharedRefusal } from "./refusal";

/**
 * The eyepiece on the intermediate image — APP.md's D6, as pure functions.
 *
 * `render.ts`'s commitment kept for the eighth time: numbers in, numbers out, no
 * DOM and no React. What is different here is the **cost**, and it changes the
 * scheduling rather than the boundary. § 6q's composition is first-order work —
 * one affine solve, no FFTs, no pupil sums — so `describeInstrument` is ~8 ms
 * once the objective is memoized and genuinely sits under a live slider, where
 * every microscope surface since A2 has needed a worker. The two things that do
 * NOT fit on the main thread are both *sweeps of builds* rather than sweeps of
 * traces: a 21-point focal-length sweep re-solves 21 Plössls at ~7.5 ms each
 * (~160 ms on the DIN 4×, ~220 ms on the oil), and the clear-aperture wall is a
 * bisection over the same solve. Those are the two workers.
 *
 * ## Which numbers are traced and which are paraxial — the labelling matters
 *
 * This module deliberately does not call anything "traced" that a real ray did
 * not produce, because on this surface the distinction is the finding:
 *
 *  - `visualMagnification` is a **real chief ray's** exit angle (§ 6q.4), and
 *    `objectNumericalAperture` is a **real marginal ray's** launch sine. Traced.
 *  - `pupils().exit.radius` is the aperture stop **imaged paraxially** through
 *    everything behind it, and `paraxialObjectNumericalAperture` is n·r/arm off
 *    that same pupil geometry. Both paraxial.
 *
 * So `exitPupilDiameterMm` agreeing with `D·NA_paraxial/|M|` to 1e-7 is one
 * bookkeeping being self-consistent through a traced M — which is exactly what
 * § 6q.5 pins — and is a *weaker* statement than two independent computations
 * agreeing. The panel says so. What is not weak is the other comparison: fed the
 * **engraved** (sine) NA, the same invariant misses that exit pupil by 0.50% at
 * NA 0.10 and by 61% at NA 1.40, because the Lagrange invariant is a law about
 * paraxial slopes and n·sin u is not one. `500·NA/M` is that formula, and every
 * panel printing an exit pupil for an oil objective has to pick; this is which.
 *
 * ## The negative control is computed live, because it is the step's argument
 *
 * `afocalTelescope`'s own gap on the *same two modules* is what § 6q exists to
 * replace, and its cost is one splice — so it is not quoted from the ladder, it
 * is recomputed for whatever the reader has selected and reported in diopters.
 * The sign is the diagnosis (§ 6q.3): positive means the exit beam converges to
 * a real point past the eye lens, which is the side no accommodation reaches.
 *
 * ## Two things measured here rather than transcribed
 *
 *  1. **The placement band.** How far the eyepiece may sit from its solved
 *     position before an observer notices, bisected against the quarter diopter
 *     that is the usual threshold. Drawn beside the thin-lens Newton form
 *     1000·Δ/f_e², which is a *label on a curve* and not a rung.
 *  2. **The clear-aperture wall.** § 6q.9 pins it as a bracket — a computed
 *     Plössl admits 24 mm at f_e = 25 and refuses 24.5. Bisecting it is the same
 *     move A6 made for § 6e.4's NA ceiling, and it lands at 0.9615248·f_e.
 *     (0.899195·f_e until § 6b.5.7 stopped the doublet's bending scan counting a
 *     root that is five times hemispherical and is not a surface — the wall is
 *     the same refusal, measured after the count was made to mean what it said.)
 */

/** The two computed eyepiece forms in the library (§§ 5m, 5o). */
export const EYEPIECE_FORMS = ["plossl", "huygens"] as const;
export type EyepieceForm = (typeof EYEPIECE_FORMS)[number];

/**
 * The near points offered. 250 mm is `NEAR_POINT_MM`, and the other two are
 * there because it is a **convention about human eyes** and not a law — § 6q.4
 * pins M as exactly proportional to whatever is passed in, so a microscope
 * quoted against 254 mm is genuinely a different number.
 */
export const NEAR_POINTS = [200, 250, 254] as const;

/** The quarter diopter an observer is taken to notice — the placement band's edge. */
export const NOTICEABLE_DIOPTERS = 0.25;

/**
 * The object height every angular readout is taken at (mm).
 *
 * `visualMagnification` is a real ray's answer, so it carries distortion and is
 * only a single number near the axis (§ 6q.4: +20% at the field edge on a DIN
 * 4×). 1e-4 mm is converged to every digit printed here on all three
 * architectures — measured against 1e-5 and 1e-6 — and is far enough from f64
 * noise to stay stable at 4× as well as at 1000×.
 */
const PROBE_HEIGHT_MM = 1e-4;

/** The default glass a form gets when no field number pins it. */
const defaultClearAperture = (form: EyepieceForm, focalLengthMm: number): number =>
  form === "plossl" ? 0.86 * focalLengthMm : 0.8 * focalLengthMm;

/**
 * Build one eyepiece. The clear aperture is the field number when there is one,
 * because a field stop of FN millimetres needs FN millimetres of glass behind
 * it — which is where § 5j's doublet wall arrives (§ 6q.9).
 */
export function buildEyepiece(
  form: EyepieceForm,
  focalLengthMm: number,
  clearApertureMm: number,
): Prescription {
  return form === "plossl"
    ? plosslEyepiece({ focalLengthMm, clearApertureMm }).prescription
    : huygensEyepiece({ focalLengthMm, clearApertureMm }).prescription;
}

/**
 * Which piece refused, so the panel can name it rather than say "it failed".
 *
 * The shape moved to `refusal.ts` when C5 became the second surface composing an
 * objective with an eyepiece; the *stages* stayed here, because they are this
 * instrument's parts list and a visual telescope's is not the same one.
 */
export type RefusalStage = "objective" | "eyepiece" | "composition";

export type Refusal = SharedRefusal<RefusalStage>;

const refusal = (cause: unknown, stage: RefusalStage): Refusal => refusalOf(cause, stage);

export interface InstrumentRequest {
  readonly spec: BuildSpec;
  readonly form: EyepieceForm;
  readonly eyepieceFocalLengthMm: number;
  /** The eyepiece's field stop at the intermediate image (mm); `null` = none. */
  readonly fieldNumberMm: number | null;
  readonly nearPointMm: number;
  readonly eyePupilMm: number;
}

/** One point on the vergence-against-placement curve. */
export interface GapPoint {
  /** Eyepiece displacement from its solved position (mm). */
  readonly deltaMm: number;
  /** What the trace says the exit beam leaves with (diopters). */
  readonly diopters: number;
  /**
   * The thin-lens Newton form 1000·Δ/f_e², drawn beside it as a **label**: an
   * object displaced Δ from a collimator's front focus leaves at −f_e²/Δ, so the
   * vergence is linear in the displacement with slope 1000/f_e². It is not a
   * rung — the eyepiece here is thick, and the gap between the two curves is the
   * thickness.
   */
  readonly newtonDiopters: number;
}

/**
 * § 6q.3's negative control: what `afocalTelescope`'s own gap does to the same
 * two modules — **and the fact that it sometimes cannot produce one**.
 *
 * This is a discriminated result rather than four numbers because the control
 * has two outcomes and both are the argument. On the DIN 4× the telescope's
 * solve *succeeds* and delivers a gap that leaves the observer tens of diopters
 * to supply; on the 100×/1.40 oil it refuses outright, because the spacing it
 * wants is **negative** — the objective's own focal length is short enough that
 * a collimated-in solve asks for the eyepiece to sit behind its own front
 * vertex. Letting that refusal propagate would be a bug rather than honesty: it
 * is the control failing, not the instrument, and the instrument beside it is
 * perfectly well composed. So it is caught here and reported in its own line.
 */
export type TelescopeControl =
  | {
      readonly ok: true;
      readonly gapMm: number;
      /** Solved gap → telescope gap (mm). Negative: the telescope's is short. */
      readonly gapErrorMm: number;
      readonly diopters: number;
      /** Where that beam crosses the axis (mm past the eye lens). */
      readonly crossingMm: number;
    }
  | { readonly ok: false; readonly reason: string };

export interface InstrumentReadout {
  /** Microscope's last vertex → eyepiece's first vertex (mm), solved on the trace. */
  readonly gapMm: number;
  /** The closed form it lands on: image distance + the eyepiece's front focal distance. */
  readonly gapFromFrontFocalDistanceMm: number;
  readonly eyepieceFrontFocalDistanceMm: number;
  readonly eyepieceFocalLengthMm: number;
  readonly intermediateImageDistanceMm: number;

  /** The exit beam's vergence at the solved gap — zero for a relaxed eye. */
  readonly vergenceDiopters: number;
  /** § 6q.3's negative control, recomputed for THIS instrument. */
  readonly telescope: TelescopeControl;

  /** The traced chief ray's answer, signed — a microscope inverts. */
  readonly visualMagnification: number;
  /** M_obj × (D/f_e), the two engravings multiplied. Unsigned. */
  readonly nominalVisualMagnification: number;

  /** n·sin u off the real marginal ray — what the objective is engraved with. */
  readonly naEngraved: number;
  /** n·u off the entrance pupil's geometry — the slope the invariant is a law about. */
  readonly naParaxial: number;
  /** Their ratio, exactly sec u where the stop sits on the specimen side. */
  readonly secU: number;

  /** The stop imaged paraxially through the eyepiece (mm, diameter). */
  readonly exitPupilDiameterMm: number;
  /** D·NA_paraxial/|M| — the invariant in its own NA. */
  readonly lagrangeParaxialMm: number;
  /** D·NA_engraved/|M| — the textbook 500·NA/M with D = 250. */
  readonly lagrangeEngravedMm: number;
  /** How far the textbook form lands from the pupil imaging, signed. */
  readonly engravedMiss: number;
  readonly eyeReliefMm: number;

  readonly eyePupilMm: number;
  /** min(exit pupil, iris) — the p in `visualDetailRatio`. */
  readonly workingPupilMm: number;
  /** Which of the two won, from `limiting` stop selection rather than from the min. */
  readonly irisLimited: boolean;
  /** |M|·p/(2·NA·D): below 1 the eye is the bottleneck, above it nothing moves. */
  readonly detailRatio: number;
  /** 500·NA to 1000·NA, produced from the two exit-pupil conventions. */
  readonly usefulMagnification: { readonly min: number; readonly max: number };

  readonly fieldNumberMm: number | null;
  /** FN/M_obj — the specimen circle, which is what a field of view actually is. */
  readonly objectFieldDiameterMm: number | null;
  readonly apparentFieldOfViewDeg: number | null;

  /** Vergence against a placement error, and the band the quarter diopter allows. */
  readonly gapCurve: readonly GapPoint[];
  readonly bandPlusMm: number;
  readonly bandMinusMm: number;
  /**
   * Where the vergence changes sign through a pole (mm of displacement), bisected.
   *
   * Reported as a measurement with **no mechanism attributed**: it is where the
   * axial exit ray's *height* passes through zero, which is not the same event as
   * the eyepiece's front focus crossing the intermediate image — at Δ = −FFD the
   * vergence is a large but finite number. `null` when no flip is found in the
   * window. Past it the vergence is on the far branch, which is where § 6q.3's
   * telescope gap lives.
   */
  readonly poleDeltaMm: number | null;

  readonly elapsedMs: number;
}

export type InstrumentResult = { readonly ok: true; readonly readout: InstrumentReadout } | Refusal;

/** The chain the eyepiece goes behind — any spec, catalogue row or not (Part F). */
function microscopeOf(spec: BuildSpec): ImageFormingMicroscope {
  return buildMicroscope(spec).chain;
}

/**
 * The same two modules at a *different* separation, as a system.
 *
 * Used for the negative control and for the placement band alike, so the wrong
 * gap and the telescope's gap go through one code path and cannot disagree about
 * anything but the number. The field stop is deliberately absent: this measures
 * the aperture beam's vergence, and § 6q.8 pins that a field stop does not touch
 * it.
 */
function atGap(
  microscope: ImageFormingMicroscope,
  eyepiece: Prescription,
  base: OpticalSystem,
  gapMm: number,
): OpticalSystem {
  const spliced = spliceModules(
    [
      { surfaces: microscope.prescription.surfaces, gapAfterMm: gapMm },
      { surfaces: eyepiece.surfaces, gapAfterMm: 0 },
    ],
    microscope.prescription.objectMedium ?? "AIR",
  );
  return {
    ...base,
    prescription: {
      ...spliced,
      surfaces: spliced.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
    },
  };
}

/**
 * Half-width of the placement window the curve is drawn over.
 *
 * Three times the quarter-diopter band the thin-lens form predicts, so the band
 * fills a third of the frame at every focal length rather than the plot being
 * empty at f_e = 10 and clipped at 40. The floor keeps the shortest eyepieces
 * from asking the canvas for a window narrower than the axis labels.
 */
const bandWindow = (focalLengthMm: number): number =>
  Math.max(0.1, (3 * NOTICEABLE_DIOPTERS * focalLengthMm ** 2) / 1000);

const GAP_POINTS = 41;

/**
 * The whole instrument, or the reason there is not one — ~8 ms, main thread.
 *
 * Cheap enough to sit under a live slider because § 6q's composition is one
 * affine solve; the bill is the eyepiece's own secant solve (~7.5 ms for a
 * Plössl, ~0.1 ms for a Huygens) and the objective's, which the caller memoizes.
 */
export function describeInstrument(request: InstrumentRequest): InstrumentResult {
  const started = performance.now();
  const { form, eyepieceFocalLengthMm: fe, fieldNumberMm, nearPointMm } = request;

  let microscope: ImageFormingMicroscope;
  try {
    microscope = microscopeOf(request.spec);
  } catch (cause) {
    return refusal(cause, "objective");
  }

  let eyepiece: Prescription;
  try {
    eyepiece = buildEyepiece(form, fe, fieldNumberMm ?? defaultClearAperture(form, fe));
  } catch (cause) {
    return refusal(cause, "eyepiece");
  }

  try {
    const visual = visualMicroscope({
      microscope,
      eyepiece,
      wavelengthNm: LAMBDA_NM,
      nearPointMm,
      ...(fieldNumberMm === null ? {} : { fieldNumberMm }),
    });
    const eyed = visualMicroscopeSystem({
      visual,
      eye: { pupilDiameterMm: request.eyePupilMm },
      wavelengthNm: LAMBDA_NM,
    });

    const pupil = pupils(visual.system, LAMBDA_NM);
    const stopRadius = pupil.stopRadius;
    const magnification = visualMagnification(
      visual.system,
      PROBE_HEIGHT_MM,
      LAMBDA_NM,
      nearPointMm,
    );
    const naEngraved = objectNumericalAperture(visual.system, LAMBDA_NM);
    const naParaxial = paraxialObjectNumericalAperture(visual.system, LAMBDA_NM);
    const exitPupilDiameterMm = 2 * pupil.exit.radius;
    const lagrangeParaxialMm = 2 * lagrangeExitPupilRadiusMm(naParaxial, nearPointMm, magnification);
    const lagrangeEngravedMm = 2 * lagrangeExitPupilRadiusMm(naEngraved, nearPointMm, magnification);

    // The placement geometry runs on the SAME modules at other separations. It
    // needs no field stop (§ 6q.8) and no eyepiece rebuild, so all of it —
    // 41 curve points, two bisections and a pole — is well under a millisecond.
    const vergenceAt = (deltaMm: number): number =>
      exitVergenceDiopters(
        atGap(microscope, eyepiece, visual.system, visual.gapMm + deltaMm),
        LAMBDA_NM,
        stopRadius,
      );

    const window = bandWindow(fe);
    const gapCurve: GapPoint[] = [];
    for (let i = 0; i < GAP_POINTS; i++) {
      const deltaMm = -window + (2 * window * i) / (GAP_POINTS - 1);
      gapCurve.push({
        deltaMm,
        diopters: vergenceAt(deltaMm),
        newtonDiopters: (1000 * deltaMm) / (visual.eyepieceFocalLengthMm ** 2),
      });
    }

    // The control gets its own guard. It is the one computation here that can
    // fail while the instrument is fine, and conflating the two would report a
    // working microscope as a broken one.
    let telescope: TelescopeControl;
    try {
      const wrong = afocalTelescope({
        objective: microscope.prescription,
        eyepiece,
        wavelengthNm: LAMBDA_NM,
      });
      const diopters = vergenceAt(wrong.gapMm - visual.gapMm);
      telescope = {
        ok: true,
        gapMm: wrong.gapMm,
        gapErrorMm: wrong.gapMm - visual.gapMm,
        diopters,
        crossingMm: 1000 / diopters,
      };
    } catch (cause) {
      telescope = { ok: false, reason: (cause as Error).message };
    }

    return {
      ok: true,
      readout: {
        gapMm: visual.gapMm,
        gapFromFrontFocalDistanceMm: visual.gapFromFrontFocalDistanceMm,
        eyepieceFrontFocalDistanceMm: visual.eyepieceFrontFocalDistanceMm,
        eyepieceFocalLengthMm: visual.eyepieceFocalLengthMm,
        intermediateImageDistanceMm: visual.intermediateImageDistanceMm,

        vergenceDiopters: vergenceAt(0),
        telescope,

        visualMagnification: magnification,
        nominalVisualMagnification: visual.nominalVisualMagnification,

        naEngraved,
        naParaxial,
        secU: naParaxial / naEngraved,

        exitPupilDiameterMm,
        lagrangeParaxialMm,
        lagrangeEngravedMm,
        engravedMiss: lagrangeEngravedMm / exitPupilDiameterMm - 1,
        eyeReliefMm: eyed.eyeReliefMm,

        eyePupilMm: eyed.eyePupilDiameterMm,
        workingPupilMm: eyed.workingPupilDiameterMm,
        irisLimited: eyed.irisLimited,
        detailRatio: visualDetailRatio(
          magnification,
          naParaxial,
          nearPointMm,
          eyed.workingPupilDiameterMm,
        ),
        usefulMagnification: usefulMagnificationRange(
          naEngraved,
          nearPointMm,
          MIN_USEFUL_EXIT_PUPIL_MM,
          MAX_USEFUL_EXIT_PUPIL_MM,
        ),

        fieldNumberMm: fieldNumberMm,
        objectFieldDiameterMm: visual.objectFieldDiameterMm ?? null,
        apparentFieldOfViewDeg: visual.apparentFieldOfViewDeg ?? null,

        gapCurve,
        bandPlusMm: bisectBand(vergenceAt, 1, window),
        bandMinusMm: bisectBand(vergenceAt, -1, window),
        poleDeltaMm: bisectPole(vergenceAt),

        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return refusal(cause, "composition");
  }
}

/**
 * How far the eyepiece may sit from its solved position before the exit beam
 * asks for a quarter diopter — bisected, not derived.
 *
 * The search widens from the drawn window rather than assuming it: at f_e = 40
 * the band is wider than a plot that also has to show f_e = 10. The tolerance is
 * **relative**, which matters more than it looks: the starting bracket is a
 * function of f_e, so an absolute one would leave each focal length a different
 * fraction of its own band, and the panel's own claim is a comparison *across*
 * focal lengths. Measured, an absolute 1e-7 and a relative 1e-13 agree to 1e-5
 * — but that is a thing to have checked rather than assumed, since it is what
 * decides whether the drift below is physics.
 */
function bisectBand(
  vergenceAt: (deltaMm: number) => number,
  sign: 1 | -1,
  window: number,
): number {
  let ok = 0;
  let bad = sign * Math.max(4 * window, 1);
  if (Math.abs(vergenceAt(bad)) < NOTICEABLE_DIOPTERS) return bad;
  for (let i = 0; i < 80 && Math.abs(bad - ok) > 1e-12 * Math.abs(bad); i++) {
    const mid = (ok + bad) / 2;
    if (Math.abs(vergenceAt(mid)) < NOTICEABLE_DIOPTERS) ok = mid;
    else bad = mid;
  }
  return ok;
}

/**
 * Displacement where the vergence changes sign through a pole. See the field's
 * doc for what it is and — deliberately — what it is not.
 *
 * The scan looks for a change from **whatever sign it starts on** rather than
 * for a negative→positive crossing. A crossing test would report `null` on any
 * instrument whose vergence is already positive one millimetre in, and the panel
 * renders `null` as "no sign flip was found within 400 mm" — a sentence that
 * reads as a statement about the optics when it would in fact be a search that
 * began on the wrong branch. Every configuration these controls can reach starts
 * negative and does find its flip; the generality is so that stays true of the
 * next control someone adds rather than by luck of the current ones.
 */
function bisectPole(vergenceAt: (deltaMm: number) => number): number | null {
  const start = -1;
  const startSign = Math.sign(vergenceAt(start));
  let before = start;
  let after = 0;
  for (let d = -2; d >= -400; d -= 1) {
    if (Math.sign(vergenceAt(d)) !== startSign) {
      before = d + 1;
      after = d;
      break;
    }
  }
  if (after === 0) return null;
  for (let i = 0; i < 80 && Math.abs(before - after) > 1e-9; i++) {
    const mid = (before + after) / 2;
    if (Math.sign(vergenceAt(mid)) === startSign) before = mid;
    else after = mid;
  }
  return (before + after) / 2;
}

/* ── the focal-length sweep: 21 eyepiece solves, so a worker ────────────── */

export interface SweepRequest {
  readonly spec: BuildSpec;
  readonly form: EyepieceForm;
  readonly nearPointMm: number;
  readonly minFocalLengthMm: number;
  readonly maxFocalLengthMm: number;
  readonly points: number;
}

export interface SweepPoint {
  readonly focalLengthMm: number;
  /** |M| from the traced chief ray. */
  readonly magnification: number;
  readonly exitPupilDiameterMm: number;
  readonly lagrangeParaxialMm: number;
  readonly lagrangeEngravedMm: number;
  readonly eyeReliefMm: number;
  readonly naParaxial: number;
  readonly naEngraved: number;
}

export interface Sweep {
  readonly points: readonly SweepPoint[];
  readonly elapsedMs: number;
}

/**
 * Exit pupil, magnification and eye relief across the eyepiece's focal length —
 * and **nothing about the eye**.
 *
 * That omission is the scheduling. Empty magnification is a statement about
 * min(exit pupil, iris), so a sweep that took the eye pupil would re-run 21
 * eyepiece solves every time the iris slider moved; leaving it out means the
 * crossover moves live under the slider and the sweep is keyed on the optics
 * alone. `workingPupilDiameterMm` is literally that minimum (`pupil/visual`), so
 * the panel is not re-deriving anything the engine hides.
 */
export function sweepFocalLengths(request: SweepRequest): Sweep {
  const started = performance.now();
  // A spec that does not build has no curve at all, and since Part F it can be
  // one a reader typed rather than one of ten that were checked. An uncaught
  // throw here is a worker that dies silently, which is the single failure a
  // panel cannot report — `describeInstrument` runs on the main thread and is
  // what prints the objective's own refusal.
  let microscope: ImageFormingMicroscope;
  try {
    microscope = microscopeOf(request.spec);
  } catch {
    return { points: [], elapsedMs: performance.now() - started };
  }
  const span = request.maxFocalLengthMm - request.minFocalLengthMm;
  const points: SweepPoint[] = [];
  for (let i = 0; i < request.points; i++) {
    const focalLengthMm = request.minFocalLengthMm + (span * i) / (request.points - 1);
    try {
      const visual = visualMicroscope({
        microscope,
        eyepiece: buildEyepiece(
          request.form,
          focalLengthMm,
          defaultClearAperture(request.form, focalLengthMm),
        ),
        wavelengthNm: LAMBDA_NM,
        nearPointMm: request.nearPointMm,
      });
      const magnification = visualMagnification(
        visual.system,
        PROBE_HEIGHT_MM,
        LAMBDA_NM,
        request.nearPointMm,
      );
      const pupil = pupils(visual.system, LAMBDA_NM);
      const naParaxial = paraxialObjectNumericalAperture(visual.system, LAMBDA_NM);
      const naEngraved = objectNumericalAperture(visual.system, LAMBDA_NM);
      points.push({
        focalLengthMm,
        magnification: Math.abs(magnification),
        exitPupilDiameterMm: 2 * pupil.exit.radius,
        lagrangeParaxialMm:
          2 * lagrangeExitPupilRadiusMm(naParaxial, request.nearPointMm, magnification),
        lagrangeEngravedMm:
          2 * lagrangeExitPupilRadiusMm(naEngraved, request.nearPointMm, magnification),
        // The engine's own quantity rather than this file's arithmetic on the
        // same pupil: `microscopeVisualProperties` is where "eye relief is the
        // exit pupil's distance from the eye lens" is stated, and § 6q.5 pins it
        // there. Re-deriving it here would put a second definition in the app.
        eyeReliefMm: microscopeVisualProperties(visual, LAMBDA_NM).eyeReliefMm,
        naParaxial,
        naEngraved,
      });
    } catch {
      // A focal length this form cannot build is a gap in the curve, not a zero.
      // The panel draws what is here; `describeInstrument` is what says why.
    }
  }
  return { points, elapsedMs: performance.now() - started };
}

/* ── the clear-aperture wall: a bisection over the same solve ───────────── */

export interface WallRequest {
  readonly form: EyepieceForm;
  readonly focalLengthMm: number;
}

export interface Wall {
  /** The widest clear aperture the form admits (mm), or `null` if none was found. */
  readonly clearApertureMm: number | null;
  /** That, over the focal length — the quantity § 6q.9 states as "about 0.88". */
  readonly perFocalLength: number | null;
  /** How far the bisection was taken (mm). */
  readonly bracketMm: number;
  /** Where the search gave up looking, so `null` means "not below this". */
  readonly searchedToPerFocalLength: number;
  readonly elapsedMs: number;
}

const WALL_SEARCH_CEILING = 1.5;

/**
 * Bisect for the widest glass the form admits at this focal length.
 *
 * A6's move on § 6e.4's NA ceiling, applied to § 6q.9's aperture one: the ladder
 * states a **bracket** (22 mm builds at f_e = 25, 24 mm does not, hence "about
 * 0.88·f_e"), and asking the constructor where it actually stops turns that into
 * an observation with no constant typed into an app.
 *
 * ~14 eyepiece solves, so ~100 ms for a Plössl and ~2 ms for a Huygens — which
 * is why it is a worker and why it is keyed on the focal-length slider.
 */
export function measureWall(request: WallRequest): Wall {
  const started = performance.now();
  const fe = request.focalLengthMm;
  const builds = (clearApertureMm: number): boolean => {
    try {
      buildEyepiece(request.form, fe, clearApertureMm);
      return true;
    } catch {
      return false;
    }
  };
  let lo = 0.05 * fe;
  let hi = WALL_SEARCH_CEILING * fe;
  if (builds(hi)) {
    return {
      clearApertureMm: null,
      perFocalLength: null,
      bracketMm: 0,
      searchedToPerFocalLength: WALL_SEARCH_CEILING,
      elapsedMs: performance.now() - started,
    };
  }
  if (!builds(lo)) {
    return {
      clearApertureMm: null,
      perFocalLength: null,
      bracketMm: 0,
      searchedToPerFocalLength: 0.05,
      elapsedMs: performance.now() - started,
    };
  }
  for (let i = 0; i < 24 && hi - lo > 1e-5 * fe; i++) {
    const mid = (lo + hi) / 2;
    if (builds(mid)) lo = mid;
    else hi = mid;
  }
  return {
    clearApertureMm: lo,
    perFocalLength: lo / fe,
    bracketMm: hi - lo,
    searchedToPerFocalLength: WALL_SEARCH_CEILING,
    elapsedMs: performance.now() - started,
  };
}

/** The near point the app quotes against unless a reader moves it. */
export const DEFAULT_NEAR_POINT_MM = NEAR_POINT_MM;

export interface SweepJob {
  readonly seq: number;
  readonly request: SweepRequest;
}
export interface SweepDone {
  readonly seq: number;
  readonly result: Sweep;
}
export interface WallJob {
  readonly seq: number;
  readonly request: WallRequest;
}
export interface WallDone {
  readonly seq: number;
  readonly result: Wall;
}
