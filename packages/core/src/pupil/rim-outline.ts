/**
 * The exit layout's outline: `exitRim`'s traced rim rays joined into the closed
 * curve the transform keeps (§ 2v, § 2y).
 *
 * The rim rays are aimed evenly in AIM angle, so the landing points are samples
 * of a periodic curve z(θ) = x(θ) + i·y(θ) at equal steps, and their
 * trigonometric interpolant is that curve to the series' own tail — on a smooth
 * rim, rounding. Joining them linearly in EXIT angle instead (§ 2l–§ 2u) is a
 * polygon: off the axis the rim is not centred on the chief ray, so it cut inside
 * the traced rim on one side and reached past it on the other, 2.5e-4 of the oil
 * 100×'s light each way at 20 µm (register item 43).
 *
 * Where what makes the edge changes around the rim — the stop's rim ray stops
 * existing and the edge is the farthest ray that does, or one surface hands the
 * cut to another — the rim is smooth arcs meeting at corners, which a
 * trigonometric series rings at (§ 2v: on the DIN 4× at 1.1 mm the polygon
 * misplaced 6.8e-4 of the area, the curve 3.8e-4). There `rimArcs` locates each
 * corner by bisection in aim angle and traces each arc at Chebyshev nodes, and
 * the outline is the polynomial through them, arc by arc (§ 2y). On a circle
 * about the chief ray the polygon is kept for its exact ray radii.
 */
export interface RimOutline {
  /** Inside the outline? The chief ray (the origin) always is. */
  readonly inside: (px: number, py: number) => boolean;
  /** The outline's radius along exit angle φ. */
  readonly radiusAt: (phi: number) => number;
  /** The area it encloses. */
  readonly area: number;
  /** Which construction: the trigonometric curve; arcs between located corners; the polygon on a circle about the chief ray, or `rimPolygon`'s. */
  readonly scheme: "curve" | "arcs" | "polygon" | "circle";
}

/** A rim ray: its landing, how far out its aim azimuth reached, and what made the edge there. */
export interface RimSample {
  readonly px: number;
  readonly py: number;
  readonly reach: number;
  readonly edge: string;
}

/** `RimSample.edge` where the stop's own rim ray exists. */
export const STOP_EDGE = "stop";

/**
 * The rim between two corners: its landings at the Chebyshev–Lobatto nodes of
 * aim angle θ_j = (from + to)/2 − (to − from)/2·cos(jπ/(m − 1)), j = 0 … m − 1.
 */
export interface RimArc {
  readonly edge: string;
  /** Aim angles of its ends, from < to (to may pass 2π). */
  readonly from: number;
  readonly to: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

/** What `rimArcs` traces: the stop's rim ray, and the edge of the light, at any aim angle. */
export interface RimProbe {
  /** The stop's rim ray at aim angle θ — its landing, or null where it does not exist. */
  readonly stop: (theta: number) => readonly [number, number] | null;
  /** The edge of the light along aim angle θ, to full precision. */
  readonly edge: (theta: number) => RimSample;
}

/** Table points per rim ray: brackets the Newton step that finds the curve's radius. */
const TABLE_PER_RAY = 16;

/**
 * The outline through `rim` (aim order, evenly spaced from aim angle 0), each
 * point divided by `scale`. Where the edge changes around the rim, `arcs`
 * (`rimArcs`) is the rim and is required.
 */
export function rimOutline(
  rim: readonly RimSample[],
  scale: number,
  arcs?: readonly RimArc[],
): RimOutline {
  const n = rim.length;
  if (n < 4 || n % 2 !== 0) throw new Error(`rim outline: needs an even number of rim rays ≥ 4, got ${n}`);
  const xs = Float64Array.from(rim, (p) => p.px / scale);
  const ys = Float64Array.from(rim, (p) => p.py / scale);
  const edge0 = rim[0]!.edge;
  if (!rim.every((p) => p.edge === edge0)) {
    if (arcs === undefined || arcs.length === 0) {
      throw new Error("rim outline: the edge changes around the rim — its arcs are the rim (rimArcs)");
    }
    return arcOutline(arcs, scale, n);
  }
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

/** The polygon `rimOutline` kept where the reach varies until § 2y — and § 2l–§ 2u kept everywhere. */
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

/** Nodes an arc starts at; each refinement takes m to 2m − 1, keeping every node. */
const ARC_NODES = 9;
/** No arc takes more: a smooth arc of the rim converges by 33 (§ 2y). */
const ARC_NODES_MAX = 129;
/** An arc has converged when its interpolant meets the next refinement's new nodes this close, relative to the rim. */
const ARC_TOLERANCE = 1e-13;
/** Corner bisection stops at this width in aim angle: the chord across what is left bounds 1e-18 of area. */
const CORNER_WIDTH = 1e-9;

/**
 * The rim as arcs between corners, where the edge changes around it; undefined
 * where it does not (one smooth curve, `rimOutline`'s own). `rim` is `exitRim`'s
 * evenly spaced rays; a change between two neighbours is a corner, located by
 * bisection in aim angle, and each arc is traced at Chebyshev nodes until the
 * polynomial through them stops moving.
 *
 * A cut that begins and ends between two neighbouring rays is not seen: both
 * read the same edge.
 */
export function rimArcs(rim: readonly RimSample[], probe: RimProbe): readonly RimArc[] | undefined {
  const n = rim.length;
  if (rim.every((p) => p.edge === rim[0]!.edge)) return undefined;
  const rMax = Math.max(...rim.map((p) => Math.hypot(p.px, p.py)));
  // Is aim angle θ on edge `cls`'s side? The stop's needs one ray, a cut's a
  // bisection for its reach.
  const on = (theta: number, cls: string) =>
    cls === STOP_EDGE ? probe.stop(theta) !== null : probe.edge(theta).edge === cls;
  // What each aim angle sampled so far reads; an arc's node that reads another
  // edge joins them, and the corners are located again.
  const samples = rim.map((p, k) => ({ theta: (2 * Math.PI * k) / n, edge: p.edge }));
  for (let pass = 0; ; pass++) {
    if (pass > n) throw new Error("rim outline: the rim's corners did not settle — more edges than rim rays");
    // Corners, in aim order: the last angle on the old edge, the first on the new.
    const corners: { readonly lo: number; readonly hi: number; readonly after: string }[] = [];
    for (let k = 0; k < samples.length; k++) {
      const a = samples[k]!;
      const b = samples[(k + 1) % samples.length]!;
      if (a.edge === b.edge) continue;
      // Bisect on whichever side is the stop's when one is: a single ray per step.
      const probeCls = b.edge === STOP_EDGE ? b.edge : a.edge;
      const loIsProbe = probeCls === a.edge;
      let lo = a.theta;
      let hi = k + 1 < samples.length ? b.theta : b.theta + 2 * Math.PI;
      while (hi - lo > CORNER_WIDTH) {
        const mid = 0.5 * (lo + hi);
        if (on(mid, probeCls) === loIsProbe) lo = mid;
        else hi = mid;
      }
      corners.push({ lo, hi, after: b.edge });
    }
    const arcs: RimArc[] = [];
    let found: { theta: number; edge: string } | undefined;
    for (let c = 0; c < corners.length && found === undefined; c++) {
      const start = corners[c]!;
      const end = corners[(c + 1) % corners.length]!;
      const from = start.hi;
      let to = end.lo;
      while (to <= from) to += 2 * Math.PI;
      const arc = traceArc(start.after, from, to, probe, rMax);
      if ("found" in arc) found = arc.found;
      else arcs.push(arc);
    }
    if (found === undefined) return arcs;
    const theta = found.theta % (2 * Math.PI);
    samples.push({ theta, edge: found.edge });
    samples.sort((u, v) => u.theta - v.theta);
  }
}

/**
 * One arc at Chebyshev–Lobatto nodes, refined until its tail is below the
 * tolerance — or the first node that reads another edge, a corner between two
 * samples that both read this one.
 */
function traceArc(
  edge: string,
  from: number,
  to: number,
  probe: RimProbe,
  rMax: number,
): RimArc | { readonly found: { readonly theta: number; readonly edge: string } } {
  const mid = 0.5 * (from + to);
  const half = 0.5 * (to - from);
  class Elsewhere {
    constructor(readonly theta: number, readonly edge: string) {}
  }
  const land = (u: number): readonly [number, number] => {
    const theta = mid + half * u;
    if (edge === STOP_EDGE) {
      const z = probe.stop(theta);
      if (z === null) throw new Elsewhere(theta, probe.edge(theta).edge);
      return z;
    }
    const p = probe.edge(theta);
    if (p.edge !== edge) throw new Elsewhere(theta, p.edge);
    return [p.px, p.py];
  };
  try {
    return refineArc(edge, from, to, land, rMax);
  } catch (e) {
    if (e instanceof Elsewhere) return { found: { theta: e.theta, edge: e.edge } };
    throw e;
  }
}

function refineArc(
  edge: string,
  from: number,
  to: number,
  land: (u: number) => readonly [number, number],
  rMax: number,
): RimArc {
  let m = ARC_NODES;
  let pts = Array.from(lobatto(m), land);
  // Converged when the interpolant's last two Chebyshev coefficients are below
  // the tolerance: on a smooth arc they fall faster than geometrically, and a
  // corner inside the arc holds them up (as k⁻²) until the cap refuses it.
  while (chebyshevTail(pts) > ARC_TOLERANCE * rMax) {
    const next = 2 * m - 1;
    if (next > ARC_NODES_MAX) {
      throw new Error(`rim outline: a ${edge} arc did not converge at ${m} nodes — a corner inside it no rim ray saw`);
    }
    const nu = lobatto(next);
    pts = Array.from({ length: next }, (_, j) => (j % 2 === 0 ? pts[j / 2]! : land(nu[j]!)));
    m = next;
  }
  return { edge, from, to, xs: Float64Array.from(pts, (p) => p[0]), ys: Float64Array.from(pts, (p) => p[1]) };
}

/** The larger of the last two Chebyshev coefficients' moduli, of values at the Lobatto nodes. */
function chebyshevTail(pts: readonly (readonly [number, number])[]): number {
  const n = pts.length - 1;
  let tail = 0;
  for (const k of [n - 1, n]) {
    let ax = 0;
    let ay = 0;
    for (let j = 0; j <= n; j++) {
      // Node j is cos((n − j)π/n); the end terms count half.
      const c = Math.cos((k * (n - j) * Math.PI) / n) * (j === 0 || j === n ? 0.5 : 1);
      ax += c * pts[j]![0];
      ay += c * pts[j]![1];
    }
    const f = (k === n ? 1 : 2) / n;
    tail = Math.max(tail, f * Math.hypot(ax, ay));
  }
  return tail;
}

/** Chebyshev–Lobatto nodes on [−1, 1], increasing. */
function lobatto(m: number): Float64Array {
  return Float64Array.from({ length: m }, (_, j) => (j === 0 ? -1 : j === m - 1 ? 1 : -Math.cos((j * Math.PI) / (m - 1))));
}

/** Their barycentric weights. */
function baryWeights(m: number): Float64Array {
  return Float64Array.from({ length: m }, (_, j) => (j % 2 === 0 ? 1 : -1) * (j === 0 || j === m - 1 ? 0.5 : 1));
}

/** The barycentric interpolant through (us, fs) at u. */
function bary(us: Float64Array, w: Float64Array, fs: Float64Array, u: number): number {
  let num = 0;
  let den = 0;
  for (let j = 0; j < us.length; j++) {
    const d = u - us[j]!;
    if (d === 0) return fs[j]!;
    const t = w[j]! / d;
    num += t * fs[j]!;
    den += t;
  }
  return num / den;
}

/**
 * A piece of the outline: z(t) and dz/dt on [from, to]. A closed curve is one
 * piece whose `to` meets its `from`.
 */
interface Piece {
  readonly from: number;
  readonly to: number;
  readonly closed: boolean;
  readonly evaluate: (t: number) => [number, number, number, number];
  /** Table points along it. */
  readonly table: number;
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

  // ½∮ Im(z̄·dz) = π·Σ m·|c_m|²; the Nyquist cosine adds nothing to it.
  let moment = 0;
  for (let m = -(half - 1); m < half; m++) {
    const k = m + half - 1;
    moment += m * (cre[k]! * cre[k]! + cim[k]! * cim[k]!);
  }
  return pieceOutline(
    [{ from: 0, to: 2 * Math.PI, closed: true, evaluate, table: TABLE_PER_RAY * n }],
    Math.PI * Math.abs(moment),
    "curve",
  );
}

/** The arcs' polynomials, each in its own aim angle, joined at the corners. */
function arcOutline(arcs: readonly RimArc[], scale: number, rays: number): RimOutline {
  let moment = 0;
  const pieces: Piece[] = arcs.map((arc) => {
    const m = arc.xs.length;
    const us = lobatto(m);
    const w = baryWeights(m);
    const xs = Float64Array.from(arc.xs, (x) => x / scale);
    const ys = Float64Array.from(arc.ys, (y) => y / scale);
    // Derivative values at the nodes, by the barycentric differentiation matrix:
    // the derivative of the interpolant is the interpolant of these.
    const dxs = new Float64Array(m);
    const dys = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < m; j++) {
        if (j === i) continue;
        const d = w[j]! / w[i]! / (us[i]! - us[j]!);
        sx += d * (xs[j]! - xs[i]!);
        sy += d * (ys[j]! - ys[i]!);
      }
      dxs[i] = sx;
      dys[i] = sy;
    }
    const mid = 0.5 * (arc.from + arc.to);
    const half = 0.5 * (arc.to - arc.from);
    const evaluate = (theta: number): [number, number, number, number] => {
      const u = (theta - mid) / half;
      return [bary(us, w, xs, u), bary(us, w, ys, u), bary(us, w, dxs, u) / half, bary(us, w, dys, u) / half];
    };
    // ½∫(x·y′ − y·x′) dθ: a polynomial of degree 2m − 3 in u, exact under m Gauss points.
    const [gu, gw] = gauss(m);
    for (let g = 0; g < m; g++) {
      const [x, y, dx, dy] = evaluate(mid + half * gu[g]!);
      moment += 0.5 * gw[g]! * half * (x * dy - y * dx);
    }
    const table = Math.max(8, Math.ceil(((arc.to - arc.from) / (2 * Math.PI)) * TABLE_PER_RAY * rays));
    return { from: arc.from, to: arc.to, closed: false, evaluate, table };
  });
  // The chords across the corners' bisection widths close the curve.
  for (let a = 0; a < pieces.length; a++) {
    const [x1, y1] = pieces[a]!.evaluate(pieces[a]!.to);
    const [x2, y2] = pieces[(a + 1) % pieces.length]!.evaluate(pieces[(a + 1) % pieces.length]!.from);
    moment += 0.5 * (x1 * y2 - x2 * y1);
  }
  return pieceOutline(pieces, Math.abs(moment), "arcs");
}

/** Gauss–Legendre nodes and weights on [−1, 1]. */
function gauss(m: number): [Float64Array, Float64Array] {
  const xs = new Float64Array(m);
  const ws = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (m + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= m; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      const pm = m === 1 ? x : p1;
      const pm1 = m === 1 ? 1 : p0;
      dp = (m * (x * pm - pm1)) / (x * x - 1);
      const dx = pm / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    xs[i] = x;
    ws[i] = 2 / ((1 - x * x) * dp * dp);
  }
  return [xs, ws];
}

/**
 * An outline from pieces in aim order: a table of each, ordered by exit angle —
 * it must turn once around the chief ray, monotone, or the outline is no radius
 * function of exit angle — whose segments bracket a Newton step on the piece's
 * own parameter. Between pieces (a corner's bisection width) the segment is the
 * chord.
 */
function pieceOutline(pieces: readonly Piece[], area: number, scheme: "curve" | "arcs"): RimOutline {
  // Table points in aim order: each piece's from … to, the closed one's to left off.
  const pts: { piece: number; t: number; x: number; y: number }[] = [];
  pieces.forEach((p, k) => {
    const last = p.closed ? p.table - 1 : p.table;
    for (let j = 0; j <= last; j++) {
      const t = j === p.table ? p.to : p.from + ((p.to - p.from) * j) / p.table;
      const [x, y] = p.evaluate(t);
      pts.push({ piece: k, t, x, y });
    }
  });
  const size = pts.length;
  const phi0 = pts.map((p) => Math.atan2(p.y, p.x));
  let turn = 0;
  for (let j = 0; j < size; j++) turn += wrap(phi0[(j + 1) % size]! - phi0[j]!);
  const dir = turn > 0 ? 1 : -1;
  if (Math.abs(turn - dir * 2 * Math.PI) > 1e-9) {
    throw new Error(`rim outline: the rim turns ${turn} rad around the chief ray, not once`);
  }
  // Segment i joins table point order[i] to order[i + 1], along increasing exit angle.
  const order = Array.from({ length: size + 1 }, (_, i) => (dir > 0 ? i % size : (size - i) % size));
  const angle = new Float64Array(size + 1);
  const radius = new Float64Array(size + 1);
  // Per segment: the piece it lies on (−1 for a chord), and its parameter at
  // angle[i] and at angle[i + 1].
  const segPiece = new Int32Array(size);
  const segA = new Float64Array(size);
  const segB = new Float64Array(size);
  for (let i = 0; i <= size; i++) {
    const p = pts[order[i]!]!;
    radius[i] = Math.hypot(p.x, p.y);
    if (i === 0) angle[i] = phi0[order[i]!]!;
    else {
      const step = wrap(phi0[order[i]!]! - phi0[order[i - 1]!]!);
      if (!(step > 0)) throw new Error("rim outline: the rim doubles back in exit angle");
      angle[i] = angle[i - 1]! + step;
    }
  }
  const closed = pieces.length === 1 && pieces[0]!.closed;
  for (let i = 0; i < size; i++) {
    if (closed) {
      // One periodic piece: the parameter runs on through 0 in exit order, ±.
      segPiece[i] = 0;
      segA[i] = (dir * 2 * Math.PI * i) / size;
      segB[i] = (dir * 2 * Math.PI * (i + 1)) / size;
      continue;
    }
    const a = pts[order[i]!]!;
    const b = pts[order[i + 1]!]!;
    // On one arc the later point in aim order has the larger parameter.
    const ok = a.piece === b.piece && (dir > 0 ? b.t > a.t : a.t > b.t);
    segPiece[i] = ok ? a.piece : -1;
    segA[i] = a.t;
    segB[i] = b.t;
  }

  const linear = (i: number, p: number) =>
    radius[i]! + ((radius[i + 1]! - radius[i]!) * (p - angle[i]!)) / (angle[i + 1]! - angle[i]!);
  // Newton on arg z(t) = φ inside segment i's parameter bracket, from the chord's guess.
  const solve = (i: number, phi: number): number => {
    const k = segPiece[i]!;
    if (k < 0) return linear(i, phi);
    const piece = pieces[k]!;
    const a = segA[i]!;
    const b = segB[i]!;
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    let th = a + (b - a) * ((phi - angle[i]!) / (angle[i + 1]! - angle[i]!));
    for (let it = 0; it < 40; it++) {
      const [zr, zi, dr, di] = piece.evaluate(th);
      const f = wrap(Math.atan2(zi, zr) - phi);
      // Exit angle rises with t where dir > 0: f > 0 means t is past the root.
      if (f * dir > 0) hi = th;
      else lo = th;
      const fp = (zr * di - zi * dr) / (zr * zr + zi * zi);
      const step = f / fp;
      const next = th - step;
      // A Newton step that leaves the bracket is replaced by bisection.
      if (!(next >= lo && next <= hi)) {
        th = 0.5 * (lo + hi);
        continue;
      }
      th = next;
      if (Math.abs(step) < 1e-15) break;
    }
    const [zr, zi] = piece.evaluate(th);
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

  return {
    scheme,
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
    area,
  };
}

/**
 * The rim's polygon in exit angle: radius linear in angle between the landings
 * — exact for a circle about the chief ray.
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
