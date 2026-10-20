import { describe, it, expect } from "vitest";
import { achromaticObjective } from "../src/designs/achromat";
import { opdMap, type OpdMap } from "../src/pupil/opd";
import { pupilGrid, chiefRay, aimRay, UnreachableStopPoint } from "../src/pupil/aiming";
import { pupils } from "../src/pupil/pupils";
import { traceRay } from "../src/trace/sequential";
import { compile } from "../src/trace/compile";
import { applyToPoint } from "../src/math/transform";
import { simpleSystem, type OpticalSystem, type RayAiming } from "../src/trace/system";
import { fitZernike, balancedRms } from "../src/wave/zernike";
import type { Prescription, SurfaceSpec } from "../src/trace/prescription";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { listerObjective } from "../src/designs/lister";
import { oilImmersionObjective } from "../src/designs/immersion";
import { objectNumericalAperture } from "../src/pupil/microscope";
import { visualMicroscope } from "../src/designs/visual-microscope";
import { plosslEyepiece } from "../src/designs/eyepiece";

/**
 * § 1.5.3 — REAL RAY AIMING: the stop a misalignment moved.
 *
 * § 1.5 aims every pupil coordinate at the first-order entrance pupil, and
 * `pupils()` computes that on the straight-axis twin — which drops tilt and
 * decenter by design (`trace/axis`'s SCOPE note). On an aligned system the two
 * agree, because the pupil really is on the axis. On a misaligned one they do
 * not, and the reason is structural rather than approximate: in the local
 * coordinate chain a perturbation on surface i carries every surface after it,
 * **the stop included**, so the stop moves and the paraxial aim does not follow.
 *
 * WHY IT IS WORTH AN ENGINE STEP, and it is not the millimetre. A pupil sampled
 * off-centre puts a field-constant coma-like term on the wavefront — which is
 * exactly what a misalignment itself produces. The error and the signal have the
 * same shape, so no readout downstream can separate them. The measurement that
 * says so is here: a RIGID TURN of the whole instrument introduces no new
 * asymmetry at all, by construction, and the engine reported one.
 *
 * THE TWO IDENTITIES this step is pinned to are exact statements about optical
 * systems rather than about this engine, which is what makes them usable as
 * external numbers:
 *
 *  - **A rigid translation is the same instrument.** Decentering surface 0 by d
 *    moves every surface by d — the chain carries it — so that system IS the
 *    aligned one, moved. Its wavefront must be identical.
 *  - **A rigid rotation is the same instrument at a shifted field.** Tilting
 *    surface 0 by β about y turns the whole chain about y, and `fieldDirection`
 *    is (sin t, 0, cos t) in that same plane, so the turned system at field φ is
 *    the aligned system at field φ − β. Exactly, not to first order.
 *
 * WHAT THE SECOND ONE FOUND, and it is the finding this step did not go looking
 * for. Real aiming makes the translation identity exact and leaves the rotation
 * identity's raw RMS as wrong as it was — because that residual was never on the
 * entrance side. `opdMap` quotes the wavefront about the image point of the
 * NOMINAL image plane, so a turned instrument's wavefront is re-quoted about a
 * point that has moved, which is piston, tilt and defocus and **nothing else**:
 * removing those three drops the residual by a factor of ~1700, to 4.6e-5 waves.
 * So the invariant quantity is the BALANCED wavefront — § 5t's `sigmaWaves`
 * currency, and what Strehl and Maréchal are built on — and `OpdMap.rmsWaves`,
 * which removes piston alone, is not a currency a misaligned system may be
 * measured in. That is a scope statement about the exit side, measured rather
 * than assumed, and it is why this step does not touch the exit side.
 */

const WVL = 587.5618;
const GRID = pupilGrid(33);

const BASE: Prescription = achromaticObjective({ apertureMm: 60, focalRatio: 8 }).prescription;

/** The same doublet with its stop on the LAST surface, so aiming has to be
 *  traced through the glass to reach it — the stop-at-surface-0 default is the
 *  one arrangement in which a tilt cannot move the stop at all. */
const REAR_STOP: Prescription = {
  ...BASE,
  surfaces: BASE.surfaces.map((s, i) => ({ ...s, isStop: i === BASE.surfaces.length - 1 })),
};

const system = (p: Prescription, aim: RayAiming): OpticalSystem => ({
  ...simpleSystem(p, { kind: "EPD", value: 60 }, WVL),
  rayAiming: aim,
});

const perturb = (p: Prescription, i: number, o: Partial<SurfaceSpec>): Prescription => ({
  ...p,
  surfaces: p.surfaces.map((s, k) => (k === i ? { ...s, ...o } : s)),
});

/** Transverse distance from the stop's own centre to where a ray crossed it. */
function missAtStop(p: Prescription, aim: RayAiming, fieldDeg: number, px = 0, py = 0): number {
  const sys = system(p, aim);
  const pupil = pupils(sys, WVL);
  const ray = aimRay(sys, pupil, fieldDeg, { px, py }, WVL);
  const traced = traceRay(p, ray);
  const hit = traced.path[pupil.stopIndex];
  if (!hit) throw new Error(`ray never reached the stop (${traced.status})`);
  const local = applyToPoint(compile(p).surfaces[pupil.stopIndex]!.inverseFrame, hit);
  return Math.hypot(local.x, local.y);
}

/** The currency this step concludes a misaligned system must be measured in. */
const balancedWaves = (map: OpdMap): number => balancedRms(fitZernike(map.samples, 15));

const wavefront = (p: Prescription, aim: RayAiming, fieldDeg: number): OpdMap =>
  opdMap(system(p, aim), fieldDeg, WVL, GRID);

describe("§ 1.5.3 — real ray aiming", () => {
  describe("the stop is where the misalignment put it, and paraxial aiming does not follow", () => {
    /**
     * The defect, stated as a number before anything is fixed. A decenter of
     * 0.5 mm on surface 0 moves the stop 0.5 mm, and the paraxial aim keeps
     * pointing at the old place — so the miss IS the decenter, minus the small
     * amount surface 0 bends the chief ray back on its way through.
     */
    it("paraxial aiming misses a moved stop by very nearly the whole displacement", () => {
      const moved = perturb(REAR_STOP, 0, { decenterY: 0.5 });
      const miss = missAtStop(moved, "paraxial", 0.3);
      expect(miss).toBeGreaterThan(0.4);
      expect(miss).toBeLessThan(0.5);
      // and it is not a field effect: the stop moved by a constant, so the miss
      // is the same at every field, which no aberration would be
      expect(Math.abs(missAtStop(moved, "paraxial", -0.3) - miss)).toBeLessThan(1e-9);
    });

    /**
     * The solver targets 1e-12 of a stop radius — 3e-11 mm here — which is where
     * a coordinate carried through a whole trace stops being meaningful in a
     * double. The bound below is that, with room, and NOT a round number chosen
     * to pass: a rim ray converges to 2.2e-11 mm on this system.
     */
    it("real aiming lands on the moved stop, at the centre and across the pupil", () => {
      const moved = perturb(REAR_STOP, 0, { decenterY: 0.5, tiltXDeg: 0.4 });
      const stopRadius = pupils(system(moved, "real"), WVL).stopRadius;
      for (const fieldDeg of [0, 0.3, -0.45]) {
        expect(missAtStop(moved, "real", fieldDeg)).toBeLessThan(1e-10);
        for (const [px, py] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0.6, -0.6],
        ] as const) {
          const want = Math.hypot(px, py) * stopRadius;
          const got = missAtStop(moved, "real", fieldDeg, px, py);
          expect(Math.abs(got - want)).toBeLessThan(1e-10);
        }
      }
    });

    /**
     * NOT inert on an aligned system, and this is the rung that says by how
     * much — because "it only matters when something is misaligned" was the
     * assumption, and it is wrong in two separate ways that are worth having
     * measured. Neither is a defect in either aiming mode; they are what the
     * two modes MEAN, and together they are why this is opt-in per system
     * rather than switched on for everything.
     *
     *  1. **A pupil plane is not a stop surface.** Paraxial aiming puts the ray
     *     through a point on the entrance-pupil PLANE; real aiming puts it
     *     through a point on the stop SURFACE, which is curved. On axis the two
     *     coincide bitwise, because an on-axis bundle runs parallel to z and
     *     crosses plane and sphere at the same height. Off axis the ray is
     *     tilted, so the sag displaces it — 2.0 mm of sag at the rim of this
     *     doublet times tan(0.3°) is 1.0e-2 mm of pupil, and 2.3e-5 waves.
     *  2. **A remote stop has pupil aberration.** Move the stop to the last
     *     surface and the entrance pupil becomes its IMAGE through the glass,
     *     which the first-order layer places to first order only. The two modes
     *     then sample measurably different bundles even with nothing
     *     misaligned: 1.6e-3 waves at 0.3° of field.
     */
    it("on an ALIGNED system the two modes still differ, and the two reasons are separable", () => {
      // (1) the stop IS the first surface: nothing to image, so any difference
      // is the plane-against-surface one alone
      const onAxis = [
        wavefront(BASE, "paraxial", 0).rmsWaves,
        wavefront(BASE, "real", 0).rmsWaves,
      ];
      expect(onAxis[0]).toBe(onAxis[1]); // bitwise, and that is the claim

      const offAxis = Math.abs(
        wavefront(BASE, "paraxial", 0.3).rmsWaves - wavefront(BASE, "real", 0.3).rmsWaves,
      );
      expect(offAxis).toBeGreaterThan(1e-5);
      expect(offAxis).toBeLessThan(1e-4);

      // (2) a remote stop adds pupil aberration on top, an order of magnitude up
      const remote = Math.abs(
        wavefront(REAR_STOP, "paraxial", 0.3).rmsWaves -
          wavefront(REAR_STOP, "real", 0.3).rmsWaves,
      );
      expect(remote).toBeGreaterThan(10 * offAxis);

      // and the chief ray was never the thing that differed: paraxial already
      // lands sub-micron on a remote stop when the system is aligned
      expect(missAtStop(REAR_STOP, "paraxial", 0.3)).toBeLessThan(1e-6);
      expect(missAtStop(REAR_STOP, "real", 0.3)).toBeLessThan(1e-10);
    });
  });

  describe("a rigid translation is the same instrument", () => {
    it("decentering surface 0 moves every surface by the same amount", () => {
      const d = 0.5;
      const moved = compile(perturb(BASE, 0, { decenterY: d }));
      const still = compile(BASE);
      for (let i = 0; i < still.surfaces.length; i++) {
        const a = still.surfaces[i]!.frame.translation;
        const b = moved.surfaces[i]!.frame.translation;
        expect(Math.abs(b.y - a.y - d)).toBeLessThan(1e-15);
        expect(Math.abs(b.x - a.x)).toBeLessThan(1e-15);
        expect(Math.abs(b.z - a.z)).toBeLessThan(1e-15);
      }
    });

    it("and under real aiming its wavefront is the aligned one, to 1e-11 waves", () => {
      for (const d of [0.05, 0.5]) {
        for (const fieldDeg of [0, 0.3]) {
          const a = wavefront(BASE, "real", fieldDeg).rmsWaves;
          const b = wavefront(perturb(BASE, 0, { decenterY: d }), "real", fieldDeg).rmsWaves;
          expect(Math.abs(a - b)).toBeLessThan(1e-11);
        }
      }
    });

    /**
     * NEGATIVE CONTROL, and the size of the defect. Paraxial aiming reports the
     * moved instrument as a DIFFERENT instrument — 1.5e-4 waves different at
     * 0.5 mm — which is the identity failing, not the optics changing.
     */
    it("under paraxial aiming it is not, and the gap grows with the displacement", () => {
      const gap = (d: number) =>
        Math.abs(
          wavefront(BASE, "paraxial", 0.3).rmsWaves -
            wavefront(perturb(BASE, 0, { decenterY: d }), "paraxial", 0.3).rmsWaves,
        );
      const small = gap(0.05);
      const large = gap(0.5);
      expect(small).toBeGreaterThan(1e-7);
      expect(large).toBeGreaterThan(1e-4);
      expect(large / small).toBeGreaterThan(50);
    });
  });

  describe("a rigid rotation is the same instrument at a shifted field", () => {
    const BETA = 0.2;
    const turned = perturb(BASE, 0, { tiltYDeg: BETA });

    it("the shift is φ − β, and the other sign is nowhere near", () => {
      const t = wavefront(turned, "real", 0.3).rmsWaves;
      const minus = wavefront(BASE, "real", 0.3 - BETA).rmsWaves;
      const plus = wavefront(BASE, "real", 0.3 + BETA).rmsWaves;
      expect(Math.abs(t - minus)).toBeLessThan(1e-2);
      expect(Math.abs(t - plus)).toBeGreaterThan(1e-1);
    });

    /**
     * The finding. The raw RMS is NOT invariant and real aiming does not make it
     * so, because that residual is on the exit side: the wavefront is quoted
     * about the nominal image plane's chief-ray point, and a turned instrument's
     * has moved. Everything that costs is piston, tilt and defocus — remove
     * those three and the identity holds to 1e-4 waves, a factor of ~1700.
     */
    it("the raw RMS is not the invariant; the BALANCED wavefront is", () => {
      for (const fieldDeg of [0.3, -0.3]) {
        const t = wavefront(turned, "real", fieldDeg);
        const a = wavefront(BASE, "real", fieldDeg - BETA);
        expect(t.samples.length).toBe(a.samples.length);

        const raw = Math.sqrt(
          t.samples.reduce((acc, s, i) => acc + (s.waves - a.samples[i]!.waves) ** 2, 0) /
            t.samples.length,
        );
        const balanced = Math.abs(balancedWaves(t) - balancedWaves(a));

        expect(raw).toBeGreaterThan(1e-3);
        expect(balanced).toBeLessThan(1e-4);
        expect(raw / Math.max(balanced, 1e-12)).toBeGreaterThan(100);
      }
    });
  });

  /**
   * WHAT ACTUALLY REMOVES THE ARTIFACT, and it corrects the premise this step
   * was begun on.
   *
   * A rigid turn introduces NO asymmetry across the field — it is the same
   * instrument, pointed differently — so any asymmetry the engine reports for
   * one is entirely its own. Measuring that against a genuine one-surface tilt
   * of the same size gives the artifact-to-signal ratio directly, and the answer
   * depends far more on the CURRENCY than on the aiming:
   *
   * | currency        | aiming    | artifact | signal  | ratio |
   * |-----------------|-----------|----------|---------|-------|
   * | raw RMS         | paraxial  | 9.4e-4   | 3.7e-2  | 39    |
   * | raw RMS         | real      | 9.3e-4   | 3.7e-2  | 40    |
   * | balanced        | paraxial  | 2.9e-6   | 5.8e-3  | 2021  |
   * | balanced        | real      | 1.7e-6   | 5.8e-3  | 3497  |
   *
   * So the raw RMS is where the artifact lived, and real aiming barely touches
   * it — because that residual is the exit-side quoting frame, not the entrance
   * side. Choosing the balanced currency removes ~320× of it; real aiming then
   * removes a further 1.7×. **The step's value is not here.** It is the exact
   * translation identity above, and pupil coordinates that mean what they say on
   * a misaligned system — a 0.5 mm miss becoming 1e-11. This table is recorded
   * because the opposite was assumed at the outset, and a step that quietly
   * kept a wrong reason would be worse than one that states the right one.
   */
  describe("the artifact, and which change actually removes it", () => {
    const BETA = 0.2;
    const asymmetry = (p: Prescription, aim: RayAiming, currency: (m: OpdMap) => number): number =>
      Math.abs(currency(wavefront(p, aim, 0.4)) - currency(wavefront(p, aim, -0.4)));

    const turned = perturb(BASE, 0, { tiltYDeg: BETA });
    const genuine = perturb(BASE, 1, { tiltYDeg: BETA });

    /** The turned instrument's axis is at β, so the honest reference for its
     *  ±0.4° asymmetry is the aligned system's about β ± 0.4°. */
    const artifactOf = (aim: RayAiming, currency: (m: OpdMap) => number): number =>
      Math.abs(
        asymmetry(turned, aim, currency) -
          Math.abs(currency(wavefront(BASE, aim, BETA + 0.4)) - currency(wavefront(BASE, aim, BETA - 0.4))),
      );

    const raw = (m: OpdMap) => m.rmsWaves;

    it("the balanced currency removes two orders of magnitude more than the aiming does", () => {
      const byCurrency = artifactOf("paraxial", raw) / artifactOf("paraxial", balancedWaves);
      const byAiming = artifactOf("paraxial", balancedWaves) / artifactOf("real", balancedWaves);
      expect(byCurrency).toBeGreaterThan(100);
      expect(byAiming).toBeGreaterThan(1.2);
      expect(byAiming).toBeLessThan(byCurrency / 50);
    });

    it("and in the balanced currency the signal outruns the artifact by more than 1000×", () => {
      const signal = asymmetry(genuine, "real", balancedWaves);
      expect(signal).toBeGreaterThan(4e-3);
      expect(signal / artifactOf("real", balancedWaves)).toBeGreaterThan(1000);
    });

    it("in the RAW currency it does not, which is why that currency is refused here", () => {
      const signal = asymmetry(genuine, "real", raw);
      expect(signal / artifactOf("real", raw)).toBeLessThan(100);
    });
  });

  describe("refusals", () => {
    /**
     * An object at infinity behind a pupil at infinity has no object point to
     * solve a slope from (§ 2z.1 solves one at a finite conjugate). Refused,
     * because a silent fall back to paraxial would hand the caller a
     * differently-defined ray under the name it asked for.
     */
    it("real aiming with the object and the entrance pupil both at infinity throws rather than falling back", () => {
      const pupil = pupils(system(BASE, "real"), WVL);
      const telecentric = { ...pupil, entrance: { ...pupil.entrance, radius: Infinity } };
      expect(() =>
        aimRay(system(BASE, "real"), telecentric, 0, { px: 0, py: 0 }, WVL),
      ).toThrow(/entrance pupil at infinity/);
    });
  });
});

/**
 * § 2z.1 — real aiming at a pupil at infinity, solved over the slope.
 *
 * Every telecentric objective in the catalogue has its entrance pupil exactly at
 * infinity at its design wavelength (`pupils` returns a slope aperture there),
 * so § 1.5.3's real aiming, which solves for a target on the entrance-pupil
 * plane, refused all of them where they are used most. The point on the stop a
 * coordinate names does not care where the pupil is; only the unknown the solve
 * moves does — a slope from the object point instead of a target on a plane.
 */
describe("§ 2z.1 — real aiming at a pupil at infinity", () => {
  const DIN = finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  }).system;
  const D_LINE = DIN.wavelengths[0]!.nm;

  /** Where a ray crosses the stop, in the stop's own frame — with every rim
   *  removed, since where a ray lands is not whether a lens edge passes it. */
  const atStop = (sys: OpticalSystem, ray: ReturnType<typeof aimRay>, k: number) => {
    const c = compile({
      ...sys.prescription,
      surfaces: sys.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    const hit = traceRay(c, ray).path[k];
    if (!hit) throw new Error("ray never reached the stop");
    return applyToPoint(c.surfaces[k]!.inverseFrame, hit);
  };

  it("the DIN 4×'s entrance pupil is at infinity at its design wavelength, and real aiming lands on the stop", () => {
    const real = { ...DIN, rayAiming: "real" as const };
    const pupil = pupils(real, D_LINE);
    expect(pupil.entrance.radius).toBe(Infinity);
    expect(pupil.entrance.slopeRadius).toBeGreaterThan(0);
    // § 1.5.3's bound: the solve targets 1e-12 of the scale, max(stop radius, 1 mm).
    for (const h of [0, 0.4, -0.6]) {
      for (const [px, py] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0.6, -0.6],
        [0, 0],
      ] as const) {
        const local = atStop(real, aimRay(real, pupil, h, { px, py }, D_LINE), pupil.stopIndex);
        expect(Math.abs(local.x - px * pupil.stopRadius), `${h} ${px} ${py}`).toBeLessThan(1e-10);
        expect(Math.abs(local.y - py * pupil.stopRadius), `${h} ${px} ${py}`).toBeLessThan(1e-10);
      }
    }
  });

  it("the paraxial slope aim misses the stop's rim there by 0.59% — the item-31 shortfall", () => {
    const parax = { ...DIN, rayAiming: "paraxial" as const };
    const pupil = pupils(parax, D_LINE);
    const local = atStop(parax, aimRay(parax, pupil, 0, { px: 1, py: 0 }, D_LINE), pupil.stopIndex);
    // The paraxial cone's rim lands inside the stop's real edge, and real aiming
    // opens it by the ratio the probe read (1.00590 in sine).
    expect(local.x / pupil.stopRadius).toBeLessThan(0.996);
    expect(local.x / pupil.stopRadius).toBeGreaterThan(0.99);
  });

  it("a stop point no ray reaches is refused by name, and a bundle counts it lost", () => {
    // At 1.1 mm the DIN 4×'s +x rim is past what the doublet can carry at all:
    // the ray toward it leaves the back surface's sphere (§ 2y's "miss@2" arc).
    const real = { ...DIN, rayAiming: "real" as const };
    const pupil = pupils(real, D_LINE);
    expect(() => aimRay(real, pupil, 1.1, { px: 1, py: 0 }, D_LINE)).toThrow(UnreachableStopPoint);

    // And it is unreachable, not unconverged: bisect the reach along +x, and the
    // last ray that exists crosses the crown element where its two spheres meet —
    // the glass between surfaces 1 and 2 goes to nothing there, the lens's knife
    // edge, and past it a ray out of surface 1 has no surface 2 ahead of it.
    const reaches = (rho: number) => {
      try {
        aimRay(real, pupil, 1.1, { px: rho, py: 0 }, D_LINE);
        return true;
      } catch (e) {
        if (e instanceof UnreachableStopPoint) return false;
        throw e;
      }
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) lo = mid;
      else hi = mid;
    }
    const c = compile({
      ...DIN.prescription,
      surfaces: DIN.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    const glass = (rho: number) => {
      const path = traceRay(c, aimRay(real, pupil, 1.1, { px: rho, py: 0 }, D_LINE)).path;
      const [a, b] = [path[1]!, path[2]!];
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    expect(lo).toBeGreaterThan(0.5);
    expect(lo).toBeLessThan(1);
    // 1.00005e-9 mm read: the tracer's own EPS_T, the shortest step it calls an
    // intersection (geometry/surfaces) — its knife edge, under either aim.
    expect(glass(lo)).toBeLessThan(1.001e-9);
    expect(glass(0.9 * lo)).toBeGreaterThan(0.1);

    // A bundle across it traces the rest and counts the unreachable points lost.
    const map = opdMap(real, 1.1, D_LINE, pupilGrid(17));
    expect(map.lost).toBeGreaterThan(0);
    expect(map.samples.length).toBeGreaterThan(100);
  });

  it("the slope solve and the plane solve land the same ray where both exist", () => {
    // At 550 nm the DIN 4×'s pupil is finite (6.6e4 mm away) and § 1.5.3's plane
    // solve runs. Hand the same system a pupil at infinity instead — the slope
    // branch — and the answer must not move: what is solved for is the stop
    // point, and the parameterization of the unknown is not in it.
    const real = { ...DIN, rayAiming: "real" as const };
    const finite = pupils(real, 550);
    expect(Number.isFinite(finite.entrance.radius)).toBe(true);
    if (DIN.conjugate.kind !== "finite") throw new Error("the DIN preset is finite-conjugate");
    const slope = finite.entrance.radius / Math.abs(finite.entrance.z + DIN.conjugate.distance);
    const atInfinity = {
      ...finite,
      entrance: { ...finite.entrance, z: -Infinity, radius: Infinity, slopeRadius: slope },
    };
    for (const h of [0, 0.4]) {
      for (const [px, py] of [
        [1, 0],
        [0, -1],
        [0.5, 0.7],
      ] as const) {
        const a = aimRay(real, finite, h, { px, py }, 550).dir;
        const b = aimRay(real, atInfinity, h, { px, py }, 550).dir;
        const la = Math.hypot(a.x, a.y, a.z);
        const lb = Math.hypot(b.x, b.y, b.z);
        expect(Math.abs(a.x / la - b.x / lb)).toBeLessThan(1e-12);
        expect(Math.abs(a.y / la - b.y / lb)).toBeLessThan(1e-12);
      }
    }
  });
});

/**
 * § 2z.4 — real aiming solves through the continuation.
 *
 * Past a lens's knife edge — where its two spheres meet — a ray out of the first
 * has its second's root behind it, and no ray exists. The solve that stopped at
 * that hole put the edge wherever its iteration stalled, which no outline could
 * converge on (§ 2y's arcs refused at 129 nodes). Through the continuation (each
 * sphere's vertex-branch root wherever it falls) the map from launch to stop runs
 * on smoothly, and "reachable" is a property of the solved ray: every crossing
 * ahead of it. The edge is then a sign change of t, located like any root.
 */
describe("§ 2z.4 — real aiming solves through the continuation", () => {
  const DIN: OpticalSystem = {
    ...finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system,
    rayAiming: "real",
  };
  const D_LINE = DIN.wavelengths[0]!.nm;
  const pupil = pupils(DIN, D_LINE);
  const bare = compile({
    ...DIN.prescription,
    surfaces: DIN.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
  });

  it("the refusal names the edge the paraxial aim's ray is lost on, and carries the launch toward it", () => {
    let caught: unknown;
    try {
      aimRay(DIN, pupil, 1.1, { px: 1, py: 0 }, D_LINE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnreachableStopPoint);
    const e = caught as UnreachableStopPoint;
    expect(e.edge).toBe("miss@2");
    // The launch is the continuation's: it lands on the stop's rim when traced
    // through it, and crosses surface 2 behind itself on the way.
    const cont = traceRay(bare, e.launch!, { minT: -Infinity });
    expect(cont.behindAt).toBe(2);
    const local = applyToPoint(bare.surfaces[pupil.stopIndex]!.inverseFrame, cont.path[pupil.stopIndex]!);
    expect(Math.abs(local.x - pupil.stopRadius)).toBeLessThan(1e-10);
    expect(Math.abs(local.y)).toBeLessThan(1e-10);
    // A real trace of it never reaches the stop.
    expect(traceRay(bare, e.launch!).status).not.toBe("ok");
  });

  it("the last ray that exists crosses the crown where its two spheres meet — the closed-form circle", () => {
    // Two spheres, centres on the axis at z_i + R_i: they meet on the circle of
    // radius √(R1² − a²), a = (d² + R1² − R2²)/2d from the first centre.
    const [s1, s2] = [bare.surfaces[1]!, bare.surfaces[2]!];
    const R1 = 1 / s1.geometry.curvature;
    const R2 = 1 / s2.geometry.curvature;
    const d = s2.vertexZ + R2 - (s1.vertexZ + R1);
    const a = (d * d + R1 * R1 - R2 * R2) / (2 * d);
    const knife = Math.sqrt(R1 * R1 - a * a);
    const reaches = (rho: number) => {
      try {
        aimRay(DIN, pupil, 1.1, { px: rho, py: 0 }, D_LINE);
        return true;
      } catch (e) {
        if (e instanceof UnreachableStopPoint) return false;
        throw e;
      }
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 52; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) lo = mid;
      else hi = mid;
    }
    const hit = traceRay(bare, aimRay(DIN, pupil, 1.1, { px: lo, py: 0 }, D_LINE)).path[1]!;
    // Read: 5.4582843652 mm closed form, 5.4582843637 mm the last ray — 1.5e-9 mm
    // apart, the glass path the tracer's EPS_T leaves.
    expect(Math.abs(Math.hypot(hit.x, hit.y) - knife)).toBeLessThan(1e-8);
  });
});

/**
 * § 2z.5 — the stop sized by a real ray.
 *
 * Every objective sized its stop paraxially, so its real marginal ray — the
 * stop's rim ray, under real aiming — left the specimen at the engraving only to
 * first order. Sized where the ray at exactly the engraved NA crosses the stop,
 * the delivered NA is the engraving to rounding, on every architecture.
 */
describe("§ 2z.5 — the stop sized by a real ray delivers the engraved NA", () => {
  const inf = (o: Parameters<typeof infinityCorrectedMicroscope>[0]["objective"]) =>
    infinityCorrectedMicroscope({ objective: o, tubeLens: tubeLens({ focalLengthMm: 200 }), infinitySpaceMm: 100 });
  const din = (magnification: number, numericalAperture: number) => {
    const objective = finiteConjugateObjective({ magnification, numericalAperture });
    return { objective, system: finiteConjugateMicroscope({ objective }).system };
  };
  const cases = () => {
    const i4 = microscopeObjective({ magnification: 4, numericalAperture: 0.1, tubeFocalLengthMm: 200 });
    const i10 = microscopeObjective({ magnification: 10, numericalAperture: 0.2, tubeFocalLengthMm: 200 });
    const li = listerObjective({ magnification: 40, numericalAperture: 0.2, tubeFocalLengthMm: 200 });
    const oil = oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 });
    return [
      ["DIN 4×/0.10", 0.1, din(4, 0.1)],
      ["DIN 4×/0.20", 0.2, din(4, 0.2)],
      ["DIN 10×/0.20", 0.2, din(10, 0.2)],
      ["infinity 4×/0.10", 0.1, { objective: i4, system: inf(i4).system }],
      ["infinity 10×/0.20", 0.2, { objective: i10, system: inf(i10).system }],
      ["Lister 40×/0.20", 0.2, { objective: li, system: inf(li).system }],
      ["oil 100×/1.25", 1.25, { objective: oil, system: inf(oil).system }],
    ] as const;
  };
  /** The same chain on the objective's own paraxial stop radius. */
  const onParaxialStop = (system: OpticalSystem, paraxial: number): OpticalSystem => {
    const k = system.prescription.surfaces.findIndex((s) => s.isStop);
    const sized = (system.aperture as { readonly value: number }).value;
    return {
      ...system,
      aperture: { kind: "stopRadius", value: paraxial },
      prescription: {
        ...system.prescription,
        surfaces: system.prescription.surfaces.map((s, i) =>
          i === k && s.semiAperture === sized ? { ...s, semiAperture: paraxial } : s,
        ),
      },
    };
  };

  /** How far past the stop's rim a rim ray lands, relative — the bundle's, or the readout's to the last bit. */
  const rimLanding = (system: OpticalSystem, nm: number, lastBit: boolean): number => {
    const k = system.prescription.surfaces.findIndex((s) => s.isStop);
    const open = compile({
      ...system.prescription,
      surfaces: system.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    const ray = aimRay(system, pupils(system, nm), 0, { px: 1, py: 0 }, nm, { lastBit });
    const local = applyToPoint(open.surfaces[k]!.inverseFrame, traceRay(open, ray).path[k]!);
    // The aperture names the stop radius; the stop surface's own rim can be wider (the Lister's).
    return Math.hypot(local.x, local.y) / (system.aperture as { readonly value: number }).value - 1;
  };

  it("on every architecture, to 1e-15 — where the paraxial stop delivered the engraving to first order", () => {
    for (const [name, na, { objective, system }] of cases()) {
      const nm = system.wavelengths[0]!.nm;
      const got = objectNumericalAperture(system, nm);
      const old = objectNumericalAperture(onParaxialStop(system, objective.stopRadiusMm), nm);
      // The sizing is exact, and the readout re-solves the rim ray. A bundle's
      // solve stops anywhere inside the clip's margin — 7.0e-15 inside the rim on
      // the DIN 4×/0.20, whose NA reads 4.7e-15 low on it (6.0e-15 past, 3.6e-15
      // high, before § 2z.6's Jacobian; 7.4e-14 inside on the infinity 4×) — so
      // the readout solves its one ray on to the last bit: on the rim to an ulp on
      // all seven, the NA within 4.4e-16.
      expect(Math.abs(rimLanding(system, nm, true)), name).toBeLessThan(1e-15);
      // The control: the bundle's own rim ray, where the 4×/0.20's stopped.
      if (name === "DIN 4×/0.20") expect(Math.abs(rimLanding(system, nm, false)), name).toBeGreaterThan(5e-15);
      expect(Math.abs(got / na - 1), name).toBeLessThan(1e-15);
      // The control: on the paraxial stop the same rim ray read 0.10072, 0.18950,
      // 0.19771, 0.10082, 0.20140 and 0.20090 down this list — off by 0.45% to
      // 5.2%, either way — and the oil's, whose stop is its flat front face, is
      // the one the paraxial radius already had right.
      if (name.startsWith("oil")) expect(Math.abs(old / na - 1), name).toBeLessThan(1e-15);
      else expect(Math.abs(old / na - 1), name).toBeGreaterThan(4e-3);
    }
  });

  it("the diaphragm is the LENS's: the wrong slip keeps it, and a re-specified copy is re-sized", () => {
    // § 2z.9. The constructor cuts the diaphragm once, on the objective as built;
    // a composition handed that lens in another stack keeps it. Re-sized per
    // stack, a 100×/1.40 meeting the wrong slip would deliver 1.40 at every
    // thickness, and § 6e.5's slip-dependent NA — the physics a mismatch is read
    // for — would vanish.
    const oil = oilImmersionObjective({ magnification: 100, numericalAperture: 1.4, tubeFocalLengthMm: 200 });
    const built = oil.realStop!;
    expect(built.fromStopRadiusMm).toBe(oil.stopRadiusMm);
    expect(built.numericalAperture).toBe(1.4);
    const [s0, ...rest] = oil.prescription.surfaces;
    for (const thicknessMm of [0.16, 0.17, 0.18]) {
      const system = infinityCorrectedMicroscope({
        objective: {
          ...oil,
          objectDistanceMm: thicknessMm,
          prescription: { ...oil.prescription, surfaces: [{ ...s0!, thickness: s0!.thickness - (thicknessMm - 0.17) }, ...rest] },
        },
        tubeLens: tubeLens({ focalLengthMm: 200 }),
      }).system;
      expect(system.aperture).toEqual({ kind: "stopRadius", value: built.radiusMm });
    }
    // …and a copy that names another NA is not the lens the diaphragm was cut
    // for: it is sized on what it was given, and delivers that.
    const din = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    const slower = finiteConjugateMicroscope({ objective: { ...din, numericalAperture: 0.095 } }).system;
    expect(Math.abs(objectNumericalAperture(slower, din.designWavelengthNm) / 0.095 - 1)).toBeLessThan(1e-14);
  });

  it("an eyepiece behind the chain keeps its aim, so its stop is still filled to the engraving", () => {
    // § 2z.9. `visualMicroscope` rebuilt the system without the chain's aim: a
    // stop cut for the real marginal ray, aimed paraxially, under-filled to NA
    // 0.0994 on the DIN 4×/0.10.
    const eyepiece = plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 22 }).prescription;
    const objective = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    for (const rayAiming of ["real", "paraxial"] as const) {
      const visual = visualMicroscope({
        microscope: finiteConjugateMicroscope({ objective, rayAiming }),
        eyepiece,
        wavelengthNm: objective.designWavelengthNm,
      });
      expect(visual.system.rayAiming).toBe(rayAiming);
      expect(Math.abs(objectNumericalAperture(visual.system, objective.designWavelengthNm) / 0.1 - 1)).toBeLessThan(
        1e-14,
      );
    }
  });
});

/**
 * § 2z.6 — a rim ray lands inside its own stop's clip.
 *
 * The trace clips where r² exceeds the rim's radius² × (1 + 1e-12) — 5e-13 of
 * the radius — so a ray real aiming solved onto the rim must land closer than
 * that, or the stop it was aimed at vignettes it. The solve's chord runs to a
 * tenth of its 1e-12 tolerance for exactly this, but an early exit accepted
 * anything inside `tol` when the chord stalled: on the DIN 4×/0.20 at 0.85 mm
 * ten of 1600 rim rays landed up to 8.4e-13 past the rim, read "vignetted@3", and
 * the exit layout's rim flickered between the stop and a cut by the stop until
 * its corners never settled. External number: the clip's own 5e-13.
 */
describe("§ 2z.6 — a rim ray real aiming solved lands inside its stop's clip", () => {
  const inf = (o: Parameters<typeof infinityCorrectedMicroscope>[0]["objective"]) =>
    infinityCorrectedMicroscope({ objective: o, tubeLens: tubeLens({ focalLengthMm: 200 }), infinitySpaceMm: 100 });
  const din = (magnification: number, numericalAperture: number) =>
    finiteConjugateMicroscope({ objective: finiteConjugateObjective({ magnification, numericalAperture }) }).system;
  const presets = (): readonly (readonly [string, number, OpticalSystem])[] => [
    ["DIN 4×/0.10", 4, din(4, 0.1)],
    ["DIN 4×/0.20", 4, din(4, 0.2)],
    ["DIN 10×/0.20", 10, din(10, 0.2)],
    ["infinity 4×/0.10", 4, inf(microscopeObjective({ magnification: 4, numericalAperture: 0.1, tubeFocalLengthMm: 200 })).system],
    ["infinity 10×/0.20", 10, inf(microscopeObjective({ magnification: 10, numericalAperture: 0.2, tubeFocalLengthMm: 200 })).system],
    ["Lister 40×/0.20", 40, inf(listerObjective({ magnification: 40, numericalAperture: 0.2, tubeFocalLengthMm: 200 })).system],
    ["oil 100×/1.25", 100, inf(oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 })).system],
  ];
  /** The worst rim landing past the radius, relative, over `rays` azimuths. */
  const worstPast = (system: OpticalSystem, h: number, nm: number, rays: number): number => {
    const k = system.prescription.surfaces.findIndex((s) => s.isStop);
    const radius = system.prescription.surfaces[k]!.semiAperture;
    const open = compile({
      ...system.prescription,
      surfaces: system.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    const pupil = pupils(system, nm);
    let worst = -Infinity;
    for (let a = 0; a < rays; a++) {
      const t = (2 * Math.PI * a) / rays;
      let ray;
      try {
        ray = aimRay(system, pupil, h, { px: Math.cos(t), py: Math.sin(t) }, nm);
      } catch (e) {
        // A rim point vignetting makes unreachable is refused, not landed.
        if (e instanceof UnreachableStopPoint) continue;
        throw e;
      }
      const hit = traceRay(open, ray).path[k]!;
      const local = applyToPoint(open.surfaces[k]!.inverseFrame, hit);
      worst = Math.max(worst, Math.hypot(local.x, local.y) / radius - 1);
    }
    return worst;
  };

  it("on the DIN 4×/0.20 at 0.85 mm, where an accepted rim ray read vignetted by its own stop", () => {
    const system = din(4, 0.2);
    expect(worstPast(system, 0.85, 545, 64)).toBeLessThan(5e-13);
  });

  it("on every preset, across the field the mosaics are anchored over", () => {
    for (const [name, M, system] of presets()) {
      for (const h of [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5].map((r) => r / M)) {
        for (const nm of [430, 486.1327, 545, 587.5618, 656.2725]) {
          expect(worstPast(system, h, nm, 64), `${name} at ${h} mm, ${nm} nm`).toBeLessThan(5e-13);
        }
      }
    }
  });

  it("a ray's bits do not depend on the rays solved before it", () => {
    // The shared Jacobian was taken at the first ray's seed, off differences of
    // its misses, so it carried that ray's start and target in its last bits and
    // every later ray's chord with them: the same stop point on two identical
    // systems after different warm-ups came out 1e-16 to 1.5e-14 apart in
    // direction (the DIN 4×/0.20 at 0.3 mm, 656 nm). Now it is taken at the
    // chief's seed off the landings themselves.
    const solve = (system: OpticalSystem, h: number, nm: number, point: { px: number; py: number }) => {
      try {
        return aimRay(system, pupils(system, nm), h, point, nm).dir;
      } catch (e) {
        if (e instanceof UnreachableStopPoint) return null;
        throw e;
      }
    };
    const fresh = presets();
    const warmed = presets();
    for (let i = 0; i < fresh.length; i++) {
      const [name, M] = fresh[i]!;
      for (const nm of [486.1327, 656.2725]) {
        const h = 1.5 / M;
        const target = { px: 0.3, py: 0.2 };
        const cold = solve(fresh[i]![2], h, nm, target)!;
        const system = warmed[i]![2];
        for (const point of [{ px: 1, py: 0 }, { px: -0.7, py: 0.6 }, { px: 0, py: 0 }]) solve(system, h, nm, point);
        const warm = solve(system, h, nm, target)!;
        expect([warm.x, warm.y, warm.z], `${name} at ${nm} nm`).toEqual([cold.x, cold.y, cold.z]);
      }
    }
  });
});
