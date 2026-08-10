import { newtonian, refractorPair } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import { systemProperties, type OpticalSystem } from "@telemicroscope/core/trace";
import { blackbodySpectrum, spectralSamples } from "@telemicroscope/core/photometry";
import { spectralStack } from "@telemicroscope/core/wave";
import {
  colorImageFromStack,
  criticalPitchMm,
  exposureScale,
  extendedSourceIlluminance,
  fieldOfView,
  imageSpaceMarginalSin,
  integratedXyz,
  plateScale,
  pointSourceCollection,
  resampleGridToSensor,
  resampleToSensor,
  samplingRegime,
  toSrgbBytes,
  type ColorImage,
  type SamplingRegime,
  type Sensor,
} from "@telemicroscope/core/imaging";

/**
 * Camera mode — APP.md Part C's last app-wiring gap, as one pure adapter.
 *
 * `core/imaging/camera` (§ 5r) and `core/imaging/exposure` (§ 5s) have existed
 * since roadmap step 5 and the app has called **neither**: no `Sensor` had ever
 * been instantiated. Nothing below is new physics — every number is § 5r's or
 * § 5s's, called from the app — so **no validation-ladder rung was added**, the
 * boundary APP.md's "what is scopeable at all" section draws and C1's precedent
 * for a whole family of presets arriving with no rung.
 *
 * ## The exposure convention breaks here, deliberately, and the break IS the surface
 *
 * Every other picture in this app auto-exposes: `render.ts` computes
 * `1/(totalY · whiteFraction)` off the image's own total. Doing that here would
 * destroy the two things this panel exists to show. The rebin **conserves
 * energy** — `resampleToSensor`'s weights are `overlap/srcStep` — so
 * renormalizing to the total exactly cancels § 5r's headline rung, that a pixel
 * covering a 4×4 footprint reads 16×. And § 5s's whole axis is a *ratio*, which
 * a self-normalizing frame cannot have.
 *
 * So this adapter fixes the exposure and applies the light-grasp factor
 * explicitly. It has to be explicit, because it is measurably **not** in the
 * image already: `spectralStack` normalizes to the transmitted pupil energy, so
 * the rendered star's integrated Y is flat in aperture — 1074.81 / 1069.78 /
 * 1073.73 at f/10·D10, f/5·D20, f/10·D20, 0.5% across a 2× aperture *and* a 2×
 * focal length. Light grasp is not in the picture until it is put there.
 *
 * That is A10's finding arriving on the telescope side ("the exposure has to be
 * the lamp's and not the tile's"), and A10's conclusion travels with it: **a
 * factor is exactly what a picture cannot show the size of**, so the app rungs
 * pin the numbers and never the shade.
 *
 * ## Which of the two exposure laws drives the picture, and which is the pin
 *
 * They are different laws and this panel can only draw one of them. The picture
 * is a **star** — a point source — whose brightness rides on light grasp ∝ D²,
 * and § 5s labels that a *consistency check, not a pin*, because with a front
 * stop the entrance-pupil radius is the declared aperture and π·r² recovers D²
 * by construction. The **validated, trace-emergent** law is the extended-source
 * 1/F², measured here at 4.037 for f/10 → f/5 against the paraxial 4, the excess
 * being the faster stop's larger sine-condition departure. This panel has no
 * extended source in it, so that number is *printed beside the picture* rather
 * than drawn through it. Asserting the 1/F² law on an object it does not apply
 * to would be the fake the hard rules forbid.
 *
 * ## Why the display exposure divides by `pupilSamples²`
 *
 * `spectralStack`'s normalization is a sum over pupil samples, so the raw image
 * brightens as ps² — 12.74 / 50.28 / 200.01 peak Y at ps 32 / 64 / 128, ×3.95
 * and ×3.98 per doubling. That is **bookkeeping, not light**: the sampling knob
 * must not act as a brightness knob, or a reader raising it to widen the frame
 * would read the change as an exposure. Dividing it out leaves the peak within
 * 2% across the three (0.818 / 0.830 / 0.834 × the unit below).
 */

export type CameraOptic = "singlet" | "achromat" | "newtonian";

export const CAMERA_OPTICS: readonly CameraOptic[] = ["singlet", "achromat", "newtonian"];

export const OPTIC_LABELS: Record<CameraOptic, string> = {
  singlet: "N-BK7 singlet",
  achromat: "N-BK7/F2 achromat",
  newtonian: "Newtonian",
};

/**
 * What each optic is *for the sampling question* — which is a different question
 * from what C1's table asks, so these are not C1's notes.
 */
export const OPTIC_NOTES: Record<CameraOptic, string> = {
  singlet: "one glass, uncorrected — its NA falls monotonically across the band (§ 3b)",
  achromat: "two glasses — the crossing puts its NA maximum mid-band (§ 3b)",
  newtonian: "a mirror has no index, so its NA is the same number at every λ (§ 4b)",
};

/**
 * Each optic's own aperture range, and they deliberately do not share one.
 *
 * `refractorPair` is a toy lens whose chromatic halo has to stay on an FFT grid,
 * so it runs 4–20 mm; a 6 mm Newtonian is not a thing, so that runs 100–400 mm.
 * This is `reflector.tsx`'s precedent and the same reason: two ranges that look
 * like one control are the confusion `panels/registry.ts` describes. What makes
 * the three comparable anyway is that the sampling question is about **focal
 * ratio and dispersion**, not about absolute size — so the contest below is run
 * at a matched focal ratio and says so.
 */
export const APERTURE_RANGE: Record<CameraOptic, { min: number; max: number; step: number; preset: number }> = {
  singlet: { min: 4, max: 20, step: 0.5, preset: 10 },
  achromat: { min: 4, max: 20, step: 0.5, preset: 10 },
  newtonian: { min: 100, max: 400, step: 10, preset: 200 },
};

export interface CameraSpec {
  readonly optic: CameraOptic;
  /** Clear aperture (mm). Ranges are per optic — see `APERTURE_RANGE`. */
  readonly apertureMm: number;
  /** f/D — the number on the box, and what the sampling question actually turns on. */
  readonly focalRatio: number;
  readonly sourceTemperatureK: number;
  readonly wavelengths: number;
  readonly pupilSamples: number;
}

/** Focus is solved once, at this wavelength, for every optic — as `render.ts` does. */
export const FOCUS_NM = 550;

/** `spectralStack`'s padding, shared by every call here so the frame is one size. */
const PAD_FACTOR = 4;
const TRACE_SAMPLES = 21;

/**
 * A sensor narrower than this records a picture nobody can read, and
 * `resampleGridToSensor` on two columns is not a degraded image but an undefined
 * one. A3's rule — a readout whose value is undefined is refused, not drawn.
 */
export const MIN_SENSOR_COLS = 8;

/**
 * The one arbitrary scalar on this panel, and it is arbitrary because § 3a's
 * magnitude → photon-flux zero point is deliberately absent.
 *
 * Measured once so that the reference configuration (achromat, D = 10 mm, f/10,
 * 1 s, gain 1) lands its native peak at ≈ 0.79 of white. It is a *display*
 * constant standing in for the absent radiance, named rather than buried, and
 * every ratio on the panel is independent of it.
 */
export const DISPLAY_EXPOSURE_UNIT = 0.82;

export function focalLengthOf(spec: CameraSpec): number {
  return spec.apertureMm * spec.focalRatio;
}

export function buildCameraSystem(spec: CameraSpec): OpticalSystem {
  const focalLengthMm = focalLengthOf(spec);
  const base: OpticalSystem = {
    prescription: prescriptionOf(spec, focalLengthMm),
    aperture: { kind: "EPD", value: spec.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(spec.sourceTemperatureK), {
      count: spec.wavelengths,
    }),
    conjugate: { kind: "infinite" },
  };
  // One criterion, one wavelength, every optic — or the comparison measures the
  // focus difference instead of the dispersion. `render.ts`'s reasoning exactly.
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return withFocus(base, focus.offsetFromLastVertex);
}

function prescriptionOf(spec: CameraSpec, focalLengthMm: number) {
  if (spec.optic === "newtonian") {
    return newtonian({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio }).prescription;
  }
  // `refractorPair`'s second argument is a SEMI-aperture, so passing the full
  // EPD gives glass twice as wide as the stop. That is `render.ts`'s convention
  // and it is kept here so the two panels draw the same lens.
  const pair = refractorPair(focalLengthMm, spec.apertureMm, focalLengthMm);
  return spec.optic === "singlet" ? pair.singlet : pair.achromat;
}

/** The Newtonian's secondary, as the pupil-radius fraction `PsfOptions` takes. */
export function obstructionOf(spec: CameraSpec): number | undefined {
  if (spec.optic !== "newtonian") return undefined;
  return newtonian({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio }).obstruction;
}

/**
 * The wavelengths the stack **actually contains**, which is not a round list.
 *
 * `spectralSamples(blackbody, {count: 5})` is 430 / 490 / 550 / 610 / 670 nm, so
 * a guard that ruled at "450 nm" would be ruling at a plane the image does not
 * have. The regime verdict below takes the shortest of these.
 */
export function stackWavelengthsNm(spec: CameraSpec): number[] {
  return spectralSamples(blackbodySpectrum(spec.sourceTemperatureK), {
    count: spec.wavelengths,
  }).map((w) => w.nm);
}

/* ------------------------------------------------------------------ *
 * Sampling: the critical pitch, per wavelength, and the contest
 * ------------------------------------------------------------------ */

export interface CriticalRow {
  readonly nm: number;
  /** sin u′ from the **traced** marginal ray, not the paraxial 1/(2F). */
  readonly tracedNa: number;
  readonly criticalPitchMm: number;
  readonly regime: SamplingRegime;
}

/**
 * λ/(4·NA) at every wavelength in the stack, on the **traced** NA.
 *
 * Feeding `criticalPitchMm` the traced `imageSpaceMarginalSin` rather than the
 * paraxial 1/(2F) is what makes the number this system's rather than a formula's.
 * The departure is small — 0.47% at f/10 and 0.94% at f/5, growing with aperture
 * as § 5s's sine-condition rung says it must — and inside `samplingRegime`'s own
 * 2% tolerance, so the *verdict* does not move even though the printed pitch
 * does. The panel says which NA it used.
 */
export function criticalPitchByWavelength(
  system: OpticalSystem,
  spec: CameraSpec,
  pitchMm: number,
): CriticalRow[] {
  return stackWavelengthsNm(spec).map((nm) => {
    const tracedNa = imageSpaceMarginalSin(system, nm);
    const critical = criticalPitchMm(nm, tracedNa);
    return { nm, tracedNa, criticalPitchMm: critical, regime: samplingRegime(pitchMm, critical) };
  });
}

/**
 * The verdict, ruled at the **shortest** wavelength in the stack.
 *
 * `criticalPitchMm` ∝ λ, so 430 → 670 nm is a 1.56× spread against a 2%
 * tolerance and one sensor genuinely holds three verdicts at once: at the pitch
 * that is exactly critical at 550 nm, the blue plane is undersampled and the red
 * is oversampled. Ruling on the worst plane is § 6g.3's rule — a frame is not
 * honest in the places where it happens to be — arriving on the sensor axis.
 */
export function rulingRow(rows: readonly CriticalRow[]): CriticalRow {
  return rows.reduce((worst, row) => (row.nm < worst.nm ? row : worst));
}

export interface PitchSpread {
  /** critical(λ_max) / critical(λ_min), from the traced NAs. */
  readonly ratio: number;
  /** λ_max / λ_min — what the ratio would be if only λ moved. */
  readonly lambdaRatio: number;
  /** (ratio / lambdaRatio − 1). Positive, negative and zero all occur. */
  readonly departure: number;
}

/**
 * **The panel's finding.** The critical pitch is not λ/(4·NA) with λ alone
 * moving — the traced NA moves too, and how it moves is the lens's chromatic
 * correction.
 *
 * Over 430 → 670 nm at f/10, measured:
 *
 * | optic | traced NA across the band | ratio | departure |
 * |---|---|---|---|
 * | singlet | falls monotonically 0.050708 → 0.049426 | 1.598538 | **+2.593%** |
 * | achromat | peaks mid-band at 550 — the crossing | 1.555723 | **−0.155%** |
 * | Newtonian | **bitwise identical** at every λ | 1.558140 | **exactly 0** |
 *
 * So the sign is positive, negative and zero for the three, and the achromat's
 * magnitude is 17× under the singlet's. That is § 3b's singlet-versus-achromat
 * contest arriving on the sampling axis — measured in pixels rather than in
 * colour — and the mirror is the control that makes it a statement about glass:
 * a conic has no refractive index, so its spread is *exactly* the wavelength
 * ratio, to the last bit, at any aperture. C1's Cassegrain-versus-Ritchey
 * control, in a second currency.
 */
export function chromaticPitchSpread(rows: readonly CriticalRow[]): PitchSpread {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const ratio = last.criticalPitchMm / first.criticalPitchMm;
  const lambdaRatio = last.nm / first.nm;
  return { ratio, lambdaRatio, departure: ratio / lambdaRatio - 1 };
}

/**
 * The departure as a curve in λ, which is what the contest has to be *drawn* as.
 *
 * Plotting the raw critical pitches puts three nearly coincident straight lines
 * on the page — they differ by under 3% over the band, so the picture says
 * "λ/(4·NA) is linear in λ" and the finding is invisible in it while the table
 * beside it carries the whole thing. Driving the panel is what showed that.
 *
 * The quantity the finding is about is the **departure from proportionality**,
 * so that is what this returns: each plane's critical pitch against the shortest
 * plane's, divided by what the wavelength ratio alone would give. It is zero at
 * the reference by construction — that is a normalization and not a measurement,
 * and the shape after it is the lens.
 */
export function chromaticDeparturePoints(
  rows: readonly CriticalRow[],
): Array<{ nm: number; departure: number }> {
  const ref = rows[0]!;
  return rows.map((row) => ({
    nm: row.nm,
    departure:
      row.criticalPitchMm / ref.criticalPitchMm / (row.nm / ref.nm) - 1,
  }));
}

/** The pitch that is exactly critical at this wavelength — the panel's snap target. */
export function criticalPitchAt(rows: readonly CriticalRow[], nm: number): number | undefined {
  return rows.find((row) => row.nm === nm)?.criticalPitchMm;
}

/** The traced sine against the paraxial one — § 5s's load-bearing departure. */
export interface SineDeparture {
  readonly tracedSin: number;
  readonly paraxialSin: number;
  /** Signed fraction. Grows with aperture, which is the pin. */
  readonly departure: number;
}

export function sineDeparture(system: OpticalSystem, spec: CameraSpec): SineDeparture {
  const tracedSin = imageSpaceMarginalSin(system, FOCUS_NM);
  const paraxialSin = 1 / (2 * spec.focalRatio);
  return { tracedSin, paraxialSin, departure: tracedSin / paraxialSin - 1 };
}

/* ------------------------------------------------------------------ *
 * The detector-footprint MTF, MEASURED
 * ------------------------------------------------------------------ */

export interface MtfPoint {
  readonly cyclesPerMm: number;
  readonly fractionOfNyquist: number;
  /** Modulation read off the rebinned target. */
  readonly measured: number;
  /** |sinc(π·f·pitch)|, the closed form, drawn as a reference only. */
  readonly sinc: number;
  /** Where an above-Nyquist target lands after folding, in cycles/mm. */
  readonly aliasedToCyclesPerMm?: number;
}

export interface MtfSweep {
  readonly points: readonly MtfPoint[];
  readonly nyquistCyclesPerMm: number;
  /** Largest |measured/sinc − 1| below Nyquist — the quadrature, not a departure. */
  readonly maxRelativeDeparture: number;
  /**
   * Exactly Nyquist is **refused**, and this says so on screen.
   *
   * The recorded modulation there is entirely phase-dependent: 0.634573 with the
   * target aligned to the pixel grid and **exactly 0** a quarter period along —
   * the target vanishing into the sampling. So the value is not a number the
   * measurement has, and A3's rule applies: refuse it, do not print it. The
   * *envelope* 2/π = 0.63662 is real; the value is not.
   */
  readonly refusedAtNyquist: string;
}

const NYQUIST_REFUSAL =
  "modulation at exactly Nyquist is phase-dependent (0.6346 aligned, exactly 0 a quarter period along), so it has no value to plot — the 2/π envelope is real, the point is not";

/**
 * The detector MTF by **measurement**, not by drawing sinc(π·f·p).
 *
 * `core/imaging/camera` exports no detector MTF — § 5r computes it inside the
 * rung — so a panel that drew the closed form would be the app asserting physics
 * the engine does not provide. Instead this sweeps a cosine target through the
 * pinned `resampleGridToSensor` and reads the modulation back out, which costs
 * microseconds, has no trace in it, and gets § 5r's aliasing rung for free: past
 * Nyquist the modulation reappears at |1/p − f|, and projecting there returns
 * the **bit-identical** number, because on the sampled grid those two
 * frequencies are the same frequency.
 *
 * Two things make the measurement exact rather than approximately right, and
 * both were wrong first:
 *
 *  - **Integer cycles across the sensor span.** Otherwise the projection leaks
 *    and reads 1.08 at a tenth of Nyquist — above the closed form, which for a
 *    box filter is impossible and was the tell.
 *  - **The source strictly contains the sensor.** With `cols·pitch` equal to the
 *    source span the outer cells are partly empty, which is not a sampling
 *    effect but a missing-data one, and it drifts the whole curve ~1%.
 *
 * What is left agrees with |sinc(π·f·p)| to 2e-5 at a twelfth of Nyquist and
 * 3e-3 at the last point below it, and that residual is the **target's own
 * staircase**, not the detector: refining the source subdivision at fixed
 * frequency gives 0.964045 / 0.991060 / 0.997768 / 0.999442 / 0.999861 at
 * sub = 4 / 8 / 16 / 32 / 64, an error falling ×4.00 per doubling (measured
 * 4.022 / 4.005 / 4.001 / 4.004) — the midpoint rule's own second order. The
 * rung pins that rate, because it is a closed form; pinning the 3e-3 would be
 * pinning a previous measurement, which is the failure APP.md's Part D order
 * section names as the expensive one.
 */
export function detectorMtfSweep(
  pitchMm: number,
  options: { cols?: number; subdivision?: number; points?: number } = {},
): MtfSweep {
  const cols = options.cols ?? 96;
  const sub = options.subdivision ?? 16;
  const count = options.points ?? 22;
  const span = cols * pitchMm;
  const srcPitch = pitchMm / sub;
  // One whole sensor pixel of margin each side, so no sensor cell is partly empty.
  const n = cols * sub + 2 * sub;
  const sensor: Sensor = { pixelPitchMm: pitchMm, cols, rows: 1 };
  const nyquist = 1 / (2 * pitchMm);
  // Cycles across the window, so every projection basis is orthogonal on it.
  const nyquistCycles = Math.round(nyquist * span);

  const project = (out: Float64Array, freq: number): number => {
    let re = 0;
    let im = 0;
    let dc = 0;
    for (let i = 0; i < cols; i++) {
      // `overlapWeights` centres pixel i on (i − cols/2)·pitch. Same origin here,
      // or the projection measures a phase the rebinner never produced.
      const x = (i - cols / 2) * pitchMm;
      const v = out[i]!;
      dc += v;
      re += v * Math.cos(2 * Math.PI * freq * x);
      im += v * Math.sin(2 * Math.PI * freq * x);
    }
    return dc === 0 ? 0 : (2 * Math.hypot(re, im)) / dc;
  };

  const points: MtfPoint[] = [];
  let maxRelativeDeparture = 0;
  for (let k = 1; k <= count; k++) {
    const cycles = Math.round((k / count) * 2 * nyquistCycles);
    // Every multiple of the Nyquist cycle count is degenerate and is refused
    // rather than drawn — see NYQUIST_REFUSAL. `cycles === nyquistCycles` is the
    // phase-dependent point itself; `2·nyquistCycles` is a target of exactly one
    // cycle per pixel, which folds to DC, so every cell reads the same phase and
    // the projection returns 2 against a closed form of 0.
    if (cycles === 0 || cycles % nyquistCycles === 0) continue;
    if (points.some((p) => p.cyclesPerMm === cycles / span)) continue;
    const f = cycles / span;
    const src = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i - n / 2) * srcPitch;
      src[i] = 1 + Math.cos(2 * Math.PI * f * x);
    }
    const out = resampleGridToSensor(src, n, 1, srcPitch, sensor);
    const measured = project(out, f);
    const arg = Math.PI * f * pitchMm;
    const sinc = Math.abs(Math.sin(arg) / arg);
    const above = f > nyquist;
    if (!above && sinc > 0) {
      maxRelativeDeparture = Math.max(maxRelativeDeparture, Math.abs(measured / sinc - 1));
    }
    points.push({
      cyclesPerMm: f,
      fractionOfNyquist: f / nyquist,
      measured,
      sinc,
      ...(above ? { aliasedToCyclesPerMm: Math.abs(1 / pitchMm - f) } : {}),
    });
  }
  return {
    points,
    nyquistCyclesPerMm: nyquist,
    maxRelativeDeparture,
    refusedAtNyquist: NYQUIST_REFUSAL,
  };
}

/**
 * The same sweep run at one frequency and several source subdivisions — the
 * control that says the departure above belongs to the target and not the
 * detector. Error ×4 per doubling is the midpoint rule; a detector effect would
 * not move with the target's sampling at all.
 */
export function mtfQuadratureRefinement(
  pitchMm: number,
  subdivisions: readonly number[] = [4, 8, 16, 32, 64],
  fractionOfNyquist = 5 / 6,
): Array<{ subdivision: number; ratio: number }> {
  const cols = 96;
  const span = cols * pitchMm;
  const nyquist = 1 / (2 * pitchMm);
  const cycles = Math.round(fractionOfNyquist * nyquist * span);
  const f = cycles / span;
  const arg = Math.PI * f * pitchMm;
  const sinc = Math.abs(Math.sin(arg) / arg);
  const sensor: Sensor = { pixelPitchMm: pitchMm, cols, rows: 1 };
  return subdivisions.map((sub) => {
    const srcPitch = pitchMm / sub;
    const n = cols * sub + 2 * sub;
    const src = new Float64Array(n);
    for (let i = 0; i < n; i++) src[i] = 1 + Math.cos(2 * Math.PI * f * ((i - n / 2) * srcPitch));
    const out = resampleGridToSensor(src, n, 1, srcPitch, sensor);
    let re = 0;
    let im = 0;
    let dc = 0;
    for (let i = 0; i < cols; i++) {
      const x = (i - cols / 2) * pitchMm;
      const v = out[i]!;
      dc += v;
      re += v * Math.cos(2 * Math.PI * f * x);
      im += v * Math.sin(2 * Math.PI * f * x);
    }
    return { subdivision: sub, ratio: (2 * Math.hypot(re, im)) / dc / sinc };
  });
}

/* ------------------------------------------------------------------ *
 * Plate scale, field of view, and the floor that is not distortion
 * ------------------------------------------------------------------ */

/** Standard sensor format sizes. Dimensions only — no manufacturer, no model. */
export const SENSOR_FORMATS: ReadonlyArray<{ key: string; label: string; widthMm: number; heightMm: number }> = [
  { key: "1/2.8", label: '1/2.8"', widthMm: 5.6, heightMm: 3.1 },
  { key: "1", label: '1"', widthMm: 12.8, heightMm: 9.6 },
  { key: "4/3", label: "4/3", widthMm: 17.3, heightMm: 13.0 },
  { key: "aps-c", label: "APS-C", widthMm: 23.5, heightMm: 15.7 },
  { key: "ff", label: "full frame", widthMm: 36.0, heightMm: 24.0 },
];

export interface FormatRow {
  readonly key: string;
  readonly label: string;
  readonly cols: number;
  readonly rows: number;
  readonly arcsecPerPixel: number;
  readonly fovWidthDeg?: number;
  readonly fovHeightDeg?: number;
  readonly paraxialWidthDeg?: number;
  /**
   * The field-dependent part alone: implied EFL at this field against the
   * implied EFL on axis. This is the distortion, and nothing else is.
   */
  readonly distortion?: number;
  /** The engine's own sentence when the chief ray does not reach this corner. */
  readonly error?: string;
}

/**
 * The implied focal length at a given image radius — `EFL` solved back out of
 * the traced chief ray, rather than assumed.
 *
 * This is the whole apparatus for separating the two things that make a traced
 * FOV differ from `2·atan(½w/EFL)`, and they are different in kind.
 */
export function impliedEflMm(system: OpticalSystem, halfWidthMm: number, wavelengthNm: number): number {
  const fov = fieldOfView(system, { pixelPitchMm: 2 * halfWidthMm, cols: 1, rows: 1 }, wavelengthNm);
  const halfDeg = fov.widthDeg / 2;
  return halfWidthMm / Math.tan((halfDeg * Math.PI) / 180);
}

/**
 * How far the image plane sits from the paraxial focal plane, read off the FOV.
 *
 * **This is the panel's second finding, and it is a correction caught before it
 * was printed.** The obvious readout — traced FOV against paraxial
 * `2·atan(½w/EFL)` — has a floor in it: 0.0212% at a half-width of 0.05 mm,
 * which is 0.029° of field, where distortion is identically zero. Printing that
 * as "distortion" is C1's own fringe error repeating exactly, one panel later,
 * in a different quantity.
 *
 * The cause is confirmed by moving the plane rather than argued: put the image
 * at the last vertex instead of at best focus and the floor becomes **+3.4553%**
 * while the field-dependent part is unchanged (−1.77e-4 against −1.57e-4 over
 * the same span). So the departure **factorizes** — a plane-position scale times
 * a distortion — and the scale is this, a *length*: implied EFL 99.678155 minus
 * paraxial EFL 99.699277 = **−21.1 µm** on the f/10 achromat, comfortably inside
 * the quarter-wave depth of focus and therefore invisible in the picture.
 *
 * Reported as a difference from the on-axis limit, the distortion alone runs
 * **×4.00 per doubling of field** (measured 4.05 / 3.995 / 3.989 over half-widths
 * 1 → 2 → 4 → 8 mm) — third-order theory's cubic, in its fractional form.
 */
export function focusOffsetMm(system: OpticalSystem, wavelengthNm: number): number {
  const efl = systemProperties(system.prescription, wavelengthNm).efl;
  return impliedEflMm(system, ON_AXIS_PROBE_MM, wavelengthNm) - efl;
}

/** Small enough that distortion is under a part in 10⁷, large enough to trace. */
const ON_AXIS_PROBE_MM = 0.05;

/**
 * Every format's geometry through this system, catching the refusals.
 *
 * `imagePointOf` **throws** on a failed chief ray (`scene.ts:91`) — there is no
 * silent-NaN path — so `fieldOfView` throws rather than returning a garbage
 * bracket, and a corner the trace cannot reach becomes a row with the engine's
 * own sentence in it. That is `describeReflector`'s convention and A1's before
 * it: a refusal keeps its place in the table.
 */
export function describeFormats(
  system: OpticalSystem,
  pitchMm: number,
  wavelengthNm: number,
): FormatRow[] {
  const scale = plateScale(system, { pixelPitchMm: pitchMm, cols: 1, rows: 1 }, wavelengthNm);
  let axialEfl: number | undefined;
  try {
    axialEfl = impliedEflMm(system, ON_AXIS_PROBE_MM, wavelengthNm);
  } catch {
    axialEfl = undefined;
  }
  const efl = systemProperties(system.prescription, wavelengthNm).efl;
  return SENSOR_FORMATS.map((format) => {
    const cols = Math.floor(format.widthMm / pitchMm);
    const rows = Math.floor(format.heightMm / pitchMm);
    const base = { key: format.key, label: format.label, cols, rows, arcsecPerPixel: scale.arcsecPerPixel };
    try {
      const fov = fieldOfView(system, { pixelPitchMm: pitchMm, cols, rows }, wavelengthNm);
      const halfWidthMm = (cols * pitchMm) / 2;
      const paraxialWidthDeg = 2 * Math.atan(halfWidthMm / efl) * (180 / Math.PI);
      const implied = impliedEflMm(system, halfWidthMm, wavelengthNm);
      return {
        ...base,
        fovWidthDeg: fov.widthDeg,
        fovHeightDeg: fov.heightDeg,
        paraxialWidthDeg,
        ...(axialEfl === undefined ? {} : { distortion: implied / axialEfl - 1 }),
      };
    } catch (error) {
      return { ...base, error: (error as Error).message };
    }
  });
}

/* ------------------------------------------------------------------ *
 * The picture
 * ------------------------------------------------------------------ */

export interface CameraRequest extends CameraSpec {
  /** Sensor pixel pitch, in µm because that is the unit a datasheet uses. */
  readonly pitchUm: number;
  readonly seconds: number;
  readonly gain: number;
}

export interface CameraResult {
  /** The continuous optical image, on the diffraction grid. */
  readonly nativeRgba: Uint8ClampedArray;
  readonly nativeSize: number;
  readonly nativePixelScaleMm: number;
  /** What the sensor records — the same light, rebinned by area. */
  readonly sensorRgba: Uint8ClampedArray;
  readonly sensorCols: number;
  readonly pitchMm: number;
  /** Sensor pitch in native pixels. The peak gain is footprint² on a FLAT field. */
  readonly footprint: number;
  /** Flat-field control: `resampleGridToSensor` of ones, centre pixel / footprint². */
  readonly flatFieldPeakRatio: number;
  /** The star's actual peak gain — below footprint², by the PSF core's curvature. */
  readonly starPeakRatio: number;
  /**
   * Whether the axis lands on a pixel **centre** or on the seam between two, and
   * it is decided by the parity of the column count — which the pitch decides.
   *
   * `overlapWeights` is sample-at-centre: pixel `j` spans
   * `[(j − n/2 − ½), (j − n/2 + ½)]·step`, so for even `n` the cell `n/2` is
   * centred on the axis and for odd `n` the axis falls on a boundary. An on-axis
   * star therefore either lands in one pixel or is split between two, and
   * `starPeakRatio` swings **3.7×** on it — 18.09 / 18.25 / 18.34 / 18.87 / 19.24
   * at even column counts against 4.94 / 4.96 / 4.99 / 5.03 / 5.10 at odd ones,
   * interleaved as the pitch walks 12 → 20 µm. It is not a smooth function of
   * pitch and must not be drawn as one.
   *
   * This is § 5r's own lesson with the roles swapped. That step's centroid rung
   * exists because the energy and frequency rungs are blind to a half-pixel
   * shift; here the **centroid is blind instead** — the split is symmetric, so
   * the centroid stays at 0 either way — and the peak is what moves. The flat
   * field is immune to both, which is the third reason it is worth computing.
   */
  readonly axisOnPixelCentre: boolean;
  /** Rebinned total / native total. Below 1 only by the edge sliver `floor` drops. */
  readonly energyRatio: number;
  /** `cols·pitch / span` — how much of the native frame the sensor covers. */
  readonly coveredFraction: number;
  /** Fraction of sensor pixels driven past white at this exposure. */
  readonly clippedFraction: number;
  /** The scalar applied to BOTH images. Not derived from either. */
  readonly displayExposure: number;
  /** § 5s's D², labelled a consistency check by § 5s itself. */
  readonly lightGrasp: number;
  /** § 5s's pinned law, π·sin²u′ — printed, not drawn: there is no extended source here. */
  readonly extendedIlluminance: number;
  readonly elapsedMs: number;
  /** § 3b's guard, unchanged: light that left the grid wrapped rather than vanished. */
  readonly truncatedFraction: number;
  readonly geometricWeight: number;
  /** Set when the pitch records fewer than `MIN_SENSOR_COLS` columns. */
  readonly refusal?: string;
}

export interface CameraJob {
  readonly seq: number;
  readonly request: CameraRequest;
}

export interface CameraDone {
  readonly seq: number;
  readonly result: CameraResult;
}

function peakY(image: ColorImage): number {
  let peak = 0;
  for (let i = 0; i < image.width * image.height; i++) peak = Math.max(peak, image.xyz[i * 3 + 1]!);
  return peak;
}

/**
 * The flat-field control, and it is exact.
 *
 * `resampleGridToSensor` of a field of ones puts **exactly** footprint² in each
 * cell — 1.000000000000 at footprints 2, 3, 4 and 5.5, integer and not. On the
 * star it does not, because a pixel integrating a peak collects less than one
 * integrating a plateau, and the gap between the two is the PSF core rather than
 * anything the rebin did. Running both is what separates the bookkeeping from
 * the optics; running only the star would have made the deficit look like a bug.
 */
export function flatFieldPeakRatio(pitchMm: number, srcPitchMm: number, srcN = 128): number {
  const cols = Math.max(1, Math.floor((srcN * srcPitchMm) / pitchMm));
  const src = new Float64Array(srcN * srcN).fill(1);
  const out = resampleGridToSensor(src, srcN, srcN, srcPitchMm, { pixelPitchMm: pitchMm, cols, rows: cols });
  const centre = out[Math.floor(cols / 2) * cols + Math.floor(cols / 2)]!;
  const footprint = pitchMm / srcPitchMm;
  return centre / (footprint * footprint);
}

/**
 * The display exposure — fixed, and applied identically to both images.
 *
 * Not `1/totalY`: see the header. It is light grasp × time × gain, through
 * § 5s's own `exposureScale`, divided by the pupil-sample count squared so that
 * a sampling knob is not a brightness knob, times the one arbitrary display
 * scalar § 3a's absent zero point leaves behind.
 */
export function displayExposureOf(system: OpticalSystem, request: CameraRequest): number {
  const grasp = pointSourceCollection(system, FOCUS_NM);
  const scale = exposureScale(grasp, { seconds: request.seconds, gain: request.gain });
  return (DISPLAY_EXPOSURE_UNIT * scale) / (request.pupilSamples * request.pupilSamples);
}

export function renderCamera(request: CameraRequest): CameraResult {
  const started = performance.now();
  const system = buildCameraSystem(request);
  const obstruction = obstructionOf(request);
  const stack = spectralStack(system, 0, {
    pupilSamples: request.pupilSamples,
    padFactor: PAD_FACTOR,
    traceSamples: TRACE_SAMPLES,
    ...(obstruction === undefined ? {} : { obstruction }),
  });
  const native = colorImageFromStack(stack);
  const pitchMm = request.pitchUm / 1000;
  const spanMm = native.width * native.pixelScaleMm;
  const cols = Math.floor(spanMm / pitchMm);

  const displayExposure = displayExposureOf(system, request);
  const lightGrasp = pointSourceCollection(system, FOCUS_NM);
  const extendedIlluminance = extendedSourceIlluminance(system, FOCUS_NM);
  const shared = {
    nativeRgba: toSrgbBytes(native, { exposure: displayExposure }),
    nativeSize: native.width,
    nativePixelScaleMm: native.pixelScaleMm,
    pitchMm,
    footprint: pitchMm / native.pixelScaleMm,
    displayExposure,
    lightGrasp,
    extendedIlluminance,
    truncatedFraction: stack.truncatedFraction,
    geometricWeight: Math.max(...stack.planes.map((p) => p.geometricWeight)),
  };

  if (cols < MIN_SENSOR_COLS) {
    // A3's rule. Two columns is not a coarse picture, it is an undefined one, and
    // the honest move is to keep the native frame on screen and say why.
    return {
      ...shared,
      sensorRgba: new Uint8ClampedArray(0),
      sensorCols: 0,
      flatFieldPeakRatio: Number.NaN,
      starPeakRatio: Number.NaN,
      axisOnPixelCentre: cols % 2 === 0,
      energyRatio: Number.NaN,
      coveredFraction: 0,
      clippedFraction: 0,
      elapsedMs: performance.now() - started,
      refusal: `a ${request.pitchUm.toFixed(2)} µm pitch records ${cols} column${cols === 1 ? "" : "s"} of this ${(spanMm * 1000).toFixed(1)} µm frame — under the ${MIN_SENSOR_COLS} this panel will draw. Raise pupil samples to widen the frame, or lower the pitch.`,
    };
  }

  const sensor: Sensor = { pixelPitchMm: pitchMm, cols, rows: cols };
  const recorded = resampleToSensor(native, sensor);
  const sensorRgba = toSrgbBytes(recorded, { exposure: displayExposure });

  let clipped = 0;
  for (let i = 0; i < cols * cols; i++) {
    if (recorded.xyz[i * 3 + 1]! * displayExposure >= 1) clipped += 1;
  }

  return {
    ...shared,
    sensorRgba,
    sensorCols: cols,
    flatFieldPeakRatio: flatFieldPeakRatio(pitchMm, native.pixelScaleMm),
    starPeakRatio: peakY(recorded) / peakY(native),
    axisOnPixelCentre: cols % 2 === 0,
    energyRatio: integratedXyz(recorded).y / integratedXyz(native).y,
    coveredFraction: (cols * pitchMm) / spanMm,
    clippedFraction: clipped / (cols * cols),
    elapsedMs: performance.now() - started,
  };
}
