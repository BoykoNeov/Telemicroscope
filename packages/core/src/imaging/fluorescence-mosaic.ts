import type { OpticalSystem } from "../trace/system";
import { mosaicGuardPixels } from "./mosaic";
import { objectFieldTile, type ObjectFieldFrame } from "./object-field";
import {
  focusCorrectedTiles,
  type FocusCorrectedTile,
  type FocusCorrectedTilesOptions,
  type TileStageMm,
} from "./focus-tiles";
import type { EmitterPlane, FluorescenceSpectralStack } from "./emitter-spectrum";
import type { SpectralVolumeEmitterDensity } from "./spectral-volume";

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
 * **And the readout that ranks it already ships.** Seven configurations spanning
 * colour, correction and thickness put `maxGridPhaseStepWaves` and the escaped
 * fraction in the *same order*, with the jump between the two clusters straddling
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
 * frame's `halfExtentMm` is **∝ λ exactly** — on § 6bh's own tile,
 * 0.13691027134586664 mm at 430 nm against 0.20895452570193085 at 656.2725, whose
 * ratio is `Object.is`-equal to the wavelengths' own — so one tile centre is a
 * different amount of specimen in every channel. The planes are already on the bluest one's ruler when a tile
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
 * apart. That is a **step** and not a gradient — and § 6bh.5 measures it where
 * § 6bg.8 measured the in-frame tilt: it is a field quantity, vanishing on the
 * axis where the focus surface is flat (0.00416 of a depth of focus, under
 * § 6be.2's estimator floor) and reaching 0.15903 of one at 1 mm of field —
 * 38.2× more.
 *
 * ## § 6bi — the overlap, and why it comes out of the KEPT span
 *
 * `overlapPixels` lets neighbouring tiles share a band, which every tile then
 * carries a ramp across so the seam is a gradient rather than a step. It is
 * `undefined` by default and a mosaic without it is § 6bh's, bit for bit
 * (§ 6bi.1) — the pitch, the composed size and the tile origins are integer
 * expressions in `keptPixels − overlapPixels`, so a zero overlap is not a
 * neutral factor applied to the old arithmetic, it *is* the old arithmetic.
 *
 * **The band is taken out of what a tile keeps and never out of its guard.**
 * That is not bookkeeping: § 6bh.4 measured what is in a guard band, and at
 * 430 nm on the nominal stage it is 9.8% of a point emitter's light wrapped
 * back in from the far edge. Guard pixels are the contaminated ones — blending
 * them in would put the wrap into the picture with a weight rather than
 * discarding it, which is worse than the step it was meant to hide. So an
 * overlap costs tiles: the pitch falls to `keptPixels − overlapPixels`, so
 * covering one area costs `(1 − f)^−2` times as many exposures at an overlap
 * fraction f, and the guard is untouched.
 *
 * ## What a blend can and cannot do, and where the seam's real artifact is
 *
 * A ramp is a **partition of unity** — a rising weight and its own `1 − w`,
 * separable in x and y so that the four tiles meeting at a corner sum to one
 * as well — so it preserves a uniform picture to rounding (§ 6bi.5) and cannot
 * change the total light. What it does to the *sharpness* is the law of total
 * variance: a blended pixel is a mixture of two images of the same place taken
 * at two stage positions, so the mixture's second moment is
 * `w·M₂(A) + (1−w)·M₂(B) + w(1−w)·|Δcentroid|²`. § 6bg.6's centroid walk is the
 * Δ, and it is an odd-order field quantity — 109× larger at 1 mm of field than
 * on the axis — so the blend's own penalty is a *third* seam quantity that
 * vanishes on the axis and is worst at w = ½ (§ 6bi.6).
 *
 * And a blend is the wrong tool for the seam's biggest artifact, which § 6bh
 * did not measure. Two abutting tiles are lit through two pupils at two field
 * heights, so their brightness differs by the objective's own throughput
 * profile: on a featureless specimen the composed picture is a **staircase**,
 * 0.53% across a seam at 1 mm of field against 1.9e-6 on the axis (§ 6bi.2).
 * That is multiplicative and it *divides out* — see `mosaic-flat-field`, which
 * is the correction. A ramp only spreads it over the band.
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
  /** Pixels each plane loses per edge reaching the common ruler (§ 6r). */
  readonly croppedPixels: number;
  /** Pixels of guard dropped from each edge of the stacked grid. */
  readonly guardPixels: number;
  readonly guardCells: number;
  /** Pixels kept from each tile per axis — `stackedSize − 2·guardPixels`. */
  readonly keptPixels: number;
  /**
   * Pixels of kept span two neighbouring tiles share — `0` for an abutting
   * mosaic, which is § 6bh's and the default. Never taken from the guard.
   */
  readonly overlapPixels: number;
  /** Tile-centre spacing in pixels — `keptPixels − overlapPixels`. */
  readonly pitchPixels: number;
  /** Side of the composed picture, in pixels — `tiles·kept − (tiles−1)·overlap`. */
  readonly size: number;
  /** Image-plane mm per pixel of the composed picture — the ruler plane's. */
  readonly pixelScaleMm: number;
  /** Object-plane mm per pixel on the ruler plane's linear reference. */
  readonly objectPixelScaleMm: number;
  /** Image-plane spacing of tile centres (mm) — `pitchPixels · pixelScaleMm`. */
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
   * Pixels of **kept span** two neighbouring tiles share, blended with a ramp.
   *
   * `undefined` — the default — is § 6bh's abutting mosaic, bit for bit
   * (§ 6bi.1). Above zero, the pitch falls to `keptPixels - overlapPixels` and
   * every tile carries a linear ramp across each band it shares, separable in
   * x and y so the four tiles meeting at a corner still sum to one.
   *
   * **It comes out of the kept span and never out of the guard**, because
   * § 6bh.4 measured what is in a guard: at 430 nm on the nominal stage, 9.8%
   * of a point emitter's light wrapped back in from the opposite edge.
   * Blending that in with a weight is worse than the step it hides.
   *
   * What a ramp buys and what it does not is § 6bi.5 and § 6bi.6, and the seam
   * artifact it is *not* the tool for is § 6bi.2's brightness staircase, which
   * `mosaic-flat-field` divides out.
   */
  readonly overlapPixels?: number;
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
   *
   * Each plane's `intensity` is `size × size`, and every field describing the
   * **ruler** — `pixelScaleMm`, `sourcePixelScaleMm`, `resampleRatio`, `frame` —
   * is built from `geometry`'s own anchor frames rather than borrowed from a
   * rendered tile. The distinction is not cosmetic: with an EVEN tile count no
   * tile sits on the anchor at all, so there is no tile whose ruler is the
   * picture's, and taking one would make `composed.pixelScaleMm` disagree with
   * `geometry.pixelScaleMm` (§ 6bh.2's rung pins that they do not).
   *
   * The **per-tile** quantities a single volume carries — `focusMm`,
   * `inFocusFraction`, `patchThroughput`, `maxStretchDeparture` — are
   * deliberately NOT here. A mosaic has one per tile and no single value, and
   * § 6bg.5 is the standing warning about a readout quoted where its reference
   * has moved. They stay on `tiles[k].volume`, where they are true.
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
  const overlapPixels = options.overlapPixels ?? 0;
  if (!Number.isInteger(overlapPixels) || overlapPixels < 0) {
    throw new Error(
      `fluorescenceMosaicGeometry: overlapPixels must be a non-negative integer, got ${overlapPixels}`,
    );
  }
  const keptPixels = stackedSize - 2 * guardPixels;
  if (keptPixels < 1) {
    throw new Error(
      `fluorescenceMosaicGeometry: a guard of ${guardCells} cells is ${guardPixels} px per edge, ` +
        `which leaves ${keptPixels} of the ${stackedSize}-px stacked tile ` +
        `(${size} rendered, ${croppedPixels} px per edge to the common ruler)`,
    );
  }
  // The overlap is taken out of the KEPT span — see the option's own comment on
  // why never out of the guard — so the pitch is what is left of a tile once its
  // shared bands are removed. Integer arithmetic, so a zero overlap leaves the
  // pitch, the origins and the composed size as the expressions § 6bh had
  // rather than as a neutral factor applied to them.
  const pitchPixels = keptPixels - overlapPixels;
  if (pitchPixels < 1) {
    throw new Error(
      `fluorescenceMosaicGeometry: an overlap of ${overlapPixels} px leaves a pitch of ` +
        `${pitchPixels} px of the ${keptPixels}-px kept span — two tiles would advance by ` +
        `nothing, so the mosaic would cover no more field than one tile does`,
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

  const pitchMm = pitchPixels * ruler.pixelScaleMm;
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
    croppedPixels,
    guardPixels,
    guardCells,
    keptPixels,
    overlapPixels,
    pitchPixels,
    size: tiles * keptPixels - (tiles - 1) * overlapPixels,
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
  const { pitchPixels, centreMm, tilesPerAxis, rulerWavelengthNm, pixelScaleMm } = geometry;
  // The span two neighbours must agree about is the PITCH, not the kept span:
  // under an overlap the tiles are meant to share a band, and what has to abut
  // is what each tile advances by. With no overlap the two are the same number
  // and this is § 6bh's expression unchanged.
  const spanOf = (x: number): number =>
    pitchPixels *
    anchorFrame(system, options, { x, y: centreMm.y }, rulerWavelengthNm).pixelScaleMm;

  const half = (tilesPerAxis - 1) / 2;
  const abutting = new Float64Array(tilesPerAxis);
  const seed = tilesPerAxis % 2 === 1 ? [(tilesPerAxis - 1) / 2] : [tilesPerAxis / 2 - 1, tilesPerAxis / 2];
  if (tilesPerAxis % 2 === 1) abutting[seed[0]!] = 0;
  else {
    const halfSpan = (pitchPixels / 2) * pixelScaleMm;
    abutting[seed[0]!] = -halfSpan;
    abutting[seed[1]!] = halfSpan;
  }
  const walk = (from: number, step: number): void => {
    for (let k = from + step; k >= 0 && k < tilesPerAxis; k += step) {
      let x = abutting[k - step]! + step * pitchPixels * pixelScaleMm;
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

/**
 * The ramp one tile carries across its own kept span, on one axis.
 *
 * `1` everywhere except in a band it shares with a neighbour, where it rises
 * from a half-pixel inside the band to a half-pixel from its far edge. The
 * falling side is written as `1 − rising` **of the identical subexpression**,
 * so the two tiles sharing a band contribute weights that sum to one rather
 * than to two quotients that happen to agree — which is what makes § 6bi.5's
 * uniform-preservation a rounding figure and not a tolerance.
 *
 * An edge of the mosaic has no neighbour and so has no ramp: the outermost
 * tiles carry weight 1 out to the picture's own border.
 */
function rampWeights(
  keptPixels: number,
  overlapPixels: number,
  index: number,
  tilesPerAxis: number,
): Float64Array {
  const w = new Float64Array(keptPixels).fill(1);
  if (overlapPixels === 0) return w;
  for (let j = 0; j < overlapPixels; j++) {
    const rising = (j + 0.5) / overlapPixels;
    if (index > 0) w[j] = rising;
    if (index < tilesPerAxis - 1) w[keptPixels - overlapPixels + j] = 1 - rising;
  }
  return w;
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

/** `placeKept` with a separable ramp, accumulating where two tiles overlap. */
function blendKept(
  dst: Float64Array,
  dstSize: number,
  src: Float64Array,
  srcSize: number,
  guardPixels: number,
  keptPixels: number,
  originX: number,
  originY: number,
  wx: Float64Array,
  wy: Float64Array,
): void {
  for (let r = 0; r < keptPixels; r++) {
    const srcRow = (guardPixels + r) * srcSize + guardPixels;
    const dstRow = (originY + r) * dstSize + originX;
    const vy = wy[r]!;
    for (let c = 0; c < keptPixels; c++) {
      dst[dstRow + c] = dst[dstRow + c]! + wx[c]! * vy * src[srcRow + c]!;
    }
  }
}

/**
 * Lay one value per tile into the composed grid, through the picture's own ramp.
 *
 * What a mosaic of *constant* tiles would look like, and the reason it is here
 * rather than in `mosaic-flat-field`: the throughput flat field is exactly that
 * picture (§ 6bi.3), and a second copy of the blend would be a second chance for
 * the correction and the picture it corrects to disagree about where a seam is.
 * With no overlap it is a piecewise-constant staircase; with one it is that
 * staircase with each step ramped.
 */
export function composeTileScalars(
  geometry: FluorescenceMosaicGeometry,
  value: (col: number, row: number) => number,
): Float64Array {
  const { keptPixels, overlapPixels, pitchPixels, size, tilesPerAxis } = geometry;
  const out = new Float64Array(size * size);
  const ramps = Array.from({ length: tilesPerAxis }, (_, k) =>
    rampWeights(keptPixels, overlapPixels, k, tilesPerAxis),
  );
  for (let row = 0; row < tilesPerAxis; row++) {
    for (let col = 0; col < tilesPerAxis; col++) {
      const v = value(col, row);
      const wx = ramps[col]!;
      const wy = ramps[row]!;
      const originX = col * pitchPixels;
      const originY = row * pitchPixels;
      for (let r = 0; r < keptPixels; r++) {
        const dstRow = (originY + r) * size + originX;
        const vy = wy[r]!;
        for (let c = 0; c < keptPixels; c++) {
          out[dstRow + c] = out[dstRow + c]! + wx[c]! * vy * v;
        }
      }
    }
  }
  return out;
}

/**
 * Render a mosaic of focus-corrected fluorescence tiles and compose them.
 *
 * `fluorescenceMosaicGeometry` places the tiles; `focusCorrectedTiles` renders
 * them, **unchanged and un-forked**, which is what keeps § 6bg's claim that the
 * correction and the composition are separable true in the code as well as in
 * the prose; and this crops each tile's stacked planes to the kept span and lays
 * them side by side. Nothing is resampled a second time — a tile's kept pixels
 * are its own, following § 6o — and without `overlapPixels` nothing is blended
 * across a seam either, so a seam error is a step and can be measured as one.
 * That is the default and § 6bi.1 keeps it bitwise; `overlapPixels` ramps it.
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
  const { guardPixels, keptPixels, overlapPixels, pitchPixels, size, tilesPerAxis } = geometry;

  const rendered = focusCorrectedTiles(system, density, {
    ...options,
    centresMm: geometry.centresMm,
    ...(options.onTile === undefined ? {} : { onTile: options.onTile }),
  });

  const first = rendered.tiles[0]!.volume;
  const planeCount = first.planes.length;
  const composed = Array.from({ length: planeCount }, () => new Float64Array(size * size));

  // One ramp per column index and per row index, not one per tile: the weight is
  // separable, so a tile's is the product of the two its position names.
  const ramps = Array.from({ length: tilesPerAxis }, (_, k) =>
    rampWeights(keptPixels, overlapPixels, k, tilesPerAxis),
  );

  const tiles: FluorescenceMosaicTile[] = rendered.tiles.map((tile, i) => {
    const col = i % tilesPerAxis;
    const row = (i - col) / tilesPerAxis;
    const originPx = { x: col * pitchPixels, y: row * pitchPixels };
    for (let p = 0; p < planeCount; p++) {
      const plane = tile.volume.planes[p]!;
      // Two paths and not one with a weight of 1: an abutting mosaic writes the
      // tile's own pixel, which is the assignment § 6bh.1 pins bitwise, and a
      // blended one accumulates. Nothing is multiplied by 1.
      if (overlapPixels === 0) {
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
      } else {
        blendKept(
          composed[p]!,
          size,
          plane.intensity,
          tile.volume.size,
          guardPixels,
          keptPixels,
          originPx.x,
          originPx.y,
          ramps[col]!,
          ramps[row]!,
        );
      }
    }
    return { ...tile, col, row, originPx };
  });

  let maxGridPhaseStepWaves = 0;
  for (const tile of tiles) {
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, tile.volume.maxGridPhaseStepWaves);
  }

  // The ruler is the ANCHOR's and is taken from the geometry, not from a tile:
  // an even tile count puts no tile on the anchor, so there is no tile to borrow
  // it from. `weight` and `meanWavelengthNm` are read off the first tile because
  // they are functions of `samples` and the emission filter alone — the same
  // number in every tile by construction — and reading them keeps one expression
  // for the filter rather than a second that merely agreed.
  const planes: EmitterPlane[] = geometry.planes.map((p, i) => ({
    nm: p.nm,
    weight: first.planes[i]!.weight,
    intensity: composed[i]!,
    sourcePixelScaleMm: p.frame.pixelScaleMm,
    resampleRatio: p.resampleRatio,
    frame: p.frame,
  }));

  return {
    geometry,
    tiles,
    composed: {
      size,
      pixelScaleMm: geometry.pixelScaleMm,
      meanWavelengthNm: first.meanWavelengthNm,
      rulerWavelengthNm: geometry.rulerWavelengthNm,
      croppedPixels: geometry.croppedPixels,
      samples: options.samples,
      planes,
      maxGridPhaseStepWaves,
    },
    exposures: rendered.exposures,
    stageSpreadMm: rendered.stageSpreadMm,
    maxGridPhaseStepWaves,
  };
}

export type { TileStageMm };
