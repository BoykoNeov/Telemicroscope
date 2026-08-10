import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { asCompiled } from "../src/trace/compile";
import { traceRay } from "../src/trace/sequential";
import { systemProperties } from "../src/trace/paraxial";
import { pupils, resolveStopRadius } from "../src/pupil/pupils";
import { aimRay, chiefRay, pupilGrid, pupilFan } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { spotDiagram } from "../src/analysis/spot";
import { paraxialImageOffset, withFocus } from "../src/analysis/focus";
import { objectNumericalAperture, lateralMagnification } from "../src/pupil/microscope";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6u — object-space ray aiming, and telecentricity.
 *
 * § 6a's surviving immersion blocker, and the last of its three. Real
 * objectives put the aperture stop at the **back focal plane**, which makes
 * them object-space telecentric: chief rays leave the specimen parallel to the
 * axis, so magnification does not drift with defocus. That puts the entrance
 * pupil at infinity, and `aimRay` refused it outright — so every microscope in
 * this repo has been carrying its stop on the objective's own rim instead, and
 * § 6f, § 6h, § 6m and § 6o all say "telecentricity is assumed" about their
 * *illumination* while the objective itself was not.
 *
 * The refusal was right about the diagnosis and wrong to stop at it. Aiming at
 * a POINT is not what aiming means — it is what aiming reduces to when the
 * pupil is a finite distance away. A pupil at infinity is a set of DIRECTIONS,
 * so a normalized pupil coordinate names a slope, and the construction is the
 * same one limit further out. This step adds **no physics**: it is the paraxial
 * pupil relation read at A = 0.
 */

const STOP_R = 2;
const OBJECT_DISTANCE = 200;

/**
 * A thick, asymmetric singlet — deliberately not thin and not equiconvex, so
 * nothing below can be passing because a thin-lens identity happens to hold —
 * with a plane dummy surface as the stop `stopZ` mm past its last vertex.
 */
const LENS = [
  { kind: "refract" as const, curvature: 1 / 40, semiAperture: 20, thickness: 9, medium: "N-BK7" },
  { kind: "refract" as const, curvature: -1 / 80, semiAperture: 20, thickness: 0, medium: "AIR" },
];
const GROUP = systemProperties({ surfaces: LENS }, LINE_D);

const at = (stopZ: number, stopRadius = STOP_R, distance = OBJECT_DISTANCE): OpticalSystem => ({
  prescription: {
    surfaces: [
      LENS[0]!,
      { ...LENS[1]!, thickness: stopZ },
      { kind: "refract", curvature: 0, semiAperture: 30, thickness: 120, medium: "AIR", isStop: true },
    ],
  },
  aperture: { kind: "stopRadius", value: stopRadius },
  field: { kind: "objectHeight", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "finite", distance },
});

/** The telecentric configuration: the stop sits exactly on the back focal plane. */
const TELECENTRIC = at(GROUP.bfd);

/** Height at which a traced ray crosses the stop plane. */
function heightAtStop(system: OpticalSystem, ray: ReturnType<typeof chiefRay>): number {
  const traced = traceRay(system.prescription, ray);
  expect(traced.status).toBe("ok");
  const r = traced.ray!;
  const stopZ = asCompiled(system.prescription).surfaces[2]!.vertexZ;
  return r.origin.x + ((stopZ - r.origin.z) / r.dir.z) * r.dir.x;
}

describe("§ 6u.1 — the aperture of a pupil at infinity is a slope, and it is stopRadius/f", () => {
  it("the entrance pupil is at infinity when the stop is at the back focal plane", () => {
    const p = pupils(TELECENTRIC, LINE_D);
    expect(p.entrance.z).toBe(-Infinity);
    expect(p.entrance.radius).toBe(Infinity);
  });

  it("the slope aperture is stopRadius/f_group — BITWISE, and on a thick lens", () => {
    // Not a thin-lens result and not an approximation. `imageStopBackward`
    // traces {y: 0, u: 1} back from the stop, which applies the inverse of the
    // object→stop matrix; with unit determinant that carries (0,1) to (−B, A).
    // So the branch's own condition is A = 0 and the height it exits with is B,
    // and "stop at the back focal plane" is exactly what makes B the group's
    // focal length: y_stop = f·u, with the principal-plane offsets cancelling.
    const p = pupils(TELECENTRIC, LINE_D);
    expect(p.entrance.slopeRadius).toBe(STOP_R / GROUP.efl);
  });

  it("the slope aperture is linear in the stop radius, as an aperture must be", () => {
    for (const r of [0.5, 1, 4, 8]) {
      expect(pupils(at(GROUP.bfd, r), LINE_D).entrance.slopeRadius).toBe(r / GROUP.efl);
    }
  });

  it("radius finite XOR slopeRadius defined — the invariant callers rely on", () => {
    const tele = pupils(TELECENTRIC, LINE_D).entrance;
    expect(Number.isFinite(tele.radius)).toBe(false);
    expect(tele.slopeRadius).toBeTypeOf("number");

    const ordinary = pupils(at(20), LINE_D).entrance;
    expect(Number.isFinite(ordinary.radius)).toBe(true);
    expect(ordinary.slopeRadius).toBeUndefined();
  });
});

describe("§ 6u.2 — the chief ray is parallel to the axis, and it lands on the stop centre", () => {
  it("every object height launches its chief ray along +z exactly", () => {
    // Bitwise, not to a tolerance: the aim contains no object height at all,
    // which is what A = 0 means. This is the definition being satisfied by
    // construction — the rung below is the one that checks the construction.
    const p = pupils(TELECENTRIC, LINE_D);
    for (const h of [0, 0.5, 2, 5, 12]) {
      const c = chiefRay(TELECENTRIC, p, h, LINE_D);
      expect(c.dir.x).toBe(0);
      expect(c.dir.y).toBe(0);
      expect(c.dir.z).toBe(1);
    }
  });

  it("the TRACED chief ray reaches the stop centre, missing by a cubic in the field", () => {
    // The pin with teeth. A ray parallel to the axis is only the chief ray if it
    // actually passes through the stop centre, and `aimRay` targets the PARAXIAL
    // pupil, so it does not do so exactly. The honest statement is an ORDER.
    //
    // Measured ×8.00 per doubling of object height — the third-order cubic, the
    // same constant § 6h.1 reads on distortion, here in the pupil rather than in
    // the image. On axis it is exactly zero.
    const p = pupils(TELECENTRIC, LINE_D);
    expect(heightAtStop(TELECENTRIC, chiefRay(TELECENTRIC, p, 0, LINE_D))).toBe(0);

    const misses = [0.25, 0.5, 1, 2, 4].map((h) =>
      Math.abs(heightAtStop(TELECENTRIC, chiefRay(TELECENTRIC, p, h, LINE_D))),
    );
    const ratios = misses.slice(1).map((m, i) => m / misses[i]!);
    // 8.0013, 8.0052, 8.0209, 8.0846 — approaching 8 from above as h shrinks,
    // the excess being the fifth-order term, exactly as § 1.5.2's aperture sweep.
    for (const r of ratios) expect(r).toBeGreaterThan(8);
    expect(ratios[0]!).toBeCloseTo(8, 2);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
  });
});

describe("§ 6u.3 — magnification does not drift with defocus, which is the whole point", () => {
  /**
   * THE EXPERIMENT, named because two different ones are defensible: the
   * **object plane moves and the image plane is held fixed**. That is what a
   * telecentric instrument is bought for — the image blurs but does not change
   * size — and it is the one the δz/L control below belongs to. Moving the
   * object and refocusing is a different measurement and is not this rung.
   */
  it("telecentric: the magnification is BITWISE unchanged as the object moves", () => {
    const base = lateralMagnification(at(GROUP.bfd, STOP_R, OBJECT_DISTANCE), 2, LINE_D);
    for (const dz of [2, 5, 10, 20]) {
      expect(lateralMagnification(at(GROUP.bfd, STOP_R, OBJECT_DISTANCE + dz), 2, LINE_D)).toBe(base);
    }
    // Not vacuous: it is a real image at a real magnification, not zero or one.
    expect(Math.abs(base)).toBeGreaterThan(2);
  });

  it("the control drifts, and it drifts as −δz/(L + δz) — the object-to-pupil arm", () => {
    // A non-telecentric stop, 10 mm in front of the lens, so the entrance pupil
    // is a real plane at a finite arm L from the object. Magnification goes as
    // 1/(arm), so M(δz)/M(0) = L/(L + δz) and the fractional drift is
    // −δz/(L + δz). Pinned to 1e-4; the residual is real-ray distortion at the
    // 2 mm object height the magnification is read at.
    const ctrl = (distance: number): OpticalSystem => ({
      prescription: {
        surfaces: [
          { kind: "refract", curvature: 0, semiAperture: 20, thickness: 10, medium: "AIR", isStop: true },
          LENS[0]!,
          { ...LENS[1]!, thickness: 120 },
        ],
      },
      aperture: { kind: "stopRadius", value: STOP_R },
      field: { kind: "objectHeight", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "finite", distance },
    });

    const p = pupils(ctrl(OBJECT_DISTANCE), LINE_D);
    expect(p.entrance.slopeRadius).toBeUndefined();
    const arm = p.entrance.z + OBJECT_DISTANCE;
    const base = lateralMagnification(ctrl(OBJECT_DISTANCE), 2, LINE_D);

    for (const dz of [1, 2, 5, 10, 20]) {
      const drift = (lateralMagnification(ctrl(OBJECT_DISTANCE + dz), 2, LINE_D) - base) / base;
      expect(drift / (-dz / (arm + dz))).toBeCloseTo(1, 3);
      // And it is a real effect at ordinary numbers, not a rounding artefact:
      // 20 mm of object travel costs 9.1% of magnification.
      if (dz === 20) expect(Math.abs(drift)).toBeGreaterThan(0.09);
    }
  });
});

describe("§ 6u.4 — the aperture spellings a pupil at infinity does and does not have", () => {
  it("objectNA round-trips: the delivered n·sin u is the number asked for", () => {
    // The spelling a telecentric objective is actually engraved in. The stop
    // radius is B·tan u with B off the same probe, and the delivered NA is read
    // from the aimed ray's DIRECTION COSINE — the resolved radius appears
    // nowhere in the assertion, which is § 1.5.1's discriminator reused.
    for (const NA of [0.02, 0.05, 0.1, 0.2]) {
      const s: OpticalSystem = { ...at(GROUP.bfd), aperture: { kind: "objectNA", value: NA } };
      expect(objectNumericalAperture(s, LINE_D)).toBeCloseTo(NA, 12);
    }
  });

  it("the object distance cancels out of objectNA, as telecentricity requires", () => {
    // The same engraving at three conjugates gives the same stop, bitwise. For
    // a finite pupil this is false — the arm is in the answer.
    const r0 = resolveStopRadius({ ...at(GROUP.bfd, STOP_R, 150), aperture: { kind: "objectNA", value: 0.1 } }, LINE_D);
    for (const d of [200, 400, 1000]) {
      const r = resolveStopRadius({ ...at(GROUP.bfd, STOP_R, d), aperture: { kind: "objectNA", value: 0.1 } }, LINE_D);
      expect(r).toBe(r0);
    }
  });

  it("EPD and fNumber are refused instead of returning a silent zero", () => {
    // Both divide by an infinite pupil magnification and came back **0** — an
    // aperture that closes the system, propagating as an ordinary number. That
    // is worse than the NaN the NA branch produced, because a zero survives
    // arithmetic.
    for (const spec of [{ kind: "EPD" as const, value: 10 }, { kind: "fNumber" as const, value: 8 }]) {
      expect(() => resolveStopRadius({ ...at(GROUP.bfd), aperture: spec }, LINE_D)).toThrow(
        /cannot size an entrance pupil at infinity/,
      );
    }
  });

  it("an object at infinity behind a telecentric pupil is refused", () => {
    const s: OpticalSystem = { ...at(GROUP.bfd), conjugate: { kind: "infinite" }, field: { kind: "angle", values: [0] } };
    expect(() => aimRay(s, pupils(s, LINE_D), 0, { px: 1, py: 0 }, LINE_D)).toThrow(
      /no object-space cone to aim/,
    );
  });
});

describe("§ 6u.5 — the branch is a limit, not a cliff", () => {
  it("the finite aim converges to the telecentric one, linearly in the stop offset", () => {
    // The threshold `|axis.u| < 1e-15` is an exact-zero test on an f64 paraxial
    // trace, so whether a given design lands inside it is luck. What makes that
    // benign rather than a cliff is that the two branches AGREE in the limit —
    // and they agree to first order in how far the stop sits from the back focal
    // plane, so at the threshold itself they differ by ~1e-16 relative.
    //
    // This only became measurable at § 1.5.2: before it, the finite aim on this
    // side of the back focal plane pointed backwards.
    const exact = pupils(TELECENTRIC, LINE_D).entrance.slopeRadius!;
    const offsets = [1, 1e-2, 1e-4, 1e-6, 1e-8, 1e-10];
    const diffs = offsets.map((off) => {
      const s = at(GROUP.bfd + off);
      const m = aimRay(s, pupils(s, LINE_D), 0, { px: 1, py: 0 }, LINE_D);
      return Math.abs((Math.abs(m.dir.x / m.dir.z) - exact) / exact);
    });
    // 5.6e-2, 5.3e-4, 5.3e-6, 5.3e-8, 5.3e-10, 5.3e-12 — ×100 per ×100 of
    // offset, i.e. exactly first order, over ten decades.
    for (let i = 1; i < diffs.length; i++) {
      expect(diffs[i - 1]! / diffs[i]!).toBeCloseTo(100, -1.5);
    }
    expect(diffs[diffs.length - 1]!).toBeLessThan(1e-11);
  });
});

describe("§ 6u.6 — what the branch unblocks: the downstream stack runs", () => {
  /**
   * The point of the step. `opdMap`, `spotDiagram` and everything built on them
   * funnel through `aimRay`, so the single refusal made a telecentric system
   * un-analysable — not degraded, unavailable. These are capability rungs: they
   * assert that the analyses run and are sane, not new physics.
   */
  const focused = withFocus(TELECENTRIC, paraxialImageOffset(TELECENTRIC, LINE_D));

  it("opdMap fills the pupil with nothing lost, on and off axis", () => {
    for (const h of [0, 1]) {
      const map = opdMap(focused, h, LINE_D, pupilGrid(21));
      expect(map.lost).toBe(0);
      expect(map.samples.length).toBe(pupilGrid(21).length);
      expect(Number.isFinite(map.rmsWaves)).toBe(true);
    }
  });

  it("a spot diagram forms, and the axial one is mirror-symmetric", () => {
    const spot = spotDiagram(focused, 0, LINE_D, pupilGrid(21));
    expect(spot.lost).toBe(0);
    expect(spot.rmsRadius).toBeGreaterThan(0);

    // The symmetry is asserted on a sample set that HAS it. `pupilGrid`'s does
    // not: `(i/(n−1))·2 − 1` yields −0.9 exactly but 0.9000000000000001, so the
    // unit-disc clip keeps different points on the two sides and the grid's own
    // Σpx is −1.2 over 313 points. That bias is the sampler's and predates this
    // step — an ordinary non-telecentric system carries it identically, at
    // 5.2e-5 of centroid against this one's 8.9e-4, the ratio being the two spot
    // sizes and nothing else. Fixing it would move pinned numbers across the
    // ladder and belongs nowhere near here; what belongs here is not leaning on
    // it. A fan is symmetric by construction.
    const fan = pupilFan(9);
    const onFan = spotDiagram(focused, 0, LINE_D, fan);
    const xs = onFan.points.map((p) => p.x);
    for (let i = 0; i < xs.length; i++) {
      expect(xs[i]!).toBeCloseTo(-xs[xs.length - 1 - i]!, 12);
    }
  });

  it("the off-axis pupil is filled the same way as the axial one — no field bias", () => {
    // What telecentricity buys the sampling: the cone is field-independent, so
    // the same pupil grid is the same physical bundle at every object height.
    const counts = [0, 1, 3].map((h) => opdMap(focused, h, LINE_D, pupilGrid(15)).samples.length);
    expect(new Set(counts).size).toBe(1);
  });
});
