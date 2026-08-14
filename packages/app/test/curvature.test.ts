import { describe, it, expect } from "vitest";
import { fieldCurvature, type CurvatureSpec } from "../src/curvature";
import { mtfCurves } from "../src/mtf";

/**
 * The field-curvature and distortion panel — ROADMAP's v1 analyses line, and the
 * entry that line twice recorded as already having a surface.
 *
 * The engine half landed as VALIDATION § 6ac and carries 22 rungs of its own
 * against Welford's closed forms. This file pins the WIRING and the four things
 * the panel says on screen that no ladder rung states, because they are
 * statements about the two lenses this app ships rather than about the physics:
 *
 *  1. the achromat — which fixes this app's colour and its spherical aberration
 *     — does not flatten the field, and on the Petzval surface makes it worse,
 *  2. the third-order surfaces have no aperture in them and the traced ones do,
 *     by an amount that is 16× larger on the singlet and that changes SIGN
 *     across the panel's own aperture slider,
 *  3. traced distortion on these lenses is parts per million, agrees with the
 *     S_V cubic at that level, and would have been swamped 200–900× over by the
 *     one plane choice the module refuses to accept, and
 *  4. the `lost` guard the engine documents as invalidating the sags fires on
 *     the app's own default lens, and the sag is unmoved against a stopped-down
 *     control — which is a control, not an explanation.
 *
 * The spec below is the panel's own defaults, so a change that makes the default
 * view wrong fails here rather than being found by opening the page.
 */

const SPEC: CurvatureSpec = {
  lens: "achromat",
  focalLengthMm: 1000,
  apertureMm: 100,
  sourceTemperatureK: 5800,
  wavelengths: 5,
  wavelengthNm: 587.5618,
  maxFieldDeg: 1.6,
  fieldSteps: 13,
  fanSamples: 41,
};

const run = (patch: Partial<CurvatureSpec> = {}) => fieldCurvature({ ...SPEC, ...patch });

describe("the curved field — the two surfaces themselves", () => {
  /**
   * Sign, which a ratio cannot check. Both surfaces bend toward the lens and the
   * tangential is the further of the two; a panel drawing either the other way
   * up would be drawing a lens that does not exist, and § 6ac's own header says
   * this is the failure a 3:1 assertion alone would pass through.
   */
  it("puts both surfaces inside focus, tangential furthest, and exactly zero on axis", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      const r = run({ lens });
      expect(r.samples[0]!.fieldDeg).toBe(0);
      expect(r.samples[0]!.tangentialSagMm).toBe(0);
      expect(r.samples[0]!.sagittalSagMm).toBe(0);
      for (const s of r.samples.slice(1)) {
        expect(s.tangentialSagMm, `${lens} t at ${s.fieldDeg}`).toBeLessThan(0);
        expect(s.sagittalSagMm, `${lens} s at ${s.fieldDeg}`).toBeLessThan(0);
        expect(s.tangentialSagMm).toBeLessThan(s.sagittalSagMm);
        expect(s.petzvalMm).toBeGreaterThan(s.sagittalSagMm);
      }
    }
  });

  /**
   * The identity the plot is drawn to display: x_t − x_p = 3(x_s − x_p) falls
   * straight out of Welford's two expressions, so a TRACED tangential and a
   * TRACED sagittal measured against a CLOSED-FORM Petzval must land on 3. They
   * are three different machineries and nothing forces the agreement.
   *
   * 3.0135 on the singlet and 2.9969 on the achromat at the panel's defaults.
   */
  it("lands the traced surfaces on the third order's 3:1, from three machineries", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      for (const maxFieldDeg of [0.4, 1.6, 3]) {
        const r = run({ lens, maxFieldDeg });
        expect(r.petzvalRatio, `${lens} at ${maxFieldDeg}°`).toBeGreaterThan(2.95);
        expect(r.petzvalRatio, `${lens} at ${maxFieldDeg}°`).toBeLessThan(3.05);
      }
    }
  });

  /**
   * The panel's headline, and the reason it computes both lenses on every frame.
   *
   * The achromat corrects this app's colour and its spherical aberration and
   * does nothing for field curvature: at 1.6° its tangential surface is 1.6%
   * FURTHER inside focus than the singlet's, and its Petzval surface — the part
   * no astigmatism balancing can move, being a sum of element powers over their
   * indices — is 8% further. Pinned in the direction as well as the magnitude,
   * because "the corrected lens is worse here" is the whole claim and a sign
   * flip would read as the opposite lesson.
   */
  it("shows the achromat failing to flatten the field, and making Petzval worse", () => {
    const singlet = run({ lens: "singlet" });
    const achromat = run({ lens: "achromat" });

    expect(achromat.edge.tangentialSagMm).toBeLessThan(singlet.edge.tangentialSagMm);
    expect(achromat.edge.petzvalMm).toBeLessThan(singlet.edge.petzvalMm);

    const tangentialWorseBy = achromat.edge.tangentialSagMm / singlet.edge.tangentialSagMm - 1;
    const petzvalWorseBy = achromat.edge.petzvalMm / singlet.edge.petzvalMm - 1;
    expect(tangentialWorseBy).toBeGreaterThan(0.005);
    expect(tangentialWorseBy).toBeLessThan(0.03);
    expect(petzvalWorseBy).toBeGreaterThan(0.05);
    expect(petzvalWorseBy).toBeLessThan(0.12);
  });

  /**
   * The comparison the headline is quoted against, pinned from the OTHER panel's
   * adapter so that the sentence and the number cannot drift apart.
   *
   * The panel says on screen that these two lenses are 383× apart on Strehl and
   * within 2% on the curved field. The first half is not `fieldCurvature`'s to
   * report — nothing in this module computes a Strehl — so it is read here off
   * `mtfCurves` at the same geometry. Without this rung the claim is a sentence
   * in a caption, which is exactly the defect the commit before this panel fixed
   * elsewhere in APP.md.
   */
  it("pins the Strehl comparison the headline is quoted against", () => {
    const strehl = (lens: "singlet" | "achromat") =>
      mtfCurves({
        lens,
        focalLengthMm: 1000,
        apertureMm: 100,
        sourceTemperatureK: 5800,
        wavelengths: 5,
        fieldDeg: 0,
        wavelengthNm: 587.5618,
        traceSamples: 31,
        bins: 81,
      }).strehl;

    const singlet = strehl("singlet");
    const achromat = strehl("achromat");
    expect(singlet).toBeCloseTo(0.0026, 3);
    expect(achromat).toBeCloseTo(0.9826, 3);
    // 383× on the quantity the achromat exists to fix...
    expect(achromat / singlet).toBeGreaterThan(300);
    // ...and within 2% on the one it does not.
    const sags = (["singlet", "achromat"] as const).map(
      (lens) => run({ lens }).edge.tangentialSagMm,
    );
    expect(Math.abs(sags[1]! / sags[0]! - 1)).toBeLessThan(0.02);
  });

  /**
   * The chromatic half of the same headline, which is the part the achromat DID
   * fix: its Petzval sag moves 0.26% across the F-to-C band against the
   * singlet's 2.1%. The correction reached this aberration — it made the curved
   * field the same curved field at every colour.
   */
  it("shows the achromat holding the same curved field at every wavelength", () => {
    const spread = (lens: "singlet" | "achromat") => {
      const sags = [486.1327, 587.5618, 656.2725].map(
        (wavelengthNm) => run({ lens, wavelengthNm }).edge.petzvalMm,
      );
      return (Math.max(...sags) - Math.min(...sags)) / Math.abs(sags[1]!);
    };
    const singlet = spread("singlet");
    const achromat = spread("achromat");
    expect(achromat).toBeLessThan(singlet / 4);
    expect(singlet).toBeGreaterThan(0.01);
    expect(achromat).toBeLessThan(0.01);
  });
});

describe("the curved field — what has an aperture in it", () => {
  /**
   * The panel's second claim. x_s, x_t and x_p are ratios of Seidel sums to
   * n′u′² and the aperture cancels identically; the traced surfaces are where a
   * real fan's spot is smallest, and that does not.
   *
   * The panel says only this much on screen — an aperture dependence, measured —
   * and deliberately does not name an aberration, because the measurement behind
   * it did not reach one.
   */
  it("holds the third-order surfaces exactly fixed while the traced ones move", () => {
    const apertures = [20, 40, 60, 100, 120];
    for (const lens of ["singlet", "achromat"] as const) {
      const runs = apertures.map((apertureMm) => run({ lens, apertureMm }));
      const predicted = runs.map((r) => r.edge.thirdOrderTangentialMm);
      for (const p of predicted) expect(p).toBeCloseTo(predicted[0]!, 9);

      const traced = runs.map((r) => r.edge.tangentialSagMm);
      const swing = (Math.max(...traced) - Math.min(...traced)) / Math.abs(traced[0]!);
      if (lens === "singlet") expect(swing).toBeGreaterThan(0.004);
      else expect(swing).toBeLessThan(0.001);
    }
  });

  /**
   * And the part that makes the panel warn a reader off reading agreement as a
   * check: on the singlet the traced tangential surface crosses the closed form
   * somewhere inside the panel's own aperture slider, so at one setting the two
   * curves lie on top of each other while meaning nothing by it.
   */
  it("has a singlet departure that changes sign across the aperture slider", () => {
    const narrow = run({ lens: "singlet", apertureMm: 20 }).tangentialDeparture;
    const wide = run({ lens: "singlet", apertureMm: 120 }).tangentialDeparture;
    expect(narrow).toBeLessThan(0);
    expect(wide).toBeGreaterThan(0);
    expect(Math.abs(wide)).toBeGreaterThan(10 * Math.abs(narrow));
  });

  /**
   * The `lost` guard, which the engine documents as invalidating the sags and
   * which fires on the app's own default lens — Part B's aperture wall, the
   * crown closing on itself, reached here from the field side rather than the
   * MTF page's frequency side.
   *
   * The control is the whole point: the same edge field at an aperture that
   * loses nothing agrees to 2e-4. That says the truncation did not move this
   * number. It is not evidence about WHY, and the panel says so.
   */
  it("fires the loss guard on the shipped doublet and controls it against a clean aperture", () => {
    const achromat = run({ lens: "achromat" });
    expect(achromat.maxLost).toBeGreaterThan(0);
    expect(achromat.controlApertureMm).toBeLessThan(SPEC.apertureMm);
    expect(achromat.controlLost).toBe(0);
    expect(Math.abs(achromat.controlDeparture)).toBeLessThan(1e-3);

    // The same glass pair's singlet never closes inside this aperture, so the
    // guard stays quiet and there is nothing to control — without it, "the loss
    // is harmless" would be consistent with a tracer that always loses rays.
    const singlet = run({ lens: "singlet" });
    expect(singlet.maxLost).toBe(0);
    expect(singlet.controlApertureMm).toBe(SPEC.apertureMm);
    expect(singlet.controlDeparture).toBe(0);
  });

  /**
   * What the curvature costs a flat detector, which is the panel's practical
   * section. At f/10 the corner of a ±1.6° frame is twelve quarter-wave depths
   * of focus outside the plane the axis is sharp on, for BOTH lenses within 3%;
   * at f/25 it is two. Stopping down fixes it without flattening anything,
   * because the depth of focus grows as the focal ratio squared while these
   * surfaces barely move with aperture at all.
   */
  it("puts the corner twelve depths of focus out at f/10 and two at f/25", () => {
    const fast = ["singlet", "achromat"].map((lens) =>
      run({ lens: lens as "singlet" | "achromat" }),
    );
    for (const r of fast) {
      expect(r.cornerDepths).toBeGreaterThan(10);
      expect(r.cornerDepths).toBeLessThan(15);
      // Even the best flat plane available leaves a real miss behind it.
      expect(r.flatPlaneWorstDepths).toBeGreaterThan(3);
    }
    // The two lenses agree about it, which is the headline restated in the
    // units a reader can act on.
    expect(Math.abs(fast[0]!.cornerDepths / fast[1]!.cornerDepths - 1)).toBeLessThan(0.03);

    const slow = run({ apertureMm: 40 });
    expect(slow.cornerDepths).toBeLessThan(2.5);
    expect(slow.flatPlaneWorstDepths).toBeLessThan(1);
  });
});

describe("the curved field — distortion, and the plane it is read at", () => {
  /**
   * Two disjoint machineries at the ppm level: an exactly traced skew ray
   * against a paraxial y–u recursion through the Seidel sums. The residual is
   * the fifth-order term, so it grows as the square of the field — which is what
   * separates "these agree" from "these are the same code".
   */
  it("agrees with the S_V cubic, with a residual that grows as field squared", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      const near = run({ lens, maxFieldDeg: 0.8 });
      const far = run({ lens, maxFieldDeg: 1.6 });
      expect(Math.abs(near.distortionDeparture)).toBeLessThan(1e-3);
      expect(Math.abs(far.distortionDeparture)).toBeLessThan(1e-3);
      // Field doubled, residual quadrupled.
      const grew = Math.abs(far.distortionDeparture) / Math.abs(near.distortionDeparture);
      expect(grew, `${lens}`).toBeGreaterThan(3.5);
      expect(grew, `${lens}`).toBeLessThan(4.5);
    }
  });

  /**
   * Barrel, which is the direction a stop ahead of a positive lens gives, and
   * parts per million, which is why the panel's axis is in ppm rather than
   * percent. Both lenses put the stop at the front vertex, so both are barrel.
   */
  it("is barrel, and is parts per million rather than percent", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      const r = run({ lens });
      expect(r.edge.distortionPpm).toBeLessThan(0);
      expect(Math.abs(r.edge.distortionPpm)).toBeLessThan(10);
      expect(Math.abs(r.edge.distortionPpm)).toBeGreaterThan(0.1);
      // On axis a chief ray lands on the axis: 0, not the 0/0 the ratio is.
      expect(r.samples[0]!.distortionPpm).toBe(0);
      expect(r.samples[0]!.thirdOrderDistortionPpm).toBe(0);
      for (const s of r.samples) expect(Number.isFinite(s.distortionPpm)).toBe(true);
    }
  });

  /** A chief-ray property: opening the lens up does not move it at all. */
  it("does not move with aperture", () => {
    const narrow = run({ apertureMm: 40 }).edge.distortionPpm;
    const wide = run({ apertureMm: 100 }).edge.distortionPpm;
    expect(narrow).toBeCloseTo(wide, 9);
  });

  /**
   * What the module's refusal is worth on THIS app's lenses. `distortionProfile`
   * chooses the paraxial image plane itself and will not accept one, because the
   * chief ray is a straight line in image space and reading it at a plane Δz away
   * multiplies every height by roughly (1 + Δz/f) — a constant relative error
   * with no field dependence, which is not a shape any distortion has.
   *
   * § 6ac measured that lever at 13× the signal on its own fixture. Here it is
   * 218× on the achromat and 942× on the singlet, so a panel allowed to pick its
   * own plane would have drawn a curve that was three orders of magnitude
   * defocus.
   */
  it("measures the defocus lever the engine refuses at 200–1000× the signal", () => {
    expect(run({ lens: "achromat" }).defocusLeverRatio).toBeGreaterThan(100);
    expect(run({ lens: "singlet" }).defocusLeverRatio).toBeGreaterThan(500);
    // The lever is the two planes being different, so it must not be zero on a
    // lens that has any spherical aberration left at all.
    for (const lens of ["singlet", "achromat"] as const) {
      const r = run({ lens });
      expect(Math.abs(r.paraxialZ - r.axialZ)).toBeGreaterThan(0.01);
    }
  });
});

describe("the curved field — the panel's own corners", () => {
  /**
   * Every corner of the panel's control ranges, because both closed forms refuse
   * outright rather than degrading — `thirdOrderSags` throws on a finite
   * conjugate or a stop that is not at the first surface, and `seidelSums`
   * throws on A = 0 — and a panel that reaches one of those refusals is a blank
   * page rather than a wrong number.
   */
  it("returns finite numbers everywhere the sliders can go", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      for (const focalLengthMm of [400, 2000]) {
        for (const apertureMm of [20, 120]) {
          for (const maxFieldDeg of [0.4, 3]) {
            const label = `${lens} f=${focalLengthMm} EPD=${apertureMm} h=${maxFieldDeg}`;
            const r = run({ lens, focalLengthMm, apertureMm, maxFieldDeg });
            for (const s of r.samples) {
              expect(Number.isFinite(s.tangentialSagMm), label).toBe(true);
              expect(Number.isFinite(s.thirdOrderTangentialMm), label).toBe(true);
              expect(Number.isFinite(s.distortionPpm), label).toBe(true);
              expect(Number.isFinite(s.thirdOrderDistortionPpm), label).toBe(true);
            }
            expect(Number.isFinite(r.petzvalRatio), label).toBe(true);
            expect(Number.isFinite(r.flatPlaneMm), label).toBe(true);
            expect(Number.isFinite(r.defocusLeverRatio), label).toBe(true);
          }
        }
      }
    }
  });

  /**
   * The fan-density control is safe by construction rather than by care, and
   * that is § 6ac's first hazard: the on-axis reference every sag is measured
   * from is traced INSIDE `fieldSurfaces` with the identical fan, so it is not
   * a parameter this adapter could get wrong. The observable is that the sags
   * hold across the panel's whole range while the reference plane they are
   * measured from wanders by three orders more.
   */
  it("keeps the sags steady across the fan-density control", () => {
    for (const lens of ["singlet", "achromat"] as const) {
      const runs = [21, 31, 41].map((fanSamples) => run({ lens, fanSamples }));
      const sags = runs.map((r) => r.edge.tangentialSagMm);
      const references = runs.map((r) => r.axialZ);
      const sagSwing = (Math.max(...sags) - Math.min(...sags)) / Math.abs(sags[0]!);
      const referenceSwing = Math.max(...references) - Math.min(...references);
      expect(sagSwing, lens).toBeLessThan(1e-3);
      if (lens === "singlet") {
        // The reference itself moves 0.1 mm over the same three settings —
        // fifth-order spherical residual, sampled differently — which is what
        // would have been subtracted into every sag had it been a parameter.
        expect(referenceSwing).toBeGreaterThan(0.05);
      }
    }
  });
});
