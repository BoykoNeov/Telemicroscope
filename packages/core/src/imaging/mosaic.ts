import type { AimOptions } from "../pupil/aiming";
import type { OpticalSystem } from "../trace/system";
import type { CondenserSource } from "../illumination/source";
import type { BrightfieldFidelity, BrightfieldVerdict } from "../illumination/fidelity";
import { renderBrightfield } from "./brightfield";
import {
  objectFieldTile,
  tracedFieldPupils,
  type FieldPupilOptions,
  type ObjectFieldFrame,
} from "./object-field";
import { rasterizeSpecimen, type Specimen } from "./specimen";

/**
 * The mosaic — § 6h.2's closed form taken to its conclusion.
 *
 * A brightfield frame spans `pupilSamples` resolution cells whatever the grid
 * does, so a real field is reached by **tiling** and never by widening: § 6m put
 * a tile at an arbitrary field position, § 6n warped its grid so two tiles agree
 * about where the specimen is, and this lays them beside one another.
 *
 * ## The guard band is the grid's own edge, moved out of the picture
 *
 * A `Specimen` is a callback (§ 6n), so nothing crops it — what crops is the
 * **grid**, which is finite, and `abbeImage` is a transform, so the specimen
 * outside the grid is not absent but *wrapped*. Either way the image near the
 * edge is formed from the wrong neighbourhood. The guard band is the answer and
 * it is entirely mechanical: render a tile whose grid runs `guardCells` beyond
 * the span that will be kept, and keep only the centre.
 *
 * What that costs is measured rather than argued, and the measurement is the
 * step's substance — see `guardCells` and § 6o in VALIDATION.md.
 *
 * ## The pitch is not the span, and the solve is skipped on purpose
 *
 * Each tile reads its own ruler at its own centre (§ 6m), so tile k's useful
 * span in millimetres is `usefulPixels · pixelScaleMm_k` and the two neighbours
 * of a seam do not agree about it. Exact abutment is therefore a fixed point,
 * not an arithmetic: centre_{k+1} = centre_k + (span_k + span_{k+1})/2, whose
 * right-hand side depends on the centre being solved for.
 *
 * It is skipped, on § 6m's own measurement: the ruler's drift across a field is
 * parts per million, so a **uniform** pitch off the axial tile's scale differs
 * from the fixed point by ~1e-3 of a pixel at millimetres of field. That number
 * is reported as `pitchDriftPx` rather than assumed — a mosaic is allowed to be
 * uniform because the drift was measured, and § 6o.4 pins it.
 *
 * ## What is deliberately not attempted
 *
 * A mosaic under a **non-telecentric** condenser. § 6h hands every patch the
 * same `CondenserSource` with its points centred on the pupil, which says the
 * illumination cone stays centred at every field point; a real condenser's cone
 * tilts off axis. `shiftPupil` is already the operator that would do it, and it
 * is § 6a's object-space ray-aiming blocker arriving where it finally bites.
 */

/** How a mosaic's tile centres are spaced. */
export type MosaicPitch =
  /**
   * One pitch for the whole mosaic, read off the tile nearest the axis.
   *
   * The default, and the header says why: the fixed point it approximates is
   * ~1e-3 of a pixel away, which `mosaicPitchDriftPx` reports.
   */
  | "uniform"
  /**
   * Each tile's span read on its own ruler, abutted to its neighbour's — the
   * fixed point itself, iterated to convergence.
   *
   * Exposed because the *drift* is only meaningful against something, and this
   * is that something. It costs one extra trace per tile per iteration.
   */
  | "abutting";

export interface MosaicOptions extends FieldPupilOptions {
  /** Tiles per axis. `1` is one tile and reduces to `objectFieldTile`. */
  readonly tiles: number;
  /** Grid size of each tile, a power of two — as in `objectFieldFrame`. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /**
   * Resolution cells of grid discarded from each edge of every tile.
   *
   * A resolution cell is `size / pupilSamples` pixels — § 6h.2's reciprocity,
   * the same statement as "pupilSamples cells across the frame" — so this is
   * the physical variable and the pixel count follows from the lattice.
   *
   * **Measured, at § 6o.1–§ 6o.3.** The error a crop makes is set by how far
   * the impulse response reaches, weighted by the illumination's own coherence:
   * under a *coherent* source it falls only as `guard^(−1/2)` — the tail
   * integral of the Airy amplitude, and no guard makes a tile exact — while a
   * filled condenser converges far faster. There is no guard that is right for
   * every S, which is why this is a parameter with a measurement attached
   * rather than a constant.
   */
  readonly guardCells: number;
  readonly wavelengthNm?: number;
  readonly probeHeightMm?: number;
  /** Default `"uniform"`; see `MosaicPitch`. */
  readonly pitch?: MosaicPitch;
  /**
   * Image-plane centre of the whole mosaic (mm). Defaults to the axis.
   *
   * An even `tiles` puts no tile on the axis, which is legal and is the case
   * that catches a mosaic built from tile *corners* instead of tile centres.
   */
  readonly centreMm?: { readonly x: number; readonly y: number };
}

export interface MosaicTile {
  /**
   * Column and row of this tile, in whichever frame of reference produced it:
   * `0`-based from −x, −y out of `mosaicLayout`, and **signed about the anchor**
   * out of `mosaicTileAt`, where `(0, 0)` is the anchor tile itself.
   */
  readonly col: number;
  readonly row: number;
  readonly frame: ObjectFieldFrame;
  /**
   * Pixel offset of this tile's kept span, in the same frame of reference as
   * `col`/`row` — within the composed image for a layout, and signed from the
   * anchor tile's own top-left for `mosaicTileAt`.
   */
  readonly originPx: { readonly x: number; readonly y: number };
}

export interface MosaicLayout {
  readonly tiles: readonly MosaicTile[];
  /** Tiles per axis. */
  readonly tilesPerAxis: number;
  /** Grid size of each tile, guard included. */
  readonly tileSize: number;
  /** Pixels discarded from each edge of a tile — `guardCells · size/ps`. */
  readonly guardPixels: number;
  readonly guardCells: number;
  /** Pixels kept from each tile per axis — `tileSize − 2·guardPixels`. */
  readonly usefulPixels: number;
  /** Side of the composed image, in pixels. */
  readonly size: number;
  /** Image-plane mm per pixel, on the tile nearest the axis. */
  readonly pixelScaleMm: number;
  /** Object-plane mm per pixel, on that tile's linear reference. */
  readonly objectPixelScaleMm: number;
  readonly pitch: MosaicPitch;
  /** Image-plane spacing of tile centres (mm) — the uniform pitch. */
  readonly pitchMm: number;
}

/** What the crop keeps and what it throws away, in pixels. Both callers' rule. */
function guardOf(
  options: MosaicOptions,
  who: string,
): { guardPixels: number; usefulPixels: number } {
  const { size, pupilSamples, guardCells } = options;
  if (!(guardCells >= 0)) {
    throw new Error(`${who}: guardCells must be >= 0, got ${guardCells}`);
  }
  const pixelsPerCell = size / pupilSamples;
  const guardPixels = guardCells * pixelsPerCell;
  // Refused rather than rounded, on `latticeMatchedSource`'s argument: a guard
  // rounded to the nearest pixel produces a perfectly plausible mosaic whose
  // seam error is not the one the caller asked for, and nothing downstream can
  // tell the difference. The caller is told which knob to move.
  if (!Number.isInteger(guardPixels)) {
    throw new Error(
      `${who}: a guard of ${guardCells} cells is ${guardPixels} pixels at size ${size} ` +
        `and pupilSamples ${pupilSamples} (${pixelsPerCell} px per resolution cell) — ` +
        `choose a guard, size or pupilSamples that makes it whole rather than having it rounded`,
    );
  }
  const usefulPixels = size - 2 * guardPixels;
  if (usefulPixels < 1) {
    throw new Error(
      `${who}: a guard of ${guardCells} cells eats the whole ${size}-pixel tile ` +
        `(${guardPixels} px per edge leaves ${usefulPixels})`,
    );
  }
  return { guardPixels, usefulPixels };
}

/** The per-tile trace options, assembled once so the two entry points share them. */
function tileOptions(options: MosaicOptions) {
  return {
    size: options.size,
    pupilSamples: options.pupilSamples,
    ...(options.wavelengthNm === undefined ? {} : { wavelengthNm: options.wavelengthNm }),
    ...(options.probeHeightMm === undefined ? {} : { probeHeightMm: options.probeHeightMm }),
    ...(options.traceSamples === undefined ? {} : { traceSamples: options.traceSamples }),
    ...(options.zernikeTerms === undefined ? {} : { zernikeTerms: options.zernikeTerms }),
    ...(options.aim === undefined ? {} : { aim: options.aim }),
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
    ...(options.spider === undefined ? {} : { spider: options.spider }),
  };
}

/**
 * Where each tile of a mosaic sits, and how much of it survives the crop.
 *
 * Traces one pupil per tile (each tile's own ruler, § 6m) and nothing else — the
 * imaging is `renderMosaic`'s. Separated so a caller can price a mosaic, or lay
 * one out and render its tiles in workers, without forming an image.
 */
export function mosaicLayout(system: OpticalSystem, options: MosaicOptions): MosaicLayout {
  const { tiles, size, guardCells } = options;
  if (!Number.isInteger(tiles) || tiles < 1) {
    throw new Error(`mosaicLayout: tiles must be a positive integer, got ${tiles}`);
  }
  const { guardPixels, usefulPixels } = guardOf(options, "mosaicLayout");

  const centre = options.centreMm ?? { x: 0, y: 0 };
  const common = tileOptions(options);
  const tileAt = (x: number, y: number): ObjectFieldFrame =>
    objectFieldTile(system, { ...common, centreMm: { x, y } });

  // The reference tile is the one nearest the axis: with an odd `tiles` that is
  // a tile centred on the mosaic's centre, and with an even one it is a corner
  // of the middle four. Its ruler is the mosaic's, so the composed image has a
  // single `pixelScaleMm` — one ruler for the picture, exactly as § 6h gives
  // one ruler per frame, and `pitchDrift` is what it costs.
  const half = (tiles - 1) / 2;
  const reference = tileAt(centre.x, centre.y);
  const pitchMm = usefulPixels * reference.pixelScaleMm;
  const pitch = options.pitch ?? "uniform";

  const offsets = new Float64Array(tiles);
  if (pitch === "uniform") {
    for (let k = 0; k < tiles; k++) offsets[k] = (k - half) * pitchMm;
  } else {
    // The fixed point, walked outward from the centre in both directions. Each
    // step abuts on the mean of the two tiles' own spans, and the tile being
    // placed is re-traced until its own span stops moving it. § 6m.1 measured
    // that this converges in three iterations; the loop allows eight and exits
    // on an exact repeat, so it costs what it needs and no more.
    const spanOf = (x: number): number => usefulPixels * tileAt(x, centre.y).pixelScaleMm;
    const seed = tiles % 2 === 1 ? [(tiles - 1) / 2] : [tiles / 2 - 1, tiles / 2];
    if (tiles % 2 === 1) offsets[seed[0]!] = 0;
    else {
      // No tile sits on the axis, so the innermost pair straddles it — each half
      // a span out, on the reference ruler, which is exactly where the uniform
      // pitch would put them.
      const halfSpan = (usefulPixels / 2) * reference.pixelScaleMm;
      offsets[seed[0]!] = -halfSpan;
      offsets[seed[1]!] = halfSpan;
    }
    const walk = (from: number, step: number): void => {
      for (let k = from + step; k >= 0 && k < tiles; k += step) {
        let x = offsets[k - step]! + step * usefulPixels * reference.pixelScaleMm;
        const prevSpan = spanOf(centre.x + offsets[k - step]!);
        for (let i = 0; i < 8; i++) {
          const next = offsets[k - step]! + (step * (prevSpan + spanOf(centre.x + x))) / 2;
          if (next === x) break;
          x = next;
        }
        offsets[k] = x;
      }
    };
    walk(seed[0]!, -1);
    walk(seed[seed.length - 1]!, +1);
  }

  const laid: MosaicTile[] = [];
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      laid.push({
        col,
        row,
        frame: tileAt(centre.x + offsets[col]!, centre.y + offsets[row]!),
        originPx: { x: col * usefulPixels, y: row * usefulPixels },
      });
    }
  }

  return {
    tiles: laid,
    tilesPerAxis: tiles,
    tileSize: size,
    guardPixels,
    guardCells,
    usefulPixels,
    size: tiles * usefulPixels,
    pixelScaleMm: reference.pixelScaleMm,
    objectPixelScaleMm: reference.objectPixelScaleMm,
    pitch,
    pitchMm,
  };
}

/**
 * One tile of an **unbounded** mosaic, indexed from the anchor rather than from
 * a corner — what a pannable stage is laid out on.
 *
 * `mosaicLayout` is a finite picture: it takes a tile count, reads its pitch off
 * the tile nearest *its own* centre, and hands back a grid indexed `0` upward. A
 * viewport that pans cannot be laid out that way, because the mosaic it belongs
 * to has no edges — and recentring the layout on the viewport would make the
 * pitch depend on where you happen to be looking, so the same piece of specimen
 * would land at two different places depending on how you arrived at it.
 *
 * So the anchor is the layout's `centreMm` and the indices are signed about it:
 * tile `(0, 0)` **is** the anchor tile, and tile `(i, j)` sits at
 * `anchor + (i, j)·pitch` with the pitch read on the anchor and nowhere else.
 * That makes `(i, j)` a legitimate cache key — the tile depends on the index and
 * the render parameters, and on nothing about the viewport that asked for it,
 * which § 6o.8 pins bitwise against `mosaicLayout`'s own tiles at two different
 * viewport sizes.
 *
 * `"abutting"` pitch is **not** available here and is refused rather than
 * approximated. The fixed point is walked outward from the centre of a finite
 * mosaic (see `mosaicLayout`), so it is defined by the tile count — exactly the
 * dependence this function exists to remove. § 6o.6's measurement is the licence:
 * the uniform pitch it would have to converge to sits ~1e-3 of a pixel away.
 *
 * Costs two traces: the anchor's (for the pitch) and this tile's.
 */
export function mosaicTileAt(
  system: OpticalSystem,
  options: MosaicOptions,
  col: number,
  row: number,
): MosaicTile {
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    throw new Error(`mosaicTileAt: col and row must be integers, got ${col}, ${row}`);
  }
  if ((options.pitch ?? "uniform") !== "uniform") {
    throw new Error(
      `mosaicTileAt: pitch "${options.pitch}" is a property of a finite mosaic — its fixed point ` +
        `is walked outward from the centre and therefore depends on the tile count, which is ` +
        `what an anchored index exists to remove. Use "uniform" (§ 6o.4: it is ~1e-3 of a pixel away).`,
    );
  }
  const { usefulPixels } = guardOf(options, "mosaicTileAt");
  const anchor = options.centreMm ?? { x: 0, y: 0 };
  const common = tileOptions(options);
  // The anchor's own ruler, and the same expression `mosaicLayout` uses — a
  // second one that merely agreed numerically would be free to drift.
  const pitchMm = usefulPixels * objectFieldTile(system, { ...common, centreMm: anchor }).pixelScaleMm;
  return {
    col,
    row,
    frame: objectFieldTile(system, {
      ...common,
      centreMm: { x: anchor.x + col * pitchMm, y: anchor.y + row * pitchMm },
    }),
    originPx: { x: col * usefulPixels, y: row * usefulPixels },
  };
}

/**
 * What a uniform pitch costs against the fixed point it approximates, in pixels.
 *
 * The whole content of "a mosaic's pitch is not its tile span", as one number.
 * Positive by construction — it is a maximum over tiles of |uniform − abutting|
 * divided by the reference pixel scale — and § 6o.4 pins that it is ~1e-3 of a
 * pixel at millimetres of field, which is why `"uniform"` is the default.
 *
 * Costs a second layout, so it is a diagnostic a caller asks for rather than
 * something every mosaic pays.
 */
export function mosaicPitchDriftPx(system: OpticalSystem, options: MosaicOptions): number {
  const uniform = mosaicLayout(system, { ...options, pitch: "uniform" });
  const abutting = mosaicLayout(system, { ...options, pitch: "abutting" });
  let worst = 0;
  for (let i = 0; i < uniform.tiles.length; i++) {
    const a = uniform.tiles[i]!.frame.centreMm;
    const b = abutting.tiles[i]!.frame.centreMm;
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y) / uniform.pixelScaleMm);
  }
  return worst;
}

export interface RenderMosaicOptions {
  /** Patches across each TILE, per axis — `renderBrightfield`'s own knob. */
  readonly patches?: number;
  /** Throw unless every patch of every tile rules `valid`. */
  readonly requireHonest?: boolean;
  /** Called once per tile finished, for progress against a cost in minutes. */
  readonly onTile?: (done: number, total: number) => void;
  readonly aim?: AimOptions;
}

export interface MosaicTileImage {
  readonly tile: MosaicTile;
  /** Side of `intensity`, in pixels — the layout's `usefulPixels`. */
  readonly size: number;
  /** The tile's KEPT span, guard already discarded. */
  readonly intensity: Float64Array;
  readonly fidelity: BrightfieldFidelity;
  readonly maxGridPhaseStepWaves: number;
  readonly contributingPoints: number;
}

/**
 * Render one tile, alone, and crop it — the unit `renderMosaic` is made of.
 *
 * A tile is formed from its own grid and nothing else (§ 6o's whole construction:
 * no blending across a seam, no resampling), so rendering one in isolation is not
 * an approximation of rendering the mosaic — it is the same arithmetic, and
 * § 6o.8 pins it **bit for bit** against the composed picture rather than close.
 * That is what licenses a stage to render tiles out of order, in workers, and to
 * keep them in a cache across pans.
 */
export function renderMosaicTile(
  system: OpticalSystem,
  specimen: Specimen,
  source: CondenserSource,
  options: MosaicOptions & RenderMosaicOptions,
  tile: MosaicTile,
): MosaicTileImage {
  const { guardPixels, usefulPixels } = guardOf(options, "renderMosaicTile");
  const { frame } = tile;
  // The crop comes from `options` and the pixels come from `tile`, so a tile laid
  // out under a different lattice would be cropped by the wrong amount and the
  // result would be a perfectly plausible picture of the wrong piece of specimen.
  // Refused rather than tolerated, `guardOf`'s own move one line up.
  if (frame.size !== options.size || frame.pupilSamples !== options.pupilSamples) {
    throw new Error(
      `renderMosaicTile: the tile was laid out at size ${frame.size} / pupilSamples ` +
        `${frame.pupilSamples} and is being rendered at ${options.size} / ${options.pupilSamples} ` +
        `— lay the tile out with the options it is rendered with`,
    );
  }
  const rasterOptions = options.aim === undefined ? {} : { aim: options.aim };
  const object = rasterizeSpecimen(system, frame, specimen, rasterOptions);
  const formed = renderBrightfield(object, tracedFieldPupils(system, frame, options), source, {
    pupilSamples: options.pupilSamples,
    scale: frame.scale,
    ...(options.patches === undefined ? {} : { patches: options.patches }),
    ...(options.requireHonest === undefined ? {} : { requireHonest: options.requireHonest }),
  });

  const intensity = new Float64Array(usefulPixels * usefulPixels);
  for (let y = 0; y < usefulPixels; y++) {
    const src = (y + guardPixels) * frame.size + guardPixels;
    for (let x = 0; x < usefulPixels; x++) {
      intensity[y * usefulPixels + x] = formed.intensity[src + x]!;
    }
  }
  return {
    tile,
    size: usefulPixels,
    intensity,
    fidelity: formed.fidelity,
    maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
    contributingPoints: formed.contributingPoints,
  };
}

export interface MosaicImage {
  readonly size: number;
  /** Intensity of the composed image, in the object's own coordinates. */
  readonly intensity: Float64Array;
  readonly layout: MosaicLayout;
  /** The WORST verdict across every patch of every tile — `renderBrightfield`'s. */
  readonly fidelity: BrightfieldFidelity;
  /** Max over tiles. */
  readonly maxGridPhaseStepWaves: number;
  /** Min over tiles: the tile whose source was worst represented. */
  readonly contributingPoints: number;
  readonly pixelScaleMm: number;
}

/**
 * Render a specimen across a mosaic and compose the tiles into one image.
 *
 * Per tile: `rasterizeSpecimen` on the tile's own warped grid (§ 6n),
 * `renderBrightfield` through its own traced pupils on its own ruler (§ 6m),
 * then the guard is discarded and what is left is written into the composed
 * image. Nothing is blended across a seam and nothing is resampled — a tile's
 * kept pixels are its own, which is what makes the seam error a step rather
 * than a smear, and § 6o.5 measures that step against a tile placed on the seam.
 *
 * **Cost is the mosaic's whole design problem.** One bisected chief ray per
 * pixel for the raster (§ 6n: 0.12 ms), plus `patches²` × source points × one
 * N² transform for the imaging, times `tiles²` — and the guard is paid for at
 * full price and thrown away, so a tile of 64 px with an 8-cell guard at
 * 2 px/cell keeps 36% of what it computes. D0's arithmetic is that a 4×'s real
 * 5 mm field is ~181 tiles; § 6p is what makes that minutes rather than hours.
 */
export function renderMosaic(
  system: OpticalSystem,
  specimen: Specimen,
  source: CondenserSource,
  options: MosaicOptions & RenderMosaicOptions,
): MosaicImage {
  const layout = mosaicLayout(system, options);
  const { usefulPixels, size } = layout;
  const intensity = new Float64Array(size * size);
  let fidelity: BrightfieldFidelity | null = null;
  let maxGridPhaseStepWaves = 0;
  let contributingPoints = Infinity;
  let done = 0;

  // `renderBrightfield`'s own ordering, one level up: a mosaic is not honest in
  // the tiles where it happens to be, so the verdict is the worst tile's.
  const rank: Record<BrightfieldVerdict, number> = {
    valid: 0,
    unknown: 1,
    "no-honest-image": 2,
  };

  for (const tile of layout.tiles) {
    const formed = renderMosaicTile(system, specimen, source, options, tile);
    if (fidelity === null || rank[formed.fidelity.verdict] > rank[fidelity.verdict]) {
      fidelity = formed.fidelity;
    }
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, formed.maxGridPhaseStepWaves);
    contributingPoints = Math.min(contributingPoints, formed.contributingPoints);

    for (let y = 0; y < usefulPixels; y++) {
      const dst = (tile.originPx.y + y) * size + tile.originPx.x;
      for (let x = 0; x < usefulPixels; x++) {
        intensity[dst + x] = formed.intensity[y * usefulPixels + x]!;
      }
    }
    options.onTile?.(++done, layout.tiles.length);
  }

  return {
    size,
    intensity,
    layout,
    fidelity: fidelity!,
    maxGridPhaseStepWaves,
    contributingPoints,
    pixelScaleMm: layout.pixelScaleMm,
  };
}
