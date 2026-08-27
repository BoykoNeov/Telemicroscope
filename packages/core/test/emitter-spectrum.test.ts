import { describe, it, expect } from "vitest";
import { objectFieldTile, tracedFieldPupils, tracedPupil } from "../src/imaging/object-field";
import { radialMapCovering } from "../src/imaging/radial-map";
import {
  discEmitter,
  gaussianEmitter,
  rasterizeEmitterDensity,
  type EmitterDensity,
} from "../src/imaging/emitter-density";
import {
  incoherentImage,
  pupilThroughput,
  incoherentPsf,
  renderFluorescence,
} from "../src/imaging/fluorescence";
import {
  atEmissionWavelength,
  channelBasis,
  channelCrosstalk,
  fluorescenceSpectralStack,
  formEmitterPlane,
  labelledEmitters,
  neutralEmitterDensity,
  stackEmitterPlanes,
  type FluorescenceSpectrumOptions,
  type SpectralEmitterDensity,
} from "../src/imaging/emitter-spectrum";
import { boxcarBand, emissionSamples } from "../src/imaging/emission";
import { idealPupil } from "../src/illumination/transfer";
import { colorImageFromStack, pixelXyz } from "../src/imaging/image";
import { quadratureSamples, spectralXyzBasis } from "../src/photometry/spectrum";
import { resampleEnergyGrid, resampleIrradianceGrid } from "../src/wave/polychromatic";
import { fft2d } from "../src/math/fft";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem, WavelengthSample } from "../src/trace/system";

/**
 * § 6ba — the spectral emitter density, and § 6as's last deferral.
 *
 * § 6as closed the extended fluorescent specimen, § 6az the volumetric one, and
 * both left the same sentence behind: `rasterizeEmitters` has no spectrum
 * either, so this is "a seam that already works — and it becomes a gap the
 * moment a specimen's *emission colour* varies with position, which is what a
 * two-stain preparation is."
 *
 * The step's first job is to notice that `imaging/emission`'s header bundles two
 * *different* failures under one name. It says a single-label specimen factors
 * as `E(x)·w(λ)`, so the whole band collapses into one kernel, and that "a
 * two-label specimen does not factor that way, and that is the colour deferral".
 * Two things are wrong with joining those:
 *
 *  - **Colour needs the planes kept apart even for ONE label** (§ 6ba.5), because
 *    a collapse has already summed away the axis colour is integrated along.
 *    Nothing about the label count enters, and the *mechanism* on a real
 *    objective turns out to be its axial colour rather than diffraction — which
 *    only an ideal-pupil control can say.
 *  - **Two labels break the factorization even for a MONOCHROME readout**
 *    (§ 6ba.6), because the sum over labels moves through the convolution once
 *    per label. Nothing about colour enters.
 *
 * The external anchors are `∫B·T/∫B` for the crosstalk (§ 6ba.8, exact under
 * midpoint quadrature whenever the edges are bin boundaries — a theorem, since
 * the integrand is then piecewise constant), `πR²` for a disc's flux (§ 6ba.4),
 * `1/k²` for the wrong resampler (§ 6ba.3), and a **linear** law for lateral
 * colour, which is what makes § 6ba.9's channel misregistration a magnification
 * difference rather than a distortion.
 *
 * **No optics are added.** Every ray was traced by § 6s and every kernel built by
 * § 6i; what is new is that the density reads a wavelength.
 */

const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const SIZE = 64;
const PS = 24;
const NODES = 128;

/** Nine samples across 400–700 nm: bins 33.333 nm wide, edges on multiples of it. */
const SAMPLES: WavelengthSample[] = quadratureSamples({ count: 9 });

const BASE = {
  size: SIZE,
  pupilSamples: PS,
  samples: SAMPLES,
  radialMapNodes: NODES,
} satisfies FluorescenceSpectrumOptions;

const total = (v: Float64Array): number => {
  let s = 0;
  for (const x of v) s += x;
  return s;
};

const chromaticity = (x: number, y: number, z: number): { x: number; y: number } => {
  const s = x + y + z;
  return { x: x / s, y: y / s };
};

const pixelChromaticity = (
  img: ReturnType<typeof colorImageFromStack>,
  x: number,
  y: number,
): { x: number; y: number } => {
  const p = pixelXyz(img, x, y);
  return chromaticity(p.x, p.y, p.z);
};

const integratedChromaticity = (
  img: ReturnType<typeof colorImageFromStack>,
): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < img.xyz.length; i += 3) {
    x += img.xyz[i]!;
    y += img.xyz[i + 1]!;
    z += img.xyz[i + 2]!;
  }
  return chromaticity(x, y, z);
};

/** The `Y`-weighted centroid over a window SYMMETRIC about the grid centre. */
const centroid = (
  img: ReturnType<typeof colorImageFromStack>,
): { x: number; y: number } => {
  const n = img.width;
  const c = n >> 1;
  const reach = Math.min(c, n - 1 - c);
  let f = 0;
  let sx = 0;
  let sy = 0;
  for (let y = c - reach; y <= c + reach; y++) {
    for (let x = c - reach; x <= c + reach; x++) {
      const v = img.xyz[(y * n + x) * 3 + 1]!;
      f += v;
      sx += v * x;
      sy += v * y;
    }
  }
  return { x: sx / f, y: sy / f };
};

const frameAt = (nm: number, centreMm = { x: 0, y: 0 }) =>
  objectFieldTile(SYSTEM, { size: SIZE, pupilSamples: PS, wavelengthNm: nm, centreMm });

/** Circular convolution in DC-at-0 layout — `incoherentImage`'s own. */
function convolve(object: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const objRe = Float64Array.from(object);
  const objIm = new Float64Array(n * n);
  const kerRe = Float64Array.from(kernel);
  const kerIm = new Float64Array(n * n);
  fft2d(objRe, objIm, n);
  fft2d(kerRe, kerIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = objRe[i]!;
    const ai = objIm[i]!;
    const br = kerRe[i]!;
    const bi = kerIm[i]!;
    objRe[i] = ar * br - ai * bi;
    objIm[i] = ar * bi + ai * br;
  }
  fft2d(objRe, objIm, n, true);
  return objRe;
}

const relRms = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i]! - b[i]!) ** 2;
    p += a[i]! ** 2;
  }
  return Math.sqrt(s / p);
};

describe("§ 6ba — the spectral emitter density", () => {
  /**
   * § 6ba.1 — a density that ignores λ is § 6as's, wavelength by wavelength.
   *
   * The seam § 6as and § 6n both kept: the spectrum lives in the *argument*, so
   * nothing below the authoring layer learns it exists. Pinned **bitwise**, not
   * numerically, because that is the only version of the claim that stays true —
   * an agreement to 1e-15 would leave room for a second expression to drift.
   */
  it("6ba.1 — a wavelength-independent density is the § 6as rasterizer, bitwise", () => {
    const disc = discEmitter({ radiusMm: 0.02, density: 1 });
    const spectral = neutralEmitterDensity(disc);
    for (const sample of [SAMPLES[0]!, SAMPLES[4]!, SAMPLES[8]!]) {
      const plane = formEmitterPlane(SYSTEM, spectral, BASE, sample, { x: 0, y: 0 });
      const frame = frameAt(sample.nm);
      const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
      const direct = renderFluorescence(
        rasterizeEmitterDensity(frame, disc, { radialMap: map }),
        tracedFieldPupils(SYSTEM, frame, {}),
        { pupilSamples: PS, scale: frame.scale, throughput: { kind: "transmitted" } },
      );
      expect(plane.frame.pixelScaleMm).toBe(frame.pixelScaleMm);
      for (let i = 0; i < direct.intensity.length; i++) {
        expect(Object.is(plane.input.intensity[i], direct.intensity[i])).toBe(true);
      }
      // …and `atEmissionWavelength` is the slice that made it so.
      expect(atEmissionWavelength(spectral, sample.nm)(0.003, -0.004)).toBe(disc(0.003, -0.004));
    }
  });

  /**
   * § 6ba.2 — the ruler is the bluest plane's, and that plane is COPIED.
   *
   * § 6r.3's rung on the energy branch. At the plane that sets the scale k is
   * exactly 1, every destination lands on a lattice point and the bilinear
   * weights collapse — so the identity is arithmetic, not a rounding, and the
   * `k²` gain is exactly 1 there as well.
   */
  it("6ba.2 — the ruler plane passes through bit for bit", () => {
    const density = neutralEmitterDensity(gaussianEmitter({ waistMm: 0.004, peak: 1 }));
    const input = SAMPLES.map((s) => formEmitterPlane(SYSTEM, density, BASE, s, { x: 0, y: 0 }).input);
    const stack = stackEmitterPlanes(input);

    // The bluest sample really is the ruler, and it is the SMALLEST scale.
    expect(stack.rulerWavelengthNm).toBe(SAMPLES[0]!.nm);
    expect(stack.size).toBe(SIZE - 2);
    expect(stack.croppedPixels).toBe(1);
    for (const p of stack.planes) expect(p.resampleRatio).toBeLessThanOrEqual(1);
    expect(stack.planes[0]!.resampleRatio).toBe(1);

    const src = input[0]!.intensity;
    const dst = stack.planes[0]!.intensity;
    for (let y = 0; y < stack.size; y++) {
      for (let x = 0; x < stack.size; x++) {
        expect(Object.is(dst[y * stack.size + x], src[(y + 1) * SIZE + (x + 1)])).toBe(true);
      }
    }
  });

  /**
   * § 6ba.3 — the resampler is chosen by the RASTERIZER, and getting it wrong is
   * a colour.
   *
   * `imaging/spectral-stack`'s whole reason. An emitter plane holds the flux
   * landing in each pixel, because § 6as multiplied a density by the object area
   * the pixel covers and `incoherentPsf` sums to 1 — so `k²` is mandatory, where
   * § 6r's irradiance forbids it. The negative control is the ratio `1/k²`
   * *exactly*, which is what makes this a statement about the Jacobian and not
   * about a discrepancy: 2.5008× on the reddest plane against the bluest ruler.
   *
   * **Energy is not the witness**, on this branch either. Nothing is lost by
   * choosing wrong; each plane is merely rescaled, and the tilt reads as physics.
   * Here it goes as λ² and reddens — the mirror of § 6r's 1/λ² blue.
   */
  it("6ba.3 — omitting the Jacobian inflates a red plane by exactly 1/k², and reddens", () => {
    const density = neutralEmitterDensity(gaussianEmitter({ waistMm: 0.004, peak: 1 }));
    const input = SAMPLES.map((s) => formEmitterPlane(SYSTEM, density, BASE, s, { x: 0, y: 0 }).input);
    const target = Math.min(...input.map((p) => p.pixelScaleMm));
    const n = SIZE - 2;

    for (const p of input) {
      const k = target / p.pixelScaleMm;
      const energy = total(resampleEnergyGrid(p.intensity, SIZE, p.pixelScaleMm, target, n));
      const irradiance = total(
        resampleIrradianceGrid(p.intensity, SIZE, p.pixelScaleMm, target, n),
      );
      // Not "about 1/k²" — the two resamplers share one implementation and differ
      // by the gain alone, so this is an identity to f64 and is pinned as one.
      expect(irradiance / energy).toBeCloseTo(1 / (k * k), 12);
    }
    // The ratio is not merely close to the wavelength ratio — `imagePixelScaleMm`
    // is ∝ λ, so k IS λ_blue/λ_red, and on this quadrature that is 25/41 exactly.
    const reddest = input[input.length - 1]!;
    const k = target / reddest.pixelScaleMm;
    expect(k).toBeCloseTo(SAMPLES[0]!.nm / SAMPLES[8]!.nm, 15);
    expect(k).toBeCloseTo(25 / 41, 15);
    expect(
      total(resampleIrradianceGrid(reddest.intensity, SIZE, reddest.pixelScaleMm, target, n)) /
        total(resampleEnergyGrid(reddest.intensity, SIZE, reddest.pixelScaleMm, target, n)),
    ).toBeCloseTo((41 / 25) ** 2, 10);

    // And the colour: the same planes stacked both ways. The right one is white
    // for an equal-energy emitter; the wrong one is pulled red, and by enough
    // that no exposure or white balance would hide it.
    const stacked = (jacobian: boolean) =>
      integratedChromaticity(
        colorImageFromStack({
          size: n,
          pixelScaleMm: target,
          planes: input.map((p) => ({
            intensity: (jacobian ? resampleEnergyGrid : resampleIrradianceGrid)(
              p.intensity,
              SIZE,
              p.pixelScaleMm,
              target,
              n,
            ),
          })),
          samples: SAMPLES,
        }),
      );
    const right = stacked(true);
    const wrong = stacked(false);
    // Moved by § 6bc, and by exactly what that step measured: the stack now
    // carries the objective's own transmission spectrum, which rises with
    // wavelength, so this integrates 3.80e-4 redder in x and 3.71e-4 in y than
    // the same render with the weight divided away. Still white to three
    // decimals, which is all this rung ever claimed of it.
    expect(right.x).toBeCloseTo(0.335980, 5);
    expect(right.y).toBeCloseTo(0.338171, 5);
    expect(wrong.x).toBeGreaterThan(right.x + 0.02);
    expect(wrong.y).toBeGreaterThan(right.y);
  });

  /**
   * § 6ba.4 — a disc's flux is πR² at every wavelength, and the lattice residual
   * has become a COLOUR.
   *
   * § 6as.4 measured a hard-edged disc's flux against `ρ·πR²` and found the
   * Gauss-circle lattice discrepancy in the residual — a nuisance on one plane,
   * with an exponent bracketed rather than claimed. On a *stack* each wavelength
   * point-samples the disc on its own lattice, so each miscounts differently, and
   * the residual stops being a flux error and becomes a chromatic one.
   *
   * It is small — the three wavelengths below span 0.67% — and it is a reason to
   * hold every chromaticity rung here on a SMOOTH density. That is why § 6ba.5
   * and § 6ba.9 use a Gaussian and this rung uses the disc: the disc is the
   * control that says what the edge costs, not the instrument the colour is
   * measured with.
   */
  it("6ba.4 — the disc's flux is πR² per wavelength, and the lattice tints the stack", () => {
    const R = 0.02;
    const closed = Math.PI * R * R;
    const density = neutralEmitterDensity(discEmitter({ radiusMm: R, density: 1 }));
    const residuals = [430, 550, 680].map((nm) => {
      const plane = formEmitterPlane(SYSTEM, density, BASE, { nm, weight: 1 }, { x: 0, y: 0 });
      const frame = frameAt(nm);
      const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
      const object = rasterizeEmitterDensity(frame, discEmitter({ radiusMm: R, density: 1 }), {
        radialMap: map,
      });
      // § 6bc: the kernel sums to 1, so the convolution hands the rasterizer's
      // flux through times the light the pupil passed. That ratio IS the weight
      // — it read 1 only while the render divided it away — and the residual
      // this rung is about belongs to the raster, so it is read off the object.
      const passed = pupilThroughput(tracedFieldPupils(SYSTEM, frame, {})(0.5, 0.5).pupil, {
        pupilSamples: PS,
        size: SIZE,
      });
      expect(total(plane.input.intensity) / total(object.values)).toBeCloseTo(passed, 12);
      expect(passed).toBeLessThan(0.2);
      return total(object.values) / closed - 1;
    });
    expect(residuals[0]!).toBeCloseTo(-7.821e-4, 6);
    expect(residuals[1]!).toBeCloseTo(5.903e-3, 6);
    expect(residuals[2]!).toBeCloseTo(-2.798e-3, 6);
    // Each is a fraction of a percent, and they do not share a sign — which is
    // what says this is the lattice count and not a systematic of the raster.
    for (const r of residuals) expect(Math.abs(r)).toBeLessThan(1e-2);
    expect(Math.max(...residuals) - Math.min(...residuals)).toBeCloseTo(8.701e-3, 5);
  });

  /**
   * § 6ba.5 — colour needs the planes apart for ONE label, and the mechanism is
   * the objective's axial colour.
   *
   * The first half of the split this step exists to make. A single flat-banded
   * emitter integrates to white — as an equal-energy source must — and yet its
   * chromaticity swings across the image from a yellow-green core to a
   * blue-violet skirt. A tint applied to a collapsed monochrome image is one
   * chromaticity everywhere by construction, so no choice of tint reproduces
   * this, and the label count never entered the argument.
   *
   * **The ideal-pupil control is what turns that into a mechanism.** Repeat every
   * plane through `idealPupil` and the swing collapses by an order of magnitude
   * AND reverses sign — a faint reddening outward, which is the λ-scaling a
   * diffraction skirt has. So the halo is not diffraction; it is the DIN
   * doublet's own axial colour, § 6e's named "chromatic half" arriving as a
   * colour. Measuring both is the difference between claiming a cause and
   * bracketing one.
   */
  it("6ba.5 — one label's image is not one colour, and the ideal pupil says why", () => {
    const density = neutralEmitterDensity(gaussianEmitter({ waistMm: 0.004, peak: 1 }));
    const build = (ideal: boolean) => {
      const built = SAMPLES.map((s) => {
        const frame = frameAt(s.nm);
        const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
        const object = rasterizeEmitterDensity(
          frame,
          atEmissionWavelength(density, s.nm),
          { radialMap: map },
        );
        const formed = ideal
          ? incoherentImage(object, idealPupil(), {
              pupilSamples: PS,
              scale: frame.scale,
              throughput: { kind: "transmitted" },
            })
          : renderFluorescence(object, tracedFieldPupils(SYSTEM, frame, {}), {
              pupilSamples: PS,
              scale: frame.scale,
              throughput: { kind: "transmitted" },
            });
        return {
          nm: s.nm,
          weight: s.weight,
          size: SIZE,
          pixelScaleMm: frame.pixelScaleMm,
          intensity: formed.intensity,
        };
      });
      return colorImageFromStack(stackEmitterPlanes(built));
    };

    const traced = build(false);
    const ideal = build(true);
    const c = traced.width >> 1;

    // White overall, both ways, to the two decimals this rung claims: nothing
    // has been LOST either way, and the halo below is a rearrangement.
    //
    // They are not the same white, and since § 6bc that is a measurement rather
    // than a rounding. The traced stack carries the objective's transmission,
    // which rises with wavelength, so it integrates 3.9e-3 redder in x than the
    // ideal pupil's — whose weight is the same at every wavelength and so
    // cancels exactly. The mechanism is § 6bc.3's, read here on a second scene.
    const tracedWhite = integratedChromaticity(traced);
    const idealWhite = integratedChromaticity(ideal);
    for (const w of [tracedWhite, idealWhite]) {
      expect(w.x).toBeCloseTo(0.3335, 2);
      expect(w.y).toBeCloseTo(0.3341, 2);
    }
    expect(idealWhite.x).toBeCloseTo(0.332093, 5);
    expect(idealWhite.y).toBeCloseTo(0.332604, 5);
    expect(tracedWhite.x).toBeCloseTo(0.335980, 5);
    expect(tracedWhite.y).toBeCloseTo(0.338171, 5);
    expect(tracedWhite.x - idealWhite.x).toBeGreaterThan(3.8e-3);

    const tracedCore = pixelChromaticity(traced, c, c);
    const tracedSkirt = pixelChromaticity(traced, c + 24, c);
    // The traced pair moved with the white point above, and by the same 2.6e-4
    // — § 6bc's tilt is a property of the stack and not of where in it you look.
    expect(tracedCore.x).toBeCloseTo(0.410663, 5);
    expect(tracedCore.y).toBeCloseTo(0.442636, 5);
    expect(tracedSkirt.x).toBeCloseTo(0.228763, 5);
    expect(tracedSkirt.y).toBeCloseTo(0.182984, 5);

    const idealCore = pixelChromaticity(ideal, c, c);
    const idealSkirt = pixelChromaticity(ideal, c + 24, c);
    expect(idealCore.x).toBeCloseTo(0.3208, 3);
    expect(idealCore.y).toBeCloseTo(0.3243, 3);
    expect(idealSkirt.x).toBeCloseTo(0.3490, 3);
    expect(idealSkirt.y).toBeCloseTo(0.3587, 3);

    // The swing is an order of magnitude smaller with an ideal pupil…
    const swing = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(swing(tracedCore, tracedSkirt) / swing(idealCore, idealSkirt)).toBeGreaterThan(6);
    // …and it points the other way: the traced skirt is bluer than its core, the
    // ideal one redder. A sign reversal is not a magnitude a tolerance could hide.
    expect(tracedSkirt.x).toBeLessThan(tracedCore.x);
    expect(idealSkirt.x).toBeGreaterThan(idealCore.x);
  });

  /**
   * § 6ba.6 — one label collapses to ONE kernel; two labels need TWO.
   *
   * The second half of the split, and the one `imaging/emission`'s header gets
   * wrong by attributing it to colour. This rung is entirely monochrome. With
   * `E(x,λ) = Σ_s E_s(x)·w_s(λ)` the label sum passes through the convolution
   * once per label, so § 6j's single stacked kernel is exact for one label and
   * simply wrong for two.
   *
   * Everything here is on one frame and one grid — the kernels differ with λ
   * through the traced pupil alone — so no ruler, no resampling and no colour
   * can be blamed for the departure. It is linear algebra.
   *
   * **And the negative control has a resolution threshold.** With 33 nm bins, two
   * 100 nm bands separated by 15 or 30 nm cover the same nine samples, so the
   * identity holds at 2.9e−16 there as well — not because the specimen factors
   * but because the quadrature cannot see that it doesn't. That is the trap this
   * rung is really for: a two-stain render whose labels sit inside one bin is a
   * single-label render wearing two names.
   */
  it("6ba.6 — the factorization is an identity for one label and fails for two", () => {
    const frame = frameAt(550);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
    const kernels = SAMPLES.map(
      (s) =>
        incoherentPsf(tracedPupil(SYSTEM, 0, s.nm, {}).pupil, { pupilSamples: PS, size: SIZE })
          .values,
    );
    const raster = (d: EmitterDensity) =>
      rasterizeEmitterDensity(frame, d, { radialMap: map }).values;
    const fa = raster(gaussianEmitter({ waistMm: 0.004, peak: 1, centreMm: { x: -0.01, y: 0 } }));
    const fb = raster(gaussianEmitter({ waistMm: 0.004, peak: 1, centreMm: { x: 0.01, y: 0 } }));
    const eTotal = new Float64Array(SIZE * SIZE);
    for (let i = 0; i < eTotal.length; i++) eTotal[i] = fa[i]! + fb[i]!;

    const departure = (separationNm: number): number => {
      const bandA = boxcarBand(550 - separationNm / 2, 100);
      const bandB = boxcarBand(550 + separationNm / 2, 100);
      // Correct: one density per λ, one convolution per λ, summed to monochrome.
      const perWavelength = new Float64Array(SIZE * SIZE);
      // § 6j's path: the two labels' spectra added into ONE band, ONE kernel.
      const oneKernel = new Float64Array(SIZE * SIZE);
      for (let i = 0; i < SAMPLES.length; i++) {
        const s = SAMPLES[i]!;
        const wa = bandA(s.nm);
        const wb = bandB(s.nm);
        const atLambda = new Float64Array(SIZE * SIZE);
        for (let j = 0; j < atLambda.length; j++) atLambda[j] = wa * fa[j]! + wb * fb[j]!;
        const formed = convolve(atLambda, kernels[i]!, SIZE);
        for (let j = 0; j < perWavelength.length; j++) {
          perWavelength[j] = perWavelength[j]! + s.weight * formed[j]!;
        }
        const w = s.weight * (wa + wb);
        for (let j = 0; j < oneKernel.length; j++) {
          oneKernel[j] = oneKernel[j]! + w * kernels[i]![j]!;
        }
      }
      const collapsed = convolve(eTotal, oneKernel, SIZE);
      // Matched in total flux first, so what is compared is SHAPE — a brightness
      // difference is a normalization and would be the uninteresting half.
      let sp = 0;
      let sc = 0;
      for (let j = 0; j < perWavelength.length; j++) {
        sp += perWavelength[j]!;
        sc += collapsed[j]!;
      }
      for (let j = 0; j < collapsed.length; j++) collapsed[j] = (collapsed[j]! * sp) / sc;
      return relRms(perWavelength, collapsed);
    };

    // One band for both labels: the density factors, and the collapse is exact.
    expect(departure(0)).toBeLessThan(1e-14);
    // Separations the 33 nm bins cannot resolve: the SAME nine samples are
    // covered, so the quadrature reports an identity it has not earned.
    expect(departure(15)).toBeLessThan(1e-14);
    expect(departure(30)).toBeLessThan(1e-14);
    // Resolved separations: the collapse is simply a different image.
    expect(departure(60)).toBeCloseTo(0.1452, 3);
    expect(departure(120)).toBeCloseTo(0.3003, 3);
    expect(departure(200)).toBeCloseTo(0.4533, 3);
    // Monotone in separation, which is what says it is the bands and not noise —
    // but only NON-strictly, and for § 6ba.8's reason: the departure moves when a
    // sample crosses a band edge and holds flat in between, so 60 and 90 nm are
    // the same number here. Strict growth is claimed only across steps the 33 nm
    // bins can actually resolve.
    const swept = [60, 90, 120, 160, 200].map(departure);
    for (let i = 1; i < swept.length; i++) {
      expect(swept[i]!).toBeGreaterThanOrEqual(swept[i - 1]!);
    }
    expect(swept[1]!).toBe(swept[0]!);
    for (const [lo, hi] of [
      [60, 120],
      [120, 200],
    ] as const) {
      expect(departure(hi)).toBeGreaterThan(departure(lo));
    }
  });

  /**
   * § 6ba.7 — the band enters exactly once, and `emissionSamples` is not the
   * constructor for this path.
   *
   * § 6j.1's rung, one branch over and with more to lose. `emissionSamples`
   * builds SED-weighted samples on purpose, because a single-label specimen has
   * exactly one source spectrum and it has nowhere else to live. Here every
   * label's band is in the density, so the weights must be pure quadrature; hand
   * this function the SED-weighted ones and the band is applied twice.
   *
   * Not refused, and the module's header says why: the only available test is
   * "do the weights sum to 1", which would refuse a caller with a legitimate
   * 1 nm band. `imaging/scene` reached the same verdict, and the answer in both
   * places is a pinned negative control rather than a heuristic.
   */
  it("6ba.7 — SED-weighted samples apply the band twice and shift the colour", () => {
    // NOT a boxcar. A boxcar takes only 0 and 1, so B² = B and applying it twice
    // is applying it once — the negative control would pass while measuring
    // nothing. The band has to VARY across the passband to witness a doubling,
    // so this is a caller's own `(nm) => number`, which is the escape
    // `imaging/emission` documents. No dye is being named: it is a ramp.
    const band = (nm: number): number => (nm - 400) / 300;
    const density = labelledEmitters([
      { density: gaussianEmitter({ waistMm: 0.004, peak: 1 }), band },
    ]);
    const right = fluorescenceSpectralStack(SYSTEM, density, BASE);
    const twice = fluorescenceSpectralStack(SYSTEM, density, {
      ...BASE,
      samples: emissionSamples(band),
    });

    const a = integratedChromaticity(colorImageFromStack(right));
    const b = integratedChromaticity(colorImageFromStack(twice));
    // Both are perfectly plausible pictures. They are different colours, and the
    // doubly-weighted one is pulled toward the band's own centre.
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-3);

    // The filter, by contrast, may be applied here — it is the one thing in the
    // path that is NOT positional, and `filter` is the single place it enters.
    const filtered = fluorescenceSpectralStack(SYSTEM, density, {
      ...BASE,
      filter: boxcarBand(550, 300),
    });
    for (let i = 0; i < SAMPLES.length; i++) {
      expect(filtered.planes[i]!.weight).toBeCloseTo(right.planes[i]!.weight, 15);
    }
  });

  /**
   * § 6ba.8 — crosstalk against `∫B·T/∫B`, and when the quadrature is exact.
   *
   * The number that decides whether two channels are really two: the fraction of
   * one label's emitted power that the *other* label's filter passes. For boxcars
   * it is a division, external to the engine, and `channelCrosstalk` is held to
   * it.
   *
   * The exactness is a theorem rather than a tolerance. Midpoint quadrature is
   * exact for a function constant on each bin, and a boxcar whose edges are bin
   * boundaries is exactly that — so the discrete overlap equals the continuous
   * one at **every** sample count that subdivides the band. Off a boundary it
   * does not, and it does not converge smoothly either: the error only moves when
   * a sample crosses an edge, which is a staircase. So what is pinned is the
   * aligned identity and the staircase's monotone decrease, not a rate the
   * sequence does not have (§ 6as.4's discipline, and § 6az.8's).
   */
  it("6ba.8 — crosstalk is the closed-form overlap, exactly, on aligned edges", () => {
    const BIN = 300 / 9;
    // Edges on bin boundaries: 400 + k·33.333…
    const green = boxcarBand(566.6666666666667, 66.66666666666667); // 533.3–600
    const red = boxcarBand(633.3333333333334, 66.66666666666667); // 600–666.7
    const greenFilter = boxcarBand(483.3333333333333, 166.66666666666666); // 400–566.7
    const redFilter = boxcarBand(650, 100); // 600–700

    const overlap = (b: [number, number], t: [number, number]) =>
      Math.max(0, Math.min(b[1], t[1]) - Math.max(b[0], t[0])) / (b[1] - b[0]);

    for (const count of [9, 18, 27, 36, 72, 90, 144]) {
      const s = quadratureSamples({ count });
      // Half the green label's light reaches its own channel — the filter cuts
      // the band in two — and none of the red label's does.
      expect(channelCrosstalk(green, greenFilter, s)).toBeCloseTo(
        overlap([533.3333333333334, 600], [400, 566.6666666666667]),
        14,
      );
      expect(channelCrosstalk(red, greenFilter, s)).toBe(0);
      // The red label's own channel passes all of it, and the green label leaks
      // nothing into it: the two bands abut at a bin boundary.
      expect(channelCrosstalk(red, redFilter, s)).toBeCloseTo(1, 14);
      expect(channelCrosstalk(green, redFilter, s)).toBe(0);
    }
    expect(BIN).toBeCloseTo(33.333333, 6);

    // A filter that overlaps a label really does bleed, and by the overlap.
    const leaky = boxcarBand(500, 200); // 400–600, still bin-aligned
    for (const count of [9, 36, 144]) {
      expect(channelCrosstalk(red, leaky, quadratureSamples({ count }))).toBe(0);
      expect(channelCrosstalk(green, leaky, quadratureSamples({ count }))).toBeCloseTo(1, 14);
    }
    const half = boxcarBand(516.6666666666666, 166.66666666666666); // 433.3–600
    expect(channelCrosstalk(green, half, quadratureSamples({ count: 9 }))).toBeCloseTo(1, 14);

    // Off a bin boundary the discrete overlap is NOT the continuous one, and the
    // error is a staircase: it holds flat across sample counts and drops by ×4
    // when a sample finally crosses the edge. Reported as monotone, not as a rate.
    const offEdge = boxcarBand(485, 170); // 400–570; 570 is not a bin boundary
    const continuous = overlap([533.3333333333334, 600], [400, 570]);
    expect(continuous).toBeCloseTo(0.55, 12);
    const errors = [9, 18, 36, 72, 144, 288, 576].map((count) =>
      Math.abs(channelCrosstalk(green, offEdge, quadratureSamples({ count })) - continuous),
    );
    expect(errors[0]!).toBeCloseTo(0.05, 10);
    expect(errors[errors.length - 1]!).toBeCloseTo(3.125e-3, 10);
    // Non-increasing to f64: two counts on the same step of the staircase agree
    // only to rounding, so a bare `<=` would be pinning the summation order.
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThanOrEqual(errors[i - 1]! * (1 + 1e-12));
    }
    // …and it is genuinely a staircase rather than a slow rate: the sequence is
    // flat at three distinct levels, each a quarter of the last.
    expect(new Set(errors.map((e) => e.toPrecision(6))).size).toBe(3);
  });

  /**
   * § 6ba.9 — two channels are not registered, and the misregistration is a
   * MAGNIFICATION difference.
   *
   * § 6r.6's lateral colour, arriving on the fluorescence branch as the thing a
   * microscopist actually meets: the same physical structure lands at different
   * pixels in the two channels of one exposure, so a two-stain overlay is
   * misaligned before anything is measured off it.
   *
   * Nothing here is coded for. The per-λ frames share a λ-independent image
   * centre and each is traced at its own wavelength, so the object point a pixel
   * looks at is wavelength-dependent, and a filter selecting different
   * wavelengths therefore selects a different map.
   *
   * The **linear** law is what makes this a magnification difference rather than
   * a distortion: displacement over field height is constant to 0.5% over a ×4 of
   * field, at 0.180%. On the axis it is 1.7e−4 px, which is zero — and that zero
   * is load-bearing, because it is what says the number below is lateral colour
   * and not an artifact of the window the centroid was taken over.
   */
  it("6ba.9 — channel registration is linear in field: 0.180% of magnification", () => {
    const blue = boxcarBand(466.6666666666667, 66.66666666666667);
    const red = boxcarBand(633.3333333333334, 66.66666666666667);

    const displacement = (fieldMm: number): { px: number; mm: number } => {
      const centreMm = { x: fieldMm, y: 0 };
      const at = frameAt(550, centreMm).centreObjectMm;
      const spot = gaussianEmitter({ waistMm: 0.004, peak: 1, centreMm: { x: at.x, y: at.y } });
      const density: SpectralEmitterDensity = labelledEmitters([
        { density: spot, band: blue },
        { density: spot, band: red },
      ]);
      const stack = fluorescenceSpectralStack(SYSTEM, density, { ...BASE, centreMm });
      const b = centroid(colorImageFromStack(stack, channelBasis(stack, blue)));
      const r = centroid(colorImageFromStack(stack, channelBasis(stack, red)));
      const px = Math.hypot(r.x - b.x, r.y - b.y);
      return { px, mm: px * stack.pixelScaleMm };
    };

    // On the axis there is no lateral colour, and the estimator says so.
    expect(displacement(0).px).toBeLessThan(1e-3);

    const fields = [0.2, 0.4, 0.8];
    const measured = fields.map(displacement);
    expect(measured[0]!.px).toBeCloseTo(0.11493, 4);
    expect(measured[1]!.px).toBeCloseTo(0.23004, 4);
    expect(measured[2]!.px).toBeCloseTo(0.46229, 4);

    // Displacement over field height — the fractional magnification difference
    // between the two channels. Constant is the whole claim.
    const fractional = measured.map((m, i) => m.mm / fields[i]!);
    for (const f of fractional) expect(f).toBeCloseTo(1.79e-3, 4);
    expect(Math.max(...fractional) / Math.min(...fractional) - 1).toBeLessThan(6e-3);
    expect(measured[2]!.mm * 1000).toBeCloseTo(1.4374, 3);
  });

  /**
   * § 6ba.10 — the driver is the plane former, and the labels enter in the
   * ARGUMENT.
   *
   * The seam that keeps this step cheap. Two labels cost one raster per
   * wavelength and not two, because `E(·, λ)` is a plain `EmitterField` once λ is
   * bound — the label sum happens inside the density callback, before anything
   * is convolved. Pinned bitwise against a hand-summed density, so the claim
   * cannot become "close enough".
   */
  it("6ba.10 — labelled emitters are one raster per wavelength, bitwise", () => {
    const a = gaussianEmitter({ waistMm: 0.004, peak: 1, centreMm: { x: -0.01, y: 0 } });
    const b = gaussianEmitter({ waistMm: 0.003, peak: 2, centreMm: { x: 0.01, y: 0 } });
    const bandA = boxcarBand(500, 100);
    const bandB = boxcarBand(620, 100);
    const labelled = labelledEmitters([
      { density: a, band: bandA },
      { density: b, band: bandB },
    ]);
    const byHand: SpectralEmitterDensity = (x, y, nm) => bandA(nm) * a(x, y) + bandB(nm) * b(x, y);

    const stack = fluorescenceSpectralStack(SYSTEM, labelled, BASE);
    const hand = fluorescenceSpectralStack(SYSTEM, byHand, BASE);
    expect(stack.planes.length).toBe(SAMPLES.length);
    for (let p = 0; p < stack.planes.length; p++) {
      const x = stack.planes[p]!.intensity;
      const y = hand.planes[p]!.intensity;
      for (let i = 0; i < x.length; i++) expect(Object.is(x[i], y[i])).toBe(true);
    }
    // A label whose band is zero at a wavelength contributes nothing there, which
    // is what makes a channel a channel.
    expect(labelled(-0.01, 0, 650)).toBe(bandB(650) * b(-0.01, 0));
    expect(() => labelledEmitters([])).toThrow(/no labels/);
    expect(() =>
      // 429–431 nm falls entirely between two of the nine samples, so the band
      // emits nothing the render could see — refused rather than returning 0/0.
      channelCrosstalk(boxcarBand(430, 2), boxcarBand(430, 2), quadratureSamples({ count: 9 })),
    ).toThrow(/emits nothing/);
  });

  /**
   * § 6ba.11 — the stack refuses what § 6r's refuses, for the same reasons.
   *
   * The geometry is shared (`imaging/spectral-stack`), so these are § 6r.4's
   * refusals reaching the emitter branch unchanged — kept as a rung rather than
   * assumed, because "shared" is a claim about today's code and a test is a claim
   * about the behaviour.
   */
  it("6ba.11 — a black border and a half-pixel shift are both refused", () => {
    const density = neutralEmitterDensity(gaussianEmitter({ waistMm: 0.004, peak: 1 }));
    const input = SAMPLES.map((s) => formEmitterPlane(SYSTEM, density, BASE, s, { x: 0, y: 0 }).input);
    expect(() => stackEmitterPlanes(input, { size: SIZE })).toThrow(/black frame/);
    expect(() => stackEmitterPlanes(input, { size: SIZE - 1 })).toThrow(/half a pixel/);
    expect(() => stackEmitterPlanes(input, { size: SIZE - 2, croppedPixels: 3 })).toThrow(
      /disagree/,
    );
    expect(() => stackEmitterPlanes([])).toThrow(/no wavelengths/);
    expect(() => stackEmitterPlanes(input, { size: SIZE - 4 })).not.toThrow();
    // The refusal names the function the caller invoked, not the shared one.
    expect(() => stackEmitterPlanes(input, { size: SIZE })).toThrow(/stackEmitterPlanes/);
  });

  /**
   * § 6ba.12 — the driver's own arithmetic: the filter multiplies the weights,
   * and a channel costs no second render.
   *
   * `channelBasis` reweights the observer instead of re-rendering, which is only
   * legal because the stack kept the wavelengths apart — the header's first
   * failure seen from the other side. Held against the long way round.
   */
  it("6ba.12 — a channel is a reweighted basis, not a second exposure", () => {
    const density = labelledEmitters([
      { density: gaussianEmitter({ waistMm: 0.004, peak: 1 }), band: boxcarBand(550, 300) },
    ]);
    const filter = boxcarBand(483.3333333333333, 166.66666666666666);
    const stack = fluorescenceSpectralStack(SYSTEM, density, BASE);
    const viaBasis = colorImageFromStack(stack, channelBasis(stack, filter));
    const viaSamples = colorImageFromStack(
      stack,
      spectralXyzBasis(stack.samples.map((s) => ({ nm: s.nm, weight: s.weight * filter(s.nm) }))),
    );
    for (let i = 0; i < viaBasis.xyz.length; i++) {
      expect(Object.is(viaBasis.xyz[i], viaSamples.xyz[i])).toBe(true);
    }
    // And a stack built with the filter in `filter` carries it in the weights,
    // where the header says it belongs — one place, not two.
    const filtered = fluorescenceSpectralStack(SYSTEM, density, { ...BASE, filter });
    const passed = SAMPLES.filter((s) => filter(s.nm) > 0).length;
    expect(filtered.planes.filter((p) => p.weight > 0).length).toBe(passed);
    expect(filtered.planes.reduce((a, p) => a + p.weight, 0)).toBeCloseTo(1, 14);
  });
});
