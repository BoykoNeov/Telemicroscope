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
