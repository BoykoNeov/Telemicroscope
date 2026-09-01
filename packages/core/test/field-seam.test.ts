import { describe, it, expect } from "vitest";
import {
  mosaicSeamShiftMm,
  fluorescenceMosaicGeometry,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import {
  objectFieldTile,
  objectFieldFrame,
  objectHeightForImageRadius,
} from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

/**
 * § 6ci — the field scan's seam, which nothing had measured.
 *
 * § 6ca.1 read the FIELD interact's guard sensitivity on each axis, found
 * 0.7145 against 0.7332, and called the 2.6% between them nothing: "**A field
 * scan gives every tile its own frame, so its seam is a ruler mismatch that
 * does not care which way the two tiles are adjacent.**" That sentence is the
 * only thing standing under the claim — § 6cd's corner form is a stage-scan
 * object and there was no field-scan counterpart to differentiate. There is
 * one, it is simpler than the stage's, and it says the sentence is wrong and
 * the conclusion right, for a different reason and with a bound.
 *
 * ## The seam is three pixel scales
 *
 * With no overlap `pitchPixels === keptPixels === 2U`, `U = size/2 - cropped -
 * guard`. So the two tiles at a seam are asked about the same composed pixel at
 * rendered offsets `+U` and `-U`, their frames differ ONLY in `pixelScaleMm`
 * (`magnification` is the shared on-axis reading and the centres differ by
 * exactly the pitch, which is `2U` times the ANCHOR's scale), and the image
 * mismatch is
 *
 *     along the seam's own axis:  U * (s_a + s_b - 2 s_r)
 *     across it:                  (i - size/2) * (s_a - s_b)
 *
 * a second difference of the scale and a first, the anchor's own frame entering
 * every seam in the picture. Both points then go through the radial map. That
 * equals the live `betweenRowsMm`/`betweenColumnsMm` to 1e-12 (§ 6ci.0), and it
 * wants no mosaic and no render — § 6cd.0's economy on the other geometry.
 *
 * ## And the scale is one traced number per field RADIUS
 *
 * `pixelScaleMm` moves with field only through `referenceRadius / exitRadius`,
 * and the exit radius does not move at all — it is field-invariant to the last
 * bit. So `s` is `referenceRadius`, a function of the tile centre's RADIUS
 * alone, and § 6m.3's `hypot(R_axis, r)` carries it to 4.3e-11 at half a
 * millimetre off axis, departing as the fourth power (§ 6ci.1).
 *
 * ## Which makes both seams SECOND order in the kept tile
 *
 * Write `s(r) = s0 (1 + r^2/2R^2)`, put the worst probe at the picture's outer
 * corner, and with `h = (tiles-1)/2`, `q = 4h^2 - 2h + 1` and `w = xi/cx` the
 * two mismatches are, in one common unit,
 *
 *     columns: ((2h-1) + q w,  1 + (2h-1) w)      rows: (2h + q w,  (2h-1) w)
 *
 * both carrying `w^2` from the `U` in front and the `xi` inside. The stage's
 * are FIRST and second (§ 6ce, § 6cf.2) — that one power is the whole
 * difference between the two geometries, and it is why § 6ca.1's field slopes
 * nearly agree where its stage slopes differ by 133%.
 *
 * ## So the anisotropy is the MOSAIC's size and the axis constant is bounded
 *
 * The seam is NOT axis-blind: its anisotropy is a curve of `w` alone,
 * `Phi_h(0) = 2h/sqrt((2h-1)^2 + 1)` — **sqrt2 at three tiles**, 4/sqrt10 at
 * five, 6/sqrt26 at seven, falling to 1 as the mosaic grows (§ 6ci.3).
 *
 * The guard SENSITIVITY is, and provably. Both log slopes start at 2, so the
 * field's axis constant is exactly 1 at zero tile against the stage's exactly 2
 * (§ 6cf.2), it has a maximum at one sextic root, and at three tiles — the
 * worst mosaic there is — that maximum is **1.0366476** (§ 6ci.4). § 6ca.1's
 * 2.6% is that constant at that anchor, under a ceiling it can never leave.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bn.1's device as § 6bu…§ 6ca used it: no render, so no focus stage. */
const FREE_STAGE: TileStageMm = () => 0;

function mosaicOptions(
  size: number,
  ps: number,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions {
  return {
    size,
    pupilSamples: ps,
    slabs: THIN,
    samples: [
      { nm: 430, weight: 1 },
      { nm: DESIGN, weight: 1 },
      { nm: 656.2725, weight: 1 },
    ],
    tiles: 3,
    guardCells: 4,
    stageMm: FREE_STAGE,
    radialMapSeed: "magnification",
    centreMm: { x: 4, y: 0 },
    ...over,
  };
}

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

const optionsAt = (
  c: Cell,
  j: number,
  i: number,
  cx: number,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions =>
  mosaicOptions(BIG, PS_AT(c, j), {
    guardCells: guardAt(j, i),
    centreMm: { x: cx, y: 0 },
    ...over,
  });

interface Seam {
  readonly rows: number;
  readonly cols: number;
  /** The kept half tile over the field offset, on the 430 nm RULER frame. */
  readonly w: number;
}

const live = (
  c: Cell,
  j: number,
  i: number,
  cx: number,
  over: Partial<FluorescenceMosaicOptions> = {},
): Seam => {
  const options = optionsAt(c, j, i, cx, over);
  const g = fluorescenceMosaicGeometry(LENS[c], options);
  const s = mosaicSeamShiftMm(LENS[c], options, 65);
  return {
    rows: s.betweenRowsMm,
    cols: s.betweenColumnsMm,
    w: ((g.tileSize / 2 - g.croppedPixels - g.guardPixels) * g.pixelScaleMm) / cx,
  };
};

/**
 * The closed form: three pixel scales per seam and four map evaluations.
 *
 * `assumeNoOverlap` publishes the `±U` offsets whatever the overlap is, which
 * is the form § 6ci.0 states; the general `U − overlap` is what actually holds.
 */
function closedForm(
  c: Cell,
  j: number,
  i: number,
  cx: number,
  over: Partial<FluorescenceMosaicOptions> = {},
  assumeNoOverlap = false,
): Seam {
  const system = LENS[c];
  const options = optionsAt(c, j, i, cx, over);
  const g = fluorescenceMosaicGeometry(system, options);
  const n = g.tilesPerAxis;
  const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
  const near = assumeNoOverlap ? U : U - g.overlapPixels;
  const half = (n - 1) / 2;
  const magnification = g.planes[g.rulerIndex]!.frame.magnification;
  const nm = g.rulerWavelengthNm;
  const centre = (k: number): { x: number; y: number } => {
    const col = k % n;
    const row = (k - col) / n;
    return { x: cx + (col - half) * g.pitchMm, y: (row - half) * g.pitchMm };
  };
  // One scale per tile — the only thing that distinguishes two frames.
  const S = Array.from(
    { length: n * n },
    (_, k) =>
      objectFieldTile(system, { ...options, centreMm: centre(k), wavelengthNm: nm }).pixelScaleMm,
  );
  const map = (p: { x: number; y: number }): { x: number; y: number } => {
    const r = Math.hypot(p.x, p.y);
    if (r === 0) return { x: 0, y: 0 };
    const height = objectHeightForImageRadius(system, r, nm, { magnification });
    return { x: (height * p.x) / r, y: (height * p.y) / r };
  };
  const probes = 65;
  const along = (k: number): number => Math.round(((g.size - 1) * k) / (probes - 1));
  const owner = (t: number): number => Math.min(n - 1, Math.floor(t / g.pitchPixels));
  let rows = 0;
  let cols = 0;
  for (let seam = 1; seam < n; seam++) {
    for (let p = 0; p < probes; p++) {
      const t = along(p);
      const other = owner(t);
      const inTile = g.croppedPixels + g.guardPixels + (t - other * g.pitchPixels);
      const across = inTile - g.tileSize / 2;
      {
        const a = seam - 1 + other * n;
        const b = seam + other * n;
        const ca = centre(a);
        const cb = centre(b);
        const pa = map({ x: ca.x + near * S[a]!, y: ca.y + across * S[a]! });
        const pb = map({ x: cb.x - U * S[b]!, y: cb.y + across * S[b]! });
        cols = Math.max(cols, Math.hypot(pb.x - pa.x, pb.y - pa.y));
      }
      {
        const a = other + (seam - 1) * n;
        const b = other + seam * n;
        const ca = centre(a);
        const cb = centre(b);
        const pa = map({ x: ca.x + across * S[a]!, y: ca.y + near * S[a]! });
        const pb = map({ x: cb.x + across * S[b]!, y: cb.y - U * S[b]! });
        rows = Math.max(rows, Math.hypot(pb.x - pa.x, pb.y - pa.y));
      }
    }
  }
  return { rows, cols, w: (U * g.pixelScaleMm) / cx };
}

/** § 6ci.2's two shapes, at a mosaic of `2h + 1` tiles per axis. */
const Q = (h: number): number => 4 * h * h - 2 * h + 1;
const shapeRows = (h: number, w: number): number => Math.hypot(2 * h + Q(h) * w, (2 * h - 1) * w);
const shapeCols = (h: number, w: number): number =>
  Math.hypot(2 * h - 1 + Q(h) * w, 1 + (2 * h - 1) * w);
const PHI = (h: number, w: number): number => shapeRows(h, w) / shapeCols(h, w);

/** § 6ci.4's two log slopes at three tiles, and their quotient. */
const LR = (w: number): number => (15 * w * w + 15 * w + 4) / (5 * w * w + 6 * w + 2);
const LC = (w: number): number => (15 * w * w + 10 * w + 2) / (5 * w * w + 4 * w + 1);
const AXIS = (w: number): number =>
  1 + (w * (5 * w * w + 5 * w + 1)) / (75 * w ** 4 + 135 * w ** 3 + 95 * w * w + 31 * w + 4);

/** § 6cf.0's two, cited rather than re-measured — the STAGE scan's. */
const STAGE_LR = (w: number): number => (2 + 4 * w - 3 * w * w) / (2 + 2 * w - w * w);
const STAGE_LC = (w: number): number => (3 * w * w + 8) / (w * w + 4);

/** `dln(seam)/dln(w)` on a tight guard secant — the guard moves only `w`. */
const logSlopes = (
  c: Cell,
  j: number,
  cx: number,
): { w: number; lr: number; lc: number } => {
  const a = live(c, j, 32768, cx);
  const b = live(c, j, 131072, cx);
  const d = Math.log(b.w / a.w);
  return {
    w: Math.sqrt(a.w * b.w),
    lr: Math.log(b.rows / a.rows) / d,
    lc: Math.log(b.cols / a.cols) / d,
  };
};

const interact = (sl: number, fl: number, sh: number, fh: number): number => fh / sh / (fl / sl);
const inter4 = (v: readonly number[]): number => interact(v[0]!, v[1]!, v[2]!, v[3]!);

describe("§ 6ci.0 — the field seam is three pixel scales and four map evaluations", () => {
  it("equals the live seam to a part in 1e11, on both branches", () => {
    // Nothing here forms an image or lays out a mosaic: the two tiles at a seam
    // read the SAME composed pixel at rendered offsets +U and -U, so the whole
    // mismatch is what their two frames disagree about, and a frame's only
    // field-dependent number is its pixel scale. Four cells, three anchors,
    // three guards, both branches: 72 readings.
    let worst = 0;
    for (const c of CELLS) {
      for (const j of [64, 128, 200] as const) {
        for (const i of [TINY, 65536, WIDE] as const) {
          const l = live(c, j, i, 2);
          const f = closedForm(c, j, i, 2);
          worst = Math.max(worst, Math.abs(f.rows / l.rows - 1), Math.abs(f.cols / l.cols - 1));
        }
      }
    }
    expect(worst).toBeLessThan(1e-11);
  }, 300000);

  it("and the ±U offsets are the no-overlap case, which is where they end", () => {
    // `pitchPixels = keptPixels - overlapPixels`, so the +U offset is really
    // `U - overlap` and the anchor's weight `2U - overlap`. At zero overlap the
    // two coincide and the mismatch is a clean second difference; away from it
    // the ±U form fails FAST — a guard-sized overlap costs a factor of three.
    const c: Cell = "s10";
    for (const [overlapPixels, floor] of [
      [1024, 0.03],
      [65536, 1.9],
      [1048576, 32],
    ] as const) {
      const l = live(c, 64, 65536, 2, { overlapPixels });
      const naive = closedForm(c, 64, 65536, 2, { overlapPixels }, true);
      const general = closedForm(c, 64, 65536, 2, { overlapPixels });
      expect(naive.rows / l.rows - 1).toBeGreaterThan(floor);
      expect(Math.abs(general.rows / l.rows - 1)).toBeLessThan(1e-11);
      expect(Math.abs(general.cols / l.cols - 1)).toBeLessThan(1e-11);
    }
  }, 300000);
});

describe("§ 6ci.1 — and a frame's scale is one traced number per field radius", () => {
  it("is the reference radius alone, and the exit radius does not move at all", () => {
    for (const c of CELLS) {
      const system = LENS[c];
      const base = objectFieldFrame(system, { size: 256, pupilSamples: 64, wavelengthNm: 430 });
      const R0 = base.scale.referenceRadius;
      for (const r of [0.5, 1, 2, 4, 8, 12]) {
        const f = objectFieldTile(system, {
          size: 256,
          pupilSamples: 64,
          wavelengthNm: 430,
          centreMm: { x: r, y: 0 },
        });
        // Bitwise: `pixelScaleMm ∝ referenceRadius / exitRadius` and the exit
        // radius is the same number at every field angle, so the scale IS the
        // reference sphere. That is what makes the seam a geometry problem.
        expect(f.scale.exitRadius).toBe(base.scale.exitRadius);
        expect(f.pixelScaleMm / base.pixelScaleMm).toBeCloseTo(f.scale.referenceRadius / R0, 15);
      }
      // A function of the RADIUS, not of the point: (3, 4) and (5, 0) are one
      // reading, to the last bit.
      const off = objectFieldTile(system, {
        size: 256,
        pupilSamples: 64,
        wavelengthNm: 430,
        centreMm: { x: 3, y: 4 },
      });
      const on = objectFieldTile(system, {
        size: 256,
        pupilSamples: 64,
        wavelengthNm: 430,
        centreMm: { x: 5, y: 0 },
      });
      expect(off.pixelScaleMm).toBe(on.pixelScaleMm);
    }
  }, 300000);

  it("and § 6m.3's hypot carries it, departing as the fourth power", () => {
    const system = LENS.s20;
    const base = objectFieldFrame(system, { size: 256, pupilSamples: 64, wavelengthNm: 430 });
    const R0 = base.scale.referenceRadius;
    const departure = (r: number): number => {
      const f = objectFieldTile(system, {
        size: 256,
        pupilSamples: 64,
        wavelengthNm: 430,
        centreMm: { x: r, y: 0 },
      });
      return f.pixelScaleMm / base.pixelScaleMm / (Math.hypot(R0, r) / R0) - 1;
    };
    // One-signed, and sixteen times bigger for twice the field — which is the
    // r^4 term of sqrt(1 + r^2/R^2) and nothing else. It is 1e-11 where the
    // seam lives and 1e-5 at the edge of the field.
    const d = [0.5, 1, 2, 4, 8].map(departure);
    expect(departure(0.5)).toBeCloseTo(-2.367e-11, 13);
    expect(departure(12)).toBeCloseTo(-7.573e-6, 9);
    for (let k = 1; k < d.length; k++) expect(d[k]! / d[k - 1]!).toBeCloseTo(16, 0);
  }, 300000);
});

describe("§ 6ci.2 — so both field seams are second order in the kept tile", () => {
  it("puts both guard log slopes at 2 where the stage's are 1 and 2", () => {
    // The `U` in front of both mismatches and the `xi` inside them are the same
    // length, so each seam is `w^2` times a shape that tends to a CONSTANT.
    // Read live at the smallest tile this field reaches, both slopes are 2.
    const s = logSlopes("s20", 4, 16);
    expect(s.w).toBeLessThan(0.006);
    expect(s.lr).toBeGreaterThan(2);
    expect(s.lr).toBeLessThan(2.008);
    expect(s.lc).toBeGreaterThan(2);
    expect(s.lc).toBeLessThan(2.011);
    // And they are the two rational functions, to a part in a thousand — the
    // gap being § 6ci.3's own (cx/R)^2, which is at its largest out here at
    // sixteen millimetres off axis and is 3.4e-4 of it at two.
    expect(Math.abs(s.lr / LR(s.w) - 1)).toBeLessThan(1e-3);
    expect(Math.abs(s.lc / LC(s.w) - 1)).toBeLessThan(1e-3);
    const near = logSlopes("s10", 16, 2);
    expect(Math.abs(near.lr / LR(near.w) - 1)).toBeLessThan(5e-4);
    expect(Math.abs(near.lc / LC(near.w) - 1)).toBeLessThan(5e-4);
    // The forms themselves at zero tile, and § 6cf.0's for the stage beside
    // them — cited, not re-measured. One power of the tile is the whole
    // difference between the two geometries.
    expect(LR(0)).toBe(2);
    expect(LC(0)).toBe(2);
    expect(STAGE_LR(0)).toBe(1);
    expect(STAGE_LC(0)).toBe(2);
  }, 300000);
});

describe("§ 6ci.3 — the seam's anisotropy is a curve of w and the mosaic's size", () => {
  it("is sqrt2 at three tiles, and falls to 1 as the mosaic grows", () => {
    // NOT axis-blind. § 6ca's "a ruler mismatch does not care which way the two
    // tiles are adjacent" would put this at 1; at three tiles it is sqrt2,
    // because the row seam's pair sits one whole pitch further out in the field
    // than the column seam's does.
    expect(PHI(1, 0)).toBeCloseTo(Math.SQRT2, 15);
    expect(PHI(2, 0)).toBeCloseTo(4 / Math.sqrt(10), 15);
    expect(PHI(3, 0)).toBeCloseTo(6 / Math.sqrt(26), 15);
    for (const tiles of [3, 5, 7] as const) {
      const h = (tiles - 1) / 2;
      for (const c of CELLS) {
        for (const j of [8, 16] as const) {
          const l = live(c, j, 65536, 2, { tiles });
          // The closed form is exact at every tile count; the map divides out of
          // the QUOTIENT, so the pure-geometry curve is inside 2e-3 of it.
          const f = closedForm(c, j, 65536, 2, { tiles });
          expect(Math.abs(f.rows / l.rows - 1)).toBeLessThan(1e-10);
          expect(Math.abs(l.rows / l.cols / PHI(h, l.w) - 1)).toBeLessThan(2e-3);
        }
      }
    }
  }, 600000);

  it("and the curve's departure is the scale's own r^4, quadrupling with cx", () => {
    // The pure-geometry curve truncates sqrt(1 + r^2/R^2) at r^2, so its error
    // is (cx/R)^2 — four times bigger for twice the field offset, and it says
    // nothing about w: at w = 9.5 the form is still inside 3e-3.
    const at = (cx: number, j: number): number => {
      const l = live("s20", j, 65536, cx);
      return Math.abs(l.rows / l.cols / PHI(1, l.w) - 1);
    };
    // Matched w ~ 0.0213 at cx = 4 and cx = 8, and ~ 0.085 at cx = 2.
    const four = at(4, 4);
    const eight = at(8, 8);
    expect(eight / four).toBeCloseTo(4, 0);
    expect(at(2, 8)).toBeLessThan(1e-3);
    expect(at(0.5, 16)).toBeLessThan(1e-4);
  }, 600000);
});

describe("§ 6ci.4 — so the field's axis constant is 1 at zero tile, and bounded", () => {
  it("matches the rational form and is exactly 1 where the tile vanishes", () => {
    expect(AXIS(0)).toBe(1);
    // Against § 6cf.2's stage constant, which is exactly 2 there. One power of
    // the tile, again, and it is the whole of § 6ca.1's split.
    expect(STAGE_LC(0) / STAGE_LR(0)).toBe(2);
    for (const c of CELLS) {
      for (const [j, cx] of [
        [4, 16],
        [16, 2],
        [32, 2],
        [64, 2],
      ] as const) {
        const s = logSlopes(c, j, cx);
        expect(s.lc / s.lr).toBeCloseTo(AXIS(s.w), 3);
      }
    }
  }, 600000);

  it("has its maximum at one sextic root, and every cell lands on it", () => {
    // `A` rises from 1, turns, and falls back to 1 — the turn is where the two
    // log slopes' own log slopes agree, which clears to
    //   375w^6 + 750w^5 + 425w^4 - 40w^3 - 120w^2 - 40w - 4 = 0
    // with one positive real root.
    const wStar = 0.50914397778077971;
    const sextic = (w: number): number =>
      375 * w ** 6 + 750 * w ** 5 + 425 * w ** 4 - 40 * w ** 3 - 120 * w * w - 40 * w - 4;
    expect(Math.abs(sextic(wStar))).toBeLessThan(1e-13);
    expect(AXIS(wStar)).toBeCloseTo(1.0366475532586704, 12);
    for (const w of [0.3, 0.45, 0.6, 0.9]) expect(AXIS(w)).toBeLessThan(AXIS(wStar));
    // Live, on a walk that straddles the root: every cell's own maximum sits on
    // the anchor nearest it, and reads the closed form's value.
    for (const c of CELLS) {
      let best = { a: 0, w: 0 };
      for (let j = 40; j <= 56; j += 4) {
        const s = logSlopes(c, j, 2);
        if (s.lc / s.lr > best.a) best = { a: s.lc / s.lr, w: s.w };
      }
      // Half an anchor step is 0.0213 in w at this offset; every cell is
      // inside 0.006 of the root, and reads the form's own value to 1e-4.
      expect(Math.abs(best.w - wStar)).toBeLessThan(0.0213);
      expect(Math.abs(best.a - 1.0366476)).toBeLessThan(1e-4);
    }
  }, 900000);

  it("and three tiles is the worst mosaic there is: the ceiling falls with size", () => {
    // The bound is not the three-tile mosaic's accident. `A_h` peaks lower the
    // more tiles there are — 3.665% at three, 2.44% at five, 1.68% at seven —
    // so no field-scan mosaic's guard sensitivity is more than 3.665%
    // axis-dependent, and § 6ca.1's "axis-blind" is true with a number on it.
    const axisAt = (h: number, w: number): number => {
      const q = Q(h);
      const a = 2 * h;
      const b = 2 * h - 1;
      const lr = 2 + (w * (q * (a + q * w) + b * b * w)) / ((a + q * w) ** 2 + b * b * w * w);
      const lc =
        2 + (w * (q * (b + q * w) + b * (1 + b * w))) / ((b + q * w) ** 2 + (1 + b * w) ** 2);
      return lc / lr;
    };
    const peak = (h: number): number => {
      let best = 1;
      for (let w = 1e-4; w < 5; w *= 1.0005) best = Math.max(best, axisAt(h, w));
      return best;
    };
    expect(peak(1)).toBeCloseTo(1.0366476, 6);
    expect(peak(2)).toBeCloseTo(1.0244445, 6);
    expect(peak(3)).toBeCloseTo(1.0167666, 6);
    expect(peak(1)).toBeGreaterThan(peak(2));
    expect(peak(2)).toBeGreaterThan(peak(3));
    expect(peak(3)).toBeGreaterThan(peak(8));
  }, 300000);
});

describe("§ 6ci.5 — which is what § 6ca.1's 2.6% is, and what it is not", () => {
  it("reproduces § 6ca.1's own two slopes and their ratio", () => {
    const j = 128;
    const cx = 2;
    const dshare = shareOfI(WIDE) - shareOfI(TINY);
    const branch = (b: "rows" | "cols") => {
      const at = (i: number): number => inter4(CELLS.map((c) => live(c, j, i, cx)[b]));
      const form = (i: number): number =>
        inter4(
          CELLS.map((c) => {
            const w = closedForm(c, j, i, cx).w;
            return w * w * (b === "rows" ? shapeRows(1, w) : shapeCols(1, w));
          }),
        );
      return {
        live: Math.log(at(WIDE) / at(TINY)) / dshare,
        form: Math.log(form(WIDE) / form(TINY)) / dshare,
      };
    };
    const rows = branch("rows");
    const cols = branch("cols");
    // § 6ca.1 published 0.7145 and 0.7332.
    expect(rows.live).toBeCloseTo(0.714483, 5);
    expect(cols.live).toBeCloseTo(0.733180, 5);
    // The closed form composed the same way OVERSHOOTS both by half a percent —
    // the (cx/R)^2 truncation of § 6ci.3 plus the map — and gets the RATIO,
    // which is the load-bearing number, to three parts in a thousand.
    expect(rows.form / rows.live - 1).toBeCloseTo(0.0060, 3);
    expect(cols.form / cols.live - 1).toBeCloseTo(0.0088, 3);
    expect(cols.live / rows.live).toBeCloseTo(1.026168, 5);
    expect(cols.form / rows.form).toBeCloseTo(1.029043, 5);
    // And pointwise, at each cell's own w, the rational form reads the same.
    for (const c of CELLS) {
      const w = closedForm(c, j, 65536, cx).w;
      expect(AXIS(w)).toBeCloseTo(1.0284, 3);
    }
  }, 900000);

  it("but the SEAM at that same anchor is eleven percent anisotropic", () => {
    // The two numbers § 6ca.1's sentence runs together. "Axis-blind" is a
    // statement about the guard DERIVATIVE, where the two axes agree to 2.6%;
    // the seam itself does not agree at all, and at zero tile it is sqrt2 out.
    for (const c of CELLS) {
      const l = live(c, 128, 65536, 2);
      expect(l.rows / l.cols).toBeGreaterThan(1.11);
      expect(l.rows / l.cols).toBeCloseTo(PHI(1, l.w), 2);
    }
    const tiny = live("s20", 4, 65536, 16);
    expect(tiny.w).toBeLessThan(0.006);
    expect(tiny.rows / tiny.cols).toBeGreaterThan(1.4);
  }, 600000);
});
