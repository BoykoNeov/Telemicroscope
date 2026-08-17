import { describe, it, expect } from "vitest";
import {
  abbeImage,
  cosineGratingObject,
  imageHarmonic,
  phaseGratingObject,
  uniformObject,
} from "../src/illumination/abbe";
import {
  latticeDiskSource,
  latticeAnnularSource,
  latticeCutoffGapExists,
  commensurateSource,
  annularSource,
  diskSource,
  type CondenserSource,
} from "../src/illumination/source";
import {
  idealPupil,
  defocusedPupil,
  harmonicCarryingArea,
  harmonicSupportWeight,
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

/**
 * § 6ab.9 — the three facts that decide the phase panel's condenser.
 *
 * § 6ab left the phase panel on `diskSource` deliberately, on the ground that
 * its teaching had not been audited and that assuming A2's reasoning
 * transplants is the move this step's own history argues against. The audit is
 * these three rungs and § 6ab.10, and it says the reasoning does NOT
 * transplant. The panel is ideal-pupil by design (APP.md A3: "do not improve it
 * by tracing"), so it is exactly § 6p's null half — there is no tracing for the
 * cache to eliminate, and twice the directions is twice the transforms.
 */
describe("§ 6ab.9 — what a lattice condenser would and would not fix", () => {
  /** Worst |s + (−s)| over each point's best partner. 0 iff exactly symmetric. */
  function asymmetry(source: CondenserSource): number {
    let worst = 0;
    for (const p of source.points) {
      let best = Infinity;
      for (const q of source.points) {
        const d = Math.abs(p.sx + q.sx) + Math.abs(p.sy + q.sy);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    return worst;
  }

  /**
   * The phase null's precondition is a source symmetric under s → −s, and
   * `diskSource` satisfies it only to rounding: `gridCoordinate` forms
   * `radius·(2(i+½)/samples − 1)`, and the subtraction of 1 does not commute
   * with the mirror. At samples 11 the outer pair is 0.9090909090909091 against
   * 0.9090909090909092. The lattice's coordinates are an integer times an exact
   * power-of-two step, so its mirror is exact — and the mask compares squares,
   * which cannot admit one of a pair and drop the other.
   *
   * Worth exactly what it is worth: the measured null sits at f64 noise either
   * way, so this improves the PRECONDITION and nothing observable.
   */
  it("diskSource is centro-symmetric only to rounding; the lattice is exact", () => {
    for (const S of [0.05, 0.25, 0.5, 1.0]) {
      expect(asymmetry(latticeDiskSource(S, PS, 1))).toBe(0);
      const disk = asymmetry(diskSource(S, 11));
      expect(disk).toBeGreaterThan(0);
      // It scales with S, because every coordinate does.
      expect(disk).toBeLessThan(1e-15);
    }
    expect(asymmetry(diskSource(1.0, 11))).toBeGreaterThan(asymmetry(diskSource(0.25, 11)));
  });

  /**
   * The cost the panel would pay. A fixed angular density means the count grows
   * as S², where `diskSource`'s is fixed by its own sample count — so the switch
   * is cheaper at small S and dearer at large, and the panel's slider reaches
   * 1.5. Counted rather than timed: a point count is what the cost is linear in,
   * and a millisecond is a property of the machine.
   */
  it("the lattice costs directions where diskSource costs none", () => {
    expect(diskSource(0.05, 11).points.length).toBe(97);
    expect(diskSource(1.0, 11).points.length).toBe(97);
    expect(latticeDiskSource(0.5, PS, 1).points.length).toBe(197);
    expect(latticeDiskSource(1.0, PS, 1).points.length).toBe(797);
  });

  /**
   * And the dead zone at the bottom, which is why the switch could not have
   * been a straight swap even if the cost had gone the other way: below one
   * lattice cell the source holds a single point, so an S slider stepping by
   * 0.01 would show the coherent limit for its first 6% of travel.
   */
  it("below one lattice cell the source collapses to the coherent limit", () => {
    const cell = 2 / PS;
    expect(latticeDiskSource(cell * 0.99, PS, 1).points.length).toBe(1);
    expect(latticeDiskSource(cell * 1.01, PS, 1).points.length).toBeGreaterThan(1);
    // `diskSource` keeps its full count all the way down, which is the property
    // the phase panel is actually relying on.
    expect(diskSource(cell * 0.99, 11).points.length).toBe(97);
  });
});

/**
 * § 6ab.10 — the audit's real finding, and it is not about which source.
 *
 * The phase panel prints the 2ν contrast — the second-order term that survives
 * where the linear one is null — to six digits. That number is a quadrature
 * over illumination directions, and as S approaches 1 the quantity it is
 * measuring collapses (2.8e-2 at S = 0.6 against 1.5e-4 at S = 1, at this
 * grating) while the disagreement between samplings of the SAME source grows to
 * swamp it.
 *
 * Measured across `diskSource` at 11/21/41/61 samples and `latticeDiskSource`
 * at step multiples 1/2/3/4, on a 256² grid: worst ratio between samplings is
 * 1.06× at S = 0.6, 1.26× at 0.75, 1.76× at 0.90, and **9.75× at S = 1.00**,
 * staying between 5.8× and 42.7× at every S above it out to the slider's 1.5.
 * So this is a band and not a point, and it covers the top ~40% of the panel's
 * own S range.
 *
 * **It is not the sampling being too coarse.** A lattice source at step 3 uses
 * FEWER points than the shipped disc (89 against 97), a COARSER spacing (0.1875
 * against 0.1818) and a WORSE rim reach (0.9561 against 0.9791), and reads
 * 1.58e-4 against the shipped 1.48e-3 — agreeing with the 797-point lattice to
 * 3%. Refining the disc does not fix it either: at S = 1, 41 and 61 samples
 * (1 313 and 2 933 points) disagree with each other by 2.2×. The quantity is
 * dominated by which points land near |s| = 1, where the shifted pupil is
 * tangent to the objective's — a rim effect that no amount of interior sampling
 * resolves.
 *
 * Deliberately NOT fixed here. What the panel should print above S ≈ 0.9 is a
 * product question — fewer digits, a stated uncertainty, or a refusal in the
 * idiom it already uses for a 2ν bin that does not fit the grid — and it costs
 * a second render to answer honestly. This rung exists so the number cannot
 * quietly start being believed.
 */
describe("§ 6ab.10 — the 2ν readout is converged at S = 0.6 and is not at S = 1", () => {
  const GRATING = phaseGratingObject({ size: SIZE, cycles: 12, amplitudeRadians: 0.4 });

  function secondHarmonic(source: CondenserSource): number {
    const out = abbeImage(GRATING, idealPupil(), source, { pupilSamples: PS });
    return imageHarmonic(out.intensity, SIZE, 24).contrast;
  }

  /** Worst ratio between the readings a set of samplings gives. */
  function spread(sources: CondenserSource[]): number {
    const v = sources.map(secondHarmonic);
    return Math.max(...v) / Math.min(...v);
  }

  it("three samplings agree to within 10% at S = 0.6", () => {
    const s = spread([diskSource(0.6, 11), diskSource(0.6, 21), diskSource(0.6, 41)]);
    expect(s).toBeLessThan(1.1);
  });

  it("and disagree by more than 5× at S = 1, refinement included", () => {
    const s = spread([diskSource(1, 11), diskSource(1, 21), diskSource(1, 41)]);
    expect(s).toBeGreaterThan(5);
  });

  it("the shipped sampling is the outlier, not merely one of a scatter", () => {
    // Every other sampling tried lands within 3× of the lattice's reading; the
    // panel's own 11-sample disc is an order of magnitude above all of them.
    const lattice = secondHarmonic(latticeDiskSource(1, PS, 1));
    const shipped = secondHarmonic(diskSource(1, 11));
    expect(shipped / lattice).toBeGreaterThan(5);
    for (const m of [2, 4]) {
      const other = secondHarmonic(latticeDiskSource(1, PS, m));
      expect(other / lattice).toBeGreaterThan(1 / 3);
      expect(other / lattice).toBeLessThan(3);
    }
  });
});

/**
 * § 6ab.19 — the commensurate ANNULUS, which § 6p left open and § 6ab.11 kept
 * asking for.
 *
 * `latticeDiskSource` gave the disc a lattice *step* instead of a point count.
 * The ring needed it more, and for a reason § 6ab.12 measured rather than
 * argued: `annularSource` inherits "N points across the diameter" and a ring
 * throws most of them away — 16 of 49 at N = 7 — so at ν = 0.75 the 7-point
 * darkfield ring holds **no point of the carrying set at all** and reads a
 * second harmonic of 8.8e-17 where the other samplings agree to 1.35×. A step is
 * an angular density; a count across a diameter is not.
 *
 * ## What it buys, measured
 *
 * **The § 6p cache, bit for bit.** Every coordinate is a whole number of
 * half-steps of the pupil's own frequency grid, so `abbeImage` takes the cached
 * path: **1 089 pupil evaluations against 662 112**, and the two images are
 * identical to the last bit rather than to a tolerance. That claim is the whole
 * point of the constructor and is therefore measured here and not reasoned from
 * `latticeDiskSource`'s argument.
 *
 * **A density that is set rather than hoped for.** At `pupilSamples` 64 the
 * 1.1–1.4 ring holds 2 416 points at step 1 and 608 at step 2, and its carrying
 * weight at ν = 0.75 reads 0.0671 and 0.0691 against an exact 0.070268 — where
 * the count-based ring at N = 7 reads exactly 0.
 *
 * ## What does not transplant, and one thing that half does
 *
 * `latticeDiskSource`'s S → 0 limit is `coherentSource`'s single on-axis point.
 * **A ring with inner > 0 excludes the axis**, so a step too coarse to land in
 * the annulus gives *no* points, which is a failure and not a limit — it throws
 * with the step and the width.
 *
 * And § 6ab.17's convergence result splits in two when it is run on this grid:
 *
 *  - **the CONSTANT does not transplant** — sup e·n reaches 0.901 here against
 *    0.7373 for the count-based ring;
 *  - **the ENVELOPE does** — tail÷head is 0.19 at q = 1 and 0.52 at q = 4/3, the
 *    same shape on a lattice whose points sit on the pupil's own grid. So
 *    n^{-4/3} is about the boundary being curved, not about which steps the
 *    ladder happened to ask.
 *
 * One structural difference is recorded and is **not** the explanation: 21 of 39
 * lattice configurations put a source point *exactly* on the carrying set's
 * boundary |s ± ν| = 1, where the count-based ring does so in 0 of 115. All six
 * of the worst cells have none, so the ties are real and are not what sets the
 * bound — the kind of plausible mechanism this file has twice had to withdraw.
 *
 * ## The 22% was not an effect, and the block below is why
 *
 * This file said the two rings "differ by an offset and nothing else" and left
 * the 0.901-against-0.7373 gap as an open question. **Both halves were wrong.**
 * `annularSource`'s coordinates are `outer·(2i+1−N)/N`, which for **odd** N is an
 * integer multiple of its own step: that grid contains the origin, exactly as
 * this one does, and § 6ab.17's record is at N = 17. Only the even counts are at
 * cell centres, and the offset is worth 1.6% inside the count ladder itself
 * (sup 0.7373 over the odd counts against 0.7259 over the even ones) where the
 * question attributed 22% to it.
 *
 * What the two constructors really differ in is **which steps they can reach** —
 * `2·outer/N` against `2k/pupilSamples` — and neither set reaches the family's
 * own maximum. Left free over the same range of n, the same origin-centred
 * lattice masked to the same ring reaches **1.949**, so 0.7373 and 0.901 are two
 * suprema over two differently shaped subsets and their ratio is a fact about the
 * subsets. Both readings survive; the *comparison* is what does not.
 */
describe("§ 6ab.19 — the commensurate annulus", () => {
  const RING_OUTER = 1.4;
  const RING_INNER = 1.1;
  const RING_ORDERS = { cycles: 12, pupilSamples: 32 };
  /** The exact carrying fraction of A3's ring at ν = 0.75 (§ 6ab.14). */
  const RING_AT_075 = 0.070267681347553;

  /** The same source with its lattice metadata gone — forces the uncached sum. */
  function uncached(s: CondenserSource): CondenserSource {
    return { points: s.points, coherenceParameter: s.coherenceParameter, samples: s.samples };
  }

  it("puts every point on the pupil's own lattice, which is the cache's precondition", () => {
    for (const pupilSamples of [16, 32, 64]) {
      for (const stepMultiple of [1, 2, 3]) {
        const source = latticeAnnularSource(RING_OUTER, RING_INNER, pupilSamples, stepMultiple);
        expect(source.pupilLattice).toEqual({ pupilSamples, stepMultiple });
        // `latticeOffset`'s own test, asserted directly rather than through a
        // render: a whole number of half-steps, and all of one parity — 0, since
        // the grid is centred on an odd count.
        expect(source.samples % 2).toBe(1);
        for (const p of source.points) {
          for (const s of [p.sx, p.sy]) {
            const halfSteps = s * pupilSamples;
            expect(Number.isInteger(halfSteps)).toBe(true);
            // Math.abs because a negative even multiple gives -0, which `toBe` and
            // Object.is tell apart from 0 and the lattice does not.
            expect(Math.abs(halfSteps % 2)).toBe(0);
          }
        }
      }
    }
  });

  it("renders the SAME image cached and uncached, to the last bit", () => {
    // The claim the constructor exists for. Reasoning it from `latticeDiskSource`
    // would be exactly the kind of argued-not-measured step this ladder refuses:
    // if it were false the ring would be a slower `annularSource` with a wrong
    // answer in it.
    const source = latticeAnnularSource(RING_OUTER, RING_INNER, 32, 1);
    const object = phaseGratingObject({ size: 128, cycles: 12, amplitudeRadians: 1.5 });
    const cached = abbeImage(object, idealPupil(), source, { pupilSamples: 32 });
    const plain = abbeImage(object, idealPupil(), uncached(source), { pupilSamples: 32 });
    expect(cached.intensity.length).toBe(plain.intensity.length);
    for (let i = 0; i < cached.intensity.length; i++) {
      expect(cached.intensity[i], `pixel ${i}`).toBe(plain.intensity[i]);
    }
    // And it is the saving § 6p claimed. The RATIO is the claim — one pass over the
    // cache box instead of one per source point — measured at 608× (1 089 against
    // 662 112). The box itself is pinned exactly because it is a statement about
    // the lattice: 33² samples covering |p| ≤ 1 at `pupilSamples` 32. The other
    // number is the ring's point count times that and is deliberately not pinned,
    // since a change to the mask would fail it as though physics had moved.
    expect(cached.pupilEvaluations).toBe(33 * 33);
    expect(plain.pupilEvaluations / cached.pupilEvaluations).toBeGreaterThan(600);
  });

  it("RENDERS the second harmonic the 7-point ring reads as roundoff", () => {
    // The claim this constructor exists for, and it has to be made on an IMAGE.
    // § 6ab.18 has just finished measuring that which directions can contribute is
    // not what they contribute, so a carrying weight of 0.067 against 0 is set
    // membership and not a reading — the rung below is the reading.
    const object = phaseGratingObject({ size: 128, cycles: 12, amplitudeRadians: 1.5 });
    const read = (source: CondenserSource) => {
      const out = abbeImage(object, idealPupil(), source, { pupilSamples: 32 });
      return Math.abs(imageHarmonic(out.intensity, 128, 24).contrast);
    };
    // § 6ab.12's headline cell: 16 points, none in the carrying set, and the image
    // says so — 8.8e-17, which a reader is shown as "no second harmonic in
    // darkfield" and which is false.
    expect(read(annularSource(RING_OUTER, RING_INNER, 7))).toBeLessThan(1e-13);
    // The lattice ring at the same ring and the same grating reads a real number,
    // fourteen orders up, at every step tried.
    for (const stepMultiple of [1, 2]) {
      expect(
        read(latticeAnnularSource(RING_OUTER, RING_INNER, 32, stepMultiple)),
        `step ${stepMultiple}`,
      ).toBeGreaterThan(1e-3);
    }
    // And it agrees with the samplings § 6ab.11 found agreeing among themselves,
    // rather than merely being non-zero: 1.35× was their own spread.
    const lattice = read(latticeAnnularSource(RING_OUTER, RING_INNER, 32, 1));
    const counted = read(annularSource(RING_OUTER, RING_INNER, 21));
    expect(Math.max(lattice, counted) / Math.min(lattice, counted)).toBeLessThan(1.4);
  });

  it("holds the carrying set the 7-point ring misses entirely", () => {
    // The set-membership half of the same fact, which is what the gate reads.
    // The count-based ring's outermost x at N = 7 is 1.2 and the carrying band is
    // s_x ∈ [1.25, 1.4], so its weight is exactly 0 — not small, none.
    expect(harmonicSupportWeight(idealPupil(), annularSource(RING_OUTER, RING_INNER, 7), RING_ORDERS)).toBe(0);
    for (const [pupilSamples, stepMultiple] of [
      [32, 1],
      [64, 1],
      [64, 2],
    ] as [number, number][]) {
      const weight = harmonicSupportWeight(
        idealPupil(),
        latticeAnnularSource(RING_OUTER, RING_INNER, pupilSamples, stepMultiple),
        RING_ORDERS,
      );
      // 0.0691 at (64, 2), 0.0671 at (64, 1), against the exact 0.070268.
      expect(Math.abs(weight - RING_AT_075) / RING_AT_075, `${pupilSamples}/${stepMultiple}`).toBeLessThan(0.1);
    }
  });

  it("is still darkfield — a clear field through it is exactly black", () => {
    // The one thing `annularSource` exists to pin, and it must survive the change
    // of lattice: the ring is entirely outside |s| = 1, so no undiffracted beam
    // enters the objective and a non-diffracting object images to a hard zero.
    const clear = uniformObject(128);
    const dark = abbeImage(clear, idealPupil(), latticeAnnularSource(RING_OUTER, RING_INNER, 32, 1), {
      pupilSamples: 32,
    });
    for (const value of dark.intensity) expect(value).toBe(0);
  });

  it("refuses a step that lands nothing in the ring, which is not a limit but a failure", () => {
    // `latticeDiskSource` degenerates gracefully at S → 0 because an odd centred
    // grid always has the axis. A ring does not contain the axis, so the same
    // reasoning does not carry and the constructor says so with the step and the
    // width in the message.
    expect(() => latticeAnnularSource(1.4, 1.1, 8, 8)).toThrow(/landed no point inside the ring/);
    // It names the step it used and the width it failed to resolve, which is what
    // a caller can act on — not the ring's radii, which they already know.
    expect(() => latticeAnnularSource(1.4, 1.1, 8, 8)).toThrow(/step 2 landed/);
    expect(() => latticeAnnularSource(1.4, 1.1, 8, 8)).toThrow(/whose width is/);
    // And the ordinary guards.
    expect(() => latticeAnnularSource(0, 0, 32)).toThrow(/outer radius/);
    expect(() => latticeAnnularSource(1.4, 1.4, 32)).toThrow(/inner radius/);
    expect(() => latticeAnnularSource(1.4, 1.1, 32, 0)).toThrow(/stepMultiple/);
    expect(() => latticeAnnularSource(1.4, 1.1, 48)).toThrow(/power of two/);
  });

  it("keeps § 6ab.17's ENVELOPE and not its constant", () => {
    // The reason to run this ladder here: both constructors mask the same ring
    // with the same kind of square lattice, and differ in which steps they can
    // reach — `2·outer/N` against `2k/pupilSamples`. What survives a change of
    // step set is a property of the boundary. (The block below measures what does
    // not: the constant, which is a fact about the step sets and not about
    // either ring.)
    const rows: { n: number; e: number }[] = [];
    for (const pupilSamples of [8, 16, 32, 64, 128, 256, 512]) {
      for (const stepMultiple of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const spacing = (2 * stepMultiple) / pupilSamples;
        const n = (2 * RING_OUTER) / spacing;
        if (n < 8 || n > 420) continue;
        const source = latticeAnnularSource(RING_OUTER, RING_INNER, pupilSamples, stepMultiple);
        rows.push({
          n,
          e: Math.abs(harmonicSupportWeight(idealPupil(), source, RING_ORDERS) - RING_AT_075),
        });
      }
    }
    expect(rows.length).toBeGreaterThan(30);
    const sup = (rs: typeof rows, q: number) => rs.reduce((a, r) => Math.max(a, r.e * r.n ** q), 0);
    const head = rows.filter((r) => r.n <= 121);
    const tail = rows.filter((r) => r.n >= 200);

    // The constant is NOT § 6ab.17's: 0.901 here against 0.7373 there, at
    // n = 17.9 (pupilSamples 64, step 5). So 0.74/n describes the counts
    // `annularSource` accepts and not the quantity — and 0.901 describes the
    // steps this one accepts, which the block below measures rather than reads
    // as a property of the sampling.
    expect(sup(rows, 1)).toBeGreaterThan(0.74);
    expect(sup(rows, 1)).toBeLessThan(0.95);

    // The envelope IS: falling across the range at q = 1 and q = 4/3, and the
    // sup at 4/3 stays finite and modest (2.36 against § 6ab.17's 1.90).
    expect(sup(tail, 1) / sup(head, 1)).toBeLessThan(0.5);
    expect(sup(tail, 4 / 3) / sup(head, 4 / 3)).toBeLessThan(1);
    expect(sup(rows, 4 / 3)).toBeLessThan(2.5);
  });

  it("does land points exactly on the carrying set's edge, and that is NOT the bound", () => {
    // Worth recording because it is the mechanism a reader would reach for: a
    // lattice commensurate with the pupil can put a direction exactly where the
    // shifted pupil is tangent, so the in-or-out decision is a floating-point tie
    // — the rim hazard § 6ab.11 and § 6ab.12 both met. It happens, often, and the
    // worst cells do not have it.
    const onEdge = (source: CondenserSource) => {
      let count = 0;
      for (const p of source.points) {
        for (const sign of [1, -1]) if (Math.hypot(p.sx + sign * 0.75, p.sy) === 1) count++;
      }
      return count;
    };
    // The lattice ring at pupilSamples 64, step 1 has them; the count-based ring
    // never does, at any count from 7 to 40.
    expect(onEdge(latticeAnnularSource(RING_OUTER, RING_INNER, 64, 1))).toBeGreaterThan(0);
    for (let n = 7; n <= 40; n++) expect(onEdge(annularSource(RING_OUTER, RING_INNER, n)), `n = ${n}`).toBe(0);
    // And the cell that sets the bound above — pupilSamples 64, step 5 — has none,
    // so the ties are a real difference between the two grids and not the reason
    // one of them converges worse.
    expect(onEdge(latticeAnnularSource(RING_OUTER, RING_INNER, 64, 5))).toBe(0);
  });

  /** e·n for any source, against the exact carrying fraction. */
  const err = (n: number, source: CondenserSource) =>
    Math.abs(harmonicSupportWeight(idealPupil(), source, RING_ORDERS) - RING_AT_075) * n;

  /** The family both constructors draw from: an origin-centred square lattice of
   *  step `h` masked to the same ring, with the step free rather than tied to a
   *  count or to the pupil's grid. Plain data — `harmonicSupportWeight` reads
   *  only `points`, and this is a probe of the family and not a new source. The
   *  extent over-covers and the mask decides membership, as in both constructors;
   *  the exact `ceil` is therefore not load-bearing here and need not match
   *  `latticeAnnularSource`'s. */
  function freeStepRing(h: number): CondenserSource {
    const points: { sx: number; sy: number; weight: number }[] = [];
    const extent = Math.ceil(RING_OUTER / h) + 1;
    for (let j = -extent; j <= extent; j++) {
      for (let i = -extent; i <= extent; i++) {
        const sx = i * h;
        const sy = j * h;
        const r2 = sx * sx + sy * sy;
        if (r2 <= RING_OUTER * RING_OUTER && r2 >= RING_INNER * RING_INNER) {
          points.push({ sx, sy, weight: 0 });
        }
      }
    }
    const w = 1 / points.length;
    return {
      points: points.map((p) => ({ sx: p.sx, sy: p.sy, weight: w })),
      coherenceParameter: RING_OUTER,
      samples: 2 * extent + 1,
    };
  }

  it("is NOT an offset difference — the count-based grid is origin-centred too", () => {
    // Every difference below is taken against the literal, and the three that
    // decide the block — the gap and the two quanta — are differences of
    // same-order numbers. So pin the literal against the quadrature it came from
    // rather than trusting its digits: they agree to one ulp.
    expect(harmonicCarryingArea(RING_INNER, RING_OUTER, 0.75, 2).fraction).toBeCloseTo(RING_AT_075, 15);

    // The sentence this block corrects said the two rings "differ by an offset and
    // nothing else". `gridCoordinate` returns outer·(2i+1−N)/N, whose numerator is
    // even for odd N: that grid is a multiple of its own step and contains the
    // origin, exactly like the lattice ring's. Only the EVEN counts are at cell
    // centres — and § 6ab.17's record is at N = 17.
    //
    // So the offset is a variable the count ladder itself sweeps, and it is worth
    // 1.6% there — not 22%. Its top ten counts split five odd, five even.
    const rows: { n: number; en: number }[] = [];
    for (let n = 7; n <= 121; n++) {
      const source = annularSource(RING_OUTER, RING_INNER, n);
      const h = (2 * RING_OUTER) / n;
      for (const p of source.points) {
        const steps = p.sx / h;
        const off = Math.abs(steps - Math.round(steps));
        if (n % 2 === 1) expect(off, `n = ${n}`).toBeLessThan(1e-12);
        else expect(Math.abs(off - 0.5), `n = ${n}`).toBeLessThan(1e-12);
      }
      rows.push({ n, en: err(n, source) });
    }
    rows.sort((a, b) => b.en - a.en);
    expect(rows.slice(0, 10).filter((r) => r.n % 2 === 1)).toHaveLength(5);
    const supParity = (p: number) =>
      rows.filter((r) => r.n % 2 === p).reduce((a, r) => Math.max(a, r.en), 0);
    expect(supParity(1)).toBeCloseTo(0.7373, 4); // origin-centred, and the record
    expect(supParity(0)).toBeCloseTo(0.7259, 4); // cell centres
    expect(supParity(1) / supParity(0)).toBeLessThan(1.02);
  });

  it("the 22% is one cell of twenty, and smaller than one carrying point", () => {
    // The ladder above reads 39 cells, but a step is `2k/pupilSamples` and several
    // (P, k) pairs give the same step: it is 20 distinct lattices, each asked up to
    // four times. The 0.901 is one of those 20.
    const steps = new Map<number, number>();
    for (const pupilSamples of [8, 16, 32, 64, 128, 256, 512]) {
      for (const stepMultiple of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const h = (2 * stepMultiple) / pupilSamples;
        const n = (2 * RING_OUTER) / h;
        if (n < 8 || n > 420 || steps.has(h)) continue;
        steps.set(h, err(n, latticeAnnularSource(RING_OUTER, RING_INNER, pupilSamples, stepMultiple)));
      }
    }
    expect(steps.size).toBe(20);
    const lattice = [...steps.values()].sort((a, b) => b - a);
    const count: number[] = [];
    for (let n = 7; n <= 121; n++) count.push(err(n, annularSource(RING_OUTER, RING_INNER, n)));
    count.sort((a, b) => b - a);
    const [latticeSup = 0, latticeNext = 0] = lattice;
    const [countSup = 0] = count;
    expect(latticeSup).toBeCloseTo(0.9008, 4);
    expect(countSup).toBeCloseTo(0.7373, 4);

    // Drop the single worst lattice cell and the comparison REVERSES: the lattice
    // ring's runner-up is 0.7006 against the count ring's 0.7373, so "converges
    // worse" is carried by one cell out of twenty and not by the sampling.
    expect(latticeNext).toBeCloseTo(0.7006, 4);
    expect(latticeNext).toBeLessThan(countSup);

    // And the gap between the two records is smaller than the smallest change
    // either reading can make. e is a ratio of two integer counts, so one source
    // point entering the carrying set moves e·n by n/Nring: the record cells hold
    // 2 points of 100 and 10 of 88.
    const gap = latticeSup - countSup;
    expect(gap).toBeCloseTo(0.1635, 4);
    const latticeSource = latticeAnnularSource(RING_OUTER, RING_INNER, 64, 5);
    const countSource = annularSource(RING_OUTER, RING_INNER, 17);
    expect(latticeSource.points.length).toBe(100);
    expect(countSource.points.length).toBe(88);
    expect(Math.round(harmonicSupportWeight(idealPupil(), latticeSource, RING_ORDERS) * 100)).toBe(2);
    expect(Math.round(harmonicSupportWeight(idealPupil(), countSource, RING_ORDERS) * 88)).toBe(10);
    const quantum = { lattice: ((2 * RING_OUTER) / 0.15625) / 100, count: 17 / 88 };
    expect(quantum.lattice).toBeCloseTo(0.1792, 4);
    expect(quantum.count).toBeCloseTo(0.1932, 4);
    expect(gap).toBeLessThan(quantum.lattice);
    expect(gap).toBeLessThan(quantum.count);
  });

  it("neither constant is the family's — the step set free reaches 1.949", () => {
    // Both constructors mask the same ring with the same origin-centred lattice
    // and differ only in which steps they can reach. Ask the family instead, over
    // the same range of n, and both constants are left behind — so their ratio is
    // a fact about two step sets and not about either sampling.
    const rows: { en: number; phase: number }[] = [];
    const hLo = (2 * RING_OUTER) / 121;
    const hHi = (2 * RING_OUTER) / 8;
    for (let i = 0; i <= 1200; i++) {
      const h = hLo * Math.pow(hHi / hLo, i / 1200);
      const t = RING_OUTER / h;
      rows.push({ en: err((2 * RING_OUTER) / h, freeStepRing(h)), phase: Math.abs(t - Math.round(t)) });
    }
    const sup = (rs: typeof rows) => rs.reduce((a, r) => Math.max(a, r.en), 0);
    expect(sup(rows)).toBeCloseTo(1.9493, 4);
    expect(sup(rows)).toBeGreaterThan(2 * 0.9008);
    expect(sup(rows)).toBeGreaterThan(2.6 * 0.7373);

    // The one structural constraint the count ladder does carry, and why it is not
    // the explanation. `annularSource`'s step is 2·outer/N, so outer/h = N/2 and
    // its outer boundary sits EXACTLY midway between two lattice lines at every
    // one of the 115 counts — pinning that phase at offset 0 is algebraically the
    // same as requiring an odd count.
    for (let j = 3; j <= 8; j++) {
      const h = RING_OUTER / (j + 0.5);
      expect((2 * RING_OUTER) / h).toBeCloseTo(2 * j + 1, 12);
    }
    // But the supremum is not ordered by that phase: binned over the free steps it
    // is largest a fifth of the way across the cell, not at either end. A fourth
    // plausible mechanism, measured and refused like the three before it.
    const bin = (lo: number, hi: number) => rows.filter((r) => r.phase >= lo && r.phase < hi);
    expect(sup(bin(0, 0.05))).toBeCloseTo(1.2641, 4); // hard against a lattice line
    expect(sup(bin(0.2, 0.25))).toBeCloseTo(1.9493, 4); // and the worst is neither
    expect(sup(bin(0.45, 0.5))).toBeCloseTo(0.9347, 4); // the count ring's own phase
    expect(sup(bin(0.2, 0.25))).toBeGreaterThan(sup(bin(0, 0.05)));
  });
});
