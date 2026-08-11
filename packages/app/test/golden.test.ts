import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGolden as checkGoldenIn } from "../../core/test/support/golden";
import { diffRgba } from "../../core/test/support/png";
import { entryOf, LAMBDA_NM } from "../src/microscope";
import { specimenOf } from "../src/specimens";
import {
  renderStageTile,
  stageInfo,
  WHITE_INTENSITY,
  type StageRequest,
  type StageTileReadout,
} from "../src/stage";

/**
 * Golden images for the **app's** picture — the stage, as `#/stage` draws it.
 *
 * The engine's goldens (`packages/core/test/golden.test.ts`) pin renders the
 * ladder formed; nothing pinned the ones the app composes, and APP.md § A10
 * records what that cost. Promoting the specimen library to spectral authoring
 * changed the monochrome stage's picture — a monochrome surface sees one
 * wavelength's *slice* of a spectrum, and the bands first chosen put the d line
 * at 0.195 of the cytoplasmic peak, so the cell bodies went from amplitude 0.55
 * to 0.80 and vanished into the ground. Every rung passed. The A9 rungs are all
 * about colour, and **no golden pinned that render**, so it was found by loading
 * the panel and looking at it.
 *
 * This file is that missing golden. Same status as the engine's, and the
 * distinction stays sharp: **regression, not validation.** It proves the stage's
 * picture has not changed, never that it is right — § 6m–§ 6t's rungs are what
 * pinned the physics inside it, and § A10's rungs pinned the wiring. The file
 * only stops it drifting afterwards.
 *
 * Refresh with `UPDATE_GOLDEN=1 npx vitest run packages/app/test/golden.test.ts`,
 * and *look at the picture* before committing it. An unexamined golden update is
 * the harness failing silently rather than the code passing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "golden");

/**
 * The panel's own defaults, verbatim — `panels/stage.tsx`'s initial state.
 *
 * Deliberately not a configuration chosen to be cheap or to look good: the
 * defect this file exists for was found by *opening the panel*, so what it pins
 * is the view the panel opens on. `size` is `2·pupilSamples` and S is `16/32`
 * because that is what the panel computes from its sliders' initial ticks; if
 * either drifts from the panel, this fixture is pinning a picture nobody sees.
 */
const BASE: StageRequest = {
  spec: entryOf("din-4x-010").spec,
  specimen: "section",
  pupilSamples: 32,
  size: 64,
  guardCells: 4,
  coherenceParameter: 16 / 32,
  wavelengths: 0,
  lamp: "equal-energy",
};

/** The 2×2 block of tiles anchored on the stage's origin tile. */
const BLOCK = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
] as const;

interface Composed {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly tiles: readonly StageTileReadout[];
}

/**
 * Render the block and lay it out exactly as the panel's canvas does.
 *
 * **Four tiles, not one, and that is structural.** `stage.ts` warns in A7's own
 * words that a per-tile exposure would paint a brightness step at every seam — a
 * grid the physics does not have. A single-tile golden is blind to precisely
 * that failure: one tile has no seam to step across, so the picture would look
 * perfect while the surface's most-documented hazard went unwatched. A 2×2 block
 * puts three seams inside the frame.
 *
 * The pitch is `usefulPixels` off `stageInfo`, which is what `panels/stage.tsx`
 * places tiles on (`tile.col * useful`). It is asserted equal to the tile's own
 * width rather than assumed: § 6t.4's registration bug is exactly a pitch that
 * disagrees with the tile by 2 px, and it draws a perfectly plausible picture.
 */
function compose(over: Partial<StageRequest> = {}): Composed {
  const request = { ...BASE, ...over };
  const info = stageInfo(request);
  if (!info.ok) throw new Error(info.error);
  const pitch = info.info.usefulPixels;

  const width = 2 * pitch;
  const rgba = new Uint8ClampedArray(width * width * 4);
  const tiles: StageTileReadout[] = [];

  for (const { col, row } of BLOCK) {
    const result = renderStageTile({ ...request, col, row });
    if (!result.ok) throw new Error(`tile ${col},${row}: ${result.error}`);
    const tile = result.readout;
    expect(tile.size).toBe(pitch);
    for (let y = 0; y < tile.size; y++) {
      const source = y * tile.size * 4;
      const destination = ((row * pitch + y) * width + col * pitch) * 4;
      rgba.set(tile.rgba.subarray(source, source + tile.size * 4), destination);
    }
    tiles.push(tile);
  }
  return { rgba, width, tiles };
}

function checkGolden(name: string, composed: Composed): void {
  checkGoldenIn(name, composed.rgba, composed.width, composed.width, { dir: GOLDEN_DIR });
}

describe("the stage's picture (regression, NOT validation)", () => {
  it("the monochrome stage has not changed", () => {
    // The render APP.md § A10 records as having changed under everyone's nose.
    // It is the d-line slice of a spectral specimen, so it moves whenever the
    // *authoring* moves — which is the class of change no rung in this repo
    // watches, because every one of them is about a number the authoring is not.
    const composed = compose();
    // Honest at these settings, and the picture is only worth pinning while it
    // is: a verdict flip would change what the image means without necessarily
    // changing enough bytes to trip the gate.
    for (const tile of composed.tiles) expect(tile.verdict).toBe("valid");
    checkGolden("stage-section-mono", composed);
  });

  it("the colour stage has not changed", () => {
    // § 6t's branch, at the panel's own default wavelength count.
    //
    // The verdict here is **no-honest-image**, and it is asserted rather than
    // avoided: at 32 pupil samples the bluest plane runs 0.45 waves per sample,
    // which puts about a quarter of the PSF on the ray branch — the panel says
    // so on screen. Pinning the picture the panel actually opens on is worth
    // more than pinning a prettier one at settings nobody selects, and the
    // assertion is what stops the golden quietly becoming a record of a
    // different regime. (Honest costs `pupilSamples` 64 at grid 128: measured
    // 1.9 s a tile against 0.14 s here, for a picture no default reaches.)
    const composed = compose({ wavelengths: 3 });
    for (const tile of composed.tiles) expect(tile.verdict).toBe("no-honest-image");
    checkGolden("stage-section-colour", composed);
  });

  it("the four tiles are not accidentally the same tile", () => {
    // The fixture's negative control, in the form this surface makes it fail.
    //
    // A mosaic is indexed, and the way an indexed render dies quietly is by
    // ignoring the index: a cache keyed on something that does not include
    // col/row, an anchor used where a tile belongs, a worker replying with the
    // request it still had. All of them compose four copies of one tile into a
    // picture that tiles perfectly and is wrong, and a golden written from that
    // would defend it forever.
    const composed = compose();
    for (let i = 1; i < composed.tiles.length; i++) {
      const diff = diffRgba(composed.tiles[0]!.rgba, composed.tiles[i]!.rgba);
      expect(diff.changedFraction).toBeGreaterThan(0.05);
    }
  });

  it("the cell bodies are still in the picture, at the level the dye predicts", () => {
    // The one rung that *names* the defect instead of merely detecting it.
    //
    // A golden fails with "drifted"; this fails with "the cell bodies faded",
    // which is the sentence nobody had when the authoring moved under the
    // panel. The two are worth keeping side by side: the golden covers every
    // way this picture can change, and this covers the one way it already did.
    //
    // The level is **read off the specimen**, never typed in — so the rung
    // tracks a legitimate re-authoring of the dye and fails only when the dye
    // stops absorbing at the wavelength the monochrome stage binds it at. The
    // cytoplasm plateau is the commonest stained value in the object plane
    // (cell interiors are broad and flat; nuclei are 0.4 of a cell's radius, so
    // 16% of its area, and the ramps between them are a thin population).
    const specimen = specimenOf("section").specimen;
    const buckets = new Map<number, number>();
    const step = 0.0005; // mm — 0.5 µm over a 100 µm square, several cells wide
    for (let y = 0; y < 0.1; y += step) {
      for (let x = 0; x < 0.1; x += step) {
        const a = specimen(x, y, LAMBDA_NM);
        const intensity = a.re * a.re + a.im * a.im;
        if (intensity > 0.98) continue; // the clear ground, which is not a dye
        const bucket = Math.round(intensity * 256);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }
    }
    let plateau = 0;
    let most = 0;
    for (const [bucket, count] of buckets) {
      if (count > most) {
        most = count;
        plateau = bucket / 256;
      }
    }
    // 0.284 — amplitude 0.533, which is § A10's "cytoplasm back to 0.53".
    expect(plateau).toBeGreaterThan(0.25);
    expect(plateau).toBeLessThan(0.32);

    // And it has to be *in the frame*, in the quantity a field of cells implies.
    // **Measured: 12.0%** of pixels at or under it. The other end of the
    // threshold is an *estimate* and is marked as one, because the authoring it
    // describes cannot be rendered any more — the old band is gone and the
    // specimen takes no injection point, so there is nothing to measure. With
    // the cytoplasmic band at 530/45 (0.195 of its peak at the d line) the cell
    // bodies image at amplitude 0.776 rather than 0.533, well above this level,
    // and the surviving population would be the nuclei alone — on the order of
    // 5%, a nucleus being 0.4 of a cell's radius and so 16% of its area. The
    // threshold is set between the measurement and that reasoning, nearer the
    // reasoning, since only one of the two is a fact.
    const level = (255 * plateau) / WHITE_INTENSITY;
    const { rgba } = compose();
    let stained = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! <= level) stained++;
    expect(stained / (rgba.length / 4)).toBeGreaterThan(0.09);
  });

  it("the colour golden is in colour, which its own bytes have to say", () => {
    // The other way a fixture slips: `wavelengths` lost on the way to the
    // render leaves the colour golden holding the mono path's picture. The two
    // are different sizes (§ 6t.4's 2 px), so that alone is caught — but a
    // *tinted grey* stack is the same size and the same shape, and it is the
    // failure § 3b's negative control was written about one layer down.
    //
    // So the bytes are asked directly: some pixel of the colour frame has to be
    // off-grey, and no pixel of the mono frame may be.
    const mono = compose();
    const colour = compose({ wavelengths: 3 });
    expect(colour.width).not.toBe(mono.width);

    const spread = (rgba: Uint8ClampedArray): number => {
      let worst = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        worst = Math.max(worst, Math.max(r, g, b) - Math.min(r, g, b));
      }
      return worst;
    };
    expect(spread(mono.rgba)).toBe(0);
    expect(spread(colour.rgba)).toBeGreaterThan(8);
  });
});
