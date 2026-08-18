import { describe, it, expect } from "vitest";
import { abbeCondenser } from "../src/designs/condenser";
import { systemProperties } from "../src/trace/paraxial";
import { collimatingObjectDistance } from "../src/trace/compose";
import { makeRay } from "../src/trace/ray";
import { traceRay } from "../src/trace/sequential";
import { getMedium } from "../src/materials/catalog";
import { LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";

/**
 * Step 6af — the condenser is a lens.
 *
 * § 6x's last deferral, and its first half. Everything the illumination branch
 * has done since § 6f models the condenser as a set of DIRECTIONS, which is
 * exact for Köhler illumination and is where partial coherence lives — so it is
 * not being replaced. What it cannot express is § 6x's own sentence: *"the cone
 * is translated rigidly; a real condenser's cone also changes shape off axis,
 * which is a second trace this step does not run."* That trace needs a condenser
 * to run through, and `designs/` had none. This step is the lens; turning its
 * cone into a `CondenserSource` is the next one.
 *
 * ## Why the uncorrected form, and why that decision came before any glass
 *
 * `designs/immersion` already holds the pieces of a *good* condenser, and using
 * them would have been the obvious move and the wrong one: an aplanat has zero
 * spherical aberration and zero coma by construction, so its cone barely
 * deforms and the subject would have been designed away — § 6x's own trap about
 * defaulting the DIN telecentric, one module over. The Abbe form is the right
 * subject BECAUSE it is uncorrected.
 *
 * ## What is external here
 *
 * Two published closed forms, and the step is arranged so each is sharp:
 *
 *  - **Coddington's thin-lens spherical polynomial** in shape factor q and
 *    position factor p, the same one § 5j.1 and § 6b pin. It is quoted here at
 *    q = −1, and the plano-convex shape is what makes the rung *discriminate p*:
 *    the polynomial's only odd term is `4(n+1)·p·q`, so at q = 0 an equiconvex
 *    element reads the same under p = +1 and p = −1 and the pin would be blind
 *    to the very conjugate this lens is used at.
 *  - **The Abbe number's own linearization error.** `f_C − f_F = f_d/V` is the
 *    familiar form and is first-order; the exact ratio is
 *    `(n_d−1)²/((n_C−1)(n_F−1))`, and on a single element the trace lands on the
 *    exact one to nine digits while the familiar one misses by 0.591%.
 *
 * ## What is NOT pinned to an external number, and is not pretending to be
 *
 * The design itself. Nobody publishes "the" Abbe condenser prescription, and a
 * two-element plano-convex pair solved for a focal length is a *representative*
 * uncorrected condenser rather than a reproduction of a catalogued one. What is
 * pinned is everything that can be: the solve against its own target, the
 * aberration against a published polynomial in the thin limit, the chromatic
 * shift against the glass's own dispersion, and the Köhler property against the
 * construction that is supposed to produce it.
 */

const L = LINE_D;

/** The published thin-lens bracket in Coddington's q and the position factor p. */
const bracket = (n: number, q: number, p: number): number =>
  ((n + 2) / (n - 1)) * q * q +
  4 * (n + 1) * p * q +
  (3 * n + 2) * (n - 1) * p * p +
  (n * n * n) / (n - 1);

/**
 * One ray from diaphragm point `xd`, aimed at height `aim` on the condenser's
 * first vertex: where it reaches the specimen plane, and with what slope.
 *
 * Launched from a plane BEFORE the diaphragm rather than on it — a ray starting
 * exactly on surface 0 meets it at t = 0, which the tracer reads as a miss. The
 * launch point is walked back along the same line, so it is the same ray.
 */
function shoot(
  c: ReturnType<typeof abbeCondenser>,
  xd: number,
  aim: number,
): { h: number; slope: number } | null {
  const dz = c.frontFocalDistanceMm;
  const dx = aim - xd;
  const norm = Math.hypot(dx, dz);
  const ux = dx / norm;
  const uz = dz / norm;
  const back = 1;
  const r = makeRay({ x: xd - (ux * back) / uz, y: 0, z: -back }, { x: ux, y: 0, z: uz }, L);
  const t = traceRay(c.prescription, r);
  if (t.status !== "ok" || !t.ray) return null;
  const slope = t.ray.dir.x / t.ray.dir.z;
  const zSpecimen = c.prescription.surfaces.reduce((z, s) => z + s.thickness, 0);
  return { h: t.ray.origin.x + slope * (zSpecimen - t.ray.origin.z), slope };
}

/**
 * The illumination direction (as a slope) that diaphragm point `xd` sends to the
 * SPECIMEN point at height `yTarget` — solved by bisecting on the aim, because
 * that is the ray a source builder actually needs and it is not the ray aimed at
 * the same height on the glass. Parametrizing by the aim instead loses rays at
 * the field edge that the lens in fact passes, which is a fixture artefact and
 * would have been read as vignetting.
 */
function slopeTo(
  c: ReturnType<typeof abbeCondenser>,
  xd: number,
  yTarget: number,
): number | null {
  // Each end of the bracket is walked IN independently until it traces: an aim at
  // the glass rim is steeper than any ray the specimen circle needs and is
  // legitimately lost, and shrinking both ends together would throw away the
  // reachable side with the unreachable one.
  const find = (sign: 1 | -1): { aim: number; h: number } | null => {
    for (let a = c.glassSemiDiameterMm * 0.999; a > 1e-4; a *= 0.97) {
      const f = shoot(c, xd, sign * a);
      if (f) return { aim: sign * a, h: f.h };
    }
    return null;
  };
  const lower = find(-1);
  const upper = find(1);
  if (!lower || !upper) return null;
  if ((lower.h - yTarget) * (upper.h - yTarget) > 0) return null;
  let lo = lower.aim;
  let hi = upper.aim;
  let hLo = lower.h;
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    const f = shoot(c, xd, mid);
    if (!f) return null;
    if ((hLo - yTarget) * (f.h - yTarget) <= 0) {
      hi = mid;
    } else {
      lo = mid;
      hLo = f.h;
    }
  }
  return shoot(c, xd, 0.5 * (lo + hi))!.slope;
}

const tanOf = (na: number) => na / Math.sqrt(1 - na * na);

describe("§ 6af.1 — the solve, and the one freedom it spends", () => {
  it("delivers the focal length asked for, at both element counts and four lengths", () => {
    // Solved on the TRACED paraxial chain, not from the thin-lens maker's
    // equation — so the element thicknesses are in the answer and the closed form
    // stays free to be an external pin below.
    for (const elements of [1, 2] as const) {
      for (const focalLengthMm of [5, 10, 20, 40]) {
        const c = abbeCondenser({ numericalAperture: 0.3, focalLengthMm, elements });
        expect(c.paraxialFocalLengthMm).toBeCloseTo(focalLengthMm, 8);
        expect(systemProperties(c.glass, L).efl).toBe(c.paraxialFocalLengthMm);
      }
    }
  });

  it("is plano-convex at shape factor −1 identically, which is not a freedom", () => {
    for (const focalLengthMm of [5, 20]) {
      const c = abbeCondenser({ numericalAperture: 0.3, focalLengthMm });
      expect(c.shapeFactor).toBe(-1);
      // Flat toward the lamp, convex toward the specimen: c₁ = 0 on every first
      // face and the same negative curvature on every second.
      const s = c.glass.surfaces;
      expect(s.map((x) => x.curvature)).toEqual([0, -1 / c.radiusMm, 0, -1 / c.radiusMm]);
    }
  });

  it("carries exactly one stop, and it is the diaphragm at surface 0", () => {
    const c = abbeCondenser({ numericalAperture: 0.3 });
    const flags = c.prescription.surfaces.map((s, i) => (s.isStop ? i : -1)).filter((i) => i >= 0);
    expect(flags).toEqual([0]);
    expect(c.stopSurfaceIndex).toBe(0);
    expect(c.prescription.surfaces[0]!.semiAperture).toBe(c.diaphragmRadiusMm);
    // The trailing thickness is the working distance, so the prescription's image
    // plane IS the specimen plane and nothing downstream has to add it.
    const last = c.prescription.surfaces[c.prescription.surfaces.length - 1]!;
    expect(last.thickness).toBe(c.workingDistanceMm);
  });

  it("refuses what it cannot build, and says which input to change", () => {
    expect(() => abbeCondenser({ numericalAperture: 0 })).toThrow(/NA must lie in/);
    expect(() => abbeCondenser({ numericalAperture: 1 })).toThrow(/NA must lie in/);
    expect(() => abbeCondenser({ numericalAperture: 0.3, focalLengthMm: 0 })).toThrow(
      /focal length must be positive/,
    );
    expect(() => abbeCondenser({ numericalAperture: 0.3, workingDistanceMm: 0 })).toThrow(
      /working distance must be positive/,
    );
    // Thick elements against a short focal length go afocal before they reach it,
    // and `systemProperties` refuses an afocal chain from inside the bisection —
    // which without this branch surfaced as "afocal system: no finite focus",
    // true and useless. The refusal now names the three inputs that made it.
    expect(() =>
      abbeCondenser({ numericalAperture: 0.3, focalLengthMm: 4, elementThicknessMm: 6 }),
    ).toThrow(/no radius gives a 4 mm focal length with 2 × 6 mm of glass/);
  });
});

describe("§ 6af.2 — EXTERNAL: Coddington's polynomial, and why the shape is plano-convex", () => {
  const n = getMedium("N-BK7").n(L);

  it("converges onto the published form as the element thins, LINEARLY in thickness", () => {
    // The element this constructor ships is 2.5 mm of glass on a 10 mm focal
    // length — a quarter of its own focal length — so the thin-lens form does not
    // describe it and is not expected to. What is pinned is the limit and the way
    // it is approached: the departure is linear in the thickness, 0.247 per mm.
    const ratios: { t: number; ratio: number }[] = [];
    for (const t of [2.5, 1, 0.25, 0.05, 0.01]) {
      const c = abbeCondenser({ numericalAperture: 0.3, elements: 1, elementThicknessMm: t });
      const h = c.fieldRadiusMm;
      const predicted =
        (h ** 4 / (32 * c.paraxialFocalLengthMm ** 3 * n * (n - 1))) * bracket(n, -1, 1);
      ratios.push({ t, ratio: c.fieldBeamW040Mm / predicted });
    }
    expect(ratios[0]!.ratio).toBeCloseTo(1.968, 2);
    expect(ratios[4]!.ratio).toBeCloseTo(1.0025, 3);
    // Monotone, and the departure proportional to the thickness.
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]!.ratio).toBeLessThan(ratios[i - 1]!.ratio);
    }
    // 0.2568 at a quarter millimetre, 0.248 at 0.05 and 0.247 at 0.01 — the slope
    // itself converging, which is what a leading-order departure looks like.
    for (const { t, ratio } of ratios.slice(3)) {
      expect((ratio - 1) / t).toBeCloseTo(0.247, 2);
    }
  });

  it("and the rung DISCRIMINATES the position factor, which q = 0 could not", () => {
    // The reason the elements are plano-convex rather than equiconvex, and it is
    // about the pin rather than about the lens. The polynomial's only term odd in
    // p is `4(n+1)·p·q`, so at q = 0 the p = +1 and p = −1 readings are identical
    // and the rung above would pass under either — while this condenser is
    // emphatically a p = +1 lens (its image is at infinity, its object is not).
    expect(bracket(n, 0, 1)).toBe(bracket(n, 0, -1));
    expect(bracket(n, -1, 1) / bracket(n, -1, -1)).toBeCloseTo(0.2546, 3);
    const c = abbeCondenser({ numericalAperture: 0.3, elements: 1, elementThicknessMm: 0.01 });
    const h = c.fieldRadiusMm;
    const at = (p: number) =>
      (h ** 4 / (32 * c.paraxialFocalLengthMm ** 3 * n * (n - 1))) * bracket(n, -1, p);
    expect(c.fieldBeamW040Mm / at(1)).toBeCloseTo(1, 2);
    expect(c.fieldBeamW040Mm / at(-1)).toBeLessThan(0.3);
  });

  it("and the aberration is LARGE — which is the whole point of the form", () => {
    // 8.5e-3 mm of W₀₄₀ at the d line is 14.4 waves. A condenser is not a lens
    // anyone corrected, and the number is here so "the condenser's own
    // aberrations" has a size rather than an adjective.
    const c = abbeCondenser({ numericalAperture: 0.3 });
    expect(c.fieldBeamW040Mm).toBeCloseTo(8.464e-3, 5);
    expect(c.fieldBeamW040Mm / (L * 1e-6)).toBeGreaterThan(14);
  });

  it("…and it is BITWISE aperture-free, which is Köhler illumination and not an oversight", () => {
    // Asserted rather than left to be noticed. The rung above pins a number that
    // does not respond to the NA stated in the same call, and a reader is owed
    // the reason: every diaphragm point lights the whole field with one beam, so
    // that beam's width at the glass is the FIELD's and closing the diaphragm
    // never narrows it. What the aperture does move is the ANGLE the beams leave
    // at, and that is § 6af.5's measurement, which goes as NA².
    //
    // The habit this rung comes from: before quoting what a change buys, check
    // the readout responds to it. Here it must not, and saying so is the rung.
    const w = [0.6, 0.3, 0.1, 0.05].map((na) => abbeCondenser({ numericalAperture: na }).fieldBeamW040Mm);
    for (const x of w) expect(x).toBe(w[0]!);
    // …while the FIELD does move it, as h⁴ — so it is not simply a constant.
    const wide = abbeCondenser({ numericalAperture: 0.3, fieldRadiusMm: 4.5 });
    const narrow = abbeCondenser({ numericalAperture: 0.3, fieldRadiusMm: 2.25 });
    expect(wide.fieldBeamW040Mm / narrow.fieldBeamW040Mm).toBeCloseTo(16, 5);
  });
});

describe("§ 6af.3 — EXTERNAL: the chromatic shift, and the Abbe number's own linearization error", () => {
  it("lands on the EXACT dispersion ratio to nine digits, where f/V misses by 0.591%", () => {
    const glass = getMedium("N-BK7");
    const nd = glass.n(L);
    const nF = glass.n(LINE_F);
    const nC = glass.n(LINE_C);
    const V = (nd - 1) / (nF - nC);
    const c = abbeCondenser({ numericalAperture: 0.3, elements: 1 });
    const efl = (nm: number) => systemProperties(c.glass, nm).efl;

    const measured = (efl(LINE_C) - efl(LINE_F)) / (efl(L) / V);
    // The familiar `Δf = f/V` is the first-order form. Carrying the same algebra
    // without expanding gives the ratio below, and the trace agrees with it to
    // f64 — so the 0.591% is not the lens, the tracer or the glass table: it is
    // the linearization inside the Abbe number's usual spelling.
    const exact = ((nd - 1) * (nd - 1)) / ((nC - 1) * (nF - 1));
    expect(measured).toBeCloseTo(exact, 9);
    expect(1 - exact).toBeCloseTo(0.00591, 5);
  });

  it("…and the two-element pair does NOT follow it, because a gap is a second freedom", () => {
    // A separated pair has a chromatic law of its own — the gap contributes, and
    // this condenser's gap is not chosen to help. 4.5% away from the single
    // element's exact ratio, which is a finding rather than a discrepancy: it is
    // the freedom an achromatic condenser spends and this one does not.
    const glass = getMedium("N-BK7");
    const V = (glass.n(L) - 1) / (glass.n(LINE_F) - glass.n(LINE_C));
    const c = abbeCondenser({ numericalAperture: 0.3, elements: 2 });
    const efl = (nm: number) => systemProperties(c.glass, nm).efl;
    const measured = (efl(LINE_C) - efl(LINE_F)) / (efl(L) / V);
    expect(measured).toBeCloseTo(0.9498, 3);
  });
});

describe("§ 6af.4 — the diaphragm at the front focal plane IS Köhler illumination", () => {
  it("sits exactly where the group collimates", () => {
    for (const focalLengthMm of [5, 10, 20]) {
      const c = abbeCondenser({ numericalAperture: 0.3, focalLengthMm });
      expect(c.frontFocalDistanceMm).toBe(collimatingObjectDistance(c.glass, L));
      expect(c.prescription.surfaces[0]!.thickness).toBe(c.frontFocalDistanceMm);
    }
  });

  it("so the AXIAL diaphragm point sends a direction that is exactly zero on axis", () => {
    // `illumination/source`'s premise — one direction per diaphragm point — read
    // off a real lens for the first time. Exactly 0 rather than nearly: the ray
    // from the axial point to the axial field point is the axis itself.
    const c = abbeCondenser({ numericalAperture: 0.3 });
    // Aimed straight down the axis rather than bisected onto it: this ray IS the
    // axis, so the zero is the construction's and not a solver residual.
    expect(shoot(c, 0, 0)!.slope).toBe(0);
    expect(shoot(c, 0, 0)!.h).toBe(0);
  });

  it("and the diaphragm radius is `f·tan u`, so its rim names the illumination NA", () => {
    for (const na of [0.1, 0.3, 0.6]) {
      const c = abbeCondenser({ numericalAperture: na });
      expect(c.diaphragmRadiusMm).toBe(Math.abs(c.paraxialFocalLengthMm) * tanOf(na));
    }
  });
});

describe("§ 6af.5 — what the condenser's aberration DOES to the cone it sends", () => {
  /**
   * The two natural readings of "the direction diaphragm point `xd` sends",
   * both as a fraction of the paraxial construction's answer.
   *
   * `viaVertex` is the ray through the condenser's front vertex — the one a
   * paraxial argument is really about. `ontoAxis` is the ray that actually
   * arrives at the specimen point being lit. On a perfect condenser they are the
   * same ray's direction; on this one they are not, and the gap between them IS
   * the aberration.
   */
  const readings = (na: number, rho = 0.999) => {
    const c = abbeCondenser({ numericalAperture: na });
    const xd = c.diaphragmRadiusMm * rho;
    const paraxial = rho * tanOf(na);
    return {
      viaVertex: -shoot(c, xd, 0)!.slope / paraxial,
      ontoAxis: -slopeTo(c, xd, 0)! / paraxial,
    };
  };

  it("THE MEASUREMENT: the two readings of one direction are 11.5% apart at NA 0.30", () => {
    // The sharpest form of what an uncorrected condenser does to the model
    // `illumination/source` rests on. "One direction per diaphragm point" is a
    // sentence about a lens with no spherical aberration; on a real one the ray
    // through the vertex and the ray that reaches the specimen point leave at
    // measurably different angles, and neither is the paraxial value — they
    // STRADDLE it, 5.7% short and 5.8% long.
    //
    // So a source builder does not get to leave "the direction" unstated. The
    // ray that reaches the specimen point being lit is the physically right
    // choice for a per-patch source; this rung is what says the choice matters.
    const r = readings(0.3);
    expect(r.viaVertex).toBeCloseTo(0.9433, 3);
    expect(r.ontoAxis).toBeCloseTo(1.0582, 3);
    expect(r.viaVertex).toBeLessThan(1);
    expect(r.ontoAxis).toBeGreaterThan(1);
    expect(r.ontoAxis - r.viaVertex).toBeCloseTo(0.1149, 3);
  });

  it("and the ambiguity closes as NA², a clean factor of four per halving", () => {
    const spreads = [0.3, 0.2, 0.1, 0.05, 0.025, 0.0125].map((na) => {
      const r = readings(na);
      return r.ontoAxis - r.viaVertex;
    });
    expect(spreads[2]!).toBeCloseTo(0.01135, 4);
    for (let i = 3; i < spreads.length; i++) {
      expect(spreads[i - 1]! / spreads[i]!).toBeGreaterThan(3.9);
      expect(spreads[i - 1]! / spreads[i]!).toBeLessThan(4.2);
    }
  });

  it("THE CONTROL: the aberration-free limit is reached, and both readings meet there", () => {
    // Not a second design — § 6ae.5's shape. The lens is the same; the aperture
    // is what goes to zero, and with it everything this step measures. Both
    // readings land on the paraxial construction to 1e-4, which is what makes the
    // 11.5% above an aberration and not a fixture.
    const r = readings(0.0125);
    expect(r.viaVertex).toBeCloseTo(1, 3);
    expect(r.ontoAxis).toBeCloseTo(1, 3);
    expect(r.ontoAxis - r.viaVertex).toBeLessThan(2e-4);
  });

  it("THE FINDING: the cone TRANSLATES and STRETCHES, and § 6x can only say the first", () => {
    // § 6x displaces the cone rigidly by `h/R_ep`. Here the cone's centre and its
    // rim walk by DIFFERENT amounts over the same field, so its radius changes
    // too — 2.2% of S over 2.25 mm — and no rigid translation can express that.
    // Read at the illumination aperture a DIN 4×/0.10 actually uses, in units of
    // that objective's own pupil radius.
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const tanU = tanOf(0.1);
    const at = (rho: number, y: number) => slopeTo(c, c.diaphragmRadiusMm * rho, y)! / tanU;
    const centreWalk = Math.abs(at(0, 2.25) - at(0, 0));
    const rimWalk = Math.abs(at(0.999, 2.25) - at(0.999, 0));
    expect(centreWalk).toBeCloseTo(0.0428, 3);
    expect(rimWalk).toBeCloseTo(0.065, 2);
    // The stretch is the difference, and it is a fifth of the translation rather
    // than a rounding of it — which is why the second trace was worth running.
    expect(rimWalk - centreWalk).toBeCloseTo(0.0222, 3);
    expect((rimWalk - centreWalk) / centreWalk).toBeGreaterThan(0.4);
  });

  it("the glass passes the whole field it was sized for, from every diaphragm point", () => {
    // The condenser's counterpart to § 6w: every diaphragm point's beam covers
    // the entire specimen circle, so the glass has to be at least the field wide
    // however small the aperture is.
    for (const na of [0.1, 0.3]) {
      const c = abbeCondenser({ numericalAperture: na });
      expect(c.glassSemiDiameterMm).toBeGreaterThan(c.fieldRadiusMm);
      for (const rho of [0, 0.5, 0.999]) {
        for (const y of [0, 1, c.fieldRadiusMm]) {
          expect(slopeTo(c, c.diaphragmRadiusMm * rho, y)).not.toBeNull();
        }
      }
    }
  });
});
