import { describe, expect, test } from "vitest";
import { visualSystem } from "../src/pupil/visual";
import { reducedEye } from "../src/designs/eye";
import { achromaticObjective, plosslEyepiece } from "../src/designs";
import { psf, radialProfile, Psf } from "../src/wave/psf";
import { pupils } from "../src/pupil/pupils";
import { chiefRay } from "../src/pupil/aiming";
import { traceRay } from "../src/trace/sequential";
import { vertexPositions } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";

const LAM = 587.56;

/**
 * Visual mode (VALIDATION § 5q): a telescope with the observer's eye spliced on,
 * forming a real retinal image. The headline is the two-stop competition — when
 * the eye pupil is narrower than the exit pupil the iris BECOMES the stop and the
 * effective aperture collapses to d_eye·|M|, so the image dims and blurs. All of
 * it emerges from `limitingStop` (§ 5p) feeding the trace, not from formulas.
 */

const OBJECTIVE = achromaticObjective({ apertureMm: 100, focalRatio: 10 });
const APERTURE_RADIUS = 50;

function scope(eyePupilDiameterMm: number, eyepieceEflMm = 25) {
  return visualSystem({
    objective: OBJECTIVE.prescription,
    eyepiece: plosslEyepiece({ focalLengthMm: eyepieceEflMm }).prescription,
    apertureRadiusMm: APERTURE_RADIUS,
    eye: { pupilDiameterMm: eyePupilDiameterMm },
    wavelengthNm: LAM,
  });
}

/** First dark ring of the retinal PSF, in image-plane mm (sub-pixel). */
function airyRadiusMm(p: Psf): number {
  const { radius, mean } = radialProfile(p, p.size / 2);
  let peak = 0;
  for (const v of mean) if (v > peak) peak = v;
  for (let i = 1; i < mean.length - 1; i++) {
    if (mean[i]! < peak * 0.02 && mean[i]! < mean[i - 1]! && mean[i]! <= mean[i + 1]!) {
      const a = mean[i - 1]!;
      const b = mean[i]!;
      const c = mean[i + 1]!;
      const denom = a - 2 * b + c;
      const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const step = radius[1]! - radius[0]!;
      return (radius[i]! + shift * step) * p.pixelScaleMm;
    }
  }
  throw new Error("no dark ring in the retinal PSF");
}

describe("reduced eye model", () => {
  // Emsley's numbers, derived from the two scalars (60 D, n = 4/3), not
  // transcribed. The nodal distance is the standard trap: 16.7 mm (the retinal
  // scale lever), not the 22.2 mm axial length.
  test("eye geometry follows from power and index", () => {
    const e = reducedEye({ pupilDiameterMm: 3 });
    expect(e.cornealRadiusMm).toBeCloseTo(5.55, 2);
    expect(e.axialLengthMm).toBeCloseTo(22.22, 1);
    expect(e.posteriorNodalDistanceMm).toBeCloseTo(16.67, 1);
    // PND = 1/F exactly, whatever the index.
    expect(e.posteriorNodalDistanceMm).toBeCloseTo(1000 / 60, 6);
    // Retina at the paraxial focus of one surface: axial length = n/F.
    expect(e.axialLengthMm).toBeCloseTo(e.cornealRadiusMm + e.posteriorNodalDistanceMm, 9);
  });

  // The eye's ideal-ness is a CLOSED FORM in its own right — the Cartesian
  // ellipsoid K = −1/n² (eccentricity 1/n) images a collimated axial beam
  // stigmatically. Pinned in isolation, telescope removed, with the sphere it
  // corrects as the negative control. At a wide 6 mm pupil (≈ f/2.8) the single
  // surface's spherical aberration is violent, so the two are unmistakable.
  test("the corneal conic K = −1/n² nulls the eye's own spherical aberration", () => {
    const grid = { traceSamples: 41, pupilSamples: 128, padFactor: 8 } as const;
    const e = reducedEye({ pupilDiameterMm: 6 });
    const n = e.axialLengthMm / e.posteriorNodalDistanceMm; // n = L/PND
    const cornea = e.prescription.surfaces[0]!;

    const bareEye = (conic: number): OpticalSystem => ({
      prescription: { surfaces: [{ ...cornea, conic }] },
      aperture: { kind: "stopRadius", value: e.pupilDiameterMm / 2 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LAM, weight: 1 }],
      conjugate: { kind: "infinite" },
    });

    // The Cartesian conic is exactly the value the design carries.
    expect(cornea.conic).toBeCloseTo(-1 / (n * n), 9);

    const ideal = psf(bareEye(-1 / (n * n)), 0, LAM, grid).strehl;
    const sphere = psf(bareEye(0), 0, LAM, grid).strehl; // negative control

    expect(ideal).toBeGreaterThan(0.99); // diffraction-limited, alone
    expect(sphere).toBeLessThan(0.3); // the sphere it corrects, wrecked by SA
  });
});

describe("visual mode — the two-stop competition", () => {
  // ── HEADLINE: the effective aperture is min(D, d_eye·|M|) ──────────────────
  // The falsifiable core. A 100 mm f/10 with a 25 mm eyepiece: M = 40, exit
  // pupil 2.5 mm. Sweep the eye pupil across that: above it the objective fills
  // the retina (100 mm); below it the iris does, and the aperture collapses to
  // d_eye·|M| — a closed form the trace either reproduces or refuses.
  test("effective aperture collapses to d_eye·|M| once the iris under-fills", () => {
    const D = 100;
    for (const dEye of [7, 4, 2.5, 2, 1.5, 1]) {
      const v = scope(dEye);
      const M = Math.abs(v.magnification);
      const expected = Math.min(D, dEye * M);
      expect.soft(v.effectiveApertureMm, `d_eye=${dEye}`).toBeCloseTo(expected, 1);
    }
  });

  // ── The knee is the exit pupil, and M_min = D/d_eye is the same boundary ───
  test("the iris takes over exactly when the eye pupil drops below the exit pupil", () => {
    const v = scope(3);
    const exitPupil = v.exitPupilDiameterMm; // ≈ 2.5 mm
    // Just inside the exit pupil → objective still fills; just below → iris wins.
    expect(scope(exitPupil + 0.05).irisLimited).toBe(false);
    expect(scope(exitPupil - 0.05).irisLimited).toBe(true);
    // The boundary IS M_min = D/d_eye: at the crossover, |M| = D / d_eye.
    expect(Math.abs(v.magnification)).toBeCloseTo(100 / exitPupil, 6);
  });

  // ── MECHANISM MADE VISIBLE: the retinal Airy broadens by D/(d_eye·|M|) ─────
  // The same collapse, seen in the image rather than the pupil. Full aperture
  // vs a 1 mm iris: the retinal diffraction disc grows by exactly the ratio of
  // effective apertures.
  test("the retinal Airy disc grows by the effective-aperture ratio", () => {
    const grid = { traceSamples: 31, pupilSamples: 64, padFactor: 8 } as const;
    const full = scope(7); // objective-limited: 100 mm
    const stopped = scope(1); // iris-limited: 1·40 = 40 mm

    const airyFull = airyRadiusMm(psf(full.system, 0, LAM, grid));
    const airyStopped = airyRadiusMm(psf(stopped.system, 0, LAM, grid));

    const expectedRatio = full.effectiveApertureMm / stopped.effectiveApertureMm; // = 2.5
    expect(airyStopped / airyFull).toBeCloseTo(expectedRatio, 1);
  });

  // ── TWO INDEPENDENT ROUTES agree ──────────────────────────────────────────
  // The iris-limited retinal PSF two ways: (A) `limiting` sizes the pupil to the
  // iris directly; (B) `declared` keeps the objective as stop and lets the exact
  // tracer BLOCK rays at the iris rim, which the §2f vignette mask then carves
  // out. Different code paths, one physical aperture — the diffraction disc must
  // match.
  test("stop-selection and exact-trace masking give the same iris-limited PSF", () => {
    // padFactor 8: the iris-limited disc sits at only ~10 px at pad 4, where the
    // first-min fit is biased — the two routes agree once the image is resolved.
    const grid = { traceSamples: 41, pupilSamples: 128, padFactor: 8, edgeSamples: 8 } as const;
    const v = scope(1); // iris-limited

    const viaLimiting = v.system; // apertureStop: "limiting"
    const viaMask: OpticalSystem = { ...v.system, apertureStop: { kind: "declared" } };

    const airyLimiting = airyRadiusMm(psf(viaLimiting, 0, LAM, grid));
    const airyMask = airyRadiusMm(psf(viaMask, 0, LAM, grid));

    expect(airyMask / airyLimiting).toBeCloseTo(1, 1);
  });

  // ── THIRD ROUTE (sanity anchor): retinal magnification = |M| ───────────────
  // A small field angle lands on the retina at |M|·PND·tan θ — the eye re-images
  // the magnified apparent angle through its nodal distance. Nearly true by
  // construction, but it would catch a gross composition error (wrong eye
  // placement, PND↔axial-length swap).
  test("a field angle images to |M|·PND·tan θ on the retina", () => {
    const v = scope(7); // objective-limited, unvignetted field
    // Small angle: the departure from the paraxial |M|·PND·tan θ is the
    // eyepiece's distortion (∝ θ², pinned precisely in § 5n), kept negligible here.
    const thetaDeg = 0.05;
    const pg = pupils(v.system, LAM);
    const cr = chiefRay(v.system, pg, thetaDeg, LAM);
    const res = traceRay(v.system.prescription, cr);
    expect(res.status).toBe("ok");

    const vz = vertexPositions(v.system.prescription);
    const retinaZ = vz[vz.length - 1]! + v.eye.axialLengthMm;
    const ray = res.ray!;
    const t = (retinaZ - ray.origin.z) / ray.dir.z;
    const retinalHeightMm = Math.abs(ray.origin.x + t * ray.dir.x);

    const predicted = Math.abs(v.magnification) * v.eye.posteriorNodalDistanceMm * Math.tan((thetaDeg * Math.PI) / 180);
    expect(retinalHeightMm / predicted).toBeCloseTo(1, 2);
  });
});
