import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { LINE_D, LINE_F, LINE_C, LINE_G, getMedium } from "../src/materials";
import { achromaticObjective } from "../src/designs/achromat";
import { apochromaticObjective } from "../src/designs/apochromat";
import {
  superachromaticObjective,
  cementedQuadrupletForm,
} from "../src/designs/superachromat";
import { telecentricStop, frontFocalDistance } from "../src/designs/telecentric";
import { seidelSums } from "../src/analysis/seidel";

/**
 * § 6ay — four united colours, one telecentric one.
 *
 * **The question §§ 6aq, 6at, 6av and 6aw all deferred, in the same words each
 * time:** *"whether four united colours actually give four telecentric ones —
 * § 6aq bounds the telecentric count by the turn count in FFD(λ), and uniting
 * four wavelengths is the precondition and not the conclusion."* § 6av built the
 * lens that makes it askable. This step asks it, and the answer is **no, and in
 * the direction nobody on this ladder predicted**: the superachromatic
 * quadruplet is telecentric at ONE wavelength, where the apochromatic triplet at
 * the same aperture and the same focal ratio is telecentric at three and the
 * achromatic doublet at two. One more united colour, two fewer telecentric ones.
 *
 * ## What the deferral got right, and the step it skipped
 *
 * The precondition holds exactly. Four united wavelengths make EFL(λ) − f a
 * function with four roots in the band, so by Rolle it has three interior turns,
 * and § 6ay.1 finds all three sitting one per gap between consecutive united
 * lines. That is the whole of what "one more glass, one more turn" claims, and
 * it is true.
 *
 * **The step it skipped is that telecentricity does not read EFL.** The stop is
 * at a front focal point where FFD(λ) equals the placement, and
 *
 *     FFD = −D/C   and   EFL = −1/C   so   FFD = EFL · D
 *
 * where C and D are the tail's own ray-transfer elements. The chromatic solve
 * constrains C — that is what "the focal length takes one value at four
 * wavelengths" means — and says **nothing whatever about D**. D is the element
 * the principal planes live in, it is 1 for a thin lens, and every millimetre of
 * glass moves it. On this quadruplet it is 0.9337 and it drifts 4.97e−4 across
 * the band, while the corrected EFL varies by 2.6e−15 at the united lines. The
 * curve telecentricity reads is therefore not the corrected one: it is the
 * corrected one multiplied by an uncorrected, monotone factor — and over the
 * span the four united lines cover, that factor carries FFD 61.9× further than
 * the corrected EFL's own ripple ever bends it back (§ 6ay.7).
 *
 * ## Why the fourth glass makes it worse rather than better
 *
 * § 6at.2's conditioning is the whole story, arriving from an unexpected side.
 * A four-glass split needs element powers ~12.3× the total where the triplet's
 * are ~2.5× (§ 6av), and D − 1 is built out of exactly those powers and the
 * separations between them. So the fourth glass shrinks the quantity it corrects
 * and inflates the quantity telecentricity actually reads, and § 6ay.7 measures
 * both at once: over its own united span the quadruplet's EFL ripple is 5.7×
 * shallower than the triplet's and its FFD trend is 362× larger.
 *
 * That is not a fact about this bending. § 6ay.6 sweeps the whole bending family
 * and finds no bending that is telecentric four times; the best is three, and it
 * carries 2.03 waves of spherical aberration where the triplet gets its three at
 * a nulled S_I.
 *
 * ## No new engine code, and one message that was wrong
 *
 * Nothing here adds engine capability: every rung drives `designs/superachromat`
 * and `designs/telecentric` exactly as §§ 6av and 6ar shipped them. The one
 * source change is a refusal message that asserted the opposite of what is
 * measured here — "FFD(λ) is monotone here, which is what a tail with too few
 * united wavelengths does" — on the lens in this repo that unites the most.
 * § 6ay.8 pins the correction, because a claim the code makes is a claim that
 * needs a rung.
 */

const D_MM = 10;
/** § 6av.8's solid quadruplet, and § 6aw's lens. The wall is f/21.88. */
const RATIO = 25;
const BAND = [380, 800] as const;

const QUAD = superachromaticObjective({ apertureMm: D_MM, focalRatio: RATIO });
const TRIP = apochromaticObjective({ apertureMm: D_MM, focalRatio: RATIO });
const DOUB = achromaticObjective({ apertureMm: D_MM, focalRatio: RATIO });

/** The group a focal length is OF — `designs/telecentric`'s own `groupOf`. */
const groupOf = (tail: Prescription): Prescription => ({
  surfaces: tail.surfaces.map((s, i, all) => (i === all.length - 1 ? { ...s, thickness: 0 } : s)),
});
const QG = groupOf(QUAD.prescription);
const TG = groupOf(TRIP.prescription);
const DG = groupOf(DOUB.prescription);

/** Paraxial EFL of a group: −1/C. */
const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
/** The ray-transfer element D of a group: the slope out of a ray in at (0, 1). */
const dOf = (g: Prescription, nm: number): number => paraxialTrace(g, nm, { y: 0, u: 1 }).u;

/** Interior turning points of a sampled function of wavelength. */
const turnsOf = (
  f: (nm: number) => number,
  from: number,
  to: number,
  step: number,
): number[] => {
  const turns: number[] = [];
  let previous = f(from);
  let previousSlope: number | null = null;
  for (let nm = from + step; nm <= to + 1e-9; nm += step) {
    const v = f(nm);
    const slope = v - previous;
    if (previousSlope !== null && previousSlope * slope < 0) turns.push(nm - step / 2);
    previousSlope = slope;
    previous = v;
  }
  return turns;
};

/**
 * Golden section on a smooth extremum — `designs/telecentric`'s own, and quoted
 * to the same √ε precision. Near a turn the curve is flat to within what a
 * double holds, so these are pinned to one decimal and no further (§ 6aq.3).
 */
const golden = (
  g: (x: number) => number,
  a: number,
  b: number,
  want: "min" | "max",
): number => {
  const sign = want === "min" ? 1 : -1;
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (sign * g(m1) < sign * g(m2)) hi = m2;
    else lo = m1;
  }
  return 0.5 * (lo + hi);
};

const relativeSpread = (values: readonly number[]): number =>
  (Math.max(...values) - Math.min(...values)) / Math.abs(values[0]!);

/**
 * A pin with a stated relative budget, for the measured scalars below.
 *
 * `toBeCloseTo(x, n)` allows half of the last decimal, so quoting an expected
 * value to the same number of digits it is checked at spends the whole budget on
 * the quotation and leaves none for the lens — § 6ar.8's lesson, which was about
 * a searched crossing and applies to any pinned digit. Every expected value
 * here is quoted to eleven significant digits and checked at 1e−9 relative, so
 * the quotation costs about a hundredth of the allowance.
 */
const near = (actual: number, expected: number, relative = 1e-9): void => {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(relative);
};

describe("§ 6ay.1 — the precondition holds: four united colours put THREE turns in EFL(λ)", () => {
  it("the four lines are united, and Rolle puts one turn strictly between each pair", () => {
    // What the deferral asks for is the turn count, and for EFL that count is
    // not a measurement at all — it is Rolle's theorem on the solve's own
    // conditions. EFL(λ) − f vanishes at four wavelengths, so its derivative
    // vanishes at least three times, once strictly inside each consecutive gap.
    // This rung checks the solve first and then finds the three turns where the
    // theorem says they must be, which is the external number for the whole
    // step: no fitted constant enters it.
    const lines = QUAD.unitedLinesNm;
    expect(lines).toEqual([LINE_G, LINE_F, LINE_D, LINE_C]);
    for (const nm of lines) {
      expect((efl(QG, nm) - QUAD.focalLengthMm) / QUAD.focalLengthMm).toBeCloseTo(0, 14);
    }

    const turns = [
      golden((nm) => efl(QG, nm), LINE_G, LINE_F, "max"),
      golden((nm) => efl(QG, nm), LINE_F, LINE_D, "min"),
      golden((nm) => efl(QG, nm), LINE_D, LINE_C, "max"),
    ];
    // Strictly interior to its own bracket, which is the theorem's claim.
    expect(turns[0]!).toBeGreaterThan(LINE_G);
    expect(turns[0]!).toBeLessThan(LINE_F);
    expect(turns[1]!).toBeGreaterThan(LINE_F);
    expect(turns[1]!).toBeLessThan(LINE_D);
    expect(turns[2]!).toBeGreaterThan(LINE_D);
    expect(turns[2]!).toBeLessThan(LINE_C);
    // A turn is a √ε business, so one decimal and no more (§ 6aq.3, § 6ar.8).
    expect(turns[0]!).toBeCloseTo(454.0, 1);
    expect(turns[1]!).toBeCloseTo(529.3, 1);
    expect(turns[2]!).toBeCloseTo(625.2, 1);

    // And a blind walk over the whole rendered band finds those three and no
    // others — the theorem gives a lower bound on the count, not an upper one.
    expect(turnsOf((nm) => efl(QG, nm), BAND[0], BAND[1], 0.25)).toHaveLength(3);
  });

  it("and the same theorem gives the triplet two and the doublet one", () => {
    // The pattern the deferral is built on, checked on the two lenses this step
    // compares against rather than assumed: three united lines give two turns of
    // EFL and two give one. Every one of them is at the SAME aperture and focal
    // ratio as the quadruplet, which is § 6aw's rule and not decoration.
    expect(turnsOf((nm) => efl(TG, nm), BAND[0], BAND[1], 0.25)).toHaveLength(2);
    expect(turnsOf((nm) => efl(DG, nm), BAND[0], BAND[1], 0.25)).toHaveLength(1);
  });
});

describe("§ 6ay.2 — and FFD(λ) has NO turn in the visible, so the stop is telecentric once", () => {
  it("zero turns across 380…800, and the only crossing is the design wavelength", () => {
    const placed = telecentricStop({ tail: QUAD.prescription, imageDistanceMm: 100 });
    expect(placed.turningPointsNm).toHaveLength(0);
    expect(placed.turnUncertaintyNm).toBe(0);
    // One crossing, and it is the d line the placement was computed at. Seven
    // decimals and not more: § 6ar.8's floor is the difference of two numbers
    // near 233 mm divided by the slope, and `crossingUncertaintyNm` measures it.
    expect(placed.telecentricWavelengthsNm).toHaveLength(1);
    expect(placed.telecentricWavelengthsNm[0]!).toBeCloseTo(LINE_D, 7);
    expect(placed.crossingUncertaintyNm).toBeLessThan(1e-8);
    expect(placed.poleOrders).toEqual(["simple"]);
    expect(placed.stopToVertexMm).toBeCloseTo(233.421504530, 8);
  });

  it("monotone by direct measurement, not by the search failing to find a turn", () => {
    // A turn count from a walk is a statement about the walk. This is the same
    // claim made without one: every one of 4200 steps of FFD(λ) across the band
    // moves the same way.
    let rising = 0;
    let falling = 0;
    let previous = frontFocalDistance(QG, BAND[0]);
    for (let nm = BAND[0] + 0.1; nm <= BAND[1] + 1e-9; nm += 0.1) {
      const v = frontFocalDistance(QG, nm);
      if (v > previous) rising++;
      else falling++;
      previous = v;
    }
    expect(falling).toBe(0);
    expect(rising).toBeGreaterThan(4000);
  });

  it("the one turn there is sits at 933.7 nm, in the infrared and outside any rendered band", () => {
    // Widened to 1200 nm the curve does turn once — so "monotone" is a statement
    // about the visible band and this rung is what makes it one. It is still not
    // three: the two turns EFL has at 454 and 529 nm leave no trace in FFD at
    // all, which § 6ay.7 is the size of.
    const wide = telecentricStop({
      tail: QUAD.prescription,
      bandNm: [380, 1200],
      imageDistanceMm: 100,
    });
    expect(wide.turningPointsNm).toHaveLength(1);
    expect(wide.turningPointsNm[0]!).toBeCloseTo(933.68, 2);
    expect(wide.turnUncertaintyNm).toBeLessThan(1e-2);
    // Widening the band buys no crossing either — the level is still met once.
    expect(wide.telecentricWavelengthsNm).toHaveLength(1);
  });

  it("against three for the triplet and two for the doublet, same aperture, same ratio", () => {
    // The headline. Glass count 2, 3, 4 gives telecentric count 2, 3, 1.
    const trip = telecentricStop({ tail: TRIP.prescription, imageDistanceMm: 100 });
    expect(trip.turningPointsNm).toHaveLength(2);
    expect(trip.turningPointsNm[0]!).toBeCloseTo(520.8, 1);
    expect(trip.turningPointsNm[1]!).toBeCloseTo(621.3, 1);
    expect(trip.telecentricWavelengthsNm).toHaveLength(3);
    expect(trip.telecentricWavelengthsNm[0]!).toBeCloseTo(485.414493, 5);
    expect(trip.telecentricWavelengthsNm[1]!).toBeCloseTo(LINE_D, 7);
    expect(trip.telecentricWavelengthsNm[2]!).toBeCloseTo(651.909762, 5);

    const doub = telecentricStop({ tail: DOUB.prescription, imageDistanceMm: 100 });
    expect(doub.turningPointsNm).toHaveLength(1);
    expect(doub.turningPointsNm[0]!).toBeCloseTo(556.1, 1);
    expect(doub.telecentricWavelengthsNm).toHaveLength(2);
    expect(doub.telecentricWavelengthsNm[0]!).toBeCloseTo(528.376098, 5);
    expect(doub.telecentricWavelengthsNm[1]!).toBeCloseTo(LINE_D, 7);
  });
});

describe("§ 6ay.3 — because telecentricity reads FFD = EFL·D, and the solve constrains only EFL", () => {
  it("the identity holds to the last bits, at every wavelength in the band", () => {
    // Not a fit and not a coincidence: FFD is −D/C by `frontFocalDistance`'s own
    // definition and EFL is −1/C, so their ratio IS D. Checked because the whole
    // step turns on which of the two factors the chromatic solve reaches.
    for (let nm = BAND[0]; nm <= BAND[1]; nm += 5) {
      const ffd = frontFocalDistance(QG, nm);
      expect((efl(QG, nm) * dOf(QG, nm) - ffd) / ffd).toBeCloseTo(0, 13);
    }
  });

  it("EFL is united to 1e−14 over the four lines and FFD is not united at all", () => {
    const lines = QUAD.unitedLinesNm;
    const efls = lines.map((nm) => efl(QG, nm));
    const ffds = lines.map((nm) => frontFocalDistance(QG, nm));
    expect(relativeSpread(efls)).toBeLessThan(1e-14);
    // Eleven orders of magnitude between the corrected quantity and the one the
    // stop placement is a level of.
    near(relativeSpread(ffds), 2.9463071993e-4);
    expect(relativeSpread(ffds) / relativeSpread(efls)).toBeGreaterThan(1e10);
  });

  it("and D is what carries it — 0.9337 on the quadruplet against 1.0010 on the triplet", () => {
    // D is 1 for a thin lens exactly, so D − 1 is a pure thickness-and-power
    // quantity. The quadruplet's is 65× the triplet's and 672× the doublet's,
    // on 5.2 mm of glass against 4.0 and 1.6 — so it is not the glass thickness
    // that separates them but § 6at.2's conditioning: element powers 12.3× the
    // total where the triplet's are 2.5×.
    near(dOf(QG, LINE_D) - 1, -6.6313981881e-2);
    near(dOf(TG, LINE_D) - 1, 1.0275224527e-3);
    near(dOf(DG, LINE_D) - 1, 9.8613908077e-5);

    const drift = (g: Prescription): number =>
      (dOf(g, BAND[1]) - dOf(g, BAND[0])) / dOf(g, BAND[0]);
    near(drift(QG), 4.9695061856e-4);
    near(drift(TG), 9.3703118884e-6);
    // 53× more chromatic variation in the factor the solve never sees.
    near(Math.abs(drift(QG) / drift(TG)), 53.034586733);
  });
});

describe("§ 6ay.4 — a five-surface Gaussian matrix that never saw the solve agrees", () => {
  it("EFL, FFD and D to 1e−12 across the band, from Sellmeier and nothing else", () => {
    // § 6aq.2's precedent, and the reason it exists applies with more force
    // here: a claim that FFD(λ) is monotone, measured with the same tracer the
    // design was solved on, would be pinned to the tracer agreeing with itself.
    // M = R₅T₄R₄T₃R₃T₂R₂T₁R₁ with R = [[1,0],[−(n′−n)c,1]] and T = [[1,t/n],[0,1]].
    // Then EFL = −1/C and FFD = D·EFL, which is the identity § 6ay.3 uses.
    const c = QUAD.curvatures;
    const t = QUAD.thicknessesMm;
    const matrix = (nm: number): readonly number[] => {
      const n = [1, ...QUAD.media.map((g) => getMedium(g).n(nm)), 1];
      const mul = (A: readonly number[], B: readonly number[]): number[] => [
        A[0]! * B[0]! + A[1]! * B[2]!,
        A[0]! * B[1]! + A[1]! * B[3]!,
        A[2]! * B[0]! + A[3]! * B[2]!,
        A[2]! * B[1]! + A[3]! * B[3]!,
      ];
      const refract = (i: number): number[] => [1, 0, -(n[i + 1]! - n[i]!) * c[i]!, 1];
      const transfer = (i: number): number[] => [1, t[i]! / n[i + 1]!, 0, 1];
      let M = refract(0);
      for (let i = 0; i < 4; i++) {
        M = mul(transfer(i), M);
        M = mul(refract(i + 1), M);
      }
      return M;
    };

    let worstEfl = 0;
    let worstFfd = 0;
    let worstD = 0;
    for (let nm = BAND[0]; nm <= BAND[1]; nm += 5) {
      const M = matrix(nm);
      const f = -1 / M[2]!;
      worstEfl = Math.max(worstEfl, Math.abs(f - efl(QG, nm)) / Math.abs(f));
      const ffd = M[3]! * f;
      worstFfd = Math.max(worstFfd, Math.abs(ffd - frontFocalDistance(QG, nm)) / Math.abs(ffd));
      worstD = Math.max(worstD, Math.abs(M[3]! - dOf(QG, nm)));
    }
    expect(worstEfl).toBeLessThan(1e-12);
    expect(worstFfd).toBeLessThan(1e-12);
    expect(worstD).toBeLessThan(1e-12);

    // And the matrix says the same thing about the shape: no turn in the band.
    const ffdOf = (nm: number): number => {
      const M = matrix(nm);
      return (M[3]! * -1) / M[2]!;
    };
    expect(turnsOf(ffdOf, BAND[0], BAND[1], 0.5)).toHaveLength(0);
  });
});

describe("§ 6ay.5 — the cause is the glass: halve the thicknesses, halve D − 1, seven times", () => {
  /**
   * The thin limit is the causal pin, in § 6aq.1's shape. D → 1 exactly as the
   * glass goes to zero, so if D − 1 is what destroys the turns then the turns
   * must come back as the lens is thinned — and they do, at a thirty-second of
   * the shipped thicknesses.
   *
   * This drives `cementedQuadrupletForm` at a FIXED bending rather than
   * `superachromaticObjective`, on purpose. The constructor re-solves the
   * spherical null for each thickness set and refuses every one of these as not
   * a solid (§ 6av.8) — thinner elements close at the rim sooner. The claim here
   * is about D and not about the aplanatic bending, so the bending is held at
   * the shipped lens's and only the glass changes.
   */
  const rowAt = (k: number) => {
    const form = cementedQuadrupletForm({
      apertureMm: D_MM,
      focalLengthMm: QUAD.focalLengthMm,
      designWavelengthNm: LINE_D,
      thicknessesMm: [1.6 / k, 1.2 / k, 1.2 / k, 1.2 / k],
    });
    const cs = form.tryCurvaturesAt(QUAD.bending);
    expect(cs).not.toBeNull();
    const g = groupOf(form.build(cs!, 0));
    return { d1: dOf(g, LINE_D) - 1, group: g };
  };

  it("the ratio is 1.9524, 1.9758, 1.9878, … and converges on exactly two", () => {
    const ks = [1, 2, 4, 8, 16, 32, 64, 128];
    const rows = ks.map((k) => rowAt(k));
    expect(rows[0]!.d1).toBeCloseTo(-6.631398e-2, 8);
    const ratios = rows.slice(1).map((r, i) => rows[i]!.d1 / r.d1);
    // Each halving is nearer to exactly two than the last, monotonically.
    for (let i = 1; i < ratios.length; i++) {
      expect(Math.abs(ratios[i]! - 2)).toBeLessThan(Math.abs(ratios[i - 1]! - 2));
    }
    expect(ratios[0]!).toBeCloseTo(1.95238, 4);
    expect(ratios[ratios.length - 1]!).toBeCloseTo(1.99924, 4);
    // A thin quadruplet's D is 1 to a part in two thousand, so its FFD is its
    // EFL and the deferral's prediction is true OF A THIN LENS. 5.2 mm of glass
    // is what breaks it.
    expect(Math.abs(rows[rows.length - 1]!.d1)).toBeLessThan(6e-4);
  });

  it("and the three turns come back at a thirty-second of the glass, on EFL's own", () => {
    // Not "a turn appears" — the SAME three, walking toward the wavelengths
    // § 6ay.1 located on EFL(λ): 454.0, 529.3, 625.2.
    expect(turnsOf((nm) => frontFocalDistance(rowAt(1).group, nm), BAND[0], BAND[1], 0.5)).toHaveLength(0);
    expect(turnsOf((nm) => frontFocalDistance(rowAt(4).group, nm), BAND[0], BAND[1], 0.5)).toHaveLength(1);
    const thin = turnsOf((nm) => frontFocalDistance(rowAt(32).group, nm), BAND[0], BAND[1], 0.5);
    expect(thin).toHaveLength(3);
    const thinner = turnsOf((nm) => frontFocalDistance(rowAt(128).group, nm), BAND[0], BAND[1], 0.5);
    expect(thinner).toHaveLength(3);
    // Each of the three is nearer EFL's turn at a hundred-and-twenty-eighth than
    // at a thirty-second, which is what "the same three" has to mean.
    const target = [454.0, 529.3, 625.2];
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(thinner[i]! - target[i]!)).toBeLessThan(Math.abs(thin[i]! - target[i]!));
    }
  });
});

describe("§ 6ay.6 — and no bending the family reaches is telecentric four times", () => {
  /**
   * § 6aq.7 is that the turn count is a property of the BENDING and is decided
   * by a criterion that knows nothing about it. That step had two S_I-nulled
   * bendings to compare; § 6av.3 found the quadruplet has exactly one, so there
   * is no second design to check — but the family is continuous, and a count
   * read off the single built member would be exactly the mistake § 6aq.7
   * exists to prevent.
   *
   * So this sweeps the form's own scan window — `shallowestBending ± 3 ·
   * bendingSpan`, which is what `superachromaticObjective` searches — and for
   * each reachable bending asks the strongest question available: not how many
   * turns FFD(λ) has, but how many crossings the BEST placement achieves, which
   * is the telecentric count itself.
   *
   * **It is a scan of 401 bendings sampled at 0.5 nm, and it is quoted as one.**
   * What makes the result more than a scan is § 6ay.7, which measures why four
   * is not a near miss anywhere in the family.
   *
   * **And the count is by sign change, which is blind to a double root — but
   * that cannot hide a fourth wavelength, for a reason worth stating.** A level
   * sitting exactly at a turn is a `"turn"` placement: the two crossings either
   * side of that turn merge into one touched pole, so its number of DISTINCT
   * telecentric wavelengths is one FEWER than the neighbouring level class that
   * has both, and one more than the class that has neither. The maximum over all
   * levels is therefore attained at a generic level, which is what testing one
   * level between each pair of consecutive extrema enumerates. Four would have
   * to show up as a sign-change four somewhere, and it does not.
   */
  const STEPS = 401;
  const SAMPLE_NM = 0.5;

  const bestPlacement = (g: Prescription): { count: number; windowMm: number } => {
    const v: number[] = [];
    for (let nm = BAND[0]; nm <= BAND[1] + 1e-9; nm += SAMPLE_NM) v.push(frontFocalDistance(g, nm));
    // Every level that could change the crossing count lies between two
    // consecutive extrema of the curve, endpoints included — so it is enough to
    // test one level in each such interval.
    const marks = [v[0]!, v[v.length - 1]!];
    for (let i = 1; i < v.length - 1; i++) {
      if ((v[i]! - v[i - 1]!) * (v[i + 1]! - v[i]!) < 0) marks.push(v[i]!);
    }
    marks.sort((a, b) => a - b);
    let count = 0;
    let windowMm = 0;
    for (let i = 0; i + 1 < marks.length; i++) {
      const level = 0.5 * (marks[i]! + marks[i + 1]!);
      let n = 0;
      for (let j = 1; j < v.length; j++) {
        if ((v[j - 1]! - level) * (v[j]! - level) < 0) n++;
      }
      const width = marks[i + 1]! - marks[i]!;
      if (n > count || (n === count && width > windowMm)) {
        count = n;
        windowMm = width;
      }
    }
    return { count, windowMm };
  };

  it("111 reachable bendings, and the most any placement reaches is THREE", () => {
    const form = cementedQuadrupletForm({
      apertureMm: D_MM,
      focalLengthMm: QUAD.focalLengthMm,
      designWavelengthNm: LINE_D,
      thicknessesMm: [1.6, 1.2, 1.2, 1.2],
    });
    const lo = form.shallowestBending - 3 * form.bendingSpan;
    const hi = form.shallowestBending + 3 * form.bendingSpan;

    const histogram = new Map<number, number>();
    let best: { count: number; windowMm: number; s1: number } | null = null;
    for (let i = 0; i < STEPS; i++) {
      const c1 = lo + ((hi - lo) * i) / (STEPS - 1);
      const cs = form.tryCurvaturesAt(c1);
      if (cs === null) continue;
      const prescription = form.build(cs, 0);
      const b = bestPlacement(groupOf(prescription));
      histogram.set(b.count, (histogram.get(b.count) ?? 0) + 1);
      if (b.count >= 3 && (best === null || b.windowMm > best.windowMm)) {
        best = {
          ...b,
          s1: seidelSums(prescription, LINE_D, { marginalHeightMm: D_MM / 2 }).s1,
        };
      }
    }
    // Most of the window is not a design — the continuation reaches about a
    // quarter of it — which is § 6av's own common case and not a corner one.
    // The census below is exact on this grid and is a measurement of the SOLVER
    // as much as of the physics: `tryCurvaturesAt` deciding the family boundary
    // one sample differently would move `reachable` and the 107 without moving
    // anything optical. What the step rests on is the two assertions after them.
    const reachable = [...histogram.values()].reduce((a, b) => a + b, 0);
    expect(reachable).toBe(111);
    expect(histogram.get(4)).toBeUndefined();
    expect([...histogram.keys()].sort((a, b) => b - a)[0]).toBe(3);
    expect(histogram.get(1)).toBe(107);
    expect(histogram.get(2)).toBe(1);
    expect(histogram.get(3)).toBe(3);
  });

  it("and the three it does reach cost 2.03 waves of spherical, where the triplet's cost none", () => {
    const form = cementedQuadrupletForm({
      apertureMm: D_MM,
      focalLengthMm: QUAD.focalLengthMm,
      designWavelengthNm: LINE_D,
      thicknessesMm: [1.6, 1.2, 1.2, 1.2],
    });
    // The widest three-crossing placement in the family, located above.
    const cs = form.tryCurvaturesAt(-1.816409e-2);
    expect(cs).not.toBeNull();
    const prescription = form.build(cs!, 0);
    const b = bestPlacement(groupOf(prescription));
    expect(b.count).toBe(3);
    // A 6.32 µm window, which is a spacer tolerance and not a knife edge — and
    // is § 6aq.6's 1.61 µm in the same units, on a lens twice as long.
    expect(b.windowMm * 1e3).toBeCloseTo(6.32, 2);

    const s = seidelSums(prescription, LINE_D, { marginalHeightMm: D_MM / 2 });
    near(s.s1, -9.5595197522e-3);
    // W₀₄₀ = S_I/8, so this is 2.03 waves at the d line — 28× the λ/14 § 6ax
    // made this ladder's diffraction target, and the built lens meets it by
    // construction because its bending is the one that nulls ΣS_I.
    near(s.w040 / (LINE_D * 1e-6), -2.0337264421);
    expect(Math.abs(s.w040 / (LINE_D * 1e-6)) / (1 / 14)).toBeCloseTo(28.47, 2);

    // The triplet reaches three with a window of the same size at ΣS_I = 0.
    const t = bestPlacement(TG);
    expect(t.count).toBe(3);
    expect(t.windowMm * 1e3).toBeCloseTo(6.12, 2);
    expect(seidelSums(TRIP.prescription, LINE_D, { marginalHeightMm: D_MM / 2 }).s1).toBeCloseTo(0, 12);
  });
});

describe("§ 6ay.7 — and four is not a near miss: the ripple is 61.9× too shallow", () => {
  it("each glass shrinks what it corrects, and the fourth inflates what the stop reads", () => {
    // The single ordered quantity behind every count above. Over the span its
    // own united lines cover, a lens's EFL ripple is what can bend FFD back on
    // itself, and its FFD trend is what carries FFD away — so turns survive
    // where the ripple wins and vanish where the trend does. Measured on each
    // lens over ITS OWN united span, since that is the interval each design is
    // an interpolation over (§ 6at).
    const rippleAndTrend = (
      g: Prescription,
      from: number,
      to: number,
    ): { ripple: number; trend: number } => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let nm = from; nm <= to + 1e-9; nm += 0.25) {
        const v = efl(g, nm);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return {
        ripple: hi - lo,
        trend: Math.abs(frontFocalDistance(g, to) - frontFocalDistance(g, from)),
      };
    };

    const doub = rippleAndTrend(DG, LINE_F, LINE_C);
    const trip = rippleAndTrend(TG, LINE_F, LINE_C);
    const quad = rippleAndTrend(QG, LINE_G, LINE_C);

    // Micrometres, all three.
    near(doub.ripple * 1e3, 147.69647627);
    near(trip.ripple * 1e3, 6.3184130346);
    near(quad.ripple * 1e3, 1.1116865529);
    near(doub.trend * 1e3, 2.8262871664);
    near(trip.trend * 1e3, 0.18974782432);
    near(quad.trend * 1e3, 68.758774435);

    // The doublet and the triplet are ripple-dominated by 52× and 33×, so their
    // FFD keeps every turn their EFL has. The quadruplet is trend-dominated by
    // 61.9×, so it keeps none.
    near(doub.trend / doub.ripple, 0.019135779254);
    near(trip.trend / trip.ripple, 0.030030930755);
    near(quad.trend / quad.ripple, 61.850864578);

    // And this is the trade the fourth glass makes, in one comparison: it
    // improves the corrected quantity 5.7× and degrades the read one 362×.
    near(trip.ripple / quad.ripple, 5.6836281939);
    near(quad.trend / trip.trend, 362.36923759);
  });
});

describe("§ 6ay.8 — the refusal said the opposite, and it is now measured false", () => {
  it("a turn placement refuses on the lens with the MOST united wavelengths", () => {
    // The message `designs/telecentric` used to carry read: "FFD(λ) is monotone
    // here, which is what a tail with too few united wavelengths does." It is
    // the four-glass superachromat that is monotone and the two-glass achromat
    // that is not, so the clause named the wrong cause on the wrong lens. A
    // claim the code asserts is a claim that needs a rung, so the corrected text
    // is pinned here rather than only in prose.
    let message = "";
    try {
      telecentricStop({
        tail: QUAD.prescription,
        placement: { kind: "turn" },
        imageDistanceMm: 100,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("no turn in 380…800 nm");
    expect(message).toContain("FFD(λ) is monotone here");
    expect(message).not.toContain("too few united wavelengths");
    expect(message).toContain("unites four and is monotone");

    // And the doublet, which unites two, takes the placement the quadruplet
    // cannot — which is the comparison the old clause got backwards.
    const atTurn = telecentricStop({
      tail: DOUB.prescription,
      placement: { kind: "turn" },
      imageDistanceMm: 100,
    });
    expect(atTurn.poleOrder).toBe("double");
    expect(atTurn.telecentricWavelengthsNm).toHaveLength(1);
  });
});
