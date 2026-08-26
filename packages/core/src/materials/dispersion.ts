/**
 * Optical media and dispersion. Wavelengths are nanometers at the API
 * boundary; Sellmeier works in micrometers internally, per convention.
 */
export interface Medium {
  readonly name: string;
  /** Refractive index at the given vacuum wavelength (nm). */
  n(wavelengthNm: number): number;
}

/** Fraunhofer lines used for nd/Abbe computations (nm). */
export const LINE_D = 587.5618; // He d
export const LINE_F = 486.1327; // H F
export const LINE_C = 656.2725; // H C

/**
 * The e-line triad. Microscopy immersion media and coverslip glass are specified
 * on the mercury e-line with the cadmium F′/C′ lines (νₑ), NOT the d/F/C triad
 * above — so an oil quoted at νₑ ≈ 43 pinned against `abbeNumber` (νd) would show
 * a spurious few-percent gap that is pure line convention, not error.
 */
export const LINE_E = 546.074; // Hg e
export const LINE_F_PRIME = 479.9914; // Cd F′
export const LINE_C_PRIME = 643.8469; // Cd C′

/**
 * The mercury g line — the FOURTH line, and the one a glass catalogue's second
 * relative partial dispersion P_g,F = (n_g − n_F)/(n_F − n_C) is quoted on.
 *
 * Two lines make an achromat and three an apochromat, so a fourth colour needs a
 * fourth line and a fourth condition; g is the one the SCHOTT datasheets publish
 * a P for, which is what lets § 6at pin this engine's partial dispersions to a
 * printed number rather than to its own fitted line. It sits inside every
 * medium in `materials/catalog`: the binding validity ranges are CaF₂'s
 * 0.23–9.7 µm and D 263's 0.334–2.325 µm, and 435.83 nm clears both.
 *
 * Which fourth line is best is a measured choice, not an obvious one — § 6at.5
 * ran g, h, e, r and s, and g wins over the band the four united lines span
 * while h wins over the wider 380–800.
 */
export const LINE_G = 435.8343; // Hg g

/**
 * Sellmeier form: n²(λ) − 1 = Σ Bᵢ·λ² / (λ² − Cᵢ), λ in µm, Cᵢ in µm².
 */
export function sellmeier(name: string, B: readonly number[], C: readonly number[]): Medium {
  if (B.length !== C.length) throw new Error(`${name}: B/C length mismatch`);
  return {
    name,
    n(wavelengthNm: number): number {
      const um2 = (wavelengthNm / 1000) ** 2;
      let n2m1 = 0;
      for (let i = 0; i < B.length; i++) n2m1 += (B[i]! * um2) / (um2 - C[i]!);
      return Math.sqrt(1 + n2m1);
    },
  };
}

/**
 * Cauchy form as an even-power series in 1/λ: n(λ) = c₀ + c₁/λ² + c₂/λ⁴ + …,
 * with **λ in nanometers** — deliberately the source's own units, so the
 * coefficients are transcribed verbatim from the datasheet rather than refitted
 * or rescaled (a rescale is arithmetic-exact but no longer checkable against the
 * printed equation). Immersion oils are published this way; the fluids' molecular
 * dispersion has no absorption pole in the visible, so the two-term Cauchy the
 * Sellmeier's near-UV pole reduces to is the honest form for them.
 */
export function cauchy(name: string, coeffs: readonly number[]): Medium {
  if (coeffs.length === 0) throw new Error(`${name}: cauchy needs at least one coefficient`);
  return {
    name,
    n(wavelengthNm: number): number {
      const inv2 = 1 / (wavelengthNm * wavelengthNm);
      let n = 0;
      let p = 1;
      for (let i = 0; i < coeffs.length; i++) {
        n += coeffs[i]! * p;
        p *= inv2;
      }
      return n;
    },
  };
}

export function constantIndex(name: string, n: number): Medium {
  return { name, n: () => n };
}

/** nd — index at the helium d line. */
export const indexD = (m: Medium): number => m.n(LINE_D);

/** nₑ — index at the mercury e line (the microscopy reference). */
export const indexE = (m: Medium): number => m.n(LINE_E);

/** Abbe number Vd = (nd − 1)/(nF − nC). */
export function abbeNumber(m: Medium): number {
  return (m.n(LINE_D) - 1) / (m.n(LINE_F) - m.n(LINE_C));
}

/** Abbe number Vₑ = (nₑ − 1)/(nF′ − nC′) — the microscopy convention. */
export function abbeNumberE(m: Medium): number {
  return (m.n(LINE_E) - 1) / (m.n(LINE_F_PRIME) - m.n(LINE_C_PRIME));
}
