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
import {
  systemPupil,
  psf,
  imagePixelScaleMm,
  psfFromPupilFunction,
  type PupilFunction,
} from "../src/wave/psf";
import { geometricPsf, adaptivePsf } from "../src/wave/geometric";
import { objectFieldFrame, tracedPupil, scaleDrift } from "../src/imaging/object-field";
import {
  pupilNumericalAperture,
  spatialFrequencyCyclesPerMm,
} from "../src/illumination/transfer";
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

  it("the two that were already guarded answer ordinarily one gap away", () => {
    // This rung measured the pair as REFUSALS: `bestFocus` threw "exit pupil is
    // at infinity" and `psf` threw "telecentric image space is not supported
    // yet". § 6ak lifted both — they turned out to be one refusal, since
    // `bestFocus`'s merit path reaches `psf`'s guard — and § 6ak.4 pins what
    // they answer instead. What is still this rung's own measurement is the
    // control: the same two on the same fixture one gap away were ordinary,
    // which is what made the refusals about the pupil and not about the system.
    expect(bestFocus(ORDINARY, "minRmsWavefront").offsetFromLastVertex).toBeCloseTo(48.852204447214056, 6);
    expect(psf(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBeCloseTo(0.001944562477428594, 12);
  });

  it("the four core readers that do not refuse saw an exit pupil at infinity", () => {
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

    // The INFINITE RADIUS is this rung's measurement and survives § 6ak — the
    // exit pupil really is at infinity, and every one of these readers really
    // does see it. What each of them then REPORTED is the part § 6ak repaired:
    // `imagePixelScaleMm` and `geometricPsf` read exactly 0 here, and the frame
    // read a pixel scale AND a half-extent of 0 — a frame with no size. The
    // repaired numbers are pinned at § 6ak.1 and § 6ak.5; what is asserted here
    // is only that they are no longer the silent zero.
    const sp = systemPupil(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 });
    expect(sp.scale.exitRadius).toBe(Infinity);
    expect(imagePixelScaleMm(sp.scale, 64, 16)).toBeGreaterThan(0);

    expect(tracedPupil(TELECENTRIC, 0, LINE_D).exitRadius).toBe(Infinity);
    expect(geometricPsf(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBeGreaterThan(0);

    const frame = objectFieldFrame(finiteAt(FFD), { size: 32, pupilSamples: 16 });
    expect(frame.scale.exitRadius).toBe(Infinity);
    expect(frame.pixelScaleMm).toBeGreaterThan(0);
    expect(frame.halfExtentMm).toBeGreaterThan(0);

    // And the same four on the same fixture one gap away were ordinary then and
    // are ordinary now, so the zero was the pupil's and not the arrangement's.
    expect(imagePixelScaleMm(systemPupil(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16)).toBeGreaterThan(0);
    expect(objectFieldFrame(finiteAt(20), { size: 32, pupilSamples: 16 }).pixelScaleMm).toBeGreaterThan(0);
  });

  it("and it was the exit radius that zeroed the scale, not the substituted sphere", () => {
    // Asserted rather than reasoned, because the difference decided how many
    // sites § 6ak had to touch: an infinite exit radius drove the scale to zero
    // for ANY finite R — (R = 1, r = inf) and (R = 1e6, r = inf) both read
    // exactly 0 — so the repair could not be `opd.ts:132` alone, and only the
    // (inf, inf) pair, the one `opd.ts:132` prevents, ever read NaN.
    //
    // All three of those pairs are now REFUSED by the same message, which is
    // this rung inverted: a scale with no finite radius and no slope is exactly
    // what every construction site produced before § 6ak, and it is the shape
    // whose silent answer this whole thread is about. The R = 1 vs R = 1e6 pair
    // is kept because it still carries the finding — the refusal does not read
    // R either, which is the same statement that the sphere was never the cause.
    const base = { wavelengthNm: LINE_D, nImage: 1, slopeRadius: undefined };
    const noSlope = /no slope aperture/;
    expect(() => imagePixelScaleMm({ ...base, referenceRadius: 1, exitRadius: Infinity }, 64, 16)).toThrow(noSlope);
    expect(() => imagePixelScaleMm({ ...base, referenceRadius: 1e6, exitRadius: Infinity }, 64, 16)).toThrow(noSlope);
    expect(() => imagePixelScaleMm({ ...base, referenceRadius: Infinity, exitRadius: Infinity }, 64, 16)).toThrow(noSlope);
    // And with an ordinary pupil it is an ordinary number, unchanged to the last
    // digit by § 6ak — the finite branch's arithmetic was not rewritten.
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

/**
 * Step 6ak — the exit-side readers read the slope.
 *
 * § 6aj grew the quantity and § 6aj.6 audited who needed it, deliberately
 * repairing nothing. This is the repair. It adds **no physics** either: the
 * pixel scale depends on the pupil only through the ratio r_exit/R, and at the
 * telecentric point that ratio IS `slopeRadius` (§ 6aj.6's last rung pinned the
 * convergence four decades in). Every number below is that substitution.
 *
 * What it does add is a RENDERING PATH through an image-space telecentric
 * system, which § 6ae's deferral list has carried since § 6aj — because the two
 * guarded readers turned out to be one guard: `bestFocus`'s merit path reaches
 * `psf`'s, so a telecentric system could be neither focused nor rendered, and
 * lifting one without the other would have left `geometricPsf` answering while
 * `adaptivePsf` threw, on one system, decided by an aberration threshold.
 */

/** Signed distance from b to a, in units of b's last bit. */
const ulps = (a: number, b: number): number =>
  Math.round((a - b) / Math.pow(2, Math.floor(Math.log2(Math.abs(b))) - 52));

const TEL_SLOPE = 0.03776953728795632;
const SCALE_64_16 = 0.001944562477428594;

describe("§ 6ak.1 — the pixel scale reads the slope, and it is the closed form", () => {
  it("is λ·N/(2·n′·size·tan u′), computed by hand — bitwise", () => {
    const sp = systemPupil(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 });
    expect(sp.scale.exitRadius).toBe(Infinity);
    expect(sp.scale.slopeRadius).toBe(TEL_SLOPE);

    // Substituting Δ = 2·r/N into λ·R/(n′·size·Δ) and cancelling leaves the
    // pupil in only as r/R, which at D = 0 is the slope. Written out here from
    // the traced slope and nothing else — no reference sphere appears, which is
    // the same statement as § 6aj.6's finding that the sphere was never the
    // cause of the zero.
    const hand = (LINE_D * 1e-6 * 16) / (2 * 1 * 64 * TEL_SLOPE);
    expect(imagePixelScaleMm(sp.scale, 64, 16)).toBe(hand);
    expect(hand).toBe(SCALE_64_16);
  });

  it("the inline copy in geometric.ts is gone, so both branches read one ruler", () => {
    // § 6aj.6 had to name `geometric.ts` as a SECOND repair site because it
    // carried its own copy of the formula. It now calls the shared reader, so
    // there is no second place for a telecentric branch to be missing from.
    expect(geometricPsf(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBe(SCALE_64_16);
    // Bitwise unmoved on a finite pupil, which is what makes replacing the copy
    // a deduplication rather than a change.
    expect(geometricPsf(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).pixelScaleMm).toBe(
      imagePixelScaleMm(systemPupil(ORDINARY, 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16),
    );
  });

  it("refuses the pair it used to answer 0 to, and answers with the slope beside it", () => {
    // The fourth quadrant of the invariant — no finite radius AND no slope — is
    // precisely what every construction site produced before this step.
    const noSlope = /no slope aperture/;
    expect(() =>
      imagePixelScaleMm(
        { referenceRadius: 1, exitRadius: Infinity, wavelengthNm: LINE_D, nImage: 1, slopeRadius: undefined },
        64,
        16,
      ),
    ).toThrow(noSlope);
    // The same scale WITH the slope answers, so the refusal is about the
    // missing quantity and not about the infinity.
    expect(
      imagePixelScaleMm(
        { referenceRadius: 1, exitRadius: Infinity, wavelengthNm: LINE_D, nImage: 1, slopeRadius: TEL_SLOPE },
        64,
        16,
      ),
    ).toBe(SCALE_64_16);
  });

  it("carries the image index, as a scale expressed in image millimetres must", () => {
    // n′ divides, so an immersed image space packs the same slope into a
    // proportionally finer grid. Read off the engine's own immersed trace
    // rather than asserted from the formula.
    const oil = at(frontFocalDistance("N-BK7"), stopR(STOP_R), "N-BK7");
    const ex = pupils(oil, LINE_D).exit;
    expect(ex.radius).toBe(Infinity);
    expect(Math.abs(ex.n)).toBeGreaterThan(1.5);
    const sc = systemPupil(oil, 0, LINE_D, { pupilSamples: 16 }).scale;
    expect(imagePixelScaleMm(sc, 64, 16)).toBe(
      (LINE_D * 1e-6 * 16) / (2 * Math.abs(ex.n) * 64 * ex.slopeRadius!),
    );
  });
});

describe("§ 6ak.2 — the answer does not depend on the gap, and the marginal ray says why", () => {
  it("is the ORDINARY fixture's number, across a 60× range of gaps", () => {
    // The strongest rung in this step, and it is NOT about telecentricity —
    // reading it as a coincidence is the mistake it exists to prevent. With the
    // object at infinity the marginal ray reaches the stop with u = 0, so
    // tan u′ = C·y + D·u = C·stopRadius contains no gap AT ALL, and the pixel
    // scale depends on the pupil only through that slope. The telecentric gap is
    // one member of the family, not a special case of it, which is why the
    // repaired branch lands on the number the finite branch was already giving.
    const gaps = [1, 5, 12, 20, FFD, 60];
    for (const g of gaps) {
      const s = imagePixelScaleMm(systemPupil(at(g), 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16);
      expect(Math.abs(ulps(s, SCALE_64_16))).toBeLessThanOrEqual(1);
    }
    // And not vacuously: the family is not bitwise constant, so "within one
    // bit" is a measurement of the trace's noise and not of nothing happening.
    const distinct = new Set(
      gaps.map((g) => imagePixelScaleMm(systemPupil(at(g), 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16)),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("and where it departs, the loss is the FINITE branch's, growing with the gap", () => {
    // Measured because the first draft of the rung above guessed two bits and
    // got four, and the four turned out to be the interesting number.
    //
    // The departure is not in the pixel scale's arithmetic. It is in the RATIO
    // r_exit/R the finite branch has to form, and it grows without limit as the
    // gap does: both members diverge together — the exit pupil runs away from
    // the lens and its image-plane arm runs away with it — so their quotient is
    // a fixed quantity reached through two large ones, and the bits go where
    // cancellation always sends them. The exact-arithmetic answer is constant.
    //
    // The telecentric branch reaches the SAME ratio as |C|·stopRadius, with no
    // large intermediate anywhere in it. So the branch this step added is not
    // merely the one that avoids an infinity — on this family it is the
    // numerically clean route, and the finite spelling is the lossy one.
    const drift = [140, 400, 1000].map((g) =>
      Math.abs(ulps(imagePixelScaleMm(systemPupil(at(g), 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16), SCALE_64_16)),
    );
    expect(drift[0]).toBe(4);
    expect(drift[1]).toBe(38);
    expect(drift[2]).toBe(366);
    // Monotone, and the growth is the gap's: an order of magnitude of gap costs
    // an order of magnitude of last bits.
    expect(drift[1]! / drift[0]!).toBeGreaterThan(5);
    expect(drift[2]! / drift[1]!).toBeGreaterThan(5);
    // Relative to the value itself this is still 1e-13, so nothing downstream
    // is wrong — it is recorded as the reason the two spellings are kept apart,
    // not as an error budget anything spends.
    const far = imagePixelScaleMm(systemPupil(at(1000), 0, LINE_D, { pupilSamples: 16 }).scale, 64, 16);
    expect(Math.abs(far / SCALE_64_16 - 1)).toBeLessThan(1e-12);
  });

  it("the two spellings of one formula differ by at most two bits, approaching the branch", () => {
    // Why the finite line was left byte-for-byte rather than folded into the
    // cancelled form the slope needs. The two are algebraically identical and
    // reassociate three products and two quotients, so they are NOT identical in
    // binary — and every finite pixel scale in the ladder is pinned to twelve or
    // fifteen digits. Measured here by walking the gap in to the branch: the
    // finite spelling's answer and the telecentric spelling's stay within two
    // bits of each other the whole way, which is the entire size of the effect a
    // unified expression would have spent those pins on.
    for (const eps of [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      const near = imagePixelScaleMm(
        systemPupil(at(FFD * (1 - eps)), 0, LINE_D, { pupilSamples: 16 }).scale,
        64,
        16,
      );
      expect(Math.abs(ulps(near, SCALE_64_16))).toBeLessThanOrEqual(2);
    }
  });

  it("is linear in the stop radius, as a scale built on an aperture must be", () => {
    // Halving the stop halves the slope and doubles the pixel — the sanity the
    // gap sweep above cannot give, since it holds the aperture fixed.
    const half = systemPupil(at(FFD, stopR(STOP_R / 2)), 0, LINE_D, { pupilSamples: 16 }).scale;
    expect(half.slopeRadius! / TEL_SLOPE).toBeCloseTo(0.5, 12);
    expect(imagePixelScaleMm(half, 64, 16) / SCALE_64_16).toBeCloseTo(2, 12);
  });
});

describe("§ 6ak.3 — the NA a scale describes: the tangent, and its distance from Abbe's sine", () => {
  it("reduces to n′·tan u′ where it used to return Infinity", () => {
    // `pupilNumericalAperture` is the same r_exit/R ratio and was not on
    // § 6aj.6's list of nine. It read ∞/R = **Infinity**, which
    // `spatialFrequencyCyclesPerMm` then turned into an infinite cutoff — a
    // partially coherent transfer would have run its whole frequency axis at
    // zero. Repaired in the same step because it is the same substitution.
    const sc = systemPupil(TELECENTRIC, 0, LINE_D, { pupilSamples: 16 }).scale;
    expect(pupilNumericalAperture(sc)).toBe(TEL_SLOPE);
    // The cutoff identity 2·NA/λ survives it, which is the reason this function
    // exists rather than each module forming its own NA.
    expect(spatialFrequencyCyclesPerMm(2, sc)).toBe((2 * TEL_SLOPE) / (LINE_D * 1e-6));
  });

  it("is the TANGENT reading, and the imageNA spelling is Abbe's sine — 16 digits apart", () => {
    // The two must not be allowed to look interchangeable. Ask the bench
    // editor's `imageNA` spelling for 0.25 on the telecentric fixture: it sizes
    // a stop, the trace hands back an exit slope, and converting that TANGENT
    // through Abbe's sine returns the 0.25 that was asked for — the round trip
    // § 6aj.4 pins for the aperture, here closing through the scale's own NA.
    const naSys = at(FFD, imageNA(0.25));
    expect(resolveStopRadius(naSys, LINE_D)).toBeCloseTo(13.672335341502514, 9);
    const t = pupils(naSys, LINE_D).exit.slopeRadius!;
    expect(t).toBeCloseTo(0.2581988897471611, 12);
    expect(t / Math.hypot(1, t)).toBeCloseTo(0.25, 15);
    // And the gap between the spellings is not rounding: the tangent reads 3.3%
    // high at NA 0.25, which is 1/√(1 − (NA/n)²) exactly.
    expect(t / 0.25).toBeCloseTo(1 / Math.sqrt(1 - 0.25 * 0.25), 12);
    expect(t / 0.25).toBeGreaterThan(1.032);
  });
});

describe("§ 6ak.4 — the refusal that had nothing to redirect to now has the slope", () => {
  it("psf() renders a telecentric system, at the Strehl its own wavefront predicts", () => {
    // The external pin: Maréchal's exp(−(2πσ)²) on the RMS the trace itself
    // reports, against the Strehl the transform produces from the same pupil.
    // Nothing about telecentricity is assumed — this is the ordinary
    // diffraction-limited check, run for the first time on this arrangement.
    const rms = opdMap(TELECENTRIC, 0, LINE_D, pupilGrid(21), {}).rmsWaves;
    expect(rms).toBeCloseTo(0.012800257481117096, 9);
    const p = psf(TELECENTRIC, 0, LINE_D, { pupilSamples: 32, padFactor: 4 });
    expect(p.strehl).toBeCloseTo(Math.exp(-Math.pow(2 * Math.PI * rms, 2)), 3);
    expect(p.strehl).toBeCloseTo(0.9934178741915238, 9);
    // Transmitted energy BITWISE equal to the ordinary fixture's: the aperture
    // is the same stop through the same tail, so a ruler repair had better not
    // have changed how much light there is.
    expect(p.energy).toBe(psf(ORDINARY, 0, LINE_D, { pupilSamples: 32, padFactor: 4 }).energy);
    expect(p.pixelScaleMm).toBe(SCALE_64_16);
  });

  it("and adaptivePsf no longer answers or throws depending on an aberration threshold", () => {
    // The inconsistency lifting only ONE guard would have created: this reaches
    // the diffraction branch whenever the fidelity switch gives it any weight.
    const a = adaptivePsf(TELECENTRIC, 0, LINE_D, { pupilSamples: 32, padFactor: 4 });
    expect(a.geometricWeight).toBe(0);
    expect(a.pixelScaleMm).toBe(SCALE_64_16);
  });

  it("bestFocus searches a telecentric system, on a bracket that is the sine of the slope", () => {
    // `oneWaveDefocus` formed sin u′ as r/√(arm² + r²) and had neither. The
    // same sine out of a tangent is t/√(1 + t²) — the arm cancels, which is why
    // an infinite one costs nothing. Evidence that the bracket is right and not
    // merely finite: the search CONVERGES, improving the wavefront it starts
    // from by a factor of ~3.8 and landing just inside the paraxial plane, the
    // same way it does on the ordinary fixture.
    const bf = bestFocus(TELECENTRIC, "minRmsWavefront");
    expect(bf.offsetFromLastVertex).toBeCloseTo(48.85380884102368, 6);
    expect(bf.merit).toBeCloseTo(0.003389691515746031, 9);
    expect(bf.merit).toBeLessThan(0.012800257481117096 / 3);
    expect(bf.offsetFromLastVertex).toBeLessThan(paraxialImageOffset(TELECENTRIC, LINE_D));
  });

  it("what the psf guard still refuses is an image at infinity, which is a different failure", () => {
    // The surviving half. `opd.ts` substitutes a unit sphere whenever the exit
    // pupil has no finite z, so a non-finite reference radius reaching the
    // transform means the IMAGE is at infinity — no plane to lay millimetres on,
    // whatever the pupil does. Reachable only through the public
    // pupil-plus-scale entry point, which is how it is exercised.
    const flat: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
      phaseWaves: () => 0,
    };
    expect(() =>
      psfFromPupilFunction(
        flat,
        { referenceRadius: Infinity, exitRadius: 5, wavelengthNm: LINE_D, nImage: 1, slopeRadius: undefined },
        0,
        { pupilSamples: 16 },
      ),
    ).toThrow(/image is at infinity/);
  });
});

describe("§ 6ak.5 — the frame: a size where there was none, and a ruler that does not drift", () => {
  it("reports a pixel scale and a half-extent instead of a frame with no size", () => {
    const frame = objectFieldFrame(finiteAt(FFD), { size: 32, pupilSamples: 16 });
    expect(frame.scale.exitRadius).toBe(Infinity);
    expect(frame.pixelScaleMm).toBeCloseTo(0.003889124954857188, 15);
    expect(frame.halfExtentMm).toBeCloseTo(0.06222599927771501, 15);
    // The object-side pair is the image-side pair over the magnification, so it
    // was zero for the same reason and is repaired by the same substitution.
    expect(frame.magnification).toBeCloseTo(-0.1323818149296422, 12);
    expect(frame.objectPixelScaleMm).toBeCloseTo(frame.pixelScaleMm / Math.abs(frame.magnification), 15);
    expect(frame.objectHalfExtentMm).toBeCloseTo(frame.halfExtentMm / Math.abs(frame.magnification), 15);
    // Twice the psf grid's pixel because the frame is half its size at the same
    // pupil sampling — the two rulers are one ruler (§ 6ak.1).
    expect(frame.pixelScaleMm).toBeCloseTo(2 * SCALE_64_16, 15);
  });

  it("scaleDrift returns zero where it returned NaN, and one of its rows is the physics", () => {
    // The third silent answer this step repairs and the only one that was not a
    // zero: both members of |r_field/r_axis − 1| were Infinity, so it read NaN.
    //
    // AND THE ZERO NEEDS ITS REASON STATED, because one of the three rows would
    // otherwise pin plumbing. `pupils()` takes no field argument, so the exit
    // RADIUS does not drift on a finite frame either — that row is 0 on both
    // fixtures and always was. The row that carries physics is `pixelScale`: on
    // a finite frame the reference sphere drifts across the field and the scale
    // drifts with it, and on a telecentric one the formula does not read the
    // sphere at all, so the drifting member drops out and the ruler is exact.
    // That is the textbook reason to build image-space telecentric in the first
    // place, measured here rather than quoted.
    const finiteFrame = objectFieldFrame(finiteAt(20), { size: 32, pupilSamples: 16 });
    const dFinite = scaleDrift(finiteAt(20), finiteFrame);
    expect(dFinite.exitRadius).toBe(0);
    expect(dFinite.referenceRadius).toBeCloseTo(4.709261842705814e-7, 12);
    expect(dFinite.pixelScale).toBeCloseTo(4.709261842705814e-7, 12);

    const telFrame = objectFieldFrame(finiteAt(FFD), { size: 32, pupilSamples: 16 });
    const dTel = scaleDrift(finiteAt(FFD), telFrame);
    expect(dTel.exitRadius).toBe(0);
    expect(dTel.pixelScale).toBe(0);
    expect(dTel.pixelScale).toBeLessThan(dFinite.pixelScale);
  });
});
