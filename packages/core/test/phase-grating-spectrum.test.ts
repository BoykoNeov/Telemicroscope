import { describe, expect, it } from "vitest";
import {
  phaseGratingObject,
  phaseGratingTruncation,
  pointwisePhaseGratingObject,
} from "../src/illumination";
import { besselJ, besselJ1, fft1d } from "../src/math";

/**
 * § 6ab.13 — the phase grating's spectrum, and what a finite grid does to it.
 *
 * § 6ab.12 found the symptom: a darkfield cell that can carry no second harmonic
 * still read 1.2e-7 at φ = 3, because the grating's own high orders had folded
 * across the grid and re-entered the pupil. This step pins the cause and the fix.
 *
 * Nothing here is asserted against a remembered table. The pins are:
 *
 *  - **Bessel's integral**, Jₘ(x) = (1/π)∫₀^π cos(mθ − x·sin θ) dθ, evaluated by
 *    a trapezoid rule that is spectrally convergent because the integrand is
 *    analytic and periodic. It is a *second definition* of the series `besselJ`
 *    evaluates, which is the module's stated policy.
 *  - **Σₘ Jₘ(x)² = 1** for every x — Neumann's identity, and the reason the
 *    dropped-energy figure can be exact rather than a bound.
 *  - **An FFT of the continuous object** over 2048 samples of one period, where
 *    its own folding is far below f64. That recovers the spectrum with no
 *    Bessel function anywhere, so
 *    the band-limited object and the series that builds it are two independent
 *    derivations of the same field.
 */

/** Jₘ(x) from Bessel's integral, by the trapezoid rule over [0, π]. */
function besselIntegral(m: number, x: number, panels = 4096): number {
  // Trapezoid on a periodic analytic integrand converges faster than any power
  // of 1/panels — the endpoints are where cos(mθ − x sin θ) has zero derivative,
  // so this is not the O(h²) rule it looks like.
  let sum = 0;
  for (let i = 0; i <= panels; i++) {
    const theta = (Math.PI * i) / panels;
    const w = i === 0 || i === panels ? 0.5 : 1;
    sum += w * Math.cos(m * theta - x * Math.sin(theta));
  }
  return sum / panels;
}

/** One row of an `ObjectField` — the grating runs along x, so a row is all of it. */
function row(object: { size: number; re: Float64Array; im: Float64Array }): {
  re: Float64Array;
  im: Float64Array;
} {
  return { re: object.re.slice(0, object.size), im: object.im.slice(0, object.size) };
}

describe("§ 6ab.13 — Jₘ against a second definition", () => {
  it("matches Bessel's integral over every argument the grating uses, and gives up where the module says", () => {
    const worstAt = (x: number): number => {
      let worst = 0;
      for (const m of [0, 1, 2, 3, 5, 7, 10, 16, 24]) {
        worst = Math.max(worst, Math.abs(besselJ(m, x) - besselIntegral(m, x)));
      }
      return worst;
    };
    // The φ slider tops out at 3, so everything the grating ever asks for is here,
    // and here the two definitions agree to f64. Absolute, not relative: past the
    // hump Jₘ is genuinely tiny and a relative test would be measuring the
    // quadrature's own noise against it.
    for (const x of [0.05, 0.4, 1, 2.5, 3, 7.5]) {
      expect(worstAt(x)).toBeLessThan(3e-15);
    }
    // Past that the SERIES is the one that gives up, not the quadrature — the
    // alternating sum surrenders about ε·Iₘ(x) and Iₘ grows like e^x. Bracketing
    // rather than bounding, because a rung that only checked "small enough" would
    // pass just as well if the loss were not happening, and `BESSEL_SERIES_LIMIT`
    // rests on its being real. This is the measurement behind that constant.
    expect(worstAt(15)).toBeGreaterThan(1e-13);
    expect(worstAt(15)).toBeLessThan(1e-10);
    expect(worstAt(25)).toBeGreaterThan(1e-9);
    expect(worstAt(25)).toBeLessThan(1e-6);
  });

  it("and reproduces the J₁ the engine already had", () => {
    // `besselJ1` is separately pinned (§ 6r) and stays — this is the free
    // cross-check that the general series was not written with a shifted index,
    // which is the one way to get every order wrong and still look plausible.
    for (const x of [-9, -3, -0.4, 0, 0.4, 3, 9, 20]) {
      expect(besselJ(1, x)).toBeCloseTo(besselJ1(x), 15);
    }
    // J₋ₘ = (−1)ᵐJₘ, which is what lets the synthesis place c₋ₘ = c_m.
    for (const m of [1, 2, 3, 4]) {
      expect(besselJ(-m, 3)).toBeCloseTo((m % 2 === 0 ? 1 : -1) * besselJ(m, 3), 15);
    }
  });

  it("and the orders carry all of the light, which is why dropped energy is exact", () => {
    // Neumann: J₀² + 2Σ_{m≥1} Jₘ² = 1. Nothing about the grid — it is the statement
    // that a pure phase object transmits everything, order by order. Over the
    // range the grating uses it holds to the last bit, which is what makes
    // `droppedEnergy` an exact quantity rather than an estimate.
    for (const x of [0.4, 1, 3, 7.5]) {
      let total = besselJ(0, x) ** 2;
      for (let m = 1; m <= 200; m++) total += 2 * besselJ(m, x) ** 2;
      expect(Math.abs(total - 1)).toBeLessThan(3e-15);
    }
    // And it degrades with the series, not independently of it — same 1e-7 at the
    // series limit as the rung above measured against the integral, which says the
    // loss is in Jₘ and not in the identity.
    let atLimit = besselJ(0, 25) ** 2;
    for (let m = 1; m <= 200; m++) atLimit += 2 * besselJ(m, 25) ** 2;
    expect(Math.abs(atLimit - 1)).toBeGreaterThan(1e-9);
    expect(Math.abs(atLimit - 1)).toBeLessThan(1e-6);
  });
});

describe("§ 6ab.13 — the band-limited object is the continuous one, cut to the grid", () => {
  const CASES = [
    { size: 128, cycles: 13, amplitudeRadians: 3 },
    { size: 128, cycles: 12, amplitudeRadians: 3 },
    { size: 128, cycles: 12, amplitudeRadians: 0.4 },
    { size: 128, cycles: 4, amplitudeRadians: 3 },
    { size: 256, cycles: 13, amplitudeRadians: 3 },
    { size: 64, cycles: 21, amplitudeRadians: 2 },
  ];

  /**
   * The same object built from an FFT of the continuous transmittance — no
   * Bessel function anywhere.
   *
   * Sampling exp(iφ·cos θ) at L points of one period and transforming gives
   * L·c_k for |k| < L/2, where c_m are the object's Fourier coefficients; at
   * L = 2048 the coefficients that fold are J₂₀₀₀-ish, so the recovery is exact
   * to f64. Keeping only |m| ≤ maxOrder and re-summing is the band limit stated
   * without reference to how the engine builds it.
   */
  function spectralReference(size: number, cycles: number, phi: number, maxOrder: number) {
    const L = 2048;
    const re = new Float64Array(L);
    const im = new Float64Array(L);
    for (let n = 0; n < L; n++) {
      const p = phi * Math.cos((2 * Math.PI * n) / L);
      re[n] = Math.cos(p);
      im[n] = Math.sin(p);
    }
    fft1d(re, im, false);
    const c = (m: number): { re: number; im: number } => {
      const k = ((m % L) + L) % L;
      return { re: re[k]! / L, im: im[k]! / L };
    };
    const outRe = new Float64Array(size);
    const outIm = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      for (let m = -maxOrder; m <= maxOrder; m++) {
        const a = 2 * Math.PI * ((m * cycles * x) / size);
        const cm = c(m);
        outRe[x] = outRe[x]! + cm.re * Math.cos(a) - cm.im * Math.sin(a);
        outIm[x] = outIm[x]! + cm.re * Math.sin(a) + cm.im * Math.cos(a);
      }
    }
    return { re: outRe, im: outIm };
  }

  it("agrees with an FFT of the continuous object, which never mentions a Bessel", () => {
    for (const c of CASES) {
      const built = row(phaseGratingObject(c));
      const { maxOrder } = phaseGratingTruncation(c);
      const ref = spectralReference(c.size, c.cycles, c.amplitudeRadians, maxOrder);
      let worst = 0;
      for (let x = 0; x < c.size; x++) {
        worst = Math.max(worst, Math.hypot(built.re[x]! - ref.re[x]!, built.im[x]! - ref.im[x]!));
      }
      expect(worst).toBeLessThan(1e-13);
    }
  });

  it("and its spectrum is the orders it kept and NOTHING else", () => {
    // The whole point: `abbeImage` reads DFT bins as diffraction directions, so a
    // bin that is not an order must be empty, not merely small. Bin m·cycles must
    // hold iᵐJₘ(φ) — sign and quadrature included, since getting iᵐ wrong would
    // turn a phase grating into an amplitude one and still look like a grating.
    const c = { size: 128, cycles: 13, amplitudeRadians: 3 };
    const { maxOrder } = phaseGratingTruncation(c);
    expect(maxOrder).toBe(4);
    const r = row(phaseGratingObject(c));
    fft1d(r.re, r.im, false);

    const orderBins = new Map<number, number>();
    for (let m = -maxOrder; m <= maxOrder; m++) {
      orderBins.set(((m * c.cycles) % c.size + c.size) % c.size, m);
    }
    let worstOrder = 0;
    let worstEmpty = 0;
    for (let k = 0; k < c.size; k++) {
      const amp = Math.hypot(r.re[k]!, r.im[k]!) / c.size;
      const m = orderBins.get(k);
      if (m === undefined) {
        worstEmpty = Math.max(worstEmpty, amp);
        continue;
      }
      const j = besselJ(m, c.amplitudeRadians);
      const want = [j, 0, -j, 0][((m % 4) + 4) % 4]!;
      const wantIm = [0, j, 0, -j][((m % 4) + 4) % 4]!;
      worstOrder = Math.max(
        worstOrder,
        Math.hypot(r.re[k]! / c.size - want, r.im[k]! / c.size - wantIm),
      );
    }
    expect(worstOrder).toBeLessThan(1e-14);
    expect(worstEmpty).toBeLessThan(1e-15);

    // The pointwise construction fails exactly here, and by a visible amount:
    // order 5 has folded onto bin 65 (signed −63, which is −4.85 orders — not an
    // order at all) carrying J₅(3).
    const p = row(pointwisePhaseGratingObject(c));
    fft1d(p.re, p.im, false);
    expect(Math.hypot(p.re[65]!, p.im[65]!) / c.size).toBeCloseTo(
      Math.abs(besselJ(5, 3)),
      12,
    );
    // 4.3e-2 of the amplitude, in a direction the object diffracts nothing into.
    expect(Math.abs(besselJ(5, 3))).toBeGreaterThan(4e-2);
  });
});

describe("§ 6ab.13 — the price of band-limiting, reported rather than discovered", () => {
  const CASES = [
    { size: 128, cycles: 13, amplitudeRadians: 3 },
    { size: 128, cycles: 12, amplitudeRadians: 3 },
    { size: 128, cycles: 12, amplitudeRadians: 0.4 },
    { size: 256, cycles: 13, amplitudeRadians: 3 },
    { size: 512, cycles: 13, amplitudeRadians: 3 },
  ];

  it("the modulus ripple is inside the reported bound, and the bound is not vacuous", () => {
    // A strictly band-limited object cannot be pure phase: dropping orders leaves
    // |t| ≠ 1. `modulusBound` is 2·Σ|Jₘ| over the dropped tail, which bounds it
    // because each dropped order can contribute at most its own modulus — and it
    // is within a factor of two of tight, because the tail is dominated by its
    // first term. A bound ten orders loose would technically hold and tell a
    // caller nothing. Measured, the ripple is 0.61–0.97 of the bound.
    for (const c of CASES) {
      const t = phaseGratingTruncation(c);
      const r = row(phaseGratingObject(c));
      let dev = 0;
      for (let x = 0; x < c.size; x++) {
        dev = Math.max(dev, Math.abs(Math.hypot(r.re[x]!, r.im[x]!) - 1));
      }
      if (t.modulusBound < 1e-12) {
        // 512 bins at 13 cycles keeps orders to |m| = 19, and J₂₀(3) is 1e-15 —
        // the truncation has gone under f64 and the ripple that remains is the
        // transform's own roundoff, not the cut. Nothing here can be compared to
        // the bound because the bound is smaller than the measurement.
        expect(t.modulusBound).toBeLessThan(1e-14);
        expect(dev).toBeLessThan(1e-14);
        continue;
      }
      expect(dev).toBeLessThanOrEqual(t.modulusBound);
      expect(dev).toBeGreaterThan(0.5 * t.modulusBound);
    }
  });

  it("and the dropped energy is what the object stops transmitting — Parseval, not a bound", () => {
    // Σ_{|m|≤M} Jₘ² is the mean of |t|² over a period, so the light the truncation
    // removed is measurable on the field itself. This is the number that says how
    // far from "absorbs nothing" the object on screen actually is.
    for (const c of CASES) {
      const t = phaseGratingTruncation(c);
      const r = row(phaseGratingObject(c));
      let mean = 0;
      for (let x = 0; x < c.size; x++) mean += r.re[x]! ** 2 + r.im[x]! ** 2;
      mean /= c.size;
      expect(mean).toBeCloseTo(1 - t.droppedEnergy, 13);
    }
  });

  it("and at the corner of both sliders it is a QUARTER of the light, not a rounding error", () => {
    // 31 cycles is the panel's `maxCycles` at 128 bins and φ = 3 is the top of the
    // other slider. There the grid holds orders to |m| = 2 and drops J₃(3) = 0.31
    // onward: 23% of the transmitted light is not in the object at all, and the
    // amplitude ripple runs to 0.61.
    //
    // This is not the fix failing — it is the fix reporting. The pointwise
    // construction at the same corner keeps that 23%, but puts it in directions
    // the object diffracts nothing into, where it forms image detail nobody can
    // tell from the real thing. A quarter of the light missing is a number a panel
    // can print; a quarter of the light in the wrong place is not.
    const corner = { size: 128, cycles: 31, amplitudeRadians: 3 };
    const t = phaseGratingTruncation(corner);
    expect(t.maxOrder).toBe(2);
    expect(t.droppedEnergy).toBeGreaterThan(0.22);
    expect(t.droppedEnergy).toBeLessThan(0.24);
    // Against the closed form, which is the whole content of "exact, not a bound":
    // what is dropped is 1 minus what is kept.
    const kept = besselJ(0, 3) ** 2 + 2 * besselJ(1, 3) ** 2 + 2 * besselJ(2, 3) ** 2;
    expect(t.droppedEnergy).toBeCloseTo(1 - kept, 14);
  });

  it("and it vanishes where the panel actually lives", () => {
    // Everywhere below that corner the cut is unmeasurable: at φ = 0.4 the two
    // constructions are the same field to seven decimals, which is why nothing
    // else in the ladder moved when this landed.
    const weak = { size: 128, cycles: 12, amplitudeRadians: 0.4 };
    expect(phaseGratingTruncation(weak).modulusBound).toBeLessThan(2e-7);
    // 1.6e-14 of the light, which is a hundred million times below the 6.8e-7 the
    // aliasing it replaces was contributing.
    expect(phaseGratingTruncation(weak).droppedEnergy).toBeLessThan(2e-14);
    const a = row(phaseGratingObject(weak));
    const b = row(pointwisePhaseGratingObject(weak));
    let diff = 0;
    for (let x = 0; x < weak.size; x++) {
      diff = Math.max(diff, Math.hypot(a.re[x]! - b.re[x]!, a.im[x]! - b.im[x]!));
    }
    expect(diff).toBeLessThan(2e-7);
  });

  it("and zero cycles loses nothing, because every order lands on DC", () => {
    // Not a special case for its own sake: it is the one grating whose infinite
    // series is exactly representable, and Σₘ iᵐJₘ(φ) = exp(iφ) is the Jacobi–Anger
    // identity read at θ = 0. If the synthesis had the phases of iᵐ wrong this is
    // where it would show up as a wrong constant rather than a wrong image.
    const flat = phaseGratingObject({ size: 64, cycles: 0, amplitudeRadians: 3 });
    expect(flat.truncation?.maxOrder).toBe(Number.POSITIVE_INFINITY);
    expect(flat.truncation?.droppedEnergy).toBe(0);
    expect(flat.re[0]).toBeCloseTo(Math.cos(3), 15);
    expect(flat.im[0]).toBeCloseTo(Math.sin(3), 15);

    let sumRe = besselJ(0, 3);
    let sumIm = 0;
    for (let m = 1; m <= 60; m++) {
      const j = besselJ(m, 3);
      if (m % 2 === 0) sumRe += 2 * (m % 4 === 0 ? j : -j);
      else sumIm += 2 * (m % 4 === 1 ? j : -j);
    }
    expect(sumRe).toBeCloseTo(Math.cos(3), 13);
    expect(sumIm).toBeCloseTo(Math.sin(3), 13);
  });
});
