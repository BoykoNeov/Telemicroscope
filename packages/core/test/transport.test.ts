import { describe, it, expect } from "vitest";
import {
  abbeImage,
  cosineGratingObject,
  phaseGratingObject,
  pointwisePhaseGratingObject,
  type ObjectField,
} from "../src/illumination/abbe";
import { coherentSource, diskSource } from "../src/illumination/source";
import { defocusedPupil, weakPhaseTransfer } from "../src/illumination/transfer";
import {
  defocusDeflectionPixels,
  defocusPropagationMm,
  depositionWindow,
  phaseDerivatives,
  transportImage,
  transportJacobian,
  weakPhaseDefocusTransfer,
  weakPhaseTransportTransfer,
} from "../src/illumination/transport";
import { imagePixelScaleMm, type PupilScale } from "../src/wave/psf";

/**
 * § 6f.10 — transport of intensity: brightfield's geometric branch.
 *
 * § 6f.5 pinned that brightfield cannot see a phase object in focus and can out
 * of focus, and read it off the Abbe sum's own sidebands. This file reads the
 * same fact off the RAYS: a specimen's phase gradient deflects them, a
 * defocused plane is a lever, and the pile-up is the contrast. Nothing here
 * interferes, so nothing here is partial coherence — that is § 6f.9's cliff and
 * it stands.
 *
 * The external number is the weak-phase defocus transfer, sin(π·λ·z·f²)
 * (Teague 1983 — the same sine every phase-contrast transfer function is
 * written with). This branch computes its ARGUMENT, which is what a geometric
 * limit is, so the pins come in two kinds: the closed form itself, and the
 * measured size of the gap to it.
 *
 * ## The fixture
 *
 * A phase grating of `CYCLES` cycles on a 64² grid at pupilSamples 16 — so
 * ν = 2·cycles/pupilSamples = 0.25, a quarter of the coherent cutoff, and
 * padFactor 4. Small on purpose: `raysPerPixel` 16 puts a 1024² ray grid
 * behind a 64² image and every transform in this file is paid for five times
 * over (one forward, two or five inverse, per call).
 */

const SIZE = 64;
const PUPIL_SAMPLES = 16;
const PAD = SIZE / PUPIL_SAMPLES;
const CYCLES = 2;
/** ν = 2·cycles/pupilSamples — § 6f's frequency, in units of NA/λ. */
const NU = (2 * CYCLES) / PUPIL_SAMPLES;
/** The grating's period is SIZE/CYCLES, so its trough is a quarter period on. */
const TROUGH = SIZE / (2 * CYCLES);
/** χ = 2π·w₂₀·ν², the defocus phase the two sidebands pick up. */
const chi = (w: number): number => 2 * Math.PI * w * NU * NU;

/** Peak amplitude of the fundamental, signed: negative is dark at the φ peak. */
function contrast(intensity: Float64Array): number {
  return (intensity[0]! - intensity[TROUGH]!) / 2;
}

function grating(amplitudeRadians: number): ObjectField {
  return pointwisePhaseGratingObject({ size: SIZE, cycles: CYCLES, amplitudeRadians });
}

/** The same field with x and y exchanged — an object grating along y. */
function transpose(o: ObjectField): ObjectField {
  const n = o.size;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      re[x * n + y] = o.re[y * n + x]!;
      im[x * n + y] = o.im[y * n + x]!;
    }
  }
  return { size: n, re, im };
}

function transposed(a: Float64Array, n = SIZE): Float64Array {
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x * n + y] = a[y * n + x]!;
  return out;
}

/** exp(i·φ₁·cos(2π(cx·x + cy·y)/size)) — a grating along neither axis. */
function diagonalGrating(cx: number, cy: number, amplitudeRadians: number): ObjectField {
  const re = new Float64Array(SIZE * SIZE);
  const im = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const phi = amplitudeRadians * Math.cos((2 * Math.PI * (cx * x + cy * y)) / SIZE);
      re[y * SIZE + x] = Math.cos(phi);
      im[y * SIZE + x] = Math.sin(phi);
    }
  }
  return { size: SIZE, re, im };
}

describe("§ 6f.10.1 — the bridge into this branch's units", () => {
  /**
   * δ is quoted in object pixels per radian-per-pixel, which is a grid quantity;
   * the physics it stands for is λz/(2πΔx²), which is not. Pinning the two
   * together is what stops a factor of two or an NA² from surfacing later as a
   * contrast ratio and being hunted for in the ray launch.
   */
  it("is λz/(2π·Δx²) built out of a physical pupil, at every scale", () => {
    const scales: readonly PupilScale[] = [
      { referenceRadius: 160, exitRadius: 16, wavelengthNm: 550, nImage: 1, slopeRadius: undefined },
      { referenceRadius: 40, exitRadius: 18, wavelengthNm: 486, nImage: 1, slopeRadius: undefined },
      {
        referenceRadius: 25,
        exitRadius: 9,
        wavelengthNm: 632.8,
        nImage: 1.515,
        slopeRadius: undefined,
      },
    ];
    for (const scale of scales) {
      const pixelMm = imagePixelScaleMm(scale, SIZE, PUPIL_SAMPLES);
      const na = Math.abs((scale.nImage * scale.exitRadius) / scale.referenceRadius);
      // § 6f.8's own bridge, read backwards: the grid's pixel is λ/(2·NA·padFactor).
      expect(pixelMm).toBeCloseTo((scale.wavelengthNm * 1e-6) / (2 * na * PAD), 15);

      for (const w of [0.05, -0.4, 1.25]) {
        const zMm = defocusPropagationMm(w, scale);
        // The bridge below multiplies z by δ's own minus, so the ratio would be
        // 1 with BOTH signs flipped: only the magnitude is pinned there. The
        // direction is a separate claim — positive w₂₀ is the plane short of
        // the focus — and it is pinned here and, physically, by § 6f.10.6's
        // dark-at-the-peak rung on the wave branch.
        expect(Math.sign(zMm)).toBe(-Math.sign(w));
        const lambdaMm = scale.wavelengthNm * 1e-6;
        const fromPhysics = (lambdaMm * zMm) / (2 * Math.PI * pixelMm * pixelMm);
        const delta = defocusDeflectionPixels(w, SIZE, PUPIL_SAMPLES);
        expect(fromPhysics / delta).toBeCloseTo(1, 12);
      }
    }
  });

  it("is −4·w₂₀·padFactor²/π, and so depends on padFactor and nothing else", () => {
    for (const w of [0.05, -0.4, 1.25]) {
      expect(defocusDeflectionPixels(w, SIZE, PUPIL_SAMPLES)).toBe((-4 * w * PAD * PAD) / Math.PI);
      // Same padFactor, twice the grid: the same δ, bit for bit.
      expect(defocusDeflectionPixels(w, 128, 32)).toBe(defocusDeflectionPixels(w, 64, 16));
      // Twice the padFactor: four times the δ.
      expect(defocusDeflectionPixels(w, 256, 32) / defocusDeflectionPixels(w, 128, 32)).toBeCloseTo(
        4,
        12,
      );
    }
  });

  it("is exactly zero in focus — nothing to round", () => {
    expect(defocusDeflectionPixels(0, SIZE, PUPIL_SAMPLES)).toBe(-0);
  });
});

describe("§ 6f.10.2 — in focus the rays do not move, which is § 6f.5's null from the other side", () => {
  /**
   * The Abbe sum's null is a cancellation between two sidebands that are 180°
   * apart. This one is not a cancellation at all: with no lever there is no
   * displacement, so the image is the object's own intensity and there was
   * never anything to cancel. Two mechanisms, one hard zero — which is the same
   * shape of finding § 6cr made about the two transfer curves being one complex
   * number.
   */
  it("returns the object's intensity bit for bit at w₂₀ = 0", () => {
    for (const object of [grating(0.5), cosineGratingObject({ size: SIZE, cycles: CYCLES, modulation: 0.6 })]) {
      const image = transportImage(object, { pupilSamples: PUPIL_SAMPLES, defocusWaves: 0 });
      expect(image.maxDisplacementPixels).toBe(0);
      for (let i = 0; i < SIZE * SIZE; i++) {
        expect(image.intensity[i]).toBe(object.re[i]! ** 2 + object.im[i]! ** 2);
      }
    }
  });

  it("and its Jacobian is the identity, so the density is the intensity", () => {
    const object = grating(0.5);
    const j = transportJacobian(object, { pupilSamples: PUPIL_SAMPLES, defocusWaves: 0 });
    expect(j.minDeterminant).toBe(1);
    expect(j.caustic).toBe(false);
    for (let i = 0; i < SIZE * SIZE; i++) expect(j.determinant[i]).toBe(1);
  });
});

describe("§ 6f.10.3 — a pure absorber never defocuses on this branch", () => {
  /**
   * The honest limit of the whole branch, and it is visible in the equation
   * rather than argued: ∂I/∂z = −(λ/2π)∇·(I∇φ) has **no term without a ∇φ in
   * it**. A specimen that only absorbs makes parallel rays, parallel rays go
   * straight, and a defocused image of an absorber is unchanged. What really
   * happens to it — a defocus blur — is diffraction, and diffraction is the
   * other branch's whole job (§ 6f.9).
   */
  it("is returned unchanged at any defocus, to f64", () => {
    const object = cosineGratingObject({ size: SIZE, cycles: CYCLES, modulation: 0.6 });
    for (const w of [0.3, -1.5, 8]) {
      const image = transportImage(object, { pupilSamples: PUPIL_SAMPLES, defocusWaves: w });
      expect(image.maxDisplacementPixels).toBeLessThan(1e-13);
      for (let i = 0; i < SIZE * SIZE; i++) {
        expect(image.intensity[i]).toBeCloseTo(object.re[i]! ** 2 + object.im[i]! ** 2, 12);
      }
    }
  });

  it("...because its phase gradient is machine zero, not merely small", () => {
    const d = phaseDerivatives(cosineGratingObject({ size: SIZE, cycles: CYCLES, modulation: 0.6 }));
    let maxGrad = 0;
    for (let i = 0; i < SIZE * SIZE; i++) maxGrad = Math.max(maxGrad, Math.abs(d.dx[i]!), Math.abs(d.dy[i]!));
    expect(maxGrad).toBeLessThan(1e-15);
  });
});

describe("§ 6f.10.4 — the contrast, against the closed form with no engine in it", () => {
  const PHI = 0.02;
  const W = 0.05;
  /** 2·φ₁·χ — the geometric limit of 2·φ₁·sin χ, signed dark-at-the-peak. */
  const CLOSED = -2 * PHI * weakPhaseTransportTransfer(W, NU);
  const WINDOW = depositionWindow(NU, SIZE, PUPIL_SAMPLES);

  it("lands on 2·φ₁·2π·w₂₀·ν² once the deposition window is divided out", () => {
    const image = transportImage(grating(PHI), {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: W,
      raysPerPixel: 16,
    });
    const ratio = contrast(image.intensity) / WINDOW / CLOSED;
    expect(ratio).toBeCloseTo(1, 4);
    // The residual is stated rather than absorbed: at 16 rays per pixel it is
    // 6.275e-6, it is the ray grid's own discretization, and the rung below
    // shows it quartering with M. Asserted relatively, because what is recorded
    // is a well-conditioned reading and not a bound.
    expect((ratio - 1) / 6.27495e-6).toBeCloseTo(1, 4);
  });

  /**
   * The window is not a fudge factor: a ray is a point, the image is a grid,
   * and sharing a point between the two cells it lands between is a
   * convolution with a one-pixel triangle whose transfer is sinc². At ν = 0.25
   * and padFactor 4 that is 0.99679, and the raw ratio misses by exactly it.
   */
  it("and the RAW ratio is that window, which is why it is divided out", () => {
    const image = transportImage(grating(PHI), {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: W,
      raysPerPixel: 16,
    });
    expect(WINDOW).toBeCloseTo(0.99679136, 8);
    // Relative, and to the ray grid's own residual: the raw ratio is the
    // window times the same 1 + 6.275e-6 the rung above records.
    expect(contrast(image.intensity) / CLOSED / WINDOW).toBeCloseTo(1, 4);
  });

  /**
   * `raysPerPixel` is the convergence knob and its RATE is the rung, not a
   * tolerance: the residual quarters at every doubling — second order — and
   * measured it is 4.0008, 4.0002, 4.0000, which is a discretization and not a
   * physics error. At M = 1 the answer carries the window TWICE, because one
   * ray per cell samples the specimen through the same triangle it is deposited
   * by; that is why the first step of the sequence changes sign.
   */
  it("converges in raysPerPixel at second order, and at M = 1 the window is squared", () => {
    const object = grating(PHI);
    const errors: number[] = [];
    for (const m of [1, 2, 4, 8, 16]) {
      const image = transportImage(object, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: W,
        raysPerPixel: m,
      });
      const ratio = contrast(image.intensity) / WINDOW / CLOSED;
      if (m === 1) {
        expect(ratio / WINDOW).toBeCloseTo(1, 4);
        expect((ratio / WINDOW - 1) / -6.21209e-6).toBeCloseTo(1, 4);
      }
      else errors.push(ratio - 1);
    }
    expect(errors[0]! / 4.017082e-4).toBeCloseTo(1, 4);
    // 4.00084, 4.00021, 4.00005 — the ratio is 4 and its own departure from 4
    // quarters as well, which is what makes this a second-order scheme rather
    // than a sequence that happens to halve twice.
    const ratios = errors.slice(1).map((e, i) => errors[i]! / e);
    for (const r of ratios) expect(r).toBeCloseTo(4, 2);
    for (let i = 1; i < ratios.length; i++) {
      expect((ratios[i - 1]! - 4) / (ratios[i]! - 4)).toBeCloseTo(4, 0);
    }
  });

  it("conserves the light it was given, at every ray count and every defocus", () => {
    const object = grating(0.8);
    for (const m of [1, 2, 8]) {
      for (const w of [0, 0.3, -2.5]) {
        const image = transportImage(object, {
          pupilSamples: PUPIL_SAMPLES,
          defocusWaves: w,
          raysPerPixel: m,
        });
        expect(image.energy / (SIZE * SIZE)).toBeCloseTo(1, 13);
      }
    }
  });

  /**
   * The Jacobian is the same map differentiated rather than pushed, so it needs
   * no window and no ray count — and it agrees, which is what makes
   * 1 − δ∇²φ a derivation rather than a quotation.
   */
  it("and the Jacobian's own density agrees with the push and with the closed form", () => {
    const object = grating(PHI);
    const j = transportJacobian(object, { pupilSamples: PUPIL_SAMPLES, defocusWaves: W });
    const push = transportImage(object, {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: W,
      raysPerPixel: 16,
    });
    expect(contrast(j.density) / CLOSED).toBeCloseTo(1, 5);
    const agreement = contrast(j.density) / (contrast(push.intensity) / WINDOW);
    expect(agreement).toBeCloseTo(1, 4);
    // The push's own 16-ray residual, arriving here with its sign flipped
    // because the push is the denominator — the two readouts differ by that and
    // by nothing else.
    expect((agreement - 1) / -5.65807e-6).toBeCloseTo(1, 4);
  });
});

describe("§ 6f.10.5 — against the engine's own wave branch, and the size of the gap", () => {
  const PHI = 0.02;
  const WINDOW = depositionWindow(NU, SIZE, PUPIL_SAMPLES);

  /**
   * First the wave branch's own closed form, so the comparison below is between
   * two pinned things rather than between two computations. Under a single
   * on-axis source point the transfer collapses to |sin χ| algebraically, and
   * the engine returns it to f64.
   */
  it("`weakPhaseTransfer` at S → 0 is |sin χ|, exactly", () => {
    for (const w of [0.05, 0.5, 2]) {
      const t = weakPhaseTransfer(defocusedPupil(w), coherentSource(), NU);
      expect(t).toBeCloseTo(Math.abs(weakPhaseDefocusTransfer(w, NU)), 14);
    }
  });

  /**
   * The headline. Over a defocus sweep the ray branch's contrast divided by the
   * Abbe sum's is **χ/sin χ** — not approximately, and not with a fitted
   * constant: 1.000064 at χ = 0.0196 through 1.11072 at χ = 0.785, matching to
   * 1e-4 the whole way. That is the statement "this is the geometric limit of
   * that", measured rather than asserted, and it is why the branch's own
   * `maxDefocusPhaseRadians` readout is the number a caller needs.
   */
  it("is χ/sin χ times `abbeImage`, across a defocus sweep", () => {
    const object = grating(PHI);
    for (const w of [0.05, 0.2, 0.5, 1, 2]) {
      const wave = abbeImage(object, defocusedPupil(w), coherentSource(), {
        pupilSamples: PUPIL_SAMPLES,
      });
      const geo = transportImage(object, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: w,
        raysPerPixel: 8,
      });
      const ratio = contrast(geo.intensity) / WINDOW / contrast(wave.intensity);
      const x = chi(w);
      expect(ratio).toBeCloseTo(x / Math.sin(x), 3);
    }
  });

  /** And the leading term of that gap is χ²/6, which is what "small χ" costs. */
  it("...whose leading term is χ²/6", () => {
    for (const w of [0.4, 0.8]) {
      const x = chi(w);
      const gap = weakPhaseTransportTransfer(w, NU) / weakPhaseDefocusTransfer(w, NU) - 1;
      expect(gap / ((x * x) / 6)).toBeCloseTo(1, 1);
    }
  });

  /**
   * The readout that says how far out the caller is. It is taken over the
   * frequencies the OBJECT carries, not at ν, because a pointwise exp(iφ) has
   * harmonics and they are what leave the small-χ regime first.
   */
  it("reports its own χ, over the object's spectrum rather than at one ν", () => {
    const image = transportImage(grating(0.02), {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: 0.05,
    });
    // J₃(0.02) is 1e-13 of J₀, so the second harmonic (ν = 0.5) is the last one
    // over the floor: χ(2ν) = 4·χ(ν).
    expect(image.maxDefocusPhaseRadians).toBeCloseTo(4 * chi(0.05), 12);
  });

  /**
   * What it cannot do, measured rather than conceded. Opening the condenser
   * damps the wave branch's contrast — 3.1384e-3 at S = 0 down to 3.0787e-3 at
   * S = 0.6, a 1.9% fall — and the ray branch does not move, because a ray
   * carries no direction the deposition can be weighted by. This is § 6f.9's
   * sentence in a second place: coherence has no ray analog and never will.
   */
  it("is source-blind, and the wave branch is not", () => {
    const object = grating(PHI);
    const at = (S: number): number =>
      contrast(
        abbeImage(object, defocusedPupil(0.2), S === 0 ? coherentSource() : diskSource(S, 9), {
          pupilSamples: PUPIL_SAMPLES,
        }).intensity,
      );
    const coherent = at(0);
    expect(at(0.3) / coherent).toBeCloseTo(0.99524, 4);
    expect(at(0.6) / coherent).toBeCloseTo(0.98099, 4);
    // The geometric branch takes no source at all — there is nowhere to put one.
    const geo = transportImage(object, {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: 0.2,
      raysPerPixel: 8,
    });
    expect(contrast(geo.intensity) / WINDOW).toBeCloseTo(-3.1416e-3, 6);
  });
});

describe("§ 6f.10.6 — the two signs, and the antisymmetry between them", () => {
  /**
   * The deflection's sign has the prism anchor `rayDeflectionScaleMm` records.
   * The defocus's sign does not, and was read off `abbeImage` rather than
   * derived — a phase MAXIMUM images DARK at positive w₂₀. Pinned here as a
   * signed image, because a transfer magnitude cannot see it and the two
   * branches would agree on |contrast| with the deflection pointing the wrong
   * way.
   */
  it("a phase maximum images dark at positive defocus, on both branches", () => {
    const object = grating(0.02);
    const wave = abbeImage(object, defocusedPupil(0.05), coherentSource(), {
      pupilSamples: PUPIL_SAMPLES,
    });
    const geo = transportImage(object, {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: 0.05,
      raysPerPixel: 8,
    });
    expect(wave.intensity[0]!).toBeLessThan(1);
    expect(geo.intensity[0]!).toBeLessThan(1);
    expect(wave.intensity[TROUGH]!).toBeGreaterThan(1);
    expect(geo.intensity[TROUGH]!).toBeGreaterThan(1);
  });

  /**
   * Over and under focus carry the same picture with the sign flipped — the
   * identity two-plane phase retrieval is built on, and it needs no external
   * number. It is exact here rather than to first order, because δ enters the
   * map linearly and a weak phase never reaches the map's own second order.
   */
  it("and over- and under-focus are negatives of each other", () => {
    const object = grating(0.02);
    for (const w of [0.05, 0.2]) {
      const plus = transportImage(object, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: w,
        raysPerPixel: 8,
      });
      const minus = transportImage(object, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: -w,
        raysPerPixel: 8,
      });
      for (let i = 0; i < SIZE * SIZE; i++) {
        expect(plus.intensity[i]! - 1 + (minus.intensity[i]! - 1)).toBeCloseTo(0, 13);
      }
    }
  });
});

describe("§ 6f.10.7 — the caustic, and where this branch stops having one answer", () => {
  const PHI = 1;
  /**
   * The fold is where δ times the map's most negative curvature reaches −1, and
   * on a grating that reduces to something with no grid in it at all:
   *
   *     |δ|·φ₁·(2πf)² = 4π·|w₂₀|·φ₁·ν² = 2·φ₁·χ
   *
   * so the map folds exactly when the branch's OWN first-order contrast would
   * have reached 1. That is the sharpest statement of the limit available — not
   * a tolerance, not a heuristic: the branch fails precisely where believing it
   * would have meant believing in 100% modulation.
   */
  const W_FOLD = 1 / (4 * Math.PI * PHI * NU * NU);

  it("folds at 2·φ₁·χ = 1, and the determinant is 1 − w₂₀/w_fold exactly", () => {
    expect(2 * PHI * chi(W_FOLD)).toBeCloseTo(1, 14);
    for (const k of [0.9, 0.99, 1, 1.01, 1.2, 2]) {
      const j = transportJacobian(grating(PHI), {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: k * W_FOLD,
      });
      expect(j.minDeterminant).toBeCloseTo(1 - k, 12);
      expect(j.caustic).toBe(k >= 1);
    }
  });

  it("and the push survives it — the rays cross, their flux adds, nothing diverges", () => {
    for (const k of [0.99, 1, 2]) {
      const image = transportImage(grating(PHI), {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: k * W_FOLD,
        raysPerPixel: 4,
      });
      for (let i = 0; i < SIZE * SIZE; i++) expect(Number.isFinite(image.intensity[i]!)).toBe(true);
      expect(image.energy / (SIZE * SIZE)).toBeCloseTo(1, 12);
    }
  });
});

describe("§ 6f.10.8 — the other axis, and the cross term", () => {
  /**
   * Every rung above runs on a grating along x, so every bin carrying energy
   * has k_y = 0 — which leaves the y half of `subSamples`' centring ramp, the
   * y half of the gradient, and `det J`'s shear term **entirely unexercised**.
   * That is exactly where the centring bug this module already had would have
   * hidden a second time: it produced a "converges, but to the wrong number"
   * signature that took a sweep to read, and an asymmetric ramp would produce
   * it again on one axis only.
   *
   * The grating turned through 90° costs one rung and catches all of it at
   * once — an asymmetric ramp, a swapped dx/dy, and a row-versus-column index
   * slip are each a visible failure of a transpose identity that owes nothing
   * to any closed form.
   */
  it("a grating along y transports to the transpose of the same grating along x", () => {
    const alongX = grating(0.4);
    for (const m of [1, 4]) {
      const x = transportImage(alongX, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: 0.3,
        raysPerPixel: m,
      });
      const y = transportImage(transpose(alongX), {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: 0.3,
        raysPerPixel: m,
      });
      const want = transposed(x.intensity);
      for (let i = 0; i < SIZE * SIZE; i++) expect(y.intensity[i]).toBeCloseTo(want[i]!, 13);
    }
  });

  it("...and so does its Jacobian", () => {
    const alongX = grating(0.4);
    const x = transportJacobian(alongX, { pupilSamples: PUPIL_SAMPLES, defocusWaves: 0.3 });
    const y = transportJacobian(transpose(alongX), {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: 0.3,
    });
    expect(y.minDeterminant).toBeCloseTo(x.minDeterminant, 13);
    const want = transposed(x.determinant);
    for (let i = 0; i < SIZE * SIZE; i++) expect(y.determinant[i]).toBeCloseTo(want[i]!, 13);
  });

  /**
   * A grating along neither axis puts a real number in φ_xy, and the fold
   * identity above survives it for a reason worth stating: for ANY single
   * spatial frequency the Hessian is rank one, so
   * φ_xx·φ_yy − φ_xy² vanishes identically and `det J` keeps its
   * 1 + δ·∇²φ form with ν² = ν_x² + ν_y². A φ_xy computed wrongly would NOT
   * cancel, so this is a check on the cross term precisely because its answer
   * is that the cross term contributes nothing.
   */
  it("a diagonal grating carries a real φ_xy, and the fold identity is unchanged", () => {
    const PHI = 1;
    const CX = 2;
    const CY = 2;
    // ν² adds in quadrature across the axes, so a (2, 2) grating sits at √2·ν.
    const nu2 = (4 * (CX * CX + CY * CY)) / (PUPIL_SAMPLES * PUPIL_SAMPLES);
    const wFold = 1 / (4 * Math.PI * PHI * nu2);
    const object = diagonalGrating(CX, CY, PHI);

    const d = phaseDerivatives(object);
    let maxXy = 0;
    for (let i = 0; i < SIZE * SIZE; i++) maxXy = Math.max(maxXy, Math.abs(d.dxy[i]!));
    // (2π·2/64)² · φ₁ — the cross term at its own peak, not a token non-zero.
    expect(maxXy).toBeCloseTo(PHI * (2 * Math.PI * CX) ** 2 / (SIZE * SIZE), 12);

    for (const k of [0.9, 1, 1.4]) {
      const j = transportJacobian(object, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: k * wFold,
      });
      expect(j.minDeterminant).toBeCloseTo(1 - k, 12);
      expect(j.caustic).toBe(k >= 1);
    }
  });

  it("and it conserves and stays finite through that fold too", () => {
    const image = transportImage(diagonalGrating(2, 2, 1), {
      pupilSamples: PUPIL_SAMPLES,
      defocusWaves: 1 / (4 * Math.PI * ((4 * 8) / (PUPIL_SAMPLES * PUPIL_SAMPLES))),
      raysPerPixel: 2,
    });
    for (let i = 0; i < SIZE * SIZE; i++) expect(Number.isFinite(image.intensity[i]!)).toBe(true);
    expect(image.energy / (SIZE * SIZE)).toBeCloseTo(1, 12);
  });
});

describe("§ 6f.10.9 — which phase grating, measured rather than assumed", () => {
  /**
   * `phaseGratingObject` synthesizes from a Bessel spectrum it has to cut to the
   * grid, and `pointwisePhaseGratingObject` writes exp(iφ) at every sample and
   * is not band-limited at all — so differentiating them could have put the
   * truncation into the gradient and made a discrepancy look like physics.
   *
   * On this fixture it does not: at φ₁ = 3 the cut order is 15 and the dropped
   * energy 1.5e-21, and the two objects transport to the same image within
   * 3.6e-11. The trap is real (§ 6f.9's ripple is the same shape of thing) and
   * this grid is nowhere near it — which is worth a number rather than a
   * sentence, because the number is what a finer grating would move.
   */
  it("the truncated and the pointwise gratings transport alike here", () => {
    for (const [phi, bound] of [
      [0.02, 1e-14],
      [1, 1e-13],
      [3, 1e-9],
    ] as const) {
      const a = phaseGratingObject({ size: SIZE, cycles: CYCLES, amplitudeRadians: phi });
      const b = grating(phi);
      expect(a.truncation!.droppedEnergy).toBeLessThan(1e-20);
      const ia = transportImage(a, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: 0.1,
        raysPerPixel: 4,
      });
      const ib = transportImage(b, {
        pupilSamples: PUPIL_SAMPLES,
        defocusWaves: 0.1,
        raysPerPixel: 4,
      });
      for (let i = 0; i < SIZE * SIZE; i++) {
        expect(Math.abs(ia.intensity[i]! - ib.intensity[i]!)).toBeLessThan(bound);
      }
    }
  });
});
