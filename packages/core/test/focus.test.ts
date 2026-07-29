import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { getMedium } from "../src/materials/catalog";
import { traceRay, axialCrossingZ } from "../src/trace/sequential";
import { pupils } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { bestFocus, paraxialImageOffset, withFocus } from "../src/analysis/focus";
import { exitBundle, spotAt, spotDiagram, bestSpotZ } from "../src/analysis/spot";
import {
  FRONT_ELEMENT_MEDIUM,
  IMMERSION_MEDIUM,
  oilImmersionObjective,
} from "../src/designs/immersion";
import { infinityCorrectedMicroscope, tubeLens } from "../src/designs/microscope";

/**
 * Focus solve. The rung that matters is that the three criteria DISAGREE by a
 * predictable amount, because "is it in focus?" has no single answer and the
 * engine must reproduce the classical spread rather than a convenient one.
 *
 * Test system: a spherical mirror, whose only significant aberration on axis
 * is primary spherical. Writing the wavefront as W(ρ) = a·ρ⁴ + b·ρ² with b the
 * defocus contributed by moving the image plane, third-order theory gives
 *
 *   Var(W)     = 4a²/45 + ab/6 + b²/12   → minimised at b = −a       (wavefront)
 *   ⟨(W′)²⟩    = 4a²    + 16ab/3 + 2b²   → minimised at b = −4a/3     (spot)
 *   paraxial focus b = 0;  marginal focus b = −2a
 *
 * b is linear in the image-plane shift δz (W = ½·δz·NA²·ρ², already pinned in
 * opd.test.ts), so the RATIOS of the shifts are pure numbers — 4/3 and 2 — with
 * no NA, no focal length, and no conversion factor left in them. Tolerances
 * below are bounded by the neglected fifth-order term, which scales as NA²;
 * the NA-halving test demonstrates exactly that.
 *
 * For a spherical mirror of semi-aperture h and radius R, a = W₀₄₀ = h⁴/(4|R|³),
 * which lets the absolute RMS values be pinned too, not just their ratios.
 */

const R = -200; // concave mirror facing the light; paraxial focus at R/2
const GRID = 41;

function sphericalMirror(semiAperture: number, conic = 0): OpticalSystem {
  return {
    prescription: {
      surfaces: [
        {
          kind: "reflect",
          curvature: 1 / R,
          conic,
          semiAperture,
          thickness: R / 2,
          isStop: true,
        },
      ],
    },
    aperture: { kind: "stopRadius", value: semiAperture },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** W₀₄₀ in mm for a spherical mirror at infinite conjugate. */
const primarySA = (semiAperture: number): number =>
  semiAperture ** 4 / (4 * Math.abs(R) ** 3);

/** Where the exact rim ray crosses the axis: the marginal focus. */
function marginalFocusOffset(system: OpticalSystem): number {
  const pupil = pupils(system, LINE_D);
  const rim = traceRay(system.prescription, aimRay(system, pupil, 0, { px: 1, py: 0 }, LINE_D));
  if (rim.status !== "ok" || !rim.ray) throw new Error("rim ray lost");
  return axialCrossingZ(rim.ray); // last vertex is at z = 0
}

describe("paraxial image plane", () => {
  it("a mirror focuses at R/2", () => {
    expect(paraxialImageOffset(sphericalMirror(10), LINE_D)).toBeCloseTo(R / 2, 12);
  });

  /**
   * Conjugate-general check: the paraxial plane is computed as an axis
   * crossing, so a FINITE conjugate must satisfy the single-surface imaging
   * equation n₂/s′ − n₁/s = (n₂ − n₁)/R. The microscope branch depends on this
   * path, so it is pinned before anything is built on it.
   */
  it("a finite conjugate matches n₂/s′ − n₁/s = (n₂ − n₁)/R", () => {
    const curvature = 1 / 50;
    const prescription: Prescription = {
      surfaces: [
        { kind: "refract", curvature, semiAperture: 10, thickness: 200, medium: "N-BK7", isStop: true },
      ],
    };
    const system: OpticalSystem = {
      prescription,
      aperture: { kind: "stopRadius", value: 5 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance: 300 },
    };

    const n1 = 1;
    const n2 = getMedium("N-BK7").n(LINE_D);
    const s = -300;
    const sPrime = n2 / ((n2 - n1) * curvature + n1 / s);

    expect(paraxialImageOffset(system, LINE_D)).toBeCloseTo(sPrime, 9);
  });
});

describe("the three focus criteria disagree by the third-order amounts", () => {
  const semi = 10; // NA = 0.1
  const system = sphericalMirror(semi);

  const paraxial = bestFocus(system, "paraxial", { pupilSamples: GRID });
  const spot = bestFocus(system, "minRmsSpot", { pupilSamples: GRID });
  const wave = bestFocus(system, "minRmsWavefront", { pupilSamples: GRID });
  const marginalShift = marginalFocusOffset(system) - paraxial.offsetFromLastVertex;

  it("all three sit between paraxial and marginal focus, on the same side", () => {
    expect(paraxial.shiftFromParaxial).toBe(0);
    // Light travels −z after the mirror, so a shorter focus is a LESS negative
    // offset: every shift is positive, and none overshoots the marginal ray.
    for (const s of [wave.shiftFromParaxial, spot.shiftFromParaxial, marginalShift]) {
      expect(s).toBeGreaterThan(0);
    }
    expect(wave.shiftFromParaxial).toBeLessThan(spot.shiftFromParaxial);
    expect(spot.shiftFromParaxial).toBeLessThan(marginalShift);
  });

  it("min-RMS-spot focus sits 4/3 as far out as min-RMS-wavefront focus", () => {
    const ratio = spot.shiftFromParaxial / wave.shiftFromParaxial;
    // The 1% band is the fifth-order residual at NA 0.1, not a fitted number:
    // the next test shows it shrinking with NA.
    expect(ratio).toBeGreaterThan((4 / 3) * 0.99);
    expect(ratio).toBeLessThan((4 / 3) * 1.01);
  });

  it("marginal focus sits twice as far out as min-RMS-wavefront focus", () => {
    const ratio = marginalShift / wave.shiftFromParaxial;
    expect(ratio).toBeGreaterThan(2 * 0.99);
    expect(ratio).toBeLessThan(2 * 1.01);
  });

  it("the 4/3 ratio tightens as NA falls, which is what bounds the tolerance", () => {
    const error = (h: number): number => {
      const sys = sphericalMirror(h);
      const s = bestFocus(sys, "minRmsSpot", { pupilSamples: GRID }).shiftFromParaxial;
      const w = bestFocus(sys, "minRmsWavefront", { pupilSamples: GRID }).shiftFromParaxial;
      return Math.abs(s / w / (4 / 3) - 1);
    };
    // Halving the aperture quarters NA² and must visibly improve the match —
    // the signature of a neglected higher-order term rather than a bug.
    expect(error(5)).toBeLessThan(error(10) / 4);
  });

  it("each criterion really is best by its own measure, and not by the other's", () => {
    const points = pupilGrid(GRID);
    const bundle = exitBundle(system, 0, LINE_D, points);
    const spotAtSpot = spotAt(bundle, spot.z).rmsRadius;
    const spotAtWave = spotAt(bundle, wave.z).rmsRadius;
    const waveAtWave = wave.merit;
    const waveAtSpot = opdMap(
      withFocus(system, spot.offsetFromLastVertex),
      0,
      LINE_D,
      points,
    ).rmsWaves;

    expect(spotAtSpot).toBeLessThan(spotAtWave);
    expect(waveAtWave).toBeLessThan(waveAtSpot);
  });
});

describe("absolute merit values match the closed forms", () => {
  for (const semi of [10, 5]) {
    const system = sphericalMirror(semi);
    const a = primarySA(semi);
    const na = semi / Math.abs(R / 2);
    const wavesPerMm = 1e6 / LINE_D;

    it(`RMS wavefront at best focus is W₀₄₀/(6√5) (h = ${semi} mm)`, () => {
      const wave = bestFocus(system, "minRmsWavefront", { pupilSamples: GRID });
      const expected = (a / (6 * Math.sqrt(5))) * wavesPerMm;
      expect(wave.merit).toBeGreaterThan(expected * 0.99);
      expect(wave.merit).toBeLessThan(expected * 1.01);
    });

    it(`balancing defocus improves RMS wavefront exactly 4× (h = ${semi} mm)`, () => {
      // Var(b = 0) = 4a²/45 and Var(b = −a) = a²/180, so the RMS ratio is
      // √(4/45 · 180) = 4. Derived, not remembered.
      const paraxialOffset = paraxialImageOffset(system, LINE_D);
      const atParaxial = opdMap(
        withFocus(system, paraxialOffset),
        0,
        LINE_D,
        pupilGrid(GRID),
      ).rmsWaves;
      const atBest = bestFocus(system, "minRmsWavefront", { pupilSamples: GRID }).merit;
      expect(atParaxial / atBest).toBeGreaterThan(4 * 0.99);
      expect(atParaxial / atBest).toBeLessThan(4 * 1.01);
    });

    it(`RMS spot at best focus is (2/3)·W₀₄₀/NA (h = ${semi} mm)`, () => {
      // ⟨(dW/dρ)²⟩ = 4a²/9 at b = −4a/3, and transverse error is
      // (dW/dρ)/NA, so the RMS spot radius is (2a/3)/NA.
      const spot = bestFocus(system, "minRmsSpot", { pupilSamples: GRID });
      const expected = ((2 / 3) * a) / na;
      expect(spot.merit).toBeGreaterThan(expected * 0.99);
      expect(spot.merit).toBeLessThan(expected * 1.01);
    });
  }
});

describe("an unaberrated system leaves nothing for the criteria to disagree about", () => {
  const paraboloid = sphericalMirror(10, -1);

  it("all three criteria land on the paraboloid's focus", () => {
    for (const criterion of ["paraxial", "minRmsSpot", "minRmsWavefront"] as const) {
      const f = bestFocus(paraboloid, criterion, { pupilSamples: GRID });
      expect(f.offsetFromLastVertex).toBeCloseTo(R / 2, 6);
    }
  });

  it("and the residual merits are numerical noise, not physics", () => {
    expect(bestFocus(paraboloid, "minRmsWavefront", { pupilSamples: GRID }).merit).toBeLessThan(1e-6);
    expect(bestFocus(paraboloid, "minRmsSpot", { pupilSamples: GRID }).merit).toBeLessThan(1e-9);
  });
});

/**
 * § 1.6.1 — the wavefront solve returns the minimum of its own merit, and the
 * bracket that guarantees it.
 *
 * Everything above is on a spherical mirror, where the only aberration is
 * primary spherical and the two planes the solve involves are locked in the
 * 4/3 ratio the rungs pin. That ratio is what sizes the search: `bestFocus`
 * brackets the wavefront minimum with twice the distance from the paraxial
 * plane to the *spot* plane. Third-order theory is the only thing promising
 * those two stay in proportion, and a real objective carrying fifth order can
 * balance its transverse aberration while its wavefront minimum stays put — at
 * which point the estimate collapses toward zero and brackets nothing.
 *
 * The fixture is § 6e.4's 100×/1.40 oil objective looking through a 0.164 mm
 * cover slip, refocused § 6e.5's way. It is a real design rather than a
 * contrived one because the failure needs a mix of orders that a single
 * aberration cannot produce, and because this is where the app met it: A6 draws
 * σ across the slip band and the collapsed bracket put a 3.2× spike in the
 * curve at one thickness, smooth enough on either side to read as physics.
 *
 * The pin is an INDEPENDENT COMPUTATION, not a transcribed number: a scan of
 * the solver's own merit function over the whole plausible range of planes. A
 * solve that returns a plane worse than some plane in that scan has not
 * minimised anything, whatever its merit says. (§ 6s's phrase for this shape:
 * a fix that changes no physics gets identity rungs.)
 *
 * The fixture is duplicated from immersion.test.ts rather than shared: the
 * claim under test belongs to the focus solve, and a rung that reached into
 * another step's file for its system would move with that file.
 */
describe("§ 1.6.1 — the wavefront solve minimises the merit it reports", () => {
  const LAMBDA = LINE_D;
  const TUBE_MM = 200;
  const NOMINAL_SLIP_MM = 0.17;
  const N_SLIP = getMedium(FRONT_ELEMENT_MEDIUM).n(LAMBDA);
  const N_OIL = getMedium(IMMERSION_MEDIUM).n(LAMBDA);

  const objective = oilImmersionObjective({
    magnification: 100,
    numericalAperture: 1.4,
    tubeFocalLengthMm: TUBE_MM,
  });

  /** The built instrument meeting a slip it was not designed for (§ 6e.5). */
  const withSlip = (thicknessMm: number): OpticalSystem => {
    // Refocused the way an immersion objective really is — by moving it, which
    // changes the oil film — so the stack's paraxial apparent distance holds.
    const gapMm =
      objective.frontGroup.hyperhemisphere.immersionGapMm -
      ((thicknessMm - NOMINAL_SLIP_MM) * N_OIL) / N_SLIP;
    const [s0, ...rest] = objective.prescription.surfaces;
    return infinityCorrectedMicroscope({
      objective: {
        ...objective,
        objectDistanceMm: thicknessMm,
        prescription: {
          ...objective.prescription,
          surfaces: [{ ...s0!, thickness: gapMm }, ...rest],
        },
      },
      tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
      objectHeightsMm: [0],
    }).system;
  };

  const PUPIL_SAMPLES = 21;
  /**
   * The merit function `bestFocus` minimises, evaluated the caller's way.
   *
   * `bestFocus` runs it on an aperture-frozen copy; this system's aperture is
   * already a `stopRadius`, so freezing is the identity and the two curves are
   * the same function rather than two that agree.
   */
  const rmsAt = (system: OpticalSystem, offset: number): number =>
    opdMap(withFocus(system, offset), 0, LAMBDA, pupilGrid(PUPIL_SAMPLES)).rmsWaves;

  /** Coarsest scan that resolves the minimum, over ±3.5 mm of image plane. */
  const SCAN_STEP_MM = 0.02;
  const scanMinimum = (system: OpticalSystem, centre: number) => {
    let bestOffset = centre;
    let bestRms = Infinity;
    for (let offset = centre - 3.5; offset <= centre + 3.5; offset += SCAN_STEP_MM) {
      const rms = rmsAt(system, offset);
      if (rms < bestRms) {
        bestRms = rms;
        bestOffset = offset;
      }
    }
    return { offset: bestOffset, rms: bestRms };
  };

  it("the geometric bracket estimate COLLAPSES on this system", () => {
    // The premise of the rung below, asserted rather than described. The spot
    // plane sits on top of the paraxial one while the wavefront minimum is more
    // than a millimetre away, so the estimate is ~17× too narrow — the failure
    // mode, in the two numbers that produce it.
    const system = withSlip(0.164);
    const paraxial = paraxialImageOffset(system, LAMBDA);
    const spot = bestFocus(system, "minRmsSpot", { pupilSamples: PUPIL_SAMPLES });
    const estimate = 2 * Math.abs(spot.offsetFromLastVertex - paraxial);
    const truth = Math.abs(scanMinimum(system, paraxial).offset - paraxial);

    expect(estimate).toBeLessThan(0.1);
    expect(truth).toBeGreaterThan(1.0);
    expect(truth / estimate).toBeGreaterThan(10);
  });

  it("and the solve lands on the scanned minimum anyway", () => {
    const system = withSlip(0.164);
    const paraxial = paraxialImageOffset(system, LAMBDA);
    const scanned = scanMinimum(system, paraxial);
    const solved = bestFocus(system, "minRmsWavefront", { pupilSamples: PUPIL_SAMPLES });

    // Same plane to the scan's own resolution, and no plane in the scan beats
    // the solved one: the solve is at least as good as the best of 350 planes.
    expect(solved.offsetFromLastVertex).toBeCloseTo(scanned.offset, 1);
    expect(Math.abs(solved.offsetFromLastVertex - scanned.offset)).toBeLessThan(SCAN_STEP_MM);
    expect(solved.merit).toBeLessThanOrEqual(scanned.rms);
    // The merit it reports is the merit at the plane it returns — the two could
    // drift apart the moment the search returns something it did not evaluate.
    expect(solved.merit).toBeCloseTo(rmsAt(system, solved.offsetFromLastVertex), 12);
  });

  it("the edge the collapsed bracket used to return is 3× worse", () => {
    // What the defect cost, in the currency the app draws. The old search
    // converged on the top of its own bracket; that plane is a real plane and a
    // real σ, and it is not a minimum of anything.
    const system = withSlip(0.164);
    const paraxial = paraxialImageOffset(system, LAMBDA);
    const spot = bestFocus(system, "minRmsSpot", { pupilSamples: PUPIL_SAMPLES });
    const oldEdge = paraxial + 2 * Math.abs(spot.offsetFromLastVertex - paraxial);
    const solved = bestFocus(system, "minRmsWavefront", { pupilSamples: PUPIL_SAMPLES });

    expect(rmsAt(system, oldEdge) / solved.merit).toBeGreaterThan(3);
  });

  it("a slip whose bracket does NOT collapse is unchanged", () => {
    // The other half of an identity rung: widening must not perturb the solve
    // where the estimate was already good. 0.170 mm is the design point, whose
    // spot plane is 1.8 mm from the paraxial one.
    const system = withSlip(NOMINAL_SLIP_MM);
    const paraxial = paraxialImageOffset(system, LAMBDA);
    const spot = bestFocus(system, "minRmsSpot", { pupilSamples: PUPIL_SAMPLES });
    expect(Math.abs(spot.offsetFromLastVertex - paraxial)).toBeGreaterThan(1);

    const scanned = scanMinimum(system, paraxial);
    const solved = bestFocus(system, "minRmsWavefront", { pupilSamples: PUPIL_SAMPLES });
    expect(Math.abs(solved.offsetFromLastVertex - scanned.offset)).toBeLessThan(SCAN_STEP_MM);
    expect(solved.merit).toBeLessThanOrEqual(scanned.rms);
  });
});

describe("spot diagram mechanics", () => {
  const system = sphericalMirror(10);

  it("evaluating a traced bundle at a plane matches re-tracing to it", () => {
    const bundle = exitBundle(system, 0, LINE_D, pupilGrid(11));
    const direct = spotDiagram(system, 0, LINE_D, pupilGrid(11));
    const reused = spotAt(bundle, R / 2);
    expect(reused.rmsRadius).toBeCloseTo(direct.rmsRadius, 12);
  });

  it("the closed-form best-spot plane beats a scan of nearby planes", () => {
    const bundle = exitBundle(system, 0, LINE_D, pupilGrid(GRID));
    const z = bestSpotZ(bundle);
    const best = spotAt(bundle, z).rmsRadius;
    for (const d of [-0.05, -0.01, -0.001, 0.001, 0.01, 0.05]) {
      expect(spotAt(bundle, z + d).rmsRadius).toBeGreaterThan(best);
    }
  });

  it("vignetted rays are counted, not silently dropped", () => {
    const clipped: OpticalSystem = {
      ...system,
      prescription: {
        surfaces: [
          { kind: "reflect", curvature: 1 / R, conic: 0, semiAperture: 6, thickness: R / 2, isStop: true },
        ],
      },
    };
    const points = pupilGrid(21);
    const bundle = exitBundle(clipped, 0, LINE_D, points);
    expect(bundle.lost).toBeGreaterThan(0);
    expect(bundle.rays.length + bundle.lost).toBe(points.length);
  });

  it("withFocus does not mutate the system it was given", () => {
    const moved = withFocus(system, -50);
    expect(moved.imageSurface?.offsetFromLastVertex).toBe(-50);
    expect(system.imageSurface).toBeUndefined();
  });
});
