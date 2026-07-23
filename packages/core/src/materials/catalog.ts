import { Medium, sellmeier, constantIndex } from "./dispersion";

/**
 * Starter catalog. Sellmeier coefficients from the Schott datasheets /
 * Malitson 1965 (fused silica), as published on refractiveindex.info.
 * Validation: test/materials.test.ts pins nd and Vd to datasheet values.
 *
 * AIR is exactly 1.0 for now — all designs are "in air" relative; switch to
 * the Ciddor/Edlén model when photometry or high-precision work needs it.
 */

export const AIR: Medium = constantIndex("AIR", 1.0);

export const N_BK7: Medium = sellmeier(
  "N-BK7",
  [1.03961212, 0.231792344, 1.01046945],
  [0.00600069867, 0.0200179144, 103.560653],
);

export const F2: Medium = sellmeier(
  "F2",
  [1.34533359, 0.209073176, 0.937357162],
  [0.00997743871, 0.0470450767, 111.886764],
);

/**
 * Calcium fluoride — "fluorite", the ED material premium apochromatic refractors
 * are built around. Malitson 1963, as published on refractiveindex.info (valid
 * 0.23–9.7 µm, so the whole visible band and then some).
 *
 * It is in the catalog for one property no ordinary glass has: its relative
 * partial dispersion is ANOMALOUSLY LOW for its Abbe number — it sits well off the
 * line the normal glasses fall on. Secondary spectrum is (P₁−P₂)/(V₁−V₂), so that
 * deviation is exactly what an achromat's residual colour is bought down with; the
 * huge Vd = 95 is the smaller part of the story. Pinned in test/materials.test.ts
 * against the datasheet nd/Vd, and used in test/ed-refractor.test.ts.
 */
export const CAF2: Medium = sellmeier(
  "CAF2",
  [0.5675888, 0.4710914, 3.8484723],
  [0.050263605 ** 2, 0.1003909 ** 2, 34.64904 ** 2],
);

export const FUSED_SILICA: Medium = sellmeier(
  "FUSED-SILICA",
  [0.6961663, 0.4079426, 0.8974794],
  [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2],
);

/** Simple constant-index stand-ins until dispersive models are needed. */
export const WATER: Medium = constantIndex("WATER", 1.333);
export const IMMERSION_OIL: Medium = constantIndex("IMMERSION-OIL", 1.515);

const REGISTRY = new Map<string, Medium>(
  [AIR, N_BK7, F2, CAF2, FUSED_SILICA, WATER, IMMERSION_OIL].map((m) => [m.name, m]),
);

export function getMedium(name: string): Medium {
  const m = REGISTRY.get(name);
  if (!m) throw new Error(`unknown medium: ${name}`);
  return m;
}

export function registerMedium(m: Medium): void {
  REGISTRY.set(m.name, m);
}
