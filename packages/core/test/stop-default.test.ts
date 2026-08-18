import { describe, expect, it } from "vitest";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  type StopPlacement,
} from "../src/designs/microscope";
import { pupils } from "../src/pupil/pupils";
import { seidelSums } from "../src/analysis/seidel";
import { imageRadiusForObjectHeight } from "../src/imaging/object-field";
import type { OpticalSystem } from "../src/trace/system";

/**
 * Step 6ai — the finite conjugate's default stop placement, flipped.
 *
 * **The physics is § 6ae's and none of it is repeated here.** That step built the
 * back-focal diaphragm on `finiteConjugateObjective`, checked it against
 * Welford's stop-shift algebra, sent § 6x's illumination offset to zero, and
 * measured what a translating bundle costs a lens sized for the axial pencil. It
 * left one thing undone, in as many words: the placement was reachable and was
 * not the default, so nothing a caller got by default was telecentric.
 *
 * This step is that flip, and it has exactly two things to pin that § 6ae could
 * not.
 *
 * ## 1. The default itself
 *
 * A test that constructs `stopPlacement: "backFocal"` explicitly says nothing
 * about what an omitted argument does, and § 6ae's rungs all construct both.
 * § 6ai.1 asks the question the other way round — what does a caller who writes
 * no placement get — and answers it bitwise, at four magnifications, through the
 * objective and through the composed microscope.
 *
 * ## 2. The one lever the rest of the branch reads
 *
 * § 6ae.5 pins the third-order WAVEFRONT coefficients against the closed forms.
 * What every downstream reading in § 6h–§ 6ag actually carries is the traced
 * IMAGE-HEIGHT map, r = |M|·h + D·h³, and the flip multiplies D by −70.7.
 *
 * **That factor is a closed form and not this lens's own number**, which is what
 * makes it worth a step. The sign is the textbook rule — a stop in front of a
 * lens gives barrel and a stop behind it gives pincushion — and the SIZE is
 * Welford's distortion stop-shift equation, S_V* = S_V + E(3S_III + S_IV) +
 * 3E²S_II + E³S_I, evaluated entirely on the rim member (whose stop is surface
 * 0, so the Seidel sums are available) with the E³ term vanishing because the
 * doublet is solved to ΣS_I = 0. It predicts −70.7001; the traced ray reads
 * −70.7169. Two machineries, 0.024% apart.
 *
 * That one factor is why the flip's cost was re-reading rather than re-deriving.
 * Every rung in § 6n reads a derivative of this map, so every one of them moved
 * by 70.7 and none of them changed order; every rung in § 6s is a truncation
 * error on the same map's inverse, and since a cubic interpolant reproduces a
 * cubic exactly what they measure is the QUINTIC — which the same shift
 * multiplies by 2 600, so their tables grew by 2 600^(1/4) = 7.1 in node count
 * and by nothing else. Both are measured where they live, beside the rungs that
 * already state their laws.
 *
 * ## What moved, and where to read it
 *
 * The findings live with the laws they qualify rather than being collected here:
 * § 6m.4 and § 6n for the distortion, § 6s for the table sizes, § 6r.8–§ 6r.9 for
 * the chromatic ones (a telecentric dry objective has a chromatic NA, and is
 * telecentric only at its design wavelength), § 6t.3 for the transverse scale
 * becoming exactly proportional to λ, § 6ag.3–§ 6ag.6 for the illumination cone
 * arriving centred at every field, and § 5u.7 for the second parfocal floor a
 * diaphragm standing a focal length behind the glass creates.
 */

const L = 587.5618;

const objectiveAt = (stopPlacement?: StopPlacement, magnification = 4) =>
  finiteConjugateObjective({
    magnification,
    numericalAperture: 0.1,
    ...(stopPlacement === undefined ? {} : { stopPlacement }),
  });

describe("§ 6ai.1 — the default is telecentric, and `\"rim\"` is still reachable", () => {
  it("an omitted `stopPlacement` builds the back-focal member, at four magnifications", () => {
    // The change itself, asked from the caller's side. Every § 6ae rung names
    // its placement, so all of them would still pass with the default pointing
    // at the other member — which is exactly the state this step ends.
    for (const magnification of [4, 10, 20, 40]) {
      const defaulted = objectiveAt(undefined, magnification);
      const named = objectiveAt("backFocal", magnification);
      const old = objectiveAt("rim", magnification);

      expect(defaulted.stopPlacement).toBe("backFocal");
      expect(defaulted.stopRadiusMm).toBe(named.stopRadiusMm);
      expect(defaulted.stopDistanceMm).toBe(named.stopDistanceMm);
      expect(defaulted.stopSurfaceIndex).toBe(named.stopSurfaceIndex);

      // …and it is NOT the old one, which is the half that would go unnoticed if
      // the two happened to agree on the numbers above.
      expect(defaulted.stopPlacement).not.toBe(old.stopPlacement);
      expect(defaulted.stopRadiusMm).not.toBe(old.stopRadiusMm);
      expect(old.stopDistanceMm).toBe(0);
      expect(defaulted.stopDistanceMm).toBeGreaterThan(0);
      // The diaphragm is an extra surface, so the prescription is a surface
      // longer and the stop is the last one rather than the first.
      expect(defaulted.prescription.surfaces.length).toBe(old.prescription.surfaces.length + 1);
      expect(defaulted.stopSurfaceIndex).toBe(defaulted.prescription.surfaces.length - 1);
      expect(old.stopSurfaceIndex).toBe(0);
    }
  });

  it("and the composed microscope inherits it — the entrance pupil is at infinity", () => {
    // The composition is where a default can be lost: `finiteConjugateMicroscope`
    // appends a tube lens, and a chain that re-declared its own aperture would
    // hand back a system that is not the objective's. Read off the pupil solve
    // rather than off the spec, so it is the composed system being asked.
    const shipped = finiteConjugateMicroscope({ objective: objectiveAt() }).system;
    const entrance = pupils(shipped, L).entrance;
    expect(entrance.z).toBe(-Infinity);
    expect(entrance.radius).toBe(Infinity);

    // The old default, still reachable and still finite, which is what makes the
    // whole branch's before-and-after a comparison rather than a memory.
    const rim = finiteConjugateMicroscope({ objective: objectiveAt("rim") }).system;
    expect(pupils(rim, L).entrance.z).toBe(0);
    expect(Number.isFinite(pupils(rim, L).entrance.radius)).toBe(true);
  });
});

describe("§ 6ai.2 — stop in front, barrel; stop behind, pincushion", () => {
  /** The traced map's departure from a straight magnification, r − |M|·h. */
  const departure = (system: OpticalSystem, h: number): number => {
    const m = imageRadiusForObjectHeight(system, 1e-6, L) / 1e-6;
    return imageRadiusForObjectHeight(system, h, L) - m * h;
  };

  const SHIPPED = finiteConjugateMicroscope({ objective: objectiveAt() }).system;
  const RIM = finiteConjugateMicroscope({ objective: objectiveAt("rim") }).system;

  it("EXTERNAL: the sign flips, and it is a traced ray that says so", () => {
    // The textbook stop-shift sign rule, on the quantity a picture is made of.
    // Negative departure is local magnification falling with field, which is
    // barrel; positive is pincushion. Nothing about the glass changed between
    // these two calls — § 6ae.4 pins that the bending does not move — so the sign
    // is the diaphragm's and can be nothing else.
    for (const h of [0.4, 0.8, 1.6, 3.2]) {
      expect(departure(RIM, h)).toBeLessThan(0);
      expect(departure(SHIPPED, h)).toBeGreaterThan(0);
    }
    // Both are a CUBE in field, which is what makes the comparison meaningful:
    // an eight-fold in h is a 512-fold in departure, on each member separately.
    for (const system of [RIM, SHIPPED]) {
      const values = [0.4, 0.8, 1.6, 3.2].map((h) => departure(system, h));
      for (let i = 1; i < values.length; i++) {
        expect(Math.abs(values[i]! / values[i - 1]! / 8 - 1)).toBeLessThan(0.05);
      }
      expect(Math.abs(values[values.length - 1]! / values[0]!)).toBeGreaterThan(400);
    }
  });

  it("and the size is ONE number — 70.7, flat over eight-fold in field", () => {
    // The claim the rest of the branch rests on. If the lever varied with field
    // the flip would have re-shaped the map and every downstream rung would have
    // needed re-deriving; because it does not, they needed re-reading, and the
    // ones that pin an ORDER did not move at all.
    const lever = [0.4, 0.8, 1.6, 3.2].map((h) => departure(SHIPPED, h) / departure(RIM, h));
    for (const value of lever) {
      expect(value).toBeLessThan(0);
      expect(Math.abs(value / -70.7 - 1)).toBeLessThan(1.5e-2);
    }
    expect(lever[0]!).toBeCloseTo(-70.72, 1);
    // Flat: the whole eight-fold sweep moves it by 1.5%, which is the h⁵ term
    // showing through and not a second lever.
    expect(Math.abs(lever[lever.length - 1]! / lever[0]! - 1)).toBeLessThan(1.6e-2);
  });

  it("EXTERNAL: and 70.7 is a CLOSED FORM — Welford's S_V shift, confirmed to 0.024%", () => {
    // The number stops being this lens's own here. Welford's stop-shift equation
    // for distortion is
    //
    //     S_V* = S_V + E(3·S_III + S_IV) + 3E²·S_II + E³·S_I
    //
    // with E the eccentricity of the shift — the change in the chief ray's
    // height over the marginal ray's. Everything on the right belongs to the RIM
    // member, whose stop IS surface 0, so `seidelSums` computes it without
    // needing the telecentric lens at all. The last term vanishes because the
    // doublet is solved to ΣS_I = 0 (§ 6b), which is why the cubic in E never
    // appears.
    //
    // It predicts −70.7001, and it predicts the same −70.7001 at three field
    // heights — E goes as h and S_V as h³, so the RATIO must be field-free, and
    // that it comes out so is the check that E was formed correctly. The traced
    // map above reads −70.7169 at 0.4 mm. Two machineries, 0.024% apart, and the
    // third-order one knows nothing about the ray that confirms it.
    const rim = objectiveAt("rim");
    const a = rim.airEquivalentObjectDistanceMm;
    const marginalHeightMm = a * (0.1 / Math.sqrt(1 - 0.01));
    const predictedAt = (H: number): number => {
      const s = seidelSums(rim.prescription, L, {
        marginalHeightMm,
        objectDistanceMm: a,
        fieldAngleRad: -H / a,
        distortion: true,
      });
      const E = H / marginalHeightMm;
      // ΣS_I is zero by construction, so the E³ term is not merely small.
      expect(Math.abs(s.s1)).toBeLessThan(1e-15);
      const shifted = s.s5! + E * (3 * s.s3 + s.s4) + 3 * E * E * s.s2 + E * E * E * s.s1;
      return shifted / s.s5!;
    };
    const predictions = [0.25, 0.5, 1].map(predictedAt);
    for (const value of predictions) {
      expect(value).toBeCloseTo(-70.7001, 3);
      // Field-free, which is what says E was formed as a ratio and not as a
      // height: the three agree to twelve figures.
      expect(Math.abs(value / predictions[0]! - 1)).toBeLessThan(1e-12);
    }

    const traced = departure(SHIPPED, 0.4) / departure(RIM, 0.4);
    expect(Math.abs(traced / predictions[0]! - 1)).toBeLessThan(3e-4);
  });

  it("…while the paraxial magnification it is a departure FROM does not move", () => {
    // The control that makes the two rungs above about the distortion rather
    // than about a lens that was quietly re-solved. § 6ae.4 says the bending is
    // untouched; this says the map's linear term is too, which is the part a
    // reader of § 6n's numbers needs.
    const m = (system: OpticalSystem) => imageRadiusForObjectHeight(system, 1e-6, L) / 1e-6;
    expect(Math.abs(m(SHIPPED) / m(RIM) - 1)).toBeLessThan(1e-12);
    expect(m(SHIPPED)).toBeCloseTo(4, 10);
    // And on the axis there is nothing to be a departure of, on either member.
    expect(imageRadiusForObjectHeight(SHIPPED, 0, L)).toBe(0);
    expect(imageRadiusForObjectHeight(RIM, 0, L)).toBe(0);
  });
});
