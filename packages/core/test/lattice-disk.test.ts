import { describe, it, expect } from "vitest";
import { abbeImage, cosineGratingObject } from "../src/illumination/abbe";
import {
  latticeDiskSource,
  latticeCutoffGapExists,
  commensurateSource,
  diskSource,
  type CondenserSource,
} from "../src/illumination/source";
import {
  idealPupil,
  defocusedPupil,
  weakObjectTransfer,
  weakObjectTransferDisk,
} from "../src/illumination/transfer";

/**
 * § 6ab — the commensurate condenser at an S that is on no lattice.
 *
 * § 6p's cache is licensed by every source point sitting on the pupil's own
 * frequency lattice, and `commensurateSource` buys that licence by deriving its
 * point *count* from S — so it throws on any S that makes `S·pupilSamples/m` a
 * fraction. A caller with a continuous S therefore had to choose between the
 * cache and the slider.
 *
 * That choice was not a small one. The brightfield panel's central
 * demonstration — an S where the textbook law says the grating is transmitted
 * and the sampled condenser says it is not — lives in a window of S **one
 * lattice cell wide** (0.3125 to 0.3438 at `pupilSamples` 32, which is 10/32 to
 * 11/32). Snapping S to that lattice cannot put a stop strictly inside a window
 * one cell wide; it can only land on the endpoints. So snapping does not
 * degrade the demonstration, it deletes it.
 *
 * `latticeDiskSource` decouples the two. `abbeImage`'s precondition is about
 * COORDINATES — whole numbers of half-steps, one parity — and S enters only
 * through the disc mask. So the grid is a fixed lattice, S is free, and the
 * count follows from `stepMultiple` as a consequence.
 *
 * **This step is § 6p's argument, generalized — not repeated.** What is new is
 * the rung § 6p cannot state: the cached image equals the uncached one *at an S
 * that is on no lattice*, which is the only case that was ever in doubt.
 */

const PS = 32;
const SIZE = 128;
const OBJECT = cosineGratingObject({ size: SIZE, cycles: 8, modulation: 0.4 });

/** The same points, with the declaration stripped — so `abbeImage` cannot cache. */
function uncached(source: CondenserSource): CondenserSource {
  return {
    points: source.points,
    coherenceParameter: source.coherenceParameter,
    samples: source.samples,
  };
}

/**
 * Deliberately awful S: irrational multiples, so no coordinate of the disc
 * mask's radius is a lattice value and `commensurateSource` would refuse every
 * one of them.
 */
const AWKWARD_S = [0.0131, 0.1907, 0.31111, 0.4137, 0.5001, 0.6180339, 0.7853, 0.9021, 1.1027];

describe("§ 6ab.1 — the cache is taken at an S on no lattice, and costs one pass", () => {
  it("evaluates the pupil exactly once over its support, whatever S is", () => {
    const want = (PS + 1) * (PS + 1);
    for (const m of [1, 2, 3, 4]) {
      for (const S of AWKWARD_S) {
        const src = latticeDiskSource(S, PS, m);
        const img = abbeImage(OBJECT, idealPupil(), src, { pupilSamples: PS });
        // The whole speed claim as an integer a test can hold, exactly as
        // § 6p.4 states it: one box, not one box per direction.
        expect(img.pupilEvaluations).toBe(want);
      }
    }
  });

  it("and `commensurateSource` refuses every one of those S, which is the point", () => {
    for (const S of AWKWARD_S) {
      expect(() => commensurateSource(S, PS, 1)).toThrow(/positive integer/);
    }
  });
});

describe("§ 6ab.2 — cached ≡ uncached, BIT FOR BIT, at an S on no lattice", () => {
  for (const m of [1, 2, 3]) {
    for (const S of [0.31111, 0.4137, 0.7853]) {
      it(`stepMultiple ${m}, S = ${S}`, () => {
        for (const pupil of [idealPupil(), defocusedPupil(0.4)]) {
          const src = latticeDiskSource(S, PS, m);
          const hot = abbeImage(OBJECT, pupil, src, { pupilSamples: PS });
          const cold = abbeImage(OBJECT, pupil, uncached(src), { pupilSamples: PS });
          // `toEqual` on a Float64Array is elementwise and exact. § 6p pins the
          // same claim for a commensurate S; this is the case it could not reach.
          expect(hot.intensity).toEqual(cold.intensity);
          // …and the max over directions is the same number, not merely close.
          expect(hot.maxGridPhaseStepWaves).toBe(cold.maxGridPhaseStepWaves);
          expect(hot.contributingPoints).toBe(cold.contributingPoints);
          // The saving is exactly the direction count, § 6p.4's integer.
          expect(cold.pupilEvaluations).toBe(hot.pupilEvaluations * hot.contributingPoints);
        }
      });
    }
  }
});

describe("§ 6ab.3 — every point is on the lattice, at one parity, by construction", () => {
  it("puts every coordinate a whole number of half-steps out, all even", () => {
    for (const ps of [16, 32, 64]) {
      for (const m of [1, 2, 3, 4]) {
        for (const S of AWKWARD_S) {
          const src = latticeDiskSource(S, ps, m);
          for (const p of src.points) {
            // The claim `pupilLattice` makes, asserted rather than trusted: the
            // half-step count is an INTEGER (not merely close to one), and its
            // parity is 0 because an odd `samples` makes (2i + 1 − samples) even
            // whatever the multiple is.
            expect(Number.isInteger(p.sx * ps)).toBe(true);
            expect(Number.isInteger(p.sy * ps)).toBe(true);
            // `Math.abs` because a negative coordinate gives −0 here, and −0 is
            // not 0 to `toBe` — which is `Object.is`, and right to say so.
            expect(Math.abs((p.sx * ps) % 2)).toBe(0);
            expect(Math.abs((p.sy * ps) % 2)).toBe(0);
          }
          expect(src.samples % 2).toBe(1);
        }
      }
    }
  });

  it("weights sum to 1, and S = 0 is the coherent limit rather than a case", () => {
    const src = latticeDiskSource(0, PS, 1);
    expect(src.points.length).toBe(1);
    expect(src.points[0]!.sx).toBe(0);
    expect(src.points[0]!.sy).toBe(0);
    expect(src.points[0]!.weight).toBe(1);
    for (const m of [1, 3]) {
      for (const S of AWKWARD_S) {
        const total = latticeDiskSource(S, PS, m).points.reduce((a, p) => a + p.weight, 0);
        expect(total).toBeCloseTo(1, 12);
      }
    }
  });
});

describe("§ 6ab.4 — the extent is `ceil`, so a point ON the rim is admitted", () => {
  it("keeps the lattice ring at exactly |s| = S — the case `floor` needs an epsilon for", () => {
    // S sits exactly on a lattice radius. `floor(S/spacing)` is the value a
    // division that rounds down would turn into one ring fewer, silently.
    for (const m of [1, 2, 3]) {
      const spacing = (2 * m) / PS;
      for (const rings of [1, 3, 5]) {
        const S = rings * spacing;
        const src = latticeDiskSource(S, PS, m);
        const axial = src.points.filter((p) => p.sy === 0).map((p) => p.sx);
        const reach = Math.max(...axial);
        // The outermost admitted axial point is the rim itself, exactly.
        expect(reach).toBe(S);
        expect(src.points.some((p) => p.sx === S && p.sy === 0)).toBe(true);
      }
    }
  });

  it("never admits a point outside the disc, whatever the extent rounded to", () => {
    for (const m of [1, 2, 3, 4]) {
      for (const S of AWKWARD_S) {
        for (const p of latticeDiskSource(S, PS, m).points) {
          expect(p.sx * p.sx + p.sy * p.sy).toBeLessThanOrEqual(S * S);
        }
      }
    }
  });
});

describe("§ 6ab.5 — the scale moves the lattice without coarsening it", () => {
  it("is § 6p.9's identity: (S, 64, 2) is (S, 32, 1), same points", () => {
    for (const S of AWKWARD_S) {
      const fine = latticeDiskSource(S, 32, 1);
      const wide = latticeDiskSource(S, 64, 2);
      expect(wide.points.length).toBe(fine.points.length);
      for (let i = 0; i < fine.points.length; i++) {
        expect(wide.points[i]!.sx).toBe(fine.points[i]!.sx);
        expect(wide.points[i]!.sy).toBe(fine.points[i]!.sy);
      }
    }
  });
});

describe("§ 6ab.6 — the quadrature, on § 6f.2's own metric", () => {
  /** § 6f.2's `maxTransferError`, in the shape § 6p reuses it in. */
  function maxTransferError(source: CondenserSource, S: number): number {
    let worst = 0;
    for (let k = 1; k <= 40; k++) {
      const nu = (k / 40) * 2;
      worst = Math.max(
        worst,
        Math.abs(weakObjectTransfer(idealPupil(), source, nu) - weakObjectTransferDisk(S, nu)),
      );
    }
    return worst;
  }

  it("converges as the lattice refines, measured at each allowed step", () => {
    // § 6p.10's rule: an allowed count must be MEASURED, because § 6f.2's
    // convergence is explicitly not monotone. So the assertion is on the
    // endpoints of the ladder, and the middle is recorded rather than ordered.
    const S = 0.5;
    const errors = [4, 3, 2, 1].map((m) => maxTransferError(latticeDiskSource(S, PS, m), S));
    expect(errors[0]).toBeGreaterThan(errors[3]!);
    // The finest lattice at pupilSamples 32 clears § 6f.2's "wrong enough to
    // notice" threshold of 3e-2; the coarsest is well past it, which is what
    // makes the knob a teaching control rather than a quality one.
    expect(errors[3]).toBeLessThan(3e-2);
    expect(errors[0]).toBeGreaterThan(3e-2);
  });

  it("is not a worse quadrature per direction than `diskSource`", () => {
    // The headline of the step, and the reason the panel can afford to be more
    // converged than it is today: at S = 0.5 the lattice's 197 directions read
    // BELOW `diskSource`'s 177, and are within a whisker of its 349.
    const S = 0.5;
    const lattice = latticeDiskSource(S, PS, 1);
    expect(lattice.points.length).toBe(197);
    const latticeError = maxTransferError(lattice, S);
    expect(latticeError).toBeLessThan(maxTransferError(diskSource(S, 15), S));
    expect(latticeError).toBeLessThan(2 * maxTransferError(diskSource(S, 21), S));
  });
});

describe("§ 6ab.7 — the cutoff gap is a divisibility law, not a table", () => {
  /**
   * `app/brightfield`'s `latticeReach`, reproduced because core does not import
   * the app: the outermost direction the source HAS and the pupil admits, as a
   * cutoff frequency.
   */
  function latticeReach(source: CondenserSource): number {
    let best = Number.NaN;
    for (const s of source.points) {
      if (s.sx * s.sx + s.sy * s.sy > 1) continue;
      const ceiling = Math.abs(s.sx) + Math.sqrt(1 - s.sy * s.sy);
      if (!(ceiling <= best)) best = ceiling;
    }
    return best;
  }

  /**
   * Is there any S where textbook says transmitted and the lattice says not?
   *
   * **The textbook side is compared in S rather than in ν, and that is not
   * tidiness.** Writing it as `1 + Math.min(S, 1) >= nu` — which is what the
   * plot draws — makes this sweep disagree with the closed form at ν = 1.375,
   * because `S = 0.37499999999999994` is one ulp below the lattice radius 0.375
   * and yet `1 + S` **rounds up** to exactly 1.375. The disc mask is not fooled:
   * it compares S² against the radius² and correctly excludes the ring, so the
   * two sides of the comparison are then reading S at different precisions and
   * a gap appears that is a rounding rather than a place. `min(S, 1) >= nu − 1`
   * is the same statement with no addition in it. (Same family as § 6p.1's
   * 5.6e-17: physically nothing, exactly enough to change an answer.)
   */
  function measuredGapExists(cycles: number, pupilSamples: number, m: number): boolean {
    const nu = (2 * cycles) / pupilSamples;
    for (let i = 1; i <= 1400; i++) {
      const S = (i / 1400) * 1.4;
      const src = latticeDiskSource(S, pupilSamples, m);
      if (Math.min(S, 1) >= nu - 1 && !(latticeReach(src) >= nu)) return true;
    }
    return false;
  }

  it("agrees with the closed form at every reachable frequency and step", () => {
    for (const ps of [32, 64]) {
      for (let cycles = ps / 2 + 1; cycles <= ps; cycles++) {
        for (const m of [1, 2, 3, 4]) {
          expect({ cycles, ps, m, gap: latticeCutoffGapExists(cycles, ps, m) }).toEqual({
            cycles,
            ps,
            m,
            gap: measuredGapExists(cycles, ps, m),
          });
        }
      }
    }
  });

  it("says stepMultiple 1 has no gap at ANY frequency, which is why it cannot be the only step", () => {
    for (const ps of [32, 64]) {
      for (let cycles = ps / 2 + 1; cycles <= ps; cycles++) {
        expect(latticeCutoffGapExists(cycles, ps, 1)).toBe(false);
      }
    }
  });

  it("says the POWERS OF TWO die together, and an odd step is what rescues them", () => {
    // 4 | (cycles − 16) makes every one of {4, 2, 1} empty at once — a quarter
    // of the usable slider at pupilSamples 32, ν = 1.5 among them. This is the
    // rung that stopped {4, 2, 1} being shipped as the offering.
    const dyadicDead: number[] = [];
    const allDead: number[] = [];
    for (let cycles = 17; cycles <= 32; cycles++) {
      const dyadic = [4, 2, 1].some((m) => latticeCutoffGapExists(cycles, 32, m));
      const any = [4, 3, 2, 1].some((m) => latticeCutoffGapExists(cycles, 32, m));
      if (!dyadic) dyadicDead.push(cycles);
      if (!any) allDead.push(cycles);
    }
    expect(dyadicDead).toEqual([20, 24, 28, 32]);
    // Only ν = 1.75 survives the odd step, because 28 − 16 = 12 is divisible by
    // 4, 3, 2 and 1 alike. Named rather than hidden: the panel greys that step
    // out instead of leaving a reader hunting for a demonstration that is
    // provably not there.
    expect(allDead).toEqual([28]);
  });

  it("is false below ν = 1 for its own reason, not by the formula", () => {
    for (const cycles of [0, 1, 8, 16]) {
      expect(latticeCutoffGapExists(cycles, 32, 3)).toBe(false);
    }
  });
});

describe("§ 6ab.8 — refusals", () => {
  it("refuses a non-power-of-two pupilSamples, inheriting § 6p's exactness argument", () => {
    expect(() => latticeDiskSource(0.5, 24, 1)).toThrow(/power of two/);
    expect(() => latticeDiskSource(0.5, 100, 1)).toThrow(/power of two/);
  });

  it("refuses a fractional or non-positive step, and a negative S", () => {
    expect(() => latticeDiskSource(0.5, 32, 1.5)).toThrow(/positive integer/);
    expect(() => latticeDiskSource(0.5, 32, 0)).toThrow(/positive integer/);
    expect(() => latticeDiskSource(-0.1, 32, 1)).toThrow(/>= 0/);
    expect(() => latticeCutoffGapExists(21, 32, 0)).toThrow(/positive integer/);
    expect(() => latticeCutoffGapExists(2.5, 32, 1)).toThrow(/non-negative integer/);
  });

  it("still throws when the shifted pupil runs off the frequency grid", () => {
    // Not softened by any of the above: a truncated pupil reads as a smaller
    // aperture, so `abbeImage` refuses rather than clamps, and this source is
    // no exception to that.
    expect(() => abbeImage(OBJECT, idealPupil(), latticeDiskSource(3.5, PS, 1), { pupilSamples: PS })).toThrow(
      /runs off a 128-bin frequency grid/,
    );
  });
});
