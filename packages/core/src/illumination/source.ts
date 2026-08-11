/**
 * The condenser, as the only thing about it the image can tell apart: a set of
 * directions the specimen is lit from.
 *
 * Every image the engine has formed so far came from a *self-luminous* point —
 * a star, or a fluorescent bead once step 6 gets there. A brightfield
 * microscope does not work that way. The specimen emits nothing; it modulates a
 * beam that arrives from a condenser below it, and the condenser has a finite
 * aperture, so the beam is not one plane wave but a continuum of them. Which
 * ones, and how strongly, is the whole of "illumination" as far as the image is
 * concerned.
 *
 * ## Köhler illumination is what makes this a set of *directions*
 *
 * In Köhler illumination the lamp filament is imaged onto the condenser's
 * aperture *diaphragm*, not onto the specimen. Every point of that diaphragm
 * therefore lights the whole field with one collimated beam, and the diaphragm's
 * radius sets the largest angle in the cone. So the condenser reduces, exactly,
 * to a weighted set of illumination directions filling a disc — which is what
 * this file builds. (An unevenly lit filament would put structure in the weights
 * rather than break the model; a *critical*-illumination condenser, which images
 * the filament onto the specimen, would break it, and is not modelled.)
 *
 * ## Units: the objective's pupil radius is 1
 *
 * A source point is stored in the same normalized pupil coordinates the rest of
 * the wave layer uses — the objective's pupil rim is at radius 1 — so a
 * direction with illumination aperture NA_c sits at radius NA_c/NA_obj. The
 * whole of brightfield partial coherence is therefore governed by one
 * dimensionless number, the **coherence parameter**
 *
 *     S = NA_condenser / NA_objective
 *
 * which is the dial on the front of every real microscope and the parameter the
 * § 6f rungs sweep. S is a ratio of *object-side* numerical apertures, so it is
 * unchanged by the reduced-coordinate convention `illumination/abbe` images in.
 *
 * Nothing here knows what an image is. These are directions and weights; what
 * they do to contrast lives in `abbe.ts` and `transfer.ts`.
 */

import { isPowerOfTwo } from "../math/fft";

/** One illumination direction, in normalized objective-pupil coordinates. */
export interface SourcePoint {
  readonly sx: number;
  readonly sy: number;
  /** Fraction of the total illumination this direction carries. Σ = 1. */
  readonly weight: number;
}

export interface CondenserSource {
  readonly points: readonly SourcePoint[];
  /**
   * S = NA_condenser / NA_objective — the outer radius of the sampled region.
   * 0 is a single on-axis point (coherent); 1 is a condenser matched to the
   * objective. Values above 1 are physically reachable and *are* modelled, but
   * see `transfer.ts`: past 1 they stop buying resolution.
   */
  readonly coherenceParameter: number;
  /** Grid points across the source DIAMETER that produced this sampling. */
  readonly samples: number;
  /**
   * Set **only** by `commensurateSource`: this source's lattice steps by
   * `stepMultiple` times the frequency step of a pupil sampled at
   * `pupilSamples` bins across its diameter.
   *
   * It is metadata rather than something a consumer may infer, and that is
   * `illumination/abbe`'s licence to cache the pupil across source points
   * (§ 6p). Measuring commensurability off the coordinates instead — round
   * `sx/step` and accept it if it is close — is exactly the failure mode
   * `latticeMatchedSource` refuses one module over: a *nearly* commensurate
   * source would take the cached path and form a perfectly plausible image
   * whose disagreement with the honest sum reads as physics.
   */
  readonly pupilLattice?: {
    readonly pupilSamples: number;
    readonly stepMultiple: number;
  };
  /**
   * Set **only** by `translateSource`: this cone is displaced from the pupil
   * centre by this much, because the objective it is being imaged through is not
   * object-space telecentric (§ 6x).
   *
   * Reporting rather than instructing — the points already carry the offset, and
   * nothing in `abbe.ts` reads this. It is here so a caller can tell a displaced
   * source from a source that was authored off centre, and so the readouts that
   * quote S can say what fraction of the cone the aperture is still admitting.
   */
  readonly offset?: { readonly dx: number; readonly dy: number };
}

function gridCoordinate(i: number, samples: number, radius: number): number {
  // Cell centres: samples = 1 lands one point at the origin, which is exactly
  // the coherent limit and not a special case in the code.
  return radius * ((2 * (i + 0.5)) / samples - 1);
}

/**
 * A uniformly filled circular condenser aperture — the brightfield default.
 *
 * Midpoint sampling of the disc on a Cartesian lattice, uniform weights: cells
 * are equal-area, so equal weights *are* the uniform source. The discretization
 * error is entirely at the rim and falls off with `samples`; § 6f pins that
 * convergence rather than asserting a count is enough, because a source too
 * coarsely sampled produces structure in the image that looks like physics.
 */
export function diskSource(coherenceParameter: number, samples = 15): CondenserSource {
  if (!(coherenceParameter >= 0)) {
    throw new Error(`coherenceParameter must be >= 0, got ${coherenceParameter}`);
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`source samples must be a positive integer, got ${samples}`);
  }
  const S = coherenceParameter;
  const points: SourcePoint[] = [];
  const r2 = S * S;
  for (let j = 0; j < samples; j++) {
    const sy = gridCoordinate(j, samples, S);
    for (let i = 0; i < samples; i++) {
      const sx = gridCoordinate(i, samples, S);
      if (sx * sx + sy * sy <= r2) points.push({ sx, sy, weight: 0 });
    }
  }
  // samples = 1 puts its one point at the origin, so the list is never empty
  // even at S = 0.
  const w = 1 / points.length;
  return {
    points: points.map((p) => ({ sx: p.sx, sy: p.sy, weight: w })),
    coherenceParameter: S,
    samples,
  };
}

/**
 * The condenser whose lattice steps by a whole multiple of the **pupil's own**
 * frequency step — commensurate and coarse at once (§ 6p).
 *
 * `diskSource` spaces its points by 2S/samples, which is a spacing chosen for
 * the *source*: nothing relates it to the grid the pupil is sampled on. Setting
 * the two equal fixes the count at S·pupilSamples (`latticeMatchedSource`, § 6i)
 * and buys exactness, but it fixes the count at a number a picture cannot
 * afford — 3 217 points at S = 0.5 and `pupilSamples` 128, where a converged
 * image needs ~100. This is the generalization that separates the two: spacing
 * an integer multiple `stepMultiple` of the pupil step, count S·pupilSamples /
 * stepMultiple.
 *
 * ## What the commensurability buys, and it is not accuracy
 *
 * Every source point still reads the pupil at its own offset, but *all the
 * offsets land on one lattice*. Illuminating from s samples the pupil at
 * (ix − n/2)·Δ + s, and with s a whole number of Δ apart the union over source
 * points is a single grid of spacing Δ — so a traced `PupilFunction`, whose
 * callback re-traces rays, can be evaluated **once** over its support and read
 * back by index for every direction after the first. That is what
 * `illumination/abbe` does with `pupilLattice`, and it is why a traced mosaic
 * costs minutes rather than hours. The image it forms is not more accurate; it
 * is the same arithmetic in a different order, and § 6p pins that as *bit for
 * bit* rather than as a tolerance, because anything looser would be hiding a
 * bug.
 *
 * A coarser lattice IS less accurate, and for the ordinary reason: fewer source
 * points is a coarser quadrature of the condenser disc. § 6f.2's convergence is
 * what governs it, and § 6p measures which `stepMultiple` still clears it
 * rather than assuming commensurability comes free.
 *
 * ## Why `pupilSamples` must be a power of two
 *
 * The exactness above is *arithmetic*, not just algebraic. The step 2/N is
 * exactly representable only when N is a power of two, and only then is
 * (ix − n/2)·Δ + s bit-for-bit equal to the (ix − n/2 + k)·Δ the cache indexes
 * by. At any other N the two agree to a rounding and the cached image would
 * differ from the honest one in the last bits — a difference small enough to
 * pass and large enough to mean the invariant is not what it says. Refused
 * rather than tolerated. Every brightfield lattice in the engine is 16, 32, 64
 * or 128, so this costs nothing.
 *
 * Throws rather than rounding a fractional count, for `latticeMatchedSource`'s
 * own reason: a rounded lattice is not commensurate, and an image formed on one
 * through the cache is wrong in a way nothing downstream can see.
 */
export function commensurateSource(
  coherenceParameter: number,
  pupilSamples: number,
  stepMultiple = 1,
): CondenserSource {
  const S = coherenceParameter;
  if (!(S > 0)) {
    throw new Error(`commensurateSource: coherenceParameter must be > 0, got ${S}`);
  }
  if (!Number.isInteger(stepMultiple) || stepMultiple < 1) {
    throw new Error(`commensurateSource: stepMultiple must be a positive integer, got ${stepMultiple}`);
  }
  if (!Number.isInteger(pupilSamples) || !isPowerOfTwo(pupilSamples) || pupilSamples < 2) {
    throw new Error(
      `commensurateSource: pupilSamples must be a power of two so that the pupil's frequency ` +
        `step 2/${pupilSamples} is exactly representable and the cached sum is bit-for-bit the ` +
        `uncached one — got ${pupilSamples}`,
    );
  }
  const samples = (S * pupilSamples) / stepMultiple;
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(
      `commensurateSource: S·pupilSamples/stepMultiple must be a positive integer for the source ` +
        `lattice to step by ${stepMultiple}× the pupil's own frequency step — got ${S} × ` +
        `${pupilSamples} / ${stepMultiple} = ${samples}`,
    );
  }
  // Half the pupil's frequency step, and exact because pupilSamples is a power
  // of two. Every coordinate below is an integer multiple of it, computed as
  // one integer product times one exact scale — so no source point carries a
  // rounding the cache would have to reproduce.
  const halfStep = 1 / pupilSamples;
  const points: SourcePoint[] = [];
  const r2 = S * S;
  for (let j = 0; j < samples; j++) {
    const sy = (2 * j + 1 - samples) * stepMultiple * halfStep;
    for (let i = 0; i < samples; i++) {
      const sx = (2 * i + 1 - samples) * stepMultiple * halfStep;
      if (sx * sx + sy * sy <= r2) points.push({ sx, sy, weight: 0 });
    }
  }
  const w = 1 / points.length;
  return {
    points: points.map((p) => ({ sx: p.sx, sy: p.sy, weight: w })),
    coherenceParameter: S,
    samples,
    pupilLattice: { pupilSamples, stepMultiple },
  };
}

/**
 * The coherent limit: one on-axis plane wave. S = 0.
 *
 * Not a physical condenser — a real diaphragm has finite area, and closing it
 * to a pinhole costs all the light — but it is the limit one end of the § 6f
 * law is pinned at, and it is where the transfer function goes flat.
 */
export function coherentSource(): CondenserSource {
  return { points: [{ sx: 0, sy: 0, weight: 1 }], coherenceParameter: 0, samples: 1 };
}

/**
 * The same condenser, seen from a field point the objective's pupil is not
 * centred on (§ 6x).
 *
 * ## Why a source ever moves, and why it is the objective that moves it
 *
 * Köhler illumination delivers one *direction* per diaphragm point to the whole
 * field — that is the header's model and it is exact, and it is a property of
 * the condenser alone. What is NOT field-independent is where a given direction
 * lands in the **objective's** pupil, and this file's coordinates are the
 * objective's pupil. A ray leaving object height h with object-space slope u
 * reaches the entrance pupil at height h + u·z_ep, so in normalized pupil units
 *
 *     ρ = h/R_ep + u/u_max
 *
 * and the h/R_ep term vanishes exactly when the entrance pupil is at infinity —
 * which is object-space telecentricity, and nothing else. So a telecentric
 * objective is what licenses handing every field point the same source, and a
 * rim-stopped one displaces the whole cone by h/R_ep at field height h. On the
 * shipped DIN 4×/0.10 that is 0.217 of a pupil radius per millimetre of object
 * field, against an S that is usually below 1: at a millimetre the cone is a
 * third of the way out of the aperture it is supposed to fill.
 *
 * `imaging/object-field` measures the offset off the trace and hands it down;
 * this function is only the translation.
 *
 * ## What it costs: `pupilLattice` does not survive
 *
 * § 6p's cache is licensed by every source point sitting on the pupil's own
 * frequency lattice, and an offset read off a trace is not a whole number of
 * half-steps. Rounding it onto the lattice would be a lie of exactly the kind
 * `commensurateSource` refuses one function up, so the metadata is **dropped**
 * and `abbeImage` falls back to evaluating the pupil per source point. The
 * saving is therefore telecentric-only, which is not a limitation of the cache
 * but a restatement of what it was: commensurability is a claim about where the
 * source sits in the pupil, and a non-telecentric objective moves it with field.
 *
 * `coherenceParameter` is carried through unchanged: it is NA_cond/NA_obj, a
 * ratio of apertures, and translating the cone does not change either of them.
 * It stops being the radius of the sampled region about the origin, which is
 * what the field on `CondenserSource` says it is — read it as the source's own
 * radius, and `offset` for where that disc now sits.
 */
export function translateSource(
  source: CondenserSource,
  dx: number,
  dy: number,
): CondenserSource {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error(`source offset must be finite, got (${dx}, ${dy})`);
  }
  // Exactly the identity, and returned as the same object: a zero offset is the
  // telecentric case, and it must not cost a copy or lose `pupilLattice` —
  // § 6p's cache stays available for every system that does not need this.
  if (dx === 0 && dy === 0) return source;
  return {
    points: source.points.map((p) => ({ sx: p.sx + dx, sy: p.sy + dy, weight: p.weight })),
    coherenceParameter: source.coherenceParameter,
    samples: source.samples,
    offset: { dx, dy },
  };
}

/**
 * An annular condenser aperture — a ring, not a disc.
 *
 * The same lattice, masked to `inner ≤ r ≤ outer`. It exists here for one
 * reason worth pinning now: an annulus whose *inner* radius exceeds 1 puts every
 * illuminating beam outside the objective's pupil, so the undiffracted light
 * cannot enter the objective at all and an object that diffracts nothing images
 * **black**. That is darkfield, and it falls out of the same sum with no
 * special case. Phase contrast wants this shape too, but wants a phase plate in
 * the pupil with it, and that is a v2 item.
 */
export function annularSource(outer: number, inner: number, samples = 15): CondenserSource {
  if (!(outer > 0)) throw new Error(`annular outer radius must be > 0, got ${outer}`);
  if (!(inner >= 0) || inner >= outer) {
    throw new Error(`annular inner radius must lie in [0, ${outer}), got ${inner}`);
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`source samples must be a positive integer, got ${samples}`);
  }
  const points: SourcePoint[] = [];
  const hi = outer * outer;
  const lo = inner * inner;
  for (let j = 0; j < samples; j++) {
    const sy = gridCoordinate(j, samples, outer);
    for (let i = 0; i < samples; i++) {
      const sx = gridCoordinate(i, samples, outer);
      const r2 = sx * sx + sy * sy;
      if (r2 <= hi && r2 >= lo) points.push({ sx, sy, weight: 0 });
    }
  }
  if (points.length === 0) {
    throw new Error(
      `annular source has no samples: ${samples}² points across a ring of width ` +
        `${outer - inner} resolved nothing — raise samples`,
    );
  }
  const w = 1 / points.length;
  return {
    points: points.map((p) => ({ sx: p.sx, sy: p.sy, weight: w })),
    coherenceParameter: outer,
    samples,
  };
}
