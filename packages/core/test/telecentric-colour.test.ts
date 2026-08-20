import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { paraxialImageOffset } from "../src/analysis/focus";
import { pupils } from "../src/pupil/pupils";
import { lateralMagnification } from "../src/pupil/microscope";
import { objectFieldTile } from "../src/imaging/object-field";
import { imageHarmonic } from "../src/illumination/abbe";
import { diskSource } from "../src/illumination/source";
import {
  brightfieldSpectralStack,
  formBrightfieldPlane,
} from "../src/imaging/brightfield-spectrum";
import { colorImageFromStack, pixelXyz } from "../src/imaging/image";
import { chromaticity, spectrumToXyz, type Chromaticity } from "../src/photometry/cmf";
import { spectralSamples, spectralXyz } from "../src/photometry/spectrum";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";
import type { SpectralSpecimen } from "../src/imaging/specimen";
import type { WavelengthSample } from "../src/trace/system";

/**
 * Step 6an — colour through a telecentric frame.
 *
 * § 6al's own "not yet pinned" list opens with it: *every render there is
 * monochromatic at the d line; § 6r's polychromatic path exists and would
 * compose, but "the image is right" has not been asked of a spectrum through
 * this branch.* So this step asks it, on § 6aj's fixture unchanged, and **no new
 * engine code**: `packages/core` is byte-for-byte what § 6am left.
 *
 * What composing them turns up is that **telecentricity is a single-wavelength
 * property**, and everything here is downstream of that sentence. The exit pupil
 * is at infinity because the stop sits at the tail's front focal point; a front
 * focal point is a distance divided by a power and a power is dispersive, so the
 * stop is at the front focal point of exactly one wavelength. Either side of it
 * the exit pupil is at a finite distance — and on OPPOSITE SIDES of the image
 * plane, because the pole is crossed rather than approached. So § 6al.6's
 * bitwise invariance of the ruler under defocus is bitwise at one wavelength,
 * and at every other one the sensor's position rescales the picture by 1 + δ/R(λ)
 * with a sign that reverses across the design wavelength. Defocus makes lateral
 * colour, out of a system with no lateral colour in focus.
 *
 * ## The external numbers
 *
 *  - **Newton's relation with the thick-lens focal length and principal planes**,
 *    evaluated on Sellmeier's n(λ) and nothing traced, for where the exit pupil
 *    is at each wavelength (§ 6an.3) — and hence for the defocus rescale
 *    coefficient 1/R(λ) the traced magnification is measured against (§ 6an.4).
 *  - **The stop's own geometry**, r_stop/z_stop = 2/400, read off the
 *    prescription: the product of two traced solves has to equal it, which is
 *    what makes the object-side ruler achromatic (§ 6an.2).
 *  - **Fresnel at normal incidence over the band**, through the CIE 1931
 *    observer at 1 nm — a colour rather than a level, so this is § 6al.1's
 *    "nothing invents light" rung asked in a way a grey image cannot answer
 *    (§ 6an.6), and the same integral over a Beer–Lambert stain (§ 6an.7).
 *  - **Abbe's limit λ/(NA_obj + NA_cond)**, which is ∝ λ, so ONE grating ruled in
 *    millimetres is inside the blue limit and exactly ON the red one (§ 6an.8).
 *
 * ## The band is not the visible band, and the engine is what says so
 *
 * A singlet has axial colour, and this one has a great deal: its focal length
 * runs 52.35 → 53.33 mm across 480…700 nm, against an image distance of 156 mm.
 * The sensor is at the d-line focus and cannot be anywhere else, so every other
 * wavelength arrives defocused, and `illumination/fidelity` — which for
 * brightfield **refuses** rather than falling back (ARCHITECTURE.md), there being
 * no ray analog of a coherent sum to cross-fade to — declines the blue end.
 *
 * § 6an.1 pins where it declines and why, and every colour rung below runs inside
 * that band. This is the honest shape for the step: the refusal is a measurement
 * of the fixture, and a colour rung run through a plane the engine has refused
 * would be a picture of the sampling rather than of the optics.
 */

const STOP_R = 2;
const OBJECT_DISTANCE = 400;

/** § 6aj's fixture, unchanged — the same thick asymmetric singlet as § 6al's. */
const LENS_FRONT = {
  kind: "refract" as const,
  curvature: 1 / 40,
  semiAperture: 20,
  thickness: 9,
  medium: "N-BK7",
};
const lensBack = (medium: string, thickness: number) => ({
  kind: "refract" as const,
  curvature: -1 / 80,
  semiAperture: 20,
  thickness,
  medium,
});
const group = (medium: string): Prescription => ({ surfaces: [LENS_FRONT, lensBack(medium, 0)] });

/** The tail's front focal distance AT THE D LINE — where the stop goes. */
const frontFocalDistance = (): number => {
  const g = group("AIR");
  const c = paraxialTrace(g, LINE_D, { y: 1, u: 0 }).u;
  const d = paraxialTrace(g, LINE_D, { y: 0, u: 1 }).u;
  return -d / c;
};
const FFD = frontFocalDistance();

const finiteAt = (gap: number, defocus = 0): OpticalSystem => {
  const base: OpticalSystem = {
    prescription: {
      surfaces: [
        {
          kind: "refract",
          curvature: 0,
          semiAperture: 30,
          thickness: gap,
          medium: "AIR",
          isStop: true,
        },
        LENS_FRONT,
        lensBack("AIR", 100),
      ],
    },
    aperture: { kind: "stopRadius", value: STOP_R },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance: OBJECT_DISTANCE },
  };
  return {
    ...base,
    imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, LINE_D) + defocus },
  };
};

const TELECENTRIC = finiteAt(FFD);

const SIZE = 32;
const PUPIL_SAMPLES = 16;
const S = 0.5;
const SOURCE = diskSource(S, 15);
const MOD = 0.02;
const ORIGIN = { x: 0, y: 0 } as const;
/** § 6al's probe height, so the magnifications here are its magnifications. */
const PROBE_MM = OBJECT_DISTANCE * 1e-4;

/** The honest band § 6an.1 measures. Every colour rung below runs inside it. */
const BAND = { fromNm: 480, toNm: 700 } as const;

const N_BK7 = getMedium("N-BK7");
/** Fresnel at normal incidence, twice — § 6al.1's number as a function of λ. */
const fresnelTransmittance = (nm: number): number => {
  const n = N_BK7.n(nm);
  return (1 - ((n - 1) / (n + 1)) ** 2) ** 2;
};

const tileAt = (nm: number, system: OpticalSystem = TELECENTRIC) =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PUPIL_SAMPLES,
    wavelengthNm: nm,
    centreMm: ORIGIN,
  });

const planeAt = (specimen: SpectralSpecimen, nm: number, system: OpticalSystem = TELECENTRIC) =>
  formBrightfieldPlane(
    system,
    specimen,
    SOURCE,
    {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      samples: [{ nm, weight: 1 }],
      map: "uniform",
      patches: 1,
    },
    { nm, weight: 1 },
    ORIGIN,
  );

const CLEAR: SpectralSpecimen = () => ({ re: 1, im: 0 });

/** t(x) = 1 + m·cos(2πx/period), in **object millimetres** and λ-independent. */
const cosineMm =
  (periodMm: number): SpectralSpecimen =>
  (xMm) => ({ re: 1 + MOD * Math.cos((2 * Math.PI * xMm) / periodMm), im: 0 });

const stackOver = (
  specimen: SpectralSpecimen,
  samples: readonly WavelengthSample[],
  system: OpticalSystem = TELECENTRIC,
) =>
  brightfieldSpectralStack(system, specimen, SOURCE, {
    size: SIZE,
    pupilSamples: PUPIL_SAMPLES,
    samples,
    map: "uniform",
    patches: 1,
  });

/** 31 wavelengths of an equal-energy lamp across the honest band. */
const LAMP = spectralSamples(() => 1, { count: 31, ...BAND });

/** The wavefront per pupil sample at the band's blue edge — § 6an.1's number. */
const PHASE_STEP_AT_BAND_EDGE = 0.3170573468954293;

/** A traced spectral stack costs ~2.5 s at 31 planes, so each is built once. */
const memo = <T,>(build: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= build());
};

const centreChromaticity = (
  stack: ReturnType<typeof brightfieldSpectralStack>,
): Chromaticity => {
  const image = colorImageFromStack(stack);
  return chromaticity(pixelXyz(image, stack.size >> 1, stack.size >> 1));
};

const distance = (a: Chromaticity, b: Chromaticity): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The same colour computed off the engine entirely: a spectrum, at 1 nm. */
const closedFormChromaticity = (spectralPower: (nm: number) => number): Chromaticity =>
  chromaticity(spectrumToXyz(spectralPower, { ...BAND, stepNm: 1 }));

/**
 * The thick-lens tail, in closed form: focal length, principal planes, and hence
 * the exit pupil by Newton's relation. Sellmeier's n(λ) is the only input, and
 * nothing here is traced — this is the external route § 6an.3 and § 6an.4 use.
 */
function closedFormTail(nm: number) {
  const R1 = 40;
  const R2 = -80;
  const d = 9;
  const n = N_BK7.n(nm);
  const f = 1 / ((n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * d) / (n * R1 * R2)));
  // Distances of the principal planes from their own vertices (Hecht 6.2).
  const frontPrincipal = (-f * (n - 1) * d) / (R2 * n);
  const backPrincipal = (-f * (n - 1) * d) / (R1 * n);
  // On the engine's axis, where the stop is z = 0 and the front vertex z = FFD.
  const frontFocus = FFD + frontPrincipal - f;
  const backFocus = FFD + d + backPrincipal + f;
  // Newton: the stop is at z = 0, so its distance from the front focal point is
  // −frontFocus, and the image sits f²/that beyond the back focal point.
  return { n, f, frontFocus, backFocus, exitZ: backFocus + (f * f) / frontFocus };
}

/** Where the sensor is, on the same axis: last VERTEX plus the solved offset. */
const IMAGE_Z = FFD + 9 + paraxialImageOffset(TELECENTRIC, LINE_D);

describe("§ 6an.1 — the honest band, and why the blue end is refused", () => {
  it("the fixture's axial colour is large, and the sensor can only be at one focus", () => {
    // The premise of the whole step, as a number rather than an adjective.
    const blue = closedFormTail(480);
    const red = closedFormTail(700);
    expect(blue.f).toBeCloseTo(52.352663913167184, 12);
    expect(red.f).toBeCloseTo(53.33163694963007, 12);
    // Nearly a millimetre of focal length across the band, on a tail of 53 mm —
    // which against an image distance of 156 mm is millimetres of focus shift.
    expect(red.f - blue.f).toBeCloseTo(0.9789730364628824, 12);
  });

  it("so `illumination/fidelity` refuses below 480 nm — measured, not assumed", () => {
    // The refusal is a property of THIS fixture and this pupil sampling, and it
    // is what sets `BAND`. Brightfield has no geometric branch to fall back to
    // (ARCHITECTURE.md), so a plane the criterion declines is not a worse
    // picture — it is no picture, and every colour rung below stays inside.
    const refused = planeAt(CLEAR, 470);
    expect(refused.fidelity.verdict).toBe("no-honest-image");
    expect(refused.fidelity.phaseStepWaves).toBeCloseTo(0.3605176139086672, 12);

    const honest = planeAt(CLEAR, BAND.fromNm);
    expect(honest.fidelity.verdict).toBe("valid");
    expect(honest.fidelity.phaseStepWaves).toBeCloseTo(PHASE_STEP_AT_BAND_EDGE, 12);

    // The red end is honest a long way past the band the observer is defined on:
    // the defocus in waves is set by n(λ), whose slope is steep in the blue and
    // nearly flat in the red, so the two ends are not symmetric about the d line.
    expect(planeAt(CLEAR, BAND.toNm).fidelity.verdict).toBe("valid");
    expect(planeAt(CLEAR, 800).fidelity.verdict).toBe("valid");
  });

  it("and a stack over the visible band carries the worst plane's verdict", () => {
    // The stack does not average a refusal away — § 6r's contract, exercised
    // here for the reason it exists. This is also the negative control for
    // `BAND`: had the whole visible band been honest, the choice would be
    // arbitrary rather than measured.
    const wide = stackOver(CLEAR, spectralSamples(() => 1, { count: 9, fromNm: 400, toNm: 700 }));
    expect(wide.fidelity?.verdict).toBe("no-honest-image");

    const inside = stackOver(CLEAR, spectralSamples(() => 1, { count: 9, ...BAND }));
    expect(inside.fidelity?.verdict).toBe("valid");
  });
});

describe("§ 6an.2 — the object-side ruler is achromatic, and its number is authored", () => {
  it("λ divides out of the object pixel, because slope × magnification is the stop's own geometry", () => {
    // THE EXTERNAL NUMBER, and it is not a measurement at all: the marginal ray
    // from the axial object point leaves at r_stop/z_stop, a ratio of two
    // authored lengths with no glass in it. Lagrange then fixes the image-side
    // slope as that divided by the magnification, so
    //
    //     slopeRadius(λ) · |M(λ)| = r_stop / z_stop
    //
    // with the left side two independent traced solves — the exit pupil's slope
    // out of `opdMap`, the magnification out of a traced probe ray — and the
    // right side arithmetic on the prescription.
    const authored = STOP_R / OBJECT_DISTANCE;
    expect(authored).toBe(0.005);

    for (const nm of [480, 550, LINE_D, 620, 700]) {
      const tile = tileAt(nm);
      const magnification = Math.abs(lateralMagnification(TELECENTRIC, PROBE_MM, nm));
      // The frame reports a slope only where the exit pupil is at infinity, which
      // § 6an.3 shows is one wavelength. So the slope is read off the pupil, where
      // it exists on both branches as exitRadius/referenceRadius.
      const p = pupils(TELECENTRIC, nm);
      // The MAGNITUDE, because § 6an.3 puts the exit pupil on either side of the
      // image plane depending on which side of the design wavelength λ is: the
      // marginal ray's slope is |radius| over |distance| whichever way it goes.
      const slope = p.exit.slopeRadius ?? Math.abs(p.exit.radius / (IMAGE_Z - p.exit.z));
      expect(Math.abs((slope * magnification) / authored - 1)).toBeLessThan(3e-8);
      expect(tile.objectPixelScaleMm).toBeGreaterThan(0);
    }
  });

  it("so the object pixel is exactly proportional to λ, to 2e−8 across the band", () => {
    // The consequence, and the one a caller sees: at fixed `size` and
    // `pupilSamples` the frame covers the same object in every colour up to the
    // λ that is in the diffraction limit itself. The closed form has no traced
    // quantity in it.
    const closedForm = (nm: number) =>
      (nm * 1e-6 * PUPIL_SAMPLES) / (2 * SIZE * (STOP_R / OBJECT_DISTANCE));

    for (const nm of [480, 520, 550, LINE_D, 620, 660, 700]) {
      const tile = tileAt(nm);
      expect(Math.abs(tile.objectPixelScaleMm / closedForm(nm) - 1)).toBeLessThan(2.2e-8);
    }

    // And the residual is very nearly a constant rather than a drift: it is the
    // traced slope's departure from the paraxial one, and what little λ it
    // carries is the probe ray's own trace. So the RATIO of two object pixels is
    // λ-proportional an order better than either is absolutely — 1.1e−9 across
    // the band, which is the floor § 6al.6 recorded for this probe.
    const blue = tileAt(480).objectPixelScaleMm;
    const red = tileAt(700).objectPixelScaleMm;
    expect(Math.abs(red / blue - 700 / 480)).toBeLessThan(2e-9);
  });

  it("but the IMAGE-side ruler is not — it carries the magnification's chromatism", () => {
    // The same statement read at the other end, and labelled as such: the image
    // pixel is the object pixel times |M(λ)|, so it is λ-proportional times a
    // 1.8% dispersion term. This is not an independent measurement of anything —
    // `objectPixelScaleMm` IS `pixelScaleMm / |M|` — and it is here because it is
    // the quantity § 6an.5's stack has to reconcile.
    const blue = tileAt(480);
    const red = tileAt(700);
    const magnificationRatio =
      Math.abs(lateralMagnification(TELECENTRIC, PROBE_MM, 700)) /
      Math.abs(lateralMagnification(TELECENTRIC, PROBE_MM, 480));
    expect(magnificationRatio).toBeGreaterThan(1.01);
    expect(Math.abs(red.pixelScaleMm / blue.pixelScaleMm / ((700 / 480) * magnificationRatio) - 1))
      .toBeLessThan(1e-9);
  });
});

describe("§ 6an.3 — telecentricity holds at exactly one wavelength", () => {
  it("the exit pupil is at infinity only at the d line, and is signed either side", () => {
    // The stop was placed at the tail's front focal distance AT THE D LINE, and
    // that is the whole of the design: at any other wavelength the stop is no
    // longer at a focal point and its image is no longer at infinity.
    expect(tileAt(LINE_D).scale.exitRadius).toBe(Infinity);
    expect(tileAt(LINE_D).scale.slopeRadius).toBe(0.03776953728795632);

    for (const nm of [480, 550, 620, 700]) {
      expect(Number.isFinite(tileAt(nm).scale.exitRadius)).toBe(true);
      expect(tileAt(nm).scale.slopeRadius).toBeUndefined();
    }

    // And the pole is CROSSED, not approached: the exit pupil is real and far
    // behind the image on the blue side and virtual and far in front on the red.
    // That sign is the whole of § 6an.4.
    expect(pupils(TELECENTRIC, 550).exit.z).toBeGreaterThan(IMAGE_Z);
    expect(pupils(TELECENTRIC, 620).exit.z).toBeLessThan(0);
  });

  it("and where it is, is Newton's relation on Sellmeier's n(λ) — nothing traced", () => {
    // THE EXTERNAL NUMBER. The thick-lens focal length and principal planes are
    // textbook arithmetic on three curvatures, one thickness and one index; the
    // stop's image is Newton's f²; the engine's exit pupil comes out of the
    // paraxial matrix. They agree to the last few bits, on both sides of a pole
    // that carries the quantity to 2.6e5 mm.
    for (const nm of [480, 500, 550, 585, 590, 620, 660, 700]) {
      const closed = closedFormTail(nm);
      const traced = pupils(TELECENTRIC, nm).exit.z;
      expect(Math.abs(closed.exitZ / traced - 1)).toBeLessThan(1e-11);
    }

    // The pole is where the closed form's own front focal point reaches the
    // stop, which is the d line by construction — so the design wavelength is
    // authored rather than discovered, and this is the statement of that.
    expect(closedFormTail(LINE_D).frontFocus).toBeCloseTo(0, 12);
    // Blue's focal length is the shorter one, so blue's front focal point lies
    // PAST the stop and red's short of it. That is the sign the pole is crossed
    // with, and § 6an.4 is the same sign seen in a picture.
    expect(closedFormTail(480).frontFocus).toBeCloseTo(0.5924341513672573, 12);
    expect(closedFormTail(700).frontFocus).toBeCloseTo(-0.3741530295928399, 12);
  });
});

describe("§ 6an.4 — so the sensor's position rescales every colour but one", () => {
  it("the magnification moves as 1 + δ/R(λ), exactly linear in δ", () => {
    // § 6al.6 pinned that this fixture's magnification does not move with the
    // sensor. It pinned it at ONE wavelength. Here it is at four, and the
    // coefficient is the reciprocal of the exit-pupil-to-image distance the
    // closed form above gives — R = IMAGE_Z − exitZ, positive when the pupil
    // precedes the image, which is § 6al.6's own 98.27 mm sign.
    for (const nm of [480, 550, 620, 700]) {
      const R = IMAGE_Z - closedFormTail(nm).exitZ;
      const base = lateralMagnification(TELECENTRIC, PROBE_MM, nm);
      let slope = NaN;
      for (const delta of [0.5, 1, 2]) {
        const moved = lateralMagnification(finiteAt(FFD, delta), PROBE_MM, nm);
        const measured = (moved / base - 1) / delta;
        // Linear in δ to the last bits — a rescale, not a blur term.
        if (Number.isNaN(slope)) slope = measured;
        else expect(Math.abs(measured / slope - 1)).toBeLessThan(1e-11);
        expect(Math.abs(measured * R - 1)).toBeLessThan(1e-5);
      }
    }
  });

  it("and the sign reverses across the design wavelength, which is what a pole does", () => {
    // The claim a picture would show: inside focus a defocused edge fringes one
    // way and outside it the other, with the reversal AT the design wavelength
    // rather than at the middle of the band. Nothing here is coded for — it
    // falls out of the exit pupil crossing infinity.
    const shiftAt = (nm: number, delta: number) =>
      lateralMagnification(finiteAt(FFD, delta), PROBE_MM, nm) /
        lateralMagnification(TELECENTRIC, PROBE_MM, nm) -
      1;

    expect(shiftAt(480, 1)).toBeLessThan(-1e-5);
    expect(shiftAt(550, 1)).toBeLessThan(-1e-5);
    expect(shiftAt(620, 1)).toBeGreaterThan(1e-5);
    expect(shiftAt(700, 1)).toBeGreaterThan(1e-5);

    // At the design wavelength it is the probe ray's own noise floor and not a
    // defocus term: 4e−10 over a millimetre, against 2.5e−4 at 480 nm.
    expect(Math.abs(shiftAt(LINE_D, 1))).toBeLessThan(1e-9);
    expect(Math.abs(shiftAt(480, 1))).toBeGreaterThan(2e-4);

    // Reversing the sensor's travel reverses the colour, which is the statement
    // that this is a rescale about a pole and not an aberration of one sign.
    expect(shiftAt(480, -1) * shiftAt(480, 1)).toBeLessThan(0);
  });

  it("so a defocused frame has lateral colour that focus alone removes", () => {
    // Said as the quantity a caller would see: the ratio of the blue and red
    // magnifications, which is 1 to nine digits in focus and 5e−4 out of it.
    const chromaticRatio = (delta: number) =>
      lateralMagnification(finiteAt(FFD, delta), PROBE_MM, 480) /
      lateralMagnification(finiteAt(FFD, delta), PROBE_MM, 700);

    const focused = chromaticRatio(0);
    const defocused = chromaticRatio(1);
    expect(Math.abs(defocused / focused - 1)).toBeGreaterThan(3e-4);
    // In focus the two colours share a ruler to the probe's floor: the frame
    // has no lateral colour of its own, which is why the defocused one is the
    // sensor's doing and not the lens's.
    expect(Math.abs(chromaticRatio(0) / chromaticRatio(1e-9) - 1)).toBeLessThan(1e-12);
  });
});

describe("§ 6an.5 — the branch switch at the pole is removable", () => {
  it("the pixel scale walks through infinity without a step", () => {
    // `imagePixelScaleMm` has two formulas — one off `exitRadius/referenceRadius`
    // and one off `slopeRadius` — and this fixture takes the second at exactly
    // one wavelength. A discontinuity there would be a seam in every spectral
    // stack, and it would look like optics. So: within 0.01 nm of the pole the
    // reference sphere runs to 5.7e7 mm and the two formulas still agree, and
    // the object pixel per nanometre is constant to twelve digits ACROSS the
    // switch.
    const probes = [587.0, 587.5, 587.55, LINE_D, 587.57, 587.6, 588.0];
    const perNm = probes.map((nm) => tileAt(nm).objectPixelScaleMm / nm);
    const first = perNm[0]!;
    // 5e−12 is the traced probe's floor and not a slack: § 6an.2 measures the
    // same ruler holding to 1.1e−9 over 220 nm, so a step at the pole would have
    // to be smaller than a part in 2e11 to hide here.
    for (const v of perNm) expect(Math.abs(v / first - 1)).toBeLessThan(5e-12);

    // The switch really is exercised: the neighbours are on the finite branch
    // with a reference radius five orders larger than the system is long.
    expect(tileAt(587.55).scale.referenceRadius).toBeGreaterThan(5e7);
    expect(tileAt(LINE_D).scale.referenceRadius).toBe(1);
    expect(tileAt(587.57).scale.referenceRadius).toBeGreaterThan(8e7);
  });
});

describe("§ 6an.6 — a clear field's colour is the lamp's, tinted by Fresnel's dispersion", () => {
  const clearStack = memo(() => stackOver(CLEAR, LAMP));

  it("carries the spectrum through the imaging chain to 5e-11", () => {
    // § 6al.1's rung was a LEVEL, and a level is one number: it catches light
    // going missing, but not light going missing wavelength by wavelength. This
    // is the same claim asked in colour, and it is asked in two halves because
    // the two halves have residuals four orders apart.
    //
    // THE IMAGING HALF. The spectrum that comes out of the frames, the pupils,
    // the Abbe sums and the stack is the spectrum that went in: the rendered
    // chromaticity is what the SAME observer gives for (1 − R(λ))² evaluated
    // straight off Sellmeier, with no optics between them at all.
    const stack = clearStack();
    expect(stack.fidelity?.verdict).toBe("valid");
    expect(stack.planes.length).toBe(31);
    expect(stack.rulerWavelengthNm).toBeCloseTo(483.5483870967742, 12);

    const rendered = centreChromaticity(stack);
    const throughObserver = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map((s) => fresnelTransmittance(s.nm)),
      ),
    );
    expect(distance(rendered, throughObserver)).toBeLessThan(1e-10);
  });

  it("and it is the tint that is carried, not a grey the observer happened to like", () => {
    // The negative control, on one fixed observer so that nothing but the
    // spectrum differs: an equal-energy lamp that never met the glass. The
    // render sits a million times closer to the Fresnel-tinted spectrum than to
    // the flat one, which is the ratio that makes the rung above a measurement
    // rather than a coincidence of two small numbers.
    const stack = clearStack();
    const rendered = centreChromaticity(stack);
    const tinted = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map((s) => fresnelTransmittance(s.nm)),
      ),
    );
    const flat = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map(() => 1),
      ),
    );
    expect(distance(tinted, flat)).toBeGreaterThan(1.3e-4);
    expect(distance(rendered, flat) / distance(rendered, tinted)).toBeGreaterThan(1e6);

    // And the direction is the one dispersion names: N-BK7 reflects more in the
    // blue, so what gets through is warmer than what lit it — +x, and on a band
    // that starts at 480 nm, −y.
    expect(tinted.x - flat.x).toBeGreaterThan(1.2e-4);
    expect(tinted.y - flat.y).toBeLessThan(-5e-5);
  });

  it("and the absolute colour is the CIE integral at 1 nm, to the observer's own binning", () => {
    // THE EXTERNAL HALF, and the reason it is a separate rung: `spectralXyzBasis`
    // integrates the observer over 31 bins and `spectrumToXyz` walks it at 1 nm,
    // and those two routes differ by 9.8e−6 in chromaticity. That gap is the
    // OBSERVER's, not the optics' — it is reproduced here with no optical system
    // anywhere in the calculation — so quoting it as the imaging residual would
    // be blaming the lens for the ruler.
    const stack = clearStack();
    const rendered = centreChromaticity(stack);
    const closed = closedFormChromaticity(fresnelTransmittance);
    expect(distance(rendered, closed)).toBeLessThan(1.5e-5);

    const observerOnly = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map((s) => fresnelTransmittance(s.nm)),
      ),
    );
    // The same gap, to a part in 2000, with the optics removed entirely.
    expect(Math.abs(distance(observerOnly, closed) / distance(rendered, closed) - 1)).toBeLessThan(
      5e-4,
    );
  });

  it("and the field is still flat, in every plane of the stack", () => {
    // The monochrome rung's other half (§ 6al.1): one patch, one pupil, one
    // constant object. A per-plane structure that resampling introduced would be
    // a coloured vignette, which is the failure § 6r's crop exists to prevent —
    // checked here on a branch § 6r never ran on.
    const stack = stackOver(CLEAR, spectralSamples(() => 1, { count: 5, ...BAND }));
    for (const plane of stack.planes) {
      let min = Infinity;
      let max = -Infinity;
      for (const v of plane.intensity) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(max - min).toBeLessThan(1e-15);
      expect(Math.abs(min / fresnelTransmittance(plane.nm) - 1)).toBeLessThan(1e-7);
    }
  });
});

describe("§ 6an.7 — a stain images as its own spectrum", () => {
  /**
   * A dye band, Beer–Lambert: T(λ) = exp(−A·exp(−½((λ−λ₀)/σ)²)), absorbing in
   * the green. The specimen callback returns AMPLITUDE transmittance, so it
   * returns √T — and the fact that this is the one place the square root has to
   * appear is why the last rung here is about the square root.
   */
  const PEAK_NM = 540;
  const WIDTH_NM = 35;
  const ABSORBANCE = 1.6;
  const dyeTransmittance = (nm: number): number =>
    Math.exp(-ABSORBANCE * Math.exp(-0.5 * ((nm - PEAK_NM) / WIDTH_NM) ** 2));
  const STAIN: SpectralSpecimen = (_x, _y, nm) => ({ re: Math.sqrt(dyeTransmittance(nm)), im: 0 });
  const stainedSpectrum = (nm: number) => dyeTransmittance(nm) * fresnelTransmittance(nm);

  const stainStack = memo(() => stackOver(STAIN, LAMP));

  it("the imaged colour is the dye's own transmittance, through the same observer", () => {
    // The rung the step is named for, and the split is § 6an.6's: the imaging
    // chain carries the dye's spectrum to 5e−11, and the absolute colour then
    // sits within the observer's binning of a spectrum that — unlike Fresnel's —
    // has real structure inside a bin.
    const stack = stainStack();
    expect(stack.fidelity?.verdict).toBe("valid");

    const rendered = centreChromaticity(stack);
    const throughObserver = chromaticity(
      spectralXyz(
        stack.samples,
        stack.samples.map((s) => stainedSpectrum(s.nm)),
      ),
    );
    expect(distance(rendered, throughObserver)).toBeLessThan(1e-10);

    // Against the 1 nm CIE integral the gap is 3.4e−4 — thirty times § 6an.6's,
    // because a 35 nm absorption band is not flat across a 7 nm bin and Fresnel
    // is. Quoted as the sampling number it is, and not as the optics'.
    expect(distance(rendered, closedFormChromaticity(stainedSpectrum))).toBeLessThan(5e-4);
  });

  it("and it is a long way from the clear field's, which is what makes it a stain", () => {
    // The negative control the rung above needs: a chain that dropped the
    // specimen's spectrum would land on the clear field's colour, and that is
    // 0.12 away in chromaticity — nine orders above the imaging residual.
    const stained = closedFormChromaticity(stainedSpectrum);
    const clear = closedFormChromaticity(fresnelTransmittance);
    expect(distance(stained, clear)).toBeGreaterThan(0.1);
    // Absorbing the green, on a band with no deep blue in it, leaves orange:
    // +x and −y from the clear field.
    expect(stained.x - clear.x).toBeGreaterThan(0.08);
    expect(stained.y - clear.y).toBeLessThan(-0.08);
  });

  it("and the amplitude/intensity distinction is what the square root buys", () => {
    // If the specimen returned T rather than √T the image would be T² and the
    // colour would be the SQUARE of the dye's spectrum — a saturated version of
    // very nearly the right hue, which is the sort of error a picture cannot
    // show and a chromaticity can.
    const right = closedFormChromaticity(stainedSpectrum);
    const squared = closedFormChromaticity(
      (nm) => dyeTransmittance(nm) ** 2 * fresnelTransmittance(nm),
    );
    expect(distance(right, squared)).toBeGreaterThan(0.08);

    const rendered = centreChromaticity(stainStack());
    expect(distance(rendered, squared) / distance(rendered, right)).toBeGreaterThan(200);
  });
});

describe("§ 6an.8 — Abbe's limit is a colour", () => {
  it("one grating in millimetres is inside the blue limit and exactly on the red one", () => {
    // THE EXTERNAL NUMBER, and the picture the step is for. Abbe's limit is
    // λ/(NA_obj + NA_cond), so it is ∝ λ: the same ruled specimen is resolved in
    // blue and not in red. § 6an.2 makes the arithmetic exact — the object pixel
    // is ∝ λ, so a period fixed in millimetres is a cycle count ∝ 1/λ, and
    // 640/480 = 4/3 turns 9 cycles into exactly 12.
    //
    // 12 is where this fixture's contrast vanishes (§ 6al.5): ν = 1 + S at
    // S = 0.5, with `pupilSamples` = 16. So one grating sits at ν = 1.125 in blue
    // and exactly at the cutoff in red.
    const BLUE_NM = 480;
    const RED_NM = 640;
    const BLUE_CYCLES = 9;
    const RED_CYCLES = 12;

    const blueTile = tileAt(BLUE_NM);
    const redTile = tileAt(RED_NM);
    const periodMm = (SIZE * blueTile.objectPixelScaleMm) / BLUE_CYCLES;
    // The cycle count in red is an integer because the wavelengths are 3:4 and
    // the object ruler is ∝ λ — measured, because it is § 6an.2's claim reaching
    // the picture rather than a restatement of it.
    expect((SIZE * redTile.objectPixelScaleMm) / periodMm).toBeCloseTo(RED_CYCLES, 6);

    const specimen = cosineMm(periodMm);
    const blue = planeAt(specimen, BLUE_NM);
    const red = planeAt(specimen, RED_NM);
    expect(blue.fidelity.verdict).toBe("valid");
    expect(red.fidelity.verdict).toBe("valid");

    const blueHarmonic = imageHarmonic(blue.input.intensity, SIZE, BLUE_CYCLES, 0);
    const redHarmonic = imageHarmonic(red.input.intensity, SIZE, RED_CYCLES, 0);

    // Alive in blue…
    expect(blueHarmonic.contrast).toBeGreaterThan(1e-5);
    // …and eleven orders down in red, which is "the aperture does not carry this
    // at all" rather than "it carries it weakly".
    expect(redHarmonic.contrast).toBeLessThan(1e-13);
    expect(blueHarmonic.contrast / redHarmonic.contrast).toBeGreaterThan(1e9);
  });

  it("and the period where it dies is Abbe's, in millimetres, at each wavelength", () => {
    // The cutoff read as a LENGTH, per wavelength, against the entrance pupil's
    // own geometry — § 6al.5's route, which never touches the frame: the
    // objective's object-space NA is r_ep/z_obj = 2/400 and the condenser adds S
    // of it. So the limit is λ/(NA·(1 + S)) and it is proportional to λ.
    const NA = STOP_R / OBJECT_DISTANCE;
    for (const [nm, cycles] of [
      [480, 12],
      [640, 12],
    ] as const) {
      const tile = tileAt(nm);
      const cutoffMm = (SIZE * tile.objectPixelScaleMm) / cycles;
      const abbeMm = nm * 1e-6 / (NA * (1 + S));
      expect(Math.abs(cutoffMm / abbeMm - 1)).toBeLessThan(3e-8);
    }

    // And the two limits stand in the ratio of the wavelengths, exactly — which
    // is the sentence "Abbe's limit is a colour" with nothing else in it.
    const blueCutoff = (SIZE * tileAt(480).objectPixelScaleMm) / 12;
    const redCutoff = (SIZE * tileAt(640).objectPixelScaleMm) / 12;
    expect(Math.abs(redCutoff / blueCutoff - 640 / 480)).toBeLessThan(2e-9);
  });
});
