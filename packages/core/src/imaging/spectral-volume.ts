import { getMedium } from "../materials/catalog";
import { objectNumericalAperture } from "../pupil/microscope";
import { paraxialTrace } from "../trace/paraxial";
import type { OpticalSystem, WavelengthSample } from "../trace/system";
import type { EmissionSpectrum } from "./emission";
import {
  depthRescale,
  rasterizeEmitterVolume,
  type DepthRescale,
  type EmitterSlabs,
  type RasterizedEmitterVolume,
  type VolumeEmitterDensity,
} from "./emitter-volume";
import {
  stackEmitterPlanes,
  type FluorescenceSpectralStack,
  type StackEmitterOptions,
} from "./emitter-spectrum";
import {
  fieldPupilAt,
  objectFieldTile,
  type FieldPupilOptions,
  type ObjectFieldFrame,
} from "./object-field";
import { radialMapCovering, type RadialMap } from "./radial-map";
import type { SpectralPlaneInput, StackedSpectralPlane } from "./spectral-stack";
import { defocusing, renderVolume, type VolumeImage } from "./volume";

/**
 * The spectral volume — § 6az's rescale times § 6ba's spectrum, and the product
 * neither of them measured.
 *
 * § 6az makes the object map move with **depth**: a chief ray from depth `z` is
 * the same line as a chief ray from the nominal plane at height `h/(1 + z·k)`,
 * so one radial table serves a whole stack and depth is one scalar per slice.
 * § 6ba makes the density read a **wavelength**, so a two-stain preparation is a
 * stack of planes kept apart until the observer integrates them. Both steps
 * closed with the same line in "still open": the two are independent today, and
 * a thick two-stain preparation is their product.
 *
 * It is their product, and no new optics arrive with this step. What arrives is
 * that **both factors are chromatic**, and the way they are chromatic is the
 * step's whole subject.
 *
 * ## The perspective is not ordered by colour, and green is the extreme
 *
 * § 6az.4 found the depth rate `k` has **two** object-space telecentric zeros
 * inside the visible band — 530.567099 nm and 587.5618 nm on the default DIN
 * 4×/0.10 — and reverses sign between them. A *channel* is a band, so what a
 * channel sees is the band average of `k`, and averaging across a sign reversal
 * does something a monochromatic intuition does not predict:
 *
 *     433–500 nm (blue)    ≈2.9e−5 /mm
 *     510–560 nm (green)   ≈6e−8 /mm       — telecentric: 300× smaller and more
 *     600–667 nm (red)     ≈8.0e−6 /mm
 *
 * The green figure is a **cancellation** — roughly +1e−5 against −1.5e−6 — so it
 * is the one number here that moves with the quadrature: it halves between 61
 * and 481 samples across 400–700 nm while the blue and the red wobble by 3% and
 * 1%. § 6bb.9 therefore pins the order of magnitude and the *ordering*, which
 * survive every count, and pins the staircase itself rather than one count's
 * digits — § 6ba.8's lesson, on a quantity that needed it more.
 *
 * The green channel straddles the free crossing, so its perspective **cancels**:
 * a green channel of a three-stain preparation has essentially no depth
 * perspective at all while the blue and the red do. The quantity is therefore
 * not monotone in colour — the middle channel is the extreme one — and "how far
 * apart are these two dyes" says nothing about whether their two images of a
 * thick specimen share a perspective. What decides it is which side of a
 * crossing each band sits on (§ 6bb.9).
 *
 * ## The channels also focus at different places, and it is the larger effect
 *
 * A stack is rendered at one stage position, so the objective's own **axial
 * colour** decides which depth each channel is sharp at. That is already in the
 * traced pupil — § 6ba.5 named it as the cause of the blue-violet halo — and a
 * volume is what turns it into a *depth*: sweep the stage, find each channel's
 * peak, and they peak in different places. On the default objective the picture
 * puts best focus at
 *
 *     430 nm      0.2136 mm
 *     486.1327    0.0977
 *     546.074     0.0510
 *     587.5618    0.0469
 *     656.2725    0.0672
 *
 * — 0.167 mm from the blue channel to the design wavelength, which is **3.88
 * depths of focus** at 430 nm (§ 6bb.6). Beside that, the perspective term is
 * nothing: § 6bb.10 pins the depth-dependent part of the two channels'
 * misregistration against § 6ba.9's static 0.180% and finds it reaches parity
 * only at **83–86 mm** of specimen depth, which is to say never. That bound is
 * safe to quote where the green channel's own figure is not: blue against red is
 * a difference and not a cancellation, so it moves 1.5% under the same
 * refinement that halves the green.
 *
 * **And the focus separation is not the catalogue number.** `focusDepthMm` is
 * the paraxial object-side chromatic focal shift, and it puts 430 nm at
 * 0.1102 mm — 51% short of the 0.1667 mm the picture actually shows, because the
 * ρ⁴ term of the traced wavefront falls 4.60× across the band (1.9284 waves at
 * 430 nm to 0.4196 at 656) and each channel's best focus is balanced against its
 * own spherical aberration. A chromatic-focal-shift figure does not say where a
 * channel focuses (§ 6bb.7).
 *
 * ## Two conditions, twice each, and only one wavelength shared
 *
 * § 6ap's mechanism — an achromatic element turns a quantity around inside the
 * band, so a condition that would hold once holds twice — now applies to two
 * different quantities on one objective, and they do not pick the same pair:
 *
 *     in focus      500.514925 nm   and   587.5618 nm
 *     telecentric   530.567099 nm   and   587.5618 nm
 *
 * The design wavelength is shared because both were engineered there — § 6v puts
 * the stop at the back focal distance read at it, and the conjugate is solved at
 * it — and the two *free* crossings are 30 nm apart and belong to nothing
 * (§ 6bb.8).
 *
 * ## What this module does, and the one thing it does not
 *
 * Per wavelength: its own frame, its own radial table, its own depth rescale,
 * its own rasterized volume, its own object-side NA, and one `renderVolume`.
 * Then `stackEmitterPlanes` on the bluest plane's ruler as **energy**, for
 * § 6ba's reason — an emitter plane holds flux, so the resampler carries `k²`.
 * The cost is `N_λ × N_z` convolutions and there is no economy to be had: § 6j's
 * band collapses only for one label, and § 6k's depth never collapses at all
 * except for a specimen uniform in z, which the rescale stops being uniform on
 * the grid the moment the system is not telecentric (§ 6az.11).
 *
 * **`patches` is not supported.** The pupil is read once at the tile centre and
 * defocused per slice, because `renderVolume` weighs each slice by the pupil's
 * own `formedSum` and `renderFluorescence` does not — they are two expressions
 * of one convolution and only one of them carries the throughput. Blending
 * field-varying patches through a depth stack would need the two reconciled, and
 * a second expression that merely agreed numerically is what § 6ba refused to
 * ship. Named here rather than silently folded to one patch.
 *
 * That difference has a readout of its own: the volume path multiplies by
 * `formedSum` and the plane path normalizes it away, so **the volume path
 * carries the objective's transmission spectrum and § 6ba's does not** — 0.658%
 * across 430–680 nm, matching the on-axis amplitude squared to 4.4e−6 — the
 * residue is the λ-dependence of the pupil's *profile*, which is second order
 * because the profile itself largely cancels in a ratio between two
 * wavelengths (§ 6bb.2).
 *
 * ## What is deliberately not here
 *
 * **No excitation and no differential bleaching**, § 6ba's structural null,
 * unchanged: the emission filter blocks the excitation, so it never reaches the
 * image, and a preparation whose stains want different lasers is outside this
 * module.
 * **No depth-dependent spherical aberration.** § 6l varies the *pupil* with
 * depth and this varies the *map* and the *defocus*; a mount whose index is not
 * the immersion's does both at once and its rescale is not `1 + z·k` at all.
 * `mountPupils` and `DepthRescale` are still independent, and now so is the
 * wavelength.
 * **No deconvolution and no confocal**, § 6k's missing cone.
 * **No spectral mosaic**, § 6r's own deferral inherited through § 6ba.
 * **No photometric zero point**, still § 3a's. Every number here is a ratio.
 */

/**
 * Emitted power per unit **volume** of the specimen, per wavelength.
 *
 * `VolumeEmitterDensity` with `SpectralEmitterDensity`'s fourth argument, and
 * for the same reason: what makes a two-stain preparation look like two stains
 * is that this callback reads `nm`. `zMm` is the **specimen's own depth**, not
 * the offset from focus — a stain does not move when the stage does.
 */
export type SpectralVolumeEmitterDensity = (
  xMm: number,
  yMm: number,
  zMm: number,
  nm: number,
) => number;

/** One wavelength's slice of a spectral volume density, as a plain one. */
export function atVolumeEmissionWavelength(
  density: SpectralVolumeEmitterDensity,
  nm: number,
): VolumeEmitterDensity {
  return (xMm, yMm, zMm) => density(xMm, yMm, zMm, nm);
}

/** A single-label volumetric density: one distribution in space, one band. */
export interface VolumeEmitterLabel {
  /** Where this stain is, in the specimen's own millimetres, in three. */
  readonly density: VolumeEmitterDensity;
  /**
   * What it emits — this label's band, and **not** the emission filter, which is
   * one piece of glass common to every label and belongs in the sample weights
   * (`EmitterLabel`'s rule, unchanged one dimension up).
   */
  readonly band: EmissionSpectrum;
}

/**
 * Several labels in one thick preparation — `Σ_s E_s(x, y, z)·w_s(λ)`.
 *
 * The form that does not collapse into one kernel (§ 6ba's second failure), now
 * with a third coordinate that does not collapse either (§ 6k's). One label is
 * legal and is the single-label case written the long way.
 */
export function labelledVolumeEmitters(
  labels: readonly VolumeEmitterLabel[],
): SpectralVolumeEmitterDensity {
  if (labels.length === 0) throw new Error("labelledVolumeEmitters: no labels");
  return (xMm, yMm, zMm, nm) => {
    let sum = 0;
    for (const label of labels) {
      const w = label.band(nm);
      if (w === 0) continue;
      sum += w * label.density(xMm, yMm, zMm);
    }
    return sum;
  };
}

/** A wavelength-independent volumetric density, seen as a spectral one. */
export function neutralVolumeEmitterDensity(
  density: VolumeEmitterDensity,
): SpectralVolumeEmitterDensity {
  return (xMm, yMm, zMm) => density(xMm, yMm, zMm);
}

/**
 * The specimen depth that is in focus at a wavelength, paraxially — the
 * objective's own axial colour, in the coordinate a stack is authored in.
 *
 * Zero at the wavelength the conjugate was solved at, positive **away from the
 * objective**, which is `EmitterSlice.zMm`'s direction: a positive shift means
 * the stage must be racked so that a deeper plane is the sharp one.
 *
 * Exact rather than bisected. A paraxial trace is linear in its input state, so
 * the image height from an axial object at distance `d` is `A·d + B` and the
 * root in `d` is one division — two traces, no iteration, no tolerance.
 *
 * It is the **paraxial** shift and the header says why that matters: the depth
 * a channel is actually sharpest at is this shift balanced against that
 * channel's own spherical aberration, and on the default objective the two
 * differ by 50% (§ 6bb.7). This is the catalogue quantity, not the picture's.
 */
export function focusDepthMm(system: OpticalSystem, wavelengthNm: number): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error(
      "focusDepthMm: an infinite conjugate has no object plane, so there is no depth for a " +
        "wavelength to be in focus at — this is the microscope's quantity",
    );
  }
  const d = system.conjugate.distance;
  const at = (distance: number) =>
    paraxialTrace(system.prescription, wavelengthNm, { y: distance, u: 1 }).y;
  const y0 = at(d);
  const slope = at(d + 1) - y0;
  if (slope === 0) {
    throw new Error(
      `focusDepthMm: the paraxial image height does not move with the object distance at ` +
        `${wavelengthNm} nm — the conjugate is not one a stage can focus`,
    );
  }
  return -y0 / slope;
}

export interface FluorescenceVolumeOptions extends FieldPupilOptions {
  /** Grid size for every wavelength's own frame, a power of two. */
  readonly size: number;
  /** Frequency bins across the pupil diameter, as in `abbeImage`. */
  readonly pupilSamples: number;
  /**
   * The wavelengths, sampled. `weight` is **pure quadrature** — Δλ and nothing
   * else, so `quadratureSamples`. Every label's band lives in the density and
   * the emission filter goes in `filter`, which is `FluorescenceSpectrumOptions`'
   * split unchanged and for the same reason: what varies with position goes in
   * the density, what is common to the path goes in the weights.
   */
  readonly samples: readonly WavelengthSample[];
  /** Slice centres and the slab each stands for, in the specimen's own depth. */
  readonly slabs: EmitterSlabs;
  /** The emission filter, applied to the sample weights. One piece of glass. */
  readonly filter?: EmissionSpectrum;
  /**
   * The **specimen depth the objective is focused on** (object mm), default 0.
   *
   * The stage, so it is one number for every channel however differently they
   * focus — which is the whole of § 6bb.6. It enters the *rasterizer*, because
   * a focus series is a series of different rescales and not one volume viewed
   * twice (§ 6az's header); `renderVolume` then takes the emitted slices at its
   * own default focus, since they are already referred to this one.
   */
  readonly focusMm?: number;
  /** Image-plane centre of the tile (mm). Wavelength-independent; default axis. */
  readonly centreMm?: { readonly x: number; readonly y: number };
  /**
   * Object-side NA. Default: **traced per wavelength**, which is a third way
   * depth is chromatic — `defocusWaves` is δ·NA²/(2nλ), so both the NA and the λ
   * move. On the default objective the NA moves 0.26% across the band against
   * the wavelength's own 58%, so it is small and it is not zero.
   */
  readonly numericalAperture?: number;
  /** Immersion index. Default: the object medium's, at each wavelength. */
  readonly refractiveIndex?: number;
  /** Intervals in each wavelength's tabulated radial map. Default 128. */
  readonly radialMapNodes?: number;
  readonly stack?: StackEmitterOptions;
  /** Called once per wavelength finished. */
  readonly onWavelength?: (done: number, total: number, nm: number) => void;
  /** Called once per slice of the wavelength being rendered. */
  readonly onSlice?: (done: number, total: number, nm: number) => void;
}

/** One wavelength's volume, formed — everything a stack needs from it. */
export interface FormedVolumePlane {
  readonly frame: ObjectFieldFrame;
  /** This wavelength's own rate, and the identity that refuses another's frame. */
  readonly rescale: DepthRescale;
  /** The rasterized specimen, referred to `focusMm`. */
  readonly volume: RasterizedEmitterVolume;
  /** The imaged stack, before the common ruler. */
  readonly image: VolumeImage;
  /** The object-side NA the depth was converted to waves with. */
  readonly numericalAperture: number;
  readonly input: SpectralPlaneInput;
}

/** One wavelength's plane of a spectral volume, on the common grid. */
export interface VolumePlane extends StackedSpectralPlane {
  readonly frame: ObjectFieldFrame;
  readonly rescale: DepthRescale;
  /** `max |1 + z·k − 1|` over this channel's stack — the perspective it saw. */
  readonly maxStretchDeparture: number;
  /** This channel's in-focus share; chromatic, because the half depth is. */
  readonly inFocusFraction: number;
  readonly maxGridPhaseStepWaves: number;
}

export interface FluorescenceSpectralVolume extends FluorescenceSpectralStack {
  readonly planes: readonly VolumePlane[];
  /** Max over wavelengths — keyed on the bluest, worst-resolved plane. */
  readonly maxGridPhaseStepWaves: number;
  /** The stage position every channel was rendered at. */
  readonly focusMm: number;
}

/**
 * Form ONE wavelength's volume: its own frame, table, rate, raster and render.
 *
 * Factored out for `formEmitterPlane`'s reason — a second expression that
 * merely agreed numerically would be free to drift — and so a caller who wants
 * one channel at a time has the same one. § 6bb.1 pins it bitwise against the
 * § 6az render written by hand.
 */
export function formVolumePlane(
  system: OpticalSystem,
  density: SpectralVolumeEmitterDensity,
  options: FluorescenceVolumeOptions,
  sample: WavelengthSample,
  centreMm: { readonly x: number; readonly y: number },
  radialMap?: RadialMap,
): FormedVolumePlane {
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
  const rescale = depthRescale(system, sample.nm);
  const volume = rasterizeEmitterVolume(
    frame,
    atVolumeEmissionWavelength(density, sample.nm),
    {
      radialMap: table,
      rescale,
      slabs: options.slabs,
      ...(options.focusMm === undefined ? {} : { focusMm: options.focusMm }),
      ...(options.aim === undefined ? {} : { aim: options.aim }),
    },
  );
  const numericalAperture =
    options.numericalAperture ?? objectNumericalAperture(system, sample.nm);
  const refractiveIndex =
    options.refractiveIndex ??
    getMedium(system.prescription.objectMedium ?? "AIR").n(sample.nm);
  const pupil = fieldPupilAt(system, frame, 0.5, 0.5, options).pupil;
  const image = renderVolume(volume, defocusing(pupil), {
    pupilSamples: options.pupilSamples,
    numericalAperture,
    wavelengthNm: sample.nm,
    refractiveIndex,
    scale: frame.scale,
    ...(options.onSlice === undefined
      ? {}
      : { onSlice: (done: number, total: number) => options.onSlice!(done, total, sample.nm) }),
  });
  return {
    frame,
    rescale,
    volume,
    image,
    numericalAperture,
    input: {
      nm: sample.nm,
      weight: sample.weight * (options.filter?.(sample.nm) ?? 1),
      size: frame.size,
      pixelScaleMm: frame.pixelScaleMm,
      intensity: image.intensity,
    },
  };
}

/**
 * The polychromatic fluorescence image of a thick, multiply stained specimen.
 *
 * One frame, one table, one rate, one raster and one depth stack per
 * wavelength, then the planes on the bluest one's ruler as energy. Hand the
 * result to `colorImageFromStack` for colour, or to it with `channelBasis` for
 * one channel of a multi-label preparation — the channels are a reweighting of
 * the observer basis rather than a re-render, exactly as on a plane, and legal
 * for the same reason: the stack kept the wavelengths apart.
 */
export function fluorescenceSpectralVolume(
  system: OpticalSystem,
  density: SpectralVolumeEmitterDensity,
  options: FluorescenceVolumeOptions,
): FluorescenceSpectralVolume {
  const { samples } = options;
  if (samples.length === 0) throw new Error("fluorescenceSpectralVolume: no wavelengths");
  const centreMm = options.centreMm ?? { x: 0, y: 0 };

  const formed: FormedVolumePlane[] = [];
  const input: SpectralPlaneInput[] = samples.map((sample, i) => {
    const plane = formVolumePlane(system, density, options, sample, centreMm);
    formed.push(plane);
    options.onWavelength?.(i + 1, samples.length, sample.nm);
    return plane.input;
  });

  const stacked = stackEmitterPlanes(input, options.stack ?? {});
  let maxGridPhaseStepWaves = 0;
  for (const p of formed) {
    maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, p.image.maxGridPhaseStepWaves);
  }

  return {
    ...stacked,
    planes: stacked.planes.map((p, i) => {
      const f = formed[i]!;
      return {
        ...p,
        frame: f.frame,
        rescale: f.rescale,
        maxStretchDeparture: f.volume.maxStretchDeparture,
        inFocusFraction: f.image.inFocusFraction,
        maxGridPhaseStepWaves: f.image.maxGridPhaseStepWaves,
      };
    }),
    maxGridPhaseStepWaves,
    focusMm: options.focusMm ?? 0,
  };
}
