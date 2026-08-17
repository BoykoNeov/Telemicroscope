import { describe, expect, it } from "vitest";
import {
  coherentSource,
  diskSource,
  idealPupil,
  imageHarmonic,
  onlySymmetricPairPasses,
  phaseGratingObject,
  type CondenserSource,
} from "../src/illumination";
import { renderBrightfield, type PatchPupil } from "../src/imaging";
import { besselJ } from "../src/math";
import { fitZernike, pupilFunctionFromOpd, type PupilFunction } from "../src/wave";
import { opdMap, pupilGrid } from "../src/pupil";
import { bestFocus, withFocus } from "../src/analysis";
import {
  infinityCorrectedMicroscope,
  listerObjective,
  microscopeObjective,
  tubeLens,
} from "../src/designs";
import { LINE_D } from "../src/materials/dispersion";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6ab.16 — the same harmonics through a pupil that was TRACED, which § 6ab.15
 * left open in two words that turn out to name the wrong thing.
 *
 * The open item read: "everything here is `idealPupil` … a real objective is not
 * exactly even, so the parity cancellation should degrade to that asymmetry
 * rather than to zero — nothing measures how far." The asymmetry is there and it
 * is not the answer. A traced objective takes the h = 1 reading from 1.5e-16 to
 * **0.52**, and it does so through a pupil whose asymmetry accounts for 3.1e-7
 * of it — six orders down, and measurable only because this file measures it
 * separately.
 *
 * ## What actually fails is REALNESS, and evenness survives untouched
 *
 * The parity argument pairs the term at (s, n) with the term at (−s, −n−h), and
 * an even pupil sends the second's pupil factor to the **conjugate** of the
 * first's. Conjugate is enough only when the factor is real. So:
 *
 *  - an even, real pupil gives T + T′ = J·J·(X − X) = 0 — the null;
 *  - an even, COMPLEX pupil gives T + T′ = J·J·2i·Im(X) — no null at all.
 *
 * `defocusedPupil` is the second case and § 6ab.15 measured it as one. A traced
 * objective at best focus is the same case for a duller reason: whatever residual
 * the trace leaves, its wavefront is not zero, so the pupil is not real. It does
 * not have to be lopsided, and this file shows it is not: symmetrizing the pupil
 * — averaging its amplitude with A(−p) and its phase with W(−p), which makes an
 * even pupil by construction — leaves the lift unchanged to five figures.
 *
 * ## The even harmonics survive, and the closed form gains a factor rather than
 * an error term
 *
 * Where the symmetric pair is alone, one term survives in `c_h`, and the
 * magnitude of one product term does not depend on its phase. So through ANY
 * pupil, aberrated however badly,
 *
 *     contrast(h·ν) · mean = 2·J_{h/2}(φ)² · A(+mν) · A(−mν),   m = h/2
 *
 * where A is the pupil's own amplitude. § 6ab.15's 2·J_{h/2}(φ)² is the A = 1
 * case of it, and against a real objective the bare form is **18.4% out for one
 * and 26.3% for the other — the same fraction at h = 2, 4, 6 and 8**, which is
 * what a transmission looks like and what an aberration never does.
 *
 * It also retires the argument § 6ab.15 gave for defocus-invariance. That
 * argument was that the pair sits at one radius, so an EVEN aberration gives both
 * members the same phase and the beat cancels it. True, and too specific: the
 * off-axis pupil below has 0.17 waves of ODD wavefront between the pair's two
 * members and the closed form still holds to 1e-14, because one term's magnitude
 * has no phase in it to cancel.
 */

const SIZE = 128;
const IDEAL = idealPupil();

/** f64 roundoff on a reading whose neighbours are O(0.1) — § 6ab.15's ceiling. */
const NULL_CEILING = 1e-13;

interface Traced {
  readonly pupil: PupilFunction;
  readonly rmsWaves: number;
}

/**
 * The § 6f.10 recipe, unchanged: best focus by minimum RMS wavefront, one OPD map
 * on a 21-ring grid, a 28-term Zernike fit, and `pupilFunctionFromOpd` to make a
 * pupil of it. Nothing here is built for this file — the point is that the pupil
 * the imaging branch already uses for a real objective is the one being asked.
 */
function tracedPupil(system: OpticalSystem, fieldMm = 0): Traced {
  const focus = bestFocus(system, "minRmsWavefront", { wavelengthNm: LINE_D });
  const map = opdMap(withFocus(system, focus.offsetFromLastVertex), fieldMm, LINE_D, pupilGrid(21));
  return { pupil: pupilFunctionFromOpd(map, fitZernike(map.samples, 28)), rmsWaves: map.rmsWaves };
}

const low = tracedPupil(
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1 }),
    tubeLens: tubeLens(),
  }).system,
);
const lister = tracedPupil(
  infinityCorrectedMicroscope({
    objective: listerObjective({ magnification: 20, numericalAperture: 0.25 }),
    tubeLens: tubeLens(),
  }).system,
);
/** The same Lister 0.3 mm off the axis, where the wavefront picks up coma and
 *  stops being even at all — the case the open item thought was the whole story. */
const offAxis = tracedPupil(
  infinityCorrectedMicroscope({
    objective: listerObjective({ magnification: 20, numericalAperture: 0.25 }),
    tubeLens: tubeLens(),
  }).system,
  0.3,
);

interface Cell {
  pupilSamples: number;
  cycles: number;
  phi: number;
  source: CondenserSource;
  size?: number;
}

/** Contrast and amplitude at h·ν, both read off one render — § 6ab.15's helper. */
function reading(pupil: PupilFunction, cell: Cell, h: number): { contrast: number; amplitude: number } {
  const size = cell.size ?? SIZE;
  const object = phaseGratingObject({ size, cycles: cell.cycles, amplitudeRadians: cell.phi });
  const out = renderBrightfield(object, (): PatchPupil => ({ pupil }), cell.source, {
    pupilSamples: cell.pupilSamples,
    patches: 1,
  });
  const read = imageHarmonic(out.intensity, size, h * cell.cycles);
  return { contrast: read.contrast, amplitude: read.contrast * read.dc };
}

/** P with its phase thrown away: even-or-not amplitude, and REAL. */
function amplitudeOnly(p: PupilFunction): PupilFunction {
  return { amplitude: p.amplitude, phaseWaves: () => 0 };
}

/** P's own phase on a perfect disc: complex, and even to whatever the trace left. */
function phaseOnly(p: PupilFunction): PupilFunction {
  return { amplitude: IDEAL.amplitude, phaseWaves: p.phaseWaves };
}

/**
 * An even pupil built from this one: A and W each averaged against their own
 * value at −p. NOT (P(p) + P(−p))/2, which is a different operation — a complex
 * average does not preserve the modulus and can cancel to zero where this cannot.
 * What is wanted is a pupil satisfying A(−p) = A(p) and W(−p) = W(p), and this is
 * the cheapest one that keeps both magnitudes recognisable.
 */
function evenPart(p: PupilFunction): PupilFunction {
  return {
    amplitude: (px, py) => (p.amplitude(px, py) + p.amplitude(-px, -py)) / 2,
    phaseWaves: (px, py) => (p.phaseWaves(px, py) + p.phaseWaves(-px, -py)) / 2,
  };
}

/** ν = 2·6/32 = 0.375: orders |m| ≤ 2 pass, and h = 1…5 all fit the grid. */
const ODD_CELL: Omit<Cell, "source"> = { pupilSamples: 32, cycles: 6, phi: 1.5 };
const coherentCell = (): Cell => ({ ...ODD_CELL, source: coherentSource() });

describe("§ 6ab.16 — a traced objective lifts the odd harmonics, and not by a residual", () => {
  it("orders the lift by the wavefront it came from", () => {
    // 0.018, 0.040 and 0.217 waves RMS. The ideal pupil is the same cell at
    // 1.5e-16, so this is a range of sixteen orders opened by three real lenses.
    expect(low.rmsWaves).toBeLessThan(lister.rmsWaves);
    expect(lister.rmsWaves).toBeLessThan(offAxis.rmsWaves);

    const h1 = [IDEAL, low.pupil, lister.pupil, offAxis.pupil].map(
      (p) => reading(p, coherentCell(), 1).contrast,
    );
    // Measured: 1.486e-16, 0.2295, 0.5164, 1.2492.
    expect(Math.abs(h1[0]!)).toBeLessThan(NULL_CEILING);
    expect(h1[1]!).toBeGreaterThan(0.2);
    expect(h1[2]!).toBeGreaterThan(0.5);
    expect(h1[3]!).toBeGreaterThan(1.2);
    expect(h1[1]!).toBeLessThan(h1[2]!);
    expect(h1[2]!).toBeLessThan(h1[3]!);

    // And h = 3 comes up with it, as § 6ab.15's parity law says it must: the two
    // are one statement, so a lens that lifts one and not the other would be a
    // finding about the law rather than about the lens. 0.0979, 0.2101, 0.2462.
    const h3 = [low.pupil, lister.pupil, offAxis.pupil].map(
      (p) => reading(p, coherentCell(), 3).contrast,
    );
    expect(Math.abs(reading(IDEAL, coherentCell(), 3).contrast)).toBeLessThan(NULL_CEILING);
    for (const v of h3) expect(v).toBeGreaterThan(0.09);
  });

  it("is the PHASE, and the asymmetry it was predicted to be is 1.6 million times too small", () => {
    const full = reading(lister.pupil, coherentCell(), 1).contrast;

    // Keep the traced phase, throw the traced amplitude away: the whole lift is
    // still there, to five figures (0.51637 against 0.51637).
    expect(reading(phaseOnly(lister.pupil), coherentCell(), 1).contrast).toBeCloseTo(full, 4);

    // Keep the traced amplitude, throw the phase away: the pupil is REAL, and the
    // reading falls to 3.1e-7 — not roundoff, because a fitted amplitude is not
    // exactly even, and that residual asymmetry IS what the open item predicted
    // would be the whole effect. It is 1.6e6 times smaller than the effect.
    const asymmetry = Math.abs(reading(amplitudeOnly(lister.pupil), coherentCell(), 1).contrast);
    expect(asymmetry).toBeGreaterThan(1e-8);
    expect(asymmetry).toBeLessThan(1e-5);
    expect(full / asymmetry).toBeGreaterThan(1e5);

    // The off-axis pupil is the asymmetric one — coma, 0.17 waves of odd
    // wavefront between ±0.75 — and its amplitude-only twin still reads 1.2e-5
    // against a full reading of 1.25. Asymmetry is real and it is never the lift.
    const offAsym = Math.abs(reading(amplitudeOnly(offAxis.pupil), coherentCell(), 1).contrast);
    expect(offAsym).toBeLessThan(1e-4);
  });

  it("survives being made exactly even, which is the whole of the correction", () => {
    // Averaging A and W each against their value at −p is even by construction,
    // so a null that needed evenness
    // would come back here. It does not move at all: 0.51637 both ways.
    const full = reading(lister.pupil, coherentCell(), 1).contrast;
    expect(reading(evenPart(lister.pupil), coherentCell(), 1).contrast).toBeCloseTo(full, 4);

    // Even the comatic pupil, whose odd part is large, keeps its lift when
    // symmetrized — 1.272 against 1.249, a 1.8% move on a reading that started
    // sixteen orders above the null.
    const offFull = reading(offAxis.pupil, coherentCell(), 1).contrast;
    const offEven = reading(evenPart(offAxis.pupil), coherentCell(), 1).contrast;
    expect(Math.abs(offEven / offFull - 1)).toBeLessThan(0.05);
    expect(offEven).toBeGreaterThan(1.2);
  });

  it("leaves h = 5 at roundoff through every one of them — the OTHER null, again", () => {
    // § 6ab.15 told the parity null apart from § 6ab.12's support null with a
    // defocus slider: under a coherent source at ν = 0.375 only |m| ≤ 2 pass, no
    // order pair 5 apart exists, and h = 5 cannot move whatever the pupil does.
    // A traced objective is the second control that separates them, and it
    // separates them harder — the parity null goes to 1.25 and this one does not
    // move at all. Measured 8.6e-16, 7.4e-16, 1.1e-15.
    for (const p of [low.pupil, lister.pupil, offAxis.pupil]) {
      expect(Math.abs(reading(p, coherentCell(), 5).contrast)).toBeLessThan(NULL_CEILING);
    }
  });
});

/** § 6ab.15's family, unchanged: ν strictly inside (1/(M+1), 1/M) with M = h/2. */
const FAMILY: { h: number; pupilSamples: number; cycles: number; nu: number }[] = [
  { h: 2, pupilSamples: 32, cycles: 12, nu: 0.75 },
  { h: 4, pupilSamples: 32, cycles: 6, nu: 0.375 },
  { h: 6, pupilSamples: 32, cycles: 5, nu: 0.3125 },
  { h: 8, pupilSamples: 64, cycles: 7, nu: 0.21875 },
];

const TRACED: [string, Traced][] = [
  ["4×/0.10", low],
  ["Lister 20×/0.25", lister],
  ["Lister at 0.3 mm", offAxis],
];

describe("§ 6ab.16 — the even family survives a real lens, with the transmission in it", () => {
  for (const [name, traced] of TRACED) {
    it(`holds through the ${name} pupil at h = 2, 4, 6 and 8`, () => {
      for (const phi of [0.4, 1.5, 3]) {
        for (const { h, pupilSamples, cycles, nu } of FAMILY) {
          const m = h / 2;
          const cell: Cell = { pupilSamples, cycles, phi, source: coherentSource() };
          const measured = reading(traced.pupil, cell, h).amplitude;
          // The closed form with the pupil's own transmission at the pair's own
          // two coordinates. Written out here rather than behind a helper for
          // the same reason § 6ab.15 writes 2·J_{h/2}(φ)² out: it is the rung.
          const closed =
            2 *
            besselJ(m, phi) ** 2 *
            traced.pupil.amplitude(m * nu, 0) *
            traced.pupil.amplitude(-m * nu, 0);
          // Worst across the three pupils, four harmonics and three φ: 6.5e-12
          // relative, which at h = 8, φ = 0.4 is 1e-16 absolute — the closed form
          // there is 8.9e-9 and the ideal pupil misses it by the same 1.4e-8.
          expect(Math.abs(measured - closed), `${name} h=${h} φ=${phi}`).toBeLessThan(1e-13);
        }
      }
    });
  }

  it("and the predicate still says where, having never looked at a wavefront", () => {
    for (const [, traced] of TRACED) {
      for (const { h, pupilSamples, cycles } of FAMILY) {
        expect(
          onlySymmetricPairPasses(traced.pupil, coherentSource(), { cycles, pupilSamples, harmonic: h }),
        ).toBe(true);
      }
    }
  });

  it("misses the bare 2·J_{h/2}(φ)² by ONE fraction at four harmonics, which is a transmission", () => {
    // The four harmonics put their pair at three distinct radii — 0.75 twice,
    // then 0.9375 and 0.875 — so an aberration would miss by more than one
    // amount and a transmission by exactly one. Measured: 0.18423 at every h for the 4×, 0.26322
    // at every h for the Lister, agreeing across h to better than 1e-3 relative.
    for (const [name, traced] of TRACED) {
      const deficits = FAMILY.map(({ h, pupilSamples, cycles, nu }) => {
        const m = h / 2;
        const cell: Cell = { pupilSamples, cycles, phi: 1.5, source: coherentSource() };
        const measured = reading(traced.pupil, cell, h).amplitude;
        const bare = 2 * besselJ(m, 1.5) ** 2;
        // A(+mν)·A(−mν), not A(mν)²: the fitted amplitude is not exactly even and
        // the two differ by 8e-8 here, which is the same asymmetry the odd
        // harmonics read above and the same size.
        const transmission = traced.pupil.amplitude(m * nu, 0) * traced.pupil.amplitude(-m * nu, 0);
        return { deficit: 1 - measured / bare, transmission, bare };
      });
      for (const d of deficits) {
        expect(d.deficit, name).toBeGreaterThan(0.15);
        // Each one IS the transmission at that radius, to the f64 the family
        // holds to — the deficit is not fitted, it is read off the pupil. The
        // bound is the rung above's own 1e-13 carried through the division by
        // 2·J_{h/2}(1.5)², which is 0.0109 at h = 8, rather than a new number.
        expect(Math.abs(d.deficit - (1 - d.transmission)), name).toBeLessThan(1e-13 / d.bare);
      }
      const spread = Math.max(...deficits.map((d) => d.deficit)) / Math.min(...deficits.map((d) => d.deficit));
      expect(spread - 1, name).toBeLessThan(1e-3);
    }
  });

  it("has no phase in it AT ALL, which the comatic pupil says and defocus could not", () => {
    // § 6ab.15 argued the invariance from evenness: the pair is at one radius, so
    // an even aberration gives both members one phase. The off-axis pupil breaks
    // that premise — W(+0.75, 0) − W(−0.75, 0) is 0.17 waves — and the closed
    // form does not care, because |P(+mν)·P̄(−mν)| is a product of two moduli.
    const odd = offAxis.pupil.phaseWaves(0.75, 0) - offAxis.pupil.phaseWaves(-0.75, 0);
    expect(Math.abs(odd)).toBeGreaterThan(0.1);

    const cell: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source: coherentSource() };
    const closed =
      2 *
      besselJ(1, 1.5) ** 2 *
      offAxis.pupil.amplitude(0.75, 0) *
      offAxis.pupil.amplitude(-0.75, 0);
    expect(Math.abs(reading(offAxis.pupil, cell, 2).amplitude - closed)).toBeLessThan(1e-13);
  });

  it("departs off the axis in proportion to the wavefront, which is the app's own gate", () => {
    // § 6ab.15's `pairPhaseSurvives`: with more than one direction, the surviving
    // terms are at |s ± mν| and carry different phases, so their MAGNITUDES stop
    // adding. There it was a defocus slider; here it is three real lenses, and the
    // departure follows their RMS wavefront — 1.2e-4, 8.5e-4, 0.22 at S = 0.1.
    const errors = TRACED.map(([, traced]) => {
      const cell: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source: diskSource(0.1, 11) };
      const closed =
        2 * besselJ(1, 1.5) ** 2 * traced.pupil.amplitude(0.75, 0) * traced.pupil.amplitude(-0.75, 0);
      return Math.abs(reading(traced.pupil, cell, 2).amplitude - closed) / closed;
    });
    expect(errors[0]!).toBeLessThan(errors[1]!);
    expect(errors[1]!).toBeLessThan(errors[2]!);
    expect(errors[0]!).toBeLessThan(1e-3);
    expect(errors[2]!).toBeGreaterThan(0.1);

    // The ideal pupil over the same extended source is exact, so what moved is the
    // wavefront and not the source.
    const idealCell: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source: diskSource(0.1, 11) };
    expect(Math.abs(reading(IDEAL, idealCell, 2).amplitude - 2 * besselJ(1, 1.5) ** 2)).toBeLessThan(
      1e-13,
    );
  });
});
