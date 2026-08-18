import { makeRay } from "../trace/ray";
import { traceRay } from "../trace/sequential";
import { reversePrescription } from "../trace/prescription";
import { isPowerOfTwo } from "../math/fft";
import type { OpticalSystem } from "../trace/system";
import type { AimOptions } from "../pupil/aiming";
import type { AbbeCondenser } from "../designs/condenser";
import type { CondenserSource, SourcePoint } from "../illumination/source";
import { pupilSlopeFrame } from "./object-field";

/**
 * The condenser's cone, traced — § 6x's last deferral, second half.
 *
 * § 6af built the lens. This is the wiring: it turns an `AbbeCondenser` into the
 * `CondenserSource` an objective at a given field point is actually lit by, with
 * the condenser's own aberrations in it. § 6x could displace the cone rigidly
 * (`translateSource`) and § 6af measured that a real cone also changes shape;
 * this module is what makes the image see either.
 *
 * ## The construction, and why it runs BACKWARDS
 *
 * The obvious build is forward: sample the condenser's aperture diaphragm, and
 * for each diaphragm point solve for the ray that reaches the specimen point
 * being lit. That is what § 6af's fixture does, and it costs a bisection on the
 * aim — about ninety traces per direction — because the landing height is what
 * you are solving for.
 *
 * Run it the other way and the solve disappears. Launch from the **specimen
 * point** in a chosen direction, trace backwards through the condenser, and see
 * where the ray lands on the diaphragm. One trace, no iteration, and § 6ag.1
 * pins that it inverts the forward solve to **1e-15** — machine precision rather
 * than a bisection tolerance. So the sampling is over *directions* and the
 * diaphragm is what decides membership, which is the exact reverse of the
 * forward reading and is the same integral:
 *
 *     I(x) = ∫ |A(x; s)|² dA_diaphragm  =  ∫ |A(x; s)|² · |∂A_diaphragm/∂s| ds
 *
 * The change of variables is not a convenience. It is what makes the whole thing
 * work, and it moves the condenser's aberration out of the sample *positions*
 * and into the sample **weights** — see the finding below.
 *
 * ## What that buys: § 6p's cache SURVIVES, where § 6x's translation loses it
 *
 * `translateSource` drops `pupilLattice` and says why: an offset read off a
 * trace is not a whole number of half-steps, so the cached sum would not be the
 * uncached one. That reasoning is correct about *its* construction, which moves
 * the points.
 *
 * This one does not move them. The candidate directions are the objective
 * pupil's own frequency lattice, unshifted; the field point enters through
 * `chief` inside `pupilSlopeFrame`, which decides **which** lattice points the
 * traced mask admits and **what weight** each carries, never where any of them
 * sits. So every coordinate is an integer times one exactly representable scale,
 * `abbeImage`'s `latticeOffset` precondition holds, and a traced cone is
 * *cacheable at every field point* — including the ones where the shipped
 * rim-stopped DIN loses the cache today. That is `latticeDiskSource`'s own
 * argument about S ("the cache never needed S on the lattice … S enters through
 * the disc mask alone") applied to a mask that came off a trace instead of out
 * of a formula, and § 6ag.6 pins it.
 *
 * The deferral note predicted the opposite — *"a cone that changes shape off
 * axis is no longer one lattice"* — and it was reasoning about the forward
 * construction, where it is true. It is the change of variables that repeals it.
 *
 * **What does NOT transplant is § 6p.1's bitwise identity.** This is a different
 * quadrature of the same cone: the weights are not uniform and the mask is not
 * the disc, so a traced cone's image is not a reordering of a `diskSource`'s and
 * must not be compared to one bit for bit. Same caveat `latticeDiskSource`
 * carries for the same reason, and § 6ag.6 states it rather than leaving the
 * shared `pupilLattice` field to imply otherwise.
 *
 * ## Units: the currency is the aimer's, and getting it wrong is silent
 *
 * A traced direction arrives as an object-space **slope** off a ray, and a
 * `SourcePoint` is a normalized pupil coordinate. Converting between them by
 * dividing by `NA_c/NA_obj` — which is what `illumination/source`'s own header
 * says S is, a ratio of numerical apertures and so of *sines* — is wrong,
 * because the aimer parametrizes the pupil by a **tangent**. So the conversion
 * goes through `pupilSlopeFrame` and nothing here divides by an NA.
 *
 * The size of it, § 6ag.3: against the tangent reading the aberration-free limit
 * converges as NA³ and reaches **5e-9**; against the sine reading it floors at
 * **5e-4** and never converges at all. 0.5% at NA 0.10, and the whole point is
 * that a floor at 5e-4 looks like a converged answer. This does not redefine
 * what S means for the authored sources — `diskSource` and friends carry no
 * trace and are internally consistent — it states which currency a *traced* cone
 * is in, and § 6ag.3 pins the discrepancy as its own rung.
 *
 * ## THE FINDING: the aberration lands in the WEIGHTS
 *
 * § 6x moved the cone and § 6af measured that it also stretches. Both are
 * statements about *where* the directions are. Under the change of variables
 * above the directions do not move at all, and the whole of the condenser's
 * aberration appears as a non-uniform `dA_diaphragm/ds` — how much light each
 * direction carries, which every `CondenserSource` before this one assumed was
 * the same for all of them.
 *
 * On the shipped DIN 4×/0.10 with a matched Abbe condenser, § 6ag.4 measures the
 * Jacobian spread across the cone at **1.3% on axis** and **12.5% at 2.25 mm of
 * field**, and what that does to a grating's contrast — against the *identical*
 * point set, so the quadrature cancels exactly and only the weights differ — is
 * **+0.10% on axis and −3.4% at the field edge**, converged to three digits over
 * three refinements. That is the number this step is for.
 *
 * ## The coupling, which is one knob and not two
 *
 * § 6af deferred "patch size and source sampling are coupled" as the thing to
 * pin. They are, and § 6ag.5 finds the coupling is tighter than a trade-off: a
 * tile's object span and the source's sampling step are **both** set by
 * `pupilSamples`, in opposite directions, and their product is constant — 5.846e-3
 * mm to five digits across a 16→128 sweep on this system. So a caller cannot buy
 * a wider tile without buying a coarser cone; § 6af's own two feasibility patch
 * sizes, 0.094 mm and 0.374 mm, are `pupilSamples` 32 and 128 and nothing else.
 *
 * And the failure mode changed shape with the construction. Forward, the hazard
 * was a direction *drifting* across the patch by a fraction of a sampling step.
 * Backwards, positions do not drift: what varies across a tile is the weights,
 * smoothly, and **membership, discretely** — a lattice point near the mask edge
 * that is in the cone at one end of the tile and out at the other. That is a
 * discontinuity rather than a small error, it is 2–6% of the points on this
 * system, and § 6ag.5 measures that the fraction is *scale-invariant* in the
 * sampling step: refining the source does not reduce it, because the boundary
 * grows with the count. `condenserConeFidelity` is what reports it.
 */

/** How well a traced cone is resolved at the tile it was built for. */
export type ConeVerdict = "valid" | "coarse" | "unknown";

export interface CondenserConeFidelity {
  readonly verdict: ConeVerdict;
  /** Lattice points whose membership differs between the tile's two edges. */
  readonly membershipFlips: number;
  /** `membershipFlips` as a fraction of the cone's own point count. */
  readonly flipFraction: number;
  /** Largest relative change in a shared point's weight across the tile. */
  readonly weightDrift: number;
  readonly reason: string;
}

export interface TracedConeOptions {
  /** Frequency bins across the pupil diameter — `abbeImage`'s `pupilSamples`. */
  readonly pupilSamples: number;
  /** Lattice step, in multiples of the pupil's own frequency step. Default 1. */
  readonly stepMultiple?: number;
  /**
   * How far the diaphragm is stopped down from wide open, in [0, 1] — the
   * coherence dial S expressed as a fraction of the condenser's engraved NA.
   * Default 1.
   *
   * A fraction of the diaphragm rather than an S in pupil units, because the
   * diaphragm is the thing that physically closes and the cone's radius in pupil
   * units is a *traced* consequence of it — 1.0052 rather than 1.0 wide open on
   * the shipped pair, which is the aberration and not a rounding.
   */
  readonly apertureFraction?: number;
  /**
   * Half-width of the tile this cone is for (mm, object space). Supply it to get
   * a `fidelity` verdict; omit and the verdict is `unknown` rather than assumed
   * fine — `illumination/fidelity`'s convention, and for its reason.
   */
  readonly tileHalfWidthMm?: number;
  readonly aim?: AimOptions;
  /**
   * Pupil radii the candidate lattice must cover about the cone's centre.
   * Default 1.35, which is wider than any mask this repo has measured. The mask
   * decides membership, so a grid one ring too wide costs a dropped ring and a
   * grid one ring too narrow is silently wrong — § 6aa's asymmetry.
   */
  readonly reach?: number;
}

export interface TracedCone extends CondenserSource {
  readonly fidelity: CondenserConeFidelity;
  /** Rays traced to build it — the cost, reported rather than estimated. */
  readonly traces: number;
  /** min/max of the un-normalized Jacobian — the aberration's own size. */
  readonly weightSpread: number;
}

/**
 * The reversed condenser, and the launch geometry a back-trace needs.
 *
 * Held so a caller tiling a field pays `reversePrescription` once rather than
 * per tile. The trailing thickness is **0**, so the reversed chain's last
 * surface *is* the diaphragm and the ray's own position there is what the mask
 * reads — no propagation to a plane that would have to be located separately.
 */
export interface ReversedCondenser {
  readonly prescription: ReturnType<typeof reversePrescription>;
  readonly workingDistanceMm: number;
  readonly diaphragmRadiusMm: number;
  readonly wavelengthNm: number;
}

export function reverseCondenser(
  condenser: AbbeCondenser,
  wavelengthNm: number,
): ReversedCondenser {
  return {
    prescription: reversePrescription(condenser.prescription, 0),
    workingDistanceMm: condenser.workingDistanceMm,
    diaphragmRadiusMm: condenser.diaphragmRadiusMm,
    wavelengthNm,
  };
}

/**
 * Where a ray leaving the specimen point at object-space slope (sx, sy) lands on
 * the diaphragm — `null` if the condenser does not pass it.
 *
 * The launch sits `workingDistanceMm` in front of the reversed chain's first
 * vertex, which is the specimen plane, and the transverse slopes reverse with z
 * because the ray is travelling the other way.
 *
 * A `null` is **not** the same as "outside the diaphragm", and both are
 * exclusions the caller wants: this one is the glass vignetting the ray, and the
 * mask below is the diaphragm stopping it. The reversed chain's own stop surface
 * carries the **wide-open** semi-diameter (`reversePrescription` moves `isStop`
 * with its surface), so it clips at the engraved NA and cannot express the
 * diaphragm being closed — which is why the mask here is explicit and load-
 * bearing rather than a duplicate of what the tracer already did. § 6ag.2.
 */
export function diaphragmLanding(
  rev: ReversedCondenser,
  objectHeightMm: number,
  sx: number,
  sy: number,
): { readonly x: number; readonly y: number } | null {
  const norm = Math.hypot(sx, sy, 1);
  const ray = makeRay(
    { x: objectHeightMm, y: 0, z: -rev.workingDistanceMm },
    { x: -sx / norm, y: -sy / norm, z: 1 / norm },
    rev.wavelengthNm,
  );
  const traced = traceRay(rev.prescription, ray);
  if (traced.status !== "ok" || !traced.ray) return null;
  return { x: traced.ray.origin.x, y: traced.ray.origin.y };
}

/** Relative step the Jacobian is differenced over, in pupil coordinates. */
const JACOBIAN_STEP = 1e-4;

/**
 * The cone lighting object height `h`, on the objective pupil's own lattice.
 *
 * See the header for the construction and for what it does and does not buy.
 * The returned source carries `pupilLattice`, so `abbeImage` may cache the pupil
 * across its points — legitimately, because every coordinate below is an integer
 * times `2·stepMultiple/pupilSamples` and nothing shifts it.
 */
export function tracedCondenserCone(
  system: OpticalSystem,
  rev: ReversedCondenser,
  objectHeightMm: number,
  options: TracedConeOptions,
): TracedCone {
  const { pupilSamples } = options;
  const stepMultiple = options.stepMultiple ?? 1;
  const apertureFraction = options.apertureFraction ?? 1;
  const reach = options.reach ?? 1.35;
  if (!Number.isInteger(pupilSamples) || !isPowerOfTwo(pupilSamples) || pupilSamples < 2) {
    throw new Error(
      `tracedCondenserCone: pupilSamples must be a power of two so that the pupil's frequency ` +
        `step 2/${pupilSamples} is exactly representable and the cached sum is bit-for-bit the ` +
        `uncached one — got ${pupilSamples}`,
    );
  }
  if (!Number.isInteger(stepMultiple) || stepMultiple < 1) {
    throw new Error(
      `tracedCondenserCone: stepMultiple must be a positive integer, got ${stepMultiple}`,
    );
  }
  if (!(apertureFraction > 0) || apertureFraction > 1) {
    throw new Error(
      `tracedCondenserCone: apertureFraction must lie in (0, 1] — it closes the diaphragm from ` +
        `wide open, and a condenser cannot be opened past its own engraved NA — got ${apertureFraction}`,
    );
  }
  const built = buildCone(system, rev, objectHeightMm, {
    pupilSamples,
    stepMultiple,
    apertureFraction,
    reach,
    ...(options.aim === undefined ? {} : { aim: options.aim }),
  });
  if (built.points.length === 0) {
    throw new Error(
      `tracedCondenserCone: a lattice of step ${(2 * stepMultiple) / pupilSamples} landed no ` +
        `point inside a diaphragm closed to ${apertureFraction} of ${rev.diaphragmRadiusMm} mm ` +
        `at object height ${objectHeightMm} mm — lower stepMultiple or raise pupilSamples`,
    );
  }

  const fidelity = coneFidelity(system, rev, objectHeightMm, options, built);
  const total = built.points.reduce((t, p) => t + p.weight, 0);
  return {
    points: built.points.map((p) => ({ sx: p.sx, sy: p.sy, weight: p.weight / total })),
    // The cone's radius in pupil units is a TRACED consequence of the diaphragm
    // rather than the dial's own number, so what is reported is the dial: this
    // is NA_cond/NA_obj as the condenser is engraved, and the points are where
    // the trace actually put them. `CondenserSource.coherenceParameter` says it
    // is "the outer radius of the sampled region", which was already renegotiated
    // once by `translateSource`; a traced cone is neither centred nor circular,
    // so read it as the dial and the points as the geometry.
    coherenceParameter: apertureFraction,
    // ODD, and that is load-bearing: `abbeImage` INFERS the lattice parity from
    // this count, and the candidate grid here is the global lattice — it contains
    // the origin — so the parity is 0 whatever `stepMultiple` is. That is
    // `latticeDiskSource`'s own argument for an odd count, and reporting an even
    // one would make the cache index half a step off and form a plausible wrong
    // image. § 6ag.6.
    samples: 2 * built.candidatesPerAxis + 1,
    pupilLattice: { pupilSamples, stepMultiple },
    fidelity,
    traces: built.traces,
    weightSpread: built.jMin > 0 ? built.jMax / built.jMin - 1 : Infinity,
  };
}

interface BuiltCone {
  readonly points: SourcePoint[];
  readonly members: Set<number>;
  readonly weights: Map<number, number>;
  readonly candidatesPerAxis: number;
  readonly traces: number;
  readonly jMin: number;
  readonly jMax: number;
}

function buildCone(
  system: OpticalSystem,
  rev: ReversedCondenser,
  objectHeightMm: number,
  options: {
    pupilSamples: number;
    stepMultiple: number;
    apertureFraction: number;
    reach: number;
    aim?: AimOptions;
  },
): BuiltCone {
  const { pupilSamples, stepMultiple, apertureFraction, reach } = options;
  const frame = pupilSlopeFrame(
    system,
    objectHeightMm,
    rev.wavelengthNm,
    options.aim === undefined ? {} : { aim: options.aim },
    "tracedCondenserCone",
  );
  // Where the cone sits, to centre the candidate grid on — the same quantity
  // `illuminationOffset` reports, reached through the same frame. It is NOT
  // added to any coordinate: it only decides which lattice indices are worth
  // tracing, which is what keeps every point exactly on the lattice.
  const centre = frame.chief === 0 ? 0 : frame.pupilOf(0);
  const spacing = (2 * stepMultiple) / pupilSamples;
  const kLoX = Math.floor((centre - reach) / spacing) - 1;
  const kHiX = Math.ceil((centre + reach) / spacing) + 1;
  const kY = Math.ceil(reach / spacing) + 1;
  const radius = rev.diaphragmRadiusMm * apertureFraction;
  const r2 = radius * radius;
  const d = JACOBIAN_STEP;
  const points: SourcePoint[] = [];
  const members = new Set<number>();
  const weights = new Map<number, number>();
  const key = (jx: number, jy: number): number => jx * 1e6 + jy;
  let traces = 0;
  let jMin = Infinity;
  let jMax = 0;
  for (let jy = -kY; jy <= kY; jy++) {
    // An integer times one exactly representable scale — `commensurateSource`'s
    // own construction, and the reason `latticeOffset` recovers the index rather
    // than rounding to it.
    const sy = jy * spacing;
    for (let jx = kLoX; jx <= kHiX; jx++) {
      const sx = jx * spacing;
      const s0x = frame.slopeOf(sx);
      const s0y = sy * frame.span;
      const landing = diaphragmLanding(rev, objectHeightMm, s0x, s0y);
      traces++;
      if (landing === null || landing.x * landing.x + landing.y * landing.y > r2) continue;
      // dA_diaphragm/ds, centrally differenced. Four extra traces, and they are
      // what carries the whole of the finding — see the header.
      const dx = d * frame.span;
      const xp = diaphragmLanding(rev, objectHeightMm, s0x + dx, s0y);
      const xm = diaphragmLanding(rev, objectHeightMm, s0x - dx, s0y);
      const yp = diaphragmLanding(rev, objectHeightMm, s0x, s0y + dx);
      const ym = diaphragmLanding(rev, objectHeightMm, s0x, s0y - dx);
      traces += 4;
      // A point whose neighbourhood the glass does not pass is at the edge of
      // what the condenser transmits, and its area element is not measurable
      // there. Dropped rather than one-sided: a one-sided difference at a
      // vignetting edge is a made-up weight, and this is the rim of the cone.
      if (!xp || !xm || !yp || !ym) continue;
      const a11 = (xp.x - xm.x) / (2 * d);
      const a12 = (yp.x - ym.x) / (2 * d);
      const a21 = (xp.y - xm.y) / (2 * d);
      const a22 = (yp.y - ym.y) / (2 * d);
      const jacobian = Math.abs(a11 * a22 - a12 * a21);
      if (!(jacobian > 0)) continue;
      jMin = Math.min(jMin, jacobian);
      jMax = Math.max(jMax, jacobian);
      const k = key(jx, jy);
      members.add(k);
      weights.set(k, jacobian);
      points.push({ sx, sy, weight: jacobian });
    }
  }
  return {
    points,
    members,
    weights,
    candidatesPerAxis: kHiX - kLoX,
    traces,
    jMin,
    jMax,
  };
}

/**
 * What the cone does across the tile it is being used for — the § 6af deferral's
 * "patch size and source sampling are coupled", measured on the construction
 * that actually ships.
 *
 * Reported, never thrown: `illumination/fidelity`'s convention, and for its
 * reason — a caller with no tile width gets `unknown` rather than a verdict
 * invented for it, and a caller that has one gets a number it may decide about.
 *
 * The two quantities are different in kind and both are here because of that.
 * `weightDrift` is continuous and refines away; `membershipFlips` is **discrete**
 * — a lattice point in the cone at one tile edge and out at the other is a step
 * in the formed image, not a small error — and § 6ag.5 measures that its
 * fraction does *not* refine away, because the mask's boundary grows with the
 * point count exactly as fast as the count does.
 */
function coneFidelity(
  system: OpticalSystem,
  rev: ReversedCondenser,
  objectHeightMm: number,
  options: TracedConeOptions,
  centre: BuiltCone,
): CondenserConeFidelity {
  const half = options.tileHalfWidthMm;
  if (half === undefined) {
    return {
      verdict: "unknown",
      membershipFlips: 0,
      flipFraction: 0,
      weightDrift: 0,
      reason:
        "no tileHalfWidthMm supplied, so how much the cone moves across the patch this source " +
        "is for was not measured — supply it to get a verdict",
    };
  }
  if (!(half >= 0)) {
    throw new Error(`tracedCondenserCone: tileHalfWidthMm must be >= 0, got ${half}`);
  }
  const build = (h: number): BuiltCone =>
    buildCone(system, rev, h, {
      pupilSamples: options.pupilSamples,
      stepMultiple: options.stepMultiple ?? 1,
      apertureFraction: options.apertureFraction ?? 1,
      reach: options.reach ?? 1.35,
      ...(options.aim === undefined ? {} : { aim: options.aim }),
    });
  const lo = build(objectHeightMm - half);
  const hi = build(objectHeightMm + half);
  let flips = 0;
  for (const k of lo.members) if (!hi.members.has(k)) flips++;
  for (const k of hi.members) if (!lo.members.has(k)) flips++;
  let drift = 0;
  const loTotal = lo.points.reduce((t, p) => t + p.weight, 0);
  const hiTotal = hi.points.reduce((t, p) => t + p.weight, 0);
  for (const k of centre.members) {
    const a = lo.weights.get(k);
    const b = hi.weights.get(k);
    if (a === undefined || b === undefined) continue;
    const mean = 0.5 * (a / loTotal + b / hiTotal);
    if (mean > 0) drift = Math.max(drift, Math.abs(a / loTotal - b / hiTotal) / mean);
  }
  const flipFraction = centre.points.length > 0 ? flips / centre.points.length : 1;
  // 5% is where this system's own sweep sits at the tile the app renders, and
  // the threshold is a REPORTING line rather than a physical one — which is why
  // the numbers are returned beside the verdict and the verdict is not a gate.
  const valid = flipFraction <= 0.05;
  return {
    verdict: valid ? "valid" : "coarse",
    membershipFlips: flips,
    flipFraction,
    weightDrift: drift,
    reason: valid
      ? `${flips} of ${centre.points.length} lattice points change membership across the tile ` +
        `(${(100 * flipFraction).toFixed(1)}%), and shared weights move ${(100 * drift).toFixed(1)}%`
      : `${flips} of ${centre.points.length} lattice points change membership across the tile ` +
        `(${(100 * flipFraction).toFixed(1)}%) — the cone is resolved more coarsely than the tile ` +
        `varies it, and a point that enters or leaves is a step in the image rather than a small ` +
        `error. Lower pupilSamples to narrow the tile; refining stepMultiple does NOT help, ` +
        `because the mask's boundary grows with the count (§ 6ag.5)`,
  };
}
