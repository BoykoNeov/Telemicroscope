import type { AimOptions } from "../pupil/aiming";
import type { OpticalSystem } from "../trace/system";
import { objectHeightForImageRadius, type ObjectFieldFrame } from "./object-field";

/**
 * The radial map, tabulated — § 6n's deferred cache, and the branch's dominant
 * per-tile cost until now.
 *
 * `rasterizeSpecimen` asks `objectHeightForImageRadius` where each pixel looks,
 * and that inverse **bisects a traced chief ray to mantissa exhaustion**: ~60
 * chief rays per pixel, 0.12 ms, so a 128² tile spends a second on the map and
 * 180 ms on the imaging it exists to feed (§ 6p's cache having already paid for
 * the pupil). D4 measured that inversion and named it the next optimisation;
 * § 6r multiplied it by the wavelength count. This is it.
 *
 * ## What makes a cache possible at all: the map is one-dimensional
 *
 * The systems are axially symmetric, so the whole of "where does this pixel
 * look" is a function of **one** scalar — the absolute image radius — with the
 * azimuth carried through untouched (`objectPointAt` already separates them that
 * way). A tile's 16 384 pixels are 16 384 queries of a single smooth curve, and
 * they are not even 16 384 different curves per tile: the map belongs to the
 * *system*, so **one table serves an entire mosaic**, which is what makes the
 * saving grow with the picture instead of being paid per tile.
 *
 * ## Why an interpolant, and why the exact path stays the default
 *
 * The obvious exactness-preserving trick does not pay. Seeding the bisection
 * from a table and then bisecting inside a tight bracket returns the **same
 * float** — § 6m.2 pins that the seed chooses the path and not the answer — but
 * bisection is logarithmic, so a bracket 1e-9 wide still costs 23 of the 52
 * iterations and the whole win is ~2.5×. Skipping the trace entirely measures
 * **428×** on a 128² raster. So this is an interpolant, with an error, and the
 * error is measured (§ 6s.3: 3.8e-13 of a pixel).
 *
 * That is why it is **opt-in and never the default**: § 6n's and § 6m's rungs
 * pin the *map*, and a rung run through an interpolant would pin the
 * interpolant instead. Nothing here touches the pupil assignment either —
 * `fieldPupilAt` and `objectFieldTile` keep inverting exactly, because they are
 * patch-rate and tile-rate rather than pixel-rate, and because the pupil is the
 * physics. What is cached is only where the specimen is **sampled**.
 *
 * ## The scheme, and the closed form the rung is pinned to
 *
 * Piecewise 4-point Lagrange on a uniform radial grid — the interpolating cubic
 * through nodes k−1…k+2 — chosen over Catmull-Rom because Keys' a = −1/2 kernel
 * is third-order while this is fourth, and because its error is a closed form
 * rather than an order:
 *
 *     |error| ≤ max|∏(r − r_i)| · max|f⁗| / 4!  =  (9/16) · h⁴ · max|f⁗| / 24
 *
 * and h⁴·f⁗ is what the table's own fourth difference measures, so the map can
 * report `errorEstimateMm = (3/128) · max|Δ⁴h|` from the numbers it already has.
 *
 * **An estimate and not a bound, which is measured rather than hedged.** The
 * fourth difference is f⁗ at *some* point of each stencil, so the max over
 * stencils under-reads the max over the interval that the error formula wants:
 * § 6s.2 finds the true error 7–17% *above* the estimate at every node count
 * where truncation dominates. What the closed form does deliver exactly is the
 * **order** — the error falls ×5.06 for every ×1.5 of node count and ×3.16 for
 * every ×4/3, measured at 4.83/4.87 and 3.07/3.04 — until it meets the rounding
 * floor at ~4 ulp of the object height, which on the DIN 4× arrives by 32 nodes.
 *
 * ## Odd symmetry does the boundary, so r = 0 is exact rather than special
 *
 * The first interval's stencil wants a node at −h. There is no chief ray there,
 * but there does not need to be one: the object height reaching an image radius
 * is **odd** through the axis — that is the same axial symmetry the map's
 * one-dimensionality comes from — so the node below zero is minus the node above
 * it, exactly. It costs no trace, it is not an extrapolation, and it makes
 * `heightAt(0) === 0` fall out of the Lagrange weights (c₁ = 1 and the rest 0 at
 * t = 0) instead of being a clamped special case. § 6s.1 pins the zero bitwise.
 *
 * The far end has no such trick, so one node is traced **beyond** the requested
 * radius: every query is strictly interior to the stencil, in § 6o's and § 6r's
 * sense, and no query is ever an extrapolation. A radius past the built range is
 * **refused**, with both numbers in the message — `objectHeightForImageRadius`'s
 * own rule, one layer up.
 *
 * ## The identity a cached map has to carry
 *
 * A table is a function of (system, wavelength, aim) and of nothing else, and
 * two of those three are invisible at the call site. § 6r rasterizes the same
 * specimen on one frame per wavelength; a 550 nm table used on the 450 nm frame
 * gives a perfectly plausible picture of very slightly the wrong specimen, with
 * no witness anywhere downstream — § 6n.2's and § 6p's bug class exactly. So the
 * map carries its wavelength and its launch plane and `specimenPointAt` refuses
 * a frame that disagrees, rather than trusting the caller to pass the right one.
 */

/** Which quantity the table holds. Both reconstruct the same map; § 6s.4. */
export type RadialTabulation =
  /**
   * The object height itself.
   *
   * The default, and § 6s.6 is why: subtracting the linear part first is the
   * obvious optimisation and it is worth **nothing**, because a cubic already
   * reproduces a linear function exactly and the reconstruction's final add
   * rounds at the same place. Measured, not argued.
   */
  | "height"
  /** Height minus the map's own first-node slope — the negative control. */
  | "residual";

export interface RadialMapOptions {
  /** Largest image-plane radius (mm) the map must answer for. */
  readonly maxRadiusMm: number;
  /**
   * Intervals across `[0, maxRadiusMm]`. Costs `nodes + 1` chief-ray inversions
   * and no more — one per node plus the one beyond the end.
   *
   * Default 64, which § 6s.2 measures well past the rounding floor on the DIN
   * 4× over a mosaic-sized span — 8 nodes already place a pixel to 6e-11 of a
   * pixel — so this is generous rather than tuned, and 65 inversions against a
   * tile's 16 384 is not a budget worth economising on.
   */
  readonly nodes?: number;
  /** Required: a table is built before any frame exists, and the wavelength is
   * part of its identity rather than a default it could inherit. */
  readonly wavelengthNm: number;
  readonly aim?: AimOptions;
  /** Default `"height"`; see `RadialTabulation`. */
  readonly tabulate?: RadialTabulation;
}

export interface RadialMap {
  readonly maxRadiusMm: number;
  readonly nodes: number;
  readonly spacingMm: number;
  readonly wavelengthNm: number;
  /** The launch plane the table was traced on — part of its identity. */
  readonly launchZ: number | undefined;
  readonly tabulate: RadialTabulation;
  /**
   * Chief-ray inversions the table cost: `nodes + 1`, exactly.
   *
   * An integer rather than a wall clock, on § 6p's own argument — the saving a
   * caller gets is `size²` of these against this one number, and an integer
   * ratio is a claim a rung can pin on any machine.
   */
  readonly inversions: number;
  /** Traced object heights at `k · spacingMm`, `k = 0 … nodes + 1`. */
  readonly heights: Float64Array;
  /**
   * The interpolation's own error estimate (mm), from the closed form in the
   * header: `(3/128) · max|Δ⁴h|`, the fourth difference of the table.
   *
   * An **estimate**, not a bound — § 6s.2 measures the true error 7–17% above
   * it, because a fourth difference reads f⁗ inside the stencil while the error
   * formula wants its maximum over the interval. Reported anyway, because it is
   * the number that says whether more nodes would buy anything: once it stops
   * falling with the node count the table has reached the rounding floor and is
   * as good as f64 allows.
   */
  readonly errorEstimateMm: number;
  /** Object height (mm) reaching `radiusMm`. Refuses a radius outside the range. */
  heightAt(radiusMm: number): number;
}

/** The interpolating cubic through four consecutive nodes, at `t ∈ [0, 1]`
 * between `y1` and `y2`. Exactly `y1` at t = 0 and `y2` at t = 1. */
function lagrange4(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c0 = (-t * (t - 1) * (t - 2)) / 6;
  const c1 = ((t + 1) * (t - 1) * (t - 2)) / 2;
  const c2 = (-(t + 1) * t * (t - 2)) / 2;
  const c3 = ((t + 1) * t * (t - 1)) / 6;
  return c0 * y0 + c1 * y1 + c2 * y2 + c3 * y3;
}

/**
 * Tabulate the inverse chief-ray map over `[0, maxRadiusMm]`.
 *
 * Costs `nodes + 1` bisections and nothing else. The node at the origin is not
 * traced: the map is odd, so it is exactly zero, and tracing it would only
 * confirm that to a residual.
 */
export function buildRadialMap(system: OpticalSystem, options: RadialMapOptions): RadialMap {
  const { maxRadiusMm } = options;
  const nodes = options.nodes ?? 64;
  if (!(maxRadiusMm > 0) || !Number.isFinite(maxRadiusMm)) {
    throw new Error(`buildRadialMap: maxRadiusMm must be finite and positive, got ${maxRadiusMm}`);
  }
  // Four is the stencil; the floor is higher because a table too coarse to
  // resolve its own fourth difference reports an error bound that is noise.
  if (!Number.isInteger(nodes) || nodes < 4) {
    throw new Error(`buildRadialMap: nodes must be an integer >= 4, got ${nodes}`);
  }
  const wavelengthNm = options.wavelengthNm;
  if (!(wavelengthNm > 0)) {
    throw new Error(`buildRadialMap: wavelengthNm must be positive, got ${wavelengthNm}`);
  }
  const aim = options.aim ?? {};
  const tabulate = options.tabulate ?? "height";

  const spacingMm = maxRadiusMm / nodes;
  const heights = new Float64Array(nodes + 2);
  for (let k = 1; k <= nodes + 1; k++) {
    heights[k] = objectHeightForImageRadius(system, k * spacingMm, wavelengthNm, { aim });
  }

  // The linear reference is the map's own first node, not a paraxial
  // magnification: it needs no extra trace and it makes the residual vanish at
  // both r = 0 and r = spacing by construction.
  const slope = heights[1]! / spacingMm;
  const table =
    tabulate === "residual"
      ? Float64Array.from(heights, (h, k) => h - slope * k * spacingMm)
      : heights;

  // The closed form's f⁗·h⁴, read off the table itself — an estimate of the max,
  // and § 6s.2 measures how far under it reads.
  let fourth = 0;
  for (let k = 0; k + 4 <= nodes + 1; k++) {
    const d =
      heights[k + 4]! - 4 * heights[k + 3]! + 6 * heights[k + 2]! - 4 * heights[k + 1]! + heights[k]!;
    fourth = Math.max(fourth, Math.abs(d));
  }
  const errorEstimateMm = (3 / 128) * fourth;

  const heightAt = (radiusMm: number): number => {
    if (!(radiusMm >= 0) || radiusMm > maxRadiusMm) {
      throw new Error(
        `RadialMap: image radius ${radiusMm} mm is outside the tabulated range ` +
          `[0, ${maxRadiusMm}] — build the map over the span it will be queried on rather ` +
          `than extrapolating off the end of it`,
      );
    }
    const s = radiusMm / spacingMm;
    let k = Math.floor(s);
    if (k > nodes - 1) k = nodes - 1;
    const t = s - k;
    // The node below the first interval is the mirror of the node above it —
    // the map is odd through the axis, so this is the map and not a boundary
    // condition invented for it.
    const y0 = k === 0 ? -table[1]! : table[k - 1]!;
    const v = lagrange4(y0, table[k]!, table[k + 1]!, table[k + 2]!, t);
    return tabulate === "residual" ? v + slope * radiusMm : v;
  };

  return {
    maxRadiusMm,
    nodes,
    spacingMm,
    wavelengthNm,
    launchZ: aim.launchZ,
    tabulate,
    inversions: nodes + 1,
    heights,
    errorEstimateMm,
    heightAt,
  };
}

/**
 * A map covering every pixel of every frame given — one table for a mosaic.
 *
 * The far corner of a frame is `hypot(|cx| + halfExtent, |cy| + halfExtent)`,
 * and the largest over the frames is the span the table must reach. A relative
 * whisker is added because the builder computes that corner from the frame's
 * centre and extent while `imagePointAt` reaches it by a different arithmetic,
 * and a query one ulp past the end would be refused for a reason that is not
 * the caller's.
 *
 * Refuses a set of frames that do not share a wavelength: § 6r's stack has one
 * frame per wavelength and they are exactly the frames a caller would be
 * tempted to cover with one table.
 */
export function radialMapCovering(
  system: OpticalSystem,
  frames: readonly ObjectFieldFrame[],
  options: Omit<RadialMapOptions, "maxRadiusMm" | "wavelengthNm"> = {},
): RadialMap {
  if (frames.length === 0) throw new Error("radialMapCovering: no frames to cover");
  const wavelengthNm = frames[0]!.wavelengthNm;
  let maxRadiusMm = 0;
  for (const frame of frames) {
    if (frame.wavelengthNm !== wavelengthNm) {
      throw new Error(
        `radialMapCovering: the frames are at ${wavelengthNm} nm and ${frame.wavelengthNm} nm — ` +
          `the inverse chief-ray map is wavelength-dependent, so a table covering both would be ` +
          `the wrong map for one of them. Build one per wavelength.`,
      );
    }
    const cx = Math.abs(frame.centreMm.x) + frame.halfExtentMm;
    const cy = Math.abs(frame.centreMm.y) + frame.halfExtentMm;
    maxRadiusMm = Math.max(maxRadiusMm, Math.hypot(cx, cy));
  }
  return buildRadialMap(system, {
    ...options,
    maxRadiusMm: maxRadiusMm * (1 + 1e-12),
    wavelengthNm,
  });
}

/**
 * Refuse a map that does not belong to the frame it is about to be read on.
 *
 * The wavelength and the launch plane are the table's whole identity beyond the
 * system, and both are invisible at the call site — see the header.
 */
export function requireRadialMapMatches(
  map: RadialMap,
  frame: ObjectFieldFrame,
  aim: AimOptions | undefined,
  who: string,
): void {
  if (map.wavelengthNm !== frame.wavelengthNm) {
    throw new Error(
      `${who}: the radial map was tabulated at ${map.wavelengthNm} nm and the frame is at ` +
        `${frame.wavelengthNm} nm — the inverse chief-ray map is wavelength-dependent, so this ` +
        `would rasterize the specimen at the wrong place with nothing downstream able to see it`,
    );
  }
  if (map.launchZ !== aim?.launchZ) {
    throw new Error(
      `${who}: the radial map was traced with launchZ ${map.launchZ} and the raster asks for ` +
        `${aim?.launchZ} — the table is a function of the aiming it was built with`,
    );
  }
}
