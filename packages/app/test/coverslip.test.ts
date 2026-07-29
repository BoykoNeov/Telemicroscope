import { describe, it, expect } from "vitest";
import {
  MINIMUM_FILM_MM,
  NOMINAL_SLIP_MM,
  OIL_INDEX,
  SLIP_INDEX,
  budgetShare,
  dryToleranceCurve,
  indexSweep,
  predictedNa,
  refocusedFilmMm,
  slipObjective,
  slipReadout,
  slipSweep,
  stopRadiusResidual,
  type SigmaReadout,
  type SlipSweep,
} from "../src/coverslip";

/**
 * A6 — the cover slip panel, as invariants rather than as prose.
 *
 * **No engine capability was added for the panel, so no validation-ladder rung
 * was**: every number here is § 6c's and § 6e.5's, called from the app. (The one
 * engine change A6 forced is § 1.6.1, and it is pinned in `focus.test.ts` where
 * it belongs — the focus solve's own file.) What is pinned below is the
 * *wiring*, plus the three claims the panel makes that no rung states.
 *
 * The first is a refusal. `opdMap` returns an `rmsWaves` whether or not the
 * pupil is whole, and at the thin end of the No. 1.5 band a third of this
 * objective's pupil receives no light at all — the delivered aperture has
 * climbed into § 6e.4's ceiling and the rays have stopped existing. That σ
 * *rises*, smoothly, and drawn as a curve it reads as aberration. Every σ here
 * carries its own `lost` and refuses itself.
 *
 * The second is a correction to APP.md's own A6 bullet, which quotes § 6e.5's
 * "σ flat across 0.15–0.18 mm" as though it were general. It is an **NA 1.00**
 * statement. At 1.25 the same refocused sweep varies 3×, and at 1.40 it has a
 * genuine minimum about 5 µm *under* nominal — because the oil film is the only
 * mismatched layer in the stack, it is rarer than the glass either side of it,
 * and refocusing a thinner slip thickens it. § 6e.4's "the cover slip helps" on
 * a second axis.
 *
 * The third is that the walls are **measured**. § 6e.4's NA 1.411 is a number in
 * the validation ladder and not an engine export, so the adapter bisects for the
 * slip at which the tracer first loses a ray and reads the aperture there. The
 * rungs below check that the measurement lands on the ladder's number; the app
 * never contains it.
 */

const PUPIL_SAMPLES = 21;
const SWEEP = {
  minThicknessMm: 0.15,
  maxThicknessMm: 0.19,
  points: 11,
  pupilSamples: PUPIL_SAMPLES,
} as const;

/** Swept once per aperture — every rung below reads one of these. */
const sweeps = new Map<number, SlipSweep>();
const sweepAt = (numericalAperture: number): SlipSweep => {
  const cached = sweeps.get(numericalAperture);
  if (cached) return cached;
  const swept = slipSweep({ numericalAperture, ...SWEEP });
  sweeps.set(numericalAperture, swept);
  return swept;
};

const sigmaOrThrow = (sigma: SigmaReadout): number => {
  if (!sigma.ok) throw new Error(`expected a σ, got a refusal: ${sigma.reason}`);
  return sigma.sigmaWaves;
};

describe("A6 — a σ over a pupil that lost rays is refused, not drawn", () => {
  it("refuses the thin end at NA 1.40, and says how many rays never left", () => {
    const thin = sweepAt(1.4).points[0]!;
    expect(thin.thicknessMm).toBeCloseTo(0.15, 12);
    expect(thin.refocused.ok).toBe(false);
    if (thin.refocused.ok) throw new Error("unreachable");
    expect(thin.refocused.lost).toBeGreaterThan(0);
    expect(thin.refocused.source).toBe("app");
    expect(thin.refocused.reason).toContain("never left the specimen");
  });

  it("and the number it refuses is a real one that RISES — which is why", () => {
    // The refusal is not protecting against a NaN. The same trace at the same
    // slip produces a perfectly ordinary σ if you ignore `lost`, and it is
    // *larger* than the whole-pupil σ two microns thicker — so a curve drawn
    // without the guard would show aberration climbing toward a thin slip,
    // which is the opposite of what is happening.
    const objective = slipObjective(1.4);
    const thin = 0.15;
    const film = refocusedFilmMm(objective, thin, SLIP_INDEX);
    expect(film).toBeGreaterThan(MINIMUM_FILM_MM);
    const wall = sweepAt(1.4).rayWall!;
    const whole = sigmaOrThrow(
      slipReadout({
        numericalAperture: 1.4,
        thicknessMm: wall.thicknessMm + 0.002,
        deltaN: 0,
        pupilSamples: PUPIL_SAMPLES,
      }).refocused,
    );
    expect(whole).toBeLessThan(0.5 / 14);
    expect(sweepAt(1.4).points[0]!.refocused.ok).toBe(false);
  });

  it("refuses the thick end for a different reason, in the app's own voice", () => {
    // Not a lost ray — the refocus asks for less oil than there is. § 6e.5
    // bounds the band this way rather than by σ, because the σ at a 110 nm film
    // is a real number about an instrument that does not exist.
    const last = sweepAt(1.4).points[sweepAt(1.4).points.length - 1]!;
    expect(last.thicknessMm).toBeCloseTo(0.19, 12);
    expect(last.filmMm).toBeLessThan(0.0002);
    expect(last.refocused.ok).toBe(false);
    if (last.refocused.ok) throw new Error("unreachable");
    expect(last.refocused.reason).toContain("optical contact");
    expect(last.deliveredNa).toBeNull();
  });
});

describe("A6 — both walls are measured, and they land on the ladder's numbers", () => {
  it("bisects the ray wall onto § 6e.4's NA 1.411 and § 6e.5's 0.1613 mm", () => {
    // The app contains neither number. It asks the tracer where it starts
    // losing rays and reads the closed-form aperture there; § 6e.5 predicted
    // 0.1613 mm from the plane-layer height and then confirmed it the same way.
    const wall = sweepAt(1.4).rayWall!;
    expect(wall).not.toBeNull();
    expect(wall.thicknessMm).toBeCloseTo(0.1613, 3);
    expect(wall.deliveredNa).toBeCloseTo(1.411, 3);
  });

  it("finds no ray wall at all at NA 1.00 and 1.25 — which is the finding", () => {
    // The same mechanism exists at every aperture and reaches nothing below
    // 1.40: the delivered NA at the thin end is still far under any ceiling.
    expect(sweepAt(1.0).rayWall).toBeNull();
    expect(sweepAt(1.25).rayWall).toBeNull();
    expect(predictedNa(slipObjective(1.25), 0.15, SLIP_INDEX)).toBeLessThan(1.3);
  });

  it("puts the film wall where the refocus runs out, affinely and not by search", () => {
    const objective = slipObjective(1.4);
    const wall = sweepAt(1.4).filmWallThicknessMm;
    expect(refocusedFilmMm(objective, wall, SLIP_INDEX)).toBeCloseTo(MINIMUM_FILM_MM, 12);
    expect(wall).toBeGreaterThan(NOMINAL_SLIP_MM);
    // Same wall at every aperture: the film is a property of the placement, and
    // the placement is proportional to the dome radius on both sides of it.
    expect(sweepAt(1.0).filmWallThicknessMm).toBeCloseTo(wall, 12);
  });

  it("agrees with the trace on the delivered aperture to 2e-4, where both exist", () => {
    // § 6e.5's rung, at app level: NA(t) = n_slip·h/√(t²+h²) against the
    // marginal ray's own launch angle. Two computations, one aperture.
    for (const p of sweepAt(1.4).points) {
      if (p.deliveredNa === null) continue;
      expect(Math.abs(p.deliveredNa / p.predictedNa - 1)).toBeLessThan(2e-4);
    }
    // And the height the closed form uses IS the design's own stop radius.
    expect(stopRadiusResidual(slipObjective(1.4))).toBeLessThan(1e-12);
  });

  it("signs the aperture drift the surprising way — thinner slip, MORE NA", () => {
    const objective = slipObjective(1.4);
    expect(predictedNa(objective, 0.16, SLIP_INDEX)).toBeGreaterThan(1.4);
    expect(predictedNa(objective, 0.18, SLIP_INDEX)).toBeLessThan(1.4);
  });
});

describe("A6 — 'flat across the band' is an NA 1.00 statement", () => {
  it("holds at NA 1.00: ±20 µm of slip moves σ by under 15%", () => {
    // § 6e.5's own flatness rung, on this panel's sweep.
    const sigmas = sweepAt(1.0)
      .points.filter((p) => p.thicknessMm <= 0.185)
      .map((p) => sigmaOrThrow(p.refocused));
    expect(Math.max(...sigmas) / Math.min(...sigmas)).toBeLessThan(1.15);
    expect(Math.max(...sigmas)).toBeLessThan(0.1 / 14);
  });

  it("and does NOT hold at 1.25, where the same sweep varies 3×", () => {
    const sigmas = sweepAt(1.25)
      .points.filter((p) => p.thicknessMm <= 0.185)
      .map((p) => sigmaOrThrow(p.refocused));
    expect(Math.max(...sigmas) / Math.min(...sigmas)).toBeGreaterThan(2.5);
    // Still nowhere near the budget — "not flat" is not "not diffraction
    // limited", and the panel must not let the first imply the second.
    expect(budgetShare(Math.max(...sigmas))).toBeLessThan(0.35);
  });

  it("and at NA 1.40 the best slip in the band is THINNER than nominal", () => {
    // The panel's caption, as a number. The oil is the only mismatched layer and
    // it is rarer than the glass either side, so its W₀₄₀ is negative and
    // opposes the Lister residual; refocusing a thinner slip thickens the film
    // and buys more of that cancellation. § 6e.4's "the cover slip helps",
    // with the film as the knob.
    const usable = sweepAt(1.4).points.filter((p) => p.refocused.ok);
    const best = usable.reduce((a, b) =>
      sigmaOrThrow(a.refocused) <= sigmaOrThrow(b.refocused) ? a : b,
    );
    const nominal = usable.find((p) => Math.abs(p.thicknessMm - NOMINAL_SLIP_MM) < 1e-9)!;
    expect(best.thicknessMm).toBeLessThan(NOMINAL_SLIP_MM);
    expect(sigmaOrThrow(best.refocused)).toBeLessThan(sigmaOrThrow(nominal.refocused));
    expect(best.filmMm).toBeGreaterThan(nominal.filmMm);
    // Signed: every point's oil layer is a negative contribution.
    for (const p of usable) expect(p.oilW040Waves).toBeLessThan(0);
    expect(OIL_INDEX).toBeLessThan(SLIP_INDEX);
  });
});

describe("A6 — the refocus model is worth an order of magnitude", () => {
  it("keeps NA 1.40 inside budget refocused and blows through it pinned", () => {
    const objective = slipObjective(1.4);
    const nominalFilm = objective.frontGroup.hyperhemisphere.immersionGapMm;
    const readout = slipReadout({
      numericalAperture: 1.4,
      thicknessMm: 0.175,
      deltaN: 0,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(budgetShare(sigmaOrThrow(readout.refocused))).toBeLessThan(0.5);
    expect(budgetShare(sigmaOrThrow(readout.pinned))).toBeGreaterThan(3);
    // The two models differ by the film alone, and at the nominal slip they are
    // the same instrument — so the curves must meet there, exactly.
    const at = slipReadout({
      numericalAperture: 1.4,
      thicknessMm: NOMINAL_SLIP_MM,
      deltaN: 0,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(at.filmMm).toBeCloseTo(nominalFilm, 12);
    expect(sigmaOrThrow(at.refocused)).toBe(sigmaOrThrow(at.pinned));
  });

  it("crosses Maréchal within ±2 µm with the film pinned", () => {
    for (const thicknessMm of [NOMINAL_SLIP_MM - 0.002, NOMINAL_SLIP_MM + 0.002]) {
      const readout = slipReadout({
        numericalAperture: 1.4,
        thicknessMm,
        deltaN: 0,
        pupilSamples: PUPIL_SAMPLES,
      });
      expect(budgetShare(sigmaOrThrow(readout.pinned))).toBeGreaterThan(1);
      expect(budgetShare(sigmaOrThrow(readout.refocused))).toBeLessThan(0.5);
    }
  });
});

describe("A6 — index is the tolerance no refocus reaches", () => {
  const swept = indexSweep({
    numericalAperture: 1.4,
    maxDeltaN: 0.003,
    points: 3,
    pupilSamples: PUPIL_SAMPLES,
  });

  it("costs 1.9× the budget at ±0.003, and refocusing barely helps", () => {
    const [low, middle, high] = swept.points;
    expect(middle!.deltaN).toBeCloseTo(0, 12);
    for (const point of [low!, high!]) {
      expect(budgetShare(sigmaOrThrow(point.pinned))).toBeGreaterThan(1.9);
      // The refocus is real — a wrong index does move t/n — and it is worth
      // ~15%, which leaves the answer outside the budget either way. That is
      // what "refocusing cannot fix index" means, drawn rather than asserted.
      const gain = sigmaOrThrow(point.pinned) / sigmaOrThrow(point.refocused);
      expect(gain).toBeGreaterThan(1);
      expect(gain).toBeLessThan(1.3);
      expect(budgetShare(sigmaOrThrow(point.refocused))).toBeGreaterThan(1.5);
    }
  });

  it("is symmetric in the sign of Δn, unlike a displacement", () => {
    const [low, , high] = swept.points;
    const ratio = sigmaOrThrow(low!.pinned) / sigmaOrThrow(high!.pinned);
    expect(Math.abs(ratio - 1)).toBeLessThan(0.05);
  });

  it("survives the same ±0.003 at NA 1.25 — the cost climbs with aperture", () => {
    const at125 = indexSweep({
      numericalAperture: 1.25,
      maxDeltaN: 0.003,
      points: 3,
      pupilSamples: PUPIL_SAMPLES,
    });
    for (const point of at125.points) {
      expect(budgetShare(sigmaOrThrow(point.pinned))).toBeLessThan(1);
    }
  });
});

describe("A6 — the closed-form dry curve, and the panel's determinism", () => {
  it("runs as 1/NA⁴, from 31 mm at NA 0.10 to 3.9 µm at 0.95", () => {
    const curve = dryToleranceCurve([0.1, 0.2, 0.95]);
    expect(curve[0]!.quarterWaveUm).toBeCloseTo(31457, 0);
    expect(curve[2]!.quarterWaveUm).toBeCloseTo(3.862, 3);
    // 1/NA⁴ exactly: doubling the aperture is a factor of sixteen.
    expect(curve[0]!.quarterWaveUm / curve[1]!.quarterWaveUm).toBeCloseTo(16, 9);
    // A whole 0.17 mm slip is 5.4× the NA 0.10 objective's whole allowance —
    // which is § 6c's null: a 4×/0.10 cannot tell whether a slip is there.
    expect(curve[0]!.quarterWaveUm / (NOMINAL_SLIP_MM * 1000)).toBeGreaterThan(180);
  });

  it("holds Maréchal at a constant 3.833× Rayleigh, at every aperture", () => {
    for (const point of dryToleranceCurve([0.1, 0.35, 0.6, 0.95])) {
      expect(point.marechalUm / point.quarterWaveUm).toBeCloseTo((24 * Math.sqrt(5)) / 14, 12);
    }
  });

  it("names its registered media from the index, so a drag cannot grow the registry", () => {
    // The catalog is process-global. A per-request name would leave one medium
    // behind per slider tick; naming from the value means the same slip is the
    // same medium, and the σ is bit-identical on a second look.
    const request = {
      numericalAperture: 1.25,
      thicknessMm: 0.166,
      deltaN: 0.0015,
      pupilSamples: PUPIL_SAMPLES,
    } as const;
    const first = slipReadout(request);
    const second = slipReadout(request);
    expect(sigmaOrThrow(second.refocused)).toBe(sigmaOrThrow(first.refocused));
    expect(sigmaOrThrow(second.pinned)).toBe(sigmaOrThrow(first.pinned));
    expect(second.slipIndex).toBe(first.slipIndex);
  });
});
