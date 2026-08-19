import { describe, it, expect } from "vitest";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { DoubletApertureRefusal, achromaticObjective, cementedDoubletForm } from "../src/designs/achromat";
import { plosslEyepiece } from "../src/designs/eyepiece";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { seidelSums } from "../src/analysis/seidel";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the cemented doublet's ceiling — docs/VALIDATION.md § 6b.5.
 *
 * § 6b left one item open in words: "the 4× sitting at f/4.1 — the edge of the
 * cemented-doublet form". APP.md's D8 then measured the constructor's own
 * refusal boundary, found it at f/2.3 rather than f/4.1, found it nearly
 * constant across two glass pairs and two orientations where the NA was not,
 * and flagged — deliberately, being app wiring — "the doublet's ceiling is a
 * focal ratio ≈ f/2.3, and the ratio is the invariant" as an open question for
 * this step. This file answers it, and the answer is that **the two halves of
 * that sentence are about two different things**:
 *
 *  - The **optical** ceiling is Maréchal's, it is EXTERNAL, and on it neither
 *    the aperture nor the ratio is invariant — the reach spans 77% in NA and
 *    40% in working focal ratio over M = 4 → 40. § 6b's original sentence is
 *    the one that survives: the catalogued 4×/0.10 has 3.1% of NA in hand.
 *  - The **refusal** boundary is `achromaticObjective`'s, it contains no
 *    aperture *by construction*, and that is why the ratio at it looks
 *    invariant. At it the wavefront is 3.45 waves — 48× Maréchal. It is a
 *    property of the solver, and this file pins which parts of the solver:
 *    the ±3·span scan window, and the fixed point's thin-lens seed.
 *
 * So these rungs split in two by kind, and the file says which is which rather
 * than presenting one table. Only the § 6b.5.1 group is pinned to an external
 * criterion; the rest are identities, closed forms and negative controls in the
 * sense § 6s uses the word — a rung about a solver is an identity rung.
 */

const LAMBDA = LINE_D;
const MARECHAL = 1 / 14;
/**
 * Timeout for the rungs that bisect a refusal boundary. Since § 6b.5.6 a REFUSED
 * design is no longer one bending scan but a handful — the aperture is held
 * back, the geometry re-converged and the hold-back bisected back toward 1 — and
 * half the samples of a bisection are refusals. The walls are memoized so each
 * is paid for once, but a rung that reads eight of them still runs for the best
 * part of a minute under a loaded suite.
 */
const SLOW = 180_000;
/** `finiteConjugateObjective`'s own default — the glass is sized over the stop. */
const GLASS_MARGIN = 1.12;

/**
 * Every bisection in this file is a pure function of its arguments, and the
 * rungs deliberately ask for the SAME walls from several directions — the seed's
 * miss, the converged identity and the literals are three readings of one set of
 * boundaries. Since § 6b.5.6 a refused design costs a handful of bending scans
 * instead of one, so the repeats are what the file's runtime is made of. Cached,
 * they are read once each.
 */
const memoize = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => {
  const seen = new Map<string, R>();
  return (...args: A): R => {
    const key = JSON.stringify(args);
    if (!seen.has(key)) seen.set(key, fn(...args));
    return seen.get(key)!;
  };
};

/**
 * σ at best focus on the DIN chain, the currency § 6b.4 already reports in.
 *
 * **The placement is stated, not defaulted** (§ 6ai). A wavefront RMS has a stop
 * position in it — 0.88% of σ on the axial 4×/0.10 — so an EXTERNAL criterion
 * applied to it is a claim about a named lens or about no lens at all. Every
 * number in this section is the SHIPPED objective's, and § 6ai.6 is where the
 * rim-stopped control's own ceiling is put beside it.
 *
 * The `lost` guard is new with the same step and is not bookkeeping: a
 * telecentric objective carries a paraxially-sized diaphragm, and a bending with
 * enough residual spherical aberration lands its rim ray outside it (§ 6ai.4).
 * An RMS over a clipped pupil is a different quantity, and it would arrive here
 * as a plausible smaller number rather than as a failure.
 */
function sigmaWavesAt(M: number, NA: number, over: Record<string, unknown> = {}): number {
  const objective = finiteConjugateObjective({ magnification: M, numericalAperture: NA, ...over });
  const s = finiteConjugateMicroscope({ objective }).system;
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  const map = opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21));
  expect(map.lost).toBe(0);
  return map.rmsWaves;
}
const sigmaWaves = memoize(sigmaWavesAt);

/** Highest x in [lo, hi] for which `ok` holds. σ runs as NA⁶, so bisect. */
const highest = (lo: number, hi: number, ok: (x: number) => boolean, steps = 26): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < steps; i++) {
    const m = 0.5 * (a + b);
    if (ok(m)) a = m;
    else b = m;
  }
  return a;
};

/** The largest NA the DIN constructor will build at all. */
const buildWall = memoize((over: Record<string, unknown>): number =>
  highest(0.05, 0.9, (NA) => {
    try {
      finiteConjugateObjective({ magnification: 4, numericalAperture: NA, ...over });
      return true;
    } catch {
      return false;
    }
  }, 44));

/**
 * The rim-stopped spelling, for the rungs that CANNOT use the shipped lens.
 *
 * Not a leftover: past NA 0.1461 the telecentric objective's real rim ray lands
 * outside its own paraxially-sized diaphragm and the trace clips (§ 6ai.4),
 * so σ there is an average over part of a pupil. Every rung that quotes a
 * wavefront in the far band — the region that is TENS of times past Maréchal and
 * has no usable objective in it — measures the rim member, whose stop is its
 * launch aperture and which therefore clips at no aperture at all. The numbers
 * those rungs pin are unchanged from before § 6ai for exactly that reason.
 */
const RIM = { stopPlacement: "rim" as const };

/** The reach on Maréchal — the external criterion, on the same chain. */
const marechalReach = memoize((M: number): number =>
  highest(0.05, 0.3, (NA) => {
    try {
      return sigmaWaves(M, NA) <= MARECHAL;
    } catch {
      return false;
    }
  }));

/**
 * `achromaticObjective`'s refusal ratio: the smallest focal ratio that still
 * builds, at a stated conjugate ratio s/f. The lens is specified entirely in
 * ratios, so this is the boundary in the solver's own parameter space.
 */
function refusalRatioAt(
  sOverF: number | null,
  over: Record<string, unknown> = {},
  apertureMm = 10,
): number {
  const ok = (F: number): boolean => {
    try {
      achromaticObjective({
        apertureMm,
        focalRatio: F,
        ...(sOverF === null ? {} : { objectDistanceMm: sOverF * apertureMm * F }),
        ...over,
      });
      return true;
    } catch {
      return false;
    }
  };
  let hi = 12;
  let lo = 0.2;
  for (let i = 0; i < 54; i++) {
    const mid = 0.5 * (lo + hi);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
const refusalRatio = memoize(refusalRatioAt);

/** Distance between two doubles in units in the last place. */
const ulpsApart = (a: number, b: number): bigint => {
  const view = new DataView(new ArrayBuffer(8));
  const bits = (x: number): bigint => {
    view.setFloat64(0, x);
    return view.getBigUint64(0);
  };
  const d = bits(a) - bits(b);
  return d < 0n ? -d : d;
};

/** The largest NA the DIN constructor builds at, per magnification and orientation. */
const measuredAt = (M: number, orientation: "flintFirst" | "crownFirst", over: Record<string, unknown> = {}): number =>
  highest(0.05, 0.9, (NA) => {
    try {
      finiteConjugateObjective({ magnification: M, numericalAperture: NA, orientation, ...over });
      return true;
    } catch {
      return false;
    }
  }, 44);
const measured = memoize(measuredAt);

const messageFrom = (fn: () => unknown): string => {
  try {
    fn();
    return "builds";
  } catch (e) {
    return (e as Error).message;
  }
};

/** The thrown error itself, for the rungs that are about its TYPE. */
const catchError = (fn: () => unknown): Error => {
  try {
    fn();
    throw new Error("expected a refusal, got a lens");
  } catch (e) {
    return e as Error;
  }
};

describe("§ 6b.5.1 — the optical ceiling: Maréchal, bisected (EXTERNAL)", () => {
  it("the DIN 4× is diffraction-limited to NA 0.1030 — the catalogued 0.10 has 3% in hand", () => {
    // § 6b's own sentence, finally measured: "the 4× sitting at f/4.1 — the edge
    // of the cemented-doublet form". It is the edge. The reach is 3.1% of NA
    // above the member the catalogue ships, and the working ratio there is
    // f/3.956 against the catalogued f/4.076 — 3% of ratio.
    const reach = marechalReach(4);
    expect(reach).toBeCloseTo(0.10295, 4);
    expect(reach / 0.1 - 1).toBeLessThan(0.04);
    expect(reach).toBeGreaterThan(0.1); // the catalogued member does clear it
    const atReach = finiteConjugateObjective({ magnification: 4, numericalAperture: reach });
    expect(atReach.workingFocalRatio).toBeCloseTo(3.9620, 3);
    // And the pinned member's own σ, which § 6b.4 reports as λ/17.
    expect(sigmaWaves(4, 0.1)).toBeCloseTo(0.059454, 5);
  });

  it("σ runs as NA^6.2 there, so the reach is bisected and not interpolated", () => {
    // An order, not a number — the same law § 6d.3 reads on the Lister and
    // § 5j on the classical doublet. Two consecutive ratios, not a fit.
    const s = [0.08, 0.1, 0.125].map((NA) => sigmaWaves(4, NA));
    const order = (i: number, j: number, a: number, b: number) =>
      Math.log(s[j]! / s[i]!) / Math.log(b / a);
    expect(order(0, 1, 0.08, 0.1)).toBeGreaterThan(5.9);
    expect(order(0, 1, 0.08, 0.1)).toBeLessThan(6.5);
    expect(order(1, 2, 0.1, 0.125)).toBeGreaterThan(5.9);
    expect(order(1, 2, 0.1, 0.125)).toBeLessThan(6.6);
  });

  it("NEITHER the aperture NOR the ratio is invariant on it — 77% and 40%", () => {
    // This is the half of D8's flagged sentence that does NOT survive. The
    // reach rises steeply with M while the ratio at it FALLS, so there is no
    // single focal ratio that is the cemented doublet's optical ceiling. The
    // ratio is the tighter of the two by ~2×, which is the grain of truth in
    // "quote a ratio" — but 40% is not an invariant.
    const rows = [4, 10, 20, 40].map((M) => {
      const NA = marechalReach(M);
      return { M, NA, F: finiteConjugateObjective({ magnification: M, numericalAperture: NA }).workingFocalRatio };
    });
    expect(rows[0]!.NA).toBeCloseTo(0.10295, 4);
    expect(rows[3]!.NA).toBeCloseTo(0.18152, 4);
    expect(rows[0]!.F).toBeCloseTo(3.9620, 3);
    expect(rows[3]!.F).toBeCloseTo(2.8404, 3);
    // Monotone in both, opposite ways: a slower objective reaches a higher NA
    // and does it at a faster working cone.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.NA).toBeGreaterThan(rows[i - 1]!.NA);
      expect(rows[i]!.F).toBeLessThan(rows[i - 1]!.F);
    }
    const span = (xs: number[]) => Math.max(...xs) / Math.min(...xs) - 1;
    expect(span(rows.map((r) => r.NA))).toBeGreaterThan(0.7); // 77%
    expect(span(rows.map((r) => r.F))).toBeGreaterThan(0.35); // 40%
    expect(span(rows.map((r) => r.F))).toBeLessThan(0.5);
    // The ratio is tighter than the aperture, and that is all it is.
    expect(span(rows.map((r) => r.NA)) / span(rows.map((r) => r.F))).toBeGreaterThan(1.8);
  });

  it("at the constructor's refusal NA the wavefront is 7.6 waves — 106× Maréchal (RIM)", () => {
    // The measurement that makes everything below an identity rather than a
    // ceiling. D8 read the refusal boundary as "the form survives to NA 0.1843";
    // the form is tens of times past diffraction-limited there and nearly twice
    // past its own Maréchal reach. Nothing optical happens at that NA.
    //
    // Two commits have since moved this boundary and neither moved it anywhere
    // useful. § 6b.5.6 took the fixed point's thin-lens SEED off it (0.184336 →
    // 0.196500) and § 6b.5.7 stopped the scan counting bendings that are not
    // lenses (→ 0.204273). The wavefront at the refusal went 3.45 → 5.59 → 7.57
    // waves. **Nothing usable was unlocked by either, and that is the honest
    // summary of both.**
    // MEASURED ON THE RIM, and § 6ai is why rather than inertia. Six waves out
    // the telecentric lens does not pass its own diaphragm — 36 of this grid's
    // rays are clipped — and an RMS over a clipped pupil is a different quantity
    // from the one Maréchal's criterion is stated on, so quoting it here would
    // compare a vignetted number against an unvignetted threshold. The rim's
    // stop IS its launch aperture, so it clips nothing at any NA and is the only
    // member of the pair that can carry this statement. Note what does NOT need
    // saying either way: the wall itself, 0.204273 under both placements to the
    // digit, because it is the solver's and contains no aperture (§ 6b.5.2).
    const wall = buildWall({});
    expect(wall).toBeCloseTo(0.204273, 5);
    const sigma = sigmaWaves(4, wall, RIM);
    expect(sigma).toBeGreaterThan(7.5);
    expect(sigma / MARECHAL).toBeGreaterThan(105);
    expect(wall / marechalReach(4)).toBeCloseTo(1.984, 2);
  }, SLOW);
});

describe("§ 6b.5.2 — the refusal boundary is the SOLVER's, and contains no aperture", () => {
  it("IDENTITY: the refusal ratio is aperture-free to 3 ULP across four decades", () => {
    // Why it must be: at a stated focal ratio every defaulted length in the
    // constructor is degree-1 homogeneous in D — the thickness floors are 0.1·D
    // and 0.06·D, the sag-driven thicknesses go as D²/f with f = D·F, and S_I
    // itself is ∝ h⁴ exactly. So the dimensionless lens does not change with
    // aperture at all, and the boundary is a pure ratio. § 6b.5.7 moved WHERE it
    // is (1.9175107 → 1.7397236 at infinity, 1.9042573 → 1.8372723 at s/f = 5)
    // without touching that: |c|·(D/2) is a pure ratio too.
    //
    // § 6p's distinction, landing on the OTHER side: the identity is algebraic
    // and NOT arithmetic. Most of these values are bitwise equal and one in each
    // set is 2–3 ULP away, because at the boundary the scan's sign detection
    // over its 2000 samples is decided by rounding — so a single bisection step
    // can flip and the last bits of the bracket differ. Pinned at the measured
    // 4 ULP rather than at a round epsilon, so the day it becomes 400 the rung
    // notices.
    for (const [sOverF, expected] of [[null, 1.7397236], [5, 1.8372723]] as const) {
      const walls = [1, 10, 100, 1000].map((D) => refusalRatio(sOverF, {}, D));
      for (const F of walls) expect(Number(ulpsApart(F, walls[0]!))).toBeLessThanOrEqual(4);
      expect(walls[0]).toBeCloseTo(expected, 6);
    }
    // …and it is a genuinely different number at a different conjugate, so the
    // agreement above is not simply insensitivity to everything.
    expect(Math.abs(refusalRatio(null) / refusalRatio(5) - 1)).toBeGreaterThan(5e-3);
  });

  it("FALSIFIED by § 6b.5.7: the thickness curve the locus used to live on is gone", () => {
    // This rung used to read "homogeneous of degree 1 in the STATED thickness
    // pair" — scale both thicknesses by k and the boundary ratio scaled by k, to
    // 1e-8 — with a negative control beside it showing the two elements were not
    // interchangeable (crown ×1.86, flint ×1.15 for a doubling). Both were true,
    // and both were about a boundary set by a THIRD ROOT whose arrival depends on
    // the thick-lens Seidel sums, hence on how much glass there is.
    //
    // Rejecting non-physical bendings moved the boundary onto |c|·(D/2) = 1,
    // which is a statement about curvature and aperture and not about thickness
    // at all. So the locus stops living in (t_crown/f, t_flint/f): doubling and
    // tripling either or both now moves it by under 2%, where it used to move it
    // by exactly the factor. The residual is the thick-lens sums' own weak pull
    // on where the roots sit, and it is not homogeneous in anything.
    const atWall = achromaticObjective({
      apertureMm: 10,
      focalRatio: refusalRatio(5.02),
      objectDistanceMm: 5.02 * 10 * refusalRatio(5.02),
    });
    const tc = atWall.crownThicknessMm;
    const tf = atWall.flintThicknessMm;
    const base = refusalRatio(5.02, { crownThicknessMm: tc, flintThicknessMm: tf });
    const moved = ([kc, kf]: readonly [number, number]) =>
      refusalRatio(5.02, { crownThicknessMm: tc * kc, flintThicknessMm: tf * kf }) / base;
    for (const k of [[2, 1], [3, 1], [1, 2], [2, 2], [3, 3]] as const) {
      expect(Math.abs(moved(k) - 1)).toBeLessThan(0.02);
    }
    // The two literals the old rungs pinned, to make the falsification explicit:
    // a crown doubling used to be ×1.86 and a flint doubling ×1.15.
    expect(moved([2, 1])).toBeCloseTo(0.98996, 4);
    expect(moved([1, 2])).toBeCloseTo(0.99340, 4);
  }, SLOW);
});

describe("§ 6b.5.3 — the ghost at the window's edge, now rejected before it counts", () => {
  /**
   * `achromaticObjective` scans c₁ over ±3·span for sign changes of S_I and
   * refuses any count but two — of LENSES, since § 6b.5.7. With the thicknesses
   * STATED there is no second pass, so the scan below is the constructor's own,
   * and it is checked against the constructor's verdict rather than assumed to
   * be it. The window is a parameter here so the rung can ask what the literal
   * `3` in `solveBendings` is worth, which is the whole point of the filter.
   */
  const D = 10;
  const S_OVER_F = 5.02;
  const atDefaultWall = achromaticObjective({
    apertureMm: D,
    focalRatio: refusalRatio(S_OVER_F),
    objectDistanceMm: S_OVER_F * D * refusalRatio(S_OVER_F),
  });
  const crownMm = atDefaultWall.crownThicknessMm;
  const flintMm = atDefaultWall.flintThicknessMm;

  const scan = (F: number, window = 3) => {
    const f = D * F;
    const form = cementedDoubletForm({ apertureMm: D, focalLengthMm: f });
    const s1Of = (c1: number): number =>
      seidelSums(form.build(form.curvaturesAt(c1), { crownMm, flintMm, lastMm: 0 }), LAMBDA, {
        marginalHeightMm: D / 2,
        objectDistanceMm: S_OVER_F * f,
      }).s1;
    const span = Math.abs(form.dc1) + Math.abs(form.dc2);
    const lo = -window * span;
    const hi = window * span;
    const steps = 2000;
    const roots: number[] = [];
    let prevC = lo;
    let prevS = s1Of(lo);
    for (let i = 1; i <= steps; i++) {
      const c = lo + ((hi - lo) * i) / steps;
      const s = s1Of(c);
      if (prevS * s < 0) {
        let a = prevC;
        let b = c;
        let fa = prevS;
        for (let k = 0; k < 80; k++) {
          const mid = 0.5 * (a + b);
          const fm = s1Of(mid);
          if (fa * fm < 0) b = mid;
          else {
            a = mid;
            fa = fm;
          }
        }
        roots.push(0.5 * (a + b));
      }
      prevC = c;
      prevS = s;
    }
    return roots.map((c1) => ({
      c1,
      overSpan: c1 / span,
      slope: Math.max(...form.curvaturesAt(c1).map((c) => Math.abs(c) * (D / 2))),
    }));
  };
  const lenses = (F: number, window = 3) => scan(F, window).filter((r) => r.slope < 1);

  const builds = (F: number): boolean => {
    try {
      achromaticObjective({
        apertureMm: D,
        focalRatio: F,
        objectDistanceMm: S_OVER_F * D * F,
        crownThicknessMm: crownMm,
        flintThicknessMm: flintMm,
      });
      return true;
    } catch {
      return false;
    }
  };
  /**
   * The wall AT THESE STATED THICKNESSES, which is the boundary the scan below
   * reconstructs. It is 0.5% off the defaulted-thickness one — since § 6b.5.7 the
   * locus barely depends on thickness, but "barely" is not "not at all"
   * (§ 6b.5.2), and reconstructing one boundary while testing against the other
   * is exactly the circularity these rungs exist to avoid.
   */
  const wallF = ((): number => {
    let lo = 0.2;
    let hi = 12;
    for (let i = 0; i < 54; i++) {
      const mid = 0.5 * (lo + hi);
      if (builds(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  })();

  it("ANTI-CIRCULARITY: it is now the LENS count that flips 2→1 across the verdict", () => {
    // The rung this replaces watched the raw count flip 2→3, which was the right
    // reconstruction of the old solver and is the wrong one now. What decides is
    // the count after the filter, and the raw count does something else entirely
    // on the way past the wall — it stays at 2, because the ghost is only one of
    // the roots that has stopped being a lens.
    for (const F of [wallF * 1.2, wallF * 1.01]) {
      expect(builds(F)).toBe(true);
      expect(lenses(F)).toHaveLength(2);
    }
    for (const F of [wallF * 0.999, wallF * 0.9, wallF * 0.7]) {
      expect(builds(F)).toBe(false);
      expect(lenses(F).length).toBeLessThan(2);
    }
    // 2 → 1 → 0, which is why § 6b.5.5's "unreachable" count-1 branch is
    // reachable now and why its cause is the aperture.
    expect(lenses(wallF * 0.999)).toHaveLength(1);
    expect(lenses(wallF * 0.7)).toHaveLength(0);
  });

  it("the boundary is now GEOMETRIC: a real bending arrives at |c|·(D/2) = 1", () => {
    // What the wall IS after the filter, and it is a different kind of thing
    // from what it was. Just inside, the steeper of the two SA-null bendings is
    // a hemisphere all but exactly; just outside, it has passed one and is not a
    // surface any glass can be ground to. So this wall joins § 6e.4's NA 1.411
    // and § 6l's 1.3347 in the taxonomy's GEOMETRIC column, where before it sat
    // with § 6q's 0.899·f_e as a solver locus.
    const steepestLens = (F: number) => Math.max(...lenses(F).map((r) => r.slope));
    expect(steepestLens(wallF * 1.0001)).toBeGreaterThan(0.9999);
    expect(steepestLens(wallF * 1.0001)).toBeLessThan(1);
    // Just outside, that same bending has passed the hemisphere — it is the one
    // the filter drops, and dropping it is the whole refusal.
    const dropped = scan(wallF * 0.9999)
      .filter((r) => r.slope >= 1 && r.overSpan < 1)
      .map((r) => r.slope);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toBeGreaterThan(1);
    expect(dropped[0]).toBeLessThan(1.001);
  });

  it("the ghost is still there, and the constructor now BUILDS with it in the scan", () => {
    // The sharpest statement of what changed. The scan's third root is five
    // times hemispherical and comes in over the window's edge at |c₁|/span = 3⁻,
    // exactly as § 6b.5 measured — but its arrival is no longer an event: it turns
    // up while the design is still comfortably buildable, and the constructor
    // returns a lens with a ghost sitting in its own scan.
    for (const k of [1.05, 1.01]) {
      const raw = scan(wallF * k);
      expect(raw).toHaveLength(3);
      const ghost = raw.find((r) => r.slope > 3)!;
      expect(ghost.slope).toBeGreaterThan(4.9);
      expect(ghost.overSpan).toBeGreaterThan(2.7);
      expect(ghost.overSpan).toBeLessThan(3);
      expect(builds(wallF * k)).toBe(true);
    }
    // It enters between 1.1·F* and 1.05·F* — above the wall, where the old solver
    // would have refused — and migrates inward as the ratio falls, so it is a
    // window crossing and not a coalescence of the real pair.
    expect(scan(wallF * 1.1)).toHaveLength(2);
    expect(scan(wallF * 0.7).find((r) => r.slope > 3)!.overSpan)
      .toBeLessThan(scan(wallF * 1.05).find((r) => r.slope > 3)!.overSpan);
  });

  it("IDENTITY: with it rejected, the WINDOW CONSTANT is inert — ±2, ±3, ±5 agree", () => {
    // The rung § 6b.5.7 exists to produce. F* used to be set by the literal 3 in
    // `solveBendings`, because the boundary was where the ghost entered and a
    // wider window would have admitted it sooner. Filtered, the surviving root
    // set does not depend on the window at all: the real bendings sit at
    // |c₁|/span ≈ 0.12–0.25, and everything the window adds or removes beyond ±2
    // is not a lens. The agreement is to 1e-14 relative rather than bitwise: the
    // scan's sample grid is laid over the window, so a different window brackets
    // each root from a different pair of samples and the bisection's last bit
    // can differ. Same roots, same count, reached along a different path — which
    // is § 6p's algebraic-not-arithmetic distinction once more.
    for (const F of [wallF * 1.01, wallF * 0.999, wallF * 0.9]) {
      const three = lenses(F, 3).map((r) => r.c1);
      for (const window of [2, 5]) {
        const other = lenses(F, window).map((r) => r.c1);
        expect(other).toHaveLength(three.length);
        for (let i = 0; i < three.length; i++) {
          expect(Math.abs(other[i]! / three[i]! - 1)).toBeLessThan(1e-14);
        }
      }
    }
    // …while the RAW count still moves with it, which is what makes the identity
    // above a statement about the filter and not about the scan being narrow.
    expect(scan(wallF * 0.999, 2)).toHaveLength(2);
    expect(scan(wallF * 0.999, 3)).toHaveLength(3);
    expect(scan(wallF * 0.999, 5)).toHaveLength(3);
    // …and the count that DECIDES does not move with it.
    for (const window of [2, 3, 5]) expect(lenses(wallF * 0.999, window)).toHaveLength(1);
  });
});

describe("§ 6b.5.4 — the wall was the fixed point's SEED, and § 6b.5.6 moved it off it", () => {
  /**
   * The DIN constructor USED TO seed its fixed point from the thin lens and then
   * refuse on what that seed sized: the object at a = f(1 + 1/M), the image at
   * b = f(1 + M), the glass over the stop the object distance implies,
   * D = 2·a·tan u·k. The focal length cancels out of f/D, and what was left was
   *
   *     tan u_wall = 1 / (2·k·(1 + 1/M)·F*(s/f)),   s/f = 1 + M   (flint first)
   *                                                       1 + 1/M (crown first)
   *
   * — a closed form in M and k alone, which predicted the engine's own wall to
   * 1e-11. That exactness was the finding, because the CONVERGED design at that
   * NA sat ~6% inside the boundary: the constructor was refusing apertures it
   * could in fact deliver, and the wall was decided before anything had looked
   * at the lens being built.
   *
   * § 6b.5.6 fixed that, so this section keeps the closed form as its NEGATIVE
   * CONTROL rather than its headline: the seed's prediction now misses, low, by
   * the 2.9%–9.6% the seed was costing. What replaces it is exact but no longer
   * predictive — see the identity below.
   */
  const predict = (M: number, orientation: "flintFirst" | "crownFirst", over: Record<string, unknown> = {}) => {
    const sOverF = orientation === "flintFirst" ? 1 + M : 1 + 1 / M;
    const tanU = 1 / (2 * GLASS_MARGIN * (1 + 1 / M) * refusalRatio(sOverF, over));
    return tanU / Math.sqrt(1 + tanU * tanU);
  };

  it("FALSIFIED: the seed's closed form now misses the wall, low, by 2.4% to 10.4%", () => {
    // The rung this replaces asserted `predict/measured - 1 < 1e-11` — which was
    // ONE-SIDED, and would have gone on passing at any wall the seed fix moved
    // the constructor to, since a prediction that falls short satisfies it
    // vacuously. That is exactly the hazard § 6b.5's "not yet pinned" item named,
    // caught here in its own file: the test is two-sided now, and what it pins is
    // the MISS.
    const misses = [];
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      for (const M of [4, 10, 20, 40]) {
        const miss = predict(M, orientation) / measured(M, orientation) - 1;
        // Low, every time: the seed sizes MORE glass than the design it is
        // converging to needs, so the aperture it walls out at is smaller.
        expect(miss).toBeLessThan(-0.02);
        expect(miss).toBeGreaterThan(-0.12);
        misses.push(miss);
      }
    }
    expect(misses[0]).toBeCloseTo(-0.0659, 3); // flint first, 4×
    expect(misses[3]).toBeCloseTo(-0.1037, 3); // flint first, 40×
    expect(misses[4]).toBeCloseTo(-0.0242, 3); // crown first, 4×
    // …and it is not a constant offset that could be absorbed into k: the miss
    // runs with M and with orientation, which is what makes it the seed's error
    // and not a rescaling.
    expect(Math.abs(misses[3]! / misses[4]!)).toBeGreaterThan(3);
  }, SLOW);

  it("IDENTITY: the wall is the CONVERGED design's own refusal ratio, to 1e-9", () => {
    // What replaces the closed form. The constructor now walls out exactly where
    // the lens it has actually converged to meets `achromaticObjective`'s
    // aperture-free refusal ratio, evaluated at the conjugate that lens is
    // solved at: f/(2·a·tan u·k) = F*(s/f), with BOTH a and s read off the fixed
    // point. It holds to parts in 10¹³ at every magnification and both
    // orientations.
    //
    // WHAT THAT COSTS, said out loud: this is a self-consistency identity and no
    // longer a prediction. The old form gave the wall from M, k and the glass
    // pair alone, with nothing from the built lens; this one has to build the
    // lens first, because a and s ARE the fixed point's output. The section
    // keeps its exactness and loses its closed form, and that is the trade
    // § 6b.5.6 made deliberately.
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      for (const M of [4, 10, 20, 40]) {
        const NA = measured(M, orientation);
        const o = finiteConjugateObjective({ magnification: M, numericalAperture: NA, orientation });
        const tanU = NA / Math.sqrt(1 - NA * NA);
        const converged =
          o.focalLengthMm / (2 * o.airEquivalentObjectDistanceMm * tanU * GLASS_MARGIN);
        const sOverF = o.doublet.objectDistanceMm! / o.focalLengthMm;
        expect(Math.abs(converged / refusalRatio(sOverF) - 1)).toBeLessThan(1e-9);
      }
    }
  }, SLOW);

  it("…and on a second glass pair, whose ORDER against N-BK7/F2 § 6b.5.7 reversed", () => {
    const over = { crownMedium: "FUSED-SILICA" };
    for (const M of [4, 40]) {
      const miss = predict(M, "flintFirst", over) / measured(M, "flintFirst", over) - 1;
      expect(miss).toBeLessThan(-0.02);
      expect(miss).toBeGreaterThan(-0.13);
    }
    // The two pairs genuinely differ — but which one reaches further changed
    // when the boundary's mechanism did. Against the scan window, silica/F2 got
    // 6% MORE aperture than N-BK7/F2 before the ghost arrived; against
    // |c|·(D/2) = 1 it gets 7% LESS, because what is being compared is now how
    // steeply each pair has to bend rather than when a root crosses a window.
    expect(measured(4, "flintFirst", over) / measured(4, "flintFirst")).toBeCloseTo(0.932, 2);
  }, SLOW);

  it("WITNESS: the wall is these NUMBERS, and a re-seed has to edit them", () => {
    // Everything else in this section is measured against the LIVE constructor:
    // `predict` reads `refusalRatio` and `measured` bisects the same code, so a
    // change to the seed would move both together and the rungs would stay green
    // while the boundary they describe went somewhere else. These literals are
    // the only thing in § 6b.5 that a re-seed cannot satisfy by agreeing with
    // itself — they are absolute, and the commit that moves the wall must edit
    // them in its own diff.
    //
    // § 6b.5.6 is that commit, and this is the edit. What the seed cost, in the
    // currency the ladder measures it in — the numbers on the right are the ones
    // this file pinned one commit ago:
    //
    //     flint first  4× 0.2042726 (0.1843357 → 0.1965000 → here)
    //                 10× 0.2434783 (0.2078672 → 0.2265647 → here)
    //                 20× 0.2600553 (0.2169474 → 0.2386541 → here)
    //                 40× 0.2691756 (0.2217549 → 0.2451735 → here)
    //     crown first  4× 0.1715225 (0.1792105 → 0.1845669 → here — DOWN)
    //                 40× 0.2064431 (0.2113516 → 0.2233784 → here — DOWN)
    //
    // Two commits have moved them: § 6b.5.6 took the seed off the boundary and
    // § 6b.5.7 rejected non-physical bendings before counting. The crown-first
    // rows move the OTHER way under the second, and that is a real refusal of
    // designs that used to build — measured and accounted for in § 6b.5.7.
    // Every aperture on either side of either move is deep inside the region
    // § 6b.5.1 disqualified on Maréchal, which is the point: this bought
    // attribution, not aperture.
    const walls = [
      [4, "flintFirst", 0.2042726],
      [10, "flintFirst", 0.2434783],
      [20, "flintFirst", 0.2600553],
      [40, "flintFirst", 0.2691756],
      [4, "crownFirst", 0.1715225],
      [10, "crownFirst", 0.1930702],
      [20, "crownFirst", 0.2017402],
      [40, "crownFirst", 0.2064431],
    ] as const;
    for (const [M, orientation, expected] of walls) {
      expect(measured(M, orientation)).toBeCloseTo(expected, 6);
    }
    // A second glass pair, and a coverslip — the slip matters because with a
    // target ΣS_I ≠ 0 the refusal ratio is NOT aperture-free (S_I ∝ h⁴ while the
    // plate's contribution is absolute), so § 6b.5.2's identity and § 6b.5.4's
    // closed form do not reach this row. It is pinned as a bare measurement.
    const silica = { crownMedium: "FUSED-SILICA" };
    expect(measured(4, "flintFirst", silica)).toBeCloseTo(0.1903894, 6);
    expect(measured(40, "flintFirst", silica)).toBeCloseTo(0.2503027, 6);
    expect(measured(4, "flintFirst", { coverslip: { thicknessMm: 0.17 } })).toBeCloseTo(0.2067345, 6);
  }, SLOW);

  it("WITNESS: and the design at the wall is now one the SEED's arithmetic refuses", () => {
    // The same measurement one commit ago read the other way round. Then: the
    // converged design at the wall sat 6% INSIDE the refusal ratio, so the
    // constructor was walling out lenses it could deliver. Now the converged
    // design sits ON the boundary — f/1.8354 against F* = 1.8354 — and it is the
    // SEED that is outside, asking for f/1.711 where the solver's locus is
    // f/1.835. The wall did not move because the solver changed its mind about
    // any focal ratio; it moved because the ratio being presented to it is now
    // the design's and not the seed's.
    const M = 4;
    const NA = measured(M, "flintFirst");
    const objective = finiteConjugateObjective({ magnification: M, numericalAperture: NA });
    const f = objective.focalLengthMm;
    const seedA = f * (1 + 1 / M);
    const tanU = NA / Math.sqrt(1 - NA * NA);
    const convergedA = objective.airEquivalentObjectDistanceMm;
    expect(convergedA / seedA).toBeCloseTo(0.9324841, 6);
    // What the seed would have presented, and what the design does present.
    expect(f / (2 * seedA * tanU * GLASS_MARGIN)).toBeCloseTo(1.7114981, 6);
    expect(f / (2 * convergedA * tanU * GLASS_MARGIN)).toBeCloseTo(1.8354180, 6);
    // And the seed's is well past the locus, which is why this design used to be
    // refused: 6.8% of ratio, on the wrong side.
    const sOverF = objective.doublet.objectDistanceMm! / f;
    expect(f / (2 * seedA * tanU * GLASS_MARGIN) / refusalRatio(sOverF)).toBeLessThan(0.94);
  });

  it("the optical tube length cancels EXACTLY — f is not in the closed form", () => {
    // D8 measured this as three equal numbers; here it is an identity, and the
    // reason is that f cancels between the seed's aperture and its focal ratio.
    const walls = [100, 150, 250].map((opticalTubeLengthMm) =>
      measured(4, "flintFirst", { opticalTubeLengthMm }),
    );
    for (const w of walls) expect(w).toBe(walls[0]);
  }, SLOW);
});

describe("§ 6b.5.5 — one message, two causes, and now the sentence tells them apart too", () => {
  it("a glass-pair failure reports 0 roots at ANY focal ratio, and keeps its sentence", () => {
    // CaF₂/F2 is § 5k's pair and genuinely admits no classical solution: the
    // count is zero, and slowing the lens by 5× does not change that. This is
    // the branch on which the original sentence was true, so it is unchanged.
    for (const focalRatio of [10, 50]) {
      const message = messageFrom(() =>
        achromaticObjective({ apertureMm: 10, focalRatio, crownMedium: "CAF2", flintMedium: "F2" }),
      );
      expect(message).toMatch(/found 0 —/);
      expect(message).toMatch(/this glass pair does not admit the classical doublet solution/);
    }
  });

  it("an aperture failure reports the LENS count, and the SAME pair builds when slowed", () => {
    // Which falsifies the sentence the message USED to print on this branch —
    // the glass pair does admit the classical solution, at a ratio 20% slower.
    // Since § 6b.5.7 the count is of lenses and both numbers are printed: at
    // f/1.5 the scan still finds its two bendings and neither is a surface.
    expect(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.5 })))
      .toMatch(/found 2, of which 1 is a lens —/);
    expect(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.2 })))
      .toMatch(/found 2, of which 0 are lenses —/);
    expect(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.8 }))).toBe("builds");
  });

  it("…and the message now says APERTURE there, and never says it on the 0-root branch", () => {
    // The fix this section's own heading used to describe as not done. The
    // discriminator is the count, which the engine already had; what changes is
    // that the prose is derived from it instead of asserted over it. (When this
    // landed nothing about which designs are refused moved, the extra root being
    // reported rather than rejected; § 6b.5.7 is the commit that went on to
    // reject it, and the sentence below survived that unchanged.)
    const aperture = messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.5 }));
    expect(aperture).toMatch(/binding here is the APERTURE and not the glass pair/);
    expect(aperture).not.toMatch(/this glass pair does not admit/);
    const glass = messageFrom(() =>
      achromaticObjective({ apertureMm: 10, focalRatio: 10, crownMedium: "CAF2", flintMedium: "F2" }),
    );
    expect(glass).not.toMatch(/APERTURE/);
  });

  it("…and it counts the lenses rather than assuming how many there are", () => {
    // The clause is measured in the failing call, which matters because the
    // count is NOT fixed. Just past the wall one of the two SA-null bendings has
    // reached a hemisphere and the other has not; drive the ratio far enough
    // below and neither is a surface. A message hard-coding either case would be
    // wrong at the other, and § 6b.5.7 made this the branch that carries the
    // count-1 case § 6b.5.5 had to leave homeless.
    const counts = (message: string): [number, number] => {
      const m = /found (\d+), of which (\d+) (?:is a lens|are lenses)/.exec(message)!;
      return [Number(m[1]), Number(m[2])];
    };
    const D = 10;
    const S_OVER_F = 5.02;
    const justBelow = refusalRatio(S_OVER_F) * 0.999;
    const atWall = messageFrom(() =>
      achromaticObjective({
        apertureMm: D,
        focalRatio: justBelow,
        objectDistanceMm: S_OVER_F * D * justBelow,
      }),
    );
    expect(counts(atWall)).toEqual([2, 1]);
    expect(counts(messageFrom(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.2 })))).toEqual([2, 0]);
    // The steepness is measured too, and just past the wall it is a hemisphere
    // to two decimals — which is what "the boundary is geometric now" means read
    // off the error message.
    expect(atWall).toMatch(/\(1\.00× at the steepest surface\)/);
  });

  it("a glass-pair refusal is NOT retried — it comes back by a different type", () => {
    // § 6b.5.6's retry has to know which refusals an aperture can answer. The
    // count is the discriminator the message already used, and now the ERROR
    // TYPE comes off the same count: anything the scan FOUND, with fewer than
    // two of them lenses, is `DoubletApertureRefusal` and is retryable; finding
    // nothing is the glass pair, is the same answer at f/50, and stays an
    // ordinary Error so a caller laddering its aperture cannot burn a bending
    // scan per step on it.
    const glass = catchError(() =>
      achromaticObjective({ apertureMm: 10, focalRatio: 10, crownMedium: "CAF2", flintMedium: "F2" }),
    );
    expect(glass.message).toMatch(/found 0 —/);
    expect(glass instanceof DoubletApertureRefusal).toBe(false);
    const aperture = catchError(() => achromaticObjective({ apertureMm: 10, focalRatio: 1.2 }));
    expect(aperture.message).toMatch(/of which 0 are lenses/);
    expect(aperture instanceof DoubletApertureRefusal).toBe(true);
    // …and the type reaches the DIN constructor intact: an impossible glass pair
    // is refused there with the glass sentence, not with an aperture one.
    const din = catchError(() =>
      finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, crownMedium: "CAF2", flintMedium: "F2" }),
    );
    expect(din.message).toMatch(/this glass pair does not admit the classical doublet solution/);
    expect(din instanceof DoubletApertureRefusal).toBe(false);
  });

  it("§ 6q's Plössl wall is this same refusal, which is why it is scale-invariant", () => {
    // § 6q.9 bisected the Plössl's clear-aperture wall and found it "exactly
    // scale-invariant from f_e 15 to 50". That invariance is § 6b.5.2's identity
    // seen through a different constructor: the same refusal, on a form
    // specified entirely in ratios. The clear aperture maps onto the doublets'
    // apertures through the Plössl's own layout, which nothing here measures, so
    // this pins the mechanism and not the number — and the number moved with the
    // mechanism, 0.899195 → 0.9615248·f_e, when § 6b.5.7 stopped counting the
    // ghost.
    for (const [focalLengthMm, clearApertureMm] of [[25, 24.5], [50, 49]] as const) {
      expect(messageFrom(() => plosslEyepiece({ focalLengthMm, clearApertureMm })))
        .toMatch(/of which 1 is a lens —/);
    }
    expect(messageFrom(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 24 }))).toBe("builds");
  });
});

describe("§ 6b.5.6 — the seed is no longer the wall, and what that did and did not buy", () => {
  /**
   * The fix § 6b.5 left open. `finiteConjugateObjective` sizes its glass off an
   * object distance it is still converging, and the thin-lens seed's is the
   * worst that distance ever is — some 6% too far out — so the first pass asked
   * `achromaticObjective` for a focal ratio the design being converged to never
   * needed. A refusal there was being read as a verdict.
   *
   * It is now read as an overshoot: the aperture is held back only as far as it
   * takes to get a lens to read the next object distance off, asked for in FULL
   * again every pass, and the fixed point may only close on a pass that built at
   * it. The hold-back is then bisected back toward 1 as the geometry settles,
   * because a held-back lens reports the specimen further out than it is
   * (∂ln a/∂ln D ≈ −0.1 flint-first to −0.2 crown-first, measured) and that bias
   * would otherwise BE the new wall.
   *
   * What it buys is attribution, not aperture — every rung below is either an
   * identity about the boundary or an external one saying the region it opened
   * is optically worthless.
   */

  it("EXTERNAL: everything the fix unlocked is 48–78× past Maréchal (RIM)", () => {
    // The honest headline, on the same criterion § 6b.5.1 uses. The band this
    // commit opened — 0.184336 to 0.196500, the seed's wall to the converged
    // design's — is entirely inside the region the wavefront has already
    // disqualified: 3.45 waves at the bottom of it, 5.59 at the top, against
    // Maréchal's 1/14. No usable objective became available, and the ladder
    // should not be read as saying one did. (The band is quoted as literals
    // rather than read from `buildWall`, which § 6b.5.7 has since moved further
    // out — this rung is about what the SEED fix opened.)
    const opened = [0.184336, 0.190418, 0.196499];
    for (const NA of opened) {
      expect(sigmaWaves(4, NA, RIM) / MARECHAL).toBeGreaterThan(45);
    }
    expect(sigmaWaves(4, opened[0]!, RIM)).toBeCloseTo(3.4507, 3);
    expect(sigmaWaves(4, opened[2]!, RIM)).toBeGreaterThan(5.5);
    // …and the diffraction-limited reach itself did not move at all, which is
    // the negative control: this touched the refusal, not the optics.
    expect(marechalReach(4)).toBeCloseTo(0.10295, 4);
  });

  it("the lenses in the opened band are genuine solutions, not returned objects", () => {
    // A wall that moves because the constructor got laxer would be worse than
    // the wall. These are the two guards § 6b.1 put on the fixed point, read at
    // apertures that used to be refused outright: the bending is solved for the
    // conjugate the lens is USED at, and ΣS_I is null where it is used.
    for (const NA of [0.185, 0.19, 0.1955]) {
      const o = finiteConjugateObjective({ magnification: 4, numericalAperture: NA });
      // GLASS-relative: since § 6ai the last vertex is the diaphragm, so the
      // image distance is short of the frame the bending was solved in by the
      // back focal distance (`stopDistanceMm`, which is 0 on the rim).
      expect(o.doublet.objectDistanceMm).toBeCloseTo(o.imageDistanceMm + o.stopDistanceMm, 6);
      expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(1e-12);
      // The glass is the size the PENCIL implies at the CONVERGED object
      // distance, not at any held-back one — the retry keeps nothing. Keyed to
      // the pencil rather than to `stopRadiusMm`, which telecentric is f·tan u
      // and would make this identity a statement about the focal length.
      const tanU = NA / Math.sqrt(1 - NA * NA);
      expect(o.pencilRadiusAtGlassMm).toBeCloseTo(o.airEquivalentObjectDistanceMm * tanU, 12);
    }
  });

  it("the retry is not slack: past the wall it still refuses, with the solver's message", () => {
    // The property that makes this a fix rather than a loosening. A design whose
    // CONVERGED geometry is past `achromaticObjective`'s locus is still refused,
    // and the sentence is the solver's own — the aperture one, since the count
    // is 3.
    const wall = buildWall({});
    for (const k of [1.0001, 1.02, 1.2]) {
      const message = messageFrom(() =>
        finiteConjugateObjective({ magnification: 4, numericalAperture: wall * k }),
      );
      expect(message).toMatch(/found \d+, of which \d+ (?:is a lens|are lenses) —/);
      expect(message).toMatch(/binding here is the APERTURE and not the glass pair/);
    }
  }, SLOW);

  it("NEGATIVE CONTROL: ordinary apertures are untouched — the 4×/0.10 is bit-for-bit", () => {
    // The retry only ever engages on a refusal, so a design that built before
    // takes the identical path: first pass, full aperture, same lens. The
    // catalogued member's headline numbers are pinned here as well as in
    // § 6b.1–.4 so that a future change to the hold-back cannot quietly move a
    // lens nobody is bisecting.
    const o = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    expect(o.workingFocalRatio).toBeCloseTo(4.0755218, 7);
    expect(o.objectDistanceMm).toBeCloseTo(45.7757694, 7);
    expect(o.doublet.curvatures[0]).toBeCloseTo(0.0467369, 7);
  });
});

describe("§ 6b.5.7 — the scan window's `3`, and the boundary it stops deciding", () => {
  /**
   * § 6b.5's last open item. S_I(c₁) is a paraxial polynomial and does not know
   * what glass can be bent to, so past the wall it grows a root that is five
   * times hemispherical and is not a surface. Counting it made the refusal a
   * property of the SCAN WINDOW — a wider ±span would have admitted it sooner —
   * and made the message's own count mean something other than what it said.
   *
   * `solveBendings` now rejects bendings with |c|·(D/2) ≥ 1 before it counts,
   * the same sanity filter `designs/lister` applies to the roots of its
   * two-dimensional scan. § 6b.5.3 carries the identity that falls out of it:
   * the surviving root set is bitwise identical at windows of ±2, ±3 and ±5.
   * What is left here is where the boundary went, and what that cost.
   */

  it("F* MOVES, and the boundary changes kind with it", () => {
    // The number the whole section is organised around. Both conjugates get
    // faster, by different amounts, because what binds is no longer a root
    // crossing a window but a real bending reaching a hemisphere.
    expect(refusalRatio(null)).toBeCloseTo(1.7397236, 6); // was 1.9175107
    expect(refusalRatio(5)).toBeCloseTo(1.8372723, 6); // was 1.9042573
  }, SLOW);

  it("the DIN walls move OUT flint-first and IN crown-first — and the second is a loss", () => {
    // The asymmetry is the finding, and it is not a wash. Flint-first the ghost
    // was arriving before either real bending had run out of glass, so dropping
    // it buys aperture: 0.196500 → 0.204273 at the 4×, 0.245173 → 0.269176 at
    // the 40×. Crown-first the scan was already finding one bending that is not
    // a surface, and the constructor was building on the pair anyway — picking
    // the physical one by cancellation and never noticing that its `branch:
    // "steep"` alternative could not be made. Those designs are refused now:
    // 0.184567 → 0.171523 at the 4×.
    expect(measured(4, "flintFirst") / 0.1965000).toBeGreaterThan(1.03);
    expect(measured(40, "flintFirst") / 0.2451735).toBeGreaterThan(1.09);
    expect(measured(4, "crownFirst") / 0.1845669).toBeLessThan(0.94);
    expect(measured(40, "crownFirst") / 0.2233784).toBeLessThan(0.93);
  }, SLOW);

  it("EXTERNAL: the band gained is 78–106× Maréchal, and the band lost is worse than 41× (RIM)", () => {
    // Both directions on the external criterion, because a commit that refuses
    // designs has to say what it refused. Everything gained sits past 7 waves of
    // wavefront error, and the diffraction-limited reach — the only number here
    // that is about optics — does not move at either end.
    expect(sigmaWaves(4, 0.196499, RIM) / MARECHAL).toBeGreaterThan(77);
    expect(sigmaWaves(4, buildWall({}) * 0.9999, RIM) / MARECHAL).toBeGreaterThan(105);
    expect(marechalReach(4)).toBeCloseTo(0.10295, 4);

    // The band LOST cannot be measured where it was lost — those designs do not
    // build any more, which is the point of the commit — so it is bounded from
    // below instead. σ rises monotonically with NA (§ 6b.5.1 measures the order as
    // NA^6.2), so the whole refused band 0.1715–0.1846 is worse than its bottom
    // end, and its bottom end is the new crown-first wall.
    const lost = { orientation: "crownFirst", ...RIM };
    const bottom = sigmaWaves(4, measured(4, "crownFirst") * 0.9999, lost);
    expect(bottom).toBeCloseTo(2.9425, 3);
    expect(bottom / MARECHAL).toBeGreaterThan(41);
    const rising = [0.14, 0.16, 0.1715].map((NA) => sigmaWaves(4, NA * 0.9999, lost));
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThan(rising[i - 1]!);
    // …and even well BELOW the refused band the form is nine times past
    // diffraction-limited, so nothing usable sits anywhere near it.
    expect(rising[0]! / MARECHAL).toBeGreaterThan(9);
  }, SLOW);

  it("what the crown-first band lost was a design with only ONE of its pair a lens", () => {
    // The mechanism of the loss, stated so it is not mistaken for strictness for
    // its own sake. In that band the scan finds its two SA-null bendings and one
    // of them is past a hemisphere — so the classical premise the constructor
    // implements, TWO bendings to choose between on cancellation, is not met.
    // The refusal names the aperture and prints both counts.
    const message = messageFrom(() =>
      finiteConjugateObjective({ magnification: 4, numericalAperture: 0.18, orientation: "crownFirst" }),
    );
    expect(message).toMatch(/found 2, of which 1 is a lens —/);
    expect(message).toMatch(/binding here is the APERTURE and not the glass pair/);
  });

  it("the refusal stays MONOTONE in the focal ratio, which every bisection assumes", () => {
    // `refusalRatio` here, `measureApertureWall` in the app and `buildWall`
    // above all bracket a boundary by bisection, which is only a boundary if the
    // verdict does not come back. Checked over a factor of twelve in ratio at
    // two conjugates — the ghost's steepness grows as the ratio falls, so
    // nothing re-enters from above.
    for (const sOverF of [5.02, 1.2]) {
      const wallF = refusalRatio(sOverF);
      for (const k of [3, 2, 1.5, 1.1, 1.001]) {
        expect(messageFrom(() => achromaticObjective({
          apertureMm: 10,
          focalRatio: wallF * k,
          objectDistanceMm: sOverF * 10 * wallF * k,
        }))).toBe("builds");
      }
      for (const k of [0.999, 0.9, 0.6, 0.25]) {
        expect(messageFrom(() => achromaticObjective({
          apertureMm: 10,
          focalRatio: wallF * k,
          objectDistanceMm: sOverF * 10 * wallF * k,
        }))).not.toBe("builds");
      }
    }
  }, SLOW);

  it("§ 6b.5.6's identity survives the move: the wall is still the design's own F*", () => {
    // The two fixes compose rather than interfering. § 6b.5.7 moved F*; the DIN
    // wall is still exactly where the converged design's own ratio meets it.
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      const NA = measured(4, orientation);
      const o = finiteConjugateObjective({ magnification: 4, numericalAperture: NA, orientation });
      const tanU = NA / Math.sqrt(1 - NA * NA);
      const converged =
        o.focalLengthMm / (2 * o.airEquivalentObjectDistanceMm * tanU * GLASS_MARGIN);
      expect(Math.abs(converged / refusalRatio(o.doublet.objectDistanceMm! / o.focalLengthMm) - 1))
        .toBeLessThan(1e-9);
    }
  }, SLOW);

  it("NEGATIVE CONTROL: ordinary apertures are untouched — the 4×/0.10 is bit-for-bit", () => {
    // Same control as § 6b.5.6's, for the same reason: a filter that changed
    // which root gets built at a working aperture would be a very different
    // commit from one that changes where the constructor says no.
    const o = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    expect(o.workingFocalRatio).toBeCloseTo(4.0755218, 7);
    expect(o.objectDistanceMm).toBeCloseTo(45.7757694, 7);
    expect(o.doublet.curvatures[0]).toBeCloseTo(0.0467369, 7);
  });
});
