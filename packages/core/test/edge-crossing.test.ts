import { describe, it, expect } from "vitest";
import { incoherentPsf, pupilThroughput } from "../src/imaging/fluorescence";
import { formVolumePlane, neutralVolumeEmitterDensity } from "../src/imaging/spectral-volume";
import { slabEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { gaussianEmitter } from "../src/imaging/emitter-density";
import { fieldPupilAt, objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { PupilFunction } from "../src/wave/psf";
import { exactPupilEnergy } from "./support/exitEnergy";

/**
 * § 2q.4 — the edge is located, not counted.
 *
 * § 2q.3 resolved a cut cell by asking the pupil at an 8×8 sub-grid, and the
 * count of an outline on a lattice is off by a few 1e-4 of the light. On the aim
 * layout that error is the same in every frame — one circle at every field point
 * and wavelength — and cancels in their ratios. § 2q's volume flip put the chain
 * on the exit layout, whose outline is the traced rim and changes shape with
 * both, and the error stopped cancelling: across the 4×/0.10's on-axis frame the
 * light passed varied by 1.29e-4, where the light itself (grid-free, § 2l)
 * varies by 2.43e-6. Finer counting converges slowly — 9.5e-5, 3.5e-5, 9.0e-6
 * at 16, 32 and 64 sub-samples. Register item 25 had recorded the same count on
 * `wave/psf`'s grid with "no reading needs it yet"; this was the reading.
 *
 * **Hypothesis:** locate the outline on each strip of a cut cell — bisect every
 * crossing, so a strip's open length is exact — and the error no longer moves
 * with the outline. **Refuted by** a near-circular ellipse whose area, moved by
 * sub-cell offsets and turned, still spreads by more than 1e-7 of πab, or a real
 * frame on the exit layout whose span stays more than 3% from the grid-free one.
 *
 * External numbers: an ellipse's area πab; a disc cut by a chord, πr² less the
 * circular segment r²·acos(d/r) − d·√(r² − d²); a disc's area π; the best focus
 * of a disc with spherical aberration, −w40 exactly (§ 2q.3); and the traced
 * pupil's light integrated with no grid at all (`exactPupilEnergy`, § 2l).
 */

type Rule = "count" | "crossing";
const EDGE = 8;

/** The light a pupil passes on this lattice, in pupil units: Σ⟨A²⟩ over its cells × step². */
function area(pupil: PupilFunction, ps: number, rule: Rule, edgeSamples = EDGE): number {
  const size = 2 ** Math.ceil(Math.log2(Math.max(64, ps + 3)));
  const k = incoherentPsf(pupil, { pupilSamples: ps, size, edgeSamples, edgeRule: rule });
  const step = 2 / ps;
  return k.energy * step * step;
}

/** |∫P dA| off the kernel's centre less its floor — § 2q.3's `integral`, so the field path is read too. */
function fieldIntegral(pupil: PupilFunction, ps: number, rule: Rule): number {
  const size = 2 ** Math.ceil(Math.log2(Math.max(64, ps + 3)));
  const k = incoherentPsf(pupil, { pupilSamples: ps, size, edgeSamples: EDGE, edgeRule: rule });
  const step = 2 / ps;
  return Math.sqrt((k.values[0]! - (k.edgeFloor ?? 0)) * size * size * k.energy) * step * step;
}

/** An ellipse with semi-axes a, b, centred at (cx, cy) and turned by θ. */
const ellipse = (a: number, b: number, cx: number, cy: number, theta: number): PupilFunction => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    amplitude: (x, y) => {
      const u = (x - cx) * c + (y - cy) * s;
      const v = -(x - cx) * s + (y - cy) * c;
      return (u / a) ** 2 + (v / b) ** 2 <= 1 ? 1 : 0;
    },
    phaseWaves: () => 0,
  };
};

/** A disc of radius 0.9 about (cx, cy), cut by the chord x − cx = d. */
const clipped = (d: number, cx: number, cy: number): PupilFunction => ({
  amplitude: (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= 0.81 && x - cx <= d ? 1 : 0),
  phaseWaves: () => 0,
});

/** A unit disc with W = w20·ρ² + w40·ρ⁴ waves. */
const disc = (w20: number, w40: number): PupilFunction => ({
  amplitude: (x, y) => (x * x + y * y <= 1 ? 1 : 0),
  phaseWaves: (x, y) => {
    const r2 = x * x + y * y;
    return w20 * r2 + w40 * r2 * r2;
  },
});

const LATTICES = [24, 47, 48, 64];

describe("§ 2q.4 — the edge is located, not counted", () => {
  it("the default is § 2q.3's count, bitwise, and the rule needs a sub-grid to read", () => {
    const pupil = disc(0.7, -0.4);
    const plain = incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: EDGE });
    const count = incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: EDGE, edgeRule: "count" });
    for (let i = 0; i < plain.values.length; i++) {
      expect(Object.is(count.values[i], plain.values[i])).toBe(true);
    }
    expect(Object.is(count.energy, plain.energy)).toBe(true);
    expect(Object.is(count.formedSum, plain.formedSum)).toBe(true);
    // On, the bookkeeping keeps its meaning: the same cells are resolved.
    const crossing = incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: EDGE, edgeRule: "crossing" });
    expect(crossing.edgeCells).toBe(plain.edgeCells);
    expect(crossing.transmittingSamples).toBe(plain.transmittingSamples);
    expect(() => incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeRule: "crossing" })).toThrow(/edgeSamples > 1/);
    expect(() =>
      incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: EDGE, edgeRule: "nearest" as Rule }),
    ).toThrow(/"count" or "crossing"/);
  });

  it("an ellipse moved and turned against the lattice keeps its area πab, where the count does not", () => {
    // 1.003 to one: the near-circle a traced rim is. Measured: located, at most
    // 1.8e-8 at 24 samples and under 2.5e-9 from 47 up, spread no wider; counted,
    // 1.9e-4 to 5.0e-4, spread 3.4e-4 to 6.8e-4 — the shape moving the error.
    for (const ps of LATTICES) {
      const step = 2 / ps;
      const a = 0.9;
      const b = 0.9 / 1.003;
      const located: number[] = [];
      const counted: number[] = [];
      const field: number[] = [];
      for (const f of [0, 0.13, 0.37, 0.5]) {
        for (const theta of [0, 0.3, 1.1]) {
          const p = ellipse(a, b, f * step, 0.61 * f * step, theta);
          located.push(area(p, ps, "crossing") / (Math.PI * a * b) - 1);
          counted.push(area(p, ps, "count") / (Math.PI * a * b) - 1);
          field.push(fieldIntegral(p, ps, "crossing") / (Math.PI * a * b) - 1);
        }
      }
      for (const e of located) expect(Math.abs(e)).toBeLessThan(5e-8);
      for (const e of field) expect(Math.abs(e)).toBeLessThan(5e-8);
      expect(Math.max(...counted.map(Math.abs))).toBeGreaterThan(1.5e-4);
      expect(Math.max(...counted) - Math.min(...counted)).toBeGreaterThan(3e-4);
    }
  });

  it("a disc cut by a chord keeps the segment's closed form — the second outline a clip draws", () => {
    // Measured: located, 3.1e-7 to 2.1e-6 — the clip's corner, where the two
    // outlines meet and a strip's open length kinks inside the cell; counted,
    // 1.9e-3 to 4.9e-3.
    const segment = (r: number, d: number) => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
    for (const ps of LATTICES) {
      const step = 2 / ps;
      const counted: number[] = [];
      for (const d of [0.2, 0.55, 0.8]) {
        for (const f of [0, 0.29]) {
          const exact = Math.PI * 0.81 - segment(0.9, d);
          const p = clipped(d, f * step, 0.4 * f * step);
          expect(Math.abs(area(p, ps, "crossing") / exact - 1)).toBeLessThan(5e-6);
          counted.push(Math.abs(area(p, ps, "count") / exact - 1));
        }
      }
      expect(Math.max(...counted)).toBeGreaterThan(1e-3);
    }
  });

  it("the open disc's area is π on § 2q.3's ten lattices, to 1e-8", () => {
    // § 2q.3's count reached 3.4e-4 here; located, 3.7e-9 at worst.
    for (const ps of [32, 40, 47, 48, 49, 56, 64, 80, 96, 127]) {
      expect(Math.abs(fieldIntegral(disc(0, 0), ps, "crossing") / Math.PI - 1)).toBeLessThan(1e-8);
    }
  });

  it("the phase rides the located edge: a disc with w40 = 0.5 focuses at −w40, converging", () => {
    // The w20 maximizing the kernel's centre, by golden section to 1e-9 waves.
    const bestFocusWaves = (w40: number, ps: number): number => {
      const size = 2 ** Math.ceil(Math.log2(Math.max(64, ps + 3)));
      const f = (w20: number) => {
        const k = incoherentPsf(disc(w20, w40), { pupilSamples: ps, size, edgeSamples: EDGE, edgeRule: "crossing" });
        return (k.values[0]! - (k.edgeFloor ?? 0)) * k.energy;
      };
      const g = (Math.sqrt(5) - 1) / 2;
      let a = -w40 - 0.4;
      let b = -w40 + 0.4;
      let c = b - g * (b - a);
      let d = a + g * (b - a);
      let fc = f(c);
      let fd = f(d);
      while (b - a > 1e-9) {
        if (fc > fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - g * (b - a);
          fc = f(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + g * (b - a);
          fd = f(d);
        }
      }
      return (a + b) / 2;
    };
    // Measured 4.15, 3.79, 3.26, 2.37, 1.80, 1.15 (×1e-4) at 48, 56, 64, 80, 96,
    // 127 — § 2q.3's count read the same size: what is left is the interior
    // lattice's own sampling of the phase, not the edge.
    const falling = [48, 56, 64, 80, 96, 127].map((ps) => bestFocusWaves(0.5, ps) + 0.5);
    for (const e of falling) expect(Math.abs(e)).toBeLessThan(4.5e-4);
    for (let i = 1; i < falling.length; i++) expect(falling[i]!).toBeLessThan(falling[i - 1]!);
  });

  it("a depth stack's flux is still the emitters', on either layout", () => {
    // § 6bb.12's haze: the floor carries what the located cells' mean field does not.
    const system = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
    const haze = slabEmitter({ lateral: gaussianEmitter({ waistMm: 0.012, peak: 1 }), fromMm: -1, toMm: 1 });
    for (const layout of ["aim", "exit"] as const) {
      const imaged: number[] = [];
      let ends: readonly number[] = [];
      for (const count of [3, 6, 12, 24]) {
        const plane = formVolumePlane(
          system,
          neutralVolumeEmitterDensity(haze),
          {
            size: 64,
            pupilSamples: 32,
            layout,
            samples: [],
            slabs: uniformSlabs(-0.06, 0.06, count),
            edgeSamples: EDGE,
            edgeRule: "crossing",
          },
          { nm: 546.074, weight: 1 },
          { x: 0, y: 0 },
        );
        let total = 0;
        for (const v of plane.image.intensity) total += v;
        imaged.push(total);
        if (count === 24) ends = plane.image.sliceFlux;
      }
      for (const t of imaged) expect(Math.abs(t / imaged[0]! - 1)).toBeLessThan(1e-13);
      expect(Math.abs(ends[0]! / ends[11]! - 1)).toBeLessThan(1e-13);
      expect(Math.abs(ends[23]! / ends[11]! - 1)).toBeLessThan(1e-13);
    }
  });

  it("on the exit layout the 4×'s on-axis frame reads the light's own span, not the grid's", () => {
    // The reading that needed it. Sixteen patch pupils across the on-axis frame
    // (24 samples, 550 nm); their light's span grid-free is 2.43e-6. Counted,
    // 1.29e-4; located, 2.478e-6 at 8 sub-samples and 2.481e-6 at 32 — 2% from
    // the grid-free figure on both, the interior lattice's own share, and no
    // longer moving with the sub-grid. On the aim layout all three read 1.97e-8.
    const system = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
    const frame = objectFieldTile(system, {
      size: 64,
      pupilSamples: 24,
      layout: "exit",
      wavelengthNm: 550,
      centreMm: { x: 0, y: 0 },
    });
    const located8: number[] = [];
    const located32: number[] = [];
    const counted: number[] = [];
    const heights = new Map<string, number>();
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const fp = fieldPupilAt(system, frame, (px + 0.5) / 4, (py + 0.5) / 4);
        const opts = { pupilSamples: 24, size: 64 };
        located8.push(pupilThroughput(fp.pupil, { ...opts, edgeSamples: 8, edgeRule: "crossing" }));
        located32.push(pupilThroughput(fp.pupil, { ...opts, edgeSamples: 32, edgeRule: "crossing" }));
        counted.push(pupilThroughput(fp.pupil, { ...opts, edgeSamples: 8, edgeRule: "count" }));
        heights.set(fp.objectHeightMm.toFixed(12), fp.objectHeightMm);
      }
    }
    const exact = [...heights.values()].map((h) => exactPupilEnergy(system, h, 550, "exit", { radial: 48, angular: 256 }));
    const span = (xs: number[]) => Math.max(...xs) / Math.min(...xs) - 1;
    const truth = span(exact);
    expect(truth).toBeCloseTo(2.428e-6, 8);
    expect(Math.abs(span(located8) / truth - 1)).toBeLessThan(0.03);
    expect(Math.abs(span(located32) / truth - 1)).toBeLessThan(0.03);
    expect(Math.abs(span(located8) / span(located32) - 1)).toBeLessThan(0.01);
    expect(span(counted) / truth).toBeGreaterThan(25);
  });
});
