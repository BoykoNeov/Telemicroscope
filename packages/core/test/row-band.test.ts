import { describe, it, expect } from "vitest";
import { fft1d, fft2d, fftShift2d, shiftedRowBand } from "../src/math/fft";
import { mulberry32 } from "../src/math/random";
import { abbeImage, cosineGratingObject, type ObjectField } from "../src/illumination/abbe";
import { commensurateSource, diskSource, type CondenserSource } from "../src/illumination/source";
import { idealPupil, defocusedPupil } from "../src/illumination/transfer";
import { incoherentPsf } from "../src/imaging/fluorescence";
import { psfFromPupilFunction, pupilSampling, type PupilFunction, type PupilScale } from "../src/wave/psf";

/**
 * § 6aa — the transform of a row that was never written.
 *
 * Every wave-layer caller in this engine fills a **box** and transforms a
 * **grid**. The pupil spans `pupilSamples` bins inside a `size` array, and at
 * the shipped brightfield 32-in-128 that is 33 rows of 128 with 95 identically
 * zero; `wave/psf` is sparser still, because `padFactor` 4 puts a
 * `pupilSamples`-wide pupil in a grid four times that. The row pass of a
 * row–column FFT transforms each of those zero rows separately, and a transform
 * of zeros is zeros.
 *
 * So the step removes them and removes nothing else. It is `wave/psf`'s
 * `padFactor` and `illumination/abbe`'s frequency-grid headroom being *paid*
 * only where they carry something, which is a speed step in § 6s's shape: the
 * rungs are **identity** rungs, not accuracy ones, because the claim is that
 * nothing about any image changes.
 *
 * ## Why the band is recorded and not derived, and why that is the rung
 *
 * The two ways of being wrong here are not symmetric. A band WIDER than the
 * rows the caller wrote is merely slower than it needed to be. A band NARROWER
 * than them drops signal and returns a perfectly plausible wrong image — the
 * same failure shape `commensurateSource` refuses one module over, where a
 * *nearly* commensurate source would take a cached path and form an image whose
 * disagreement with the honest sum reads as physics.
 *
 * The callers therefore do not compute the band from the box bounds they
 * believe; they record `iy` as they write and hand back the hull of what they
 * actually wrote. That hull is a **superset** of the nonzero rows — a row
 * inside it whose every sample was blocked stays zero and is transformed for
 * nothing — which is the safe direction, and § 6aa.5 is the case where the two
 * differ and the recorded one is the one that is right.
 *
 * The negative control is § 6aa.3: a band one row too narrow must produce a
 * DIFFERENT array. Without it, every identity rung here would also pass on an
 * implementation that ignored the parameter.
 */

/* ── § 6aa.1 — the shift is a row rotation ────────────────────────────────── */

/**
 * The band arithmetic every caller that shifts before transforming depends on,
 * pinned against `fftShift2d` itself rather than against the algebra that
 * produced it: mark rows `a..b`, shift, and read off which rows are marked.
 */
function markedRows(a: Float64Array, n: number): number[] {
  const rows: number[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (a[y * n + x] !== 0) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

describe("§ 6aa.1 — fftShift2d moves a contiguous run of rows to a cyclic band", () => {
  it("puts every written row inside the band shiftedRowBand names, and nothing else", () => {
    for (const n of [16, 32, 64, 128]) {
      const cases: Array<[number, number]> = [
        [0, 0],
        [0, n - 1],
        [n / 2 - 1, n / 2 + 1], // straddles the fold: the wrapping case
        [n / 4, n - 1 - n / 4],
        [1, 3],
        [n - 4, n - 1],
      ];
      for (const [lo, hi] of cases) {
        const a = new Float64Array(n * n);
        for (let y = lo; y <= hi; y++) for (let x = 0; x < n; x++) a[y * n + x] = 1;
        fftShift2d(a, n);
        const band = shiftedRowBand(lo, hi, n);
        const expected = new Set<number>();
        for (let k = 0; k < band.count; k++) expected.add((band.lo + k) % n);
        expect(new Set(markedRows(a, n))).toEqual(expected);
        // The count is the run length unchanged — a rotation moves a run, it
        // does not stretch one.
        expect(band.count).toBe(hi - lo + 1);
      }
    }
  });

  it("refuses a run that is not one, rather than rotating nonsense", () => {
    expect(() => shiftedRowBand(9, 4, 32)).toThrow(/firstRow <= lastRow/);
    expect(() => shiftedRowBand(-1, 4, 32)).toThrow(/outside a 32-row grid/);
    expect(() => shiftedRowBand(0, 32, 32)).toThrow(/outside a 32-row grid/);
  });
});

/* ── § 6aa.2/3/4 — the transform itself ───────────────────────────────────── */

/** Random content in rows `[lo, lo+count)` mod n and exact zeros everywhere else. */
function bandedInput(n: number, lo: number, count: number, seed: number) {
  const rng = mulberry32(seed);
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let k = 0; k < count; k++) {
    const y = (lo + k) % n;
    for (let x = 0; x < n; x++) {
      re[y * n + x] = rng.next() * 2 - 1;
      im[y * n + x] = rng.next() * 2 - 1;
    }
  }
  return { re, im };
}

describe("§ 6aa.2 — skipping a zero row is the transform, bit for bit", () => {
  it("agrees with the full transform on every cell, forward and inverse", () => {
    for (const n of [16, 64, 128]) {
      const cases: Array<[number, number]> = [
        [0, 1],
        [3, 9],
        [n - 5, 9], // wraps past row 0
        [n / 2, n / 2],
        [0, n], // the degenerate "all of them"
      ];
      for (const [lo, count] of cases) {
        for (const inverse of [false, true]) {
          const a = bandedInput(n, lo, count, 1234 + n + lo + count);
          const b = { re: Float64Array.from(a.re), im: Float64Array.from(a.im) };
          fft2d(a.re, a.im, n, inverse, { lo, count });
          fft2d(b.re, b.im, n, inverse);
          // `toEqual` on a Float64Array is elementwise and exact — this is the
          // `toBe`-not-a-tolerance claim § 6p makes about its own cache.
          expect(a.re).toEqual(b.re);
          expect(a.im).toEqual(b.im);
        }
      }
    }
  });

  it("is the full transform when the band covers the grid, or is omitted", () => {
    const n = 32;
    const a = bandedInput(n, 0, n, 77);
    const b = { re: Float64Array.from(a.re), im: Float64Array.from(a.im) };
    const c = { re: Float64Array.from(a.re), im: Float64Array.from(a.im) };
    fft2d(a.re, a.im, n, false, { lo: 0, count: n });
    fft2d(b.re, b.im, n, false, { lo: 17, count: n + 40 }); // count >= n wins over lo
    fft2d(c.re, c.im, n, false);
    expect(a.re).toEqual(c.re);
    expect(b.re).toEqual(c.re);
    expect(a.im).toEqual(c.im);
    expect(b.im).toEqual(c.im);
  });

  it("refuses a band that is not one", () => {
    const n = 16;
    const a = bandedInput(n, 0, 4, 5);
    expect(() => fft2d(a.re, a.im, n, false, { lo: -1, count: 4 })).toThrow(/writtenRows.lo/);
    expect(() => fft2d(a.re, a.im, n, false, { lo: n, count: 4 })).toThrow(/writtenRows.lo/);
    expect(() => fft2d(a.re, a.im, n, false, { lo: 0, count: 0 })).toThrow(/writtenRows.count/);
    expect(() => fft2d(a.re, a.im, n, false, { lo: 1.5, count: 4 })).toThrow(/writtenRows.lo/);
  });
});

describe("§ 6aa.3 — NEGATIVE CONTROL: a band that is too narrow is a different image", () => {
  it("differs when one written row is left out, so the parameter is load-bearing", () => {
    const n = 64;
    const lo = 10;
    const count = 12;
    const honest = bandedInput(n, lo, count, 909);
    const starved = { re: Float64Array.from(honest.re), im: Float64Array.from(honest.im) };
    fft2d(honest.re, honest.im, n, true, { lo, count });
    fft2d(starved.re, starved.im, n, true, { lo, count: count - 1 });
    expect(starved.re).not.toEqual(honest.re);
    // And it is not a rounding: dropping a row drops its whole contribution.
    let worst = 0;
    for (let i = 0; i < n * n; i++) worst = Math.max(worst, Math.abs(starved.re[i]! - honest.re[i]!));
    expect(worst).toBeGreaterThan(1e-3);
  });
});

/* ── § 6aa.4/5 — the callers, against a reference with no box and no band ─── */

const SCALE: PupilScale = { referenceRadius: 100, exitRadius: 5, wavelengthNm: 550, nImage: 1 };

/**
 * A pupil that transmits only a horizontal strip — the case where the recorded
 * hull is strictly INSIDE the box the caller derived from |u + s| <= 1, because
 * whole rows of that box are blocked. Nothing physical; it exists to separate
 * "the band the geometry implies" from "the band the writes made".
 */
function slitPupil(halfHeight: number): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= 1 && Math.abs(py) <= halfHeight ? 1 : 0),
    phaseWaves: (px, py) => 0.3 * (px * px + py * py),
  };
}

/**
 * `abbeImage` with neither of its two optimizations: the pupil is asked about
 * **every** cell of the frequency grid rather than a box, and the inverse
 * transform runs over **every** row rather than a band. Everything else is the
 * same arithmetic in the same order, so agreement is exact rather than close.
 */
function abbeReference(
  object: ObjectField,
  pupil: PupilFunction,
  source: CondenserSource,
  pupilSamples: number,
): Float64Array {
  const n = object.size;
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);
  const half = n / 2;
  const step = 2 / pupilSamples;
  const intensity = new Float64Array(n * n);
  const workRe = new Float64Array(n * n);
  const workIm = new Float64Array(n * n);
  for (const s of source.points) {
    workRe.fill(0);
    workIm.fill(0);
    let transmitting = 0;
    for (let iy = 0; iy < n; iy++) {
      const py = (iy - half) * step + s.sy;
      for (let ix = 0; ix < n; ix++) {
        const px = (ix - half) * step + s.sx;
        const a = pupil.amplitude(px, py);
        if (a <= 0) continue;
        const ang = 2 * Math.PI * pupil.phaseWaves(px, py);
        const pr = a * Math.cos(ang);
        const pi = a * Math.sin(ang);
        const idx = iy * n + ix;
        const tr = specRe[idx]!;
        const ti = specIm[idx]!;
        workRe[idx] = tr * pr - ti * pi;
        workIm[idx] = tr * pi + ti * pr;
        transmitting++;
      }
    }
    if (transmitting === 0) continue;
    fftShift2d(workRe, n);
    fftShift2d(workIm, n);
    fft2d(workRe, workIm, n, true);
    const w = s.weight;
    for (let i = 0; i < n * n; i++) {
      intensity[i] = intensity[i]! + w * (workRe[i]! * workRe[i]! + workIm[i]! * workIm[i]!);
    }
  }
  return intensity;
}

describe("§ 6aa.4 — the Abbe sum is the whole-grid sum, bit for bit", () => {
  const SIZE = 128;
  const PS = 32;
  const object = cosineGratingObject({ size: SIZE, cycles: 8, modulation: 0.4 });

  for (const [label, pupil] of [
    ["ideal", idealPupil()],
    ["defocused 0.5 waves", defocusedPupil(0.5)],
  ] as const) {
    for (const [srcLabel, source] of [
      ["diskSource(0.5, 11) — uncached", diskSource(0.5, 11)],
      ["commensurateSource(0.5, 32, 2) — cached", commensurateSource(0.5, 32, 2)],
    ] as const) {
      it(`${label} pupil, ${srcLabel}`, () => {
        const got = abbeImage(object, pupil, source, { pupilSamples: PS });
        const want = abbeReference(object, pupil, source, PS);
        expect(got.intensity).toEqual(want);
      });
    }
  }
});

describe("§ 6aa.5 — a blocked row inside the box is still a row the band may skip", () => {
  it("agrees with the whole-grid sum when the hull is strictly inside the box", () => {
    const SIZE = 128;
    const PS = 32;
    const object = cosineGratingObject({ size: SIZE, cycles: 6, modulation: 0.4 });
    const pupil = slitPupil(0.35);
    const source = diskSource(0.4, 7);
    const got = abbeImage(object, pupil, source, { pupilSamples: PS });
    const want = abbeReference(object, pupil, source, PS);
    expect(got.intensity).toEqual(want);
    // …and the case is the one it claims to be: the slit really does leave
    // whole rows of the |u + s| <= 1 box empty. 33 rows span the box at
    // pupilSamples 32; a half-height of 0.35 admits about 12 of them.
    const boxRows = PS + 1;
    const slitRows = 2 * Math.floor(0.35 / (2 / PS)) + 1;
    expect(slitRows).toBeLessThan(boxRows - 4);
  });
});

/**
 * `incoherentPsf` with neither optimization, in the same shape as
 * `abbeReference` — every cell asked, every row transformed.
 */
function incoherentPsfReference(pupil: PupilFunction, n: number, pupilSamples: number): Float64Array {
  const half = n / 2;
  const step = 2 / pupilSamples;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let iy = 0; iy < n; iy++) {
    const py = (iy - half) * step;
    for (let ix = 0; ix < n; ix++) {
      const px = (ix - half) * step;
      const a = pupil.amplitude(px, py);
      if (a <= 0) continue;
      const ang = 2 * Math.PI * pupil.phaseWaves(px, py);
      re[iy * n + ix] = a * Math.cos(ang);
      im[iy * n + ix] = a * Math.sin(ang);
    }
  }
  fftShift2d(re, n);
  fftShift2d(im, n);
  fft2d(re, im, n, true);
  const values = new Float64Array(n * n);
  let sum = 0;
  for (let i = 0; i < n * n; i++) {
    const v = re[i]! * re[i]! + im[i]! * im[i]!;
    values[i] = v;
    sum += v;
  }
  for (let i = 0; i < n * n; i++) values[i] = values[i]! / sum;
  return values;
}

describe("§ 6aa.6 — the fluorescence kernel is the whole-grid kernel, bit for bit", () => {
  for (const [size, ps] of [
    [128, 32],
    [256, 32],
    [256, 64],
  ] as const) {
    it(`incoherentPsf size ${size}, pupilSamples ${ps}`, () => {
      const pupil = defocusedPupil(0.4);
      const got = incoherentPsf(pupil, { size, pupilSamples: ps });
      expect(got.values).toEqual(incoherentPsfReference(pupil, size, ps));
    });
  }
});

/**
 * `psfFromPupilFunction` with the two forward transforms unbanded. The pupil is
 * area-averaged by the exported `pupilSampling`, exactly as the function does
 * it, so this differs from the real one in the transform and in nothing else —
 * including the normalization, which is reproduced rather than divided out.
 */
function psfReference(pupil: PupilFunction, pupilSamples: number, padFactor: number) {
  const n = pupilSamples * padFactor;
  const half = n / 2;
  const step = 2 / pupilSamples;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  const flatRe = new Float64Array(n * n);
  const flatIm = new Float64Array(n * n);
  const sampled = pupilSampling(pupil, pupilSamples, n);
  let energy = 0;
  let fieldPower = 0;
  for (let iy = 0; iy < n; iy++) {
    const py = (iy - half) * step;
    for (let ix = 0; ix < n; ix++) {
      const px = (ix - half) * step;
      const idx = iy * n + ix;
      energy += sampled.power[idx]!;
      const a = sampled.amplitude[idx]!;
      if (a <= 0) continue;
      const ang = 2 * Math.PI * pupil.phaseWaves(px, py);
      re[idx] = a * Math.cos(ang);
      im[idx] = a * Math.sin(ang);
      flatRe[idx] = a;
      fieldPower += a * a;
    }
  }
  fft2d(re, im, n);
  fft2d(flatRe, flatIm, n);
  const norm = energy / (fieldPower * n * n);
  const intensity = new Float64Array(n * n);
  let peak = 0;
  let flatPeak = 0;
  for (let i = 0; i < n * n; i++) {
    const v = (re[i]! * re[i]! + im[i]! * im[i]!) * norm;
    intensity[i] = v;
    if (v > peak) peak = v;
    const f = (flatRe[i]! * flatRe[i]! + flatIm[i]! * flatIm[i]!) * norm;
    if (f > flatPeak) flatPeak = f;
  }
  fftShift2d(intensity, n);
  return { intensity, peak, strehl: flatPeak > 0 ? peak / flatPeak : 0 };
}

describe("§ 6aa.7 — the PSF is the whole-grid PSF, bit for bit", () => {
  for (const [ps, pad] of [
    [32, 4],
    [64, 4],
    [64, 2],
  ] as const) {
    it(`pupilSamples ${ps}, padFactor ${pad} (grid ${ps * pad})`, () => {
      const pupil = defocusedPupil(0.6);
      const got = psfFromPupilFunction(pupil, SCALE, 0, { pupilSamples: ps, padFactor: pad });
      const want = psfReference(pupil, ps, pad);
      expect(got.intensity).toEqual(want.intensity);
      expect(got.peak).toBe(want.peak);
      expect(got.strehl).toBe(want.strehl);
    });
  }

  it("is the sparsest of the three, and the padding is why", () => {
    // The pupil spans `pupilSamples` of `pupilSamples × padFactor` rows, so the
    // fraction of the row pass that is a transform of zeros is set by the
    // padding alone — 3/4 at the default 4, against 95/128 for the shipped
    // brightfield grid. Stated as arithmetic so the claim in the docs has a
    // rung under it rather than a wall clock.
    const ps = 64;
    const pad = 4;
    const n = ps * pad;
    const { amplitude } = pupilSampling(idealPupil(), ps, n);
    let first = -1;
    let last = -1;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        if (amplitude[iy * n + ix]! > 0) {
          if (first < 0) first = iy;
          last = iy;
          break;
        }
      }
    }
    const written = last - first + 1;
    expect(written).toBeLessThanOrEqual(ps + 2);
    expect(written / n).toBeLessThan(0.3);
  });
});

/**
 * § 6aa.8 — the sparse-input transform § 6aa left open, measured and declined.
 *
 * § 6aa's own open item said the input is sparse in BOTH axes while only rows
 * are skipped, and that a sparse-input transform is a different algorithm
 * wanting its own identity rungs. It is, and it is not worth writing. The
 * reason recorded in `math/fft.ts` until now was also wrong: it said each
 * transformed row is dense across all `n` columns "so every column has to run",
 * which is true of a row's VALUES and beside the point. A column's INPUTS are
 * still mostly zero, and that is what a pruned transform exploits. The first
 * rung below pins that premise, because a declined optimisation whose premise
 * was never checked is an argument rather than a measurement.
 *
 * What actually stops it is arithmetic:
 *
 *  - A radix-2 stage collapses to copies only where the zeros form an ALIGNED
 *    block, and every caller here writes a CENTRED one. Whole skippable stages
 *    are `⌊log₂(n/count)⌋`, and at BOTH shipped grids that floor is **1** — the
 *    second rung is that arithmetic. The pupil spans `pupilSamples` bins whose
 *    inclusive hull is `pupilSamples + 1`, inside `padFactor` 4 that is one row
 *    past a quarter of the grid, and one row is what costs the second stage.
 *  - Realigning a cyclic block so a stage becomes skippable is a phase ramp over
 *    the output: n² complex multiplies. Measured at n = 256 the ramp is 0.210 ms
 *    against the one stage's 0.208 ms — a wash — and at n = 128 it nets 0.028 ms,
 *    5.5% of a 0.507 ms banded transform. Both are wall-clock numbers and live
 *    in the docs, not here; what is pinned here is the arithmetic they turn on.
 */
describe("§ 6aa.8 — why the columns are not pruned either", () => {
  it("PREMISE: after a banded row pass, only the band's rows hold anything", () => {
    const n = 128;
    const lo = 47;
    const count = 33;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let y = lo; y < lo + count; y++) {
      for (let x = 0; x < n; x++) re[y * n + x] = Math.sin(x + y) + 1;
    }
    // The row pass alone — the state the column pass starts from.
    for (let k = 0; k < count; k++) {
      const row = (lo + k) % n;
      const rowRe = re.subarray(row * n, row * n + n);
      const rowIm = im.subarray(row * n, row * n + n);
      fft1d(rowRe, rowIm);
    }
    let nonzeroRows = 0;
    for (let y = 0; y < n; y++) {
      let any = false;
      for (let x = 0; x < n; x++) {
        if (re[y * n + x] !== 0 || im[y * n + x] !== 0) {
          any = true;
          break;
        }
      }
      if (any) nonzeroRows++;
    }
    // So each of the n columns is a transform of n inputs of which `count` are
    // nonzero — an input-pruned transform, not a dense one.
    expect(nonzeroRows).toBe(count);
    expect(nonzeroRows / n).toBeLessThan(0.3);
  });

  it("ARITHMETIC: the shipped bands sit one row past a quarter, so one stage", () => {
    // ⌊log₂(n/count)⌋ whole stages are skippable for an aligned block. The
    // inclusive hull is what puts both shipped grids on the wrong side of 2.
    for (const ps of [32, 64]) {
      const n = ps * 4;
      const count = ps + 1;
      expect(count).toBeGreaterThan(n / 4);
      expect(Math.floor(Math.log2(n / count))).toBe(1);
      // One row narrower and the second stage would be there — which is the
      // whole margin, and why this is arithmetic rather than a tuning knob.
      expect(Math.floor(Math.log2(n / (count - 1)))).toBe(2);
    }
  });
});
