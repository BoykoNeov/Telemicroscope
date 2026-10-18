import { describe, it, expect } from "vitest";
import { incoherentImage, type EdgePlan } from "../src/imaging/fluorescence";
import { renderFieldVolume, type FieldDepthPupils } from "../src/imaging/field-volume";
import { defocusWaves, objectDefocusing, type EmitterVolume } from "../src/imaging/volume";
import { renderedBestFocus } from "../src/imaging/focus-surface";
import { formVolumePlane, neutralVolumeEmitterDensity } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs } from "../src/imaging/emitter-volume";
import { fieldPupilAt, objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 2r.1 — a focus sweep lays its rim out once.
 *
 * § 2q.7 laid the crossing rule's rim out once per outline and carried the plan
 * through `depthKernels` and `renderVolume`. The mosaic chain forms its images
 * through `renderFieldVolume`, and finds its stage with `renderedBestFocus`,
 * neither of which took a plan: every slice of every stage of a sweep laid the
 * same outline out again. Measured on the 4×/0.10 at 430 nm and 0.55 mm, exit
 * layout, 48 bins: a sweep cost 2.0 s point-sampled and 22.7 s resolved, the
 * time in ray traces and Zernike bases behind the bisections' amplitude
 * questions — where § 2q.7 put it. A stage moves the specimen, not the lens, so
 * every stage forms one frame through one set of traced pupils.
 *
 * **Change:** on `"crossing"` each patch lays its rim out once and every slice
 * reuses it; a caller that will form the frame again keeps the plans in a book
 * (`FieldVolumeOptions.edgePlans`, `formVolumePlane`'s last argument), and
 * `renderedBestFocus` keeps one per sweep. The sweep above: 2.8 s.
 *
 * **Refuted by** an image through a plan or a book that differs from the one
 * formed without it in any bit, a book that saves no amplitude questions on its
 * second use, or a book accepted at another wavelength's outline.
 *
 * External number: the engine without a plan, bitwise — and the sweep's own
 * best focus as the engine read it before the change.
 */

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;
const SIZE = 64;
const PS = 24;
const EDGE = { edgeSamples: 8, edgeRule: "crossing" as const };

const frameAt = (nm: number, xMm: number) =>
  objectFieldTile(SYSTEM, { size: SIZE, pupilSamples: PS, layout: "exit", wavelengthNm: nm, centreMm: { x: xMm, y: 0 } });

/** The traced field pupils of one frame, with every amplitude question counted. */
function countedPupils(nm: number, xMm: number) {
  const frame = frameAt(nm, xMm);
  const asked = { amplitude: 0 };
  const pupils: FieldDepthPupils = (u, v) => {
    const traced = fieldPupilAt(SYSTEM, frame, u, v, { layout: "exit" }).pupil;
    const pupil: PupilFunction = {
      ...traced,
      amplitude: (x, y) => (asked.amplitude++, traced.amplitude(x, y)),
    };
    return objectDefocusing(pupil, 0);
  };
  return { pupils, asked };
}

/** A three-slice stack with structure, so a misplaced rim would show. */
const VOLUME: EmitterVolume = {
  size: SIZE,
  slices: [-0.006, 0, 0.005].map((zMm, s) => ({
    zMm,
    field: {
      size: SIZE,
      values: Float64Array.from({ length: SIZE * SIZE }, (_, i) => ((i * (7 + s)) % 13) / 13),
    },
  })),
};

const OPTIONS = { pupilSamples: PS, numericalAperture: 0.1, wavelengthNm: 430, focusMm: 0.001 };

function expectSameImage(a: Float64Array, b: Float64Array): void {
  expect(a.length).toBe(b.length);
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) differing++;
  expect(differing).toBe(0);
}

describe("§ 2r.1 — a focus sweep lays its rim out once", () => {
  it("a patch's slices share one plan, bitwise the slices formed one by one without it", () => {
    // The reference is renderFieldVolume's own loop at one patch, written out with
    // no plan: a patch weight of 1 everywhere, the slice images summed in order.
    const { pupils } = countedPupils(430, 2);
    const planned = renderFieldVolume(VOLUME, pupils, { ...OPTIONS, ...EDGE });
    const depth = pupils(0.5, 0.5);
    const sum = new Float64Array(SIZE * SIZE);
    VOLUME.slices.forEach((slice, s) => {
      const waves = defocusWaves(slice.zMm - OPTIONS.focusMm, OPTIONS.numericalAperture, OPTIONS.wavelengthNm, 1);
      const formed = incoherentImage(slice.field, depth(waves), {
        pupilSamples: PS,
        throughput: { kind: "transmitted" },
        ...EDGE,
      });
      for (let i = 0; i < sum.length; i++) sum[i] = sum[i]! + formed.intensity[i]!;
      expect(planned.sliceFlux[s]! > 0).toBe(true);
    });
    expectSameImage(planned.intensity, sum);
  });

  it("a book carried across stages is bitwise every stage formed fresh, and asks the rim once", () => {
    const fresh = countedPupils(430, 2);
    const kept = countedPupils(430, 2);
    const book = new Map<number, EdgePlan>();
    const askedPerStage: number[] = [];
    for (const focusMm of [-0.01, 0.001, 0.012]) {
      const options = { ...OPTIONS, ...EDGE, focusMm, patches: 2 };
      const a = renderFieldVolume(VOLUME, fresh.pupils, options);
      const before = kept.asked.amplitude;
      const b = renderFieldVolume(VOLUME, kept.pupils, { ...options, edgePlans: book });
      askedPerStage.push(kept.asked.amplitude - before);
      expectSameImage(b.intensity, a.intensity);
      b.patchThroughput.forEach((t, p) => expect(Object.is(t, a.patchThroughput[p])).toBe(true));
      expect(Object.is(b.maxGridPhaseStepWaves, a.maxGridPhaseStepWaves)).toBe(true);
    }
    // Four patches, four outlines, laid out on the first stage and only probed
    // after it: the lattice box and the guard, against the bisections.
    expect(book.size).toBe(4);
    expect(askedPerStage[0]! > 5 * askedPerStage[1]!).toBe(true);
    expect(askedPerStage[2]).toBe(askedPerStage[1]);
  });

  it("refuses a book laid out at another wavelength's outline", () => {
    const density = neutralVolumeEmitterDensity(() => 1);
    const options = { size: SIZE, pupilSamples: PS, samples: [], slabs: uniformSlabs(-0.004, 0.004, 3), layout: "exit" as const, ...EDGE };
    const book = new Map<number, EdgePlan>();
    formVolumePlane(SYSTEM, density, options, { nm: 430, weight: 1 }, { x: 2, y: 0 }, undefined, book);
    expect(() =>
      formVolumePlane(SYSTEM, density, options, { nm: 656.2725, weight: 1 }, { x: 2, y: 0 }, undefined, book),
    ).toThrow(/does not fit this pupil|edgePlan was laid out/);
  });

  it("the resolved sweep reads the best focus the engine read before it kept a book", () => {
    // 0.18926908475291915 mm: the 4× at 430 nm and 0.55 mm on the exit layout,
    // resolved, read with no plan anywhere in the engine. First read at § 2r.1
    // (0.1892332100975374 mm, 22.7 s on that engine); re-read at § 2t, whose fit
    // moved it, with the plan switched off in `renderFieldVolume` for the run —
    // 49 s, and bitwise the planned sweep's.
    const point = renderedBestFocus(SYSTEM, 430, 0.55, {
      size: 128,
      pupilSamples: 48,
      slabs: uniformSlabs(-0.008, 0.008, 3),
      probe: (c) => gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm: c }),
      stepMm: 0.005,
      halfMm: 0.03,
      maxPlateauDepths: 1,
      layout: "exit",
      peak: "band-limited",
      ...EDGE,
    });
    expect(point.focusMm).toBe(0.18926908475291915);
  });
});

