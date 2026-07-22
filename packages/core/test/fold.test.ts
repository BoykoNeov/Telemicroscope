import { describe, it, expect } from "vitest";
import { vec3, normalize } from "../src/math/vec3";
import { reflectionAbout, applyToDirection, mat3Apply } from "../src/math/transform";
import { compile, vertexPoint } from "../src/trace/compile";
import { Prescription, unfoldedTwin } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { reflectDir } from "../src/trace/interaction";
import { makeRay } from "../src/trace/ray";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { pupils, imagePlaneZ } from "../src/pupil/pupils";
import { paraxialImageOffset, bestFocus } from "../src/analysis/focus";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the FOLDED mirror-frame convention (docs/ARCHITECTURE.md §
 * Tilt / decenter semantics; docs/VALIDATION.md § Folded chains).
 *
 * The engine's default chain keeps its direction through a mirror and lets the
 * author write negative thicknesses. That cannot express a Newtonian: the
 * diagonal steers the beam sideways and the eyepiece has to be placed where
 * the light actually went. Folded mode reflects the chain in the mirror's
 * tangent plane so its +z follows the beam.
 *
 * These rungs are deliberately GEOMETRIC — ray directions, hit points, path
 * lengths — because pupils and OPD still live in unfolded axial z and refuse a
 * folded system by design. The last rung pins that refusal.
 */

const FLAT = { kind: "reflect", curvature: 0, semiAperture: 50 } as const;

/** Direction the chain points in after `n` surfaces of a compiled system. */
function chainAxisAfter(p: Prescription, i: number) {
  // The frame of surface i+1 carries the chain direction the previous surface
  // handed it (that surface's own tilt aside, which these systems put at zero).
  const c = compile(p);
  return applyToDirection(c.surfaces[i + 1]!.frame, vec3(0, 0, 1));
}

describe("the reflection primitive", () => {
  it("is improper: a mirror flips handedness, and det = −1 says so", () => {
    const m = reflectionAbout(normalize(vec3(1, 2, -3)));
    const det =
      m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
      m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
      m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(-1, 12);
  });

  it("agrees with the engine's own ray reflection, which is written separately", () => {
    // The chain's rule is a Householder matrix; the ray's is `reflectDir` in
    // `interact`, written independently and validated long before folds
    // existed. If they ever disagreed the chain would point somewhere the
    // light does not go — so this pins the new code against the old, not
    // against a restatement of itself.
    const n = normalize(vec3(0, -1, 1));
    const d = normalize(vec3(0.1, 0.2, 0.97));
    const byMatrix = mat3Apply(reflectionAbout(n), d);
    const byEngine = reflectDir(d, n);
    expect(byMatrix.x).toBeCloseTo(byEngine.x, 14);
    expect(byMatrix.y).toBeCloseTo(byEngine.y, 14);
    expect(byMatrix.z).toBeCloseTo(byEngine.z, 14);
  });
});

/**
 * Rung: a 45° flat deviates the beam by exactly 90°.
 *
 * The closed form ARCHITECTURE names as the one to pin folded mode to. It is
 * also the rung that catches the tempting wrong implementation — reflecting
 * the surface's own (already tilted) frame instead of the frame the light
 * arrived in, which turns the chain by the tilt twice and lands the axis at
 * 45°, not 90°.
 */
describe("45° fold flat", () => {
  const folded: Prescription = {
    mirrorFrames: "folded",
    surfaces: [
      { ...FLAT, tiltXDeg: 45, thickness: 100 },
      { kind: "refract", curvature: 0, semiAperture: 50, thickness: 0, medium: "AIR" },
    ],
  };

  it("steers the chain by exactly 90°", () => {
    const axis = chainAxisAfter(folded, 0);
    expect(axis.x).toBeCloseTo(0, 12);
    expect(axis.y).toBeCloseTo(1, 12);
    expect(axis.z).toBeCloseTo(0, 12);
  });

  it("puts the next surface 100 mm along the folded axis, not the old one", () => {
    const v = vertexPoint(compile(folded), 1);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(100, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it("sends the ray where the chain went — the beam and the frame agree", () => {
    const res = traceRay(folded, makeRay(vec3(0, 0, -50), vec3(0, 0, 1), LINE_D));
    expect(res.status).toBe("ok");
    const d = res.ray!.dir;
    expect(d.x).toBeCloseTo(0, 12);
    expect(d.y).toBeCloseTo(1, 12);
    expect(d.z).toBeCloseTo(0, 12);
    // ...and it arrives at the surface the chain placed, 100 mm up the fold.
    const hit = res.path[1]!;
    expect(hit.y).toBeCloseTo(100, 9);
    expect(hit.z).toBeCloseTo(0, 9);
  });

  it("preserves path length: folding light does not lengthen it", () => {
    const res = traceRay(folded, makeRay(vec3(0, 0, -50), vec3(0, 0, 1), LINE_D));
    // 50 mm in to the flat, then 100 mm up the fold. A reflection is an
    // isometry, so the folded path is exactly the unfolded 150 mm.
    expect(res.opl).toBeCloseTo(150, 9);
  });

  it("an off-axis ray folds about the same plane (the deviation is not just an axis trick)", () => {
    // Enters 10 mm to the +x side, parallel to the axis. x is in the fold's
    // tilt-free direction, so it must survive the fold untouched.
    const res = traceRay(folded, makeRay(vec3(10, 0, -50), vec3(0, 0, 1), LINE_D));
    expect(res.status).toBe("ok");
    expect(res.ray!.dir.y).toBeCloseTo(1, 12);
    expect(res.path[1]!.x).toBeCloseTo(10, 9);
    expect(res.opl).toBeCloseTo(150, 9);
  });
});

/**
 * Rung: the same optics authored under both conventions trace identically.
 *
 * This is the strongest evidence available for the new convention — it pins it
 * directly against the already-validated one rather than against a fresh
 * closed form. The two authorings differ exactly where the conventions say
 * they must: post-mirror thicknesses flip sign, and so does every curvature
 * read after an odd number of mirrors.
 */
describe("folded and unfolded authorings of one Cassegrain-like pair", () => {
  // The two-mirror system already validated against the mirror equation in
  // compile.test.ts, restated folded.
  const unfolded: Prescription = {
    surfaces: [
      { kind: "reflect", curvature: 1 / -2000, conic: -1, semiAperture: 200, thickness: -800 },
      { kind: "reflect", curvature: 1 / -600, conic: -2.5, semiAperture: 60, thickness: 1200 },
    ],
  };
  const folded: Prescription = {
    mirrorFrames: "folded",
    surfaces: [
      { kind: "reflect", curvature: 1 / -2000, conic: -1, semiAperture: 200, thickness: 800 },
      { kind: "reflect", curvature: 1 / 600, conic: -2.5, semiAperture: 60, thickness: 1200 },
    ],
  };

  it("places every vertex at the same world point", () => {
    const a = compile(unfolded), b = compile(folded);
    for (let i = 0; i < 2; i++) {
      const va = vertexPoint(a, i), vb = vertexPoint(b, i);
      expect(vb.x).toBeCloseTo(va.x, 12);
      expect(vb.y).toBeCloseTo(va.y, 12);
      expect(vb.z).toBeCloseTo(va.z, 12);
    }
  });

  it("returns to a proper frame after two mirrors", () => {
    // Parity flips per mirror; an even count must hand back a right-handed
    // chain, or every downstream tilt sign would be quietly mirrored.
    const axis = chainAxisAfter(
      { ...folded, surfaces: [...folded.surfaces, { kind: "refract", curvature: 0, semiAperture: 60, thickness: 0, medium: "AIR" }] },
      1,
    );
    expect(axis.z).toBeCloseTo(1, 12);
  });

  it("traces the same rays: same hit points, same exit ray, same path length", () => {
    for (const h of [40, 90, 150, 195]) {
      const ray = makeRay(vec3(h, 0, -100), vec3(0, 0, 1), LINE_D);
      const a = traceRay(unfolded, ray);
      const b = traceRay(folded, ray);
      expect(b.status).toBe(a.status);
      expect(a.status).toBe("ok");
      expect(b.opl).toBeCloseTo(a.opl, 9);
      for (let i = 0; i < a.path.length; i++) {
        expect(b.path[i]!.x).toBeCloseTo(a.path[i]!.x, 9);
        expect(b.path[i]!.z).toBeCloseTo(a.path[i]!.z, 9);
      }
      expect(b.ray!.dir.x).toBeCloseTo(a.ray!.dir.x, 12);
      expect(b.ray!.dir.z).toBeCloseTo(a.ray!.dir.z, 12);
    }
  });

  it("reports the same first-order properties through the unfolded twin", () => {
    const a = systemProperties(unfolded, LINE_D);
    const b = systemProperties(folded, LINE_D);
    expect(b.efl).toBeCloseTo(a.efl, 9);
    expect(b.bfd).toBeCloseTo(a.bfd, 9);
  });
});

/**
 * Rung: a Newtonian's diagonal puts focus off to the side, and the folded path
 * length still equals the straight one.
 *
 * The first system this convention exists for. A paraboloid brings the beam to
 * focus f from its vertex; a flat inserted at distance d does not move the
 * focus along the light, it only redirects it. So the focus must sit (f − d)
 * away from the diagonal, perpendicular to the tube.
 */
describe("Newtonian fold", () => {
  const R = -2000; // concave paraboloid, f = |R|/2 = 1000
  const f = 1000;
  const dToDiagonal = 800;

  const newtonian: Prescription = {
    mirrorFrames: "folded",
    surfaces: [
      { kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 100, thickness: dToDiagonal, isStop: true },
      { ...FLAT, tiltXDeg: 45, semiAperture: 40, thickness: f - dToDiagonal },
    ],
  };

  it("puts the diagonal's vertex down the tube, where the chain says", () => {
    const v = vertexPoint(compile(newtonian), 1);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(-dToDiagonal, 12); // 800 mm back along the returning beam
  });

  it("brings an axial bundle to focus out the side of the tube, (f − d) from the flat", () => {
    // A paraboloid has no spherical aberration on axis, so every ray in the
    // bundle must cross at one point — and the fold only redirects it.
    for (const h of [20, 60, 95]) {
      const res = traceRay(newtonian, makeRay(vec3(h, 0, -2000), vec3(0, 0, 1), LINE_D));
      expect(res.status).toBe("ok");
      const r = res.ray!;
      // The tilt is about x, so the fold leaves x-convergence alone: the ray
      // returns to x = 0 exactly at focus.
      const t = -r.origin.x / r.dir.x;
      expect(r.origin.y + t * r.dir.y).toBeCloseTo(f - dToDiagonal, 6);
      expect(r.origin.z + t * r.dir.z).toBeCloseTo(-dToDiagonal, 6);
    }
  });

  it("keeps the paraboloid's focal length: folding is not a power", () => {
    expect(systemProperties(newtonian, LINE_D).efl).toBeCloseTo(f, 6);
  });
});

/**
 * Rung: the unfolded-only guard has no way around it.
 *
 * A guard on one entry point is a tripwire with a hole if another door reaches
 * the same coordinate. Nothing in the suite exercises a folded system through
 * the wave layer yet, so these paths would pass green either way — which is
 * exactly why they are asserted now, rather than discovered by the Newtonian
 * preset getting a plausible wrong number instead of the loud error promised.
 */
describe("the unfolded-only guard", () => {
  const folded: Prescription = {
    mirrorFrames: "folded",
    surfaces: [
      { kind: "reflect", curvature: 1 / -2000, conic: -1, semiAperture: 100, thickness: 800, isStop: true },
      { ...FLAT, tiltXDeg: 45, semiAperture: 40, thickness: 200 },
    ],
  };
  const system: OpticalSystem = {
    prescription: folded,
    aperture: { kind: "stopRadius", value: 100 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("pupils() refuses instead of answering in a dead coordinate", () => {
    expect(() => pupils(system, LINE_D)).toThrow(/unfolded-only/);
  });

  it("paraxialImageOffset() refuses — it walks the axis without ever calling pupils()", () => {
    expect(() => paraxialImageOffset(system, LINE_D)).toThrow(/unfolded-only/);
  });

  it("bestFocus() refuses, so the whole focus/PSF path is closed", () => {
    expect(() => bestFocus(system, "paraxial")).toThrow(/unfolded-only/);
  });

  it("imagePlaneZ() refuses, so OPD cannot reach a plane the light never crosses", () => {
    expect(() => imagePlaneZ(compile(folded), system)).toThrow(/unfolded-only/);
  });

  it("but the unfolded twin of that same system answers all of them", () => {
    // The guard must be about the convention, not about mirrors or tilts —
    // straighten the chain and every door opens again.
    const straight = { ...system, prescription: unfoldedTwin(folded) };
    expect(() => pupils(straight, LINE_D)).not.toThrow();
    // Measured from the LAST vertex — the flat, 800 mm along from the
    // paraboloid whose focus is at 1000.
    expect(paraxialImageOffset(straight, LINE_D)).toBeCloseTo(200, 6);
  });
});
