import { describe, it, expect } from "vitest";
import { incoherentPsf } from "../src/imaging/fluorescence";
import { renderedBestFocus, type FocusSweepOptions } from "../src/imaging/focus-surface";
import { gaussianBallEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 2q.3 — the rim is resolved, not point-sampled.
 *
 * § 2q's volume flip asked for the focus readings at a second grid before
 * restating them, and on the axis, where neither the layout nor the peak
 * readout can move anything, the 4×/0.10's best focus at 430 nm read 0.2140 mm
 * at 48 pupil samples, 0.2070 at 47 and 0.2111 at 56 — a third of a depth of
 * focus, against the 1e-3 mm differences § 6be and § 6bf pin. It did not
 * settle with more samples (0.2086 to 0.2098 over 128–255), it did not move
 * with the image grid (bitwise at 128 and 256), and a ten times finer stage
 * step reproduced it to 3e-5 mm: the rendered image itself moves.
 *
 * `incoherentPsf` point-samples the pupil, on purpose, because § 6i.1 compares
 * it against `abbeImage` to 1e-12. A point-sampled disc is a staircase whose
 * area departs from π by up to 0.9%, and not monotonely; that departure
 * explains 78% of the focus scatter, and the lattices with nodes exactly ON
 * the rim (48, 50, 60) are the rest.
 *
 * **Hypothesis:** resolve the cut cells — each carries the mean of the pupil's
 * complex field over its area — and the scatter becomes a convergence.
 * **Refuted by** an axial focus that still spreads more than 3e-4 mm over
 * 40–127 samples, or does not settle as the lattice grows.
 *
 * External numbers: a disc's area, π; and the on-axis intensity of a disc with
 * spherical aberration, I(w20) = |∫₀¹ exp(2πi(w20·t + w40·t²)) dt|², which the
 * substitution t → 1 − t shows is symmetric about w20 = −w40 — so its best
 * focus is −w40 exactly, with no integral evaluated.
 */

/** A unit disc with W = w20·ρ² + w40·ρ⁴ waves. */
const disc = (w20: number, w40: number): PupilFunction => ({
  amplitude: (x, y) => (x * x + y * y <= 1 ? 1 : 0),
  phaseWaves: (x, y) => {
    const r2 = x * x + y * y;
    return w20 * r2 + w40 * r2 * r2;
  },
});

const EDGE = 8;
const GRIDS = [32, 40, 47, 48, 49, 56, 64, 80, 96, 127];

/**
 * |∫P dA| in pupil units, read off the kernel's centre. `values[0]` is
 * |Σ field|² / (n²·Σ|field|²) and `energy` is Σ|field|², so this needs no FFT
 * convention.
 */
function integral(pupil: PupilFunction, ps: number, size: number, edgeSamples?: number): number {
  const k = incoherentPsf(pupil, {
    pupilSamples: ps,
    size,
    ...(edgeSamples === undefined ? {} : { edgeSamples }),
  });
  const step = 2 / ps;
  return Math.sqrt(k.values[0]! * size * size * k.energy) * step * step;
}

/** The w20 maximizing the kernel's centre, by golden section to 1e-9 waves. */
function bestFocusWaves(w40: number, ps: number, edgeSamples?: number): number {
  const size = 2 ** Math.ceil(Math.log2(Math.max(64, ps + 3)));
  const f = (w20: number) => {
    const k = incoherentPsf(disc(w20, w40), {
      pupilSamples: ps,
      size,
      ...(edgeSamples === undefined ? {} : { edgeSamples }),
    });
    return k.values[0]! * k.energy;
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
}

describe("§ 2q.3 — the rim is resolved, not point-sampled", () => {
  it("off, the kernel is bitwise the point-sampled one", () => {
    const pupil = disc(0.7, -0.4);
    const plain = incoherentPsf(pupil, { pupilSamples: 48, size: 128 });
    const one = incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: 1 });
    for (let i = 0; i < plain.values.length; i++) {
      expect(Object.is(one.values[i], plain.values[i])).toBe(true);
    }
    expect(Object.is(one.energy, plain.energy)).toBe(true);
    expect(Object.is(one.formedSum, plain.formedSum)).toBe(true);
    expect(one.edgeCells).toBeUndefined();

    // On, the point bookkeeping keeps its meaning: the lattice points inside the
    // rim are counted as before, and the cut cells are reported beside them.
    const on = incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: EDGE });
    expect(on.transmittingSamples).toBe(plain.transmittingSamples);
    expect(on.edgeCells).toBeGreaterThan(0);
    expect(() => incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => incoherentPsf(pupil, { pupilSamples: 48, size: 128, edgeSamples: 2.5 })).toThrow(
      /positive integer/,
    );
  });

  it("the open disc's area is π on every lattice, where the staircase misses by up to 0.9%", () => {
    const point: number[] = [];
    const edge: number[] = [];
    for (const ps of GRIDS) {
      point.push(integral(disc(0, 0), ps, 256) / Math.PI - 1);
      edge.push(integral(disc(0, 0), ps, 256, EDGE) / Math.PI - 1);
    }
    // Measured: resolved, at most 3.4e-4 (at 40); point-sampled, −9.15e-3 at 48
    // and +3.49e-3 at 47 — a sign change one sample apart.
    for (const e of edge) expect(Math.abs(e)).toBeLessThan(4e-4);
    expect(point[GRIDS.indexOf(48)]!).toBeLessThan(-9e-3);
    expect(point[GRIDS.indexOf(47)]!).toBeGreaterThan(3e-3);
  });

  it("a disc with spherical aberration focuses at −w40: resolved it converges, point-sampled it scatters", () => {
    const w40 = 0.5;
    const pointAt = (ps: number) => bestFocusWaves(w40, ps) + w40;
    const edgeAt = (ps: number) => bestFocusWaves(w40, ps, EDGE) + w40;

    // The staircase: 4.58e-3 waves at 48 and −1.60e-3 at 47.
    expect(pointAt(48)).toBeGreaterThan(4e-3);
    expect(pointAt(47)).toBeLessThan(-1e-3);

    // Resolved: 3.6e-4 and 3.9e-4 there, and falling steadily from 48 up —
    // 3.90, 3.25, 3.10, 2.38, 1.16, 0.73 (×1e-4) at 48, 56, 64, 80, 96, 127.
    expect(Math.abs(edgeAt(47))).toBeLessThan(4.5e-4);
    const falling = [48, 56, 64, 80, 96, 127].map(edgeAt);
    for (const e of falling) expect(Math.abs(e)).toBeLessThan(4.5e-4);
    for (let i = 1; i < falling.length; i++) expect(falling[i]!).toBeLessThan(falling[i - 1]!);
  });

  it("and the rendered best focus that showed it stops scattering with the lattice", () => {
    // § 2q's own reading: the 4×/0.10 on axis at the design wavelength, swept
    // with § 2q.2's readout on the aim layout, at three lattices one of which
    // has rim nodes (48). Point-sampled 0.048320, 0.047095, 0.047753 mm at 47,
    // 48, 64 — 1.2e-3 apart; resolved 0.047896, 0.047879, 0.047906 — 2.7e-5.
    const system = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
    const sweep = (ps: number, edgeSamples?: number): number => {
      const options: FocusSweepOptions = {
        size: 256,
        pupilSamples: ps,
        layout: "aim",
        peak: "band-limited",
        slabs: uniformSlabs(-0.008, 0.008, 3),
        probe: (centreMm) =>
          gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm }),
        stepMm: 0.005,
        halfMm: 0.03,
        aboutMm: 0.0469,
        maxPlateauDepths: 1e9,
        ...(edgeSamples === undefined ? {} : { edgeSamples }),
      };
      return renderedBestFocus(system, 587.5618, 0, options).focusMm;
    };
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const point = [47, 48, 64].map((ps) => sweep(ps));
    const edge = [47, 48, 64].map((ps) => sweep(ps, EDGE));
    expect(spread(point)).toBeGreaterThan(1e-3);
    expect(spread(edge)).toBeLessThan(5e-5);
  });
});
