import { Prescription, SurfaceSpec } from "../trace/prescription";
import { OpticalSystem, primaryWavelength } from "../trace/system";
import { PupilPoint, pupilGrid, chiefRay } from "../pupil/aiming";
import { pupils } from "../pupil/pupils";
import { opdMap } from "../pupil/opd";
import { traceRay } from "../trace/sequential";
import { Vec3, dot, normalize } from "../math/vec3";
import { bestFocus, withFocus } from "./focus";

/**
 * Tolerancing — how much the image degrades when a parameter drifts by its
 * manufacturing tolerance (docs/VALIDATION.md § 5t).
 *
 * This adds NO new physics: it is a readout composed of already-validated
 * readouts (`opdMap` → the wavefront, `bestFocus` → the focus compensator). A
 * perturbation is a one-field edit of the immutable `Prescription`; the answer
 * is a difference of two traces. What it DOES need to get right is the currency
 * — and that choice is subtle enough to be worth stating, because the obvious
 * one is wrong.
 *
 * ## Why not d(RMS)/dparameter
 *
 * The tempting sensitivity is a central difference of the total RMS wavefront.
 * It fails silently. At a corrected nominal the RMS is *stationary* in any
 * perturbation whose aberration is orthogonal to the residual already there:
 * total_RMS(δ) = √(σ₀² + δ²s²), so d(RMS)/dδ → 0 at δ = 0. A front-surface
 * decenter of the achromat — pure coma, orthogonal to its spherical residual —
 * leaves the total RMS flat to four digits while the image genuinely tilts and
 * comas. The central difference reports ≈ 0 sensitivity for a parameter that is
 * not remotely insensitive (see the kink rung in the test).
 *
 * ## The currency: σ of the *delta* wavefront, compensators removed
 *
 * The change in the wavefront, δW = W(perturbed) − W(nominal), is linear in the
 * perturbation and has no such kink. Its RMS is the sensitivity. Two of its
 * modes are not image blur but *compensators* — physical adjustments a builder
 * or a focuser removes for free:
 *
 *  - **piston + tilt** — an unobservable phase offset and a boresight shift
 *    (the image moves; you re-point or re-centre). `tilt` IS the pointing error,
 *    reported separately as `boresightRad`.
 *  - **defocus (ρ²)** — you refocus.
 *
 * So the blur currency `sigmaWaves` is the RMS of δW with {piston, tilt,
 * defocus} projected out by least squares. This is exactly the *balanced*
 * wavefront RMS the extended Maréchal Strehl uses, which is why one number feeds
 * both the RSS budget and the Strehl estimate.
 *
 * ## Linear projection, not physical refocus — and why they differ
 *
 * The compensator is a *linear projection* of ρ² out of δW, evaluated on ONE
 * common reference (the nominal's best-focus plane and pupil grid) so that the
 * deltas of independent perturbations superpose and their variances add — which
 * is what makes the RSS budget exact rather than approximate.
 *
 * It is NOT the same as physically re-running `bestFocus` on the perturbed
 * system, and the gap is instructive: ρ² and ρ⁴ are not orthogonal over the
 * disc, so a physical refocus of an *aberrated* nominal pulls its defocus with
 * the nominal's own spherical, giving a different (smaller) residual. On a
 * *perfect* nominal that cross-term vanishes and the two coincide to ~0.3% — so
 * every external rung is pinned on a perfect nominal, where the choice cannot
 * matter. The physically-refocused residual is offered as `physicalRefocusWaves`
 * for the "what a real focuser leaves" question, validated only by tracking the
 * projection on a perfect nominal (a consistency check, not a pin).
 */

/** Which surface parameter drifts. Units are the parameter's own. */
export type PerturbTarget =
  | "curvature" // 1/mm
  | "conic" // dimensionless
  | "thickness" // mm (airspace to the next vertex)
  | "tiltX" // degrees
  | "tiltY" // degrees
  | "decenterX" // mm
  | "decenterY"; // mm

export interface Perturbation {
  /** Index into `prescription.surfaces`. */
  readonly surface: number;
  readonly target: PerturbTarget;
  /** Signed change added to the current value, in the target's own unit. */
  readonly delta: number;
}

/** A copy of `p` with one surface's one parameter shifted by `delta`. Pure. */
export function applyPerturbation(p: Prescription, pert: Perturbation): Prescription {
  const { surface, target, delta } = pert;
  if (surface < 0 || surface >= p.surfaces.length) {
    throw new Error(`applyPerturbation: surface ${surface} out of range`);
  }
  const surfaces = p.surfaces.map((s, i): SurfaceSpec => {
    if (i !== surface) return s;
    switch (target) {
      case "curvature":
        return { ...s, curvature: s.curvature + delta };
      case "conic":
        return { ...s, conic: (s.conic ?? 0) + delta };
      case "thickness":
        return { ...s, thickness: s.thickness + delta };
      case "tiltX":
        return { ...s, tiltXDeg: (s.tiltXDeg ?? 0) + delta };
      case "tiltY":
        return { ...s, tiltYDeg: (s.tiltYDeg ?? 0) + delta };
      case "decenterX":
        return { ...s, decenterX: (s.decenterX ?? 0) + delta };
      case "decenterY":
        return { ...s, decenterY: (s.decenterY ?? 0) + delta };
    }
  });
  return { ...p, surfaces };
}

/** Apply several perturbations in order (they compose). Pure. */
export function applyPerturbations(
  p: Prescription,
  perts: readonly Perturbation[],
): Prescription {
  return perts.reduce(applyPerturbation, p);
}

export interface ToleranceOptions {
  /** Field to evaluate at (angle in degrees, or object height in mm). Default 0. */
  readonly fieldValue?: number;
  /** Default: the system's highest-weighted wavelength. */
  readonly wavelengthNm?: number;
  /** Pupil grid resolution across the full diameter. Default 21. */
  readonly pupilSamples?: number;
}

export interface Sensitivity {
  readonly perturbation: Perturbation;
  /**
   * The blur currency: RMS of the delta wavefront with piston, tilt AND defocus
   * removed (waves). Linear in the perturbation; feeds the RSS budget and Strehl.
   */
  readonly sigmaWaves: number;
  /**
   * RMS of the delta wavefront with only piston + tilt removed (waves) — the
   * defocus is left IN. This is the degradation *before* the focus compensator;
   * `sigmaWaves` is after. A defocus-inducing perturbation (a curvature or a
   * non-final airspace) shows a large drop between the two.
   */
  readonly sigmaBeforeFocusWaves: number;
  /**
   * RMS of the delta wavefront after a *physical* `bestFocus` refocus of the
   * perturbed system (piston + tilt removed), waves. Equals `sigmaWaves` on a
   * perfect nominal; differs on an aberrated one (see the module header). What a
   * real focuser leaves — a reported number, not the RSS currency.
   */
  readonly physicalRefocusWaves: number;
  /** Chief-ray angular deviation in world space (radians) — the pointing error. */
  readonly boresightRad: number;
}

const one = (): number => 1;
const bx = (px: number): number => px;
const by = (_px: number, py: number): number => py;
const brho2 = (px: number, py: number): number => px * px + py * py;

const pointKey = (px: number, py: number): string =>
  `${px.toFixed(6)},${py.toFixed(6)}`;

interface DeltaPoint {
  readonly px: number;
  readonly py: number;
  readonly d: number;
}

/**
 * RMS of the residual after least-squares removing `basis` from the delta
 * wavefront. Normal equations + Gaussian elimination; the basis is tiny (≤ 4).
 */
function residualRms(
  pts: readonly DeltaPoint[],
  basis: readonly ((px: number, py: number) => number)[],
): number {
  if (pts.length === 0) return 0;
  const m = basis.length;
  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const rhs = new Array(m).fill(0);
  for (const p of pts) {
    const g = basis.map((fn) => fn(p.px, p.py));
    for (let r = 0; r < m; r++) {
      rhs[r] += g[r]! * p.d;
      for (let c = 0; c < m; c++) A[r]![c]! += g[r]! * g[c]!;
    }
  }
  // Augmented system, solved in place.
  const M = A.map((row, r) => [...row, rhs[r]!]);
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const pivVal = M[col]![col]!;
    if (Math.abs(pivVal) < 1e-300) continue; // singular column: leave coeff 0
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / pivVal;
      for (let c = col; c <= m; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const coeffs = M.map((row, r) => (Math.abs(row[r]!) < 1e-300 ? 0 : row[m]! / row[r]!));
  let acc = 0;
  for (const p of pts) {
    let fit = 0;
    for (let k = 0; k < m; k++) fit += coeffs[k]! * basis[k]!(p.px, p.py);
    acc += (p.d - fit) ** 2;
  }
  return Math.sqrt(acc / pts.length);
}

/** The nominal reference every perturbation is differenced against. */
interface Reference {
  readonly wl: number;
  readonly field: number;
  readonly grid: readonly PupilPoint[];
  readonly focusOffset: number;
  readonly nomByKey: Map<string, number>;
}

function reference(nominal: OpticalSystem, opts: ToleranceOptions): Reference {
  const wl = opts.wavelengthNm ?? primaryWavelength(nominal);
  const field = opts.fieldValue ?? 0;
  const n = opts.pupilSamples ?? 21;
  const grid = pupilGrid(n);
  const focus = bestFocus(nominal, "minRmsWavefront", {
    pupilSamples: n,
    wavelengthNm: wl,
    fieldValue: field,
  });
  const nom = opdMap(withFocus(nominal, focus.offsetFromLastVertex), field, wl, grid);
  const nomByKey = new Map(nom.samples.map((s) => [pointKey(s.px, s.py), s.waves]));
  return { wl, field, grid, focusOffset: focus.offsetFromLastVertex, nomByKey };
}

/**
 * The delta wavefront of `perts` (all applied together) against the reference,
 * both traced at the SAME focus plane and grid. Points lost to vignetting on
 * either side are dropped (matched by pupil coordinate).
 */
function deltaAgainstReference(
  nominal: OpticalSystem,
  perts: readonly Perturbation[],
  ref: Reference,
): DeltaPoint[] {
  const perturbed = withFocus(
    { ...nominal, prescription: applyPerturbations(nominal.prescription, perts) },
    ref.focusOffset,
  );
  const per = opdMap(perturbed, ref.field, ref.wl, ref.grid);
  const pts: DeltaPoint[] = [];
  for (const s of per.samples) {
    const n = ref.nomByKey.get(pointKey(s.px, s.py));
    if (n !== undefined) pts.push({ px: s.px, py: s.py, d: s.waves - n });
  }
  return pts;
}

/** World-frame exit direction of the chief ray for a field point. */
function chiefExitDir(system: OpticalSystem, field: number, wl: number): Vec3 {
  const pupil = pupils(system, wl);
  const chief = chiefRay(system, pupil, field, wl);
  const res = traceRay(system.prescription, chief);
  if (res.status !== "ok" || !res.ray) {
    throw new Error(`chief ray failed (${res.status}) measuring boresight`);
  }
  return normalize(res.ray.dir);
}

/** Sensitivity of one perturbation: the delta-wavefront currency + boresight. */
export function sensitivity(
  nominal: OpticalSystem,
  pert: Perturbation,
  opts: ToleranceOptions = {},
): Sensitivity {
  const ref = reference(nominal, opts);
  const pts = deltaAgainstReference(nominal, [pert], ref);

  const sigmaWaves = residualRms(pts, [one, bx, by, brho2]);
  const sigmaBeforeFocusWaves = residualRms(pts, [one, bx, by]);

  // Physical refocus: the perturbed system at ITS OWN best focus.
  const perturbedSys: OpticalSystem = {
    ...nominal,
    prescription: applyPerturbation(nominal.prescription, pert),
  };
  const pf = bestFocus(perturbedSys, "minRmsWavefront", {
    pupilSamples: opts.pupilSamples ?? 21,
    wavelengthNm: ref.wl,
    fieldValue: ref.field,
  });
  const perAtOwnFocus = opdMap(
    withFocus(perturbedSys, pf.offsetFromLastVertex),
    ref.field,
    ref.wl,
    ref.grid,
  );
  const ptsOwn: DeltaPoint[] = [];
  for (const s of perAtOwnFocus.samples) {
    const n = ref.nomByKey.get(pointKey(s.px, s.py));
    if (n !== undefined) ptsOwn.push({ px: s.px, py: s.py, d: s.waves - n });
  }
  const physicalRefocusWaves = residualRms(ptsOwn, [one, bx, by]);

  const d0 = chiefExitDir(nominal, ref.field, ref.wl);
  const d1 = chiefExitDir(perturbedSys, ref.field, ref.wl);
  const boresightRad = Math.acos(Math.min(1, Math.max(-1, dot(d0, d1))));

  return {
    perturbation: pert,
    sigmaWaves,
    sigmaBeforeFocusWaves,
    physicalRefocusWaves,
    boresightRad,
  };
}

export interface ContributionRow {
  readonly perturbation: Perturbation;
  /** This perturbation's blur currency in isolation (waves). */
  readonly sigmaWaves: number;
}

export interface ToleranceBudget {
  readonly contributions: readonly ContributionRow[];
  /**
   * The RSS of the individual contributions, √(Σ σᵢ²) — the predicted combined
   * blur *if the modes are independent* (their delta wavefronts orthogonal).
   */
  readonly rssWaves: number;
  /**
   * The blur of all perturbations applied together and traced ONCE — the actual
   * combined delta wavefront's residual. Equals `rssWaves` for orthogonal modes;
   * larger (up to the linear sum) for correlated ones. The honest number; `rss`
   * is the estimate that assumes independence.
   */
  readonly combinedWaves: number;
  /** Maréchal Strehl of the combined blur: exp(−(2π·combinedWaves)²). */
  readonly strehlMarechal: number;
}

/**
 * A tolerance budget: each perturbation's blur in isolation, their RSS (the
 * independent-modes estimate), and the true combined blur from a single trace
 * with everything applied at once. Comparing `rssWaves` to `combinedWaves` is
 * the honest test of whether the budget's independence assumption holds.
 */
export function toleranceBudget(
  nominal: OpticalSystem,
  perts: readonly Perturbation[],
  opts: ToleranceOptions = {},
): ToleranceBudget {
  const ref = reference(nominal, opts);
  const contributions = perts.map((pert): ContributionRow => {
    const pts = deltaAgainstReference(nominal, [pert], ref);
    return { perturbation: pert, sigmaWaves: residualRms(pts, [one, bx, by, brho2]) };
  });
  const rssWaves = Math.sqrt(
    contributions.reduce((a, c) => a + c.sigmaWaves ** 2, 0),
  );
  const combinedPts = deltaAgainstReference(nominal, perts, ref);
  const combinedWaves = residualRms(combinedPts, [one, bx, by, brho2]);
  const strehlMarechal = Math.exp(-((2 * Math.PI * combinedWaves) ** 2));
  return { contributions, rssWaves, combinedWaves, strehlMarechal };
}
