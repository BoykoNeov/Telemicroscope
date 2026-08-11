import { commensurateSource } from "@telemicroscope/core/illumination";
import {
  atWavelength,
  colorImageFromStack,
  mosaicLayout,
  mosaicTileAt,
  renderMosaicTile,
  renderSpectralMosaicTile,
  spectralMosaicGeometry,
  spectralMosaicTileAt,
  toSrgbBytes,
  type MosaicOptions,
  type BrightfieldSpectralStack,
  type SpectralMosaicGeometry,
  type SpectralMosaicOptions,
} from "@telemicroscope/core/imaging";
import { spectralXyz } from "@telemicroscope/core/photometry";
import { objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem, WavelengthSample } from "@telemicroscope/core/trace";
import { LAMBDA_NM, specKey } from "./microscope";
import { buildMicroscope, type BuildSpec } from "./builder";
import { refused, type Refused } from "./refusal";
import { lampSamples, type LampKind } from "./section";
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
  readonly spec: BuildSpec;
  readonly specimen: SpecimenKind;
  /** Frequency bins across the pupil diameter — the tile's width, in cells. */
  readonly pupilSamples: number;
  /** Tile grid, a power of two. Two pixels per cell is what the panel affords. */
  readonly size: number;
  /** Resolution cells discarded from each edge of every tile (§ 6o). */
  readonly guardCells: number;
  /** S = NA_cond/NA_obj. Must make `S·pupilSamples` a whole number (§ 6p). */
  readonly coherenceParameter: number;
  /**
   * Wavelengths across 400–700 nm, or `0` for the monochrome stage.
   *
   * Zero rather than one, and the distinction is the point: `1` would be a
   * one-wavelength *spectral* stage, which is a legitimate and different thing
   * (it still takes the ruler crop, so its tiles are 2 px narrower). Zero is
   * § 6t's other branch — the d-line mono path A7 landed with, untouched, so
   * turning colour off gives back exactly the picture that panel pinned.
   */
  readonly wavelengths: number;
  readonly lamp: LampKind;
}

/** One tile of the stage, by its anchored index (§ 6o.8). */
export interface StageTileRequest extends StageRequest {
  readonly col: number;
  readonly row: number;
}

const SYSTEMS = new Map<string, OpticalSystem>();

/**
 * Built once per worker per objective — a stage asks for tens of tiles and the
 * prescription does not change between them.
 *
 * Keyed by `specKey` since Part F, not by the spec object: a structured clone
 * arrives as a fresh object every message, so identity would miss every time,
 * and the field order a key is built from has to be fixed in code rather than
 * inherited from whatever the sender constructed.
 */
function systemFor(spec: BuildSpec): OpticalSystem {
  const key = specKey(spec);
  const hit = SYSTEMS.get(key);
  if (hit) return hit;
  const system = buildMicroscope(spec).system;
  SYSTEMS.set(key, system);
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

/** The same stage, one plane per wavelength — § 6t. */
function spectralOptionsOf(request: StageRequest): SpectralMosaicOptions {
  return {
    size: request.size,
    pupilSamples: request.pupilSamples,
    guardCells: request.guardCells,
    samples: lampSamples(request.lamp, request.wavelengths),
  };
}

/**
 * The anchor's spectral geometry, memoized per worker.
 *
 * `spectralMosaicTileAt` needs the anchor's ruler plane to read the pitch off,
 * which costs one trace **per wavelength**; a stage asks for tens of tiles and
 * the anchor does not move between them. The mono path pays the same twice-per-
 * tile price (`mosaicTileAt` traces the anchor and the tile) and is left alone,
 * because at one wavelength it is one trace and § 6o.8's rungs run on it.
 */
const GEOMETRIES = new Map<string, SpectralMosaicGeometry>();

function geometryFor(request: StageRequest, system: OpticalSystem): SpectralMosaicGeometry {
  const id = `${specKey(request.spec)}|${request.size}|${request.pupilSamples}|${request.guardCells}|${request.wavelengths}|${request.lamp}`;
  const hit = GEOMETRIES.get(id);
  if (hit) return hit;
  const geometry = spectralMosaicGeometry(system, spectralOptionsOf(request));
  GEOMETRIES.set(id, geometry);
  return geometry;
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
  /**
   * The plane whose grid the picture is on, and what the guard really was in
   * each plane's own cells — § 6t.3. `null` on the monochrome stage.
   *
   * On screen because the panel already prints the guard and § 6t measured that
   * the number asked for is the number only ONE plane gets: the ruler's. A stage
   * that printed "guard 4 cells" over a picture whose red plane had 8 would be
   * printing a third of the answer, which is the sentence § 6o's own readout
   * exists to avoid.
   */
  readonly ruler: {
    readonly wavelengthNm: number;
    readonly planes: readonly { readonly nm: number; readonly guardCells: number }[];
  } | null;
  readonly elapsedMs: number;
}

export type StageInfoResult =
  | { readonly ok: true; readonly info: StageInfo }
  | Refused;

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
    const system = systemFor(request.spec);
    const source = commensurateSource(request.coherenceParameter, request.pupilSamples, 1);
    // The two branches read the SAME quantities off different layouts, and the
    // one that differs is the one that matters: a spectral tile keeps
    // 2·rulerCropPixels fewer pixels (§ 6t.4), so the pitch, the span and the
    // viewport all move when colour goes on. Sharing `usefulPixels` between the
    // branches would tile the colour stage on the mono lattice and register
    // every tile 2 px wrong — the failure § 6t's own refusals are about.
    const common =
      request.wavelengths === 0
        ? (() => {
            const layout = mosaicLayout(system, optionsOf(request));
            return {
              usefulPixels: layout.usefulPixels,
              tilePixels: layout.tileSize,
              objectPixelScaleMm: layout.objectPixelScaleMm,
              magnification: Math.abs(layout.tiles[0]!.frame.magnification),
              ruler: null,
            };
          })()
        : (() => {
            const geometry = geometryFor(request, system);
            return {
              usefulPixels: geometry.usefulPixels,
              tilePixels: geometry.tileSize,
              objectPixelScaleMm: geometry.objectPixelScaleMm,
              magnification: Math.abs(geometry.planes[geometry.rulerIndex]!.frame.magnification),
              ruler: {
                wavelengthNm: geometry.rulerWavelengthNm,
                planes: geometry.planes.map((p) => ({
                  nm: p.nm,
                  guardCells: p.effectiveGuardCells,
                })),
              },
            };
          })();

    return {
      ok: true,
      info: {
        usefulPixels: common.usefulPixels,
        tilePixels: common.tilePixels,
        tileSpanUm: common.usefulPixels * common.objectPixelScaleMm * 1000,
        objectPixelNm: common.objectPixelScaleMm * 1e6,
        tracedNA: objectNumericalAperture(system, LAMBDA_NM),
        magnification: common.magnification,
        fieldMm: FIELD_NUMBER_MM / common.magnification,
        sourcePoints: source.points.length,
        ruler: common.ruler,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return refused(cause);
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
  /** Which wavelength the verdict belongs to — § 6r.7's blue end, by name. */
  readonly verdictNm: number | null;
  readonly contributingPoints: number;
  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

export type StageTileResult =
  | { readonly ok: true; readonly readout: StageTileReadout }
  | (Refused & { readonly col: number; readonly row: number });

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
 * The exposure a colour tile is encoded at — a property of the **lamp** and of
 * nothing else, which is the one place a colour stage could have gone wrong
 * invisibly.
 *
 * A9 exposes each frame on **its own** mean, which is right for one frame and is
 * exactly the bug `toGrey` above warns about: per-tile exposure paints a
 * brightness step at every seam, a grid the physics does not have. So the
 * exposure here is a property of the **lamp** and of nothing else.
 *
 * `colorImageFromStack` folds the observer through the plane weights, so a clear
 * field — intensity 1 in every plane, which `abbeImage`'s Σ = 1 normalization
 * guarantees at any condenser — images as the lamp's own XYZ. Dividing by
 * `WHITE_INTENSITY · Y_lamp` therefore puts a clear field at exactly the same
 * mid-grey the monochrome stage puts it at, tile after tile, and white is still
 * `WHITE_INTENSITY` times a clear field.
 *
 * **Not white-balanced**, deliberately: a tungsten lamp's field is warm because
 * the lamp is warm, and § 6r's whole content is that the colour in the picture is
 * the specimen's and the objective's and the lamp's. Balancing it away here would
 * hide one of the three. The gamma is `toSrgbBytes`'s, the app's only one, which
 * is why a colour tile is not a pixel-for-pixel lightening of the grey one.
 */
export function clearFieldExposure(samples: readonly WavelengthSample[]): number {
  // The samples the image was FORMED with, which are `stack.samples` and not the
  // lamp the request named: `stackBrightfieldPlanes` normalizes the weights to
  // Σ = 1 and `colorImageFromStack` folds *those* into its basis, so a white
  // computed from the raw SED×Δλ weights is larger by their sum — 300 for three
  // equal-energy samples across 400–700 nm — and every tile comes back 300× too
  // dark. Which is what the first version of this did, and what `stage.test.ts`
  // caught on its first run: an exposure is only meaningful against the weights
  // the image was actually formed with, so this function takes them.
  const white = spectralXyz(
    samples,
    samples.map(() => 1),
  );
  return white.y > 0 ? 1 / (WHITE_INTENSITY * white.y) : 1;
}

function toColour(stack: BrightfieldSpectralStack): Uint8ClampedArray {
  return toSrgbBytes(colorImageFromStack(stack), {
    exposure: clearFieldExposure(stack.samples),
  });
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
    const system = systemFor(request.spec);
    const source = commensurateSource(request.coherenceParameter, request.pupilSamples, 1);

    if (request.wavelengths > 0) {
      const options = spectralOptionsOf(request);
      const geometry = geometryFor(request, system);
      const tile = spectralMosaicTileAt(system, options, request.col, request.row, geometry);
      const formed = renderSpectralMosaicTile(
        system,
        specimenOf(request.specimen).specimen,
        source,
        { ...options, patches: 1, radialMapNodes: RADIAL_MAP_NODES },
        tile,
        geometry,
      );
      return {
        ok: true,
        readout: {
          col: request.col,
          row: request.row,
          rgba: toColour(formed.stack),
          size: formed.size,
          objectCentreMm: tile.objectCentreMm,
          verdict: formed.fidelity.verdict,
          verdictReason: formed.fidelity.reason,
          verdictNm: formed.verdictNm,
          contributingPoints: formed.contributingPoints,
          maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
          elapsedMs: performance.now() - started,
        },
      };
    }

    const options = optionsOf(request);
    const tile = mosaicTileAt(system, options, request.col, request.row);
    const formed = renderMosaicTile(
      system,
      // The monochrome stage, unchanged: the specimen's spectrum is bound off at
      // the d line here and nothing below this line learns one exists —
      // `atWavelength` is that seam, and it is why promoting the library to
      // `SpectralSpecimen` for A9 left this panel's picture alone. § 6t did not
      // touch it either, which is why turning colour off gives back A7's picture
      // rather than a three-plane stack that happens to look grey.
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
        verdictNm: null,
        contributingPoints: formed.contributingPoints,
        maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // The engine's own words again: a design ceiling, a guard that is not whole
    // pixels, `abbeImage`'s frequency-grid wall, or a chief ray that reaches no
    // object height at this field position — which is a real outcome far out.
    return { ...refused(cause), col: request.col, row: request.row };
  }
}
