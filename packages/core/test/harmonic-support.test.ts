import { describe, expect, it } from "vitest";
import {
  annularSource,
  apertureCarriesHarmonic,
  coherentSource,
  diskSource,
  harmonicSupportWeight,
  idealPupil,
  imageHarmonic,
  intensityCutoff,
  phaseGratingObject,
} from "../src/illumination";
import { renderBrightfield, type PatchPupil } from "../src/imaging";
import type { PupilFunction } from "../src/wave";

/**
 * § 6ab.12 — whether a grating's harmonic exists at all, before anything asks
 * how big it is.
 *
 * § 6ab.11 built a probe that reports what the phase panel's source-samples
 * control does to its 2ν reading, and left two things on the open list: whether
 * darkfield at 7 samples should be reachable, and whether a rim-weight criterion
 * could replace four renders. Both were framed as **threshold** questions — how
 * few annulus points is too few — and there is no threshold here to find. There
 * is a geometric fact instead:
 *
 * A grating diffracts into orders at s + m·ν. The image is |Σ orders|², so its
 * harmonic at h·ν comes only from beats between order pairs h apart, and those
 * sit h·ν apart in the pupil. **The harmonic exists only if some illuminated
 * direction puts both members of one such pair inside the objective pupil.** No
 * wavefront, no φ, no defocus — geometry, and exact.
 *
 * That criterion has two legs, `apertureCarriesHarmonic` for the aperture and
 * `harmonicSupportWeight` for the sampled source an image was formed from, and
 * they disagree in both directions. Each disagreement is a defect the panel was
 * shipping:
 *
 *  - **aperture yes, sampling no** — A3's darkfield ring at 7 samples holds 16
 *    points and *none* of them is in the band that carries 2ν at ν = 0.75. The
 *    panel printed 8.8e-17 there, which reads as "darkfield has no second
 *    harmonic". § 6ab.11 measured the 2.3e13 spread and could not name the cause.
 *  - **aperture no, sampling yes** — at ν = 1 exactly the carrying set is the
 *    single on-axis direction. Zero area, so a real aperture carries nothing, but
 *    a lattice with a point at the origin gives it finite weight and reads 8e-4.
 *    § 6ab.11 recorded that number's 9.4× disagreement as a *structural property
 *    of the rim*; it is an artifact of area zero given finite weight.
 *  - **neither** — and this is the one that looked most settled. At ν = 1.9375
 *    the four samplings agree to **1.031×**, the tightest agreement anywhere in
 *    the panel, because all four are reading f64 roundoff. § 6ab.11 used exactly
 *    that cell as its evidence that high S is not uniformly bad.
 *
 * The closed-form leg is pinned on two external numbers rather than on itself:
 * at h = 1 it **recovers** `intensityCutoff` — Abbe's (1 + S) law, which § 6f
 * pins against the textbook — and at h = 2 it caps ν at 1 because 2ν must clear
 * the incoherent cutoff 2. Neither is written down here; both fall out of the
 * order geometry, which is what makes this a check and not a restatement.
 */

const PUPIL = idealPupil();

/** A3's darkfield ring, whose 2ν reading is what sent this rung looking. */
const DARK_INNER = 1.1;
const DARK_OUTER = 1.4;

describe("§ 6ab.12 — the closed-form leg recovers the two cutoffs the engine already pins", () => {
  it("at h = 1 it IS Abbe's (1 + S) law, found from the order geometry", () => {
    // `intensityCutoff` is 1 + min(S, 1) and § 6f pins it against
    // d = λ/(NA_obj + NA_cond). Here nothing writes that down: the question asked
    // is only "can two orders one ν apart both be inside the pupil, from some
    // direction in a disc of radius S", and the answer flips at exactly (1 + S).
    for (const S of [0.05, 0.25, 0.5, 0.75, 1, 1.5, 3]) {
      const cutoff = intensityCutoff(S);
      // Just inside carries; just outside does not. 1e-9 is far tighter than the
      // 1e-2 grid a sweep would use, and the flip is exact, not asymptotic.
      expect(apertureCarriesHarmonic(0, S, cutoff - 1e-9, 1)).toBe(true);
      expect(apertureCarriesHarmonic(0, S, cutoff + 1e-9, 1)).toBe(false);
    }
  });

  it("and the cap at 2 is the incoherent cutoff, not a separate rule", () => {
    // Opening the condenser past S = 1 buys no further cutoff, which is
    // `intensityCutoff`'s Math.min and here is the pupil's own diameter: two
    // points 2 apart in a disc of radius 1 are the two ends of a diameter.
    expect(apertureCarriesHarmonic(0, 50, 2 - 1e-9, 1)).toBe(true);
    expect(apertureCarriesHarmonic(0, 50, 2, 1)).toBe(false);
    expect(intensityCutoff(50)).toBe(2);
  });

  it("at h = 2 it caps ν at 1 for every S, because 2ν must clear that same 2", () => {
    for (const S of [0.1, 0.5, 1, 1.5, 3, 10]) {
      expect(apertureCarriesHarmonic(0, S, 1 - 1e-9, 2)).toBe(true);
      expect(apertureCarriesHarmonic(0, S, 1, 2)).toBe(false);
      expect(apertureCarriesHarmonic(0, S, 1.9375, 2)).toBe(false);
    }
  });

  it("so a second harmonic past the coherent cutoff does not exist at any S", () => {
    // The panel's ν = 1.9375 cell, which § 6ab.11 read as settled: 2ν = 3.875,
    // nearly twice the incoherent cutoff. Nothing carries it, so there is nothing
    // for four samplings to agree about.
    expect(apertureCarriesHarmonic(0, 1.5, 1.9375, 2)).toBe(false);
    expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, 1.9375, 2)).toBe(false);
  });
});

describe("§ 6ab.12 — a darkfield annulus has its own, lower second-harmonic cutoff", () => {
  it("stops at (1 + outer)/3, which is 0.8 for A3's own ring", () => {
    // Necessary is not sufficient. An annulus starting outside the pupil reaches
    // a pair only by borrowing a whole number of orders, and the smallest usable
    // count is 3 — so the binding condition is 3ν ≤ 1 + outer rather than 2ν < 2.
    const cutoff = (1 + DARK_OUTER) / 3;
    expect(cutoff).toBeCloseTo(0.8, 15);
    expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, cutoff - 1e-9)).toBe(true);
    expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, cutoff + 1e-9)).toBe(false);
    // Which is well below brightfield's 1, so the panel's ν slider crosses it
    // three stops before the reader would expect anything to change.
    expect(cutoff).toBeLessThan(1);
    for (const nu of [0.8125, 0.875, 0.9375]) {
      expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, nu)).toBe(false);
      expect(apertureCarriesHarmonic(0, 1, nu)).toBe(true);
    }
  });

  it("and the formula is the ring's, not A3's — two other rings, same derivation", () => {
    for (const outer of [1.2, 1.4, 1.7, 2]) {
      const cutoff = (1 + outer) / 3;
      expect(apertureCarriesHarmonic(1.1, outer, cutoff - 1e-9)).toBe(true);
      expect(apertureCarriesHarmonic(1.1, outer, cutoff + 1e-9)).toBe(false);
    }
  });

  it("but the grating's OWN line survives where its second harmonic does not", () => {
    // h = 1 needs a pair only ν apart, so the ring still carries the ν term at
    // 0.875 where 2ν is gone. Darkfield does not stop imaging above ν = 0.8; it
    // stops having a second harmonic, and those are different claims.
    expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, 0.875, 1)).toBe(true);
    expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, 0.875, 2)).toBe(false);
  });
});

describe("§ 6ab.12 — positive AREA, which is the ν = 1 defect", () => {
  /**
   * A brute-force scan of the aperture, for comparison. It is the honest way to
   * ask the question and it is *wrong* at ν = 1 — which is the point: any finite
   * set of test directions can land on a measure-zero carrying set and report it
   * as support, and that is exactly what the source lattice does.
   */
  function scanCarries(inner: number, outer: number, nu: number, rings = 120): number {
    let hit = 0;
    let total = 0;
    for (let ir = 0; ir <= rings; ir++) {
      const r = inner + ((outer - inner) * ir) / rings;
      for (let ip = 0; ip < 360; ip++) {
        const phi = (2 * Math.PI * ip) / 360;
        const sx = r * Math.cos(phi);
        const sy = r * Math.sin(phi);
        total++;
        const span = (1 + Math.hypot(sx, sy)) / nu;
        for (let m = Math.ceil(-span) - 1; m <= Math.floor(span) + 1; m++) {
          const a = m * nu + sx;
          const b = (m + 2) * nu + sx;
          if (a * a + sy * sy <= 1 && b * b + sy * sy <= 1) {
            hit++;
            break;
          }
        }
      }
    }
    return hit / total;
  }

  it("agrees with a scan of the aperture wherever the support has area", () => {
    for (const nu of [0.25, 0.5, 0.75, 0.95]) {
      expect(apertureCarriesHarmonic(0, 0.6, nu)).toBe(true);
      expect(scanCarries(0, 0.6, nu)).toBeGreaterThan(0.01);
    }
    for (const nu of [0.7, 0.75, 0.79]) {
      expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, nu)).toBe(true);
      expect(scanCarries(DARK_INNER, DARK_OUTER, nu)).toBeGreaterThan(0);
    }
    for (const nu of [0.81, 0.9, 1.25, 1.9375]) {
      expect(apertureCarriesHarmonic(DARK_INNER, DARK_OUTER, nu)).toBe(false);
      expect(scanCarries(DARK_INNER, DARK_OUTER, nu)).toBe(0);
    }
  });

  it("and the support THINS to that cutoff rather than falling off it", () => {
    // 55% of the ring at ν = 0.25, 19% at 0.7, 6.6% at 0.75, 0.6% at 0.79, and
    // nothing at 0.8. A continuous approach to zero at exactly the closed form's
    // number is the evidence that it is a boundary of the geometry and not an
    // artifact of how the question was asked — and it is also the reason the
    // sampled lattice runs out of points first: at 0.75 a 16-point ring has to
    // find a set covering 6.6% of it, and it does not.
    const fractions = [0.25, 0.5, 0.7, 0.75, 0.79].map((nu) =>
      scanCarries(DARK_INNER, DARK_OUTER, nu),
    );
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeLessThan(fractions[i - 1]!);
    }
    expect(fractions[0]!).toBeGreaterThan(0.5);
    expect(fractions[4]!).toBeLessThan(0.01);
    expect(scanCarries(DARK_INNER, DARK_OUTER, 0.8)).toBe(0);
  });

  it("and disagrees at ν = 1, where the scan is the one that is fooled", () => {
    // The carrying set is s = 0 alone: order −1 at −1 and order +1 at +1, both
    // exactly on the rim. A scan that includes the axis finds it and calls it
    // support; the closed form asks for area and says there is none.
    expect(apertureCarriesHarmonic(0, 0.6, 1)).toBe(false);
    expect(scanCarries(0, 0.6, 1)).toBeGreaterThan(0);
    expect(scanCarries(0, 0.6, 1)).toBeLessThan(0.01);
    // A real objective at exactly its cutoff transmits nothing, so "no area" is
    // the physical answer and the 8e-4 the panel printed there was the lattice's.
  });

  it("refuses the coherent limit rather than answering for it", () => {
    // One direction is not a discretization of an aperture: there is no lattice
    // to compare against, so this leg has nothing to say and says so.
    expect(() => apertureCarriesHarmonic(0, 0, 0.75)).toThrow(/positive area/);
    expect(() => apertureCarriesHarmonic(1.1, 1.1, 0.75)).toThrow(/positive area/);
  });
});

describe("§ 6ab.12 — the sampled leg, and the ring that carries nothing", () => {
  const ring = (samples: number) => annularSource(DARK_OUTER, DARK_INNER, samples);
  const orders = (cycles: number) => ({ cycles, pupilSamples: 32 });

  it("is exactly zero at 7 samples and positive at 11, 15 and 21", () => {
    // ν = 0.75. The ring's carrying band is s_x ∈ [1.25, 1.4] on the axis, and
    // the 7-sample lattice's outermost x is 1.2 — it misses the band entirely.
    // Not "too coarse to resolve": there is no point of it in the set.
    expect(harmonicSupportWeight(PUPIL, ring(7), orders(12))).toBe(0);
    expect(harmonicSupportWeight(PUPIL, ring(11), orders(12))).toBeGreaterThan(0);
    expect(harmonicSupportWeight(PUPIL, ring(15), orders(12))).toBeGreaterThan(0);
    expect(harmonicSupportWeight(PUPIL, ring(21), orders(12))).toBeGreaterThan(0);
  });

  it("and the weight is a point count, so it says how thin the support is", () => {
    // 2 points of 36, 6 of 68, 10 of 128 — uniform weights, so the fractions are
    // 5.6%, 8.8% and 7.8%. Thin, and that is why § 6ab.11's four readings still
    // disagree by 1.35× once they agree that there IS a second harmonic.
    expect(harmonicSupportWeight(PUPIL, ring(11), orders(12))).toBeCloseTo(2 / 36, 12);
    expect(harmonicSupportWeight(PUPIL, ring(15), orders(12))).toBeCloseTo(6 / 68, 12);
    expect(harmonicSupportWeight(PUPIL, ring(21), orders(12))).toBeCloseTo(10 / 128, 12);
  });

  it("is zero at every sampling once the RING stops carrying, at ν > 0.8", () => {
    // The aperture leg said no; the sampled leg has to agree, or one of them is
    // reading a different pupil than the other.
    for (const cycles of [13, 14, 15]) {
      for (const samples of [7, 11, 15, 21]) {
        expect(harmonicSupportWeight(PUPIL, ring(samples), orders(cycles))).toBe(0);
      }
    }
  });

  it("gives the ν = 1 lattice the weight the aperture has no area for", () => {
    // The other direction of disagreement, measured: `diskSource` puts a point at
    // the origin at odd sample counts, the orders land on the rim, and
    // `idealPupil` admits them because its own test is |p| ≤ 1.
    const weight = harmonicSupportWeight(PUPIL, diskSource(0.6, 11), orders(16));
    expect(weight).toBeGreaterThan(0);
    expect(apertureCarriesHarmonic(0, 0.6, 1)).toBe(false);
    // Thin, and it thins with the count — 1/97 against 1/317 — which is the 9.4×
    // "structural" spread § 6ab.11 measured, seen for what it is.
    expect(weight).toBeLessThan(0.02);
    expect(harmonicSupportWeight(PUPIL, diskSource(0.6, 21), orders(16))).toBeLessThan(weight);
  });

  it("asks the PUPIL, so a pupil that closes its rim changes the verdict", () => {
    // Not a hypothetical: the ring at 11 samples carries on two points out of 36,
    // both with their far order near the rim. Re-deriving |p| ≤ 1 here instead of
    // calling `pupil.amplitude` would put the gate one lattice cell from the image
    // it gates, and one cell is the whole verdict.
    const stopped: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py <= 0.81 ? 1 : 0),
      phaseWaves: () => 0,
    };
    expect(harmonicSupportWeight(PUPIL, ring(11), orders(12))).toBeGreaterThan(0);
    expect(harmonicSupportWeight(stopped, ring(11), orders(12))).toBe(0);
  });

  it("and the coherent limit is exact there, needing no aperture leg", () => {
    // One point, and it carries 2ν for every ν < 1 — order −1 and order +1, which
    // is the three-order regime the panel's Bessel comparison lives in.
    expect(harmonicSupportWeight(PUPIL, coherentSource(), orders(12))).toBe(1);
    expect(harmonicSupportWeight(PUPIL, coherentSource(), orders(20))).toBe(0);
  });
});

describe("§ 6ab.12 — the gate against the render, which is what makes it a physics claim", () => {
  const SIZE = 128;
  const PUPIL_SAMPLES = 32;

  /** The 2ν modulation of a rendered image, relative to its own mean. */
  function relativeSecondHarmonic(
    source: Parameters<typeof harmonicSupportWeight>[1],
    cycles: number,
    amplitudeRadians: number,
    size = SIZE,
  ): number {
    const object = phaseGratingObject({ size, cycles, amplitudeRadians });
    const out = renderBrightfield(object, (): PatchPupil => ({ pupil: PUPIL }), source, {
      pupilSamples: PUPIL_SAMPLES,
      patches: 1,
    });
    const h = imageHarmonic(out.intensity, size, 2 * cycles);
    return h.dc > 0 ? h.amplitude / h.dc : 0;
  }

  it("reads f64 roundoff wherever the weight is zero, and 1e-4 upward where it is not", () => {
    // The separation is thirteen orders wide with nothing in between, which is why
    // the gate needs no threshold. φ = 0.4 throughout; the top of the φ slider is
    // the next rung, and it is not this clean.
    const cells = [
      { source: annularSource(DARK_OUTER, DARK_INNER, 7), cycles: 12 },
      { source: annularSource(DARK_OUTER, DARK_INNER, 21), cycles: 13 },
      { source: annularSource(DARK_OUTER, DARK_INNER, 21), cycles: 15 },
      { source: diskSource(0.6, 21), cycles: 20 },
      { source: diskSource(1.5, 21), cycles: 31 },
    ];
    for (const { source, cycles } of cells) {
      expect(harmonicSupportWeight(PUPIL, source, { cycles, pupilSamples: PUPIL_SAMPLES })).toBe(0);
      expect(relativeSecondHarmonic(source, cycles, 0.4)).toBeLessThan(1e-13);
    }
    const carrying = [
      { source: annularSource(DARK_OUTER, DARK_INNER, 11), cycles: 12 },
      { source: annularSource(DARK_OUTER, DARK_INNER, 21), cycles: 12 },
      { source: diskSource(0.6, 21), cycles: 12 },
      { source: diskSource(1.5, 21), cycles: 12 },
    ];
    for (const { source, cycles } of carrying) {
      expect(
        harmonicSupportWeight(PUPIL, source, { cycles, pupilSamples: PUPIL_SAMPLES }),
      ).toBeGreaterThan(0);
      expect(relativeSecondHarmonic(source, cycles, 0.4)).toBeGreaterThan(1e-4);
    }
  });

  it("but a zero-weight cell can read 6.8e-7 at φ = 3 — and that is ALIASING", () => {
    // The one place the roundoff floor does not hold, found by asking for it at the
    // top of the φ slider rather than assuming φ = 0.4 generalized.
    //
    // A phase grating has orders at every integer m with amplitude J_m(φ), and on
    // a 128-bin grid at 13 cycles they wrap past |m| = 5. A wrapped order sits at
    // a coordinate that is not m·ν, so it can re-enter the pupil, and pairs are
    // 2·cycles apart in BIN space whether or not they are 2ν apart in the pupil.
    // At φ = 3, J₇(3)·J₉(3) ≈ 3e-7, which is what comes out.
    const ring = annularSource(DARK_OUTER, DARK_INNER, 21);
    expect(harmonicSupportWeight(PUPIL, ring, { cycles: 13, pupilSamples: PUPIL_SAMPLES })).toBe(0);
    const narrow = relativeSecondHarmonic(ring, 13, 3, 128);
    expect(narrow).toBeGreaterThan(1e-7);
    // ν is 2·cycles/pupilSamples, so widening the grid changes only where the
    // orders wrap — same aperture, same ν, same φ, same source. Nine orders of
    // collapse names the cause: at 256 bins the wrap moves to |m| = 10 and
    // J₁₀(3) = 1.3e-5 takes the pair with it.
    expect(relativeSecondHarmonic(ring, 13, 3, 256)).toBeLessThan(1e-14);
    expect(narrow / relativeSecondHarmonic(ring, 13, 3, 256)).toBeGreaterThan(1e8);
  });

  it("and it does not touch a reading that has real support", () => {
    // Aliasing adds ~1e-7 wherever it adds anything, so it is invisible against a
    // genuine 2ν of order 1e-1 — identical to five figures across three grids.
    // Which is why this is a gate on existence and not a correction on precision:
    // it is only ever the whole reading, or nothing.
    const ring = annularSource(DARK_OUTER, DARK_INNER, 21);
    const at128 = relativeSecondHarmonic(ring, 12, 3, 128);
    // 0.0878 — five orders above the 6.8e-7 the rung above measured aliasing at.
    expect(at128).toBeGreaterThan(0.08);
    expect(relativeSecondHarmonic(ring, 12, 3, 256)).toBeCloseTo(at128, 5);
    expect(relativeSecondHarmonic(ring, 12, 3, 512)).toBeCloseTo(at128, 5);
  });

  it("and support is defocus-free, unlike the spread it gates", () => {
    // `idealPupil` and `defocusedPupil` are the same disc, so one computation
    // covers both frames of A3's pair — where § 6ab.11 found the *spread* needed
    // two probes because the beat picks up 4·w₂₀·(s·ν) off axis. Existence is
    // geometry; magnitude is not.
    const defocused: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
      phaseWaves: (px, py) => 6 * (px * px + py * py),
    };
    const ring = annularSource(DARK_OUTER, DARK_INNER, 7);
    const args = { cycles: 12, pupilSamples: PUPIL_SAMPLES };
    expect(harmonicSupportWeight(defocused, ring, args)).toBe(
      harmonicSupportWeight(PUPIL, ring, args),
    );
    expect(harmonicSupportWeight(defocused, diskSource(0.9, 15), args)).toBe(
      harmonicSupportWeight(PUPIL, diskSource(0.9, 15), args),
    );
  });
});
