import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import { paraxialTrace, systemProperties } from "../src/trace/paraxial";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";
import { pupils } from "../src/pupil/pupils";
import { paraxialImageOffset } from "../src/analysis/focus";
import {
  cartesianTubeLens,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
  type InfinityCorrectedObjective,
} from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import {
  imageNumericalAperture,
  lateralMagnification,
  objectNumericalAperture,
  sineConditionResidual,
} from "../src/pupil/microscope";
import { imageSpaceMarginalSin } from "../src/imaging/exposure";
import { depthOfFocusMm } from "../src/imaging/emission";
import { psf, radialProfile, type Psf } from "../src/wave/psf";

/**
 * § 2h — the image in glass behind an objective: both indices at once.
 *
 * § 2g formed an image inside glass, but from an object at infinity in air, so
 * only ONE index was ever away from 1. § 6e put the specimen in a medium, but its
 * tube lens forms the image in air, so again only one. Every two-index law —
 * where object space carries n and image space carries n′, and the answer
 * depends on n′/n — had never been asked of the engine. This step composes the
 * two: § 6e's oil objective (and § 6a's dry one, as the n = 1 column) in front of
 * § 2g's Cartesian ellipsoid, cut as a tube lens that forms the image inside
 * N-BK7 or F2.
 *
 * ## The hypothesis, and the number that refutes it
 *
 * The engine reads object-space quantities with the object medium's index and
 * image-space ones with the exit medium's, independently — so the laws with
 * both in them hold without anyone having written them. Refuted by any one of:
 * the longitudinal magnification reading M² or (n/n′)·M² instead of (n′/n)·M²
 * (6.3% and 13% apart on the oil/F2 cell); the magnification moving with the
 * back's glass; a sine residual of ≈ n′ − 1 (62% on F2) instead of the
 * objective's own 0.9%; the Airy ring in mm moving with n′ at a fixed NA′.
 *
 * What it found is the step's engine change: `systemProperties.efl` returned
 * −y/u′, the image-side focal DISTANCE n′/Φ, under the EFL's name. In air the
 * two are one number. The one earlier rung with an image in a medium, § 6aj.4 in
 * water, pinned that meaning bitwise instead of catching it, and is restated.
 *
 * ## The two-index laws, derived here rather than cited
 *
 * **Effective focal length.** The power of the back is Φ = (n′ − 1)/R, and the
 * reduced slope is what power bends: n′·u′ = −y·Φ for a parallel ray. So the EFL
 * 1/Φ is −y/(n′·u′), and the back focal distance, a length on the axis, is
 * −y/u′ = n′/Φ. Descartes' far focus at n′·R/(n′ − 1) is that second number.
 *
 * **Magnification.** A ray leaving the specimen (in index n) at slope u from the
 * objective's front focus emerges at height h = F_obj·n·u — a statement about
 * reduced slopes, the only kind the paraxial invariant conserves. The back turns
 * it to n′·u′ = −h/F_tube. Lagrange, n·y·u = n′·y′·u′, then gives
 * M = n·u/(n′·u′) = −F_tube/F_obj, with BOTH indices cancelled.
 *
 * **Longitudinal magnification.** Newton's equation with the object- and
 * image-side focal lengths f = n·F and f′ = n′·F: z·z′ = f·f′ and m = −f/z.
 * Move the specimen from z₁ to z₂ and the image moves by
 * f·f′·(1/z₂ − 1/z₁), so Δz′/Δz = (f′/f)·m₁·m₂ = (n′/n)·m₁·m₂ — exact for a
 * finite step, with no derivative to approximate. It goes to (n′/n)·M² as the
 * step shrinks; the index ratio is the whole content.
 *
 * **Depth of focus.** DOF = n·λ/NA² on each side in its own medium (§ 6j), and
 * NA = |M|·NA′ by the sine condition: DOF′/DOF = (n′/n)·M², the longitudinal
 * magnification again. So a defocus measured in depths of focus is the same
 * number on both sides — emission.ts's claim, which § 6j.3 checked only where
 * n = n′ = 1.
 */

const L = LINE_D;
const GLASSES = ["N-BK7", "F2"] as const;
const index = (medium: string): number => getMedium(medium).n(L);

const dry = (): InfinityCorrectedObjective =>
  microscopeObjective({ magnification: 4, numericalAperture: 0.1 });
const oil = (): InfinityCorrectedObjective =>
  oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 });
const OBJECTIVES = { dry, oil } as const;

const scope = (objective: InfinityCorrectedObjective, glass: string) =>
  infinityCorrectedMicroscope({
    objective,
    tubeLens: cartesianTubeLens({ medium: glass }),
    objectHeightsMm: [0],
  });

/** n of the specimen's medium — read off the system, never typed in. */
const objectIndex = (s: OpticalSystem): number =>
  getMedium(s.prescription.objectMedium ?? "AIR").n(L);

/**
 * The paraxial image of the specimen at `distanceMm` in front of surface 0: its
 * offset behind the last vertex, and the lateral magnification there. The
 * magnification is a ray from object height 1 at zero slope, run to that plane.
 */
function paraxialConjugate(s: OpticalSystem, distanceMm: number): { offset: number; m: number } {
  const at: OpticalSystem = { ...s, conjugate: { kind: "finite", distance: distanceMm } };
  const offset = paraxialImageOffset(at, L);
  const last = s.prescription.surfaces.length - 1;
  const toImage = {
    ...s.prescription,
    surfaces: s.prescription.surfaces.map((x, i) => (i === last ? { ...x, thickness: offset } : x)),
  };
  return { offset, m: paraxialTrace(toImage, L, { y: 1, u: 0 }).y };
}

/** Longitudinal magnification over a specimen step of `deltaMm` toward the lens. */
function longitudinal(s: OpticalSystem, distanceMm: number, deltaMm: number) {
  const a = paraxialConjugate(s, distanceMm);
  const b = paraxialConjugate(s, distanceMm - deltaMm);
  return { ratio: (b.offset - a.offset) / deltaMm, m1: a.m, m2: b.m };
}

/** First dark ring of the radial profile, to sub-pixel — § 2b's helper, as § 2g. */
function firstMinimumPixels(p: Psf): number {
  const { radius, mean } = radialProfile(p, p.size / 2);
  let peak = 0;
  for (const v of mean) if (v > peak) peak = v;
  for (let i = 1; i < mean.length - 1; i++) {
    if (mean[i]! < peak * 0.02 && mean[i]! < mean[i - 1]! && mean[i]! <= mean[i + 1]!) {
      const a = mean[i - 1]!;
      const b = mean[i]!;
      const c = mean[i + 1]!;
      const denom = a - 2 * b + c;
      const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      return radius[i]! + shift * (radius[1]! - radius[0]!);
    }
  }
  throw new Error("no dark ring found in the radial profile");
}

describe("§ 2h.1 — the back: its EFL is 1/Φ, and its focus is n′ times further", () => {
  it.each(GLASSES)("in %s the EFL is 200 mm and the back focal distance n′·200", (glass) => {
    const back = cartesianTubeLens({ medium: glass });
    const n = index(glass);
    const props = systemProperties(back.prescription, L);
    // Φ = (n′ − 1)/R with R = F·(n′ − 1): the EFL is F by construction.
    expect(Math.abs(props.efl / 200 - 1)).toBeLessThan(1e-12);
    expect(back.paraxialFocalLengthMm).toBe(props.efl);
    // The far focus is a LENGTH, n′·F behind the vertex — Descartes' n′R/(n′ − 1).
    expect(Math.abs(props.bfd / (n * 200) - 1)).toBeLessThan(1e-12);
    // NEGATIVE CONTROL: the old reading, −y/u′, is this distance — off by n′.
    expect(props.bfd / props.efl).toBeGreaterThan(1.5);
    expect(Math.abs(props.bfd / props.efl / n - 1)).toBeLessThan(1e-12);
  });

  it("an air image is untouched: the doublet tube lens reads the same EFL as its own trace", () => {
    // |n′| = 1 multiplies u′ to the bit, so every air reading on the ladder stands.
    const doublet = tubeLens({ focalLengthMm: 200 });
    const out = paraxialTrace(doublet.prescription, L, { y: 1, u: 0 });
    expect(systemProperties(doublet.prescription, L).efl).toBe(-1 / out.u);
  });

  it.each(
    (Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[]).flatMap((o) =>
      GLASSES.map((g) => [o, g] as const),
    ),
  )("behind the %s objective, the %s back puts the image at n′·F, and the exit pupil is in the glass", (o, glass) => {
    const sc = scope(OBJECTIVES[o](), glass);
    const n = index(glass);
    // The specimen sits on the objective's front focus, so the beam is collimated
    // into the back and the image is the back's own far focus.
    expect(Math.abs(sc.imageDistanceMm / (n * 200) - 1)).toBeLessThan(1e-12);
    expect(paraxialImageOffset(sc.system, L)).toBe(sc.imageDistanceMm);
    expect(pupils(sc.system, L).exit.n).toBe(n);
  });
});

describe("§ 2h.2 — the magnification is −F_tube/F_obj, and blind to the back's glass", () => {
  it.each(Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[])(
    "%s: the paraxial M is the EFL ratio, the same in N-BK7 and F2",
    (o) => {
      const objective = OBJECTIVES[o]();
      const fObj = systemProperties(objective.prescription, L).efl;
      const ms = GLASSES.map((g) => {
        const sc = scope(objective, g);
        return paraxialConjugate(sc.system, sc.objectDistanceMm).m;
      });
      for (const m of ms) expect(Math.abs(m / (-200 / fObj) - 1)).toBeLessThan(1e-12);
      // NEGATIVE CONTROL: the back focal distance in place of the EFL claims
      // n′ times the magnification — 1.52× and 1.62× of what the trace delivers.
      for (const g of GLASSES) {
        const bfd = systemProperties(cartesianTubeLens({ medium: g }).prescription, L).bfd;
        expect(bfd / fObj / Math.abs(ms[0]!)).toBeGreaterThan(1.5);
      }
    },
  );

  it("on the real chief ray the oil 100× reads −100 through either glass, to 1e-8", () => {
    const objective = oil();
    const [bk7, f2] = GLASSES.map((g) => lateralMagnification(scope(objective, g).system, 1e-4, L));
    expect(Math.abs(bk7! / -100 - 1)).toBeLessThan(1e-6);
    expect(Math.abs(f2! / bk7! - 1)).toBeLessThan(1e-8);
  });
});

describe("§ 2h.3 — the longitudinal magnification is (n′/n)·m₁·m₂", () => {
  const cells = (Object.keys(OBJECTIVES) as (keyof typeof OBJECTIVES)[]).flatMap((o) =>
    GLASSES.map((g) => [o, g] as const),
  );

  it.each(cells)("%s objective, %s back: Newton's finite step, exactly", (o, glass) => {
    const sc = scope(OBJECTIVES[o](), glass);
    const n = objectIndex(sc.system);
    const nPrime = index(glass);
    // A step that moves the magnification by a few percent on the 100×: the
    // finite form carries it, a derivative would not.
    const { ratio, m1, m2 } = longitudinal(sc.system, sc.objectDistanceMm, 1e-3);
    expect(Math.abs(ratio / ((nPrime / n) * m1 * m2) - 1)).toBeLessThan(1e-9);
  });

  it("NEGATIVE CONTROLS on the cell where both indices are away from 1 and from each other", () => {
    const sc = scope(oil(), "F2");
    const n = objectIndex(sc.system);
    const nPrime = index("F2");
    expect(n).toBeGreaterThan(1.5); // the specimen is in the slip, not in air
    const { ratio, m1, m2 } = longitudinal(sc.system, sc.objectDistanceMm, 1e-3);
    // M² alone — the index-free form — is 6.3% off.
    expect(Math.abs(ratio / (m1 * m2) - 1)).toBeGreaterThan(0.05);
    // (n/n′)·M² — the form emitter-volume.ts once wrote — is 13% off.
    expect(Math.abs(ratio / ((n / nPrime) * m1 * m2) - 1)).toBeGreaterThan(0.1);
  });

  it("the dry column is n′·M²: the specimen's index is 1 and only the glass is left", () => {
    const sc = scope(dry(), "N-BK7");
    expect(objectIndex(sc.system)).toBe(1);
    const { ratio, m1, m2 } = longitudinal(sc.system, sc.objectDistanceMm, 1e-3);
    expect(Math.abs(ratio / (index("N-BK7") * m1 * m2) - 1)).toBeLessThan(1e-9);
  });
});

describe("§ 2h.4 — the sine condition with an index at each end", () => {
  it("the oil 100×'s residual is its own 0.9% through air, N-BK7 and F2 alike", () => {
    const objective = oil();
    const air = sineConditionResidual(
      infinityCorrectedMicroscope({
        objective,
        tubeLens: tubeLens({ focalLengthMm: 200 }),
        objectHeightsMm: [0],
      }).system,
      1e-4,
      L,
    );
    const [bk7, f2] = GLASSES.map((g) => sineConditionResidual(scope(objective, g).system, 1e-4, L));
    // § 6e.4: "the sine residual is ~0.9%, and it is the REAR group's".
    for (const r of [air, bk7!, f2!]) {
      expect(r).toBeGreaterThan(0.008);
      expect(r).toBeLessThan(0.01);
    }
    // The ellipsoid is not aplanatic, but at NA′ 0.0124 its sine departure is
    // second order in a number that small: the backs differ by 2e-5.
    expect(Math.abs(f2! - bk7!)).toBeLessThan(1e-4);
  });

  it("NEGATIVE CONTROL: leave n′ out and the residual is n′ − 1, not the objective's", () => {
    const s = scope(oil(), "F2").system;
    const na = objectNumericalAperture(s, L);
    const m = lateralMagnification(s, 1e-4, L);
    const bare = na / (Math.abs(m) * imageSpaceMarginalSin(s, L)) - 1;
    expect(bare).toBeGreaterThan(0.6);
    expect(Math.abs(sineConditionResidual(s, 1e-4, L))).toBeLessThan(0.01);
  });
});

describe("§ 2h.5 — the Airy ring in the glass is 0.61·λ/NA′, whatever the glass", () => {
  const ringsBehind = (objective: InfinityCorrectedObjective) =>
    GLASSES.map((g) => {
      const s = scope(objective, g).system;
      // On the exit layout since § 2i, whose ruler is the traced cone.
      const p = psf(s, 0, L, { layout: "exit", pupilSamples: 64, padFactor: 16, keepDiffractionLimited: true });
      return {
        pixelScaleMm: p.pixelScaleMm,
        measuredMm: firstMinimumPixels(p) * p.pixelScaleMm,
        flatMm: firstMinimumPixels({ ...p, intensity: p.diffractionLimitedIntensity! }) * p.pixelScaleMm,
        expectedMm: (0.61 * L * 1e-6) / imageNumericalAperture(s, L),
        sinU: imageSpaceMarginalSin(s, L),
      };
    });

  it("behind the oil 100×, N-BK7 and F2 draw the ring on one ruler, while sin u′ differs by 0.936", () => {
    // The two-index content: the pupil→image scale is λ/(2·n′·sin u′) per pupil
    // unit, n′·sin u′ is NA′, and NA′ is the objective's NA over |M| — none of
    // which knows the back's glass. A scale that forgot n′ would move by 1.068.
    const [bk7, f2] = ringsBehind(oil());
    expect(f2!.sinU / bk7!.sinU).toBeLessThan(0.94);
    // The RULER is each back's traced rim (§ 2i), and the two ellipsoids are
    // stigmatic for a plane wave the objective does not quite hand them — their
    // traced sines differ by § 2h.4's 2e-5. So the rulers agree to that (1.9e-5,
    // and the rings 1.3e-5 on § 2j's emitter irradiance), where
    // the paraxial one agreed to the bit; against the 6.8% a scale without n′
    // would move, either is one ruler.
    expect(Math.abs(f2!.pixelScaleMm / bk7!.pixelScaleMm - 1)).toBeLessThan(5e-5);
    expect(Math.abs(f2!.measuredMm / bk7!.measuredMm - 1)).toBeLessThan(5e-5);
    // The ring's ABSOLUTE size on this objective is § 2i.2's rung: it read 0.566
    // of 0.61·λ/NA′ here until the ruler stopped taking the paraxial pupil's
    // n·tan θ for the slip's n·sin θ (register item 21).
  }, 180_000);

  it("behind the dry 4×, the ring is 0.61·λ/NA′ in either glass, and the air formula is n′ too large", () => {
    // § 2b's and § 2g's aperture regime, NA′ 0.025. Read on the aberration-free
    // ring of this traced pupil: the aberrated one sits 2.1% wide here — the
    // objective's own 0.04 waves and the finder's bias, which the paraxial ruler's
    // −1.1% used to half cancel into a reading of 0.988 (§ 2i).
    const rings = ringsBehind(dry());
    // 1.0053 in both on § 2j's emitter irradiance (1.0062 on § 2i's uniform
    // one): the finder's bias at pad 16, inside the 1.5% this rung used to need.
    for (const r of rings) expect(Math.abs(r.flatMm / r.expectedMm - 1)).toBeLessThan(0.01);
    // 5.4e-5 apart (7.1e-5 before § 2j), for the reason the oil column gives:
    // each back's own traced rim.
    expect(Math.abs(rings[1]!.measuredMm / rings[0]!.measuredMm - 1)).toBeLessThan(2e-4);
    GLASSES.forEach((g, i) => {
      // NEGATIVE CONTROL: 0.61·λ/sin u′, the index left out.
      const airMm = (0.61 * L * 1e-6) / rings[i]!.sinU;
      expect(airMm / rings[i]!.flatMm / index(g)).toBeGreaterThan(0.985);
      expect(airMm / rings[i]!.flatMm / index(g)).toBeLessThan(1.015);
    });
  }, 180_000);
});

describe("§ 2h.6 — a defocus in depths of focus is the same number on both sides", () => {
  it("with each side's own index; with the image side's left at 1, it is off by n′", () => {
    const sc = scope(oil(), "F2");
    const s = sc.system;
    const n = objectIndex(s);
    const nPrime = index("F2");
    const na = objectNumericalAperture(s, L);
    const naPrime = imageNumericalAperture(s, L);
    const delta = 1e-3;
    const { ratio, m1, m2 } = longitudinal(s, sc.objectDistanceMm, delta);
    const inDepths = (dz: number, dof: number): number => dz / dof;
    const objectSide = inDepths(delta, depthOfFocusMm(L, na, n));
    const imageSide = inDepths(ratio * delta, depthOfFocusMm(L, naPrime, nPrime));
    // The two departures from an exact 1, each carried rather than tolerated:
    // the finite step's m₁·m₂ against M² (1.4% at this step — it moves the
    // magnification), and the objective's 0.9% off aplanatic (§ 2h.4), which
    // enters squared because the NAs do. What is left is the indices.
    const M = lateralMagnification(s, 1e-4, L);
    const r = sineConditionResidual(s, 1e-4, L);
    const carried = ((1 + r) ** 2 * M * M) / (m1 * m2);
    expect(Math.abs((imageSide / objectSide) * carried - 1)).toBeLessThan(1e-6);
    // NEGATIVE CONTROL: the image-side DOF at its default index of 1.
    const naive = inDepths(ratio * delta, depthOfFocusMm(L, naPrime));
    expect(Math.abs(((naive / objectSide) * carried) / nPrime - 1)).toBeLessThan(1e-6);
  });
});
