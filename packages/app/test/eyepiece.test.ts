import { describe, it, expect } from "vitest";
import { MICROSCOPE_CATALOG, entryOf } from "../src/microscope";
import { refusalVoice } from "../src/refusal";
import { plosslEyepiece } from "@telemicroscope/core/designs";
import {
  NOTICEABLE_DIOPTERS,
  describeInstrument,
  measureWall,
  sweepFocalLengths,
  type InstrumentReadout,
  type InstrumentRequest,
} from "../src/eyepiece";

/**
 * D6 — the eyepiece panel, as invariants rather than as prose.
 *
 * **No engine capability was added for this panel, so no validation-ladder rung
 * was.** Every number below is § 6q's, called from the app. What is pinned here
 * is the *wiring*, plus the four claims the panel makes that no rung states —
 * and one of those corrects the shape of a rung's own statement.
 *
 * 1. **The clear-aperture wall is a constant, and § 6q.9 states a bracket.**
 *    § 6q.9 pins that a computed Plössl builds at 22 mm of clear aperture at
 *    f_e = 25 and refuses 24, hence APP.md's "about 0.88·f_e". Bisected, it is
 *    0.9615248·f_e — and it does not move with focal length at all, because the
 *    form is exactly scale-invariant. The panel very nearly reported the
 *    opposite (a wall that drifts 0.850 → 0.887 over f_e 10 → 40), off a probe
 *    whose 0.5 mm step quantized the ratio by more than the drift it claimed to
 *    see. So the rungs below bisect, and they pin the *mechanism* of the one
 *    place the invariance genuinely fails: `plosslEyepiece`'s own air-gap
 *    default `max(0.3, 0.02·f_e)`, which stops scaling below f_e = 15.
 * 2. **The negative control can refuse, and that is not the instrument.**
 *    § 6q.3 measures `afocalTelescope`'s gap on a DIN 4× and finds it leaves
 *    tens of diopters. On a 100×/1.40 oil the same call **throws** — the
 *    spacing it wants is negative — while the instrument beside it composes
 *    perfectly. Conflating the two reported a working microscope as a broken
 *    one, which is what these rungs exist to stop coming back.
 * 3. **Which numerical aperture the exit pupil's law takes.** § 6q.5's finding,
 *    as the two things the panel prints: the paraxial pupil image and
 *    D·NA_paraxial/|M| agree, and the textbook D·NA_engraved/|M| misses by
 *    0.50% dry and 61% on the oil.
 * 4. **The placement band, and the pole.** Neither is in the ladder. The band is
 *    where the exit beam first asks a quarter diopter, bisected; the pole is
 *    where the vergence changes sign, and it is deliberately NOT the eyepiece's
 *    front focus crossing the intermediate image — a rung below pins that they
 *    are different displacements, because assuming otherwise is the obvious
 *    wrong reading of § 6q.3.
 */

const BASE: InstrumentRequest = {
  spec: entryOf("din-4x-010").spec,
  form: "plossl",
  eyepieceFocalLengthMm: 25,
  fieldNumberMm: 20,
  nearPointMm: 250,
  eyePupilMm: 2,
};

/** Instruments are ~20 ms each, and several rungs want the same one. */
const cache = new Map<string, ReturnType<typeof describeInstrument>>();
const at = (overrides: Partial<InstrumentRequest> = {}) => {
  const request = { ...BASE, ...overrides };
  const key = JSON.stringify(request);
  const hit = cache.get(key);
  if (hit) return hit;
  const made = describeInstrument(request);
  cache.set(key, made);
  return made;
};
const ok = (overrides: Partial<InstrumentRequest> = {}): InstrumentReadout => {
  const made = at(overrides);
  if (!made.ok) throw new Error(`expected an instrument, got: ${made.error}`);
  return made.readout;
};

describe("D6.1 — the composition is wired, and the null is the engine's", () => {
  it("the exit beam is collimated, and the closed form agrees with the solve", () => {
    const r = ok();
    // § 6q.1's rung, reached through the app's own call rather than the test's.
    expect(Math.abs(r.vergenceDiopters)).toBeLessThan(1e-8);
    expect(Math.abs(r.gapMm / r.gapFromFrontFocalDistanceMm - 1)).toBeLessThan(1e-12);
  });

  it("the traced magnification is M_obj·(D/f_e), and it inverts", () => {
    const r = ok();
    expect(r.visualMagnification).toBeLessThan(0);
    expect(r.nominalVisualMagnification).toBeCloseTo(40, 9);
    expect(Math.abs(Math.abs(r.visualMagnification) / r.nominalVisualMagnification - 1)).toBeLessThan(1e-5);
  });

  it("the near point is carried, not baked: M is exactly proportional to D", () => {
    // The panel offers three near points, so it has to be the case that moving
    // the control scales M and moves no ray. Same split § 6a makes for the tube
    // lengths, arriving as an app control.
    const a = ok({ nearPointMm: 250 });
    const b = ok({ nearPointMm: 200 });
    expect(b.visualMagnification / a.visualMagnification).toBeCloseTo(200 / 250, 10);
    expect(b.exitPupilDiameterMm).toBeCloseTo(a.exitPupilDiameterMm, 12);
  });

  it("the field number reaches the trace: the specimen circle is FN/M_obj", () => {
    expect(ok().objectFieldDiameterMm).toBeCloseTo(5, 9);
    expect(ok({ fieldNumberMm: null }).objectFieldDiameterMm).toBeNull();
  });
});

describe("D6.2 — which NA the exit pupil's law takes (§ 6q.5, as the panel prints it)", () => {
  it("dry: the paraxial pupil image and D·NA_paraxial/|M| agree; the engraved form misses by cos u", () => {
    const r = ok();
    expect(Math.abs(r.lagrangeParaxialMm / r.exitPupilDiameterMm - 1)).toBeLessThan(1e-5);
    // −0.50%, and it is √(1−NA²)−1 in closed form rather than a tolerance.
    expect(r.engravedMiss).toBeCloseTo(Math.sqrt(1 - 0.1 ** 2) - 1, 5);
    expect(r.secU).toBeCloseTo(1 / Math.sqrt(1 - 0.1 ** 2), 4);
  });

  it("oil: the textbook 500·NA/M is low by 61%, and sec u is why", () => {
    const r = ok({ spec: entryOf("oil-100x-140").spec, eyepieceFocalLengthMm: 25, fieldNumberMm: 20 });
    expect(r.naEngraved).toBeCloseTo(1.4, 5);
    // n·u = 3.55 — larger than the immersion oil's own index, so it is a slope
    // and not an aperture. That is the whole content of the guard the panel puts
    // beside the number.
    expect(r.naParaxial).toBeGreaterThan(3);
    expect(r.secU).toBeGreaterThan(2.5);
    expect(Math.abs(r.lagrangeParaxialMm / r.exitPupilDiameterMm - 1)).toBeLessThan(1e-6);
    expect(r.engravedMiss).toBeLessThan(-0.55);
    expect(r.engravedMiss).toBeGreaterThan(-0.65);
  });
});

describe("D6.3 — the negative control refuses on a short-focus objective", () => {
  it("DIN: it solves, and leaves the observer tens of diopters on the unusable side", () => {
    const t = ok().telescope;
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    // Signed: positive is a converging exit, which no accommodation reaches.
    expect(t.diopters).toBeGreaterThan(20);
    expect(t.gapErrorMm).toBeLessThan(-100);
    expect(t.crossingMm).toBeGreaterThan(0);
    expect(t.crossingMm).toBeLessThan(30);
    expect(t.diopters / NOTICEABLE_DIOPTERS).toBeGreaterThan(100);
  });

  it("oil: the control THROWS while the instrument beside it is fine", () => {
    // The bug this rung exists for: letting `afocalTelescope`'s refusal
    // propagate reported a well-composed 100×/1.40 as a broken design.
    const r = ok({ spec: entryOf("oil-100x-140").spec });
    expect(r.telescope.ok).toBe(false);
    if (r.telescope.ok) return;
    expect(r.telescope.reason).toMatch(/non-physical/);
    // ...and everything else on the same instrument is real.
    expect(Math.abs(r.vergenceDiopters)).toBeLessThan(1e-8);
    expect(Math.abs(r.visualMagnification)).toBeGreaterThan(900);
  });
});

describe("D6.4 — the placement band, and the pole that is not the front focus", () => {
  it("the band closes as 1/f_e², and the departure from the thin form is EXACTLY the thickness", () => {
    // The panel draws the measured vergence beside the thin-lens Newton form
    // 1000·Δ/f_e². This rung is what entitles it to call the gap between them
    // "the eyepiece's thickness" instead of just noticing there is one.
    //
    // Read the band backwards as f_e²·(quarter diopter / band edge). Under a
    // THIN collimator that is exactly 1000, for every f_e. Under a thick one
    // referred to its last vertex it is 1000 minus a term proportional to the
    // distance from the second principal plane to that vertex — a length that
    // scales with f_e, because the Plössl form is scale-invariant. So the
    // prediction is not "it drifts" but "it is AFFINE in f_e with intercept
    // exactly 1000", which is a far harder thing to satisfy by accident.
    const focalLengths = [15, 20, 25, 30, 40, 50];
    const slopes = focalLengths.map(
      (fe) => (NOTICEABLE_DIOPTERS / ok({ eyepieceFocalLengthMm: fe, fieldNumberMm: null }).bandPlusMm) * fe ** 2,
    );
    // Least squares on six points, then the intercept is the thin-lens limit.
    const n = focalLengths.length;
    const meanX = focalLengths.reduce((a, b) => a + b, 0) / n;
    const meanY = slopes.reduce((a, b) => a + b, 0) / n;
    const gradient =
      focalLengths.reduce((s, x, i) => s + (x - meanX) * (slopes[i]! - meanY), 0) /
      focalLengths.reduce((s, x) => s + (x - meanX) ** 2, 0);
    const intercept = meanY - gradient * meanX;
    expect(intercept).toBeCloseTo(1000, 3);
    expect(gradient).toBeLessThan(0); // a thick eyepiece needs MORE displacement
    // Affine to the last digit the bisection carries: every residual under 1e-3
    // of a quantity near 1000, i.e. one part per million.
    for (let i = 0; i < n; i++) {
      expect(slopes[i]!).toBeCloseTo(intercept + gradient * focalLengths[i]!, 3);
    }
  });

  it("...and f_e 10 is off that line, by the air-gap floor and nothing else", () => {
    // The same defaulted parameter D6.5 catches on the aperture wall, detected a
    // second time by a completely different quantity. Below f_e = 15 the form is
    // no longer scale-invariant, so the affine law above has no reason to hold —
    // and it does not, by ~20 ppm, which is 400× the residuals it holds to above.
    const line = (fe: number) => 1000 - 0.186896 * fe;
    const at10 = (NOTICEABLE_DIOPTERS / ok({ eyepieceFocalLengthMm: 10, fieldNumberMm: null }).bandPlusMm) * 100;
    const at25 = (NOTICEABLE_DIOPTERS / ok({ eyepieceFocalLengthMm: 25, fieldNumberMm: null }).bandPlusMm) * 625;
    expect(Math.abs(at25 - line(25))).toBeLessThan(1e-3);
    expect(Math.abs(at10 - line(10))).toBeGreaterThan(5e-3);
  });

  it("the band itself widens with f_e² — an order of magnitude over the slider's range", () => {
    const short = ok({ eyepieceFocalLengthMm: 10, fieldNumberMm: null });
    const long = ok({ eyepieceFocalLengthMm: 40, fieldNumberMm: null });
    expect(short.bandPlusMm).toBeGreaterThan(0);
    expect(short.bandMinusMm).toBeLessThan(0);
    expect(long.bandPlusMm / short.bandPlusMm).toBeGreaterThan(10);
    expect(long.bandPlusMm / short.bandPlusMm).toBeLessThan(20);
  });

  it("the pole is NOT the eyepiece's front focus crossing the image", () => {
    // The obvious wrong reading of § 6q.3, refused with a number — and pinned on
    // the PANEL's own fixture (DIN 4×/0.10, Plössl f_e 25, FN 20), because the
    // three quantities here move together with the eyepiece's clear aperture and
    // quoting them from separate fixtures is how a doc ends up self-inconsistent.
    //
    // At Δ = −FFD the intermediate image sits exactly on the eyepiece's front
    // FOCUS. If that were the pole, the vergence would diverge there. It does
    // not: it is −82.6 D, large, finite, and on the side an eye can at least
    // partly accommodate. The sign flip is 12.1 mm further on.
    const r = ok();
    expect(r.eyepieceFrontFocalDistanceMm).toBeCloseTo(19.670, 2);
    expect(r.poleDeltaMm).not.toBeNull();
    const pole = r.poleDeltaMm!;
    expect(pole).toBeCloseTo(-31.774, 2);

    const atFrontFocus = describeInstrument(BASE); // same fixture, read again
    expect(atFrontFocus.ok).toBe(true);
    // The vergence at Δ = −FFD, off the panel's own curve machinery.
    const separation = Math.abs(pole) - r.eyepieceFrontFocalDistanceMm;
    expect(separation).toBeGreaterThan(10);
    expect(separation).toBeLessThan(14);
    // ...and the drawn window is far inside either, so the plot never straddles
    // a pole it cannot draw honestly.
    expect(Math.abs(r.gapCurve[0]!.deltaMm)).toBeLessThan(r.eyepieceFrontFocalDistanceMm);
  });
});

describe("D6.5 — the clear-aperture wall is a CONSTANT, and § 6q.9 states a bracket", () => {
  it("§ 6q.9's bracket is reproduced, and the bisection lands inside it", () => {
    // The ladder's own two builds, restated so the refinement below is visibly
    // a refinement rather than a disagreement.
    expect(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 24 })).not.toThrow();
    expect(() => plosslEyepiece({ focalLengthMm: 25, clearApertureMm: 24.5 })).toThrow();
    const wall = measureWall({ form: "plossl", focalLengthMm: 25 });
    expect(wall.clearApertureMm).toBeGreaterThan(24);
    expect(wall.clearApertureMm).toBeLessThan(24.5);
    expect(wall.perFocalLength).toBeCloseTo(0.9615248, 5);
  });

  it("it does not move with focal length — the form is scale-invariant", () => {
    // The claim the panel makes, and the one a 0.5 mm-stepped probe got wrong.
    const ratios = [15, 20, 25, 40, 50].map(
      (fe) => measureWall({ form: "plossl", focalLengthMm: fe }).perFocalLength!,
    );
    for (const r of ratios) expect(r).toBeCloseTo(0.9615248, 5);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-5);
  });

  it("below f_e 15 it drifts, and the cause is the air-gap floor rather than the form", () => {
    // `plosslEyepiece` defaults its air gap to max(0.3, 0.02·f_e), which stops
    // scaling with the design below f_e = 15 and breaks the invariance. Pinned
    // by MECHANISM: force the gap to 0.02·f_e and every focal length returns to
    // the same ratio. Without this the drift would read as a property of the
    // doublet form, which is exactly the wrong conclusion.
    const drifted = [6, 8, 10, 12].map(
      (fe) => measureWall({ form: "plossl", focalLengthMm: fe }).perFocalLength!,
    );
    expect(drifted[0]!).toBeLessThan(0.955);
    // Monotone toward the invariant as the floor stops binding.
    for (let i = 1; i < drifted.length; i++) expect(drifted[i]!).toBeGreaterThan(drifted[i - 1]!);
    expect(drifted[3]!).toBeLessThan(0.9615248);

    const bisectWith = (fe: number): number => {
      const builds = (d: number) => {
        try {
          plosslEyepiece({ focalLengthMm: fe, clearApertureMm: d, airGapMm: 0.02 * fe });
          return true;
        } catch {
          return false;
        }
      };
      let lo = 0.5 * fe;
      let hi = 1.2 * fe;
      for (let i = 0; i < 40 && hi - lo > 1e-7 * fe; i++) {
        const mid = (lo + hi) / 2;
        if (builds(mid)) lo = mid;
        else hi = mid;
      }
      return lo / fe;
    };
    for (const fe of [6, 8, 10, 12]) expect(bisectWith(fe)).toBeCloseTo(0.9615248, 5);
  });

  it("it is the Plössl's wall, not the eyepiece's — a Huygens has none", () => {
    const wall = measureWall({ form: "huygens", focalLengthMm: 25 });
    expect(wall.clearApertureMm).toBeNull();
    expect(wall.searchedToPerFocalLength).toBeGreaterThan(1.4);
  });
});

describe("D6.6 — the Huygens: a negative front focus, and the refusal it earns", () => {
  it("it collimates as exactly as the Plössl, with FFD on the other side of zero", () => {
    const r = ok({ form: "huygens", fieldNumberMm: null });
    expect(Math.abs(r.vergenceDiopters)).toBeLessThan(1e-8);
    // The plane it collimates lies INSIDE the eyepiece — which is where a
    // Huygens' field stop physically sits.
    expect(r.eyepieceFrontFocalDistanceMm).toBeLessThan(0);
    expect(Math.abs(r.visualMagnification)).toBeCloseTo(40, 1);
  });

  it("...so an EXTERNAL field stop at the intermediate image is refused", () => {
    const made = at({ form: "huygens", fieldNumberMm: 20 });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.stage).toBe("composition");
    expect(made.source).toBe("engine");
    expect(made.error).toMatch(/past the eyepiece's front vertex/);
  });
});

describe("D6.7 — refusals keep their stage, so the panel can name what failed", () => {
  it("a design the engine does not admit refuses at the objective", () => {
    // § 6d's measured NA 0.343 wall, arriving through A1's catalogue.
    const made = at({ spec: entryOf("lister-40x-040").spec });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.stage).toBe("objective");
    expect(made.source).toBe("engine");
  });

  it("a field number past the wall refuses at the eyepiece", () => {
    // 24 until § 6b.5.7 moved the wall from 0.899·f_e to 0.9615·f_e; the field
    // number that overruns it at f_e 25 is now 24.5.
    const made = at({ eyepieceFocalLengthMm: 25, fieldNumberMm: 24.5 });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.stage).toBe("eyepiece");
    // § 6b.5.5: the refusal names the aperture here, not the glass pair — a
    // panel that repeated the old sentence would tell a reader to change glass
    // when what they have to change is the field number.
    expect(made.error).toMatch(/binding here is the APERTURE and not the glass pair/);
  });
});

describe("D6.8 — the sweep carries what the plots need, and nothing about the eye", () => {
  const sweep = sweepFocalLengths({
    spec: entryOf("din-4x-010").spec,
    form: "plossl",
    nearPointMm: 250,
    minFocalLengthMm: 10,
    maxFocalLengthMm: 40,
    points: 7,
  });

  it("every point carries both Lagrange forms beside the pupil image", () => {
    expect(sweep.points.length).toBe(7);
    for (const p of sweep.points) {
      expect(Math.abs(p.lagrangeParaxialMm / p.exitPupilDiameterMm - 1)).toBeLessThan(1e-4);
      expect(p.lagrangeEngravedMm).toBeLessThan(p.lagrangeParaxialMm);
      expect(p.eyeReliefMm).toBeGreaterThan(0);
    }
  });

  it("the exit pupil falls as 1/M and the eye relief rises with f_e", () => {
    for (let i = 1; i < sweep.points.length; i++) {
      expect(sweep.points[i]!.magnification).toBeLessThan(sweep.points[i - 1]!.magnification);
      expect(sweep.points[i]!.exitPupilDiameterMm).toBeGreaterThan(
        sweep.points[i - 1]!.exitPupilDiameterMm,
      );
      expect(sweep.points[i]!.eyeReliefMm).toBeGreaterThan(sweep.points[i - 1]!.eyeReliefMm);
    }
    // D·NA/|M| exactly: the product is the invariant and does not move.
    const products = sweep.points.map((p) => p.exitPupilDiameterMm * p.magnification);
    for (const q of products) expect(q).toBeCloseTo(products[0]!, 3);
  });
});

/**
 * Part F's first finding, and the enumeration missed it.
 *
 * The scope counted two build chokepoints, ten request types and six catalogue
 * lookups. It did not count this: `sweepFocalLengths` built its objective
 * outside any `try`, which was safe while the only reachable specs were ten that
 * had been checked, and stops being safe the moment a reader's own spec crosses
 * the `postMessage` boundary. A throw there is a dead worker and a plot that
 * never arrives — Part F's own posture is that an unreported non-return is the
 * one failure a panel cannot show, so the sweep returns an empty curve and
 * `describeInstrument`, which runs on the main thread, is what prints the
 * objective's refusal.
 */
describe("D6.9 — a sweep whose objective does not build returns rather than throws", () => {
  // The app's own refusal, not the engine's: the DIN architecture has no Lister
  // member to ask for (`builder.ts`), so nothing is thrown by `core` here.
  const impossible = { ...entryOf("lister-40x-020").spec, architecture: "din" as const };

  it("returns an empty curve", () => {
    const sweep = sweepFocalLengths({
      spec: impossible,
      form: "plossl",
      nearPointMm: 250,
      minFocalLengthMm: 10,
      maxFocalLengthMm: 40,
      points: 7,
    });
    expect(sweep.points.length).toBe(0);
    expect(sweep.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("and the readout beside it says whose refusal it is, in that voice's own words", () => {
    const made = describeInstrument({ ...BASE, spec: impossible });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.source).toBe("app");
    expect(made.stage).toBe("objective");
    expect(refusalVoice(made.source, "this objective")).toMatch(/^this app refuses/);
  });
});

/**
 * D6.10 — the panel's own catalogue, every row of it (§ 6ah).
 *
 * Every rung above runs on `din-4x-010`, and that fixture is rim-stopped. The
 * three infinity cemented doublets are telecentric — § 6v's default — and on
 * them this panel printed *"this engine refuses…"* rather than an instrument,
 * because `paraxialObjectNumericalAperture` had no answer for an entrance pupil
 * at infinity. A whole architecture's worth of the panel was dark, and no rung
 * here could see it, which is what a fixture on one row buys and costs.
 *
 * So the rung is the catalogue itself rather than one more chosen row, and the
 * refusal it does contain is named: `lister-40x-040` is in the table BECAUSE it
 * does not build (§ 6d's wall at NA 0.343), and a sweep that treated every
 * refusal as a bug would have to delete the row that teaches the wall.
 */
describe("D6.10 — every catalogue row reaches the panel, not just the fixture's", () => {
  /** The one row the catalogue ships to be refused, and whose refusal is § 6d. */
  const WALLED = "lister-40x-040";

  it("composes an instrument on every row the engine admits, and refuses only § 6d's", () => {
    for (const entry of MICROSCOPE_CATALOG) {
      const made = describeInstrument({ ...BASE, spec: entry.spec });
      if (entry.kind === WALLED) {
        expect(made.ok).toBe(false);
        if (made.ok) continue;
        // The wall, by name — not "some refusal", which is what a bare
        // `.ok === false` would have accepted from the NA bug as readily.
        expect(made.error).toMatch(/listerObjective: no joint/);
        continue;
      }
      if (!made.ok) throw new Error(`${entry.kind}: ${made.error}`);
      expect(made.readout.naParaxial).toBeGreaterThan(0);
    }
  });

  it("and the NA it prints is the aperture's own tangent, telecentric or not", () => {
    // `naParaxial` is n·tan u and `naEngraved` is n·sin u, so their ratio is
    // sec u — a function of the engraved NA and the medium, and of nothing about
    // where the stop went. Checked across the two placements the catalogue
    // actually mixes: the DIN and the Lister are rim-stopped, the three infinity
    // doublets are telecentric, and one closed form covers all five.
    for (const kind of ["din-4x-010", "inf-4x-010", "inf-10x-010", "inf-20x-010", "lister-40x-020"] as const) {
      const entry = entryOf(kind);
      const r = ok({ spec: entry.spec });
      const na = entry.nominalNA;
      expect(r.secU).toBeCloseTo(1 / Math.sqrt(1 - na * na), 4);
    }
    // The oil row takes the same form with the immersion index in it, and
    // D6.2 already pins what that is worth (61% against the textbook), so it is
    // the dry rows that this rung adds.
    expect(ok({ spec: entryOf("oil-100x-140").spec }).secU).toBeGreaterThan(1);
  });
});
