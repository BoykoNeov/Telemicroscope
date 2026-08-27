import type { OpticalSystem } from "../trace/system";
import { mosaicGuardPixels } from "./mosaic";
import { objectFieldTile, type ObjectFieldFrame } from "./object-field";
import {
  focusCorrectedTiles,
  type FocusCorrectedTile,
  type FocusCorrectedTilesOptions,
  type TileStageMm,
} from "./focus-tiles";
import type { FluorescenceSpectralStack } from "./emitter-spectrum";
import type { SpectralVolumeEmitterDensity, VolumePlane } from "./spectral-volume";

/**
 * § 6bh — the fluorescence mosaic, and what a tile's edge is made of.
 *
 * § 6bg corrects the stage tile by tile and composes nothing: it renders a list
 * and hands back a list, "no guard band, no common ruler, no pitch", with the
 * mosaic named as its own deferral. This composes them, and the composition
 * turns out to be the cheap half.
 *
 * ## The correction is not only for sharpness — it is what keeps a tile inside
 * ## its own frame
 *
 * § 6bg reads "the correction and the composition are separable exactly because
 * the stage is a per-tile scalar". That is true of the **arithmetic** — this
 * module wraps `focusCorrectedTiles` unchanged and crops what comes back — and
 * false of the **cost**, which is the finding this step exists for.
 *
 * A tile is formed by circular convolution, so light that leaves one edge
 * re-enters at the other (§ 6bd.8), and a guard band exists to throw away the
 * band that lands in. How wide that band has to be is set by how far the
 * response reaches, and on this branch that is **not** diffraction and **not**
 * the specimen's thickness. It is the stage error:
 *
 * - a 430 nm tile at the nominal stage leaks **9.823%** of a point emitter's
 *   light past its own frame, and reports a grid phase step of 0.6324 waves —
 *   past § 6bd.8's half-wave containment limit;
 * - the same tile at § 6bf's swept stage leaks **1.866%** and reports 0.3326,
 *   under it. **5.26× less light leaves the tile**, from moving one number;
 * - and the built-in zero says this is the stage and not the glass: at the
 *   design wavelength, where the nominal stage is nearly right, the nominal tile
 *   already leaks 1.169%, and the red one 1.137%.
 *
 * Thickness is the small term next to that. Corrected, a 0.016 mm specimen leaks
 * 1.867% and a 0.24 mm one 2.123% — **0.26 points against axial colour's 8** —
 * so "a thick specimen bleeds further, so guard it more" is the wrong instinct
 * on this branch. § 6bh.4 pins the ordering.
 *
 * **And the readout that ranks it already ships.** Nine configurations spanning
 * colour, correction and thickness put `maxGridPhaseStepWaves` and the escaped
 * fraction in the *same order*, with the jump between them landing exactly at
 * § 6bd.8's half-wave knee. So a caller sizes a guard band from a number every
 * render has carried since § 6i, without the double-extent second render that
 * measuring the escape would cost.
 *
 * ## The ruler is the anchor tile's bluest plane, and the pitch is a span
 *
 * A tile centre is an image-plane point and carries no wavelength; a *pitch* is
 * a span, and a span is a ruler. `mosaic-spectrum` settled the rule on the
 * brightfield branch and it is transplanted verbatim: read the pitch on the
 * anchor tile's ruler plane and nowhere else.
 *
 * What makes it load-bearing here is § 6be.8, whose open half this closes: a
 * frame's `halfExtentMm` is **∝ λ exactly** — 0.20536540701879996 mm at 430 nm
 * against 0.3134317885528963 at 656.2725, a ratio of 1.5262 against the
 * wavelengths' own 1.5262 — so one tile centre is a different amount of specimen
 * in every channel. The planes are already on the bluest one's ruler when a tile
 * comes back from `fluorescenceSpectralVolume`, so the composed picture inherits
 * that ruler and the redder planes are over-guarded, by the closed form in
 * `effectiveGuardCells`.
 *
 * The pitch is **uniform**, on § 6o.4's licence and not on an assumption: each
 * tile reads its own ruler and the rulers drift in parts per million across a
 * field (0.0032088344846687494 mm/px on the axis against 0.0032099623729887165
 * at 4 mm), so the abutment fixed point sits ~1e-3 of a pixel from the uniform
 * pitch. `fluorescenceMosaicPitchDriftPx` measures it rather than asserting it.
 *
 * ## The seam has a focus STEP, and it is a field quantity
 *
 * Each tile is corrected at its own centre's field height, so the two sides of a
 * seam are the same physical place corrected to two stage positions one tile
 * apart. That is a **step** and not a gradient — nothing is blended across a
 * seam, following § 6o — and § 6bh.5 measures it where § 6bg.8 measured the
 * in-frame tilt: it is a field quantity, vanishing on the axis where the focus
 * surface is flat and reaching a third of a depth of focus at the field edge.
 */

/** Which plane's grid the picture is on, and what that costs the others. */
export interface FluorescenceMosaicPlane {
  readonly nm: number;
  /** The anchor tile's own frame at this wavelength — its own λ, its own trace. */
  readonly frame: ObjectFieldFrame;
  /** `rulerPixelScaleMm / this plane's` — ≤ 1, and exactly 1 for the ruler. */
  readonly resampleRatio: number;
  /**
   * Cells between the kept span's edge and this plane's own wrap boundary.
   *
   * `(pupilSamples/2)·(1 − keptPixels·resampleRatio/size)` — minimised at the
   * ruler plane, where it is `guardCells + croppedPixels·pupilSamples/size`, and
   * strictly larger everywhere else. § 6t's ordering, re-derived on a branch
   * whose planes are stacked before this module sees them, which is why the
   * form carries `keptPixels` rather than `usefulPixels`.
   */
  readonly effectiveGuardCells: number;
}

export interface FluorescenceMosaicGeometry {
  /** The anchor tile's planes, in `samples` order. */
  readonly planes: readonly FluorescenceMosaicPlane[];
  /** Index into `planes` of the plane whose grid the picture is on. */
  readonly rulerIndex: number;
  readonly rulerWavelengthNm: number;
  /** Tiles per axis. */
  readonly tilesPerAxis: number;
  /** Grid each plane is rendered at, guard included. */
  readonly tileSize: number;
  /** Side of a tile's stacked grid — `tileSize − 2·croppedPixels`. */
  readonly stackedSize: number;
  /** Pixels of guard dropped from each edge of the stacked grid. */
  readonly guardPixels: number;
  readonly guardCells: number;
  /** Pixels kept from each tile per axis — `stackedSize − 2·guardPixels`. */
  readonly keptPixels: number;
  /** Side of the composed picture, in pixels. */
  readonly size: number;
  /** Image-plane mm per pixel of the composed picture — the ruler plane's. */
  readonly pixelScaleMm: number;
  /** Object-plane mm per pixel on the ruler plane's linear reference. */
  readonly objectPixelScaleMm: number;
  /** Image-plane spacing of tile centres (mm) — `keptPixels · pixelScaleMm`. */
  readonly pitchMm: number;
  /** The anchor: the mosaic's centre, and the only place the pitch is read. */
  readonly centreMm: { readonly x: number; readonly y: number };
  /** Tile centres (mm), row-major from −x, −y — what the renderer is handed. */
  readonly centresMm: readonly { readonly x: number; readonly y: number }[];
}

export interface FluorescenceMosaicOptions
  extends Omit<FocusCorrectedTilesOptions, "centresMm" | "onTile"> {
  /** Tiles per axis. `1` is one tile and reduces to `focusCorrectedTiles`. */
  readonly tiles: number;
  /**
   * Resolution cells of grid discarded from each edge of every tile.
   *
   * A resolution cell is `size / pupilSamples` pixels, so this is the physical
   * variable and the pixel count follows — `mosaicGuardPixels`, shared with the
   * brightfield branch rather than restated, which is what makes a guard here
   * the same quantity § 6o measured. What it has to contain is **not** § 6o's
   * quantity: see the header, and § 6bh.4.
   */
  readonly guardCells: number;
  /**
   * Centre of the whole mosaic (mm). Defaults to the axis.
   *
   * An even `tiles` puts no tile on the anchor, which is legal and is the case
   * that catches a mosaic built from tile corners instead of tile centres.
   */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /** Called once per tile finished, for progress against a cost in minutes. */
  readonly onTile?: (
    done: number,
    total: number,
    centreMm: { readonly x: number; readonly y: number },
  ) => void;
}

export interface FluorescenceMosaicTile extends FocusCorrectedTile {
  readonly col: number;
  readonly row: number;
  /** Pixel offset of this tile's kept span within the composed picture. */
  readonly originPx: { readonly x: number; readonly y: number };
}

export interface FluorescenceMosaic {
  readonly geometry: FluorescenceMosaicGeometry;
  readonly tiles: readonly FluorescenceMosaicTile[];
  /**
   * The composed picture, one plane per wavelength on the ruler's grid.
   *
   * Shaped as a `FluorescenceSpectralStack` so that `colorImageFromStack` takes
   * it unchanged — a mosaic is a bigger picture and not a different kind of one.
   * Each plane's `intensity` is `size × size`; every other field is the anchor
   * tile's, because they describe the ruler the picture is on and that is read
   * on the anchor and nowhere else.
   */
  readonly composed: FluorescenceSpectralStack;
  /** Exposures the whole series is, summed over tiles — `focusCorrectedTiles`'s. */
  readonly exposures: number;
  /** Widest stage travel the series asked for (mm). */
  readonly stageSpreadMm: number;
  /** Max over every tile and plane — the worst kernel the picture carries. */
  readonly maxGridPhaseStepWaves: number;
}

/** The trace options an anchor frame is built with, per wavelength. */
function anchorFrame(
  system: OpticalSystem,
  options: FluorescenceMosaicOptions,
  centreMm: { readonly x: number; readonly y: number },
  nm: number,
): ObjectFieldFrame {
  return objectFieldTile(system, { ...options, centreMm, wavelengthNm: nm });
}

/**
 * Where each tile sits and how much of it survives the crop — no imaging.
 *
 * Costs one trace per wavelength and nothing else, so a caller can price a
 * mosaic, or lay one out and render its tiles elsewhere, without forming an
 * image. `renderFluorescenceMosaic` calls this and then `focusCorrectedTiles`.
 */
export function fluorescenceMosaicGeometry(
  system: OpticalSystem,
  options: FluorescenceMosaicOptions,
): FluorescenceMosaicGeometry {
  const { tiles, size, pupilSamples, samples, guardCells } = options;
  if (!Number.isInteger(tiles) || tiles < 1) {
    throw new Error(`fluorescenceMosaicGeometry: tiles must be a positive integer, got ${tiles}`);
  }
  if (samples.length === 0) {
    throw new Error("fluorescenceMosaicGeometry: no wavelengths");
  }
  const centreMm = options.centreMm ?? { x: 0, y: 0 };
  const croppedPixels = options.stack?.croppedPixels ?? 1;
  const stackedSize = size - 2 * croppedPixels;

  // The guard is `mosaicGuardPixels`'s, on the RENDERED grid — the same cells
  // § 6o measured — and it is then taken off the STACKED grid, which is smaller
  // by the ruler crop. Passing the stacked size here instead would make a guard
  // of n cells a different number of pixels than it is on the brightfield
  // branch, which is the one thing sharing the helper is for.
  const { guardPixels } = mosaicGuardPixels(
    { size, pupilSamples, guardCells },
    "fluorescenceMosaicGeometry",
  );
  const keptPixels = stackedSize - 2 * guardPixels;
  if (keptPixels < 1) {
    throw new Error(
      `fluorescenceMosaicGeometry: a guard of ${guardCells} cells is ${guardPixels} px per edge, ` +
        `which leaves ${keptPixels} of the ${stackedSize}-px stacked tile ` +
        `(${size} rendered, ${croppedPixels} px per edge to the common ruler)`,
    );
  }

  const frames = samples.map((s) => anchorFrame(system, options, centreMm, s.nm));
  // The ruler is the smallest-scaled plane — the bluest — which is the choice
  // `stackSpectralPlanes` already made for the tile. Found by scale and not by
  // wavelength so that the two cannot disagree if the ordering ever could.
  let rulerIndex = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.pixelScaleMm < frames[rulerIndex]!.pixelScaleMm) rulerIndex = i;
  }
  const ruler = frames[rulerIndex]!;

  const planes: FluorescenceMosaicPlane[] = frames.map((frame, i) => {
    const resampleRatio = ruler.pixelScaleMm / frame.pixelScaleMm;
    return {
      nm: samples[i]!.nm,
      frame,
      resampleRatio,
      effectiveGuardCells: (pupilSamples / 2) * (1 - (keptPixels * resampleRatio) / size),
    };
  });

  const pitchMm = keptPixels * ruler.pixelScaleMm;
  const half = (tiles - 1) / 2;
  const centresMm: { x: number; y: number }[] = [];
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      centresMm.push({
        x: centreMm.x + (col - half) * pitchMm,
        y: centreMm.y + (row - half) * pitchMm,
      });
    }
  }

  return {
    planes,
    rulerIndex,
    rulerWavelengthNm: samples[rulerIndex]!.nm,
    tilesPerAxis: tiles,
    tileSize: size,
    stackedSize,
    guardPixels,
    guardCells,
    keptPixels,
    size: tiles * keptPixels,
    pixelScaleMm: ruler.pixelScaleMm,
    objectPixelScaleMm: ruler.objectPixelScaleMm,
    pitchMm,
    centreMm,
    centresMm,
  };
}

/**
 * What a uniform pitch costs against the abutment fixed point, in pixels.
 *
 * `mosaicPitchDriftPx`'s quantity on this branch: the uniform pitch is read on
 * the anchor tile's ruler plane, and each tile's own ruler differs from it by
 * the parts-per-million drift § 6m.4 measured, so the centres a fixed-point
 * abutment would have chosen are not quite these. Positive by construction, and
 * a diagnostic a caller asks for rather than something every mosaic pays: it
 * costs one extra trace per tile.
 *
 * The fixed point is walked outward from the anchor, exactly as `mosaicLayout`
 * does, so the anchor tile itself has drift 0 by definition.
 */
export function fluorescenceMosaicPitchDriftPx(
  system: OpticalSystem,
  options: FluorescenceMosaicOptions,
): number {
  const geometry = fluorescenceMosaicGeometry(system, options);
  const { keptPixels, centreMm, tilesPerAxis, rulerWavelengthNm, pixelScaleMm } = geometry;
  const spanOf = (x: number): number =>
    keptPixels *
    anchorFrame(system, options, { x, y: centreMm.y }, rulerWavelengthNm).pixelScaleMm;

  const half = (tilesPerAxis - 1) / 2;
  const abutting = new Float64Array(tilesPerAxis);
  const seed = tilesPerAxis % 2 === 1 ? [(tilesPerAxis - 1) / 2] : [tilesPerAxis / 2 - 1, tilesPerAxis / 2];
  if (tilesPerAxis % 2 === 1) abutting[seed[0]!] = 0;
  else {
    const halfSpan = (keptPixels / 2) * pixelScaleMm;
    abutting[seed[0]!] = -halfSpan;
    abutting[seed[1]!] = halfSpan;
  }
  const walk = (from: number, step: number): void => {
    for (let k = from + step; k >= 0 && k < tilesPerAxis; k += step) {
      let x = abutting[k - step]! + step * keptPixels * pixelScaleMm;
      const prevSpan = spanOf(centreMm.x + abutting[k - step]!);
      for (let i = 0; i < 8; i++) {
        const next = abutting[k - step]! + (step * (prevSpan + spanOf(centreMm.x + x))) / 2;
        if (next === x) break;
        x = next;
      }
      abutting[k] = x;
    }
  };
  walk(seed[0]!, -1);
  walk(seed[seed.length - 1]!, +1);

  let worst = 0;
  for (let k = 0; k < tilesPerAxis; k++) {
    const uniform = (k - half) * geometry.pitchMm;
    worst = Math.max(worst, Math.abs(uniform - abutting[k]!) / pixelScaleMm);
  }
  return worst;
}

/** Copy the kept centre of one tile plane into the composed grid. */
function placeKept(
  dst: Float64Array,
  dstSize: number,
  src: Float64Array,
  srcSize: number,
  guardPixels: number,
  keptPixels: number,
  originX: number,
  originY: number,
): void {
  for (let r = 0; r < keptPixels; r++) {
    const srcRow = (guardPixels + r) * srcSize + guardPixels;
    const dstRow = (originY + r) * dstSize + originX;
    for (let c = 0; c < keptPixels; c++) dst[dstRow + c] = src[srcRow + c]!;
  }
}

/**
 * Render a mosaic of focus-corrected fluorescence tiles and compose them.
 *
 * `fluorescenceMosaicGeometry` places the tiles; `focusCorrectedTiles` renders
 * them, **unchanged and un-forked**, which is what keeps § 6bg's claim that the
 * correction and the composition are separable true in the code as well as in
 * the prose; and this crops each tile's stacked planes to the kept span and lays
 * them side by side. Nothing is blended across a seam and nothing is resampled a
 * second time — a tile's kept pixels are its own, following § 6o, so a seam
 * error is a step and can be measured as one.
 *
 * A one-tile mosaic's tile is `focusCorrectedTiles`'s tile cropped by hand, bit
 * for bit (§ 6bh.1).
 */
export function renderFluorescenceMosaic(
  system: OpticalSystem,
  density: SpectralVolumeEmitterDensity,
  options: FluorescenceMosaicOptions,
): FluorescenceMosaic {
  const geometry = fluorescenceMosaicGeometry(system, options);
  const { guardPixels, keptPixels, size, tilesPerAxis } = geometry;

  const rendered = focusCorrectedTiles(system, density, {
    ...options,
    centresMm: geometry.centresMm,
    ...(options.onTile === undefined ? {} : { onTile: options.onTile }),
  });

  const anchorTile = rendered.tiles[Math.floor(rendered.tiles.length / 2)]!;
  const planeCount = anchorTile.volume.planes.length;
  const composed = Array.from({ length: planeCount }, () => new Float64Array(size * size));

  const tiles: FluorescenceMosaicTile[] = rendered.tiles.map((tile, i) => {
    const col = i % tilesPerAxis;
    const row = (i - col) / tilesPerAxis;
    const originPx = { x: col * keptPixels, y: row * keptPixels };
    for (let p = 0; p < planeCount; p++) {
      const plane = tile.volume.planes[p]!;
      placeKept(
        composed[p]!,
        size,
        plane.intensity,
        tile.volume.size,
        guardPixels,
        keptPixels,
        originPx.x,
        originPx.y,
      );
    }
    return { ...tile, col, row, originPx };
  });

  let maxGridPhaseStepWaves = 0;
  for (const tile of tiles) {
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, tile.volume.maxGridPhaseStepWaves);
  }

  // Everything but the pixels is the anchor tile's, because everything but the
  // pixels describes the ruler the picture is on, and that is read on the anchor
  // and nowhere else — `mosaicTileAt`'s rule, one layer up.
  const template = anchorTile.volume;
  const planes: VolumePlane[] = template.planes.map((p, i) => ({
    ...p,
    intensity: composed[i]!,
  }));

  return {
    geometry,
    tiles,
    composed: { ...template, size, planes },
    exposures: rendered.exposures,
    stageSpreadMm: rendered.stageSpreadMm,
    maxGridPhaseStepWaves,
  };
}

export type { TileStageMm };
