import { describe, it, expect } from "vitest";
import {
  DEFAULT_TUBE_FOCAL_LENGTH_MM,
  MECHANICAL_TUBE_LENGTH_MM,
  OPTICAL_TUBE_LENGTH_MM,
  TUBE_FOCAL_LENGTH_MM,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { Prescription } from "../src/trace/prescription";
import { achromaticObjective } from "../src/designs/achromat";
import { reversePrescription } from "../src/trace/prescription";
import { paraxialTrace, systemProperties } from "../src/trace/paraxial";
import { collimatingObjectDistance } from "../src/trace/compose";
import { seidelSums } from "../src/analysis/seidel";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import {
  abbeResolutionMm,
  imageNumericalAperture,
  lateralMagnification,
  objectNumericalAperture,
  rayleighResolutionMm,
  sineConditionResidual,
} from "../src/pupil/microscope";
import { psf } from "../src/wave/psf";
import { mtf } from "../src/wave/mtf";
import { traceRay } from "../src/trace/sequential";
import { makeRay } from "../src/trace/ray";
import { normalize, vec3 } from "../src/math/vec3";
import { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the infinity-corrected microscope — docs/VALIDATION.md § 6a.
 *
 * The unit that opens the microscope branch. Three things are under test and
 * they are deliberately independent of one another:
 *
 *  1. **Orientation.** A doublet solved for one conjugate pair is only correct
 *     for the reverse pair turned around. Nothing first-order can see the
 *     difference — identical EFL — so the rung is third-order and the wrong way
 *     round is 9 waves.
 *  2. **The object-distance solve**, checked against the front focal distance
 *     measured by a completely different code path (the reversed chain's BFD).
 *  3. **The architecture's numbers**: M = f_tube/f_obj on the traced chief ray,
 *     its independence of the infinity space, the sine condition on the traced
 *     marginal ray, and Abbe's λ/(2·NA) against the FFT grid's own MTF cutoff.
 */

const LAMBDA = LINE_D;

/** The pinned member: a 4×/0.10 achromat on the 200 mm convention. */
const build4x = () =>
  microscopeObjective({ magnification: 4, numericalAperture: 0.1 });

describe("§ 6a.1 — the objective is a telescope doublet TURNED AROUND", () => {
  it("nulls third-order spherical only in the mirrored orientation", () => {
    const doublet = achromaticObjective({ apertureMm: 10, focalRatio: 5 });
    const h = 5;

    // Collimated in on the crown: the conjugate pair § 5j solved for.
    const solved = seidelSums(doublet.prescription, LAMBDA, { marginalHeightMm: h });
    // Collimated in on the flint: the REVERSE of putting the crown toward the
    // specimen, which is what an un-mirrored objective would be.
    const reversed = reversePrescription(doublet.prescription, doublet.backFocusMm);
    const wrongWay = seidelSums(reversed, LAMBDA, { marginalHeightMm: h });

    const waves = (w040: number) => Math.abs(w040) / (LAMBDA * 1e-6);

    // Solved to the solver's precision — this is § 5j's own guarantee, restated
    // here because it is the baseline the penalty is measured against.
    expect(waves(solved.w040)).toBeLessThan(1e-9);
    // The published penalty for using a doublet at the wrong conjugates. Not a
    // marginal degradation: nine waves is a system that does not image.
    expect(waves(wrongWay.w040)).toBeGreaterThan(8);
  });

  it("cannot be told apart first-order: both orientations have the same EFL", () => {
    const doublet = achromaticObjective({ apertureMm: 10, focalRatio: 5 });
    const reversed = reversePrescription(doublet.prescription, doublet.backFocusMm);
    const forward = systemProperties(doublet.prescription, LAMBDA).efl;
    const backward = systemProperties(reversed, LAMBDA).efl;
    // A thick lens's focal length is orientation-independent — a textbook
    // identity, and here the negative control that makes rung 6a.1 non-trivial.
    expect(backward).toBeCloseTo(forward, 10);
  });

  it("declares exactly one aperture stop, on surface 0", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });

    // Both doublets declare their own surface 0 as a stop, and the objective's
    // travelled to its last surface when it was mirrored. Un-cleared, the
    // composed chain carries three flagged stops: `stopIndex` takes the first
    // and looks fine, while `seidelSums` throws unless the flag is on surface 0.
    const flags = scope.prescription.surfaces.map((s) => s.isStop === true);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags[0]).toBe(true);

    // …and the objective standing alone is self-consistent too, not merely
    // patched up at composition time.
    const alone = obj.prescription.surfaces.map((s) => s.isStop === true);
    expect(alone.filter(Boolean)).toHaveLength(1);
    expect(alone[0]).toBe(true);
  });

  it("builds the objective mirrored: the specimen faces the flint", () => {
    const obj = build4x();
    const [c1, c2, c3] = obj.doublet.curvatures;
    const s = obj.prescription.surfaces;
    expect(s.map((x) => x.curvature)).toEqual([-c3, -c2, -c1]);
    expect(s[0]!.medium).toBe(obj.doublet.flintMedium);
    expect(s[1]!.medium).toBe(obj.doublet.crownMedium);
  });
});

describe("§ 6a.2 — the object-distance solve", () => {
  it("lands on the front focal distance, measured by the reversed chain's BFD", () => {
    const obj = build4x();
    const solved = collimatingObjectDistance(obj.prescription, LAMBDA);
    // FFD of a system == BFD of its reversal. Different function, different
    // ray (collimated in, not diverging from the object), same answer.
    const viaReversal = systemProperties(reversePrescription(obj.prescription, 0), LAMBDA).bfd;
    expect(solved).toBeCloseTo(viaReversal, 9);
    expect(solved).toBeGreaterThan(0);
  });

  it("is NOT the same as the back focal distance — the lens is asymmetric", () => {
    const obj = build4x();
    const ffd = collimatingObjectDistance(obj.prescription, LAMBDA);
    const bfd = systemProperties(obj.prescription, LAMBDA).bfd;
    // The negative control for the rung above: if the two routes were secretly
    // reading the same number, this would be an equality rather than a 1 mm gap.
    expect(Math.abs(ffd - bfd)).toBeGreaterThan(0.5);
  });

  it("actually collimates: a ray from the solved plane exits parallel", () => {
    const obj = build4x();
    const s = obj.objectDistanceMm;
    const out = paraxialTrace(obj.prescription, LAMBDA, { y: s, u: 1 });
    // The whole definition, checked rather than assumed.
    expect(Math.abs(out.u)).toBeLessThan(1e-12);
    expect(Math.abs(out.y)).toBeGreaterThan(0.1);
  });
});

describe("§ 6a.3 — the architecture: M = f_tube / f_objective", () => {
  it("gives the traced chief ray the magnification the labels claim", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    expect(scope.nominalMagnification).toBeCloseTo(4, 12);

    const m = lateralMagnification(scope.system, 0.05, LAMBDA);
    // Inverted real image, and 4× — measured on a real ray through the whole
    // chain, not read off the design. The 0.03% excess is the honest thick-lens
    // remainder: the doublets' power split is the thin-lens closed form, so
    // Gullstrand's separation term is left in rather than absorbed (§ 5j).
    expect(m).toBeLessThan(0);
    expect(Math.abs(m)).toBeCloseTo(4, 2);
    expect(Math.abs(m) / 4 - 1).toBeLessThan(1e-3);
  });

  it("is very nearly distortion-free over the field", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    // Distortion is exactly what a paraxial trace drops (§ 5n), so it can only
    // be seen by comparing REAL chief rays at different heights. A 40× spread
    // of object height moves the magnification by 2e-5 relative.
    const near = lateralMagnification(scope.system, 0.005, LAMBDA);
    const far = lateralMagnification(scope.system, 0.2, LAMBDA);
    expect(Math.abs(far / near - 1)).toBeLessThan(1e-4);
    // Non-zero, though — the readout can see distortion when there is any.
    expect(Math.abs(far / near - 1)).toBeGreaterThan(0);
  });

  it("delivers the SAME magnification whatever the infinity space is", () => {
    const obj = build4x();
    const tube = tubeLens();
    const ms = [20, 100, 250].map((g) =>
      lateralMagnification(
        infinityCorrectedMicroscope({ objective: obj, tubeLens: tube, infinitySpaceMm: g }).system,
        0.05,
        LAMBDA,
      ),
    );
    // The reason the infinity space exists: filters, prisms and beamsplitters go
    // in there without changing the magnification. Exact paraxially; this is the
    // real-ray version, so it is a tolerance rather than an identity.
    expect(ms[1]!).toBeCloseTo(ms[0]!, 2);
    expect(ms[2]!).toBeCloseTo(ms[0]!, 2);
  });

  it("re-labels the same objective when the tube convention changes", () => {
    // A 4× objective is 4× only against the tube lens it was quoted for. On a
    // Zeiss 165 mm tube the same glass delivers 165/50 = 3.3×.
    const obj = build4x();
    expect(obj.focalLengthMm).toBeCloseTo(DEFAULT_TUBE_FOCAL_LENGTH_MM / 4, 12);
    const zeiss = infinityCorrectedMicroscope({
      objective: obj,
      tubeLens: tubeLens({ focalLengthMm: TUBE_FOCAL_LENGTH_MM.zeiss }),
    });
    expect(zeiss.nominalMagnification).toBeCloseTo(TUBE_FOCAL_LENGTH_MM.zeiss / 50, 12);
    const m = lateralMagnification(zeiss.system, 0.05, LAMBDA);
    expect(Math.abs(m)).toBeCloseTo(3.3, 1);
  });
});

describe("§ 6a.4 — numerical aperture and the sine condition", () => {
  it("delivers the specified NA at the specimen, from the traced marginal ray", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    const na = objectNumericalAperture(scope.system, LAMBDA);
    // Exact, because the stop was sized s·tan u for this cone. The rung that
    // matters is the negative control below: sizing it f·NA instead — the
    // sine-condition HEIGHT, which is not a stop radius — ships 0.102.
    expect(na).toBeCloseTo(0.1, 6);
  });

  it("would be 2% fast if the stop were sized by the sine-condition height", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    const wrong: OpticalSystem = {
      ...scope.system,
      aperture: { kind: "stopRadius", value: obj.pupilRadiusMm },
    };
    // f·NA is a height on the equivalent refracting sphere about the principal
    // plane; the stop sits on the vertex. Conflating them is a real 2% error,
    // recorded here because this module made it once.
    expect(objectNumericalAperture(wrong, LAMBDA)).toBeCloseTo(0.1021, 4);
  });

  it("obeys the sine condition on the emergent ray — but not perfectly", () => {
    const obj = build4x();
    const NA = 0.1;
    const u = Math.asin(NA);
    const launched = makeRay(
      vec3(0, 0, -obj.objectDistanceMm),
      normalize(vec3(Math.sin(u), 0, Math.cos(u))),
      LAMBDA,
    );
    const traced = traceRay(obj.prescription, launched);
    expect(traced.status).toBe("ok");
    const out = traced.ray!;

    // (a) The object-distance solve holds for a REAL ray, not just a paraxial
    //     one: the marginal ray at full NA leaves the objective collimated.
    const tilt = Math.hypot(out.dir.x, out.dir.y) / Math.hypot(out.dir.x, out.dir.y, out.dir.z);
    expect(tilt).toBeLessThan(5e-4);

    // (b) Abbe: an aplanat maps sin u to emergent height f·sin u. Nothing in the
    //     design placed the ray there — the bending was solved for S_I = 0.
    const residual = out.origin.x / (obj.paraxialFocalLengthMm * NA) - 1;
    expect(Math.abs(residual)).toBeLessThan(0.01);

    // (c) …and it is NOT zero, which is the point. § 5j found the two SA-null
    //     bendings STRADDLE the coma-free one, so a cemented doublet is
    //     corrected but never aplanatic; an offence against the sine condition
    //     is precisely coma. A residual of exactly zero here would mean the
    //     rung was measuring its own construction.
    expect(Math.abs(residual)).toBeGreaterThan(1e-3);
    expect(Math.abs(obj.doublet.comaPerRadian)).toBeGreaterThan(0);
  });

  it("carries the same residual into the composed chain's NA = |M|·NA′", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    const residual = sineConditionResidual(scope.system, 0.05, LAMBDA);
    // The finite-finite form of the same condition, and the same order of
    // residual — sub-1%, non-zero, and traceable to the objective's coma.
    expect(Math.abs(residual)).toBeLessThan(0.01);
    expect(Math.abs(residual)).toBeGreaterThan(1e-3);
  });

  it("the objective's focal ratio is set by NA alone, not by magnification", () => {
    // F = 1/(2·NA): a 4×/0.10 and a 20×/0.10 are the same f/5 doublet at
    // different scales. Non-obvious, and it is what makes high NA hard.
    for (const M of [4, 10, 20]) {
      const o = microscopeObjective({ magnification: M, numericalAperture: 0.1 });
      expect(o.focalRatio).toBeCloseTo(5, 12);
      expect(o.pupilRadiusMm).toBeCloseTo(o.focalLengthMm * 0.1, 12);
    }
  });
});

describe("§ 6a.5 — Abbe resolution against the MTF cutoff", () => {
  it("λ/(2·NA) is the finest object period the pupil transmits", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });

    const naObject = objectNumericalAperture(scope.system, LAMBDA);
    const naImage = imageNumericalAperture(scope.system, LAMBDA);
    const m = Math.abs(lateralMagnification(scope.system, 0.05, LAMBDA));

    const dObject = abbeResolutionMm(LAMBDA, naObject);
    // Referred to the image by the magnification, the Abbe period becomes an
    // image-plane period, whose reciprocal must be the MTF's cutoff.
    const cutoffFromRays = 1 / (dObject * m);

    // The independent route: the FFT grid's own cutoff, which comes from the
    // pupil sampling and the OPD map's reference radius — no marginal ray, no
    // magnification, no NA anywhere in its derivation.
    const grid = mtf(psf(scope.system, 0, LAMBDA, { pupilSamples: 64, padFactor: 4 }));

    expect(grid.cutoffCyclesPerMm).toBeGreaterThan(0);
    // 0.5% between two routes that share nothing: one is a marginal-ray sine and
    // a chief-ray height, the other is the pupil sampling and the OPD map's
    // reference radius.
    expect(Math.abs(cutoffFromRays / grid.cutoffCyclesPerMm - 1)).toBeLessThan(0.01);
    // And the same number the image-space marginal ray gives directly, 2·NA′/λ —
    // 1%, the extra slack being the sine-condition residual of § 6a.4 riding on
    // NA′.
    expect(Math.abs((2 * naImage) / (LAMBDA * 1e-6) / grid.cutoffCyclesPerMm - 1)).toBeLessThan(0.015);
  });

  it("reports Rayleigh and Abbe as the different criteria they are", () => {
    const d = abbeResolutionMm(LAMBDA, 0.1);
    const r = rayleighResolutionMm(LAMBDA, 0.1);
    expect(d).toBeCloseTo((LAMBDA * 1e-6) / 0.2, 15);
    // 0.61·λ/NA over λ/(2·NA) = 1.22 exactly — the Airy factor, not a coincidence.
    expect(r / d).toBeCloseTo(1.22, 12);
  });
});

describe("§ 6a.6 — the composed microscope images", () => {
  it("is diffraction-limited on axis", () => {
    const obj = build4x();
    const scope = infinityCorrectedMicroscope({ objective: obj, tubeLens: tubeLens() });
    const map = opdMap(scope.system, 0, LAMBDA, pupilGrid(21));
    // Maréchal: σ ≤ λ/14 is Strehl ≥ 0.8. Both doublets run at the conjugates
    // they were solved for, so the whole chain clears it.
    expect(map.rmsWaves).toBeLessThan(1 / 14);
  });
});

/**
 * Rungs for the classic finite-conjugate (DIN/JIS) microscope — § 6b.
 *
 * § 6a listed this as "needs no new machinery"; the first measurement falsified
 * that, and these rungs are built around the falsification. A DIN objective is
 * not an infinity objective placed differently: the position factor moves the
 * SA-null bending, so the lens is re-solved for the conjugates it works at.
 */

/** The pinned member: a 4×/0.10 DIN achromat on a 150 mm optical tube. */
const buildDin4x = () => finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });

describe("§ 6b.1 — the DIN objective is a RE-SOLVED lens, not a placed one", () => {
  it("costs 2.0 waves of S_I to reuse the infinity-solved bending", () => {
    const din = buildDin4x();
    // The same glasses, the same focal length, the same aperture — only the
    // conjugate the bending was solved for differs, which is the § 6a recipe.
    const D = 2 * din.stopRadiusMm * 1.12;
    const infinitySolved = achromaticObjective({ apertureMm: D, focalRatio: din.focalLengthMm / D });
    const mirrored = reversePrescription(infinitySolved.prescription, 0);
    const s1 = seidelSums(mirrored, LAMBDA, {
      marginalHeightMm: din.stopRadiusMm,
      objectDistanceMm: din.objectDistanceMm,
    }).s1;
    // W₀₄₀ = S_I/8, in waves at the rim. Two waves is not a refinement.
    expect(Math.abs(s1 / 8) / (LAMBDA * 1e-6)).toBeGreaterThan(1.9);
    // …while the re-solved lens nulls it to the solver's own precision. The
    // ratio, not the absolute, is the statement.
    expect(Math.abs(din.seidelS1AtWorkingConjugates)).toBeLessThan(1e-12 * Math.abs(s1));
  });

  it("lands on a visibly different bending — 14% of the curvature", () => {
    const din = buildDin4x();
    const D = 2 * din.stopRadiusMm * 1.12;
    const infinitySolved = achromaticObjective({ apertureMm: D, focalRatio: din.focalLengthMm / D });
    const ratio = din.doublet.curvatures[0] / infinitySolved.curvatures[0];
    expect(ratio).toBeLessThan(0.9);
    expect(ratio).toBeGreaterThan(0.8);
  });

  it("moves the traced focal length too — the split fixes DIFFERENCES, not shapes", () => {
    // Worth pinning because it is counter-intuitive: bending is supposed to leave
    // every first-order property alone, and for a THIN lens it does. The
    // achromatic split fixes c₁−c₂ and c₂−c₃, so a different bending is a
    // different pair of real shapes with a different Gullstrand separation term.
    const din = buildDin4x();
    const D = 2 * din.stopRadiusMm * 1.12;
    const infinitySolved = achromaticObjective({ apertureMm: D, focalRatio: din.focalLengthMm / D });
    expect(infinitySolved.paraxialFocalLengthMm / infinitySolved.focalLengthMm - 1).toBeLessThan(0);
    expect(din.paraxialFocalLengthMm / din.focalLengthMm - 1).toBeGreaterThan(0);
    expect(din.paraxialFocalLengthMm / infinitySolved.paraxialFocalLengthMm).toBeCloseTo(1.0056, 4);
  });

  it("solves it by RECIPROCITY: crown-first at b is mirrored at a, to 10 digits", () => {
    // The design route. `achromaticObjective` builds crown-first, but the
    // specimen faces the flint, so the solve runs at the conjugate distance b and
    // the result is reversed. That is only legitimate if third-order stigmatism
    // is reciprocal, so the direct solve is run here and the roots compared.
    const din = buildDin4x();
    const d = din.doublet;
    const dc1 = d.crownPower / (d.crownIndex - 1);
    const dc2 = d.flintPower / (d.flintIndex - 1);
    const semi = d.prescription.surfaces.map((s) => s.semiAperture);
    /** The same doublet family, bent, mirrored, as the specimen sees it. */
    const mirroredAt = (c1: number): Prescription => {
      const c2 = c1 - dc1;
      const crownFirst: Prescription = {
        surfaces: [
          { kind: "refract", curvature: c1, semiAperture: semi[2]!, thickness: d.crownThicknessMm, medium: d.crownMedium },
          { kind: "refract", curvature: c2, semiAperture: semi[1]!, thickness: d.flintThicknessMm, medium: d.flintMedium },
          { kind: "refract", curvature: c2 - dc2, semiAperture: semi[0]!, thickness: 0, medium: "AIR" },
        ],
      };
      return reversePrescription(crownFirst, 0);
    };
    const s1Direct = (c1: number): number =>
      seidelSums(mirroredAt(c1), LAMBDA, {
        marginalHeightMm: din.stopRadiusMm,
        objectDistanceMm: din.objectDistanceMm,
      }).s1;

    // Bisect the direct route's root around the one reciprocity produced.
    const solved = d.curvatures[0];
    let lo = solved * 0.9;
    let hi = solved * 1.1;
    let flo = s1Direct(lo);
    expect(flo * s1Direct(hi)).toBeLessThan(0);
    for (let k = 0; k < 200 && hi - lo > 1e-16; k++) {
      const mid = 0.5 * (lo + hi);
      const fm = s1Direct(mid);
      if (flo * fm < 0) hi = mid;
      else {
        lo = mid;
        flo = fm;
      }
    }
    // Ten digits. Reciprocity is exact in the third-order sums, not approximate.
    expect(0.5 * (lo + hi)).toBeCloseTo(solved, 10);
  });

  it("verifies its own fixed point: solved-for conjugate == used-at conjugate", () => {
    // The anti-circularity check, as a readout. The bending and the specimen
    // plane are mutually dependent, and a fixed point that had not closed would
    // ship a lens solved for the wrong conjugate — with every rung below still
    // passing, because the trace confirms whatever it was solved for.
    for (const M of [4, 10, 20]) {
      const o = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
      expect(o.doublet.objectDistanceMm).toBeCloseTo(o.imageDistanceMm, 6);
      // …and the S_I it was solved for really is null where it is USED.
      expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(1e-12);
    }
  });
});

describe("§ 6b.2 — Newton's equation, on the traced cardinal points", () => {
  it("satisfies x_o·x′ = f² between two independently measured focal points", () => {
    for (const M of [4, 10, 20]) {
      const o = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
      const props = systemProperties(o.prescription, LAMBDA);
      // The front focal point from the collimating solve (§ 6a.2's route), the
      // rear from `systemProperties`, the image plane from a paraxial ray. Three
      // separate computations; Newton relates them.
      const xObject = o.objectDistanceMm - collimatingObjectDistance(o.prescription, LAMBDA);
      const xImage = o.imageDistanceMm - props.bfd;
      expect(xObject * xImage).toBeCloseTo(props.efl ** 2, 6);
      // …and the magnification Newton predicts from them is the one asked for.
      expect(xImage / props.efl).toBeCloseTo(M, 4);
    }
  });

  it("delivers the asked-for magnification on the traced chief ray", () => {
    for (const M of [4, 10, 20]) {
      const o = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
      const scope = finiteConjugateMicroscope({ objective: o });
      const m = lateralMagnification(scope.system, 0.02, LAMBDA);
      expect(m).toBeLessThan(0); // real, inverted
      expect(Math.abs(m) / M - 1).toBeLessThan(1e-4);
      expect(scope.nominalMagnification).toBeCloseTo(M, 12);
    }
  });

  it("cannot make M and the tube length exact at once — and says which it kept", () => {
    // A thick lens's traced EFL is not its thin-lens design target, so placing
    // the specimen for an exact M leaves the optical tube length long by exactly
    // that remainder. Pinned as the IDENTITY between the two, not as a tolerance:
    // whatever the remainder is, the two must move together.
    for (const M of [4, 10, 20]) {
      const o = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
      expect(o.tracedOpticalTubeLengthMm / o.opticalTubeLengthMm).toBeCloseTo(
        o.paraxialFocalLengthMm / o.focalLengthMm,
        9,
      );
      // …and it is a small effect, under 0.6% even for the thickest (4×) member.
      expect(Math.abs(o.tracedOpticalTubeLengthMm / o.opticalTubeLengthMm - 1)).toBeLessThan(6e-3);
    }
  });

  it("has no tube lens at all — the objective IS the microscope", () => {
    const scope = finiteConjugateMicroscope({ objective: buildDin4x() });
    // Three surfaces: one cemented doublet. The architectural difference from
    // § 6a in one assertion, and the reason the objective carries the whole
    // correction itself.
    expect(scope.prescription.surfaces).toHaveLength(3);
    const flags = scope.prescription.surfaces.map((s) => s.isStop === true);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags[0]).toBe(true);
  });

  it("keeps the mechanical 160 out of the optics", () => {
    // 160 is the ENGRAVED, mechanical tube length; the magnification is a ratio
    // against the optical one. Writing M = 160/f conflates them, and it is a 7%
    // error in the label — asserted so the conflation cannot creep back in.
    expect(MECHANICAL_TUBE_LENGTH_MM.din).toBe(160);
    expect(OPTICAL_TUBE_LENGTH_MM.din).toBe(150);
    const o = buildDin4x();
    expect(o.focalLengthMm).toBeCloseTo(150 / 4, 12);
    expect(Math.abs(o.focalLengthMm - 160 / 4)).toBeGreaterThan(2);
    // Stated, not assumed: a different convention re-labels the same glass, the
    // way § 6a's Zeiss tube does.
    const alt = finiteConjugateObjective({
      magnification: 4,
      numericalAperture: 0.1,
      opticalTubeLengthMm: 160,
    });
    expect(alt.focalLengthMm).toBeCloseTo(40, 12);
    expect(Math.abs(lateralMagnification(finiteConjugateMicroscope({ objective: alt }).system, 0.02, LAMBDA)))
      .toBeCloseTo(4, 2);
  });
});

describe("§ 6b.3 — orientation, re-contested at the DIN conjugates", () => {
  it("is worth only ~25% once each orientation is solved for its own conjugates", () => {
    // § 6a's orientation rung is 9.2 waves, but that compares a doublet used at
    // the conjugates it was solved for against one that was not. Solve BOTH ways
    // round for the DIN pair and the contest is much closer: the flint-first
    // build still wins at every magnification, by about a quarter.
    for (const M of [4, 10, 20]) {
      const flint = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
      const crown = finiteConjugateObjective({
        magnification: M,
        numericalAperture: 0.1,
        orientation: "crownFirst",
      });
      const rms = (o: typeof flint): number => {
        const s = finiteConjugateMicroscope({ objective: o }).system;
        const map = opdMap(s, 0, LAMBDA, pupilGrid(21));
        // Both orientations must trace CLEAN before their wavefronts are
        // compared: an RMS averaged over a clipped pupil is a different number.
        expect(map.lost).toBe(0);
        return map.rmsWaves;
      };
      const ratio = rms(crown) / rms(flint);
      expect(ratio).toBeGreaterThan(1.15);
      expect(ratio).toBeLessThan(1.35);
    }
  });

  it("…and the SA-better orientation is NOT the coma-better one", () => {
    // § 5j's straddle finding again, now across orientation rather than across
    // the two roots: crown-first is worse on axis and better on the sine
    // condition. Neither orientation is aplanatic, and no bending makes one so.
    const M = 4;
    const flint = finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 });
    const crown = finiteConjugateObjective({
      magnification: M,
      numericalAperture: 0.1,
      orientation: "crownFirst",
    });
    const res = (o: typeof flint): number =>
      Math.abs(sineConditionResidual(finiteConjugateMicroscope({ objective: o }).system, 0.05, LAMBDA));
    expect(res(crown)).toBeLessThan(res(flint));
    expect(res(crown)).toBeGreaterThan(1e-3);
  });
});

describe("§ 6b.4 — the DIN architecture's numbers", () => {
  it("delivers the specified NA at the specimen, from the traced marginal ray", () => {
    for (const M of [4, 10, 20]) {
      const scope = finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 }),
      });
      expect(objectNumericalAperture(scope.system, LAMBDA)).toBeCloseTo(0.1, 6);
    }
  });

  it("runs FASTER than 1/(2·NA), approaching it as the magnification climbs", () => {
    // The finite-conjugate correction to § 6a.4's F = 1/(2·NA). The specimen sits
    // beyond the front focus by f/M, so the cone filling the stop is wider than
    // the collimated-out case by about (1 + 1/M) — a 20% effect at 4×, 5% at 20×,
    // and vanishing as the DIN objective approaches an infinity-corrected one.
    const ratios = [4, 10, 20].map(
      (M) => finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 }).workingFocalRatio,
    );
    for (const F of ratios) expect(F).toBeLessThan(5);
    expect(ratios[0]!).toBeLessThan(ratios[1]!);
    expect(ratios[1]!).toBeLessThan(ratios[2]!);
    expect(ratios[2]!).toBeGreaterThan(4.8); // 20× is already within 4% of the limit
    expect(ratios[0]!).toBeLessThan(4.2); // 4× is a genuinely fast doublet
  });

  it("is diffraction-limited AT BEST FOCUS, and honestly not at the paraxial plane", () => {
    const o = buildDin4x();
    const s = finiteConjugateMicroscope({ objective: o }).system;
    const paraxial = opdMap(s, 0, LAMBDA, pupilGrid(21)).rmsWaves;
    // The 4× is an f/4.1 cemented doublet — the speed § 5j's header warns the
    // third-order solve degrades at. Its fifth-order residual needs the
    // balancing defocus, and at the paraxial plane it does NOT clear Maréchal.
    expect(paraxial).toBeGreaterThan(1 / 14);
    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const balanced = opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).rmsWaves;
    expect(balanced).toBeLessThan(1 / 14);
    // Balancing is worth better than 2× — the signature of a pure fifth-order
    // residual, not of a mis-solved third order.
    expect(paraxial / balanced).toBeGreaterThan(2);
  });

  it("gets better as the objective slows, at fixed NA", () => {
    // F = f/(2·a·tan u) rises with M at fixed NA, and a slower doublet has less
    // fifth-order residual — the same law § 5j and §§ 5f/5h all report.
    const rms = (M: number): number => {
      const s = finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: M, numericalAperture: 0.1 }),
      }).system;
      const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
      return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).rmsWaves;
    };
    const [r4, r10, r20] = [rms(4), rms(10), rms(20)];
    expect(r10).toBeLessThan(r4);
    expect(r20).toBeLessThan(r10);
    expect(r4 / r20).toBeGreaterThan(10);
  });

  it("refuses a magnification or NA it cannot mean", () => {
    expect(() => finiteConjugateObjective({ magnification: 0, numericalAperture: 0.1 })).toThrow(/magnification/);
    expect(() => finiteConjugateObjective({ magnification: 4, numericalAperture: 1.2 })).toThrow(/NA/);
    expect(() =>
      finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, opticalTubeLengthMm: 0 }),
    ).toThrow(/tube length/);
  });
});
