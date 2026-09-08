import { describe, it, expect } from "vitest";
import {
  axialSpectrum,
  axialTransfer,
  defocusWaves,
  defocusing,
  depthKernels,
  ewaldConeEdge,
  exactDepthFactor,
  hazeKernel,
  missingConeEdge,
  objectDefocusing,
  objectSinAlpha,
  renderVolume,
  withDefocus,
  withObjectDefocus,
  type DepthPupils,
  type EmitterSlice,
} from "../src/imaging/volume";
import { incoherentPsf, uniformEmitters, type EmitterField } from "../src/imaging/fluorescence";
import { fft2d } from "../src/math/fft";
import { depthOfFocusMm, exactDepthOfFocusMm } from "../src/imaging/emission";
import { idealPupil } from "../src/illumination/transfer";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  tubeLens,
} from "../src/designs/microscope";
import { IMMERSION_MEDIUM, oilImmersionObjective } from "../src/designs/immersion";
import { getMedium } from "../src/materials/catalog";
import {
  imageNumericalAperture,
  objectNumericalAperture,
  sineConditionResidual,
} from "../src/pupil/microscope";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 6k — out-of-focus haze, and the missing cone.
 *
 * § 6i images one plane. A real widefield fluorescence image is dominated by
 * light from emitters that are NOT in the focal plane, and this step builds the
 * volume operator that produces it and pins what it costs.
 *
 * The headline is one fact stated twice. A defocus is a **pure phase**, so it
 * changes no pupil amplitude, so — by Parseval, through the engine's own FFT —
 * the kernel's total is untouched: every plane of a thick specimen delivers its
 * whole flux to the image however far out of focus it is. Transform that
 * constant along the depth axis and it is the **missing cone**: exactly zero
 * axial transfer at zero lateral frequency, which is why deconvolution is
 * ill-posed and why confocal exists.
 *
 * The trap the step had to avoid is § 6j.2's, one layer up: § 6i's kernels are
 * normalized to sum 1, so a null built on THEIR totals would be a null of the
 * normalizer. `IncoherentPsf.formedSum` was added for this, the stack weighs
 * with it, and § 6k.3 carries a negative control — depth-varying pupil
 * amplitude — that breaks the null on demand.
 */

const SIZE = 128;
const PUPIL_SAMPLES = 32;
const LAMBDA = 550;
/** The NA at which one millimetre of depth is exactly one wave of defocus. */
const DEPTH_NA = Math.sqrt(2 * LAMBDA * 1e-6);

const kernelAt = (waves: number, pupilSamples = PUPIL_SAMPLES, size = SIZE) =>
  incoherentPsf(withDefocus(idealPupil(), waves), { size, pupilSamples });

/** [sin(πw)/(πw)]² — the on-axis intensity of a defocused circular pupil. */
const sincSq = (w: number): number => {
  if (w === 0) return 1;
  const a = Math.PI * w;
  return Math.pow(Math.sin(a) / a, 2);
};

/** Fraction of a DC-at-0 kernel inside a radius, in bins. */
const coreFraction = (values: Float64Array, n: number, radiusBins: number): number => {
  let inside = 0;
  for (let y = 0; y < n; y++) {
    const dy = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const dx = x < n / 2 ? x : x - n;
      if (dx * dx + dy * dy <= radiusBins * radiusBins) inside += values[y * n + x]!;
    }
  }
  return inside;
};

/**
 * Defocus, plus an amplitude that genuinely falls off with depth.
 *
 * The one thing in this file that makes `relativeThroughput` vary — nothing in
 * the engine does yet, which is exactly why `DepthPupils` is a callback. Used
 * twice, and for opposite purposes: to break § 6k.3's null on demand, and to
 * give § 6k.6's factoring identity weights that actually have to be right.
 */
const tapered = (fadeWaves: number): DepthPupils => {
  return (waves) => {
    const t = Math.max(0, 1 - Math.abs(waves) / fadeWaves);
    const base = withDefocus(idealPupil(), waves);
    return {
      amplitude: (px, py) => t * base.amplitude(px, py),
      phaseWaves: (px, py) => base.phaseWaves(px, py),
    } satisfies PupilFunction;
  };
};

const din4x = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  }).system;

describe("§ 6k.1 — defocus does not dim, it only spreads", () => {
  const SWEEP = [0, 0.125, 0.25, 0.5, 1, 2, 4, 8];

  it("the kernel's total is EXACTLY invariant, because defocus is a pure phase", () => {
    // The whole step rests on this. `formedSum` is what the kernel summed to
    // before normalization, so it is the thing a stack must weigh with; the
    // pupil's amplitude never moves under defocus, so Σ|P|² never moves, so
    // Parseval carries it through unchanged.
    const reference = kernelAt(0);
    for (const w of SWEEP) {
      const k = kernelAt(w);
      expect(k.formedSum / reference.formedSum).toBeCloseTo(1, 12);
      expect(k.energy).toBe(reference.energy);
      expect(k.transmittingSamples).toBe(reference.transmittingSamples);
    }
  });

  it("and Parseval is the identity that carries it — formedSum·size² = energy", () => {
    // Measured rather than assumed: this is the only place the claim above
    // touches the FFT, and a transform with the wrong normalization would still
    // produce a perfectly plausible kernel.
    for (const w of SWEEP) {
      const k = kernelAt(w);
      expect((k.formedSum * SIZE * SIZE) / k.energy).toBeCloseTo(1, 12);
    }
  });

  it("`relativeThroughput` is exactly 1 across the whole stack", () => {
    const kernels = depthKernels(defocusing(idealPupil()), SWEEP, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    for (const k of kernels) expect(k.relativeThroughput).toBeCloseTo(1, 12);
  });

  it("what moves instead is the axis: sinc²(π·w₂₀), converging as the pupil refines", () => {
    // The closed form, and it is worth two things beyond itself: 8/π² at the
    // quarter wave IS the Rayleigh criterion and § 2b's Maréchal Strehl seen
    // from the axial side, and § 6j's depth of focus is defined so that half of
    // it lands there exactly.
    const relError = (ps: number): number => {
      const peak0 = kernelAt(0, ps).values[0]!;
      let worst = 0;
      for (const w of [0.25, 0.5, 1.5]) {
        const measured = kernelAt(w, ps).values[0]! / peak0;
        worst = Math.max(worst, Math.abs(measured - sincSq(w)) / sincSq(w));
      }
      return worst;
    };
    // 3.5e-2 of the closed form at 16 bins across the pupil and 4.8e-3 at 64 —
    // the residual is the lattice, and it falls when the lattice refines. It is
    // NOT pinned as monotone: § 6i.2 showed this transfer is a lattice point
    // COUNT, so its departure wanders with the Gauss circle problem rather than
    // decreasing smoothly, and 96 bins is worse than 64.
    expect(relError(16)).toBeLessThan(0.08);
    expect(relError(64)).toBeLessThan(0.005);
    expect(relError(64)).toBeLessThan(relError(16) / 5);
  });

  it("a quarter wave of defocus is a Strehl of 8/π² = 0.8106", () => {
    const peak0 = kernelAt(0, 64).values[0]!;
    expect(kernelAt(0.25, 64).values[0]! / peak0).toBeCloseTo(8 / (Math.PI * Math.PI), 2);
  });

  it("at every INTEGER wave the axis is a hard null — all of the light is in the rings", () => {
    const peak0 = kernelAt(0, 64).values[0]!;
    for (const w of [1, 2, 3]) {
      expect(kernelAt(w, 64).values[0]! / peak0).toBeLessThan(1e-5);
      // …while the total has not moved at all. The two statements together are
      // what "haze" means: the light is neither lost nor dimmed, it is put
      // where it carries no detail.
      expect(kernelAt(w, 64).formedSum / kernelAt(0, 64).formedSum).toBeCloseTo(1, 12);
    }
    // The null sharpens as the lattice refines, so it is a zero and not a floor.
    expect(kernelAt(1, 64).values[0]! / kernelAt(0, 64).values[0]!).toBeLessThan(
      kernelAt(1, 16).values[0]! / kernelAt(0, 16).values[0]! / 10,
    );
  });

  it("the total is invariant but no FINITE aperture's share is — which is confocal's opening", () => {
    // The negative control that keeps the invariance from being vacuous. Collect
    // over the whole plane and defocus changes nothing; collect through any
    // finite aperture and it changes everything. A detection pinhole is exactly
    // that aperture, which is why confocal sections and widefield cannot.
    const core = (w: number): number => coreFraction(kernelAt(w).values, SIZE, 8);
    const series = [0, 0.25, 0.5, 0.75, 1, 1.5, 2].map(core);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeLessThan(series[i - 1]!);
    expect(series[0]!).toBeGreaterThan(0.9);
    expect(series[series.length - 1]!).toBeLessThan(0.1);
  });
});

describe("§ 6k.2 — the in-focus fraction belongs to the specimen, not the instrument", () => {
  const slabOf = (count: number, stepMm: number): EmitterSlice[] => {
    const field = uniformEmitters(SIZE, 1);
    const slices: EmitterSlice[] = [];
    for (let i = 0; i < count; i++) {
      slices.push({ zMm: (i - (count - 1) / 2) * stepMm, field });
    }
    return slices;
  };
  const NA = 0.1;
  const dof = depthOfFocusMm(LAMBDA, NA);

  it("every plane delivers the same flux, however deep it sits", () => {
    const image = renderVolume({ size: SIZE, slices: slabOf(9, dof) }, defocusing(idealPupil()), {
      pupilSamples: PUPIL_SAMPLES,
      numericalAperture: NA,
      wavelengthNm: LAMBDA,
    });
    for (const flux of image.sliceFlux) {
      expect(flux / image.sliceFlux[0]!).toBeCloseTo(1, 12);
    }
  });

  it("so a thicker specimen is hazier by arithmetic, and refocusing cannot help", () => {
    const at = (count: number, focusMm = 0): number =>
      renderVolume({ size: SIZE, slices: slabOf(count, dof) }, defocusing(idealPupil()), {
        pupilSamples: PUPIL_SAMPLES,
        numericalAperture: NA,
        wavelengthNm: LAMBDA,
        focusMm,
      }).inFocusFraction;
    // The slices step by a full depth of focus, so exactly one of them lies
    // within ±½ DOF of any plane the objective is focused on.
    expect(at(3)).toBeCloseTo(1 / 3, 12);
    expect(at(9)).toBeCloseTo(1 / 9, 12);
    expect(at(27)).toBeCloseTo(1 / 27, 12);
    // Refocusing onto another plane changes WHICH slice is in focus and nothing
    // else — the fraction is the same, because every plane's flux is the same.
    expect(at(9, dof)).toBeCloseTo(1 / 9, 12);
    expect(at(9, 2 * dof)).toBeCloseTo(1 / 9, 12);
  });

  it("and the image's total light does not depend on where the objective is focused", () => {
    const total = (focusMm: number): number => {
      const image = renderVolume(
        { size: SIZE, slices: slabOf(9, dof) },
        defocusing(idealPupil()),
        {
          pupilSamples: PUPIL_SAMPLES,
          numericalAperture: NA,
          wavelengthNm: LAMBDA,
          focusMm,
        },
      );
      let s = 0;
      for (let i = 0; i < image.intensity.length; i++) s += image.intensity[i]!;
      return s;
    };
    expect(total(dof) / total(0)).toBeCloseTo(1, 12);
    expect(total(-3 * dof) / total(0)).toBeCloseTo(1, 12);
  });
});

describe("§ 6k.3 — the missing cone, and why it is not the normalizer's doing", () => {
  const STACK = Array.from({ length: 32 }, (_, i) => -8 + i * 0.5);

  it("the axial transfer at zero lateral frequency is a CONSTANT", () => {
    const kernels = depthKernels(defocusing(idealPupil()), STACK, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const transfer = axialTransfer(kernels, 0);
    for (let i = 0; i < transfer.re.length; i++) {
      expect(transfer.re[i]! / transfer.re[0]!).toBeCloseTo(1, 12);
      expect(Math.abs(transfer.im[i]!)).toBeLessThan(1e-12);
    }
  });

  it("so its transform is EXACTLY zero at every axial frequency but DC", () => {
    // The missing cone, and it is § 6k.1 transformed rather than a second fact.
    // Widefield transmits no axial information at all about the specimen's total
    // brightness — so no inversion recovers it, and deconvolution is ill-posed
    // for a structural reason rather than a numerical one.
    const kernels = depthKernels(defocusing(idealPupil()), STACK, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const spectrum = axialSpectrum(axialTransfer(kernels, 0));
    expect(spectrum.magnitude[0]!).toBeGreaterThan(0);
    for (let b = 1; b < spectrum.magnitude.length; b++) {
      expect(spectrum.magnitude[b]! / spectrum.magnitude[0]!).toBeLessThan(1e-12);
    }
  });

  it("and a depth-varying pupil AMPLITUDE breaks it — the control the normalizer would pass", () => {
    // § 6j.2's trap, one layer up: § 6i's kernels are scaled to sum 1, so a null
    // built on THEIR totals would hold whatever the pupils did. This stack
    // weighs by `formedSum`, so a pupil that actually transmits less with depth
    // fills the cone in. Nothing in the engine varies amplitude with depth yet —
    // that is the header's named deferral — which is precisely why `DepthPupils`
    // is a callback.
    const kernels = depthKernels(tapered(12), STACK, { size: SIZE, pupilSamples: PUPIL_SAMPLES });
    const spectrum = axialSpectrum(axialTransfer(kernels, 0));
    let worst = 0;
    for (let b = 1; b < spectrum.magnitude.length; b++) {
      worst = Math.max(worst, spectrum.magnitude[b]! / spectrum.magnitude[0]!);
    }
    // Not a marginal break: an order of magnitude of real support where the
    // pure-defocus stack held 1e-12.
    expect(worst).toBeGreaterThan(0.05);
  });

  it("a non-uniformly spaced stack throws rather than transforming the wrong thing", () => {
    const kernels = depthKernels(defocusing(idealPupil()), [0, 0.5, 1.5], {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(() => axialSpectrum(axialTransfer(kernels, 0))).toThrow(/uniformly spaced/);
  });
});

describe("§ 6k.4 — the cone's boundary, measured on the engine's own stack", () => {
  // dw = 0.25 waves over ±8 puts the axial Nyquist at 2 cycles/wave — twice the
  // largest edge the law predicts — and gives a bin of 1/16 to measure it with.
  const STACK = Array.from({ length: 64 }, (_, i) => -8 + i * 0.25);

  it("μ_max = ν·(2 − ν), at the pupil edge and either side of it", () => {
    const kernels = depthKernels(defocusing(idealPupil()), STACK, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const binWidth = 1 / (0.25 * STACK.length);
    for (const bin of [8, 16, 24]) {
      const nu = (2 * bin) / PUPIL_SAMPLES;
      const spectrum = axialSpectrum(axialTransfer(kernels, bin));
      let peak = 0;
      for (const m of spectrum.magnitude) peak = Math.max(peak, m);
      let edge = 0;
      for (let b = 0; b < spectrum.magnitude.length; b++) {
        if (spectrum.magnitude[b]! > 0.02 * peak) edge = spectrum.cyclesPerWave[b]!;
      }
      // Within one axial bin of the closed form. The 2% threshold is what the
      // ±8-wave truncation costs: the stack is a finite window, so the sharp
      // support edge is convolved with that window's own transform and leaks
      // past it. At 1% the leak is still above the line and the edge reads one
      // bin high at low ν. The threshold is stated because it is part of the
      // measurement, not because it was free.
      expect(Math.abs(edge - missingConeEdge(nu))).toBeLessThanOrEqual(binWidth * 1.001);
    }
  });

  it("the defocus axis has a lattice period, P(ν) = pupilSamples/(4·ν) — so this stack's window is NOT neutral", () => {
    // The pupil is point-sampled, so the phase a defocus w puts between two
    // points separated by ν takes only the values 4·w·ν·k/pupilSamples, and the
    // axial transfer at ν is therefore EXACTLY periodic in w. It is the axial
    // twin of § 6i.2's "the transfer is a point count": a property of the
    // lattice rather than of the optics, and exact rather than approximate.
    for (const pupilSamples of [32, 64]) {
      for (const nu of [0.5, 1, 1.5]) {
        const bin = Math.round((nu * pupilSamples) / 2);
        const period = pupilSamples / (4 * nu);
        const probes = [0, 0.25, 0.5];
        const kernels = depthKernels(
          defocusing(idealPupil()),
          [...probes, ...probes.map((w) => w + period)],
          { size: SIZE, pupilSamples },
        );
        const t = axialTransfer(kernels, bin);
        for (let i = 0; i < probes.length; i++) {
          expect(t.re[i + probes.length]! / t.re[i]!).toBeCloseTo(1, 12);
        }
      }
    }
    // Which makes the window above a choice rather than a neutral setting. This
    // describe block's own ±8-wave stack is TWO periods at ν = 1 and three at
    // ν = 1.5, so the spectrum there is a comb — nonzero only at every second or
    // third bin. The edge measurement above survives it because it reads the
    // envelope through a 2% threshold, and that is exactly what it costs: a
    // curve drawn from those bins is a picket fence rather than the transfer,
    // which is what `packages/app`'s A5 surface found when it tried to plot one.
    const combed = axialSpectrum(
      axialTransfer(
        depthKernels(defocusing(idealPupil()), STACK, { size: SIZE, pupilSamples: PUPIL_SAMPLES }),
        PUPIL_SAMPLES / 2,
      ),
    );
    let peak = 0;
    for (const m of combed.magnitude) peak = Math.max(peak, m);
    // Two periods in the window ⇒ the odd bins are empty, and not merely small.
    for (let b = 1; b < combed.magnitude.length; b += 2) {
      expect(combed.magnitude[b]! / peak).toBeLessThan(1e-12);
    }
    // A window inside one period fills them in, at the same step and so the same
    // Nyquist — the difference is the window and nothing else.
    const inside = axialSpectrum(
      axialTransfer(
        depthKernels(
          defocusing(idealPupil()),
          Array.from({ length: 32 }, (_, i) => -4 + i * 0.25),
          { size: SIZE, pupilSamples: PUPIL_SAMPLES },
        ),
        PUPIL_SAMPLES / 2,
      ),
    );
    let insidePeak = 0;
    for (const m of inside.magnitude) insidePeak = Math.max(insidePeak, m);
    expect(inside.magnitude[1]! / insidePeak).toBeGreaterThan(0.5);
  });

  it("the law closes at both ends — the missing cone, and the lateral cutoff", () => {
    expect(missingConeEdge(0)).toBe(0);
    expect(missingConeEdge(2)).toBe(0);
    expect(missingConeEdge(1)).toBe(1);
    // Symmetric about the pupil edge, which is where the support reaches
    // furthest in z: a widefield microscope sections best at mid frequencies and
    // not at all at low ones.
    expect(missingConeEdge(0.5)).toBeCloseTo(missingConeEdge(1.5), 12);
  });
});

describe("§ 6k.5 — the defocused OTF against an independent quadrature", () => {
  /**
   * The closed form the boundary is derived from, evaluated a different way.
   *
   * A defocus w₂₀ puts 2·w₂₀·(u·ν) waves between two pupil points separated by
   * ν, so the overlap integral collapses to one dimension against the overlap's
   * own chord profile g(t) = 2√(1 − (|t| + ν/2)²). Trapezoid, because the point
   * of the rung is that it shares no code with the engine's 2-D FFT.
   */
  const quadratureOtf = (nu: number, waves: number, steps = 40_001): number => {
    const half = 1 - nu / 2;
    let acc = 0;
    let norm = 0;
    const h = (2 * half) / (steps - 1);
    for (let i = 0; i < steps; i++) {
      const t = -half + i * h;
      const arg = 1 - Math.pow(Math.abs(t) + nu / 2, 2);
      const g = arg > 0 ? 2 * Math.sqrt(arg) : 0;
      const weight = i === 0 || i === steps - 1 ? 0.5 : 1;
      acc += weight * g * Math.cos(4 * Math.PI * waves * nu * t);
      norm += weight * g;
    }
    return Math.abs(acc / norm);
  };

  const engineOtf = (nu: number, waves: number, pupilSamples: number): number => {
    const bin = Math.round((nu * pupilSamples) / 2);
    const at = (w: number): number => {
      const kernels = depthKernels(defocusing(idealPupil()), [w], {
        size: SIZE,
        pupilSamples,
      });
      const t = axialTransfer(kernels, bin);
      return Math.hypot(t.re[0]!, t.im[0]!);
    };
    return at(waves) / at(0);
  };

  it("the engine reproduces it, and the gap closes as the lattice refines", () => {
    const worstAt = (pupilSamples: number): number => {
      let worst = 0;
      for (const nu of [0.25, 0.5]) {
        for (const waves of [0.25, 0.5, 1]) {
          const q = quadratureOtf(nu, waves);
          worst = Math.max(worst, Math.abs(engineOtf(nu, waves, pupilSamples) - q) / q);
        }
      }
      return worst;
    };
    expect(worstAt(64)).toBeLessThan(0.01);
    expect(worstAt(64)).toBeLessThan(worstAt(16));
  });

  it("and it agrees at focus by construction, where it must", () => {
    for (const nu of [0.25, 0.5, 1]) expect(quadratureOtf(nu, 0)).toBeCloseTo(1, 12);
  });
});

describe("§ 6k.6 — over z it does not factor, and the one case where it does", () => {
  const STACK = [-4, -2, -1, 0, 1, 2, 4];
  /**
   * Deliberately the TAPERED pupils, not plain defocus.
   *
   * Under pure defocus every slice has the same throughput, and two operators
   * that both normalize by their own total would then agree by linearity of
   * convolution alone — the rung would pass even for a `renderVolume` that
   * weighted its slices with a constant. Fading the amplitude with depth makes
   * `relativeThroughput` run 0.44 → 1 across this stack, so the two sides agree
   * only if both apply the SAME per-slice weight. Checked by breaking it: with
   * `renderVolume` weighting uniformly, the worst pixel moves to 2.0e-2.
   */
  const pupils = tapered(12);
  const kernels = () =>
    depthKernels(pupils, STACK, { size: SIZE, pupilSamples: PUPIL_SAMPLES });

  /** A field with structure, so a difference between operators can show. */
  const speckle = (seed: number): EmitterField => {
    const values = new Float64Array(SIZE * SIZE);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      values[i] = s / 0x7fffffff;
    }
    return { size: SIZE, values };
  };

  it("a z-UNIFORM specimen collapses to one convolution — exactly", () => {
    // § 6j stacks over kernels and calls it exact because one spectrum
    // multiplies the whole emitter field. The same argument works over z only
    // when the same field sits on every plane, and then it is just as exact.
    const field = speckle(7);
    const haze = hazeKernel(kernels());
    const sliced = renderVolume(
      { size: SIZE, slices: STACK.map((w) => ({ zMm: w, field })) },
      pupils,
      {
        pupilSamples: PUPIL_SAMPLES,
        // 1 mm of depth is exactly 1 wave at this NA, so the volume's slices
        // land on the stack's own defocus samples and the two operators are
        // comparable term by term.
        numericalAperture: DEPTH_NA,
        wavelengthNm: LAMBDA,
      },
    );
    const viaHaze = convolve(field.values, haze.values, SIZE);
    expect(worstRelative(viaHaze, sliced.intensity)).toBeLessThan(1e-12);
  });

  it("a z-VARYING one does not — which is the cost of the third dimension", () => {
    // Different structure on each plane, so there is no common E to pull out of
    // the sum and the volume genuinely costs one convolution per slice.
    const slices = STACK.map((w, i) => ({ zMm: w, field: speckle(11 + i) }));
    const sliced = renderVolume({ size: SIZE, slices }, pupils, {
      pupilSamples: PUPIL_SAMPLES,
      numericalAperture: DEPTH_NA,
      wavelengthNm: LAMBDA,
    });
    // The tempting shortcut: sum the emitters and convolve once with the haze
    // kernel. It conserves light exactly, which is why it needs a real check —
    // energy is not a witness (§ 6g.2's own phrase).
    const summed = new Float64Array(SIZE * SIZE);
    for (const s of slices) {
      for (let i = 0; i < summed.length; i++) summed[i] = summed[i]! + s.field.values[i]!;
    }
    const shortcut = convolve(summed, hazeKernel(kernels()).values, SIZE);
    // Both account for every photon the specimen emitted, each in its own
    // normalization: `hazeKernel` is unit-sum, so the shortcut carries the
    // emitters' own total…
    expect(total(shortcut) / total(summed)).toBeCloseTo(1, 12);
    // …and `renderVolume` keeps the throughput each pupil actually delivered.
    const expected = kernels().reduce(
      (acc, k, i) => acc + k.formedSum * total(slices[i]!.field.values),
      0,
    );
    expect(total(sliced.intensity) / expected).toBeCloseTo(1, 12);
    // …and they still form different images. Which is the point: a check on the
    // light would have passed the shortcut, and the shortcut is wrong.
    expect(worstRelative(shortcut, sliced.intensity)).toBeGreaterThan(1e-3);
  });

  it("the haze kernel is a Riemann sum, so refining the stack does not brighten it", () => {
    const coarse = hazeKernel(
      depthKernels(defocusing(idealPupil()), [-2, 0, 2], {
        size: SIZE,
        pupilSamples: PUPIL_SAMPLES,
      }),
      [2, 2, 2],
    );
    let sum = 0;
    for (const v of coarse.values) sum += v;
    expect(sum).toBeCloseTo(1, 12);
    expect(coarse.formedSum).toBeCloseTo(6, 12);
    expect(() => hazeKernel([])).toThrow(/no kernels/);
  });
});

describe("§ 6k.7 — depth in waves, and the conjugate it is measured in", () => {
  it("half of § 6j's depth of focus is a quarter wave, for every NA and medium", () => {
    for (const [na, n] of [
      [0.1, 1],
      [1.4, 1.515],
      [0.65, 1],
    ] as const) {
      expect(defocusWaves(depthOfFocusMm(LAMBDA, na, n) / 2, na, LAMBDA, n)).toBeCloseTo(0.25, 12);
    }
  });

  it("and the object- and image-side numbers differ by the sine-condition residual, squared", () => {
    // δ′ = δ·M²·n′/n by the longitudinal magnification § 6j pins, and NA′ = NA/|M|
    // by the sine condition, so the M² cancels against the NA² and the waves are
    // conjugate-invariant — EXACTLY as far as the objective is aplanatic. What is
    // left over is therefore the DIN 4×'s own departure from the sine condition,
    // which § 6h already measured at 2.7%, arriving here squared.
    const system = din4x();
    const naObj = objectNumericalAperture(system, LAMBDA);
    const naImg = imageNumericalAperture(system, LAMBDA);
    const residual = sineConditionResidual(system, 0.01, LAMBDA);
    const M = naObj / (naImg * (1 + residual));

    const deltaObjectMm = 1e-3;
    const objectSide = defocusWaves(deltaObjectMm, naObj, LAMBDA);
    const imageSide = defocusWaves(deltaObjectMm * M * M, naImg, LAMBDA);
    expect(imageSide / objectSide).toBeCloseTo(1 / Math.pow(1 + residual, 2), 9);
    expect(Math.abs(residual)).toBeGreaterThan(0.02);
    expect(Math.abs(residual)).toBeLessThan(0.04);
  });

  it("the guards refuse what would otherwise image plausibly", () => {
    expect(() => defocusWaves(1, 0, LAMBDA)).toThrow(/NA must be positive/);
    expect(() => defocusWaves(1, 0.1, 0)).toThrow(/wavelength must be positive/);
    expect(() => defocusWaves(1, 0.1, LAMBDA, 0)).toThrow(/refractive index must be positive/);
    expect(() => depthKernels(defocusing(idealPupil()), [], { size: SIZE, pupilSamples: 8 })).toThrow(
      /no defocus samples/,
    );
    expect(() =>
      renderVolume({ size: SIZE, slices: [] }, defocusing(idealPupil()), {
        pupilSamples: PUPIL_SAMPLES,
        numericalAperture: 0.1,
        wavelengthNm: LAMBDA,
      }),
    ).toThrow(/no slices/);
  });

  it("zero defocus returns the pupil itself, so a focused stack costs nothing extra", () => {
    const pupil = idealPupil();
    expect(withDefocus(pupil, 0)).toBe(pupil);
  });
});

/**
 * § 6k.8 — the exact cap, and the paraboloid that osculates it.
 *
 * § 6k's own last deferral, and the register's item 9: everything above is
 * derived from W = ½·δ·NA²·ρ², a **paraboloid**, where the depth phase is
 * exactly a cap of the Ewald sphere. The two osculate at the axis and part
 * company by 1/cos α, which the register recorded as 2.6× at NA 1.40 in oil
 * without a form to compute it from.
 *
 * The form is one line of angular spectrum. An emitter at depth δ shifts every
 * plane-wave component of its own field by n·δ·cosθ of optical path, and the
 * pupil coordinate IS that component's direction by the sine condition, so
 *
 *     W(ρ) = (n·δ/λ)(1 − √(1 − s²ρ²)) waves,     s = sinα = NA/n
 *
 * with no expansion in either δ or θ. Everything below follows from it, and the
 * paraboloid is not a separate case: it is this expression at s = 0, **bitwise**.
 *
 * The blocker § 6k named — "a wavefront traced through a defocused *object*
 * plane" — is the fifth in a row not to exist, and this one is worth being
 * precise about because it was attempted rather than argued away. An OPD map
 * references its sphere to where the CHIEF ray crosses the image plane and aims
 * rays at the paraxial entrance pupil, so on a system with real aberration the
 * moved sphere couples to the transverse ray error at first order: a reversed
 * 100×/1.40 (0.85 waves rms) gives a residual of 1–3% that is ρ-dependent and
 * does NOT vanish with the shift, which is the objective's aberration and not
 * the cap. The exact form is a statement about plane-wave DIRECTION, and a
 * fixture that isolates it would have to be stigmatic at both the nominal and
 * the displaced conjugate — Herschel's condition, which cannot hold beside the
 * sine condition away from unit magnification. So no cheap fixture exists, and
 * the pins here are closed-form-to-closed-form and engine-measured instead.
 */
describe("§ 6k.8 — the exact cap, and the paraboloid that osculates it", () => {
  /** The engine's own immersion oil, so no index is transcribed. */
  const N_OIL = getMedium(IMMERSION_MEDIUM).n(LAMBDA);
  const S_OIL = 1.4 / N_OIL;
  const COS_ALPHA = Math.sqrt(1 - S_OIL * S_OIL);

  it("at zero aperture angle it IS § 6k.4's paraboloid — a value of this form, not a limit of it", () => {
    // The rationalized form carries s = 0 as an ordinary number rather than as a
    // branch, so the existing law and the existing pupil are this step's own
    // s = 0 members and every rung above keeps its reading by construction. How
    // exactly they are the same differs between the two, and both halves are
    // stated rather than the friendlier one being generalized.
    //
    // The PHASE is **bitwise**, and provably so rather than by luck: 2wρ²/(1+1)
    // and wρ² differ by a multiplication and a division by 2, and scaling by a
    // power of two is exact in binary, so the single rounding lands identically.
    // The EDGE LAW is not — 2(1−a²)/(1+1) and ν(2−ν) are one real number written
    // two ways, and f64 rounds the two spellings differently at some ν:
    // 0.18999999999999995 against 0.19 at ν = 0.1, which is two ulp. So that half
    // reduces to a couple of ulp rather than to the bit, which is said here
    // rather than dodged by testing only friendly frequencies.
    const pupil = idealPupil();
    for (const rho of [0.1, 0.37, 0.5, 0.75, 1]) {
      expect(withObjectDefocus(pupil, 1.7, 0).phaseWaves(rho, 0)).toBe(
        withDefocus(pupil, 1.7).phaseWaves(rho, 0),
      );
    }
    for (const nu of [0.1, 0.25, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 1.9]) {
      const exact = ewaldConeEdge(nu, 0);
      const paraboloid = missingConeEdge(nu);
      expect(Math.abs(exact - paraboloid)).toBeLessThanOrEqual(2 * Number.EPSILON * paraboloid);
    }
  });

  it("and the form the register would have written cannot be computed at all", () => {
    // (2/s²)·[√(1−s²(1−ν)²) − √(1−s²)] is the same number on paper and a
    // difference of two nearly equal roots divided by a vanishing s² in f64. At
    // s = 1e-6 it has already lost four digits, and at s = 0 it is 0/0 — so the
    // rationalization is load-bearing rather than tidy, which is worth a rung
    // because the naive form is what an entry in the register looks like.
    const naive = (nu: number, s: number) =>
      (2 / (s * s)) * (Math.sqrt(1 - s * s * (1 - nu) ** 2) - Math.sqrt(1 - s * s));
    expect(naive(0.5, 1e-6) / missingConeEdge(0.5) - 1).toBeGreaterThan(1e-5);
    expect(Number.isNaN(naive(0.5, 0))).toBe(true);
    // The shipped form is exact where the naive one is wrong, and agrees with it
    // where f64 lets the naive one be right.
    expect(ewaldConeEdge(0.5, 1e-6)).toBeCloseTo(missingConeEdge(0.5), 12);
    for (const s of [0.5, 0.75, 0.9]) {
      expect(ewaldConeEdge(0.5, s) / naive(0.5, s)).toBeCloseTo(1, 12);
    }
  });

  it("the boundary is the cap's own widest chord — maximized directly, no engine in it", () => {
    // ewaldConeEdge claims the widest axial frequency a pair of pupil points can
    // contribute sits at ρ₁ = 1 and ρ₂ = |1−ν|. Here that maximum is searched
    // for instead: over the whole overlap of the two displaced discs, in two
    // dimensions, with the closed form used only to compare against. The 2-D
    // scan also confirms the maximum lies ON the axis, which the derivation
    // asserts and a 1-D search would assume.
    const phase = (rho: number, s: number) => (2 * rho * rho) / (1 + Math.sqrt(1 - s * s * rho * rho));
    /** Widest chord over the overlap, restricted to |y| > `minY`. */
    const brute = (nu: number, s: number, n: number, minY: number) => {
      let best = 0;
      for (let i = 0; i <= n; i++) {
        const x = -1 + (2 * i) / n;
        for (let j = 0; j <= n / 2; j++) {
          const y = (2 * j) / n;
          if (y <= minY) continue;
          const r1 = Math.hypot(x + nu / 2, y);
          const r2 = Math.hypot(x - nu / 2, y);
          if (r1 > 1 || r2 > 1) continue;
          best = Math.max(best, Math.abs(phase(r2, s) - phase(r1, s)));
        }
      }
      return best;
    };
    // On the axis, finely: the maximum sits AT the rim, so a scan converges at
    // O(1/n) rather than O(1/n²) and the resolution has to be spent there.
    const online = (nu: number, s: number, n: number) => {
      let best = 0;
      for (let i = 0; i <= n; i++) {
        const x = -1 + (2 * i) / n;
        const r1 = Math.abs(x + nu / 2);
        const r2 = Math.abs(x - nu / 2);
        if (r1 > 1 || r2 > 1) continue;
        best = Math.max(best, Math.abs(phase(r2, s) - phase(r1, s)));
      }
      return best;
    };
    for (const s of [0.05, 0.5, S_OIL, 0.99]) {
      for (const nu of [0.25, 0.5, 1, 1.5]) {
        expect(online(nu, s, 200_000) / ewaldConeEdge(nu, s)).toBeCloseTo(1, 8);
        // …and off the axis it is never better, which is the half of the
        // derivation a 1-D search would have assumed rather than shown.
        expect(brute(nu, s, 400, 0.05) / online(nu, s, 200_000)).toBeLessThan(1);
      }
    }
  });

  it("it keeps the shape and loses the scale: closed at both ends, symmetric, higher throughout", () => {
    for (const s of [0, 0.5, S_OIL, 0.99]) {
      expect(ewaldConeEdge(0, s)).toBe(0);
      expect(ewaldConeEdge(2, s)).toBe(0);
      expect(ewaldConeEdge(2.5, s)).toBe(0);
      // ν enters only through (1−ν)², so the symmetry about the pupil edge is
      // exact at every aperture — § 6k.4's "sections best at mid frequencies"
      // survives the cap untouched.
      for (const d of [0.25, 0.5, 0.75]) {
        expect(ewaldConeEdge(1 - d, s)).toBeCloseTo(ewaldConeEdge(1 + d, s), 15);
      }
      // Never below the paraboloid, anywhere — strictly above it once there is
      // an aperture angle at all, and equal to it when there is not.
      for (const nu of [0.1, 0.5, 1, 1.5, 1.9]) {
        if (s === 0) {
          expect(Math.abs(ewaldConeEdge(nu, s) - missingConeEdge(nu))).toBeLessThanOrEqual(
            2 * Number.EPSILON * missingConeEdge(nu),
          );
        } else {
          expect(ewaldConeEdge(nu, s)).toBeGreaterThan(missingConeEdge(nu));
        }
      }
    }
    expect(() => ewaldConeEdge(-1, 0.5)).toThrow(/non-negative/);
    // ~~§ 6l.10 moved the s ≥ 1 refusal off `withObjectDefocus` and onto the
    // conversions, and this is the rung that says which side of that line
    // `ewaldConeEdge` fell on. It evaluates √(1 − s²) — the cap AT ρ = 1, the
    // nominal rim — so it is a ρ = 1 object like `exactDepthFactor`, and on a
    // mount that truncates, that rim is dark. Its guard stays.~~ § 6l.11 moved
    // the rim instead: min(1, 1/s) is the nominal rim below the wall and the lit
    // one above it, so the refusal is gone and only a non-finite s is left.
    expect(ewaldConeEdge(1, 1)).toBe(2);
    expect(ewaldConeEdge(1, 1.05)).toBeGreaterThan(0);
    expect(() => ewaldConeEdge(1, Infinity)).toThrow(/sin α/);
    expect(() => ewaldConeEdge(1, NaN)).toThrow(/sin α/);
    expect(() => ewaldConeEdge(1, -0.5)).toThrow(/sin α/);
  });

  it("TWO ratios, not one: 1/cos α at the axis is a LIMIT, and the peak grows by less", () => {
    // The register recorded one number — "2.6× at NA 1.40 in oil" — and it is
    // the slope at ν → 0, where the boundary is a tangent and no measurement can
    // stand. What the engine can see is the peak, and that grows by a different
    // factor. Quoting the 2.6 as though it were the whole curve would overstate
    // the cap by 80% at the frequency a microscope actually sections at.
    const slopeRatio = (nu: number) => ewaldConeEdge(nu, S_OIL) / missingConeEdge(nu);
    expect(1 / COS_ALPHA).toBeCloseTo(2.5903, 4);
    expect(slopeRatio(1e-9)).toBeCloseTo(1 / COS_ALPHA, 6);
    // Monotone climb toward it as the frequency falls — the shape of the limit.
    const climb = [1, 0.5, 0.25, 0.125, 0.0625, 0.01].map(slopeRatio);
    for (let i = 1; i < climb.length; i++) expect(climb[i]!).toBeGreaterThan(climb[i - 1]!);
    expect(climb[climb.length - 1]!).toBeLessThan(1 / COS_ALPHA);
    // The peak, which is what § 6k.4 measures: (2/s²)(1 − cos α).
    expect(ewaldConeEdge(1, S_OIL)).toBeCloseTo((2 * (1 - COS_ALPHA)) / (S_OIL * S_OIL), 14);
    expect(ewaldConeEdge(1, S_OIL)).toBeCloseTo(1.4429, 4);
  });

  it("maximized over the engine's OWN sampled pupil, at four apertures — no window, no threshold", () => {
    // The sharpest engine-side pin available, and it is threshold-free. What the
    // axial transform can carry at lateral bin b is the largest phase slope
    // between two pupil samples b apart, and both members of the extremal pair —
    // the rim and the point |1−ν| in from it — are lattice points when ν = 2b/ps.
    // So the engine's sampled pupil reaches the continuum boundary EXACTLY,
    // rather than approaching it, and `ewaldConeEdge` is checked against a
    // maximization over the same lattice the kernels are built on.
    const phase = (rho2: number, s: number) => (2 * rho2) / (1 + Math.sqrt(1 - s * s * rho2));
    const latticeEdge = (ps: number, bin: number, s: number) => {
      const step = 2 / ps;
      const half = Math.ceil(1 / step);
      let best = 0;
      for (let iy = -half; iy <= half; iy++) {
        const y = iy * step;
        for (let ix = -half; ix <= half; ix++) {
          const x1 = ix * step;
          const x2 = (ix + bin) * step;
          const r1 = x1 * x1 + y * y;
          const r2 = x2 * x2 + y * y;
          if (r1 > 1 || r2 > 1) continue;
          best = Math.max(best, Math.abs(phase(r2, s) - phase(r1, s)));
        }
      }
      return best;
    };
    for (const ps of [64, 128]) {
      for (const s of [0, 0.5, 0.75, S_OIL]) {
        for (const bin of [ps / 8, ps / 4, ps / 2, (3 * ps) / 4]) {
          expect(latticeEdge(ps, bin, s) / ewaldConeEdge((2 * bin) / ps, s)).toBeCloseTo(1, 12);
        }
      }
    }
  });

  it("and the stacks themselves have no support past it, at four apertures", () => {
    // § 6k.4 locates its edge by a 2% threshold on the envelope. **That threshold
    // does not carry over**, and the reason is the rung below: the paraboloid's
    // comb makes half of its bins exactly zero, so the leakage floor a threshold
    // sits on there is not the same object as the cap's. Ported anyway it reads
    // up to 1.1 bins off, which would be a tolerance argument about an estimator
    // rather than a statement about optics.
    //
    // So the boundary is bracketed instead of located, which is what "the 3-D OTF
    // has no support past it" actually says: beyond the law the spectrum is at
    // the leakage floor, and inside it there is real transfer. Two orders of
    // magnitude separate them, and no threshold chooses that.
    const size = 256;
    const ps = 128;
    const step = 0.25;
    const stack = Array.from({ length: 64 }, (_, i) => -8 + i * step);
    const binWidth = 1 / (step * stack.length);
    for (const s of [0, 0.5, 0.75, S_OIL]) {
      const kernels = depthKernels(
        s === 0 ? defocusing(idealPupil()) : objectDefocusing(idealPupil(), s),
        stack,
        { size, pupilSamples: ps },
      );
      let guard = 0;
      for (const k of kernels) guard = Math.max(guard, k.maxGridPhaseStepWaves);
      // Read BEFORE any spectrum is believed — see the sampling rung below.
      expect(guard).toBeLessThan(0.63);
      for (const bin of [16, 32, 64, 96]) {
        const nu = (2 * bin) / ps;
        const law = ewaldConeEdge(nu, s);
        const spectrum = axialSpectrum(axialTransfer(kernels, bin));
        let peak = 0;
        for (const m of spectrum.magnitude) peak = Math.max(peak, m);
        let outside = 0;
        let inside = 0;
        for (let b = 0; b < spectrum.magnitude.length; b++) {
          const f = spectrum.cyclesPerWave[b]!;
          const rel = spectrum.magnitude[b]! / peak;
          if (f > law + binWidth) outside = Math.max(outside, rel);
          if (f > 0.5 * law && f < law - binWidth) inside = Math.max(inside, rel);
        }
        // The law MOVES with the aperture — at ν = 1 it runs 1.0000 → 1.0718 →
        // 1.2038 → 1.4429 across these four — so a boundary that was really
        // ν(2−ν) would put a third of the cap's support outside this bracket.
        expect(outside).toBeLessThan(0.025);
        expect(inside).toBeGreaterThan(0.4);
      }
    }
  });

  it("the cap costs 1/cos α in pupil SAMPLING too, which is why § 6k.4's stack cannot carry it", () => {
    // The same ratio a third time, and this one is a property of the grid rather
    // than of the transfer: the phase slope at the rim is 2w/cos α where the
    // paraboloid's is 2w, so the exact pupil puts 1/cos α more phase between
    // adjacent samples. At § 6k.4's own settings that is 2.18 waves against 0.97
    // — the paraboloid fits and the cap does not — and the ratio climbs toward
    // 2.5903 as the pupil refines, which is what makes it the same number.
    const stack = Array.from({ length: 64 }, (_, i) => -8 + i * 0.25);
    const guardOf = (pupils: DepthPupils, size: number, pupilSamples: number) => {
      let guard = 0;
      for (const k of depthKernels(pupils, stack, { size, pupilSamples })) {
        guard = Math.max(guard, k.maxGridPhaseStepWaves);
      }
      return guard;
    };
    const flat64 = guardOf(defocusing(idealPupil()), SIZE, PUPIL_SAMPLES);
    const cap64 = guardOf(objectDefocusing(idealPupil(), S_OIL), SIZE, PUPIL_SAMPLES);
    expect(flat64).toBeLessThan(1);
    expect(cap64).toBeGreaterThan(2);
    const flat128 = guardOf(defocusing(idealPupil()), 256, 128);
    const cap128 = guardOf(objectDefocusing(idealPupil(), S_OIL), 256, 128);
    const ratio = cap128 / flat128;
    // Both below the closed form and converging to it from below, since the
    // outermost sample pair straddles the rim rather than sitting on it.
    expect(cap64 / flat64).toBeLessThan(ratio);
    expect(ratio).toBeLessThan(1 / COS_ALPHA);
    expect(ratio).toBeGreaterThan(0.95 / COS_ALPHA);
  });

  it("the defocus axis loses its lattice period — § 6k.4's comb is the paraboloid's", () => {
    // § 6k.4 pins P(ν) = pupilSamples/(4·ν) and calls it a property of the
    // lattice rather than of the optics. Half of that is now withdrawn: it is a
    // property of the lattice AND of the paraboloid, which is linear in the
    // lattice coordinate and so makes every phase difference commensurate. The
    // cap is not linear in it, and the periodicity does not survive — the same
    // probes that repeat to 1e-12 under the paraboloid come back at 0.01, 0.07
    // and −15 under the cap.
    const ps = 32;
    const period = ps / 4;
    const probes = [0, 0.25, 0.5];
    const at = (pupils: DepthPupils) =>
      axialTransfer(
        depthKernels(pupils, [...probes, ...probes.map((w) => w + period)], {
          size: 256,
          pupilSamples: ps,
        }),
        ps / 2,
      );
    const flat = at(defocusing(idealPupil()));
    const cap = at(objectDefocusing(idealPupil(), S_OIL));
    let worst = 0;
    for (let i = 0; i < probes.length; i++) {
      expect(flat.re[i + probes.length]! / flat.re[i]!).toBeCloseTo(1, 12);
      worst = Math.max(worst, Math.abs(cap.re[i + probes.length]! / cap.re[i]! - 1));
    }
    expect(worst).toBeGreaterThan(0.9);

    // Which is visible in the spectrum, and makes the cap's measurement the
    // CLEANER of the two: § 6k.4's ±8-wave window is two periods at ν = 1 under
    // the paraboloid, so its odd bins are empty and the curve it draws is a
    // picket fence. The same window under the cap fills them.
    const oddPeak = (pupils: DepthPupils) => {
      const sp = axialSpectrum(
        axialTransfer(
          depthKernels(
            pupils,
            Array.from({ length: 64 }, (_, i) => -8 + i * 0.25),
            { size: 256, pupilSamples: ps },
          ),
          ps / 2,
        ),
      );
      let peak = 0;
      for (const m of sp.magnitude) peak = Math.max(peak, m);
      let odd = 0;
      for (let b = 1; b < sp.magnitude.length; b += 2) odd = Math.max(odd, sp.magnitude[b]! / peak);
      return odd;
    };
    expect(oddPeak(defocusing(idealPupil()))).toBeLessThan(1e-12);
    expect(oddPeak(objectDefocusing(idealPupil(), S_OIL))).toBeGreaterThan(0.5);
  });

  it("§ 6k.7 keeps its statement and gains a condition: the invariance is the PARABOLOID's", () => {
    // § 6k.7 pins that `defocusWaves` reads the same on both sides of the
    // objective — M² cancels NA² and n cancels n′ — and concludes that a caller
    // may author a depth in object-space millimetres while the engine defocuses
    // the image-side pupil. Every word of that survives, and it is a statement
    // about ONE NUMBER rather than about the wavefront that number scales.
    //
    // s does not cancel. It is NA/n on the side it is measured, and the two
    // sides of a 100×/1.40 are not remotely the same aperture: the exact phase
    // at the rim is 43% above the paraboloid on the specimen side and 0.005%
    // above it on the camera side. So "shift the specimen by δ" and "shift the
    // camera by the conjugate δ′" are the same number of waves and different
    // wavefronts, and the paraboloid is exactly what hides the difference.
    const system = infinityCorrectedMicroscope({
      objective: oilImmersionObjective({
        magnification: 100,
        numericalAperture: 1.4,
        tubeFocalLengthMm: 200,
      }),
      tubeLens: tubeLens({ focalLengthMm: 200 }),
      objectHeightsMm: [0, 0.002],
    }).system;
    const nObject = getMedium(system.prescription.objectMedium ?? "AIR").n(LAMBDA);
    const lastMedium = system.prescription.surfaces[system.prescription.surfaces.length - 1]!.medium;
    const nImage = getMedium(lastMedium ?? "AIR").n(LAMBDA);
    const sObject = objectNumericalAperture(system, LAMBDA) / nObject;
    const sImage = imageNumericalAperture(system, LAMBDA) / nImage;
    expect(sObject).toBeCloseTo(0.9191, 3);
    expect(sImage).toBeCloseTo(0.014439, 5);
    expect(sObject / sImage).toBeGreaterThan(60);

    const pupil = idealPupil();
    const rim = (s: number) => withObjectDefocus(pupil, 1, s).phaseWaves(1, 0);
    expect(withDefocus(pupil, 1).phaseWaves(1, 0)).toBe(1);
    expect(rim(sObject)).toBeCloseTo(1.4346, 4);
    expect(rim(sImage)).toBeCloseTo(1.0000521, 7);
    // The two exact wavefronts differ from each other by more than a third of a
    // wave per wave of defocus, which is what § 6k.7's invariance does not say.
    expect(rim(sObject) - rim(sImage)).toBeGreaterThan(0.43);
  });

  it("still a pure phase, so § 6k.1's flux invariance and § 6k.3's empty cone survive it", () => {
    // The cap changes where the light goes and not how much of it there is, so
    // the two results the whole step rests on are untouched at any aperture —
    // and they have to be checked rather than assumed, because a wavefront that
    // outran the grid could lose light without any amplitude changing.
    const stack = [-4, -2, 0, 2, 4];
    const kernels = depthKernels(objectDefocusing(idealPupil(), S_OIL), stack, {
      size: 256,
      pupilSamples: 128,
    });
    for (const k of kernels) expect(k.relativeThroughput).toBeCloseTo(1, 12);
    const spectrum = axialSpectrum(
      axialTransfer(
        depthKernels(
          objectDefocusing(idealPupil(), S_OIL),
          Array.from({ length: 32 }, (_, i) => -4 + i * 0.25),
          { size: 256, pupilSamples: 128 },
        ),
        0,
      ),
    );
    for (let b = 1; b < spectrum.magnitude.length; b++) {
      expect(spectrum.magnitude[b]! / spectrum.magnitude[0]!).toBeLessThan(1e-12);
    }
  });

  it("zero defocus returns the pupil itself here too", () => {
    const pupil = idealPupil();
    expect(withObjectDefocus(pupil, 0, S_OIL)).toBe(pupil);
    expect(objectDefocusing(pupil, S_OIL)(0)).toBe(pupil);
  });
});

/**
 * § 6k.9 — the engine chooses the cap, and the band it counts as focus.
 *
 * § 6k.8 wrote the exact depth phase and left it unreachable: `renderVolume` is
 * handed a `DepthPupils` with the choice already sealed inside it, while holding
 * the NA, the index and the wavelength the whole time. So a caller got the cap
 * only by computing sin α itself and remembering which side it belongs to, and
 * the one place that knows the aperture had no say. This step wires the choice
 * to the objective's own NA, and the wiring turns out to be the smaller half.
 *
 * The larger half is that the paraboloid was setting more than the wavefront.
 * `inFocusFraction` counts the light inside ±½·n·λ/NA², which is where the
 * PARABOLOID spends a quarter wave at the rim. The exact wavefront spends it
 * sooner — by exactly the reciprocal of its steeper rim, (1 + cos α)/2 — so on
 * an oil 1.40 the band that deserves the name is **295 nm and not 426**, and
 * § 6k.2's reading of how much light is genuinely in focus was 44% generous. One
 * criterion on two wavefronts, not a second criterion: the factor is the same
 * expression as the phase, so the band and the wavefront cannot drift apart.
 *
 * Nothing already recorded moves, and that is a measurement rather than a hope.
 * The exact band is reported BESIDE the old one instead of replacing it, and at
 * the aperture every rung above was taken at — NA 0.10 — the two pictures differ
 * by 2.2e-3 of peak and the two bands by 0.25%. At NA 1.40 in oil the same
 * comparison is 0.289 of peak. The paraboloid is not a small error that was
 * tolerable; it is an error that is invisible at low aperture and a third of the
 * picture at high, which is the shape § 6k.8 found in the phase and this step
 * finds again in everything the phase feeds.
 */
describe("§ 6k.9 — the engine chooses the cap, and the band it counts as focus", () => {
  const N_OIL = getMedium(IMMERSION_MEDIUM).n(LAMBDA);
  const S_OIL = objectSinAlpha(1.4, N_OIL);
  const OIL = {
    pupilSamples: PUPIL_SAMPLES,
    numericalAperture: 1.4,
    wavelengthNm: LAMBDA,
    refractiveIndex: N_OIL,
  };
  const AIR = { pupilSamples: PUPIL_SAMPLES, numericalAperture: 0.1, wavelengthNm: LAMBDA };
  /** One emitter, so the two kernels have something to disagree about. A uniform
   *  field cannot see this at all: every kernel here sums to 1 and a constant
   *  convolved with any of them is the same constant, which is worth saying
   *  because § 6k.2's own slab is exactly that specimen. */
  const bead = (): EmitterField => {
    const values = new Float64Array(SIZE * SIZE);
    values[0] = 1;
    return { size: SIZE, values };
  };
  const stackOf = (stepMm: number, field: EmitterField): EmitterSlice[] =>
    [-2, -1, 0, 1, 2].map((k) => ({ zMm: k * stepMm, field }));

  it("sin α is NA/n, and an aperture the medium cannot carry is refused rather than clamped", () => {
    expect(objectSinAlpha(1.4, N_OIL)).toBe(1.4 / N_OIL);
    expect(objectSinAlpha(0.1)).toBe(0.1);
    // NA ≥ n is what an image-side NA paired with an object-side index looks
    // like, and what a dry objective engraved 1.2 looks like. Clamping it to 1
    // would return a number for a cone that does not exist.
    expect(() => objectSinAlpha(1.4)).toThrow(/index above it/);
    expect(() => objectSinAlpha(1.4, 1.4)).toThrow(/index above it/);
    expect(() => objectSinAlpha(0, 1.5)).toThrow(/NA/);
    expect(() => objectSinAlpha(0.5, 0)).toThrow(/refractive index/);
    // `objectSinAlpha` keeps that refusal because it is the BARE pupil's
    // conversion — § 6l.10's rule, and `objectDefocusing` is the door it guards.
    // ~~`exactDepthFactor` refuses the same s~~: since § 6l.11 it reads the rim
    // the light reaches instead, so it answers at s ≥ 1 and refuses only what is
    // not a number at all.
    expect(exactDepthFactor(1)).toBe(0.5);
    expect(() => exactDepthFactor(Infinity)).toThrow(/sin α/);
    expect(() => exactDepthFactor(NaN)).toThrow(/sin α/);
    expect(() => exactDepthFactor(-1e-300)).toThrow(/sin α/);
  });

  it("the band and the rim phase are ONE statement: (1+cos α)/2 is the reciprocal of the other", () => {
    // `exactDepthFactor` is not a second derivation of the quarter-wave depth —
    // it is the reciprocal of `withObjectDefocus`'s own rim value per wave of
    // `defocusWaves`, which is what makes it impossible for the band and the
    // wavefront to disagree. Checked as an identity at five apertures, including
    // the s = 0 member where it is exact rather than close.
    const rim = (s: number): number => withObjectDefocus(idealPupil(), 1, s).phaseWaves(1, 0);
    expect(exactDepthFactor(0) * rim(0)).toBe(1);
    for (const s of [0.05, 0.5, S_OIL, 0.99]) {
      expect(exactDepthFactor(s) * rim(s)).toBeCloseTo(1, 15);
    }
    // § 6k.8 records the oil 1.40's rim as 1.4429 waves per wave of defocus.
    // The band is that number upside down, which is the cross-pin: two rungs on
    // one closed form rather than two measurements that happen to agree.
    expect(1 / exactDepthFactor(S_OIL)).toBeCloseTo(1.4429, 4);
    expect(exactDepthFactor(S_OIL)).toBeCloseTo(0.69303, 5);
    expect(exactDepthFactor(objectSinAlpha(0.1))).toBeCloseTo(0.997494, 6);
  });

  it("so the exact depth of focus is the paraboloid's shrunk by it, bitwise so at a vanishing aperture", () => {
    // Routed through `depthOfFocusMm` rather than respelled, so there is one
    // spelling of n·λ/NA² in the engine and this cannot drift from it.
    expect(exactDepthOfFocusMm(LAMBDA, 1.4, N_OIL)).toBe(
      depthOfFocusMm(LAMBDA, 1.4, N_OIL) * exactDepthFactor(S_OIL),
    );
    // 426 nm against 295 — the number a microscopist would call the depth of
    // field of an oil 1.40, and it is 31% shorter than the ladder has said.
    expect(depthOfFocusMm(LAMBDA, 1.4, N_OIL) * 1e6).toBeCloseTo(425.87, 2);
    expect(exactDepthOfFocusMm(LAMBDA, 1.4, N_OIL) * 1e6).toBeCloseTo(295.14, 2);
    // At a vanishing aperture the factor is 1 and not nearly 1: √1 is exact and
    // so is (1+1)/2, so the whole product is the paraboloid's own bits. The
    // low-aperture ladder is this step's own s → 0 member, by construction.
    expect(exactDepthFactor(0)).toBe(1);
    expect(exactDepthOfFocusMm(LAMBDA, 1e-8)).toBe(depthOfFocusMm(LAMBDA, 1e-8));
  });

  it("a bare pupil IS the engine choosing: the render is `objectDefocusing` at NA/n, to the bit", () => {
    const volume = { size: SIZE, slices: stackOf(depthOfFocusMm(LAMBDA, 1.4, N_OIL), bead()) };
    const chosen = renderVolume(volume, idealPupil(), OIL);
    const asked = renderVolume(volume, objectDefocusing(idealPupil(), S_OIL), OIL);
    for (let i = 0; i < chosen.intensity.length; i++) {
      expect(Object.is(chosen.intensity[i], asked.intensity[i])).toBe(true);
    }
    expect(chosen.maxGridPhaseStepWaves).toBe(asked.maxGridPhaseStepWaves);
    // And it is a different picture from the paraboloid's, by a third of the
    // peak — the phase difference § 6k.8 measured, arriving in an image.
    const paraboloid = renderVolume(volume, defocusing(idealPupil()), OIL);
    expect(worstRelative(chosen.intensity, paraboloid.intensity)).toBeCloseTo(0.2893, 4);
    // § 6k.8's third appearance of 1/cos α, now on the renderer's own guard: the
    // exact rim is steeper, so the same stack puts more phase between adjacent
    // pupil samples. A caller who switches has to refine the pupil, and the
    // readout that says so is the one `incoherentPsf` has always reported.
    expect(chosen.maxGridPhaseStepWaves / paraboloid.maxGridPhaseStepWaves).toBeCloseTo(2.2519, 4);
    // The engine cannot choose a cap the medium cannot carry, and says so at the
    // one place that knows: a bare pupil with no index behind an oil NA.
    expect(() =>
      renderVolume(volume, idealPupil(), {
        pupilSamples: PUPIL_SAMPLES,
        numericalAperture: 1.4,
        wavelengthNm: LAMBDA,
      }),
    ).toThrow(/index above it/);
  });

  it("and at the aperture the ladder was measured at, the choice barely shows", () => {
    const volume = { size: SIZE, slices: stackOf(depthOfFocusMm(LAMBDA, 0.1), bead()) };
    const chosen = renderVolume(volume, idealPupil(), AIR);
    const paraboloid = renderVolume(volume, defocusing(idealPupil()), AIR);
    // 2.2e-3 of peak, and stated as a measurement rather than as "negligible":
    // it is not zero, and the reason no rung above moves is that every one of
    // them supplies its own `defocusing` and gets exactly what it always got.
    expect(worstRelative(chosen.intensity, paraboloid.intensity)).toBeCloseTo(2.2468e-3, 6);
  });

  it("§ 6k.2 keeps its statement and gains a band: the exact one is 69.3% of the depth it counted", () => {
    // A slab sampled far more finely than either band, so the count is a
    // measurement of the band rather than of the sampling. Slices sit at
    // half-integer steps so that neither band's edge lands on one: an equality
    // case decided by the last bit of a division is not a physical statement.
    const halfMm = depthOfFocusMm(LAMBDA, 1.4, N_OIL) / 2;
    const slab = uniformEmitters(SIZE, 1);
    const zsOf = (per: number): number[] =>
      Array.from({ length: 6 * per }, (_, i) => (i - 3 * per + 0.5) * (halfMm / per));
    const inBand = (zs: readonly number[], half: number): number =>
      zs.filter((z) => Math.abs(z) <= half).length;
    const factor = exactDepthFactor(S_OIL);
    for (const per of [8, 32, 128]) {
      const zs = zsOf(per);
      const image = renderVolume(
        { size: SIZE, slices: zs.map((zMm) => ({ zMm, field: slab })) },
        idealPupil(),
        { ...OIL, pupilSamples: 8 },
      );
      // Both bands read back as the exported closed forms — which is the pin on
      // `renderVolume`'s own inline half-depth, spelled independently here.
      expect(image.inFocusFraction).toBeCloseTo(inBand(zs, halfMm) / zs.length, 12);
      expect(image.exactInFocusFraction!).toBeCloseTo(
        inBand(zs, exactDepthOfFocusMm(LAMBDA, 1.4, N_OIL) / 2) / zs.length,
        12,
      );
      // And the ratio is the band ratio, to the slab's own quantum: one slice in
      // a half-band of `per`, so a count can be off by at most that.
      expect(Math.abs(image.exactInFocusFraction! / image.inFocusFraction - factor)).toBeLessThan(
        1 / per,
      );
    }
    // The STATEMENT survives untouched: both bands are instrument-side constants,
    // so refocusing still moves which emitters are counted and nothing else.
    const zs = zsOf(32);
    const at = (focusMm: number) =>
      renderVolume({ size: SIZE, slices: zs.map((zMm) => ({ zMm, field: slab })) }, idealPupil(), {
        ...OIL,
        pupilSamples: 8,
        focusMm,
      });
    const home = at(0);
    for (const shift of [halfMm, -2 * halfMm]) {
      expect(at(shift).inFocusFraction).toBeCloseTo(home.inFocusFraction, 12);
      expect(at(shift).exactInFocusFraction!).toBeCloseTo(home.exactInFocusFraction!, 12);
    }
    // At NA 0.10 the two bands are 0.25% apart, which is why § 6k.2's own 1/3,
    // 1/9 and 1/27 are the same numbers under either of them.
    const airHalf = depthOfFocusMm(LAMBDA, 0.1) / 2;
    const airSlab = renderVolume(
      {
        size: SIZE,
        slices: [-1, 0, 1].map((k) => ({ zMm: k * 2 * airHalf, field: slab })),
      },
      idealPupil(),
      AIR,
    );
    expect(airSlab.inFocusFraction).toBeCloseTo(1 / 3, 12);
    expect(airSlab.exactInFocusFraction!).toBeCloseTo(1 / 3, 12);
  });

  it("a pairing with no aperture angle in it has no exact band, and the paraboloid never noticed", () => {
    // NA 1.40 with the index left at 1 is not a cone: sin α ≥ 1. The paraboloid
    // accepts it and returns a depth of focus for it, which is the older band's
    // real weakness — it is a quadratic in ρ and has no aperture angle to be
    // wrong about. So the field is absent rather than wrong, and the render it
    // came from is otherwise unchanged. § 6l.11 did not loosen this: a mount
    // rarer than the immersion gets a band at its LIT rim, on the promise
    // `mountVolumeOptions` carries that the pupil is truncated there. This pupil
    // is not, so the refusal stands exactly where § 6k.9 put it.
    const volume = { size: SIZE, slices: stackOf(depthOfFocusMm(LAMBDA, 1.4), bead()) };
    const image = renderVolume(volume, defocusing(idealPupil()), {
      pupilSamples: PUPIL_SAMPLES,
      numericalAperture: 1.4,
      wavelengthNm: LAMBDA,
    });
    expect(image.exactInFocusFraction).toBeUndefined();
    expect(image.inFocusFraction).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(image, "exactInFocusFraction")).toBe(false);
  });
});

/**
 * Circular convolution of two DC-at-0 grids.
 *
 * The rungs above compare two ways of *arranging* the same convolutions, so this
 * deliberately uses the engine's own transform: what is under test is whether
 * the sum over z may be pulled inside, not whether the FFT is right — § 2a pins
 * that, and a second transform here would only re-pin it.
 */
function convolve(object: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const objRe = Float64Array.from(object);
  const objIm = new Float64Array(n * n);
  const kerRe = Float64Array.from(kernel);
  const kerIm = new Float64Array(n * n);
  fft2d(objRe, objIm, n);
  fft2d(kerRe, kerIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = objRe[i]!;
    const ai = objIm[i]!;
    const br = kerRe[i]!;
    const bi = kerIm[i]!;
    objRe[i] = ar * br - ai * bi;
    objIm[i] = ar * bi + ai * br;
  }
  fft2d(objRe, objIm, n, true);
  return objRe;
}

function total(values: Float64Array): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** Worst pixel disagreement between two images, each scaled to its own total. */
function worstRelative(a: Float64Array, b: Float64Array): number {
  const sa = total(a);
  const sb = total(b);
  let worst = 0;
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i]! / sa;
    worst = Math.max(worst, Math.abs(va - b[i]! / sb));
    peak = Math.max(peak, va);
  }
  return worst / peak;
}
