import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, diffRgba, encodePng } from "./png";

/**
 * The golden-image gate, shared by every package that commits a reference render.
 *
 * It lives under `packages/core/test` because that is where the PNG codec has to
 * live (`png.ts` explains why: `node:zlib` cannot appear in `packages/core/src`),
 * and `packages/app`'s tests reach across to it. The reach is one-directional and
 * follows the dependency that already exists — app imports core, never the
 * reverse — so nothing new is coupled by it.
 *
 * **Regression, not validation**, as `png.ts` and VALIDATION.md both insist: a
 * golden proves a render has not changed, never that it was right. What makes a
 * particular golden trustworthy is whatever pinned the physics inside it before
 * the file was written.
 */

/**
 * The gate: 2/255 on any channel, 0.05/255 on the mean.
 *
 * Not an exact byte match. The render is deterministic in exact arithmetic, but
 * the last bit of a Float64 sum is not guaranteed identical across platforms and
 * a one-LSB difference on a gamma-encoded byte is not a regression.
 *
 * Both numbers are gates and `changedFraction` is not, which is a correction to
 * what this harness used to claim about itself. Measured against deliberately
 * damaged copies of the committed goldens (`golden.test.ts`'s gate rungs), the
 * fraction never fires where these two do not already: a defect big enough to
 * move 2.5% of pixels by the 2/255 the fraction counts has already moved the
 * mean past 0.05. It is still *reported*, because it is what tells a reader
 * whether a failure is one pixel or half the frame — a diagnostic, not a
 * threshold.
 */
export const MAX_CHANNEL_DELTA = 2;
export const MAX_MEAN_DELTA = 0.05;

export interface GoldenOptions {
  /** Directory holding the committed `<name>.png`. */
  readonly dir: string;
  /** Refresh instead of comparing — set from `UPDATE_GOLDEN=1`. */
  readonly update?: boolean;
}

/** `true` when the run was asked to rewrite goldens rather than check them. */
export const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";

/**
 * Compare `rgba` against the committed `<name>.png`, or write it if asked.
 *
 * Refresh with `UPDATE_GOLDEN=1 npx vitest run <file>`, and *look at the diff*
 * before committing it. An unexamined golden update is the harness failing
 * silently rather than the code passing.
 */
export function checkGolden(
  name: string,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: GoldenOptions,
): void {
  const update = options.update ?? UPDATE_GOLDEN;
  const path = join(options.dir, `${name}.png`);
  const png = encodePng(rgba, width, height);

  if (update || !existsSync(path)) {
    mkdirSync(options.dir, { recursive: true });
    writeFileSync(path, png);
    if (!update) {
      throw new Error(
        `no golden image for "${name}" — one has been written to ${path}. ` +
          `Inspect it, then commit it.`,
      );
    }
    return;
  }

  const reference = decodePng(readFileSync(path));
  if (reference.width !== width || reference.height !== height) {
    throw new Error(
      `${name} changed size: golden is ${reference.width}×${reference.height}, ` +
        `render is ${width}×${height}.`,
    );
  }
  const diff = diffRgba(rgba, reference.rgba);

  if (diff.maxChannelDelta > MAX_CHANNEL_DELTA || diff.meanChannelDelta > MAX_MEAN_DELTA) {
    // Write the actual somewhere the repo does not track, so the failure can be
    // looked at rather than only read about.
    const scratch = join(process.env.TEMP ?? "/tmp", "telemicroscope-golden");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, `${name}.actual.png`), png);
    throw new Error(
      `${name} drifted: max Δ ${diff.maxChannelDelta}/255, mean Δ ` +
        `${diff.meanChannelDelta.toFixed(4)}/255, ${(diff.changedFraction * 100).toFixed(2)}% of ` +
        `pixels changed. Actual written to ${join(scratch, `${name}.actual.png`)}.`,
    );
  }
}

/** Would the gate reject this pair? Exposed so the harness can test itself. */
export function gateRejects(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  const diff = diffRgba(a, b);
  return diff.maxChannelDelta > MAX_CHANNEL_DELTA || diff.meanChannelDelta > MAX_MEAN_DELTA;
}

/**
 * The three classic image defects, as operators on committed bytes.
 *
 * They exist so the gate can be pointed at damage of a known kind and asked
 * whether it notices — the negative control the harness was missing. Every one
 * of them is a defect that passes the entire validation ladder: none of them is
 * reachable by any assertion about a number.
 */

/** Translate by (dx, dy), filling the vacated edge with opaque black. */
export function shiftRgba(
  rgba: Uint8ClampedArray,
  width: number,
  dx: number,
  dy: number,
): Uint8ClampedArray {
  const height = rgba.length / 4 / width;
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destination = (y * width + x) * 4;
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
        out[destination + 3] = 255;
        continue;
      }
      const source = (sy * width + sx) * 4;
      for (let c = 0; c < 4; c++) out[destination + c] = rgba[source + c]!;
    }
  }
  return out;
}

/** Swap the two axes — a square image only, which every golden here is. */
export function transposeRgba(rgba: Uint8ClampedArray, width: number): Uint8ClampedArray {
  if (rgba.length !== width * width * 4) throw new Error("transposeRgba wants a square image");
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) out[(x * width + y) * 4 + c] = rgba[(y * width + x) * 4 + c]!;
    }
  }
  return out;
}

/**
 * Scale every colour channel, leaving alpha alone.
 *
 * Applied to the *encoded* bytes rather than to the linear image, which is what
 * makes it a stand-in for an exposure change rather than one: it is the cheapest
 * operator with the right signature — everything moves a little, nothing moves a
 * lot — and that signature is the point.
 */
export function scaleRgba(rgba: Uint8ClampedArray, factor: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgba[i + c]! * factor);
    out[i + 3] = rgba[i + 3]!;
  }
  return out;
}
