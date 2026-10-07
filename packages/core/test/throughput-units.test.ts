import { describe, it, expect } from "vitest";
import {
  incoherentImage,
  incoherentPsf,
  pupilThroughput,
  renderFluorescence,
  uniformEmitters,
  type EmitterField,
  type ThroughputUnits,
} from "../src/imaging/fluorescence";
import { rasterizeEmitterDensity, gaussianEmitter } from "../src/imaging/emitter-density";
import { radialMapCovering } from "../src/imaging/radial-map";
import { objectFieldTile, tracedFieldPupils, fieldPupilAt } from "../src/imaging/object-field";
import { colorImageFromStack, integratedXyz } from "../src/imaging/image";
import { quadratureSamples } from "../src/photometry/spectrum";
import { idealPupil, defocusedPupil } from "../src/illumination/transfer";
import type { PupilFunction } from "../src/wave/psf";
import { fft2d } from "../src/math/fft";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { PatchPupil } from "../src/imaging/brightfield";
import type { OpticalSystem, WavelengthSample } from "../src/trace/system";
import { canonicalApertureSine } from "../src/pupil/opd";
import { aimRay } from "../src/pupil/aiming";
import { pupils } from "../src/pupil/pupils";

/**
 * § 6bc — what a formed image is quoted in, and the difference it hides.
 *
 * § 6bb.2 was written as a seam check between two renderers and came back with
 * a discrepancy instead: `renderVolume` weighs each slice by `formedSum`, the
 * light its pupil actually transmitted, and `renderFluorescence` divided the
 * same factor out. Both are expressions of one convolution and only one of them
 * carried the throughput, which is why field-varying patches could not be run
 * through a depth stack — there was no single answer to give them.
 *
 * The condition that decides it is not "one plane". **The two expressions agree
 * exactly when one pupil forms the whole frame, and disagree the moment a frame
 * is built from several** — a depth stack, a patched field, a mosaic tile, one
 * plane per wavelength. A pupil hands the image two separable things: a kernel,
 * which is where the light lands, and a total, which is how much of it there is.
 * Dropping the second is a choice of UNITS, harmless while it is a constant and
 * a measurement error as soon as it is not.
 *
 * The radiometry says the same in one line: irradiance from a plane goes as its
 * radiance times the collected solid angle times the transmission, and defocus
 * touches none of them. § 6k.1 is that statement's sharpest form — the weight is
 * exactly invariant under a pure defocus, which is why the disagreement is
 * exactly zero on a defocus-only stack and why nobody met it until § 6bb put a
 * wavelength on the other axis.
 *
 * ## The three cases, and their sizes
 *
 * Measured on the ladder's own 4×/0.10, and the ordering is not the one the
 * deferral guessed:
 *
 * - **Colour, 0.740%** over this step's own nine-sample band (§ 6bb.2's 0.658%
 *   is the same quantity read between 430 and 680 nm), and it is the objective's
 *   own Fresnel transmission — § 6bb.2 pinned that against the on-axis amplitude
 *   squared. It reaches the picture: `colorImageFromStack` renormalizes nothing,
 *   so an equal-energy emitter images 3.8e-4 off white in x (§ 6bc.3).
 * - **Field, 0.045% inside the catalogued field and 11.0% outside it** (0.227% and
 *   10.7% on the aim layout, before § 2p). A hard aperture clip rather than a
 *   Fresnel loss — the transmitting sample count itself falls, 441 → 388 — and it
 *   is the un-field-sized glass § 6v.5 named as its own negative control. Give the
 *   objective a field number and nothing is clipped; the sweep then reads the
 *   emitter's collected cone, which a brute-force count puts 0.2–0.8% brighter off
 *   axis than the exit layout does (register item 31, § 6bc.4).
 * - **Depth, exactly zero**, § 6k.1, for as long as the pupils differ only by
 *   defocus.
 *
 * ## What was shipped, and the trap it was designed against
 *
 * `ThroughputUnits`, a **required** option on both entry points, so the compiler
 * names every caller that has to choose. `transmitted` is the physics.
 * `referenced` divides by one weight **the caller supplies**, and that it is
 * supplied rather than discovered is the whole design: a `referenced` that
 * defaulted to "whatever pupil formed me" is the defect wearing a new name, and
 * `volume.ts`'s `relativeThroughput` — which references its own stack's focal
 * plane — is the same shape and must not be reused across stacks. § 6bc.3 and
 * § 6bc.4 both carry that wrong reference as their negative control, and in both
 * it deletes the effect exactly.
 *
 * What did NOT change: `renderVolume` always carried the weight and still does,
 * unconditionally. It is § 6k's physics rather than a knob.
 */

const SIZE = 64;
const PS = 24;
const NODES = 128;
const LAMBDA = 550;

const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** The same glass sized to pass an 18 mm field — § 6w's, and § 6bc.4's control. */
const FIELDED: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({
    magnification: 4,
    numericalAperture: 0.1,
    fieldNumberMm: 18,
  }),
}).system;

const SAMPLES: WavelengthSample[] = quadratureSamples({ count: 9 });

const total = (v: Float64Array): number => {
  let s = 0;
  for (const x of v) s += x;
  return s;
};

const chromaticity = (xyz: { x: number; y: number; z: number }): { x: number; y: number } => {
  const s = xyz.x + xyz.y + xyz.z;
  return { x: xyz.x / s, y: xyz.y / s };
};

const tileAt = (nm: number, xMm: number, system: OpticalSystem = SYSTEM) =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: nm,
    centreMm: { x: xMm, y: 0 },
    layout: "exit",
  });

/** The pre-§ 6bc expression, kept here so § 6bc.1 can compare against it. */
function convolve(object: Float64Array, kernel: Float64Array, n: number): Float64Array {
  const objRe = Float64Array.from(object);
  const objIm = new Float64Array(n * n);
  const kerRe = Float64Array.from(kernel);
  const kerIm = new Float64Array(n * n);
  fft2d(objRe, objIm, n);
  fft2d(kerRe, kerIm, n);
  for (let i = 0; i < n * n; i++) {
    const ar = objRe[i]!;
    const ai = objIm[i]!;
    const br = kerRe[i]!;
    const bi = kerIm[i]!;
    objRe[i] = ar * br - ai * bi;
    objIm[i] = ar * bi + ai * br;
  }
  fft2d(objRe, objIm, n, true);
  return objRe;
}

/**
 * The ideal disc, stopped down to `fraction` of its radius.
 *
 * § 6bc.2's fixture, and it is not § 6i.4's defocus ramp for a reason the step
 * is about: a defocus is a pure phase, so § 6i.4's four patches all transmit the
 * SAME light and the weight they disagree about is zero. A field-dependent
 * weight needs a field-dependent aperture, which is what the traced objective
 * turns out to have (§ 6bc.4) and what this reproduces in a closed form.
 */
function clippedPupil(fraction: number): PupilFunction {
  return {
    amplitude: (px, py) => (px * px + py * py <= fraction * fraction ? 1 : 0),
    phaseWaves: () => 0,
  };
}

/** A structured emitter field — something with an edge for the optics to blur. */
function beadsAndBackground(size: number): EmitterField {
  const values = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      values[y * size + x] = 0.1 + (dx * dx + dy * dy < 90 ? 1 : 0);
    }
  }
  return { size, values };
}

describe("§ 6bc.1 — the two unit systems are one factor apart, and one of them is the old render", () => {
  it("a frame quoted against its own pupil is bitwise the render that had no weight", () => {
    // The claim the migration rests on: nothing § 6i, § 6as or § 6ba measured was
    // re-measured. `referenced` against the pupil that formed the frame makes the
    // weight exactly 1.0, so the multiply is skipped and the array is the one the
    // pre-§ 6bc code produced — asserted against that expression written out
    // rather than against a stored image.
    const object = beadsAndBackground(SIZE);
    const pupil = idealPupil();
    const kernel = incoherentPsf(pupil, { pupilSamples: PS, size: SIZE });
    const old = convolve(object.values, kernel.values, SIZE);

    const referenced = incoherentImage(object, pupil, {
      pupilSamples: PS,
      throughput: { kind: "referenced", referenceSum: pupilThroughput(pupil, { pupilSamples: PS, size: SIZE }) },
    });
    for (let i = 0; i < old.length; i++) {
      expect(Object.is(referenced.intensity[i], old[i])).toBe(true);
    }

    // …and `transmitted` is that array times the one number, bit for bit. The
    // units are a factor and never a reshaping — which is why the choice is
    // invisible until two frames with different factors meet.
    const transmitted = incoherentImage(object, pupil, {
      pupilSamples: PS,
      throughput: { kind: "transmitted" },
    });
    expect(transmitted.formedSum).toBe(kernel.formedSum);
    for (let i = 0; i < old.length; i++) {
      expect(Object.is(transmitted.intensity[i], old[i]! * kernel.formedSum)).toBe(true);
    }
  });

  it("a reference that is not a weight is refused", () => {
    const object = uniformEmitters(SIZE);
    for (const referenceSum of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        incoherentImage(object, idealPupil(), {
          pupilSamples: PS,
          throughput: { kind: "referenced", referenceSum },
        }),
      ).toThrow(/positive finite weight/);
    }
  });
});

describe("§ 6bc.2 — the conservation that was arithmetic, and the one that survives", () => {
  it("a patched render holds the weighted flux exactly, and it is not the emitted flux", () => {
    // § 6i's "light is conserved to 1e-12" held because every patch had been
    // divided by its own weight first — § 6k.3's trap, arriving in the operator
    // rather than in a readout. Give the field an aperture that actually varies
    // and the image holds strictly less than was emitted.
    const object = beadsAndBackground(SIZE);
    const emitted = total(object.values);
    const varying = (u: number): PatchPupil => ({ pupil: clippedPupil(0.6 + 0.4 * u) });

    for (const patches of [2, 4]) {
      const formed = renderFluorescence(object, varying, {
        patches,
        pupilSamples: PS,
        throughput: { kind: "transmitted" },
      });
      const held = total(formed.intensity);
      // The conservation that survives, and it is exact: the render invents and
      // loses nothing against the flux the weights allow.
      expect(Math.abs(held / formed.weightedEmittedFlux - 1)).toBeLessThan(1e-12);
      expect(formed.patchThroughput).toHaveLength(patches * patches);
      const lo = Math.min(...formed.patchThroughput);
      const hi = Math.max(...formed.patchThroughput);
      // A genuine bracket rather than a point, and its width has a closed form:
      // the clip is on the RADIUS and the weight is an AREA, so the extreme
      // patch centres (u = 0.5/patches and 1 − 0.5/patches) give the square of
      // their radius ratio. What separates the two is the lattice's count of a
      // disc — § 6as.4's Gauss-circle residual — so the departure is bounded
      // here and shown to fall with the sampling below rather than asserted
      // tight at one grid.
      const edge = 0.5 / patches;
      const closed = ((0.6 + 0.4 * (1 - edge)) / (0.6 + 0.4 * edge)) ** 2;
      expect(hi / lo).toBeGreaterThan(1.6);
      expect(Math.abs(hi / lo / closed - 1)).toBeLessThan(3e-2);
      expect(held / emitted).toBeGreaterThan(lo);
      expect(held / emitted).toBeLessThan(hi);
      // …and nowhere near the 1 § 6i read: the shortfall IS the aperture.
      expect(held / emitted).toBeLessThan(0.13);
    }

    // The weight IS the area, and the 3% allowed above is the lattice: refine
    // the pupil sampling and the departure from the closed form falls with it.
    const departure = (pupilSamples: number, size: number): number => {
      const w = (fraction: number) =>
        incoherentPsf(clippedPupil(fraction), { pupilSamples, size }).formedSum;
      return Math.abs(w(0.95) / w(0.65) / (0.95 / 0.65) ** 2 - 1);
    };
    const coarse = departure(24, 64);
    const fine = departure(96, 256);
    expect(fine).toBeLessThan(coarse);
    expect(fine).toBeLessThan(3e-3);
  });

  it("a pure defocus is exactly the case where the choice does not matter", () => {
    // Why the defect survived from § 6i to § 6bb: defocus is a pure phase, so it
    // moves no weight at all (§ 6k.1). Every stack the ladder built before a
    // wavelength went on the other axis differed only by defocus, and on those
    // the two unit systems are one global constant apart and nothing else.
    const flat = incoherentPsf(idealPupil(), { pupilSamples: PS, size: SIZE });
    for (const waves of [0.25, 1, 4]) {
      const blurred = incoherentPsf(defocusedPupil(waves), { pupilSamples: PS, size: SIZE });
      expect(Math.abs(blurred.formedSum / flat.formedSum - 1)).toBeLessThan(1e-14);
    }
    // The aperture is the axis it does move on, and by a lot.
    expect(
      incoherentPsf(clippedPupil(0.6), { pupilSamples: PS, size: SIZE }).formedSum /
        flat.formedSum,
    ).toBeLessThan(0.4);
  });
});

describe("§ 6bc.3 — the objective's transmission spectrum reaches the colour", () => {
  it("carrying the weight tints a flat-band emitter, and the wrong reference deletes it", () => {
    const density = gaussianEmitter({ waistMm: 0.004, peak: 1 });
    /** `units(nm, ownSum)` picks how each plane of the stack is quoted. */
    const build = (units: (ownSum: number) => ThroughputUnits) => {
      const planes = SAMPLES.map((s) => {
        const frame = tileAt(s.nm, 0);
        const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
        const object = rasterizeEmitterDensity(frame, density, { radialMap: map });
        const pupils = tracedFieldPupils(SYSTEM, frame, {});
        const ownSum = pupilThroughput(pupils(0.5, 0.5).pupil, { pupilSamples: PS, size: SIZE });
        const formed = renderFluorescence(object, pupils, {
          pupilSamples: PS,
          scale: frame.scale,
          throughput: units(ownSum),
        });
        return { nm: s.nm, weight: s.weight, intensity: formed.intensity, ownSum };
      });
      return { planes, image: colorImageFromStack({ size: SIZE, pixelScaleMm: 1, planes, samples: SAMPLES }) };
    };

    const carried = build(() => ({ kind: "transmitted" }));
    // The trap: every plane quoted against ITS OWN pupil. Each divides the
    // objective's transmission out one plane at a time, so the stack comes back
    // with no transmission spectrum in it at all.
    const perPlane = build((ownSum) => ({ kind: "referenced", referenceSum: ownSum }));

    // The transmission tilt across the sampled band: red end over blue end.
    const sums = carried.planes.map((p) => p.ownSum);
    const tilt = sums[sums.length - 1]! / sums[0]!;
    // 1.0074 on the aim layout, the glass's Fresnel alone. On the exit layout
    // (§ 2p) a plane's light is the emitter's own collected cone, and the cone
    // the objective accepts is 0.5% wider in sine at the red end — the next rung.
    expect(tilt).toBeCloseTo(1.0174, 4);
    // Monotone in wavelength, which is what says it is the glass and not the
    // lattice: a Gauss-circle miscount would not order itself by colour.
    for (let p = 1; p < sums.length; p++) expect(sums[p]!).toBeGreaterThan(sums[p - 1]!);

    // An equal-energy emitter does NOT image white through a real objective. The
    // shift is small and it is a chromaticity rather than a flux, because
    // `colorImageFromStack` renormalizes nothing.
    const carriedC = chromaticity(integratedXyz(carried.image));
    const perPlaneC = chromaticity(integratedXyz(perPlane.image));
    // § 2p: (0.33384, 0.33446) and a 3.83e-4 / 3.66e-4 shift before — the
    // collected cone's tilt added to the glass's.
    expect(carriedC.x).toBeCloseTo(0.334347, 5);
    expect(carriedC.y).toBeCloseTo(0.334973, 5);
    expect(carriedC.x - perPlaneC.x).toBeCloseTo(8.905e-4, 6);
    expect(carriedC.y - perPlaneC.y).toBeCloseTo(8.747e-4, 6);
    // Toward the red, as a transmission rising with wavelength must be.
    expect(carriedC.x).toBeGreaterThan(perPlaneC.x);

    // The per-plane reference is a pure renormalization of each plane, so its
    // planes are the unweighted ones exactly — the deletion is not approximate.
    for (let p = 0; p < SAMPLES.length; p++) {
      const own = carried.planes[p]!.ownSum;
      const a = carried.planes[p]!.intensity;
      const b = perPlane.planes[p]!.intensity;
      for (let i = 0; i < a.length; i += 977) {
        expect(Object.is(a[i], b[i]! * own)).toBe(true);
      }
    }
    expect(tilt).toBeGreaterThan(1);
  });
});

describe("§ 2p.1 — an emitter's light is its collected cone, (1 − cos u)/2 of it", () => {
  it("the exit layout's plane over the aim layout's is c_rim²·2/(1 + cos u) at every wavelength", () => {
    // The external number § 2n's absolute emitter units answer to. An isotropic
    // point source sends (1 − cos u)/2 of its power into a cone of half-angle u;
    // the aim layout's disc counts the paraxial π·sin²u/4π of it, so the exact
    // share over the paraxial one is 2/(1 + cos u) — times c_rim², the traced rim
    // in the canonical coordinate n·L/ν, which is 1 on an aplanat. Read per
    // wavelength off the rim ray's own launch, nothing the exit layout computes.
    for (const s of SAMPLES) {
      const sum = (layout: "aim" | "exit") => {
        const frame = objectFieldTile(SYSTEM, {
          size: SIZE,
          pupilSamples: PS,
          wavelengthNm: s.nm,
          centreMm: { x: 0, y: 0 },
          layout,
        });
        return pupilThroughput(tracedFieldPupils(SYSTEM, frame, {})(0.5, 0.5).pupil, {
          pupilSamples: PS,
          size: SIZE,
        });
      };
      const p = pupils(SYSTEM, s.nm);
      const d = aimRay(SYSTEM, p, 0, { px: 1, py: 0 }, s.nm, {}).dir;
      const sinU = Math.hypot(d.x, d.y) / Math.hypot(d.x, d.y, d.z);
      const cosU = Math.sqrt(1 - sinU * sinU);
      const cRim = (Math.abs(p.entrance.n) * sinU) / canonicalApertureSine(SYSTEM, s.nm, {});
      const predicted = (cRim * cRim * 2) / (1 + cosU);
      // Measured 2.6e-4 at the blue end falling to −4.4e-5 at the red: the DIN
      // 4×'s own departure from the sine condition across the rim.
      expect(Math.abs(sum("exit") / sum("aim") / predicted - 1), `${s.nm} nm`).toBeLessThan(3e-4);
    }
  });
});

describe("§ 6bc.4 — a mosaic tile off-axis is dimmer, and only if the weight is carried", () => {
  const read = (system: OpticalSystem, xMm: number) => {
    const frame = tileAt(LAMBDA, xMm, system);
    const kernel = incoherentPsf(fieldPupilAt(system, frame, 0.5, 0.5).pupil, {
      pupilSamples: PS,
      size: SIZE,
    });
    return { sum: kernel.formedSum, samples: kernel.transmittingSamples };
  };

  it("the un-field-sized objective clips its own aperture, and the field-sized one does not", () => {
    // § 6v.5's negative control, read as a throughput rather than as a ray
    // count. Inside the 18 mm field number the glass is sized for nothing — the
    // semi-field is 2.25 mm and the loss is 0.227% — and outside it the aperture
    // goes, samples and all. Give the same design a field number (§ 6w) and the
    // whole sweep holds to 3.3e-5.
    //
    // § 2p restated these on the exit layout (0.997728, 0.941036, 0.893415 and
    // 394 samples before, and the field-sized lens flat to 3.3e-5 — a share of the
    // aim disc, flat by construction). The exit layout's sum is the emitter's
    // collected power, and against a brute-force count — a direction-cosine
    // lattice launched from the object point, traced, Σ throughput/cos θ — it
    // misses by up to 1%: about 1.1% of the light that gets through lies outside
    // the paraxial aim disc no pupil is laid from (1.8% at 6 mm), and at pupil
    // samples 24 the outline's own count is off by up to 0.5%. Register item 31;
    // the count reads 0.995237, 0.930842, 0.882580 here and 1.001672, 1.004445,
    // 1.007761 on the field-sized lens.
    const axis = read(SYSTEM, 0);
    expect(axis.samples).toBe(441);
    expect(read(SYSTEM, 2.25).sum / axis.sum).toBeCloseTo(0.999550, 6);
    expect(read(SYSTEM, 4.5).sum / axis.sum).toBeCloseTo(0.942734, 6);
    const far = read(SYSTEM, 6);
    expect(far.sum / axis.sum).toBeCloseTo(0.889845, 6);
    // A hard clip and not a Fresnel loss: the transmitting count itself falls.
    expect(far.samples).toBe(388);

    // The field-sized lens clips nothing: every off-axis tile counts the same
    // lattice, three points short of the axis's — the exit cone seen off axis,
    // laid on the axial ruler, and not a vignette.
    const fieldedAxis = read(FIELDED, 0);
    expect(fieldedAxis.samples).toBe(441);
    const fielded = [2.25, 4.5, 6].map((xMm) => read(FIELDED, xMm));
    for (const off of fielded) expect(off.samples).toBe(438);
    const ratios = fielded.map((off) => off.sum / fieldedAxis.sum);
    expect(ratios[0]!).toBeCloseTo(0.994776, 6);
    expect(ratios[1]!).toBeCloseTo(0.999379, 6);
    expect(ratios[2]!).toBeCloseTo(1.004048, 6);
  });

  it("quoting each tile in its own units renders the clip away exactly", () => {
    // What a mosaic would show. Two tiles, one on axis and one at 6 mm, imaging
    // the same object: carried, the far tile is 11.0% darker; each quoted
    // against its own pupil, they are the same picture to f64 — an 11% loss
    // rendered as a flat field, which is the § 6bb.2 defect in the one place a
    // user would have called it a picture rather than a number.
    const object = beadsAndBackground(SIZE);
    const pupilAt = (xMm: number) =>
      fieldPupilAt(SYSTEM, tileAt(LAMBDA, xMm, SYSTEM), 0.5, 0.5).pupil;
    const axisPupil = pupilAt(0);
    const farPupil = pupilAt(6);

    const carried = [axisPupil, farPupil].map((pupil) =>
      total(
        incoherentImage(object, pupil, { pupilSamples: PS, throughput: { kind: "transmitted" } })
          .intensity,
      ),
    );
    expect(carried[1]! / carried[0]!).toBeCloseTo(0.889845, 6);

    const perTile = [axisPupil, farPupil].map((pupil) =>
      incoherentImage(object, pupil, {
        pupilSamples: PS,
        throughput: {
          kind: "referenced",
          referenceSum: pupilThroughput(pupil, { pupilSamples: PS, size: SIZE }),
        },
      }),
    );
    expect(total(perTile[1]!.intensity) / total(perTile[0]!.intensity)).toBeCloseTo(1, 12);
  });
});
