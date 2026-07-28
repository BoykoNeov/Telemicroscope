import { describe, it, expect } from "vitest";
import { abbeImage, type ObjectField } from "../src/illumination/abbe";
import { coherentSource, diskSource, type CondenserSource } from "../src/illumination/source";
import { mulberry32 } from "../src/math/random";
import type { PupilFunction } from "../src/wave/psf";
import {
  mosaicLayout,
  mosaicPitchDriftPx,
  mosaicTileAt,
  renderMosaic,
  renderMosaicTile,
} from "../src/imaging/mosaic";
import { objectFieldTile, tracedFieldPupils } from "../src/imaging/object-field";
import { rasterizeSpecimen, type Specimen } from "../src/imaging/specimen";
import { renderBrightfield } from "../src/imaging/brightfield";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6o — the mosaic and its guard band.
 *
 * § 6m put a tile at an arbitrary field position and § 6n warped its grid so two
 * tiles agree about where the specimen is. This lays them beside one another,
 * and the question it has to answer first is what a tile's own **edge** costs:
 * a grid is finite, `abbeImage` is a transform, and the image near the edge is
 * formed from a neighbourhood that is wrapped rather than real. The guard band
 * is the answer, and how wide it must be is a measurement.
 *
 * **The external number is a closed form and it is reached in the coherent
 * limit.** A crop deletes δ = ∫_{|r|>d} Δt(r)·h(r) dr from every amplitude in
 * the window. With the deleted structure uncorrelated, Var(δ) is σ²a·∫_{|r|>d}
 * |h|², and for an Airy amplitude h ~ r^(−3/2) that integral is
 * ∫_d^∞ r^(−3)·2πr dr = 2π/d. So under a coherent source, where the intensity
 * error is 2Re(A·δ*) and therefore carries δ itself, **the crop error falls as
 * guard^(−1/2)** — no coefficient, no fit, just the tail integral of the Airy
 * amplitude. § 6o.1 measures −0.334, −0.435, −0.533 approaching it.
 *
 * **Two things this step measured that Part D's D0.2 feasibility table did
 * not**, recorded rather than quietly reproduced — see the notes on § 6o.2 and
 * § 6o.3, and VALIDATION.md for what they cost the doc.
 *
 * The probe holds the lattice fixed and varies only how far out the specimen is
 * the true one: two specimens identical inside a box, and **permutations of one
 * multiset** outside it, so the two carry identical total transmittance and no
 * DC term of the probe's own making reaches the window (§ 6o.4).
 */

const LAMBDA = 587.5618;

/* ── the guard-band probe's lattice ───────────────────────────────────────── */

/**
 * 128 at `pupilSamples` 64 — two pixels per resolution cell, and a 16-pixel
 * (8-cell) window inside it.
 *
 * Chosen against `abbeImage`'s own lattice guard rather than for tidiness: a
 * source point at S needs `size >= ceil(pupilSamples·(1+S)) + 2`, so 2 px per
 * cell is the finest sampling S = 1 admits at any grid. What it buys is that a
 * **749-point** condenser costs 0.6 s a render here and 9.6 s at 256, which is
 * the difference between § 6o.3 being a rung and being a footnote.
 */
const N = 128;
const PS = 64;
const PX_PER_CELL = N / PS;
const WINDOW = 16;
const BLOCK = PX_PER_CELL;

/** A hard-edged unit disc — the crop is the only error under study. */
const IDEAL: PupilFunction = {
  amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: () => 0,
};

/**
 * Two specimens agreeing inside `boxHalfPx`, permuted outside it.
 *
 * The permutation is what makes this a controlled probe: two independently
 * drawn surrounds differ in total transmittance by ~1/√N, and T(0) reaches every
 * pixel through the pupil at every source point, which would lay a floor of the
 * probe's own making across the whole table. Part D's D0.2 records drawing its
 * first table without this control; § 6o.4 pins that it is in place.
 */
function specimenPair(boxHalfPx: number, seed: number): [ObjectField, ObjectField] {
  const nb = N / BLOCK;
  const rng = mulberry32(seed);
  const values = new Float64Array(nb * nb);
  for (let i = 0; i < values.length; i++) values[i] = rng.next();

  const inside = (bx: number, by: number): boolean => {
    const x0 = bx * BLOCK;
    const y0 = by * BLOCK;
    return (
      x0 >= N / 2 - boxHalfPx &&
      x0 + BLOCK <= N / 2 + boxHalfPx &&
      y0 >= N / 2 - boxHalfPx &&
      y0 + BLOCK <= N / 2 + boxHalfPx
    );
  };
  const outside: number[] = [];
  for (let by = 0; by < nb; by++) {
    for (let bx = 0; bx < nb; bx++) if (!inside(bx, by)) outside.push(by * nb + bx);
  }
  const order = outside.slice();
  const shuffle = mulberry32(seed ^ 0x9e3779b9);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const permuted = Float64Array.from(values);
  for (let k = 0; k < outside.length; k++) permuted[outside[k]!] = values[order[k]!]!;

  const build = (v: Float64Array): ObjectField => {
    const re = new Float64Array(N * N);
    const im = new Float64Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        re[y * N + x] = v[Math.floor(y / BLOCK) * nb + Math.floor(x / BLOCK)]!;
      }
    }
    return { size: N, re, im };
  };
  return [build(values), build(permuted)];
}

interface GuardCell {
  /** rms of (I_A − I_B)/mean(I_A) over the window, pooled over seeds. */
  readonly rms: number;
  /** The same after dividing each image by its OWN mean — § 6o.4's control. */
  readonly rmsNormalized: number;
  /** Worst single pixel, as a fraction of the window's peak. */
  readonly worst: number;
}

const SEEDS = [1, 2, 3, 4];
const CELLS = new Map<string, GuardCell>();

/** One (guard, source) cell of the guard table. Memoized — renders are seconds. */
function guardCell(guardCells: number, source: CondenserSource, key: string): GuardCell {
  const id = `${guardCells}|${key}`;
  const hit = CELLS.get(id);
  if (hit !== undefined) return hit;

  let sq = 0;
  let sqNorm = 0;
  let n = 0;
  let worst = 0;
  let peak = 0;
  for (const seed of SEEDS) {
    const [a, b] = specimenPair(WINDOW / 2 + guardCells * PX_PER_CELL, seed);
    const ia = abbeImage(a, IDEAL, source, { pupilSamples: PS }).intensity;
    const ib = abbeImage(b, IDEAL, source, { pupilSamples: PS }).intensity;
    const lo = (N - WINDOW) / 2;
    let sa = 0;
    let sb = 0;
    let count = 0;
    for (let y = lo; y < lo + WINDOW; y++) {
      for (let x = lo; x < lo + WINDOW; x++) {
        sa += ia[y * N + x]!;
        sb += ib[y * N + x]!;
        count++;
      }
    }
    const ma = sa / count;
    const mb = sb / count;
    for (let y = lo; y < lo + WINDOW; y++) {
      for (let x = lo; x < lo + WINDOW; x++) {
        const av = ia[y * N + x]!;
        const bv = ib[y * N + x]!;
        sq += ((av - bv) / ma) ** 2;
        sqNorm += (av / ma - bv / mb) ** 2;
        worst = Math.max(worst, Math.abs(av - bv));
        peak = Math.max(peak, av);
      }
    }
    n += count;
  }
  const value: GuardCell = {
    rms: Math.sqrt(sq / n),
    rmsNormalized: Math.sqrt(sqNorm / n),
    worst: worst / peak,
  };
  CELLS.set(id, value);
  return value;
}

const COHERENT = coherentSource();
const FILLED_FINE = diskSource(0.25, 31); // 749 points
const FILLED_COARSE = diskSource(0.25, 11); // 97 points — D0.2's own condenser
const WIDE_FINE = diskSource(1.0, 31); // 749 points, but four times the spacing

const coherentAt = (g: number) => guardCell(g, COHERENT, "S0");
const fineAt = (g: number) => guardCell(g, FILLED_FINE, "S025-749");
const coarseAt = (g: number) => guardCell(g, FILLED_COARSE, "S025-97");
const wideAt = (g: number) => guardCell(g, WIDE_FINE, "S1-749");

/** Log-log slope of a sequence sampled at `guards`. */
const slopes = (v: readonly number[], guards: readonly number[]): number[] =>
  v.slice(1).map((x, i) => Math.log(x / v[i]!) / Math.log(guards[i + 1]! / guards[i]!));

describe("§ 6o.1 — the coherent crop, where the closed form is", () => {
  const GUARDS = [1, 2, 4, 8, 16];

  it("BRACKETS guard^(−1/2) — the tail integral of the Airy amplitude", () => {
    // The rung the whole step rests on, and it is free: `coherentSource` is ONE
    // point, so the source sum is exact and nothing but the crop can contribute
    // to the residual. Var(δ) = ∫_{|r|>d}|h|² = 2π/d for h ~ r^(−3/2), so the
    // intensity error carries δ and goes as d^(−1/2).
    //
    // BRACKETED rather than approached, because the probe is squeezed from both
    // ends and −1/2 is the infinite-surround law neither end reaches:
    //
    //  - at small guard the window's own width dilutes it. The window is 8 cells
    //    across, so a chord of it sits between `guard` and `guard + 4` cells from
    //    the crop, and the slope reads SHALLOWER than −1/2 (−0.033, −0.334).
    //  - at large guard the surround is finite. The probe's specimen differs only
    //    out to the grid edge, so the integral is ∫_d^R and not ∫_d^∞, and the
    //    slope reads STEEPER (−0.533 at guard 16, where R is 32 cells).
    //
    // That second reading is checked rather than assumed: the slope tracks d/R
    // and not d. At R = 64 cells the same d/R = 0.5 gives −0.524 against this
    // lattice's −0.533, and d/R = 0.25 gives −0.375 against −0.435.
    //
    // So the rung pins the bracket, monotone, with the closed form inside it —
    // which is what the measurement supports and "converges to −1/2" is not.
    const v = GUARDS.map((g) => coherentAt(g).rms);
    const s = slopes(v, GUARDS);
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeLessThan(s[i - 1]!);
    const above = s[s.length - 2]!;
    const below = s[s.length - 1]!;
    expect(above).toBeGreaterThan(-0.5);
    expect(below).toBeLessThan(-0.5);
    // And it is a tight bracket, not "somewhere in this decade": −0.435 and
    // −0.533 straddle −1/2 by 13% and 6.6%.
    expect(Math.abs(above / -0.5 - 1)).toBeLessThan(0.2);
    expect(Math.abs(below / -0.5 - 1)).toBeLessThan(0.1);
  });

  it("NEGATIVE CONTROL: a tile with no guard at all", () => {
    // Not a tolerance — the ungarded tile is a different picture. Its worst
    // pixel is over half the window's peak, which is not an error a caller
    // could mistake for texture.
    const bare = coherentAt(0);
    expect(bare.rms).toBeGreaterThan(0.35);
    expect(bare.worst).toBeGreaterThan(0.5);
    expect(bare.rms / coherentAt(16).rms).toBeGreaterThan(4.5);
  });

  it("and NO guard makes a coherent tile exact — 16× the guard buys under 5×", () => {
    // The honest deliverable is a bound and never an equality, and this is why:
    // guard^(−1/2) is an algebraic tail, so the error at 16 cells is still 7.6%
    // rms. Under a filled condenser the same 16 cells buy 286× (§ 6o.2), which
    // is the whole difference between the two illuminations.
    expect(coherentAt(0).rms / coherentAt(16).rms).toBeLessThan(6);
    expect(coherentAt(16).rms).toBeGreaterThan(0.05);
  });
});

describe("§ 6o.2 — a filled condenser converges far faster, and that CORRECTS D0.2", () => {
  const GUARDS = [4, 8, 16];

  it("beats the coherent limit by a factor that DOUBLES with the guard", () => {
    // Part D's D0.2 concluded "the guard does not grow as the diaphragm closes",
    // and was careful to add that S = 0 was not measured and not claimed. It is
    // measured here, and it is the worst case by a wide margin: the ratio is
    // 22.9, 42.0, 84.8 at guards 4, 8, 16 — one factor of two per doubling of
    // the guard, so the two illuminations' exponents differ by exactly 1.
    //
    // So the guard DOES depend on the coherence. D0.2's plateau across
    // S = 1 → 0.25 stands; what does not is reading it as an S-independent law,
    // and ROADMAP.md said so in those words.
    const ratios = GUARDS.map((g) => coherentAt(g).rms / fineAt(g).rms);
    for (let i = 1; i < ratios.length; i++) {
      const perDoubling = ratios[i]! / ratios[i - 1]!;
      expect(perDoubling).toBeGreaterThan(1.7);
      expect(perDoubling).toBeLessThan(2.4);
    }
    expect(ratios[0]!).toBeGreaterThan(15);
    expect(ratios[ratios.length - 1]!).toBeGreaterThan(70);
  });

  it("so 16 cells of guard buy 286×, where the coherent limit bought 4.8×", () => {
    // The same comparison read as a convergence rather than as a ratio. This is
    // the number a caller sizing a guard band actually wants.
    expect(fineAt(0).rms / fineAt(16).rms).toBeGreaterThan(250);
    expect(fineAt(16).rms).toBeLessThan(1e-3);
    expect(fineAt(16).worst).toBeLessThan(2e-3);
  });
});

describe("§ 6o.3 — the plateau D0.2 measured is the CONDENSER'S quadrature", () => {
  it("refining the source alone drops the guard-16 error 7×", () => {
    // D0.2 read a floor of ~4e-3 rms that went as guard^(−0.3) and called it
    // h's algebraic tail. It is not: at the SAME guard, the SAME specimen and
    // the SAME lattice, taking the condenser from D0.2's own 97 points to 749
    // drops the error 7.1× — 6.381e-3 to 8.966e-4. A tail that a source
    // sampling can move is not the impulse response's.
    expect(coarseAt(16).rms / fineAt(16).rms).toBeGreaterThan(6.5);
    expect(coarseAt(16).rms).toBeGreaterThan(5e-3);
    expect(fineAt(16).rms).toBeLessThan(1e-3);
  });

  it("and the flat tail flattens only at the coarse sampling", () => {
    // The mechanism, seen directly. At 97 points the curve goes flat past guard
    // 4 (slopes −0.214, −0.356) which is D0.2's guard^(−0.3) exactly; at 749 it
    // is still falling steeply (−1.310, −1.546). The plateau is the sum's
    // residual arriving from underneath, not the crop levelling off.
    const guards = [4, 8, 16];
    const coarse = slopes(guards.map((g) => coarseAt(g).rms), guards);
    const fine = slopes(guards.map((g) => fineAt(g).rms), guards);
    for (const s of coarse) expect(s).toBeGreaterThan(-0.6);
    for (const s of fine) expect(s).toBeLessThan(-1.2);
  });

  it("CONTROL: the coherent curve cannot move, because it has one point", () => {
    // What makes the rung above a measurement rather than an inference. Source
    // refinement is a knob the coherent case does not have: its sum is one term
    // and is exact, which is why § 6o.1's exponent is the one pinned to a closed
    // form and the partially coherent exponent is NOT pinned anywhere here —
    // it moves with the lattice (−1.31 to −1.82 across the grids probed).
    expect(COHERENT.points.length).toBe(1);
    expect(FILLED_FINE.points.length).toBeGreaterThan(700);
    expect(FILLED_COARSE.points.length).toBe(97);
  });

  it("and the SAME 749 points are not converged at S = 1, where the spacing is 4× coarser", () => {
    // `diskSource` spaces its points by 2S/samples, so a sample count converged
    // at S = 0.25 is four times too coarse at S = 1 — and the witness is that
    // the guard curve goes FLAT: 2.795e-3, 2.910e-3, 2.923e-3 at guards 4, 8,
    // 16, which is the residual and not the crop. § 6p's commensurate condenser
    // is what fixes this, and it is why that step is not only about speed.
    const v = [4, 8, 16].map((g) => wideAt(g).rms);
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i]! / v[i - 1]! - 1)).toBeLessThan(0.1);
    // Flat AND above the S = 0.25 curve it should have beaten at guard 16.
    expect(v[v.length - 1]!).toBeGreaterThan(fineAt(16).rms * 2);
  });
});

describe("§ 6o.4 — the probe's own controls", () => {
  it("the two surrounds carry identical total transmittance, to the last bit", () => {
    // A permutation of one multiset, not two independent draws. Bitwise because
    // it is the same numbers in a different order — anything looser would be
    // hiding a construction that had drifted.
    const [a, b] = specimenPair(WINDOW / 2 + 4 * PX_PER_CELL, 1);
    let ta = 0;
    let tb = 0;
    for (let i = 0; i < a.re.length; i++) {
      ta += a.re[i]! ** 2 + a.im[i]! ** 2;
      tb += b.re[i]! ** 2 + b.im[i]! ** 2;
    }
    expect(Math.abs(ta / tb - 1)).toBeLessThan(1e-12);
    // And they really do differ outside the box, or the table is measuring zero.
    let differing = 0;
    for (let i = 0; i < a.re.length; i++) if (a.re[i] !== b.re[i]) differing++;
    expect(differing).toBeGreaterThan(a.re.length / 4);
  });

  it("dividing each image by its own mean changes nothing", () => {
    // The other half of the control. If a DC term of the probe's making were
    // reaching the window, removing it would move the answer; it does not, at
    // any guard or any source. D0.2 reached the same verdict by the same route.
    for (const at of [coherentAt, coarseAt]) {
      for (const g of [0, 4, 16]) {
        const c = at(g);
        expect(Math.abs(c.rmsNormalized / c.rms - 1)).toBeLessThan(0.03);
      }
    }
  });
});

/* ── the mosaic itself ────────────────────────────────────────────────────── */

const SIZE = 64;
const TILE_PS = 32;
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const layoutOf = (over: Partial<Parameters<typeof mosaicLayout>[1]> = {}) =>
  mosaicLayout(SYSTEM, {
    tiles: 2,
    size: SIZE,
    pupilSamples: TILE_PS,
    guardCells: 4,
    wavelengthNm: LAMBDA,
    ...over,
  });

describe("§ 6o.5 — the layout: a guard is cells, and a mosaic is pixels", () => {
  it("converts cells to pixels on § 6h.2's reciprocity, and crops both edges", () => {
    // A resolution cell is size/pupilSamples pixels, which is the same statement
    // as "pupilSamples cells across the frame" — so the guard is stated in the
    // physical variable and the pixel count follows from the lattice, never the
    // other way round.
    const l = layoutOf();
    expect(l.guardPixels).toBe(4 * (SIZE / TILE_PS));
    expect(l.usefulPixels).toBe(SIZE - 2 * l.guardPixels);
    expect(l.size).toBe(2 * l.usefulPixels);
    expect(l.tiles).toHaveLength(4);
    expect(l.tiles.map((t) => `${t.originPx.x},${t.originPx.y}`)).toEqual([
      "0,0",
      "48,0",
      "0,48",
      "48,48",
    ]);
  });

  it("REFUSES a guard that is not a whole number of pixels", () => {
    // `latticeMatchedSource`'s argument, one module over: a guard rounded to the
    // nearest pixel produces a perfectly plausible mosaic whose seam error is
    // not the one that was asked for, and nothing downstream can tell. The
    // message names the three knobs that would make it whole.
    expect(() => layoutOf({ pupilSamples: 48, guardCells: 1 })).toThrow(/px per resolution cell/);
    expect(() => layoutOf({ guardCells: 32 })).toThrow(/eats the whole/);
    expect(() => layoutOf({ tiles: 0 })).toThrow(/positive integer/);
  });

  it("one tile with no guard IS `objectFieldTile`, bitwise", () => {
    // § 6m.1's idiom: a tile at the origin reproduced the frame bitwise, and a
    // one-tile mosaic must reproduce the tile the same way or the mosaic has
    // quietly become a second construction of the same thing.
    const centreMm = { x: 1.6, y: 0.8 };
    const l = layoutOf({ tiles: 1, guardCells: 0, centreMm });
    const direct = objectFieldTile(SYSTEM, {
      size: SIZE,
      pupilSamples: TILE_PS,
      wavelengthNm: LAMBDA,
      centreMm,
    });
    const f = l.tiles[0]!.frame;
    expect(f.pixelScaleMm).toBe(direct.pixelScaleMm);
    expect(f.centreObjectMm.x).toBe(direct.centreObjectMm.x);
    expect(f.centreObjectMm.y).toBe(direct.centreObjectMm.y);
    expect(f.scale.referenceRadius).toBe(direct.scale.referenceRadius);
    expect(f.magnification).toBe(direct.magnification);
    expect(l.size).toBe(SIZE);
  });
});

describe("§ 6o.6 — a mosaic's pitch is not its tile span, and the solve is skipped", () => {
  it("uniform and abutting differ by a hundredth of a pixel across 17 tiles", () => {
    // Each tile reads its own ruler at its own centre (§ 6m), so its useful span
    // in millimetres is its own — exact abutment is a fixed point and not an
    // arithmetic. D1 licensed skipping the solve if the drift was measured, and
    // this is the measurement: 3.7e-5 px across 3 tiles, 1.6e-3 across 9, and
    // 1.3e-2 across 17, by which point the outer tile is 2.24 mm off axis.
    //
    // Growing, and monotone, so it is the ruler's real field dependence and not
    // f64 noise — it is simply far below the pixel that would make it matter.
    const drifts = [3, 5, 9, 17].map((tiles) =>
      mosaicPitchDriftPx(SYSTEM, {
        tiles,
        size: SIZE,
        pupilSamples: TILE_PS,
        guardCells: 4,
        wavelengthNm: LAMBDA,
      }),
    );
    for (let i = 1; i < drifts.length; i++) expect(drifts[i]!).toBeGreaterThan(drifts[i - 1]!);
    expect(drifts[drifts.length - 1]!).toBeLessThan(2e-2);
    expect(drifts[0]!).toBeGreaterThan(1e-5);
  });

  it("and with an EVEN tile count the two agree exactly, which is not a bug", () => {
    // Worth naming so the rung above is not read as measuring nothing. With no
    // tile on the axis the innermost pair straddles it half a span out on the
    // reference ruler, which is where both schemes put it — the drift only
    // appears once a tile is placed FROM another tile.
    expect(
      mosaicPitchDriftPx(SYSTEM, {
        tiles: 2,
        size: SIZE,
        pupilSamples: TILE_PS,
        guardCells: 4,
        wavelengthNm: LAMBDA,
      }),
    ).toBe(0);
  });
});

describe("§ 6o.7 — composed on a traced objective, and the seam it makes", () => {
  const SOURCE = diskSource(0.6, 5);

  /** A bar grating authored in object millimetres — structure, not a constant. */
  const bars = (periodMm: number): Specimen => (x) => ({
    re: 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / periodMm),
    im: 0,
  });

  /**
   * The mosaic's seam against a tile CENTRED ON IT.
   *
   * The reference § 6n.2's "two readings of one number" move demands: a raw
   * column difference is not the seam's error, because the two sides sample
   * different object points and a wider reference is exactly what § 6h.2 says
   * cannot be built. A third tile placed on the seam is what a mosaic there
   * ought to agree with, and it is compared along the row through the tile
   * centres so the reference is at the same field point in BOTH coordinates.
   */
  const SEAMS = new Map<
    number,
    { seam: number; away: number; neighbourMax: number; verdict: string }
  >();
  const seamAt = (guardCells: number) => {
    const hit = SEAMS.get(guardCells);
    if (hit !== undefined) return hit;

    const centreMm = { x: 1.6, y: 0 };
    const options = {
      tiles: 2,
      size: SIZE,
      pupilSamples: TILE_PS,
      guardCells,
      wavelengthNm: LAMBDA,
      centreMm,
    } as const;
    const l = mosaicLayout(SYSTEM, options);
    const specimen = bars(8 * l.objectPixelScaleMm);
    const mosaic = renderMosaic(SYSTEM, specimen, SOURCE, { ...options, patches: 2 });

    const tile0 = l.tiles[0]!.frame;
    const reference = objectFieldTile(SYSTEM, {
      size: SIZE,
      pupilSamples: TILE_PS,
      wavelengthNm: LAMBDA,
      centreMm: { x: (tile0.centreMm.x + l.tiles[1]!.frame.centreMm.x) / 2, y: tile0.centreMm.y },
    });
    const truth = renderBrightfield(
      rasterizeSpecimen(SYSTEM, reference, specimen, {}),
      tracedFieldPupils(SYSTEM, reference),
      SOURCE,
      { scale: reference.scale, pupilSamples: TILE_PS, patches: 2 },
    );

    let peak = 0;
    for (const v of truth.intensity) peak = Math.max(peak, v);
    const row = l.usefulPixels / 2;
    const at = (k: number): number =>
      Math.abs(
        mosaic.intensity[row * mosaic.size + l.usefulPixels + k]! -
          truth.intensity[(SIZE / 2) * SIZE + SIZE / 2 + k]!,
      ) / peak;

    // The worst pixel of the seam's own neighbourhood, the seam itself excluded
    // — what says whether the error is a seam or just a tile that is wrong.
    let neighbourMax = 0;
    for (let k = -4; k <= 4; k++) if (k !== 0) neighbourMax = Math.max(neighbourMax, at(k));

    const value = { seam: at(0), away: at(3), neighbourMax, verdict: mosaic.fidelity.verdict };
    SEAMS.set(guardCells, value);
    return value;
  };

  it("renders a mosaic through `renderMosaic`, rules `valid` and survives `requireHonest`", () => {
    // Every sibling step in this branch closes on a composed objective — § 6f on
    // § 6a's 4×/0.10, § 6g.3, § 6h.5 and § 6n.5 — because "the tiles compose" is
    // a claim about the picture and an assertion on an array's shape is not a
    // witness for it.
    const options = {
      tiles: 2,
      size: SIZE,
      pupilSamples: TILE_PS,
      guardCells: 4,
      wavelengthNm: LAMBDA,
      centreMm: { x: 1.6, y: 0 },
    } as const;
    const l = mosaicLayout(SYSTEM, options);
    const specimen = bars(8 * l.objectPixelScaleMm);
    const mosaic = renderMosaic(SYSTEM, specimen, diskSource(0.6, 5), {
      ...options,
      patches: 2,
      requireHonest: true,
    });
    expect(mosaic.fidelity.verdict).toBe("valid");
    expect(mosaic.size).toBe(l.size);
    expect(mosaic.intensity.length).toBe(l.size * l.size);
    expect(mosaic.pixelScaleMm).toBe(l.pixelScaleMm);
    // Real light in every tile, not three tiles and a hole where the crop went.
    for (const tile of l.tiles) {
      let total = 0;
      for (let y = 0; y < l.usefulPixels; y++) {
        for (let x = 0; x < l.usefulPixels; x++) {
          total += mosaic.intensity[(tile.originPx.y + y) * l.size + tile.originPx.x + x]!;
        }
      }
      expect(total).toBeGreaterThan(0);
    }
  });

  it("the seam step falls MONOTONICALLY with the guard — 1.8e-2 to 7.8e-4", () => {
    // The mosaic's own version of § 6o.1, on a traced 4×/0.10 at 1.6 mm rather
    // than on an ideal pupil: the step between what the mosaic puts at the seam
    // and what a tile placed there sees falls 23× as the guard goes 0 → 8 cells.
    const steps = [0, 2, 4, 8].map((g) => seamAt(g).seam);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(steps[0]!).toBeGreaterThan(1.5e-2);
    expect(steps[steps.length - 1]!).toBeLessThan(1e-3);
    expect(steps[0]! / steps[steps.length - 1]!).toBeGreaterThan(20);
  });

  it("and with no guard the error is LOCALIZED at the seam, 90× its neighbour", () => {
    // What makes it a seam rather than a tile that is merely wrong: three pixels
    // away the unguarded mosaic already agrees with the reference to 1.9e-4,
    // against 1.8e-2 at the seam itself. A tile-wide error would not do that,
    // and it is the shape a viewer would read as a grid line.
    const bare = seamAt(0);
    expect(bare.seam / bare.away).toBeGreaterThan(50);
    // And the seam is the worst pixel of its own neighbourhood, not merely a
    // large one — 1.8e-2 against 1.5e-2 four pixels either side.
    expect(bare.seam).toBeGreaterThan(bare.neighbourMax);
    // By 8 cells that is no longer true: the seam reads 7.8e-4 where its
    // neighbourhood reaches 3.5e-3, so the residual has stopped being a seam
    // and is the tile's own floor — which § 6o.3 says is this 21-point source's
    // quadrature and not the crop.
    expect(seamAt(8).seam).toBeLessThan(seamAt(8).neighbourMax);
    expect(seamAt(8).neighbourMax / seamAt(8).seam).toBeGreaterThan(3);
  });

  it("every tile of the mosaic rules `valid` on its own traced pupils", () => {
    // The verdict is the WORST tile's, `renderBrightfield`'s rule one level up:
    // a mosaic is not honest in the tiles where it happens to be.
    for (const g of [0, 4, 8]) expect(seamAt(g).verdict).toBe("valid");
  });
});

/* ── the stage: a tile that does not know which viewport asked for it ──────── */

/**
 * § 6o.8 — what a *pannable* mosaic needs on top of a composed one.
 *
 * A stage renders tiles one at a time, out of order, in workers, and keeps them
 * in a cache across pans. Every one of those verbs is an assumption about the
 * construction, and none of them was pinned by the rungs above, which only ever
 * asked `renderMosaic` for a whole finite picture at once:
 *
 *  - **a tile is formed from its own grid and nothing else**, so one rendered
 *    alone is not an approximation of the mosaic's — it is the same arithmetic,
 *    and the rung asks for it bit for bit rather than close;
 *  - **a tile's identity is its index**, not the viewport it was asked from, or
 *    a cache would serve one pan's tile into another pan's picture. That is
 *    `mosaicTileAt`, and the thing that makes it true is that the pitch is read
 *    on the **anchor** and nowhere else.
 *
 * The negative control is the version a stage would write by accident: re-anchor
 * the layout on wherever the viewport currently is. It is *nearly* right — the
 * ruler drifts by parts per million (§ 6m.4) — and the rung measures what it
 * actually costs rather than asserting that it is wrong.
 */
describe("§ 6o.8 — the anchored tile, and rendering one alone", () => {
  const SOURCE = diskSource(0.6, 5);
  const bars = (periodMm: number): Specimen => (x, y) => ({
    re: 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / periodMm) * Math.cos((2 * Math.PI * y) / periodMm),
    im: 0,
  });

  const ANCHOR = { x: 1.6, y: 0.8 } as const;
  const stageOptions = (tiles: number) =>
    ({
      tiles,
      size: SIZE,
      pupilSamples: TILE_PS,
      guardCells: 4,
      wavelengthNm: LAMBDA,
      centreMm: ANCHOR,
    }) as const;

  it("indexes from the anchor, and the index does not depend on the viewport", () => {
    // A 3×3 and a 5×5 about the same anchor must agree about where tile (i, j)
    // is — to the last bit, not to a tolerance, because the two layouts read
    // their pitch off the same anchor tile and the offsets are the same integer
    // multiples of it. This is what makes (i, j) a legitimate cache key.
    for (const tiles of [3, 5]) {
      const l = mosaicLayout(SYSTEM, stageOptions(tiles));
      const half = (tiles - 1) / 2;
      for (const t of l.tiles) {
        const anchored = mosaicTileAt(SYSTEM, stageOptions(tiles), t.col - half, t.row - half);
        expect(anchored.frame.centreMm.x).toBe(t.frame.centreMm.x);
        expect(anchored.frame.centreMm.y).toBe(t.frame.centreMm.y);
        expect(anchored.frame.centreObjectMm.x).toBe(t.frame.centreObjectMm.x);
        expect(anchored.frame.centreObjectMm.y).toBe(t.frame.centreObjectMm.y);
        expect(anchored.frame.pixelScaleMm).toBe(t.frame.pixelScaleMm);
      }
    }
    // …and the tile count itself is not in the answer: the 5×5's inner ring IS
    // the 3×3, tile for tile. A layout that re-read its pitch per viewport would
    // pass every assertion above and fail this one.
    const three = mosaicLayout(SYSTEM, stageOptions(3)).tiles;
    const five = mosaicLayout(SYSTEM, stageOptions(5)).tiles;
    for (const t of three) {
      const same = five.find((f) => f.col === t.col + 1 && f.row === t.row + 1)!;
      expect(same.frame.centreMm.x).toBe(t.frame.centreMm.x);
      expect(same.frame.centreMm.y).toBe(t.frame.centreMm.y);
    }
    expect(mosaicTileAt(SYSTEM, stageOptions(1), 0, 0).frame.centreMm.x).toBe(ANCHOR.x);
  });

  it("REFUSES a fractional index and an abutting pitch", () => {
    // The abutting fixed point is walked outward from the centre of a *finite*
    // mosaic, so it is defined by the tile count — exactly the dependence an
    // anchored index exists to remove. Refused rather than silently uniform,
    // `latticeMatchedSource`'s argument once more.
    expect(() => mosaicTileAt(SYSTEM, stageOptions(1), 0.5, 0)).toThrow(/integers/);
    expect(() =>
      mosaicTileAt(SYSTEM, { ...stageOptions(1), pitch: "abutting" }, 1, 0),
    ).toThrow(/finite mosaic/);
  });

  it("a tile rendered ALONE is the tile the mosaic composes, bit for bit", () => {
    // The stage's whole licence. Nothing is blended across a seam and nothing is
    // resampled (§ 6o's construction), so an independently rendered tile is not
    // an approximation of the composed one — anything short of equality would
    // mean the composition was doing something the crop does not say it does.
    const options = { ...stageOptions(3), patches: 2 };
    const l = mosaicLayout(SYSTEM, options);
    const specimen = bars(8 * l.objectPixelScaleMm);
    const mosaic = renderMosaic(SYSTEM, specimen, SOURCE, options);

    for (const [col, row] of [
      [0, 0],
      [2, 1],
    ] as const) {
      const alone = renderMosaicTile(
        SYSTEM,
        specimen,
        SOURCE,
        options,
        mosaicTileAt(SYSTEM, options, col - 1, row - 1),
      );
      expect(alone.size).toBe(l.usefulPixels);
      const origin = l.tiles.find((t) => t.col === col && t.row === row)!.originPx;
      for (let y = 0; y < l.usefulPixels; y++) {
        for (let x = 0; x < l.usefulPixels; x++) {
          expect(alone.intensity[y * l.usefulPixels + x]!).toBe(
            mosaic.intensity[(origin.y + y) * l.size + origin.x + x]!,
          );
        }
      }
    }

    // CONTROL: the two tiles above are different pictures, so the equality is a
    // claim about registration and not about a mosaic that is flat everywhere.
    const a = renderMosaicTile(SYSTEM, specimen, SOURCE, options, mosaicTileAt(SYSTEM, options, -1, -1));
    const b = renderMosaicTile(SYSTEM, specimen, SOURCE, options, mosaicTileAt(SYSTEM, options, 1, 0));
    let differs = 0;
    for (let i = 0; i < a.intensity.length; i++) {
      if (a.intensity[i] !== b.intensity[i]) differs++;
    }
    expect(differs).toBeGreaterThan(0.9 * a.intensity.length);

    // And the mosaic's readouts are the fold over its tiles' own — the worst
    // verdict, the max grid step, the min contributing points.
    expect(a.fidelity.verdict).toBe(mosaic.fidelity.verdict);
    expect(mosaic.maxGridPhaseStepWaves).toBeGreaterThanOrEqual(a.maxGridPhaseStepWaves);
    expect(mosaic.contributingPoints).toBeLessThanOrEqual(a.contributingPoints);
  });

  it("NEGATIVE CONTROL: re-anchoring on the viewport moves the grid, measurably", () => {
    // What a stage writes by accident: lay the mosaic out about wherever you
    // have panned to, and index from there. It is *nearly* right, which is why
    // it needs a number rather than an argument — the pitch is read on a tile
    // that has moved, and § 6m.4's ruler drifts by parts per million with field.
    //
    // Measured two ways, and they are two different sizes of mistake.
    const axis = { ...stageOptions(1), centreMm: { x: 0, y: 0 } } as const;
    const anchored = mosaicTileAt(SYSTEM, axis, 8, 0);
    const pxFrom = (centreMm: { x: number; y: number }, col: number): number =>
      Math.abs(
        mosaicTileAt(SYSTEM, { ...axis, centreMm }, col, 0).frame.centreMm.x -
          anchored.frame.centreMm.x,
      ) / anchored.frame.pixelScaleMm;

    // Re-anchored on a tile CENTRE — the benign case, and the one that says the
    // ruler drift is real rather than f64 noise: 3.4e-3 px eight tiles out, which
    // is § 6m.4's parts per million arriving where it can be counted in pixels.
    const onTile = pxFrom(mosaicTileAt(SYSTEM, axis, 4, 0).frame.centreMm, 4);
    expect(onTile).toBeGreaterThan(1e-4);
    expect(onTile).toBeLessThan(1e-2);

    // Re-anchored where the viewport actually IS — a pan is not a whole number of
    // tiles — and the grid moves by that fraction of a pitch: a third of the
    // 48-pixel span is 16.0 px, nearly four orders past the drift, and a picture
    // that would visibly jump on every pan.
    // The lattice, not the ruler, is what anchoring protects.
    const pitchMm = anchored.frame.centreMm.x / 8;
    const drifted = pxFrom({ x: 4 * pitchMm + pitchMm / 3, y: 0 }, 4);
    expect(drifted).toBeGreaterThan(10);
    console.log(
      `re-anchoring costs ${onTile.toExponential(2)} px on a tile centre and ` +
        `${drifted.toFixed(1)} px a third of a tile off it`,
    );
  });
});
