import { describe, it, expect } from "vitest";
import { abbeImage, uniformObject, type ObjectField } from "../src/illumination/abbe";
import {
  commensurateSource,
  coherentSource,
  diskSource,
  type CondenserSource,
} from "../src/illumination/source";
import { latticeMatchedSource } from "../src/imaging/fluorescence";
import {
  idealPupil,
  weakObjectTransfer,
  weakObjectTransferDisk,
} from "../src/illumination/transfer";
import { mulberry32 } from "../src/math/random";
import type { PupilFunction } from "../src/wave/psf";
import { objectFieldTile, tracedFieldPupils } from "../src/imaging/object-field";
import { rasterizeSpecimen, type Specimen } from "../src/imaging/specimen";
import { renderBrightfield } from "../src/imaging/brightfield";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6p — the commensurate condenser and the cached pupil.
 *
 * `diskSource` spaces its points by 2S/samples, a spacing chosen for the source
 * and unrelated to the grid the pupil is sampled on. `commensurateSource` spaces
 * them by a whole multiple of the **pupil's own** frequency step instead, so
 * every illumination direction reads the pupil at the same coordinates as every
 * other — and a traced `PupilFunction`, whose callback re-traces rays, can be
 * evaluated once over its support and read back by index thereafter.
 *
 * **The step is a speed step and nothing else, and that is a correction.** § 6o
 * and APP.md's D5 both say a commensurate condenser also *lowers the mosaic's
 * error floor*. It does not: § 6p.6 shows a commensurate source is the same
 * quadrature as `diskSource` at the same count, to every digit, and § 6p.7 shows
 * 812 commensurate points at S = 1 are as flat as — and slightly worse than —
 * § 6o's 749. What lowers the floor is **more points**, and what § 6p changes is
 * which counts a traced pupil can afford.
 */

/* ── the transfer probe, in § 6f.2's own shape ────────────────────────────── */

const PUPIL = idealPupil();

/**
 * § 6f.2's `maxTransferError`, verbatim in shape: the worst weak-object
 * transfer error over 40 frequencies out to ν = 2, against the three-circle
 * closed form. Named rather than paraphrased, because § 6p's convergence rung
 * is that step's rung read on a restricted ladder of counts, and "converged" is
 * a claim about a metric.
 */
function maxTransferError(source: CondenserSource, S: number): number {
  let worst = 0;
  for (let k = 1; k <= 40; k++) {
    const nu = (k / 40) * 2;
    worst = Math.max(
      worst,
      Math.abs(weakObjectTransfer(PUPIL, source, nu) - weakObjectTransferDisk(S, nu)),
    );
  }
  return worst;
}

/* ── the imaging probe ────────────────────────────────────────────────────── */

/** The same source, stripped of its declaration — so it takes the honest path. */
function undeclared(source: CondenserSource): CondenserSource {
  return {
    points: source.points,
    coherenceParameter: source.coherenceParameter,
    samples: source.samples,
  };
}

/** A random complex transmittance: no symmetry the two paths could share. */
function randomObject(size: number, seed: number): ObjectField {
  const rng = mulberry32(seed);
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let i = 0; i < re.length; i++) {
    const a = 0.4 + 0.6 * rng.next();
    const phase = 2 * Math.PI * rng.next();
    re[i] = a * Math.cos(phase);
    im[i] = a * Math.sin(phase);
  }
  return { size, re, im };
}

/**
 * An aberrated pupil with no separable structure, so a cache indexed wrongly in
 * either axis produces a different image rather than the same one.
 */
const ABERRATED: PupilFunction = {
  amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: (px, py) => {
    const r2 = px * px + py * py;
    return 0.8 * r2 - 0.35 * r2 * r2 + 0.2 * px * r2 + 0.11 * py;
  },
};

describe("§ 6p.1 — the construct is `diskSource`'s own lattice, computed exactly", () => {
  it("spaces by stepMultiple × the pupil's frequency step, so the count follows S", () => {
    // The knob changes hands. `diskSource`'s is a COUNT and its spacing drifts
    // with S — which is § 6o.3's finding, that 749 points converged at S = 0.25
    // are four times too coarse at S = 1. This one's knob is the SPACING and the
    // count follows, which is the shape a caller wants and the shape the cache
    // requires.
    for (const m of [1, 2, 4]) {
      const spacing = (2 * m) / 64;
      for (const S of [0.25, 0.5, 1]) {
        const src = commensurateSource(S, 64, m);
        expect(src.samples).toBe((S * 64) / m);
        expect((2 * S) / src.samples).toBeCloseTo(spacing, 15);
        expect(src.pupilLattice).toEqual({ pupilSamples: 64, stepMultiple: m });
      }
    }
  });

  it("is `diskSource`'s lattice BITWISE wherever `diskSource`'s arithmetic is exact", () => {
    // Not a new sampling of the disc — the same one. Every dyadic case agrees to
    // the last bit, which is what says commensurability is a licence to cache
    // rather than a change of physics.
    for (const [S, ps, m] of [
      [0.5, 64, 1],
      [0.5, 64, 2],
      [0.5, 64, 4],
      [0.25, 64, 1],
      [1, 128, 4],
    ] as const) {
      const c = commensurateSource(S, ps, m);
      const d = diskSource(S, (S * ps) / m);
      expect(c.points.length).toBe(d.points.length);
      for (let i = 0; i < c.points.length; i++) {
        expect(c.points[i]!.sx).toBe(d.points[i]!.sx);
        expect(c.points[i]!.sy).toBe(d.points[i]!.sy);
      }
    }
  });

  it("…and the ONE place they differ is the one place `gridCoordinate` rounds", () => {
    // S = 0.75 at stepMultiple 2 is 24 points across, and `gridCoordinate`
    // divides by 24 — which is not a power of two, so its coordinates carry a
    // rounding this constructor does not. The gap is 5.6e-17: physically
    // nothing, and exactly the thing that would stop the cached sum being
    // bit-for-bit the uncached one. It is why the exact construction exists and
    // why `pupilSamples` must be a power of two, and the point COUNT is
    // unchanged, so nothing about the disc moved.
    const c = commensurateSource(0.75, 64, 2);
    const d = diskSource(0.75, 24);
    expect(c.points.length).toBe(d.points.length);
    let worst = 0;
    let bitwise = true;
    for (let i = 0; i < c.points.length; i++) {
      worst = Math.max(worst, Math.abs(c.points[i]!.sx - d.points[i]!.sx));
      if (c.points[i]!.sx !== d.points[i]!.sx) bitwise = false;
    }
    expect(bitwise).toBe(false);
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-16);
  });

  it("`latticeMatchedSource` IS the stepMultiple = 1 case", () => {
    // § 6i's constructor, generalized rather than duplicated: m = 1 is the only
    // multiple that makes the Abbe sum exactly incoherent, and every other one
    // is a coarsening of the same lattice.
    for (const [S, ps] of [
      [1.5625, 16],
      [0.5, 64],
      [2, 32],
    ] as const) {
      const a = latticeMatchedSource(S, ps);
      const b = commensurateSource(S, ps, 1);
      expect(a.points.length).toBe(b.points.length);
      for (let i = 0; i < a.points.length; i++) expect(a.points[i]!.sx).toBe(b.points[i]!.sx);
    }
  });
});

describe("§ 6p.2 — refused rather than rounded", () => {
  it("a fractional count throws, naming the three knobs", () => {
    // `latticeMatchedSource`'s argument, generalized: a rounded lattice is not
    // commensurate, and an image formed on one through the cache differs from
    // the honest sum in a way nothing downstream can see.
    expect(() => commensurateSource(0.5, 64, 3)).toThrow(/positive integer/);
    expect(() => commensurateSource(0.7, 64, 1)).toThrow(/positive integer/);
    expect(() => commensurateSource(0.5, 64, 64)).toThrow(/positive integer/);
    expect(() => commensurateSource(0.5, 64, 2.5)).toThrow(/stepMultiple must be/);
    expect(() => commensurateSource(0.5, 64, 0)).toThrow(/stepMultiple must be/);
    expect(() => commensurateSource(0, 64, 1)).toThrow(/must be > 0/);
  });

  it("a `pupilSamples` that is not a power of two throws, and says why", () => {
    // The exactness is arithmetic, not just algebraic: 2/N is representable
    // only at a power of two, and only there is the cached coordinate the
    // uncached one bit for bit. Refused rather than tolerated — every
    // brightfield lattice in the engine is 16, 32, 64 or 128.
    expect(() => commensurateSource(0.5, 48, 1)).toThrow(/power of two/);
    expect(() => commensurateSource(1, 21, 1)).toThrow(/power of two/);
    expect(() => commensurateSource(1, 1, 1)).toThrow(/power of two/);
    expect(() => commensurateSource(1, 17.5, 1)).toThrow(/power of two/);
    // § 6i's own message survives the delegation, because its count check runs
    // first and is the more specific failure.
    expect(() => latticeMatchedSource(1.5, 17)).toThrow(/frequency step/);
  });

  it("NEGATIVE CONTROL: a source that DECLARES a lattice it is not on throws", () => {
    // The declaration is the whole trigger, so it is the whole attack surface.
    // A hand-built source claiming to be commensurate would otherwise take the
    // cached path and form a perfectly plausible image off the wrong pupil
    // samples — the failure mode this module refuses everywhere else.
    const liar: CondenserSource = {
      points: [
        { sx: 0, sy: 0, weight: 0.5 },
        { sx: 0.031_25 + 1e-4, sy: 0, weight: 0.5 },
      ],
      coherenceParameter: 0.5,
      samples: 3,
      pupilLattice: { pupilSamples: 64, stepMultiple: 1 },
    };
    expect(() => abbeImage(uniformObject(128), PUPIL, liar, { pupilSamples: 64 })).toThrow(
      /not on the pupil lattice/,
    );
  });

  it("…and a lattice declared for another `pupilSamples` is simply not used", () => {
    // Not an error — a commensurate source is a perfectly ordinary source at any
    // other scale, it is just no longer commensurate. So the sum falls back, and
    // `pupilEvaluations` is how a caller sees that it did: nothing is silent.
    const src = commensurateSource(0.5, 64, 2);
    const at64 = abbeImage(uniformObject(128), PUPIL, src, { pupilSamples: 64 });
    const at32 = abbeImage(uniformObject(128), PUPIL, src, { pupilSamples: 32 });
    expect(at64.pupilEvaluations).toBe(65 * 65);
    expect(at32.pupilEvaluations).toBeGreaterThan(at32.contributingPoints * 100);
  });
});

describe("§ 6p.3 — the cached sum IS the uncached sum, bit for bit", () => {
  // Anything looser would be hiding a bug: it is the same arithmetic in a
  // different order, and the order is only safe because every coordinate is
  // dyadic. A tolerance here would pass whether or not that were true.
  const cases = [
    { S: 0.5, ps: 64, m: 2, size: 128, parity: 0 },
    { S: 0.5, ps: 64, m: 4, size: 128, parity: 0 },
    { S: 1, ps: 32, m: 1, size: 128, parity: 1 },
    { S: 0.75, ps: 64, m: 2, size: 128, parity: 0 },
    { S: 0.5, ps: 32, m: 1, size: 128, parity: 1 },
  ] as const;

  for (const { S, ps, m, size, parity } of cases) {
    it(`S = ${S}, pupilSamples ${ps}, stepMultiple ${m} — every pixel identical`, () => {
      const src = commensurateSource(S, ps, m);
      const object = randomObject(size, 20_260_728);
      const cached = abbeImage(object, ABERRATED, src, { pupilSamples: ps });
      const honest = abbeImage(object, ABERRATED, undeclared(src), { pupilSamples: ps });
      expect(cached.intensity.length).toBe(honest.intensity.length);
      for (let i = 0; i < cached.intensity.length; i++) {
        expect(cached.intensity[i]).toBe(honest.intensity[i]);
      }
      // The lattice guard rides in the same loop, so it is the same number too —
      // and it is a MAXIMUM over source points, which a cache indexed by the
      // wrong offset would quietly change.
      expect(cached.maxGridPhaseStepWaves).toBe(honest.maxGridPhaseStepWaves);
      expect(cached.maxGridPhaseStepWaves).toBeGreaterThan(0);
      expect(cached.contributingPoints).toBe(honest.contributingPoints);
      // Parity is not a corner case: a source grid with an even count and an odd
      // multiple sits half a step off the lattice, which is exactly § 6i's
      // "an even one is the same lattice offset by half a step" arriving as an
      // index. Both parities are exercised above.
      expect(src.samples % 2 === 0 && m % 2 === 1 ? 1 : 0).toBe(parity);
    });
  }

  it("and it survives the bridge — a traced mosaic tile renders identically", () => {
    // § 6g.3's `renderBrightfield` forms a whole `abbeImage` per patch through
    // that patch's own pupil, which is why the cache is call-local: a cache that
    // outlived the call would be a correctness hazard rather than a saving.
    const system: OpticalSystem = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
    const ps = 32;
    const frame = objectFieldTile(system, {
      size: 64,
      pupilSamples: ps,
      wavelengthNm: 587.5618,
      centreMm: { x: 0, y: 0 },
    });
    const bars: Specimen = (x) => ({
      re: 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / (8 * frame.objectPixelScaleMm)),
      im: 0,
    });
    const object = rasterizeSpecimen(system, frame, bars, {});
    const pupils = tracedFieldPupils(system, frame);
    const src = commensurateSource(0.5, ps, 2);
    const options = { scale: frame.scale, pupilSamples: ps, patches: 2 } as const;
    const cached = renderBrightfield(object, pupils, src, options);
    const honest = renderBrightfield(object, pupils, undeclared(src), options);
    for (let i = 0; i < cached.intensity.length; i++) {
      expect(cached.intensity[i]).toBe(honest.intensity[i]);
    }
  });
});

describe("§ 6p.4 — the saving is exactly the contributing-point count", () => {
  it("one pass over the support instead of one per direction", () => {
    // The speed claim as an integer rather than a wall clock. The shifted pupil
    // is supported on |u| ≤ 1 whichever direction it came from, so every source
    // point visits the SAME box — which is why the ratio is the point count
    // exactly and not approximately.
    for (const [S, ps, m] of [
      [0.5, 64, 2],
      [0.5, 64, 4],
      [0.75, 64, 2],
      [1, 32, 1],
    ] as const) {
      const src = commensurateSource(S, ps, m);
      // The smallest grid `abbeImage`'s own guard admits at this S, so the rung
      // costs a transform rather than sixteen.
      let size = 32;
      while (size < ps * (1 + S) + 2) size *= 2;
      const object = uniformObject(size);
      const cached = abbeImage(object, ABERRATED, src, { pupilSamples: ps });
      const honest = abbeImage(object, ABERRATED, undeclared(src), { pupilSamples: ps });
      const parity = src.samples % 2 === 0 && m % 2 === 1 ? 1 : 0;
      const width = ps + 1 - parity;
      expect(cached.pupilEvaluations).toBe(width * width);
      expect(honest.pupilEvaluations).toBe(cached.pupilEvaluations * cached.contributingPoints);
    }
  });

  it("`pupilEvaluations` counts the calls the pupil actually receives", () => {
    // The readout is the measurement, not a prediction of it.
    let calls = 0;
    const counting: PupilFunction = {
      amplitude: (px, py) => {
        calls++;
        return px * px + py * py <= 1 ? 1 : 0;
      },
      phaseWaves: () => 0,
    };
    const src = commensurateSource(0.5, 64, 2);
    calls = 0;
    const cached = abbeImage(uniformObject(128), counting, src, { pupilSamples: 64 });
    expect(calls).toBe(cached.pupilEvaluations);
    calls = 0;
    const honest = abbeImage(uniformObject(128), counting, undeclared(src), { pupilSamples: 64 });
    expect(calls).toBe(honest.pupilEvaluations);
    expect(honest.pupilEvaluations / cached.pupilEvaluations).toBe(cached.contributingPoints);
  });

  it("an ordinary source pays the ordinary price, and it is not even a fixed one", () => {
    // A `diskSource` point sits at an arbitrary fraction of the pupil's step, so
    // the box that fits its shifted pupil is 32 or 33 samples wide depending on
    // where the fraction falls, and the total is a SUM of unequal boxes — 100 033
    // over 97 directions, which is 1031.3 apiece and therefore no whole box at
    // all. That is the same fact the cache turns to account from the other side:
    // a commensurate source's boxes are all one box, which is why § 6p.4's ratio
    // is exact.
    const disk = abbeImage(uniformObject(128), PUPIL, diskSource(0.5, 11), { pupilSamples: 32 });
    expect(disk.contributingPoints).toBe(97);
    expect(disk.pupilEvaluations).toBeGreaterThan(disk.contributingPoints * 32 * 32);
    expect(disk.pupilEvaluations).toBeLessThan(disk.contributingPoints * 33 * 33);
    expect(disk.pupilEvaluations % disk.contributingPoints).not.toBe(0);
    // The coherent limit is one point, so there is nothing to amortize and the
    // two paths cost the same — which is the floor the cache converges to.
    const one = abbeImage(uniformObject(128), PUPIL, coherentSource(), { pupilSamples: 32 });
    expect(one.contributingPoints).toBe(1);
    expect(one.pupilEvaluations).toBe(33 * 33);
  });
});

describe("§ 6p.5 — the counts commensurability allows, and what they cost", () => {
  it("the ladder is the divisors of S·pupilSamples, and it is measured not assumed", () => {
    // The whole convergence content of the step, on § 6f.2's own metric. The
    // error grows monotonically as the lattice coarsens, and the numbers are
    // 4.56e-3, 1.78e-2, 3.38e-2, 1.34e-1 at S = 0.5, pupilSamples 64.
    const errors = [1, 2, 4, 8].map((m) =>
      maxTransferError(commensurateSource(0.5, 64, m), 0.5),
    );
    for (let i = 1; i < errors.length; i++) expect(errors[i]!).toBeGreaterThan(errors[i - 1]!);
    expect(errors[0]!).toBeLessThan(5e-3);
    expect(errors[1]!).toBeGreaterThan(1.5e-2);
    expect(errors[3]! / errors[0]!).toBeGreaterThan(25);
  });

  it("**stepMultiple > 1 is already coarse**, and that corrects D0.3's premise", () => {
    // Part D asked for a source that was commensurate AND coarse — ~100 points
    // where `latticeMatchedSource` fixes 3 217. It does not survive contact:
    // stepMultiple 4 at S = 0.5 is 8 directions across and reads 3.4e-2, which
    // is where § 6f.2's own "a coarse source is wrong by enough to notice" rung
    // fires (> 3e-2 at 5 across). Commensurability is not what makes a source
    // affordable — the CACHE is — so the useful configuration is stepMultiple 1
    // at a `pupilSamples` whose S·ps is the count that converges.
    expect(maxTransferError(commensurateSource(0.5, 64, 4), 0.5)).toBeGreaterThan(3e-2);
    expect(commensurateSource(0.5, 64, 4).points.length).toBeLessThan(60);
    // And the way out is the scale, not the multiple: the same 812 points arrive
    // at stepMultiple 2 once the pupil is sampled at 128, with the error of the
    // count rather than of the multiple.
    const coarse = commensurateSource(0.5, 64, 1);
    const fine = commensurateSource(0.5, 128, 2);
    expect(fine.points.length).toBe(coarse.points.length);
    expect(maxTransferError(fine, 0.5)).toBe(maxTransferError(coarse, 0.5));
  });

  it("…and an allowed count must be MEASURED, because § 6f.2 is not monotone", () => {
    // 15, 16 and 17 across read 1.29e-2, 1.78e-2 and 8.94e-3 at S = 0.5: the
    // rim's midpoint errors cancel by different amounts at different counts, so
    // interpolating a restricted ladder off § 6f.2's would be inventing numbers.
    // No even/odd law is minted — 31, 32, 33 run the other way.
    const near16 = [15, 16, 17].map((N) => maxTransferError(diskSource(0.5, N), 0.5));
    expect(near16[1]!).toBeGreaterThan(near16[0]!);
    expect(near16[2]!).toBeLessThan(near16[0]!);
    const near32 = [31, 32, 33].map((N) => maxTransferError(diskSource(0.5, N), 0.5));
    expect(near32[1]!).toBeLessThan(near32[0]!);
    expect(near32[1]!).toBeLessThan(near32[2]!);
  });
});

describe("§ 6p.6 — commensurability is accuracy-NEUTRAL", () => {
  it("a commensurate source is the same quadrature as `diskSource` at that count", () => {
    // Not close to — the same. Which is the fact that makes § 6p.7's correction
    // unavoidable: if the lattice is identical, no property of the image can
    // depend on the declaration, and "a commensurate condenser lowers the error
    // floor" cannot be true.
    for (const [S, ps, m] of [
      [0.5, 64, 2],
      [1, 64, 4],
      [0.25, 64, 1],
    ] as const) {
      const c = commensurateSource(S, ps, m);
      const d = diskSource(S, (S * ps) / m);
      for (const nu of [0.4, 0.9, 1.3, 1.8]) {
        expect(weakObjectTransfer(PUPIL, c, nu)).toBe(weakObjectTransfer(PUPIL, d, nu));
      }
    }
  });
});

/* ── § 6o's guard probe, re-run on a commensurate condenser ───────────────── */

const GN = 128;
const GPS = 64;
const GPX_PER_CELL = GN / GPS;
const GWINDOW = 16;
const GBLOCK = GPX_PER_CELL;

const HARD_EDGED: PupilFunction = {
  amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: () => 0,
};

/** § 6o.4's controlled pair: identical inside the box, a permutation outside. */
function specimenPair(boxHalfPx: number, seed: number): [ObjectField, ObjectField] {
  const nb = GN / GBLOCK;
  const rng = mulberry32(seed);
  const values = new Float64Array(nb * nb);
  for (let i = 0; i < values.length; i++) values[i] = rng.next();
  const inside = (bx: number, by: number): boolean => {
    const x0 = bx * GBLOCK;
    const y0 = by * GBLOCK;
    return (
      x0 >= GN / 2 - boxHalfPx &&
      x0 + GBLOCK <= GN / 2 + boxHalfPx &&
      y0 >= GN / 2 - boxHalfPx &&
      y0 + GBLOCK <= GN / 2 + boxHalfPx
    );
  };
  const outside: number[] = [];
  for (let by = 0; by < nb; by++) {
    for (let bx = 0; bx < nb; bx++) if (!inside(bx, by)) outside.push(by * nb + bx);
  }
  const order = outside.slice();
  const shuffle = mulberry32(seed ^ 0x9e3779b9);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const permuted = Float64Array.from(values);
  for (let k = 0; k < outside.length; k++) permuted[outside[k]!] = values[order[k]!]!;
  const build = (v: Float64Array): ObjectField => {
    const re = new Float64Array(GN * GN);
    const im = new Float64Array(GN * GN);
    for (let y = 0; y < GN; y++) {
      for (let x = 0; x < GN; x++) {
        re[y * GN + x] = v[Math.floor(y / GBLOCK) * nb + Math.floor(x / GBLOCK)]!;
      }
    }
    return { size: GN, re, im };
  };
  return [build(values), build(permuted)];
}

/** rms of the crop's error over the window, pooled over two seeds. */
function guardRms(guardCells: number, source: CondenserSource): number {
  let sq = 0;
  let n = 0;
  for (const seed of [1, 2]) {
    const [a, b] = specimenPair(GWINDOW / 2 + guardCells * GPX_PER_CELL, seed);
    const ia = abbeImage(a, HARD_EDGED, source, { pupilSamples: GPS }).intensity;
    const ib = abbeImage(b, HARD_EDGED, source, { pupilSamples: GPS }).intensity;
    const lo = (GN - GWINDOW) / 2;
    let sum = 0;
    let count = 0;
    for (let y = lo; y < lo + GWINDOW; y++) {
      for (let x = lo; x < lo + GWINDOW; x++) {
        sum += ia[y * GN + x]!;
        count++;
      }
    }
    const mean = sum / count;
    for (let y = lo; y < lo + GWINDOW; y++) {
      for (let x = lo; x < lo + GWINDOW; x++) {
        sq += ((ia[y * GN + x]! - ib[y * GN + x]!) / mean) ** 2;
      }
    }
    n += count;
  }
  return Math.sqrt(sq / n);
}

describe("§ 6p.7 — the mosaic's floor is the POINT COUNT, which corrects § 6o", () => {
  it("812 commensurate points at S = 1 are as flat as § 6o's 749, and no better", () => {
    // § 6o.3 wrote "§ 6p's commensurate condenser is what fixes this, which is
    // why that step is not only about speed", and APP.md's D5 says the same.
    // Both are wrong, and this is the measurement: a commensurate source of
    // comparable size reproduces the plateau — 3.68e-3 → 3.63e-3 over four
    // doublings of the guard, against `diskSource`'s 3.07e-3 → 2.98e-3. It is
    // slightly WORSE, which is the count and not the commensurability (§ 6p.6).
    const disk = [4, 16].map((g) => guardRms(g, diskSource(1, 31)));
    const comm = [4, 16].map((g) => guardRms(g, commensurateSource(1, 64, 2)));
    expect(diskSource(1, 31).points.length).toBe(749);
    expect(commensurateSource(1, 64, 2).points.length).toBe(812);
    for (const v of [disk, comm]) expect(Math.abs(v[1]! / v[0]! - 1)).toBeLessThan(0.1);
    expect(comm[1]!).toBeGreaterThan(disk[1]!);
  });

  it("…and what DOES un-flatten it is 3 228 points, which is what the cache buys", () => {
    // The honest version of § 6o's claim. Hold the spacing at the pupil's own
    // step (stepMultiple 1) and the count follows S² to 3 228 — and the guard
    // curve falls again, 8.2e-4 → 1.7e-4 over guards 4 → 16, a slope of −1.13
    // where the 812-point curve reads −0.01. § 6p does not lower the floor at a
    // given count; it changes which count a traced pupil can afford, and the
    // ratio there is 10.8× (VALIDATION.md § 6p records the measurement).
    const fine = commensurateSource(1, 64, 1);
    expect(fine.points.length).toBe(3228);
    const v = [4, 16].map((g) => guardRms(g, fine));
    expect(v[0]! / v[1]!).toBeGreaterThan(4);
    expect(Math.log(v[1]! / v[0]!) / Math.log(4)).toBeLessThan(-1);
    // Below the plateau the 812-point curve sits on, at both ends.
    expect(v[0]!).toBeLessThan(1.5e-3);
    expect(v[1]!).toBeLessThan(5e-4);
  });
});
