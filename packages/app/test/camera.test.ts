import { describe, it, expect } from "vitest";
import {
  APERTURE_RANGE,
  CAMERA_OPTICS,
  FOCUS_NM,
  MIN_SENSOR_COLS,
  PITCH_SLIDER_MAX_UM,
  buildCameraSystem,
  chromaticDeparturePoints,
  chromaticPitchSpread,
  criticalPitchAt,
  criticalPitchByWavelength,
  describeFormats,
  detectorMtfSweep,
  displayExposureOf,
  flatFieldPeakRatio,
  focusOffsetMm,
  impliedEflMm,
  mtfQuadratureRefinement,
  renderCamera,
  rulingRow,
  sineDeparture,
  stackWavelengthsNm,
  type CameraOptic,
  type CameraSpec,
} from "../src/camera";
import { systemProperties } from "@telemicroscope/core/trace";

/**
 * APP.md C4's camera panel, as invariants rather than as prose.
 *
 * **No engine capability was added, so no validation-ladder rung was** — every
 * physical number here belongs to § 5r or § 5s and is being called from the app.
 * The one exception is the engine *fix* driving the panel forced, and that is
 * pinned where it belongs, in `packages/core/test/camera.test.ts` at § 5r.1.
 *
 * What is pinned below is the wiring, plus the six claims the panel makes that
 * no rung states. Each was a wrong prediction first — four of them mine, in the
 * direction this doc keeps recording — and is written in the form that would
 * catch it going wrong again.
 *
 * The first is that **the picture carries no aperture until it is put there**.
 * `spectralStack` normalizes to the transmitted pupil energy, so the rendered
 * star's total is flat in aperture and the light-grasp factor has to be applied
 * rather than inherited. Auto-exposing — which every other panel in this app
 * does — would additionally cancel § 5r's headline rung outright.
 *
 * The second is that **the rebin's peak gain is exactly footprint² on a flat
 * field and is not on a star**, the deficit being the PSF core's curvature. Both
 * are asserted, because only running the star would have made the deficit look
 * like a defect.
 *
 * The third is the panel's headline: **the critical pitch is not λ/(4·NA) with λ
 * alone moving.** The traced NA moves too, and its sign is positive for a
 * singlet, negative for an achromat and exactly zero for a mirror.
 *
 * The fourth is that **the FOV-against-paraxial readout has a floor that is not
 * distortion** — it is the image plane's own offset, and calling it distortion
 * would be C1's fringe error one panel later.
 *
 * The fifth arrived from driving the pitch slider: **the star's peak gain is
 * parity-dependent**, because the axis lands on a pixel centre or on a seam
 * depending on whether the column count is even or odd.
 *
 * The sixth arrived from looking at the plot: **the contest cannot be drawn as
 * itself.** Three critical-pitch curves differing by under 3% are one curve on a
 * page, so the plot draws the *departure* — the quantity the claim is about
 * rather than the one it is computed from — and the substitution is pinned here
 * rather than trusted.
 */

const spec = (optic: CameraOptic, over: Partial<CameraSpec> = {}): CameraSpec => ({
  optic,
  apertureMm: APERTURE_RANGE[optic].preset,
  focalRatio: 10,
  sourceTemperatureK: 5800,
  wavelengths: 5,
  pupilSamples: 64,
  ...over,
});

describe("the stack's wavelengths are what the guard rules on", () => {
  it("is 430–670 nm at five samples, not a round 450–650", () => {
    // A guard that said "undersampled at 450 nm" would be ruling on a plane the
    // image does not contain.
    expect(stackWavelengthsNm(spec("achromat"))).toEqual([430, 490, 550, 610, 670]);
  });

  it("rules the regime on the shortest plane, which is the worst one", () => {
    const s = spec("achromat");
    const system = buildCameraSystem(s);
    const rows = criticalPitchByWavelength(system, s, 0.00274);
    expect(rulingRow(rows).nm).toBe(430);
    // One sensor, three verdicts: at the pitch that is critical at 550 nm the
    // blue end is undersampled and the red end is oversampled. That is the
    // reason the ruling row exists at all.
    const byNm = new Map(rows.map((r) => [r.nm, r.regime]));
    expect(byNm.get(430)).toBe("undersampled");
    expect(byNm.get(550)).toBe("critical");
    expect(byNm.get(670)).toBe("oversampled");
  });
});

describe("the headline — how far the critical pitch spreads is the lens's correction", () => {
  it("runs wide for a singlet, narrow for an achromat, and exact for a mirror", () => {
    const departures = new Map<CameraOptic, number>();
    for (const optic of CAMERA_OPTICS) {
      const s = spec(optic);
      const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0.003);
      departures.set(optic, chromaticPitchSpread(rows).departure);
    }
    const singlet = departures.get("singlet")!;
    const achromat = departures.get("achromat")!;
    const mirror = departures.get("newtonian")!;

    // The signs are the finding, and they are three different signs.
    expect(singlet).toBeGreaterThan(0.02);
    expect(achromat).toBeLessThan(0);
    // A conic has no refractive index, so the mirror's spread is EXACTLY the
    // wavelength ratio. Not "small" — zero, to the last bit, which is what makes
    // it the control rather than a fourth data point.
    expect(mirror).toBe(0);
    // And the achromat is an order under the singlet, which is § 3b's contest.
    expect(Math.abs(achromat)).toBeLessThan(Math.abs(singlet) / 10);
  });

  it("is drawn as the departure, because the raw pitches land on top of each other", () => {
    // The plot draws `chromaticDeparturePoints`, not the pitches: three curves
    // differing by under 3% are one curve on a page, and the finding would live
    // only in the table beside it. Pinned as the two things that make the
    // substitution honest — the reference reads exactly zero (a normalization,
    // not a measurement) and the end point IS the spread the table prints.
    for (const optic of CAMERA_OPTICS) {
      const s = spec(optic);
      const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0.003);
      const points = chromaticDeparturePoints(rows);
      expect(points).toHaveLength(rows.length);
      expect(points[0]!.departure).toBe(0);
      expect(points[points.length - 1]!.departure).toBeCloseTo(
        chromaticPitchSpread(rows).departure,
        12,
      );
    }
    // …and the substitution is worth making: the raw pitches really do span
    // under 3% while the departures span an order of magnitude more.
    const raw = CAMERA_OPTICS.map((optic) => {
      const s = spec(optic);
      const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0.003);
      return rows[rows.length - 1]!.criticalPitchMm;
    });
    expect(Math.max(...raw) / Math.min(...raw) - 1).toBeLessThan(0.03);
  });

  it("snaps to a pitch that is exactly critical at the plane asked for", () => {
    const s = spec("achromat");
    const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0.003);
    const target = criticalPitchAt(rows, 550);
    expect(target).toBeDefined();
    // The button's whole purpose: at that pitch the band really does hold three
    // verdicts, so the section's headline is one click rather than a sentence.
    const snapped = criticalPitchByWavelength(buildCameraSystem(s), s, target!);
    const regimes = new Set(snapped.map((r) => r.regime));
    expect(regimes).toEqual(new Set(["undersampled", "critical", "oversampled"]));
    expect(criticalPitchAt(rows, 12345)).toBeUndefined();
  });

  it("the mirror's NA is bitwise identical across the band, at any aperture", () => {
    // The mechanism behind the exact zero above, asserted separately so that a
    // zero arriving for some other reason would not pass as this one.
    for (const apertureMm of [150, 200, 350]) {
      const s = spec("newtonian", { apertureMm });
      const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0.003);
      const nas = new Set(rows.map((r) => r.tracedNa));
      expect(nas.size).toBe(1);
    }
  });

  it("uses the traced marginal sine, which departs from 1/(2F) and grows with aperture", () => {
    // § 5s's load-bearing rung, as the reason the printed pitch is this system's
    // rather than a formula's. A stub returning the paraxial value reads zero
    // departure at both stops and fails.
    const slow = sineDeparture(buildCameraSystem(spec("achromat", { focalRatio: 10 })), spec("achromat", { focalRatio: 10 }));
    const fast = sineDeparture(buildCameraSystem(spec("achromat", { focalRatio: 5 })), spec("achromat", { focalRatio: 5 }));
    expect(Math.abs(slow.departure)).toBeGreaterThan(0);
    expect(Math.abs(fast.departure)).toBeGreaterThan(Math.abs(slow.departure));
    // …and stays inside `samplingRegime`'s own 2% tolerance, so it moves the
    // printed pitch without moving the verdict. That is the claim the panel puts
    // on screen, and it would be wrong if the departure ever crossed 2%.
    expect(Math.abs(fast.departure)).toBeLessThan(0.02);
  });
});

describe("the rebin: what the sensor does to the light", () => {
  it("puts exactly footprint² in a flat field's pixel, integer footprint or not", () => {
    for (const [pitch, src] of [
      [0.002, 0.001],
      [0.003, 0.001],
      [0.004, 0.001],
      [0.0055, 0.001],
    ] as const) {
      expect(flatFieldPeakRatio(pitch, src)).toBeCloseTo(1, 12);
    }
  });

  it("gains less than footprint² on a star, and the gap is the PSF core", () => {
    const result = renderCamera({ ...spec("achromat"), pitchUm: 3.76, seconds: 1, gain: 1 });
    expect(result.refusal).toBeUndefined();
    expect(result.flatFieldPeakRatio).toBeCloseTo(1, 12);
    // Both halves matter: the star gains, and it gains less than the flat field.
    expect(result.starPeakRatio).toBeGreaterThan(1);
    expect(result.starPeakRatio).toBeLessThan(result.footprint ** 2);
  });

  it("conserves energy but for the edge sliver `floor` drops", () => {
    const result = renderCamera({ ...spec("achromat"), pitchUm: 3.76, seconds: 1, gain: 1 });
    expect(result.energyRatio).toBeLessThanOrEqual(1);
    expect(result.energyRatio).toBeGreaterThan(0.9999);
    // The loss is geometric and reported, not swallowed — `coveredFraction` is
    // what explains it, and the two must move together.
    expect(result.coveredFraction).toBeLessThan(1);
    expect(result.coveredFraction).toBeGreaterThan(0.99);
  });

  it("the star's peak gain swings on the parity of the column count", () => {
    // Sample-at-centre: an even column count centres a cell on the axis, an odd
    // one puts the axis on a seam and splits the star between two pixels. § 5r's
    // centroid rung cannot see this — the split is symmetric — so the peak is the
    // quantity that moves, and it moves by nearly 4×.
    const even: number[] = [];
    const odd: number[] = [];
    for (const pitchUm of [13, 13.5, 14, 15, 17, 18, 19, 20]) {
      const r = renderCamera({ ...spec("achromat"), pitchUm, seconds: 1, gain: 1 });
      if (r.refusal) continue;
      expect(r.axisOnPixelCentre).toBe(r.sensorCols % 2 === 0);
      (r.axisOnPixelCentre ? even : odd).push(r.starPeakRatio);
    }
    expect(even.length).toBeGreaterThan(1);
    expect(odd.length).toBeGreaterThan(1);
    // The two groups do not overlap at all, which is what makes it parity rather
    // than a trend in pitch: the pitches interleave and the values do not.
    expect(Math.min(...even)).toBeGreaterThan(3 * Math.max(...odd));
    // …while the flat field is immune to the same swing.
    const flat = renderCamera({ ...spec("achromat"), pitchUm: 13, seconds: 1, gain: 1 });
    const flatOdd = renderCamera({ ...spec("achromat"), pitchUm: 13.5, seconds: 1, gain: 1 });
    expect(flat.flatFieldPeakRatio).toBeCloseTo(1, 12);
    expect(flatOdd.flatFieldPeakRatio).toBeCloseTo(1, 12);
  });

  it("refuses a pitch that records too few columns rather than drawing it", () => {
    const result = renderCamera({ ...spec("achromat"), pitchUm: 60, seconds: 1, gain: 1 });
    expect(result.refusal).toBeDefined();
    expect(result.sensorCols).toBe(0);
    expect(result.refusal).toContain(String(MIN_SENSOR_COLS));
    // The native frame is still delivered — a refusal removes the sensor, not
    // the panel.
    expect(result.nativeRgba.length).toBeGreaterThan(0);
  });

  it("…and the sliders can actually reach that refusal", () => {
    // A guard the controls cannot reach is dead UI, which is the same honesty
    // problem as one that never fires. The pitch slider had a 20 µm maximum,
    // and at `pupilSamples` 32 the 174.2 µm frame records EXACTLY 8 columns
    // there — `MIN_SENSOR_COLS` and not below it. The max is 30 µm for this
    // reason, so the rung is on the reachability rather than on the number.
    const atSliderMax = renderCamera({
      ...spec("achromat", { pupilSamples: 32 }),
      pitchUm: PITCH_SLIDER_MAX_UM,
      seconds: 1,
      gain: 1,
    });
    expect(atSliderMax.refusal).toBeDefined();
  });
});

describe("§ 3b's guards are on screen, because both bite inside the sliders", () => {
  it("the fast end of the focal-ratio slider truncates past C1's 1% threshold", () => {
    // APP.md's trait 2. This panel computes `truncatedFraction` and
    // `geometricWeight`, and the first version displayed neither — while its own
    // focal-ratio slider reaches f/4, where they are not zero. The rung is that
    // the reachable worst case is genuinely bad enough to need the readout, so
    // deleting the guard would redden here rather than pass quietly.
    const fast = renderCamera({
      ...spec("singlet", { focalRatio: 4, apertureMm: 20 }),
      pitchUm: 3.76,
      seconds: 1,
      gain: 1,
    });
    expect(fast.truncatedFraction).toBeGreaterThan(0.01);
  });

  it("…and the frame there is fully GEOMETRIC, which the table beside it is not about", () => {
    // The coupling that makes this panel's version of the guard load-bearing
    // rather than boilerplate: the critical pitch, the verdict and the whole
    // λ/(4·NA) contest are about a DIFFRACTION limit, and at the fast end the
    // fidelity switch has abandoned the transform completely.
    const fast = renderCamera({
      ...spec("singlet", { focalRatio: 4, apertureMm: 20 }),
      pitchUm: 3.76,
      seconds: 1,
      gain: 1,
    });
    expect(fast.geometricWeight).toBeCloseTo(1, 6);

    // …while the panel's default configuration is clean on both, so the guards
    // are informative rather than permanently red.
    const nominal = renderCamera({ ...spec("achromat"), pitchUm: 3.76, seconds: 1, gain: 1 });
    expect(nominal.truncatedFraction).toBe(0);
    expect(nominal.geometricWeight).toBeLessThan(1e-3);
  });
});

describe("the exposure convention, which is this panel's and not the app's", () => {
  it("is fixed: the same scalar reaches both frames and neither normalizes itself", () => {
    // Auto-exposure would cancel § 5r's headline exactly, because the rebin
    // conserves energy. The pin is that the exposure depends on the REQUEST and
    // not on the image — so it is unchanged by anything that only moves light
    // around inside the frame.
    const a = renderCamera({ ...spec("achromat"), pitchUm: 2.4, seconds: 1, gain: 1 });
    const b = renderCamera({ ...spec("achromat"), pitchUm: 9, seconds: 1, gain: 1 });
    expect(a.displayExposure).toBe(b.displayExposure);
    // …and the pitch genuinely changed what the sensor recorded.
    expect(a.starPeakRatio).not.toBeCloseTo(b.starPeakRatio, 3);
  });

  it("carries light grasp explicitly, because the render does not carry it at all", () => {
    // The measurement the convention rests on: the star's own total is flat in
    // aperture, so D² has to be applied rather than inherited. If a future change
    // makes `spectralStack` carry pupil area, this reddens and the exposure is
    // double-counting.
    const totals = [8, 10, 16].map((apertureMm) => {
      const s = spec("achromat", { apertureMm });
      const system = buildCameraSystem(s);
      return {
        apertureMm,
        exposure: displayExposureOf(system, { ...s, pitchUm: 3.76, seconds: 1, gain: 1 }),
      };
    });
    // Exposure is exactly D²: doubling the aperture is four stops of light grasp.
    const [small, , large] = totals;
    expect(large!.exposure / small!.exposure).toBeCloseTo((16 / 8) ** 2, 9);
  });

  it("makes time and gain interchangeable, as stops are", () => {
    const s = spec("achromat");
    const system = buildCameraSystem(s);
    const base = displayExposureOf(system, { ...s, pitchUm: 3.76, seconds: 1, gain: 1 });
    const twiceTime = displayExposureOf(system, { ...s, pitchUm: 3.76, seconds: 2, gain: 1 });
    const twiceGain = displayExposureOf(system, { ...s, pitchUm: 3.76, seconds: 1, gain: 2 });
    expect(twiceTime).toBeCloseTo(2 * base, 12);
    expect(twiceGain).toBeCloseTo(twiceTime, 12);
  });

  it("is not moved by the sampling knob, which is bookkeeping and not light", () => {
    // `spectralStack`'s total goes as pupilSamples², so without the divisor a
    // reader widening the frame would read the change as an exposure.
    const s32 = spec("achromat", { pupilSamples: 32 });
    const s128 = spec("achromat", { pupilSamples: 128 });
    const peakish = (sp: CameraSpec) =>
      displayExposureOf(buildCameraSystem(sp), { ...sp, pitchUm: 3.76, seconds: 1, gain: 1 }) *
      sp.pupilSamples ** 2;
    // The raw image scales as ps², and the exposure divides it out, so their
    // product is the same physical scalar at every sampling.
    expect(peakish(s32)).toBeCloseTo(peakish(s128), 12);
  });
});

describe("the detector MTF, measured rather than drawn", () => {
  it("reproduces sinc(π·f·pitch) below Nyquist", () => {
    const sweep = detectorMtfSweep(0.006);
    expect(sweep.points.length).toBeGreaterThan(10);
    expect(sweep.maxRelativeDeparture).toBeLessThan(5e-3);
    for (const p of sweep.points) {
      expect(Number.isFinite(p.measured)).toBe(true);
      // Nothing may exceed a box filter's own transfer — reading above it was
      // the tell that the projection window was leaking.
      expect(p.measured).toBeLessThan(1.001);
    }
  });

  it("refuses every degenerate multiple of Nyquist rather than plotting it", () => {
    // At exactly Nyquist the modulation is phase-dependent (0.63 aligned, 0 a
    // quarter period along) and at twice it the target folds to DC. Neither has
    // a value, and A3's rule is that such a readout is refused.
    const sweep = detectorMtfSweep(0.006);
    for (const p of sweep.points) {
      const k = p.fractionOfNyquist;
      expect(Math.abs(k - Math.round(k))).toBeGreaterThan(1e-9);
    }
    expect(sweep.refusedAtNyquist).toMatch(/phase-dependent/);
  });

  it("aliases to |1/p − f| exactly, not approximately", () => {
    // The sampling theorem produced rather than asserted: above Nyquist the
    // measurement lands at the folded frequency, and folding is exact.
    const sweep = detectorMtfSweep(0.006);
    const above = sweep.points.filter((p) => p.aliasedToCyclesPerMm !== undefined);
    expect(above.length).toBeGreaterThan(3);
    for (const p of above) {
      expect(p.aliasedToCyclesPerMm!).toBeCloseTo(
        Math.abs(2 * sweep.nyquistCyclesPerMm - p.cyclesPerMm),
        12,
      );
      expect(p.aliasedToCyclesPerMm!).toBeLessThan(sweep.nyquistCyclesPerMm);
    }
  });

  it("the residual is the target's own quadrature — ×4 per doubling, second order", () => {
    // The control that says the departure above belongs to the cosine's
    // staircase and not to the detector. A detector effect would not move with
    // the target's sampling at all; this one falls at exactly the midpoint
    // rule's rate, which is a closed form and therefore what gets pinned.
    const refinement = mtfQuadratureRefinement(0.006);
    const errors = refinement.map((r) => Math.abs(1 - r.ratio));
    for (let i = 0; i + 1 < errors.length; i++) {
      expect(errors[i]! / errors[i + 1]!).toBeCloseTo(4, 1);
    }
    expect(errors[errors.length - 1]!).toBeLessThan(2e-4);
  });
});

describe("the FOV floor is the image plane, and the distortion is what is left", () => {
  it("survives at a field where distortion cannot exist", () => {
    // 0.05 mm of half-width is 0.029° — third-order distortion there is under a
    // part in 10⁷, so anything the raw departure shows is not distortion.
    const s = spec("achromat");
    const system = buildCameraSystem(s);
    const efl = systemProperties(system.prescription, FOCUS_NM).efl;
    const tiny = impliedEflMm(system, 0.05, FOCUS_NM);
    const wide = impliedEflMm(system, 8, FOCUS_NM);
    const tinyDeparture = Math.abs(tiny / efl - 1);
    expect(tinyDeparture).toBeGreaterThan(1e-4);
    // …and it is very nearly the same floor 160× further out in field, which is
    // what makes it a scale and not a field effect.
    expect(Math.abs(wide / efl - 1)).toBeCloseTo(tinyDeparture, 4);
  });

  it("is the image plane's own offset, and a paraboloid's is zero", () => {
    // The causal claim, with the control that proves it. An achromat's best
    // focus sits off the paraxial plane by its spherical residual; a paraboloid
    // has none on axis, so its offset — and therefore its floor — vanishes.
    const achromat = focusOffsetMm(buildCameraSystem(spec("achromat")), FOCUS_NM);
    const singlet = focusOffsetMm(buildCameraSystem(spec("singlet")), FOCUS_NM);
    const mirror = focusOffsetMm(buildCameraSystem(spec("newtonian")), FOCUS_NM);
    expect(Math.abs(achromat)).toBeGreaterThan(1e-3);
    // The singlet's residual is far worse than the achromat's, so its offset is
    // far larger — the ordering is the mechanism.
    expect(Math.abs(singlet)).toBeGreaterThan(5 * Math.abs(achromat));
    expect(Math.abs(mirror)).toBeLessThan(1e-6);
  });

  it("reports distortion against the on-axis limit, so the mirror reads zero", () => {
    const mirrorSpec = spec("newtonian");
    const rows = describeFormats(buildCameraSystem(mirrorSpec), 0.00376, FOCUS_NM);
    for (const row of rows) {
      if (row.error || row.distortion === undefined) continue;
      // A paraboloid with the stop at its vertex has no distortion at all, so
      // the column must read zero rather than the floor the raw departure has.
      expect(Math.abs(row.distortion)).toBeLessThan(1e-12);
    }
  });

  it("grows as the cube for a refractor — ×4 per doubling in its fractional form", () => {
    const system = buildCameraSystem(spec("achromat"));
    const axial = impliedEflMm(system, 0.05, FOCUS_NM);
    const distortionAt = (halfWidthMm: number) =>
      Math.abs(impliedEflMm(system, halfWidthMm, FOCUS_NM) / axial - 1);
    const d = [2, 4, 8].map(distortionAt);
    expect(d[1]! / d[0]!).toBeCloseTo(4, 0);
    expect(d[2]! / d[1]!).toBeCloseTo(4, 0);
  });

  it("keeps a corner past § 2f's wall as a refusal, with the engine's own words", () => {
    // The fix at § 5r.1 must not have swallowed the genuine wall: on an f/10
    // Newtonian the small formats answer and full frame does not.
    const rows = describeFormats(buildCameraSystem(spec("newtonian")), 0.00376, FOCUS_NM);
    const refused = rows.filter((r) => r.error);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.length).toBeLessThan(rows.length);
    expect(refused.every((r) => /outside the field this system passes/.test(r.error!))).toBe(true);
    // The largest format is the one that refuses, and the smallest answers.
    expect(rows[rows.length - 1]!.error).toBeDefined();
    expect(rows[0]!.error).toBeUndefined();
  });

  it("answers every format for a refractor, which has no diagonal to clip on", () => {
    const rows = describeFormats(buildCameraSystem(spec("achromat")), 0.00376, FOCUS_NM);
    expect(rows.every((r) => r.error === undefined)).toBe(true);
    // Plate scale is a per-pixel geometry number, so it is the same on every
    // format — the formats differ in how many pixels they have, not in scale.
    const scales = new Set(rows.map((r) => r.arcsecPerPixel));
    expect(scales.size).toBe(1);
  });
});
