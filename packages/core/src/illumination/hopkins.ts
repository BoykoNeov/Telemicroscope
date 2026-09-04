import { fft2d, fftShift2d, isPowerOfTwo } from "../math/fft";
import { complexSingularSystem } from "../math/lsq";
import { imagePixelScaleMm, type PupilFunction, type PupilScale } from "../wave/psf";
import type { ObjectField } from "./abbe";
import { LatticePhaseGuard, shiftedPupilBox } from "./lattice";
import type { CondenserSource } from "./source";
import { circleOverlapArea, pupilPhasor, type Complex } from "./transfer";

/**
 * Hopkins' transmission cross-coefficient — Abbe's sum with the order of
 * summation exchanged, so that the specimen falls out of the expensive half.
 *
 * `abbe.ts` computes
 *
 *     I(x) = Σ_s w_s · | F⁻¹{ Õ(u) · P(u+s) } |²
 *
 * which is one inverse transform per illumination direction, redone in full for
 * every object. Expanding the modulus and doing the **source** sum first
 * instead leaves the object outside it:
 *
 *     TCC(u₁, u₂) = Σ_s w_s · P(u₁+s) · P̄(u₂+s)
 *     Î(Δ)        = Σ_u  Õ(u+Δ) · Ō(u) · TCC(u+Δ, u)
 *     I(x)        = F⁻¹{ Î }(x)
 *
 * Nothing has been approximated: the two are the same finite sum reassociated,
 * and § 6cr pins them against each other to f64 roundoff rather than trusting
 * either. What changes is *what depends on what*. The kernel is a property of
 * the objective's pupil and the condenser alone, so it is built once and every
 * further specimen costs one bilinear pass and a **single** transform instead
 * of one per direction.
 *
 * ## What the kernel says that neither transfer curve could
 *
 * `transfer.ts` reports two moduli — how much of a weak *absorber* survives, and
 * how much of a weak *phase* object does. They are not two functions. For a
 * pupil even in u under a centro-symmetric source, substituting s → −s gives
 *
 *     TCC(0, −ν) = conj( TCC(ν, 0) )
 *
 * so `weakObjectTransfer` is |Re TCC(ν,0)| / TCC(0,0) and `weakPhaseTransfer` is
 * |Im TCC(ν,0)| / TCC(0,0) — the real and imaginary parts of **one complex
 * number**, the weak-object transfer function. § 6f measured the phase null as a
 * cancellation between two sums; here it is a symmetry: a real pupil has a real
 * TCC(ν,0), and a real number has no imaginary part. Defocus makes the pupil
 * complex and the imaginary part appears. That single complex number is what a
 * phase plate (phase contrast) or a sheared pair (DIC) is designed to rotate,
 * and both remain v2 — this file builds the thing they act on, not them.
 *
 * The symmetry needs the pupil to be **even**, which a real objective off axis
 * is not. Then the kernel still exists and the two moduli stop being its real
 * and imaginary parts — the kernel carries strictly more than they do, which is
 * the other half of why it is worth building (§ 6cr.4).
 *
 * ## Coordinates
 *
 * The same lattice `abbe.ts` and `wave/psf` use: an `n`×`n` grid on which the
 * pupil spans `pupilSamples` bins across its diameter, so centred bin index i
 * maps to normalized pupil coordinate (i − n/2)·2/pupilSamples. Spectra are
 * held **centred** (fftshifted), as `abbeImage` holds them, and the beat between
 * two centred bins lands at centred bin (i₁ − i₂ + n/2) mod n — the modulo being
 * the DFT's own identification of frequencies n apart.
 *
 * That modulo is a **guard and not a mechanism**, and § 6cr.3 pins which. The
 * kernel is non-zero only where the two shifted pupils overlap, so its support in
 * the difference is the pupil's own autocorrelation — `pupilSamples` bins wide,
 * closing at exactly ±pupilSamples where the two discs are tangent and the entry
 * is zero. `abbeImage` already demands n ≥ pupilSamples·(1 + S) for the shifted
 * pupil to fit, and 1 + S ≥ 1, so the difference always fits too: measured, the
 * number of non-zero entries whose beat falls outside the centred range is
 * **zero**, and dropping them changes not one bit of the image. Writing the
 * modulo anyway is cheaper than proving it can never be needed at every future
 * grid a caller might pick.
 *
 * ## Cost, and the reason the next step exists
 *
 * The kernel is M × M complex over the M lattice bins the shifted pupil can
 * reach, and M ≈ (π/4)·(1 + S)²·pupilSamples²: **memory grows as the fourth
 * power of the pupil sampling**. A 16-bin pupil at S = 0.5 is a few megabytes and
 * a 32-bin one is fifty. `transmissionCrossCoefficients` therefore takes an
 * explicit entry cap and throws rather than allocating past it, for the same
 * reason `shiftedPupilBox` throws: a kernel silently cut to fit reads as a
 * smaller aperture. The fix is the sum-of-coherent-systems decomposition — the
 * Hermitian kernel's eigenvectors — and it needs a complex Hermitian eigensolver
 * `math/lsq` does not have. What that step has to *measure* rather than assume:
 * this is a Gram matrix over the condenser, so its rank is at most the number of
 * illumination directions, and the untruncated decomposition costs exactly what
 * the Abbe sum costs. The saving is entirely in the truncation. See
 * `docs/OPEN-PROBLEMS.md`.
 */

/**
 * TCC(u₁, u₂) at one pair of frequencies, summed over the condenser directly.
 *
 * The analysis form: two pupil evaluations per source point, no grid, no
 * allocation. `transfer.ts`'s `orderSums` computes four of these at once from
 * three pupil reads, which is why it stays fused — but every number it reports
 * is one of these, and § 6cr pins that.
 */
export function transmissionCrossCoefficient(
  pupil: PupilFunction,
  source: CondenserSource,
  u1x: number,
  u1y: number,
  u2x: number,
  u2y: number,
): Complex {
  const p1: Complex = { re: 0, im: 0 };
  const p2: Complex = { re: 0, im: 0 };
  let re = 0;
  let im = 0;
  for (const s of source.points) {
    pupilPhasor(pupil, u1x + s.sx, u1y + s.sy, p1);
    pupilPhasor(pupil, u2x + s.sx, u2y + s.sy, p2);
    const w = s.weight;
    // P(u₁+s) · conj(P(u₂+s))
    re += w * (p1.re * p2.re + p1.im * p2.im);
    im += w * (p1.im * p2.re - p1.re * p2.im);
  }
  return { re, im };
}

/**
 * The weak-object transfer function: TCC(ν, 0) normalized by the light that
 * reaches the image at all.
 *
 * One complex number per frequency, and the object this whole file exists to
 * produce. For an even pupil under a centro-symmetric source its modulus-of-real
 * part is `weakObjectTransfer` and its modulus-of-imaginary part is
 * `weakPhaseTransfer`, exactly (§ 6cr.4) — so a brightfield instrument's two
 * curves are one curve in the complex plane, and phase contrast is the operation
 * that rotates it.
 */
export function weakObjectTransferFunction(
  pupil: PupilFunction,
  source: CondenserSource,
  nu: number,
): Complex {
  const k = transmissionCrossCoefficient(pupil, source, nu, 0, 0, 0);
  const dc = transmissionCrossCoefficient(pupil, source, 0, 0, 0, 0).re;
  if (!(dc > 0)) return { re: 0, im: 0 };
  return { re: k.re / dc, im: k.im / dc };
}

/** A disc, for the closed forms below. */
export interface Disc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * Area of the common overlap of three discs, in closed form.
 *
 * `circleOverlapArea` answers this for two, and § 6f's whole transfer curve is
 * that answer. A cross-coefficient at two *different* frequencies needs three:
 * the source disc, and the pupil displaced to meet each of the two orders. The
 * region is convex — an intersection of convex sets — so it is a curvilinear
 * **polygon**, and its area is the straight polygon on its corners plus the
 * circular segments its arcs cut off. The corners are the pairwise circle
 * crossings that lie inside the remaining disc.
 *
 * **It is not always a triangle.** A pair contributes 0, 1 or *two* corners — two
 * when the third disc does not reach that pair's lens — so the polygon can have
 * four sides. Assuming three refuses a configuration that occurs (§ 6cr.2).
 *
 * **And the bounding arc is not always the minor one.** A segment's area is
 * r²(θ − sin θ)/2, and θ = 2·asin(L/2r) is the shorter arc's angle; the boundary
 * takes the longer one whenever the region holds more than half of a disc. Which
 * arc bounds the region takes two tests, and `edgeSegment` below says why one is
 * not enough. Degenerate configurations reduce first: a disc containing another
 * is dropped, and a pair whose whole lens lies inside the third answers with
 * `circleOverlapArea`.
 */
export function tripleOverlapArea(a: Disc, b: Disc, c: Disc): number {
  let discs: Disc[] = [a, b, c];
  for (const d of discs) {
    if (!(d.r >= 0)) throw new Error(`tripleOverlapArea: radii must be >= 0, got ${d.r}`);
    if (d.r === 0) return 0;
  }

  // Any disjoint pair empties the intersection outright.
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (separation(discs[i]!, discs[j]!) >= discs[i]!.r + discs[j]!.r) return 0;
    }
  }

  // A disc that contains another constrains nothing; drop it, and what is left
  // is a two-disc lens or a single disc.
  let dropped = true;
  while (dropped && discs.length > 1) {
    dropped = false;
    search: for (let i = 0; i < discs.length; i++) {
      for (let j = 0; j < discs.length; j++) {
        if (i === j) continue;
        if (contains(discs[j]!, discs[i]!)) {
          discs = discs.filter((_, k) => k !== j);
          dropped = true;
          break search;
        }
      }
    }
  }
  if (discs.length === 1) return Math.PI * discs[0]!.r * discs[0]!.r;
  if (discs.length === 2) {
    const [p, q] = [discs[0]!, discs[1]!];
    return circleOverlapArea(separation(p, q), p.r, q.r);
  }

  // Every pairwise crossing that survives the third disc is a corner of the
  // region. A pair contributes 0, 1 or **2** of them — two when the third disc
  // does not reach that pair's lens — so the region is a curvilinear polygon of
  // up to six sides, not a triangle.
  const corners: Corner[] = [];
  for (const [i, j] of PAIRS) {
    for (const v of crossings(discs[i]!, discs[j]!)) {
      const other = discs[3 - i - j]!;
      if (!insideDisc(other, v.x, v.y)) continue;
      if (corners.some((c) => Math.hypot(c.x - v.x, c.y - v.y) < 1e-12)) continue;
      corners.push({ x: v.x, y: v.y, on: [i, j] });
    }
  }
  if (corners.length === 0) {
    // Pairwise overlapping with no common point: three lenses, no region.
    return 0;
  }
  const samePair =
    corners.length === 2 &&
    corners[0]!.on[0] === corners[1]!.on[0] &&
    corners[0]!.on[1] === corners[1]!.on[1];
  if (samePair) {
    // One pair's whole lens lies inside the third disc: that pair IS the region,
    // and the construction below could not choose between its two arcs.
    const [i, j] = corners[0]!.on;
    const p = discs[i]!;
    const q = discs[j]!;
    return circleOverlapArea(separation(p, q), p.r, q.r);
  }
  if (corners.length < 3) {
    throw new Error(
      `tripleOverlapArea: ${corners.length} corners survive the third disc — a configuration ` +
        "this construction does not describe, probably a tangency",
    );
  }

  // Convex, so angular order about the centroid is the boundary order.
  let cx = 0;
  let cy = 0;
  for (const v of corners) {
    cx += v.x / corners.length;
    cy += v.y / corners.length;
  }
  corners.sort((u, v) => Math.atan2(u.y - cy, u.x - cx) - Math.atan2(v.y - cy, v.x - cx));

  // The polygon and the segments are accumulated apart, because the shoelace
  // carries the winding's sign and the segments never do: adding them first and
  // taking the modulus of the total would subtract the arcs from a clockwise
  // polygon and still look plausible.
  let polygon = 0;
  let segments = 0;
  for (let k = 0; k < corners.length; k++) {
    const p = corners[k]!;
    const q = corners[(k + 1) % corners.length]!;
    polygon += (p.x * q.y - q.x * p.y) / 2;
    segments += edgeSegment(discs, p, q, cx, cy);
  }
  return Math.abs(polygon) + segments;
}

const PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 2],
];

interface Corner {
  readonly x: number;
  readonly y: number;
  /** The two discs whose circles cross here. */
  readonly on: readonly [number, number];
}

/**
 * TCC(u₁, u₂) for an aberration-free circular pupil under a uniformly filled
 * circular condenser — the closed form the measured sum is pinned against.
 *
 *     TCC = area( disc(0, S) ∩ disc(−u₁, 1) ∩ disc(−u₂, 1) ) / (π·S²)
 *
 * the illumination directions for which *both* orders get through, over the
 * light the condenser emits. At u₁ = u₂ the third disc is redundant and this is
 * `circleOverlapArea` again; at u₂ = 0 with S ≤ 1 likewise. The genuinely
 * three-disc case is the off-diagonal one, and nothing before this step had a
 * closed form for it.
 *
 * (§ 6f's tables call its two-disc formula "the three-circle closed form",
 * meaning the three diffracted *orders* it came from. This one really is three
 * circles; the names are not the same claim.)
 */
export function transmissionCrossCoefficientDisk(
  coherenceParameter: number,
  u1x: number,
  u1y: number,
  u2x: number,
  u2y: number,
): number {
  const S = coherenceParameter;
  if (!(S >= 0)) throw new Error(`coherenceParameter must be >= 0, got ${S}`);
  if (S === 0) {
    // A single on-axis direction: the kernel is P(u₁)·P̄(u₂), which for the ideal
    // pupil is 1 exactly when both orders are inside it.
    const in1 = u1x * u1x + u1y * u1y <= 1;
    const in2 = u2x * u2x + u2y * u2y <= 1;
    return in1 && in2 ? 1 : 0;
  }
  const area = tripleOverlapArea(
    { x: 0, y: 0, r: S },
    { x: -u1x, y: -u1y, r: 1 },
    { x: -u2x, y: -u2y, r: 1 },
  );
  return area / (Math.PI * S * S);
}

/** How the kernel is sampled, and how large it is allowed to get. */
export interface CondenserFactorOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `wave/psf`. */
  readonly pupilSamples: number;
  /** Object grid the factor will image on; the same `size` an `ObjectField` has. */
  readonly size: number;
  /** Name to blame in a box error — the public entry point the caller used. */
  readonly who?: string;
}

/**
 * The condenser factor: one column per illumination direction, holding the
 * shifted pupil where it transmits.
 *
 * **This is the thing Hopkins' kernel is built out of, and § 6cs is the step
 * that stopped throwing it away.** Pass one of `transmissionCrossCoefficients`
 * always built it; pass two consumed it into an M×M outer-product sum and let
 * it fall out of scope. Written down, it says what the kernel is: with A's
 * column s the shifted pupil scaled by √w_s,
 *
 *     TCC = Σ_s w_s · a_s · a_sᴴ = A·Aᴴ
 *
 * so the kernel is a Gram matrix — which § 6cr already knew, and used only to
 * argue that it is Hermitian and positive semi-definite. The factor makes the
 * stronger use available: **the kernel's eigenvectors are A's left singular
 * vectors and its eigenvalues are σ²**, so the coherent-mode decomposition needs
 * a complex SVD of an M×P matrix and not an eigensolver on an M×M one, and the
 * M×M array need never be allocated at all. See § 6cs and `math/lsq`'s
 * `complexSingularSystem`.
 *
 * ## The weight is NOT folded in
 *
 * Columns are stored **unweighted**, with `weights` alongside. That is not
 * tidiness: § 6cr.1's exact Hermiticity depends on the source weight
 * multiplying LAST, so that entry (i, j) accumulates term for term the exact
 * conjugate of (j, i). Scaling each column by √w here would reassociate the
 * product and cost the `toBe`. `coherentSystems` applies √w when it densifies,
 * where nothing is claiming exactness about a transpose.
 *
 * ## Storage
 *
 * Sparse by column, because a direction's shifted pupil transmits over its own
 * box and nowhere else: `offsets[p]`…`offsets[p+1]` are column p's entries,
 * `slots[i]` says which support bin entry i sits on. Densified to M×P only
 * where the solver needs it.
 */
export interface CondenserFactor {
  readonly size: number;
  readonly pupilSamples: number;
  readonly coherenceParameter: number;
  /** Centred lattice bins (iy·size + ix) some direction transmits on, ascending. */
  readonly bins: Int32Array;
  /** Lattice bin → index into `bins`, or −1. Length size². */
  readonly slotOf: Int32Array;
  /** `bins.length` — the kernel's M, and the factor's row count. */
  readonly support: number;
  /** Directions that transmitted anything — the factor's column count, and P. */
  readonly columns: number;
  /** Column p's entries are `offsets[p]`…`offsets[p+1]`. Length `columns + 1`. */
  readonly offsets: Int32Array;
  /** Support slot of each stored entry. */
  readonly slots: Int32Array;
  /** The pupil there, UNWEIGHTED — see the note above on why. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Each column's source weight. Length `columns`. */
  readonly weights: Float64Array;
  /** Stored entries, summed over columns. */
  readonly entries: number;
  /** What the sparse form occupies. */
  readonly bytes: number;
  /** What the dense M×P complex form would occupy — what the solver allocates. */
  readonly denseBytes: number;
  /** Same as `columns`; the name `Tcc` reports it under. */
  readonly contributingPoints: number;
  readonly pupilEvaluations: number;
  /** § 6f.9's grid guard, measured by `lattice.ts` as both sums measure it. */
  readonly maxGridPhaseStepWaves: number;
}

/**
 * Read the pupil once on every illumination direction's own sub-lattice, and
 * keep what transmits.
 *
 * A traced `PupilFunction` re-traces rays on every call, so the samples are kept
 * rather than recomputed — the consumers visit each of them many times.
 */
export function condenserFactor(
  pupil: PupilFunction,
  source: CondenserSource,
  options: CondenserFactorOptions,
): CondenserFactor {
  const who = options.who ?? "condenserFactor";
  const n = options.size;
  if (!isPowerOfTwo(n)) {
    throw new Error(`${who}: grid size must be a power of two, got ${n}`);
  }
  const pupilSamples = options.pupilSamples;
  if (!(pupilSamples > 0)) {
    throw new Error(`pupilSamples must be positive, got ${pupilSamples}`);
  }

  const half = n / 2;
  const step = 2 / pupilSamples;
  const guard = new LatticePhaseGuard(n);

  const seen = new Uint8Array(n * n);
  const offsetList: number[] = [0];
  const binList: number[] = [];
  const reList: number[] = [];
  const imList: number[] = [];
  const weightList: number[] = [];
  let pupilEvaluations = 0;

  for (const s of source.points) {
    const box = shiftedPupilBox(who, n, pupilSamples, s.sx, s.sy);
    guard.beginPoint(box);
    let count = 0;
    for (let iy = box.iyLo; iy <= box.iyHi; iy++) {
      const py = (iy - half) * step + s.sy;
      guard.beginRow();
      for (let ix = box.ixLo; ix <= box.ixHi; ix++) {
        const px = (ix - half) * step + s.sx;
        const a = pupil.amplitude(px, py);
        pupilEvaluations++;
        if (a <= 0) {
          guard.block(ix);
          continue;
        }
        const w = pupil.phaseWaves(px, py);
        guard.transmit(ix, w);
        const ang = 2 * Math.PI * w;
        const bin = iy * n + ix;
        binList.push(bin);
        reList.push(a * Math.cos(ang));
        imList.push(a * Math.sin(ang));
        count++;
        seen[bin] = 1;
      }
    }
    // A direction that transmits nothing is not a column of zeros, it is not a
    // column: it pushed no entries, so there is nothing to unwind.
    if (count === 0) continue;
    offsetList.push(binList.length);
    weightList.push(s.weight);
  }

  const bins: number[] = [];
  const slotOf = new Int32Array(n * n).fill(-1);
  for (let bin = 0; bin < n * n; bin++) {
    if (seen[bin] === 1) {
      slotOf[bin] = bins.length;
      bins.push(bin);
    }
  }
  const support = bins.length;
  const entries = binList.length;
  const slots = new Int32Array(entries);
  for (let i = 0; i < entries; i++) slots[i] = slotOf[binList[i]!]!;

  const re = Float64Array.from(reList);
  const im = Float64Array.from(imList);
  const offsets = Int32Array.from(offsetList);
  const weights = Float64Array.from(weightList);
  const columns = weights.length;

  return {
    size: n,
    pupilSamples,
    coherenceParameter: source.coherenceParameter,
    bins: Int32Array.from(bins),
    slotOf,
    support,
    columns,
    offsets,
    slots,
    re,
    im,
    weights,
    entries,
    bytes:
      re.byteLength + im.byteLength + slots.byteLength + offsets.byteLength + weights.byteLength,
    denseBytes: support * columns * 16,
    contributingPoints: columns,
    pupilEvaluations,
    maxGridPhaseStepWaves: guard.max,
  };
}

export interface TccOptions {
  /** Frequency bins across the pupil DIAMETER — the scale, as in `wave/psf`. */
  readonly pupilSamples: number;
  /** Object grid the kernel will image on; the same `size` an `ObjectField` has. */
  readonly size: number;
  /**
   * Refuse to build a kernel with more than this many entries. Default 4·10⁶ —
   * 64 MB across the two Float64Arrays. It throws rather than truncating; see
   * the header on why a cut kernel is not a smaller kernel.
   */
  readonly maxEntries?: number;
  /** Supply to get a physical `pixelScaleMm` back from `hopkinsImage`. */
  readonly scale?: PupilScale;
}

/**
 * The kernel on a frequency lattice: Hermitian, positive semi-definite, and
 * independent of any specimen.
 *
 * Stored densely over the **support** — the lattice bins some illumination
 * direction can transmit — rather than over the whole grid, because the grid is
 * mostly zeros and the square of "mostly zeros" is overwhelmingly so.
 */
export interface Tcc {
  readonly size: number;
  readonly pupilSamples: number;
  readonly coherenceParameter: number;
  /** Centred lattice bins (iy·size + ix) the kernel is supported on, ascending. */
  readonly bins: Int32Array;
  /** Lattice bin → index into `bins`, or −1. Length size². */
  readonly slotOf: Int32Array;
  /** Row-major `support`×`support`, real and imaginary parts. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** `bins.length`. */
  readonly support: number;
  /** support², the number the cap is compared against. */
  readonly entries: number;
  /** What the two arrays occupy. */
  readonly bytes: number;
  /** Source points whose shifted pupil transmitted anything on this grid. */
  readonly contributingPoints: number;
  /** Calls `pupil.amplitude` received — one pass over each direction's box. */
  readonly pupilEvaluations: number;
  /**
   * § 6f.9's grid guard, measured on the same samples `abbeImage` measures it
   * on and by the same code (`lattice.ts`), so the two report one number for one
   * pupil, source and grid. Reported, never thrown on.
   */
  readonly maxGridPhaseStepWaves: number;
}

/**
 * Build the kernel: one pass over the condenser, accumulating each direction's
 * shifted pupil into an outer product.
 *
 * Cost is `contributingPoints` × (transmitting bins)², against `abbeImage`'s
 * `contributingPoints` transforms per object. That is the trade — a build that
 * is paid once, in exchange for every subsequent specimen costing one transform
 * instead of one per direction.
 */
export function transmissionCrossCoefficients(
  pupil: PupilFunction,
  source: CondenserSource,
  options: TccOptions,
): Tcc {
  const maxEntries = options.maxEntries ?? 4_000_000;
  if (!(maxEntries > 0)) throw new Error(`maxEntries must be positive, got ${maxEntries}`);

  // Pass one is `condenserFactor`, which every consumer of this kernel now
  // shares — the § 3c lesson, applied where it would otherwise be re-learned.
  const factor = condenserFactor(pupil, source, {
    pupilSamples: options.pupilSamples,
    size: options.size,
    who: "transmissionCrossCoefficients",
  });
  const support = factor.support;
  const entries = support * support;
  if (entries > maxEntries) {
    throw new Error(
      `transmissionCrossCoefficients: the kernel over ${support} lattice bins needs ` +
        `${entries} entries (${Math.round((entries * 16) / 1048576)} MB), past the ` +
        `${maxEntries} cap — lower pupilSamples, or take the coherent-mode ` +
        "decomposition (`coherentSystems`), which is what this cap exists to point at " +
        "and which never allocates this array",
    );
  }

  // Pass two: Σ_s w·P(u₁+s)·conj(P(u₂+s)), one rank-one update per column.
  const re = new Float64Array(entries);
  const im = new Float64Array(entries);
  const fr = factor.re;
  const fi = factor.im;
  const slots = factor.slots;
  for (let p = 0; p < factor.columns; p++) {
    const lo = factor.offsets[p]!;
    const hi = factor.offsets[p + 1]!;
    const w = factor.weights[p]!;
    for (let i = lo; i < hi; i++) {
      const rowSlot = slots[i]! * support;
      const ar = fr[i]!;
      const ai = fi[i]!;
      for (let j = lo; j < hi; j++) {
        const br = fr[j]!;
        const bi = fi[j]!;
        const k = rowSlot + slots[j]!;
        // The weight multiplies LAST, and that is what makes the kernel exactly
        // Hermitian rather than Hermitian to roundoff. Products commute in IEEE
        // and a subtraction is its transpose's exact negative, so entry (j,i)
        // accumulates term for term the conjugate of (i,j) — folding w into one
        // factor first would reassociate the two halves differently and cost the
        // `toBe` (§ 6cr.1). It is also why `condenserFactor` stores its columns
        // unweighted (§ 6cs.2).
        re[k] = re[k]! + w * (ar * br + ai * bi);
        im[k] = im[k]! + w * (ai * br - ar * bi);
      }
    }
  }

  return {
    size: factor.size,
    pupilSamples: factor.pupilSamples,
    coherenceParameter: factor.coherenceParameter,
    bins: factor.bins,
    slotOf: factor.slotOf,
    re,
    im,
    support,
    entries,
    bytes: re.byteLength + im.byteLength,
    contributingPoints: factor.contributingPoints,
    pupilEvaluations: factor.pupilEvaluations,
    maxGridPhaseStepWaves: factor.maxGridPhaseStepWaves,
  };
}

/** One kernel entry, by normalized pupil coordinate rounded to the lattice. */
export function tccAt(t: Tcc, u1x: number, u1y: number, u2x: number, u2y: number): Complex {
  const s1 = slotAt(t, u1x, u1y);
  const s2 = slotAt(t, u2x, u2y);
  if (s1 < 0 || s2 < 0) return { re: 0, im: 0 };
  const k = s1 * t.support + s2;
  return { re: t.re[k]!, im: t.im[k]! };
}

function slotAt(t: Tcc, ux: number, uy: number): number {
  const half = t.size / 2;
  const ix = Math.round(half + (ux * t.pupilSamples) / 2);
  const iy = Math.round(half + (uy * t.pupilSamples) / 2);
  if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return -1;
  return t.slotOf[iy * t.size + ix]!;
}

export interface HopkinsImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /**
   * max|Im| / max|Re| of the inverse transform. The image of a Hermitian kernel
   * is real by construction, so this is f64 roundoff and nothing else —
   * reported because a kernel that had lost its Hermiticity would say so here
   * before it said so anywhere else.
   */
  readonly imaginaryResidual: number;
  /** Kernel entries that contributed — the bilinear pass's real length. */
  readonly kernelTerms: number;
  readonly pixelScaleMm?: number;
}

/**
 * Image an object through a prebuilt kernel: one bilinear pass and one inverse
 * transform, whatever the condenser's sampling.
 *
 * The object arrives exactly as `abbeImage` takes it — the specimen in reduced
 * (image-plane) coordinates — and the result is `abbeImage`'s intensity to f64
 * roundoff (§ 6cr.3).
 */
export function hopkinsImage(
  object: ObjectField,
  tcc: Tcc,
  options: { readonly scale?: PupilScale } = {},
): HopkinsImage {
  const n = tcc.size;
  if (object.size !== n) {
    throw new Error(
      `hopkinsImage: the object is ${object.size} bins across and the kernel was built for ${n}`,
    );
  }
  if (object.re.length !== n * n || object.im.length !== n * n) {
    throw new Error(`hopkinsImage: object arrays must hold ${n * n} elements`);
  }

  // Centred spectrum, exactly as `abbeImage` forms it, so the two read the
  // pupil's coordinates off the same bin indices.
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);

  const half = n / 2;
  const support = tcc.support;
  const bins = tcc.bins;
  const hatRe = new Float64Array(n * n);
  const hatIm = new Float64Array(n * n);
  let kernelTerms = 0;

  for (let a = 0; a < support; a++) {
    const bin1 = bins[a]!;
    const ix1 = bin1 % n;
    const iy1 = (bin1 - ix1) / n;
    const o1r = specRe[bin1]!;
    const o1i = specIm[bin1]!;
    if (o1r === 0 && o1i === 0) continue;
    const row = a * support;
    for (let b = 0; b < support; b++) {
      const tr = tcc.re[row + b]!;
      const ti = tcc.im[row + b]!;
      if (tr === 0 && ti === 0) continue;
      const bin2 = bins[b]!;
      const o2r = specRe[bin2]!;
      const o2i = specIm[bin2]!;
      if (o2r === 0 && o2i === 0) continue;
      kernelTerms++;
      // Õ(u₁)·conj(Õ(u₂))
      const gr = o1r * o2r + o1i * o2i;
      const gi = o1i * o2r - o1r * o2i;
      const ix2 = bin2 % n;
      const iy2 = (bin2 - ix2) / n;
      // The beat lands at the difference bin. The wrap never fires on a
      // non-zero entry (see the header, and § 6cr.3, which counts them); it is
      // here so that it could not silently matter.
      const jx = (((ix1 - ix2 + half) % n) + n) % n;
      const jy = (((iy1 - iy2 + half) % n) + n) % n;
      const j = jy * n + jx;
      hatRe[j] = hatRe[j]! + gr * tr - gi * ti;
      hatIm[j] = hatIm[j]! + gr * ti + gi * tr;
    }
  }

  fftShift2d(hatRe, n);
  fftShift2d(hatIm, n);
  fft2d(hatRe, hatIm, n, true);

  const scale = 1 / (n * n);
  const intensity = new Float64Array(n * n);
  let peakRe = 0;
  let peakIm = 0;
  for (let i = 0; i < n * n; i++) {
    const v = hatRe[i]! * scale;
    intensity[i] = v;
    const av = Math.abs(v);
    if (av > peakRe) peakRe = av;
    const ai = Math.abs(hatIm[i]! * scale);
    if (ai > peakIm) peakIm = ai;
  }

  return {
    size: n,
    pupilSamples: tcc.pupilSamples,
    intensity,
    imaginaryResidual: peakRe > 0 ? peakIm / peakRe : peakIm,
    kernelTerms,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, tcc.pupilSamples) }),
  };
}

export interface CoherentSystemsOptions {
  /**
   * Keep modes until this fraction of Σλ is captured. 1 (the default) keeps
   * every mode the factor has and approximates nothing.
   *
   * Cumulative λ rather than a threshold on λ_j itself, because Σλ is the
   * kernel's trace — the light the instrument transmits at all — so the fraction
   * is a physical quantity and not a knob. `capturedFraction` reports what was
   * actually reached.
   */
  readonly capture?: number;
  /** A hard cap on the mode count, applied after `capture`. */
  readonly maxModes?: number;
}

/**
 * The kernel as a sum of coherent systems: TCC = Σ_j λ_j · φ_j · φ_jᴴ.
 *
 * The eigendecomposition of Hopkins' kernel, obtained without ever forming it —
 * `condenserFactor`'s A has the same left singular vectors, and λ_j = σ_j².
 */
export interface CoherentSystems {
  readonly size: number;
  readonly pupilSamples: number;
  readonly coherenceParameter: number;
  readonly bins: Int32Array;
  readonly slotOf: Int32Array;
  readonly support: number;
  /** Modes kept — `available`, unless `capture` or `maxModes` cut it. */
  readonly modes: number;
  /**
   * Modes the factor has at all: min(support, columns). The kernel is a Gram
   * matrix over the condenser, so its rank cannot exceed the direction count —
   * and on a coarse grid it cannot exceed the support either.
   */
  readonly available: number;
  /** λ_j = σ_j², descending. Length `modes`, and every entry ≥ 0 by construction. */
  readonly weights: Float64Array;
  /** φ_j over the support, column-major `support × modes`: φ_j(b) at `j*support + b`. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Σλ over every available mode — the kernel's trace, whatever `modes` is. */
  readonly totalWeight: number;
  /** Σλ over the kept modes, over `totalWeight`. 1 when nothing was dropped. */
  readonly capturedFraction: number;
  /** What the kept modes occupy, against the kernel's own `bytes`. */
  readonly bytes: number;
  /** Sweeps the solver took; 30 would mean it hit its backstop. */
  readonly sweeps: number;
}

/**
 * Decompose the kernel into coherent systems, from the factor and never from
 * the kernel.
 *
 * The densification is where √w is applied — `condenserFactor` stores columns
 * unweighted so that `transmissionCrossCoefficients` keeps its exact
 * Hermiticity, and nothing here claims exactness about a transpose.
 *
 * The largest array this touches is `support × columns` complex. At
 * `pupilSamples` 32 that is 4.75 MB where the kernel is 47.1 MB, and the ratio
 * is support/columns — which grows as the square of the pupil sampling, because
 * the direction count does not grow with it at all.
 */
export function coherentSystems(
  factor: CondenserFactor,
  options: CoherentSystemsOptions = {},
): CoherentSystems {
  const capture = options.capture ?? 1;
  if (!(capture > 0) || capture > 1) {
    throw new Error(`coherentSystems: capture must be in (0, 1], got ${capture}`);
  }
  if (options.maxModes !== undefined && !(options.maxModes >= 1)) {
    throw new Error(`coherentSystems: maxModes must be at least 1, got ${options.maxModes}`);
  }

  const m = factor.support;
  const p = factor.columns;
  const dense = m * p;
  const re = new Float64Array(dense);
  const im = new Float64Array(dense);
  for (let c = 0; c < p; c++) {
    const lo = factor.offsets[c]!;
    const hi = factor.offsets[c + 1]!;
    const rootW = Math.sqrt(factor.weights[c]!);
    const col = c * m;
    for (let i = lo; i < hi; i++) {
      const slot = factor.slots[i]!;
      re[col + slot] = factor.re[i]! * rootW;
      im[col + slot] = factor.im[i]! * rootW;
    }
  }

  const svd = complexSingularSystem(re, im, m, p);

  // With fewer rows than columns the surplus σ are 0 by RANK rather than by
  // rounding, and Jacobi leaves them at the square root of nothing instead of at
  // 0 — the same correction `analysis/optimize` makes for the real solver. A
  // coarse grid reaches this: at pupilSamples 8 the support is 109 bins under
  // 177 directions.
  const available = Math.min(m, p);
  const lambda = new Float64Array(available);
  let total = 0;
  for (let j = 0; j < available; j++) {
    lambda[j] = svd.values[j]! * svd.values[j]!;
    total += lambda[j]!;
  }

  let modes = available;
  if (capture < 1 && total > 0) {
    let running = 0;
    modes = available;
    for (let j = 0; j < available; j++) {
      running += lambda[j]!;
      if (running >= capture * total) {
        modes = j + 1;
        break;
      }
    }
  }
  if (options.maxModes !== undefined) modes = Math.min(modes, options.maxModes);

  const weights = lambda.slice(0, modes);
  let kept = 0;
  for (let j = 0; j < modes; j++) kept += weights[j]!;

  const modeRe = svd.leftRe.slice(0, modes * m);
  const modeIm = svd.leftIm.slice(0, modes * m);

  return {
    size: factor.size,
    pupilSamples: factor.pupilSamples,
    coherenceParameter: factor.coherenceParameter,
    bins: factor.bins,
    slotOf: factor.slotOf,
    support: m,
    modes,
    available,
    weights,
    re: modeRe,
    im: modeIm,
    totalWeight: total,
    capturedFraction: total > 0 ? kept / total : 1,
    bytes: modeRe.byteLength + modeIm.byteLength + weights.byteLength,
    sweeps: svd.sweeps,
  };
}

export interface SocsImage {
  readonly size: number;
  readonly pupilSamples: number;
  /** Intensity, in the object's own coordinates (NOT fftshifted). */
  readonly intensity: Float64Array;
  /** Modes actually summed. */
  readonly modes: number;
  /** Σλ over those modes, over the kernel's trace. */
  readonly capturedFraction: number;
  /** Inverse transforms taken — one per mode, against `hopkinsImage`'s one. */
  readonly transforms: number;
  readonly pixelScaleMm?: number;
}

/**
 * Image an object as a sum of coherent systems: I = Σ_j λ_j · |F⁻¹{Õ·φ_j}|².
 *
 * Substituting TCC(u₁,u₂) = Σ_j λ_j·φ_j(u₁)·conj(φ_j(u₂)) into Hopkins' bilinear
 * form turns the double sum over frequency pairs into an autocorrelation per
 * mode, and an autocorrelation is a modulus after transforming. So each mode is
 * an ordinary coherent image and the partially coherent one is their weighted
 * sum — which is what "sum of coherent systems" means, and why the kernel's
 * being positive semi-definite is what makes it possible at all.
 *
 * **Truncation is one-signed.** Every λ_j ≥ 0 and every |·|² ≥ 0, so dropping
 * modes can only ever remove a non-negative quantity from every pixel: a
 * truncated image is **≤ the full image at every point, exactly**, never noisy
 * around it. It is therefore uniformly dimmer, and any comparison that
 * normalizes by peak or by total energy hides the very error it is measuring.
 *
 * Cost is one inverse transform per mode against `hopkinsImage`'s one, plus the
 * support-sized product and an n² accumulate each. Whether that wins is a
 * measurement and not an inequality: `hopkinsImage` skips zero object-spectrum
 * bins, so its bilinear pass is far below support² on a sparse specimen and near
 * it on a dense one, while this cost does not move at all. § 6cs.4 measures both.
 */
export function socsImage(
  object: ObjectField,
  systems: CoherentSystems,
  options: { readonly modes?: number; readonly scale?: PupilScale } = {},
): SocsImage {
  const n = systems.size;
  if (object.size !== n) {
    throw new Error(
      `socsImage: the object is ${object.size} bins across and the modes were built for ${n}`,
    );
  }
  if (object.re.length !== n * n || object.im.length !== n * n) {
    throw new Error(`socsImage: object arrays must hold ${n * n} elements`);
  }
  const modes = Math.min(options.modes ?? systems.modes, systems.modes);
  if (!(modes >= 1)) throw new Error(`socsImage: modes must be at least 1, got ${modes}`);

  // Centred spectrum, exactly as `hopkinsImage` and `abbeImage` form it.
  const specRe = Float64Array.from(object.re);
  const specIm = Float64Array.from(object.im);
  fft2d(specRe, specIm, n);
  fftShift2d(specRe, n);
  fftShift2d(specIm, n);

  const support = systems.support;
  const bins = systems.bins;
  const intensity = new Float64Array(n * n);
  const gRe = new Float64Array(n * n);
  const gIm = new Float64Array(n * n);
  // No normalization factor here, which is worth stating because `hopkinsImage`
  // carries one: `fft2d`'s inverse already divides by n per pass, so it returns
  // F⁻¹ itself and the formula is exactly I = Σ λⱼ·|F⁻¹{Õ·φⱼ}|² with nothing
  // left over. Why Hopkins' form needs a further 1/n² and this one does not is
  // not worked out here; what is checked is the answer, against `hopkinsImage`
  // AND `abbeImage`, on a sparse-spectrum object and a dense one (§ 6cs.4).

  let kept = 0;
  for (let j = 0; j < modes; j++) {
    const lambda = systems.weights[j]!;
    kept += lambda;
    gRe.fill(0);
    gIm.fill(0);
    const col = j * support;
    for (let b = 0; b < support; b++) {
      const bin = bins[b]!;
      const or_ = specRe[bin]!;
      const oi = specIm[bin]!;
      if (or_ === 0 && oi === 0) continue;
      const pr = systems.re[col + b]!;
      const pi = systems.im[col + b]!;
      gRe[bin] = or_ * pr - oi * pi;
      gIm[bin] = or_ * pi + oi * pr;
    }
    fftShift2d(gRe, n);
    fftShift2d(gIm, n);
    fft2d(gRe, gIm, n, true);
    for (let i = 0; i < n * n; i++) {
      intensity[i] = intensity[i]! + lambda * (gRe[i]! * gRe[i]! + gIm[i]! * gIm[i]!);
    }
  }

  return {
    size: n,
    pupilSamples: systems.pupilSamples,
    intensity,
    modes,
    capturedFraction: systems.totalWeight > 0 ? kept / systems.totalWeight : 1,
    transforms: modes,
    ...(options.scale === undefined
      ? {}
      : { pixelScaleMm: imagePixelScaleMm(options.scale, n, systems.pupilSamples) }),
  };
}

function separation(p: Disc, q: Disc): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Is `inner` wholly inside `outer`? Then `outer` constrains nothing. */
function contains(outer: Disc, inner: Disc): boolean {
  return separation(outer, inner) + inner.r <= outer.r;
}

function insideDisc(d: Disc, x: number, y: number): boolean {
  const dx = x - d.x;
  const dy = y - d.y;
  // A corner lies ON the two circles that made it, so the third's test needs the
  // slack of its own scale rather than an exact inequality.
  return dx * dx + dy * dy <= d.r * d.r * (1 + 1e-12) + 1e-12;
}

/** Where two circles cross — both points, or none. */
function crossings(p: Disc, q: Disc): { x: number; y: number }[] {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d >= p.r + q.r || d <= Math.abs(p.r - q.r)) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
  const h2 = p.r * p.r - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const mx = p.x + (a * dx) / d;
  const my = p.y + (a * dy) / d;
  const ox = (-dy * h) / d;
  const oy = (dx * h) / d;
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ];
}

/**
 * The circular segment the boundary arc between two adjacent corners cuts off.
 *
 * Two things have to be decided, and it takes two tests. **Which circle** the arc
 * belongs to: adjacent corners share one circle in general, but two when they are
 * the same pair's two crossings. And **which of that circle's two arcs**:
 * r²(θ − sin θ)/2 with θ = 2·asin(L/2r) is the minor one, and the boundary arc is
 * the major one whenever the region holds more than half of that disc — a small
 * disc clipped a little by two large ones.
 *
 * A candidate arc must have its midpoint inside **every** disc, which settles the
 * circle. That alone does not settle the arc: when two corners are close
 * together, the major arc's midpoint is nearly the antipode and can sit
 * comfortably inside the region too. The second test is convexity — the boundary
 * of an intersection of discs bulges *away* from the interior, so the arc's
 * midpoint lies on the far side of the chord from the corners' centroid, which is
 * itself interior. Exactly one (circle, arc) passes both; anything else is a
 * degeneracy this construction refuses rather than guesses at.
 */
function edgeSegment(discs: Disc[], p: Corner, q: Corner, cx: number, cy: number): number {
  const shared = p.on.filter((i) => q.on.includes(i));
  const chord = Math.hypot(p.x - q.x, p.y - q.y);
  // Which side of the chord the interior is on.
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const interior = ex * (cy - p.y) - ey * (cx - p.x);
  let found: number | undefined;
  for (const i of shared) {
    const d = discs[i]!;
    const theta = 2 * Math.asin(Math.min(1, chord / (2 * d.r)));
    const mx = (p.x + q.x) / 2 - d.x;
    const my = (p.y + q.y) / 2 - d.y;
    const m = Math.hypot(mx, my);
    for (const sign of [1, -1]) {
      const t = sign > 0 ? theta : 2 * Math.PI - theta;
      const bx = m > 0 ? d.x + (sign * d.r * mx) / m : d.x;
      const by = m > 0 ? d.y + (sign * d.r * my) / m : d.y;
      if (m > 0) {
        if (!discs.every((o) => insideDisc(o, bx, by))) continue;
        const side = ex * (by - p.y) - ey * (bx - p.x);
        if (side * interior > 0) continue;
      }
      const candidate = (d.r * d.r * (t - Math.sin(t))) / 2;
      if (found !== undefined && Math.abs(found - candidate) > 1e-12) {
        throw new Error(
          "tripleOverlapArea: two different arcs both bound the region between one pair of " +
            "corners — a degeneracy this construction refuses rather than guesses at",
        );
      }
      found = candidate;
      if (m === 0) break; // a diameter: both arcs are the same semicircle
    }
  }
  if (found === undefined) {
    throw new Error("tripleOverlapArea: no arc bounds the region between two adjacent corners");
  }
  return found;
}
