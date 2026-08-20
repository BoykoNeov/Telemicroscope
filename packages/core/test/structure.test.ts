import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGolden as checkGoldenIn } from "./support/golden";
import { encodeGamma } from "../src/photometry/srgb";
import { objectFieldFrame, type ObjectFieldFrame } from "../src/imaging/object-field";
import {
  barTarget,
  rasterizeSpecimen,
  siemensStar,
  usafFrequencyCyclesPerMm,
  type Specimen,
} from "../src/imaging/specimen";
import { abbeImage, coherentSource, diskSource, idealPupil, imageHarmonic } from "../src/illumination";
import type { ObjectField } from "../src/illumination/abbe";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6ao — a specimen with real structure.
 *
 * Every object this branch has imaged has been a cosine grating or a flat
 * stain: one spatial frequency, or none. That is the right object for pinning a
 * transfer, and it is the wrong object for ever finding out what a *picture*
 * does, because it has no edges and no ends. A bar target has both.
 *
 * ## The external number is the square wave's own Fourier series
 *
 * A 50%-duty binary bar is ½ + (2/π)·cos θ − (2/3π)·cos 3θ + …, and a cosine
 * authored as 0.5 + 0.5·cos θ has fundamental ½. So hard edges put **4/π more**
 * into the fundamental than the cosine everyone has been imaging, and every
 * closed form below is that series read through an aperture that passes a known
 * set of its orders.
 *
 * Two things about how that is asserted, both of which cost a wrong rung to
 * learn elsewhere in this ladder:
 *
 * **Amplitude, not contrast.** Three-order imaging gives an intensity
 * |a₀ + 2a₁cos θ|² = (a₀² + 2a₁²) + 4a₀a₁·cos θ + 2a₁²·cos 2θ. The two objects
 * share a₀ = ½ but not a₁, so their image DC differs (0.4634 against 0.3750)
 * and the *contrast* ratio is 1.078 where the *amplitude* ratio is the 1.3066
 * the series predicts. A rung written on contrast misses by 20% and looks like
 * physics.
 *
 * **The sampled bar is not the mathematical one, and the split is § 6an's.** A
 * binary edge on a pixel grid has coefficient 1/(p·sin(π/p)) and not 1/π —
 * 2.6% high at eight samples to the period. Quoting the miss as the imaging
 * residual would blame the lens for the ruler, so § 6ao.1 pins the ruler on its
 * own with no optics present, and everything downstream is normalized by the
 * object's **measured** coefficient.
 *
 * ## Where the orders go
 *
 * Frequency is in units of NA/λ, as everywhere in § 6f: bin k on this grid is
 * ν = 2k/`pupilSamples`, the coherent cutoff is ν = 1 and a condenser of
 * coherence S moves it to 1 + S. At `pupilSamples` = 12 a 4-cycle ruling puts
 * the fundamental at ν = 0.667 and its third harmonic at ν = 2.0, so 3f is
 * outside the aperture at every source direction the condenser has and the
 * image is a three-order image exactly. That commensuration is the whole reason
 * the rungs below can be closed-form rather than fitted.
 *
 * Cost: the picture rungs rasterize on `map: "uniform"` — § 6n's warp is pinned
 * in `specimen.test.ts` and costs 0.12 ms per pixel, and nothing here claims
 * anything about distortion. Only the frame is traced.
 */

const LAMBDA = 587.5618;
const SIZE = 32;
/** ν = 2k/`pupilSamples`, so 12 puts a 4-cycle ruling's 3f at ν = 2. */
const PUPIL_SAMPLES = 12;
/** Bin of the fundamental: 4 cycles across 32 samples is a period of 8 px. */
const CYCLES = 4;
const PERIOD_PX = SIZE / CYCLES;

/** § 6b's DIN 4×/0.10, solved once — every rung here is a pure readout. */
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const FRAMES = new Map<number, ObjectFieldFrame>();
const frameAt = (pupilSamples = PUPIL_SAMPLES): ObjectFieldFrame => {
  let frame = FRAMES.get(pupilSamples);
  if (frame === undefined) {
    frame = objectFieldFrame(SYSTEM, { size: SIZE, pupilSamples, wavelengthNm: LAMBDA });
    FRAMES.set(pupilSamples, frame);
  }
  return frame;
};

/**
 * Where a commensurate ruling has to sit: half a pixel off the frame's centre.
 *
 * The frame's centre falls **on** sample `size/2` (`specimenPointAt`'s
 * convention), so a bar of an even number of pixels centred there puts both of
 * its edges exactly on samples — and an edge on a sample is the coin toss
 * `barTarget`'s header refuses to resolve. Half a pixel of offset moves every
 * edge to a half-integer and the ruling samples as exactly four on and four
 * off, which is what makes § 6ao.1's closed form exact rather than approximate.
 */
const halfPixelCentre = (frame: ObjectFieldFrame) => ({
  x: frame.centreObjectMm.x + frame.objectPixelScaleMm / 2,
  y: frame.centreObjectMm.y + frame.objectPixelScaleMm / 2,
});

/** The ruling's period as a length, from the frame's own pixel scale. */
const periodMmOf = (frame: ObjectFieldFrame) => PERIOD_PX * frame.objectPixelScaleMm;

const rasterize = (specimen: Specimen, frame = frameAt()): ObjectField =>
  rasterizeSpecimen(SYSTEM, frame, specimen, { map: "uniform" });

/**
 * The unbounded square-wave ruling, at the frame's commensurate period.
 *
 * `bars` omitted, so there are no ends: this is the object § 6ao.1–.4 need,
 * where the only structure is the edge itself. The finite element arrives at
 * § 6ao.6.
 */
const ruling = (frame = frameAt(), orientation: "vertical" | "horizontal" = "vertical"): Specimen =>
  barTarget({
    cyclesPerMm: 1 / periodMmOf(frame),
    centreMm: halfPixelCentre(frame),
    orientation,
  });

/** The cosine of the same period and the same mean — the object to beat. */
const cosineRuling = (frame = frameAt()): Specimen => {
  const periodMm = periodMmOf(frame);
  const centre = halfPixelCentre(frame);
  return (xMm) => ({ re: 0.5 + 0.5 * Math.cos((2 * Math.PI * (xMm - centre.x)) / periodMm), im: 0 });
};

/**
 * One Fourier bin of an **amplitude** array, via the intensity reader.
 *
 * `imageHarmonic` is a mean and a single DFT bin and does not care what the
 * array means, so it reads an object's own spectrum as happily as an image's.
 * Using it here rather than a second implementation is deliberate: the object
 * side and the image side of every ratio below are then measured by the same
 * arithmetic, so a bug in the reader cancels instead of masquerading as optics.
 */
const bin = (values: Float64Array, k: number, ky = 0) => imageHarmonic(values, SIZE, k, ky);

/** The closed form for a 50%-duty binary bar sampled p times to the period. */
const sampledBarFundamental = (p: number) => 1 / (p * Math.sin(Math.PI / p));

describe("§ 6ao.1 — the sampled bar's own coefficient, before any optics", () => {
  it("is 1/(p·sin(π/p)) exactly, and not 1/π", () => {
    // THE RULER, measured with nothing between the specimen and the reader.
    // A mathematical square wave has fundamental 2/π = 0.63662 (peak amplitude
    // of the cos term, which is twice the 1/π complex coefficient). What is on
    // the grid is p samples of it, half of them on, and the sum of p/2 unit
    // phasors is a Dirichlet kernel: 2/(p·sin(π/p)). At p = 8 that is 0.65328,
    // which is 2.6% ABOVE 2/π — a miss big enough to swamp every imaging
    // residual in this file if it were mistaken for one.
    const frame = frameAt();
    const object = rasterize(ruling(frame));

    // The authored target is two-valued and half of it is opaque: the mean is
    // exactly ½, which is what lets a₀ be a constant in the closed forms below
    // rather than a second measured quantity.
    const fundamental = bin(object.re, CYCLES);
    expect(fundamental.dc).toBeCloseTo(0.5, 15);
    for (let i = 0; i < object.re.length; i++) {
      expect(object.re[i] === 0 || object.re[i] === 1).toBe(true);
      expect(object.im[i]).toBe(0);
    }

    expect(fundamental.amplitude).toBeCloseTo(2 * sampledBarFundamental(PERIOD_PX), 14);
    // …and the 2.6% is real, not a tolerance: the mathematical value is a long
    // way outside the agreement above.
    expect(Math.abs(fundamental.amplitude - 2 / Math.PI)).toBeGreaterThan(0.016);
  });

  it("and it converges on 2/π as the square of the sampling, ×4 per doubling", () => {
    // What makes the line above a RULER and not an error: the gap is the
    // sampling's and shrinks like (π/p)²/6, so it quarters every time the
    // period doubles. Nothing is fitted — the ratio is read off three periods
    // of the same authored target.
    const errors = [8, 16, 32].map((p) => Math.abs(2 * sampledBarFundamental(p) - 2 / Math.PI));
    const ratios = [errors[0]! / errors[1]!, errors[1]! / errors[2]!];
    // 4.0535 and 4.0135, and the direction is not noise: the next term of the
    // expansion is 7(π/p)⁴/360 and it is positive, so every ratio overshoots 4
    // and the overshoot is itself p². Asserting the overshoot rather than
    // widening the window around 4 is what makes this a measurement of the
    // series and not of a tolerance.
    for (const ratio of ratios) expect(ratio).toBeGreaterThan(4);
    expect(ratios[0]! - 4).toBeLessThan(0.06);
    expect((ratios[0]! - 4) / (ratios[1]! - 4)).toBeCloseTo(4, 0);
    // Measured on the grid too, not only in the closed form: a 32-px period is
    // one cycle across this frame, and its fundamental is nearer 2/π than the
    // 8-px one by the same factor.
    const frame = frameAt();
    const wide = rasterizeSpecimen(
      SYSTEM,
      frame,
      barTarget({
        cyclesPerMm: 1 / (SIZE * frame.objectPixelScaleMm),
        centreMm: halfPixelCentre(frame),
      }),
      { map: "uniform" },
    );
    const wideError = Math.abs(bin(wide.re, 1).amplitude - 2 / Math.PI);
    const narrowError = Math.abs(bin(rasterize(ruling(frame)).re, CYCLES).amplitude - 2 / Math.PI);
    expect(narrowError / wideError).toBeCloseTo(16, 0);
  });
});

describe("§ 6ao.2 — three orders and no more", () => {
  it("puts the bar's third harmonic outside the aperture at every direction", () => {
    // The commensuration this file is built on, stated as the arithmetic it is.
    // ν = 2k/pupilSamples, so the fundamental is inside the coherent cutoff and
    // 3f is outside even the S = 0.5 one — no source direction transmits it, so
    // no pair of transmitted orders can beat down to it either.
    expect((2 * CYCLES) / PUPIL_SAMPLES).toBeCloseTo(2 / 3, 12);
    expect((2 * 3 * CYCLES) / PUPIL_SAMPLES).toBeCloseTo(2, 12);
    expect((2 * 3 * CYCLES) / PUPIL_SAMPLES).toBeGreaterThan(1 + 0.5);
  });

  it("so the coherent image is DC, f and 2f in the closed form — and nothing at 3f", () => {
    // THE HEADLINE. Only orders 0 and ±1 survive, so the image intensity is
    // |a₀ + 2a₁cos θ|² term by term, with a₀ = ½ and a₁ the coefficient § 6ao.1
    // measured. Every one of the three numbers below is that expansion, and the
    // fourth is the harmonic the object has and the image cannot.
    const frame = frameAt();
    const object = rasterize(ruling(frame));
    const a0 = 0.5;
    const a1 = sampledBarFundamental(PERIOD_PX);

    const image = abbeImage(object, idealPupil(), coherentSource(), {
      pupilSamples: PUPIL_SAMPLES,
    });
    const f = bin(image.intensity, CYCLES);
    const f2 = bin(image.intensity, 2 * CYCLES);
    const f3 = bin(image.intensity, 3 * CYCLES);

    expect(f.dc).toBeCloseTo(a0 * a0 + 2 * a1 * a1, 12);
    expect(f.amplitude).toBeCloseTo(4 * a0 * a1, 12);
    expect(f2.amplitude).toBeCloseTo(2 * a1 * a1, 12);
    // The bars' own third harmonic is not attenuated, it is ABSENT: fourteen
    // orders below the fundamental is "the aperture never carried it".
    expect(f3.amplitude).toBeLessThan(1e-14);
    expect(f3.amplitude / f.amplitude).toBeLessThan(1e-14);
  });

  it("and the second harmonic the image DOES have is the fundamental beating with itself", () => {
    // Worth separating, because it is the one harmonic in the image that the
    // object's series cannot explain: 2f is even and a square wave has no even
    // harmonics at all. It is the |·|² of a three-order sum, so its size is
    // a₁/(2a₀) of the fundamental — 0.3266 for the bar and exactly 0.25 for the
    // cosine, which is the same statement with a different a₁.
    const frame = frameAt();
    const readRatio = (specimen: Specimen) => {
      const image = abbeImage(rasterize(specimen, frame), idealPupil(), coherentSource(), {
        pupilSamples: PUPIL_SAMPLES,
      });
      return bin(image.intensity, 2 * CYCLES).amplitude / bin(image.intensity, CYCLES).amplitude;
    };
    expect(readRatio(ruling(frame))).toBeCloseTo(sampledBarFundamental(PERIOD_PX) / 1, 12);
    expect(readRatio(cosineRuling(frame))).toBeCloseTo(0.25, 12);
  });
});

describe("§ 6ao.3 — the transfer belongs to the optics, and the 4/π to the specimen", () => {
  it("hands a bar and a cosine the same image/object ratio, coherent and at S = 0.5", () => {
    // The claim the whole step exists to make. The image's fundamental bin can
    // only be fed by pairs of transmitted orders one f apart, and a square wave
    // has no order at 2f, so that pair is (0, ±f) for BOTH objects — the same
    // aperture arithmetic, weighted the same way over the same source. So the
    // ratio image-f ÷ object-f is a property of the instrument, and everything
    // the edges did lives in the object's coefficient.
    const frame = frameAt();
    const transferOf = (specimen: Specimen, source: ReturnType<typeof coherentSource>) => {
      const object = rasterize(specimen, frame);
      const image = abbeImage(object, idealPupil(), source, { pupilSamples: PUPIL_SAMPLES });
      return {
        transfer: bin(image.intensity, CYCLES).amplitude / bin(object.re, CYCLES).amplitude,
        contrast: bin(image.intensity, CYCLES).contrast,
      };
    };

    for (const source of [coherentSource(), diskSource(0.5, 15)]) {
      const bars = transferOf(ruling(frame), source);
      const cosine = transferOf(cosineRuling(frame), source);
      expect(bars.transfer / cosine.transfer).toBeCloseTo(1, 12);
    }
  });

  it("and the two objects' contrast ratio is 1.078, which is why the rung is not written on it", () => {
    // The negative control for the paragraph in this file's header. The image
    // DC is not shared — the bar puts 2a₁² more into it — so contrast divides
    // the ratio that means something by a ratio that does not.
    const frame = frameAt();
    const source = diskSource(0.5, 15);
    const read = (specimen: Specimen) => {
      const object = rasterize(specimen, frame);
      const image = abbeImage(object, idealPupil(), source, { pupilSamples: PUPIL_SAMPLES });
      const f = bin(image.intensity, CYCLES);
      return { amplitude: f.amplitude, contrast: f.contrast, dc: f.dc };
    };
    const bars = read(ruling(frame));
    const cosine = read(cosineRuling(frame));

    // The object ratio the series predicts, as it is on this grid…
    const objectRatio = sampledBarFundamental(PERIOD_PX) / 0.25;
    expect(objectRatio).toBeCloseTo(1.3066, 4);
    // …which the imaged AMPLITUDES reproduce…
    expect(bars.amplitude / cosine.amplitude).toBeCloseTo(objectRatio, 12);
    // …and the contrasts do not, by a fifth.
    expect(bars.contrast / cosine.contrast).toBeCloseTo(1.0785, 3);
    expect(bars.dc / cosine.dc).toBeGreaterThan(1.2);
  });

  it("and 4/π is what the ratio becomes when the ruler is taken out of it", () => {
    // The external number, finally, with the sampling divided out: the ratio on
    // the grid is 1.3066 because the grid's own coefficient is 2.6% high, and
    // the same measurement on a period four times as long is 1.2773 — within
    // 0.3% of 4/π and heading there as p².
    expect((2 * sampledBarFundamental(8)) / 0.5).toBeCloseTo(1.3066, 4);
    expect((2 * sampledBarFundamental(32)) / 0.5).toBeCloseTo(4 / Math.PI, 2);
    expect(Math.abs((2 * sampledBarFundamental(32)) / 0.5 - 4 / Math.PI)).toBeLessThan(0.005);
  });
});

describe("§ 6ao.4 — partial coherence keeps the fundamental and moves the second harmonic", () => {
  it("leaves 2f/f at 0.270 where the coherent closed form says 0.327", () => {
    // Where § 6ao.2's arithmetic stops. The fundamental bin is fed by the pair
    // (0, ±f) and the second-harmonic bin by (−f, +f), and those two pairs
    // overlap DIFFERENT areas of the shifted pupil as the source point moves —
    // so a condenser weights them differently and the |a₀ + 2a₁cos|² expansion,
    // which assumed one direction, no longer holds at 2f. It still holds at f,
    // which is § 6ao.3: the transfer is shared, the expansion is not.
    const frame = frameAt();
    const object = rasterize(ruling(frame));
    const coherent = abbeImage(object, idealPupil(), coherentSource(), {
      pupilSamples: PUPIL_SAMPLES,
    });
    const partial = abbeImage(object, idealPupil(), diskSource(0.5, 15), {
      pupilSamples: PUPIL_SAMPLES,
    });
    const ratioOf = (intensity: Float64Array) =>
      bin(intensity, 2 * CYCLES).amplitude / bin(intensity, CYCLES).amplitude;

    expect(ratioOf(coherent.intensity)).toBeCloseTo(sampledBarFundamental(PERIOD_PX), 12);
    expect(ratioOf(partial.intensity)).toBeCloseTo(0.2704, 3);
    // A fifth apart, so this is the condenser and not a rounding.
    expect(ratioOf(coherent.intensity) / ratioOf(partial.intensity)).toBeGreaterThan(1.2);
    // And 3f is still absent, because no aperture in either case carried it.
    expect(bin(partial.intensity, 3 * CYCLES).amplitude).toBeLessThan(1e-14);
  });
});


/**
 * ## The picture half
 *
 * Everything above is a ruling: unbounded, one frequency, read in one Fourier
 * bin. What a chart has that a ruling has not is **ends** and a **direction**,
 * and a single bin can see neither. The frame below is the same physical field
 * seen at twice the sampling — `size` 128 against `pupilSamples` 24, so the
 * object pixel is 0.548 µm — because a picture rung reads intensity at a
 * position rather than a coefficient at a bin, and a position wants samples.
 *
 * **Where the readouts are taken, and why it is not arbitrary.** A bar's centre
 * and the centres of the gaps beside it are what a microscopist compares, so
 * those are the points sampled — never a window that also contains the clear
 * field around the element, which reports the element's silhouette against the
 * background and not whether its bars are separated at all. The first draft of
 * § 6ao.8 did exactly that and reported 0.77 contrast for an element the
 * aperture had nearly erased.
 */
const SIZE_PICTURE = 128;
const PUPIL_PICTURE = 24;
let PICTURE_FRAME: ObjectFieldFrame | undefined;
const pictureFrame = (): ObjectFieldFrame =>
  (PICTURE_FRAME ??= objectFieldFrame(SYSTEM, {
    size: SIZE_PICTURE,
    pupilSamples: PUPIL_PICTURE,
    wavelengthNm: LAMBDA,
  }));

/** Object-space NA of the shipped DIN 4×, and the lengths it sets. */
const NA = 0.1005;
/** The coherent cutoff as a frequency: NA/λ, in cycles per mm. */
const CUTOFF_CYCLES_PER_MM = NA / (LAMBDA * 1e-6);
/** …and the coherent resolution as a length, in object mm. */
const LAMBDA_OVER_NA_MM = (LAMBDA * 1e-6) / NA;

const rasterizePicture = (specimen: Specimen): ObjectField =>
  rasterizeSpecimen(SYSTEM, pictureFrame(), specimen, { map: "uniform" });

/** Image of a picture-frame specimen, with the aperture as the only limit. */
const imagePicture = (specimen: Specimen, source = coherentSource()) =>
  abbeImage(rasterizePicture(specimen), idealPupil(), source, { pupilSamples: PUPIL_PICTURE });

/** One pixel of a picture-frame image. */
const pixel = (intensity: Float64Array, ix: number, iy: number) =>
  intensity[iy * SIZE_PICTURE + ix]!;

/** Darkest-wins composition: two chrome patterns on the same piece of glass. */
const overlay =
  (...parts: readonly Specimen[]): Specimen =>
  (x, y) => {
    let re = 1;
    for (const part of parts) re = Math.min(re, part(x, y).re);
    return { re, im: 0 };
  };

/**
 * An element placed by PIXELS, on the picture frame.
 *
 * The centre lands on a sample and the bar width is an odd number of pixels, so
 * every bar centre and every gap centre is a sample and every bar EDGE is a
 * half-integer. Both halves of that matter and for opposite reasons: a readout
 * wants centres on samples, and `barTarget`'s header wants edges off them.
 */
const elementAtPixels = (
  barWidthPx: number,
  offsetPx = 0,
  options: { bars?: number; orientation?: "vertical" | "horizontal" } = {},
): Specimen => {
  const frame = pictureFrame();
  const scale = frame.objectPixelScaleMm;
  return barTarget({
    cyclesPerMm: 1 / (2 * barWidthPx * scale),
    centreMm: { x: frame.centreObjectMm.x + offsetPx * scale, y: frame.centreObjectMm.y },
    ...(options.bars === undefined ? {} : { bars: options.bars }),
    ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
  });
};

describe("§ 6ao.5 — the element is the chart's, not this engine's", () => {
  it("reproduces MIL-STD-150A's published frequency table", () => {
    // THE EXTERNAL NUMBER for the authoring code. The USAF 1951 ladder is
    // 2^(group + (element − 1)/6) line pairs per mm — six elements to an octave
    // — and every chart vendor's printed table is that formula rounded. Checked
    // against the printed rows rather than against the formula this engine
    // implements, which would be circular.
    const published: ReadonlyArray<readonly [number, number, number]> = [
      [0, 1, 1.0],
      [0, 2, 1.12],
      [0, 3, 1.26],
      [0, 4, 1.41],
      [0, 5, 1.59],
      [0, 6, 1.78],
      [2, 1, 4.0],
      [2, 2, 4.49],
      [7, 1, 128.0],
      [7, 4, 181.0],
      [7, 6, 228.1],
    ];
    for (const [group, element, cyclesPerMm] of published) {
      // The tables are printed to three significant figures, so three is what
      // is asserted: demanding more would be pinning someone's rounding.
      expect(Math.abs(usafFrequencyCyclesPerMm(group, element) / cyclesPerMm - 1)).toBeLessThan(
        5e-3,
      );
    }
    // The ladder's own structure: six elements is exactly an octave, so element
    // E of group G+1 is twice element E of group G, to the last bit.
    for (let element = 1; element <= 6; element++) {
      expect(
        usafFrequencyCyclesPerMm(4, element) / usafFrequencyCyclesPerMm(3, element),
      ).toBeCloseTo(2, 12);
    }
    expect(() => usafFrequencyCyclesPerMm(3, 7)).toThrow(/element/);
    expect(() => usafFrequencyCyclesPerMm(3.5, 1)).toThrow(/group/);
  });

  it("and the drawn element is three bars, five widths across and five along", () => {
    // The standard's geometry, read off the authored callback in millimetres
    // with no grid anywhere: bar width is half the period, the element starts
    // and ends on a bar so it spans five widths across, and its bars are five
    // widths long. Probed at a hundredth of a bar width, so an edge is located
    // to 1% of the feature it bounds.
    const cyclesPerMm = usafFrequencyCyclesPerMm(2, 1);
    const widthMm = 1 / (2 * cyclesPerMm);
    expect(widthMm).toBeCloseTo(0.125, 12);
    const element = barTarget({ cyclesPerMm, bars: 3 });
    const step = widthMm / 100;
    const opaqueAt = (across: number, along: number) => element(across, along).re === 0;

    // Across the bars: three opaque runs, two clear periods apart.
    const runStarts: number[] = [];
    let wasOpaque = false;
    for (let i = -400; i <= 400; i++) {
      const isOpaque = opaqueAt(i * step, 0);
      if (isOpaque && !wasOpaque) runStarts.push(i * step);
      wasOpaque = isOpaque;
    }
    expect(runStarts.length).toBe(3);
    expect(runStarts[1]! - runStarts[0]!).toBeCloseTo(2 * widthMm, 6);
    expect(runStarts[2]! - runStarts[1]!).toBeCloseTo(2 * widthMm, 6);

    // The element's own extent, across and along, in bar widths: the furthest
    // opaque point is half the extent, and both are 2.5 widths out.
    const furthestOpaque = (probe: (t: number) => boolean) => {
      let last = 0;
      for (let i = 0; i <= 800; i++) if (probe(i * step)) last = i * step;
      return last;
    };
    expect((2 * furthestOpaque((t) => opaqueAt(t, 0))) / widthMm).toBeCloseTo(5, 2);
    expect((2 * furthestOpaque((t) => opaqueAt(0, t))) / widthMm).toBeCloseTo(5, 2);
    // And the unbounded ruling really is unbounded — the negative control for
    // both of those, since the first draft of this rung measured the ruling by
    // accident and read five bars where the element has three.
    const ruled = barTarget({ cyclesPerMm });
    expect(ruled(40 * widthMm, 40 * widthMm).re).toBe(0);

    // Orientation is which way the bars RUN, so the horizontal element is the
    // vertical one transposed — the property § 6ao.6 then asks the optics for.
    const horizontal = barTarget({ cyclesPerMm, bars: 3, orientation: "horizontal" });
    for (const [x, y] of [
      [0.03, 0.11],
      [-0.2, 0.05],
      [0.31, -0.27],
      [0.0, 0.0],
    ] as const) {
      expect(horizontal(x, y).re).toBe(element(y, x).re);
    }
  });
});

describe("§ 6ao.6 — a round pupil has no preferred direction", () => {
  it("images a rotated element as the exact transpose of the original", () => {
    // What no ruling can ask and no closed form covers: a transposed axis, a
    // swapped index, a row-major slip anywhere between the specimen callback
    // and the intensity array. Every rung above is blind to all three, because
    // a vertical ruling read at bin (k, 0) says nothing whatever about y — and
    // `golden.test.ts` says in its own header that nothing in this suite pins
    // an image's orientation.
    //
    // The claim is exact rather than approximate — the same arithmetic in the
    // other order — so it is asserted near the floor and not at a picture
    // tolerance. It holds for a condenser too, which is a statement about
    // `diskSource`'s sampling as much as about the pupil: a source lattice
    // without four-fold symmetry would break this even through a round pupil.
    const vertical = elementAtPixels(7, 0, { bars: 3 });
    const horizontal = elementAtPixels(7, 0, { bars: 3, orientation: "horizontal" });

    for (const source of [coherentSource(), diskSource(0.5, 15)]) {
      const a = imagePicture(vertical, source).intensity;
      const b = imagePicture(horizontal, source).intensity;
      let worst = 0;
      let scale = 0;
      for (let iy = 0; iy < SIZE_PICTURE; iy++) {
        for (let ix = 0; ix < SIZE_PICTURE; ix++) {
          worst = Math.max(worst, Math.abs(pixel(a, ix, iy) - pixel(b, iy, ix)));
          scale = Math.max(scale, Math.abs(pixel(a, ix, iy)));
        }
      }
      expect(worst / scale).toBeLessThan(1e-13);
    }
  });

  it("and the transpose is a real constraint, not one any two images would pass", () => {
    // The negative control the rung above needs: compared WITHOUT transposing,
    // the same two images must differ loudly, or the assertion above is only
    // saying that both arrays are nearly uniform.
    const a = imagePicture(elementAtPixels(7, 0, { bars: 3 })).intensity;
    const b = imagePicture(elementAtPixels(7, 0, { bars: 3, orientation: "horizontal" })).intensity;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBeGreaterThan(0.1);
  });
});

describe("§ 6ao.7 — the ends of a bar are where a chart stops being a ruling", () => {
  it("runs flat down the middle of a bar and rings within λ/NA of its end", () => {
    // A ruling has nothing to say about the direction ALONG its bars: the
    // object does not vary there, so neither does the image, and the negative
    // control below measures exactly that — a column down the unbounded ruling
    // is constant to the last BIT, not merely to a tolerance. Every structure
    // in the profile that follows therefore belongs to the element's ends and
    // to nothing else.
    //
    // The scale of it is the instrument's, not the specimen's: λ/NA, the
    // coherent resolution, 10.7 object pixels against a bar 17.5 long.
    const frame = pictureFrame();
    const lambdaOverNaPx = LAMBDA_OVER_NA_MM / frame.objectPixelScaleMm;
    expect(lambdaOverNaPx).toBeCloseTo(10.7, 1);

    const centre = SIZE_PICTURE / 2;
    /** Five bar widths of seven pixels, halved — a half-integer, which is the
     *  point: the bar's END edge misses the sample grid the way its sides do. */
    const halfLengthPx = (5 * 7) / 2;
    const element = imagePicture(elementAtPixels(7, 0, { bars: 3 })).intensity;
    const unbounded = imagePicture(elementAtPixels(7)).intensity;

    // The control: no ends, no variation, bit for bit down the whole column.
    const ruled = pixel(unbounded, centre, centre);
    for (let iy = 0; iy < SIZE_PICTURE; iy++) {
      expect(pixel(unbounded, centre, iy)).toBe(ruled);
    }

    // The element's own column, in units of its value at the bar's centre.
    const middle = pixel(element, centre, centre);
    const along = (d: number) => pixel(element, centre, centre + d) / middle;

    // Flat in the middle — 5% of ripple over the inner four pixels, which is
    // the far end of the bar making itself felt a resolution width and a half
    // away, and not a claim that a coherent image is ever perfectly flat.
    for (let d = 0; d <= 4; d++) expect(Math.abs(along(d) - 1)).toBeLessThan(0.1);

    // How far in the end reaches: walk out until the profile leaves that 10%
    // band and call the rest of the bar the end's. Bracketed against λ/NA
    // rather than pinned, because the 10% is a choice and a different one moves
    // the answer by a pixel or two.
    let lastFlat = 0;
    for (let d = 0; d < halfLengthPx; d++) {
      if (Math.abs(along(d) - 1) >= 0.1) break;
      lastFlat = d;
    }
    const reachPx = halfLengthPx - lastFlat;
    expect(reachPx).toBeCloseTo(13.5, 6);
    expect(reachPx).toBeGreaterThan(0.7 * lambdaOverNaPx);
    expect(reachPx).toBeLessThan(2 * lambdaOverNaPx);

    // And what is inside that reach is the coherent edge's signature, which no
    // rung in this suite has looked at before: the dark bar OVERSHOOTS to 2.27
    // times the brightness of its own middle and then passes through a
    // near-perfect null, 0.054, on its way out to the clear field. The null is
    // an amplitude zero crossing — the sum of the transmitted orders changes
    // sign — so it is physics and not a rounding, and it is the thing that
    // makes a coherent picture look like a coherent picture.
    let brightest = 0;
    let darkest = Infinity;
    for (let d = 10; d < halfLengthPx; d++) {
      brightest = Math.max(brightest, along(d));
      darkest = Math.min(darkest, along(d));
    }
    expect(brightest).toBeGreaterThan(1.8);
    expect(darkest).toBeLessThan(0.1);
    // Beyond the end it is simply the clear field, forty times the bar.
    expect(along(30)).toBeGreaterThan(20);
  });
});

describe("§ 6ao.8 — three elements of a chart, and the one that lies", () => {
  /**
   * Bar widths in pixels, straddling the condenser's cutoff.
   *
   * Odd, so that bar centres and gap centres are samples while bar edges are
   * not — the picture half's header explains why both halves of that matter.
   */
  const LADDER = [7, 5, 3] as const;

  /** Michelson contrast between a bar's centre and the two gaps beside it. */
  const contrastOf = (intensity: Float64Array, barWidthPx: number, offsetPx: number) => {
    const centre = SIZE_PICTURE / 2;
    const bar = pixel(intensity, centre + offsetPx, centre);
    const gaps =
      (pixel(intensity, centre + offsetPx - barWidthPx, centre) +
        pixel(intensity, centre + offsetPx + barWidthPx, centre)) /
      2;
    return (gaps - bar) / (gaps + bar);
  };

  /** ν in units of the coherent cutoff, for a bar this many pixels wide. */
  const nuOf = (barWidthPx: number) =>
    1 / (2 * barWidthPx * pictureFrame().objectPixelScaleMm) / CUTOFF_CYCLES_PER_MM;

  it("draws the ladder, and does not draw the element past the cutoff", () => {
    // THE PICTURE. Three elements side by side on one piece of glass, the
    // frequency rising, and the aperture running out along the row.
    const offsets = [-40, 0, 40];
    const block = overlay(
      ...LADDER.map((barWidthPx, index) =>
        elementAtPixels(barWidthPx, offsets[index]!, { bars: 3 }),
      ),
    );
    const image = imagePicture(block, diskSource(0.5, 15));

    expect(nuOf(7)).toBeCloseTo(0.762, 2);
    expect(nuOf(5)).toBeCloseTo(1.067, 2);
    // The last one is past 1 + S, where a ruling of that period transmits
    // nothing at all.
    expect(nuOf(3)).toBeCloseTo(1.778, 2);
    expect(nuOf(3)).toBeGreaterThan(1.5);

    const contrasts = LADDER.map((barWidthPx, index) =>
      contrastOf(image.intensity, barWidthPx, offsets[index]!),
    );
    // Down the ladder: drawn as authored, drawn faintly, and then not drawn.
    expect(contrasts[0]!).toBeGreaterThan(0.9);
    expect(contrasts[1]!).toBeCloseTo(0.74, 1);
    expect(contrasts[0]!).toBeGreaterThan(contrasts[1]!);
    // Eight times down from the middle rung, which is the aperture running out
    // and not a gentle roll-off.
    expect(contrasts[1]! / Math.abs(contrasts[2]!)).toBeGreaterThan(7);

    // What is left of the finest element is not a faint copy of it. It comes
    // out at −0.089: NEGATIVE, its bars brighter than its gaps. § 6ao.8's third
    // rung is what decides how much that sign is worth.
    expect(contrasts[2]!).toBeLessThan(0);
    expect(Math.abs(contrasts[2]!)).toBeGreaterThan(0.02);
  });

  it("and the same period ruled without ends carries nothing, which is where the rest comes from", () => {
    // Whose fault the residual is. A three-bar element is the ruling times a
    // window five widths square, and a window five widths square has a spectrum
    // reaching about 0.4 of the frequency it multiplies — so an element at
    // ν = 1.78 still has skirts inside 1 + S, while the ruling it was cut from
    // has none. Remove the ends and the skirts go with them.
    const source = diskSource(0.5, 15);
    for (const [barWidthPx, bound] of [
      [7, 0.9],
      [5, 0.6],
    ] as const) {
      // Where the aperture carries the ruling, ends or no ends, the two agree.
      const element = contrastOf(
        imagePicture(elementAtPixels(barWidthPx, 0, { bars: 3 }), source).intensity,
        barWidthPx,
        0,
      );
      const ruled = contrastOf(
        imagePicture(elementAtPixels(barWidthPx), source).intensity,
        barWidthPx,
        0,
      );
      expect(element).toBeGreaterThan(bound);
      expect(Math.abs(element - ruled)).toBeLessThan(0.03);
    }

    // Past the cutoff they part company completely: the element shows bars and
    // the ruling reads flat. The ruling's residual is 1.3e−3 and it is the
    // GRID's, not the aperture's — a period of six pixels does not divide 128,
    // so the ruling wraps on a discontinuity and smears a little of itself
    // across the spectrum. That is why this is a ratio of sixty and not the
    // 1e−13 § 6an.8 gets from a commensurate one.
    const element = contrastOf(
      imagePicture(elementAtPixels(3, 0, { bars: 3 }), source).intensity,
      3,
      0,
    );
    const ruled = contrastOf(imagePicture(elementAtPixels(3), source).intensity, 3, 0);
    expect(ruled).toBeGreaterThan(0);
    expect(Math.abs(ruled)).toBeLessThan(2e-3);
    expect(Math.abs(element) / Math.abs(ruled)).toBeGreaterThan(20);
  });

  it("but the SIGN of what survives is the window's, not the aperture's", () => {
    // THE RUNG THAT DECIDES WHAT § 6ao.8 IS ENTITLED TO CLAIM, and it took the
    // headline away from the first draft of this step. "Past the cutoff a chart
    // element images INVERTED" rested on one geometry, and the perturbation
    // that tests it is the BAR COUNT — because the bar count is what sets the
    // skirt width the paragraph above invokes. Three bars is a 5w window
    // reaching ~0.4f, five is 9w reaching ~0.22f, seven is 13w reaching ~0.15f,
    // which is about what it takes to clear 1 + S at ν = 1.78.
    //
    // Past the cutoff the sign does NOT survive that sweep: −7.5e−2, −8.6e−3,
    // +1.0e−2, +6.6e−3, +1.3e−3 for three, five, seven, nine bars and the
    // ruling. So the inversion is real and it belongs to THIS element, not to
    // every element past the aperture's limit. What survives the sweep is the
    // magnitude: sixty times the ruling at three bars, falling toward it.
    const source = diskSource(0.5, 15);
    const past = [3, 5, 7, 9].map((bars) =>
      contrastOf(imagePicture(elementAtPixels(3, 0, { bars }), source).intensity, 3, 0),
    );
    const ruledPast = contrastOf(imagePicture(elementAtPixels(3), source).intensity, 3, 0);

    expect(past[0]!).toBeLessThan(0);
    expect(past[1]!).toBeLessThan(0);
    // …and then it is not negative any more, which is the whole finding.
    expect(past[2]!).toBeGreaterThan(0);
    expect(past[3]!).toBeGreaterThan(0);
    // Every one of them is still far above the ruling, and the largest is the
    // shortest element — the one whose window is widest in frequency.
    for (const contrast of past) expect(Math.abs(contrast)).toBeGreaterThan(3 * ruledPast);
    expect(Math.abs(past[0]!)).toBeGreaterThan(4 * Math.abs(past[1]!));
    expect(Math.abs(past[0]!) / ruledPast).toBeGreaterThan(50);

    // INSIDE the cutoff the same sweep is a non-event, which is the control
    // that makes the sweep above mean something: ends matter to an element the
    // aperture cannot carry and hardly at all to one it can. Monotone down to
    // the ruling, and the whole spread is 3.5%.
    const inside = [3, 5, 7, 9].map((bars) =>
      contrastOf(imagePicture(elementAtPixels(5, 0, { bars }), source).intensity, 5, 0),
    );
    const ruledInside = contrastOf(imagePicture(elementAtPixels(5), source).intensity, 5, 0);
    for (let i = 1; i < inside.length; i++) expect(inside[i]!).toBeLessThan(inside[i - 1]!);
    expect(inside[3]!).toBeGreaterThan(ruledInside);
    expect(inside[0]! / ruledInside - 1).toBeLessThan(0.05);
  });
});

describe("§ 6ao.9 — the star draws the cutoff as a disc", () => {
  const SPOKES = 18;

  /** Depth of the spoke pattern around a circle of the image, at radius r. */
  const ringModulation = (intensity: Float64Array, rPx: number) => {
    const samples = 8 * SPOKES;
    let dc = 0;
    let re = 0;
    let im = 0;
    for (let i = 0; i < samples; i++) {
      const theta = (2 * Math.PI * i) / samples;
      // Nearest sample, not an interpolation: an interpolant here would be a
      // resampling kernel inside the readout, and § 6n's header explains at
      // length why this branch keeps those out. The cost is jitter, which is
      // why the rung below brackets rather than pins.
      const v = pixel(
        intensity,
        Math.round(SIZE_PICTURE / 2 + rPx * Math.cos(theta)),
        Math.round(SIZE_PICTURE / 2 + rPx * Math.sin(theta)),
      );
      dc += v;
      re += v * Math.cos(SPOKES * theta);
      im += v * Math.sin(SPOKES * theta);
    }
    return (2 * Math.hypot(re, im)) / dc;
  };

  it("keeps its spokes outside the radius the local frequency predicts and loses them inside", () => {
    // The one target whose frequency is a function of position: at radius r the
    // star is a ruling of N/(2πr) cycles per mm, so a single exposure sweeps
    // the whole frequency axis and the instrument draws its own limit as the
    // grey disc in the middle. Every microscopist has seen this picture.
    //
    // It is a BRACKET and not a measurement, deliberately. The local-frequency
    // argument is a first-order approximation that degrades exactly where the
    // disc is — the period there is comparable with the radius — and the ring
    // readout above samples to the nearest pixel. Two independent reasons the
    // edge is fuzzy, so the rung asks only that the collapse happen in the
    // right place to within a factor.
    const frame = pictureFrame();
    const radiusMm = 50 * frame.objectPixelScaleMm;
    const star = siemensStar({
      spokes: SPOKES,
      radiusMm,
      centreMm: frame.centreObjectMm,
      hubMm: 2 * frame.objectPixelScaleMm,
    });
    const image = imagePicture(star, diskSource(0.5, 15));

    // Where the local frequency reaches the condenser's cutoff, 1 + S times the
    // coherent one — a length, from the star's own geometry and the pupil's.
    const cutoffCyclesPerMm = 1.5 * CUTOFF_CYCLES_PER_MM;
    const criticalPx = SPOKES / (2 * Math.PI * cutoffCyclesPerMm) / frame.objectPixelScaleMm;
    expect(criticalPx).toBeCloseTo(20.4, 0);

    // Well outside it the spokes are there…
    expect(ringModulation(image.intensity, 2.2 * criticalPx)).toBeGreaterThan(0.5);
    // …well inside it they are gone…
    expect(ringModulation(image.intensity, 0.5 * criticalPx)).toBeLessThan(0.05);
    // …and the crossing is monotone through the disc's edge rather than noisy,
    // which is what makes the grey disc an edge at all.
    const half = ringModulation(image.intensity, 2.2 * criticalPx) / 2;
    let crossingPx = 0;
    for (let rPx = 4; rPx <= 45; rPx++) {
      if (ringModulation(image.intensity, rPx) > half) {
        crossingPx = rPx;
        break;
      }
    }
    expect(crossingPx).toBeGreaterThan(0.6 * criticalPx);
    expect(crossingPx).toBeLessThan(2.2 * criticalPx);
  });
});

describe("§ 6ao.10 — the picture, committed", () => {
  /**
   * Regression, not validation — `golden.ts` and VALIDATION.md both insist, and
   * it holds here: a committed render proves the picture has not changed, never
   * that it was right. What makes these two trustworthy is § 6ao.1–.9, which
   * pinned the physics inside them before the files were written.
   *
   * They earn their place anyway, because they are the only artefacts in the
   * suite that a person can LOOK at and see the step's findings in: the finest
   * element visibly inverted, the star's grey disc, the ringing at the bar
   * ends. A number that says 8% inversion and a picture that shows bars where
   * gaps should be are not the same evidence.
   */
  const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");
  /** Nearest-neighbour pixel replication, so a 128² frame can be looked at. */
  const ZOOM = 3;

  /**
   * Object and image side by side, as grey on the shipped sRGB curve.
   *
   * Exposure is 1 and nothing is auto-scaled: clear glass images at unit
   * intensity, so white in these files means "as bright as no specimen at all"
   * rather than "the brightest pixel here". An auto-exposure would hide exactly
   * the thing § 6ao.8 found, since an inverted element is still a perfectly
   * contrasty picture once it has been normalized.
   */
  const panels = (object: ObjectField, intensity: Float64Array) => {
    const gap = 4;
    const width = 2 * SIZE_PICTURE + gap;
    const rgba = new Uint8ClampedArray(width * ZOOM * SIZE_PICTURE * ZOOM * 4);
    const put = (px: number, py: number, value: number) => {
      const grey = 255 * encodeGamma(Math.min(1, Math.max(0, value)));
      for (let dy = 0; dy < ZOOM; dy++) {
        for (let dx = 0; dx < ZOOM; dx++) {
          const o = ((py * ZOOM + dy) * width * ZOOM + px * ZOOM + dx) * 4;
          rgba[o] = grey;
          rgba[o + 1] = grey;
          rgba[o + 2] = grey;
          rgba[o + 3] = 255;
        }
      }
    };
    for (let iy = 0; iy < SIZE_PICTURE; iy++) {
      for (let ix = 0; ix < SIZE_PICTURE; ix++) {
        // The specimen as it would meter: transmitted intensity is |t|².
        const t = object.re[iy * SIZE_PICTURE + ix]!;
        put(ix, iy, t * t);
        for (let g = 0; g < gap; g++) put(SIZE_PICTURE + g, iy, 0.5);
        put(SIZE_PICTURE + gap + ix, iy, intensity[iy * SIZE_PICTURE + ix]!);
      }
    }
    return { rgba, width: width * ZOOM, height: SIZE_PICTURE * ZOOM };
  };

  it("draws the three-element chart the way § 6ao.8 measured it", () => {
    const offsets = [-40, 0, 40];
    const block = overlay(
      ...[7, 5, 3].map((barWidthPx, index) =>
        elementAtPixels(barWidthPx, offsets[index]!, { bars: 3 }),
      ),
    );
    const object = rasterizePicture(block);
    const image = abbeImage(object, idealPupil(), diskSource(0.5, 15), {
      pupilSamples: PUPIL_PICTURE,
    });
    const { rgba, width, height } = panels(object, image.intensity);
    checkGoldenIn("usaf-block", rgba, width, height, { dir: GOLDEN_DIR });
  });

  it("and the star with its cutoff disc", () => {
    const frame = pictureFrame();
    const star = siemensStar({
      spokes: 18,
      radiusMm: 50 * frame.objectPixelScaleMm,
      centreMm: frame.centreObjectMm,
      hubMm: 2 * frame.objectPixelScaleMm,
    });
    const object = rasterizePicture(star);
    const image = abbeImage(object, idealPupil(), diskSource(0.5, 15), {
      pupilSamples: PUPIL_PICTURE,
    });
    const { rgba, width, height } = panels(object, image.intensity);
    checkGoldenIn("siemens-star", rgba, width, height, { dir: GOLDEN_DIR });
  });
});
