import { describe, it, expect } from "vitest";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";
import { systemProperties } from "../src/trace/paraxial";
import { Prescription } from "../src/trace/prescription";
import {
  solveParaxial,
  solveScalar,
  withVariable,
  type SolveVariable,
} from "../src/analysis/solve";
import { huygensEyepiece } from "../src/designs/eyepiece";

/**
 * Step 1.7 — the paraxial solve.
 *
 * The external number is **Gullstrand's thick-lens equation**, which for a lens
 * of index n and axial thickness d in air is
 *
 *   P = (n−1)(c₁ − c₂) + (d/n)·(n−1)²·c₁·c₂            [Hecht, Optics, §5.2;
 *   f = 1/P,   BFD = f·(1 − (d/n)·(n−1)·c₁)             Smith, MOE, §2.6]
 *
 * and it is worth saying exactly what makes this a rung rather than a
 * convenience. The equation is not being used to check the tracer — § 1 already
 * did that. It is being used because **it can be INVERTED in closed form**, so
 * every rung below compares the solver's answer against an algebraic expression
 * for the same root rather than against "the number it converged to last time".
 * An optimiser test that only says "it found something" is regression, not
 * validation, and this file is built so that it never has to say that.
 *
 * The inverses, all exact:
 *
 *   thickness for a focal length   d = (1/f − A) / B,    A = (n−1)(c₁−c₂),
 *   curvature  for a focal length  c₂ = (1/f − (n−1)c₁)  B = (n−1)²c₁c₂/n
 *                                       / ((d/n)(n−1)²c₁ − (n−1))
 *   thickness for a back focus     d = (1 − t·A) / (t·B + (n−1)c₁/n)
 *
 * The first two are LINEAR, which is the point of including them: the closed
 * form is exact, so the solver has to land on the ulp and there is no tolerance
 * to argue about. The third is a genuine rational function of d — measured
 * curvature below — so it is the one that actually exercises the root finder.
 *
 * The multiplicity rung uses the **equiconvex constraint** c₂ = −c₁, under
 * which the power is quadratic,
 *
 *   P(c) = 2(n−1)c − (d/n)(n−1)²c²,
 *
 * with a maximum at c* = n/(d(n−1)) and therefore a SHORTEST ACHIEVABLE FOCAL
 * LENGTH. That single system pins three things this module claims and nothing
 * else in the ladder does: two roots for one target, the seed choosing between
 * them, and the refusal when a target is past the extremum. The quadratic
 * formula supplies both roots in closed form, so even the multiplicity is
 * checked against algebra.
 *
 * SCOPE, stated because the signature admits more than the ladder pins:
 *  - **Paraxial only.** These targets are first-order properties. A solve
 *    against a traced quantity (an RMS spot, a Zernike term) is the
 *    damped-least-squares half of design mode and is deliberately not here —
 *    it needs a merit whose minimiser is closed-form before it can be pinned.
 *  - **One variable.** Nothing here couples two parameters; `solveScalar` takes
 *    a closure, so a caller can constrain them (the equiconvex rung does
 *    exactly that), but the solver moves one number.
 */

const n = getMedium("N-BK7").n(LINE_D);

/** A thick lens in air. The trailing 100 mm is only somewhere for the light to
 *  go; `systemProperties` rewinds it to measure BFD from the last vertex. */
function thickLens(c1: number, c2: number, d: number): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: 10, thickness: d, medium: "N-BK7" },
      { kind: "refract", curvature: c2, semiAperture: 10, thickness: 100, medium: "AIR" },
    ],
  };
}

/** Gullstrand, as quoted in the header. */
function power(c1: number, c2: number, d: number): number {
  return (n - 1) * (c1 - c2) + (d / n) * (n - 1) * (n - 1) * c1 * c2;
}

function backFocus(c1: number, c2: number, d: number): number {
  return (1 - (d / n) * (n - 1) * c1) / power(c1, c2, d);
}

const THICKNESS = (surface: number): SolveVariable => ({ kind: "thickness", surface });
const CURVATURE = (surface: number): SolveVariable => ({ kind: "curvature", surface });

describe("step 1.7 — the closed form the solver is checked against", () => {
  it("Gullstrand IS the engine's EFL and BFD, so the inverses below are the engine's inverses", () => {
    // Without this the whole file could be self-consistently wrong: the solver
    // would agree with an equation the tracer does not obey. Both properties,
    // three geometries, at the f64 floor.
    for (const [c1, c2, d] of [
      [1 / 100, -1 / 100, 5],
      [1 / 50, 1 / 200, 12],
      [1 / 60, -1 / 300, 3],
    ] as const) {
      const p = systemProperties(thickLens(c1, c2, d), LINE_D);
      expect(p.efl).toBeCloseTo(1 / power(c1, c2, d), 10);
      expect(Math.abs(p.efl - 1 / power(c1, c2, d)) / p.efl).toBeLessThan(1e-15);
      expect(Math.abs(p.bfd - backFocus(c1, c2, d)) / p.bfd).toBeLessThan(1e-15);
    }
  });
});

describe("step 1.7 — a thickness solved for a focal length", () => {
  const c1 = 1 / 60;
  const c2 = -1 / 300;
  const A = (n - 1) * (c1 - c2);
  const B = ((n - 1) * (n - 1) * c1 * c2) / n;

  it("lands on the closed-form root", () => {
    // B is negative here (c₁c₂ < 0), so thickening this lens WEAKENS it: over
    // [0.5, 60] mm the reachable focal lengths run 96.8 → 102.6, and 100 mm sits
    // inside that. Asking for 95 would be asking for a lens this variable cannot
    // make — which is the refusal rung further down, not this one.
    const targetF = 100;
    const expected = (1 / targetF - A) / B;
    expect(expected).toBeGreaterThan(0.5);
    expect(expected).toBeLessThan(60);

    const solved = solveParaxial(
      thickLens(c1, c2, 5),
      THICKNESS(0),
      { kind: "efl", value: targetF },
      LINE_D,
      { interval: [0.5, 60] },
    );

    expect(solved.roots).toHaveLength(1);
    // The relation is linear and the inverse is exact, so this is a fixed-point
    // comparison and not a converged-close-enough one. Measured at 2.28e-15
    // relative — 10 ulp on the 34.3 mm answer — and the bound is stated at what
    // was measured rather than at a round number with room in it.
    //
    // That residue is NOT the solver failing to converge: `residual` below is
    // exactly zero, so the value the solver returned and the value the closed
    // form returns are both roots to the last bit, and the 2.28e-15 between them
    // is the closed form's own conditioning. Calling it "Brent's stopping width"
    // would have been the wrong attribution.
    expect(Math.abs(solved.x - expected) / expected).toBeLessThan(3e-15);
    // What the caller actually asked for, checked on the BUILT lens rather than
    // on the solver's own bookkeeping.
    const built = withVariable(thickLens(c1, c2, 5), THICKNESS(0), solved.x);
    expect(Math.abs(systemProperties(built, LINE_D).efl - targetF)).toBeLessThan(1e-9);
    expect(solved.evaluations).toBeLessThan(120);
  });

  it("is linear in the thickness, which is why the rung above is exact", () => {
    // The second difference of the POWER in d is identically zero — not small,
    // zero — so the closed form is not an approximation being tolerated.
    const P = (d: number) => 1 / systemProperties(thickLens(c1, c2, d), LINE_D).efl;
    expect(P(2) - 2 * P(6) + P(10)).toBe(0);
  });

  it("does not mutate the prescription it was handed", () => {
    const original = thickLens(c1, c2, 5);
    solveParaxial(original, THICKNESS(0), { kind: "efl", value: 100 }, LINE_D, {
      interval: [0.5, 60],
    });
    expect(original.surfaces[0]!.thickness).toBe(5);
    expect(withVariable(original, THICKNESS(0), 12).surfaces[0]!.thickness).toBe(12);
    expect(original.surfaces[0]!.thickness).toBe(5);
  });
});

describe("step 1.7 — a curvature solved for a focal length", () => {
  const c1 = 1 / 60;
  const d = 6;

  it("lands on the closed-form root", () => {
    const targetF = 120;
    // P = (n−1)c₁ + c₂·[(d/n)(n−1)²c₁ − (n−1)], linear in c₂.
    const slope = (d / n) * (n - 1) * (n - 1) * c1 - (n - 1);
    const expected = (1 / targetF - (n - 1) * c1) / slope;

    const solved = solveParaxial(
      thickLens(c1, -1 / 300, d),
      CURVATURE(1),
      { kind: "efl", value: targetF },
      LINE_D,
      { interval: [-0.05, 0.05] },
    );

    expect(solved.roots).toHaveLength(1);
    expect(Math.abs(solved.x - expected)).toBeLessThan(1e-18); // measured 2.2e-19
    // The answer in the units an optician would quote it in: a weak POSITIVE
    // second radius, i.e. the lens is bent into a meniscus to give up power.
    expect(1 / expected).toBeCloseTo(1782.8241, 4); // R₂ ≈ +1782.82 mm
  });
});

describe("step 1.7 — a back focus solved for, which is the nonlinear one", () => {
  const c1 = 1 / 60;
  const c2 = -1 / 300;
  const A = (n - 1) * (c1 - c2);
  const B = ((n - 1) * (n - 1) * c1 * c2) / n;

  it("is genuinely a rational function of the thickness, not a line", () => {
    // If this were linear the rung below would be testing the same thing the
    // EFL one already tested. The second difference is 1.5e-4 of the value —
    // small, and 10¹² times the zero the power gives.
    const bfd = (dd: number) => systemProperties(thickLens(c1, c2, dd), LINE_D).bfd;
    const second = bfd(2) - 2 * bfd(6) + bfd(10);
    expect(Math.abs(second)).toBeGreaterThan(1e-3);
    expect(Math.abs(second) / bfd(6)).toBeCloseTo(1.5e-4, 5);
  });

  it("lands on the closed-form root", () => {
    const targetBfd = 92;
    const expected = (1 - targetBfd * A) / (targetBfd * B + ((n - 1) * c1) / n);

    const solved = solveParaxial(
      thickLens(c1, c2, 5),
      THICKNESS(0),
      { kind: "bfd", value: targetBfd },
      LINE_D,
      { interval: [0.5, 60] },
    );

    expect(solved.roots).toHaveLength(1);
    // The one nonlinear target in the set, and it still lands on the closed
    // form BIT FOR BIT — measured at exactly zero relative difference, not
    // merely small. The residual it leaves is on the property rather than on
    // the variable: 1.4e-14 mm of back focus, which is 1.5e-16 of the 92 mm.
    expect(Math.abs(solved.x - expected) / expected).toBeLessThan(1e-16);
    expect(Math.abs(solved.residual)).toBeLessThan(1e-13);
  });
});

describe("step 1.7 — two roots, and which one the seed picks", () => {
  // Equiconvex: c₂ = −c₁, so P(c) = 2(n−1)c − (d/n)(n−1)²c² — a downward
  // parabola. `solveScalar` takes the closure; nothing in `SolveVariable`
  // couples two surfaces, and this is how a caller constrains them.
  const d = 8;
  const a = -(d / n) * (n - 1) * (n - 1);
  const b = 2 * (n - 1);
  const cVertex = -b / (2 * a);
  const shortestF = 1 / (a * cVertex * cVertex + b * cVertex);

  const equiconvexPower = (c: number): number =>
    1 / systemProperties(thickLens(c, -c, d), LINE_D).efl;

  it("has a shortest achievable focal length, and it is where the algebra says", () => {
    expect(cVertex).toBeCloseTo(0.3668730489, 9);
    expect(shortestF).toBeCloseTo(5.274261483, 8);
    // The engine's own power at the vertex, against the parabola's.
    expect(equiconvexPower(cVertex)).toBeCloseTo(a * cVertex * cVertex + b * cVertex, 14);
  });

  it("finds BOTH curvatures that deliver one focal length, and both are the quadratic's", () => {
    const targetF = 2 * shortestF; // comfortably reachable, so two roots exist
    const pTarget = 1 / targetF;
    const disc = Math.sqrt(b * b - 4 * a * -pTarget);
    const closed = [(-b + disc) / (2 * a), (-b - disc) / (2 * a)].sort((p, q) => p - q);

    const solved = solveScalar(equiconvexPower, pTarget, { interval: [0.01, 0.9] });

    expect(solved.roots).toHaveLength(2);
    expect(solved.roots[0]!.x).toBeCloseTo(closed[0]!, 12);
    expect(solved.roots[1]!.x).toBeCloseTo(closed[1]!, 12);
    // Not merely "two numbers": both are real solutions of the design problem.
    for (const r of solved.roots) {
      expect(systemProperties(thickLens(r.x, -r.x, d), LINE_D).efl).toBeCloseTo(targetF, 8);
    }
  });

  it("returns the root nearest the seed, and the seed is the only thing that decides", () => {
    const targetF = 2 * shortestF;
    const pTarget = 1 / targetF;
    const low = solveScalar(equiconvexPower, pTarget, { interval: [0.01, 0.9], seed: 0.02 });
    const high = solveScalar(equiconvexPower, pTarget, { interval: [0.01, 0.9], seed: 0.85 });

    expect(low.x).toBeCloseTo(0.1074546282, 9);
    expect(high.x).toBeCloseTo(0.6262914696, 9);
    expect(low.x).not.toBeCloseTo(high.x, 3);
    // Same interval, same roots — only the choice among them moved.
    expect(low.roots.map((r) => r.x)).toEqual(high.roots.map((r) => r.x));
  });

  it("breaks an EXACT tie toward the smaller x, so the answer is not the scan order", () => {
    // Pinned on x² rather than on the lens, and the reason is the point: the
    // midpoint between the two equiconvex roots is not equidistant from them in
    // f64 — it misses by an ulp, one root wins on arithmetic, and the tie-break
    // is never reached. A tie has to be CONSTRUCTED to be tested. Here the roots
    // are ±2 exactly and the seed is 0, so both distances are the same double.
    const tied = solveScalar((x) => x * x, 4, { interval: [-3, 3], seed: 0 });
    expect(tied.roots.map((r) => r.x)).toEqual([-2, 2]);
    expect(Math.abs(tied.roots[0]!.x - 0)).toBe(Math.abs(tied.roots[1]!.x - 0));
    expect(tied.x).toBe(-2);
  });

  it("refuses a focal length shorter than the lens can produce, and says how close it came", () => {
    const impossible = 0.9 * shortestF;
    expect(() =>
      solveScalar(equiconvexPower, 1 / impossible, { interval: [0.01, 0.9] }),
    ).toThrow(/is not reached over \[0\.01, 0\.9\] scanned in 64 cells/);
    // The measured number is in the message: this engine refuses a readout it
    // cannot produce rather than returning the nearest edge.
    let message = "";
    try {
      solveScalar(equiconvexPower, 1 / impossible, { interval: [0.01, 0.9] });
    } catch (err) {
      message = (err as Error).message;
    }
    const closest = Number(/closest the scan came is ([-\d.e+]+)/.exec(message)?.[1]);
    // The closest approach IS the vertex power, to the scan's own resolution.
    expect(1 / closest).toBeGreaterThan(shortestF * 0.999);
    expect(1 / closest).toBeLessThan(shortestF * 1.01);
  });
});

describe("step 1.7 — the pole, which is a root the arithmetic invents", () => {
  // A two-element air-spaced pair whose net power passes through zero as the gap
  // opens: a weak positive singlet (f ≈ +60) followed by a stronger negative one
  // (f ≈ −50), so P = P₁ + P₂ − d·P₁P₂ starts negative and is driven positive by
  // the separation. It is afocal at d = 9.0159878 mm — measured by bisecting the
  // sign of the power, and equal to the value this module's own refusal names
  // below; the ≈ 9.67 this comment used to carry was an estimate nothing had
  // checked, corrected when APP.md's Part M put the question to the solver.
  // Either side of that the EFL runs
  // to ∓∞, so it crosses EVERY focal length between the two branches with a sign
  // change — and none of those crossings is a lens of that focal length.
  const pair = (gap: number): Prescription => ({
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 10, thickness: 2, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 10, thickness: gap, medium: "AIR" },
      { kind: "refract", curvature: -1 / 50, semiAperture: 10, thickness: 2, medium: "N-BK7" },
      { kind: "refract", curvature: 1 / 50, semiAperture: 10, thickness: 100, medium: "AIR" },
    ],
  });
  const GAP: SolveVariable = { kind: "thickness", surface: 1 };
  const INTERVAL: readonly [number, number] = [1, 120];

  it("the pole is really in the interval — the EFL changes sign across it", () => {
    const efl = (g: number) => systemProperties(pair(g), LINE_D).efl;
    expect(efl(5)).toBeLessThan(0);
    expect(efl(110)).toBeGreaterThan(0);
    // And it is a pole rather than a zero: the magnitude blows up in between.
    let biggest = 0;
    for (let g = 1; g <= 120; g += 0.5) biggest = Math.max(biggest, Math.abs(efl(g)));
    expect(biggest).toBeGreaterThan(1e4);
  });

  it("solveScalar aimed straight at the EFL refuses the pole instead of returning it", () => {
    // +20 mm lies in the gap between the two branches — the positive branch
    // bottoms out at ~25.4 mm over this interval — so it is genuinely
    // unreachable, and the only sign change the scan sees is the pole itself.
    expect(() =>
      solveScalar((g) => systemProperties(pair(g), LINE_D).efl, 20, { interval: INTERVAL }),
    ).toThrow(/every sign change .* was a pole rather than a root/);
  });

  it("solveParaxial does not meet the pole at all, because it solves the power", () => {
    // Same system, same interval, same question — asked as 1/efl, which is
    // LINEAR in this gap and therefore has no pole to invent a crossing at. The
    // refusal is now the honest one: the target is simply not in range.
    expect(() =>
      solveParaxial(pair(20), GAP, { kind: "efl", value: 20 }, LINE_D, { interval: INTERVAL }),
    ).toThrow(/is not reached over/);
    expect(() =>
      solveParaxial(pair(20), GAP, { kind: "efl", value: 20 }, LINE_D, { interval: INTERVAL }),
    ).not.toThrow(/pole/);

    // And a target that IS reachable on this pair solves cleanly through the
    // same call, so the rung above is not passing because everything throws.
    const reachable = solveParaxial(pair(20), GAP, { kind: "efl", value: 50 }, LINE_D, {
      interval: INTERVAL,
    });
    expect(reachable.roots).toHaveLength(1);
    expect(systemProperties(pair(reachable.x), LINE_D).efl).toBeCloseTo(50, 7);
  });
});

describe("step 1.7 — the wall, where `evaluate` says there is no system", () => {
  /**
   * The module treats a throwing or non-finite `evaluate` as a WALL rather than
   * propagating it: the cells touching it are skipped instead of being allowed
   * to manufacture a sign change against a neighbour. Every other fixture in
   * this file is a real optical system, and `systemProperties` only throws on an
   * exactly afocal chain — which a 64-cell scan meets with probability zero. So
   * the convention needs a synthetic closure, or it is a documented guess.
   */
  it("still finds a root that lies outside the wall", () => {
    const walled = (x: number): number => {
      if (x >= 3 && x <= 5) return Number.NaN; // "not a system here"
      return x;
    };
    const solved = solveScalar(walled, 8, { interval: [0, 10] });
    expect(solved.x).toBeCloseTo(8, 12);
    expect(solved.roots).toHaveLength(1);
  });

  it("does the same when `evaluate` throws rather than returning NaN", () => {
    const throwing = (x: number): number => {
      if (x >= 3 && x <= 5) throw new Error("afocal in image space: there is no paraxial image plane");
      return x;
    };
    expect(solveScalar(throwing, 8, { interval: [0, 10] }).x).toBeCloseTo(8, 12);
  });

  it("invents no root across the wall, even though the value changes sign over it", () => {
    // −1 on the left, +1 on the right, nothing in between. A solver that read
    // the wall's neighbours as a bracket would report a root at ~4 that does not
    // exist — the same shape of mistake as the pole, arrived at from the
    // opposite direction.
    const cliff = (x: number): number => {
      if (x >= 3 && x <= 5) return Number.NaN;
      return x < 3 ? -1 : 1;
    };
    expect(() => solveScalar(cliff, 0, { interval: [0, 10] })).toThrow(/is not reached over/);
  });

  it("refuses a root that lies INSIDE a wall, having walked into it mid-bracket", () => {
    // The bracket's own endpoints are finite and opposite in sign, so the scan
    // hands Brent a cell it must refine — and the refinement walks into the
    // slit, which is the one path that exercises the in-bracket fallback. The
    // root is not a system, so whatever comes back fails its own residual check.
    const slit = (x: number): number => {
      if (x >= 7.42 && x <= 7.46) return Number.NaN;
      return x - 7.44;
    };
    expect(() => solveScalar(slit, 0, { interval: [0, 10], scanCells: 10 })).toThrow(
      /was a pole rather than a root/,
    );
  });
});

describe("step 1.7 — the tolerance a caller states, and the solve that lands exactly", () => {
  const c1 = 1 / 60;
  const c2 = -1 / 300;

  it("an efl solve lands EXACTLY, which is why no tolerance in either unit can be too tight", () => {
    // The paraxial system matrix is a product of [[1,0],[−φ,1]] and [[1,t],[0,1]]
    // factors, so it is AFFINE in any one curvature or any one thickness — and
    // so is the power. Brent's first interpolation step therefore lands on the
    // root of a straight line exactly, and the residual is not small, it is
    // zero. Measured here on both the value and the power it was solved in.
    const solved = solveParaxial(
      thickLens(c1, c2, 5),
      THICKNESS(0),
      { kind: "efl", value: 100 },
      LINE_D,
      { interval: [0.5, 60], valueTolerance: 1e-9 },
    );
    expect(solved.residual).toBe(0);
    const built = withVariable(thickLens(c1, c2, 5), THICKNESS(0), solved.x);
    expect(1 / systemProperties(built, LINE_D).efl - 1 / 100).toBe(0);

    // This is what makes the unit of `valueTolerance` a correctness question
    // that no fixture can currently expose: an exact root passes any guard, so
    // handing the mm figure into a solve on 1/f would be wrong by f² and pass
    // anyway. It is fixed by construction — the conversion is one line in
    // `solveParaxial` — and § 1.7 records it as unpinnable until a target
    // arrives whose solve is not exact. The arithmetic the fix rests on:
    expect(1e-9 / (100 * 100)).toBe(1e-13);
  });

  it("a bfd tolerance means the same thing, and it always did", () => {
    const solved = solveParaxial(
      thickLens(c1, c2, 5),
      THICKNESS(0),
      { kind: "bfd", value: 92 },
      LINE_D,
      { interval: [0.5, 60], valueTolerance: 1e-9 },
    );
    expect(Math.abs(solved.residual)).toBeLessThan(1e-9);
  });
});

describe("step 1.7 — the general solver reproduces a bespoke one", () => {
  /**
   * `huygensEyepiece` runs its own unguarded secant on an overall scale to hit a
   * target focal length (`designs/eyepiece.ts`), and § 5o pins the eyepiece it
   * produces. This is the regression net the new module gets for free: rebuild
   * that same one-parameter family here, solve it with `solveScalar`, and the
   * two answers have to be the same lens. The call sites are deliberately NOT
   * refactored onto this module — that is diff churn buying nothing this rung
   * does not already assert.
   */
  it("lands on the same scale the eyepiece's own secant converged to", () => {
    const fe = 25;
    const built = huygensEyepiece({ focalLengthMm: fe });
    const t = Math.max(0.5, 0.03 * fe);
    const clearR = ((0.8 * fe) / 2) * 1.02;
    const r = 3;
    const f1Seed = (fe * (r + 1)) / 2;
    const f2Seed = (fe * (r + 1)) / (2 * r);

    const planoConvex = (f: number, last: number) => [
      {
        kind: "refract" as const,
        curvature: 1 / ((n - 1) * f),
        semiAperture: clearR,
        thickness: t,
        medium: "N-BK7",
      },
      {
        kind: "refract" as const,
        curvature: 0,
        semiAperture: clearR,
        thickness: last,
        medium: "AIR",
      },
    ];
    const build = (s: number): Prescription => {
      const f1 = s * f1Seed;
      const f2 = s * f2Seed;
      return { surfaces: [...planoConvex(f1, (f1 + f2) / 2), ...planoConvex(f2, 0)] };
    };

    const solved = solveScalar((s) => 1 / systemProperties(build(s), LINE_D).efl, 1 / fe, {
      interval: [0.5, 2],
    });

    // The bespoke secant stops at |Δf| < f·1e-12; agreement is pinned an order
    // tighter than that on the quantity both solvers were aiming at.
    expect(systemProperties(build(solved.x), LINE_D).efl).toBeCloseTo(fe, 10);
    expect(built.focalLengthMm).toBeCloseTo(fe, 10);
    // And the same lens, not merely the same focal length: the separation the
    // eyepiece reports is the one this scale produces.
    const f1 = solved.x * f1Seed;
    const f2 = solved.x * f2Seed;
    expect((f1 + f2) / 2).toBeCloseTo(built.separationMm, 9);
    expect(f1).toBeCloseTo(built.fieldLensFocalMm, 9);
  });
});

describe("step 1.7 — what the solver refuses to be asked", () => {
  const p = thickLens(1 / 60, -1 / 300, 5);

  it("an interval that is empty, reversed or not finite", () => {
    for (const interval of [
      [5, 5],
      [10, 1],
      [Number.NaN, 1],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => solveScalar((x) => x, 1, { interval })).toThrow(/interval/);
    }
  });

  it("a surface index that is not in the prescription", () => {
    expect(() =>
      solveParaxial(p, THICKNESS(7), { kind: "efl", value: 95 }, LINE_D, { interval: [1, 50] }),
    ).toThrow(/surface 7 is not in a prescription of 2/);
    expect(() => withVariable(p, CURVATURE(-1), 0)).toThrow(/is not in a prescription of 2/);
  });

  it("a focal length of zero, which is not a design target", () => {
    expect(() =>
      solveParaxial(p, THICKNESS(0), { kind: "efl", value: 0 }, LINE_D, { interval: [1, 50] }),
    ).toThrow(/is not a design target/);
  });

  it("a scan resolution that is not a count", () => {
    expect(() =>
      solveScalar((x) => x, 1, { interval: [0, 10], scanCells: 2.5 }),
    ).toThrow(/scanCells must be a positive integer/);
  });
});

describe("step 1.7 — the blindness the scan buys, measured rather than asserted", () => {
  /**
   * A cell holding an EVEN number of roots shows no sign change across it. The
   * module header says so; this is the demonstration, because a documented sharp
   * edge nobody has run is a documented guess.
   */
  const d = 8;
  const equiconvexPower = (c: number): number =>
    1 / systemProperties(thickLens(c, -c, d), LINE_D).efl;
  // P(c) = a·c² + b·c, so the vertex power is −b²/4a and the two roots of
  // P = k·P* sit at c* ± √((1−k)·P*/(−a)). At k = 0.9995 that is ±0.0082 —
  // a pair 0.0164 apart, deliberately narrower than the coarse cell below.
  const a = -(d / n) * (n - 1) * (n - 1);
  const b = 2 * (n - 1);
  const vertexPower = (-b * b) / (4 * a);
  const target = 0.9995 * vertexPower;
  const spacing = 2 * Math.sqrt((0.0005 * vertexPower) / -a);

  it("finds the pair when the cells are finer than their spacing", () => {
    expect(spacing).toBeGreaterThan(0.016);
    expect(spacing).toBeLessThan(0.017);
    const solved = solveScalar(equiconvexPower, target, { interval: [0.01, 0.9], scanCells: 256 });
    expect(solved.roots).toHaveLength(2);
    // 256 cells over [0.01, 0.9] is 0.0035 wide — five times finer than the pair.
    expect(solved.roots[1]!.x - solved.roots[0]!.x).toBeCloseTo(spacing, 6);
  });

  it("steps over the same pair when one cell swallows both", () => {
    // 8 cells is 0.111 wide, and the pair at 0.3587/0.3751 falls inside the one
    // spanning [0.3438, 0.4550]. Two sign changes in a cell are no sign change,
    // so the scan reports a target it walked straight past — and it reports it
    // as unreachable, naming the resolution it searched at, which is the only
    // thing that tells this apart from a target that really is out of range.
    expect(() =>
      solveScalar(equiconvexPower, target, { interval: [0.01, 0.9], scanCells: 8 }),
    ).toThrow(/is not reached over \[0\.01, 0\.9\] scanned in 8 cells/);
  });
});
