import { describe, it, expect } from "vitest";
import { imageHarmonic } from "../src/illumination/abbe";

/**
 * Step 6am — the self-conjugate bins of the measurement every § 6f rung is made
 * with.
 *
 * `imageHarmonic` is not physics: it is the readout that turns a rendered
 * intensity into "how much of this periodicity survived", and every contrast
 * number from § 6f onward is one of its returns. § 6al.8 found it wrong at two
 * of its bins and pinned the error as a factor rather than fixing it, because a
 * readout four rungs and two panels share is its own change. This is that
 * change.
 *
 * ## The defect
 *
 * The reading doubled a bin's modulus at every bin, on the stated grounds that
 * "a real image splits its energy between the ±k bins". True wherever the ±k
 * bins are two bins. They are one bin when (−kx, −ky) ≡ (kx, ky) on an N-point
 * grid, which is exactly 2k ≡ 0 in each axis: **k = 0 and k = N/2**, and in 2-D
 * the four corners those make. There the single bin already carries the whole
 * component, and doubling it reports twice the modulation that is in the image.
 *
 * ## The external numbers
 *
 * There is no engine and no optics below this line, which is the point: the
 * claims are arithmetic, and they are checked against arithmetic.
 *
 *  - **An image whose Fourier components are authored rather than rendered.** A
 *    sum of cosines with chosen amplitudes, evaluated on the grid; each one read
 *    back must be the amplitude it was built with (§ 6am.1, § 6am.2). Nothing
 *    here is this engine agreeing with itself — the object is written down.
 *  - **Rayleigh's theorem**, as the variance of the pixels: the mean square
 *    about the mean is what the components put there, and the weights are the
 *    two trigonometric means ⟨cos²(θx)⟩ = ½ and ⟨cos²(πx)⟩ = 1. Computed from
 *    the pixels directly, so it does not go through the readout at all
 *    (§ 6am.3). This is the rung the old formula fails, and it fails it by a
 *    predictable amount rather than by "some".
 *  - **The DFT's own periodicity**, k ≡ k + N, against the classification
 *    (§ 6am.5).
 *
 * ## What § 6al.8 got wrong about the reach, and this step corrects
 *
 * § 6al.8's deferral said the fix mattered because `app/brightfield.ts` and
 * `app/phase.ts` "both compute a harmonic bin as h·cycles and can reach N/2".
 * The first half is true and the second is not, and it is worth correcting in
 * place rather than leaving a wrong justification standing under a step that
 * closes it. Every h·cycles path is guarded with a strict `<`:
 * `secondBin < size / 2` in both panels' frame readouts, `h * cycles < size / 2`
 * in `panelHarmonics`, and `floor(size / 2) - 1` as the top of the fluorescence
 * sweep. The h·cycles route is the one route that cannot get there.
 *
 * The unguarded reads are the **fundamentals** — `imageHarmonic(…, cycles)` in
 * `renderBrightfieldScene` and in the phase panel's frame — and those are held
 * off Nyquist one level up, by the panels' own `maxCycles`: `size / 2 - 1` for
 * brightfield and `floor(size / 4) - 1` for phase. So no slider reaches it. What
 * reaches it is a hand-built request through the exported entry points, and a
 * test: § 6al.8's own sweep stopped at six cycles for exactly this reason.
 *
 * That makes the honest re-pin count **one**, not four — `telecentric-scene`'s
 * bin 16, where the ratio the old code made 2.0000000000 is now 1 to 7e−13. The
 * other three files that touch a self-conjugate bin ask it for `.dc`, which is
 * the mean and was never doubled, or read bin 32 of a 128 grid, which is an
 * ordinary bin. The suite bears this out: the change moved one assertion in
 * 2583.
 */

/** One grid for the whole step. 32 is small enough to write the components of
 *  and even, which is what gives it a Nyquist bin at all. */
const N = 32;

/** The authored components: [kx, ky, amplitude]. Two ordinary, then the three
 *  self-conjugate ones a 2-D even grid has besides DC — Nyquist in x, Nyquist in
 *  y, and the corner where both are. The corner is here because a fix that
 *  special-cased `ky === 0` would pass everything else in this file. */
const ORDINARY: readonly (readonly [number, number, number])[] = [
  [3, 0, 0.4],
  [5, 2, 0.25],
];
const SELF_CONJUGATE: readonly (readonly [number, number, number])[] = [
  [N / 2, 0, 0.3],
  [0, N / 2, 0.2],
  [N / 2, N / 2, 0.15],
];
/** The mean, and it is well clear of the total modulation so the image is
 *  positive everywhere — `contrast` divides by the mean and a readout is not
 *  being asked about a negative intensity. */
const MEAN = 1;

/** Phases for the ordinary components. The self-conjugate ones take none: at
 *  2k ≡ 0 the sine is zero at every integer sample, so cos(πx + φ) collapses to
 *  (−1)^x·cos φ and a phase is a scale factor, not a shift. */
const PHASES = [0.7, -1.1];

function authoredImage(): Float64Array {
  const image = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = MEAN;
      ORDINARY.forEach(([kx, ky, a], j) => {
        v += a * Math.cos((2 * Math.PI * (kx * x + ky * y)) / N + PHASES[j]!);
      });
      for (const [kx, ky, a] of SELF_CONJUGATE) {
        v += a * Math.cos((2 * Math.PI * (kx * x + ky * y)) / N);
      }
      image[y * N + x] = v;
    }
  }
  return image;
}

describe("§ 6am.1 — a bin with a partner reads twice one of them, and one without reads once", () => {
  it("every authored amplitude comes back, self-conjugate and ordinary alike", () => {
    // The whole claim in one assertion set, and it is a round trip through
    // arithmetic that was written down rather than rendered: five components go
    // in with chosen amplitudes and five come back. Before the fix the last
    // three came back at 0.6, 0.4 and 0.3 — exactly twice — while the first two
    // were right, which is the shape of the defect.
    //
    // `toBeCloseTo` and not `toBe`: the modulus keeps an imaginary part that is
    // f64 accumulation rather than exactly zero at a self-conjugate bin, so the
    // reading lands near the amplitude from above by roundoff.
    const image = authoredImage();
    for (const [kx, ky, a] of [...ORDINARY, ...SELF_CONJUGATE]) {
      expect(imageHarmonic(image, N, kx, ky).amplitude).toBeCloseTo(a, 12);
    }
  });

  it("and a bin nothing was authored at reads f64 zero, so the account is complete", () => {
    // The other half of a round trip: the components read back are the only
    // components there. Without this, a readout that returned the right number
    // at five bins by accident and rubbish elsewhere would pass above.
    const image = authoredImage();
    const authored = new Set(
      [...ORDINARY, ...SELF_CONJUGATE].map(([kx, ky]) => `${kx},${ky}`),
    );
    let worst = 0;
    for (let ky = 0; ky <= N / 2; ky++) {
      for (let kx = 0; kx <= N / 2; kx++) {
        if (kx === 0 && ky === 0) continue;
        if (authored.has(`${kx},${ky}`)) continue;
        // The conjugate half-plane too: (kx, −ky) is a different physical
        // frequency from (kx, ky) and nothing was authored at either.
        worst = Math.max(
          worst,
          imageHarmonic(image, N, kx, ky).amplitude,
          imageHarmonic(image, N, kx, -ky).amplitude,
        );
      }
    }
    // The ceiling is accumulation and not a fitted number: the sum runs over
    // N² = 1024 cells of magnitude ~2, so a random walk in the last bit reaches
    // √1024·ε·2 ≈ 1.4e−14. The worst bin reads 1.8e−15, comfortably inside it,
    // and this is a first authoring rather than a pin being relaxed.
    expect(worst).toBeLessThan(1e-14);
  });
});

describe("§ 6am.2 — k = 0 is the same defect, and its old answer described no image", () => {
  it("the DC bin's amplitude is the mean and its contrast is 1", () => {
    // k = 0 satisfies 2k ≡ 0 for the same reason N/2 does, and it is the bin a
    // caller reaches by accident rather than on purpose — `h * cycles` with
    // cycles = 0, a flat field. The old reading was twice the mean, and a
    // modulation of twice the mean about the mean is a negative intensity: there
    // is no image it could be describing. `.dc` was always right, which is why
    // the three call sites that ask for the DC as a MEAN never saw this.
    const image = authoredImage();
    const h = imageHarmonic(image, N, 0, 0);
    expect(h.dc).toBeCloseTo(MEAN, 12);
    expect(h.amplitude).toBeCloseTo(MEAN, 12);
    expect(h.contrast).toBeCloseTo(1, 12);
  });

  it("on a flat field, where the mean is the only thing in the picture", () => {
    const flat = new Float64Array(N * N).fill(0.75);
    const h = imageHarmonic(flat, N, 0, 0);
    expect(h.dc).toBe(0.75);
    expect(h.amplitude).toBe(0.75);
    expect(h.contrast).toBe(1);
  });
});

describe("§ 6am.3 — Rayleigh's theorem, computed off the pixels and not off the readout", () => {
  it("the variance the components account for is the variance the image has", () => {
    // The rung that discriminates, and the reason it is the anchor: it never
    // calls the readout to get the left-hand side. The pixels' own mean square
    // about their own mean is a number this file computes in a loop, and the
    // right-hand side is what the five readings say should be there.
    //
    // The two weights are trigonometric means over the grid and nothing else:
    // a cosine at an ordinary frequency has ⟨cos²⟩ = ½, and at 2k ≡ 0 the
    // "cosine" is (−1)^x or 1, whose square is 1 everywhere. So an ordinary
    // component contributes A²/2 and a self-conjugate one contributes A².
    const image = authoredImage();
    let mean = 0;
    for (const v of image) mean += v;
    mean /= image.length;
    let variance = 0;
    for (const v of image) variance += (v - mean) ** 2;
    variance /= image.length;

    const fromBins =
      ORDINARY.reduce((s, [kx, ky]) => s + imageHarmonic(image, N, kx, ky).amplitude ** 2 / 2, 0) +
      SELF_CONJUGATE.reduce((s, [kx, ky]) => s + imageHarmonic(image, N, kx, ky).amplitude ** 2, 0);

    expect(fromBins).toBeCloseTo(variance, 12);
  });

  it("and the old formula misses it by 3A² per self-conjugate component, which is why this is the anchor", () => {
    // The defect's size, stated as the thing it broke rather than as a factor.
    // Doubling a self-conjugate reading makes its energy 4A² where the image has
    // A², so the accounted variance overshoots by exactly 3A² for each — 0.4575
    // here against a variance of 0.264. Not a small error and not a subtle one:
    // the components would claim 2.7× the energy the pixels hold.
    //
    // Reconstructed rather than measured against the old build, so the rung
    // stays a statement about arithmetic that anyone can check: 2× the fixed
    // reading IS what the old code returned, the fix being the factor alone.
    const image = authoredImage();
    let mean = 0;
    for (const v of image) mean += v;
    mean /= image.length;
    let variance = 0;
    for (const v of image) variance += (v - mean) ** 2;
    variance /= image.length;

    const overshoot = SELF_CONJUGATE.reduce((s, [, , a]) => s + 3 * a ** 2, 0);
    const asOldCode =
      ORDINARY.reduce((s, [kx, ky]) => s + imageHarmonic(image, N, kx, ky).amplitude ** 2 / 2, 0) +
      SELF_CONJUGATE.reduce(
        (s, [kx, ky]) => s + (2 * imageHarmonic(image, N, kx, ky).amplitude) ** 2,
        0,
      );

    expect(overshoot).toBeCloseTo(0.4575, 12);
    expect(variance).toBeCloseTo(0.26375, 12);
    expect(asOldCode - variance).toBeCloseTo(overshoot, 12);
    expect(asOldCode / variance).toBeCloseTo(2.7345971563981, 10);
  });
});

describe("§ 6am.4 — the doubling is untouched wherever it is right", () => {
  it("an ordinary bin still reads twice its modulus, which is most of them", () => {
    // The guard against fixing the wrong thing. A single cosine at an ordinary
    // frequency splits its energy between +k and −k, both readable, and its peak
    // amplitude is twice either — the original comment's reasoning, still the
    // reasoning at every bin with a partner.
    const image = new Float64Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) image[y * N + x] = 1 + 0.5 * Math.cos((2 * Math.PI * 7 * x) / N);
    }
    expect(imageHarmonic(image, N, 7).amplitude).toBeCloseTo(0.5, 12);
    // And the partner bin is there to be read, carrying the same modulus — the
    // fact the doubling stands on.
    expect(imageHarmonic(image, N, N - 7).amplitude).toBeCloseTo(0.5, 12);
  });

  it("on an ODD grid only DC is self-conjugate, and the middle two bins are an ordinary pair", () => {
    // An odd N has no k with 2k ≡ 0 besides 0, so it has no Nyquist bin and the
    // classification must say so on its own rather than by a hardcoded N/2. The
    // modular test does; a `kx === n / 2` test would compare 15.5 against an
    // integer and be right here by accident, then wrong the first time a caller
    // passed a half-integer.
    const odd = 31;
    const image = new Float64Array(odd * odd);
    for (let y = 0; y < odd; y++) {
      for (let x = 0; x < odd; x++) {
        image[y * odd + x] = 1 + 0.5 * Math.cos((2 * Math.PI * 15 * x) / odd);
      }
    }
    expect(imageHarmonic(image, odd, 15).amplitude).toBeCloseTo(0.5, 12);
    expect(imageHarmonic(image, odd, 16).amplitude).toBeCloseTo(0.5, 12);
  });
});

describe("§ 6am.5 — the classification is modular, so it follows the bin and not the argument", () => {
  it("k, k + N and −k are one bin and read alike, self-conjugate or not", () => {
    // The DFT is periodic in k and `imageHarmonic` always was — the sum it runs
    // is over cos(2πkx/N), which cannot tell k from k + N. The classification had
    // to be periodic too or it would double a bin at kx = N that it read once at
    // kx = 0, and the two are the same measurement.
    const image = authoredImage();
    const dc = imageHarmonic(image, N, 0, 0).amplitude;
    for (const kx of [N, 2 * N, -N]) {
      expect(imageHarmonic(image, N, kx, 0).amplitude).toBeCloseTo(dc, 12);
    }
    const nyquist = imageHarmonic(image, N, N / 2, 0).amplitude;
    for (const kx of [-N / 2, (3 * N) / 2, (5 * N) / 2]) {
      expect(imageHarmonic(image, N, kx, 0).amplitude).toBeCloseTo(nyquist, 12);
    }
  });

  it("and a NON-integer argument is never self-conjugate, whatever it is near", () => {
    // A bin index between bins is not a bin, and 2k ≡ 0 is a statement about
    // lattice points. The integer guard says so explicitly rather than letting
    // `(2 * 16.0000001) % 32` decide it by how the remainder rounds. No rung
    // asks for a fractional bin today; the guard is here so that the first one
    // that does gets the doubling, which is the right answer off-lattice.
    const image = authoredImage();
    const near = imageHarmonic(image, N, N / 2 + 1e-9, 0).amplitude;
    const on = imageHarmonic(image, N, N / 2, 0).amplitude;
    expect(near / on).toBeCloseTo(2, 6);
  });
});
