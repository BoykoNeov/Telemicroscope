import { describe, it, expect } from "vitest";
import { dot, sub } from "../src/math/vec3";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem, simpleSystem } from "../src/trace/system";
import { systemProperties } from "../src/trace/paraxial";
import { pupils } from "../src/pupil/pupils";
import { aimRay, chiefRay, pupilGrid, pupilFan, fieldDirection } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";
import { N_BK7 } from "../src/materials/catalog";

const n = N_BK7.n(LINE_D);

/**
 * Rung: pupil location from the single-surface imaging equation
 *   n₂/s′ − n₁/s = (n₂ − n₁)/R,      m = (n₁·s′)/(n₂·s)
 * which is EXACT paraxially (no thin-lens approximation involved). The
 * entrance pupil is the image of the stop through the surfaces preceding it,
 * so a stop behind one spherical surface has a closed-form pupil.
 */
describe("entrance pupil = image of the stop by preceding surfaces", () => {
  const R = 100;
  const d = 20; // stop sits 20 mm behind the refracting surface, inside glass
  const stopRadius = 5;

  const prescription: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / R, semiAperture: 40, thickness: d, medium: "N-BK7" },
      {
        kind: "refract",
        curvature: 0,
        semiAperture: stopRadius,
        thickness: 60,
        medium: "AIR",
        isStop: true,
      },
    ],
  };

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: stopRadius },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("entrance-pupil position matches the imaging equation", () => {
    // Object = the stop, at s′ = +d in image space (glass). Solve for s.
    const s = 1 / (n / d - (n - 1) / R);
    const p = pupils(system, LINE_D);
    expect(p.stopIndex).toBe(1);
    expect(p.entrance.z).toBeCloseTo(s, 9);
  });

  it("entrance-pupil size matches the transverse magnification", () => {
    const s = 1 / (n / d - (n - 1) / R);
    // The imaging equation's m = n₁s′/(n₂s) is for object→image, i.e. EP→stop.
    // The pupil magnification is the other direction (stop→EP), its reciprocal.
    const m = (n * s) / (1 * d);
    const p = pupils(system, LINE_D);
    expect(Math.abs(p.entrance.magnification)).toBeCloseTo(Math.abs(m), 9);
    expect(p.entrance.radius).toBeCloseTo(Math.abs(m) * stopRadius, 9);
  });
});

describe("exit pupil = image of the stop by following surfaces", () => {
  const R = 100;
  const d = 20;
  const stopRadius = 5;

  // Mirror-image arrangement: the stop comes FIRST, then the powered surface.
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: stopRadius,
        thickness: d,
        medium: "AIR",
        isStop: true,
      },
      { kind: "refract", curvature: 1 / R, semiAperture: 40, thickness: 60, medium: "N-BK7" },
    ],
  };

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: stopRadius },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("exit-pupil position and size match the imaging equation", () => {
    // Object = the stop at s = −d relative to the powered surface's vertex.
    const sPrime = n / ((n - 1) / R + 1 / -d);
    const m = (1 * sPrime) / (n * -d);
    const p = pupils(system, LINE_D);
    expect(p.stopIndex).toBe(0);
    expect(p.exit.z).toBeCloseTo(d + sPrime, 9);
    expect(p.exit.radius).toBeCloseTo(Math.abs(m) * stopRadius, 9);
  });

  it("the entrance pupil IS the stop when nothing precedes it", () => {
    const p = pupils(system, LINE_D);
    expect(p.entrance.z).toBe(0);
    expect(p.entrance.radius).toBe(stopRadius);
    expect(p.entrance.magnification).toBe(1);
  });
});

/**
 * CONSISTENCY CHECKS, not validation rungs. These round-trip
 * `resolveStopRadius` against `pupils`, so they cannot fail on physics — the
 * EPD case is algebraically tautological (the magnification cancels). They
 * earn their place by catching an inverted conversion, which is a real and
 * easy mistake, but the load is carried by the imaging-equation tests above.
 */
describe("aperture specifications resolve consistently (consistency check)", () => {
  const doublet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };

  it("an EPD spec produces exactly that entrance-pupil diameter", () => {
    const sys = simpleSystem(doublet, { kind: "EPD", value: 30 }, LINE_D);
    const p = pupils(sys, LINE_D);
    expect(2 * p.entrance.radius).toBeCloseTo(30, 9);
  });

  it("an f-number spec produces EPD = EFL / f#", () => {
    const fNumber = 8;
    const sys = simpleSystem(doublet, { kind: "fNumber", value: fNumber }, LINE_D);
    const efl = systemProperties(doublet, LINE_D).efl;
    const p = pupils(sys, LINE_D);
    expect(2 * p.entrance.radius).toBeCloseTo(Math.abs(efl) / fNumber, 9);
  });

  it("object-space NA resolves against the entrance-pupil arm", () => {
    const NA = 0.05;
    const objectDistance = 200;
    const sys: OpticalSystem = {
      prescription: doublet,
      aperture: { kind: "objectNA", value: NA },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance: objectDistance },
    };
    const p = pupils(sys, LINE_D);
    // NA = n·sin θ ≈ n·(EP radius / arm) paraxially, in air.
    const arm = p.entrance.z + objectDistance;
    expect(p.entrance.radius / arm).toBeCloseTo(NA, 9);
  });

  it("image-space NA resolves against the exit-pupil arm", () => {
    // The most involved resolver: it depends on both the exit pupil and the
    // image-plane position, and shares no code path with the other four.
    const NA = 0.06;
    const sys: OpticalSystem = {
      prescription: doublet,
      aperture: { kind: "imageNA", value: NA },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const p = pupils(sys, LINE_D);
    const imageZ = 6 + 100; // last vertex + its thickness
    const arm = imageZ - p.exit.z;
    expect(p.exit.radius / arm).toBeCloseTo(NA, 9);
  });

  it("a stop with powered surfaces on BOTH sides gives distinct pupils", () => {
    // Exercises imageStopForward's non-trivial branch: the paraboloid tests
    // early-return because their stop is also the last surface.
    const withInternalStop: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 10, medium: "AIR" },
        { kind: "refract", curvature: 0, semiAperture: 8, thickness: 10, medium: "AIR", isStop: true },
        { kind: "refract", curvature: 1 / 80, semiAperture: 25, thickness: 6, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 80, semiAperture: 25, thickness: 90, medium: "AIR" },
      ],
    };
    const sys = simpleSystem(withInternalStop, { kind: "stopRadius", value: 8 }, LINE_D);
    const p = pupils(sys, LINE_D);
    expect(p.stopIndex).toBe(2);
    // Neither pupil coincides with the stop, and both are real and finite.
    expect(p.entrance.z).not.toBeCloseTo(p.stopZ, 3);
    expect(p.exit.z).not.toBeCloseTo(p.stopZ, 3);
    expect(Number.isFinite(p.entrance.radius)).toBe(true);
    expect(Number.isFinite(p.exit.radius)).toBe(true);
    // A stop between two positive groups is magnified by both.
    expect(p.entrance.radius).toBeGreaterThan(0);
    expect(p.exit.radius).toBeGreaterThan(0);
  });
});

/**
 * Rung: the input wavefront reference convention. Rays for a field bundle
 * must be launched from a plane NORMAL TO THE CHIEF RAY, which is an
 * equal-phase surface for a tilted plane wave. Launching from a common
 * z-plane instead introduces 0.387 mm of spurious OPL spread at only 2° of
 * field (≈ 6·10⁵ waves) — see docs/ARCHITECTURE.md § Wavefront reference.
 */
describe("wavefront reference: oblique bundles launch from a plane ⊥ the chief ray", () => {
  const doublet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };
  const sys = simpleSystem(doublet, { kind: "EPD", value: 24 }, LINE_D);

  for (const fieldDeg of [0, 2, 5]) {
    it(`at ${fieldDeg}°, every launch origin lies on one plane ⊥ the field direction`, () => {
      const p = pupils(sys, LINE_D);
      const dir = fieldDirection(sys, fieldDeg);
      const rays = pupilGrid(9).map((pt) => aimRay(sys, p, fieldDeg, pt, LINE_D));
      const ref = rays[0]!.origin;
      for (const r of rays) {
        // Coplanarity ⊥ dir: the separation has no component along dir.
        expect(dot(sub(r.origin, ref), dir)).toBeCloseTo(0, 12);
      }
    });
  }

  it("each aimed ray actually passes through its entrance-pupil target", () => {
    const p = pupils(sys, LINE_D);
    const fieldDeg = 5;
    for (const pt of pupilFan(7)) {
      const r = aimRay(sys, p, fieldDeg, pt, LINE_D);
      const s = (p.entrance.z - r.origin.z) / r.dir.z;
      const hit = { x: r.origin.x + r.dir.x * s, y: r.origin.y + r.dir.y * s };
      expect(hit.x).toBeCloseTo(pt.px * p.entrance.radius, 9);
      expect(hit.y).toBeCloseTo(pt.py * p.entrance.radius, 9);
    }
  });

  it("the chief ray passes through the centre of the entrance pupil", () => {
    const p = pupils(sys, LINE_D);
    const r = chiefRay(sys, p, 5, LINE_D);
    const s = (p.entrance.z - r.origin.z) / r.dir.z;
    expect(r.origin.x + r.dir.x * s).toBeCloseTo(0, 12);
    expect(r.origin.y + r.dir.y * s).toBeCloseTo(0, 12);
  });
});
