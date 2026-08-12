import { describe, it, expect } from "vitest";
import {
  microscopeObjective,
  infinityCorrectedMicroscope,
  tubeLens,
} from "../src/designs/microscope";
import {
  coverslip,
  coverslipIndex,
  coverslipSurface,
  plateW040Mm,
} from "../src/designs/coverslip";
import { achromaticObjective } from "../src/designs/achromat";
import { seidelSums } from "../src/analysis/seidel";
import { LINE_D } from "../src/materials/dispersion";
import { Prescription } from "../src/trace/prescription";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { pupils } from "../src/pupil/pupils";
import { bestFocus, withFocus } from "../src/analysis/focus";
import {
  chiefRayInvariant,
  objectNumericalAperture,
  lateralMagnification,
} from "../src/pupil/microscope";

/**
 * Rungs for the infinity-corrected objective's coverslip — docs/VALIDATION.md
 * § 6z. § 6c's last named deferral, and the one it left phrased as pure wiring:
 * *"the infinity-corrected member's slip is a named deferral, and the wiring is
 * the same target-S_I move `finiteConjugateObjective` makes."*
 *
 * The move is the same and three of its consequences are not, which is why this
 * is a step rather than a parameter. The plate's contribution is not
 * position-independent here (§ 6z.2); the field number § 6w added changes what
 * currency the target has to be quoted in (§ 6z.5); and the price the correction
 * charges is **linear in magnification** where every other number § 6w measured
 * was magnification-free (§ 6z.6). It also found a defect in a shipped function
 * (§ 6z.7) and closed one of § 6y's open items with its reason revised (§ 6z.8).
 *
 * The external pins are § 6c's and are reused rather than reminted: the plate's
 * apparent depth t/n, and its third-order spherical aberration
 * −t·(n²−1)·u⁴/n³ — solvable in closed form from Snell, which is why the design
 * is built by summing real surfaces and checked against the formula.
 */

const LAMBDA = LINE_D;
const SLIP = coverslip({});
const N_SLIP = coverslipIndex(SLIP, LAMBDA);
const T_SLIP = SLIP.thicknessMm;

/** The shipped 4×/0.10, with and without the slip it is corrected for. */
const objective4x = (withSlip: boolean) =>
  microscopeObjective({
    magnification: 4,
    numericalAperture: 0.1,
    ...(withSlip ? { coverslip: {} } : {}),
  });

const scope = (o: ReturnType<typeof microscopeObjective>) =>
  infinityCorrectedMicroscope({ objective: o, tubeLens: tubeLens() });

const rmsWaves = (s: OpticalSystem): number => {
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).rmsWaves;
};

describe("§ 6z.1 — the specimen is inside the glass, and the gap is solved for", () => {
  it("puts the specimen against the slip's underside and the plate at the front of the chain", () => {
    const o = objective4x(true);
    // Surface 0 is the slip's upper face — flat, no aperture — so the system's
    // conjugate distance IS the slip thickness and the air path is separate.
    expect(o.objectDistanceMm).toBe(T_SLIP);
    expect(o.prescription.objectMedium).toBe(SLIP.medium);
    expect(o.prescription.surfaces[0]!.curvature).toBe(0);
    expect(o.prescription.surfaces[0]!.isStop).toBeFalsy();
    expect(o.coverslip?.thicknessMm).toBe(T_SLIP);
    // One aperture, one flag — § 6a's rule, at the index the slip pushed it to.
    expect(o.prescription.surfaces.filter((s) => s.isStop).length).toBe(1);
    expect(o.stopSurfaceIndex).toBe(o.prescription.surfaces.length - 1);
    expect(o.prescription.surfaces[o.stopSurfaceIndex]!.isStop).toBe(true);
    // …and a bare objective is unchanged: no slip surface, stop where it was.
    const bare = objective4x(false);
    expect(bare.coverslip).toBeUndefined();
    expect(bare.airGapMm).toBe(bare.objectDistanceMm);
    expect(bare.stopSurfaceIndex).toBe(bare.prescription.surfaces.length - 1);
  });

  it("solves the gap by trace, and the APPARENT DEPTH t/n is what comes back", () => {
    // The external pin. `solveAirGap` runs a secant on the traced paraxial chain
    // and never evaluates t/n, so the closed form is free to be a check: the
    // objective sits closer to the slip than it would to a bare specimen by
    // exactly the depth the plate makes the specimen appear to have.
    for (const NA of [0.1, 0.15, 0.2]) {
      const o = microscopeObjective({ magnification: 4, numericalAperture: NA, coverslip: {} });
      const shortenedBy = o.airEquivalentObjectDistanceMm - o.airGapMm;
      // Quoted against the distance the secant works in rather than against the
      // depth it resolves: the residual is f64 noise on a 48 mm object distance,
      // and calling it a tolerance on 0.11 mm would flatter it by 400×.
      expect(Math.abs(shortenedBy - T_SLIP / N_SLIP)).toBeLessThan(
        1e-13 * o.airEquivalentObjectDistanceMm,
      );
      // …and the air-equivalent plane is a bare lens's object distance to parts
      // in 10⁴, not to more: the correction changed the bending, so the two
      // lenses' front focal distances are genuinely different lengths.
      const bare = microscopeObjective({ magnification: 4, numericalAperture: NA });
      expect(o.airEquivalentObjectDistanceMm / bare.objectDistanceMm).toBeCloseTo(1, 3);
      // free working distance is measured to the SLIP, not to the specimen
      expect(o.freeWorkingDistanceMm).toBeLessThan(o.airGapMm);
      expect(o.airGapMm - o.freeWorkingDistanceMm).toBeGreaterThan(0);
    }
  });
});

describe("§ 6z.2 — the gap and the target are ONE fixed point", () => {
  /**
   * The finding that separates this step from § 6c's wiring sentence.
   *
   * A plane-parallel plate crossed by both faces in one medium contributes a
   * spherical aberration independent of where it sits — the two faces' S_I terms
   * differ only through the marginal height, and the difference is the transfer
   * across the plate. A coverslip is not that plate: the image lands INSIDE it,
   * so the chain crosses one face and what sets the aberration is the depth from
   * that face to the image. Put the face anywhere else and the sum reports a
   * different plate.
   */
  it("a stale gap reports a different plate — 1.90×, 9.96×, 403×", () => {
    const NA = 0.25;
    const glassR = 50 * NA;
    const d = achromaticObjective({
      apertureMm: 2 * glassR,
      focalRatio: 50 / (2 * glassR),
      designWavelengthNm: LAMBDA,
    });
    const g = d.prescription.surfaces;
    const props = systemProperties(d.prescription, LAMBDA);
    const bareS1 = seidelSums(d.prescription, LAMBDA, { marginalHeightMm: glassR }).s1;
    const plateAt = (gapMm: number): number => {
      const appended: Prescription = {
        ...d.prescription,
        surfaces: [
          ...g.slice(0, -1),
          { ...g[g.length - 1]!, thickness: gapMm },
          {
            kind: "refract" as const,
            curvature: 0,
            semiAperture: Infinity,
            thickness: T_SLIP,
            medium: SLIP.medium,
          },
        ],
      };
      return seidelSums(appended, LAMBDA, { marginalHeightMm: glassR }).s1 - bareS1;
    };
    // The focus-consistent gap: the image lands t below the face.
    const right = props.bfd - T_SLIP / N_SLIP;
    const truth = plateAt(right);
    expect(plateAt(right - 0.1) / truth).toBeCloseTo(1.896, 3);
    expect(plateAt(right - 1) / truth).toBeCloseTo(9.961, 3);
    expect(plateAt(0) / truth).toBeCloseTo(402.7, 1);
    // …so the constructor's fixed point is not decoration: the gap it converged
    // on is the one the delivered target belongs to.
    const o = microscopeObjective({ magnification: 4, numericalAperture: NA, coverslip: {} });
    expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(
      1e-9 * Math.abs(o.seidelS1OfGlassAlone),
    );
  });
});

describe("§ 6z.3 — the target IS the plate, and the null is read in the other frame", () => {
  it("makes the PAIR stigmatic, with the glass alone carrying plus the plate's own S_I", () => {
    for (const NA of [0.1, 0.15, 0.2]) {
      const o = microscopeObjective({ magnification: 4, numericalAperture: NA, coverslip: {} });
      // Solved in the reversed frame, measured on the real chain in the real one.
      expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(
        1e-9 * Math.abs(o.seidelS1OfGlassAlone),
      );
      // The closed form the design never evaluated: S_I = −t·(n²−1)·u⁴/n³ at the
      // slope the emergent marginal ray carries in air. The lens is built to
      // MINUS that, so its own sum is plus it.
      const u = o.stopRadiusMm / Math.abs(o.paraxialFocalLengthMm);
      const plateS1 = (-T_SLIP * u ** 4 * (N_SLIP * N_SLIP - 1)) / N_SLIP ** 3;
      expect(o.seidelS1OfGlassAlone / -plateS1).toBeCloseTo(1, 9);
      // …and the objective corrected for no slip is nulled on its own.
      const bare = microscopeObjective({ magnification: 4, numericalAperture: NA });
      expect(Math.abs(bare.seidelS1OfGlassAlone)).toBeLessThan(1e-14);
      expect(bare.doublet.targetS1Mm).toBe(0);
    }
  });

  it("moves the bending, by a resolvable amount and an optically negligible one", () => {
    const bare = objective4x(false);
    const slip = objective4x(true);
    const shift = Math.abs(slip.doublet.curvatures[0] / bare.doublet.curvatures[0] - 1);
    expect(shift).toBeGreaterThan(1e-4);
    // § 6c's headline, on the other architecture: the plate asks for W₀₄₀ of
    // |target|/8 mm, balanced that is W₀₄₀/(6√5) of RMS, and the objective's own
    // residual is two orders above it. A 4×/0.10 is coverslip-insensitive
    // whichever way its tube is built.
    const asked = plateW040Mm(T_SLIP, N_SLIP, 0.1) / (LAMBDA * 1e-6);
    const balanced = asked / (6 * Math.sqrt(5));
    expect(balanced).toBeLessThan(2e-4);
    expect(rmsWaves(scope(slip).system) / balanced).toBeGreaterThan(100);
  });
});

describe("§ 6z.4 — it still delivers its NA and its magnification, both placements", () => {
  it("reads back the label through the slip", () => {
    for (const stopPlacement of ["backFocal", "rim"] as const) {
      const o = microscopeObjective({
        magnification: 4,
        numericalAperture: 0.1,
        coverslip: {},
        stopPlacement,
      });
      const m = scope(o);
      // NA is read at the specimen INSIDE the glass, n·sin u — the cone the slip
      // narrows and the flat face hands back on the way out.
      expect(objectNumericalAperture(m.system, LAMBDA)).toBeCloseTo(0.1, 10);
      expect(lateralMagnification(m.system, 1e-4, LAMBDA)).toBeCloseTo(-4, 2);
      expect(opdMap(m.system, 0, LAMBDA, pupilGrid(21)).lost).toBe(0);
      expect(m.system.prescription.surfaces.filter((s) => s.isStop).length).toBe(1);
    }
  });

  it("…and the stop the slip needs is smaller, by the two tangents' ratio", () => {
    // The specimen radiates into sin u = NA/n, not NA: it is inside the glass.
    // Sizing the stop the bare way would over-fill the pupil by exactly
    // √((1−(NA/n)²)/(1−NA²)) — § 6c's negative control, and the same number here
    // because it is a statement about the object cone rather than about a stop.
    const NA = 0.1;
    const slip = objective4x(true);
    const overSized = Math.sqrt((1 - (NA / N_SLIP) ** 2) / (1 - NA * NA));
    // Read on ONE lens: the bare sizing `f·tan u_air` against the one it was
    // built with. Comparing the two builds instead would carry their EFLs apart
    // as well — 6.6e-6 of it, which is a different (and real) difference.
    const naive = Math.abs(slip.paraxialFocalLengthMm) * (NA / Math.sqrt(1 - NA * NA));
    expect(naive / slip.stopRadiusMm).toBeCloseTo(overSized, 12);
    expect(overSized - 1).toBeCloseTo(0.00287, 5);
    const misSized = {
      ...scope(slip).system,
      aperture: { kind: "stopRadius" as const, value: naive },
    };
    expect(objectNumericalAperture(misSized, LAMBDA)).toBeCloseTo(0.1002857, 6);
  });
});

describe("§ 6z.5 — the field number does not enter the currency", () => {
  /**
   * § 6w's own note, closed. Once the glass is sized `f·NA + h` the marginal ray
   * is no longer at D/2, and `targetS1Mm` is documented as being evaluated
   * there. The target is therefore summed at D/2 as well; the Seidel sums are
   * homogeneous of degree four in the marginal ray, so one currency for both
   * sides is exact rather than approximately right.
   */
  it("delivers the SAME correction with a field number and without", () => {
    const plain = microscopeObjective({ magnification: 4, numericalAperture: 0.1, coverslip: {} });
    const fielded = microscopeObjective({
      magnification: 4,
      numericalAperture: 0.1,
      fieldNumberMm: 18,
      coverslip: {},
    });
    // Two different lenses — the fielded one is built at a 1.45× wider aperture…
    const k = fielded.glassRadiusMm / fielded.pupilRadiusMm;
    expect(k).toBeCloseTo(1.45, 12);
    expect(fielded.doublet.targetS1Mm / plain.doublet.targetS1Mm).toBeGreaterThan(4);
    // …and the aberration each one actually carries is the same number, because
    // the plate in front of them is.
    expect(fielded.seidelS1OfGlassAlone / plain.seidelS1OfGlassAlone).toBeCloseTo(1, 10);
    expect(Math.abs(fielded.seidelS1AtWorkingConjugates)).toBeLessThan(
      1e-9 * Math.abs(fielded.seidelS1OfGlassAlone),
    );
  });

  it("NEGATIVE CONTROL: quoted in the beam's currency it under-corrects by 1 − 1/k⁴", () => {
    // What a caller who measured the plate on the real beam and passed that
    // number would get. `achromaticObjective` drives ΣS_I at D/2 to the target,
    // so a target k⁴ too small leaves the pair carrying (1 − 1/k⁴) of the plate.
    const fielded = microscopeObjective({
      magnification: 4,
      numericalAperture: 0.1,
      fieldNumberMm: 18,
      coverslip: {},
    });
    const k = fielded.glassRadiusMm / fielded.pupilRadiusMm;
    const naive = achromaticObjective({
      apertureMm: 2 * fielded.glassRadiusMm,
      focalRatio: fielded.focalRatio,
      designWavelengthNm: LAMBDA,
      targetS1Mm: fielded.doublet.targetS1Mm / k ** 4,
    });
    // Its residual, in the same currency the solver quotes: what is left of the
    // plate rather than what was asked for.
    const left = 1 - naive.seidelS1 / fielded.doublet.targetS1Mm;
    expect(left).toBeCloseTo(1 - 1 / k ** 4, 9);
    expect(left).toBeCloseTo(0.7738, 4);
  });
});

describe("§ 6z.6 — the price is LINEAR IN MAGNIFICATION, and § 6w's was not", () => {
  /**
   * The step's headline. § 6w found the 4× and the 40× to be one lens scaled —
   * every length ×10, the oversize a ratio the magnification cancels out of. A
   * 0.17 mm coverslip is the one thing in the branch that does NOT scale with
   * the objective, so nothing cancels: the plate asks the same absolute
   * correction of every member while a Seidel sum, having the dimension of a
   * length, gives a lens ten times smaller a tenth as much to trade with.
   */
  it("the plate asks the same absolute correction of every magnification", () => {
    const asked = [4, 10, 20, 40].map(
      (M) =>
        microscopeObjective({ magnification: M, numericalAperture: 0.2, coverslip: {} })
          .seidelS1OfGlassAlone,
    );
    for (const a of asked) expect(a / asked[0]!).toBeCloseTo(1, 7);
  });

  it("…and the bending it costs is ∝ M, from 3.11e-4 at 4× to 3.10e-3 at 40×", () => {
    const shift = (M: number): number => {
      const o = microscopeObjective({ magnification: M, numericalAperture: 0.2, coverslip: {} });
      const b = microscopeObjective({ magnification: M, numericalAperture: 0.2 });
      return Math.abs(o.doublet.curvatures[0] / b.doublet.curvatures[0] - 1);
    };
    const at4 = shift(4);
    const at40 = shift(40);
    expect(at4).toBeCloseTo(3.1122e-4, 8);
    expect(at40).toBeCloseTo(3.0977e-3, 7);
    // Linear in M, not in M² and not flat: the ratio is the magnification ratio.
    expect(at40 / at4).toBeCloseTo(10, 1);
    expect(shift(20) / shift(10)).toBeCloseTo(2, 2);
  });

  it("…and so is the aperture ceiling it gives up: 0.0123% at 4×, 0.1224% at 40×", () => {
    // § 6b.5.7's geometric wall, walked into from a third direction. § 6w found
    // a field number moves it; a slip target moves it too, and by an amount the
    // magnification does not cancel out of.
    const wall = (M: number, withSlip: boolean): number => {
      let lo = 0.2;
      let hi = 0.35;
      for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (lo + hi);
        try {
          microscopeObjective({
            magnification: M,
            numericalAperture: mid,
            ...(withSlip ? { coverslip: {} } : {}),
          });
          lo = mid;
        } catch {
          hi = mid;
        }
      }
      return 0.5 * (lo + hi);
    };
    // The bare wall is § 6w's own 0.287401975 and carries no magnification.
    const bare = wall(4, false);
    expect(bare).toBeCloseTo(0.287401975, 8);
    expect(wall(40, false)).toBeCloseTo(bare, 8);
    const cost4 = 1 - wall(4, true) / bare;
    const cost40 = 1 - wall(40, true) / bare;
    expect(cost4 * 100).toBeCloseTo(0.01227, 4);
    expect(cost40 * 100).toBeCloseTo(0.12236, 4);
    expect(cost40 / cost4).toBeCloseTo(10, 1);
  });

  it("refuses in words that name the slip rather than only the aperture", () => {
    expect(() =>
      microscopeObjective({ magnification: 40, numericalAperture: 0.2874, coverslip: {} }),
    ).toThrow(/corrected for a 0.17 mm coverslip/);
    // …and the same aperture without one builds, which is what makes the message
    // true rather than decorative.
    expect(() =>
      microscopeObjective({ magnification: 40, numericalAperture: 0.2874 }),
    ).not.toThrow();
  });
});

describe("§ 6z.7 — a telecentric aperture assumed the object and the stop shared a medium", () => {
  /**
   * A defect in a shipped function, found by being the first caller to put a
   * specimen in glass behind a back-focal stop — the sixth member of the
   * C4/A6/C5 family, and the second to answer with a NUMBER rather than a
   * status.
   *
   * `imageStopBackward`'s telecentric branch traces {y: 0, u: 1} back from the
   * stop and reads the height it exits with as −B. That is the inverse matrix
   * carrying (0, 1) to (−B, A)/det, and the comment asserted det = 1. With `u`
   * the raw geometric slope a refraction contributes n_before/n_after, so
   * det = n_object/n_stop — unity exactly while the two spaces share an index,
   * which every telecentric system in the repo did until this one.
   */
  it("the aperture is the object-medium slope, and reads the NA back exactly", () => {
    const o = objective4x(true);
    const m = scope(o);
    const p = pupils(m.system, LAMBDA);
    expect(p.entrance.radius).toBe(Infinity);
    const sinU = 0.1 / N_SLIP;
    const tanU = sinU / Math.sqrt(1 - sinU * sinU);
    // The slope aperture is tan u IN THE SLIP — not n·tan u, which is what the
    // un-corrected expression returned.
    expect(p.entrance.slopeRadius).toBeCloseTo(tanU, 12);
    expect(objectNumericalAperture(m.system, LAMBDA)).toBeCloseTo(0.1, 10);
  });

  it("NEGATIVE CONTROL: the old expression is 51.9% fast, and the symptom points elsewhere", () => {
    // Aiming with a slope n times too wide is the same trace as a stop n times
    // too big, which is what the old arithmetic amounted to.
    const o = objective4x(true);
    const m = scope(o);
    const asOld = {
      ...m.system,
      aperture: { kind: "stopRadius" as const, value: o.stopRadiusMm * N_SLIP },
    };
    const delivered = objectNumericalAperture(asOld, LAMBDA);
    expect(delivered).toBeCloseTo(0.1518988, 6);
    expect(delivered / 0.1 - 1).toBeCloseTo(0.519, 2);
    // What makes this the C4/A6/C5 shape is not that it is silent — it is that
    // the two readouts disagree and neither names the other. The trace DOES
    // object: an objective whose glass is sized `f·NA` for NA 0.10 cannot pass a
    // 0.152 cone, so half the pupil grid is lost. But `objectNumericalAperture`
    // goes on reporting 0.152, so what a caller sees is a correctly-labelled
    // objective mysteriously vignetting itself, which reads as a fault of the
    // GLASS — § 1.5.2's "a miss reads as the system's fault", one readout along.
    const grid = pupilGrid(21);
    const lost = opdMap(asOld, 0, LAMBDA, grid).lost;
    expect(lost).toBe(176);
    expect(opdMap(m.system, 0, LAMBDA, grid).lost).toBe(0);
  });

  it("IDENTITY: in air the correction is ×1/×1, so nothing that worked moved", () => {
    // The whole ladder's telecentric systems sit in air on both sides, where the
    // determinant is exactly 1 and the new expression multiplies and divides by
    // a literal 1.0 — bitwise the old one. Asserted rather than left to the
    // suite's silence, because a "no test moved" argument expires.
    const bare = objective4x(false);
    const m = scope(bare);
    const p = pupils(m.system, LAMBDA);
    const tanU = 0.1 / Math.sqrt(1 - 0.01);
    expect(p.entrance.n).toBe(1);
    expect(p.entrance.slopeRadius).toBe(Math.abs(bare.stopRadiusMm / Math.abs(bare.paraxialFocalLengthMm)));
    expect(p.entrance.slopeRadius).toBeCloseTo(tanU, 12);
  });
});

describe("§ 6z.8 — the chief invariant through a REAL stack, and § 6y's sentence", () => {
  /**
   * § 6y's second "Not yet pinned": *"`chiefRayInvariant` reads the ray as it
   * leaves the specimen … but the objectives it is read on have no slab in their
   * prescription … For a plane stack those are the same by conservation."*
   *
   * The objectives now have one, and that last clause is **half wrong**. It is
   * exact where the objective is telecentric, and where it is not the two
   * readings part company quadratically in field — because the chief ray of the
   * assembly and the chief ray of the lens placed at the *paraxial* apparent
   * depth are not the same ray, and a plate's apparent depth depends on angle.
   */
  const withoutSlipSystem = (o: ReturnType<typeof microscopeObjective>): OpticalSystem => {
    const m = scope(o);
    return {
      ...m.system,
      prescription: {
        ...m.system.prescription,
        objectMedium: "AIR",
        surfaces: m.system.prescription.surfaces.slice(1),
      },
      conjugate: { kind: "finite" as const, distance: o.airEquivalentObjectDistanceMm },
    };
  };

  it("is a BITWISE zero at every height on the telecentric member, slab or no slab", () => {
    const o = microscopeObjective({ magnification: 4, numericalAperture: 0.1, coverslip: {} });
    const assembly = scope(o).system;
    const lens = withoutSlipSystem(o);
    for (const h of [0.05, 0.1, 0.5]) {
      expect(chiefRayInvariant(assembly, h, LAMBDA)).toBe(0);
      expect(chiefRayInvariant(lens, h, LAMBDA)).toBe(0);
    }
  });

  it("…and departs as the SQUARE of the field on the rim-stopped control", () => {
    const o = microscopeObjective({
      magnification: 4,
      numericalAperture: 0.1,
      coverslip: {},
      stopPlacement: "rim",
    });
    const assembly = scope(o).system;
    const lens = withoutSlipSystem(o);
    const departure = (h: number): number =>
      Math.abs(chiefRayInvariant(assembly, h, LAMBDA) / chiefRayInvariant(lens, h, LAMBDA) - 1);
    // Non-zero to begin with, so the ratios below are not a null over a null.
    expect(chiefRayInvariant(assembly, 0.1, LAMBDA)).toBeCloseTo(-2.0532e-3, 6);
    expect(departure(0.05)).toBeGreaterThan(1e-8);
    expect(departure(0.1) / departure(0.05)).toBeCloseTo(4, 1);
    expect(departure(0.5) / departure(0.1)).toBeCloseTo(25, 0);
  });
});

describe("§ 6z.9 — what the correction is worth, and which way it points", () => {
  it("the two mismatches are equal and OPPOSITE, in the traced wavefront", () => {
    // Third order says so exactly: the corrected glass carries +plate and the
    // bare glass carries 0, so removing the slip from one and adding it to the
    // other move ΣS_I by the same amount in opposite directions. That it
    // survives into a traced wavefront, on a lens whose residual is dominated by
    // orders the target never saw, is the part worth pinning.
    const corrected = objective4x(true);
    const bare = objective4x(false);
    const matched = rmsWaves(scope(corrected).system);
    const bareAlone = rmsWaves(scope(bare).system);
    const correctedDry = rmsWaves(
      (() => {
        const m = scope(corrected);
        return {
          ...m.system,
          prescription: {
            ...m.system.prescription,
            objectMedium: "AIR",
            surfaces: m.system.prescription.surfaces.slice(1),
          },
          conjugate: { kind: "finite" as const, distance: corrected.airEquivalentObjectDistanceMm },
        };
      })(),
    );
    const bareWet = rmsWaves(
      (() => {
        const m = scope(bare);
        const gap = bare.objectDistanceMm - T_SLIP / N_SLIP;
        return {
          ...m.system,
          prescription: {
            ...m.system.prescription,
            objectMedium: SLIP.medium,
            surfaces: [coverslipSurface(gap), ...m.system.prescription.surfaces],
          },
          conjugate: { kind: "finite" as const, distance: T_SLIP },
        };
      })(),
    );
    expect((correctedDry - matched) / (bareWet - bareAlone)).toBeCloseTo(-1, 1);
  });

  it("…and the direction falsifies the slogan on THIS lens: the dry mismatch is BETTER", () => {
    // § 6c's "using a corrected objective without its slip is worse than using
    // no correction at all" is a statement about the third-order term. On the
    // 4×/0.10 the delivered wavefront is dominated by the doublet's own
    // fifth-order residual, and the plate's third-order term partly cancels it —
    // § 6e.4's "the cover slip HELPS", arriving where it does not help.
    const corrected = objective4x(true);
    const matched = rmsWaves(scope(corrected).system);
    const m = scope(corrected);
    const dry = rmsWaves({
      ...m.system,
      prescription: {
        ...m.system.prescription,
        objectMedium: "AIR",
        surfaces: m.system.prescription.surfaces.slice(1),
      },
      conjugate: { kind: "finite" as const, distance: corrected.airEquivalentObjectDistanceMm },
    });
    expect(dry).toBeLessThan(matched);
    expect(dry / matched).toBeCloseTo(0.977, 2);
    // Both are four orders over what the plate itself asks for, which is why the
    // sign is a curiosity here and a real trade only where the form can carry NA.
    const asked = plateW040Mm(T_SLIP, N_SLIP, 0.1) / (LAMBDA * 1e-6) / (6 * Math.sqrt(5));
    expect(matched / asked).toBeGreaterThan(100);
  });
});
