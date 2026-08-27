import type { AimOptions } from "../pupil/aiming";
import { pupils } from "../pupil/pupils";
import type { OpticalSystem } from "../trace/system";
import type { EmitterField } from "./fluorescence";
import { imagePointAt, type ObjectFieldFrame } from "./object-field";
import { requireRadialMapMatches, type RadialMap } from "./radial-map";
import type { EmitterSlice, EmitterVolume } from "./volume";

/**
 * The volumetric emitter density — § 6as's named deferral, closed, and the
 * prediction it was deferred on is the thing this step corrects.
 *
 * § 6as warps a **plane**: an emitter is a density, so a pixel's value is the
 * density times the object area that pixel covers, `det J = (h/r)·(dh/dr)`. Its
 * own "still open" list then named the volume and said what the answer would
 * look like — "the third dimension of the same Jacobian, which is not
 * `(h/r)·(dh/dr)` and is **not a scalar**".
 *
 * It is a scalar. It is one scalar per depth, it multiplies § 6as's element
 * whole, and it is the only thing depth does to the map:
 *
 *     h_z(r) = h₀(r)·(1 + z·k)          det J_z = (h/r)·(dh/dr)·(1 + z·k)²
 *
 * where **k is one over the distance from the object plane to the entrance
 * pupil**. Everything else in this module follows from those two lines.
 *
 * ## Why it factorizes: a chief ray from a depth is the SAME LINE
 *
 * A chief ray is the ray from the object point to the centre of the entrance
 * pupil (`aimRay` constructs exactly that for a finite conjugate). Put the
 * object plane at ζ = 0 and the entrance-pupil centre at ζ = P. The line from an
 * object point (h, z) to (0, P) crosses the object plane at height
 *
 *     h · P/(P − z)   —   written here as h/(1 + z·k), k = 1/P
 *
 * so the ray from *depth z at height h* and the ray from *the nominal plane at
 * that rescaled height* are not merely similar: they are one line, and a trace
 * cannot tell them apart. § 6az.1 pins the landing point to **4 ulp** across
 * three heights and four depths — and to the last bit at zero depth. The residual
 * is not the trace: `h/(1 + z·k)` and `h·P/(P − z)` are one number in exact
 * arithmetic and one ulp apart in f64, so what is left is the rounding of the
 * height that names the line.
 *
 * Two consequences, and they are why this module adds no tracing at all:
 *
 *  - **One table serves the whole volume.** `RadialMap` tabulates the flat map;
 *    every depth reads that same table and multiplies. There is no per-depth
 *    tabulation to build, to cache, or to get wrong — which is the opposite of
 *    what a deferral naming a third Jacobian dimension would have led one to
 *    build, and it is why this step ships one multiply rather than a new solver.
 *  - **The stretch is ISOTROPIC.** Both factors of § 6as's element carry the
 *    same `(1 + z·k)`, so the tangential and radial factors move together and
 *    their departures still stand in § 6as.2's ratio 3. Depth introduces no
 *    anisotropy whatever; distortion remains the only source of it (§ 6az.5).
 *
 * ## The rate, never the distance — and the design wavelength is why
 *
 * `P` is not a quantity that can be stored. On the default DIN objective the
 * entrance pupil is at **exactly infinity at the design wavelength**, because
 * § 6v's `"backFocal"` default puts the diaphragm at `systemProperties(glass,
 * designWavelengthNm).bfd` — the back focal distance read at that one
 * wavelength — and `h·P/(P − z)` is then `∞/∞`, which
 * is **NaN**, on the primary wavelength of the default system. A module that
 * held the distance would be broken on the one wavelength every caller gets
 * unasked.
 *
 * `k = 1/P` is the quantity that behaves: it is a finite `−0` at the crossing,
 * `1 + z·k` is then exactly 1 and the rescale is exactly the identity, with no
 * branch anywhere. So this module stores the rate and every closed form is
 * written in it. § 6az.3 pins the NaN against the finite value on the same
 * system at the same wavelength, because it is the trap the deferral walks into.
 *
 * ## Depth is a CHROMATIC quantity, and it is telecentric TWICE
 *
 * The entrance pupil is the stop imaged through the glass in front of it, so
 * where it lands is dispersive — and the objective is an achromatic doublet, so
 * its back focal distance **turns around inside the band**. It therefore
 * coincides with the stop plane at *two* wavelengths, not one, and the rate on
 * the default 4×/0.10 has two zeros:
 *
 *     430 nm      +6.77853e−5 /mm
 *     486.1327    +1.35407e−5 /mm
 *     530.567099  ±0                (telecentric — the achromat's own turn)
 *     546.074     −1.43906e−6 /mm
 *     557.367     −1.72471e−6 /mm   (the extremum between the two)
 *     587.5618    ±0                (telecentric — § 6v put the stop here)
 *     656.2725    +1.29652e−5 /mm
 *     680 nm      +1.93607e−5 /mm
 *
 * — 39× across the visible band, **negative between the two crossings and
 * positive outside them**. That is § 6ap's finding on the object side and in the
 * depth direction: an achromatic element turns a distance around inside the
 * band, so a condition that would hold once holds twice and the sense reverses
 * between. One of the two crossings is engineered — the stop was placed at the
 * back focal distance measured there — and the other is free, and neither is a
 * wavelength this module chose.
 *
 * It is the reason `DepthRescale` carries a wavelength and the rasterizer
 * refuses a frame that disagrees: a rate taken at 546 nm and used on a 656 nm
 * frame does not merely mis-scale the stack, it zooms it the **wrong way** and
 * by 9×, and nothing downstream can see that. § 6r renders one frame per
 * wavelength, so this is the § 6n.2/§ 6p bug class with a sign on it.
 *
 * ## There is no axial Jacobian, and the reason is structural
 *
 * A change of variables needs two coordinate systems. The lateral one has them —
 * the grid is an **image**-plane grid and the specimen is in object millimetres,
 * so `dA_object/dA_image` is a real ratio. The axial one does not:
 * `EmitterSlice.zMm` is documented in object-space millimetres, so the stack's
 * third coordinate is the specimen's own, and there is nothing to transform it
 * from. A slab of thickness Δz holds `ρ·dA_object·Δz` and that is the whole
 * weight. § 6az.8 measures it rather than arguing it — a uniform slab's flux
 * against `ρ·π·R²·T` in closed form.
 *
 * § 6j's longitudinal magnification `m²·n/n′` would be the third factor if a
 * caller wanted **image**-space voxels, which is what a deconvolved volume is.
 * Nothing here does, and the 3×3 determinant is deliberately not built.
 *
 * ## Refocusing re-rasterizes, and that is not an economy that was skipped
 *
 * The rescale is measured from the plane the objective is focused on, because
 * that is the plane P was measured to. `renderVolume` defocuses on
 * `slice.zMm − focusMm`, and the perspective must come off that **same signed
 * offset**: moving the stage moves every feature relative to the entrance pupil,
 * so a focus series is a series of different rescales and not one volume viewed
 * twice.
 *
 * So this rasterizer takes the focus, samples the density in the **specimen's**
 * coordinates, and emits slices whose `zMm` is the offset from the focal plane —
 * which is to say the emitted volume is already referred to focus and
 * `renderVolume` takes it at its default `focusMm` of 0. The focus it was built
 * at is carried on the result rather than left to a caller's memory, on § 6l's
 * argument about a coupling with no readout to catch it.
 *
 * ## What is deliberately not here
 *
 * **No spectrum**, exactly as § 6as has none: a specimen whose emission colour
 * varies with position is the two-stain preparation, and it is its own step.
 * **No deconvolution and no confocal** — § 6k names both by the missing cone.
 * **No axial sampling verdict**: `renderVolume` will image a stack whose slices
 * step by more than the kernel can resolve, and § 6k's list still owns that.
 * **Real ray aiming is paraxial in the rate.** With `rayAiming: "real"` the
 * chief ray is solved onto the stop rather than aimed at the paraxial pupil, so
 * the same-line argument still holds exactly — a ray from depth still crosses
 * the object plane somewhere, and the flat map still images that height — but
 * the crossing is no longer `h/(1 + z·k)` to all orders. The rate is a paraxial
 * construction and is documented as one.
 */

/**
 * Emitted power per unit **volume** of the specimen, in object millimetres.
 *
 * § 6as's `EmitterDensity` with a third argument and one dimension more in its
 * units: per mm³ where that is per mm², so that a slab of thickness Δz carries
 * `ρ·Δz` of § 6as's quantity and the two modules agree in the thin limit
 * (§ 6az.2 pins that they agree *bitwise*).
 *
 * `zMm` is the **specimen's own depth**, not the offset from focus — a stain
 * does not move when the stage does. Positive away from the objective, which is
 * `EmitterSlice.zMm`'s convention.
 *
 * A callback rather than an array, for § 6n's reason: the warp stays in the
 * argument and no resampling kernel comes between the authored specimen and the
 * image. Dimensionless in `PointEmitter.flux`'s sense — § 3a still owns the
 * photometric zero point, so every number here is a ratio.
 */
export type VolumeEmitterDensity = (xMm: number, yMm: number, zMm: number) => number;

/**
 * How the lateral map rescales with depth — one rate, and its identity.
 *
 * Built from the entrance pupil, so it is a function of (system, wavelength) and
 * of nothing else, which is exactly `RadialMap`'s situation and gets the same
 * treatment: it carries the wavelength it was built at and the rasterizer
 * refuses a frame that disagrees. See the header on why the sign makes that
 * refusal load-bearing rather than tidy.
 */
export interface DepthRescale {
  /**
   * `k = 1/P`, per millimetre of depth — **the rate, never the distance**.
   *
   * Exactly `±0` for an object-space telecentric system, where the entrance
   * pupil is at infinity and the map does not move with depth at all. The
   * header says why storing `P` instead is a NaN on the default system.
   */
  readonly ratePerMm: number;
  readonly wavelengthNm: number;
  /** Where the entrance pupil landed (world mm) — `±Infinity` when telecentric. */
  readonly entrancePupilZMm: number;
  /** The nominal object plane's world z, which is what `ratePerMm` is measured from. */
  readonly objectPlaneZMm: number;
  /**
   * `1 + z·k` — the factor the object height at a given image radius carries at
   * depth `z`, and the square of which is the area element's.
   *
   * Exactly 1 at zero depth and exactly 1 at every depth when telecentric, in
   * both cases by arithmetic rather than by a branch.
   */
  stretchAt(depthMm: number): number;
}

/**
 * Read the depth rescale off a system's entrance pupil.
 *
 * Refuses an infinite conjugate — an object at infinity has no depth to have a
 * rescale for — and refuses an entrance pupil that lands *in* the object plane,
 * where every object point's chief ray is the same line and the map is not a map.
 */
export function depthRescale(system: OpticalSystem, wavelengthNm: number): DepthRescale {
  if (system.conjugate.kind !== "finite") {
    throw new Error(
      "depthRescale: an infinite conjugate has no object plane, so a specimen has no depth " +
        "to be rescaled by — this is the microscope's quantity",
    );
  }
  const objectPlaneZMm = -system.conjugate.distance;
  const entrancePupilZMm = pupils(system, wavelengthNm).entrance.z;
  const p = entrancePupilZMm - objectPlaneZMm;
  if (p === 0) {
    throw new Error(
      `depthRescale: the entrance pupil lies in the object plane at z = ${objectPlaneZMm} mm — ` +
        "every object point's chief ray is then the same line and there is no map to rescale",
    );
  }
  // 1/±Infinity is ±0, which is what makes the telecentric case exact rather
  // than a special case; see the header.
  const ratePerMm = 1 / p;
  return {
    ratePerMm,
    wavelengthNm,
    entrancePupilZMm,
    objectPlaneZMm,
    stretchAt: (depthMm) => 1 + depthMm * ratePerMm,
  };
}

/**
 * Refuse a rescale that does not belong to the frame it is about to warp.
 *
 * `requireRadialMapMatches`' argument, with a sign on it: the rate changes sign
 * inside the band, so the wrong wavelength's rate zooms the stack backwards.
 */
export function requireDepthRescaleMatches(
  rescale: DepthRescale,
  frame: ObjectFieldFrame,
  who: string,
): void {
  if (rescale.wavelengthNm !== frame.wavelengthNm) {
    throw new Error(
      `${who}: the depth rescale was read at ${rescale.wavelengthNm} nm and the frame is at ` +
        `${frame.wavelengthNm} nm — the entrance pupil crosses infinity inside the band, so the ` +
        `rate CHANGES SIGN and the wrong one zooms the stack the wrong way with nothing ` +
        `downstream able to see it`,
    );
  }
}

/** Slice centres and the slab each one stands for, in object millimetres. */
export interface EmitterSlabs {
  /** Slice centres in the **specimen's** depth coordinate. */
  readonly depthsMm: readonly number[];
  /** Object mm of specimen each slice stands for — the Riemann weight. */
  readonly thicknessMm: readonly number[];
}

/**
 * `count` slabs of equal thickness spanning `[fromMm, toMm]`, sampled at their
 * midpoints.
 *
 * The midpoint rule, which is why § 6az.9 can pin a convergence **order** from
 * outside the engine rather than a rate the engine chose. Uniform, so a stack
 * built this way is also legal input to `axialSpectrum`, which enforces uniform
 * spacing where `renderVolume` does not.
 */
export function uniformSlabs(fromMm: number, toMm: number, count: number): EmitterSlabs {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`uniformSlabs: count must be a positive integer, got ${count}`);
  }
  if (!Number.isFinite(fromMm) || !Number.isFinite(toMm)) {
    throw new Error(`uniformSlabs: the span must be finite, got [${fromMm}, ${toMm}]`);
  }
  const step = (toMm - fromMm) / count;
  const depthsMm: number[] = [];
  const thicknessMm: number[] = [];
  for (let i = 0; i < count; i++) {
    depthsMm.push(fromMm + (i + 0.5) * step);
    thicknessMm.push(step);
  }
  return { depthsMm, thicknessMm };
}

export interface RasterizeEmitterVolumeOptions {
  /**
   * Required, on § 6as's argument — the Jacobian is a derivative and this is
   * where it comes from. One table serves every depth; see the header.
   */
  readonly radialMap: RadialMap;
  /** Required for the same reason and with the same refusal. */
  readonly rescale: DepthRescale;
  readonly slabs: EmitterSlabs;
  /**
   * The **specimen depth the objective is focused on** (object mm). Defaults to
   * 0, the nominal object plane.
   *
   * The rescale and `renderVolume`'s defocus both come off `depth − focusMm`,
   * and the emitted slices are already referred to it — so `renderVolume` takes
   * this volume at its own default focus. See the header.
   */
  readonly focusMm?: number;
  readonly aim?: AimOptions;
  /** Called once per slice rasterized, for progress. */
  readonly onSlice?: (done: number, total: number) => void;
}

/**
 * An `EmitterVolume`, plus what it took to build it.
 *
 * Structurally an `EmitterVolume`, so it goes straight into `renderVolume`; the
 * extra fields are readouts, and `focusMm` is there because a coupling a caller
 * has to remember is the defect § 6l refused to ship.
 */
export interface RasterizedEmitterVolume extends EmitterVolume {
  /** The focus the slices are referred to — they are offsets from this. */
  readonly focusMm: number;
  /** Σ over slices of the flux authored, before any optic touches it. */
  readonly emittedFlux: number;
  /**
   * `max |1 + z·k − 1|` over the stack — how far the perspective moved the map.
   *
   * Exactly 0 on a telecentric system at its telecentric wavelength, which is
   * the one number that says this whole module was a no-op for that render.
   */
  readonly maxStretchDeparture: number;
}

/**
 * Rasterize a volumetric emitter density into the stack `renderVolume` consumes.
 *
 * § 6as's rasterizer with the two lines of the header applied: the object height
 * a pixel sees is stretched by `1 + z·k`, the area element by its square, and
 * the slab thickness turns a density per volume into the flux per pixel that
 * `EmitterField` holds. At zero depth on a telecentric system it reduces to
 * `rasterizeEmitterDensity` bitwise (§ 6az.2).
 *
 * The pixel convention is § 6n.1's and § 6as.6's, unchanged.
 */
export function rasterizeEmitterVolume(
  frame: ObjectFieldFrame,
  density: VolumeEmitterDensity,
  options: RasterizeEmitterVolumeOptions,
): RasterizedEmitterVolume {
  const { size } = frame;
  const { radialMap, rescale, slabs } = options;
  requireRadialMapMatches(radialMap, frame, options.aim, "rasterizeEmitterVolume");
  requireDepthRescaleMatches(rescale, frame, "rasterizeEmitterVolume");
  if (slabs.depthsMm.length === 0) {
    throw new Error("rasterizeEmitterVolume: the specimen has no slices");
  }
  if (slabs.depthsMm.length !== slabs.thicknessMm.length) {
    throw new Error(
      `rasterizeEmitterVolume: ${slabs.depthsMm.length} depths against ` +
        `${slabs.thicknessMm.length} thicknesses — a density per volume needs the slab each ` +
        `slice stands for, and a stack that samples z more finely must not brighten`,
    );
  }
  const focusMm = options.focusMm ?? 0;
  const pixelAreaMm2 = frame.pixelScaleMm * frame.pixelScaleMm;

  const slices: EmitterSlice[] = [];
  let emittedFlux = 0;
  let maxStretchDeparture = 0;

  for (let s = 0; s < slabs.depthsMm.length; s++) {
    const depthMm = slabs.depthsMm[s]!;
    const thickness = slabs.thicknessMm[s]!;
    const offsetMm = depthMm - focusMm;
    const stretch = rescale.stretchAt(offsetMm);
    if (!(stretch > 0)) {
      throw new Error(
        `rasterizeEmitterVolume: slice ${s} at depth ${depthMm} mm sits at or beyond the ` +
          `entrance pupil (stretch ${stretch}) — the chief ray from there does not reach the ` +
          `optics, and no rescale of the map is defined`,
      );
    }
    maxStretchDeparture = Math.max(maxStretchDeparture, Math.abs(stretch - 1));
    const areaFactor = stretch * stretch;

    const values = new Float64Array(size * size);
    for (let iy = 0; iy < size; iy++) {
      for (let ix = 0; ix < size; ix++) {
        const { x, y } = imagePointAt(frame, ix / size, iy / size);
        const imageRadius = Math.hypot(x, y);
        const azimuthRad = imageRadius > 0 ? Math.atan2(y, x) : 0;
        const heightMm = radialMap.heightAt(imageRadius) * stretch;
        const rho = density(
          heightMm * Math.cos(azimuthRad),
          heightMm * Math.sin(azimuthRad),
          depthMm,
        );
        if (rho === 0) continue;
        const flux =
          rho *
          radialMap.objectAreaPerImageArea(imageRadius) *
          areaFactor *
          pixelAreaMm2 *
          thickness;
        values[iy * size + ix] = flux;
        emittedFlux += flux;
      }
    }
    // The offset, not the specimen depth: the volume is referred to focus so
    // that `renderVolume` needs no second copy of the same number.
    slices.push({ zMm: offsetMm, field: { size, values } });
    options.onSlice?.(s + 1, slabs.depthsMm.length);
  }

  return { size, slices, focusMm, emittedFlux, maxStretchDeparture };
}

/**
 * A ball of uniform emitter density — the simplest volumetric emitter there is,
 * and the one with a hard edge in **three** directions.
 *
 * Total flux `density · (4/3)·π·R³` in closed form, independently of every optic
 * the light later passes. Its convergence need not be § 6as.4's: that rung
 * measures a disc's lattice discrepancy, and a ball adds a midpoint rule over
 * depth whose integrand — the slice area `π(R² − z²)` — is a polynomial, so the
 * two errors have different orders — though only the axial one separates, and
 * § 6az.9 declines to quote an exponent for the other because a ball's residual
 * carries both.
 */
export function sphereEmitter(options: {
  readonly radiusMm: number;
  readonly density: number;
  readonly centreMm?: { readonly x: number; readonly y: number; readonly z: number };
}): VolumeEmitterDensity {
  const { radiusMm, density } = options;
  if (!(radiusMm > 0)) throw new Error(`sphereEmitter: radiusMm must be positive, got ${radiusMm}`);
  if (!(density >= 0)) {
    throw new Error(`sphereEmitter: density must be non-negative, got ${density}`);
  }
  const centre = options.centreMm ?? { x: 0, y: 0, z: 0 };
  const r2 = radiusMm * radiusMm;
  return (xMm, yMm, zMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    const dz = zMm - centre.z;
    return dx * dx + dy * dy + dz * dz <= r2 ? density : 0;
  };
}

/**
 * A label uniform in z between two depths — the haze, as a specimen.
 *
 * `hazeKernel` is exact for exactly this specimen (§ 6k.6): a z-uniform emitter
 * puts the same field on every plane, so the convolution factors and the stack
 * collapses to one kernel. It does **not** here, and the difference is this
 * module's whole subject: the rescale makes each plane's field a slightly
 * different sampling of the same specimen, so a z-uniform label is z-uniform in
 * the *specimen* and not on the *grid* unless the system is telecentric.
 *
 * `lateral` is § 6as's own `EmitterDensity`, so a stain and a slab can be
 * authored from one function.
 */
export function slabEmitter(options: {
  readonly lateral: (xMm: number, yMm: number) => number;
  readonly fromMm: number;
  readonly toMm: number;
}): VolumeEmitterDensity {
  const { lateral, fromMm, toMm } = options;
  if (!(toMm > fromMm)) {
    throw new Error(`slabEmitter: the slab must have positive thickness, got [${fromMm}, ${toMm}]`);
  }
  return (xMm, yMm, zMm) => (zMm >= fromMm && zMm <= toMm ? lateral(xMm, yMm) : 0);
}

/**
 * A Gaussian ball, `peak · exp(−2(r²/w² + z²/w_z²))` — the smooth counterpart.
 *
 * § 6as.4's discipline in three dimensions: with no edge anywhere, the residual
 * is frame and span truncation and nothing else, so the convergence a
 * *discontinuity* costs can be separated from the convergence point-sampling
 * costs on its own. Its integral is `peak · (π/2)^{3/2} · w²·w_z`, in the
 * `1/e²` convention `gaussianEmitter` already uses — that module's `π·w²/2` is
 * the same constant one dimension down, since `(π/2)^{1}·w² = π·w²/2`.
 */
export function gaussianBallEmitter(options: {
  readonly waistMm: number;
  readonly axialWaistMm: number;
  readonly peak: number;
  readonly centreMm?: { readonly x: number; readonly y: number; readonly z: number };
}): VolumeEmitterDensity {
  const { waistMm, axialWaistMm, peak } = options;
  if (!(waistMm > 0)) {
    throw new Error(`gaussianBallEmitter: waistMm must be positive, got ${waistMm}`);
  }
  if (!(axialWaistMm > 0)) {
    throw new Error(`gaussianBallEmitter: axialWaistMm must be positive, got ${axialWaistMm}`);
  }
  const centre = options.centreMm ?? { x: 0, y: 0, z: 0 };
  const w2 = waistMm * waistMm;
  const wz2 = axialWaistMm * axialWaistMm;
  return (xMm, yMm, zMm) => {
    const dx = xMm - centre.x;
    const dy = yMm - centre.y;
    const dz = zMm - centre.z;
    return peak * Math.exp(-2 * ((dx * dx + dy * dy) / w2 + (dz * dz) / wz2));
  };
}

/**
 * The closed-form total flux of `gaussianBallEmitter` — `peak·(π/2)^{3/2}·w²·w_z`.
 *
 * Written out because § 6az.10 weighs the rasterizer against it and a factor
 * derived at the call site would be a fit. Each axis contributes its own
 * `∫exp(−2t²/w²)dt = w·√(π/2)`, which is where the 3/2 power comes from.
 */
export function gaussianBallFlux(peak: number, waistMm: number, axialWaistMm: number): number {
  return peak * Math.pow(Math.PI / 2, 1.5) * waistMm * waistMm * axialWaistMm;
}
