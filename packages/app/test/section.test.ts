import { describe, it, expect } from "vitest";
import { brightfieldSpectralStack } from "@telemicroscope/core/imaging";
import { entryOf } from "../src/microscope";
import { buildMicroscope } from "../src/builder";
import {
  chromaticSpread,
  lampSamples,
  maxCoherenceParameter,
  renderSection,
  sourceOf,
  tintedImage,
  type SectionRequest,
} from "../src/section";
import { SPECIMENS, specimenOf } from "../src/specimens";

/**
 * A9 — the section in colour, as invariants rather than as prose.
 *
 * **No engine capability was added for this panel, so no validation-ladder rung
 * was**: every number below is § 6r's, called from the app. What is pinned here
 * is the *wiring*, plus the three claims the panel makes that no rung states.
 *
 * The first is the negative control's status. § 6r.5 pins that tinting a
 * monochrome image gives the stain and the field the same hue; what the panel
 * adds is that the two numbers appear **side by side**, so the rung below checks
 * that the control really is zero rather than merely small — it is a proof, and
 * a proof that reads 1e-3 is a bug in the wiring.
 *
 * The second is that a specimen with **no colour in it** still images in colour.
 * § 6r.6 pins lateral colour as exactly zero on axis and linear in field, and
 * § 6r's third finding is the objective's own axial colour; a ruled grid puts
 * both on screen at once, and nothing in the ladder measures what a *neutral*
 * specimen's frame does, because no rung had a neutral specimen with structure
 * in it.
 *
 * The third is the guard. § 6r.7 says the blue plane is worst-resolved by 2.56×
 * and rules `no-honest-image` at 32 bins on the DIN 4× while 550 and 650 pass —
 * so a panel offering a wavelength count must surface WHICH plane refused. The
 * rung reads the verdict's wavelength, not just its value.
 */

const BASE: SectionRequest = {
  spec: entryOf("din-4x-010").spec,
  specimen: "section",
  pupilSamples: 32,
  size: 64,
  wavelengths: 3,
  coherenceParameter: 0.5,
  lamp: "equal-energy",
};

const ok = (request: SectionRequest) => {
  const result = renderSection(request);
  if (!result.ok) throw new Error(`renderSection refused: ${result.error}`);
  return result.readout;
};

/**
 * A stack built straight from core, for the one claim that is about the tint
 * itself rather than about the readout.
 *
 * Deliberately not the adapter's own stack — `renderSection` does not expose it,
 * and it should not: the claim below is structural (a scalar field times one XYZ
 * has that XYZ's chromaticity everywhere) and holds for **any** stack, so a test
 * that had to reach inside the adapter to state it would be testing the wiring
 * instead of the construction.
 */
const stackFor = (request: SectionRequest) =>
  brightfieldSpectralStack(
    buildMicroscope(request.spec).system,
    specimenOf(request.specimen).specimen,
    sourceOf(request.coherenceParameter, request.pupilSamples),
    {
      size: request.size,
      pupilSamples: request.pupilSamples,
      samples: lampSamples(request.lamp, request.wavelengths),
      patches: 1,
    },
  );

const distanceTo = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("A9.1 — the tinted control is zero, and the spectral path is not", () => {
  it("a stained section spreads in hue where the tint cannot", () => {
    const readout = ok(BASE);
    // Zero by construction: every pixel of the tinted image is a scalar times
    // one XYZ, so its chromaticity cannot vary. f64 rounding in the divide is
    // the only reason this is not exactly 0.
    expect(readout.tintedSpread).toBeLessThan(1e-12);
    // And the honest path's is a measurement, on the same stack.
    expect(readout.spectralSpread).toBeGreaterThan(0.02);
  });

  it("the tint's mean spread is zero too, so the control is zero in both currencies", () => {
    const readout = ok(BASE);
    expect(readout.tintedMeanSpread).toBeLessThan(1e-12);
    expect(readout.spectralMeanSpread).toBeGreaterThan(1e-3);
  });

  it("the two synthetic dyes cast the whole frame off the lamp's white", () => {
    const readout = ok(BASE);
    // The section fills the frame, so its mean is not the lamp's — which is the
    // difference between a stain and a fleck: a fleck moves the spread only.
    expect(readout.meanFromLamp).toBeGreaterThan(0.01);
  });

  it("the tint's own mean IS the lamp's white, however stained the specimen", () => {
    // The other half of the control, and the reason it can never show a stain:
    // the tinted image is the lamp's colour at every pixel, so its frame mean
    // sits on the lamp's white no matter what the specimen absorbed. Measured
    // off `tintedImage` directly rather than inferred from the spread.
    const readout = ok(BASE);
    expect(readout.meanFromLamp).toBeGreaterThan(0.01);
    const tint = tintedImage(stackFor(BASE));
    const spread = chromaticSpread(tint);
    expect(distanceTo(spread.mean, readout.lampChromaticity)).toBeLessThan(1e-12);
  });
});

describe("A9.2 — a specimen with no colour still images in colour", () => {
  it("the ruled grid spreads in hue, and its mean stays on the lamp's white", () => {
    const readout = ok({ ...BASE, specimen: "ruled" });
    // `neutralSpecimen` — no λ anywhere in the object. Whatever hue varies across
    // the frame is the objective's dispersion, not the specimen's.
    expect(specimenOf("ruled").neutral).toBe(true);
    expect(readout.spectralSpread).toBeGreaterThan(0);
    // A neutral absorber removes no colour on average, so the frame's mean is
    // still the lamp's — the colour is at the edges and sums away.
    expect(readout.meanFromLamp).toBeLessThan(readout.spectralSpread);
    // eslint-disable-next-line no-console
    console.log(
      `ruled: spread ${readout.spectralSpread.toExponential(3)}, ` +
        `mean off lamp ${readout.meanFromLamp.toExponential(3)}`,
    );
  });

  /**
   * **This test was written the other way round and the engine corrected it.**
   *
   * The scoped expectation was that a stained section spreads further in hue
   * than a specimen with no colour in it. On the worst *pixel* it does not: the
   * ruled grid reads 0.2227 against the section's 0.1556, because axial colour
   * is concentrated at an edge and a 1.5 µm ruling on a 20 µm pitch is nothing
   * but edges, while a dye tints a whole cell mildly.
   *
   * What separates them is *where* the colour is, which is why `meanSpread`
   * exists — and the discriminator that survives is the frame's **mean
   * chromaticity**: a stain moves it off the lamp's white and a neutral
   * specimen cannot, whatever its edges do.
   */
  it("the neutral grid wins on the worst pixel, and the stain wins over the frame", () => {
    const ruled = ok({ ...BASE, specimen: "ruled" });
    const section = ok(BASE);
    expect(ruled.spectralSpread).toBeGreaterThan(section.spectralSpread);
    expect(section.meanFromLamp).toBeGreaterThan(ruled.meanFromLamp);
    // eslint-disable-next-line no-console
    console.log(
      `max spread — ruled ${ruled.spectralSpread.toFixed(4)}, section ` +
        `${section.spectralSpread.toFixed(4)} | mean spread — ruled ` +
        `${ruled.spectralMeanSpread.toFixed(4)}, section ${section.spectralMeanSpread.toFixed(4)}` +
        ` | off lamp white — ruled ${ruled.meanFromLamp.toFixed(4)}, section ` +
        `${section.meanFromLamp.toFixed(4)}`,
    );
  });
});

describe("A9.3 — the guard names the plane that refused", () => {
  it("reports a verdict per wavelength and the worst one's λ", () => {
    const readout = ok({ ...BASE, wavelengths: 3 });
    expect(readout.planes).toHaveLength(3);
    const worst = readout.planes.find((p) => p.nm === readout.verdictNm);
    expect(worst?.verdict).toBe(readout.verdict);
    // eslint-disable-next-line no-console
    console.log(
      `verdicts: ${readout.planes.map((p) => `${p.nm.toFixed(0)}=${p.verdict}`).join(" ")} ` +
        `| worst ${readout.verdictNm.toFixed(0)} nm: ${readout.verdict}`,
    );
  });

  /**
   * The ratio is λ's **to 1.4e-4 and not exactly**, and the departure is the
   * point: these frames are *traced*, so the exit pupil and the reference sphere
   * move with wavelength too, and § 6r.6's own rung states the agreement to three
   * decimals for the same reason. A rung written to 9 places here would be
   * pinning the closed form the panel deliberately does not use.
   */
  /**
   * § 6r.7 in the app's own currency, and it is the panel's most useful guard:
   * at 32 bins the DIN 4×'s **blue** plane has no honest image while 550 and 650
   * do, so a reader who raises the wavelength count without raising the pupil
   * lattice gets an image the engine has already refused. Doubling the lattice
   * clears it. The rung names the wavelength, because "the frame is unreliable"
   * and "the blue third of the colour is" are different sentences.
   */
  it("the blue plane refuses at 32 bins and passes at 64", () => {
    const coarse = ok({ ...BASE, pupilSamples: 32 });
    expect(coarse.verdict).toBe("no-honest-image");
    expect(coarse.verdictNm).toBeLessThan(500);
    expect(coarse.planes.filter((p) => p.verdict === "valid")).toHaveLength(2);

    const fine = ok({ ...BASE, pupilSamples: 64, size: 128 });
    expect(fine.verdict).toBe("valid");
    // eslint-disable-next-line no-console
    console.log(
      `ps 32: ${coarse.planes.map((p) => `${p.nm.toFixed(0)}=${p.verdict}`).join(" ")} ` +
        `(${coarse.elapsedMs.toFixed(0)} ms) | ps 64/grid 128: ` +
        `${fine.planes.map((p) => `${p.nm.toFixed(0)}=${p.verdict}`).join(" ")} ` +
        `(${fine.elapsedMs.toFixed(0)} ms, ${fine.sourcePoints} directions)`,
    );
  });

  /**
   * The frame a polychromatic stack covers is the **blue end's**, not the d
   * line's: every plane is resampled onto the bluest one's grid, and § 6h.2's
   * half-extent is ∝ λ. So a colour frame is narrower than the same objective's
   * monochrome frame by λ_blue/λ_d — 69.4 µm against A1's 93.5 — and a reader
   * comparing the two panels would otherwise read that as a bug.
   */
  it("the span is § 6h's closed form at the RULER wavelength, not at the d line", () => {
    const readout = ok(BASE);
    const naTraced = 0.1; // the label; § 6b's 4×/0.10 traces to it to 7 digits
    // half-extent = pupilSamples·λ/(4·NA), doubled for the span, then the crop
    // the common grid took off each side.
    const predictedUm =
      ((BASE.pupilSamples * readout.rulerWavelengthNm * 1e-3) / (2 * naTraced)) *
      (readout.size / BASE.size);
    // To a percent, and not closer: `microscope.ts` records the same thing for
    // A1's own column — the closed form is paraxial and the frame is traced, so
    // the gap is the objective's own departure from it (§ 6h.4 measures 2.7% on
    // this lens and shows it IS the departure from the sine condition). Pinning
    // this tighter would be pinning the formula instead of the trace.
    expect(readout.objectSpanUm / predictedUm).toBeCloseTo(1, 1);
    // eslint-disable-next-line no-console
    console.log(
      `span ${readout.objectSpanUm.toFixed(1)} µm at ruler ` +
        `${readout.rulerWavelengthNm.toFixed(1)} nm (closed form ${predictedUm.toFixed(1)}, ` +
        `${((readout.objectSpanUm / predictedUm - 1) * 100).toFixed(2)}%), ` +
        `crop ${readout.croppedPixels} px per side`,
    );
  });

  it("the ruler is the bluest plane, and the resample ratio is λ's to the objective's dispersion", () => {
    const readout = ok({ ...BASE, wavelengths: 3 });
    const bluest = Math.min(...readout.planes.map((p) => p.nm));
    expect(readout.rulerWavelengthNm).toBeCloseTo(bluest, 9);
    let worst = 0;
    for (const plane of readout.planes) {
      const ideal = readout.rulerWavelengthNm / plane.nm;
      expect(plane.resampleRatio).toBeCloseTo(ideal, 3);
      worst = Math.max(worst, Math.abs(plane.resampleRatio - ideal));
    }
    // **The ratio is λ_ruler/λ EXACTLY here, and it always was** — which is a
    // correction to this rung rather than a § 6ai finding. It used to assert
    // `worst > 0` and pass, on a rim-stopped objective, by exactly one ulp
    // (1.1e-16); the shipped telecentric one reads a clean 0 and the assertion
    // went red. Neither number is the objective's dispersion. This surface
    // renders ONE on-axis frame, and on axis the chief ray is the axis whatever
    // the stop does, so there is no field-dependent pupil walk for λ to act on.
    //
    // § 6t.3 is where the dispersion is real, because its fixture sits at
    // (1.6, 0.8) mm: 1.7e-4 rim against 2.4e-10 telecentric. Re-measured on THIS
    // request, both members come back under an ulp — so what changed at § 6ai is
    // that a one-ulp accident stopped rounding the convenient way.
    expect(worst).toBeLessThan(4 * Number.EPSILON);

    // The liveness check therefore has to be on something the trace produces and
    // arithmetic cannot, which is what `worst > 0` was reaching for and did not
    // reach. Each plane's grid phase step is read off its own traced wavefront at
    // its own wavelength: three planes, three different numbers, none of them
    // derivable from the ratios above.
    const steps = readout.planes.map((p) => p.maxGridPhaseStepWaves);
    for (const step of steps) {
      expect(step).not.toBeNull();
      expect(step!).toBeGreaterThan(0);
    }
    expect(new Set(steps).size).toBe(readout.planes.length);
    // Bluer is a finer wavefront per sample, monotonically — the ordering is the
    // trace's, and a stack that reused one plane's frame could not produce it.
    for (let i = 1; i < steps.length; i++) {
      expect(readout.planes[i]!.nm).toBeGreaterThan(readout.planes[i - 1]!.nm);
      expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
    // eslint-disable-next-line no-console
    console.log(`resample ratio departs from λ's by up to ${worst.toExponential(3)}`);
  });
});

describe("A9.4 — what the panel costs, measured", () => {
  it("prints the cost against the wavelength count", () => {
    const points = sourceOf(BASE.coherenceParameter, BASE.pupilSamples).points.length;
    for (const wavelengths of [3, 5, 9]) {
      const readout = ok({ ...BASE, wavelengths });
      // eslint-disable-next-line no-console
      console.log(
        `${wavelengths} λ, ps ${BASE.pupilSamples}, grid ${BASE.size}, ` +
          `${points} directions: ${readout.elapsedMs.toFixed(0)} ms ` +
          `(${(readout.elapsedMs / wavelengths).toFixed(0)} ms per λ), ` +
          `span ${readout.objectSpanUm.toFixed(1)} µm, ` +
          `measured ${readout.measuredPixels} px, dark ${readout.darkPixels}`,
      );
    }
  });

  it("a tungsten lamp is warmer than an equal-energy one", () => {
    const equal = ok(BASE);
    const tungsten = ok({ ...BASE, lamp: "tungsten-3200" });
    // 3200 K puts more energy at the long end, so the lamp's own chromaticity
    // moves toward the red corner — x rises. The specimen has not changed.
    expect(tungsten.lampChromaticity.x).toBeGreaterThan(equal.lampChromaticity.x + 0.05);
    // eslint-disable-next-line no-console
    console.log(
      `lamp white: equal-energy (${equal.lampChromaticity.x.toFixed(4)}, ` +
        `${equal.lampChromaticity.y.toFixed(4)}), tungsten ` +
        `(${tungsten.lampChromaticity.x.toFixed(4)}, ${tungsten.lampChromaticity.y.toFixed(4)})`,
    );
  });
});

/**
 * **Found by driving the panel, not by writing it.** The S slider starts at 0
 * and the first thing it did there was throw: a commensurate lattice of radius
 * zero holds no points, so `commensurateSource` refuses it rather than returning
 * the axial direction. The coherent limit is a *different source* and not a
 * small one — A2 makes the same split — and it matters beyond the slider's left
 * end, because at ps 64 on a 64² grid the frequency-grid wall caps S at zero and
 * the coherent source is then the ONLY one this pair admits.
 */
describe("A9.7 — the coherent limit is a source, not a small condenser", () => {
  it("renders at S = 0, where a lattice of radius zero has no points", () => {
    const readout = ok({ ...BASE, coherenceParameter: 0 });
    expect(readout.sourcePoints).toBe(1);
    // Still a real image: one direction, and the tint control still zero.
    expect(readout.spectralSpread).toBeGreaterThan(0);
    expect(readout.tintedSpread).toBeLessThan(1e-12);
  });

  /**
   * And the SECOND correction the panel forced, one click after the first. A
   * clamped cap of zero reads as "only the coherent limit fits" — but at ps 64
   * on a 64² grid the engine refuses that too, because an unshifted pupil of 64
   * bins already needs 66. So the reach is reported raw: negative means no
   * condenser at all, and the two states get different sentences on screen.
   */
  it("a negative reach means no condenser fits, coherent included", () => {
    expect(maxCoherenceParameter(64, 64)).toBeLessThan(0);
    expect(maxCoherenceParameter(64, 32)).toBeCloseTo(0.9375, 12);
    expect(maxCoherenceParameter(128, 64)).toBeCloseTo(0.96875, 12);

    // The engine's own refusal at the negative corner, quoted rather than
    // predicted — and it names the size that would fix it.
    const refused = renderSection({ ...BASE, pupilSamples: 64, size: 64, coherenceParameter: 0 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("raise size to at least 66");

    // One bin of grid either side is the whole difference.
    const fits = ok({ ...BASE, pupilSamples: 64, size: 128, coherenceParameter: 0 });
    expect(fits.sourcePoints).toBe(1);
  });
});

describe("A9.5 — the library the picker runs on", () => {
  it("every entry is either neutral by construction or the stained one", () => {
    expect(SPECIMENS.map((s) => s.neutral)).toEqual([true, true, false]);
  });

  it("a neutral entry returns the same amplitude at every wavelength", () => {
    const grid = specimenOf("ruled").specimen;
    for (const nm of [400, 550, 700]) {
      expect(grid(0.0005, 0.0005, nm)).toEqual(grid(0.0005, 0.0005, 550));
    }
  });

  it("the stained entry does not, and it is never opaque at any λ", () => {
    const section = specimenOf("section").specimen;
    // The cells are hashed onto a 25 µm lattice, so a hand-picked point lands on
    // clear ground as often as not — the darkest point of a scan is the one that
    // has both dyes in it, and it is found rather than assumed.
    let darkest = { x: 0, y: 0, re: Infinity };
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        const x = (i / 60) * 0.05;
        const y = (j / 60) * 0.05;
        const re = section(x, y, 550).re;
        if (re < darkest.re) darkest = { x, y, re };
      }
    }
    const values = [450, 550, 650].map((nm) => section(darkest.x, darkest.y, nm).re);
    expect(new Set(values).size).toBe(3);
    // Beer–Lambert: an absorbance is finite, so a transmittance is never 0 —
    // which is what keeps the stain a specimen rather than a mask.
    for (const v of values) expect(v).toBeGreaterThan(0);
    // Clear ground transmits everything at every wavelength: exp(0) = 1 exactly,
    // and that is the amplitude the field around a cell must have.
    for (const nm of [450, 550, 650]) expect(section(0.0125, 0.0125, nm).re).toBeLessThanOrEqual(1);
  });

  it("chromaticSpread ignores the margin it says it ignores", () => {
    // A frame whose only coloured pixel sits in the margin must read zero — the
    // guard against reporting the transform's own wrap as the specimen's colour.
    const n = 16;
    const xyz = new Float64Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      xyz[i * 3] = 0.95;
      xyz[i * 3 + 1] = 1;
      xyz[i * 3 + 2] = 1.09;
    }
    const corner = (1 * n + 1) * 3;
    xyz[corner] = 5;
    xyz[corner + 1] = 0.2;
    xyz[corner + 2] = 0.1;
    const spread = chromaticSpread({ width: n, height: n, pixelScaleMm: 1e-3, xyz });
    expect(spread.spread).toBeLessThan(1e-12);
    expect(spread.measured).toBe((n - 6) * (n - 6));
  });
});

describe("A9.6 — the lamp's spectrum is in the weights", () => {
  it("an equal-energy lamp weights every bin equally and tungsten does not", () => {
    const equal = lampSamples("equal-energy", 5);
    for (const s of equal) expect(s.weight).toBeCloseTo(equal[0]!.weight, 12);
    const tungsten = lampSamples("tungsten-3200", 5);
    expect(tungsten[4]!.weight).toBeGreaterThan(tungsten[0]!.weight);
  });
});
