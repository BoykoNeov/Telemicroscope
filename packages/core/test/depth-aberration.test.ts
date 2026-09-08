import { describe, it, expect } from "vitest";
import {
  deliveredNaIntoMount,
  depthFocusShiftMm,
  depthOpdMm,
  mountDepthScale,
  mountDepthTolerance,
  stackApparentDistanceMm,
  stackLongitudinalAberrationMm,
  stackW040Mm,
  stackWavefrontErrorMm,
} from "../src/designs/coverslip";
import {
  mountAperture,
  mountDefocusWaves,
  mountPupils,
  mountSinAlpha,
  mountVolumeOptions,
  mountWavefrontWaves,
  withMountAberration,
  type MountSpec,
} from "../src/imaging/depth-aberration";
import {
  axialSpectrum,
  axialTransfer,
  defocusing,
  depthKernels,
  ewaldConeEdge,
  exactDepthFactor,
  objectDefocusing,
  objectSinAlpha,
  renderVolume,
  withDefocus,
  withObjectDefocus,
} from "../src/imaging/volume";
import { incoherentPsf, uniformEmitters } from "../src/imaging/fluorescence";
import { depthOfFocusMm, exactDepthOfFocusMm } from "../src/imaging/emission";
import { fieldDefocusing } from "../src/imaging/field-volume";
import { idealPupil } from "../src/illumination/transfer";
import type { PupilFunction } from "../src/wave/psf";
import { getMedium } from "../src/materials/catalog";

/**
 * § 6l — depth-dependent spherical aberration.
 *
 * § 6k's named deferral and the last numbered gap in the microscope branch. It
 * images a volume through a pupil that varies with depth only by defocus, and a
 * real specimen is mounted in a medium whose index is not the immersion's — so
 * focusing d below the coverslip drags the cone through d of the wrong glass and
 * adds spherical aberration that GROWS with d. That is the dominant real defect
 * of deep widefield and confocal imaging.
 *
 * The step adds no physics. § 6c solves a plate to all orders and § 6e.1 the
 * N-layer stack; a focal depth is one more layer, t = d and n = n_s. What the
 * rungs here pin is that the reuse is legitimate, what it costs, and the two
 * places the branch's own habits mislead:
 *
 *  - the literature quotes the depth OPD in a DIFFERENT REFERENCE, and the two
 *    forms disagree in q⁴ *because* they are related by an exact refocus — which
 *    reads exactly backwards (§ 6l.1);
 *  - the third-order budget everything else in § 6c is quoted in stops being a
 *    bound far sooner against a mount than against a slip, because the mount's
 *    index is the smallest number in the stack (§ 6l.4).
 *
 * And the headline is not an aberration at all: no ray of invariant above n_s
 * leaves the specimen, so an oil objective engraved 1.40 collects at most 1.3347
 * from a water mount (§ 6l.3).
 */

const LAMBDA = 550;
const SIZE = 128;
const PUPIL_SAMPLES = 32;

const N_OIL = getMedium("IMMERSION-OIL").n(LAMBDA);
const N_WATER = getMedium("WATER").n(LAMBDA);
const N_SLIP = getMedium("D263").n(LAMBDA);

/** A water mount under an oil objective — the mismatch every rung here uses. */
const mount = (numericalAperture: number, focusDepthMm = 0): MountSpec => ({
  mountIndex: N_WATER,
  immersionIndex: N_OIL,
  numericalAperture,
  wavelengthNm: LAMBDA,
  focusDepthMm,
});

const waterLayer = (depthMm: number) => [{ thicknessMm: depthMm, n: N_WATER }];

const psf = (spec: MountSpec, depthMm: number, waves: number) =>
  incoherentPsf(withDefocus(withMountAberration(idealPupil(), spec, depthMm), waves), {
    size: SIZE,
    pupilSamples: PUPIL_SAMPLES,
  });

/** Peak intensity at best focus, relative to an unaberrated pupil: the Strehl. */
const bestStrehl = (spec: MountSpec, depthMm: number): number => {
  const reference = incoherentPsf(idealPupil(), { size: SIZE, pupilSamples: PUPIL_SAMPLES })
    .values[0]!;
  let best = -1;
  let coarse = 0;
  for (let i = -60; i <= 60; i++) {
    const w = i * 0.05;
    const v = psf(spec, depthMm, w).values[0]!;
    if (v > best) {
      best = v;
      coarse = w;
    }
  }
  for (let i = -20; i <= 20; i++) {
    const v = psf(spec, depthMm, coarse + i * 0.005).values[0]!;
    if (v > best) best = v;
  }
  return best / reference;
};

describe("§ 6l.1 — the literature's depth OPD is the engine's stack plus an EXACT refocus", () => {
  const D = 0.01;

  it("differs from it by a shift and a piston, to f64, at every aperture", () => {
    // `depthOpdMm` is written the way Gibson-Lanni and Hell et al. quote it and
    // is derived independently of the stack — so this is a genuine external
    // check and not a rearrangement of one expression into another.
    //
    //   OPD(q) = W_stack(q) + δ·[√(n_i²−q²) − n_i] + d·(n_s − n_i)
    //
    // with δ = `depthFocusShiftMm`. The stack is referenced to the buried
    // source's PARAXIAL IMAGE; the literature to the objective's NOMINAL focus.
    // The whole of the difference is the axial distance between those two points
    // and a piston, both in closed form.
    const delta = depthFocusShiftMm(D, N_WATER, N_OIL);
    const piston = D * (N_WATER - N_OIL);
    for (const q of [0, 0.3, 0.6, 0.9, 1.2, 1.25, 1.33]) {
      const shift = delta * (Math.sqrt(N_OIL * N_OIL - q * q) - N_OIL);
      const residual = depthOpdMm(D, N_WATER, N_OIL, q) - stackWavefrontErrorMm(waterLayer(D), N_OIL, q) - shift - piston;
      // Flat across the aperture rather than growing, which is what separates an
      // identity from a fit that happens to be good near the axis.
      expect(Math.abs(residual)).toBeLessThan(1e-17);
    }
  });

  it("and the q⁴ coefficients DISAGREE — which is the evidence, not the error", () => {
    // The trap. The natural check is to compare third-order coefficients, and it
    // fails: −1.19130e-4 against −1.68153e-4 per q⁴ for 10 µm of water under oil,
    // a factor of 1.4115. An exact axial shift δ in a medium of index n is
    // δ·[√(n²−q²) − n], whose expansion is −δq²/(2n) − δq⁴/(8n³) − …: it carries
    // q⁴ and every higher even order, and only its LEADING part is defocus. So
    // two expressions genuinely related by a refocus MUST disagree in q⁴.
    const engineQ4 = stackW040Mm(waterLayer(D), N_OIL, 1);
    const literatureQ4 = (-D / 8) * (1 / N_WATER ** 3 - 1 / N_OIL ** 3);
    expect(engineQ4).toBeCloseTo(-1.19130e-4, 9);
    expect(literatureQ4).toBeCloseTo(-1.68153e-4, 9);
    expect(literatureQ4 / engineQ4).toBeCloseTo(1.4115, 4);

    // And the gap IS the shift's own q⁴, to f64 — so comparing third-order
    // coefficients cannot tell a wrong wavefront from a differently-referenced
    // one, and the all-orders identity above can.
    const shiftQ4 = -depthFocusShiftMm(D, N_WATER, N_OIL) / (8 * N_OIL ** 3);
    expect(Math.abs((engineQ4 + shiftQ4) / literatureQ4 - 1)).toBeLessThan(1e-15);
  });

  it("with the shift being § 6e.1's own apparent distance, not a second formula", () => {
    const delta = depthFocusShiftMm(D, N_WATER, N_OIL);
    expect(delta).toBeCloseTo((D * (N_OIL - N_WATER)) / N_WATER, 18);
    expect(delta + D).toBeCloseTo(stackApparentDistanceMm(waterLayer(D), N_OIL), 18);
  });
});

describe("§ 6l.2 — linear in depth exactly, and a matched mount is a HARD zero", () => {
  it("doubling the depth doubles the wavefront at every aperture, to f64", () => {
    // d is a bare factor in the stack, so this is not a small-aberration
    // approximation holding — it is exact, at NA 1.3 as much as at NA 0.1.
    for (const q of [0.1, 0.5, 1.0, 1.3]) {
      const one = stackWavefrontErrorMm(waterLayer(0.007), N_OIL, q);
      const two = stackWavefrontErrorMm(waterLayer(0.014), N_OIL, q);
      expect(two / one).toBeCloseTo(2, 14);
    }
  });

  it("and a mount matched to the immersion aberrates identically zero, not nearly", () => {
    // § 6e.1's identity, arriving where a microscopist meets it: this is why
    // water and glycerol objectives exist. The (n²−n_out²) factor sits in the
    // numerator, so the answer is a hard zero rather than a cancellation.
    for (const depthMm of [0.001, 0.05, 1.0]) {
      for (const q of [0.2, 0.9, 1.4]) {
        expect(stackWavefrontErrorMm([{ thicknessMm: depthMm, n: N_OIL }], N_OIL, q)).toBe(0);
      }
      expect(mountWavefrontWaves(
        { ...mount(1.2), mountIndex: N_OIL, immersionIndex: N_OIL },
        depthMm,
        1,
      )).toBe(0);
    }
  });

  it("so the wavefront in waves is the stack's, divided by λ and nothing else", () => {
    const spec = mount(1.2);
    for (const rho of [0.25, 0.5, 1]) {
      const q = spec.numericalAperture * rho;
      expect(mountWavefrontWaves(spec, 0.01, rho)).toBeCloseTo(
        stackWavefrontErrorMm(waterLayer(0.01), N_OIL, q) / (LAMBDA * 1e-6),
        14,
      );
    }
  });
});

describe("§ 6l.3 — the wall is the ray invariant, and it is not an aberration", () => {
  it("caps the delivered aperture at the mount's own index, exactly", () => {
    // A ray inside the specimen carries q = n_s·sinθ_s < n_s. An oil objective
    // engraved 1.40 therefore collects at most 1.3347 from a water mount — the
    // fifth geometric ceiling in this branch, after § 6b's f/4.1, § 6d's
    // NA 0.343, § 6e.4's NA 1.411 and § 6q's 0.88·f_e, and the only one that is
    // one line of algebra.
    expect(deliveredNaIntoMount(1.4, N_WATER)).toBe(N_WATER);
    expect(mountAperture(mount(1.4))).toBe(N_WATER);
    // A mount denser than the objective's rim takes nothing away.
    expect(deliveredNaIntoMount(1.4, N_SLIP)).toBe(1.4);
    expect(mountAperture(mount(1.2))).toBe(1.2);
  });

  it("with the boundary at exactly n_s — one ulp below computes, at it refuses", () => {
    const justInside = N_WATER - 1e-9;
    expect(Number.isFinite(stackWavefrontErrorMm(waterLayer(0.01), N_OIL, justInside))).toBe(true);
    expect(() => stackWavefrontErrorMm(waterLayer(0.01), N_OIL, N_WATER)).toThrow(
      /never leaves that layer/,
    );
    expect(() => depthOpdMm(0.01, N_WATER, N_OIL, N_WATER)).toThrow(/leaves the specimen/);
  });

  it("and the WAVEFRONT stays finite there while the LONGITUDINAL aberration diverges", () => {
    // The two behave oppositely at the wall and it is worth pinning which is
    // which. `stackLongitudinalAberrationMm` keeps √(n_s²−q²) in its denominator
    // — the grazing ray's axial crossing runs away — where the rationalised
    // wavefront keeps it as a factor beside terms that stay finite. So nothing is
    // clipped by an aberration budget: the rays simply stop existing.
    const near = (f: number) => N_WATER * f;
    const w = [0.9, 0.99, 0.999, 0.9999].map((f) =>
      Math.abs(stackWavefrontErrorMm(waterLayer(0.01), N_OIL, near(f))),
    );
    const lsa = [0.9, 0.99, 0.999, 0.9999].map((f) =>
      Math.abs(stackLongitudinalAberrationMm(waterLayer(0.01), N_OIL, near(f))),
    );
    // The wavefront converges to an ordinary number: 4.3039e-3 mm AT the wall,
    // and 4.1184e-3 a ten-thousandth of the way inside it.
    expect(w[3]! / w[0]!).toBeLessThan(6);
    expect(w[3]!).toBeCloseTo(4.1184e-3, 6);
    expect(Math.abs(stackWavefrontErrorMm(waterLayer(0.01), N_OIL, N_WATER - 1e-9))).toBeCloseTo(
      4.30385e-3,
      7,
    );
    // The longitudinal aberration grows without bound, as 1/√(n_s²−q²): a
    // hundredfold closer to the wall is tenfold larger.
    expect(lsa[3]! / lsa[2]!).toBeGreaterThan(3);
    expect(lsa[3]! / lsa[0]!).toBeGreaterThan(20);
  });

  it("truncating the pupil to it — a LATTICE POINT COUNT converging on the area ratio", () => {
    // The truncation is an amplitude, not a phase, so it costs flux: an oil 1.40
    // on a water mount images through an effectively 1.3347 pupil. What the
    // engine reports is the fraction of pupil LATTICE POINTS inside the ceiling,
    // which is § 6i.2's finding again — a count, not an area — so it converges on
    // (n_s/NA)² without a rate being claimed for it.
    const spec = mount(1.4);
    const area = (N_WATER / 1.4) ** 2;
    const ratioAt = (pupilSamples: number): number => {
      const size = Math.max(128, pupilSamples * 4);
      const full = incoherentPsf(idealPupil(), { size, pupilSamples }).formedSum;
      const truncated = incoherentPsf(withMountAberration(idealPupil(), spec, 0), {
        size,
        pupilSamples,
      }).formedSum;
      return truncated / full;
    };
    expect(ratioAt(16)).toBeCloseTo(0.9391, 3);
    expect(ratioAt(64)).toBeCloseTo(0.9140, 3);
    expect(Math.abs(ratioAt(256) - area)).toBeLessThan(1e-3);
    // A pupil the mount can carry whole is untouched — no mask, and the SAME
    // object back, so nothing downstream pays for a wrapper that does nothing.
    const carried = idealPupil();
    expect(withMountAberration(carried, mount(1.2), 0)).toBe(carried);
  });
});

describe("§ 6l.4 — the budget runs as 1/NA⁴, and stops being a bound sooner than the slip's", () => {
  it("is exactly 1/NA⁴, both criteria, and 4× apart", () => {
    const a = mountDepthTolerance(0.5, LAMBDA, N_WATER, N_OIL);
    const b = mountDepthTolerance(1.0, LAMBDA, N_WATER, N_OIL);
    expect(a.marechalMm / b.marechalMm).toBeCloseTo(16, 12);
    expect(a.quarterWaveMm / b.quarterWaveMm).toBeCloseTo(16, 12);
    // Maréchal's balanced residual against Rayleigh's raw quarter wave: the
    // factor is 24√5/14, the same one `coverslipTolerance` carries.
    expect(a.marechalMm / a.quarterWaveMm).toBeCloseTo((24 * Math.sqrt(5)) / 14, 12);
    // The numbers, at an aperture a water mount can actually deliver.
    expect(b.quarterWaveMm * 1000).toBeCloseTo(11.542, 3);
    expect(b.marechalMm * 1000).toBeCloseTo(44.244, 3);
  });

  it("refuses an aperture the mount cannot deliver, and a matched mount outright", () => {
    expect(() => mountDepthTolerance(1.4, LAMBDA, N_WATER, N_OIL)).toThrow(/does not exist|not delivered/);
    expect(() => mountDepthTolerance(1.0, LAMBDA, N_OIL, N_OIL)).toThrow(/identically zero/);
  });

  it("but the exact wavefront outruns its own leading term as NA nears the MOUNT's index", () => {
    // The mount's index is the smallest number anywhere in an immersion stack,
    // so it — not the objective — is what sets where third-order theory dies.
    const ratio = (n: number, NA: number) =>
      stackWavefrontErrorMm([{ thicknessMm: 0.01, n }], N_OIL, NA) /
      stackW040Mm([{ thicknessMm: 0.01, n }], N_OIL, NA);
    expect(ratio(N_WATER, 0.2)).toBeCloseTo(1.0203, 3);
    expect(ratio(N_WATER, 1.0)).toBeCloseTo(1.9417, 3);
    expect(ratio(N_WATER, 1.2)).toBeCloseTo(3.2870, 3);
    expect(ratio(N_WATER, 1.3)).toBeCloseTo(5.7947, 3);
    // The same oil, a D263 slip instead of a water mount: at NA 1.2 the departure
    // is 2.50 rather than 3.29, because 1.5254 is a long way from 1.2 and 1.3347
    // is not.
    expect(ratio(N_SLIP, 1.2)).toBeCloseTo(2.4953, 3);
  });

  it("so against a BISECTED Strehl the third-order budget over-reports 4.5× at NA 1.2", () => {
    // § 6d's discipline — Maréchal reached by bisection on the real thing rather
    // than quoted off a coefficient. The departure is named rather than dressed
    // up, exactly as § 6s reports its map's error as an estimate and not a bound.
    const bisectDepth = (NA: number): number => {
      let lo = 1e-5;
      let hi = 0.5;
      for (let i = 0; i < 22; i++) {
        const mid = 0.5 * (lo + hi);
        if (bestStrehl(mount(NA), mid) >= 0.8) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const measured = bisectDepth(1.2);
    // 4.74 µm — the classic "an oil lens on an aqueous specimen is good for a few
    // microns", produced rather than transcribed.
    expect(measured * 1000).toBeCloseTo(4.74, 1);
    const quoted = mountDepthTolerance(1.2, LAMBDA, N_WATER, N_OIL).marechalMm;
    expect(quoted / measured).toBeCloseTo(4.51, 1);
    // And it is a real trend, not one bad point: the over-report shrinks toward
    // the axis, where third-order theory is entitled to be right.
    const low = bisectDepth(0.6);
    expect(mountDepthTolerance(0.6, LAMBDA, N_WATER, N_OIL).marechalMm / low).toBeCloseTo(1.25, 1);
  }, 60_000);
});

describe("§ 6l.5 — the focus-knob scaling, and its spread across the aperture IS the aberration", () => {
  const D = 0.01;

  it("is n_i/n_s paraxially — so a z-stack indexed by knob travel overestimates depth", () => {
    // The single most-inverted factor in the subject, so both currencies. The
    // objective travels n_i/n_s per unit of real depth: 1.1371 for oil into
    // water. A stack labelled by knob travel is therefore STRETCHED, and the
    // correction multiplies nominal z by n_s/n_i = 0.8794.
    expect(mountDepthScale(N_WATER, N_OIL)).toBeCloseTo(1.13709, 5);
    expect(1 / mountDepthScale(N_WATER, N_OIL)).toBeCloseTo(0.87944, 5);
    expect(stackApparentDistanceMm(waterLayer(D), N_OIL) / D).toBeCloseTo(
      mountDepthScale(N_WATER, N_OIL),
      14,
    );
  });

  it("and the MARGINAL ray's own ratio departs from it at order q² — the spherical aberration", () => {
    // The paraxial scaling is one number; the real one is aperture-dependent, and
    // that dependence is what spherical aberration IS. Measuring it off
    // `stackLongitudinalAberrationMm` makes the depth scaling and the depth
    // aberration one measurement rather than two.
    const paraxial = mountDepthScale(N_WATER, N_OIL);
    const apparent = stackApparentDistanceMm(waterLayer(D), N_OIL);
    const ratioAt = (q: number) =>
      (apparent - stackLongitudinalAberrationMm(waterLayer(D), N_OIL, q)) / D;
    const dev = [0.2, 0.1, 0.05, 0.025].map((q) => ratioAt(q) - paraxial);
    // ×4.00 per halving of q: exactly q², third-order spherical and nothing
    // lower, which is the same statement as the stack's leading term being q⁴.
    expect(dev[1]! / dev[2]!).toBeCloseTo(4.016, 2);
    expect(dev[2]! / dev[3]!).toBeCloseTo(4.004, 2);
    // At a working aperture it is not a small correction at all: the marginal ray
    // scales depth by 1.59 where the paraxial one says 1.14.
    expect(ratioAt(1.2)).toBeCloseTo(1.5902, 3);
  });
});

describe("§ 6l.6 — the SA is a pure phase, so § 6k.1's flux invariance survives it", () => {
  it("holds every plane's throughput constant with depth, to f64", () => {
    // A depth's aberration changes no pupil amplitude, and the mount's own
    // truncation does not vary with depth either — so Σ|P|² is untouched and, by
    // Parseval, so is the kernel's total. Every plane still delivers its whole
    // flux however deep and however defocused.
    const pupils = mountPupils(idealPupil(), mount(1.2));
    const reference = incoherentPsf(pupils(0), { size: SIZE, pupilSamples: PUPIL_SAMPLES })
      .formedSum;
    for (const waves of [1, 2, 4, 8]) {
      const formed = incoherentPsf(pupils(waves), { size: SIZE, pupilSamples: PUPIL_SAMPLES })
        .formedSum;
      expect(formed / reference).toBeCloseTo(1, 12);
    }
  });

  it("so the missing cone stays EMPTY — this step does not fill it", () => {
    // § 6k.5's negative control filled the cone with a depth-varying pupil
    // AMPLITUDE. Depth-dependent spherical aberration is not one, which is the
    // precise reason it changes what the image looks like without changing what
    // deconvolution can recover.
    const stack: number[] = [];
    for (let i = -32; i < 32; i++) stack.push(i * 0.25);
    const kernels = depthKernels(mountPupils(idealPupil(), mount(1.2)), stack, {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
    });
    const spectrum = axialSpectrum(axialTransfer(kernels, 0));
    let worst = 0;
    for (let b = 1; b < spectrum.magnitude.length; b++) {
      worst = Math.max(worst, spectrum.magnitude[b]! / spectrum.magnitude[0]!);
    }
    expect(worst).toBeLessThan(1e-12);
  });
});

describe("§ 6l.7 — a fixed depth makes the axial response ASYMMETRIC, where § 6k's is exactly symmetric", () => {
  // The other of the two questions: one emitter at a known depth, the objective
  // walked through it. Composed rather than given its own entry point —
  // `defocusing(withMountAberration(...))` — so a caller has to say which
  // question they are asking.
  const spec = mount(1.2);
  const DEPTH = 0.02;

  it("where an unaberrated pupil is symmetric about focus to f64", () => {
    // § 6k's sinc²(π·w₂₀) is even in the defocus, and the engine reproduces that
    // to the last bit. This is the control the asymmetry below is measured
    // against.
    const clean = defocusing(idealPupil());
    const at = (w: number) =>
      incoherentPsf(clean(w), { size: SIZE, pupilSamples: PUPIL_SAMPLES }).values[0]!;
    for (const w of [0.5, 1, 2]) expect(at(w) / at(-w)).toBeCloseTo(1, 12);
  });

  it("a mounted one is 19× brighter one side of focus than the other", () => {
    const at = (w: number) => psf(spec, DEPTH, w).values[0]!;
    expect(at(1) / at(-1)).toBeCloseTo(19.24, 1);
  });

  it("and its best focus MOVES, by the refocus the depth's paraxial part introduced", () => {
    // The sign is the diagnosis: water is RARER than oil, the depth aberration is
    // negative, and the compensating defocus is positive.
    expect(mountWavefrontWaves(spec, DEPTH, 1)).toBeLessThan(0);
    let best = { w: 0, v: -1 };
    for (let i = -60; i <= 60; i++) {
      const w = i * 0.05;
      const v = psf(spec, DEPTH, w).values[0]!;
      if (v > best.v) best = { w, v };
    }
    expect(best.w).toBeCloseTo(1.11, 1);
  });

  it("and refocusing recovers only part of it — the Strehl falls with depth anyway", () => {
    // Which is the whole difference between this and a defocus: a focus knob
    // buys back the paraxial half and nothing more.
    expect(bestStrehl(spec, 0.002)).toBeCloseTo(0.9606, 2);
    expect(bestStrehl(spec, 0.005)).toBeCloseTo(0.7801, 2);
    expect(bestStrehl(spec, 0.01)).toBeCloseTo(0.4386, 2);
  }, 60_000);
});

describe("§ 6l.8 — a rarer mount opposes a too-thick slip, at a brutal exchange rate", () => {
  it("carries the opposite sign to the coverslip's, per `stackW040Mm`'s own rule", () => {
    // A layer DENSER than the emergent medium contributes positive spherical
    // aberration and a rarer one negative. A D263 slip is denser than the oil;
    // a water mount is much rarer. So focusing DEEPER partially cancels a slip
    // that is too THICK.
    const perSlipMm = stackW040Mm([{ thicknessMm: 1, n: N_SLIP }], N_OIL, 1);
    const perDepthMm = stackW040Mm([{ thicknessMm: 1, n: N_WATER }], N_OIL, 1);
    expect(perSlipMm).toBeGreaterThan(0);
    expect(perDepthMm).toBeLessThan(0);
  });

  it("but the rate is 33.3 µm of slip error per µm of depth, so they are not comparable knobs", () => {
    // § 6e.4's "the cover slip HELPS" arriving with a number attached, and the
    // number kills the idea: the slip is nearly index-matched to the oil and the
    // mount is not, so 10 µm of slip error is undone by 0.30 µm of depth. Depth
    // is the dominant term by a factor of thirty, and a correction collar set for
    // one cannot be trading against the other.
    const perSlipMm = stackW040Mm([{ thicknessMm: 1, n: N_SLIP }], N_OIL, 1);
    const perDepthMm = stackW040Mm([{ thicknessMm: 1, n: N_WATER }], N_OIL, 1);
    expect(Math.abs(perDepthMm / perSlipMm)).toBeCloseTo(33.28, 1);
    const cancellingDepthMm = (-0.01 * perSlipMm) / perDepthMm;
    expect(cancellingDepthMm * 1000).toBeCloseTo(0.3005, 3);
    // And it really cancels: the two layers together, at that depth, sum to zero.
    expect(
      stackW040Mm(
        [
          { thicknessMm: 0.01, n: N_SLIP },
          { thicknessMm: cancellingDepthMm, n: N_WATER },
        ],
        N_OIL,
        1.2,
      ),
    ).toBeCloseTo(0, 18);
  });
});

describe("§ 6l.9 — the coupling that has no readout to catch it is REFUSED, not documented", () => {
  it("recovers a slice's absolute depth from the defocus `renderVolume` hands it", () => {
    // The map is affine, so the inversion is exact. § 6s carried its table's
    // identity the same way.
    const spec = mount(1.2, 0.03);
    for (const depthMm of [0, 0.01, 0.03, 0.075]) {
      const waves = mountDefocusWaves(spec, depthMm);
      const perWave = (2 * spec.mountIndex * LAMBDA * 1e-6) / spec.numericalAperture ** 2;
      expect(spec.focusDepthMm + waves * perWave).toBeCloseTo(depthMm, 14);
    }
  });

  it("emits `renderVolume`'s four coupled numbers from the spec, and refuses an override", () => {
    // The index `renderVolume` divides by must be the MOUNT's — W = ½·δ·NA²/n and
    // the geometry is in the mount. Passing the immersion's instead recovers
    // every slice's depth 14% wrong, silently, with nothing in the image to show
    // it. So the four are not the caller's to supply.
    const spec = mount(1.2, 0.02);
    const options = mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES });
    expect(options.refractiveIndex).toBe(N_WATER);
    expect(options.refractiveIndex).not.toBe(N_OIL);
    expect(options.numericalAperture).toBe(1.2);
    expect(options.wavelengthNm).toBe(LAMBDA);
    expect(options.focusMm).toBe(0.02);
    for (const key of ["refractiveIndex", "numericalAperture", "wavelengthNm", "focusMm"]) {
      expect(() =>
        mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES, [key]: 1 } as never),
      ).toThrow(/comes from the MountSpec/);
      // An explicit `undefined` is not an override — three of the four are
      // optional on `VolumeImageOptions`, so a respread options object carries
      // the key unset, and the spec's value wins the spread regardless.
      expect(
        mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES, [key]: undefined } as never)
          .refractiveIndex,
      ).toBe(N_WATER);
    }
  });

  it("and quoting the budget AT the mount's ceiling is refused — the cap is a supremum", () => {
    // `deliveredNaIntoMount` returns n_s, which sinθ_s < 1 approaches and never
    // reaches. It is the right number for a pupil mask and the wrong one to hand
    // to a tolerance, and the refusal says so rather than returning a budget for
    // an aperture no ray has.
    expect(mountAperture(mount(1.4))).toBe(N_WATER);
    expect(() => mountDepthTolerance(N_WATER, LAMBDA, N_WATER, N_OIL)).toThrow(/OPEN/);
    expect(() => mountDepthTolerance(N_WATER - 1e-9, LAMBDA, N_WATER, N_OIL)).not.toThrow();
  });

  it("and a matched mount reproduces § 6k's own `defocusing` bit for bit", () => {
    // The identity rung. Nothing about the depth machinery may change an image
    // that has no mismatch in it, so § 6k's every result survives this step
    // unaltered.
    const matched: MountSpec = {
      mountIndex: N_OIL,
      immersionIndex: N_OIL,
      numericalAperture: 1.2,
      wavelengthNm: LAMBDA,
      focusDepthMm: 0,
    };
    const mounted = mountPupils(idealPupil(), matched);
    const plain = defocusing(idealPupil());
    for (const waves of [0, 0.75, 3]) {
      const a = incoherentPsf(mounted(waves), { size: SIZE, pupilSamples: PUPIL_SAMPLES });
      const b = incoherentPsf(plain(waves), { size: SIZE, pupilSamples: PUPIL_SAMPLES });
      expect(a.formedSum).toBe(b.formedSum);
      for (let i = 0; i < a.values.length; i++) expect(a.values[i]).toBe(b.values[i]!);
    }
  });

  it("§ 6k.9 — the aperture argument selects the exact cap, and its default is free", () => {
    // § 6k.9 wires § 6k.8's exact depth phase to the objective's own NA/n, and
    // `mountPupils` builds a depth phase of its own, so it takes the aperture
    // too. Two things are pinned. The DEFAULT is the paraboloid bitwise — the
    // rung above already shows a matched mount reproducing § 6k's `defocusing`
    // through the new spelling — and the aperture, when given, reaches only the
    // defocus half: a mount's spherical aberration is not a defocus, and the two
    // halves compose here exactly as they did.
    //
    // The mount's own sin alpha is NA/n_s, the medium the DEPTH is measured in,
    // which is the same pairing `mountVolumeOptions` emits for the renderer.
    const spec = mount(1.2, 0.01);
    const s = objectSinAlpha(spec.numericalAperture, spec.mountIndex);
    const plain = mountPupils(idealPupil(), spec);
    const capped = mountPupils(idealPupil(), spec, s);
    for (const depthMm of [0.01, 0.02, 0.035]) {
      const waves = mountDefocusWaves(spec, depthMm);
      const aberrated = withMountAberration(idealPupil(), spec, depthMm);
      for (const rho of [0.2, 0.6, 1]) {
        expect(plain(waves).phaseWaves(rho, 0)).toBe(
          withDefocus(aberrated, waves).phaseWaves(rho, 0),
        );
        expect(capped(waves).phaseWaves(rho, 0)).toBe(
          withObjectDefocus(aberrated, waves, s).phaseWaves(rho, 0),
        );
      }
    }
    // And the two are genuinely different pupils at this aperture: 1.2 into
    // water is sin alpha 0.90, so the rim carries 1.391 waves per wave of depth
    // where the paraboloid says 1 — the mismatch this module exists for is not
    // the only thing a deep mount gets wrong.
    const waves = mountDefocusWaves(spec, 0.02);
    expect(capped(waves).phaseWaves(1, 0)).not.toBe(plain(waves).phaseWaves(1, 0));
    const rim = (s2: number) => withObjectDefocus(idealPupil(), 1, s2).phaseWaves(1, 0);
    expect(rim(s)).toBeCloseTo(1.3910, 4);
  });

  it("and a whole volume renders through it, each slice aberrated for its own depth", () => {
    // The end-to-end thread: § 6k's operator, driven by this step's pupils, on a
    // specimen whose planes sit at real depths in a real mount.
    const spec = mount(1.2, 0.01);
    const slices = [0.0, 0.01, 0.02].map((zMm) => ({
      zMm,
      field: uniformEmitters(SIZE, 1 / (SIZE * SIZE)),
    }));
    const image = renderVolume(
      { size: SIZE, slices },
      mountPupils(idealPupil(), spec),
      mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES }),
    );
    // § 6k.2 again, through this step's pupils: every plane delivers its whole
    // flux however deep, so a uniform slab's slices contribute equally.
    for (const flux of image.sliceFlux) {
      expect(flux / image.sliceFlux[0]!).toBeCloseTo(1, 12);
    }
    // And the in-focus plane is genuinely the one the spec focused on.
    expect(image.sliceFlux.length).toBe(3);
  });
});

/**
 * § 6l.10 — the mount that has no aperture angle, and the radius that is not one
 * expression.
 *
 * The register's item 17, opened while closing 16. § 6k.9 threaded § 6k.8's
 * exact depth cap through `mountPupils` and derived its aperture angle with
 * `objectSinAlpha`, which refuses NA ≥ n. That refusal named two mistakes it was
 * catching — an image-side NA paired with an object-side index, and a dry
 * objective engraved 1.2 — and a **third** case exists that is not a mistake at
 * all: a specimen mounted in something rarer than the immersion. An oil 1.40
 * over water is 1.05 and over air is 1.40, both ship in the app, and neither
 * could have the exact cap.
 *
 * The physics is that s ≥ 1 stops being an angle's sine. Inside the specimen
 * s²ρ² = (NA·ρ/n_s)² = sin²θ_s, and § 6l.3's wall has already zeroed the
 * amplitude beyond ρ = n_s/NA — so the radicand is a real cos θ_s everywhere
 * light exists, and s is a scale factor whose *product with ρ* is the sine. The
 * guard therefore belongs on the composition rather than on the number, and
 * `mountSinAlpha` is where it goes: it holds both indices, so it can ask the
 * question `objectSinAlpha` structurally cannot — whether the objective's own
 * medium carries the cone the mount is truncating.
 *
 * **The register predicted the pin and got it wrong in a way worth keeping.** It
 * said the wall and the branch point were "the same division of the same two
 * doubles". They are not. § 6l.3 tests ρ² ≥ (n_s/NA)² and the exact phase's
 * radicand ran out at ρ² ≥ 1/(NA/n_s)²; those are different roundings of one
 * radius, they disagree by up to 4 ulp, and on the shipped oil-over-water row the
 * outermost lit sample landed **exactly** on disc = 0 and took the paraboloid
 * fallback — a factor of two wrong, on lit light. So the step's answer is not a
 * more carefully spelled radius. It is that the phase needs **no** radius:
 * √max(disc, 0) is the exact cap's own continuous limit, and the two-expression
 * boundary is deleted rather than aligned.
 *
 * ~~What it does NOT unblock is the band. `exactDepthFactor` and `ewaldConeEdge`
 * both evaluate the cap AT ρ = 1, and on a truncating mount that rim is dark;
 * they keep refusing s ≥ 1. The lit rim is a different rim, and a band defined
 * there is a convention this ladder does not have.~~ **§ 6l.11 has it**, below.
 */
describe("§ 6l.10 — a mount rarer than the immersion, and the branch radius that is not the wall", () => {
  const OIL_WATER = mount(1.4);
  const S = mountSinAlpha(OIL_WATER);
  const ulpsApart = (a: number, b: number): number => {
    const f = new Float64Array([a, b]);
    const u = new BigUint64Array(f.buffer);
    return Number(u[0]! - u[1]!);
  };
  const nextDown = (x: number): number => {
    const f = new Float64Array([x]);
    const u = new BigUint64Array(f.buffer);
    u[0] = u[0]! - 1n;
    return f[0]!;
  };

  it("admits sin α ≥ 1 exactly where the immersion carries the cone, and nowhere else", () => {
    // The number itself is above 1 and is NOT an aperture angle: it is NA/n_s
    // with n_s the mount, and the app ships this row.
    expect(S).toBe(1.4 / N_WATER);
    expect(S).toBeGreaterThan(1);

    // Where `objectSinAlpha` is defined the two are the SAME division of the
    // same two doubles — one spelling of NA/n survives in the engine.
    expect(mountSinAlpha(mount(1.2))).toBe(objectSinAlpha(1.2, N_WATER));

    // And `objectSinAlpha` is untouched: it still refuses the pairing it always
    // refused, which is what keeps `renderVolume`'s bare-pupil arm and
    // `exactDepthOfFocusMm` safe — neither has a mount to truncate anything.
    expect(() => objectSinAlpha(1.4, N_WATER)).toThrow(/index above it/);

    // The discriminator is the IMMERSION, which is the whole reason this needed
    // a second conversion rather than a widened guard. A dry objective engraved
    // 1.2 has no medium to carry it and is still the error § 6k.9 named.
    const dry = { ...OIL_WATER, immersionIndex: 1, mountIndex: 1 };
    expect(() => mountSinAlpha({ ...dry, numericalAperture: 1.2 })).toThrow(/can carry/);
    // Nor may the immersion merely equal the NA: sin θ_i = 1 is grazing, the
    // same supremum-not-maximum § 6l.3 pins at the mount's own wall.
    expect(() => mountSinAlpha({ ...OIL_WATER, immersionIndex: 1.4 })).toThrow(/can carry/);
  });

  it("and every door that hands over an UNTRUNCATED pupil still refuses it", () => {
    // The claim "the guard moved onto the composition" is only worth anything if
    // the compositions that do NOT truncate kept theirs, so this pins the call
    // graph rather than asserting it. `withObjectDefocus` has exactly two direct
    // callers: `mountPupils`, which wraps the pupil in § 6l.3's wall first, and
    // `objectDefocusing`, which is handed a bare pupil and truncates nothing.
    // The refusal § 6k.9 put on the primitive now sits on the second one, so
    // nothing that was a throw before this step is a silent render after it.
    expect(() => objectDefocusing(idealPupil(), S)).toThrow(/must lie in \[0, 1\)/);
    expect(() => objectDefocusing(idealPupil(), 1)).toThrow(/must lie in \[0, 1\)/);
    // `fieldDefocusing` routes through it, so § 6bd's patches are covered by the
    // same one guard rather than by a second copy of it.
    expect(() => fieldDefocusing(() => ({ pupil: idealPupil() }), S)(0, 0)).toThrow(
      /must lie in \[0, 1\)/,
    );
    // And the legitimate door is open: the same s, through the composition that
    // applies the wall, builds pupils without complaint.
    expect(typeof mountPupils(idealPupil(), OIL_WATER, S)).toBe("function");

    // The primitive itself now takes it — it is the composition's contract, and
    // `mountPupils` is what satisfies it.
    expect(Number.isFinite(withObjectDefocus(idealPupil(), 1, S).phaseWaves(0.5, 0))).toBe(true);
    expect(() => withObjectDefocus(idealPupil(), 1, Infinity)).toThrow(/finite/);
    expect(() => withObjectDefocus(idealPupil(), 1, -0.1)).toThrow(/non-negative/);
  });

  it("falsifies the register: the two radii agree by luck on the shipped rows, not by identity", () => {
    // § 6l.3's wall as the amplitude tests it, against § 6k.8's radicand as the
    // phase used to. One radius, two spellings: (n_s/NA)² and 1/(NA/n_s)².
    const radii = (na: number, ns: number) => {
      const wall = (Math.min(na, ns) / na) ** 2;
      return { wall, branch: 1 / (na / ns) ** 2 };
    };
    // The register said "the same division of the same two doubles". On the row
    // it was looking at — the app's oil 1.40 over water — that is TRUE, and it is
    // luck rather than algebra: three roundings on each side happen to land on
    // one double at this index.
    const shipped = radii(1.4, N_WATER);
    expect(ulpsApart(shipped.wall, shipped.branch)).toBe(0);
    // One row over it is already not true, and there it falls the SAFE way — the
    // wall inside the branch, so every lit sample had a real radicand.
    expect(ulpsApart(radii(1.4, 1).wall, radii(1.4, 1).branch)).toBe(-1);

    // Elsewhere it falls the wrong way — the wall one ulp OUTSIDE the branch, so
    // lit samples exist past the radicand's own zero. Ordinary objectives over
    // ordinary mounts, all four of them.
    for (const [na, ns] of [
      [1.2, 1],
      [1.45, 1],
      [1.49, 1],
      [1.49, 1.47],
    ] as [number, number][]) {
      const { wall, branch } = radii(na, ns);
      expect(ulpsApart(wall, branch)).toBe(1);
    }

    // But the ulp gap is a PROXY and not the predicate, which is the same lesson
    // one level down: what the old rule actually tested was `1 − s²ρ² <= 0`, and
    // THAT expression rounds too. Of the four above it fires on three — an oil
    // 1.45 or 1.49 over air, a 1.49 over glycerol — where the outermost lit
    // sample the truncation can produce came back on the PARABOLOID: half the
    // phase, on light that is there. On the fourth it does not. Spelled `s*s`
    // rather than `(na/ns)**2` because `s*s` is what the phase computes, and the
    // whole rung is about expressions that are one number in algebra and two in
    // f64.
    const firesOn = (na: number, ns: number): boolean => {
      const s = na / ns;
      return 1 - s * s * nextDown(radii(na, ns).wall) <= 0;
    };
    expect(firesOn(1.45, 1)).toBe(true);
    expect(firesOn(1.49, 1)).toBe(true);
    expect(firesOn(1.49, 1.47)).toBe(true);
    expect(firesOn(1.2, 1)).toBe(false);

    // And on BOTH rows the app actually ships, it never fired — which is the
    // honest size of the defect. The register's claim was true where it looked,
    // and the two rows it was written about were safe. What is not safe is the
    // claim: a boundary that has to agree with another boundary computed from
    // different doubles will disagree somewhere, and the step's answer is that
    // there is now no second boundary to disagree with.
    expect(firesOn(1.4, N_WATER)).toBe(false);
    expect(firesOn(1.4, 1)).toBe(false);
  });

  it("so the phase needs no radius at all: the clamp is the cap's own limit", () => {
    // At s·ρ = 1 the radicand is exactly 0, 1 + 0 is exactly 1, and 2wρ²/1 is
    // exactly twice wρ². Bitwise, at every s, and it is the one clean identity
    // item 17 promised — the exact wavefront's outermost value is double the
    // paraboloid's, not asymptotically but exactly.
    const w = 2.5;
    for (const [s, rho] of [
      [S, 0.96],
      [1, 1],
      [1.05, 0.96],
      [1.4, 0.99],
      [2, 0.6],
    ] as [number, number][]) {
      // ρ at or past the branch, which is where the truncated pupil's own rim
      // is. `rho*rho` need not reproduce 1/s² after a round trip through a
      // square root, so the point is chosen rather than solved for, and the
      // paraboloid is read from the engine at that same point rather than
      // recomputed here.
      expect(rho * rho).toBeGreaterThanOrEqual(1 / (s * s));
      const exact = withObjectDefocus(idealPupil(), w, s).phaseWaves(rho, 0);
      const para = withDefocus(idealPupil(), w).phaseWaves(rho, 0);
      expect(exact).toBe(2 * para);
    }

    // It is a LIMIT and not a step: just inside the branch the ratio is below 2
    // and climbing, so the clamp continues the curve rather than replacing it.
    // (The old branch did replace it — with wρ², i.e. a ratio of 1.)
    const ratioAt = (s: number, rho: number) =>
      withObjectDefocus(idealPupil(), w, s).phaseWaves(rho, 0) /
      withDefocus(idealPupil(), w).phaseWaves(rho, 0);
    let previous = 0;
    for (const rho of [0.5, 0.8, 0.94, 0.952, 0.9533]) {
      const r = ratioAt(S, rho);
      expect(r).toBeGreaterThan(previous);
      expect(r).toBeLessThan(2);
      previous = r;
    }
    // 1.9807 at ρ = 0.9533, a whisker inside the branch at 0.95334523 — climbing
    // to 2 and reaching it only there.
    expect(previous).toBeGreaterThan(1.98);

    // And nothing an existing rung ever saw moved. At s < 1 every value inside
    // the unit disc is BITWISE what the branched form gave, and s = 0 is still
    // bitwise `withDefocus` — which is what let § 6k.9 route call sites through
    // the aperture-aware form with their readings intact.
    const branched = (w: number, s2: number, rho2: number): number => {
      const disc = 1 - s2 * rho2;
      return disc <= 0 ? w * rho2 : (w * 2 * rho2) / (1 + Math.sqrt(disc));
    };
    for (const s of [0, 0.05, 0.5, objectSinAlpha(1.4, N_OIL), 0.99]) {
      const p = withObjectDefocus(idealPupil(), 3.7, s);
      for (let i = 0; i <= 512; i++) {
        const rho = i / 512;
        expect(p.phaseWaves(rho, 0)).toBe(branched(3.7, s * s, rho * rho));
      }
    }
    expect(withObjectDefocus(idealPupil(), 3.7, 0).phaseWaves(0.31, 0.47)).toBe(
      withDefocus(idealPupil(), 3.7).phaseWaves(0.31, 0.47),
    );
  });

  it("and the value beyond the wall is never read — measured, not asserted", () => {
    // The fallback's safety is a COMPOSITION invariant now (`mountPupils` puts
    // the truncation inside the defocus), so it is pinned the only way that
    // means anything: two different finite phases beyond the wall must give a
    // bitwise-identical image, because the amplitude multiplying them is zero.
    const spec = mount(1.4, 0.02);
    const engine = mountPupils(idealPupil(), spec, S)(1.3);
    const wall = (mountAperture(spec) / spec.numericalAperture) ** 2;
    const withJunk = (junk: number) => ({
      amplitude: (px: number, py: number) => engine.amplitude(px, py),
      phaseWaves: (px: number, py: number) =>
        px * px + py * py >= wall ? junk : engine.phaseWaves(px, py),
    });
    const image = (p: PupilFunction) =>
      incoherentPsf(p, { size: SIZE, pupilSamples: PUPIL_SAMPLES }).values;
    const base = image(engine);
    for (const junk of [0, 0.37, -7.1, 1e6]) {
      const other = image(withJunk(junk));
      for (let i = 0; i < base.length; i++) expect(other[i]!).toBe(base[i]!);
    }
  });

  it("buys the biggest picture change on the ladder, and it is biggest where the mount is mildest", () => {
    // The point of the step. A water mount under an oil 1.40 now renders on the
    // exact cap; before, it could only have the paraboloid, because deriving the
    // angle threw. The stack is § 6k.9's own — five planes stepping one depth of
    // focus, one bead — so the number is directly comparable to its 0.2893 for a
    // MATCHED oil 1.40, and it is larger: **0.4113 of peak**, the largest such
    // difference on the ladder.
    //
    // Larger is what the wavefront says it should be, and it is worth spelling
    // out because the intuition runs the other way — a truncated pupil is a
    // SMALLER pupil. At the lit rim s·ρ = 1 exactly, so the exact phase there is
    // twice the paraboloid's; in matched oil the rim only reaches s = 0.9226 and
    // the factor is 1.4429. At half a wave of defocus that is 0.4544 waves of
    // disagreement against 0.2215 — the truncation costs radius and buys angle,
    // and the angle wins.
    const values = new Float64Array(SIZE * SIZE);
    values[0] = 1;
    const bead = { size: SIZE, values };
    const dof = depthOfFocusMm(LAMBDA, 1.4, N_WATER);
    const worstAtDepth = (depthMm: number): { worst: number; peak: number } => {
      const spec = mount(1.4, depthMm);
      const volume = {
        size: SIZE,
        slices: [-2, -1, 0, 1, 2].map((k) => ({ zMm: depthMm + k * dof, field: bead })),
      };
      const render = (sinAlpha: number) =>
        renderVolume(
          volume,
          mountPupils(idealPupil(), spec, sinAlpha),
          mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES }),
        );
      const para = render(0);
      const exact = render(mountSinAlpha(spec));
      let peak = 0;
      let worst = 0;
      for (let i = 0; i < para.intensity.length; i++) {
        peak = Math.max(peak, para.intensity[i]!);
        worst = Math.max(worst, Math.abs(exact.intensity[i]! - para.intensity[i]!));
      }
      return { worst, peak };
    };
    const atSlip = worstAtDepth(0);
    expect(atSlip.worst / atSlip.peak).toBeCloseTo(0.4113, 4);

    // And the second half of the reading, which is the one a microscopist would
    // want: the correction is largest exactly where the mount's own spherical
    // aberration is smallest, and the two hand off. By 10 µm down, § 6l's
    // aberration has taken 3.6× off the peak and the choice of depth wavefront
    // is worth 2.4% of what is left. So this matters at the top of a specimen and
    // is swamped at the bottom — the opposite shape from § 6k.9's matched case,
    // where nothing swamps it because there is no mount.
    const deep = worstAtDepth(0.01);
    expect(deep.worst / deep.peak).toBeCloseTo(0.0244, 4);
    expect(atSlip.peak / deep.peak).toBeCloseTo(3.6088, 4);
    // Monotone in between, so the hand-off is a trend and not two points.
    const mid = worstAtDepth(0.002);
    expect(mid.worst / mid.peak).toBeLessThan(atSlip.worst / atSlip.peak);
    expect(mid.worst / mid.peak).toBeGreaterThan(deep.worst / deep.peak);
  });

  it("~~but not the band: the objects that read the cap AT ρ = 1 still refuse~~ — closed at § 6l.11", () => {
    // What this rung pinned, kept so the closure is visible: both of these
    // evaluated √(1 − s²), the cap at the NOMINAL rim, and on a truncating mount
    // that rim is dark — so § 6l.10 left them refusing rather than inventing a
    // convention. § 6l.11 moved the rim to min(1, 1/s) instead, which is the same
    // rim wherever the mount carries the pupil, and both now answer.
    expect(exactDepthFactor(S)).toBeCloseTo((S * S) / 2, 15);
    expect(ewaldConeEdge(1 / S, S)).toBeCloseTo(2 / (S * S), 15);
    // And `renderVolume` reports the band here, on the promise the options carry.
    const spec = mount(1.4);
    const options = mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES });
    expect(options.numericalAperture / options.refractiveIndex!).toBeGreaterThan(1);
    expect(options.pupilTruncatedAtMount).toBe(true);
  });
});

/**
 * § 6l.11 — the band at the rim the light reaches.
 *
 * The register's item 18, opened by § 6l.10 as the half of 17 that did not
 * close, and the only entry on it whose blocker was a **convention** rather than
 * a measurement. § 6l.10 gave a mount rarer than the immersion the exact depth
 * phase and left every depth-of-focus reading defined at the NOMINAL pupil rim
 * ρ = 1 — which such a mount leaves dark. So the phase was right and the band
 * was absent, and the app could not show one beside the other.
 *
 * **The convention, and why it is an extension and not a second criterion.** The
 * quarter-wave criterion is a peak-to-valley over the APERTURE, and § 6l.3's
 * wall is where the aperture stops: ρ_e = min(1, 1/s). Below the wall that is
 * ρ = 1 and every band the ladder has recorded is inside the new rule rather
 * than beside it — the rungs here pin that as **bitwise**, not as agreement.
 * Above it the two rims part, and the reading becomes
 *
 *     half-band = λ / (4·n_s),      independent of NA
 *
 * because the outermost ray the specimen delivers is grazing, cos θ is exactly
 * 0, and a wider pupil adds none. That saturation is the physics of the step;
 * the register's "exactly ½" is a *ratio* to a paraboloid measured at the same
 * lit rim, and is NOT what `exactDepthFactor` returns. That function multiplies
 * `depthOfFocusMm` — the paraboloid at the nominal rim — so against it the
 * factor is s²/2. Returning the ½ would put the band out by a factor of s², which
 * is the "two criteria wearing one name" § 6k.9 refused to do to § 6k.2.
 *
 * **So "the exact band is shorter" stops being true.** f(s) falls to its minimum
 * ½ at s = 1 and climbs back, crossing 1 at s² = 2 — an oil 1.45 over air has a
 * LONGER exact band than the paraboloid's. Nothing about the wavefront changed
 * there; the reference kept shrinking as 1/NA² after the band had stopped.
 *
 * **What refutes it is an argument, not a run** (the register said so). Two are
 * checked here rather than asserted: the band is a counting window over slices
 * and touches no amplitude or phase, so § 6k.1's flux invariance is untouched —
 * pinned by rendering the same volume with and without the promise and comparing
 * the pictures bitwise; and the promise is a promise, so an untruncated pupil at
 * s ≥ 1 still has no exact band, which keeps § 6k.9's refusal alive where it was
 * right.
 */
describe("§ 6l.11 — the band at the rim the light reaches", () => {
  const S = mountSinAlpha(mount(1.4));
  const AIR = 1;
  const airMount = (numericalAperture: number, focusDepthMm = 0): MountSpec => ({
    mountIndex: AIR,
    immersionIndex: N_OIL,
    numericalAperture,
    wavelengthNm: LAMBDA,
    focusDepthMm,
  });

  it("below the wall it is the old function to the BIT, at both objects that read a rim", () => {
    // The whole convention rests on this: the ladder's readings are inside the
    // new rule, so nothing is restated. `max(1, s²)` is exactly 1 there and a
    // double times 1 is itself, which is why this is bitwise rather than close.
    const oldFactor = (s: number): number => (1 + Math.sqrt(1 - s * s)) / 2;
    const oldEdge = (nu: number, s: number): number => {
      if (nu >= 2) return 0;
      const a = 1 - nu;
      return (2 * (1 - a * a)) / (Math.sqrt(1 - s * s * a * a) + Math.sqrt(1 - s * s));
    };
    for (let i = 0; i < 4000; i++) {
      const s = i / 4000;
      expect(exactDepthFactor(s)).toBe(oldFactor(s));
    }
    for (const s of [0, 1e-9, 0.1, 1.4 / N_OIL, 0.99]) {
      for (let i = 0; i <= 500; i++) {
        const nu = (i * 2.5) / 500;
        expect(ewaldConeEdge(nu, s)).toBe(oldEdge(nu, s));
      }
    }
    // The recorded matched-oil readings, unmoved: § 6k.9's band and § 6k.8's peak.
    expect(exactDepthFactor(1.4 / N_OIL)).toBeCloseTo(0.69303, 5);
    expect(ewaldConeEdge(1, 1.4 / N_OIL)).toBeCloseTo(1.4429, 4);
  });

  it("at the wall the factor is exactly ½, and that is a MINIMUM and not a floor", () => {
    // s = 1 is where the two rims coincide for the last time, and both spellings
    // of the cap give (1 + 0)/2 there. Exactly, because √0 is exact.
    expect(exactDepthFactor(1)).toBe(0.5);
    // Falling below it, climbing above it. Not monotone, which is the clause
    // every "% shorter" sentence in the engine and the app had to be rewritten
    // for.
    for (let i = 1; i < 200; i++) {
      const s = i / 200;
      expect(exactDepthFactor(s)).toBeGreaterThan(exactDepthFactor(s + 1 / 200));
    }
    for (let i = 200; i < 400; i++) {
      const s = i / 200;
      expect(exactDepthFactor(s)).toBeLessThan(exactDepthFactor(s + 1 / 200));
    }
    // And it crosses 1 at s² = 2 — no f64 s squares to exactly 2, so the crossing
    // is bracketed by the two doubles either side of √2 rather than named.
    const nextDown = (x: number): number => {
      const f = new Float64Array([x]);
      const u = new BigUint64Array(f.buffer);
      u[0] = u[0]! - 1n;
      return f[0]!;
    };
    expect(exactDepthFactor(nextDown(Math.SQRT2))).toBeLessThan(1);
    expect(exactDepthFactor(Math.SQRT2)).toBeGreaterThan(1);
  });

  it("past the wall the NA cancels: the band is λ/2n, the same for every objective", () => {
    // The headline. Three objectives that all over-fill a water mount get the
    // SAME depth of focus out of it, because each one's outermost delivered ray
    // is grazing and the extra aperture is dark.
    const water = [1.4, 1.45, 1.49].map((na) => exactDepthOfFocusMm(LAMBDA, na, N_WATER));
    for (const d of water) expect(d / water[0]!).toBeCloseTo(1, 15);
    expect(water[0]! / ((LAMBDA * 1e-6) / (2 * N_WATER))).toBeCloseTo(1, 15);
    expect(water[0]! * 1e6).toBeCloseTo(206.04, 2);
    // Air, where the same statement reads λ/2 because the mount is n = 1.
    expect(exactDepthOfFocusMm(LAMBDA, 1.4, AIR) * 1e6).toBeCloseTo(275.0, 1);
    // Against the paraboloid's nominal-rim band: 55.01% on water, 98.00% on air.
    // The second is 1.4²/2 and not a small correction — the two agree by
    // arithmetic accident, which is exactly the shape a caption gets wrong.
    expect(
      exactDepthOfFocusMm(LAMBDA, 1.4, N_WATER) / depthOfFocusMm(LAMBDA, 1.4, N_WATER),
    ).toBeCloseTo(0.550135, 6);
    expect(exactDepthOfFocusMm(LAMBDA, 1.4, AIR) / depthOfFocusMm(LAMBDA, 1.4, AIR)).toBeCloseTo(
      0.98,
      12,
    );
    // An oil 1.45 over air is past the crossing: the exact band is the LONGER one.
    expect(
      exactDepthOfFocusMm(LAMBDA, 1.45, AIR) / depthOfFocusMm(LAMBDA, 1.45, AIR),
    ).toBeGreaterThan(1);
    // The index is now this function's own to refuse — `objectSinAlpha` used to
    // do it on the way past and no longer runs.
    expect(() => exactDepthOfFocusMm(LAMBDA, 1.4, 0)).toThrow(/refractive index/);
    expect(() => exactDepthOfFocusMm(LAMBDA, 0, 1.5)).toThrow(/NA/);
  });

  it("the factor IS the lit rim's phase upside down, which is where the ½ comes from", () => {
    // One statement read two ways, as § 6k.9 built it — now at ρ_e instead of at
    // ρ = 1. § 6l.10 pins the exact cap at s·ρ = 1 as exactly twice the
    // paraboloid; the band at that rim is therefore exactly half the paraboloid's
    // band AT THAT RIM, and s²/2 of the paraboloid's band at the nominal one.
    const rhoE = N_WATER / 1.4;
    const perWave = withObjectDefocus(idealPupil(), 1, S).phaseWaves(rhoE, 0);
    const paraPerWave = withDefocus(idealPupil(), 1).phaseWaves(rhoE, 0);
    expect(perWave / paraPerWave).toBeCloseTo(2, 14);
    // The quarter-wave depth is the reciprocal of the rim phase, so the ratio the
    // register named is ½ — and the ratio to `depthOfFocusMm`, which is quoted at
    // ρ = 1, is that same ½ divided by ρ_e². Both spellings, one number.
    expect(0.5 / (rhoE * rhoE) / exactDepthFactor(S)).toBeCloseTo(1, 14);
    expect(exactDepthFactor(S)).toBeCloseTo((S * S) / 2, 15);
  });

  it("the missing cone's boundary moves with the same rim, and a brute force agrees", () => {
    // `ewaldConeEdge` is the same maximum over pupil pairs with the outer point
    // put where the light stops. Checked against a search over lit pairs rather
    // than against a rearrangement of itself.
    const g = (rho: number): number =>
      (2 * rho * rho) / (1 + Math.sqrt(Math.max(1 - S * S * rho * rho, 0)));
    const brute = (nu: number, m = 200_000): number => {
      const rhoE = N_WATER / 1.4;
      let best = 0;
      for (let i = 0; i <= m; i++) {
        const r1 = (i / m) * rhoE;
        const r2 = r1 - nu;
        if (Math.abs(r2) > rhoE) continue;
        best = Math.max(best, g(r1) - g(Math.abs(r2)));
      }
      return best;
    };
    for (const nu of [0.2, 0.6, 1.5]) {
      expect(ewaldConeEdge(nu, S) / brute(nu)).toBeCloseTo(1, 12);
    }
    // The peak is 2/s² at ν = 1/s, and the lateral cutoff came in with the rim:
    // 2/s is the DELIVERED aperture, not the engraved one. So a truncated pupil
    // sections better per unit of lateral frequency over fewer of them.
    expect(ewaldConeEdge(1 / S, S)).toBeCloseTo(2 / (S * S), 15);
    expect(ewaldConeEdge(1 / S, S)).toBeCloseTo(1.8177, 4);
    expect(1 / S).toBeCloseTo(mountAperture(mount(1.4)) / 1.4, 15);
    expect(ewaldConeEdge(2 / S, S)).toBe(0);
    expect(ewaldConeEdge(2.5 / S, S)).toBe(0);
    // Still closed on the axis: the missing cone is a fact about the axis and not
    // about the aperture, and it survives the truncation as it survived the cap.
    expect(ewaldConeEdge(0, S)).toBe(0);
    // s = 1 takes the truncating spelling because the other one is 0/0 at ν = 0
    // there — and away from the axis the two agree to an ulp, which is the only
    // thing that makes the choice free.
    expect(ewaldConeEdge(0, 1)).toBe(0);
    for (const nu of [0.3, 1, 1.7]) {
      const a = 1 - nu;
      expect(ewaldConeEdge(nu, 1) / (2 * Math.sqrt(1 - a * a))).toBeCloseTo(1, 15);
    }
  });

  it("the band is a promise about the pupil, and an untruncated one at s ≥ 1 still has none", () => {
    // § 6k.9's refusal was right about a bare pupil and is kept exactly there.
    // `renderVolume` cannot inspect a callback, so the promise rides on the
    // options — emitted by `mountVolumeOptions` from the same spec the wall comes
    // out of, and refused from a caller like the other four coupled numbers.
    const slab = {
      size: SIZE,
      slices: [0, 1, 2].map((k) => ({
        zMm: k * depthOfFocusMm(LAMBDA, 1.4, N_WATER),
        field: uniformEmitters(SIZE, 1 / (SIZE * SIZE)),
      })),
    };
    const bare = renderVolume(slab, defocusing(idealPupil()), {
      pupilSamples: PUPIL_SAMPLES,
      numericalAperture: 1.4,
      wavelengthNm: LAMBDA,
      refractiveIndex: N_WATER,
    });
    expect(bare.exactInFocusFraction).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(bare, "exactInFocusFraction")).toBe(false);
    expect(bare.inFocusFraction).toBeGreaterThan(0);

    const spec = mount(1.4);
    const mounted = renderVolume(
      slab,
      mountPupils(idealPupil(), spec, mountSinAlpha(spec)),
      mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES }),
    );
    expect(mounted.exactInFocusFraction).not.toBeUndefined();
    // The window is 103 nm either side and the planes step 375 nm, so it catches
    // the same single plane the paraboloid's does — the two fractions agree, and
    // that is the band and not the light (§ 6k.9's own reading of the same fact).
    expect(mounted.exactInFocusFraction!).toBeCloseTo(mounted.inFocusFraction, 15);
    // An air mount is the same statement one index further out.
    const air = airMount(1.4);
    expect(mountVolumeOptions(air, { pupilSamples: PUPIL_SAMPLES }).pupilTruncatedAtMount).toBe(
      true,
    );
    // A matched mount truncates nothing and says so — `false` rather than absent,
    // because the wall was asked about.
    const matched: MountSpec = { ...spec, mountIndex: N_OIL };
    expect(mountVolumeOptions(matched, { pupilSamples: PUPIL_SAMPLES }).pupilTruncatedAtMount).toBe(
      false,
    );
    expect(() =>
      mountVolumeOptions(spec, {
        pupilSamples: PUPIL_SAMPLES,
        pupilTruncatedAtMount: true,
      } as never),
    ).toThrow(/pupilTruncatedAtMount/);
  });

  it("and it is only a counting window: the picture and every flux are bitwise unmoved", () => {
    // The argument the register asked for instead of a measurement, measured
    // anyway because it is cheap: the band decides which slices are COUNTED and
    // touches no amplitude and no phase, so § 6k.1's invariance cannot notice it.
    const spec = mount(1.4);
    const slab = {
      size: SIZE,
      slices: [-1, 0, 1].map((k) => ({
        zMm: k * depthOfFocusMm(LAMBDA, 1.4, N_WATER),
        field: uniformEmitters(SIZE, 1 / (SIZE * SIZE)),
      })),
    };
    const pupils = mountPupils(idealPupil(), spec, mountSinAlpha(spec));
    const opts = mountVolumeOptions(spec, { pupilSamples: PUPIL_SAMPLES });
    const withBand = renderVolume(slab, pupils, opts);
    const without = renderVolume(slab, pupils, { ...opts, pupilTruncatedAtMount: false });
    expect(without.exactInFocusFraction).toBeUndefined();
    expect(withBand.inFocusFraction).toBe(without.inFocusFraction);
    expect(withBand.maxGridPhaseStepWaves).toBe(without.maxGridPhaseStepWaves);
    for (let i = 0; i < withBand.sliceFlux.length; i++) {
      expect(withBand.sliceFlux[i]!).toBe(without.sliceFlux[i]!);
    }
    for (let i = 0; i < withBand.intensity.length; i++) {
      expect(withBand.intensity[i]!).toBe(without.intensity[i]!);
    }
  });
});
