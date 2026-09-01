import { describe, it, expect } from "vitest";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { FiniteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { reversePrescription } from "../src/trace/prescription";
import { asCompiled } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import { traceRay } from "../src/trace/sequential";
import { chiefRay } from "../src/pupil/aiming";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";
import { paraxialTrace } from "../src/trace/paraxial";
import { seidelSums } from "../src/analysis/seidel";

/**
 * § 6ch — `s₀` and `p₀` are the PUPIL imaging's own two aberrations.
 *
 * § 6cg closed on one bullet: "**Why `s₀` (sine offence) and `p₀` (pupil walk)
 * are what they are.** § 6cg's own residue and the deepest item on this branch
 * — a bending-solve question, one level BELOW the mosaic." This answers it, and
 * like § 6cg it wants no new sweep: the same chief ray, plus two rearrangements
 * of the prescription the engine already knows how to read.
 *
 * ## Swap the marginal ray and the chief ray, and there is a second system
 *
 * The classical duality. Alongside the system that images the SPECIMEN there is
 * one that images the PUPIL: its object is the entrance pupil, its stop is the
 * object plane, and — the part that makes it useful here — its MARGINAL ray is
 * the original chief ray. Everything § 6cg reads off that ray is therefore an
 * ordinary aberration of the dual system, and `analysis/seidel` can compute it
 * with no new engine code: the dual prescription is the objective's with a
 * dummy flat air surface at the specimen plane carrying the stop.
 *
 * That construction reaches a number the forward sums cannot. `seidelSums`
 * refuses a stop that is not at the first surface — it has no stop-shift
 * equations, and says so — while § 6ae put the objective's diaphragm on the
 * BACK focal plane. So the objective's own S_V is out of reach in the forward
 * direction, and both routes below get at it anyway: reversed, the diaphragm
 * leads (§ 6ch.1); dualised, the specimen plane does (§ 6ch.2, § 6ch.3).
 *
 * ## The objective is not quite telecentric, and that is a whole units factor
 *
 * A stop exactly on the back focal plane puts the entrance pupil at infinity.
 * This one is 0.0968 mm off it on the 4×, which puts the pupil at 14.7 m — and
 * that tiny miss is worth 0.6% in a fourth power, which is what a first pass at
 * this section spent itself on. Two focal lengths have to be kept apart:
 *
 *   - `f = mu·P₀`, the coordinate § 6cg's `v = y/f` is written in, and
 *   - `f_d`, the dual system's paraxial focal length — the slope of its own
 *     marginal ray, which is what third-order theory is stated in.
 *
 * They differ by `f/f_d − 1`, which runs 5.7e-5 to 7.7e-4 across the family and
 * is the WHOLE of the discrepancy in both routes. Collapsing them into one `f⁴`
 * costs exactly `2(f/f_d − 1)`; carrying both makes § 6ch.2 an identity at the
 * trace floor. Like § 6cg's `2`, the pair is a units statement and not a lens.
 *
 * ## What the two coefficients are
 *
 *     p₀       =  S_I^dual · f² · f_d² / (2·P_ref)          exact, 1.3e-8
 *     s₀ − p₀  = −S_II^dual · f² / (2·H)                    4.2e-4 … 4.4e-3
 *
 * The first is the plainest defect there is — the pupil imaging's third-order
 * SPHERICAL aberration — and it holds to a few parts in 10⁹ on twenty cells.
 * The second is its COMA, by Abbe's theorem that an offence against the sine
 * condition IS a coma; § 6cg's factorisation into `S` and `P` is Conrady's OSC,
 * which is why the walk appears in it at all.
 *
 * So `A = s₀ − p₀ − 1/2` is ONE dual Seidel sum and the universal −1/2, and the
 * pupil walk CANCELS out of the map: `a` never needed `p₀`. What `s₀` and `p₀`
 * are, separately, is spherical aberration and coma of a system that was there
 * all along.
 *
 * ## The residue, said plainly
 *
 * The coma half is not exact and its leftover is not a units factor: it is flat
 * under window shrink, it is no power of `f/f_d`, and across an aperture scan it
 * falls monotonically from 4.4e-3 at NA 0.05 and CHANGES SIGN near NA 0.21
 * (§ 6ch.3). That is a design-dependent higher-order term, named here and not
 * explained — the one thing § 6ch leaves where § 6cg left `B/A`.
 */

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
/** The four §§ 6bn…6cg have been read on. The other four are the same family. */
const BRANCH: readonly Cell[] = ["s10", "f10", "s20", "f20"];

const OBJ: Record<Cell, FiniteConjugateObjective> = Object.fromEntries(
  CELLS.map((c) => [
    c,
    finiteConjugateObjective({ magnification: SPEC[c][0], numericalAperture: SPEC[c][1] }),
  ]),
) as Record<Cell, FiniteConjugateObjective>;
const LENS: Record<Cell, OpticalSystem> = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateMicroscope({ objective: OBJ[c]! }).system]),
) as Record<Cell, OpticalSystem>;

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
 * The DUAL prescription: the specimen plane carries the stop, on a dummy flat
 * in the object medium, and the objective's own diaphragm flag is cleared. A
 * flat with no index change across it contributes nothing to any sum — it is
 * there to be the stop, which is the one thing `seidelSums` needs at surface 0.
 */
function dualPrescription(obj: FiniteConjugateObjective): Prescription {
  const p = obj.prescription;
  return {
    ...p,
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: Infinity,
        thickness: obj.objectDistanceMm,
        medium: p.objectMedium ?? "AIR",
        isStop: true,
      },
      ...p.surfaces.map((s) => ({ ...s, isStop: false })),
    ],
  };
}

interface Reading {
  /** § 6cg's own `P₀`: image plane to the diaphragm, which IS the exit pupil. */
  readonly P0: number;
  /** § 6cg's coordinate focal length, `mu·P₀`. */
  readonly f: number;
  /** The DUAL system's own paraxial focal length. Not the same number as `f`,
   *  and — § 6ch.0 — not `mu·P_ref` either, though it is within 7.5e-6 of it. */
  readonly fd: number;
  readonly mu: number;
  /** The telecentric chief ray's own axis crossing at v → 0. */
  readonly Pref: number;
  readonly s0: number;
  readonly p0: number;
  /** ΣS_I and ΣS_II of the dual system, and its Lagrange invariant. */
  readonly s1d: number;
  readonly s2d: number;
  readonly H: number;
}

/**
 * One cell, read on the window § 6cg's successor wants: three radii, and small
 * ones. `parallel` swaps the chief ray aimed at the diaphragm for one leaving
 * the specimen EXACTLY parallel to the axis — the ray a telecentric objective
 * is supposed to have, and the dual system's marginal ray by definition.
 */
function read(M: number, NA: number, parallel: boolean, ts: readonly number[]): Reading {
  const obj = finiteConjugateObjective({ magnification: M, numericalAperture: NA });
  const system = finiteConjugateMicroscope({ objective: obj }).system;
  const comp = asCompiled(system.prescription);
  const p = pupils(system, 430);
  const planeZ = imagePlaneZ(comp, system);
  const P0 = planeZ - p.exit.z;
  const mu = objectHeightForImageRadius(system, 1e-4, 430, { magnification: M }) / 1e-4;
  const f = mu * P0;

  const dual = dualPrescription(obj);
  const fd = -1 / paraxialTrace(dual, 430, { y: 1, u: 0 }).u;

  const R = ts.map((t) => {
    const y = objectHeightForImageRadius(system, t, 430, { magnification: M });
    const aimed = chiefRay(system, p, y, 430);
    const tr = traceRay(system.prescription, parallel ? { ...aimed, dir: { x: 0, y: 0, z: 1 } } : aimed);
    if (tr.status !== "ok" || !tr.ray) throw new Error(`chief ray failed at t = ${t}`);
    const r = toImageSpace(comp, tr.ray);
    const slope = r.dir.x / r.dir.z;
    const tan = Math.abs(slope);
    const cos = 1 / Math.hypot(1, tan);
    return { v: y / f, S: y / (f * tan * cos), z0: r.origin.z - r.origin.x / slope };
  });
  // The constant is FITTED rather than assumed 1: the telecentric ray's own
  // axis crossing at v → 0 is the back focal plane, which is not the diaphragm,
  // and its own S is not 1 there either. § 6cg could assume both because its ray
  // goes through the diaphragm centre by construction.
  const inV0 = R.map((r) => [1, r.v ** 2, r.v ** 4]);
  const [z00, q1] = solve3(
    inV0,
    R.map((r) => r.z0),
  );
  const [S00, sv2] = solve3(
    inV0,
    R.map((r) => r.S),
  );
  const Pref = planeZ - z00!;

  const tanU = NA / Math.sqrt(1 - NA * NA);
  const sums = seidelSums(dual, 430, { marginalHeightMm: 1, fieldAngleRad: tanU });
  return {
    P0,
    f,
    fd,
    mu,
    Pref,
    s0: sv2! / S00!,
    p0: -q1! / Pref,
    s1d: sums.s1,
    s2d: sums.s2,
    H: sums.lagrangeInvariant,
  };
}

const SMALL: readonly number[] = [0.25, 0.5, 1];
const TELE: Record<Cell, Reading> = Object.fromEntries(
  CELLS.map((c) => [c, read(SPEC[c][0], SPEC[c][1], true, SMALL)]),
) as Record<Cell, Reading>;

/** The dual's third-order spherical aberration, as a `p₀`. */
const p0OfSums = (r: Reading): number => (r.s1d * r.f * r.f * r.fd * r.fd) / (2 * r.Pref);
/** The dual's third-order coma, as an `s₀ − p₀`. */
const comaOfSums = (r: Reading): number => (-r.s2d * r.f * r.f) / (2 * r.H);

describe("§ 6ch.0 — the objective is not quite telecentric, and the size of that", () => {
  it("the diaphragm misses the back focal plane, and three readings agree on by how much", () => {
    for (const c of CELLS) {
      const obj = OBJ[c]!;
      const r = TELE[c]!;
      // (i) The paraxial chief ray, collimated in, crosses the axis PAST the
      // diaphragm — the miss, straight off the dual prescription.
      const dual = dualPrescription(obj);
      const pr = paraxialTrace(dual, 430, { y: 1, u: 0 });
      const miss = -pr.y / pr.u;
      // (ii) The traced telecentric ray's own crossing at v → 0, against the
      // diaphragm the AIMED ray goes through by construction.
      expect(r.P0 - r.Pref).toBeCloseTo(miss, 6);
      // (iii) So the miss IS the gap between the two focal lengths: `f` is `mu`
      // against the diaphragm and the telecentric ray crosses `miss` further on,
      // which makes `f/f_d` and `P₀/P_ref` the same ratio to 7.5e-6 — two
      // disjoint readings, one a traced extrapolation and one a paraxial trace.
      expect(Math.abs(r.f / r.fd - r.P0 / r.Pref)).toBeLessThan(1e-5);
      expect(miss).toBeGreaterThan(0);
    }
    // The 4× misses by 0.0968 mm of 150.7, the 40× by 0.0093 of 150.0 — under a
    // part in 1500 either way, and the fourth power of it is 0.26%.
    const s4 = TELE.s4;
    expect(s4.P0 - s4.Pref).toBeCloseTo(0.096759, 5);
    const s40 = TELE.s40;
    expect(s40.P0 - s40.Pref).toBeCloseTo(0.009258, 5);
  });

  it("so the entrance pupil is 14.7 m out, not at infinity", () => {
    // A real length, and a large one: what makes the miss cheap to state and
    // expensive to ignore. It is also why the dual's object is VIRTUAL, which
    // `seidelSums` will not take — the reason § 6ch.2 uses the infinity form and
    // pays for it with the `f`/`f_d` pair rather than with a conjugate.
    const entrance = CELLS.map((c) => pupils(LENS[c]!, 430).entrance.z);
    for (const z of entrance) expect(Number.isFinite(z)).toBe(true);
    expect(Math.max(...entrance)).toBeCloseTo(14706.684, 2);
    expect(Math.min(...entrance)).toBeCloseTo(1481.963, 2);
    // Every one of them is DOWNSTREAM of the specimen, which is what "virtual"
    // means here: the dual object sits behind the dual's own first surface.
    for (const c of CELLS) expect(pupils(LENS[c]!, 430).entrance.z).toBeGreaterThan(0);
  });
});

describe("§ 6ch.1 — the map's `a` is the objective's third-order distortion", () => {
  it("reversed, the diaphragm leads, and S_V comes back", () => {
    let worst = 0;
    for (const c of CELLS) {
      const [M] = SPEC[c];
      const obj = OBJ[c]!;
      const r = TELE[c]!;
      const system = LENS[c]!;

      // § 6cg's own `a`, three-point, on the SAME window § 6cg used.
      const ts = [1, 2, 4];
      const m = ts.map(
        (t) => objectHeightForImageRadius(system, t, 430, { magnification: M }) / t / r.mu,
      );
      const [a] = solve3(
        ts.map((t) => [t ** 2, t ** 4, t ** 6]),
        m.map((x) => x - 1),
      );

      // The objective run backwards: image plane to specimen, diaphragm first.
      const rev = reversePrescription(obj.prescription, obj.objectDistanceMm);
      const revStopFirst: Prescription = {
        ...rev,
        surfaces: rev.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
      };
      const sums = seidelSums(revStopFirst, 430, {
        marginalHeightMm: obj.stopRadiusMm,
        objectDistanceMm: r.P0,
        fieldAngleRad: 1 / r.P0,
        distortion: true,
      });
      const uPrime = paraxialTrace(revStopFirst, 430, {
        y: obj.stopRadiusMm,
        u: -obj.stopRadiusMm / r.P0,
      }).u;
      // Transverse distortion at the specimen for one unit of image radius,
      // over the paraxial specimen height that radius maps to.
      const relative = sums.s5! / (2 * uPrime) / r.mu;
      // The one correction, and it is § 6ch.0's: `a` is quoted in `f` and the
      // sum is computed in `f_d`.
      const rel = a! / (relative * (r.f / r.fd) ** 2) - 1;
      worst = Math.max(worst, Math.abs(rel));
      expect(Math.abs(rel)).toBeLessThan(1e-5);
    }
    // 7.3e-6 worst, against a raw agreement of 1.5e-3 without the pair — the
    // factor is two orders of the discrepancy, not a polish on it.
    expect(worst).toBeLessThan(8e-6);
  });

  it("and without the two focal lengths it is out by exactly 2(f/f_d − 1)", () => {
    for (const c of CELLS) {
      const r = TELE[c]!;
      const raw = (r.f / r.fd) ** 2 - 1;
      // Which is 2(f/f_d − 1) to the square's own second order, so quoting the
      // miss as a doubling is honest to four figures and not more.
      expect(Math.abs(raw - 2 * (r.f / r.fd - 1))).toBeLessThan(1e-6);
    }
  });
});

describe("§ 6ch.2 — `p₀` IS the pupil imaging's third-order spherical aberration", () => {
  it("exactly, on all eight cells", () => {
    let worst = 0;
    for (const c of CELLS) {
      const r = TELE[c]!;
      const rel = Math.abs(r.p0 / p0OfSums(r) - 1);
      worst = Math.max(worst, rel);
      expect(rel).toBeLessThan(2e-8);
    }
    // 1.3e-8 worst. This is an IDENTITY read two ways, not a fit: the left side
    // is a traced ray's axis crossing and the right is a sum over surfaces, and
    // nothing was solved to make them meet.
    expect(worst).toBeLessThan(1.4e-8);
  });

  it("and it survives an aperture scan the family does not cover", () => {
    let worst = 0;
    let n = 0;
    for (const M of [10, 20]) {
      for (const NA of [0.05, 0.075, 0.1, 0.15, 0.2]) {
        const r = read(M, NA, true, SMALL);
        worst = Math.max(worst, Math.abs(r.p0 / p0OfSums(r) - 1));
        n++;
      }
    }
    // Ten more cells over a 4× in aperture, where `p₀` itself moves by 3×.
    expect(n).toBe(10);
    expect(worst).toBeLessThan(1e-8);
  });

  it("and it resolves finely enough to reject a length that LOOKS the same", () => {
    // `mu·P_ref` is the same focal length by the argument of § 6ch.0 — the same
    // magnification against the plane the telecentric ray crosses — and the two
    // agree to 7.5e-6. Substituting it degrades the identity by three orders,
    // from 1.3e-8 to 1.5e-5. A fit could not tell them apart; this is why the
    // claim is that the sums ARE the coefficient and not that they model it.
    let worst = 0;
    for (const c of CELLS) {
      const r = TELE[c]!;
      const swapped = (r.s1d * r.f * r.f * (r.mu * r.Pref) ** 2) / (2 * r.Pref);
      worst = Math.max(worst, Math.abs(r.p0 / swapped - 1));
    }
    expect(worst).toBeGreaterThan(1e-5);
    expect(worst).toBeLessThan(2e-5);
  });

  it("...which the AIMED chief ray does not, and the gap is § 6ch.0's", () => {
    for (const c of CELLS) {
      const tele = TELE[c]!;
      const aimed = read(SPEC[c][0], SPEC[c][1], false, SMALL);
      // § 6cg's `p₀` is read on the ray through the diaphragm, which is not the
      // telecentric one. The two differ, and by the miss — so the identity is
      // the telecentric ray's, and § 6cg's number is that one plus the design's
      // departure from the placement § 6ae asked for.
      const gap = aimed.p0 / tele.p0 - 1;
      expect(gap).toBeLessThan(0);
      expect(Math.abs(gap)).toBeGreaterThan(1.2e-4);
      expect(Math.abs(gap)).toBeLessThan(1.1e-2);
    }
  });
});

describe("§ 6ch.3 — and `s₀ − p₀` is its third-order COMA", () => {
  it("to a few parts in a thousand on all eight cells", () => {
    let worst = 0;
    for (const c of CELLS) {
      const r = TELE[c]!;
      const rel = Math.abs((r.s0 - r.p0) / comaOfSums(r) - 1);
      worst = Math.max(worst, rel);
      expect(rel).toBeLessThan(5e-3);
    }
    // 4.2e-4 to 4.1e-3. Abbe's theorem, and the reason the WALK appears in an
    // offence-against-the-sine-condition at all is Conrady's form of it, which
    // reads the ray's axis crossing as well as its angle — exactly § 6cg's two
    // factors.
    expect(worst).toBeLessThan(4.2e-3);
  });

  it("and the residue is the design's, not a units factor", () => {
    // No power of f/f_d fixes it: stepping f² → f·f_d → f_d² moves the residual
    // by 2(f/f_d − 1) a step, which on the 40× is 1.1e-4 against a 3.2e-3 gap.
    const r = TELE.s40;
    const step = Math.abs(
      (r.s0 - r.p0) / ((-r.s2d * r.f * r.fd) / (2 * r.H)) -
        (r.s0 - r.p0) / comaOfSums(r),
    );
    const gap = Math.abs((r.s0 - r.p0) / comaOfSums(r) - 1);
    expect(gap / step).toBeGreaterThan(25);

    // And it does not shrink with the window, which a fifth-order term in the
    // dual's own aperture would: the dual's FIELD is the direct system's NA and
    // is held fixed while `v` goes to zero.
    const wide = read(40, 0.1, true, [1, 2, 4]);
    const narrow = read(40, 0.1, true, [0.0625, 0.125, 0.25]);
    const gw = (wide.s0 - wide.p0) / comaOfSums(wide) - 1;
    const gn = (narrow.s0 - narrow.p0) / comaOfSums(narrow) - 1;
    expect(Math.abs(gn / gw - 1)).toBeLessThan(1e-2);
  });

  it("...it falls with aperture and CHANGES SIGN near NA 0.21", () => {
    const scan = [0.05, 0.075, 0.1, 0.15, 0.2, 0.25].map((NA) => {
      const r = read(20, NA, true, SMALL);
      return { NA, gap: (r.s0 - r.p0) / comaOfSums(r) - 1 };
    });
    // Monotone down over the whole scan — 4.2e-3 at NA 0.05 to −1.1e-3 at 0.25.
    for (let i = 1; i < scan.length; i++) expect(scan[i]!.gap).toBeLessThan(scan[i - 1]!.gap);
    expect(scan[0]!.gap).toBeGreaterThan(0);
    expect(scan[scan.length - 1]!.gap).toBeLessThan(0);
    // A sign change is what says this is a real term of the design and not an
    // error in the statement: no scaling mistake crosses zero inside a family.
    expect(scan[4]!.gap).toBeGreaterThan(0);
    expect(scan[5]!.gap).toBeLessThan(0);
  });
});

describe("§ 6ch.4 — so `A` is one dual sum and the universal −1/2", () => {
  it("the pupil walk cancels out of the map entirely", () => {
    for (const c of CELLS) {
      const r = TELE[c]!;
      // § 6cg's `A = s₀ − p₀ − 1/2`. The walk enters ONLY through that
      // difference, and the difference is the coma — so `a` never needed `p₀`
      // as a separate number, which is why § 6cg could pin `a` without knowing
      // what either of its two traced inputs was.
      const A = r.s0 - r.p0 - 0.5;
      const Apred = comaOfSums(r) - 0.5;
      expect(Math.abs(A / Apred - 1)).toBeLessThan(4e-3);
      // And it is the DOMINANT half: the coma carries 1.5 to 2.4 against the
      // −1/2, so reading `A` as the geometric term alone is 17% to 31% of it —
      // § 6cg.1's own share, arrived at from the design side.
      expect(Math.abs(0.5 / A)).toBeGreaterThan(0.17);
      expect(Math.abs(0.5 / A)).toBeLessThan(0.31);
    }
  });

  it("and the four branch cells' `a` comes back from the sums alone", () => {
    for (const c of BRANCH) {
      const r = TELE[c]!;
      const a = (comaOfSums(r) - 0.5) / r.P0 ** 2;
      const system = LENS[c]!;
      const M = SPEC[c][0];
      const ts = [1, 2, 4];
      const m = ts.map(
        (t) => objectHeightForImageRadius(system, t, 430, { magnification: M }) / t / r.mu,
      );
      const [traced] = solve3(
        ts.map((t) => [t ** 2, t ** 4, t ** 6]),
        m.map((x) => x - 1),
      );
      // Within § 6ch.3's residue, and nothing was fitted: two Seidel sums of a
      // rearranged prescription against a bisected ray.
      expect(Math.abs(traced! / a - 1)).toBeLessThan(4e-3);
    }
  });
});
