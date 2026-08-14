import { describe, expect, it } from "vitest";
import {
  PANEL_SOURCE_SAMPLES,
  frequencyOf,
  renderPhaseScene,
  samplingSpread,
  samplingsThatMatter,
  type PhaseRequest,
} from "../src/phase";

/**
 * § 6ab.11 — what the phase panel prints where its 2ν reading is not converged.
 *
 * § 6ab.10 measured the defect and left the answer open between three shapes:
 * fewer digits, a stated uncertainty, or a refusal. **All three want a boundary,
 * and the measurements below say there is not one to have.** The trouble is not
 * a band in S:
 *
 *   - at **ν = 1 exactly** the reading is 9.4× uncertain at *every* S from 0.25
 *     up, because the ±1 orders land on the pupil rim where the lattice's own
 *     in-or-out decision moves them — the same rim `threeOrderCheck` already
 *     excludes ν = 1 for, showing a second, S-independent face;
 *   - at **ν = 1.94** it is inside 1.05× at S = 1.5, so high S is not uniformly
 *     bad;
 *   - and **φ moves it as hard as either** — at φ = 0.1 and S = 1.5 the spread is
 *     838×, at φ = 3 it is 1.37×, since the 2ν signal grows as φ² and what
 *     disagrees with it does not.
 *
 * A rule in S alone would therefore refuse readings that are fine and print four
 * significant figures on ones that are 9× out.
 *
 * **A cheaper probe than the exhaustive one lies.** Two samplings agreeing
 * bounds nothing: 7-against-11 reads 1.3× at S = 1 where 11-against-21 reads
 * 9.7×, and at S = 1.25 the two swap (7.6× against 1.1×). Every three-of-four
 * subset tried under-reports the four-way spread somewhere.
 *
 * So the panel prints the range across `PANEL_SOURCE_SAMPLES` — every option its
 * own control offers, all of them rendered. That is why this rung pins no new
 * external number and does not need to: the claim is not "the error is X" but
 * "moving this control moves the number by X", and over a four-member list that
 * enumeration is complete rather than sampled. What is asserted below is
 * consistency with § 6ab.10's own measurements plus the two structural facts
 * that kill a boundary.
 */

const BASE: PhaseRequest = {
  size: 128,
  pupilSamples: 32,
  sourceSamples: 11,
  illumination: "brightfield",
  coherenceParameter: 0,
  cycles: 12,
  amplitudeRadians: 0.4,
  defocusWaves: 0,
};

const at = (over: Partial<PhaseRequest>): PhaseRequest => ({ ...BASE, ...over });

/** The in-focus spread, which is what most of these rungs are about. */
function spreadAt(over: Partial<PhaseRequest>) {
  const request = at(over);
  const scene = renderPhaseScene(request);
  if (!scene.ok) throw new Error(scene.error);
  const spread = scene.readout.focused.secondHarmonicSpread;
  if (!spread) throw new Error("no spread — 2ν off grid");
  return spread;
}

describe("§ 6ab.11 — the 2ν spread is exhaustive over the panel's own control", () => {
  it("covers every option the source-samples control offers, and no others", () => {
    // The spread's sentence is "moving THIS control does this". A list that
    // drifted from the control would silently turn it into a sample.
    expect([...PANEL_SOURCE_SAMPLES]).toEqual([7, 11, 15, 21]);
    const spread = spreadAt({ coherenceParameter: 0.6 });
    expect(spread.readings.map((r) => r.samples)).toEqual([...PANEL_SOURCE_SAMPLES]);
    // Three renders, not four: the shipped sampling is already on screen.
    expect(spread.extraFrames).toBe(3);
  });

  it("costs nothing at S = 0, where every sampling is the same one-point source", () => {
    // `sourceFor` returns `coherentSource()` there whatever the count, so this is
    // an identity and not a tolerance — the panel's default state pays no render.
    expect(samplingsThatMatter(at({ coherenceParameter: 0 }))).toEqual([11]);
    const spread = spreadAt({ coherenceParameter: 0 });
    expect(spread.extraFrames).toBe(0);
    expect(spread.readings).toHaveLength(1);
    expect(spread.ratio).toBe(1);
  });

  it("and the reading there really is bit-identical across the four", () => {
    // The shortcut above is a read of `sourceFor`'s branch; this is the physics
    // check on it, rendered the long way at two counts.
    const seven = renderPhaseScene(at({ coherenceParameter: 0, sourceSamples: 7 }));
    const twentyOne = renderPhaseScene(at({ coherenceParameter: 0, sourceSamples: 21 }));
    if (!seven.ok || !twentyOne.ok) throw new Error("render refused");
    expect(seven.readout.focused.secondHarmonic).toBe(
      twentyOne.readout.focused.secondHarmonic,
    );
  });
});

describe("§ 6ab.11 — the two structural facts that rule out a boundary in S", () => {
  it("ν = 1 is 9× uncertain at S = 0.25, where any band in S would call it settled", () => {
    // cycles 16 at pupilSamples 32 is ν = 1 exactly: the ±1 orders sit on the
    // pupil rim and the lattice decides in-or-out for them one point at a time.
    expect(frequencyOf(16, 32)).toBe(1);
    expect(spreadAt({ cycles: 16, coherenceParameter: 0.25 }).ratio).toBeGreaterThan(9);
    // And it does not improve with S, which is what makes it structural rather
    // than the high-S band § 6ab.10 measured at ν = 0.75.
    expect(spreadAt({ cycles: 16, coherenceParameter: 0.9 }).ratio).toBeGreaterThan(9);
  });

  it("ν = 1.94 is settled at S = 1.5, where any band in S would refuse it", () => {
    expect(frequencyOf(31, 32)).toBeCloseTo(1.9375, 12);
    expect(spreadAt({ cycles: 31, coherenceParameter: 1.5 }).ratio).toBeLessThan(1.2);
  });

  it("φ moves it as hard as S does, at one ν and one S", () => {
    const weak = spreadAt({ coherenceParameter: 1.5, amplitudeRadians: 0.1 });
    const strong = spreadAt({ coherenceParameter: 1.5, amplitudeRadians: 3 });
    expect(weak.ratio).toBeGreaterThan(100);
    expect(strong.ratio).toBeLessThan(2);
  });

  it("agrees with § 6ab.10 where the two overlap, at ν = 0.75", () => {
    expect(spreadAt({ coherenceParameter: 0.6 }).ratio).toBeLessThan(1.3);
    expect(spreadAt({ coherenceParameter: 1.0 }).ratio).toBeGreaterThan(5);
  });
});

describe("§ 6ab.11 — the defocused frame is a different quantity", () => {
  /**
   * The module's "2ν is the same at every defocus" is derived at S = 0: one
   * on-axis point puts the ±1 orders at equal pupil radius, so the defocus phase
   * cancels in the beat. Off axis it does not — the beat picks up
   * w₂₀(|s + ν|² − |s − ν|²) = 4·w₂₀·(s·ν), which vanishes for no off-axis point.
   * So the pair needs two probes and not one.
   */
  it("is defocus-invariant at S = 0", () => {
    const focused = renderPhaseScene(at({ coherenceParameter: 0, defocusWaves: 3 }));
    if (!focused.ok) throw new Error(focused.error);
    expect(focused.readout.defocused.secondHarmonic).toBeCloseTo(
      focused.readout.focused.secondHarmonic,
      12,
    );
  });

  it("is not, under an extended source", () => {
    const scene = renderPhaseScene(at({ coherenceParameter: 0.9, defocusWaves: 1 }));
    if (!scene.ok) throw new Error(scene.error);
    const inFocus = scene.readout.focused.secondHarmonic;
    const blurred = scene.readout.defocused.secondHarmonic;
    // Measured 5.87e-3 against 6.64e-4 — a factor of nine, not a rounding.
    expect(inFocus / blurred).toBeGreaterThan(5);
  });

  it("so the two frames get their own spreads, and they differ", () => {
    const scene = renderPhaseScene(
      at({ coherenceParameter: 0.5, defocusWaves: 3, cycles: 12 }),
    );
    if (!scene.ok) throw new Error(scene.error);
    const a = scene.readout.focused.secondHarmonicSpread;
    const b = scene.readout.defocused.secondHarmonicSpread;
    expect(a).not.toBe(b);
    // In focus this cell is settled; at three waves it is not. One probe over the
    // pair would have reported whichever frame it happened to run on.
    expect(a!.ratio).toBeLessThan(1.5);
    expect(b!.ratio).toBeGreaterThan(5);
    expect(scene.readout.checkFrames).toBe(6);
  });

  it("and the pair shares one probe when it is one image", () => {
    const scene = renderPhaseScene(at({ coherenceParameter: 0.5, defocusWaves: 0 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.focused.secondHarmonicSpread).toBe(
      scene.readout.defocused.secondHarmonicSpread,
    );
    expect(scene.readout.checkFrames).toBe(3);
  });
});

describe("§ 6ab.11 — darkfield, which § 6ab.10 never looked at", () => {
  const DARK = { illumination: "darkfield", coherenceParameter: 0 } as const;

  it("is where the panel's own control moves the reading by twelve orders", () => {
    // `annularSource` masks the same lattice, so the ring holds 16 points at
    // N = 7 against 128 at 21, and at ν = 0.75 the 16 do not resolve the beat at
    // all: 8.8e-17 against ~1.5e-3. A reader on that option is being shown "no
    // second harmonic in darkfield", which is false.
    const spread = spreadAt({ ...DARK, cycles: 12 });
    expect(spread.ratio).toBeGreaterThan(1e10);
    const seven = spread.readings.find((r) => r.samples === 7)!.value;
    const eleven = spread.readings.find((r) => r.samples === 11)!.value;
    expect(seven).toBeLessThan(1e-15);
    expect(eleven).toBeGreaterThan(1e-4);
  });

  it("and the other three agree, so it is the sampling and not the physics", () => {
    const spread = spreadAt({ ...DARK, cycles: 12 });
    const rest = spread.readings.filter((r) => r.samples !== 7).map((r) => r.value);
    expect(Math.max(...rest) / Math.min(...rest)).toBeLessThan(1.5);
  });

  it("reports agreement, not an infinite disagreement, on a clear field", () => {
    // φ = 0 in darkfield is `imageHarmonic`'s hard zero at every sampling. A
    // ratio built as max/min would read 0/0 there; every sampling agreeing on
    // exactly nothing is agreement.
    const spread = spreadAt({ ...DARK, cycles: 12, amplitudeRadians: 0 });
    expect(spread.max).toBe(0);
    expect(spread.ratio).toBe(1);
  });
});

describe("§ 6ab.11 — samplings the frequency grid cannot carry are dropped, not clamped", () => {
  it("names them rather than comparing against a truncated pupil", () => {
    // The panel's S ceiling is computed from the count in force, and a coarser
    // lattice reaches further in S than a finer one — the binding sample sits at
    // S·(1 − 1/N). So at pupilSamples 64 on a 128 grid a reader at N = 7 can be
    // at an S that N = 11, 15 and 21 cannot render. `abbeImage` would refuse
    // them, and a truncated pupil would read as a smaller aperture.
    const spread = spreadAt({
      size: 128,
      pupilSamples: 64,
      sourceSamples: 7,
      coherenceParameter: 1.1,
      cycles: 12,
    });
    expect(spread.skipped).toEqual([11, 15, 21]);
    expect(spread.readings.map((r) => r.samples)).toEqual([7]);
    expect(spread.extraFrames).toBe(0);
  });
});

describe("§ 6ab.11 — the timing label the probes made false", () => {
  it("splits the probe's share out of the elapsed total", () => {
    const scene = renderPhaseScene(at({ coherenceParameter: 0.6 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.checkFrames).toBe(3);
    expect(scene.readout.checkMs).toBeGreaterThan(0);
    expect(scene.readout.checkMs).toBeLessThan(scene.readout.elapsedMs);
  });

  it("and reports zero of both where the probe needs no render", () => {
    const scene = renderPhaseScene(at({ coherenceParameter: 0 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.checkFrames).toBe(0);
  });
});

describe("§ 6ab.11 — the nine-decimal Bessel readout needs no spread", () => {
  it("exists only where every sampling gives the same image", () => {
    // `threeOrderCheck` requires `coherenceParameter === 0`, which is the one
    // source point. Where the comparison is printed there is nothing for the
    // count to move, which is why its precision was left alone.
    for (const S of [0, 0.25, 0.6, 1]) {
      const scene = renderPhaseScene(at({ coherenceParameter: S, cycles: 12 }));
      if (!scene.ok) throw new Error(scene.error);
      const check = scene.readout.focused.besselCheck;
      if (check) expect(samplingsThatMatter(at({ coherenceParameter: S }))).toHaveLength(1);
    }
  });
});

describe("§ 6ab.11 — no spread where there is no reading", () => {
  it("is null when 2ν is off the grid", () => {
    // `maxCycles` in the panel keeps 2ν on the grid; this is the second line of
    // defence, and a spread over a bin that does not exist would be four NaNs.
    const request = at({ cycles: 40, size: 128 });
    const scene = renderPhaseScene(request);
    if (!scene.ok) throw new Error(scene.error);
    expect(Number.isNaN(scene.readout.focused.secondHarmonic)).toBe(true);
    expect(scene.readout.focused.secondHarmonicSpread).toBeNull();
    expect(samplingSpread(request, 0, Number.NaN)).toBeNull();
  });
});
