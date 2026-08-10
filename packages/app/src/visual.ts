import {
  achromaticObjective,
  cassegrain,
  newtonian,
  reducedEye,
} from "@telemicroscope/core/designs";
import { afocalTelescope } from "@telemicroscope/core/trace";
import type { Prescription } from "@telemicroscope/core/trace";
import {
  afocalProperties,
  apparentFieldAngleRad,
  visualSystem,
} from "@telemicroscope/core/pupil";
import { psf } from "@telemicroscope/core/wave";
import { bestFocus } from "@telemicroscope/core/analysis";
import { buildEyepiece, type EyepieceForm } from "./eyepiece";
import { refusalOf, type Refusal as SharedRefusal } from "./refusal";

/**
 * Visual mode on the telescope side — APP.md's C5, as pure functions.
 *
 * `render.ts`'s commitment kept for the ninth time: numbers in, numbers out, no
 * DOM and no React. Everything here is § 5l's composition, § 5m/§ 5o's computed
 * eyepieces, § 5n's real-ray afocal trace, § 5p's limiting-stop selection and
 * § 5q's reduced eye, called from the app. **One engine defect was fixed for it**
 * (§ 5l.1), which follows A6's and C4's precedent exactly; nothing else here is
 * new capability, so no rung was added for the panel itself.
 *
 * ## What D6 is, and why this is not it
 *
 * `eyepiece.ts` is the same three parts on the other conjugate, and the split is
 * § 6q's whole argument: a microscope eyepiece collimates a real intermediate
 * image a finite distance in front of it, so `afocalTelescope`'s gap — solved
 * from a ray entering *collimated* — is the wrong number there and the right one
 * here. So this module calls `visualSystem` where D6 calls
 * `visualMicroscopeSystem`, and it carries **no near point at all**: a
 * telescope's angular magnification is a ratio of angles, and 250 mm is a
 * convention about how close a human holds a slide.
 *
 * ## Which objectives are offered, and the one that is not
 *
 * Two lenses and one mirror system, and the mirror is here as a **control**
 * rather than for variety: a classical Cassegrain is exactly stigmatic on axis
 * (§ 5e), so a residual measured through one belongs to the eyepiece and the eye
 * — which is what makes the accommodation split below a measurement instead of
 * an assertion. The **Newtonian is absent, and that is the finding it produced**:
 * it is the repo's only `folded` prescription, the splice is on-axis, and before
 * § 5l.1 the pair composed *silently* at a 1405 mm gap where the geometry has
 * 131. It now refuses, in the engine's own words, and this module does not
 * offer a control that cannot work.
 *
 * ## Cost, measured rather than predicted
 *
 * The instrument is **cheap and lives on the main thread**: an achromat is
 * ~1.5 ms, a Cassegrain is closed-form arithmetic, a Plössl is ~10 ms of secant
 * solve (a Huygens ~0.05 ms), and everything downstream — the afocal solve, the
 * pupil imaging, the field wall's ~50 chief rays, the distortion curve, the
 * aperture-collapse curve — is under a millisecond together. Two things are not,
 * and both go to workers: the **retinal PSF** (150–470 ms of trace + FFT through
 * a ten-surface chain) with its **focus solve** (~100–230 ms), and the
 * **aperture ceiling**, which is a bisection over ~14 eyepiece *builds*.
 * That is D6's split arriving unchanged for the second time — sweeps of builds
 * are worker work, sweeps of rays are not.
 */

/* ------------------------------------------------------------------ *
 * The instrument
 * ------------------------------------------------------------------ */

export const OBJECTIVE_KINDS = ["achromat", "ed", "cassegrain"] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

export const OBJECTIVE_LABELS: Record<ObjectiveKind, string> = {
  achromat: "achromat (N-BK7/F2)",
  ed: "ED doublet (CaF₂/N-BK7)",
  cassegrain: "Cassegrain (two mirrors)",
};

/**
 * What each objective is here for, in the ladder's terms. The Cassegrain's line
 * is the load-bearing one: it is the on-axis control.
 */
export const OBJECTIVE_NOTES: Record<ObjectiveKind, string> = {
  achromat: "§ 5j — SA nulled to third order, F and C united; a fifth-order residual survives",
  ed: "§ 5k — the same solve on fluorite; the gain is anomalous partial dispersion",
  cassegrain: "§ 5e — confocal conics, EXACTLY stigmatic on axis: the zero-SA control",
};

/** The Cassegrain's secondary magnification, so one focal-ratio slider drives all three. */
export const CASSEGRAIN_SECONDARY_MAGNIFICATION = 2.5;

export const LAMBDA_NM = 550;

/** The quarter diopter an observer is taken to notice — D6's constant, reused. */
export const NOTICEABLE_DIOPTERS = 0.25;

export type RefusalStage = "objective" | "eyepiece" | "composition" | "eye";
export type Refusal = SharedRefusal<RefusalStage>;

export interface VisualSpec {
  readonly objective: ObjectiveKind;
  readonly apertureMm: number;
  readonly focalRatio: number;
  readonly form: EyepieceForm;
  readonly eyepieceFocalLengthMm: number;
  readonly eyePupilMm: number;
}

/** The objective, or the engine's refusal. Closed-form for the mirror, solved for the lenses. */
export function buildObjective(
  kind: ObjectiveKind,
  apertureMm: number,
  focalRatio: number,
): { prescription: Prescription; focalLengthMm: number; obstruction: number } {
  if (kind === "cassegrain") {
    const c = cassegrain({
      apertureMm,
      focalRatio,
      primaryFocalRatio: focalRatio / CASSEGRAIN_SECONDARY_MAGNIFICATION,
    });
    return { prescription: c.prescription, focalLengthMm: c.focalLengthMm, obstruction: c.obstruction };
  }
  const glasses =
    kind === "ed"
      ? { crownMedium: "CAF2", flintMedium: "N-BK7" }
      : { crownMedium: "N-BK7", flintMedium: "F2" };
  const o = achromaticObjective({ apertureMm, focalRatio, ...glasses });
  return { prescription: o.prescription, focalLengthMm: o.paraxialFocalLengthMm, obstruction: 0 };
}

/**
 * The Newtonian, kept as a live refusal rather than as a sentence.
 *
 * C1's convention, one part further: a row that cannot exist prints the engine's
 * own words. Here the row could not exist *and did not say so* until § 5l.1, so
 * the panel re-runs the composition every render and shows whatever comes back.
 * If a future step composes folded modules, this cell starts working and nobody
 * has to remember to delete a paragraph.
 */
export function newtonianRefusal(apertureMm: number, focalRatio: number, eyepiece: Prescription): string | null {
  try {
    afocalTelescope({
      objective: newtonian({ apertureMm, focalRatio }).prescription,
      eyepiece,
      wavelengthNm: LAMBDA_NM,
    });
    return null;
  } catch (cause) {
    return (cause as Error).message;
  }
}

/** One point on the pincushion curve. */
export interface DistortionPoint {
  readonly fieldDeg: number;
  /** The real chief ray's exit angle (deg, unsigned). */
  readonly apparentDeg: number;
  /** |M|·θ — what a first-order trace would say. */
  readonly linearDeg: number;
  /** apparentDeg/linearDeg − 1: the O(θ³) departure, as a fraction. */
  readonly departure: number;
}

/** One point on the two-stop collapse curve. */
export interface AperturePoint {
  readonly eyePupilMm: number;
  /** What the trace's entrance pupil says reaches the retina (mm). */
  readonly effectiveApertureMm: number;
  /** min(D, d_eye·|M|) — § 5q's closed form, drawn beside it. */
  readonly closedFormMm: number;
  readonly irisLimited: boolean;
}

export interface VisualReadout {
  readonly objectiveFocalLengthMm: number;
  /** Fraction of the pupil RADIUS the secondary blocks; 0 for the refractors. */
  readonly obstruction: number;

  /** Angular magnification from the beam compression of one parallel ray, signed. */
  readonly magnification: number;
  /** −f_o/f_e from two separate `systemProperties` calls — the second route. */
  readonly nominalMagnification: number;
  /** How far apart the two routes land, signed and relative. */
  readonly magnificationMiss: number;

  /** The stop imaged through the eyepiece (mm, diameter) — the pupil machinery's answer. */
  readonly exitPupilDiameterMm: number;
  /** EPD/|M| — the same number by the magnification route. */
  readonly exitPupilFromMagnificationMm: number;
  readonly exitPupilMiss: number;
  readonly eyeReliefMm: number;

  readonly eyePupilMm: number;
  /**
   * What actually reaches the retina (mm), off the entrance pupil under
   * `limiting` stop selection — so the collapse emerges rather than being
   * min()-ed by this file.
   */
  readonly effectiveApertureMm: number;
  readonly irisLimited: boolean;
  /**
   * The eye pupil at which the iris takes over — which IS the exit pupil, and
   * equivalently |M| = D/d_eye. Printed so the reader can find the knee the
   * slider walks through.
   */
  readonly irisKneeMm: number;

  /**
   * Widest object-space half-field whose chief ray still clears the eyepiece
   * (deg), bisected against `apparentFieldAngleRad`'s own refusal.
   */
  readonly fieldWallDeg: number;
  /**
   * atan(r_e/f_o) — where the chief ray would reach the FRONT rim, which is the
   * field stop only if nothing behind it clips first.
   */
  readonly fieldWallClosedFormDeg: number;
  /** Apparent field of view at the wall (deg, full angle) — what the observer sees. */
  readonly apparentFieldOfViewDeg: number;
  /** 2·atan(r_e/f_e): the catalogue formula, which has no trace in it. */
  readonly geometricFieldOfViewDeg: number;
  /**
   * Signed departure of the traced apparent field from the catalogue formula.
   *
   * It is **only** distortion when the front rim is the real field stop — read
   * `frontRimIsFieldStop` before reading this. A Plössl's front rim is the stop
   * and the departure is +17 to +25%, the pincushion evaluated at the edge; a
   * Huygens's is not, and the same number reads −35% because the formula is
   * being applied to a surface that is not doing the stopping.
   */
  readonly fieldInflation: number;
  /**
   * Whether the chief ray dies at the eyepiece's FIRST surface — i.e. whether
   * the field stop is the front rim the catalogue formula assumes.
   *
   * Nothing reports which surface clipped, so this is inferred from the two
   * numbers the panel already has: the bisected wall against atan(r_e/f_o).
   * Its `FRONT_RIM_FRACTION` threshold sits in a wide empty gap rather than on
   * an edge — every Plössl measured lands 0.94–0.99, every Huygens 0.61–0.78 —
   * so it is a classifier, not a tuning.
   */
  readonly frontRimIsFieldStop: boolean;
  /** The eyepiece's clear semi-aperture (mm) — its front rim. */
  readonly eyepieceClearSemiApertureMm: number;

  readonly distortionCurve: readonly DistortionPoint[];
  readonly apertureCurve: readonly AperturePoint[];

  /** The Newtonian's live refusal text, or `null` if it ever stops refusing. */
  readonly foldedObjectiveRefusal: string | null;

  readonly elapsedMs: number;
}

export type VisualResult = { readonly ok: true; readonly readout: VisualReadout } | Refusal;

/** The default glass a form gets: D6's constants, so the two surfaces agree. */
const defaultClearAperture = (form: EyepieceForm, focalLengthMm: number): number =>
  form === "plossl" ? 0.86 * focalLengthMm : 0.8 * focalLengthMm;

const DEG = 180 / Math.PI;
/**
 * How close to atan(r_e/f_o) the wall must land for the front rim to be the
 * thing that stopped the chief ray. See `frontRimIsFieldStop` for why 0.9 is a
 * gap rather than an edge.
 */
export const FRONT_RIM_FRACTION = 0.9;
const DISTORTION_POINTS = 25;
const APERTURE_POINTS = 41;

/** The eye-pupil range the collapse curve is drawn over — scotopic to photopic. */
export const EYE_PUPIL_MIN_MM = 0.8;
export const EYE_PUPIL_MAX_MM = 7.5;

/**
 * The whole instrument, or the reason there is not one — ~12 ms, main thread.
 *
 * The bill is one eyepiece solve and one objective solve; everything else is
 * first-order work and real chief rays, which are microseconds each.
 */
export function describeVisual(spec: VisualSpec): VisualResult {
  const started = performance.now();
  const { apertureMm: D, form, eyepieceFocalLengthMm: fe } = spec;

  let objective: ReturnType<typeof buildObjective>;
  try {
    objective = buildObjective(spec.objective, D, spec.focalRatio);
  } catch (cause) {
    return refusalOf(cause, "objective");
  }

  let eyepiece: Prescription;
  try {
    eyepiece = buildEyepiece(form, fe, defaultClearAperture(form, fe));
  } catch (cause) {
    return refusalOf(cause, "eyepiece");
  }

  try {
    const telescope = afocalTelescope({
      objective: objective.prescription,
      eyepiece,
      wavelengthNm: LAMBDA_NM,
    });
    const props = afocalProperties(telescope, LAMBDA_NM, D / 2);
    const magnification = props.magnification;
    const nominalMagnification = -telescope.objectiveEflMm / telescope.eyepieceEflMm;

    const eyed = visualSystem({
      objective: objective.prescription,
      eyepiece,
      apertureRadiusMm: D / 2,
      eye: { pupilDiameterMm: spec.eyePupilMm },
      wavelengthNm: LAMBDA_NM,
    });

    const exitPupilDiameterMm = 2 * props.exitPupilRadiusMm;
    const exitPupilFromMagnificationMm = D / Math.abs(magnification);

    // The field wall, and the apparent field it buys. ~50 chief rays.
    const fieldWallDeg = bisectFieldWall(telescope, D / 2);
    const apparentHalfDeg = Math.abs(
      apparentFieldAngleRad(telescope, fieldWallDeg * WALL_INSET, LAMBDA_NM, D / 2) * DEG,
    );
    const rE = eyepiece.surfaces[0]!.semiAperture;
    const fieldWallClosedFormDeg = DEG * Math.atan(rE / objective.focalLengthMm);
    const geometricFieldOfViewDeg = 2 * DEG * Math.atan(rE / fe);

    // The distortion curve stops short of the wall, because the last chief ray
    // before a refusal is the one whose beam is most clipped and least worth
    // drawing — the same reason § 5n asserts well inside the limit.
    const distortionCurve: DistortionPoint[] = [];
    for (let i = 1; i <= DISTORTION_POINTS; i++) {
      const fieldDeg = (fieldWallDeg * WALL_INSET * i) / DISTORTION_POINTS;
      try {
        const apparentDeg = Math.abs(apparentFieldAngleRad(telescope, fieldDeg, LAMBDA_NM, D / 2) * DEG);
        const linearDeg = Math.abs(magnification) * fieldDeg;
        distortionCurve.push({ fieldDeg, apparentDeg, linearDeg, departure: apparentDeg / linearDeg - 1 });
      } catch {
        // A field this chain refuses is a gap in the curve, not a zero.
      }
    }

    // The collapse curve. One `visualSystem` per point is ~0.2 ms, and it is the
    // trace's own entrance pupil at each — never this file taking a minimum.
    const apertureCurve: AperturePoint[] = [];
    for (let i = 0; i < APERTURE_POINTS; i++) {
      const eyePupilMm =
        EYE_PUPIL_MIN_MM + ((EYE_PUPIL_MAX_MM - EYE_PUPIL_MIN_MM) * i) / (APERTURE_POINTS - 1);
      const v = visualSystem({
        objective: objective.prescription,
        eyepiece,
        apertureRadiusMm: D / 2,
        eye: { pupilDiameterMm: eyePupilMm },
        wavelengthNm: LAMBDA_NM,
      });
      apertureCurve.push({
        eyePupilMm,
        effectiveApertureMm: v.effectiveApertureMm,
        closedFormMm: Math.min(D, eyePupilMm * Math.abs(magnification)),
        irisLimited: v.irisLimited,
      });
    }

    return {
      ok: true,
      readout: {
        objectiveFocalLengthMm: objective.focalLengthMm,
        obstruction: objective.obstruction,

        magnification,
        nominalMagnification,
        magnificationMiss: magnification / nominalMagnification - 1,

        exitPupilDiameterMm,
        exitPupilFromMagnificationMm,
        exitPupilMiss: exitPupilDiameterMm / exitPupilFromMagnificationMm - 1,
        eyeReliefMm: props.eyeReliefMm,

        eyePupilMm: eyed.eyePupilDiameterMm,
        effectiveApertureMm: eyed.effectiveApertureMm,
        irisLimited: eyed.irisLimited,
        irisKneeMm: exitPupilDiameterMm,

        fieldWallDeg,
        fieldWallClosedFormDeg,
        apparentFieldOfViewDeg: 2 * apparentHalfDeg,
        geometricFieldOfViewDeg,
        fieldInflation: (2 * apparentHalfDeg) / geometricFieldOfViewDeg - 1,
        frontRimIsFieldStop: fieldWallDeg / fieldWallClosedFormDeg > FRONT_RIM_FRACTION,
        eyepieceClearSemiApertureMm: rE,

        distortionCurve,
        apertureCurve,

        foldedObjectiveRefusal: newtonianRefusal(D, spec.focalRatio, eyepiece),

        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return refusalOf(cause, "composition");
  }
}

/**
 * How close to the wall the readouts are taken.
 *
 * Not 1: the bisection's `ok` side is a field that passed, but the *next* f64
 * step past it is a field that did not, and a chief ray one ulp inside a
 * vignetting boundary is grazing the rim. A thousandth in is far enough to be
 * an ordinary ray and near enough that the apparent angle is the edge's — the
 * two differ in the fifth digit.
 */
const WALL_INSET = 0.999;

/**
 * Widest object-space field whose chief ray still clears the optics, bisected
 * against the engine's own refusal.
 *
 * § 5n names this as deferred — "real AFOV *edge* (where the field stop cuts the
 * beam)" — and it is deferred as a *measurement*, not as a capability: the
 * refusal exists and is loud, so the app only has to ask where it starts. Same
 * move A6 made on § 6e.4's NA ceiling and D6 on § 6q.9's aperture, and it needs
 * no constant typed into an app.
 */
export function bisectFieldWall(
  telescope: Parameters<typeof apparentFieldAngleRad>[0],
  apertureRadiusMm: number,
): number {
  const passes = (fieldDeg: number): boolean => {
    try {
      apparentFieldAngleRad(telescope, fieldDeg, LAMBDA_NM, apertureRadiusMm);
      return true;
    } catch {
      return false;
    }
  };
  let ok = 0;
  let bad = WALL_SEARCH_CEILING_DEG;
  if (passes(bad)) return bad;
  for (let i = 0; i < 60 && bad - ok > 1e-9 * Math.max(bad, 1e-3); i++) {
    const mid = (ok + bad) / 2;
    if (passes(mid)) ok = mid;
    else bad = mid;
  }
  return ok;
}

/** No eyepiece in this library reaches 5° of object-space field on any objective here. */
const WALL_SEARCH_CEILING_DEG = 5;

/* ------------------------------------------------------------------ *
 * The retinal image — a worker, for the trace and the focus solve
 * ------------------------------------------------------------------ */

export interface RetinaRequest extends VisualSpec {
  readonly pupilSamples: number;
  /** Display gain: white is a pixel holding `whiteFraction` of the frame's energy. */
  readonly whiteFraction: number;
}

export interface RetinaResult {
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  /** Millimetres per pixel ON THE RETINA. */
  readonly pixelScaleMm: number;
  readonly strehl: number;
  /**
   * Retinal radius of the first dark ring (mm), 1.22·size/pupilSamples pixels.
   * It grows as D/(d_eye·|M|) once the iris limits — § 5q's collapse, in the
   * picture rather than in a number.
   */
  readonly airyRadiusMm: number;
  /** The same disc as an angle in object space (arcsec) — what it costs on the sky. */
  readonly airyArcsec: number;
  readonly effectiveApertureMm: number;
  readonly irisLimited: boolean;

  /** Vertex → retina (mm): the reduced eye's own axial length, n/F. */
  readonly retinaMm: number;
  /** Where `bestFocus` puts the plane instead (mm from the last vertex). */
  readonly bestFocusMm: number;
  /**
   * That difference as diopters at the eye's front, Δz·n/L² — the accommodation
   * a relaxed observer has to supply. Positive: best focus is BEHIND the retina,
   * which is the side an eye can accommodate to. Negative is the side it cannot.
   */
  readonly accommodationDiopters: number;

  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

/** The vitreous index the reduced eye is built on — `designs/eye`'s VITREOUS. */
const VITREOUS_INDEX = 4 / 3;

/**
 * The image on the retina, at the retina.
 *
 * **Not at best focus, and the difference is a readout rather than a fix.** Every
 * other picture in this app is drawn at whatever plane `bestFocus` chooses,
 * because a camera's focuser is free. An eye's is not: the relaxed eye's retina
 * sits at the reduced model's own paraxial focus and moving it is accommodation,
 * which is a thing the observer does and has a cost. So the frame is formed
 * where the retina is and the distance to best focus is reported in diopters
 * beside it — C4's non-normalizing move, in a second currency.
 */
export function renderRetina(request: RetinaRequest): RetinaResult | Refusal {
  const started = performance.now();
  const D = request.apertureMm;

  let objective: ReturnType<typeof buildObjective>;
  try {
    objective = buildObjective(request.objective, D, request.focalRatio);
  } catch (cause) {
    return refusalOf(cause, "objective");
  }

  let eyepiece: Prescription;
  try {
    eyepiece = buildEyepiece(
      request.form,
      request.eyepieceFocalLengthMm,
      defaultClearAperture(request.form, request.eyepieceFocalLengthMm),
    );
  } catch (cause) {
    return refusalOf(cause, "eyepiece");
  }

  try {
    const eye = reducedEye({ pupilDiameterMm: request.eyePupilMm });
    const visual = visualSystem({
      objective: objective.prescription,
      eyepiece,
      apertureRadiusMm: D / 2,
      eye: { pupilDiameterMm: request.eyePupilMm },
      wavelengthNm: LAMBDA_NM,
    });

    const image = psf(visual.system, 0, LAMBDA_NM, {
      pupilSamples: request.pupilSamples,
      padFactor: 4,
      ...(objective.obstruction > 0 ? { obstruction: objective.obstruction } : {}),
    });

    // The focus solve runs on the same composed system and is NOT applied.
    const focus = bestFocus(visual.system, "minRmsWavefront", { wavelengthNm: LAMBDA_NM });
    const retinaMm = eye.axialLengthMm;
    const deltaMm = focus.offsetFromLastVertex - retinaMm;
    const accommodationDiopters = (1000 * deltaMm * VITREOUS_INDEX) / (retinaMm * retinaMm);

    const airyRadiusMm = 1.22 * (image.size / image.pupilSamples) * image.pixelScaleMm;
    // Back to the sky: a retinal length is an object angle through the posterior
    // nodal distance and the magnification, both of which are the engine's.
    const airyArcsec =
      (Math.atan(airyRadiusMm / eye.posteriorNodalDistanceMm) / Math.abs(visual.magnification)) *
      DEG *
      3600;

    return {
      rgba: toGrey(image.intensity, image.size, image.energy * request.whiteFraction),
      size: image.size,
      pixelScaleMm: image.pixelScaleMm,
      strehl: image.strehl,
      airyRadiusMm,
      airyArcsec,
      effectiveApertureMm: visual.effectiveApertureMm,
      irisLimited: visual.irisLimited,
      retinaMm,
      bestFocusMm: focus.offsetFromLastVertex,
      accommodationDiopters,
      maxGridPhaseStepWaves: image.maxGridPhaseStepWaves,
      elapsedMs: performance.now() - started,
    };
  } catch (cause) {
    return refusalOf(cause, "composition");
  }
}

/**
 * Greyscale against a white the caller fixes — `phase.ts`'s encoder on the star
 * panel's scale, so white is a pixel holding `whiteFraction` of the frame's
 * whole energy.
 *
 * The energy and not the peak, which a first version of this used. `psf`
 * normalizes to the transmitted pupil energy, so an energy-referred white is one
 * scale across the whole iris slider — and a peak-referred one is a fresh scale
 * per frame, which would flatten exactly the thing this picture is for: as the
 * iris closes the same light spreads over a wider disc and the peak falls, and
 * that dimming is the collapse rather than a display artifact.
 */
function toGrey(intensity: Float64Array, size: number, white: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((255 * intensity[i]!) / white);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/* ------------------------------------------------------------------ *
 * The apparent-field ceiling — a bisection over eyepiece BUILDS, so a worker
 * ------------------------------------------------------------------ */

export interface CeilingRequest {
  readonly objective: ObjectiveKind;
  readonly apertureMm: number;
  readonly focalRatio: number;
  readonly form: EyepieceForm;
  readonly eyepieceFocalLengthMm: number;
}

export interface Ceiling {
  /** The widest clear aperture the form admits at this focal length (mm). */
  readonly clearApertureMm: number | null;
  /** That, per focal length — D6 measures the Plössl's at 0.9615248. */
  readonly perFocalLength: number | null;
  /** The apparent field that widest glass buys (deg, full angle). */
  readonly apparentFieldOfViewDeg: number | null;
  /** 2·atan(r_e/f_e) at the same glass — the catalogue's formula. */
  readonly geometricFieldOfViewDeg: number | null;
  /** How far distortion inflates the first past the second. */
  readonly inflation: number | null;
  /** How far the search looked, so `null` means "not below this". */
  readonly searchedToPerFocalLength: number;
  readonly elapsedMs: number;
}

const CEILING_SEARCH_CEILING = 1.5;

/**
 * The widest apparent field this eyepiece form can be built to show — and what
 * stops it.
 *
 * D6 bisects the same clear-aperture wall and reports it as a length; this asks
 * what the length is *worth*, which is the question a visual observer has. The
 * two must land on the same constant for the Plössl, and that they do is the
 * cross-check: one panel measures a doublet's aperture refusal on a microscope
 * eyepiece and the other measures how much sky the same refusal costs.
 *
 * ~14 eyepiece solves plus one field bisection: ~150 ms for a Plössl, ~3 ms for
 * a Huygens, so a worker keyed on the focal-length slider.
 */
export function measureCeiling(request: CeilingRequest): Ceiling {
  const started = performance.now();
  const fe = request.eyepieceFocalLengthMm;
  const none = (searchedToPerFocalLength: number): Ceiling => ({
    clearApertureMm: null,
    perFocalLength: null,
    apparentFieldOfViewDeg: null,
    geometricFieldOfViewDeg: null,
    inflation: null,
    searchedToPerFocalLength,
    elapsedMs: performance.now() - started,
  });

  const builds = (clearApertureMm: number): boolean => {
    try {
      buildEyepiece(request.form, fe, clearApertureMm);
      return true;
    } catch {
      return false;
    }
  };

  let lo = 0.05 * fe;
  let hi = CEILING_SEARCH_CEILING * fe;
  if (!builds(lo)) return none(0.05);
  // No wall in range is a real answer and NOT the ceiling: reporting `lo` there
  // would print the bottom of the search as if it were the top, which is what a
  // first draft of this did for the Huygens (0.05·f_e, "3° of apparent field").
  if (builds(hi)) return none(CEILING_SEARCH_CEILING);
  for (let i = 0; i < 30 && hi - lo > 1e-6 * fe; i++) {
    const mid = (lo + hi) / 2;
    if (builds(mid)) lo = mid;
    else hi = mid;
  }

  try {
    const objective = buildObjective(request.objective, request.apertureMm, request.focalRatio);
    const eyepiece = buildEyepiece(request.form, fe, lo);
    const telescope = afocalTelescope({
      objective: objective.prescription,
      eyepiece,
      wavelengthNm: LAMBDA_NM,
    });
    const wallDeg = bisectFieldWall(telescope, request.apertureMm / 2);
    const apparentDeg =
      2 *
      Math.abs(
        apparentFieldAngleRad(telescope, wallDeg * WALL_INSET, LAMBDA_NM, request.apertureMm / 2) * DEG,
      );
    const geometricDeg = 2 * DEG * Math.atan(eyepiece.surfaces[0]!.semiAperture / fe);
    return {
      clearApertureMm: lo,
      perFocalLength: lo / fe,
      apparentFieldOfViewDeg: apparentDeg,
      geometricFieldOfViewDeg: geometricDeg,
      inflation: apparentDeg / geometricDeg - 1,
      searchedToPerFocalLength: CEILING_SEARCH_CEILING,
      elapsedMs: performance.now() - started,
    };
  } catch {
    // The glass builds but the composition does not: report the length alone
    // rather than inventing a field for it.
    return {
      clearApertureMm: lo,
      perFocalLength: lo / fe,
      apparentFieldOfViewDeg: null,
      geometricFieldOfViewDeg: null,
      inflation: null,
      searchedToPerFocalLength: CEILING_SEARCH_CEILING,
      elapsedMs: performance.now() - started,
    };
  }
}

/* ── worker message shapes ──────────────────────────────────────────── */

export interface RetinaJob {
  readonly seq: number;
  readonly request: RetinaRequest;
}
export interface RetinaDone {
  readonly seq: number;
  readonly result: RetinaResult | Refusal;
}
export interface CeilingJob {
  readonly seq: number;
  readonly request: CeilingRequest;
}
export interface CeilingDone {
  readonly seq: number;
  readonly result: Ceiling;
}
