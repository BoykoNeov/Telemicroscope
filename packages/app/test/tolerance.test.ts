import { describe, it, expect } from "vitest";
import { sensitivity } from "@telemicroscope/core/analysis";
import {
  MARECHAL_WAVES,
  apertureWallMm,
  buildNominal,
  lostRays,
  perturbationsOf,
  runTolerance,
  scaleRow,
  type Row,
  type RowScale,
  type ToleranceSpec,
} from "../src/tolerance";

/**
 * Part B — the tolerancing panel, as invariants rather than as prose.
 *
 * **No engine capability was added for the panel, so no validation-ladder rung
 * was**: every number here is § 5t's, called from the app. A6's and D10's
 * convention. What is pinned below is the wiring, plus the claims the panel
 * makes that no rung states — and each of them is a claim § 5t could not have
 * made, because § 5t deliberately sits on a *perfect* nominal and this panel
 * deliberately does not.
 *
 * 1. **The slider scaling is a measurement that checks itself.** ±1 on a slider
 *    is the drift that spends the Maréchal budget, extrapolated from a linear
 *    coefficient and then *bisected*. The extrapolation is legitimate for twelve
 *    of the achromat's fifteen (surface, target) pairs and wrong by 20× for one,
 *    and the panel prints the ratio rather than trusting either.
 * 2. **Two rows are refusals.** The last surface's thickness is inert — the
 *    image plane is an offset from the last vertex, so the airspace never
 *    reaches the image — and the give-away is that `sigmaBeforeFocusWaves` is
 *    exactly 0 as well, which a merely-compensated row never is.
 * 3. **The RSS budget is not a bound in either direction.** A conic error on the
 *    front surface and a curvature error on the rear one each spend half the
 *    budget and together spend ~none.
 * 4. **A σ has no sign and an image does**, because this nominal is a real
 *    doublet with a spherical residual of its own.
 */

const SPEC: ToleranceSpec = { lens: "achromat", focalLengthMm: 100, apertureMm: 20 };
const nominal = buildNominal(SPEC);

const scales = new Map<string, RowScale>();
const scaleOf = (surface: number, target: Parameters<typeof scaleRow>[2]): RowScale => {
  const key = `${surface}:${target}`;
  const cached = scales.get(key);
  if (cached) return cached;
  const scale = scaleRow(nominal, surface, target);
  scales.set(key, scale);
  return scale;
};

const run = (rows: readonly Row[], refocus = true) =>
  runTolerance({
    spec: SPEC,
    rows,
    scales: rows.map((r) => scaleOf(r.surface, r.target)),
    refocus,
    whiteDivisor: 4,
    sweepPoints: 3,
  });

describe("Part B — the nominal the panel perturbs", () => {
  it("is whole: the pupil loses no rays, so every σ is over one aperture", () => {
    expect(lostRays(nominal)).toBe(0);
  });

  it("the aperture wall is mechanical, not a focal ratio — it goes as √f", () => {
    // `refractorPair` fixes the crown's centre thickness at 3 mm whatever the
    // focal length, so the two sags meet at h ≈ √(t·R) and R ∝ f. That makes the
    // wall ∝ √f and the f-number at it LOOSEN with focal length — the opposite
    // shape from the microscope branch's four aberration walls.
    const walls = [50, 100, 200].map((focalLengthMm) =>
      apertureWallMm({ ...SPEC, focalLengthMm }),
    );
    expect(walls[1]! / walls[0]!).toBeCloseTo(Math.SQRT2, 1);
    expect(walls[2]! / walls[1]!).toBeCloseTo(Math.SQRT2, 1);
    // And the f-number at the wall is not a constant: it moves by ~2× across the
    // same span, which is what says the wall is not a ratio.
    expect(200 / walls[2]! / (50 / walls[0]!)).toBeGreaterThan(1.8);

    // The wall is where it says it is: whole one side, hollow the other.
    const wall = walls[1]!;
    expect(lostRays(buildNominal({ ...SPEC, apertureMm: wall * 0.999 }))).toBe(0);
    expect(lostRays(buildNominal({ ...SPEC, apertureMm: wall * 1.02 }))).toBeGreaterThan(0);
  });
});

describe("Part B — the slider scaling", () => {
  it("±1 really is σ = λ/14, for every row the panel offers by default", () => {
    for (const [surface, target] of [
      [0, "curvature"],
      [0, "conic"],
      [1, "decenterX"],
      [0, "tiltY"],
    ] as const) {
      const scale = scaleOf(surface, target);
      expect(scale.reachable).toBe(true);
      expect(scale.sigmaAtFullScale).toBeCloseTo(MARECHAL_WAVES, 4);
    }
  });

  it("δW is linear in the perturbation — for every row but one", () => {
    // § 5t's premise, measured. The extrapolation from a probe-delta coefficient
    // lands on the bisected budget delta within 6% — 0.96 to 1.06 — for TWELVE of
    // the achromat's fifteen (surface, target) pairs, so δW really is linear out
    // to a whole Maréchal budget and the residual is its own second order. (Of
    // the other three, one is inert, one is out of reach, and one is below.)
    for (const [surface, target] of [
      [0, "curvature"],
      [0, "conic"],
      [1, "conic"],
      [0, "thickness"],
      [0, "tiltY"],
      [2, "tiltY"],
      [1, "decenterX"],
    ] as const) {
      const n = scaleOf(surface, target).nonlinearity;
      expect(n).toBeGreaterThan(0.94);
      expect(n).toBeLessThan(1.06);
    }
    // ...and misses by more than 10× on a tilt of the CEMENTED INTERFACE, whose
    // index step is 0.103 against the outer surfaces' 0.517. Its linear
    // coefficient is the small one; its second-order term is not, so the
    // quadratic takes over two orders of magnitude sooner. This is why the
    // scaling bisects instead of trusting the extrapolation.
    const inner = scaleOf(1, "tiltY");
    expect(inner.nonlinearity).toBeLessThan(0.1);
    expect(inner.sigmaAtFullScale).toBeCloseTo(MARECHAL_WAVES, 4);
    expect(scaleOf(0, "tiltY").coefficientWavesPerUnit / inner.coefficientWavesPerUnit)
      .toBeGreaterThan(20);
  });

  it("a decenter of the STOP surface cannot reach the budget before the rays do", () => {
    // Surface 0 is the aperture stop, so decentering it takes the pupil with it
    // and most of the aberration cancels — § 5t makes the same point on a mirror,
    // where it is an exact null. On a powered refracting stop it is not null but
    // it is 11× weaker than the same decenter one surface later, and the glass
    // runs out first. The row is offered anyway, refusing itself.
    const stop = scaleOf(0, "decenterX");
    expect(stop.reachable).toBe(false);
    expect(stop.sigmaAtFullScale).toBeLessThan(MARECHAL_WAVES);
    expect(scaleOf(1, "decenterX").coefficientWavesPerUnit / stop.coefficientWavesPerUnit)
      .toBeGreaterThan(5);
  });

  it("the last surface's thickness is INERT, and the tell is σ before the compensator", () => {
    // `withFocus` sets the image plane as an offset from the last vertex, so this
    // airspace never reaches the image. That is not the focus compensator
    // removing it: a compensated row has a large `sigmaBeforeFocusWaves` and a
    // small `sigmaWaves` (see below), and this one has BOTH exactly zero.
    const last = nominal.prescription.surfaces.length - 1;
    const scale = scaleOf(last, "thickness");
    expect(scale.inert).toBeTruthy();
    const s = sensitivity(nominal, { surface: last, target: "thickness", delta: 0.05 }, {
      pupilSamples: 21,
      wavelengthNm: 550,
    });
    expect(s.sigmaWaves).toBe(0);
    expect(s.sigmaBeforeFocusWaves).toBe(0);

    // Contrast: an INNER airspace is compensated, not inert — huge before the
    // focus solve and small after it.
    const inner = sensitivity(nominal, { surface: 0, target: "thickness", delta: 0.05 }, {
      pupilSamples: 21,
      wavelengthNm: 550,
    });
    expect(inner.sigmaBeforeFocusWaves).toBeGreaterThan(50 * inner.sigmaWaves);

    // And an inert row contributes no perturbation at all, whatever its slider says.
    expect(
      perturbationsOf([{ surface: last, target: "thickness", fraction: 1 }], [scale]),
    ).toHaveLength(0);
  });
});

describe("Part B — what the focus compensator buys, per row", () => {
  it("separates the rows a focuser fixes from the ones it cannot touch", () => {
    const result = run([
      { surface: 0, target: "curvature", fraction: 0.5 },
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: 1, target: "decenterX", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0.5 },
    ]);
    const [curvature, conic, decenter, tilt] = result.rows;
    // A curvature error is nearly pure defocus: the focuser removes ~99% of it.
    expect(curvature!.focusGain).toBeGreaterThan(50);
    // A conic error is spherical, which a refocus only PARTLY removes — § 5t's
    // whole reason for perturbing the conic rather than the curvature.
    expect(conic!.focusGain).toBeGreaterThan(2);
    expect(conic!.focusGain).toBeLessThan(10);
    // A decenter and a tilt are odd aberrations with no defocus in them at all.
    expect(decenter!.focusGain).toBeCloseTo(1, 2);
    expect(tilt!.focusGain).toBeCloseTo(1, 2);
    // Only the two that move the beam have a pointing error.
    expect(decenter!.boresightRad).toBeGreaterThan(0);
    expect(tilt!.boresightRad).toBeGreaterThan(0);
    expect(curvature!.boresightRad).toBe(0);
    expect(conic!.boresightRad).toBe(0);
  });
});

describe("Part B — the budget is not a bound in either direction", () => {
  it("orthogonal modes add in quadrature", () => {
    const result = run([
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 1, target: "decenterY", fraction: 0.4 },
      { surface: 0, target: "conic", fraction: 0 },
      { surface: 0, target: "tiltY", fraction: 0 },
    ]);
    expect(result.independenceRatio).toBeCloseTo(1, 2);
    expect(result.rows[0]!.varianceShare).toBeCloseTo(0.5, 2);
    expect(result.rows[1]!.varianceShare).toBeCloseTo(0.5, 2);
  });

  it("two identical decenters add LINEARLY — combined ÷ rss is √2", () => {
    const result = run([
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 0, target: "conic", fraction: 0 },
      { surface: 0, target: "tiltY", fraction: 0 },
    ]);
    expect(result.independenceRatio).toBeCloseTo(Math.SQRT2, 2);
  });

  it("a conic and a curvature on DIFFERENT surfaces cancel — the RSS is ≥50× pessimistic", () => {
    // The panel's headline, and the direction APP.md did not scope. Two
    // perturbations of different parameters on different surfaces, each spending
    // half the Maréchal budget, that together spend almost none: both make
    // spherical aberration, of opposite sign.
    const last = nominal.prescription.surfaces.length - 1;
    const result = run([
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: last, target: "curvature", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ]);
    expect(result.rssWaves).toBeGreaterThan(0.9 * MARECHAL_WAVES * 0.5 * Math.SQRT2);
    expect(result.independenceRatio).toBeLessThan(0.02);
    expect(result.rssWaves / result.combinedWaves).toBeGreaterThan(50);
  });

  it("...but the cancellation is the PROJECTION's, and a real focuser gets only part of it", () => {
    // The correction to the test above, and it is worth more than the
    // cancellation itself. `combinedWaves` removes ρ² by least squares on ONE
    // reference plane — which is what makes the RSS exact rather than
    // approximate — while an instrument removes it by MOVING the image plane,
    // and here that is a 1.9 mm move undoing 17.5 waves of defocus. Measured:
    // the projected delta is 2.67e-4 waves and the physically refocused one is
    // 1.85e-2, sixty-nine times larger, though still 2.7× inside the RSS.
    //
    // And the image loses more than even THAT residual predicts, because the
    // residual is spherical and so is the doublet's own: inverting Maréchal on
    // the three measured Strehls gives σ_nominal 0.0325, σ_perturbed 0.0511 and
    // a cross term ⟨W_nominal·δ⟩ = 6.08e-4 against σ_n·σ_δ = 6.00e-4 — a
    // correlation of 1.01, i.e. exactly parallel. § 5t's "every external rung is
    // pinned on a perfect nominal" is not a formality, and this is what it buys.
    const last = nominal.prescription.surfaces.length - 1;
    const rows: Row[] = [
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: last, target: "curvature", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ];
    const result = run(rows);
    // Each row on its own is a real tolerance whose focuser residual is NOT small.
    expect(result.rows[0]!.physicalRefocusWaves).toBeGreaterThan(0.4 * MARECHAL_WAVES);
    expect(result.rows[1]!.physicalRefocusWaves).toBeGreaterThan(0.2 * MARECHAL_WAVES);
    // So the star is measurably down while the budget's own currency says free —
    // and it is still far better than the RSS would have you believe.
    expect(result.strehlRatio).toBeLessThan(0.96);
    expect(result.strehlRatio).toBeGreaterThan(0.90);
    expect(result.strehlMarechal).toBeGreaterThan(0.999);
  });

  it("the sweep scales, and both curves are second-order — neither is exactly linear", () => {
    // The plot's honesty check. rss is √(Σσᵢ²) of perturbations that are
    // themselves only linear to a few tenths of a percent over this range, so
    // "linear in k by construction" would be an overclaim: measured, doubling k
    // multiplies rss by 2.0043 and combined by 2.0082. What the plot shows is
    // their SEPARATION, not a straight line against a curve.
    const result = run([
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0.5 },
      { surface: 0, target: "curvature", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ]);
    const [zero, one, two] = result.sweep;
    expect(zero!.k).toBe(0);
    expect(zero!.rssWaves).toBe(0);
    expect(zero!.combinedWaves).toBe(0);
    expect(two!.rssWaves / one!.rssWaves).toBeLessThan(2.01);
    expect(two!.combinedWaves / one!.combinedWaves).toBeLessThan(2.02);
    // Both superlinear, and the combined by more — the cross term is second order.
    expect(two!.rssWaves / one!.rssWaves).toBeGreaterThan(2);
    expect(two!.combinedWaves / one!.combinedWaves).toBeGreaterThan(
      two!.rssWaves / one!.rssWaves,
    );
    // These two are orthogonal, so the separation is small and constant in k.
    for (const point of result.sweep.slice(1)) {
      expect(point.combinedWaves / point.rssWaves).toBeCloseTo(1.014, 2);
    }
  });
});

describe("Part B — the singlet, which is where several of the above stop holding", () => {
  const singlet = (apertureMm: number): ToleranceSpec => ({
    lens: "singlet",
    focalLengthMm: 100,
    apertureMm,
  });

  it("its wall is the SAME law with a different centre thickness, and out of reach", () => {
    // h = √(t·R) with BOTH factors moving: 5 mm of centre thickness against the
    // crown's 3, and R 103.36 mm against 44.78. √(5/3 × 2.308) = 1.961 against a
    // measured 45.19/22.99 = 1.966 at f = 100. What matters to the panel is that the widest
    // aperture it offers (30 mm) never reaches it, so the wall guard's prose must
    // be lens-specific or it is the only thing that branch ever shows, wrongly.
    const walls = [50, 100, 200].map((focalLengthMm) =>
      apertureWallMm({ ...singlet(10), focalLengthMm }),
    );
    expect(walls[1]! / walls[0]!).toBeCloseTo(Math.SQRT2, 1);
    expect(walls[2]! / walls[1]!).toBeCloseTo(Math.SQRT2, 1);
    expect(walls[1]!).toBeGreaterThan(30);
    expect(apertureWallMm({ lens: "achromat", focalLengthMm: 100, apertureMm: 10 })).toBeLessThan(30);
  });

  it("the Strehl ratio is REFUSED past f/7, because the nominal stops being an image", () => {
    // The rule A3 states and the achromat never exercises: a Strehl ratio reads
    // what the tolerances cost only while the nominal is diffraction-limited.
    // Measured nominal Strehl down the aperture ladder: 0.956 at f/10, 0.500 at
    // f/7.1, 0.067 at f/5, 0.018 at f/4 — and at f/4 the RATIO reads 1.179, the
    // perturbed system "better" than a nominal that is not forming an image.
    const rows: Row[] = [
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0.5 },
      { surface: 0, target: "curvature", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ];
    const at = (apertureMm: number) => {
      const spec = singlet(apertureMm);
      const nominal = buildNominal(spec);
      return runTolerance({
        spec,
        rows,
        scales: rows.map((r) => scaleRow(nominal, r.surface, r.target)),
        refocus: true,
        whiteDivisor: 4,
        sweepPoints: 3,
      });
    };
    const slow = at(10);
    expect(slow.strehlNominal).toBeGreaterThan(0.8);
    expect(slow.strehlRatioMeaningful).toBe(true);

    const fast = at(25);
    expect(fast.strehlNominal).toBeLessThan(0.1);
    expect(fast.strehlRatioMeaningful).toBe(false);
    // The number it refuses is exactly the misleading one.
    expect(fast.strehlRatio).toBeGreaterThan(1);
  });

  it("which rows are linear is a property of the LENS, not of the target", () => {
    // The achromat's curvature rows all bisect to within 6% of the extrapolation.
    // The singlet's front-surface curvature does not: 0.24 at f/10, climbing to
    // 0.93 at f/3.3. So the verify-then-bisect step is load-bearing on a lens the
    // achromat-only rungs never reach, and "δW is linear" is a statement about a
    // range rather than about a parameter.
    const slow = scaleRow(buildNominal(singlet(10)), 0, "curvature");
    const fast = scaleRow(buildNominal(singlet(30)), 0, "curvature");
    expect(slow.nonlinearity).toBeLessThan(0.4);
    expect(fast.nonlinearity).toBeGreaterThan(0.9);
    // Both still land on the budget, because the bisection does not care.
    expect(slow.sigmaAtFullScale).toBeCloseTo(MARECHAL_WAVES, 4);
    expect(fast.sigmaAtFullScale).toBeCloseTo(MARECHAL_WAVES, 4);
  });
});

describe("Part B — a σ has no sign and an image does", () => {
  it("the same |σ| costs the star two different Strehls either side of zero", () => {
    // § 5t pins every external rung on a PERFECT nominal, "the one place the
    // currency's design subtlety cannot bite". This nominal is a real N-BK7/F2
    // doublet at f/5 with 0.032 waves of spherical residual, so a conic error
    // parallel to that residual cancels it in one direction and doubles it in
    // the other, at the same |σ| to three digits.
    const rows = (fraction: number): Row[] => [
      { surface: 0, target: "conic", fraction },
      { surface: 0, target: "tiltY", fraction: 0 },
      { surface: 0, target: "curvature", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ];
    const plus = run(rows(1));
    const minus = run(rows(-1));
    expect(plus.combinedWaves).toBeCloseTo(minus.combinedWaves, 2);
    expect(plus.combinedWaves).toBeCloseTo(MARECHAL_WAVES, 3);
    // Same budget, and the two images are nothing like each other.
    expect(minus.strehlRatio / plus.strehlRatio).toBeGreaterThan(1.3);
    // Maréchal, which reads the σ, cannot see the difference at all.
    expect(plus.strehlMarechal).toBeCloseTo(minus.strehlMarechal, 2);
  });

  it("the exposure reference is the nominal's, so the two frames are comparable", () => {
    const result = run([
      { surface: 0, target: "conic", fraction: 1 },
      { surface: 0, target: "tiltY", fraction: 0 },
      { surface: 0, target: "curvature", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ]);
    expect(result.rgbaNominal).toHaveLength(result.size * result.size * 4);
    expect(result.rgbaPerturbed).toHaveLength(result.size * result.size * 4);
    // A degraded star is dimmer at its core on the SHARED scale. Read on the
    // pixels, because the shared exposure is a display claim and the display is
    // where it has to hold.
    const peak = (rgba: Uint8ClampedArray): number => {
      let best = 0;
      for (let i = 0; i < rgba.length; i += 4) best = Math.max(best, rgba[i]! + rgba[i + 1]! + rgba[i + 2]!);
      return best;
    };
    expect(peak(result.rgbaPerturbed)).toBeLessThan(peak(result.rgbaNominal));
  });

  it("an empty budget leaves the two frames identical, bit for bit", () => {
    // The negative control on the whole pipeline: with every slider at zero the
    // perturbed system IS the nominal, so any difference would be the panel's
    // own machinery rather than a tolerance.
    const result = run(DEFAULT_ZEROS);
    expect(result.rssWaves).toBe(0);
    expect(result.combinedWaves).toBe(0);
    expect(result.strehlRatio).toBe(1);
    expect(Array.from(result.rgbaPerturbed)).toEqual(Array.from(result.rgbaNominal));
  });
});

const DEFAULT_ZEROS: readonly Row[] = [
  { surface: 0, target: "curvature", fraction: 0 },
  { surface: 0, target: "conic", fraction: 0 },
  { surface: 1, target: "decenterX", fraction: 0 },
  { surface: 0, target: "tiltY", fraction: 0 },
];
