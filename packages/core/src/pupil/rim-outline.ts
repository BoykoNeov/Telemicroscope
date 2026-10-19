/**
 * The exit layout's outline: `exitRim`'s traced rim rays joined into the closed
 * curve the transform keeps (§ 2v).
 *
 * The rim rays are aimed evenly in AIM angle, so the landing points are samples
 * of a periodic curve z(θ) = x(θ) + i·y(θ) at equal steps, and their
 * trigonometric interpolant is that curve to the series' own tail — on a smooth
 * rim, rounding. Joining them linearly in EXIT angle instead (§ 2l–§ 2u) is a
 * polygon: off the axis the rim is not centred on the chief ray, so it cut inside
 * the traced rim on one side and reached past it on the other, 2.5e-4 of the oil
 * 100×'s light each way at 20 µm (register item 43).
 *
 * Where the reach varies around the rim — some azimuths' stop rim ray does not
 * exist, and the edge is the farthest ray that does — the curve has a corner a
 * trigonometric series rings at, and the outline stays the polygon: neither is
 * the rim there (on the DIN 4× at 1.1 mm the polygon misplaces 6.8e-4 of the
 * area, the curve 3.8e-4; register item 43). On a circle about the chief ray
 * both are the circle, and the polygon is kept for its exact ray radii.
 */
export interface RimOutline {
  /** Inside the outline? The chief ray (the origin) always is. */
  readonly inside: (px: number, py: number) => boolean;
  /** The outline's radius along exit angle φ. */
  readonly radiusAt: (phi: number) => number;
  /** The area it encloses. */
  readonly area: number;
  /** Which construction: the trigonometric curve; the polygon where the reach varies; or the polygon on a circle about the chief ray. */
  readonly scheme: "curve" | "polygon" | "circle";
}

/** Table points per rim ray: brackets the Newton step that finds the curve's radius. */
const TABLE_PER_RAY = 16;

/**
 * The outline through `rim` (aim order, evenly spaced from aim angle 0), each
 * point divided by `scale`.
 */
export function rimOutline(
  rim: readonly { readonly px: number; readonly py: number; readonly reach: number }[],
  scale: number,
): RimOutline {
  const n = rim.length;
  if (n < 4 || n % 2 !== 0) throw new Error(`rim outline: needs an even number of rim rays ≥ 4, got ${n}`);
  const xs = Float64Array.from(rim, (p) => p.px / scale);
  const ys = Float64Array.from(rim, (p) => p.py / scale);
  const reach0 = rim[0]!.reach;
  if (!rim.every((p) => p.reach === reach0)) return polygonOutline(xs, ys, "polygon");
  // A circle about the chief ray — the axis of a symmetric system — is the
  // polygon's too, and there the polygon keeps each ray's own radius where the
  // transform's grid can sit on the rim exactly (§ 2v).
  const radii = Array.from(xs, (x, k) => Math.hypot(x, ys[k]!));
  const rMin = Math.min(...radii);
  if (Math.max(...radii) - rMin <= CIRCLE * rMin) return polygonOutline(xs, ys, "circle");
  return curveOutline(xs, ys);
}

/**
 * Rim radii this close, relative, are a circle about the chief ray. On the axis
 * they spread 3e-16 (DIN 4×, the hero achromat) to 6e-15 (oil 100×); off it the
 * spread grows linearly with field, 1.8e-6 at 0.1 µm on the DIN 4×, so a rim
 * reaches 1e-12 only within ~1e-10 mm of the axis. Which side a field falls on
 * can only flip a grid point lying on the rim to the last bit.
 */
const CIRCLE = 1e-12;

/** The polygon `rimOutline` keeps where the reach varies — and § 2l–§ 2u kept everywhere. */
export function rimPolygon(
  rim: readonly { readonly px: number; readonly py: number }[],
  scale: number,
): RimOutline {
  return polygonOutline(
    Float64Array.from(rim, (p) => p.px / scale),
    Float64Array.from(rim, (p) => p.py / scale),
    "polygon",
  );
}

/** The trigonometric interpolant of equally spaced samples, its radius found by Newton on the exit angle. */
function curveOutline(xs: Float64Array, ys: Float64Array): RimOutline {
  const n = xs.length;
  const half = n / 2;
  // c_m for m = −(half − 1) … half − 1 at index m + half − 1, and the Nyquist
  // term c_half, carried as c_half·cos(half·θ): the interpolant with no
  // frequency past the samples'.
  const cre = new Float64Array(n - 1);
  const cim = new Float64Array(n - 1);
  let nyRe = 0;
  let nyIm = 0;
  for (let m = -(half - 1); m <= half; m++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const a = (-2 * Math.PI * m * k) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      re += xs[k]! * c - ys[k]! * s;
      im += xs[k]! * s + ys[k]! * c;
    }
    if (m === half) {
      nyRe = re / n;
      nyIm = im / n;
    } else {
      cre[m + half - 1] = re / n;
      cim[m + half - 1] = im / n;
    }
  }
  // z(θ) and dz/dθ, by powers of e^{iθ}.
  const evaluate = (theta: number): [number, number, number, number] => {
    const er = Math.cos(theta);
    const ei = Math.sin(theta);
    let zr = cre[half - 1]!;
    let zi = cim[half - 1]!;
    let dr = 0;
    let di = 0;
    let pr = 1;
    let pi = 0;
    for (let m = 1; m < half; m++) {
      const t = pr * er - pi * ei;
      pi = pr * ei + pi * er;
      pr = t;
      // e^{imθ} = (pr, pi), e^{−imθ} = (pr, −pi).
      const ar = cre[half - 1 + m]!;
      const ai = cim[half - 1 + m]!;
      const br = cre[half - 1 - m]!;
      const bi = cim[half - 1 - m]!;
      const ur = ar * pr - ai * pi;
      const ui = ar * pi + ai * pr;
      const vr = br * pr + bi * pi;
      const vi = bi * pr - br * pi;
      zr += ur + vr;
      zi += ui + vi;
      // d/dθ: i·m·u − i·m·v.
      dr += -m * (ui - vi);
      di += m * (ur - vr);
    }
    const ch = Math.cos(half * theta);
    const sh = Math.sin(half * theta);
    zr += nyRe * ch;
    zi += nyIm * ch;
    dr -= half * nyRe * sh;
    di -= half * nyIm * sh;
    return [zr, zi, dr, di];
  };

  // A table of the curve, ordered by exit angle: it must turn once around the
  // chief ray, monotone, or the outline is no radius function of exit angle.
  const size = TABLE_PER_RAY * n;
  const raw = Array.from({ length: size }, (_, j) => evaluate((2 * Math.PI * j) / size));
  const phi0 = raw.map(([zr, zi]) => Math.atan2(zi, zr));
  let turn = 0;
  for (let j = 0; j < size; j++) turn += wrap(phi0[(j + 1) % size]! - phi0[j]!);
  const dir = turn > 0 ? 1 : -1;
  if (Math.abs(turn - dir * 2 * Math.PI) > 1e-9) {
    throw new Error(`rim outline: the rim turns ${turn} rad around the chief ray, not once`);
  }
  // Index i along increasing exit angle: aim angle dir·2πi/size.
  const theta = new Float64Array(size + 1);
  const angle = new Float64Array(size + 1);
  const radius = new Float64Array(size + 1);
  for (let i = 0; i <= size; i++) {
    const j = dir > 0 ? i % size : (size - i) % size;
    theta[i] = (dir * 2 * Math.PI * i) / size;
    radius[i] = Math.hypot(raw[j]![0], raw[j]![1]);
    if (i === 0) angle[i] = phi0[j]!;
    else {
      const step = wrap(phi0[j]! - phi0[dir > 0 ? (j - 1 + size) % size : (j + 1) % size]!);
      if (!(step > 0)) throw new Error("rim outline: the rim doubles back in exit angle");
      angle[i] = angle[i - 1]! + step;
    }
  }

  // Newton on arg z(θ) = φ from the bracketing table segment's linear guess.
  const solve = (i: number, phi: number): number => {
    const t = (phi - angle[i]!) / (angle[i + 1]! - angle[i]!);
    let th = theta[i]! + (theta[i + 1]! - theta[i]!) * t;
    for (let it = 0; it < 12; it++) {
      const [zr, zi, dr, di] = evaluate(th);
      const f = wrap(Math.atan2(zi, zr) - phi);
      const fp = (zr * di - zi * dr) / (zr * zr + zi * zi);
      const step = f / fp;
      th -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    const [zr, zi] = evaluate(th);
    return Math.hypot(zr, zi);
  };
  const segment = (phi: number): [number, number] => {
    // φ shifted into [angle[0], angle[0] + 2π).
    let p = angle[0]! + ((((phi - angle[0]!) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    if (p >= angle[size]!) p = angle[0]!;
    let lo = 0;
    let hi = size;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (angle[mid]! <= p) lo = mid;
      else hi = mid;
    }
    return [lo, p];
  };
  const linear = (i: number, p: number) =>
    radius[i]! + ((radius[i + 1]! - radius[i]!) * (p - angle[i]!)) / (angle[i + 1]! - angle[i]!);

  // How far the curve leaves the table's chords: points farther than four times
  // that from the chord need no Newton step.
  let chord = 0;
  let rMax = 0;
  for (let i = 0; i < size; i++) {
    const mid = 0.5 * (angle[i]! + angle[i + 1]!);
    chord = Math.max(chord, Math.abs(solve(i, mid) - linear(i, mid)));
    rMax = Math.max(rMax, radius[i]!);
  }
  const margin = 4 * chord + 64 * Number.EPSILON * rMax;

  // ½∮ Im(z̄·dz) = π·Σ m·|c_m|²; the Nyquist cosine adds nothing to it.
  let moment = 0;
  for (let m = -(half - 1); m < half; m++) {
    const k = m + half - 1;
    moment += m * (cre[k]! * cre[k]! + cim[k]! * cim[k]!);
  }

  return {
    scheme: "curve",
    inside: (px, py) => {
      const r = Math.hypot(px, py);
      if (r === 0) return true;
      const [i, p] = segment(Math.atan2(py, px));
      const lin = linear(i, p);
      if (r <= lin - margin) return true;
      if (r >= lin + margin) return false;
      return r <= solve(i, p);
    },
    radiusAt: (phi) => {
      const [i, p] = segment(phi);
      return solve(i, p);
    },
    area: Math.PI * Math.abs(moment),
  };
}

/**
 * The rim's polygon in exit angle: radius linear in angle between the landings
 * — exact for a circle about the chief ray, and the only construction that keeps
 * a vignetted rim's corner where it is.
 */
function polygonOutline(xs: Float64Array, ys: Float64Array, scheme: "polygon" | "circle"): RimOutline {
  const pts = Array.from(xs, (x, k) => ({ a: Math.atan2(ys[k]!, x), r: Math.hypot(x, ys[k]!) })).sort(
    (u, v) => u.a - v.a,
  );
  const n = pts.length;
  const angles = Float64Array.from(pts, (p) => p.a);
  const radii = Float64Array.from(pts, (p) => p.r);
  const radiusAt = (a: number) => {
    // First rim angle above a; the one before it (wrapping) brackets it.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (angles[mid]! <= a) lo = mid + 1;
      else hi = mid;
    }
    const j = lo % n;
    const i = (lo - 1 + n) % n;
    let span = angles[j]! - angles[i]!;
    let at = a - angles[i]!;
    if (span <= 0) span += 2 * Math.PI;
    if (at < 0) at += 2 * Math.PI;
    return radii[i]! + ((radii[j]! - radii[i]!) * at) / span;
  };
  // ½∮ r(φ)² dφ, r linear in φ between rim angles: exact per segment.
  let area = 0;
  for (let k = 0; k < n; k++) {
    let span = angles[(k + 1) % n]! - angles[k]!;
    if (span <= 0) span += 2 * Math.PI;
    const p = radii[k]!;
    const q = radii[(k + 1) % n]!;
    area += (span * (p * p + p * q + q * q)) / 6;
  }
  return {
    scheme,
    inside: (px, py) => {
      const r = Math.hypot(px, py);
      if (r === 0) return true;
      return r <= radiusAt(Math.atan2(py, px));
    },
    radiusAt: (phi) => radiusAt(wrap(phi)),
    area,
  };
}

/** An angle into (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
