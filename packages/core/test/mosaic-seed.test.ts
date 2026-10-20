import { describe, it, expect } from "vitest";
import {
  mosaicTileAt,
  renderMosaic,
  renderMosaicTile,
  type MosaicOptions,
  type RenderMosaicOptions,
} from "../src/imaging/mosaic";
import {
  renderSpectralMosaic,
  renderSpectralMosaicTile,
  spectralMosaicTileAt,
  type SpectralMosaicOptions,
} from "../src/imaging/mosaic-spectrum";
import { neutralSpecimen, type Specimen } from "../src/imaging/specimen";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  oilImmersionObjective,
  tubeLens,
} from "../src/designs";
import { imageRadiusForObjectHeight, objectHeightForImageRadius } from "../src/imaging/object-field";
import { commensurateSource } from "../src/illumination";
import type { RadialMapSeed } from "../src/imaging/radial-map";

/**
 * § 6cu — the seed reaches the brightfield mosaic.
 *
 * § 6bk's bracket, on the two callers § 6ct left: `renderMosaicTile` and the
 * spectral mosaic built their radial maps unseeded, so `objectHeightForImageRadius`
 * opened at the image radius — |M| object heights out — and lost the chief ray
 * there long before the tile was out of the field. The app's stage is what found
 * it (APP.md D4, *the stage on real aiming*): the DIN 4×/0.10 refused every tile
 * past 1.8 mm of its 2.25 mm field, a limit that had been put down to the lens.
 *
 * The rungs are § 6ct's shape, because the change is the same option on more
 * callers:
 *
 * 1. Inside the field, a tile that refuses unseeded — with the message that
 *    names the seed — renders seeded, at 4× and at 10×.
 * 3. Where both paths work the option is inert: `"none"` written out is bitwise
 *    the omitted option, and the seed moves no pixel past the mantissa.
 * 4. The whole-mosaic renderers carry it too.
 *
 * § 6cu.2, the catalogue swept to each row's field radius, is the app's
 * (`packages/app/test/stage.test.ts`): the catalogue lives there.
 *
 * Both systems are on the paraxial aim, as the stage builds them (APP.md D4
 * point 5).
 */

const SOURCE = commensurateSource(0.5, 32, 1);

/** A checkerboard of cosines in object millimetres: structure on both axes. */
const CHECKS: Specimen = (x, y) => ({
  re: 0.6 + 0.4 * Math.cos((2 * Math.PI * x) / 0.01) * Math.cos((2 * Math.PI * y) / 0.013),
  im: 0,
});

const FOUR = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, fieldNumberMm: 18 }),
  rayAiming: "paraxial",
}).system;

const TEN = infinityCorrectedMicroscope({
  objective: microscopeObjective({
    magnification: 10,
    numericalAperture: 0.1,
    tubeFocalLengthMm: 200,
    fieldNumberMm: 18,
  }),
  tubeLens: tubeLens({ focalLengthMm: 200 }),
  rayAiming: "paraxial",
}).system;

/** The stage's own lattice: pupilSamples 32, grid 64, guard 4, the exit layout. */
function mono(centreMm: { x: number; y: number }): MosaicOptions {
  return { tiles: 1, size: 64, pupilSamples: 32, guardCells: 4, wavelengthNm: 550, layout: "exit", centreMm };
}

function render(
  system: typeof FOUR,
  options: MosaicOptions,
  seed: RadialMapSeed | undefined,
  col = 0,
  row = 0,
) {
  const tile = mosaicTileAt(system, options, col, row);
  const render: MosaicOptions & RenderMosaicOptions = {
    ...options,
    patches: 1,
    radialMapNodes: 64,
    ...(seed === undefined ? {} : { radialMapSeed: seed }),
  };
  return renderMosaicTile(system, CHECKS, SOURCE, render, tile);
}

function spectral(seed: RadialMapSeed | undefined): SpectralMosaicOptions {
  return {
    size: 64,
    pupilSamples: 32,
    guardCells: 4,
    samples: [450, 550, 650].map((nm) => ({ nm, weight: 1 })),
    layout: "exit",
    patches: 1,
    radialMapNodes: 64,
    ...(seed === undefined ? {} : { radialMapSeed: seed }),
  };
}

const UNSEEDED = /no object height reaches image radius.*UNSEEDED/;

describe("§ 6cu.1 — a tile inside the field needs the seed", () => {
  // Centres are IMAGE millimetres, as `MosaicOptions.centreMm` is.
  it("the DIN 4×/0.10 at 1.84 mm of its 2.25 mm field: refuses unseeded, renders seeded", () => {
    const at = mono({ x: 7.36, y: 0 });
    expect(() => render(FOUR, at, "none")).toThrow(UNSEEDED);
    const seeded = render(FOUR, at, "magnification");
    expect(seeded.tile.frame.centreObjectMm.x).toBeGreaterThan(1.8);
    expect(seeded.tile.frame.centreObjectMm.x).toBeLessThan(2.25);
    expect(seeded.fidelity.verdict).toBe("valid");
  });

  it("the infinity 10×/0.10 at 0.4 mm of its 0.9 mm field: the same", () => {
    const at = mono({ x: 4, y: 0 });
    expect(() => render(TEN, at, "none")).toThrow(UNSEEDED);
    const seeded = render(TEN, at, "magnification");
    expect(seeded.tile.frame.centreObjectMm.x).toBeGreaterThan(0.3);
    expect(seeded.tile.frame.centreObjectMm.x).toBeLessThan(0.9);
    expect(seeded.fidelity.verdict).toBe("valid");
  });

  it("and the colour tile there too", () => {
    const options = { ...spectral("none"), centreMm: { x: 4, y: 0 } };
    const tile = spectralMosaicTileAt(TEN, options, 0, 0);
    const specimen = neutralSpecimen(CHECKS);
    expect(() => renderSpectralMosaicTile(TEN, specimen, SOURCE, options, tile)).toThrow(UNSEEDED);
    const seeded = { ...spectral("magnification"), centreMm: { x: 4, y: 0 } };
    const formed = renderSpectralMosaicTile(TEN, specimen, SOURCE, seeded, spectralMosaicTileAt(TEN, seeded, 0, 0));
    for (const plane of formed.stack.planes) {
      expect(plane.intensity.every((v) => Number.isFinite(v)), `${plane.nm} nm finite`).toBe(true);
    }
  });
});

describe("§ 6cu.3 — where both paths work, the option is inert", () => {
  const AXIS = mono({ x: 0, y: 0 });

  it("monochrome: 'none' is bitwise the omitted option, and the seed moves only the mantissa", () => {
    const omitted = render(FOUR, AXIS, undefined, 1, 0).intensity;
    const none = render(FOUR, AXIS, "none", 1, 0).intensity;
    const seeded = render(FOUR, AXIS, "magnification", 1, 0).intensity;
    let differing = 0;
    for (let i = 0; i < omitted.length; i++) if (!Object.is(omitted[i], none[i])) differing++;
    expect(differing).toBe(0);
    let peak = 0;
    let worst = 0;
    for (let i = 0; i < none.length; i++) {
      peak = Math.max(peak, none[i]!);
      worst = Math.max(worst, Math.abs(seeded[i]! - none[i]!));
    }
    expect(worst / peak).toBeLessThan(1e-14);
  });

  it("colour: the same, on every plane", () => {
    const specimen = neutralSpecimen(CHECKS);
    const formed = (seed: RadialMapSeed | undefined) => {
      const options = spectral(seed);
      return renderSpectralMosaicTile(FOUR, specimen, SOURCE, options, spectralMosaicTileAt(FOUR, options, 1, 0))
        .stack.planes;
    };
    const omitted = formed(undefined);
    const none = formed("none");
    const seeded = formed("magnification");
    for (let p = 0; p < omitted.length; p++) {
      const a = omitted[p]!.intensity;
      const b = none[p]!.intensity;
      const c = seeded[p]!.intensity;
      let differing = 0;
      let peak = 0;
      let worst = 0;
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) differing++;
        peak = Math.max(peak, b[i]!);
        worst = Math.max(worst, Math.abs(c[i]! - b[i]!));
      }
      expect(differing, `${omitted[p]!.nm} nm`).toBe(0);
      expect(worst / peak, `${omitted[p]!.nm} nm`).toBeLessThan(1e-14);
    }
  });
});

describe("§ 6cu.4 — the whole-mosaic renderers carry the seed", () => {
  // `renderMosaic` builds ONE table over every tile and hands it down, so a seed
  // that reached `renderMosaicTile` and not the shared table would leave the
  // composed mosaic refusing where its own tiles render.
  it("renderMosaic: a 2×2 on the 10× at 0.4 mm refuses unseeded, renders seeded", () => {
    const options = { ...mono({ x: 4, y: 0 }), tiles: 2, patches: 1, radialMapNodes: 64 };
    expect(() => renderMosaic(TEN, CHECKS, SOURCE, { ...options, radialMapSeed: "none" })).toThrow(UNSEEDED);
    const seeded = renderMosaic(TEN, CHECKS, SOURCE, { ...options, radialMapSeed: "magnification" });
    expect(seeded.intensity.every((v) => Number.isFinite(v))).toBe(true);
    expect(seeded.fidelity.verdict).toBe("valid");
  });

  it("renderSpectralMosaic: the same, one table per wavelength", () => {
    const specimen = neutralSpecimen(CHECKS);
    const options = { ...spectral("none"), tiles: 2, centreMm: { x: 4, y: 0 } };
    expect(() => renderSpectralMosaic(TEN, specimen, SOURCE, options)).toThrow(UNSEEDED);
    const seeded = renderSpectralMosaic(TEN, specimen, SOURCE, { ...options, radialMapSeed: "magnification" });
    expect(seeded.layout.tiles).toHaveLength(4);
    expect(seeded.image.xyz.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("§ 6cu.5 — a doubling past the lens backs off", () => {
  // The seeded bracket opens at r/|M|, a hair short of r, and doubles. On the oil
  // 100× the doubled probe is past where the chief ray survives while the radius
  // asked for is well inside it, so the doubling has to back off rather than throw.
  const OIL = infinityCorrectedMicroscope({
    objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    rayAiming: "paraxial",
  }).system;
  const FIELD_EDGE = 9; // image mm: FN 18
  const M = 100;

  it("the field edge, where the doubled probe is dead, inverts onto its own radius", () => {
    expect(() => imageRadiusForObjectHeight(OIL, (2 * FIELD_EDGE) / M, 550)).toThrow(/chief ray failed/);
    const h = objectHeightForImageRadius(OIL, FIELD_EDGE, 550, { magnification: M });
    expect(Math.abs(imageRadiusForObjectHeight(OIL, h, 550) / FIELD_EDGE - 1)).toBeLessThan(1e-9);
    // Between the seed, whose radius falls short, and the doubled probe, which is
    // dead: the back-off found a height the doubling stepped over. 0.0978 mm.
    expect(imageRadiusForObjectHeight(OIL, FIELD_EDGE / M, 550)).toBeLessThan(FIELD_EDGE);
    expect(h).toBeGreaterThan(FIELD_EDGE / M);
    expect(h).toBeLessThan((2 * FIELD_EDGE) / M);
  });

  it("a radius past the last traced chief ray still throws the doubling's own error", () => {
    expect(() => objectHeightForImageRadius(OIL, 4 * FIELD_EDGE, 550, { magnification: M })).toThrow(
      /no object height reaches image radius 36 mm.*chief ray failed \(vignetted\)/,
    );
  });

  it("and a dead FIRST probe still refuses, unseeded, as § 6bk's message says", () => {
    expect(() => objectHeightForImageRadius(OIL, FIELD_EDGE, 550)).toThrow(UNSEEDED);
  });
});
