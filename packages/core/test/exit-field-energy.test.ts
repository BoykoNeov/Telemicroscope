import { describe, it, expect } from "vitest";
import { systemPupil, transmittedEnergy, type PupilLayout } from "../src/wave/psf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { heroPair, heroSystem } from "./support/heroScene";
import { exactPupilEnergy, exitOutlineArea } from "./support/exitEnergy";

/**
 * § 2l — the exit layout's energy across the field: the edge's count, not the light.
 *
 * § 2j left the exit layout's transmitted energy drifting 2.4e-4 from 0° to 2°
 * on `extended`'s hero achromat, where the aim layout reads 7.7e-7 and § 5v.1
 * asserts below 1e-6 — measured, not traced, and item 24's to close before
 * `extended` flips.
 *
 * **Hypothesis.** The drift is the pupil grid's edge cells counting an outline
 * that changes shape with field; the aim layout draws the same circle at every
 * field, so its count error repeats and cancels. **Refuted by** the drift not
 * shrinking as the grid refines, or a grid-free total at 2° missing the aim
 * layout's by more than 1e-5.
 *
 * The first half did not hold as written: at the default edge refinement the
 * drift reads 2.45e-4, 1.26e-5, −4.81e-5 at 64, 128, 256 pupil samples — it grew
 * on the last step, as a lattice count's error does. What settles it is the two
 * rungs below that have no grid in them (§ 2l.1, § 2l.2) and the one that shows
 * the grid's number is a function of the edge's sub-sample lattice alone
 * (§ 2l.3). Unvignetted only: the vignette mask's path is not measured here.
 */

const L = 550;
const achromat = (() => {
  const base = heroSystem(heroPair().achromat);
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: L });
  return withFocus(base, focus.offsetFromLastVertex);
})();

const pupilOf = (fieldDeg: number, layout: PupilLayout) =>
  systemPupil(achromat, fieldDeg, L, { layout, traceSamples: 21 }).pupil;
const X0 = pupilOf(0, "exit");
const X2 = pupilOf(2, "exit");
const A0 = pupilOf(0, "aim");
const A2 = pupilOf(2, "aim");
/** The grid's drift 0° → 2°, at `pupilSamples` across and `edge` sub-samples per edge cell. */
const gridDrift = (at0: typeof X0, at2: typeof X0, pupilSamples: number, edge: number) =>
  transmittedEnergy(at2, pupilSamples, 2 * pupilSamples, edge) /
    transmittedEnergy(at0, pupilSamples, 2 * pupilSamples, edge) -
  1;

describe("§ 2l.1 — the brightness map is the light: no grid, the two layouts agree", () => {
  it("the exit pupil, carried back onto the aim disc, holds the aim layout's energy", () => {
    // ∫|P|² dA_exit = ∫|P(e(a))|²·|∂e/∂a| dA_aim: § 2j's irradiance S/|∂e/∂a|
    // with S uniform for a plane wave, so the product is the aim layout's
    // throughput point for point. Measured 1.8e-8 on the axis and 2.8e-8 at 2°.
    for (const f of [0, 2]) {
      const exit = exactPupilEnergy(achromat, f, L, "exit");
      const aim = exactPupilEnergy(achromat, f, L, "aim");
      expect(Math.abs(exit / aim - 1)).toBeLessThan(1e-7);
    }
  });

  it("and the rule is resolved, not arrived at", () => {
    // 24×128 against 48×256 nodes: 3.8e-14 apart. The integrand is smooth
    // inside the rim, so the radial Gauss rule is converged at the coarser one.
    const coarse = exactPupilEnergy(achromat, 2, L, "exit");
    const fine = exactPupilEnergy(achromat, 2, L, "exit", { radial: 48, angular: 256 });
    expect(Math.abs(fine / coarse - 1)).toBeLessThan(1e-12);
  });
});

describe("§ 2l.2 — the outline the grid sums inside is the aim circle's image", () => {
  it("the 32-ray rim holds the area of a 720-ray one, at every field", () => {
    // The grid sums |P|² inside `exitCoordinatePupil`'s support, the 32 rim rays
    // joined linearly in angle; § 2l.1 integrates over the image of the aim
    // circle. They are one region if the two areas agree — the same
    // construction on both sides, so neither carries a polygon's bias the
    // other does not. Measured: 3e-15, 1.9e-10, 1.1e-8 at 0°, 1°, 2°.
    for (const f of [0, 1, 2]) {
      expect(Math.abs(exitOutlineArea(achromat, f, L) / exitOutlineArea(achromat, f, L, 720) - 1)).toBeLessThan(5e-8);
    }
  });

  it("and it does change shape with field — which is what the grid's count sees", () => {
    // A circle of area π on the axis, to rounding; 2.4e-3 smaller at 2°, the
    // foreshortening § 2j's irradiance pays back. The aim layout's outline is
    // the unit circle at every field.
    expect(Math.abs(exitOutlineArea(achromat, 0, L) / Math.PI - 1)).toBeLessThan(1e-12);
    expect(exitOutlineArea(achromat, 2, L) / Math.PI).toBeLessThan(0.998);
  });
});

describe("§ 2l.3 — the grid's drift is a function of the edge's sub-sample lattice alone", () => {
  it("two grids that sub-sample the edge on one lattice read one drift", () => {
    // `pupilSampling` refines an edge cell on `edge`² sub-samples, so 64 samples
    // at 4 and 128 at 2 put the edge's points on the same 1/128 lattice; only the
    // interior's midpoint rule differs. Measured ≤ 3.5e-10 apart, on drifts of
    // 2.4e-4, 1.3e-5 and −4.8e-5.
    for (const [n, edge] of [
      [64, 4],
      [64, 8],
      [64, 16],
    ] as const) {
      expect(Math.abs(gridDrift(X0, X2, n, edge) - gridDrift(X0, X2, 2 * n, edge / 2))).toBeLessThan(2e-9);
    }
  });

  it("…while three different lattices read drifts of either sign, 2.9e-4 apart", () => {
    // Counting noise, not a converging error: 2.45e-4, 1.26e-5, −4.81e-5.
    const drifts = [4, 8, 16].map((edge) => gridDrift(X0, X2, 64, edge));
    expect(Math.max(...drifts) - Math.min(...drifts)).toBeGreaterThan(1e-4);
    expect(Math.max(...drifts)).toBeGreaterThan(0);
    expect(Math.min(...drifts)).toBeLessThan(0);
  });
});

describe("§ 2l.4 — the aim layout's 7.7e-7 is the light's, not the lattice's", () => {
  it("it reads the same on nine grids and with none", () => {
    // § 5v.1 called it "the pupil lattice's own quantization". On this doublet it
    // is not: −7.7231e-7 to −7.7053e-7 across 64/128/256 samples at 1, 4 and 16
    // edge sub-samples, and −7.7228e-7 integrated with no grid. What it is has
    // not been traced here.
    const exact = exactPupilEnergy(achromat, 2, L, "aim") / exactPupilEnergy(achromat, 0, L, "aim") - 1;
    for (const n of [64, 128, 256]) {
      for (const edge of [1, 4, 16]) {
        expect(Math.abs(gridDrift(A0, A2, n, edge) - exact)).toBeLessThan(1e-8);
      }
    }
    expect(exact).toBeLessThan(-5e-7);
  });
});
