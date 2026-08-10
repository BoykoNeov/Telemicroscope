import { describe, it, expect } from "vitest";
import { plosslEyepiece, reducedEye } from "@telemicroscope/core/designs";
import { afocalTelescope } from "@telemicroscope/core/trace";
import {
  NOTICEABLE_DIOPTERS,
  buildObjective,
  describeVisual,
  measureCeiling,
  newtonianRefusal,
  renderRetina,
  type ObjectiveKind,
  type RetinaResult,
  type VisualReadout,
  type VisualSpec,
} from "../src/visual";

/**
 * C5 — visual mode on the telescope side, as invariants rather than as prose.
 *
 * **One engine fix was made for this panel** (§ 5l.1, pinned in
 * `core/test/afocal.test.ts` against § 4b's own geometry); everything else here
 * is § 5l's composition, § 5m/§ 5o's eyepieces, § 5n's real-ray afocal trace,
 * § 5p's stop selection and § 5q's reduced eye, called from the app. So no
 * ladder rung was added *for the panel*, and what is pinned below is the wiring
 * plus the five claims the panel makes that no rung states.
 *
 * 1. **The apparent field of view belongs to the eyepiece.** The object-space
 *    wall moves with the objective (it is atan(r_e/f_o)); the apparent field the
 *    observer sees does not, because the magnification carries the same f_o and
 *    the two cancel. § 5n names the AFOV *edge* as deferred — as a measurement,
 *    not as a capability, since the refusal already exists and is loud.
 * 2. **The catalogue formula is wrong in a direction.** 2·atan(r/f_e) has no
 *    trace in it, and the real chief ray leaves steeper than |M|·θ, so the field
 *    an observer actually gets is *larger*. Pincushion evaluated at the edge.
 * 3. **A Plössl's apparent field has a ceiling, and a doublet sets it.** The
 *    widest glass the form admits is D6's 0.9615248·f_e — the same constant,
 *    measured on the other panel as a length — and here it is measured as sky.
 * 4. **Accommodation is not zero, and its sign is the eyepiece's.** The paraxial
 *    image is on the retina by construction, so all of the offset is spherical
 *    aberration; on a stigmatic objective it is the eyepiece's alone.
 * 5. **The two-stop collapse is exact, and it is the trace's.** § 5q pins the
 *    closed form; what the panel adds is that the number it draws comes off the
 *    entrance pupil under `limiting` selection and never off a `Math.min`.
 */

const BASE: VisualSpec = {
  objective: "achromat",
  apertureMm: 100,
  focalRatio: 10,
  form: "plossl",
  eyepieceFocalLengthMm: 20,
  eyePupilMm: 3,
};

/** ~10 ms each, and several rungs want the same instrument. */
const cache = new Map<string, ReturnType<typeof describeVisual>>();
const at = (overrides: Partial<VisualSpec> = {}) => {
  const request = { ...BASE, ...overrides };
  const key = JSON.stringify(request);
  const hit = cache.get(key);
  if (hit) return hit;
  const made = describeVisual(request);
  cache.set(key, made);
  return made;
};
const ok = (overrides: Partial<VisualSpec> = {}): VisualReadout => {
  const made = at(overrides);
  if (!made.ok) throw new Error(`expected an instrument, got: ${made.error}`);
  return made.readout;
};

const retinaOf = (overrides: Partial<VisualSpec> = {}): RetinaResult => {
  const made = renderRetina({
    ...BASE,
    ...overrides,
    pupilSamples: 32,
    whiteFraction: 1 / 8000,
  });
  if (!("size" in made)) throw new Error(`expected a retinal image, got: ${made.error}`);
  return made;
};

describe("C5.1 — the composition is wired, and both routes are the engine's", () => {
  it("magnification by beam compression equals −f_o/f_e, and the exit pupil agrees two ways", () => {
    const r = ok();
    // § 5l's two independent routes, reached through the app's own call.
    expect(Math.abs(r.magnificationMiss)).toBeLessThan(1e-9);
    expect(Math.abs(r.exitPupilMiss)).toBeLessThan(1e-9);
    // A Keplerian pair inverts, and the panel prints the sign rather than |M|.
    expect(r.magnification).toBeLessThan(0);
    // f_o/f_e to the digit a reader checks by hand: 1000/20 = 50.
    expect(Math.abs(r.magnification)).toBeGreaterThan(49);
    expect(Math.abs(r.magnification)).toBeLessThan(51);
  });

  it("the knee IS the exit pupil, on all three objectives", () => {
    for (const objective of ["achromat", "ed", "cassegrain"] as const) {
      const r = ok({ objective });
      expect(r.irisKneeMm).toBeCloseTo(r.exitPupilDiameterMm, 12);
      // ...and equivalently |M| = D/d_eye at that pupil.
      expect(Math.abs(r.magnification)).toBeCloseTo(BASE.apertureMm / r.irisKneeMm, 6);
    }
  });
});

describe("C5.2 — the two-stop collapse, off the trace and not off a minimum", () => {
  it("the curve lands on min(D, d_eye·|M|) at every point, and flips at the knee", () => {
    const r = ok({ eyepieceFocalLengthMm: 32 });
    expect(r.apertureCurve.length).toBeGreaterThan(20);
    let sawLimited = false;
    let sawFree = false;
    for (const p of r.apertureCurve) {
      expect(p.effectiveApertureMm).toBeCloseTo(p.closedFormMm, 6);
      // `irisLimited` comes from WHICH SURFACE won `limitingStop`, not from the
      // comparison — so agreeing with the side of the knee is a real check.
      expect(p.irisLimited).toBe(p.eyePupilMm < r.irisKneeMm - 1e-9);
      if (p.irisLimited) sawLimited = true;
      else sawFree = true;
    }
    // The reachability check C4's own lesson demands: the guard must FLIP inside
    // the panel's own range, or it is a state the controls cannot reach.
    expect(sawLimited).toBe(true);
    expect(sawFree).toBe(true);
  });

  it("the collapse is visible in the retinal image, at exactly D/(d_eye·|M|)", () => {
    // § 5q pins the retinal Airy disc growing by the aperture ratio. Here it is
    // measured on the app's own frames: same optics, two irises.
    const wide = retinaOf({ eyepieceFocalLengthMm: 20, eyePupilMm: 3 });
    const narrow = retinaOf({ eyepieceFocalLengthMm: 20, eyePupilMm: 1 });
    expect(wide.irisLimited).toBe(false);
    expect(narrow.irisLimited).toBe(true);
    const apertureRatio = wide.effectiveApertureMm / narrow.effectiveApertureMm;
    expect(narrow.airyRadiusMm / wide.airyRadiusMm).toBeCloseTo(apertureRatio, 6);
    // And what it costs on the sky is the same ratio: the telescope has stopped
    // resolving what its aperture could.
    expect(narrow.airyArcsec / wide.airyArcsec).toBeCloseTo(apertureRatio, 4);
  });

  it("above the knee the picture stops changing — magnification buys nothing", () => {
    const a = retinaOf({ eyePupilMm: 3 });
    const b = retinaOf({ eyePupilMm: 7 });
    expect(a.effectiveApertureMm).toBeCloseTo(b.effectiveApertureMm, 12);
    expect(a.airyRadiusMm).toBeCloseTo(b.airyRadiusMm, 12);
    expect(a.strehl).toBeCloseTo(b.strehl, 12);
  });
});

describe("C5.3 — the apparent field belongs to the eyepiece", () => {
  it("the wall is atan(r_e/f_o), and it moves with the objective", () => {
    const near = ok({ focalRatio: 6 });
    const far = ok({ focalRatio: 15 });
    // The bisected wall lands within a couple of percent of the closed form on
    // both — under, because the closed form ignores that the chief ray reaches
    // the rim at a height slightly past f_o·tan θ through a thick group.
    for (const r of [near, far]) {
      const ratio = r.fieldWallDeg / r.fieldWallClosedFormDeg;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.0);
    }
    // A longer objective passes less sky, and by the focal ratio.
    expect(near.fieldWallDeg / far.fieldWallDeg).toBeGreaterThan(2);
  });

  it("...while the APPARENT field barely moves — aperture, ratio and f_e all cancel", () => {
    const six = [
      ok({ apertureMm: 60 }),
      ok({ apertureMm: 250 }),
      ok({ focalRatio: 6 }),
      ok({ focalRatio: 15 }),
      ok({ eyepieceFocalLengthMm: 8 }),
      ok({ eyepieceFocalLengthMm: 40 }),
    ];
    const fields = six.map((r) => r.apparentFieldOfViewDeg);
    // Six instruments spanning 4× of aperture, 2.5× of focal ratio and 5× of
    // eyepiece focal length, and the apparent field moves under 3%.
    expect(Math.max(...fields) / Math.min(...fields)).toBeLessThan(1.03);
    // The object-space walls THOSE SAME SIX were measured from spread 5×, which
    // is what makes the sentence above non-trivial rather than a tautology.
    const walls = six.map((r) => r.fieldWallDeg);
    expect(Math.max(...walls) / Math.min(...walls)).toBeGreaterThan(4);
  });

  it("on a Plössl the catalogue formula is wrong in a direction: distortion inflates the field", () => {
    const r = ok();
    expect(r.frontRimIsFieldStop).toBe(true);
    expect(r.apparentFieldOfViewDeg).toBeGreaterThan(r.geometricFieldOfViewDeg);
    expect(r.fieldInflation).toBeGreaterThan(0.15);
    expect(r.fieldInflation).toBeLessThan(0.35);
  });

  it("on a Huygens it reads the other way, and the two walls say why", () => {
    // Not distortion changing sign: the formula is pointed at the wrong glass.
    // § 5o states in prose that a Huygens' field stop sits BETWEEN its lenses,
    // so the eye lens runs out before the field lens does — and the pair of
    // numbers the panel already has is enough to detect that, with nothing in
    // the engine reporting which surface clipped.
    const h = ok({ form: "huygens" });
    expect(h.frontRimIsFieldStop).toBe(false);
    expect(h.fieldWallDeg / h.fieldWallClosedFormDeg).toBeLessThan(0.8);
    expect(h.fieldInflation).toBeLessThan(0);
    // The classifier's threshold sits in a gap, not on an edge: the two forms
    // are 0.6-ish and 0.98-ish, on every objective offered.
    for (const objective of ["achromat", "ed", "cassegrain"] as ObjectiveKind[]) {
      const plossl = ok({ objective, form: "plossl" });
      const huygens = ok({ objective, form: "huygens" });
      expect(plossl.fieldWallDeg / plossl.fieldWallClosedFormDeg).toBeGreaterThan(0.93);
      expect(huygens.fieldWallDeg / huygens.fieldWallClosedFormDeg).toBeLessThan(0.8);
    }
    // ...and the narrower usable field § 5o promises in prose is measured here.
    expect(h.apparentFieldOfViewDeg).toBeLessThan(ok().apparentFieldOfViewDeg);
  });

  it("the departure is the cubic § 5n pins, approaching ×4 per doubling near the axis", () => {
    const r = ok();
    const c = r.distortionCurve;
    // `departure` is the residual over θ, so third-order distortion makes it
    // quadruple per doubling where the fifth order is still negligible — the
    // same statement as § 5n's residual octupling, one power down.
    const pairs: number[] = [];
    for (let i = 2; i < c.length; i++) {
      const a = c[Math.floor(i / 2) - 1];
      const b = c[i - 1];
      if (!a || !b) continue;
      if (Math.abs(b.fieldDeg / a.fieldDeg - 2) > 1e-9) continue;
      pairs.push(b.departure / a.departure);
    }
    expect(pairs.length).toBeGreaterThan(4);
    // Nearest the axis it is 4 to three digits...
    expect(pairs[0]!).toBeGreaterThan(3.99);
    expect(pairs[0]!).toBeLessThan(4.02);
    // ...and it rises monotonically away from it, which is what identifies the
    // excess as the fifth-order term rather than as error (§ 5n's own companion
    // convergence rung, in the other direction).
    for (let i = 1; i < pairs.length; i++) expect(pairs[i]!).toBeGreaterThan(pairs[i - 1]!);
    expect(pairs[pairs.length - 1]!).toBeGreaterThan(4.5);
  });

  it("pincushion: the departure is positive and grows monotonically to the wall", () => {
    const c = ok().distortionCurve;
    for (const p of c) expect(p.departure).toBeGreaterThan(0);
    for (let i = 1; i < c.length; i++) expect(c[i]!.departure).toBeGreaterThan(c[i - 1]!.departure);
  });
});

describe("C5.4 — the ceiling, and the doublet that sets it", () => {
  it("a Plössl runs out of glass at D6's constant, and it is scale-free", () => {
    const twenty = measureCeiling({ ...BASE, form: "plossl", eyepieceFocalLengthMm: 20 });
    const thirtyTwo = measureCeiling({ ...BASE, form: "plossl", eyepieceFocalLengthMm: 32 });
    // D6 bisects the same refusal as a length and reports 0.9615248·f_e.
    expect(twenty.perFocalLength!).toBeCloseTo(0.9615248, 5);
    expect(thirtyTwo.perFocalLength!).toBeCloseTo(twenty.perFocalLength!, 6);
    // And the glass genuinely refuses just past it, in the engine's own voice.
    expect(() =>
      plosslEyepiece({ focalLengthMm: 20, clearApertureMm: twenty.clearApertureMm! * 1.01 }),
    ).toThrow();
  });

  it("what that glass is worth: ~61° of apparent field, inflated past the catalogue's 52°", () => {
    const c = measureCeiling({ ...BASE, form: "plossl", eyepieceFocalLengthMm: 20 });
    expect(c.apparentFieldOfViewDeg!).toBeGreaterThan(58);
    expect(c.apparentFieldOfViewDeg!).toBeLessThan(64);
    expect(c.apparentFieldOfViewDeg!).toBeGreaterThan(c.geometricFieldOfViewDeg!);
    expect(c.inflation!).toBeGreaterThan(0.1);
  });

  it("a form with no wall in range reports NO ceiling rather than the bottom of the search", () => {
    // The Huygens takes 1.5·f_e of glass without complaint. A first draft
    // returned the search's own lower bound there and printed "3° of apparent
    // field" for it, which is a search artifact presented as an eyepiece.
    const c = measureCeiling({ ...BASE, form: "huygens", eyepieceFocalLengthMm: 20 });
    expect(c.clearApertureMm).toBeNull();
    expect(c.apparentFieldOfViewDeg).toBeNull();
    expect(c.searchedToPerFocalLength).toBeGreaterThan(1);
  });
});

describe("C5.5 — accommodation, and the control that isolates whose it is", () => {
  it("a stigmatic objective leaves only the eyepiece, and both forms then ask the eye to relax", () => {
    // § 5e: a classical Cassegrain is EXACTLY stigmatic on axis, and § 5q's eye
    // is a Cartesian ellipsoid with no SA of its own for a collimated beam. So
    // what is left is the eyepiece's, and it is negative for both forms.
    for (const form of ["plossl", "huygens"] as const) {
      const r = retinaOf({ objective: "cassegrain", form, eyepieceFocalLengthMm: 16 });
      expect(r.accommodationDiopters).toBeLessThan(0);
    }
  });

  it("the achromat's own residual opposes it, and the Plössl's demand crosses zero", () => {
    const short = retinaOf({ objective: "achromat", eyepieceFocalLengthMm: 8 });
    const long = retinaOf({ objective: "achromat", eyepieceFocalLengthMm: 32 });
    const control = retinaOf({ objective: "cassegrain", eyepieceFocalLengthMm: 8 });
    // Same eyepiece, two objectives, opposite signs: the residual is a contest.
    expect(short.accommodationDiopters).toBeGreaterThan(0);
    expect(control.accommodationDiopters).toBeLessThan(0);
    // And the demand collapses toward zero as the eyepiece lengthens, so the
    // guard's quarter diopter is reachable at one end of the slider and not the
    // other — which is the reachability C4's lesson asks for.
    expect(short.accommodationDiopters).toBeGreaterThan(NOTICEABLE_DIOPTERS);
    expect(Math.abs(long.accommodationDiopters)).toBeLessThan(NOTICEABLE_DIOPTERS);
  });

  it("the demand is a length and the damage is a wave count — they run opposite ways", () => {
    // On the stigmatic control: a short eyepiece hands the iris a narrow exit
    // pupil, so it takes a big focus shift to spoil the same number of waves.
    const short = retinaOf({ objective: "cassegrain", eyepieceFocalLengthMm: 8 });
    const long = retinaOf({ objective: "cassegrain", eyepieceFocalLengthMm: 32 });
    expect(Math.abs(short.accommodationDiopters)).toBeGreaterThan(
      Math.abs(long.accommodationDiopters) * 2,
    );
    expect(short.strehl).toBeGreaterThan(long.strehl);
  });

  it("the frame is formed AT the retina, not at the plane that would flatter it", () => {
    // The panel's one deliberate break from every other picture in the app. If
    // it silently refocused, the Huygens below could not read what it reads.
    const huygens = retinaOf({ form: "huygens", eyepieceFocalLengthMm: 32 });
    expect(huygens.accommodationDiopters).toBeLessThan(-0.25);
    expect(huygens.strehl).toBeLessThan(0.5);
    const plossl = retinaOf({ form: "plossl", eyepieceFocalLengthMm: 32 });
    expect(plossl.strehl).toBeGreaterThan(0.95);
    // The offset is measured against the reduced eye's own axial length n/F,
    // which is the engine's number and not this panel's — down to the catalog's
    // VITREOUS being 1.333 rather than a tidy 4/3, which is the kind of digit a
    // hand-copied constant in an app would quietly get wrong.
    expect(huygens.retinaMm).toBeCloseTo(reducedEye({ pupilDiameterMm: 3 }).axialLengthMm, 12);
  });
});

describe("C5.6 — the objective that is not offered, and why the panel asks live", () => {
  it("a Newtonian refuses, in the engine's own words, and the panel does not paraphrase", () => {
    const eyepiece = plosslEyepiece({ focalLengthMm: 20 }).prescription;
    const message = newtonianRefusal(150, 5, eyepiece);
    expect(message).not.toBeNull();
    expect(message).toMatch(/folded chain/);
    // The unfolded mirror system it was replaced by does NOT refuse — the
    // statement is about the fold, not about mirrors.
    expect(() =>
      afocalTelescope({
        objective: buildObjective("cassegrain", 150, 5).prescription,
        eyepiece,
        wavelengthNm: 550,
      }),
    ).not.toThrow();
    // And the panel prints the engine's sentence rather than a paraphrase that
    // could drift from it: the readout carries the same string, live.
    expect(ok({ objective: "cassegrain" }).foldedObjectiveRefusal).toBe(
      newtonianRefusal(BASE.apertureMm, BASE.focalRatio, plosslEyepiece({
        focalLengthMm: BASE.eyepieceFocalLengthMm,
        clearApertureMm: 0.86 * BASE.eyepieceFocalLengthMm,
      }).prescription),
    );
  });

  it("every offered objective composes, and only the mirror carries an obstruction", () => {
    for (const objective of ["achromat", "ed", "cassegrain"] as ObjectiveKind[]) {
      const r = ok({ objective });
      expect(r.objectiveFocalLengthMm).toBeGreaterThan(0);
      if (objective === "cassegrain") expect(r.obstruction).toBeGreaterThan(0);
      else expect(r.obstruction).toBe(0);
    }
  });
});
