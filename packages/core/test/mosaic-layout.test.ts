import { describe, it, expect } from "vitest";
import { diskSource } from "../src/illumination/source";
import { mosaicLayout, mosaicTileAt, renderMosaicTile, type MosaicOptions } from "../src/imaging/mosaic";
import {
  renderSpectralMosaicTile,
  spectralMosaicGeometry,
  spectralMosaicTileAt,
  type SpectralMosaicOptions,
} from "../src/imaging/mosaic-spectrum";
import { objectFieldTile, type ObjectFieldFrame } from "../src/imaging/object-field";
import { neutralSpecimen, type Specimen } from "../src/imaging/specimen";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { PupilLayout } from "../src/wave/psf";

/**
 * § 2s.1 — a brightfield mosaic's tiles are laid out in the layout it is asked for.
 *
 * `mosaicLayout`, `mosaicTileAt` and the spectral mosaic built their tile frames
 * from a hand-written list of the caller's options, and `layout` was not on it.
 * A frame carries the layout its ruler was read in and every pupil laid on it
 * follows the frame, so the option was dropped for the whole tile: the frame
 * fell back to the default, and a render that asked its pupils for the named
 * layout was refused for a ruler/pupil mismatch. Nothing in the ladder asked a
 * brightfield mosaic for a layout until § 2s pinned § 6o and § 6t to the aim
 * layout by name, and that pin was the first caller — found when the default
 * was flipped under it and the frames went to `"exit"` while the pupils asked
 * for `"aim"`. The fluorescence mosaic spreads its options whole and never
 * dropped it.
 *
 * The pin is an identity: a tile from either module, in either layout, IS
 * `objectFieldTile` at that tile's centre in that layout — bit for bit, and with
 * the two layouts' frames different, or the identity is empty.
 */

const LAMBDA = 587.5618;

/**
 * § 6o's own mosaic system, the rim-stopped DIN 4×/0.10 — on the paraxial aim
 * and its stop, because every identity here is read in both layouts and the aim
 * layout is that aim's affine map (§ 2z.7). The pin is plumbing: which layout a
 * tile is asked for, not what either layout reads.
 */
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement: "rim" }),
  rayAiming: "paraxial",
}).system;

const ANCHOR = { x: 1.6, y: 0.8 } as const;
const LAYOUTS = ["aim", "exit"] as const satisfies readonly PupilLayout[];

const mono = (layout: PupilLayout): MosaicOptions => ({
  tiles: 3,
  size: 64,
  pupilSamples: 32,
  guardCells: 4,
  wavelengthNm: LAMBDA,
  centreMm: ANCHOR,
  layout,
});

const spectral = (layout: PupilLayout): SpectralMosaicOptions => ({
  size: 64,
  pupilSamples: 32,
  guardCells: 4,
  samples: [450, 650].map((nm) => ({ nm, weight: 0.5 })),
  centreMm: ANCHOR,
  layout,
});

/** The direct construction at a frame's own centre and wavelength. */
const direct = (frame: ObjectFieldFrame, layout: PupilLayout): ObjectFieldFrame =>
  objectFieldTile(SYSTEM, {
    size: frame.size,
    pupilSamples: frame.pupilSamples,
    wavelengthNm: frame.wavelengthNm,
    centreMm: frame.centreMm,
    layout,
  });

const expectSameFrame = (got: ObjectFieldFrame, want: ObjectFieldFrame): void => {
  expect(got.layout).toBe(want.layout);
  expect(got.scale).toEqual(want.scale);
  expect(got.pixelScaleMm).toBe(want.pixelScaleMm);
  expect(got.centreObjectMm).toEqual(want.centreObjectMm);
};

/** A bar grating in object millimetres — structure, so a render has something to form. */
const BARS: Specimen = (x) => ({ re: 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / 0.01), im: 0 });

describe("§ 2s.1 — a mosaic's tiles are laid out in the layout it is asked for", () => {
  it("`mosaicLayout` and `mosaicTileAt`: every tile IS `objectFieldTile` in that layout, bitwise", () => {
    const pixel: number[] = [];
    for (const layout of LAYOUTS) {
      const laid = mosaicLayout(SYSTEM, mono(layout));
      for (const tile of laid.tiles) expectSameFrame(tile.frame, direct(tile.frame, layout));
      const indexed = mosaicTileAt(SYSTEM, mono(layout), 1, -1).frame;
      expectSameFrame(indexed, direct(indexed, layout));
      pixel.push(laid.pixelScaleMm);
    }
    // The two layouts read different rulers, or every line above is empty.
    expect(pixel[0]).not.toBe(pixel[1]);
  });

  it("the spectral mosaic: every plane of a tile IS `objectFieldTile` at its λ in that layout", () => {
    const pixel: number[] = [];
    for (const layout of LAYOUTS) {
      const geometry = spectralMosaicGeometry(SYSTEM, spectral(layout));
      const tile = spectralMosaicTileAt(SYSTEM, spectral(layout), -1, 1, geometry);
      for (const plane of tile.planes) expectSameFrame(plane.frame, direct(plane.frame, layout));
      pixel.push(geometry.pixelScaleMm);
    }
    expect(pixel[0]).not.toBe(pixel[1]);
  });

  it("a tile asked for the layout the default is not renders on it — the failure that found this", () => {
    // Before § 2s.1 the frame took the default and the pupils the named layout,
    // and `fieldPupilAt` refused the pair. Rendered in the layout the default is
    // NOT, whichever that is, so the rung keeps its teeth after the flip.
    const source = diskSource(0.6, 5);
    for (const layout of LAYOUTS) {
      const options = { ...mono(layout), patches: 1 };
      const image = renderMosaicTile(SYSTEM, BARS, source, options, mosaicTileAt(SYSTEM, options, 1, 0));
      expect(image.fidelity.verdict).toBe("valid");
      const spectralOptions = { ...spectral(layout), patches: 1 };
      const geometry = spectralMosaicGeometry(SYSTEM, spectralOptions);
      const planes = renderSpectralMosaicTile(
        SYSTEM,
        neutralSpecimen(BARS),
        source,
        spectralOptions,
        spectralMosaicTileAt(SYSTEM, spectralOptions, 1, 0, geometry),
        geometry,
      );
      expect(planes.contributingPoints).toBeGreaterThan(0);
    }
  });
});
