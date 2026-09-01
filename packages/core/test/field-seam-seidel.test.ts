import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { FiniteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";
import type { Prescription } from "../src/trace/prescription";
import { reversePrescription } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { seidelSums } from "../src/analysis/seidel";
import { asCompiled } from "../src/trace/compile";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";

/**
 * § 6ck — the map's coefficient is one Seidel sum, read at a finite radius.
 *
 * § 6cj closed on "**`D` is a traced readout and not yet a Seidel sum.**
 * § 6ch built the machinery that would name it — distortion is ΣS_V, and the
 * reversed prescription is the one configuration `seidelSums` computes it for —
 * but this step reads `D` off the map rather than deriving it, so the edge's
 * SIZE is still measured." This derives it, and the derivation says something
 * about § 6cj's own number that § 6cj did not know.
 *
 * ## § 6cj's `D` is not the third-order coefficient, and the gap is derivable
 *
 * The identity itself is § 6ch.1's and is not re-asserted here: § 6ch already
 * pinned the map's quadratic against `[ΣS_V/(2u′)]/mu · (f/f_d)²` to 7.3e-6 on
 * eight cells, and the coefficient it fitted there and the `D` § 6cj reads are
 * the same number under a different name (§ 6ck.2). What is new is that
 * § 6cj's READING of it is not that number.
 *
 * `mapQuadratic` takes `κ(r) = r·h′(r)/h(r)` at one radius and reports
 * `(κ − 1)/2r²`. With `h/r = 1 + a r² + b r⁴` that quantity is
 *
 *     D_read(r) = a + (2b − a²) r² + O(r⁴)
 *
 * — not `a`. At § 6cj's own one millimetre it is 3.1e-4 low, which is the whole
 * of the disagreement between § 6cj's pinned −1.203087e-4 and the Seidel
 * number −1.2034555e-4 (§ 6ck.0), and the correction is good to 2e-6 out to two
 * millimetres, the r⁶ term arriving by four (§ 6ck.1).
 *
 * ## Why the radius follows NA and not magnification
 *
 * § 6cj measured that `1/√|D|` sorts by NA and by nothing else, and had no
 * reason for it. The Seidel form has three factors and they sort it:
 *
 *   - **NA doubles at fixed M**: the sum grows ×1.48 but the normalising `u′`
 *     — the reversed prescription's own marginal slope, which is the aperture —
 *     doubles, so `D` FALLS to ×0.73. The aperture in the normaliser is the
 *     mechanism; the surfaces' own rebalancing is inside the ×1.48.
 *   - **M doubles at fixed NA**: the sum halves and `mu` halves with it, and
 *     the two cancel to within 4 to 7% (§ 6ck.3).
 *
 * ## And § 6cj.3's coefficient no longer needs a trace
 *
 * Substituting the prescription-only coefficient for § 6cj's traced reading
 * leaves the load-bearing slope ratio where § 6cj.3 pinned it (§ 6ck.4). The
 * comparison against a live mosaic still traces, and always will; what stops
 * tracing is the closed form's one free number.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

/** § 6bn.1's device as § 6bu…§ 6cj used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

type Cell = "s10" | "f10" | "s20" | "f20";
const SPEC: Record<Cell, readonly [number, number]> = {
  s10: [10, 0.1],
  f10: [10, 0.2],
  s20: [20, 0.1],
  f20: [20, 0.2],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];
const OBJ: Record<Cell, FiniteConjugateObjective> = Object.fromEntries(
  CELLS.map((c) => [
    c,
    finiteConjugateObjective({ magnification: SPEC[c][0], numericalAperture: SPEC[c][1] }),
  ]),
) as Record<Cell, FiniteConjugateObjective>;
const LENS: Record<Cell, OpticalSystem> = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateMicroscope({ objective: OBJ[c]! }).system]),
) as Record<Cell, OpticalSystem>;

/** § 6bo's shapes at k = 1. `size` and `pupilSamples`, in that order. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};

const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
const shareOfI = (i: number): number => i / 2 ** 23;
/** § 6ca's own two ends of the guard secant. */
const TINY = 8;
const WIDE = 524288;

const optionsAt = (c: Cell, j: number, i: number, cx: number): FluorescenceMosaicOptions => ({
  size: BIG,
  pupilSamples: PS_AT(c, j),
  slabs: THIN,
  samples: [
    { nm: 430, weight: 1 },
    { nm: DESIGN, weight: 1 },
    { nm: 656.2725, weight: 1 },
  ],
  tiles: 3,
  guardCells: guardAt(j, i),
  stageMm: FREE_STAGE,
  radialMapSeed: "magnification",
  centreMm: { x: cx, y: 0 },
});

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

/** The ruler the mosaic actually maps in: its wavelength and its magnification. */
interface Ruler {
  readonly nm: number;
  readonly magnification: number;
}
const RULER: Record<Cell, Ruler> = Object.fromEntries(
  CELLS.map((c) => {
    const g = fluorescenceMosaicGeometry(LENS[c]!, optionsAt(c, 8, 65536, 2));
    return [c, { nm: g.rulerWavelengthNm, magnification: g.planes[g.rulerIndex]!.frame.magnification }];
  }),
) as Record<Cell, Ruler>;

const heightAt = (c: Cell, r: number, seed = RULER[c].magnification): number =>
  objectHeightForImageRadius(LENS[c]!, r, RULER[c].nm, { magnification: seed });

/** § 6cj's own reading: `κ(r) = r·h′/h` at one radius, reported as `(κ − 1)/2r²`. */
function mapQuadratic(c: Cell, atMm = 1): number {
  const d = atMm * 1e-5;
  const kappa = (atMm * ((heightAt(c, atMm + d) - heightAt(c, atMm - d)) / (2 * d))) / heightAt(c, atMm);
  return (kappa - 1) / (2 * atMm * atMm);
}

/**
 * The map's series, fitted rather than read at a radius: `h/r = mu(1 + a r² +
 * b r⁴ + c r⁶)`. Stable to seven figures across two disjoint windows, which is
 * what makes `a` a coefficient rather than a reading.
 */
function mapSeries(c: Cell, window: readonly number[] = [1, 2, 4]): readonly number[] {
  const mu = heightAt(c, 1e-4) / 1e-4;
  return solve3(
    window.map((t) => [t ** 2, t ** 4, t ** 6]),
    window.map((t) => heightAt(c, t) / t / mu - 1),
  );
}

/**
 * § 6ch.1's route, which is the one configuration `seidelSums` computes ΣS_V
 * for: reverse the objective and the diaphragm becomes the first surface.
 */
interface SeidelReading {
  /** `[ΣS_V/(2u′)]/mu · (f/f_d)²` — the third-order coefficient itself. */
  readonly D: number;
  readonly s5: number;
  readonly uPrime: number;
  readonly mu: number;
  readonly f: number;
  readonly fd: number;
  /** Each real surface's share of ΣS_V. */
  readonly shares: readonly number[];
}
function seidelReading(c: Cell): SeidelReading {
  const obj = OBJ[c]!;
  const system = LENS[c]!;
  const nm = RULER[c].nm;
  const P0 = imagePlaneZ(asCompiled(system.prescription), system) - pupils(system, nm).exit.z;
  const mu = heightAt(c, 1e-4) / 1e-4;
  const f = mu * P0;

  const rev = reversePrescription(obj.prescription, obj.objectDistanceMm);
  const revStopFirst: Prescription = {
    ...rev,
    surfaces: rev.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
  };
  const sums = seidelSums(revStopFirst, nm, {
    marginalHeightMm: obj.stopRadiusMm,
    objectDistanceMm: P0,
    fieldAngleRad: 1 / P0,
    distortion: true,
  });
  const uPrime = paraxialTrace(revStopFirst, nm, {
    y: obj.stopRadiusMm,
    u: -obj.stopRadiusMm / P0,
  }).u;

  // The DUAL prescription's own paraxial focal length — § 6ch.0's second focal
  // length, and the whole of the difference between a raw agreement of 1.5e-3
  // and this one.
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
  const fd = -1 / paraxialTrace(dual, nm, { y: 1, u: 0 }).u;

  return {
    D: ((sums.s5! / (2 * uPrime) / mu) * (f / fd) ** 2),
    s5: sums.s5!,
    uPrime,
    mu,
    f,
    fd,
    shares: sums.surfaces.map((s) => (s.s5 ?? 0) / sums.s5!),
  };
}

const SEIDEL: Record<Cell, SeidelReading> = Object.fromEntries(
  CELLS.map((c) => [c, seidelReading(c)]),
) as Record<Cell, SeidelReading>;

describe("§ 6ck.0 — the map's quadratic is ΣS_V, and § 6cj read it 3e-4 low", () => {
  it("the fitted coefficient is the Seidel one, on all four cells", () => {
    let worst = 0;
    for (const c of CELLS) {
      const [a] = mapSeries(c);
      worst = Math.max(worst, Math.abs(a! / SEIDEL[c].D - 1));
    }
    // § 6ch.1's own agreement, on § 6cj's four cells and at § 6cj's ruler
    // wavelength rather than § 6ch's chosen 430 — which are the same 430.
    expect(worst).toBeLessThan(6e-6);
    for (const c of CELLS) expect(RULER[c].nm).toBe(430);
  });

  it("but § 6cj's reading at one millimetre is NOT that coefficient", () => {
    // The number § 6cj.2 pins, against the number third-order theory names. The
    // gap is one part in 3200 — small, and not zero, and § 6cj had no account
    // of it because it never had the coefficient to compare against.
    expect(mapQuadratic("s10")).toBeCloseTo(-1.203087e-4, 9);
    expect(SEIDEL["s10"].D).toBeCloseTo(-1.2034555e-4, 9);
    for (const c of CELLS) {
      const gap = mapQuadratic(c) / SEIDEL[c].D - 1;
      expect(gap).toBeLessThan(-2.5e-4);
      expect(gap).toBeGreaterThan(-3.2e-4);
    }
  });
});

describe("§ 6ck.1 — and the gap is the map's own quartic, at every radius", () => {
  it("D_read(r) = a + (2b − a²)r², exactly", () => {
    for (const c of CELLS) {
      const [a, b] = mapSeries(c);
      // Out to two millimetres the two-term correction is the whole of it.
      // Out to two millimetres the two-term correction is the whole of it. The
      // 2e-6 is not the series: it is the central difference's own step, which
      // is `r·1e-5` and so shrinks with the radius it is measuring — which is
      // why the half-millimetre reading is the worst of the three and not the
      // best.
      for (const r of [0.5, 1, 2]) {
        const predicted = a! + (2 * b! - a! * a!) * r * r;
        expect(Math.abs(mapQuadratic(c, r) / predicted - 1)).toBeLessThan(2e-6);
      }
      // By four the r⁶ term has arrived and the two-term form is an order of
      // magnitude worse, on every cell — which is the same statement as the
      // series having a third term at all.
      const atFour = a! + (2 * b! - a! * a!) * 16;
      expect(Math.abs(mapQuadratic(c, 4) / atFour - 1)).toBeGreaterThan(6e-6);
      expect(Math.abs(mapQuadratic(c, 4) / atFour - 1)).toBeLessThan(2.5e-5);
    }
  });

  it("so the 3e-4 § 6cj carries is `(2b − a²)/a` and nothing else", () => {
    for (const c of CELLS) {
      const [a, b] = mapSeries(c);
      const predicted = (2 * b! - a! * a!) / a!;
      const offset = mapQuadratic(c, 1) / a! - 1;
      // The offset itself, to within 1.3e-3 of it — which is 2e-6 on `D`, the
      // floor § 6ck.1's first rung is already at.
      expect(Math.abs(offset / predicted - 1)).toBeLessThan(1.5e-3);
      // It runs −2.57e-4 to −3.11e-4 across the four cells, and it is NEGATIVE
      // on every one: `2b` and `a` have opposite signs, so the reading is low.
      expect(offset).toBeLessThan(-2.5e-4);
      expect(offset).toBeGreaterThan(-3.2e-4);
      // A quarter of the offset is `a²` and the rest is the map's own quartic,
      // so this is not a linearisation artefact that a smaller radius removes.
      expect(Math.abs((a! * a!) / (2 * b!))).toBeGreaterThan(0.22);
      expect(Math.abs((a! * a!) / (2 * b!))).toBeLessThan(0.31);
    }
  });
});

describe("§ 6ck.2 — the coefficient does not depend on the seed, so it is § 6ch's", () => {
  it("four seeds, one answer, to the last bit on three cells of four", () => {
    for (const c of CELLS) {
      const M = SPEC[c][0];
      const seeds = [RULER[c].magnification, M, -M, 1.5 * M];
      const fits = seeds.map((seed) => {
        const mu = heightAt(c, 1e-4, seed) / 1e-4;
        return solve3(
          [1, 2, 4].map((t) => [t ** 2, t ** 4, t ** 6]),
          [1, 2, 4].map((t) => heightAt(c, t, seed) / t / mu - 1),
        )[0]!;
      });
      for (const v of fits) expect(Math.abs(v / fits[0]! - 1)).toBeLessThan(1e-11);
    }
    // Bitwise on three of the four. `objectHeightForImageRadius` bisects to
    // mantissa exhaustion, so the seed chooses the PATH and not the answer —
    // § 6m.2's claim, here at the one place where the path is long enough for
    // the last two digits to notice.
    const bitwise = CELLS.filter((c) => {
      const M = SPEC[c][0];
      const of = (seed: number): number => {
        const mu = heightAt(c, 1e-4, seed) / 1e-4;
        return solve3(
          [1, 2, 4].map((t) => [t ** 2, t ** 4, t ** 6]),
          [1, 2, 4].map((t) => heightAt(c, t, seed) / t / mu - 1),
        )[0]!;
      };
      return of(RULER[c].magnification) === of(M) && of(M) === of(-M);
    });
    expect(bitwise.length).toBe(3);
    expect(bitwise).not.toContain("f20");
  });

  it("and a seed far enough out has no answer at all, rather than a different one", () => {
    // The seed opens the bracket, so a nonsense one does not bias the result —
    // it fails to bracket. The refusal names the image radius asked for, which
    // is § 6bk.8's fix, and that is what makes this distinguishable from a
    // wrong answer.
    expect(() => heightAt("s10", 2, 1)).toThrow(/no object height reaches image radius 2 mm/);
  });
});

describe("§ 6ck.3 — and the radius follows NA because the normaliser is the aperture", () => {
  it("D is ΣS_V over 2u′ and mu, and those three factors reproduce it", () => {
    for (const c of CELLS) {
      const s = SEIDEL[c];
      const assembled = (s.s5 / (2 * s.uPrime) / s.mu) * (s.f / s.fd) ** 2;
      expect(assembled).toBe(s.D);
    }
  });

  it("NA doubles: the sum grows by half, the aperture doubles, D falls to 0.73", () => {
    const expected: Record<string, readonly [number, number, number]> = {
      "s10>f10": [1.4793, 2.0332, 0.7284],
      "s20>f20": [1.5257, 2.0332, 0.7512],
    };
    for (const [lo, hi] of [
      ["s10", "f10"],
      ["s20", "f20"],
    ] as const) {
      const a = SEIDEL[lo];
      const b = SEIDEL[hi];
      const [sum, aperture, D] = expected[`${lo}>${hi}`]!;
      expect(b.s5 / a.s5).toBeCloseTo(sum, 4);
      expect(b.uPrime / a.uPrime).toBeCloseTo(aperture, 4);
      expect(b.D / a.D).toBeCloseTo(D, 4);
      // `mu` is the magnification and does not move; the ratio is the other two.
      expect(Math.abs(b.mu / a.mu - 1)).toBeLessThan(2e-3);
      expect((b.s5 / a.s5) / (b.uPrime / a.uPrime) / (b.D / a.D)).toBeCloseTo(1, 2);
      // And the aperture ratio IS the stop radius ratio, to a percent.
      const stops = OBJ[hi]!.stopRadiusMm / OBJ[lo]!.stopRadiusMm;
      expect(Math.abs(b.uPrime / a.uPrime / stops - 1)).toBeLessThan(0.011);
    }
  });

  it("M doubles: the sum halves, mu halves with it, and they cancel", () => {
    const expected: Record<string, readonly [number, number, number]> = {
      "s10>s20": [0.5208, 0.499937, 1.0415],
      "f10>f20": [0.5371, 0.499932, 1.0742],
    };
    for (const [lo, hi] of [
      ["s10", "s20"],
      ["f10", "f20"],
    ] as const) {
      const a = SEIDEL[lo];
      const b = SEIDEL[hi];
      const [sum, mu, D] = expected[`${lo}>${hi}`]!;
      expect(b.s5 / a.s5).toBeCloseTo(sum, 4);
      expect(b.mu / a.mu).toBeCloseTo(mu, 5);
      expect(b.D / a.D).toBeCloseTo(D, 4);
      // The aperture does NOT move with magnification — that is the whole
      // asymmetry between this pair and the last one.
      expect(Math.abs(b.uPrime / a.uPrime - 1)).toBeLessThan(1e-3);
      // So the two halvings cancel, to within 4 and 7 percent.
      expect(Math.abs(b.D / a.D - 1)).toBeLessThan(0.08);
    }
    // Which is why § 6cj's `1/√|D|` sorts by NA and by nothing else: across the
    // family the NA factor is 0.73 and the magnification factor is 1.04.
    const radius = (c: Cell): number => 1 / Math.sqrt(-SEIDEL[c].D);
    expect(radius("s20")).toBeLessThan(radius("s10"));
    expect(radius("s10")).toBeLessThan(radius("f20"));
    expect(radius("f20")).toBeLessThan(radius("f10"));
    // The coefficient's radii, against the READING's that § 6cj.2 quotes to two
    // decimals. Half of a 3e-4 in `D` is 1.5e-4 in the radius, so every one of
    // them falls by 0.013 to 0.016 mm.
    const reading = (c: Cell): number => 1 / Math.sqrt(-mapQuadratic(c));
    expect(radius("s20")).toBeCloseTo(89.32039, 4);
    expect(radius("s10")).toBeCloseTo(91.15594, 4);
    expect(radius("f20")).toBeCloseTo(103.05422, 4);
    expect(radius("f10")).toBeCloseTo(106.80877, 4);
    for (const c of CELLS) {
      expect(reading(c) - radius(c)).toBeGreaterThan(0.0125);
      expect(reading(c) - radius(c)).toBeLessThan(0.0157);
    }
    // At the one decimal § 6cj's prose quotes, nothing moves — 89.3, 91.2,
    // 103.1, 106.8 either way. At the two its table quotes, the last digit
    // moves on all four, by one and on the 20x/0.2 cell by two. § 6cj's row
    // stays right about the reading it pinned; this is the coefficient's.
    const to1 = (x: number): string => x.toFixed(1);
    for (const c of CELLS) expect(to1(radius(c))).toBe(to1(reading(c)));
    expect(radius("s20").toFixed(2)).toBe("89.32");
    expect(radius("f10").toFixed(2)).toBe("106.81");
    expect(reading("f20").toFixed(2)).toBe("103.07");
    expect(radius("f20").toFixed(2)).toBe("103.05");
  });

  it("and the surfaces' own rebalancing is inside the sum, not the mechanism", () => {
    // Three real surfaces behind the reversed diaphragm, which contributes
    // nothing: a flat at the stop has no A to divide by and no power.
    for (const c of CELLS) {
      expect(SEIDEL[c].shares[0]).toBe(0);
      expect(SEIDEL[c].shares.length).toBe(4);
    }
    // The middle surface's cancellation deepens with NA — 0.41 of the sum at
    // 0.1, 0.60 at 0.2 — but that is a 10% move in a factor of 1.48, where the
    // aperture is a factor of 2.03.
    expect(SEIDEL["s10"].shares[2]!).toBeCloseTo(-0.4111, 4);
    expect(SEIDEL["f10"].shares[2]!).toBeCloseTo(-0.6024, 4);
    expect(SEIDEL["s20"].shares[2]!).toBeCloseTo(-0.3635, 4);
    expect(SEIDEL["f20"].shares[2]!).toBeCloseTo(-0.5173, 4);
  });
});

// ---------------------------------------------------------------------------
// § 6ck.4 needs § 6cj.3's machinery, which is § 6ci.0's closed form with both
// assumptions swappable. Copied rather than shared: § 6bu…§ 6cj each carry
// their own, and a shared one would let a later step move an earlier pin.
// ---------------------------------------------------------------------------

type ScaleModel = "traced" | "hypot" | "quad";
type Warp = "none" | "map" | "jac" | "lin";

interface Branch {
  readonly value: number;
  readonly probe: number;
  readonly radiusMm: number;
  readonly cos2: number;
}
const EMPTY: Branch = { value: 0, probe: -1, radiusMm: 0, cos2: 0 };

function seam(
  c: Cell,
  j: number,
  i: number,
  cx: number,
  models: readonly ScaleModel[],
  warps: readonly Warp[],
  quadratic = 0,
) {
  const system = LENS[c]!;
  const options = optionsAt(c, j, i, cx);
  const g = fluorescenceMosaicGeometry(system, options);
  const n = g.tilesPerAxis;
  const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
  const near = U - g.overlapPixels;
  const half = (n - 1) / 2;
  const magnification = g.planes[g.rulerIndex]!.frame.magnification;
  const nm = g.rulerWavelengthNm;
  const centre = (k: number): { x: number; y: number } => {
    const col = k % n;
    const row = (k - col) / n;
    return { x: cx + (col - half) * g.pitchMm, y: (row - half) * g.pitchMm };
  };
  const axis = objectFieldTile(system, { ...options, centreMm: { x: 0, y: 0 }, wavelengthNm: nm });
  const s0 = axis.pixelScaleMm;
  const R0 = axis.scale.referenceRadius;
  const scales: Record<ScaleModel, number[]> = { traced: [], hypot: [], quad: [] };
  for (let k = 0; k < n * n; k++) {
    const p = centre(k);
    const r2 = p.x * p.x + p.y * p.y;
    if (models.includes("traced")) {
      scales.traced.push(
        objectFieldTile(system, { ...options, centreMm: p, wavelengthNm: nm }).pixelScaleMm,
      );
    }
    scales.hypot.push((s0 * Math.hypot(R0, Math.sqrt(r2))) / R0);
    scales.quad.push(s0 * (1 + r2 / (2 * R0 * R0)));
  }
  const height = (r: number): number =>
    objectHeightForImageRadius(system, r, nm, { magnification });
  const probes = 65;
  const along = (k: number): number => Math.round(((g.size - 1) * k) / (probes - 1));
  const owner = (t: number): number => Math.min(n - 1, Math.floor(t / g.pitchPixels));
  const out: Record<string, Branch> = {};
  for (const model of models) {
    const S = scales[model];
    for (const warp of warps) {
      let rows = EMPTY;
      let cols = EMPTY;
      const put = (
        best: Branch,
        probe: number,
        a: { x: number; y: number },
        b: { x: number; y: number },
      ): Branch => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const px = (a.x + b.x) / 2;
        const py = (a.y + b.y) / 2;
        const r = Math.hypot(px, py);
        const dr = (dx * px + dy * py) / r;
        const dt = (-dx * py + dy * px) / r;
        let value: number;
        if (warp === "none") value = Math.hypot(dx, dy);
        else if (warp === "map") {
          const ra = Math.hypot(a.x, a.y);
          const rb = Math.hypot(b.x, b.y);
          const ha = height(ra) / ra;
          const hb = height(rb) / rb;
          value = Math.hypot(hb * b.x - ha * a.x, hb * b.y - ha * a.y);
        } else if (warp === "jac") {
          const d = r * 1e-5;
          const radial = (height(r + d) - height(r - d)) / (2 * d);
          value = Math.hypot(radial * dr, (height(r) / r) * dt);
        } else {
          const t = 1 + quadratic * r * r;
          value = t * Math.hypot((1 + 2 * quadratic * r * r) * dr, dt);
        }
        if (value <= best.value) return best;
        return { value, probe, radiusMm: r, cos2: (dr * dr) / (dr * dr + dt * dt) };
      };
      for (let s = 1; s < n; s++) {
        for (let p = 0; p < probes; p++) {
          const t = along(p);
          const other = owner(t);
          const inTile = g.croppedPixels + g.guardPixels + (t - other * g.pitchPixels);
          const across = inTile - g.tileSize / 2;
          {
            const a = s - 1 + other * n;
            const b = s + other * n;
            const ca = centre(a);
            const cb = centre(b);
            cols = put(
              cols,
              p,
              { x: ca.x + near * S[a]!, y: ca.y + across * S[a]! },
              { x: cb.x - U * S[b]!, y: cb.y + across * S[b]! },
            );
          }
          {
            const a = other + (s - 1) * n;
            const b = other + s * n;
            const ca = centre(a);
            const cb = centre(b);
            rows = put(
              rows,
              p,
              { x: ca.x + across * S[a]!, y: ca.y + near * S[a]! },
              { x: cb.x + across * S[b]!, y: cb.y - U * S[b]! },
            );
          }
        }
      }
      out[`${model}/${warp}/rows`] = rows;
      out[`${model}/${warp}/cols`] = cols;
    }
  }
  const anisotropy = (model: ScaleModel, warp: Warp): number =>
    out[`${model}/${warp}/rows`]!.value / out[`${model}/${warp}/cols`]!.value;
  return { w: (U * g.pixelScaleMm) / cx, out, anisotropy, R0 };
}

const live = (c: Cell, j: number, i: number, cx: number) => {
  const s = mosaicSeamShiftMm(LENS[c]!, optionsAt(c, j, i, cx), 65);
  return { rows: s.betweenRowsMm, cols: s.betweenColumnsMm };
};

const interact = (v: readonly number[]): number => v[3]! / v[2]! / (v[1]! / v[0]!);
const shapeRows = (w: number): number => Math.hypot(2 + 3 * w, w);
const shapeCols = (w: number): number => Math.hypot(1 + 3 * w, 1 + w);

/** § 6cj.3's own experiment, with the coefficient made an input. */
function overshoot(pick: (c: Cell) => number): Record<string, number> {
  const j = 128;
  const cx = 2;
  const dshare = shareOfI(WIDE) - shareOfI(TINY);
  const D: Record<string, number> = {};
  for (const c of CELLS) D[c] = pick(c);
  const cache = new Map<string, ReturnType<typeof seam>>();
  const S = (c: Cell, i: number): ReturnType<typeof seam> => {
    const key = `${c}/${i}`;
    if (!cache.has(key)) cache.set(key, seam(c, j, i, cx, ["quad"], ["none", "lin"], D[c]!));
    return cache.get(key)!;
  };
  const liveCache = new Map<string, { rows: number; cols: number }>();
  const L = (c: Cell, i: number) => {
    const key = `${c}/${i}`;
    if (!liveCache.has(key)) liveCache.set(key, live(c, j, i, cx));
    return liveCache.get(key)!;
  };
  const slope = (p: (c: Cell, i: number) => number): number =>
    Math.log(interact(CELLS.map((c) => p(c, WIDE))) / interact(CELLS.map((c) => p(c, TINY)))) /
    dshare;
  const got: Record<string, number> = {};
  for (const b of ["rows", "cols"] as const) {
    const shape = b === "rows" ? shapeRows : shapeCols;
    got[`${b}/live`] = slope((c, i) => L(c, i)[b]);
    got[`${b}/fixed`] = slope((c, i) => {
      const s = S(c, i);
      const stretch = s.out[`quad/lin/${b}`]!.value / s.out[`quad/none/${b}`]!.value;
      return s.w * s.w * shape(s.w) * stretch;
    });
  }
  return got;
}

describe("§ 6ck.4 — so § 6cj.3's coefficient needs no trace", () => {
  it("the prescription-only D holds § 6cj.3's ratio, and costs 0.4% of its residue", () => {
    const traced = overshoot((c) => mapQuadratic(c));
    const derived = overshoot((c) => SEIDEL[c].D);
    const ratio = (g: Record<string, number>, k: "fixed" | "live"): number =>
      g[`cols/${k}`]! / g[`rows/${k}`]!;

    // § 6cj.3's own two numbers, reproduced with the traced coefficient.
    expect(ratio(traced, "fixed")).toBeCloseTo(1.0259, 4);
    expect(ratio(traced, "live")).toBeCloseTo(1.02617, 5);
    // And with the coefficient the prescription alone names. The two differ by
    // 1e-6 — three orders below the 2.3e-4 either of them is from live — so the
    // closed form's one free number stops needing a trace, at no cost.
    expect(ratio(derived, "fixed")).toBeCloseTo(1.025933, 5);
    expect(Math.abs(ratio(derived, "fixed") / ratio(traced, "fixed") - 1)).toBeLessThan(1.1e-6);

    // Said honestly, it is not an improvement: § 6cj's reading being 3e-4 low
    // happened to sit 0.4% nearer live, and the derived one is 0.4% further.
    // What this rung removes is a dependency, not an error.
    const err = (g: Record<string, number>): number => ratio(g, "fixed") / ratio(g, "live") - 1;
    expect(err(traced)).toBeCloseTo(-2.3005e-4, 7);
    expect(err(derived)).toBeCloseTo(-2.3103e-4, 7);
    expect(Math.abs(err(derived))).toBeGreaterThan(Math.abs(err(traced)));
    expect(Math.abs(err(derived) / err(traced) - 1)).toBeLessThan(6e-3);
  }, 1800000);
});
