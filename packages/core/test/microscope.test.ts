import { describe, it, expect } from "vitest";
import {
  DEFAULT_TUBE_FOCAL_LENGTH_MM,
  TUBE_FOCAL_LENGTH_MM,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
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
