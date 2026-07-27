import { Prescription, SurfaceSpec, reversePrescription } from "../trace/prescription";
import { paraxialTrace, systemProperties } from "../trace/paraxial";
import { collimatingObjectDistance, spliceModules } from "../trace/compose";
import { getMedium } from "../materials/catalog";
import { LINE_D } from "../materials/dispersion";
import { seidelSums } from "../analysis/seidel";
import { CementedDoubletForm, cementedDoubletForm } from "./achromat";
import { DEFAULT_TUBE_FOCAL_LENGTH_MM } from "./microscope";

/**
 * The Lister objective — two separated cemented doublets, and the first
 * **aplanat** in this repo.
 *
 * ## What a single doublet cannot do, and why that is a wall rather than a limit
 *
 * § 5j found that a cemented doublet's two spherical-aberration-null bendings
 * **straddle** the coma-free one: whichever root you build, S_II comes out
 * non-zero, and the two roots' comas are similar in size and opposite in sign.
 * § 6a measured the consequence on a real microscope objective — the emergent
 * marginal ray misses the sine-condition height f·sin u by 0.43%, "corrected but
 * never aplanatic". That is not a tolerance to be tightened. One free parameter
 * (the bending) can satisfy one condition, and ΣS_I = 0 has already spent it.
 *
 * Two doublets have two bendings. Two conditions:
 *
 *     ΣS_I = 0     (spherical aberration)
 *     ΣS_II = 0    (coma)
 *
 * solved **together**, on the composed six-surface chain, at the conjugates the
 * objective actually works at. That is the whole idea, and it is the same idea
 * Joseph Jackson Lister published in 1830 — he found that a doublet has a pair of
 * conjugates at which it is free of both, and built an objective from two
 * doublets each used at such a pair. HONESTLY: the historical Lister is a
 * finite-conjugate objective and predates infinity correction by a century; what
 * this module realises is Lister's *principle* — two separated doublets solved
 * together for spherical aberration and coma — inside § 6a's infinity-corrected
 * architecture, because that is the architecture the rest of the branch is built
 * on. The conjugates here are fixed by that architecture and the two bendings are
 * the freedoms; Lister fixed the lenses and moved the conjugates. Same two
 * conditions, opposite unknowns.
 *
 * ## The stop is at the front vertex, and at the solution that cannot matter
 *
 * This inherits § 6a's telecentricity deferral: a real objective puts its stop at
 * the back focal plane, which needs object-space ray aiming the engine does not
 * have, so the stop sits on the front group's own rim. The obvious objection is
 * that coma is stop-dependent — and it is. Under a shift of the stop the third-
 * order sums transform as
 *
 *     S_I* = S_I,        S_II* = S_II + E·S_I
 *
 * (Welford ch. 8, the stop-shift equations, E the shift's eccentricity
 * parameter). So **at ΣS_I = 0, ΣS_II is invariant under stop position.** The
 * coma solve is well-posed precisely *because* the two conditions are solved
 * together: had S_I been left non-zero, the coma answer would have been a
 * property of where the stop happened to sit. SCOPE: this is a third-order
 * statement. The real-ray sine-condition residual does move with the stop, and
 * the § 6d rungs read it at the stop this module builds.
 *
 * ## What is stated and what is solved
 *
 * A two-doublet objective has more freedoms than conditions, so something has to
 * be *said* rather than derived. Stated, with defaults, and echoed on the result:
 *
 *  - `powerSplit` k — the front group's share of the total power. Default 0.6.
 *  - `separationFactor` — the gap between the groups, in units of the objective's
 *    own focal length. Default 0.6.
 *  - the two orientations — which face of each doublet meets the light.
 *    **Flint-first at both**, which is § 6a's argument applied to each group in
 *    turn: a doublet whose output is collimated is the reverse of the conjugate
 *    pair `achromaticObjective` solves, so it wants turning around. It is also
 *    what the measurement prefers — it reaches NA 0.273 against crown/flint's
 *    0.206, over a much wider window of splits (§ 6d). The trade is recorded, not
 *    hidden: flint/crown is 1.3× better on axis at NA 0.20 and reaches less far.
 *
 * Solved: the two bendings, and with them the specimen plane, the glass
 * diameters and the power scale. The defaults are not an optimum — § 6d pins
 * that the joint solve holds across k ∈ [0.3, 0.8] and separations from 0.2 to
 * 1.6·f, **with a genuine hole at k = 0.7 where no sane root exists**, and which
 * orientation pair wins on cancellation is itself k-dependent. So the aplanat is
 * a property of the form over a range of splits, not of a lucky pick; making the
 * split an argmin over a grid would have made the published numbers artifacts of
 * the grid's bounds instead.
 *
 * ## How the joint root is found, and why not by Newton alone
 *
 * `achromaticObjective` scans its bending for sign changes and bisects, so that
 * "how many solutions are there?" stays a question with an answer — and for some
 * glass pairs the answer is *none*, which is a fact about the glasses worth
 * saying out loud. The same discipline in two dimensions: a coarse grid over
 * both bendings, cells where **both** sums change sign, a damped 2D Newton in
 * each, then the sanity filter (no surface hemispherical or steeper, no cement
 * with a negative edge). Every surviving root is reported in `roots`; the one
 * built is the one whose surfaces cancel least violently, Σᵢ|S_I,ᵢ| over all six
 * — the 2D generalisation of § 5j's branch criterion, and a third-order proxy
 * for the fifth-and-higher orders the solve does not model.
 *
 * A bare Newton from one guess would land somewhere and say nothing about what
 * it skipped.
 *
 * ## The ceiling, measured
 *
 * Two cemented doublets are not the end of the road either. § 6d finds no sane
 * joint root past NA ≈ 0.36 — identically for N-BK7/F2 and for fused
 * silica/F2, so it is a property of the FORM and not of one glass pair. That is
 * the third piece of evidence for the aplanatic front element, after § 6a's
 * F = 1/(2·NA) and § 6b's 4× sitting at f/4.1.
 */

/** Which face of a group meets the light arriving at it. */
export type GroupOrientation = "crownFirst" | "flintFirst";

export interface ListerObjectiveSpec {
  /** Nominal magnification against `tubeFocalLengthMm` (e.g. 20 for a 20×). */
  readonly magnification: number;
  /** Object-space numerical aperture n·sin u. */
  readonly numericalAperture: number;
  /** The tube lens this magnification is quoted against (mm). Default 200. */
  readonly tubeFocalLengthMm?: number;
  /**
   * The FRONT group's share of the total power. Stated, not solved — see the
   * header. Default 0.6. Must lie strictly inside (0, 1).
   */
  readonly powerSplit?: number;
  /**
   * Gap between the groups, in units of the objective's focal length. Stated.
   * Default 0.6.
   */
  readonly separationFactor?: number;
  /** Which face of the front group meets the specimen. Default flint-first. */
  readonly frontOrientation?: GroupOrientation;
  /** Which face of the rear group meets the beam from the front. Default flint-first. */
  readonly rearOrientation?: GroupOrientation;
  readonly crownMedium?: string;
  readonly flintMedium?: string;
  readonly designWavelengthNm?: number;
  /**
   * Glass semi-aperture as a multiple of the traced marginal ray's height in
   * that group. Default 1.15. Unlike a telescope objective's, neither group here
   * sees a collimated beam of known diameter — the front group sits in the
   * specimen's diverging cone and the rear group in whatever the front leaves —
   * so both are sized from the trace and the `lost` count is what checks it.
   */
  readonly glassMarginFactor?: number;
}

/** One joint root of (ΣS_I, ΣS_II) = (0, 0), with what distinguishes it. */
export interface ListerJointRoot {
  readonly frontBending: number;
  readonly rearBending: number;
  /**
   * Σᵢ|S_I,ᵢ| over all six surfaces — how violently the design reaches zero by
   * cancellation, and what picks between roots. See the header.
   */
  readonly cancellation: number;
  /** max|c|·h over the six surfaces — the steepness the criterion tracks. */
  readonly maxSurfaceSlope: number;
}

export interface ListerObjective {
  /**
   * The objective alone, authored **specimen-side first**, trailing thickness 0.
   * Exactly one stop flag, on surface 0 — the front group's own rim.
   */
  readonly prescription: Prescription;
  /** f_tube / M (mm) — the focal length the nominal magnification implies. */
  readonly focalLengthMm: number;
  /** Traced paraxial EFL at the design wavelength (mm). Solved onto `focalLengthMm`. */
  readonly paraxialFocalLengthMm: number;
  /**
   * Solved specimen plane: surface 0's vertex to the object, in front of it (mm)
   * — the front focal distance, so the objective's output is collimated.
   */
  readonly objectDistanceMm: number;
  /**
   * Aperture stop semi-diameter (mm): s·tan u from the solved specimen plane, the
   * cone that actually delivers NA at the front vertex. § 6a's finding, unchanged
   * — it is NOT the sine-condition height f·sin u.
   */
  readonly stopRadiusMm: number;
  /** Front group vertex → rear group vertex (mm) = `separationFactor`·f. */
  readonly separationMm: number;
  /** Thin-lens focal lengths the power split and separation imply (mm). */
  readonly frontFocalLengthMm: number;
  readonly rearFocalLengthMm: number;
  /** Glass diameters the trace demanded (mm). */
  readonly frontApertureMm: number;
  readonly rearApertureMm: number;
  /**
   * ΣS_I and ΣS_II (mm) of the built objective at the conjugates it is used at.
   * Zero to solver precision — and **readouts**, computed on the final chain
   * after the fixed point closes, not the values the solve was handed.
   */
  readonly seidelS1: number;
  readonly seidelS2: number;
  /** Σᵢ|S_I,ᵢ| of the built design — the scale the two zeros are zero against. */
  readonly cancellation: number;
  /** The bendings actually built (1/mm), after the geometry fixed point closed. */
  readonly frontBending: number;
  readonly rearBending: number;
  /**
   * Every sane joint root of the **seed** geometry, least-cancelling first — what
   * the scan found and what it passed over. The first is the one carried into the
   * fixed point, but it is not the built design: the geometry moves underneath it
   * and the bendings are re-polished, so `frontBending`/`rearBending` are what was
   * made and these are the record of the search.
   */
  readonly roots: readonly ListerJointRoot[];
  readonly powerSplit: number;
  readonly separationFactor: number;
  readonly frontOrientation: GroupOrientation;
  readonly rearOrientation: GroupOrientation;
  readonly numericalAperture: number;
  readonly tubeFocalLengthMm: number;
  readonly designWavelengthNm: number;
}

/** Sag of a sphere of curvature c at radius r. */
const sag = (c: number, r: number): number => {
  if (!Number.isFinite(r)) return 0;
  const d = 1 - c * c * r * r;
  if (d <= 0) return c * r * r;
  return (c * r * r) / (1 + Math.sqrt(d));
};

/** Marginal-ray height at every surface, for a ray entering surface 0 at (y, u). */
function surfaceHeights(
  p: Prescription,
  wavelengthNm: number,
  y0: number,
  u0: number,
): number[] {
  let n = getMedium(p.objectMedium ?? "AIR").n(wavelengthNm);
  let y = y0;
  let u = u0;
  const ys: number[] = [];
  for (const s of p.surfaces) {
    ys.push(y);
    const n2 = Math.sign(n) * getMedium(s.medium!).n(wavelengthNm);
    u = (n * u - y * s.curvature * (n2 - n)) / n2;
    n = n2;
    y = y + u * s.thickness;
  }
  return ys;
}

export function listerObjective(spec: ListerObjectiveSpec): ListerObjective {
  const M = spec.magnification;
  const NA = spec.numericalAperture;
  if (!(M > 0)) throw new Error("listerObjective: magnification must be positive");
  if (!(NA > 0) || NA >= 1) {
    throw new Error("listerObjective: a dry objective's NA must lie in (0, 1)");
  }
  const tubeFocalLengthMm = spec.tubeFocalLengthMm ?? DEFAULT_TUBE_FOCAL_LENGTH_MM;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const k = spec.powerSplit ?? 0.6;
  if (!(k > 0) || !(k < 1)) {
    throw new Error("listerObjective: powerSplit is the front group's share of the power, in (0, 1)");
  }
  const separationFactor = spec.separationFactor ?? 0.6;
  if (!(separationFactor > 0)) {
    throw new Error("listerObjective: separationFactor must be positive");
  }
  const frontOrientation = spec.frontOrientation ?? "flintFirst";
  const rearOrientation = spec.rearOrientation ?? "flintFirst";
  const glassMarginFactor = spec.glassMarginFactor ?? 1.15;
  if (!(glassMarginFactor >= 1)) {
    throw new Error("listerObjective: glassMarginFactor must be at least 1");
  }
  const glasses = {
    ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
    ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
  };

  const f = tubeFocalLengthMm / M;
  const separationMm = separationFactor * f;
  const tanU = NA / Math.sqrt(1 - NA * NA);

  // Two POSITIVE groups cannot be combined to an arbitrarily short focal length.
  // With φ_A = k·P and φ_B = (1−k)·P, φ = P − d·k(1−k)·P² is a quadratic in P
  // whose maximum over P is 1/(4·d·k(1−k)) — so a total power of 1/f is
  // reachable only while
  //
  //     d · k(1−k) ≤ f/4
  //
  // and at equality the two roots merge and the pair is degenerate. This is a
  // property of the split and the separation alone, and it is checked here
  // because the alternative is the fixed point below wandering: past the limit it
  // simply has no scale to converge to, and would report a focal-length failure
  // for what is really an impossible request. At the default k = 0.6 it caps the
  // separation at 1.042·f.
  const combinationLimit = 0.25 / (k * (1 - k));
  if (!(separationFactor < combinationLimit)) {
    throw new Error(
      `listerObjective: a separation of ${separationFactor}·f cannot be combined to f at a power split of ${k} — two positive groups need separationFactor·k(1−k) < 1/4, i.e. separationFactor < ${combinationLimit.toFixed(4)} here`,
    );
  }

  /**
   * Thin-lens element focal lengths for a total power of 1/(f·scale), split k to
   * the front. From φ = φ_A + φ_B − d·φ_A·φ_B with φ_A = k·P, φ_B = (1−k)·P: a
   * quadratic in P. `scale` exists because thick groups at a finite separation do
   * not combine like thin ones — the fixed point below drives the TRACED EFL onto
   * f, and the thin-lens pair is only its seed.
   */
  const focalPair = (scale: number): { fA: number; fB: number } => {
    const A = k;
    const B = 1 - k;
    const qa = -separationMm * A * B;
    const qb = A + B;
    const qc = -1 / (f * scale);
    const P = Math.abs(qa) < 1e-14
      ? -qc / qb
      : (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa);
    return { fA: 1 / (A * P), fB: 1 / (B * P) };
  };

  /** One group at a bending: achromat's thickness rules, then the orientation. */
  const group = (
    form: CementedDoubletForm,
    c1: number,
    orientation: GroupOrientation,
  ): readonly SurfaceSpec[] => {
    const cs = form.curvaturesAt(c1);
    const D = form.apertureMm;
    const h = D / 2;
    // achromaticObjective's own rule: whatever the sags demand plus a 2%-of-
    // diameter edge, with an ordinary objective's floors. Recomputed at every
    // trial bending here rather than frozen after a first solve, because the
    // bending is what is being scanned.
    const crownMm = Math.max(0.1 * D, sag(cs[0], h) - sag(cs[1], h) + 0.02 * D);
    const flintMm = Math.max(0.06 * D, sag(cs[1], h) - sag(cs[2], h) + 0.02 * D);
    const p = form.build(cs, { crownMm, flintMm, lastMm: 0 });
    return orientation === "crownFirst" ? p.surfaces : reversePrescription(p, 0).surfaces;
  };

  /** Is this pair of bendings a lens that can be made at this geometry? */
  const buildable = (formA: CementedDoubletForm, formB: CementedDoubletForm, c1A: number, c1B: number): boolean => {
    const check = (form: CementedDoubletForm, c1: number): boolean => {
      const cs = form.curvaturesAt(c1);
      const D = form.apertureMm;
      const h = D / 2;
      if (!cs.every((c) => Math.abs(c) * h < 1)) return false;
      const crownMm = Math.max(0.1 * D, sag(cs[0], h) - sag(cs[1], h) + 0.02 * D);
      const flintMm = Math.max(0.06 * D, sag(cs[1], h) - sag(cs[2], h) + 0.02 * D);
      return (
        crownMm + sag(cs[1], h) - sag(cs[0], h) > 0 &&
        flintMm + sag(cs[2], h) - sag(cs[1], h) > 0
      );
    };
    return check(formA, c1A) && check(formB, c1B);
  };

  /**
   * The chain at a pair of bendings, for a stated geometry. Exactly one stop
   * flag: BOTH groups declare their own surface 0 as a stop (and a mirrored
   * group's travels to its last surface), so a spliced chain would otherwise
   * carry several — `seidelSums` throws unless the flagged stop is surface 0.
   * § 6a's one-aperture rule, re-applied.
   */
  const chainOf = (
    formA: CementedDoubletForm,
    formB: CementedDoubletForm,
    c1A: number,
    c1B: number,
  ): Prescription => {
    const spliced = spliceModules(
      [
        { surfaces: group(formA, c1A, frontOrientation), gapAfterMm: separationMm },
        { surfaces: group(formB, c1B, rearOrientation), gapAfterMm: 0 },
      ],
      "AIR",
    );
    return { ...spliced, surfaces: spliced.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })) };
  };

  /** ΣS_I, ΣS_II and the cancellation scale at a pair of bendings. */
  const sumsAt = (
    formA: CementedDoubletForm,
    formB: CementedDoubletForm,
    c1A: number,
    c1B: number,
  ): { s1: number; s2: number; cancellation: number; chain: Prescription; objectMm: number } | undefined => {
    const chain = chainOf(formA, formB, c1A, c1B);
    let objectMm: number;
    try {
      objectMm = collimatingObjectDistance(chain, designWavelengthNm);
    } catch {
      return undefined; // not an objective at these bendings: no front focus
    }
    if (!(objectMm > 0) || !Number.isFinite(objectMm)) return undefined;
    const h0 = objectMm * tanU;
    // Field angle 1 rad is a normalisation: S_II is linear in it, so the root of
    // S_II = 0 does not depend on the choice.
    const s = seidelSums(chain, designWavelengthNm, {
      marginalHeightMm: h0,
      objectDistanceMm: objectMm,
      fieldAngleRad: 1,
    });
    return {
      s1: s.s1,
      s2: s.s2,
      cancellation: s.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0),
      chain,
      objectMm,
    };
  };

  /** Damped 2D Newton on (ΣS_I, ΣS_II) = (0, 0). */
  const newton = (
    formA: CementedDoubletForm,
    formB: CementedDoubletForm,
    startA: number,
    startB: number,
  ): { c1A: number; c1B: number } | undefined => {
    let x = startA;
    let y = startB;
    for (let i = 0; i < 90; i++) {
      const f0 = sumsAt(formA, formB, x, y);
      if (!f0) return undefined;
      const hx = Math.max(1e-9, Math.abs(x) * 1e-6);
      const hy = Math.max(1e-9, Math.abs(y) * 1e-6);
      const fx = sumsAt(formA, formB, x + hx, y);
      const fy = sumsAt(formA, formB, x, y + hy);
      if (!fx || !fy) return undefined;
      const j11 = (fx.s1 - f0.s1) / hx;
      const j12 = (fy.s1 - f0.s1) / hy;
      const j21 = (fx.s2 - f0.s2) / hx;
      const j22 = (fy.s2 - f0.s2) / hy;
      const det = j11 * j22 - j12 * j21;
      if (!(Math.abs(det) > 0)) return undefined;
      let dx = (-f0.s1 * j22 + f0.s2 * j12) / det;
      let dy = (-j11 * f0.s2 + j21 * f0.s1) / det;
      // A cap, not a line search: the sums are steep in the bendings and an
      // undamped step can leap out of the region where the chain is an objective
      // at all, from which there is no way back.
      const cap = 0.15 * (Math.abs(x) + Math.abs(y) + 0.05);
      const mag = Math.hypot(dx, dy);
      if (mag > cap) {
        dx *= cap / mag;
        dy *= cap / mag;
      }
      x += dx;
      y += dy;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      if (Math.abs(dx) < 1e-15 * (1 + Math.abs(x)) && Math.abs(dy) < 1e-15 * (1 + Math.abs(y))) break;
    }
    return { c1A: x, c1B: y };
  };

  const formsFor = (fA: number, fB: number, DA: number, DB: number) => ({
    formA: cementedDoubletForm({
      apertureMm: DA, focalLengthMm: fA, ...glasses, designWavelengthNm, caller: "listerObjective",
    }),
    formB: cementedDoubletForm({
      apertureMm: DB, focalLengthMm: fB, ...glasses, designWavelengthNm, caller: "listerObjective",
    }),
  });

  // Seed geometry: the collimated beam's diameter for both groups, which the
  // fixed point immediately replaces with what the trace actually demands.
  let DA = 2 * f * NA;
  let DB = 2 * f * NA;
  let scale = 1;

  /** The full scan, on the seed geometry: every sane joint root, best first. */
  const scan = (): ListerJointRoot[] => {
    const { fA, fB } = focalPair(scale);
    const { formA, formB } = formsFor(fA, fB, DA, DB);
    const spanA = 3 * (Math.abs(formA.dc1) + Math.abs(formA.dc2));
    const spanB = 3 * (Math.abs(formB.dc1) + Math.abs(formB.dc2));
    const N = 24;
    const csA: number[] = [];
    const csB: number[] = [];
    for (let i = 0; i <= N; i++) csA.push(-spanA + (2 * spanA * i) / N);
    for (let j = 0; j <= N; j++) csB.push(-spanB + (2 * spanB * j) / N);
    const grid = csA.map((ca) => csB.map((cb) => sumsAt(formA, formB, ca, cb)));
    const roots: ListerJointRoot[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const cell = [grid[i]![j], grid[i]![j + 1], grid[i + 1]![j], grid[i + 1]![j + 1]];
        if (cell.some((v) => !v)) continue;
        const s1s = cell.map((v) => v!.s1);
        const s2s = cell.map((v) => v!.s2);
        // BOTH sums must change sign inside the cell. Either alone is a contour,
        // not a root.
        if (Math.min(...s1s) > 0 || Math.max(...s1s) < 0) continue;
        if (Math.min(...s2s) > 0 || Math.max(...s2s) < 0) continue;
        const hit = newton(formA, formB, 0.5 * (csA[i]! + csA[i + 1]!), 0.5 * (csB[j]! + csB[j + 1]!));
        if (!hit) continue;
        const at = sumsAt(formA, formB, hit.c1A, hit.c1B);
        if (!at) continue;
        if (!(Math.abs(at.s1) <= 1e-10 * at.cancellation)) continue;
        if (!(Math.abs(at.s2) <= 1e-10 * at.cancellation)) continue;
        if (!buildable(formA, formB, hit.c1A, hit.c1B)) continue;
        if (roots.some((r) => Math.abs(r.frontBending - hit.c1A) < 1e-7 && Math.abs(r.rearBending - hit.c1B) < 1e-7)) {
          continue;
        }
        const slopes = [
          ...formA.curvaturesAt(hit.c1A).map((c) => Math.abs(c) * (formA.apertureMm / 2)),
          ...formB.curvaturesAt(hit.c1B).map((c) => Math.abs(c) * (formB.apertureMm / 2)),
        ];
        roots.push({
          frontBending: hit.c1A,
          rearBending: hit.c1B,
          cancellation: at.cancellation,
          maxSurfaceSlope: Math.max(...slopes),
        });
      }
    }
    roots.sort((a, b) => a.cancellation - b.cancellation);
    return roots;
  };

  const roots = scan();
  if (roots.length === 0) {
    throw new Error(
      `listerObjective: no joint (ΣS_I, ΣS_II) = (0, 0) root of this form is makeable at NA ${NA} — two cemented doublets do not reach this aperture (§ 6d finds the ceiling near NA 0.36), or this split/separation/orientation admits none`,
    );
  }
  let c1A = roots[0]!.frontBending;
  let c1B = roots[0]!.rearBending;

  // The fixed point. The bendings were solved on the seed geometry; the geometry
  // that geometry implies is different, and the two have to be settled together —
  // the same alternation `finiteConjugateObjective` runs, with the expensive scan
  // done once and only the Newton repeated.
  let formA!: CementedDoubletForm;
  let formB!: CementedDoubletForm;
  let objectDistanceMm = 0;
  let prescription!: Prescription;
  // The power scale is settled by a SECANT on (traced EFL − f), not by the
  // obvious scale ← scale·f/EFL. That update assumes EFL ∝ scale, which is true
  // for one thin lens and false for two thick groups a finite distance apart: at
  // separations approaching f the thin-lens seed is far enough out that the naive
  // iteration oscillates instead of closing (measured: it stalls at EFL 8.1 mm
  // against a 5 mm target at a separation of 1.6·f). The secant does not care
  // what the relation is.
  let scalePrev = Number.NaN;
  let eflPrev = Number.NaN;
  for (let it = 0; it < 80; it++) {
    const { fA, fB } = focalPair(scale);
    ({ formA, formB } = formsFor(fA, fB, DA, DB));
    const hit = newton(formA, formB, c1A, c1B);
    if (!hit) throw new Error("listerObjective: the joint bending solve lost its root while the geometry converged");
    c1A = hit.c1A;
    c1B = hit.c1B;
    const at = sumsAt(formA, formB, c1A, c1B);
    if (!at) throw new Error("listerObjective: the chain stopped being an objective while the geometry converged");
    prescription = at.chain;
    const efl = systemProperties(prescription, designWavelengthNm).efl;
    if (!(efl > 0)) throw new Error("listerObjective: the composed groups do not form a positive objective");
    const h0 = at.objectMm * tanU;
    const ys = surfaceHeights(prescription, designWavelengthNm, h0, h0 / at.objectMm);
    const DAn = 2 * glassMarginFactor * Math.max(...ys.slice(0, 3).map(Math.abs));
    const DBn = 2 * glassMarginFactor * Math.max(...ys.slice(3).map(Math.abs));
    let scaleNext =
      Number.isFinite(scalePrev) && Math.abs(efl - eflPrev) > 0
        ? scale - ((efl - f) * (scale - scalePrev)) / (efl - eflPrev)
        : scale * (f / efl);
    // The secant is unguarded by nature; a step that lands on a non-positive or
    // wildly different scale is not a lens, and the multiplicative step is the
    // safe fallback that always points the right way.
    if (!(scaleNext > 0) || !Number.isFinite(scaleNext) || scaleNext > 5 * scale || scaleNext < 0.2 * scale) {
      scaleNext = scale * (f / efl);
    }
    scalePrev = scale;
    eflPrev = efl;
    const moved = Math.max(
      Math.abs(DAn - DA),
      Math.abs(DBn - DB),
      Math.abs(at.objectMm - objectDistanceMm),
      Math.abs(scaleNext - scale) * f,
    );
    DA = DAn;
    DB = DBn;
    scale = scaleNext;
    objectDistanceMm = at.objectMm;
    if (!(DA > 0) || !(DB > 0) || !Number.isFinite(scale)) {
      throw new Error("listerObjective: the aperture/power fixed point diverged");
    }
    if (moved < 1e-13 * (DA + DB + objectDistanceMm + f)) break;
  }

  // ANTI-CIRCULARITY. Everything above solved on a geometry that was moving. The
  // two sums are re-measured on the chain that was finally BUILT, at the
  // conjugate it is finally used at, and against the cancellation scale of its
  // own surfaces — the § 6b/6c currency. Without this a lens whose fixed point
  // had not closed would still pass every rung downstream, because the trace
  // confirms whatever it was solved for.
  const stopRadiusMm = objectDistanceMm * tanU;
  const final = seidelSums(prescription, designWavelengthNm, {
    marginalHeightMm: stopRadiusMm,
    objectDistanceMm,
    fieldAngleRad: 1,
  });
  const cancellation = final.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0);
  if (!(Math.abs(final.s1) <= 1e-9 * cancellation) || !(Math.abs(final.s2) <= 1e-9 * cancellation)) {
    throw new Error(
      `listerObjective: the aplanatic solve did not converge — ΣS_I = ${final.s1.toExponential(3)} mm, ΣS_II = ${final.s2.toExponential(3)} mm against a cancellation scale of ${cancellation.toExponential(3)} mm`,
    );
  }
  const paraxialFocalLengthMm = systemProperties(prescription, designWavelengthNm).efl;
  if (!(Math.abs(paraxialFocalLengthMm - f) <= 1e-9 * f)) {
    // Near the combination limit the two roots of the thin-lens quadratic have
    // all but merged, so the seed is barely a solution and the secant has almost
    // no curvature to work with. That is a different failure from a bad glass
    // pair or an unlucky split, and saying which one it is costs one ratio.
    const crowding = separationFactor / combinationLimit;
    throw new Error(
      `listerObjective: the power fixed point did not close — traced EFL ${paraxialFocalLengthMm.toFixed(9)} mm against a target of ${f} mm` +
        (crowding > 0.9
          ? ` (the separation is ${(100 * crowding).toFixed(1)}% of the combination limit ${combinationLimit.toFixed(4)}·f, where the two groups' powers become degenerate — shorten it)`
          : ""),
    );
  }

  const { fA, fB } = focalPair(scale);
  return {
    prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm,
    objectDistanceMm,
    stopRadiusMm,
    separationMm,
    frontFocalLengthMm: fA,
    rearFocalLengthMm: fB,
    frontApertureMm: DA,
    rearApertureMm: DB,
    seidelS1: final.s1,
    seidelS2: final.s2,
    cancellation,
    frontBending: c1A,
    rearBending: c1B,
    roots,
    powerSplit: k,
    separationFactor,
    frontOrientation,
    rearOrientation,
    numericalAperture: NA,
    tubeFocalLengthMm,
    designWavelengthNm,
  };
}

/**
 * The aplanatic conjugates of a single refracting sphere — the closed form that
 * says what "aplanatic" MEANS, externally and to all orders.
 *
 * A spherical surface of radius R between media n₁ and n₂ has one pair of
 * conjugates at which it is exactly stigmatic — not to third order, *exactly*,
 * for every ray angle — and at which it satisfies the sine condition exactly.
 * With distances signed positive to the right of the **vertex** and the standard
 * n₂/v − n₁/u = (n₂−n₁)/R,
 *
 *     u = R(n₁+n₂)/n₁      v = R(n₁+n₂)/n₂      m = n₁²/n₂²
 *
 * (Born & Wolf; Smith, *Modern Optical Engineering*. The Weierstrass points.)
 *
 * **The image is VIRTUAL**, and the sign matters enough to spell out. For the
 * case that is actually useful — a real object inside a dense medium, which is
 * an immersion objective's front element — the centre of curvature lies on the
 * OBJECT's side, so R is negative in that convention, and u and v come out
 * negative together: object and image both in front of the vertex, the image
 * further away and n₁²/n₂² times larger. `radiusMm` here is the magnitude and
 * the sign is applied, because getting it backwards produces a perfectly
 * plausible non-aplanatic surface (measured: the crossing wanders by millimetres
 * across the aperture, and rays past sin u ≈ 0.4 total-internal-reflect).
 *
 * The angles go the other way from the heights: by the Lagrange invariant
 * sin u′/sin u = n₂/n₁, so the aperture ANGLE is divided by n and the numerical
 * aperture n·sin u by n². That division is the whole trick.
 *
 * It is included here as the ladder's external DEFINITION of aplanatism — the
 * Lister is pinned by other things, and this form pins nothing about it. What it
 * does pin is the **aplanatic hyperhemisphere**, the follow-on this module's own
 * measured ceiling near NA 0.35 is the evidence for.
 */
export interface AplanaticSphere {
  /** Vertex → object, in FRONT of it (mm, positive): |R|(n₁+n₂)/n₁. */
  readonly objectDistanceMm: number;
  /**
   * Vertex → the VIRTUAL image, also in front of it (mm, positive):
   * |R|(n₁+n₂)/n₂. Nothing is focused there; the emergent rays *diverge from* it.
   */
  readonly virtualImageDistanceMm: number;
  /** Transverse magnification n₁²/n₂². */
  readonly magnification: number;
  /** sin u′/sin u = n₂/n₁ — the constant the sine condition demands. */
  readonly sineRatio: number;
  /** One surface, its centre of curvature toward the object. Trailing thickness 0. */
  readonly prescription: Prescription;
}

export function aplanaticSphere(args: {
  /** Magnitude of the radius (mm); the sign is applied here. */
  readonly radiusMm: number;
  readonly objectMedium: string;
  readonly imageMedium: string;
  readonly semiApertureMm: number;
  readonly wavelengthNm?: number;
}): AplanaticSphere {
  const R = args.radiusMm;
  if (!(R > 0)) throw new Error("aplanaticSphere: give the radius as a positive magnitude");
  const wavelengthNm = args.wavelengthNm ?? LINE_D;
  const n1 = getMedium(args.objectMedium).n(wavelengthNm);
  const n2 = getMedium(args.imageMedium).n(wavelengthNm);
  return {
    objectDistanceMm: (R * (n1 + n2)) / n1,
    virtualImageDistanceMm: (R * (n1 + n2)) / n2,
    magnification: (n1 * n1) / (n2 * n2),
    sineRatio: n2 / n1,
    prescription: {
      objectMedium: args.objectMedium,
      surfaces: [
        {
          kind: "refract",
          // Centre of curvature toward the object: the dome a real object inside
          // the glass looks out through.
          curvature: -1 / R,
          semiAperture: args.semiApertureMm,
          thickness: 0,
          medium: args.imageMedium,
          isStop: true,
        },
      ],
    },
  };
}

/** Paraxial image distance from the last vertex, for an object `s` in front. */
export function listerImageDistance(
  p: Prescription,
  objectDistanceMm: number,
  wavelengthNm: number,
): number {
  const r = paraxialTrace(p, wavelengthNm, { y: objectDistanceMm, u: 1 });
  if (!(Math.abs(r.u) > 0)) {
    throw new Error("listerImageDistance: the chain leaves the axial cone collimated");
  }
  return -r.y / r.u;
}
