import { Prescription, SurfaceSpec } from "../trace/prescription";
import { systemProperties } from "../trace/paraxial";
import { getMedium } from "../materials/catalog";
import { achromaticObjective, AchromaticObjective } from "./achromat";

/**
 * The Plössl eyepiece — the COMPUTED lead of the eyepiece library, and the first
 * design that *composes* two prior units rather than adding physics: it is two of
 * § 5j's achromatic doublets arranged symmetrically, flint-to-flint, crowns out.
 *
 * Why computed, when a real Plössl is a patent table (the library's later,
 * transcribed members)? Because a symmetric pair of doublets is a design whose
 * *behaviour is a theorem*, not a fit. Each half is the achromat § 5j already
 * solves from the glass catalog and third-order theory; stacking two mirror
 * images gives a construction that is achromatic by inheritance and, by the
 * principle of symmetry, cancels the odd aberrations (coma, distortion, lateral
 * colour) between its halves. So the eyepiece can be pinned to what symmetry and
 * the doublet solve *predict*, exactly as every other preset here is pinned to a
 * closed form the trace can refuse — rather than to a commercial part's numbers,
 * which this is deliberately NOT: bent for the eyepiece role its residuals will
 * not clone any catalogued Plössl, and it does not pretend to (VALIDATION § 5m).
 *
 * ## Construction
 *
 * One achromatic doublet, curvatures [c₁, c₂, c₃] (crown, cemented joint, rear),
 * is the building block. The eyepiece is that doublet and its mirror image across
 * the central air gap:
 *
 *     crown  joint  rear  |gap|  rear'  joint'  crown'
 *      c₁     c₂    c₃            −c₃    −c₂     −c₁
 *
 * so surface i's curvature is exactly −(surface 5−i)'s, the glasses mirror, and
 * the two crowns face outward — toward the field stop and toward the eye. The
 * pair's power is the Gullstrand combination of the two doublet powers; the
 * doublet focal length is *solved* so the composed eyepiece hits the requested
 * focal length.
 *
 * ## What is pinned, and what waits
 *
 * Pinned now (VALIDATION § 5m): the EFL against the Gullstrand two-lens
 * combination; the symmetric construction invariant; the inherited achromatism
 * (F–C focal spread orders below an equal-power singlet's); and that it composes
 * into a telescope with the § 5l magnification, exit pupil and eye relief. The
 * symmetry *dividend* — that coma, distortion and lateral colour are suppressed
 * relative to a singlet eyepiece — needs the real-ray afocal trace (apparent
 * field of view / distortion) and is pinned there.
 *
 * SCOPE. The eyepiece has no internal stop: in a telescope the stop is the
 * objective, and the eyepiece works the beam the objective hands it. The doublet
 * elements are spherical (they come from § 5j, which is spherical), so this is a
 * classical Plössl, not one of the aspherized modern wide-fields — those are the
 * transcribed library. Eye relief here is the trailing thickness only; the
 * observer-side exit-pupil match is the eye model, deferred.
 */
export interface PlosslEyepieceSpec {
  /** Target eyepiece focal length (mm) — what sets the telescope's magnification. */
  readonly focalLengthMm: number;
  /** Each doublet's clear aperture (mm). Sets the doublet's focal ratio, hence how
   *  fast (and how buildable) its elements are. Default 0.6·focalLengthMm. */
  readonly clearApertureMm?: number;
  /** Air gap between the two doublets (mm). Default 0.02·focalLengthMm, floored at 0.3. */
  readonly airGapMm?: number;
  /** Crown glass of each doublet. Default N-BK7. */
  readonly crownMedium?: string;
  /** Flint glass of each doublet. Default F2. */
  readonly flintMedium?: string;
  /** Wavelength (nm) the powers are computed at. Default the d line. */
  readonly designWavelengthNm?: number;
  /** Trailing distance from the eye lens to the eye (mm). Cosmetic; default 0. */
  readonly eyeReliefMm?: number;
}

export interface PlosslEyepiece {
  /** The flat 6-surface symmetric prescription. */
  readonly prescription: Prescription;
  /** Traced paraxial EFL of the eyepiece (mm) — matches the requested focal length. */
  readonly focalLengthMm: number;
  /** The (identical) doublet each half is built from. */
  readonly doublet: AchromaticObjective;
  /** Each doublet's paraxial EFL (mm). */
  readonly doubletFocalLengthMm: number;
  /** The central air gap between the doublets (mm). */
  readonly airGapMm: number;
  /** The six surface curvatures (1/mm), field-stop side first. Anti-symmetric. */
  readonly curvatures: readonly number[];
  readonly designWavelengthNm: number;
}

/** Assemble the symmetric 6-surface chain from one doublet's geometry. */
function assemble(
  doublet: AchromaticObjective,
  gapMm: number,
  clearRadiusMm: number,
  lastThicknessMm: number,
): Prescription {
  const [c1, c2, c3] = doublet.curvatures;
  const tc = doublet.crownThicknessMm;
  const tf = doublet.flintThicknessMm;
  const crown = doublet.crownMedium;
  const flint = doublet.flintMedium;
  const r = clearRadiusMm;
  const surfaces: SurfaceSpec[] = [
    { kind: "refract", curvature: c1, semiAperture: r, thickness: tc, medium: crown },
    { kind: "refract", curvature: c2, semiAperture: r, thickness: tf, medium: flint },
    { kind: "refract", curvature: c3, semiAperture: r, thickness: gapMm, medium: "AIR" },
    { kind: "refract", curvature: -c3, semiAperture: r, thickness: tf, medium: flint },
    { kind: "refract", curvature: -c2, semiAperture: r, thickness: tc, medium: crown },
    { kind: "refract", curvature: -c1, semiAperture: r, thickness: lastThicknessMm, medium: "AIR" },
  ];
  return { surfaces };
}

export function plosslEyepiece(spec: PlosslEyepieceSpec): PlosslEyepiece {
  const fe = spec.focalLengthMm;
  if (!(fe > 0)) throw new Error("plosslEyepiece: focal length must be positive");
  const D = spec.clearApertureMm ?? 0.6 * fe;
  const gapMm = spec.airGapMm ?? Math.max(0.3, 0.02 * fe);
  const designWavelengthNm = spec.designWavelengthNm ?? 587.5618;
  const crownMedium = spec.crownMedium ?? "N-BK7";
  const flintMedium = spec.flintMedium ?? "F2";
  const lastThicknessMm = spec.eyeReliefMm ?? 0;

  const r = (D / 2) * 1.02;

  // Build the eyepiece for a given doublet focal length and report its traced EFL.
  const buildFor = (fd: number): { eyepiece: Prescription; doublet: AchromaticObjective } => {
    const doublet = achromaticObjective({
      apertureMm: D,
      focalRatio: fd / D,
      crownMedium,
      flintMedium,
      designWavelengthNm,
    });
    return { eyepiece: assemble(doublet, gapMm, r, lastThicknessMm), doublet };
  };
  const eflFor = (fd: number): number =>
    systemProperties(buildFor(fd).eyepiece, designWavelengthNm).efl;

  // Two thin identical lenses give f_e ≈ f_d/2, so 2·f_e is the seed. Secant on
  // the doublet focal length until the composed eyepiece EFL matches the target.
  let a = 2 * fe;
  let b = 2.1 * fe;
  let fa = eflFor(a) - fe;
  let fb = eflFor(b) - fe;
  let fd = b;
  for (let k = 0; k < 60; k++) {
    if (!(Math.abs(fb - fa) > 0)) break;
    fd = b - fb * ((b - a) / (fb - fa));
    if (!(fd > 0)) throw new Error("plosslEyepiece: focal-length solve diverged");
    const fv = eflFor(fd) - fe;
    a = b;
    fa = fb;
    b = fd;
    fb = fv;
    if (Math.abs(fv) < fe * 1e-12) break;
  }

  const { eyepiece, doublet } = buildFor(fd);
  const focalLengthMm = systemProperties(eyepiece, designWavelengthNm).efl;
  return {
    prescription: eyepiece,
    focalLengthMm,
    doublet,
    doubletFocalLengthMm: doublet.paraxialFocalLengthMm,
    airGapMm: gapMm,
    curvatures: eyepiece.surfaces.map((s) => s.curvature),
    designWavelengthNm,
  };
}

/**
 * The Huygens eyepiece — the library's second COMPUTED member, and a different
 * theorem from the Plössl. It is two plano-convex singlets of the SAME glass
 * (no flint anywhere), and its achromatism comes not from a cemented doublet but
 * from their SPACING:
 *
 *     d = (f₁ + f₂)/2
 *
 * At that separation two thin lenses of one glass have an achromatic combined
 * power — dΦ/dλ = 0. The derivation is a page of thin-lens algebra: with
 * Φ = φ₁ + φ₂ − d·φ₁φ₂ and each dφᵢ/dλ ∝ φᵢ/V (one glass, one V), dΦ/dλ ∝
 * φ₁ + φ₂ − 2d·φ₁φ₂, which vanishes exactly at d = (f₁+f₂)/2. So the eyepiece is
 * achromatic by a spacing condition, and the condition is a *zero crossing*: too
 * close under-corrects lateral colour, too far over-corrects, and only at
 * (f₁+f₂)/2 does the F and C focal length agree. That falsifiable sign change is
 * the pin the Plössl's construction cannot offer (VALIDATION § 5o).
 *
 * The combined focal length at that spacing is f_e = 2f₁f₂/(f₁+f₂). Scaling f₁
 * and f₂ together scales d and f_e by the same factor and leaves d = (f₁+f₂)/2
 * intact — the achromatism is scale-invariant — so the design solves one overall
 * scale to hit the requested focal length without touching the theorem.
 *
 * SCOPE. The classic Huygens is a modest eyepiece: the field stop sits BETWEEN
 * the lenses (so a reticle there is not in sharp focus), eye relief is short, and
 * only lateral colour is corrected — spherical aberration and the field
 * curvature are not, and it shows a narrower usable field than the Plössl. What
 * is pinned is the one thing it does by theorem: same-glass separation
 * achromatism.
 */
export interface HuygensEyepieceSpec {
  /** Target eyepiece focal length (mm). */
  readonly focalLengthMm: number;
  /** Field-lens : eye-lens focal-length ratio f₁/f₂. Default 3 (a classic Huygens). */
  readonly fieldEyeRatio?: number;
  /** The single glass both lenses are made of. Default N-BK7. */
  readonly glass?: string;
  /** Each lens's centre thickness (mm). Default 0.03·focalLengthMm, floored at 0.5. */
  readonly lensThicknessMm?: number;
  /** Clear aperture of the lenses (mm). Default 0.8·focalLengthMm. */
  readonly clearApertureMm?: number;
  /** Trailing distance from the eye lens to the eye (mm). Cosmetic; default 0. */
  readonly eyeReliefMm?: number;
  /** Wavelength (nm) the powers are computed at. Default the d line. */
  readonly designWavelengthNm?: number;
}

export interface HuygensEyepiece {
  /** The flat 4-surface prescription: field lens, gap, eye lens. */
  readonly prescription: Prescription;
  /** Traced paraxial EFL (mm) — matches the requested focal length. */
  readonly focalLengthMm: number;
  /** Field-lens focal length f₁ (mm). */
  readonly fieldLensFocalMm: number;
  /** Eye-lens focal length f₂ (mm). */
  readonly eyeLensFocalMm: number;
  /** The achromatizing separation d = (f₁+f₂)/2 (mm). */
  readonly separationMm: number;
  readonly glass: string;
  readonly designWavelengthNm: number;
}

export function huygensEyepiece(spec: HuygensEyepieceSpec): HuygensEyepiece {
  const fe = spec.focalLengthMm;
  if (!(fe > 0)) throw new Error("huygensEyepiece: focal length must be positive");
  const r = spec.fieldEyeRatio ?? 3;
  if (!(r > 0)) throw new Error("huygensEyepiece: field:eye focal ratio must be positive");
  const glass = spec.glass ?? "N-BK7";
  const designWavelengthNm = spec.designWavelengthNm ?? 587.5618;
  const t = spec.lensThicknessMm ?? Math.max(0.5, 0.03 * fe);
  const D = spec.clearApertureMm ?? 0.8 * fe;
  const eyeReliefMm = spec.eyeReliefMm ?? 0;
  const clearR = (D / 2) * 1.02;
  const n = getMedium(glass).n(designWavelengthNm);
  if (!(n > 1)) throw new Error("huygensEyepiece: glass must have index > 1");

  // Thin-lens seed for the two focal lengths at the target f_e (scale solved below).
  const f1Seed = (fe * (r + 1)) / 2; // field lens
  const f2Seed = (fe * (r + 1)) / (2 * r); // eye lens

  // One plano-convex singlet of focal length f, convex surface toward the object.
  const planoConvex = (f: number, lastThickness: number): SurfaceSpec[] => [
    { kind: "refract", curvature: 1 / ((n - 1) * f), semiAperture: clearR, thickness: t, medium: glass },
    { kind: "refract", curvature: 0, semiAperture: clearR, thickness: lastThickness, medium: "AIR" },
  ];

  // Build at an overall scale s: f₁ = s·f1Seed, f₂ = s·f2Seed, d = (f₁+f₂)/2 — so
  // the achromatism condition is preserved for every s.
  const build = (s: number): Prescription => {
    const f1 = s * f1Seed;
    const f2 = s * f2Seed;
    const d = (f1 + f2) / 2;
    return { surfaces: [...planoConvex(f1, d), ...planoConvex(f2, eyeReliefMm)] };
  };
  const eflFor = (s: number): number => systemProperties(build(s), designWavelengthNm).efl;

  // Secant on the scale until the composed EFL matches the target.
  let a = 0.95;
  let b = 1.05;
  let fa = eflFor(a) - fe;
  let fb = eflFor(b) - fe;
  let s = b;
  for (let k = 0; k < 60; k++) {
    if (!(Math.abs(fb - fa) > 0)) break;
    s = b - fb * ((b - a) / (fb - fa));
    if (!(s > 0)) throw new Error("huygensEyepiece: focal-length solve diverged");
    const fv = eflFor(s) - fe;
    a = b;
    fa = fb;
    b = s;
    fb = fv;
    if (Math.abs(fv) < fe * 1e-12) break;
  }

  const f1 = s * f1Seed;
  const f2 = s * f2Seed;
  const prescription = build(s);
  return {
    prescription,
    focalLengthMm: systemProperties(prescription, designWavelengthNm).efl,
    fieldLensFocalMm: f1,
    eyeLensFocalMm: f2,
    separationMm: (f1 + f2) / 2,
    glass,
    designWavelengthNm,
  };
}
