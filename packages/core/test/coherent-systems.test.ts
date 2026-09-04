import { describe, expect, it } from "vitest";
import {
  abbeImage,
  circleOverlapArea,
  coherentSystems,
  condenserFactor,
  cosineGratingObject,
  defocusedPupil,
  diskSource,
  hopkinsImage,
  idealPupil,
  socsImage,
  transmissionCrossCoefficients,
  type CondenserSource,
  type ObjectField,
} from "../src/illumination";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 6cs.2–§ 6cs.4 — the sum of coherent systems.
 *
 * The kernel is A·Aᴴ over the condenser, so its eigenvectors are A's left
 * singular vectors and the M×M array need never exist. What that buys, and what
 * it does not, is measured here rather than asserted: the memory is a fourth
 * power against a second one and the saving is real without any approximation
 * at all; the *truncation* is the separate question, and the answer is allowed
 * to be that it does not pay.
 */

const clear = (): PupilFunction => idealPupil();

function noisyObject(size: number, seed: number): ObjectField {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const re = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) re[i] = 0.5 + 0.5 * rnd();
  return { size, re, im: new Float64Array(size * size) };
}

function twoPointSource(
  a: { sx: number; sy: number },
  b: { sx: number; sy: number },
  w1: number,
  w2: number,
): CondenserSource {
  return {
    points: [
      { ...a, weight: w1 },
      { ...b, weight: w2 },
    ],
    coherenceParameter: Math.max(Math.hypot(a.sx, a.sy), Math.hypot(b.sx, b.sy)),
    samples: 2,
  };
}

/** Worst relative difference, unnormalized — see the truncation note below. */
function worstRelative(a: Float64Array, b: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i]!));
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!) / peak);
  return worst;
}

describe("§ 6cs.2 — the factor is what the kernel was built from all along", () => {
  const pupil = defocusedPupil(0.4);
  const source = diskSource(0.5, 15);
  const opts = { pupilSamples: 16, size: 32 };

  it("has one column per contributing direction, and the kernel's own support", () => {
    const factor = condenserFactor(pupil, source, opts);
    const tcc = transmissionCrossCoefficients(pupil, source, opts);
    expect(factor.support).toBe(tcc.support);
    expect(factor.columns).toBe(tcc.contributingPoints);
    expect(factor.pupilEvaluations).toBe(tcc.pupilEvaluations);
    // The same grid guard, read by the same code in `lattice.ts`.
    expect(factor.maxGridPhaseStepWaves).toBe(tcc.maxGridPhaseStepWaves);
    // Every stored entry lands on a real support slot.
    for (let i = 0; i < factor.entries; i++) {
      expect(factor.slots[i]!).toBeGreaterThanOrEqual(0);
      expect(factor.slots[i]!).toBeLessThan(factor.support);
    }
    expect(factor.offsets[factor.columns]!).toBe(factor.entries);
  });

  /**
   * The whole reason the step exists, and it needs no approximation to state:
   * the factor is `support × columns` where the kernel is `support × support`,
   * and the direction count does not grow when the pupil is sampled more finely.
   * So the saving is support/columns, which grows as the SQUARE of the pupil
   * sampling — the other half of § 6cr.6's fourth power.
   */
  it("costs support/columns of what the kernel costs, and that ratio is the pupil sampling squared", () => {
    const coarse = { pupilSamples: 16, size: 32 };
    const fine = { pupilSamples: 32, size: 64 };
    const fc = condenserFactor(clear(), source, coarse);
    const ff = condenserFactor(clear(), source, fine);
    const kc = transmissionCrossCoefficients(clear(), source, coarse);
    const kf = transmissionCrossCoefficients(clear(), source, fine);

    expect(fc.support).toBe(437);
    expect(ff.support).toBe(1757);
    expect(fc.columns).toBe(177);
    expect(ff.columns).toBe(177);

    expect(kc.bytes / 1048576).toBeCloseTo(2.91, 1);
    expect(fc.denseBytes / 1048576).toBeCloseTo(1.18, 1);
    expect(kf.bytes / 1048576).toBeCloseTo(47.1, 1);
    expect(ff.denseBytes / 1048576).toBeCloseTo(4.75, 1);

    // Doubling pupilSamples quadruples the saving, because the kernel's cost is
    // a fourth power of it and the factor's is a second.
    const coarseSaving = kc.bytes / fc.denseBytes;
    const fineSaving = kf.bytes / ff.denseBytes;
    expect(coarseSaving).toBeCloseTo(2.47, 1);
    expect(fineSaving).toBeCloseTo(9.92, 1);
    expect(fineSaving / coarseSaving).toBeCloseTo(4, 0);
  });
});

describe("§ 6cs.3 — the modes ARE the kernel's eigenvectors", () => {
  const pupil = defocusedPupil(0.4);
  const source = diskSource(0.5, 15);
  const opts = { pupilSamples: 8, size: 32 };
  const factor = condenserFactor(pupil, source, opts);
  const tcc = transmissionCrossCoefficients(pupil, source, opts);
  const systems = coherentSystems(factor);

  it("Σλ is the kernel's trace and Σλ² its Frobenius norm squared — free, and exact", () => {
    let trace = 0;
    for (let i = 0; i < tcc.support; i++) trace += tcc.re[i * tcc.support + i]!;
    let frob = 0;
    for (let k = 0; k < tcc.entries; k++) frob += tcc.re[k]! ** 2 + tcc.im[k]! ** 2;

    let sum = 0;
    let sum2 = 0;
    for (let j = 0; j < systems.available; j++) {
      sum += systems.weights[j]!;
      sum2 += systems.weights[j]! ** 2;
    }
    expect(sum / trace - 1).toBeCloseTo(0, 12);
    expect(sum2 / frob - 1).toBeCloseTo(0, 11);
    expect(systems.totalWeight / trace - 1).toBeCloseTo(0, 12);
  });

  it("every λ is non-negative by construction, not by tolerance", () => {
    for (let j = 0; j < systems.modes; j++) {
      expect(systems.weights[j]!).toBeGreaterThanOrEqual(0);
    }
    // Descending.
    for (let j = 1; j < systems.modes; j++) {
      expect(systems.weights[j]!).toBeLessThanOrEqual(systems.weights[j - 1]!);
    }
  });

  it("the modes are orthonormal, and there are min(support, directions) of them", () => {
    expect(systems.available).toBe(Math.min(factor.support, factor.columns));
    // This grid is the case where the SUPPORT binds rather than the direction
    // count: 8 bins across the pupil reach fewer lattice bins than the condenser
    // has directions, and the rank is the smaller of the two.
    expect(factor.support).toBeLessThan(factor.columns);
    expect(systems.available).toBe(factor.support);

    const m = systems.support;
    for (let p = 0; p < systems.modes; p += 7) {
      for (let q = 0; q < systems.modes; q += 7) {
        let dr = 0;
        let di = 0;
        for (let b = 0; b < m; b++) {
          const pr = systems.re[p * m + b]!;
          const pi = systems.im[p * m + b]!;
          const qr = systems.re[q * m + b]!;
          const qi = systems.im[q * m + b]!;
          dr += pr * qr + pi * qi;
          di += pr * qi - pi * qr;
        }
        expect(dr).toBeCloseTo(p === q ? 1 : 0, 10);
        expect(di).toBeCloseTo(0, 10);
      }
    }
  });

  it("TCC·φ = λ·φ for the leading modes, which is the claim in one line", () => {
    const m = systems.support;
    for (const j of [0, 1, 5]) {
      const lambda = systems.weights[j]!;
      let worst = 0;
      let scale = 0;
      for (let a = 0; a < m; a++) {
        let vr = 0;
        let vi = 0;
        for (let b = 0; b < m; b++) {
          const tr = tcc.re[a * m + b]!;
          const ti = tcc.im[a * m + b]!;
          const pr = systems.re[j * m + b]!;
          const pi = systems.im[j * m + b]!;
          vr += tr * pr - ti * pi;
          vi += tr * pi + ti * pr;
        }
        const er = lambda * systems.re[j * m + a]!;
        const ei = lambda * systems.im[j * m + a]!;
        worst = Math.max(worst, Math.hypot(vr - er, vi - ei));
        scale = Math.max(scale, Math.hypot(vr, vi));
      }
      expect(worst / scale).toBeLessThan(1e-11);
    }
  });

  it("Σ λ·φ·φᴴ rebuilds the kernel, which is what 'sum of coherent systems' means", () => {
    const m = systems.support;
    let worst = 0;
    let peak = 0;
    for (let a = 0; a < m; a += 5) {
      for (let b = 0; b < m; b += 5) {
        let rr = 0;
        let ri = 0;
        for (let j = 0; j < systems.available; j++) {
          const ar = systems.re[j * m + a]!;
          const ai = systems.im[j * m + a]!;
          const br = systems.re[j * m + b]!;
          const bi = systems.im[j * m + b]!;
          const lam = systems.weights[j]!;
          rr += lam * (ar * br + ai * bi);
          ri += lam * (ai * br - ar * bi);
        }
        const k = a * m + b;
        peak = Math.max(peak, Math.hypot(tcc.re[k]!, tcc.im[k]!));
        worst = Math.max(worst, Math.hypot(rr - tcc.re[k]!, ri - tcc.im[k]!));
      }
    }
    expect(worst / peak).toBeLessThan(1e-12);
  });
});

/**
 * The same identities where the DIRECTION COUNT binds, which is the regime the
 * step exists for. The block above runs at pupilSamples 8, where the support is
 * smaller than the condenser and the rank is cut by the grid — a real case, and
 * the one that pins `available`, but not the one the register cares about. At
 * pupilSamples 16 the support is 437 against 177 directions, so the rank is the
 * Gram bound and the factor is the smaller array.
 */
describe("§ 6cs.3 — the same identities where the direction count binds", () => {
  const pupil = defocusedPupil(0.4);
  const source = diskSource(0.5, 15);
  const opts = { pupilSamples: 16, size: 32 };
  const factor = condenserFactor(pupil, source, opts);
  const tcc = transmissionCrossCoefficients(pupil, source, opts);
  const systems = coherentSystems(factor);

  it("the rank is the direction count, not the support", () => {
    expect(factor.support).toBe(437);
    expect(factor.columns).toBe(177);
    expect(systems.available).toBe(177);
    expect(factor.denseBytes).toBeLessThan(tcc.bytes);
  });

  it("Σλ is the trace and Σλ² the Frobenius norm squared", () => {
    let trace = 0;
    for (let i = 0; i < tcc.support; i++) trace += tcc.re[i * tcc.support + i]!;
    let frob = 0;
    for (let k = 0; k < tcc.entries; k++) frob += tcc.re[k]! ** 2 + tcc.im[k]! ** 2;
    let sum = 0;
    let sum2 = 0;
    for (let j = 0; j < systems.available; j++) {
      sum += systems.weights[j]!;
      sum2 += systems.weights[j]! ** 2;
    }
    expect(sum / trace - 1).toBeCloseTo(0, 12);
    expect(sum2 / frob - 1).toBeCloseTo(0, 11);
  });

  it("the modes are orthonormal and every λ is non-negative", () => {
    const m = systems.support;
    for (let j = 0; j < systems.modes; j++) expect(systems.weights[j]!).toBeGreaterThanOrEqual(0);
    for (let p = 0; p < systems.modes; p += 23) {
      for (let q = 0; q < systems.modes; q += 23) {
        let dr = 0;
        let di = 0;
        for (let b = 0; b < m; b++) {
          const pr = systems.re[p * m + b]!;
          const pi = systems.im[p * m + b]!;
          const qr = systems.re[q * m + b]!;
          const qi = systems.im[q * m + b]!;
          dr += pr * qr + pi * qi;
          di += pr * qi - pi * qr;
        }
        expect(dr).toBeCloseTo(p === q ? 1 : 0, 10);
        expect(di).toBeCloseTo(0, 10);
      }
    }
  });

  it("TCC·φ = λ·φ for the leading modes, at the sampling that matters", () => {
    const m = systems.support;
    for (const j of [0, 3, 20]) {
      const lambda = systems.weights[j]!;
      let worst = 0;
      let scale = 0;
      for (let a = 0; a < m; a++) {
        let vr = 0;
        let vi = 0;
        for (let b = 0; b < m; b++) {
          const tr = tcc.re[a * m + b]!;
          const ti = tcc.im[a * m + b]!;
          const pr = systems.re[j * m + b]!;
          const pi = systems.im[j * m + b]!;
          vr += tr * pr - ti * pi;
          vi += tr * pi + ti * pr;
        }
        const er = lambda * systems.re[j * m + a]!;
        const ei = lambda * systems.im[j * m + a]!;
        worst = Math.max(worst, Math.hypot(vr - er, vi - ei));
        scale = Math.max(scale, Math.hypot(vr, vi));
      }
      expect(worst / scale).toBeLessThan(1e-10);
    }
  });
});

describe("§ 6cs.3 — the ranks the source forces, in closed form", () => {
  const opts = { pupilSamples: 12, size: 32 };

  it("one illumination direction is exactly one coherent system: the pupil itself", () => {
    const source: CondenserSource = {
      points: [{ sx: 0, sy: 0, weight: 1 }],
      coherenceParameter: 0,
      samples: 1,
    };
    const factor = condenserFactor(clear(), source, opts);
    const systems = coherentSystems(factor);
    expect(systems.available).toBe(1);
    expect(systems.modes).toBe(1);
    // λ₁ is the transmitted power: a clear pupil has amplitude 1 on each of its
    // bins, so it is the transmitting-bin count exactly.
    expect(systems.weights[0]!).toBeCloseTo(factor.support, 10);
    // …and the mode is the pupil, which for a clear one is constant modulus.
    for (let b = 0; b < systems.support; b++) {
      expect(Math.hypot(systems.re[b]!, systems.im[b]!)).toBeCloseTo(
        1 / Math.sqrt(factor.support),
        12,
      );
    }
  });

  /**
   * Two directions give rank exactly 2 and the two λ come from the 2×2 Gram in
   * closed form — λ = (α+β)/2 ± √(((α−β)/2)² + |γ|²) with α = w₁‖a₁‖², β =
   * w₂‖a₂‖² and γ = √(w₁w₂)·a₁ᴴa₂.
   *
   * This is the rung that fails if the solver's phase step is wrong, because a
   * defocused pupil makes γ genuinely complex; with a clear pupil the same
   * numbers are integers, and both are checked.
   */
  it("two illumination directions give rank exactly 2, with λ in closed form", () => {
    for (const pupil of [clear(), defocusedPupil(0.6)]) {
      // Asymmetric on purpose. A pair placed at ±s about the axis makes the
      // overlap REAL whatever the pupil's phase is: the two samples of an even
      // wavefront differ by a phase odd in the lattice coordinate, and the
      // shared region is symmetric, so the imaginary part cancels term for term
      // (measured at 5.4e-17 before this was fixed). Parity, not roundoff — and
      // it would have left the phase rotation unexercised on optical data.
      const source = twoPointSource({ sx: -0.2, sy: 0 }, { sx: 0.35, sy: 0.18 }, 0.4, 0.6);
      const factor = condenserFactor(pupil, source, opts);
      const systems = coherentSystems(factor);
      expect(systems.available).toBe(2);

      // α, β, γ straight off the factor — an independent path from the solver.
      const w = factor.weights;
      const norm2 = [0, 0];
      for (let c = 0; c < 2; c++) {
        const lo = factor.offsets[c]!;
        const hi = factor.offsets[c + 1]!;
        let s = 0;
        for (let i = lo; i < hi; i++) s += factor.re[i]! ** 2 + factor.im[i]! ** 2;
        norm2[c] = s;
      }
      const alpha = w[0]! * norm2[0]!;
      const beta = w[1]! * norm2[1]!;

      const at = new Map<number, [number, number]>();
      for (let i = factor.offsets[0]!; i < factor.offsets[1]!; i++) {
        at.set(factor.slots[i]!, [factor.re[i]!, factor.im[i]!]);
      }
      let gr = 0;
      let gi = 0;
      for (let i = factor.offsets[1]!; i < factor.offsets[2]!; i++) {
        const a1 = at.get(factor.slots[i]!);
        if (a1 === undefined) continue;
        const [pr, pi] = a1;
        const qr = factor.re[i]!;
        const qi = factor.im[i]!;
        gr += pr * qr + pi * qi;
        gi += pr * qi - pi * qr;
      }
      const root = Math.sqrt(w[0]! * w[1]!);
      gr *= root;
      gi *= root;

      const mid = (alpha + beta) / 2;
      const rad = Math.hypot((alpha - beta) / 2, Math.hypot(gr, gi));
      expect(systems.weights[0]!).toBeCloseTo(mid + rad, 8);
      expect(systems.weights[1]!).toBeCloseTo(mid - rad, 8);

      if (pupil.phaseWaves(0.5, 0) === 0) {
        // A clear pupil: every amplitude is 1 and every phase 0, so ‖a‖² is the
        // transmitting-bin count and γ/√(w₁w₂) is the SHARED-bin count. Integers.
        expect(norm2[0]!).toBe(Math.round(norm2[0]!));
        expect(gi).toBeCloseTo(0, 12);
      } else {
        // Defocus makes the overlap genuinely complex, which is what exercises
        // the solver's phase rotation on real optical data.
        expect(Math.abs(gi)).toBeGreaterThan(0.05 * Math.hypot(gr, gi));
      }
    }
  });

  /**
   * The shared-bin count is a lattice quantity, but it converges on one that is
   * not: the area two shifted unit discs share. That is the only number in this
   * file that comes from outside the engine.
   *
   * **The approach is not monotone, and asserting that it is would be wrong.**
   * Counting lattice cells inside a region is the Gauss circle problem: the
   * error is dominated by the cells the boundary crosses, and which way each
   * lands changes as the grid re-registers against the arc, so a finer grid can
   * be locally worse. Measured, it is — 0.14% at 32 bins and 0.30% at 64. What
   * IS true is the bound that produces that behaviour: the error cannot exceed
   * the cells the boundary can touch, which is the region's perimeter times the
   * cell width. That is a geometric statement about the shape, with no engine in
   * it, and it is the honest thing to pin.
   */
  it("the two directions' shared bins sit inside the overlap area's perimeter bound", () => {
    const sx = 0.3;
    // circleOverlapArea(separation, r, R) — the discs sit at ∓sx, so they are
    // 2·sx apart.
    const d = 2 * sx;
    const exact = circleOverlapArea(d, 1, 1);
    // The lens is bounded by two arcs, each subtending 2·acos(d/2r) on its own
    // unit circle.
    const perimeter = 2 * 2 * Math.acos(d / 2);
    const readings: string[] = [];
    for (const pupilSamples of [16, 32, 64]) {
      const factor = condenserFactor(
        clear(),
        twoPointSource({ sx: -sx, sy: 0 }, { sx, sy: 0 }, 0.5, 0.5),
        { pupilSamples, size: 256 },
      );
      const first = new Set<number>();
      for (let i = factor.offsets[0]!; i < factor.offsets[1]!; i++) first.add(factor.slots[i]!);
      let shared = 0;
      for (let i = factor.offsets[1]!; i < factor.offsets[2]!; i++) {
        if (first.has(factor.slots[i]!)) shared++;
      }
      const cell = 2 / pupilSamples;
      const counted = shared * cell * cell;
      expect(Math.abs(counted - exact)).toBeLessThanOrEqual(perimeter * cell);
      // And well inside 1% of it at every sampling, which the bound alone does
      // not give — the bound is 26% at 16 bins.
      expect(Math.abs(counted - exact) / exact).toBeLessThan(0.01);
      readings.push(
        `${pupilSamples}: ${shared} bins = ${counted.toFixed(5)} against ${exact.toFixed(5)} ` +
          `(${((100 * (counted - exact)) / exact).toFixed(3)}%, bound ` +
          `${((100 * perimeter * cell) / exact).toFixed(1)}%)`,
      );
    }
    console.log("§ 6cs.3 shared bins against the discs' overlap area:\n  " + readings.join("\n  "));
  });
});

describe("§ 6cs.4 — the image, and what truncation actually costs", () => {
  const pupil = defocusedPupil(0.3);
  const source = diskSource(0.5, 9);
  const pupilSamples = 16;
  const n = 32;
  const opts = { pupilSamples, size: n };
  const factor = condenserFactor(pupil, source, opts);
  const tcc = transmissionCrossCoefficients(pupil, source, opts);
  const systems = coherentSystems(factor);

  const grating = cosineGratingObject({ size: n, cycles: 4, modulation: 0.6 });
  const noise = noisyObject(n, 4242);

  it("untruncated, it is Hopkins' image and Abbe's image alike", () => {
    for (const obj of [grating, noise]) {
      const abbe = abbeImage(obj, pupil, source, { pupilSamples });
      const hop = hopkinsImage(obj, tcc);
      const socs = socsImage(obj, systems);
      expect(socs.modes).toBe(systems.available);
      expect(socs.capturedFraction).toBeCloseTo(1, 14);
      expect(worstRelative(abbe.intensity, socs.intensity)).toBeLessThan(1e-12);
      expect(worstRelative(hop.intensity, socs.intensity)).toBeLessThan(1e-12);
    }
  });

  /**
   * Every λ ≥ 0 and every |·|² ≥ 0, so a truncated sum is the full sum minus
   * something non-negative AT EVERY PIXEL. The error is a one-signed bias and
   * not noise, and it is monotone in the mode count. Nothing about this is a
   * tolerance — the only slack is f64 rounding of the accumulate.
   */
  it("truncation is one-signed: fewer modes is dimmer everywhere, never brighter", () => {
    const full = socsImage(noise, systems).intensity;
    let previous: Float64Array | undefined;
    for (const k of [1, 2, 4, 8, 16, 32]) {
      const cut = socsImage(noise, systems, { modes: k }).intensity;
      for (let i = 0; i < cut.length; i++) {
        expect(cut[i]!).toBeLessThanOrEqual(full[i]! + 1e-12);
        if (previous !== undefined) expect(cut[i]!).toBeGreaterThanOrEqual(previous[i]! - 1e-12);
      }
      previous = cut;
    }
  });

  /**
   * How far the truncation error is from the light it dropped. Measured
   * UNNORMALIZED: the truncated image is uniformly dimmer, so scaling either
   * image to a common peak or a common total would hide exactly the error being
   * measured.
   */
  it("the error tracks the light dropped, and the decay is reported not assumed", () => {
    const rows: string[] = [];
    for (const k of [1, 2, 4, 8, 16, 32, systems.available]) {
      const cut = socsImage(noise, systems, { modes: k });
      const cutG = socsImage(grating, systems, { modes: k });
      const full = socsImage(noise, systems).intensity;
      const fullG = socsImage(grating, systems).intensity;
      rows.push(
        `k=${String(k).padStart(3)} captured=${(cut.capturedFraction * 100).toFixed(4)}% ` +
          `noise=${worstRelative(full, cut.intensity).toExponential(2)} ` +
          `grating=${worstRelative(fullG, cutG.intensity).toExponential(2)}`,
      );
    }
    console.log(`§ 6cs.4 truncation, ${systems.available} modes available:\n  ` + rows.join("\n  "));

    // The one thing that is an assertion rather than a reading: dropping light
    // cannot make the picture better, and capturing all of it must be exact.
    const one = socsImage(noise, systems, { modes: 1 });
    expect(one.capturedFraction).toBeLessThan(1);
    expect(socsImage(noise, systems).capturedFraction).toBeCloseTo(1, 14);
  });

  /**
   * `capture` is the API's own truncation rule and it is stated in the physical
   * quantity: the fraction of transmitted light — the kernel's trace — the kept
   * modes carry.
   */
  it("capture keeps the fewest modes that reach the asked-for fraction", () => {
    let previous = 0;
    for (const f of [0.5, 0.9, 0.99, 0.999]) {
      const cut = coherentSystems(factor, { capture: f });
      expect(cut.capturedFraction).toBeGreaterThanOrEqual(f);
      expect(cut.modes).toBeGreaterThanOrEqual(previous);
      expect(cut.modes).toBeLessThanOrEqual(systems.available);
      // One fewer would have missed it — that is what "fewest" means.
      if (cut.modes > 1) {
        let short = 0;
        for (let j = 0; j < cut.modes - 1; j++) short += cut.weights[j]!;
        expect(short / cut.totalWeight).toBeLessThan(f);
      }
      previous = cut.modes;
      console.log(
        `§ 6cs.4 capture ${f}: ${cut.modes} of ${systems.available} modes, ` +
          `${(cut.bytes / 1024).toFixed(1)} KB against the kernel's ${(tcc.bytes / 1024).toFixed(1)} KB`,
      );
    }
  });

  /**
   * Whether truncation is a SPEED win is specimen-dependent, and this is the
   * measurement that says so rather than an inequality that assumes it.
   * `hopkinsImage` skips zero object-spectrum bins, so its work collapses on a
   * grating and does not on noise; the coherent sum's work does not move.
   */
  it("Hopkins' work depends on the specimen and the coherent sum's does not", () => {
    const sparse = hopkinsImage(grating, tcc);
    const dense = hopkinsImage(noise, tcc);
    // Each counter is compared only against ITSELF on another object.
    // `kernelTerms` counts bilinear terms and `transforms` counts inverse FFTs;
    // they are different units, and a ratio between them would be a flop
    // estimate dressed as a reading. Which sum is faster is a wall-time
    // question this file does not answer.
    expect(sparse.kernelTerms).toBeLessThan(dense.kernelTerms / 10);
    expect(dense.kernelTerms).toBeLessThanOrEqual(tcc.entries);
    // The coherent sum takes one transform per mode whatever the object is.
    expect(socsImage(grating, systems, { modes: 8 }).transforms).toBe(8);
    expect(socsImage(noise, systems, { modes: 8 }).transforms).toBe(8);
    console.log(
      `§ 6cs.4 Hopkins terms: grating ${sparse.kernelTerms}, noise ${dense.kernelTerms}, ` +
        `kernel entries ${tcc.entries}`,
    );
  });
});
