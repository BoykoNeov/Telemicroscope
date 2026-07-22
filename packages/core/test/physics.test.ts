import { describe, it, expect } from "vitest";
import { vec3, distance } from "../src/math/vec3";
import { traceRay, parallelRay } from "../src/trace/sequential";
import { systemProperties } from "../src/trace/paraxial";
import { Prescription } from "../src/trace/prescription";
import { indexD, abbeNumber, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import { N_BK7, F2 } from "../src/materials/catalog";

describe("Fermat's principle (validates OPL tracking to nm)", () => {
  it("parabola: OPL from the incoming wavefront to the focus is equal for all rays", () => {
    const R = -200;
    const parabola: Prescription = {
      surfaces: [{ kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 40, thickness: R / 2 }],
    };
    const focus = vec3(0, 0, R / 2);
    const startZ = -50; // all rays start on this plane wavefront

    const opls = [0.5, 5, 12, 20, 30, 39].map((h) => {
      const res = traceRay(parabola, parallelRay(h, LINE_D, startZ));
      expect(res.status).toBe("ok");
      // OPL to the mirror + the final leg from the hit point to the focus (in air).
      return res.opl + distance(res.path[0]!, focus);
    });

    const ref = opls[0]!;
    for (const o of opls) expect(o).toBeCloseTo(ref, 6); // equal to ~1 nm
  });

  it("sphere violates the equality (sanity check that the test can fail)", () => {
    const R = -200;
    const sphere: Prescription = {
      surfaces: [{ kind: "reflect", curvature: 1 / R, semiAperture: 40, thickness: R / 2 }],
    };
    const focus = vec3(0, 0, R / 2);
    const oplOf = (h: number) => {
      const res = traceRay(sphere, parallelRay(h, LINE_D, -50));
      return res.opl + distance(res.path[0]!, focus);
    };
    expect(Math.abs(oplOf(30) - oplOf(0.5))).toBeGreaterThan(1e-3); // µm-scale wavefront error
  });
});

describe("achromatic doublet (BK7 crown + F2 flint)", () => {
  // Thin-lens achromat design computed from the catalog itself:
  // φ1 = φ·V1/(V1−V2), φ2 = −φ·V2/(V1−V2); equiconvex crown, cemented.
  function achromat(focal: number): { doublet: Prescription; singlet: Prescription } {
    const phi = 1 / focal;
    const V1 = abbeNumber(N_BK7);
    const V2 = abbeNumber(F2);
    const n1 = indexD(N_BK7);
    const n2 = indexD(F2);
    const phi1 = (phi * V1) / (V1 - V2);
    const phi2 = (-phi * V2) / (V1 - V2);
    const R1 = (2 * (n1 - 1)) / phi1; // equiconvex crown: R2 = −R1
    const R2 = -R1;
    const R3 = 1 / (1 / R2 - phi2 / (n2 - 1));
    const doublet: Prescription = {
      surfaces: [
        // Thin elements: the thin-lens design is only achromatic in the
        // thin-lens limit; thickness adds a real chromatic residual.
        { kind: "refract", curvature: 1 / R1, semiAperture: 15, thickness: 3, medium: "N-BK7" },
        { kind: "refract", curvature: 1 / R2, semiAperture: 15, thickness: 1.5, medium: "F2" },
        { kind: "refract", curvature: 1 / R3, semiAperture: 15, thickness: 90, medium: "AIR" },
      ],
    };
    const Rs = (2 * (n1 - 1)) / phi; // equiconvex singlet of the same power
    const singlet: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / Rs, semiAperture: 15, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / Rs, semiAperture: 15, thickness: 90, medium: "AIR" },
      ],
    };
    return { doublet, singlet };
  }

  it("F−C chromatic focal shift is far smaller than the singlet's", () => {
    const { doublet, singlet } = achromat(100);
    const shift = (p: Prescription) =>
      Math.abs(systemProperties(p, LINE_F).bfd - systemProperties(p, LINE_C).bfd);
    const singletShift = shift(singlet);
    const doubletShift = shift(doublet);
    expect(doubletShift).toBeLessThan(singletShift / 10);
  });

  it("singlet chromatic shift ≈ f/V (thin-lens theory, ±20%)", () => {
    const { singlet } = achromat(100);
    const shift = Math.abs(systemProperties(singlet, LINE_F).bfd - systemProperties(singlet, LINE_C).bfd);
    const expected = 100 / abbeNumber(N_BK7);
    expect(shift).toBeGreaterThan(expected * 0.8);
    expect(shift).toBeLessThan(expected * 1.2);
  });

  it("the doublet still has roughly the design focal length at d", () => {
    const { doublet } = achromat(100);
    const efl = systemProperties(doublet, LINE_D).efl;
    expect(efl).toBeGreaterThan(90);
    expect(efl).toBeLessThan(110);
  });
});
