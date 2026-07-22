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

export function constantIndex(name: string, n: number): Medium {
  return { name, n: () => n };
}

/** nd — index at the helium d line. */
export const indexD = (m: Medium): number => m.n(LINE_D);

/** Abbe number Vd = (nd − 1)/(nF − nC). */
export function abbeNumber(m: Medium): number {
  return (m.n(LINE_D) - 1) / (m.n(LINE_F) - m.n(LINE_C));
}
