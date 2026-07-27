import { describe, it, expect } from "vitest";
import {
  axialSpectrum,
  axialTransfer,
  defocusWaves,
  defocusing,
  depthKernels,
  hazeKernel,
  missingConeEdge,
  renderVolume,
  withDefocus,
  type DepthPupils,
  type EmitterSlice,
} from "../src/imaging/volume";
import { incoherentPsf, uniformEmitters, type EmitterField } from "../src/imaging/fluorescence";
import { fft2d } from "../src/math/fft";
import { depthOfFocusMm } from "../src/imaging/emission";
import { idealPupil } from "../src/illumination/transfer";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
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
    const taper: DepthPupils = (waves) => {
      const t = Math.max(0, 1 - Math.abs(waves) / 12);
      const base = withDefocus(idealPupil(), waves);
      return {
        amplitude: (px, py) => t * base.amplitude(px, py),
        phaseWaves: (px, py) => base.phaseWaves(px, py),
      } satisfies PupilFunction;
    };
    const kernels = depthKernels(taper, STACK, { size: SIZE, pupilSamples: PUPIL_SAMPLES });
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
      // Within one axial bin of the closed form — the threshold and the bin are
      // the measurement's own resolution, and both are stated rather than tuned
      // until the numbers agreed.
      expect(Math.abs(edge - missingConeEdge(nu))).toBeLessThanOrEqual(binWidth * 1.001);
    }
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
  const kernels = () =>
    depthKernels(defocusing(idealPupil()), STACK, { size: SIZE, pupilSamples: PUPIL_SAMPLES });

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
      defocusing(idealPupil()),
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
    const sliced = renderVolume({ size: SIZE, slices }, defocusing(idealPupil()), {
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
    // Both carry every photon the specimen emitted, and the only difference
    // between their totals is that `hazeKernel` renormalizes to unit sum where
    // `renderVolume` keeps the throughput the pupil actually delivered…
    expect(total(sliced.intensity) / total(shortcut)).toBeCloseTo(kernelAt(0).formedSum, 12);
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
