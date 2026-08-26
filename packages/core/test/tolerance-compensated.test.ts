import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { paraxialTrace } from "../src/trace/paraxial";
import { LINE_D, LINE_F, LINE_C, LINE_G, getMedium } from "../src/materials";
import { achromaticObjective } from "../src/designs/achromat";
import { apochromaticObjective } from "../src/designs/apochromat";
import { superachromaticObjective } from "../src/designs/superachromat";
import { seidelSums } from "../src/analysis/seidel";
import { defocusWaves } from "../src/imaging/volume";
import {
  applyPerturbations,
  centringError,
  compensated,
  curvatureError,
  equivalentWedgeDeg,
  meltShift,
  refit,
  sensitivity,
  thicknessError,
  withTrailingReference,
  type Compensator,
  type ToleranceCurrency,
  type ToleranceParameter,
} from "../src/analysis/tolerance";
import type { OptimizeOperand } from "../src/analysis/optimize";
import type { SolveVariable } from "../src/analysis/solve";

/**
 * § 6ax — the compensation stage, and the two currencies made commensurate.
 *
 * § 6au built the tolerance machinery and § 6aw drove it on the superachromatic
 * quadruplet, where it returned a radius tolerance of 3.37e−6 and the verdict
 * that the lens is not buildable to its own specification. Both halves of that
 * sentence turn out to be artifacts of the model rather than facts about the
 * lens, and this step measures both.
 *
 * ## The first artifact: a frozen drawing
 *
 * Everything above prices an error against a prescription that is settled
 * before any glass is bought. Real optical manufacture does the opposite: it
 * measures the melt it received and the radius it actually ground, and
 * re-solves the design around those measurements. `refit` and `compensated` add
 * that stage — perturb, re-solve the free variables, charge what is left — and
 * the size of the difference is the whole point. A melt error a THOUSAND times
 * larger than the frozen budget's allowance refits to within 2% of nominal.
 *
 * ## The second artifact: a self-referential target
 *
 * § 6aw's colour target is the lens's own residual, so a lens with a 91×
 * smaller residual is automatically held to a 91× harder standard. That is
 * bookkeeping, not physics. Here the chromatic focal shift is converted into
 * WAVES and charged against the same λ/14 the blur rows already use, which is
 * the first time this ladder has had an exchange rate between its two
 * currencies at all. Two closed-form steps, no external constant:
 *
 *   - § 1.5's `defocusWaves` — an axial offset δ costs δ·NA²/(2nλ) waves at the
 *     rim — applied to δ = R·f, the focal shift a relative colour error R is.
 *   - The balanced RMS of a defocus ρ² is its rim value over 2√3, which is the
 *     same projection `sensitivity` already performs on the blur side.
 *
 * On that scale the quadruplet's residual is 1192× inside the diffraction
 * target and the apochromatic triplet's is 13× inside — at f/25, colour is not
 * what either lens is limited by.
 *
 * ## What survives both corrections, and it is the interesting half
 *
 * A refit answers an error only where the design's own conditions can SEE it.
 * The five curvatures and four thicknesses are seen — power, three chromatic
 * powers and ΣS_I all move with them — and after compensation none of the nine
 * constrains the lens at any error a lens could physically carry. A decentre at
 * assembly is not seen: every restored condition is axially symmetric and a
 * decentre is not, so the row passes through untouched, to the last digit.
 *
 * So the drawing a shop is actually handed is five centring callouts and
 * nothing else, and its tightest is 14.2 µm — demanding precision assembly,
 * and nothing like the 3.37e−6 of radius § 6aw asked for.
 */

const AP = 10;
const RATIO = 25;
const FL_MM = 250;
/** Paraxial NA of the f/25 objective, (D/2)/f — the aperture the defocus rides on. */
const NA = AP / 2 / FL_MM;
/** § 6au's diffraction target, λ/14 of balanced wavefront error. */
const DIFFRACTION_WAVES = 1 / 14;

const power = (p: Prescription, nm: number): number => -paraxialTrace(p, nm, { y: 1, u: 0 }).u;
const efl = (p: Prescription, nm: number): number => -1 / paraxialTrace(p, nm, { y: 1, u: 0 }).u;

/** § 6at.7's colour readout: worst |f_d/f_λ − 1| over the band the four lines span. */
const peakColour = (p: Prescription): number => {
  const fd = efl(p, LINE_D);
  let worst = 0;
  for (let l = 430; l <= 680; l += 2.5) worst = Math.max(worst, Math.abs(fd / efl(p, l) - 1));
  return worst;
};

/**
 * The exchange rate, and the reason this step can compare the two currencies at
 * all. A relative focal shift R puts the image for that wavelength R·f away
 * from the d-line image; § 1.5 prices that offset at δ·NA²/(2nλ) waves at the
 * rim; and a defocus ρ² has balanced RMS equal to its rim value over 2√3 — the
 * same {piston, tilt, defocus} projection `sensitivity` performs, done in
 * closed form because a pure defocus needs no least squares.
 */
const colourWaves = (relativeFocalShift: number): number =>
  defocusWaves(relativeFocalShift * FL_MM, NA, LINE_D) / (2 * Math.sqrt(3));

const QP = superachromaticObjective({ apertureMm: AP, focalRatio: RATIO }).prescription;
/** The shipped quadruplet, with the trailing reference plane its rear surface needs. */
const QUAD = withTrailingReference(QP);
const TRI = withTrailingReference(
  apochromaticObjective({ apertureMm: AP, focalRatio: RATIO }).prescription,
);
const QUAD_COLOUR = peakColour(QUAD);

const quadSystem: OpticalSystem = {
  prescription: QUAD,
  aperture: { kind: "stopRadius", value: AP / 2 },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "infinite" },
};

/**
 * The quadruplet's OWN defining conditions, each targeted at the value the
 * nominal design already holds rather than at zero.
 *
 * Targeting nominal is what makes this a refit rather than a redesign, and it
 * is not cosmetic: § 6ax.1 measures the same doublet fit both ways and against
 * a target of zero the move comes out 36× too large at a small melt, because
 * the solve is also correcting the thick lens's own standing residual.
 *
 * The weights are the caller's job by `Compensator`'s contract — the operands
 * span a power near 4e−3 mm⁻¹ against chromatic powers near 1e−17, and this
 * module is the one entitled to state the exchange rate.
 */
const restoreOf = (p: Prescription): OptimizeOperand[] => [
  { kind: "power", wavelengthNm: LINE_D, target: power(p, LINE_D), weight: 1e3 },
  {
    kind: "chromaticPower",
    wavelengthsNm: [LINE_G, LINE_D],
    target: power(p, LINE_G) - power(p, LINE_D),
    weight: 1e3,
  },
  {
    kind: "chromaticPower",
    wavelengthsNm: [LINE_F, LINE_D],
    target: power(p, LINE_F) - power(p, LINE_D),
    weight: 1e3,
  },
  {
    kind: "chromaticPower",
    wavelengthsNm: [LINE_C, LINE_D],
    target: power(p, LINE_C) - power(p, LINE_D),
    weight: 1e3,
  },
  {
    kind: "seidelS1",
    wavelengthNm: LINE_D,
    marginalHeightMm: AP / 2,
    target: seidelSums(p, LINE_D, { marginalHeightMm: AP / 2 }).s1,
  },
];

const allCurvatures: SolveVariable[] = [0, 1, 2, 3, 4].map((s) => ({
  kind: "curvature",
  surface: s,
}));

/** Melt fitting: every radius is free, because the whole design is re-derived. */
const MELT_FIT: Compensator = {
  variables: allCurvatures,
  restore: restoreOf(QUAD),
  options: { maxIterations: 400 },
};

/**
 * The commensurate currency: blur and colour in the same unit, added in
 * quadrature. They are genuinely independent — the blur σ is measured at ONE
 * wavelength with defocus projected out, and the colour term is the defocus a
 * refocus cannot remove because it differs across the band.
 */
const totalWaves: ToleranceCurrency = (nominal, groups) => {
  const blur = sensitivity(nominal, groups[0]!).sigmaWaves;
  const perturbed = applyPerturbations(
    nominal.prescription,
    groups.flatMap((g) => g.perturbations),
  );
  return Math.hypot(blur, colourWaves(Math.abs(peakColour(perturbed) - QUAD_COLOUR)));
};

/**
 * The allowance SOLVED, walking out from a starting size rather than inverted
 * from a slope.
 *
 * § 6aw needed this because its colour currency has a kink. This step needs it
 * for a second and stronger reason: compensation removes the FIRST-ORDER term
 * by construction — that is what restoring the conditions means — so a
 * compensated row's currency is second order in the error and a slope read at
 * one probe says nothing at all about where the allowance lands.
 */
const solveFrom = (
  currency: ToleranceCurrency,
  at: (m: number) => ReturnType<ToleranceParameter["at"]>,
  share: number,
  from: number,
): number => {
  const f = (m: number): number => currency(quadSystem, [at(m)]);
  let lo = from;
  let hi = from;
  if (f(from) >= share) {
    for (let i = 0; i < 60 && f(lo) >= share; i++) {
      hi = lo;
      lo /= 1.5;
    }
  } else {
    for (let i = 0; i < 60 && f(hi) < share; i++) {
      lo = hi;
      hi *= 1.5;
    }
  }
  for (let k = 0; k < 34; k++) {
    const mid = Math.sqrt(lo * hi);
    if (f(mid) < share) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
};

const SHARE = DIFFRACTION_WAVES / Math.sqrt(14);

describe("§ 6ax.1 — a refit against the textbook achromat", () => {
  /**
   * The external pin, and the only closed form in this step that is not this
   * engine's own: the thin-lens achromatic doublet. Two conditions, total power
   * and Σφₖ/Vₖ = 0, solve for φ₁ = φ·V₁/(V₁−V₂) and φ₂ = −φ·V₂/(V₁−V₂) — in
   * every optics text, and already the split `designs/achromat` builds from.
   *
   * A melt that changes the crown's dispersion by a relative δ divides V₁ by
   * (1+δ) exactly, since V = (n_d−1)/(n_F−n_C) and only the denominator moves.
   * Put that V₁′ through the same closed form and the element powers the refit
   * must find are known before it runs. Converting them to curvatures uses the
   * same thin-element decomposition the design does, φ₁ = (n₁−1)(c₁−c₂).
   */
  const doublet = achromaticObjective({ apertureMm: 20, focalRatio: 10 });
  const D = doublet.prescription;
  const abbe = (name: string): number => {
    const m = getMedium(name);
    return (m.n(LINE_D) - 1) / (m.n(LINE_F) - m.n(LINE_C));
  };
  const V1 = abbe("N-BK7");
  const V2 = abbe("F2");
  const n1 = getMedium("N-BK7").n(LINE_D);
  const n2 = getMedium("F2").n(LINE_D);
  const phi = doublet.crownPower + doublet.flintPower;

  /** What the closed form says the two free curvatures must move by. */
  const predicted = (dv: number): [number, number] => {
    const V1p = V1 / (1 + dv);
    const dPhi1 = (phi * V1p) / (V1p - V2) - doublet.crownPower;
    const dPhi2 = (-phi * V2) / (V1p - V2) - doublet.flintPower;
    const dc2 = dPhi2 / (n2 - 1);
    return [dPhi1 / (n1 - 1) + dc2, dc2];
  };

  const fitted = (dv: number): ReturnType<typeof refit> =>
    refit(meltShift(D, "N-BK7", { dispersion: dv }), {
      variables: [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 1 },
      ],
      restore: [
        { kind: "power", wavelengthNm: LINE_D, target: power(D, LINE_D) },
        {
          kind: "chromaticPower",
          wavelengthsNm: [LINE_F, LINE_C],
          target: power(D, LINE_F) - power(D, LINE_C),
        },
      ],
    });

  it("restores both conditions exactly, and says so", () => {
    const r = fitted(1e-3);
    expect(r.converged).toBe(true);
    for (const v of r.restored) expect(Math.abs(v)).toBeLessThan(1e-15);
  });

  it("and moves the two curvatures the closed form's own amounts", () => {
    const [p1, p2] = predicted(1e-3);
    const r = fitted(1e-3);
    expect(r.moved[0]! / p1).toBeCloseTo(0.9984, 3);
    expect(r.moved[1]! / p2).toBeCloseTo(1.0064, 3);
  });

  it("with the gap CONSTANT over a hundredfold in melt size — it is the thickness", () => {
    // 0.16% and 0.64% is not agreement by luck: § 6at.8 records the same ~6%-class
    // gap between the thin-lens split and the traced answer, and attributes it to
    // the elements being thick. A contamination that is a property of the design
    // and not of the perturbation cannot move with the perturbation, and it does
    // not — five significant figures, across two decades.
    const ratios = [1e-4, 1e-3, 1e-2].map((dv) => {
      const [p1, p2] = predicted(dv);
      const r = fitted(dv);
      return [r.moved[0]! / p1, r.moved[1]! / p2] as const;
    });
    for (const [a, b] of ratios) {
      expect(a).toBeCloseTo(0.9984, 3);
      expect(b).toBeCloseTo(1.0064, 3);
    }
    const spread = (i: 0 | 1): number =>
      Math.max(...ratios.map((r) => r[i])) / Math.min(...ratios.map((r) => r[i])) - 1;
    expect(spread(0)).toBeLessThan(1e-4);
    expect(spread(1)).toBeLessThan(1e-4);
  });

  it("and against a target of ZERO instead of nominal it is 36× wrong", () => {
    // The trap, pinned so it stays shut. The doublet is thick, so its chromatic
    // power at the nominal design is 6.39e−7 rather than 0. Ask the refit to
    // reach zero and it corrects the melt AND that standing residual, and at a
    // small melt the standing residual is the larger of the two by far.
    expect(power(D, LINE_F) - power(D, LINE_C)).toBeCloseTo(6.389e-7, 9);
    const wrong = refit(meltShift(D, "N-BK7", { dispersion: 1e-4 }), {
      variables: [
        { kind: "curvature", surface: 0 },
        { kind: "curvature", surface: 1 },
      ],
      restore: [
        { kind: "power", wavelengthNm: LINE_D, target: power(D, LINE_D) },
        { kind: "chromaticPower", wavelengthsNm: [LINE_F, LINE_C], target: 0 },
      ],
    });
    const [p1] = predicted(1e-4);
    expect(wrong.moved[0]! / p1).toBeCloseTo(36.6, 0);
  });
});

describe("§ 6ax.2 — melt fitting the quadruplet", () => {
  it("the nominal design holds its five conditions to rounding", () => {
    // What makes a refit meaningful here: the conditions are not approximately
    // satisfied at the nominal, they are satisfied exactly, so any residual the
    // refit leaves is the refit's and not the design's.
    expect(power(QP, LINE_D)).toBeCloseTo(4e-3, 12);
    for (const l of [LINE_G, LINE_F, LINE_C]) {
      expect(Math.abs(power(QP, l) - power(QP, LINE_D))).toBeLessThan(1e-16);
    }
    expect(Math.abs(seidelSums(QP, LINE_D, { marginalHeightMm: AP / 2 }).s1)).toBeLessThan(1e-11);
  });

  it("a 0.1% dispersion error costs 106× the residual frozen, and 2% refitted", () => {
    const melted = meltShift(QP, "N-BK7", { dispersion: 1e-3 });
    const frozen = peakColour(melted);
    expect(frozen).toBeCloseTo(2.580e-4, 6);
    expect(frozen / QUAD_COLOUR).toBeCloseTo(105.7, 0);

    const r = refit(melted, { variables: allCurvatures, restore: restoreOf(QP) });
    expect(r.converged).toBe(true);
    expect(Math.max(...r.restored.map(Math.abs))).toBeLessThan(1e-15);
    expect(peakColour(r.prescription) / QUAD_COLOUR).toBeCloseTo(0.9839, 3);
  });

  it("and 0.5% — a thousand times § 6aw's frozen allowance — still refits to 0.93", () => {
    // § 6aw's tightest colour row is 3.37e−6 of relative curvature error; the
    // glass rows that step never wrote are tighter still, a few parts per
    // million of dispersion. This is 5e−3 of dispersion — three orders of
    // magnitude past both — and the finished lens is BETTER than nominal,
    // because the refit lands on a slightly different member of the same family.
    const r = refit(meltShift(QP, "N-BK7", { dispersion: 5e-3 }), {
      variables: allCurvatures,
      restore: restoreOf(QP),
      options: { maxIterations: 400 },
    });
    expect(r.converged).toBe(true);
    expect(peakColour(r.prescription) / QUAD_COLOUR).toBeCloseTo(0.9258, 3);
  });

  it("and it is the SAME design refitted, not another branch of the family", () => {
    // The check that separates a compensation from a coincidence. Every radius
    // moves the same way and by an amount proportional to the melt, so the
    // solver is tracking one root continuously rather than finding a different
    // one that happens to also unite four colours.
    const small = refit(meltShift(QP, "N-BK7", { dispersion: 1e-4 }), {
      variables: allCurvatures,
      restore: restoreOf(QP),
    });
    const large = refit(meltShift(QP, "N-BK7", { dispersion: 1e-3 }), {
      variables: allCurvatures,
      restore: restoreOf(QP),
    });
    for (let i = 0; i < 5; i++) {
      expect(Math.sign(small.moved[i]!)).toBe(Math.sign(large.moved[i]!));
      expect(large.moved[i]! / small.moved[i]!).toBeCloseTo(9.8, 0);
    }
    // and the relative moves stay small — a 0.1% melt is answered by radii
    // moving about 1–2.5%, not by a redesign.
    const relative = small.moved.map((m, i) => Math.abs(m / QP.surfaces[i]!.curvature));
    expect(Math.max(...relative)).toBeCloseTo(2.54e-3, 4);
  });
});

describe("§ 6ax.3 — test-plate fitting", () => {
  /**
   * The other trade, and the one that answers § 6aw's headline directly. A shop
   * grinds against a test plate it already owns, so the radius it delivers is
   * off nominal by a KNOWN amount — and the design is re-solved around it.
   */
  const forced = (eps: number): Prescription => ({
    ...QP,
    surfaces: QP.surfaces.map((s, i) =>
      i === 2 ? { ...s, curvature: s.curvature * (1 + eps) } : s,
    ),
  });
  const otherRadii: SolveVariable[] = [0, 1, 3, 4].map((s) => ({ kind: "curvature", surface: s }));
  const withThicknesses: SolveVariable[] = [
    ...otherRadii,
    ...[0, 1, 2, 3].map((s): SolveVariable => ({ kind: "thickness", surface: s })),
  ];

  it("a 1% radius error is 1216× the residual left frozen", () => {
    expect(peakColour(forced(1e-2)) / QUAD_COLOUR).toBeCloseTo(1216, -1);
  });

  it("four radii alone leave 1.16× — over-determined, so it is a compromise", () => {
    // Four free curvatures against five conditions. Least squares always lands
    // somewhere, and where it lands is a trade rather than a solution — which is
    // exactly `optimize`'s own distinction between a wish and a condition.
    const r = refit(forced(1e-2), { variables: otherRadii, restore: restoreOf(QP) });
    expect(r.converged).toBe(true);
    expect(peakColour(r.prescription) / QUAD_COLOUR).toBeCloseTo(1.159, 2);
  });

  it("add the four thicknesses and it lands exactly on nominal", () => {
    // Eight freedoms against five conditions: now the system is solvable, and
    // the damping starting from the perturbed design picks the NEAREST solution.
    // A 1% radius error — thirty times a commercial grade — costs nothing.
    const r = refit(forced(1e-2), { variables: withThicknesses, restore: restoreOf(QP) });
    expect(r.converged).toBe(true);
    expect(Math.max(...r.restored.map(Math.abs))).toBeLessThan(1e-14);
    expect(peakColour(r.prescription) / QUAD_COLOUR).toBeCloseTo(1.0, 3);
  });
});

describe("§ 6ax.4 — the two currencies, made commensurate", () => {
  it("the exchange rate is two closed forms and no external constant", () => {
    // δ·NA²/(2nλ) is § 1.5's, pinned there; /(2√3) is the balanced RMS of a
    // defocus. Checked here as an identity so a later edit to either cannot
    // silently move this step's numbers.
    const R = 1e-4;
    expect(colourWaves(R)).toBeCloseTo(
      (R * FL_MM * NA * NA) / (2 * LINE_D * 1e-6) / (2 * Math.sqrt(3)),
      12,
    );
    expect(colourWaves(R)).toBeCloseTo(2.4565e-3, 6);
  });

  it("at f/25 BOTH lenses are already inside the diffraction target", () => {
    // The number that dissolves § 6aw's verdict. Its target was the lens's own
    // residual, which for this lens is 1192× smaller than what the image can
    // actually notice — so nine rows came back "colour-bound" against a
    // requirement nobody has.
    expect(colourWaves(QUAD_COLOUR)).toBeCloseTo(5.994e-5, 7);
    expect(DIFFRACTION_WAVES / colourWaves(QUAD_COLOUR)).toBeCloseTo(1192, -1);
    expect(DIFFRACTION_WAVES / colourWaves(peakColour(TRI))).toBeCloseTo(13.0, 1);
  });

  it("but colour does NOT vanish — at the blur allowance it still breaches", () => {
    // The correction to the easy version of this story. Charged against a real
    // target the two currencies become COMPARABLE rather than one dominating:
    // the front radius at the size blur alone would permit injects 0.159 waves
    // of colour, over twice the whole budget. Neither currency is ignorable, and
    // that is why the sheet below is solved in both at once.
    const blurOnly = 6.7147e-2; // c1's allowance in the blur currency alone
    const withError = applyPerturbations(QUAD, curvatureError(QUAD, 0, blurOnly).perturbations);
    const injected = colourWaves(Math.abs(peakColour(withError) - QUAD_COLOUR));
    expect(injected).toBeCloseTo(0.159, 2);
    expect(injected / DIFFRACTION_WAVES).toBeGreaterThan(2);
  });
});

describe("§ 6ax.5 — what a refit cannot see", () => {
  it("a decentre passes through compensation to the last digit", () => {
    // Not "compensation helps a little". Every condition a refit restores —
    // power, three chromatic powers, ΣS_I — is a rotationally symmetric readout,
    // and a decentre changes none of them. The solve therefore has nothing to
    // correct, converges having moved nothing, and the row is exactly as
    // expensive as it was. This is the arity lesson of § 6av.8 once more: ask
    // what a mechanism can SEE before asking how much it helps.
    for (const m of [1e-3, 1e-2]) {
      const bare = centringError(QUAD, 2, m);
      const fit = compensated(QUAD, bare, MELT_FIT);
      expect(fit.fit.converged).toBe(true);
      expect(sensitivity(quadSystem, fit).sigmaWaves).toBeCloseTo(
        sensitivity(quadSystem, bare).sigmaWaves,
        12,
      );
    }
  });

  it("so the rows a build can design its way out of are exactly the powered ones", () => {
    // Nine of fourteen: five curvatures and four thicknesses move the conditions,
    // five centrings do not. The split is not a measurement of how hard each
    // error is — it is a statement about which errors the design still has
    // freedom over by the time they happen.
    const seen = (g: ReturnType<ToleranceParameter["at"]>): boolean => {
      const before = restoreOf(QUAD);
      const after = applyPerturbations(QUAD, g.perturbations);
      return before.some((o) => {
        if (o.kind === "power") return Math.abs(power(after, o.wavelengthNm) - o.target) > 1e-12;
        if (o.kind === "chromaticPower") {
          const v = power(after, o.wavelengthsNm[0]) - power(after, o.wavelengthsNm[1]);
          return Math.abs(v - o.target) > 1e-14;
        }
        return false;
      });
    };
    const powered = [
      ...[0, 1, 2, 3, 4].map((s) => curvatureError(QUAD, s, 1e-4)),
      ...[0, 1, 2, 3].map((s) => thicknessError(QUAD, s, 1e-2)),
    ];
    const assembly = [0, 1, 2, 3, 4].map((s) => centringError(QUAD, s, 1e-2));
    expect(powered.filter(seen)).toHaveLength(9);
    expect(assembly.filter(seen)).toHaveLength(0);
  });
});

describe("§ 6ax.6 — the drawing, after both corrections", () => {
  it("frozen but honestly targeted, the tightest radius is 0.25% — not 0.00034%", () => {
    // § 6aw's answer to the same question is 3.374e−6, and every bit of the
    // difference is the target. Same lens, same fourteen rows, same solver;
    // 0.25% of radius is a number a precision shop meets, and the § 6aw verdict
    // "not buildable to its specification" was a verdict on the specification.
    const radii = [0, 1, 2, 3, 4].map((s) =>
      solveFrom(totalWaves, (m) => curvatureError(QUAD, s, m), SHARE, 1e-3),
    );
    expect(radii.map((r) => Number(r.toPrecision(4)))).toEqual([
      1.019e-2, 3.222e-3, 2.493e-3, 3.367e-2, 6.575e-3,
    ]);
    expect(Math.min(...radii)).toBeCloseTo(2.493e-3, 5);
    expect(2.493e-3 / 3.374e-6).toBeCloseTo(739, -1);
  });

  it("and compensated, no radius or thickness constrains the lens at all", () => {
    // One evaluation per row rather than a search, because the search is the
    // expensive part and the claim is only that the currency is not reached: a
    // 1% radius error and a half-millimetre thickness error, both far past any
    // shop's grade, spend less than a fourteenth of the budget after refitting.
    for (const s of [0, 1, 2, 3, 4]) {
      const g = compensated(QUAD, curvatureError(QUAD, s, 1e-2), MELT_FIT);
      expect(g.fit.converged).toBe(true);
      expect(totalWaves(quadSystem, [g])).toBeLessThan(SHARE);
    }
    for (const s of [0, 1, 2, 3]) {
      const g = compensated(QUAD, thicknessError(QUAD, s, 0.5), MELT_FIT);
      expect(g.fit.converged).toBe(true);
      expect(totalWaves(quadSystem, [g])).toBeLessThan(SHARE);
    }
  });

  it("the tightest radius, solved after compensation, is past unity — a number, not a tolerance", () => {
    // Eight times the radius itself. § 6au's `linearity` makes the same point
    // about an allowance that leaves the regime it was measured in: this is not
    // a manufacturing number, it is the statement that this currency has stopped
    // constraining this row, and it is reported as such rather than dressed up.
    const solved = solveFrom(
      totalWaves,
      (m) => compensated(QUAD, curvatureError(QUAD, 2, m), MELT_FIT),
      SHARE,
      2.5e-3,
    );
    //
    // Deliberately NOT pinned to a digit. The value is where a damped
    // least-squares run happens to stop, and it moves 17% between
    // `maxIterations` 200 and 400 — so a pinned figure would be an assertion
    // about the solver's stopping rule wearing the costume of a physical
    // result, and would fail as a regression the next time a DLS default moves.
    // What is real here is the ORDER: past unity, and three thousandfold looser
    // than the same row frozen.
    expect(solved).toBeGreaterThan(1);
    expect(solved / 2.493e-3).toBeGreaterThan(3000);
  });

  it("what is left is five centring callouts, and they moved by nothing", () => {
    // The deliverable. Assembly errors, unchanged by the target correction (they
    // inject no colour) and unchanged by compensation (no condition sees them),
    // so this is the same list § 6aw already carried — and now it is the WHOLE
    // list rather than the easy five rows out of fourteen.
    const centring = [0, 1, 2, 3, 4].map((s) =>
      solveFrom(totalWaves, (m) => centringError(QUAD, s, m), SHARE, 1e-2),
    );
    expect(centring.map((c) => Number((c * 1000).toFixed(1)))).toEqual([
      72.5, 22.2, 14.2, 594.1, 29.4,
    ]);
    const arcmin = [0, 1, 2, 3, 4].map(
      (s) => Math.abs(equivalentWedgeDeg(QUAD, s, centring[s]!)) * 60,
    );
    expect(arcmin.map((a) => Number(a.toFixed(2)))).toEqual([7.51, 5.58, 3.32, 67.45, 5.0]);
    expect(Math.min(...centring) * 1000).toBeCloseTo(14.2, 1);

    // and each is untouched by a refit, which is the whole finding in one line
    for (const s of [0, 1, 2, 3, 4]) {
      const bare = centringError(QUAD, s, centring[s]!);
      expect(totalWaves(quadSystem, [compensated(QUAD, bare, MELT_FIT)])).toBeCloseTo(
        totalWaves(quadSystem, [bare]),
        12,
      );
    }
  });
});
