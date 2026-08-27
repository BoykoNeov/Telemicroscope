import { describe, it, expect } from "vitest";
import { incoherentPsf, renderFluorescence } from "../src/imaging/fluorescence";
import { defocusing, renderVolume, withDefocus } from "../src/imaging/volume";
import {
  containedDefocusWaves,
  fieldDefocusing,
  renderFieldVolume,
} from "../src/imaging/field-volume";
import { idealPupil } from "../src/illumination/transfer";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { fieldPupilAt, objectFieldTile, tracedFieldPupils } from "../src/imaging/object-field";
import type { PupilFunction } from "../src/wave/psf";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlice, EmitterVolume } from "../src/imaging/volume";

/**
 * § 6bd — the field and the depth on one callback.
 *
 * § 6k varies the pupil with **depth**, § 6i across the **field**, and no module
 * has had both. The obstacle was never the optics: the two renderers disagreed
 * about brightness, `renderVolume` weighing each slice by the light its pupil
 * passed and `renderFluorescence` dividing the same factor out, so a patched
 * depth stack had two answers. § 6bc chose — the weight is the physics — and
 * this step is the wiring that decision was made for. No new physics arrives.
 *
 * What arrives is a coupling nobody had priced, and it disagrees with the
 * deferral's own framing in four places.
 *
 * **§ 6bc read the field profile exactly where it is flat.** Throughput is even
 * in field radius, so its gradient vanishes at the axis; the 1.9e-8 § 6bc
 * measured across an on-axis frame is the one frame in the field the pupil does
 * not vary across. A frame at 4.5 mm spans 1.699e-2 of throughput across its own
 * patches. That is a different interval from § 6bc.4's axis-to-2.25 mm 0.227%,
 * not a contradiction of it — the patch centres at 4.5 mm cover 4.402–4.600 mm
 * of radius — and § 6bd.3 pins both so no later step can read one as the other.
 *
 * **The one-pupil error therefore has no fixed sign** (§ 6bd.4), **what the
 * patches buy is the phase and not the clip** (§ 6bd.6), and **out-of-focus
 * light dilutes the whole effect** (§ 6bd.5) — the patch count is set by the
 * in-focus content's share of the frame, not by the stack's depth.
 *
 * Two rungs are about the arithmetic surviving rather than about the optics.
 * § 6bd.1 is the seam § 6bb.2 opened, closed **bitwise** in both directions;
 * § 6bd.7 puts a condition on § 6k.2 that a uniform slab could never have
 * revealed. And § 6bd.8 finds that the grid's Nyquist guard and the frame's
 * containment limit are one limit.
 */

const SIZE = 64;
const PS = 24;
const LAMBDA = 550;
const NA = 0.1;

const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: NA }),
}).system;

const OPT = { pupilSamples: PS, numericalAperture: NA, wavelengthNm: LAMBDA };

const tileAt = (xMm: number) =>
  objectFieldTile(SYSTEM, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: LAMBDA,
    centreMm: { x: xMm, y: 0 },
  });

/** Five beads a side, brighter with depth so no two slices are the same field. */
const beads = (zs: readonly number[]): EmitterVolume => ({
  size: SIZE,
  slices: zs.map((zMm, k): EmitterSlice => {
    const values = new Float64Array(SIZE * SIZE);
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(((j + 0.5) / 5) * SIZE);
        const x = Math.round(((i + 0.5) / 5) * SIZE);
        values[y * SIZE + x] = 1 + 0.1 * k;
      }
    }
    return { zMm, field: { size: SIZE, values } };
  }),
});

const rel = (a: Float64Array, b: Float64Array): number => {
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    num += d * d;
    den += b[i]! * b[i]!;
  }
  return Math.sqrt(num / den);
};

/**
 * The light that would have wrapped, measured rather than estimated: the same
 * pupil formed on a grid of DOUBLE the extent, counted outside the inner frame.
 *
 * Pixel scale goes as pupilSamples/size and extent as pupilSamples, so
 * (2·size, 2·pupilSamples) is the same sampling over twice the field. This is
 * why the renderer reports no `escapedFraction` of its own — it would be an
 * estimate quoted as a measurement, and § 6k.3's trap in a third place.
 */
const escaped = (pupil: PupilFunction, waves: number, size: number, ps: number): number => {
  const n = 2 * size;
  const kernel = incoherentPsf(withDefocus(pupil, waves), { pupilSamples: 2 * ps, size: n });
  const half = size / 2;
  let out = 0;
  for (let y = 0; y < n; y++) {
    const dy = Math.min(y, n - y);
    for (let x = 0; x < n; x++) {
      if (Math.max(Math.min(x, n - x), dy) > half) out += kernel.values[y * n + x]!;
    }
  }
  return out;
};

const tracedAt = (frame: ReturnType<typeof tileAt>, u: number, v: number): PupilFunction =>
  fieldPupilAt(SYSTEM, frame, u, v).pupil;

describe("§ 6bd.1 — the two renderers this one reduces to, bitwise", () => {
  const flat = defocusing(idealPupil() as PupilFunction);
  const volume = beads([-0.06, -0.03, 0, 0.03, 0.06]);

  it("one patch IS renderVolume — every pixel, not merely every digit", () => {
    const reference = renderVolume(volume, flat, OPT);
    const patched = renderFieldVolume(volume, () => flat, OPT);
    expect(patched.size).toBe(reference.size);
    expect(patched.patches).toBe(1);
    for (let i = 0; i < reference.intensity.length; i++) {
      // Object.is, not toBeCloseTo: the loop order and the operand order were
      // chosen so this holds exactly, and a tolerance here would hide a drift.
      expect(Object.is(patched.intensity[i], reference.intensity[i])).toBe(true);
    }
    expect(Object.is(patched.inFocusFraction, reference.inFocusFraction)).toBe(true);
    expect(Object.is(patched.maxGridPhaseStepWaves, reference.maxGridPhaseStepWaves)).toBe(true);
    for (let s = 0; s < reference.sliceFlux.length; s++) {
      expect(Object.is(patched.sliceFlux[s], reference.sliceFlux[s])).toBe(true);
    }
  });

  it("one in-focus slice IS renderFluorescence in transmitted units", () => {
    // § 6bb.2's seam, and the reason it could not be checked before § 6bc: the
    // two sides were quoted in different units, so the ratio was `formedSum`
    // rather than 1 and no tolerance could have been the right one.
    const frame = tileAt(4.5);
    const pupils = tracedFieldPupils(SYSTEM, frame);
    const thin = beads([0]);
    const plane = renderFluorescence(thin.slices[0]!.field, pupils, {
      patches: 4,
      pupilSamples: PS,
      throughput: { kind: "transmitted" },
    });
    const stack = renderFieldVolume(thin, fieldDefocusing(pupils), { ...OPT, patches: 4 });
    for (let i = 0; i < plane.intensity.length; i++) {
      expect(Object.is(stack.intensity[i], plane.intensity[i])).toBe(true);
    }
    expect(stack.patchThroughput).toHaveLength(16);
    for (let p = 0; p < 16; p++) {
      expect(Object.is(stack.patchThroughput[p], plane.patchThroughput[p])).toBe(true);
    }
    expect(Object.is(stack.weightedEmittedFlux, plane.weightedEmittedFlux)).toBe(true);
  });

  it("refuses what it cannot render", () => {
    const flatPupils = () => flat;
    for (const patches of [0, -1, 1.5, Number.NaN]) {
      expect(() => renderFieldVolume(volume, flatPupils, { ...OPT, patches })).toThrow(
        /positive integer/,
      );
    }
    expect(() => renderFieldVolume({ size: SIZE, slices: [] }, flatPupils, OPT)).toThrow(
      /no slices/,
    );
    const ragged: EmitterVolume = {
      size: SIZE,
      slices: [
        volume.slices[0]!,
        { zMm: 0.01, field: { size: 32, values: new Float64Array(32 * 32) } },
      ],
    };
    expect(() => renderFieldVolume(ragged, flatPupils, OPT)).toThrow(/slice 1 is 32/);
    const short: EmitterVolume = {
      size: SIZE,
      slices: [{ zMm: 0, field: { size: SIZE, values: new Float64Array(SIZE) } }],
    };
    expect(() => renderFieldVolume(short, flatPupils, OPT)).toThrow(/must hold/);
  });
});

describe("§ 6bd.2 — the input split stays exact however defocused", () => {
  it("a field-independent pupil renders identically at 1, 4 and 8 patches", () => {
    // § 6i.4 pinned this on one plane. The question a stack raises is whether a
    // kernel wider than the frame breaks it, and it does not: the wrap is the
    // same wrap in both renders, so it cancels out of the comparison. The error
    // of the decomposition is set by how fast the pupil varies with SOURCE
    // position, and a field-independent pupil does not vary at all.
    //
    // Not the mechanism brightfield is stuck with: § 6g.2 windows the output
    // because splitting an AMPLITUDE deletes the interference (89% of it), and
    // an emitting specimen has none to lose.
    const flat = defocusing(idealPupil() as PupilFunction);
    const seen: number[] = [];
    for (const span of [0.06, 0.12, 0.25, 0.45]) {
      const volume = beads([-span, -span / 2, 0, span / 2, span]);
      const one = renderFieldVolume(volume, () => flat, OPT);
      const four = renderFieldVolume(volume, () => flat, { ...OPT, patches: 4 });
      const eight = renderFieldVolume(volume, () => flat, { ...OPT, patches: 8 });
      expect(rel(four.intensity, one.intensity)).toBeLessThan(1e-14);
      expect(rel(eight.intensity, one.intensity)).toBeLessThan(1e-14);
      seen.push(rel(eight.intensity, one.intensity));
    }
    // and it does not degrade with depth — the last span is the deepest
    expect(Math.max(...seen)).toBeLessThan(1e-14);
  });

  it("and the deepest of those is not a vacuous test — a quarter of the light has left the frame", () => {
    // 0.45 mm of half-span is 4.091 waves at this NA and wavelength, where the
    // kernel is wider than the grid and `convolveCircular` folds it back — in
    // this module, into a patch with a different pupil.
    const waves = (0.45 * NA * NA) / (2 * LAMBDA * 1e-6);
    expect(waves).toBeCloseTo(4.0909, 3);
    expect(escaped(idealPupil() as PupilFunction, waves, SIZE, PS)).toBeCloseTo(0.2441, 3);
    // the shallowest span is the control: essentially nothing has escaped
    const shallow = (0.06 * NA * NA) / (2 * LAMBDA * 1e-6);
    expect(escaped(idealPupil() as PupilFunction, shallow, SIZE, PS)).toBeCloseTo(0.0139, 3);
  });
});

describe("§ 6bd.3 — the field varies fastest where § 6bc did not read it", () => {
  const spanAt = (r: number): { span: number; radii: [number, number]; centre: number } => {
    const frame = tileAt(r);
    const image = renderFieldVolume(beads([0]), fieldDefocusing(tracedFieldPupils(SYSTEM, frame)), {
      ...OPT,
      patches: 4,
    });
    const t = image.patchThroughput;
    let lo = Infinity;
    let hi = -Infinity;
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const fp = fieldPupilAt(SYSTEM, frame, (px + 0.5) / 4, (py + 0.5) / 4);
        lo = Math.min(lo, fp.imageRadiusMm);
        hi = Math.max(hi, fp.imageRadiusMm);
      }
    }
    const centre = renderFieldVolume(
      beads([0]),
      fieldDefocusing(tracedFieldPupils(SYSTEM, frame)),
      OPT,
    );
    return { span: Math.max(...t) / Math.min(...t) - 1, radii: [lo, hi], centre: centre.patchThroughput[0]! };
  };

  it("the on-axis frame is the one frame the pupil does not vary across", () => {
    const axis = spanAt(0);
    // 1.9e-8, and it is not a small number badly measured — it is the gradient
    // of an EVEN function at its own centre. § 6bc.4 probed here and concluded
    // the within-frame variation was nothing anywhere.
    expect(axis.span).toBeLessThan(1e-7);
    expect(axis.span).toBeGreaterThan(1e-9);
  });

  it("and a frame at the field edge spans more than the whole catalogued field does", () => {
    const at225 = spanAt(2.25);
    const at450 = spanAt(4.5);
    const at600 = spanAt(6);
    expect(at225.span).toBeCloseTo(6.8646e-3, 6);
    expect(at450.span).toBeCloseTo(1.6990e-2, 6);
    expect(at600.span).toBeCloseTo(1.2755e-2, 6);
    // The comparison, stated so it cannot be read as a correction of § 6bc.4:
    // that rung's 0.227% is the AXIS-to-2.25 mm ratio; this is the span across
    // one frame whose patch centres cover only these radii.
    expect(at225.radii[0]).toBeCloseTo(2.1517, 3);
    expect(at225.radii[1]).toBeCloseTo(2.3506, 3);
    expect(at450.radii[0]).toBeCloseTo(4.4016, 3);
    expect(at450.radii[1]).toBeCloseTo(4.5996, 3);
    // 0.686% across 0.199 mm of radius, against 0.227% across the 2.25 mm
    // beneath it — the local slope where § 6bc read the value.
    expect(at225.span / (1 - 0.997728)).toBeGreaterThan(3);
  });

  it("and the centre pupil still reproduces § 6bc.4's radial profile exactly", () => {
    // The same numbers from the other side, so the two rungs are pinned to one
    // objective rather than to two measurements that happen to agree.
    const axial = spanAt(0).centre;
    expect(spanAt(2.25).centre / axial).toBeCloseTo(0.997728, 6);
    expect(spanAt(4.5).centre / axial).toBeCloseTo(0.941036, 6);
    expect(spanAt(6).centre / axial).toBeCloseTo(0.893415, 6);
  });
});

describe("§ 6bd.4 — the error of one pupil has no fixed sign", () => {
  it("a frame patched holds more light than its centre at one radius and less at another", () => {
    // The profile is concave before the aperture clips and convex after, so the
    // centre value sits above its own frame average in one place and below it in
    // another. A correction factor fitted at one field radius has the wrong SIGN
    // at another, which is why this is a renderer and not a scalar.
    const volume = beads([-0.06, -0.03, 0, 0.03, 0.06]);
    const ratioAt = (r: number): number => {
      const frame = tileAt(r);
      const centre = defocusing(tracedAt(frame, 0.5, 0.5));
      const one = renderFieldVolume(volume, () => centre, OPT);
      const four = renderFieldVolume(volume, fieldDefocusing(tracedFieldPupils(SYSTEM, frame)), {
        ...OPT,
        patches: 4,
      });
      return four.weightedEmittedFlux / one.weightedEmittedFlux;
    };
    expect(ratioAt(0)).toBeCloseTo(0.99999999, 8);
    expect(ratioAt(2.25)).toBeCloseTo(0.99917570, 8);
    expect(ratioAt(4.5)).toBeCloseTo(1.00112776, 8);
    // stated as the finding rather than as three numbers
    expect(ratioAt(2.25)).toBeLessThan(1);
    expect(ratioAt(4.5)).toBeGreaterThan(1);
  });
});

describe("§ 6bd.5 — out-of-focus light dilutes the field variation", () => {
  it("a single plane moves more than a five-slice stack at the same field position", () => {
    const thin = beads([0]);
    const thick = beads([-0.06, -0.03, 0, 0.03, 0.06]);
    const moveAt = (r: number, volume: EmitterVolume): number => {
      const frame = tileAt(r);
      const centre = defocusing(tracedAt(frame, 0.5, 0.5));
      const one = renderFieldVolume(volume, () => centre, OPT);
      const four = renderFieldVolume(volume, fieldDefocusing(tracedFieldPupils(SYSTEM, frame)), {
        ...OPT,
        patches: 4,
      });
      return rel(four.intensity, one.intensity);
    };
    expect(moveAt(2.25, thin)).toBeCloseTo(2.6852e-2, 5);
    expect(moveAt(2.25, thick)).toBeCloseTo(2.0606e-2, 5);
    expect(moveAt(4.5, thin)).toBeCloseTo(5.5543e-2, 5);
    expect(moveAt(4.5, thick)).toBeCloseTo(4.1055e-2, 5);
    expect(moveAt(4.5, thick) / moveAt(4.5, thin)).toBeCloseTo(0.7392, 3);

    // The corollary that does NOT follow is "a thick specimen needs fewer
    // patches". Haze carries no detail and is nearly insensitive to which
    // patch's kernel formed it, so it enters both renders alike and enlarges
    // the denominator: what fell is the RELATIVE error, on a larger total. The
    // patch count is set by the in-focus content's share of the frame.
    //
    // On axis the dilution is absent and the ordering reverses, because there is
    // no throughput variation to dilute — the whole effect is aberration, which
    // the added slices carry too.
    expect(moveAt(0, thick)).toBeGreaterThan(moveAt(0, thin));
  });

  it("and four patches against eight says the decomposition is converging", () => {
    const thick = beads([-0.06, -0.03, 0, 0.03, 0.06]);
    const frame = tileAt(4.5);
    const pupils = fieldDefocusing(tracedFieldPupils(SYSTEM, frame));
    const four = renderFieldVolume(thick, pupils, { ...OPT, patches: 4 });
    const eight = renderFieldVolume(thick, pupils, { ...OPT, patches: 8 });
    expect(rel(eight.intensity, four.intensity)).toBeCloseTo(6.4632e-3, 5);
    // an order of magnitude under the 1-against-4 move, not two: the field is
    // not resolved at four patches, it is merely no longer ignored
    expect(rel(eight.intensity, four.intensity)).toBeLessThan(4.1055e-2 / 5);
  });
});

describe("§ 6bd.6 — what the patches buy is the phase, not the clip", () => {
  it("freeze one half of the pupil and the other half carries the effect", () => {
    const thick = beads([-0.06, -0.03, 0, 0.03, 0.06]);
    const split = (r: number) => {
      const frame = tileAt(r);
      const mid = tracedAt(frame, 0.5, 0.5);
      const one = renderFieldVolume(thick, () => defocusing(mid), OPT);
      const against = (pupils: Parameters<typeof renderFieldVolume>[1]): number =>
        rel(renderFieldVolume(thick, pupils, { ...OPT, patches: 4 }).intensity, one.intensity);
      return {
        full: against(fieldDefocusing(tracedFieldPupils(SYSTEM, frame))),
        phase: against((u, v) =>
          defocusing({ amplitude: mid.amplitude, phaseWaves: tracedAt(frame, u, v).phaseWaves }),
        ),
        amplitude: against((u, v) =>
          defocusing({ amplitude: tracedAt(frame, u, v).amplitude, phaseWaves: mid.phaseWaves }),
        ),
      };
    };

    const edge = split(4.5);
    expect(edge.full).toBeCloseTo(4.1055e-2, 5);
    expect(edge.phase).toBeCloseTo(3.9219e-2, 5);
    expect(edge.amplitude).toBeCloseTo(8.9971e-3, 5);
    // the aberration is 4.4× the clip even where the clip is at its worst
    expect(edge.phase / edge.amplitude).toBeGreaterThan(4);

    // On axis the amplitude half vanishes outright — 2.8e-7 against 1.8e-2 —
    // which is § 6bd.3's even function seen a third way: there is no clip
    // gradient at the axis to buy. A caller holding a throughput profile and no
    // traced wavefront has the small half of the effect everywhere, and none of
    // it here.
    const axis = split(0);
    expect(axis.amplitude).toBeLessThan(1e-6);
    expect(axis.phase).toBeCloseTo(axis.full, 6);
  });
});

describe("§ 6bd.7 — the haze fraction is the specimen's only if the specimen separates", () => {
  const frame = tileAt(4.5);
  const varying = fieldDefocusing(tracedFieldPupils(SYSTEM, frame));
  const constant = () => defocusing(tracedAt(frame, 0.5, 0.5));
  const zs = [-0.08, -0.04, 0, 0.04, 0.08];
  const halfDepthMm = (LAMBDA * 1e-6) / (2 * NA * NA);
  const build = (pattern: (x: number, zMm: number) => number): EmitterVolume => ({
    size: SIZE,
    slices: zs.map((zMm): EmitterSlice => {
      const values = new Float64Array(SIZE * SIZE);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) values[y * SIZE + x] = pattern(x, zMm);
      }
      return { zMm, field: { size: SIZE, values } };
    }),
  });
  const inFocus = (volume: EmitterVolume, pupils: Parameters<typeof renderFieldVolume>[1]): number =>
    renderFieldVolume(volume, pupils, { ...OPT, patches: 4 }).inFocusFraction;

  it("a specimen uniform across the field: the throughput cancels EXACTLY", () => {
    // The flux of patch p at depth z is T_p·F_{p,z}, and T cancels from the
    // ratio when F factors into a field pattern times a depth pattern. A slab
    // does, which is precisely why a slab could never have caught this.
    const slab = build((_x, zMm) => (Math.abs(zMm) <= halfDepthMm ? 3 : 1));
    const varied = inFocus(slab, varying);
    const flat = inFocus(slab, constant);
    expect(varied / flat - 1).toBeCloseTo(0, 14);
    expect(varied).toBeCloseTo(3 / 7, 12);
  });

  it("a specimen whose signal and whose haze sit at different field positions: it does not", () => {
    // In-focus material in the right half of the frame, haze in the left. Now
    // the two halves are weighted by different throughputs and § 6k.2's
    // "property of the specimen" acquires a condition.
    const split = build((x, zMm) =>
      Math.abs(zMm) <= halfDepthMm ? (x >= SIZE / 2 ? 5 : 0.2) : x >= SIZE / 2 ? 0.2 : 5,
    );
    const varied = inFocus(split, varying);
    const flat = inFocus(split, constant);
    expect(flat).toBeCloseTo(0.2, 12);
    expect(varied).toBeCloseTo(0.19927341, 7);
    expect(varied / flat - 1).toBeCloseTo(-3.6329e-3, 6);
    // and it is the throughput span that carries it — a fifth of 1.699e-2,
    // which is the fraction of the frame the two halves actually disagree over
    expect(Math.abs(varied / flat - 1)).toBeLessThan(1.699e-2);
    expect(Math.abs(varied / flat - 1)).toBeGreaterThan(1e-3);
  });
});

describe("§ 6bd.8 — the lattice's Nyquist and the frame's containment are one limit", () => {
  it("both give pupilSamples/8, and the escape at that defocus is measured", () => {
    // The blur radius is 4·n·|w|·size/pupilSamples pixels against a half-frame
    // of size/2; the pupil's phase step is 4·|w|/pupilSamples waves against ½.
    // They are the same statement twice — the shift theorem reads a phase ramp
    // of half a wave per sample as a displacement of half a grid.
    const pupil = idealPupil() as PupilFunction;
    const measured: number[] = [];
    for (const ps of [16, 24, 32]) {
      const limit = containedDefocusWaves(ps);
      expect(limit).toBe(ps / 8);
      const kernel = incoherentPsf(withDefocus(pupil, limit), { pupilSamples: ps, size: SIZE });
      // 4w/ps is exactly ½; the lattice's outermost transmitting sample is not
      // quite at the rim, so the reported step falls a few percent short of it
      expect((4 * limit) / ps).toBeCloseTo(0.5, 12);
      expect(kernel.maxGridPhaseStepWaves).toBeGreaterThan(0.46);
      expect(kernel.maxGridPhaseStepWaves).toBeLessThan(0.5);
      measured.push(escaped(pupil, limit, SIZE, ps));
    }
    expect(measured[0]).toBeCloseTo(0.0719, 3);
    expect(measured[1]).toBeCloseTo(0.0545, 3);
    expect(measured[2]).toBeCloseTo(0.0453, 3);
    // and a quarter past it the three converge, which is what makes this a knee
    // rather than a slope: below the limit they are 7.19/5.45/4.53% and ordered
    // by pupilSamples, above it they are within one point of each other and the
    // ordering has gone.
    const past = [16, 24, 32].map((ps) =>
      escaped(pupil, containedDefocusWaves(ps) * 1.25, SIZE, ps),
    );
    expect(past[0]).toBeCloseTo(0.1646, 3);
    expect(past[1]).toBeCloseTo(0.1568, 3);
    expect(past[2]).toBeCloseTo(0.1573, 3);
    expect(Math.max(...past) - Math.min(...past)).toBeLessThan(0.01);
    // where below the limit the same three span more than 2.5 points
    expect(Math.max(...measured) - Math.min(...measured)).toBeGreaterThan(0.025);
  });

  it("on a TRACED pupil the identity is not exact, and the readout survives it", () => {
    // An aberrated pupil has spent part of the same budget before any defocus is
    // applied, so pupilSamples/8 is no longer where the knee sits — on axis the
    // step is already 0.245 waves at zero defocus. Read against
    // `maxGridPhaseStepWaves` instead of against the defocus and five pupils
    // spanning 1.60 to 3.13 waves collapse onto one escape.
    const cases: [string, PupilFunction][] = [
      ["ideal", idealPupil() as PupilFunction],
      ["axis", tracedAt(tileAt(0), 0.5, 0.5)],
      ["4.5 mm", tracedAt(tileAt(4.5), 0.5, 0.5)],
      ["6 mm", tracedAt(tileAt(6), 0.5, 0.5)],
      ["4.5 mm corner", tracedAt(tileAt(4.5), 0.9375, 0.9375)],
    ];
    const step = (pupil: PupilFunction, waves: number): number =>
      incoherentPsf(withDefocus(pupil, waves), { pupilSamples: PS, size: SIZE })
        .maxGridPhaseStepWaves;
    expect(step(cases[1]![1], 0)).toBeCloseTo(0.245, 2);

    const atHalfWave: number[] = [];
    const defocus: number[] = [];
    for (const [, pupil] of cases) {
      let lo = 0;
      let hi = 6;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (step(pupil, mid) < 0.5) lo = mid;
        else hi = mid;
      }
      const waves = (lo + hi) / 2;
      defocus.push(waves);
      atHalfWave.push(escaped(pupil, waves, SIZE, PS));
    }
    // the defocus that reaches a half-wave step spans very nearly 2×…
    expect(Math.min(...defocus)).toBeCloseTo(1.5965, 3);
    expect(Math.max(...defocus)).toBeCloseTo(3.1304, 3);
    expect(Math.max(...defocus) / Math.min(...defocus)).toBeGreaterThan(1.9);
    // …and the escape at it spans well under that
    expect(Math.min(...atHalfWave)).toBeCloseTo(0.0367, 3);
    expect(Math.max(...atHalfWave)).toBeCloseTo(0.0649, 3);
    expect(Math.max(...atHalfWave) / Math.min(...atHalfWave)).toBeLessThan(1.8);
  });

  it("and the renderer reports the step it is guarded by", () => {
    // No `escapedFraction` is minted: measuring one takes a grid of double the
    // extent, which is a second render, and an estimate reported as a
    // measurement is the shape of trap § 6bc spent a step removing.
    const deep = renderFieldVolume(beads([-0.45, 0, 0.45]), () => defocusing(idealPupil() as PupilFunction), OPT);
    const shallow = renderFieldVolume(beads([-0.03, 0, 0.03]), () => defocusing(idealPupil() as PupilFunction), OPT);
    expect(deep.maxGridPhaseStepWaves).toBeGreaterThan(0.5);
    expect(shallow.maxGridPhaseStepWaves).toBeLessThan(0.1);
    expect(containedDefocusWaves(PS)).toBe(3);
    expect(() => containedDefocusWaves(0)).toThrow(/positive/);
  });
});
