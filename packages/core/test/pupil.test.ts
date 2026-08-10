import { describe, it, expect } from "vitest";
import { dot, sub, normalize, vec3 } from "../src/math/vec3";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem, simpleSystem } from "../src/trace/system";
import { asCompiled } from "../src/trace/compile";
import { traceRay } from "../src/trace/sequential";
import { systemProperties } from "../src/trace/paraxial";
import { pupils, resolveStopRadius } from "../src/pupil/pupils";
import { aimRay, chiefRay, pupilGrid, pupilFan, fieldDirection } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";
import { IMMERSION_OIL, N_BK7 } from "../src/materials/catalog";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";

const n = N_BK7.n(LINE_D);

/**
 * Rung: pupil location from the single-surface imaging equation
 *   n₂/s′ − n₁/s = (n₂ − n₁)/R,      m = (n₁·s′)/(n₂·s)
 * which is EXACT paraxially (no thin-lens approximation involved). The
 * entrance pupil is the image of the stop through the surfaces preceding it,
 * so a stop behind one spherical surface has a closed-form pupil.
 */
describe("entrance pupil = image of the stop by preceding surfaces", () => {
  const R = 100;
  const d = 20; // stop sits 20 mm behind the refracting surface, inside glass
  const stopRadius = 5;

  const prescription: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / R, semiAperture: 40, thickness: d, medium: "N-BK7" },
      {
        kind: "refract",
        curvature: 0,
        semiAperture: stopRadius,
        thickness: 60,
        medium: "AIR",
        isStop: true,
      },
    ],
  };

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: stopRadius },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("entrance-pupil position matches the imaging equation", () => {
    // Object = the stop, at s′ = +d in image space (glass). Solve for s.
    const s = 1 / (n / d - (n - 1) / R);
    const p = pupils(system, LINE_D);
    expect(p.stopIndex).toBe(1);
    expect(p.entrance.z).toBeCloseTo(s, 9);
  });

  it("entrance-pupil size matches the transverse magnification", () => {
    const s = 1 / (n / d - (n - 1) / R);
    // The imaging equation's m = n₁s′/(n₂s) is for object→image, i.e. EP→stop.
    // The pupil magnification is the other direction (stop→EP), its reciprocal.
    const m = (n * s) / (1 * d);
    const p = pupils(system, LINE_D);
    expect(Math.abs(p.entrance.magnification)).toBeCloseTo(Math.abs(m), 9);
    expect(p.entrance.radius).toBeCloseTo(Math.abs(m) * stopRadius, 9);
  });
});

describe("exit pupil = image of the stop by following surfaces", () => {
  const R = 100;
  const d = 20;
  const stopRadius = 5;

  // Mirror-image arrangement: the stop comes FIRST, then the powered surface.
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: stopRadius,
        thickness: d,
        medium: "AIR",
        isStop: true,
      },
      { kind: "refract", curvature: 1 / R, semiAperture: 40, thickness: 60, medium: "N-BK7" },
    ],
  };

  const system: OpticalSystem = {
    prescription,
    aperture: { kind: "stopRadius", value: stopRadius },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("exit-pupil position and size match the imaging equation", () => {
    // Object = the stop at s = −d relative to the powered surface's vertex.
    const sPrime = n / ((n - 1) / R + 1 / -d);
    const m = (1 * sPrime) / (n * -d);
    const p = pupils(system, LINE_D);
    expect(p.stopIndex).toBe(0);
    expect(p.exit.z).toBeCloseTo(d + sPrime, 9);
    expect(p.exit.radius).toBeCloseTo(Math.abs(m) * stopRadius, 9);
  });

  it("the entrance pupil IS the stop when nothing precedes it", () => {
    const p = pupils(system, LINE_D);
    expect(p.entrance.z).toBe(0);
    expect(p.entrance.radius).toBe(stopRadius);
    expect(p.entrance.magnification).toBe(1);
  });
});

/**
 * CONSISTENCY CHECKS, not validation rungs. These round-trip
 * `resolveStopRadius` against `pupils`, so they cannot fail on physics — the
 * EPD case is algebraically tautological (the magnification cancels). They
 * earn their place by catching an inverted conversion, which is a real and
 * easy mistake, but the load is carried by the imaging-equation tests above.
 */
describe("aperture specifications resolve consistently (consistency check)", () => {
  const doublet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };

  it("an EPD spec produces exactly that entrance-pupil diameter", () => {
    const sys = simpleSystem(doublet, { kind: "EPD", value: 30 }, LINE_D);
    const p = pupils(sys, LINE_D);
    expect(2 * p.entrance.radius).toBeCloseTo(30, 9);
  });

  it("an f-number spec produces EPD = EFL / f#", () => {
    const fNumber = 8;
    const sys = simpleSystem(doublet, { kind: "fNumber", value: fNumber }, LINE_D);
    const efl = systemProperties(doublet, LINE_D).efl;
    const p = pupils(sys, LINE_D);
    expect(2 * p.entrance.radius).toBeCloseTo(Math.abs(efl) / fNumber, 9);
  });

  it("object-space NA resolves against the entrance-pupil arm", () => {
    const NA = 0.05;
    const objectDistance = 200;
    const sys: OpticalSystem = {
      prescription: doublet,
      aperture: { kind: "objectNA", value: NA },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance: objectDistance },
    };
    const p = pupils(sys, LINE_D);
    // NA = n·sin u, and the marginal ray reaches the rim over the arm, so what
    // the radius/arm ratio holds is a TANGENT. Inverting it is the round trip
    // (§ 1.5.1 pins the sine reading itself, against Abbe rather than against
    // this resolver).
    const arm = p.entrance.z + objectDistance;
    expect(Math.sin(Math.atan(p.entrance.radius / arm))).toBeCloseTo(NA, 9);
  });

  it("image-space NA resolves against the exit-pupil arm", () => {
    // The most involved resolver: it depends on both the exit pupil and the
    // image-plane position, and shares no code path with the other four.
    const NA = 0.06;
    const sys: OpticalSystem = {
      prescription: doublet,
      aperture: { kind: "imageNA", value: NA },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const p = pupils(sys, LINE_D);
    const imageZ = 6 + 100; // last vertex + its thickness
    const arm = imageZ - p.exit.z;
    expect(Math.sin(Math.atan(p.exit.radius / arm))).toBeCloseTo(NA, 9);
  });

  it("the DIN objective's own stop radius survives being re-spelled as its NA", () => {
    // A consistency check and NOT a rung, deliberately filed here: both sides
    // are this repo's, and `designs/microscope` sizes its stop with the same
    // closed form § 1.5.1 pins. What it is worth is that the two are now ONE
    // number — the bench editor (APP.md Part E) is a form over all five
    // spellings, so a reader may re-spell a design's aperture, and before this
    // the same objective came back 0.5% narrower for having been asked for in
    // the currency it was designed in.
    const objective = finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 });
    const chain = finiteConjugateMicroscope({ objective });
    const respelled: OpticalSystem = {
      ...chain.system,
      aperture: { kind: "objectNA", value: 0.1 },
    };
    expect(resolveStopRadius(respelled, chain.system.wavelengths[0]!.nm)).toBeCloseTo(
      objective.stopRadiusMm,
      12,
    );
  });

  it("a stop with powered surfaces on BOTH sides gives distinct pupils", () => {
    // Exercises imageStopForward's non-trivial branch: the paraboloid tests
    // early-return because their stop is also the last surface.
    const withInternalStop: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 10, medium: "AIR" },
        { kind: "refract", curvature: 0, semiAperture: 8, thickness: 10, medium: "AIR", isStop: true },
        { kind: "refract", curvature: 1 / 80, semiAperture: 25, thickness: 6, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 80, semiAperture: 25, thickness: 90, medium: "AIR" },
      ],
    };
    const sys = simpleSystem(withInternalStop, { kind: "stopRadius", value: 8 }, LINE_D);
    const p = pupils(sys, LINE_D);
    expect(p.stopIndex).toBe(2);
    // Neither pupil coincides with the stop, and both are real and finite.
    expect(p.entrance.z).not.toBeCloseTo(p.stopZ, 3);
    expect(p.exit.z).not.toBeCloseTo(p.stopZ, 3);
    expect(Number.isFinite(p.entrance.radius)).toBe(true);
    expect(Number.isFinite(p.exit.radius)).toBe(true);
    // A stop between two positive groups is magnified by both.
    expect(p.entrance.radius).toBeGreaterThan(0);
    expect(p.exit.radius).toBeGreaterThan(0);
  });
});

/**
 * § 1.5.1 — an NA is n·sin u, and the arm holds a tangent.
 *
 * The four checks above round-trip the resolver against `pupils`, so none of
 * them can see a wrong *reading* of the number they are handed: they invert
 * whatever the resolver did. These rungs come from outside. The external
 * statement is Abbe's definition of numerical aperture,
 *
 *     NA = n · sin u,
 *
 * u being the real half-angle of the cone the axial object point sends into the
 * system. The entrance pupil is a plane a finite arm away, so what fills it is
 * `arm · tan u` — and therefore
 *
 *     EP radius = arm · tan(asin(NA/n)) = arm · (NA/n) / √(1 − (NA/n)²).
 *
 * `resolveStopRadius` read the ratio as a paraxial *slope*, `(NA/n)·arm`, which
 * is the small-angle limit of that and nothing else. The two differ by
 * 1/√(1 − (NA/n)²): 0.50% at NA 0.10, 15.5% at 0.50, and **2.6×** in oil at
 * NA 1.4 — the size ROADMAP § 6a predicted before there was a design high
 * enough to feel it.
 *
 * Two rungs, because a closed form and a traced ray fail differently. The
 * closed form pins the number the resolver must produce; the traced rung asks
 * the only question that is really about physics — what does the ray the engine
 * actually aims *carry* — and answers it in the invariant's own currency, off
 * the direction cosine rather than off any radius. An algebraic rung alone
 * would pass for the old code under a re-derivation; this one reads 1.028 for
 * an aperture engraved 1.40.
 */
describe("§ 1.5.1 — an NA is n·sin u", () => {
  /** Stop on the front vertex, so EP = stop, m = 1, and the arm is exactly s. */
  const stopFirst: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 0, semiAperture: 60, thickness: 20, medium: "AIR", isStop: true },
      { kind: "refract", curvature: 1 / 60, semiAperture: 60, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 60, thickness: 100, medium: "AIR" },
    ],
  };

  const atNA = (prescription: Prescription, NA: number, distance: number): OpticalSystem => ({
    prescription,
    aperture: { kind: "objectNA", value: NA },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance },
  });

  it("object-space NA fills the entrance pupil to arm·tan(asin(NA/n))", () => {
    const s = 50;
    // Three decades of the correction: 0.5%, 15.5%, 3.2×. The last is where a
    // slope reading stops being an approximation and becomes a different
    // quantity — which is the whole reason this rung is not asserted at 0.05.
    for (const NA of [0.1, 0.5, 0.95]) {
      const expected = s * Math.tan(Math.asin(NA));
      expect(resolveStopRadius(atNA(stopFirst, NA, s), LINE_D)).toBeCloseTo(expected, 12);
    }
  });

  it("the slope reading it replaces is recovered exactly as the paraxial limit", () => {
    // Not a tautology: it says the fix is a REPLACEMENT of a small-angle form by
    // the form it is the limit of, so nothing landed at low NA can have moved by
    // more than this ratio. § 6a's designs sit at NA 0.10, i.e. at 1.005.
    const s = 50;
    for (const NA of [0.1, 0.5, 0.95]) {
      const exact = resolveStopRadius(atNA(stopFirst, NA, s), LINE_D);
      expect(exact / (s * NA)).toBeCloseTo(1 / Math.sqrt(1 - NA * NA), 12);
    }
  });

  it("the marginal ray the engine AIMS carries the invariant it was asked for", () => {
    // The rung that is about physics rather than about algebra. An oil-immersion
    // front: the axial specimen point sits in Cargille Type B under the plane
    // face that is also the stop, so the cone the engine aims is the cone the
    // objective's engraving names. Read off the direction cosine — the resolved
    // radius appears nowhere in the assertion.
    const oilFront: Prescription = {
      objectMedium: "IMMERSION-OIL",
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: 1, thickness: 0.17, medium: "D263", isStop: true },
        { kind: "refract", curvature: 0, semiAperture: 1, thickness: 20, medium: "AIR" },
      ],
    };
    const nOil = IMMERSION_OIL.n(LINE_D);
    const workingDistance = 0.2;

    for (const NA of [0.5, 1.25, 1.4]) {
      const sys = atNA(oilFront, NA, workingDistance);
      const p = pupils(sys, LINE_D);
      const marginal = aimRay(sys, p, 0, { px: 0, py: 1 }, LINE_D);
      const sinU = Math.hypot(marginal.dir.x, marginal.dir.y);
      expect(nOil * sinU).toBeCloseTo(NA, 12);
    }

    // And what the slope reading delivered instead, stated as a number rather
    // than as a ratio: an objective engraved 1.40 handing back a 1.03 cone.
    const slopeSinU = Math.sin(Math.atan(1.4 / nOil));
    expect(nOil * slopeSinU).toBeCloseTo(1.028242, 6);
  });

  it("image-space NA fills the exit pupil the same way", () => {
    // Mirror of the first rung: stop on the LAST surface, so XP = stop, m = 1,
    // and the arm is the trailing thickness. The image-side resolver shares no
    // code path with the object-side one and had the same defect.
    const stopLast: Prescription = {
      surfaces: [
        { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 10, medium: "AIR" },
        { kind: "refract", curvature: 0, semiAperture: 25, thickness: 40, medium: "AIR", isStop: true },
      ],
    };
    for (const NA of [0.1, 0.5]) {
      const sys = simpleSystem(stopLast, { kind: "imageNA", value: NA }, LINE_D);
      expect(resolveStopRadius(sys, LINE_D)).toBeCloseTo(40 * Math.tan(Math.asin(NA)), 12);
    }
  });

  it("refuses an NA the medium cannot carry, because no such ray exists", () => {
    // sin u = NA/n ≥ 1 has no real u. The old form returned Infinity at the
    // equality and NaN past it — a stop radius that propagates silently. This
    // is § 6l's ceiling arriving at the aperture spec: an invariant above the
    // medium's index names rays that do not exist, and it is refused here for
    // the same reason § 6l measures an oil objective delivering only 1.3347
    // into water.
    expect(() => resolveStopRadius(atNA(stopFirst, 1.0, 50), LINE_D)).toThrow(/n·sin u/);
    expect(() => resolveStopRadius(atNA(stopFirst, 1.2, 50), LINE_D)).toThrow(/n·sin u/);
    // In oil the same NA is ordinary, so the refusal is about the medium and
    // not about the number.
    expect(() =>
      resolveStopRadius(atNA({ ...stopFirst, objectMedium: "IMMERSION-OIL" }, 1.2, 50), LINE_D),
    ).not.toThrow();
  });
});

/**
 * Rung: the input wavefront reference convention. Rays for a field bundle
 * must be launched from a plane NORMAL TO THE CHIEF RAY, which is an
 * equal-phase surface for a tilted plane wave. Launching from a common
 * z-plane instead introduces 0.387 mm of spurious OPL spread at only 2° of
 * field (≈ 6·10⁵ waves) — see docs/ARCHITECTURE.md § Wavefront reference.
 */
describe("wavefront reference: oblique bundles launch from a plane ⊥ the chief ray", () => {
  const doublet: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 25, thickness: 6, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 25, thickness: 100, medium: "AIR" },
    ],
  };
  const sys = simpleSystem(doublet, { kind: "EPD", value: 24 }, LINE_D);

  for (const fieldDeg of [0, 2, 5]) {
    it(`at ${fieldDeg}°, every launch origin lies on one plane ⊥ the field direction`, () => {
      const p = pupils(sys, LINE_D);
      const dir = fieldDirection(sys, fieldDeg);
      const rays = pupilGrid(9).map((pt) => aimRay(sys, p, fieldDeg, pt, LINE_D));
      const ref = rays[0]!.origin;
      for (const r of rays) {
        // Coplanarity ⊥ dir: the separation has no component along dir.
        expect(dot(sub(r.origin, ref), dir)).toBeCloseTo(0, 12);
      }
    });
  }

  it("each aimed ray actually passes through its entrance-pupil target", () => {
    const p = pupils(sys, LINE_D);
    const fieldDeg = 5;
    for (const pt of pupilFan(7)) {
      const r = aimRay(sys, p, fieldDeg, pt, LINE_D);
      const s = (p.entrance.z - r.origin.z) / r.dir.z;
      const hit = { x: r.origin.x + r.dir.x * s, y: r.origin.y + r.dir.y * s };
      expect(hit.x).toBeCloseTo(pt.px * p.entrance.radius, 9);
      expect(hit.y).toBeCloseTo(pt.py * p.entrance.radius, 9);
    }
  });

  it("the chief ray passes through the centre of the entrance pupil", () => {
    const p = pupils(sys, LINE_D);
    const r = chiefRay(sys, p, 5, LINE_D);
    const s = (p.entrance.z - r.origin.z) / r.dir.z;
    expect(r.origin.x + r.dir.x * s).toBeCloseTo(0, 12);
    expect(r.origin.y + r.dir.y * s).toBeCloseTo(0, 12);
  });
});

/**
 * Rung § 1.5.2 — an aim is a LINE, and which way it is travelled is separate.
 *
 * `aimRay` built its direction as `normalize(target − origin)`. An entrance
 * pupil is a paraxial IMAGE of the stop, so it can be virtual, and a virtual
 * one can land BEHIND the object plane — at which point that difference points
 * away from the optics and the ray propagates in −z. The magnitude stays exact
 * (12 digits, measured); only the sense is wrong, so nothing produced a
 * plausible wrong number. What it produced was `traceRay` reporting **`miss`**
 * on geometry that is entirely ordinary.
 *
 * That makes it the fifth member of the family APP.md names — a routine that
 * answers confidently for a system it cannot express — and the first to answer
 * with a *status* rather than a number, which is exactly why no rung caught it:
 * a `miss` reads as the system's fault.
 *
 * The regime is everything approaching object-space telecentricity from the far
 * side. As the stop passes the front group's back focal plane the entrance
 * pupil goes to +∞, returns from −∞, and walks forward; while it is further
 * from the optics than the object is, the old construction fired.
 */
describe("§ 1.5.2 — a virtual entrance pupil behind the object still aims forward", () => {
  // Thick and asymmetric on purpose: nothing here may lean on a thin lens.
  const lens = [
    { kind: "refract" as const, curvature: 1 / 40, semiAperture: 20, thickness: 9, medium: "N-BK7" },
    { kind: "refract" as const, curvature: -1 / 80, semiAperture: 20, thickness: 0, medium: "AIR" },
  ];
  const BFD = systemProperties({ surfaces: lens }, LINE_D).bfd;
  const OBJECT_DISTANCE = 200;

  /** The stop as a plane dummy `stopZ` mm past the lens's last vertex. */
  const at = (stopZ: number, stopRadius: number, distance = OBJECT_DISTANCE): OpticalSystem => ({
    prescription: {
      surfaces: [
        lens[0]!,
        { ...lens[1]!, thickness: stopZ },
        { kind: "refract", curvature: 0, semiAperture: 30, thickness: 120, medium: "AIR", isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: stopRadius },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance },
  });

  // Past the back focal plane the entrance pupil is virtual and far behind the
  // object. Every one of these is the broken regime.
  const BEHIND = [BFD + 0.5, BFD + 2, BFD + 5, BFD + 10];

  it("the fixture really is in the regime: EP is behind the object plane", () => {
    for (const stopZ of BEHIND) {
      const ep = pupils(at(stopZ, 2), LINE_D).entrance.z;
      expect(ep).toBeLessThan(-OBJECT_DISTANCE);
    }
  });

  it("the aimed ray travels toward the optics, and the trace stops missing", () => {
    for (const stopZ of BEHIND) {
      const s = at(stopZ, 2);
      const p = pupils(s, LINE_D);
      const m = aimRay(s, p, 0, { px: 1, py: 0 }, LINE_D);
      expect(m.dir.z).toBeGreaterThan(0);
      expect(traceRay(s.prescription, m).status).toBe("ok");

      // The defect, stated as the thing that is no longer done: the raw
      // difference — what the old construction returned — points backwards.
      const raw = normalize(sub(vec3(p.entrance.radius, 0, p.entrance.z), vec3(0, 0, -OBJECT_DISTANCE)));
      expect(raw.z).toBeLessThan(0);
      expect(m.dir.z).toBeCloseTo(-raw.z, 15);
      expect(m.dir.x).toBeCloseTo(-raw.x, 15);
    }
  });

  it("the LINE is untouched — the ray still passes through its pupil target", () => {
    // A virtual pupil sits on the BACKWARD extension of the ray, so the path
    // length to it is negative. That is what "virtual" means, and asserting the
    // crossing without asserting the sign of `s` is what keeps this a statement
    // about the line rather than about the direction.
    for (const stopZ of BEHIND) {
      const s = at(stopZ, 2);
      const p = pupils(s, LINE_D);
      for (const pt of pupilFan(5)) {
        const r = aimRay(s, p, 0, pt, LINE_D);
        const t = (p.entrance.z - r.origin.z) / r.dir.z;
        expect(t).toBeLessThan(0);
        expect(r.origin.x + r.dir.x * t).toBeCloseTo(pt.px * p.entrance.radius, 9);
        expect(r.origin.y + r.dir.y * t).toBeCloseTo(pt.py * p.entrance.radius, 9);
      }
    }
  });

  it("where the pupil was already in front, the aim is bit-identical", () => {
    // The "re-pins nothing" claim as an assertion rather than as a suite result.
    // Every system in the ladder is one of these.
    for (const stopZ of [10, 20, 30, 40, 48]) {
      const s = at(stopZ, 2);
      const p = pupils(s, LINE_D);
      expect(p.entrance.z).toBeGreaterThan(-OBJECT_DISTANCE);
      for (const pt of pupilFan(5)) {
        const got = aimRay(s, p, 0, pt, LINE_D);
        const old = normalize(
          sub(vec3(pt.px * p.entrance.radius, pt.py * p.entrance.radius, p.entrance.z), vec3(0, 0, -OBJECT_DISTANCE)),
        );
        expect(got.dir.x).toBe(old.x);
        expect(got.dir.y).toBe(old.y);
        expect(got.dir.z).toBe(old.z);
      }
    }
  });

  it("the traced ray lands on the stop rim, off by third-order pupil aberration", () => {
    // The pin with teeth: the aim is only correct if the ray it launches
    // actually fills the stop. It does not do so exactly — `aimRay` targets the
    // PARAXIAL pupil — so the honest statement is an ORDER, not a tolerance.
    //
    // `entrance.radius` is |m|·stopRadius, a magnitude, so px = +1 is a point
    // in ENTRANCE-PUPIL coordinates and reaches the stop's −x rim wherever the
    // magnification is negative. The sign is the convention's, not the aim's.
    const stopZ = BFD + 5;
    const errors: number[] = [];
    for (const stopRadius of [2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
      const s = at(stopZ, stopRadius);
      const p = pupils(s, LINE_D);
      const traced = traceRay(s.prescription, aimRay(s, p, 0, { px: 1, py: 0 }, LINE_D));
      expect(traced.status).toBe("ok");
      const r = traced.ray!;
      const stopPlaneZ = asCompiled(s.prescription).surfaces[2]!.vertexZ;
      const t = (stopPlaneZ - r.origin.z) / r.dir.z;
      const landed = Math.abs(r.origin.x + r.dir.x * t);
      errors.push(Math.abs(landed - stopRadius) / stopRadius);
    }
    const ratios = errors.slice(1).map((e, i) => errors[i]! / e);

    // Relative error ∝ stopRadius², i.e. absolute error ∝ stopRadius³ — the
    // leading pupil-aberration term. The sweep is wide enough to show BOTH
    // orders: 4.2902, 4.0665, 4.0163, 4.00406, 4.00101, 4.00025, approaching 4
    // strictly from above and never reaching it.
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeLessThan(ratios[i - 1]!);
    for (const r of ratios) expect(r).toBeGreaterThan(4);
    expect(ratios[ratios.length - 1]!).toBeCloseTo(4, 3);

    // And the EXCESS over 4 is itself ×4 per halving, which names the next term
    // as fifth order rather than leaving it as "some higher order". Two
    // aberration orders identified from one sweep of the aperture. It has the
    // same shape as the sequence it corrects — 4.3605, 4.0825, 4.0202, 4.0050,
    // 4.0013 — because a seventh-order term sits behind it in exactly the way
    // the fifth sits behind the third, so what is asserted is the shape and not
    // a value at a step chosen for passing.
    const excess = ratios.map((r) => r - 4);
    const excessRatios = excess.slice(1).map((e, i) => excess[i]! / e);
    for (let i = 1; i < excessRatios.length; i++) {
      expect(excessRatios[i]!).toBeLessThan(excessRatios[i - 1]!);
    }
    for (const r of excessRatios) expect(r).toBeGreaterThan(4);
    expect(excessRatios[excessRatios.length - 1]!).toBeCloseTo(4, 2);
  });

  it("a pupil lying IN the object plane is refused, not returned as a miss", () => {
    // The boundary between the two orientations, and the one position where no
    // ray along the line ever reaches the optics. The object distance is chosen
    // FROM the computed pupil, so the difference is exactly zero in f64.
    const probe = pupils(at(BFD + 20, 2), LINE_D);
    const s = at(BFD + 20, 2, -probe.entrance.z);
    expect(pupils(s, LINE_D).entrance.z).toBe(-(-probe.entrance.z));
    expect(() => aimRay(s, pupils(s, LINE_D), 0, { px: 1, py: 0 }, LINE_D)).toThrow(
      /entrance pupil lies in the object plane/,
    );
  });
});
