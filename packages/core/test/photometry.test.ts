import { describe, it, expect } from "vitest";
import {
  CMF_MAX_NM,
  CMF_MIN_NM,
  chromaticity,
  correlatedColorTemperature,
  spectrumToXyz,
  yBar,
} from "../src/photometry/cmf";
import {
  WIEN_DISPLACEMENT,
  blackbodySpectrum,
  planckSpectralRadiance,
  wienPeakNm,
} from "../src/photometry/blackbody";
import {
  D65_WHITE,
  decodeGamma,
  encodeGamma,
  linearRgbToXyz,
  luminance,
  toSrgb,
  xyzToLinearRgb,
} from "../src/photometry/srgb";
import { spectralSamples, spectralXyz } from "../src/photometry/spectrum";

const equalEnergy = () => 1;

describe("CIE 1931 standard observer", () => {
  it("the equal-energy illuminant E is at chromaticity (1/3, 1/3)", () => {
    // The defining property of illuminant E, and the sharpest single check on
    // the observer: it says the three CMFs have equal integrals, which is how
    // the 1931 tables were normalized in the first place.
    const c = chromaticity(spectrumToXyz(equalEnergy));
    expect(c.x).toBeCloseTo(1 / 3, 2);
    expect(c.y).toBeCloseTo(1 / 3, 2);
    // Tighter than toBeCloseTo(_, 2) can state, and this IS the analytic fit's
    // error budget: the tabulated observer would give 1/3 to five decimals.
    expect(Math.abs(c.x - 1 / 3)).toBeLessThan(1e-3);
    expect(Math.abs(c.y - 1 / 3)).toBeLessThan(1e-3);
  });

  it("ȳ peaks at the photopic 555 nm", () => {
    let peak = 0;
    let at = 0;
    for (let nm = CMF_MIN_NM; nm <= CMF_MAX_NM; nm += 0.01) {
      const v = yBar(nm);
      if (v > peak) {
        peak = v;
        at = nm;
      }
    }
    // ȳ IS V(λ), whose peak is at 555 nm by definition of the photopic curve.
    expect(at).toBeGreaterThan(554);
    expect(at).toBeLessThan(556);
    // V(λ) is normalized to 1 at its peak.
    expect(peak).toBeCloseTo(1, 2);
  });

  it("chromaticity of a colour with no energy is an error, not (0, 0)", () => {
    expect(() => chromaticity({ x: 0, y: 0, z: 0 })).toThrow();
  });
});

describe("blackbody radiation", () => {
  it("peak wavelength obeys Wien's displacement law", () => {
    for (const T of [1000, 3000, 5772, 10000]) {
      let peak = 0;
      let at = 0;
      const guess = wienPeakNm(T);
      for (let nm = guess * 0.5; nm <= guess * 1.5; nm += guess * 1e-5) {
        const v = planckSpectralRadiance(nm, T);
        if (v > peak) {
          peak = v;
          at = nm;
        }
      }
      expect((at * 1e-9 * T) / WIEN_DISPLACEMENT).toBeCloseTo(1, 4);
    }
  });

  it("total radiant exitance scales as T⁴ (Stefan–Boltzmann)", () => {
    // Integrated on a geometric grid, which resolves both the steep short-λ
    // cutoff and the long Rayleigh–Jeans tail with the same relative accuracy.
    const total = (T: number): number => {
      let acc = 0;
      const a = Math.log(50);
      const b = Math.log(5e6);
      const n = 20000;
      for (let i = 0; i <= n; i++) {
        const u = a + (i * (b - a)) / n;
        const nm = Math.exp(u);
        acc += (i === 0 || i === n ? 0.5 : 1) * planckSpectralRadiance(nm, T) * nm * ((b - a) / n);
      }
      return acc;
    };
    expect(total(2000) / total(1000)).toBeCloseTo(16, 3);
    expect(total(3000) / total(1000)).toBeCloseTo(81, 1);
  });

  it("a 6500 K Planckian radiator lands on the published locus point", () => {
    // (0.3135, 0.3237) — the standard tabulated chromaticity of the Planckian
    // locus at 6500 K. This pins the observer and the Planck function TOGETHER
    // against a number from outside both.
    const c = chromaticity(spectrumToXyz(blackbodySpectrum(6500)));
    expect(c.x).toBeCloseTo(0.3135, 3);
    expect(c.y).toBeCloseTo(0.3237, 3);
  });

  it("a blackbody's colour temperature comes back out through McCamy", () => {
    // Blackbody → observer → chromaticity → published cubic → temperature. A
    // round trip that leaves the engine entirely and returns; nothing in it is
    // engine-vs-engine.
    for (const T of [3000, 4000, 5000, 6500]) {
      const cct = correlatedColorTemperature(chromaticity(spectrumToXyz(blackbodySpectrum(T))));
      expect(Math.abs(cct - T) / T).toBeLessThan(0.015);
    }
  });

  it("hotter is bluer: chromaticity x falls monotonically with temperature", () => {
    const xs = [2000, 3000, 5000, 8000, 15000].map(
      (T) => chromaticity(spectrumToXyz(blackbodySpectrum(T))).x,
    );
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThan(xs[i - 1]!);
  });
});

describe("sRGB (IEC 61966-2-1)", () => {
  it("the D65 white point is linear RGB (1, 1, 1)", () => {
    const rgb = xyzToLinearRgb(D65_WHITE);
    expect(rgb.r).toBeCloseTo(1, 3);
    expect(rgb.g).toBeCloseTo(1, 3);
    expect(rgb.b).toBeCloseTo(1, 3);
  });

  it("white has unit relative luminance", () => {
    expect(luminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 12);
  });

  it("the transfer curve round-trips and fixes both endpoints", () => {
    expect(encodeGamma(0)).toBe(0);
    expect(encodeGamma(1)).toBeCloseTo(1, 12);
    for (const v of [0.001, 0.0031308, 0.05, 0.18, 0.5, 0.9]) {
      expect(decodeGamma(encodeGamma(v))).toBeCloseTo(v, 9);
    }
    // Mid-grey 0.5 encoded is ~0.7354 — the well-known sRGB value.
    expect(encodeGamma(0.5)).toBeCloseTo(0.7354, 3);
  });

  it("out-of-gamut spectral colours are reported, not silently clipped", () => {
    // A saturated blue-violet outside the sRGB triangle: a negative channel.
    const out = toSrgb({ x: 0.05, y: 0.01, z: 0.5 });
    expect(out.clipped).toBe(true);
    expect(out.r).toBeGreaterThanOrEqual(0);
    expect(toSrgb(D65_WHITE).clipped).toBe(false);
  });

  it("the two matrices are inverses (round trip)", () => {
    const c = { r: 0.3, g: 0.6, b: 0.2 };
    const back = xyzToLinearRgb(linearRgbToXyz(c));
    expect(back.r).toBeCloseTo(c.r, 3);
    expect(back.g).toBeCloseTo(c.g, 3);
    expect(back.b).toBeCloseTo(c.b, 3);
  });
});

describe("spectral sampling → colour", () => {
  it("an equal-energy spectrum is neutral at ANY sample count", () => {
    // The rung that justifies integrating the observer over each bin instead
    // of sampling it at the centre. Point-sampled, N=9 lands at (0.3382,
    // 0.3405) and the answer wanders with N; bin-integrated, every count from
    // 5 to 15 agrees to 1e-4 with the continuous integral over the same band.
    const reference = chromaticity(spectrumToXyz(equalEnergy, { fromNm: 400, toNm: 700 }));
    for (const count of [5, 7, 9, 11, 15]) {
      const samples = spectralSamples(equalEnergy, { count });
      const c = chromaticity(spectralXyz(samples, samples.map(() => 1)));
      expect(Math.abs(c.x - reference.x)).toBeLessThan(1e-4);
      expect(Math.abs(c.y - reference.y)).toBeLessThan(1e-4);
    }
  });

  it("a sampled blackbody reproduces its own colour temperature", () => {
    // The engine-facing path (9 discrete wavelengths) has to agree with the
    // continuous integral, or every rendered colour is a quadrature artifact.
    for (const T of [3000, 5000, 6500]) {
      const samples = spectralSamples(blackbodySpectrum(T));
      const c = chromaticity(spectralXyz(samples, samples.map(() => 1)));
      const cct = correlatedColorTemperature(c);
      expect(Math.abs(cct - T) / T).toBeLessThan(0.05);
    }
  });

  it("weights are the source spectrum, with no observer response folded in", () => {
    // Guards the contract that makes colour possible: if ȳ(λ) were folded into
    // `weight`, a flat spectrum's weights would peak at 555 nm instead of
    // being flat, and the three channels could no longer be told apart.
    const samples = spectralSamples(equalEnergy, { count: 9 });
    const step = (700 - 400) / 9;
    for (const s of samples) expect(s.weight).toBeCloseTo(step, 12);
  });

  it("intensity differences across wavelength become colour differences", () => {
    // The mechanism the whole hero image rests on, in miniature: the same
    // observer and the same spectrum, but energy piled at the short end versus
    // the long end, must come back as two different colours.
    const samples = spectralSamples(equalEnergy, { count: 9 });
    const blueHeavy = samples.map((s) => (s.nm < 550 ? 1 : 0.05));
    const redHeavy = samples.map((s) => (s.nm < 550 ? 0.05 : 1));
    const b = chromaticity(spectralXyz(samples, blueHeavy));
    const r = chromaticity(spectralXyz(samples, redHeavy));
    expect(r.x).toBeGreaterThan(b.x + 0.2);
    expect(xyzToLinearRgb(spectralXyz(samples, blueHeavy)).b).toBeGreaterThan(
      xyzToLinearRgb(spectralXyz(samples, blueHeavy)).r,
    );
  });
});
