import { describe, it, expect } from "vitest";
import {
  buildRadialMap,
  radialMapCovering,
  type RadialTabulation,
} from "../src/imaging/radial-map";
import {
  imagePointAt,
  objectFieldTile,
  objectHeightForImageRadius,
  type ObjectFieldFrame,
} from "../src/imaging/object-field";
import { rasterizeSpecimen, specimenPointAt, type Specimen } from "../src/imaging/specimen";
import { mosaicLayout, renderMosaicTile } from "../src/imaging/mosaic";
import { brightfieldSpectralStack } from "../src/imaging/brightfield-spectrum";
import { diskSource } from "../src/illumination/source";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6s — the radial map, tabulated.
 *
 * `rasterizeSpecimen` bisects a traced chief ray to mantissa exhaustion once per
 * pixel — ~60 chief rays, 0.12 ms — and D4 measured that this, and not the Abbe
 * sum, is what a traced tile costs: 1 001 ms against 180 ms at grid 128. § 6r
 * then multiplied it by the wavelength count. § 6n deferred the cache and
 * attributed it to § 6p, which spent itself on the pupil instead. This is it.
 *
 * **The step is a speed step, so its rungs are identity rungs.** Nothing new is
 * claimed about the physics: the closed form is the *interpolation error*, and
 * the anchor everything else is measured against is § 6m's and § 6n's own exact
 * map, which stays the default for every rung in the ladder. What is cached is
 * only where the specimen is **sampled** — the pupil assignment (`fieldPupilAt`)
 * keeps inverting exactly, because it is patch-rate rather than pixel-rate, and
 * because the pupil is the physics.
 *
 * **The external number is Lagrange's remainder**: the interpolating cubic
 * through four nodes has |error| ≤ max|∏(r − rᵢ)|·max|f⁗|/4! = (9/16)·h⁴·f⁗/24,
 * so the error falls ×h⁴ in the node spacing. § 6s.2 measures ×5.06 per ×1.5 of
 * node count and ×3.16 per ×4/3 — the *order*, exactly — and finds the estimate
 * the map reports from its own fourth difference under-reads the truth by
 * 7–17%, which is what a difference-based f⁗ does and is recorded rather than
 * dressed up as a bound.
 */

const LAMBDA = 587.5618;

/** § 6n's and § 6o's own probe: the DIN 4×/0.10, where every cost was measured. */
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const tileAt = (x: number, y: number, size = 64, pupilSamples = 32): ObjectFieldFrame =>
  objectFieldTile(SYSTEM, {
    size,
    pupilSamples,
    wavelengthNm: LAMBDA,
    centreMm: { x, y },
  });

/** A specimen with structure on the scale the objective resolves. */
const BARS: Specimen = (x, y) => ({
  re: 0.5 + 0.4 * Math.cos(300 * x) * Math.cos(300 * y),
  im: 0,
});

/** The image radii a tile's pixels really ask for, subsampled. */
function tileRadii(frame: ObjectFieldFrame, step = 5): number[] {
  const out: number[] = [];
  for (let iy = 0; iy < frame.size; iy += step) {
    for (let ix = 0; ix < frame.size; ix += step) {
      const p = imagePointAt(frame, ix / frame.size, iy / frame.size);
      out.push(Math.hypot(p.x, p.y));
    }
  }
  return out;
}

/** Worst |table − exact| over a set of radii, in mm. */
function worstError(
  map: { heightAt: (r: number) => number },
  radii: readonly number[],
  exact: readonly number[],
): number {
  let worst = 0;
  for (let i = 0; i < radii.length; i++) {
    worst = Math.max(worst, Math.abs(map.heightAt(radii[i]!) - exact[i]!));
  }
  return worst;
}

/* ── § 6s.1 — the axis, exactly ───────────────────────────────────────────── */

describe("§ 6s.1 — the map is odd, so the axis is exact rather than special", () => {
  it("heightAt(0) is exactly zero, from the Lagrange weights and not a clamp", () => {
    const map = radialMapCovering(SYSTEM, [tileAt(2, 0)], { nodes: 64 });
    // Not `toBeCloseTo`: the node below the first interval is the mirror of the
    // node above it (the map is odd through the axis), the weight on the node at
    // the origin is exactly 1 at t = 0, and the origin's own height is not
    // traced because it is zero by symmetry. So this is bitwise, not tight.
    expect(Object.is(map.heightAt(0), 0)).toBe(true);
  });

  it("the mirrored node is the map: the first interval is at the rounding floor", () => {
    const frame = tileAt(2, 0);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 64 });
    // Radii strictly inside the first interval — the only ones whose stencil
    // reaches the invented node. If the mirror were a boundary condition rather
    // than the map, this is where it would show.
    let worst = 0;
    for (let k = 1; k < 20; k++) {
      const r = (k / 20) * map.spacingMm;
      const exact = objectHeightForImageRadius(SYSTEM, r, LAMBDA, {});
      worst = Math.max(worst, Math.abs(map.heightAt(r) - exact));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it("an axial tile's centre pixel lands on the axis, bitwise", () => {
    const frame = tileAt(0, 0);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 64 });
    const centre = specimenPointAt(SYSTEM, frame, frame.size / 2, frame.size / 2, {
      radialMap: map,
    });
    expect(Object.is(centre.x, 0)).toBe(true);
    expect(Object.is(centre.y, 0)).toBe(true);
    // And the whole grid registers, not just its centre — an axial tile is the
    // one whose radii reach zero, which is the case the mirror exists for.
    let worstPx = 0;
    for (let iy = 0; iy < frame.size; iy += 2) {
      for (let ix = 0; ix < frame.size; ix += 2) {
        const a = specimenPointAt(SYSTEM, frame, ix, iy, {});
        const b = specimenPointAt(SYSTEM, frame, ix, iy, { radialMap: map });
        worstPx = Math.max(worstPx, Math.hypot(a.x - b.x, a.y - b.y) / frame.objectPixelScaleMm);
      }
    }
    expect(worstPx).toBeLessThan(1e-12);
  });
});

/* ── § 6s.2 — the order, against Lagrange's remainder ─────────────────────── */

describe("§ 6s.2 — the interpolation error falls as the fourth power of the spacing", () => {
  const frame = tileAt(2, 0);
  const span = radialMapCovering(SYSTEM, [frame], { nodes: 8 }).maxRadiusMm;
  const radii = tileRadii(frame);
  const exact = radii.map((r) => objectHeightForImageRadius(SYSTEM, r, LAMBDA, {}));

  const errorAt = (nodes: number, tabulate: RadialTabulation = "height"): number =>
    worstError(
      buildRadialMap(SYSTEM, { maxRadiusMm: span, nodes, wavelengthNm: LAMBDA, tabulate }),
      radii,
      exact,
    );

  it("×1.5 of node count costs ×1.5⁴ of error, and ×4/3 costs ×(4/3)⁴", () => {
    // The closed form is an order, so the ladder is walked in two different
    // ratios rather than in doublings only: a scheme that happened to be third
    // order would give 3.38 and 2.37 here, which is a different number and not a
    // looser one.
    const e4 = errorAt(4);
    const e6 = errorAt(6);
    const e8 = errorAt(8);
    const e12 = errorAt(12);
    const e16 = errorAt(16);

    expect(e6 / e8).toBeCloseTo((4 / 3) ** 4, 0);
    expect(e4 / e6).toBeCloseTo(1.5 ** 4, 0);
    // 4.83 and 4.87 against 5.0625; 3.07 and 3.04 against 3.1605.
    for (const [ratio, predicted] of [
      [e4 / e6, 1.5 ** 4],
      [e12 / e16, (4 / 3) ** 4],
      [e6 / e8, (4 / 3) ** 4],
      [e8 / e12, 1.5 ** 4],
    ] as const) {
      expect(ratio / predicted).toBeGreaterThan(0.93);
      expect(ratio / predicted).toBeLessThan(1.07);
    }
  });

  it("the estimate the map reports UNDER-reads the truth, by 7–17%", () => {
    // A fourth difference is f⁗ somewhere inside its stencil; the remainder
    // formula wants the maximum over the interval. So the map's own number is an
    // estimate and the direction of its error is not a coin toss — it is low,
    // consistently, and that is worth pinning because a caller sizing a table
    // from it is entitled to know which way it leans.
    for (const nodes of [4, 6, 8, 12, 16]) {
      const map = buildRadialMap(SYSTEM, { maxRadiusMm: span, nodes, wavelengthNm: LAMBDA });
      const ratio = worstError(map, radii, exact) / map.errorEstimateMm;
      expect(ratio).toBeGreaterThan(1.0);
      expect(ratio).toBeLessThan(1.2);
    }
  });

  it("and it stops falling at the rounding floor, ~4 ulp of the object height", () => {
    // Past 32 nodes the truncation is under f64 and more nodes buy nothing: the
    // estimate keeps falling ×h⁴ while the measured error flattens, and the gap
    // between them is how a caller sees the floor has arrived.
    const e32 = errorAt(32);
    const e64 = errorAt(64);
    expect(e32).toBeLessThan(1e-15);
    expect(e64).toBeLessThan(1e-15);
    expect(e64 / e32).toBeGreaterThan(0.4);
    const ulp = Math.abs(exact[exact.length - 1]!) * Number.EPSILON;
    expect(e64).toBeLessThan(10 * ulp);
    const map64 = buildRadialMap(SYSTEM, { maxRadiusMm: span, nodes: 64, wavelengthNm: LAMBDA });
    expect(e64 / map64.errorEstimateMm).toBeGreaterThan(3);
  });
});

/* ── § 6s.3 — what that is in the currency that decides it ────────────────── */

describe("§ 6s.3 — registration, in pixels", () => {
  it("a 2 mm off-axis tile registers to 4e-13 px, against § 6m.4's 3.4e-3", () => {
    const frame = tileAt(2, 0);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 64 });
    let worstPx = 0;
    for (let iy = 0; iy < frame.size; iy += 2) {
      for (let ix = 0; ix < frame.size; ix += 2) {
        const a = specimenPointAt(SYSTEM, frame, ix, iy, {});
        const b = specimenPointAt(SYSTEM, frame, ix, iy, { radialMap: map });
        worstPx = Math.max(worstPx, Math.hypot(a.x - b.x, a.y - b.y) / frame.objectPixelScaleMm);
      }
    }
    // § 6o.8 measured the two registration errors this branch cares about: 3.4e-3
    // px of ruler drift on a tile centre, and 16.0 px of lattice offset a third
    // of a tile off it. The cache sits **nine orders** below the smaller of them
    // — which is the comparison that decides whether it may be used at all, so
    // it is asserted against that number and not against a round one.
    expect(worstPx).toBeLessThan(1e-11);
    expect(3.4e-3 / worstPx).toBeGreaterThan(1e9);
  });

  it("even nine inversions put a pixel to 6e-11 px", () => {
    // The practical statement of § 6s.2's order: the table does not need to be
    // large, it needs to exist. 8 nodes is 9 chief-ray inversions for the whole
    // tile against 4 096 for its pixels.
    const frame = tileAt(2, 0);
    const span = radialMapCovering(SYSTEM, [frame], { nodes: 8 });
    expect(span.inversions).toBe(9);
    let worstPx = 0;
    for (let iy = 0; iy < frame.size; iy += 4) {
      for (let ix = 0; ix < frame.size; ix += 4) {
        const a = specimenPointAt(SYSTEM, frame, ix, iy, {});
        const b = specimenPointAt(SYSTEM, frame, ix, iy, { radialMap: span });
        worstPx = Math.max(worstPx, Math.hypot(a.x - b.x, a.y - b.y) / frame.objectPixelScaleMm);
      }
    }
    expect(worstPx).toBeLessThan(1e-9);
  });
});

/* ── § 6s.4 — the picture ─────────────────────────────────────────────────── */

describe("§ 6s.4 — the rendered tile is the same picture", () => {
  it("a traced, illuminated, cropped tile differs by 4e-14 of its peak", () => {
    const options = {
      tiles: 1,
      size: 64,
      pupilSamples: 32,
      guardCells: 0,
      wavelengthNm: LAMBDA,
      centreMm: { x: 2, y: 0 },
      patches: 2,
    };
    const source = diskSource(0.5, 5);
    const layout = mosaicLayout(SYSTEM, options);
    const tile = layout.tiles[0]!;
    const exact = renderMosaicTile(SYSTEM, BARS, source, options, tile);
    const cached = renderMosaicTile(
      SYSTEM,
      BARS,
      source,
      { ...options, radialMapNodes: 64 },
      tile,
    );
    let worst = 0;
    let peak = 0;
    for (let i = 0; i < exact.intensity.length; i++) {
      worst = Math.max(worst, Math.abs(exact.intensity[i]! - cached.intensity[i]!));
      peak = Math.max(peak, exact.intensity[i]!);
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(worst / peak).toBeLessThan(1e-12);
  });
});

/* ── § 6s.5 — the saving, as an exact integer ─────────────────────────────── */

describe("§ 6s.5 — the saving is an integer, and one table serves a mosaic", () => {
  it("a table costs nodes + 1 inversions, against one per pixel", () => {
    // § 6p's own currency: an integer a rung can pin on any machine, not a wall
    // clock. A 128² tile asks 16 384 inversions of the exact path and 65 of this
    // one — 252×, and the measured wall clock (1 293 ms → 235 ms for the whole
    // traced tile at grid 128) is recorded in VALIDATION.md rather than asserted.
    const map = radialMapCovering(SYSTEM, [tileAt(2, 0, 128)], { nodes: 64 });
    expect(map.inversions).toBe(65);
    expect(128 * 128).toBe(16384);
  });

  it("the map belongs to the SYSTEM, so a 4×4 mosaic pays for one table", () => {
    const options = {
      tiles: 4,
      size: 64,
      pupilSamples: 32,
      guardCells: 4,
      wavelengthNm: LAMBDA,
    };
    const layout = mosaicLayout(SYSTEM, options);
    expect(layout.tiles.length).toBe(16);
    const map = radialMapCovering(
      SYSTEM,
      layout.tiles.map((t) => t.frame),
      { nodes: 64 },
    );
    expect(map.inversions).toBe(65);
    // And it really covers them: every corner of every tile is inside the span,
    // so no pixel of the mosaic is an extrapolation off the end of the table.
    for (const tile of layout.tiles) {
      for (const u of [0, 1]) {
        for (const v of [0, 1]) {
          const p = imagePointAt(tile.frame, u, v);
          expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(map.maxRadiusMm);
        }
      }
    }
  });
});

/* ── § 6s.6 — the null ────────────────────────────────────────────────────── */

describe("§ 6s.6 — tabulating the residual buys nothing, measured", () => {
  it("height and residual agree to under 1% wherever truncation decides", () => {
    // The obvious optimisation: the map is nearly linear (§ 6m.4 measures the
    // departure at 49 ppm), so tabulate only the departure and the table's
    // dynamic range collapses. It is worth nothing, and the reason is that a
    // CUBIC ALREADY REPRODUCES A LINEAR FUNCTION EXACTLY — subtracting one
    // changes no truncation error — while the reconstruction's final add,
    // slope·r + δ, rounds at the same magnitude the direct table does. So there
    // is no gain in either régime, and the control is kept as code rather than
    // as a paragraph.
    const frame = tileAt(2, 0);
    const span = radialMapCovering(SYSTEM, [frame], { nodes: 8 }).maxRadiusMm;
    const radii = tileRadii(frame);
    const exact = radii.map((r) => objectHeightForImageRadius(SYSTEM, r, LAMBDA, {}));
    const pair = (nodes: number): [number, number] => [
      worstError(
        buildRadialMap(SYSTEM, { maxRadiusMm: span, nodes, wavelengthNm: LAMBDA }),
        radii,
        exact,
      ),
      worstError(
        buildRadialMap(SYSTEM, {
          maxRadiusMm: span,
          nodes,
          wavelengthNm: LAMBDA,
          tabulate: "residual",
        }),
        radii,
        exact,
      ),
    ];

    for (const nodes of [4, 6, 8, 12, 16]) {
      const [a, b] = pair(nodes);
      expect(Math.abs(a - b) / a).toBeLessThan(0.01);
    }

    // At the floor the two differ, and that is not the residual form winning —
    // it is a last-bit difference in a quantity that IS the last bit, measured
    // on both sides of zero across the ladder (residual worse at 24, better at
    // 64). Pinned as a magnitude, under one ulp of the object height.
    const ulp = Math.abs(exact[exact.length - 1]!) * Number.EPSILON;
    for (const nodes of [32, 64]) {
      const [a, b] = pair(nodes);
      expect(a).toBeLessThan(1e-15);
      expect(b).toBeLessThan(1e-15);
      expect(Math.abs(a - b)).toBeLessThan(ulp);
    }
  });
});

/* ── § 6s.7 — the identity a table has to carry ───────────────────────────── */

describe("§ 6s.7 — a table that does not belong to the frame is refused", () => {
  it("a wavelength it was not traced at", () => {
    // § 6r's stack has one frame per wavelength and the inverse chief-ray map is
    // wavelength-dependent. A 450 nm table on the 650 nm frame is a plausible
    // picture of very slightly the wrong specimen with no witness downstream —
    // § 6n.2's and § 6p's bug class — so it is refused rather than trusted.
    const frame = tileAt(2, 0);
    const wrong = buildRadialMap(SYSTEM, {
      maxRadiusMm: 3,
      nodes: 16,
      wavelengthNm: 450,
    });
    expect(() => specimenPointAt(SYSTEM, frame, 0, 0, { radialMap: wrong })).toThrow(
      /tabulated at 450 nm/,
    );
  });

  it("an aiming it was not traced with", () => {
    const frame = tileAt(2, 0);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 16 });
    expect(() =>
      specimenPointAt(SYSTEM, frame, 0, 0, { radialMap: map, aim: { launchZ: -5 } }),
    ).toThrow(/launchZ/);
  });

  it("a radius past the end of the table, rather than extrapolating onto it", () => {
    const map = buildRadialMap(SYSTEM, { maxRadiusMm: 1, nodes: 16, wavelengthNm: LAMBDA });
    expect(() => map.heightAt(1.5)).toThrow(/outside the tabulated range/);
    expect(() => map.heightAt(-1e-9)).toThrow(/outside the tabulated range/);
    // The whole range IS answerable, including its last point — the node beyond
    // the end exists so the final interval is interpolated and not extrapolated.
    expect(map.heightAt(1)).toBeCloseTo(objectHeightForImageRadius(SYSTEM, 1, LAMBDA, {}), 12);
  });

  it("frames at different wavelengths, covered by one table", () => {
    const blue = objectFieldTile(SYSTEM, {
      size: 64,
      pupilSamples: 32,
      wavelengthNm: 450,
      centreMm: { x: 1, y: 0 },
    });
    const red = objectFieldTile(SYSTEM, {
      size: 64,
      pupilSamples: 32,
      wavelengthNm: 650,
      centreMm: { x: 1, y: 0 },
    });
    expect(() => radialMapCovering(SYSTEM, [blue, red], { nodes: 16 })).toThrow(
      /Build one per wavelength/,
    );
  });

  it("a table too small to carry its own stencil", () => {
    expect(() =>
      buildRadialMap(SYSTEM, { maxRadiusMm: 1, nodes: 3, wavelengthNm: LAMBDA }),
    ).toThrow(/nodes must be an integer >= 4/);
    expect(() =>
      buildRadialMap(SYSTEM, { maxRadiusMm: 0, nodes: 16, wavelengthNm: LAMBDA }),
    ).toThrow(/maxRadiusMm/);
  });
});

/* ── § 6s.8 — the wavelength multiplier ───────────────────────────────────── */

describe("§ 6s.8 — § 6r's stack, one table per wavelength", () => {
  it("the cached planes are the uncached ones", () => {
    // The step's own justification: § 6r runs the raster once per wavelength, so
    // whatever a tile costs is multiplied by the size of the lamp's sampling.
    const options = {
      size: 64,
      pupilSamples: 32,
      samples: [
        { nm: 450, weight: 1 },
        { nm: 550, weight: 1 },
        { nm: 650, weight: 1 },
      ],
      patches: 2,
      centreMm: { x: 1, y: 0 },
    };
    const source = diskSource(0.5, 5);
    const stain: Parameters<typeof brightfieldSpectralStack>[1] = (x, y, nm) => ({
      re: BARS(x, y).re * (nm < 500 ? 0.4 : 1),
      im: 0,
    });
    const exact = brightfieldSpectralStack(SYSTEM, stain, source, options);
    const cached = brightfieldSpectralStack(SYSTEM, stain, source, {
      ...options,
      radialMapNodes: 64,
    });
    expect(cached.planes.length).toBe(3);
    let worst = 0;
    for (let p = 0; p < exact.planes.length; p++) {
      const a = exact.planes[p]!.intensity;
      const b = cached.planes[p]!.intensity;
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    }
    expect(worst).toBeLessThan(1e-12);
  });
});

/* ── the rasterizer, end to end ───────────────────────────────────────────── */

describe("§ 6s — the rasterizer itself", () => {
  it("a cached raster is the exact raster, amplitude for amplitude", () => {
    const frame = tileAt(2, 0, 64);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 64 });
    const exact = rasterizeSpecimen(SYSTEM, frame, BARS, {});
    const cached = rasterizeSpecimen(SYSTEM, frame, BARS, { radialMap: map });
    let worst = 0;
    for (let i = 0; i < exact.re.length; i++) {
      worst = Math.max(worst, Math.hypot(exact.re[i]! - cached.re[i]!, exact.im[i]! - cached.im[i]!));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("the uniform control ignores the table, because it inverts nothing", () => {
    // `"uniform"` is § 6n's negative control — `centreObjectMm` plus a pixel
    // offset — and it never asks the traced map anything, so a table handed to
    // it must change nothing at all rather than being quietly consulted.
    const frame = tileAt(2, 0);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: 64 });
    const a = specimenPointAt(SYSTEM, frame, 7, 11, { map: "uniform" });
    const b = specimenPointAt(SYSTEM, frame, 7, 11, { map: "uniform", radialMap: map });
    expect(Object.is(a.x, b.x)).toBe(true);
    expect(Object.is(a.y, b.y)).toBe(true);
  });
});
