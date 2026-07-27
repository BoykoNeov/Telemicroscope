import { jinc } from "../math/bessel";
import type { CondenserSource } from "./source";

/**
 * How far across the specimen the illumination stays coherent — and what a
 * field decomposition is allowed to do about it.
 *
 * `abbe.ts` forms the image of ONE isoplanatic patch: one pupil, one grid, the
 * whole object seen through it. A real frame is not isoplanatic — the pupil's
 * aberration grows with field angle — and `imaging/render` already solved that
 * for self-luminous scenes by cutting the field into patches and blending with a
 * partition of unity. This file is what has to be settled before that machinery
 * can be pointed at a brightfield image, because the two do not compose the way
 * they look like they do.
 *
 * ## Two object points interfere, and the strength of it is μ
 *
 * Under one illumination direction s the object picks up exp(2πi·s·x), so the
 * cross term between object points x₁ and x₂ arrives with a phase 2π·s·Δ,
 * Δ = x₁ − x₂. Summing over the condenser's directions with their weights:
 *
 *     I = |a₁h₁|² + |a₂h₂|² + 2·Re( a₁a₂* h₁h₂* · μ(Δ) ),
 *     μ(Δ) = Σ_s w_s · exp(2πi·s·Δ)
 *
 * μ is the **complex degree of coherence**, and that sum is the van
 * Cittert–Zernike theorem in the only form this engine needs it: the coherence
 * between two object points is the Fourier transform of the source's intensity
 * distribution. For the uniform disc `diskSource` builds it is a jinc, and its
 * first zero is the classical coherence width
 *
 *     Δ_coh = 0.61·λ / NA_condenser
 *
 * — the same 0.61 as Rayleigh's criterion, and not a coincidence: both are the
 * first zero of the transform of a filled circle. Beyond Δ_coh the specimen's
 * points no longer interfere at first order, and brightfield is locally
 * incoherent.
 *
 * ## Coordinates: the phase per grid cell
 *
 * `abbe.ts` puts frequency bin ix at normalized pupil coordinate
 * u = 2(ix − n/2)/pupilSamples, so a pupil shift of s is a spectrum shift of
 * s·pupilSamples/2 bins, and the DFT shift theorem turns that into an object
 * phase ramp of exp(iπ·s·pupilSamples·x/n) with x in grid cells. That factor —
 * `phasePerCell` below — is the whole coordinate story, and it is the reason μ
 * needs the grid it will be used on rather than only the source.
 *
 * ## The finding: a partition of unity may window the OUTPUT, never the input
 *
 * `imaging/render` windows the *scene* and not the output, with a specific
 * argument for it: windowing the input splits the light, so every photon meets
 * the kernel nearest where it came from. That argument is airtight for
 * incoherent imaging and **fails here**, because Abbe imaging is not linear in
 * the object's intensity.
 *
 * Split an object amplitude between patches — necessarily as √w_p, since the
 * intensities are what must partition — image each patch separately, and add the
 * intensities. The self terms come back whole (Σ_p w_p ≡ 1). The cross term does
 * not: it comes back multiplied by
 *
 *     C = Σ_p √( w_p(x₁) · w_p(x₂) )   ≤ 1
 *
 * by Cauchy–Schwarz, with equality **only** where the two points sit in the same
 * mixture of patches. Where a seam separates them — one point wholly in patch 1,
 * the other wholly in patch 2 — C = 0 and the interference is not attenuated but
 * *deleted*. Expanding about equal mixtures, 1 − C = δ²·(1/α + 1/(1−α))/8 for a
 * window difference δ: second order in the difference, but with the blow-up at
 * the window edges, which is exactly where a decomposition puts its seams.
 *
 * So the error of an input-side partition of unity factorizes, one geometric
 * term and one physical one:
 *
 *     error = (1 − C) · |cross term|,     cross term ∝ μ(Δ)
 *
 * C is S-independent; the S-dependence is entirely in μ. That is why the scheme
 * looks harmless in the incoherent limit — μ collapses inside a cell and there
 * is no cross term left to damage — and why it is worst exactly where
 * brightfield is interesting.
 *
 * ## Energy is not a witness here
 *
 * At the object the input-side split is exact by construction: Σ_p ∫w_p|t|² =
 * ∫|t|², so the conservation check this engine habitually reaches for first
 * passes for the scheme that deletes the interference. In the image the two
 * schemes do differ — but by exactly (1 − C) times the cross-term energy, which
 * is the same quantity again, not a second handle on it. Open the condenser and
 * that deficit collapses with μ while the deletion is unchanged. So the
 * measurement has to be the cross term itself, or a contrast, and the rungs of
 * § 6g are written that way on purpose.
 */

/** The grid an image is formed on, as far as coherence is concerned. */
export interface CoherenceGrid {
  /** Frequency bins across the pupil diameter — `AbbeOptions.pupilSamples`. */
  readonly pupilSamples: number;
  /** Object/image grid size in cells — `ObjectField.size`. */
  readonly size: number;
}

/**
 * Phase in radians that a unit illumination shift imprints per object cell.
 *
 * π·pupilSamples/size — see the coordinates note above. Exposed because both
 * the discrete sum and the closed form need it and they must not derive it
 * twice.
 */
export function phasePerCell(grid: CoherenceGrid): number {
  requireGrid(grid);
  return (Math.PI * grid.pupilSamples) / grid.size;
}

export interface MutualCoherence {
  readonly re: number;
  readonly im: number;
  /** |μ| — the fringe visibility two equally bright points would show. */
  readonly modulus: number;
}

/**
 * μ(Δ) for the condenser as it is actually sampled.
 *
 * The sum, not the closed form: this is what the Abbe image really contains, so
 * it is what a cross term measured off `abbeImage` must equal exactly. The
 * closed form below is the external check on *both*, and the gap between them is
 * the source's own discretization — § 6f.2's convergence knob, seen from the
 * object side.
 *
 * A centro-symmetric source (every disc and annulus here) makes μ real; the
 * complex form is kept because a decentred or one-sided condenser does not, and
 * an oblique source's imaginary part is a real displacement of the fringes.
 */
export function mutualCoherence(
  source: CondenserSource,
  dxCells: number,
  dyCells: number,
  grid: CoherenceGrid,
): MutualCoherence {
  const k = phasePerCell(grid);
  let re = 0;
  let im = 0;
  for (const s of source.points) {
    const ang = k * (s.sx * dxCells + s.sy * dyCells);
    re += s.weight * Math.cos(ang);
    im += s.weight * Math.sin(ang);
  }
  return { re, im, modulus: Math.hypot(re, im) };
}

/**
 * μ(Δ) for a uniform circular condenser of radius S — the van Cittert–Zernike
 * closed form, 2J₁(v)/v.
 *
 * Real and positive at the origin, dropping through its first zero at
 * v = 3.8317 (j₁,₁) and oscillating with decaying amplitude after: past the
 * first zero the points are *anti*-correlated in sign, not merely uncorrelated,
 * which is a real effect and the reason `coherenceWidthCells` names the first
 * zero rather than a half-height.
 */
export function vanCittertZernikeDisk(
  coherenceParameter: number,
  dxCells: number,
  dyCells: number,
  grid: CoherenceGrid,
): number {
  if (!(coherenceParameter >= 0)) {
    throw new Error(`coherenceParameter must be >= 0, got ${coherenceParameter}`);
  }
  const v = phasePerCell(grid) * coherenceParameter * Math.hypot(dxCells, dyCells);
  return jinc(v);
}

/**
 * First zero of j₁ — the argument at which a filled circle's transform first
 * vanishes.
 *
 * Tabulated, and it is the *same* constant as Rayleigh's 0.61 (= j₁,₁/2π) and
 * the Airy first dark ring's 1.22 (= j₁,₁/π). Kept as the zero itself rather
 * than as either rounded ratio so nothing here is a second copy of a number the
 * engine already carries.
 */
export const BESSEL_J1_FIRST_ZERO = 3.8317059702075125;

/**
 * The coherence width in object-grid cells: the separation at which μ first
 * vanishes.
 *
 * Closed form, from the disc's transform. `S = 0` is perfectly coherent at every
 * separation and returns Infinity, which is the honest answer rather than an
 * error — the coherent limit is a limit the § 6f rungs live at.
 */
export function coherenceWidthCells(coherenceParameter: number, grid: CoherenceGrid): number {
  if (!(coherenceParameter >= 0)) {
    throw new Error(`coherenceParameter must be >= 0, got ${coherenceParameter}`);
  }
  if (coherenceParameter === 0) return Infinity;
  return BESSEL_J1_FIRST_ZERO / (phasePerCell(grid) * coherenceParameter);
}

/**
 * The coherence width in millimetres: 0.61·λ / NA_condenser.
 *
 * The textbook form, and the one a UI shows. It is stated in whichever space the
 * NA is given in — the sine condition makes the object-side and reduced
 * image-side statements the same statement, which is also why the coherence
 * parameter S needs no conversion between them (`source.ts`).
 */
export function coherenceWidthMm(naCondenser: number, wavelengthNm: number): number {
  if (!(naCondenser > 0)) throw new Error(`condenser NA must be > 0, got ${naCondenser}`);
  if (!(wavelengthNm > 0)) throw new Error(`wavelength must be > 0 nm, got ${wavelengthNm}`);
  return (BESSEL_J1_FIRST_ZERO * wavelengthNm * 1e-6) / (2 * Math.PI * naCondenser);
}

/**
 * C = Σ_p √(w_p(x₁)·w_p(x₂)) — what an input-side partition of unity does to
 * the interference between two object points.
 *
 * 1 exactly when the two points are split between patches in the same
 * proportions, 0 when a seam puts them in disjoint patches, and Cauchy–Schwarz
 * in between. Both weight lists must be partitions (Σ = 1), which is checked:
 * a caller who passes unnormalized weights would get a number below 1 that
 * looks like coherence loss and is arithmetic.
 *
 * This is a property of the *decomposition*, not of the light — it carries no
 * wavelength, no NA and no S — which is the point. The physical half of the
 * error is μ, and the two multiply.
 */
export function windowMixingFactor(
  weightsAtFirst: readonly number[],
  weightsAtSecond: readonly number[],
): number {
  if (weightsAtFirst.length !== weightsAtSecond.length) {
    throw new Error(
      `window weight lists must describe the same patches, got ` +
        `${weightsAtFirst.length} and ${weightsAtSecond.length}`,
    );
  }
  let sum = 0;
  let total1 = 0;
  let total2 = 0;
  for (let p = 0; p < weightsAtFirst.length; p++) {
    const w1 = weightsAtFirst[p]!;
    const w2 = weightsAtSecond[p]!;
    if (!(w1 >= 0) || !(w2 >= 0)) {
      throw new Error(`window weights must be non-negative, got ${w1} and ${w2} at patch ${p}`);
    }
    total1 += w1;
    total2 += w2;
    sum += Math.sqrt(w1 * w2);
  }
  if (Math.abs(total1 - 1) > 1e-9 || Math.abs(total2 - 1) > 1e-9) {
    throw new Error(
      `window weights must be a partition of unity at both points, got sums ` +
        `${total1} and ${total2}`,
    );
  }
  return sum;
}

function requireGrid(grid: CoherenceGrid): void {
  if (!(grid.pupilSamples > 0)) {
    throw new Error(`pupilSamples must be positive, got ${grid.pupilSamples}`);
  }
  if (!(grid.size > 0)) throw new Error(`grid size must be positive, got ${grid.size}`);
}
