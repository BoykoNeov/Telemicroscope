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
 * § 6bj qualifies that sentence rather than retracting it. A scanner's focus map
 * and this are the same corrector, and what drives them is not the same thing: a
 * mosaic that walks the tile across the field racks the stage because best focus
 * moves with field radius, while one that moves the SLIDE has every tile at one
 * field position and therefore no field term at all — so its map can only be
 * tracking the specimen's own topography. `TileStageQuery.offsetMm` is the
 * coordinate that makes the second one writable, and `offsetsMm` is the option
 * that builds it.
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

/** The stage at home — shared so an unmoved tile carries one object, not many. */
const ORIGIN = { x: 0, y: 0 } as const;

/** What the stage is being asked for. One call per tile per wavelength. */
export interface TileStageQuery {
  /** Image-plane centre of the tile (mm) — the same one `centresMm` gave. */
  readonly centreMm: { readonly x: number; readonly y: number };
  /**
   * Object-plane radius this channel's frame centre looks at (mm), from that
   * channel's own traced map — see the header on why it is not one number.
   */
  readonly objectHeightMm: number;
  /**
   * How far the **specimen** was translated for this tile (object mm), `{0, 0}`
   * unless the caller passed `offsetsMm`.
   *
   * Required rather than optional, and the reason is § 6bj. Under a
   * stage-scanning mosaic every tile is imaged at the *same* field position, so
   * `centreMm` and `objectHeightMm` are the same numbers in every tile and the
   * only thing left to key a focus map on would be `tileIndex` — an index into
   * an ordering this callback cannot see. A focus map that tracks the
   * specimen's own topography, which is what a real scanner's is, is a function
   * of **where on the slide** the stage is, and this is that coordinate.
   */
  readonly offsetMm: { readonly x: number; readonly y: number };
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
  /**
   * How far to translate the **specimen** for each tile (object mm) — a stage.
   *
   * Omitted, the specimen does not move and every tile sees the same object
   * through a different part of the field, which is what this function has
   * always done. Supplied, tile k's density is read at `(x + dx, y + dy)`, so a
   * caller can hold `centresMm` still and scan the stage instead — § 6bj's
   * geometry, and the one a real slide scanner has.
   *
   * A tile whose offset is exactly `{0, 0}` — including every tile of a series
   * that passed none — is handed the caller's own density **by reference** and
   * not a wrapper that adds zero. That is what keeps a field scan bitwise
   * (§ 6bj.1) and it is not pedantry: `-0 + 0` is `+0`, so a wrapper adding zero
   * is not the identity on a density that reads the sign of its argument.
   */
  readonly offsetsMm?: readonly { readonly x: number; readonly y: number }[];
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
  /** How far the specimen was translated for this tile (object mm). */
  readonly offsetMm: { readonly x: number; readonly y: number };
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
 * about the pupil, the map or the raster is shared — unless `offsetsMm` is what
 * moves between tiles, which holds the frames at ONE position and makes every
 * clause of that sentence false (§ 6bj.7). The economy is still not taken here:
 * taking it would fork this function, and the bitwise reductions § 6bh, § 6bi and
 * § 6bj.1 all rest on it not being forked. `renderSpectralMosaic` does
 * have one — its radial tables span all its tiles at once — and it is the one
 * thing that could have been shared here too, which is noted rather than taken,
 * because a per-tile stage gives every tile a different raster anyway.
 */
export function focusCorrectedTiles(
  system: OpticalSystem,
  density: SpectralVolumeEmitterDensity,
  options: FocusCorrectedTilesOptions,
): FocusCorrectedTiles {
  const { centresMm, samples, offsetsMm } = options;
  if (centresMm.length === 0) {
    throw new Error("focusCorrectedTiles: no tiles to render");
  }
  if (samples.length === 0) {
    throw new Error("focusCorrectedTiles: no wavelengths");
  }
  if (offsetsMm !== undefined && offsetsMm.length !== centresMm.length) {
    throw new Error(
      `focusCorrectedTiles: ${centresMm.length} tile centres and ${offsetsMm.length} stage ` +
        `offsets — a tile is one visit of the stage, so it has exactly one of each`,
    );
  }

  const tiles: FocusCorrectedTile[] = [];
  let exposures = 0;
  let lo = Infinity;
  let hi = -Infinity;

  for (let index = 0; index < centresMm.length; index++) {
    const centreMm = centresMm[index]!;
    const offsetMm = offsetsMm?.[index] ?? ORIGIN;
    // Exactly zero means the caller's own density, by reference — see
    // `offsetsMm`. It is also the CENTRE tile of an odd stage scan, which is why
    // that tile is the plain render bit for bit (§ 6bj.2).
    const shifted: SpectralVolumeEmitterDensity =
      offsetMm.x === 0 && offsetMm.y === 0
        ? density
        : (xMm, yMm, zMm, nm) => density(xMm + offsetMm.x, yMm + offsetMm.y, zMm, nm);
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
        offsetMm,
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

    const volume = fluorescenceSpectralVolume(system, shifted, {
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
      offsetMm,
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
