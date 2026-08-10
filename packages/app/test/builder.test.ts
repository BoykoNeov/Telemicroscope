import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC, type BuildSpec } from "../src/builder";
import { describeBuild } from "../src/microscope";

/**
 * D8's form, pinned at exactly one thing: what it does with a value that is not
 * a number in the ordinary sense.
 *
 * **This file exists because of a change made in another panel.** The bench
 * editor (Part E) needed `NumberField` to accept ±Infinity — a plane is R = ∞
 * and an unbounded rim is `semiAperture: Infinity`, both values the schema means
 * — so the shared control's predicate moved from `!Number.isFinite` to
 * `!Number.isNaN`. Every panel using it inherited that, and D8 has seven
 * free-typed fields that go straight into the engine's constructors. Two of them
 * pass those constructors' own guards: `magnification` is checked only with
 * `!(M > 0)` and `opticalTubeLengthMm` only with `> 0`, and Infinity satisfies
 * both.
 *
 * So the question is not academic, and the answer is that the engine catches
 * them one level deeper — f = x′/M = 150/∞ = 0 reaches `achromaticObjective`,
 * which refuses a zero focal length. That is this repo's stated position working
 * as designed (the engine refuses, in its own words, and the panel prints the
 * sentence), and it is worth a rung of its own precisely because it holds by
 * *composition* rather than by any single guard: a future constructor that
 * defaults or clamps instead of refusing would break it silently.
 *
 * Every case below must be an ENGINE refusal, not an app one: the app has no
 * business deciding that an aperture is too large, and the moment it does, the
 * measured numbers in those sentences stop reaching the screen.
 */
describe("every free-typed builder field, handed an infinity, is refused rather than built", () => {
  const CASES: readonly (readonly [string, BuildSpec])[] = [
    ["magnification", { ...DEFAULT_SPEC, magnification: Infinity }],
    ["numericalAperture", { ...DEFAULT_SPEC, numericalAperture: Infinity }],
    ["tubeLengthMm", { ...DEFAULT_SPEC, tubeLengthMm: Infinity }],
    ["coverslip thickness", { ...DEFAULT_SPEC, coverslip: { kind: "slip", thicknessMm: Infinity, medium: "D263" } }],
    ["infinitySpaceMm", { ...DEFAULT_SPEC, architecture: "infinity", infinitySpaceMm: Infinity }],
    ["powerSplit", { ...DEFAULT_SPEC, architecture: "infinity", form: "lister", powerSplit: Infinity }],
    ["separationFactor", { ...DEFAULT_SPEC, architecture: "infinity", form: "lister", separationFactor: Infinity }],
  ];

  for (const [field, spec] of CASES) {
    it(`refuses an infinite ${field}, in the engine's own words`, () => {
      const started = performance.now();
      const result = describeBuild(spec, { pupilSamples: 32, size: 64 });
      // Under a second by a wide margin — the point is that it RETURNS. An
      // unbounded solve is the one failure a panel cannot report, because there
      // is nothing left to report it with.
      expect(performance.now() - started).toBeLessThan(1000);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe("engine");
      expect(result.error.length).toBeGreaterThan(0);
    });
  }

  it("still refuses a negative magnification, which no infinity is needed to reach", () => {
    const result = describeBuild({ ...DEFAULT_SPEC, magnification: -1 }, { pupilSamples: 32, size: 64 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("magnification must be positive");
  });
});
