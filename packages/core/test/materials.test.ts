import { describe, it, expect } from "vitest";
import { indexD, abbeNumber } from "../src/materials/dispersion";
import { N_BK7, F2, CAF2, FUSED_SILICA, getMedium } from "../src/materials/catalog";

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

  it("normal dispersion: n(F) > n(d) > n(C) for all glasses", () => {
    for (const g of [N_BK7, F2, CAF2, FUSED_SILICA]) {
      expect(g.n(486.1327)).toBeGreaterThan(g.n(587.5618));
      expect(g.n(587.5618)).toBeGreaterThan(g.n(656.2725));
    }
  });

  it("registry lookup works and rejects unknowns", () => {
    expect(getMedium("N-BK7")).toBe(N_BK7);
    expect(() => getMedium("UNOBTAINIUM")).toThrow();
  });
});
