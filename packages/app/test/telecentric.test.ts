import { describe, it, expect } from "vitest";
import { LINE_D } from "@telemicroscope/core/materials";
import { frontFocalDistance, telecentricStop } from "@telemicroscope/core/designs";
import type { Prescription } from "@telemicroscope/core/trace";
import {
  CURVE_SAMPLES,
  DEFAULT_BAND_NM,
  DESIGN_LINE_NM,
  MAX_BAND_SPAN_NM,
  bandRefusal,
  placeTelecentricStop,
  quotedDecimals,
  surveyTails,
  tailOf,
  tails,
  type TailId,
  type TelecentricSpec,
} from "../src/telecentric";
import { benchSeeds } from "../src/editor";

/**
 * The telecentric stop panel — `designs/telecentric`'s first caller in
 * `packages/app`, and the half of the ladder's app item that had a definition.
 *
 * **No physics is added, so no ladder rung is appropriate** — Part F's own
 * precedent, which says one for app wiring would be a category error. What is
 * pinned here is the wiring and the sentences the panel puts on screen:
 *
 *  1. every tail, walked through the count bound and the turn refusal, because
 *     § 6ah's finding is that *choosing one fixture* was the failure,
 *  2. the bound is a bound and not a count — the steep branch reaches one
 *     crossing from one turn, and a panel that printed "k+1 colours" as a rule
 *     would be wrong on a quarter of its own list,
 *  3. no wavelength is displayed to more digits than something measured
 *     supports, with all three limits reached somewhere in the list, and
 *  4. the stop dummy's aperture is the tail's rather than the fixtures' 30 mm,
 *     and every number is bitwise unmoved by the substitution.
 *
 * Three numbers here are the ladder's own and are quoted rather than derived:
 * § 6ap's 3.8 µm between the two placements, § 6ar's touched-at-498.76 and
 * still-crossed-at-728.43 on the triplet, and § 6ar's 4.15e−10 nm arithmetic
 * floor at the triplet's d-line crossing.
 */

const SPEC: TelecentricSpec = {
  tail: "apochromat",
  placement: { kind: "frontFocal", wavelengthNm: DESIGN_LINE_NM },
  bandNm: DEFAULT_BAND_NM,
  curveSamples: CURVE_SAMPLES,
};

const run = (patch: Partial<TelecentricSpec> = {}) => placeTelecentricStop({ ...SPEC, ...patch });

/** The reading, or a failure naming the refusal instead of an undefined access. */
const reading = (patch: Partial<TelecentricSpec> = {}) => {
  const r = run(patch);
  if (!r.ok) throw new Error(`expected a reading, got a ${r.source} refusal: ${r.error}`);
  return r;
};

const ALL: readonly TailId[] = ["singlet", "achromat", "apochromat", "apochromat-steep"];

describe("every tail, which is the point of citing § 6ah", () => {
  /**
   * The count bound, on all four rather than on a chosen one.
   *
   * A curve with k interior turns meets a horizontal line at most k+1 times, and
   * § 6ap's deferral got this wrong in exactly this place — it predicted four
   * crossings from two turns, which needs three. The bound is arithmetic, so it
   * holds on every tail; what varies is whether it is reached.
   */
  it("holds the k+1 bound on all four, and reaches it on three", () => {
    const survey = surveyTails();
    expect(survey.map((s) => s.tail)).toEqual(ALL);
    for (const row of survey) {
      expect(row.bound).toBe(row.turns + 1);
      expect(row.withinBound).toBe(true);
      expect(row.crossings).toBeLessThanOrEqual(row.bound);
    }
    expect(survey.map((s) => [s.turns, s.crossings])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [1, 1],
    ]);
    // The one that does NOT reach it is why this is a bound and not a formula:
    // the steep branch's single turn sits at 383.6 nm, inside the band by 3.6 nm,
    // and the curve never comes back down to the d-line level afterwards.
    expect(survey.map((s) => s.boundReached)).toEqual([true, true, true, false]);
  });

  /**
   * Which refusal, not merely that one happened.
   *
   * § 6ah's D6.10 names the refusal it expects by message, because a bare
   * `ok === false` would accept a NaN as readily as the wall it exists to
   * record. Here the two refusals are about different things — a singlet has no
   * turn because of its GLASS, and turn 5 does not exist because of the REQUEST
   * — and a caller can act on the second and not on the first.
   */
  it("names which refusal a tail without a turn gives, and it is the engine's voice", () => {
    const [singlet, achromat, apochromat, steep] = surveyTails();
    expect(singlet!.turnPlacement.ok).toBe(false);
    if (singlet!.turnPlacement.ok) throw new Error("unreachable");
    expect(singlet!.turnPlacement.source).toBe("engine");
    expect(singlet!.turnPlacement.error).toMatch(/no turn in 380…800 nm/);
    expect(singlet!.turnPlacement.error).toMatch(/monotone/);
    for (const row of [achromat, apochromat, steep]) {
      expect(row!.turnPlacement.ok).toBe(true);
    }

    const outOfRange = run({ placement: { kind: "turn", index: 5 } });
    expect(outOfRange.ok).toBe(false);
    if (outOfRange.ok) throw new Error("unreachable");
    expect(outOfRange.source).toBe("engine");
    expect(outOfRange.error).toMatch(/this tail has 2 turns in 380…800 nm, so turn 5 does not exist/);
  });

  /**
   * The one sentence that is the app's own, and it is a bound the engine has no
   * opinion about: the band is this panel's search window, not a property of the
   * lens, so `telecentricStop` will happily place a stop at FFD(900 nm) and
   * report crossings that do not include it.
   */
  it("refuses a design wavelength outside its own band, in its own voice", () => {
    const outside = run({ placement: { kind: "frontFocal", wavelengthNm: 900 } });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error("unreachable");
    expect(outside.source).toBe("app");
    expect(outside.error).toMatch(/outside the 380…800 nm band this panel searches/);
    // The engine does not refuse it — which is what makes this the app's to say.
    expect(() =>
      telecentricStop({
        tail: tailOf("apochromat").prescription,
        placement: { kind: "frontFocal", wavelengthNm: 900 },
      }),
    ).not.toThrow();
  });

  /**
   * The other app-side bound, and it is on COST rather than on physics: the
   * engine walks the band at a fixed 0.1 nm, which is linear in the width and
   * fine for a caller running one search offline. A free-typed field is not, and
   * the check runs before either entry point so a refused band never pays for a
   * search it will not use.
   */
  it("refuses a band wider than it can search in a frame, before searching it", () => {
    expect(bandRefusal([380, 800])).toBeUndefined();
    expect(bandRefusal([380, 380 + MAX_BAND_SPAN_NM])).toBeUndefined();
    expect(bandRefusal([380, 380 + MAX_BAND_SPAN_NM + 1])).toMatch(/at most 2000 nm of band/);
    // Stated as a span: the same width anywhere costs the same walk.
    expect(bandRefusal([2000, 2000 + MAX_BAND_SPAN_NM + 1])).toBeDefined();

    const wide = run({ bandNm: [380, 1e6] });
    expect(wide.ok).toBe(false);
    if (wide.ok) throw new Error("unreachable");
    expect(wide.source).toBe("app");
    expect(wide.error).toMatch(/cost bound rather than anything the engine objects to/);
    // Cheap, because it refuses instead of walking ten million steps first.
    const started = performance.now();
    run({ bandNm: [380, 1e9] });
    expect(performance.now() - started).toBeLessThan(50);
    expect(() => surveyTails([380, 1e9])).toThrow(/at most 2000 nm of band/);
  });

  /** A stop that is telecentric nowhere in the band is a finding, not a refusal. */
  it("returns a reading with no crossings rather than refusing an unreachable distance", () => {
    const r = reading({ tail: "singlet", placement: { kind: "distance", stopToVertexMm: 10 } });
    expect(r.crossings).toHaveLength(0);
    expect(r.stopToVertexMm).toBe(10);
    expect(r.crossingBound).toBe(1);
  });
});

describe("the placement, and what reading one pole order would have said", () => {
  /**
   * § 6ap's 3.8 µm — "the entire design decision, and a number a mount has to
   * hold" — read live rather than quoted, on `curvature.tsx`'s rule that a
   * comparison in prose is a number that can go stale while the page still looks
   * right.
   */
  it("puts the two placements 3.8 µm apart on the achromat", () => {
    const r = reading({ tail: "achromat" });
    expect(r.placementGapMm).toBeDefined();
    expect(r.placementGapMm!).toBeCloseTo(0.0037745, 7);
    expect(Math.abs(r.placementGapMm!) * 1000).toBeGreaterThan(3.7);
    expect(Math.abs(r.placementGapMm!) * 1000).toBeLessThan(3.9);
    // The singlet has no turn, so there is no second placement to be apart from.
    expect(reading({ tail: "singlet" }).placementGapMm).toBeUndefined();
  });

  /**
   * The finding § 6ar made and none of the five fixtures could see: a turn
   * placement does not make the whole band one-directional. On a tail with ONE
   * turn it does — § 6ap.5 — and on § 6ar's triplet the curve, having turned
   * twice, comes back down to that level at the red end, so the pole is touched
   * at 498.76 nm and still CROSSED at 728.43.
   *
   * The design-wavelength pole order says `"double"` on both, which is why a
   * panel must read the per-crossing list instead.
   */
  it("touches one pole and still crosses another, where the single order says only double", () => {
    const triplet = reading({ tail: "apochromat", placement: { kind: "turn", index: 0 } });
    expect(triplet.crossings.map((c) => c.order)).toEqual(["double", "simple"]);
    expect(triplet.crossings[0]!.nm).toBeCloseTo(498.76, 2);
    expect(triplet.crossings[1]!.nm).toBeCloseTo(728.43, 2);

    const doublet = reading({ tail: "achromat", placement: { kind: "turn", index: 0 } });
    expect(doublet.crossings.map((c) => c.order)).toEqual(["double"]);

    // What the single readout would have said on both. Same word, opposite
    // statements about the band.
    for (const tail of ["achromat", "apochromat"] as const) {
      const placed = telecentricStop({
        tail: tailOf(tail).prescription,
        placement: { kind: "turn", index: 0 },
        stopSemiApertureMm: tailOf(tail).semiApertureMm,
      });
      expect(placed.poleOrder).toBe("double");
    }
  });

  /** The survey carries the same distinction, so the table cannot lie either. */
  it("carries the per-crossing orders into the survey", () => {
    const rows = surveyTails();
    const orders = rows.map((r) => (r.turnPlacement.ok ? r.turnPlacement.orders : null));
    expect(orders).toEqual([null, ["double"], ["double", "simple"], ["double"]]);
  });
});

describe("what is quoted to how many digits", () => {
  it("puts the last digit where the uncertainty's leading digit is", () => {
    expect(quotedDecimals(5.6e-4)).toBe(4);
    expect(quotedDecimals(1.3e-4)).toBe(4);
    expect(quotedDecimals(6.9e-10)).toBe(10);
    expect(quotedDecimals(2.7e-12)).toBe(12);
    expect(quotedDecimals(0.5)).toBe(1);
    expect(quotedDecimals(7)).toBe(0);
    // A spread of zero states no precision. Refusing beats inventing one, and
    // every caller in the adapter computes a positive floor before it gets here.
    expect(() => quotedDecimals(0)).toThrow(/states no precision/);
    expect(() => quotedDecimals(Number.NaN)).toThrow(/states no precision/);
  });

  /**
   * The invariant, on every wavelength this panel can put on screen: the text is
   * the value rounded to what the uncertainty supports, and parsing it back
   * lands within that uncertainty. This is the § 6aq → § 6ar lesson made
   * mechanical — the raw doubles carry sixteen digits and none of them are
   * displayed.
   */
  it("never displays a digit the uncertainty does not support, on any tail", () => {
    for (const tail of ALL) {
      const r = reading({ tail });
      const all = [...r.crossings, ...r.turns];
      expect(all.length).toBeGreaterThan(0);
      for (const q of all) {
        expect(q.uncertaintyNm).toBeGreaterThan(0);
        const decimals = (q.text.split(".")[1] ?? "").length;
        expect(decimals).toBe(quotedDecimals(q.uncertaintyNm));
        expect(Math.abs(Number(q.text) - q.nm)).toBeLessThanOrEqual(
          0.5 * 10 ** -decimals + Number.EPSILON * Math.abs(q.nm),
        );
        // And the raw value really did carry more than was shown, so this is a
        // truncation rather than a formatting no-op.
        expect(String(q.nm).length).toBeGreaterThanOrEqual(q.text.length);
      }
    }
  });

  /**
   * A `"turn"` entry is four orders coarser than a crossing, and it must be
   * quoted against the search that produced it. `telecentricStop` adds the
   * touched pole from the placement rather than bisecting for it — a double root
   * has no sign change to find — so quoting it against the crossing spread would
   * be borrowing the precision of a search that never ran on it.
   */
  it("quotes a touched pole against the turn search and not the crossing one", () => {
    const r = reading({ tail: "apochromat", placement: { kind: "turn", index: 0 } });
    const [touched, crossed] = r.crossings;
    expect(touched!.order).toBe("double");
    expect(crossed!.order).toBe("simple");
    expect(touched!.uncertaintyNm).toBeGreaterThan(1e-4);
    expect(crossed!.uncertaintyNm).toBeLessThan(1e-8);
    expect(touched!.uncertaintyNm / crossed!.uncertaintyNm).toBeGreaterThan(1e4);
    expect(touched!.text).toBe("498.7621");
  });

  /**
   * All three limits, and each one binds somewhere.
   *
   * A rule that only ever fired one way would not be tested by anything, and
   * this is the whole reason the panel keeps three: the singlet's five brackets
   * agree bitwise so only the arithmetic floor is left, the steep branch's
   * bracket spread is the largest thing it has, and on the achromat and the
   * triplet the round trip beats both.
   */
  it("is limited by a different thing on different tails", () => {
    const limits = ALL.map((tail) => {
      const r = reading({ tail });
      const atLine = r.crossings.reduce((a, b) =>
        Math.abs(a.nm - LINE_D) <= Math.abs(b.nm - LINE_D) ? a : b,
      );
      return atLine.limitedBy;
    });
    expect(limits).toEqual(["arithmetic", "round trip", "round trip", "search"]);
    expect(new Set(limits).size).toBe(3);
  });

  /**
   * The round trip: FFD(λ₀) is where the stop went, so λ₀ is a root by
   * construction and must come back as a crossing. How far off it comes back is
   * a measured error against a known answer — the only one of the three limits
   * that is — and on two tails it exceeds the five-bracket spread, which is
   * § 6ar's own correction one rung further in.
   */
  it("recovers the design wavelength as a crossing, and misses by more than the brackets said", () => {
    for (const tail of ALL) {
      const r = reading({ tail });
      expect(r.designWavelengthMissNm).toBeDefined();
      const nearest = r.crossings.reduce((a, b) =>
        Math.abs(a.nm - LINE_D) <= Math.abs(b.nm - LINE_D) ? a : b,
      );
      expect(Math.abs(nearest.nm - LINE_D)).toBe(r.designWavelengthMissNm);
      // A crossing, to picometres at worst — the placement guarantees the root.
      expect(r.designWavelengthMissNm!).toBeLessThan(1e-8);
    }
    const spreadOf = (tail: TailId) =>
      telecentricStop({
        tail: tailOf(tail).prescription,
        stopSemiApertureMm: tailOf(tail).semiApertureMm,
      }).crossingUncertaintyNm;
    for (const tail of ["achromat", "apochromat"] as const) {
      expect(reading({ tail }).designWavelengthMissNm!).toBeGreaterThan(spreadOf(tail));
    }
    // And on the triplet's shallow d-line crossing it is 2.7× the spread.
    const triplet = reading({ tail: "apochromat" });
    expect(triplet.designWavelengthMissNm! / spreadOf("apochromat")).toBeGreaterThan(2.5);
  });

  /**
   * The arithmetic floor reproduces § 6ar's own stated number.
   *
   * That step derives it as 53·ε ÷ |dFFD/dλ| = 4.15e−10 nm at the d line on this
   * triplet. The adapter evaluates the same expression from a central difference
   * rather than restating it, so this is a check on the derivation and not a
   * second claim — and it also pins that the floor is a LOWER bound: the
   * measured round trip is 4.5× it, so a panel quoting the floor as the error
   * would be over-quoting by half an order.
   */
  it("computes § 6ar's 4.15e−10 nm floor, and measures the true error at 4.5× it", () => {
    const r = reading({ tail: "apochromat" });
    expect(r.designWavelengthFloorNm).toBeDefined();
    expect(r.designWavelengthFloorNm!).toBeGreaterThan(4.1e-10);
    expect(r.designWavelengthFloorNm!).toBeLessThan(4.2e-10);
    const ratio = r.designWavelengthMissNm! / r.designWavelengthFloorNm!;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(6);
  });
});

describe("the wiring, and what it is allowed to move", () => {
  /**
   * The dummy stop carries the TAIL's aperture rather than the fixtures' 30 mm,
   * and every number it reports is bitwise unmoved by that.
   *
   * The default exists because §§ 6ak–6aq's fixtures use it. On the 5 mm triplet
   * it is a twelvefold oversize stop standing in front of the lens as the
   * system's only flagged surface, which is harmless for a paraxial readout and
   * wrong for anything traced through the same prescription later. Substituting
   * it is free only if it moves nothing, so that is pinned rather than assumed.
   */
  it("is bitwise unmoved by the stop dummy's own aperture", () => {
    for (const tail of ALL) {
      const t = tailOf(tail);
      const fixtures = telecentricStop({ tail: t.prescription, stopSemiApertureMm: 30 });
      const ours = telecentricStop({
        tail: t.prescription,
        stopSemiApertureMm: t.semiApertureMm,
      });
      expect(ours.stopToVertexMm).toBe(fixtures.stopToVertexMm);
      expect(ours.telecentricWavelengthsNm).toEqual(fixtures.telecentricWavelengthsNm);
      expect(ours.turningPointsNm).toEqual(fixtures.turningPointsNm);
      expect(ours.crossingUncertaintyNm).toBe(fixtures.crossingUncertaintyNm);
      expect(ours.turnUncertaintyNm).toBe(fixtures.turnUncertaintyNm);
      expect(ours.imageDistanceMm).toBe(fixtures.imageDistanceMm);
      // And the dummy really did change, so the comparison had something to move.
      expect(ours.prescription.surfaces[0]!.semiAperture).toBe(t.semiApertureMm);
      expect(fixtures.prescription.surfaces[0]!.semiAperture).toBe(30);
    }
    expect(tailOf("apochromat").semiApertureMm).toBe(2.5);
  });

  /**
   * The floor's slope is read off the tail as it stands, with its trailing
   * thickness left on. A translation after the last surface adds t·C to A and
   * t·D to B and leaves C and D alone, and −D/C is the whole of the front focal
   * distance — so the two spellings are the same number rather than nearly so.
   */
  it("reads the front focal distance through the trailing thickness bitwise", () => {
    const stripped = (p: Prescription): Prescription => ({
      surfaces: p.surfaces.map((s, i, all) => (i === all.length - 1 ? { ...s, thickness: 0 } : s)),
    });
    for (const tail of ALL) {
      const p = tailOf(tail).prescription;
      for (const nm of [420, LINE_D, 700]) {
        expect(frontFocalDistance(p, nm)).toBe(frontFocalDistance(stripped(p), nm));
      }
    }
  });

  it("draws the curve across the band, endpoints included and unsmoothed", () => {
    const r = reading();
    expect(r.curve).toHaveLength(CURVE_SAMPLES);
    expect(r.curve[0]![0]).toBe(DEFAULT_BAND_NM[0]);
    expect(r.curve[r.curve.length - 1]![0]).toBe(DEFAULT_BAND_NM[1]);
    const p = tailOf("apochromat").prescription;
    for (const [nm, mm] of r.curve) expect(mm).toBe(frontFocalDistance(p, nm));
    expect(run({ curveSamples: 1 }).ok).toBe(false);
  });

  /**
   * One triplet, one spelling.
   *
   * The bench editor's fifth seed and this panel's third tail are the same lens,
   * because they are the same five numbers imported rather than typed twice. A
   * second spelling is a second place to drift from what § 6ar traced, and the
   * seed's own note says the focal ratio is not free.
   */
  it("shares its triplet with the bench editor's fifth seed", () => {
    const seed = benchSeeds().find((s) => s.id === "apochromat");
    expect(seed).toBeDefined();
    const radii = seed!.draft.surfaces.map((s) => s.radiusMm);
    const tail = tailOf("apochromat").prescription;
    expect(tail.surfaces).toHaveLength(4);
    tail.surfaces.forEach((s, i) => {
      expect(s.curvature === 0 ? Infinity : 1 / s.curvature).toBe(radii[i]);
    });
  });

  it("lists four tails, each reachable by its own id", () => {
    expect(tails().map((t) => t.id)).toEqual(ALL);
    for (const t of tails()) {
      expect(tailOf(t.id)).toBe(t);
      expect(t.semiApertureMm).toBeGreaterThan(0);
      expect(t.prescription.surfaces.length).toBeGreaterThanOrEqual(2);
    }
    expect(() => tailOf("nope" as TailId)).toThrow(/no such tail/);
  });

  /** Inline, no worker — so the whole four-tail survey has to stay a frame. */
  it("costs a frame rather than a job", () => {
    const started = performance.now();
    surveyTails();
    for (const tail of ALL) reading({ tail });
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
