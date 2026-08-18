import {
  FLANGE_FOCAL_DISTANCE_MM,
  PARFOCAL_DISTANCE_MM,
  cameraBody,
  filter,
  focusReach,
  mirrorDiagonal,
  parfocalBarrelLengthMm,
  prismDiagonal,
  spacer,
  withGlassPath,
  type FocuserSpec,
  type MechPart,
} from "@telemicroscope/core/mech";
import {
  DoubletApertureRefusal,
  OPTICAL_TUBE_LENGTH_MM,
  achromaticObjective,
  finiteConjugateObjective,
  plateW040Mm,
  plateWavefrontErrorMm,
} from "@telemicroscope/core/designs";
import { getMedium, LINE_C, LINE_D, LINE_F } from "@telemicroscope/core/materials";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { simpleSystem, type OpticalSystem, type Prescription } from "@telemicroscope/core/trace";

/**
 * The mechanical train — APP.md's C3, as pure functions.
 *
 * `render.ts`'s commitment kept for the twelfth time: numbers in, numbers out,
 * no DOM and no React. Two of the four blocks below are worker jobs (~1 s and
 * ~2 s); the other two are arithmetic and a handful of paraxial solves, which is
 * why only two of them have a worker.
 *
 * ## What the layer claims, and why a panel can show it
 *
 * § 5u's one claim is that **a part's mechanical length and its optical cost are
 * different numbers**, and the difference is exactly the glass inside it. That is
 * a claim about a *budget*, so unlike every microscope surface in this app the
 * headline is not an image and not even a wavefront: it is two verdicts about the
 * same train, computed from the same parts list, disagreeing. § 5u measured that
 * on one focuser. Here the focuser is a control, which is what turns "the naive
 * sum is wrong by 7.83%" into "here is the band of trains where the spreadsheet
 * says no and the physics says yes".
 *
 * ## The plate is measured against the closed form, not substituted for it
 *
 * `withGlassPath` splices plane surfaces and the *tracer* finds the focus — that
 * is § 5u's whole discipline — so the panel can ask what the glass costs the
 * image by tracing the same instrument twice and differencing the two balanced
 * σ. § 5u.6 is explicitly **closed form only, no trace in this step**; block 2 is
 * that number traced, and what the trace can and cannot resolve is in
 * `opticsSweep`.
 *
 * Two things about that route are worth stating because both were found the hard
 * way. The obvious alternative — express "insert the diagonal" as a § 5t
 * `Perturbation` on the glass layer's thickness — **does not work**: a 40 mm
 * thickness perturbation moves the image plane 40 mm, `sigmaBeforeFocusWaves`
 * comes back at 15 waves, and the linear ρ² projection cannot remove a defocus
 * that large, so the currency reads 7× high. And a *zero*-thickness plate, which
 * would have made the no-glass control structurally identical to the glassed one,
 * **breaks the tracer** — two coincident plane faces, and the chief ray misses;
 * 1e-6 mm is a clean no-op to seven digits, 1e-9 mm is not. Neither is a
 * mechanism this file builds on; both are why it differences two `withGlassPath`
 * systems instead, which keeps the image plane fixed by construction.
 *
 * ## Why `achromaticObjective` and not `refractorPair`
 *
 * The panel's x axis IS the focal ratio, and Part B measured that
 * `refractorPair`'s usable EPD goes as **√f** — so sweeping the focal ratio on it
 * would sweep the aperture too, and the plate's cone angle would not be the
 * variable. `achromaticObjective` takes the aperture and the focal ratio
 * separately, which is what § 5u's own rungs use.
 */

/** The d line — what § 5u's rungs and the mech layer's own index are at. */
export const LAMBDA_NM = LINE_D;

/** σ = λ/14, the RMS-native diffraction limit every surface here is in. */
export const MARECHAL_WAVES = 1 / 14;

/** Rayleigh's λ/4, on the PEAK wavefront error — a different criterion, not a scale. */
export const RAYLEIGH_PEAK_WAVES = 0.25;

/** The balanced RMS of a pure W₀₄₀, which is what makes the two comparable. */
export const W040_TO_SIGMA = 1 / (6 * Math.sqrt(5));

/** DIN's shoulder-to-specimen distance (mm) — block 4's default standard. */
export const DIN_PARFOCAL_MM = PARFOCAL_DISTANCE_MM.din;

const nBk7 = (): number => getMedium("N-BK7").n(LAMBDA_NM);

// ---------------------------------------------------------------------------
// Block 1 — the chain, the budget and the two verdicts. Arithmetic, no trace.
// ---------------------------------------------------------------------------

export type DiagonalKind = "prism" | "mirror" | "none";
export const DIAGONAL_KINDS: readonly DiagonalKind[] = ["prism", "mirror", "none"];

/** The bodies C3 offers, by flange focal distance — `standards.ts`'s own table. */
export const CAMERA_KEYS = ["t2", "canonEf", "nikonF", "sonyE", "cMount"] as const;
export type CameraKey = (typeof CAMERA_KEYS)[number];

export const CAMERA_LABEL: Record<CameraKey, string> = {
  t2: "T2 train 55.0",
  canonEf: "Canon EF 44.0",
  nikonF: "Nikon F 46.5",
  sonyE: "Sony E 18.0",
  cMount: "C-mount 17.53",
};

export interface ChainSpec {
  readonly diagonal: DiagonalKind;
  /** Entry face → exit face along the fold (mm). */
  readonly diagonalPathMm: number;
  /** Glass inside that path (mm). A mirror diagonal has none at all. */
  readonly prismGlassMm: number;
  /** A filter in the converging beam — its whole light path is glass. 0 for none. */
  readonly filterMm: number;
  /** Extension tubes and adapters (mm). */
  readonly spacerMm: number;
  readonly camera: CameraKey;
}

/**
 * § 5u.4's own train — a 2″ prism diagonal and an SLR body, no extension.
 *
 * The spacer starts at zero deliberately: on `DEFAULT_FOCUSER` this is the chain
 * where the two verdicts *disagree*, and a panel whose headline is a
 * disagreement should be showing one when it opens rather than after a drag.
 */
export const DEFAULT_CHAIN: ChainSpec = {
  diagonal: "prism",
  diagonalPathMm: 110,
  prismGlassMm: 40,
  filterMm: 0,
  spacerMm: 0,
  camera: "canonEf",
};

/**
 * A focuser that puts the two verdicts on opposite sides — § 5u.4's own, and the
 * default because a panel whose headline is a disagreement should open on one.
 */
export const DEFAULT_FOCUSER: FocuserSpec = {
  backFocusMm: 150,
  inwardTravelMm: 2,
  outwardTravelMm: 30,
};

/**
 * The parts list, in order along the beam.
 *
 * A mirror diagonal is the same fold with the glass layer *absent* rather than
 * zero — `mirrorDiagonal` takes no thickness at all — which is what makes "a
 * mirror diagonal needs more back focus" fall out of the budget instead of being
 * asserted.
 */
export function buildChain(spec: ChainSpec): MechPart[] {
  const parts: MechPart[] = [];
  if (spec.diagonal === "prism" && spec.prismGlassMm > 0) {
    parts.push(
      prismDiagonal({ pathLengthMm: spec.diagonalPathMm, prismThicknessMm: spec.prismGlassMm }),
    );
  } else if (spec.diagonal !== "none") {
    // Including a "prism" with no glass in it, which is a mirror diagonal and is
    // built as one rather than as a part carrying a zero layer: `path.ts`
    // refuses a non-positive glass thickness, and it is right to.
    parts.push(mirrorDiagonal({ pathLengthMm: spec.diagonalPathMm }));
  }
  if (spec.filterMm > 0) parts.push(filter({ thicknessMm: spec.filterMm, name: "UV/IR cut" }));
  if (spec.spacerMm > 0) parts.push(spacer(spec.spacerMm, "extension"));
  parts.push(
    cameraBody({
      name: CAMERA_LABEL[spec.camera],
      flangeFocalDistanceMm: FLANGE_FOCAL_DISTANCE_MM[spec.camera],
    }),
  );
  return parts;
}

/**
 * Every glass layer's thickness in the chain (mm) — what block 2 splices.
 *
 * One number rather than a layer list, and that is exact rather than a
 * simplification: every glass part this panel offers is N-BK7, and § 5u.1 pins
 * that the focus shift is **additive across layers**, so one layer of the sum is
 * the same optics as the sum of the layers. A panel offering a second glass would
 * have to pass the chain itself.
 */
export const chainGlassMm = (spec: ChainSpec): number =>
  (spec.diagonal === "prism" ? Math.max(spec.prismGlassMm, 0) : 0) + Math.max(spec.filterMm, 0);

export interface ChainReadout {
  readonly mechanicalLengthMm: number;
  readonly glassThicknessMm: number;
  /** Σtᵢ(1−1/nᵢ) — what the glass hands back (mm). */
  readonly focusShiftMm: number;
  readonly consumedMm: number;
  readonly naiveConsumedMm: number;
  /** The share of the chain's own length the naive sum is wrong by. § 5u's 7.83%. */
  readonly naiveErrorFraction: number;
  readonly requiredTravelMm: number;
  readonly naiveRequiredTravelMm: number;
  readonly reaches: boolean;
  readonly naiveReaches: boolean;
  readonly marginMm: number;
  /** The whole point of the layer: the parts list and the physics rule differently. */
  readonly verdictsDisagree: boolean;
}

export function chainReadout(spec: ChainSpec, focuser: FocuserSpec): ChainReadout {
  const reach = focusReach(focuser, buildChain(spec), LAMBDA_NM);
  const b = reach.budget;
  return {
    mechanicalLengthMm: b.mechanicalLengthMm,
    glassThicknessMm: b.glassThicknessMm,
    focusShiftMm: b.focusShiftMm,
    consumedMm: b.consumedMm,
    naiveConsumedMm: b.naiveConsumedMm,
    naiveErrorFraction: b.focusShiftMm / b.mechanicalLengthMm,
    requiredTravelMm: reach.requiredTravelMm,
    naiveRequiredTravelMm: reach.naiveRequiredTravelMm,
    reaches: reach.reaches,
    naiveReaches: reach.naiveReaches,
    marginMm: reach.marginMm,
    verdictsDisagree: reach.reaches !== reach.naiveReaches,
  };
}

export interface TravelPoint {
  readonly prismGlassMm: number;
  readonly requiredTravelMm: number;
  /** What a budget that counts glass as air asks for — FLAT in this variable. */
  readonly naiveRequiredTravelMm: number;
  readonly reaches: boolean;
  readonly naiveReaches: boolean;
}

/**
 * Required travel against the glass inside a light path of fixed length.
 *
 * The x axis is chosen so the picture IS the claim. Filling a fixed-length
 * diagonal with more glass does not change what it *occupies*, so the naive line
 * is **exactly flat** — a spreadsheet cannot see this variable at all — while the
 * honest one slopes at (1 − 1/n) per millimetre. Every other control the reader
 * has translates both lines together; only this one separates them. Its x = 0 end
 * is not a fiction either: a diagonal with no glass in it is a mirror diagonal,
 * and `buildChain` builds one there.
 */
export function travelSweep(
  spec: ChainSpec,
  focuser: FocuserSpec,
  points: number,
): readonly TravelPoint[] {
  const out: TravelPoint[] = [];
  for (let i = 0; i < points; i++) {
    const prismGlassMm = (spec.diagonalPathMm * i) / (points - 1);
    const reach = focusReach(
      focuser,
      buildChain({ ...spec, diagonal: "prism", prismGlassMm }),
      LAMBDA_NM,
    );
    out.push({
      prismGlassMm,
      requiredTravelMm: reach.requiredTravelMm,
      naiveRequiredTravelMm: reach.naiveRequiredTravelMm,
      reaches: reach.reaches,
      naiveReaches: reach.naiveReaches,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block 2 — what the glass costs the image. Traced, and the first worker job.
// ---------------------------------------------------------------------------

/** The apertures C3 offers. The plate's cost should not know which one it is. */
export const APERTURES_MM = [60, 100, 150] as const;
export type ApertureMm = (typeof APERTURES_MM)[number];

/** Where the spliced glass sits along the cone, as a share of the room available. */
const GAP_FRACTION = 0.15;

export type SigmaReadout =
  | { readonly ok: true; readonly sigmaWaves: number }
  | { readonly ok: false; readonly reason: string; readonly lost: number };

const systemOf = (p: Prescription, apertureMm: number, wavelengthNm = LAMBDA_NM): OpticalSystem =>
  simpleSystem(p, { kind: "EPD", value: apertureMm }, wavelengthNm);

/** Balanced RMS wavefront error at best focus, refused if the pupil is not whole. */
export function sigmaOf(p: Prescription, apertureMm: number, pupilSamples: number): SigmaReadout {
  try {
    const system = systemOf(p, apertureMm);
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
        reason: `${map.lost} of ${pupilSamples ** 2} pupil rays never reached the image`,
        lost: map.lost,
      };
    }
    return { ok: true, sigmaWaves: map.rmsWaves };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message, lost: 0 };
  }
}

/** The trailing room a chain's glass has to fit into (mm). */
const trailingRoomMm = (p: Prescription): number =>
  Math.abs(p.surfaces[p.surfaces.length - 1]!.thickness);

/**
 * The same instrument with the chain's glass in it, at a gap that is a fixed
 * share of the room available.
 *
 * A fraction rather than a constant, and that is the honest way to place it:
 * § 5u.2 pinned that where the glass sits along the converging beam is
 * **exactly** irrelevant — a perpendicular plane crossing a cone of straight
 * lines meets every ray at the same angle — so any gap that fits gives the same
 * answer, while a constant gap would simply refuse to fit at the fast end.
 * `positionNull` measures the irrelevance rather than assuming it.
 */
function glassedAt(p: Prescription, glassMm: number, gapFraction = GAP_FRACTION): Prescription {
  const room = trailingRoomMm(p);
  const gapMm = Math.max(0, (room - glassMm) * gapFraction);
  return withGlassPath(p, [filter({ thicknessMm: glassMm, name: "the chain's glass" })], { gapMm });
}

/** The plate's third-order balanced σ (waves) at a focal ratio. */
export const closedPlateWaves = (glassMm: number, focalRatio: number): number =>
  glassMm <= 0
    ? 0
    : (plateW040Mm(glassMm, nBk7(), 1 / (2 * focalRatio)) * W040_TO_SIGMA) / (LAMBDA_NM * 1e-6);

/** The plate's exact all-orders PEAK wavefront error (waves) — Rayleigh's currency. */
export const exactPlatePeakWaves = (glassMm: number, focalRatio: number): number =>
  glassMm <= 0 ? 0 : plateWavefrontErrorMm(glassMm, nBk7(), 1 / (2 * focalRatio)) / (LAMBDA_NM * 1e-6);

/** The exact form over the third-order one — § 5u.6's own departure ratio. */
export const exactOverThird = (glassMm: number, focalRatio: number): number =>
  glassMm <= 0
    ? 1
    : plateWavefrontErrorMm(glassMm, nBk7(), 1 / (2 * focalRatio)) /
      plateW040Mm(glassMm, nBk7(), 1 / (2 * focalRatio));

export interface OpticsPoint {
  readonly focalRatio: number;
  /** The doublet alone, traced. */
  readonly bare: SigmaReadout;
  /** The doublet with the chain's glass spliced in, traced. */
  readonly glassed: SigmaReadout;
  /** glassed − bare (waves) — the panel's own measurement of the plate. */
  readonly measuredPlateWaves: number | null;
  /** W₀₄₀/(6√5) at this cone angle (waves) — § 5u.6's third-order closed form. */
  readonly closedPlateWaves: number;
  readonly exactOverThird: number;
}

export interface OpticsSweepRequest {
  readonly apertureMm: number;
  readonly glassMm: number;
  readonly minRatio: number;
  readonly maxRatio: number;
  readonly points: number;
  readonly pupilSamples: number;
}

/** Where a curve crosses its criterion, bisected on the engine rather than quoted. */
export interface Crossing {
  readonly focalRatio: number | null;
  /** Present when the criterion is not bracketed by the sweep's own range. */
  readonly reason?: string;
}

export interface PositionNull {
  readonly nearGapMm: number;
  readonly farGapMm: number;
  readonly nearSigmaWaves: number | null;
  readonly farSigmaWaves: number | null;
  /** |σ_far − σ_near| (waves). § 5u.2's identity, measured on this system. */
  readonly differenceWaves: number | null;
  readonly focalRatio: number;
}

export interface OpticsSweep {
  readonly points: readonly OpticsPoint[];
  /** The plate ALONE at Rayleigh's λ/4 on the exact peak W — § 5u.6's f/5.315. */
  readonly plateRayleigh: Crossing;
  /** The plate alone at Maréchal's λ/14 on the balanced σ — same plate, other criterion. */
  readonly plateMarechal: Crossing;
  /** The doublet alone, traced. */
  readonly bareMarechal: Crossing;
  /** The doublet with the glass in it, traced. */
  readonly glassedMarechal: Crossing;
  readonly positionNull: PositionNull;
  readonly elapsedMs: number;
}

/**
 * Bisect a decreasing curve onto its criterion.
 *
 * `null` from `f` is a refusal rather than a value, and it ends the bisection
 * instead of being treated as a small number — A3's rule about undefined
 * readouts, on a search instead of on a plot.
 */
function bisect(
  f: (x: number) => number | null,
  target: number,
  lo0: number,
  hi0: number,
  iterations = 32,
): Crossing {
  const vLo = f(lo0);
  const vHi = f(hi0);
  if (vLo === null || vHi === null) {
    return { focalRatio: null, reason: "the sweep's own range does not trace whole at its ends" };
  }
  if (!(vLo > target && vHi < target)) {
    return {
      focalRatio: null,
      reason: `f/${lo0.toFixed(1)} and f/${hi0.toFixed(1)} are on the same side of the criterion`,
    };
  }
  let lo = lo0;
  let hi = hi0;
  for (let i = 0; i < iterations; i++) {
    const mid = 0.5 * (lo + hi);
    const v = f(mid);
    if (v === null) return { focalRatio: null, reason: `the trace failed at f/${mid.toFixed(3)}` };
    if (v > target) lo = mid;
    else hi = mid;
  }
  return { focalRatio: 0.5 * (lo + hi) };
}

/**
 * σ against focal ratio, with and without the chain's glass, plus the closed form
 * the difference is measured against.
 *
 * ~1.1 s at 17 points and `pupilSamples` 21, of which about half is the two
 * traced bisections. Keyed on the aperture, the glass and the sampling — on
 * nothing block 1's sliders touch, because none of them changes a cone angle.
 */
export function opticsSweep(request: OpticsSweepRequest): OpticsSweep {
  const started = performance.now();
  const { apertureMm, glassMm, pupilSamples } = request;

  const bareAt = (focalRatio: number): SigmaReadout => {
    try {
      return sigmaOf(
        achromaticObjective({ apertureMm, focalRatio }).prescription,
        apertureMm,
        pupilSamples,
      );
    } catch (cause) {
      return { ok: false, reason: (cause as Error).message, lost: 0 };
    }
  };
  const glassedSigmaAt = (focalRatio: number): SigmaReadout => {
    if (glassMm <= 0) return bareAt(focalRatio);
    try {
      const p = achromaticObjective({ apertureMm, focalRatio }).prescription;
      return sigmaOf(glassedAt(p, glassMm), apertureMm, pupilSamples);
    } catch (cause) {
      return { ok: false, reason: (cause as Error).message, lost: 0 };
    }
  };
  const valueOf = (s: SigmaReadout): number | null => (s.ok ? s.sigmaWaves : null);

  const span = request.maxRatio - request.minRatio;
  const points: OpticsPoint[] = [];
  for (let i = 0; i < request.points; i++) {
    const focalRatio = request.minRatio + (span * i) / (request.points - 1);
    const bare = bareAt(focalRatio);
    const glassed = glassedSigmaAt(focalRatio);
    points.push({
      focalRatio,
      bare,
      glassed,
      measuredPlateWaves: bare.ok && glassed.ok ? glassed.sigmaWaves - bare.sigmaWaves : null,
      closedPlateWaves: closedPlateWaves(glassMm, focalRatio),
      exactOverThird: exactOverThird(glassMm, focalRatio),
    });
  }

  const lo = request.minRatio;
  const hi = request.maxRatio;
  const noGlass: Crossing = { focalRatio: null, reason: "there is no glass in the chain" };
  return {
    points,
    plateRayleigh:
      glassMm > 0
        ? bisect((f) => exactPlatePeakWaves(glassMm, f), RAYLEIGH_PEAK_WAVES, lo, hi)
        : noGlass,
    plateMarechal:
      glassMm > 0 ? bisect((f) => closedPlateWaves(glassMm, f), MARECHAL_WAVES, lo, hi) : noGlass,
    bareMarechal: bisect((f) => valueOf(bareAt(f)), MARECHAL_WAVES, lo, hi, 24),
    glassedMarechal: bisect((f) => valueOf(glassedSigmaAt(f)), MARECHAL_WAVES, lo, hi, 24),
    positionNull: positionNull(apertureMm, glassMm, pupilSamples, 0.5 * (lo + hi)),
    elapsedMs: performance.now() - started,
  };
}

/**
 * § 5u.2's identity, measured rather than assumed: the same glass at two very
 * different places along the same cone.
 *
 * The two gaps are shares of the room available rather than the rung's own 50 mm
 * and 600 mm, because the room depends on the focal ratio and a constant would
 * refuse to fit at the fast end. What is measured is the same statement.
 */
export function positionNull(
  apertureMm: number,
  glassMm: number,
  pupilSamples: number,
  focalRatio: number,
): PositionNull {
  const empty: PositionNull = {
    nearGapMm: 0,
    farGapMm: 0,
    nearSigmaWaves: null,
    farSigmaWaves: null,
    differenceWaves: null,
    focalRatio,
  };
  if (glassMm <= 0) return empty;
  try {
    const p = achromaticObjective({ apertureMm, focalRatio }).prescription;
    const room = trailingRoomMm(p) - glassMm;
    const near = sigmaOf(glassedAt(p, glassMm, 0.05), apertureMm, pupilSamples);
    const far = sigmaOf(glassedAt(p, glassMm, 0.9), apertureMm, pupilSamples);
    return {
      nearGapMm: room * 0.05,
      farGapMm: room * 0.9,
      nearSigmaWaves: near.ok ? near.sigmaWaves : null,
      farSigmaWaves: far.ok ? far.sigmaWaves : null,
      differenceWaves: near.ok && far.ok ? Math.abs(far.sigmaWaves - near.sigmaWaves) : null,
      focalRatio,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Block 3 — the colour a budget made of lengths cannot see. Eighteen paraxial
// solves, ~5 ms, so it runs on the main thread.
// ---------------------------------------------------------------------------

export interface GlassPair {
  readonly label: string;
  readonly crownMedium: string;
  readonly flintMedium: string;
}

/** § 5j's crown/flint pair and § 5k's ED one — the two § 5u.5 measured. */
export const GLASS_PAIRS: readonly GlassPair[] = [
  { label: "N-BK7 / F2", crownMedium: "N-BK7", flintMedium: "F2" },
  { label: "CaF₂ / N-BK7 (ED)", crownMedium: "CAF2", flintMedium: "N-BK7" },
];

export interface ColourPoint {
  readonly wavelengthNm: number;
  /** Paraxial focus (mm), against the d-line focus of the SAME curve. */
  readonly bareMm: number;
  readonly glassedMm: number;
}

export type ColourCurve =
  | {
      readonly ok: true;
      readonly label: string;
      readonly points: readonly ColourPoint[];
      /** F − C, bare and glassed. A doublet's residual, so its sign is the lens's. */
      readonly bareSpreadMm: number;
      readonly glassedSpreadMm: number;
      /** What the plate moved it by — identical across pairs; the plate does not know. */
      readonly addedMm: number;
      readonly reduced: boolean;
    }
  | { readonly ok: false; readonly label: string; readonly reason: string };

export interface ColourReadout {
  readonly curves: readonly ColourCurve[];
  /** 2λ(f/#)² (mm) — what a budget made of lengths would have to resolve to see this. */
  readonly depthOfFocusMm: number;
  readonly focalRatio: number;
  readonly elapsedMs: number;
}

const COLOUR_SAMPLES = 9;

export function colourReadout(
  apertureMm: number,
  focalRatio: number,
  glassMm: number,
): ColourReadout {
  const started = performance.now();
  const curves: ColourCurve[] = [];
  for (const pair of GLASS_PAIRS) {
    try {
      const obj = achromaticObjective({
        apertureMm,
        focalRatio,
        crownMedium: pair.crownMedium,
        flintMedium: pair.flintMedium,
      });
      const spliced = glassMm > 0 ? glassedAt(obj.prescription, glassMm) : obj.prescription;
      const at = (nm: number, p: Prescription): number =>
        bestFocus(systemOf(p, apertureMm, nm), "paraxial").z;
      const bareRef = at(LAMBDA_NM, obj.prescription);
      const glassedRef = at(LAMBDA_NM, spliced);
      const points: ColourPoint[] = [];
      for (let i = 0; i < COLOUR_SAMPLES; i++) {
        const wavelengthNm = LINE_F + ((LINE_C - LINE_F) * i) / (COLOUR_SAMPLES - 1);
        points.push({
          wavelengthNm,
          bareMm: at(wavelengthNm, obj.prescription) - bareRef,
          glassedMm: at(wavelengthNm, spliced) - glassedRef,
        });
      }
      const bareSpreadMm = at(LINE_F, obj.prescription) - at(LINE_C, obj.prescription);
      const glassedSpreadMm = at(LINE_F, spliced) - at(LINE_C, spliced);
      curves.push({
        ok: true,
        label: pair.label,
        points,
        bareSpreadMm,
        glassedSpreadMm,
        addedMm: glassedSpreadMm - bareSpreadMm,
        reduced: Math.abs(glassedSpreadMm) < Math.abs(bareSpreadMm),
      });
    } catch (cause) {
      curves.push({ ok: false, label: pair.label, reason: (cause as Error).message });
    }
  }
  return {
    curves,
    depthOfFocusMm: 2 * LAMBDA_NM * 1e-6 * focalRatio * focalRatio,
    focalRatio,
    elapsedMs: performance.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Block 4 — the ceiling that comes from a mount. Traced solves, second worker.
// ---------------------------------------------------------------------------

/** Newton's x′ the DIN magnification is quoted against (mm). */
export const X_PRIME_MM = OPTICAL_TUBE_LENGTH_MM.din;

/** Which refusal is binding at a magnification — and they are not the same wall. */
export type MountVerdict =
  /** The objective builds and the standard holds it. */
  | "fits"
  /** § 5u.7: the glass and its working distance do not fit inside the standard. */
  | "mount"
  /** § 6b.5's aperture wall: `achromaticObjective` cannot build this lens at all. */
  | "doublet";

export interface BarrelPoint {
  readonly magnification: number;
  readonly verdict: MountVerdict;
  /** Shoulder → first vertex (mm). Present only when the verdict is `fits`. */
  readonly barrelMm: number | null;
  readonly objectDistanceMm: number | null;
  readonly glassLengthMm: number | null;
}

export interface MountSweepRequest {
  readonly numericalAperture: number;
  readonly parfocalDistanceMm: number;
  readonly minMagnification: number;
  readonly maxMagnification: number;
  readonly points: number;
}

export interface MountSweep {
  readonly points: readonly BarrelPoint[];
  /** [x′ + √(x′² + 4Px′)]/2P — the thin-lens floor, before any glass. § 5u's 4.1387. */
  readonly thinLensFloor: number;
  /**
   * The lowest magnification that actually fits, bisected on the refusal.
   * `null` when the mount is not what is binding, which is a different wall and
   * `floorVerdictBelow` names it.
   */
  readonly measuredFloor: number | null;
  readonly floorVerdictBelow: MountVerdict | null;
  /** measuredFloor / thinLensFloor — what the glass costs, as a factor. */
  readonly glassPenalty: number | null;
  /**
   * The lowest magnification at which a doublet exists at all, bisected over the
   * swept range — § 6b.5's aperture wall on this axis. `null` when the whole
   * range builds, which is the answer at every NA a DIN objective is made at.
   * Carried beside the mount floor so the panel can say *which* wall is binding
   * rather than reporting whichever exception it caught.
   */
  readonly doubletFloor: number | null;
  readonly elapsedMs: number;
}

const glassLengthOf = (p: Prescription): number =>
  p.surfaces.slice(0, -1).reduce((a, s) => a + s.thickness, 0);

/**
 * The thin-lens mount floor for a **telecentric** single group (§ 6ai).
 *
 * A lens working at magnification M stands off its object by x′(M+1)/M², and
 * that alone gives the older floor [x′ + √(x′² + 4Px′)]/(2P) — which is what
 * this returned while the objective carried its stop on its front vertex. The
 * shipped objective's stop is a diaphragm on the back focal plane, so it does
 * not END at its last glass vertex: it ends a focal length x′/M further back,
 * and the mount has to contain that too. The budget becomes
 *
 *     x′(M+1)/M² + x′/M ≤ P   →   P·M² − 2x′M − x′ = 0
 *
 * which is 7.134× for the DIN pair where the single-group form gives 4.139×.
 * `singleGroupThinLensFloor` keeps the older one, because the panel plots both
 * and the gap between them IS the diaphragm's standoff.
 */
export const thinLensFloor = (parfocalDistanceMm: number, xPrime = X_PRIME_MM): number =>
  (xPrime + Math.sqrt(xPrime * xPrime + parfocalDistanceMm * xPrime)) / parfocalDistanceMm;

/** The pre-§ 6ai form: the glass alone, with no diaphragm standing behind it. */
export const singleGroupThinLensFloor = (
  parfocalDistanceMm: number,
  xPrime = X_PRIME_MM,
): number =>
  (xPrime + Math.sqrt(xPrime * xPrime + 4 * parfocalDistanceMm * xPrime)) /
  (2 * parfocalDistanceMm);

/**
 * Build one objective and ask the standard whether it fits.
 *
 * **The two refusals are told apart**, and that is this block's whole discipline:
 * `DoubletApertureRefusal` is § 6b.5's aperture wall — the lens cannot be made at
 * all — while a `parfocalBarrelLengthMm` throw is § 5u.7's mount. A bisection
 * that caught both as one exception reports a mount ceiling of 12.6× at NA 0.25,
 * when what is happening there is that no doublet exists.
 */
export function barrelAt(
  magnification: number,
  numericalAperture: number,
  parfocalDistanceMm: number,
): BarrelPoint {
  let objective;
  try {
    objective = finiteConjugateObjective({ magnification, numericalAperture });
  } catch (cause) {
    if (cause instanceof DoubletApertureRefusal) {
      return {
        magnification,
        verdict: "doublet",
        barrelMm: null,
        objectDistanceMm: null,
        glassLengthMm: null,
      };
    }
    throw cause;
  }
  const glassLengthMm = glassLengthOf(objective.prescription);
  try {
    const barrelMm = parfocalBarrelLengthMm({
      parfocalDistanceMm,
      objectDistanceMm: objective.objectDistanceMm,
      glassLengthMm,
    });
    return {
      magnification,
      verdict: "fits",
      barrelMm,
      objectDistanceMm: objective.objectDistanceMm,
      glassLengthMm,
    };
  } catch {
    return {
      magnification,
      verdict: "mount",
      barrelMm: null,
      objectDistanceMm: objective.objectDistanceMm,
      glassLengthMm,
    };
  }
}

/**
 * The barrel against magnification, and the floor bisected on the refusal.
 *
 * ~0.7 s at 13 points plus the search where the objective builds, and **~6 s
 * where it does not** — a `DoubletApertureRefusal` costs a whole failed bending
 * scan, so the sweep is slowest exactly where its answer is "the mount is not
 * what is binding". A6's move otherwise: § 5u's 4.236 is a number in the
 * validation ladder and not an engine export, so the panel asks the constructor
 * where it starts refusing rather than transcribing it.
 */
export function mountSweep(request: MountSweepRequest): MountSweep {
  const started = performance.now();
  const { numericalAperture, parfocalDistanceMm } = request;
  const span = request.maxMagnification - request.minMagnification;
  const points: BarrelPoint[] = [];
  for (let i = 0; i < request.points; i++) {
    const magnification = request.minMagnification + (span * i) / (request.points - 1);
    points.push(barrelAt(magnification, numericalAperture, parfocalDistanceMm));
  }

  const floor = thinLensFloor(parfocalDistanceMm);
  const verdict = (M: number): MountVerdict =>
    barrelAt(M, numericalAperture, parfocalDistanceMm).verdict;

  // Where the glass pair stops admitting a lens at all. Bisected on the same
  // axis and reported whether or not the mount floor exists, because "the mount
  // is not what is binding" is only a statement if the other wall has a number.
  const doubletFloor = ((): number | null => {
    let lo = request.minMagnification;
    let hi = request.maxMagnification;
    if (verdict(lo) !== "doublet") return null;
    if (verdict(hi) === "doublet") return null;
    for (let i = 0; i < 20; i++) {
      const mid = 0.5 * (lo + hi);
      if (verdict(mid) === "doublet") lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  })();

  const done = (
    measuredFloor: number | null,
    floorVerdictBelow: MountVerdict | null,
  ): MountSweep => ({
    points,
    thinLensFloor: floor,
    measuredFloor,
    floorVerdictBelow,
    glassPenalty: measuredFloor === null ? null : measuredFloor / floor,
    doubletFloor,
    elapsedMs: performance.now() - started,
  });

  // The thin-lens floor is a hard lower bound on the mount constraint — a real
  // group stands off further than a thin one — so it is where the bracket
  // starts. If the objective does not even build there, the mount is not what is
  // binding, and the sweep says so rather than bisecting something else.
  let lo = floor;
  const below = verdict(lo);
  if (below !== "mount") return done(null, below);

  let hi = lo;
  let bracketed = false;
  let above: MountVerdict = below;
  for (let i = 0; i < 12; i++) {
    hi *= 1.2;
    above = verdict(hi);
    if (above === "fits") {
      bracketed = true;
      break;
    }
    if (above === "doublet") break;
    lo = hi;
  }
  if (!bracketed) return done(null, above);

  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    if (verdict(mid) === "fits") hi = mid;
    else lo = mid;
  }
  return done(0.5 * (lo + hi), "mount");
}

// ---------------------------------------------------------------------------
// Worker message shapes.
// ---------------------------------------------------------------------------

export interface OpticsJob {
  readonly seq: number;
  readonly request: OpticsSweepRequest;
}
export interface OpticsDone {
  readonly seq: number;
  readonly result: OpticsSweep;
}
export interface MountJob {
  readonly seq: number;
  readonly request: MountSweepRequest;
}
export interface MountDone {
  readonly seq: number;
  readonly result: MountSweep;
}

/** σ as a share of the Maréchal budget — the currency every readout here is in. */
export const budgetShare = (sigmaWaves: number): number => sigmaWaves / MARECHAL_WAVES;
