import { describe, it, expect } from "vitest";
import { vec3, sub, cross, length, normalize, dot } from "../src/math/vec3";
import { makeRay } from "../src/trace/ray";
import { traceRay, parallelRay } from "../src/trace/sequential";
import { compile } from "../src/trace/compile";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { N_BK7 } from "../src/materials/catalog";

describe("compiled systems trace identically to uncompiled ones", () => {
  const SINGLET: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 50, semiAperture: 15, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 50, semiAperture: 15, thickness: 40, medium: "AIR" },
    ],
  };

  it("explicit compile() and implicit compilation agree exactly", () => {
    const sys = compile(SINGLET);
    for (const h of [0.01, 3, 7, 12]) {
      const a = traceRay(SINGLET, parallelRay(h, LINE_D));
      const b = traceRay(sys, parallelRay(h, LINE_D));
      expect(b.status).toBe(a.status);
      expect(b.opl).toBe(a.opl); // bit-identical, not merely close
      expect(b.ray!.dir.x).toBe(a.ray!.dir.x);
    }
  });

  it("the per-wavelength index table matches direct dispersion evaluation", () => {
    const sys = compile(SINGLET);
    for (const nm of [450, 550, 650]) {
      const table = sys.indices(nm);
      expect(table[0]).toBe(1.0); // object medium: AIR
      expect(table[1]).toBeCloseTo(N_BK7.n(nm), 15);
      expect(table[2]).toBe(1.0); // back in air
    }
  });
});

/**
 * Rung: lateral displacement of a tilted plane-parallel plate.
 *   d = t·sin(i)·[1 − cos(i)/(n·cos r)],   sin r = sin(i)/n
 * A standard closed form (Hecht, Optics). Validates the tilt/decenter frame
 * chain together with vector refraction: the emergent ray must be parallel to
 * the incident one and offset by exactly d.
 */
describe("tilted plane-parallel plate (validates the tilted frame chain)", () => {
  const t = 10; // plate thickness, mm
  const n = N_BK7.n(LINE_D);

  function plate(tiltDeg: number): Prescription {
    return {
      surfaces: [
        // Tilt applies to surface 0; surface 1 inherits that frame, so the two
        // faces stay parallel and `thickness` advances along the plate normal.
        {
          kind: "refract",
          curvature: 0,
          semiAperture: 40,
          thickness: t,
          medium: "N-BK7",
          tiltYDeg: tiltDeg,
        },
        { kind: "refract", curvature: 0, semiAperture: 40, thickness: 30, medium: "AIR" },
      ],
    };
  }

  for (const tiltDeg of [10, 20, 30, 40]) {
    it(`tilt ${tiltDeg}°: displacement matches the closed form`, () => {
      const res = traceRay(plate(tiltDeg), parallelRay(0, LINE_D, -20));
      expect(res.status).toBe("ok");

      const incidentDir = vec3(0, 0, 1);
      const out = res.ray!;

      // The emergent ray must be parallel to the incident ray.
      expect(dot(out.dir, incidentDir)).toBeCloseTo(1, 12);

      // Perpendicular distance between the incident line (through the origin,
      // along z) and the emergent line.
      const offset = sub(out.origin, vec3(0, 0, 0));
      const perpendicular = length(cross(offset, normalize(incidentDir)));

      const i = (tiltDeg * Math.PI) / 180;
      const r = Math.asin(Math.sin(i) / n);
      const expected = t * Math.sin(i) * (1 - Math.cos(i) / (n * Math.cos(r)));

      expect(perpendicular).toBeCloseTo(expected, 9);
    });
  }

  it("an untilted plate displaces nothing", () => {
    const res = traceRay(plate(0), parallelRay(0, LINE_D, -20));
    expect(res.status).toBe("ok");
    expect(res.ray!.origin.x).toBeCloseTo(0, 14);
  });
});

/**
 * Rung: Fresnel light budget. An uncoated plate in air at normal incidence
 * transmits (1 − R)² with R = ((n−1)/(n+1))². Closed form.
 */
describe("light budget accumulates Fresnel losses", () => {
  it("uncoated BK7 plate transmits (1−R)² at normal incidence", () => {
    const p: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: 20, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: 0, semiAperture: 20, thickness: 10, medium: "AIR" },
      ],
    };
    const n = N_BK7.n(LINE_D);
    const R = ((n - 1) / (n + 1)) ** 2;
    const res = traceRay(p, parallelRay(0, LINE_D, -5));
    expect(res.status).toBe("ok");
    expect(res.throughput).toBeCloseTo((1 - R) ** 2, 12);
  });

  it("an explicit reflectance overrides Fresnel (coating / mirror model)", () => {
    const p: Prescription = {
      surfaces: [
        { kind: "reflect", curvature: 0, semiAperture: 20, thickness: -10, reflectance: 0.91 },
      ],
    };
    const res = traceRay(p, makeRay(vec3(0, 0, -5), vec3(0, 0, 1), LINE_D));
    expect(res.status).toBe("ok");
    expect(res.throughput).toBeCloseTo(0.91, 14);
  });
});

/**
 * Mirror composition was previously unvalidated: every mirror test used a
 * single surface. These pin the sign conventions under composition, which is
 * what a Cassegrain, an SCT, or a mirror-plus-corrector depends on.
 */
describe("mirror composition (two mirrors, and mirror + refractor)", () => {
  const cassegrain: Prescription = {
    surfaces: [
      { kind: "reflect", curvature: 1 / -2000, conic: -1, semiAperture: 200, thickness: -800 },
      { kind: "reflect", curvature: 1 / -600, conic: -2.5, semiAperture: 60, thickness: 1200 },
    ],
  };

  it("a paraxial ray through two mirrors matches the thin-mirror closed form", () => {
    // Primary: f1 = R1/2. Its focus lies 200 mm past the secondary, forming a
    // virtual object for it. Secondary: 1/s' = 2/R2 − 1/s (mirror equation,
    // distances positive along the direction of travel).
    const f1 = -2000 / 2; // −1000: focus 1000 mm back along −z
    const dPrimaryToSecondary = -800;
    const s = f1 - dPrimaryToSecondary; // −200: virtual object 200 mm downstream
    const sPrime = 1 / (2 / -600 - 1 / s);

    const res = traceRay(cassegrain, parallelRay(0.01, LINE_D, -100));
    expect(res.status).toBe("ok");
    // Where the exact ray crosses the axis, relative to the secondary vertex.
    const out = res.ray!;
    const tCross = -out.origin.x / out.dir.x;
    const crossZ = out.origin.z + tCross * out.dir.z;
    const secondaryZ = -800;
    expect(crossZ - secondaryZ).toBeCloseTo(sPrime, 4);
  });

  it("the compiled index table keeps the incident medium across mirrors", () => {
    const sys = compile(cassegrain);
    const table = sys.indices(LINE_D);
    expect(table).toEqual([1, 1, 1]); // mirrors never change the medium
  });
});
