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
  /** What was perturbed — a bare surface edit seen as the one-edit group it is. */
  readonly group: PerturbationGroup;
  /** How many pupil samples survived vignetting on BOTH sides of the difference. */
  readonly pointsRetained: number;
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
  /** The pupil coordinate, so contributions can be intersected onto one support. */
  readonly key: string;
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
    const key = pointKey(s.px, s.py);
    const n = ref.nomByKey.get(key);
    if (n !== undefined) pts.push({ px: s.px, py: s.py, d: s.waves - n, key });
  }
  return pts;
}

/**
 * The points every one of `sets` retained. Perturbations vignette the pupil
 * differently — a decentre clips one rim, a tilt the other — and variances add
 * exactly only over a COMMON support, which is the whole justification for the
 * linear projection. Without this, an RSS that disagrees with the combined trace
 * has a third possible explanation and stops being a measurement of correlation.
 */
function commonSupport(sets: readonly (readonly DeltaPoint[])[]): Set<string> {
  if (sets.length === 0) return new Set();
  let keep = new Set(sets[0]!.map((p) => p.key));
  for (const s of sets.slice(1)) {
    const here = new Set(s.map((p) => p.key));
    keep = new Set([...keep].filter((k) => here.has(k)));
  }
  return keep;
}

const onSupport = (pts: readonly DeltaPoint[], keep: Set<string>): DeltaPoint[] =>
  pts.filter((p) => keep.has(p.key));

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
  pert: Contributor,
  opts: ToleranceOptions = {},
): Sensitivity {
  const group = asGroup(pert);
  const ref = reference(nominal, opts);
  const pts = deltaAgainstReference(nominal, group.perturbations, ref);

  const sigmaWaves = residualRms(pts, [one, bx, by, brho2]);
  const sigmaBeforeFocusWaves = residualRms(pts, [one, bx, by]);

  // Physical refocus: the perturbed system at ITS OWN best focus.
  const perturbedSys: OpticalSystem = {
    ...nominal,
    prescription: applyPerturbations(nominal.prescription, group.perturbations),
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
    const key = pointKey(s.px, s.py);
    const n = ref.nomByKey.get(key);
    if (n !== undefined) ptsOwn.push({ px: s.px, py: s.py, d: s.waves - n, key });
  }
  const physicalRefocusWaves = residualRms(ptsOwn, [one, bx, by]);

  const d0 = chiefExitDir(nominal, ref.field, ref.wl);
  const d1 = chiefExitDir(perturbedSys, ref.field, ref.wl);
  const boresightRad = Math.acos(Math.min(1, Math.max(-1, dot(d0, d1))));

  return {
    group,
    pointsRetained: pts.length,
    sigmaWaves,
    sigmaBeforeFocusWaves,
    physicalRefocusWaves,
    boresightRad,
  };
}

export interface ContributionRow {
  readonly group: PerturbationGroup;
  /** This contributor's blur currency in isolation (waves), on the common support. */
  readonly sigmaWaves: number;
  /** Points this contributor kept on its OWN support, before the intersection. */
  readonly pointsOwn: number;
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
  /**
   * Pupil samples every row and the combined trace all kept — the ONE support
   * every σ above is computed on. Variances add exactly only over a common
   * support, so without this a gap between `rssWaves` and `combinedWaves` has a
   * third explanation and is no longer a measurement of correlation.
   */
  readonly pointsRetained: number;
  /** Worst row's loss to the intersection: its own support minus the common one. */
  readonly pointsDropped: number;
}

/**
 * A tolerance budget: each perturbation's blur in isolation, their RSS (the
 * independent-modes estimate), and the true combined blur from a single trace
 * with everything applied at once. Comparing `rssWaves` to `combinedWaves` is
 * the honest test of whether the budget's independence assumption holds.
 */
export function toleranceBudget(
  nominal: OpticalSystem,
  perts: readonly Contributor[],
  opts: ToleranceOptions = {},
): ToleranceBudget {
  const ref = reference(nominal, opts);
  const groups = perts.map(asGroup);
  const own = groups.map((g) => deltaAgainstReference(nominal, g.perturbations, ref));
  const combinedPts = deltaAgainstReference(
    nominal,
    groups.flatMap((g) => g.perturbations),
    ref,
  );
  const keep = commonSupport([...own, combinedPts]);
  const contributions = groups.map((group, i): ContributionRow => ({
    group,
    sigmaWaves: residualRms(onSupport(own[i]!, keep), [one, bx, by, brho2]),
    pointsOwn: own[i]!.length,
  }));
  const rssWaves = Math.sqrt(
    contributions.reduce((a, c) => a + c.sigmaWaves ** 2, 0),
  );
  const combinedWaves = residualRms(onSupport(combinedPts, keep), [one, bx, by, brho2]);
  const strehlMarechal = Math.exp(-((2 * Math.PI * combinedWaves) ** 2));
  return {
    contributions,
    rssWaves,
    combinedWaves,
    strehlMarechal,
    pointsRetained: keep.size,
    pointsDropped: Math.max(0, ...contributions.map((c) => c.pointsOwn - keep.size)),
  };
}

/* ───────────────────────── element-level tolerances (§ 6au) ─────────────────
 *
 * Everything above perturbs ONE surface record, and a surface record is not a
 * manufacturing error. The frame chain is cumulative — `frame_{i+1} =
 * surfaceFrame_i ∘ T(0,0,tᵢ)` — so decentring surface *i* slides every surface
 * after it sideways with it, and tilting surface *i* swings the whole downstream
 * chain. That is the right model for a misaligned *group* (it is what § 5t's
 * Newtonian-diagonal rung measures) and the wrong one for the two errors a shop
 * actually quotes:
 *
 *  - **centring** — surface *k*'s centre of curvature displaced from the axis
 *    the other surfaces share (indicator runout), everything else where it was;
 *  - **wedge** — surface *k* tilted about its own vertex, everything else where
 *    it was.
 *
 * Both are *local*: the rest of the lens, and the image plane, must not move. So
 * each is a GROUP of surface edits — the error, plus the edit on the next
 * surface that puts the chain back — and the group is one contributor to the
 * budget, never two. The compensation is exact, not first-order, and it is
 * derived rather than fitted:
 *
 *     surfaceFrame_{k+1} = F·R(α)·T(t′ẑ)·T_d·R(−α)  =  F·T(R(α)(t′ẑ + d))
 *
 * so restoring it to the nominal `F·T(tẑ)` needs `t′ẑ + d = R(−α)(tẑ)`, and with
 * `d` confined to the transverse plane (a `SurfaceSpec` has no axial decenter)
 * that is `t′ = t·cos α` and `d_y = t·sin α`. A wedge is therefore FOUR edits:
 * tilt +α on *k*, its own thickness by `t(cos α − 1)`, tilt −α on *k+1*, and
 * `d_y = t sin α` on *k+1*. Centring is two: `+δ` on *k*, `−δ` on *k+1*.
 *
 * `restoresChain` is the invariant that pins this: every compiled frame from
 * *k+1* on must be the nominal one, to rounding.
 *
 * ## Wedge and centring are ONE degree of freedom on a sphere
 *
 * A sphere is fixed by its centre and its radius. Tilting by α about the vertex
 * leaves the vertex and moves the centre to `(0, −R sin α, R cos α)`; decentring
 * by δ moves it to `(0, δ, R)`. Same radius, same centre when `δ = −R sin α`:
 * the SAME SURFACE. So counting a wedge and a centring error as two independent
 * tolerances double-counts one freedom, and a cemented triplet has four centring
 * freedoms and not eight. Two things survive the equality and are measured, not
 * assumed: the centre's axial offset `R(cos α − 1)`, and the clear aperture,
 * which is cut about the vertex and so about a *different* point in the two
 * realizations. The degeneracy is a property of SPHERICITY — a plane has no
 * decentre equivalent (δ = −R sin α diverges) and a conic breaks it — which is
 * why the equality is pinned on the chief ray, where the rim cannot reach it.
 *
 * ## The rear surface needs somewhere to put the compensation
 *
 * The last surface has no successor to restore the chain on, and the only thing
 * downstream of it is the image plane. `withTrailingReference` appends a plane
 * air–air surface at the last vertex — optically nothing, and pinned to be
 * nothing — purely so the rear surface's centring and wedge have a carrier.
 */

/** The unit a tolerance is quoted in. `relative` = a fraction of the nominal. */
export type ToleranceUnit = "relative" | "mm" | "deg";

/**
 * One manufacturing error, expressed as the surface edits that realize it. It
 * is ONE contributor to a budget however many edits it takes.
 */
export interface PerturbationGroup {
  /** What the error is, for a budget row. */
  readonly label: string;
  /** The error's size in its own unit — the number a drawing carries. */
  readonly magnitude: number;
  readonly unit: ToleranceUnit;
  /** The error plus whatever restores the chain after it. */
  readonly perturbations: readonly Perturbation[];
}

/** A budget row is either a bare surface edit (§ 5t) or a group (§ 6au). */
export type Contributor = Perturbation | PerturbationGroup;

const isGroup = (c: Contributor): c is PerturbationGroup =>
  (c as PerturbationGroup).perturbations !== undefined;

/** A bare `Perturbation` seen as the one-edit group it is. */
export function asGroup(c: Contributor): PerturbationGroup {
  if (isGroup(c)) return c;
  return {
    label: `surface ${c.surface} ${c.target}`,
    magnitude: c.delta,
    unit: c.target === "tiltX" || c.target === "tiltY" ? "deg" : "mm",
    perturbations: [c],
  };
}

const need = (p: Prescription, k: number, what: string): SurfaceSpec => {
  const s = p.surfaces[k];
  if (!s) throw new Error(`${what}: surface ${k} out of range`);
  return s;
};

const needCarrier = (p: Prescription, k: number, what: string): void => {
  if (k >= p.surfaces.length - 1) {
    throw new Error(
      `${what}: surface ${k} is the last, so nothing downstream can carry the ` +
        `compensation — wrap the prescription in withTrailingReference() first`,
    );
  }
};

/**
 * A plane air–air surface appended AT THE IMAGE PLANE, so the rear surface has a
 * successor to restore the chain on. Same medium either side, so it refracts
 * nothing and reflects nothing, and it takes zero thickness, so the image plane
 * stays exactly where the prescription put it. Optically a no-op, and § 6au pins
 * that rather than asserting it.
 *
 * It goes at the image plane and not at the last vertex because a surface with
 * sag reaches PAST its own vertex: a reference plane there is behind the ray's
 * intersection point at the rim, and the trace misses it.
 */
export function withTrailingReference(p: Prescription): Prescription {
  const n = p.surfaces.length;
  const last = need(p, n - 1, "withTrailingReference");
  if (last.kind !== "refract") {
    throw new Error("withTrailingReference: the last surface must be refractive");
  }
  return {
    ...p,
    surfaces: [
      ...p.surfaces,
      {
        kind: "refract",
        curvature: 0,
        semiAperture: Infinity,
        thickness: 0,
        medium: last.medium ?? "AIR",
      },
    ],
  };
}

/**
 * A RELATIVE curvature error on one surface — § 6ar.6's and § 6at's parameter,
 * `c → c(1+ε)`, so the number is scale-free and comparable across designs. No
 * compensation: a curvature error moves nothing but its own surface's shape.
 */
export function curvatureError(
  p: Prescription,
  surface: number,
  relative: number,
): PerturbationGroup {
  const s = need(p, surface, "curvatureError");
  if (s.curvature === 0) {
    throw new Error(`curvatureError: surface ${surface} is plane — a relative error is undefined`);
  }
  return {
    label: `c${surface + 1}`,
    magnitude: relative,
    unit: "relative",
    perturbations: [{ surface, target: "curvature", delta: s.curvature * relative }],
  };
}

/** A centre-thickness (or airspace) error. Nothing downstream needs restoring:
 * the whole point of the error is that the rest of the lens moves. */
export function thicknessError(
  p: Prescription,
  surface: number,
  deltaMm: number,
): PerturbationGroup {
  need(p, surface, "thicknessError");
  return {
    label: `t${surface + 1}`,
    magnitude: deltaMm,
    unit: "mm",
    perturbations: [{ surface, target: "thickness", delta: deltaMm }],
  };
}

/**
 * A CENTRING error: surface `surface` displaced by `deltaMm` in +y, every other
 * surface and the image plane left where they were. Two edits, exact.
 */
export function centringError(
  p: Prescription,
  surface: number,
  deltaMm: number,
): PerturbationGroup {
  return { ...groupDecentre(p, surface, surface, deltaMm), label: `centring s${surface + 1}` };
}

/**
 * Surfaces `first`…`last` displaced together by `deltaMm` in +y, everything
 * outside them — including the image plane — left where it was. A whole
 * air-spaced element or cell, where `centringError` is the one-surface case.
 *
 * On a CEMENTED stack this is not the parameter to reach for: a joint belongs to
 * two elements at once, so "which element moved" is not a question the surface
 * list can answer, and per-surface centring is what a drawing quotes anyway.
 */
export function groupDecentre(
  p: Prescription,
  first: number,
  last: number,
  deltaMm: number,
): PerturbationGroup {
  need(p, first, "groupDecentre");
  need(p, last, "groupDecentre");
  if (last < first) throw new Error("groupDecentre: last is before first");
  needCarrier(p, last, "groupDecentre");
  return {
    label: `decentre s${first + 1}–s${last + 1}`,
    magnitude: deltaMm,
    unit: "mm",
    perturbations: [
      { surface: first, target: "decenterY", delta: deltaMm },
      { surface: last + 1, target: "decenterY", delta: -deltaMm },
    ],
  };
}

/**
 * A WEDGE: surface `surface` tilted by `alphaDeg` about its own vertex (about
 * +x, so it acts in the same y–z meridian `centringError` does), every other
 * surface and the image plane left where they were. Four edits, exact — see the
 * derivation in this section's header.
 */
export function wedgeError(
  p: Prescription,
  surface: number,
  alphaDeg: number,
): PerturbationGroup {
  const s = need(p, surface, "wedgeError");
  needCarrier(p, surface, "wedgeError");
  const a = (alphaDeg * Math.PI) / 180;
  const t = s.thickness;
  return {
    label: `wedge s${surface + 1}`,
    magnitude: alphaDeg,
    unit: "deg",
    perturbations: [
      { surface, target: "tiltX", delta: alphaDeg },
      { surface, target: "thickness", delta: t * (Math.cos(a) - 1) },
      { surface: surface + 1, target: "tiltX", delta: -alphaDeg },
      { surface: surface + 1, target: "decenterY", delta: t * Math.sin(a) },
    ],
  };
}

/**
 * The wedge that displaces surface `surface`'s centre of curvature by the same
 * amount `centringError(p, surface, deltaMm)` does: `δ = −R sin α`, so
 * `α = asin(−δ·c)`. Undefined on a plane, which is the degeneracy's own negative
 * control — a plane's wedge has no centring equivalent at all.
 */
export function equivalentWedgeDeg(p: Prescription, surface: number, deltaMm: number): number {
  const s = need(p, surface, "equivalentWedgeDeg");
  if (s.curvature === 0) {
    throw new Error(`equivalentWedgeDeg: surface ${surface} is plane — no centring is equivalent`);
  }
  return (Math.asin(-deltaMm * s.curvature) * 180) / Math.PI;
}

/* ─────────────────────────── the allocation (§ 6au) ────────────────────────
 *
 * A list of sensitivities is not a budget. A budget answers the shop's question
 * — *how tight does each number on the drawing have to be?* — and the classical
 * answer is the inverse-sensitivity one: pick what the finished lens is allowed
 * to lose, divide it among the parameters, and invert each parameter's slope.
 *
 * The delta wavefront is LINEAR in the perturbation (§ 5t's whole reason for
 * differencing wavefronts rather than differencing RMS), so σᵢ = kᵢ·mᵢ and one
 * probe per parameter measures kᵢ. Equal shares of the VARIANCE — not of the σ —
 * are what make the total come out right: N rows each at σ_total/√N RSS to
 * σ_total exactly. `rssWaves` coming back equal to the target is therefore an
 * arithmetic self-check and pins nothing; `combinedWaves`, one trace with every
 * parameter at its allowance, is the honest number, and the gap between them is
 * the couplings.
 *
 * Equal shares are a CHOICE, and a poor one when a parameter is cheap to hold —
 * a shop that can hit 5 µm on a thickness for free should not be told 40. What
 * equal shares buy is that no row hides behind another: the budget is then a
 * statement about the lens rather than about the allocator.
 */

/** One drawing number, and how to realize an error of a given size in it. */
export interface ToleranceParameter {
  readonly label: string;
  readonly unit: ToleranceUnit;
  /**
   * The error at size `m`, in `unit`. Must be linear in `m` to first order —
   * every builder above is, and `wedgeError`'s cos/sin are linear to O(α³).
   */
  readonly at: (m: number) => PerturbationGroup;
  /** The size the slope is measured at. Small enough to stay linear, large
   * enough to clear the wavefront's own rounding. */
  readonly probe: number;
}

export interface AllocationRow {
  readonly label: string;
  readonly unit: ToleranceUnit;
  /** kᵢ — currency spent per unit of this parameter. */
  readonly perUnit: number;
  /** The size of error this parameter is allowed: its share divided by kᵢ. */
  readonly allowance: number;
  /** target/√N — what this row is allowed to spend, in the currency's own unit. */
  readonly share: number;
  /** The currency RE-MEASURED at `allowance`, rather than extrapolated to it. */
  readonly checked: number;
  /**
   * `checked / share`. One says the slope reached where the budget sent it. Far
   * from one says the allowance left the regime the slope was measured in, and
   * the row's number is not a tolerance — it is a statement that this currency
   * does not constrain this parameter at all. The allocation cannot know that in
   * advance, so it measures rather than trusting itself.
   */
  readonly linearity: number;
}

export interface ToleranceAllocation {
  readonly rows: readonly AllocationRow[];
  /** What the finished lens is allowed to lose, in the currency's own unit. */
  readonly target: number;
  /** √(Σ shares²) — equals the target by construction; an arithmetic check. */
  readonly rss: number;
  /** ONE evaluation with every parameter at its allowance. The honest total. */
  readonly combined: number;
  /** `combined / rss`: >1 the couplings reinforce, <1 they cancel. */
  readonly couplingRatio: number;
}

/**
 * What one error costs. The default is § 5t's balanced wavefront σ — the blur
 * a focuser cannot remove — and it is not the only currency a lens is toleranced
 * in: an apochromat's whole point is a colour residual, which the wavefront at
 * ONE wavelength cannot see. § 6au runs the same allocation in both.
 */
export type ToleranceCurrency = (
  nominal: OpticalSystem,
  groups: readonly PerturbationGroup[],
) => number;

const blurCurrency =
  (opts: ToleranceOptions): ToleranceCurrency =>
  (nominal, groups) =>
    groups.length === 1
      ? sensitivity(nominal, groups[0]!, opts).sigmaWaves
      : toleranceBudget(nominal, groups, opts).combinedWaves;

/**
 * The equal-variance-share tolerance allocation: each parameter's slope measured
 * once, each given target/√N of the budget, and the whole set evaluated together.
 *
 * The allowance is a LINEAR EXTRAPOLATION from the probe, which is what an
 * inverse-sensitivity budget is. It stops meaning anything once the allowance
 * leaves the regime the slope was measured in, and `couplingRatio` is where that
 * shows: a ratio of order one says the extrapolation held, and a ratio of order
 * a thousand says the budget asked for a different lens.
 */
export function allocateEqualShare(
  nominal: OpticalSystem,
  params: readonly ToleranceParameter[],
  target: number,
  opts: ToleranceOptions = {},
  currency: ToleranceCurrency = blurCurrency(opts),
): ToleranceAllocation {
  const share = target / Math.sqrt(params.length);
  const rows = params.map((p): AllocationRow => {
    const perUnit = currency(nominal, [p.at(p.probe)]) / Math.abs(p.probe);
    const allowance = perUnit > 0 ? share / perUnit : Infinity;
    const checked = Number.isFinite(allowance) ? currency(nominal, [p.at(allowance)]) : NaN;
    return { label: p.label, unit: p.unit, perUnit, allowance, share, checked, linearity: checked / share };
  });
  const finite = rows.filter((r) => Number.isFinite(r.allowance));
  const rss = Math.sqrt(finite.reduce((a, r) => a + r.share ** 2, 0));
  const combined = currency(
    nominal,
    rows.flatMap((r, i) => (Number.isFinite(r.allowance) ? [params[i]!.at(r.allowance)] : [])),
  );
  return { rows, target, rss, combined, couplingRatio: rss > 0 ? combined / rss : 1 };
}
