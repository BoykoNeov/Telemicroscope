import { fft2d, isPowerOfTwo } from "../math/fft";
import { OpticalSystem } from "../trace/system";
import { PolychromaticOptions, SpectralStack, spectralStack } from "../wave/polychromatic";
import { spectralXyzBasis } from "../photometry/spectrum";
import { ColorImage } from "./image";
import { ImagePlaneScene, imagePointOf } from "./scene";

/**
 * The spatially-variant full-field render — the heaviest compute in the app,
 * built at step 4 rather than last so its real cost is known early.
 *
 * ## Why it cannot be one convolution
 *
 * A PSF is only a convolution kernel where it is *constant*. It is not: coma,
 * astigmatism and field curvature all grow with field angle, so the image of a
 * star at the edge of the frame is a different shape from one at the centre.
 * Convolving the whole frame with the on-axis PSF would render a perfectly
 * sharp corner on a lens that has none.
 *
 * The standard answer, and the one here, is to make the kernel piecewise
 * constant and blend:
 *
 *     image = Σ_p  PSF_p ⊛ (w_p · scene),   with  Σ_p w_p ≡ 1
 *
 * The window is applied to the **scene**, not to the output. Both look like
 * they would work and only one does: windowing the output blends two images
 * that were each formed with the wrong kernel over most of their support,
 * which leaves a seam wherever the PSFs differ. Windowing the input splits the
 * *light* between patches, so every photon is convolved with the kernel nearest
 * to where it actually came from, and the sum is exact wherever the PSF is
 * locally constant and smoothly interpolated everywhere else.
 *
 * The windows are separable smoothstep ramps overlapping by half a patch, which
 * makes Σ w_p ≡ 1 identically — a partition of unity, so no light is created or
 * destroyed by the decomposition regardless of how many patches there are.
 *
 * ## What it costs, which is the point of building it now
 *
 * Cost is **patches × wavelengths × (one PSF + one convolution)**, and the PSF
 * dominates: each is a pupil trace, a Zernike fit and two N² FFTs. So a 4×4
 * patch grid over 9 wavelengths is 144 PSF evaluations, and *that* is the
 * number progressive refinement exists to hide — not the convolutions.
 *
 * Hence `onRefinement`: the render emits a complete image at 1×1 patches first
 * (one PSF per wavelength, near-instant), then 2×2, then 4×4, each superseding
 * the last. The user sees a correct-but-uniform image immediately and watches
 * the corners sharpen, instead of watching nothing for the whole budget.
 *
 * ## Scope
 *
 * **Lateral colour is not rendered.** Each wavelength's PSF is centred on its
 * own chief-ray image point (`wave/polychromatic`), which removes exactly the
 * transverse colour separation that lateral chromatic aberration consists of.
 * On axis there is none to remove and the hero image is unaffected. Off axis
 * this render is missing a real effect, and the fix is local — carry each
 * plane's image point on `SpectralPlane` and offset it when resampling onto
 * the common grid — but it changes what the polychromatic Strehl means off
 * axis, so it belongs with the field-dependent work of step 5 and its own
 * rungs, not bolted on here.
 */

export interface FieldRenderOptions extends PolychromaticOptions {
  /**
   * Patches across the field. 1 means a single PSF for the whole frame, which
   * is shift-invariant imaging and correct only on a perfect system.
   */
  readonly patches?: number;
  /**
   * Emit intermediate images at coarser patch grids first. Each is complete
   * and correct at its own resolution; the last one is the returned result.
   */
  readonly onRefinement?: (image: ColorImage, patches: number) => void;
  /** Called once per PSF evaluated, for progress and cost accounting. */
  readonly onPsf?: (done: number, total: number) => void;
}

export interface FieldRenderResult {
  readonly image: ColorImage;
  /** PSFs actually evaluated — the cost that matters. */
  readonly psfEvaluations: number;
  readonly patches: number;
}

/** Smoothstep ramp, 0 at t ≤ 0 and 1 at t ≥ 1, C¹ at both ends. */
function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Weight of patch `index` of `count` at normalized position `u` ∈ [0, 1].
 *
 * Adjacent patches overlap over a full patch width, and the ramps are
 * complementary smoothsteps, so the weights sum to exactly 1 everywhere. The
 * single-patch case is the constant 1, which is what makes `patches: 1` the
 * plain shift-invariant convolution rather than a special case in the caller.
 */
export function patchWeight(u: number, index: number, count: number): number {
  if (count <= 1) return 1;
  const centre = (index + 0.5) / count;
  const width = 1 / count;
  const d = (u - centre) / width;
  // The outermost patches run flat to the frame edge. Without this the first
  // and last half-patch are covered by one ramp instead of two and the weights
  // sum to ½ there — which renders the border of every frame at half
  // brightness, indistinguishable from vignetting and just as plausible.
  if (index === 0 && d < 0) return 1;
  if (index === count - 1 && d > 0) return 1;
  if (d <= -1 || d >= 1) return 0;
  // Rising edge from the previous patch, falling edge into the next. The two
  // are complementary because smoothstep(x) + smoothstep(1 − x) ≡ 1.
  return d < 0 ? smoothstep(d + 1) : smoothstep(1 - d);
}

/**
 * Rotate a centred kernel about its middle by `angle`, bilinearly.
 *
 * **This is not cosmetic, and leaving it out is a silent physical error.** The
 * engine's field spec is a single scalar because the systems are axially
 * symmetric, so a PSF is always traced for a field point on ONE axis
 * (`fieldDirection` puts it along +y). Convolution is shift-invariant, so
 * whatever orientation that kernel has is stamped onto every star in the patch.
 *
 * Placement was already rotated — `imagePointOf` carries the azimuth — so
 * without this the stars land in the right places wearing the wrong shape:
 * every coma tail in the frame points the same way instead of radially
 * outward. That reads as a decentred or tilted system, which is a real defect
 * this engine will later simulate deliberately, so it is the same category of
 * mistake as the aperture spokes: the render inventing an optical fault.
 *
 * Sampled by inverse mapping (destination → source) so every output pixel gets
 * a value, and energy is renormalized afterwards because bilinear resampling of
 * a peaked kernel does not conserve its sum exactly — and the sum IS the
 * transmitted energy that the whole matched-normalization discipline rests on.
 */
export function rotateKernel(kernel: Float64Array, n: number, angle: number): Float64Array {
  if (angle === 0) return kernel;
  const out = new Float64Array(n * n);
  const c = n / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  let before = 0;
  for (let i = 0; i < kernel.length; i++) before += kernel[i]!;

  let after = 0;
  for (let y = 0; y < n; y++) {
    const dy = y - c;
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      // Inverse rotation: where in the source does this destination come from?
      const sx = c + dx * cos + dy * sin;
      const sy = c - dx * sin + dy * cos;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const v =
        kernel[y0 * n + x0]! * (1 - fx) * (1 - fy) +
        kernel[y0 * n + x0 + 1]! * fx * (1 - fy) +
        kernel[(y0 + 1) * n + x0]! * (1 - fx) * fy +
        kernel[(y0 + 1) * n + x0 + 1]! * fx * fy;
      out[y * n + x] = v;
      after += v;
    }
  }

  if (after > 0 && before > 0) {
    const k = before / after;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  }
  return out;
}

/**
 * Circular convolution of two same-size real grids, via the FFT.
 *
 * The kernel arrives centred (the PSF grid is fftshifted so the axis sits at
 * N/2); convolution needs its origin at index 0, so it is rolled back by half
 * the grid. Skipping that shifts the entire image by half a frame — a mistake
 * that is obvious in a picture and invisible in every energy or symmetry check,
 * which is precisely what the golden images exist to catch.
 */
function convolveCentred(scene: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const sceneRe = Float64Array.from(scene);
  const sceneIm = new Float64Array(n * n);
  const kernelRe = new Float64Array(n * n);
  const kernelIm = new Float64Array(n * n);

  const half = n / 2;
  for (let y = 0; y < n; y++) {
    const sy = (y + half) % n;
    for (let x = 0; x < n; x++) {
      kernelRe[sy * n + ((x + half) % n)] = kernel[y * n + x]!;
    }
  }

  fft2d(sceneRe, sceneIm, n);
  fft2d(kernelRe, kernelIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = sceneRe[i]!;
    const ai = sceneIm[i]!;
    const br = kernelRe[i]!;
    const bi = kernelIm[i]!;
    sceneRe[i] = ar * br - ai * bi;
    sceneIm[i] = ar * bi + ai * br;
  }
  fft2d(sceneRe, sceneIm, n, true);
  return sceneRe;
}

/**
 * Render a scene through a system, with a field-dependent PSF.
 *
 * The scene must already be on the image plane at the render's pixel scale
 * (`rasterizePointSources`), so the convolution is grid-aligned and nothing
 * here has to know how field angle maps to millimetres.
 */
export function renderField(
  system: OpticalSystem,
  scene: ImagePlaneScene,
  options: FieldRenderOptions = {},
): FieldRenderResult {
  const n = scene.size;
  if (!isPowerOfTwo(n)) throw new Error(`scene size must be a power of two, got ${n}`);
  const finest = options.patches ?? 1;
  if (!Number.isInteger(finest) || finest < 1) {
    throw new Error(`patches must be a positive integer, got ${finest}`);
  }

  // The basis is built from the STACK's samples, not the scene's. `spectralStack`
  // normalizes the weights to sum to 1, so building it from the raw scene
  // samples would scale the whole render by the band width — an image that is
  // correct in every ratio and wrong in absolute brightness, which no colour or
  // symmetry check would notice and which would silently disagree with the
  // single-source path in `colorImageFromStack`.
  let basis: ReturnType<typeof spectralXyzBasis> | null = null;
  // Coarse-to-fine, each level a complete image. Powers of two so a level's
  // patch centres are a superset of the previous level's field radii — which
  // is what would let a cache reuse them.
  const levels: number[] = [];
  for (let p = 1; p <= finest; p *= 2) levels.push(p);
  if (levels[levels.length - 1] !== finest) levels.push(finest);

  let psfEvaluations = 0;
  const totalPsfs = levels.reduce((acc, p) => acc + p * p, 0);
  let result: ColorImage | null = null;

  for (const patches of levels) {
    const xyz = new Float64Array(n * n * 3);

    for (let py = 0; py < patches; py++) {
      for (let px = 0; px < patches; px++) {
        // Field angle at this patch's centre, from its offset on the image
        // plane. Radial, because the system is axially symmetric.
        const cx = ((px + 0.5) / patches - 0.5) * 2 * scene.halfExtentMm;
        const cy = ((py + 0.5) / patches - 0.5) * 2 * scene.halfExtentMm;
        const radiusMm = Math.hypot(cx, cy);
        const fieldValue = fieldAngleFor(system, radiusMm, scene);
        // The traced PSF belongs to a field point on the +y axis, so it has to
        // be turned to face this patch's own azimuth. See `rotateKernel`.
        const azimuth = radiusMm > 0 ? Math.atan2(cy, cx) - Math.PI / 2 : 0;

        const stack: SpectralStack = spectralStack(system, fieldValue, {
          ...options,
          pixelScaleMm: scene.pixelScaleMm,
        });
        basis ??= spectralXyzBasis(stack.samples);
        psfEvaluations += scene.samples.length;
        options.onPsf?.(psfEvaluations, totalPsfs * scene.samples.length);

        for (let w = 0; w < scene.samples.length; w++) {
          const plane = scene.planes[w]!;
          const windowed = new Float64Array(n * n);
          for (let y = 0; y < n; y++) {
            const wy = patchWeight((y + 0.5) / n, py, patches);
            if (wy === 0) continue;
            for (let x = 0; x < n; x++) {
              const value = plane[y * n + x]!;
              if (value === 0) continue;
              const wx = patchWeight((x + 0.5) / n, px, patches);
              if (wx === 0) continue;
              windowed[y * n + x] = value * wx * wy;
            }
          }

          const convolved = convolveCentred(
            windowed,
            rotateKernel(stack.planes[w]!.intensity, n, azimuth),
            n,
          );
          const bx = basis!.x[w]!;
          const by = basis!.y[w]!;
          const bz = basis!.z[w]!;
          for (let i = 0, o = 0; i < convolved.length; i++, o += 3) {
            const v = convolved[i]!;
            if (v === 0) continue;
            xyz[o] = xyz[o]! + v * bx;
            xyz[o + 1] = xyz[o + 1]! + v * by;
            xyz[o + 2] = xyz[o + 2]! + v * bz;
          }
        }
      }
    }

    result = { width: n, height: n, pixelScaleMm: scene.pixelScaleMm, xyz };
    if (patches !== finest) options.onRefinement?.(result, patches);
  }

  return { image: result!, psfEvaluations, patches: finest };
}

/**
 * Field angle (degrees) whose chief ray lands `radiusMm` from the axis.
 *
 * Inverted numerically rather than by EFL·tan θ, for the same reason
 * `imagePointOf` traces: the forward map carries distortion, so its inverse has
 * to as well or the patch centres would drift away from the field points they
 * are supposed to serve on exactly the systems where it matters most.
 */
function fieldAngleFor(system: OpticalSystem, radiusMm: number, scene: ImagePlaneScene): number {
  if (radiusMm <= 0) return 0;
  const nm = scene.samples[Math.floor(scene.samples.length / 2)]!.nm;
  // Bracket on angle, then bisect on the traced image radius. A dozen chief
  // rays is nothing beside one PSF.
  const radiusAt = (deg: number): number => {
    const p = imagePointOf(system, deg, 0, nm);
    return Math.hypot(p.x, p.y);
  };

  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 40 && radiusAt(hi) < radiusMm; i++) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (radiusAt(mid) < radiusMm) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
