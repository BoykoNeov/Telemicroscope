import { Medium, sellmeier, cauchy, constantIndex } from "./dispersion";

/**
 * Starter catalog. Sellmeier coefficients from the Schott datasheets /
 * Malitson 1965 (fused silica), as published on refractiveindex.info.
 * Validation: test/materials.test.ts pins nd and Vd to datasheet values.
 *
 * AIR is exactly 1.0 for now — all designs are "in air" relative; switch to
 * the Ciddor/Edlén model when photometry or high-precision work needs it.
 *
 * NOTE on the immersion media below: each carries its source's own reference
 * temperature (water 20 °C, oil 23 °C). They physically coexist at one bench
 * temperature; the resulting index mismatch is ~1e-3 (below every rung's
 * tolerance) and is unavoidable from the published data — do NOT treat the three
 * as co-referenced to a single temperature.
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

/**
 * Distilled water, dispersive — the medium of a water-immersion objective.
 * Daimon & Masumura, "Measurement of the refractive index of distilled water
 * from the near-infrared region to the ultraviolet region," Appl. Opt. 46,
 * 3811–3820 (2007), 20 °C branch, as published on refractiveindex.info. A 4-term
 * Sellmeier valid 0.18–1.13 µm, so the whole visible band. It REPLACES the old
 * constantIndex 1.333 stand-in: at NA ≳ 1 the microscope branch's chromatic
 * behaviour is set by the immersion medium's own dispersion, so a flat index
 * there is dishonest (ROADMAP step 6 prerequisite). Pinned in
 * test/materials.test.ts against nd and the water Abbe number.
 */
export const WATER: Medium = sellmeier(
  "WATER",
  [0.5684027565, 0.1726177391, 0.02086189578, 0.1130748688],
  [0.005101829712, 0.01821153936, 0.02620722293, 10.69792721],
);

/**
 * Microscope immersion oil, dispersive — Cargille Immersion Oil Type B, the ISO
 * 8036 / "n = 1.515" standard fluid for oil-immersion light microscopy. Its own
 * datasheet Cauchy equation at 23 °C (λ in nm), transcribed verbatim:
 *   n(λ) = 1.498304 + 5.456721e3/λ² + 1.203987e8/λ⁴.
 * nd = 1.5150, nₑ = 1.5180, νd = 42.9, νₑ = 42.8. It REPLACES the old
 * constantIndex 1.515 stand-in — the oil is designed to index-match the front
 * element and the coverslip, and its dispersion is what makes an achromatic
 * high-NA objective's residual colour honest. Pinned in test/materials.test.ts
 * against the datasheet's nd/nₑ and both Abbe numbers.
 */
export const IMMERSION_OIL: Medium = cauchy(
  "IMMERSION-OIL",
  [1.498304, 5.456721e3, 1.203987e8],
);

/**
 * Microscope coverslip glass — Schott D 263® T eco, the borosilicate that meets
 * ISO 8255-1 for cover glass (the No. 1.5 / 0.17 mm coverslip an objective's
 * correction assumes). Sellmeier from the SCHOTT Zemax catalog (2017-01-20b) via
 * refractiveindex.info, valid 0.334–2.325 µm. nd = 1.523303, Vd = 54.52; the
 * D 263® M product datasheet separately publishes nₑ = 1.5255 ± 0.0015, νₑ ≈ 55
 * — the No. 1.5 coverslip an objective's spherical-aberration correction is
 * computed for, which this Sellmeier reproduces inside that tolerance. A mismatch
 * between a real slip (thickness/index) and this nominal is exactly the "coverslip
 * mismatch" the microscope branch will later show, so it is carried as real data,
 * not folded into the oil. Pinned in test/materials.test.ts against both the
 * Zemax catalog nd/Vd and the datasheet nₑ/νₑ.
 */
export const D263: Medium = sellmeier(
  "D263",
  [1.23795755, 0.0466468888, 2.46700556],
  [0.00863080926, 0.0469074501, 264.146296],
);

/**
 * Vitreous humour of the reduced eye (designs/eye.ts) — kept as a NON-dispersive
 * idealization, n = 1.333, so the schematic eye stays diffraction-limited by
 * construction and a (telescope + eye) rung measures the telescope, not the eye's
 * chromatism. Split out of the old `WATER` constant, which now carries real
 * dispersion; this preserves the eye's exact prior value byte-for-byte. (That the
 * value is 1.333 rather than the schematic's stated 4/3 is a pre-existing choice,
 * left untouched here; correcting it is a separate change.)
 */
export const VITREOUS: Medium = constantIndex("VITREOUS", 1.333);

const REGISTRY = new Map<string, Medium>(
  [AIR, N_BK7, F2, CAF2, FUSED_SILICA, WATER, IMMERSION_OIL, D263, VITREOUS].map((m) => [
    m.name,
    m,
  ]),
);

export function getMedium(name: string): Medium {
  const m = REGISTRY.get(name);
  if (!m) throw new Error(`unknown medium: ${name}`);
  return m;
}

export function registerMedium(m: Medium): void {
  REGISTRY.set(m.name, m);
}
