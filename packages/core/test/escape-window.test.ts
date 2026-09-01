import { describe, it, expect } from "vitest";
import { fluorescenceSpectralVolume, labelledVolumeEmitters } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { renderedBestFocus, type FocusProbe, type FocusSweepOptions } from "../src/imaging/focus-surface";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6cc — the escape's high-anchor fall, which is the slow cells running dry.
 *
 * § 6br.6 measured the guard-band escape's interaction over five anchor fields —
 * 0.2462866, 0.3596838, 0.4108834, 0.3100469, 0.1249815 — and left the top end
 * open, in terms: "**The high-anchor fall has no account.** The low end is a
 * saturation of a bounded fraction and is pinned as such; at the large anchor
 * every cell is under 0.1, nothing is near the bound, and the quotient falls by
 * a factor of three anyway. Measured, not explained." Every step from § 6bt to
 * § 6cb has carried it forward untouched.
 *
 * ## The anchor moves two things, and only one of them is the field
 *
 * `escaped` renders at `size` and `pupilSamples`, and the anchor scales both.
 * `halfExtentMm` goes as `pupilSamples` and nothing else (§ 6bw.2), so the
 * anchor's field IS its pupil sampling — one knob, two effects, and they cannot
 * be separated by choosing a different frame. § 6br.5 and § 6br.7 both moved
 * `size` at a HELD `pupilSamples`, so neither of them touched this.
 *
 * They can be separated the other way. The pixel scale is `ps/size` and the
 * ladder holds it, so **one render at the largest anchor contains every smaller
 * anchor's field as a centred sub-box of itself**, at that largest anchor's
 * pupil sampling. Reading the four boxes of one render is the anchor ladder with
 * the sampling held still.
 *
 * ## The fall is the window's, and it is stronger than published
 *
 * Held at one sampling the interaction runs **0.4764788, 0.3726088, 0.2582668,
 * 0.1249815** — monotone, and 3.81× end to end where the published curve falls
 * 3.29× over the same four (§ 6cc.1). So the fall is not a sampling artefact,
 * and the sampling has been masking a third of it: at the k = 1 box the
 * fine-sampled reading is 0.4764788 against the ladder's own 0.4108834, 16%
 * higher (§ 6cc.2).
 *
 * ## And the mechanism is the mirror of the low end's
 *
 * § 6br.6's low shoulder is the escape saturating against its upper bound of 1.
 * The high end is the two SLOW cells saturating against the other bound: by the
 * third box they have no light left outside it — 0.0052 and 0.0026, and both
 * TURN and rise at the fourth — while the fast cells still have a fifth and a
 * tenth of theirs to lose. A quotient whose denominator has stopped moving
 * cannot hold still, and the 20× aperture lever collapses 20.86 → 4.70 where
 * the 10× only gives up a third (§ 6cc.3).
 *
 * The profiles say why: at three quarters of a millimetre the slow cells hold
 * 98.5% and 99.3% of their energy inside the box and the fast ones 79.4% and
 * 69.0% (§ 6cc.4). A slow objective at this field puts its light in a spot; a
 * fast one spreads it, and only the spread has anywhere left to go.
 */

const DESIGN = 587.5618;
const SIZE = 128;
const PS = 32;
const ANCHOR = 4;
const AXIS = { x: 0, y: 0 };
const EDGE = { x: ANCHOR, y: 0 };
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bk's sweep with § 6bk.8's threshold device, used only for an axial stage. */
const OPEN: FocusSweepOptions = {
  size: 128,
  pupilSamples: 48,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths: 1e9,
  radialMapSeed: "magnification",
};

const magOf = (s: OpticalSystem): number =>
  objectFieldTile(s, { size: SIZE, pupilSamples: PS, wavelengthNm: DESIGN, centreMm: AXIS })
    .magnification;
const extentOf = (s: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(s, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS }).halfExtentMm;

type Cell = "s20" | "f20" | "s10" | "f10";
const CELLS: readonly Cell[] = ["s20", "f20", "s10", "f10"];
const LENS: Record<Cell, OpticalSystem> = {
  s20: build(20, 0.1),
  f20: build(20, 0.2),
  s10: build(10, 0.1),
  f10: build(10, 0.2),
};
/** § 6bk's matched object height: every cell's ball at the same IMAGE radius. */
const HEIGHT: Record<Cell, number> = {
  s20: objectHeightForImageRadius(LENS.s20, ANCHOR, DESIGN, { magnification: magOf(LENS.s20) }),
  f20: objectHeightForImageRadius(LENS.f20, ANCHOR, DESIGN, { magnification: magOf(LENS.f20) }),
  s10: objectHeightForImageRadius(LENS.s10, ANCHOR, DESIGN, { magnification: magOf(LENS.s10) }),
  f10: objectHeightForImageRadius(LENS.f10, ANCHOR, DESIGN, { magnification: magOf(LENS.f10) }),
};

const once = <T>(make: () => T): (() => T) => {
  let held: { v: T } | undefined;
  return () => (held ??= { v: make() }).v;
};
/** The branch's convention since § 6bk.4: each lens at its OWN axial stage. */
const STAGE: Record<Cell, () => number> = {
  s20: once(() => renderedBestFocus(LENS.s20, 430, 0, OPEN).focusMm),
  f20: once(() => renderedBestFocus(LENS.f20, 430, 0, OPEN).focusMm),
  s10: once(() => renderedBestFocus(LENS.s10, 430, 0, OPEN).focusMm),
  f10: once(() => renderedBestFocus(LENS.f10, 430, 0, OPEN).focusMm),
};

/** § 6bk.4's render — § 6br's `escaped`, stopping before it takes the scalar. */
function plane(cell: Cell, ps: number, size: number): { v: Float64Array; n: number } {
  const source = labelledVolumeEmitters([
    {
      density: gaussianBallEmitter({
        waistMm: 0.005,
        axialWaistMm: 0.004,
        peak: 1,
        centreMm: { x: HEIGHT[cell], y: 0, z: 0 },
      }),
      band: boxcarBand(400, 700),
    },
  ]);
  const wide = fluorescenceSpectralVolume(LENS[cell], source, {
    size: size * 2,
    pupilSamples: ps,
    slabs: THIN,
    samples: [{ nm: 430, weight: 1 }],
    centreMm: EDGE,
    radialMapSeed: "magnification",
    focusMm: STAGE[cell](),
  });
  return { v: wide.planes[0]!.intensity, n: wide.size };
}

/**
 * Energy inside the centred box of half-width `w` pixels, cumulative in `w`.
 *
 * The render returns `2·size − 2` pixels for a requested `2·size`, so the frame
 * has no centre pixel and the box of half-width `w` is `2w` pixels across. On
 * that convention `escaped`'s inner box is exactly `w = size/2` and its whole
 * frame is `w = size − 1`, which is what makes § 6cc.1 the same reading.
 */
function boxProfile(v: Float64Array, n: number): Float64Array {
  const half = n / 2;
  const c = new Float64Array(half + 1);
  const ring = (i: number): number => (i < half ? half - i : i - half + 1);
  for (let r = 0; r < n; r++) {
    const dr = ring(r);
    for (let col = 0; col < n; col++) {
      const w = Math.max(dr, ring(col));
      if (w <= half) c[w] = c[w]! + v[r * n + col]!;
    }
  }
  for (let w = 1; w <= half; w++) c[w] = c[w]! + c[w - 1]!;
  return c;
}

/** § 6br's own scalar, from a plane. */
const escapeOf = (v: Float64Array, n: number, size: number): number => {
  const o = Math.round((n - size) / 2);
  let inner = 0;
  let all = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = v[r * n + c]!;
      all += x;
      if (r >= o && r < o + size && c >= o && c < o + size) inner += x;
    }
  }
  return 1 - inner / all;
};

/** § 6br's shapes at k = 1: `pupilSamples` and `size`. */
const K1: Record<Cell, readonly [number, number]> = {
  s20: [32, 128],
  f20: [64, 256],
  s10: [64, 256],
  f10: [128, 512],
};
/** § 6bm's interaction: the aperture lever at the high M over the same at low. */
const interact = (q: Record<Cell, number>): number =>
  q.f20 / q.s20 / (q.f10 / q.s10);

/** The four renders at the top anchor, built once and read many ways. */
const TOP = once(() => {
  const out = {} as Record<Cell, { c: Float64Array; half: number; pxMm: number; escape: number }>;
  for (const cell of CELLS) {
    const [ps1, size1] = K1[cell];
    const { v, n } = plane(cell, ps1 * 4, size1 * 4);
    out[cell] = {
      c: boxProfile(v, n),
      half: n / 2,
      pxMm: extentOf(LENS[cell], size1 * 8, ps1 * 4) / (size1 * 4),
      escape: escapeOf(v, n, size1 * 4),
    };
  }
  return out;
});

/** The anchor-`k` field read out of the top render: same picture, same pixel
 *  scale, same physical box — the ladder with the pupil sampling held still. */
const boxed = (cell: Cell, k: number): number => {
  const t = TOP()[cell];
  const w = K1[cell][1] * k;
  return 1 - t.c[w / 2]! / t.c[Math.min(w - 1, t.half)]!;
};
const boxedQuartet = (k: number): Record<Cell, number> =>
  Object.fromEntries(CELLS.map((c) => [c, boxed(c, k)])) as Record<Cell, number>;

/** The ladder's own reading at anchor `k`: its own render, its own sampling. */
const rendered = (cell: Cell, k: number): number => {
  const [ps1, size1] = K1[cell];
  const { v, n } = plane(cell, ps1 * k, size1 * k);
  return escapeOf(v, n, size1 * k);
};

describe("§ 6cc.0 — one render is the whole anchor ladder at one sampling", () => {
  it("reproduces § 6br's top anchor exactly, box and render alike", () => {
    // The largest box of the top render IS the top anchor's own escape, so the
    // sub-box reading below is anchored to the published number and not to a
    // reimplementation of it.
    const top = TOP();
    // The two sum the same pixels in different orders, so they agree to the
    // last few bits rather than bitwise.
    for (const cell of CELLS) {
      expect(Math.abs(boxed(cell, 4) / top[cell].escape - 1)).toBeLessThan(1e-11);
    }
    expect(interact(boxedQuartet(4))).toBeCloseTo(0.1249815, 7);
    // And every cell is under 0.1 there, which is § 6br.6's own observation and
    // the reason it could not appeal to the bound at 1.
    for (const cell of CELLS) expect(top[cell].escape).toBeLessThan(0.1);
  });
});

describe("§ 6cc.1 — held at one sampling the fall is still there, and stronger", () => {
  it("falls monotonically over the four boxes, by 3.81×", () => {
    const got = [1, 2, 3, 4].map((k) => interact(boxedQuartet(k)));
    expect(got[0]).toBeCloseTo(0.4764788, 7);
    expect(got[1]).toBeCloseTo(0.3726088, 7);
    expect(got[2]).toBeCloseTo(0.2582668, 7);
    expect(got[3]).toBeCloseTo(0.1249815, 7);
    for (let n = 1; n < got.length; n++) expect(got[n]!).toBeLessThan(got[n - 1]!);
    // 3.81x against the published curve's 3.29x over the same four anchors
    // (0.4108834 to 0.1249815), so the anchor's OTHER effect was hiding some of
    // this one rather than causing it.
    expect(got[0]! / got[3]!).toBeCloseTo(3.8124, 4);
    expect(0.4108834 / 0.1249815).toBeCloseTo(3.2876, 4);
  });
});

describe("§ 6cc.2 — and the sampling pushes the other way", () => {
  it("reads the same box 16% higher at the finer pupil", () => {
    // Same physical field, same pixel scale, four times the pupil samples. The
    // ladder cannot do this experiment by choosing a frame — `halfExtentMm` goes
    // as `pupilSamples` alone (§ 6bw.2), so the field IS the sampling — but one
    // render read at a sub-box can.
    const q1 = Object.fromEntries(CELLS.map((c) => [c, rendered(c, 1)])) as Record<Cell, number>;
    expect(interact(q1)).toBeCloseTo(0.4108834, 7);
    expect(interact(boxedQuartet(1))).toBeCloseTo(0.4764788, 7);
    expect(interact(boxedQuartet(1)) / interact(q1) - 1).toBeCloseTo(0.1596, 4);
    // Every cell reads LOWER at the finer sampling — the coarse pupil is putting
    // light outside the box that the fine one does not — and by enough that
    // § 6br.5's 0.75% pixel band, taken at a held `pupilSamples`, says nothing
    // about it.
    for (const cell of CELLS) expect(boxed(cell, 1)).toBeLessThan(q1[cell]);
    expect(boxed("s20", 1) / q1.s20).toBeCloseTo(0.5782, 4);
    expect(boxed("f10", 1) / q1.f10).toBeCloseTo(0.5513, 4);
  });
});

describe("§ 6cc.3 — the mechanism: the slow cells run out of light to lose", () => {
  it("bottoms both slow escapes and turns them while the fast ones fall on", () => {
    const q = [1, 2, 3, 4].map(boxedQuartet);
    // The two slow cells fall, bottom at the third box and TURN — there is
    // nothing left outside the box for a bigger box to capture.
    for (const cell of ["s20", "s10"] as const) {
      expect(q[1]![cell]).toBeLessThan(q[0]![cell]);
      expect(q[2]![cell]).toBeLessThan(q[1]![cell]);
      expect(q[3]![cell]).toBeGreaterThan(q[2]![cell]);
    }
    expect(q[3]!.s20).toBeCloseTo(0.005291531, 9);
    expect(q[3]!.s10).toBeCloseTo(0.002644353, 9);
    // The two fast cells are still falling hard at the last box, with a fifth
    // and a tenth of their light still outside it two boxes earlier.
    for (const cell of ["f20", "f10"] as const) {
      for (let n = 1; n < 4; n++) expect(q[n]![cell]).toBeLessThan(q[n - 1]![cell]);
    }
    expect(q[3]!.f20).toBeCloseTo(0.024846491, 9);
    expect(q[3]!.f10).toBeCloseTo(0.099347592, 9);
    // So the 20x aperture lever collapses where the 10x barely gives ground:
    // 20.86 -> 4.70 against 56.00 -> 37.57. That difference IS the fall.
    const l20 = q.map((v) => v.f20 / v.s20);
    const l10 = q.map((v) => v.f10 / v.s10);
    expect(l20[1]!).toBeCloseTo(20.8649, 4);
    expect(l20[3]!).toBeCloseTo(4.6955, 4);
    expect(l10[1]!).toBeCloseTo(55.9968, 4);
    expect(l10[3]!).toBeCloseTo(37.5697, 4);
    expect(l20[1]! / l20[3]!).toBeGreaterThan(4);
    expect(l10[1]! / l10[3]!).toBeLessThan(1.5);
  });
});

describe("§ 6cc.4 — which is what the four energy profiles look like", () => {
  it("puts the slow cells' light in a spot and the fast cells' everywhere", () => {
    // The fraction of each cell's energy inside three quarters of a millimetre.
    // This is the whole asymmetry: a slow objective at this field height has
    // essentially all its light in the box already, and a fast one does not.
    const at = (cell: Cell, mm: number): number => {
      const t = TOP()[cell];
      const w = Math.max(1, Math.min(t.half, Math.round(mm / t.pxMm)));
      return t.c[w]! / t.c[t.half]!;
    };
    expect(at("s20", 0.75)).toBeGreaterThan(0.98);
    expect(at("s10", 0.75)).toBeGreaterThan(0.99);
    expect(at("f20", 0.75)).toBeLessThan(0.8);
    expect(at("f10", 0.75)).toBeLessThan(0.7);
    // And by 1.85 mm the slow cells are inside a quarter of a percent of all
    // their light while the fast 10x is still 10% short.
    expect(at("s20", 1.85)).toBeGreaterThan(0.994);
    expect(at("s10", 1.85)).toBeGreaterThan(0.997);
    expect(at("f10", 1.85)).toBeLessThan(0.91);
    // The ordering is the aperture's, not the magnification's: both fast cells
    // sit below both slow ones at every radius read here.
    for (const mm of [0.75, 1.85, 2.6] as const) {
      expect(Math.max(at("f20", mm), at("f10", mm))).toBeLessThan(
        Math.min(at("s20", mm), at("s10", mm)),
      );
    }
  });
});
