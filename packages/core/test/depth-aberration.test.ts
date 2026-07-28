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
  renderVolume,
  withDefocus,
} from "../src/imaging/volume";
import { incoherentPsf, uniformEmitters } from "../src/imaging/fluorescence";
import { idealPupil } from "../src/illumination/transfer";
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
