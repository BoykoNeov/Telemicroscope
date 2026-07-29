import { coherentSource, commensurateSource } from "@telemicroscope/core/illumination";
import {
  brightfieldSpectralStack,
  colorImageFromStack,
  integratedXyz,
  toSrgbBytes,
  type BrightfieldSpectralStack,
  type ColorImage,
} from "@telemicroscope/core/imaging";
import { chromaticity, type Chromaticity } from "@telemicroscope/core/photometry";
import {
  planckSpectralRadiance,
  spectralSamples,
  spectralXyz,
  VISIBLE_MAX_NM,
  VISIBLE_MIN_NM,
} from "@telemicroscope/core/photometry";
import type { WavelengthSample } from "@telemicroscope/core/trace";
import { entryOf, type MicroscopeKind } from "./microscope";
import { specimenOf, type SpecimenKind } from "./specimens";

/**
 * The section in colour — § 6r on screen, as pure functions.
 *
 * `microscope.ts`'s commitment kept once more: numbers in, numbers out, no DOM
 * and no React, so the expensive half drops into a worker unchanged (and does —
 * `section.worker.ts`).
 *
 * ## Why this panel exists
 *
 * § 6r landed the polychromatic Abbe sum and its headline is "a stained section
 * looks stained" — and until this surface, **nothing in the app called it**. Every
 * microscope panel in the repo is grey, including the stage, whose section is a
 * neutral absorber bound at the d line. So the capability with the largest gap
 * between what the engine can do and what a reader can see was colour, and this
 * is the whole of what A9 is.
 *
 * ## The pair, and the negative control is the point
 *
 * § 6r.5's rung, drawn: the same stack produces two images.
 *
 *  - **Per wavelength** — each λ imaged on its own frame through its own traced
 *    pupil, stacked on the bluest one's ruler, collapsed against the CIE observer.
 *    Colour comes out of the specimen's spectrum and the objective's dispersion.
 *  - **Tinted monochrome** — the same planes summed to one grey image first, then
 *    multiplied by the lamp's own colour. The tempting cheap implementation, and
 *    it produces a perfectly plausible coloured picture.
 *
 * The tinted image has **one hue at every pixel by construction** — a scalar
 * times a fixed XYZ — so the number that separates them is not an error bar, it
 * is a proof against a measurement. § 3b's own negative control, transplanted
 * into the branch, and the panel prints both spreads side by side saying which
 * of the two each is.
 *
 * ## Two ways an image can carry colour, and the picker separates them
 *
 * The specimens (`specimens.ts`) split exactly on this:
 *
 *  - The **ruled grid** and the **diatoms** are `neutralSpecimen` — no λ anywhere
 *    in them. Whatever colour survives to the image is the *objective's*: each
 *    wavelength focuses on its own plane and images at its own scale, so a
 *    neutral edge comes back with coloured fringes. § 3b's purple fringing,
 *    arriving in the microscope branch on an object that has no colour at all.
 *  - The **section** carries two synthetic absorption bands, so its colour is the
 *    specimen's.
 *
 * Both are measured with the same number below, which is what makes the
 * comparison mean anything.
 */

/** Wavelength counts offered. 3 is § 6r.6's own traced sampling. */
export type LampKind = "equal-energy" | "tungsten-3200";

export interface SectionRequest {
  readonly kind: MicroscopeKind;
  readonly specimen: SpecimenKind;
  /** Frequency bins across the pupil diameter. A power of two — see `sourceOf`. */
  readonly pupilSamples: number;
  /** Grid size per wavelength, before the common-grid crop. */
  readonly size: number;
  /** Wavelengths across 400–700 nm, at bin centres. */
  readonly wavelengths: number;
  /** S = NA_cond / NA_obj. Needs no conversion across λ — it is a ratio of NAs. */
  readonly coherenceParameter: number;
  readonly lamp: LampKind;
}

/** One wavelength's row of the readout — § 6r.7 is a per-plane statement. */
export interface PlaneReadout {
  readonly nm: number;
  /** Normalized weight the plane carries into the colour sum. */
  readonly weight: number;
  /** `commonPixelScaleMm / sourcePixelScaleMm` — exactly 1 for the ruler plane. */
  readonly resampleRatio: number;
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly maxGridPhaseStepWaves: number | null;
  readonly contributingPoints: number | null;
}

export interface SectionReadout {
  /** The honest path: colour integrated per wavelength. RGBA, `size`×`size`. */
  readonly rgbaSpectral: Uint8ClampedArray;
  /** The negative control: one grey image, tinted. Same size, same exposure rule. */
  readonly rgbaTinted: Uint8ClampedArray;
  readonly size: number;
  /**
   * Largest chromaticity distance from the frame's own mean, over the interior.
   *
   * "Does this image contain more than one colour", as one number. For the
   * tinted path it is zero **by construction**; for the spectral path it is
   * whatever the specimen and the objective put there.
   */
  readonly spectralSpread: number;
  readonly tintedSpread: number;
  /**
   * The same two, luminance-weighted over the whole interior.
   *
   * The pair that separates *where* the colour is. A neutral specimen with hard
   * edges can carry the larger **max** — the objective's axial colour is
   * concentrated exactly at an edge — while carrying almost no colour anywhere
   * else; a stain fills the frame and moves both. Measured, and it corrected
   * this panel's own scoped expectation: see `section.test.ts` A9.2.
   */
  readonly spectralMeanSpread: number;
  readonly tintedMeanSpread: number;
  /** The frame's mean chromaticity, and the lamp's own — their distance is the cast. */
  readonly meanChromaticity: Chromaticity;
  readonly lampChromaticity: Chromaticity;
  readonly meanFromLamp: number;
  /** Interior pixels the spread was measured over, and those too dark to have a hue. */
  readonly measuredPixels: number;
  readonly darkPixels: number;
  /** The wavelength whose own grid every plane was resampled onto (the bluest). */
  readonly rulerWavelengthNm: number;
  readonly meanWavelengthNm: number;
  /** Pixels dropped from each side to reach the common grid. */
  readonly croppedPixels: number;
  /** Specimen covered by the whole frame (µm), on the ruler plane's own scale. */
  readonly objectSpanUm: number;
  readonly planes: readonly PlaneReadout[];
  /** The worst plane's verdict, and WHICH plane it was — § 6r.7's blue end. */
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly verdictNm: number;
  readonly sourcePoints: number;
  readonly elapsedMs: number;
}

export type SectionResult =
  | { readonly ok: true; readonly readout: SectionReadout }
  | { readonly ok: false; readonly error: string };

export interface SectionJob {
  readonly seq: number;
  readonly request: SectionRequest;
}

export interface SectionDone {
  readonly seq: number;
  readonly result: SectionResult;
}

/**
 * Nodes in the tabulated inverse chief-ray map, per wavelength (§ 6s).
 *
 * `stage.ts`'s number and its reasoning, with one thing added that is specific
 * to colour: the tables are **per wavelength** and cannot be shared, because the
 * inverse map is λ-dependent and `radialMapCovering` refuses to span two. So the
 * cost of the cache multiplies by the wavelength count while the cost it removes
 * multiplies by the same factor — which is why it is still overwhelmingly worth
 * it, and why the node count is not worth economising on.
 */
const RADIAL_MAP_NODES = 32;

/**
 * Pixels ignored at each edge when the spread is measured.
 *
 * Not about the resample: § 6r's common grid is the bluest plane's and strictly
 * interior, so no plane is sourced from outside its own grid and there is no
 * black border to pick up. It is about the **transform's periodicity** — an Abbe
 * image is a circular convolution, so the outermost pixels see the specimen
 * wrapped, and a wrap is a structure the specimen does not have. Reported
 * (`measuredPixels`) rather than assumed.
 */
const EDGE_MARGIN_PX = 3;

/**
 * Pixels dimmer than this fraction of the frame's brightest are not measured.
 *
 * `chromaticity` divides by X+Y+Z and **throws** at zero, and a pixel at 1e-9 of
 * the peak has a hue that is f64 noise rather than a colour. The floor is stated
 * and the count of what it excluded is reported, because a spread measured over
 * a set the caller cannot see is a number with a hidden denominator.
 */
const DARK_FLOOR = 1e-3;

/** The lamp, sampled — the SED goes in the WEIGHTS here (one source, whole frame). */
export function lampSamples(lamp: LampKind, count: number): WavelengthSample[] {
  const sed =
    lamp === "equal-energy"
      ? () => 1
      : (nm: number) => planckSpectralRadiance(nm, 3200);
  return spectralSamples(sed, { count, fromNm: VISIBLE_MIN_NM, toNm: VISIBLE_MAX_NM });
}

/**
 * The condenser, on the pupil's own lattice (§ 6p).
 *
 * `commensurateSource` rather than `diskSource` for one reason that matters more
 * here than anywhere else: every illumination direction reads one cached traced
 * pupil, and this panel pays for the pupil **once per wavelength**. § 6p pins the
 * two sources bitwise, so the choice is a price and not a physics decision — it
 * does require `pupilSamples` to be a power of two, which it refuses rather than
 * tolerates.
 *
 * **S = 0 is a different source, not a small one**, and driving the panel is what
 * found it: a lattice of radius zero holds no points, so `commensurateSource`
 * refuses it rather than returning the axial direction, and the slider's own
 * left end threw. `coherentSource` is that one direction — A2's `sourceAt` makes
 * the same split for the same reason, and it matters here at every setting where
 * the grid caps S to zero, since the coherent limit stays computable when no
 * open condenser is.
 */
export function sourceOf(coherenceParameter: number, pupilSamples: number) {
  return coherenceParameter === 0
    ? coherentSource()
    : commensurateSource(coherenceParameter, pupilSamples, 1);
}

/**
 * The largest S whose shifted pupil still fits the frequency grid.
 *
 * A2's wall, with one term dropped and the reason worth stating: there the
 * binding sample is a `diskSource`'s outermost lattice point at S·(1 − 1/N), so
 * the cap carries the source count. A **commensurate** source's points sit on
 * the pupil's own lattice and none of them is outside |s| = S, so the binding
 * radius is S itself and the cap is `(size − 2)/pupilSamples − 1`.
 *
 * At grid 64 / ps 32 that is **0.9375** — a real limit a reader will meet, since
 * a fully open condenser is S = 1. `abbeImage` throws rather than truncating (a
 * truncated pupil looks exactly like a smaller aperture, which would read as
 * physics), and `renderSection` catches and prints that throw, so the clamp in
 * the panel is the convenience and the engine's refusal is still the check on it.
 *
 * **Returned raw, so it can be negative, and that is the correction the panel
 * forced.** Clamping this to zero says "only the coherent limit fits", which is
 * a sentence about a real and interesting setting — and at ps 64 on a 64² grid
 * it is false: the engine refuses S = 0 there too, because an *unshifted* pupil
 * of 64 bins already needs 66 (`size ≥ (1 + |s|)·pupilSamples + 2`, exactly the
 * bound this inverts). A negative value means no condenser fits at all, coherent
 * included, and the only fix is a bigger grid.
 */
export function maxCoherenceParameter(size: number, pupilSamples: number): number {
  return (size - 2) / pupilSamples - 1;
}

/** XYZ at one pixel of an image, as a chromaticity, or null if it is too dark. */
function hueAt(image: ColorImage, index: number, floor: number): Chromaticity | null {
  const o = index * 3;
  const x = image.xyz[o]!;
  const y = image.xyz[o + 1]!;
  const z = image.xyz[o + 2]!;
  if (!(y > floor) || !(x + y + z > 0)) return null;
  return chromaticity({ x, y, z });
}

const distance = (a: Chromaticity, b: Chromaticity): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface SpreadReadout {
  /** Largest departure any single interior pixel makes. */
  readonly spread: number;
  /**
   * The same departure averaged over the interior, weighted by luminance.
   *
   * Reported beside the max because the two answer different questions and the panel
   * needs both: a max is an outlier, so a neutral specimen with hard edges can
   * beat a stain on it while carrying colour nowhere except at those edges. The
   * weighted mean is what says whether the colour is *in the frame* or *on its
   * boundaries* — and weighted by Y rather than by count, because a dim pixel's
   * hue is both less certain and less visible.
   */
  readonly meanSpread: number;
  readonly mean: Chromaticity;
  readonly measured: number;
  readonly dark: number;
}

/**
 * How far the image's colours spread from its own mean, over the interior.
 *
 * Deliberately specimen-agnostic — no "the stain is here and the field is
 * there". A panel that sampled two chosen pixels would be reading its own
 * authoring, and the same number has to be computed on the ruled grid, where
 * there is no stain and the colour comes from the objective instead.
 */
export function chromaticSpread(image: ColorImage, margin = EDGE_MARGIN_PX): SpreadReadout {
  const n = image.width;
  let peakY = 0;
  for (let y = margin; y < n - margin; y++) {
    for (let x = margin; x < n - margin; x++) {
      const v = image.xyz[(y * n + x) * 3 + 1]!;
      if (v > peakY) peakY = v;
    }
  }
  const floor = peakY * DARK_FLOOR;

  // The mean is the chromaticity of all the interior light TOGETHER, not the
  // mean of the per-pixel chromaticities: chromaticity is a ratio, and averaging
  // ratios weights a dim pixel like a bright one.
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let y = margin; y < n - margin; y++) {
    for (let x = margin; x < n - margin; x++) {
      const o = (y * n + x) * 3;
      sx += image.xyz[o]!;
      sy += image.xyz[o + 1]!;
      sz += image.xyz[o + 2]!;
    }
  }
  const mean = chromaticity({ x: sx, y: sy, z: sz });

  let spread = 0;
  let measured = 0;
  let dark = 0;
  let weighted = 0;
  let weight = 0;
  for (let y = margin; y < n - margin; y++) {
    for (let x = margin; x < n - margin; x++) {
      const i = y * n + x;
      const hue = hueAt(image, i, floor);
      if (hue === null) {
        dark += 1;
        continue;
      }
      measured += 1;
      const d = distance(hue, mean);
      if (d > spread) spread = d;
      const luminance = image.xyz[i * 3 + 1]!;
      weighted += luminance * d;
      weight += luminance;
    }
  }
  return {
    spread,
    meanSpread: weight > 0 ? weighted / weight : 0,
    mean,
    measured,
    dark,
  };
}

/**
 * The tinted-monochrome control, built from the SAME stack as the honest image.
 *
 * § 6r.5's construction exactly: sum the planes with their weights into one grey
 * image, then multiply by the lamp's own XYZ. Every pixel is therefore a scalar
 * times one colour, which is why its chromaticity spread is zero and not small.
 */
export function tintedImage(stack: BrightfieldSpectralStack): ColorImage {
  const n = stack.size;
  const mono = new Float64Array(n * n);
  for (const p of stack.planes) {
    for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + p.weight * p.intensity[i]!;
  }
  const tint = spectralXyz(
    stack.samples,
    stack.samples.map(() => 1),
  );
  const xyz = new Float64Array(n * n * 3);
  for (let i = 0, o = 0; i < mono.length; i++, o += 3) {
    xyz[o] = mono[i]! * tint.x;
    xyz[o + 1] = mono[i]! * tint.y;
    xyz[o + 2] = mono[i]! * tint.z;
  }
  return { width: n, height: n, pixelScaleMm: stack.pixelScaleMm, xyz };
}

/** Mid-grey at the frame's own mean, as everywhere else in the app. */
const WHITE_OVER_MEAN = 2;

/**
 * Each image exposed on **its own** total, and that is not the tolerance panel's
 * choice.
 *
 * Part B shares one exposure between two frames because there the claim is that
 * one is worse than the other and re-exposing would hide it. Here the claim is
 * about **hue**, which is exposure-invariant, and the two paths carry different
 * absolute scales for no physical reason at all — the tint is the lamp's XYZ,
 * the spectral image is the observer's integral. Sharing an exposure would put a
 * brightness difference on screen and let a reader read it as a colour one.
 */
function expose(image: ColorImage, pixels: number): Uint8ClampedArray {
  const meanY = integratedXyz(image).y / pixels;
  return toSrgbBytes(image, { exposure: meanY > 0 ? 1 / (WHITE_OVER_MEAN * meanY) : 1 });
}

const VERDICT_RANK = { valid: 0, unknown: 1, "no-honest-image": 2 } as const;

/**
 * Form one polychromatic brightfield frame and read the pair off it.
 *
 * The traced map, not the uniform one: § 6n's warped grid is the honest path and
 * § 6s's table is what makes it affordable — the raster would otherwise bisect a
 * chief ray per pixel **per wavelength**, which is the term D7 measured as
 * dominant and § 6s removed.
 *
 * Measured on the DIN 4×/0.10 at ps 32 / grid 64, S = 0.5, its 208-direction
 * commensurate condenser — `section.test.ts` prints these on every run:
 * **149 ms at 3 λ, 231 ms at 5 λ, 403 ms at 9 λ**, i.e. 45–50 ms a wavelength and
 * flat in the count, which is what "the Abbe sum is the bill" looks like from
 * outside. D7 quoted "nine wavelengths at 64² is still minutes" and that was
 * true when it was written; **§ 6s is the whole difference**, and it is why this
 * panel is a select-change cost rather than a button.
 *
 * The lattice is the expensive axis, not the wavelength count: ps 64 / grid 128
 * is 812 directions and **2 487 ms at 3 λ**, 17× the same stack at ps 32. Which
 * is the shape of the panel's one real trade — § 6r.7's blue plane needs the
 * finer lattice to stop refusing, and it costs an order of magnitude.
 */
export function renderSection(request: SectionRequest): SectionResult {
  const started = performance.now();
  try {
    const system = entryOf(request.kind).build();
    const samples = lampSamples(request.lamp, request.wavelengths);
    const source = sourceOf(request.coherenceParameter, request.pupilSamples);

    const stack = brightfieldSpectralStack(system, specimenOf(request.specimen).specimen, source, {
      size: request.size,
      pupilSamples: request.pupilSamples,
      samples,
      patches: 1,
      radialMapNodes: RADIAL_MAP_NODES,
    });

    const spectral = colorImageFromStack(stack);
    const tinted = tintedImage(stack);
    const pixels = stack.size * stack.size;
    const spectralSpread = chromaticSpread(spectral);
    const tintedSpread = chromaticSpread(tinted);

    // The lamp's own colour, through the same observer — what a clear field
    // images as, and the thing a cast is a departure FROM.
    const lampChromaticity = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map(() => 1),
      ),
    );

    // The worst plane, by name. § 6r.7: the blue end is worst-resolved by 2.56×
    // where λ alone gives 1.22, so the plane that refuses is a wavelength and the
    // panel has to say which one rather than reporting a frame-wide colour.
    let worst = stack.planes[0]!;
    for (const p of stack.planes) {
      const rank = VERDICT_RANK[p.fidelity?.verdict ?? "unknown"];
      if (rank > VERDICT_RANK[worst.fidelity?.verdict ?? "unknown"]) worst = p;
    }

    // The ruler plane's frame carries the object scale — it is the one plane
    // whose grid was copied rather than resampled (`resampleRatio` exactly 1), so
    // its own object pixel times the common grid IS the span the picture covers.
    // Every other plane's frame is wider in proportion to λ, which is the whole
    // reason a common ruler had to be chosen at all.
    const ruler = stack.planes.find((p) => p.resampleRatio === 1) ?? stack.planes[0]!;
    const objectSpanUm =
      ruler.frame === undefined ? Number.NaN : ruler.frame.objectPixelScaleMm * 1e3 * stack.size;

    return {
      ok: true,
      readout: {
        rgbaSpectral: expose(spectral, pixels),
        rgbaTinted: expose(tinted, pixels),
        size: stack.size,
        spectralSpread: spectralSpread.spread,
        tintedSpread: tintedSpread.spread,
        spectralMeanSpread: spectralSpread.meanSpread,
        tintedMeanSpread: tintedSpread.meanSpread,
        meanChromaticity: spectralSpread.mean,
        lampChromaticity,
        meanFromLamp: distance(spectralSpread.mean, lampChromaticity),
        measuredPixels: spectralSpread.measured,
        darkPixels: spectralSpread.dark,
        rulerWavelengthNm: stack.rulerWavelengthNm,
        meanWavelengthNm: stack.meanWavelengthNm,
        croppedPixels: stack.croppedPixels,
        objectSpanUm,
        planes: stack.planes.map((p) => ({
          nm: p.nm,
          weight: p.weight,
          resampleRatio: p.resampleRatio,
          verdict: p.fidelity?.verdict ?? "unknown",
          verdictReason: p.fidelity?.reason ?? "no sampling was recorded for this plane",
          maxGridPhaseStepWaves: p.maxGridPhaseStepWaves ?? null,
          contributingPoints: p.contributingPoints ?? null,
        })),
        verdict: worst.fidelity?.verdict ?? "unknown",
        verdictReason: worst.fidelity?.reason ?? "no sampling was recorded for this plane",
        verdictNm: worst.nm,
        sourcePoints: source.points.length,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // Three kinds of refusal reach here and all are readouts: a design ceiling
    // (§ 6b, § 6d), `abbeImage`'s frequency-grid wall, and § 6p's power-of-two
    // precondition on a commensurate lattice.
    return { ok: false, error: (cause as Error).message };
  }
}
