import { Prescription, SurfaceSpec } from "../trace/prescription";
import { getMedium } from "../materials/catalog";
import { abbeNumber, LINE_G, LINE_D, LINE_F, LINE_C } from "../materials/dispersion";
import { paraxialTrace } from "../trace/paraxial";
import { seidelSums } from "../analysis/seidel";

/**
 * The cemented superachromatic quadruplet — four glasses, four united
 * wavelengths, and the term after `designs/apochromat` in the series
 * `designs/achromat` starts.
 *
 * § 6at asked whether four united colours are reachable from `materials/catalog`
 * and answered yes, on thin splits: every four-glass quadruple solves, the
 * fourth row is conditioned by the glasses failing to be COPLANAR in
 * (V, P_dC, P_gF) rather than by a second anomalous glass, and what the fourth
 * colour costs is a focal-ratio wall and a curvature tolerance 460× tighter than
 * the triplet's. What it could not do is say where inside a 0.09–0.14% band of
 * radius error the fourth glass stops paying for itself, because the quantity
 * that decides it moves 4.6× with a bending nothing there solved for. **This is
 * that lens, and § 6av is where the band becomes a number.**
 *
 * ## What the design has to satisfy
 *
 * A cemented quadruplet has five curvatures c₁…c₅ (surfaces 2, 3 and 4 are the
 * three cement joints) and four glasses. Four conditions, on the four element
 * powers, with kᵢ(λ) = (nᵢ(λ)−1)/(nᵢ,d−1) the way an element's power scales
 * across the spectrum:
 *
 *     Σ φᵢ                      = φ      the lens has the focal length asked for
 *     Σ φᵢ·(kᵢ(λⱼ) − kᵢ(λ_m))   = 0      for each j < m
 *
 * That is § 6at's formulation at m = 4 and λ = g, F, d, C. At m = 3 and F, d, C
 * the same rows are Σφᵢ/Vᵢ = 0 and Σφᵢ·Pᵢ/Vᵢ = 0 exactly, which is
 * `cementedTripletForm`'s classical split and § 6ar.1's external number —
 * § 6at.1 pins the reduction over all sixty ordered triples to 1e−12, and this
 * file inherits that rather than re-deriving it.
 *
 * ## The thin split does not select a thick lens, and here that is FATAL
 *
 * `designs/apochromat` solves its three trailing curvatures by damped Newton on
 * the thick first order, started from the thin split. The same start does not
 * work at four glasses, and the reason is not that Newton fails to converge — it
 * is that it converges to the WRONG ROOT, silently.
 *
 * The residual system has more than one thick solution. At neighbouring bendings
 * the thin start lands in different basins, so the solved lens jumps: at one
 * sampled bending the direct solve returns a lens more than 4.3× steeper than
 * the one it returns a step away, both satisfying all four colour conditions to
 * 1e−13 — and § 6av.2 is the rung that measures that, at 6 of the 125 bendings
 * where both methods reach a solution.
 *
 * Everything downstream is then measuring a function that is not one: S_I(c₁)
 * acquires jump discontinuities and the bisection brackets them as though they
 * were crossings. **That is not a hypothetical.** The first draft of this module
 * solved directly and its root count came out 3, 4, 5 or 6 depending only on how
 * finely the bending was sampled — every number in it an artefact. No rung pins
 * that spread, because the code that produced it was discarded rather than
 * shipped; what is pinned is the divergence above and the stable count at
 * § 6av.3.
 *
 * Why four glasses and not three: the split's conditioning is 12.29 against the
 * apochromatic triple's 2.578, so the element powers are ~12× the total power,
 * and Gullstrand's separation term — which goes as φᵢφⱼd — is then LARGER than
 * the power it corrects. The thick lens sits **1.06 total powers** away from the
 * thin split it started at, where the triplet sits 0.040 away (§ 6ar.1's
 * `thinPowerGap`). At that distance the thin split is not a nearby start; it is
 * a different lens. The gap belongs to the focal length and the thicknesses and
 * not to the aperture, so it is quoted at the 250 mm the shipped lens now has;
 * at the 120 mm § 6av first shipped it is 3.3.
 *
 * So the solve **continues in thickness**: the trailing curvatures are solved at
 * a fraction of the centre thicknesses and the solution walked up to full
 * thickness, each step warm-started from the last. At the first step the lens
 * really is nearly thin and the thin split really is a nearby start; every step
 * after tracks one branch. The result is a function of the bending again, and
 * `continuationSteps` is exposed rather than hidden so that a rung can check the
 * answer does not depend on it: 8 steps and 24 agree to better than 1e−9
 * relative wherever both converge (§ 6av.2) — they are separate Newton paths
 * onto one root, so they agree to solver precision and not bit for bit, and that
 * is what says the walk tracks a branch rather than finding a step-size
 * artefact.
 *
 * ## There is ONE spherical-aberration null, not two, and that was measured
 *
 * The four chromatic conditions fix the four curvature *differences*; c₁ — the
 * bending — slides all five together, changes no first-order and no chromatic
 * property, and is chosen by nulling the third-order spherical aberration sum,
 * S_I(c₁) = 0, by the published Seidel formulas on the real thick prescription.
 * `analysis/seidel` is pinned to the thin-lens closed form and the
 * spherical-mirror figure before this uses it (§ 5j).
 *
 * A doublet has two such roots and so does the apochromatic triplet, and
 * `designs/apochromat` types that pair into its signature: `branches` is a
 * 2-tuple, `branch: "shallow" | "steep"` picks between them, and any other count
 * is a refusal. **None of that carries over.** Inside the bending family this
 * solve reaches there is exactly one root, at scan windows of ±2, ±3 and ±5
 * spans and at 400 and 1600 samples alike (§ 6av.3). So there is no branch to
 * choose, no cancellation criterion to choose it by, and this constructor has no
 * `branch` option — a copied 2-tuple would have turned the finding into a throw.
 *
 * What IS there, and the triplet does not have, is a root that is not a surface:
 * at f/11 the scan finds two roots and only one of them is one, the other more
 * than two hemispheres deep (§ 6av.4). `designs/achromat` needs its
 * root-is-a-lens filter for a ghost past the aperture wall, and
 * `designs/apochromat` keeps the filter although nothing it ever built needed it
 * (§ 6ar.2); here the filter is doing real work again.
 *
 * ## A root can be a surface and still not be a SOLID
 *
 * And that filter was still not enough, which is § 6av.8 and the correction that
 * moved most of the numbers below. `maxSurfaceSlope` asks of each surface
 * separately whether it is shallower than a hemisphere at the entering height.
 * An element's EDGE THICKNESS — `t + sag(c_{k+1}) − sag(c_k)` at D/2 — is a
 * relation between a PAIR of surfaces, and no amount of per-surface testing sees
 * it. `designs/achromat` has checked it since § 6b and this design did not.
 *
 * It matters here far more than it does for a doublet, for the same reason the
 * continuation exists: element powers ~12× the total power mean cement joints
 * curved far more steeply than a doublet's at the same focal length, so two of
 * them meet inside the clear aperture long before either passes a hemisphere.
 * The lens § 6av first shipped — f/12 at 10 mm — had a steepest surface of 0.867
 * hemispheres and a rear element that ran out of glass at 3.62 mm of a 5 mm
 * semi-aperture. It passed an f/18.6 beam and rays above 3.23 mm entering height
 * missed the last surface outright.
 *
 * Solidity is now half of the root-is-a-lens filter, and three things follow.
 * The wall moves from f/10.81 to **f/21.88** at 10 mm — 3.02× § 6at.6's bound
 * rather than 1.49×. Thickening the glass does not buy the fast end back: at
 * f/12 with elements thick enough to be solid there is no S_I null at all. And
 * the wall is no longer a pure focal-ratio statement, because the centre
 * thicknesses are absolute millimetres while the sags grow with the aperture:
 * f/20.97 at 5 mm, f/21.88 at 10 mm, f/43.14 at 20 mm.
 *
 * ## The prices, and both of them are worse than the thin split said
 *
 *  - **The focal-ratio wall.** § 6at.6's bound is f/7.25 — the shallowest
 *    bending the split admits, true of every bending and free of any aberration
 *    scan. It is a STEEPNESS bound, and steepness is not what binds this design:
 *    it builds at f/21.9 and refuses at f/21.8, where the thinnest element runs
 *    out of glass at the rim. That is **3.02× the bound**, against the
 *    apochromatic triplet's 1.03× (§ 6at.6), while the steepness the built
 *    bending needs is only f/9.26. A bound stays a bound; what this measures is
 *    how far from it the real design sits, and why.
 *  - **The tolerance.** § 6at.8's break-even — the relative curvature error at
 *    which the colour a lens injects equals the colour it was built to remove —
 *    came out as a band, 0.09% to 0.14% of radius, from two thin bendings. The
 *    traced answer is **0.077%**, and the band does not contain it. The band was
 *    built from the shallowest bending and the most favourable one in a scan;
 *    the S_I-null bending is worse than both, and nothing thin knew that. § 6av.6
 *    measures the crossing on a grid of focal ratios and thicknesses, where it
 *    runs 0.0757% to 0.0783% — so the number is a property of the design and not
 *    of the fixture it was measured on.
 *
 * ## And there is still no superachromat without fluorite
 *
 * § 6at.2's load-bearing rung is that the fluorite-free quadruple SOLVES, at
 * conditioning 59.2 — better than the fluorite-free apochromatic triple that
 * § 6ar.6 showed is a real, slow lens. It solves here too, and it is still not a
 * lens: at f/30 and at f/200 alike its ΣS_I keeps one sign at every
 * bending the solve reaches, so there is no bending to null it at (§ 6av.7).
 * That is the same shape of result as `designs/apochromat`'s "no apochromat
 * without fluorite", measured the same way, and it is a statement about the
 * spherical solve and not about the linear algebra — which solves fine.
 *
 * ## What is corrected, and what honestly is not
 *
 *  - **Chromatically**, g, F, d and C are united by construction, to ~3e−15 of
 *    the focal length — the Newton tolerance, not a physical residual. What is
 *    left is the departure between and outside those four lines.
 *  - **Spherical aberration** is nulled to *third* order at the conjugate and
 *    marginal height it was solved for, with a fifth-order residual surviving.
 *  - **Coma** is reported and is not what decides anything, there being one
 *    bending. Astigmatism and field curvature are traced and unpinned.
 *  - **Which fourth line.** g by default. § 6at.5 measured five candidates: g
 *    wins the band it spans by 4.53× over h, and h wins the whole 380–800 by
 *    2.06×. `fourthLineNm` takes either; nothing here re-solves that choice.
 *  - **Four united colours are not four telecentric ones.** § 6aq bounds the
 *    telecentric count by the turn count in FFD(λ), and uniting four wavelengths
 *    is the precondition, not the conclusion. This constructor makes that
 *    question askable — it does not answer it.
 *
 * SCOPE. The stop is at the front vertex, the glass carries `designs/achromat`'s
 * margins over D/2, and cement layers, coatings and the cell are absent — all as
 * for `designs/apochromat`, and drive the preset with `{kind:"stopRadius"}` for
 * the same reason. Those margins are sized off D and not off the marginal ray's
 * height inside the glass, which on this design runs to 1.14·D/2 — a second and
 * much smaller defect than § 6av.8's, measured there and not repaired here,
 * since widening a disc cannot help an element that has no edge to widen.
 */

/** The four glasses, in the order light meets them. */
export type SuperachromatGlasses = readonly [string, string, string, string];

/** The five surface curvatures: front, three cement joints, rear. */
export type QuadrupletCurvatures = readonly [number, number, number, number, number];

/** The four element powers, front to back. */
export type QuadrupletPowers = readonly [number, number, number, number];

/**
 * How many thickness steps the continuation walks. Eight is the default and 24
 * gives the same answer; see the header for why the walk exists at all. Raising
 * it costs one damped Newton solve per step and buys reach at bendings near the
 * edge of the family, not accuracy.
 */
const CONTINUATION_STEPS = 8;

export interface CementedQuadrupletFormSpec {
  readonly apertureMm: number;
  readonly focalLengthMm: number;
  /**
   * The four glasses front to back. Default `["N-BK7", "F2", "CAF2",
   * "FUSED-SILICA"]` — the best-conditioned quadruple in `materials/catalog` at
   * 12.29 (§ 6at.2), and the only one this repo builds. Any four distinct
   * glasses are accepted; the conditioning is reported and is not a refusal.
   */
  readonly media?: SuperachromatGlasses;
  /** Wavelength (nm) the powers are computed at. Default the d line. */
  readonly designWavelengthNm?: number;
  /**
   * The fourth united line (nm). Default the mercury g line, 435.8343 nm — the
   * measured best in-band of five candidates (§ 6at.5). The other three united
   * lines are F, d and C and are not configurable: they are what makes the m = 3
   * reduction the classical split this file inherits its pin from.
   */
  readonly fourthLineNm?: number;
  /** The four element centre thicknesses (mm). Mechanical. Default `[1.6, 1.2, 1.2, 1.2]`. */
  readonly thicknessesMm?: readonly [number, number, number, number];
  /** Thickness-continuation depth. Default 8; see `CONTINUATION_STEPS`. */
  readonly continuationSteps?: number;
}

export interface CementedQuadrupletForm {
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly media: SuperachromatGlasses;
  readonly indices: QuadrupletPowers;
  readonly abbeNumbers: QuadrupletPowers;
  /** P_d,C = (n_d−n_C)/(n_F−n_C), the relative partial dispersion the third row uses. */
  readonly partialDispersions: QuadrupletPowers;
  /** P_g,F = (n_g−n_F)/(n_F−n_C) — the quantity the FOURTH row is conditioned by. */
  readonly secondPartialDispersions: QuadrupletPowers;
  /** The four united wavelengths (nm), in the order the rows are written: λ₄, F, d, C. */
  readonly unitedLinesNm: readonly [number, number, number, number];
  /** The thin four-glass split's element powers (1/mm) — the external number. */
  readonly thinElementPowers: QuadrupletPowers;
  /** max|φᵢ,thin|/φ — the quadruple's conditioning, scale-free. 12.29 by default. */
  readonly conditioning: number;
  /**
   * The five curvatures at a bending: c₁ is given, the other four are solved by
   * damped Newton under thickness continuation so that the THICK first order has
   * the target focal length at d and the same at λ₄, F and C. Throws
   * `QuadrupletBendingUndefined` outside the bending family.
   */
  readonly curvaturesAt: (c1: number) => QuadrupletCurvatures;
  /** `curvaturesAt`, returning null instead of throwing outside the family. */
  readonly tryCurvaturesAt: (c1: number) => QuadrupletCurvatures | null;
  /** The five-surface prescription at five curvatures, with a stated last thickness. */
  readonly build: (cs: QuadrupletCurvatures, lastMm: number) => Prescription;
  /**
   * The same solve WITHOUT the continuation — damped Newton straight from the
   * thin split, which is `designs/apochromat`'s method. Exposed only so that
   * § 6av.2 can measure what it does differently; nothing in the constructor
   * calls it, and a caller wanting a lens wants `curvaturesAt`.
   */
  readonly directCurvaturesAt: (c1: number) => QuadrupletCurvatures | null;
  /** Σ|φᵢ,thin/(nᵢ−1)|, the curvature span the bending scan is measured in. */
  readonly bendingSpan: number;
  /** The bending that minimizes max|cₖ| — § 6at.6's shallowest lens, and the scan's centre. */
  readonly shallowestBending: number;
}

/**
 * The aperture refusal, `TripletApertureRefusal`'s counterpart and kept a
 * distinct type for the same reason: it fires when the scan finds a bending that
 * nulls S_I but is not a surface at this aperture, and the fix is to slow the
 * focal ratio rather than to change the glass. Finding NOTHING is a fact about
 * the glasses at this conjugate and stays an ordinary `Error`.
 */
export class QuadrupletApertureRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuadrupletApertureRefusal";
  }
}

/**
 * The solve did not reach a quadruplet at this bending. As for the triplet
 * (`TripletBendingUndefined`) this says the SOLVER did not converge and NOT that
 * no such quadruplet exists — and here there is a second reason to keep the
 * distinction: the continuation walks a branch from the thin lens, so a bending
 * it does not reach may be one where that branch turns back rather than one
 * where no design lives. The scan treats an unreached bending as a hole and
 * declines to bracket across it, exactly as § 6ar.3 requires.
 */
export class QuadrupletBendingUndefined extends Error {
  readonly bending: number;
  constructor(bending: number, message: string) {
    super(message);
    this.name = "QuadrupletBendingUndefined";
    this.bending = bending;
  }
}

/**
 * Gauss-Jordan with partial pivoting on an n×n. Returns null rather than
 * throwing when a pivot vanishes, for `solve3x3`'s reason: the glass split reads
 * that as an argument error and the Newton step reads it as "this bending is not
 * a design", so neither gets to impose its reading here.
 */
function solveLinear(rows: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  const M = rows.map((r, i) => [...r, rhs[i]!]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k]![i]!) > Math.abs(M[p]![i]!)) p = k;
    [M[i], M[p]] = [M[p]!, M[i]!];
    const pivot = M[i]![i]!;
    if (!Number.isFinite(pivot) || pivot === 0) return null;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k]![i]! / pivot;
      for (let j = i; j <= n; j++) M[k]![j]! -= factor * M[i]![j]!;
    }
  }
  const x = M.map((row, i) => row[n]! / row[i]!);
  return x.every(Number.isFinite) ? x : null;
}

/** Paraxial EFL of a group, from the public paraxial trace and nothing else. */
const groupEfl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/**
 * Sag of a sphere of curvature c at radius y — `designs/achromat`'s, for the
 * edge-thickness check. NaN where the sphere does not reach y at all, which the
 * caller reads as "not a solid" rather than as an error.
 */
const sagAt = (c: number, y: number): number => (c * y * y) / (1 + Math.sqrt(1 - c * c * y * y));

export function cementedQuadrupletForm(
  spec: CementedQuadrupletFormSpec,
): CementedQuadrupletForm {
  const D = spec.apertureMm;
  const f = spec.focalLengthMm;
  if (!(D > 0) || !Number.isFinite(D)) {
    throw new Error("cementedQuadrupletForm: aperture must be a positive finite length");
  }
  if (!(f > 0) || !Number.isFinite(f)) {
    throw new Error("cementedQuadrupletForm: focal length must be a positive finite length");
  }
  const media = spec.media ?? (["N-BK7", "F2", "CAF2", "FUSED-SILICA"] as const);
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const fourthLineNm = spec.fourthLineNm ?? LINE_G;
  if (!(fourthLineNm > 0) || !Number.isFinite(fourthLineNm)) {
    throw new Error("cementedQuadrupletForm: the fourth united line must be a positive wavelength");
  }
  const thicknessesMm = spec.thicknessesMm ?? ([1.6, 1.2, 1.2, 1.2] as const);
  if (!thicknessesMm.every((t) => t > 0 && Number.isFinite(t))) {
    throw new Error("cementedQuadrupletForm: element thicknesses must be positive and finite");
  }
  const continuationSteps = spec.continuationSteps ?? CONTINUATION_STEPS;
  if (!Number.isInteger(continuationSteps) || continuationSteps < 1) {
    throw new Error("cementedQuadrupletForm: continuationSteps must be a positive integer");
  }
  if (new Set(media).size !== 4) {
    throw new Error(
      `cementedQuadrupletForm: the four glasses must be distinct (got ${media.join("/")}) — a repeated glass makes two of the four colour rows dependent`,
    );
  }
  const unitedLinesNm = [fourthLineNm, LINE_F, LINE_D, LINE_C] as const;
  if (new Set(unitedLinesNm).size !== 4) {
    throw new Error(
      `cementedQuadrupletForm: the fourth united line must differ from F, d and C (got ${fourthLineNm} nm)`,
    );
  }

  const glasses = media.map((name) => {
    const m = getMedium(name);
    const nD = m.n(designWavelengthNm);
    if (!(nD > 1)) throw new Error(`cementedQuadrupletForm: ${name} must have index > 1`);
    const nF = m.n(LINE_F);
    const nC = m.n(LINE_C);
    if (!(Math.abs(nF - nC) > 0)) {
      throw new Error(
        `cementedQuadrupletForm: ${name} has no dispersion between the F and C lines, so it cannot take part in a colour split`,
      );
    }
    return {
      medium: m,
      nD,
      V: abbeNumber(m),
      P: (m.n(LINE_D) - nC) / (nF - nC),
      Pg: (m.n(fourthLineNm) - nF) / (nF - nC),
    };
  });
  const four = <T,>(xs: readonly T[]): readonly [T, T, T, T] => xs as unknown as [T, T, T, T];
  const indices = four(glasses.map((g) => g.nD));
  const abbeNumbers = four(glasses.map((g) => g.V));
  const partialDispersions = four(glasses.map((g) => g.P));
  const secondPartialDispersions = four(glasses.map((g) => g.Pg));

  // THE EXTERNAL NUMBER, in § 6at's general form: Σφᵢ = φ, and one row per
  // united line against the reference line C. At m = 3 and F, d, C these rows
  // are the classical Σφ/V = 0 and ΣφP/V = 0 row-scaled, which is what § 6at.1
  // pins to `cementedTripletForm`'s Cramer solve over all sixty triples.
  const phi = 1 / f;
  const k = (g: { medium: { n: (nm: number) => number }; nD: number }, nm: number): number =>
    (g.medium.n(nm) - 1) / (g.nD - 1);
  const reference = unitedLinesNm[3];
  const rows: number[][] = [glasses.map(() => 1)];
  for (let j = 0; j < 3; j++) {
    rows.push(glasses.map((g) => k(g, unitedLinesNm[j]!) - k(g, reference)));
  }
  const split = solveLinear(rows, [phi, 0, 0, 0]);
  if (split === null) {
    // Exactly singular, which needs two glasses to coincide to the last bit in
    // every dispersion the rows read. Near-singular is NOT this: it solves, and
    // what it costs is reported as `conditioning`.
    throw new Error(
      `cementedQuadrupletForm: ${media.join("/")} makes the four-glass system exactly singular — two of the glasses are indistinguishable across g, F, d and C`,
    );
  }
  const thinElementPowers = four(split);
  const conditioning = Math.max(...thinElementPowers.map((p) => Math.abs(p / phi)));

  const frontClearRadius = (D / 2) * 1.005;
  const rearClearRadius = (D / 2) * 1.02;

  /** The stack at a thickness FRACTION, which is what the continuation walks. */
  const buildAt = (cs: QuadrupletCurvatures, lastMm: number, scale: number): Prescription => ({
    surfaces: cs.map((c, i): SurfaceSpec => ({
      kind: "refract",
      curvature: c,
      semiAperture: i === 0 ? frontClearRadius : rearClearRadius,
      thickness: i < 4 ? thicknessesMm[i]! * scale : lastMm,
      medium: i < 4 ? media[i]! : "AIR",
      ...(i === 0 ? { isStop: true as const } : {}),
    })),
  });

  const build = (cs: QuadrupletCurvatures, lastMm: number): Prescription => buildAt(cs, lastMm, 1);

  /**
   * Four residuals — the focal length at d, and λ₄, F and C each against d — in
   * the four trailing curvatures. `designs/apochromat`'s two details are kept
   * verbatim and for its reasons: the finite-difference step is RELATIVE, so the
   * Jacobian cannot go singular for a floating-point reason, and the step is
   * damped by backtracking on the residual norm, which is what buys reach.
   */
  const residualAt = (c1: number, w: readonly number[], scale: number): number[] | null => {
    const p = buildAt([c1, w[0]!, w[1]!, w[2]!, w[3]!], 0, scale);
    const fD = groupEfl(p, designWavelengthNm);
    const r = [
      fD - f,
      groupEfl(p, unitedLinesNm[0]) - fD,
      groupEfl(p, unitedLinesNm[1]) - fD,
      groupEfl(p, unitedLinesNm[3]) - fD,
    ];
    return r.every(Number.isFinite) ? r : null;
  };

  const newton = (c1: number, start: readonly number[], scale: number): number[] | null => {
    let v = start.slice();
    const norm = (r: readonly number[]): number => Math.max(...r.map(Math.abs));
    const tolerance = 1e-14 * Math.max(1, f);
    for (let step = 0; step < 200; step++) {
      const r = residualAt(c1, v, scale);
      if (r === null) return null;
      if (norm(r) < tolerance) return v;
      const columns: number[][] = [];
      for (let j = 0; j < 4; j++) {
        const h = 1e-7 * Math.max(Math.abs(v[j]!), 1 / f);
        const bumped = v.slice();
        bumped[j]! += h;
        const rb = residualAt(c1, bumped, scale);
        if (rb === null) return null;
        columns.push(r.map((_, i) => (rb[i]! - r[i]!) / h));
      }
      const delta = solveLinear(
        r.map((_, i) => columns.map((col) => col[i]!)),
        r.map((x) => -x),
      );
      if (delta === null) return null;
      let lambda = 1;
      let next = v.map((x, i) => x + delta[i]!);
      let nr = residualAt(c1, next, scale);
      for (let t = 0; t < 40 && (nr === null || norm(nr) > norm(r)); t++) {
        lambda /= 2;
        next = v.map((x, i) => x + lambda * delta[i]!);
        nr = residualAt(c1, next, scale);
      }
      if (nr === null || norm(nr) >= norm(r)) return null;
      v = next;
    }
    return null;
  };

  /** The thin lens at this bending: cᵢ₊₁ = cᵢ − φᵢ/(nᵢ−1). */
  const thinStart = (c1: number): number[] => {
    const cs = [c1];
    for (let i = 0; i < 4; i++) cs.push(cs[i]! - thinElementPowers[i]! / (indices[i]! - 1));
    return cs.slice(1);
  };

  const tryCurvaturesAt = (c1: number): QuadrupletCurvatures | null => {
    if (!Number.isFinite(c1)) return null;
    let v: number[] | null = thinStart(c1);
    for (let s = 1; s <= continuationSteps; s++) {
      v = newton(c1, v, s / continuationSteps);
      if (v === null) return null;
    }
    return [c1, v[0]!, v[1]!, v[2]!, v[3]!];
  };

  const directCurvaturesAt = (c1: number): QuadrupletCurvatures | null => {
    if (!Number.isFinite(c1)) return null;
    const v = newton(c1, thinStart(c1), 1);
    return v === null ? null : [c1, v[0]!, v[1]!, v[2]!, v[3]!];
  };

  const curvaturesAt = (c1: number): QuadrupletCurvatures => {
    if (!Number.isFinite(c1)) {
      throw new Error("cementedQuadrupletForm: the bending must be finite");
    }
    const cs = tryCurvaturesAt(c1);
    if (cs === null) {
      throw new QuadrupletBendingUndefined(
        c1,
        `cementedQuadrupletForm: the thickness continuation did not reach a ${media.join("/")} quadruplet of focal length ${f} mm at bending c₁ = ${c1.toExponential(6)} — this bending is not reachable from the thin split, which is not the same as saying no such quadruplet exists`,
      );
    }
    return cs;
  };

  // The bending scan's units and centre. The span is the thin split's own
  // curvature spread; the centre is the bending that minimizes max|cₖ|, which is
  // § 6at.6's shallowest lens and the only bending the thin analysis could name.
  const offsets = [0];
  for (let i = 0; i < 4; i++) {
    offsets.push(offsets[i]! - thinElementPowers[i]! / (indices[i]! - 1));
  }
  const bendingSpan = thinElementPowers.reduce(
    (total, p, i) => total + Math.abs(p / (indices[i]! - 1)),
    0,
  );
  const shallowestBending = -(Math.max(...offsets) + Math.min(...offsets)) / 2;

  return {
    focalLengthMm: f,
    apertureMm: D,
    media,
    indices,
    abbeNumbers,
    partialDispersions,
    secondPartialDispersions,
    unitedLinesNm,
    thinElementPowers,
    conditioning,
    curvaturesAt,
    tryCurvaturesAt,
    directCurvaturesAt,
    build,
    bendingSpan,
    shallowestBending,
  };
}

/** One bending the scan found, whether or not it is a surface at this aperture. */
export interface QuadrupletBending {
  readonly bending: number;
  readonly curvatures: QuadrupletCurvatures;
  /** max|c|·(D/2) over the five surfaces. 1 is a hemisphere and is the wall. */
  readonly maxSurfaceSlope: number;
  /**
   * The smallest element edge thickness at D/2 (mm): min over the four elements
   * of `t + sag(c_{k+1}) − sag(c_k)`. Zero or less means two surfaces cross
   * before the rim and the prescription is **not a solid** — `designs/achromat`'s
   * check, which this design needs more than the doublet does (§ 6av.8).
   * `−Infinity` where a surface is deeper than hemispherical and has no sag.
   */
  readonly minEdgeMm: number;
  /** Σᵢ|S_I,ᵢ| — how violently the surfaces cancel. Reported; nothing selects on it. */
  readonly cancellation: number;
  /** Σ S_II per radian of field (mm/rad). */
  readonly comaPerRadian: number;
}

export interface SuperachromaticObjectiveSpec {
  /** Clear aperture / entrance pupil diameter (mm). */
  readonly apertureMm: number;
  /**
   * Focal ratio f/D. There is no default: the wall is at f/11 on the default
   * glasses and thicknesses (§ 6av.4), well outside anything the rest of
   * `designs/` treats as ordinary, so a caller has to state what it is asking
   * for. Faster than the wall refuses with `QuadrupletApertureRefusal`.
   */
  readonly focalRatio: number;
  readonly media?: SuperachromatGlasses;
  readonly designWavelengthNm?: number;
  /** The fourth united line (nm). Default the mercury g line. */
  readonly fourthLineNm?: number;
  readonly thicknessesMm?: readonly [number, number, number, number];
  /** Thickness-continuation depth. Default 8. */
  readonly continuationSteps?: number;
  /**
   * Distance from the last vertex to the image plane (mm). Defaults to the
   * paraxial back focal distance at the design wavelength — or, with
   * `objectDistanceMm` given, to the paraxial image distance for that object.
   */
  readonly backFocusMm?: number;
  /** Axial object distance in front of surface 0 (mm). Omitted, the bending is solved collimated. */
  readonly objectDistanceMm?: number;
  /**
   * What ΣS_I is solved TO (mm). Zero — the default — is the aplanatic-on-axis
   * quadruplet. `AchromaticObjectiveSpec.targetS1Mm`'s footgun applies: S_I ∝ h⁴,
   * so a non-zero target is only meaningful with the marginal height it is
   * evaluated at, and that height is this constructor's own D/2.
   */
  readonly targetS1Mm?: number;
}

export interface SuperachromaticObjective {
  readonly prescription: Prescription;
  /** The design target (mm) = D·F, and what the thick solve is driven to. */
  readonly focalLengthMm: number;
  /** The traced paraxial EFL at the design wavelength (mm) — the target, to solver precision. */
  readonly paraxialFocalLengthMm: number;
  readonly curvatures: QuadrupletCurvatures;
  /** Surface radii (mm) — Infinity for a flat. The design's headline numbers. */
  readonly radiiMm: QuadrupletCurvatures;
  /** The four element powers (1/mm) the THICK solve produced, by φᵢ = (nᵢ−1)(cᵢ−cᵢ₊₁). */
  readonly elementPowers: QuadrupletPowers;
  /** THE EXTERNAL NUMBER: the thin four-glass split's element powers (1/mm). */
  readonly thinElementPowers: QuadrupletPowers;
  /**
   * max|φᵢ − φᵢ,thin|/φ — how far the thick solve sits from the closed form, as a
   * fraction of the TOTAL power. **3.30 on the default lens**, against the
   * apochromatic triplet's 0.038 (§ 6ar.1): the quadruplet is not a perturbed
   * thin lens, and that is why the solve has to continue in thickness rather
   * than start at the split. It falls with the thicknesses (§ 6av.1).
   */
  readonly thinPowerGap: number;
  /** max|φᵢ,thin|/φ — the quadruple's conditioning, scale-free. 12.29 by default. */
  readonly conditioning: number;
  /**
   * Worst-case curvature tolerance amplification: max over the five surfaces of
   * |f·cₖ·(nₖ−nₖ₋₁)|, the thin-lens factor turning a RELATIVE curvature error
   * into a relative focal-length error. This is the REFOCUSABLE half; § 6av.6's
   * break-even is about the half that survives refocusing, and they are
   * different numbers (§ 6at.7's 74×).
   */
  readonly toleranceAmplification: number;
  readonly indices: QuadrupletPowers;
  readonly abbeNumbers: QuadrupletPowers;
  readonly partialDispersions: QuadrupletPowers;
  readonly secondPartialDispersions: QuadrupletPowers;
  readonly unitedLinesNm: readonly [number, number, number, number];
  /** Σ S_I at the solution (mm) — `targetS1Mm` to solver precision, by construction. */
  readonly seidelS1: number;
  readonly targetS1Mm: number;
  readonly comaPerRadian: number;
  /** The finite object conjugate the bending was solved at (mm), if any. */
  readonly objectDistanceMm?: number;
  /**
   * Every S_I root the scan found, the built one included, in the order found.
   * Length is NOT typed to one: the count is a measurement (§ 6av.3), and a lens
   * is what the constructor requires exactly one of — not a root.
   */
  readonly bendings: readonly QuadrupletBending[];
  /** The bending built (1/mm). */
  readonly bending: number;
  readonly backFocusMm: number;
  readonly thicknessesMm: readonly [number, number, number, number];
  readonly designWavelengthNm: number;
  readonly media: SuperachromatGlasses;
}

export function superachromaticObjective(
  spec: SuperachromaticObjectiveSpec,
): SuperachromaticObjective {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  if (!(D > 0) || !(F > 0) || !Number.isFinite(D) || !Number.isFinite(F)) {
    throw new Error(
      "superachromaticObjective: aperture and focal ratio must be positive and finite",
    );
  }
  const f = D * F;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const thicknessesMm = spec.thicknessesMm ?? ([1.6, 1.2, 1.2, 1.2] as const);

  const form = cementedQuadrupletForm({
    apertureMm: D,
    focalLengthMm: f,
    ...(spec.media === undefined ? {} : { media: spec.media }),
    ...(spec.fourthLineNm === undefined ? {} : { fourthLineNm: spec.fourthLineNm }),
    ...(spec.continuationSteps === undefined ? {} : { continuationSteps: spec.continuationSteps }),
    designWavelengthNm,
    thicknessesMm,
  });

  const objectDistanceMm = spec.objectDistanceMm;
  if (
    objectDistanceMm !== undefined &&
    !(objectDistanceMm > 0 && Number.isFinite(objectDistanceMm))
  ) {
    throw new Error(
      "superachromaticObjective: objectDistanceMm must be a positive finite distance",
    );
  }
  const conjugate = objectDistanceMm === undefined ? {} : { objectDistanceMm };

  const targetS1Mm = spec.targetS1Mm ?? 0;
  if (!Number.isFinite(targetS1Mm)) {
    throw new Error("superachromaticObjective: targetS1Mm must be finite");
  }

  /** ΣS_I less the target, or null where the bending is outside the family. */
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
   * Scan the bending for sign changes of S_I and bisect each, over ±3 spans about
   * the shallowest bending. Two rules are inherited from `designs/apochromat` and
   * are load-bearing here for stronger reasons than there:
   *
   *  - **A bracket is only accepted between two ADJACENT DEFINED samples**, and a
   *    bracket whose interior turns out to be unreachable is ABANDONED rather
   *    than returned (§ 6ar.3). Most of this window is not a design — the
   *    continuation reaches roughly a quarter of it — so this is the common case
   *    and not the corner one.
   *  - **Roots are filtered for being surfaces before they are counted.** Unlike
   *    the triplet, this design really does have roots that are not lenses.
   */
  const scanBendings = (): { roots: number[]; abandoned: number; defined: number } => {
    const lo = form.shallowestBending - 3 * form.bendingSpan;
    const hi = form.shallowestBending + 3 * form.bendingSpan;
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
    return { roots, abandoned, defined };
  };

  const { roots, abandoned, defined } = scanBendings();
  if (defined === 0) {
    throw new Error(
      `superachromaticObjective: no bending in ±${(3 * form.bendingSpan).toExponential(3)} of the shallowest gives a ${form.media.join("/")} quadruplet of focal length ${f} mm with ${form.unitedLinesNm.map((l) => l.toFixed(1)).join(", ")} nm united — the bending family is empty at this focal length`,
    );
  }

  const described = roots.map((c1): QuadrupletBending => {
    const cs = form.curvaturesAt(c1);
    const s = seidelSums(form.build(cs, f), designWavelengthNm, {
      marginalHeightMm: D / 2,
      fieldAngleRad: 1,
      ...conjugate,
    });
    const edges = thicknessesMm.map(
      (t, k) => t + sagAt(cs[k + 1]!, D / 2) - sagAt(cs[k]!, D / 2),
    );
    const minEdgeMm = Math.min(...edges);
    return {
      bending: c1,
      curvatures: cs,
      maxSurfaceSlope: Math.max(...cs.map((c) => Math.abs(c) * (D / 2))),
      minEdgeMm: Number.isNaN(minEdgeMm) ? -Infinity : minEdgeMm,
      cancellation: s.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0),
      comaPerRadian: s.s2,
    };
  });
  /**
   * A root is a lens when every surface is shallower than hemispherical AND every
   * element still has glass at the rim. The second half is `designs/achromat`'s
   * edge check, and until § 6av.8 this design did not make it: the four-glass
   * split wants ~12× the total power in its elements, so its cement joints are
   * far more strongly curved than a doublet's at the same focal length, and two
   * of them meet inside the clear aperture long before either passes a
   * hemisphere. The two conditions are independent — the shipped f/12 lens had
   * `maxSurfaceSlope` 0.867 and a rear element that closed at 3.6 mm of a 5 mm
   * semi-aperture — and a per-surface steepness cannot see a relation between a
   * PAIR of surfaces, which is what an edge thickness is.
   */
  const lenses = described.filter((b) => b.maxSurfaceSlope < 1 && b.minEdgeMm > 0);

  if (lenses.length !== 1) {
    /**
     * The discriminator, and it says less than `designs/apochromat`'s because it
     * knows less: THAT count of two is a fact about doublets and triplets which
     * this design does not share, so nothing here may read "not one" as "the
     * aperture is binding" unless the roots are actually there and actually too
     * steep.
     */
    const ghosts = described.filter((b) => !(b.maxSurfaceSlope < 1 && b.minEdgeMm > 0));
    const steep = ghosts.filter((b) => b.maxSurfaceSlope >= 1);
    const closed = ghosts.filter((b) => b.maxSurfaceSlope < 1 && b.minEdgeMm <= 0);
    const expected =
      targetS1Mm === 0
        ? "expected one spherical-aberration-null bending"
        : `expected one bending with ΣS_I = ${targetS1Mm.toExponential(3)} mm`;
    const aperture = ghosts.length > 0 && lenses.length === 0;
    const cause =
      described.length === 0
        ? targetS1Mm === 0
          ? `no bending of ${form.media.join("/")} the continuation reaches nulls the third-order spherical aberration at this conjugate`
          : `no bending of ${form.media.join("/")} the continuation reaches absorbs that much external spherical aberration`
        : aperture
          ? steep.length > 0 && closed.length === 0
            ? `the roots found are deeper than hemispherical (${Math.min(...steep.map((b) => b.maxSurfaceSlope)).toFixed(2)}× at the shallowest of them) and cannot be made — what is binding is the APERTURE and not the glasses, so slow the focal ratio`
            : `the roots found are shallower than hemispherical and still are not solids — the thinnest element closes ${(-Math.max(...closed.map((b) => b.minEdgeMm))).toFixed(3)} mm short of the rim at the best of them${steep.length > 0 ? `, and ${steep.length} further root${steep.length === 1 ? " is" : "s are"} past hemispherical` : ""} — what is binding is the APERTURE and not the glasses, so slow the focal ratio`
          : `${lenses.length} of the ${described.length} roots found are lenses, and this design is not known to have more than one — no input in this repo reaches this`;
    const dropped =
      abandoned > 0
        ? ` (and ${abandoned} sign change${abandoned === 1 ? "" : "s"} the solve could not narrow, its bracket straddling bendings the continuation does not reach)`
        : "";
    const message = `superachromaticObjective: ${expected}, found ${described.length}, of which ${lenses.length} ${lenses.length === 1 ? "is a lens" : "are lenses"}${dropped} — ${cause}`;
    throw aperture ? new QuadrupletApertureRefusal(message) : new Error(message);
  }

  const chosen = lenses[0]!;
  const curvatures = chosen.curvatures;

  const group = form.build(curvatures, 0);
  const marginal = paraxialTrace(group, designWavelengthNm, { y: 1, u: 0 });
  const backFocusDefault = -marginal.y / marginal.u;
  const paraxialFocalLengthMm = groupEfl(group, designWavelengthNm);
  const imageDistance =
    objectDistanceMm === undefined
      ? backFocusDefault
      : (() => {
          const r = paraxialTrace(group, designWavelengthNm, { y: 1, u: 1 / objectDistanceMm });
          return -r.y / r.u;
        })();
  const backFocusMm = spec.backFocusMm ?? imageDistance;
  if (!Number.isFinite(backFocusMm)) {
    throw new Error("superachromaticObjective: backFocusMm must be finite");
  }

  const phi = 1 / f;
  const elementPowers = [0, 1, 2, 3].map(
    (i) => (form.indices[i]! - 1) * (curvatures[i]! - curvatures[i + 1]!),
  ) as unknown as QuadrupletPowers;
  const thinPowerGap = Math.max(
    ...[0, 1, 2, 3].map((i) => Math.abs(elementPowers[i]! - form.thinElementPowers[i]!) / phi),
  );
  const stack = [1, ...form.indices, 1];
  const toleranceAmplification = Math.max(
    ...curvatures.map((c, k) => Math.abs(f * c * (stack[k + 1]! - stack[k]!))),
  );

  const prescription = form.build(curvatures, backFocusMm);
  const solved = seidelSums(prescription, designWavelengthNm, {
    marginalHeightMm: D / 2,
    fieldAngleRad: 1,
    ...conjugate,
  });

  return {
    prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm,
    curvatures,
    radiiMm: curvatures.map((c) => (c === 0 ? Infinity : 1 / c)) as unknown as QuadrupletCurvatures,
    elementPowers,
    thinElementPowers: form.thinElementPowers,
    thinPowerGap,
    conditioning: form.conditioning,
    toleranceAmplification,
    indices: form.indices,
    abbeNumbers: form.abbeNumbers,
    partialDispersions: form.partialDispersions,
    secondPartialDispersions: form.secondPartialDispersions,
    unitedLinesNm: form.unitedLinesNm,
    seidelS1: solved.s1,
    targetS1Mm,
    comaPerRadian: chosen.comaPerRadian,
    ...(objectDistanceMm === undefined ? {} : { objectDistanceMm }),
    bendings: described,
    bending: chosen.bending,
    backFocusMm,
    thicknessesMm,
    designWavelengthNm,
    media: form.media,
  };
}
