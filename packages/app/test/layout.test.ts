import { describe, expect, it } from "vitest";
import { LINE_D } from "@telemicroscope/core/materials";
import { systemProperties } from "@telemicroscope/core/trace";
import { benchSeeds, solveParaxialFocus, toSystem, type BenchDraft } from "../src/editor";
import { MAX_EXAGGERATION, describeLayout, fitLayout, staggered } from "../src/layout";

/**
 * The layout drawing's numbers, as invariants.
 *
 * **No engine capability was added, so no validation-ladder rung was.** The
 * profiles are the geometry's own `sag` and the rays are `traceRay`'s own hit
 * points; what this file pins is the *assembly* — that a profile is the closed
 * form it claims to be, that a ray's polyline starts at the frame, visits every
 * surface and ends on the image plane, that a lost ray stops where the tracer
 * stopped it, and that the fit arithmetic reports the stretch it applies. Each
 * of those is a thing a drawing can get wrong on its own while every physics
 * test stays green, because nothing else in the repo reads a picture.
 */

const seed = (id: string): BenchDraft => {
  const s = benchSeeds().find((x) => x.id === id);
  if (!s) throw new Error(`no seed ${id}`);
  return s.draft;
};

const RAYS = 7;

describe("the section's profiles", () => {
  it("draw a sphere as the closed-form sag R(1 − √(1 − r²/R²)) at the rim", () => {
    const draft = seed("achromat");
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    draft.surfaces.forEach((s, i) => {
      const drawn = layout.surfaces[i]!;
      expect(drawn.kind).toBe("refract");
      expect(drawn.unbounded).toBe(false);
      expect(drawn.semiApertureMm).toBe(s.semiApertureMm);
      const rim = drawn.profile[drawn.profile.length - 1]!;
      const R = s.radiusMm;
      const expected = R * (1 - Math.sqrt(1 - (s.semiApertureMm / R) ** 2));
      expect(rim[1]).toBeCloseTo(s.semiApertureMm, 12);
      expect(rim[0] - drawn.vertexZMm).toBeCloseTo(expected, 12);
      // The first sample is the other rim, and the middle one is the vertex.
      expect(drawn.profile[0]![1]).toBeCloseTo(-s.semiApertureMm, 12);
      const mid = drawn.profile[(drawn.profile.length - 1) / 2]!;
      expect(mid[1]).toBeCloseTo(0, 12);
      expect(mid[0]).toBeCloseTo(drawn.vertexZMm, 12);
    });
  });

  it("draw a paraboloid as r²/2R exactly, and a mirror with no medium after it", () => {
    const draft = seed("cassegrain");
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    const primary = layout.surfaces[0]!;
    expect(primary.kind).toBe("reflect");
    expect(primary.mediumAfter).toBeNull();
    expect(draft.surfaces[0]!.conic).toBe(-1);
    for (const [z, x] of primary.profile) {
      expect(z - primary.vertexZMm).toBeCloseTo((x * x) / (2 * draft.surfaces[0]!.radiusMm), 10);
    }
    // Two mirrors in air: nothing to tint.
    expect(layout.bodies).toEqual([]);
  });

  it("group a glass gap as a body between the two surfaces that bound it", () => {
    const draft = seed("achromat");
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    expect(layout.bodies.map((b) => [b.from, b.to])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(layout.bodies.map((b) => b.medium)).toEqual([draft.surfaces[0]!.medium, draft.surfaces[1]!.medium]);
    expect(layout.surfaces[2]!.mediumAfter).toBe("AIR");
  });

  it("tint an immersion object space from the frame's edge to surface 0", () => {
    const draft: BenchDraft = { ...seed("achromat"), objectMedium: "IMMERSION-OIL" };
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    expect(layout.bodies[0]).toEqual({ from: -1, to: 0, medium: "IMMERSION-OIL" });
  });

  it("borrow the largest finite rim for a surface that has none, and say so", () => {
    const base = seed("achromat");
    const draft: BenchDraft = {
      ...base,
      surfaces: base.surfaces.map((s, i) => (i === 2 ? { ...s, semiApertureMm: Infinity } : s)),
    };
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    const rims = base.surfaces.slice(0, 2).map((s) => s.semiApertureMm);
    expect(layout.surfaces[2]!.unbounded).toBe(true);
    expect(layout.surfaces[2]!.semiApertureMm).toBe(Math.max(...rims));
    expect(layout.surfaces[0]!.unbounded).toBe(false);
  });
});

describe("the rays", () => {
  it("run from the frame's edge through every surface to the image plane", () => {
    const draft = seed("achromat");
    const layout = describeLayout(toSystem(draft), { fields: [0, draft.fieldValue], raysAcross: RAYS });
    expect(layout.fields).toEqual([0, draft.fieldValue]);
    expect(layout.traced).toBe(2 * RAYS);
    expect(layout.rays).toHaveLength(2 * RAYS);
    // The on-axis fan all gets through. Off axis, the rim ray on the side the
    // field tilts toward reaches surface 0 a few microns outside a rim sized
    // exactly to the pupil — the tracer's rim is inclusive to 1e-12, not to a
    // sag's worth of tilt — and that one is drawn lost, on surface 0, which is
    // the honest picture and not a defect of the drawing.
    expect(layout.rays.filter((r) => r.field === 0).every((r) => r.lostAt === null)).toBe(true);
    const lost = layout.rays.filter((r) => r.lostAt !== null);
    expect(layout.lost).toBe(lost.length);
    expect(lost.length).toBeLessThanOrEqual(1);
    for (const ray of lost) {
      expect(ray.field).toBe(1);
      expect(ray.lostAt).toBe(0);
      expect(ray.points).toHaveLength(2);
    }
    for (const ray of layout.rays) {
      expect(ray.points[0]![0]).toBe(layout.startZMm);
      ray.points.forEach(([z, x]) => {
        expect(Number.isFinite(z) && Number.isFinite(x)).toBe(true);
      });
      if (ray.lostAt !== null) continue;
      // start + one hit per surface + the image plane
      expect(ray.points).toHaveLength(draft.surfaces.length + 2);
      expect(ray.points[ray.points.length - 1]![0]).toBe(layout.imagePlaneZMm);
    }
    // The frame starts in front of the first vertex, and the object is at infinity.
    expect(layout.objectZMm).toBeNull();
    expect(layout.objectShown).toBe(false);
    expect(layout.startZMm).toBeLessThan(Math.min(...layout.surfaces.map((s) => s.vertexZMm)));
    expect(layout.wavelengthNm).toBe(LINE_D);
  });

  it("keep the on-axis chief ray on the axis at every point", () => {
    const layout = describeLayout(toSystem(seed("achromat")), { fields: [0], raysAcross: RAYS });
    const chief = layout.rays.find((r) => r.pupil === 0)!;
    for (const [, x] of chief.points) expect(Math.abs(x)).toBeLessThan(1e-9);
  });

  it("put the off-axis chief ray at f·tan θ on the paraxial image plane", () => {
    // External closed form: a distant point at angle θ images at height f·tanθ.
    // The seed's authored image plane is a placeholder, so solve to the focus
    // first; distortion on a doublet at 0.25° is below the tolerance.
    const draft = solveParaxialFocus(seed("achromat"));
    const system = toSystem(draft);
    const layout = describeLayout(system, { fields: [0, draft.fieldValue], raysAcross: RAYS });
    const chief = layout.rays.find((r) => r.field === 1 && r.pupil === 0)!;
    const [z, x] = chief.points[chief.points.length - 1]!;
    expect(z).toBe(layout.imagePlaneZMm);
    const f = systemProperties(system.prescription, LINE_D).efl;
    expect(x).toBeCloseTo(f * Math.tan((draft.fieldValue * Math.PI) / 180), 2);
  });

  it("follow a Cassegrain back through the primary to the focus behind it", () => {
    const draft = seed("cassegrain");
    const layout = describeLayout(toSystem(draft), { fields: [0], raysAcross: RAYS });
    expect(layout.lost).toBe(0);
    const marginal = layout.rays.find((r) => r.pupil === 1)!;
    const [start, primary, secondary, image] = marginal.points as [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
    expect(start[0]).toBe(layout.startZMm);
    expect(primary[1]).toBeCloseTo(draft.surfaces[0]!.semiApertureMm, 6);
    // Light comes back: the secondary is at −z of the primary, and the image is
    // past the primary again, in +z.
    expect(secondary[0]).toBeLessThan(primary[0]);
    // The hit is ON the secondary: its vertex plus that conic's sag at the hit
    // height, c·r²/(1 + √(1 − (1+k)c²r²)) — not the vertex, which would be a
    // drawing that put the ray on the surface's plane rather than its shape.
    const s2 = draft.surfaces[1]!;
    const c2 = 1 / s2.radiusMm;
    const r2 = secondary[1] ** 2;
    const sag2 = (c2 * r2) / (1 + Math.sqrt(1 - (1 + s2.conic) * c2 * c2 * r2));
    const secondaryVertexZ = draft.surfaces[0]!.thicknessMm;
    expect(layout.surfaces[1]!.vertexZMm).toBe(secondaryVertexZ);
    expect(secondary[0]).toBeCloseTo(secondaryVertexZ + sag2, 9);
    expect(image[0]).toBe(layout.imagePlaneZMm);
    expect(image[0]).toBeGreaterThan(primary[0]);
    // A frame that starts in front of the secondary, which is the leftmost vertex.
    expect(layout.startZMm).toBeLessThan(secondary[0]);
  });

  it("stop a vignetted ray on the surface that lost it, and count it", () => {
    const base = seed("achromat");
    const rim = 5;
    const draft: BenchDraft = {
      ...base,
      surfaces: base.surfaces.map((s, i) => (i === 1 ? { ...s, semiApertureMm: rim } : s)),
    };
    const layout = describeLayout(toSystem(draft), { fields: [0], raysAcross: RAYS });
    // The fan is at ±1, ±2/3, ±1/3, 0 of a 25 mm pupil: only the chief ray is
    // inside a 5 mm rim on surface 1.
    const lost = layout.rays.filter((r) => r.lostAt !== null);
    expect(lost).toHaveLength(RAYS - 1);
    expect(layout.lost).toBe(RAYS - 1);
    for (const ray of lost) {
      expect(ray.lostAt).toBe(1);
      // start, the hit on surface 0, the hit on surface 1 where it was stopped.
      expect(ray.points).toHaveLength(3);
      expect(Math.abs(ray.points[2]![1])).toBeGreaterThan(rim);
    }
    expect(layout.rays.find((r) => r.pupil === 0)!.lostAt).toBeNull();
  });

  it("show a finite object when it is within a system length, and say when it is not", () => {
    const din = describeLayout(toSystem(seed("din")), { raysAcross: RAYS });
    expect(din.objectZMm).not.toBeNull();
    expect(din.objectShown).toBe(true);
    expect(din.startZMm).toBe(din.objectZMm);
    for (const ray of din.rays) expect(ray.points[0]![0]).toBe(din.objectZMm);

    const apo = describeLayout(toSystem(seed("apochromat")), { raysAcross: RAYS });
    expect(apo.objectZMm).toBe(-453);
    expect(apo.objectShown).toBe(false);
    expect(apo.startZMm).toBeGreaterThan(apo.objectZMm!);
    for (const ray of apo.rays) expect(ray.points[0]![0]).toBe(apo.startZMm);
  });

  it("report the engine's refusal instead of rays when the pupil cannot be resolved", () => {
    const base = seed("achromat");
    // A stop that no cone reaches: the stop surface closed to a hair, asked for
    // as an entrance pupil the paraxial trace cannot fill.
    const draft: BenchDraft = { ...base, aperture: { kind: "objectNA", value: 5 } };
    const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
    expect(layout.surfaces).toHaveLength(base.surfaces.length);
    if (layout.raysRefusal !== null) {
      expect(layout.rays).toEqual([]);
      expect(layout.traced).toBe(0);
    } else {
      // The engine accepted it; then every ray it aimed must be accounted for.
      expect(layout.rays.length).toBe(layout.traced);
    }
  });
});

describe("the fit", () => {
  const section = { zRangeMm: [0, 100] as const, xRangeMm: [-5, 5] as const };

  it("stretches heights up to the cap and reports the factor", () => {
    const fit = fitLayout(section, 500, 250, false);
    expect(fit.zScale).toBe(5);
    expect(fit.xScale).toBe(25);
    expect(fit.exaggeration).toBe(5);
    expect(fit.exaggeration).toBeLessThanOrEqual(MAX_EXAGGERATION);
    // z = 0 lands on the left edge, and x = 0 mid-height.
    expect(fit.zOrigin).toBe(0);
    expect(fit.xOrigin).toBe(125);
  });

  it("caps the stretch", () => {
    const fit = fitLayout({ zRangeMm: [0, 100], xRangeMm: [-1, 1] }, 500, 250, false);
    expect(fit.exaggeration).toBe(MAX_EXAGGERATION);
    expect(fit.xScale).toBe(5 * MAX_EXAGGERATION);
  });

  it("never shrinks heights below the axis scale: a tall section is at true scale", () => {
    const fit = fitLayout({ zRangeMm: [0, 100], xRangeMm: [-50, 50] }, 500, 250, false);
    expect(fit.zScale).toBe(2.5);
    expect(fit.xScale).toBe(2.5);
    expect(fit.exaggeration).toBe(1);
    // The slack is centred.
    expect(fit.zOrigin).toBe((500 - 250) / 2);
  });

  it("is one scale on both axes at 1 : 1", () => {
    const fit = fitLayout(section, 500, 250, true);
    expect(fit.zScale).toBe(fit.xScale);
    expect(fit.zScale).toBe(5);
    expect(fit.exaggeration).toBe(1);
  });
});

describe("the labels", () => {
  it("stack when they would over-print, and stay on the baseline when they would not", () => {
    // Three surfaces on one pixel: rows 0, 1, 2 — in input order, not sorted order.
    expect(staggered([100, 100, 100], 14)).toEqual([0, 1, 2]);
    expect(staggered([300, 100, 200], 14)).toEqual([0, 0, 0]);
    // The achromat's image plane, best focus and paraxial focus, a few px apart:
    // rows follow x order, so the leftmost sits on the baseline.
    expect(staggered([500.5, 498, 501], 70)).toEqual([1, 0, 2]);
    // A label bumped past one neighbour must not land on another.
    expect(staggered([0, 10, 20], 14)).toEqual([0, 1, 0]);
    expect(staggered([], 14)).toEqual([]);
  });
});

describe("the section's surfaces say what they are", () => {
  it("carry the radius the draft was written in, and Infinity for a plane, on every seed", () => {
    for (const { draft } of benchSeeds()) {
      const layout = describeLayout(toSystem(draft), { raysAcross: RAYS });
      draft.surfaces.forEach((s, i) => {
        const drawn = layout.surfaces[i]!;
        if (Number.isFinite(s.radiusMm)) expect(drawn.radiusMm / s.radiusMm).toBeCloseTo(1, 12);
        else expect(drawn.radiusMm).toBe(Infinity);
      });
    }
  });
});
