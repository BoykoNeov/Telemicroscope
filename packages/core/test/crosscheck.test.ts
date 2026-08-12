import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vec3 } from "../src/math/vec3";
import { makeRay } from "../src/trace/ray";
import { traceRay } from "../src/trace/sequential";
import { compile } from "../src/trace/compile";
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
 * WHAT THIS DOES NOT PIN. Dispersion: both sides are handed the same numbers,
 * on purpose, so `materials`' Sellmeier evaluation is out of scope here (it has
 * its own rung against datasheet nd/Vd). Apertures: every ray is well inside
 * every rim and the prescriptions are built unbounded, so vignetting is out of
 * scope too. TILTED MIRRORS and the folded frame stay open, deliberately: a
 * mirror under `mirrorFrames: "folded"` reflects the coordinate chain in its own
 * tangent plane, which is a second convention with its own handedness and sign
 * questions, and every misaligned system here refracts.
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
}

interface FixtureSystem {
  readonly id: string;
  readonly note: string;
  readonly objectIndex: number;
  readonly surfaces: readonly FixtureSurface[];
  readonly frames: readonly FixtureFrame[];
  readonly rays: readonly FixtureRay[];
  readonly expected: readonly FixtureExpectation[];
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
  return { objectMedium: mediumName(system.objectIndex), surfaces };
}

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
    expect(FIXTURE.systems.length).toBe(11);
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
       */
      it("every surface's compiled frame is the one rayoptics traced through", () => {
        const compiled = compile(prescription);
        expect(system.frames.length).toBe(system.surfaces.length);
        for (let i = 0; i < system.frames.length; i++) {
          const frame = compiled.surfaces[i]!.frame;
          expect(maxAbs([...frame.rotation], system.frames[i]!.rotation)).toBeLessThan(
            ULP_DIR * ulp(1),
          );
          const v = frame.translation;
          expect(maxAbs([v.x, v.y, v.z], system.frames[i]!.vertex)).toBeLessThan(
            pointTolerance(system),
          );
        }
      });

      it("every fixture ray traces, and reaches every surface", () => {
        expect(system.rays.length).toBe(system.expected.length);
        expect(system.rays.length).toBeGreaterThanOrEqual(8);
        for (let i = 0; i < traced.length; i++) {
          expect(traced[i]!.status).toBe("ok");
          // hits[0] is the launch point both sides were handed.
          expect(traced[i]!.path.length).toBe(system.expected[i]!.hits.length - 1);
        }
      });

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

    it("the eleven systems are not eleven spellings of one shape", () => {
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
      const misalignedSystems = FIXTURE.systems.filter((s) => moved(s).length > 0);
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
      const twoAxis = FIXTURE.systems.flatMap((s) =>
        s.surfaces.filter((x) => x.tiltXDeg && x.tiltYDeg),
      );
      expect(twoAxis.length).toBeGreaterThanOrEqual(1);
      expect(Math.min(...twoAxis.map((x) => Math.abs(x.tiltXDeg!)))).toBeGreaterThan(1);

      // a tilt and a decenter on ONE surface, or nothing sees their order
      expect(
        FIXTURE.systems.some((s) =>
          s.surfaces.some((x) => (x.tiltXDeg ?? x.tiltYDeg) && (x.decenterX ?? x.decenterY)),
        ),
      ).toBe(true);

      // a tilted surface with at least two surfaces after it: a tilt with
      // nothing downstream cannot tell the local chain from tilt-and-return
      expect(
        FIXTURE.systems.some((s) =>
          s.surfaces.some(
            (x, i) => (x.tiltXDeg ?? x.tiltYDeg) && s.surfaces.length - i - 1 >= 2,
          ),
        ),
      ).toBe(true);

      // every misaligned system refracts: tilted mirrors and the folded frame
      // are named as open in this file's header, and this keeps them out
      expect(misalignedSystems.every((s) => s.surfaces.every((x) => !x.reflect))).toBe(true);
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
  });
});
