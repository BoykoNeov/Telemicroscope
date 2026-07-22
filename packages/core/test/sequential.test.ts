import { describe, it, expect } from "vitest";
import { vec3 } from "../src/math/vec3";
import { makeRay } from "../src/trace/ray";
import { traceRay, parallelRay, axialCrossingZ } from "../src/trace/sequential";
import { systemProperties } from "../src/trace/paraxial";
import { Prescription, vertexPositions } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";

const SINGLET: Prescription = {
  surfaces: [
    { kind: "refract", curvature: 1 / 50, semiAperture: 15, thickness: 6, medium: "N-BK7" },
    { kind: "refract", curvature: -1 / 50, semiAperture: 15, thickness: 40, medium: "AIR" },
  ],
};

describe("exact tracer vs paraxial (small-height limit)", () => {
  it("a near-axis parallel ray focuses at the paraxial BFD", () => {
    const props = systemProperties(SINGLET, LINE_D);
    const zLastVertex = vertexPositions(SINGLET)[1]!; // = 6
    const res = traceRay(SINGLET, parallelRay(0.01, LINE_D));
    expect(res.status).toBe("ok");
    const focusZ = axialCrossingZ(res.ray!);
    expect(focusZ - zLastVertex).toBeCloseTo(props.bfd, 4);
  });
});

describe("spherical aberration of a positive singlet", () => {
  it("marginal rays focus SHORTER than paraxial (undercorrected)", () => {
    const paraxialFocus = axialCrossingZ(traceRay(SINGLET, parallelRay(0.01, LINE_D)).ray!);
    const marginalFocus = axialCrossingZ(traceRay(SINGLET, parallelRay(12, LINE_D)).ray!);
    expect(marginalFocus).toBeLessThan(paraxialFocus - 0.5); // clearly shorter, not noise
  });
});

describe("mirrors", () => {
  const R = -200; // concave, facing the incoming light (center of curvature at z = −200)

  it("parabolic mirror (k=−1) focuses ALL rays at R/2 to ~1 nm", () => {
    const parabola: Prescription = {
      surfaces: [{ kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 40, thickness: R / 2 }],
    };
    for (const h of [1, 5, 10, 20, 30, 39]) {
      const res = traceRay(parabola, parallelRay(h, LINE_D, -50));
      expect(res.status).toBe("ok");
      expect(axialCrossingZ(res.ray!)).toBeCloseTo(R / 2, 6); // 1e-6 mm = 1 nm
    }
  });

  it("spherical mirror shows spherical aberration (marginal ≠ R/2)", () => {
    const sphere: Prescription = {
      surfaces: [{ kind: "reflect", curvature: 1 / R, semiAperture: 40, thickness: R / 2 }],
    };
    const marginal = axialCrossingZ(traceRay(sphere, parallelRay(30, LINE_D, -50)).ray!);
    expect(Math.abs(marginal - R / 2)).toBeGreaterThan(1); // mm-scale LSA at this aperture
    // and the near-axis ray still agrees with R/2
    const paraxial = axialCrossingZ(traceRay(sphere, parallelRay(0.01, LINE_D, -50)).ray!);
    expect(paraxial).toBeCloseTo(R / 2, 5);
  });
});

describe("failure modes", () => {
  it("vignetting at the aperture edge", () => {
    const res = traceRay(SINGLET, parallelRay(14.99, LINE_D));
    expect(res.status).toBe("ok");
    const clipped = traceRay(SINGLET, parallelRay(15.5, LINE_D));
    expect(clipped.status).toBe("vignetted");
    expect(clipped.failedAt).toBe(0);
  });

  it("TIR inside glass beyond the critical angle", () => {
    // Ray already inside BK7 hitting a flat exit face at 45° (> critical ≈ 41.2°).
    const flatExit: Prescription = {
      objectMedium: "N-BK7",
      surfaces: [{ kind: "refract", curvature: 0, semiAperture: 50, thickness: 10, medium: "AIR" }],
    };
    const d = Math.SQRT1_2;
    const res = traceRay(flatExit, makeRay(vec3(0, 0, -5), vec3(d, 0, d), LINE_D));
    expect(res.status).toBe("tir");
  });

  it("missing the surface entirely", () => {
    const steep: Prescription = {
      surfaces: [{ kind: "refract", curvature: 1 / 10, semiAperture: 9, thickness: 5, medium: "N-BK7" }],
    };
    const res = traceRay(steep, parallelRay(50, LINE_D));
    expect(res.status).toBe("miss");
  });
});
