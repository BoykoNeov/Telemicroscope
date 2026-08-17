import { describe, expect, it } from "vitest";
import {
  annularSource,
  coherentSource,
  defocusedPupil,
  diskSource,
  idealPupil,
  imageHarmonic,
  onlySymmetricPairPasses,
  phaseGratingObject,
  phaseGratingTruncation,
  type CondenserSource,
} from "../src/illumination";
import { renderBrightfield, type PatchPupil } from "../src/imaging";
import { besselJ } from "../src/math";
import type { PupilFunction } from "../src/wave";

/**
 * § 6ab.15 — the harmonics past the second, which § 6ab.12 left open.
 *
 * § 6ab.12 built a criterion for whether a grating's harmonic at h·ν exists at
 * all and § 6ab.14 made it quantitative, both for any h; the panel renders h = 2
 * and the open item read "the h ≥ 3 harmonics, which the criterion covers and
 * nothing renders — the cutoffs fall as 2/h and the cheap prediction is that a
 * third harmonic needs ν < 2/3; no rung asks for it."
 *
 * The prediction is right and it is not the interesting half. **A third harmonic
 * inside its own cutoff is still zero**, and so is every other odd one, for a
 * reason that has nothing to do with where the orders land:
 *
 *     c_h = i^h · Σₙ Jₙ₊ₕ(φ)·Jₙ(φ)·P(s+(n+h)ν)·P̄(s+nν),   summed over the source
 *
 * Pair the term at (s, n) with the term at (−s, −n−h). J₋ₖ = (−1)^k Jₖ applies
 * twice and contributes (−1)^h; the pupil factors match because the pupil is
 * even and the source centro-symmetric. **For odd h the sum is its own negative.**
 *
 * So § 6f's phase null — "a brightfield microscope cannot see an unstained cell"
 * — is the h = 1 case of a parity law, and the weak-object story it was carried
 * by (two sidebands entering with opposite signs) under-explains it: that story
 * is about a three-line spectrum, and this holds for a grating of any strength
 * with orders at every integer m.
 *
 * ## Two preconditions, and neither is the weak-object one
 *
 * **Evenness of the pupil** and **centro-symmetry of the source** — the same
 * pair `weakPhaseTransfer` names. Defocus keeps the pupil even but makes it
 * complex, which turns the paired factor into a conjugate instead of an equal,
 * and every odd harmonic comes up together. A symmetric band limit is *not* a
 * third precondition: dropping orders past |m| ≤ M keeps every surviving term's
 * partner, so the null survives § 6ab.13's truncation, measured at 3.9% of the
 * light gone.
 *
 * ## The even ones are a family of closed forms
 *
 * Where the symmetric pair (−h/2, +h/2) is the only pair h apart that gets
 * through, one term survives in `c_h` and the harmonic has no free parameter and
 * no pupil in it:
 *
 *     contrast(h·ν) · mean = 2·J_{h/2}(φ)²
 *
 * A3's `threeOrderCheck` and § 6f's 2·J₁(φ)² are the h = 2 member of this. The
 * family is measured here at h = 2, 4, 6 and 8, and it is exactly where
 * `onlySymmetricPairPasses` says it is — including the part that cannot be
 * written as a bound on S.
 */

const SIZE = 128;
const PUPIL = idealPupil();

/** A3's darkfield ring — the source that sent § 6ab.12 looking in the first place. */
const DARK_INNER = 1.1;
const DARK_OUTER = 1.4;

interface Cell {
  pupilSamples: number;
  cycles: number;
  phi: number;
  source: CondenserSource;
  defocus?: number;
  size?: number;
}

/** The contrast at the h-th harmonic's bin, off one rendered image. */
function harmonicContrast(cell: Cell, h: number): number {
  return harmonicReading(cell, h).contrast;
}

/**
 * Contrast and mean at h·ν. Both are read off ONE image: the bins are free once
 * the render exists, which is what makes asking about five harmonics cost what
 * asking about one costs.
 */
function harmonicReading(cell: Cell, h: number): { contrast: number; amplitude: number } {
  const size = cell.size ?? SIZE;
  const object = phaseGratingObject({
    size,
    cycles: cell.cycles,
    amplitudeRadians: cell.phi,
  });
  const pupil: PupilFunction = cell.defocus ? defocusedPupil(cell.defocus) : PUPIL;
  const out = renderBrightfield(object, (): PatchPupil => ({ pupil }), cell.source, {
    pupilSamples: cell.pupilSamples,
    patches: 1,
  });
  const bin = h * cell.cycles;
  if (bin >= size / 2) throw new Error(`harmonic ${h} is off a ${size}-bin grid at ${cell.cycles}`);
  const read = imageHarmonic(out.intensity, size, bin);
  return { contrast: read.contrast, amplitude: read.contrast * read.dc };
}

/** f64 roundoff on a reading whose neighbours are O(0.1). */
const NULL_CEILING = 1e-13;

describe("§ 6ab.15 — every ODD harmonic is null, not just the first", () => {
  // nu = 2*6/32 = 0.375, so orders |m| <= 2 pass and h = 1..5 are all inside the
  // grid. The even neighbours are asserted in the same rung on purpose: a null
  // measured where EVERYTHING is small is a claim about the render, not about
  // parity.
  const cases: [string, CondenserSource][] = [
    ["coherent", coherentSource()],
    ["S = 0.6 disc, 11 samples", diskSource(0.6, 11)],
    ["darkfield 1.1–1.4, 11 samples", annularSource(DARK_OUTER, DARK_INNER, 11)],
  ];

  for (const [name, source] of cases) {
    it(`h = 1, 3 and 5 are roundoff under ${name}, where h = 2 and 4 are not`, () => {
      const cell: Cell = { pupilSamples: 32, cycles: 6, phi: 1.5, source };
      // Measured (coherent): 1.5e-16, 2.1e-16, 7.7e-16 against 1.486e-1 and
      // 1.086e-1. Darkfield: 6.9e-17, 3.3e-16, 6.7e-16 against 1.953e-1.
      for (const odd of [1, 3, 5]) {
        expect(Math.abs(harmonicContrast(cell, odd))).toBeLessThan(NULL_CEILING);
      }
      for (const even of [2, 4]) {
        expect(harmonicContrast(cell, even)).toBeGreaterThan(1e-3);
      }
    });
  }

  it("does not care how strong the phase is, nor that 3.9% of it was truncated away", () => {
    // The corner § 6ab.12's 6.8e-7 aliasing artifact lived in: φ = 3, and a grid
    // holding only |m| <= 3 of a series that runs to infinity. The annulus reaches
    // |s| = 1.4, so pupilSamples 48 buys the frequency grid the reach to hold it
    // (1.625) while 16 cycles keeps 3ν = 2.0 inside the ring's own (1 + outer).
    const truncation = phaseGratingTruncation({ size: SIZE, cycles: 16, amplitudeRadians: 3 });
    expect(truncation.maxOrder).toBe(3);
    expect(truncation.droppedEnergy).toBeGreaterThan(0.03);

    for (const [name, source] of [
      ["darkfield 11", annularSource(DARK_OUTER, DARK_INNER, 11)],
      ["darkfield 21", annularSource(DARK_OUTER, DARK_INNER, 21)],
      ["S = 0.6 disc", diskSource(0.6, 11)],
      ["coherent", coherentSource()],
    ] as [string, CondenserSource][]) {
      const cell: Cell = { pupilSamples: 48, cycles: 16, phi: 3, source };
      // Measured: 2.2e-15, 2.0e-15, 2.9e-15, 3.1e-15 at h = 3 — against an h = 2
      // reading of 0.25 to 0.77 in the same images.
      expect(Math.abs(harmonicContrast(cell, 1)), name).toBeLessThan(NULL_CEILING);
      expect(Math.abs(harmonicContrast(cell, 3)), name).toBeLessThan(NULL_CEILING);
      expect(harmonicContrast(cell, 2), name).toBeGreaterThan(0.2);
    }
  });

  it("breaks under defocus — all of them at once, and only where the orders reach", () => {
    const source = diskSource(0.6, 11);
    const focused: Cell = { pupilSamples: 32, cycles: 6, phi: 1.5, source };
    const defocused: Cell = { ...focused, defocus: 1 };
    // 2.7e-16 → 3.9e-3 at h = 3, 8.6e-16 → 2.6e-3 at h = 5. The pupil is still
    // even; it is no longer real, and that is the whole of it.
    for (const odd of [1, 3, 5]) {
      expect(Math.abs(harmonicContrast(focused, odd))).toBeLessThan(NULL_CEILING);
      expect(Math.abs(harmonicContrast(defocused, odd))).toBeGreaterThan(1e-4);
    }

    // The exception that is not one: under a COHERENT source at this ν no order
    // pair 5 apart is inside the pupil at all (|m| <= 2 pass, and 2 − (−2) is 4),
    // so h = 5 stays at 1.4e-15 through the same defocus that takes h = 3 to
    // 0.246. That is § 6ab.12's support criterion, not parity — the two nulls
    // look identical on screen and come apart under exactly this control.
    const coherentFocused: Cell = { pupilSamples: 32, cycles: 6, phi: 1.5, source: coherentSource() };
    const coherentDefocused: Cell = { ...coherentFocused, defocus: 1 };
    expect(Math.abs(harmonicContrast(coherentDefocused, 3))).toBeGreaterThan(0.1);
    expect(Math.abs(harmonicContrast(coherentFocused, 5))).toBeLessThan(NULL_CEILING);
    expect(Math.abs(harmonicContrast(coherentDefocused, 5))).toBeLessThan(NULL_CEILING);
  });
});

/**
 * Each regime is ν strictly inside (1/(M+1), 1/M) with M = h/2, so that orders
 * |m| ≤ M pass and ±(M+1) do not — and off the rim on purpose, since ν = 1/M
 * puts order M exactly on it. ν = 2·cycles/pupilSamples.
 */
const FAMILY: { h: number; pupilSamples: number; cycles: number; nu: number }[] = [
  { h: 2, pupilSamples: 32, cycles: 12, nu: 0.75 },
  { h: 4, pupilSamples: 32, cycles: 6, nu: 0.375 },
  { h: 6, pupilSamples: 32, cycles: 5, nu: 0.3125 },
  { h: 8, pupilSamples: 64, cycles: 7, nu: 0.21875 },
];

describe("§ 6ab.15 — the even harmonics are a family of closed forms", () => {
  for (const { h, pupilSamples, cycles, nu } of FAMILY) {
    it(`contrast(${h}ν)·mean = 2·J${h / 2}(φ)² at ν = ${nu}`, () => {
      for (const phi of [0.4, 1.5, 3]) {
        const cell: Cell = { pupilSamples, cycles, phi, source: coherentSource() };
        const measured = harmonicReading(cell, h).amplitude;
        // The external number is written out at the assertion rather than hidden
        // behind a helper: it is the whole content of the rung.
        const closed = 2 * besselJ(h / 2, phi) ** 2;
        // Worst residual across the family and all three φ: 2.3e-14 (h = 2, φ = 3).
        expect(Math.abs(measured - closed)).toBeLessThan(1e-12);
        // And the predicate agrees this is where the closed form applies.
        expect(
          onlySymmetricPairPasses(PUPIL, coherentSource(), { cycles, pupilSamples, harmonic: h }),
        ).toBe(true);
      }
    });
  }

  it("is exactly defocus-invariant, where the h = 1 reading swings from 0 to 1.14", () => {
    for (const { h, pupilSamples, cycles } of FAMILY) {
      const closed = 2 * besselJ(h / 2, 1.5) ** 2;
      for (const defocus of [0, 1, 3]) {
        const cell: Cell = { pupilSamples, cycles, phi: 1.5, source: coherentSource(), defocus };
        // The pair sits symmetric about the axis, so its two members are at the
        // same pupil radius and an even aberration gives them the same phase,
        // which the beat cancels. Nothing here is a small-defocus approximation:
        // w₂₀ = 3 is three waves.
        expect(Math.abs(harmonicReading(cell, h).amplitude - closed)).toBeLessThan(1e-12);
      }
    }
    // The contrast: the same defocus slider moves h = 1 from a hard null to 1.14.
    const cell: Cell = { pupilSamples: 32, cycles: 6, phi: 1.5, source: coherentSource() };
    expect(Math.abs(harmonicContrast(cell, 1))).toBeLessThan(NULL_CEILING);
    expect(harmonicContrast({ ...cell, defocus: 1 }, 1)).toBeGreaterThan(1);
  });

  it("is defocus-invariant ON THE AXIS ONLY, which an extended source disproves", () => {
    // The invariance argument is that the pair's members share a pupil radius, so
    // an even aberration gives them the same phase. That is an ON-AXIS statement:
    // off axis they sit at |s ± mν| and the beat picks up 4·w₂₀·m·(s·ν).
    //
    // So the predicate is NOT sufficient for the closed form once the pupil is
    // aberrated, and this is the rung that says so — `onlySymmetricPairPasses`
    // answers about the orders, and a caller comparing against 2·J_{h/2}(φ)²
    // through an aberrated pupil owes the extra condition itself.
    const orders = { cycles: 12, pupilSamples: 32, harmonic: 2 };
    const closed = 2 * besselJ(1, 1.5) ** 2;
    const source = diskSource(0.2, 11);
    // In the regime, and in focus, the extended source gives the closed form.
    expect(onlySymmetricPairPasses(PUPIL, source, orders)).toBe(true);
    const focused: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source };
    expect(Math.abs(harmonicReading(focused, 2).amplitude - closed)).toBeLessThan(1e-12);
    // One wave of defocus and it is 98% wrong, while the predicate — which never
    // looked at the wavefront — still says the orders are alone.
    const defocused: Cell = { ...focused, defocus: 1 };
    const off = Math.abs(harmonicReading(defocused, 2).amplitude - closed) / closed;
    expect(off).toBeGreaterThan(0.5);
    // The same defocus over the on-axis source leaves it exact, so what broke is
    // the direction and not the aberration.
    const axial: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source: coherentSource() };
    expect(
      Math.abs(harmonicReading({ ...axial, defocus: 1 }, 2).amplitude - closed),
    ).toBeLessThan(1e-12);
  });

  it("recovers § 6f's 2·J₁(φ)² as its h = 2 member rather than restating it", () => {
    // A3 checks contrast(2ν)·mean against 2·J₁(φ)² in 0.5 < ν < 1 at S = 0. That
    // is this family at h = 2, and `onlySymmetricPairPasses` says so without being
    // told: ν = 0.75 puts ±1 through and ±2 outside.
    const orders = { cycles: 12, pupilSamples: 32, harmonic: 2 };
    expect(onlySymmetricPairPasses(PUPIL, coherentSource(), orders)).toBe(true);
    const cell: Cell = { pupilSamples: 32, cycles: 12, phi: 1.5, source: coherentSource() };
    expect(Math.abs(harmonicReading(cell, 2).amplitude - 2 * besselJ(1, 1.5) ** 2)).toBeLessThan(
      1e-12,
    );
  });
});

describe("§ 6ab.15 — the regime is a predicate, and it says no where the closed form fails", () => {
  const PHI = 1.5;
  const CLOSED_H4 = 2 * besselJ(2, PHI) ** 2;

  /** Relative error of the h = 4 closed form at ν = cycles/16. */
  function h4Error(cycles: number, source: CondenserSource): number {
    const cell: Cell = { pupilSamples: 32, cycles, phi: PHI, source };
    return Math.abs(harmonicReading(cell, 4).amplitude - CLOSED_H4) / CLOSED_H4;
  }

  it("says no BELOW the regime, where a second pair gets through", () => {
    // ν = 0.3125 and 0.25 let orders ±3 and ±4 through, so (−3,+1) and (−4,0) are
    // also 4 apart and `c_4` gains terms. Measured error 74% and 96% — the closed
    // form is not approximately right there, it is wrong.
    for (const [cycles, error] of [
      [5, 0.7],
      [4, 0.9],
    ]) {
      expect(
        onlySymmetricPairPasses(PUPIL, coherentSource(), {
          cycles: cycles!,
          pupilSamples: 32,
          harmonic: 4,
        }),
      ).toBe(false);
      expect(h4Error(cycles!, coherentSource())).toBeGreaterThan(error!);
    }
  });

  it("says no ABOVE it, where no pair 4 apart gets through at all", () => {
    // ν = 0.5625 leaves only |m| <= 1, so there is no pair 4 apart and the
    // harmonic is a hard zero — 4.6e-16 against a closed form of 0.108. This is
    // the case the predicate's own "the pair has to pass" leg catches: without
    // it, the predicate would be true precisely where the closed form is furthest
    // from the truth.
    for (const cycles of [9, 10]) {
      expect(
        onlySymmetricPairPasses(PUPIL, coherentSource(), { cycles, pupilSamples: 32, harmonic: 4 }),
      ).toBe(false);
      expect(h4Error(cycles, coherentSource())).toBeGreaterThan(0.99);
      expect(
        Math.abs(harmonicContrast({ pupilSamples: 32, cycles, phi: PHI, source: coherentSource() }, 4)),
      ).toBeLessThan(NULL_CEILING);
    }
  });

  it("inherits the pupil's own rim convention at ν = 1/M rather than second-guessing it", () => {
    // ν = 0.5 puts order ±2 exactly on |p| = 1, and the rim is where § 6ab.11 and
    // § 6ab.12 both found readings that were artifacts — 8e-4 at ν = 1 off a set
    // of zero area. **It is not one here, and the difference is worth stating:**
    // there the two legs were different quantities (an aperture's AREA against a
    // lattice's WEIGHT), so a rim decision could fall one way for one and the
    // other way for the other. This predicate and the image it predicts consult
    // the same `PupilFunction` at the same coordinates, so whatever the boundary
    // convention is, they cannot disagree about it.
    const orders = { cycles: 8, pupilSamples: 32, harmonic: 4 };
    const cell: Cell = { pupilSamples: 32, cycles: 8, phi: PHI, source: coherentSource() };

    // `idealPupil` admits the rim (its test is ≤ 1), so the pair passes and the
    // closed form holds — measured to 1.7e-13.
    expect(onlySymmetricPairPasses(PUPIL, coherentSource(), orders)).toBe(true);
    expect(h4Error(8, coherentSource())).toBeLessThan(1e-12);

    // The same ν through a pupil whose rim is strict: order ±2 is now outside, no
    // pair 4 apart survives, and BOTH answers move together — the predicate to
    // false and the reading to roundoff. A rim convention is a property of the
    // pupil, and the family follows it wherever it goes.
    const strict: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py < 1 ? 1 : 0),
      phaseWaves: () => 0,
    };
    expect(onlySymmetricPairPasses(strict, coherentSource(), orders)).toBe(false);
    const object = phaseGratingObject({ size: SIZE, cycles: 8, amplitudeRadians: PHI });
    const out = renderBrightfield(
      object,
      (): PatchPupil => ({ pupil: strict }),
      coherentSource(),
      { pupilSamples: 32, patches: 1 },
    );
    expect(Math.abs(imageHarmonic(out.intensity, SIZE, 32).contrast)).toBeLessThan(NULL_CEILING);
    // And `cell` is the same configuration read through the admitting pupil, which
    // is emphatically not roundoff.
    expect(harmonicContrast(cell, 4)).toBeGreaterThan(1e-3);
  });

  it("survives an extended source, and where it stops is a lattice fact and not a bound in S", () => {
    // The tempting bound: the next order enters at source radius 3ν − 1 = 0.125,
    // so require S below it. An 11-point disc at S = 0.13 has its outermost sample
    // at |s| = 0.1273 — past that bound — and the closed form holds to 7.7e-14,
    // because the sample past it is a CORNER: what displaces an order is s_x while
    // s_y spends the pupil's budget without moving anything.
    const eleven = diskSource(0.13, 11);
    let widest = 0;
    for (const p of eleven.points) widest = Math.max(widest, Math.hypot(p.sx, p.sy));
    expect(widest).toBeGreaterThan(3 * 0.375 - 1);
    expect(
      onlySymmetricPairPasses(PUPIL, eleven, { cycles: 6, pupilSamples: 32, harmonic: 4 }),
    ).toBe(true);
    expect(h4Error(6, eleven)).toBeLessThan(1e-12);

    // So the regime's end moves with the lattice, which a formula in S cannot
    // express: S = 0.14 at 11 samples, 0.13 at 41. Measured over a sweep, the
    // predicate and the closed form's survival agree in every cell.
    // The 41-point disc costs ~1 300 source points a render, so it sweeps the
    // crossing rather than the whole range — the cells far from it agree for a
    // reason nothing here is testing.
    for (const [samples, from, to] of [
      [11, 4, 20],
      [41, 10, 16],
    ] as [number, number, number][]) {
      for (let s = from; s <= to; s += 1) {
        const S = s / 100;
        const source = diskSource(S, samples);
        const says = onlySymmetricPairPasses(PUPIL, source, {
          cycles: 6,
          pupilSamples: 32,
          harmonic: 4,
        });
        const holds = h4Error(6, source) < 1e-12;
        expect(says, `S = ${S} at ${samples} samples`).toBe(holds);
      }
    }
    expect(
      onlySymmetricPairPasses(PUPIL, diskSource(0.13, 11), {
        cycles: 6,
        pupilSamples: 32,
        harmonic: 4,
      }),
    ).toBe(true);
    expect(
      onlySymmetricPairPasses(PUPIL, diskSource(0.13, 41), {
        cycles: 6,
        pupilSamples: 32,
        harmonic: 4,
      }),
    ).toBe(false);
  });

  it("is false for every odd harmonic, which has no symmetric pair to be alone", () => {
    for (const harmonic of [1, 3, 5]) {
      expect(
        onlySymmetricPairPasses(PUPIL, coherentSource(), { cycles: 6, pupilSamples: 32, harmonic }),
      ).toBe(false);
    }
  });

  it("guards its arguments rather than answering a question it was not asked", () => {
    const orders = { cycles: 6, pupilSamples: 32, harmonic: 2 };
    expect(() =>
      onlySymmetricPairPasses(PUPIL, coherentSource(), { ...orders, cycles: 0 }),
    ).toThrow(/cycles/);
    expect(() =>
      onlySymmetricPairPasses(PUPIL, coherentSource(), { ...orders, pupilSamples: 2.5 }),
    ).toThrow(/pupilSamples/);
    expect(() =>
      onlySymmetricPairPasses(PUPIL, coherentSource(), { ...orders, harmonic: 0 }),
    ).toThrow(/harmonic/);
  });
});
