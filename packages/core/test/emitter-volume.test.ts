import { describe, it, expect } from "vitest";
import {
  depthRescale,
  gaussianBallEmitter,
  gaussianBallFlux,
  rasterizeEmitterVolume,
  slabEmitter,
  sphereEmitter,
  uniformSlabs,
  type DepthRescale,
  type EmitterSlabs,
} from "../src/imaging/emitter-volume";
import { discEmitter, rasterizeEmitterDensity } from "../src/imaging/emitter-density";
import {
  imageRadiusForObjectHeight,
  imagePointAt,
  objectFieldTile,
  type ObjectFieldFrame,
} from "../src/imaging/object-field";
import { radialMapCovering, type RadialMap } from "../src/imaging/radial-map";
import { defocusing, renderVolume } from "../src/imaging/volume";
import { idealPupil } from "../src/illumination/transfer";
import { imagePlaneZ, pupils } from "../src/pupil/pupils";
import { asCompiled } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import { traceRay } from "../src/trace/sequential";
import { makeRay } from "../src/trace/ray";
import { add, normalize, scale, sub, vec3 } from "../src/math/vec3";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6az — the volumetric emitter density, and the deferral's own prediction
 * corrected.
 *
 * § 6as warped a **plane** and left the volume open in one line: "the third
 * dimension of the same Jacobian — which is not `(h/r)·(dh/dr)` and is **not a
 * scalar**". It is a scalar. It is one scalar per depth, `(1 + z·k)²`, it
 * multiplies § 6as's element whole, and `k` is one over the distance from the
 * object plane to the entrance pupil.
 *
 * The reason it factorizes is geometric: a chief ray from an object point at
 * depth is *the same line* as the chief ray from the nominal object plane at a
 * rescaled height, so a trace cannot tell them apart. § 6az.1 pins that to
 * **4 ulp**, and to the last bit at zero depth — the residual is the rounding of
 * the height that names the line and not the trace. One `RadialMap` therefore
 * serves the whole volume and this step adds no tracing at all.
 *
 * The external numbers are:
 *
 * - **the pinhole camera's perspective**, `h·P/(P − z)`, which is what the
 *   rescale reduces to when the entrance pupil sits at the lens — and § 6az.6
 *   pins that `P` is then the object distance to the last digit;
 * - **the midpoint rule's order**, 2, which is what the slice count converges
 *   at once the emitter is given no edge to hide it behind (§ 6az.9);
 * - **the Gaussian's own integral**, `peak·(π/2)^{3/2}·w²·w_z`, one dimension up
 *   from `gaussianEmitter`'s `π·w²/2` (§ 6az.10);
 * - **§ 6as.2's ratio 3**, which survives depth untouched because the stretch is
 *   isotropic (§ 6az.5).
 *
 * and the one **bracket** is § 6as.4's lattice discrepancy, inherited: a
 * hard-edged emitter point-sampled on a grid miscounts its own area, so flux is
 * a converging witness and never an exact one.
 *
 * **The step's own finding beyond the deferral** is that the rate is chromatic
 * and the default objective is object-space telecentric at **two** wavelengths,
 * not one — § 6ap's mechanism (an achromatic element turns a distance around
 * inside the band) arriving on the object side and in the depth direction, on
 * the system every caller gets unasked. One crossing is § 6v's engineering — the
 * stop is placed at the back focal distance read at the design wavelength — and
 * the other is the doublet's own turn.
 */

/** § 6n's, § 6o's, § 6s's and § 6as's own probe: the DIN 4×/0.10. */
const OBJECTIVE = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
const SCOPE = finiteConjugateMicroscope({ objective: OBJECTIVE });
const SYSTEM: OpticalSystem = SCOPE.system;

/**
 * The lever: the stop moved onto the front surface, so the entrance pupil sits
 * **at the lens** and the rescale is the pinhole camera's.
 *
 * Not a contrivance: it is where § 6v.3's own `"rim"` negative control puts the
 * pupil, reached here by moving ONLY the stop surface so that nothing else in
 * the prescription varies with it. It is the only way to see the depth term
 * against the lattice residual rather than under it.
 */
const LEVER: OpticalSystem = { ...SYSTEM, apertureStop: { kind: "surface", index: 0 } };

/** The design wavelength, where § 6v's back-focal stop makes the objective telecentric. */
const DESIGN = 587.5618;
/** The C line — off both crossings, so the rate is real and positive there. */
const OFF = 656.2725;

const OBJECT_PLANE_Z = -SCOPE.objectDistanceMm;

const NODES = 128;

const tile = (system: OpticalSystem, wavelengthNm: number, size = 128): ObjectFieldFrame =>
  objectFieldTile(system, { size, pupilSamples: 32, wavelengthNm, centreMm: { x: 0, y: 0 } });

const mapFor = (system: OpticalSystem, frame: ObjectFieldFrame): RadialMap =>
  radialMapCovering(system, [frame], { nodes: NODES });

const total = (values: Float64Array): number => {
  let s = 0;
  for (const v of values) s += v;
  return s;
};

/**
 * Where the chief ray from an object point at (h, depth) crosses the **nominal**
 * image plane — the plane the system focuses on, not the one that depth images
 * to.
 *
 * Built here rather than shipped, and that is the point of § 6az.1: the engine
 * ships a rescale of the flat map, and this is the independent construction it
 * is weighed against. It is `aimRay`'s own definition of a chief ray for a
 * finite conjugate — the line from the object point to the entrance-pupil
 * centre — with the object point moved off the nominal plane.
 */
function offPlaneChiefRadius(
  system: OpticalSystem,
  heightMm: number,
  depthMm: number,
  wavelengthNm: number,
): number {
  const c = asCompiled(system.prescription);
  const geometry = pupils(system, wavelengthNm);
  const origin = vec3(heightMm, 0, OBJECT_PLANE_Z - depthMm);
  const target = vec3(0, 0, geometry.entrance.z);
  const aimed = normalize(sub(target, origin));
  // A line, not a direction: the entrance pupil may be virtual and lie behind
  // the object, and `towardOptics` makes the same choice one layer down.
  const toward = aimed.z > 0 ? aimed : scale(aimed, -1);
  const traced = traceRay(system.prescription, makeRay(origin, toward, wavelengthNm));
  if (traced.status !== "ok" || !traced.ray) {
    throw new Error(`off-plane chief ray failed (${traced.status})`);
  }
  const r = toImageSpace(c, traced.ray);
  const planeZ = imagePlaneZ(c, system);
  const hit = add(r.origin, scale(r.dir, (planeZ - r.origin.z) / r.dir.z));
  return Math.hypot(hit.x, hit.y);
}

/** Flux-weighted mean image radius of a rasterized slice — where the picture is. */
function meanImageRadius(frame: ObjectFieldFrame, values: Float64Array): number {
  const { size } = frame;
  let flux = 0;
  let moment = 0;
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const v = values[iy * size + ix]!;
      if (v === 0) continue;
      const { x, y } = imagePointAt(frame, ix / size, iy / size);
      flux += v;
      moment += v * Math.hypot(x, y);
    }
  }
  return moment / flux;
}

/** One slab, so a test can read a single slice's flux and its own stretch. */
const oneSlab = (depthMm: number, thicknessMm: number): EmitterSlabs => ({
  depthsMm: [depthMm],
  thicknessMm: [thicknessMm],
});

/** Least-squares slope of log y against log x — the exponent, not a ratio. */
const logSlope = (xs: readonly number[], ys: readonly number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return num / den;
};

const rescaleFor = (system: OpticalSystem, nm: number): DepthRescale =>
  depthRescale(system, nm);

const rateAt = (system: OpticalSystem, nm: number): number =>
  rescaleFor(system, nm).ratePerMm;

describe("§ 6az — the volumetric emitter density", () => {
  describe("§ 6az.1 — a chief ray from a depth is the SAME LINE, bitwise", () => {
    it("lands exactly where the flat map's rescaled height lands", () => {
      const k = rateAt(LEVER, DESIGN);
      expect(k).toBeGreaterThan(0);
      for (const heightMm of [0.05, 0.2, 0.5]) {
        for (const depthMm of [1e-3, 1e-2, 0.1, 1]) {
          const stretch = 1 + depthMm * k;
          const traced = offPlaneChiefRadius(LEVER, heightMm, depthMm, DESIGN);
          const viaFlat = imageRadiusForObjectHeight(LEVER, heightMm / stretch, DESIGN);
          // The two constructions trace the SAME LINE, so the only difference
          // available is the rounding of the height that names it: `h/(1 + z·k)`
          // and `h·P/(P + z)` are one number in exact arithmetic and one ulp
          // apart in f64. Pinned at the last bit rather than at a tolerance.
          expect(Math.abs(traced / viaFlat - 1)).toBeLessThan(4 * Number.EPSILON);
        }
      }
    });

    it("and the identity is not vacuous — the landing point really moves", () => {
      const k = rateAt(LEVER, DESIGN);
      const heightMm = 0.5;
      const flat = imageRadiusForObjectHeight(LEVER, heightMm, DESIGN);
      const deep = offPlaneChiefRadius(LEVER, heightMm, 1, DESIGN);
      // 1 mm of depth against a 45.78 mm pupil distance: 2.2%, and downward,
      // because the object point is further from the pupil.
      expect(deep).toBeLessThan(flat);
      expect(1 - deep / flat).toBeGreaterThan(2.1e-2);
      expect(1 - deep / flat).toBeLessThan(2.2e-2);
      expect(k).toBeCloseTo(2.18456e-2, 7);
    });

    it("at zero depth it is the ordinary chief ray, bitwise", () => {
      for (const heightMm of [0.05, 0.5]) {
        expect(offPlaneChiefRadius(LEVER, heightMm, 0, DESIGN)).toBe(
          imageRadiusForObjectHeight(LEVER, heightMm, DESIGN),
        );
      }
    });
  });

  describe("§ 6az.2 — zero depth collapses to § 6as, bitwise", () => {
    it("a unit slab reproduces `rasterizeEmitterDensity` value for value", () => {
      const frame = tile(SYSTEM, DESIGN);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, DESIGN);
      const R = frame.objectHalfExtentMm * 0.5;
      const flat = rasterizeEmitterDensity(frame, discEmitter({ radiusMm: R, density: 3 }), {
        radialMap,
      });
      const volume = rasterizeEmitterVolume(
        frame,
        (x, y) => (x * x + y * y <= R * R ? 3 : 0),
        { radialMap, rescale, slabs: oneSlab(0, 1) },
      );
      expect(volume.slices).toHaveLength(1);
      const values = volume.slices[0]!.field.values;
      for (let i = 0; i < values.length; i++) expect(values[i]).toBe(flat.values[i]);
    });

    it("and the slab thickness is a bare factor", () => {
      const frame = tile(SYSTEM, DESIGN);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, DESIGN);
      const R = frame.objectHalfExtentMm * 0.5;
      const density = (x: number, y: number): number => (x * x + y * y <= R * R ? 3 : 0);
      const unit = rasterizeEmitterVolume(frame, density, {
        radialMap,
        rescale,
        slabs: oneSlab(0, 1),
      });
      const thick = rasterizeEmitterVolume(frame, density, {
        radialMap,
        rescale,
        slabs: oneSlab(0, 3.7),
      });
      const a = unit.slices[0]!.field.values;
      const b = thick.slices[0]!.field.values;
      for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]! * 3.7);
    });
  });

  describe("§ 6az.3 — the RATE, never the distance: the design wavelength is a NaN", () => {
    it("the entrance pupil is at infinity there, so `P` is unusable", () => {
      const rescale = depthRescale(SYSTEM, DESIGN);
      expect(Number.isFinite(rescale.entrancePupilZMm)).toBe(false);
      const P = rescale.entrancePupilZMm - rescale.objectPlaneZMm;
      // The form § 6as's deferral invites, on the default system's own primary
      // wavelength. This is the whole reason the rate is what gets stored.
      expect(Number.isNaN((0.5 * P) / (P - 0.25))).toBe(true);
    });

    it("while the rate is exactly zero and the stretch exactly one", () => {
      const rescale = depthRescale(SYSTEM, DESIGN);
      expect(rescale.ratePerMm === 0).toBe(true);
      for (const z of [-1, -1e-3, 0, 1e-3, 0.25, 7]) {
        expect(rescale.stretchAt(z)).toBe(1);
      }
    });

    it("so a telecentric render is a hard no-op, not a small correction", () => {
      const frame = tile(SYSTEM, DESIGN);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, DESIGN);
      const R = frame.objectHalfExtentMm * 0.4;
      const volume = rasterizeEmitterVolume(
        frame,
        sphereEmitter({ radiusMm: R, density: 1 }),
        { radialMap, rescale, slabs: uniformSlabs(-R, R, 8) },
      );
      expect(volume.maxStretchDeparture).toBe(0);
      for (const slice of volume.slices) {
        for (const v of slice.field.values) expect(Number.isFinite(v)).toBe(true);
      }
      expect(volume.emittedFlux).toBeGreaterThan(0);
    });
  });

  describe("§ 6az.4 — the objective is object-space telecentric TWICE", () => {
    const bisect = (lo: number, hi: number): number => {
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (mid === lo || mid === hi) break;
        if (Math.sign(rateAt(SYSTEM, mid)) === Math.sign(rateAt(SYSTEM, lo))) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };

    it("one crossing is § 6v's engineering: the design wavelength, exactly", () => {
      expect(rateAt(SYSTEM, DESIGN) === 0).toBe(true);
      expect(bisect(580, 592)).toBeCloseTo(DESIGN, 6);
    });

    it("the other is the doublet's own turn, and nothing placed it there", () => {
      const crossing = bisect(520, 535);
      expect(crossing).toBeCloseTo(530.567099263, 6);
      expect(rateAt(SYSTEM, crossing) === 0).toBe(true);
    });

    it("and the rate is NEGATIVE between them and positive outside — § 6ap's shape", () => {
      expect(rateAt(SYSTEM, 486.1327)).toBeGreaterThan(0);
      expect(rateAt(SYSTEM, 500)).toBeGreaterThan(0);
      expect(rateAt(SYSTEM, 546.074)).toBeLessThan(0);
      expect(rateAt(SYSTEM, 560)).toBeLessThan(0);
      expect(rateAt(SYSTEM, 600)).toBeGreaterThan(0);
      expect(rateAt(SYSTEM, 656.2725)).toBeGreaterThan(0);
      // The band's span, and the extremum of the negative lobe.
      expect(rateAt(SYSTEM, 430)).toBeCloseTo(6.77853e-5, 9);
      expect(rateAt(SYSTEM, 680)).toBeCloseTo(1.93607e-5, 9);
      expect(rateAt(SYSTEM, 430) / rateAt(SYSTEM, 486.1327)).toBeCloseTo(5.006, 2);
      let worst = 0;
      let worstNm = 0;
      for (let nm = 531; nm <= 587; nm += 0.1) {
        const r = rateAt(SYSTEM, nm);
        if (r < worst) {
          worst = r;
          worstNm = nm;
        }
      }
      expect(worst).toBeCloseTo(-1.72471e-6, 10);
      expect(worstNm).toBeCloseTo(557.4, 0);
    });

    it("so the wrong wavelength's rate zooms the stack BACKWARDS, and is refused", () => {
      const frame = tile(SYSTEM, OFF);
      const radialMap = mapFor(SYSTEM, frame);
      const wrong = depthRescale(SYSTEM, 546.074);
      expect(Math.sign(wrong.ratePerMm)).not.toBe(Math.sign(rateAt(SYSTEM, OFF)));
      expect(() =>
        rasterizeEmitterVolume(frame, () => 1, {
          radialMap,
          rescale: wrong,
          slabs: oneSlab(0, 1),
        }),
      ).toThrow(/CHANGES SIGN/);
    });
  });

  describe("§ 6az.5 — the stretch is ISOTROPIC, so § 6as.2's ratio 3 survives depth", () => {
    it("the ratio does not move, to the cancellation floor of the departure it is built from", () => {
      const frame = tile(LEVER, DESIGN, 128);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      const axisSlope = radialMap.heightSlopeAt(0);
      // § 6as.2's own quantity: the two factors' departures from their common
      // axis limit, whose ratio is 3 under third-order distortion with the
      // coefficient cancelling. Read here at depth as well as on the plane.
      const ratioAt = (r: number, depth: number): number => {
        const st = rescale.stretchAt(depth);
        const tangential = (radialMap.heightAt(r) / r) * st;
        const radial = radialMap.heightSlopeAt(r) * st;
        const axis = axisSlope * st;
        return (radial / axis - 1) / (tangential / axis - 1);
      };
      const disagreementAt = (r: number): number => {
        const flat = ratioAt(r, 0);
        expect(flat).toBeGreaterThan(2.99);
        expect(flat).toBeLessThan(3.01);
        let worst = 0;
        for (const depth of [0.1, 1, 5]) {
          worst = Math.max(worst, Math.abs(ratioAt(r, depth) / flat - 1));
        }
        return worst;
      };
      const outer = disagreementAt(frame.halfExtentMm);
      const inner = disagreementAt(frame.halfExtentMm * 0.5);
      // Depth adds NO anisotropy: the stretch is a common factor of both terms
      // and cancels out of the ratio exactly. What is left is f64 cancellation
      // in the departures, which are 1e-8-sized here — so the residual is a
      // property of the SUBTRACTION and not of the optics, and the proof of that
      // is that halving the radius quarters the departure and makes the
      // disagreement roughly four times worse rather than leaving it alone.
      expect(outer).toBeLessThan(1e-7);
      expect(inner / outer).toBeGreaterThan(2.5);
      expect(inner / outer).toBeLessThan(6);
    });
  });

  describe("§ 6az.6 — the lever is the pinhole camera, and P is the object distance", () => {
    it("the entrance pupil sits on the front vertex, so 1/k is the object distance exactly", () => {
      const rescale = depthRescale(LEVER, DESIGN);
      expect(rescale.entrancePupilZMm).toBe(0);
      expect(rescale.objectPlaneZMm).toBe(OBJECT_PLANE_Z);
      // The pinhole's own perspective: h·P/(P − z) with P the object distance.
      expect(1 / rescale.ratePerMm).toBe(SCOPE.objectDistanceMm);
      expect(SCOPE.objectDistanceMm).toBeCloseTo(45.7757694036543, 12);
    });

    it("and that is 1685× the default's rate at the same wavelength", () => {
      expect(rateAt(LEVER, OFF) / rateAt(SYSTEM, OFF)).toBeCloseTo(1685, 0);
    });
  });

  describe("§ 6az.7 — the direction: deeper images SMALLER", () => {
    it("a disc at +z lands inside the same disc at −z, by the traced map's own mean", () => {
      const frame = tile(LEVER, DESIGN, 256);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      const R = frame.objectHalfExtentMm * 0.6;
      const density = (x: number, y: number): number => (x * x + y * y <= R * R ? 1 : 0);
      const radiusAt = (depth: number): number => {
        const v = rasterizeEmitterVolume(frame, density, {
          radialMap,
          rescale,
          slabs: oneSlab(depth, 1),
        });
        return meanImageRadius(frame, v.slices[0]!.field.values);
      };
      const near = radiusAt(-1);
      const flat = radiusAt(0);
      const far = radiusAt(1);
      // A sign rung: it must fail if the sense reverses, so the ordering is
      // asserted before any magnitude is.
      expect(far).toBeLessThan(flat);
      expect(flat).toBeLessThan(near);

      // The prediction is the same first moment the raster forms, taken on the
      // TRACED forward map rather than on the tabulated inverse: the flux
      // element is the object area, so the mean image radius of a filled disc is
      // the h-weighted mean of r(h/stretch) over the disc's own heights.
      const predicted = (depth: number): number => {
        const st = rescale.stretchAt(depth);
        const n = 2000;
        let moment = 0;
        let weight = 0;
        for (let i = 0; i < n; i++) {
          const h = ((i + 0.5) / n) * R;
          const w = h;
          moment += w * imageRadiusForObjectHeight(LEVER, h / st, DESIGN);
          weight += w;
        }
        return moment / weight;
      };
      const mapRatio = predicted(-1) / predicted(1);
      expect(near / far).toBeCloseTo(mapRatio, 4);
    });
  });

  describe("§ 6az.8 — a uniform slab's flux, and the negative control", () => {
    it("converges on rho·pi·R²·T, and dropping the depth factor is wrong by the mean stretch²", () => {
      const frame = tile(LEVER, DESIGN, 256);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      const R = frame.objectHalfExtentMm * 0.4;
      const RHO = 1;
      const T = 1;
      const slices = 10;
      const slabs = uniformSlabs(0, T, slices);
      const density = slabEmitter({
        lateral: (x, y) => (x * x + y * y <= R * R ? RHO : 0),
        fromMm: -1,
        toMm: 2,
      });

      let withJ = 0;
      let withoutJ = 0;
      for (let i = 0; i < slices; i++) {
        const depth = slabs.depthsMm[i]!;
        const one = rasterizeEmitterVolume(frame, density, {
          radialMap,
          rescale,
          slabs: oneSlab(depth, slabs.thicknessMm[i]!),
        });
        const st = rescale.stretchAt(depth);
        withJ += one.emittedFlux;
        // The control is the area factor alone: the same sampling, charged
        // without (1 + z·k)², which is § 6as.5's control one dimension up.
        withoutJ += one.emittedFlux / (st * st);
      }

      const exact = RHO * Math.PI * R * R * T;
      expect(Math.abs(withJ / exact - 1)).toBeLessThan(1e-3);
      // The deficit is the mean of 1/(1 + z·k)² over the stack, far above the
      // lattice residual the witness itself carries.
      expect(withoutJ / exact - 1).toBeCloseTo(-2.114e-2, 4);
      expect(Math.abs(withoutJ / exact - 1) / Math.abs(withJ / exact - 1)).toBeGreaterThan(50);
    });

    it("and the whole stack is one call, with the same answer", () => {
      const frame = tile(LEVER, DESIGN, 256);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      const R = frame.objectHalfExtentMm * 0.4;
      const slabs = uniformSlabs(0, 1, 10);
      const volume = rasterizeEmitterVolume(
        frame,
        slabEmitter({
          lateral: (x, y) => (x * x + y * y <= R * R ? 1 : 0),
          fromMm: -1,
          toMm: 2,
        }),
        { radialMap, rescale, slabs },
      );
      expect(volume.slices).toHaveLength(10);
      let summed = 0;
      for (const slice of volume.slices) summed += total(slice.field.values);
      expect(summed).toBeCloseTo(volume.emittedFlux, 12);
      expect(volume.emittedFlux / (Math.PI * R * R)).toBeCloseTo(1, 3);
      // The stack is referred to focus, so its coordinates are offsets.
      expect(volume.focusMm).toBe(0);
      expect(volume.slices[0]!.zMm).toBeCloseTo(0.05, 12);
    });
  });

  describe("§ 6az.9 — the two convergences, separated", () => {
    it("the AXIAL rule is the midpoint rule, order 2, with no edge to hide it", () => {
      const frame = tile(SYSTEM, OFF, 128);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, OFF);
      const w = frame.objectHalfExtentMm * 0.3;
      const H = w * 2;
      // Smooth across the grid and a POLYNOMIAL in depth: the lateral sum is the
      // same number on every slice, so what the slice count converges is the
      // midpoint rule alone and its order is a fact about the rule.
      const density = (x: number, y: number, z: number): number =>
        Math.abs(z) <= H ? Math.exp((-2 * (x * x + y * y)) / (w * w)) * (1 - (z * z) / (H * H)) : 0;
      const counts = [4, 8, 16, 32, 64];
      const fluxes = counts.map(
        (n) =>
          rasterizeEmitterVolume(frame, density, {
            radialMap,
            rescale,
            slabs: uniformSlabs(-H, H, n),
          }).emittedFlux,
      );
      // The lateral quadrature's own bias does not move with the slice count, so
      // it cancels out of successive differences — Richardson's argument, and it
      // is what isolates the axial rule from everything else in the raster.
      const gaps: number[] = [];
      for (let i = 1; i < fluxes.length; i++) gaps.push(Math.abs(fluxes[i]! - fluxes[i - 1]!));
      const order = -logSlope(
        counts.slice(1).map((n) => Math.log(n)),
        gaps.map((g) => Math.log(g)),
      );
      expect(order).toBeGreaterThan(1.9);
      expect(order).toBeLessThan(2.1);
    });

    it("and the ball's flux lands on (4/3)·pi·R³, the sphere's own volume", () => {
      const frame = tile(SYSTEM, OFF, 256);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, OFF);
      const R = frame.objectHalfExtentMm * 0.5;
      const flux = rasterizeEmitterVolume(frame, sphereEmitter({ radiusMm: R, density: 1 }), {
        radialMap,
        rescale,
        slabs: uniformSlabs(-R, R, 64),
      }).emittedFlux;
      const exact = (4 / 3) * Math.PI * R * R * R;
      expect(Math.abs(flux / exact - 1)).toBeLessThan(1e-2);
    });

    it("the LATERAL residual is the lattice, and a single placement has no rate", () => {
      const sizes = [64, 128, 256];
      const offsets = [0, 0.25, 0.5, 0.75];
      const averaged: number[] = [];
      const spread: number[] = [];
      for (const size of sizes) {
        const frame = tile(SYSTEM, OFF, size);
        const radialMap = mapFor(SYSTEM, frame);
        const rescale = depthRescale(SYSTEM, OFF);
        const R = frame.objectHalfExtentMm * 0.5;
        const exact = (4 / 3) * Math.PI * R * R * R;
        let sum = 0;
        let lo = Infinity;
        let hi = 0;
        for (const o of offsets) {
          const shift = o * frame.objectPixelScaleMm;
          const flux = rasterizeEmitterVolume(
            frame,
            sphereEmitter({
              radiusMm: R,
              density: 1,
              centreMm: { x: shift, y: shift, z: 0 },
            }),
            { radialMap, rescale, slabs: uniformSlabs(-R, R, 64) },
          ).emittedFlux;
          const rel = Math.abs(flux / exact - 1);
          sum += rel;
          lo = Math.min(lo, rel);
          hi = Math.max(hi, rel);
        }
        averaged.push(sum / offsets.length);
        spread.push(hi / lo);
      }
      // § 5v.5 refused a rate for a SINGLE placement and was right to: the
      // lattice discrepancy is an accident of where the edge falls, and § 6as.4
      // had to average over sub-pixel offsets before it became a law. Averaged,
      // it falls monotonically — and NO exponent is claimed for it, because a
      // ball's residual carries the axial rule's error as well as the lattice's
      // and the two do not separate by refining one axis.
      for (let i = 1; i < averaged.length; i++) {
        expect(averaged[i]!).toBeLessThan(averaged[i - 1]!);
      }
      expect(averaged[averaged.length - 1]!).toBeLessThan(averaged[0]! / 2);
      // And the accident itself is measured rather than inherited as an
      // argument: at a fixed grid the residual depends on where the edge falls
      // between the samples, so four sub-pixel placements of the SAME ball
      // disagree with each other by more than the whole refinement buys.
      expect(Math.max(...spread)).toBeGreaterThan(2);
    });
  });

  describe("§ 6az.10 — a Gaussian ball has no edge, so only truncation is left", () => {
    it("lands on peak·(π/2)^{3/2}·w²·w_z, and the residual falls with the span", () => {
      const frame = tile(SYSTEM, OFF, 256);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, OFF);
      const w = frame.objectHalfExtentMm * 0.25;
      const wz = w * 2;
      const exact = gaussianBallFlux(1, w, wz);
      const residuals: number[] = [];
      for (const spans of [1.5, 2, 2.5, 3]) {
        const flux = rasterizeEmitterVolume(
          frame,
          gaussianBallEmitter({ waistMm: w, axialWaistMm: wz, peak: 1 }),
          { radialMap, rescale, slabs: uniformSlabs(-spans * wz, spans * wz, 128) },
        ).emittedFlux;
        residuals.push(Math.abs(flux / exact - 1));
      }
      // Monotone in the axial span, because with no edge anywhere the only
      // error left is the light the stack does not reach.
      for (let i = 1; i < residuals.length; i++) {
        expect(residuals[i]!).toBeLessThan(residuals[i - 1]!);
      }
      expect(residuals[residuals.length - 1]!).toBeLessThan(2e-3);
    });
  });

  describe("§ 6az.11 — § 6k.6's z-uniform collapse is a TELECENTRIC statement", () => {
    it("a z-uniform specimen puts identical fields on every plane only when k is 0", () => {
      const structured = (x: number, y: number): number =>
        1 + Math.cos((2 * Math.PI * x) / 0.004) * 0.5;

      const telecentric = (() => {
        const frame = tile(SYSTEM, DESIGN, 64);
        return rasterizeEmitterVolume(
          frame,
          slabEmitter({ lateral: structured, fromMm: -1, toMm: 1 }),
          {
            radialMap: mapFor(SYSTEM, frame),
            rescale: depthRescale(SYSTEM, DESIGN),
            slabs: uniformSlabs(-0.5, 0.5, 4),
          },
        );
      })();
      const first = telecentric.slices[0]!.field.values;
      for (const slice of telecentric.slices) {
        for (let i = 0; i < first.length; i++) expect(slice.field.values[i]).toBe(first[i]);
      }

      const levered = (() => {
        const frame = tile(LEVER, DESIGN, 64);
        return rasterizeEmitterVolume(
          frame,
          slabEmitter({ lateral: structured, fromMm: -1, toMm: 1 }),
          {
            radialMap: mapFor(LEVER, frame),
            rescale: depthRescale(LEVER, DESIGN),
            slabs: uniformSlabs(-0.5, 0.5, 4),
          },
        );
      })();
      const base = levered.slices[0]!.field.values;
      let worst = 0;
      for (const slice of levered.slices) {
        for (let i = 0; i < base.length; i++) {
          worst = Math.max(worst, Math.abs(slice.field.values[i]! / base[i]! - 1));
        }
      }
      // Not a rounding difference: the planes are different samplings of the
      // same specimen, so `hazeKernel`'s exact collapse does not apply here.
      expect(worst).toBeGreaterThan(1e-2);
      // The stack's outermost MIDPOINT is 0.375 mm, not its edge at 0.5.
      expect(levered.maxStretchDeparture).toBeCloseTo(
        0.375 * depthRescale(LEVER, DESIGN).ratePerMm,
        15,
      );
      expect(telecentric.maxStretchDeparture).toBe(0);
    });
  });

  describe("§ 6az.12 — the volume images through the chain unchanged", () => {
    it("`renderVolume` takes it and every plane delivers its whole flux", () => {
      const frame = tile(SYSTEM, OFF, 64);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, OFF);
      const R = frame.objectHalfExtentMm * 0.35;
      const volume = rasterizeEmitterVolume(
        frame,
        sphereEmitter({ radiusMm: R, density: 1 }),
        { radialMap, rescale, slabs: uniformSlabs(-R, R, 8) },
      );
      const image = renderVolume(volume, defocusing(idealPupil()), {
        pupilSamples: 32,
        numericalAperture: 0.1,
        wavelengthNm: OFF,
      });
      const imaged = total(image.intensity);
      // § 6k.1: a defocus is a pure phase, so every slice's throughput is the
      // same number and the image is the emitted flux times that one factor.
      const throughput = imaged / volume.emittedFlux;
      expect(throughput).toBeGreaterThan(0);
      for (let i = 0; i < image.sliceFlux.length; i++) {
        const emitted = total(volume.slices[i]!.field.values);
        if (emitted === 0) continue;
        expect(image.sliceFlux[i]! / emitted).toBeCloseTo(throughput, 9);
      }
      // and it imaged: the peak fell, because the kernel spread it.
      let peakIn = 0;
      for (const slice of volume.slices) {
        for (const v of slice.field.values) peakIn = Math.max(peakIn, v);
      }
      let peakOut = 0;
      for (const v of image.intensity) peakOut = Math.max(peakOut, v);
      expect(peakOut).toBeLessThan(peakIn * volume.slices.length * throughput);
    });
  });

  describe("§ 6az.13 — refocusing re-rasterizes, and the focal plane is exactly 1", () => {
    it("the stretch is measured from the focus, not from the nominal plane", () => {
      const frame = tile(LEVER, DESIGN, 64);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      // A label uniform across the whole frame and present at every depth: its
      // flux is then the frame's own object area, which is exactly what the
      // stretch scales, so the ratio below is the area factor and nothing else.
      const density = slabEmitter({ lateral: () => 1, fromMm: -1, toMm: 1 });
      const focused = rasterizeEmitterVolume(frame, density, {
        radialMap,
        rescale,
        slabs: oneSlab(0.4, 1e-3),
        focusMm: 0.4,
      });
      expect(focused.maxStretchDeparture).toBe(0);
      expect(focused.focusMm).toBe(0.4);
      // The emitted slice is an offset from focus, so `renderVolume` needs no
      // second copy of the number and cannot double-count it.
      expect(focused.slices[0]!.zMm).toBe(0);

      const unfocused = rasterizeEmitterVolume(frame, density, {
        radialMap,
        rescale,
        slabs: oneSlab(0.4, 1e-3),
      });
      expect(unfocused.maxStretchDeparture).toBeCloseTo(0.4 * rescale.ratePerMm, 15);
      // A focus series is a series of different rescales, so the two are not
      // the same volume seen twice: the same specimen and the same slab, and a
      // larger flux unfocused, because the frame covers more of a label that
      // has no edge inside it. The ratio is the area factor, exactly.
      const st = 1 + 0.4 * rescale.ratePerMm;
      expect(focused.emittedFlux).toBeGreaterThan(0);
      expect(unfocused.emittedFlux / focused.emittedFlux).toBeCloseTo(st * st, 12);
    });
  });

  describe("§ 6az.14 — the refusals", () => {
    it("an infinite conjugate has no depth", () => {
      const infinite: OpticalSystem = { ...SYSTEM, conjugate: { kind: "infinite" } };
      expect(() => depthRescale(infinite, DESIGN)).toThrow(/no object plane/);
    });

    it("a stack with no slices, and depths that do not match their thicknesses", () => {
      const frame = tile(SYSTEM, DESIGN, 64);
      const radialMap = mapFor(SYSTEM, frame);
      const rescale = depthRescale(SYSTEM, DESIGN);
      expect(() =>
        rasterizeEmitterVolume(frame, () => 1, {
          radialMap,
          rescale,
          slabs: { depthsMm: [], thicknessMm: [] },
        }),
      ).toThrow(/no slices/);
      expect(() =>
        rasterizeEmitterVolume(frame, () => 1, {
          radialMap,
          rescale,
          slabs: { depthsMm: [0, 1], thicknessMm: [1] },
        }),
      ).toThrow(/must not brighten/);
    });

    it("a slice at the entrance pupil, where no chief ray reaches the optics", () => {
      const frame = tile(LEVER, DESIGN, 64);
      const radialMap = mapFor(LEVER, frame);
      const rescale = depthRescale(LEVER, DESIGN);
      // 1 + z·k = 0 at exactly the pupil distance behind the object plane.
      const atPupil = -1 / rescale.ratePerMm;
      expect(() =>
        rasterizeEmitterVolume(frame, () => 1, {
          radialMap,
          rescale,
          slabs: oneSlab(atPupil, 1),
        }),
      ).toThrow(/entrance pupil/);
    });

    it("and the constructors refuse what they cannot integrate", () => {
      expect(() => uniformSlabs(0, 1, 0)).toThrow(/positive integer/);
      expect(() => sphereEmitter({ radiusMm: 0, density: 1 })).toThrow(/radiusMm/);
      expect(() => sphereEmitter({ radiusMm: 1, density: -1 })).toThrow(/non-negative/);
      expect(() => slabEmitter({ lateral: () => 1, fromMm: 1, toMm: 0 })).toThrow(/thickness/);
      expect(() =>
        gaussianBallEmitter({ waistMm: 0, axialWaistMm: 1, peak: 1 }),
      ).toThrow(/waistMm/);
      expect(() =>
        gaussianBallEmitter({ waistMm: 1, axialWaistMm: 0, peak: 1 }),
      ).toThrow(/axialWaistMm/);
    });
  });
});
