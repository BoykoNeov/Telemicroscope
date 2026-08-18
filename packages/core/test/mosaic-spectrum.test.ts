import { describe, it, expect } from "vitest";
import { diskSource } from "../src/illumination";
import { brightfieldSpectralStack } from "../src/imaging/brightfield-spectrum";
import { colorImageFromStack } from "../src/imaging/image";
import { mosaicLayout, renderMosaicTile } from "../src/imaging/mosaic";
import {
  renderSpectralMosaic,
  renderSpectralMosaicTile,
  spectralMosaicGeometry,
  spectralMosaicLayout,
  spectralMosaicTileAt,
  type SpectralMosaicOptions,
} from "../src/imaging/mosaic-spectrum";
import { atWavelength, neutralSpecimen, type Specimen } from "../src/imaging/specimen";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem, WavelengthSample } from "../src/trace/system";

/**
 * § 6t — the polychromatic mosaic.
 *
 * § 6o tiles a field at one wavelength and § 6r images one tile in colour, and
 * each landed naming the other as its own deferral. § 6r's words: "a tile, not a
 * mosaic — `halfExtentMm` is ∝ λ, so a mosaic's pitch and guard band would have
 * to be fixed by one reference λ with every other λ cropped to it. That is a real
 * design question and not this one." This step is that question answered, and the
 * answer is an **ordering**.
 *
 * A spectral tile is cropped twice: the guard band (§ 6o), because `abbeImage` is
 * a transform and the specimen outside the grid is wrapped rather than absent;
 * and the ruler (§ 6r), because the planes have different physical scales and are
 * resampled onto the bluest one's grid. **The guard goes first, per plane, on
 * that plane's own grid** — and then the guard is exactly `guardCells` in every
 * plane's own cells, so § 6o's `guard^(−1/2)` closed form transplants to each
 * plane with nothing new to measure.
 *
 * That is pinned as an identity rather than argued (§ 6t.1): a spectral tile's
 * plane at λ IS `renderMosaicTile`'s tile at λ, bit for bit. Cropping after the
 * stack instead would take one *physical* distance off every plane, which is a
 * different number of cells in each of them, and the guard § 6o measured would
 * no longer be the guard any plane got.
 *
 * The rungs are ordered as the module is: § 6t.1–§ 6t.4 are the two crops and the
 * pitch, § 6t.5–§ 6t.6 the anchored index and the composition, § 6t.7 what a
 * mosaic adds to § 6r that a tile could not show.
 */

/* ── the bench ────────────────────────────────────────────────────────────── */

const SIZE = 64;
const PS = 32;
const GUARD = 4;

/** § 6b's DIN 4×/0.10 — § 6o's own mosaic system, so the two ladders compare. */
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({
    magnification: 4,
    numericalAperture: 0.1,
    stopPlacement: "rim",
  }),
}).system;

/**
 * § 6ai's shipped placement, and in this file it is not a control — it is where
 * two of the rungs below find something the fixture cannot show. The transverse
 * scale of a telecentric objective is EXACTLY proportional to wavelength, and its
 * lateral colour stops being linear once the distortion is large enough to be
 * seen. Both are read as legs on the rungs that already state the law.
 */
const TELECENTRIC: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/**
 * Three wavelengths, equally weighted — § 6r.6's own traced sampling.
 *
 * Deliberately the ends and the middle of § 3a's band rather than a fine comb:
 * every rung here reads a RATIO between planes or an identity against a
 * monochromatic render, and both are sharpest when the planes are far apart.
 */
const BLUE = 450;
const GREEN = 550;
const RED = 650;
const LAMP: readonly WavelengthSample[] = [BLUE, GREEN, RED].map((nm) => ({ nm, weight: 1 / 3 }));

/** Few points on purpose: these rungs are about geometry and identity, not S. */
const SOURCE = diskSource(0.6, 5);

/** A bar grating authored in object millimetres — structure, not a constant. */
const bars = (periodMm: number): Specimen =>
  (x, y) => ({
    re: 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / periodMm) * Math.cos((2 * Math.PI * y) / periodMm),
    im: 0,
  });

const ANCHOR = { x: 1.6, y: 0.8 } as const;

const optionsOf = (over: Partial<SpectralMosaicOptions> = {}): SpectralMosaicOptions => ({
  size: SIZE,
  pupilSamples: PS,
  guardCells: GUARD,
  samples: LAMP,
  centreMm: ANCHOR,
  ...over,
});

/* ── § 6t.1 — the guard is taken per plane, and that is an identity ────────── */

describe("§ 6t.1 — a spectral tile's plane IS the monochromatic tile at that λ", () => {
  it("bit for bit, on the anchor and off it", () => {
    // The step's load-bearing rung, and the reason the design decision is an
    // ordering rather than a compromise. The guard is cropped from each plane on
    // that plane's OWN grid before anything is resampled, so what comes out is
    // the tile § 6o already measured — at each wavelength, with § 6o.1's
    // guard^(−1/2) law applying to it verbatim and no new number minted.
    //
    // Equality is bitwise, not close: the two paths share one expression
    // (`formBrightfieldPlane`) and a difference in the last bit would mean the
    // spectral path had quietly become a second construction of the same thing.
    const options = optionsOf();
    const geometry = spectralMosaicGeometry(SYSTEM, options);
    const specimen = neutralSpecimen(bars(8 * geometry.objectPixelScaleMm));

    for (const [col, row] of [
      [0, 0],
      [1, -1],
    ] as const) {
      const tile = spectralMosaicTileAt(SYSTEM, options, col, row, geometry);
      const formed = renderSpectralMosaicTile(SYSTEM, specimen, SOURCE, options, tile, geometry);

      for (let i = 0; i < LAMP.length; i++) {
        const nm = LAMP[i]!.nm;
        // The monochromatic tile at this λ, laid out at the SPECTRAL pitch — a
        // one-tile mosaic centred where the spectral tile is. Its own pitch is a
        // different number (§ 6t.4), which is exactly why the centre is passed
        // rather than the index.
        const mono = mosaicLayout(SYSTEM, {
          tiles: 1,
          size: SIZE,
          pupilSamples: PS,
          guardCells: GUARD,
          wavelengthNm: nm,
          centreMm: tile.centreMm,
        });
        const alone = renderMosaicTile(
          SYSTEM,
          atWavelength(specimen, nm),
          SOURCE,
          {
            tiles: 1,
            size: SIZE,
            pupilSamples: PS,
            guardCells: GUARD,
            wavelengthNm: nm,
            centreMm: tile.centreMm,
          },
          mono.tiles[0]!,
        );

        // The stack's plane is the guard-cropped one resampled onto the ruler.
        // At the ruler plane the resample is the identity (`resampleRatio` 1, a
        // bitwise copy — § 6r.3), so THAT plane is comparable pixel for pixel
        // with the mono tile's interior; the others are compared through the
        // ruler crop below.
        const plane = formed.stack.planes[i]!;
        if (plane.resampleRatio === 1) {
          const c = geometry.rulerCropPixels;
          const n = alone.size;
          for (let y = 0; y < formed.size; y++) {
            for (let x = 0; x < formed.size; x++) {
              expect(plane.intensity[y * formed.size + x]!).toBe(
                alone.intensity[(y + c) * n + x + c]!,
              );
            }
          }
        }
        // Every plane's own frame is the mono tile's, bitwise — same centre,
        // same ruler, same traced object point. The frames are what the raster
        // and the pupils are read off, so this is the identity one level up.
        expect(plane.frame!.pixelScaleMm).toBe(mono.tiles[0]!.frame.pixelScaleMm);
        expect(plane.frame!.centreObjectMm.x).toBe(mono.tiles[0]!.frame.centreObjectMm.x);
        expect(plane.frame!.centreObjectMm.y).toBe(mono.tiles[0]!.frame.centreObjectMm.y);
      }
    }
  });
});

/* ── § 6t.2 — with no guard it is § 6r's own stack ────────────────────────── */

describe("§ 6t.2 — a one-tile spectral mosaic at guard zero IS `brightfieldSpectralStack`", () => {
  it("bitwise, including the ruler and the crop", () => {
    // § 6o.5's idiom transplanted: a one-tile mosaic with no guard reduced to
    // `objectFieldTile`, and a one-tile SPECTRAL mosaic with no guard must
    // reduce to § 6r's stack the same way, or the colour path has become a
    // second construction. It is also the rung that says the guard is the ONLY
    // difference between this module and § 6r.
    const options = optionsOf({ guardCells: 0 });
    const geometry = spectralMosaicGeometry(SYSTEM, options);
    const specimen = neutralSpecimen(bars(8 * geometry.objectPixelScaleMm));

    const tile = spectralMosaicTileAt(SYSTEM, options, 0, 0, geometry);
    const formed = renderSpectralMosaicTile(SYSTEM, specimen, SOURCE, options, tile, geometry);
    const direct = brightfieldSpectralStack(SYSTEM, specimen, SOURCE, {
      size: SIZE,
      pupilSamples: PS,
      samples: LAMP,
      centreMm: ANCHOR,
    });

    expect(formed.size).toBe(direct.size);
    expect(formed.stack.pixelScaleMm).toBe(direct.pixelScaleMm);
    expect(formed.stack.rulerWavelengthNm).toBe(direct.rulerWavelengthNm);
    expect(formed.stack.croppedPixels).toBe(direct.croppedPixels);
    for (let i = 0; i < LAMP.length; i++) {
      const a = formed.stack.planes[i]!;
      const b = direct.planes[i]!;
      expect(a.weight).toBe(b.weight);
      expect(a.resampleRatio).toBe(b.resampleRatio);
      for (let k = 0; k < a.intensity.length; k++) expect(a.intensity[k]!).toBe(b.intensity[k]!);
    }
  });
});

/* ── § 6t.3 — which plane the guard binds on ──────────────────────────────── */

describe("§ 6t.3 — the ruler plane is the LEAST guarded, and the rest by a closed form", () => {
  it("effectiveGuardCells = (size − useful·s_ruler/s_λ)/2 · ps/size, minimised at the ruler", () => {
    // The common grid is the smallest-scaled plane's, so every other plane's kept
    // span is strictly INTERIOR to what it rendered: at plane λ the composed span
    // covers `useful · s_ruler/s_λ` of that plane's own pixels, fewer than
    // `useful` for every plane but the ruler. So the distance from the kept edge
    // to the wrap is smallest at the ruler and larger everywhere else, and the
    // ruler plane is where § 6o's law is evaluated for the picture as a whole.
    //
    // This is § 6r.7's finding on a second axis: the blue end sets the sampling
    // AND the guard, because the plane that refuses first is the plane whose grid
    // the picture is on.
    const geometry = spectralMosaicGeometry(SYSTEM, optionsOf());
    const pixelsPerCell = SIZE / PS;

    const ruler = geometry.planes[geometry.rulerIndex]!;
    expect(ruler.resampleRatio).toBe(1);
    // The ruler's own guard is the requested cells plus what the ruler crop adds,
    // exactly — the crop is a guard too, and a small one: 1 px is half a cell here.
    expect(ruler.effectiveGuardCells).toBeCloseTo(
      GUARD + geometry.rulerCropPixels / pixelsPerCell,
      12,
    );

    // The delivered guard follows from the **wavelengths alone**, and that is the
    // pin rather than the expression: `imagePixelScaleMm` is ∝ λ (§ 6r), so the
    // resample ratio is λ_ruler/λ — 450/550 and 450/650 — and everything above
    // is arithmetic on it. Comparing `effectiveGuardCells` against the formula
    // that computes it would be the module checked against itself.
    for (const plane of geometry.planes) {
      const predicted = ruler.nm / plane.nm;
      expect(plane.resampleRatio).toBeCloseTo(predicted, 3);
      expect(plane.effectiveGuardCells).toBeCloseTo(
        (SIZE - geometry.usefulPixels * predicted) / 2 / pixelsPerCell,
        2,
      );
      expect(plane.effectiveGuardCells).toBeGreaterThanOrEqual(ruler.effectiveGuardCells);
      expect(plane.resampleRatio).toBeLessThanOrEqual(1);
    }

    // …and the residual is NOT noise, which is why `stackBrightfieldPlanes` takes
    // the minimum over *measured* scales instead of assuming the shortest
    // wavelength: the exit pupil and the reference sphere are traced per λ too,
    // so `pixelScaleMm` is ∝ λ times a factor that is itself faintly λ-dependent.
    // Measured here rather than absorbed into the tolerance above.
    const residual = geometry.planes.map((p) => Math.abs(p.resampleRatio - ruler.nm / p.nm));
    const worst = Math.max(...residual);
    expect(worst).toBeGreaterThan(1e-6);
    expect(worst).toBeLessThan(1e-3);

    // **AND ON THE SHIPPED OBJECTIVE IT VERY NEARLY IS NOISE — six orders below
    // this, which is a § 6ai finding and not a tolerance.** 450/550 comes back as
    // 0.818181818 and 450/650 as 0.692307692: the transverse scale of an
    // object-space telecentric objective is proportional to λ to 2.4e-10.
    //
    // The reason is the same one every § 6ai finding has. The scale is set by
    // where the chief ray puts the object point, the chief ray leaves the
    // specimen parallel to the axis at every wavelength, and the only λ left in
    // the pixel is the diffraction one — which is the λ this ratio is made of.
    // On the rim member the chief ray's direction is a ratio of distances to a
    // stop that the traced pupil moves with colour, and that residue is the
    // 1.7e-4 above.
    //
    // It does NOT make the minimum-over-measured-scales redundant, and the rung
    // says so by pinning the floor rather than an equality: 2.4e-10 is still four
    // thousand ulp, so `stackBrightfieldPlanes` is still reading a measurement.
    const telecentric = spectralMosaicGeometry(TELECENTRIC, optionsOf());
    const telecentricRuler = telecentric.planes[telecentric.rulerIndex]!;
    const telecentricWorst = Math.max(
      ...telecentric.planes.map((p) =>
        Math.abs(p.resampleRatio - telecentricRuler.nm / p.nm),
      ),
    );
    expect(telecentricWorst).toBeLessThan(1e-8);
    expect(telecentricWorst).toBeGreaterThan(100 * Number.EPSILON);
    expect(worst / telecentricWorst).toBeGreaterThan(1e5);
    console.log(
      `resample ratio vs λ_ruler/λ: ` +
        geometry.planes
          .map(
            (p) =>
              `${p.nm}nm ${p.resampleRatio.toFixed(6)} vs ${(ruler.nm / p.nm).toFixed(6)}`,
          )
          .join(", ") +
        ` — worst residual ${worst.toExponential(2)}`,
    );

    // The ruler IS the bluest plane on this system — measured, not assumed. The
    // module takes the minimum over the planes because the reference sphere and
    // the exit pupil are traced per λ, so nothing guarantees the ordering a
    // priori; here it is the ordinary one.
    expect(geometry.rulerWavelengthNm).toBe(BLUE);

    // The excess is NOT a constant of the band: it carries `usefulPixels`, so a
    // bigger tile over-guards its red end further. Measured against the same
    // options at twice the grid — the ratio of the excesses is the ratio of the
    // kept spans, to 12 digits, because the s_ruler/s_λ factor cancels out of it.
    const wide = spectralMosaicGeometry(SYSTEM, optionsOf({ size: 2 * SIZE, guardCells: GUARD }));
    const excess = (g: typeof geometry, i: number): number =>
      g.planes[i]!.effectiveGuardCells - g.planes[g.rulerIndex]!.effectiveGuardCells;
    const red = LAMP.findIndex((s) => s.nm === RED);
    // ps is unchanged, so a cell is twice the pixels and the excess is read in
    // cells: useful doubles-and-a-bit, the cell doubles exactly.
    const predicted =
      ((wide.usefulPixels * (1 - wide.planes[red]!.resampleRatio)) /
        (geometry.usefulPixels * (1 - geometry.planes[red]!.resampleRatio))) *
      (pixelsPerCell / (2 * SIZE / PS));
    expect(excess(wide, red) / excess(geometry, red)).toBeCloseTo(predicted, 10);
    expect(excess(geometry, red)).toBeGreaterThan(1);

    console.log(
      `guard asked ${GUARD} cells → effective ` +
        geometry.planes
          .map((p) => `${p.nm}nm ${p.effectiveGuardCells.toFixed(3)}`)
          .join(", ") +
        ` (ruler ${geometry.rulerWavelengthNm}nm, useful ${geometry.usefulPixels} px)`,
    );
  });
});

/* ── § 6t.4 — the two crops, the pitch, and the refusals ──────────────────── */

describe("§ 6t.4 — the kept span is the guard AND the ruler, and the pitch follows it", () => {
  it("useful = size − 2·guard − 2·rulerCrop, and that is NOT the mono span", () => {
    // The consequence worth stating loudly, because getting it wrong produces a
    // picture that tiles with a step in it and looks like optics: at the same
    // size, pupilSamples and guardCells a spectral mosaic keeps 2·rulerCrop fewer
    // pixels than a monochromatic one, so its pitch is smaller too. A spectral
    // tile is therefore never pinned bitwise against a mono tile at the same
    // INDEX — § 6t.1 passes the centre instead.
    const geometry = spectralMosaicGeometry(SYSTEM, optionsOf());
    expect(geometry.guardPixels).toBe(GUARD * (SIZE / PS));
    expect(geometry.usefulPixels).toBe(SIZE - 2 * geometry.guardPixels - 2 * geometry.rulerCropPixels);
    expect(geometry.pitchMm).toBe(geometry.usefulPixels * geometry.pixelScaleMm);

    const mono = mosaicLayout(SYSTEM, {
      tiles: 1,
      size: SIZE,
      pupilSamples: PS,
      guardCells: GUARD,
      wavelengthNm: BLUE,
      centreMm: ANCHOR,
    });
    expect(mono.usefulPixels - geometry.usefulPixels).toBe(2 * geometry.rulerCropPixels);
    // The pitch difference is the kept-span difference on the ruler's own scale —
    // the pitch is a span and a span is a ruler, and here they are the same ruler.
    expect(mono.pixelScaleMm).toBe(geometry.pixelScaleMm);
    expect(mono.pitchMm - geometry.pitchMm).toBeCloseTo(
      2 * geometry.rulerCropPixels * geometry.pixelScaleMm,
      15,
    );
  });

  it("REFUSES a fractional index, a non-whole guard, and a crop that eats the tile", () => {
    // `latticeMatchedSource`'s argument, inherited from § 6o.5 through
    // `mosaicGuardPixels` — the same expression and not a second one, which is
    // what stops the two mosaics' guards from drifting apart.
    expect(() => spectralMosaicTileAt(SYSTEM, optionsOf(), 0.5, 0)).toThrow(/integers/);
    expect(() => spectralMosaicGeometry(SYSTEM, optionsOf({ pupilSamples: 48, guardCells: 1 }))).toThrow(
      /px per resolution cell/,
    );
    expect(() => spectralMosaicGeometry(SYSTEM, optionsOf({ guardCells: 16 }))).toThrow(
      /eats the whole/,
    );
    // …and a guard that survives § 6o's own check but leaves nothing for the
    // ruler crop is this module's refusal, since the second crop is the one it
    // adds. 15 cells keeps 4 px of a 64 px tile and a 2 px crop takes them all.
    expect(() =>
      spectralMosaicGeometry(SYSTEM, optionsOf({ guardCells: 15, rulerCropPixels: 2 })),
    ).toThrow(/leave 0 pixels/);
    expect(() => spectralMosaicGeometry(SYSTEM, optionsOf({ rulerCropPixels: -1 }))).toThrow(
      /non-negative integer/,
    );
    expect(() => spectralMosaicGeometry(SYSTEM, optionsOf({ samples: [] }))).toThrow(/no wavelengths/);
    expect(() => spectralMosaicLayout(SYSTEM, { ...optionsOf(), tiles: 0 })).toThrow(
      /positive integer/,
    );
  });

  it("REFUSES a tile whose ruler is not the anchor's — two rulers is a scale step", () => {
    // A composed picture whose tiles sit on two different rulers has a scale step
    // in it that nothing downstream can see: every tile is internally consistent
    // and the seam is a smooth, plausible change of magnification. Refused at
    // both the layout and the render, and provoked here by handing a geometry
    // built on a narrower band than the tile is rendered with — which is the same
    // failure a band wide enough to reorder the planes would produce.
    const narrow = spectralMosaicGeometry(
      SYSTEM,
      optionsOf({ samples: LAMP.filter((s) => s.nm !== BLUE) }),
    );
    expect(narrow.rulerWavelengthNm).toBe(GREEN);
    expect(() => spectralMosaicTileAt(SYSTEM, optionsOf(), 1, 0, narrow)).toThrow(
      /the anchor's is 550 nm/,
    );

    const geometry = spectralMosaicGeometry(SYSTEM, optionsOf());
    const tile = spectralMosaicTileAt(SYSTEM, optionsOf(), 0, 0, geometry);
    const foreign = spectralMosaicGeometry(SYSTEM, optionsOf({ guardCells: GUARD - 1 }));
    expect(() =>
      renderSpectralMosaicTile(SYSTEM, neutralSpecimen(bars(1e-3)), SOURCE, optionsOf(), tile, foreign),
    ).toThrow(/lay the tile out with the options it is rendered with/);
  });
});

/* ── § 6t.5 — the anchored index ──────────────────────────────────────────── */

describe("§ 6t.5 — the index is anchored, and the viewport is not in the answer", () => {
  it("a 3×3 and a 5×5 about one anchor agree tile for tile, bitwise", () => {
    // § 6o.8's rung with the wavelength axis on it: the pitch is read on the
    // anchor's RULER plane and nowhere else, so tile (i, j) is a cache key that
    // depends on the render parameters and on nothing about the viewport. A
    // layout that re-read its pitch per viewport would pass nothing here.
    for (const tiles of [3, 5]) {
      const layout = spectralMosaicLayout(SYSTEM, { ...optionsOf(), tiles });
      const half = (tiles - 1) / 2;
      for (const t of layout.tiles) {
        const anchored = spectralMosaicTileAt(SYSTEM, optionsOf(), t.col - half, t.row - half);
        expect(anchored.centreMm.x).toBe(t.centreMm.x);
        expect(anchored.centreMm.y).toBe(t.centreMm.y);
        expect(anchored.objectCentreMm.x).toBe(t.objectCentreMm.x);
        for (let i = 0; i < LAMP.length; i++) {
          expect(anchored.planes[i]!.frame.pixelScaleMm).toBe(t.planes[i]!.frame.pixelScaleMm);
        }
      }
      expect(layout.tiles[0]!.originPx.x).toBe(0);
    }

    // …and the tile count itself is not in the answer: the 5×5's inner ring IS
    // the 3×3, tile for tile, once both are read at their signed index.
    const three = spectralMosaicLayout(SYSTEM, { ...optionsOf(), tiles: 3 }).tiles;
    const five = spectralMosaicLayout(SYSTEM, { ...optionsOf(), tiles: 5 }).tiles;
    for (const t of three) {
      const same = five.find((f) => f.col === t.col + 1 && f.row === t.row + 1)!;
      expect(same.centreMm.x).toBe(t.centreMm.x);
      expect(same.centreMm.y).toBe(t.centreMm.y);
    }
    expect(spectralMosaicTileAt(SYSTEM, optionsOf(), 0, 0).centreMm.x).toBe(ANCHOR.x);
  });
});

/* ── § 6t.6 — composition ─────────────────────────────────────────────────── */

describe("§ 6t.6 — a tile rendered alone is the composed picture's tile, bit for bit", () => {
  it("in XYZ, with one observer basis and no resampling across a seam", () => {
    // The stage's licence, in colour. Nothing is blended across a seam and
    // nothing is resampled — a tile's kept pixels are its own — so an
    // independently rendered tile is not an approximation of the composed one.
    // The observer basis is built once and shared, so the equality is about the
    // imaging rather than about two evaluations of the same integral.
    const options = { ...optionsOf(), tiles: 2, patches: 1 } as const;
    const layout = spectralMosaicLayout(SYSTEM, options);
    const specimen = neutralSpecimen(bars(8 * layout.geometry.objectPixelScaleMm));
    const mosaic = renderSpectralMosaic(SYSTEM, specimen, SOURCE, options);

    const n = layout.geometry.usefulPixels;
    for (const tile of layout.tiles) {
      const alone = renderSpectralMosaicTile(
        SYSTEM,
        specimen,
        SOURCE,
        options,
        tile,
        layout.geometry,
      );
      const image = colorImageFromStack(alone.stack);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const from = (y * n + x) * 3;
          const to = ((tile.originPx.y + y) * mosaic.layout.size + tile.originPx.x + x) * 3;
          expect(mosaic.image.xyz[to]!).toBe(image.xyz[from]!);
          expect(mosaic.image.xyz[to + 1]!).toBe(image.xyz[from + 1]!);
          expect(mosaic.image.xyz[to + 2]!).toBe(image.xyz[from + 2]!);
        }
      }
    }

    // CONTROL: the four tiles are different pictures, so the equality above is a
    // claim about registration and not about a mosaic that is flat everywhere.
    const a = mosaic.image.xyz.slice(0, n * 3);
    let differs = 0;
    for (let x = 0; x < n; x++) {
      const to = ((0 + 0) * mosaic.layout.size + n + x) * 3;
      if (mosaic.image.xyz[to] !== a[x * 3]) differs++;
    }
    expect(differs).toBeGreaterThan(0.9 * n);
    expect(mosaic.image.width).toBe(2 * n);

    // The verdict is the worst wavelength of the worst tile, and it NAMES the
    // wavelength — § 6g.3's "a frame is not honest in the places where it
    // happens to be" and § 6r.7's blue end, arriving together. At ps 32 the blue
    // plane refuses exactly as § 6r.7 measured it doing on one tile, so a mosaic
    // does not launder a refusal by averaging it over tiles.
    expect(mosaic.verdictNm).toBe(BLUE);
    expect(mosaic.fidelity.verdict).toBe("no-honest-image");
  });
});

/* ── § 6t.7 — what a mosaic adds that one tile could not show ─────────────── */

describe("§ 6t.7 — lateral colour is a FIELD effect, and a mosaic is the field", () => {
  it("zero on the axis and linear in the tile index, § 6r.6's law over millimetres", () => {
    // § 6r.6 measured lateral colour on ONE tile: the per-λ frames are concentric
    // and everything inside them is traced at its own wavelength, so the object
    // point a given image pixel looks at is wavelength-dependent — exactly zero
    // on axis and linear in field. A tile spans `pupilSamples` resolution cells
    // (§ 6h.2), so that measurement had 47 µm of field to work with; a mosaic has
    // millimetres, and this is the same law read where it is worth something.
    //
    // Measured on the traced chief-ray map itself — the tile centres — because
    // that is where the per-λ disagreement enters the picture: each plane's grid
    // is laid about the same IMAGE point and lands on a different OBJECT point.
    const options = optionsOf({ centreMm: { x: 0, y: 0 } });
    const geometry = spectralMosaicGeometry(SYSTEM, options);
    const blue = LAMP.findIndex((s) => s.nm === BLUE);
    const red = LAMP.findIndex((s) => s.nm === RED);

    const splitPx = (col: number): number => {
      const tile = spectralMosaicTileAt(SYSTEM, options, col, 0, geometry);
      const b = tile.planes[blue]!.frame.centreObjectMm;
      const r = tile.planes[red]!.frame.centreObjectMm;
      return Math.hypot(b.x - r.x, b.y - r.y) / geometry.objectPixelScaleMm;
    };

    // On the axis the frames are concentric about the same point and the split is
    // f64 zero — not small, zero, because `objectHeightForImageRadius` bisects to
    // mantissa exhaustion on a radius that is identically zero at every λ.
    expect(splitPx(0)).toBe(0);

    const at = [1, 2, 4].map(splitPx);
    for (const v of at) expect(v).toBeGreaterThan(0);
    // Linear: doubling the field doubles the split. Pinned as the RATIO rather
    // than as a value, so it is § 6r.6's law and not this lattice's number.
    expect(at[1]! / at[0]!).toBeCloseTo(2, 2);
    expect(at[2]! / at[0]!).toBeCloseTo(4, 2);

    // § 6ai's second half of the same coin. The split is linear in field to two
    // decimals here and to only one on the shipped telecentric objective — 4.016
    // rather than 4.000 — and the excess is not a worse inversion, it is the
    // chromatic aberration of the DISTORTION, which the flip made 70.7× bigger.
    // § 6r.8 pins its order (the departure from linearity grows as the field
    // squared); this rung only has to say that the linear law is still the law
    // and by how much the next term now shows through it.
    const telecentricGeometry = spectralMosaicGeometry(TELECENTRIC, options);
    const telecentricSplit = (col: number): number => {
      const tile = spectralMosaicTileAt(TELECENTRIC, options, col, 0, telecentricGeometry);
      const b = tile.planes[blue]!.frame.centreObjectMm;
      const r = tile.planes[red]!.frame.centreObjectMm;
      return Math.hypot(b.x - r.x, b.y - r.y) / telecentricGeometry.objectPixelScaleMm;
    };
    expect(telecentricSplit(0)).toBe(0);
    const telecentricAt = [1, 2, 4].map(telecentricSplit);
    expect(telecentricAt[1]! / telecentricAt[0]!).toBeCloseTo(2, 1);
    expect(telecentricAt[2]! / telecentricAt[0]!).toBeCloseTo(4, 1);
    // Still linear to 0.4%, and the departure is one-sided — the cubic adds, it
    // does not scatter.
    expect(telecentricAt[2]! / telecentricAt[0]!).toBeGreaterThan(4);
    expect(telecentricAt[2]! / telecentricAt[0]!).toBeLessThan(4.02);
    // …and the split itself is the bigger number, by the same factor § 6r.8 reads
    // on the object map directly.
    expect(telecentricAt[0]! / at[0]!).toBeGreaterThan(3);

    // The question a mosaic raises and a tile could not: does a spectral mosaic
    // have to correct its planes' registration? On this objective, **no** — and
    // that is MEASURED at the field edge rather than extrapolated to it. Half of
    // the DIN 18 mm field number (a convention, not an engine number —
    // `stage.ts` quotes the same one) is 9 mm of image, which is this pitch's
    // tile 44, and the rung reads it there. Only frame centres are traced, so it
    // costs three traces and no render.
    //
    // Extrapolating instead would have been unsafe in this branch's own way: the
    // split is read off the TRACED map, which carries distortion by construction
    // (§ 6h.1's cubic), so a ×44 extrapolation of a slope fitted over ×4 admits a
    // cubic term the linearity check cannot see. And a tile 44 pitches out is far
    // enough that the tracer refusing would be a real outcome (§ 2f's wall), which
    // is a sentence this rung would have to say rather than assume away.
    const edgeCol = Math.round(9 / geometry.pitchMm);
    const atEdge = splitPx(edgeCol);
    expect(atEdge).toBeLessThan(1);
    // …and the departure from the linear law over that whole reach, which is what
    // the extrapolation would have got wrong. Bounded, not asserted to be zero.
    const linear = (at[0]! / 1) * edgeCol;
    const perMm = at[0]! / geometry.pitchMm;
    console.log(
      `at the 9 mm field edge (tile ${edgeCol}): ${atEdge.toFixed(4)} px measured against ` +
        `${linear.toFixed(4)} px extrapolated — ${(100 * Math.abs(atEdge / linear - 1)).toFixed(1)}% ` +
        `of nonlinearity the ×4 fit could not see`,
    );
    console.log(
      `blue−red object split at tiles 1, 2, 4: ` +
        at.map((v) => v.toExponential(3)).join(", ") +
        ` px (pitch ${geometry.pitchMm.toExponential(3)} mm, ` +
        `${(geometry.usefulPixels * geometry.objectPixelScaleMm * 1e3).toFixed(1)} µm a tile); ` +
        `${perMm.toFixed(4)} px/mm of image near the axis`,
    );
  });
});
