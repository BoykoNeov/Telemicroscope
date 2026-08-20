import { describe, expect, it } from "vitest";
import {
  apochromaticObjective,
  cassegrain,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  refractorPair,
} from "@telemicroscope/core/designs";
import { LINE_C, LINE_D, LINE_F, getMedium } from "@telemicroscope/core/materials";
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

/** § 6ar's own spec, restated here so the seed is checked against the ladder's. */
const TRIPLET_SPEC = {
  apertureMm: 5,
  focalRatio: 53 / 5,
  media: ["CAF2", "F2", "N-BK7"],
  thicknessesMm: [1.6, 1.2, 1.2],
  objectDistanceMm: 453,
} as const;

/**
 * `editor.ts`'s `radiusOf`, re-spelled rather than exported.
 *
 * Deliberate duplication: the assertion this feeds is *about* that conversion,
 * and a test that imports the function it is checking cannot catch the function
 * being wrong — it would agree with a bug by construction. Three tokens is a
 * cheap independent statement of what a plane and a reciprocal are.
 */
const radiusOf = (c: number): number => (c === 0 ? Infinity : 1 / c);

const seedById = (id: string): BenchDraft => {
  const seed = benchSeeds().find((s) => s.id === id);
  if (!seed) throw new Error(`no seed ${id}`);
  return seed.draft;
};

describe("the R ↔ c conversion, which is the only rewrite of the schema", () => {
  it("round-trips every seed's radii exactly, and its curvatures to one ulp", () => {
    const originals = [
      refractorPair(500, 25).achromat,
      refractorPair(500, 25).singlet,
      cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 }).prescription,
      finiteConjugateMicroscope({
        objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
      }).system.prescription,
      apochromaticObjective(TRIPLET_SPEC).prescription,
    ];
    const seeds = ["achromat", "singlet", "cassegrain", "din", "apochromat"].map(seedById);

    for (const [i, original] of originals.entries()) {
      const back = toPrescription(seeds[i]!);
      expect(back.surfaces.length).toBe(original.surfaces.length);
      for (const [j, s] of original.surfaces.entries()) {
        const r = back.surfaces[j]!;
        expect(r.kind).toBe(s.kind);
        // **The exact invariant is R, and it is not c.** `1/(1/c)` returns c for
        // 88% of curvatures and not for the other 12% — measured over 200k
        // values in [−0.1, 0.1] mm⁻¹ — so a curvature that goes out as a radius
        // and comes back is exact only by luck. This assertion used to be
        // `toBe`, and it passed because the four seeds before the triplet
        // carried ten non-trivial curvatures and all ten happened to survive: a
        // 0.879¹⁰ = 27.5% coin flip that came up heads. The triplet's third
        // surface is the tail, off by one ulp.
        //
        // The fix is NOT to round the seed's radii, and NOT to pick a spec that
        // survives — either would make the row on screen a lens § 6ar did not
        // trace. It is to pin what the form actually promises: a reader's typed
        // radius reaches the engine unchanged, which is `1/(1/(1/c)) === 1/c`,
        // true for every value tested and the reason a second round trip can
        // never drift further. The curvature is then within one ulp, which is
        // 7.1e−15 mm of the triplet's 53 mm EFL — one ulp of the focal length
        // too, and the same "the exactness is in the POWER" this file's header
        // makes about the solve.
        // Relative, deliberately: `toBeCloseTo(c, 15)` is an ABSOLUTE bound of
        // 0.5e-15, and these curvatures are ~5e-2, so it would wave through a
        // ten-ulp regression. One epsilon-relative step is the real bound.
        expect(Math.abs(r.curvature - s.curvature)).toBeLessThanOrEqual(
          Math.abs(s.curvature) * Number.EPSILON,
        );
        expect(radiusOf(r.curvature)).toBe(radiusOf(s.curvature));
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

  it("gives the apochromat one focal length at all three lines, and three focuses", () => {
    const design = apochromaticObjective(TRIPLET_SPEC);
    const result = describeBench(seedById("apochromat"));
    if (!result.ok || !result.paraxial.ok) throw new Error("no paraxial readout");

    // § 6ar solved the three powers on the THICK first order, so the EFL is the
    // target to solver precision — and it is the same number at F, d and C,
    // which is the whole content of "three united colours". 53 mm carries ~7e-15
    // in its last bit, and the spread across the three lines is three of those.
    for (const l of result.paraxial.lines) {
      expect(l.eflMm).toBeCloseTo(design.focalLengthMm, 12);
    }
    expect(Math.abs(result.paraxial.eflSpreadMm)).toBeLessThan(1e-12);

    // The colour that survives is therefore ENTIRELY the principal planes
    // walking with λ — a thick-lens effect the three-power split does not touch
    // — and it is 17.9 µm of back focal distance on a 53 mm lens.
    expect(result.paraxial.focusRangeMm).toBeCloseTo(0.0179116, 6);

    // And it is MONOTONIC in λ, which is what "no crossing" means here: F is the
    // long focus and C the short one with d strictly between, so the range and
    // F − C are the same number. On the two corrected doublets they are not.
    const [f, d, c] = result.paraxial.lines as [
      (typeof result.paraxial.lines)[number],
      (typeof result.paraxial.lines)[number],
      (typeof result.paraxial.lines)[number],
    ];
    expect(f.bfdMm).toBeGreaterThan(d.bfdMm);
    expect(d.bfdMm).toBeGreaterThan(c.bfdMm);
    expect(result.paraxial.focusRangeMm).toBe(result.paraxial.focalShiftMm);
  });
});

describe("the number the apochromat seed made visible", () => {
  /**
   * `focalShiftMm` is F − C, and a corrected doublet is the design that puts
   * those two together on purpose. So on exactly the lenses the readout was
   * written for, the readout reports the residual of a correction rather than
   * the focus range — and nothing on the panel said so until a lens arrived
   * whose F − C is zero for a *different* reason.
   */
  it("reads F − C small and the range large on both corrected doublets", () => {
    for (const [id, factor] of [
      ["achromat", 4.71],
      ["din", 23.94],
    ] as const) {
      const r = describeBench(seedById(id));
      if (!r.ok || !r.paraxial.ok) throw new Error(`no paraxial readout for ${id}`);
      expect(r.paraxial.focusRangeMm / Math.abs(r.paraxial.focalShiftMm)).toBeCloseTo(factor, 1);
    }

    // The control: where the colour does not cross, the two agree exactly, so
    // the new number costs a reader nothing to carry.
    for (const id of ["singlet", "apochromat"] as const) {
      const r = describeBench(seedById(id));
      if (!r.ok || !r.paraxial.ok) throw new Error(`no paraxial readout for ${id}`);
      expect(r.paraxial.focusRangeMm).toBe(Math.abs(r.paraxial.focalShiftMm));
    }
  });

  /**
   * And the ratio above is not a size — it is a quality of correction, which is
   * a different thing and worth pinning before a reader takes 24 for a lens 5×
   * worse than the one that reads 4.7. Divide the range by each lens's own EFL
   * and the two doublets are the SAME lens: what separates 4.7 from 24 is the
   * denominator, i.e. how tightly each put F and C together, not the leftover.
   */
  it("makes the two doublets one number once the focal length is divided out", () => {
    const rel = (id: string): number => {
      const r = describeBench(seedById(id));
      if (!r.ok || !r.paraxial.ok) throw new Error(`no paraxial readout for ${id}`);
      const efl = r.paraxial.lines.find((l) => l.nm === LINE_D)!.eflMm;
      return r.paraxial.focusRangeMm / Math.abs(efl);
    };

    // A 500 mm telescope objective and a 37.7 mm microscope objective at a
    // finite conjugate, landing within 4% of each other.
    const [achromat, din] = [rel("achromat"), rel("din")];
    expect(achromat).toBeCloseTo(5.295e-4, 6);
    expect(din).toBeCloseTo(5.107e-4, 6);
    expect(Math.abs(din / achromat - 1)).toBeLessThan(0.04);

    // **And what they agree ON is the glass, not each other.** Both seeds are
    // N-BK7/F2, cemented in opposite order, and a thin achromatized doublet's
    // relative secondary spectrum is that pair's own (P₁ − P₂)/(V₁ − V₂) —
    // four catalogue constants, no tracing, and the external number this rung
    // is actually pinned to. Quoting the two seeds against each other would
    // have been a claim about the code for a quantity that is a property of
    // the glasses; both sit a few percent high because the formula is thin and
    // these lenses are not.
    const p = (m: string): number => {
      const n = (nm: number) => getMedium(m).n(nm);
      return (n(LINE_D) - n(LINE_C)) / (n(LINE_F) - n(LINE_C));
    };
    const v = (m: string): number => {
      const n = (nm: number) => getMedium(m).n(nm);
      return (n(LINE_D) - 1) / (n(LINE_F) - n(LINE_C));
    };
    const pairSecondary = Math.abs(
      (p("N-BK7") - p("F2")) / (v("N-BK7") - v("F2")),
    );
    expect(pairSecondary).toBeCloseTo(4.9934e-4, 7);
    expect(achromat / pairSecondary - 1).toBeCloseTo(0.060, 2);
    expect(din / pairSecondary - 1).toBeCloseTo(0.023, 2);

    // Against that external number the third colour is worth 32% (36% against
    // the achromat seed as built) — real, and not the order of magnitude the
    // word "apochromat" advertises, because the mechanism it removes
    // (secondary spectrum) is not the one left behind (the principal planes).
    // The singlet says what BOTH corrections are worth: 29×, which is 1/V.
    const apo = rel("apochromat");
    expect(apo).toBeCloseTo(3.380e-4, 6);
    expect(apo / pairSecondary).toBeCloseTo(0.677, 2);
    expect(apo / achromat).toBeCloseTo(0.638, 2);
    expect(rel("singlet") / achromat).toBeCloseTo(29.2, 0);
    expect(rel("singlet")).toBeCloseTo(1 / v("N-BK7"), 3);
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

    // …and 5 for the apochromat too, which is the same claim reached from the
    // other branch of the engine. § 6ar nulls ΣS_I by a Newton solve on the
    // bending; this measures how a REAL traced spot shrinks as the stop halves,
    // which knows nothing about Seidel. Two designs, two constructors, one
    // exponent.
    const apo = describeBench(seedById("apochromat"));
    if (!apo.ok || !apo.order.ok || !apo.seidel.ok) throw new Error("no order readout");
    expect(apo.order.noiseFloor).toBe(false);
    expect(apo.order.order).toBeCloseTo(5, 1);
    expect(Math.abs(apo.seidel.s1Mm)).toBeLessThan(1e-9);
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

describe("the exit-pupil half of the same readout (§ 6aj)", () => {
  /**
   * The mirror image of the block above, and the asymmetry § 5s.5 left in this
   * panel on purpose. Put the stop on surface 0 and stand the singlet at its
   * FRONT focal distance and the system is image-space telecentric: the exit
   * pupil is at infinity and its aperture is an angle. The panel used to print a
   * bare `r = Infinity mm` there — or, three rows away, a plausible-looking
   * 2 659 670.894 mm — because the engine had no image-space slope.
   *
   * The lens is symmetric — radii ±51.68, so reversing it reproduces it — which
   * is why its front focal distance is the same number the entrance-side block
   * measures as a BACK focal distance, and why the two fixtures differ only in
   * which side of the glass the diaphragm sits on. It is read here from the
   * lens's own trace rather than copied across, so the fixture stops being
   * telecentric loudly if the glass ever changes.
   */
  const stopFirst = (gapMm: number): BenchDraft => ({
    objectMedium: "AIR",
    surfaces: [
      { kind: "refract", radiusMm: Infinity, conic: 0, semiApertureMm: 5, thicknessMm: gapMm, medium: "AIR", isStop: true },
      { kind: "refract", radiusMm: 51.68, conic: 0, semiApertureMm: 12, thicknessMm: 4, medium: "N-BK7", isStop: false },
      { kind: "refract", radiusMm: -51.68, conic: 0, semiApertureMm: 12, thicknessMm: 100, medium: "AIR", isStop: false },
    ],
    aperture: { kind: "stopRadius", value: 5 },
    conjugate: { kind: "infinite" },
    fieldValue: 0,
    pupilRays: 9,
  });

  const FFD = systemProperties(
    toPrescription({ ...stopFirst(0), surfaces: stopFirst(0).surfaces.slice(1) }),
    LINE_D,
  ).bfd;

  it("reports tan u′, and only when there is no radius to report", () => {
    const at = describeBench(stopFirst(FFD));
    if (!at.ok) throw new Error(at.error);
    expect(at.pupil.ok).toBe(true);
    if (!at.pupil.ok) return;
    expect(at.pupil.exitRadiusMm).toBe(Infinity);
    expect(at.pupil.exitSlope).toBeDefined();
    expect(at.pupil.exitSlope).toBeCloseTo(pupils(toSystem(stopFirst(FFD)), LINE_D).exit.slopeRadius!, 15);
    // The entrance pupil of the same system is the stop itself — ordinary, with
    // a radius and no slope. The two halves of the invariant are independent.
    expect(at.pupil.entranceRadiusMm).toBe(5);
    expect(at.pupil.entranceSlope).toBeUndefined();
  });

  it("one micrometre off that plane the radius is finite again — and enormous", () => {
    // This is the reading the slope does NOT rescue, and the reason the panel's
    // large-radius note survives this step instead of being retired with the
    // rest of § 5s.5's exit-side text.
    const off = describeBench(stopFirst(FFD - 0.001));
    if (!off.ok) throw new Error(off.error);
    expect(off.pupil.ok).toBe(true);
    if (!off.pupil.ok) return;
    expect(off.pupil.exitSlope).toBeUndefined();
    expect(Number.isFinite(off.pupil.exitRadiusMm)).toBe(true);
    expect(off.pupil.exitRadiusMm).toBeGreaterThan(1e5);
  });

  it("an ordinary front-stopped seed keeps a radius and grows no exit slope either", () => {
    const result = describeBench(seedById(benchSeeds()[0]!.id));
    if (!result.ok) throw new Error(result.error);
    expect(result.pupil.ok).toBe(true);
    if (!result.pupil.ok) return;
    expect(Number.isFinite(result.pupil.exitRadiusMm)).toBe(true);
    expect(result.pupil.exitSlope).toBeUndefined();
  });
});
