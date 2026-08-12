import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vec3 } from "../src/math/vec3";
import { applyToDirection } from "../src/math/transform";
import { makeRay } from "../src/trace/ray";
import { traceRay } from "../src/trace/sequential";
import { compile } from "../src/trace/compile";
import { pupils } from "../src/pupil/pupils";
import { chiefRay } from "../src/pupil/aiming";
import type { OpticalSystem } from "../src/trace/system";
import { Prescription, SurfaceSpec } from "../src/trace/prescription";
import { constantIndex } from "../src/materials/dispersion";
import { registerMedium } from "../src/materials/catalog";

/**
 * The exact tracer against an INDEPENDENT implementation — docs/VALIDATION.md
 * § 0, and the "engineering practices" item ROADMAP has carried since step 4.
 *
 * Every other rung in this ladder compares the tracer to a closed form, which
 * checks it wherever an answer can be written down. This one compares it to
 * another program's arithmetic on systems where no closed form exists — a real
 * cemented doublet, a two-doublet objective, a two-mirror telescope, an
 * asphere — which is the only evidence available that the *machinery* is right
 * rather than the special cases.
 *
 * The reference is rayoptics 0.9.9 (Michael Hayford, BSD-3), driven headless.
 * Its answers are committed in `fixtures/rayoptics-crosscheck.json`, so this
 * suite needs no Python; the generator that wrote them, and the conventions it
 * deliberately removes, are in `docs/notes/rayoptics-crosscheck.py`.
 *
 * What is compared is the primitive both programs implement: a ray given as a
 * point and a direction, traced surface by surface, ending on the last surface.
 * No pupil coordinates, no ray aiming, no field angles, no image plane, no
 * focus solve, and no glass catalog — every index is stated in the fixture and
 * constant. A disagreement here is intersection, Snell or path length, and it
 * cannot be anything else.
 *
 * TILT AND DECENTER — the second investigation, now done. Seven of the eleven
 * systems are misaligned, and they exist because the two programs agree on what
 * a misalignment IS and disagree on how to spell one. Both apply the shift and
 * the rotation before the surface and never return to the global axis, and both
 * advance the next thickness along the tilted surface's own z — the local
 * coordinate chain of ARCHITECTURE § Tilt / decenter semantics, and rayoptics'
 * `DecenterData('decenter')`. But this engine builds a surface's rotation as
 * Ry(tiltY)·Rx(tiltX) while rayoptics builds Rx(−α)·Ry(−β)·Rz(γ), and those are
 * not the same two-parameter family — for one axis they agree up to a sign, and
 * for two they do not agree at all, because Ry·Rx is not Rx·Ry.
 *
 * So the fixture does not translate angles. It states the tilt in this engine's
 * parameters, and the generator solves for the Euler triple that realizes the
 * matrix they mean (residual 1.1e-16, half an ulp — reported by the script).
 * Each system then carries `frames`: the frame rayoptics actually traced every
 * surface in, in the launch frame, which the first rung below compares against
 * this engine's own compiled frames. That is what makes the ray agreement mean
 * something — two programs can agree about rays while disagreeing about where
 * the glass is only by a coincidence, and the frames rule the coincidence out.
 *
 * TILTED MIRRORS AND THE FOLDED FRAME — the third investigation, and the last
 * thing this header used to name as open. Five more systems, and they split in
 * two.
 *
 * A tilted mirror under the DEFAULT chain is not a new convention at all: it is
 * a misalignment like the seven above, the chain keeps its direction, and
 * `tilted-secondary-cassegrain` is built exactly as they are. What it adds is
 * that the surface which moved is a REFLECTING one, which no system here had.
 *
 * A folded chain IS a second convention, and it reconciles by one rule. Writing
 * `parity` for (−1)^(mirrors so far) and D for diag(1, 1, −1), the frames the
 * two programs trace in differ by `D^(mirrors before i)` — one z-flip per
 * mirror, which is the same statement as "a folded prescription's post-mirror
 * thicknesses are positive where an unfolded one's are negative". Everything
 * else follows from what D does to a field: curvatures and asphere coefficients
 * are the sag and carry the parity, conics and decenters do not, and a tilt
 * matrix conjugates to D·T·D. The flip is applied HERE, from the fixture's own
 * surface list, because a fixture that arrived pre-flipped would be hiding the
 * reconciliation in the one place nothing checks it.
 *
 * The fold rules themselves differ, and rayoptics' own rays settle it. Its
 * `DecenterData('bend')` applies the tilt rotation twice; this engine reflects
 * the incoming frame in the tangent plane. Those coincide exactly for a tilt
 * about an in-plane axis — every real fold mirror — and the generator asserts
 * the coincidence before using 'bend' anywhere. For a COMPOUND tilt they part,
 * and `fold-compound-tilt` records by how much: the beam rayoptics traced
 * leaves along the reflected frame's axis to the last bit, and 0.88° away from
 * 'bend'.
 *
 * WHAT THIS DOES NOT PIN. Dispersion: both sides are handed the same numbers,
 * on purpose, so `materials`' Sellmeier evaluation is out of scope here (it has
 * its own rung against datasheet nd/Vd). Apertures: every ray is well inside
 * every rim and the prescriptions are built unbounded, so vignetting is out of
 * scope too. No aimed chief ray is solved on a folded system: that would pull in
 * pupils and the unfolded-axis map, which is `fold.test.ts`' rung and § 1.5.3's,
 * not this file's convention question.
 */

interface FixtureSurface {
  readonly curvature: number;
  readonly conic?: number;
  readonly asphereCoeffs?: readonly number[];
  readonly thickness: number;
  readonly indexAfter?: number;
  readonly reflect?: boolean;
  readonly tiltXDeg?: number;
  readonly tiltYDeg?: number;
  readonly decenterX?: number;
  readonly decenterY?: number;
}

/**
 * The chief ray onto a stated surface's own vertex, solved on the rayoptics
 * side by its own Newton — the external number for real ray aiming (§ 1.5.3).
 */
interface FixtureAim {
  readonly stopSurface: number;
  readonly fieldDeg: number;
  readonly launchZ: number;
  readonly origin: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  readonly residualMm: number;
  readonly hits: readonly (readonly [number, number, number])[];
  readonly exitDir: readonly [number, number, number];
}

/** A surface's frame as rayoptics traced it, expressed in the launch frame. */
interface FixtureFrame {
  /** Row-major 3×3, mapping surface-local coordinates into the launch frame. */
  readonly rotation: readonly number[];
  readonly vertex: readonly [number, number, number];
}

interface FixtureRay {
  readonly origin: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
}

interface FixtureExpectation {
  readonly point: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  readonly opl: number;
  readonly hits: readonly (readonly [number, number, number])[];
  /** Direction leaving each surface, in the launch frame. Last entry = `dir`. */
  readonly segDirs: readonly (readonly [number, number, number])[];
}

/**
 * Where rayoptics' own fold concept and this engine's part company: recorded
 * on the one system that carries a compound tilt, so the divergence is a
 * measured external number rather than an argument in a comment.
 */
interface FixtureFoldCheck {
  readonly surface: number;
  /** Where rayoptics' RAY TRACE sent the axial beam after that mirror. */
  readonly beamDir: readonly [number, number, number];
  /** Where rayoptics' `DecenterData('bend')` would have pointed the chain. */
  readonly bendAxis: readonly [number, number, number];
  readonly bendDeviationDeg: number;
}

interface FixtureSystem {
  readonly id: string;
  readonly note: string;
  readonly objectIndex: number;
  readonly mirrorFrames?: "folded";
  readonly surfaces: readonly FixtureSurface[];
  readonly frames: readonly FixtureFrame[];
  readonly rays: readonly FixtureRay[];
  readonly expected: readonly FixtureExpectation[];
  readonly aim?: FixtureAim;
  readonly foldCheck?: FixtureFoldCheck;
}

interface Fixture {
  readonly _generator: Record<string, string>;
  readonly wavelengthNm: number;
  readonly systems: readonly FixtureSystem[];
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/rayoptics-crosscheck.json", import.meta.url)),
    "utf8",
  ),
);

/**
 * The tolerances are stated in units of the last bit of a double at the
 * magnitude being compared, because that is what the comparison actually
 * achieves: the two programs agree to within a couple of ulp on every quantity,
 * on every system. A tolerance in millimetres would have to be different for a
 * 3 mm objective and a 600 mm telescope and would say nothing.
 *
 * Measured worst cases at the time of writing (see docs/VALIDATION.md § 0):
 * points 0.9 ulp, directions 5 ulp, path length 1.6 ulp, path DIFFERENCES
 * 2.3 ulp. The bounds below sit a few times above those and nowhere near a
 * physically meaningful error — one ulp of a 600 mm path is 1.3e-13 mm, which
 * is 2e-10 of a wave.
 *
 * The scale an error is measured against is the SYSTEM's, not the coordinate's
 * own: a hit point may land at y = 0 after the ray has travelled 560 mm to
 * reach it, and the rounding it carries is the travel's, not the zero's.
 */
const ULP_POINT = 8;
const ULP_DIR = 16;
const ULP_OPL = 8;
const ULP_OPD = 8;
/** The same wavefront claim in the currency the wave layer uses. */
const MAX_OPD_WAVES = 1e-8;

/**
 * The one place the two programs do NOT agree to the last bit, and it is not a
 * rounding difference: an even asphere has no closed-form intersection, so both
 * sides Newton-iterate and both stop at an absolute residual of 1e-12 mm
 * (`makeEvenAsphere`'s |g| < 1e-12; rayoptics' `trace_raw(eps=1e-12)`). Two
 * independent stopping criteria cannot agree closer than the looser of them, so
 * the asphere's hit points are held to that floor rather than to a bit count —
 * measured 3.8e-14 mm, i.e. the iteration is converging ~26x tighter than it
 * promises, on both sides.
 */
const NEWTON_FLOOR_MM = 1e-12;

const ulp = (magnitude: number): number => Number.EPSILON * Math.max(Math.abs(magnitude), 1);

/**
 * The fixture states every index as a number, so media are registered from it
 * rather than looked up by name. That is the point: this rung must not be able
 * to pass or fail on a Sellmeier coefficient.
 */
const mediumName = (n: number): string => {
  const name = `XCHECK_${n.toFixed(17)}`;
  registerMedium(constantIndex(name, n));
  return name;
};

function prescriptionOf(system: FixtureSystem): Prescription {
  const surfaces: SurfaceSpec[] = system.surfaces.map(
    (s): SurfaceSpec => ({
      kind: s.reflect ? "reflect" : "refract",
      curvature: s.curvature,
      ...(s.conic !== undefined ? { conic: s.conic } : {}),
      ...(s.asphereCoeffs ? { asphereCoeffs: [...s.asphereCoeffs] } : {}),
      // Unbounded on purpose: the fixture's rays are all well inside the real
      // glass, and a rim here could only let one tracer clip where the other
      // does not — a comparison artifact, not a finding.
      semiAperture: Infinity,
      thickness: s.thickness,
      ...(s.tiltXDeg !== undefined ? { tiltXDeg: s.tiltXDeg } : {}),
      ...(s.tiltYDeg !== undefined ? { tiltYDeg: s.tiltYDeg } : {}),
      ...(s.decenterX !== undefined ? { decenterX: s.decenterX } : {}),
      ...(s.decenterY !== undefined ? { decenterY: s.decenterY } : {}),
      ...(s.reflect ? {} : { medium: mediumName(s.indexAfter!) }),
    }),
  );
  return {
    objectMedium: mediumName(system.objectIndex),
    surfaces,
    ...(system.mirrorFrames ? { mirrorFrames: system.mirrorFrames } : {}),
  };
}

/**
 * The fold parity in front of surface i: (−1)^(mirrors strictly before it), and
 * +1 throughout on any unfolded system. This is the whole reconciliation
 * between the two frame conventions — see the header — and it is computed here
 * from the fixture's own surface list rather than stored, so a fixture cannot
 * quietly hand over frames that have already been flipped.
 */
const parityBefore = (s: FixtureSystem, i: number): number => {
  if (s.mirrorFrames !== "folded") return 1;
  const mirrors = s.surfaces.slice(0, i).filter((x) => x.reflect).length;
  return mirrors % 2 === 0 ? 1 : -1;
};

/** rayoptics' rotation for surface i, carried into this engine's frame. */
const expectedRotation = (s: FixtureSystem, i: number): number[] => {
  const p = parityBefore(s, i);
  // Right-multiplying by diag(1, 1, −1) negates the third column: the axis the
  // chain runs along, and nothing else.
  return s.frames[i]!.rotation.map((v, k) => (k % 3 === 2 ? v * p : v));
};

const traceFixtureRay = (p: Prescription, r: FixtureRay) =>
  traceRay(p, makeRay(vec3(...r.origin), vec3(...r.dir), FIXTURE.wavelengthNm));

/** Largest |Δ| over the three components. */
const maxAbs = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

/** The largest coordinate anywhere in a system's traced rays — its geometric scale. */
const systemScale = (s: FixtureSystem): number =>
  Math.max(...s.expected.flatMap((e) => e.hits.flatMap((h) => h.map(Math.abs))));

/** What a hit point on this system is allowed to differ by. */
const pointTolerance = (s: FixtureSystem): number => {
  const rounding = ULP_POINT * ulp(systemScale(s));
  return s.surfaces.some((x) => x.asphereCoeffs) ? Math.max(rounding, NEWTON_FLOOR_MM) : rounding;
};

describe("§ 0 — the exact tracer against an independent implementation", () => {
  it("the fixture says which program, which version, and by which call", () => {
    expect(FIXTURE._generator.tool).toBe("rayoptics");
    expect(FIXTURE._generator.version).toBe("0.9.9");
    expect(FIXTURE._generator.call).toContain("trace_raw");
    expect(FIXTURE._generator.call).toContain("intersect_obj=False");
    // Exact, not a minimum: this is the guard that notices a fixture which has
    // silently lost a system, which no per-system assertion below can.
    expect(FIXTURE.systems.length).toBe(16);
  });

  for (const system of FIXTURE.systems) {
    describe(system.id, () => {
      const prescription = prescriptionOf(system);
      const traced = system.rays.map((r) => traceFixtureRay(prescription, r));

      /**
       * Before the rays: the two programs put every surface in the same place.
       *
       * On the axial systems this is nearly free — every rotation is the
       * identity and the vertex is the accumulated thickness. On the misaligned
       * ones it is the whole reconciliation: the fixture states tilts in this
       * engine's `tiltXDeg`/`tiltYDeg` and the generator solved for the Euler
       * triple that reproduces the matrix they mean, so this rung is where the
       * solution is checked against the engine that defined it. A rotation
       * entry is a direction cosine, so it is held to the direction bound.
       *
       * On a FOLDED system the two programs' frames are not the same frame —
       * they differ by one z-flip per mirror — so the fixture's rotation is
       * carried through `expectedRotation` first. Vertices need no such thing:
       * a flip about z leaves the point it is a flip about exactly where it was.
       */
      it("every surface's compiled frame is the one rayoptics traced through", () => {
        const compiled = compile(prescription);
        expect(system.frames.length).toBe(system.surfaces.length);
        for (let i = 0; i < system.frames.length; i++) {
          const frame = compiled.surfaces[i]!.frame;
          expect(maxAbs([...frame.rotation], expectedRotation(system, i))).toBeLessThan(
            ULP_DIR * ulp(1),
          );
          const v = frame.translation;
          expect(maxAbs([v.x, v.y, v.z], system.frames[i]!.vertex)).toBeLessThan(
            pointTolerance(system),
          );
        }
      });

      /**
       * THE FOLD RUNG, and the reason it is worth more than the frame
       * comparison above: it needs no convention mapping at all.
       *
       * A folded chain's whole claim is that its +z follows the light. Ray 0 of
       * every folded system is exactly axial, so it reaches each mirror's own
       * vertex travelling along the chain's axis — and the direction it leaves
       * in is therefore the direction the chain must continue in. That
       * direction is rayoptics', computed by its ray trace from a surface
       * normal, with no frame convention in it. So this compares the engine's
       * `outgoingFrame` against a BEAM rather than against another program's
       * bookkeeping, which is the one comparison a shared convention error
       * could not survive.
       */
      if (system.mirrorFrames === "folded") {
        it("the frame the chain continues in after a mirror is where the beam went", () => {
          const axial = system.rays[0]!;
          // stated rather than assumed: the rung means nothing if ray 0 drifted
          expect([axial.origin[0], axial.origin[1]]).toEqual([0, 0]);
          expect([axial.dir[0], axial.dir[1], axial.dir[2]]).toEqual([0, 0, 1]);

          const c = compile(prescription);
          const mirrors = system.surfaces
            .map((s, i) => (s.reflect ? i : -1))
            .filter((i) => i >= 0);
          expect(mirrors.length).toBeGreaterThanOrEqual(1);
          for (const k of mirrors) {
            const axis = applyToDirection(c.surfaces[k]!.outgoingFrame, vec3(0, 0, 1));
            const beam = system.expected[0]!.segDirs[k]!;
            expect(maxAbs([axis.x, axis.y, axis.z], beam)).toBeLessThan(ULP_DIR * ulp(1));
          }
        });
      }

      /**
       * The one place the two fold RULES disagree, pinned as a number.
       *
       * rayoptics' 'bend' applies the tilt rotation twice; this engine reflects
       * the incoming frame in the tangent plane. They coincide identically for a
       * tilt about an in-plane axis — the generator refuses to use 'bend'
       * otherwise — and for a compound tilt they do not. Both halves are
       * asserted here, because only the pair is a finding: the engine's chain is
       * the traced beam to the last bits, AND 'bend' is a long way from it.
       */
      if (system.foldCheck) {
        const fold = system.foldCheck;
        it("the reflected frame follows the beam where the doubled tilt does not", () => {
          const c = compile(prescription);
          const axis = applyToDirection(c.surfaces[fold.surface]!.outgoingFrame, vec3(0, 0, 1));
          expect(maxAbs([axis.x, axis.y, axis.z], fold.beamDir)).toBeLessThan(ULP_DIR * ulp(1));

          const cosine =
            axis.x * fold.bendAxis[0] + axis.y * fold.bendAxis[1] + axis.z * fold.bendAxis[2];
          const deviation = (Math.acos(Math.min(1, cosine)) * 180) / Math.PI;
          expect(deviation).toBeCloseTo(fold.bendDeviationDeg, 9);
          // and it is a real angle, not a rounding difference dressed up as one
          expect(fold.bendDeviationDeg).toBeGreaterThan(0.5);
        });
      }

      it("every fixture ray traces, and reaches every surface", () => {
        expect(system.rays.length).toBe(system.expected.length);
        expect(system.rays.length).toBeGreaterThanOrEqual(8);
        for (let i = 0; i < traced.length; i++) {
          expect(traced[i]!.status).toBe("ok");
          // hits[0] is the launch point both sides were handed.
          expect(traced[i]!.path.length).toBe(system.expected[i]!.hits.length - 1);
        }
      });

      /**
       * REAL RAY AIMING against an independently-solved answer (§ 1.5.3).
       *
       * Everywhere else in this file the ray is GIVEN and only the trace is
       * compared. Here the ray is the answer: both sides solve for the launch
       * that reaches a stated surface's own vertex from a stated direction, each
       * with its own Newton around its own tracer, and neither uses the other's
       * solver. The target is a vertex rather than a pupil fraction on purpose —
       * a vertex needs no agreement about what a pupil coordinate means on a
       * tilted stop, so a disagreement here is arithmetic and cannot be a
       * definition.
       */
      if (system.aim) {
        const aim = system.aim;
        const aimSystem: OpticalSystem = {
          prescription: {
            ...prescription,
            surfaces: prescription.surfaces.map((s, i) => ({ ...s, isStop: i === aim.stopSurface })),
          },
          // px = py = 0, so the stop radius never enters — only the target does.
          aperture: { kind: "stopRadius", value: 1 },
          field: { kind: "angle", values: [aim.fieldDeg] },
          wavelengths: [{ nm: FIXTURE.wavelengthNm, weight: 1 }],
          conjugate: { kind: "infinite" },
          rayAiming: "real",
        };

        it("the independently-solved aimed chief ray agrees, surface by surface", () => {
          // rayoptics' own solve landed on the vertex to here; ours has its own
          // bound, and neither can be checked tighter than the looser of them
          expect(aim.residualMm).toBeLessThan(1e-12);

          const pupil = pupils(aimSystem, FIXTURE.wavelengthNm);
          const ray = chiefRay(aimSystem, pupil, aim.fieldDeg, FIXTURE.wavelengthNm);
          const traced = traceRay(aimSystem.prescription, ray);
          expect(traced.status).toBe("ok");

          const tolerance = Math.max(pointTolerance(system), 1e-11);
          for (let s = 0; s < traced.path.length; s++) {
            const p = traced.path[s]!;
            expect(maxAbs([p.x, p.y, p.z], aim.hits[s + 1]!)).toBeLessThan(tolerance);
          }
          const d = traced.ray!.dir;
          expect(maxAbs([d.x, d.y, d.z], aim.exitDir)).toBeLessThan(ULP_DIR * ulp(1));
        });

        /**
         * NEGATIVE CONTROL. Paraxial aiming has to FAIL this wherever the
         * perturbation actually moved the target, or the rung above would pass
         * without real aiming existing and would be pinning nothing.
         *
         * It is asserted only where the target moved, because a tilt about a
         * surface's own vertex does not move that vertex — so on the three
         * pure-tilt singlets the two aiming modes are solving the same problem
         * and agreeing is the correct answer, not a missed defect. The structural
         * rung below pins which systems those are.
         */
        it("paraxial aiming reaches a different ray wherever the target actually moved", () => {
          const targetMoved = system.frames[aim.stopSurface]!.vertex;
          const nominalZ = system.surfaces
            .slice(0, aim.stopSurface)
            .reduce((z, s) => z + s.thickness, 0);
          const moved = Math.hypot(targetMoved[0], targetMoved[1], targetMoved[2] - nominalZ);

          const paraxialSystem: OpticalSystem = { ...aimSystem, rayAiming: "paraxial" };
          const pupil = pupils(paraxialSystem, FIXTURE.wavelengthNm);
          const ray = chiefRay(paraxialSystem, pupil, aim.fieldDeg, FIXTURE.wavelengthNm);
          const traced = traceRay(paraxialSystem.prescription, ray);
          const p = traced.path[aim.stopSurface]!;
          const gap = maxAbs([p.x, p.y, p.z], aim.hits[aim.stopSurface + 1]!);

          if (moved > 1e-9) {
            // the miss is the target's own displacement, not a rounding difference
            expect(gap).toBeGreaterThan(0.1 * moved);
          } else {
            expect(gap).toBeLessThan(1e-6);
          }
        });
      }

      it("the hit point on every surface agrees to the last bits of a double", () => {
        const tolerance = pointTolerance(system);
        for (let i = 0; i < traced.length; i++) {
          const hits = system.expected[i]!.hits;
          for (let s = 0; s < traced[i]!.path.length; s++) {
            const p = traced[i]!.path[s]!;
            expect(maxAbs([p.x, p.y, p.z], hits[s + 1]!)).toBeLessThan(tolerance);
          }
        }
      });

      it("the exit direction cosines agree to the last bits of a double", () => {
        for (let i = 0; i < traced.length; i++) {
          const d = traced[i]!.ray!.dir;
          expect(maxAbs([d.x, d.y, d.z], system.expected[i]!.dir)).toBeLessThan(ULP_DIR * ulp(1));
        }
      });

      /**
       * The direction after EVERY surface, not only the last one.
       *
       * The exit direction is a product of all the interactions, so an error at
       * one surface that a later surface undoes is invisible in it — and on the
       * folded systems it is the direction leaving a MIRROR that the fold rung
       * below needs. `traceRay` reports hit points and a final ray, so the
       * intermediate directions are recovered from consecutive hits, which is
       * where the tolerance comes from: two points good to `pointTolerance` fix
       * a direction to that over their separation, and a 6 mm glass segment
       * therefore earns a looser bound than an 800 mm tube. The rounding floor
       * is added rather than substituted, so a short segment is never held
       * tighter than a double allows.
       */
      it("the direction leaving every surface agrees, not only the last", () => {
        const floor = ULP_DIR * ulp(1);
        const spread = pointTolerance(system);
        for (let i = 0; i < traced.length; i++) {
          const segDirs = system.expected[i]!.segDirs;
          expect(segDirs.length).toBe(traced[i]!.path.length);
          const path = traced[i]!.path;
          for (let s = 0; s < segDirs.length; s++) {
            if (s === segDirs.length - 1) {
              const d = traced[i]!.ray!.dir;
              expect(maxAbs([d.x, d.y, d.z], segDirs[s]!)).toBeLessThan(floor);
              continue;
            }
            const a = path[s]!;
            const b = path[s + 1]!;
            const step = vec3(b.x - a.x, b.y - a.y, b.z - a.z);
            const len = Math.hypot(step.x, step.y, step.z);
            const dir = [step.x / len, step.y / len, step.z / len];
            expect(maxAbs(dir, segDirs[s]!)).toBeLessThan(floor + (2 * spread) / len);
          }
        }
      });

      it("the optical path length agrees to the last bits of a double", () => {
        for (let i = 0; i < traced.length; i++) {
          const expected = system.expected[i]!.opl;
          expect(Math.abs(traced[i]!.opl - expected)).toBeLessThan(ULP_OPL * ulp(expected));
        }
      });

      /**
       * The quantity the wave layer is actually built on. An absolute path
       * length carries the launch plane's own offset, which a shared convention
       * could hide; a wavefront carries only differences, so this is the
       * comparison that matters for OPD — and it is the one that would expose a
       * constant offset shared by both sides.
       */
      it("optical path DIFFERENCES across the pupil agree, in waves as well as in ulp", () => {
        const base = traced[0]!.opl;
        const baseExpected = system.expected[0]!.opl;
        for (let i = 1; i < traced.length; i++) {
          const delta = Math.abs(
            traced[i]!.opl - base - (system.expected[i]!.opl - baseExpected),
          );
          expect(delta).toBeLessThan(ULP_OPD * ulp(baseExpected));
          expect(delta / (FIXTURE.wavelengthNm * 1e-6)).toBeLessThan(MAX_OPD_WAVES);
        }
      });
    });
  }

  /**
   * A cross-check that cannot fail proves nothing — the same argument the
   * golden-image gate makes one layer down. Each control damages exactly one
   * input and requires the comparison to notice AT the tolerances above, not at
   * some larger one, and each is aimed at a specific way this fixture could be
   * agreeing for the wrong reason.
   */
  describe("the comparison can fail", () => {
    const achromat = FIXTURE.systems[0]!;
    const achromatRx = prescriptionOf(achromat);
    const RAY = 4; // a pupil height where spherical aberration is real

    it("a 1 nm shift of the launch height moves the exit ray past every tolerance", () => {
      const r = achromat.rays[RAY]!;
      const nudged = traceRay(
        achromatRx,
        makeRay(
          vec3(r.origin[0], r.origin[1] + 1e-6, r.origin[2]),
          vec3(...r.dir),
          FIXTURE.wavelengthNm,
        ),
      );
      const e = achromat.expected[RAY]!;
      const d = nudged.ray!.dir;
      expect(maxAbs([d.x, d.y, d.z], e.dir)).toBeGreaterThan(ULP_DIR * ulp(1));
      const p = nudged.path[nudged.path.length - 1]!;
      const last = e.hits[e.hits.length - 1]!;
      expect(maxAbs([p.x, p.y, p.z], last)).toBeGreaterThan(
        pointTolerance(achromat),
      );
    });

    it("a 1e-7 error in one index moves the optical path past its tolerance", () => {
      const bent: Prescription = {
        ...achromatRx,
        surfaces: achromatRx.surfaces.map((s, i) =>
          i === 0 ? { ...s, medium: mediumName(achromat.surfaces[0]!.indexAfter! + 1e-7) } : s,
        ),
      };
      const res = traceRay(
        bent,
        makeRay(
          vec3(...achromat.rays[RAY]!.origin),
          vec3(...achromat.rays[RAY]!.dir),
          FIXTURE.wavelengthNm,
        ),
      );
      const e = achromat.expected[RAY]!.opl;
      expect(Math.abs(res.opl - e)).toBeGreaterThan(ULP_OPL * ulp(e));
    });

    /**
     * The mirror system's conics are what make it a Cassegrain rather than two
     * spheres, and the asphere's coefficients are what make the last system
     * more than a conic. Both are checked by damage, because both are exactly
     * the sort of term that could be silently ignored on one side while every
     * other number still matched.
     */
    it("a sphere where the fixture has a paraboloid fails", () => {
      const cass = FIXTURE.systems.find((s) => s.id.startsWith("cassegrain"))!;
      const rx = prescriptionOf(cass);
      const flattened: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((s, i) => (i === 0 ? { ...s, conic: 0 } : s)),
      };
      const r = cass.rays[0]!;
      const res = traceRay(flattened, makeRay(vec3(...r.origin), vec3(...r.dir), FIXTURE.wavelengthNm));
      const last = cass.expected[0]!.hits[cass.expected[0]!.hits.length - 1]!;
      const p = res.path[res.path.length - 1]!;
      expect(maxAbs([p.x, p.y, p.z], last)).toBeGreaterThan(
        pointTolerance(cass),
      );
    });

    it("dropping the asphere coefficients fails, so the r⁴ convention is exercised", () => {
      const asph = FIXTURE.systems.find((s) => s.id === "asphere-singlet")!;
      const rx = prescriptionOf(asph);
      const conicOnly: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map(({ asphereCoeffs: _drop, ...rest }) => rest),
      };
      const r = asph.rays[4]!;
      const res = traceRay(conicOnly, makeRay(vec3(...r.origin), vec3(...r.dir), FIXTURE.wavelengthNm));
      const e = asph.expected[4]!;
      const last = e.hits[e.hits.length - 1]!;
      const p = res.path[res.path.length - 1]!;
      expect(maxAbs([p.x, p.y, p.z], last)).toBeGreaterThan(
        pointTolerance(asph),
      );
    });

    /**
     * The misalignment controls, and they are the ones that matter most here.
     * A tilt that agrees could be agreeing because BOTH sides ignored it, or
     * because a sign error and an order error cancelled. Each of the three
     * below damages exactly one thing the reconciliation claims: the sign of a
     * tilt, the order the two tilts multiply in, and the order a tilt and a
     * decenter compose in.
     */
    const misaligned = (id: string) => FIXTURE.systems.find((s) => s.id === id)!;

    /** The worst |Δ| over a system's last hit points when a surface is damaged. */
    const worstAgainstFixture = (s: FixtureSystem, rx: Prescription): number =>
      Math.max(
        ...s.rays.map((r, i) => {
          const res = traceRay(rx, makeRay(vec3(...r.origin), vec3(...r.dir), FIXTURE.wavelengthNm));
          const p = res.path[res.path.length - 1]!;
          const e = s.expected[i]!.hits[s.expected[i]!.hits.length - 1]!;
          return maxAbs([p.x, p.y, p.z], e);
        }),
      );

    it("flipping the sign of a tilt fails, so the handedness is pinned and not assumed", () => {
      const s = misaligned("tilt-x");
      const rx = prescriptionOf(s);
      const flipped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined ? x : { ...x, tiltXDeg: -x.tiltXDeg },
        ),
      };
      expect(worstAgainstFixture(s, flipped)).toBeGreaterThan(pointTolerance(s));
    });

    /**
     * The one control the whole two-axis system exists for. Ry·Rx and Rx·Ry
     * differ at second order in the angles, which is why `tilt-xy` carries 12°
     * and 9° rather than a realistic misalignment: at a tenth of a degree the
     * two orderings differ by less than the tolerance and this control would
     * pass under either convention, proving nothing.
     */
    it("swapping the two tilt angles fails, so Ry·Rx is pinned and not Rx·Ry", () => {
      const s = misaligned("tilt-xy");
      const rx = prescriptionOf(s);
      const swapped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined || x.tiltYDeg === undefined
            ? x
            : { ...x, tiltXDeg: x.tiltYDeg, tiltYDeg: x.tiltXDeg },
        ),
      };
      // Ry(9°)·Rx(12°) against Ry(12°)·Rx(9°): the same two rotations, composed
      // the same way round, differing only in which angle went on which axis.
      expect(worstAgainstFixture(s, swapped)).toBeGreaterThan(pointTolerance(s));
    });

    /**
     * "Shift the vertex, then rotate about it" against "rotate first, then shift
     * along the rotated axes". Both programs do the former; the vertex they
     * disagree about under the latter is R·d instead of d.
     *
     * Two assertions, because neither alone is enough. The first is positive
     * and exact: the reference's own vertex for the tilted surface is the
     * un-rotated shift, so the fixture is not merely being read the way this
     * engine happens to write. The second is the damage — and it can only
     * emulate PART of the alternative, since R·d has a z component and a
     * decenter has no z to put it in, which makes the control conservative:
     * the real difference between the conventions is larger than what is
     * asserted to be detected here.
     */
    it("the decenter is read in the incoming frame, not along the tilted axes", () => {
      const s = misaligned("tilt-and-decenter");
      const i = s.surfaces.findIndex((x) => x.tiltXDeg !== undefined);
      const surf = s.surfaces[i]!;
      const tx = (surf.tiltXDeg! * Math.PI) / 180;
      const zBefore = s.surfaces.slice(0, i).reduce((z, x) => z + x.thickness, 0);
      const vertex = s.frames[i]!.vertex;
      expect(maxAbs([...vertex], [surf.decenterX!, surf.decenterY!, zBefore])).toBeLessThan(
        pointTolerance(s),
      );
      // and the reading this rules out is far enough away to be ruled out
      const rotatedZ = zBefore + surf.decenterY! * Math.sin(tx);
      expect(Math.abs(vertex[2] - rotatedZ)).toBeGreaterThan(1e-3);
    });

    it("shifting along the tilted axes instead of before the tilt fails", () => {
      const s = misaligned("tilt-and-decenter");
      const rx = prescriptionOf(s);
      const tilted = s.surfaces.find((x) => x.tiltXDeg !== undefined)!;
      const tx = (tilted.tiltXDeg! * Math.PI) / 180;
      const rotated: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined ? x : { ...x, decenterY: tilted.decenterY! * Math.cos(tx) },
        ),
      };
      expect(worstAgainstFixture(s, rotated)).toBeGreaterThan(pointTolerance(s));
    });

    it("the sixteen systems are not sixteen spellings of one shape", () => {
      const kinds = FIXTURE.systems.map((s) => ({
        mirrors: s.surfaces.some((x) => x.reflect),
        conics: s.surfaces.some((x) => x.conic !== undefined && x.conic !== 0),
        aspheres: s.surfaces.some((x) => x.asphereCoeffs),
        media: new Set(s.surfaces.map((x) => x.indexAfter).filter((n) => n !== undefined)).size,
        surfaces: s.surfaces.length,
      }));
      expect(kinds.some((k) => k.mirrors)).toBe(true);
      expect(kinds.some((k) => k.conics && !k.mirrors)).toBe(true);
      expect(kinds.some((k) => k.aspheres)).toBe(true);
      expect(kinds.some((k) => k.media >= 3)).toBe(true); // two glasses and air
      expect(Math.max(...kinds.map((k) => k.surfaces))).toBeGreaterThanOrEqual(6);
      // skew rays somewhere, or the whole fixture is meridional and the third
      // coordinate is never tested
      expect(
        FIXTURE.systems.every((s) => s.rays.some((r) => r.origin[0] !== 0 || r.dir[0] !== 0)),
      ).toBe(true);
      // and a ray that leaves the axis on the way in, or nothing is off-axis
      expect(FIXTURE.systems.every((s) => s.rays.some((r) => r.dir[1] !== 0))).toBe(true);
    });

    /**
     * The misalignment family's own version of the same argument. Isolation is
     * the property that makes a disagreement diagnosable — if the first system
     * to exercise a decenter also tilted, a sign error in one could be absorbed
     * by an order error in the other and the pair would still agree. So this
     * asserts that each degree of freedom is reached ALONE somewhere, that the
     * two combinations exist (they are the only things that can see an
     * ordering), and that the tilt has something downstream of it to steer.
     */
    it("each misalignment degree of freedom is exercised alone, and the combinations exist", () => {
      const moved = (s: FixtureSystem) =>
        s.surfaces.flatMap((x) =>
          (["tiltXDeg", "tiltYDeg", "decenterX", "decenterY"] as const).filter(
            (k) => x[k] !== undefined && x[k] !== 0,
          ),
        );
      // Scoped to the refracting family on purpose: § 0.3's folded systems also
      // carry tilts, but a 45° diagonal is a fold and not a misalignment, and
      // counting it here would make this rung report coverage it does not have.
      const misalignedSystems = FIXTURE.systems.filter(
        (s) => moved(s).length > 0 && s.surfaces.every((x) => !x.reflect),
      );
      expect(misalignedSystems.length).toBe(7);

      // one degree of freedom, alone, for each of the four
      for (const dof of ["tiltXDeg", "tiltYDeg", "decenterX", "decenterY"] as const) {
        expect(
          misalignedSystems.some((s) => {
            const m = moved(s);
            return m.length === 1 && m[0] === dof;
          }),
        ).toBe(true);
      }

      // the two tilts on ONE surface, large enough that Ry·Rx and Rx·Ry differ
      // by more than a tolerance — 12° and 9° here; at 0.1° they would not
      const twoAxis = misalignedSystems.flatMap((s) =>
        s.surfaces.filter((x) => x.tiltXDeg && x.tiltYDeg),
      );
      expect(twoAxis.length).toBeGreaterThanOrEqual(1);
      expect(Math.min(...twoAxis.map((x) => Math.abs(x.tiltXDeg!)))).toBeGreaterThan(1);

      // a tilt and a decenter on ONE surface, or nothing sees their order
      expect(
        misalignedSystems.some((s) =>
          s.surfaces.some((x) => (x.tiltXDeg ?? x.tiltYDeg) && (x.decenterX ?? x.decenterY)),
        ),
      ).toBe(true);

      // a tilted surface with at least two surfaces after it: a tilt with
      // nothing downstream cannot tell the local chain from tilt-and-return
      expect(
        misalignedSystems.some((s) =>
          s.surfaces.some(
            (x, i) => (x.tiltXDeg ?? x.tiltYDeg) && s.surfaces.length - i - 1 >= 2,
          ),
        ),
      ).toBe(true);
    });

    /**
     * § 0.3's own version of the same argument, and the counterpart of the line
     * this rung replaced: the header used to promise that every misaligned
     * system refracts, because tilted mirrors were open. They are not open now,
     * so what has to be asserted is the opposite — that a REFLECTING surface is
     * the one that moved, under both chain conventions, with something
     * downstream of it in each case.
     */
    it("a mirror is the surface that moved, folded and unfolded, with a chain to steer", () => {
      const tiltedMirror = (s: FixtureSystem) =>
        s.surfaces.findIndex((x) => x.reflect && (x.tiltXDeg ?? x.tiltYDeg));

      // the misalignment reading: a tilted mirror on the DEFAULT chain
      const unfolded = FIXTURE.systems.filter(
        (s) => s.mirrorFrames === undefined && tiltedMirror(s) >= 0,
      );
      expect(unfolded.length).toBeGreaterThanOrEqual(1);
      // two axes and a decenter on that mirror, or the mirror case is thinner
      // than the refracting one it is extending
      expect(
        unfolded.some((s) => {
          const x = s.surfaces[tiltedMirror(s)]!;
          return Boolean(x.tiltXDeg && x.tiltYDeg && (x.decenterX ?? x.decenterY));
        }),
      ).toBe(true);

      // the fold reading: four systems, and each has surfaces downstream of the
      // mirror whose placement the fold decides
      const folded = FIXTURE.systems.filter((s) => s.mirrorFrames === "folded");
      expect(folded.length).toBe(4);
      expect(folded.every((s) => s.surfaces.some((x) => x.reflect))).toBe(true);
      expect(
        folded.filter((s) => {
          const k = tiltedMirror(s);
          return k >= 0 && k < s.surfaces.length - 1;
        }).length,
      ).toBe(3);

      // one fold is CURVED and one is not 45°, or the parity of a curvature is
      // never read and half a tilt is indistinguishable from its double
      expect(
        folded.some((s) => s.surfaces.some((x) => x.reflect && x.curvature !== 0 && (x.tiltXDeg ?? x.tiltYDeg))),
      ).toBe(true);
      expect(
        folded.some((s) =>
          s.surfaces.some((x) => x.reflect && (x.tiltYDeg ?? 0) !== 0 && (x.tiltYDeg ?? 0) !== 45),
        ),
      ).toBe(true);

      // a surface with POWER behind an odd number of mirrors, which is the only
      // place the curvature parity of the reconciliation can be wrong
      expect(
        folded.some((s) => {
          let mirrors = 0;
          return s.surfaces.some((x) => {
            const behindOdd = mirrors % 2 === 1;
            if (x.reflect) mirrors++;
            return behindOdd && !x.reflect && x.curvature !== 0;
          });
        }),
      ).toBe(true);

      // two mirrors somewhere, or the parity never returns and a rule that
      // flipped once too often would pass everywhere
      expect(folded.some((s) => s.surfaces.filter((x) => x.reflect).length === 2)).toBe(true);
    });

    /**
     * What the aimed-chief-ray rungs actually cover, counted rather than
     * assumed. Three of the seven aim at a target the perturbation did not move
     * — a tilt is about a surface's own vertex, so aiming at that vertex is the
     * same problem tilted or not — and on those the paraxial control is
     * correctly silent. This rung exists so that fact is a recorded property of
     * the fixture instead of three quietly toothless cases.
     */
    it("the aimed rungs say which of them the paraxial control can bite on", () => {
      const aimed = FIXTURE.systems.filter((s) => s.aim);
      expect(aimed.length).toBe(7);

      const displacement = (s: FixtureSystem) => {
        const k = s.aim!.stopSurface;
        const v = s.frames[k]!.vertex;
        const nominalZ = s.surfaces.slice(0, k).reduce((z, x) => z + x.thickness, 0);
        return Math.hypot(v[0], v[1], v[2] - nominalZ);
      };
      const moved = aimed.filter((s) => displacement(s) > 1e-9);
      const still = aimed.filter((s) => displacement(s) <= 1e-9);

      // four targets move, so the negative control is exercised four times
      expect(moved.length).toBe(4);
      // and the three that do not are exactly the pure tilts
      expect(still.map((s) => s.id).sort()).toEqual(["tilt-x", "tilt-xy", "tilt-y"]);
      expect(
        still.every((s) => s.surfaces.every((x) => !x.decenterX && !x.decenterY)),
      ).toBe(true);

      // and at least one aims THROUGH a perturbation rather than AT one, which
      // is the only arrangement that tests aiming through misaligned glass
      expect(
        aimed.some((s) =>
          s.surfaces.some(
            (x, i) =>
              i < s.aim!.stopSurface && (x.tiltXDeg ?? x.tiltYDeg ?? x.decenterX ?? x.decenterY),
          ),
        ),
      ).toBe(true);
    });

    /**
     * The control for the one failure the ray comparison cannot see at all: a
     * misalignment that BOTH programs ignored. Every agreement above would
     * still hold, because two tracers agree perfectly about a surface neither
     * of them moved.
     *
     * The six singlet systems are one shape traced by one ray set, differing
     * only in the perturbation each carries, so two of them landing on the same
     * point is exactly that failure — and it is checked on the fixture's own
     * numbers, which is the side this suite cannot otherwise inspect.
     */
    it("the reference itself moved: no two singlet systems traced to the same place", () => {
      const singlets = FIXTURE.systems.filter(
        (s) =>
          s.surfaces.length === 2 &&
          // refracting only: a two-surface folded system would be swept in here
          // and then fail the "one shape, one ray set" assertion below for a
          // reason that is not a defect
          s.surfaces.every((x) => !x.reflect) &&
          s.surfaces.some(
            (x) => x.tiltXDeg ?? x.tiltYDeg ?? x.decenterX ?? x.decenterY,
          ),
      );
      expect(singlets.length).toBe(6);
      // one shape and one ray set, or the comparison below is between systems
      // that differ for a second reason
      for (const s of singlets) {
        expect(s.surfaces.map((x) => x.curvature)).toEqual(
          singlets[0]!.surfaces.map((x) => x.curvature),
        );
        expect(s.rays).toEqual(singlets[0]!.rays);
      }
      const exits = singlets.map((s) =>
        s.expected.map((e) => e.hits[e.hits.length - 1]!),
      );
      for (let i = 0; i < exits.length; i++) {
        for (let j = i + 1; j < exits.length; j++) {
          // Over the whole ray set, not one ray: a surface tilted about its own
          // vertex leaves the ray THROUGH that vertex exactly where it was, so
          // the three tilt systems share their axial ray's exit point to 5.5e-17
          // while differing by millimetres everywhere else. Asserting on one ray
          // would have failed here for a reason that is geometry, not a defect.
          const worst = Math.max(
            ...exits[i]!.map((p, k) => maxAbs([...p], [...exits[j]![k]!])),
          );
          expect(worst).toBeGreaterThan(1e-3);
        }
      }
    });

    /**
     * § 0.3's controls. The fold reconciliation is four rules travelling
     * together — a frame flip, a curvature parity, a thickness parity and a
     * conjugated tilt — and rules that travel together are exactly the ones
     * that can be wrong in a way that cancels. Each control below damages one
     * of them and requires the comparison to notice.
     *
     * "Notices" means either the exit point moves past tolerance or the ray
     * stops tracing at all; both are the fixture doing its job, and a damaged
     * system that still lands on the reference is the only forbidden outcome.
     */
    const stillAgrees = (s: FixtureSystem, rx: Prescription): boolean =>
      s.rays.every((r, i) => {
        const res = traceRay(rx, makeRay(vec3(...r.origin), vec3(...r.dir), FIXTURE.wavelengthNm));
        if (res.status !== "ok") return false;
        const p = res.path[res.path.length - 1]!;
        const e = s.expected[i]!.hits[s.expected[i]!.hits.length - 1]!;
        return maxAbs([p.x, p.y, p.z], e) < pointTolerance(s);
      });

    const folded = (id: string) => FIXTURE.systems.find((s) => s.id === id)!;

    it("the z-flip between the two frame conventions is a real rotation, not bookkeeping", () => {
      // The frames rung carries the fixture's rotation through `expectedRotation`
      // before comparing. If that flip were a no-op the rung would pass whether
      // or not the engine folded the chain, so here is the flip's own size: the
      // lens behind `fold-flat-45`'s diagonal, compared RAW, is a whole axis out.
      const s = folded("fold-flat-45");
      const c = compile(prescriptionOf(s));
      expect(maxAbs([...c.surfaces[1]!.frame.rotation], s.frames[1]!.rotation)).toBeGreaterThan(1);
      // ...and with the flip it is at the rounding floor, which is the rung above
      expect(maxAbs([...c.surfaces[1]!.frame.rotation], expectedRotation(s, 1))).toBeLessThan(
        ULP_DIR * ulp(1),
      );
    });

    it("reading the same surfaces on the default chain fails, so the fold is what is pinned", () => {
      // The strongest of these: drop `mirrorFrames` and every downstream surface
      // moves to where the UNFOLDED convention would put it — along the mirror's
      // own tilted axis instead of along the beam. Nothing else about the
      // prescription changes.
      for (const id of ["fold-flat-45", "newtonian-fold", "fold-sphere-15"]) {
        const s = folded(id);
        const { mirrorFrames: _drop, ...unfolded } = prescriptionOf(s);
        expect(stillAgrees(s, unfolded)).toBe(false);
      }
    });

    it("a curvature that does not carry the parity fails, behind an odd mirror count", () => {
      // `fold-flat-45`'s lens sits behind one mirror, so its +0.01 is −0.01 in
      // the model rayoptics traced. Negating it here is precisely the engine
      // reading a curvature in the launch frame instead of against the beam.
      const s = folded("fold-flat-45");
      const rx = prescriptionOf(s);
      const flipped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x, i) => (i === 1 ? { ...x, curvature: -x.curvature } : x)),
      };
      expect(stillAgrees(s, flipped)).toBe(false);
    });

    it("a post-mirror thickness that keeps the unfolded sign fails", () => {
      // The other half of the same rule: in a folded chain the distance to the
      // next vertex is a distance along the light and stays positive. Writing
      // the unfolded convention's negative one walks backwards up the tube.
      const s = folded("newtonian-fold");
      const rx = prescriptionOf(s);
      const negated: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x, i) => (i === 0 ? { ...x, thickness: -x.thickness } : x)),
      };
      expect(stillAgrees(s, negated)).toBe(false);
    });

    it("the conjugated tilt matters: the diagonal's angle is not its own negative", () => {
      // `newtonian-fold`'s diagonal sits behind one mirror, which is where the
      // fixture hands rayoptics D·T·D rather than T. If that conjugation were
      // dropped on one side the two programs would be folding to opposite sides
      // of the tube, so flipping the sign here must be visible.
      const s = folded("newtonian-fold");
      const rx = prescriptionOf(s);
      const flipped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined ? x : { ...x, tiltXDeg: -x.tiltXDeg },
        ),
      };
      expect(stillAgrees(s, flipped)).toBe(false);
    });

    /**
     * The fold rung's own blindness check. It compares the engine's outgoing
     * frame against the beam rayoptics traced — but on an UNTILTED mirror the
     * chain simply reverses, which any implementation gets right, so the rung
     * would pass on a system that never exercised a tilted fold at all. This
     * asserts the fixture contains folds that actually turn a corner.
     */
    it("the folds turn the chain, so the fold rung is not agreeing about a straight line", () => {
      for (const id of ["fold-flat-45", "newtonian-fold", "fold-sphere-15", "fold-compound-tilt"]) {
        const s = folded(id);
        const c = compile(prescriptionOf(s));
        const k = s.surfaces.findIndex((x) => x.reflect && (x.tiltXDeg ?? x.tiltYDeg));
        const before = applyToDirection(
          k === 0 ? c.surfaces[0]!.frame : c.surfaces[k - 1]!.outgoingFrame,
          vec3(0, 0, 1),
        );
        const after = applyToDirection(c.surfaces[k]!.outgoingFrame, vec3(0, 0, 1));
        const turn =
          (Math.acos(
            Math.min(1, before.x * after.x + before.y * after.y + before.z * after.z),
          ) *
            180) /
          Math.PI;
        // 30° at the shallowest (the 15° curved fold), 90° at the diagonals
        expect(turn).toBeGreaterThan(25);
      }
    });
  });
});
