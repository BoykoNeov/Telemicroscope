import type { OpticalSystem } from "../trace/system";
import { objectFieldTile } from "./object-field";
import { predictedFocusMm, type FocusSurface } from "./focus-surface";
import {
  fluorescenceSpectralVolume,
  type FluorescenceSpectralVolume,
  type FluorescenceVolumeOptions,
  type SpectralVolumeEmitterDensity,
} from "./spectral-volume";

/**
 * § 6bg — the focus correction applied, tile by tile.
 *
 * § 6bf returns where the stage has to be for each colour and each field point
 * and closed by saying that nothing renders with it. Two things do now:
 * `channelFocusMm` on `fluorescenceSpectralVolume` takes a stage per channel,
 * and this takes one per **tile**, which is where § 6be.7 says the correction
 * first pays.
 *
 * ## Why the tile is the unit and the patch is not
 *
 * Field curvature moves best focus across the field, so a wide picture is out of
 * focus away from wherever the stage was set. § 6be.3 measures the spread over
 * the catalogued field of the ladder's 4× at 0.250229 mm — 5.79 depths of focus
 * — against 0.017685 mm, 0.409 of one, across a single frame (§ 6be.7). The
 * ratio is the whole design argument: **14× of the problem lives between tiles
 * and 1× inside one**, because one frame is 0.103 mm of specimen against a field
 * 2.2 mm across.
 *
 * And the part inside a frame is not correctable even in principle. A frame is
 * one exposure at one stage position; `focusMm` is a scalar in the rasterizer
 * because a stage is a scalar in the world. A patched render *carries* the
 * in-frame tilt — each patch is imaged through its own traced pupil, which is
 * why § 6be.7 could measure it — but carrying it is not removing it, and no
 * patch count removes it. What a stage can do is be racked between tiles, which
 * is what a slide scanner's focus map is, and what this is.
 *
 * ## What this is NOT
 *
 * **It is not a mosaic.** It renders a list of tiles, each at its own predicted
 * stage, and hands them back as a list. It does not compose them: there is no
 * guard band, no common ruler, no pitch. `mosaic-spectrum` does all of that on
 * the brightfield branch, where a 2-D specimen map has no focus to correct, and
 * the fluorescence branch has no mosaic at all — "the mosaic is still where the
 * field lives" stays open exactly where § 6bf left it. This is the correction,
 * not the composition, and the two are separable precisely because the stage is
 * a per-tile scalar.
 *
 * **It is not one exposure.** Every tile is a separate visit of the stage, and
 * under a per-channel correction so is every channel of every tile, so
 * `exposures` is a count of acquisitions and not a figure of merit. See
 * `channelFocusMm`.
 *
 * ## The height a tile is corrected at is per wavelength
 *
 * A tile's centre is an image-plane point and carries no wavelength, but the
 * object point it looks at does: the inverse chief-ray map is traced per λ, so
 * one tile centre is a slightly different object radius in each channel —
 * 2.503e-3 mm of it across 433 nm to 656 nm at a radius of 1.0 mm, which is
 * § 6ba.9's lateral colour seen from the object side. So the stage callback is
 * asked once per (tile, wavelength) with **that** channel's own radius, read off
 * the very frame the render will use. It is a small correction to a correction —
 * § 6bg.8 measures what it moves the predicted stage by — and it costs one extra
 * frame per plane, which is a trace against `patches² × slices` convolutions.
 */

/** What the stage is being asked for. One call per tile per wavelength. */
export interface TileStageQuery {
  /** Image-plane centre of the tile (mm) — the same one `centresMm` gave. */
  readonly centreMm: { readonly x: number; readonly y: number };
  /**
   * Object-plane radius this channel's frame centre looks at (mm), from that
   * channel's own traced map — see the header on why it is not one number.
   */
  readonly objectHeightMm: number;
  readonly wavelengthNm: number;
  readonly tileIndex: number;
}

/** Where to put the stage. Required: a default would choose the correction. */
export type TileStageMm = (query: TileStageQuery) => number;

/**
 * The join: a swept surface, read as a stage for any tile and any channel.
 *
 * `predictedFocusMm` with the query unpacked, and the only place in the engine
 * where a § 6bf readout becomes a § 6bg render. Written as a function of the
 * surface rather than inlined so that the seam has a name and a doc comment: a
 * caller who wants a different correction — a measured autofocus, a stored map,
 * a flat stage as a control — writes their own `TileStageMm` and the renderer
 * neither knows nor cares.
 *
 * It refuses outside the swept box, which is `predictedFocusMm`'s refusal
 * arriving where it is useful: a tile list that reaches past the field the
 * surface was swept over fails at the tile that does, naming it, rather than
 * rendering it against an extrapolated stage.
 */
export function surfaceStage(surface: FocusSurface): TileStageMm {
  return (query) => predictedFocusMm(surface, query.wavelengthNm, query.objectHeightMm);
}

export interface FocusCorrectedTilesOptions
  extends Omit<FluorescenceVolumeOptions, "centreMm" | "focusMm" | "channelFocusMm"> {
  /** Image-plane tile centres (mm), in the order they are to be rendered. */
  readonly centresMm: readonly { readonly x: number; readonly y: number }[];
  /** Where the stage goes for each tile and each channel. */
  readonly stageMm: TileStageMm;
  /** Called once per tile finished. */
  readonly onTile?: (
    done: number,
    total: number,
    centreMm: { readonly x: number; readonly y: number },
  ) => void;
}

export interface FocusCorrectedTile {
  readonly index: number;
  readonly centreMm: { readonly x: number; readonly y: number };
  /** Object radius per channel, in `samples` order — λ-dependent, see the header. */
  readonly objectHeightMm: readonly number[];
  /** The stage each channel of this tile was rendered at (mm), in `samples` order. */
  readonly focusMm: readonly number[];
  /** Distinct stage positions this tile needed — 1 unless the stage moved per channel. */
  readonly exposures: number;
  readonly volume: FluorescenceSpectralVolume;
}

export interface FocusCorrectedTiles {
  readonly tiles: readonly FocusCorrectedTile[];
  /**
   * Exposures the whole series is, summed over tiles.
   *
   * Summed and not counted distinct: two tiles that happen to want the same
   * stage are still two visits, because between them the stage moved laterally
   * and the picture is of somewhere else. This is the number that says what an
   * acquisition would have cost, and it is `centresMm.length` for the ordinary
   * case of one stage per tile.
   */
  readonly exposures: number;
  /** Widest stage travel the series asked for (mm) — max minus min over every tile. */
  readonly stageSpreadMm: number;
}

/**
 * Render a list of tiles, each at the stage its own field position wants.
 *
 * One `fluorescenceSpectralVolume` per tile, unchanged in every other respect,
 * so a one-tile series at a flat stage is the plain render it always was
 * (§ 6bg.1, bitwise). The cost is that render's times the tile count and there
 * is no economy in it: the frames are at different field positions, so nothing
 * about the pupil, the map or the raster is shared. `renderSpectralMosaic` does
 * have one — its radial tables span all its tiles at once — and it is the one
 * thing that could have been shared here too, which is noted rather than taken,
 * because a per-tile stage gives every tile a different raster anyway.
 */
export function focusCorrectedTiles(
  system: OpticalSystem,
  density: SpectralVolumeEmitterDensity,
  options: FocusCorrectedTilesOptions,
): FocusCorrectedTiles {
  const { centresMm, samples } = options;
  if (centresMm.length === 0) {
    throw new Error("focusCorrectedTiles: no tiles to render");
  }
  if (samples.length === 0) {
    throw new Error("focusCorrectedTiles: no wavelengths");
  }

  const tiles: FocusCorrectedTile[] = [];
  let exposures = 0;
  let lo = Infinity;
  let hi = -Infinity;

  for (let index = 0; index < centresMm.length; index++) {
    const centreMm = centresMm[index]!;
    const objectHeightMm: number[] = [];
    const focusMm: number[] = [];
    // Keyed by wavelength because that is all `channelFocusMm` is handed; the
    // frames are built here rather than inside the render so that the height the
    // stage was chosen at is a readout and not a repeated derivation.
    const byNm = new Map<number, number>();
    for (const sample of samples) {
      const frame = objectFieldTile(system, { ...options, centreMm, wavelengthNm: sample.nm });
      const height = Math.hypot(frame.centreObjectMm.x, frame.centreObjectMm.y);
      const stage = options.stageMm({
        centreMm,
        objectHeightMm: height,
        wavelengthNm: sample.nm,
        tileIndex: index,
      });
      if (!Number.isFinite(stage)) {
        throw new Error(
          `focusCorrectedTiles: tile ${index} at (${centreMm.x}, ${centreMm.y}) mm asked for ` +
            `stage ${stage} at ${sample.nm} nm — a focus map must return a stage position`,
        );
      }
      objectHeightMm.push(height);
      focusMm.push(stage);
      byNm.set(sample.nm, stage);
      if (stage < lo) lo = stage;
      if (stage > hi) hi = stage;
    }

    const volume = fluorescenceSpectralVolume(system, density, {
      ...options,
      centreMm,
      channelFocusMm: (nm) => {
        const stage = byNm.get(nm);
        if (stage === undefined) {
          throw new Error(
            `focusCorrectedTiles: no stage was chosen for ${nm} nm — the render asked for a ` +
              `wavelength that was not in the samples this series was built from`,
          );
        }
        return stage;
      },
    });

    tiles.push({
      index,
      centreMm,
      objectHeightMm,
      focusMm,
      exposures: volume.exposures,
      volume,
    });
    exposures += volume.exposures;
    options.onTile?.(index + 1, centresMm.length, centreMm);
  }

  return { tiles, exposures, stageSpreadMm: hi - lo };
}
