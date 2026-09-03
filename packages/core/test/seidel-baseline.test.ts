import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seidelSums, type SeidelOptions } from "../src/analysis/seidel";
import type { Prescription } from "../src/trace/prescription";

/**
 * § 6cm.4 — the rung that says § 6cm moved nothing it was not asked to.
 *
 * Lifting the stop restriction meant restructuring `seidelSums`: the per-surface
 * media and powers are now resolved once into an array that the sums and the
 * chief-ray solve both read, so that a chief ray found for the stop's plane
 * cannot disagree with the sums about which glass sits where. Every expression
 * was carried across character for character, and the stop-at-surface-0 launch
 * is still written out literally rather than reached through the new general
 * formula — but "I moved it carefully" is not a measurement, and twenty-eight
 * call sites across the designs, the optimiser and the app depend on the answer.
 *
 * The existing rungs could not have caught a drift. They compare with
 * `toBeCloseTo`, which is the right tool for a physics claim and the wrong one
 * for a refactor: a change in the last three digits of every sum in the repo
 * would have passed all of them, silently, and shown up later as a design that
 * no longer reproduced its own recorded bending.
 *
 * So the numbers in `fixtures/seidel-pre-6cm.json` were dumped from the engine
 * **before** the change, at full f64 precision, over 161 configurations chosen to
 * touch every line of the loop: spherical mirrors at three radii and three
 * heights, thin and thick lenses across seven Coddington shapes at two indices,
 * a cemented doublet at five wavelengths, both conjugates, on axis and off, with
 * and without the distortion term, and a flat-in-a-collimated-beam system for the
 * A = 0 branch. The comparison below is EXACT — a JSON round-trip of a double is
 * lossless, so this is bit equality and not a tolerance.
 *
 * The four fields § 6cm added (`a`, `ab` per surface; the resolved marginal
 * height and the chief-ray launch) are stripped before comparing, because the
 * fixture predates them. Nothing else is.
 *
 * If this rung ever fails, the question is not what tolerance would let it pass.
 * It is which expression moved.
 *
 * ## The fixture's provenance IS the rung, so: do not regenerate it
 *
 * `seidel-pre-6cm.json` was produced by `analysis/seidel` **as it stood at commit
 * `8e7f0b0`**, the last state of that file before § 6cm touched it, driven by the
 * `cases()` generator below. The generator lives here so the numbers can be
 * *re-derived* — but re-deriving them against the CURRENT engine and overwriting
 * the file turns this rung into a tautology that passes forever and checks
 * nothing. That is the one way to break it that leaves it green. If a later step
 * deliberately changes a Seidel number, the fixture is not what to edit: record
 * the new value where the change is argued, and say here which case moved and
 * why.
 */

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/seidel-pre-6cm.json", import.meta.url)), "utf8"),
) as readonly { readonly name: string; readonly out: Record<string, unknown> }[];

const sphereMirror = (R: number, dia: number): Prescription => ({
  surfaces: [
    { kind: "reflect", curvature: -1 / R, semiAperture: dia / 2, thickness: -R / 2, isStop: true },
  ],
});

/** A lens of focal length `f` at Coddington shape factor `q`, thickness `t`. */
const thinLens = (f: number, n: number, q: number, dia: number, medium: string, t = 0): Prescription => {
  const c1 = (1 / (f * (n - 1))) * ((q + 1) / 2);
  const c2 = (1 / (f * (n - 1))) * ((q - 1) / 2);
  return {
    surfaces: [
      { kind: "refract", curvature: c1, semiAperture: dia / 2, thickness: t, medium, isStop: true },
      { kind: "refract", curvature: c2, semiAperture: dia / 2, thickness: f, medium: "AIR" },
    ],
  };
};

const doublet: Prescription = {
  surfaces: [
    { kind: "refract", curvature: 1 / 300, semiAperture: 25, thickness: 6, medium: "N-BK7", isStop: true },
    { kind: "refract", curvature: -1 / 180, semiAperture: 25, thickness: 3, medium: "F2" },
    { kind: "refract", curvature: 1 / 900, semiAperture: 25, thickness: 480, medium: "AIR" },
  ],
};

/** Two flats in the collimated beam ahead of the glass — the A = 0 surfaces. */
const flatInBeam: Prescription = {
  surfaces: [
    { kind: "refract", curvature: 0, semiAperture: 30, thickness: 2, medium: "N-BK7", isStop: true },
    { kind: "refract", curvature: 0, semiAperture: 30, thickness: 10, medium: "AIR" },
    { kind: "refract", curvature: 1 / 400, semiAperture: 30, thickness: 5, medium: "N-BK7" },
    { kind: "refract", curvature: -1 / 400, semiAperture: 30, thickness: 400, medium: "AIR" },
  ],
};

interface Case {
  readonly name: string;
  readonly prescription: Prescription;
  readonly nm: number;
  readonly opts: SeidelOptions;
}

/** The generator, kept here so the fixture can be re-derived rather than trusted. */
function cases(): Case[] {
  const out: Case[] = [];
  const add = (name: string, prescription: Prescription, nm: number, opts: SeidelOptions) =>
    out.push({ name, prescription, nm, opts });

  for (const R of [800, 1600, 3200]) {
    for (const h of [25, 50, 100]) {
      add(`mirror R=${R} h=${h}`, sphereMirror(R, 2 * h), 550, { marginalHeightMm: h });
      add(`mirror R=${R} h=${h} field`, sphereMirror(R, 2 * h), 550, {
        marginalHeightMm: h,
        fieldAngleRad: 0.01,
      });
      add(`mirror R=${R} h=${h} field+dist`, sphereMirror(R, 2 * h), 550, {
        marginalHeightMm: h,
        fieldAngleRad: 0.01,
        distortion: true,
      });
    }
  }
  for (const n of [1.5, 1.7]) {
    const medium = n === 1.5 ? "N-BK7" : "CAF2";
    for (const q of [-2, -1, 0, 0.5, 0.71, 1, 2]) {
      for (const t of [0, 4]) {
        const p = thinLens(200, n, q, 50, medium, t);
        add(`lens n=${n} q=${q} t=${t}`, p, 550, { marginalHeightMm: 25 });
        add(`lens n=${n} q=${q} t=${t} field`, p, 550, { marginalHeightMm: 25, fieldAngleRad: 0.02 });
        add(`lens n=${n} q=${q} t=${t} finite`, p, 550, {
          marginalHeightMm: 25,
          objectDistanceMm: 600,
        });
        add(`lens n=${n} q=${q} t=${t} finite+field`, p, 550, {
          marginalHeightMm: 25,
          objectDistanceMm: 600,
          fieldAngleRad: 0.02,
        });
      }
    }
  }
  for (const nm of [430, 486.1, 550, 587.5618, 656.3]) {
    add(`doublet ${nm}`, doublet, nm, { marginalHeightMm: 25 });
    add(`doublet ${nm} field`, doublet, nm, { marginalHeightMm: 25, fieldAngleRad: 0.015 });
    add(`doublet ${nm} field+dist`, doublet, nm, {
      marginalHeightMm: 25,
      fieldAngleRad: 0.015,
      distortion: true,
    });
    add(`doublet ${nm} finite+field`, doublet, nm, {
      marginalHeightMm: 25,
      objectDistanceMm: 1200,
      fieldAngleRad: 0.015,
    });
  }
  add("flat-in-beam", flatInBeam, 550, { marginalHeightMm: 20 });
  add("flat-in-beam field", flatInBeam, 550, { marginalHeightMm: 20, fieldAngleRad: 0.01 });
  return out;
}

/** Drop the fields § 6cm added; the fixture predates all four. */
const strip = (o: Record<string, unknown>): Record<string, unknown> => {
  const { a, ab, marginalHeightMm, chiefHeightMm, chiefSlopeRad, ...rest } = o;
  void a;
  void ab;
  void marginalHeightMm;
  void chiefHeightMm;
  void chiefSlopeRad;
  if (Array.isArray(rest["surfaces"])) {
    rest["surfaces"] = (rest["surfaces"] as Record<string, unknown>[]).map(strip);
  }
  return rest;
};

describe("§ 6cm.4 — the sums are bit-identical to the engine that preceded the stop shift", () => {
  const built = cases();

  it("covers the fixture exactly — same cases, same order", () => {
    expect(built.length).toBe(FIXTURE.length);
    expect(built.map((c) => c.name)).toEqual(FIXTURE.map((c) => c.name));
    // A guard against the fixture quietly emptying and the rung passing for it.
    expect(built.length).toBeGreaterThan(150);
  });

  it("reproduces every recorded number to the bit, across 161 configurations", () => {
    const drifted: string[] = [];
    for (const [i, c] of built.entries()) {
      const got = JSON.stringify(strip(seidelSums(c.prescription, c.nm, c.opts) as unknown as Record<string, unknown>));
      const want = JSON.stringify(strip({ ...FIXTURE[i]!.out }));
      if (got !== want) drifted.push(`${c.name}\n  was ${want}\n  now ${got}`);
    }
    expect(drifted).toEqual([]);
  });
});
