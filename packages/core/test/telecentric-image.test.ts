import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { systemProperties, paraxialTrace } from "../src/trace/paraxial";
import { afocalTelescope } from "../src/trace/compose";
import { pupils, resolveStopRadius, imagePlaneZ } from "../src/pupil/pupils";
import { asCompiled } from "../src/trace/compile";
import { chiefRay, pupilGrid } from "../src/pupil/aiming";
import { afocalProperties } from "../src/pupil/afocal";
import { opdMap } from "../src/pupil/opd";
import { bestFocus, paraxialImageOffset } from "../src/analysis/focus";
import { systemPupil, psf, imagePixelScaleMm } from "../src/wave/psf";
import { geometricPsf } from "../src/wave/geometric";
import { objectFieldFrame, tracedPupil } from "../src/imaging/object-field";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6aj — image-space telecentricity: the exit pupil's slope.
 *
 * § 6u grew `PupilPlane.slopeRadius` for the ENTRANCE pupil and left the exit
 * side without it; § 6u's own deferral list has carried "image-space
 * telecentricity, which still has no caller" ever since. § 5s.5 then made the
 * gap load-bearing: it taught the entrance side to REFUSE a pupil whose
 * placement makes an area meaningless, and to redirect the caller to the slope
 * instead — while the exit side had no slope to redirect to, so its audit was
 * recorded with nine reader file:lines and postponed.
 *
 * This step grows the quantity. It adds **no physics**: it is the same paraxial
 * pupil relation read at the other end, `u' = C·y + D·u` at `D = 0`.
 *
 * What makes the field more than write-only: `imageNA` — one of the five
 * aperture spellings the bench editor offers — returned a silent **NaN** on an
 * image-space telecentric system, and a silent **0** on an ordinary finite one
 * whose exit pupil happens to land on the image plane. Both are repaired here,
 * and the second is reachable at entirely plausible millimetres.
 */

const STOP_R = 2;

/**
 * The same thick, asymmetric singlet § 6u uses as its front group, here the
 * TAIL — deliberately not thin and not equiconvex, so nothing below passes
 * because a thin-lens identity happens to hold. The stop is a plane dummy
 * surface `gap` mm AHEAD of it, which is § 6u's arrangement mirrored.
 */
const LENS_FRONT = {
  kind: "refract" as const,
  curvature: 1 / 40,
  semiAperture: 20,
  thickness: 9,
  medium: "N-BK7",
};
const lensBack = (medium: string, thickness: number) => ({
  kind: "refract" as const,
  curvature: -1 / 80,
  semiAperture: 20,
  thickness,
  medium,
});

const group = (medium: string): Prescription => ({
  surfaces: [LENS_FRONT, lensBack(medium, 0)],
});
const GROUP = systemProperties(group("AIR"), LINE_D);

/**
 * The tail's FRONT focal distance — the gap that fires the branch.
 *
 * By definition rather than by search: a ray leaving the stop centre at slope 1
 * arrives at the tail's first vertex at height `t` and leaves it with slope
 * `C·t + D`, so the gap that makes that zero is `-D/C`. Both elements come off
 * the public paraxial trace of the tail alone. § 6aj.1 pins it against the
 * textbook thick-lens closed form in air.
 */
const frontFocalDistance = (medium: string): number => {
  const g = group(medium);
  const c = paraxialTrace(g, LINE_D, { y: 1, u: 0 }).u;
  const d = paraxialTrace(g, LINE_D, { y: 0, u: 1 }).u;
  return -d / c;
};

const FFD = frontFocalDistance("AIR");

/** Stop, `gap` of air, then the tail; image plane at the tail's rear focus. */
const at = (
  gap: number,
  aperture: OpticalSystem["aperture"] = { kind: "stopRadius", value: STOP_R },
  medium = "AIR",
): OpticalSystem => ({
  prescription: {
    surfaces: [
      { kind: "refract", curvature: 0, semiAperture: 30, thickness: gap, medium: "AIR", isStop: true },
      LENS_FRONT,
      lensBack(medium, systemProperties(group(medium), LINE_D).bfd),
    ],
  },
  aperture,
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LINE_D, weight: 1 }],
  conjugate: { kind: "infinite" },
});

const stopR = (value: number): OpticalSystem["aperture"] => ({ kind: "stopRadius", value });
const imageNA = (value: number): OpticalSystem["aperture"] => ({ kind: "imageNA", value });

/** The telecentric configuration: the stop sits exactly on the tail's front focal plane. */
const TELECENTRIC = at(FFD);
const ORDINARY = at(20);

/**
 * `objectFieldFrame` refuses an infinite conjugate outright, so the object-field
 * reader is measured on the same arrangement fed by a specimen 400 mm ahead of
 * the stop, its image plane solved paraxially. The gap that fires the branch is
 * the tail's front focal distance whatever the object does — the stop→image
 * matrix does not contain the object.
 */
const finiteAt = (gap: number): OpticalSystem => {
  const base: OpticalSystem = {
    prescription: {
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: 30, thickness: gap, medium: "AIR", isStop: true },
        LENS_FRONT,
        lensBack("AIR", 100),
      ],
    },
    aperture: stopR(STOP_R),
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance: 400 },
  };
  return { ...base, imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, LINE_D) } };
};

describe("§ 6aj.1 — the gap that fires the branch is the tail's front focal distance", () => {
  it("reproduces the textbook thick-lens FFD, and its BFD mirror", () => {
    // Both members of the same closed pair, so the sign convention is
    // established by the one the engine already agrees with rather than assumed
    // for the one being introduced:
    //   BFD = f·(1 - (n-1)d/(n·R1)),  FFD = f·(1 + (n-1)d/(n·R2)).
    const n = getMedium("N-BK7").n(LINE_D);
    const d = 9;
    const R1 = 40;
    const R2 = -80;
    const f = 1 / ((n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * d) / (n * R1 * R2)));

    expect(f).toBeCloseTo(GROUP.efl, 12);
    expect(f * (1 - ((n - 1) * d) / (n * R1))).toBeCloseTo(GROUP.bfd, 12);
    expect(f * (1 + ((n - 1) * d) / (n * R2))).toBeCloseTo(FFD, 12);
    expect(FFD).toBeCloseTo(50.92301209721679, 9);
  });

  it("the exit pupil is at infinity there, and nowhere near it at an ordinary gap", () => {
    const tele = pupils(TELECENTRIC, LINE_D).exit;
    expect(tele.z).toBe(Infinity);
    expect(tele.radius).toBe(Infinity);

    const ord = pupils(ORDINARY, LINE_D).exit;
    expect(Number.isFinite(ord.z)).toBe(true);
    expect(ord.radius).toBeCloseTo(3.4248104237017927, 12);
  });

  it("radius finite XOR slopeRadius defined — now on the exit plane too", () => {
    const tele = pupils(TELECENTRIC, LINE_D).exit;
    expect(Number.isFinite(tele.radius)).toBe(false);
    expect(tele.slopeRadius).toBeTypeOf("number");

    const ord = pupils(ORDINARY, LINE_D).exit;
    expect(Number.isFinite(ord.radius)).toBe(true);
    expect(ord.slopeRadius).toBeUndefined();
  });
});

describe("§ 6aj.2 — the branch's condition is that chief rays LEAVE parallel to the axis", () => {
  /**
   * This is the rung that carries the branch, and § 6aj.3's value cannot: the
   * slope is `|C|·stopRadius`, and `C = -1/f` for the tail wherever the stop
   * sits, so a stub returning `stopRadius/f` unconditionally would satisfy both
   * the value and the linearity. `D = 0` is the condition, and its physical
   * content is measured here with the EXACT tracer rather than with the
   * paraxial one that defines it.
   */
  const exitSlope = (system: OpticalSystem, thetaRad: number): number => {
    const traced = traceRay(system.prescription, chiefRay(system, pupils(system, LINE_D), thetaRad, LINE_D));
    expect(traced.status).toBe("ok");
    return traced.ray!.dir.x / traced.ray!.dir.z;
  };

  it("the telecentric chief ray exits along +z, and the ordinary one does not", () => {
    // Not bitwise, and the residual is not noise: the aim is paraxial, so what
    // is left is the tail's own chief-ray (pupil) aberration, and it grows as
    // theta^3 — 1.1e-14 at 0.001 rad and 1.4e-12 at 0.005, five times the angle
    // for 125 times the departure. Against it the ordinary gap's chief ray
    // leaves at 1.0e-5 and 5.1e-4: four to five orders larger, and LINEAR in
    // theta, which is what "not telecentric" looks like.
    for (const [theta, bound] of [
      [0.001, 1e-12],
      [0.005, 1e-10],
      [0.02, 1e-8],
      [0.05, 1e-7],
    ] as const) {
      expect(Math.abs(exitSlope(TELECENTRIC, theta))).toBeLessThan(bound);
      expect(Math.abs(exitSlope(ORDINARY, theta))).toBeGreaterThan(1e-5);
    }
  });

  it("the ordinary chief ray's exit slope is linear in the field angle", () => {
    // The negative control's own control: a departure scaling like the
    // telecentric residual would mean the two are one phenomenon at two sizes
    // rather than two phenomena.
    const a = Math.abs(exitSlope(ORDINARY, 0.001));
    const b = Math.abs(exitSlope(ORDINARY, 0.05));
    expect(b / a).toBeCloseTo(50, 1);
  });
});

describe("§ 6aj.3 — the aperture of an exit pupil at infinity is a slope, and it is stopRadius/f", () => {
  it("the slope aperture is stopRadius/f_tail — BITWISE, and on a thick lens", () => {
    // `height` starts {y: 1, u: 0} at the stop and is unchanged by the free
    // transfer across the gap, so it enters the tail as exactly the ray whose
    // output slope DEFINES the focal length: `efl = -y0/u_out`. The two are the
    // same arithmetic on the same trace, which is why this is `toBe`.
    expect(pupils(TELECENTRIC, LINE_D).exit.slopeRadius).toBe(STOP_R / GROUP.efl);
  });

  it("the slope aperture is linear in the stop radius, as an aperture must be", () => {
    for (const r of [0.5, 1, 4, 8]) {
      expect(pupils(at(FFD, stopR(r)), LINE_D).exit.slopeRadius).toBe(r / GROUP.efl);
    }
  });

  it("magnification = det/D, so it diverges exactly where the slope takes over", () => {
    // Why the invariant is exhaustive rather than merely observed. With the
    // stop→image matrix [[A,B],[C,D]] the pupil sits at dz = -B/D and its
    // magnification is A + C·dz = (AD - BC)/D = det/D. The determinant is
    // n_stop/n_image and cannot vanish, so `magnification` is never zero — and
    // `radius` is infinite for exactly one reason, D = 0.
    for (const gap of [0, 10, 20, 40, 80, 200]) {
      // D is the tail's own axis-ray slope, the same quantity the branch tests.
      const d = paraxialTrace(group("AIR"), LINE_D, { y: gap, u: 1 }).u;
      const exit = pupils(at(gap), LINE_D).exit;
      expect(exit.magnification).toBeCloseTo(1 / d, 9);
      expect(Math.abs(exit.magnification)).toBeGreaterThan(0);
    }
  });
});

describe("§ 6aj.4 — imageNA is the spelling that survives, and it carries the index", () => {
  it("resolves through the slope where it used to come back NaN", () => {
    const r = resolveStopRadius(at(FFD, imageNA(0.05)), LINE_D);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeCloseTo(2.650952117866665, 12);
  });

  it("the telecentric branch is the LIMIT of the finite one, not a special case", () => {
    // The finite branch runs on an arm and a magnification that both diverge;
    // the telecentric branch runs on neither. They agree to twelve digits four
    // decades in — so the new branch is where the old formula was going, and
    // the old formula's value AT the point was NaN.
    const exact = resolveStopRadius(at(FFD, imageNA(0.05)), LINE_D);
    for (const eps of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      expect(resolveStopRadius(at(FFD * (1 - eps), imageNA(0.05)), LINE_D)).toBeCloseTo(exact, 12);
    }
  });

  it("an immersed image space reads its own tan u', and n'·sin u' comes back the NA", () => {
    // The exit side needs no determinant correction — `height.u` is already the
    // raw geometric slope in the image medium — and this is the rung that would
    // catch it if it did. Round trip: ask for an image NA, resolve the stop,
    // read the slope back, rebuild Abbe's n'·sin u' from it.
    const wetFfd = frontFocalDistance("WATER");
    const wetGroup = systemProperties(group("WATER"), LINE_D);
    const nWater = getMedium("WATER").n(LINE_D);

    expect(pupils(at(wetFfd, stopR(STOP_R), "WATER"), LINE_D).exit.slopeRadius).toBe(STOP_R / wetGroup.efl);

    for (const na of [0.02, 0.05, 0.1]) {
      const r = resolveStopRadius(at(wetFfd, imageNA(na), "WATER"), LINE_D);
      const exit = pupils(at(wetFfd, stopR(r), "WATER"), LINE_D).exit;
      const tan = exit.slopeRadius!;
      expect(Math.abs(exit.n)).toBeCloseTo(nWater, 12);
      expect(Math.abs(exit.n) * (tan / Math.sqrt(1 + tan * tan))).toBeCloseTo(na, 12);
      // Negative control: reading the slope as the NA — dropping the index —
      // misses by the index itself, 25% in water.
      expect(tan / Math.sqrt(1 + tan * tan)).toBeCloseTo(na / nWater, 12);
    }
  });
});

describe("§ 6aj.5 — the exit pupil ON the image plane: a field stop wearing the aperture flag", () => {
  /**
   * The reachable half of this side, and it is not an infinity. Put the sensor
   * where the exit pupil is — which is a thing an observer does on purpose, to
   * look at the pupil rather than at the image — and the arm the `imageNA`
   * spelling divides by is zero. Every number in sight is plausible: an exit
   * pupil 1.53 mm across, 89.5 mm behind the last vertex.
   *
   * What it means physically is that the stop has become conjugate to the image
   * plane — a FIELD stop wearing the aperture flag. Every ray that clears it
   * arrives at the same image point whatever its angle, so no stop radius
   * produces a given u', and the answer is not a small number but no number.
   * The formula returned a silent **0**: an aperture that closes the system.
   */
  const ON_PUPIL_GAP = 120;

  /** The same arrangement with its sensor moved onto the exit pupil. */
  const onPupil = (aperture: OpticalSystem["aperture"], nudge = 0): OpticalSystem => {
    const nominal = at(ON_PUPIL_GAP);
    const c = asCompiled(nominal.prescription);
    const lastVertexZ = c.surfaces[c.surfaces.length - 1]!.vertexZ;
    return {
      ...nominal,
      aperture,
      imageSurface: { offsetFromLastVertex: pupils(nominal, LINE_D).exit.z - lastVertexZ + nudge },
    };
  };

  it("is reachable at plausible numbers, with nothing infinite in sight", () => {
    const system = onPupil(stopR(STOP_R));
    const exit = pupils(system, LINE_D).exit;
    expect(exit.radius).toBeCloseTo(1.5331510156733053, 9);
    expect(exit.z).toBeCloseTo(218.4855607667929, 9);
    expect(exit.slopeRadius).toBeUndefined();
    expect(imagePlaneZ(asCompiled(system.prescription), system) - exit.z).toBe(0);
  });

  it("imageNA refuses there instead of answering 0", () => {
    expect(() => resolveStopRadius(onPupil(imageNA(0.05)), LINE_D)).toThrow(/conjugate to the image/);
  });

  it("and a SOLVED field stop lands on it exactly, which is why the guard is an equality", () => {
    // The fixture above places the sensor by arithmetic on the pupil's own z, so
    // it could be argued into being a construction. This one is not: a relay
    // whose field stop sits at the intermediate image, placed by the front
    // lens's own back focal distance — the arrangement every eyepiece has — and
    // the arm comes back a BITWISE zero, not 1e-14. The coincidence is an
    // algebraic identity, so the two routes to it agree exactly rather than to
    // float noise, and an exact-equality guard is the right shape rather than a
    // lucky one. Reaching the noise band instead takes tuning a gap to eleven
    // digits, which is the `visual.ts:108` case: recorded, not guarded.
    const nGlass = getMedium("N-BK7").n(LINE_D);
    const lens = (f: number, trailing: number, semiAperture: number) => {
      const curvature = 1 / (2 * (nGlass - 1) * f);
      return [
        { kind: "refract" as const, curvature, semiAperture, thickness: 1e-3, medium: "N-BK7" },
        { kind: "refract" as const, curvature: -curvature, semiAperture, thickness: trailing, medium: "AIR" },
      ];
    };
    const intermediate = systemProperties({ surfaces: lens(50, 0, 20) }, LINE_D).bfd;
    const relay = (aperture: OpticalSystem["aperture"]): OpticalSystem => {
      const base: OpticalSystem = {
        prescription: {
          surfaces: [
            ...lens(50, intermediate, 20),
            { kind: "refract", curvature: 0, semiAperture: 8, thickness: 100, medium: "AIR", isStop: true },
            ...lens(50, 75, 20),
          ],
        },
        aperture,
        field: { kind: "angle", values: [0] },
        wavelengths: [{ nm: LINE_D, weight: 1 }],
        conjugate: { kind: "infinite" },
      };
      return { ...base, imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, LINE_D) } };
    };

    const system = relay(stopR(8));
    const exit = pupils(system, LINE_D).exit;
    expect(imagePlaneZ(asCompiled(system.prescription), system) - exit.z).toBe(0);
    expect(exit.radius).toBeCloseTo(8, 9);
    expect(() => resolveStopRadius(relay(imageNA(0.05)), LINE_D)).toThrow(/conjugate to the image/);
  });

  it("and answers ordinarily on either side of it, because the neighbourhood is not sick", () => {
    // The refusal is on the singular point alone, and the answers around it are
    // physics rather than damage: a sensor a micron off the pupil really does
    // need a vanishing stop to fill a 0.05 cone through a vanishing arm, and the
    // radius is LINEAR in the offset — 6.5e-8 mm at a micron, 6.5e-4 at a
    // hundredth. Which is also why a tolerance here would refuse correct
    // arithmetic instead of catching anything.
    const near = resolveStopRadius(onPupil(imageNA(0.05), 1e-6), LINE_D);
    const far = resolveStopRadius(onPupil(imageNA(0.05), 1e-2), LINE_D);
    expect(near).toBeCloseTo(6.53068312175291e-8, 15);
    expect(far / near).toBeCloseTo(1e4, 4);
    // Symmetric: the sensor may sit either side of the pupil.
    expect(resolveStopRadius(onPupil(imageNA(0.05), -1e-6), LINE_D)).toBeCloseTo(near, 15);
  });
});

describe("§ 6aj.6 — the nine readers, measured", () => {
  /**
   * § 5s.5 listed nine exit-side readers and said they were not worth auditing
   * until the slope existed. It exists now, so this is that audit — as
   * measurements rather than as a list, so the step that guards them inherits
   * numbers instead of adjectives. NOTHING here is repaired: the reachable ones
   * all fail through the same single line, and repairing them is one change
   * with its own rungs, not a postscript to this one.
   */

  it("focus.ts and psf() refuse — the two that were already guarded", () => {
    expect(() => bestFocus(TELECENTRIC, "minRmsWavefront")).toThrow(/exit pupil is at infinity/);
    expect(() => psf(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 })).toThrow(/finite exit pupil/);
    // Both answer ordinarily on the same fixture one gap away, so the refusals
    // are about the pupil and not about the system.
    expect(bestFocus(ORDINARY, "minRmsWavefront").offsetFromLastVertex).toBeCloseTo(48.852204447214056, 6);
    expect(psf(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBeCloseTo(0.001944562477428594, 12);
  });

  it("the four core readers that do not refuse answer with a pixel scale of ZERO", () => {
    // What all four share is the EXPRESSION, not one line of it. The pixel
    // scale is lambda·R/(n'·size·delta) with delta = 2·r_exit/N, so an infinite
    // exit radius alone drives it to zero whatever R is — measured:
    // (R = 1, r = inf) and (R = 1e6, r = inf) both give exactly 0. What
    // `opd.ts:132` decides is only WHICH silent answer: it substitutes a
    // reference sphere of radius 1 when the pupil has no finite z — correct for
    // the OPD, which uses the sphere only as a common subtrahend — and that
    // turns an indeterminate (inf, inf) NaN into a definite 0. A zero is the
    // worse of the two, because it propagates as a number. So the repair has
    // TWO sites, not one: `imagePixelScaleMm` and `geometric.ts:145`'s inline
    // copy of the same formula both have to consume the slope.
    const map = opdMap(TELECENTRIC, 0, LINE_D, pupilGrid(9), {});
    expect(map.referenceRadius).toBe(1);
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeCloseTo(0.012748116054873335, 9);

    const sp = systemPupil(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 });
    expect(sp.scale.exitRadius).toBe(Infinity);
    expect(imagePixelScaleMm(sp.scale, 64, 16)).toBe(0);

    expect(tracedPupil(TELECENTRIC, 0, LINE_D).exitRadius).toBe(Infinity);
    expect(geometricPsf(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBe(0);

    const frame = objectFieldFrame(finiteAt(FFD), { size: 32, pupilSamples: 16 });
    expect(frame.scale.exitRadius).toBe(Infinity);
    expect(frame.pixelScaleMm).toBe(0);
    expect(frame.halfExtentMm).toBe(0);

    // And the same four on the same fixture one gap away are ordinary, so the
    // zero is the pupil's and not the arrangement's.
    expect(imagePixelScaleMm(systemPupil(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16)).toBeGreaterThan(0);
    expect(objectFieldFrame(finiteAt(20), { size: 32, pupilSamples: 16 }).pixelScaleMm).toBeGreaterThan(0);
  });

  it("and it is the exit radius that zeroes the scale, not the substituted sphere", () => {
    // Asserted rather than reasoned, because the difference decides how many
    // sites the next step has to touch. Feed `imagePixelScaleMm` the pair
    // directly: an infinite exit radius gives 0 for ANY finite R, and only the
    // (inf, inf) pair — the one `opd.ts:132` prevents — gives NaN.
    const base = { wavelengthNm: LINE_D, nImage: 1 };
    expect(imagePixelScaleMm({ ...base, referenceRadius: 1, exitRadius: Infinity }, 64, 16)).toBe(0);
    expect(imagePixelScaleMm({ ...base, referenceRadius: 1e6, exitRadius: Infinity }, 64, 16)).toBe(0);
    expect(imagePixelScaleMm({ ...base, referenceRadius: Infinity, exitRadius: Infinity }, 64, 16)).toBeNaN();
    // And with an ordinary pupil it is an ordinary number, so the zero is the
    // infinity's and not the function's.
    expect(imagePixelScaleMm({ ...base, referenceRadius: 90.67652583591146, exitRadius: 3.4248104237017927 }, 64, 16))
      .toBeCloseTo(0.001944562477428594, 15);
  });

  it("and the quantity that pair was standing in for is the slope itself", () => {
    // Which is what makes the repair a substitution rather than a design. The
    // ratio the pixel scale depends on is r_exit/R, and at D = 0 that IS
    // |C|·stopRadius: with det = AD - BC and D = 0, det = -BC, so
    // r/R -> det·stopRadius/B = -C·stopRadius. Today both members diverge and
    // the ratio is computed as infinity over 1.
    const slope = pupils(TELECENTRIC, LINE_D).exit.slopeRadius!;
    for (const eps of [1e-1, 1e-2, 1e-3, 1e-4]) {
      const near = opdMap(at(FFD * (1 - eps)), 0, LINE_D, pupilGrid(5), {});
      expect(near.pupil.exit.radius / near.referenceRadius).toBeCloseTo(slope, 12);
    }
    const there = opdMap(TELECENTRIC, 0, LINE_D, pupilGrid(5), {});
    expect(there.pupil.exit.radius / there.referenceRadius).toBe(Infinity);
  });

  it("the four afocal readers cannot see it at all, and the reason is structural", () => {
    // `afocal.ts`, `visual.ts` and both `app/eyepiece.ts` sites read the exit
    // pupil of a chain that is AFOCAL with its stop on surface 0. Write the
    // whole-system matrix as M_after·R0: its C is C_after - D_after·phi0/n1,
    // and afocality sets that to zero, so D_after = 0 would force C_after = 0
    // too and make M_after singular. Its determinant is n_stop/n_image and
    // cannot vanish. So the branch is not reachable there — which is stronger
    // than the "not reached by the shipped presets" § 5s.5 could say about
    // `visual.ts:108`.
    const thinLens = (fMm: number, semiApMm: number, isStop = false): Prescription => {
      const n = getMedium("N-BK7").n(LINE_D);
      const curvature = 1 / (2 * (n - 1) * fMm);
      return {
        surfaces: [
          { kind: "refract", curvature, semiAperture: semiApMm, thickness: 1e-3, medium: "N-BK7", isStop },
          { kind: "refract", curvature: -curvature, semiAperture: semiApMm, thickness: fMm, medium: "AIR" },
        ],
      };
    };
    const scope = afocalTelescope({
      objective: thinLens(400, 40, true),
      eyepiece: thinLens(25, 12),
      wavelengthNm: LINE_D,
    });
    const props = afocalProperties(scope, LINE_D, 40);
    expect(Number.isFinite(props.exitPupilRadiusMm)).toBe(true);
    expect(props.exitPupilRadiusMm).toBeCloseTo(2.50001545203981, 9);

    // Corroboration rather than proof: wiggling the gap breaks afocality, and
    // the exit pupil stays finite and smooth over ±400 mm of it — the
    // divergence is not merely avoided at the solved spacing, it is nowhere
    // nearby.
    for (const delta of [-100, -20, -1, 0, 1, 20, 100, 400]) {
      const wiggled: Prescription = {
        ...scope.prescription,
        surfaces: scope.prescription.surfaces.map((s, i) =>
          i === 1 ? { ...s, thickness: s.thickness + delta } : s,
        ),
      };
      const exit = pupils(
        {
          prescription: wiggled,
          aperture: stopR(40),
          field: { kind: "angle", values: [0] },
          wavelengths: [{ nm: LINE_D, weight: 1 }],
          conjugate: { kind: "infinite" },
        },
        LINE_D,
      ).exit;
      expect(Number.isFinite(exit.radius)).toBe(true);
      expect(exit.radius).toBeGreaterThan(1);
      expect(exit.radius).toBeLessThan(4);
    }
  });
});
