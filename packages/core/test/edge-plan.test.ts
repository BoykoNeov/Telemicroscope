import { describe, it, expect } from "vitest";
import { edgePlan, incoherentPsf, uniformEmitters, type EdgePlan } from "../src/imaging/fluorescence";
import { depthKernels, renderVolume, withDefocus } from "../src/imaging/volume";
import {
  mountAperture,
  mountPupils,
  mountSinAlpha,
  mountVolumeOptions,
  withMountAberration,
  type MountSpec,
} from "../src/imaging/depth-aberration";
import { fieldPupilAt, objectFieldTile } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { idealPupil } from "../src/illumination/transfer";
import { getMedium } from "../src/materials/catalog";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 2q.7 — the rim is laid out once per outline.
 *
 * § 2q.4's crossing rule resolves a cut cell by bisecting every place the outline
 * crosses a line through it: about 230 amplitude questions per cell against about
 * 20 phase questions. All of that is read off the AMPLITUDE, and a focus sweep, a
 * depth stack or a defocus search asks the same outline again for every kernel —
 * § 6l.6 pins that a depth's aberration changes no amplitude, and `withDefocus` is
 * phase only. Measured on the app's depth panel (32 bins, 64², oil 100×/1.40 into
 * water): one kernel asks the pupil 78 716 amplitudes and 6 709 phases with the
 * rim resolved, against 1 089 and 733 without — and switching the rim on there
 * cost 20–25×, of which sharing the pupil's memo across depths bought back 8%.
 *
 * **Change:** `edgePlan` lays the rim out once — the mask, and every cut cell's
 * points, weights and amplitudes — and `incoherentPsf` sums a plan by asking the
 * pupil only its phase. A call without a plan lays out its own, so there is one
 * code path, and every kernel is bitwise what it was before (checked on 156
 * pupil × option pairs against the pre-change engine, both rules, 24–128 bins).
 *
 * **Refuted by** a kernel formed through a plan that differs from the one formed
 * without it in any bit, a plan that saves no amplitude questions, or a plan
 * accepted on an outline it was not laid out on.
 *
 * External number: the engine without a plan, bitwise; and an ellipse's area πab
 * through a reused plan, as § 2q.4 pinned it fresh.
 */

const EDGE = 8;
const LAMBDA = 550;

/** A unit disc with W = w20·ρ² + w40·ρ⁴ waves and a tilt, amplitude apodized. */
const disc = (w40: number, r = 1): PupilFunction => ({
  amplitude: (x, y) => (x * x + y * y <= r * r ? 1 - 0.2 * (x * x + y * y) : 0),
  phaseWaves: (x, y) => {
    const r2 = x * x + y * y;
    return w40 * r2 * r2 + 0.13 * x;
  },
});

/** An ellipse with semi-axes a, b, centred at (cx, cy) and turned by θ. */
const ellipse = (a: number, b: number, cx: number, cy: number, theta: number): PupilFunction => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    amplitude: (x, y) => {
      const u = (x - cx) * c + (y - cy) * s;
      const v = -(x - cx) * s + (y - cy) * c;
      return (u / a) ** 2 + (v / b) ** 2 <= 1 ? 1 : 0;
    },
    phaseWaves: () => 0,
  };
};

/** Oil 100×/1.40 into water — the mount wall truncates the cone at n_water. */
const OIL_WATER: MountSpec = {
  mountIndex: getMedium("WATER").n(LAMBDA),
  immersionIndex: getMedium("IMMERSION-OIL").n(LAMBDA),
  numericalAperture: 1.4,
  wavelengthNm: LAMBDA,
  focusDepthMm: 0.004,
};

const SYSTEM = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;
const traced = (xMm: number) =>
  fieldPupilAt(
    SYSTEM,
    objectFieldTile(SYSTEM, { size: 64, pupilSamples: 32, layout: "exit", wavelengthNm: LAMBDA, centreMm: { x: xMm, y: 0 } }),
    0.5,
    0.5,
  ).pupil;

const opts = (pupilSamples: number, size: number, plan?: EdgePlan) => ({
  pupilSamples,
  size,
  edgeSamples: EDGE,
  edgeRule: "crossing" as const,
  ...(plan === undefined ? {} : { edgePlan: plan }),
});

function expectSameKernel(a: ReturnType<typeof incoherentPsf>, b: ReturnType<typeof incoherentPsf>): void {
  expect(a.values.length).toBe(b.values.length);
  let differing = 0;
  for (let i = 0; i < a.values.length; i++) if (!Object.is(a.values[i], b.values[i])) differing++;
  expect(differing).toBe(0);
  expect(Object.is(a.energy, b.energy)).toBe(true);
  expect(Object.is(a.formedSum, b.formedSum)).toBe(true);
  expect(Object.is(a.edgeFloor, b.edgeFloor)).toBe(true);
  expect(a.edgeCells).toBe(b.edgeCells);
  expect(a.transmittingSamples).toBe(b.transmittingSamples);
  expect(Object.is(a.maxGridPhaseStepWaves, b.maxGridPhaseStepWaves)).toBe(true);
}

/** The pupil, with its amplitude and phase questions counted. */
function counted(p: PupilFunction) {
  const asked = { amplitude: 0, phase: 0 };
  const pupil: PupilFunction = {
    amplitude: (x, y) => (asked.amplitude++, p.amplitude(x, y)),
    phaseWaves: (x, y) => (asked.phase++, p.phaseWaves(x, y)),
  };
  return { pupil, asked };
}

describe("§ 2q.7 — the rim is laid out once per outline", () => {
  it("a defocus sweep through one plan is bitwise the sweep without it", () => {
    for (const [ps, size] of [[24, 64], [47, 64], [64, 128]] as const) {
      const base = disc(-0.6);
      const plan = edgePlan(base, opts(ps, size));
      for (const w of [-2.5, -0.5, 0, 0.75, 3]) {
        const pupil = withDefocus(base, w);
        expectSameKernel(incoherentPsf(pupil, opts(ps, size, plan)), incoherentPsf(pupil, opts(ps, size)));
      }
    }
  });

  it("a mount's depth stack shares one plan: the wall's outline does not move with depth (§ 6l.6)", () => {
    // 1.40 into water is truncated at the wall, so the outline here is the
    // mount's, not the objective's — the rim the app's depth panel resolves.
    expect(mountAperture(OIL_WATER)).toBeLessThan(OIL_WATER.numericalAperture);
    for (const base of [idealPupil(), traced(0)]) {
      const plan = edgePlan(withMountAberration(base, OIL_WATER, 0), opts(32, 64));
      for (const depthMm of [0.0005, 0.002, 0.008]) {
        for (const w of [-1, 0.4]) {
          const pupil = withDefocus(withMountAberration(base, OIL_WATER, depthMm), w);
          expectSameKernel(incoherentPsf(pupil, opts(32, 64, plan)), incoherentPsf(pupil, opts(32, 64)));
        }
      }
    }
  });

  it("and so do depthKernels and renderVolume, which carry it to every slice", () => {
    const sinAlpha = mountSinAlpha(OIL_WATER);
    const pupils = mountPupils(traced(0), OIL_WATER, sinAlpha);
    const plan = edgePlan(pupils(0), opts(32, 64));
    const waves = [-1.5, -0.25, 0, 1];
    const fresh = depthKernels(pupils, waves, { ...opts(32, 64), cellQuadrature: true });
    const reused = depthKernels(pupils, waves, { ...opts(32, 64, plan), cellQuadrature: true });
    fresh.forEach((k, i) => {
      expectSameKernel(reused[i]!, k);
      expect(Object.is(reused[i]!.relativeThroughput, k.relativeThroughput)).toBe(true);
    });
    const slices = [0.002, 0.004, 0.006].map((zMm) => ({ zMm, field: uniformEmitters(64, 1 / (64 * 64)) }));
    const volume = (edgePlan?: EdgePlan) =>
      renderVolume(
        { size: 64, slices },
        pupils,
        mountVolumeOptions(OIL_WATER, {
          pupilSamples: 32,
          edgeSamples: EDGE,
          edgeRule: "crossing",
          cellQuadrature: true,
          ...(edgePlan === undefined ? {} : { edgePlan }),
        }),
      );
    const a = volume();
    const b = volume(plan);
    let differing = 0;
    for (let i = 0; i < a.intensity.length; i++) if (!Object.is(a.intensity[i], b.intensity[i])) differing++;
    expect(differing).toBe(0);
    a.sliceFlux.forEach((f, i) => expect(Object.is(b.sliceFlux[i], f)).toBe(true));
  });

  it("a reused plan asks the outline about the lattice, not about the rim — the phases are unchanged", () => {
    // Measured: 78 892 amplitudes fresh at 32 bins and 1 561 through the plan —
    // the lattice box's 1 089, then the guard's first recorded point and one
    // probe pair per cut cell that has them (360 cells, 240 probes); 6 757 phases
    // both ways. At 128 bins, 345 468 against 18 585 (1 464 cells).
    for (const [ps, size] of [[32, 64], [128, 256]] as const) {
      const base = withMountAberration(idealPupil(), OIL_WATER, 0.002);
      const plan = edgePlan(base, opts(ps, size));
      const fresh = counted(base);
      const reused = counted(base);
      const k = incoherentPsf(fresh.pupil, opts(ps, size));
      incoherentPsf(reused.pupil, opts(ps, size, plan));
      const box = (Math.floor(ps / 2) * 2 + 1) ** 2;
      expect(reused.asked.phase).toBe(fresh.asked.phase);
      expect(reused.asked.amplitude).toBeLessThanOrEqual(box + 3 * k.edgeCells!);
      expect(fresh.asked.amplitude).toBeGreaterThan(10 * reused.asked.amplitude);
    }
  });

  it("an ellipse moved and turned keeps πab through a plan reused over a defocus sweep", () => {
    // § 2q.4's pin, read through the reuse: located, under 2.5e-9 of πab from 47
    // bins up. The energy is ⟨A²⟩, the amplitude's, so the sweep may move it only
    // by rounding: a cut cell adds it as |⟨P⟩|² plus the deficit ⟨A²⟩ − |⟨P⟩|², and
    // both halves move with the phase. Measured 1.6e-15 across the sweep.
    const a = 0.9;
    const b = 0.9 / 1.003;
    const shape = ellipse(a, b, 0.013, -0.021, 0.37);
    const ps = 47;
    const step = 2 / ps;
    const plan = edgePlan(shape, opts(ps, 64));
    const energies = [-2, 0, 1.25].map((w) => incoherentPsf(withDefocus(shape, w), opts(ps, 64, plan)).energy);
    for (const e of energies) {
      expect(Math.abs(e / energies[0]! - 1)).toBeLessThan(1e-14);
      expect(Math.abs((e * step * step) / (Math.PI * a * b) - 1)).toBeLessThan(2.5e-9);
    }
  });

  it("refuses a plan on any other outline — a rim moved by a ten-thousandth of a cell, another field point, another amplitude", () => {
    const ps = 32;
    const step = 2 / ps;
    const plan = edgePlan(disc(0, 0.9), opts(ps, 64));
    // Unchanged outline, other phase: accepted.
    expect(() => incoherentPsf(disc(1.5, 0.9), opts(ps, 64, plan))).not.toThrow();
    for (const fraction of [0.5, 0.1, 1e-2, 1e-3, 1e-4]) {
      expect(() => incoherentPsf(disc(0, 0.9 + fraction * step), opts(ps, 64, plan))).toThrow(/does not fit this pupil/);
      expect(() => incoherentPsf(disc(0, 0.9 - fraction * step), opts(ps, 64, plan))).toThrow(/does not fit this pupil/);
    }
    // Same outline, other amplitude: the apodization is gone.
    const flat: PupilFunction = { amplitude: (x, y) => (x * x + y * y <= 0.81 ? 1 : 0), phaseWaves: () => 0 };
    expect(() => incoherentPsf(flat, opts(ps, 64, plan))).toThrow(/does not fit this pupil/);
    // The traced rim changes shape with field (§ 2q.4): an axial plan is refused at 2 mm.
    const axial = edgePlan(traced(0), opts(ps, 64));
    expect(() => incoherentPsf(traced(0), opts(ps, 64, axial))).not.toThrow();
    expect(() => incoherentPsf(traced(2), opts(ps, 64, axial))).toThrow(/does not fit this pupil/);
  });

  it("refuses a plan on another lattice or rule, and will not lay out the count", () => {
    const base = disc(0.3);
    const plan = edgePlan(base, opts(32, 64));
    expect(() => incoherentPsf(base, opts(32, 128, plan))).toThrow(/edgePlan was laid out/);
    expect(() => incoherentPsf(base, { ...opts(32, 64, plan), edgeSamples: 16 })).toThrow(/edgePlan was laid out/);
    expect(() => incoherentPsf(base, { pupilSamples: 32, size: 64, edgePlan: plan })).toThrow(/edgePlan was laid out/);
    expect(() => incoherentPsf(base, { ...opts(32, 64, plan), edgeRule: "count" })).toThrow(/edgePlan was laid out/);
    expect(() => edgePlan(base, { pupilSamples: 32, size: 64, edgeSamples: EDGE, edgeRule: "count" })).toThrow(
      /only the "crossing" rule/,
    );
    expect(() => edgePlan(base, { pupilSamples: 32, size: 64, edgeSamples: 1 })).toThrow(/edgeSamples > 1/);
    expect(() => edgePlan(base, { pupilSamples: 63, size: 64, edgeSamples: EDGE, edgeRule: "crossing" })).toThrow(
      /does not fit a 64-bin grid/,
    );
  });
});
