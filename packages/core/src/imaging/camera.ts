import { OpticalSystem } from "../trace/system";
import { systemProperties } from "../trace/paraxial";
import { ColorImage } from "./image";
import { imagePointOf } from "./scene";

/**
 * Camera mode — a physical sensor placed at the focal plane.
 *
 * The renderer produces a `ColorImage` on the *native* grid the diffraction
 * calculation needs: `pixelScaleMm` is set fine enough (and ∝ λ) that the PSF is
 * well sampled. That is the continuous optical image, not what a camera records.
 * A real sensor has pixels of a fixed physical pitch, usually much coarser than
 * the native grid, and each pixel *integrates* the light falling on its area.
 *
 * This module is the two things that turns a focal-plane image into a recorded
 * one and needs no absolute photon calibration to be honest:
 *
 *  - **Pixel scale.** How many arcseconds one sensor pixel subtends on the sky
 *    (`plateScale`), and how much field the whole sensor spans (`fieldOfView`,
 *    through the traced chief ray so it carries distortion).
 *  - **Sensor sampling.** Rebinning the native image onto the sensor's pixel
 *    grid by *area integration* (`resampleToSensor`) — which is what a pixel
 *    physically does, and which brings its own detector-footprint MTF and its
 *    own aliasing when the pitch undersamples the diffraction cutoff.
 *
 * **Not here, deliberately.** Absolute exposure in electrons and the shot noise
 * that rides on it need a magnitude → photon-flux zero point, which
 * VALIDATION § 3a records as deliberately absent — an unpinned photon count is
 * worse than none. Relative exposure (the aperture and f-ratio laws) lands in a
 * separate unit whose pins are ratios, not counts.
 */

/** 648000 / π — arcseconds per radian, exact. */
export const ARCSEC_PER_RAD = 648000 / Math.PI;

export interface Sensor {
  /** Physical pixel pitch (mm). Pixels are square and contiguous. */
  readonly pixelPitchMm: number;
  /** Sensor resolution. */
  readonly cols: number;
  readonly rows: number;
}

export interface PlateScale {
  /** Angle one pixel subtends (radians), paraxial: pitch / EFL. */
  readonly radPerPixel: number;
  /** The same in arcseconds — the astronomer-natural unit. */
  readonly arcsecPerPixel: number;
}

/**
 * Plate scale: the sky angle one sensor pixel subtends.
 *
 * pitch / EFL to first order, and EFL comes from the paraxial **trace** — the
 * only non-trivial input. 206265″/rad is the external constant; a wrong EFL (or
 * a wrong constant) is the only way this number moves.
 */
export function plateScale(
  system: OpticalSystem,
  sensor: Sensor,
  wavelengthNm: number,
): PlateScale {
  const efl = systemProperties(system.prescription, wavelengthNm).efl;
  const radPerPixel = sensor.pixelPitchMm / efl;
  return { radPerPixel, arcsecPerPixel: radPerPixel * ARCSEC_PER_RAD };
}

export interface FieldOfView {
  /** Full field the sensor width / height spans (radians), through the chief ray. */
  readonly widthRad: number;
  readonly heightRad: number;
  readonly widthDeg: number;
  readonly heightDeg: number;
}

/**
 * The full field of view the sensor spans, along its width and height.
 *
 * Computed by asking which field angle's chief ray lands at the sensor edge —
 * the **inverse** of `imagePointOf`, traced, not `EFL·tan θ`. That distinction
 * is the whole point: `EFL·tan θ` is the *definition* of a distortion-free
 * system, so a FOV built on it could never report the barrel or pincushion a
 * real prescription has. This one carries whatever distortion the trace does
 * (the forward map is pinned in § 3c).
 */
export function fieldOfView(
  system: OpticalSystem,
  sensor: Sensor,
  wavelengthNm: number,
): FieldOfView {
  const halfWidthMm = (sensor.cols * sensor.pixelPitchMm) / 2;
  const halfHeightMm = (sensor.rows * sensor.pixelPitchMm) / 2;
  const widthDeg = 2 * fieldAngleAtImageRadius(system, halfWidthMm, wavelengthNm);
  const heightDeg = 2 * fieldAngleAtImageRadius(system, halfHeightMm, wavelengthNm);
  const d2r = Math.PI / 180;
  return {
    widthRad: widthDeg * d2r,
    heightRad: heightDeg * d2r,
    widthDeg,
    heightDeg,
  };
}

/**
 * Field angle (degrees) whose chief ray lands `radiusMm` from the axis.
 *
 * Bracket then bisect on the traced image radius — a dozen chief rays, nothing
 * beside a PSF. Mirrors the private inverse `renderField` uses; kept local so
 * camera geometry does not reach into the renderer.
 *
 * ## The bracket may not start outside the system's own field
 *
 * The first version probed at a fixed 0.5° and doubled upward. That assumes
 * every system passes at least half a degree, and a **folded** one need not:
 * a Newtonian's diagonal stops passing the chief ray at a fraction of a degree
 * (§ 2f), ~0.43° at f/10 — so `imagePointOf` threw and a whole sensor's geometry
 * was refused, for sensors whose answer was a tenth of that angle and perfectly
 * well defined. That is a bracket artifact reported as a physical wall, and the
 * two must not be confusable.
 *
 * So the probe **shrinks first** until it is inside the field, and a chief ray
 * that does not survive is treated as *data* rather than as an error: `null`
 * means "this angle is past the field", which for the search is the same side of
 * the answer as "this angle overshoots the radius". Both send `hi` down. The
 * bisection body needs that guard as much as the bracket does — without it the
 * crash moves rather than disappears, since a `mid` can land past the wall at
 * any iteration.
 *
 * A genuine refusal survives, and is now separable: after converging, the
 * returned angle must actually reach the requested radius. Where the sensor is
 * larger than the field the trace passes, it does not, and this throws with what
 * the chief ray *did* reach.
 */
function fieldAngleAtImageRadius(
  system: OpticalSystem,
  radiusMm: number,
  wavelengthNm: number,
): number {
  if (radiusMm <= 0) return 0;
  /** `null` where the chief ray does not survive — a fact about the field. */
  const radiusAt = (deg: number): number | null => {
    try {
      const p = imagePointOf(system, deg, 0, wavelengthNm);
      return Math.hypot(p.x, p.y);
    } catch {
      return null;
    }
  };

  let hi = 0.5;
  let probe = radiusAt(hi);
  for (let i = 0; i < 60 && probe === null; i++) {
    hi /= 2;
    probe = radiusAt(hi);
  }
  if (probe === null) {
    throw new Error(
      `no chief ray reaches the image: the trace fails at every field down to ${hi.toExponential(3)}°`,
    );
  }
  // `lo` stays 0, as it did before: the radius need not be monotone in field
  // under strong distortion, and a tighter lower bound could step over a root.
  const lo0 = 0;
  for (let i = 0; i < 60 && probe !== null && probe < radiusMm; i++) {
    hi *= 2;
    probe = radiusAt(hi);
  }

  let lo = lo0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = radiusAt(mid);
    if (r !== null && r < radiusMm) lo = mid;
    else hi = mid;
  }
  const answer = (lo + hi) / 2;
  const reached = radiusAt(answer);
  if (reached === null || reached < radiusMm * (1 - 1e-6)) {
    throw new Error(
      `image radius ${radiusMm.toFixed(4)} mm is outside the field this system passes: ` +
        `the chief ray reaches ${reached === null ? "nothing" : `${reached.toFixed(4)} mm`} at ${answer.toFixed(4)}° and does not survive beyond it`,
    );
  }
  return answer;
}

/**
 * The pixel pitch that critically (Nyquist) samples the diffraction cutoff.
 *
 * The incoherent MTF reaches zero at f_c = 2·NA/λ (Abbe, pinned in § 2b), so
 * sampling at the Nyquist rate needs 1/pitch = 2·f_c, i.e. pitch = λ/(4·NA).
 * A coarser pitch undersamples and aliases (see `resampleToSensor`); a finer
 * one oversamples and only costs pixels.
 */
export function criticalPitchMm(wavelengthNm: number, naImage: number): number {
  return (wavelengthNm * 1e-6) / (4 * naImage);
}

export type SamplingRegime = "oversampled" | "critical" | "undersampled";

/** Where a sensor's pitch sits relative to critical sampling of the cutoff. */
export function samplingRegime(
  pitchMm: number,
  criticalMm: number,
  tolerance = 0.02,
): SamplingRegime {
  if (pitchMm < criticalMm * (1 - tolerance)) return "oversampled";
  if (pitchMm > criticalMm * (1 + tolerance)) return "undersampled";
  return "critical";
}

/**
 * One destination pixel's overlap with the source pixels it covers.
 *
 * Both grids are **sample-at-centre**: index `n/2` is *centred* on coordinate 0,
 * so pixel `i` spans `[(i − n/2 − ½), (i − n/2 + ½)]·step`. This matches
 * `rasterizePointSources` (an on-axis star lands at index `size/2`) and
 * `radialColorProfile` (centre = `width/2`). Getting the half-pixel wrong is
 * invisible to every energy or frequency rung and shows up only as a centred
 * feature drifting off centre — the golden-image failure mode § 3b flags — which
 * on a module whose headline is sub-pixel plate scale is a real defect, so it
 * has its own centroid rung.
 *
 * A source pixel of width `srcStep` carries its energy uniformly across that
 * width, so the fraction reaching a destination pixel is the overlap length
 * divided by `srcStep` — never by the destination width. A destination pixel
 * covering four source pixels collects *four times* the energy, which is what a
 * bigger photosite does; it does not average.
 */
interface Overlap {
  readonly first: number;
  readonly weights: readonly number[];
}

function overlapWeights(
  srcN: number,
  srcStep: number,
  dstN: number,
  dstStep: number,
): Overlap[] {
  const srcOrigin = srcN / 2;
  const dstOrigin = dstN / 2;
  const out: Overlap[] = [];
  for (let j = 0; j < dstN; j++) {
    // Sample-at-centre: pixel j is centred on (j − dstOrigin)·dstStep.
    const dLo = (j - dstOrigin - 0.5) * dstStep;
    const dHi = (j - dstOrigin + 0.5) * dstStep;
    // Source pixels whose spans can intersect [dLo, dHi].
    const iLo = Math.max(0, Math.floor(dLo / srcStep + srcOrigin));
    const iHi = Math.min(srcN - 1, Math.ceil(dHi / srcStep + srcOrigin));
    const weights: number[] = [];
    let first = iLo;
    let started = false;
    for (let i = iLo; i <= iHi; i++) {
      const sLo = (i - srcOrigin - 0.5) * srcStep;
      const sHi = (i - srcOrigin + 0.5) * srcStep;
      const overlap = Math.min(dHi, sHi) - Math.max(dLo, sLo);
      if (overlap <= 0) {
        if (!started) first = i + 1;
        else break;
        continue;
      }
      started = true;
      weights.push(overlap / srcStep);
    }
    out.push({ first, weights });
  }
  return out;
}

/**
 * Rebin one scalar grid onto a sensor grid by area integration (separable).
 *
 * Exposed for the sampling rungs, which pin the detector-footprint MTF and
 * aliasing on synthetic targets without an optical system in the way.
 */
export function resampleGridToSensor(
  src: Float64Array,
  srcCols: number,
  srcRows: number,
  srcPitchMm: number,
  sensor: Sensor,
): Float64Array {
  const wx = overlapWeights(srcCols, srcPitchMm, sensor.cols, sensor.pixelPitchMm);
  const wy = overlapWeights(srcRows, srcPitchMm, sensor.rows, sensor.pixelPitchMm);

  // Pass 1: resample columns, srcRows × sensor.cols.
  const mid = new Float64Array(srcRows * sensor.cols);
  for (let r = 0; r < srcRows; r++) {
    const srcRow = r * srcCols;
    const midRow = r * sensor.cols;
    for (let jx = 0; jx < sensor.cols; jx++) {
      const { first, weights } = wx[jx]!;
      let acc = 0;
      for (let k = 0; k < weights.length; k++) acc += weights[k]! * src[srcRow + first + k]!;
      mid[midRow + jx] = acc;
    }
  }

  // Pass 2: resample rows, sensor.rows × sensor.cols.
  const out = new Float64Array(sensor.rows * sensor.cols);
  for (let jy = 0; jy < sensor.rows; jy++) {
    const { first, weights } = wy[jy]!;
    const outRow = jy * sensor.cols;
    for (let jx = 0; jx < sensor.cols; jx++) {
      let acc = 0;
      for (let k = 0; k < weights.length; k++) acc += weights[k]! * mid[(first + k) * sensor.cols + jx]!;
      out[outRow + jx] = acc;
    }
  }
  return out;
}

/**
 * Rebin a rendered `ColorImage` onto a sensor.
 *
 * Area integration per XYZ channel — linear light, so summing energy over each
 * sensor pixel is exactly what the sensor does. The result carries
 * `pixelScaleMm = pitch`, so every downstream analysis (plate scale, radial
 * profiles) reads the sensor grid rather than the native one.
 */
export function resampleToSensor(image: ColorImage, sensor: Sensor): ColorImage {
  const src = image.xyz;
  const n = image.width * image.height;
  const chan = new Float64Array(n);
  const xyz = new Float64Array(sensor.cols * sensor.rows * 3);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) chan[i] = src[i * 3 + c]!;
    const out = resampleGridToSensor(
      chan,
      image.width,
      image.height,
      image.pixelScaleMm,
      sensor,
    );
    for (let i = 0; i < out.length; i++) xyz[i * 3 + c] = out[i]!;
  }
  return { width: sensor.cols, height: sensor.rows, pixelScaleMm: sensor.pixelPitchMm, xyz };
}
