import { describe, it, expect } from "vitest";
import { systemProperties } from "../src/trace/paraxial";
import { Prescription } from "../src/trace/prescription";
import { indexD, LINE_D } from "../src/materials/dispersion";
import { N_BK7 } from "../src/materials/catalog";

/** Biconvex BK7 singlet, |R| = 50 mm, center thickness t. */
function singlet(t: number): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: 1 / 50, semiAperture: 15, thickness: t, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 50, semiAperture: 15, thickness: 40, medium: "AIR" },
    ],
  };
}

describe("paraxial engine vs thick lensmaker's equation", () => {
  it("EFL matches 1/f = (n−1)[1/R1 − 1/R2 + (n−1)t/(nR1R2)]", () => {
    const t = 6;
    const n = indexD(N_BK7);
    const R1 = 50, R2 = -50;
    const invF = (n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * t) / (n * R1 * R2));
    const props = systemProperties(singlet(t), LINE_D);
    expect(props.efl).toBeCloseTo(1 / invF, 9);
  });

  it("BFD = f·(1 − (n−1)t/(nR1)) (principal-plane shift)", () => {
    const t = 6;
    const n = indexD(N_BK7);
    const R1 = 50;
    const props = systemProperties(singlet(t), LINE_D);
    const expectedBfd = props.efl * (1 - ((n - 1) * t) / (n * R1));
    expect(props.bfd).toBeCloseTo(expectedBfd, 9);
  });

  it("thin-lens limit: EFL → R/(2(n−1))", () => {
    const props = systemProperties(singlet(1e-9), LINE_D);
    const n = indexD(N_BK7);
    expect(props.efl).toBeCloseTo(50 / (2 * (n - 1)), 6);
  });
});
