import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colorImageFromStack, integratedXyz, toSrgbBytes } from "../src/imaging/image";
import { decodePng, diffRgba, encodePng } from "./support/png";
import { heroPair, heroSystem, PSF_OPTIONS, renderHero } from "./support/heroScene";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import { quadratureSamples } from "../src/photometry/spectrum";
import { PointSource, rasterizePointSources } from "../src/imaging/scene";
import { renderField } from "../src/imaging/render";
import { spectralStack } from "../src/wave/polychromatic";
import { bestFocus, withFocus } from "../src/analysis/focus";

/**
 * Golden-image regression guard — roadmap step 4, not step 7.
 *
 * The validation ladder pins physics; **nothing pins images**. A flipped axis,
 * a swapped channel, an off-by-one centring, a resampling change or a different
 * exposure passes every rung in the suite and still ruins the picture. A
 * committed reference render plus a diff catches exactly that class.
 *
 * The distinction VALIDATION.md insists on holds here: **these are regression
 * checks, not validation.** A golden image proves the render has not changed;
 * it can never prove it was right. What makes these particular images
 * trustworthy is that `hero.test.ts` has already pinned the physics inside them
 * against closed forms — the golden file just stops it drifting afterwards.
 *
 * Refresh with `UPDATE_GOLDEN=1 npx vitest run packages/core/test/golden.test.ts`,
 * and *look at the diff* before committing it. An unexamined golden update is
 * the harness failing silently rather than the code passing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/**
 * Exposure, referenced to the TOTAL LIGHT IN THE FRAME: white is a pixel
 * holding 1/8000 of it.
 *
 * The reference matters more than the number. Both lenses collect the same
 * star through the same aperture, so their frames carry the same total energy —
 * measured at 1084 and 1081, agreeing to 0.3%, and asserted below. Exposing
 * both by that shared quantity is the only way the two images can be compared:
 * whatever difference is visible is then a difference in *where the light
 * went*, which is the entire claim.
 *
 * Auto-exposing each frame to a quantile of its own lit pixels — the obvious
 * choice, and the first one tried — silently defeats that. At the 98th
 * percentile the singlet came out at 219× and the achromat at 3010×, a 14×
 * mismatch, which flattered the achromat into a big white disc and made the
 * pair meaningless side by side. It is also non-deterministic in the way that
 * matters for a golden image: it moves when the *statistics* of the frame shift
 * while the physics stays put.
 *
 * The core clips, deliberately — that is how an overexposed star is
 * photographed, and the halo carrying the fringe sits ~10⁻³ of the peak, so an
 * exposure that kept the core unclipped would render the whole fringe black and
 * the golden image would "pass" while showing nothing.
 *
 * The ceiling is the render's own noise floor: resolving the aperture edge
 * leaves a residual plaid at ~4·10⁻⁶ of peak (`amplitudeGrid`), and this
 * exposure keeps sRGB's darkest encodable level above it.
 */
const WHITE_FRACTION_OF_TOTAL = 1 / 8000;

function renderBytes(prescription: Parameters<typeof renderHero>[0]): {
  rgba: Uint8ClampedArray;
  size: number;
  totalY: number;
} {
  const stack = renderHero(prescription).stack;
  const image = colorImageFromStack(stack);
  const totalY = integratedXyz(image).y;
  const exposure = 1 / (totalY * WHITE_FRACTION_OF_TOTAL);
  return { rgba: toSrgbBytes(image, { exposure }), size: image.width, totalY };
}

function checkGolden(name: string, rgba: Uint8ClampedArray, size: number): void {
  const path = join(GOLDEN_DIR, `${name}.png`);
  const png = encodePng(rgba, size, size);

  if (UPDATE || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, png);
    if (!UPDATE) {
      throw new Error(
        `no golden image for "${name}" — one has been written to ${path}. ` +
          `Inspect it, then commit it.`,
      );
    }
    return;
  }

  const reference = decodePng(readFileSync(path));
  expect(reference.width).toBe(size);
  const diff = diffRgba(rgba, reference.rgba);

  if (diff.maxChannelDelta > 2 || diff.meanChannelDelta > 0.05) {
    // Write the actual next to nothing the repo tracks, so the failure can be
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

describe("golden images (regression, NOT validation)", () => {
  // A 2/255 tolerance rather than an exact byte match: the render is
  // deterministic in exact arithmetic, but the last bit of a Float64 sum is not
  // guaranteed identical across platforms, and a one-LSB difference on a
  // gamma-encoded byte is not a regression. Anything that actually changed the
  // image moves far more than that — the three diff statistics are reported
  // together precisely because they fail differently.
  it("the singlet's star has not changed", () => {
    const { rgba, size } = renderBytes(heroPair().singlet);
    checkGolden("star-singlet", rgba, size);
  });

  it("the achromat's star has not changed", () => {
    const { rgba, size } = renderBytes(heroPair().achromat);
    checkGolden("star-achromat", rgba, size);
  });

  it("the two goldens are not accidentally the same image", () => {
    // The harness's own negative control. Two identical goldens would pass both
    // tests above forever while proving nothing at all — and that is exactly
    // what a copy-paste slip in the fixture would produce.
    const a = renderBytes(heroPair().singlet);
    const b = renderBytes(heroPair().achromat);
    const diff = diffRgba(a.rgba, b.rgba);
    expect(diff.changedFraction).toBeGreaterThan(0.05);
  });

  it("the star field has not changed", () => {
    // The first picture `renderField` has ever produced outside a unit test,
    // committed the day it was first looked at — closing the step-4 note that
    // its off-axis output had only ever been asserted about, never seen.
    //
    // The scene is chosen to make orientation and colour drift visible, not
    // pretty: a sun-like star on axis, a ring of four at the same field
    // radius on both diagonals and both axes (mirror and transpose partners,
    // the symmetries § 3c pins), and a hot/cold pair whose colour difference
    // exercises the per-source SED path in the picture itself. Any kernel
    // orientation slip shows as the ring losing its symmetry; any SED slip
    // shows as the pair's colours converging.
    const samples = quadratureSamples({ count: 5 });
    const base = { ...heroSystem(heroPair().achromat), wavelengths: samples };
    const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: 550 });
    const focused = withFocus(base, focus.offsetFromLastVertex);
    const pixelScaleMm = spectralStack(focused, 0, PSF_OPTIONS).pixelScaleMm;

    const sun = blackbodySpectrum(5800);
    const r = 0.04; // deg — inside the frame with the PSF fully on grid
    const d = r / Math.SQRT2;
    const stars: PointSource[] = [
      { fieldXDeg: 0, fieldYDeg: 0, flux: 1, spectrum: sun },
      { fieldXDeg: r, fieldYDeg: 0, flux: 1, spectrum: sun },
      { fieldXDeg: 0, fieldYDeg: r, flux: 1, spectrum: sun },
      { fieldXDeg: -d, fieldYDeg: -d, flux: 1, spectrum: sun },
      { fieldXDeg: d, fieldYDeg: -d, flux: 1, spectrum: blackbodySpectrum(9000) },
      { fieldXDeg: -d, fieldYDeg: d, flux: 1, spectrum: blackbodySpectrum(3200) },
    ];
    const scene = rasterizePointSources(focused, stars, samples, { size: 256, pixelScaleMm });
    const { image } = renderField(focused, scene, { ...PSF_OPTIONS, patches: 4 });
    const totalY = integratedXyz(image).y;
    // Same exposure discipline as the single stars: white is a pixel holding
    // a fixed fraction of the frame's total light — but the frame now carries
    // six stars, so the fraction is scaled by the count to keep each star's
    // halo in the same part of the response curve as the hero pair's.
    const exposure = 1 / (totalY * (WHITE_FRACTION_OF_TOTAL / stars.length));
    checkGolden("star-field", toSrgbBytes(image, { exposure }), image.width);
  });

  it("both frames carry the same total light, which is what lets them share an exposure", () => {
    // The assumption the shared exposure rests on, checked rather than assumed:
    // same star, same aperture, same glass count — so the difference between
    // the two pictures is where the light landed, never how much arrived. If
    // this drifted, the images would still diff cleanly and would silently stop
    // being comparable.
    const a = renderBytes(heroPair().singlet).totalY;
    const b = renderBytes(heroPair().achromat).totalY;
    expect(Math.abs(a - b) / a).toBeLessThan(0.02);
  });
});
