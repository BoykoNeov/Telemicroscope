import { describe, expect, it } from "vitest";
import {
  buildMicroscope,
  DEFAULT_SPEC,
  FIELD_NUMBER_MM,
  listerSpec,
  oilSpec,
  type BuildSpec,
} from "../src/builder";
import { exitBundle } from "@telemicroscope/core/analysis";
import { pupilGrid } from "@telemicroscope/core/pupil";
import {
  buildFrame,
  describeBuild,
  describeEntry,
  describeSystem,
  MICROSCOPE_CATALOG,
} from "../src/microscope";
import { LAMBDA_NM } from "../src/microscope";
import { renderBrightfieldScene } from "../src/brightfield";
import { refusalVoice } from "../src/refusal";
import type { OpticalSystem } from "@telemicroscope/core/trace";

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

/**
 * The identity D8 claimed and never pinned — Part F's first test.
 *
 * D8 recorded that its ten `BuildSpec` presets "were checked identical — object
 * for object, and message for message" against the two-argument constructor
 * calls they replaced, and that check was a one-off: this file pinned the
 * infinity refusals and nothing else. Part F made the claim load-bearing, since
 * every imaging panel now sends a spec and there is no longer a second path to
 * fall back on if a preset drifts from the row it is named for.
 *
 * **The count of refusing rows is read off the catalogue, never written down
 * here.** It was written down — in four places in the app — and § 6b.5.6 moved a
 * wall, so "three rows exist to be refused" became false while every sentence
 * saying it kept saying it. A test that asserted the number would have become
 * the fifth.
 */
describe("Part F — the ten rows build the same lens through the spec as through the name", () => {
  const REQUEST = { pupilSamples: 32, size: 64 };

  for (const entry of MICROSCOPE_CATALOG) {
    it(`${entry.label}: the entry's closure and its spec are the same system`, () => {
      // What the panels used to send (`entryOf(kind).build()`) against what they
      // send now (`buildFrame({ spec })`). Prescriptions rather than readouts,
      // so a difference cannot hide inside a rounded column.
      let viaClosure: ReturnType<typeof entry.build> | null = null;
      let closureError: string | null = null;
      try {
        viaClosure = entry.build();
      } catch (cause) {
        closureError = (cause as Error).message;
      }

      let viaSpec: OpticalSystem | null = null;
      let specError: string | null = null;
      try {
        viaSpec = buildFrame({ spec: entry.spec, ...REQUEST }).system;
      } catch (cause) {
        specError = (cause as Error).message;
      }

      // Message for message, which is the half that matters for a row that
      // refuses: the sentence IS the readout there.
      expect(specError).toBe(closureError);
      if (closureError !== null) return;
      expect(viaSpec!.prescription).toEqual(viaClosure!.prescription);
    });
  }

  it("the readout is the same either way, column for column", () => {
    for (const entry of MICROSCOPE_CATALOG) {
      const byName = describeEntry({ kind: entry.kind, ...REQUEST });
      const bySpec = describeSystem(() => buildMicroscope(entry.spec).system, REQUEST);
      // Which rows refuse is whatever the engine says today; that the two paths
      // AGREE about it is the invariant, and naming a row here would be the
      // stale sentence again in test form.
      expect(bySpec.ok).toBe(byName.ok);
      if (!byName.ok || !bySpec.ok) {
        if (byName.ok || bySpec.ok) return;
        expect(bySpec.error).toBe(byName.error);
        expect(bySpec.source).toBe(byName.source);
        continue;
      }
      // `elapsedMs` is a clock and not a reading; everything else must match.
      const { elapsedMs: _a, ...left } = byName.readout;
      const { elapsedMs: _b, ...right } = bySpec.readout;
      expect(right).toEqual(left);
    }
  });

  it("the catalogue's infinity doublets pass the field this app SAYS they show", () => {
    // § 6w at the app's own seam, and the reason the parameter is set here rather
    // than defaulted in the engine: a field number is only decidable once
    // something downstream states the field, and the stage is that something — it
    // crops to `FIELD_NUMBER_MM` and prints the number on screen. Before this the
    // three infinity rows were sized to their axial beam, so the panel drew a
    // caption claiming a field its own objective vignetted 27% of the pupil at.
    //
    // Pinned on the CATALOGUE rather than on the constructor (§ 6w.3 has that):
    // what can go stale here is a row that stops carrying the field number, or a
    // constant that drifts from the caption's.
    const doublets = MICROSCOPE_CATALOG.filter(
      (entry) => entry.spec.architecture === "infinity" && entry.spec.form === "doublet",
    );
    expect(doublets.length).toBeGreaterThan(0);
    for (const entry of doublets) {
      expect(entry.spec.fieldNumberMm).toBe(FIELD_NUMBER_MM);
      const h = FIELD_NUMBER_MM / (2 * entry.spec.magnification);
      const sized = buildMicroscope(entry.spec).system;
      const axial = buildMicroscope({ ...entry.spec, fieldNumberMm: 0 }).system;
      const survives = (system: OpticalSystem) => {
        const bundle = exitBundle(system, h, LAMBDA_NM, pupilGrid(21));
        return bundle.rays.length / (bundle.rays.length + bundle.lost);
      };
      expect(survives(sized)).toBe(1);
      expect(survives(axial)).toBeLessThan(0.75);
    }
  });

  it("refuses a field number on the forms that have no such parameter", () => {
    // The other two constructors are not "not wired up yet" — the Lister and the
    // oil front are different lenses with no such parameter. The app says which,
    // in its own voice, rather than dropping the field silently.
    //
    // **The DIN doublet came OFF this list at § 6ai** and is the rung below
    // instead. Its old reason — that it stops on its rim, where a bundle pivots
    // instead of walking — was a fact about the default stop placement, and the
    // default moved: the shipped finite conjugate is telecentric, its bundle
    // translates across the front element, and a field number is now the only
    // way to size it for one.
    for (const spec of [listerSpec(40, 0.2), oilSpec(1.25)]) {
      const result = describeBuild({ ...spec, fieldNumberMm: 18 }, { pupilSamples: 32, size: 64 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe("app");
      expect(result.error).toMatch(/field number/);
    }
  });

  it("…and ACCEPTS one on the DIN doublet, which is § 6ai's whole point", () => {
    // The other half of the rung above, and it is a build rather than a refusal:
    // an object-space telecentric objective that is not told what field it must
    // pass will clip its own bundle off axis, so the app's catalogue states the
    // field its stage crops to.
    const sized = describeBuild(
      { ...DEFAULT_SPEC, fieldNumberMm: 18 },
      { pupilSamples: 32, size: 64 },
    );
    expect(sized.ok).toBe(true);
    if (!sized.ok) return;
    // Bigger glass, and it is the semi-field that made it bigger: 18/(2·4) is
    // 2.25 mm of specimen, and the element grows by very nearly that.
    const frontOf = (spec: BuildSpec): number =>
      buildMicroscope(spec).system.prescription.surfaces[0]!.semiAperture;
    const grew = frontOf({ ...DEFAULT_SPEC, fieldNumberMm: 18 }) - frontOf(DEFAULT_SPEC);
    expect(grew).toBeGreaterThan(2.1);
    expect(grew).toBeLessThan(2.3);
    // …and the focal length is untouched by it, to the last bit: a field number
    // buys aperture, not a different lens (§ 6ai.4).
    const bare = describeBuild(DEFAULT_SPEC, { pupilSamples: 32, size: 64 });
    if (!bare.ok) throw new Error("the default no longer builds");
    expect(sized.objective.focalLengthMm).toBe(bare.objective.focalLengthMm);
    // What it does cost is the working distance, and § 6w.4 said it would:
    // thicker glass moves the principal planes.
    expect(sized.objective.objectDistanceMm).toBeLessThan(bare.objective.objectDistanceMm);
    // And it is still refused where it cannot be paid: at NA 0.20 an 18 mm field
    // asks for f/1.53 and the cemented doublet has no bending for it. The
    // refusal is the ENGINE's, with its measured numbers, not the app's.
    const fast = describeBuild(
      { ...DEFAULT_SPEC, numericalAperture: 0.2, fieldNumberMm: 18 },
      { pupilSamples: 32, size: 64 },
    );
    expect(fast.ok).toBe(false);
    if (fast.ok) return;
    expect(fast.source).toBe("engine");
    expect(fast.error).toMatch(/field walk/);
  });

  it("whichever rows refuse do it in the engine's voice, with a number in the sentence", () => {
    const refused = MICROSCOPE_CATALOG.filter(
      (entry) => !describeEntry({ kind: entry.kind, ...REQUEST }).ok,
    );
    // Not "there are N of them": that is exactly the sentence that went stale.
    // What must hold whatever the engine does next is that a refusal is the
    // engine's own, and that its text carries the measured ceiling — a bare
    // "cannot build" would leave the picker showing nothing.
    for (const entry of refused) {
      const result = describeEntry({ kind: entry.kind, ...REQUEST });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.source).toBe("engine");
      expect(result.error).toMatch(/[0-9]/);
    }
    // And every row that does NOT refuse must produce a frame with a crop in it,
    // so "it builds" cannot quietly mean "it builds something unusable".
    for (const entry of MICROSCOPE_CATALOG) {
      const result = describeEntry({ kind: entry.kind, ...REQUEST });
      if (!result.ok) continue;
      expect(result.readout.objectSpanUm).toBeGreaterThan(0);
      expect(result.readout.tracedNA).toBeGreaterThan(0);
    }
  });
});

/**
 * Part F's third pin: a spec a reader typed reaches a render, and a render that
 * cannot happen must *return*.
 *
 * The builder gates saving on a design that built, so the ordinary path cannot
 * put an unbuildable spec in front of an imaging panel. This is the path that
 * survives that gate: a spec that builds fine at the builder's own sampling and
 * meets a different wall inside the render — and, for completeness, one that the
 * app itself refuses, since `AppRefusal` became reachable from inside an adapter
 * the moment the request stopped carrying a name from a checked list.
 */
describe("Part F — an imaging adapter hands back a refusal rather than throwing or hanging", () => {
  const BASE = {
    pupilSamples: 32,
    size: 128,
    // The independent condenser, deliberately: these are refusal rungs, and the
    // 11-point disc is the source they were written against.
    condenser: { kind: "independent", samples: 11 } as const,
    coherenceParameter: 0.5,
    cycles: 8,
    modulation: 0.4,
    pupil: "traced" as const,
  };

  it("returns the app's own sentence, in the app's own voice, for a spec the app refuses", () => {
    // DIN × Lister: there is no engine call at all, so nothing is thrown by
    // `core` and the panel must not print this in the engine's voice.
    const started = performance.now();
    const result = renderBrightfieldScene({
      ...BASE,
      spec: { ...DEFAULT_SPEC, architecture: "din", form: "lister" },
    });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe("app");
    expect(refusalVoice(result.source, "this render")).toMatch(/^this app refuses/);
  });

  it("returns the engine's sentence for a spec the engine refuses", () => {
    const result = renderBrightfieldScene({
      ...BASE,
      spec: { ...DEFAULT_SPEC, architecture: "infinity", form: "lister", numericalAperture: 0.9 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe("engine");
    expect(result.error).toMatch(/[0-9]/);
  });

  it("draws a picture for a spec that is in no catalogue row", () => {
    const result = renderBrightfieldScene({
      ...BASE,
      spec: { ...DEFAULT_SPEC, magnification: 10, numericalAperture: 0.12 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.readout.objectSpanUm).toBeGreaterThan(0);
    // The frame is § 6h's, for a lens nothing here has measured — which is the
    // whole of Part F in one assertion.
    expect(result.readout.rgba.length).toBe(4 * BASE.size * BASE.size);
  });
});
