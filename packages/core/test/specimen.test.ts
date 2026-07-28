import { describe, it, expect } from "vitest";
import {
  imageRadiusForObjectHeight,
  imagePointAt,
  objectFieldFrame,
  objectFieldTile,
  type ObjectFieldFrame,
} from "../src/imaging/object-field";
import { rasterizeSpecimen, specimenPointAt, type Specimen } from "../src/imaging/specimen";
import { rasterizeEmitters } from "../src/imaging/fluorescence";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6n — the warped-grid rasterizer.
 *
 * § 6h carried distortion in the pupil *assignment* and left the grid itself
 * unwarped, naming `objectPointAt` as the seam a rasterizer would attach to.
 * This is that rasterizer, and § 6m is what forced it: a tile sits at
 * millimetres of field, two tiles abut, and a straight specimen crossing the
 * seam arrives on each side through a different linear approximation to a map
 * that is not linear.
 *
 * The external number is third-order theory's, and it arrives here as the
 * **second derivative** of the cubic § 6h.1 already pinned. That is the ladder
 * this step completes: § 6h.1 pinned the cubic itself, § 6m.4 pinned its slope
 * (radial and tangential in the ratio 3), and the bow of a straight line is its
 * curvature — d²/dr² of a cubic is linear, so the sagitta grows as ×2.00 per
 * doubling of field and NOT as the ×8.00 the cubic itself does. Nothing is
 * fitted: both factors are read off the same coefficient § 6h.1 measured.
 *
 * Cost: one bisected chief ray per pixel, 0.12 ms of it, which is why every
 * rung here runs on a 32² grid and why § 6p exists.
 */

const LAMBDA = 587.5618;
const SIZE = 32;
const PUPIL_SAMPLES = 32;

/**
 * § 6b's DIN 4×/0.10 — the finite-conjugate member of the ladder.
 *
 * Solved once and shared, unlike the sibling files that rebuild it per rung.
 * Every consumer here is a pure readout and a `Prescription` is immutable, and
 * a rasterizer rung costs 1024 bisected chief rays where those files cost one:
 * this module is the most expensive in the suite and does not need to be.
 */
const din4x = (): OpticalSystem => SYSTEM;
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const frameOf = (system: OpticalSystem, size = SIZE, pupilSamples = PUPIL_SAMPLES) =>
  objectFieldFrame(system, { size, pupilSamples, wavelengthNm: LAMBDA });

/** Tiles are traced to build, and the rungs below share theirs. */
const TILES = new Map<string, ObjectFieldFrame>();
const tileAt = (
  system: OpticalSystem,
  x: number,
  y: number,
  size = SIZE,
  pupilSamples = PUPIL_SAMPLES,
): ObjectFieldFrame => {
  const key = `${x},${y},${size},${pupilSamples}`;
  let tile = TILES.get(key);
  if (tile === undefined) {
    tile = objectFieldTile(system, {
      size,
      pupilSamples,
      wavelengthNm: LAMBDA,
      centreMm: { x, y },
    });
    TILES.set(key, tile);
  }
  return tile;
};

/** A straight line on the specimen: a Gaussian ridge at object x = x0. */
const ridgeAt = (x0: number, sigmaMm: number): Specimen =>
  (x) => ({ re: Math.exp(-((x - x0) ** 2) / (2 * sigmaMm * sigmaMm)), im: 0 });

/** The ridge's sub-pixel column in one row, by intensity-weighted centroid. */
function ridgeColumn(field: { size: number; re: Float64Array }, iy: number): number {
  let w = 0;
  let wx = 0;
  for (let ix = 0; ix < field.size; ix++) {
    const v = field.re[iy * field.size + ix]!;
    w += v;
    wx += v * ix;
  }
  return wx / w;
}

/**
 * The bow, in pixels: the centre row's column minus the mean of the end rows'.
 *
 * A straight line's sagitta. Positive means the middle of the imaged line sits
 * further from the axis than its ends — the ends pulled inward, which is what
 * barrel distortion does to a chord.
 */
function sagittaPx(field: { size: number; re: Float64Array }): number {
  const n = field.size;
  return ridgeColumn(field, n / 2) - (ridgeColumn(field, 0) + ridgeColumn(field, n - 1)) / 2;
}

/** Where the whole grid's weight sits, in fractional pixels. */
function centroidPx(field: { size: number; re: Float64Array }): { x: number; y: number } {
  let w = 0;
  let wx = 0;
  let wy = 0;
  for (let iy = 0; iy < field.size; iy++) {
    for (let ix = 0; ix < field.size; ix++) {
      const v = field.re[iy * field.size + ix]!;
      w += v;
      wx += v * ix;
      wy += v * iy;
    }
  }
  return { x: wx / w, y: wy / w };
}

/** The one non-zero pixel of a single-emitter raster, and its weight. */
function soleEmitterPixel(
  values: Float64Array,
  size: number,
): { ix: number; iy: number; weight: number } {
  let best = -1;
  let weight = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > weight) {
      weight = values[i]!;
      best = i;
    }
  }
  return { ix: best % size, iy: Math.floor(best / size), weight };
}

describe("§ 6n.1 — the pixel convention, against the rasterizer that already had one", () => {
  it("puts a specimen point and a point emitter in the SAME pixel, on axis and in a tile", () => {
    // The bug this whole step exists to remove is a seam misregistration, and
    // half a pixel is one. `rasterizeEmitters` fixed the convention in § 6i —
    // index i sits at offset i − size/2 from the frame's centre, so the centre
    // falls ON pixel size/2 and not between pixels — so the new rasterizer is
    // pinned against it rather than each being trusted separately.
    const system = din4x();
    for (const frame of [frameOf(system), tileAt(system, 0.8, 0.4)]) {
      for (const [ix, iy] of [
        [16, 16],
        [20, 13],
        [7, 25],
      ] as const) {
        const p = specimenPointAt(system, frame, ix, iy);
        const raster = rasterizeEmitters(system, frame, [{ xMm: p.x, yMm: p.y, flux: 1 }]);
        const landed = soleEmitterPixel(raster.values, frame.size);
        expect(landed.ix).toBe(ix);
        expect(landed.iy).toBe(iy);
        // Bilinear splatting puts the whole flux in one pixel only when the
        // point lands exactly on it. A half-pixel convention error would split
        // the flux across two and this weight would read ~0.5.
        expect(landed.weight).toBeCloseTo(1, 12);
      }
    }
  });

  it("round-trips a pixel index through the forward map, to f64", () => {
    // The inverse's own residual is already self-checked (§ 6h.1), so a round
    // trip through the two map functions pins nothing about this module. This
    // one goes through the PIXEL INDEXING — the centre offset and the
    // normalized-position convention — which is the part that is new here.
    const system = din4x();
    for (const frame of [frameOf(system), tileAt(system, 3.2, 0)]) {
      for (const [ix, iy] of [
        [16, 16],
        [20.25, 13.5],
        [3, 29],
      ] as const) {
        const p = specimenPointAt(system, frame, ix, iy);
        const back = imageRadiusForObjectHeight(system, Math.hypot(p.x, p.y), LAMBDA);
        const image = imagePointAt(frame, ix / frame.size, iy / frame.size);
        expect(Math.abs(back - Math.hypot(image.x, image.y))).toBeLessThan(1e-12);
      }
    }
  });

  it("is `imagePointAt / |M|` exactly when the map is uniform and the frame is axial", () => {
    // Naming the negative control. On the axial frame the uniform map IS the
    // paraxial one, which is why § 6h could not see the difference this step
    // removes; in a tile it is the paraxial map restricted to the tile, with the
    // tile's own traced centre as its fixed point.
    const system = din4x();
    const frame = frameOf(system);
    const m = Math.abs(frame.magnification);
    for (const [ix, iy] of [
      [0, 0],
      [16, 16],
      [31, 7],
    ] as const) {
      const u = specimenPointAt(system, frame, ix, iy, { map: "uniform" });
      const image = imagePointAt(frame, ix / frame.size, iy / frame.size);
      expect(u.x).toBeCloseTo(image.x / m, 15);
      expect(u.y).toBeCloseTo(image.y / m, 15);
    }
  });

  it("is exact at the frame centre on BOTH maps, and differs everywhere else", () => {
    // The uniform map is not a strawman: it is right where the frame is aimed.
    // What it cannot do is stay right, and that is the whole content of § 6n.
    const system = din4x();
    const tile = tileAt(system, 1.6, 0);
    const centreT = specimenPointAt(system, tile, SIZE / 2, SIZE / 2);
    const centreU = specimenPointAt(system, tile, SIZE / 2, SIZE / 2, { map: "uniform" });
    expect(centreT.x).toBeCloseTo(tile.centreObjectMm.x, 15);
    expect(centreU.x).toBeCloseTo(tile.centreObjectMm.x, 15);

    const cornerT = specimenPointAt(system, tile, 0, 0);
    const cornerU = specimenPointAt(system, tile, 0, 0, { map: "uniform" });
    const departPx =
      Math.hypot(cornerT.x - cornerU.x, cornerT.y - cornerU.y) / tile.objectPixelScaleMm;
    expect(departPx).toBeGreaterThan(1e-5);
  });
});

describe("§ 6n.2 — the bow: a straight object line, and the order it bows at", () => {
  /** The sagitta of one straight ridge, rasterized in a tile at (xc, 0). */
  const bowAt = (
    system: OpticalSystem,
    xc: number,
    map: "traced" | "uniform",
    pupilSamples = PUPIL_SAMPLES,
  ): number => {
    const tile = tileAt(system, xc, 0, SIZE, pupilSamples);
    const ridge = ridgeAt(tile.centreObjectMm.x, 4 * tile.objectPixelScaleMm);
    return sagittaPx(rasterizeSpecimen(system, tile, ridge, { map }));
  };

  it("bows LINEARLY in field — the second derivative of § 6h.1's cubic", () => {
    // Third-order distortion is r = |M|·h + D·h³, so the departure is cubic
    // (§ 6h.1, ×8.00 per doubling) and its slope is quadratic (§ 6m.4). The
    // sagitta of a chord is the map's CURVATURE across that chord, and d²/dr² of
    // a cubic is linear — so this is ×2.00 per doubling and a rung asserting
    // ×8.00 here would be quoting the right theory at the wrong derivative.
    const system = din4x();
    const radii = [0.4, 0.8, 1.6, 3.2, 6.4];
    const bows = radii.map((xc) => bowAt(system, xc, "traced"));
    for (let i = 1; i < bows.length; i++) {
      expect(Math.abs(bows[i]! / bows[i - 1]! / 2 - 1)).toBeLessThan(3e-3);
    }
    // Real, not f64 noise: a 32² centroid resolves ~1e-12 px and the smallest
    // bow here is 1.8e-6 px — six orders above it.
    expect(Math.abs(bows[0]!)).toBeGreaterThan(1e-7);
  });

  it("bows as the SQUARE of the tile's extent — the same coefficient, read the other way", () => {
    // A sagitta over a chord of half-length L is (curvature)·L²/2, so doubling
    // the tile's extent at fixed field must quadruple it in millimetres. It
    // doubles in PIXELS, because § 6h.2 ties the extent to `pupilSamples` and
    // the pixel scale rides along with it: L² / pixelScale ∝ L. The two ×2.00
    // rungs are one statement seen on its two axes.
    const system = din4x();
    const samples = [16, 32, 64, 128];
    const bows = samples.map((ps) => bowAt(system, 1.6, "traced", ps));
    for (let i = 1; i < bows.length; i++) {
      expect(Math.abs(bows[i]! / bows[i - 1]! / 2 - 1)).toBeLessThan(3e-3);
    }
  });

  it("bows the way BARREL distortion bows a chord — the sign, not just the size", () => {
    // § 6m recorded that using the signed magnification instead of |M| gives a
    // mosaic mirrored about the axis with every rung still green, so a bow rung
    // that read only |sagitta| would pass under exactly that class of bug.
    //
    // This objective's traced departure r − |M|·h is NEGATIVE (−6.5e-6 mm at
    // h = 0.4, the magnitude § 6h.1 quotes): local magnification falls with
    // field, which is barrel. Barrel pulls the ENDS of a chord inward, so the
    // middle is left further from the axis and the sagitta is positive.
    const system = din4x();
    const m = Math.abs(frameOf(system).magnification);
    for (const h of [0.4, 0.8, 1.6]) {
      expect(imageRadiusForObjectHeight(system, h, LAMBDA) - m * h).toBeLessThan(0);
    }
    for (const xc of [0.8, 3.2]) expect(bowAt(system, xc, "traced")).toBeGreaterThan(0);
  });

  it("negative control: the uniform map cannot bow at all, at any field", () => {
    // Not "fails by a tolerance" — a linear map has no second derivative, so the
    // sagitta is identically zero however far off axis the tile is placed. The
    // control does not approximate the law badly; it cannot express it.
    const system = din4x();
    for (const xc of [0.4, 0.8, 1.6, 3.2, 6.4]) {
      expect(bowAt(system, xc, "uniform")).toBe(0);
    }
  });

  it("is the map's own second difference, equal and opposite", () => {
    // The rasterized picture and the bare map are two readings of one number, so
    // they are pinned against each other. Opposite in sign because they are
    // inverses: where the map moves the object point outward at a fixed column,
    // a fixed object point must move to a lower column.
    const system = din4x();
    const tile = tileAt(system, 1.6, 0);
    const col = SIZE / 2;
    const x = (iy: number) => specimenPointAt(system, tile, col, iy).x;
    const secondDiff = (x(col) - (x(0) + x(SIZE - 1)) / 2) / tile.objectPixelScaleMm;
    const bow = sagittaPx(
      rasterizeSpecimen(
        system,
        tile,
        ridgeAt(tile.centreObjectMm.x, 4 * tile.objectPixelScaleMm),
        {},
      ),
    );
    expect(secondDiff).toBeLessThan(0);
    // 0.2% apart: the ridge has a finite width, so its centroid samples the map
    // over a few pixels where the second difference samples it at a point.
    expect(Math.abs(bow / -secondDiff - 1)).toBeLessThan(3e-3);
  });
});

describe("§ 6n.3 — a specimen lands where the map says it does", () => {
  const FIELDS = [0.4, 0.8, 1.6, 3.2, 6.4];
  const ratios = (v: readonly number[]): number[] => v.slice(1).map((x, i) => x / v[i]!);
  /**
   * Both sequences below approach their limit **from below and monotonically**,
   * because the tile's own half-extent (46.77 µm) is not negligible against the
   * smallest field here (0.4 mm): the chord samples the map over a finite span,
   * so the leading term is diluted by a correction of order L/r. That is pinned
   * as convergence rather than smothered in a loose tolerance — a wandering
   * ratio would satisfy "each is within 5% of the limit" too.
   */
  const convergesTo = (v: readonly number[], limit: number, finalTol: number): void => {
    const r = ratios(v);
    for (const x of r) expect(x).toBeLessThan(limit);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
    expect(Math.abs(r[r.length - 1]! / limit - 1)).toBeLessThan(finalTol);
  };
  /**
   * Round trip through a whole picture: place a smooth bump at the object point
   * pixel (p, q) looks at, rasterize, read the centroid back, return the miss.
   *
   * σ = 1.5 px and an interior pixel, both load-bearing. The centroid runs over
   * the whole grid, so a bump close enough to an edge is clipped asymmetrically
   * and the miss is the truncated tail rather than the map — at σ = 2 and 4σ of
   * clearance that artefact is 1.1e-4 px and swamps everything below.
   */
  const MISSES = new Map<string, number>();
  const missPx = (system: OpticalSystem, xc: number, map: "traced" | "uniform"): number => {
    const key = `${xc},${map}`;
    const hit = MISSES.get(key);
    if (hit !== undefined) return hit;
    const value = computeMiss(system, xc, map);
    MISSES.set(key, value);
    return value;
  };
  const computeMiss = (system: OpticalSystem, xc: number, map: "traced" | "uniform"): number => {
    const tile = tileAt(system, xc, 0);
    const [ix, iy] = [20, 12];
    const target = specimenPointAt(system, tile, ix, iy);
    const sigma = 1.5 * tile.objectPixelScaleMm;
    const bump: Specimen = (x, y) => ({
      re: Math.exp(-(((x - target.x) ** 2 + (y - target.y) ** 2) / (2 * sigma * sigma))),
      im: 0,
    });
    const c = centroidPx(rasterizeSpecimen(system, tile, bump, { map }));
    return Math.hypot(c.x - ix, c.y - iy);
  };

  it("recovers the bump's own pixel, and misses by the map's CURVATURE", () => {
    // Not exact, and the residual is physics rather than slop: the grid samples
    // object space non-uniformly, so a bump symmetric on the specimen is very
    // slightly asymmetric on the grid. What pins it as physics is that it obeys
    // § 6n.2's law — ×2.00 per doubling of field, the second derivative of the
    // cubic — rather than sitting under a tolerance somebody chose.
    const system = din4x();
    const misses = FIELDS.map((xc) => missPx(system, xc, "traced"));
    for (const m of misses) expect(m).toBeLessThan(1e-5);
    convergesTo(misses, 2, 1e-2);
  });

  it("control: the uniform map misses by the map's SLOPE, which is a whole order worse", () => {
    // The rung above would pass for any self-consistent pair of maps, so the
    // control has to be quantitative. It is, and the two are separated by an
    // order of the field rather than by a factor: a linear map gets the tile
    // centre right and accumulates the map's first derivative away from it,
    // which is § 6m.4's quadratic (×4.00 per doubling), while the traced map
    // has already taken that out and is left with the curvature (×2.00).
    //
    // So the gap between them is itself a quantity with an order — quadratic
    // over linear is linear, so it DOUBLES per doubling of field, 16.8× at
    // 0.4 mm to 257× at 6.4 mm. That gap is the seam misregistration § 6n
    // exists to remove, and it is unbounded in the field rather than a constant
    // factor somebody could have absorbed into a tolerance.
    const system = din4x();
    const misses = FIELDS.map((xc) => missPx(system, xc, "uniform"));
    convergesTo(misses, 4, 1.5e-2);

    const traced = FIELDS.map((xc) => missPx(system, xc, "traced"));
    const gap = misses.map((m, i) => m / traced[i]!);
    expect(gap[0]!).toBeGreaterThan(15);
    expect(gap[gap.length - 1]!).toBeGreaterThan(250);
    convergesTo(gap, 2, 1e-2);
  });

  it("control: and it is exact at the tile centre, where a linear map cannot be wrong", () => {
    // Why the rung above samples pixel (20, 12) and not the middle one. The
    // uniform map's fixed point is the tile's own traced centre, so at the
    // centre pixel it reads 1e-14 and a control placed there would report that
    // the two maps agree.
    const system = din4x();
    const tile = tileAt(system, 6.4, 0);
    const target = specimenPointAt(system, tile, SIZE / 2, SIZE / 2);
    const sigma = 1.5 * tile.objectPixelScaleMm;
    const bump: Specimen = (x, y) => ({
      re: Math.exp(-(((x - target.x) ** 2 + (y - target.y) ** 2) / (2 * sigma * sigma))),
      im: 0,
    });
    const c = centroidPx(rasterizeSpecimen(system, tile, bump, { map: "uniform" }));
    expect(Math.hypot(c.x - SIZE / 2, c.y - SIZE / 2)).toBeLessThan(1e-12);
  });
});

describe("§ 6n.4 — amplitude is a point property, and a density is not", () => {
  it("carries a complex transmittance through unchanged — no Jacobian anywhere", () => {
    // An `ObjectField` is an amplitude TRANSMITTANCE: what fraction of the
    // incident field a point of the specimen passes. That is a property of the
    // point, so the warp is pure coordinate substitution — a pure phase object
    // must stay |t| = 1 in every pixel, however hard the map stretched that
    // pixel's neighbourhood.
    const system = din4x();
    const tile = tileAt(system, 3.2, 0);
    const phase: Specimen = (x, y) => {
      const a = 1e3 * (x + y);
      return { re: Math.cos(a), im: Math.sin(a) };
    };
    const field = rasterizeSpecimen(system, tile, phase, {});
    for (let i = 0; i < field.re.length; i++) {
      expect(Math.hypot(field.re[i]!, field.im[i]!)).toBeCloseTo(1, 14);
    }
  });

  it("does NOT conserve total |t|², and that is the correct behaviour", () => {
    // Named because this engine reaches for an energy check first and § 6g.2 and
    // § 6k.4 both record that it is not a witness. Here it is not a witness for
    // the opposite reason: the sums SHOULD differ, because a region the map
    // magnifies really does present more specimen to more of the image. det J
    // departing from 1 is § 6m.4's ratio-3 anisotropy.
    //
    // The consequence is the deferral: an extended FLUORESCENT specimen is an
    // emitter density and would need that Jacobian. § 6i's beads sidestep it by
    // placing each point through its own chief ray, which is why they were the
    // branch's first specimen and why an extended emitter field is not built.
    const system = din4x();
    const total = (f: { re: Float64Array; im: Float64Array }) => {
      let s = 0;
      for (let i = 0; i < f.re.length; i++) s += f.re[i]! ** 2 + f.im[i]! ** 2;
      return s;
    };
    // A wedge ON the tile — a step a few pixels wide about its own centre. A
    // specimen authored about the axis instead saturates 1.6 mm off it and the
    // two totals then agree to the last bit, which would have read as
    // conservation and is nothing of the kind.
    const departure = (xc: number): number => {
      const tile = tileAt(system, xc, 0);
      const x0 = tile.centreObjectMm.x;
      const k = 1 / (2 * tile.objectPixelScaleMm);
      const wedge: Specimen = (x) => ({ re: 0.5 + 0.4 * Math.tanh(k * (x - x0)), im: 0 });
      return (
        total(rasterizeSpecimen(system, tile, wedge, {})) /
          total(rasterizeSpecimen(system, tile, wedge, { map: "uniform" })) -
        1
      );
    };
    const departures = [0.8, 1.6, 3.2, 6.4].map(departure);
    for (const d of departures) expect(d).toBeGreaterThan(0);
    // And it grows as the field's SQUARE — the same slope § 6n.3's control
    // measures, because det J − 1 is that slope. So it is a real quantity, and
    // it is also 1e-5: far too small to have caught a broken map, which is the
    // point. The witness here is § 6n.3's pixel, never this sum.
    for (let i = 1; i < departures.length; i++) {
      expect(Math.abs(departures[i]! / departures[i - 1]! / 4 - 1)).toBeLessThan(0.2);
    }
    expect(departures[departures.length - 1]!).toBeLessThan(1e-4);
  });

  it("produces the ObjectField `abbeImage` already consumes, unchanged", () => {
    // § 6n is the AUTHORING path. Nothing downstream learns the grid was warped,
    // which is what keeps § 6f–§ 6g's rungs valid over a warped specimen.
    const system = din4x();
    const frame: ObjectFieldFrame = frameOf(system);
    const field = rasterizeSpecimen(system, frame, () => ({ re: 1, im: 0 }), {});
    expect(field.size).toBe(frame.size);
    expect(field.re.length).toBe(frame.size * frame.size);
    expect(field.im.length).toBe(frame.size * frame.size);
    for (let i = 0; i < field.re.length; i++) {
      expect(field.re[i]).toBe(1);
      expect(field.im[i]).toBe(0);
    }
  });
});
