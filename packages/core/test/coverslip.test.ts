import { describe, it, expect } from "vitest";
import {
  NOMINAL_COVERSLIP_THICKNESS_MM,
  COVERSLIP_MEDIUM,
  coverslip,
  coverslipIndex,
  coverslipTolerance,
  apparentDepthMm,
  plateFocusShiftMm,
  plateLongitudinalAberrationMm,
  plateW040Mm,
  plateWavefrontErrorMm,
} from "../src/designs/coverslip";
import {
  finiteConjugateObjective,
  finiteConjugateMicroscope,
} from "../src/designs/microscope";
import { achromaticObjective } from "../src/designs/achromat";
import { seidelSums } from "../src/analysis/seidel";
import { LINE_D } from "../src/materials/dispersion";
import { Prescription } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";
import { OpticalSystem } from "../src/trace/system";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { objectNumericalAperture, lateralMagnification } from "../src/pupil/microscope";

/**
 * Rungs for the coverslip — docs/VALIDATION.md § 6c. The `0.17` half of the
 * `160/0.17` engraving § 6b left open.
 *
 * The plate is the strongest external pin available anywhere in this repo: its
 * aberration is solvable in closed form **to all orders** from Snell alone, so
 * the exact tracer can be checked against an exact answer at NA 0.95, where
 * every third-order comparison elsewhere in the ladder has long since become a
 * small-angle approximation. That is why § 6c.1 comes first and needs no lens.
 *
 * §§ 6c.2–6c.3 then put it in front of the DIN objective, and the headline is a
 * NULL: at NA 0.10 the correction the slip demands is 400× below the objective's
 * own residual. Low-power objectives really are coverslip-insensitive, and this
 * is where the ladder says so with a number.
 */

const LAMBDA = LINE_D;
const SLIP = coverslip();
const N_SLIP = coverslipIndex(SLIP, LAMBDA);
const T_SLIP = SLIP.thicknessMm;

/** The plate alone: specimen against the underside, one plane face, then air. */
const plateAlone: Prescription = {
  objectMedium: SLIP.medium,
  surfaces: [
    { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: 100, medium: "AIR" },
  ],
};

/** Where a ray leaving the specimen at `sinAir` (after the plate) crosses the axis. */
function tracedAxialCrossing(sinAir: number): number {
  const sinGlass = sinAir / N_SLIP;
  const tanGlass = sinGlass / Math.sqrt(1 - sinGlass * sinGlass);
  const r = makeRay(vec3(0, 0, -T_SLIP), vec3(T_SLIP * tanGlass, 0, T_SLIP), LAMBDA);
  const res = traceRay(plateAlone, r);
  expect(res.status).toBe("ok");
  const { origin, dir } = res.ray!;
  return origin.z - (origin.x * dir.z) / dir.x;
}

/** The DIN 4×/0.10, with and without the slip it is corrected for. */
const din4x = (withSlip: boolean) =>
  finiteConjugateObjective({
    magnification: 4,
    numericalAperture: 0.1,
    ...(withSlip ? { coverslip: {} } : {}),
  });

/**
 * RMS of an OPD map difference after piston and defocus are projected out —
 * the "balanced" residual the λ/14 criterion is stated on. Least squares in
 * {1, ρ²}, which is `analysis/tolerance`'s compensator move done by hand so the
 * comparison stays with the closed form rather than with another module.
 */
function balancedRms(
  a: readonly { px: number; py: number; waves: number }[],
  b: readonly { px: number; py: number; waves: number }[],
): number {
  // Pairing is by index, which is only sound while BOTH maps keep every ray. A
  // single lost sample would shift every later pairing and hand back a plausible
  // wrong number instead of a failure, so the coordinates are checked rather
  // than assumed (the callers assert `lost === 0` as well).
  expect(a.length).toBe(b.length);
  let s00 = 0, s01 = 0, s11 = 0, r0 = 0, r1 = 0;
  const rows = a.map((s, i) => {
    expect(s.px).toBe(b[i]!.px);
    expect(s.py).toBe(b[i]!.py);
    return { r2: s.px * s.px + s.py * s.py, w: s.waves - b[i]!.waves };
  });
  for (const r of rows) {
    s00 += 1;
    s01 += r.r2;
    s11 += r.r2 * r.r2;
    r0 += r.w;
    r1 += r.r2 * r.w;
  }
  const det = s00 * s11 - s01 * s01;
  const c0 = (r0 * s11 - r1 * s01) / det;
  const c1 = (s00 * r1 - s01 * r0) / det;
  let acc = 0;
  for (const r of rows) acc += (r.w - c0 - c1 * r.r2) ** 2;
  return Math.sqrt(acc / rows.length);
}

/** A slip of t + Δt with the objective moved in by the apparent depth of Δt. */
function withMismatch(system: OpticalSystem, deltaMm: number): OpticalSystem {
  const p = system.prescription;
  return {
    ...system,
    prescription: {
      ...p,
      surfaces: p.surfaces.map((s, i) =>
        i === 0 ? { ...s, thickness: s.thickness - deltaMm / N_SLIP } : s,
      ),
    },
    conjugate: { kind: "finite", distance: T_SLIP + deltaMm },
  };
}

describe("§ 6c.1 — the plate, pinned to closed forms that owe the engine nothing", () => {
  it("is the No. 1.5 cover glass, and its glass is the one § 1 sourced", () => {
    expect(NOMINAL_COVERSLIP_THICKNESS_MM).toBe(0.17);
    expect(COVERSLIP_MEDIUM).toBe("D263");
    expect(SLIP.thicknessMm).toBe(0.17);
    // Schott's Zemax catalog nd for D 263 T eco, already pinned in § 1.
    expect(N_SLIP).toBeCloseTo(1.5233, 4);
  });

  it("puts the specimen at apparent depth t/n — the traced paraxial crossing", () => {
    // The crossing tends to −t/n as the cone closes, and what is LEFT at any
    // finite angle is exactly the plate's own aberration — so the same trace
    // pins the paraxial limit and the departure from it.
    expect(tracedAxialCrossing(1e-6)).toBeCloseTo(-apparentDepthMm(T_SLIP, N_SLIP), 12);
    const residual = tracedAxialCrossing(1e-4) + apparentDepthMm(T_SLIP, N_SLIP);
    expect(residual / plateLongitudinalAberrationMm(T_SLIP, N_SLIP, 1e-4)).toBeCloseTo(1, 6);
    // The complement: what the plate does to a converging beam is push focus back.
    expect(apparentDepthMm(T_SLIP, N_SLIP) + plateFocusShiftMm(T_SLIP, N_SLIP)).toBeCloseTo(
      T_SLIP,
      15,
    );
  });

  it("matches the EXACT longitudinal aberration to ten digits, up to NA 0.95", () => {
    // LSA = t·(1/n − tanθ′/tanθ). All orders — no third-order truncation — so
    // this holds where every other spherical-aberration rung in the ladder has
    // stopped being able to say anything.
    for (const NA of [0.1, 0.25, 0.5, 0.65, 0.85, 0.95]) {
      const traced = tracedAxialCrossing(NA) - -apparentDepthMm(T_SLIP, N_SLIP);
      const closed = plateLongitudinalAberrationMm(T_SLIP, N_SLIP, NA);
      expect(traced / closed).toBeCloseTo(1, 10);
    }
  });

  it("is OVERcorrected — the opposite sign to a positive lens", () => {
    // The marginal crossing lands BEYOND the paraxial one. A converging singlet
    // does the reverse, and the two signs in the engine's own Seidel convention
    // are what makes the coverslip correctable by a deliberately aberrated lens.
    expect(plateLongitudinalAberrationMm(T_SLIP, N_SLIP, 0.65)).toBeGreaterThan(0);
    const singlet: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 50, semiAperture: 5, thickness: 2, medium: "N-BK7", isStop: true },
        { kind: "refract", curvature: 0, semiAperture: 5, thickness: 100, medium: "AIR" },
      ],
    };
    expect(seidelSums(singlet, LAMBDA, { marginalHeightMm: 5 }).s1).toBeGreaterThan(0);
    const sinGlass = 0.1 / N_SLIP;
    const tanGlass = sinGlass / Math.sqrt(1 - sinGlass * sinGlass);
    expect(
      seidelSums(plateAlone, LAMBDA, {
        marginalHeightMm: T_SLIP * tanGlass,
        objectDistanceMm: T_SLIP,
      }).s1,
    ).toBeLessThan(0);
  });

  it("carries the published third-order coefficient at low NA — sines, as microscopy quotes it", () => {
    // |W₀₄₀| = t(n²−1)·NA⁴/(8n³), the coefficient every coverslip tolerance in
    // the literature is computed from. The engine seeds its marginal ray with a
    // paraxial SLOPE, so its own answer is the tangent version of the same
    // third-order truth; they agree where a tangent is a sine and not elsewhere.
    const engineW040 = (NA: number): number => {
      const sinGlass = NA / N_SLIP;
      const tanGlass = sinGlass / Math.sqrt(1 - sinGlass * sinGlass);
      return Math.abs(
        seidelSums(plateAlone, LAMBDA, {
          marginalHeightMm: T_SLIP * tanGlass,
          objectDistanceMm: T_SLIP,
        }).w040,
      );
    };
    // The gap is (1 − (NA/n)²)^−2 exactly: 0.22% at NA 0.05, 0.87% at NA 0.10.
    expect(engineW040(0.05) / plateW040Mm(T_SLIP, N_SLIP, 0.05)).toBeCloseTo(1.00216, 4);
    expect(engineW040(0.1) / plateW040Mm(T_SLIP, N_SLIP, 0.1)).toBeCloseTo(1.00868, 4);
    // …and the two conventions part company at exactly (1 − (NA/n)²)^−2, so the
    // gap reaches 10% at NA 0.33 and is nearly 2× by NA 0.8. Neither is wrong;
    // a plot that does not say which it drew is.
    expect(engineW040(0.33) / plateW040Mm(T_SLIP, N_SLIP, 0.33)).toBeGreaterThan(1.1);
    expect(engineW040(0.32) / plateW040Mm(T_SLIP, N_SLIP, 0.32)).toBeLessThan(1.1);
    expect(engineW040(0.8) / plateW040Mm(T_SLIP, N_SLIP, 0.8)).toBeCloseTo(1.9067, 3);
  });

  it("has W₀₄₀ as the leading term of the exact wavefront, and third order fails by 10% at NA 0.36", () => {
    const ratio = (NA: number): number =>
      plateWavefrontErrorMm(T_SLIP, N_SLIP, NA) / plateW040Mm(T_SLIP, N_SLIP, NA);
    // The next term is O(s²) relative and its coefficient is (1 + 1/n²)/2 —
    // 0.7155 for this glass — which the exact form reproduces across two
    // decades of aperture. Third order is therefore good to a part in 10⁶ at
    // NA 0.001 and to 0.7% at NA 0.10.
    const nextTerm = (1 + 1 / (N_SLIP * N_SLIP)) / 2;
    for (const s of [1e-3, 1e-2, 5e-2]) {
      expect((ratio(s) - 1) / (s * s)).toBeCloseTo(nextTerm, 2);
    }
    expect(ratio(0.1)).toBeCloseTo(1.0072, 3);
    expect(ratio(0.35)).toBeLessThan(1.1);
    expect(ratio(0.36)).toBeGreaterThan(1.1);
    // Which is the whole reason a high-NA objective needs a correction COLLAR
    // rather than a nominal figure: by NA 0.65 the third-order estimate of the
    // damage is 43% low.
    expect(ratio(0.65)).toBeCloseTo(1.434, 2);
  });

  it("is EXACTLY linear in thickness, to all orders — which makes mismatch one number", () => {
    for (const NA of [0.1, 0.5, 0.9]) {
      expect(
        plateWavefrontErrorMm(2 * T_SLIP, N_SLIP, NA) / plateWavefrontErrorMm(T_SLIP, N_SLIP, NA),
      ).toBe(2);
      expect(
        plateLongitudinalAberrationMm(3 * T_SLIP, N_SLIP, NA) /
          plateLongitudinalAberrationMm(T_SLIP, N_SLIP, NA),
      ).toBeCloseTo(3, 12);
    }
  });

  it("scales as NA⁴, so the thickness tolerance scales as 1/NA⁴", () => {
    const at = (NA: number) => coverslipTolerance(NA, LAMBDA, N_SLIP);
    expect(at(0.2).quarterWaveMm / at(0.4).quarterWaveMm).toBeCloseTo(16, 9);
    // The two criteria differ by 6√5/14·4 — a factor of 3.83 — which is why a
    // quoted tolerance without its criterion is unusable.
    expect(at(0.5).marechalMm / at(0.5).quarterWaveMm).toBeCloseTo((4 * 6 * Math.sqrt(5)) / 14, 9);
    // The classical numbers: a 0.95 dry objective is held to a few microns, and
    // a 4×/0.10 to THIRTY MILLIMETRES. Same glass, same formula, NA⁴ apart.
    expect(at(0.95).quarterWaveMm * 1000).toBeCloseTo(3.86, 1);
    expect(at(0.65).quarterWaveMm * 1000).toBeCloseTo(17.6, 1);
    expect(at(0.1).quarterWaveMm).toBeGreaterThan(30);
  });

  it("refuses a slip it cannot mean", () => {
    expect(() => coverslip({ thicknessMm: 0 })).toThrow(/positive/);
    expect(() => coverslip({ thicknessMm: Infinity })).toThrow(/finite/);
    expect(() => coverslip({ medium: "NOT-A-GLASS" })).toThrow(/unknown medium/);
    expect(() => plateLongitudinalAberrationMm(0.17, 1.52, 1.0)).toThrow(/sinTheta/);
    expect(() => coverslipTolerance(0, LAMBDA, N_SLIP)).toThrow(/NA/);
  });
});

describe("§ 6c.2 — the DIN objective re-solved through the slip", () => {
  it("places the lens by the apparent depth — solved on the trace, never evaluated", () => {
    const o = din4x(true);
    // `finiteConjugateObjective` finds the air gap by a secant on the traced
    // paraxial chain. That it lands on a − t/n to eleven digits is therefore a
    // measurement of the closed form, not a restatement of it.
    expect(o.airEquivalentObjectDistanceMm - o.airGapMm).toBeCloseTo(
      apparentDepthMm(T_SLIP, N_SLIP),
      11,
    );
    expect(o.objectDistanceMm).toBe(T_SLIP);
    expect(o.airGapMm).toBeLessThan(o.airEquivalentObjectDistanceMm);
    // Free working distance is the air the slide has to fit in, less the front
    // surface's own sag — both terms, not just the slip.
    expect(o.freeWorkingDistanceMm).toBeLessThan(o.airGapMm);
    expect(o.airGapMm - o.freeWorkingDistanceMm).toBeGreaterThan(0.1);
  });

  it("makes the PAIR stigmatic, and the glass alone deliberately is not", () => {
    const o = din4x(true);
    // Total third-order spherical aberration of slip + objective: zero.
    expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(
      1e-9 * Math.abs(o.seidelS1OfGlassAlone),
    );
    // The glass on its own carries exactly PLUS the plate's contribution — the
    // closed form S_I = −t·(n²−1)·u⁴/n³ at the working slope, which the design
    // never evaluated (it summed real surfaces instead).
    const u = o.stopRadiusMm / o.airEquivalentObjectDistanceMm;
    const plateS1 = (-T_SLIP * u ** 4 * (N_SLIP * N_SLIP - 1)) / N_SLIP ** 3;
    expect(o.seidelS1OfGlassAlone / -plateS1).toBeCloseTo(1, 9);
    // Whereas the objective corrected for NO slip is nulled on its own.
    const bare = din4x(false);
    expect(Math.abs(bare.seidelS1OfGlassAlone)).toBeLessThan(1e-12);
  });

  it("carries the correction through the turn-around by reciprocity", () => {
    // The bending is solved in the REVERSED frame — specimen side is the image
    // side there — so the plate's target is computed at conjugate b and the null
    // is then measured at conjugate a. Nothing forces those to agree; that they
    // do is the § 6b.1 reciprocity statement surviving an extra surface.
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      const o = finiteConjugateObjective({
        magnification: 4,
        numericalAperture: 0.1,
        coverslip: {},
        orientation,
      });
      expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(
        1e-9 * Math.abs(o.seidelS1OfGlassAlone),
      );
    }
  });

  it("moves the bending — and at NA 0.10 that is worth ~1e-4 waves, which is the finding", () => {
    const bare = din4x(false);
    const slip = din4x(true);
    // A real, resolvable change in the design…
    const shift = Math.abs(slip.doublet.curvatures[0] / bare.doublet.curvatures[0] - 1);
    expect(shift).toBeGreaterThan(1e-4);
    // …and an utterly negligible one optically. The plate asks for W₀₄₀ of
    // |target|/8 mm; balanced, that is RMS = W₀₄₀/(6√5), some 400× under the
    // objective's own fifth-order residual. THIS is why a 4×/0.10 is not
    // engraved with a coverslip requirement and works fine either way.
    const askedFor = Math.abs(slip.doublet.targetS1Mm) / 8;
    const balancedWaves = askedFor / (6 * Math.sqrt(5)) / (LAMBDA * 1e-6);
    expect(balancedWaves).toBeLessThan(2e-4);
    const s = finiteConjugateMicroscope({ objective: slip }).system;
    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const own = opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).rmsWaves;
    expect(own / balancedWaves).toBeGreaterThan(300);
  });

  it("still delivers its NA, its magnification, and exactly one aperture stop", () => {
    const o = din4x(true);
    // The slip's upper face takes the front of the list, so the stop moves to
    // surface 1 — and stays a single flag, the § 6a one-aperture rule.
    expect(o.stopSurfaceIndex).toBe(1);
    expect(o.prescription.surfaces.filter((s) => s.isStop).length).toBe(1);
    expect(o.prescription.surfaces[1]!.isStop).toBe(true);
    expect(o.prescription.objectMedium).toBe(SLIP.medium);
    expect(o.prescription.surfaces[0]!.curvature).toBe(0);

    const m = finiteConjugateMicroscope({ objective: o });
    expect(m.prescription.surfaces.filter((s) => s.isStop).length).toBe(1);
    // NA is read at the specimen INSIDE the glass, n·sin u — which is why the
    // stop had to be sized against the plate-shifted entrance pupil, and it is
    // exact rather than nearly right.
    expect(objectNumericalAperture(m.system, LAMBDA)).toBeCloseTo(0.1, 10);
    expect(lateralMagnification(m.system, 1e-4, LAMBDA)).toBeCloseTo(-4, 5);
    expect(opdMap(m.system, 0, LAMBDA, pupilGrid(21)).lost).toBe(0);
  });

  it("…and the NEGATIVE control: a stop sized as if the slip were not there", () => {
    // The plate pushes the entrance pupil back to n·(air gap), so the cone that
    // fills the stop is (t + n·w)·tan u_glass with sin u_glass = NA/n. Sizing it
    // the bare way — a_air·tan u_air, the § 6b formula — over-fills the pupil and
    // the readout SEES it: 0.10029 for a lens labelled 0.10. Small, and exactly
    // the shape of § 6a.4's "2% fast" and § 6b.4's "nine times more expensive"
    // rungs. Without this control the exact NA above only proves the readout and
    // the sizing share an arithmetic, not that either is right.
    const o = din4x(true);
    const m = finiteConjugateMicroscope({ objective: o });
    const naive =
      (o.airEquivalentObjectDistanceMm * 0.1) / Math.sqrt(1 - 0.1 * 0.1);
    // The two sizings differ by √((1−(NA/n)²)/(1−NA²)) exactly — 0.287% here.
    const overSized = Math.sqrt((1 - (0.1 / N_SLIP) ** 2) / (1 - 0.01));
    expect(naive / o.stopRadiusMm).toBeCloseTo(overSized, 12);
    expect(overSized - 1).toBeCloseTo(0.00287, 5);
    const misSized = { ...m.system, aperture: { kind: "stopRadius" as const, value: naive } };
    const delivered = objectNumericalAperture(misSized, LAMBDA);
    expect(delivered).toBeCloseTo(0.1002857, 6);
    // The NA error tracks the stop error almost 1:1 — the launch angle is nearly
    // linear in pupil height this slow — so the readout reports essentially the
    // whole mis-sizing rather than absorbing it.
    expect((delivered / 0.1 - 1) / (overSized - 1)).toBeCloseTo(1, 2);
  });

  it("tells a caller when no bending can absorb the plate", () => {
    // A target the glass pair cannot reach is a different failure from a pair
    // that admits no solution at all, and § 6c's message says which.
    expect(() =>
      achromaticObjective({ apertureMm: 10, focalRatio: 5, targetS1Mm: 1e6 }),
    ).toThrow(/absorbs that much external spherical aberration/);
    expect(() => achromaticObjective({ apertureMm: 10, focalRatio: 5, targetS1Mm: NaN })).toThrow(
      /finite/,
    );
    // …and the zero-target message is unchanged for the classical failure.
    expect(() =>
      achromaticObjective({ apertureMm: 10, focalRatio: 5, crownMedium: "CAF2", flintMedium: "F2" }),
    ).toThrow(/does not admit the classical doublet solution/);
  });
});

describe("§ 6c.3 — coverslip MISMATCH: the wrong slip on the right objective", () => {
  /**
   * The controlled experiment: the specimen goes Δt deeper into glass and the
   * objective moves in by Δt/n, so every paraxial conjugate — and the
   * magnification with it — is untouched and the ONLY change in the chain is
   * that Δt of glass has replaced Δt/n of air. What is left in the wavefront
   * difference is the plate's mismatch and nothing else.
   */
  const objective = din4x(true);
  const system = finiteConjugateMicroscope({ objective }).system;
  const grid = pupilGrid(41);
  const reference = opdMap(system, 0, LAMBDA, grid);
  const measured = (deltaMm: number): number => {
    const got = opdMap(withMismatch(system, deltaMm), 0, LAMBDA, grid);
    expect(got.lost).toBe(0);
    expect(reference.lost).toBe(0);
    return balancedRms(got.samples, reference.samples);
  };
  const predicted = (deltaMm: number): number =>
    plateW040Mm(deltaMm, N_SLIP, 0.1) / (6 * Math.sqrt(5)) / (LAMBDA * 1e-6);

  it("is exactly linear in the thickness error, over two decades of it", () => {
    // The plate's closed form carries t as a bare factor, so mismatch is the
    // aberration of a plate of the ERROR alone. The traced wavefront agrees to
    // parts in 10⁴ across a factor of 100 in Δt.
    const ratios = [0.01, 0.05, 0.2, 1.0].map((dt) => measured(dt) / predicted(dt));
    for (const r of ratios) expect(r / ratios[0]!).toBeCloseTo(1, 3);
  });

  it("matches the published closed form to 3%, and the deficit is the LENS's", () => {
    expect(measured(0.05) / predicted(0.05)).toBeCloseTo(1, 1);
    expect(measured(0.05) / predicted(0.05)).toBeGreaterThan(0.95);
    // The 2.4% shortfall is not the formula: moving the objective by the
    // PARAXIAL apparent depth leaves the real marginal ray landing a hair off
    // its old height, so a sliver of the objective's own (large) fifth-order
    // residual rides along. Slow the objective down at fixed NA — where § 6b.4
    // pins the residual falling 16× from 4× to 20× — and the deficit collapses
    // with it, which is what identifies whose it is.
    const deficitAt = (M: number): number => {
      const o = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1, coverslip: {} });
      const s = finiteConjugateMicroscope({ objective: o }).system;
      const ref = opdMap(s, 0, LAMBDA, grid);
      const mm = opdMap(withMismatch(s, 0.05), 0, LAMBDA, grid);
      expect(ref.lost).toBe(0);
      expect(mm.lost).toBe(0);
      return 1 - balancedRms(mm.samples, ref.samples) / predicted(0.05);
    };
    const [d4, d20] = [deficitAt(4), deficitAt(20)];
    expect(d4).toBeGreaterThan(0.02);
    expect(d20).toBeLessThan(0.01);
    expect(d4 / d20).toBeGreaterThan(3);
  });

  it("cannot spoil a 4×/0.10 at any thickness a real slip could have", () => {
    // Δt of a whole millimetre — six times a coverslip — is still a twentieth
    // of the objective's own error, and the tolerance says 31 mm. A low-power
    // objective is coverslip-INSENSITIVE, and the ladder should say so with a
    // number rather than leave it implied.
    expect(measured(1.0)).toBeLessThan(1e-3);
    const focus = bestFocus(system, "minRmsWavefront", { pupilSamples: 21 });
    const own = opdMap(withFocus(system, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21))
      .rmsWaves;
    expect(measured(1.0) / own).toBeLessThan(0.05);
    expect(coverslipTolerance(0.1, LAMBDA, N_SLIP).quarterWaveMm).toBeGreaterThan(30);
  });
});
