import {
  FRONT_ELEMENT_MEDIUM,
  IMMERSION_MEDIUM,
  coverslipTolerance,
  infinityCorrectedMicroscope,
  oilImmersionObjective,
  planeLayerHeightMm,
  stackW040Mm,
  tubeLens,
  type OilImmersionObjective,
} from "@telemicroscope/core/designs";
import { constantIndex, getMedium, registerMedium } from "@telemicroscope/core/materials";
import { objectNumericalAperture, opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { LAMBDA_NM, MARECHAL_WAVES } from "./microscope";

/**
 * The coverslip, and what mismatching it costs — APP.md's A6, as pure
 * functions.
 *
 * `render.ts`'s commitment kept for the seventh time: numbers in, numbers out,
 * no DOM and no React. Both sweeps here are worker jobs (~2 s each), and the
 * single-point readout beside them is not (~90 ms), which is why they are three
 * entry points rather than one.
 *
 * ## The instrument, and the one modelling choice that decides every number
 *
 * § 6e.5's: **a real immersion objective is focused by moving it**, which
 * changes the thickness of the oil film. The film IS the focus control. Holding
 * it fixed and refocusing on the image side alone is not a conservative
 * assumption, it is a different instrument, and it is wrong by an order of
 * magnitude. So `refocusedFilmMm` is a closed form — hold the stack's paraxial
 * apparent distance n_g·Σtᵢ/nᵢ constant, one evaluation and no search — and the
 * panel draws BOTH models, because the gap between them is the finding.
 *
 * ## Three mechanisms, and they behave nothing alike
 *
 *  1. **Thickness costs no aberration at all.** The slip and the objective's
 *     front element are both D263, so the layer's (n² − n_out²) factor is
 *     identically zero and the slip contributes an exact zero to the stack's
 *     wavefront. A thickness error is a pure axial displacement, and refocusing
 *     is precisely the operation that removes one.
 *  2. **Thickness moves the delivered APERTURE**, which is not obvious and is
 *     what ends the band. The rims are fixed glass sized from a nominal slip and
 *     the specimen sits on the slip's underside, so a *thinner* slip puts it
 *     closer to those rims and the same rim subtends a *wider* cone.
 *  3. **Index is what no refocus touches.** It breaks the match that made (1)
 *     free.
 *
 * ## Both ends of the band are geometric, and neither is aberration
 *
 * The thin end is where **the rays stop existing**: the delivered NA climbs into
 * § 6e.4's own ceiling and the tracer starts losing them. This module does not
 * quote that ceiling — it bisects for the thickness where `lost` first becomes
 * non-zero and reports the delivered NA there, so the number arrives as a
 * measurement rather than as a constant typed into an app. The thick end is
 * where **the film runs out**: refocusing a thicker slip means a thinner film,
 * and at 0.19 mm the closed form asks for 0.11 µm of oil, which is optical
 * contact and not a film.
 *
 * ## A σ over a pupil that lost rays is refused, not drawn
 *
 * APP.md's A3 rule, and it is load-bearing here rather than decorative: at the
 * thin end `opdMap` still returns an `rmsWaves`, computed over whatever rays
 * survived, and it *rises* — which would draw as "aberration grows toward a thin
 * slip" when what is happening is that a third of the pupil is dark. Every σ
 * below carries its own `lost` and refuses itself when it is non-zero.
 */

const TUBE_FOCAL_LENGTH_MM = 200;

/** The No. 1.5 slip every objective here is corrected for (mm). */
export const NOMINAL_SLIP_MM = 0.17;

/** The slip's glass and the immersion fluid, at the d line. */
export const SLIP_INDEX = getMedium(FRONT_ELEMENT_MEDIUM).n(LAMBDA_NM);
export const OIL_INDEX = getMedium(IMMERSION_MEDIUM).n(LAMBDA_NM);

/**
 * The thinnest oil film this panel will call a film (mm).
 *
 * § 6e.5's own bound, and the reason it exists: refocusing a thicker slip thins
 * the film, and the σ at a 110 nm film is a real number about an instrument that
 * does not exist. Below this the readout is refused rather than drawn.
 */
export const MINIMUM_FILM_MM = 0.005;

/** The apertures A6 offers — § 6e.4's two, plus the one below them. */
export const SLIP_APERTURES = [1.0, 1.25, 1.4] as const;

export type SlipAperture = (typeof SLIP_APERTURES)[number];

/** How the instrument is refocused when the slip is not the nominal one. */
export type RefocusModel =
  /** § 6e.5's: move the objective, which changes the oil film. */
  | "objective"
  /** The negative control: pretend the focus knob does not move the objective. */
  | "film-pinned";

export const REFOCUS_MODELS: readonly RefocusModel[] = ["objective", "film-pinned"];

export function slipObjective(numericalAperture: number): OilImmersionObjective {
  return oilImmersionObjective({
    magnification: 100,
    numericalAperture,
    tubeFocalLengthMm: TUBE_FOCAL_LENGTH_MM,
  });
}

/**
 * The oil film that holds the stack's paraxial apparent distance where the
 * design put it: Δt/n_slip + Δg/n_oil = 0, with n_g cancelling.
 *
 * Generalised over the slip's index as well as its thickness, since A6 varies
 * both and the apparent distance carries t/n as one quantity. At the nominal
 * index this is § 6e.5's own expression term for term.
 */
export function refocusedFilmMm(
  objective: OilImmersionObjective,
  thicknessMm: number,
  slipIndex: number,
): number {
  const nominal = NOMINAL_SLIP_MM / SLIP_INDEX;
  return (
    objective.frontGroup.hyperhemisphere.immersionGapMm -
    (thicknessMm / slipIndex - nominal) * OIL_INDEX
  );
}

/**
 * A registered medium of exactly this index, named from the index itself.
 *
 * The catalog is a process-global registry and `registerMedium` overwrites, so
 * the name has to be a function of the value: a per-request name would grow the
 * registry for as long as a reader drags the slider.
 */
function slipMedium(index: number): string {
  const name = `A6-SLIP-${index.toFixed(6)}`;
  registerMedium(constantIndex(name, index));
  return name;
}

/**
 * The built instrument meeting a slip it was not designed for.
 *
 * Nothing is re-solved — same glass, same spacings, same dome. That is the whole
 * point: an objective's correction depends on a plate it does not control.
 */
export function slipSystem(
  objective: OilImmersionObjective,
  thicknessMm: number,
  filmMm: number,
  slipIndex: number,
): OpticalSystem {
  const [first, ...rest] = objective.prescription.surfaces;
  const medium = slipIndex === SLIP_INDEX ? undefined : slipMedium(slipIndex);
  return infinityCorrectedMicroscope({
    objective: {
      ...objective,
      objectDistanceMm: thicknessMm,
      prescription: {
        ...objective.prescription,
        ...(medium ? { objectMedium: medium } : {}),
        surfaces: [{ ...first!, thickness: filmMm }, ...rest],
      },
    },
    tubeLens: tubeLens({ focalLengthMm: TUBE_FOCAL_LENGTH_MM }),
    objectHeightsMm: [0],
  }).system;
}

/**
 * A balanced σ, or the reason there is not one.
 *
 * `lost` is carried on the refusal because it is the readout: it is how many of
 * `pupilSamples`² rays never made it through, and at the thin end it is what the
 * rising σ actually was.
 */
export type SigmaReadout =
  | {
      readonly ok: true;
      readonly sigmaWaves: number;
      /** Where best focus landed (mm from the last vertex) — § 1.6.1's quantity. */
      readonly focusOffsetMm: number;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly lost: number;
      readonly source: "engine" | "app";
    };

/** RMS wavefront error at best focus, refused if the pupil is not whole. */
export function sigmaOf(system: OpticalSystem, pupilSamples: number): SigmaReadout {
  try {
    const focus = bestFocus(system, "minRmsWavefront", { pupilSamples });
    const map = opdMap(
      withFocus(system, focus.offsetFromLastVertex),
      0,
      LAMBDA_NM,
      pupilGrid(pupilSamples),
    );
    if (map.lost > 0) {
      return {
        ok: false,
        reason: `${map.lost} of ${pupilSamples ** 2} pupil rays never left the specimen — this aperture is not delivered at this slip`,
        lost: map.lost,
        source: "app",
      };
    }
    return { ok: true, sigmaWaves: map.rmsWaves, focusOffsetMm: focus.offsetFromLastVertex };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message, lost: 0, source: "engine" };
  }
}

export interface SlipPoint {
  readonly thicknessMm: number;
  /** The film the refocus asks for (mm). Negative means the objective is inside the slip. */
  readonly filmMm: number;
  /** n·sin u at the specimen, traced. Refused where the film is not a film. */
  readonly deliveredNa: number | null;
  /**
   * The same aperture from § 6e.2's plane-layer height read backwards:
   * NA(t) = n_slip·h/√(t² + h²), with h the stop radius the design solved to.
   * Closed form, so it exists where the trace does not.
   */
  readonly predictedNa: number;
  /**
   * The oil layer's third-order coefficient (waves) — `stackW040Mm` on the one
   * mismatched layer, since the slip's own contribution is an identical zero.
   * NEGATIVE: the oil is rarer than the glass either side of it.
   */
  readonly oilW040Waves: number;
  /** § 6e.5's refocus — move the objective. */
  readonly refocused: SigmaReadout;
  /** The negative control — image-side refocus only, film held at nominal. */
  readonly pinned: SigmaReadout;
}

export interface SlipSweepRequest {
  readonly numericalAperture: number;
  readonly minThicknessMm: number;
  readonly maxThicknessMm: number;
  readonly points: number;
  readonly pupilSamples: number;
}

export interface SlipSweep {
  readonly points: readonly SlipPoint[];
  /**
   * Where the tracer first loses a ray, bisected rather than quoted, with the
   * delivered aperture there. `null` when the whole band traces whole — which is
   * the answer at NA 1.0 and 1.25, and is itself the finding.
   */
  readonly rayWall: { readonly thicknessMm: number; readonly deliveredNa: number } | null;
  /** Where the refocus asks for less oil than `MINIMUM_FILM_MM`. */
  readonly filmWallThicknessMm: number;
  readonly elapsedMs: number;
}

const oilW040Waves = (
  objective: OilImmersionObjective,
  thicknessMm: number,
  filmMm: number,
  slipIndex: number,
  numericalAperture: number,
): number => {
  const glass = objective.frontGroup.hyperhemisphere.glassIndex;
  const layers = [
    { thicknessMm, n: slipIndex },
    { thicknessMm: Math.max(filmMm, 0), n: OIL_INDEX },
  ];
  return stackW040Mm(layers, glass, numericalAperture) / (LAMBDA_NM * 1e-6);
};

/** NA(t) = n_slip·h/√(t² + h²) — § 6e.2's plane-layer height, inverted. */
export const predictedNa = (
  objective: OilImmersionObjective,
  thicknessMm: number,
  slipIndex: number,
): number => (slipIndex * objective.stopRadiusMm) / Math.hypot(thicknessMm, objective.stopRadiusMm);

/**
 * The stop radius the design solved to, and the check that it IS the plane-layer
 * height at the nominal slip. One line, and it is what makes `predictedNa` a
 * reading of the engine rather than a formula an app wrote down.
 */
export const stopRadiusResidual = (objective: OilImmersionObjective): number =>
  Math.abs(
    objective.stopRadiusMm /
      planeLayerHeightMm(
        [{ thicknessMm: NOMINAL_SLIP_MM, n: SLIP_INDEX }],
        objective.numericalAperture,
      ) -
      1,
  );

function slipPointAt(
  objective: OilImmersionObjective,
  thicknessMm: number,
  request: { readonly pupilSamples: number },
): SlipPoint {
  const filmMm = refocusedFilmMm(objective, thicknessMm, SLIP_INDEX);
  const nominalFilm = objective.frontGroup.hyperhemisphere.immersionGapMm;
  const usable = filmMm >= MINIMUM_FILM_MM;
  const refocused: SigmaReadout = usable
    ? sigmaOf(slipSystem(objective, thicknessMm, filmMm, SLIP_INDEX), request.pupilSamples)
    : {
        ok: false,
        reason: `the refocus asks for ${(filmMm * 1000).toFixed(2)} µm of oil — optical contact, not a film`,
        lost: 0,
        source: "app",
      };
  return {
    thicknessMm,
    filmMm,
    deliveredNa: usable
      ? objectNumericalAperture(
          slipSystem(objective, thicknessMm, filmMm, SLIP_INDEX),
          LAMBDA_NM,
        )
      : null,
    predictedNa: predictedNa(objective, thicknessMm, SLIP_INDEX),
    oilW040Waves: oilW040Waves(
      objective,
      thicknessMm,
      filmMm,
      SLIP_INDEX,
      objective.numericalAperture,
    ),
    refocused,
    pinned: sigmaOf(
      slipSystem(objective, thicknessMm, nominalFilm, SLIP_INDEX),
      request.pupilSamples,
    ),
  };
}

/**
 * σ, the delivered aperture and the oil's own W₀₄₀ across a band of slips, under
 * both refocus models.
 *
 * ~2 s at 21 points and `pupilSamples` 21, which is a worker job and not a
 * slider. The single-point readout is `slipReadout`.
 */
export function slipSweep(request: SlipSweepRequest): SlipSweep {
  const started = performance.now();
  const objective = slipObjective(request.numericalAperture);
  const span = request.maxThicknessMm - request.minThicknessMm;
  const points: SlipPoint[] = [];
  for (let i = 0; i < request.points; i++) {
    const thicknessMm = request.minThicknessMm + (span * i) / (request.points - 1);
    points.push(slipPointAt(objective, thicknessMm, request));
  }
  return {
    points,
    rayWall: bisectRayWall(objective, request),
    filmWallThicknessMm: filmWallThicknessMm(objective),
    elapsedMs: performance.now() - started,
  };
}

/** Where the refocus stops being able to supply `MINIMUM_FILM_MM` of oil. */
function filmWallThicknessMm(objective: OilImmersionObjective): number {
  // Affine in t, so this inverts rather than searching.
  const nominal = NOMINAL_SLIP_MM / SLIP_INDEX;
  const gap = objective.frontGroup.hyperhemisphere.immersionGapMm;
  return SLIP_INDEX * (nominal + (gap - MINIMUM_FILM_MM) / OIL_INDEX);
}

/**
 * Bisect for the slip at which the trace first loses a ray.
 *
 * Measured rather than quoted. § 6e.4's ceiling is a number in the validation
 * ladder and not an engine export, so an app that printed it would be
 * transcribing; asking the tracer where it fails and reading the delivered
 * aperture there produces the same number as an observation.
 */
function bisectRayWall(
  objective: OilImmersionObjective,
  request: SlipSweepRequest,
): { thicknessMm: number; deliveredNa: number } | null {
  const loses = (thicknessMm: number): boolean => {
    const film = refocusedFilmMm(objective, thicknessMm, SLIP_INDEX);
    if (film < MINIMUM_FILM_MM) return false;
    return !sigmaOf(slipSystem(objective, thicknessMm, film, SLIP_INDEX), request.pupilSamples).ok;
  };
  let lost = request.minThicknessMm;
  let clean = request.maxThicknessMm;
  if (!loses(lost)) return null;
  for (let i = 0; i < 24 && clean - lost > 1e-6; i++) {
    const mid = (lost + clean) / 2;
    if (loses(mid)) lost = mid;
    else clean = mid;
  }
  return {
    thicknessMm: clean,
    deliveredNa: predictedNa(objective, clean, SLIP_INDEX),
  };
}

export interface IndexPoint {
  readonly deltaN: number;
  readonly slipIndex: number;
  /** Refocused for the apparent-distance change the index alone causes. */
  readonly refocused: SigmaReadout;
  /** § 6e.5's own rung: the film held at nominal. */
  readonly pinned: SigmaReadout;
}

export interface IndexSweepRequest {
  readonly numericalAperture: number;
  readonly maxDeltaN: number;
  readonly points: number;
  readonly pupilSamples: number;
}

export interface IndexSweep {
  readonly points: readonly IndexPoint[];
  readonly elapsedMs: number;
}

/**
 * σ against the slip's index, at the nominal thickness, under both models.
 *
 * The second series is what makes "refocusing cannot fix index" a drawing rather
 * than a claim. A wrong index does shift the apparent distance — t/n is one
 * quantity — so there is a refocus to try, and the panel tries it: the curve
 * barely moves, because what is left is a broken match and not a displacement.
 */
export function indexSweep(request: IndexSweepRequest): IndexSweep {
  const started = performance.now();
  const objective = slipObjective(request.numericalAperture);
  const nominalFilm = objective.frontGroup.hyperhemisphere.immersionGapMm;
  const points: IndexPoint[] = [];
  for (let i = 0; i < request.points; i++) {
    const deltaN =
      -request.maxDeltaN + (2 * request.maxDeltaN * i) / (request.points - 1);
    const slipIndex = SLIP_INDEX + deltaN;
    const film = refocusedFilmMm(objective, NOMINAL_SLIP_MM, slipIndex);
    points.push({
      deltaN,
      slipIndex,
      refocused:
        film >= MINIMUM_FILM_MM
          ? sigmaOf(
              slipSystem(objective, NOMINAL_SLIP_MM, film, slipIndex),
              request.pupilSamples,
            )
          : { ok: false, reason: "the refocus runs out of oil", lost: 0, source: "app" },
      pinned: sigmaOf(
        slipSystem(objective, NOMINAL_SLIP_MM, nominalFilm, slipIndex),
        request.pupilSamples,
      ),
    });
  }
  return { points, elapsedMs: performance.now() - started };
}

export interface SlipReadoutRequest {
  readonly numericalAperture: number;
  readonly thicknessMm: number;
  readonly deltaN: number;
  readonly pupilSamples: number;
}

export interface SlipReadout {
  readonly thicknessMm: number;
  readonly slipIndex: number;
  readonly filmMm: number;
  readonly nominalFilmMm: number;
  readonly deliveredNa: number | null;
  readonly predictedNa: number;
  readonly oilW040Waves: number;
  readonly refocused: SigmaReadout;
  readonly pinned: SigmaReadout;
  /** How far the specimen's apparent position moved, in µm — the refocus's job. */
  readonly apparentShiftUm: number;
  readonly elapsedMs: number;
}

/**
 * One slip, both models, ~90 ms — the "you are here" the sliders drive.
 *
 * Separate from the sweeps for the reason § 6l's third worker was: the sweeps
 * are keyed on the aperture alone and must not re-run when a slider moves.
 */
export function slipReadout(request: SlipReadoutRequest): SlipReadout {
  const started = performance.now();
  const objective = slipObjective(request.numericalAperture);
  const slipIndex = SLIP_INDEX + request.deltaN;
  const nominalFilmMm = objective.frontGroup.hyperhemisphere.immersionGapMm;
  const filmMm = refocusedFilmMm(objective, request.thicknessMm, slipIndex);
  const usable = filmMm >= MINIMUM_FILM_MM;
  const refocusedSystem = usable
    ? slipSystem(objective, request.thicknessMm, filmMm, slipIndex)
    : null;
  return {
    thicknessMm: request.thicknessMm,
    slipIndex,
    filmMm,
    nominalFilmMm,
    deliveredNa: refocusedSystem ? objectNumericalAperture(refocusedSystem, LAMBDA_NM) : null,
    predictedNa: predictedNa(objective, request.thicknessMm, slipIndex),
    oilW040Waves: oilW040Waves(
      objective,
      request.thicknessMm,
      filmMm,
      slipIndex,
      objective.numericalAperture,
    ),
    refocused: refocusedSystem
      ? sigmaOf(refocusedSystem, request.pupilSamples)
      : {
          ok: false,
          reason: `the refocus asks for ${(filmMm * 1000).toFixed(2)} µm of oil — optical contact, not a film`,
          lost: 0,
          source: "app",
        },
    pinned: sigmaOf(
      slipSystem(objective, request.thicknessMm, nominalFilmMm, slipIndex),
      request.pupilSamples,
    ),
    apparentShiftUm:
      (request.thicknessMm / slipIndex - NOMINAL_SLIP_MM / SLIP_INDEX) * 1000,
    elapsedMs: performance.now() - started,
  };
}

export interface DryTolerancePoint {
  readonly numericalAperture: number;
  /** Rayleigh's quarter wave on W₀₄₀ (µm of slip). */
  readonly quarterWaveUm: number;
  /** Maréchal on the balanced residual (µm of slip) — looser by 6√5·4/14. */
  readonly marechalUm: number;
}

/**
 * The DRY story, closed form and free: how far a slip may stray before the
 * mismatch alone spends the budget, as 1/NA⁴.
 *
 * This is the curve § 6c's headline lives on — millimetres at NA 0.10, microns
 * at NA 0.95 — and it is why a 4×/0.10 is coverslip-*insensitive* while a dry
 * 0.95 is the hardest objective in a catalogue to use. It costs no trace, so it
 * runs on the main thread beside the two swept ones.
 */
export function dryToleranceCurve(
  apertures: readonly number[],
  slipIndex = SLIP_INDEX,
): readonly DryTolerancePoint[] {
  return apertures.map((numericalAperture) => {
    const tolerance = coverslipTolerance(numericalAperture, LAMBDA_NM, slipIndex);
    return {
      numericalAperture,
      quarterWaveUm: tolerance.quarterWaveMm * 1000,
      marechalUm: tolerance.marechalMm * 1000,
    };
  });
}

/** σ as a share of the Maréchal budget — the currency every readout is in. */
export const budgetShare = (sigmaWaves: number): number => sigmaWaves / MARECHAL_WAVES;

export interface SweepJob {
  readonly seq: number;
  readonly request: SlipSweepRequest;
}
export interface SweepDone {
  readonly seq: number;
  readonly result: SlipSweep;
}
export interface IndexJob {
  readonly seq: number;
  readonly request: IndexSweepRequest;
}
export interface IndexDone {
  readonly seq: number;
  readonly result: IndexSweep;
}
export interface ReadoutJob {
  readonly seq: number;
  readonly request: SlipReadoutRequest;
}
export interface ReadoutDone {
  readonly seq: number;
  readonly result: SlipReadout;
}
