import { describe, expect, it } from "vitest";
import {
  PANEL_SOURCE_SAMPLES,
  frequencyOf,
  renderPhaseScene,
  samplingSpread,
  samplingsThatMatter,
  secondHarmonicSupport,
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
  const spread = spreadOf(over);
  if (!spread) throw new Error("no spread — 2ν is off the grid or has no support");
  return spread;
}

/** The same, where the *absence* of a spread is the thing being asserted. */
function spreadOf(over: Partial<PhaseRequest>) {
  const scene = renderPhaseScene(at(over));
  if (!scene.ok) throw new Error(scene.error);
  return scene.readout.focused.secondHarmonicSpread;
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

describe("§ 6ab.12 — the two facts § 6ab.11 built its boundary argument on", () => {
  /**
   * Both are now known to have been readings of nothing, and the rungs are kept
   * pointed at the same cells so the panel cannot quietly start printing them
   * again. What survives is the conclusion, on the φ leg below.
   */
  it("ν = 1's 9.4× was a lattice arguing about a set of zero area", () => {
    // cycles 16 at pupilSamples 32 is ν = 1 exactly. § 6ab.11 read the ±1 orders
    // landing on the rim as a structural property OF the rim; § 6ab.12's closed
    // form says the carrying set there is the single on-axis direction, so a real
    // aperture carries nothing and the 8e-4 was the lattice's.
    expect(frequencyOf(16, 32)).toBe(1);
    for (const S of [0.25, 0.9]) {
      const support = secondHarmonicSupport(at({ cycles: 16, coherenceParameter: S }));
      expect(support.apertureCarries).toBe(false);
      // The other leg still has weight — which is exactly the disagreement.
      expect(support.latticeWeight).toBeGreaterThan(0);
      expect(support.exists).toBe(false);
      expect(support.reason).toMatch(/incoherent cutoff/);
      // So no spread is printed, where § 6ab.11 printed 9.4×.
      expect(spreadOf({ cycles: 16, coherenceParameter: S })).toBeNull();
    }
  });

  it("and ν = 1.94's 1.03× was four readings of f64 roundoff", () => {
    expect(frequencyOf(31, 32)).toBeCloseTo(1.9375, 12);
    // 2ν = 3.875, nearly twice the incoherent cutoff. § 6ab.11 called this cell
    // settled and used it as evidence that high S is not uniformly bad — the
    // tightest agreement in the panel, on a quantity that does not exist.
    const support = secondHarmonicSupport(at({ cycles: 31, coherenceParameter: 1.5 }));
    expect(support.apertureCarries).toBe(false);
    expect(support.latticeWeight).toBe(0);
    expect(support.exists).toBe(false);
    expect(spreadOf({ cycles: 31, coherenceParameter: 1.5 })).toBeNull();
    // And the render still leaves something on the line — it is roundoff, and the
    // panel now labels it as arithmetic rather than as a contrast.
    const scene = renderPhaseScene(at({ cycles: 31, coherenceParameter: 1.5 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(
      Math.abs(scene.readout.focused.secondHarmonic) / scene.readout.focused.meanIntensity,
    ).toBeLessThan(1e-13);
  });

  it("so the conclusion rests on the φ leg, which has real support", () => {
    // 27.8% of the illumination at S = 1.5, ν = 0.75 can carry 2ν, so both numbers
    // in the rung below are readings of something — and one S holding both 838×
    // and 1.37× refutes a band in S at a single S, without either withdrawn cell.
    const support = secondHarmonicSupport(at({ coherenceParameter: 1.5 }));
    expect(support.exists).toBe(true);
    expect(support.latticeWeight).toBeGreaterThan(0.2);
  });

  it("φ moves it as hard as S does, at one ν and one S", () => {
    // 838× and 1.37× measured, at the same ν and S. Bounded close for the same
    // reason as above — both numbers are quoted in § 6ab.11.
    const weak = spreadAt({ coherenceParameter: 1.5, amplitudeRadians: 0.1 });
    const strong = spreadAt({ coherenceParameter: 1.5, amplitudeRadians: 3 });
    expect(weak.ratio).toBeGreaterThan(700);
    expect(strong.ratio).toBeLessThan(1.5);
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
    // pair would have reported whichever frame it happened to run on. Measured
    // 1.17 and 13.4, which are the two numbers § 6ab.11 quotes.
    expect(a!.ratio).toBeLessThan(1.3);
    expect(b!.ratio).toBeGreaterThan(10);
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
    //
    // § 6ab.12 gates the 7-sample option, so the spread is now read from a
    // sampling that HAS support and the 8.8e-17 is asserted through the gate's own
    // leg rather than as a reading. The 2.3e13 is still what four readings would
    // do, and it is what sent § 6ab.12 looking.
    const spread = spreadAt({ ...DARK, cycles: 12, sourceSamples: 11 });
    const seven = spread.readings.find((r) => r.samples === 7)!.value;
    const eleven = spread.readings.find((r) => r.samples === 11)!.value;
    expect(seven).toBeLessThan(1e-15);
    expect(eleven).toBeGreaterThan(1e-4);
    expect(spread.ratio).toBeGreaterThan(1e10);
  });

  it("and the other three agree, so it is the sampling and not the physics", () => {
    const spread = spreadAt({ ...DARK, cycles: 12, sourceSamples: 11 });
    const rest = spread.readings.filter((r) => r.samples !== 7).map((r) => r.value);
    expect(Math.max(...rest) / Math.min(...rest)).toBeLessThan(1.5);
  });

  it("so a reader ON the 7-sample option is told, not shown 8.8e-17", () => {
    // The defect § 6ab.11 measured and left shipped. The gate names which leg
    // failed: the ring carries 2ν and this sampling of it does not.
    const support = secondHarmonicSupport(at({ ...DARK, cycles: 12, sourceSamples: 7 }));
    expect(support.apertureCarries).toBe(true);
    expect(support.latticeWeight).toBe(0);
    expect(support.exists).toBe(false);
    expect(support.reason).toMatch(/16-point source/);
    expect(support.reason).toMatch(/raise source samples/);
    expect(spreadOf({ ...DARK, cycles: 12, sourceSamples: 7 })).toBeNull();
  });

  it("and § 6ab.14 makes that advice quantitative rather than a direction", () => {
    // "Raise source samples" is a direction; "7.03% of the aperture carries it
    // and none of your 16 points is in that set" is advice, because it says how
    // thin the target is. The number is the exact carrying AREA — the thing the
    // lattice weight is an estimate of — not a second sampling of it.
    const support = secondHarmonicSupport(at({ ...DARK, cycles: 12, sourceSamples: 7 }));
    expect(support.apertureFraction).toBeCloseTo(0.070267681347553, 9);
    expect(support.reason).toMatch(/7\.03% of the aperture/);
  });

  it("and S = 0 above ν = 1 is refused with advice that can actually be taken", () => {
    // The state where "raise source samples" is false twice over: `sourceFor`
    // returns the same one-point source at every count, and 2ν must clear the
    // incoherent cutoff 2 at ANY S, so no control on the panel rescues it. Two
    // slider drags from the default, and the shared line and the per-canvas line
    // have to agree there — the first version of § 6ab.14's panel line said the
    // one direction carries 2ν unconditionally, which contradicts this cell.
    const support = secondHarmonicSupport(at({ coherenceParameter: 0, cycles: 17 }));
    expect(frequencyOf(17, 32)).toBeGreaterThan(1);
    expect(support.apertureCarries).toBeNull();
    expect(support.apertureFraction).toBeNull();
    expect(support.latticeWeight).toBe(0);
    expect(support.exists).toBe(false);
    expect(support.reason).not.toMatch(/raise source samples/);
    expect(support.reason).toMatch(/no S rescues that/);
    expect(support.reason).toMatch(/below ν = 1/);
    // And just under the cutoff the same single direction does carry it, so the
    // refusal is about ν and not about being coherent.
    expect(secondHarmonicSupport(at({ coherenceParameter: 0, cycles: 15 })).exists).toBe(true);
  });

  it("and the aperture leg's two halves are null together or not at all", () => {
    // `harmonicCarryingArea` refuses an aperture of no area for the same reason
    // `apertureCarriesHarmonic` does, so a mismatch here would not be a wrong
    // number, it would be a throw in the render path. Swept over both
    // illuminations and the S slider's ends.
    for (const illumination of ["brightfield", "darkfield"] as const) {
      for (const coherenceParameter of [0, 0.01, 0.5, 1, 1.4]) {
        for (const cycles of [4, 12, 16]) {
          const support = secondHarmonicSupport(at({ illumination, coherenceParameter, cycles }));
          expect(support.apertureFraction === null).toBe(support.apertureCarries === null);
          if (support.apertureCarries === false) expect(support.apertureFraction).toBe(0);
          if (support.apertureCarries === true) {
            expect(support.apertureFraction!).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("and what the ratio measures is the SET, which is not the contrast's error", () => {
    // The two numbers a reader could confuse. How well a lattice resolves the
    // carrying set — 0.79, 1.26, 1.11 at 11, 15 and 21 samples — is not how far
    // the contrast it produces is off, which is `secondHarmonicSpread` and is a
    // separate measurement with a separate size. Asserting they differ is the
    // point: if they ever coincided the panel would be free to print one label
    // for both, and it is not.
    const ratios = [11, 15, 21].map((sourceSamples) => {
      const support = secondHarmonicSupport(at({ ...DARK, cycles: 12, sourceSamples }));
      return support.latticeWeight / support.apertureFraction!;
    });
    expect(ratios[0]!).toBeCloseTo(0.7906, 3);
    expect(ratios[1]!).toBeCloseTo(1.2557, 3);
    expect(ratios[2]!).toBeCloseTo(1.1119, 3);

    // What separates the two is the defocus slider, and it separates them
    // without a number in the middle. The carrying set is geometry — no
    // wavefront in it — so both legs are BIT-IDENTICAL between a focused render
    // and a defocused one; the contrast spread is not, because § 6ab.11 measured
    // the beat picking up 4·w₂₀·(s·ν) off axis. Identity against difference is
    // the whole discriminator: a threshold separating 1.35× from 1.59× would be
    // a threshold, in the one step whose finding is that none is needed.
    const focused = renderPhaseScene(at({ ...DARK, cycles: 12, sourceSamples: 15 }));
    const defocused = renderPhaseScene(
      at({ ...DARK, cycles: 12, sourceSamples: 15, defocusWaves: 3 }),
    );
    if (!focused.ok || !defocused.ok) throw new Error("render refused");
    const here = focused.readout.secondHarmonicSupport;
    const there = defocused.readout.secondHarmonicSupport;
    expect(there.apertureFraction).toBe(here.apertureFraction);
    expect(there.latticeWeight).toBe(here.latticeWeight);
    const spreadHere = focused.readout.focused.secondHarmonicSpread!.ratio;
    const spreadThere = defocused.readout.defocused.secondHarmonicSpread!.ratio;
    expect(spreadThere).not.toBe(spreadHere);
  });

  it("and above ν = 0.8 no sampling is offered one, because the RING has none", () => {
    // (1 + 1.4)/3, three slider stops below brightfield's 1 — the part of this a
    // reader has no way to guess, and the reason the gate names the cutoff.
    for (const cycles of [13, 14, 15]) {
      for (const sourceSamples of [7, 11, 15, 21]) {
        const support = secondHarmonicSupport(at({ ...DARK, cycles, sourceSamples }));
        expect(support.apertureCarries).toBe(false);
        expect(support.latticeWeight).toBe(0);
        expect(support.reason).toMatch(/0\.8000/);
      }
    }
    // And at ν = 0.75 it is the other side of that same cutoff.
    expect(secondHarmonicSupport(at({ ...DARK, cycles: 12 })).apertureCarries).toBe(true);
  });

  it("gates the φ = 3 cell that USED to read 6.8e-7 and look like a weak signal", () => {
    // The one place the roundoff floor broke: aliased orders re-entering the pupil
    // (§ 6ab.12). Two things are true here now and they are independent, which is
    // why both are asserted.
    //
    // The gate never knew about the aliasing and never needed to — the cell is
    // zero-support either way, and suppressing the number is why the reader is not
    // shown six significant figures of anything.
    const request = at({
      ...DARK,
      cycles: 13,
      sourceSamples: 21,
      amplitudeRadians: 3,
    });
    expect(secondHarmonicSupport(request).exists).toBe(false);
    const scene = renderPhaseScene(request);
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.focused.secondHarmonicSpread).toBeNull();

    // And the number the gate is suppressing is no longer 6.8e-7 but f64 roundoff,
    // because § 6ab.13 band-limited the object and the orders that were folding
    // into the pupil are simply not in it. This rung asserted `> 1e-9` until then;
    // the assertion is inverted rather than dropped, because "the gate is not the
    // only thing standing between the reader and that number" is the claim the
    // fix actually makes.
    expect(scene.readout.focused.secondHarmonic).toBeLessThan(1e-14);
    // What it costs: nine orders in the darkfield cell, against 4.0e-3 of the
    // light left off a 128-bin grid at 13 cycles and φ = 3.
    expect(scene.readout.truncation.maxOrder).toBe(4);
    expect(scene.readout.truncation.droppedEnergy).toBeLessThan(5e-3);
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

  it("and § 6ab.12's gate does not collide with that — the cell has support", () => {
    // The two guards answer different questions and could have contradicted: the
    // spread drops samplings the frequency grid cannot carry, while the gate asks
    // whether the SHIPPED sampling carries 2ν at all. ν = 0.375 here, well inside
    // brightfield's cutoff, so the reader still gets a reading and a single-entry
    // spread rather than a refusal.
    const support = secondHarmonicSupport(
      at({ size: 128, pupilSamples: 64, sourceSamples: 7, coherenceParameter: 1.1, cycles: 12 }),
    );
    expect(support.exists).toBe(true);
    expect(support.apertureCarries).toBe(true);
  });

  it("and the gate never says 'raise source samples' where raising it is refused", () => {
    // The advice in that message has to be actionable, and at the S ceiling
    // `abbeImage` refuses the finer samplings. Measured over every brightfield
    // cell the panel can reach — 3 pupil samplings × 2 grids × every cycle count ×
    // 8 values of S × all four counts — the aperture-yes/lattice-no branch is
    // reached exactly **zero** times, so the message is darkfield's alone.
    //
    // The reason is structural rather than lucky: `PANEL_SOURCE_SAMPLES` are all
    // odd, so `diskSource` always has a point at the origin, and the origin
    // carries 2ν for every ν < 1 — order −1 and order +1, both inside the pupil.
    // Which is also why the gate's brightfield refusals are all aperture refusals.
    let blind = 0;
    let checked = 0;
    for (const pupilSamples of [16, 32, 64]) {
      for (const size of [128, 256]) {
        for (let cycles = 1; 2 * cycles < size / 2; cycles++) {
          for (const coherenceParameter of [0, 0.25, 0.5, 1, 1.5]) {
            for (const sourceSamples of PANEL_SOURCE_SAMPLES) {
              const support = secondHarmonicSupport(
                at({ size, pupilSamples, cycles, coherenceParameter, sourceSamples }),
              );
              checked++;
              if (support.apertureCarries === true && support.latticeWeight === 0) blind++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
    expect(blind).toBe(0);
    // And the same sweep in darkfield finds plenty — it is the ring that is thin,
    // not the criterion that never fires.
    expect(
      secondHarmonicSupport(
        at({ illumination: "darkfield", coherenceParameter: 0, cycles: 12, sourceSamples: 7 }),
      ).latticeWeight,
    ).toBe(0);
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

describe("§ 6ab.15 — the nine-decimal Bessel readout still needs no spread", () => {
  it("agrees at every sampling that is in the regime, not just at the one-point source", () => {
    // § 6ab.11 justified the nine decimals by there being nothing for the count
    // to move: `threeOrderCheck` required S = 0, which is one source point at
    // every count. § 6ab.15 replaced that condition with the order geometry, and
    // the readout now exists at S > 0 — so the old justification is gone and this
    // is the one that replaces it. **Inside the regime every direction
    // contributes the same term**, since all of them pass exactly orders |m| ≤ 1,
    // so the lattice cannot move the number: measured at 9.7e-15 to 1.4e-14 at
    // ν = 0.75 across all four samplings and every S up to the regime's edge.
    for (const S of [0, 0.1, 0.2, 0.25]) {
      for (const sourceSamples of PANEL_SOURCE_SAMPLES) {
        const scene = renderPhaseScene(at({ coherenceParameter: S, cycles: 12, sourceSamples }));
        if (!scene.ok) throw new Error(scene.error);
        const check = scene.readout.focused.besselCheck;
        expect(check, `S = ${S} at ${sourceSamples} samples`).not.toBeNull();
        expect(check!.residual).toBeLessThan(1e-12);
      }
    }
  });

  it("and where a lattice leaves the regime, the readout is refused rather than moved", () => {
    // The edge is lattice-dependent, because a finer lattice reaches nearer to S:
    // at S = 0.26 the 7-, 11- and 15-point discs are inside and the 21-point one
    // is not; by S = 0.28 only the 7-point one is. Each is refused on its own
    // account — `besselCheck` goes null — so the panel never prints a comparison
    // whose regime the source it actually used has left.
    const inside = [7, 11, 15];
    for (const sourceSamples of PANEL_SOURCE_SAMPLES) {
      const scene = renderPhaseScene(
        at({ coherenceParameter: 0.26, cycles: 12, sourceSamples }),
      );
      if (!scene.ok) throw new Error(scene.error);
      const check = scene.readout.focused.besselCheck;
      if (inside.includes(sourceSamples)) {
        expect(check, `${sourceSamples} samples`).not.toBeNull();
        expect(check!.residual).toBeLessThan(1e-12);
      } else {
        expect(check, `${sourceSamples} samples`).toBeNull();
      }
    }
    // And S = 0.3 is outside it at every count the panel offers.
    for (const sourceSamples of PANEL_SOURCE_SAMPLES) {
      const scene = renderPhaseScene(at({ coherenceParameter: 0.3, cycles: 12, sourceSamples }));
      if (!scene.ok) throw new Error(scene.error);
      expect(scene.readout.focused.besselCheck).toBeNull();
    }
  });

  it("no longer excludes ν = 1, whose exclusion described a defect § 6ab.13 fixed", () => {
    // The rim exclusion cited 2.6e-8 rising to 1.5e-2 at φ = 3. Those were the
    // pointwise object's numbers; the spectrum-built one agrees to 5.5e-14 there.
    for (const amplitudeRadians of [0.4, 1.5, 3]) {
      const scene = renderPhaseScene(
        at({ coherenceParameter: 0, cycles: 16, amplitudeRadians }),
      );
      if (!scene.ok) throw new Error(scene.error);
      const check = scene.readout.focused.besselCheck;
      expect(check, `φ = ${amplitudeRadians}`).not.toBeNull();
      expect(check!.residual / check!.closed).toBeLessThan(1e-12);
    }
  });

  it("refuses the DEFOCUSED frame under an extended source, which the old S = 0 hid", () => {
    // Opening the regime to S > 0 separated two conditions that the one-point
    // source used to satisfy together: the orders being alone, and the pair
    // sharing a pupil phase. Defocus breaks only the second, and only off axis.
    // Without `pairPhaseSurvives` the defocused canvas would print a nine-decimal
    // comparison that is 39% out at S = 0.1 and 98% out at S = 0.2.
    for (const [S, defocusWaves] of [
      [0.1, 1],
      [0.2, 1],
      [0.2, 3],
    ] as [number, number][]) {
      const scene = renderPhaseScene(at({ coherenceParameter: S, cycles: 12, defocusWaves }));
      if (!scene.ok) throw new Error(scene.error);
      // The in-focus frame keeps it — the pupil is real, so there is no phase to
      // split — and the defocused one is refused rather than shown wrong.
      expect(scene.readout.focused.besselCheck, `S = ${S}`).not.toBeNull();
      expect(scene.readout.focused.besselCheck!.residual).toBeLessThan(1e-12);
      expect(scene.readout.defocused.besselCheck, `S = ${S}, w₂₀ = ${defocusWaves}`).toBeNull();
    }
    // On axis the same defocus keeps it, so what is refused is the direction and
    // not the aberration.
    for (const defocusWaves of [1, 3]) {
      const scene = renderPhaseScene(at({ coherenceParameter: 0, cycles: 12, defocusWaves }));
      if (!scene.ok) throw new Error(scene.error);
      expect(scene.readout.defocused.besselCheck, `w₂₀ = ${defocusWaves}`).not.toBeNull();
      expect(scene.readout.defocused.besselCheck!.residual).toBeLessThan(1e-12);
    }
  });

  it("and still refuses ν ≤ 0.5, where order ±2 gets through", () => {
    // Unchanged, and the reason is unchanged: the closed form is not
    // approximately right below the regime, it is wrong by 99%.
    const scene = renderPhaseScene(at({ coherenceParameter: 0, cycles: 8 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.focused.besselCheck).toBeNull();
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
