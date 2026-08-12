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
 * **`imaging/brightfield` windows the other side, deliberately.** The argument
 * above rests on incoherent imaging being linear in the object's *intensity*.
 * Abbe imaging is not, and there the input window does not merely leave a seam:
 * it multiplies the interference between two object points by
 * Σ_p √(w_p(x₁)·w_p(x₂)), which is zero across a seam, so the partial coherence
 * the whole calculation exists for is deleted rather than approximated
 * (`illumination/coherence`, VALIDATION § 6g.2). Two modules windowing opposite
 * sides is two different operators, not one of them being wrong.
 *
 * ## What it costs, which is the point of building it now
 *
 * Cost is **patches × wavelengths convolutions**, plus one PSF per distinct
 * patch *radius* × wavelengths — a PSF being a pupil trace, a Zernike fit and
 * two N² FFTs, against the convolution's three. Before the radius cache below
 * the PSF term was patches × wavelengths too and took 59–66% of the render;
 * with it, a 4×4 grid over 9 wavelengths is 27 PSF evaluations rather than 144,
 * and what is left of a 4×4 render is *mostly convolution*.
 *
 * That reversal is worth stating plainly, because it moves where the next
 * saving is: the convolutions are per patch and cannot collapse the same way —
 * each one convolves a different windowed slice of the scene — so a render that
 * is still too slow is now asking for a cheaper transform or fewer patches, not
 * for fewer traces.
 *
 * Hence `onRefinement`: the render emits a complete image at 1×1 patches first
 * (one PSF per wavelength, near-instant), then 2×2, then 4×4, each superseding
 * the last. The user sees a correct-but-uniform image immediately and watches
 * the corners sharpen, instead of watching nothing for the whole budget.
 *
 * ## The PSF is a function of field RADIUS, so most patches share one
 *
 * A p×p grid has p² patches but far fewer distinct radii — 4×4 has **three**,
 * because the sixteen centres are the pairs drawn from two distances off each
 * axis. Every patch at the same radius gets the same PSF, differing only in the
 * azimuth `rotateKernel` applies. So the stacks are cached on the patch radius
 * and the p² traces collapse onto the distinct set: 21 stacks over the 1/2/4
 * ladder become 5, and 14 over 1/2/3 become 4.
 *
 * **This introduces no assumption the render was not already making.** Tracing
 * one kernel per patch and turning it by the patch's azimuth is exactly the
 * claim that the PSF depends on radius alone — a licence this code has been
 * spending since step 4, and which the axial symmetry of the prescription
 * grants. The cache spends it once per radius instead of once per patch, and
 * because `fieldAngleFor` and `spectralStack` are deterministic the reused
 * stack is bitwise the stack that would have been recomputed. Same pixels, and
 * `psfCache: false` exists so a rung can say so rather than the header
 * asserting it.
 *
 * It also makes the coarse levels nearly free, which is the point at which
 * refinement stops being a tax on the finished image: for an odd `finest` the
 * 1×1 preview costs **nothing at all**, since radius 0 is already a patch
 * centre of the finest grid.
 *
 * **Measured end to end** through the two app surfaces that call this (median of
 * three warm runs in node, 200 mm f/8, pupilSamples 32, 5 wavelengths), before
 * against after: the sky disc on an achromat **3704 → 1936 ms** at 2 patches,
 * **6757 → 3332** at 3 and **12659 → 4095** at 4; the star field **1816 → 994**,
 * **4326 → 1690** and **5796 → 2074**. Roughly 2× at the counts the panels
 * offer, growing with the grid, and well short of the 4.2× the PSF *count*
 * falls by — which is the convolutions, and is why the cost section above now
 * says what it says. At 1 patch the two builds measured 92 against 94 ms and
 * 1254 against 1277, which is the identity showing up as a null.
 *
 * **The invariant this buys, and it is the only one:** a cached stack's arrays
 * are shared by several patches, so nothing downstream may write into them.
 * `rotateKernel` returns its input *by reference* at azimuth 0 — a path that is
 * now reachable from more than one patch — and `convolveCentred` copies before
 * transforming, which is what keeps that safe. An in-place normalization added
 * anywhere below would corrupt every later patch at the same radius.
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
  /**
   * Reuse one traced stack across every patch at the same field radius.
   * Defaults on; `false` is the uncached reference the equivalence rung needs,
   * and is not otherwise a setting worth having.
   */
  readonly psfCache?: boolean;
}

export interface FieldRenderResult {
  readonly image: ColorImage;
  /**
   * PSFs actually evaluated — the cost that matters, and with the radius cache
   * on it is **distinct patch radii × wavelengths**, not patches × wavelengths.
   * That is how a caller learns the cache was taken: the saving is an exact
   * integer a test can assert rather than a wall clock.
   */
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
 * (`fieldDirection` puts it along +x — the tilt lives in the x–z plane, and the
 * off-axis centroid rung pins the traced kernel to that axis). Convolution is
 * shift-invariant, so whatever orientation that kernel has is stamped onto
 * every star in the patch.
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
 * Signed offset of patch `index` of `count` from the axis, in millimetres.
 *
 * One function rather than the expression written twice because the render
 * counts its distinct radii before the loop and then visits them inside it, and
 * the cache is only worth its exactness if those two agree in the last bit.
 */
function patchCentre(index: number, count: number, halfExtentMm: number): number {
  return ((index + 0.5) / count - 0.5) * 2 * halfExtentMm;
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
  // Coarse-to-fine, each level a complete image. Doubling because it is the
  // ladder that shows the most change per level; the levels do NOT nest — 4×4's
  // centres sit at ¼ and ¾ of the half-frame and 2×2's at ½, so a level shares
  // no radius with the one below it except the axis. What makes the previews
  // affordable is the radius cache, not any nesting: they add one stack each
  // rather than p², and for an odd `finest` the 1×1 preview adds none at all.
  const levels: number[] = [];
  for (let p = 1; p <= finest; p *= 2) levels.push(p);
  if (levels[levels.length - 1] !== finest) levels.push(finest);

  const cacheEnabled = options.psfCache ?? true;
  // The whole ladder's distinct radii, up front, so `onPsf` counts down to the
  // number that will actually be reached. Built from `patchCentre` rather than
  // from a formula for the count, so it cannot drift from the loop below —
  // which is the failure mode that leaves a progress bar stuck at a quarter.
  const radii = new Set<number>();
  for (const patches of levels) {
    for (let i = 0; i < patches; i++) {
      for (let j = 0; j < patches; j++) {
        radii.add(
          Math.hypot(
            patchCentre(j, patches, scene.halfExtentMm),
            patchCentre(i, patches, scene.halfExtentMm),
          ),
        );
      }
    }
  }

  let psfEvaluations = 0;
  const totalPsfs = cacheEnabled ? radii.size : levels.reduce((acc, p) => acc + p * p, 0);
  // Keyed on the radius itself, and spanning the levels rather than reset per
  // level: equal keys mean an equal field angle, so a hit is bitwise the stack
  // the miss would have built. Nothing may write into a value here — see the
  // header's invariant.
  const stacks = new Map<number, SpectralStack>();
  let result: ColorImage | null = null;

  for (const patches of levels) {
    const xyz = new Float64Array(n * n * 3);

    for (let py = 0; py < patches; py++) {
      for (let px = 0; px < patches; px++) {
        // Field angle at this patch's centre, from its offset on the image
        // plane. Radial, because the system is axially symmetric — which is the
        // same fact the cache below spends.
        const cx = patchCentre(px, patches, scene.halfExtentMm);
        const cy = patchCentre(py, patches, scene.halfExtentMm);
        const radiusMm = Math.hypot(cx, cy);
        // The traced PSF belongs to a field point on the +x axis
        // (`fieldDirection` tilts the bundle in the x–z plane), so it has to be
        // turned by this patch's own azimuth. See `rotateKernel`. The azimuth is
        // the ONLY thing two patches at one radius do not share, which is why
        // the stack can be reused and the kernel cannot.
        const azimuth = radiusMm > 0 ? Math.atan2(cy, cx) : 0;

        let stack: SpectralStack | undefined = cacheEnabled ? stacks.get(radiusMm) : undefined;
        if (stack === undefined) {
          stack = spectralStack(system, fieldAngleFor(system, radiusMm, scene), {
            ...options,
            pixelScaleMm: scene.pixelScaleMm,
          });
          if (cacheEnabled) stacks.set(radiusMm, stack);
          psfEvaluations += scene.samples.length;
          options.onPsf?.(psfEvaluations, totalPsfs * scene.samples.length);
        }
        basis ??= spectralXyzBasis(stack.samples);

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
