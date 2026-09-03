import { getMedium } from "../materials/catalog";
import { Prescription, unfoldedTwin } from "../trace/prescription";

/**
 * The distortion map's series — third AND fifth order — as an exact chief-ray
 * trace carried in truncated power series rather than in numbers.
 *
 * § 6ck wrote the map out as `h/r = mu(1 + a·r² + b·r⁴ + …)` and named `a`: it
 * is `ΣS_V` under a normalisation, which is third-order theory and which
 * `analysis/seidel` computes. It could not name `b`. The quartic is fifth-order
 * distortion, `seidelSums` stops at third, and every reading of `b` on this
 * ladder has been a fit to traced points — a measurement with a step size and a
 * floor, not a coefficient the prescription hands over.
 *
 * ## Why a series trace rather than a fifth-order sum
 *
 * The textbook route to `b` is Buchdahl's fifth-order coefficients, and that is
 * exactly the kind of object the project's hard rule forbids writing down from
 * memory: a long algebraic set whose transcription cannot be checked against
 * anything except itself. § 5d.2 has already paid once for a register naming
 * the wrong external number.
 *
 * The route taken here transcribes nothing. Distortion is a property of the
 * CHIEF ray alone — it is the field⁵ term with no aperture in it — and with the
 * stop at surface 0 the chief ray is not something to be solved for: it is the
 * ray from the field point through surface 0's vertex, which is where the stop's
 * centre sits. So the whole map is one exact ray trace, and an exact ray trace
 * is elementary geometry: a quadratic for the sphere intersection, a square root
 * for Snell. Run that geometry on truncated power series in the field parameter
 * instead of on numbers and the coefficients fall out at machine precision, with
 * no step size, no fit, and no differencing floor. It is the same physics the
 * exact tracer runs, differentiated symbolically by carrying the terms along.
 *
 * That is why this is a SECOND tracer and not a call into `trace/sequential`.
 * The duplication is deliberate and is the point: the rungs that pin this
 * compare it against `trace/sequential` on the identical prescription, and two
 * machineries that share no line agreeing to the last bits is evidence, where a
 * wrapper agreeing with itself would be none. The maintenance cost — a sphere
 * intersection and a Snell that must be kept honest in two places — is taken
 * knowingly, and the rungs are what keep them honest.
 *
 * ## What comes out, and in which direction the series runs
 *
 * The trace produces the image height as a series in the FIELD PARAMETER ε,
 *
 *     r(ε) = m·ε·(1 + A·ε² + B·ε⁴ + …)
 *
 * where ε is the object height (mm) for a finite conjugate and the TANGENT of
 * the field angle for an object at infinity — the two spellings of "how far off
 * axis", each being the one that makes the paraxial map linear. `r` is measured
 * at the paraxial image plane of the object plane, computed here from the same
 * surface list by the ordinary y–u recursion.
 *
 * § 6ck's map runs the other way — object height as a series in image radius —
 * because that is what `objectHeightForImageRadius` answers and what the mosaic
 * consumes. Inverting the series is two lines and is done here so no caller has
 * to get it right twice:
 *
 *     mu = 1/m        a = −A/m²        b = (3A² − B)/m⁴
 *
 * The `3A²` is not a correction anyone should carry in their head: it is what a
 * quartic picks up when a cubic is inverted, and it is the same algebra that
 * puts the `−a²` into § 6ck's `D_read(r) = a + (2b − a²)r²`.
 *
 * ## The closed forms this is pinned against (test/distortion-series.test.ts)
 *
 *  - **A single spherical refracting surface with the stop on it.** The chief
 *    ray goes through the vertex, where the surface normal IS the axis, so it
 *    refracts as though at a plane: sin θ′ = (n/n′) sin θ exactly. It then runs
 *    straight to the image plane, so with ν = n/n′ and t = tan θ,
 *
 *        r/r_par = [1 + (1 − ν²)·t²]^(−1/2)
 *
 *    — exact at every order, and with no curvature in it at all. A single
 *    spherical surface stopped at its own vertex distorts by an amount that
 *    depends on the two indices and the field angle and NOT on its radius,
 *    which is a claim strong enough to be worth a rung on its own. Expanded,
 *    A = −(1 − ν²)/2 and B = (3/8)(1 − ν²)² per unit t², t⁴.
 *  - **A plane-parallel plate with the stop on its front face.** The same
 *    vertex refraction, then a straight run of `d` through the glass, then an
 *    exit parallel to the entry and displaced. The two pieces do not share a
 *    denominator, so with K = −dν/s (the glass's share of the object distance),
 *
 *        r/r_par = 1 − K(1 − ν²)t²/2 + K(3/8)(1 − ν²)²t⁴
 *
 *    and B/A² = 3/(2K) — a ratio the caller sets by choosing `d` and `s`. This
 *    is the anchor that DISCRIMINATES: the single surface has B = (3/2)A² and
 *    the concentric control below has both identically zero, so between them a
 *    bug that computed the quartic as (3/2)A² everywhere would pass unnoticed.
 *    The plate refuses it at any thickness.
 *  - **A concentric system** — every surface centred on the stop's vertex — is
 *    a zero at all orders, because the chief ray meets every one of them along
 *    its normal and is never deviated. The marginal ray still is, so there is a
 *    real image to measure against; what vanishes is the distortion and not the
 *    system.
 *
 * SCOPE, and each restriction is a thing that would otherwise need its own pin:
 *
 *  - **The stop must be surface 0.** That is what makes the chief ray the
 *    vertex ray and removes the solve. § 6cm lifted the same restriction for
 *    the third-order sums, where the launch that reaches a displaced stop is a
 *    two-unknown LINEAR problem; at fifth order it is not linear, and the
 *    implicit solve for it is a second thing to pin rather than a free
 *    generalisation. A system whose stop is elsewhere is reversed until it
 *    leads, which is the route § 6ch.1 already takes for ΣS_V.
 *  - **Refracting spherical surfaces only.** A conic or asphere changes the
 *    intersection, and a mirror changes which root of it is the forward one and
 *    puts the chain into the unfolded −z convention. Both are tractable and
 *    neither is pinned, so both throw.
 */

/** Truncated at ε⁵: the highest term the map's quartic needs. */
const ORDER = 5;
const WIDTH = ORDER + 1;

/** A power series in the field parameter ε, coefficients of ε⁰ … ε⁵. */
type Jet = readonly number[];

const jetConst = (v: number): number[] => {
  const out = new Array<number>(WIDTH).fill(0);
  out[0] = v;
  return out;
};
const jetAdd = (a: Jet, b: Jet): number[] => a.map((v, i) => v + b[i]!);
const jetSub = (a: Jet, b: Jet): number[] => a.map((v, i) => v - b[i]!);
const jetScale = (a: Jet, k: number): number[] => a.map((v) => v * k);

const jetMul = (a: Jet, b: Jet): number[] => {
  const out = new Array<number>(WIDTH).fill(0);
  for (let i = 0; i < WIDTH; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; i + j < WIDTH; j++) out[i + j]! += a[i]! * b[j]!;
  }
  return out;
};

/**
 * Series division and square root both need a non-zero CONSTANT term — the
 * value the quantity takes on the axis. Every use below is a quantity that is
 * ~1 on axis (a direction cosine, an intersection discriminant), never an odd
 * one like a ray height, and the guard says so out loud rather than returning
 * an Infinity that would only surface as a NaN coefficient much later.
 */
const jetDiv = (a: Jet, b: Jet, what: string): number[] => {
  if (b[0] === 0) throw new Error(`distortionSeries: ${what} vanishes on axis`);
  const q = new Array<number>(WIDTH).fill(0);
  for (let k = 0; k < WIDTH; k++) {
    let s = a[k]!;
    for (let i = 1; i <= k; i++) s -= b[i]! * q[k - i]!;
    q[k] = s / b[0]!;
  }
  return q;
};

const jetSqrt = (a: Jet, what: string): number[] => {
  if (!(a[0]! > 0)) throw new Error(`distortionSeries: ${what} is not positive on axis`);
  const r = new Array<number>(WIDTH).fill(0);
  r[0] = Math.sqrt(a[0]!);
  for (let k = 1; k < WIDTH; k++) {
    let s = a[k]!;
    for (let i = 1; i < k; i++) s -= r[i]! * r[k - i]!;
    r[k] = s / (2 * r[0]!);
  }
  return r;
};

export interface DistortionSeriesOptions {
  /**
   * Axial object distance in front of surface 0 (mm, positive). Omitted, the
   * object is at infinity and the field parameter is the tangent of the field
   * angle; given, the object is at that distance and the field parameter is the
   * object height in mm.
   */
  readonly objectDistanceMm?: number;
}

export interface DistortionSeriesResult {
  /**
   * Image height at the paraxial image plane as a series in the field
   * parameter: coefficients of ε⁰ … ε⁵. The even ones are zero by the system's
   * rotational symmetry and are reported rather than dropped, because nothing
   * in the arithmetic below knows that — their size against the linear term is
   * a free check that the trace did not lose the symmetry it should have.
   */
  readonly imageHeightSeries: readonly number[];
  /** Paraxial image height per unit field parameter — the ε¹ coefficient. */
  readonly magnification: number;
  /**
   * § 6ck's inverse map `h/r = mu(1 + a·r² + b·r⁴ + …)`: the field parameter
   * per unit image radius, and the third- and fifth-order coefficients of the
   * map the mosaic actually reads.
   */
  readonly mu: number;
  readonly a: number;
  readonly b: number;
  /**
   * Paraxial image plane, as a signed distance from the LAST surface's vertex
   * (mm). Reported because a caller comparing against a traced map has to
   * measure its radius in the same plane, and this module computes that plane
   * from the surface list rather than reading the last thickness.
   */
  readonly imageDistanceMm: number;
}

export function distortionSeries(
  prescriptionIn: Prescription,
  wavelengthNm: number,
  opts: DistortionSeriesOptions = {},
): DistortionSeriesResult {
  const prescription = unfoldedTwin(prescriptionIn);
  const { objectDistanceMm } = opts;
  if (objectDistanceMm !== undefined && !(objectDistanceMm > 0 && Number.isFinite(objectDistanceMm))) {
    throw new Error(
      "distortionSeries: objectDistanceMm must be a positive finite distance (omit it for infinity)",
    );
  }
  const surfaces = prescription.surfaces;
  if (surfaces.length === 0) throw new Error("distortionSeries: empty prescription");
  if (!surfaces[0]!.isStop) {
    throw new Error(
      "distortionSeries: the stop must be surface 0 — that is what makes the chief ray the " +
        "vertex ray and removes the fifth-order launch solve (reverse the system if it is not)",
    );
  }

  const n: number[] = [];
  const nAfter: number[] = [];
  const vertexZ: number[] = [];
  {
    let index = getMedium(prescription.objectMedium ?? "AIR").n(wavelengthNm);
    let z = 0;
    for (const s of surfaces) {
      if ((s.conic ?? 0) !== 0 || (s.asphereCoeffs?.length ?? 0) > 0) {
        throw new Error("distortionSeries: spherical surfaces only (a conic/asphere is unpinned here)");
      }
      if (s.kind !== "refract") {
        throw new Error("distortionSeries: refracting surfaces only (a mirror's forward root is unpinned here)");
      }
      if (!s.medium) throw new Error("distortionSeries: refract surface needs a medium");
      const next = getMedium(s.medium).n(wavelengthNm);
      n.push(index);
      nAfter.push(next);
      vertexZ.push(z);
      z += s.thickness;
      index = next;
    }
  }

  // The paraxial image plane of the object plane, from the ordinary y–u
  // recursion on the same surface list. It is the plane the distortion is
  // measured in, so it is computed here rather than taken from the last
  // thickness, which an authored prescription is free to point anywhere.
  let imageDistanceMm: number;
  {
    let y = 1;
    let u = objectDistanceMm === undefined ? 0 : 1 / objectDistanceMm;
    for (let k = 0; k < surfaces.length; k++) {
      const phi = surfaces[k]!.curvature * (nAfter[k]! - n[k]!);
      u = (n[k]! * u - y * phi) / nAfter[k]!;
      if (k < surfaces.length - 1) y += u * surfaces[k]!.thickness;
    }
    if (!(Math.abs(u) > 0)) throw new Error("distortionSeries: afocal system — the object plane has no image");
    imageDistanceMm = -y / u;
    if (!Number.isFinite(imageDistanceMm)) {
      throw new Error("distortionSeries: the object plane images at infinity");
    }
  }

  // The chief ray STARTS at surface 0's vertex, exactly, at every order: the
  // stop is surface 0 and the chief ray is the one through the stop's centre.
  // So surface 0 has no intersection to solve — only a refraction, at a point
  // where the normal is the axis.
  let x: number[] = jetConst(0);
  let z: number[] = jetConst(0);
  let dx: number[];
  let dz: number[];
  {
    // Direction of the incoming chief ray, normalised. For a finite object the
    // ray runs from (ε, −s) down to the vertex, so its slope is −ε/s; at
    // infinity ε IS the slope, and the sign is chosen so that a positive ε
    // gives a positive image height in the ordinary erect case.
    const slope = new Array<number>(WIDTH).fill(0);
    slope[1] = objectDistanceMm === undefined ? 1 : -1 / objectDistanceMm;
    const norm = jetSqrt(jetAdd(jetConst(1), jetMul(slope, slope)), "the chief ray's direction norm");
    dx = jetDiv(slope, norm, "the chief ray's direction norm");
    dz = jetDiv(jetConst(1), norm, "the chief ray's direction norm");
  }

  for (let k = 0; k < surfaces.length; k++) {
    const c = surfaces[k]!.curvature;

    if (k > 0) {
      // Intersection with the sphere z_local = (c/2)(x² + z_local²), which is
      // the sphere through the vertex with centre on the axis — the same
      // surface `geometry/surfaces` intersects, written as its implicit form so
      // that the quadratic's coefficients are series and its root is one
      // square root rather than a Newton iteration.
      const zl = jetSub(z, jetConst(vertexZ[k]!));
      const bq = jetSub(
        jetScale(jetAdd(jetMul(x, dx), jetMul(zl, dz)), c),
        dz,
      );
      const cq = jetSub(jetScale(jetAdd(jetMul(x, x), jetMul(zl, zl)), c / 2), zl);
      const disc = jetSub(jetMul(bq, bq), jetScale(cq, 2 * c));
      // The near root, in the numerically stable spelling 2C/(−B + √D): the
      // other one is the far side of the sphere. On axis √D is exactly 1 for a
      // unit direction, so the denominator is 2 + c·(the gap behind), and it
      // vanishes only if the previous vertex sits at the sphere's own diameter.
      const denom = jetAdd(jetScale(bq, -1), jetSqrt(disc, "the sphere intersection discriminant"));
      const t = jetDiv(jetScale(cq, 2), denom, `the near intersection root at surface ${k}`);
      x = jetAdd(x, jetMul(t, dx));
      z = jetAdd(z, jetMul(t, dz));
    }

    // Snell, in vector form, on the surface normal ∇(z_local − (c/2)(x² +
    // z_local²)) = (−c·x, 1 − c·z_local). It points along +z on the axis, which
    // is the side the ray arrives from, so cos θᵢ needs no sign branch — and a
    // branch is what a series cannot take.
    const zl = jetSub(z, jetConst(vertexZ[k]!));
    const nxRaw = jetScale(x, -c);
    const nzRaw = jetSub(jetConst(1), jetScale(zl, c));
    const nLen = jetSqrt(jetAdd(jetMul(nxRaw, nxRaw), jetMul(nzRaw, nzRaw)), `surface ${k}'s normal`);
    const nx = jetDiv(nxRaw, nLen, `surface ${k}'s normal`);
    const nz = jetDiv(nzRaw, nLen, `surface ${k}'s normal`);

    const cosI = jetAdd(jetMul(dx, nx), jetMul(dz, nz));
    const ratio = n[k]! / nAfter[k]!;
    const cosT = jetSqrt(
      jetSub(jetConst(1), jetScale(jetSub(jetConst(1), jetMul(cosI, cosI)), ratio * ratio)),
      `surface ${k}'s refracted cosine (total internal reflection on axis?)`,
    );
    const push = jetSub(cosT, jetScale(cosI, ratio));
    dx = jetAdd(jetScale(dx, ratio), jetMul(push, nx));
    dz = jetAdd(jetScale(dz, ratio), jetMul(push, nz));
  }

  // Straight to the paraxial image plane.
  const zImage = vertexZ[surfaces.length - 1]! + imageDistanceMm;
  const run = jetSub(jetConst(zImage), z);
  const imageHeightSeries = jetAdd(x, jetMul(jetDiv(dx, dz, "the exit ray's z direction cosine"), run));

  const magnification = imageHeightSeries[1]!;
  if (!(Math.abs(magnification) > 0)) {
    throw new Error("distortionSeries: the paraxial image height vanishes — no map to expand");
  }
  const forwardA = imageHeightSeries[3]! / magnification;
  const forwardB = imageHeightSeries[5]! / magnification;
  const m2 = magnification * magnification;
  return {
    imageHeightSeries,
    magnification,
    mu: 1 / magnification,
    a: -forwardA / m2,
    b: (3 * forwardA * forwardA - forwardB) / (m2 * m2),
    imageDistanceMm,
  };
}
