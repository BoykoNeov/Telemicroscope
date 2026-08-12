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
 * A SECOND independent tracer — docs/VALIDATION.md § 0.4, and the last thing
 * ROADMAP's cross-validation item named as open.
 *
 * § 0 compared the engine to rayoptics and found nothing to report at the last
 * bit. That is an agreement between two programs, and an agreement between two
 * programs is not a majority: where they had agreed about a convention rather
 * than about arithmetic, nothing in that file could have said so. This one adds
 * a third implementation — Optiland 0.6.1 (Kramer Harrison, MIT), which shares
 * no lineage with either — and compares three ways: engine against Optiland,
 * and, with the engine out of it entirely, rayoptics against Optiland.
 *
 * THE INPUTS ARE THE SAME INPUTS, and that is what makes the third comparison
 * worth anything. `docs/notes/optiland-crosscheck.py` reads `surfaces`, `rays`,
 * `objectIndex` and the wavelength verbatim out of the rayoptics fixture rather
 * than re-deriving them from `designs/`, and the first rung below asserts that
 * identity field by field. Two programs agreeing about an achromat and an
 * achromat-shaped thing is not evidence about either.
 *
 * WHAT IS COMPARED is § 0's primitive, unchanged: a ray given as a point and a
 * direction, traced surface by surface, ending on the last surface. No pupil
 * coordinates, no aiming, no field angles, no image plane, no glass catalog.
 *
 * THE FINDING IS THE TILT. rayoptics spells a surface's rotation
 * Rx(−α)·Ry(−β)·Rz(γ), which is not the engine's Ry(tiltY)·Rx(tiltX) family at
 * all, so § 0.1 could only compare FRAMES and had to solve for an Euler triple
 * to build the systems. Optiland's `CoordinateSystem` builds Rz(rz)·Ry(ry)·Rx(rx),
 * so with rz = 0 it is the engine's own spelling, angle for angle, and the
 * generator states `tiltXDeg` as rx and `tiltYDeg` as ry and stops. The engine's
 * tilt parameterization is therefore not idiosyncratic — an independent
 * implementation writes it identically. § 0's negative controls (a sign, and the
 * order of two tilts) are what say this is measured rather than assumed.
 *
 * TWO CONSTRUCTIONS, and the split is the scope note.
 *
 * On the twelve unfolded systems — eight of them misaligned — Optiland is given
 * a chain: surface i's coordinate system references surface (i−1)'s, carrying a
 * decenter, the previous thickness and the tilt. OPTILAND composes it, and the
 * frames in the fixture are its own answer about where the glass is, so the
 * frame rung below is independent evidence for the local coordinate chain.
 *
 * On the four folded systems there is no such thing. Optiland has no fold
 * concept at all: a coordinate system is a placement, a mirror is an
 * interaction, and nothing in the library reverses a chain. So those systems are
 * placed by absolute frame, computed in the generator, and the fixture carries
 * NO frames for them — comparing `compile()` against frames the generator
 * derived would be checking a transcription against its own source. What the
 * folded four vote on is the BEAM: Optiland traces through that placement and
 * must reproduce rayoptics' hit points, per-surface directions and path lengths.
 *
 * That is independent evidence rather than two transcriptions agreeing, and it
 * is worth saying exactly why, because it is the kind of claim that reads
 * stronger than it is. On three of the four, rayoptics placed the surfaces AFTER
 * the mirror by its own rule — `DecenterData('bend')` on a tilted fold, a
 * parity-flipped `'decenter'` on the Newtonian's untilted primary — so two
 * unrelated placements arrive at one geometry and the rays can adjudicate. On
 * `fold-compound-tilt` there is nothing after the mirror at all: it is the last
 * surface on purpose, because that is the one system where 'bend' is 0.88° from
 * the reflection (§ 0.3). So that system's rays pin the mirror's own tilt and
 * its reflection, and say nothing about a fold CONTINUATION — which is § 0.3's
 * `foldCheck` rung and is not restated here.
 *
 * WHAT THIS DOES NOT PIN. § 0.2's aimed chief rays are deliberately out — that
 * is a question about two solvers, and a majority about the tracer does not need
 * a third one. No new system and no new ray appears here: either would force the
 * rayoptics fixture to be regenerated to keep the two answering one question.
 * Dispersion and apertures stay out for § 0's reasons, unchanged.
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

interface FixtureFrame {
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
  readonly segDirs: readonly (readonly [number, number, number])[];
}

interface OptilandSystem {
  readonly id: string;
  /** "chain" — Optiland composed the local coordinate chain; "absolute" — the
   *  generator placed each surface, because a fold has no chain here. */
  readonly placement: "chain" | "absolute";
  readonly objectIndex: number;
  readonly mirrorFrames?: "folded";
  readonly surfaces: readonly FixtureSurface[];
  readonly rays: readonly FixtureRay[];
  readonly expected: readonly FixtureExpectation[];
  /** Present only on `placement: "chain"` — see the header. */
  readonly frames?: readonly FixtureFrame[];
}

interface RayopticsSystem {
  readonly id: string;
  readonly objectIndex: number;
  readonly surfaces: readonly FixtureSurface[];
  readonly rays: readonly FixtureRay[];
  readonly expected: readonly FixtureExpectation[];
}

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8")) as T;

const OPTILAND = read<{
  readonly _generator: Record<string, string>;
  readonly wavelengthNm: number;
  readonly systems: readonly OptilandSystem[];
}>("./fixtures/optiland-crosscheck.json");

const RAYOPTICS = read<{
  readonly wavelengthNm: number;
  readonly systems: readonly RayopticsSystem[];
}>("./fixtures/rayoptics-crosscheck.json");

/**
 * The tolerances are § 0's currency — the last bit of a double at the magnitude
 * compared — for § 0's reason: a bound in millimetres would have to be a
 * different number for a 3 mm objective and a 600 mm telescope and would say
 * nothing about either. The NUMBERS are larger than § 0's, and that is a
 * finding rather than a slackening. See `MAJORITY_ULP_DIR`.
 *
 * Measured worst cases over all sixteen systems (docs/VALIDATION.md § 0.4):
 * against the engine, 4.6 ulp on a hit point, 9 ulp on a direction cosine,
 * 7.0 ulp on a path and 9.3 ulp on a path DIFFERENCE. Every bound below sits
 * about twice its measurement. In physical units the worst disagreement
 * anywhere in this file is 5.7e-13 mm, on the Cassegrain's 660 mm path:
 * 9.7e-10 of a wave.
 *
 * They are roughly twice § 0's for one reason, which applies to all four: § 0
 * compares the engine against a reference, and one of the two sides is then an
 * implementation this repo controls, so part of the rounding path is shared.
 * Half the comparisons here have no shared side at all — see
 * `MAJORITY_ULP_DIR`, where the effect is largest and is stated as its own
 * number — and the same physical claim therefore costs a few more bits.
 */
const ULP_POINT = 16;
const ULP_DIR = 20;
const ULP_OPL = 16;
const ULP_OPD = 20;
const MAX_OPD_WAVES = 1e-8;

/**
 * The direction bound for the one comparison the ENGINE is not in.
 *
 * Everywhere else a rounding path is partly shared: the engine and one
 * reference are being compared, and the quantity is read off one implementation
 * that this repo controls. rayoptics against Optiland shares nothing at all, so
 * six refractions of independently-rounded arithmetic accumulate on both sides
 * independently — measured at 14 ulp on the Lister's steep marginal ray, where
 * the same rung against the engine reads 9. Stating that as its own number is
 * the honest thing; folding it into `ULP_DIR` would quietly loosen the rung that
 * does not need it.
 */
const MAJORITY_ULP_DIR = 32;

/**
 * The asphere's floor, and it is NOT rayoptics' 1e-12 borrowed. Optiland's
 * `NewtonRaphsonGeometry` stops at max |sag(x, y) − z| < tol over the batch,
 * default 1e-10; the generator sets 1e-12, the same PROMISE as the engine's
 * |g| < 1e-12 but a different criterion. Two independent stopping rules cannot
 * agree closer than the looser of them, so that system's points are held here.
 * What was measured is 8.3e-16 mm on Optiland's side — converging some 1200×
 * tighter than it promises, which is the same kind of statement § 0 could make
 * about the other two and is not something either program's own tests say.
 */
const NEWTON_FLOOR_MM = 1e-12;

const ulp = (magnitude: number): number => Number.EPSILON * Math.max(Math.abs(magnitude), 1);

const maxAbs = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

const mediumName = (n: number): string => {
  const name = `XCHECK_${n.toFixed(17)}`;
  registerMedium(constantIndex(name, n));
  return name;
};

function prescriptionOf(system: OptilandSystem): Prescription {
  const surfaces: SurfaceSpec[] = system.surfaces.map(
    (s): SurfaceSpec => ({
      kind: s.reflect ? "reflect" : "refract",
      curvature: s.curvature,
      ...(s.conic !== undefined ? { conic: s.conic } : {}),
      ...(s.asphereCoeffs ? { asphereCoeffs: [...s.asphereCoeffs] } : {}),
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

/** The largest coordinate anywhere in a system's traced rays — its geometric scale. */
const systemScale = (s: OptilandSystem): number =>
  Math.max(...s.expected.flatMap((e) => e.hits.flatMap((h) => h.map(Math.abs))));

const pointTolerance = (s: OptilandSystem): number => {
  const rounding = ULP_POINT * ulp(systemScale(s));
  return s.surfaces.some((x) => x.asphereCoeffs) ? Math.max(rounding, NEWTON_FLOOR_MM) : rounding;
};

const traceFixtureRay = (p: Prescription, r: FixtureRay) =>
  traceRay(p, makeRay(vec3(...r.origin), vec3(...r.dir), OPTILAND.wavelengthNm));

const FOLDED_IDS = ["fold-flat-45", "newtonian-fold", "fold-sphere-15", "fold-compound-tilt"];

describe("§ 0.4 — a second independent tracer, and the majority it makes", () => {
  it("the fixture says which program, which version, and by which call", () => {
    expect(OPTILAND._generator.tool).toBe("optiland");
    expect(OPTILAND._generator.version).toBe("0.6.1");
    expect(OPTILAND._generator.call).toContain("SurfaceGroup.trace");
    // The Newton promise is part of the call: a fixture written at Optiland's
    // own 1e-10 default would agree 100× looser and this file would not notice.
    expect(OPTILAND._generator.call).toContain("tol=1e-12");
    expect(OPTILAND._generator.backend).toContain("float64");
    expect(OPTILAND._generator.inputsFrom).toContain("rayoptics-crosscheck.json");
    expect(OPTILAND.systems.length).toBe(16);
  });

  /**
   * The rung the whole third comparison rests on. rayoptics and Optiland are
   * only a majority if they were asked one question, and "the generator read
   * the other fixture" is a claim in a comment until something checks it. This
   * checks it: every input field, deep-equal, system by system and in order.
   */
  it("the two fixtures pose the same question, field for field", () => {
    expect(OPTILAND.wavelengthNm).toBe(RAYOPTICS.wavelengthNm);
    expect(OPTILAND.systems.length).toBe(RAYOPTICS.systems.length);
    expect(OPTILAND.systems.map((s) => s.id)).toEqual(RAYOPTICS.systems.map((s) => s.id));
    for (let i = 0; i < OPTILAND.systems.length; i++) {
      const a = OPTILAND.systems[i]!;
      const b = RAYOPTICS.systems[i]!;
      expect(a.objectIndex).toBe(b.objectIndex);
      expect(a.surfaces).toEqual(b.surfaces);
      expect(a.rays).toEqual(b.rays);
    }
  });

  it("the four folded systems are the four placed absolutely, and no others", () => {
    const absolute = OPTILAND.systems.filter((s) => s.placement === "absolute").map((s) => s.id);
    expect(absolute).toEqual(FOLDED_IDS);
    for (const s of OPTILAND.systems) {
      expect(s.placement === "chain").toBe(s.frames !== undefined);
      expect(s.placement === "absolute").toBe(s.mirrorFrames === "folded");
    }
  });

  for (const system of OPTILAND.systems) {
    describe(system.id, () => {
      const prescription = prescriptionOf(system);
      const traced = system.rays.map((r) => traceFixtureRay(prescription, r));

      /**
       * Where Optiland composed the chain itself, the two programs put every
       * surface in the same place — and on the eight misaligned systems that is
       * the whole reconciliation, with no Euler solve anywhere in it. A rotation
       * entry is a direction cosine, so it is held to the direction bound.
       *
       * Not asserted on the folded four: the fixture carries no frames for them,
       * on purpose. See the header.
       */
      if (system.frames) {
        it("every surface's compiled frame is the one Optiland composed", () => {
          const compiled = compile(prescription);
          expect(system.frames!.length).toBe(system.surfaces.length);
          for (let i = 0; i < system.frames!.length; i++) {
            const frame = compiled.surfaces[i]!.frame;
            expect(maxAbs([...frame.rotation], system.frames![i]!.rotation)).toBeLessThan(
              ULP_DIR * ulp(1),
            );
            const v = frame.translation;
            expect(maxAbs([v.x, v.y, v.z], system.frames![i]!.vertex)).toBeLessThan(
              pointTolerance(system),
            );
          }
        });
      }

      it("every fixture ray traces, and reaches every surface", () => {
        expect(system.rays.length).toBe(system.expected.length);
        for (let i = 0; i < traced.length; i++) {
          expect(traced[i]!.status).toBe("ok");
          expect(traced[i]!.path.length).toBe(system.expected[i]!.hits.length - 1);
        }
      });

      it("the hit point on every surface agrees", () => {
        const tolerance = pointTolerance(system);
        for (let i = 0; i < traced.length; i++) {
          const hits = system.expected[i]!.hits;
          const path = traced[i]!.path;
          for (let s = 0; s < path.length; s++) {
            const p = path[s]!;
            expect(maxAbs([p.x, p.y, p.z], hits[s + 1]!)).toBeLessThan(tolerance);
          }
        }
      });

      /**
       * The direction leaving EVERY surface, not only the last: an error two
       * surfaces cancel between them is invisible in the exit direction alone.
       * `traceRay` reports hit points and a final ray, so intermediate
       * directions are recovered from consecutive hits — two points good to
       * `pointTolerance` fix a direction to that over their separation, which is
       * why a 6 mm glass segment earns a looser bound than an 800 mm tube.
       */
      it("the direction leaving every surface agrees, not only the last", () => {
        const floor = ULP_DIR * ulp(1);
        const spread = pointTolerance(system);
        for (let i = 0; i < traced.length; i++) {
          const segDirs = system.expected[i]!.segDirs;
          const path = traced[i]!.path;
          expect(segDirs.length).toBe(path.length);
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
       * The quantity the wave layer is built on. An absolute path carries the
       * launch plane's offset, which a shared convention could hide; a wavefront
       * carries only differences.
       */
      it("optical path DIFFERENCES across the pupil agree, in waves as well as in ulp", () => {
        const base = traced[0]!.opl;
        const baseExpected = system.expected[0]!.opl;
        for (let i = 1; i < traced.length; i++) {
          const delta = Math.abs(traced[i]!.opl - base - (system.expected[i]!.opl - baseExpected));
          expect(delta).toBeLessThan(ULP_OPD * ulp(baseExpected));
          expect(delta / (OPTILAND.wavelengthNm * 1e-6)).toBeLessThan(MAX_OPD_WAVES);
        }
      });
    });
  }

  /**
   * THE MAJORITY, and it is the reason this file exists rather than a second
   * copy of § 0. Everything above compares the engine to Optiland; § 0 compares
   * the engine to rayoptics. Neither can see a convention the engine SHARES with
   * one of them — an agreement built on a common definition rather than on
   * arithmetic looks exactly like an agreement about arithmetic from inside
   * either comparison.
   *
   * This one takes the engine out. Two programs that have never heard of each
   * other, handed the same sixteen systems and the same rays by the rung above,
   * traced by their own intersection, their own Snell and their own path
   * accumulation. Where they agree, the engine agreeing with both is a majority;
   * where they disagreed, § 0's agreement would have been the thing to explain.
   */
  describe("rayoptics against Optiland, with the engine out of it", () => {
    for (let k = 0; k < OPTILAND.systems.length; k++) {
      const mine = OPTILAND.systems[k]!;
      const theirs = RAYOPTICS.systems[k]!;

      it(`${mine.id}: the two references agree surface by surface`, () => {
        const tolerance = pointTolerance(mine);
        const dirFloor = MAJORITY_ULP_DIR * ulp(1);
        for (let i = 0; i < mine.expected.length; i++) {
          const a = mine.expected[i]!;
          const b = theirs.expected[i]!;
          expect(a.hits.length).toBe(b.hits.length);
          for (let s = 0; s < a.hits.length; s++) {
            expect(maxAbs(a.hits[s]!, b.hits[s]!)).toBeLessThan(tolerance);
          }
          for (let s = 0; s < a.segDirs.length; s++) {
            expect(maxAbs(a.segDirs[s]!, b.segDirs[s]!)).toBeLessThan(dirFloor);
          }
          expect(Math.abs(a.opl - b.opl)).toBeLessThan(ULP_OPL * ulp(b.opl));
        }
      });

      it(`${mine.id}: and about the wavefront, which is what OPD is`, () => {
        const baseA = mine.expected[0]!.opl;
        const baseB = theirs.expected[0]!.opl;
        for (let i = 1; i < mine.expected.length; i++) {
          const delta = Math.abs(mine.expected[i]!.opl - baseA - (theirs.expected[i]!.opl - baseB));
          expect(delta).toBeLessThan(ULP_OPD * ulp(baseB));
          expect(delta / (OPTILAND.wavelengthNm * 1e-6)).toBeLessThan(MAX_OPD_WAVES);
        }
      });
    }
  });

  /**
   * A cross-check that cannot fail proves nothing. Six of the seven below damage
   * exactly one input and require the comparison to notice AT the tolerances
   * above; the seventh is the positive control the other six need, because a
   * comparison that only ever reports disagreement has not been shown to be able
   * to report agreement.
   *
   * "At the tolerances above" is not a formality here: the weakest of the six is
   * the 1e-7 index error, and it misses by 5.8e5 times the bound. The others run
   * from 5.6e6 to 6.9e12. None of them is close enough to the tolerance for a
   * later adjustment of it to quietly turn a control into a coincidence.
   */
  describe("the comparison can fail", () => {
    const system = (id: string) => OPTILAND.systems.find((s) => s.id === id)!;

    /** The worst |Δ| over a system's last hit points when the prescription is damaged. */
    const worstAgainstFixture = (s: OptilandSystem, rx: Prescription): number =>
      Math.max(
        ...s.rays.map((r, i) => {
          const res = traceFixtureRay(rx, r);
          const p = res.path[res.path.length - 1]!;
          const e = s.expected[i]!.hits[s.expected[i]!.hits.length - 1]!;
          return maxAbs([p.x, p.y, p.z], e);
        }),
      );

    it("a 1 nm shift of the launch height moves the exit ray past every tolerance", () => {
      const s = system("achromat-60mm-f8");
      const r = s.rays[4]!; // a pupil height where spherical aberration is real
      const moved = traceRay(
        prescriptionOf(s),
        makeRay(
          vec3(r.origin[0], r.origin[1] + 1e-6, r.origin[2]),
          vec3(...r.dir),
          OPTILAND.wavelengthNm,
        ),
      );
      const p = moved.path[moved.path.length - 1]!;
      expect(maxAbs([p.x, p.y, p.z], s.expected[4]!.point)).toBeGreaterThan(pointTolerance(s));
    });

    it("a 1e-7 error in one index fails, so the media are not decorative", () => {
      const s = system("achromat-60mm-f8");
      const rx = prescriptionOf(s);
      const damaged: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x, i) =>
          i === 0 ? { ...x, medium: mediumName(s.surfaces[0]!.indexAfter! + 1e-7) } : x,
        ),
      };
      expect(worstAgainstFixture(s, damaged)).toBeGreaterThan(pointTolerance(s));
    });

    /**
     * The tilt controls, and they carry more weight here than in § 0. There the
     * angles were translated through a solved Euler triple, so a sign or an
     * order error would have shown up in the translation. Here the fixture hands
     * Optiland `tiltXDeg` and `tiltYDeg` unchanged — which is the finding — and
     * the only thing standing between "the two agree" and "the two both ignored
     * it" is that damaging the angle has to be visible.
     */
    it("flipping the sign of a tilt fails, so the shared spelling is measured", () => {
      const s = system("tilt-y");
      const rx = prescriptionOf(s);
      const flipped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltYDeg === undefined ? x : { ...x, tiltYDeg: -x.tiltYDeg },
        ),
      };
      expect(worstAgainstFixture(s, flipped)).toBeGreaterThan(pointTolerance(s));
    });

    it("swapping the two tilt angles fails, so Ry·Rx is pinned and not Rx·Ry", () => {
      const s = system("tilt-xy");
      const rx = prescriptionOf(s);
      const swapped: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined || x.tiltYDeg === undefined
            ? x
            : { ...x, tiltXDeg: x.tiltYDeg, tiltYDeg: x.tiltXDeg },
        ),
      };
      expect(worstAgainstFixture(s, swapped)).toBeGreaterThan(pointTolerance(s));
    });

    /**
     * The folded four are placed absolutely by the generator, so their rung is
     * the beam and not a frame — which is only worth something if a wrong
     * placement is visible in the beam. Rotating the diagonal by a tenth of a
     * degree is a placement error small enough to be plausible and it has to
     * fail.
     */
    it("a tenth of a degree on a fold mirror fails, so the beam rung has teeth", () => {
      const s = system("newtonian-fold");
      const rx = prescriptionOf(s);
      const nudged: Prescription = {
        ...rx,
        surfaces: rx.surfaces.map((x) =>
          x.tiltXDeg === undefined ? x : { ...x, tiltXDeg: x.tiltXDeg + 0.1 },
        ),
      };
      expect(worstAgainstFixture(s, nudged)).toBeGreaterThan(pointTolerance(s));
    });

    /**
     * And the control the majority rung needs specifically: it compares two
     * fixtures rather than a fixture and a trace, so it would pass on two files
     * that had been generated from each other. Cross one system's rayoptics
     * answer against a DIFFERENT system's Optiland answer and the comparison has
     * to blow up — if it does not, the fixtures are not carrying independent
     * arithmetic.
     */
    it("crossing two systems' answers fails, so the majority is not comparing a file to itself", () => {
      const mine = OPTILAND.systems[4]!; // decenter-x
      const theirs = RAYOPTICS.systems[5]!; // decenter-y — same shape, one number apart
      expect(mine.id).not.toBe(theirs.id);
      const worst = Math.max(
        ...mine.expected.map((e, i) => maxAbs(e.point, theirs.expected[i]!.point)),
      );
      expect(worst).toBeGreaterThan(pointTolerance(mine));
    });

    /**
     * THE POSITIVE CONTROL. Six assertions that a damaged input disagrees cannot
     * say the comparison works — only that it is not blind. This one asserts the
     * other side: read through the same helper, undamaged, the three programs
     * agree, and the number is stated rather than implied.
     */
    it("and undamaged, the three agree — the worst residual over all sixteen systems", () => {
      let worstEngine = 0;
      let worstMajority = 0;
      for (let k = 0; k < OPTILAND.systems.length; k++) {
        const s = OPTILAND.systems[k]!;
        const theirs = RAYOPTICS.systems[k]!;
        const scale = ulp(systemScale(s));
        const rx = prescriptionOf(s);
        for (let i = 0; i < s.rays.length; i++) {
          const res = traceFixtureRay(rx, s.rays[i]!);
          const p = res.path[res.path.length - 1]!;
          worstEngine = Math.max(worstEngine, maxAbs([p.x, p.y, p.z], s.expected[i]!.point) / scale);
          worstMajority = Math.max(
            worstMajority,
            maxAbs(s.expected[i]!.point, theirs.expected[i]!.point) / scale,
          );
        }
      }
      // In ulp of each system's own geometric scale — the currency the
      // tolerances above are written in, and both are a long way inside them.
      expect(worstEngine).toBeLessThan(ULP_POINT);
      expect(worstMajority).toBeLessThan(ULP_POINT);
      expect(worstEngine).toBeGreaterThan(0);
      expect(worstMajority).toBeGreaterThan(0);
    });
  });
});
