import type { CondenserSource } from "../illumination/source";
import type { BrightfieldFidelity, BrightfieldVerdict } from "../illumination/fidelity";
import type { OpticalSystem, WavelengthSample } from "../trace/system";
import {
  formBrightfieldPlane,
  stackBrightfieldPlanes,
  type BrightfieldPlaneInput,
  type BrightfieldSpectralStack,
  type BrightfieldSpectrumOptions,
} from "./brightfield-spectrum";
import { spectralXyzBasis, type XyzBasis } from "../photometry/spectrum";
import { colorImageFromStack, type ColorImage } from "./image";
import { mosaicGuardPixels } from "./mosaic";
import { objectFieldTile, type FieldPupilOptions, type ObjectFieldFrame } from "./object-field";
import { radialMapCovering, type RadialMap } from "./radial-map";
import type { SpecimenMap, SpectralSpecimen } from "./specimen";

/**
 * The polychromatic mosaic — § 6t, and the last thing between the branch's
 * colour and the branch's field of view.
 *
 * § 6o tiles a field at one wavelength; § 6r images one tile in colour. Both
 * landed with the other named as their own deferral, in the same words: § 6r
 * says "a tile, not a mosaic — `halfExtentMm` is ∝ λ, so a mosaic's pitch and
 * guard band would have to be fixed by one reference λ", and this is that
 * design question answered.
 *
 * ## Two crops, and only one of them is the guard
 *
 * The answer turns on doing the two crops in the right order, and the wrong
 * order produces a picture that is plausible everywhere.
 *
 * A spectral tile is cropped **twice**. First the guard band, `guardCells` of
 * grid off each edge, which exists because `abbeImage` is a transform and the
 * specimen outside the grid is wrapped rather than absent (§ 6o). Then the
 * ruler: the planes have physically different scales, so they are resampled onto
 * the bluest one's grid and one bilinear stencil's reach is dropped (§ 6r).
 *
 * **The guard is taken per plane, on that plane's own grid, before the stack.**
 * That is the whole of the design decision, and what it buys is that the guard
 * is exactly `guardCells` *in every plane's own cells* — so § 6o's closed form
 * applies to each plane verbatim, with nothing new to measure and nothing to
 * re-derive. § 6t.1 pins it as an identity rather than as an argument: a
 * spectral tile's plane at λ **is** `renderMosaicTile`'s tile at λ, bit for bit.
 *
 * Taking the guard after the stack instead would crop one *physical* distance
 * from every plane, which is a different number of cells in each of them, and
 * the guard § 6o measured would no longer be the guard any plane got.
 *
 * ## The wavelength that binds is the ruler's, and it binds twice
 *
 * The common grid is the smallest-scaled plane's — the bluest — so every other
 * plane's kept span is strictly *interior* to what it rendered: at plane λ the
 * composed span covers `usefulPixels · s_ruler/s_λ` of that plane's own pixels,
 * which is fewer than `usefulPixels` for every plane but the ruler. So the
 * distance from the kept edge to the wrap is
 *
 *     effectiveGuardCells(λ) = (size − usefulPixels·s_ruler/s_λ) / 2 · ps/size
 *
 * which is **minimised at the ruler plane**, where it is exactly
 * `guardCells + rulerCropPixels·ps/size`. Every redder plane is over-guarded,
 * by an amount that is not a constant — it carries `usefulPixels`, so it grows
 * with the frame. § 6t.3 pins the closed form and § 6t.4 the ordering.
 *
 * That puts the blue end of the lamp in charge of the guard as well as of the
 * sampling, which is § 6r.7's finding arriving on a second axis: the plane that
 * refuses first is the plane the picture's ruler belongs to.
 *
 * ## The pitch is the ruler plane's, and it is NOT the mono pitch
 *
 * Tile centres are image-plane millimetres and carry no wavelength, so every
 * plane of every tile shares one centre — but the *pitch* is a span, and a span
 * is a ruler. It is read on the anchor tile's ruler plane and nowhere else,
 * which is `mosaicTileAt`'s rule with one more word in it.
 *
 * The consequence is worth stating loudly because it silently produces a
 * misregistered picture: at the same `size`, `pupilSamples` and `guardCells`, a
 * spectral mosaic's kept span is `2·rulerCropPixels` *smaller* than a mono one's,
 * so its pitch is smaller too. A spectral tile is therefore pinned against
 * `brightfieldSpectralStack` at its own centre (§ 6t.2) and **never** bitwise
 * against a mono mosaic's tile at the same index.
 */

/** Which plane's grid the picture is on, and what that costs the others. */
export interface SpectralMosaicPlane {
  readonly nm: number;
  /** This plane's own frame at the tile's centre — its own λ, its own trace. */
  readonly frame: ObjectFieldFrame;
  /** `rulerPixelScaleMm / this plane's` — ≤ 1, and exactly 1 for the ruler. */
  readonly resampleRatio: number;
  /**
   * Cells between the kept span's edge and this plane's own wrap boundary.
   *
   * `guardCells + rulerCropPixels·ps/size` at the ruler and strictly more
   * everywhere else — see the header. This is the number § 6o's `guard^(−1/2)`
   * law is a function of, per plane, which is what makes the guard a
   * transplanted measurement rather than a new one.
   */
  readonly effectiveGuardCells: number;
}

export interface SpectralMosaicGeometry {
  /** The anchor tile's planes, in the order `samples` gave them. */
  readonly planes: readonly SpectralMosaicPlane[];
  /** Index into `planes` of the plane whose grid the picture is on. */
  readonly rulerIndex: number;
  readonly rulerWavelengthNm: number;
  /** Grid each plane is rendered at, guard included. */
  readonly tileSize: number;
  /** Pixels of guard dropped from each edge of each plane — `mosaicGuardPixels`. */
  readonly guardPixels: number;
  readonly guardCells: number;
  /** Pixels dropped from each side again, reaching the common ruler (§ 6r). */
  readonly rulerCropPixels: number;
  /** Pixels kept per tile per axis: `size − 2·guardPixels − 2·rulerCropPixels`. */
  readonly usefulPixels: number;
  /** Image-plane mm per pixel of the composed picture — the ruler plane's. */
  readonly pixelScaleMm: number;
  /** Object-plane mm per pixel on the ruler plane's linear reference. */
  readonly objectPixelScaleMm: number;
  /** Image-plane spacing of tile centres (mm) — `usefulPixels · pixelScaleMm`. */
  readonly pitchMm: number;
  /** The anchor: tile (0, 0)'s centre, and the only place the pitch is read. */
  readonly centreMm: { readonly x: number; readonly y: number };
}

export interface SpectralMosaicTile {
  readonly col: number;
  readonly row: number;
  /** Image-plane centre of this tile (mm) — wavelength-independent. */
  readonly centreMm: { readonly x: number; readonly y: number };
  /**
   * Object-plane point the centre looks at, **on the ruler plane's traced map**.
   *
   * Per-λ and not one number: the inverse chief-ray map is traced at each
   * wavelength, so a tile's planes look at slightly different object points and
   * the difference is lateral colour (§ 6r.6). The ruler's is quoted here
   * because the picture's ruler is its grid; the rest are in `planes`.
   */
  readonly objectCentreMm: { readonly x: number; readonly y: number };
  readonly planes: readonly SpectralMosaicPlane[];
  readonly originPx: { readonly x: number; readonly y: number };
}

export interface SpectralMosaicOptions extends FieldPupilOptions {
  /** Grid each plane is rendered at, a power of two. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /** Resolution cells of grid discarded from each edge of EVERY plane (§ 6o). */
  readonly guardCells: number;
  /** The lamp, sampled — `weight` is the SED × Δλ, as in § 6r. */
  readonly samples: readonly WavelengthSample[];
  /** The anchor (mm). Tile (0, 0)'s centre, and the pitch's only reference. */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /**
   * Pixels dropped from each side to reach the common ruler. Default 1.
   *
   * `stackBrightfieldPlanes`'s `croppedPixels`, exposed here as the only stack
   * knob rather than its whole options object: its alternative form is an
   * absolute `size`, and a spectral mosaic's kept span has to be derived from
   * the guard rather than stated beside it, or the pitch and the crop could
   * disagree and the picture would tile with a step in it.
   */
  readonly rulerCropPixels?: number;
  readonly probeHeightMm?: number;
  /** Patches across each tile, per axis — `renderBrightfield`'s knob. */
  readonly patches?: number;
  readonly requireHonest?: boolean;
  readonly map?: SpecimenMap;
  /**
   * Tabulate the inverse chief-ray map with this many intervals (§ 6s).
   *
   * **One table per wavelength**, never one for the stack — the map is
   * λ-dependent and `radialMapCovering` refuses to span two. `renderSpectralMosaic`
   * builds each plane's table over ALL its tiles' frames, which is the half of
   * § 6s's saving that grows with the field; `renderSpectralMosaicTile` builds
   * one over the single tile unless it is handed the shared ones.
   */
  readonly radialMapNodes?: number;
}

/** `no-honest-image` ≻ `unknown` ≻ `valid` — `imaging/brightfield`'s order. */
const VERDICT_RANK: Record<BrightfieldVerdict, number> = {
  valid: 0,
  unknown: 1,
  "no-honest-image": 2,
};

/** The per-λ options every plane of every tile is formed with. */
function planeOptions(options: SpectralMosaicOptions): BrightfieldSpectrumOptions {
  return {
    size: options.size,
    pupilSamples: options.pupilSamples,
    samples: options.samples,
    ...(options.patches === undefined ? {} : { patches: options.patches }),
    ...(options.requireHonest === undefined ? {} : { requireHonest: options.requireHonest }),
    ...(options.probeHeightMm === undefined ? {} : { probeHeightMm: options.probeHeightMm }),
    ...(options.map === undefined ? {} : { map: options.map }),
    ...(options.radialMapNodes === undefined ? {} : { radialMapNodes: options.radialMapNodes }),
    ...(options.traceSamples === undefined ? {} : { traceSamples: options.traceSamples }),
    ...(options.zernikeTerms === undefined ? {} : { zernikeTerms: options.zernikeTerms }),
    ...(options.aim === undefined ? {} : { aim: options.aim }),
    ...(options.obstruction === undefined ? {} : { obstruction: options.obstruction }),
    ...(options.spider === undefined ? {} : { spider: options.spider }),
  };
}

/** The frames alone, at one centre — no raster, no transform, one trace per λ. */
function framesAt(
  system: OpticalSystem,
  options: SpectralMosaicOptions,
  centreMm: { readonly x: number; readonly y: number },
  who: string,
): ObjectFieldFrame[] {
  if (options.samples.length === 0) throw new Error(`${who}: no wavelengths`);
  const common = planeOptions(options);
  // The frame half of `formBrightfieldPlane`, which costs a raster and a
  // transform on top of it. The two agree bitwise because this is the same call
  // on the same options — `mosaicTileAt`'s argument about the pitch, one layer
  // down, and § 6t.1's identity depends on it.
  return options.samples.map((sample) =>
    objectFieldTile(system, { ...common, centreMm, wavelengthNm: sample.nm }),
  );
}

/**
 * Which plane the picture's grid belongs to — the smallest physical scale.
 *
 * Measured over the planes rather than assumed to be the shortest wavelength's,
 * for `stackBrightfieldPlanes`'s reason: the reference sphere and the exit pupil
 * are traced per λ too, and a pathological system could order them differently.
 * When the caller states which one it must be — every tile after the anchor —
 * a disagreement is **refused**, because a composed picture whose tiles are on
 * two different rulers is a picture with a scale step in it that nothing
 * downstream can see.
 */
function rulerIndexOf(frames: readonly ObjectFieldFrame[], expectedNm: number | null, who: string): number {
  let index = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.pixelScaleMm < frames[index]!.pixelScaleMm) index = i;
  }
  if (expectedNm !== null && frames[index]!.wavelengthNm !== expectedNm) {
    throw new Error(
      `${who}: this tile's ruler is ${frames[index]!.wavelengthNm} nm where the anchor's is ` +
        `${expectedNm} nm — the composed picture would carry two rulers, so the tiles cannot ` +
        `be laid on one lattice. Narrow the band or move the field in`,
    );
  }
  return index;
}

/** How many pixels of each plane's own grid the kept span covers, as cells. */
function planesOf(
  frames: readonly ObjectFieldFrame[],
  rulerIndex: number,
  usefulPixels: number,
  size: number,
  pupilSamples: number,
): SpectralMosaicPlane[] {
  const rulerScale = frames[rulerIndex]!.pixelScaleMm;
  const pixelsPerCell = size / pupilSamples;
  return frames.map((frame) => {
    const ratio = rulerScale / frame.pixelScaleMm;
    return {
      nm: frame.wavelengthNm,
      frame,
      resampleRatio: ratio,
      effectiveGuardCells: (size - usefulPixels * ratio) / 2 / pixelsPerCell,
    };
  });
}

/**
 * The anchor's geometry: the ruler, the two crops, the kept span and the pitch.
 *
 * Costs one trace per wavelength and forms no image, so a caller can price a
 * spectral mosaic — or lay one out and render its tiles in workers — without
 * paying for one. `mosaicLayout`'s separation, with the wavelength axis on it.
 */
export function spectralMosaicGeometry(
  system: OpticalSystem,
  options: SpectralMosaicOptions,
): SpectralMosaicGeometry {
  const { size, pupilSamples } = options;
  const centreMm = options.centreMm ?? { x: 0, y: 0 };
  const { guardPixels } = mosaicGuardPixels(options, "spectralMosaicGeometry");
  const rulerCropPixels = options.rulerCropPixels ?? 1;
  if (!Number.isInteger(rulerCropPixels) || rulerCropPixels < 0) {
    throw new Error(
      `spectralMosaicGeometry: rulerCropPixels must be a non-negative integer, got ${rulerCropPixels}`,
    );
  }
  const usefulPixels = size - 2 * guardPixels - 2 * rulerCropPixels;
  if (usefulPixels < 1) {
    throw new Error(
      `spectralMosaicGeometry: a guard of ${options.guardCells} cells (${guardPixels} px) and a ` +
        `ruler crop of ${rulerCropPixels} px leave ${usefulPixels} pixels of a ${size}-pixel tile`,
    );
  }

  const frames = framesAt(system, options, centreMm, "spectralMosaicGeometry");
  const rulerIndex = rulerIndexOf(frames, null, "spectralMosaicGeometry");
  const ruler = frames[rulerIndex]!;
  return {
    planes: planesOf(frames, rulerIndex, usefulPixels, size, pupilSamples),
    rulerIndex,
    rulerWavelengthNm: ruler.wavelengthNm,
    tileSize: size,
    guardPixels,
    guardCells: options.guardCells,
    rulerCropPixels,
    usefulPixels,
    pixelScaleMm: ruler.pixelScaleMm,
    objectPixelScaleMm: ruler.objectPixelScaleMm,
    pitchMm: usefulPixels * ruler.pixelScaleMm,
    centreMm,
  };
}

/**
 * One tile of an **unbounded** spectral mosaic, indexed from the anchor.
 *
 * `mosaicTileAt`'s contract with the wavelength axis added: tile `(0, 0)` is the
 * anchor, tile `(i, j)` sits at `anchor + (i, j)·pitch`, and the pitch is read on
 * the anchor's **ruler plane** and nowhere else — so `(i, j)` is a cache key that
 * depends on nothing about the viewport that asked for it.
 *
 * Costs `samples.length` traces for the anchor's pitch and as many again for
 * this tile. Hand it a `geometry` to pay the first half once for a whole pan.
 */
export function spectralMosaicTileAt(
  system: OpticalSystem,
  options: SpectralMosaicOptions,
  col: number,
  row: number,
  geometry?: SpectralMosaicGeometry,
): SpectralMosaicTile {
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    throw new Error(`spectralMosaicTileAt: col and row must be integers, got ${col}, ${row}`);
  }
  const geo = geometry ?? spectralMosaicGeometry(system, options);
  return tileAtOffset(system, options, geo, col, row, col, row, "spectralMosaicTileAt");
}

/**
 * A tile at `(offsetCol, offsetRow)` pitches from the anchor, labelled `(col, row)`.
 *
 * The offsets are separated from the labels for ONE case, and it is the case
 * § 6o.5 named: an **even** tile count puts no tile on the anchor, so a finite
 * layout's innermost pair straddles it at half-integer offsets. An anchored
 * index cannot — a half-index is not a cache key — so `spectralMosaicTileAt`
 * refuses one and the layout reaches this directly.
 */
function tileAtOffset(
  system: OpticalSystem,
  options: SpectralMosaicOptions,
  geo: SpectralMosaicGeometry,
  offsetCol: number,
  offsetRow: number,
  col: number,
  row: number,
  who: string,
): SpectralMosaicTile {
  const centreMm = {
    x: geo.centreMm.x + offsetCol * geo.pitchMm,
    y: geo.centreMm.y + offsetRow * geo.pitchMm,
  };
  const frames =
    offsetCol === 0 && offsetRow === 0
      ? geo.planes.map((p) => p.frame)
      : framesAt(system, options, centreMm, who);
  const rulerIndex = rulerIndexOf(frames, geo.rulerWavelengthNm, who);
  return {
    col,
    row,
    centreMm,
    objectCentreMm: frames[rulerIndex]!.centreObjectMm,
    planes: planesOf(frames, rulerIndex, geo.usefulPixels, options.size, options.pupilSamples),
    originPx: { x: col * geo.usefulPixels, y: row * geo.usefulPixels },
  };
}

export interface SpectralMosaicTileImage {
  readonly tile: SpectralMosaicTile;
  /** Side of the stack's grid, in pixels — the geometry's `usefulPixels`. */
  readonly size: number;
  /** The planes on the common ruler, guard already discarded. */
  readonly stack: BrightfieldSpectralStack;
  /** Worst verdict across this tile's wavelengths. */
  readonly fidelity: BrightfieldFidelity;
  /** The wavelength the verdict belongs to — § 6r.7's blue end, by name. */
  readonly verdictNm: number;
  readonly maxGridPhaseStepWaves: number;
  readonly contributingPoints: number;
}

/**
 * Render one tile of a spectral mosaic, alone: one plane per wavelength, each
 * cropped by the guard on **its own** grid, then stacked on the bluest one's.
 *
 * The order is the module's whole design decision — see the header — and it is
 * what makes § 6o's guard measurement and § 6r's ruler measurement compose
 * rather than interfere. § 6t.1 pins each plane bitwise against `renderMosaicTile`
 * at that wavelength, and § 6t.2 pins the whole tile against
 * `brightfieldSpectralStack` at guard zero.
 */
export function renderSpectralMosaicTile(
  system: OpticalSystem,
  specimen: SpectralSpecimen,
  source: CondenserSource,
  options: SpectralMosaicOptions,
  tile: SpectralMosaicTile,
  geometry?: SpectralMosaicGeometry,
  radialMaps?: readonly RadialMap[],
): SpectralMosaicTileImage {
  const geo = geometry ?? spectralMosaicGeometry(system, options);
  // The crop comes from the geometry and the pixels come from the options, so a
  // geometry built under a different lattice would crop by the wrong amount and
  // hand back a perfectly plausible picture of the wrong piece of specimen —
  // `renderMosaicTile`'s refusal, which exists for exactly this.
  const stated = mosaicGuardPixels(options, "renderSpectralMosaicTile");
  if (
    geo.tileSize !== options.size ||
    geo.guardPixels !== stated.guardPixels ||
    geo.rulerCropPixels !== (options.rulerCropPixels ?? 1)
  ) {
    throw new Error(
      `renderSpectralMosaicTile: the geometry was laid out at size ${geo.tileSize} / guard ` +
        `${geo.guardPixels} px / ruler crop ${geo.rulerCropPixels} px and is being rendered at ` +
        `${options.size} / ${stated.guardPixels} / ${options.rulerCropPixels ?? 1} — lay the tile ` +
        `out with the options it is rendered with`,
    );
  }
  const common = planeOptions(options);
  const { guardPixels, usefulPixels, rulerCropPixels } = geo;
  const src = options.size;
  const cropped = src - 2 * guardPixels;

  const fidelities: BrightfieldFidelity[] = [];
  const perPlane: { grid: number; points: number }[] = [];
  const input: BrightfieldPlaneInput[] = options.samples.map((sample, i) => {
    const plane = formBrightfieldPlane(
      system,
      specimen,
      source,
      common,
      sample,
      tile.centreMm,
      radialMaps?.[i],
    );
    fidelities.push(plane.fidelity);
    perPlane.push({
      grid: plane.maxGridPhaseStepWaves,
      points: plane.contributingPoints,
    });
    // The guard, on this plane's own grid and in this plane's own cells. The
    // centre survives it exactly: index `src/2` maps to `src/2 − guardPixels`,
    // which is `cropped/2`, so no plane shifts by half a pixel and the stack's
    // ruler identity (`resampleRatio` exactly 1 is a bitwise copy) is unharmed.
    const whole = plane.input.intensity;
    const kept = new Float64Array(cropped * cropped);
    for (let y = 0; y < cropped; y++) {
      const from = (y + guardPixels) * src + guardPixels;
      for (let x = 0; x < cropped; x++) kept[y * cropped + x] = whole[from + x]!;
    }
    return { ...plane.input, size: cropped, intensity: kept };
  });

  const stack = stackBrightfieldPlanes(input, { croppedPixels: rulerCropPixels });
  if (stack.size !== usefulPixels) {
    throw new Error(
      `renderSpectralMosaicTile: the stack kept ${stack.size} px where the layout pitches on ` +
        `${usefulPixels} — the tiles would overlap or gap`,
    );
  }
  if (stack.rulerWavelengthNm !== geo.rulerWavelengthNm) {
    throw new Error(
      `renderSpectralMosaicTile: this tile stacked on ${stack.rulerWavelengthNm} nm where the ` +
        `anchor's ruler is ${geo.rulerWavelengthNm} nm`,
    );
  }

  let worst = 0;
  let maxGridPhaseStepWaves = 0;
  let contributingPoints = Infinity;
  for (let i = 0; i < fidelities.length; i++) {
    if (VERDICT_RANK[fidelities[i]!.verdict] > VERDICT_RANK[fidelities[worst]!.verdict]) worst = i;
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, perPlane[i]!.grid);
    contributingPoints = Math.min(contributingPoints, perPlane[i]!.points);
  }

  return {
    tile,
    size: stack.size,
    stack: {
      ...stack,
      planes: stack.planes.map((p, i) => ({
        ...p,
        frame: tile.planes[i]!.frame,
        fidelity: fidelities[i]!,
        maxGridPhaseStepWaves: perPlane[i]!.grid,
        contributingPoints: perPlane[i]!.points,
      })),
      fidelity: fidelities[worst]!,
      maxGridPhaseStepWaves,
      contributingPoints,
    },
    fidelity: fidelities[worst]!,
    verdictNm: options.samples[worst]!.nm,
    maxGridPhaseStepWaves,
    contributingPoints,
  };
}

export interface SpectralMosaicLayout {
  readonly tiles: readonly SpectralMosaicTile[];
  readonly tilesPerAxis: number;
  readonly geometry: SpectralMosaicGeometry;
  /** Side of the composed picture, in pixels. */
  readonly size: number;
}

/**
 * A finite spectral mosaic's tiles, `0`-based from −x, −y.
 *
 * `mosaicLayout`'s shape and its `col`/`row` convention — `0`-based from −x, −y,
 * so tile `(col, row)` is the anchored tile at `(col − half, row − half)` and
 * § 6t.5 pins that. `"abutting"` has no analogue here: it is a finite mosaic's
 * fixed point, and § 6o.6 measured the drift it would remove at ~1e-3 of a
 * pixel, four orders below the ruler crop this module already takes.
 */
export function spectralMosaicLayout(
  system: OpticalSystem,
  options: SpectralMosaicOptions & { readonly tiles: number },
): SpectralMosaicLayout {
  const { tiles } = options;
  if (!Number.isInteger(tiles) || tiles < 1) {
    throw new Error(`spectralMosaicLayout: tiles must be a positive integer, got ${tiles}`);
  }
  const geometry = spectralMosaicGeometry(system, options);
  const half = (tiles - 1) / 2;
  const laid: SpectralMosaicTile[] = [];
  for (let row = 0; row < tiles; row++) {
    for (let col = 0; col < tiles; col++) {
      // Placed by its offset from the anchor and labelled by its signed index,
      // so with an ODD count a layout tile IS the anchored tile at that index
      // (§ 6t.5) and with an even one the innermost pair straddles the anchor —
      // § 6o.5's case, and the one that catches a mosaic built from tile corners
      // instead of tile centres.
      laid.push(
        tileAtOffset(system, options, geometry, col - half, row - half, col, row, "spectralMosaicLayout"),
      );
    }
  }
  return {
    tiles: laid,
    tilesPerAxis: tiles,
    geometry,
    size: tiles * geometry.usefulPixels,
  };
}

export interface SpectralMosaicImage {
  /** The composed picture, in XYZ — hand it to `toSrgbBytes` for pixels. */
  readonly image: ColorImage;
  readonly layout: SpectralMosaicLayout;
  /** The WORST verdict across every wavelength of every tile. */
  readonly fidelity: BrightfieldFidelity;
  readonly verdictNm: number;
  readonly maxGridPhaseStepWaves: number;
  readonly contributingPoints: number;
}

export interface RenderSpectralMosaicOptions {
  /** Called once per tile finished, for progress against a cost in minutes. */
  readonly onTile?: (done: number, total: number) => void;
  /** Called once per (tile, wavelength) — the axis a spectral mosaic multiplies. */
  readonly onPlane?: (done: number, total: number, nm: number) => void;
}

/**
 * Render a spectral mosaic and compose its tiles into one colour picture.
 *
 * **Cost is `tiles² × wavelengths` tile-renders**, which is the whole reason
 * this step waited for § 6p's cached pupil and § 6s's tabulated map. The radial
 * map is built **once per wavelength over every tile's frame** — the map belongs
 * to the system and the λ, not to the tile, so a mosaic pays `nodes + 1`
 * inversions per wavelength in total rather than per tile.
 *
 * The observer basis is built **once** from the first tile's normalized samples
 * and handed to every tile, so a tile of the composed picture is bitwise the
 * tile rendered alone (§ 6t.6) rather than a second evaluation of the same
 * integral.
 */
export function renderSpectralMosaic(
  system: OpticalSystem,
  specimen: SpectralSpecimen,
  source: CondenserSource,
  options: SpectralMosaicOptions & { readonly tiles: number } & RenderSpectralMosaicOptions,
): SpectralMosaicImage {
  const layout = spectralMosaicLayout(system, options);
  const { usefulPixels } = layout.geometry;
  const size = layout.size;

  // One table per wavelength, over every tile's frame at that wavelength.
  const radialMaps =
    options.radialMapNodes === undefined
      ? undefined
      : options.samples.map((_, i) =>
          radialMapCovering(
            system,
            layout.tiles.map((t) => t.planes[i]!.frame),
            {
              nodes: options.radialMapNodes!,
              ...(options.aim === undefined ? {} : { aim: options.aim }),
            },
          ),
        );

  const xyz = new Float64Array(size * size * 3);
  let basis: XyzBasis | null = null;
  let worst: { fidelity: BrightfieldFidelity; nm: number } | null = null;
  let maxGridPhaseStepWaves = 0;
  let contributingPoints = Infinity;
  let pixelScaleMm = layout.geometry.pixelScaleMm;
  let done = 0;
  let planesDone = 0;
  const planeTotal = layout.tiles.length * options.samples.length;

  for (const tile of layout.tiles) {
    const formed = renderSpectralMosaicTile(
      system,
      specimen,
      source,
      options,
      tile,
      layout.geometry,
      radialMaps,
    );
    for (const sample of options.samples) {
      options.onPlane?.(++planesDone, planeTotal, sample.nm);
    }
    basis ??= spectralXyzBasis(formed.stack.samples);
    const image = colorImageFromStack(formed.stack, basis);
    pixelScaleMm = image.pixelScaleMm;

    if (worst === null || VERDICT_RANK[formed.fidelity.verdict] > VERDICT_RANK[worst.fidelity.verdict]) {
      worst = { fidelity: formed.fidelity, nm: formed.verdictNm };
    }
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, formed.maxGridPhaseStepWaves);
    contributingPoints = Math.min(contributingPoints, formed.contributingPoints);

    for (let y = 0; y < usefulPixels; y++) {
      const dst = ((tile.originPx.y + y) * size + tile.originPx.x) * 3;
      const from = y * usefulPixels * 3;
      for (let i = 0; i < usefulPixels * 3; i++) xyz[dst + i] = image.xyz[from + i]!;
    }
    options.onTile?.(++done, layout.tiles.length);
  }

  return {
    image: { width: size, height: size, pixelScaleMm, xyz },
    layout,
    fidelity: worst!.fidelity,
    verdictNm: worst!.nm,
    maxGridPhaseStepWaves,
    contributingPoints,
  };
}
