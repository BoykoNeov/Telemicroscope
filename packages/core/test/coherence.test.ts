import { describe, it, expect } from "vitest";
import {
  BESSEL_J1_FIRST_ZERO,
  coherenceWidthCells,
  coherenceWidthMm,
  mutualCoherence,
  phasePerCell,
  vanCittertZernikeDisk,
  windowMixingFactor,
} from "../src/illumination/coherence";
import { coherentSource, diskSource, annularSource } from "../src/illumination/source";
import { abbeImage, type ObjectField } from "../src/illumination/abbe";
import { idealPupil } from "../src/illumination/transfer";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../src/wave/psf";
import { patchWeight } from "../src/imaging/render";

/**
 * § 6g.1–6g.2 — how far the illumination stays coherent across the specimen,
 * and what a field decomposition is therefore allowed to window.
 *
 * The grid is deliberately small. Most rungs here are sums over source points
 * with no transform in them at all, and the ones that DO form images check
 * identities that hold for any source whatsoever, so a finely sampled condenser
 * would buy nothing but wall clock.
 */

const SIZE = 128;
const PUPIL_SAMPLES = 32;
const GRID = { pupilSamples: PUPIL_SAMPLES, size: SIZE };

/** A pupil scale with a round NA, so the textbook width is checkable by hand. */
const SCALE: PupilScale = {
  referenceRadius: 100,
  exitRadius: 25,
  wavelengthNm: 550,
  nImage: 1,
};
const NA = (SCALE.nImage * SCALE.exitRadius) / SCALE.referenceRadius; // 0.25

/**
 * A Gaussian-apodized pupil, for the one rung that compares the image against a
 * CONTINUUM identity.
 *
 * `abbe.ts` point-samples the pupil on the DFT lattice deliberately (its own
 * note says why), so an ideal pupil's hard rim is rasterized: which lattice
 * points fall inside the disc changes with the illumination direction, and the
 * resulting few-1e-4 wobble in the cross-term energy is not a continuum effect
 * at all. Apodizing removes the rim without removing anything the rung is
 * about — the factorization being checked is a statement about phase ramps, and
 * the amplitude profile is a spectator. e^(−(r/0.3)²) is below 1e-5 by the edge
 * of the sampled box, so nothing is truncated either.
 */
const APODIZED: PupilFunction = {
  amplitude: (x, y) => Math.exp(-(x * x + y * y) / (0.3 * 0.3)),
  phaseWaves: () => 0,
};

/** Object with unit amplitude at the listed cells and nothing anywhere else. */
function points(cells: readonly { x: number; y: number; a: number }[]): ObjectField {
  const re = new Float64Array(SIZE * SIZE);
  for (const c of cells) re[c.y * SIZE + c.x] = c.a;
  return { size: SIZE, re, im: new Float64Array(SIZE * SIZE) };
}

function image(
  object: ObjectField,
  source: ReturnType<typeof diskSource> = coherentSource(),
  pupil: PupilFunction = idealPupil(),
): Float64Array {
  return abbeImage(object, pupil, source, { pupilSamples: PUPIL_SAMPLES }).intensity;
}

/** The two object points every cross-term rung below uses. */
const Y = SIZE / 2;
const X1 = SIZE / 2 - 4;
const X2 = SIZE / 2 + 4;
const SEPARATION = X2 - X1;

describe("the coherence of the illumination across the specimen (§ 6g.1)", () => {
  it("μ(0) = 1, and a point source is coherent at every separation", () => {
    for (const S of [0, 0.3, 1, 1.6]) {
      const mu = mutualCoherence(diskSource(S, 9), 0, 0, GRID);
      expect(mu.re).toBeCloseTo(1, 14);
      expect(mu.im).toBeCloseTo(0, 14);
    }
    // The coherent limit is the source of zero extent, and its transform is
    // flat: every pair of object points interferes at full strength however far
    // apart they are. That is the whole reason S → 0 gives § 6f's plateau.
    for (const d of [1, 7, 40]) {
      expect(mutualCoherence(coherentSource(), d, 0, GRID).modulus).toBeCloseTo(1, 15);
    }
  });

  it("a disc condenser reproduces van Cittert–Zernike: μ = 2J₁(v)/v", () => {
    // The sampled source converges on the continuous disc's transform, and the
    // gap is the source's own discretization — § 6f.2's convergence knob seen
    // from the object side rather than from the transfer function.
    const worstAt = (samples: number): number => {
      let worst = 0;
      for (const S of [0.2, 0.5, 0.9, 1.4]) {
        // Sweep out to v ≈ 17, which covers the first four zeros of the jinc.
        const maxCells = 17 / (phasePerCell(GRID) * S);
        for (let d = 0; d <= maxCells; d += maxCells / 12) {
          const sum = mutualCoherence(diskSource(S, samples), d, 0, GRID);
          const closed = vanCittertZernikeDisk(S, d, 0, GRID);
          worst = Math.max(worst, Math.abs(sum.re - closed));
          // A centro-symmetric source has no imaginary part at all: the fringes
          // sit where the geometry says, and any drift would be a decentred
          // condenser the caller did not ask for.
          worst = Math.max(worst, Math.abs(sum.im));
        }
      }
      return worst;
    };
    const coarse = worstAt(9);
    const fine = worstAt(33);
    const finest = worstAt(129);
    expect(fine).toBeLessThan(coarse);
    expect(finest).toBeLessThan(fine);
    expect(finest).toBeLessThan(3e-3);
  });

  it("its first zero is the classical coherence width, 0.61·λ/NA_condenser", () => {
    // Bisect the sampled μ for its first zero and hand the answer to the
    // textbook form. The engine never carries 0.61: the constant it holds is
    // j₁,₁, and 0.61 = j₁,₁/2π is what comes back out.
    const pixelScaleMm = imagePixelScaleMm(SCALE, SIZE, PUPIL_SAMPLES);
    const firstZeroCells = (S: number, samples: number): number => {
      const source = diskSource(S, samples);
      let lo = 0;
      let hi = coherenceWidthCells(S, GRID) * 2;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (mutualCoherence(source, mid, 0, GRID).re > 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };

    for (const S of [0.4, 0.75, 1.2]) {
      const closedCells = coherenceWidthCells(S, GRID);
      const measuredCells = firstZeroCells(S, 257);
      expect(Math.abs(measuredCells / closedCells - 1)).toBeLessThan(2e-4);
      // …and in millimetres it is the textbook width of a condenser of
      // NA = S·NA_objective. This is the external number, and nothing in the
      // chain that produced it knew what a millimetre was until this line.
      const measuredMm = measuredCells * pixelScaleMm;
      expect(Math.abs(measuredMm / coherenceWidthMm(S * NA, SCALE.wavelengthNm) - 1)).toBeLessThan(
        2e-4,
      );
      expect(Math.abs(measuredMm / ((0.61 * SCALE.wavelengthNm * 1e-6) / (S * NA)) - 1)).toBeLessThan(
        1e-3,
      );
    }

    // The discretization converges, and NOT monotonically: the error is set by
    // how the square lattice happens to cut the rim of the disc at each count,
    // so it is a magnitude that falls rather than a sequence that descends.
    // Recorded as measured — 7.7e-3 at 17 samples down to 4.1e-5 at 257.
    const errors = [17, 33, 65, 129, 257].map((n) =>
      Math.abs(firstZeroCells(0.75, n) / coherenceWidthCells(0.75, GRID) - 1),
    );
    expect(errors[0]!).toBeGreaterThan(5e-3);
    expect(errors[4]!).toBeLessThan(1e-4);
    expect(Math.max(...errors.slice(3))).toBeLessThan(Math.max(...errors.slice(0, 2)));

    // The 0.61 is not a second copy of Rayleigh's — it is the same j₁,₁.
    expect(BESSEL_J1_FIRST_ZERO / (2 * Math.PI)).toBeCloseTo(0.61, 3);
  });

  it("μ is what the Abbe image actually contains, not a parallel model", () => {
    // The cross term of a two-point object, measured off the image sum and
    // divided by the same thing under coherent illumination. The algebra says
    // that ratio is Re(μ) — the illumination direction multiplies the object by
    // a phase ramp, so the pair's cross term picks up exp(2πi·s·Δ) and the
    // source sum of that IS μ. So this is an identity between the imaging code
    // and the coherence code, holding at separations either side of the first
    // zero and through it.
    const both = points([
      { x: X1, y: Y, a: 1 },
      { x: X2, y: Y, a: 1 },
    ]);
    const one = points([{ x: X1, y: Y, a: 1 }]);
    const other = points([{ x: X2, y: Y, a: 1 }]);
    const crossEnergy = (source: ReturnType<typeof diskSource>, pupil: PupilFunction): number => {
      // Each point's own image has to be formed under the SAME source: a
      // rasterized pupil transmits a slightly different set of lattice points
      // from each direction, so a self term computed once and reused would leak
      // that difference into the cross term.
      const full = image(both, source, pupil);
      const i1 = image(one, source, pupil);
      const i2 = image(other, source, pupil);
      let sum = 0;
      for (let i = 0; i < full.length; i++) sum += full[i]! - i1[i]! - i2[i]!;
      return sum;
    };

    const coherentCross = crossEnergy(diskSource(0, 1), APODIZED);
    expect(Math.abs(coherentCross)).toBeGreaterThan(1e-6);
    for (const S of [0.3, 0.61, 0.9, 1.3]) {
      const source = diskSource(S, 9);
      const ratio = crossEnergy(source, APODIZED) / coherentCross;
      expect(ratio).toBeCloseTo(mutualCoherence(source, SEPARATION, 0, GRID).re, 9);
    }

    // The same identity through the hard-rimmed ideal pupil holds only to a few
    // 1e-2. That is not the physics changing: it is `abbe.ts`'s point-sampled
    // rim, whose transmitting set shifts with the illumination direction. The
    // absolute wobble in the cross energy is a few 1e-4 and roughly fixed, so it
    // reads worst here, where the disc's own autocorrelation at this separation
    // is small and divides it up. Recorded rather than tuned around, because a
    // later reader measuring 2% on a hard pupil should find it already named.
    const hardCoherent = crossEnergy(diskSource(0, 1), idealPupil());
    let worstHard = 0;
    for (const S of [0.3, 0.61, 0.9, 1.3]) {
      const source = diskSource(S, 9);
      worstHard = Math.max(
        worstHard,
        Math.abs(
          crossEnergy(source, idealPupil()) / hardCoherent -
            mutualCoherence(source, SEPARATION, 0, GRID).re,
        ),
      );
    }
    expect(worstHard).toBeGreaterThan(1e-3);
    expect(worstHard).toBeLessThan(5e-2);
  });

  it("past the first zero the interference comes back inverted, not absent", () => {
    // A jinc does not decay to nothing monotonically, and the sign matters: two
    // object points beyond the coherence width are anti-correlated before they
    // are uncorrelated. Naming the width by the first zero rather than by a
    // half-height is what keeps that visible.
    const S = 1;
    const first = coherenceWidthCells(S, GRID);
    const source = diskSource(S, 65);
    expect(mutualCoherence(source, first * 0.5, 0, GRID).re).toBeGreaterThan(0);
    expect(mutualCoherence(source, first * 1.35, 0, GRID).re).toBeLessThan(0);
    // And an annulus is not a disc: the same outer radius, hollowed out, holds
    // its coherence further because the transform of a ring decays more slowly.
    const ring = annularSource(S, 0.8 * S, 65);
    const disc = diskSource(S, 65);
    const far = first * 1.8;
    expect(Math.abs(mutualCoherence(ring, far, 0, GRID).re)).toBeGreaterThan(
      Math.abs(mutualCoherence(disc, far, 0, GRID).re),
    );
  });
});

describe("what a partition of unity may window, and what it must not (§ 6g.2)", () => {
  const both = points([
    { x: X1, y: Y, a: 1 },
    { x: X2, y: Y, a: 1 },
  ]);
  const one = points([{ x: X1, y: Y, a: 1 }]);
  const other = points([{ x: X2, y: Y, a: 1 }]);

  function windowsAt(x: number, patches: number): number[] {
    const u = (x + 0.5) / SIZE;
    return Array.from({ length: patches }, (_, p) => patchWeight(u, p, patches));
  }

  /** Σ_p image( √w_p · object ) — the input-side scheme `imaging/render` uses. */
  function inputWindowedImage(
    w1: readonly number[],
    w2: readonly number[],
    source: ReturnType<typeof diskSource>,
  ): Float64Array {
    const out = new Float64Array(SIZE * SIZE);
    for (let p = 0; p < w1.length; p++) {
      const part = image(
        points([
          { x: X1, y: Y, a: Math.sqrt(w1[p]!) },
          { x: X2, y: Y, a: Math.sqrt(w2[p]!) },
        ]),
        source,
      );
      for (let i = 0; i < out.length; i++) out[i] = out[i]! + part[i]!;
    }
    return out;
  }

  it("C = Σ√(w₁w₂) is 1 in a shared mixture, 0 across a seam, and ≤ 1 between", () => {
    expect(windowMixingFactor([0.3, 0.7], [0.3, 0.7])).toBeCloseTo(1, 15);
    expect(windowMixingFactor([1, 0], [0, 1])).toBe(0);
    expect(windowMixingFactor([0.8, 0.2], [0.2, 0.8])).toBeLessThan(1);
    // Cauchy–Schwarz, over a spread of real partitions.
    for (let k = 0; k <= 10; k++) {
      const a = k / 10;
      for (let j = 0; j <= 10; j++) {
        const b = j / 10;
        expect(windowMixingFactor([a, 1 - a], [b, 1 - b])).toBeLessThanOrEqual(1 + 1e-15);
      }
    }
    // Second order in the window difference — the expansion the module states,
    // which is why a fine patch grid is not automatically a safe one: the
    // coefficient blows up at the edges of the window, where the seams are. The
    // residual is the next order, so it falls by 10× per 10× in δ.
    for (const alpha of [0.5, 0.2, 0.05]) {
      let previous = Infinity;
      for (const delta of [1e-3, 1e-4]) {
        const c = windowMixingFactor([alpha, 1 - alpha], [alpha + delta, 1 - alpha - delta]);
        const predicted = ((delta * delta) / 8) * (1 / alpha + 1 / (1 - alpha));
        const relative = Math.abs((1 - c) / predicted - 1);
        expect(relative).toBeLessThan(0.02);
        expect(relative).toBeLessThan(previous);
        previous = relative;
      }
    }
    expect(() => windowMixingFactor([0.5, 0.4], [0.5, 0.5])).toThrow(/partition of unity/);
  });

  it("windowing the INPUT multiplies the interference by exactly C — pointwise", () => {
    // The finding. Splitting an object amplitude between patches returns the
    // self terms whole and the cross term scaled, and the scale factor is
    // geometry alone: no wavelength, no NA and no S anywhere in it. It needs
    // nothing of the pupil either, so it is checked on the hard-rimmed ideal
    // one — this is algebra about the windows, not about the aperture.
    const source = coherentSource();
    const full = image(both, source);
    const i1 = image(one, source);
    const i2 = image(other, source);
    for (const patches of [2, 8, 16]) {
      const w1 = windowsAt(X1, patches);
      const w2 = windowsAt(X2, patches);
      const c = windowMixingFactor(w1, w2);
      const windowed = inputWindowedImage(w1, w2, source);
      let worst = 0;
      let peak = 0;
      for (let i = 0; i < full.length; i++) {
        const crossFull = full[i]! - i1[i]! - i2[i]!;
        const crossWindowed = windowed[i]! - i1[i]! - i2[i]!;
        worst = Math.max(worst, Math.abs(crossWindowed - c * crossFull));
        peak = Math.max(peak, Math.abs(crossFull));
      }
      expect(worst).toBeLessThan(1e-12 * peak);
    }
    // …and the loss is not a rounding detail. At 16 patches over this 128-cell
    // grid a patch is 8 cells wide — the separation itself — so the two points
    // sit in almost disjoint windows and nine tenths of their interference is
    // simply gone.
    const c16 = windowMixingFactor(windowsAt(X1, 16), windowsAt(X2, 16));
    expect(c16).toBeGreaterThan(0.05);
    expect(c16).toBeLessThan(0.2);
    // Two patches over the same grid is the benign end: the ramp is the whole
    // frame, so an 8-cell separation costs under two percent — and even that is
    // only small because the seam happens to be where the ramp is steepest.
    expect(windowMixingFactor(windowsAt(X1, 2), windowsAt(X2, 2))).toBeGreaterThan(0.98);
  });

  it("…and it is S-independent: the physics of the error lives in μ, not in C", () => {
    // The error factorizes, error = (1 − C)·|cross term| with cross term ∝ μ.
    // C is the same number under every condenser, which is the half of the law
    // that makes it a property of the decomposition rather than of the light.
    const w1 = windowsAt(X1, 8);
    const w2 = windowsAt(X2, 8);
    const c = windowMixingFactor(w1, w2);
    for (const S of [0, 0.5, 1.1]) {
      const source = diskSource(S, 9);
      const full = image(both, source);
      const i1 = image(one, source);
      const i2 = image(other, source);
      const windowed = inputWindowedImage(w1, w2, source);
      let crossFull = 0;
      let crossWindowed = 0;
      for (let i = 0; i < full.length; i++) {
        crossFull += full[i]! - i1[i]! - i2[i]!;
        crossWindowed += windowed[i]! - i1[i]! - i2[i]!;
      }
      expect(crossWindowed / crossFull).toBeCloseTo(c, 10);
    }
  });

  it("windowing the OUTPUT costs nothing where the pupil is the same", () => {
    // The scheme the bridge must use instead. Σ_p w_p ≡ 1, and the image each
    // patch forms is the same image, so the blend is the identity — exactly, at
    // every patch count, with no cross term touched.
    const full = image(both);
    for (const patches of [2, 8, 16]) {
      const blended = new Float64Array(SIZE * SIZE);
      for (let p = 0; p < patches; p++) {
        for (let y = 0; y < SIZE; y++) {
          const wy = patchWeight((y + 0.5) / SIZE, p, patches);
          if (wy === 0) continue;
          for (let x = 0; x < SIZE; x++) {
            blended[y * SIZE + x] = blended[y * SIZE + x]! + wy * full[y * SIZE + x]!;
          }
        }
      }
      let worst = 0;
      for (let i = 0; i < full.length; i++) {
        worst = Math.max(worst, Math.abs(blended[i]! - full[i]!));
      }
      expect(worst).toBeLessThan(1e-12);
    }
  });

  it("energy is not a witness: it partitions at the object, and the image deficit IS the cross term", () => {
    // The check this engine reaches for first, and here it decides nothing. At
    // the OBJECT the split is exact by construction — Σ_p w_p ≡ 1 — so a
    // conservation test passes for the scheme that deletes the interference.
    const w1 = windowsAt(X1, 16);
    const w2 = windowsAt(X2, 16);
    const c = windowMixingFactor(w1, w2);
    let objectEnergy = 0;
    for (let p = 0; p < w1.length; p++) objectEnergy += w1[p]! + w2[p]!;
    expect(objectEnergy).toBeCloseTo(2, 12);

    // In the IMAGE the two schemes do differ — but by exactly (1 − C) times the
    // cross-term energy, which is the quantity the rung above already measures.
    // Energy adds no independent handle on the error; it is the same number
    // wearing a different name.
    const source = coherentSource();
    const full = image(both, source);
    const i1 = image(one, source);
    const i2 = image(other, source);
    const windowed = inputWindowedImage(w1, w2, source);
    let crossFull = 0;
    let deficit = 0;
    for (let i = 0; i < full.length; i++) {
      crossFull += full[i]! - i1[i]! - i2[i]!;
      deficit += full[i]! - windowed[i]!;
    }
    expect(deficit).toBeCloseTo((1 - c) * crossFull, 10);
    // And it shrinks with the coherence rather than with the error: open the
    // condenser and the cross term collapses, so the input scheme's energy books
    // balance while the scheme it is hiding has not changed at all.
    const open = diskSource(1.3, 9);
    let openCross = 0;
    const openFull = image(both, open);
    const openI1 = image(one, open);
    const openI2 = image(other, open);
    for (let i = 0; i < openFull.length; i++) {
      openCross += openFull[i]! - openI1[i]! - openI2[i]!;
    }
    expect(Math.abs(openCross)).toBeLessThan(0.2 * Math.abs(crossFull));
    expect(windowMixingFactor(w1, w2)).toBeCloseTo(c, 15);
  });

  it("phasePerCell is the one coordinate fact both halves rest on", () => {
    // π·pupilSamples/size, and nothing else may derive it a second time: the
    // sum and the closed form disagreeing about it would look exactly like a
    // wrong coherence width.
    expect(phasePerCell(GRID)).toBeCloseTo((Math.PI * PUPIL_SAMPLES) / SIZE, 15);
    // A unit shift of the pupil is a full period of object phase over
    // 2·size/pupilSamples cells — i.e. over the width of one coherent PSF.
    const oneShift = {
      points: [{ sx: 1, sy: 0, weight: 1 }],
      coherenceParameter: 1,
      samples: 1,
    };
    const period = (2 * SIZE) / PUPIL_SAMPLES;
    expect(mutualCoherence(oneShift, period, 0, GRID).re).toBeCloseTo(1, 12);
    expect(mutualCoherence(oneShift, period / 2, 0, GRID).re).toBeCloseTo(-1, 12);
  });
});
