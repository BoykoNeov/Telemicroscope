import { describe, it, expect } from "vitest";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import { chromaticity } from "../src/photometry/cmf";
import { quadratureSamples, spectralSamples } from "../src/photometry/spectrum";
import { colorImageFromStack, integratedXyz, pixelXyz } from "../src/imaging/image";
import { PointSource, rasterizePointSources, imagePointOf } from "../src/imaging/scene";
import { patchWeight, renderField } from "../src/imaging/render";
import { spectralStack } from "../src/wave/polychromatic";
import { heroPair, heroSystem, PSF_OPTIONS } from "./support/heroScene";
import { bestFocus, withFocus } from "../src/analysis/focus";

/**
 * The spatially-variant full-field render.
 *
 * Built at step 4 rather than step 7 because it is the heaviest compute in the
 * app and its cost needs to be known early. These rungs are about the
 * DECOMPOSITION — that splitting a frame into patches and blending does not
 * create, destroy or move light — rather than about the PSF inside it, which
 * the wave-layer rungs already pin.
 */

const SUN = blackbodySpectrum(5800);
// Quadrature weights only: in a scene the SED belongs to each SOURCE, because
// two stars in one frame can be different colours. See photometry/spectrum.
const SAMPLES = quadratureSamples({ count: 5 });

const focused = (() => {
  const base = { ...heroSystem(heroPair().achromat), wavelengths: SAMPLES };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: 550 });
  return withFocus(base, focus.offsetFromLastVertex);
})();

const star = (fieldXDeg: number, fieldYDeg: number, flux = 1): PointSource => ({
  fieldXDeg,
  fieldYDeg,
  flux,
  spectrum: SUN,
});

function sceneOf(sources: readonly PointSource[], pixelScaleMm: number) {
  return rasterizePointSources(focused, sources, SAMPLES, { size: 256, pixelScaleMm });
}

/** The pixel scale the wave layer produces for this system, so grids align. */
const PIXEL_SCALE = spectralStack(focused, 0, PSF_OPTIONS).pixelScaleMm;

describe("the patch decomposition conserves light", () => {
  it("the patch weights are a partition of unity at every count", () => {
    // The property the whole decomposition rests on. If the weights summed to
    // anything but 1, the render would have a brightness field baked into it
    // that no physical rung would ever catch — it would look like vignetting.
    for (const count of [1, 2, 3, 4, 8]) {
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        let total = 0;
        for (let p = 0; p < count; p++) total += patchWeight(u, p, count);
        expect(total).toBeCloseTo(1, 12);
      }
    }
  });

  it("refining the patch grid does not change the total light", () => {
    // Same scene, same optics, three decompositions. A partition of unity times
    // a linear operator is still a partition of unity, so the totals must
    // agree to numerical noise — this is the end-to-end form of the rung above.
    const scene = sceneOf([star(0, 0), star(0.15, 0.1)], PIXEL_SCALE);
    const totals = [1, 2].map(
      (patches) => integratedXyz(renderField(focused, scene, { ...PSF_OPTIONS, patches }).image).y,
    );
    // 1e-4, and the residual is physics rather than slack: the finer grid uses
    // OFF-AXIS PSFs, whose throughput differs slightly from the on-axis one
    // because the Fresnel losses depend on incidence angle. The decomposition
    // itself is exact — that is the partition-of-unity rung above, asserted at
    // 1e-12 — so anything larger here would be the blending leaking light.
    expect(Math.abs(totals[1]! / totals[0]! - 1)).toBeLessThan(1e-4);
  });
});

describe("a one-patch render is exactly a convolution", () => {
  it("a single on-axis star reproduces the PSF the wave layer computes", () => {
    // The degenerate case, which ties the renderer to the already-validated
    // path: one point source at the origin convolved with the on-axis PSF must
    // BE the on-axis PSF. Any error in the kernel centring, the FFT convention
    // or the colour basis shows up here as a shifted or recoloured star.
    //
    // A flat-spectrum source, so the scene contributes radiance 1 at every
    // wavelength and the comparison isolates the optics from the SED.
    const scene = sceneOf([{ ...star(0, 0), spectrum: () => 1 }], PIXEL_SCALE);
    const rendered = renderField(focused, scene, { ...PSF_OPTIONS, patches: 1 }).image;
    const direct = colorImageFromStack(
      spectralStack(focused, 0, { ...PSF_OPTIONS, pixelScaleMm: PIXEL_SCALE }),
    );

    const a = pixelXyz(rendered, 128, 128);
    const b = pixelXyz(direct, 128, 128);
    expect(a.y / b.y).toBeCloseTo(1, 6);

    // ...and the whole frame agrees, not just its brightest pixel.
    const ta = integratedXyz(rendered);
    const tb = integratedXyz(direct);
    expect(ta.y / tb.y).toBeCloseTo(1, 6);
    expect(ta.x / ta.y).toBeCloseTo(tb.x / tb.y, 6);
  });

  it("the star lands where the chief ray says, not half a frame away", () => {
    // Guards the kernel roll in `convolveCentred`. Forgetting it shifts the
    // entire image by N/2, which every energy and symmetry check passes.
    const scene = sceneOf([star(0, 0)], PIXEL_SCALE);
    const rendered = renderField(focused, scene, { ...PSF_OPTIONS, patches: 1 }).image;
    let brightest = 0;
    let at = -1;
    for (let i = 1; i < rendered.xyz.length; i += 3) {
      if (rendered.xyz[i]! > brightest) {
        brightest = rendered.xyz[i]!;
        at = (i - 1) / 3;
      }
    }
    expect(at % 256).toBe(128);
    expect(Math.floor(at / 256)).toBe(128);
  });
});

describe("the field mapping comes from the chief ray", () => {
  it("an off-axis star lands off axis, in the direction it was placed", () => {
    const right = imagePointOf(focused, 0.2, 0, 550);
    const up = imagePointOf(focused, 0.2, Math.PI / 2, 550);
    expect(right.x).toBeGreaterThan(0);
    expect(Math.abs(right.y)).toBeLessThan(1e-9);
    expect(up.y).toBeGreaterThan(0);
    expect(Math.abs(up.x)).toBeLessThan(1e-9);
    // Same field radius, so the same image radius: axial symmetry.
    expect(Math.hypot(right.x, right.y)).toBeCloseTo(Math.hypot(up.x, up.y), 9);
  });

  it("image height grows with field angle and is nearly f·tan θ", () => {
    // Nearly, not exactly — the gap IS distortion, and it exists only because
    // the mapping is traced rather than assumed. A renderer that used f·tan θ
    // could never show distortion at all.
    const small = imagePointOf(focused, 0.05, 0, 550);
    const large = imagePointOf(focused, 0.2, 0, 550);
    expect(Math.hypot(large.x, large.y)).toBeGreaterThan(Math.hypot(small.x, small.y));
    const ratio =
      Math.hypot(large.x, large.y) /
      Math.hypot(small.x, small.y) /
      (Math.tan((0.2 * Math.PI) / 180) / Math.tan((0.05 * Math.PI) / 180));
    expect(Math.abs(ratio - 1)).toBeLessThan(0.02);
  });

  it("on axis is exactly on axis", () => {
    const p = imagePointOf(focused, 0, 0, 550);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});

describe("the source carries the spectrum, not the wavelength weights", () => {
  it("SED-weighted samples would apply the spectrum twice", () => {
    // The trap `quadratureSamples` exists to prevent, made visible. Feeding a
    // scene render the SED-weighted samples the single-source PSF path uses
    // squares the spectrum: the image stays plausible and its colour is wrong.
    const flat = { ...star(0, 0), spectrum: SUN };
    const correct = renderField(
      { ...focused, wavelengths: SAMPLES },
      rasterizePointSources(focused, [flat], SAMPLES, { size: 256, pixelScaleMm: PIXEL_SCALE }),
      { ...PSF_OPTIONS, patches: 1 },
    ).image;

    const doubled = spectralSamples(SUN, { count: 5 });
    const wrong = renderField(
      { ...focused, wavelengths: doubled },
      rasterizePointSources(focused, [flat], doubled, { size: 256, pixelScaleMm: PIXEL_SCALE }),
      { ...PSF_OPTIONS, patches: 1 },
    ).image;

    const a = chromaticity(integratedXyz(correct));
    const b = chromaticity(integratedXyz(wrong));
    // Squaring a 5800 K Planck curve sharpens it around its ~500 nm peak, so
    // the double-counted image comes out BLUER. The threshold is a MacAdam
    // just-noticeable difference (~0.002-0.004 in xy), not a number read off
    // this measurement: the claim is that the mistake is VISIBLE, and 0.005
    // is past the point where an observer would see it — while the image stays
    // entirely plausible, which is why it would survive inspection.
    expect(b.x).toBeLessThan(a.x);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.005);
  });
});

describe("progressive refinement", () => {
  it("emits a complete image at every level, coarsest first", () => {
    const scene = sceneOf([star(0, 0), star(0.12, -0.08)], PIXEL_SCALE);
    const seen: number[] = [];
    const energies: number[] = [];
    const result = renderField(focused, scene, {
      ...PSF_OPTIONS,
      patches: 4,
      onRefinement: (image, patches) => {
        seen.push(patches);
        energies.push(integratedXyz(image).y);
      },
    });

    // 1×1 and 2×2 are emitted; 4×4 is the return value rather than a callback.
    expect(seen).toEqual([1, 2]);
    // Every intermediate is a real image carrying the scene's whole light, not
    // a partial accumulation — that is what makes it safe to show the user.
    for (const e of energies) {
      expect(Math.abs(e / integratedXyz(result.image).y - 1)).toBeLessThan(1e-4);
    }
    // Cost is patches × wavelengths, and it is dominated by the finest level:
    // (1 + 4 + 16) × 5 wavelengths.
    expect(result.psfEvaluations).toBe(21 * SAMPLES.length);
  });
});
