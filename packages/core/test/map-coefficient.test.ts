import { describe, it, expect } from "vitest";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import { asCompiled } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import { traceRay } from "../src/trace/sequential";
import { chiefRay } from "../src/pupil/aiming";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";

/**
 * § 6cg — the map's `b/a` is a change of variable and one lens ratio.
 *
 * § 6ce closed with one bullet: "**Why the map's own `b/a` is what it is.**
 * § 6ce.2 reduces every cell-to-cell difference on this branch to one number
 * read off the radial function, which is progress of the same kind § 6cd made —
 * but that number is now the unexplained thing, and it is an objective-design
 * question rather than a mosaic one." This reduces it one level further, and
 * the reduction wants no new sweep: the same chief ray § 6cd already traces,
 * read for its DIRECTION and its axis crossing rather than only for where it
 * lands.
 *
 * ## The map is three factors, and the identity is exact
 *
 * `objectHeightForImageRadius` bisects the traced chief ray, so the map is that
 * ray and nothing else. In image space the ray is straight, so it has an axis
 * crossing `z0` and an angle `theta'`, and the image radius is
 *
 *     t = P(y)·tan(theta'),      P(y) = imagePlaneZ - z0(y)
 *
 * exactly. Writing `f` for the pencil's own focal length `lim y/sin(theta')`
 * and `S(y) = y/(f·sin theta')` for its offence against the sine condition, the
 * map factors with nothing dropped:
 *
 *     m(t)/m(0) = [P0/P(y)] · S(y) · cos(theta')
 *
 * which holds to the last bit — 4.4e-16 worst over four radii and eight cells
 * (§ 6cg.0). `P0` is not an imaged distance: the objective's diaphragm is the
 * LAST surface of the prescription (§ 6ae), so the exit pupil IS the stop, at
 * unit magnification, and `P0` is the mechanical distance from the diaphragm to
 * the image plane — 150.0 to 153.9 mm across the family.
 *
 * ## In the objective's own pupil coordinate there is no free length left
 *
 * The two lens factors are functions of `v = y/f`, the normalized coordinate of
 * that pencil, and `sin(theta') = v/S`, so
 *
 *     m/m(0) = (P0/P)·S·sqrt(1 - v²/S²)
 *
 * With `S = 1 + s0·v² + s1·v⁴` and `P/P0 = 1 + p0·v² + p1·v⁴` this expands to
 * `1 + A·v² + B·v⁴`, and `v = (t/P0)·(m/m(0))` carries it back to the image
 * radius, giving
 *
 *     a = A/P0²,          A = s0 - p0 - 1/2
 *     b = (2A² + B)/P0⁴,  B = p0² - p1 + s1 + s0/2 - 1/8 - p0·s0 + p0/2
 *
 * `a` is therefore two traced numbers and one universal `-1/2`, and it checks
 * against the traced map to 5e-10 on all eight cells (§ 6cg.1). The `-1/2` is
 * the `cos(theta')` alone: at `s0 = p0 = 0` it gives `a = -1/(2P0²)` exactly.
 * That geometric part is only 17% to 30% of `a`, which is why reading the map
 * as a pure cosine law fails by 9% to 45% — the offence `s0` carries 42% to 79%
 * and the pupil's own walk `p0` the rest.
 *
 * ## So `b/a` is `2a` plus one ratio, and the 2 is the change of variable's
 *
 *     b/a = 2a + (B/A)/P0²
 *
 * The leading term is `a` doubled. `A` is of course the lens, and so is `a`;
 * what the change of variable fixes is the COEFFICIENT on `A²` — carrying `v`
 * back to `t` through `v² = (t/P0)²(1 + 2A·v²)` contributes exactly `2A²` to the
 * `t⁴` term and never `1.5A²` or `3A²`, whatever the prescription. Everything
 * else the lens contributes past `a` itself is the single ratio `B/A`
 * (§ 6cg.2). In the form § 6ce quotes,
 *
 *     b/(3a²) = 2/3 + B/(3A²)
 *
 * whose perfect-lens value is EXACTLY 1/2: at `s0 = s1 = p0 = p1 = 0` the two
 * coefficients are `A = -1/2` and `B = -1/8`, and `2/3 - 1/6 = 1/2`. The family
 * reads 0.5244 to 1.1954 and so straddles it (§ 6cg.3) — `B` changing SIGN
 * across the cells, which no single law in `a` could produce.
 *
 * ## Which closes back onto the branch
 *
 * § 6ce's use of the number is `eps = (b/a)·cx²`, so
 *
 *     eps = 2a·cx² + (B/A)·(cx/P0)²
 *
 * and `c2 = -5/8 - 3·eps` lands on § 6cd.2's four measured coefficients inside
 * 4e-4 — the same bound § 6ce's own fit meets (§ 6cg.4). The second term is
 * 6.8% to 17.8% of the first, and its sign is not the aperture's: `B/A` rises
 * monotonically with the magnification at each aperture and crosses zero INSIDE
 * the family — the slow cells between 4x and 10x, the fast ones between 10x and
 * 20x — so the fast 10x is the one branch cell whose correction opposes the
 * other three, and what the aperture sets is where that crossing falls.
 *
 * ## One window, said out loud
 *
 * `a` and `b` here are Taylor coefficients read on a THREE-point window at
 * t = 1, 2, 4, because `s0, s1, p0, p1` are four numbers and a two-point fit
 * yields two. § 6ce's incumbent `mapCoefficients(c, 2, 4)` is a two-point read
 * of the same quantities, and the two differ by 3e-6 on `a` and by 0.24% to
 * 0.44% on `b/a` (§ 6cg.5). Neither is wrong; a `b/a` quoted to three digits
 * from one section against the other is, so the size of it is pinned here.
 */

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

type Cell = "s4" | "f4" | "s10" | "f10" | "s20" | "f20" | "s40" | "f40";
const SPEC: Record<Cell, readonly [number, number]> = {
  s4: [4, 0.1],
  f4: [4, 0.2],
  s10: [10, 0.1],
  f10: [10, 0.2],
  s20: [20, 0.1],
  f20: [20, 0.2],
  s40: [40, 0.1],
  f40: [40, 0.2],
};
const CELLS: readonly Cell[] = ["s4", "f4", "s10", "f10", "s20", "f20", "s40", "f40"];
/** The four § 6bn…§ 6cf have been read on. The other four are the same family. */
const BRANCH: readonly Cell[] = ["s10", "f10", "s20", "f20"];
const LENS: Record<Cell, OpticalSystem> = Object.fromEntries(
  CELLS.map((c) => [c, build(SPEC[c][0], SPEC[c][1])]),
) as Record<Cell, OpticalSystem>;

/** The three factors of `m(t)/m(0)`, from ONE traced chief ray. */
function reading(
  c: Cell,
  t: number,
): {
  P0: number;
  mu: number;
  f: number;
  v: number;
  S: number;
  Pr: number;
  cos: number;
  m: number;
} {
  const system = LENS[c];
  const M = SPEC[c][0];
  const comp = asCompiled(system.prescription);
  const p = pupils(system, 430);
  const planeZ = imagePlaneZ(comp, system);
  const P0 = planeZ - p.exit.z;
  const mu = objectHeightForImageRadius(system, 1e-4, 430, { magnification: M }) / 1e-4;
  const f = mu * P0;
  const y = objectHeightForImageRadius(system, t, 430, { magnification: M });
  const traced = traceRay(system.prescription, chiefRay(system, p, y, 430));
  if (traced.status !== "ok" || !traced.ray) throw new Error(`${c}: chief ray failed at t = ${t}`);
  const r = toImageSpace(comp, traced.ray);
  const slope = r.dir.x / r.dir.z;
  const tan = Math.abs(slope);
  const cos = 1 / Math.hypot(1, tan);
  return {
    P0,
    mu,
    f,
    v: y / f,
    S: y / (f * tan * cos),
    Pr: (planeZ - (r.origin.z - r.origin.x / slope)) / P0,
    cos,
    m: y / t / mu,
  };
}

/** Solve a 3x3 system by Gaussian elimination with partial pivoting. */
function solve3(rows: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const A = rows.map((r, i) => [...r, rhs[i]!]);
  for (let k = 0; k < 3; k++) {
    let piv = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(A[i]![k]!) > Math.abs(A[piv]![k]!)) piv = i;
    [A[k], A[piv]] = [A[piv]!, A[k]!];
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      const fr = A[i]![k]! / A[k]![k]!;
      for (let j = k; j < 4; j++) A[i]![j]! -= fr * A[k]![j]!;
    }
  }
  return [A[0]![3]! / A[0]![0]!, A[1]![3]! / A[1]![1]!, A[2]![3]! / A[2]![2]!];
}

/**
 * The window. Three radii, because `S` and `P` want two coefficients each and a
 * two-point fit gives one apiece — see the header, and § 6cg.5 for what it costs
 * against § 6ce's `mapCoefficients(c, 2, 4)`.
 */
const TS: readonly number[] = [1, 2, 4];

interface Coefficients {
  P0: number;
  f: number;
  s0: number;
  s1: number;
  p0: number;
  p1: number;
  A: number;
  B: number;
  aModel: number;
  bModel: number;
  aTraced: number;
  bTraced: number;
}

function coefficients(c: Cell): Coefficients {
  const R = TS.map((t) => reading(c, t));
  const P0 = R[0]!.P0;
  // `S` and `P` are functions of the pupil coordinate; the composite map is
  // read in the image radius, which is what § 6ce's `a` and `b` are quoted in.
  const inV = R.map((r) => [r.v ** 2, r.v ** 4, r.v ** 6]);
  const inT = TS.map((t) => [t ** 2, t ** 4, t ** 6]);
  const [s0, s1] = solve3(
    inV,
    R.map((r) => r.S - 1),
  );
  const [p0, p1] = solve3(
    inV,
    R.map((r) => r.Pr - 1),
  );
  const [aTraced, bTraced] = solve3(
    inT,
    R.map((r) => r.m - 1),
  );
  const A = s0! - p0! - 0.5;
  const B = p0! * p0! - p1! + s1! + s0! / 2 - 0.125 - p0! * s0! + p0! / 2;
  return {
    P0,
    f: R[0]!.f,
    s0: s0!,
    s1: s1!,
    p0: p0!,
    p1: p1!,
    A,
    B,
    aModel: A / P0 ** 2,
    bModel: (2 * A * A + B) / P0 ** 4,
    aTraced: aTraced!,
    bTraced: bTraced!,
  };
}

const COEF: Record<Cell, Coefficients> = Object.fromEntries(
  CELLS.map((c) => [c, coefficients(c)]),
) as Record<Cell, Coefficients>;

/** § 6ce's own two-point read, unchanged, for § 6cg.5's comparison. */
function twoPoint(c: Cell, t1: number, t2: number): { a: number; b: number } {
  const y1 = reading(c, t1).m - 1;
  const y2 = reading(c, t2).m - 1;
  const det = t1 ** 2 * t2 ** 4 - t2 ** 2 * t1 ** 4;
  return { a: (y1 * t2 ** 4 - y2 * t1 ** 4) / det, b: (t1 ** 2 * y2 - t2 ** 2 * y1) / det };
}

describe("§ 6cg.0 — the map is three factors of one chief ray, exactly", () => {
  it("factors to the last bit at four radii on all eight cells", () => {
    let worst = 0;
    for (const c of CELLS) {
      for (const t of [0.5, 1, 2, 4]) {
        const r = reading(c, t);
        // The identity, with nothing dropped: the product of the three factors
        // IS the map. Not a fit and not an expansion — the same traced ray read
        // three ways, so a failure here is a broken definition and not a
        // tolerance.
        const rel = Math.abs((r.Pr === 0 ? 0 : (1 / r.Pr) * r.S * r.cos) / r.m - 1);
        worst = Math.max(worst, rel);
        expect(rel).toBeLessThan(1e-15);
      }
    }
    // Measured 6.7e-16 — three ulp of the product of three doubles, and it is
    // the SMALLEST radius that reads it: at t = 0.5 the two lens factors are
    // 1 + 1e-5 and the cancellation against 1 is what the last bits cost.
    expect(worst).toBeLessThan(7e-16);
  });

  it("and `P0` is the diaphragm's own distance, not an imaged one", () => {
    for (const c of CELLS) {
      const system = LENS[c];
      const comp = asCompiled(system.prescription);
      const p = pupils(system, 430);
      // § 6ae put the stop on the group's back focal plane and made it the last
      // surface of the prescription, so nothing images it: the exit pupil is the
      // stop, at unit magnification, and `P0` is a mechanical distance.
      expect(p.exit.z).toBe(p.stopZ);
      expect(p.exit.magnification).toBeCloseTo(1, 12);
      expect(COEF[c].P0).toBeCloseTo(imagePlaneZ(comp, system) - p.stopZ, 12);
    }
    // 150.0 to 153.9 mm over a 10x in magnification and a 2x in aperture.
    const all = CELLS.map((c) => COEF[c].P0);
    expect(Math.min(...all)).toBeCloseTo(149.995773, 5);
    expect(Math.max(...all)).toBeCloseTo(153.895605, 5);
  });
});

describe("§ 6cg.1 — so `a` is two traced numbers and one universal -1/2", () => {
  it("`a = (s0 - p0 - 1/2)/P0²` on all eight cells", () => {
    for (const c of CELLS) {
      const k = COEF[c];
      expect(k.A).toBeCloseTo(k.s0 - k.p0 - 0.5, 12);
      // Measured 1.0e-10 to 5.0e-10 relative; the bound is set an order above
      // what it reads, not at a guess.
      expect(Math.abs(k.aModel / k.aTraced - 1)).toBeLessThan(1e-8);
    }
  });

  it("the -1/2 is the cosine alone, and it is the SMALLEST of the three shares", () => {
    // At a lens with no sine offence and no pupil walk the map is `cos(theta')`
    // and nothing else, which is § 6ce's own reading of the map as a pure
    // scaling — `a = -1/(2P0²)`, exactly.
    for (const c of CELLS) {
      const P0 = COEF[c].P0;
      expect(-0.5 / P0 ** 2).toBeCloseTo(-1 / (2 * P0 * P0), 18);
    }
    // Shares of `A`: the offence, the pupil walk and the geometry.
    const share = (c: Cell): [number, number, number] => {
      const k = COEF[c];
      return [k.s0 / k.A, -k.p0 / k.A, -0.5 / k.A];
    };
    for (const c of CELLS) {
      const [sine, pupil, cos] = share(c);
      expect(sine + pupil + cos).toBeCloseTo(1, 12);
      expect(sine).toBeGreaterThan(0.42);
      expect(sine).toBeLessThan(0.80);
      expect(cos).toBeGreaterThan(0.17);
      expect(cos).toBeLessThan(0.31);
    }
    // Which is why a pure cosine reading of the map cannot work: it would need
    // `b/(3a²) = 1/2`, and the cosine is a fifth of `a`.
    expect(share("s10")[0]).toBeCloseTo(0.6869, 3);
    expect(share("s10")[1]).toBeCloseTo(0.1291, 3);
    expect(share("s10")[2]).toBeCloseTo(0.184, 3);
  });

  it("and the two lens numbers move with the two design parameters", () => {
    // Reported as measured and monotone, with end values. The pupil walk is the
    // magnification's — it falls 6.8x over a 10x in M — and the offence deepens
    // over the same run. No law is claimed for either: that is § 6cg's own open
    // item.
    const slow: readonly Cell[] = ["s4", "s10", "s20", "s40"];
    for (let i = 1; i < slow.length; i++) {
      expect(COEF[slow[i]!].p0).toBeLessThan(COEF[slow[i - 1]!].p0);
      expect(COEF[slow[i]!].s0).toBeLessThan(COEF[slow[i - 1]!].s0);
    }
    expect(COEF.s4.p0).toBeCloseTo(0.68246417, 6);
    expect(COEF.s40.p0).toBeCloseTo(0.10072361, 6);
    expect(COEF.s4.p0 / COEF.s40.p0).toBeCloseTo(6.776, 2);
    expect(COEF.s4.s0).toBeCloseTo(-1.26299305, 6);
    expect(COEF.s40.s0).toBeCloseTo(-2.27944421, 6);
    // The aperture moves both, at every magnification, and in one direction.
    for (const [s, f] of [
      ["s4", "f4"],
      ["s10", "f10"],
      ["s20", "f20"],
      ["s40", "f40"],
    ] as const) {
      expect(COEF[f].s0).toBeGreaterThan(COEF[s].s0);
      expect(COEF[f].p0).toBeLessThan(COEF[s].p0);
    }
  });
});

describe("§ 6cg.2 — and `b/a` is `2a` plus one lens ratio", () => {
  it("`b = (2A² + B)/P0⁴`, so `b/a = 2a + (B/A)/P0²`", () => {
    for (const c of CELLS) {
      const k = COEF[c];
      // Measured 8.1e-7 to 3.1e-6 relative.
      expect(Math.abs(k.bModel / k.bTraced - 1)).toBeLessThan(1e-5);
      // The rearrangement, which is where the "2" is visible on its own.
      expect(k.bModel / k.aModel).toBeCloseTo(2 * k.aModel + k.B / k.A / k.P0 ** 2, 14);
    }
  });

  it("and the COEFFICIENT 2 on A² is the change of variable's, whatever the lens", () => {
    // `v = (t/P0)(1 + A v² + …)` squares to `(t/P0)²(1 + 2A v²)`, so the `t⁴`
    // coefficient inherits exactly `2A²` before `B` is reached at all. `A` is
    // the lens and the inherited term moves with it — what does not move is the
    // 2. Read it back at a lens with no offence and no walk: `A = -1/2`,
    // `B = -1/8`, and the whole of `b` is the cosine's own `3/(8P0⁴)`, in which
    // the 3 is `2A² + B` at that particular `A` and not a universal number.
    const A = -0.5;
    const B = -0.125;
    for (const c of CELLS) {
      const P0 = COEF[c].P0;
      expect((2 * A * A + B) / P0 ** 4).toBeCloseTo(3 / (8 * P0 ** 4), 20);
    }
    // And `2a` alone would put `b/a` at `2a`, which is 8% to 27% away from what
    // each cell reads — the ratio `B/A` is not a correction that can be dropped.
    for (const c of BRANCH) {
      const k = COEF[c];
      const gap = Math.abs((2 * k.aTraced) / (k.bTraced / k.aTraced) - 1);
      expect(gap).toBeGreaterThan(0.07);
      expect(gap).toBeLessThan(0.28);
    }
  });
});

describe("§ 6cg.3 — whose perfect-lens value is exactly 1/2, and the family straddles it", () => {
  it("`b/(3a²) = 2/3 + B/(3A²)` at every cell", () => {
    for (const c of CELLS) {
      const k = COEF[c];
      const read = k.bTraced / (3 * k.aTraced * k.aTraced);
      expect(read).toBeCloseTo(2 / 3 + k.B / (3 * k.A * k.A), 5);
    }
  });

  it("1/2 exactly at `s = p = 0`, and the eight cells run 0.5244 to 1.1954", () => {
    // Not a limit and not a fit: substitute and the P0 cancels.
    const A = -0.5;
    const B = -0.125;
    expect(2 / 3 + B / (3 * A * A)).toBe(0.5);
    const read = CELLS.map((c) => COEF[c].bTraced / (3 * COEF[c].aTraced ** 2));
    expect(Math.min(...read)).toBeCloseTo(0.524400, 5);
    expect(Math.max(...read)).toBeCloseTo(1.195412, 5);
    // Straddling 1/2 means `B` changes sign, which it does across the aperture
    // at the low magnifications and across the magnification at the slow ones.
    expect(COEF.f4.B).toBeGreaterThan(0);
    expect(COEF.s40.B).toBeLessThan(0);
    expect(COEF.f10.B).toBeGreaterThan(0);
    expect(COEF.s10.B).toBeLessThan(0);
    // The four branch cells are the narrow part of that run.
    const branch = BRANCH.map((c) => COEF[c].bTraced / (3 * COEF[c].aTraced ** 2));
    expect(Math.min(...branch)).toBeCloseTo(0.548021, 5);
    expect(Math.max(...branch)).toBeCloseTo(0.724951, 5);
  });
});

describe("§ 6cg.4 — which closes back onto § 6cd.2's four coefficients", () => {
  it("`eps = 2a·cx² + (B/A)(cx/P0)²` gives `c2` inside 4e-4", () => {
    // § 6ce's own bound, met by a form with no fitted `b` in it at all.
    const MEASURED: Record<string, number> = {
      s10: -0.61490693,
      f10: -0.61611925,
      s20: -0.61538359,
      f20: -0.61686210,
    };
    const cx = 4;
    for (const c of BRANCH) {
      const k = COEF[c];
      const eps = 2 * k.aModel * cx * cx + (k.B / k.A) * (cx / k.P0) ** 2;
      expect(eps).toBeCloseTo((k.bModel / k.aModel) * cx * cx, 12);
      expect(-0.625 - 3 * eps).toBeCloseTo(MEASURED[c]!, 3);
      expect(Math.abs(-0.625 - 3 * eps - MEASURED[c]!)).toBeLessThan(4e-4);
    }
  });

  it("and the change of variable carries most of it, the lens ratio the ordering", () => {
    const cx = 4;
    for (const c of BRANCH) {
      const k = COEF[c];
      const first = 2 * k.aModel * cx * cx;
      const second = (k.B / k.A) * (cx / k.P0) ** 2;
      // Measured as a magnitude against the first term and not as a share of
      // the sum: the second term OPPOSES the first at the slow cells and adds
      // to it at the fast ones, so a share of the sum crosses 1 and says
      // nothing. Against the first term it runs 6.8% to 17.8%.
      const rel = Math.abs(second / first);
      expect(rel).toBeGreaterThan(0.06);
      expect(rel).toBeLessThan(0.19);
      expect(second > 0).toBe(k.B / k.A > 0);
    }
    // Measured: 10.3%, 8.7%, 17.8%, 6.8% in branch order.
    const rel = (c: Cell): number =>
      Math.abs((COEF[c].B / COEF[c].A) * (cx / COEF[c].P0) ** 2 / (2 * COEF[c].aModel * cx * cx));
    expect(rel("s20")).toBeCloseTo(0.1780, 3);
    expect(rel("f20")).toBeCloseTo(0.0677, 3);
    expect(rel("s10")).toBeCloseTo(0.1030, 3);
    expect(rel("f10")).toBeCloseTo(0.0874, 3);
    // And the ratio itself is ORDERED, not sign-paired by aperture. `B/A` rises
    // monotonically with the magnification at each aperture and crosses zero
    // INSIDE the family — the slow cells crossing between 4x and 10x, the fast
    // ones between 10x and 20x. So the fast 10x is the one cell of the four
    // whose second term opposes the others, and the aperture sets where the
    // crossing falls rather than the sign.
    const BA = (c: Cell): number => COEF[c].B / COEF[c].A;
    for (const run of [
      ["s4", "s10", "s20", "s40"],
      ["f4", "f10", "f20", "f40"],
    ] as const) {
      for (let i = 1; i < run.length; i++) expect(BA(run[i]!)).toBeGreaterThan(BA(run[i - 1]!));
    }
    for (const M of ["4", "10", "20", "40"] as const) {
      expect(BA(`s${M}` as Cell)).toBeGreaterThan(BA(`f${M}` as Cell));
    }
    expect(BA("s4")).toBeLessThan(0);
    expect(BA("s10")).toBeGreaterThan(0);
    expect(BA("f10")).toBeLessThan(0);
    expect(BA("f20")).toBeGreaterThan(0);
  });
});

describe("§ 6cg.5 — and the window it is read on, against § 6ce's", () => {
  it("three points against § 6ce's two: 3e-6 on `a`, 0.24% to 0.44% on `b/a`", () => {
    // The reason to say it out loud: § 6ce quotes `b/a` to eight digits from
    // `mapCoefficients(c, 2, 4)` and this step quotes the same quantity from a
    // 1/2/4 window. They are the same number read through different windows,
    // and a reader comparing them without this rung would find a discrepancy
    // four paragraphs apart and no account of it.
    const seen: number[] = [];
    for (const c of BRANCH) {
      const k = COEF[c];
      const two = twoPoint(c, 2, 4);
      expect(Math.abs(two.a / k.aTraced - 1)).toBeLessThan(4e-6);
      const d = Math.abs(two.b / two.a / (k.bTraced / k.aTraced) - 1);
      seen.push(d);
      expect(d).toBeGreaterThan(2.3e-3);
      expect(d).toBeLessThan(4.5e-3);
    }
    // The slow cells are the wider pair, both near 0.43%.
    expect(Math.max(...seen)).toBeCloseTo(4.404e-3, 5);
    expect(Math.min(...seen)).toBeCloseTo(2.409e-3, 5);
  });
});
