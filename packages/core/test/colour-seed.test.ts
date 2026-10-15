import { describe, it, expect } from "vitest";
import { brightfieldSpectralStack, type BrightfieldSpectrumOptions } from "../src/imaging/brightfield-spectrum";
import { neutralSpecimen } from "../src/imaging/specimen";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  oilImmersionObjective,
  tubeLens,
} from "../src/designs";
import { commensurateSource } from "../src/illumination";
import type { RadialMapSeed } from "../src/imaging/radial-map";

/**
 * § 6ct — the seed reaches the colour brightfield stack.
 *
 * § 6bk put `radialMapSeed` on the fluorescence volume after finding a 10×
 * mosaic whose geometry computed and whose render threw, and named the
 * mechanism: unseeded, `objectHeightForImageRadius` opens its bracket at the
 * image radius, |M| object heights out, and past about 4× the chief ray is dead
 * there. `brightfieldSpectralStack` was the caller that still built its table
 * unseeded, so every colour brightfield frame above low power refused — the
 * app's colour section could draw the 4× and 10× rows and nothing else.
 *
 * The rungs are § 6bk.1's shape, because the change is § 6bk's option reaching
 * one more caller and not a new mechanism:
 *
 * 1. The headline objective of the branch — the oil 100×/1.25 — refuses
 *    unseeded with the message that names the seed, and renders seeded.
 * 2. Where both paths work the option is inert: `"none"` written out is
 *    bitwise the omitted option, and seeding moves no pixel by more than the
 *    mantissa — § 6m.2's "the seed chooses the path, not the answer", measured
 *    on this caller at 1.33e-15.
 */

const SAMPLES = [450, 550, 650].map((nm) => ({ nm, weight: 1 }));

/** A checkerboard of cosines: structure on both axes, no λ anywhere. */
const SPECIMEN = neutralSpecimen((x, y) => ({
  re: 0.6 + 0.4 * Math.cos((2 * Math.PI * x) / 0.01) * Math.cos((2 * Math.PI * y) / 0.013),
  im: 0,
}));

const SOURCE = commensurateSource(0.5, 32, 1);

function options(seed: RadialMapSeed | undefined): BrightfieldSpectrumOptions {
  return {
    size: 64,
    pupilSamples: 32,
    samples: SAMPLES,
    patches: 1,
    radialMapNodes: 32,
    layout: "exit",
    ...(seed === undefined ? {} : { radialMapSeed: seed }),
  };
}

const FOUR = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

const OIL = infinityCorrectedMicroscope({
  objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25 }),
  tubeLens: tubeLens({ focalLengthMm: 200 }),
}).system;

describe("§ 6ct.1 — the oil objective's colour frame needs the seed", () => {
  it("refuses unseeded, and the refusal names the seed", () => {
    expect(() => brightfieldSpectralStack(OIL, SPECIMEN, SOURCE, options("none"))).toThrow(
      /no object height reaches image radius.*UNSEEDED/,
    );
  });

  it("renders seeded: every pixel of every plane finite, and the 550 nm plane honest", () => {
    const stack = brightfieldSpectralStack(OIL, SPECIMEN, SOURCE, options("magnification"));
    expect(stack.planes).toHaveLength(3);
    for (const plane of stack.planes) {
      expect(plane.intensity.every((v) => Number.isFinite(v)), `${plane.nm} nm finite`).toBe(true);
    }
    // The guard is the engine's, and it still rules: the blue and red planes
    // refuse at this lattice, which is § 6r.7's sampling story and not this
    // step's. What this step adds is a plane that can be ruled on at all.
    expect(stack.planes.find((p) => p.nm === 550)!.fidelity?.verdict).toBe("valid");
  });
});

describe("§ 6ct.2 — where both paths work, the option is inert", () => {
  it("is bitwise absent when written as 'none'", () => {
    const omitted = brightfieldSpectralStack(FOUR, SPECIMEN, SOURCE, options(undefined));
    const none = brightfieldSpectralStack(FOUR, SPECIMEN, SOURCE, options("none"));
    for (let p = 0; p < omitted.planes.length; p++) {
      const a = omitted.planes[p]!.intensity;
      const b = none.planes[p]!.intensity;
      expect(b.length).toBe(a.length);
      let differing = 0;
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) differing++;
      expect(differing, `${omitted.planes[p]!.nm} nm`).toBe(0);
    }
  });

  it("moves no pixel by more than the mantissa when seeded", () => {
    const unseeded = brightfieldSpectralStack(FOUR, SPECIMEN, SOURCE, options("none"));
    const seeded = brightfieldSpectralStack(FOUR, SPECIMEN, SOURCE, options("magnification"));
    let worst = 0;
    for (let p = 0; p < unseeded.planes.length; p++) {
      const a = unseeded.planes[p]!.intensity;
      const b = seeded.planes[p]!.intensity;
      for (let i = 0; i < a.length; i++) {
        worst = Math.max(worst, Math.abs(a[i]! - b[i]!) / Math.abs(a[i]!));
      }
    }
    // Measured 1.33e-15 — six ulp. § 6bf.6 is why it is not zero: a seeded
    // bisection takes a different path to the same root.
    expect(worst).toBeLessThan(1e-14);
  });
});
