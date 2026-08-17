import { describe, expect, it } from "vitest";
import {
  DARKFIELD_INNER,
  DARKFIELD_OUTER,
  DEFAULT_DARKFIELD_SPACING,
  PANEL_DARKFIELD_SPACINGS,
  PANEL_SOURCE_SAMPLES,
  darkfieldSource,
  darkfieldStepMultiple,
  frequencyOf,
  harmonicNote,
  harmonicSupportAt,
  highestCarryingCycles,
  optionsThatCarry,
  panelHarmonics,
  renderPhaseScene,
  samplingSpread,
  samplingsThatMatter,
  secondHarmonicSupport,
  sourceFits,
  type PhaseRequest,
} from "../src/phase";
import {
  annularSource,
  apertureCarriesHarmonic,
  diskSource,
  harmonicSupportWeight,
  idealPupil,
  imageHarmonic,
  phaseGratingObject,
} from "@telemicroscope/core/illumination";
import { renderBrightfield, type PatchPupil } from "@telemicroscope/core/imaging";

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
 *     838×, at φ = 3 it is 1.37×. ~~since the 2ν signal grows as φ² and what
 *     disagrees with it does not~~ **§ 6ab.18: the disagreement grows as φ² as
 *     well, and the ratio runs because one lattice reads O(φ⁴) there. The lever
 *     is 9.7× as a fraction of the reading, and it is still a lever.**
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
  darkfieldSpacing: DEFAULT_DARKFIELD_SPACING,
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
    expect(spread.kind).toBe("count");
    expect(spread.readings.map((r) => r.option)).toEqual([...PANEL_SOURCE_SAMPLES]);
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

describe("§ 6ab.19 — darkfield's control is a lattice SPACING, and what that closed", () => {
  const DARK = { illumination: "darkfield", coherenceParameter: 0 } as const;

  it("sets a density, and the ring's direction count follows from it", () => {
    // The quantity a ring can honestly be asked for. A count across the diameter
    // is a property of the square the ring is masked out of — 16 of 49 survive at
    // N = 7 — where a spacing IS the angular density, which is why the same three
    // options hold the same three counts at both pupil samplings the panel
    // offers, and a count would not.
    expect([...PANEL_DARKFIELD_SPACINGS]).toEqual([0.0625, 0.125, 0.25]);
    for (const pupilSamples of [32, 64]) {
      expect(
        PANEL_DARKFIELD_SPACINGS.map((s) => darkfieldSource(pupilSamples, s).points.length),
        `pupilSamples ${pupilSamples}`,
      ).toEqual([608, 160, 36]);
    }
    // The step each spacing derives is a whole number at both — `latticeOffset`'s
    // own precondition, and the licence for § 6p's cache in darkfield.
    expect(PANEL_DARKFIELD_SPACINGS.map((s) => darkfieldStepMultiple(s, 32))).toEqual([1, 2, 4]);
    expect(PANEL_DARKFIELD_SPACINGS.map((s) => darkfieldStepMultiple(s, 64))).toEqual([2, 4, 8]);
    expect(darkfieldSource(32, 0.125).pupilLattice).toEqual({ pupilSamples: 32, stepMultiple: 2 });
  });

  it("no longer reaches the cell where the count-based ring read roundoff", () => {
    // § 6ab.12's headline cell. The rung that used to live here asserted "the
    // panel's own control moves this reading by twelve orders", and that sentence
    // is now false — which is the fix, not a loss. The ring that did it still
    // does, one import away and pinned on an IMAGE by § 6ab.19's own rungs in
    // `lattice-disk.test.ts`; what changed is that the control cannot reach it.
    const orders = { cycles: 12, pupilSamples: 32, harmonic: 2 };
    const counted = annularSource(DARKFIELD_OUTER, DARKFIELD_INNER, 7);
    expect(counted.points.length).toBe(16);
    expect(harmonicSupportWeight(idealPupil(), counted, orders)).toBe(0);
    // Every spacing the control does offer holds the set, so this is a spread of
    // three readings rather than of one reading and two zeros.
    const spread = spreadAt({ ...DARK, cycles: 12 });
    expect(spread.kind).toBe("spacing");
    expect(spread.readings.map((r) => r.option)).toEqual([...PANEL_DARKFIELD_SPACINGS]);
    expect(spread.min).toBeGreaterThan(1e-4);
    expect(spread.ratio).toBeCloseTo(1.4666, 3);
    // Two renders, not three: the shipped spacing is already on screen.
    expect(spread.extraFrames).toBe(2);
    expect(spread.skipped).toEqual([]);
  });

  it("and where a refusal DOES remain, its advice names settings that exist", () => {
    // **The defect that decided the design, and it is not the headline cell** —
    // that one was already honest, since raising the count to 11, 15 or 21 all
    // worked. At grid 256 / pupil samples 64 and 25 cycles the aperture carries 2ν
    // on 1.62% of its directions and ALL FOUR counts held none of it, so the panel
    // printed "raise source samples" at every setting a reader could raise it to.
    // Advice that cannot be taken — the failure APP.md already records fixing once
    // at S = 0, reached here by a different route.
    const cell = { ...DARK, size: 256, pupilSamples: 64, cycles: 25 } as const;
    for (const samples of PANEL_SOURCE_SAMPLES) {
      const ring = annularSource(DARKFIELD_OUTER, DARKFIELD_INNER, samples);
      expect(
        harmonicSupportWeight(idealPupil(), ring, { cycles: 25, pupilSamples: 64, harmonic: 2 }),
        `count ${samples}`,
      ).toBe(0);
    }
    // The coarsest spacing is still blind here, and says so in settings rather
    // than in a direction.
    const coarse = secondHarmonicSupport(at({ ...cell, darkfieldSpacing: 0.25 }));
    expect(coarse.apertureCarries).toBe(true);
    expect(coarse.latticeWeight).toBe(0);
    expect(coarse.exists).toBe(false);
    expect(coarse.apertureFraction).toBeCloseTo(0.016244378891, 9);
    expect(coarse.reason).toMatch(/1\.62% of the aperture/);
    expect(coarse.reason).toMatch(/a finer condenser lattice holds it: spacing 0\.0625 or 0\.125/);
    // And the two it names really do hold it, which is what makes it advice.
    for (const darkfieldSpacing of [0.0625, 0.125]) {
      expect(
        secondHarmonicSupport(at({ ...cell, darkfieldSpacing })).exists,
        `spacing ${darkfieldSpacing}`,
      ).toBe(true);
    }
  });

  it("and § 6ab.14's exact carrying area survives the change of lattice untouched", () => {
    // The area is a property of the annulus and ν with no sampling in it, so the
    // one number this file pins to nine decimals has to be indifferent to a
    // wholesale change in how the ring is sampled. It is, at every spacing — and
    // that is the check that the two legs did not move together by accident.
    for (const darkfieldSpacing of PANEL_DARKFIELD_SPACINGS) {
      const support = secondHarmonicSupport(at({ ...DARK, cycles: 12, darkfieldSpacing }));
      expect(support.apertureFraction, `spacing ${darkfieldSpacing}`).toBeCloseTo(
        0.070267681347553,
        9,
      );
      expect(support.exists).toBe(true);
    }
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
    // carrying set — 0.98, 1.07, 0.79 at spacings 0.0625, 0.125 and 0.25 — is not
    // how far the contrast it produces is off, which is `secondHarmonicSpread` and
    // is a separate measurement with a separate size. Asserting they differ is the
    // point: if they ever coincided the panel would be free to print one label
    // for both, and it is not.
    //
    // The count-based ring read 0.79, 1.26 and 1.11 at 11, 15 and 21 here. Coming
    // down to 0.98/1.07/0.79 is not "better" and is not asserted as such — a
    // fraction of a set is not an error bar on a contrast, which is the sentence
    // this rung exists to keep true.
    const ratios = PANEL_DARKFIELD_SPACINGS.map((darkfieldSpacing) => {
      const support = secondHarmonicSupport(at({ ...DARK, cycles: 12, darkfieldSpacing }));
      return support.latticeWeight / support.apertureFraction!;
    });
    expect(ratios[0]!).toBeCloseTo(0.9831, 3);
    expect(ratios[1]!).toBeCloseTo(1.0673, 3);
    expect(ratios[2]!).toBeCloseTo(0.7906, 3);

    // What separates the two is the defocus slider, and it separates them
    // without a number in the middle. The carrying set is geometry — no
    // wavefront in it — so both legs are BIT-IDENTICAL between a focused render
    // and a defocused one; the contrast spread is not, because § 6ab.11 measured
    // the beat picking up 4·w₂₀·(s·ν) off axis. Identity against difference is
    // the whole discriminator: a threshold separating 1.35× from 1.59× would be
    // a threshold, in the one step whose finding is that none is needed.
    const focused = renderPhaseScene(at({ ...DARK, cycles: 12 }));
    const defocused = renderPhaseScene(at({ ...DARK, cycles: 12, defocusWaves: 3 }));
    if (!focused.ok || !defocused.ok) throw new Error("render refused");
    const here = focused.readout.secondHarmonicSupport;
    const there = defocused.readout.secondHarmonicSupport;
    expect(there.apertureFraction).toBe(here.apertureFraction);
    expect(there.latticeWeight).toBe(here.latticeWeight);
    const spreadHere = focused.readout.focused.secondHarmonicSpread!.ratio;
    const spreadThere = defocused.readout.defocused.secondHarmonicSpread!.ratio;
    expect(spreadThere).not.toBe(spreadHere);
    // How far apart, and why it is not a defect the wiring introduced: at w₂₀ = 3
    // the coarsest spacing's reading passes through zero (1.7e-16 against 1.6e-4
    // and 1.0e-3), so max/min runs to 6e12 while the focused reading is a clean
    // 1.47×. That is § 6ab.18's own caution about this statistic — the ratio
    // diverges when one sampling crosses zero — showing up in the cell it was
    // measured to be about, on a set the geometry above says all three carry.
    expect(spreadHere).toBeCloseTo(1.4666, 3);
    expect(spreadThere).toBeGreaterThan(1e10);
  });

  it("and above ν = 0.8 no sampling is offered one, because the RING has none", () => {
    // (1 + 1.4)/3, three slider stops below brightfield's 1 — the part of this a
    // reader has no way to guess, and the reason the gate names the cutoff.
    for (const cycles of [13, 14, 15]) {
      for (const darkfieldSpacing of PANEL_DARKFIELD_SPACINGS) {
        const support = secondHarmonicSupport(at({ ...DARK, cycles, darkfieldSpacing }));
        expect(support.apertureCarries, `${cycles}/${darkfieldSpacing}`).toBe(false);
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
      darkfieldSpacing: 0.25,
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
    expect(spread.readings.map((r) => r.option)).toEqual([7]);
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
    // And the criterion is not one that never fires — the ring still reaches it,
    // which is what the darkfield sweep below is about.
    expect(
      secondHarmonicSupport(
        at({
          illumination: "darkfield",
          coherenceParameter: 0,
          size: 256,
          pupilSamples: 64,
          cycles: 25,
          darkfieldSpacing: 0.25,
        }),
      ).latticeWeight,
    ).toBe(0);
  });

  it("and darkfield's own refusals name a spacing that works — every one of them", () => {
    // **The rung that says § 6ab.19's wiring closed the item rather than moving
    // it.** Replacing the control is only a fix if no cell survives where the
    // panel refuses and none of its remaining settings helps. So: every darkfield
    // cell the panel can reach — 2 pupil samplings × 2 grids × every cycle count ×
    // all three spacings — and wherever the actionable branch fires, some offered
    // spacing must actually hold the set.
    //
    // The count-based control failed exactly this at 256/64 and 25 cycles, which
    // is the measurement the design was chosen on rather than an afterthought.
    let actionable = 0;
    let unreachable = 0;
    let checked = 0;
    for (const pupilSamples of [32, 64]) {
      for (const size of [128, 256]) {
        for (let cycles = 1; 2 * cycles < size / 2; cycles++) {
          for (const darkfieldSpacing of PANEL_DARKFIELD_SPACINGS) {
            const request = at({
              illumination: "darkfield",
              coherenceParameter: 0,
              size,
              pupilSamples,
              cycles,
              darkfieldSpacing,
            });
            // Cells the frequency grid cannot hold the ring in are not reachable
            // — the panel shows brightfield there and says why.
            if (!sourceFits(darkfieldSource(pupilSamples, darkfieldSpacing), size, pupilSamples)) {
              continue;
            }
            checked++;
            const support = secondHarmonicSupport(request);
            if (!(support.apertureCarries === true && support.latticeWeight === 0)) continue;
            actionable++;
            if (optionsThatCarry(request, 2).length === 0) unreachable++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // The branch fires — otherwise this rung would pass by never being asked.
    expect(actionable).toBeGreaterThan(0);
    // And never with advice a reader cannot take.
    expect(unreachable).toBe(0);
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

describe("§ 6ab.15 — the panel reads every harmonic the grid can hold", () => {
  it("stops at the grid and not at 2, which is where it used to stop", () => {
    // The old panel showed h = 1 and h = 2 because those were the two the physics
    // had been written for. The grid's own limit is h·cycles < size/2, so at the
    // default 128 grid and 12 cycles there was room for five all along.
    expect(panelHarmonics(at({ cycles: 12, size: 128 }))).toEqual([1, 2, 3, 4, 5]);
    expect(panelHarmonics(at({ cycles: 20, size: 128 }))).toEqual([1, 2, 3]);
    // And a bin past Nyquist is never offered — an aliased reading presented as a
    // harmonic would invent the thing the panel claims to measure.
    for (const cycles of [7, 12, 20, 31]) {
      for (const h of panelHarmonics(at({ cycles }))) {
        expect(h * cycles).toBeLessThan(128 / 2);
      }
    }
  });

  it("reads the parity law straight down the column", () => {
    // ν = 0.375: roundoff, 0.149, roundoff, 0.109, roundoff. The odd ones are null
    // and the even ones are not, in one image, which is the whole point of the
    // column existing.
    const scene = renderPhaseScene(at({ coherenceParameter: 0, cycles: 6, amplitudeRadians: 1.5 }));
    if (!scene.ok) throw new Error(scene.error);
    const readings = scene.readout.focused.harmonics;
    // Ten of them at 6 cycles on a 128 grid — the list is bounded by the grid, and
    // the ones past h = 4 have no order pair to make them, which the gate says.
    expect(readings.map((r) => r.harmonic)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const supported = (h: number) =>
      scene.readout.harmonics.find((r) => r.harmonic === h)!.support.exists;
    let evensSeen = 0;
    for (const reading of readings) {
      if (reading.harmonic % 2 === 1) {
        // Odd is null whether or not anything carries it — that is the law.
        expect(Math.abs(reading.contrast), `h = ${reading.harmonic}`).toBeLessThan(1e-13);
      } else if (supported(reading.harmonic)) {
        expect(reading.contrast, `h = ${reading.harmonic}`).toBeGreaterThan(1e-3);
        evensSeen++;
      } else {
        // Even but unsupported reads roundoff too, for the other reason.
        expect(Math.abs(reading.contrast), `h = ${reading.harmonic}`).toBeLessThan(1e-13);
      }
    }
    expect(evensSeen).toBe(2);
    // h = 1 and h = 2 are the list's own members, not a second computation.
    expect(readings[0]!.contrast).toBe(scene.readout.focused.contrast);
    expect(readings[1]!.contrast).toBe(scene.readout.focused.secondHarmonic);
  });

  it("tells the two kinds of zero apart, and defocus is what separates them", () => {
    // h = 3 is null because it is odd; h = 5 is null because no order pair 5 apart
    // is inside the pupil from the one direction a coherent source has. Identical
    // on screen in focus.
    const focused = renderPhaseScene(at({ coherenceParameter: 0, cycles: 6 }));
    if (!focused.ok) throw new Error(focused.error);
    const support = (h: number) => focused.readout.harmonics.find((r) => r.harmonic === h)!.support;
    expect(support(3).exists).toBe(true);
    expect(support(5).exists).toBe(false);

    // One wave of defocus, and only the parity null lifts.
    const defocused = renderPhaseScene(
      at({ coherenceParameter: 0, cycles: 6, defocusWaves: 1, amplitudeRadians: 1.5 }),
    );
    if (!defocused.ok) throw new Error(defocused.error);
    const reading = (h: number) =>
      defocused.readout.defocused.harmonics.find((r) => r.harmonic === h)!.contrast;
    expect(Math.abs(reading(3))).toBeGreaterThan(0.1);
    expect(Math.abs(reading(5))).toBeLessThan(1e-13);
  });

  it("costs the same renders it did when it read one bin", () => {
    // The probe renders three frames per defocus and every harmonic is read off
    // each of them. Five harmonics are five passes over an image already in hand,
    // not five probes — so this count is the one § 6ab.11 pinned, unchanged.
    const scene = renderPhaseScene(at({ coherenceParameter: 0.5, cycles: 12 }));
    if (!scene.ok) throw new Error(scene.error);
    expect(scene.readout.focused.harmonics).toHaveLength(5);
    expect(scene.readout.checkFrames).toBe(3);
  });

  it("gives the closed form only to even harmonics, and only where its regime holds", () => {
    const scene = renderPhaseScene(at({ coherenceParameter: 0, cycles: 6, amplitudeRadians: 1.5 }));
    if (!scene.ok) throw new Error(scene.error);
    for (const reading of scene.readout.focused.harmonics) {
      if (reading.harmonic % 2 === 1) {
        // No symmetric pair, and J_{h/2} has no half-integer order to evaluate.
        expect(reading.closedForm, `h = ${reading.harmonic}`).toBeNull();
      }
    }
    // At ν = 0.375 the only pair 4 apart is (−2, +2), so h = 4 gets it and h = 2
    // does not: ±2 is through, so the 2ν beat has more than one pair behind it.
    const four = scene.readout.focused.harmonics.find((r) => r.harmonic === 4)!;
    expect(four.closedForm).not.toBeNull();
    expect(four.closedForm!.residual).toBeLessThan(1e-12);
    expect(scene.readout.focused.harmonics.find((r) => r.harmonic === 2)!.closedForm).toBeNull();
  });

  it("names a slider position rather than a cutoff formula that does not generalize", () => {
    // `highestCarryingCycles` is exhaustive over the cycles control, and it has to
    // be: the h = 2 closed forms this panel quotes are 2/h for the disc and
    // (1 + outer)/(h + 1) for the ring, and BOTH fail at an h the panel can reach
    // — the disc's is 1 + S at h = 1 and 0.6 rather than 2/3 at h = 3 with
    // S = 0.2; the ring's is 1/3 rather than 0.343 at h = 6.
    for (const harmonic of [2, 3, 4, 5]) {
      for (const request of [
        at({ illumination: "darkfield", coherenceParameter: 0 }),
        at({ coherenceParameter: 0.5 }),
      ]) {
        const best = highestCarryingCycles(request, harmonic);
        const inner = request.illumination === "darkfield" ? 1.1 : 0;
        const outer = request.illumination === "darkfield" ? 1.4 : request.coherenceParameter;
        if (best === null) continue;
        // It carries there...
        expect(
          apertureCarriesHarmonic(inner, outer, frequencyOf(best, request.pupilSamples), harmonic),
        ).toBe(true);
        // ...and at no coarser setting the panel offers.
        const maxCycles = Math.max(1, Math.min(request.pupilSamples, Math.floor(request.size / 4) - 1));
        for (let cycles = best + 1; cycles <= maxCycles; cycles++) {
          expect(
            apertureCarriesHarmonic(inner, outer, frequencyOf(cycles, request.pupilSamples), harmonic),
            `h = ${harmonic}, ${cycles} cycles`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps the h = 2 gate the shipped rungs are pinned to", () => {
    // `harmonicSupportAt(request, 2)` IS `secondHarmonicSupport`, and the readout's
    // row is the same object rather than a second computation that could drift.
    for (const S of [0, 0.5, 1.5]) {
      const request = at({ coherenceParameter: S, cycles: 12 });
      expect(harmonicSupportAt(request, 2)).toEqual(secondHarmonicSupport(request));
      const scene = renderPhaseScene(request);
      if (!scene.ok) throw new Error(scene.error);
      expect(scene.readout.harmonics.find((r) => r.harmonic === 2)!.support).toBe(
        scene.readout.secondHarmonicSupport,
      );
    }
  });
});

describe("§ 6ab.15 — the row's sentence has to agree with the row's number", () => {
  /**
   * This rung exists because the harmonic table shipped a label that argued with
   * the reading beside it: "null by parity" printed next to the DEFOCUSED frame's
   * h = 1 value of 0.583, which is that null broken and the whole content of the
   * canvas above. Every rung passed — the readings were right and only the
   * sentence was wrong — and it was found by opening the panel.
   *
   * `harmonicNote` is that sentence as a value, so it can be asserted here.
   */
  const noteFor = (scene: ReturnType<typeof renderPhaseScene>, h: number, defocused: boolean) => {
    if (!scene.ok) throw new Error(scene.error);
    const frame = defocused ? scene.readout.defocused : scene.readout.focused;
    const reading = frame.harmonics.find((r) => r.harmonic === h)!;
    const support = scene.readout.harmonics.find((r) => r.harmonic === h)!.support;
    return { note: harmonicNote(reading, support, frame.defocusWaves), reading };
  };

  it("calls an odd harmonic a parity null only while it IS one", () => {
    const scene = renderPhaseScene(
      at({ coherenceParameter: 0, cycles: 6, amplitudeRadians: 1.5, defocusWaves: 1 }),
    );
    // In focus the pupil is real and h = 1 and h = 3 are nulls.
    for (const h of [1, 3]) {
      const { note, reading } = noteFor(scene, h, false);
      expect(note.kind, `h = ${h} in focus`).toBe("parity-null");
      expect(Math.abs(reading.contrast)).toBeLessThan(1e-13);
    }
    // Defocused it is not, and the row has to say so.
    for (const h of [1, 3]) {
      const { note, reading } = noteFor(scene, h, true);
      expect(note.kind, `h = ${h} defocused`).toBe("parity-lifted");
      expect(Math.abs(reading.contrast)).toBeGreaterThan(1e-3);
    }
  });

  it("never calls a reading a null when the number is not one, at any defocus", () => {
    // The general form of the same defect, swept over the slider rather than
    // asserted at one setting — a "null" label is only ever allowed to sit beside
    // a number below the ceiling.
    for (const defocusWaves of [0, 0.25, 1, 3]) {
      for (const cycles of [6, 12]) {
        for (const coherenceParameter of [0, 0.5]) {
          const scene = renderPhaseScene(
            at({ cycles, coherenceParameter, defocusWaves, amplitudeRadians: 1.5 }),
          );
          if (!scene.ok) continue;
          for (const frame of [scene.readout.focused, scene.readout.defocused]) {
            for (const reading of frame.harmonics) {
              const support = scene.readout.harmonics.find(
                (r) => r.harmonic === reading.harmonic,
              )!.support;
              const note = harmonicNote(reading, support, frame.defocusWaves);
              const where = `h = ${reading.harmonic}, ${cycles} cycles, S = ${coherenceParameter}, w₂₀ = ${frame.defocusWaves}`;
              if (note.kind === "parity-null") {
                expect(Math.abs(reading.contrast), where).toBeLessThan(1e-13);
              }
              if (note.kind === "parity-lifted") {
                expect(Math.abs(reading.contrast), where).toBeGreaterThanOrEqual(1e-13);
              }
              // And a closed form is only ever offered for an even harmonic.
              if (note.kind === "closed-form") {
                expect(reading.harmonic % 2, where).toBe(0);
              }
            }
          }
        }
      }
    }
  });

  it("prefers the gate's own words where nothing carries the harmonic", () => {
    // ν = 0.75 puts 3ν past the incoherent cutoff, so h = 3 has no support and the
    // row says so rather than reaching for parity — both are true there, and the
    // one that explains the absence is the gate.
    const scene = renderPhaseScene(at({ coherenceParameter: 0, cycles: 12 }));
    const { note } = noteFor(scene, 3, false);
    expect(note.kind).toBe("unsupported");
    if (note.kind === "unsupported") expect(note.reason).toMatch(/no 3ν/);
  });
});

/**
 * § 6ab.16 — the other half of § 6ab.15's open item: "even harmonics past 2 get
 * one free off the probe frames, but no rung asks whether the sampling moves them
 * the way § 6ab.11 measured the 2ν reading moving (1.06× to 9.75×)."
 *
 * **It moves them harder, and the panel's own warning was calibrated on the row
 * least in need of it.** At S = 0.7 and ν = 0.375 the 2ν reading spreads 1.15×
 * across the four samplings while the 4ν reading in the same images spreads
 * 9.67×; at S = 0.9 the pair is 1.64× against 20.3×; and at S = 0.7, ν = 0.3125
 * the worst row in the column is h = 6 at 46.9×. A reader who has learned from
 * § 6ab.11 to treat the 2ν spread as *the* convergence signal would be reading a
 * number one row down that is twenty times less certain than the one above it.
 *
 * **The higher rows are worse as a FRACTION of their own reading too**, so this
 * is not the printed ratio's sensitivity to a small denominator: at S = 0.7 and
 * ν = 0.375 the four readings span 0.19 of their mean at h = 2 and 1.09 at h = 4,
 * and the ordering holds in four more cells. (§ 6ab.11's explanation of the φ
 * lever — signal grows as φ², disagreement does not — is wrong, and § 6ab.18
 * measures it; nothing in this block rests on it.) It is a tendency and not a
 * law, and the cell where it inverts is recorded below.
 */
describe("§ 6ab.16 — sampling moves the higher harmonics harder than it moves 2ν", () => {
  /** Every even harmonic's spread in one image, keyed by h. */
  function column(over: Partial<PhaseRequest>) {
    const scene = renderPhaseScene(at({ amplitudeRadians: 1.5, ...over }));
    if (!scene.ok) throw new Error(scene.error);
    const rows = new Map<number, { contrast: number; ratio: number | null; supported: boolean }>();
    for (const reading of scene.readout.focused.harmonics) {
      const support = scene.readout.harmonics.find((r) => r.harmonic === reading.harmonic)!.support;
      rows.set(reading.harmonic, {
        contrast: reading.contrast,
        ratio: reading.spread?.ratio ?? null,
        supported: support.exists,
      });
    }
    return rows;
  }

  it("reads 1.15× at h = 2 and 9.67× at h = 4 in the same three renders", () => {
    const rows = column({ coherenceParameter: 0.7, cycles: 6 });
    const two = rows.get(2)!;
    const four = rows.get(4)!;
    // Both supported, both real readings — this is not one of them being absent.
    expect(two.supported && four.supported).toBe(true);
    expect(two.ratio!).toBeLessThan(1.2);
    expect(four.ratio!).toBeGreaterThan(9);
    // And the smaller reading is the less certain one: 2.36e-1 against 4.24e-3.
    expect(four.contrast).toBeLessThan(two.contrast / 50);
  });

  it("reaches 20× at h = 4 and 47× at h = 6, where 2ν never leaves 1.75×", () => {
    // The panel's whole S range at three ν, so the claim is about the control's
    // reachable settings rather than about one cell.
    let worstTwo = 1;
    let worstHigher = 1;
    for (const coherenceParameter of [0.3, 0.5, 0.7, 0.9]) {
      for (const cycles of [4, 5, 6]) {
        const rows = column({ coherenceParameter, cycles });
        worstTwo = Math.max(worstTwo, rows.get(2)!.ratio!);
        for (const h of [4, 6]) {
          const row = rows.get(h)!;
          if (row.ratio !== null) worstHigher = Math.max(worstHigher, row.ratio);
        }
      }
    }
    // Measured: 1.746 at h = 2 (S = 0.9, ν = 0.3125) against 46.881 at h = 6
    // (S = 0.7, ν = 0.3125) — a factor of 27 between the worst row the panel
    // warns about and the worst row it prints.
    expect(worstTwo).toBeLessThan(2);
    expect(worstHigher).toBeGreaterThan(40);
  });

  it("is a tendency and not a law, and the cell where it inverts is this one", () => {
    // S = 0.3, ν = 0.375: h = 2 spreads 1.148× and h = 4 spreads 1.145×, the one
    // cell of the twelve above where the higher harmonic is the tighter one — and
    // its reading is only 2.1× smaller rather than 50×. Recorded rather than
    // rounded away, because "higher h is always worse" is the rule a reader would
    // otherwise take from the rungs above and it is not true.
    const rows = column({ coherenceParameter: 0.3, cycles: 6 });
    expect(rows.get(4)!.ratio!).toBeLessThan(rows.get(2)!.ratio!);
    expect(rows.get(2)!.contrast / rows.get(4)!.contrast).toBeLessThan(3);
  });

  it("still refuses a spread where nothing carries the harmonic, and needs to more often", () => {
    // The cutoffs fall as 2/h, so a column reaching h = 10 has most of its rows
    // outside support at any ν the slider is likely to be at: at ν = 0.375 only
    // h ≤ 4 carry, and the panel returns no spread for the rest.
    const rows = column({ coherenceParameter: 0.7, cycles: 6 });
    expect(rows.get(6)!.supported).toBe(false);
    expect(rows.get(6)!.ratio).toBeNull();
    expect(Math.abs(rows.get(6)!.contrast)).toBeLessThan(1e-13);

    // And the refusal is load-bearing in exactly § 6ab.11's way. Rendering the
    // four samplings by hand — which is what the panel would print if the gate
    // were not there — puts the h = 6 readings inside **1.146×**, TIGHTER than the
    // h = 2 row's own 1.147× in the same images, while every one of them is
    // roundoff. The tightest number in the column would again be the one reading
    // nothing, now reached by moving h rather than ν.
    const readings = PANEL_SOURCE_SAMPLES.map((samples) => {
      const object = phaseGratingObject({ size: 128, cycles: 6, amplitudeRadians: 1.5 });
      const out = renderBrightfield(
        object,
        (): PatchPupil => ({ pupil: idealPupil() }),
        diskSource(0.7, samples),
        { pupilSamples: 32, patches: 1 },
      );
      return imageHarmonic(out.intensity, 128, 6 * 6).contrast;
    });
    for (const value of readings) expect(Math.abs(value)).toBeLessThan(1e-13);
    const ratio = Math.max(...readings) / Math.min(...readings);
    expect(ratio).toBeLessThan(1.2);
    expect(ratio).toBeLessThan(rows.get(2)!.ratio!);
  });
});

/**
 * § 6ab.18 — the last of § 6ab.11's open items: "does rim weight predict the
 * spread?" No, and neither does anything else render-free that was tried. What
 * the search did find is that § 6ab.11's own *explanation* of the φ lever is
 * wrong, in a way that matters more than the predictor would have.
 *
 * ## The disagreement grows as φ², exactly like the signal
 *
 * § 6ab.11 wrote: "the 2ν signal grows as φ² and what disagrees with it does
 * not, so the ratio is a signal-to-noise statement." Measured at its own cell —
 * S = 1.5, ν = 0.75 — over φ = 0.1, 0.2, 0.4:
 *
 *     max − min:  3.319e-4   1.310e-3   4.969e-3     (×3.95, ×3.79 — φ²)
 *     mean:       1.079e-4   4.313e-4   1.720e-3     (×4.00, ×3.99 — φ²)
 *
 * Both are second order. The disagreement measured **as a fraction of the
 * reading** is 3.075, 3.038, 2.890 — flat to 6% where the printed ratio runs
 * 838×, 208×, 50×.
 *
 * ## What the ratio is reading at small φ is ONE lattice at a different ORDER
 *
 * At that cell the 7-point lattice's second-order 2ν term nearly cancels, so its
 * reading is O(φ⁴) while the other three are O(φ²): contrast/φ² is flat at
 * 3.3e-2, 6.5e-3 and 3.4e-3 for n = 11, 15 and 21, and runs 4.0e-5 → 1.6e-4 →
 * 6.3e-4 for n = 7. A max over φ² divided by a min over φ⁴ is O(φ^{-2}), which is
 * exactly the 838 → 208 → 50 the panel prints.
 *
 * **So the φ lever is 9.7×, not 838×** — the relative disagreement runs 3.075 at
 * φ = 0.1 to 0.317 at φ = 3 — and the rest of that number is the ratio's own
 * sensitivity to a minimum passing near zero. § 6ab.11's *conclusion* survives
 * and is re-derived here on the corrected numbers, with a second leg it did not
 * have: at one S the relative disagreement moves 22× as ν moves, so a band in S
 * is refuted without leaning on φ at all.
 *
 * ## Both render-free predictors are refuted, and by the same structural fact
 *
 * A predictor built on the CARRYING SET answers "which directions can contribute
 * to this beat". The disagreement is an integral over that set with an integrand
 * that varies across it. So a set-membership statistic can be identical for two
 * lattices that then disagree by 200% — and it is:
 *
 *  - § 6ab.10's proposed rim weight — source weight within one lattice spacing of
 *    the tangency circle |s ± mν| = 1 — is **exactly zero in 13 of 50 cells where
 *    the relative disagreement runs up to 0.73**, and where it is positive the
 *    ratio between the two spans 143×;
 *  - the cheaper candidate already in the repo, the spread of
 *    `harmonicSupportWeight` across the same four samplings, is roundoff in most
 *    of the same cells while the readings differ by up to 2.7× of their mean.
 *
 * § 6ab.11's exhaustive four-render probe therefore stands, and this is why.
 */
describe("§ 6ab.18 — the φ lever's reason, and two predictors that do not", () => {
  const SAMPLINGS = [7, 11, 15, 21];

  /** The four readings at h·ν, one render each — the panel's own probe, unrolled
   *  so that a cell with no support can still be measured rather than refused. */
  function readings(S: number, cycles: number, phi: number, harmonic: number): number[] {
    return SAMPLINGS.map((samples) => {
      const object = phaseGratingObject({ size: 128, cycles, amplitudeRadians: phi });
      const out = renderBrightfield(
        object,
        (): PatchPupil => ({ pupil: idealPupil() }),
        diskSource(S, samples),
        { pupilSamples: 32, patches: 1 },
      );
      return imageHarmonic(out.intensity, 128, harmonic * cycles).contrast;
    });
  }

  /** Disagreement as a fraction of the reading — the quantity the ratio is a
   *  proxy for, and the one that turns out to be φ-free in the weak limit. */
  function relativeGap(values: number[]): number {
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    return (Math.max(...values) - Math.min(...values)) / Math.abs(mean);
  }

  it("has the disagreement growing as φ², which § 6ab.11 said it did not", () => {
    // § 6ab.11's own cell. Both the gap and the mean are second order, so the
    // FRACTION is flat where the printed ratio moves by a factor of 17.
    const gaps: number[] = [];
    const rels: number[] = [];
    for (const phi of [0.1, 0.2, 0.4]) {
      const v = readings(1.5, 12, phi, 2);
      gaps.push(Math.max(...v) - Math.min(...v));
      rels.push(relativeGap(v));
    }
    // ×3.95 and ×3.79 against φ²'s 4.
    expect(gaps[1]! / gaps[0]!).toBeGreaterThan(3.5);
    expect(gaps[1]! / gaps[0]!).toBeLessThan(4.5);
    expect(gaps[2]! / gaps[1]!).toBeGreaterThan(3.5);
    expect(gaps[2]! / gaps[1]!).toBeLessThan(4.5);
    // 3.075, 3.038, 2.890 — within 7% of each other across a 16× in signal.
    expect(Math.max(...rels) / Math.min(...rels)).toBeLessThan(1.1);
  });

  it("and the 838× is one lattice reading a different POWER of φ", () => {
    // n = 11, 15 and 21 are O(φ²) — contrast/φ² is flat. n = 7 is O(φ⁴), because
    // its second-order term at this cell nearly cancels. max/min is then
    // O(φ^{-2}), which is the whole shape of 838 → 208 → 50.
    const scaled = [0.1, 0.2, 0.4].map((phi) => readings(1.5, 12, phi, 2).map((c) => c / phi ** 2));
    for (const i of [1, 2, 3]) {
      const column = scaled.map((row) => row[i]!);
      expect(Math.max(...column) / Math.min(...column), `n = ${SAMPLINGS[i]}`).toBeLessThan(1.2);
    }
    const seven = scaled.map((row) => row[0]!);
    // 4.0e-5 → 1.6e-4 → 6.3e-4: ×4 per doubling of φ, on top of the φ² already
    // divided out.
    expect(seven[1]! / seven[0]!).toBeGreaterThan(3.5);
    expect(seven[2]! / seven[1]!).toBeGreaterThan(3.5);
  });

  it("leaves the φ lever real at 9.7×, and the conclusion standing on a second leg", () => {
    // Corrected: 3.075 at φ = 0.1 against 0.317 at φ = 3 — a factor of 9.7 at one
    // S, which still refutes a band in S. And the ν leg is independent of φ
    // entirely: at S = 0.3 the relative disagreement runs 0.0336 at ν = 0.3125 to
    // 0.729 at ν = 0.1875, a factor of 22 inside one S.
    const weak = relativeGap(readings(1.5, 12, 0.1, 2));
    const strong = relativeGap(readings(1.5, 12, 3, 2));
    expect(weak / strong).toBeGreaterThan(5);
    expect(weak / strong).toBeLessThan(20);

    const acrossNu = [3, 4, 5, 6, 7].map((cycles) => relativeGap(readings(0.3, cycles, 0.4, 2)));
    expect(Math.max(...acrossNu) / Math.min(...acrossNu)).toBeGreaterThan(10);
  });

  it("confirms § 6ab.16's h ordering on the φ-free quantity, inversion and all", () => {
    // § 6ab.16 measured the printed RATIO. Since the ratio has just been shown to
    // move for a reason that is not disagreement, its h claim is re-measured here
    // as a fraction of the reading, where it survives: five cells with h = 4 the
    // worse row, and the same S = 0.3, ν = 0.375 cell inverting.
    const cells: [number, number][] = [
      [0.3, 5],
      [0.5, 6],
      [0.7, 4],
      [0.7, 6],
      [0.9, 6],
    ];
    for (const [S, cycles] of cells) {
      const two = relativeGap(readings(S, cycles, 0.4, 2));
      const four = relativeGap(readings(S, cycles, 0.4, 4));
      expect(four, `S = ${S}, ${cycles} cycles`).toBeGreaterThan(two);
    }
    // 0.622 at h = 2 against 0.142 at h = 4 — the recorded inversion, and it is
    // the same cell § 6ab.16 found it in through the ratio.
    expect(relativeGap(readings(0.3, 6, 0.4, 4))).toBeLessThan(
      relativeGap(readings(0.3, 6, 0.4, 2)),
    );
  });

  it("REFUTES the rim-weight predictor with a cell where it is exactly zero", () => {
    // § 6ab.10's candidate: source weight within one lattice spacing of the
    // tangency circle |s ± mν| = 1, where the shifted pupil grazes the objective's
    // and the lattice's in-or-out decision moves an order. At S = 0.3, ν = 0.1875
    // NO sample of any of the four lattices is within a spacing of that circle —
    // the predictor is 0, meaning "nothing here can disagree" — and the four
    // readings disagree by 0.73 of their own mean.
    const S = 0.3;
    const cycles = 3;
    const nu = (2 * cycles) / 32;
    for (const samples of SAMPLINGS) {
      const spacing = (2 * S) / samples;
      let weight = 0;
      for (const p of diskSource(S, samples).points) {
        for (const sign of [1, -1]) {
          if (Math.abs(Math.hypot(p.sx + sign * nu, p.sy) - 1) <= spacing) {
            weight += p.weight;
            break;
          }
        }
      }
      expect(weight, `${samples} samples`).toBe(0);
    }
    expect(relativeGap(readings(S, cycles, 0.4, 2))).toBeGreaterThan(0.5);
  });

  it("REFUTES the cheaper one too — the carrying set can be unanimous and the reading not", () => {
    // Every one of the four lattices says the whole aperture carries 2ν here, to
    // f64: the set-membership statistic is 1 four times over and its spread is
    // roundoff. The readings still differ by more than half their mean. Which
    // directions CAN contribute is not how much they DO.
    const orders = { cycles: 3, pupilSamples: 32, harmonic: 2 };
    const weights = SAMPLINGS.map((samples) =>
      harmonicSupportWeight(idealPupil(), diskSource(0.3, samples), orders),
    );
    for (const w of weights) expect(w).toBeCloseTo(1, 12);
    expect(Math.max(...weights) - Math.min(...weights)).toBeLessThan(1e-12);
    expect(relativeGap(readings(0.3, 3, 0.4, 2))).toBeGreaterThan(0.5);
  });
});
