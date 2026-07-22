import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { psf, encircledEnergy, Psf } from "../src/wave/psf";
import {
  geometricPsf,
  blendPsf,
  geometricWeight,
  adaptivePsf,
  defaultRayGrid,
  BLEND_HALF_WIDTH,
  TARGET_RAYS_PER_BLUR_PIXEL,
} from "../src/wave/geometric";
import { PHASE_STEP_LIMIT } from "../src/wave/fidelity";

/**
 * Rungs for the second PSF branch and the switch between them.
 *
 * The geometric branch is not an approximation of the FFT — it is the correct
 * physics in the regime where the FFT has aliased, exactly as the FFT is
 * correct where rays under-describe. So it gets its own external pin (the
 * defocus blur disc), and then the two branches are shown to agree where they
 * overlap.
 */

const R = -200;
const APERTURE = 10;
const NA = APERTURE / Math.abs(R / 2);

function mirror(conic: number, imageOffset?: number, field = 0): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic,
        semiAperture: APERTURE,
        thickness: R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: APERTURE },
    field: { kind: "angle", values: [field] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
    ...(imageOffset === undefined ? {} : { imageSurface: { offsetFromLastVertex: imageOffset } }),
  };
}

/** Radius containing `fraction` of the energy, in pixels, by bisection. */
function energyRadiusPixels(p: Psf, fraction: number): number {
  let lo = 0;
  let hi = p.size / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (encircledEnergy(p, mid) < fraction) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Intensity centroid in pixels, relative to the grid centre. */
function centroid(p: Psf): { x: number; y: number } {
  const n = p.size;
  const c = n / 2;
  let sx = 0;
  let sy = 0;
  let s = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = p.intensity[y * n + x]!;
      sx += v * (x - c);
      sy += v * (y - c);
      s += v;
    }
  }
  return s > 0 ? { x: sx / s, y: sy / s } : { x: 0, y: 0 };
}

const GRID = { pupilSamples: 64, padFactor: 4 } as const;

/**
 * Rung: the defocused geometric spot is a UNIFORM DISC of radius δ·tan u.
 *
 * A perfect system's rays all cross at the focus, so a plane δ away cuts the
 * converging cone in a disc. The pupil→disc map is a linear scaling, so a
 * uniformly filled pupil gives a uniformly filled disc — and the encircled
 * energy of a uniform disc is exactly (r/R_blur)².
 *
 * That quadratic law is the strong half of this rung: it is a pure shape
 * statement with no scale in it at all, so it survives whatever the exact
 * marginal-ray angle turns out to be. The radius itself is then checked
 * against δ·tan u separately.
 */
describe("the geometric branch reproduces the defocus blur disc", () => {
  const delta = 0.5;
  const g = geometricPsf(mirror(-1, R / 2 - delta), 0, LINE_D, GRID);

  it("encircled energy follows (r/R)² — the signature of a uniform disc", () => {
    const outer = energyRadiusPixels(g, 0.99);
    // A uniform disc reaches 99% of its energy at 0.995 of its radius.
    const blur = outer / 0.995;
    for (const frac of [0.4, 0.5, 0.6, 0.7071, 0.8]) {
      const measured = encircledEnergy(g, frac * blur);
      expect(Math.abs(measured - frac * frac)).toBeLessThan(0.02);
    }
  });

  it("the disc radius is δ·tan u, the marginal ray's convergence angle", () => {
    const blur = energyRadiusPixels(g, 0.99) / 0.995;
    const measuredMm = blur * g.pixelScaleMm;
    // tan u from the real marginal ray: the paraboloid's sag moves the vertex
    // of the cone, so this is not exactly δ·NA — hence a 2% band at NA 0.1.
    const expectedMm = delta * NA;
    expect(measuredMm / expectedMm).toBeGreaterThan(0.98);
    expect(measuredMm / expectedMm).toBeLessThan(1.02);
  });
});

/**
 * Rung: MATCHED NORMALIZATION — the obligation ARCHITECTURE places on the
 * fidelity switch. Both branches integrate to the same energy, so crossing the
 * switch cannot change how bright the image is.
 */
describe("both branches carry exactly the same energy", () => {
  const system = mirror(-1, R / 2 - 0.3);
  const d = psf(system, 0, LINE_D, GRID);
  const g = geometricPsf(system, 0, LINE_D, GRID);

  it("the geometric branch integrates to the diffraction branch's energy", () => {
    expect(g.energy / d.energy).toBeCloseTo(1, 12);
    let sum = 0;
    for (let i = 0; i < g.intensity.length; i++) sum += g.intensity[i]!;
    expect(sum / g.energy).toBeCloseTo(1, 10);
  });

  it("every blend of them carries that energy too", () => {
    for (const w of [0, 0.13, 0.5, 0.87, 1]) {
      const b = blendPsf(d, g, w);
      let sum = 0;
      for (let i = 0; i < b.intensity.length; i++) sum += b.intensity[i]!;
      expect(sum / d.energy).toBeCloseTo(1, 10);
    }
  });

  it("an obstruction removes the same energy from both branches", () => {
    const eps = 0.4;
    const od = psf(system, 0, LINE_D, { ...GRID, obstruction: eps });
    const og = geometricPsf(system, 0, LINE_D, { ...GRID, obstruction: eps });
    expect(og.energy / od.energy).toBeCloseTo(1, 12);
    expect(od.energy / d.energy).toBeGreaterThan((1 - eps * eps) * 0.99);
    expect(od.energy / d.energy).toBeLessThan((1 - eps * eps) * 1.01);
  });
});

describe("the blend band is smooth, not a threshold", () => {
  it("is exactly one branch at each edge of the band", () => {
    expect(geometricWeight(PHASE_STEP_LIMIT - BLEND_HALF_WIDTH)).toBe(0);
    expect(geometricWeight(PHASE_STEP_LIMIT + BLEND_HALF_WIDTH)).toBe(1);
    expect(geometricWeight(PHASE_STEP_LIMIT)).toBeCloseTo(0.5, 12);
  });

  /**
   * Smoothstep is C¹ at both edges: its derivative vanishes there. That is
   * what a hard switch — or a linear ramp — fails to provide, and it is why
   * dragging a slider through the transition shows no pop and no kink.
   */
  it("has zero slope at both edges, so nothing kinks", () => {
    const h = 1e-6;
    const lo = PHASE_STEP_LIMIT - BLEND_HALF_WIDTH;
    const hi = PHASE_STEP_LIMIT + BLEND_HALF_WIDTH;
    expect(Math.abs(geometricWeight(lo + h) - geometricWeight(lo)) / h).toBeLessThan(1e-3);
    expect(Math.abs(geometricWeight(hi) - geometricWeight(hi - h)) / h).toBeLessThan(1e-3);
  });

  it("is monotone across the band", () => {
    let previous = -1;
    for (let i = 0; i <= 40; i++) {
      const step = PHASE_STEP_LIMIT - 2 * BLEND_HALF_WIDTH + (i / 40) * 4 * BLEND_HALF_WIDTH;
      const w = geometricWeight(step);
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });

  it("blending at w = 0 and w = 1 returns the inputs unchanged", () => {
    const system = mirror(-1, R / 2 - 0.3);
    const d = psf(system, 0, LINE_D, GRID);
    const g = geometricPsf(system, 0, LINE_D, GRID);
    const atZero = blendPsf(d, g, 0);
    const atOne = blendPsf(d, g, 1);
    for (let i = 0; i < d.intensity.length; i += 997) {
      expect(atZero.intensity[i]!).toBeCloseTo(d.intensity[i]!, 12);
      expect(atOne.intensity[i]!).toBeCloseTo(g.intensity[i]!, 12);
    }
  });
});

/**
 * Rung: the two branches AGREE where both are valid — the continuity claim the
 * whole switch rests on.
 *
 * At large defocus the diffraction pattern approaches the geometric blur disc.
 * The FFT is kept honest there by raising the pupil sampling (which is exactly
 * the point of a per-sample criterion), so this compares two independently
 * computed answers in a regime where both are sound.
 */
describe("the branches agree in the regime where both are valid", () => {
  const delta = 0.5;
  const system = mirror(-1, R / 2 - delta);
  // 256 samples across the pupil keeps the FFT branch unaliased at this much
  // defocus; at 64 it would not be, which is the criterion doing its job.
  const dense = { pupilSamples: 256, padFactor: 4 } as const;

  it("the diffraction PSF's blur radius matches the geometric one", () => {
    const d = psf(system, 0, LINE_D, dense);
    const g = geometricPsf(system, 0, LINE_D, dense);
    const rd = energyRadiusPixels(d, 0.9) * d.pixelScaleMm;
    const rg = energyRadiusPixels(g, 0.9) * g.pixelScaleMm;
    expect(rd / rg).toBeGreaterThan(0.97);
    expect(rd / rg).toBeLessThan(1.03);
  });
});

/**
 * Rung: the PSF centroid equals the geometric spot centroid.
 *
 * A standard result — the diffraction PSF's centroid is fixed by the mean
 * wavefront gradient over the pupil, which is precisely the mean ray landing
 * position. So an asymmetric aberration must displace both branches by the
 * same amount, in the same direction.
 *
 * This is the only rung here that can catch a transverse SIGN or orientation
 * mismatch between the branches: every rotationally symmetric test in the wave
 * layer is blind to one, and it would surface later as coma flaring the wrong
 * way — after the blend had already been trusted.
 */
describe("both branches place the centroid in the same place", () => {
  it("an off-axis coma flare displaces both identically", () => {
    const offAxis = mirror(0, undefined, 1.5);
    const d = psf(offAxis, 1.5, LINE_D, GRID);
    const g = geometricPsf(offAxis, 1.5, LINE_D, GRID);
    const cd = centroid(d);
    const cg = centroid(g);

    // The aberration must actually be asymmetric, or this proves nothing.
    expect(Math.abs(cd.x)).toBeGreaterThan(1);
    expect(Math.sign(cd.x)).toBe(Math.sign(cg.x));
    expect(Math.abs(cd.x - cg.x) / Math.abs(cg.x)).toBeLessThan(0.05);
    // Fields lie in the x–z plane, so neither branch may drift in y.
    expect(Math.abs(cd.y)).toBeLessThan(0.5);
    expect(Math.abs(cg.y)).toBeLessThan(0.5);
  });
});

/**
 * Rungs: the ray grid is sized by the blur, not by a constant.
 *
 * Found by driving the app, not by a rung: a wide-open singlet falls entirely
 * to the geometric branch (correctly) and spreads its light over ~10⁵ pixels,
 * which a fixed 151² grid's 23k rays cannot fill — the image came back as
 * speckle that is honest shot noise, but a picture the user cannot use. The
 * default now derives the blur radius from the same traced gradient the
 * fidelity switch runs on (r_blur = 2·padFactor·g pixels — the identity that
 * puts rays at the grid edge exactly at the Nyquist phase step) and sizes the
 * bundle to hold per-pixel fluctuation at ~1/√TARGET_RAYS_PER_BLUR_PIXEL.
 *
 * The fluctuation is measured as the coefficient of variation over the
 * interior of the blur disc (r < 0.8·r_blur), where a defocused perfect
 * mirror's histogram should be UNIFORM — the same uniform-disc fact the
 * encircled-energy rung pins, read pointwise instead of integrally.
 */
describe("the ray grid scales with the blur", () => {
  const defocused = (delta: number) => mirror(-1, R / 2 - delta);

  /** CV of the histogram inside 0.8 of the blur radius. */
  function interiorCv(p: Psf): number {
    const g = p.sampling!.maxGradientWavesPerRadius;
    const rMax = 0.8 * 2 * 4 * g; // 0.8 · (2·padFactor·g) px
    const n = p.size;
    const c = n / 2;
    let sum = 0;
    let sum2 = 0;
    let count = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (Math.hypot(x - c, y - c) > rMax) continue;
        const v = p.intensity[y * n + x]!;
        sum += v;
        sum2 += v * v;
        count++;
      }
    }
    const mean = sum / count;
    return Math.sqrt(Math.max(0, sum2 / count - mean * mean)) / mean;
  }

  const mid = geometricPsf(defocused(0.25), 0, LINE_D, GRID); // blur ≈ 32 px
  const large = geometricPsf(defocused(0.5), 0, LINE_D, GRID); // blur ≈ 64 px

  it("the default tracks the blur and reports what it chose", () => {
    // Small blur stays on the floor — the old fixed default, kept cheap.
    const small = geometricPsf(defocused(0.05), 0, LINE_D, GRID);
    expect(small.rayGrid).toBe(151);
    // Defocus gradient is linear in δ, so doubling the defocus must double
    // the grid: the default is proportional to the blur, not keyed to bands.
    expect(large.rayGrid! / mid.rayGrid!).toBeGreaterThan(1.9);
    expect(large.rayGrid! / mid.rayGrid!).toBeLessThan(2.1);
    // And the reported grid IS the formula's answer, so callers can trust it.
    expect(mid.rayGrid).toBe(
      defaultRayGrid(mid.sampling!.maxGradientWavesPerRadius, 4, mid.size),
    );
  });

  it("per-pixel fluctuation is bounded and FLAT as the blur grows", () => {
    // The designed bound: TARGET rays per pixel put Poisson-like fluctuation
    // at 1/√TARGET. The stratified pupil grid beats it (measured ~0.19
    // against the 0.33 bound), so the assertion has real slack yet still
    // fails a default that stops tracking the blur.
    const cvMid = interiorCv(mid);
    const cvLarge = interiorCv(large);
    expect(cvMid).toBeLessThan(1 / Math.sqrt(TARGET_RAYS_PER_BLUR_PIXEL));
    expect(cvLarge).toBeLessThan(1 / Math.sqrt(TARGET_RAYS_PER_BLUR_PIXEL));
    // Flatness is the actual claim — 4× the blur area, same noise. A fixed
    // count degrades as the blur grows; the scaled default must not.
    expect(Math.abs(cvLarge / cvMid - 1)).toBeLessThan(0.25);
    // Negative control: the old fixed 151 on the same system reads 2× worse
    // than the scaled default, and keeps degrading with aperture.
    const fixed = geometricPsf(defocused(0.5), 0, LINE_D, { ...GRID, rayGrid: 151 });
    expect(interiorCv(fixed)).toBeGreaterThan(1.5 * cvLarge);
  });

  it("the fluctuation halves as the ray grid doubles", () => {
    // The convergence statement, same shape as the encircled-energy rungs:
    // quadrupling the ray density must halve the noise, or the "noise" is
    // structure being mistaken for noise. Measured 0.189 → 0.117 → 0.059.
    const doubled = geometricPsf(defocused(0.5), 0, LINE_D, {
      ...GRID,
      rayGrid: 2 * large.rayGrid! + 1,
    });
    expect(interiorCv(doubled) / interiorCv(large)).toBeLessThan(0.8);
  });
});

describe("adaptivePsf picks the branch the criterion asks for", () => {
  it("uses pure diffraction for a gentle wavefront", () => {
    const a = adaptivePsf(mirror(-1), 0, LINE_D, GRID);
    expect(a.geometricWeight).toBe(0);
    expect(a.phaseStepWaves).toBeLessThan(PHASE_STEP_LIMIT - BLEND_HALF_WIDTH);
    expect(a.strehl).toBeGreaterThan(0.9999);
  });

  it("falls all the way to geometric for a wavefront that aliases badly", () => {
    const a = adaptivePsf(mirror(-1, R / 2 - 2), 0, LINE_D, GRID);
    expect(a.phaseStepWaves).toBeGreaterThan(PHASE_STEP_LIMIT + BLEND_HALF_WIDTH);
    expect(a.geometricWeight).toBe(1);
  });

  it("conserves energy whichever branch it lands on", () => {
    for (const offset of [undefined, R / 2 - 0.3, R / 2 - 2]) {
      const a = adaptivePsf(mirror(-1, offset), 0, LINE_D, GRID);
      let sum = 0;
      for (let i = 0; i < a.intensity.length; i++) sum += a.intensity[i]!;
      expect(sum / a.energy).toBeCloseTo(1, 9);
    }
  });
});
