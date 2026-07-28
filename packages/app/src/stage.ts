import { commensurateSource } from "@telemicroscope/core/illumination";
import {
  mosaicLayout,
  mosaicTileAt,
  renderMosaicTile,
  type MosaicOptions,
  type Specimen,
} from "@telemicroscope/core/imaging";
import { objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { entryOf, LAMBDA_NM, type MicroscopeKind } from "./microscope";

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
 * That is Part D's own prediction arriving on schedule ("the feasibility number
 * will turn out to be measuring something else"), and it names the next
 * optimisation: § 6n deferred a cache for the radial map and attributed it to
 * § 6p, which landed as the *pupil* cache instead. The map cache is still open,
 * and it is now the dominant cost of a traced tile.
 */

/** The DIN field number a finished microscope delivers, in mm of intermediate
 * image — a **convention** (ISO 8039 eyepiece field numbers run 18–26.5), not
 * an engine number, and quoted as such wherever the stage says what fraction of
 * a real field it covers. 18 is the standard-eyepiece value the 160 mm tube was
 * specified around. */
export const FIELD_NUMBER_MM = 18;

/** Display convention: intensity 1 — a clear field — is mid-grey, white is 2. */
export const WHITE_INTENSITY = 2;

export type SpecimenKind = "ruled" | "diatom" | "section";

export interface SpecimenEntry {
  readonly kind: SpecimenKind;
  readonly label: string;
  /** Why it is in the list; one line, and it is the teaching. */
  readonly note: string;
  readonly specimen: Specimen;
}

/** A raised-cosine edge — smooth over `w`, so nothing on screen is the grid's
 * own aliasing wearing a specimen's clothes. */
function ramp(d: number, w: number): number {
  if (d <= 0) return 0;
  if (d >= w) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * d) / w);
}

/** A deterministic hash — a stained section needs structure that is the same on
 * every tile that reaches it, and a seeded RNG walked per pixel would not be. */
function hash2(i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The specimens, authored in **object millimetres** (§ 6n: a `Specimen` is a
 * callback, and `rasterizeSpecimen` evaluates it at the point each pixel really
 * looks at, so the warp happens in the argument and nothing is resampled).
 *
 * They are pictures, not physics — no rung pins one — so they live in the app,
 * and each is a real absorption (amplitude in [0, 1]) rather than a phase
 * object, because § 6f's null is that brightfield transfers no phase at all and
 * A3 is the panel that spends it.
 */
export const SPECIMENS: readonly SpecimenEntry[] = [
  {
    kind: "ruled",
    label: "ruled grid, 20 µm",
    note: "§ 6n's bow, at field scale: a straight object line images CURVED, and a mosaic is where you can see it.",
    specimen: (x, y) => {
      // Distance in mm to the nearest ruling of a 20 µm square grid, then a
      // 1.5 µm line with a 1 µm soft edge — resolved by every objective in the
      // catalogue, so what changes across the picker is the field, not the line.
      const p = 0.02;
      const toLine = (u: number): number => {
        const frac = (u / p) % 1;
        return (0.5 - Math.abs((frac < 0 ? frac + 1 : frac) - 0.5)) * p;
      };
      const on = (d: number): number => 1 - ramp(d - 0.0015, 0.001);
      return { re: 1 - 0.85 * Math.max(on(toLine(x)), on(toLine(y))), im: 0 };
    },
  },
  {
    kind: "diatom",
    label: "diatoms, 60 µm",
    note: "The classic resolution test object: areolae on a polar lattice, crowding toward the centre.",
    specimen: (x, y) => {
      // Scattered on a 150 µm lattice rather than one on the axis, so panning
      // finds another instead of leaving the field empty — and each one is
      // turned by its own cell's hash, so the rays do not line up across the
      // stage and read as one periodic object.
      const p = 0.15;
      const ci = Math.floor(x / p);
      const cj = Math.floor(y / p);
      const cx = (ci + 0.2 + 0.6 * hash2(ci, cj)) * p;
      const cy = (cj + 0.2 + 0.6 * hash2(cj, ci + 5)) * p;
      const r = Math.hypot(x - cx, y - cy);
      const R = 0.03;
      if (r > R) return { re: 1, im: 0 };
      const theta = Math.atan2(y - cy, x - cx) + 6.283 * hash2(ci + 2, cj + 9);
      // 48 rays and rings of 3 µm pitch. The radial pitch is fixed and the
      // tangential one is 2πr/48 — 3.9 µm at the rim and 1.3 µm a third of the
      // way in — so one specimen carries a range of frequencies straddling the
      // 4×/0.10's own 2.94 µm Abbe limit rather than a single one.
      const ring = Math.cos((2 * Math.PI * r) / 0.003);
      const ray = Math.cos(48 * theta);
      const pore = 0.5 + 0.5 * ring * ray;
      const rim = 1 - ramp(R - r, 0.004);
      return { re: 1 - 0.8 * (0.35 + 0.5 * pore) * (1 - rim) - 0.7 * rim * (1 - ramp(R - r, 0.001)), im: 0 };
    },
  },
  {
    kind: "section",
    label: "stained section",
    note: "What a mosaic is for: structure with no periodicity, over more specimen than one frame holds.",
    specimen: (x, y) => {
      // Cells on a 25 µm lattice, each jittered and sized by its own hash, with
      // a darker nucleus — deterministic in the object plane, so two tiles that
      // reach the same cell draw the same cell.
      const p = 0.025;
      const ci = Math.floor(x / p);
      const cj = Math.floor(y / p);
      let stain = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          const cx = (i + 0.25 + 0.5 * hash2(i, j)) * p;
          const cy = (j + 0.25 + 0.5 * hash2(j, i + 7)) * p;
          const rad = (0.28 + 0.12 * hash2(i + 3, j + 11)) * p;
          const d = Math.hypot(x - cx, y - cy);
          stain = Math.max(stain, 0.45 * ramp(rad - d, 0.3 * rad));
          stain = Math.max(stain, 0.85 * ramp(0.4 * rad - d, 0.25 * rad));
        }
      }
      return { re: 1 - stain, im: 0 };
    },
  },
];

export function specimenOf(kind: SpecimenKind): SpecimenEntry {
  const entry = SPECIMENS.find((s) => s.kind === kind);
  if (!entry) throw new Error(`unknown specimen ${kind}`);
  return entry;
}

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
 * commensurate condenser: **~350 ms**, of which the raster is ~290.
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
      specimenOf(request.specimen).specimen,
      source,
      { ...options, patches: 1 },
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
