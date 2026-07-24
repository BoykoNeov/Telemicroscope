import { describe, it, expect } from "vitest";
import { indexD, indexE, abbeNumber, abbeNumberE } from "../src/materials/dispersion";
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
  it("water (Daimon & Masumura 2007, 20 °C): nd ≈ 1.3334, Vd ≈ 55.7", () => {
    expect(indexD(WATER)).toBeCloseTo(1.3334, 3);
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

  it("coverslip D263 T eco (Schott, ISO 8255-1): nd ≈ 1.5233, Vd ≈ 54.52", () => {
    expect(indexD(D263)).toBeCloseTo(1.5233, 4);
    expect(abbeNumber(D263)).toBeCloseTo(54.52, 1);
  });

  it("coverslip D263: nₑ ≈ 1.5255 meets the objective's design coverslip", () => {
    // The value an objective's spherical-aberration correction assumes for a
    // No. 1.5 coverslip (ISO 8255). D263's nₑ lands on it; its νₑ (≈ 54.3) sits
    // BELOW the nominal 56 — the residual is exactly the "coverslip mismatch"
    // the branch will later show, carried as real data rather than forced to
    // agree. (Negative control: it must NOT equal the immersion oil's index.)
    expect(indexE(D263)).toBeCloseTo(1.5255, 3);
    expect(indexE(D263)).toBeGreaterThan(indexE(IMMERSION_OIL));
  });
});
