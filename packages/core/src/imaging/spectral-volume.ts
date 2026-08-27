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
import { fieldDefocusing, renderFieldVolume, type FieldVolumeImage } from "./field-volume";

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
 * its own rasterized volume, its own object-side NA, and one `renderFieldVolume`.
 * Then `stackEmitterPlanes` on the bluest plane's ruler as **energy**, for
 * § 6ba's reason — an emitter plane holds flux, so the resampler carries `k²`.
 * The cost is `N_λ × N_z` convolutions and there is no economy to be had: § 6j's
 * band collapses only for one label, and § 6k's depth never collapses at all
 * except for a specimen uniform in z, which the rescale stops being uniform on
 * the grid the moment the system is not telecentric (§ 6az.11).
 *
 * ## § 6be — the third axis, and the surface that turned out to separate
 *
 * `patches` **is** supported now. It was blocked because the two renderers
 * disagreed about brightness, § 6bc chose, § 6bd built `renderFieldVolume`, and
 * this module now runs on it unconditionally: at one patch the swap is
 * **bitwise** — worst pixel difference exactly 0 at every wavelength and at two
 * field radii, `sliceFlux`, `inFocusFraction` and `maxGridPhaseStepWaves`
 * identical — so every § 6bb number above stands untouched and the third axis
 * costs nothing until it is asked for (§ 6be.1).
 *
 * What the third axis is *for* is not what the deferral expected.
 *
 * **The best-focus surface SEPARATES.** A stack is rendered at one stage
 * position, and where a channel is sharp depends on the wavelength (§ 6bb.6) and
 * on the field — but not on the two together. Sweeping the stage on a rendered
 * ball at four object heights and three wavelengths, best focus is a colour term
 * plus a field term, and the interaction is **under 0.0013 mm** — 0.5% of the
 * total spread and 0.03 of a depth of focus. That residual is the sweep's own
 * floor and not a coupling, and § 6be.2 says so with the evidence that decides
 * it: it *changes sign* and its ordering over the three wavelengths *scrambles*
 * between heights, while its absolute size stays ~0.0012 mm. So a focus
 * correction wants **two one-dimensional curves and not a two-dimensional map**.
 *
 * **The field term is even, which is why § 6bb.6 could not see it.** It goes as
 * h² — the drop divided by h² is constant to 5% over a 2.75× range of object
 * height where the drop divided by h moves 2.5× — so its gradient vanishes on
 * the axis exactly, and § 6bb.6 measured the focus at the one field position the
 * field term is flat at. This is the third time the ladder has read an even
 * quantity at its own symmetry point (§ 6bc's throughput, § 6bd's correction of
 * it, this), and the field curve is one curve for every wavelength: the h²
 * coefficient is −0.0682 to −0.0689 mm/mm² across 430–656 nm (§ 6be.4).
 *
 * **And it is half as much again as § 6bb.6's number.** Over 430–656 nm and 0 to
 * 1.1 mm of object height the total best-focus spread is **0.250229 mm = 5.789
 * depths of focus at 430 nm**, against the 3.8775 § 6bb.6 read on the axis. The
 * extremes are blue-on-axis and the design wavelength at the field edge
 * (§ 6be.3).
 *
 * **The estimator has a zero off the axis, and it is the rung that makes the
 * field term the objective's.** `rasterizeEmitterVolume` runs on a radial map
 * and a depth rescale that are *both* field-dependent, so a best focus that
 * moved with height could have been either. An aberration-free pupil returns
 * −2.8e-7 mm at object heights 0, 0.8 and 1.1 alike (§ 6be.5).
 *
 * **Patches reach part of it, and only part.** Field curvature is phase, so a
 * patched frame carries its own focus tilt: across one frame at the field edge
 * the three patch columns' best focus spans 0.017685 mm — **0.409 of a depth of
 * focus** at 430 nm — and a patched render has it because each patch is imaged
 * through its own traced pupil. The rest is out of reach by construction. One
 * frame is 0.103 mm of specimen wide against a field 2.2 mm across, so the
 * 0.250229 mm above is a **mosaic** quantity and no patch count within a single
 * frame gets to it (§ 6be.7).
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
  /**
   * Patches across each wavelength's frame, per axis — **the third axis**.
   *
   * 1 (the default) is the pre-§ 6be render and reduces to it *bitwise*
   * (§ 6be.1), so a caller who does not ask for a field pays nothing and every
   * § 6bb number stands untouched. Above 1 the cost is `N_λ × patches² × N_z`
   * convolutions, which is the price § 6bb named when it deferred this.
   *
   * What the patches buy is the **phase**, not the brightness: § 6be.6 measures
   * the field profile of what the pupil *transmits* and finds it achromatic to
   * 5.3e-7, so every chromatic thing about a patched frame is in the wavefront —
   * § 6bd.6's amplitude/phase split, one axis up.
   *
   * Part of that phase is **focus**. Across one frame at the edge of the
   * catalogued field the three patch columns' own best focus spans 0.017685 mm,
   * 0.409 of a depth of focus at 430 nm (§ 6be.7), and a patched render carries
   * that tilt because each patch is imaged through its own traced pupil. What no
   * patch count reaches is the rest: one frame is 0.103 mm of specimen wide
   * against a field 2.2 mm across, so § 6be.3's 0.250229 mm is a **mosaic**
   * quantity.
   */
  readonly patches?: number;
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
  /**
   * Called once per slice of the wavelength being rendered — and, at
   * `patches > 1`, once per slice **of each patch**. See
   * `FieldVolumeOptions.onSlice`.
   */
  readonly onSlice?: (done: number, total: number, nm: number) => void;
  /** Called once per patch of the wavelength being rendered. */
  readonly onPatch?: (done: number, total: number, nm: number) => void;
}

/** One wavelength's volume, formed — everything a stack needs from it. */
export interface FormedVolumePlane {
  readonly frame: ObjectFieldFrame;
  /** This wavelength's own rate, and the identity that refuses another's frame. */
  readonly rescale: DepthRescale;
  /** The rasterized specimen, referred to `focusMm`. */
  readonly volume: RasterizedEmitterVolume;
  /** The imaged stack, before the common ruler. */
  readonly image: FieldVolumeImage;
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
  /** Patches per axis this channel was formed with — `options.patches`. */
  readonly patches: number;
  /**
   * What each patch's pupil transmitted, in this channel, row-major.
   *
   * The channel's own field profile of the throughput, and § 6be.6 reads the
   * null off it: normalized to its own frame's centre, this profile is the
   * **same at every wavelength** to 5.3e-7 inside the catalogued field.
   *
   * **Patch `p` is not the same field point in two channels.** A frame's
   * `halfExtentMm` is ∝ λ (§ 6h.2), so the red frame is wider than the blue one
   * about the same centre, and patch `p` of each sits at a different image
   * radius. Comparing these arrays elementwise across channels compares two
   * field positions and calls the difference a colour (§ 6be.8). Normalize each
   * to its own centre first, which is what makes the null above a statement
   * about the optics rather than about the two frames' sizes.
   */
  readonly patchThroughput: readonly number[];
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
  const image = renderFieldVolume(
    volume,
    fieldDefocusing((u, v) => fieldPupilAt(system, frame, u, v, options)),
    {
      patches: options.patches ?? 1,
      pupilSamples: options.pupilSamples,
      numericalAperture,
      wavelengthNm: sample.nm,
      refractiveIndex,
      scale: frame.scale,
      ...(options.onSlice === undefined
        ? {}
        : { onSlice: (done: number, total: number) => options.onSlice!(done, total, sample.nm) }),
      ...(options.onPatch === undefined
        ? {}
        : { onPatch: (done: number, total: number) => options.onPatch!(done, total, sample.nm) }),
    },
  );
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
        patches: f.image.patches,
        patchThroughput: f.image.patchThroughput,
      };
    }),
    maxGridPhaseStepWaves,
    focusMm: options.focusMm ?? 0,
  };
}
