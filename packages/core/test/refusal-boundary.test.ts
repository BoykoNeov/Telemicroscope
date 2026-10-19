import { describe, it, expect } from "vitest";
import { renderedBestFocus } from "../src/imaging/focus-surface";
import { objectNumericalAperture } from "../src/pupil/microscope";
import {
  D,
  FINE10,
  FRAMES,
  LADDER,
  LAMBDA,
  P,
  band,
  expectReproduces,
  fieldOf,
  lens,
  straddlesOne,
  sweep,
} from "./support/refusalSweep";

/**
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

/**
 * § 6bq — the refusal boundary moves with magnification.
 *
 * `renderedBestFocus` refuses a sweep whose axial response is a PLATEAU — whose
 * peak falls 5% only after more than `maxPlateauDepths` depths of focus — rather
 * than printing a vertex read off a flat curve. § 6bk through § 6bn knew only
 * that every NA 0.10 lens passes and every NA 0.20 lens refuses, a whole factor
 * of two, and § 6bo.5 narrowed it at 20× to a crossing between **0.15 (0.5985,
 * passes)** and **0.18 (1.0739, refuses)**. That bracket is three ladder steps
 * wide, it was taken at one frame, and it exists at one magnification.
 *
 * This step gives it a second magnification and three frame sizes. § 6bn.1
 * pinned that the highest aperture the solver builds RISES with magnification —
 * 0.22 at 10×, 0.25 at 20× — and left open whether the refusal boundary does the
 * same. It does, and the two move together:
 *
 * | | buildable ceiling (§ 6bn.1) | refusal boundary (here) |
 * | --- | --- | --- |
 * | 10× | 0.22 | crossing in **(0.15, 0.16]**, unanimous over three frames |
 * | 20× | 0.25 | crossing in **(0.17, 0.19)**, with 0.18 REFUSED as the frame's |
 *
 * **§ 6bo.5's bracket is confirmed and it is loose**, and its field control is
 * the interesting casualty. It changed the field alone at NA 0.10, 0.15 and 0.20
 * and found the plateau moving under 3%, which is what licensed calling the
 * boundary "real optics". Its NA 0.10 reading reproduces here to twelve digits.
 * The generalisation does not: run at a uniform 2× field change across all seven
 * apertures the plateau moves by **0.66% to 15.55%**, and **three of the seven
 * exceed 3%** — 0.18 by 9.36%, 0.20 by 4.76% and 0.22 by 15.55%. The two largest
 * are the two apertures § 6bo.5 did not sample, and its own 0.20 came in at 2.64%
 * only because it halved the field where this doubles it, the dependence not
 * being monotone. At **NA 0.18 the 9.36% carries the readout across the
 * threshold** — 0.9820 passes at the smaller frame and 1.0739 refuses at the
 * larger one. So the boundary is real optics away from the crossing and is the
 * frame's AT it, which is exactly where a caller would want to quote it.
 *
 * **What the magnification lever moves is the image, not the normaliser.**
 * `plateauDepths` divides by `λ/NA_object²`, and the traced object NA is
 * magnification-free: at NA 0.15 the depth of focus is 0.019175532 mm at 10× and
 * 0.019170802 mm at 20×, agreeing to **2.5e-4**. The whole of the 1.5364× gap
 * between the two lenses at one field sits in the curvature of the peak-vs-stage
 * curve, and the decomposition closes — `sqrt(curvature ratio)` over the measured
 * depths ratio is 1.000247, which is the depth-of-focus ratio and nothing else.
 *
 * Every band below is taken over `(64, 24)`, `(128, 48)` and `(256, 96)` — a 4×
 * range of frame extent at one pixel pitch. **Why those three and not others is
 * measured in `refusal-frames.test.ts`**, this step's other half: that
 * the reading survives halving the pixel pitch to twelve digits (§ 6bq.2), and
 * that a 32-pixel frame in the same family finds a different vertex entirely and
 * is excluded by measurement rather than by taste (§ 6bq.5). The two files are
 * one step; `support/refusalSweep.ts` says why they are two files.
 */

describe("§ 6bq.1 — the branch column reproduces, and the 10× ceiling is where § 6bn.1 put it", () => {
  it("§ 6bo.5's seven plateau depths come back unchanged", () => {
    const published = [
      0.3722815616422731, 0.42476740698848536, 0.6023875557712574, 1.1187707034456464,
      1.2959938930517378, 1.5886088481161025, 2.3137713181431914,
    ];
    LADDER.forEach((na, i) => expect(D(20, na, 128, 48)).toBeCloseTo(published[i]!, 12));
  });

  it("and the 10× ladder stops where the solver stops, not where the sweep does", () => {
    // § 6bn.1's ceiling, re-pinned because this step's 10× column ends at it.
    expect(() => lens(10, 0.22)).not.toThrow();
    expect(() => lens(10, 0.25)).toThrow(/APERTURE and not the glass pair/);
  });
});

describe("§ 6bq.3 — the magnification lever moves the image, not the normaliser", () => {
  it("the depth of focus is magnification-free to 2.5e-4, because the traced NA is", () => {
    const slow = P(10, 0.15, 128, 48);
    const fast = P(20, 0.15, 64, 24);
    expect(slow.depthOfFocusMm).toBeCloseTo(0.01917553189763791, 12);
    expect(fast.depthOfFocusMm).toBeCloseTo(0.01917080235408424, 12);
    expect(slow.depthOfFocusMm / fast.depthOfFocusMm - 1).toBeLessThan(3e-4);

    expect(objectNumericalAperture(lens(10, 0.15), LAMBDA)).toBeCloseTo(0.1497478232265655, 12);
    expect(objectNumericalAperture(lens(20, 0.15), LAMBDA)).toBeCloseTo(0.1497662938978162, 12);
  });

  it("so the whole 1.6202× gap is curvature, and the decomposition closes", () => {
    const slow = P(10, 0.15, 128, 48);
    const fast = P(20, 0.15, 64, 24);
    expect(slow.curvature).toBeCloseTo(-0.007053938544264419, 12);
    expect(fast.curvature).toBeCloseTo(-0.01852504738656639, 12);

    const depths = slow.plateauDepths / fast.plateauDepths;
    const fromCurvature = Math.sqrt(Math.abs(fast.curvature) / Math.abs(slow.curvature));
    expect(depths).toBeCloseTo(1.620155495716152, 12);
    expect(fromCurvature).toBeCloseTo(1.6205551970869752, 12);

    // The residual between them is the depth-of-focus ratio and nothing else —
    // § 6bo.3's rule, that a ratio is decomposed before it is interpreted.
    expect(fromCurvature / depths).toBeCloseTo(slow.depthOfFocusMm / fast.depthOfFocusMm, 9);
  });
});

describe("§ 6bq.4 — a finer ladder narrows § 6bo.5's bracket, and the ladder is not monotone", () => {
  it("three inserted apertures cut the 20× bracket from three steps to one", () => {
    expect(D(20, 0.16, 128, 48)).toBeCloseTo(0.8870602039570573, 12);
    expect(D(20, 0.17, 128, 48)).toBeCloseTo(0.8633348891438541, 12);
    expect(D(20, 0.19, 128, 48)).toBeCloseTo(1.1600612775856871, 12);

    // § 6bo.5 could say only "between 0.15 and 0.18". At this frame it is
    // between 0.17 and 0.18 — and § 6bq.6 shows that call is the frame's.
    expect(D(20, 0.17, 128, 48)).toBeLessThan(1);
    expect(D(20, 0.18, 128, 48)).toBeGreaterThan(1);

    // 0.16 to 0.17 FALLS 2.7% — one aperture step, the wrong way. On the aim
    // layout it was a shelf, 0.107% apart and rising (§ 2r.2).
    expect(D(20, 0.17, 128, 48) / D(20, 0.16, 128, 48)).toBeCloseTo(0.9732539970710357, 12);
    expect(D(20, 0.17, 128, 48)).toBeLessThan(D(20, 0.16, 128, 48));
  });

  it("and at a matched field the ladder inverts between 0.16 and 0.17 — not between 0.19 and 0.20", () => {
    // § 2r.2 REVERSED in place, kept in kind. On the aim layout the matched
    // frame inverted between 0.19 and 0.20, by 0.13% (1.1759 against 1.1743).
    // On the exit layout that step rises 11%, and the inversion is one step
    // lower, where the larger frame's shelf now falls too: 9.5% at this frame.
    expect(D(20, 0.19, 64, 24)).toBeCloseTo(1.2094000920008314, 12);
    expect(D(20, 0.2, 64, 24)).toBeCloseTo(1.3431649813016484, 12);
    expect(D(20, 0.2, 64, 24)).toBeGreaterThan(D(20, 0.19, 64, 24));
    expect(D(20, 0.16, 64, 24)).toBeCloseTo(0.9270027796311074, 12);
    expect(D(20, 0.17, 64, 24)).toBeCloseTo(0.8468994247028685, 12);

    // § 6bo.5 pinned the seven-point ladder monotone in aperture. It is, at its
    // own frame and at its own steps; a finer ladder is not, at either frame.
    expect(D(20, 0.17, 64, 24)).toBeLessThan(D(20, 0.16, 64, 24));
    expect(D(20, 0.16, 64, 24) / D(20, 0.17, 64, 24)).toBeCloseTo(1.0945842594666337, 12);

    // Both readings pass, so it costs no verdict — it costs the WORD monotone,
    // which § 6bo.5 used to order the ladder.
    for (const na of [0.16, 0.17]) expect(D(20, na, 64, 24)).toBeLessThan(1);
  });

  it("while the 10× ladder at its own frame is monotone across all eight", () => {
    const ten = FINE10.map((na) => D(10, na, 128, 48));
    // Recorded readings — see `expectReproduces` for why they are compared as
    // relative distances and not with `toEqual`. The monotonicity below is the
    // rung; these eight are what it was measured on.
    expectReproduces(ten, [
      0.37615334937848366, 0.46654675712193866, 0.9817631998807098, 1.0419741268651355,
      1.138601718633904, 1.270068843565863, 1.4285749609398368, 2.0186944804329108,
    ]);
    for (let i = 1; i < ten.length; i++) expect(ten[i]!).toBeGreaterThan(ten[i - 1]!);
  });
});

describe("§ 6bq.6 — the boundary is bracketed at 10× and at 20×, and it RISES with M", () => {
  it("the three frames are one field ladder at one pixel pitch", () => {
    // Each frame is twice the extent of the last and has twice the pixels, so
    // the pitch is the same throughout — the ball is sampled identically and
    // what changes is how much empty field surrounds it.
    for (const [M, na] of [
      [10, 0.16],
      [20, 0.18],
    ] as const) {
      const pitches = FRAMES.map(([size, ps]) => fieldOf(M, na, size, ps) / size);
      expect(pitches[1]!).toBeCloseTo(pitches[0]!, 12);
      expect(pitches[2]!).toBeCloseTo(pitches[0]!, 12);
      expect(fieldOf(M, na, 128, 48) / fieldOf(M, na, 64, 24)).toBeCloseTo(2, 12);
      expect(fieldOf(M, na, 256, 96) / fieldOf(M, na, 64, 24)).toBeCloseTo(4, 12);
    }
  });

  it("at 10× the crossing is (0.15, 0.16], and both sides are unanimous", () => {
    const passes = FRAMES.map(([size, ps]) => D(10, 0.15, size, ps));
    const refuses = FRAMES.map(([size, ps]) => D(10, 0.16, size, ps));
    expectReproduces(passes, [0.9088684851208501, 0.9817631998807098, 0.9455123714010261]);
    expectReproduces(refuses, [1.0876226544988319, 1.0419741268651355, 1.0607371965792758]);

    for (const d of passes) expect(d).toBeLessThan(1);
    for (const d of refuses) expect(d).toBeGreaterThan(1);
    expect(straddlesOne(passes)).toBe(false);
    expect(straddlesOne(refuses)).toBe(false);

    // The tightest bracket on this branch: one aperture step, over a 4× range of
    // frame extent, with the refusing band only 4.4% wide (3.8% on the aim layout).
    const [lo, hi] = band(refuses);
    expect(hi / lo).toBeCloseTo(1.0438096555919616, 12);
  });

  it("at 20× NA 0.18 REFUSES at every frame — on the aim layout which side of 1 it fell was the frame's", () => {
    // § 2r.2 REVERSED. On the aim layout the three frames read 0.982, 1.074 and
    // 1.073: they straddled 1, so no verdict was stated at 0.18 — § 6bp.6's
    // device. On the exit layout all three refuse, in a band 4.6% wide, so the
    // 20× boundary is bracketed as the 10× one is: (0.17, 0.18], unanimous.
    const refusing = FRAMES.map(([size, ps]) => D(20, 0.18, size, ps));
    expectReproduces(refusing, [1.0696970919321755, 1.1187707034456464, 1.086154796580342]);
    expect(straddlesOne(refusing)).toBe(false);
    for (const d of refusing) expect(d).toBeGreaterThan(1);

    const [lo, hi] = band(refusing);
    expect(hi / lo).toBeCloseTo(1.0458761754926622, 12);

    // The bracket that survives the refusal: 0.17 passes and 0.19 refuses, at
    // both frames each was measured on.
    for (const [size, ps] of [
      [64, 24],
      [128, 48],
    ] as const) {
      expect(D(20, 0.17, size, ps)).toBeLessThan(1);
      expect(D(20, 0.19, size, ps)).toBeGreaterThan(1);
    }
  });

  it("so the boundary rises with magnification, as § 6bn.1's buildable ceiling does", () => {
    // 10× refuses from 0.16; 20× still passes at 0.17 and is undecided at 0.18.
    expect(D(10, 0.16, 128, 48)).toBeGreaterThan(1);
    expect(D(20, 0.16, 128, 48)).toBeLessThan(1);
    expect(D(20, 0.17, 128, 48)).toBeLessThan(1);
    expect(D(10, 0.17, 128, 48)).toBeGreaterThan(1);

    // And it holds at the matched field, where the 20× frame IS the 10× one:
    // the slow lens is the wider plateau at every aperture above 0.10.
    for (const na of [0.12, 0.15, 0.16, 0.17, 0.18]) {
      expect(D(10, na, 128, 48)).toBeGreaterThan(D(20, na, 64, 24));
    }
    expect(D(10, 0.15, 128, 48) / D(20, 0.15, 64, 24)).toBeCloseTo(1.620155495716152, 12);
    // At 0.10 the two lenses agree to 0.18%, which is where the separation starts.
    expect(D(10, 0.1, 128, 48) / D(20, 0.1, 64, 24)).toBeCloseTo(1.0092142271549085, 12);
  });
});

describe("§ 6bq.7 — § 6bo.5's field control sampled the flat apertures", () => {
  it("its NA 0.10 control reproduces, and the two biggest movers are the two it skipped", () => {
    // The same experiment it ran — field alone, aperture held — at all seven,
    // and at a uniform 2×, which only its NA 0.10 control was.
    const moved = LADDER.map((na) => D(20, na, 128, 48) / D(20, na, 64, 24));
    expectReproduces(moved, [
      0.9988262742778071, 0.9991892705494844, 0.9940905395032201, 1.0458761754926622,
      0.9648806446664523, 0.7056325132435267, 1.1916726283390513,
    ]);

    // § 6bo.5's 0.10 reading, to twelve digits — the same lens, the same pair of
    // frames, the same 0.12% (1.10% on the aim layout). Its other two used 1.5×
    // and a halving, so they are not this experiment and are not asserted
    // against it.
    expect(moved[0]!).toBeCloseTo(0.9988262742778071, 12);

    // Ranked by distance from 1: the two apertures the field moves most, 0.22 and
    // 0.25, are two § 6bo.5 did not sample, and they are last. (On the aim
    // layout the two were 0.18 and 0.22 — also unsampled.)
    const ranked = LADDER.map((na, i) => ({ na, off: Math.abs(moved[i]! - 1) })).sort(
      (a, b) => a.off - b.off,
    );
    expect(ranked.map((r) => r.na)).toEqual([0.12, 0.1, 0.15, 0.2, 0.18, 0.25, 0.22]);
    expect(ranked.slice(-2).map((r) => r.na)).toEqual([0.25, 0.22]);
  });

  it("the generalisation fails: 0.08% to 29.4% — and, on this layout, none of it crosses the threshold", () => {
    const off = LADDER.map((na) => Math.abs(D(20, na, 128, 48) / D(20, na, 64, 24) - 1));
    expect(Math.min(...off)).toBeCloseTo(0.0008107294505156348, 12);
    expect(Math.max(...off)).toBeCloseTo(0.2943674867564733, 12);

    // "Under 3%" holds for three of the seven and fails for four — including
    // NA 0.20, which § 6bo.5 measured at 0.82% by halving the field where this
    // doubles it. The dependence is not monotone, so the two are both correct.
    // (Four and three on the aim layout, 0.66% to 15.55%.)
    expect(off.filter((o) => o < 0.03).length).toBe(3);
    expect(off.filter((o) => o >= 0.03).length).toBe(4);

    // § 2r.2 REVERSED: on the aim layout the one that mattered was at the
    // crossing — NA 0.18 at 20×, two frames, two different answers to "does
    // this refuse?" (0.982 and 1.074). On the exit layout both refuse, and no
    // aperture this file measures at two frames gets two answers.
    expect(D(20, 0.18, 64, 24)).toBeGreaterThan(1);
    expect(D(20, 0.18, 128, 48)).toBeGreaterThan(1);
    for (const na of LADDER) {
      expect(D(20, na, 64, 24) > 1).toBe(D(20, na, 128, 48) > 1);
    }
  });

  it("and the field dependence is not even monotone", () => {
    // Three frames at one aperture, each twice the last: down, then up. So no
    // single-signed correction turns one frame's reading into another's.
    const across = FRAMES.map(([size, ps]) => D(10, 0.16, size, ps));
    expect(across[1]!).toBeLessThan(across[0]!);
    expect(across[2]!).toBeGreaterThan(across[1]!);
    expect(across[0]! / across[1]!).toBeCloseTo(1.0438096555919616, 12);
    expect(across[2]! / across[1]!).toBeCloseTo(1.018007231878771, 12);
  });
});

describe("§ 6bq.8 — both ceilings refuse, which closes § 6bn's above-the-ceiling item", () => {
  it("the highest aperture that builds at 10× refuses, as the 20× one does", () => {
    // § 6bn.1 raised the ceiling and § 6bn measured only the 20×/0.25 half.
    expect(D(10, 0.22, 128, 48)).toBeCloseTo(2.0186944804329108, 12);
    expect(D(20, 0.25, 128, 48)).toBeCloseTo(2.3137713181431914, 12);
    for (const d of [D(10, 0.22, 128, 48), D(20, 0.25, 128, 48)]) expect(d).toBeGreaterThan(1);
  });

  it("and the real threshold reports the number this file has been reading", () => {
    // Every reading above opens the threshold to 1e9 so a refusing lens still
    // yields a number. Put it back, and the refusal names that number.
    expect(() => renderedBestFocus(lens(10, 0.15), LAMBDA, 0, sweep(128, 48, 1))).not.toThrow();

    let refusal = "";
    try {
      renderedBestFocus(lens(10, 0.16), LAMBDA, 0, sweep(128, 48, 1));
    } catch (e) {
      refusal = (e as Error).message;
    }
    expect(refusal).toMatch(/plateau/);
    expect(refusal).toMatch(/1\.0419/); // 1.0019 on the aim layout
    expect(refusal).toMatch(/depths of focus/);
  });
});
