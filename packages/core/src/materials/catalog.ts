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

export const FUSED_SILICA: Medium = sellmeier(
  "FUSED-SILICA",
  [0.6961663, 0.4079426, 0.8974794],
  [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2],
);

/** Simple constant-index stand-ins until dispersive models are needed. */
export const WATER: Medium = constantIndex("WATER", 1.333);
export const IMMERSION_OIL: Medium = constantIndex("IMMERSION-OIL", 1.515);

const REGISTRY = new Map<string, Medium>(
  [AIR, N_BK7, F2, FUSED_SILICA, WATER, IMMERSION_OIL].map((m) => [m.name, m]),
);

export function getMedium(name: string): Medium {
  const m = REGISTRY.get(name);
  if (!m) throw new Error(`unknown medium: ${name}`);
  return m;
}

export function registerMedium(m: Medium): void {
  REGISTRY.set(m.name, m);
}
