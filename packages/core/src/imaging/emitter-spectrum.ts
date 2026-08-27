import type { OpticalSystem, WavelengthSample } from "../trace/system";
import { spectralXyzBasis, type XyzBasis } from "../photometry/spectrum";
import {
  objectFieldTile,
  tracedFieldPupils,
  type FieldPupilOptions,
  type ObjectFieldFrame,
} from "./object-field";
import { radialMapCovering, type RadialMap } from "./radial-map";
import { rasterizeEmitterDensity, type EmitterDensity } from "./emitter-density";
import { renderFluorescence } from "./fluorescence";
import type { EmissionSpectrum } from "./emission";
import {
  stackSpectralPlanes,
  type SpectralPlaneInput,
  type StackSpectralOptions,
  type StackedSpectralPlane,
  type StackedSpectralPlanes,
} from "./spectral-stack";

/**
 * The spectral emitter density — § 6as's last deferral, and the two-stain
 * preparation it named.
 *
 * § 6as closed the extended fluorescent specimen and § 6az the volumetric one.
 * Both left the same line in "still open": `rasterizeEmitters` has no spectrum
 * either, the emission band lives in `imaging/emission` where it serves both, so
 * this is a seam that already works — and it becomes a **gap** the moment a
 * specimen's emission colour varies with position, which is what a two-label
 * preparation is. This module is that case.
 *
 * ## What actually breaks, and it is TWO things that are not the same thing
 *
 * `imaging/emission`'s header states the economy this branch has run on since
 * § 6j. A single-label specimen emits with one spectrum, so the density factors
 * as `E(x)·w(λ)`, and linearity moves the whole band into the kernel:
 *
 *     I = Σ_λ w_λ · (h_λ ⊛ E) = (Σ_λ w_λ h_λ) ⊛ E
 *
 * — one convolution, not one per wavelength. That header then says a two-label
 * specimen "does not factor that way, and that is the colour deferral § 6i
 * already recorded". **That sentence bundles two independent failures**, and
 * separating them is the first thing this step has to do, because they have
 * different causes, different witnesses, and different fixes.
 *
 * **One: colour needs the planes kept apart, and the label count is irrelevant.**
 * `imaging/image` has said since § 2f that colour must be integrated *while* the
 * wavelengths are still separate — a monochrome collapse has already summed away
 * the information a tint would need. That is true of a SINGLE label. § 6ba.5
 * measures it on one: an emitter with one flat band images to a core at
 * chromaticity (0.4104, 0.4425) and a skirt at (0.2285, 0.1826) 24 pixels out,
 * while the whole image integrates to (0.3356, 0.3378) — white, to three
 * decimals, as an equal-energy source must. No single tint reproduces that,
 * however the collapsed image is coloured, and the label count never entered.
 *
 * And the mechanism is **the objective's own axial colour**, not diffraction:
 * repeated through `idealPupil` at every wavelength the same emitter's swing
 * collapses to (0.3208, 0.3243) → (0.3490, 0.3587) and **reverses direction** —
 * a faint reddening outward, which is the λ-scaling of a diffraction skirt. The
 * traced objective's blue-violet halo is § 6e's "chromatic half" arriving as a
 * colour, and the ideal-pupil control is what separates the two (§ 6ba.5).
 *
 * **Two: two labels break the factorization, and colour is irrelevant.** With
 * `E(x, λ) = Σ_s E_s(x)·w_s(λ)` the sum still moves through the convolution, but
 * it moves through **once per label**:
 *
 *     I = Σ_s (Σ_λ w_λ w_s(λ) h_λ) ⊛ E_s
 *
 * — S kernels, not one. So even a monochrome readout of a two-label specimen is
 * wrong under § 6j's collapse, and § 6ba.6 pins that: with one band the two paths
 * agree to **2.9e−16**, an identity in f64, and with two bands 60 nm apart they
 * differ by 14.5% relative RMS, rising to 45.3% at 200 nm.
 *
 * That rung carries a warning worth more than the numbers. At 9 samples across
 * 400–700 nm the bins are 33 nm wide, and two 100 nm bands separated by 15 or
 * 30 nm cover the *same sample set* — so the identity holds to 2.9e−16 there
 * too, not because the specimen factors but because **the quadrature cannot see
 * that it doesn't**. A two-stain render whose labels are closer together than
 * one bin is a single-label render wearing two names, and nothing downstream
 * says so.
 *
 * ## The convolution count is the LABEL count, and the plane count is the band's
 *
 * Those two facts are what the API is shaped around, and they pull in opposite
 * directions. This module renders a **stack**: one frame, one raster and one
 * `renderFluorescence` per wavelength, exactly as § 6r does for brightfield, and
 * the labels are summed *in the density's argument* before the convolution —
 * so the cost is the wavelength count and not the product. That is legal because
 * `E(·, λ)` is a plain `EmitterField` at each λ, and the whole seam § 6as kept
 * still holds: nothing below the authoring layer learns that a spectrum exists.
 *
 * The S-kernel form above is what a *monochrome* two-label render would cost, and
 * it is cheaper when S < N_λ. It is not built, because a monochrome two-label
 * image is a readout of the colour one and the colour one is what a preparation
 * with two stains in it is for.
 *
 * **It is also far cheaper than § 6r's stack.** A brightfield plane costs one
 * Abbe sum per source point; a fluorescence plane costs one transform pair,
 * `imaging/fluorescence`'s "the cost of emitting rather than modulating". Nine
 * wavelengths at 64² is seconds here against minutes there.
 *
 * ## Where a spectrum may live: POSITIONAL or not
 *
 * `photometry/spectrum` splits the world into "one source, no scene — the SED
 * goes in the weights" and "a scene — the SED belongs to each source and the
 * weights are pure quadrature", and `imaging/emission` puts a single-label band
 * squarely in the first. A two-label specimen is the second, and the reason
 * generalizes both: **what varies with position goes in the density, and what is
 * common to the path goes in the weights.**
 *
 * That settles three questions at once, and it is the module's organizing rule:
 *
 *  - Each label's emission band is positional — it is *which stain is here* —
 *    so it belongs to `SpectralEmitterDensity` and to nothing else.
 *  - The **emission filter** is not positional. It is one piece of glass in the
 *    path, common to every label, so it belongs in the sample weights, and
 *    `filter` is where it goes.
 *  - `samples` is therefore **pure quadrature** — `quadratureSamples`, Δλ and
 *    nothing else.
 *
 * Handing this function `emissionSamples` applies a band twice: once in the
 * weights and again in whatever the labels carry. § 6j.1 pinned that a band
 * enters once; § 6ba.7 pins the failure here, where it is worse, because with
 * two labels the doubly-applied band is not even the right *shape* — it is one
 * label's, and the image comes back a plausible wrong colour.
 *
 * **It is not refused, and the reason is that no honest test exists.**
 * `emissionSamples` normalizes to sum 1 where `quadratureSamples` sums to the
 * band width, so the common case is detectable — but a caller with a legitimate
 * 1 nm band, or one who normalized their own quadrature, would be refused for
 * being right. A heuristic that refuses correct callers is worse than a pinned
 * negative control, and `imaging/scene` reached the same verdict for the same
 * reason.
 *
 * ## Crosstalk is the thing the filter is FOR, and it has a closed form
 *
 * Two stains and two filters are two channels, and the number that decides
 * whether they are really two is the **bleed-through**: the fraction of label B's
 * emitted power that label A's filter passes,
 *
 *     ∫ B(λ)·T_A(λ) dλ / ∫ B(λ) dλ
 *
 * which for boxcars is one division. `channelCrosstalk` computes it on the same
 * samples the render uses, so it is the leak the render will actually show
 * rather than an ideal one — and § 6ba.8 pins the two against each other.
 *
 * The quadrature is **exact**, at every sample count, whenever the band's and
 * the filter's edges fall on bin boundaries: the integrand is then piecewise
 * constant on the bins and the midpoint rule is exact for constants. Off a
 * boundary it is not, and it does not converge smoothly either — the error is a
 * staircase that only moves when a sample crosses an edge (5.0e−2 at 9, 18 and
 * 36 samples; 1.25e−2 at 72 and 144; 3.1e−3 at 288 and 576). So the honest
 * statement is the aligned identity, and § 6ba.8 measures the staircase rather
 * than quoting a rate it does not have.
 *
 * ## What comes out free, and it is a real microscope's problem
 *
 * The frames are concentric in the *image* plane and every one is traced at its
 * own wavelength, so the object point a given pixel looks at is
 * wavelength-dependent — § 6r.6's lateral colour. On a two-label specimen that
 * stops being an aberration and becomes **channel misregistration**: the same
 * physical structure lands at different pixels in the two channels. § 6ba.9
 * measures it on the DIN 4×/0.10 — 0.462 px between a 433–500 nm channel and a
 * 600–667 nm one at 0.8 mm of field, growing linearly from 1.7e−4 px on the axis,
 * and the ratio to field height is constant to 0.5%, which says it is a
 * **magnification** difference of 0.180% between the channels and not a
 * higher-order distortion.
 *
 * ## What is deliberately not here
 *
 * **No volume.** § 6az's rescale and this module's spectrum are independent
 * today; a spectral volume is their product and its own step.
 * **No excitation.** The emission filter blocks it, so it never reaches the
 * image (`imaging/emission`'s structural null) — which also means this module
 * cannot model *differential bleaching* or a stain excited by only one laser.
 * **No fluorophore is named**, § 6j's rule: `boxcarBand` is a statement about an
 * interference filter, and a dye's lineshape is measured data.
 * **No photometric zero point**, still § 3a's. Every number here is a ratio.
 */

/**
 * Emitted power per unit area of the specimen, **per wavelength**.
 *
 * `EmitterDensity` with the third argument `SpectralSpecimen` has, and for the
 * same reason: the whole of "what makes a two-stain preparation look like two
 * stains" is that this callback reads `nm`. A density that ignores it is a
 * single-label specimen by definition, which is how § 6ba.1 states its first
 * rung — one label in, § 6as's rasterizer out, wavelength by wavelength.
 *
 * Not a superset of `EmitterDensity` in the type system, matching
 * `SpectralSpecimen`: `rasterizeEmitterDensity` takes the two-argument form and
 * is called once per wavelength with `nm` already bound, so nothing below the
 * authoring layer learns that a spectrum exists.
 */
export type SpectralEmitterDensity = (xMm: number, yMm: number, nm: number) => number;

/**
 * One wavelength's slice of a spectral emitter density, as a plain one.
 *
 * `imaging/specimen`'s `atWavelength` does exactly this to a transmittance. The
 * name differs only because both modules are re-exported from one barrel and the
 * two cannot share it — there is no distinction of meaning to read into it.
 */
export function atEmissionWavelength(
  density: SpectralEmitterDensity,
  nm: number,
): EmitterDensity {
  return (xMm, yMm) => density(xMm, yMm, nm);
}

/** A single-label density: one spatial distribution, one emission band. */
export interface EmitterLabel {
  /** Where this stain is, in the specimen's own millimetres. */
  readonly density: EmitterDensity;
  /**
   * What it emits — this label's band, and **not** the emission filter.
   *
   * The filter is common to the path and belongs in the sample weights (see the
   * header). Putting it here too applies it once per label, which on a two-label
   * preparation is not even a consistent error.
   */
  readonly band: EmissionSpectrum;
}

/**
 * Several labels in one preparation — the shape a two-stain slide takes.
 *
 * `Σ_s E_s(x)·w_s(λ)`, which is the exact form the header's second failure is
 * about: this sum is what does not collapse into one kernel, and the reason it
 * does not is that the two factors are no longer separable across the sum.
 *
 * One label is legal and is the single-label case written the long way — § 6ba.6
 * uses exactly that to show where the identity holds.
 */
export function labelledEmitters(labels: readonly EmitterLabel[]): SpectralEmitterDensity {
  if (labels.length === 0) throw new Error("labelledEmitters: no labels");
  return (xMm, yMm, nm) => {
    let sum = 0;
    for (const label of labels) {
      const w = label.band(nm);
      if (w === 0) continue;
      sum += w * label.density(xMm, yMm);
    }
    return sum;
  };
}

/** A wavelength-independent density, seen as a spectral one. */
export function neutralEmitterDensity(density: EmitterDensity): SpectralEmitterDensity {
  return (xMm, yMm) => density(xMm, yMm);
}

/**
 * The fraction of a band's emitted power that a filter passes, on given samples.
 *
 * The bleed-through between two channels when `band` is one label's and `filter`
 * is the *other* label's, and the channel's own efficiency when they belong
 * together. Computed on the samples the render will use, so it is the leak the
 * render actually shows — see the header for when that equals the continuous
 * integral exactly, and for the staircase it carries when it does not.
 */
export function channelCrosstalk(
  band: EmissionSpectrum,
  filter: EmissionSpectrum,
  samples: readonly WavelengthSample[],
): number {
  let passed = 0;
  let emitted = 0;
  for (const s of samples) {
    const b = s.weight * band(s.nm);
    emitted += b;
    passed += b * filter(s.nm);
  }
  if (!(emitted > 0)) {
    throw new Error("channelCrosstalk: the band emits nothing on these samples");
  }
  return passed / emitted;
}

/** One wavelength's emitter plane, on its own grid, before stacking. */
export type EmitterPlaneInput = SpectralPlaneInput;

/** One wavelength's plane, already on the stack's common physical grid. */
export interface EmitterPlane extends StackedSpectralPlane {
  /** Present only for a traced stack. */
  readonly frame?: ObjectFieldFrame;
  readonly maxGridPhaseStepWaves?: number;
}

export interface FluorescenceSpectralStack extends StackedSpectralPlanes {
  readonly planes: readonly EmitterPlane[];
  /** Max over wavelengths — keyed on the bluest, worst-resolved plane. */
  readonly maxGridPhaseStepWaves?: number;
}

export type StackEmitterOptions = StackSpectralOptions;

/**
 * Put per-wavelength emitter planes on one common physical grid.
 *
 * The geometry is `imaging/spectral-stack`'s, shared with § 6r. This is where
 * **`"energy"`** is chosen, and § 6as is what earns the choice: an emitter plane
 * holds the flux landing in each pixel, because the rasterizer multiplied a
 * density by the object area the pixel covers and the kernel sums to 1. § 6ba.3
 * measures the negative control — the irradiance resampler inflates a 680 nm
 * plane against a 430 nm ruler by 2.5008×, which is `1/k²`, and turns the image
 * red.
 */
export function stackEmitterPlanes(
  input: readonly EmitterPlaneInput[],
  options: StackEmitterOptions = {},
): FluorescenceSpectralStack {
  return stackSpectralPlanes(input, "energy", options, "stackEmitterPlanes");
}

export interface FluorescenceSpectrumOptions extends FieldPupilOptions {
  /** Grid size for every wavelength's own frame, a power of two. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /**
   * The wavelengths, sampled. `weight` is **pure quadrature** — Δλ and nothing
   * else, so `quadratureSamples`. Every label's band lives in the density and
   * the emission filter goes in `filter`; see the header for why that split is
   * the one that generalizes, and why passing `emissionSamples` here is not
   * refused even though it is wrong.
   */
  readonly samples: readonly WavelengthSample[];
  /**
   * The emission filter, applied to the sample weights.
   *
   * One piece of glass in the path, common to every label — which is exactly why
   * it is here and not on a label. Omitted, every wavelength of `samples` is
   * passed, which is an open path and not a missing filter.
   */
  readonly filter?: EmissionSpectrum;
  /** Image-plane centre of the tile (mm). Wavelength-independent; default axis. */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /** Patches across the tile, per axis — `renderFluorescence`'s knob. */
  readonly patches?: number;
  /**
   * Intervals in each wavelength's tabulated radial map. Default 128.
   *
   * **One table per wavelength, never one for the stack** — § 6r's rule, and
   * `radialMapCovering` refuses to build one across frames of different λ. It has
   * a default here where § 6r's is opt-in because § 6as makes the table
   * *required*: a Jacobian is a derivative, and there is no bisect-per-pixel
   * branch to fall back to. 128 is § 6as's own floor for the derivative — the
   * table's dh/dr stops improving at ~3e−12 relative there.
   */
  readonly radialMapNodes?: number;
  readonly stack?: StackEmitterOptions;
  /** Called once per wavelength finished. */
  readonly onWavelength?: (done: number, total: number, nm: number) => void;
}

/** One wavelength's plane, formed — everything a stack needs from it. */
export interface FormedEmitterPlane {
  readonly frame: ObjectFieldFrame;
  readonly input: EmitterPlaneInput;
  readonly maxGridPhaseStepWaves: number;
}

/**
 * Form ONE wavelength's emitter plane: its own frame, its own table, its own
 * raster, its own traced pupils, its own convolution.
 *
 * Factored out of the driver below for `formBrightfieldPlane`'s reason — a
 * second expression that merely agreed numerically would be free to drift — and
 * so a caller who wants the planes without the stack (a channel at a time, a
 * mosaic later) has the same one.
 *
 * `weight` on the returned input is the sample's times the filter's, which is
 * the one place the filter enters.
 */
export function formEmitterPlane(
  system: OpticalSystem,
  density: SpectralEmitterDensity,
  options: FluorescenceSpectrumOptions,
  sample: WavelengthSample,
  centreMm: { readonly x: number; readonly y: number },
  radialMap?: RadialMap,
): FormedEmitterPlane {
  const frame = objectFieldTile(system, {
    ...options,
    centreMm,
    wavelengthNm: sample.nm,
  });
  const table =
    radialMap ??
    radialMapCovering(system, [frame], {
      nodes: options.radialMapNodes ?? 128,
      ...(options.aim === undefined ? {} : { aim: options.aim }),
    });
  const object = rasterizeEmitterDensity(frame, atEmissionWavelength(density, sample.nm), {
    radialMap: table,
    ...(options.aim === undefined ? {} : { aim: options.aim }),
  });
  // Not an option, and § 6bc is the reason: this module's whole output is a
  // stack of planes formed through a DIFFERENT pupil each, so the light each
  // pupil transmitted is a difference between the planes and never a constant.
  // Quoting each plane in its own units would divide the objective's own
  // transmission spectrum out of the stack one plane at a time (§ 6bc.3).
  const formed = renderFluorescence(object, tracedFieldPupils(system, frame, options), {
    pupilSamples: options.pupilSamples,
    scale: frame.scale,
    throughput: { kind: "transmitted" },
    ...(options.patches === undefined ? {} : { patches: options.patches }),
  });
  return {
    frame,
    input: {
      nm: sample.nm,
      weight: sample.weight * (options.filter?.(sample.nm) ?? 1),
      size: frame.size,
      pixelScaleMm: frame.pixelScaleMm,
      intensity: formed.intensity,
    },
    maxGridPhaseStepWaves: formed.maxGridPhaseStepWaves,
  };
}

/**
 * The polychromatic fluorescence image of an emitter density, through a traced
 * system.
 *
 * One `objectFieldTile` per wavelength about a common `centreMm`, the density
 * rasterized on each one through *its own* traced map and Jacobian,
 * `renderFluorescence` on each, and the planes stacked on the bluest one's
 * ruler as energy. Hand the result to `colorImageFromStack` for colour, or to
 * it with a per-channel basis for one channel of a multi-label preparation.
 */
export function fluorescenceSpectralStack(
  system: OpticalSystem,
  density: SpectralEmitterDensity,
  options: FluorescenceSpectrumOptions,
): FluorescenceSpectralStack {
  const { samples } = options;
  if (samples.length === 0) throw new Error("fluorescenceSpectralStack: no wavelengths");
  const centreMm = options.centreMm ?? { x: 0, y: 0 };

  const frames: ObjectFieldFrame[] = [];
  const perPlane: number[] = [];
  const input: EmitterPlaneInput[] = samples.map((sample, i) => {
    const plane = formEmitterPlane(system, density, options, sample, centreMm);
    frames.push(plane.frame);
    perPlane.push(plane.maxGridPhaseStepWaves);
    options.onWavelength?.(i + 1, samples.length, sample.nm);
    return plane.input;
  });

  const stacked = stackEmitterPlanes(input, options.stack ?? {});
  let maxGridPhaseStepWaves = 0;
  for (const g of perPlane) maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, g);

  return {
    ...stacked,
    planes: stacked.planes.map((p, i) => ({
      ...p,
      frame: frames[i]!,
      maxGridPhaseStepWaves: perPlane[i]!,
    })),
    maxGridPhaseStepWaves,
  };
}

/**
 * The XYZ basis for ONE channel of a multi-label preparation.
 *
 * A channel is the stack seen through one filter, and since the stack's planes
 * are already separate the filter is a reweighting of the observer basis rather
 * than a re-render: `colorImageFromStack(stack, channelBasis(stack, filterA))`
 * and the same with `filterB` are the two channels of one exposure, at the cost
 * of one render and not two.
 *
 * That is only legal because the stack kept the wavelengths apart — which is the
 * header's first failure, seen from the other side. A collapsed kernel would
 * have summed away the very axis a filter selects on.
 */
export function channelBasis(
  stack: { readonly samples: readonly WavelengthSample[] },
  filter: EmissionSpectrum,
): XyzBasis {
  return spectralXyzBasis(
    stack.samples.map((s) => ({ nm: s.nm, weight: s.weight * filter(s.nm) })),
  );
}
