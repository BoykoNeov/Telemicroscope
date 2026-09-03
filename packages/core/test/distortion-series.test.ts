import { describe, it, expect } from "vitest";
import { distortionSeries } from "../src/analysis/distortion";
import { seidelSums } from "../src/analysis/seidel";
import { Prescription, reversePrescription } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { paraxialTrace } from "../src/trace/paraxial";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex } from "../src/materials/dispersion";
import { asCompiled } from "../src/trace/compile";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { FiniteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6cn — the distortion map's quartic, computed instead of fitted.
 *
 * § 6ck left one thing open by name: "**`b` is not a Seidel sum.** The quartic
 * that makes § 6cj's reading 3e-4 low is fifth-order distortion, which
 * `seidelSums` does not compute and this ladder has no rung for. It is measured
 * here and named nowhere." `analysis/distortion` names it, and the route avoids
 * the thing the hard rule is most afraid of: nothing is transcribed. Distortion
 * is a chief-ray property, the chief ray is the vertex ray when the stop is
 * surface 0, and an exact ray trace run on truncated power series instead of on
 * numbers hands the coefficients over at machine precision.
 *
 * The rungs below are in the order that fixes the module: two closed forms that
 * between them pin the scale AND discriminate the quartic from the cube, a zero
 * that no arithmetic error survives, third-order agreement with the OTHER
 * machinery that already knows the answer, and then the objective § 6ck was
 * about — where the finding is that § 6ck's `b` and this one are different
 * numbers, for a reason that is measurable rather than a discrepancy.
 */

const N15 = "DISTORTION-N15";
const N17 = "DISTORTION-N17";
registerMedium(constantIndex(N15, 1.5));
registerMedium(constantIndex(N17, 1.7));
const WL = 550;

/**
 * A powerless flat at the stop, AIR on both sides: the diaphragm a reversed
 * objective leads with, and the way to put the stop at surface 0 without giving
 * surface 0 any optics of its own.
 */
const dummyStop = (thickness: number): Prescription["surfaces"][number] => ({
  kind: "refract",
  curvature: 0,
  semiAperture: 400,
  thickness,
  medium: "AIR",
  isStop: true,
});

/** Forward coefficients of `r(ε) = m·ε(1 + A·ε² + B·ε⁴)`. */
const forward = (r: ReturnType<typeof distortionSeries>) => ({
  m: r.magnification,
  A: r.imageHeightSeries[3]! / r.magnification,
  B: r.imageHeightSeries[5]! / r.magnification,
});

describe("§ 6cn.0 — a single spherical refractor stopped at its own vertex", () => {
  /**
   * The chief ray goes through the vertex, where the normal IS the axis, so it
   * refracts as though at a plane and then runs straight to the image. With
   * ν = n/n′ and t = tan θ that is exact at every order:
   *
   *     r/r_par = [1 + (1 − ν²)t²]^(−1/2)
   *
   * — and it has no curvature in it. The radius sets where the image is and how
   * big it is; it does not touch the distortion.
   */
  const cases = [
    { n: 1.5, medium: N15, R: 25, s: 100 },
    { n: 1.5, medium: N15, R: -40, s: 100 },
    { n: 1.5, medium: N15, R: 1e9, s: 100 },
    { n: 1.7, medium: N17, R: 15, s: 60 },
    { n: 1.7, medium: N17, R: -30, s: 250 },
  ] as const;

  const refractor = (medium: string, R: number): Prescription => ({
    surfaces: [{ kind: "refract", curvature: 1 / R, semiAperture: 400, thickness: 0, medium, isStop: true }],
  });

  it("reproduces the closed form's cube AND its quartic, at every curvature", () => {
    for (const { n, medium, R, s } of cases) {
      const nu = 1 / n;
      const { A, B } = forward(distortionSeries(refractor(medium, R), WL, { objectDistanceMm: s }));
      expect(A / (-(1 - nu * nu) / 2 / s ** 2) - 1).toBeCloseTo(0, 13);
      expect(B / (((3 / 8) * (1 - nu * nu) ** 2) / s ** 4) - 1).toBeCloseTo(0, 13);
    }
  });

  it("and the distortion really is curvature-free, which the image is not", () => {
    const at = (R: number) => distortionSeries(refractor(N15, R), WL, { objectDistanceMm: 100 });
    const [a, b] = [at(25), at(-40)];
    // Same distortion to the last bits; wildly different image.
    expect(forward(a).A).toBeCloseTo(forward(b).A, 20);
    expect(Math.abs(a.magnification / b.magnification - 1)).toBeGreaterThan(1);
  });

  it("and it agrees with the exact tracer, which shares no line with it", () => {
    const rx = refractor(N15, 25);
    const s = 100;
    const r = distortionSeries(rx, WL, { objectDistanceMm: s });
    for (const eta of [1, 5, 10]) {
      const t = traceRay(rx, makeRay(vec3(eta, 0, -s), vec3(-eta, 0, s), WL));
      expect(t.status).toBe("ok");
      const { dir, origin } = t.ray!;
      const traced = origin.x + (dir.x / dir.z) * (r.imageDistanceMm - origin.z);
      const series = r.imageHeightSeries.reduce((acc, c, i) => acc + c * eta ** i, 0);
      // The residual is the r⁶ term the series does not carry, and at η = 10 on
      // a 100 mm conjugate that is 8e-7 of the height — so this is a bound that
      // grows, not a tolerance chosen to fit.
      expect(Math.abs(traced / series - 1)).toBeLessThan(1e-6);
    }
  });
});

describe("§ 6cn.1 — a plane-parallel plate, which separates the quartic from the cube", () => {
  /**
   * The discriminating anchor. § 6cn.0's single surface has B = (3/2)A² and
   * § 6cn.2's concentric system has both identically zero, so between them an
   * error that computed the quartic AS (3/2)A² would go unseen. The plate
   * refuses it: the chief ray refracts at the flat vertex, crosses `d` of glass
   * and exits parallel, and the two pieces do not share a denominator, so with
   * K = −dν/s
   *
   *     r/r_par = 1 − K(1 − ν²)t²/2 + K(3/8)(1 − ν²)²t⁴      B/A² = 3/(2K)
   *
   * — a ratio the caller sets by choosing the thickness and the conjugate.
   */
  const cases = [
    { n: 1.5, medium: N15, d: 20, s: 100 },
    { n: 1.7, medium: N17, d: 5, s: 250 },
    { n: 1.5, medium: N15, d: 2, s: 40 },
  ] as const;

  const plate = (medium: string, d: number): Prescription => ({
    surfaces: [
      { kind: "refract", curvature: 0, semiAperture: 400, thickness: d, medium, isStop: true },
      { kind: "refract", curvature: 0, semiAperture: 400, thickness: 0, medium: "AIR" },
    ],
  });

  it("matches the closed form, and its B/A² is not the single surface's 3/2", () => {
    for (const { n, medium, d, s } of cases) {
      const nu = 1 / n;
      const K = -(d * nu) / s;
      const { A, B, m } = forward(distortionSeries(plate(medium, d), WL, { objectDistanceMm: s }));
      expect(m).toBeCloseTo(1, 12); // a plate does not magnify
      expect(A / ((-K * (1 - nu * nu)) / 2 / s ** 2) - 1).toBeCloseTo(0, 12);
      expect(B / ((K * (3 / 8) * (1 - nu * nu) ** 2) / s ** 4) - 1).toBeCloseTo(0, 11);
      expect(B / (A * A) / (3 / (2 * K)) - 1).toBeCloseTo(0, 11);
      // K is small and negative, so the ratio is large and of the wrong sign —
      // nowhere near the 3/2 the single surface has.
      expect(B / (A * A)).toBeLessThan(-5);
    }
  });
});

describe("§ 6cn.2 — a concentric system is a zero at every order", () => {
  /**
   * Every surface centred on the stop's vertex: the chief ray meets each one
   * along its own normal and is never deviated, so the map is exactly linear.
   * The MARGINAL ray still refracts, so there is a real image to measure
   * against — what vanishes is the distortion and not the system.
   */
  const concentric: Prescription = {
    surfaces: [
      dummyStop(10),
      { kind: "refract", curvature: -1 / 10, semiAperture: 400, thickness: 15, medium: N15 },
      { kind: "refract", curvature: -1 / 25, semiAperture: 400, thickness: 20, medium: N17 },
      { kind: "refract", curvature: -1 / 45, semiAperture: 400, thickness: 0, medium: "AIR" },
    ],
  };

  it("has no cube and no quartic, at either conjugate", () => {
    for (const opts of [{ objectDistanceMm: 200 }, { objectDistanceMm: 1000 }, {}]) {
      const r = distortionSeries(concentric, WL, opts);
      const { A, B } = forward(r);
      // Twelve orders below the 1e-4 a real objective carries, which is the f64
      // floor of the trace and not a tolerance.
      expect(Math.abs(A)).toBeLessThan(1e-16);
      expect(Math.abs(B)).toBeLessThan(1e-18);
      expect(Math.abs(r.magnification)).toBeGreaterThan(1e-3);
    }
  });

  it("and the even coefficients vanish, which nothing in the arithmetic knows", () => {
    const r = distortionSeries(concentric, WL, { objectDistanceMm: 200 });
    for (const k of [0, 2, 4]) {
      expect(Math.abs(r.imageHeightSeries[k]!) / Math.abs(r.magnification)).toBeLessThan(1e-14);
    }
  });
});

describe("§ 6cn.3 — the cube is ΣS_V, computed by a machinery that shares no line", () => {
  /**
   * `seidelSums` builds third-order distortion out of paraxial invariants and
   * Welford's per-surface sums; this builds it out of an exact trace carried in
   * series. They have the prescription in common and nothing else, so their
   * agreement is evidence rather than bookkeeping.
   */
  const doublet: Prescription = {
    surfaces: [
      dummyStop(4),
      { kind: "refract", curvature: 1 / 60, semiAperture: 20, thickness: 6, medium: N15 },
      { kind: "refract", curvature: -1 / 45, semiAperture: 20, thickness: 3, medium: N17 },
      { kind: "refract", curvature: -1 / 90, semiAperture: 20, thickness: 0, medium: "AIR" },
    ],
  };

  it("ΣS_V/(2n′u′) is the series' own ε³ coefficient", () => {
    for (const s of [150, 400]) {
      const r = distortionSeries(doublet, WL, { objectDistanceMm: s });
      const y = 2;
      const sums = seidelSums(doublet, WL, {
        marginalHeightMm: y,
        objectDistanceMm: s,
        fieldAngleRad: -1 / s,
        distortion: true,
      });
      const uPrime = paraxialTrace(doublet, WL, { y, u: y / s }).u;
      // The last medium is air, so n′ = 1 and the classical S_V/(2n′u′) is the
      // transverse distortion at unit object height — the series' ε³ term.
      expect(sums.s5! / (2 * uPrime) / r.imageHeightSeries[3]! - 1).toBeCloseTo(0, 12);
    }
  });

  it("and the whole series reproduces the exact trace, losing an order as r⁶", () => {
    const s = 150;
    const r = distortionSeries(doublet, WL, { objectDistanceMm: s });
    const zImage = 4 + 6 + 3 + r.imageDistanceMm;
    const residual = (eta: number): number => {
      const t = traceRay(doublet, makeRay(vec3(eta, 0, -s), vec3(-eta, 0, s), WL));
      expect(t.status).toBe("ok");
      const { dir, origin } = t.ray!;
      const traced = origin.x + (dir.x / dir.z) * (zImage - origin.z);
      const series = r.imageHeightSeries.reduce((acc, c, i) => acc + c * eta ** i, 0);
      return Math.abs(traced / series - 1);
    };
    const [r1, r2, r4] = [residual(1), residual(2), residual(4)];
    expect(r1).toBeLessThan(1e-13);
    // 2⁶ = 64 per doubling: what is left over IS the next term of the series,
    // which is the sharpest statement available that nothing else is left over.
    expect(r2 / r1).toBeGreaterThan(40);
    expect(r2 / r1).toBeLessThan(90);
    expect(r4 / r2).toBeGreaterThan(40);
    expect(r4 / r2).toBeLessThan(90);
  });
});

describe("§ 6cn.4 — the refusals", () => {
  const one = (extra: Partial<Prescription["surfaces"][number]>): Prescription => ({
    surfaces: [{ kind: "refract", curvature: 1 / 25, semiAperture: 400, thickness: 0, medium: N15, isStop: true, ...extra }],
  });
  it("refuses a stop that is not surface 0, a conic, and a mirror", () => {
    expect(() => distortionSeries({ surfaces: [{ ...one({}).surfaces[0]!, isStop: false }] }, WL, { objectDistanceMm: 100 })).toThrow(
      /stop must be surface 0/,
    );
    expect(() => distortionSeries(one({ conic: -1 }), WL, { objectDistanceMm: 100 })).toThrow(/spherical/);
    expect(() =>
      distortionSeries({ surfaces: [{ kind: "reflect", curvature: -1 / 100, semiAperture: 50, thickness: -50, isStop: true }] }, WL, {
        objectDistanceMm: 100,
      }),
    ).toThrow(/refracting surfaces only/);
    expect(() => distortionSeries(one({}), WL, { objectDistanceMm: -1 })).toThrow(/positive finite distance/);
  });
});

/* ------------------------------------------------------------------------- */
/* § 6cn.5 — the objective § 6ck was about                                    */
/* ------------------------------------------------------------------------- */

type Cell = "s10" | "f10" | "s20" | "f20";
const SPEC: Record<Cell, readonly [number, number]> = {
  s10: [10, 0.1],
  f10: [10, 0.2],
  s20: [20, 0.1],
  f20: [20, 0.2],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];
/** § 6ck's own wavelength: the ruler the mosaic maps in is at 430 nm. */
const RULER_NM = 430;
const OBJ = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateObjective({ magnification: SPEC[c][0], numericalAperture: SPEC[c][1] })]),
) as Record<Cell, FiniteConjugateObjective>;
const LENS = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateMicroscope({ objective: OBJ[c]! }).system]),
) as Record<Cell, OpticalSystem>;
/**
 * The same systems with the chief ray SOLVED onto the stop instead of aimed at
 * the paraxial entrance pupil (`pupil/aiming` targets `pupil.entrance.z` unless
 * ray aiming is real). That difference is the whole of § 6cn.5's finding.
 */
const REAL = Object.fromEntries(
  CELLS.map((c) => [c, { ...LENS[c]!, rayAiming: "real" as const }]),
) as Record<Cell, OpticalSystem>;

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
 * § 6ck's own fit of the traced map, `h/r = mu(1 + a r² + b r⁴ + c r⁶)`. The
 * magnification seed is § 6ck.2's business and not this step's: it pinned four
 * seeds to a bitwise identical fit, so the nominal one is used here.
 */
function mapSeries(c: Cell, sys: Record<Cell, OpticalSystem>): readonly number[] {
  const at = (r: number) => objectHeightForImageRadius(sys[c]!, r, RULER_NM, { magnification: SPEC[c][0] });
  const mu = at(1e-4) / 1e-4;
  const w = [1, 2, 4];
  return solve3(
    w.map((t) => [t ** 2, t ** 4, t ** 6]),
    w.map((t) => at(t) / t / mu - 1),
  );
}

/** § 6ch.1's configuration: reverse the objective and the diaphragm leads. */
function reversedStopFirst(c: Cell): { rx: Prescription; P0: number; k: number } {
  const obj = OBJ[c]!;
  const system = LENS[c]!;
  const P0 = imagePlaneZ(asCompiled(system.prescription), system) - pupils(system, RULER_NM).exit.z;
  const rev = reversePrescription(obj.prescription, obj.objectDistanceMm);
  const rx: Prescription = { ...rev, surfaces: rev.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })) };
  const at = (r: number) => objectHeightForImageRadius(system, r, RULER_NM, { magnification: SPEC[c][0] });
  const f = (at(1e-4) / 1e-4) * P0;
  const dual: Prescription = {
    ...obj.prescription,
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: Infinity,
        thickness: obj.objectDistanceMm,
        medium: obj.prescription.objectMedium ?? "AIR",
        isStop: true,
      },
      ...obj.prescription.surfaces.map((s) => ({ ...s, isStop: false })),
    ],
  };
  const fd = -1 / paraxialTrace(dual, RULER_NM, { y: 1, u: 0 }).u;
  return { rx, P0, k: (f / fd) ** 2 };
}

describe("§ 6cn.5 — on § 6ck's objective, and what its `b` turns out to be", () => {
  /**
   * The reversed objective's own map IS § 6ck's map: its object is the image
   * plane and its image is the specimen, so its forward coefficients are `mu`,
   * `a` and `b` directly. That is why the comparison below uses `forward()` and
   * not the module's inverted triple.
   */
  const SERIES = Object.fromEntries(
    CELLS.map((c) => {
      const { rx, P0, k } = reversedStopFirst(c);
      return [c, { rx, P0, k, s: distortionSeries(rx, RULER_NM, { objectDistanceMm: P0 }) }];
    }),
  ) as Record<Cell, { rx: Prescription; P0: number; k: number; s: ReturnType<typeof distortionSeries> }>;

  it("has its stop on its LAST surface, which is what makes the reversal legal", () => {
    // `reversedStopFirst` sets `isStop` on the reversed surface 0. That is a
    // re-assertion and not a move only while the objective's own stop is its
    // last surface — a back-focal-plane diaphragm appended to the glass
    // (`designs/microscope`). If it were anywhere else, this module's vertex
    // ray and real ray aiming's solved ray would be aimed at DIFFERENT
    // surfaces, and § 6cn.5's finding below would be a coincidence.
    for (const c of CELLS) {
      const s = OBJ[c]!.prescription.surfaces;
      expect(s.findIndex((x) => x.isStop)).toBe(s.length - 1);
      expect(OBJ[c]!.stopSurfaceIndex).toBe(s.length - 1);
      // …and the microscope it is composed into keeps that one flag.
      expect(LENS[c]!.prescription.surfaces.filter((x) => x.isStop).length).toBe(1);
    }
  });

  it("reproduces the exact trace on the four-surface objective, losing an order as r⁶", () => {
    for (const c of CELLS) {
      const { rx, P0, s } = SERIES[c];
      const zLast = rx.surfaces.slice(0, -1).reduce((z, x) => z + x.thickness, 0);
      const zImage = zLast + s.imageDistanceMm;
      const residual = (r: number): number => {
        const t = traceRay(rx, makeRay(vec3(r, 0, -P0), vec3(-r, 0, P0), RULER_NM));
        expect(t.status).toBe("ok");
        const { dir, origin } = t.ray!;
        const traced = origin.x + (dir.x / dir.z) * (zImage - origin.z);
        const series = s.imageHeightSeries.reduce((acc, cf, i) => acc + cf * r ** i, 0);
        return Math.abs(traced / series - 1);
      };
      const [r1, r2, r4] = [residual(1), residual(2), residual(4)];
      expect(r1).toBeLessThan(5e-11);
      for (const ratio of [r2 / r1, r4 / r2]) {
        expect(ratio).toBeGreaterThan(40);
        expect(ratio).toBeLessThan(90);
      }
    }
  });

  it("names § 6ck's `a` to 1.4e-8 — and needs no (f/f_d)² to do it", () => {
    for (const c of CELLS) {
      const [aFit] = mapSeries(c, LENS);
      const { A } = forward(SERIES[c].s);
      // § 6ck's Seidel route reached 6e-6 WITH the factor; the map's own
      // coefficient is here two orders better WITHOUT it.
      expect(Math.abs(A / aFit! - 1)).toBeLessThan(1e-7);
      // And the factor is not a refinement of this route: applying it costs
      // four orders. Whatever `(f/f_d)²` corrects, it is the Seidel arithmetic
      // and not the map.
      expect(Math.abs((A * SERIES[c].k) / aFit! - 1)).toBeGreaterThan(5e-5);
    }
  });

  it("but § 6ck's `b` is NOT this quartic — it is the chief ray's aiming", () => {
    for (const c of CELLS) {
      const [, bParaxial] = mapSeries(c, LENS);
      const [, bReal] = mapSeries(c, REAL);
      const { B } = forward(SERIES[c].s);
      // Against the map as § 6ck measured it — rays aimed at the PARAXIAL
      // entrance pupil — the fitted quartic is a different number entirely: on
      // the 10x/0.1 cell +2.6e-8 against −9.4e-10, the wrong sign and 27x the
      // size.
      expect(Math.abs(B / bParaxial! - 1)).toBeGreaterThan(0.5);
      // Re-measure the SAME map with the chief ray solved onto the stop and the
      // fitted quartic lands on this one. So what § 6ck measured as `b` is
      // dominated by the aiming approximation and not by the system's
      // fifth-order distortion — the coefficient and the reading are two
      // different quantities, which is the reverse of § 6ck.0's finding about
      // `a` and the same lesson.
      expect(Math.abs(B / bReal! - 1)).toBeLessThan(0.2);
    }
  });

  it("and the aiming that rewrites the quartic barely moves the cube", () => {
    for (const c of CELLS) {
      const [aParaxial] = mapSeries(c, LENS);
      const [aReal] = mapSeries(c, REAL);
      const shift = Math.abs(aReal! / aParaxial! - 1);
      // Measured between 3.6e-4 and 2.9e-3 across the four cells. The claim is
      // the SEPARATION and not either number: the quartic moves by more than a
      // factor (above), the cube by parts in a thousand. Why the cube moves at
      // all is unattributed — it is not the aiming solve's tolerance, which is
      // 1e-12 of the stop radius — so the bounds are wide on both sides and
      // this rung is not a pin on the shift's size.
      expect(shift).toBeGreaterThan(5e-5);
      expect(shift).toBeLessThan(0.05);
    }
  });
});
