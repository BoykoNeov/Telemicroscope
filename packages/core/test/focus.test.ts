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
