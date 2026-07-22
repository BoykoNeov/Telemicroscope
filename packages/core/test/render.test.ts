import { describe, it, expect } from "vitest";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import { chromaticity } from "../src/photometry/cmf";
import { quadratureSamples, spectralSamples } from "../src/photometry/spectrum";
import { colorImageFromStack, integratedXyz, pixelXyz } from "../src/imaging/image";
import { PointSource, rasterizePointSources, imagePointOf } from "../src/imaging/scene";
import { patchWeight, renderField, rotateKernel } from "../src/imaging/render";
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

describe("the kernel is turned to face its own azimuth", () => {
  /**
   * A PSF is always traced for a field point on ONE axis — `fieldDirection`
   * tilts the incoming bundle in the x–z plane, so the traced kernel faces
   * **+x** — and convolution is shift-invariant, so whatever orientation that
   * kernel has gets stamped onto every star in the patch. Placement was
   * already rotated (`imagePointOf` carries the azimuth), so without rotating
   * the kernel too the stars land in the right places wearing the wrong
   * shape: every coma tail in the frame pointing the same way, which reads as
   * a decentred or tilted system — a fault this engine will later simulate on
   * purpose.
   *
   * The renderer therefore turns each patch's kernel by exactly the patch's
   * azimuth. That the trace faces +x, not the +y this code originally
   * believed, was established by the symmetry rungs in the next block — see
   * VALIDATION § 3c for the 0.049 story.
   */
  const N = 32;
  const C = N / 2;
  const OFFSET = 8;

  /** A kernel with one bright pixel along +x — the axis the trace uses. */
  const arrow = (): Float64Array => {
    const k = new Float64Array(N * N);
    k[C * N + (C + OFFSET)] = 1; // row C, column C+OFFSET  →  +x
    return k;
  };

  const brightest = (k: Float64Array): { x: number; y: number } => {
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < k.length; i++) {
      if (k[i]! > best) {
        best = k[i]!;
        at = i;
      }
    }
    return { x: at % N, y: Math.floor(at / N) };
  };

  it("a +x feature rotates to +y for a patch on the +y axis", () => {
    // The renderer uses θ = azimuth, because the traced kernel already faces
    // azimuth 0. A patch at azimuth 90° therefore asks for θ = +90°, and the
    // feature must land on +y. Getting this sign backwards puts every flare
    // on the wrong side of every star — the image stays sharp, symmetric
    // under nothing, and completely plausible.
    const turned = rotateKernel(arrow(), N, Math.PI / 2);
    const p = brightest(turned);
    expect(p.x).toBe(C);
    expect(p.y).toBe(C + OFFSET);
  });

  it("and to −x for a patch on the −x axis", () => {
    const turned = rotateKernel(arrow(), N, Math.PI);
    const p = brightest(turned);
    expect(p.x).toBe(C - OFFSET);
    expect(p.y).toBe(C);
  });

  it("a patch on the +x axis needs no rotation at all", () => {
    // Azimuth 0 is where the trace already is, so θ = 0 and the kernel is
    // passed through untouched — no interpolation, no loss.
    const source = arrow();
    // Returned by reference, not resampled: no interpolation loss on the one
    // azimuth where the trace already points the right way.
    expect(rotateKernel(source, N, 0)).toBe(source);
    const p = brightest(rotateKernel(source, N, 0));
    expect(p.x).toBe(C + OFFSET);
    expect(p.y).toBe(C);
  });

  it("rotation conserves energy exactly", () => {
    // The kernel's sum IS the transmitted energy the matched-normalization
    // discipline rests on, and bilinear resampling does not preserve it by
    // itself — `rotateKernel` renormalizes, and this is what says so.
    const sum = (k: Float64Array) => k.reduce((a, b) => a + b, 0);
    for (const angle of [0.3, -1.1, Math.PI / 3, 2.5]) {
      expect(sum(rotateKernel(arrow(), N, angle))).toBeCloseTo(sum(arrow()), 12);
    }
  });

  it("a real off-axis PSF is genuinely changed by being turned", () => {
    // Guards against the rungs above passing on a kernel that is rotationally
    // symmetric anyway, in which case rotating it would be a no-op and the
    // renderer's orientation could never be tested by any of this.
    const stack = spectralStack(focused, 0.06, PSF_OPTIONS);
    const kernel = stack.planes[Math.floor(stack.planes.length / 2)]!.intensity;
    const turned = rotateKernel(kernel, stack.size, Math.PI / 2);
    let difference = 0;
    let total = 0;
    for (let i = 0; i < kernel.length; i++) {
      difference += Math.abs(kernel[i]! - turned[i]!);
      total += kernel[i]!;
    }
    // Only 4.9% on this f/10 achromat at 0.06 deg. Small — but the symmetry
    // rungs below discriminate at 3500× despite it, because a wrongly-turned
    // kernel injects its full field-axis asymmetry into a metric whose correct
    // reading is interpolation-level. See VALIDATION § 3c.
    expect(difference / total).toBeGreaterThan(0.04);
  });
});

describe("the rendered field is symmetric the way the optics is", () => {
  /**
   * An axially symmetric system is symmetric under reflection in any plane
   * containing its axis, and so must every rendered frame be once the scene
   * is. These rungs are the end-to-end orientation pins whose predecessor was
   * withdrawn at step 4 for having no teeth — the 0.049 residual recorded in
   * VALIDATION § 3c, which turned out to be a real 90° orientation bug: the
   * renderer turned every kernel by azimuth − 90°, believing the traced
   * kernel faced +y when `fieldDirection` in fact tilts the field in the x–z
   * plane. Under that defect both variants of the old metric read ~0.05 (the
   * kernel's own field-axis asymmetry passing straight through), so toggling
   * the rotation moved it by only 4% and the rung condemned itself instead of
   * the code.
   *
   * Two different reflections are needed, because they catch different
   * defects. A mirror PAIR (two stars at ±x) is structurally blind to a
   * rotation-sense flip: flipping the sense conjugates the whole render by a
   * reflection, which maps the mirrored pair to itself — measured, the metric
   * does not move at all. The TRANSPOSE rung — one star on the +45° diagonal,
   * frame compared against its own transpose, i.e. reflected in the plane
   * containing the axis and the star — catches axis error, sense flip and
   * missing rotation alike: each stamps a kernel turned 90° from radial onto
   * the star, and reads ~0.05 against a correct ~1e-5.
   */
  const FIELD = 0.04; // deg — lands ~102 px off centre, safely on the frame

  /** Σ|I − I∘reflect| / ΣI on the Y channel. */
  const asymmetry = (
    xyz: Float64Array,
    n: number,
    reflect: (x: number, y: number) => number,
  ): number => {
    let diff = 0;
    let total = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = xyz[(y * n + x) * 3 + 1]!;
        diff += Math.abs(a - xyz[reflect(x, y) * 3 + 1]!);
        total += a;
      }
    }
    return diff / total;
  };

  it("the off-axis kernel is asymmetric along the field axis and ONLY there", () => {
    // The premise of the rotation convention, pinned to pure symmetry: a
    // field displacement along x̂ can only break the x-symmetry. Any
    // asymmetry across the x–z plane (mirrorY) is numerical artifact, and
    // measures at the same ~1.6e-5 as the on-axis plaid floor — while the
    // field-axis asymmetry is real physics three orders of magnitude above
    // it. This is what told us which way the traced kernel faces, and it is
    // what a transposed FFT grid or a swapped OPD axis would break.
    const stack = spectralStack(focused, FIELD, { ...PSF_OPTIONS, pixelScaleMm: PIXEL_SCALE });
    const k = stack.planes[Math.floor(stack.planes.length / 2)]!.intensity;
    const n = stack.size;
    let alongField = 0;
    let acrossField = 0;
    let total = 0;
    for (let y = 0; y < n; y++) {
      const ym = (n - y) % n;
      for (let x = 0; x < n; x++) {
        const xm = (n - x) % n;
        const v = k[y * n + x]!;
        alongField += Math.abs(v - k[y * n + xm]!);
        acrossField += Math.abs(v - k[ym * n + x]!);
        total += v;
      }
    }
    expect(acrossField / total).toBeLessThan(1e-4);
    expect(alongField / total).toBeGreaterThan(0.02);
  });

  it("two stars at ±x render as mirror images", () => {
    // Reflection about the y–z plane, which on this grid is x → (n−x) mod n
    // about the optical axis at column n/2. Correct reading 2.2e-4 (window
    // half-pixel offsets and interpolation); the orientation defect read
    // 0.046. The bound sits 9× under the defect and 20× over the measurement.
    const scene = rasterizePointSources(
      focused,
      [
        { ...star(FIELD, 0), spectrum: () => 1 },
        { ...star(-FIELD, 0), spectrum: () => 1 },
      ],
      SAMPLES,
      { size: 256, pixelScaleMm: PIXEL_SCALE },
    );
    const out = renderField(focused, scene, { ...PSF_OPTIONS, patches: 2 });
    const metric = asymmetry(out.image.xyz, 256, (x, y) => y * 256 + ((256 - x) % 256));
    expect(metric).toBeLessThan(0.005);
  });

  it("one star on the diagonal renders symmetric under transpose", () => {
    // The sense-catcher. Reflection in the plane containing the axis and the
    // star is the transpose of the frame, and it is exact on the grid — the
    // diagonal passes through the axis pixel. Correct reading 1.0e-5; axis
    // bug, sense flip and missing rotation each read 0.035–0.052.
    const d = FIELD / Math.SQRT2;
    const scene = rasterizePointSources(focused, [{ ...star(d, d), spectrum: () => 1 }], SAMPLES, {
      size: 256,
      pixelScaleMm: PIXEL_SCALE,
    });
    const out = renderField(focused, scene, { ...PSF_OPTIONS, patches: 2 });
    const metric = asymmetry(out.image.xyz, 256, (x, y) => x * 256 + y);
    expect(metric).toBeLessThan(0.002);
  });
});
