import { describe, it, expect } from "vitest";
import { Prescription, SurfaceSpec } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { seidelSums } from "../src/analysis/seidel";
import { pupils } from "../src/pupil/pupils";
import { paraxialImageOffset } from "../src/analysis/focus";
import { OpticalSystem } from "../src/trace/system";
import { achromaticObjective } from "../src/designs/achromat";
import {
  apochromaticObjective,
  cementedTripletForm,
  TripletApertureRefusal,
  TripletBendingUndefined,
} from "../src/designs/apochromat";
import { telecentricStop, frontFocalDistance } from "../src/designs/telecentric";
import { getMedium } from "../src/materials/catalog";
import { abbeNumber, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";

/**
 * Step 6ar — the telecentric designs ship.
 *
 * **The oldest entry on this ladder's deferral list, carried unchanged since
 * § 6aj and re-priced upward twice since.** Its complaint was always the same:
 * machine-vision telecentric lenses are the real article, every fixture that
 * exercises the branch is built inside a test file, and `designs/` has nothing.
 * § 6ap made it two fixtures differing by a spacer; § 6aq made it three and added
 * a design solve, so the price went UP with each step that used the branch.
 *
 * Two entries close it. `designs/apochromat` is the cemented triplet § 6aq
 * solved in its own fixture, with the branch choice and the refusals the
 * deferral predicted. `designs/telecentric` is the *placement* — the stop on the
 * tail's front focal plane — and it takes a tail rather than choosing one,
 * because § 6aq's own finding is that the glass and the millimetre are
 * independent knobs.
 *
 * ## What this step is pinned to
 *
 *  - **§§ 6ap and 6aq themselves.** The two constructors had to reproduce both
 *    fixtures to every digit already pinned BEFORE either fixture was allowed to
 *    call them, and both files now do (§ 6ar.7). That is an equivalence pin and
 *    is labelled as one — it is not new physics, it is the guarantee that
 *    shipping the solve did not quietly move a lens.
 *  - **The catalogue's three-glass split**, Σφ = φ, Σφ/V = 0, ΣφP/V = 0, off two
 *    Abbe numbers and two partial dispersions per glass (§ 6ar.1) — and the
 *    **normal line** the four ordinary glasses lie on, which is what the split
 *    needs a glass off (§ 6ar.6).
 *  - **Welford's third-order S_I**, for the bending (§ 6ar.2).
 *  - **The thin-lens derivative of the maker's equation**, Δf/f = −ε·f·cₖ·Δnₖ,
 *    for what ill-conditioning COSTS (§ 6ar.6).
 *  - **Floating-point ε and the slope the curve crosses at**, for how many
 *    digits of a searched wavelength are the lens's (§ 6ar.8).
 *
 * ## Two corrections to § 6aq, and one to this file's own first draft
 *
 * Shipping a fixture is where its prose gets audited, and three sentences did
 * not survive:
 *
 *  - § 6aq called an ordinary-glass triple **"a singular matrix"**. It is not.
 *    Those triples solve, unite F, d and C exactly, and build real lenses at
 *    f/200 and f/1000. What the conditioning buys is a focal-ratio wall and a
 *    tolerance, both measured here (§ 6ar.6).
 *  - § 6aq.4 pinned the d line's own pole to **nine decimals**, and nine was the
 *    bracket. The same lens from five brackets spreads 1.6e−9 nm (§ 6ar.8) —
 *    which is the mistake § 6aq.3 caught for the TURN, made one rung earlier and
 *    left standing there.
 *  - And `designs/telecentric`'s first header said a crossing is exact "because
 *    a sign is exact". The sign is; the function is a difference of two numbers
 *    near 53 mm, and it carries nothing below 53·ε.
 *
 * ## No new physics
 *
 * Not one equation here is new. Every rung is either a solve that already ran
 * inside a test file now running inside `packages/core`, or a measurement of
 * what that move cost. What IS new in the engine is two constructors and their
 * refusals, which is why they get rungs of their own rather than an assertion
 * that they exist.
 */

const APERTURE = 5;
const EFL_TARGET = 53;
const CONJUGATE = 453;
const OBJECT_DISTANCE = 400;
const GLASS = ["CAF2", "F2", "N-BK7"] as const;
const THICKNESS = [1.6, 1.2, 1.2] as const;
const STOP_R = 2;

const spec = {
  apertureMm: APERTURE,
  focalRatio: EFL_TARGET / APERTURE,
  media: GLASS,
  thicknessesMm: THICKNESS,
  objectDistanceMm: CONJUGATE,
} as const;
const TRIPLET = apochromaticObjective(spec);
const TRIPLET_STEEP = apochromaticObjective({ ...spec, branch: "steep" });
const DOUBLET = achromaticObjective({
  apertureMm: APERTURE,
  focalRatio: EFL_TARGET / APERTURE,
  objectDistanceMm: CONJUGATE,
});

const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
const ffd = (g: Prescription, nm: number): number =>
  -paraxialTrace(g, nm, { y: 0, u: 1 }).u / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
/** The tail alone — what a focal length is OF. */
const groupOf = (p: Prescription): Prescription => ({
  surfaces: p.surfaces.map((s, i, all) => (i === all.length - 1 ? { ...s, thickness: 0 } : s)),
});
const TRIPLET_GROUP = groupOf(TRIPLET.prescription);

/** § 6aq's own fixture build: uniform semi-aperture, no stop flag on the glass. */
const fixtureBuild = (
  curvature: readonly number[],
  thickness: readonly number[] = THICKNESS,
  semiAperture = APERTURE / 2,
): Prescription => ({
  surfaces: curvature.map((c, i): SurfaceSpec => ({
    kind: "refract",
    curvature: c,
    semiAperture,
    thickness: i < 3 ? thickness[i]! : 0,
    medium: i < 3 ? GLASS[i]! : "AIR",
  })),
});

const bisect = (g: (x: number) => number, a: number, b: number): number => {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(lo) * g(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
};

describe("§ 6ar.1 — the triplet's external number is the catalogue split, and the gap is thickness", () => {
  it("the shipped thin split is the 3×3's own solution, off Abbe numbers and partial dispersions", () => {
    // THE EXTERNAL NUMBER, recomputed here from the catalogue and nothing else,
    // so the constructor is checked against the closed form rather than against
    // its own arithmetic.
    const gs = GLASS.map((name) => {
      const m = getMedium(name);
      return {
        V: abbeNumber(m),
        P: (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C)),
      };
    });
    // Cramer on Σφ = φ, Σφ/V = 0, ΣφP/V = 0 — a different route to the same
    // three numbers than the constructor's Gauss-Jordan.
    const det = (m: readonly (readonly number[])[]): number =>
      m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
      m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
      m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
    const A = [gs.map(() => 1), gs.map((g) => 1 / g.V), gs.map((g) => g.P / g.V)];
    const base = det(A);
    for (let k = 0; k < 3; k++) {
      const M = A.map((row) => row.map((v, j) => (j === k ? 0 : v)));
      M[0]![k] = 1 / EFL_TARGET;
      expect(TRIPLET.thinElementPowers[k]! * EFL_TARGET).toBeCloseTo(
        (det(M) / base) * EFL_TARGET,
        12,
      );
    }
    // § 6aq.1's own three numbers, unchanged.
    expect(TRIPLET.thinElementPowers[0]! * EFL_TARGET).toBeCloseTo(2.578140565, 9);
    expect(TRIPLET.thinElementPowers[1]! * EFL_TARGET).toBeCloseTo(-0.21365216, 9);
    expect(TRIPLET.thinElementPowers[2]! * EFL_TARGET).toBeCloseTo(-1.364488404, 9);
  });

  it("and `thinPowerGap` is § 6aq.1's own deviation, which halves with the glass", () => {
    // The constructor reports how far the THICK solve sits from the split, and
    // it is the same quantity § 6aq.1 measured by hand: 3.797e−2 of the total
    // power, which is 1.5% of the fluorite element's own.
    expect(TRIPLET.thinPowerGap).toBeCloseTo(3.797258e-2, 7);
    expect(TRIPLET.thinPowerGap / Math.abs(TRIPLET.thinElementPowers[0]! * EFL_TARGET)).toBeCloseTo(
      0.0147,
      4,
    );
    // Halve the glass and it halves, five times over — so it extrapolates to
    // zero and the split is what the design TENDS to, not what it is.
    const deviationAt = (scale: number): number => {
      const thickness = THICKNESS.map((t) => t * scale) as unknown as readonly [
        number,
        number,
        number,
      ];
      const form = cementedTripletForm({
        apertureMm: APERTURE,
        focalLengthMm: EFL_TARGET,
        media: GLASS,
        thicknessesMm: thickness,
      });
      const c = form.curvaturesAt(TRIPLET.curvatures[0]!);
      return Math.max(
        ...[0, 1, 2].map((i) =>
          Math.abs(
            (form.indices[i]! - 1) * (c[i]! - c[i + 1]!) * EFL_TARGET -
              form.thinElementPowers[i]! * EFL_TARGET,
          ),
        ),
      );
    };
    const scales = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
    const deviation = scales.map(deviationAt);
    expect(deviation[0]).toBeCloseTo(3.797258e-2, 7);
    for (let i = 1; i < scales.length; i++) {
      expect(deviation[i - 1]! / deviation[i]!).toBeGreaterThan(1.96);
      expect(deviation[i - 1]! / deviation[i]!).toBeLessThan(2.04);
    }
  });
});

describe("§ 6ar.2 — the bending scan finds the classical pair, and has no ghost to filter", () => {
  it("both roots null S_I on the real thick prescription, and are § 6aq's own", () => {
    for (const design of [TRIPLET, TRIPLET_STEEP]) {
      const s = seidelSums(fixtureBuild(design.curvatures), LINE_D, {
        marginalHeightMm: APERTURE / 2,
        objectDistanceMm: CONJUGATE,
      });
      expect(Math.abs(s.s1)).toBeLessThan(1e-11);
      const g = groupOf(design.prescription);
      const fD = efl(g, LINE_D);
      expect(fD).toBeCloseTo(EFL_TARGET, 10);
      expect((efl(g, LINE_F) - fD) / fD).toBeCloseTo(0, 13);
      expect((efl(g, LINE_C) - fD) / fD).toBeCloseTo(0, 13);
    }
    // § 6aq.7's two radii, from a scan of the whole window rather than from two
    // hand-chosen brackets.
    expect(TRIPLET.radiiMm[0]).toBeCloseTo(18.348013, 5);
    expect(TRIPLET_STEEP.radiiMm[0]).toBeCloseTo(-102.648789, 4);
  });

  it("the criterion picks the shallower root, and here the name still fits", () => {
    // `designs/achromat` names the branches for the shape you can see and picks
    // them on Σ|S_I,ᵢ|. On a triplet the two need not agree — R1 = −102.6 is a
    // FLATTER first surface than R1 = 18.3 — and over the four surfaces they do:
    // the chosen root is shallower everywhere, so the name survives.
    const chosen = TRIPLET.branches.find((b) => b.curvatures[0] === TRIPLET.curvatures[0])!;
    const other = TRIPLET.branches.find((b) => b.curvatures[0] !== TRIPLET.curvatures[0])!;
    expect(chosen.cancellation).toBeCloseTo(5.2881e-3, 6);
    expect(other.cancellation).toBeCloseTo(2.2979e-2, 5);
    expect(other.cancellation / chosen.cancellation).toBeGreaterThan(4.3);
    expect(chosen.maxSurfaceSlope).toBeCloseTo(0.148180, 5);
    expect(other.maxSurfaceSlope).toBeCloseTo(0.328224, 5);
    expect(chosen.maxSurfaceSlope).toBeLessThan(other.maxSurfaceSlope);

    // And the name is a claim about the STEEPEST surface, not about every one —
    // which matters here, because surface 1 goes the other way. R1 = 18.3 mm is a
    // more curved front face than R1 = −102.6 mm, so a per-surface reading of
    // "shallow" would pick the wrong root. Three of the four are shallower on the
    // chosen branch and the first is not, while the max — what a maker and the
    // higher orders both feel — is smaller by 2.2×.
    expect(Math.abs(chosen.curvatures[0]!)).toBeGreaterThan(Math.abs(other.curvatures[0]!));
    for (let i = 1; i < 4; i++) {
      expect(Math.abs(chosen.curvatures[i]!)).toBeLessThan(Math.abs(other.curvatures[i]!));
    }
    expect(other.maxSurfaceSlope / chosen.maxSurfaceSlope).toBeCloseTo(2.215, 2);
  });

  it("and unlike the doublet's, this scan has no root that is not a surface", () => {
    // § 6b.5.7: past the aperture wall the DOUBLET's S_I grows a third root that
    // is five times hemispherical, so `designs/achromat` must filter for
    // buildability before its count means anything. The triplet's does not, and
    // the header says so rather than inheriting the doublet's prose.
    //
    // Both roots are surfaces by a wide margin, and every root the scan reports
    // is one — checked at the aperture the design is built at.
    for (const b of TRIPLET.branches) expect(b.maxSurfaceSlope).toBeLessThan(1);
    // The pair is exactly two, and the constructor would have thrown otherwise —
    // so the count is pinned by the call succeeding, and the radii above say
    // WHICH two.
    expect(TRIPLET.branches.length).toBe(2);
    expect(TRIPLET.branches[0].curvatures[0]).not.toBe(TRIPLET.branches[1].curvatures[0]);
    // And `branch: "steep"` really is the other one, not a relabelling.
    expect(TRIPLET_STEEP.curvatures[0]).toBe(
      TRIPLET.branches.find((b) => b.curvatures[0] !== TRIPLET.curvatures[0])!.curvatures[0],
    );
  });
});

describe("§ 6ar.3 — the solve's reachable set is not an interval, and the scan is built for that", () => {
  it("the set of bendings Newton reaches fragments as you sample it harder", () => {
    // The claim the first draft of this file made was that the bending family is
    // an INTERVAL and that outside it no triplet exists. Both halves are wrong,
    // and this is the rung that measured it: the reachable set comes apart into
    // more and more pieces the harder it is sampled, and a set whose piece-count
    // grows with the sampling is a convergence basin, not a geometry.
    const form = cementedTripletForm({
      apertureMm: APERTURE,
      focalLengthMm: EFL_TARGET,
      media: GLASS,
      thicknessesMm: THICKNESS,
    });
    const span = form.thinElementPowers.reduce(
      (t, p, i) => t + Math.abs(p / (form.indices[i]! - 1)),
      0,
    );
    const runsAt = (steps: number): number => {
      let runs = 0;
      let previous = false;
      for (let i = 0; i <= steps; i++) {
        const c1 = -3 * span + (6 * span * i) / steps;
        const reachable = form.tryCurvaturesAt(c1) !== null;
        if (reachable && !previous) runs++;
        previous = reachable;
      }
      return runs;
    };
    // Monotone in the sampling, and by a lot — which no interval does.
    const runs = [200, 400, 1000].map(runsAt);
    expect(runs[0]).toBeGreaterThan(1);
    expect(runs[1]!).toBeGreaterThan(runs[0]!);
    expect(runs[2]!).toBeGreaterThan(runs[1]!);
    expect(runs[2]!).toBeGreaterThan(20);
    // The refusal names the solver, not the geometry — it does not claim no
    // triplet exists at that bending, because nothing here shows that.
    let thrown: unknown;
    try {
      form.curvaturesAt(-0.4);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TripletBendingUndefined);
    expect((thrown as TripletBendingUndefined).bending).toBe(-0.4);
    expect((thrown as Error).message).toContain("did not converge");
    expect((thrown as Error).message).toContain("not the same as saying no such triplet exists");
  });

  it("so a bracket it cannot narrow is ABANDONED, and never handed back as a root", () => {
    // The bug this rung exists for. The scan brackets a sign change between two
    // adjacent reachable samples, then bisects — and the midpoint of such a
    // bracket can itself be unreachable, because the set is not an interval. The
    // first draft returned that midpoint as a root, and the constructor then
    // threw the SOLVER's own error at a caller who had merely asked for a lens.
    //
    // At f/4 the default triple does exactly that. It must now refuse as a
    // refusal — a typed one, about the aperture — and never as a
    // `TripletBendingUndefined`.
    let thrown: unknown;
    try {
      apochromaticObjective({ ...spec, focalRatio: 4 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TripletApertureRefusal);
    expect(thrown).not.toBeInstanceOf(TripletBendingUndefined);
    // And the abandoned brackets are REPORTED. A dropped sign change is exactly
    // the kind of silent truncation that reads as "there was nothing there".
    expect((thrown as Error).message).toContain("could not narrow");
  });

  it("and the damping that makes the solve reach is worth nothing at the answer", () => {
    // Backtracking on the residual norm is what makes the solve robust — raw
    // Newton reaches 37 of 121 bendings across the window and the damped one 116
    // — but it buys REACH, not accuracy: the answer is a root of the residual
    // either way. So the roots are § 6aq's to twelve significant figures, which
    // is why every digit in that file is unchanged.
    //
    // Said as the residual itself: the shipped curvatures satisfy the three
    // chromatic conditions to the tolerance the solve claims, not merely close.
    const g = groupOf(TRIPLET.prescription);
    const fD = efl(g, LINE_D);
    expect(Math.abs(fD - EFL_TARGET)).toBeLessThan(1e-12);
    expect(Math.abs(efl(g, LINE_F) - fD)).toBeLessThan(1e-12);
    expect(Math.abs(efl(g, LINE_C) - fD)).toBeLessThan(1e-12);
    // § 6aq's curvatures, transcribed from the undamped solve it shipped with.
    const SIX_AQ = [
      5.45018152629847819e-2, -5.92718563678960586e-2, -5.25975150219294210e-2,
      -1.49148669455359995e-3,
    ];
    const relative = [0, 1, 2, 3].map(
      (i) => Math.abs(TRIPLET.curvatures[i]! - SIX_AQ[i]!) / Math.abs(SIX_AQ[i]!),
    );
    for (const r of relative) expect(r).toBeLessThan(1e-11);
    // Eleven digits and not sixteen, and the loosest is the LAST surface for a
    // reason worth stating: R₄ = −670 mm is nearly flat, so its curvature is a
    // small number reached by cancelling large ones, and a fixed absolute
    // agreement in the curvatures is a loose relative one there. The first three
    // agree far better.
    expect(relative[3]).toBe(Math.max(...relative));
    for (let i = 0; i < 3; i++) expect(relative[i]).toBeLessThan(1e-12);
    // In absolute terms all four agree to 1e−14 of a reciprocal millimetre, which
    // is the scale the solve's own tolerance sets.
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(TRIPLET.curvatures[i]! - SIX_AQ[i]!)).toBeLessThan(1e-13);
    }
  });
});

describe("§ 6ar.4 — the composed prescription is the fixtures', bitwise where it matters", () => {
  it("the tail's own stop flag is stripped, and `trace/system` could not have told", () => {
    // `designs/achromat` and `designs/apochromat` both flag their front vertex —
    // a bare objective's cell IS its stop. Composed behind a real stop it is not,
    // and `designs/telecentric` strips it, which is `pupil/visual`'s precedent.
    //
    // It changes nothing traced, because `trace/system` takes the FIRST flagged
    // surface and the dummy is ahead of the glass either way. Pinned rather than
    // argued: build the same system with the flag left in and compare.
    const placed = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    const flags = placed.prescription.surfaces.map((s) => s.isStop === true);
    expect(flags).toEqual([true, false, false, false, false]);

    const withFlagKept: Prescription = {
      surfaces: placed.prescription.surfaces.map((s, i) =>
        i === 1 ? { ...s, isStop: true } : s,
      ),
    };
    const system = (p: Prescription): OpticalSystem => ({
      prescription: p,
      aperture: { kind: "stopRadius", value: STOP_R },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance: OBJECT_DISTANCE },
    });
    const a = pupils(system(placed.prescription), LINE_D);
    const b = pupils(system(withFlagKept), LINE_D);
    expect(b.entrance.z).toBe(a.entrance.z);
    expect(b.entrance.radius).toBe(a.entrance.radius);
    expect(b.exit.z).toBe(a.exit.z);
  });

  it("and the glass the constructor sizes traces identically to the fixture's own", () => {
    // The fixture sizes all four surfaces at exactly D/2; the constructor carries
    // `designs/achromat`'s margins, 0.5% on the front face and 2% on the rear
    // ones, so an off-axis pencil is not shaved by the surfaces' own sag. § 6aq.8
    // already pins that the rim is not binding here — 2.5 mm and 20 mm render
    // bitwise the same frame — so the margins must change nothing, and this is
    // that check made directly rather than inferred.
    const fixture = fixtureBuild(TRIPLET.curvatures);
    const shipped = groupOf(TRIPLET.prescription);
    for (let i = 0; i < 4; i++) {
      expect(shipped.surfaces[i]!.curvature).toBe(fixture.surfaces[i]!.curvature);
      expect(shipped.surfaces[i]!.thickness).toBe(fixture.surfaces[i]!.thickness);
      expect(shipped.surfaces[i]!.medium).toBe(fixture.surfaces[i]!.medium);
    }
    // The margins are real and are the ones `designs/achromat` uses.
    expect(shipped.surfaces[0]!.semiAperture).toBeCloseTo((APERTURE / 2) * 1.005, 12);
    expect(shipped.surfaces[1]!.semiAperture).toBeCloseTo((APERTURE / 2) * 1.02, 12);
    // Nothing paraxial or third-order sees them, which is why the digits hold.
    expect(ffd(shipped, LINE_D)).toBe(ffd(fixture, LINE_D));
    expect(efl(shipped, LINE_D)).toBe(efl(fixture, LINE_D));
  });
});

describe("§ 6ar.5 — the placement is the design, and the two placements are one constructor", () => {
  it("`frontFocal` and `turn` differ by § 6ap.5's 3.8 µm on the doublet", () => {
    const tail = { surfaces: DOUBLET.prescription.surfaces };
    const atLine = telecentricStop({ tail, imageDistanceMm: 100 });
    const atTurn = telecentricStop({ tail, placement: { kind: "turn" }, imageDistanceMm: 100 });
    // § 6ap's own numbers, from the constructor.
    expect(atLine.stopToVertexMm).toBeCloseTo(52.987924952, 8);
    expect(atTurn.stopToVertexMm - atLine.stopToVertexMm).toBeCloseTo(-3.774536e-3, 8);
    expect(atLine.turningPointsNm[0]).toBeCloseTo(556.1139, 3);
    // One turn, so two crossings — § 6ap's whole headline, as a returned list.
    expect(atLine.telecentricWavelengthsNm.length).toBe(2);
    expect(atLine.telecentricWavelengthsNm[0]).toBeCloseTo(528.349225534, 8);
    expect(atLine.poleOrders).toEqual(["simple", "simple"]);
    // And at the turn the root is double and ALONE, so the sign never reverses
    // across the band — which is what § 6ap.5 pins with traced magnifications.
    expect(atTurn.telecentricWavelengthsNm.length).toBe(1);
    expect(atTurn.poleOrders).toEqual(["double"]);
    expect(atTurn.telecentricWavelengthsNm[0]).toBeCloseTo(556.1139, 3);
  });

  it("the triplet's three, and the bending that reduces them to one", () => {
    const three = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    expect(three.turningPointsNm.length).toBe(2);
    expect(three.turningPointsNm[0]).toBeCloseTo(498.76, 2);
    expect(three.turningPointsNm[1]).toBeCloseTo(634.26, 2);
    expect(three.telecentricWavelengthsNm.length).toBe(3);
    expect(three.telecentricWavelengthsNm[0]).toBeCloseTo(454.965737917, 6);
    expect(three.telecentricWavelengthsNm[1]).toBeCloseTo(LINE_D, 8);
    expect(three.telecentricWavelengthsNm[2]).toBeCloseTo(678.030794906, 6);
    // § 6aq.7, as a catalogue call: the OTHER spherical-null bending, same
    // glasses and same three united colours, is telecentric ONCE over the band
    // the fixture uses — its turns having left it.
    const one = telecentricStop({
      tail: { surfaces: TRIPLET_STEEP.prescription.surfaces },
      bandNm: [400, 700],
      imageDistanceMm: 100,
    });
    expect(one.turningPointsNm.length).toBe(0);
    expect(one.telecentricWavelengthsNm.length).toBe(1);
    expect(one.telecentricWavelengthsNm[0]).toBeCloseTo(LINE_D, 8);
  });

  it("...but a turn placement on a TWO-turn tail is still crossed, which no fixture saw", () => {
    // The finding shipping this produced. § 6ap.5's touched pole means the sign
    // never reverses — on a tail with ONE turn, where the placement's level is
    // reached nowhere else. Put the same placement on the triplet and the curve,
    // having turned twice, comes back down to that level at the red end: the pole
    // is touched at 498.76 and CROSSED at 728.43, so the band reverses once after
    // all.
    //
    // `poleOrder` alone would have read as a statement about the band. It is not,
    // and `poleOrders` is why the distinction is available to a caller.
    const atTurn = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      placement: { kind: "turn" },
      imageDistanceMm: 100,
    });
    expect(atTurn.poleOrder).toBe("double");
    expect(atTurn.telecentricWavelengthsNm.length).toBe(2);
    expect(atTurn.poleOrders).toEqual(["double", "simple"]);
    expect(atTurn.telecentricWavelengthsNm[0]).toBeCloseTo(498.762, 2);
    expect(atTurn.telecentricWavelengthsNm[1]).toBeCloseTo(728.432, 2);
    // Both are real front focal points: the tail's FFD equals the placement at
    // each, to the floor § 6ar.8 measures.
    const group = groupOf(TRIPLET.prescription);
    for (const nm of atTurn.telecentricWavelengthsNm) {
      expect(Math.abs(ffd(group, nm) - atTurn.stopToVertexMm)).toBeLessThan(1e-9);
    }
  });

  it("and a singlet has no turn to place at, which is a fact about the GLASS", () => {
    // § 6an's tail: one glass, FFD(λ) monotone, so there is no double-root
    // placement to ask for. The refusal says which — the tail's, not the
    // request's — because a caller cannot fix this by passing another index.
    const SINGLET: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 40, semiAperture: 20, thickness: 9, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 80, semiAperture: 20, thickness: 0, medium: "AIR" },
      ],
    };
    const placed = telecentricStop({ tail: SINGLET, imageDistanceMm: 100 });
    expect(placed.turningPointsNm.length).toBe(0);
    expect(placed.telecentricWavelengthsNm.length).toBe(1);
    expect(placed.telecentricWavelengthsNm[0]).toBeCloseTo(LINE_D, 8);
    expect(placed.turnUncertaintyNm).toBe(0);
    expect(() =>
      telecentricStop({ tail: SINGLET, placement: { kind: "turn" } }),
    ).toThrow(/no turn in/);
    // Two turns exist on the triplet, so index 2 is the request's fault and says
    // so differently.
    expect(() =>
      telecentricStop({
        tail: { surfaces: TRIPLET.prescription.surfaces },
        placement: { kind: "turn", index: 2 },
      }),
    ).toThrow(/has 2 turns/);
  });

  it("and the placement is the front focal distance by DEFINITION, not by search", () => {
    // The condition itself, so the constructor is not merely self-consistent:
    // a ray leaving the stop centre at slope 1 must leave the tail parallel to
    // the axis. That is D = 0 on the stop-to-exit matrix, and it is what makes
    // the exit pupil sit at infinity.
    const group = groupOf(TRIPLET.prescription);
    const placed = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    expect(frontFocalDistance(group, LINE_D)).toBe(placed.stopToVertexMm);
    // Traced through the composed prescription: the chief ray from the stop
    // centre exits parallel to the axis. Trailing air cannot change an outgoing
    // slope, so the whole prescription is the right thing to trace — slicing the
    // last surface off would drop a refraction and measure a different lens.
    const out = paraxialTrace(placed.prescription, LINE_D, { y: 0, u: 1 });
    // A couple of ulps of an incoming slope of 1 — the gap was CONSTRUCTED as
    // −D/C, so the only thing left in the outgoing slope is the rounding of that
    // division. This is not a physical tolerance; it is "zero in a double".
    expect(Math.abs(out.u)).toBeLessThan(1e-15);
    // The condition is D = 0 on the stop-to-exit matrix, so it is exact at the
    // design wavelength and nowhere else — at 500 nm the same ray leaves tilted.
    expect(Math.abs(paraxialTrace(placed.prescription, 500, { y: 0, u: 1 }).u)).toBeGreaterThan(
      1e-6,
    );
  });
});

describe("§ 6ar.6 — conditioning is a property of the glass triple, and it is not a refusal", () => {
  it("the four ordinary glasses lie on a normal line, and fluorite sits 44× off it", () => {
    // THE EXTERNAL NUMBER behind the whole design: the 3×3 is conditioned only by
    // a glass whose partial dispersion is anomalous for its Abbe number, which is
    // the textbook statement about the "normal line" measured on this catalogue.
    const glass = ["N-BK7", "F2", "FUSED-SILICA", "D263", "CAF2"].map((name) => {
      const m = getMedium(name);
      return {
        name,
        V: abbeNumber(m),
        P: (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C)),
      };
    });
    const ordinary = glass.filter((g) => g.name !== "CAF2");
    const n = ordinary.length;
    const sV = ordinary.reduce((s, g) => s + g.V, 0);
    const sP = ordinary.reduce((s, g) => s + g.P, 0);
    const sVV = ordinary.reduce((s, g) => s + g.V * g.V, 0);
    const sVP = ordinary.reduce((s, g) => s + g.V * g.P, 0);
    const slope = (n * sVP - sV * sP) / (n * sVV - sV * sV);
    const intercept = (sP - slope * sV) / n;
    const off = (g: { V: number; P: number }): number => g.P - (intercept + slope * g.V);
    const worstOrdinary = Math.max(...ordinary.map((g) => Math.abs(off(g))));
    const fluorite = Math.abs(off(glass.find((g) => g.name === "CAF2")!));
    expect(worstOrdinary).toBeLessThan(5e-4);
    expect(fluorite).toBeCloseTo(1.928e-2, 5);
    expect(fluorite / worstOrdinary).toBeGreaterThan(44);
  });

  it("so a CaF₂ triple needs powers of 2.5× and one without it 50× to 518×", () => {
    const conditioningOf = (media: readonly [string, string, string]): number =>
      cementedTripletForm({ apertureMm: APERTURE, focalLengthMm: EFL_TARGET, media }).conditioning;
    expect(conditioningOf(GLASS)).toBeCloseTo(2.578141, 5);
    expect(TRIPLET.conditioning).toBe(conditioningOf(GLASS));
    expect(conditioningOf(["N-BK7", "F2", "FUSED-SILICA"])).toBeCloseTo(49.883, 2);
    expect(conditioningOf(["F2", "FUSED-SILICA", "D263"])).toBeCloseTo(517.947, 2);
    // Every triple containing fluorite is in the same 2.5 band, and every triple
    // without it is two orders worse — which is the finding, not the one triple.
    for (const media of [
      ["CAF2", "F2", "FUSED-SILICA"],
      ["CAF2", "N-BK7", "D263"],
      ["CAF2", "FUSED-SILICA", "D263"],
    ] as const) {
      expect(conditioningOf(media)).toBeLessThan(4);
    }
    for (const media of [
      ["N-BK7", "F2", "D263"],
      ["N-BK7", "FUSED-SILICA", "D263"],
    ] as const) {
      expect(conditioningOf(media)).toBeGreaterThan(40);
    }
    // It is SCALE-FREE: a property of the three glasses and not of the lens.
    for (const f of [10, 1000]) {
      expect(
        cementedTripletForm({ apertureMm: APERTURE, focalLengthMm: f, media: GLASS }).conditioning,
      ).toBeCloseTo(2.578141, 5);
    }
  });

  it("and what it COSTS is a tolerance, pinned to the maker's equation's derivative", () => {
    // § 6aq called an ordinary triple "a singular matrix". It is not singular —
    // it solves — and the honest statement of what its conditioning buys is a
    // manufacturing tolerance, in closed form:
    //
    //   φ = Σ (nₖ − nₖ₋₁)·cₖ  ⇒  a RELATIVE error ε on cₖ gives Δf/f = −ε·f·cₖ·Δnₖ
    //
    // so the amplification is |f·cₖ·Δnₖ|. Traced against the thin closed form on
    // the shipped triplet, and the gap is thickness as everywhere else here.
    const group = groupOf(TRIPLET.prescription);
    const n = [1, ...TRIPLET.indices, 1];
    const f0 = efl(group, LINE_D);
    const EPS = 1e-6;
    let worst = 0;
    for (let k = 0; k < 4; k++) {
      const bumped: Prescription = {
        surfaces: group.surfaces.map((s, i) =>
          i === k ? { ...s, curvature: s.curvature * (1 + EPS) } : s,
        ),
      };
      const traced = (efl(bumped, LINE_D) - f0) / f0;
      const predicted = -EPS * TRIPLET.curvatures[k]! * (n[k + 1]! - n[k]!) * f0;
      // Within 6%, and the gap is the glass being thick — the same separation
      // term that puts § 6ar.1's powers 1.5% off the thin split and § 6ap.1's
      // doublet 4.3% off its own. A closed form for a THIN lens does not become
      // exact because it is differentiated.
      expect(Math.abs(traced / predicted - 1)).toBeLessThan(0.06);
      worst = Math.max(worst, Math.abs(traced) / EPS);
    }
    // The constructor reports that amplification, and it is the thin-lens one.
    expect(TRIPLET.toleranceAmplification).toBeCloseTo(1.253215, 5);
    expect(Math.abs(worst / TRIPLET.toleranceAmplification - 1)).toBeLessThan(0.06);
    // And it tracks the conditioning — well corrected glass, loose tolerance.
    expect(TRIPLET.toleranceAmplification).toBeLessThan(2);
  });

  it("...and a focal-ratio wall, which is where the refusal actually comes from", () => {
    // The default triple builds at f/6 and refuses at f/5, and the mechanism is
    // `designs/achromat`'s own: the steep branch's surfaces reach hemispherical.
    // At f/5.5 its steepest surface is at 0.946 of a hemisphere, and one step
    // faster it is past 1 and is not a surface.
    const steepestAt = (F: number): number =>
      Math.max(
        ...apochromaticObjective({ ...spec, focalRatio: F }).branches.map((b) => b.maxSurfaceSlope),
      );
    expect(steepestAt(6)).toBeCloseTo(0.733, 2);
    expect(steepestAt(5.5)).toBeCloseTo(0.946, 2);
    expect(steepestAt(5.5)).toBeLessThan(1);
    expect(() => apochromaticObjective({ ...spec, focalRatio: 5 })).toThrow(TripletApertureRefusal);

    // A CaF₂-free triple refuses at the fixture's own ratio, and the message says
    // the aperture is what binds — 2.37 hemispheres at the steepest surface.
    let thrown: unknown;
    try {
      apochromaticObjective({ ...spec, media: ["N-BK7", "F2", "FUSED-SILICA"] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TripletApertureRefusal);
    expect((thrown as Error).message).toContain("deeper than hemispherical");
    expect((thrown as Error).message).toContain("APERTURE");

    // Slower, the curvatures ARE buildable and the refusal changes character: it
    // becomes "found 0", because ΣS_I keeps one sign across every buildable
    // bending. That is the honest form of "no apochromat without fluorite" — a
    // result about the spherical solve, and not about a matrix that will not
    // invert. It is an ordinary Error, not the aperture type, because slowing
    // down further is not what fixes it.
    let slow: unknown;
    try {
      apochromaticObjective({ ...spec, media: ["N-BK7", "F2", "FUSED-SILICA"], focalRatio: 200 });
    } catch (e) {
      slow = e;
    }
    expect(slow).toBeInstanceOf(Error);
    expect(slow).not.toBeInstanceOf(TripletApertureRefusal);
    expect((slow as Error).message).toContain("found 0");
  });
});

describe("§ 6ar.7 — the fixtures now call the constructors, and no digit moved", () => {
  it("§ 6ap's doublet placement, rebuilt from the catalogue, is § 6ap's", () => {
    // An EQUIVALENCE pin, labelled as one. It is not evidence about optics; it
    // is the guarantee that moving a solve out of a test file did not quietly
    // move a lens. The physics behind these numbers is § 6ap's and § 6aq's.
    const placed = telecentricStop({
      tail: { surfaces: DOUBLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    const group = groupOf({ surfaces: DOUBLET.prescription.surfaces });
    expect(placed.stopToVertexMm).toBe(ffd(group, LINE_D));
    expect(placed.telecentricWavelengthsNm[0]).toBeCloseTo(528.349225534, 8);
  });

  it("and § 6aq's triplet, rebuilt by the shipped solve, is § 6aq's", () => {
    expect(TRIPLET.radiiMm[0]).toBeCloseTo(18.348013, 5);
    expect(ffd(TRIPLET_GROUP, LINE_D)).toBeCloseTo(53.007115531, 8);
    expect(TRIPLET.paraxialFocalLengthMm).toBeCloseTo(EFL_TARGET, 10);
    // And the whole visible band's residual is § 6aq.1's 5.79e−4, on a lens the
    // catalogue built rather than one the fixture did.
    let worst = 0;
    const f0 = efl(TRIPLET_GROUP, LINE_D);
    for (let nm = 400; nm <= 700; nm += 0.5) {
      worst = Math.max(worst, Math.abs(efl(TRIPLET_GROUP, nm) - f0) / f0);
    }
    expect(worst).toBeCloseTo(5.7919e-4, 7);
  });

  it("and the composed system still images where the fixture put its sensor", () => {
    // The end of the chain: the constructor's prescription, driven as § 6aq
    // drives it, focuses at the same distance. Nothing here is a new claim about
    // focus — it is that the two routes are the same system.
    const placed = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    const system: OpticalSystem = {
      prescription: placed.prescription,
      aperture: { kind: "stopRadius", value: STOP_R },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance: OBJECT_DISTANCE },
    };
    const offset = paraxialImageOffset(system, LINE_D);
    expect(Number.isFinite(offset)).toBe(true);
    // The exit pupil is at infinity, which is the whole point of the placement.
    expect(pupils(system, LINE_D).exit.z).toBe(Infinity);
  });
});

describe("§ 6ar.8 — a searched wavelength is quoted to what the search can locate", () => {
  it("a crossing has a floor, and it is ε on the FFD scale over the slope", () => {
    // § 6aq.4 pinned the d line's pole to NINE decimals on the argument that "a
    // sign is exact". The sign is exact; the function is not. FFD(λ) minus the
    // placement is a difference of two numbers near 53 mm, so it carries nothing
    // below 53·ε ≈ 1.2e−14 mm, and at the d line the curve climbs at 2.84e−5
    // mm/nm. Dividing gives the floor, and it is not a fitted number.
    const group = TRIPLET_GROUP;
    const level = ffd(group, LINE_D);
    const slope = (ffd(group, LINE_D + 1) - ffd(group, LINE_D - 1)) / 2;
    expect(slope).toBeCloseTo(2.8377e-5, 8);
    const floor = (Math.abs(level) * Number.EPSILON) / Math.abs(slope);
    expect(floor).toBeCloseTo(4.148e-10, 12);

    // Measured against it: the same lens from five brackets.
    const g = (nm: number) => ffd(group, nm) - level;
    const answers = (
      [
        [587.5, 587.6],
        [587.55, 587.57],
        [587, 588],
        [585, 590],
        [587.56, 587.5619],
      ] as const
    ).map(([a, b]) => bisect(g, a, b));
    const spread = Math.max(...answers) - Math.min(...answers);
    expect(spread).toBeGreaterThan(floor);
    expect(spread).toBeLessThan(5e-9);
    // Four of the five miss the d line by more than nine decimals allowed, which
    // is why § 6aq.4's pin was the bracket and not the lens.
    expect(answers.filter((nm) => Math.abs(nm - LINE_D) > 5e-10).length).toBeGreaterThanOrEqual(3);
  });

  it("so the constructor reports BOTH uncertainties, and the turn's is far worse", () => {
    // A turn is a √ε business where a crossing is an ε one, and the two differ by
    // about six orders here. Reporting one and not the other would invite exactly
    // the mistake § 6aq.4 made.
    const placed = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    expect(placed.crossingUncertaintyNm).toBeGreaterThan(0);
    expect(placed.crossingUncertaintyNm).toBeLessThan(1e-8);
    expect(placed.turnUncertaintyNm).toBeGreaterThan(1e-4);
    expect(placed.turnUncertaintyNm).toBeLessThan(1e-2);
    expect(placed.turnUncertaintyNm / placed.crossingUncertaintyNm).toBeGreaterThan(1e4);

    // The turns are therefore quoted to two decimals and no more — § 6aq.3's own
    // conclusion, now carried by the object rather than by a comment. The digits
    // agree with § 6aq to exactly that many.
    expect(placed.turningPointsNm[0]).toBeCloseTo(498.76, 2);
    expect(placed.turningPointsNm[1]).toBeCloseTo(634.26, 2);
    // And the uncertainty is bigger than the last digit quoted would suggest is
    // safe to add: 5e−4 nm is the fourth decimal, so a fifth would be fiction.
    expect(placed.turnUncertaintyNm).toBeGreaterThan(1e-5);
  });

  it("and the uncertainty is the SEARCH's, not the lens's — the bending moves it less", () => {
    // The discriminator § 6aq.3 used, repeated on the shipped object because it
    // is what licenses the two-decimal quote. Perturb the design's own bending by
    // far more than the solve's residual and the turn barely moves; change the
    // bracket and it moves more. So the spread belongs to the search.
    const placed = telecentricStop({
      tail: { surfaces: TRIPLET.prescription.surfaces },
      imageDistanceMm: 100,
    });
    const form = cementedTripletForm({
      apertureMm: APERTURE,
      focalLengthMm: EFL_TARGET,
      media: GLASS,
      thicknessesMm: THICKNESS,
    });
    const nudged = form.curvaturesAt(TRIPLET.curvatures[0]! * (1 + 1e-12));
    const moved = telecentricStop({
      tail: fixtureBuild(nudged),
      imageDistanceMm: 100,
    });
    const shift = Math.abs(moved.turningPointsNm[0]! - placed.turningPointsNm[0]!);
    expect(shift).toBeLessThan(placed.turnUncertaintyNm);
  });
});
