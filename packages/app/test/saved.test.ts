import { describe, it, expect } from "vitest";
import { MICROSCOPE_CATALOG, entryOf, specKey } from "../src/microscope";
import { buildMicroscope, DEFAULT_SPEC, type BuildSpec } from "../src/builder";
import { decodeBuild, encodeBuild, readSavedBuild } from "../src/saved";
import { customLabel, objectiveOf, objectiveOptions } from "../src/objective";

/**
 * Part F's slot, as invariants — APP.md's decision 2.
 *
 * **No engine capability was added, so no validation-ladder rung was**, and one
 * would be a category error: nothing here is physics. What is pinned is the one
 * property a saved design has to have and cannot be eyeballed — that what comes
 * back out is the design that went in, rather than one that *resembles* it. A
 * spec is sixteen fields and a lens differing in one of them is a different
 * lens, so "resembles" is the whole failure mode.
 *
 * `editor.test.ts`'s seed round-trip is the precedent this follows.
 */

const CUSTOM: BuildSpec = {
  ...DEFAULT_SPEC,
  architecture: "infinity",
  form: "lister",
  magnification: 25,
  numericalAperture: 0.31,
  crownMedium: "FUSED-SILICA",
  powerSplit: 0.55,
  separationFactor: 0.42,
};

/**
 * A slip, on the one form that takes one — the DIN doublet.
 *
 * Kept separate because the cover slip is the only field with a shape of its
 * own, so it needs a round trip, and the aplanat above cannot carry one: § 6d's
 * two-group form has no parameter to solve a slip into, and the app says so in
 * its own voice rather than the engine's.
 */
const SLIPPED: BuildSpec = {
  ...DEFAULT_SPEC,
  magnification: 6,
  numericalAperture: 0.14,
  coverslip: { kind: "slip", thicknessMm: 0.17, medium: "D263" },
};

describe("Part F — a saved build comes back as the design it was, field for field", () => {
  it("round-trips every catalogue row through the stored string", () => {
    for (const entry of MICROSCOPE_CATALOG) {
      const back = decodeBuild(encodeBuild(entry.spec));
      expect(back).not.toBeNull();
      // `specKey` rather than `toEqual`, deliberately: it is the function the
      // tile cache keys on, so this pins that a reload cannot silently produce a
      // spec that builds the same lens but misses the cache — or worse, one that
      // hits it while describing a different lens.
      expect(specKey(back!)).toBe(specKey(entry.spec));
      expect(back).toEqual(entry.spec);
    }
  });

  it("round-trips a design that is in no catalogue row, including inside the slip", () => {
    expect(decodeBuild(encodeBuild(CUSTOM))).toEqual(CUSTOM);
    const slipped = decodeBuild(encodeBuild(SLIPPED));
    expect(slipped).toEqual(SLIPPED);
    expect(slipped!.coverslip).toEqual({ kind: "slip", thicknessMm: 0.17, medium: "D263" });
  });

  it("builds the same system it was saved from — both forms, slip and none", () => {
    for (const spec of [CUSTOM, SLIPPED]) {
      const before = buildMicroscope(spec);
      const after = buildMicroscope(decodeBuild(encodeBuild(spec))!);
      expect(after.system.prescription).toEqual(before.system.prescription);
      expect(after.chain.nominalMagnification).toBe(before.chain.nominalMagnification);
    }
  });
});

describe("Part F — a stored value this code does not recognise is nothing, never a partial spec", () => {
  const refuses = (text: string) => expect(decodeBuild(text)).toBeNull();

  it("refuses what is not JSON, and what is JSON but not a payload", () => {
    refuses("");
    refuses("{");
    refuses("null");
    refuses('"a spec"');
    refuses("{}");
  });

  it("refuses a future or missing version rather than reading the fields anyway", () => {
    const payload = JSON.parse(encodeBuild(CUSTOM)) as { version: number; spec: unknown };
    refuses(JSON.stringify({ ...payload, version: payload.version + 1 }));
    refuses(JSON.stringify({ spec: payload.spec }));
  });

  it("refuses a payload missing one field, and one whose field is the wrong kind", () => {
    for (const key of Object.keys(DEFAULT_SPEC)) {
      const spec = { ...DEFAULT_SPEC } as Record<string, unknown>;
      delete spec[key];
      refuses(JSON.stringify({ version: 1, spec }));
    }
    refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, magnification: "4" } }));
    refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, numericalAperture: null } }));
    refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, architecture: "DIN" } }));
    refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, crownMedium: "" } }));
    // NaN and Infinity are not JSON literals, so they arrive as `null` — which
    // the shape check catches. The bare object is checked too, since a spec is
    // also built in memory by the panel.
    refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, tubeLengthMm: Infinity } }));
  });

  it("refuses a malformed cover slip, which is the only field with a shape of its own", () => {
    for (const coverslip of [
      null,
      "none",
      { kind: "maybe" },
      { kind: "slip" },
      { kind: "slip", thicknessMm: 0.17 },
      { kind: "slip", thicknessMm: "0.17", medium: "D263" },
    ]) {
      refuses(JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, coverslip } }));
    }
  });

  it("drops fields it does not know rather than carrying them into a build", () => {
    const back = decodeBuild(
      JSON.stringify({ version: 1, spec: { ...DEFAULT_SPEC, cheeseFactor: 3 } }),
    );
    expect(back).toEqual(DEFAULT_SPEC);
    expect(Object.keys(back!)).not.toContain("cheeseFactor");
  });

  it("returns nothing where there is no browser to store in, rather than throwing", () => {
    // Under node there is no `localStorage` at all, which is the same branch a
    // profile with storage blocked takes. A panel must still paint.
    expect(readSavedBuild()).toBeNull();
  });
});

describe("Part F — the picker is the catalogue plus at most one build, and it names it honestly", () => {
  it("offers ten rows with no slot, eleven with one", () => {
    expect(objectiveOptions(null)).toHaveLength(MICROSCOPE_CATALOG.length);
    const withCustom = objectiveOptions(CUSTOM);
    expect(withCustom).toHaveLength(MICROSCOPE_CATALOG.length + 1);
    expect(withCustom.at(-1)!.id).toBe("custom");
  });

  it("carries the catalogue's note for a row and NO note for a build", () => {
    // The rule the caption layer inherits: `null` means print nothing, because
    // a row's note is a measured sentence about a specific lens.
    for (const option of objectiveOptions(CUSTOM)) {
      expect(option.custom).toBe(option.id === "custom");
      expect(option.note === null).toBe(option.custom);
    }
    expect(objectiveOf(objectiveOptions(CUSTOM), "custom").note).toBeNull();
    expect(objectiveOf(objectiveOptions(null), "din-4x-010").note).toBe(
      entryOf("din-4x-010").note,
    );
  });

  it("labels a build by what it is, since the slot holds one and nobody named it", () => {
    expect(customLabel(CUSTOM)).toBe("your Lister 25×/0.31");
    expect(customLabel({ ...DEFAULT_SPEC, magnification: 10, numericalAperture: 0.12 })).toBe(
      "your DIN 10×/0.12",
    );
  });

  it("falls back to a real row rather than to nothing when the slot is gone", () => {
    const options = objectiveOptions(null);
    expect(objectiveOf(options, "custom")).toBe(options[0]);
  });
});
