import { describe, expect, it } from "vitest";
import {
  cassegrain,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  refractorPair,
} from "@telemicroscope/core/designs";
import { LINE_C, LINE_D, LINE_F } from "@telemicroscope/core/materials";
import { pupils } from "@telemicroscope/core/pupil";
import { systemProperties } from "@telemicroscope/core/trace";
import {
  BLANK_SURFACE,
  DEFAULT_DRAFT,
  PUPIL_RAYS_MAX,
  benchSeeds,
  clampPupilRays,
  describeBench,
  fromPrescription,
  solveParaxialFocus,
  toPrescription,
  toSystem,
  type BenchDraft,
} from "../src/editor";

/**
 * The bench editor, as invariants.
 *
 * **No engine capability was added, so no validation-ladder rung was.** Every
 * number below belongs to § 1, § 5e or § 6b and is being reached through a form.
 * What is pinned here is the thing a form can get wrong on its own: the R ↔ c
 * conversion, which is the only place this app rewrites the schema, and the two
 * refusals whose voices differ.
 *
 * The seeds carry the strongest check available to app wiring — load a design
 * the engine built, edit nothing, and the readout must be the design's own
 * numbers. If `fromPrescription`/`toPrescription` ever stop being inverses, an
 * editor would silently hand back a *different lens* than the one it was seeded
 * with, and every panel that quotes these designs would disagree with this one.
 */

const seedById = (id: string): BenchDraft => {
  const seed = benchSeeds().find((s) => s.id === id);
  if (!seed) throw new Error(`no seed ${id}`);
  return seed.draft;
};

describe("the R ↔ c conversion, which is the only rewrite of the schema", () => {
  it("round-trips every seed's prescription bit for bit in the fields the engine reads", () => {
    const originals = [
      refractorPair(500, 25).achromat,
      refractorPair(500, 25).singlet,
      cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 }).prescription,
      finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
      }).system.prescription,
    ];
    const seeds = ["achromat", "singlet", "cassegrain", "din"].map(seedById);

    for (const [i, original] of originals.entries()) {
      const back = toPrescription(seeds[i]!);
      expect(back.surfaces.length).toBe(original.surfaces.length);
      for (const [j, s] of original.surfaces.entries()) {
        const r = back.surfaces[j]!;
        expect(r.kind).toBe(s.kind);
        // Exact, not approximate: 1/(1/c) is not c in binary floating point, so
        // the conversion has to happen once in each direction and never twice.
        expect(r.curvature).toBe(s.curvature);
        expect(r.conic ?? 0).toBe(s.conic ?? 0);
        expect(r.semiAperture).toBe(s.semiAperture);
        expect(r.thickness).toBe(s.thickness);
        expect(r.medium).toBe(s.medium);
        expect(r.isStop === true).toBe(s.isStop === true);
      }
    }
  });

  it("spells a plane as R = ∞ and puts c = 0 back", () => {
    const draft = fromPrescription(
      { surfaces: [{ kind: "refract", curvature: 0, semiAperture: 10, thickness: 5, medium: "N-BK7" }] },
      { aperture: { kind: "EPD", value: 10 }, conjugate: { kind: "infinite" }, fieldValue: 0, pupilRays: 5 },
    );
    expect(draft.surfaces[0]!.radiusMm).toBe(Infinity);
    expect(toPrescription(draft).surfaces[0]!.curvature).toBe(0);
  });
});

describe("the seeded readouts are the designs' own numbers", () => {
  it("gives the achromat back its 500 mm focal length, and its colour correction", () => {
    const result = describeBench(seedById("achromat"));
    if (!result.ok) throw new Error(result.error);
    if (!result.paraxial.ok) throw new Error(result.paraxial.error);

    const d = result.paraxial.lines.find((l) => l.nm === LINE_D)!;
    // The thin-lens solve is nominal; real thicknesses move it by parts in 10³.
    expect(d.eflMm).toBeCloseTo(500, 0);
    expect(d.eflMm).toBe(systemProperties(toPrescription(seedById("achromat")), LINE_D).efl);

    // Achromatic means F and C land together — the residual is the thin-lens
    // approximation's, not a failure, and it is three orders under the singlet's.
    const singlet = describeBench(seedById("singlet"));
    if (!singlet.ok || !singlet.paraxial.ok) throw new Error("singlet has no paraxial readout");
    expect(Math.abs(result.paraxial.focalShiftMm)).toBeLessThan(
      Math.abs(singlet.paraxial.focalShiftMm) / 100,
    );
  });

  it("reads the singlet's axial colour as f/V, which is what a lens with one glass costs", () => {
    const result = describeBench(seedById("singlet"));
    if (!result.ok || !result.paraxial.ok) throw new Error("no paraxial readout");
    const f = result.paraxial.lines.find((l) => l.nm === LINE_F)!.eflMm;
    const c = result.paraxial.lines.find((l) => l.nm === LINE_C)!.eflMm;
    // N-BK7's Abbe number is 64.17: f/V ≈ 7.8 mm for f = 500, and the F line is
    // the short one.
    expect(f).toBeLessThan(c);
    expect(c - f).toBeCloseTo(500 / 64.17, 0);
  });

  it("puts the Cassegrain's image where the design says, on a chain that runs backwards", () => {
    const design = cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 });
    const result = describeBench(seedById("cassegrain"));
    if (!result.ok || !result.exact.ok) throw new Error("no exact readout");

    // Two mirrors, so the second vertex sits at −d and the image plane in front
    // of it again: the sign alternation the unfolded convention requires, read
    // straight off the compiled chain rather than asserted.
    expect(result.exact.vertexZsMm[0]).toBe(0);
    expect(result.exact.vertexZsMm[1]).toBeCloseTo(-design.primarySeparationMm, 9);
    expect(result.exact.imagePlaneZMm).toBeCloseTo(design.backFocusMm, 9);

    // A classical Cassegrain is stigmatic on axis: the spot is solver noise.
    const axis = result.exact.fields.find((f) => f.fieldValue === 0)!;
    expect(axis.rmsRadiusMm).toBeLessThan(1e-6);
    expect(axis.lost).toBe(0);
  });

  it("reads the DIN objective's image distance off the finite conjugate", () => {
    const design = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    const result = describeBench(seedById("din"));
    if (!result.ok || !result.paraxial.ok) throw new Error("no paraxial readout");
    expect(result.paraxial.imageOffsetMm).toBeCloseTo(design.imageDistanceMm, 6);
    // The chain places the image plane at exactly the paraxial focus, so the
    // seed opens already solved — unlike the two refractors, whose last
    // thickness is the round number their own doc calls a placeholder.
    expect(result.paraxial.authoredOffsetMm).toBe(result.paraxial.imageOffsetMm);
    // And the objective is solved to ΣS_I = 0 at exactly these conjugates (§ 6b),
    // which is a claim about the design that only a finite-conjugate Seidel sum
    // can check — so the editor reproducing it means the envelope is right too.
    if (!result.seidel.ok) throw new Error(result.seidel.error);
    expect(Math.abs(result.seidel.s1Mm)).toBeLessThan(1e-9);
  });
});

describe("the order of the surviving aberration, read off the aperture", () => {
  /**
   * Halving the stop divides the on-axis residual by 2^p, and p is the lowest
   * order that has NOT been corrected. This is the panel's headline and it is
   * independent of `seidelSums` — which is the point: the sum refuses conics and
   * this does not, and where both work they have to agree about the same lens.
   */
  it("measures 3 for a plain singlet and 5 for the objective whose third order is nulled", () => {
    const singlet = describeBench(solveParaxialFocus(seedById("singlet")));
    if (!singlet.ok || !singlet.order.ok) throw new Error("no order readout");
    expect(singlet.order.noiseFloor).toBe(false);
    expect(singlet.order.order).toBeCloseTo(3, 1);

    const din = describeBench(seedById("din"));
    if (!din.ok || !din.order.ok || !din.seidel.ok) throw new Error("no order readout");
    expect(din.order.order).toBeCloseTo(5, 1);
    // The other route to the same claim, on the same lens, in the same call.
    expect(Math.abs(din.seidel.s1Mm)).toBeLessThan(1e-9);
  });

  it("refuses to call float noise an order", () => {
    const result = describeBench(seedById("cassegrain"));
    if (!result.ok || !result.order.ok) throw new Error("no order readout");
    // Stigmatic on axis by construction (§ 5e), so the residual is the tracer's
    // rounding: a slope taken through it would be a number about nothing.
    expect(result.order.noiseFloor).toBe(true);
    expect(result.order.steps[0]!.rmsRadiusMm).toBeLessThan(1e-9);
    // …and the Seidel route does not even run, because a conic is outside it.
    expect(result.seidel.ok).toBe(false);
  });
});

describe("the two things a form does that a constructor never has to", () => {
  it("solves the placeholder back focus onto the paraxial image", () => {
    const before = describeBench(seedById("achromat"));
    if (!before.ok || !before.paraxial.ok) throw new Error("no paraxial readout");
    // `refractorPair` authors the last thickness as the focal length, which its
    // own doc calls a stand-in. It is 3.4 mm from where the light goes.
    expect(before.paraxial.authoredOffsetMm).toBe(500);
    expect(before.paraxial.imageOffsetMm).toBeCloseTo(496.577, 3);

    const after = describeBench(solveParaxialFocus(seedById("achromat")));
    if (!after.ok || !after.paraxial.ok || !after.exact.ok) throw new Error("no readout");
    expect(after.paraxial.authoredOffsetMm).toBe(after.paraxial.imageOffsetMm);
    // And the exact best focus is STILL not there — 95 µm short of the paraxial
    // one, which is the spherical aberration the third-order sum only predicts.
    const axis = after.exact.fields.find((f) => f.fieldValue === 0)!;
    expect(axis.bestFocusOffsetMm - after.paraxial.imageOffsetMm).toBeCloseTo(-0.095, 3);
    expect(axis.bestRmsRadiusMm).toBeLessThan(axis.rmsRadiusMm);
  });

  /**
   * Both of these are about the same thing: a control in a live form can be put
   * into a state the engine has no answer for, and neither "throw" nor "loop"
   * is an answer a panel can show. `describeBench` catches, so a refusal always
   * reaches the screen — but `solveParaxialFocus` runs inside a React state
   * updater, where a throw is a blank page, and `pupilGrid` loops n² with
   * nothing in the engine to bound it.
   */
  it("returns an unsolvable draft unchanged instead of throwing inside a state updater", () => {
    const broken: BenchDraft = { ...DEFAULT_DRAFT, surfaces: [{ ...BLANK_SURFACE, radiusMm: 0 }] };
    expect(() => solveParaxialFocus(broken)).not.toThrow();
    expect(solveParaxialFocus(broken)).toBe(broken);

    // Builds, traces, and still has no focus: a single plane is afocal, so the
    // paraxial section refuses and there is nothing to solve to.
    const afocal: BenchDraft = { ...DEFAULT_DRAFT, surfaces: [{ ...BLANK_SURFACE, isStop: true, thicknessMm: 10 }] };
    expect(solveParaxialFocus(afocal)).toBe(afocal);
    const described = describeBench(afocal);
    if (!described.ok) throw new Error(described.error);
    expect(described.paraxial.ok).toBe(false);
  });

  it("bounds the ray count, which is the one control with an unbounded loop behind it", () => {
    expect(clampPupilRays(Infinity)).toBe(15);
    expect(clampPupilRays(Number.NaN)).toBe(15);
    expect(clampPupilRays(1e9)).toBe(PUPIL_RAYS_MAX);
    expect(clampPupilRays(1)).toBe(3);
    expect(clampPupilRays(20.6)).toBe(21);
    // And the adapter clamps too, so no caller can hand the grid an infinity.
    const result = describeBench({ ...DEFAULT_DRAFT, pupilRays: Infinity });
    if (!result.ok || !result.exact.ok) throw new Error("no exact readout");
    expect(result.exact.rayCount).toBeGreaterThan(0);
    expect(result.exact.rayCount).toBeLessThan(PUPIL_RAYS_MAX ** 2);
  });

  it("pins two spellings of the same aperture landing on ONE stop radius", () => {
    // This assertion used to pin the opposite. `resolveStopRadius` read an NA as
    // a paraxial slope while the DIN objective sized its own stop with the real
    // tan u at sin u = NA, so re-spelling the seed's aperture as the NA it was
    // designed for came back 1.005037815× narrower — and this panel, being the
    // only place in the app where a reader can re-spell an aperture at all, was
    // where that became reachable. § 1.5.1 fixed the engine; what is pinned here
    // now is the agreement, from the surface that found the disagreement.
    const seed = seedById("din");
    if (seed.aperture.kind !== "stopRadius") throw new Error("the seed lost its stop radius");
    const asNA: BenchDraft = { ...seed, aperture: { kind: "objectNA", value: 0.1 } };
    const designed = seed.aperture.value;
    const respelled = pupils(toSystem(asNA), LINE_D).stopRadius;
    expect(respelled).toBeCloseTo(designed, 12);
    // The size of what was fixed, so the number does not vanish with the defect.
    //
    // It used to be read as `stopRadius / (s·sin u)` with s the specimen-to-stop
    // distance, which is 1/cos u when the stop sits on the specimen-side glass
    // and means nothing since § 6ai put it on the back focal plane — the lever
    // is a focal length now, not a working distance. So the same fact is read in
    // the form that does not care where the stop is: whatever the lever, a
    // TANGENT reading and a SINE reading of the same aperture disagree by
    // 1/cos u, so two NAs must come back in the ratio of their tangents and not
    // of their sines. At 0.1 and 0.5 those are 5.745 and 5.000 — a 15% gap that
    // no rounding can hide, where at 0.1 alone the whole defect was 0.5%.
    const radiusAtNA = (value: number): number =>
      pupils(toSystem({ ...seed, aperture: { kind: "objectNA", value } }), LINE_D).stopRadius;
    const tangentOf = (na: number) => na / Math.sqrt(1 - na * na);
    expect(radiusAtNA(0.5) / radiusAtNA(0.1)).toBeCloseTo(tangentOf(0.5) / tangentOf(0.1), 9);
    expect(radiusAtNA(0.5) / radiusAtNA(0.1)).toBeCloseTo(5.7446, 4);
    expect(Math.abs(radiusAtNA(0.5) / radiusAtNA(0.1) - 5)).toBeGreaterThan(0.7);
    // …and at the seed's own aperture the disagreement is the 1.005037815 the
    // original defect was worth, stated as the identity rather than as a lever.
    expect(tangentOf(0.1) / 0.1).toBeCloseTo(1.005037815, 9);
  });
});

describe("the two voices a refusal comes in", () => {
  it("refuses R = 0 in the app's own voice, because the engine has no error for c = ∞", () => {
    const draft: BenchDraft = {
      ...DEFAULT_DRAFT,
      surfaces: [{ ...BLANK_SURFACE, radiusMm: 0 }],
    };
    const result = describeBench(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe("app");
    expect(result.stage).toBe("build");
  });

  it("quotes the engine verbatim for an unknown glass", () => {
    const draft: BenchDraft = {
      ...DEFAULT_DRAFT,
      surfaces: [{ ...BLANK_SURFACE, medium: "UNOBTAINIUM" }],
    };
    const result = describeBench(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe("engine");
    expect(result.error).toContain("unknown medium: UNOBTAINIUM");
  });

  it("fails one section without taking the others down", () => {
    // A single plane in air: it compiles and traces, and has no focus at all.
    const draft: BenchDraft = {
      ...DEFAULT_DRAFT,
      surfaces: [{ ...BLANK_SURFACE, isStop: true, thicknessMm: 10 }],
    };
    const result = describeBench(draft);
    if (!result.ok) throw new Error(result.error);
    expect(result.paraxial.ok).toBe(false);
    if (result.paraxial.ok) return;
    expect(result.paraxial.stage).toBe("paraxial");
    expect(result.paraxial.source).toBe("engine");
    expect(result.exact.ok).toBe(true);
  });
});

describe("the pupil readout of a stop the user put behind power (§ 5s.5)", () => {
  /**
   * A diaphragm on a singlet's own back focal plane — three rows a user can type
   * into this form, and object-space telecentric. `entranceRadiusMm` is then
   * `Infinity` and the panel used to print "r = Infinity mm at z = -Infinity":
   * true, and throwing away the answer, which is that the aperture is an angle.
   */
  const singlet = (gapMm: number): BenchDraft => ({
    objectMedium: "AIR",
    surfaces: [
      { kind: "refract", radiusMm: 51.68, conic: 0, semiApertureMm: 12, thicknessMm: 4, medium: "N-BK7", isStop: false },
      { kind: "refract", radiusMm: -51.68, conic: 0, semiApertureMm: 12, thicknessMm: gapMm, medium: "AIR", isStop: false },
      { kind: "refract", radiusMm: Infinity, conic: 0, semiApertureMm: 5, thicknessMm: 100, medium: "AIR", isStop: true },
    ],
    aperture: { kind: "stopRadius", value: 5 },
    conjugate: { kind: "infinite" },
    fieldValue: 0,
    pupilRays: 9,
  });

  const BFD = systemProperties(toPrescription({ ...singlet(0), surfaces: singlet(0).surfaces.slice(0, 2) }), LINE_D).bfd;

  it("reports the slope, and only when there is no radius to report", () => {
    const at = describeBench(singlet(BFD));
    if (!at.ok) throw new Error(at.error);
    expect(at.pupil.ok).toBe(true);
    if (!at.pupil.ok) return;
    expect(at.pupil.entranceRadiusMm).toBe(Infinity);
    // The invariant, at the panel's own boundary: a radius XOR a slope.
    expect(at.pupil.entranceSlope).toBeDefined();
    expect(at.pupil.entranceSlope).toBeCloseTo(
      pupils(toSystem(singlet(BFD)), LINE_D).entrance.slopeRadius!,
      15,
    );

    // One micrometre off that plane the radius is finite again — and huge. The
    // slope field goes away with it, so the panel never shows both and never
    // shows neither.
    const off = describeBench(singlet(BFD - 0.001));
    if (!off.ok) throw new Error(off.error);
    expect(off.pupil.ok).toBe(true);
    if (!off.pupil.ok) return;
    expect(off.pupil.entranceSlope).toBeUndefined();
    expect(off.pupil.entranceRadiusMm).toBeGreaterThan(1e5);
    expect(Number.isFinite(off.pupil.entranceRadiusMm)).toBe(true);
  });

  it("an ordinary front-stopped seed keeps a radius and grows no slope", () => {
    const result = describeBench(seedById(benchSeeds()[0]!.id));
    if (!result.ok) throw new Error(result.error);
    expect(result.pupil.ok).toBe(true);
    if (!result.pupil.ok) return;
    expect(Number.isFinite(result.pupil.entranceRadiusMm)).toBe(true);
    expect(result.pupil.entranceSlope).toBeUndefined();
  });
});
