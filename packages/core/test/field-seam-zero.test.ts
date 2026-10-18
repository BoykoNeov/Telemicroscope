import { describe, it, expect } from "vitest";
import {
  fluorescenceMosaicGeometry,
  fluorescenceMosaicPitchDriftPx,
  mosaicSeamShiftMm,
  type FluorescenceMosaicOptions,
} from "../src/imaging/fluorescence-mosaic";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";
import { objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 2r.3 — a field scan's seam is the aim layout's ruler, and it is 0 on the exit layout.
 *
 * § 6ci wrote the field scan's seam in closed form: with no overlap the two tiles
 * at a seam read one composed pixel at rendered offsets ±U, and their frames
 * differ only in `pixelScaleMm`, so the seam is `U(s_a + s_b − 2 s_r)` along it
 * and `(i − size/2)(s_a − s_b)` across it — live to 1e-11 over 36
 * configurations. On the aim layout a frame's scale is its paraxial reference
 * sphere and moves with field radius (§ 6ci.1). On the exit layout the ruler is
 * the traced aperture sine read ON THE AXIS whatever the tile's centre (§ 2i,
 * `objectFieldTile`), so every tile's scale is the anchor's and both terms vanish.
 *
 * **Hypothesis.** On the exit layout a field scan's seam is 0 — not small: the
 * closed form exactly, the live seam to the rounding of the tile centres it is
 * laid about — and its pitch drift with it, while a stage scan's seam, which is
 * the map's period restarting (§ 6bj.5), survives. **Refuted by** any field-scan
 * tile whose ruler differs from the anchor's in any bit, a live field-scan seam
 * above 1e-15 mm (the aim layout's is ~1e-6 mm), or a stage seam that vanishes
 * with it.
 *
 * So the field-scan seam chain (§ 6bo → § 6cl: its guard sensitivities, axis
 * constants and the registration cost that divides by it) measured the aim
 * layout's per-tile ruler — real arithmetic about a ruler the exit layout does
 * not have. Its files read it on the aim layout, explicitly, and keep it as
 * that layout's (`SEAM` in each).
 *
 * External number: § 6ci.0's closed form, evaluated at the frames' own scales.
 */

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6ci's four cells at § 6bo's shapes. */
const CELLS: readonly { system: OpticalSystem; size: number; ps: number }[] = [
  { system: build(10, 0.1), size: 128, ps: 32 },
  { system: build(10, 0.2), size: 256, ps: 64 },
  { system: build(20, 0.1), size: 128, ps: 16 },
  { system: build(20, 0.2), size: 128, ps: 32 },
];
const ANCHORS = [0, 2, 4];

const options = (
  size: number,
  ps: number,
  layout: "aim" | "exit",
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions => ({
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
  stageMm: () => 0,
  radialMapSeed: "magnification",
  layout,
  ...over,
});

describe("§ 2r.3 — a field scan's seam is the aim layout's ruler, and it is 0 on the exit layout", () => {
  it("every field-scan tile reads the anchor's ruler, bitwise, at every wavelength", () => {
    for (const { system, size, ps } of CELLS) {
      for (const x of ANCHORS) {
        const g = fluorescenceMosaicGeometry(system, options(size, ps, "exit", { centreMm: { x, y: 0 } }));
        for (const plane of g.planes) {
          for (const c of g.centresMm) {
            const tile = objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: plane.frame.wavelengthNm, centreMm: c, layout: "exit" });
            expect(Object.is(tile.pixelScaleMm, plane.frame.pixelScaleMm)).toBe(true);
          }
        }
      }
    }
  });

  it("so § 6ci.0's closed form is 0 on both axes, and the live seam is rounding", () => {
    // The live seam is the tile centres' own arithmetic — centre plus offset
    // times scale, the centres one pitch apart — and at some anchors that rounds
    // to 8.4e-17 mm rather than to 0: 2e-14 of a pixel, nine orders under the
    // aim layout's seam at the same anchor.
    for (const { system, size, ps } of CELLS) {
      for (const x of ANCHORS) {
        const exit = options(size, ps, "exit", { centreMm: { x, y: 0 } });
        const g = fluorescenceMosaicGeometry(system, exit);
        const n = g.tilesPerAxis;
        const U = g.tileSize / 2 - g.croppedPixels - g.guardPixels;
        const half = (n - 1) / 2;
        const scale = (k: number): number => {
          const col = k % n;
          const row = (k - col) / n;
          const centreMm = { x: x + (col - half) * g.pitchMm, y: (row - half) * g.pitchMm };
          return objectFieldTile(system, { size, pupilSamples: ps, wavelengthNm: g.rulerWavelengthNm, centreMm, layout: "exit" }).pixelScaleMm;
        };
        const sr = g.pixelScaleMm;
        for (let a = 0; a < n * n - 1; a++) {
          const sa = scale(a);
          const sb = scale(a + 1);
          expect(U * (sa + sb - 2 * sr)).toBe(0);
          expect(sa - sb).toBe(0);
        }
        const live = mosaicSeamShiftMm(system, exit, 17);
        expect(live.betweenRowsMm).toBeLessThan(1e-15);
        expect(live.betweenColumnsMm).toBeLessThan(1e-15);
        expect(fluorescenceMosaicPitchDriftPx(system, exit)).toBeLessThan(1e-12);
        const aim = mosaicSeamShiftMm(system, options(size, ps, "aim", { centreMm: { x, y: 0 } }), 17);
        expect(aim.mm).toBeGreaterThan(1e9 * live.mm);
      }
    }
  });

  it("at five tiles, a wider guard and an overlap too — the ruler, not the arrangement", () => {
    const { system, size, ps } = CELLS[0]!;
    for (const over of [{ tiles: 5 }, { guardCells: 8 }, { overlapPixels: 6 }] as const) {
      const live = mosaicSeamShiftMm(system, options(size, ps, "exit", { centreMm: { x: 4, y: 0 }, ...over }), 17);
      expect(live.mm).toBeLessThan(1e-15);
    }
  });

  it("while the aim layout's field seam is its ruler's drift, and a stage seam survives on both", () => {
    for (const { system, size, ps } of CELLS) {
      const at = (layout: "aim" | "exit", scan: "field" | "stage") =>
        mosaicSeamShiftMm(system, options(size, ps, layout, { centreMm: { x: 4, y: 0 }, scan }), 17);
      const aimField = at("aim", "field");
      expect(aimField.mm).toBeGreaterThan(0);
      expect(fluorescenceMosaicPitchDriftPx(system, options(size, ps, "aim", { centreMm: { x: 4, y: 0 } }))).toBeGreaterThan(0);
      // The stage seam is the map's period restarting, and the map is a chief-ray
      // property: the layout moves it only through the ruler its probes are laid
      // on, which the two layouts set within 1.2% of each other (§ 2i).
      const aimStage = at("aim", "stage");
      const exitStage = at("exit", "stage");
      expect(exitStage.mm).toBeGreaterThan(0);
      expect(Math.abs(exitStage.mm / aimStage.mm - 1)).toBeLessThan(0.03);
      expect(exitStage.mm / aimField.mm).toBeGreaterThan(10);
    }
  });
});
