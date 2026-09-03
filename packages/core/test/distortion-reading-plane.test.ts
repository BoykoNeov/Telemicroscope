import { describe, it, expect } from "vitest";
import { distortionSeries } from "../src/analysis/distortion";
import { Prescription, reversePrescription } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { paraxialTrace } from "../src/trace/paraxial";
import { asCompiled } from "../src/trace/compile";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";
import { chiefRay } from "../src/pupil/aiming";
import { applyToPoint } from "../src/math/transform";
import { objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { FiniteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6co — the distortion map's cube moved by the READING PLANE, not by the ray.
 *
 * `Source: measurement only — no engine change.`
 *
 * **The hypothesis.** § 6cn.5 found that switching `rayAiming` to `"real"` moves
 * the fitted quartic onto the module's computed one and moves the fitted CUBE by
 * 3.6e-4 to 2.9e-3, and recorded that second number as unattributed: "if the
 * module's ray IS the stop-centre ray … then real aiming should agree with it
 * BETTER at third order than paraxial aiming does, and it agrees five orders
 * worse." Register item 15 named a candidate — trace the chief ray under both
 * modes and read where each crosses the diaphragm.
 *
 * That candidate cannot decide it, and this step says so first: `solveOntoStop`
 * drives the chief ray's stop miss to 1e-12 of the stop radius BY CONSTRUCTION,
 * so "real aiming lands on the stop centre" is a property of the solver, not a
 * measurement of the map (§ 6co.0 records the miss anyway, because the size of
 * the paraxial one — 1e-5 mm — is the calibration the rest of the step is read
 * against).
 *
 * The hypothesis actually tested is: **the 2.9e-3 is the plane the module reads
 * its answer at, and not the ray it traces.** `distortionSeries` reports the map
 * between the reversed system's own paraxial CONJUGATE planes; the forward map
 * is measured between the specimen and the system's DECLARED image plane, and
 * these objectives are focused 2.3% to 4.2% away from their paraxial conjugate.
 *
 * **The number that would refute it.** Take the same exact reversed trace the
 * module is pinned against and read it at the true specimen plane instead of at
 * the module's own. If the shift is the ray, that changes nothing and the fitted
 * cube stays 2.9e-3 from the real-aimed one. It lands on it to 8e-11 (§ 6co.1).
 *
 * And the refocus sweep (§ 6co.2) is what turns an attribution into a mechanism:
 * drive the defocus to zero and the shift goes to zero with it, linearly.
 */

type Cell = "s10" | "f10" | "s20" | "f20";
const SPEC: Record<Cell, readonly [number, number]> = {
  s10: [10, 0.1],
  f10: [10, 0.2],
  s20: [20, 0.1],
  f20: [20, 0.2],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];
/** § 6ck's own wavelength, as in § 6cn.5. */
const RULER_NM = 430;
const OBJ = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateObjective({ magnification: SPEC[c][0], numericalAperture: SPEC[c][1] })]),
) as Record<Cell, FiniteConjugateObjective>;
const LENS = Object.fromEntries(
  CELLS.map((c) => [c, finiteConjugateMicroscope({ objective: OBJ[c]! }).system]),
) as Record<Cell, OpticalSystem>;
const REAL = Object.fromEntries(
  CELLS.map((c) => [c, { ...LENS[c]!, rayAiming: "real" as const }]),
) as Record<Cell, OpticalSystem>;

function solve3(rows: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const A = rows.map((r, i) => [...r, rhs[i]!]);
  for (let k = 0; k < 3; k++) {
    let piv = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(A[i]![k]!) > Math.abs(A[piv]![k]!)) piv = i;
    [A[k], A[piv]] = [A[piv]!, A[k]!];
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      const fr = A[i]![k]! / A[k]![k]!;
      for (let j = k; j < 4; j++) A[i]![j]! -= fr * A[k]![j]!;
    }
  }
  return [A[0]![3]! / A[0]![0]!, A[1]![3]! / A[1]![1]!, A[2]![3]! / A[2]![2]!];
}

/**
 * § 6ck's fit — `h(r)/r/mu − 1 = a r² + b r⁴ + c r⁶` — over any h(r) at all, so
 * the same arithmetic reads the forward map and the reversed trace and the
 * comparison is never between two different fits.
 */
function fitMap(h: (r: number) => number, radii: readonly number[] = [1, 2, 4]) {
  const mu = h(1e-4) / 1e-4;
  const abc = solve3(
    radii.map((t) => [t ** 2, t ** 4, t ** 6]),
    radii.map((t) => h(t) / t / mu - 1),
  );
  return { mu, a: abc[0]!, b: abc[1]! };
}

/** Everything § 6cn.5's `reversedStopFirst` builds, plus the planes it implies. */
function cellGeometry(c: Cell, imageDistanceMm?: number) {
  const obj = OBJ[c]!;
  const sys = LENS[c]!;
  const cs = asCompiled(sys.prescription);
  const zLast = cs.surfaces[cs.surfaces.length - 1]!.vertexZ;
  // The stop IS the last surface (§ 6cn.5's first rung), so the exit pupil is
  // the stop and P0 is exactly the declared image distance.
  const P0 = imageDistanceMm ?? imagePlaneZ(cs, sys) - pupils(sys, RULER_NM).exit.z;
  const rev = reversePrescription(obj.prescription, obj.objectDistanceMm);
  const rx: Prescription = { ...rev, surfaces: rev.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })) };
  const s = distortionSeries(rx, RULER_NM, { objectDistanceMm: P0 });
  const zLastRev = rx.surfaces.slice(0, -1).reduce((z, x) => z + x.thickness, 0);
  return {
    obj,
    rx,
    P0,
    series: s,
    A: s.imageHeightSeries[3]! / s.magnification,
    B: s.imageHeightSeries[5]! / s.magnification,
    /** Where the module reads its answer: the reversed system's paraxial image. */
    zModule: zLastRev + s.imageDistanceMm,
    /** Where the specimen actually is, measured from the same vertex. */
    zSpecimen: zLast + obj.objectDistanceMm,
    /** Object plane → entrance pupil: the lever the object-space chief ray leans on. */
    lever: pupils(sys, RULER_NM).entrance.z + obj.objectDistanceMm,
    /** The exact reversed trace, read at any plane the caller names. */
    hAt:
      (zPlane: number) =>
      (r: number): number => {
        const t = traceRay(rx, makeRay(vec3(r, 0, -P0), vec3(-r, 0, P0), RULER_NM));
        expect(t.status).toBe("ok");
        const { dir, origin } = t.ray!;
        return Math.abs(origin.x + (dir.x / dir.z) * (zPlane - origin.z));
      },
  };
}

/** The microscope with its image plane moved to `t` mm past the last vertex. */
function refocused(c: Cell, t: number, real: boolean): OpticalSystem {
  const p = LENS[c]!.prescription;
  const surfaces = p.surfaces.map((s, i) => (i === p.surfaces.length - 1 ? { ...s, thickness: t } : s));
  const base: OpticalSystem = { ...LENS[c]!, prescription: { ...p, surfaces } };
  return real ? { ...base, rayAiming: "real" as const } : base;
}

/** Where the objective's own object plane images, paraxially, from the last vertex. */
function paraxialConjugate(c: Cell): number {
  const p = LENS[c]!.prescription;
  const flat: Prescription = {
    ...p,
    surfaces: p.surfaces.map((s, i) => (i === p.surfaces.length - 1 ? { ...s, thickness: 0 } : s)),
  };
  const t = paraxialTrace(flat, RULER_NM, { y: OBJ[c]!.objectDistanceMm, u: 1 });
  return -t.y / t.u;
}

const mapPar = (c: Cell) => (r: number) =>
  objectHeightForImageRadius(LENS[c]!, r, RULER_NM, { magnification: SPEC[c][0] });
const mapReal = (c: Cell) => (r: number) =>
  objectHeightForImageRadius(REAL[c]!, r, RULER_NM, { magnification: SPEC[c][0] });

describe("§ 6co.0 — the candidate the register named, and why it decides nothing", () => {
  it("real aiming lands on the stop centre BY CONSTRUCTION; paraxial misses by 1e-5 mm", () => {
    for (const c of CELLS) {
      const sys = LENS[c]!;
      const cs = asCompiled(sys.prescription);
      const p = pupils(sys, RULER_NM);
      const stop = cs.surfaces[p.stopIndex]!;
      const h = objectHeightForImageRadius(sys, 1, RULER_NM, { magnification: SPEC[c][0] });
      const crossing = (s: OpticalSystem): number => {
        const t = traceRay(cs, chiefRay(s, pupils(s, RULER_NM), h, RULER_NM));
        expect(t.status).toBe("ok");
        return applyToPoint(stop.inverseFrame, t.path[p.stopIndex]!).x;
      };
      // The solver's own tolerance is 1e-12 of the stop radius, so this is the
      // solver reporting itself. Recorded because the OTHER number needs a scale.
      expect(Math.abs(crossing(REAL[c]!))).toBeLessThan(1e-11);
      // Aimed at the paraxial entrance pupil instead, the chief ray misses the
      // diaphragm centre by parts in 1e5 of the stop radius. That is the whole
      // of the difference between the two maps — and § 6co.2 shows that at the
      // paraxial conjugate it costs the CUBE nothing at all.
      const miss = Math.abs(crossing(LENS[c]!));
      expect(miss).toBeGreaterThan(5e-6);
      expect(miss).toBeLessThan(2e-5);
    }
  });
});

describe("§ 6co.1 — the module reads at its own conjugate, which is not the specimen", () => {
  it("that plane is 2e-3 to 3.4e-2 mm off, and dz/lever IS the offset between the maps", () => {
    for (const c of CELLS) {
      const g = cellGeometry(c);
      const dz = g.zModule - g.zSpecimen;
      // Not a rounding residue: the declared image distance is 2.3% to 4.2% away
      // from the paraxial conjugate of the declared object distance, so the two
      // planes cannot coincide.
      expect(Math.abs(dz)).toBeGreaterThan(1e-3);
      expect(Math.abs(paraxialConjugate(c) / g.obj.imageDistanceMm - 1)).toBeGreaterThan(3e-3);
      // The object-space chief ray leans by dz/lever over that gap, and that is
      // exactly the constant relative offset between the module's map and the
      // forward one, read at a radius deep inside the paraxial regime.
      const offset = mapReal(c)(1e-4) / g.hAt(g.zModule)(1e-4) - 1;
      expect(Math.abs(-(dz / g.lever) / offset - 1)).toBeLessThan(1e-4);
    }
  });

  it("read at the SPECIMEN plane, the same trace is the real-aimed map — cube AND quartic", () => {
    for (const c of CELLS) {
      const g = cellGeometry(c);
      const atSpecimen = fitMap(g.hAt(g.zSpecimen));
      const real = fitMap(mapReal(c));
      // The refutation that did not happen: if the 2.9e-3 were the ray, moving
      // the reading plane could not remove it. It removes all of it.
      expect(Math.abs(atSpecimen.a / real.a - 1)).toBeLessThan(1e-9);
      expect(Math.abs(atSpecimen.b / real.b - 1)).toBeLessThan(1e-5);
    }
  });

  it("read at the MODULE's plane, it is the module's series and the PARAXIAL-aimed cube", () => {
    for (const c of CELLS) {
      const g = cellGeometry(c);
      const atModule = fitMap(g.hAt(g.zModule));
      const par = fitMap(mapPar(c));
      // Same rays, same fit, one plane apart: the two numbers § 6cn.5 could not
      // separate are the same trace read twice.
      expect(Math.abs(atModule.a / g.A - 1)).toBeLessThan(1e-7);
      expect(Math.abs(atModule.a / par.a - 1)).toBeLessThan(1e-7);
      // The quartic does NOT follow it there — that one really is the aiming,
      // which is § 6cn.5's finding standing.
      expect(Math.abs(atModule.b / par.b - 1)).toBeGreaterThan(0.5);
    }
  });
});

describe("§ 6co.2 — the refocus sweep: two errors that were always one", () => {
  /**
   * The declared image plane is walked to the paraxial conjugate in quarters.
   * Nothing else moves: the same glass, the same specimen, the same fit.
   */
  const FRACTIONS = [0, 0.25, 0.5, 0.75] as const;

  it("the shift is proportional to the defocus, with one constant per cell", () => {
    for (const c of CELLS) {
      const nominal = OBJ[c]!.imageDistanceMm;
      const conj = paraxialConjugate(c);
      const g0 = cellGeometry(c);
      const ratios: number[] = [];
      for (const frac of FRACTIONS) {
        const t = nominal + frac * (conj - nominal);
        const g = cellGeometry(c, t);
        const par = fitMap((r) => objectHeightForImageRadius(refocused(c, t, false), r, RULER_NM, { magnification: SPEC[c][0] }));
        const real = fitMap((r) => objectHeightForImageRadius(refocused(c, t, true), r, RULER_NM, { magnification: SPEC[c][0] }));
        const dz = g.zModule - g0.zSpecimen;
        ratios.push((par.a / real.a - 1) / (dz / g.lever));
      }
      // 517.0, 479.7, 550.1 and 529.9 for the four cells — each flat to 1e-3
      // over a 4:1 range of defocus. A shift that were the RAY has no reason to
      // be proportional to how far the image plane sits from a conjugate.
      const spread = Math.max(...ratios) / Math.min(...ratios) - 1;
      expect(Math.abs(spread)).toBeLessThan(1e-3);
      expect(Math.abs(ratios[0]!)).toBeGreaterThan(400);
      expect(Math.abs(ratios[0]!)).toBeLessThan(600);
    }
  });

  it("at the paraxial conjugate both errors are gone, and the two aimings agree", () => {
    for (const c of CELLS) {
      const t = paraxialConjugate(c);
      const g = cellGeometry(c, t);
      const par = fitMap((r) => objectHeightForImageRadius(refocused(c, t, false), r, RULER_NM, { magnification: SPEC[c][0] }));
      const real = fitMap((r) => objectHeightForImageRadius(refocused(c, t, true), r, RULER_NM, { magnification: SPEC[c][0] }));
      // The zero the sweep is anchored on. Where every ray from an object point
      // lands on one image point, WHICH chief ray was picked cannot move the
      // map's cube — and the module's plane is the specimen's, so its own error
      // is gone in the same stroke.
      expect(Math.abs(g.zModule - g.zSpecimen)).toBeLessThan(1e-9);
      expect(Math.abs(par.a / real.a - 1)).toBeLessThan(1e-8);
      expect(Math.abs(g.A / real.a - 1)).toBeLessThan(1e-7);
      // The QUARTIC survives the refocus: still the wrong sign or a factor away.
      // So the two halves of § 6cn.5 separate cleanly — the cube was the plane,
      // the quartic is the ray.
      expect(Math.abs(par.b / real.b - 1)).toBeGreaterThan(2);
    }
  });
});

describe("§ 6co.3 — which of the two numbers is a floor", () => {
  it("a_par against the module is the FIT's floor; the shift against real aiming is not", () => {
    for (const c of CELLS) {
      const g = cellGeometry(c);
      const shifts: number[] = [];
      const floors: number[] = [];
      for (const radii of [[1, 2, 4], [0.5, 1, 2], [0.25, 0.5, 1]]) {
        const par = fitMap(mapPar(c), radii);
        const real = fitMap(mapReal(c), radii);
        shifts.push(par.a / real.a - 1);
        floors.push(Math.abs(par.a / g.A - 1));
      }
      // Shrink the fit radii 4x and the agreement between the paraxial-aimed
      // cube and the module's degrades by more than an order: it is the fit's
      // own resolution, not a residue of the identity.
      expect(floors[2]! / floors[0]!).toBeGreaterThan(10);
      // The physical shift does not move at all over the same 4x.
      expect(Math.abs(Math.max(...shifts) / Math.min(...shifts) - 1)).toBeLessThan(1e-4);
    }
  });
});
