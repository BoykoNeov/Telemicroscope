import { describe, it, expect } from "vitest";
import {
  StopPlacement,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { systemProperties } from "../src/trace/paraxial";
import { pupils } from "../src/pupil/pupils";
import { chiefRay, pupilGrid } from "../src/pupil/aiming";
import { exitBundle } from "../src/analysis/spot";
import { objectNumericalAperture, lateralMagnification } from "../src/pupil/microscope";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6v — the presets are telecentric: the objective's stop moves to its own
 * back focal plane.
 *
 * § 6u closed the last of § 6a's three immersion blockers by making an entrance
 * pupil at infinity *expressible* — and then said so in its own "not yet
 * pinned" list: *"the capability is here and the presets do not use it yet —
 * the stop still sits on the objective's rim. That is wiring plus a
 * re-measurement of what moves."* This is that step, and the re-measurement is
 * its whole content: **no physics is added here either.** The stop is one
 * diaphragm surface at a distance the paraxial trace already reports, and every
 * property below is a consequence of where it sits.
 *
 * What made it worth doing rather than leaving as an option is that the reason
 * for the old placement had expired. `designs/microscope`'s header said the rim
 * stop was there *because* `aimRay` refused the real one; once that stopped
 * being true, the default was preserving a workaround for a gap that had
 * closed — while §§ 6f/6h/6m/6o each assumed telecentricity of their
 * *condenser*. The illumination assumed what the objective was not.
 *
 * The old placement is kept as `stopPlacement: "rim"`, and it is not a leftover
 * either: every rung here is a comparison, and the property telecentricity buys
 * has no measurable size without a system that lacks it.
 */

const L = LINE_D;
const NA = 0.1;

const objectiveAt = (stopPlacement: StopPlacement, na = NA, magnification = 4) =>
  microscopeObjective({ magnification, numericalAperture: na, stopPlacement });

const scopeAt = (stopPlacement: StopPlacement, na = NA, magnification = 4) => {
  const objective = objectiveAt(stopPlacement, na, magnification);
  return { objective, ...infinityCorrectedMicroscope({ objective, tubeLens: tubeLens() }) };
};

/** tan u for a cone of numerical aperture NA in air — the aperture as a slope. */
const tanOf = (na: number) => na / Math.sqrt(1 - na * na);

describe("§ 6v.1 — the stop lands on the back focal plane, and the aperture becomes a slope", () => {
  it("puts the diaphragm at the glass group's own BFD, from the paraxial trace", () => {
    const obj = objectiveAt("backFocal");
    // The objective's glass is every surface but the diaphragm, and the
    // distance to the diaphragm is that group's back focal distance — read off
    // `systemProperties` rather than off the constructor, so the rung checks the
    // placement instead of restating it.
    const glass: Prescription = {
      ...obj.prescription,
      surfaces: obj.prescription.surfaces.slice(0, -1).map((s, i, a) =>
        i === a.length - 1 ? { ...s, thickness: 0 } : s,
      ),
    };
    expect(obj.stopDistanceMm).toBeCloseTo(systemProperties(glass, L).bfd, 12);
    expect(obj.stopDistanceMm).toBeGreaterThan(0);

    // The rim spelling has no diaphragm and no distance.
    expect(objectiveAt("rim").stopDistanceMm).toBe(0);
  });

  it("sends the entrance pupil to infinity, and the aperture arrives as a slope", () => {
    const p = pupils(scopeAt("backFocal").system, L);
    expect(p.entrance.z).toBe(-Infinity);
    expect(p.entrance.radius).toBe(Infinity);
    expect(p.entrance.slopeRadius).toBeTypeOf("number");

    // …and the control keeps a real pupil at a real place: the specimen-side
    // vertex, which is where its stop is.
    const rim = pupils(scopeAt("rim").system, L);
    expect(rim.entrance.z).toBeCloseTo(0, 12);
    expect(Number.isFinite(rim.entrance.radius)).toBe(true);
    expect(rim.entrance.slopeRadius).toBeUndefined();
  });

  it("makes the slope aperture EXACTLY tan u — no lens left in it", () => {
    // The closed form the placement is chosen for, and the reason it is worth a
    // step. § 6u.1: a telecentric aperture is `stopRadius/B`, and "stop at the
    // back focal plane" is what makes B the group's focal length. The
    // constructor sizes the stop `f·tan u`, so the f cancels and what reaches
    // the aimer is the marginal ray's own tangent — with no focal length, no
    // object distance and no magnification anywhere in it.
    for (const na of [0.05, 0.1, 0.15, 0.2]) {
      for (const m of [4, 10, 20]) {
        const p = pupils(scopeAt("backFocal", na, m).system, L);
        expect(p.entrance.slopeRadius!).toBeCloseTo(tanOf(na), 12);
      }
    }
  });
});

describe("§ 6v.2 — the delivered NA is the engraving, and the conjugate cancels", () => {
  it("delivers the NA on the label, from the traced marginal ray", () => {
    for (const na of [0.05, 0.1, 0.15]) {
      const na1 = objectNumericalAperture(scopeAt("backFocal", na).system, L);
      expect(na1).toBeCloseTo(na, 12);
    }
  });

  it("does not depend on where the specimen is — BITWISE, where the rim's does", () => {
    // The defining property, in the spelling a microscope is engraved in.
    // A telecentric aperture has no object distance in it, so moving the
    // specimen cannot change the cone; a rim stop is a real disc a real arm
    // away, and the same move changes the angle it subtends.
    const tele = scopeAt("backFocal");
    const rim = scopeAt("rim");
    const at = (s: OpticalSystem, dz: number): OpticalSystem => ({
      ...s,
      conjugate: { kind: "finite", distance: (s.conjugate as { distance: number }).distance + dz },
    });

    const teleRef = objectNumericalAperture(tele.system, L);
    const rimRef = objectNumericalAperture(rim.system, L);
    for (const dz of [0.01, 0.1, 1]) {
      expect(objectNumericalAperture(at(tele.system, dz), L)).toBe(teleRef);
      expect(objectNumericalAperture(at(rim.system, dz), L)).not.toBe(rimRef);
    }
  });
});

describe("§ 6v.3 — the magnification stops drifting with focus", () => {
  it("holds BITWISE over object travel, against a control that loses 0.1% in 50 µm", () => {
    // The property telecentricity is bought for, and § 6u.3's experiment on a
    // real objective: the OBJECT plane moves and the image plane is HELD FIXED.
    // The image blurs; it must not change size.
    //
    // Bitwise for the telecentric one because the chief ray is literally the
    // same line at every conjugate — there is nothing to round. The control
    // drifts as −δz/(L+δz) with L the arm from specimen to entrance pupil,
    // which for the rim placement is the object distance itself.
    const H = 0.02;
    for (const placement of ["backFocal", "rim"] as const) {
      const s = scopeAt(placement);
      const at = (dz: number): OpticalSystem => ({
        ...s.system,
        conjugate: { kind: "finite", distance: s.objectDistanceMm + dz },
      });
      const m0 = lateralMagnification(at(0), H, L);
      for (const dz of [0.005, 0.05]) {
        const m = lateralMagnification(at(dz), H, L);
        const rel = (m - m0) / m0;
        if (placement === "backFocal") {
          // Asserted on the magnification itself rather than on the relative
          // change: the difference of two identical f64 negatives is −0, and
          // `Object.is(-0, 0)` is false, so a rung phrased on the ratio would
          // fail while reporting a drift of zero. The claim is that the number
          // does not move at all, and this is that claim.
          expect(m).toBe(m0);
        } else {
          expect(rel).toBeCloseTo(-dz / (s.objectDistanceMm + dz), 5);
          expect(Math.abs(rel)).toBeGreaterThan(1e-4);
        }
      }
    }
  });
});

describe("§ 6v.4 — the chief ray leaves every specimen point parallel to the axis", () => {
  it("is exactly (0, 0, 1) at every field, where the control tilts with height", () => {
    const tele = scopeAt("backFocal");
    const teleP = pupils(tele.system, L);
    const rim = scopeAt("rim");
    const rimP = pupils(rim.system, L);
    for (const h of [0.01, 0.05, 0.2, 0.5]) {
      const c = chiefRay(tele.system, teleP, h, L);
      expect(c.dir.x).toBe(0);
      expect(c.dir.y).toBe(0);
      expect(c.dir.z).toBe(1);

      // The control's chief ray runs to a stop on the front vertex, so its
      // tangent is h over the object distance — the arm that vanishes above.
      const r = chiefRay(rim.system, rimP, h, L);
      expect(r.dir.x / r.dir.z).toBeCloseTo(-h / rim.objectDistanceMm, 6);
    }
  });
});

describe("§ 6v.5 — what it costs: the bundle walks, so the glass vignettes off axis", () => {
  /** Fraction of an aimed pupil grid that survives to the image, at field h. */
  const throughput = (s: { system: OpticalSystem }, h: number): number => {
    const b = exitBundle(s.system, h, L, pupilGrid(21));
    return b.rays.length / (b.rays.length + b.lost);
  };

  it("passes the whole pupil on axis, both placements", () => {
    expect(throughput(scopeAt("backFocal"), 0)).toBe(1);
    expect(throughput(scopeAt("rim"), 0)).toBe(1);
  });

  it("loses light off axis where the control loses none — the real price", () => {
    // A rim stop pivots every bundle through one hole at the front vertex, so
    // the beam footprint on the glass never moves. A telecentric stop does the
    // opposite: the chief ray is parallel to the axis, so the footprint TRANSLATES
    // by the object height and walks off a rim sized for the axial beam.
    //
    // This is the honest cost of the placement on THIS glass, not an argument
    // against it: a real objective's front element is much larger than its
    // axial beam for exactly this reason. See § 6v.6 for the control that
    // identifies the glass as the culprit.
    // The control is not perfectly free either, and saying so is the point:
    // at 3 mm it loses one lattice point of 313. What separates them is the
    // MECHANISM and therefore the rate — the rim's loss is the tube lens
    // catching an image height of 12 mm, which is why it appears three
    // millimetres out and stays a rounding error there, while the telecentric
    // one is losing a tenth of its pupil by then.
    const tele = scopeAt("backFocal");
    const rim = scopeAt("rim");
    for (const h of [1, 3]) {
      expect(throughput(tele, h)).toBeLessThan(0.95);
      expect(throughput(rim, h)).toBeGreaterThan(0.99);
    }
    expect(throughput(rim, 1)).toBe(1);
    // Monotone in field, and it is a falloff rather than a wall.
    const t1 = throughput(tele, 1);
    const t3 = throughput(tele, 3);
    expect(t3).toBeLessThan(t1);
    expect(t3).toBeGreaterThan(0);
  });

  it("IDENTIFIES the glass rather than the diaphragm, by widening one at a time", () => {
    // The controlled experiment the claim above needs: if the loss were the
    // diaphragm's, opening the diaphragm would recover it. It does not, and
    // widening the glass does — so the vignette belongs to the element and the
    // stop is doing exactly its job.
    const tele = scopeAt("backFocal");
    const H = 1;
    const base = throughput(tele, H);

    const widen = (glassExtra: number, stopExtra: number): number => {
      const prescription: Prescription = {
        ...tele.prescription,
        surfaces: tele.prescription.surfaces.map((s) => ({
          ...s,
          semiAperture: (s.semiAperture ?? 0) + (s.isStop ? stopExtra : glassExtra),
        })),
      };
      return throughput({ system: { ...tele.system, prescription } }, H);
    };

    expect(widen(0, 5)).toBeCloseTo(base, 12);
    expect(widen(1, 0)).toBeGreaterThan(base);
  });
});

describe("§ 6v.6 — what it does NOT change, and what it changes only a little", () => {
  it("leaves the axial cone alone: the two placements aim the same rays on axis", () => {
    // A stop shift changes no axial aberration, and here the reason is sharper
    // than that: on axis both aims produce the SAME ray for the same normalized
    // pupil coordinate. The rim aims at `ρ·s·tan u` a distance s away, giving
    // slope `ρ·tan u`; the telecentric one names the slope `ρ·tan u` directly.
    // Two constructions, one bundle — which is why the ladder barely moved.
    const tele = scopeAt("backFocal");
    const rim = scopeAt("rim");
    const teleB = exitBundle(tele.system, 0, L, pupilGrid(9));
    const rimB = exitBundle(rim.system, 0, L, pupilGrid(9));
    expect(teleB.rays.length).toBe(rimB.rays.length);
    for (let i = 0; i < teleB.rays.length; i++) {
      const a = teleB.rays[i]!;
      const b = rimB.rays[i]!;
      // The launch slopes agree to f64; the rays then travel through one extra
      // plane air-air surface, which refracts nothing.
      expect(a.ray.dir.x).toBeCloseTo(b.ray.dir.x, 12);
      expect(a.ray.dir.z).toBeCloseTo(b.ray.dir.z, 12);
    }
  });

  it("moves the EXIT pupil, which is why the on-axis wavefront is close but not equal", () => {
    // The one thing that does move on axis, and it is a reference rather than an
    // aberration: the stop moved, so its image through the following optics
    // moved, and OPD is measured on a sphere struck against the exit pupil. The
    // rungs downstream that shifted (§ 6d.4's bisected reach, by 0.5%) shifted
    // by this and not by the doublet becoming a different lens.
    const teleX = pupils(scopeAt("backFocal").system, L).exit;
    const rimX = pupils(scopeAt("rim").system, L).exit;
    expect(teleX.z).not.toBeCloseTo(rimX.z, 3);
  });
});
