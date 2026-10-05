import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";
import { pupils } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { exitApertureSine, exitRim, opdMap } from "../src/pupil/opd";
import { traceRay } from "../src/trace/sequential";
import { asCompiled } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import { infinityCorrectedMicroscope, microscopeObjective, tubeLens } from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import { imageNumericalAperture } from "../src/pupil/microscope";
import { fitZernike, wavefrontSampler } from "../src/wave/zernike";
import {
  imagePixelScaleMm,
  psf,
  psfFromPupilFunction,
  pupilFunctionFromOpd,
  radialProfile,
  systemPupil,
  type Psf,
} from "../src/wave/psf";
import { geometricPsf } from "../src/wave/geometric";
import { besselJ } from "../src/math/bessel";

/**
 * § 2i — the pupil laid out where its rays went (register item 21).
 *
 * The transform that makes a PSF is a sum over image-space DIRECTION: the Debye
 * integral, which the FFT discretizes on a grid uniform in the exit direction
 * sine. Until this step the engine laid each traced sample at the coordinate it
 * was AIMED at and read the ruler off the paraxial exit pupil, r/R. Those are the
 * same thing only while the aim maps linearly onto the exit cone. § 6e's oil
 * 100×/1.25 aims uniformly in tan θ — its stop is a plane face, and a ray at θ
 * crosses it at t·tan θ — while an aplanat carries sin θ to the image, so a ray
 * aimed half-way out leaves 72% of the way out, and r/R reads n·tan θ where the
 * cone carries n·sin θ: 1.766× too wide, the ring at 0.566 of 0.61·λ/NA′.
 *
 * ## The hypothesis, and the numbers that refute it
 *
 * Each traced sample, placed at its own exit direction sine over the traced rim's
 * (`exitX/exitY` over `exitApertureSine`), with the edge read off the traced rim
 * and the amplitude uniform in that coordinate, gives the transform the pupil the
 * Debye integral asks for. Refuted by any one of:
 *
 *  - the aberration-free ring on the oil objective away from Airy's
 *    1.2197·λ/(2·NA′), NA′ the independently traced cone, by more than the ring
 *    finder's own bias at that grid — the old ruler is 43% short;
 *  - a defocus read in the laid-out pupil away from Hamilton's first-order
 *    n·δ·(1 − cos θ) at each ray's own exit coordinate by more than the two fits'
 *    residuals — the aim-placed pupil misses by 27% of the peak;
 *  - a ray histogram of an image-side defocus that is not a uniform disc, 25% of
 *    its energy inside half its radius — counting each aimed ray alike gives 9.8%;
 *  - a rim that is not a circle on the axis of a symmetric system.
 *
 * ## Apodization — not taken here, taken at § 2j
 *
 * This step kept the amplitude uniform in the exit coordinate. § 2j replaced
 * that with the traced irradiance (`exitDensity`), so § 2i.2's ring and § 2i.4's
 * disc are restated below against an apodized pupil's closed forms: an isotropic
 * emitter through an aplanat arrives as 1/cos θ in irradiance, a transmitted
 * field as cos θ, θ in the specimen. The ruler, the edge and § 2i.3's phase are
 * this step's and did not move.
 */

const L = LINE_D;
/** The layout under test. The engine's default is still `"aim"` (register item 24). */
const EXIT = { layout: "exit" } as const;

const oil = () =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0],
  });
const dry = () =>
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0],
  });

/** Airy's first zero, j₁,₁/π: the radius in units of λ/(2·NA′). */
const AIRY_FIRST_ZERO = 1.2196698912665045;

/** sin α at the oil objective's rim, in the oil: k in the apodizations below. */
function rimSine(s: OpticalSystem): number {
  const d = aimRay(s, pupils(s, L), 0, { px: 1, py: 0 }, L).dir;
  return Math.hypot(d.x, d.y) / Math.hypot(d.x, d.y, d.z);
}

/**
 * First zero of ∫₀¹ (1 − k²ρ²)^p·J₀(vρ)·ρ dρ, over π — the ring of an aplanat's
 * apodized pupil, in units of λ/(2·NA′), by quadrature of the closed form and
 * nothing of the engine's. p = −¼ for an emitter, +¼ for a field, 0 for Airy.
 */
function apodizedFirstZero(k: number, p: number): number {
  const field = (v: number) => {
    const n = 4000;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const r = (i + 0.5) / n;
      acc += (1 - k * k * r * r) ** p * besselJ(0, v * r) * r;
    }
    return acc;
  };
  let lo = 2.5;
  let hi = 5.5;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (Math.sign(field(mid)) === Math.sign(field(lo))) lo = mid;
    else hi = mid;
  }
  return (0.5 * (lo + hi)) / Math.PI;
}

/** First dark ring of the radial profile, to sub-pixel — § 2b's helper, as § 2g and § 2h. */
function firstMinimumPixels(p: Psf, intensity = p.intensity): number {
  const { radius, mean } = radialProfile({ ...p, intensity }, p.size / 2);
  let peak = 0;
  for (const v of mean) if (v > peak) peak = v;
  for (let i = 1; i < mean.length - 1; i++) {
    if (mean[i]! < peak * 0.02 && mean[i]! < mean[i - 1]! && mean[i]! <= mean[i + 1]!) {
      const a = mean[i - 1]!;
      const b = mean[i]!;
      const c = mean[i + 1]!;
      const denom = a - 2 * b + c;
      const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      return radius[i]! + shift * (radius[1]! - radius[0]!);
    }
  }
  throw new Error("no dark ring found in the radial profile");
}

/**
 * One ray's exit coordinate — its reference-sphere crossing over the radius, as
 * `opdMap` records it for that ray alone, over the axial rim's — and the cosine
 * of its angle in the specimen's medium, read off its own launch.
 */
function exitCoordinateOf(s: OpticalSystem, px: number): { e: number; cosObject: number } {
  const sample = opdMap(s, 0, L, [{ px, py: 0 }]).samples[0]!;
  const ray = aimRay(s, pupils(s, L), 0, { px, py: 0 }, L);
  return {
    e: sample.exitX / exitApertureSine(s, L),
    cosObject: ray.dir.z / Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z),
  };
}

/** The axial rim ray's sine as a DIRECTION, the way `imageNumericalAperture` reads it. */
function rimDirectionSine(s: OpticalSystem): number {
  const c = asCompiled(s.prescription);
  const pg = pupils(s, L);
  const x = (q: number) => {
    const d = toImageSpace(c, traceRay(s.prescription, aimRay(s, pg, 0, { px: q, py: 0 }, L)).ray!).dir;
    return d.x / Math.hypot(d.x, d.y, d.z);
  };
  return -(x(1) - x(0));
}

describe("§ 2i.1 — the ruler is the traced cone", () => {
  it("on the oil 100×/1.25 the scale's sine is the rim's sphere crossing, and r/R is 1.766× it", () => {
    const s = oil().system;
    const sp = systemPupil(s, 0, L, EXIT);
    const naPrime = imageNumericalAperture(s, L);
    // Read by its definition: the axial rim ray's crossing of the reference
    // sphere over the radius.
    expect(sp.scale.apertureSine).toBe(Math.abs(opdMap(s, 0, L, [{ px: 1, py: 0 }]).samples[0]!.exitX));
    // The traced NA′ is that ray's DIRECTION, which carries its transverse
    // aberration over R on top: the two agree to the objective's own residue,
    // and to 1e-15 between them as directions (the scale's rims removed, the
    // readout's as traced — nothing downstream clips this ray).
    expect(Math.abs(rimDirectionSine(s) / (naPrime / Math.abs(sp.scale.nImage)) - 1)).toBeLessThan(1e-14);
    expect(Math.abs(sp.scale.apertureSine! / rimDirectionSine(s) - 1)).toBeLessThan(0.005);
    expect(imagePixelScaleMm(sp.scale, 1024, 64)).toBe(
      Math.abs((L * 1e-6 * 64) / (2 * Math.abs(sp.scale.nImage) * 1024 * sp.scale.apertureSine!)),
    );
    // NEGATIVE CONTROL: the paraxial ruler this replaced.
    const paraxial = sp.scale.exitRadius / sp.scale.referenceRadius;
    // 1.759 on the sphere crossing; 1.766 on the direction, as the register had it.
    expect(paraxial / sp.scale.apertureSine!).toBeGreaterThan(1.75);
    expect(paraxial / sp.scale.apertureSine!).toBeLessThan(1.77);
  });

  it("on the dry 4×/0.10 the two rulers are one to the pupil's own 0.8% distortion", () => {
    const sp = systemPupil(dry().system, 0, L, EXIT);
    const paraxial = sp.scale.exitRadius / sp.scale.referenceRadius;
    expect(Math.abs(paraxial / sp.scale.apertureSine! - 1)).toBeLessThan(0.01);
  });
});

describe("§ 2i.2 — the Airy ring on the oil objective, absolute", () => {
  it("the aberration-free ring is the apodized aplanat's to the finder's own bias, which falls with the grid", () => {
    // Restated at § 2j: the pupil now carries the emitter's traced irradiance,
    // which brightens the rim and pulls the ring in — to 1.1788·λ/(2·NA′) for a
    // pure 1/cos θ at this k, where Airy's is 1.2197. The quadrature's closed
    // form is the pin; Airy's is the negative control below.
    const s = oil().system;
    const k = rimSine(s);
    const emitterZero = apodizedFirstZero(k, -0.25);
    expect(Math.abs(apodizedFirstZero(k, 0) / AIRY_FIRST_ZERO - 1)).toBeLessThan(1e-6);
    expect(AIRY_FIRST_ZERO / emitterZero - 1).toBeGreaterThan(0.03);
    // NA′ from an INDEPENDENT trace — the rim ray's direction, `imageNumericalAperture`
    // — and not from the scale's own sine, which would cancel against the ruler
    // and leave the finder measuring itself. The two NA′ differ by this
    // objective's own 0.38% (§ 2i.1), which is inside what this rung resolves.
    const sp0 = systemPupil(s, 0, L, EXIT);
    const expected = (emitterZero * L * 1e-6) / (2 * imageNumericalAperture(s, L));
    const ratios = [16, 32].map((pad) => {
      const p = psf(s, 0, L, { ...EXIT, pupilSamples: 64, padFactor: pad, keepDiffractionLimited: true });
      return (firstMinimumPixels(p, p.diffractionLimitedIntensity!) * p.pixelScaleMm) / expected;
    });
    // 1.0037 and 0.99982 measured (§ 2i's uniform pupil read 1.0084 and 1.0020
    // against Airy): the parabolic sub-pixel finder's bias, falling with the
    // pixel as on § 2b's pure Airy, plus the objective's own Fresnel
    // apodization, its 0.5% sine-condition residue and the 0.38% between the
    // two NA′.
    expect(Math.abs(ratios[1]! - 1)).toBeLessThan(0.008);
    expect(Math.abs(ratios[1]! - 1)).toBeLessThan(Math.abs(ratios[0]! - 1));
    // NEGATIVE CONTROL: Airy's ring, which the uniform pupil drew, is 3.5% out.
    expect(Math.abs((ratios[1]! * emitterZero) / AIRY_FIRST_ZERO - 1)).toBeGreaterThan(0.025);
    // A transmitted field darkens the rim and pushes the ring OUT, to 1.2638.
    const fieldZero = apodizedFirstZero(k, 0.25);
    const pf = psf(s, 0, L, { ...EXIT, source: "field", pupilSamples: 64, padFactor: 32, keepDiffractionLimited: true });
    const fieldRatio =
      (firstMinimumPixels(pf, pf.diffractionLimitedIntensity!) * pf.pixelScaleMm) /
      ((fieldZero * L * 1e-6) / (2 * imageNumericalAperture(s, L)));
    // 0.99992 measured.
    expect(Math.abs(fieldRatio - 1)).toBeLessThan(0.008);
    // NEGATIVE CONTROL: the same ring on the paraxial ruler reads 0.570 of it.
    const sp = sp0;
    const p = psfFromPupilFunction(sp.pupil, { ...sp.scale, apertureSine: undefined }, 0, {
      pupilSamples: 64,
      padFactor: 32,
      keepDiffractionLimited: true,
    });
    const old = (firstMinimumPixels(p, p.diffractionLimitedIntensity!) * p.pixelScaleMm) / expected;
    expect(old).toBeGreaterThan(0.56);
    expect(old).toBeLessThan(0.58);
  }, 180_000);

  it("on the axis the traced rim is a circle to rounding, whatever the mapping", () => {
    const s = oil().system;
    const map = opdMap(s, 0, L, pupilGrid(5));
    const sigma = exitApertureSine(s, L);
    for (const p of exitRim(s, map)) expect(Math.abs(Math.hypot(p.px, p.py) / sigma - 1)).toBeLessThan(1e-12);
  });
});

describe("§ 2i.3 — inside the pupil: a defocus is where Hamilton puts it", () => {
  it("n·δ·(1 − cos θ) at each ray's own exit coordinate; the aim-placed pupil misses by a quarter", () => {
    // Moving the specimen δ toward the lens changes each ray's optical path by
    // −n·δ·cos θ to first order in δ, for ANY system — the point characteristic's
    // derivative is the ray's own reduced direction — so the change in OPD against
    // the chief ray is n·δ·(1 − cos θ), and the objective's own residue cancels in
    // the difference. θ is the ray's angle in the specimen's medium.
    const sc = oil();
    const s0 = sc.system;
    const n = getMedium(s0.prescription.objectMedium ?? "AIR").n(L);
    const delta = 2e-4;
    const s1: OpticalSystem = { ...s0, conjugate: { kind: "finite", distance: sc.objectDistanceMm - delta } };
    const p0 = systemPupil(s0, 0, L, EXIT).pupil;
    const p1 = systemPupil(s1, 0, L, EXIT).pupil;
    // NEGATIVE CONTROL: the same two traces fitted where the rays were aimed.
    const aimed = (s: OpticalSystem) =>
      wavefrontSampler(fitZernike(opdMap(s, 0, L, pupilGrid(21)).samples, 28));
    const a0 = aimed(s0);
    const a1 = aimed(s1);
    const at = (f0: (x: number, y: number) => number, f1: typeof f0, e: number) =>
      f1(e, 0) - f0(e, 0) - (f1(0, 0) - f0(0, 0));

    let peak = 0;
    let miss = 0;
    let missAimed = 0;
    for (const rho of [0.2, 0.4, 0.6, 0.8, 0.9, 0.95]) {
      const { e, cosObject } = exitCoordinateOf(s1, rho);
      const hamilton = (n * delta * (1 - cosObject)) / (L * 1e-6);
      peak = Math.max(peak, hamilton);
      miss = Math.max(miss, Math.abs(at(p0.phaseWaves, p1.phaseWaves, e) - hamilton));
      missAimed = Math.max(missAimed, Math.abs(at(a0, a1, e) - hamilton));
    }
    // 4.7e-3 of a 0.212-wave peak: the two fits' residuals (5e-4 waves each) and
    // Hamilton's second order, which grows with δ (3.7e-3 at δ/2, 6.8e-3 at 2δ).
    expect(peak).toBeGreaterThan(0.2);
    expect(miss / peak).toBeLessThan(0.01);
    expect(missAimed / peak).toBeGreaterThan(0.25);
  });
});

describe("§ 2i.4 — the ray histogram shares the layout", () => {
  it.each(["emitter", "field"] as const)("an image-side defocus on the oil objective: the %s's closed form inside half the radius", (source) => {
    // Behind the tube lens the cone is NA′ 0.0124, so a ray at exit sine σ lands
    // Δz·σ/√(1 − σ²) from the axis — linear in σ to 8e-5 — and the disc's
    // profile is the exit pupil's irradiance. § 2i put a uniform one there, a
    // quarter inside half the radius; restated at § 2j, an aplanat hands an
    // emitter's light on as 1/cos α and a field's as cos α, with sin α = k·ρ:
    //   emitter  (1 − √(1 − k²/4)) / (1 − √(1 − k²))           0.2055
    //   field    (1 − (1 − k²/4)^(3/2)) / (1 − (1 − k²)^(3/2))  0.2970
    // Counting each AIMED ray alike would put 9.8% inside half the radius.
    const s0 = oil().system;
    const last = s0.prescription.surfaces.length - 1;
    const dz = 20;
    const s1: OpticalSystem = {
      ...s0,
      prescription: {
        ...s0.prescription,
        surfaces: s0.prescription.surfaces.map((x, i) => (i === last ? { ...x, thickness: x.thickness + dz } : x)),
      },
    };
    const g = geometricPsf(s1, 0, L, { ...EXIT, source, pupilSamples: 64, padFactor: 4 });
    const na = imageNumericalAperture(s0, L);
    const blurMm = (dz * na) / Math.sqrt(1 - na * na);
    const half = g.size / 2;
    let inside = 0;
    let total = 0;
    for (let y = 0; y < g.size; y++) {
      for (let x = 0; x < g.size; x++) {
        const v = g.intensity[y * g.size + x]!;
        total += v;
        if (Math.hypot(x - half, y - half) * g.pixelScaleMm <= blurMm / 2) inside += v;
      }
    }
    const k = rimSine(s0);
    const closed =
      source === "emitter"
        ? (1 - Math.sqrt(1 - (k * k) / 4)) / (1 - Math.sqrt(1 - k * k))
        : (1 - (1 - (k * k) / 4) ** 1.5) / (1 - (1 - k * k) ** 1.5);
    // 0.20625 and 0.29741 measured on a 41-pixel radius: the histogram's pixel
    // edge (§ 2i read 0.2555 against 0.25 on it) and the objective's 0.5%
    // sine-condition residue.
    expect(Math.abs(inside / total - closed)).toBeLessThan(0.005);
    // NEGATIVE CONTROL: § 2i's uniform disc is a quarter, 0.044 and 0.047 away.
    expect(Math.abs(inside / total - 0.25)).toBeGreaterThan(0.04);
  }, 180_000);
});

describe("§ 2i.5 — where the map is linear, nothing moves but the pupil's distortion", () => {
  it("the dry 4×'s Strehl in the exit layout is the aim layout's to 1e-3; the oil's moves 0.909 → 0.930", () => {
    const strehls = [dry(), oil()].map(({ system: s }) => {
      const map = opdMap(s, 0, L, pupilGrid(21));
      const sp = systemPupil(s, 0, L, EXIT);
      const grid = { pupilSamples: 64, padFactor: 4 } as const;
      const aimLaid = psfFromPupilFunction(pupilFunctionFromOpd(map, fitZernike(map.samples, 28)), sp.scale, 0, grid);
      return { exit: psf(s, 0, L, { ...EXIT, ...grid }).strehl, aim: aimLaid.strehl };
    });
    expect(Math.abs(strehls[0]!.exit - strehls[0]!.aim)).toBeLessThan(1e-3);
    expect(strehls[1]!.exit - strehls[1]!.aim).toBeGreaterThan(0.015);
  });
});
