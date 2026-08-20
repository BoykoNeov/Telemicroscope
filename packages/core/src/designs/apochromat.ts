import { Prescription, SurfaceSpec } from "../trace/prescription";
import { getMedium } from "../materials/catalog";
import { abbeNumber, LINE_D, LINE_F, LINE_C } from "../materials/dispersion";
import { paraxialTrace } from "../trace/paraxial";
import { seidelSums } from "../analysis/seidel";

/**
 * The cemented apochromatic triplet — three glasses, three united wavelengths,
 * and the next term in the series `designs/achromat` starts.
 *
 * Like every design in this folder it is *computed*, not transcribed. A doublet
 * consumes two degrees of freedom (total power, achromatism) and leaves the
 * bending free; a triplet consumes three (total power, achromatism, and the d
 * line joining F and C) and leaves the bending free in exactly the same way. The
 * shape of the solve is `designs/achromat`'s with one more glass in it, and the
 * two files are meant to be read side by side.
 *
 * ## What the design has to satisfy
 *
 * A cemented triplet has four curvatures c₁…c₄ (surfaces 2 and 3 are the two
 * cement joints) and three glasses. Three conditions, on the three element
 * powers, with Vᵢ the Abbe number and Pᵢ = (n_d−n_C)/(n_F−n_C) the relative
 * partial dispersion:
 *
 *     Σ φᵢ       = φ      the lens has the focal length asked for
 *     Σ φᵢ/Vᵢ    = 0      F and C are united — the ACHROMATIC condition
 *     Σ φᵢ·Pᵢ/Vᵢ = 0      and d joins them — the APOCHROMATIC one
 *
 * That is the classical three-glass split, and it is this design's **external
 * number**: two Abbe numbers and two partial dispersions per glass off the
 * catalogue, nothing traced. It is reported as `thinElementPowers`.
 *
 * ## …but the split is NOT what the lens is built to
 *
 * The split is a *thin*-lens statement, and taking it literally at real
 * thicknesses does not give a slightly-worse apochromat — it gives a lens that
 * is not apochromatic at all. An apochromat's entire residual is smaller than
 * the separation term Gullstrand's formula carries, so a triplet laid out at
 * 1.2 mm centre thickness from the thin split is *worse* than the doublet it is
 * meant to beat. § 6aq measured that: 1.5% off in the powers, 30× worse in the
 * colour.
 *
 * So the three trailing curvatures are solved by Newton's method on the **thick**
 * first order — f(d) = the target, f(F) = f(d), f(C) = f(d), all three read off
 * `paraxialTrace` — and the thin split is what the result is *measured against*
 * (`thinPowerGap`), not what it is. It is the closed form the design tends to as
 * the glass goes thin, and § 6ar.1 pins that limit by halving the thicknesses.
 *
 * This is `designs/achromat`'s § 6ap.1 relationship one rung further in. There
 * the thin split was good to 4.3% and the doublet built from it was still a
 * doublet; here the same 1.5% is fatal, because what it perturbs is the whole of
 * what the third glass bought.
 *
 * ## The bending is SOLVED from third-order theory, exactly as the doublet's is
 *
 * The three chromatic conditions fix the three curvature *differences*; c₁ — the
 * bending — slides all four together, changes no first-order and no chromatic
 * property, and is chosen by setting the third-order spherical aberration sum to
 * zero, S_I(c₁) = 0, by the published Seidel formulas (Welford ch. 8) on the REAL
 * thick prescription. `analysis/seidel` is pinned to the thin-lens closed form
 * and the spherical-mirror figure before this uses it (§ 5j), so the solve rests
 * on an external number rather than on the engine's own residual.
 *
 * S_I(c₁) has **two** roots here as it does for a doublet, and the same criterion
 * chooses: Σᵢ|S_I,ᵢ| over the individual surface contributions, smaller being the
 * root whose surfaces cancel less violently and which therefore carries less of
 * the fifth-and-higher order third-order theory does not model. For the
 * catalogue's one solvable-and-fast triple that picks the shallower root by a
 * factor of 4.3 (5.288e−3 against 2.298e−2), and it is genuinely the shallower
 * one — max|c|·(D/2) is 0.148 against 0.328 — so `branch: "shallow"` (default) /
 * `"steep"` keeps meaning the shape you can see.
 *
 * **One thing does NOT carry over from the doublet, and the difference is worth
 * stating rather than inheriting.** `designs/achromat` must filter its roots
 * through "is this a lens" before counting them, because past the aperture wall
 * S_I grows a third root that is five times hemispherical and is not a surface
 * (§ 6b.5.7). This solve has no such ghost: the root set is exactly two at scan
 * windows of ±2, ±3, ±5 and ±8 spans, and every root found is a lens. The filter
 * is applied anyway — it costs nothing and the refusal message needs the count —
 * but the header does not claim a phenomenon this design does not have.
 *
 * ## Which bending is built is not only an aberration decision
 *
 * Both roots null the same third order on the same glasses and unite the same
 * three colours. § 6aq.7 found they are still not interchangeable: the bending
 * moves where the front focal distance FFD(λ) turns, and on the second root both
 * turns leave the visible band. A stop placed at FFD(d) is then telecentric at
 * ONE wavelength where the first root gives THREE. Nothing in a robustness
 * criterion knows that — Σ|S_I,ᵢ| is about aberration and only aberration — so
 * the agreement between the two questions on this triple is a coincidence, and
 * `designs/telecentric` is where the consequence is read.
 *
 * ## The glass triple is the whole design, and its conditioning is REPORTED
 *
 * The 3×3 above is conditioned only by a glass whose partial dispersion is
 * anomalous for its Abbe number. In this catalogue the four ordinary glasses
 * (N-BK7, F2, fused silica, D263) lie on a **normal line** P = 0.2751 +
 * 5.139e−4·V to within ±4.4e−4 in P, and CaF₂ sits 1.93e−2 off it — 44× further
 * than the worst of them. Fluorite is not decoration; it is the only thing in
 * `materials/catalog` that makes the third row independent of the second.
 *
 * How far off collinear the triple is comes out as the **element powers**, which
 * is why they are reported rather than hidden: CaF₂ triples solve at |φᵢ|/φ ≈
 * 2.5, and every triple without it needs 50× to 518×. § 6aq called that "a
 * singular matrix" and **that is loose, which § 6ar.6 corrects**. The ordinary
 * triples are not singular. They solve, they unite F, d and C exactly, and at a
 * slow enough focal ratio they are real lenses — N-BK7/F2/fused silica builds at
 * f/200, F2/fused silica/D263 at f/1000. Conditioning is scale-free, so what it
 * really buys is two things:
 *
 *  - a **focal-ratio wall**, since the curvatures scale as D/f and go past
 *    hemispherical at any useful aperture; and
 *  - a **tolerance**. A relative error ε on curvature k moves the focal length by
 *    Δf/f = −ε·f·cₖ·(nₖ−nₖ₋₁) — thin-lens exact, and traced to about a percent —
 *    so the amplification is |f·cₖ·Δnₖ|, and it runs 1.6× / 13.2× / 64.3× across
 *    those same three triples. An apochromat of ordinary glass is a design that
 *    exists and cannot be MADE, which is a more useful statement than a matrix
 *    that will not invert.
 *
 * Nothing here throws on conditioning, therefore. What throws is what is
 * physically absent: no real S_I root, or roots that are not surfaces at the
 * aperture asked for.
 *
 * **This constructor still refuses every CaF₂-free triple in the catalogue, and
 * the reason is one step further on than the conditioning.** At the ratios where
 * their curvatures are buildable at all, ΣS_I keeps ONE SIGN across the buildable
 * bendings — N-BK7/F2/fused silica at f/50, f/100 and f/200 — so there is no
 * bending to null it at; slower still, where it does change sign, the scan finds
 * one root and not the classical pair. So "no apochromat without fluorite" does
 * hold for this catalogue, as a MEASURED result about the spherical solve, and
 * not as the linear-algebra claim § 6aq made. Whether a fourth glass changes that
 * is the superachromat question, and is not asked here.
 *
 * ## What is corrected, and what honestly is not
 *
 *  - **Chromatically**, F, d and C are united by construction — to 1e−13 of the
 *    focal length, which is the Newton tolerance and not a physical residual.
 *    What is left is the **tertiary** spectrum, the band's departure between and
 *    outside those three lines, and it is traced rather than closed-form.
 *  - **Spherical aberration** is nulled to *third* order at the conjugate and
 *    marginal height it was solved for, with a fifth-order residual surviving —
 *    `designs/achromat`'s caveat verbatim, and for the same reason.
 *  - **Coma** is reported per branch and is not what decides. Astigmatism and
 *    field curvature are traced and unpinned.
 *
 * SCOPE. The stop is at the front vertex, where a cell puts it, and the glass
 * carries the same margins over D/2 that `designs/achromat` uses — so, as for
 * §§ 5g–5i, drive the preset with `{kind:"stopRadius", value: D/2}` rather than
 * an `fNumber`/`EPD` spec, which would read the oversized glass edge. Cement
 * layers, coatings and the cell are mechanical and absent.
 */

/** The three glasses, in the order light meets them. */
export type ApochromatGlasses = readonly [string, string, string];

export interface ApochromaticObjectiveSpec {
  /** Clear aperture / entrance pupil diameter (mm). */
  readonly apertureMm: number;
  /** Focal ratio f/D. */
  readonly focalRatio: number;
  /**
   * The three glasses front to back. Default `["CAF2", "F2", "N-BK7"]` — the one
   * triple in `materials/catalog` that is both solvable and fast, for the reason
   * in the header. Any triple is accepted; the conditioning is reported.
   */
  readonly media?: ApochromatGlasses;
  /** Wavelength (nm) the powers are computed at. Default the d line, 587.5618 nm. */
  readonly designWavelengthNm?: number;
  /** The three element centre thicknesses (mm). Mechanical. Default `[1.6, 1.2, 1.2]`. */
  readonly thicknessesMm?: readonly [number, number, number];
  /**
   * Which root of S_I(c₁) = 0 to build. Both null the third-order spherical
   * aberration; `"shallow"` (default) is the one whose surfaces cancel least
   * violently, which on the default triple is also the visibly shallower one.
   * `"steep"` builds the other — and see the header: on this design the choice
   * also decides how many wavelengths a telecentric stop is telecentric at.
   */
  readonly branch?: "shallow" | "steep";
  /**
   * Distance from the last vertex to the image plane (mm). Defaults to the
   * paraxial back focal distance at the design wavelength — or, with
   * `objectDistanceMm` given, to the paraxial image distance for that object.
   */
  readonly backFocusMm?: number;
  /**
   * Axial object distance in front of surface 0 (mm). Omitted, the bending is
   * solved for a collimated input. Given, S_I is nulled for that finite pair
   * instead, which is a materially different lens — § 6b's finding, and it
   * applies here unchanged.
   */
  readonly objectDistanceMm?: number;
  /**
   * What ΣS_I is solved TO (mm). Zero — the default — is the aplanatic-on-axis
   * triplet. The same footgun `AchromaticObjectiveSpec.targetS1Mm` documents
   * applies: S_I ∝ h⁴, so a NON-zero target is only meaningful together with the
   * marginal height it is evaluated at, and that height is this constructor's
   * own D/2.
   */
  readonly targetS1Mm?: number;
}

/** One SA-null bending, with the numbers that distinguish it from the other. */
export interface ApochromatBranch {
  readonly curvatures: readonly [number, number, number, number];
  /**
   * Σᵢ|S_I,ᵢ| — the sum of the surfaces' individual third-order contributions,
   * which the design nulls by cancellation. THIS is what picks the branch.
   */
  readonly cancellation: number;
  /** max|c|·(D/2) over the four surfaces — the steepness the criterion tracks. */
  readonly maxSurfaceSlope: number;
  /** Σ S_II per radian of field (mm/rad) — reported, but NOT the selector. */
  readonly comaPerRadian: number;
}

export interface ApochromaticObjective {
  readonly prescription: Prescription;
  /** The design target (mm) = D·F, and what the thick solve is driven to. */
  readonly focalLengthMm: number;
  /**
   * The traced paraxial EFL at the design wavelength (mm). Unlike
   * `designs/achromat`'s, this one IS `focalLengthMm` to solver precision: the
   * powers were solved on the thick first order, so Gullstrand's separation term
   * is inside the solve rather than left over from it.
   */
  readonly paraxialFocalLengthMm: number;
  /** Surface curvatures (1/mm): front, two cement joints, rear. */
  readonly curvatures: readonly [number, number, number, number];
  /** Surface radii (mm) — Infinity for a flat. The design's headline numbers. */
  readonly radiiMm: readonly [number, number, number, number];
  /**
   * The three element powers (1/mm) the THICK solve actually produced, by the
   * thin maker's equation φᵢ = (nᵢ−1)(cᵢ−cᵢ₊₁) on the built curvatures.
   */
  readonly elementPowers: readonly [number, number, number];
  /**
   * THE EXTERNAL NUMBER: the classical three-glass split's element powers
   * (1/mm), from two Abbe numbers and two partial dispersions per glass and
   * nothing else. What the design tends to as the glass goes thin.
   */
  readonly thinElementPowers: readonly [number, number, number];
  /**
   * max |φᵢ − φᵢ,thin| / φ — how far the thick solve sits from the closed form,
   * as a fraction of the TOTAL power: 3.80e−2 on the default triple, which is
   * 1.5% of the fluorite element's own power. It is the glass being THICK, and
   * halving the thicknesses halves it, five times over (§ 6ar.1).
   */
  readonly thinPowerGap: number;
  /**
   * max |φᵢ,thin| / φ — the glass triple's CONDITIONING, scale-free and a
   * property of the three glasses alone. ≈2.5 for a CaF₂ triple, 50–518 without
   * one. Not a refusal: see the header for what it costs instead.
   */
  readonly conditioning: number;
  /**
   * Worst-case curvature tolerance amplification: max over the four surfaces of
   * |f·cₖ·(nₖ−nₖ₋₁)|, the thin-lens factor by which a RELATIVE curvature error
   * becomes a relative focal-length error. Tracks `conditioning`, and is the
   * number that says what ill-conditioning costs.
   */
  readonly toleranceAmplification: number;
  readonly indices: readonly [number, number, number];
  readonly abbeNumbers: readonly [number, number, number];
  /** Relative partial dispersions P = (n_d−n_C)/(n_F−n_C) of the three glasses. */
  readonly partialDispersions: readonly [number, number, number];
  /**
   * Σ S_I at the solution (mm) — `targetS1Mm` to solver precision, by
   * construction, at the conjugate and marginal height it was solved for.
   */
  readonly seidelS1: number;
  /** What ΣS_I was solved to (mm). */
  readonly targetS1Mm: number;
  /** The finite object conjugate the bending was solved at (mm), if any. */
  readonly objectDistanceMm?: number;
  /** Σ S_II per radian of field (mm/rad) for the branch built. */
  readonly comaPerRadian: number;
  /** Both SA-null roots, chosen and rejected, in the order the solver found them. */
  readonly branches: readonly [ApochromatBranch, ApochromatBranch];
  /** Which root was built. */
  readonly branch: "shallow" | "steep";
  /** Paraxial back focal distance at the design wavelength (mm), echoed since it defaults. */
  readonly backFocusMm: number;
  readonly thicknessesMm: readonly [number, number, number];
  readonly designWavelengthNm: number;
  readonly media: ApochromatGlasses;
}

/**
 * The aperture refusal, `DoubletApertureRefusal`'s counterpart and kept a
 * distinct type for the same reason: a caller still converging its own geometry
 * cannot read it as a verdict on the glass. It fires when the bending scan finds
 * roots that are not surfaces at this aperture — slow the focal ratio and it
 * builds. Finding NOTHING is a fact about the glasses at this conjugate and
 * stays an ordinary `Error`, as does every argument complaint.
 */
export class TripletApertureRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripletApertureRefusal";
  }
}

/**
 * Gauss-Jordan with partial pivoting on a 3×3. Returns null rather than throwing
 * when a pivot vanishes: the two callers want opposite things from that case —
 * the glass split treats it as an argument error, the Newton step treats it as
 * "this bending is not a design" — so neither gets to impose its reading here.
 */
function solve3x3(
  rows: readonly (readonly number[])[],
  rhs: readonly number[],
): [number, number, number] | null {
  const M = rows.map((r, i) => [...r, rhs[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k]![i]!) > Math.abs(M[p]![i]!)) p = k;
    [M[i], M[p]] = [M[p]!, M[i]!];
    const pivot = M[i]![i]!;
    if (!Number.isFinite(pivot) || pivot === 0) return null;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const factor = M[k]![i]! / pivot;
      for (let j = i; j < 4; j++) M[k]![j]! -= factor * M[i]![j]!;
    }
  }
  const x = [0, 1, 2].map((i) => M[i]![3]! / M[i]![i]!);
  return x.every(Number.isFinite) ? (x as [number, number, number]) : null;
}

/**
 * The solve did not find a triplet at this bending: damped Newton from the thin
 * split did not reach a set of trailing curvatures giving this focal length with
 * F, d and C united.
 *
 * **It says the SOLVER did not converge, not that no such triplet exists**, and
 * the distinction is measured rather than hedged. The set of bendings this solve
 * converges on is not an interval: sampled across the scan window it comes out in
 * 8, 16, 32 and 101 contiguous runs at 200, 400, 1000 and 4000 samples, and a set
 * whose piece-count grows with how hard you look at it is a convergence basin,
 * not a geometry. Whether Newton reaches a root from a fixed start is not a
 * smooth property of where it starts, and nothing here makes it one.
 *
 * What that costs is bounded and is handled where it matters: a bending the solve
 * cannot reach is not a candidate, and the scan below drops brackets it cannot
 * keep defined rather than bisecting across a hole (§ 6ar.3). What it does NOT
 * license is reading this as "no design there".
 *
 * It is a distinct type because it is not a complaint about the arguments — which
 * is what `curvaturesAt`'s ordinary `Error`s are for.
 */
export class TripletBendingUndefined extends Error {
  readonly bending: number;
  constructor(bending: number, message: string) {
    super(message);
    this.name = "TripletBendingUndefined";
    this.bending = bending;
  }
}

/** Paraxial EFL of a group, from the public paraxial trace and nothing else. */
const groupEfl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/**
 * The cemented-triplet FORM: the three-glass split, and how a bending plus three
 * solved curvatures become four surfaces. Split out from the solve the way
 * `cementedDoubletForm` is, so a caller that wants to range over bendings itself
 * does not have to go through a solver.
 */
export interface CementedTripletForm {
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly media: ApochromatGlasses;
  readonly indices: readonly [number, number, number];
  readonly abbeNumbers: readonly [number, number, number];
  readonly partialDispersions: readonly [number, number, number];
  /** The thin three-glass split's element powers (1/mm) — the external number. */
  readonly thinElementPowers: readonly [number, number, number];
  /** max|φᵢ,thin|/φ — the triple's conditioning. */
  readonly conditioning: number;
  /**
   * The four curvatures at a bending: c₁ is given, the other three are solved by
   * Newton so that the THICK first order has the target focal length at d and the
   * same at F and C. Throws `TripletBendingUndefined` outside the bending family.
   */
  readonly curvaturesAt: (c1: number) => [number, number, number, number];
  /** `curvaturesAt`, returning null instead of throwing outside the family. */
  readonly tryCurvaturesAt: (c1: number) => [number, number, number, number] | null;
  /** The four-surface prescription at four curvatures, with a stated last thickness. */
  readonly build: (
    cs: readonly [number, number, number, number],
    lastMm: number,
  ) => Prescription;
}

export interface CementedTripletFormSpec {
  readonly apertureMm: number;
  readonly focalLengthMm: number;
  readonly media?: ApochromatGlasses;
  readonly designWavelengthNm?: number;
  readonly thicknessesMm?: readonly [number, number, number];
}

export function cementedTripletForm(spec: CementedTripletFormSpec): CementedTripletForm {
  const D = spec.apertureMm;
  const f = spec.focalLengthMm;
  if (!(D > 0) || !Number.isFinite(D)) {
    throw new Error("cementedTripletForm: aperture must be a positive finite length");
  }
  if (!(f > 0) || !Number.isFinite(f)) {
    throw new Error("cementedTripletForm: focal length must be a positive finite length");
  }
  const media = spec.media ?? (["CAF2", "F2", "N-BK7"] as const);
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const thicknessesMm = spec.thicknessesMm ?? ([1.6, 1.2, 1.2] as const);
  if (!thicknessesMm.every((t) => t > 0 && Number.isFinite(t))) {
    throw new Error("cementedTripletForm: element thicknesses must be positive and finite");
  }
  if (new Set(media).size !== 3) {
    throw new Error(
      `cementedTripletForm: the three glasses must be distinct (got ${media.join("/")}) — two of the same glass make the achromatic and apochromatic rows dependent`,
    );
  }

  const glasses = media.map((name) => {
    const m = getMedium(name);
    const nD = m.n(designWavelengthNm);
    if (!(nD > 1)) throw new Error(`cementedTripletForm: ${name} must have index > 1`);
    const nF = m.n(LINE_F);
    const nC = m.n(LINE_C);
    if (!(Math.abs(nF - nC) > 0)) {
      throw new Error(
        `cementedTripletForm: ${name} has no dispersion between the F and C lines, so it cannot take part in a colour split`,
      );
    }
    return { nD, V: abbeNumber(m), P: (m.n(LINE_D) - nC) / (nF - nC) };
  });
  const indices = glasses.map((g) => g.nD) as unknown as [number, number, number];
  const abbeNumbers = glasses.map((g) => g.V) as unknown as [number, number, number];
  const partialDispersions = glasses.map((g) => g.P) as unknown as [number, number, number];

  // THE EXTERNAL NUMBER: Σφ = φ, Σφ/V = 0, ΣφP/V = 0. Nothing traced.
  const phi = 1 / f;
  const thinElementPowers = solve3x3(
    [glasses.map(() => 1), glasses.map((g) => 1 / g.V), glasses.map((g) => g.P / g.V)],
    [phi, 0, 0],
  );
  if (thinElementPowers === null) {
    // Exactly singular, which needs two of the three (V, P) points to coincide to
    // the last bit. Near-singular is NOT this and does not come here: it solves,
    // and what it costs is reported as `conditioning` — see the header.
    throw new Error(
      `cementedTripletForm: ${media.join("/")} makes the three-glass system exactly singular — two of the glasses are indistinguishable in (V, P)`,
    );
  }
  const conditioning = Math.max(...thinElementPowers.map((p) => Math.abs(p / phi)));

  // The same margins `cementedDoubletForm` uses, and for the same reason: a face
  // sized to exactly D/2 shaves its own rim ring off axis, since a pencil crosses
  // the pupil PLANE at D/2 and then meets the curved surface a sag further out.
  const frontClearRadius = (D / 2) * 1.005;
  const rearClearRadius = (D / 2) * 1.02;

  const build = (
    cs: readonly [number, number, number, number],
    lastMm: number,
  ): Prescription => ({
    surfaces: cs.map((c, i): SurfaceSpec => ({
      kind: "refract",
      curvature: c,
      semiAperture: i === 0 ? frontClearRadius : rearClearRadius,
      thickness: i < 3 ? thicknessesMm[i]! : lastMm,
      medium: i < 3 ? media[i]! : "AIR",
      ...(i === 0 ? { isStop: true as const } : {}),
    })),
  });

  /**
   * Newton on the THICK first order. Three residuals — the focal length at d, and
   * F and C each against d — in the three trailing curvatures, started from the
   * thin split so the first step is already close.
   *
   * Two details are not decoration, and § 6ar.3 is the rung that measured why.
   *
   *  - **The Jacobian's finite-difference step is RELATIVE**, 1e−7 of the
   *    curvature or of 1/f, whichever is larger. An absolute step is not
   *    scale-free: at 1e−9 it is a relative bump of 2e−8 on a curvature of 0.05
   *    and of 1e−12 on one of 1e3, and at 1e−12 the bumped and unbumped focal
   *    lengths round to exactly equal — a column of zeros, and a Jacobian that is
   *    singular for a floating-point reason rather than an optical one.
   *  - **The step is damped** by backtracking on the residual norm, which is the
   *    textbook globalisation and is what actually makes the solve robust: raw
   *    Newton converges on 37 of 121 bendings across the scan window and the
   *    damped one on 116, and at the two roots the two agree to twelve
   *    significant digits. So the damping buys reach, not accuracy — the answer
   *    is a root of the residual either way.
   *
   * Where it still does not converge, `TripletBendingUndefined` says exactly that
   * and no more — see its own note. The bendings it fires on are NOT known to be
   * bendings at which no triplet exists, and the scan is built so that it does not
   * need them to be.
   */
  const residualAt = (
    c1: number,
    w: readonly number[],
  ): [number, number, number] | null => {
    const p = build([c1, w[0]!, w[1]!, w[2]!], 0);
    const fD = groupEfl(p, designWavelengthNm);
    const r: [number, number, number] = [
      fD - f,
      groupEfl(p, LINE_F) - fD,
      groupEfl(p, LINE_C) - fD,
    ];
    return r.every(Number.isFinite) ? r : null;
  };

  const tryCurvaturesAt = (c1: number): [number, number, number, number] | null => {
    if (!Number.isFinite(c1)) return null;
    // Start at the thin lens: cᵢ₊₁ = cᵢ − φᵢ/(nᵢ−1).
    const start: number[] = [c1];
    for (let i = 0; i < 3; i++) {
      start.push(start[i]! - thinElementPowers[i]! / (glasses[i]!.nD - 1));
    }
    let v = start.slice(1);
    const norm = (r: readonly number[]): number => Math.max(...r.map(Math.abs));
    const tolerance = 1e-14 * Math.max(1, f);
    for (let step = 0; step < 200; step++) {
      const r = residualAt(c1, v);
      if (r === null) return null;
      if (norm(r) < tolerance) return [c1, v[0]!, v[1]!, v[2]!];
      const columns: [number, number, number][] = [];
      for (let j = 0; j < 3; j++) {
        const h = 1e-7 * Math.max(Math.abs(v[j]!), 1 / f);
        const bumped = v.slice();
        bumped[j]! += h;
        const rb = residualAt(c1, bumped);
        if (rb === null) return null;
        columns.push([0, 1, 2].map((i) => (rb[i]! - r[i]!) / h) as [number, number, number]);
      }
      const delta = solve3x3(
        [0, 1, 2].map((i) => [columns[0]![i]!, columns[1]![i]!, columns[2]![i]!]),
        r.map((x) => -x),
      );
      if (delta === null) return null;
      // Backtracking: halve the step until the residual norm actually falls.
      let lambda = 1;
      let next = v.map((x, i) => x + delta[i]!);
      let nr = residualAt(c1, next);
      for (let t = 0; t < 40 && (nr === null || norm(nr) > norm(r)); t++) {
        lambda /= 2;
        next = v.map((x, i) => x + lambda * delta[i]!);
        nr = residualAt(c1, next);
      }
      if (nr === null || norm(nr) >= norm(r)) return null;
      v = next;
    }
    return null;
  };

  const curvaturesAt = (c1: number): [number, number, number, number] => {
    if (!Number.isFinite(c1)) {
      throw new Error("cementedTripletForm: the bending must be finite");
    }
    const cs = tryCurvaturesAt(c1);
    if (cs === null) {
      throw new TripletBendingUndefined(
        c1,
        `cementedTripletForm: the damped Newton solve did not converge on a ${media.join("/")} triplet of focal length ${f} mm at bending c₁ = ${c1.toExponential(6)} — this bending is not reachable from the thin split, which is not the same as saying no such triplet exists`,
      );
    }
    return cs;
  };

  return {
    focalLengthMm: f,
    apertureMm: D,
    media,
    indices,
    abbeNumbers,
    partialDispersions,
    thinElementPowers,
    conditioning,
    curvaturesAt,
    tryCurvaturesAt,
    build,
  };
}

export function apochromaticObjective(
  spec: ApochromaticObjectiveSpec,
): ApochromaticObjective {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  if (!(D > 0) || !(F > 0) || !Number.isFinite(D) || !Number.isFinite(F)) {
    throw new Error("apochromaticObjective: aperture and focal ratio must be positive and finite");
  }
  const f = D * F;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const thicknessesMm = spec.thicknessesMm ?? ([1.6, 1.2, 1.2] as const);

  const form = cementedTripletForm({
    apertureMm: D,
    focalLengthMm: f,
    ...(spec.media === undefined ? {} : { media: spec.media }),
    designWavelengthNm,
    thicknessesMm,
  });

  const objectDistanceMm = spec.objectDistanceMm;
  if (
    objectDistanceMm !== undefined &&
    !(objectDistanceMm > 0 && Number.isFinite(objectDistanceMm))
  ) {
    throw new Error(
      "apochromaticObjective: objectDistanceMm must be a positive finite distance",
    );
  }
  const conjugate = objectDistanceMm === undefined ? {} : { objectDistanceMm };

  const targetS1Mm = spec.targetS1Mm ?? 0;
  if (!Number.isFinite(targetS1Mm)) {
    throw new Error("apochromaticObjective: targetS1Mm must be finite");
  }

  /**
   * ΣS_I less the target, or null where the bending is outside the family. The
   * two are genuinely different answers and the scan below must not confuse
   * them: a bending with no design is not a bending with S_I of one sign.
   */
  const s1Of = (c1: number): number | null => {
    const cs = form.tryCurvaturesAt(c1);
    if (cs === null) return null;
    const s1 = seidelSums(form.build(cs, f), designWavelengthNm, {
      marginalHeightMm: D / 2,
      ...conjugate,
    }).s1;
    return Number.isFinite(s1) ? s1 - targetS1Mm : null;
  };

  /**
   * Is this bending a surface at this aperture? |c|·(D/2) = 1 is a hemisphere.
   * A bending the solve cannot reach is not a lens either — there is nothing to
   * measure the steepness of — and both readers go through the non-throwing solve
   * so that a root the scan hands back can never take the constructor down.
   */
  const isLens = (c1: number): boolean => {
    const cs = form.tryCurvaturesAt(c1);
    return cs !== null && cs.every((c) => Math.abs(c) * (D / 2) < 1);
  };
  const steepness = (c1: number): number => {
    const cs = form.tryCurvaturesAt(c1);
    return cs === null ? Infinity : Math.max(...cs.map((c) => Math.abs(c) * (D / 2)));
  };

  /**
   * Scan the bending for sign changes of S_I and bisect each. The span is the
   * thin split's own curvature differences and the window ±3 of it is
   * `designs/achromat`'s, but what the scan walks over is different in two ways
   * worth stating rather than inheriting:
   *
   *  - **Most of that window is not a design.** The bending family is an
   *    interval, and outside it the three chromatic conditions have no
   *    simultaneous solution at this focal length (§ 6ar.3). Those samples are
   *    holes, not values, and a bracket is only accepted between two ADJACENT
   *    DEFINED samples — bracketing across a hole would be pairing the sign on
   *    one side of a gap with the sign on the other, which is not a crossing.
   *  - **There is no ghost root.** `designs/achromat` must filter its roots for
   *    buildability before counting them, because past the aperture wall S_I
   *    grows a root that is five times hemispherical. Here the surviving set is
   *    exactly two at windows of ±2, ±3, ±5 and ±8 spans (§ 6ar.2). The filter
   *    runs anyway, since the refusal message needs the count, and it removes
   *    nothing on any input in this repo.
   */
  const solveBendings = (): [ApochromatBranch, ApochromatBranch] => {
    const span = form.thinElementPowers.reduce(
      (total, p, i) => total + Math.abs(p / (form.indices[i]! - 1)),
      0,
    );
    const lo = -3 * span;
    const hi = 3 * span;
    const steps = 400;
    const roots: number[] = [];
    let defined = 0;
    let abandoned = 0;
    let prevC = lo;
    let prevS = s1Of(lo);
    for (let i = 1; i <= steps; i++) {
      const c = lo + ((hi - lo) * i) / steps;
      const s = s1Of(c);
      if (s !== null) defined++;
      if (prevS !== null && s !== null) {
        if (prevS === 0) roots.push(prevC);
        else if (prevS * s < 0) {
          let a = prevC;
          let b = c;
          let fa = prevS;
          let hole = false;
          for (let k = 0; k < 100 && b - a > Math.abs(b) * 1e-15; k++) {
            const mid = 0.5 * (a + b);
            const fm = s1Of(mid);
            if (fm === null) {
              // The bracket's ends are both defined and its middle is not, so the
              // reachable set is not an interval and this bracket cannot be
              // narrowed. ABANDON it rather than returning the midpoint: the
              // midpoint is precisely the bending just shown to be unreachable,
              // and pushing it made the constructor throw the solver's own
              // `TripletBendingUndefined` at the caller (§ 6ar.3).
              hole = true;
              break;
            }
            if (fm === 0) {
              a = mid;
              b = mid;
              break;
            }
            if (fa * fm < 0) b = mid;
            else {
              a = mid;
              fa = fm;
            }
          }
          if (hole) abandoned++;
          else roots.push(0.5 * (a + b));
        }
      }
      prevC = c;
      prevS = s;
    }
    if (defined === 0) {
      throw new Error(
        `apochromaticObjective: no bending in ±${(3 * span).toExponential(3)} gives a ${form.media.join("/")} triplet of focal length ${f} mm with F, d and C united — the bending family is empty at this focal length`,
      );
    }
    const lenses = roots.filter(isLens);
    if (lenses.length !== 2) {
      /**
       * The same discriminator `designs/achromat` uses, and the same discipline:
       * finding NOTHING is a fact about the glasses at this conjugate, and every
       * N > 0 lands on the aperture. What is different is that no input is known
       * to reach the middle cases here — this solve has no ghost root — so they
       * say they are unmeasured rather than asserting a cause.
       */
      const ghosts = roots.filter((c1) => !isLens(c1)).map(steepness);
      const expected =
        targetS1Mm === 0
          ? "expected two spherical-aberration-null bendings"
          : `expected two bendings with ΣS_I = ${targetS1Mm.toExponential(3)} mm`;
      const aperture = roots.length > 0;
      const cause = !aperture
        ? targetS1Mm === 0
          ? `no bending of ${form.media.join("/")} nulls the third-order spherical aberration at this conjugate`
          : `no bending of ${form.media.join("/")} absorbs that much external spherical aberration`
        : ghosts.length > 0
          ? `the rest are deeper than hemispherical (${Math.max(...ghosts).toFixed(2)}× at the steepest surface) and cannot be made — what is binding is the APERTURE and not the glasses, so slow the focal ratio`
          : `every bending the scan found is a lens, so nothing here says WHY the count is not two — no input in this repo is known to reach this`;
      const counted = aperture
        ? `found ${roots.length}, of which ${lenses.length} ${lenses.length === 1 ? "is a lens" : "are lenses"}`
        : "found 0";
      // Never drop a bracket silently: an abandoned one is a sign change the
      // solve could not follow, and a caller reading "found 0" deserves to know
      // the scan saw something and could not narrow it.
      const dropped =
        abandoned > 0
          ? ` (and ${abandoned} sign change${abandoned === 1 ? "" : "s"} the solve could not narrow, its bracket straddling bendings Newton does not reach)`
          : "";
      const message = `apochromaticObjective: ${expected}, ${counted}${dropped} — ${cause}`;
      throw aperture ? new TripletApertureRefusal(message) : new Error(message);
    }
    return lenses.map((c1): ApochromatBranch => {
      const cs = form.curvaturesAt(c1);
      const s = seidelSums(form.build(cs, f), designWavelengthNm, {
        marginalHeightMm: D / 2,
        fieldAngleRad: 1,
        ...conjugate,
      });
      return {
        curvatures: cs,
        cancellation: s.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0),
        maxSurfaceSlope: Math.max(...cs.map((c) => Math.abs(c) * (D / 2))),
        comaPerRadian: s.s2,
      };
    }) as unknown as [ApochromatBranch, ApochromatBranch];
  };

  const branches = solveBendings();
  const branch = spec.branch ?? "shallow";
  if (branch !== "shallow" && branch !== "steep") {
    throw new Error(`apochromaticObjective: unknown branch "${String(branch)}"`);
  }
  const shallowFirst = branches[0].cancellation <= branches[1].cancellation;
  const chosen =
    branch === "shallow"
      ? shallowFirst
        ? branches[0]
        : branches[1]
      : shallowFirst
        ? branches[1]
        : branches[0];
  const curvatures = chosen.curvatures;

  // The back focus, from the built prescription's own paraxial trace.
  const group = form.build(curvatures, 0);
  const marginal = paraxialTrace(group, designWavelengthNm, { y: 1, u: 0 });
  const backFocusDefault = -marginal.y / marginal.u;
  const paraxialFocalLengthMm = groupEfl(group, designWavelengthNm);
  // For a finite object the plane wanted is that object's image, not the back
  // focus. The ray is the one leaving the axial object point L ahead and reaching
  // the first vertex at unit height, so its slope there is 1/L.
  const imageDistance =
    objectDistanceMm === undefined
      ? backFocusDefault
      : (() => {
          const r = paraxialTrace(group, designWavelengthNm, {
            y: 1,
            u: 1 / objectDistanceMm,
          });
          return -r.y / r.u;
        })();
  const backFocusMm = spec.backFocusMm ?? imageDistance;
  if (!Number.isFinite(backFocusMm)) {
    throw new Error("apochromaticObjective: backFocusMm must be finite");
  }

  const phi = 1 / f;
  const elementPowers = [0, 1, 2].map(
    (i) => (form.indices[i]! - 1) * (curvatures[i]! - curvatures[i + 1]!),
  ) as unknown as [number, number, number];
  const thinPowerGap = Math.max(
    ...[0, 1, 2].map((i) => Math.abs(elementPowers[i]! - form.thinElementPowers[i]!) / phi),
  );
  // Δf/f = −ε·f·cₖ·(nₖ − nₖ₋₁) for a RELATIVE error ε on curvature k, thin-lens
  // exact — the amplification is the factor on ε.
  const stack = [1, ...form.indices, 1];
  const toleranceAmplification = Math.max(
    ...curvatures.map((c, k) => Math.abs(f * c * (stack[k + 1]! - stack[k]!))),
  );

  const solved = seidelSums(form.build(curvatures, backFocusMm), designWavelengthNm, {
    marginalHeightMm: D / 2,
    fieldAngleRad: 1,
    ...conjugate,
  });

  return {
    prescription: form.build(curvatures, backFocusMm),
    focalLengthMm: f,
    paraxialFocalLengthMm,
    curvatures,
    radiiMm: curvatures.map((c) => (c === 0 ? Infinity : 1 / c)) as unknown as [
      number,
      number,
      number,
      number,
    ],
    elementPowers,
    thinElementPowers: form.thinElementPowers,
    thinPowerGap,
    conditioning: form.conditioning,
    toleranceAmplification,
    indices: form.indices,
    abbeNumbers: form.abbeNumbers,
    partialDispersions: form.partialDispersions,
    seidelS1: solved.s1,
    targetS1Mm,
    ...(objectDistanceMm === undefined ? {} : { objectDistanceMm }),
    comaPerRadian: chosen.comaPerRadian,
    branches,
    branch,
    backFocusMm,
    thicknessesMm,
    designWavelengthNm,
    media: form.media,
  };
}
