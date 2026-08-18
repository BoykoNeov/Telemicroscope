import { describe, it, expect } from "vitest";
import {
  StopPlacement,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
} from "../src/designs/microscope";
import { systemProperties } from "../src/trace/paraxial";
import { pupils } from "../src/pupil/pupils";
import { chiefRay, marginalRay, pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { exitBundle } from "../src/analysis/spot";
import { seidelSums } from "../src/analysis/seidel";
import { objectNumericalAperture, lateralMagnification } from "../src/pupil/microscope";
import { illuminationOffset } from "../src/imaging/object-field";
import { coverslip, coverslipIndex } from "../src/designs/coverslip";
import { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6ae — the DIN objective's telecentricity.
 *
 * § 6v put the shipped INFINITY objective's stop on its own back focal plane and
 * left the finite-conjugate one alone, in as many words: *"`finiteConjugateObjective`
 * is untouched and still carries its stop on the rim. A real DIN objective is
 * telecentric too, and the composition it feeds is a different one, so it is its
 * own step."* § 6w and § 6x each repeated the deferral, and § 6x added the reason
 * it had to keep waiting: giving the DIN a back focal stop is *"what would make
 * this step's subject disappear."* This is that step.
 *
 * ## What is and is not new
 *
 * No physics. § 6u made an entrance pupil at infinity expressible, § 6v built the
 * diaphragm, § 6w wrote down the glass a telecentric bundle needs. All three
 * compose here unchanged, and the interesting content is in the three places the
 * finite conjugate makes the statement different:
 *
 *  1. **The stop radius has no object distance in it either.** That reads like an
 *     infinite-conjugate accident and is not one. The object→stop transfer matrix
 *     for a stop at the back focal plane is `[[0, f], [−1/f, 1 − s/f]]` at every
 *     object distance s, so § 6u.1's slope aperture `stopRadius/B` is `tan u`
 *     whatever the conjugate. The A = 0 in that matrix IS telecentricity and the
 *     B = f beside it is why the aperture stops carrying the specimen distance.
 *     6ae.2 measures both halves.
 *  2. **The prescription ends on the diaphragm, and a DIN has no tube lens.** So
 *     the objective's own `imageDistanceMm` is where the intermediate image is,
 *     and the last vertex it is measured from moves by the back focal distance.
 *     Three readouts are keyed to that vertex and one anti-circularity check is
 *     keyed to the *other* one. 6ae.1 pins them apart.
 *  3. **The bending solve does not move at all**, because a stop shift changes
 *     S_II/S_III/S_V and leaves S_I alone — and the DIN is solved to ΣS_I = 0.
 *     6ae.4 pins it to the bit and 6ae.5 asks what the classical stop-shift
 *     equations then predict, which is where this step stops being wiring.
 *
 * ## The default did NOT move, and that is the step's one real decision
 *
 * `microscopeObjective` defaults to `"backFocal"`; this constructor defaults to
 * `"rim"`. § 6x is why. Its whole subject is the illumination cone displaced by
 * `h/R_ep` in a rim-stopped objective's pupil, measured on this very lens, and a
 * telecentric default sends that displacement to a bitwise zero — leaving every
 * § 6x rung green while measuring nothing. So the placement went from
 * *unavailable* to *chosen*, § 6x's fixture now chooses `"rim"` by name, and
 * 6ae.7 pins the zero on purpose. What flipping the shipped default would cost is
 * measured rather than guessed: 81 rungs across 17 files, § 6b.5's external
 * Maréchal wall among them, because the aperture a DIN is diffraction-limited to
 * is not stop-placement-free.
 */

const L = LINE_D;
const NA = 0.1;

const objectiveAt = (
  stopPlacement: StopPlacement,
  extra: Partial<{
    numericalAperture: number;
    magnification: number;
    fieldNumberMm: number;
    coverslip: { thicknessMm: number };
  }> = {},
) =>
  finiteConjugateObjective({
    magnification: 4,
    numericalAperture: NA,
    stopPlacement,
    ...extra,
  });

const scopeAt = (stopPlacement: StopPlacement, extra: Parameters<typeof objectiveAt>[1] = {}) => {
  const objective = objectiveAt(stopPlacement, extra);
  return { objective, ...finiteConjugateMicroscope({ objective }) };
};

/** tan u for a cone of numerical aperture NA in air — the aperture as a slope. */
const tanOf = (na: number) => na / Math.sqrt(1 - na * na);

/** The objective's GLASS: every surface but the diaphragm the placement appends. */
const glassOf = (o: ReturnType<typeof objectiveAt>) =>
  o.stopDistanceMm === 0
    ? o.prescription
    : { ...o.prescription, surfaces: o.prescription.surfaces.slice(0, -1) };

describe("§ 6ae.1 — the diaphragm lands on the back focal plane, and the last vertex moves with it", () => {
  it("puts it at the glass group's own BFD, read off the paraxial trace", () => {
    for (const M of [4, 10, 40]) {
      const o = objectiveAt("backFocal", { magnification: M });
      const glass = glassOf(o);
      // Not a distance this step chose: the constructor asks `systemProperties`
      // where the group's back focus is and puts the disc there.
      expect(o.stopDistanceMm).toBe(systemProperties(glass, L).bfd);
      expect(objectiveAt("rim", { magnification: M }).stopDistanceMm).toBe(0);
    }
  });

  it("carries exactly one stop flag, and `stopSurfaceIndex` is where it is", () => {
    for (const placement of ["backFocal", "rim"] as const) {
      const o = objectiveAt(placement);
      const flags = o.prescription.surfaces
        .map((s, i) => (s.isStop ? i : -1))
        .filter((i) => i >= 0);
      expect(flags).toEqual([o.stopSurfaceIndex]);
      expect(o.stopPlacement).toBe(placement);
    }
    // Both ENDS of the list are a stop under some spec — surface 0 rim-stopped,
    // the last surface telecentric — which is why nothing may assume a position.
    expect(objectiveAt("rim").stopSurfaceIndex).toBe(0);
    const tele = objectiveAt("backFocal");
    expect(tele.stopSurfaceIndex).toBe(tele.prescription.surfaces.length - 1);
    // Behind a coverslip both shift by the slip's own face.
    expect(objectiveAt("rim", { coverslip: { thicknessMm: 0.17 } }).stopSurfaceIndex).toBe(1);
  });

  it("the diaphragm's clear semi-diameter IS the declared stop radius", () => {
    const o = objectiveAt("backFocal");
    expect(o.prescription.surfaces[o.stopSurfaceIndex]!.semiAperture).toBe(o.stopRadiusMm);
    expect(finiteConjugateMicroscope({ objective: o }).system.aperture).toEqual({
      kind: "stopRadius",
      value: o.stopRadiusMm,
    });
  });

  it("moves `imageDistanceMm` onto the diaphragm and leaves the TUBE LENGTH alone", () => {
    // The one coupling this step had to get right. `imageDistanceMm` is "last
    // vertex to the intermediate image" and the last vertex is now the disc, so
    // the number is shorter by the back focal distance — while
    // `tracedOpticalTubeLengthMm` is a DIFFERENCE of two distances measured from
    // that same vertex and therefore cannot move. Measured on the traces, not
    // asserted from the arithmetic: 188.2139 → 150.7785 against a 37.4353 mm BFD.
    const rim = objectiveAt("rim");
    const tele = objectiveAt("backFocal");
    expect(rim.imageDistanceMm - tele.imageDistanceMm).toBeCloseTo(tele.stopDistanceMm, 10);
    expect(tele.tracedOpticalTubeLengthMm).toBeCloseTo(rim.tracedOpticalTubeLengthMm, 12);
    // …and the intermediate image is still where Newton puts it, half a percent
    // over the nominal tube length on this thick lens — the SAME half percent
    // under both placements, which is the part that is this rung's business.
    expect(tele.tracedOpticalTubeLengthMm / tele.opticalTubeLengthMm).toBeCloseTo(1.00519, 5);
    expect(rim.tracedOpticalTubeLengthMm / rim.opticalTubeLengthMm).toBeCloseTo(1.00519, 5);
    // The trailing thickness the composition splices in is the one measured from
    // the vertex the prescription actually ends on.
    const composed = finiteConjugateMicroscope({ objective: tele }).prescription;
    expect(composed.surfaces[composed.surfaces.length - 1]!.thickness).toBe(tele.imageDistanceMm);
  });

  it("leaves the WORKING distance and the front glass untouched — those are the lens's", () => {
    const rim = objectiveAt("rim");
    const tele = objectiveAt("backFocal");
    expect(tele.freeWorkingDistanceMm).toBe(rim.freeWorkingDistanceMm);
    expect(tele.objectDistanceMm).toBe(rim.objectDistanceMm);
    expect(tele.airEquivalentObjectDistanceMm).toBe(rim.airEquivalentObjectDistanceMm);
  });
});

describe("§ 6ae.2 — the aperture becomes a slope, and the conjugate cancels out of it", () => {
  it("is `f·n·tan u` exactly, and the ratio to it is 1 at every magnification and NA", () => {
    // The step's own closed form, and the one thing that is genuinely new against
    // § 6v: object plane → back focal plane has B = f at EVERY object distance, so
    // an aperture that is `stopRadius/B` carries no specimen distance. The rim's
    // does, and its ratio to `f·tan u` walks toward 1 as the objective gets
    // shorter — 1.2144 at 4×, 1.0684 at 10×, 1.0197 at 20×, 0.9953 at 40× —
    // because it is `a/f` and `a` is `ffd + f/M` on a thick lens.
    for (const magnification of [4, 10, 20, 40]) {
      for (const numericalAperture of [0.05, 0.1]) {
        const tele = objectiveAt("backFocal", { magnification, numericalAperture });
        const closedForm = tele.paraxialFocalLengthMm * tanOf(numericalAperture);
        expect(tele.stopRadiusMm).toBe(closedForm);
        const rim = objectiveAt("rim", { magnification, numericalAperture });
        expect(rim.stopRadiusMm / closedForm).not.toBe(1);
        expect(rim.stopRadiusMm).toBeCloseTo(
          rim.airEquivalentObjectDistanceMm * tanOf(numericalAperture),
          12,
        );
      }
    }
    expect(objectiveAt("rim").stopRadiusMm / objectiveAt("backFocal").stopRadiusMm).toBeCloseTo(
      1.2144,
      4,
    );
  });

  it("keeps that shape behind a coverslip, where the plate only multiplies the slope", () => {
    // A flat plate has no power, so a specimen under a slip is an air object at
    // the air-equivalent plane and B is `n·f` rather than f. One expression,
    // `f·n·tan u_glass`, collapsing to the bare one at n = 1 — the same collapse
    // the rim's `(t + n·w)·tan u_glass` makes.
    const slip = coverslip({ thicknessMm: 0.17 });
    const n = coverslipIndex(slip, L);
    const sinUg = NA / n;
    const tanUg = sinUg / Math.sqrt(1 - sinUg * sinUg);
    const tele = objectiveAt("backFocal", { coverslip: { thicknessMm: 0.17 } });
    expect(tele.stopRadiusMm).toBe(Math.abs(tele.paraxialFocalLengthMm) * n * tanUg);
    // …and the slip solve is untouched by the placement: same gap, same residual.
    const rim = objectiveAt("rim", { coverslip: { thicknessMm: 0.17 } });
    expect(tele.airGapMm).toBe(rim.airGapMm);
    expect(tele.seidelS1AtWorkingConjugates).toBe(rim.seidelS1AtWorkingConjugates);
  });

  it("puts the entrance pupil at infinity, carrying `tan u` as a slope", () => {
    const p = pupils(scopeAt("backFocal").system, L);
    expect(p.entrance.z).toBe(-Infinity);
    expect(p.entrance.slopeRadius!).toBeCloseTo(tanOf(NA), 12);
    // The control keeps a real disc a real arm away — at the front vertex.
    const rimP = pupils(scopeAt("rim").system, L);
    expect(rimP.entrance.slopeRadius).toBeUndefined();
    expect(rimP.entrance.z).toBeCloseTo(0, 12);
  });

  it("delivers the engraved NA, and does NOT depend on where the specimen is", () => {
    for (const na of [0.05, 0.1, 0.15]) {
      expect(objectNumericalAperture(scopeAt("backFocal", { numericalAperture: na }).system, L)).toBeCloseTo(
        na,
        12,
      );
    }
    const tele = scopeAt("backFocal");
    const rim = scopeAt("rim");
    const at = (s: OpticalSystem, dz: number): OpticalSystem => ({
      ...s,
      conjugate: { kind: "finite", distance: (s.conjugate as { distance: number }).distance + dz },
    });
    const teleRef = objectNumericalAperture(tele.system, L);
    const rimRef = objectNumericalAperture(rim.system, L);
    for (const dz of [0.01, 0.1, 1]) {
      expect(objectNumericalAperture(at(tele.system, dz), L)).toBe(teleRef);
      expect(objectNumericalAperture(at(rim.system, dz), L)).not.toBe(rimRef);
    }
    // The control's size, so "does not depend" has something to be measured
    // against: a millimetre of travel costs the rim 2.1% of its aperture.
    expect(objectNumericalAperture(at(rim.system, 1), L) / rimRef).toBeCloseTo(0.9788, 4);
  });
});

describe("§ 6ae.3 — the magnification stops drifting with focus", () => {
  it("holds BITWISE over specimen travel, against a control that follows −δz/(a+δz)", () => {
    // § 6v.3's experiment at the other architecture's conjugates, and it means
    // more here: a DIN has no tube lens, so this magnification is the engraving.
    // Bitwise for the telecentric one because the chief ray is literally the same
    // line at every conjugate — there is nothing to round.
    const H = 0.02;
    for (const placement of ["backFocal", "rim"] as const) {
      const s = scopeAt(placement);
      const at = (dz: number): OpticalSystem => ({
        ...s.system,
        conjugate: { kind: "finite", distance: s.objectDistanceMm + dz },
      });
      const m0 = lateralMagnification(at(0), H, L);
      expect(Math.abs(m0)).toBeCloseTo(s.nominalMagnification, 4);
      for (const dz of [0.005, 0.05]) {
        const m = lateralMagnification(at(dz), H, L);
        if (placement === "backFocal") {
          // Asserted on the magnification itself: the difference of two identical
          // f64 negatives is −0, so a rung phrased on the ratio would fail while
          // reporting a drift of zero (§ 6v.3's own note).
          expect(m).toBe(m0);
        } else {
          const rel = (m - m0) / m0;
          expect(rel).toBeCloseTo(-dz / (s.objectDistanceMm + dz), 5);
          expect(Math.abs(rel)).toBeGreaterThan(1e-4);
        }
      }
    }
  });

  it("leaves every chief ray exactly (0, 0, 1), where the control tilts with height", () => {
    const tele = scopeAt("backFocal");
    const teleP = pupils(tele.system, L);
    const rim = scopeAt("rim");
    const rimP = pupils(rim.system, L);
    for (const h of [0.05, 0.25, 0.5]) {
      const c = chiefRay(tele.system, teleP, h, L);
      expect(c.dir.x).toBe(0);
      expect(c.dir.y).toBe(0);
      expect(c.dir.z).toBe(1);
      const r = chiefRay(rim.system, rimP, h, L);
      expect(r.dir.x / r.dir.z).toBeCloseTo(-h / rim.objectDistanceMm, 12);
    }
  });
});

describe("§ 6ae.4 — the bending does not move, and on axis neither do the rays", () => {
  it("builds the IDENTICAL doublet — every curvature, thickness and medium, to the bit", () => {
    // A stop shift changes S_II, S_III and S_V and leaves S_I alone, and the DIN
    // is solved to ΣS_I = 0. So there is nothing for the placement to re-solve,
    // and this rung is what says the constructor believes that rather than
    // re-converging onto a slightly different lens.
    const rim = objectiveAt("rim");
    const tele = objectiveAt("backFocal");
    // Compared on the GLASS, and with the two pieces of placement bookkeeping
    // held out: which surface carries the stop flag, and the trailing thickness
    // that carries the telecentric chain on to its diaphragm. Everything that is
    // the lens — curvature, medium, semi-aperture, and every internal gap — is
    // identical to the bit.
    const lensOnly = (p: { surfaces: readonly { curvature: number; medium?: string; semiAperture: number; thickness: number }[] }) =>
      p.surfaces.map((s, i) => ({
        curvature: s.curvature,
        medium: s.medium,
        semiAperture: s.semiAperture,
        ...(i === p.surfaces.length - 1 ? {} : { thickness: s.thickness }),
      }));
    expect(lensOnly(glassOf(tele))).toEqual(lensOnly(rim.prescription));
    expect(tele.paraxialFocalLengthMm).toBe(rim.paraxialFocalLengthMm);
    expect(tele.seidelS1OfGlassAlone).toBe(rim.seidelS1OfGlassAlone);
    expect(tele.workingFocalRatio).toBe(rim.workingFocalRatio);
    expect(tele.doublet.prescription).toEqual(rim.doublet.prescription);
  });

  it("launches the same axial marginal ray, to a ULP", () => {
    const m = (p: StopPlacement) => {
      const s = scopeAt(p);
      return marginalRay(s.system, pupils(s.system, L), 0, L);
    };
    const rim = m("rim");
    const tele = m("backFocal");
    expect(tele.origin.z).toBe(rim.origin.z);
    expect(tele.dir.z).toBe(rim.dir.z);
    expect(tele.dir.x).toBeCloseTo(rim.dir.x, 15);
  });

  it("…so the 1.1% the on-axis RMS differs by is the REFERENCE SPHERE, not the physics", () => {
    // The trap this rung exists for: "on axis, nothing" is true of the RAYS and
    // false of the reported number. The stop moves the EXIT pupil 0.798 → 39.885
    // mm, the reference sphere is centred on the image point with the exit-pupil
    // radius, and a different sphere reads a different defocus out of the same
    // wavefront. 0.14005 against 0.14163 waves — small, and it would have been
    // read as a physics difference if the ray identity above were not pinned.
    const grid = pupilGrid(21);
    const rim = opdMap(scopeAt("rim").system, 0, L, grid);
    const tele = opdMap(scopeAt("backFocal").system, 0, L, grid);
    expect(rim.rmsWaves).toBeCloseTo(0.14005, 4);
    expect(tele.rmsWaves).toBeCloseTo(0.14163, 4);
    expect(tele.rmsWaves / rim.rmsWaves - 1).toBeCloseTo(0.0112, 3);
    // The exit pupil moves 39.087 mm — the IMAGE of the stop, not the stop's own
    // 37.435 mm shift — and the reference radius follows it by exactly as much,
    // which is what says the 1.1% is the sphere and not a second effect.
    expect(tele.pupil.exit.z - rim.pupil.exit.z).toBeCloseTo(39.0867, 3);
    expect(rim.referenceRadius - tele.referenceRadius).toBeCloseTo(
      tele.pupil.exit.z - rim.pupil.exit.z,
      9,
    );
  });
});

/**
 * Least squares of a wavefront onto the CLASSICAL basis — piston, tilt, defocus,
 * astigmatism, coma, spherical — in Welford's spelling
 *
 *     W = ⅛·S_I·ρ⁴ + ½·S_II·ρ³cosθ + ½·S_III·ρ²cos²θ + ¼·S_IV·ρ² + …
 *
 * Fitted rather than Zernike-projected because the stop-shift equations are
 * written in exactly these coefficients, and a balanced basis would mix the
 * defocus back into them. The system is symmetric about the x–z plane, so `py`
 * enters only through ρ², and these six terms are the complete third-order set.
 */
function classicalFit(samples: readonly { px: number; py: number; waves: number }[]) {
  const basis = (px: number, py: number): number[] => {
    const r2 = px * px + py * py;
    return [1, px, r2, px * px, px * r2, r2 * r2];
  };
  const n = 6;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const s of samples) {
    const f = basis(s.px, s.py);
    for (let i = 0; i < n; i++) {
      b[i]! += f[i]! * s.waves;
      for (let j = 0; j < n; j++) A[i]![j]! += f[i]! * f[j]!;
    }
  }
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k]![i]!) > Math.abs(A[p]![i]!)) p = k;
    [A[i], A[p]] = [A[p]!, A[i]!];
    [b[i], b[p]] = [b[p]!, b[i]!];
    for (let k = i + 1; k < n; k++) {
      const mul = A[k]![i]! / A[i]![i]!;
      for (let j = i; j < n; j++) A[k]![j]! -= mul * A[i]![j]!;
      b[k]! -= mul * b[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i]![j]! * x[j]!;
    x[i] = s / A[i]![i]!;
  }
  return { w222: x[3]!, w131: x[4]!, quartic: x[5]! };
}

describe("§ 6ae.4b — the two crosses the shipped combination does not reach on its own", () => {
  it("the CROWN-FIRST arm is a different branch, and it takes the diaphragm too", () => {
    // `orientation: "crownFirst"` skips `reversePrescription` and — the part that
    // matters here — takes the OTHER side of the anti-circularity check, comparing
    // the object distance rather than the image distance. So the glass-chain frame
    // this step introduced is exercised on one arm only unless this rung exists.
    // Same finding as commit 8fcf7d7's, one axis over: a shipped option needs a
    // rung on every branch it reaches, not on the default one.
    for (const orientation of ["flintFirst", "crownFirst"] as const) {
      const rim = finiteConjugateObjective({
        magnification: 4,
        numericalAperture: NA,
        orientation,
        stopPlacement: "rim",
      });
      const tele = finiteConjugateObjective({
        magnification: 4,
        numericalAperture: NA,
        orientation,
        stopPlacement: "backFocal",
      });
      expect(tele.stopDistanceMm).toBeCloseTo(systemProperties(glassOf(tele), L).bfd, 12);
      expect(tele.stopRadiusMm).toBe(Math.abs(tele.paraxialFocalLengthMm) * tanOf(NA));
      expect(tele.tracedOpticalTubeLengthMm).toBeCloseTo(rim.tracedOpticalTubeLengthMm, 12);
      expect(tele.seidelS1AtWorkingConjugates).toBe(rim.seidelS1AtWorkingConjugates);
      expect(tele.freeWorkingDistanceMm).toBe(rim.freeWorkingDistanceMm);
    }
    // …and the two orientations really are different lenses, so the loop above is
    // not testing one design twice: their back focal distances differ by 0.21 mm.
    const a = finiteConjugateObjective({
      magnification: 4,
      numericalAperture: NA,
      stopPlacement: "backFocal",
    });
    const b = finiteConjugateObjective({
      magnification: 4,
      numericalAperture: NA,
      orientation: "crownFirst",
      stopPlacement: "backFocal",
    });
    expect(Math.abs(a.stopDistanceMm - b.stopDistanceMm)).toBeGreaterThan(0.2);
  });

  it("a field number and a coverslip compose, and § 6z.5's currency claim survives it", () => {
    // The second untested cross: the field walk now feeds the glass diameter that
    // `plateTargetS1` evaluates the plate's own S_I at. § 6z.5's answer at the
    // infinite conjugate was that this cannot matter — the Seidel sums are
    // homogeneous of degree 4 in the marginal ray, so one currency for both sides
    // cancels at every height — and that is a claim about the algebra, not about
    // that architecture. Here it is, on this one: the same correction to 10
    // digits with FN 18 and without, on a lens whose air gap moved 0.83 mm.
    const bare = objectiveAt("backFocal", { coverslip: { thicknessMm: 0.17 } });
    const wide = objectiveAt("backFocal", {
      coverslip: { thicknessMm: 0.17 },
      fieldNumberMm: 18,
    });
    expect(wide.seidelS1OfGlassAlone / bare.seidelS1OfGlassAlone).toBeCloseTo(1, 9);
    expect(Math.abs(wide.airGapMm - bare.airGapMm)).toBeGreaterThan(0.8);
    // Both are still stigmatic as a PAIR, and both still deliver the closed-form
    // telecentric radius through the slip.
    for (const o of [bare, wide]) {
      expect(Math.abs(o.seidelS1AtWorkingConjugates)).toBeLessThan(1e-12);
      const n = coverslipIndex(coverslip({ thicknessMm: 0.17 }), L);
      const sinUg = NA / n;
      expect(o.stopRadiusMm).toBe(
        Math.abs(o.paraxialFocalLengthMm) * n * (sinUg / Math.sqrt(1 - sinUg * sinUg)),
      );
    }
  });
});

describe("§ 6ae.5 — the classical stop-shift equations, and where they stop describing this lens", () => {
  const H = 0.25;
  const grid = pupilGrid(31);

  /** The traced wavefront's third-order coefficients at object height H. */
  const fitAt = (placement: StopPlacement, na: number) => {
    const o = objectiveAt(placement, { numericalAperture: na });
    const s = finiteConjugateMicroscope({ objective: o, objectHeightsMm: [H] }).system;
    return classicalFit(opdMap(s, H, L, grid).samples);
  };

  /**
   * The rim-stopped lens's own third-order sums, and the eccentricity parameter
   * of the shift to the back focal plane.
   *
   * E = Δ(ȳ/y): the chief ray sits at ȳ = 0 on surface 0 rim-stopped and at ȳ = h
   * telecentric, over a marginal height of `a·tan u`. That the difference of the
   * two chief rays is PROPORTIONAL to the marginal ray — both have y/u = a — is
   * what makes this a stop shift at all, and is why E is the same at every
   * surface without being checked at each one.
   */
  const stopShift = (na: number) => {
    const o = objectiveAt("rim", { numericalAperture: na });
    const a = o.airEquivalentObjectDistanceMm;
    const y = a * tanOf(na);
    const sums = seidelSums(o.prescription, L, {
      marginalHeightMm: y,
      objectDistanceMm: a,
      fieldAngleRad: -H / a,
    });
    const toWaves = (mm: number) => mm / (L * 1e-6);
    return {
      E: H / y,
      w131: toWaves(sums.s2 / 2),
      w222: toWaves(sums.s3 / 2),
      dW222: toWaves((H / y) * sums.s2),
      s1: sums.s1,
      focalRatio: o.focalLengthMm / (2 * y),
    };
  };

  it("EXTERNAL: the traced coefficients converge onto the closed forms as the aperture closes", () => {
    // Welford's stop-shift algebra is the external statement and the trace is the
    // check. The ratios go to −1, the minus being `pupil/opd`'s sign convention
    // (positive OPD = the ray LAGS) against Welford's W, and the approach is
    // quadratic in NA because what is left over is fifth order.
    const ratios: number[] = [];
    for (const na of [0.1, 0.05, 0.025, 0.0125]) {
      const pred = stopShift(na);
      const rim = fitAt("rim", na);
      const tele = fitAt("backFocal", na);
      ratios.push(rim.w131 / pred.w131);
      if (na === 0.0125) {
        expect(rim.w131 / pred.w131).toBeCloseTo(-1, 2);
        expect(rim.w222 / pred.w222).toBeCloseTo(-1, 3);
        // The astigmatism the shift ADDS is the equation's own term, 2E·S_II over
        // two — the only third-order coefficient this shift moves at all, since
        // S_I is nulled and S_IV depends on no ray heights.
        expect((tele.w222 - rim.w222) / pred.dW222).toBeCloseTo(-1, 2);
      }
    }
    // Monotone convergence, not one lucky aperture.
    for (let i = 1; i < ratios.length; i++) {
      expect(Math.abs(ratios[i]! + 1)).toBeLessThan(Math.abs(ratios[i - 1]! + 1));
    }
  });

  it("the residual spherical is ENTIRELY fifth order — the ρ⁴ projection falls as NA⁶", () => {
    // Why the convergence above is quadratic, and the premise of the finding
    // below. ΣS_I is zero to solver precision at every aperture, so the ρ⁴ term
    // the fit reports is the projection of a ρ⁶ one: 7.51e-1, 1.09e-2, 1.67e-4,
    // 2.65e-6 waves, ratios 69, 65, 63 against 2⁶ = 64.
    const q: number[] = [];
    for (const na of [0.1, 0.05, 0.025, 0.0125]) {
      expect(Math.abs(stopShift(na).s1)).toBeLessThan(1e-12);
      q.push(fitAt("rim", na).quartic);
    }
    for (let i = 1; i < q.length; i++) {
      expect(q[i - 1]! / q[i]!).toBeGreaterThan(56);
      expect(q[i - 1]! / q[i]!).toBeLessThan(72);
    }
  });

  it("THE FINDING: third order says the shift costs no coma, and at f/4 it moves 71% of it", () => {
    // S_II* = S_II + E·S_I, and S_I = 0 — so the classical answer is that a stop
    // shift on this lens leaves the coma exactly alone. It does, in the limit,
    // and it does NOT at the aperture the catalogued 4×/0.10 works at: the
    // induced coma rides on the FIFTH-order spherical, so it falls as NA⁵ where
    // the coma itself falls as NA³, and the two cross over inside the objective's
    // own working range.
    const share: number[] = [];
    for (const na of [0.1, 0.05, 0.025, 0.0125]) {
      const rim = fitAt("rim", na);
      const tele = fitAt("backFocal", na);
      share.push(Math.abs((tele.w131 - rim.w131) / rim.w131));
    }
    expect(share[0]!).toBeCloseTo(0.706, 2); // f/4.08 — the shipped objective
    expect(share[3]!).toBeLessThan(0.01); // f/32 — the classical limit
    // Each halving of the aperture takes about a factor 4 out of the share, which
    // is the NA⁵-against-NA³ statement in the form the rung can check.
    for (let i = 1; i < share.length; i++) {
      expect(share[i - 1]! / share[i]!).toBeGreaterThan(3.5);
      expect(share[i - 1]! / share[i]!).toBeLessThan(5);
    }
  });

  it("…and the trade it makes is coma for astigmatism, in that direction", () => {
    const rim = fitAt("rim", NA);
    const tele = fitAt("backFocal", NA);
    // 0.283 → 0.083 waves of coma, 0.0129 → 0.0308 of astigmatism, at a quarter
    // millimetre of object height on the shipped 4×/0.10.
    expect(Math.abs(rim.w131) / Math.abs(tele.w131)).toBeCloseTo(3.4, 1);
    expect(Math.abs(tele.w222) / Math.abs(rim.w222)).toBeCloseTo(2.4, 1);
  });

  it("…and the net, in the currency the image is formed in: 1.9× less wavefront at 1 mm", () => {
    const grid21 = pupilGrid(21);
    const rms = (p: StopPlacement, h: number) => opdMap(scopeAt(p).system, h, L, grid21).rmsWaves;
    // Coma is the bigger term on this lens, so trading it away wins. The claim is
    // the ORDERING and its growth with field, not the two numbers.
    expect(rms("rim", 0.5) / rms("backFocal", 0.5)).toBeCloseTo(1.54, 1);
    expect(rms("rim", 1) / rms("backFocal", 1)).toBeCloseTo(1.94, 1);
    expect(rms("backFocal", 1)).toBeCloseTo(0.2036, 3);
  });
});

describe("§ 6ae.6 — what it costs: the bundle translates, and a field number pays for it", () => {
  /** Fraction of an aimed pupil grid that survives to the image, at field h. */
  const throughput = (s: { system: OpticalSystem }, h: number): number => {
    const b = exitBundle(s.system, h, L, pupilGrid(21));
    return b.rays.length / (b.rays.length + b.lost);
  };

  it("passes the whole pupil on axis, and the rim placement passes it everywhere", () => {
    // The control, and it is the whole reason the cost exists: a rim stop pivots
    // every bundle through surface 0, so the footprint on the glass never moves.
    for (const h of [0, 0.25, 1, 2.25]) expect(throughput(scopeAt("rim"), h)).toBe(1);
    expect(throughput(scopeAt("backFocal"), 0)).toBe(1);
  });

  it("but a telecentric bundle walks off glass sized for the axial pencil", () => {
    const tele = scopeAt("backFocal");
    expect(throughput(tele, 1)).toBeCloseTo(0.9521, 3);
    expect(throughput(tele, 2.25)).toBeCloseTo(0.7859, 3);
    // Monotone, and these are THIS lens's numbers: the pencil goes as the object
    // distance and a field is absolute, so they do not travel to another power.
    expect(throughput(tele, 2.25)).toBeLessThan(throughput(tele, 1));
  });

  it("`fieldNumberMm` restores the rays exactly to its own edge (§ 6w's formula, here)", () => {
    for (const fieldNumberMm of [4, 10, 18]) {
      const s = scopeAt("backFocal", { fieldNumberMm });
      const edge = fieldNumberMm / (2 * 4);
      expect(throughput(s, edge)).toBe(1);
      expect(s.objective.fieldNumberMm).toBe(fieldNumberMm);
    }
    // …and it is the field walk that is being paid for, not slack: FN 4 is sized
    // for 0.5 mm and still loses rays at 1 mm.
    expect(throughput(scopeAt("backFocal", { fieldNumberMm: 4 }), 1)).toBeLessThan(1);
  });

  it("and the price is a much faster element, a longer tube and a shorter working distance", () => {
    const bare = objectiveAt("backFocal");
    const wide = objectiveAt("backFocal", { fieldNumberMm: 18 });
    const semi = (o: typeof bare) => o.doublet.prescription.surfaces[0]!.semiAperture;
    expect(semi(wide) / semi(bare)).toBeCloseTo(1.4185, 3);
    expect(wide.freeWorkingDistanceMm).toBeLessThan(bare.freeWorkingDistanceMm);
    expect(bare.freeWorkingDistanceMm - wide.freeWorkingDistanceMm).toBeCloseTo(1.112, 2);
    // Thicker glass moves the principal planes, so the tube length moves too — and
    // the delivered aperture survives only because it is re-derived on the lens
    // actually built (§ 6w.4's coupling, at these conjugates).
    expect(wide.tracedOpticalTubeLengthMm - bare.tracedOpticalTubeLengthMm).toBeCloseTo(0.884, 2);
    expect(wide.stopRadiusMm).toBe(Math.abs(wide.paraxialFocalLengthMm) * tanOf(NA));
  });

  it("THE HONEST HALF: the rays arrive at 2.25 mm and the lens is not usable there", () => {
    // A field number buys the aperture and buys nothing else. At an 18 mm field
    // number's own edge the doublet carries 0.65 waves RMS — 8.7× Maréchal's
    // 0.0745 — so a single cemented doublet is not a field lens, and sizing its
    // glass for one does not make it one. § 6d's Lister is the answer to this and
    // this rung is what says so with a number.
    const wide = scopeAt("backFocal", { fieldNumberMm: 18 });
    const grid = pupilGrid(21);
    expect(opdMap(wide.system, 0, L, grid).rmsWaves).toBeCloseTo(0.1374, 3);
    expect(opdMap(wide.system, 2.25, L, grid).rmsWaves).toBeCloseTo(0.6517, 2);
    expect(opdMap(wide.system, 2.25, L, grid).rmsWaves / 0.0745).toBeGreaterThan(8);
  });

  it("walls out where the cemented doublet does, and the refusal names BOTH inputs", () => {
    // § 6b.5.5's rule — a refusal says what to change — and here there are two
    // things to change, because the glass is the pencil plus the walk against a
    // focal length that grows with neither. FN 40 still builds, at f/1.88.
    expect(() => objectiveAt("backFocal", { fieldNumberMm: 40 })).not.toThrow();
    let message = "";
    try {
      objectiveAt("backFocal", { fieldNumberMm: 60 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("field number 60 mm");
    expect(message).toContain("of held-back pencil");
    expect(message).toContain("of field walk");
  });

  it("REFUSES a field number on the rim placement rather than silently ignoring it", () => {
    // Same refusal and same reason as § 6w's: a rim-stopped footprint does not
    // translate, so there is nothing for a field number to size — and sizing past
    // the rim would decouple surface 0 from the rim it is named for, which is the
    // one thing the negative control has to keep.
    expect(() => objectiveAt("rim", { fieldNumberMm: 18 })).toThrow(/rim.*does not/s);
    expect(() => objectiveAt("backFocal", { fieldNumberMm: 0 })).toThrow(/positive length/);
  });
});

describe("§ 6ae.7 — § 6x's illumination offset, sent to zero on purpose", () => {
  it("is exactly 0 at every field height, where the rim's is 0.217 per millimetre", () => {
    // The deferral § 6x recorded, closed in the direction § 6x predicted: the
    // Köhler cone reaches the objective's pupil displaced by `h/R_ep`, and
    // telecentricity is R_ep = ∞ and nothing else. This is the rung that would
    // have quietly become vacuous had the default moved instead, which is why
    // § 6x's own fixture now says "rim" by name.
    const tele = scopeAt("backFocal").system;
    const rim = scopeAt("rim").system;
    for (const h of [0, 0.25, 0.5, 1]) {
      expect(illuminationOffset(tele, h, L)).toBe(0);
    }
    expect(illuminationOffset(rim, 0, L)).toBe(0);
    expect(illuminationOffset(rim, 1, L)).toBeCloseTo(0.21736, 5);
    // Linear in the field, which is what `h/R_ep` says and what makes the zero a
    // statement about R_ep rather than about the height chosen to test it.
    expect(illuminationOffset(rim, 0.25, L) * 4).toBeCloseTo(illuminationOffset(rim, 1, L), 12);
  });
});
