import { describe, it, expect } from "vitest";
import { fluorescenceSpectralVolume, labelledVolumeEmitters } from "../src/imaging/spectral-volume";
import { gaussianBallEmitter, uniformSlabs, type EmitterSlabs } from "../src/imaging/emitter-volume";
import { boxcarBand } from "../src/imaging/emission";
import { renderedBestFocus, type FocusProbe, type FocusSweepOptions } from "../src/imaging/focus-surface";
import { objectFieldTile, objectHeightForImageRadius } from "../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import { ESCAPE_AT_QUADRUPLE_ANCHOR, ESCAPE_MATCHED } from "./support/cited";

/**
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

/**
 * § 6cc — the escape's high-anchor fall, which is the slow cells running dry.
 *
 * § 6br.6 measured the guard-band escape's interaction over five anchor fields —
 * 0.2449032, 0.3666597, 0.3915111, 0.2998738, 0.1096845 on the exit layout's
 * located rim since § 2r.2, restated at § 2y (0.2462866, 0.3596838, 0.4108834, 0.3100469,
 * 0.1249815 on the aim layout's point-sampled one) — and left the top end
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
 * Held at one sampling the interaction runs **0.4262212, 0.3599208, 0.2284388,
 * 0.1096845** — monotone, and 3.89× end to end where § 6br.6's curve falls
 * 3.57× over the same four (§ 6cc.1). So the fall is not a sampling artefact,
 * and the sampling has been masking some of it: at the k = 1 box the
 * fine-sampled reading is 0.4262212 against the ladder's own 0.3915111, 9%
 * higher (§ 6cc.2). And the floor is the light's and not the grid's: halving the
 * pixel scale at the top anchor's own field moves it 0.21%, 66 times less than
 * the turn it would have to explain, and moves a cell that has NOT floored by
 * the same 0.21% (§ 6cc.5).
 *
 * (Every figure here is the exit layout's located rim since § 2r.2. On the aim
 * layout's point-sampled rim: 0.4764788 → 0.1249815, 3.81× against 3.29×, 16%,
 * 0.19% and fourteen times; the slow cells' floor 0.0052 and 0.0026, the 20×
 * lever 20.86 → 4.70 against the 10×'s third; 98.5%, 99.3%, 79.4%, 69.0%.)
 *
 * ## And the mechanism is the mirror of the low end's
 *
 * § 6br.6's low shoulder is the escape saturating against its upper bound of 1.
 * The high end is the two SLOW cells saturating against the other bound: by the
 * third box they have almost no light left outside it — a few thousandths — and both
 * TURN and rise at the fourth — while the fast cells still have light to lose.
 * A quotient whose denominator has stopped moving cannot hold still, and the
 * 20× aperture lever collapses 19.25 → 2.74 where the 10× gives up half
 * (§ 6cc.3).
 *
 * The profiles say why: at three quarters of a millimetre the slow cells hold
 * 98.5% and 99.2% of their energy inside the box and the fast ones 82.0% and
 * 72.1% (§ 6cc.4). A slow objective at this field puts its light in a spot; a
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
    rayAiming: "paraxial", // measured on the paraxial aim and its stop; under real aiming it is open item 48 (§ 2z)
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;

/** § 6bk's sweep with § 6bk.8's threshold device, used only for an axial stage. */
const OPEN: FocusSweepOptions = {
  ...EXIT,
  peak: "band-limited",
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
  objectFieldTile(s, { size: SIZE, pupilSamples: PS, wavelengthNm: DESIGN, centreMm: AXIS, layout: "exit" })
    .magnification;
const extentOf = (s: OpticalSystem, size: number, ps: number): number =>
  objectFieldTile(s, { size, pupilSamples: ps, wavelengthNm: DESIGN, centreMm: AXIS, layout: "exit" }).halfExtentMm;

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
    ...EXIT,
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
  const lost = new Float64Array(half + 1);
  const ring = (i: number): number => (i < half ? half - i : i - half + 1);
  for (let r = 0; r < n; r++) {
    const dr = ring(r);
    for (let col = 0; col < n; col++) {
      const w = Math.max(dr, ring(col));
      if (w <= half) {
        const x = v[r * n + col]!;
        const t = c[w]! + x;
        lost[w] = lost[w]! + (Math.abs(c[w]!) >= Math.abs(x) ? c[w]! - t + x : x - t + c[w]!);
        c[w] = t;
      }
    }
  }
  const sum = compensated();
  for (let w = 0; w <= half; w++) c[w] = sum(c[w]! + lost[w]!);
  return c;
}

/**
 * A running sum carrying what each addition rounds away (Neumaier). The two
 * readouts below sum up to 16.8 million pixels in different orders, and the
 * escape is a difference from 1 of a ratio near 1: plain summation's rounding
 * alone, divided by an escape of a few thousandths, reached 1.14e-11 of it,
 * past the agreement § 6cc.0 bounds (§ 2t). Compensated, they agree to the bit.
 */
function compensated(): (x: number) => number {
  let s = 0;
  let lost = 0;
  return (x) => {
    const t = s + x;
    lost += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
    return s + lost;
  };
}

/** § 6br's own scalar, from a plane. */
const escapeOf = (v: Float64Array, n: number, size: number): number => {
  const o = Math.round((n - size) / 2);
  const inner = compensated();
  const all = compensated();
  let innerSum = 0;
  let allSum = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = v[r * n + c]!;
      allSum = all(x);
      if (r >= o && r < o + size && c >= o && c < o + size) innerSum = inner(x);
    }
  }
  return 1 - innerSum / allSum;
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
    // The two sum the same pixels in different orders. Summed plainly that
    // order reached 1.14e-11 of the slow cells' escape once § 2t moved their
    // last bits; compensated, they agree to the bit on all four, and the bound
    // is kept where it was.
    for (const cell of CELLS) {
      expect(Math.abs(boxed(cell, 4) / top[cell].escape - 1)).toBeLessThan(1e-11);
    }
    expect(interact(boxedQuartet(4))).toBeCloseTo(0.10968454479102531, 7);
    // And every cell is under 0.1 there, which is § 6br.6's own observation and
    // the reason it could not appeal to the bound at 1.
    for (const cell of CELLS) expect(top[cell].escape).toBeLessThan(0.1);
  });
});

describe("§ 6cc.1 — held at one sampling the fall is still there, and stronger", () => {
  it("falls monotonically over the four boxes, by 3.81×", () => {
    const got = [1, 2, 3, 4].map((k) => interact(boxedQuartet(k)));
    expect(got[0]).toBeCloseTo(0.42622116795887205, 7);
    expect(got[1]).toBeCloseTo(0.3599208206005352, 7);
    expect(got[2]).toBeCloseTo(0.22843883806066156, 7);
    expect(got[3]).toBeCloseTo(0.10968454479102531, 7);
    for (let n = 1; n < got.length; n++) expect(got[n]!).toBeLessThan(got[n - 1]!);
    // 3.89x against § 6br.6's own curve's 3.57x over the same four anchors
    // (0.3915111 to 0.1096845), so the anchor's OTHER effect was hiding some of
    // this one rather than causing it. (3.81x against 3.29x on the aim layout's
    // point-sampled rim, § 2r.2.) § 6br.6's two ends come from
    // `support/cited.ts`, asserted where § 6br.6 measures them; until § 2w they
    // were literals here, a ratio of two copies that no reading could fail.
    expect(got[0]! / got[3]!).toBeCloseTo(3.8859150641500815, 4);
    expect(ESCAPE_MATCHED / ESCAPE_AT_QUADRUPLE_ANCHOR).toBeCloseTo(3.5694281932927017, 4);
  });
});

describe("§ 6cc.2 — and the sampling pushes the other way", () => {
  it("reads the same box 9% higher at the finer pupil", () => {
    // 8.9% on the exit layout's located rim (§ 2r.2); 16.0% on the aim layout's
    // point-sampled one, whose coarse pupil put more light outside the box.
    // Same physical field, same pixel scale, four times the pupil samples. The
    // ladder cannot do this experiment by choosing a frame — `halfExtentMm` goes
    // as `pupilSamples` alone (§ 6bw.2), so the field IS the sampling — but one
    // render read at a sub-box can.
    const q1 = Object.fromEntries(CELLS.map((c) => [c, rendered(c, 1)])) as Record<Cell, number>;
    expect(interact(q1)).toBeCloseTo(0.39151110654320326, 7);
    expect(interact(boxedQuartet(1))).toBeCloseTo(0.42622116795887205, 7);
    expect(interact(boxedQuartet(1)) / interact(q1) - 1).toBeCloseTo(0.08865664558570718, 4);
    // Every cell reads LOWER at the finer sampling — the coarse pupil is putting
    // light outside the box that the fine one does not — and by enough that
    // § 6br.5's 0.75% pixel band, taken at a held `pupilSamples`, says nothing
    // about it.
    for (const cell of CELLS) expect(boxed(cell, 1)).toBeLessThan(q1[cell]);
    expect(boxed("s20", 1) / q1.s20).toBeCloseTo(0.5060737689202156, 4);
    expect(boxed("f10", 1) / q1.f10).toBeCloseTo(0.6087036171710015, 4);
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
    expect(q[3]!.s20).toBeCloseTo(0.00607271837187584, 9);
    expect(q[3]!.s10).toBeCloseTo(0.0029969291615397076, 9);
    // The two fast cells are still falling hard at the last box, with a fifth
    // and a tenth of their light still outside it two boxes earlier.
    for (const cell of ["f20", "f10"] as const) {
      for (let n = 1; n < 4; n++) expect(q[n]![cell]).toBeLessThan(q[n - 1]![cell]);
    }
    expect(q[3]!.f20).toBeCloseTo(0.016619168484772184, 9);
    expect(q[3]!.f10).toBeCloseTo(0.07477513235072952, 9);
    // So the 20x aperture lever collapses where the 10x gives less ground:
    // 19.25 -> 2.74 (7.0x) against 53.48 -> 24.95 (2.1x). That difference IS the
    // fall. (On the aim layout's point-sampled rim 20.86 -> 4.70 against 56.00 ->
    // 37.57, the 10x giving up only a third; § 2r.2 — WEAKENED, the 10x's slow
    // cell reads 13% more escape at the top box and its lever falls further.)
    const l20 = q.map((v) => v.f20 / v.s20);
    const l10 = q.map((v) => v.f10 / v.s10);
    expect(l20[1]!).toBeCloseTo(19.24964114840793, 4);
    expect(l20[3]!).toBeCloseTo(2.736694509313498, 4);
    expect(l10[1]!).toBeCloseTo(53.482988609243314, 4);
    expect(l10[3]!).toBeCloseTo(24.950583854412134, 4);
    expect(l20[1]! / l20[3]!).toBeGreaterThan(4);
    expect(l10[1]! / l10[3]!).toBeLessThan(2.5);
    expect(l20[1]! / l20[3]! / (l10[1]! / l10[3]!)).toBeGreaterThan(3);
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
    // 98.5% and 99.2% slow against 82.0% and 72.1% fast (§ 2r.2; on the aim
    // layout's point-sampled rim 98.5%, 99.3%, 79.4% and 69.0%).
    expect(at("s20", 0.75)).toBeCloseTo(0.9845036583397804, 9);
    expect(at("s10", 0.75)).toBeCloseTo(0.9923616150627229, 9);
    expect(at("f20", 0.75)).toBeCloseTo(0.8199022490463747, 9);
    expect(at("f10", 0.75)).toBeCloseTo(0.7208008077775754, 9);
    // And by 1.85 mm the slow cells are inside two thirds of a percent of all
    // their light while the fast 10x is still 7% short (a quarter of a percent
    // and 10% on the aim layout).
    expect(at("s20", 1.85)).toBeCloseTo(0.9937816979071584, 9);
    expect(at("s10", 1.85)).toBeCloseTo(0.9969308636413197, 9);
    expect(at("f10", 1.85)).toBeCloseTo(0.9281661010728476, 9);
    // The ordering is the aperture's, not the magnification's: both fast cells
    // sit below both slow ones at every radius read here.
    for (const mm of [0.75, 1.85, 2.6] as const) {
      expect(Math.max(at("f20", mm), at("f10", mm))).toBeLessThan(
        Math.min(at("s20", mm), at("s10", mm)),
      );
    }
  });
});

describe("§ 6cc.5 — and the floor is the light's, not the grid's", () => {
  it("survives halving the pixel scale at the top anchor's own field", () => {
    // The floor sits in the outermost annulus of an FFT-based render, which is
    // exactly where a wraparound residual would sit — and it would produce this
    // same signature. Doubling `size` at a HELD `pupilSamples` halves the pixel
    // scale at the same physical extent, so an edge artefact moves and a real
    // tail does not. § 6br.7 ran this at the branch's own anchor; the claim
    // lives at the top one, so it is run there.
    const at = (cell: Cell, size: number): number => {
      const p = plane(cell, K1[cell][0] * 4, size);
      return escapeOf(p.v, p.n, size);
    };
    const floored = at("s20", K1.s20[1] * 8) / at("s20", K1.s20[1] * 4);
    expect(floored).toBeCloseTo(1.0020883136735625, 6);
    // 0.21% against the 13.9% turn it would have to explain — 66 times too
    // small — so the slow cells really have run out of light. (On the aim
    // layout's point-sampled rim 0.19% against 2.68%, fourteen times; the turn
    // is the third and fourth boxes' own readings, § 6cc.3.)
    const turn = boxed("s20", 4) / boxed("s20", 3);
    expect(turn - 1).toBeCloseTo(0.1386449248553392, 6);
    expect(turn - 1).toBeGreaterThan(60 * (floored - 1));
    // And the control settles it: a cell that has NOT floored moves by the same
    // 0.18%, so this residual is the render's own and has nothing to do with
    // which cells run dry. (The slow 10x moves 0.10%, measured by this step's
    // probes and not re-run here — a 4096-pixel render for a third instance of
    // a number two cells already make.) On the exit layout both read 0.21%.
    const free = at("f20", K1.f20[1] * 8) / at("f20", K1.f20[1] * 4);
    expect(free).toBeCloseTo(1.0020610273081445, 6);
    expect(Math.abs(free / floored - 1)).toBeLessThan(2e-4);
  });
});
