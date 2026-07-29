import { commensurateSource } from "@telemicroscope/core/illumination";
import {
  atWavelength,
  mosaicLayout,
  mosaicTileAt,
  renderMosaicTile,
  type MosaicOptions,
} from "@telemicroscope/core/imaging";
import { objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { entryOf, LAMBDA_NM, type MicroscopeKind } from "./microscope";
import { specimenOf, type SpecimenKind } from "./specimens";

/**
 * The stage — APP.md's A7, as pure functions.
 *
 * `microscope.ts`'s commitment kept once more: numbers in, numbers out, no DOM
 * and no React, so the expensive half drops into a worker unchanged (and does —
 * `stage.worker.ts`, several of them at once).
 *
 * ## What is different about this surface, and it is the whole of Part D
 *
 * Every other microscope panel forms ONE frame, and § 6h.2's closed form says
 * that frame spans `pupilSamples` resolution cells whatever the grid does — 93.5
 * µm at 4×/0.10 and 2.6 µm at 100×/1.40, a detail crop that raising the grid
 * cannot widen. A field of view is therefore reached by **tiling**, which is
 * § 6m–§ 6p, and this is the surface those four steps were built for.
 *
 * ## A tile's identity is its index, not the viewport
 *
 * The composed plane is unbounded and anchored at the axis: tile `(i, j)` sits at
 * `(i, j)·pitch` with the pitch read on the anchor tile and nowhere else, which
 * is `mosaicTileAt`. That is what makes `(i, j)` a cache key a pan may be served
 * from — § 6o.8 pins the tile bitwise against the one `renderMosaic` composes,
 * and measures what re-anchoring on the viewport would cost instead: 3.4e-3 px
 * of ruler drift on a tile centre, but **16 px** a third of a tile off it, which
 * is the whole picture jumping on every pan.
 *
 * ## Cost, measured here rather than inherited
 *
 * D0.1 priced a tile at 76 ms (ps 32 / grid 128, ideal pupil, imaging only) and
 * Part D's arithmetic was built on that. On a **traced** tile with § 6p's cache
 * the imaging is no longer the bill: at grid 128 / ps 32 the Abbe sum is 180 ms
 * and `rasterizeSpecimen` is **1 001 ms** — 5.6× more, because § 6n's warped grid
 * bisects a traced chief ray per pixel to mantissa exhaustion. At grid 64 it is
 * 292 ms against 61 ms. So the tile size the stage can afford is set by the
 * *rasterizer*, not by the transform, and the panel renders at 2 px per
 * resolution cell for that reason — the same sampling § 6o's own probe used, and
 * the finest `abbeImage` admits at S = 1.
 *
 * That was Part D's own prediction arriving on schedule ("the feasibility number
 * will turn out to be measuring something else"), and it named the next
 * optimisation: § 6n deferred a cache for the radial map and attributed it to
 * § 6p, which landed as the *pupil* cache instead.
 *
 * **That cache is now built (§ 6s) and this panel takes it**, at
 * `RADIAL_MAP_NODES`. The inverse chief-ray map is one-dimensional, so a tile's
 * pixels are queries of a single curve: 65 chief-ray inversions for the table
 * against 4 096 for this tile's pixels.
 *
 * **Measured here, on this panel's own request** — DIN 4×/0.10, ps 32, grid 64,
 * guard 4, S = 0.5, the 208-direction commensurate source — a tile goes
 * **293 ms → 45 ms, 6.46×**, and the two pictures differ by 9.9e-15. Which is
 * the third correction to this panel's cost model in as many steps, and it lands
 * where D0.1 had it before D4 moved it: **the Abbe sum is the bill again**, and
 * a stage tile is now ~45 ms of transform rather than ~290 ms of bisection. The
 * tile size the stage can afford is set by the imaging once more, so the 2 px
 * per resolution cell below is a sampling choice rather than a rasterizer
 * budget.
 */

/** The DIN field number a finished microscope delivers, in mm of intermediate
 * image — a **convention** (ISO 8039 eyepiece field numbers run 18–26.5), not
 * an engine number, and quoted as such wherever the stage says what fraction of
 * a real field it covers. 18 is the standard-eyepiece value the 160 mm tube was
 * specified around. */
export const FIELD_NUMBER_MM = 18;

/** Display convention: intensity 1 — a clear field — is mid-grey, white is 2. */
export const WHITE_INTENSITY = 2;

/**
 * Intervals in the tabulated radial map each tile's raster runs on (§ 6s).
 *
 * 64 is generous by three orders and deliberately so: § 6s.2 measures the table
 * at the f64 rounding floor from 32 nodes up, and even **8** nodes place a pixel
 * to 6e-11 of a pixel — nine orders below § 6o.8's 3.4e-3 px of ruler drift.
 * What the extra nodes cost is 65 chief-ray inversions against a tile's 16 384,
 * so there is nothing here worth economising on and the number is chosen to be
 * obviously past the floor rather than tuned to it.
 */
export const RADIAL_MAP_NODES = 64;

export interface StageRequest {
  readonly kind: MicroscopeKind;
  readonly specimen: SpecimenKind;
  /** Frequency bins across the pupil diameter — the tile's width, in cells. */
  readonly pupilSamples: number;
  /** Tile grid, a power of two. Two pixels per cell is what the panel affords. */
  readonly size: number;
  /** Resolution cells discarded from each edge of every tile (§ 6o). */
  readonly guardCells: number;
  /** S = NA_cond/NA_obj. Must make `S·pupilSamples` a whole number (§ 6p). */
  readonly coherenceParameter: number;
}

/** One tile of the stage, by its anchored index (§ 6o.8). */
export interface StageTileRequest extends StageRequest {
  readonly col: number;
  readonly row: number;
}

const SYSTEMS = new Map<MicroscopeKind, OpticalSystem>();

/** Built once per worker per objective — a stage asks for tens of tiles and the
 * prescription does not change between them. */
function systemFor(kind: MicroscopeKind): OpticalSystem {
  const hit = SYSTEMS.get(kind);
  if (hit) return hit;
  const system = entryOf(kind).build();
  SYSTEMS.set(kind, system);
  return system;
}

function optionsOf(request: StageRequest): MosaicOptions {
  return {
    tiles: 1,
    size: request.size,
    pupilSamples: request.pupilSamples,
    guardCells: request.guardCells,
    wavelengthNm: LAMBDA_NM,
  };
}

/** What the stage is, before any tile of it exists. */
export interface StageInfo {
  /** Pixels kept per tile per axis — the pitch of the composed plane. */
  readonly usefulPixels: number;
  /** The whole tile, guard included, as rendered and mostly thrown away. */
  readonly tilePixels: number;
  /** Object µm across one tile's KEPT span — what a tile buys. */
  readonly tileSpanUm: number;
  /** Object nm per pixel of the composed plane, on the anchor's linear ruler. */
  readonly objectPixelNm: number;
  /** The traced NA the span is set by. */
  readonly tracedNA: number;
  readonly magnification: number;
  /** FIELD_NUMBER_MM / |M| — the real field, on a stated convention (mm). */
  readonly fieldMm: number;
  /** Illumination directions the commensurate condenser holds at this S. */
  readonly sourcePoints: number;
  readonly elapsedMs: number;
}

export type StageInfoResult =
  | { readonly ok: true; readonly info: StageInfo }
  | { readonly ok: false; readonly error: string };

/**
 * The stage's own numbers — one trace, and the condenser it will be summed over.
 *
 * `mosaicLayout` at `tiles: 1` is the idiom § 6o.5 pins (a one-tile mosaic IS
 * `objectFieldTile`, bitwise), and it is viewport-independent by construction:
 * every quantity below is read on the anchor, which is where `mosaicTileAt`
 * reads its pitch.
 */
export function stageInfo(request: StageRequest): StageInfoResult {
  const started = performance.now();
  try {
    const system = systemFor(request.kind);
    const layout = mosaicLayout(system, optionsOf(request));
    const source = commensurateSource(request.coherenceParameter, request.pupilSamples, 1);
    const magnification = Math.abs(layout.tiles[0]!.frame.magnification);
    return {
      ok: true,
      info: {
        usefulPixels: layout.usefulPixels,
        tilePixels: layout.tileSize,
        tileSpanUm: layout.usefulPixels * layout.objectPixelScaleMm * 1000,
        objectPixelNm: layout.objectPixelScaleMm * 1e6,
        tracedNA: objectNumericalAperture(system, LAMBDA_NM),
        magnification,
        fieldMm: FIELD_NUMBER_MM / magnification,
        sourcePoints: source.points.length,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}

export interface StageTileReadout {
  readonly col: number;
  readonly row: number;
  /** Greyscale RGBA of the KEPT span, `size`×`size`. */
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  /** Object-plane centre of this tile (mm) — where on the specimen you are. */
  readonly objectCentreMm: { readonly x: number; readonly y: number };
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly contributingPoints: number;
  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

export type StageTileResult =
  | { readonly ok: true; readonly readout: StageTileReadout }
  | { readonly ok: false; readonly col: number; readonly row: number; readonly error: string };

export interface StageTileJob {
  readonly seq: number;
  readonly request: StageTileRequest;
}

export interface StageTileDone {
  readonly seq: number;
  readonly result: StageTileResult;
}

/**
 * Greyscale on a **fixed** white level, and the fixed part is load-bearing.
 *
 * A2 puts mid-grey at the frame's own mean, which is right for one frame and
 * would be a bug here: every tile's mean is a little different, so normalizing
 * per tile would paint a brightness step at every seam — a grid the physics does
 * not have, laid over the seam error § 6o measures. `abbeImage` normalizes the
 * source weights to Σ = 1, so a clear field is intensity 1 whatever the
 * condenser does, and that is an absolute reference the whole plane can share.
 */
function toGrey(intensity: Float64Array, size: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((255 * intensity[i]!) / WHITE_INTENSITY);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * Render one tile of the stage.
 *
 * Two traces for the tile (`mosaicTileAt`: the anchor's ruler and this tile's),
 * then § 6n's warped raster and § 6f's Abbe sum through this tile's own traced
 * pupils. Measured on the DIN 4×/0.10 at grid 64 / ps 32 with a 208-direction
 * commensurate condenser: **~350 ms**, of which the raster was ~290. **Since
 * § 6s that half is a table lookup and the same tile measures ~45 ms** — the
 * Abbe sum, and almost nothing else. See the header.
 */
export function renderStageTile(request: StageTileRequest): StageTileResult {
  const started = performance.now();
  try {
    const system = systemFor(request.kind);
    const options = optionsOf(request);
    const tile = mosaicTileAt(system, options, request.col, request.row);
    const source = commensurateSource(request.coherenceParameter, request.pupilSamples, 1);
    const formed = renderMosaicTile(
      system,
      // The stage is monochrome, so the specimen's spectrum is bound off at the
      // d line here and nothing below this line learns one exists — `atWavelength`
      // is that seam, and it is why promoting the library to `SpectralSpecimen`
      // for A9 left this panel's picture alone.
      atWavelength(specimenOf(request.specimen).specimen, LAMBDA_NM),
      source,
      { ...options, patches: 1, radialMapNodes: RADIAL_MAP_NODES },
      tile,
    );
    return {
      ok: true,
      readout: {
        col: request.col,
        row: request.row,
        rgba: toGrey(formed.intensity, formed.size),
        size: formed.size,
        objectCentreMm: tile.frame.centreObjectMm,
        verdict: formed.fidelity.verdict,
        verdictReason: formed.fidelity.reason,
        contributingPoints: formed.contributingPoints,
        maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // The engine's own words again: a design ceiling, a guard that is not whole
    // pixels, `abbeImage`'s frequency-grid wall, or a chief ray that reaches no
    // object height at this field position — which is a real outcome far out.
    return { ok: false, col: request.col, row: request.row, error: (cause as Error).message };
  }
}
