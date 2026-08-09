import { describe, it, expect } from "vitest";
import {
  DISPERSION_FLOOR_AIRY_RADII,
  NEWTONIAN_FOCUS_OFFSET_FRACTION,
  REFLECTOR_KINDS,
  chiefRayFieldLimitDeg,
  describeReflector,
  describeReflectors,
  newtonianObstruction,
  renderReflector,
  vignetteSweep,
  type ReflectorKind,
  type ReflectorResult,
  type ReflectorSpec,
} from "../src/reflector";

/**
 * Part C's reflector panel, as invariants rather than as prose.
 *
 * **No engine capability was added, so no validation-ladder rung was.** Every
 * number here belongs to § 4b, § 5e, § 5f, § 5g, § 5h or § 5i and is being
 * called from the app. What is pinned below is the *wiring*, plus the four claims
 * the panel makes that no rung states — each of which was a wrong prediction
 * first, and is recorded here in the form that would catch it going wrong again.
 *
 * The first is that a Newtonian's obstruction has **no aperture in it**:
 * ε = (k/F)/(1 − 1/(16F²)) exactly, k = 0.75 being `newtonian.ts`'s stand-in
 * focus offset. The app derives it; the engine builds it; the rung is that they
 * agree, which is a real cross-check of § 4b's sag term and not a restatement of
 * it — drop the 1/(16F²) and this fails at the fourth digit.
 *
 * The second is a correction to *this app's own* fringe measure. `render.ts`
 * reports a chromatic spread in Airy radii against ONE Airy radius, and on an
 * all-mirror system — which cannot disperse at all — it reads ~0.36. The Airy
 * pattern scales as λ, so that number is diffraction, not glass. § 3b's use of it
 * is untouched: there it compares two lenses sharing the floor. Absolutely, it is
 * not a chromatism measure, and the rung pins the floor's *presence* rather than
 * pretending it away.
 *
 * The third is that even the per-λ normalized measure has a floor, and the floor
 * is the **ruler**: `spectralStack` resamples every plane onto the mean
 * wavelength's grid, so red is cropped where blue is padded. The control is free
 * and exact — a Cassegrain and a Ritchey-Chrétien differ only in two conic
 * constants, and a conic has no refractive index, so the two must read the
 * identical number. They do, which is what makes the residue a ruler artifact
 * rather than a design property.
 *
 * The fourth is that the corrector's excess over that floor tracks its own A₄,
 * approaching a square law as the plate weakens.
 *
 * The fifth arrived with the two pupil masks and is the panel's largest single
 * finding: **the field at which a minimum diagonal stops passing the chief ray**.
 * No rung states it because no rung needed a field range, and past it the engine
 * does not degrade — `opdMap` refuses, since a system with no chief ray has no
 * reference sphere. It is derived in the app,
 * tan θ = (√2·k/2)/[(F − ½ − 1/(16F))·(F − k)], bisected in the engine, and the
 * two agree to 5e-13 with D absent from both. That makes it a wall of the kind
 * the microscope branch kept finding rather than a tolerance.
 *
 * Where a claim is about two routes agreeing, it is pinned as the **mechanism**
 * and not as one tolerance: a ray-lattice count of a clipped pupil converges more
 * raggedly than a subdivided area, and the clipped boundary lengthens as the
 * pupil empties, so the gap is tight under light vignetting and several times
 * looser under heavy — asserted at both ends, each of which can fail.
 */

const SPEC: ReflectorSpec = { apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 };

/** Rendered once per (kind, spec, pupilSamples) — every rung below reads one. */
const rendered = new Map<string, ReflectorResult>();
function render(kind: ReflectorKind, spec: ReflectorSpec, pupilSamples = 64): ReflectorResult {
  const key = `${kind}|${spec.apertureMm}|${spec.focalRatio}|${spec.primaryFocalRatio}|${pupilSamples}`;
  const hit = rendered.get(key);
  if (hit) return hit;
  const result = renderReflector({
    kind,
    spec,
    sourceTemperatureK: 5800,
    wavelengths: 5,
    pupilSamples,
    whiteFraction: 1 / 8000,
    obstruct: true,
    fieldDeg: 0,
  });
  rendered.set(key, result);
  return result;
}

describe("the six exist, and the ones that cannot say so", () => {
  it("builds all six from three numbers", () => {
    const rows = describeReflectors(SPEC);
    expect(rows.map((r) => r.kind)).toEqual([...REFLECTOR_KINDS]);
    for (const row of rows) {
      expect(row.error).toBeUndefined();
      // f = D·F for every one of them: the number on the box, derived.
      expect(row.focalLengthMm).toBeCloseTo(SPEC.apertureMm * SPEC.focalRatio, 9);
      expect(row.prescription!.surfaces.length).toBeGreaterThan(0);
    }
  });

  it("the Newtonian is the only folded one, and the Schmidt the only unobstructed one", () => {
    const rows = describeReflectors(SPEC);
    expect(rows.filter((r) => r.folded).map((r) => r.kind)).toEqual(["newtonian"]);
    expect(rows.filter((r) => r.obstruction === undefined).map((r) => r.kind)).toEqual(["schmidt"]);
  });

  it("puts the engine's own refusal in the row rather than dropping it", () => {
    // F ≤ F₁ means the secondary does not magnify and the layout has no
    // geometry. A1's convention: the design that cannot be built is a finding.
    const rows = describeReflectors({ ...SPEC, focalRatio: 4, primaryFocalRatio: 4 });
    const refused = rows.filter((r) => r.error !== undefined).map((r) => r.kind);
    expect(refused).toEqual(["cassegrain", "ritchey", "schmidt-cassegrain", "sct"]);
    for (const row of rows) {
      if (row.error) expect(row.error).toMatch(/must exceed/);
    }
    // The two that need only D and F are untouched by it.
    expect(rows.find((r) => r.kind === "newtonian")!.error).toBeUndefined();
    expect(rows.find((r) => r.kind === "schmidt")!.error).toBeUndefined();
  });

  it("the whole Cassegrain family shares one layout, so it shares one ε", () => {
    // § 5e/§ 5f/§ 5h/§ 5i all consume `twoMirrorLayout`, which is what keeps the
    // four from drifting. Their obstruction is optical — ε = s₁/f₁ — and it is
    // therefore identical across the four whatever their conics or correctors do.
    const rows = describeReflectors(SPEC);
    const family = ["cassegrain", "ritchey", "schmidt-cassegrain", "sct"] as const;
    const eps = family.map((k) => rows.find((r) => r.kind === k)!.obstruction!);
    for (const e of eps) expect(e).toBeCloseTo(eps[0]!, 15);
    expect(eps[0]!).toBeCloseTo(0.3, 12);
  });
});

describe("a Newtonian's obstruction has no aperture in it", () => {
  it("matches the closed form (k/F)/(1 − 1/(16F²)) to 12 digits", () => {
    for (const focalRatio of [4, 5, 8, 10, 15]) {
      const row = describeReflector("newtonian", { ...SPEC, focalRatio });
      expect(row.obstruction!).toBeCloseTo(newtonianObstruction(focalRatio), 12);
    }
  });

  it("does not move with the aperture at all", () => {
    const eps = [100, 200, 400].map(
      (apertureMm) => describeReflector("newtonian", { ...SPEC, apertureMm }).obstruction!,
    );
    // D cancels out of the sizing algebra, so this is exact rather than close.
    for (const e of eps) expect(e).toBe(eps[0]);
  });

  it("the sag term is what makes it exact, and it is 0.25% at f/5", () => {
    // § 4b derives the diagonal from the marginal ray leaving the primary's rim
    // at the SAG plane, not the vertex, and its own header quotes the correction
    // as 0.25% at f/5. That is reproduced here from the app's side, and it is
    // what would break if the sag term were dropped: the paraxial form alone is
    // 0.15 against the engine's 0.150376.
    const paraxial = NEWTONIAN_FOCUS_OFFSET_FRACTION / 5;
    const exact = describeReflector("newtonian", { ...SPEC, focalRatio: 5 }).obstruction!;
    expect(paraxial).toBeCloseTo(0.15, 15);
    expect(exact / paraxial - 1).toBeCloseTo(0.00251, 5);
    // ...and the correction is 1/(16F²), a pure number, so it too has no D in it.
    expect(exact / paraxial - 1).toBeCloseTo(1 / (1 - 1 / (16 * 25)) - 1, 12);
  });
});

describe("the obstruction is a pupil fact, not a traced blocker", () => {
  it("moves core energy into the rings, and nothing else on axis", () => {
    const cass = render("cassegrain", SPEC);
    // Perfect on axis: the confocal conic pair is exactly stigmatic, so the only
    // difference from a clear aperture is where the light sits.
    expect(cass.strehl).toBeCloseTo(1, 6);
    expect(cass.obstruction).toBeCloseTo(0.3, 12);
    // The ε = 0 control is the SAME system, grid and wavelength — the annulus is
    // the only thing that differs, which is why this is a measurement and not a
    // difference of two spectra.
    expect(cass.clearCoreEnergy).toBeGreaterThan(cass.coreEnergy);
    expect(1 - cass.coreEnergy / cass.clearCoreEnergy).toBeCloseTo(0.183, 2);
  });

  it("a smaller ε costs less core, monotonically", () => {
    // The Newtonian's 0.075 at f/10 against the family's 0.300 on the same grid.
    const newt = render("newtonian", SPEC);
    const cass = render("cassegrain", SPEC);
    expect(newt.obstruction).toBeLessThan(cass.obstruction);
    expect(newt.coreEnergy).toBeGreaterThan(cass.coreEnergy);
    // Both are measured against the same clear-aperture core, so the two losses
    // are comparable numbers rather than two independently normalized ones.
    expect(newt.clearCoreEnergy).toBeCloseTo(cass.clearCoreEnergy, 6);
  });
});

describe("the fringe measure is diffraction, not dispersion", () => {
  it("reads ~0.36 Airy radii on a system containing no glass", () => {
    // The claim that matters: a Newtonian is two mirrors. It cannot disperse.
    // So this number is the Airy radius's own λ-scaling, seen through a fixed
    // denominator — and it is here so that a future reader does not take it for
    // chromatic aberration the way this panel first did.
    const newt = render("newtonian", SPEC);
    expect(newt.fringeAiryRadii).toBeGreaterThan(0.3);
    expect(newt.fringeAiryRadii).toBeLessThan(0.45);
  });

  it("normalizing per wavelength removes it — by more than an order", () => {
    const newt = render("newtonian", SPEC);
    expect(newt.dispersionAiryRadii).toBeLessThan(newt.fringeAiryRadii / 10);
    expect(newt.dispersionAiryRadii).toBeLessThan(DISPERSION_FLOOR_AIRY_RADII);
  });

  it("a conic has no refractive index: Cassegrain and RC agree to 1.3e-5 of each other", () => {
    // The free control, and the one that shows the residue is the ruler rather
    // than the design. The two differ ONLY in their conic constants (§ 5f is
    // pinned against § 5e on identical geometry for exactly this reason), and a
    // conic constant carries no wavelength — so a dispersion measure must return
    // essentially the same number for both.
    //
    // It is NOT exact, and the size of the miss is the interesting part. The
    // conics change the wavefront, so the two PSFs are slightly different
    // *shapes*, and the common-grid crop this floor consists of therefore bites
    // slightly differently on each. So what survives is the ruler responding to
    // a different picture — still not dispersion, since neither system has an
    // index anywhere in it. Asserted as a relative agreement, which can fail in
    // both directions; "identical" was the first draft and was simply wrong.
    for (const pupilSamples of [32, 64]) {
      const cass = render("cassegrain", SPEC, pupilSamples);
      const rc = render("ritchey", SPEC, pupilSamples);
      const relative =
        Math.abs(rc.dispersionAiryRadii - cass.dispersionAiryRadii) / cass.dispersionAiryRadii;
      expect(relative).toBeLessThan(1e-4);
      // ...and it is four orders under the corrector's own excess on the same
      // layout, which is what makes the tie evidence rather than a coincidence
      // of two small numbers.
      const excess = render("sct", SPEC, pupilSamples).dispersionAiryRadii - cass.dispersionAiryRadii;
      expect(excess / (relative * cass.dispersionAiryRadii)).toBeGreaterThan(1e4);
    }
    // ...and they are genuinely different designs, or the tie above is empty.
    const rows = describeReflectors(SPEC);
    const cassRow = rows.find((r) => r.kind === "cassegrain")!;
    const rcRow = rows.find((r) => r.kind === "ritchey")!;
    expect(rcRow.primaryConic).not.toBeCloseTo(cassRow.primaryConic!, 3);
    expect(rcRow.secondaryConic).not.toBeCloseTo(cassRow.secondaryConic!, 3);
  });

  it("the floor does not fall as the grid refines, so it is not resolution", () => {
    // If this were a discretization error it would converge. It wanders instead
    // — which is what a λ-dependent crop on a common grid looks like — so the
    // panel refuses the region rather than subtracting an extrapolated floor.
    const values = [32, 64, 128].map((ps) => render("newtonian", SPEC, ps).dispersionAiryRadii);
    for (const v of values) expect(v).toBeLessThan(DISPERSION_FLOOR_AIRY_RADII);
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values) * 1.2);
  });
});

describe("the corrector's dispersion tracks its own figure", () => {
  it("climbs clear of the floor where the all-mirror members do not", () => {
    const sct = render("sct", SPEC);
    expect(sct.dispersionAiryRadii).toBeGreaterThan(2 * DISPERSION_FLOOR_AIRY_RADII);
    for (const kind of ["newtonian", "cassegrain", "ritchey"] as const) {
      expect(render(kind, SPEC).dispersionAiryRadii).toBeLessThan(DISPERSION_FLOOR_AIRY_RADII);
    }
  });

  it("approaches a square law in A₄ as the plate weakens", () => {
    // A₄ ∝ F₁⁻³, so steepening the primary strengthens the figure fast. The
    // excess over the all-mirror floor (the Cassegrain on the SAME layout, which
    // is the only honest subtraction available) grows as A₄^p with p → 2 from
    // below: measured 2.07 over F₁ 3.5→4, 1.92 over 3→3.5, and 1.45 over
    // 2.5→3 where the excess is 0.64 Airy radii and the small-aberration form
    // has plainly saturated. The rung pins the ordering and the top pair, not a
    // single exponent, because the saturation is real physics and not noise.
    const at = (primaryFocalRatio: number) => {
      const spec = { ...SPEC, primaryFocalRatio };
      const a4 = Math.abs(describeReflector("sct", spec).correctorA4!);
      const excess = render("sct", spec).dispersionAiryRadii - render("cassegrain", spec).dispersionAiryRadii;
      return { a4, excess };
    };
    const weak = at(4);
    const mid = at(3.5);
    const strong = at(3);
    expect(weak.excess).toBeGreaterThan(0);
    expect(mid.excess).toBeGreaterThan(weak.excess);
    expect(strong.excess).toBeGreaterThan(mid.excess);
    const power = (a: { a4: number; excess: number }, b: { a4: number; excess: number }) =>
      Math.log(a.excess / b.excess) / Math.log(a.a4 / b.a4);
    expect(power(mid, weak)).toBeCloseTo(2.07, 1);
    expect(power(strong, mid)).toBeCloseTo(1.92, 1);
  });
});

/**
 * The two pupil masks — § 5c's spider and § 2f's diagonal vignetting.
 *
 * Still no rung: both capabilities are pinned in the ladder and this is the app
 * calling them. What the panel adds, and what is pinned here, is the **wall** —
 * the field at which a minimum diagonal stops passing the chief ray, which no
 * rung states because no rung needed a field range. It is derived in the app and
 * bisected in the engine, and the two agreeing is the check.
 */

const SWEEP = { points: 7, pupilSamples: 64, rayGrid: 101 } as const;

function sweepAt(focalRatio: number, apertureMm = SPEC.apertureMm) {
  return vignetteSweep({
    kind: "newtonian",
    spec: { ...SPEC, apertureMm, focalRatio },
    maxFieldDeg: chiefRayFieldLimitDeg(focalRatio),
    ...SWEEP,
  });
}

describe("the spider's spike is a transform, and its reach is a measurement", () => {
  const spidered = (vanes: number, denominator: number, angleDeg = 0) =>
    renderReflector({
      kind: "newtonian",
      spec: { ...SPEC, focalRatio: 5 },
      sourceTemperatureK: 5800,
      wavelengths: 3,
      pupilSamples: 64,
      whiteFraction: 1 / 8000,
      obstruct: true,
      fieldDeg: 0,
      spider: { vanes, widthFraction: 1 / denominator, angleDeg },
    });

  it("the first zero is padFactor/widthFraction, with no aperture in it", () => {
    // The panel's guard, and the reason it can be red while nothing is wrong.
    for (const denominator of [8, 20, 50]) {
      expect(spidered(4, denominator).spikeFirstZeroPx).toBeCloseTo(4 * denominator, 9);
    }
    // A realistic vane throws the streak clean off a 256-pixel grid: 200 px
    // against a 128-px half-width. That is § 5c's own observation — its
    // validation vanes are deliberately fat — arriving as a live guard.
    const thin = spidered(4, 50);
    expect(thin.spikeFirstZeroPx).toBeGreaterThan(thin.gridHalfPx);
    const fat = spidered(4, 8);
    expect(fat.spikeFirstZeroPx).toBeLessThan(fat.gridHalfPx);
  });

  it("takes pupil area, and takes more of it the fatter the vane", () => {
    // Amplitude only, so the wavefront is untouched and the Strehl cannot move:
    // what a vane costs is energy and where it puts it, not aberration.
    const fat = spidered(4, 8);
    const thin = spidered(4, 50);
    expect(fat.coreEnergy).toBeLessThan(thin.coreEnergy);
    expect(fat.strehl).toBeCloseTo(1, 6);
    expect(thin.strehl).toBeCloseTo(1, 6);
  });

  it("cancels out of the vignetting ratio, because both fields carry it", () => {
    // On axis the diagonal loses nothing, and the spider is common to numerator
    // and denominator — so this is exactly 1 and would not be if the reference
    // were built from a different pupil.
    expect(spidered(4, 12).transmittedFraction).toBeCloseTo(1, 12);
    expect(render("newtonian", { ...SPEC, focalRatio: 5 }).transmittedFraction).toBeCloseTo(1, 12);
  });

  it("refuses a zero-vane spider rather than treating it as none", () => {
    // The engine's strictness, and the reason the panel carries its own `vanes > 0`
    // guard instead of passing a degenerate spec through. "No spider" is the
    // absence of the option, not a spider with nothing in it — which is the same
    // distinction the obstruction option draws, and it is worth a rung because
    // the alternative failure is silent.
    expect(() => spidered(0, 12)).toThrow(/positive integer/);
  });
});

describe("the chief-ray wall", () => {
  it("the engine's bisection lands on the app's closed form to 5e-13", () => {
    // The app derives tan θ = (√2·k/2)/[(F − ½ − 1/(16F))·(F − k)] from § 4b's
    // footprint sizing; the engine finds the field at which `opdMap` refuses.
    // Neither knows about the other, which is what makes the agreement evidence.
    for (const focalRatio of [4, 5, 8, 10, 15]) {
      const sweep = sweepAt(focalRatio);
      expect(sweep.chiefRayLimitDeg / chiefRayFieldLimitDeg(focalRatio) - 1).toBeCloseTo(0, 11);
    }
  });

  it("has no aperture in it either", () => {
    // Same statement as the obstruction's, one derivative further out: D cancels
    // from the footprint AND from the chief ray's height at the diagonal.
    const a = sweepAt(8, 150).chiefRayLimitDeg;
    const b = sweepAt(8, 300).chiefRayLimitDeg;
    expect(a).toBeCloseTo(b, 12);
  });

  it("closes as 1/F², approaching the power from above", () => {
    // The exact form carries an extra (F − k), so the local power sits over 2 and
    // falls toward it. Pinned as an ordering plus the two end values, because a
    // single exponent would be claiming more than a two-factor form supports.
    const limits = [4, 5, 8, 10, 15].map((f) => ({ f, deg: chiefRayFieldLimitDeg(f) }));
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i]!.deg).toBeLessThan(limits[i - 1]!.deg);
    }
    const power = (a: { f: number; deg: number }, b: { f: number; deg: number }) =>
      Math.log(a.deg / b.deg) / Math.log(b.f / a.f);
    expect(power(limits[0]!, limits[1]!)).toBeCloseTo(2.34, 1);
    expect(power(limits[3]!, limits[4]!)).toBeCloseTo(2.11, 1);
    expect(power(limits[3]!, limits[4]!)).toBeLessThan(power(limits[0]!, limits[1]!));
  });
});

describe("throughput falls with field, and two routes say so independently", () => {
  const sweep = sweepAt(5);

  it("starts at exactly 1 and falls monotonically", () => {
    // On axis is exactly 1 because § 4b's diagonal is derived tangent to the
    // on-axis cone — a claim that can go red, unlike the self-ratio § 2f warns of.
    expect(sweep.points[0]!.fieldDeg).toBe(0);
    expect(sweep.points[0]!.fftFraction).toBeCloseTo(1, 12);
    expect(sweep.points[0]!.rayFraction).toBeCloseTo(1, 12);
    for (let i = 1; i < sweep.points.length; i++) {
      expect(sweep.points[i]!.fftFraction).toBeLessThan(sweep.points[i - 1]!.fftFraction);
    }
    // And it falls a long way before the wall: this is a real effect, not a
    // fraction of a percent dressed up as one.
    expect(sweep.points[sweep.points.length - 1]!.fftFraction).toBeLessThan(0.5);
  });

  it("stays inside the wall rather than throwing at it", () => {
    for (const point of sweep.points) {
      expect(point.fieldDeg).toBeLessThan(sweep.chiefRayLimitDeg);
    }
  });

  it("the masked-area and ray-count routes agree, and part further as clipping grows", () => {
    // An area integral over a masked pupil and a count of rays that cleared the
    // clip share no code path — the second builds no mask and runs no FFT. § 2f
    // pins them 1.2e-4 apart at ps 128 / 201 rays; at this panel's coarser
    // 64 / 101 the worst case is looser, and where it is worst is the content:
    // the clipped boundary gets longer as the pupil empties, so a lattice count
    // of it converges more raggedly. Neither number is a tolerance on physics.
    expect(sweep.maxDisagreement).toBeLessThan(0.02);
    const early = sweep.points[1]!;
    expect(Math.abs(early.fftFraction - early.rayFraction)).toBeLessThan(1e-3);
    const late = sweep.points[sweep.points.length - 2]!;
    expect(Math.abs(late.fftFraction - late.rayFraction)).toBeGreaterThan(
      Math.abs(early.fftFraction - early.rayFraction),
    );
  });

  it("an off-axis render carries the mask nobody asked for", () => {
    // No vignetting option exists: `psf()` builds the mask itself, and only when
    // the trace has already lost rays. So the ONLY input is a field angle.
    const at = (fraction: number) =>
      renderReflector({
        kind: "newtonian",
        spec: { ...SPEC, focalRatio: 5 },
        sourceTemperatureK: 5800,
        wavelengths: 3,
        pupilSamples: 64,
        whiteFraction: 1 / 8000,
        obstruct: true,
        fieldDeg: fraction * chiefRayFieldLimitDeg(5),
      });

    const light = at(0.4);
    const heavy = at(0.8);
    expect(heavy.transmittedFraction).toBeLessThan(light.transmittedFraction);
    expect(heavy.rayLost).toBeGreaterThan(light.rayLost);
    expect(light.rayLost).toBeGreaterThan(0);

    // The two routes' gap is pinned as the MECHANISM rather than as one number.
    // A ray count of a clipped region converges more raggedly than a subdivided
    // area — § 2f measures ~5e-4 for the lattice against 1.6e-5 for the area on
    // its own geometry, with 201 rays — and the clipped boundary gets longer as
    // the pupil empties. So the gap is tight where the clipping is light and
    // several times looser where it is heavy, and both halves can fail.
    const gap = (r: typeof light) => Math.abs(r.rayFraction - r.transmittedFraction);
    expect(gap(light)).toBeLessThan(3e-3);
    expect(gap(heavy)).toBeLessThan(2e-2);
    expect(gap(heavy)).toBeGreaterThan(gap(light));

    // ...against an on-axis render of the same system, which loses nothing at all
    // because § 4b's diagonal is derived tangent to the on-axis cone.
    const on = render("newtonian", { ...SPEC, focalRatio: 5 });
    expect(on.rayLost).toBe(0);
    expect(on.transmittedFraction).toBeCloseTo(1, 12);
  });
});
