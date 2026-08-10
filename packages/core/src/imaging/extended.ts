import type { AimOptions } from "../pupil/aiming";
import type { OpticalSystem } from "../trace/system";
import type { WavelengthSample } from "../trace/system";
import { imagePointOf, type ImagePlaneScene } from "./scene";

/**
 * The extended incoherent source — a planet, the Moon, a nebula — and the one
 * thing that separates it from a star.
 *
 * `rasterizePointSources` places a **flux**: a star has no angular size, so its
 * whole light lands at one image point and the only question is which point.
 * An extended source has no flux until an area is named. What it carries is a
 * **radiance**, light per unit solid angle of sky, and turning that into the
 * flux per pixel `renderField` convolves needs the solid angle each pixel
 * subtends — which is the derivative of the same chief-ray map `imagePointOf`
 * already traces.
 *
 * So the step adds no optics. Every ray it needs was already being traced; what
 * is new is that the map is differentiated rather than only evaluated.
 *
 * ## The Jacobian is one-dimensional, and that is a physical fact
 *
 * § 6s found that "where does this pixel look" is a function of one scalar,
 * because the systems are axially symmetric. The same symmetry makes the area
 * element factorize. A pixel at image radius r looking at field radius θ(r)
 * covers `r·dr·dφ` of image plane and `sin θ·dθ·dφ` of sky, so
 *
 *     dΩ/dA = (sin θ / r) · (dθ/dr)
 *
 * — a **tangential** factor times a **radial** one, each a function of r alone.
 * That is § 6m.4's anisotropy written as a product rather than as a 2×2
 * determinant: the two scales really do differ, and the determinant is still
 * one-dimensional. No off-diagonal term exists to compute.
 *
 * On the axis both factors are the same limit, `sin θ/r → dθ/dr`, so
 * `dΩ/dA(0) = (dθ/dr)²` exactly — and on a system that images at f it is
 * `1/f²`, which is a number from outside the engine and is pinned as one.
 *
 * ## The cosine count, and the one this module does NOT apply
 *
 * For a distortion-free map `r = f·tan θ` the expression above is
 * **cos³θ/f²**, which is where the textbook cos⁴θ falloff comes from. The
 * fourth cosine is the entrance pupil's **projected area**: a pupil of area A
 * presents A·cos θ to a source θ off axis.
 *
 * **That fourth cosine is not applied here, because it is not this module's.**
 * It was measured before this module was written (§ 5v.1): `psf().energy` — the
 * transmitted pupil energy every branch normalizes to — is flat in field to
 * 8e-7 at 2° on the hero achromat, where cos θ would be 6.1e-4, and the small
 * residual that is there does not even have a cosine's shape (linear in θ on
 * the paraboloid, quadratic on the doublet: the pupil lattice, not obliquity).
 * The engine's pupil is a *normalized* grid, so its area is field-independent
 * by construction.
 *
 * Putting the cosine here would therefore make this rasterizer disagree with
 * `rasterizePointSources`, which does not apply it either — a star and a disc of
 * the same total flux would render at different brightnesses, and the
 * point-source-limit rung below would have to be written around the
 * disagreement instead of pinning it. So the missing cosine is named as a
 * deferral belonging to the **pupil layer**, where fixing it once would serve
 * both rasterizers, and it cancels exactly in the comparison between them.
 *
 * ## A radiance is a density, so this warp DOES carry a Jacobian
 *
 * `imaging/specimen`'s warp deliberately carries none: an amplitude
 * transmittance is a property *of a point*, so warping it is pure coordinate
 * substitution. A radiance is a density over solid angle, and moving it onto an
 * image grid without `dΩ/dA` would move light between pixels. That module named
 * this as its own deferral for the extended *emitter* case, and the
 * factorization above is what such a step would need — but the deferral is the
 * microscope's and is **not** closed by this module, which images the sky.
 *
 * Because a density is being transformed, **energy is a real witness here**,
 * which is worth saying given how often § 6g.2, § 6k.4 and § 6r.2 record that it
 * is not. It is a converging witness rather than an exact one: the radiance is
 * point-sampled at each pixel's own field direction — § 6n's convention, so the
 * warp stays in the *argument* and nothing is resampled — and a point sample of
 * a density integrates its cell only in the limit. § 5v.6 measures the rate
 * instead of asserting the conservation.
 *
 * ## The map is built forward, and inverted afterwards
 *
 * `render.ts`'s `fieldAngleFor` bisects the traced radius for every field angle
 * it needs, which is fine for a dozen patch centres and wrong for this: a
 * derivative taken by differencing a bisection carries √ε/h noise that would
 * swamp the cos³ pin it exists to be checked against.
 *
 * So the forward map r(θ) — one chief ray per node, smooth in θ, no search
 * anywhere — is tabulated instead, and both the inverse and the derivative come
 * off that one table: θ(r) by Newton on the interpolating cubic, dr/dθ by
 * differentiating the same cubic. The derivative is then exact *for the
 * interpolant* rather than noisy for the truth, and how far the interpolant is
 * from the truth is a node count.
 *
 * The scheme is § 6s's — piecewise 4-point Lagrange, and its odd node below the
 * axis is the same mirror for the same reason (r is odd in θ). What is not
 * shared is the module: § 6s's `RadialMap` inverts to an **object height** and
 * is keyed to an `ObjectFieldFrame`, which a telescope has neither of.
 * Unifying the two, and retiring `fieldAngleFor` into whichever survives, is
 * deferred on § 6s's own argument — § 3c's rungs pin the render, and an
 * interpolant underneath them would mean they pinned the interpolant.
 */

/**
 * Radiance from a direction on the sky, per unit solid angle, per wavelength.
 *
 * Authored in **field angle**, the way an observer thinks about the sky, and
 * the same convention `PointSource` uses. Dimensionless in the same sense
 * `PointSource.flux` is: photometric zero points are § 3a's deferral, so what
 * is physical here is every ratio, not the absolute value.
 *
 * A callback rather than an array, so the warp happens in the argument
 * (`imaging/specimen`'s reason, one branch over). The wavelength is the third
 * argument rather than a separate spectrum because an extended source's colour
 * is generally a function of *where* on it you look — a limb is not the same
 * colour as a disc centre, and a nebula is nothing but that.
 */
export type SkyRadiance = (fieldXDeg: number, fieldYDeg: number, nm: number) => number;

export interface FieldMapOptions {
  /** Largest field angle (degrees) the table must answer for. */
  readonly maxFieldDeg: number;
  /**
   * Intervals across `[0, maxFieldDeg]`. Costs `nodes + 1` forward chief rays
   * and nothing else — there is no bisection anywhere in the construction.
   *
   * Default 64, on § 6s's reasoning: 65 traced rays against a 128² frame's
   * 16 384 pixels is not a budget worth economising on, and the error estimate
   * says when more would buy anything.
   */
  readonly nodes?: number;
  /**
   * Required. The chief-ray map is wavelength-dependent (that is what lateral
   * colour *is*), and a table is a function of the wavelength it was traced at
   * — § 6s's identity lesson, which this module obeys by never letting a caller
   * supply a map rather than by refusing a mismatched one.
   */
  readonly wavelengthNm: number;
  readonly aim?: AimOptions;
}

export interface FieldMap {
  readonly maxFieldDeg: number;
  /** Image radius (mm) the largest tabulated field angle reaches. */
  readonly maxRadiusMm: number;
  readonly nodes: number;
  /** Node spacing, in **radians** — the unit the derivative is taken in. */
  readonly spacingRad: number;
  readonly wavelengthNm: number;
  readonly launchZ: number | undefined;
  /**
   * Forward chief rays the table cost: `nodes + 1`, exactly. An integer rather
   * than a wall clock, on § 6p's argument.
   */
  readonly chiefRays: number;
  /** Traced image radii (mm) at `k · spacingRad`, `k = 0 … nodes + 1`. */
  readonly radii: Float64Array;
  /**
   * The interpolation's own error estimate (mm), `(3/128)·max|Δ⁴r|`.
   *
   * An estimate and not a bound, for exactly § 6s.2's reason: a fourth
   * difference reads the fourth derivative inside its own stencil while the
   * remainder wants its maximum over the interval.
   */
  readonly errorEstimateMm: number;
  /** Image radius (mm) reached by a field angle, in **radians**. */
  radiusAt(fieldRad: number): number;
  /** dr/dθ (mm per radian) at a field angle in radians. */
  radiusSlopeAt(fieldRad: number): number;
  /** Field angle (radians) whose chief ray lands at this image radius. */
  fieldAt(radiusMm: number): number;
  /**
   * Sky solid angle per unit image area (sr/mm²) at an image radius — the
   * Jacobian this module exists for. The axis is the exact limit, not a clamp.
   */
  solidAnglePerArea(radiusMm: number): number;
}

/** The interpolating cubic through four consecutive nodes, at `t ∈ [0, 1]`. */
function lagrange4(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c0 = (-t * (t - 1) * (t - 2)) / 6;
  const c1 = ((t + 1) * (t - 1) * (t - 2)) / 2;
  const c2 = (-(t + 1) * t * (t - 2)) / 2;
  const c3 = ((t + 1) * t * (t - 1)) / 6;
  return c0 * y0 + c1 * y1 + c2 * y2 + c3 * y3;
}

/** d/dt of `lagrange4` — the same cubic differentiated, not differenced. */
function lagrange4Slope(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c0 = -(3 * t * t - 6 * t + 2) / 6;
  const c1 = (3 * t * t - 4 * t - 1) / 2;
  const c2 = -(3 * t * t - 2 * t - 2) / 2;
  const c3 = (3 * t * t - 1) / 6;
  return c0 * y0 + c1 * y1 + c2 * y2 + c3 * y3;
}

/** The traced image radius (mm) of a field angle, in radians. */
function tracedRadius(
  system: OpticalSystem,
  fieldRad: number,
  wavelengthNm: number,
  aim: AimOptions,
): number {
  const deg = (fieldRad * 180) / Math.PI;
  const p = imagePointOf(system, deg, 0, wavelengthNm, aim);
  return Math.hypot(p.x, p.y);
}

/**
 * Tabulate the forward chief-ray map over `[0, maxFieldDeg]`.
 *
 * Costs `nodes + 1` forward traces. The node at the origin is not traced: the
 * map is odd, so it is exactly zero, and `imagePointOf` short-circuits it
 * anyway.
 */
export function buildFieldMap(system: OpticalSystem, options: FieldMapOptions): FieldMap {
  const { maxFieldDeg } = options;
  const nodes = options.nodes ?? 64;
  if (!(maxFieldDeg > 0) || !Number.isFinite(maxFieldDeg)) {
    throw new Error(`buildFieldMap: maxFieldDeg must be finite and positive, got ${maxFieldDeg}`);
  }
  // Four is the stencil; the floor is higher because a table too coarse to
  // resolve its own fourth difference reports an error estimate that is noise.
  if (!Number.isInteger(nodes) || nodes < 4) {
    throw new Error(`buildFieldMap: nodes must be an integer >= 4, got ${nodes}`);
  }
  const { wavelengthNm } = options;
  if (!(wavelengthNm > 0)) {
    throw new Error(`buildFieldMap: wavelengthNm must be positive, got ${wavelengthNm}`);
  }
  const aim = options.aim ?? {};

  const maxFieldRad = (maxFieldDeg * Math.PI) / 180;
  const spacingRad = maxFieldRad / nodes;
  const radii = new Float64Array(nodes + 2);
  for (let k = 1; k <= nodes + 1; k++) {
    radii[k] = tracedRadius(system, k * spacingRad, wavelengthNm, aim);
    // A map that is not monotone is not invertible, and every user of this
    // table inverts it. On a real system that means the field has run past
    // where the chief ray still clears the optics — § 2f's diagonal wall is one
    // — and the honest answer is the refusal rather than a table with two
    // answers in it.
    if (!(radii[k]! > radii[k - 1]!)) {
      throw new Error(
        `buildFieldMap: the traced image radius stopped increasing at ` +
          `${((k * spacingRad * 180) / Math.PI).toPrecision(6)}° ` +
          `(${radii[k - 1]!.toPrecision(6)} mm then ${radii[k]!.toPrecision(6)} mm) — ` +
          `the chief-ray map is not invertible there, so no pixel outside it has a ` +
          `field direction to read a radiance at`,
      );
    }
  }

  let fourth = 0;
  for (let k = 0; k + 4 <= nodes + 1; k++) {
    const d =
      radii[k + 4]! - 4 * radii[k + 3]! + 6 * radii[k + 2]! - 4 * radii[k + 1]! + radii[k]!;
    fourth = Math.max(fourth, Math.abs(d));
  }
  const errorEstimateMm = (3 / 128) * fourth;
  const maxRadiusMm = radii[nodes]!;

  /** The four nodes bracketing interval `k`, with the axis mirror below it. */
  const stencil = (k: number): [number, number, number, number] => [
    // r is odd through the axis, so the node below the first interval is the
    // mirror of the node above it. That is the map, not a boundary condition
    // invented for it, and it is what makes the axis exact (§ 6s.1).
    k === 0 ? -radii[1]! : radii[k - 1]!,
    radii[k]!,
    radii[k + 1]!,
    radii[k + 2]!,
  ];

  const intervalOf = (fieldRad: number): { k: number; t: number } => {
    const s = fieldRad / spacingRad;
    let k = Math.floor(s);
    if (k < 0) k = 0;
    if (k > nodes - 1) k = nodes - 1;
    return { k, t: s - k };
  };

  const radiusAt = (fieldRad: number): number => {
    if (!(fieldRad >= 0) || fieldRad > maxFieldRad * (1 + 1e-12)) {
      throw new Error(
        `FieldMap: field ${((fieldRad * 180) / Math.PI).toPrecision(6)}° is outside the ` +
          `tabulated range [0, ${maxFieldDeg}°] — build the map over the span it will be ` +
          `queried on rather than extrapolating off the end of it`,
      );
    }
    const { k, t } = intervalOf(fieldRad);
    const [y0, y1, y2, y3] = stencil(k);
    return lagrange4(y0, y1, y2, y3, t);
  };

  const radiusSlopeAt = (fieldRad: number): number => {
    const { k, t } = intervalOf(fieldRad);
    const [y0, y1, y2, y3] = stencil(k);
    return lagrange4Slope(y0, y1, y2, y3, t) / spacingRad;
  };

  const fieldAt = (radiusMm: number): number => {
    if (radiusMm === 0) return 0;
    if (!(radiusMm > 0) || radiusMm > maxRadiusMm) {
      throw new Error(
        `FieldMap: image radius ${radiusMm} mm is outside the tabulated range ` +
          `[0, ${maxRadiusMm}] mm (${maxFieldDeg}° of field) — build the map over the span ` +
          `it will be queried on rather than extrapolating off the end of it`,
      );
    }
    // Bracket on the table, which is monotone by the check above, then solve
    // the local cubic. Newton rather than bisection because the interpolant's
    // own derivative is in hand and the map is very nearly linear over one
    // interval — the seed is already correct to the curvature.
    let lo = 0;
    let hi = nodes;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (radii[mid]! <= radiusMm) lo = mid;
      else hi = mid;
    }
    const [y0, y1, y2, y3] = stencil(lo);
    let t = (radiusMm - y1) / (y2 - y1);
    for (let i = 0; i < 8; i++) {
      const f = lagrange4(y0, y1, y2, y3, t) - radiusMm;
      const d = lagrange4Slope(y0, y1, y2, y3, t);
      if (d === 0) break;
      const step = f / d;
      t -= step;
      if (Math.abs(step) < 1e-16) break;
    }
    return (lo + t) * spacingRad;
  };

  const solidAnglePerArea = (radiusMm: number): number => {
    const fieldRad = fieldAt(radiusMm);
    const slope = radiusSlopeAt(fieldRad);
    if (!(slope > 0)) {
      throw new Error(`FieldMap: dr/dθ is ${slope} at ${radiusMm} mm — the map is not invertible`);
    }
    // On the axis both factors are the same limit: sin θ/r → dθ/dr as r → 0, so
    // the product is (dθ/dr)². Exact, and it is what makes a uniform sky's
    // central pixel a closed form (1/f² on a system that images at f) rather
    // than a division of two small numbers.
    if (radiusMm === 0) return 1 / (slope * slope);
    return (Math.sin(fieldRad) / radiusMm) * (1 / slope);
  };

  return {
    maxFieldDeg,
    maxRadiusMm,
    nodes,
    spacingRad,
    wavelengthNm,
    launchZ: aim.launchZ,
    chiefRays: nodes + 1,
    radii,
    errorEstimateMm,
    radiusAt,
    radiusSlopeAt,
    fieldAt,
    solidAnglePerArea,
  };
}

/**
 * A field angle wide enough to cover a frame's far corner, found forward.
 *
 * The one place a search is needed, and it is on the forward map where a failed
 * trace is a real answer: a system whose chief ray stops clearing the optics
 * (§ 2f's diagonal wall) cannot reach the corner, and the caller is told which
 * field it did reach rather than being handed a table that quietly stops short.
 */
function fieldCoveringRadius(
  system: OpticalSystem,
  radiusMm: number,
  wavelengthNm: number,
  aim: AimOptions,
): number {
  let deg = 0.05;
  let reached = 0;
  for (let i = 0; i < 40; i++) {
    let r: number;
    try {
      r = tracedRadius(system, (deg * Math.PI) / 180, wavelengthNm, aim);
    } catch (cause) {
      throw new Error(
        `rasterizeExtendedSource: the frame's corner is at ${radiusMm.toPrecision(6)} mm and the ` +
          `chief ray stops tracing past ${reached.toPrecision(6)}° of field — the frame reaches ` +
          `further than this system passes light, so shrink the frame or the pixel scale`,
        { cause },
      );
    }
    if (r >= radiusMm) return deg;
    reached = deg;
    deg *= 2;
  }
  throw new Error(
    `rasterizeExtendedSource: no field angle below ${deg.toPrecision(6)}° reaches the frame's ` +
      `corner at ${radiusMm.toPrecision(6)} mm`,
  );
}

export interface RasterizeExtendedOptions {
  /** Frame width in pixels. A power of two if `renderField` will consume it. */
  readonly size: number;
  readonly pixelScaleMm: number;
  readonly aim?: AimOptions;
  /** Nodes for each wavelength's field map; see `FieldMapOptions.nodes`. */
  readonly mapNodes?: number;
  /** Called once per row, per wavelength, for progress. */
  readonly onRow?: (done: number, total: number) => void;
}

export interface ExtendedSourceScene extends ImagePlaneScene {
  /** Forward chief rays the maps cost, summed over the wavelengths. */
  readonly chiefRays: number;
  /** The maps, one per wavelength sample, in the samples' own order. */
  readonly maps: readonly FieldMap[];
}

/**
 * Rasterize an extended incoherent source onto an image-plane flux grid.
 *
 * Produces the `ImagePlaneScene` `renderField` already consumes, unchanged —
 * this is the **authoring** path and nothing downstream learns that the source
 * had an angular size. That is the whole architectural point: the field-varying
 * render, the polychromatic stack and the colour integration were built at
 * step 4 and none of them has to change for a planet.
 *
 * One map per wavelength, because the chief-ray map is wavelength-dependent and
 * that dependence *is* lateral colour: a source's limb lands at a slightly
 * different radius in blue than in red, and building one map for the band would
 * delete exactly that. The maps are built here rather than accepted from the
 * caller, which is the deliberate difference from § 6s — a table nobody can
 * pass in is a table nobody can pass in wrong.
 */
export function rasterizeExtendedSource(
  system: OpticalSystem,
  radiance: SkyRadiance,
  samples: readonly WavelengthSample[],
  options: RasterizeExtendedOptions,
): ExtendedSourceScene {
  const { size, pixelScaleMm } = options;
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`rasterizeExtendedSource: size must be an integer >= 2, got ${size}`);
  }
  if (!(pixelScaleMm > 0)) {
    throw new Error(`rasterizeExtendedSource: pixelScaleMm must be positive, got ${pixelScaleMm}`);
  }
  if (samples.length === 0) throw new Error("rasterizeExtendedSource: no wavelength samples");

  const aim = options.aim ?? {};
  const centre = size / 2;
  // The far corner of the frame, in the same pixel convention
  // `rasterizePointSources` uses: index i sits at offset i − size/2.
  const cornerMm = Math.hypot(centre, centre) * pixelScaleMm;
  const pixelAreaMm2 = pixelScaleMm * pixelScaleMm;

  const planes: Float64Array[] = [];
  const maps: FieldMap[] = [];
  let chiefRays = 0;

  for (let w = 0; w < samples.length; w++) {
    const nm = samples[w]!.nm;
    const maxFieldDeg = fieldCoveringRadius(system, cornerMm, nm, aim);
    const map = buildFieldMap(system, {
      maxFieldDeg,
      wavelengthNm: nm,
      aim,
      ...(options.mapNodes === undefined ? {} : { nodes: options.mapNodes }),
    });
    maps.push(map);
    chiefRays += map.chiefRays + 1; // the covering search's last trace

    const plane = new Float64Array(size * size);
    for (let iy = 0; iy < size; iy++) {
      const dy = iy - centre;
      for (let ix = 0; ix < size; ix++) {
        const dx = ix - centre;
        const radiusMm = Math.hypot(dx, dy) * pixelScaleMm;
        const fieldRad = map.fieldAt(radiusMm);
        const fieldDeg = (fieldRad * 180) / Math.PI;
        // The azimuth is the image point's, and the field direction is at the
        // same azimuth: the systems are axially symmetric, so one traced field
        // value serves a whole ring (`imagePointOf`'s own convention, read
        // backwards).
        const azimuth = radiusMm > 0 ? Math.atan2(dy, dx) : 0;
        const fieldX = fieldDeg * Math.cos(azimuth);
        const fieldY = fieldDeg * Math.sin(azimuth);
        const l = radiance(fieldX, fieldY, nm);
        if (l === 0) continue;
        // radiance × the sky solid angle this pixel covers. The Jacobian is
        // what makes this a flux; without it the plane would be a radiance map
        // wearing a flux's units, and it would be wrong by exactly the
        // distortion (§ 5v.7's negative control).
        plane[iy * size + ix] = l * map.solidAnglePerArea(radiusMm) * pixelAreaMm2;
      }
      options.onRow?.(w * size + iy + 1, samples.length * size);
    }
    planes.push(plane);
  }

  return {
    size,
    pixelScaleMm,
    planes,
    samples,
    halfExtentMm: centre * pixelScaleMm,
    chiefRays,
    maps,
  };
}

/**
 * A disc of uniform radiance — the simplest extended source there is.
 *
 * Authored in field angle like everything else here. `radiance` is per unit
 * solid angle, so a disc of half the diameter at the same radiance delivers a
 * quarter of the flux, which is the property the point-source-limit rung uses
 * to shrink one down to a star.
 *
 * The edge is hard, and that is deliberate: a rasterizer that point-samples a
 * discontinuity is exactly where a density's flux stops being conserved
 * exactly, and § 5v.6 measures that rather than hiding it behind a soft edge.
 */
export function uniformDisc(options: {
  readonly diameterDeg: number;
  readonly radiance: number;
  readonly spectrum: (nm: number) => number;
  readonly centreXDeg?: number;
  readonly centreYDeg?: number;
}): SkyRadiance {
  const { diameterDeg, radiance, spectrum } = options;
  if (!(diameterDeg > 0)) {
    throw new Error(`uniformDisc: diameterDeg must be positive, got ${diameterDeg}`);
  }
  const cx = options.centreXDeg ?? 0;
  const cy = options.centreYDeg ?? 0;
  const rDeg = diameterDeg / 2;
  return (fieldXDeg, fieldYDeg, nm) =>
    Math.hypot(fieldXDeg - cx, fieldYDeg - cy) <= rDeg ? radiance * spectrum(nm) : 0;
}

/**
 * A disc with the classical linear limb-darkening law,
 * `I(μ)/I(0) = 1 − u·(1 − μ)`, where μ = cos of the angle between the line of
 * sight and the surface normal.
 *
 * The **law** is textbook; the coefficient is not supplied, because a real
 * `u` is measured data and depends on the star and the wavelength — the same
 * rule that keeps real dye spectra out of § 6i. A caller passing `u = 0`
 * gets `uniformDisc` back, exactly, which is how the two are related and how
 * the law's own limit is pinned.
 */
export function limbDarkenedDisc(options: {
  readonly diameterDeg: number;
  readonly radiance: number;
  readonly spectrum: (nm: number) => number;
  /** Linear limb-darkening coefficient, dimensionless, in [0, 1]. */
  readonly u: number;
  readonly centreXDeg?: number;
  readonly centreYDeg?: number;
}): SkyRadiance {
  const { diameterDeg, radiance, spectrum, u } = options;
  if (!(diameterDeg > 0)) {
    throw new Error(`limbDarkenedDisc: diameterDeg must be positive, got ${diameterDeg}`);
  }
  if (!(u >= 0) || u > 1) {
    throw new Error(`limbDarkenedDisc: u must be in [0, 1], got ${u}`);
  }
  const cx = options.centreXDeg ?? 0;
  const cy = options.centreYDeg ?? 0;
  const rDeg = diameterDeg / 2;
  return (fieldXDeg, fieldYDeg, nm) => {
    const s = Math.hypot(fieldXDeg - cx, fieldYDeg - cy) / rDeg;
    if (s > 1) return 0;
    // μ = cos(asin(s)) on a sphere seen from far away — the projected radius is
    // the sine of the surface angle, so this is the sphere's geometry and not
    // an interpolation across the disc.
    const mu = Math.sqrt(Math.max(0, 1 - s * s));
    return radiance * spectrum(nm) * (1 - u * (1 - mu));
  };
}
