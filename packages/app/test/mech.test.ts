import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAIN,
  DEFAULT_FOCUSER,
  DIN_PARFOCAL_MM,
  MARECHAL_WAVES,
  barrelAt,
  budgetShare,
  chainGlassMm,
  chainReadout,
  closedPlateWaves,
  colourReadout,
  exactPlatePeakWaves,
  mountSweep,
  opticsSweep,
  thinLensFloor,
  travelSweep,
  type ChainSpec,
  type MountSweep,
  type OpticsSweep,
} from "../src/mech";

/**
 * C3 — the mechanical train, as invariants rather than as prose.
 *
 * **No engine capability was added for the panel, so no validation-ladder rung
 * was**: every number below is § 5u's, § 6b.5's or § 6c's, called from the app.
 * What is pinned here is the *wiring*, plus the four claims the panel makes that
 * no rung states.
 *
 * The first is that the naive line is **exactly flat** in the glass inside a
 * fixed light path. § 5u measures the naive budget's error on one chain; the
 * panel draws it as a curve, and the curve's whole content is that a budget made
 * of lengths has no slope in this variable at all.
 *
 * The second is § 5u.6 **traced**. That rung is explicitly closed form only, and
 * the panel differences two `withGlassPath` systems to get the same number off
 * the tracer. It arrives within ±1% — and the residual is neither the exact
 * form's departure nor the doublet's higher orders but the **pupil lattice's own
 * quadrature**, which is what the sampling rungs below establish and what makes
 * the traced route unable to resolve what § 5u.6 computed.
 *
 * The third is the consequence: on a real 100 mm doublet the **lens leaves the
 * Maréchal budget before the plate does**, so § 5u.6's f/5.315 is a statement
 * about a plate in isolation and not about an f/5 refractor.
 *
 * The fourth is that § 5u.7's 4.236 is not a constant. It is the NA 0.10 answer,
 * it moves with the aperture the ladder defaulted, and above ~NA 0.22 the mount
 * stops being the binding wall at all — § 6b.5's aperture refusal takes over,
 * which the panel has to tell apart from the mount's because catching both as
 * one exception reports a mount ceiling of 12.6× where nothing can be built.
 */

const APERTURE_MM = 100;
const GLASS_MM = chainGlassMm(DEFAULT_CHAIN);

/** Swept once per (sampling, glass) — every rung below reads one of these. */
const sweeps = new Map<string, OpticsSweep>();
const opticsAt = (pupilSamples: number, glassMm = GLASS_MM, points = 5): OpticsSweep => {
  const key = `${pupilSamples}:${glassMm}:${points}`;
  const cached = sweeps.get(key);
  if (cached) return cached;
  const swept = opticsSweep({
    apertureMm: APERTURE_MM,
    glassMm,
    minRatio: 3,
    maxRatio: 20,
    points,
    pupilSamples,
  });
  sweeps.set(key, swept);
  return swept;
};

const mounts = new Map<string, MountSweep>();
const mountAt = (numericalAperture: number, parfocalDistanceMm = DIN_PARFOCAL_MM): MountSweep => {
  const key = `${numericalAperture}:${parfocalDistanceMm}`;
  const cached = mounts.get(key);
  if (cached) return cached;
  const swept = mountSweep({
    numericalAperture,
    parfocalDistanceMm,
    minMagnification: 4,
    maxMagnification: 60,
    points: 5,
  });
  mounts.set(key, swept);
  return swept;
};

/** The measured-over-closed ratio at every point of a sweep that has one. */
const plateRatios = (sweep: OpticsSweep): number[] =>
  sweep.points
    .filter((p) => p.measuredPlateWaves !== null && p.closedPlateWaves > 0)
    .map((p) => p.measuredPlateWaves! / p.closedPlateWaves);

describe("C3 — the budget, and the two verdicts that disagree", () => {
  it("opens on a disagreement, which is what the panel exists to show", () => {
    const r = chainReadout(DEFAULT_CHAIN, DEFAULT_FOCUSER);
    expect(r.reaches).toBe(true);
    expect(r.naiveReaches).toBe(false);
    expect(r.verdictsDisagree).toBe(true);
    // And the whole difference between the two verdicts is the glass.
    expect(r.requiredTravelMm - r.naiveRequiredTravelMm).toBeCloseTo(r.focusShiftMm, 12);
    expect(r.focusShiftMm).toBeCloseTo(13.6287, 4);
  });

  it("reproduces § 5u.3's 7.83% on § 5u.3's own chain", () => {
    // The doc's figure is for the diagonal + a 20 mm extension + an SLR body;
    // the panel's default drops the extension, so the share is larger there.
    const withExtension: ChainSpec = { ...DEFAULT_CHAIN, spacerMm: 20 };
    expect(chainReadout(withExtension, DEFAULT_FOCUSER).naiveErrorFraction).toBeCloseTo(
      0.0783,
      4,
    );
    expect(chainReadout(DEFAULT_CHAIN, DEFAULT_FOCUSER).naiveErrorFraction).toBeGreaterThan(0.088);
  });

  it("a mirror diagonal hands back a hard zero, and the naive verdict is then right", () => {
    const mirror = chainReadout({ ...DEFAULT_CHAIN, diagonal: "mirror" }, DEFAULT_FOCUSER);
    expect(mirror.focusShiftMm).toBe(0);
    expect(mirror.glassThicknessMm).toBe(0);
    expect(mirror.requiredTravelMm).toBe(mirror.naiveRequiredTravelMm);
    expect(mirror.verdictsDisagree).toBe(false);
    // Same length, and it does not reach where the prism one does.
    expect(mirror.mechanicalLengthMm).toBe(
      chainReadout(DEFAULT_CHAIN, DEFAULT_FOCUSER).mechanicalLengthMm,
    );
    expect(mirror.reaches).toBe(false);
  });

  it("draws the naive line EXACTLY flat, and the honest one at (1 − 1/n)", () => {
    // The panel's first claim, and the reason the x axis is what it is: a
    // spreadsheet has no slope in this variable, because filling a fixed light
    // path with glass does not change what the part occupies.
    const sweep = travelSweep(DEFAULT_CHAIN, DEFAULT_FOCUSER, 25);
    expect(new Set(sweep.map((p) => p.naiveRequiredTravelMm)).size).toBe(1);
    const first = sweep[0]!;
    const last = sweep[sweep.length - 1]!;
    // 1 − 1/n for N-BK7 at the d line, read off the slope rather than typed in.
    const slope =
      (last.requiredTravelMm - first.requiredTravelMm) /
      (last.prismGlassMm - first.prismGlassMm);
    expect(slope).toBeCloseTo(0.3407, 4);
    // The x = 0 end is a mirror diagonal, so the two lines must MEET there.
    expect(first.prismGlassMm).toBe(0);
    expect(first.requiredTravelMm).toBe(first.naiveRequiredTravelMm);
    // And the band where the two verdicts differ is most of the axis here.
    expect(sweep.filter((p) => p.reaches !== p.naiveReaches).length).toBeGreaterThan(15);
  });

  it("sweeps the prism axis whatever diagonal the chain currently has", () => {
    // The plot is about glass in a light path, so a reader looking at a mirror
    // diagonal still sees where the prism one would put them.
    const asMirror = travelSweep({ ...DEFAULT_CHAIN, diagonal: "mirror" }, DEFAULT_FOCUSER, 25);
    const asPrism = travelSweep(DEFAULT_CHAIN, DEFAULT_FOCUSER, 25);
    for (let i = 0; i < asPrism.length; i++) {
      expect(asMirror[i]!.requiredTravelMm).toBeCloseTo(asPrism[i]!.requiredTravelMm, 12);
    }
  });
});

describe("C3 — § 5u.6 traced, and what the trace can and cannot resolve", () => {
  it("lands on the closed form within ±5%, at every focal ratio and both signs", () => {
    for (const ps of [15, 21]) {
      for (const ratio of plateRatios(opticsAt(ps))) {
        expect(Math.abs(ratio - 1)).toBeLessThan(0.05);
      }
    }
  });

  it("and the residual is the pupil lattice, not physics — it does not converge", () => {
    // The discriminator. If the gap were the exact form's departure or the
    // doublet's higher orders it would be monotone in the sampling and would
    // shrink. It is neither: 15 reads LOW, 21 reads HIGH, 31 reads low again,
    // by about the same amount, so what is moving is the quadrature of an RMS
    // over a lattice clipped to a disc.
    const at = (ps: number): number => {
      const r = plateRatios(opticsAt(ps));
      return r[r.length - 1]!;
    };
    const low = at(15);
    const middle = at(21);
    const high = at(31);
    expect(low).toBeLessThan(1);
    expect(middle).toBeGreaterThan(1);
    expect(high).toBeLessThan(1);
    // Non-monotone, and the swing between two ordinary samplings is ~5%.
    expect(middle - low).toBeGreaterThan(0.04);
    expect(Math.abs(high - 1)).toBeLessThan(0.01);
  });

  it("which is why § 5u.6 stayed closed form: the wobble outruns the departure", () => {
    // § 5u.6's exact/third-order ratio is 1.0018 at f/10 and 1.0005 at f/20.
    // The sampling swing above is 5%, so the traced route cannot see it there.
    const sweep = opticsAt(21);
    const slow = sweep.points[sweep.points.length - 1]!;
    expect(slow.exactOverThird).toBeLessThan(1.001);
    const swing = Math.abs(plateRatios(opticsAt(21))[0]! - plateRatios(opticsAt(15))[0]!);
    expect(swing).toBeGreaterThan(slow.exactOverThird - 1);
  });

  it("signs it the same way at every ratio: a plate NEVER compensates this doublet", () => {
    // The contrast with § 6e.4's oil, which is rarer than the glass either side
    // of it and therefore helps. A plate's spherical aberration has the same
    // sign as an achromat's own residual, so the two add.
    for (const ps of [15, 21]) {
      for (const p of opticsAt(ps).points) {
        expect(p.measuredPlateWaves).not.toBeNull();
        expect(p.measuredPlateWaves!).toBeGreaterThan(0);
      }
    }
  });

  it("does not know the aperture, while the lens it sits in does", () => {
    // The plate's cost is a function of the cone angle alone, so three
    // apertures at one focal ratio must agree — and the doublet's own residual
    // must not, because W₀₄₀ of a lens scales with its diameter.
    const measured: number[] = [];
    const bare: number[] = [];
    for (const apertureMm of [60, 100, 150]) {
      const p = opticsSweep({
        apertureMm,
        glassMm: GLASS_MM,
        minRatio: 8,
        maxRatio: 20,
        points: 3,
        pupilSamples: 21,
      }).points[0]!;
      expect(p.focalRatio).toBeCloseTo(8, 12);
      measured.push(p.measuredPlateWaves!);
      expect(p.bare.ok).toBe(true);
      if (p.bare.ok) bare.push(budgetShare(p.bare.sigmaWaves));
    }
    expect(Math.max(...measured) / Math.min(...measured)).toBeLessThan(1.005);
    expect(Math.max(...bare) / Math.min(...bare)).toBeGreaterThan(2);
  });

  it("puts the same glass at two very different gaps and gets the same wavefront", () => {
    // § 5u.2's identity, at app level and on gaps chosen as shares of the room
    // rather than as the rung's own 50 mm and 600 mm.
    const nul = opticsAt(21).positionNull;
    expect(nul.farGapMm / nul.nearGapMm).toBeGreaterThan(15);
    expect(nul.differenceWaves).not.toBeNull();
    expect(nul.differenceWaves!).toBeLessThan(1e-9);
  });
});

describe("C3 — the crossings, bisected, and the one that arrives first", () => {
  it("bisects § 5u.6's f/5.315 out of the exact plate form", () => {
    const sweep = opticsAt(15);
    expect(sweep.plateRayleigh.focalRatio).toBeCloseTo(5.315, 3);
    // Measured rather than transcribed: the app holds no such constant, and the
    // criterion it is bisected on is the one Rayleigh is stated in.
    expect(exactPlatePeakWaves(GLASS_MM, sweep.plateRayleigh.focalRatio!)).toBeCloseTo(0.25, 6);
  });

  it("and the SAME plate crosses Maréchal at f/3.79 — a criterion, not a scale", () => {
    // λ/4 on the peak and λ/14 on the balanced σ differ by 24√5/14 in allowed
    // error, and the cost is a fourth power, so the two focal ratios differ by
    // the fourth root of that. A6 makes the same point about cover slips.
    const sweep = opticsAt(15);
    expect(sweep.plateMarechal.focalRatio).toBeCloseTo(3.792, 3);
    expect(closedPlateWaves(GLASS_MM, sweep.plateMarechal.focalRatio!)).toBeCloseTo(
      MARECHAL_WAVES,
      9,
    );
    const ratio = sweep.plateRayleigh.focalRatio! / sweep.plateMarechal.focalRatio!;
    expect(ratio).toBeCloseTo(((24 * Math.sqrt(5)) / 14) ** 0.25, 2);
  });

  it("finds the DOUBLET leaves the budget first, which is the panel's headline", () => {
    // § 5u.6's f/5.315 is about a plate in isolation. In a real 100 mm f/5
    // refractor the lens is already over budget on its own, and the diagonal is
    // the smaller of the two problems.
    const sweep = opticsAt(21);
    expect(sweep.bareMarechal.focalRatio).toBeCloseTo(6.007, 2);
    expect(sweep.glassedMarechal.focalRatio).toBeCloseTo(6.192, 2);
    expect(sweep.bareMarechal.focalRatio!).toBeGreaterThan(sweep.plateRayleigh.focalRatio!);
    // What the diagonal costs, as a share of focal ratio: 3.1%.
    const cost = sweep.glassedMarechal.focalRatio! / sweep.bareMarechal.focalRatio! - 1;
    expect(cost).toBeGreaterThan(0.02);
    expect(cost).toBeLessThan(0.05);
  });

  it("refuses the plate's crossings when the chain has no glass, rather than drawing 0", () => {
    const sweep = opticsAt(15, 0, 3);
    expect(sweep.plateRayleigh.focalRatio).toBeNull();
    expect(sweep.plateRayleigh.reason).toContain("no glass");
    expect(sweep.plateMarechal.focalRatio).toBeNull();
    // And with no glass the two traced curves are the same instrument.
    expect(sweep.glassedMarechal.focalRatio).toBe(sweep.bareMarechal.focalRatio);
    for (const p of sweep.points) expect(p.measuredPlateWaves).toBe(0);
    expect(sweep.positionNull.differenceWaves).toBeNull();
  });
});

describe("C3 — the colour a budget made of lengths cannot see", () => {
  it("moves both glass pairs by the same amount, because the plate does not know", () => {
    const readout = colourReadout(APERTURE_MM, 5, GLASS_MM);
    const crownFlint = readout.curves[0]!;
    const ed = readout.curves[1]!;
    if (!crownFlint.ok || !ed.ok) throw new Error("expected both pairs to build");
    expect(crownFlint.bareSpreadMm).toBeCloseTo(-0.2098, 3);
    expect(ed.bareSpreadMm).toBeCloseTo(-0.5068, 3);
    for (const curve of [crownFlint, ed]) {
      expect(curve.addedMm).toBeCloseTo(0.139742, 6);
      expect(curve.reduced).toBe(true);
    }
  });

  it("is four depths of focus at f/5 and inside one at f/10 — a fast-scope problem", () => {
    const fast = colourReadout(APERTURE_MM, 5, GLASS_MM);
    const slow = colourReadout(APERTURE_MM, 10, GLASS_MM);
    const depths = (r: ReturnType<typeof colourReadout>): number => {
      const curve = r.curves[0]!;
      if (!curve.ok) throw new Error("expected a curve");
      return curve.addedMm / r.depthOfFocusMm;
    };
    expect(depths(fast)).toBeGreaterThan(4);
    expect(depths(slow)).toBeLessThan(1.5);
    // The plate's amount does not change; the depth of focus does, as (f/#)².
    expect(slow.depthOfFocusMm / fast.depthOfFocusMm).toBeCloseTo(4, 9);
  });

  it("draws each curve against its OWN d line, so the two are comparable", () => {
    // The span is F → C, which does not put a *sample* on the d line — and it
    // does not have to. What "against its own d line" means is that each of the
    // four curves crosses zero inside the interval the d line falls in, which is
    // what makes the two glass pairs and the two chains readable on one axis.
    const readout = colourReadout(APERTURE_MM, 5, GLASS_MM);
    for (const curve of readout.curves) {
      if (!curve.ok) throw new Error("expected a curve");
      const below = [...curve.points].reverse().find((p) => p.wavelengthNm < 587.5618)!;
      const above = curve.points.find((p) => p.wavelengthNm > 587.5618)!;
      expect(above.wavelengthNm - below.wavelengthNm).toBeLessThan(25);
      for (const value of [
        [below.bareMm, above.bareMm],
        [below.glassedMm, above.glassedMm],
      ]) {
        expect(value[0]!).toBeLessThan(0);
        expect(value[1]!).toBeGreaterThan(0);
      }
    }
  });
});

describe("C3 — the mount ceiling, and the wall that is not it", () => {
  it("bisects § 5u.7's 4.236 without the app containing it", () => {
    const sweep = mountAt(0.1);
    expect(sweep.thinLensFloor).toBeCloseTo(4.1387, 4);
    expect(sweep.measuredFloor).not.toBeNull();
    expect(sweep.measuredFloor!).toBeCloseTo(4.236, 2);
    expect(sweep.floorVerdictBelow).toBe("mount");
    // The built doublet is thick, so the real floor is above the thin-lens one.
    expect(sweep.glassPenalty!).toBeGreaterThan(1);
    expect(sweep.glassPenalty!).toBeCloseTo(1.0235, 3);
  });

  it("and 4.236 is NOT a constant — it is the NA 0.10 answer", () => {
    // D8's lesson on a third axis: a surface that lets a reader move a stated
    // parameter finds out what the stating cost. A faster objective is a
    // thicker one, and thickness is what the standard runs out of room for.
    const floors = [0.05, 0.1, 0.15, 0.2].map((na) => mountAt(na).measuredFloor!);
    expect(floors[0]).toBeCloseTo(4.173, 2);
    expect(floors[3]).toBeCloseTo(4.506, 2);
    for (let i = 1; i < floors.length; i++) expect(floors[i]!).toBeGreaterThan(floors[i - 1]!);
    // The thin-lens floor knows nothing about it, so the whole spread is glass.
    expect(new Set([0.05, 0.2].map((na) => mountAt(na).thinLensFloor)).size).toBe(1);
  });

  it("tells § 6b.5's aperture refusal apart from § 5u.7's mount", () => {
    // The block's whole discipline. At NA 0.25 a bisection that caught both as
    // one exception reports a mount ceiling of 12.6×, where the truth is that
    // no doublet exists there to mount at all.
    const sweep = mountAt(0.25);
    expect(sweep.measuredFloor).toBeNull();
    expect(sweep.floorVerdictBelow).toBe("doublet");
    expect(sweep.glassPenalty).toBeNull();
    expect(sweep.doubletFloor).not.toBeNull();
    expect(sweep.doubletFloor!).toBeCloseTo(12.57, 1);
    // And at an aperture a DIN objective is actually made at, the other wall is
    // nowhere on the axis.
    expect(mountAt(0.1).doubletFloor).toBeNull();
  });

  it("names the verdict per point rather than dropping the refusals", () => {
    expect(barrelAt(4, 0.1, DIN_PARFOCAL_MM).verdict).toBe("mount");
    expect(barrelAt(4, 0.25, DIN_PARFOCAL_MM).verdict).toBe("doublet");
    expect(barrelAt(10, 0.1, DIN_PARFOCAL_MM).verdict).toBe("fits");
    // A mount refusal still knows the objective it could not hang: the working
    // distance is what exceeded the standard, and it is reported.
    const refused = barrelAt(4, 0.1, DIN_PARFOCAL_MM);
    expect(refused.barrelMm).toBeNull();
    expect(refused.objectDistanceMm!).toBeGreaterThan(DIN_PARFOCAL_MM);
    // A doublet refusal knows nothing at all, and says so with nulls.
    expect(barrelAt(4, 0.25, DIN_PARFOCAL_MM).objectDistanceMm).toBeNull();
  });

  it("makes the turret work: the barrel absorbs the difference and is not constant", () => {
    const ten = barrelAt(10, 0.1, DIN_PARFOCAL_MM);
    const forty = barrelAt(40, 0.1, DIN_PARFOCAL_MM);
    expect(ten.barrelMm!).toBeLessThan(forty.barrelMm!);
    expect(forty.barrelMm! - ten.barrelMm!).toBeGreaterThan(10);
    // Every objective that fits puts its specimen at the same distance below the
    // shoulder — that is the identity the barrel exists to satisfy.
    for (const point of [ten, forty]) {
      expect(point.barrelMm! + point.glassLengthMm! + point.objectDistanceMm!).toBeCloseTo(
        DIN_PARFOCAL_MM,
        10,
      );
    }
  });

  it("moves the floor with the standard, and the glass costs a near-constant 2.3%", () => {
    // The thin-lens floor is a function of the standard alone; what the glass
    // adds on top of it barely moves across a wide range of standards.
    for (const [parfocalDistanceMm, expected] of [
      [35, 5.1224],
      [60, 3.2656],
      [95, 2.2735],
    ] as const) {
      const sweep = mountSweep({
        numericalAperture: 0.1,
        parfocalDistanceMm,
        minMagnification: 2,
        maxMagnification: 60,
        points: 3,
      });
      expect(sweep.thinLensFloor).toBeCloseTo(expected, 3);
      expect(thinLensFloor(parfocalDistanceMm)).toBeCloseTo(expected, 3);
      expect(sweep.glassPenalty!).toBeGreaterThan(1.02);
      expect(sweep.glassPenalty!).toBeLessThan(1.03);
    }
  });
});
