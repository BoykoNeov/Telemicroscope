import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { paraxialTrace } from "../src/trace/paraxial";
import { LINE_D } from "../src/materials/dispersion";
import { superachromaticObjective } from "../src/designs/superachromat";
import { apochromaticObjective } from "../src/designs/apochromat";
import {
  applyPerturbations,
  centringError,
  curvatureError,
  equivalentWedgeDeg,
  sensitivity,
  thicknessError,
  toleranceBudget,
  withTrailingReference,
  allocateEqualShare,
  type ToleranceAllocation,
  type ToleranceCurrency,
  type ToleranceParameter,
} from "../src/analysis/tolerance";

/**
 * § 6aw — the coupled tolerance budget on the quadruplet `designs/superachromat`
 * ships, which is § 6av's own deferral and § 6at's before it.
 *
 * § 6au built the machinery and drove it on the apochromatic TRIPLET: eleven
 * rows moved together, priced in two currencies, and combining to 0.763 of their
 * RSS. It could not do the same for the quadruplet because there was no such
 * lens. § 6av built one — and then § 6av.8 found that the one it first built was
 * not a solid, which is why every number here is at f/25 and not f/12.
 *
 * ## What is external here, and what is not
 *
 * Nothing in this file adds engine capability. Every rung drives
 * `analysis/tolerance` as § 6au pinned it — the group compensation, the wedge
 * and centring degeneracy, the differentiated maker's equation, the equal-share
 * allocation and its linearity diagnostic — on a second lens. What IS new is
 * what those rungs report on a lens whose residual colour is 91× smaller than
 * the triplet's, and the answer is that two of § 6au's habits do not survive the
 * change of lens:
 *
 *  - **The colour currency is not differentiable at the peak.** The quadruplet's
 *    residual peaks at 680 nm and the colour a curvature error injects peaks at
 *    430, so the worst-over-band functional has a KINK: below ε ≈ 1e−7 the slope
 *    is 5.68e−2 and above ε ≈ 1e−4 it is 2.29e−1, a factor of 4.03. The triplet
 *    has no kink at all — both peaks are at 430 nm and its slope is constant to
 *    6e−4 over eight decades — which is why § 6au never met this.
 *  - **A probe size is a fraction of the residual, not a constant.** § 6au's
 *    1e−5 injects 0.23% of the triplet's residual colour and 89% of the
 *    quadruplet's. So the probe that was small on one lens is past the kink on
 *    the other, and — this is the part that inverts the usual advice — making
 *    the probe SMALLER makes the budget WORSE, because the allowance is defined
 *    as a share of the residual and therefore sits on the far side of the kink
 *    by construction.
 *
 * The consequence for the drawing is that the allowance has to be SOLVED rather
 * than inverted from a slope. That solve is a bisection written here in the test
 * and deliberately not added to `analysis/tolerance`: it has no external number
 * to be pinned against, and what pins it here is that it reproduces the
 * extrapolation to 1% on the lens where the currency IS linear.
 *
 * ## Commensurability
 *
 * Every triplet number quoted beside a quadruplet number is measured at the SAME
 * aperture and the SAME focal ratio — 10 mm and f/25 — and not read off § 6au,
 * whose lens is f/6. That matters more than it looks: the blur coupling factor
 * § 6au reports as 0.763 is 0.0130 for the same triplet at f/25, so it is a fact
 * about a focal ratio and not about a triplet. The colour coupling factor, which
 * is paraxial, is 0.378 at both.
 */

const AP = 10;
const RATIO = 25;
/** The diffraction target § 6au uses, λ/14 of wavefront error. */
const DIFFRACTION_WAVES = 1 / 14;

const systemOf = (p: Prescription, semi = AP / 2, nm = LINE_D): OpticalSystem => ({
  prescription: p,
  aperture: { kind: "stopRadius", value: semi },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm, weight: 1 }],
  conjugate: { kind: "infinite" },
});

const efl = (p: Prescription, nm: number): number => -1 / paraxialTrace(p, nm, { y: 1, u: 0 }).u;

/**
 * § 6at.7's colour readout: the worst of R(λ) = f_d/f_λ − 1 over the band the
 * four lines span, against each prescription's OWN d line, so what is left is
 * the colour a refocus cannot remove. Reported with the wavelength it peaks at,
 * because on this lens that wavelength MOVES and § 6aw.2 is about what that
 * costs.
 */
const peakColour = (p: Prescription): { residual: number; nm: number } => {
  const fd = efl(p, LINE_D);
  let residual = 0;
  let nm = 0;
  for (let l = 430; l <= 680; l += 2.5) {
    const v = Math.abs(fd / efl(p, l) - 1);
    if (v > residual) {
      residual = v;
      nm = l;
    }
  }
  return { residual, nm };
};

const quad = superachromaticObjective({ apertureMm: AP, focalRatio: RATIO });
/** The shipped quadruplet, with the trailing reference plane its rear surface needs. */
const QUAD = withTrailingReference(quad.prescription);
/** The apochromatic triplet at the SAME geometry — never § 6au's f/6 numbers. */
const TRI = withTrailingReference(
  apochromaticObjective({ apertureMm: AP, focalRatio: RATIO }).prescription,
);

const quadSystem = systemOf(QUAD);
const triSystem = systemOf(TRI);

const QUAD_COLOUR = peakColour(QUAD).residual;
const TRI_COLOUR = peakColour(TRI).residual;

const currencyFor =
  (p: Prescription, nominal: number): ToleranceCurrency =>
  (_sys, groups) =>
    Math.abs(
      peakColour(applyPerturbations(p, groups.flatMap((g) => g.perturbations))).residual - nominal,
    );

const quadColour = currencyFor(QUAD, QUAD_COLOUR);
const triColour = currencyFor(TRI, TRI_COLOUR);

/**
 * The rows a cemented stack's drawing carries, by § 6au.3's count: one curvature
 * and one centring per surface, one centre thickness per element, and NO wedge
 * row, wedge and centring being one freedom on a sphere.
 */
const rowsOf = (p: Prescription, surfaces: number, elements: number) => {
  const curvatures: ToleranceParameter[] = Array.from({ length: surfaces }, (_v, s) => ({
    label: `c${s + 1}`,
    unit: "relative" as const,
    at: (m: number) => curvatureError(p, s, m),
    probe: 1e-5,
  }));
  const thicknesses: ToleranceParameter[] = Array.from({ length: elements }, (_v, s) => ({
    label: `t${s + 1}`,
    unit: "mm" as const,
    at: (m: number) => thicknessError(p, s, m),
    probe: 1e-3,
  }));
  const centring: ToleranceParameter[] = Array.from({ length: surfaces }, (_v, s) => ({
    label: `centring s${s + 1}`,
    unit: "mm" as const,
    at: (m: number) => centringError(p, s, m),
    probe: 1e-3,
  }));
  return { curvatures, thicknesses, centring, rows: [...curvatures, ...thicknesses, ...centring] };
};

const QUAD_ROWS = rowsOf(QUAD, 5, 4);
const TRI_ROWS = rowsOf(TRI, 4, 3);

/** Which currency each row is normalized-worse in — the constraint a shop meets. */
const binding = (
  colour: ToleranceAllocation,
  blur: ToleranceAllocation,
  colourTarget: number,
): string[] =>
  colour.rows.map((r, i) =>
    r.perUnit / colourTarget > blur.rows[i]!.perUnit / DIFFRACTION_WAVES ? "colour" : "blur",
  );

/**
 * The allowance SOLVED — the error size at which this row actually spends its
 * share — rather than inverted from a slope measured somewhere else.
 *
 * A geometric SCAN for the first crossing, then a bisection inside that bracket,
 * and the scan is not decoration: an error that partly cancels the residual it
 * is added to makes |Δcolour| non-monotonic, and a bare bisection then returns
 * whichever crossing it happens to fall into. It does so on the TRIPLET's front
 * curvature, where a plain bisection lands 1.9× from the answer on a lens whose
 * currency is otherwise linear to a part in a thousand. The first crossing is
 * also the honest one: it is the largest error for which the row has spent no
 * more than its share at ANY size below.
 */
const solvedAllowance = (
  sys: OpticalSystem,
  currency: ToleranceCurrency,
  p: ToleranceParameter,
  share: number,
): number => {
  const LO = 1e-13;
  const HI = 1e3;
  const STEPS = 640;
  let prev = LO;
  for (let i = 1; i <= STEPS; i++) {
    const m = LO * Math.pow(HI / LO, i / STEPS);
    if (currency(sys, [p.at(m)]) >= share) {
      let lo = prev;
      let hi = m;
      for (let k = 0; k < 80; k++) {
        const mid = Math.sqrt(lo * hi);
        if (currency(sys, [p.at(mid)]) < share) lo = mid;
        else hi = mid;
      }
      return Math.sqrt(lo * hi);
    }
    prev = m;
  }
  return NaN;
};

/** A row's blur cost per unit, without the re-measure `allocateEqualShare` also does. */
const blurPerUnit = (sys: OpticalSystem, p: ToleranceParameter): number =>
  sensitivity(sys, p.at(p.probe)).sigmaWaves / p.probe;

describe("§ 6aw.1 — fourteen rows, and the count is the same rule as the triplet's eleven", () => {
  it("five curvatures, four thicknesses, five centring — and NOT sixteen", () => {
    // § 6av's own deferral said "five surfaces make sixteen rows rather than
    // eleven" and never built the array. The rule that makes eleven out of a
    // triplet — one curvature and one centring per SURFACE, one thickness per
    // ELEMENT, no wedge row because § 6au.3 makes wedge and centring one freedom
    // — makes 5 + 4 + 5 on five surfaces and four elements.
    expect(QUAD_ROWS.rows).toHaveLength(14);
    expect(TRI_ROWS.rows).toHaveLength(11);
    expect(QUAD_ROWS.curvatures).toHaveLength(5);
    expect(QUAD_ROWS.thicknesses).toHaveLength(4);
    expect(QUAD_ROWS.centring).toHaveLength(5);
    // The lens is the solid one § 6av.8 leaves behind, not the f/12 prescription
    // every number in § 6av was first quoted at.
    expect(quad.focalLengthMm).toBe(250);
    expect(quad.bendings[0]!.minEdgeMm).toBeGreaterThan(0);
  });

  it("and its residual colour is 91× the triplet's smaller, which is what makes the rest hard", () => {
    // The number every colour row below is normalized by, and the reason this
    // budget does not behave like § 6au's: the target is the lens's OWN residual,
    // and the quadruplet's is 2.44e−6 against the triplet's 2.23e−4 at the same
    // geometry. § 6av.6 pins that ratio as the perfect-glass advantage; here it
    // is the thing that moves every allowance.
    expect(QUAD_COLOUR).toBeCloseTo(2.4401e-6, 9);
    expect(TRI_COLOUR).toBeCloseTo(2.2301e-4, 7);
    expect(TRI_COLOUR / QUAD_COLOUR).toBeCloseTo(91.4, 0);
  });
});

describe("§ 6aw.2 — the colour currency has a KINK, and § 6au's probe is past it", () => {
  it("the residual peaks at 680 nm and the injected colour at 430, so the slope steps 4.03×", () => {
    // The step's methodological finding, and it is about a functional rather
    // than about optics. The currency is max over the band of |R(λ)|, and a
    // maximum is differentiable only while the argmax stays put. On this lens it
    // does not: the four-line residual peaks at the RED end and what a curvature
    // error injects peaks at the BLUE end, so as the error grows the peak jumps
    // from one to the other and the slope quadruples.
    const nominal = peakColour(QUAD);
    expect(nominal.nm).toBe(680);
    const slopeAt = (eps: number): { slope: number; nm: number } => {
      const perturbed = peakColour(
        applyPerturbations(QUAD, curvatureError(QUAD, 1, eps).perturbations),
      );
      return { slope: Math.abs(perturbed.residual - nominal.residual) / eps, nm: perturbed.nm };
    };
    // Below the kink the peak has not moved and the slope is the derivative of
    // R(680) — flat over three decades, so this is a real derivative and not a
    // difference that has not converged.
    for (const eps of [1e-9, 1e-8, 1e-7]) {
      expect(slopeAt(eps).nm).toBe(680);
      expect(Math.abs(slopeAt(eps).slope / 5.6835e-2 - 1)).toBeLessThan(1e-3);
    }
    // Above it the peak is the injected colour's own, at the other end of the
    // band, and the slope is a different number — also flat, also real.
    for (const eps of [1e-4, 1e-3]) {
      expect(slopeAt(eps).nm).toBe(430);
      expect(Math.abs(slopeAt(eps).slope / 2.2897e-1 - 1)).toBeLessThan(4e-3);
    }
    expect(2.2897e-1 / 5.6835e-2).toBeCloseTo(4.029, 2);
    // The transition sits where the injected colour is a few percent of the
    // residual, which is what makes it a property of the LENS and not of a size.
    expect(slopeAt(1e-6).nm).toBe(430);
    expect(slopeAt(1e-7).nm).toBe(680);
  });

  it("...and the triplet has no kink at all, which is why § 6au never met this", () => {
    // The control that says the kink belongs to this lens rather than to the
    // readout. On the triplet the residual and the injected colour peak at the
    // SAME wavelength, so the argmax never moves and the slope is one number
    // over eight decades of error.
    const nominal = peakColour(TRI);
    expect(nominal.nm).toBe(430);
    for (const eps of [1e-10, 1e-8, 1e-6, 1e-4, 1e-3]) {
      const perturbed = peakColour(
        applyPerturbations(TRI, curvatureError(TRI, 1, eps).perturbations),
      );
      expect(perturbed.nm).toBe(430);
      const slope = Math.abs(perturbed.residual - nominal.residual) / eps;
      expect(Math.abs(slope / 5.0233e-2 - 1)).toBeLessThan(1e-3);
    }
  });

  it("a probe is a FRACTION of the residual it perturbs, not a size", () => {
    // Why § 6au's constant landed on the wrong side of the kink here, in one
    // ratio: the same 1e−5 relative curvature error injects 0.23% of the
    // triplet's residual colour and 89% of the quadruplet's, because the
    // quadruplet's residual is 91× smaller while its sensitivity is 4.6× larger.
    // A probe is not portable between lenses.
    const injected = (p: Prescription, nominal: number): number =>
      Math.abs(
        peakColour(applyPerturbations(p, curvatureError(p, 1, 1e-5).perturbations)).residual -
          nominal,
      );
    expect(injected(TRI, TRI_COLOUR) / TRI_COLOUR).toBeCloseTo(2.25e-3, 4);
    expect(injected(QUAD, QUAD_COLOUR) / QUAD_COLOUR).toBeCloseTo(0.889, 2);
  });
});

describe("§ 6aw.3 — NINE rows bind on colour and five on blur, by three orders of magnitude", () => {
  it("every powered freedom is a colour row, and the alignment rows are colour-blind exactly", () => {
    // § 6au's result on the triplet is six rows to five, and which one binds is
    // decided within a factor of 26. Here nothing is close: the tightest margin
    // is 2138× and the widest 28746×, because the target the colour rows are
    // normalized by is 91× smaller while the blur target is the same λ/14. So a
    // blur-only budget of this lens would not be loose — it would be irrelevant.
    const colour = allocateEqualShare(quadSystem, QUAD_ROWS.rows, QUAD_COLOUR, {}, quadColour);
    const blur = allocateEqualShare(quadSystem, QUAD_ROWS.rows, DIFFRACTION_WAVES);
    expect(binding(colour, blur, QUAD_COLOUR)).toEqual([
      "colour", "colour", "colour", "colour", "colour", // five curvatures
      "colour", "colour", "colour", "colour", //          four thicknesses
      "blur", "blur", "blur", "blur", "blur", //          five centring rows
    ]);
    const ratio = (i: number): number =>
      colour.rows[i]!.perUnit / QUAD_COLOUR / (blur.rows[i]!.perUnit / DIFFRACTION_WAVES);
    expect(ratio(2)).toBeCloseTo(2138, -2);
    expect(ratio(5)).toBeCloseTo(28746, -3);
    for (let i = 0; i < 9; i++) expect(ratio(i)).toBeGreaterThan(2000);
    // …and the five alignment rows are invisible to colour EXACTLY, for
    // § 6au.6's reason: `paraxialTrace` is first order about the axis and does
    // not read a decentre at all. The zero is a fact about the readout.
    for (let i = 9; i < 14; i++) expect(colour.rows[i]!.perUnit).toBe(0);
  });

  it("and the triplet at the SAME geometry is seven and four, so most of that is the RATIO", () => {
    // The control the headline needs, and it takes something off it. § 6au's
    // six-and-five is an f/6 measurement; the same triplet at f/25 comes back
    // seven and four, t3 having crossed over, and colour beats blur there by 33×
    // to 2169×. So the quadruplet's three orders of magnitude are about ten
    // times the triplet's at the same geometry, not a thousand times § 6au's.
    // The honest statement of the finding is the tenfold one.
    // Read off the SLOPES rather than through `allocateEqualShare`, because the
    // triplet's rear centring allowance at f/25 is 347 mm and the re-measure the
    // allocation does at its own answer cannot be traced at all (§ 6aw.5). The
    // binding question only needs the slopes.
    const norm = TRI_ROWS.rows.map((p) => ({
      colour: triColour(triSystem, [p.at(p.probe)]) / p.probe / TRI_COLOUR,
      blur: blurPerUnit(triSystem, p) / DIFFRACTION_WAVES,
    }));
    expect(norm.map((n) => (n.colour > n.blur ? "colour" : "blur"))).toEqual([
      "colour", "colour", "colour", "colour", // four curvatures
      "colour", "colour", "colour", //          three thicknesses — t3 too, at f/25
      "blur", "blur", "blur", "blur", //        four centring rows
    ]);
    const powered = norm.slice(0, 7).map((n) => n.colour / n.blur);
    expect(Math.min(...powered)).toBeCloseTo(33.0, 0);
    expect(Math.max(...powered)).toBeCloseTo(2169, -2);
  });
});

describe("§ 6aw.4 — the allowance has to be SOLVED, and a smaller probe makes it worse", () => {
  it("the extrapolation is out by up to 2.8×, and the linearity check is what says so", () => {
    // An inverse-sensitivity budget divides the target by √N and inverts a slope
    // measured at a probe. Here the allowance lands past the kink by
    // construction — it is a share of the residual, and the kink is at a few
    // percent of the residual — so the slope it was computed from is the wrong
    // one whichever side it was measured on. Solved against extrapolated, on the
    // nine rows colour binds.
    const share = QUAD_COLOUR / Math.sqrt(QUAD_ROWS.rows.length);
    const powered = QUAD_ROWS.rows.slice(0, 9);
    const solved = powered.map((p) => solvedAllowance(quadSystem, quadColour, p, share));
    const expected = [
      1.3060e-5, 3.3850e-6, 3.3744e-6, 3.3644e-5, 6.6945e-6, // the five curvatures
      5.5809e-4, 4.9274e-4, 2.0130e-4, 2.7365e-4, //            the four thicknesses, mm
    ];
    solved.forEach((v, i) =>
      expect(Math.abs(v / expected[i]! - 1), powered[i]!.label).toBeLessThan(1e-3),
    );
    const extrapolatedFrom = (probe: number): number[] =>
      powered.map((p) => share / (quadColour(quadSystem, [p.at(probe)]) / probe));
    const big = extrapolatedFrom(1e-5).map((a, i) => a / solved[i]!);
    const small = extrapolatedFrom(1e-8).map((a, i) => a / solved[i]!);
    // From § 6au's own probe the curvature rows are within a factor of two and
    // the thickness rows are 2.7× loose.
    expect(big.slice(0, 5).map((r) => Number(r.toFixed(2)))).toEqual([1.05, 0.89, 0.91, 1.83, 0.94]);
    for (const r of big.slice(5)) expect(r).toBeGreaterThan(2.68);
    // …and from a probe a thousand times smaller — the instinctive repair —
    // EVERY row is 2.3× to 3.4× loose, because a smaller probe measures the
    // slope on the far side of the kink from where the allowance lands.
    for (const r of small) expect(r).toBeGreaterThan(2.26);
    expect(Math.max(...small)).toBeCloseTo(3.39, 1);
    expect(Math.max(...small)).toBeGreaterThan(Math.max(...big));
  });

  it("the linearity diagnostic catches it on nine rows where the triplet's is clean on seven", () => {
    // § 6au added `linearity = checked/share` because the first draft of that
    // step spent a colour budget on a parameter it did not constrain and nothing
    // said so. It earns its keep again: on the quadruplet's colour allocation
    // not one of the nine powered rows is within 3%, running 0.84 to 1.98, while
    // the same allocation on the triplet is within 0.5% on all seven. That
    // contrast IS the kink, read through the diagnostic rather than directly.
    const quadAlloc = allocateEqualShare(quadSystem, QUAD_ROWS.rows, QUAD_COLOUR, {}, quadColour);
    const triAlloc = allocateEqualShare(triSystem, TRI_ROWS.rows, TRI_COLOUR, {}, triColour);
    const quadLin = quadAlloc.rows.slice(0, 9).map((r) => r.linearity);
    const triLin = triAlloc.rows.slice(0, 7).map((r) => r.linearity);
    for (const l of quadLin) expect(Math.abs(l - 1)).toBeGreaterThan(0.03);
    expect(Math.min(...quadLin)).toBeCloseTo(0.842, 2);
    expect(Math.max(...quadLin)).toBeCloseTo(1.984, 2);
    for (const l of triLin) expect(Math.abs(l - 1)).toBeLessThan(0.005);
  });

  it("...and the solve reproduces the extrapolation on the lens where the currency IS linear", () => {
    // What pins the bisection, there being no external number for an allocator.
    // On the triplet the colour currency has no kink, so a solved allowance and
    // an inverted slope have to agree — and they do, to 1%, on all seven powered
    // rows. The same routine on the same currency gives 2.8× on the quadruplet,
    // so the disagreement there is the lens and not the method.
    const share = TRI_COLOUR / Math.sqrt(TRI_ROWS.rows.length);
    const alloc = allocateEqualShare(triSystem, TRI_ROWS.rows, TRI_COLOUR, {}, triColour);
    for (let i = 0; i < 7; i++) {
      const p = TRI_ROWS.rows[i]!;
      const solved = solvedAllowance(triSystem, triColour, p, share);
      expect(Math.abs(alloc.rows[i]!.allowance / solved - 1), p.label).toBeLessThan(0.006);
    }
  });
});

describe("§ 6aw.5 — the couplings, and which of the two factors is a property of the lens", () => {
  it("the fourteen rows cancel to 0.447 of their RSS, and the number does not move with the scale", () => {
    // § 6au's headline coupling rung, one design on. The combined trace comes in
    // below the RSS here too, so the independence estimate is pessimistic — but
    // by 2.2× where the triplet at f/6 is pessimistic by 1.3×. Measured at three
    // scales two decades apart, because a ratio that drifts with the size of the
    // perturbations is not a property of the lens.
    for (const scale of [1e-2, 1e-3, 1e-4]) {
      const colour = allocateEqualShare(
        quadSystem,
        [...QUAD_ROWS.curvatures, ...QUAD_ROWS.thicknesses],
        QUAD_COLOUR * scale,
        {},
        quadColour,
      );
      const blur = allocateEqualShare(quadSystem, QUAD_ROWS.centring, DIFFRACTION_WAVES * scale);
      const budget = toleranceBudget(quadSystem, [
        ...colour.rows.map((r, i) =>
          [...QUAD_ROWS.curvatures, ...QUAD_ROWS.thicknesses][i]!.at(r.allowance),
        ),
        ...blur.rows.map((r, i) => QUAD_ROWS.centring[i]!.at(r.allowance)),
      ]);
      expect(budget.contributions).toHaveLength(14);
      expect(budget.combinedWaves / budget.rssWaves).toBeCloseTo(0.4472, 3);
      expect(colour.couplingRatio).toBeCloseTo(0.3874, 3);
      // Every σ on one support, § 6au.7's control: nothing is dropped at any of
      // the three scales, so the gap between RSS and combined is correlation and
      // not a difference of domain.
      expect(budget.pointsDropped).toBe(0);
      expect(budget.pointsRetained).toBe(293);
    }
  });

  it("and § 6au's 0.763 is a fact about f/6: the same triplet at f/25 cancels to 0.013", () => {
    // The comparison § 6au's number invites, and it does not survive being made.
    // The BLUR coupling factor moves by 59× between f/6 and f/25 on one lens —
    // so "the eleven rows combine to 0.763 of their RSS" is a statement about a
    // geometry, and the quadruplet's 0.447 is 34× the triplet's at the geometry
    // they can be compared at. The COLOUR factor is the one that belongs to the
    // lens: 0.378 for the triplet at either ratio, against 0.387 here.
    for (const scale of [1e-4, 1e-5]) {
      const colour = allocateEqualShare(
        triSystem,
        [...TRI_ROWS.curvatures, ...TRI_ROWS.thicknesses],
        TRI_COLOUR * scale,
        {},
        triColour,
      );
      const blur = allocateEqualShare(triSystem, TRI_ROWS.centring, DIFFRACTION_WAVES * scale);
      const budget = toleranceBudget(triSystem, [
        ...colour.rows.map((r, i) =>
          [...TRI_ROWS.curvatures, ...TRI_ROWS.thicknesses][i]!.at(r.allowance),
        ),
        ...blur.rows.map((r, i) => TRI_ROWS.centring[i]!.at(r.allowance)),
      ]);
      expect(budget.contributions).toHaveLength(11);
      expect(budget.combinedWaves / budget.rssWaves).toBeCloseTo(0.0130, 3);
      expect(colour.couplingRatio).toBeCloseTo(0.3780, 3);
      expect(budget.pointsDropped).toBe(0);
    }
    // At a hundredth of the budget — § 6au's own scale — the triplet's rear
    // centring allowance at f/25 is 3.5 mm and the re-measure cannot be traced
    // at all. That row is not a tolerance in the strongest sense available.
    expect(() =>
      allocateEqualShare(triSystem, TRI_ROWS.centring, DIFFRACTION_WAVES * 1e-2),
    ).toThrow(/vignetted/);
  });
});

describe("§ 6aw.6 — the drawing, and what it says about the fourth glass", () => {
  it("the tightest radius is 0.00034% and the tightest centring 3.3 arcmin", () => {
    // The sheet a shop would be handed, from whichever currency binds each row
    // and with the colour rows SOLVED rather than extrapolated. The three
    // numbers to watch are the two middle cement radii and the wedge on the
    // third joint, which is the same shape of answer § 6au reached for the
    // triplet — and roughly four hundred times tighter.
    const share = QUAD_COLOUR / Math.sqrt(QUAD_ROWS.rows.length);
    const radii = QUAD_ROWS.curvatures.map((p) =>
      solvedAllowance(quadSystem, quadColour, p, share),
    );
    expect(Math.min(...radii)).toBeCloseTo(3.374e-6, 9);
    expect(radii.indexOf(Math.min(...radii))).toBe(2);

    const blur = allocateEqualShare(quadSystem, QUAD_ROWS.rows, DIFFRACTION_WAVES);
    const centring = [0, 1, 2, 3, 4].map((s) => blur.rows[9 + s]!.allowance);
    expect(centring.map((c) => Number((c * 1000).toFixed(1)))).toEqual([
      72.5, 22.2, 14.2, 512.4, 29.4,
    ]);
    // The same allowance as the wedge callout a drawing carries beside it,
    // exactly, by § 6au.3: α = asin(δ·c) and no rule of thumb in it.
    const arcmin = [0, 1, 2, 3, 4].map(
      (s) => Math.abs(equivalentWedgeDeg(QUAD, s, centring[s]!)) * 60,
    );
    expect(arcmin.map((a) => Number(a.toFixed(2)))).toEqual([7.51, 5.58, 3.32, 58.18, 5.0]);
    expect(Math.min(...arcmin)).toBeCloseTo(3.32, 2);
  });

  it("and 0.00034% of radius is thirty times finer than a precision grade", () => {
    // The verdict, and it is sharper than § 6av's. That step compares the
    // quadruplet's DELIVERED colour with a perfect triplet's and finds them
    // level at 0.077% of radius, so at a 0.1% commercial grade the fourth glass
    // is already a loss. This asks the other question — what error keeps the
    // lens inside its OWN residual — and the answer is 3.37e−6, which published
    // grades near 0.1% and 0.01% miss by factors of 300 and 30. The triplet's
    // own tightest row at the same geometry is 1.34e−3, which a 0.1% grade
    // clears. So the apochromat is buildable to its specification and the
    // superachromat is not buildable to its.
    const quadShare = QUAD_COLOUR / Math.sqrt(QUAD_ROWS.rows.length);
    const triShare = TRI_COLOUR / Math.sqrt(TRI_ROWS.rows.length);
    const tightest = (
      sys: OpticalSystem,
      currency: ToleranceCurrency,
      params: readonly ToleranceParameter[],
      share: number,
    ): number => Math.min(...params.map((p) => solvedAllowance(sys, currency, p, share)));
    const q = tightest(quadSystem, quadColour, QUAD_ROWS.curvatures, quadShare);
    const t = tightest(triSystem, triColour, TRI_ROWS.curvatures, triShare);
    expect(q).toBeCloseTo(3.374e-6, 9);
    expect(t).toBeCloseTo(1.3376e-3, 6);
    expect(t / q).toBeCloseTo(397, -1);
    expect(1e-4 / q).toBeGreaterThan(29);
    expect(1e-3 / t).toBeLessThan(1);
  });
});

describe("§ 6aw.7 — the support, and the defect it is a symptom of", () => {
  it("the quadruplet keeps 293 of the 313 the triplet keeps, and the discs are why", () => {
    // § 6au.7's common-support control, and on this lens it reports something.
    // The quadruplet drops 20 pupil samples at its own stop where the triplet
    // drops none — and it is the glass margin, not § 6av.8's solidity: the
    // marginal ray climbs to 5.281 mm inside a stack whose discs are 5.1, and
    // widening every disc to 6 mm restores all 313. It is the second defect
    // § 6av.8 names and leaves unrepaired, seen from the other end.
    expect(sensitivity(quadSystem, curvatureError(QUAD, 0, 1e-6)).pointsRetained).toBe(293);
    expect(sensitivity(triSystem, curvatureError(TRI, 0, 1e-6)).pointsRetained).toBe(313);
    const inside = [0, 1, 2, 3].map(
      (i) =>
        paraxialTrace({ surfaces: QUAD.surfaces.slice(0, i + 1) }, LINE_D, { y: AP / 2, u: 0 }).y,
    );
    expect(Math.max(...inside)).toBeCloseTo(5.281, 2);
    const wide: Prescription = {
      surfaces: QUAD.surfaces.map((s) => ({ ...s, semiAperture: Math.max(s.semiAperture, 6) })),
    };
    expect(sensitivity(systemOf(wide), curvatureError(wide, 0, 1e-6)).pointsRetained).toBe(313);
    // …and stopping down to where nothing is lost costs 4% of the aperture.
    expect(sensitivity(systemOf(QUAD, 4.8), curvatureError(QUAD, 0, 1e-6)).pointsRetained).toBe(313);
  });

  it("...and nothing in the budget depends on it", () => {
    // The control that makes the twenty missing samples a footnote rather than a
    // caveat on every number above: run the whole allocation on the full 313 and
    // the binding pattern is identical and the coupling factor is identical to
    // four digits. A budget that changed when 6% of the pupil came back would be
    // reporting the support and not the lens.
    const full = systemOf(QUAD, 4.5);
    const colour = allocateEqualShare(full, QUAD_ROWS.rows, QUAD_COLOUR, {}, quadColour);
    const blur = allocateEqualShare(full, QUAD_ROWS.rows, DIFFRACTION_WAVES);
    expect(binding(colour, blur, QUAD_COLOUR).join("")).toBe(
      "colourcolourcolourcolourcolourcolourcolourcolourcolourblurblurblurblurblur",
    );
    const scale = 1e-2;
    const c = allocateEqualShare(
      full,
      [...QUAD_ROWS.curvatures, ...QUAD_ROWS.thicknesses],
      QUAD_COLOUR * scale,
      {},
      quadColour,
    );
    const b = allocateEqualShare(full, QUAD_ROWS.centring, DIFFRACTION_WAVES * scale);
    const budget = toleranceBudget(full, [
      ...c.rows.map((r, i) => [...QUAD_ROWS.curvatures, ...QUAD_ROWS.thicknesses][i]!.at(r.allowance)),
      ...b.rows.map((r, i) => QUAD_ROWS.centring[i]!.at(r.allowance)),
    ]);
    expect(budget.pointsRetained).toBe(313);
    expect(budget.pointsDropped).toBe(0);
    expect(budget.combinedWaves / budget.rssWaves).toBeCloseTo(0.4472, 3);
  });

  it("and the trailing reference plane is inert on this lens too, at every size the budget uses", () => {
    // § 6au.1's fourth rung found the plane is only optically nothing while both
    // reference-sphere crossings agree, and it took a second lens to see it. A
    // third lens, at the error sizes this budget actually reaches: wrapped and
    // bare agree to 1e−4 relative at the smallest probe and to 1e−8 above it,
    // the looser figure being the focus search's own floor where σ is smallest.
    for (const m of [1e-4, 1e-2, 4e-2]) {
      const bare = sensitivity(
        systemOf(quad.prescription),
        curvatureError(quad.prescription, 0, m),
      ).sigmaWaves;
      const wrapped = sensitivity(quadSystem, curvatureError(QUAD, 0, m)).sigmaWaves;
      expect(Math.abs(wrapped / bare - 1)).toBeLessThan(1e-6);
    }
    for (const d of [1e-3, 1e-2, 1e-1]) {
      const bare = sensitivity(
        systemOf(quad.prescription),
        centringError(quad.prescription, 0, d),
      ).sigmaWaves;
      const wrapped = sensitivity(quadSystem, centringError(QUAD, 0, d)).sigmaWaves;
      expect(Math.abs(wrapped / bare - 1)).toBeLessThan(1e-6);
    }
  });
});
