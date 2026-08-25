import { LINE_D } from "@telemicroscope/core/materials";
import type { Prescription } from "@telemicroscope/core/trace";
import {
  achromaticObjective,
  apochromaticObjective,
  frontFocalDistance,
  telecentricStop,
  type TelecentricPlacement,
} from "@telemicroscope/core/designs";
import { TRIPLET_SPEC } from "./editor";
import { AppRefusal, refused, type Refused } from "./refusal";

/**
 * The stop that is a millimetre — `designs/telecentric`'s first caller anywhere
 * in `packages/app`.
 *
 * VALIDATION § 6ar shipped two `designs/` entries and this app offered neither.
 * Half of that closed when the cemented triplet became the bench editor's fifth
 * seed (APP.md Part E, E2); `designs/telecentric` had no caller at all, and the
 * ladder's own queue says so in those words. This file is that caller. It is the
 * `curvature.ts` shape for the second time: a validated capability whose numbers
 * had nowhere to be read.
 *
 * **No engine capability is added and no rung is appropriate.** Everything here
 * is `telecentricStop` plus arithmetic on what it returns, so what the tests pin
 * is the wiring and the claims the panel makes — Part F's precedent, which says
 * a ladder rung for app wiring would be a category error.
 *
 * ## Why the lens and the placement are two controls
 *
 * `designs/telecentric` refuses to be a preset list, and says why in its own
 * header: § 6aq measured that the tail and the stop distance are **independent
 * knobs**. The glass decides how many times FFD(λ) — the front focal distance,
 * which is where a stop has to sit — turns around inside the band; the placement
 * decides whether a pole is crossed or merely touched. A control offering
 * "singlet telecentric / doublet telecentric / triplet telecentric" would fuse
 * them back together and hide the finding the entry exists to state. So `tail`
 * and `placement` are separate, and every combination of the two is reachable —
 * including the ones that refuse.
 *
 * ## The count is arithmetic, and the panel shows the bound rather than a rule
 *
 * A curve with k interior turns meets a horizontal line at most k+1 times. That
 * bounds how many wavelengths one fixed stop can be telecentric at, and § 6ap's
 * deferral got it wrong in this exact place — it predicted four crossings from
 * two turns, which needs three. `crossingBound` is `turns.length + 1` and the
 * panel prints the count against it. The bound is **not tight**: the steep
 * branch of the same triplet has one turn and one crossing, because its turn
 * sits at the blue edge of the band where the curve never comes back.
 *
 * ## What is quoted to how many digits — two floors, and the coarser wins
 *
 * This is the part with a history. § 6aq.4 pinned a crossing to nine decimals on
 * the argument that a sign change is exact; § 6ar found that nine was the
 * *bracket* — the same lens from five brackets spreads 1.6e−9 nm. A panel that
 * printed `telecentricWavelengthsNm` raw would commit that error on screen at
 * sixteen digits instead of nine, so nothing here is displayed to more digits
 * than something measured supports. Two different limits set that:
 *
 *  - **What the search located.** `telecentricStop` returns `crossingUncertaintyNm`
 *    and `turnUncertaintyNm`, each the spread of its own search run from five
 *    brackets. Turns are a √ε business — near a turn the curve is flat, so
 *    wavelengths far apart give focal distances a double cannot tell apart — and
 *    their spread (1e−4 nm and up) swamps everything else. Crossings are an ε
 *    business and theirs is ~1e−10 nm.
 *  - **What the arithmetic can carry.** FFD(λ) minus the placement is a
 *    difference of two numbers near 53 mm, so it holds nothing below 53·ε, and
 *    dividing that by the slope the curve crosses at gives a floor in
 *    wavelength. On the triplet's d-line crossing this computes to 4.147e−10 nm,
 *    which is § 6ar's own stated 4.15e−10 — the derivation is that step's, not
 *    this file's, and reproducing it is a check rather than a claim.
 *
 * A `"double"` entry is not bisected at all — `telecentricStop` adds it from the
 * placement, since a touched pole has no sign change to find — so its
 * uncertainty is the **turn's**, four orders coarser than a crossing's. Quoting
 * it against the crossing spread would be quoting a number to a precision from
 * the wrong search.
 *
 * ## And a third limit, which is the one this panel found
 *
 * Those two are not enough, and the panel's own free check is what says so. A
 * `"frontFocal"` placement puts the stop at FFD(λ₀), so **λ₀ is a root by
 * construction** — it has to come back as one of the crossings, and the distance
 * between the one that comes back and λ₀ is a *measured* error of the search
 * against a known answer, not an estimate of one. On two of the four tails that
 * miss is **larger than the five-bracket spread**: 1.75e−10 nm against 1.00e−10
 * on the achromat, and 1.87e−9 against 6.90e−10 on § 6ar's triplet, whose d-line
 * crossing has the shallowest slope of any here. The bracket spread understates
 * the error because five brackets that all bottom out on the same flat patch of
 * a numerically-zero function agree with each other about a wrong answer.
 *
 * It is the same shape § 6ar found in § 6aq — a precision claim resting on the
 * search that produced it — one rung further in: § 6ar replaced "a sign is
 * exact" with a measured spread, and the spread is itself optimistic wherever
 * the curve is flat. The arithmetic floor is the honest *lower* bound (it
 * predicts 4.147e−10 on that same crossing, and the round trip is 4.5× it) and
 * it is a bound rather than an estimate, which is why all three are kept.
 *
 * So the reported uncertainty is the largest of the three that apply, and
 * `limitedBy` says which won. Each of them wins somewhere across the four tails:
 * arithmetic on the singlet (whose five brackets agree bitwise, and a measured
 * spread of zero is not a statement that the answer is exact), the round trip on
 * the achromat and the triplet, and the bracket spread on the steep branch. A
 * rule that only ever fired one way would not have been tested by anything.
 *
 * ## The stop's own aperture is the tail's, not the fixtures' 30 mm
 *
 * `stopSemiApertureMm` defaults to 30 because that is what §§ 6ak–6aq's fixtures
 * use. On the 5 mm triplet that is a twelvefold oversize dummy sitting in front
 * of the lens as the system's only stop, and `trace/system` takes the first
 * flagged surface — harmless for everything on this panel, which is paraxial and
 * aperture-free, and wrong for any spot or picture a later surface might draw
 * from the same prescription. It is passed the tail's own first semi-aperture
 * instead, and `telecentric.test.ts` pins that every reported number is bitwise
 * identical either way, which is what makes the substitution free.
 *
 * ## Cost
 *
 * 4.5–8 ms per tail, measured in node: the coarse walks are 4 200 and 8 400
 * evaluations of a two-ray paraxial trace, and the searches are 200 iterations
 * each. Inline, no worker, on `curvature.tsx`'s precedent — and the whole
 * four-tail survey below is ~25 ms, which is why the panel can afford to run
 * every tail on every frame rather than quote three of them from prose.
 */

/** The band the panel opens on — `telecentricStop`'s own default. */
export const DEFAULT_BAND_NM: readonly [number, number] = [380, 800];

/** Curve samples across the band, for the plot. Geometry-neutral. */
export const CURVE_SAMPLES = 241;

/**
 * The widest band this panel will search (nm) — the app's own bound, and the
 * only other place its voice is heard.
 *
 * `telecentricStop` walks the band at a **fixed** 0.1 nm for the turns and
 * 0.05 nm for the crossings, so cost is linear in the width and the engine has
 * no reason to care: a caller running one search offline can afford any window
 * it likes. A panel with a free-typed field can not. At the default 420 nm the
 * whole thing is 4.5–8 ms; at 2 000 nm it is under 40, which is still a frame,
 * and a mistyped exponent past that would hang the tab rather than be slow.
 *
 * Stated as a span rather than as end stops because that is what the cost is
 * proportional to — a 200…2 200 nm window is exactly as expensive as 380…2 380.
 */
export const MAX_BAND_SPAN_NM = 2000;

/**
 * The app's sentence about the band, or nothing. Checked by both entry points
 * here, and by the panel before it calls either, so a refused band never reaches
 * a search.
 */
export function bandRefusal(bandNm: readonly [number, number]): string | undefined {
  const [from, to] = bandNm;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined; // the engine's to refuse
  if (to - from > MAX_BAND_SPAN_NM) {
    return `this panel searches at most ${MAX_BAND_SPAN_NM} nm of band at a time and was asked for ${Math.round(to - from)} — the walk is at a fixed 0.1 nm step, so a window this wide is a cost bound rather than anything the engine objects to`;
  }
  return undefined;
}

export type TailId = "singlet" | "achromat" | "apochromat" | "apochromat-steep";

export interface Tail {
  readonly id: TailId;
  readonly label: string;
  /** One line: what this glass does to the shape of FFD(λ). */
  readonly note: string;
  readonly prescription: Prescription;
  /** The tail's own first semi-aperture (mm) — what the stop dummy is given. */
  readonly semiApertureMm: number;
}

/**
 * § 6an's singlet — one glass, FFD(λ) monotone, no turn to place at.
 *
 * Spelled here because it is a bare two-surface prescription with no
 * constructor behind it: this is `telecentric-design.test.ts`'s own fixture, the
 * tail § 6an's whole story runs on, and there is nothing to import.
 */
const SINGLET: Prescription = {
  surfaces: [
    { kind: "refract", curvature: 1 / 40, semiAperture: 20, thickness: 9, medium: "N-BK7" },
    { kind: "refract", curvature: -1 / 80, semiAperture: 20, thickness: 0, medium: "AIR" },
  ],
};

/**
 * The four tails, built once.
 *
 * The doublet and the two triplet branches share the triplet's aperture, focal
 * ratio and object distance, so what separates their curves is the glass count
 * and the bending and nothing else — which is the comparison the panel is for.
 * The singlet does not: it is § 6an's own lens at its own scale, and pretending
 * otherwise would be inventing a fixture the ladder never traced.
 */
const TAILS: readonly Tail[] = [
  {
    id: "singlet",
    label: "N-BK7 singlet",
    note: "one glass — FFD(λ) is monotone across the visible, so there is no turn and one crossing",
    prescription: SINGLET,
    semiApertureMm: 20,
  },
  {
    id: "achromat",
    label: "N-BK7/F2 achromat, f = 53",
    note: "two glasses unite two colours, and FFD(λ) turns once — so one stop can be telecentric twice",
    prescription: achromaticObjective({
      apertureMm: TRIPLET_SPEC.apertureMm,
      focalRatio: TRIPLET_SPEC.focalRatio,
      objectDistanceMm: TRIPLET_SPEC.objectDistanceMm,
    }).prescription,
    semiApertureMm: TRIPLET_SPEC.apertureMm / 2,
  },
  {
    id: "apochromat",
    label: "CaF₂/F2/BK7 apochromat, f = 53",
    note: "§ 6ar's cemented triplet — three colours united, two turns, and three crossings",
    prescription: apochromaticObjective(TRIPLET_SPEC).prescription,
    semiApertureMm: TRIPLET_SPEC.apertureMm / 2,
  },
  {
    id: "apochromat-steep",
    label: "the same triplet, steep branch",
    note: "the same three powers bent the other way — one turn, at the blue edge, and the bound is not reached",
    prescription: apochromaticObjective({ ...TRIPLET_SPEC, branch: "steep" }).prescription,
    semiApertureMm: TRIPLET_SPEC.apertureMm / 2,
  },
];

export const tails = (): readonly Tail[] => TAILS;

export const tailOf = (id: TailId): Tail => {
  const found = TAILS.find((t) => t.id === id);
  if (found === undefined) throw new AppRefusal(`no such tail: ${id}`);
  return found;
};

/** Where the stop goes — the app's spelling of `TelecentricPlacement`. */
export type PlacementChoice =
  | { readonly kind: "frontFocal"; readonly wavelengthNm: number }
  | { readonly kind: "turn"; readonly index: number }
  | { readonly kind: "distance"; readonly stopToVertexMm: number };

export interface TelecentricSpec {
  readonly tail: TailId;
  readonly placement: PlacementChoice;
  readonly bandNm: readonly [number, number];
  readonly curveSamples: number;
}

/**
 * What limited a quoted wavelength.
 *
 *  - `"search"` — the spread of the same search from five brackets.
 *  - `"arithmetic"` — what a double can carry, given the slope the curve crosses
 *    at. A lower bound on the error, never an estimate of it.
 *  - `"round trip"` — the distance between the design wavelength and the
 *    crossing that has to be it. The only one of the three measured against a
 *    known answer.
 */
export type PrecisionLimit = "search" | "arithmetic" | "round trip";

/** A wavelength with the digits it has earned, and what set the limit. */
export interface QuotedNm {
  readonly nm: number;
  readonly uncertaintyNm: number;
  readonly limitedBy: PrecisionLimit;
  /** The value, rounded to the last digit the uncertainty supports. */
  readonly text: string;
}

/** A wavelength the stop is telecentric at, and the order of the pole there. */
export type Crossing = QuotedNm & { readonly order: "simple" | "double" };

export interface TelecentricReading {
  readonly ok: true;
  readonly tail: TailId;
  /** The gap from the stop to the tail's first vertex (mm) — the whole design. */
  readonly stopToVertexMm: number;
  readonly designWavelengthNm: number;
  readonly frontFocalDistanceMm: number;
  readonly imageDistanceMm: number;
  readonly bandNm: readonly [number, number];
  readonly crossings: readonly Crossing[];
  readonly turns: readonly QuotedNm[];
  /** `turns.length + 1` — the most crossings a horizontal line can have. */
  readonly crossingBound: number;
  /** FFD(λ) across the band: (nm, mm). The curve the placement is a line across. */
  readonly curve: readonly (readonly [number, number])[];
  /**
   * The gap between the two placements — the stop at FFD(d) and the stop at the
   * first turn (mm). `undefined` when the tail has no turn. § 6ap calls its
   * 3.8 µm "the entire design decision, and a number a mount has to hold".
   */
  readonly placementGapMm: number | undefined;
  /**
   * How far the crossing search misses the wavelength the placement was BUILT
   * at (nm) — a measured error against a known answer, since FFD(λ₀) is where
   * the stop went and λ₀ is therefore a root. `undefined` for a placement with
   * no such wavelength: a `"turn"`'s double root is added rather than searched
   * for, and a `"distance"` has no root it is entitled to.
   */
  readonly designWavelengthMissNm: number | undefined;
  /**
   * The arithmetic floor at that same crossing (nm), so the panel can print the
   * ratio: the floor is what a double can carry and the miss is what the search
   * actually did, and the second is 3–5× the first on the tails here.
   */
  readonly designWavelengthFloorNm: number | undefined;
  readonly elapsedMs: number;
}

export type TelecentricResult = TelecentricReading | Refused;

/**
 * How many decimals a measured uncertainty supports.
 *
 * The uncertainty's own leading digit sets the place: 5.6e−4 nm means the fourth
 * decimal is the last one that means anything, so 498.7620691636049 is quoted as
 * 498.7621 and § 6aq's "498.76" is inside it. Refuses a non-positive spread
 * rather than inventing a precision — every caller here computes a positive
 * floor first, so reaching this with zero is a bug and not a display case.
 */
export function quotedDecimals(uncertaintyNm: number): number {
  if (!(uncertaintyNm > 0) || !Number.isFinite(uncertaintyNm)) {
    throw new AppRefusal(
      `quotedDecimals: an uncertainty of ${uncertaintyNm} nm states no precision, so there are no digits to quote`,
    );
  }
  return Math.max(0, Math.min(100, -Math.floor(Math.log10(uncertaintyNm))));
}

const quoted = (nm: number, uncertaintyNm: number, limitedBy: PrecisionLimit): QuotedNm => ({
  nm,
  uncertaintyNm,
  limitedBy,
  text: nm.toFixed(quotedDecimals(uncertaintyNm)),
});

/**
 * What a double can carry at a crossing, in nanometres.
 *
 * § 6ar's own derivation, evaluated rather than restated: the bisected function
 * is FFD(λ) − the placement, a difference of two numbers of size
 * `stopToVertexMm`, so it holds nothing below `stopToVertexMm·ε`; divide by the
 * slope the curve crosses at and the result is a wavelength. The slope is a
 * central difference at the search's own 0.05 nm step.
 *
 * `frontFocalDistance` is fed the tail as it stands rather than with its
 * trailing thickness stripped: a translation after the last surface leaves the C
 * and D elements of the ray-transfer matrix alone, and −D/C is all this reads.
 * `telecentric.test.ts` pins that the two spellings agree bitwise.
 */
const crossingFloorNm = (tail: Prescription, nm: number, stopToVertexMm: number): number => {
  const h = 0.05;
  const slope = (frontFocalDistance(tail, nm + h) - frontFocalDistance(tail, nm - h)) / (2 * h);
  return (Math.abs(stopToVertexMm) * Number.EPSILON) / Math.abs(slope);
};

/**
 * The floor under both floors: the gap between adjacent doubles at this
 * wavelength. Never the binding limit in practice, and it is here so that
 * `quotedDecimals` is never handed a zero — a search whose five brackets agreed
 * bitwise has measured that its spread is *below what it can see*, which is not
 * the same statement as "exact".
 */
const representableFloorNm = (nm: number): number => Math.abs(nm) * Number.EPSILON;

const toPlacement = (choice: PlacementChoice): TelecentricPlacement =>
  choice.kind === "frontFocal"
    ? { kind: "frontFocal", wavelengthNm: choice.wavelengthNm }
    : choice.kind === "turn"
      ? { kind: "turn", index: choice.index }
      : { kind: "distance", stopToVertexMm: choice.stopToVertexMm };

export function placeTelecentricStop(spec: TelecentricSpec): TelecentricResult {
  const started = performance.now();
  try {
    const tail = tailOf(spec.tail);
    const [from, to] = spec.bandNm;
    if (!Number.isInteger(spec.curveSamples) || spec.curveSamples < 2) {
      throw new AppRefusal(
        `this panel draws the curve from at least two samples (asked for ${spec.curveSamples})`,
      );
    }
    const tooWide = bandRefusal([from, to]);
    if (tooWide !== undefined) throw new AppRefusal(tooWide);
    // The app's own bound, and the one place its voice is heard rather than the
    // engine's. `telecentricStop` will happily place a stop at FFD(λ₀) for a λ₀
    // outside the band — it is a distance like any other — but then the design
    // wavelength is not among the crossings this panel searched, and every
    // sentence on screen about "where this stop is telecentric" is answering a
    // question the reader did not ask. The engine has no opinion here because
    // the band is a search window, not a property of the lens.
    if (
      spec.placement.kind === "frontFocal" &&
      Number.isFinite(spec.placement.wavelengthNm) &&
      (spec.placement.wavelengthNm < from || spec.placement.wavelengthNm > to)
    ) {
      throw new AppRefusal(
        `the design wavelength ${spec.placement.wavelengthNm} nm is outside the ${from}…${to} nm band this panel searches, so the stop would be placed at a colour none of the readouts below cover`,
      );
    }

    const placed = telecentricStop({
      tail: tail.prescription,
      placement: toPlacement(spec.placement),
      bandNm: [from, to],
      stopSemiApertureMm: tail.semiApertureMm,
    });

    // The turn spread runs 1e−4 nm and up on every tail here, so `search` is
    // what labels these in practice — but the label is derived rather than
    // asserted, because a tail whose brackets happened to agree would otherwise
    // be labelled with a search that measured nothing.
    const turns = placed.turningPointsNm.map((nm) => {
      const floor = representableFloorNm(nm);
      return quoted(
        nm,
        Math.max(placed.turnUncertaintyNm, floor),
        placed.turnUncertaintyNm >= floor ? "search" : "arithmetic",
      );
    });

    /**
     * The crossing the placement is entitled to, and how far off it landed.
     *
     * Only a `"frontFocal"` placement has one: the stop went to FFD(λ₀), so λ₀
     * is a root of FFD(λ) − stop by construction and the bisection has a known
     * answer to be judged against. The nearest crossing IS that root — the
     * others are nanometres away and this miss is picometres — but it is found
     * by distance rather than by index, because a tail whose curve happens to
     * pass the same level twice near λ₀ would otherwise be matched by position
     * in a list.
     */
    const entitledNm =
      spec.placement.kind === "frontFocal" ? spec.placement.wavelengthNm : undefined;
    let designWavelengthMissNm: number | undefined;
    let designWavelengthFloorNm: number | undefined;
    if (entitledNm !== undefined && placed.telecentricWavelengthsNm.length > 0) {
      const nearest = placed.telecentricWavelengthsNm.reduce((a, b) =>
        Math.abs(a - entitledNm) <= Math.abs(b - entitledNm) ? a : b,
      );
      designWavelengthMissNm = Math.abs(nearest - entitledNm);
      designWavelengthFloorNm = crossingFloorNm(
        tail.prescription,
        nearest,
        placed.stopToVertexMm,
      );
    }

    const crossings: Crossing[] = placed.telecentricWavelengthsNm.map((nm, i) => {
      const order = placed.poleOrders[i]!;
      if (order === "double") {
        // Not bisected: `telecentricStop` adds the touched pole from the
        // placement, because a double root has no sign change to find. Its
        // uncertainty is the TURN's, which is four orders coarser.
        const u = Math.max(placed.turnUncertaintyNm, representableFloorNm(nm));
        return { ...quoted(nm, u, "search"), order };
      }
      const floor = crossingFloorNm(tail.prescription, nm, placed.stopToVertexMm);
      const search = placed.crossingUncertaintyNm;
      const arithmetic = Math.max(Number.isFinite(floor) ? floor : 0, representableFloorNm(nm));
      // The round trip applies to the crossing it was measured on and to no
      // other: it is one search's error at one slope, and spreading it across
      // the list would be modelling rather than measuring.
      const roundTrip =
        designWavelengthMissNm !== undefined &&
        entitledNm !== undefined &&
        Math.abs(nm - entitledNm) === designWavelengthMissNm
          ? designWavelengthMissNm
          : 0;
      const u = Math.max(search, arithmetic, roundTrip);
      const limitedBy: PrecisionLimit =
        roundTrip === u && roundTrip > 0 ? "round trip" : search >= arithmetic ? "search" : "arithmetic";
      return { ...quoted(nm, u, limitedBy), order };
    });

    const step = (to - from) / (spec.curveSamples - 1);
    const curve: (readonly [number, number])[] = [];
    for (let i = 0; i < spec.curveSamples; i++) {
      const nm = i === spec.curveSamples - 1 ? to : from + i * step;
      curve.push([nm, frontFocalDistance(tail.prescription, nm)] as const);
    }

    // Both placements, always, when both exist — `curvature.tsx`'s rule that a
    // comparison in prose is a number that can go stale while the page still
    // looks right. This is § 6ap's 3.8 µm, read live.
    let placementGapMm: number | undefined;
    if (placed.turningPointsNm.length > 0) {
      const atLine = telecentricStop({
        tail: tail.prescription,
        bandNm: [from, to],
        stopSemiApertureMm: tail.semiApertureMm,
      });
      const atTurn = telecentricStop({
        tail: tail.prescription,
        placement: { kind: "turn", index: 0 },
        bandNm: [from, to],
        stopSemiApertureMm: tail.semiApertureMm,
      });
      placementGapMm = atLine.stopToVertexMm - atTurn.stopToVertexMm;
    }

    return {
      ok: true,
      tail: spec.tail,
      stopToVertexMm: placed.stopToVertexMm,
      designWavelengthNm: placed.designWavelengthNm,
      frontFocalDistanceMm: placed.frontFocalDistanceMm,
      imageDistanceMm: placed.imageDistanceMm,
      bandNm: [from, to],
      crossings,
      turns,
      crossingBound: placed.turningPointsNm.length + 1,
      curve,
      placementGapMm,
      designWavelengthMissNm,
      designWavelengthFloorNm,
      elapsedMs: performance.now() - started,
    };
  } catch (cause) {
    return refused(cause);
  }
}

/** What a turn placement gives on a tail, or the sentence saying there is none. */
export type TurnPlacement =
  | {
      readonly ok: true;
      /** FFD(d) minus FFD(turn 0), in mm — how far the mount moves between the two. */
      readonly gapMm: number;
      /** The order of each crossing the turn placement produces, in wavelength order. */
      readonly orders: readonly ("simple" | "double")[];
    }
  | Refused;

export interface TailSurvey {
  readonly tail: TailId;
  readonly label: string;
  readonly turns: number;
  readonly crossings: number;
  /** `turns + 1`. */
  readonly bound: number;
  readonly withinBound: boolean;
  /** True only when the bound is reached — it is a bound, not a count. */
  readonly boundReached: boolean;
  readonly turnPlacement: TurnPlacement;
}

/**
 * Every tail, walked through the count bound and the turn refusal.
 *
 * § 6ah's lesson, applied rather than cited: D6.10 walks the whole catalogue
 * because *choosing* one fixture was the failure that step found, and each of
 * §§ 6ak–6aq built its own single tail and each one hid something the next
 * found. So this reports all four, and it reports **which** refusal a tail
 * without a turn gives rather than a bare `ok === false` — a singlet's is about
 * the glass ("no turn in this band") and an out-of-range index is about the
 * request, and the two are not the same sentence.
 *
 * The `orders` column is where the survey earns its place. § 6ap.5 found that a
 * turn placement makes the whole band defocus one way, which is true of a tail
 * with **one** turn; § 6ar put the same placement on a tail with two and the
 * curve came back down to that level at the red end, so the pole is touched at
 * one wavelength and still crossed at another. A table that read the design
 * wavelength's pole order alone would print "double" for both and say the
 * opposite of what the second one does.
 */
export function surveyTails(bandNm: readonly [number, number] = DEFAULT_BAND_NM): readonly TailSurvey[] {
  // Throws rather than returning a refusal, because there is no per-row answer
  // to give: a band too wide to search is too wide for all four. Callers check
  // `bandRefusal` first — the panel does, before it calls either entry point.
  const tooWide = bandRefusal([bandNm[0], bandNm[1]]);
  if (tooWide !== undefined) throw new AppRefusal(tooWide);
  return TAILS.map((tail) => {
    const atLine = telecentricStop({
      tail: tail.prescription,
      bandNm: [bandNm[0], bandNm[1]],
      stopSemiApertureMm: tail.semiApertureMm,
    });
    let turnPlacement: TurnPlacement;
    try {
      const atTurn = telecentricStop({
        tail: tail.prescription,
        placement: { kind: "turn", index: 0 },
        bandNm: [bandNm[0], bandNm[1]],
        stopSemiApertureMm: tail.semiApertureMm,
      });
      turnPlacement = {
        ok: true,
        gapMm: atLine.stopToVertexMm - atTurn.stopToVertexMm,
        orders: atTurn.poleOrders,
      };
    } catch (cause) {
      turnPlacement = refused(cause);
    }
    const turns = atLine.turningPointsNm.length;
    const crossings = atLine.telecentricWavelengthsNm.length;
    return {
      tail: tail.id,
      label: tail.label,
      turns,
      crossings,
      bound: turns + 1,
      withinBound: crossings <= turns + 1,
      boundReached: crossings === turns + 1,
      turnPlacement,
    };
  });
}

/** The d line, so the panel's default placement is spelled once. */
export const DESIGN_LINE_NM = LINE_D;
