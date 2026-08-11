import { describe, it, expect } from "vitest";
import { entryOf, specKey, MICROSCOPE_CATALOG } from "../src/microscope";
import { spectralXyz } from "@telemicroscope/core/photometry";
import { lampSamples } from "../src/section";
import {
  clearFieldExposure,
  renderStageTile,
  stageInfo,
  WHITE_INTENSITY,
  type StageRequest,
} from "../src/stage";

/**
 * The stage in colour — § 6t on screen, as invariants rather than as prose.
 *
 * **No engine capability was added for this panel**: § 6t is the engine step and
 * its rungs are in `packages/core/test/mosaic-spectrum.test.ts`. What is pinned
 * here is the *wiring*, and specifically the two claims the panel makes that no
 * ladder rung states, because both are about a picture rather than about a
 * number.
 *
 * The first is the **fixed white**. `stage.ts` warns in A7's own words that a
 * per-tile exposure paints a brightness step at every seam — a grid the physics
 * does not have — and colour is where that warning is easiest to ignore, because
 * A9's `renderSection` exposes each frame on its own mean and is one import away.
 * It is pinned on the **exposure** rather than on the picture, and that is a
 * correction this file made to itself: the first version asserted that a clear
 * field lands on the byte the lamp's XYZ says, and it does not. The background of
 * an Abbe image is not a clear field — a nearby absorber depresses it, measured
 * at 0.92 of one here — so what a picture can carry is that the exposure adds
 * nothing to that, and what pins the exposure is the exposure. Which is just as
 * well: the bug this caught was a **factor of 300**, the raw SED×Δλ weights used
 * where the stack's normalized ones belong, and every tile rendered near black.
 *
 * The second is the **lattice**. § 6t.4 pins that a spectral tile keeps
 * `2·rulerCropPixels` fewer pixels than a monochromatic one; on this panel that
 * is the pitch the tile cache is indexed on, so getting it wrong registers every
 * tile 2 px out and the picture is plausible. The rung reads both branches'
 * `usefulPixels` off `stageInfo` and pins the difference.
 */

const BASE: StageRequest = {
  spec: entryOf("din-4x-010").spec,
  specimen: "ruled",
  pupilSamples: 32,
  size: 64,
  guardCells: 4,
  coherenceParameter: 0.5,
  wavelengths: 0,
  lamp: "equal-energy",
};

const infoOf = (over: Partial<StageRequest> = {}) => {
  const result = stageInfo({ ...BASE, ...over });
  if (!result.ok) throw new Error(result.error);
  return result.info;
};

const tileOf = (col: number, row: number, over: Partial<StageRequest> = {}) => {
  const result = renderStageTile({ ...BASE, ...over, col, row });
  if (!result.ok) throw new Error(result.error);
  return result.readout;
};

/**
 * The clear field's byte, read as the **mode** of the red channel.
 *
 * Not the peak: an Abbe image rings at an edge, so the brightest pixel is an
 * overshoot whose size is a property of the edge and therefore of the specimen's
 * authoring. The flat background is what most of a tile is, and it is the thing
 * a fixed white is a claim about.
 */
const mode = (rgba: Uint8ClampedArray): number => {
  const counts = new Int32Array(256);
  for (let i = 0; i < rgba.length; i += 4) counts[rgba[i]!]! += 1;
  let best = 0;
  for (let v = 1; v < 256; v++) if (counts[v]! > counts[best]!) best = v;
  return best;
};

const mean = (rgba: Uint8ClampedArray): number => {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += rgba[i]!;
  return sum / (rgba.length / 4);
};

describe("A10 — the colour stage is laid on its own lattice", () => {
  it("keeps 2 px fewer per tile than the mono stage, and the span follows", () => {
    // § 6t.4, where it bites: the tile index is the cache key and the pitch is
    // what turns an index into a place. A colour stage tiled on the mono pitch
    // would draw a perfectly plausible picture registered 2 px out per tile.
    const mono = infoOf();
    const colour = infoOf({ wavelengths: 3 });
    expect(mono.usefulPixels - colour.usefulPixels).toBe(2);
    expect(colour.tilePixels).toBe(mono.tilePixels);
    // The span is the kept pixels on the ruler plane's own object scale, so it
    // moves with the pixels AND with the ruler — the bluest plane's scale is
    // smaller than the d line's, so a colour tile covers less than 46/48 of it.
    expect(colour.tileSpanUm).toBeLessThan((mono.tileSpanUm * 46) / 48);
    expect(tileOf(0, 0, { wavelengths: 3 }).size).toBe(colour.usefulPixels);
    expect(tileOf(0, 0).size).toBe(mono.usefulPixels);
  });

  it("reports the ruler plane and what the guard really was in each plane", () => {
    // The panel prints "guard 4 cells" over the slider; § 6t.3 measured that
    // exactly one plane gets 4, and it is the one whose grid the picture is on.
    // A stage that printed only the slider would be printing a third of it.
    const colour = infoOf({ wavelengths: 3 });
    expect(colour.ruler).not.toBeNull();
    const ruler = colour.ruler!;
    expect(ruler.planes).toHaveLength(3);
    // The bluest plane, and the least guarded — 4 cells asked plus the stack's
    // own 1 px crop, which is half a cell at 2 px per cell.
    expect(ruler.wavelengthNm).toBe(Math.min(...ruler.planes.map((p) => p.nm)));
    const at = (nm: number) => ruler.planes.find((p) => p.nm === nm)!.guardCells;
    expect(at(ruler.wavelengthNm)).toBeCloseTo(BASE.guardCells + 0.5, 12);
    for (const plane of ruler.planes) {
      expect(plane.guardCells).toBeGreaterThanOrEqual(at(ruler.wavelengthNm));
    }
    // Monotone in λ, which is the closed form's shape: the excess carries
    // (1 − s_ruler/s_λ) and s_λ is ∝ λ.
    const sorted = [...ruler.planes].sort((a, b) => a.nm - b.nm);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.guardCells).toBeGreaterThan(sorted[i - 1]!.guardCells);
    }
    expect(infoOf().ruler).toBeNull();
  });
});

describe("A10 — the white is the lamp's, not the tile's", () => {
  it("exposes on the lamp's NORMALIZED weights, which is where this went wrong", () => {
    // The exposure itself, pinned against an independently normalized lamp,
    // because the failure it guards against is a factor and not a shade.
    // `stackBrightfieldPlanes` divides the weights by their sum and
    // `colorImageFromStack` folds *those* into its basis, so a white computed
    // from the raw SED×Δλ weights is too large by their sum — 300 for three
    // equal-energy samples across 400–700 nm. The first version of `toColour`
    // did exactly that and every tile rendered near black; this rung is what
    // caught it, so it pins the number rather than the picture.
    const raw = lampSamples(BASE.lamp, 3);
    const total = raw.reduce((a, s) => a + s.weight, 0);
    const normalized = raw.map((s) => ({ nm: s.nm, weight: s.weight / total }));
    const lamp = spectralXyz(
      normalized,
      normalized.map(() => 1),
    );
    expect(clearFieldExposure(normalized)).toBeCloseTo(1 / (WHITE_INTENSITY * lamp.y), 12);

    // The raw weights are what the request carries, and taking the exposure off
    // them is off by their sum — the bug, as a ratio, so it cannot come back
    // quietly as "the picture looks a bit dark".
    expect(clearFieldExposure(raw) * total).toBeCloseTo(clearFieldExposure(normalized), 12);
    expect(total).toBeGreaterThan(100);

    // And it depends on the LAMP: a tungsten field is dimmer in Y for the same
    // Σ = 1 weights, so the exposure is a different number and the tile is not
    // simply tinted. (`lampSamples` normalization is the caller's, so both are
    // taken through the same door.)
    const tungsten = lampSamples("tungsten-3200", 3);
    const tungstenTotal = tungsten.reduce((a, s) => a + s.weight, 0);
    expect(
      clearFieldExposure(tungsten.map((s) => ({ nm: s.nm, weight: s.weight / tungstenTotal }))),
    ).not.toBeCloseTo(clearFieldExposure(normalized), 6);
  });

  it("reads the clear field the same in a fuller tile and an emptier one", () => {
    // The rung this panel exists to keep honest. `abbeImage` normalizes the
    // source weights to Σ = 1, so a clear field is intensity 1 wherever it is,
    // and the exposure here divides by the LAMP's Y and nothing else. So the
    // same clear field must land on the same byte in a tile that is mostly
    // specimen and one that is mostly empty — to the last bit.
    //
    // A per-frame exposure (A9's `renderSection`, one import away) cannot pass
    // this: it maps each tile's own mean to mid-grey, so the emptier tile's
    // clear field would come back DARKER than the fuller tile's and the seam
    // between them would carry a step the physics does not have.
    //
    // The **diatoms**, and the specimen is named rather than swept over: the
    // background of an Abbe image is not the clear field, because a nearby
    // absorber depresses it — measured here at 0.92 of one — and how far depends
    // on how much specimen is in reach. A dense ruled grid's modal background
    // therefore wanders 205 → 207 between these two tiles where the sparser
    // diatoms hold still, so what this rung pins is that a fixed exposure does
    // not ADD to that, not that the background is a constant of the lamp.
    //
    // Which tiles is not asserted either — the extremes are found by measuring,
    // so the rung does not depend on the authoring staying put.
    const peak = (rgba: Uint8ClampedArray): [number, number, number] => {
      let best = -1;
      let at = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const y = rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
        if (y > best) {
          best = y;
          at = i;
        }
      }
      return [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!];
    };

    const probed = [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ].map(([col, row]) => tileOf(col!, row!, { specimen: "diatom", wavelengths: 3 }));
    const means = probed.map((t) => mean(t.rgba));
    const full = probed[means.indexOf(Math.min(...means))]!;
    const empty = probed[means.indexOf(Math.max(...means))]!;

    // CONTROL first, because the equality below is worthless without it: the two
    // tiles really do carry different amounts of specimen. A per-frame exposure
    // would have normalized exactly this difference away.
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(1);
    expect(mode(full.rgba)).toBe(mode(empty.rgba));

    // …and the PEAK does not agree, by a byte — which is recorded rather than
    // asserted away. The brightest pixel of an Abbe image is a ringing overshoot
    // at an edge, and how far it overshoots is a property of the edge, so two
    // tiles with different content have every right to differ there. The flat
    // background is the clear field and the mode is what reads it; a rung that
    // pinned the peak would be pinning the specimen's authoring.
    const peaks = [peak(full.rgba)[0]!, peak(empty.rgba)[0]!];
    expect(Math.abs(peaks[0]! - peaks[1]!)).toBeLessThanOrEqual(2);
  });

  it("images in colour, where the mono stage images in grey", () => {
    // The picture claim, as one number: a mono tile's bytes are r = g = b by
    // construction, and a colour tile's are not — on a specimen (`ruled`) that
    // has NO wavelength anywhere in it, so what separates them is the
    // objective's own dispersion. § 6r's purple fringing, on the stage.
    const grey = tileOf(0, 0);
    for (let i = 0; i < grey.rgba.length; i += 4) {
      expect(grey.rgba[i]).toBe(grey.rgba[i + 1]);
      expect(grey.rgba[i]).toBe(grey.rgba[i + 2]);
    }
    expect(grey.verdictNm).toBeNull();

    const colour = tileOf(1, 0, { wavelengths: 3 });
    let coloured = 0;
    for (let i = 0; i < colour.rgba.length; i += 4) {
      if (colour.rgba[i] !== colour.rgba[i + 2]) coloured++;
    }
    expect(coloured).toBeGreaterThan(0.1 * (colour.rgba.length / 4));

    // And the verdict names its wavelength — § 6r.7's blue end, which the panel
    // has to surface because the plane that refuses is a plane and not a frame.
    expect(colour.verdictNm).not.toBeNull();
    expect(WHITE_INTENSITY).toBe(2);
  });
});

/**
 * Part F's cache key, and why it is not `JSON.stringify(spec)`.
 *
 * `SYSTEMS` is module-level inside an adapter that runs in a worker, so it spans
 * one worker's tiles: a stage asks for tens of them and the prescription does
 * not change between them. Until Part F it was keyed on a ten-member string
 * union, which cannot miss. A spec can: the object arrives fresh from a
 * structured clone every message, so identity is useless, and the key has to be
 * a value — one whose field order is this repo's rather than whatever the sender
 * happened to construct.
 */
describe("Part F — a spec is a cache key by value, in an order this app fixes", () => {
  const din = entryOf("din-4x-010").spec;

  it("is blind to the order the sender's object literal was built in", () => {
    // The same fields, assembled back-to-front. `Object.keys` order survives a
    // structured clone, so this is a shape a worker really can receive.
    const shuffled = Object.fromEntries(
      Object.entries(din).reverse(),
    ) as unknown as typeof din;
    expect(specKey(shuffled)).toBe(specKey(din));
  });

  it("separates two specs that differ in one field, including inside the slip", () => {
    expect(specKey({ ...din, numericalAperture: 0.15 })).not.toBe(specKey(din));
    expect(
      specKey({ ...din, coverslip: { kind: "slip", thicknessMm: 0.17, medium: "D263" } }),
    ).not.toBe(specKey(din));
    // The two slips differ only in a number nested one level down — the field
    // `JSON.stringify` on the whole spec would have carried, and the one a
    // hand-written list of top-level reads is most likely to drop.
    expect(
      specKey({ ...din, coverslip: { kind: "slip", thicknessMm: 0.17, medium: "D263" } }),
    ).not.toBe(
      specKey({ ...din, coverslip: { kind: "slip", thicknessMm: 0.23, medium: "D263" } }),
    );
  });

  it("gives every catalogue row its own key", () => {
    const keys = MICROSCOPE_CATALOG.map((e) => specKey(e.spec));
    expect(new Set(keys).size).toBe(MICROSCOPE_CATALOG.length);
  });
});
