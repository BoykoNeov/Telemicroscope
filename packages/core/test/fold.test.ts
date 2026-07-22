import { describe, it, expect } from "vitest";
import { vec3, normalize } from "../src/math/vec3";
import { reflectionAbout, applyToDirection, applyToPoint, mat3Apply } from "../src/math/transform";
import { compile, vertexPoint } from "../src/trace/compile";
import { spaceToWorld, toImageSpace } from "../src/trace/axis";
import { Prescription, unfoldedTwin } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { reflectDir } from "../src/trace/interaction";
import { makeRay } from "../src/trace/ray";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { imagePlaneZ } from "../src/pupil/pupils";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { psf } from "../src/wave/psf";
import { bestFocus } from "../src/analysis/focus";
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
 * The rungs come in two halves. The first is GEOMETRIC — ray directions, hit
 * points, path lengths — pinning that the chain and the beam agree. The second
 * pins the map that carries the unfolded axis back into the world, which is
 * what lets pupils, OPD, focus and the PSF work on a folded system at all.
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
 * Rungs for the unfolded-z → world map, which is what replaced the guard.
 *
 * The claim under test is that a folded prescription and its `unfoldedTwin` are
 * the same optics related by a RIGID MOTION — one reflection per mirror — so
 * first-order geometry can be computed on the twin's straight axis while rays
 * are traced through the real folded chain, and the two meet through
 * `spaceToWorld`. Everything below tries to break one half of that sentence.
 */
describe("the unfolded axis and its map to the world", () => {
  const R = -2000;
  const f = 1000;
  const d = 800;

  const newtonian: Prescription = {
    mirrorFrames: "folded",
    surfaces: [
      { kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 60, thickness: d, isStop: true },
      // Generously oversized on purpose: the twin drops the diagonal's tilt, so
      // its clear aperture cuts a circle where the folded one cuts an ellipse.
      // Any rung comparing the two must not let that difference in.
      { ...FLAT, tiltXDeg: 45, semiAperture: 120, thickness: f - d },
    ],
  };
  const straight = unfoldedTwin(newtonian);

  const system: OpticalSystem = {
    prescription: newtonian,
    aperture: { kind: "stopRadius", value: 40 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
  const twinSystem: OpticalSystem = { ...system, prescription: straight };

  it("is proper: the twin is a congruent copy, not a mirrored one", () => {
    // Each mirror gives `outgoingFrame` a det = −1 and the axial flip another;
    // they cancel. If they did not, an odd number of mirrors would hand the
    // analysis layer a left-handed image and every azimuth would run backwards.
    const m = spaceToWorld(compile(newtonian), 2).rotation;
    const det =
      m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
      m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
      m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 12);
  });

  it("carries every unfolded vertex back onto the world vertex it came from", () => {
    const c = compile(newtonian);
    const t = compile(straight);
    for (let i = 0; i < 2; i++) {
      const placed = applyToPoint(spaceToWorld(c, i), vec3(0, 0, t.surfaces[i]!.vertexZ));
      const actual = vertexPoint(c, i);
      expect(placed.x).toBeCloseTo(actual.x, 9);
      expect(placed.y).toBeCloseTo(actual.y, 9);
      expect(placed.z).toBeCloseTo(actual.z, 9);
    }
  });

  it("places the image plane out the side of the tube, where the beam goes", () => {
    // The closed form the geometric rungs already pinned by tracing: focus sits
    // (f − d) from the diagonal, perpendicular to the tube. Here it is reached
    // the other way — through the paraxial axis and the map — so agreement is
    // between two independent routes rather than a restatement.
    const c = compile(newtonian);
    const z = imagePlaneZ(c, system);
    const world = applyToPoint(spaceToWorld(c, 2), vec3(0, 0, z));
    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(f - d, 9);
    expect(world.z).toBeCloseTo(-d, 9);
  });

  /**
   * The rung the others cannot see.
   *
   * Strehl, RMS and an on-axis image point are all blind to orientation: a map
   * that flipped the wrong axis would keep det = +1, keep the focus on the
   * tube's side, and pass everything above. So compare the two tracers directly
   * — one through the tilted diagonal, one through its straightened twin — and
   * demand that the map is the *entire* difference between their exit rays, in
   * all three components, for rays carrying both x and y structure.
   *
   * It is not a restatement of the map's algebra: the folded ray and the twin
   * ray reflect off DIFFERENT planes and so leave from different points. The
   * lines must still coincide once mapped, which is the isometry claim itself.
   */
  it("maps the folded exit ray onto the twin's, line for line", () => {
    const c = compile(newtonian);
    const theta = (0.3 * Math.PI) / 180;
    const dir = vec3(Math.sin(theta), 0, Math.cos(theta));
    const zImage = imagePlaneZ(c, system);
    let sawDisplacedOrigin = false;

    for (const [x, y] of [[0, 0], [30, 0], [0, 30], [-18, 25], [22, -33]] as const) {
      const input = makeRay(vec3(x, y, -50), dir, LINE_D);
      const bent = traceRay(newtonian, input);
      const flat = traceRay(straight, input);
      expect(bent.status).toBe("ok");
      expect(flat.status).toBe("ok");

      const mapped = toImageSpace(c, bent.ray!);
      expect(mapped.dir.x).toBeCloseTo(flat.ray!.dir.x, 12);
      expect(mapped.dir.y).toBeCloseTo(flat.ray!.dir.y, 12);
      expect(mapped.dir.z).toBeCloseTo(flat.ray!.dir.z, 12);

      // Same line: compare where each crosses the image plane, since the two
      // rays start from different points along it.
      const hit = (r: typeof mapped): { x: number; y: number } => {
        const t = (zImage - r.origin.z) / r.dir.z;
        return { x: r.origin.x + r.dir.x * t, y: r.origin.y + r.dir.y * t };
      };
      const a = hit(mapped);
      const b = hit(flat.ray!);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);

      if (Math.abs(mapped.origin.z - flat.ray!.origin.z) > 1) sawDisplacedOrigin = true;
    }
    // ...and the origins really do differ, so the agreement above is the map
    // doing work rather than the two tracers having done the same thing.
    expect(sawDisplacedOrigin).toBe(true);
  });

  /**
   * Rung: the wave layer gets the same answer folded as straightened.
   *
   * This is the one that would have caught the guard being lifted carelessly.
   * OPD is a path difference and the map is an isometry, so equality here is
   * exact rather than approximate — any leak of world z into an axial formula
   * shows up as a gross disagreement, not a small one.
   */
  it("gives the same OPD, focus and PSF as the straightened twin", () => {
    const points = pupilGrid(9);
    const bent = opdMap(system, 0.2, LINE_D, points);
    const flat = opdMap(twinSystem, 0.2, LINE_D, points);

    expect(bent.samples.length).toBe(flat.samples.length);
    expect(bent.lost).toBe(flat.lost);

    // Bounded in waves rather than matched to N decimals, because the floor
    // here is f64 itself: the folded route carries the same path through one
    // extra rigid transform, and one ulp at an 1800 mm path length is 4.5e-13
    // mm — 8e-10 waves. The measured spread sits at that floor, so a
    // decimal-places match would be asserting below the representation. The
    // bound is still five orders under the engine's ~1e-3-wave target.
    let worst = 0;
    for (let i = 0; i < bent.samples.length; i++) {
      worst = Math.max(worst, Math.abs(bent.samples[i]!.waves - flat.samples[i]!.waves));
    }
    expect(worst).toBeLessThan(1e-8);
    expect(bent.rmsWaves).toBeCloseTo(flat.rmsWaves, 9);

    for (const criterion of ["paraxial", "minRmsSpot", "minRmsWavefront"] as const) {
      const a = bestFocus(system, criterion, { pupilSamples: 9 });
      const b = bestFocus(twinSystem, criterion, { pupilSamples: 9 });
      expect(a.offsetFromLastVertex).toBeCloseTo(b.offsetFromLastVertex, 7);
      expect(a.merit).toBeCloseTo(b.merit, 9);
    }

    const p = psf(system, 0, LINE_D, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    const q = psf(twinSystem, 0, LINE_D, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    expect(p.strehl).toBeCloseTo(q.strehl, 9);
    expect(p.pixelScaleMm).toBeCloseTo(q.pixelScaleMm, 12);
  });

  /**
   * Rung: on axis a paraboloid is perfect, and folding does not spoil it.
   *
   * The external number is that a paraboloid has zero spherical aberration for
   * an object at infinity — so the folded system must come out diffraction
   * limited, Strehl 1. This is the first folded system in the suite to reach
   * the wave layer at all; before the map it could only throw.
   */
  it("is diffraction-limited on axis, through the fold", () => {
    const map = opdMap(system, 0, LINE_D, pupilGrid(13));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeLessThan(1e-6);
    const p = psf(system, 0, LINE_D, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    expect(p.strehl).toBeCloseTo(1, 6);
  });
});
