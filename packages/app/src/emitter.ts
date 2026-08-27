import {
  discEmitter,
  gaussianEmitter,
  imagePointAt,
  objectHeightForImageRadius,
  radialMapCovering,
  rasterizeEmitterDensity,
  renderFluorescence,
  tracedFieldPupils,
  type EmitterDensity,
  type ObjectFieldFrame,
  type RadialMap,
} from "@telemicroscope/core/imaging";
import { abbeResolutionMm, objectNumericalAperture } from "@telemicroscope/core/pupil";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import type { BuildSpec } from "./builder";
import { buildFrame, LAMBDA_NM } from "./microscope";
import { AppRefusal, refused, type Refused } from "./refusal";

/**
 * A fluorescent source with a SIZE — APP.md's Part Q, as pure functions.
 *
 * `microscope.ts`'s commitment kept, as every imaging adapter on this branch
 * keeps it: numbers in, numbers out, no DOM and no React, so the expensive half
 * drops into a worker unchanged (and does — `emitter.worker.ts`).
 *
 * ## What is new here, against the panel next door
 *
 * A4's beads are **points**. Each one is placed through its own traced chief
 * ray, so the objective's distortion is carried in *where it lands* and nothing
 * has to be transformed: a point has no area to redistribute. § 6as's whole
 * subject is the other case. An extended emitter is a **density** — power per
 * unit area of specimen — and warping a density without the area element moves
 * flux between pixels.
 *
 * The area element is one scalar, because the systems are axially symmetric:
 *
 *     dA_object / dA_image = (h/r) · (dh/dr)
 *
 * — `RadialMap.objectAreaPerImageArea`, a tangential factor times a radial one.
 * On the axis both go to the same limit, so it is `(dh/dr)²` exactly, which is
 * **1/M² on a system that images at M** — the objective's nameplate, a number
 * from outside this engine, and the first thing this surface prints.
 *
 * ## The two errors this panel exists to put side by side
 *
 * A density's total flux is a real witness (which is worth saying, given how
 * often the ladder records that it is not), and the closed forms are exact:
 * `density·π·r²` for a disc, `peak·π·w²/2` for a Gaussian. So the same picture
 * carries two departures at once, and driving the controls separates them
 * completely — each one moves on the axis the other is deaf to.
 *
 *  - **The sampling residual is about the grid and not about the lens.** § 6n's
 *    convention keeps the warp in the *argument* — the density is point-sampled
 *    at each pixel's own object point and nothing is resampled — so a hard edge
 *    makes the total a count of lattice points inside a circle. Measured on a
 *    disc of a tenth of the half frame it is **−1.1110e−2 at grid 256 on all
 *    five objectives this surface reaches, agreeing to five figures**, and it
 *    follows the disc's radius *in pixels* rather than anything optical: 12.8 px
 *    gives the same number on the 4×/0.10 and the 10×/0.10, at two crops. It
 *    also does not fall monotonically — +2.490e−3, −1.1110e−2, +1.032e−3 over
 *    128, 256, 512, sign included — which is § 6as.4's open exponent (the Gauss
 *    circle problem) arriving as something a reader can watch.
 *  - **The Jacobian's own worth is about the lens and not about the grid.**
 *    `jacobianWorth` below is § 6as.5's negative control run live: the same
 *    sampling with the area element replaced by the frame's uniform object cell.
 *    On a smooth emitter it is **flat to nine significant figures over ×4 of
 *    grid**, and it spreads **179×** across the same five objectives at the same
 *    configuration (4.35e−9 on the DIN 4×/0.20 to 7.80e−7 on the infinity 10×).
 *
 * That orthogonality is the panel's argument for why the module had to exist,
 * and it is the reader's own control rather than a claim: one number that every
 * lens shares and the grid decides, one that no grid moves and every lens
 * changes.
 *
 * ## The frame's corner is what decides whether this surface runs at all
 *
 * `rasterizeEmitterDensity` asks the map for `hypot(x, y)` at every pixel, so
 * the table has to cover the frame's **diagonal** — `radialMapCovering` takes it
 * for the caller. Against that stands the largest image radius the objective's
 * chief ray reaches at all, which is a property of the design.
 *
 * Both numbers move with magnification and they move opposite ways. § 6h's
 * closed form fixes the object half-extent at `pupilSamples·λ/(4·NA)`, so the
 * **image** half-extent is that times |M| and the corner grows in proportion;
 * the field a high-power objective reaches falls. `fieldHeadroom` is the ratio,
 * it is measured rather than quoted, and it is printed whether it passes or not
 * — a reader who sees only the refusal cannot see how close it was.
 */

/** Which closed form the emitter is weighed against. */
export type EmitterShape = "disc" | "gaussian";

export interface EmitterRequest {
  readonly spec: BuildSpec;
  /** Frequency bins across the pupil diameter — also the crop, in cells (§ 6h). */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Buys sampling, NOT field. */
  readonly size: number;
  /** Patches across the field, per axis. > 1 lets the pupil vary with position. */
  readonly patches: number;
  readonly shape: EmitterShape;
  /**
   * The disc's radius or the Gaussian's 1/e² waist, on the **specimen**, in µm.
   *
   * µm because that is the unit this branch quotes a specimen in — A1's crop and
   * A4's object pixel are both µm — and because a millimetre beside a frame
   * 93 µm across would be a number nobody can place.
   */
  readonly scaleUm: number;
  /** The emitter centre's displacement from the axis, on the specimen, in µm. */
  readonly offsetUm: number;
}

/**
 * Nodes in the tabulated inverse chief-ray map (§ 6s).
 *
 * `section.ts`'s number, for `section.ts`'s reason: 33 inversions against a
 * 256² raster's 65 536 queries is not a budget worth economising on, and § 6s.2
 * measures 32 nodes well past the rounding floor on this branch's frames.
 */
const RADIAL_MAP_NODES = 32;

export interface EmitterReadout {
  readonly size: number;
  /** Flux per pixel on the specimen grid, before any optics — the authored object. */
  readonly object: Float64Array;
  /** The same emitter through the objective. */
  readonly intensity: Float64Array;
  readonly objectPeak: number;
  readonly imagePeak: number;

  /** The crop, across the whole frame, on the specimen (µm) — A1's number. */
  readonly objectSpanUm: number;
  readonly objectPixelNm: number;
  readonly imagePixelUm: number;
  readonly tracedNA: number;
  readonly abbeResolutionNm: number;
  /** Signed, negative for a real inverted image — the frame's own traced M. */
  readonly magnification: number;

  /** The emitter's own radius or waist, in object pixels. */
  readonly emitterPixels: number;

  /**
   * How far the emitter reaches from the axis (µm) against the frame's own half
   * width — the guard that stops a truncation being read as a sampling failure.
   *
   * Found by walking the offset control rather than by reasoning: a disc of
   * 23.4 µm radius pushed 46.8 µm off the axis is entirely inside the 4×/0.10's
   * frame and **half outside** the 4×/0.20's, because § 6h fixes the crop at
   * `pupilSamples·λ/(4·NA)` and the higher aperture sees less specimen. The flux
   * residual there reads −0.52, which is not the rasterizer failing — it is the
   * frame holding half the emitter — and a panel printing that number beside a
   * paragraph about point sampling would be teaching the wrong lesson.
   *
   * For a disc `reachUm` is its far edge, exactly. For a Gaussian it is the 1/e²
   * radius, so a fraction always lies outside whatever the number says: that is
   * the truncation § 6as.4 measures as `1 − erf(√2·a/w)²`, and it is why the
   * Gaussian's residual is small but never zero until the frame is several
   * waists wide.
   */
  readonly reachUm: number;
  readonly frameHalfUm: number;

  /**
   * Total flux the rasterizer put on the grid, and the closed form it is owed.
   *
   * A **converging** witness rather than an exact one, and the panel says so:
   * `discEmitter` keeps a hard edge (§ 6as.4's reason — a soft edge would make
   * the rung pass and delete what it measures), so a point-sampled disc counts
   * lattice points inside a circle and its residual is the Gauss circle
   * problem's, whose exponent is open. A Gaussian has no edge, so what is left
   * of its residual is the frame **truncation**, `1 − erf(√2·a/w)²` in closed
   * form, which is f64 zero once the frame is a few waists wide.
   */
  readonly fluxRasterized: number;
  readonly fluxClosedForm: number;
  /** Signed: `(rasterized − closed) / closed`. */
  readonly fluxResidual: number;

  /**
   * § 6as.5's negative control, live: the same grid with the area element
   * replaced by the frame's uniform object cell, over the exact sum.
   *
   * Read off the engine's own output rather than rasterized a second time —
   * each pixel divided by its own det J and multiplied by the uniform cell — so
   * the two totals differ by the Jacobian and by nothing else at all. A second
   * raster would also differ by whatever the second density evaluation did.
   *
   * **This is the number that does not converge.** It is the distortion, not a
   * discretization, and it is flat over ×4 of grid.
   */
  readonly jacobianWorth: number;

  /** `objectAreaPerImageArea` on the axis, and how far it sits from 1/M². */
  readonly detJAxis: number;
  readonly detJAxisAgainstM2: number;
  /** `detJ(corner)/detJ(axis) − 1` — how far the area element moves across the frame. */
  readonly detJCornerDeparture: number;

  /**
   * |Σ image − the flux the weights allow| / that flux, through
   * `renderFluorescence` unchanged.
   *
   * § 6as.7's point, and the branch's architectural one: the incoherent render,
   * the emission kernel and the mosaic were built before the extended emitter
   * and **none of them moves for one**. The kernel sums to 1 and circular
   * convolution is exact, so this is f64 rounding rather than a physical budget.
   *
   * Quoted against `weightedEmittedFlux` rather than against Σ object since
   * § 6bc. It read against Σ object while the render normalized the pupil's own
   * transmission away, and a panel that reports light conserved through an
   * objective passing a fifth of it is reporting the normalizer. What the
   * objective actually delivers is `throughput`, next to it.
   */
  readonly lightResidual: number;
  /**
   * Σ image / Σ object — the share of the specimen's light this objective put
   * on the sensor, which used to be 1 by construction (§ 6bc.5).
   */
  readonly throughput: number;
  /**
   * `max/min − 1` over the patches' own weights: how much the objective's
   * transmission varies across THIS frame. Zero at `patches` = 1, where one
   * pupil forms the whole picture and there is nothing to vary.
   */
  readonly throughputSpan: number;
  /**
   * `1 − imagePeak/objectPeak` — the emitter blurred, and the only readout here
   * that is about the optics rather than about the rasterizer.
   *
   * Referred to `throughput` since § 6bc, so it keeps meaning the blur. The
   * image now carries the light the pupils passed, and a peak ratio taken
   * against it raw reports a 96% "drop" for an objective that is only dim.
   */
  readonly peakDrop: number;

  /** The frame's own diagonal (mm) — what the table had to cover. */
  readonly cornerRadiusMm: number;
  /** The largest image radius a chief ray reaches, measured (mm). */
  readonly fieldLimitMm: number;
  /** `fieldLimitMm / cornerRadiusMm`. Below 1 and nothing can be rasterized. */
  readonly fieldHeadroom: number;

  readonly maxGridPhaseStepWaves: number;
  readonly elapsedMs: number;
}

export type EmitterResult =
  | { readonly ok: true; readonly readout: EmitterReadout }
  | (Refused & {
      /**
       * The two numbers the refusal is about, when the frame was built and it
       * was the **map** that refused. `null` when the build itself refused, and
       * a headroom printed there would be a number about a system that does not
       * exist.
       */
      readonly headroom: {
        readonly cornerRadiusMm: number;
        readonly fieldLimitMm: number;
        readonly fieldHeadroom: number;
      } | null;
    });

export interface EmitterJob {
  readonly seq: number;
  readonly request: EmitterRequest;
}

export interface EmitterDone {
  readonly seq: number;
  readonly result: EmitterResult;
}

/**
 * The largest image radius a chief ray reaches, by bisection.
 *
 * Measured rather than quoted, for `measureApertureWall`'s reason one module
 * over: a design's field limit is not a parameter anybody typed, it is where the
 * chief ray stops clearing the glass, and a quoted number would be a claim about
 * a prescription the reader may have edited. Doubling to find a bracket and then
 * 40 halvings — ~60 chief rays, which against a frame's 65 536 map queries is
 * not a cost worth avoiding.
 *
 * The lower end is seeded at a micron rather than at zero: the axis always
 * succeeds (`objectHeightForImageRadius` returns 0 for a non-positive radius
 * without tracing), so a bracket starting there would report a limit for a
 * system whose chief ray fails everywhere.
 */
export function measureFieldLimit(
  system: OpticalSystem,
  wavelengthNm: number,
): number {
  const reaches = (radiusMm: number): boolean => {
    try {
      objectHeightForImageRadius(system, radiusMm, wavelengthNm);
      return true;
    } catch {
      return false;
    }
  };
  let lo = 1e-3;
  if (!reaches(lo)) return 0;
  let hi = lo;
  while (reaches(hi) && hi < 1e4) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (reaches(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The density, and the closed form its total flux is owed. */
export function emitterOf(
  request: EmitterRequest,
): { readonly density: EmitterDensity; readonly closedFlux: number } {
  const scaleMm = request.scaleUm / 1000;
  const centreMm = { x: request.offsetUm / 1000, y: 0 };
  if (request.shape === "disc") {
    return {
      density: discEmitter({ radiusMm: scaleMm, density: 1, centreMm }),
      closedFlux: Math.PI * scaleMm * scaleMm,
    };
  }
  return {
    density: gaussianEmitter({ waistMm: scaleMm, peak: 1, centreMm }),
    closedFlux: (Math.PI * scaleMm * scaleMm) / 2,
  };
}

/**
 * § 6as.5's control, off the engine's own grid.
 *
 * `values[i]` is `ρ · detJ(r_i) · pixelArea`; dividing by `detJ(r_i)` and
 * multiplying by the frame's uniform object cell gives what the rasterizer a
 * caller writes without thinking would have put there. Pixels the engine skipped
 * (`ρ = 0`) contribute nothing to either total, so they need no special case.
 */
function naiveTotal(frame: ObjectFieldFrame, map: RadialMap, values: Float64Array): number {
  const { size } = frame;
  const uniformCell = frame.objectPixelScaleMm * frame.objectPixelScaleMm;
  const pixelArea = frame.pixelScaleMm * frame.pixelScaleMm;
  let total = 0;
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const v = values[iy * size + ix]!;
      if (v === 0) continue;
      const { x, y } = imagePointAt(frame, ix / size, iy / size);
      const detJ = map.objectAreaPerImageArea(Math.hypot(x, y));
      total += (v / (detJ * pixelArea)) * uniformCell;
    }
  }
  return total;
}

function peakOf(values: Float64Array): number {
  let best = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > best) best = values[i]!;
  return best;
}

function totalOf(values: Float64Array): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s;
}

/**
 * Form one extended emitter, image it, and read everything off the pair.
 *
 * The headroom is measured **before** the map is built, so a refusal can carry
 * the two numbers that caused it. That ordering costs ~60 chief rays on the
 * successful path as well, and it is worth it for the same reason `budget.ts`
 * catches per row: a surface that can only say *no* is one a reader cannot learn
 * the shape of the limit from.
 */
export function renderEmitterScene(request: EmitterRequest): EmitterResult {
  const started = performance.now();
  let frame: ObjectFieldFrame;
  let system: OpticalSystem;
  try {
    const built = buildFrame({
      spec: request.spec,
      pupilSamples: request.pupilSamples,
      size: request.size,
    });
    frame = built.frame;
    system = built.system;
  } catch (cause) {
    // The prescription itself refused — § 6b's and § 6d's design ceilings, in
    // the engine's own words. There is no frame, so there is no headroom.
    return { ...refused(cause), headroom: null };
  }

  const cornerRadiusMm = Math.hypot(
    Math.abs(frame.centreMm.x) + frame.halfExtentMm,
    Math.abs(frame.centreMm.y) + frame.halfExtentMm,
  );
  const fieldLimitMm = measureFieldLimit(system, frame.wavelengthNm);
  const headroom = {
    cornerRadiusMm,
    fieldLimitMm,
    fieldHeadroom: fieldLimitMm / cornerRadiusMm,
  };

  try {
    // Before `emitterOf`, and the ordering is the whole point: both factories
    // refuse a non-positive size in the engine's voice, which is true and is the
    // wrong sentence here. An emitter with no extent is a **point**, and this
    // app has a surface for those — that is an app-side statement about which
    // panel the reader wants, not a statement about the density.
    if (!(request.scaleUm > 0)) {
      throw new AppRefusal(
        `an emitter with no extent is a point, which is A4's surface and not this one — ` +
          `the size is ${request.scaleUm} µm`,
      );
    }
    const map = radialMapCovering(system, [frame], { nodes: RADIAL_MAP_NODES });
    const { density, closedFlux } = emitterOf(request);
    const object = rasterizeEmitterDensity(frame, density, { radialMap: map });

    const fluxRasterized = totalOf(object.values);
    // § 6bc: `patches` is a user control, so this frame may be built from as
    // many pupils as the user asks for and each one transmits its own share.
    // `transmitted` is the only reading that stays true across that knob.
    const out = renderFluorescence(object, tracedFieldPupils(system, frame), {
      pupilSamples: request.pupilSamples,
      patches: request.patches,
      scale: frame.scale,
      throughput: { kind: "transmitted" },
    });
    const formed = totalOf(out.intensity);

    const detJAxis = map.objectAreaPerImageArea(0);
    const m2 = frame.magnification * frame.magnification;
    // Strictly inside the built range: the table refuses its own end point, and
    // the corner is exactly where `radialMapCovering` stopped.
    const detJCorner = map.objectAreaPerImageArea(cornerRadiusMm * (1 - 1e-9));
    const scaleMm = request.scaleUm / 1000;

    return {
      ok: true,
      readout: {
        size: request.size,
        object: object.values,
        intensity: out.intensity,
        objectPeak: peakOf(object.values),
        imagePeak: peakOf(out.intensity),
        objectSpanUm: 2 * frame.objectHalfExtentMm * 1000,
        objectPixelNm: frame.objectPixelScaleMm * 1e6,
        imagePixelUm: frame.pixelScaleMm * 1000,
        tracedNA: objectNumericalAperture(system, LAMBDA_NM),
        abbeResolutionNm:
          abbeResolutionMm(LAMBDA_NM, objectNumericalAperture(system, LAMBDA_NM)) * 1e6,
        magnification: frame.magnification,
        emitterPixels: scaleMm / frame.objectPixelScaleMm,
        reachUm: request.offsetUm + request.scaleUm,
        frameHalfUm: frame.objectHalfExtentMm * 1000,
        fluxRasterized,
        fluxClosedForm: closedFlux,
        fluxResidual: (fluxRasterized - closedFlux) / closedFlux,
        jacobianWorth:
          fluxRasterized > 0 ? naiveTotal(frame, map, object.values) / fluxRasterized - 1 : 0,
        detJAxis,
        detJAxisAgainstM2: Math.abs(detJAxis * m2 - 1),
        detJCornerDeparture: detJCorner / detJAxis - 1,
        lightResidual:
          out.weightedEmittedFlux > 0
            ? Math.abs(formed - out.weightedEmittedFlux) / out.weightedEmittedFlux
            : 0,
        throughput: fluxRasterized > 0 ? formed / fluxRasterized : 0,
        throughputSpan:
          Math.max(...out.patchThroughput) / Math.min(...out.patchThroughput) - 1,
        // Referred to the throughput, so it stays a reading about the BLUR.
        // Since § 6bc the image carries the light the pupils passed, and a peak
        // ratio that did not divide it back out would report a 96% "drop" for
        // an objective that is merely dim — the optics readout turned into a
        // throughput readout, next to the one that already is.
        peakDrop:
          formed > 0
            ? 1 - peakOf(out.intensity) / (formed / fluxRasterized) / peakOf(object.values)
            : 0,
        cornerRadiusMm,
        fieldLimitMm,
        fieldHeadroom: headroom.fieldHeadroom,
        maxGridPhaseStepWaves: out.maxGridPhaseStepWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // The map, the raster or the render refused. The headroom is the sentence a
    // reader can act on — it says whether a smaller crop would help — so it
    // travels with every refusal that had a frame to measure it on.
    return { ...refused(cause), headroom };
  }
}
