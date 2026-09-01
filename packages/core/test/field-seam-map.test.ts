import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6cj — the field seam's own edge, which § 6ci located and misnamed.
 *
 * § 6ci.3 measured a departure from its pure-geometry anisotropy that
 * quadruples with the field offset, called it `(cx/R)^2`, and attributed it to
 * the quadratic truncation of `sqrt(1 + r^2/R^2)` in the pixel scale. Both
 * halves of that sentence are wrong, and the third rung's own error ladder
 * already said so: it put the map's omission at 1e-4 and the truncation at
 * 5e-6 at the same anchor. This step swaps the two independently.
 *
 * ## The scale's truncation is 2% of it, and it is the map that is left
 *
 * Scale model in {traced, hypot, quadratic} against map in {on, off}, at a
 * MATCHED kept tile across the offset, is a 2x3 grid where § 6ci's ladder was
 * a cumulative one. With the map on, the crudest scale model reads the live
 * seam's anisotropy to 1e-4 at twelve millimetres off axis. With it off, the
 * exact traced scale is 1.5e-2 out at the same place (§ 6cj.0).
 *
 * The truncation's own correction is derivable, and it carries a `w^2` the
 * map's term does not: the exact-square-root pairs against § 6ci.2's quadratic
 * ones depart by `a^2 w^2 / 2` as the tile vanishes, four times bigger for
 * twice the offset and four times SMALLER for half the tile. That is why it
 * cannot be the edge — the edge does not care about the tile.
 *
 * ## What the map does to a seam is its own local stretch
 *
 * A radial map takes a small displacement to `h'(r)` along the radius and
 * `h(r)/r` across it. Replace the map by that Jacobian and the seam does not
 * move (1e-9), so the whole of the map's contribution is two numbers per probe
 * (§ 6cj.1). The row seam's mismatch is 99% tangential and the column seam's a
 * third radial, which is why the two branches are stretched differently and the
 * map does NOT divide out off axis the way § 6cd.2 and § 6ci.3 found it does on
 * it. It also decides WHICH corner of the picture is the worst probe — § 6ci
 * recorded the row branch switching between two corners "as the tile grows"
 * without a reason; the reason is that the map ranks them and the geometry ties.
 *
 * ## And the coefficient is the map's own quadratic, not the scale's radius
 *
 * `h(r) = (r/M)(1 + D r^2 + ...)`, and one `D` fits both the tangential stretch
 * and the radial one. Its radius `1/sqrt|D|` is 89 to 107 millimetres and moves
 * with NA; the scale's `R` is 150 to 152 and moves with neither. The edge is
 * `D cx^2`, not `(cx/R)^2` — a factor of 2.8 in the coefficient (§ 6cj.2), and
 * it is exactly the half-percent § 6ci.5 could not account for (§ 6cj.3).
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6ci used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

type Cell = "s10" | "f10" | "s20" | "f20";
const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};
/** § 6bo's shapes at k = 1. `size` and `pupilSamples`, in that order. */
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];

const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
const shareOfI = (i: number): number => i / 2 ** 23;
/** § 6ca's own two ends of the guard secant. */
const TINY = 8;
const WIDE = 524288;

const optionsAt = (c: Cell, j: number, i: number, cx: number): FluorescenceMosaicOptions => ({
  size: BIG,
  pupilSamples: PS_AT(c, j),
  slabs: THIN,
  samples: [
    { nm: 430, weight: 1 },
    { nm: DESIGN, weight: 1 },
    { nm: 656.2725, weight: 1 },
  ],
  tiles: 3,
  guardCells: guardAt(j, i),
  stageMm: FREE_STAGE,
  radialMapSeed: "magnification",
  centreMm: { x: cx, y: 0 },
});

/** § 6ci.1's three readings of one number: traced, its hypot, its quadratic. */
type ScaleModel = "traced" | "hypot" | "quad";
/**
 * What stands between the frame and the picture: nothing, the map, the map's
 * own Jacobian, or that Jacobian to its leading order — which needs `D` and no
 * trace, and is the form this step derives.
 */
type Warp = "none" | "map" | "jac" | "lin";

interface Branch {
  readonly value: number;
  /** Which of the 65 probes along the seam won, and where it sits. */
  readonly probe: number;
  readonly radiusMm: number;
  /** The mismatch's radial share — 1 is radial, 0 tangential. */
  readonly cos2: number;
}
const EMPTY: Branch = { value: 0, probe: -1, radiusMm: 0, cos2: 0 };

/**
 * § 6ci.0's closed form with both of its assumptions made swappable.
 *
 * Nothing here renders or lays out a mosaic. The two tiles at a seam read the
 * same composed pixel at rendered offsets +U and -U, their frames differ only
 * in `pixelScaleMm`, and the mismatch goes through the radial map — so the
 * whole seam is one scale model and one warp.
 */
function seam(
  c: Cell,
  j: number,
  i: number,
  cx: number,
  models: readonly ScaleModel[],
  warps: readonly Warp[],
  quadratic = 0,
) {
  const system = LENS[c];
  const options = optionsAt(c, j, i, cx);
  const g = fluorescenceMosaicGeometry(system, options);
  const n = g.tilesPerAxis;
  const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
  const near = U - g.overlapPixels;
  const half = (n - 1) / 2;
  const magnification = g.planes[g.rulerIndex]!.frame.magnification;
  const nm = g.rulerWavelengthNm;
  const centre = (k: number): { x: number; y: number } => {
    const col = k % n;
    const row = (k - col) / n;
    return { x: cx + (col - half) * g.pitchMm, y: (row - half) * g.pitchMm };
  };
  const axis = objectFieldTile(system, { ...options, centreMm: { x: 0, y: 0 }, wavelengthNm: nm });
  const s0 = axis.pixelScaleMm;
  const R0 = axis.scale.referenceRadius;
  const scales: Record<ScaleModel, number[]> = { traced: [], hypot: [], quad: [] };
  for (let k = 0; k < n * n; k++) {
    const p = centre(k);
    const r2 = p.x * p.x + p.y * p.y;
    if (models.includes("traced")) {
      scales.traced.push(
        objectFieldTile(system, { ...options, centreMm: p, wavelengthNm: nm }).pixelScaleMm,
      );
    }
    scales.hypot.push((s0 * Math.hypot(R0, Math.sqrt(r2))) / R0);
    scales.quad.push(s0 * (1 + r2 / (2 * R0 * R0)));
  }
  const height = (r: number): number =>
    objectHeightForImageRadius(system, r, nm, { magnification });
  const probes = 65;
  const along = (k: number): number => Math.round(((g.size - 1) * k) / (probes - 1));
  const owner = (t: number): number => Math.min(n - 1, Math.floor(t / g.pitchPixels));
  const out: Record<string, Branch> = {};
  for (const model of models) {
    const S = scales[model];
    for (const warp of warps) {
      let rows = EMPTY;
      let cols = EMPTY;
      const put = (
        best: Branch,
        probe: number,
        a: { x: number; y: number },
        b: { x: number; y: number },
      ): Branch => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const px = (a.x + b.x) / 2;
        const py = (a.y + b.y) / 2;
        const r = Math.hypot(px, py);
        const dr = (dx * px + dy * py) / r;
        const dt = (-dx * py + dy * px) / r;
        let value: number;
        if (warp === "none") value = Math.hypot(dx, dy);
        else if (warp === "map") {
          const ra = Math.hypot(a.x, a.y);
          const rb = Math.hypot(b.x, b.y);
          const ha = height(ra) / ra;
          const hb = height(rb) / rb;
          value = Math.hypot(hb * b.x - ha * a.x, hb * b.y - ha * a.y);
        } else if (warp === "jac") {
          // The map's local Jacobian: h'(r) along the radius, h(r)/r across it.
          const d = r * 1e-5;
          const radial = (height(r + d) - height(r - d)) / (2 * d);
          value = Math.hypot(radial * dr, (height(r) / r) * dt);
        } else {
          // The same two stretches to their own leading order, so that the
          // whole map is one number: `h/r` is `1 + D r^2` and `h'` is
          // `1 + 3 D r^2`, both times the on-axis magnification, which drops
          // out of a ratio of two seams.
          const t = 1 + quadratic * r * r;
          value = t * Math.hypot((1 + 2 * quadratic * r * r) * dr, dt);
        }
        if (value <= best.value) return best;
        return { value, probe, radiusMm: r, cos2: (dr * dr) / (dr * dr + dt * dt) };
      };
      for (let s = 1; s < n; s++) {
        for (let p = 0; p < probes; p++) {
          const t = along(p);
          const other = owner(t);
          const inTile = g.croppedPixels + g.guardPixels + (t - other * g.pitchPixels);
          const across = inTile - g.tileSize / 2;
          {
            const a = s - 1 + other * n;
            const b = s + other * n;
            const ca = centre(a);
            const cb = centre(b);
            cols = put(
              cols,
              p,
              { x: ca.x + near * S[a]!, y: ca.y + across * S[a]! },
              { x: cb.x - U * S[b]!, y: cb.y + across * S[b]! },
            );
          }
          {
            const a = other + (s - 1) * n;
            const b = other + s * n;
            const ca = centre(a);
            const cb = centre(b);
            rows = put(
              rows,
              p,
              { x: ca.x + across * S[a]!, y: ca.y + near * S[a]! },
              { x: cb.x + across * S[b]!, y: cb.y - U * S[b]! },
            );
          }
        }
      }
      out[`${model}/${warp}/rows`] = rows;
      out[`${model}/${warp}/cols`] = cols;
    }
  }
  const anisotropy = (model: ScaleModel, warp: Warp): number =>
    out[`${model}/${warp}/rows`]!.value / out[`${model}/${warp}/cols`]!.value;
  return { w: (U * g.pixelScaleMm) / cx, out, anisotropy, R0 };
}

const live = (c: Cell, j: number, i: number, cx: number) => {
  const s = mosaicSeamShiftMm(LENS[c], optionsAt(c, j, i, cx), 65);
  return { rows: s.betweenRowsMm, cols: s.betweenColumnsMm };
};

/** § 6ci.2's two shapes at three tiles, and § 6ci.3's curve. */
const shapeRows = (w: number): number => Math.hypot(2 + 3 * w, w);
const shapeCols = (w: number): number => Math.hypot(1 + 3 * w, 1 + w);
const PHI = (w: number): number => shapeRows(w) / shapeCols(w);
/** § 6ci.4's axis constant, for the ceiling. */
const AXIS = (w: number): number =>
  1 + (w * (5 * w * w + 5 * w + 1)) / (75 * w ** 4 + 135 * w ** 3 + 95 * w * w + 31 * w + 4);

/**
 * The two worst corners, named rather than searched for.
 *
 * The column seam's probe sits at `cx(1 + w, -3w)` with its mismatch along
 * `(1 + 3w, 1 + w)`; the row seam's INNER corner at `cx(1 + w, -w)` with its
 * mismatch along `(w, 2 + 3w)`. Both radii are in units of the field offset.
 */
const rho2Cols = (w: number): number => (1 + w) ** 2 + 9 * w * w;
const cos2Cols = (w: number): number =>
  (1 + w) ** 2 / (rho2Cols(w) * ((1 + 3 * w) ** 2 + (1 + w) ** 2));
const rho2Rows = (w: number): number => (1 + w) ** 2 + w * w;
const cos2Rows = (w: number): number =>
  (w * (3 + 4 * w)) ** 2 / (rho2Rows(w) * (w * w + (2 + 3 * w) ** 2));
/**
 * The map's whole effect on the anisotropy, to its own leading order: the
 * tangential stretch is `1 + D r^2` and the radial one `1 + 3 D r^2`, so a
 * mismatch with a radial share `c^2` is stretched by `1 + D r^2 (1 + 2 c^2)`.
 */
const G = (w: number): number =>
  rho2Rows(w) * (1 + 2 * cos2Rows(w)) - rho2Cols(w) * (1 + 2 * cos2Cols(w));

/** `h(r) = (r/M)(1 + D r^2 + ...)`, read off the map at one comfortable radius. */
function mapQuadratic(c: Cell, atMm = 1): number {
  const system = LENS[c];
  const options = optionsAt(c, 8, 65536, 2);
  const g = fluorescenceMosaicGeometry(system, options);
  const nm = g.rulerWavelengthNm;
  const magnification = g.planes[g.rulerIndex]!.frame.magnification;
  const h = (r: number): number => objectHeightForImageRadius(system, r, nm, { magnification });
  const d = atMm * 1e-5;
  const kappa = (atMm * ((h(atMm + d) - h(atMm - d)) / (2 * d))) / h(atMm);
  return (kappa - 1) / (2 * atMm * atMm);
}

/** The offsets § 6cj.0 walks, each with the tile that holds `w` fixed. */
const WALK = [
  [1, 4],
  [2, 8],
  [4, 16],
  [8, 32],
  [12, 48],
] as const;

const interact = (v: readonly number[]): number => v[3]! / v[2]! / (v[1]! / v[0]!);

describe("§ 6cj.0 — the edge is the map's, and the scale's truncation is 2% of it", () => {
  it("reads live to 1e-4 with the crudest scale and 1.5e-2 with no map", () => {
    // The 2x3 grid at a MATCHED kept tile: w is 0.0849 at every offset, so
    // nothing here moves but the field. § 6ci's own ladder swapped one thing
    // per rung and could not separate these two.
    const off: number[] = [];
    for (const [cx, j] of WALK) {
      const s = seam("s20", j, 65536, cx, ["traced", "hypot", "quad"], ["map", "none"]);
      const l = live("s20", j, 65536, cx);
      const phi = l.rows / l.cols;
      expect(s.w).toBeCloseTo(0.0849, 3);
      // Map ON: the scale model barely matters. Even the quadratic — the one
      // § 6ci blamed — is inside 1e-4 of live at every offset.
      expect(Math.abs(phi / s.anisotropy("traced", "map") - 1)).toBeLessThan(1e-10);
      expect(Math.abs(phi / s.anisotropy("hypot", "map") - 1)).toBeLessThan(1e-4);
      expect(Math.abs(phi / s.anisotropy("quad", "map") - 1)).toBeLessThan(1e-4);
      // Map OFF: the EXACT traced scale is as far out as the quadratic one, so
      // what is missing is not in the scale at all.
      const traced = Math.abs(phi / s.anisotropy("traced", "none") - 1);
      const quad = Math.abs(phi / s.anisotropy("quad", "none") - 1);
      expect(Math.abs(traced / quad - 1)).toBeLessThan(0.05);
      // And the crudest model's whole error, with the map on, is a few percent
      // of what dropping the map costs.
      expect(Math.abs(phi / s.anisotropy("quad", "map") - 1)).toBeLessThan(0.05 * traced);
      off.push(traced);
    }
    // § 6ci.3's own measurement, unchanged: four times bigger for twice the
    // offset, out to 1.5e-2 where a slide scanner's outer tiles sit.
    expect(off[4]!).toBeGreaterThan(1.4e-2);
    expect(off[3]! / off[2]!).toBeCloseTo(4, 1);
    // 2.20 against the square law's 2.25, and the shortfall is the map's own
    // next term: D is 1.2531e-4 on axis and 1.20e-4 by twelve millimetres, so
    // the coefficient the edge is quadrupling is itself 4% smaller out there.
    expect(off[4]! / off[3]!).toBeCloseTo(2.2, 1);
  }, 900000);

  it("and the truncation carries a w^2 that the map's term does not", () => {
    // Pure arithmetic on the two pair forms — no trace, no mosaic. § 6ci.2's
    // pairs come from `s = s0 (1 + r^2/2R^2)`; the exact sphere is
    // `s = s0 sqrt(1 + r^2/R^2)`, and the two differ by `a^2 w^2 / 2`.
    const exact = (a: number, w: number): number => {
      const p = 2 * a * w;
      const f = (r2: number): number => Math.sqrt(1 + r2);
      const cols = Math.hypot(
        f(a * a + p * p) + f((a + p) ** 2 + p * p) - 2 * f(a * a),
        f((a + p) ** 2 + p * p) - f(a * a + p * p),
      );
      const rows = Math.hypot(
        f((a + p) ** 2 + p * p) + f((a + p) ** 2) - 2 * f(a * a),
        f((a + p) ** 2 + p * p) - f((a + p) ** 2),
      );
      return rows / cols;
    };
    for (const w of [0.02, 0.085, 0.34]) {
      const at = (a: number): number => exact(a, w) / PHI(w) - 1;
      // Four times bigger for twice the field offset — the same law as the
      // map's term, which is why § 6ci could not tell them apart by that alone.
      expect(at(0.02) / at(0.01)).toBeCloseTo(4, 1);
      expect(at(0.04) / at(0.02)).toBeCloseTo(4, 1);
      // But four times SMALLER for half the tile, which the map's term is not:
      // the coefficient is `a^2 w^2 / 2` and it vanishes with the tile.
      expect(at(0.01) / ((0.01 * 0.01 * w * w) / 2)).toBeGreaterThan(0.45);
      expect(at(0.01) / ((0.01 * 0.01 * w * w) / 2)).toBeLessThan(1);
    }
    // 1.8856e-8 at 40 digits; in doubles the second difference of three numbers
    // near 1 keeps three of them, which is why this is a ratio and not a pin.
    expect(Math.abs((exact(0.01, 0.02) / PHI(0.02) - 1) / 1.8856e-8 - 1)).toBeLessThan(0.01);
    // At § 6cj.0's own anchor that is 2.6e-6, where the map's term is 1.7e-3.
    const a = 4 / 150.086;
    expect((a * a * 0.0849 ** 2) / 2).toBeCloseTo(2.6e-6, 7);
  }, 300000);
});

describe("§ 6cj.1 — what the map does to a seam is its own local stretch", () => {
  it("is the Jacobian and nothing else: linearising moves nothing", () => {
    // A radial map takes a small displacement to h'(r) along the radius and
    // h(r)/r across it. The seam is 1e-5 of its own radius, so the two agree to
    // the square of that — and the map's whole contribution is two numbers.
    for (const [cx, j] of [
      [8, 8],
      [8, 32],
      [8, 128],
      [2, 8],
      [12, 48],
    ] as const) {
      const s = seam("s20", j, 65536, cx, ["quad"], ["none", "map", "jac"]);
      for (const b of ["rows", "cols"] as const) {
        const map = s.out[`quad/map/${b}`]!.value;
        const jac = s.out[`quad/jac/${b}`]!.value;
        expect(Math.abs(jac / map - 1)).toBeLessThan(1e-8);
      }
    }
  }, 900000);

  it("with the row seam tangential, the column seam a third radial", () => {
    // Which is why it does not divide out off axis, where § 6cd.2 and § 6ci.3
    // found that it does on it: the two branches present DIFFERENT shares of
    // themselves to the radial stretch, so one is charged for it and one is not.
    const cx = 2;
    const s = seam("s20", 8, 65536, cx, ["quad"], ["none", "map"]);
    const rows = s.out["quad/map/rows"]!;
    const cols = s.out["quad/map/cols"]!;
    expect(rows.cos2).toBeLessThan(0.02);
    expect(cols.cos2).toBeGreaterThan(0.3);
    expect(cols.cos2).toBeLessThan(0.4);
    // The corners named rather than searched for: § 6cj's own algebra puts them
    // at cx(1+w, -w) and cx(1+w, -3w), with mismatches along (w, 2+3w) and
    // (1+3w, 1+w), and reads both radii to a part in 400 and the column's
    // radial share to a part in 800. The row corner's own share is 2.8% out,
    // being a ratio of two things the tile has made small.
    expect(Math.abs(cos2Rows(s.w) / rows.cos2 - 1)).toBeLessThan(0.05);
    expect(Math.abs(cos2Cols(s.w) / cols.cos2 - 1)).toBeLessThan(0.005);
    expect(Math.abs(Math.sqrt(rho2Cols(s.w)) / (cols.radiusMm / cx) - 1)).toBeLessThan(0.005);
    expect(Math.abs(Math.sqrt(rho2Rows(s.w)) / (rows.radiusMm / cx) - 1)).toBeLessThan(0.005);
    // And the map RANKS the two corners the geometry ties. § 6ci saw the row
    // branch switch between them "as the tile grows" and had no reason for it;
    // the reason is that without the map there is nothing to choose.
    expect(s.out["quad/none/rows"]!.probe).toBe(64);
    expect(s.out["quad/map/rows"]!.probe).toBe(43);
    expect(s.out["quad/none/rows"]!.radiusMm).toBeGreaterThan(
      s.out["quad/map/rows"]!.radiusMm,
    );
    // The column branch has no such tie and does not move.
    expect(s.out["quad/none/cols"]!.probe).toBe(s.out["quad/map/cols"]!.probe);
  }, 900000);
});

describe("§ 6cj.2 — and the coefficient is the map's quadratic, not the scale's radius", () => {
  it("is one D per cell, whose radius is 89 to 107 mm against the scale's 150", () => {
    const expected: Record<Cell, readonly [number, number]> = {
      s10: [-1.203087e-4, 91.17],
      f10: [-8.763124e-5, 106.82],
      s20: [-1.253073e-4, 89.33],
      f20: [-9.413631e-5, 103.07],
    };
    for (const c of CELLS) {
      const D = mapQuadratic(c);
      expect(D).toBeCloseTo(expected[c][0], 9);
      expect(1 / Math.sqrt(-D)).toBeCloseTo(expected[c][1], 1);
      // ONE coefficient, read two ways: the tangential stretch h/r is
      // 1 + D r^2 and the radial one 1 + 3 D r^2, so the ratio of the two is
      // 1 + 2 D r^2 — and the D that fits the ratio fits the stretch itself.
      const system = LENS[c];
      const options = optionsAt(c, 8, 65536, 2);
      const g = fluorescenceMosaicGeometry(system, options);
      const nm = g.rulerWavelengthNm;
      const magnification = g.planes[g.rulerIndex]!.frame.magnification;
      const h = (r: number): number => objectHeightForImageRadius(system, r, nm, { magnification });
      const tan = (r: number): number => h(r) / r;
      const onAxis = tan(1e-3);
      for (const r of [1, 2, 4]) {
        expect((tan(r) / onAxis - 1) / (r * r) / D).toBeCloseTo(1, 2);
      }
      // And it is NOT the scale's radius, which is what § 6ci.3 named: that one
      // is 150 mm in every cell, so it cannot produce a coefficient that moves.
      const s = seam(c, 8, 65536, 2, ["quad"], ["none"]);
      expect(s.R0).toBeGreaterThan(150);
      expect(s.R0).toBeLessThan(152);
      expect(s.R0 / (1 / Math.sqrt(-D))).toBeGreaterThan(1.4);
    }
    // The two radii do not even sort the same way: the map's follows NA, and
    // the scale's follows neither NA nor magnification.
    expect(1 / Math.sqrt(-mapQuadratic("s10"))).toBeLessThan(1 / Math.sqrt(-mapQuadratic("f10")));
    expect(1 / Math.sqrt(-mapQuadratic("s20"))).toBeLessThan(1 / Math.sqrt(-mapQuadratic("f20")));
    expect(Math.abs(mapQuadratic("s10") / mapQuadratic("s20") - 1)).toBeLessThan(0.05);
    expect(Math.abs(mapQuadratic("f10") / mapQuadratic("f20") - 1)).toBeLessThan(0.08);
  }, 900000);

  it("so the anisotropy's correction is D cx^2 at the corners the algebra names", () => {
    // At the named corners the geometry factor is exactly 1 where the tile
    // vanishes: the row seam is purely tangential and the column seam is at
    // 45 degrees to its own radius, so the two stretches differ by exactly one
    // power of the radial one.
    expect(G(0)).toBe(-1);
    expect(cos2Rows(0)).toBe(0);
    expect(cos2Cols(0)).toBe(0.5);
    for (const w of [1e-4, 1e-3, 1e-2]) expect(G(w)).toBeCloseTo(-1, 1);
    // Live, the factor measures 0.86 to 1.19 rather than 1, because the WORST
    // probe is the map's choice and not the geometry's (§ 6cj.1) — the max
    // wanders as the tile shrinks and the walk flattens. The bound is what is
    // load-bearing: the correction is D cx^2 to within a factor of 1.2.
    const D = mapQuadratic("s20");
    for (const [cx, j] of [
      [8, 8],
      [8, 32],
      [8, 128],
    ] as const) {
      const s = seam("s20", j, 65536, cx, ["quad"], ["none", "map"]);
      const factor = s.anisotropy("quad", "map") / s.anisotropy("quad", "none") - 1;
      const measured = factor / (-D * cx * cx);
      expect(measured).toBeGreaterThan(0.8);
      expect(measured).toBeLessThan(1.2);
    }
  }, 900000);
});

describe("§ 6cj.3 — which is § 6ci.5's half-percent overshoot", () => {
  it("takes 0.6% and 0.9% to 0.05% and 0.03%", () => {
    // § 6ci.5 composed its closed form the way § 6ca composed the live one and
    // overshot both guard slopes, blaming "the (cx/R)^2 truncation plus the
    // map". It is the map alone, and multiplying the pure-geometry seam by the
    // stretch of § 6cj.1 — which needs D and no trace — recovers it.
    const j = 128;
    const cx = 2;
    const dshare = shareOfI(WIDE) - shareOfI(TINY);
    const D: Record<string, number> = {};
    for (const c of CELLS) D[c] = mapQuadratic(c);
    const cache = new Map<string, ReturnType<typeof seam>>();
    const S = (c: Cell, i: number): ReturnType<typeof seam> => {
      const key = `${c}/${i}`;
      if (!cache.has(key)) {
        cache.set(key, seam(c, j, i, cx, ["quad"], ["none", "lin"], D[c]!));
      }
      return cache.get(key)!;
    };
    const liveCache = new Map<string, { rows: number; cols: number }>();
    const L = (c: Cell, i: number) => {
      const key = `${c}/${i}`;
      if (!liveCache.has(key)) liveCache.set(key, live(c, j, i, cx));
      return liveCache.get(key)!;
    };
    const slope = (pick: (c: Cell, i: number) => number): number =>
      Math.log(
        interact(CELLS.map((c) => pick(c, WIDE))) / interact(CELLS.map((c) => pick(c, TINY))),
      ) / dshare;
    const got: Record<string, { live: number; geom: number; fixed: number }> = {};
    for (const b of ["rows", "cols"] as const) {
      const shape = b === "rows" ? shapeRows : shapeCols;
      got[b] = {
        live: slope((c, i) => L(c, i)[b]),
        geom: slope((c, i) => {
          const w = S(c, i).w;
          return w * w * shape(w);
        }),
        fixed: slope((c, i) => {
          // The stretch RANKS the corners (§ 6cj.1), so the corrected seam is a
          // maximum taken with it in hand — reusing the geometry's own winner
          // is eight times worse, because on the row branch it is the wrong
          // corner.
          const s = S(c, i);
          const stretch = s.out[`quad/lin/${b}`]!.value / s.out[`quad/none/${b}`]!.value;
          return s.w * s.w * shape(s.w) * stretch;
        }),
      };
    }
    // § 6ci.5's own two readings, unchanged.
    expect(got["rows"]!.live).toBeCloseTo(0.714483, 5);
    expect(got["cols"]!.live).toBeCloseTo(0.73318, 5);
    expect(got["rows"]!.geom / got["rows"]!.live - 1).toBeCloseTo(0.006, 3);
    expect(got["cols"]!.geom / got["cols"]!.live - 1).toBeCloseTo(0.0088, 3);
    // And with the stretch in front of them, an order of magnitude closer —
    // on the branch § 6ci overshot most, thirty times closer.
    expect(Math.abs(got["rows"]!.fixed / got["rows"]!.live - 1)).toBeLessThan(1e-3);
    expect(Math.abs(got["cols"]!.fixed / got["cols"]!.live - 1)).toBeLessThan(5e-4);
    expect(got["cols"]!.fixed / got["rows"]!.fixed).toBeCloseTo(1.0259, 3);
    expect(got["cols"]!.live / got["rows"]!.live).toBeCloseTo(1.02617, 4);
  }, 1800000);
});

describe("§ 6cj.4 — and § 6ci.4's ceiling survives, one-sidedly", () => {
  it("is only ever lowered by the map, and the field runs out before it rises", () => {
    // The stretch depends on the tile through the corner radii, so it feeds the
    // guard slopes and § 6ci.4's ceiling is not automatically safe. Walk the
    // live peak out into the field: it FALLS, monotonically, and the bound
    // holds with room to spare everywhere it can be measured at all.
    const CEILING = 1.0366475533;
    const peakAt = (cx: number, js: readonly number[]): { a: number; w: number } => {
      let best = { a: 0, w: 0 };
      for (const j of js) {
        const a = live("s20", j, 32768, cx);
        const b = live("s20", j, 131072, cx);
        const ga = seam("s20", j, 32768, cx, ["quad"], ["none"]).w;
        const gb = seam("s20", j, 131072, cx, ["quad"], ["none"]).w;
        const d = Math.log(gb / ga);
        const A = Math.log(b.cols / a.cols) / d / (Math.log(b.rows / a.rows) / d);
        if (A > best.a) best = { a: A, w: Math.sqrt(ga * gb) };
      }
      return best;
    };
    const near = peakAt(2, [43, 48]);
    const mid = peakAt(4, [86, 96]);
    const far = peakAt(7, [134, 150]);
    for (const p of [near, mid, far]) expect(p.a).toBeLessThan(CEILING);
    expect(near.a).toBeCloseTo(1.0365853, 6);
    expect(mid.a).toBeCloseTo(1.0357103, 6);
    expect(far.a).toBeCloseTo(1.0339935, 6);
    expect(near.a).toBeGreaterThan(mid.a);
    expect(mid.a).toBeGreaterThan(far.a);
    // § 6ci.4's peak sits at w* = 0.509, where a three-tile mosaic's outer
    // corner is 2.53 field offsets out, and this objective's chief ray stops
    // reaching past an image radius of about 17.4 mm. So the peak itself is
    // unreachable past 6.9 mm off axis: at seven the seam has no value at all,
    // and the ceiling is out of the domain before it is ever in danger.
    expect(17.4 / 2.527).toBeGreaterThan(6.8);
    expect(17.4 / 2.527).toBeLessThan(7);
    expect(() => live("s20", 167, 32768, 7)).toThrow(/no object height reaches image radius/);
  }, 1800000);
});
