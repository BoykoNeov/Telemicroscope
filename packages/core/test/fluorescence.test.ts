import { describe, it, expect } from "vitest";
import {
  cosineGratingEmitters,
  incoherentImage,
  incoherentPsf,
  latticeMatchedSource,
  pupilThroughput,
  rasterizeEmitters,
  renderFluorescence,
  uniformEmitters,
  type EmitterField,
  type ThroughputUnits,
} from "../src/imaging/fluorescence";
import type { PupilFunction } from "../src/wave/psf";
import {
  abbeImage,
  cosineGratingObject,
  phaseGratingObject,
  uniformObject,
} from "../src/illumination/abbe";
import { defocusedPupil, idealPupil, incoherentTransfer } from "../src/illumination/transfer";
import { coherentSource, diskSource } from "../src/illumination/source";
import {
  fieldPupilAt,
  imageRadiusForObjectHeight,
  objectFieldFrame,
  tracedFieldPupils,
} from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { PatchPupil } from "../src/imaging/brightfield";

/**
 * § 6i — fluorescence: the specimen that emits.
 *
 * The step rests on one geometric fact and no new physics. When the condenser's
 * own lattice steps by the pupil's frequency step and reaches past 1 + B, the
 * Abbe sum's order-pair bracket Σ_s P(u₁+s)P*(u₂+s) becomes a discrete
 * autocorrelation — a function of u₁ − u₂ alone — so the double sum factors and
 * partial coherence collapses to a convolution. The kernel it collapses to is
 * the incoherent PSF, which is what a self-luminous object images through. That
 * makes § 6i.1 an identity to f64 noise rather than a comparison, and it is the
 * strongest evidence available that the two modules describe one physics.
 *
 * The identity is ALGEBRAIC, so it needs no fine sampling: § 6i.1–6i.2 run at
 * pupilSamples 16 on a 64 grid, where the floor is `abbeImage`'s own
 * (size ≥ pupilSamples·(1 + S)) and an overfilled condenser is what makes it
 * bind. What does need sampling is the comparison against the *continuous*
 * transfer function, and § 6i.3 pays for it there — where the finding is that
 * the engine's transfer is a lattice point COUNT, exact as such, and its
 * departure from the closed form is a counting fluctuation rather than an error
 * that falls.
 */

/** § 6i.1–6i.2 run here: pupilSamples 16, so size 64 clears 16·(1 + S). */
const ID_SIZE = 64;
const ID_PUPIL_SAMPLES = 16;
/** 4 cycles on 64 cells: ν = 2·cycles/pupilSamples = 0.5, so B = 0.5. */
const ID_CYCLES = 4;
const B = (2 * ID_CYCLES) / ID_PUPIL_SAMPLES;
/**
 * S = 25/16: the smallest lattice-matched radius past 1 + B, with 25 points
 * across the diameter — odd, so the lattice contains s = 0 and reads the pupil
 * on the same sub-lattice `incoherentPsf` does.
 */
const ID_S = 25 / ID_PUPIL_SAMPLES;

const CLEAR = idealPupil();

/**
 * § 6i's units, stated the way § 6bc requires.
 *
 * Every rung below that uses this forms its whole frame through ONE pupil, so
 * that pupil is its own reference and the weight is exactly 1 — these images
 * are bitwise the ones § 6i measured. The moment a frame is built from several
 * pupils this is the wrong call, which is why it takes the pupil rather than
 * defaulting to "whatever formed me".
 */
const ownUnits = (
  pupil: PupilFunction,
  pupilSamples: number,
  size: number,
): ThroughputUnits => ({
  kind: "referenced",
  referenceSum: pupilThroughput(pupil, { pupilSamples, size }),
});

/** Relative L∞ difference of two images, against the first's peak. */
function maxRelative(a: Float64Array, b: Float64Array): number {
  let peak = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]!));
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst / peak;
}

/** |t|² — the emitter density reproducing an amplitude object's intensity. */
function emittersFromAmplitude(object: {
  size: number;
  re: Float64Array;
  im: Float64Array;
}): EmitterField {
  const values = new Float64Array(object.size * object.size);
  for (let i = 0; i < values.length; i++) {
    values[i] = object.re[i]! * object.re[i]! + object.im[i]! * object.im[i]!;
  }
  return { size: object.size, values };
}

/**
 * The Abbe image, referred to the background a clear field images as.
 *
 * Once the condenser overfills the objective the clear field images BELOW 1 —
 * source points outside the pupil deliver light the objective never collects —
 * so the two operators are compared after each is referred to its own clear
 * field. The factor is measured rather than assumed, and § 6i.1 pins what it is.
 */
function relativeAbbe(
  object: { size: number; re: Float64Array; im: Float64Array },
  source: ReturnType<typeof diskSource>,
  pupilSamples: number,
): { image: Float64Array; background: number } {
  const formed = abbeImage(object, CLEAR, source, { pupilSamples });
  const flat = abbeImage(uniformObject(object.size), CLEAR, source, { pupilSamples });
  const background = flat.intensity[0]!;
  return { image: Float64Array.from(formed.intensity, (v) => v / background), background };
}

/** Modulation depth of a row of a periodic image. */
function contrastOf(intensity: Float64Array, size: number, row = 0): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = 0; x < size; x++) {
    const v = intensity[row * size + x]!;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return (hi - lo) / (hi + lo);
}

/** Slope of log|y| against log|x| — the ORDER a quantity grows at. */
function fittedOrder(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += Math.log(xs[i]!) / n;
    my += Math.log(Math.abs(ys[i]!)) / n;
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = Math.log(xs[i]!) - mx;
    num += dx * (Math.log(Math.abs(ys[i]!)) - my);
    den += dx * dx;
  }
  return num / den;
}

describe("§ 6i.1 — partial coherence becomes a convolution, and the convolution is fluorescence's", () => {
  const matched = latticeMatchedSource(ID_S, ID_PUPIL_SAMPLES);

  it("a lattice-matched source reaching past 1 + B makes the Abbe sum exactly incoherent", () => {
    expect(ID_S).toBeGreaterThan(1 + B);
    for (const modulation of [0.2, 1]) {
      const amplitude = cosineGratingObject({ size: ID_SIZE, cycles: ID_CYCLES, modulation });
      const { image } = relativeAbbe(amplitude, matched, ID_PUPIL_SAMPLES);
      const fluorescence = incoherentImage(emittersFromAmplitude(amplitude), CLEAR, {
        pupilSamples: ID_PUPIL_SAMPLES,
        throughput: ownUnits(CLEAR, ID_PUPIL_SAMPLES, ID_SIZE),
      });
      // Not "close": the same number. The bracket has become a function of
      // u₁ − u₂ alone, so the double sum factors into a transfer function.
      expect(maxRelative(fluorescence.intensity, image)).toBeLessThan(1e-12);
    }
  });

  it("the nonlinearity does not shrink, it vanishes — the identity holds at m = 1", () => {
    // § 6f.4 measured brightfield's normalized transfer walking 11.2% AWAY from
    // the weak-object limit at m = 1. Here the ratio is the same number at every
    // modulation, because an incoherent image is linear in the emitter density
    // and there is nothing left for m to enter.
    const ratios = [0.1, 0.5, 1].map((modulation) => {
      const emitters = cosineGratingEmitters({ size: ID_SIZE, cycles: ID_CYCLES, modulation });
      const formed = incoherentImage(emitters, CLEAR, {
        pupilSamples: ID_PUPIL_SAMPLES,
        throughput: ownUnits(CLEAR, ID_PUPIL_SAMPLES, ID_SIZE),
      });
      return contrastOf(formed.intensity, ID_SIZE) / modulation;
    });
    expect(ratios[1]! / ratios[0]!).toBeCloseTo(1, 12);
    expect(ratios[2]! / ratios[0]!).toBeCloseTo(1, 12);
  });

  it("an overfilled condenser images a clear field BELOW 1, by exactly the aperture's share", () => {
    // Light from source points outside the objective's pupil is never collected.
    // The share is COUNTED rather than integrated: transmitting lattice points
    // over source points, both of which the engine already reports.
    const kernel = incoherentPsf(CLEAR, { size: ID_SIZE, pupilSamples: ID_PUPIL_SAMPLES });
    const flat = abbeImage(uniformObject(ID_SIZE), CLEAR, matched, {
      pupilSamples: ID_PUPIL_SAMPLES,
    });
    expect(flat.intensity[0]!).toBeCloseTo(kernel.transmittingSamples / matched.points.length, 12);
    // Genuinely below 1 — this is physics, not a normalization convention, and
    // it is why § 6i.1 compares the two operators after referring each to its
    // own clear field.
    expect(flat.intensity[0]!).toBeLessThan(0.5);
    // The fluorescence operator has no such loss: its kernel sums to 1, so a
    // uniform emitter field images as itself whatever the aperture is.
    const fluorescent = incoherentImage(uniformEmitters(ID_SIZE), CLEAR, {
      pupilSamples: ID_PUPIL_SAMPLES,
      throughput: ownUnits(CLEAR, ID_PUPIL_SAMPLES, ID_SIZE),
    });
    expect(fluorescent.intensity[0]!).toBeCloseTo(1, 12);
  });

  it("a condenser that does not reach 1 + B is NOT the incoherent limit", () => {
    // The negative control the identity needs: at S = 1 — a matched condenser,
    // the way a brightfield microscope is normally run — the same object images
    // measurably differently, so § 6i.1 is not true by construction.
    const amplitude = cosineGratingObject({ size: ID_SIZE, cycles: ID_CYCLES, modulation: 1 });
    const fluorescence = incoherentImage(emittersFromAmplitude(amplitude), CLEAR, {
      pupilSamples: ID_PUPIL_SAMPLES,
      throughput: ownUnits(CLEAR, ID_PUPIL_SAMPLES, ID_SIZE),
    });
    for (const S of [0.5, 1]) {
      const { image } = relativeAbbe(
        amplitude,
        latticeMatchedSource(S, ID_PUPIL_SAMPLES),
        ID_PUPIL_SAMPLES,
      );
      expect(maxRelative(fluorescence.intensity, image)).toBeGreaterThan(0.05);
    }
  });

  it("a grid too small for the pupil throws rather than truncating it", () => {
    // § 6f.3's discipline: a truncated pupil is indistinguishable from a smaller
    // aperture, so the coverage cap must not be silent. The boundary is exact —
    // pupilSamples + 2 is the first grid that holds the lattice's outer ring.
    expect(() => incoherentPsf(CLEAR, { size: 16, pupilSamples: 16 })).toThrow(/does not fit/);
    expect(() => incoherentPsf(CLEAR, { size: 32, pupilSamples: 32 })).toThrow(/at least 34/);
    expect(incoherentPsf(CLEAR, { size: 64, pupilSamples: 32 }).transmittingSamples).toBe(797);
  });

  it("`latticeMatchedSource` throws rather than rounding a fractional count", () => {
    // A rounded count still produces a perfectly plausible image, and its
    // disagreement with the incoherent limit would read as physics.
    expect(() => latticeMatchedSource(1.5, 17)).toThrow(/frequency step/);
    expect(latticeMatchedSource(ID_S, ID_PUPIL_SAMPLES).samples).toBe(25);
  });
});

describe("§ 6i.2 — what an unmatched source lattice costs, measured", () => {
  it("the residual against the incoherent limit falls with the source sampling", () => {
    const amplitude = cosineGratingObject({ size: ID_SIZE, cycles: ID_CYCLES, modulation: 0.5 });
    const fluorescence = incoherentImage(emittersFromAmplitude(amplitude), CLEAR, {
      pupilSamples: ID_PUPIL_SAMPLES,
      throughput: ownUnits(CLEAR, ID_PUPIL_SAMPLES, ID_SIZE),
    });
    const residuals = [9, 17, 33, 65].map((samples) => {
      const { image } = relativeAbbe(amplitude, diskSource(ID_S, samples), ID_PUPIL_SAMPLES);
      return maxRelative(fluorescence.intensity, image);
    });
    // 2.5e-2 → 2.0e-2 → 6.0e-3 → 2.0e-3: falling, and by 12× overall. The first
    // doubling barely moves, which is § 6f.2's own finding arriving here — the
    // error is a rim effect and its ratios are not monotone doubling-by-doubling,
    // so the rung pins the total and the endpoint rather than a halving.
    for (let i = 1; i < residuals.length; i++) expect(residuals[i]!).toBeLessThan(residuals[i - 1]!);
    expect(residuals[0]! / residuals[3]!).toBeGreaterThan(10);
    expect(residuals[3]!).toBeLessThan(3e-3);
  });
});

describe("§ 6i.3 — the transfer is a lattice point count, and it reaches ν = 2 with no condenser", () => {
  const SIZE = 128;
  const PUPIL_SAMPLES = 32;

  /** Contrast per unit modulation at ν = 2·cycles/pupilSamples. */
  const transferAt = (cycles: number, pupilSamples = PUPIL_SAMPLES, size = SIZE): number => {
    const modulation = 0.5;
    const emitters = cosineGratingEmitters({ size, cycles, modulation });
    const formed = incoherentImage(emitters, CLEAR, {
      pupilSamples,
      throughput: ownUnits(CLEAR, pupilSamples, size),
    });
    return contrastOf(formed.intensity, size) / modulation;
  };

  /**
   * The transfer as pure counting: lattice points the pupil and its ν-shifted
   * copy both transmit, over the points the pupil transmits.
   *
   * Written out here rather than imported, so the rung compares the engine
   * against an independent statement of what its own discretization means.
   */
  const countedTransfer = (nu: number, pupilSamples: number): number => {
    const step = 2 / pupilSamples;
    const reach = Math.ceil(1 / step) + 2;
    let inside = 0;
    let overlap = 0;
    for (let iy = -reach; iy <= reach; iy++) {
      for (let ix = -reach; ix <= reach; ix++) {
        const px = ix * step;
        const py = iy * step;
        if (px * px + py * py > 1) continue;
        inside++;
        if ((px + nu) * (px + nu) + py * py <= 1) overlap++;
      }
    }
    return overlap / inside;
  };

  it("the measured transfer IS the point count — exactly, at every frequency", () => {
    // The autocorrelation of a point-sampled clear pupil is a count of lattice
    // points, so this is an identity and not an approximation. It is what makes
    // the departure from the closed form below diagnosable rather than a
    // tolerance nobody can account for.
    for (const cycles of [4, 8, 16, 24, 31, 32]) {
      const nu = (2 * cycles) / PUPIL_SAMPLES;
      expect(transferAt(cycles)).toBeCloseTo(countedTransfer(nu, PUPIL_SAMPLES), 12);
    }
  });

  it("and it tracks `incoherentTransfer` — § 2b's closed form, no second number minted", () => {
    for (const cycles of [4, 8, 16, 24]) {
      const nu = (2 * cycles) / PUPIL_SAMPLES;
      expect(transferAt(cycles)).toBeCloseTo(incoherentTransfer(nu), 2);
    }
  });

  it("the departure from the closed form does NOT fall monotonically, because it counts", () => {
    // Refining the lattice at fixed ν gives 1.4e-4, 7.9e-4, 8.5e-5 — up, then
    // down. That is the Gauss circle problem, not a bug: the count of lattice
    // points in a disc oscillates about its area, so a rung asserting "smaller
    // every time" would be pinning the fluctuation. What is pinnable is the
    // bound, and that the counted value is exact at every one of them.
    const errors = [16, 32, 64].map((pupilSamples) => {
      const measured = transferAt(pupilSamples / 2, pupilSamples, 256);
      expect(measured).toBeCloseTo(countedTransfer(1, pupilSamples), 12);
      return Math.abs(measured - incoherentTransfer(1));
    });
    for (const e of errors) expect(e).toBeLessThan(1e-3);
    expect(errors[1]).toBeGreaterThan(errors[0]!);
  });

  it("transfer runs out at ν = 2 — `wave/mtf`'s cutoff, reached with no condenser at all", () => {
    // Brightfield needs a condenser matched to the objective to reach ν = 2
    // (§ 6f.1) and a closed diaphragm stops it at ν = 1. Fluorescence is there
    // with no condenser in the instrument: the emitters are mutually incoherent
    // by nature, so the aperture that would have to be opened does not exist.
    expect(transferAt(31)).toBeGreaterThan(0);
    // At ν = 2 exactly the two discs are tangent, and the lattice holds ONE
    // point there — the tangency itself, which is on the lattice because the
    // pupil radius is a whole number of steps. So the engine reads 1/797 where
    // the closed form reads 0, and that is the discretization being visible
    // rather than hidden.
    const kernel = incoherentPsf(CLEAR, { size: SIZE, pupilSamples: PUPIL_SAMPLES });
    expect(transferAt(32)).toBeCloseTo(1 / kernel.transmittingSamples, 12);
    expect(incoherentTransfer(2)).toBe(0);
    // Past tangency there is nothing to count, and the image is flat to f64.
    expect(transferAt(40)).toBeLessThan(1e-12);
  });

  it("a closed condenser transfers nothing at ν = 1.5 where fluorescence transfers 0.14", () => {
    // The two limits side by side on one frequency, which is what "no condenser
    // at all" buys: § 6f's coherent plateau ends in a cliff at ν = 1.
    const cycles = 24;
    const nu = (2 * cycles) / PUPIL_SAMPLES;
    expect(nu).toBe(1.5);
    const amplitude = cosineGratingObject({ size: SIZE, cycles, modulation: 0.4 });
    const coherent = abbeImage(amplitude, CLEAR, coherentSource(), {
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(contrastOf(coherent.intensity, SIZE)).toBeLessThan(1e-12);
    expect(transferAt(cycles)).toBeGreaterThan(0.14);
  });
});

describe("§ 6i.4 — the window goes back on the input, and here that is exact", () => {
  const SIZE = 64;
  const PUPIL_SAMPLES = 32;
  const EMITTERS = cosineGratingEmitters({ size: SIZE, cycles: 8, modulation: 0.6 });
  const flatField = (): ((u: number, v: number) => PatchPupil) => () => ({ pupil: CLEAR });

  it("a shift-invariant pupil renders identically at any patch count", () => {
    // The partition of unity splits the EMITTERS and the imaging is linear in
    // them, so Σ_p h ⊛ (w_p·E) = h ⊛ E identically. § 6g.2's C = Σ√(w₁w₂) is a
    // factor on an interference term and a fluorescent object has none — which
    // is why the side `imaging/render` argues for is available here and
    // unavailable to `imaging/brightfield`, where the same split deleted 89% of
    // the interference at 16 patches.
    const one = renderFluorescence(EMITTERS, flatField(), {
      patches: 1,
      pupilSamples: PUPIL_SAMPLES,
      throughput: { kind: "transmitted" },
    });
    for (const patches of [2, 4, 8]) {
      const many = renderFluorescence(EMITTERS, flatField(), {
        patches,
        pupilSamples: PUPIL_SAMPLES,
        throughput: { kind: "transmitted" },
      });
      expect(maxRelative(one.intensity, many.intensity)).toBeLessThan(1e-12);
    }
  });

  it("light is conserved: the image holds exactly the emitted power", () => {
    // The kernel sums to 1 and the windows sum to 1, so neither the optics nor
    // the decomposition may invent or lose a photon. Circular convolution is
    // what makes it exact rather than edge-limited: light leaving one side of
    // the frame returns on the other, the wrap § 4's app surfaces rather than
    // hides.
    const emitted = EMITTERS.values.reduce((a, b) => a + b, 0);
    for (const patches of [1, 4]) {
      const formed = renderFluorescence(EMITTERS, flatField(), {
        patches,
        pupilSamples: PUPIL_SAMPLES,
        throughput: ownUnits(CLEAR, PUPIL_SAMPLES, SIZE),
      });
      expect(formed.intensity.reduce((a, b) => a + b, 0) / emitted).toBeCloseTo(1, 12);
    }
  });

  it("with a pupil that genuinely varies, refining the patches converges", () => {
    // § 6g.3's fixture: defocus ramping across the frame, so the two edges have
    // different and exactly known pupils. Here the decomposition is not exact,
    // and the residual is measured as convergence rather than claimed as a
    // closed form.
    const varying = (u: number): PatchPupil => ({ pupil: defocusedPupil(0.1 + 0.8 * u) });
    const images = [1, 2, 4, 8, 16].map(
      (patches) =>
        renderFluorescence(EMITTERS, varying, {
          patches,
          pupilSamples: PUPIL_SAMPLES,
          throughput: { kind: "transmitted" },
        }).intensity,
    );
    const steps = [1, 2, 3, 4].map((i) => maxRelative(images[i]!, images[i - 1]!));
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(steps[3]!).toBeLessThan(0.1 * steps[0]!);
  });
});

describe("§ 6i.5 — a traced objective, and why beads are the first specimen", () => {
  const SIZE = 64;
  const PUPIL_SAMPLES = 32;
  const LAMBDA = 587.5618;
  const din4x = () =>
    finiteConjugateMicroscope({
      objective: finiteConjugateObjective({
        magnification: 4,
        numericalAperture: 0.1,
        stopPlacement: "rim",
      }),
    }).system;
  /** § 6ai's shipped placement — the same glass, telecentric. */
  const telecentricDin4x = () =>
    finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
  const frameOf = (system: ReturnType<typeof din4x>) =>
    objectFieldFrame(system, { size: SIZE, pupilSamples: PUPIL_SAMPLES, wavelengthNm: LAMBDA });

  it("a bead is placed by its own traced chief ray, so distortion is carried", () => {
    // § 6h left the GRID unwarped — a specimen authored by uniform scaling is
    // still laid down on the paraxial map — and a scene of points does not need
    // that missing rasterizer, because each point is mapped on its own. The
    // departure from the paraxial placement is the distortion, which § 6h.1 pins
    // growing as the cube of the field.
    const system = din4x();
    const frame = frameOf(system);
    const heightMm = frame.objectHalfExtentMm * 0.75;
    const traced = imageRadiusForObjectHeight(system, heightMm, LAMBDA);
    const paraxial = heightMm * Math.abs(frame.magnification);
    expect(traced).not.toBe(paraxial);

    const field = rasterizeEmitters(system, frame, [{ xMm: heightMm, yMm: 0, flux: 1 }]);
    // Bilinear splat along the axis row: the two cells straddling the traced
    // position hold all of it, and the placement is the traced one.
    const px = SIZE / 2 + traced / frame.pixelScaleMm;
    const x0 = Math.floor(px);
    const row = SIZE / 2;
    const held = field.values[row * SIZE + x0]! + field.values[row * SIZE + x0 + 1]!;
    expect(held).toBeCloseTo(1, 12);
    expect(field.values[row * SIZE + x0 + 1]! / held).toBeCloseTo(px - x0, 12);
  });

  it("the corner's traced pupil forms a lower-peaked kernel than the axis's", () => {
    // § 6h.5 measured 8.8e-3 waves of corner coma on this objective against the
    // axis's 7.5e-6 fit noise. The kernel is normalized to unit sum, so its peak
    // IS a Strehl-like readout and the field aberration has to show there.
    const system = din4x();
    const frame = frameOf(system);
    const peakAt = (u: number, v: number): number => {
      const patch = fieldPupilAt(system, frame, u, v);
      const kernel = incoherentPsf(patch.pupil, { size: SIZE, pupilSamples: PUPIL_SAMPLES });
      let peak = 0;
      for (let i = 0; i < kernel.values.length; i++) peak = Math.max(peak, kernel.values[i]!);
      return peak;
    };
    //
    // § 6ai is where this rung found its own limit. On the shipped telecentric
    // objective the corner peak comes back 0.2% ABOVE the axis rather than 0.7%
    // below it, and the honest reading is not that the corner got better — it is
    // that over 47 µm the two are the same kernel and the sign of a 0.2%
    // difference is not something this frame can order. What survives the flip,
    // and is the sentence the rung exists for, is the SIZE: under 1% either way
    // on both members, and three times closer to equality on the lens whose
    // off-axis wavefront § 6ag.4 measures as the better one.
    //
    // So the direction is asserted where there is enough coma to have one, and
    // the bound is asserted on both.
    const axis = peakAt(0.5, 0.5);
    expect(peakAt(1, 1)).toBeLessThan(axis);
    // Small, and it must be: this frame spans 47 µm of specimen, well inside a
    // corrected 4×'s isoplanatic patch (§ 6h.5).
    expect(peakAt(1, 1) / axis).toBeGreaterThan(0.99);
    expect(Math.abs(frame.objectHalfExtentMm * 1000 - 46.77)).toBeLessThan(0.01);

    const telecentric = telecentricDin4x();
    const telecentricFrame = frameOf(telecentric);
    const telecentricPeakAt = (u: number, v: number): number => {
      const patch = fieldPupilAt(telecentric, telecentricFrame, u, v);
      const kernel = incoherentPsf(patch.pupil, { size: SIZE, pupilSamples: PUPIL_SAMPLES });
      let peak = 0;
      for (let i = 0; i < kernel.values.length; i++) peak = Math.max(peak, kernel.values[i]!);
      return peak;
    };
    const telecentricRatio = telecentricPeakAt(1, 1) / telecentricPeakAt(0.5, 0.5);
    expect(Math.abs(telecentricRatio - 1)).toBeLessThan(0.01);
    expect(Math.abs(telecentricRatio - 1)).toBeLessThan(Math.abs(peakAt(1, 1) / axis - 1));
  });

  it("a bead field renders through the traced pupils, and holds the light they passed", () => {
    const system = din4x();
    const frame = frameOf(system);
    const r = frame.objectHalfExtentMm * 0.5;
    const field = rasterizeEmitters(system, frame, [
      { xMm: 0, yMm: 0, flux: 1 },
      { xMm: r, yMm: 0, flux: 0.5 },
      { xMm: -r, yMm: r, flux: 0.25 },
    ]);
    const emitted = field.values.reduce((a, b) => a + b, 0);
    expect(emitted).toBeCloseTo(1.75, 9);

    const formed = renderFluorescence(field, tracedFieldPupils(system, frame), {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
      throughput: { kind: "transmitted" },
    });
    // § 6bc. This ratio read exactly 1 until the render stopped normalizing
    // each patch's own weight away, and that 1 was arithmetic — § 6k.3's trap,
    // arriving in the operator rather than in a readout. What the image holds is
    // the emitted light times what the pupils transmitted, so it is bracketed by
    // the patches' own weights and nowhere near 1.
    const held = formed.intensity.reduce((a, b) => a + b, 0);
    const lo = Math.min(...formed.patchThroughput);
    const hi = Math.max(...formed.patchThroughput);
    expect(hi).toBeGreaterThan(lo);
    expect(held / emitted).toBeGreaterThanOrEqual(lo);
    expect(held / emitted).toBeLessThanOrEqual(hi);
    // The conservation that survives: the render invents and loses nothing
    // against the flux those weights allow, which is § 6i's claim about the
    // partition of unity with the units it was hiding put back.
    expect(Math.abs(held / formed.weightedEmittedFlux - 1)).toBeLessThan(1e-12);
    expect(formed.pixelScaleMm).toBeCloseTo(frame.pixelScaleMm, 12);
  });
});

describe("§ 6i.6 — the object brightfield structurally cannot see", () => {
  const SIZE = 64;
  const PUPIL_SAMPLES = 32;
  const CYCLES = 8;
  const NU = (2 * CYCLES) / PUPIL_SAMPLES;

  const brightfieldPhaseContrast = (amplitudeRadians: number): number => {
    const g = phaseGratingObject({ size: SIZE, cycles: CYCLES, amplitudeRadians });
    const formed = abbeImage(g, CLEAR, diskSource(0.6, 9), { pupilSamples: PUPIL_SAMPLES });
    return contrastOf(formed.intensity, SIZE);
  };

  it("brightfield's phase contrast is SECOND order — there is no linear term to see with", () => {
    // § 6f.5 owns the null itself. What it means for this step is the order: the
    // contrast a phase grating shows in brightfield goes as φ², so it is not a
    // faint image of the object, it is the object's *square* — 2.2e-5 at
    // φ = 0.01 rad and 100× that at φ = 0.1.
    const phis = [0.01, 0.02, 0.05, 0.1];
    const contrasts = phis.map(brightfieldPhaseContrast);
    // 1.99943 over this range, and the 6e-4 shortfall is not noise: it is the
    // NEXT term. `phaseGratingObject` carries every Bessel order the grid holds,
    // not the weak truncation — so φ⁴ is genuinely present and biases a log-log slope
    // downward at the top of the range. Dropping the largest φ recovers the
    // order more tightly, which is what identifies the culprit rather than
    // assuming it.
    expect(fittedOrder(phis, contrasts)).toBeCloseTo(2, 2);
    expect(fittedOrder(phis.slice(0, 3), contrasts.slice(0, 3))).toBeCloseTo(2, 3);
    expect(contrasts[0]!).toBeLessThan(1e-4);
  });

  it("label the same structure and it images with the full incoherent transfer", () => {
    // The other answer to § 6f.5's "why stains exist": what fluorescence images
    // is the emitter density, and a tagged phase object has one. The contrast is
    // linear in the label's modulation and lands on the closed form — four
    // orders of magnitude above what the unlabelled phase object showed.
    const labelled = cosineGratingEmitters({ size: SIZE, cycles: CYCLES, modulation: 0.5 });
    const formed = incoherentImage(labelled, CLEAR, {
      pupilSamples: PUPIL_SAMPLES,
      throughput: ownUnits(CLEAR, PUPIL_SAMPLES, SIZE),
    });
    const contrast = contrastOf(formed.intensity, SIZE);
    expect(contrast / 0.5).toBeCloseTo(incoherentTransfer(NU), 2);
    expect(contrast).toBeGreaterThan(1e4 * brightfieldPhaseContrast(0.01));
  });

  it("a uniformly fluorescing field images as itself — the negative control", () => {
    const formed = incoherentImage(uniformEmitters(SIZE, 3), CLEAR, {
      pupilSamples: PUPIL_SAMPLES,
      throughput: ownUnits(CLEAR, PUPIL_SAMPLES, SIZE),
    });
    for (let i = 0; i < formed.intensity.length; i++) {
      expect(formed.intensity[i]!).toBeCloseTo(3, 12);
    }
  });
});
