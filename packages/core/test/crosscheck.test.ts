import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vec3 } from "../src/math/vec3";
import { makeRay } from "../src/trace/ray";
import { traceRay } from "../src/trace/sequential";
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
 * WHAT THIS DOES NOT PIN. Dispersion: both sides are handed the same numbers,
 * on purpose, so `materials`' Sellmeier evaluation is out of scope here (it has
 * its own rung against datasheet nd/Vd). Apertures: every ray is well inside
 * every rim and the prescriptions are built unbounded, so vignetting is out of
 * scope too. Tilt/decenter and the folded frame: rayoptics expresses both, but
 * reconciling two tilt conventions is a second investigation and it is named as
 * open rather than half-done — these four systems are all axial.
 */

interface FixtureSurface {
  readonly curvature: number;
  readonly conic?: number;
  readonly asphereCoeffs?: readonly number[];
  readonly thickness: number;
  readonly indexAfter?: number;
  readonly reflect?: boolean;
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
    expect(FIXTURE.systems.length).toBe(4);
  });

  for (const system of FIXTURE.systems) {
    describe(system.id, () => {
      const prescription = prescriptionOf(system);
      const traced = system.rays.map((r) => traceFixtureRay(prescription, r));

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

    it("the four systems are not four spellings of one shape", () => {
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
  });
});
