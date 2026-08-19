import { describe, expect, it } from "vitest";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  type StopPlacement,
} from "../src/designs/microscope";
import { pupils } from "../src/pupil/pupils";
import { seidelSums } from "../src/analysis/seidel";
import { imageRadiusForObjectHeight } from "../src/imaging/object-field";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { opdMap } from "../src/pupil/opd";
import { marginalRay, pupilGrid } from "../src/pupil/aiming";
import { traceRay } from "../src/trace/sequential";
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
 * not — and two more that five other files had been quoting by number before
 * anyone wrote them.
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
 * ## 3 and 4. Two rungs that were cited before they existed
 *
 * **Eight citations across five files**, counted rather than estimated:
 * `doublet-wall` ×3 (two for the clipping, one for the ceiling), `microscope`
 * ×2, `object-field`, and the app's `builder` and `golden` each point a reader
 * at "§ 6ai.4" for the clipping or at "§ 6ai.6" for the control's own ceiling.
 * Neither rung was ever written: this step shipped § 6ai.1 and § 6ai.2 and
 * nothing else, so every one of those citations named a measurement that did not
 * exist. **A cross-reference is a readout too** — the
 * same shape § 1.8.12 found in a doc comment that stated a wrong diagnosis as a
 * finding — and both are written here, measured rather than assumed:
 *
 *  - **§ 6ai.4.** The telecentric member's diaphragm is sized paraxially, so the
 *    real marginal ray outgrows it: at 4× it lands outside above **NA 0.1461**,
 *    which two independent machineries agree on (a traced ray's height over the
 *    surface's semi-aperture, carrying no fixture; and `opdMap`'s lost count,
 *    which does not move between grids of 11, 21 and 41). The rim member cannot
 *    do it at any aperture — its stop IS its launch aperture — and that is why
 *    `doublet-wall`'s far-band rungs name it. The crossing sits ABOVE the
 *    Maréchal reach on every member, by 42% at 4× closing to 13% at 40×, so no
 *    diffraction-limited objective is affected. The prose those call sites carry
 *    said "about NA 0.17"; it is 0.1461, and this rung is the correction.
 *  - **§ 6ai.6.** The two members' Maréchal reaches, side by side: 0.16% apart
 *    at 4× and 0.68% at 40×. The optical ceiling § 6b.5.1 bisects is the glass's,
 *    not the diaphragm's — which is what makes that step's shipped-member reach
 *    and rim-member far band halves of one statement rather than two yardsticks.
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

/**
 * The bisection § 6b.5's ceiling rungs use, repeated here because the subject is
 * the difference between two members and not the ceiling itself. Same bounds,
 * same step count and the same criterion, so the 4× value below is the number
 * `doublet-wall` already pins and this file is not free to disagree with it.
 */
const highest = (lo: number, hi: number, ok: (x: number) => boolean, steps = 26): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < steps; i++) {
    const m = 0.5 * (a + b);
    if (ok(m)) a = m;
    else b = m;
  }
  return a;
};

const MARECHAL = 1 / 14;

const objectiveFor = (M: number, NA: number, placement?: StopPlacement) =>
  finiteConjugateObjective({
    magnification: M,
    numericalAperture: NA,
    ...(placement === undefined ? {} : { stopPlacement: placement }),
  });

const scopeAt = (M: number, NA: number, placement?: StopPlacement): OpticalSystem =>
  finiteConjugateMicroscope({ objective: objectiveFor(M, NA, placement) }).system;

/** The axial wavefront map at best focus, in the currency § 6b.4 reports in. */
const mapAt = (M: number, NA: number, placement?: StopPlacement) => {
  const s = scopeAt(M, NA, placement);
  const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
  return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, L, pupilGrid(21));
};

/**
 * How much of its own diaphragm the REAL marginal ray fills, as a ratio.
 *
 * The diaphragm is sized paraxially — that is what makes the aperture a slope
 * (§ 6ae.2) — so the ray that actually arrives is free to land outside it, and a
 * ratio past 1 is that happening. Nothing here counts samples: the quantity is
 * one traced ray's height over one surface's semi-aperture, so it carries no
 * fixture in it and moves with the lens alone.
 */
const diaphragmFill = (M: number, NA: number, placement?: StopPlacement): number => {
  const system = scopeAt(M, NA, placement);
  const p = system.prescription;
  expect(p.surfaces.filter((s) => s.isStop).length).toBe(1);
  const stop = p.surfaces.findIndex((s) => s.isStop);
  const hit = traceRay(p, marginalRay(system, pupils(system, L), 0, L)).path[stop];
  expect(hit).toBeDefined();
  return Math.hypot(hit!.x, hit!.y) / p.surfaces[stop]!.semiAperture;
};

/** The highest NA whose axial wavefront clears Maréchal on an UNCLIPPED pupil. */
const marechalReach = (M: number, placement?: StopPlacement): number =>
  highest(0.05, 0.3, (NA) => {
    try {
      const map = mapAt(M, NA, placement);
      return map.lost === 0 && map.rmsWaves <= MARECHAL;
    } catch {
      return false;
    }
  });

/** The NA at which the real marginal ray first lands outside the diaphragm. */
const fillCrossing = (M: number): number =>
  highest(
    0.05,
    0.28,
    (NA) => {
      try {
        return diaphragmFill(M, NA) <= 1;
      } catch {
        return false;
      }
    },
    30,
  );

describe("§ 6ai.4 — the shipped member clips its own diaphragm, and where", () => {
  it("the real marginal ray overfills the paraxial diaphragm above NA 0.1461", () => {
    // The claim seven call sites — `doublet-wall` ×2, `microscope` ×2,
    // `object-field`, and the app's `builder` and `golden` — already make in
    // prose, measured here for the first time. Sized paraxially, the diaphragm
    // is a hole the aberrated ray is under no obligation to pass, and past this
    // aperture it does not. The catalogued 4×/0.10 is 0.7% inside it.
    expect(diaphragmFill(4, 0.1)).toBeCloseTo(0.99286, 5);
    expect(diaphragmFill(4, 0.1)).toBeLessThan(1);
    expect(fillCrossing(4)).toBeCloseTo(0.146146, 5);
    // Monotone through it, which is what makes one crossing the whole story.
    expect(diaphragmFill(4, 0.14)).toBeLessThan(1);
    expect(diaphragmFill(4, 0.16)).toBeGreaterThan(1);
    expect(diaphragmFill(4, 0.2)).toBeGreaterThan(diaphragmFill(4, 0.16));
  });

  it("and the sampled pupil agrees — the first ray lost is the marginal one", () => {
    // Two machineries, and the second is the one every wavefront rung actually
    // runs: `opdMap` counts what it could not get through. It has a grid in it
    // and the rung above does not, so if the two crossings agreed by accident
    // the count would move with the sampling. It does not move — the outermost
    // sample of a square grid clipped to the disc IS the marginal ray at every
    // odd resolution — so the threshold is the lens's and not the fixture's.
    const lostAt = (NA: number, n: number): number => {
      const s = scopeAt(4, NA);
      const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
      return opdMap(withFocus(s, focus.offsetFromLastVertex), 0, L, pupilGrid(n)).lost;
    };
    for (const n of [11, 21, 41]) {
      expect(lostAt(0.145, n)).toBe(0);
      expect(lostAt(0.15, n)).toBeGreaterThan(0);
    }
  });

  it("the RIM control cannot do it, which is why the far band is measured on it", () => {
    // Not a leftover and not caution — an identity. The rim member's stop IS its
    // launch aperture, so a ray aimed through it arrives through it and the fill
    // cannot reach 1 at any aperture the constructor will build. What is left
    // below 1 is the glass around the hole, and it barely moves.
    expect(diaphragmFill(4, 0.1, "rim")).toBeCloseTo(0.87864, 5);
    expect(diaphragmFill(4, 0.2, "rim")).toBeCloseTo(0.89339, 5);
    for (const NA of [0.1, 0.14, 0.16, 0.2]) {
      expect(diaphragmFill(4, NA, "rim")).toBeLessThan(1);
      expect(mapAt(4, NA, "rim").lost).toBe(0);
    }
    // …while the shipped member loses rays over the same sweep, 28 of this grid
    // at the top of it. An RMS over a clipped pupil is a different quantity from
    // the one Maréchal's criterion is stated on, which is the whole reason
    // `doublet-wall`'s far-band rungs name `"rim"`.
    expect(mapAt(4, 0.16).lost).toBe(8);
    expect(mapAt(4, 0.2).lost).toBe(28);
  }, 30_000);

  it("and it reads SMALLER when it clips — the guard is not bookkeeping", () => {
    // The failure mode `sigmaWaves`' `expect(map.lost).toBe(0)` exists to catch.
    // Losing the outer pupil removes the rays carrying the most aberration, so
    // the clipped member's wavefront RMS comes back BELOW the unclipped
    // control's: a plausible smaller number arriving as an improvement rather
    // than as a failure. The two members are the same glass to the bit
    // (§ 6ae.4), so the whole of the difference is which rays survived.
    for (const NA of [0.16, 0.17, 0.2]) {
      expect(mapAt(4, NA).rmsWaves).toBeLessThan(mapAt(4, NA, "rim").rmsWaves);
    }
    expect(mapAt(4, 0.17).rmsWaves / mapAt(4, 0.17, "rim").rmsWaves).toBeCloseTo(0.8086, 3);
  }, 30_000);

  it("but it never bites inside the band a wavefront claim is made in", () => {
    // Why none of the above is a defect in the shipped lens. The crossing sits
    // above the Maréchal reach on every member, so an objective that is
    // diffraction-limited at all passes its own diaphragm whole. The margin is
    // not constant — the reach climbs faster than the crossing does — and it is
    // quoted here so that a member built past 40× is checked rather than assumed.
    const rows = [4, 20, 40].map((M) => ({ M, crossing: fillCrossing(M), reach: marechalReach(M) }));
    expect(rows[0]!.crossing).toBeCloseTo(0.146146, 5);
    expect(rows[2]!.crossing).toBeCloseTo(0.205083, 5);
    for (const r of rows) expect(r.crossing).toBeGreaterThan(r.reach);
    expect(rows[0]!.crossing / rows[0]!.reach).toBeCloseTo(1.4196, 3);
    expect(rows[2]!.crossing / rows[2]!.reach).toBeCloseTo(1.1298, 3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.crossing / rows[i]!.reach).toBeLessThan(
        rows[i - 1]!.crossing / rows[i - 1]!.reach,
      );
    }
  }, 60_000);
});

describe("§ 6ai.6 — the optical ceiling is the GLASS's, not the diaphragm's", () => {
  it("both members reach Maréchal within 0.7%, and the gap grows with M", () => {
    // What § 6b.5.1's ceiling survives. That step bisected the diffraction-limit
    // reach on the shipped member and read the far band on the rim one, and a
    // reader is entitled to ask whether the two halves are commensurable. They
    // are: the placement moves the reach by 0.16% at 4× and 0.68% at 40×, which
    // is the diaphragm's whole say in a ceiling that ΣS_I = 0 and the higher
    // orders left over set. Both legs require `lost === 0`, so these are two
    // unvignetted numbers rather than two yardsticks — and § 6ai.4 is what makes
    // that possible, every reach here sitting below its own crossing.
    const rows = [4, 20, 40].map((M) => {
      const shipped = marechalReach(M);
      const rim = marechalReach(M, "rim");
      return { M, shipped, rim, ratio: rim / shipped };
    });
    // The 4× value is § 6b.5.1's own, and this file is not free to disagree.
    expect(rows[0]!.shipped).toBeCloseTo(0.10295, 4);
    expect(rows[0]!.rim).toBeCloseTo(0.103114, 5);
    expect(rows[2]!.shipped).toBeCloseTo(0.181517, 5);
    expect(rows[2]!.rim).toBeCloseTo(0.182742, 5);
    for (const r of rows) {
      // The control always reaches slightly FURTHER, and the sign is the point:
      // it has no diaphragm to fill, so nothing but the glass limits it.
      expect(r.ratio).toBeGreaterThan(1);
      expect(r.ratio).toBeLessThan(1.007);
      expect(mapAt(r.M, r.shipped).lost).toBe(0);
      expect(mapAt(r.M, r.rim, "rim").lost).toBe(0);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.ratio).toBeGreaterThan(rows[i - 1]!.ratio);
    }
    expect(rows[0]!.ratio).toBeCloseTo(1.00159, 5);
    expect(rows[2]!.ratio).toBeCloseTo(1.00675, 5);
  }, 60_000);
});
