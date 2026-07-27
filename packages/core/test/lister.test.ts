import { describe, it, expect } from "vitest";
import { listerObjective, aplanaticSphere } from "../src/designs/lister";
import {
  microscopeObjective,
  tubeLens,
  infinityCorrectedMicroscope,
  InfinityCorrectedObjective,
} from "../src/designs/microscope";
import { seidelSums } from "../src/analysis/seidel";
import { LINE_D } from "../src/materials/dispersion";
import { getMedium } from "../src/materials/catalog";
import { traceRay } from "../src/trace/sequential";
import { paraxialTrace } from "../src/trace/paraxial";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";
import { OpticalSystem } from "../src/trace/system";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { bestFocus, withFocus } from "../src/analysis/focus";
import {
  objectNumericalAperture,
  sineConditionResidual,
} from "../src/pupil/microscope";

/**
 * Rungs for the Lister objective — docs/VALIDATION.md § 6d. The first aplanat in
 * this repo: two cemented doublets whose bendings are solved TOGETHER so that
 * ΣS_I and ΣS_II vanish at once, which § 5j proved no single cemented doublet
 * can do (its two SA-null bendings straddle the coma-free one).
 *
 * The pins that matter are not "the solver reached zero" — that is a convergence
 * readout. They are:
 *
 *  - § 6d.1, the aplanatic sphere: an EXTERNAL, all-orders closed form for what
 *    aplanatism *is*. It pins the hyperhemisphere this step's ceiling argues for,
 *    NOT the Lister, and is labelled as such.
 *  - § 6d.3, the exponent: solve on third-order Seidel, then read the residual
 *    coma off the traced WAVEFRONT and watch its power law change from NA³ to
 *    NA^5.2. A number can be fitted; an order cannot.
 *  - § 6d.4, Maréchal — an external criterion — for the diffraction-limited
 *    reach, bisected rather than interpolated because σ runs as NA⁶.
 */

const LAMBDA = LINE_D;
const TUBE_MM = 200;
const FIELD_MM = 0.005;
const MARECHAL = 1 / 14;

const scopeOf = (objective: InfinityCorrectedObjective): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective,
    tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
    objectHeightsMm: [0, FIELD_MM],
  }).system;

/** σ at best focus, the sine residual, and the traced coma, all at one focus. */
function measure(system: OpticalSystem): { rms: number; sine: number; coma: number } {
  const focus = bestFocus(system, "minRmsWavefront", { pupilSamples: 21 });
  const s = withFocus(system, focus.offsetFromLastVertex);
  const rms = opdMap(s, 0, LAMBDA, pupilGrid(21)).rmsWaves;
  const sine = sineConditionResidual(s, FIELD_MM, LAMBDA);
  const off = opdMap(s, FIELD_MM, LAMBDA, pupilGrid(21));
  const fit = fitZernike(
    off.samples.map((x) => ({ px: x.px, py: x.py, waves: x.waves })),
    15,
  );
  // Noll 7 and 8 are the two coma terms; the field is along x, but taking the
  // magnitude keeps the rung independent of which axis the field was spelled on.
  return { rms, sine, coma: Math.hypot(coefficient(fit, 7), coefficient(fit, 8)) };
}

const lister = (NA: number, over: Partial<Parameters<typeof listerObjective>[0]> = {}) =>
  listerObjective({ magnification: 40, numericalAperture: NA, ...over });
const single = (NA: number) => microscopeObjective({ magnification: 40, numericalAperture: NA });

/** Highest x in [lo, hi] for which `ok` holds, by bisection. */
const highest = (lo: number, hi: number, ok: (x: number) => boolean): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 24; i++) {
    const m = 0.5 * (a + b);
    if (ok(m)) a = m;
    else b = m;
  }
  return a;
};

describe("§ 6d.1 — the aplanatic points of a single sphere (what aplanatic MEANS)", () => {
  // EXTERNAL, and exact to all orders: a spherical surface between n₁ and n₂ is
  // perfectly stigmatic for one conjugate pair, measured from the VERTEX,
  //     s = R(n₁+n₂)/n₁,   s′ = R(n₁+n₂)/n₂,   m = n₁²/n₂²
  // (Born & Wolf; Smith, Modern Optical Engineering — the Weierstrass points).
  //
  // This pins the aplanatic HYPERHEMISPHERE, the follow-on § 6d.5's ceiling
  // argues for. It pins nothing about the Lister; it is here so that "aplanatic"
  // has an external definition before a design claims the word.
  const R = 3;
  const ap = aplanaticSphere({
    radiusMm: R,
    objectMedium: "N-BK7",
    imageMedium: "AIR",
    semiApertureMm: 2.95,
  });
  const n1 = getMedium("N-BK7").n(LAMBDA);
  /** Apertures that clear this surface's rim; 0.8 does not, and that is geometry. */
  const APERTURES = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

  it("the conjugates come out of the TRACE where the closed form puts them", () => {
    // Not a restatement of the module's own arithmetic: the image distance and
    // the magnification are read off a paraxial trace of the built surface.
    const bare = ap.prescription;
    const marginal = paraxialTrace(bare, LAMBDA, { y: ap.objectDistanceMm, u: 1 });
    const traced = -marginal.y / marginal.u;
    // Negative: the image is VIRTUAL, in front of the vertex with the object.
    expect(traced).toBeCloseTo(-ap.virtualImageDistanceMm, 8);
    expect(ap.virtualImageDistanceMm).toBeCloseTo(R * (n1 + 1), 12);
    expect(ap.objectDistanceMm).toBeCloseTo((R * (n1 + 1)) / n1, 12);

    // A ray through the VERTEX (y = 0 at surface 0) with slope −h/s is at height
    // +h back in the object plane, so the image height it reaches divided by h is
    // the magnification WITH ITS SIGN. Seeding +h/s instead would measure −m and
    // hide a genuine sign error in `ap.magnification`, which the hyperhemisphere
    // unit will consume.
    const h = 1e-4;
    const chief = paraxialTrace(bare, LAMBDA, { y: 0, u: -h / ap.objectDistanceMm });
    const m = (chief.y + chief.u * traced) / h;
    // Erect and magnified by n₁²: a virtual image, the same way up as the object.
    expect(m).toBeCloseTo(n1 * n1, 6);
    expect(m).toBeGreaterThan(0);
    expect(ap.magnification).toBeCloseTo(m, 6);
  });

  /** Where the emergent ray's LINE crosses the axis — negative, being virtual. */
  const axialCrossing = (sinU: number, objectMm = ap.objectDistanceMm): number => {
    const dir = vec3(sinU, 0, Math.sqrt(1 - sinU * sinU));
    const res = traceRay(ap.prescription, makeRay(vec3(0, 0, -objectMm), dir, LAMBDA));
    if (res.status !== "ok" || !res.ray) return Number.NaN;
    const r = res.ray;
    return r.origin.z - (r.origin.x / r.dir.x) * r.dir.z;
  };

  it("is EXACTLY stigmatic — the crossing does not move across the aperture", () => {
    // Not "to third order". The ray at sin u = 0.9 inside the glass extends back
    // to the same point as one at 1e-6, to nine digits. Every other spherical-
    // aberration pin in this ladder is a small-angle form; this one is not.
    const paraxial = axialCrossing(1e-6);
    expect(paraxial).toBeCloseTo(-ap.virtualImageDistanceMm, 8);
    for (const sinU of APERTURES) {
      expect(axialCrossing(sinU)).toBeCloseTo(-ap.virtualImageDistanceMm, 8);
    }
  });

  it("NEGATIVE CONTROL: a TENTH of a percent off it and the stigmatism is gone", () => {
    const spreadAt = (offset: number): number =>
      Math.abs(
        axialCrossing(0.9, ap.objectDistanceMm * offset) -
          axialCrossing(1e-6, ap.objectDistanceMm * offset),
      );
    // At the aplanatic point the marginal and paraxial crossings agree to
    // MACHINE PRECISION over a 4 mm chain — this is an exact result, and the only
    // thing limiting it is f64.
    expect(spreadAt(1)).toBeLessThan(1e-13);
    // A tenth of a percent away, twelve orders of magnitude of aberration appear;
    // a percent away, thirteen. The pair is a point, not a region.
    expect(spreadAt(1.001)).toBeGreaterThan(1e-2);
    expect(spreadAt(1.01)).toBeGreaterThan(1e-1);
    expect(spreadAt(1.01) / spreadAt(1.001)).toBeGreaterThan(10);
  });

  it("satisfies the sine condition exactly — aplanatic, not merely stigmatic", () => {
    // Stigmatism alone is not aplanatism. The Lagrange invariant with m = n₁²/n₂²
    // demands sin u′/sin u = n₂/n₁, a CONSTANT, and it is the constancy that says
    // the surface is coma-free. Read off the traced rays.
    const ratios = APERTURES.map((sinU) => {
      const dir = vec3(sinU, 0, Math.sqrt(1 - sinU * sinU));
      const res = traceRay(
        ap.prescription,
        makeRay(vec3(0, 0, -ap.objectDistanceMm), dir, LAMBDA),
      );
      const d = res.ray!.dir;
      return Math.hypot(d.x, d.y) / Math.hypot(d.x, d.y, d.z) / sinU;
    });
    for (const r of ratios) {
      expect(r).toBeCloseTo(1 / n1, 10);
      expect(r).toBeCloseTo(ap.sineRatio, 12);
    }
  });
});

describe("§ 6d.2 — the joint solve: an aplanat a single doublet cannot be", () => {
  const o = lister(0.2);

  it("ΣS_I and ΣS_II are BOTH zero, re-measured on the built chain", () => {
    // A readout, not the solver's own claim: the constructor re-runs the sums on
    // the final prescription at the final conjugate, and would have thrown.
    const sums = seidelSums(o.prescription, LAMBDA, {
      marginalHeightMm: o.stopRadiusMm,
      objectDistanceMm: o.objectDistanceMm,
      fieldAngleRad: 1,
    });
    expect(Math.abs(sums.s1)).toBeLessThan(1e-9 * o.cancellation);
    expect(Math.abs(sums.s2)).toBeLessThan(1e-9 * o.cancellation);
    // …and zero against a cancellation scale that is NOT itself zero, or the
    // rung would be noise against noise.
    expect(o.cancellation).toBeGreaterThan(1e-3);
  });

  it("NEGATIVE CONTROL: § 6a's single doublet nulls S_I and leaves S_II standing", () => {
    const s = single(0.2);
    const sums = seidelSums(s.prescription, LAMBDA, {
      marginalHeightMm: s.stopRadiusMm,
      objectDistanceMm: s.objectDistanceMm,
      fieldAngleRad: 1,
    });
    const cancellation = sums.surfaces.reduce((t, x) => t + Math.abs(x.s1), 0);
    // Coma is not small — it is comparable to the spherical terms that cancelled.
    expect(Math.abs(sums.s2)).toBeGreaterThan(1e-3 * cancellation);
  });

  it("the objective delivers the NA on its label, from the traced launch angle", () => {
    for (const NA of [0.1, 0.15, 0.2]) {
      const sys = scopeOf(lister(NA));
      expect(objectNumericalAperture(sys, LAMBDA)).toBeCloseTo(NA, 6);
    }
  });

  it("the traced EFL is the one the magnification implies, to a part in 10⁹", () => {
    // Solved, not asserted: the thin-lens power split is only a seed and the
    // fixed point drives the TRACED efl onto f_tube/M.
    expect(o.paraxialFocalLengthMm).toBeCloseTo(TUBE_MM / 40, 8);
  });

  it("both joint roots are reported, and the one built is the least-cancelling", () => {
    expect(o.roots.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < o.roots.length; i++) {
      expect(o.roots[i]!.cancellation).toBeGreaterThanOrEqual(o.roots[i - 1]!.cancellation);
    }
    // The built bendings came FROM roots[0] but are not it: the geometry moved
    // under the solve and they were re-polished on the converged one. Near, and
    // deliberately not identical — a rung that demanded equality would be
    // asserting that the fixed point did nothing.
    expect(o.frontBending).toBeCloseTo(o.roots[0]!.frontBending, 1);
    expect(o.cancellation / o.roots[0]!.cancellation).toBeGreaterThan(0.9);
    expect(o.cancellation / o.roots[0]!.cancellation).toBeLessThan(1.1);
  });
});

describe("§ 6d.3 — the LAW: solve on Seidel, confirm on the traced wavefront", () => {
  const NAs = [0.08, 0.1, 0.125, 0.15, 0.175, 0.2] as const;
  const rows = NAs.map((NA) => ({
    NA,
    single: measure(scopeOf(single(NA))),
    lister: measure(scopeOf(lister(NA))),
  }));
  /** Log-log slope of a column against NA, between adjacent rows. */
  const slopes = (pick: (r: (typeof rows)[number]) => number): number[] =>
    rows.slice(1).map((r, i) =>
      Math.log(pick(r) / pick(rows[i]!)) / Math.log(r.NA / rows[i]!.NA),
    );

  it("the single doublet's traced coma runs as NA³ — third-order coma, present", () => {
    for (const s of slopes((r) => r.single.coma)) {
      expect(s).toBeGreaterThan(2.8);
      expect(s).toBeLessThan(3.6);
    }
  });

  it("the Lister's runs as NA^5.2 — the third-order term is GONE, not just small", () => {
    // THE rung of this step. The design nulls ΣS_II from third-order theory
    // alone; the traced wavefront answers with a residual of a different ORDER.
    // Fitting a smaller number is easy, changing the power law is not.
    for (const s of slopes((r) => r.lister.coma)) {
      expect(s).toBeGreaterThan(5.0);
      expect(s).toBeLessThan(5.4);
    }
  });

  it("both forms' spherical residual runs as ~NA⁶ — fifth order, as a third-order solve leaves", () => {
    for (const s of slopes((r) => r.lister.rms)) {
      expect(s).toBeGreaterThan(5.5);
      expect(s).toBeLessThan(6.1);
    }
    // The single doublet starts there and LEAVES it, drifting past 6.6 by NA 0.2
    // as higher orders arrive — which is why its σ ratio against the Lister grows
    // rather than staying a constant factor.
    const s = slopes((r) => r.single.rms);
    expect(s[0]!).toBeGreaterThan(6.0);
    expect(s[s.length - 1]!).toBeGreaterThan(6.5);
  });

  it("at matched NA the Lister is 16–25× better on axis and 16–120× on coma", () => {
    for (const r of rows) {
      expect(r.single.rms / r.lister.rms).toBeGreaterThan(15);
      expect(r.single.coma / r.lister.coma).toBeGreaterThan(15);
      expect(Math.abs(r.single.sine) / Math.abs(r.lister.sine)).toBeGreaterThan(20);
    }
  });

  it("the sine-condition residual falls from 0.92% to 0.038% at NA 0.08", () => {
    // § 6a pinned the single doublet's offence against the sine condition as
    // deliberately non-zero ("corrected but never aplanatic"). This is the same
    // readout on a design that IS aplanatic to third order — and it is a real-ray
    // measurement, so what survives is the fifth-order offence.
    expect(rows[0]!.single.sine).toBeCloseTo(0.009179, 5);
    expect(rows[0]!.lister.sine).toBeCloseTo(0.000385, 5);
  });
});

describe("§ 6d.4 — reach: Maréchal, bisected", () => {
  const marechalOf = (build: (NA: number) => OpticalSystem) => (NA: number) => {
    try {
      return measure(build(NA)).rms <= MARECHAL;
    } catch {
      return false;
    }
  };

  it("the single cemented doublet is diffraction-limited to NA 0.180", () => {
    // σ runs as NA⁶, so this is bisected, not interpolated between samples.
    expect(highest(0.1, 0.3, marechalOf((NA) => scopeOf(single(NA))))).toBeCloseTo(0.1797, 3);
  });

  it("the Lister to NA 0.273 — 1.52× the NA, and 1.52× Abbe's resolution", () => {
    expect(highest(0.1, 0.45, marechalOf((NA) => scopeOf(lister(NA))))).toBeCloseTo(0.2733, 3);
  });

  it("and its limit is the SOLVE, not aberration: at its ceiling it is still λ/27", () => {
    // The interesting half. The default Lister stops existing before it stops
    // being diffraction-limited — the two ceilings above are the same number
    // because the binding constraint is that no makeable joint root survives,
    // not that the wavefront has degraded.
    const ceiling = highest(0.1, 0.45, (NA) => {
      try {
        lister(NA);
        return true;
      } catch {
        return false;
      }
    });
    expect(ceiling).toBeCloseTo(0.2733, 3);
    const sigma = measure(scopeOf(lister(ceiling * 0.999))).rms;
    expect(sigma).toBeLessThan(MARECHAL);
    expect(sigma).toBeCloseTo(0.03691, 4);
  });

  it("NEGATIVE CONTROL: the single doublet's own ceiling is a different fact", () => {
    // `achromaticObjective` refuses NA ≥ 0.261 because the root count stops
    // being the classical two — CONSTRUCTOR STRICTNESS about the structure, not
    // "no SA-null bending exists". It must not be quoted as the physics wall;
    // the physics wall is the Maréchal 0.180 above, and the two differ by 45%.
    const exists = highest(0.1, 0.4, (NA) => {
      try {
        single(NA);
        return true;
      } catch {
        return false;
      }
    });
    expect(exists).toBeCloseTo(0.2608, 3);
    expect(exists).toBeGreaterThan(0.1797);
  });
});

describe("§ 6d.5 — the split is STATED, and the ceiling is a fact about the FORM", () => {
  it("the joint solve holds across the whole split range, not at one lucky value", () => {
    for (const powerSplit of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      const o = lister(0.2, { powerSplit });
      expect(Math.abs(o.seidelS1)).toBeLessThan(1e-9 * o.cancellation);
      expect(Math.abs(o.seidelS2)).toBeLessThan(1e-9 * o.cancellation);
      expect(o.powerSplit).toBe(powerSplit);
    }
  });

  it("…and across the separation, up to the combination limit", () => {
    for (const separationFactor of [0.3, 0.5, 0.6, 0.7, 0.9]) {
      const o = lister(0.2, { separationFactor });
      expect(Math.abs(o.seidelS2)).toBeLessThan(1e-9 * o.cancellation);
    }
  });

  it("two positive groups cannot combine past d·k(1−k) = f/4, and it says so", () => {
    // A closed form about the split and the separation alone, checked before the
    // fixed point can wander: φ = P − d·k(1−k)·P² peaks at 1/(4·d·k(1−k)).
    expect(() => lister(0.2, { powerSplit: 0.6, separationFactor: 1.05 })).toThrow(
      /separationFactor·k\(1−k\) < 1\/4/,
    );
    // 0.25/(0.6·0.4) = 1.0417, so 1.04 is inside the limit and 1.05 is not.
    expect(() => lister(0.2, { powerSplit: 0.5, separationFactor: 1.01 })).toThrow(/combined to f/);
    // Inside the limit the check is silent — whatever else may then fail is a
    // different failure, and the point of the closed form is to tell them apart.
    expect(() => lister(0.2, { powerSplit: 0.6, separationFactor: 1.04 })).not.toThrow(
      /combined to f/,
    );
  });

  it("the ceiling is a property of the FORM: two glass pairs wall out together", () => {
    // Neither pair reaches NA 0.4. This is the third piece of evidence for the
    // aplanatic front element, after § 6a's F = 1/(2·NA) and § 6b's 4× at f/4.1.
    const grid: [number, number][] = [];
    for (const k of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) for (const sep of [0.3, 0.5, 0.7, 0.9]) grid.push([k, sep]);
    const ceilingFor = (crownMedium: string) =>
      highest(0.2, 0.6, (NA) =>
        grid.some(([powerSplit, separationFactor]) => {
          try {
            lister(NA, { powerSplit, separationFactor, crownMedium });
            return true;
          } catch {
            return false;
          }
        }),
      );
    expect(ceilingFor("N-BK7")).toBeCloseTo(0.3433, 2);
    expect(ceilingFor("FUSED-SILICA")).toBeCloseTo(0.3833, 2);
    expect(ceilingFor("N-BK7")).toBeLessThan(0.4);
    expect(ceilingFor("FUSED-SILICA")).toBeLessThan(0.4);
  });

  it("orientation is a choice with a measured price, not an inference", () => {
    // Flint-first at both is the default — § 6a's turn-around argument applied to
    // each group — and it reaches furthest. Crown-first at both does not solve at
    // the default split at all, which is why the pair is spelled rather than
    // guessed.
    expect(() =>
      lister(0.2, { frontOrientation: "crownFirst", rearOrientation: "crownFirst" }),
    ).toThrow(/no joint/);
    const ff = lister(0.2);
    const fc = lister(0.2, { rearOrientation: "crownFirst" });
    // flint/crown is BETTER on axis here and still not the default, because it
    // reaches NA 0.245 against flint/flint's 0.273. The trade is recorded.
    expect(measure(scopeOf(fc)).rms).toBeLessThan(measure(scopeOf(ff)).rms);
  });
});

describe("§ 6d.6 — the design is scale-free in NA, and composes as a module", () => {
  it("the same NA at 10×, 20× and 40× is ONE design, scaled", () => {
    const os = [10, 20, 40].map((magnification) =>
      listerObjective({ magnification, numericalAperture: 0.2 }),
    );
    for (const o of os) {
      // Curvatures scale as 1/f and distances as f, so these dimensionless
      // combinations are the design itself — identical to nine digits.
      expect(o.frontBending * o.focalLengthMm).toBeCloseTo(
        os[0]!.frontBending * os[0]!.focalLengthMm,
        9,
      );
      expect(o.rearBending * o.focalLengthMm).toBeCloseTo(
        os[0]!.rearBending * os[0]!.focalLengthMm,
        9,
      );
      expect(o.objectDistanceMm / o.focalLengthMm).toBeCloseTo(
        os[0]!.objectDistanceMm / os[0]!.focalLengthMm,
        9,
      );
    }
    // …and the wavefront error in WAVES is therefore ∝ f, § 6a's own rung: the
    // 40× is exactly twice as good as the 20× and four times the 10×.
    const sigmas = os.map((o) => measure(scopeOf(o)).rms);
    expect(sigmas[0]! / sigmas[1]!).toBeCloseTo(2, 3);
    expect(sigmas[1]! / sigmas[2]!).toBeCloseTo(2, 3);
  });

  it("it satisfies InfinityCorrectedObjective and composes with the § 6a tube lens", () => {
    // The architecture's claim that an objective is a MODULE, exercised: nothing
    // in `infinityCorrectedMicroscope` knows which preset it was handed.
    const scope = infinityCorrectedMicroscope({
      objective: lister(0.2),
      tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
    });
    expect(scope.nominalMagnification).toBeCloseTo(40, 9);
    expect(scope.objectiveSurfaceCount).toBe(6);
    // Exactly one aperture in the composed chain — § 6a's one-flag rule, which
    // two spliced doublets would otherwise break four ways.
    expect(scope.prescription.surfaces.filter((s) => s.isStop).length).toBe(1);
    expect(scope.prescription.surfaces[0]!.isStop).toBe(true);
  });

  it("the magnification is unchanged by the infinity space, as it must be", () => {
    const o = lister(0.2);
    for (const infinitySpaceMm of [20, 100, 250]) {
      const scope = infinityCorrectedMicroscope({
        objective: o,
        tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
        infinitySpaceMm,
      });
      expect(scope.nominalMagnification).toBeCloseTo(40, 9);
    }
  });
});
