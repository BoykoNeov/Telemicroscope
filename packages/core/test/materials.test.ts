import { describe, it, expect } from "vitest";
import {
  indexD,
  indexE,
  abbeNumber,
  abbeNumberE,
  LINE_G,
  LINE_F,
  LINE_C,
  LINE_D,
} from "../src/materials/dispersion";
import {
  N_BK7,
  F2,
  CAF2,
  FUSED_SILICA,
  WATER,
  IMMERSION_OIL,
  D263,
  getMedium,
} from "../src/materials/catalog";

/**
 * Validation rungs pinned to Schott datasheet values (and Malitson 1965 for
 * fused silica). If these fail, the dispersion engine or the coefficients
 * are wrong — never widen the tolerances.
 */
describe("glass catalog vs datasheets", () => {
  it("N-BK7: nd ≈ 1.5168, Vd ≈ 64.17", () => {
    expect(indexD(N_BK7)).toBeCloseTo(1.5168, 3);
    expect(abbeNumber(N_BK7)).toBeCloseTo(64.17, 0);
  });

  it("N-BK7: the g line and BOTH relative partial dispersions, off the datasheet", () => {
    // SCHOTT N-BK7® data sheet 517642.251 (19-Aug-2010), which prints the index
    // at each Fraunhofer line and the relative partial dispersions computed from
    // them. This is the pin that lets § 6at's four-glass split rest on a printed
    // partial dispersion instead of on a line this repo fitted to itself — and
    // it anchors § 6ar.6 retroactively, since that rung measured P_d,C from the
    // Sellmeier and never compared it to the datasheet's own printed 0.3076.
    expect(N_BK7.n(LINE_G)).toBeCloseTo(1.52668, 5); // datasheet n_g
    expect(N_BK7.n(LINE_F)).toBeCloseTo(1.52238, 5); // datasheet n_F
    expect(N_BK7.n(LINE_C)).toBeCloseTo(1.51432, 5); // datasheet n_C
    expect(N_BK7.n(LINE_F) - N_BK7.n(LINE_C)).toBeCloseTo(0.008054, 6);

    const span = N_BK7.n(LINE_F) - N_BK7.n(LINE_C);
    // P_g,F = (n_g − n_F)/(n_F − n_C): datasheet 0.5349
    expect((N_BK7.n(LINE_G) - N_BK7.n(LINE_F)) / span).toBeCloseTo(0.5349, 4);
    // P_d,C = (n_d − n_C)/(n_F − n_C): datasheet 0.3076
    expect((N_BK7.n(LINE_D) - N_BK7.n(LINE_C)) / span).toBeCloseTo(0.3076, 4);
  });

  it("F2: nd ≈ 1.620, Vd ≈ 36.37", () => {
    expect(indexD(F2)).toBeCloseTo(1.62, 2);
    expect(abbeNumber(F2)).toBeCloseTo(36.37, 0);
  });

  it("fused silica: nd ≈ 1.4585, n(1064nm) ≈ 1.4496 (Malitson)", () => {
    expect(indexD(FUSED_SILICA)).toBeCloseTo(1.4585, 3);
    expect(FUSED_SILICA.n(1064)).toBeCloseTo(1.4496, 3);
  });

  it("CaF₂ (fluorite): nd ≈ 1.4338, Vd ≈ 95.0 (Malitson 1963)", () => {
    // The ED material. Its ANOMALOUS relative partial dispersion — not this Abbe
    // number — is what buys the reduced secondary spectrum; that is pinned where
    // it is used, in test/ed-refractor.test.ts (VALIDATION § 5k).
    expect(indexD(CAF2)).toBeCloseTo(1.4338, 3);
    expect(abbeNumber(CAF2)).toBeCloseTo(95.0, 0);
  });

  it("normal dispersion: n(F) > n(d) > n(C) for all media", () => {
    for (const g of [N_BK7, F2, CAF2, FUSED_SILICA, WATER, IMMERSION_OIL, D263]) {
      expect(g.n(486.1327)).toBeGreaterThan(g.n(587.5618));
      expect(g.n(587.5618)).toBeGreaterThan(g.n(656.2725));
    }
  });

  it("registry lookup works and rejects unknowns", () => {
    expect(getMedium("N-BK7")).toBe(N_BK7);
    expect(() => getMedium("UNOBTAINIUM")).toThrow();
  });
});

/**
 * The microscope branch's immersion/coverslip media. Pinned to their published
 * dispersion data (Daimon & Masumura 2007 for water; the Cargille Type B and
 * Schott D263 T eco datasheets) — the ROADMAP step-6 prerequisite, since at high
 * NA a non-dispersive `constantIndex` immersion makes the branch's chromatic
 * behaviour dishonest. Never widen these tolerances.
 */
describe("immersion / coverslip media vs datasheets", () => {
  it("water (Daimon & Masumura 2007, 20 °C): nd ≈ 1.333, Vd ≈ 55.7", () => {
    // nd pinned to the accepted textbook water index (transcription check, not
    // an echo of the formula's own output); Vd to water's independently-known
    // Abbe (~55.6) — that leg is the genuine external anchor on the dispersion.
    expect(indexD(WATER)).toBeCloseTo(1.333, 3);
    expect(abbeNumber(WATER)).toBeCloseTo(55.7, 0);
  });

  it("immersion oil (Cargille Type B): nd ≈ 1.5150, nₑ ≈ 1.5180", () => {
    // The ISO 8036 / "n = 1.515" standard oil-immersion fluid, its own Cauchy
    // equation. nd/nₑ are datasheet header values.
    expect(indexD(IMMERSION_OIL)).toBeCloseTo(1.515, 3);
    expect(indexE(IMMERSION_OIL)).toBeCloseTo(1.518, 3);
  });

  it("immersion oil: the Cauchy equation reproduces the datasheet line table", () => {
    // Directly against the printed 23 °C index table — this validates the
    // cauchy() constructor against external numbers, not just the header.
    expect(IMMERSION_OIL.n(486.1)).toBeCloseTo(1.5236, 4); // F  (H)
    expect(IMMERSION_OIL.n(656.3)).toBeCloseTo(1.5116, 4); // C  (H)
    expect(IMMERSION_OIL.n(480.0)).toBeCloseTo(1.5243, 4); // F′ (Cd)
    expect(IMMERSION_OIL.n(643.9)).toBeCloseTo(1.5122, 4); // C′ (Cd)
  });

  it("immersion oil: Abbe νd ≈ 42.9 (d/F/C) and νₑ ≈ 42.8 (e/F′/C′)", () => {
    // Both conventions pinned: microscopy quotes νₑ, and it must agree with the
    // datasheet's own νₑ = 42.8 — not be confused with νd.
    expect(abbeNumber(IMMERSION_OIL)).toBeCloseTo(42.9, 0);
    expect(abbeNumberE(IMMERSION_OIL)).toBeCloseTo(42.8, 0);
  });

  it("coverslip D263: nd ≈ 1.5233, Vd ≈ 54.52 (SCHOTT Zemax catalog)", () => {
    // Against the coefficient source itself — the Sellmeier reproduces the
    // catalog's own nd/Vd tightly.
    expect(indexD(D263)).toBeCloseTo(1.5233, 4);
    expect(abbeNumber(D263)).toBeCloseTo(54.52, 1);
  });

  it("coverslip D263: nₑ ≈ 1.5255±0.0015, νₑ ≈ 55 (D263 product datasheet, ISO 8255-1)", () => {
    // A SECOND, independent external anchor: the D 263® M cover-glass product
    // datasheet publishes nₑ = 1.5255 ± 0.0015 and νₑ ≈ 55 (guide value) — the
    // No. 1.5 coverslip an objective's correction is computed for. The Sellmeier
    // reproduces the headline nₑ inside the datasheet's own ±0.0015 tolerance,
    // and its νₑ (≈ 54.3) lands just under the rounded guide 55. The rung has
    // teeth: a wrong coefficient moves nₑ out of tolerance, and νₑ out of ±1.
    expect(indexE(D263)).toBeCloseTo(1.5255, 3); // ±0.0005 ⊂ datasheet ±0.0015
    expect(Math.abs(abbeNumberE(D263) - 55)).toBeLessThan(1);
    // Negative control: the coverslip is NOT the immersion oil — the small
    // oil→glass index step is real and is what the branch's chromatism rides on.
    expect(indexE(D263)).toBeGreaterThan(indexE(IMMERSION_OIL));
  });
});
