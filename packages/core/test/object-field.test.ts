import { describe, it, expect } from "vitest";
import {
  fieldPupilAt,
  imageRadiusForObjectHeight,
  objectFieldFrame,
  objectHeightForImageRadius,
  objectPointAt,
  rotatePupil,
  scaleDrift,
  tracedFieldPupils,
} from "../src/imaging/object-field";
import { rotateKernel } from "../src/imaging/render";
import { renderBrightfield } from "../src/imaging/brightfield";
import { abbeImage, cosineGratingObject, type ObjectField } from "../src/illumination/abbe";
import { diskSource } from "../src/illumination/source";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import {
  imageNumericalAperture,
  objectNumericalAperture,
  sineConditionResidual,
} from "../src/pupil/microscope";
import { psfFromPupilFunction, type PupilFunction, type PupilScale } from "../src/wave/psf";
import { coefficient } from "../src/wave/zernike";
import { simpleSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";

/**
 * § 6h — object-space field mapping for a finite conjugate.
 *
 * The bridge § 6g.3 named and deliberately did not build: an `OpticalSystem` and
 * a normalized frame position onto `renderBrightfield`'s pupil callback. Two
 * external numbers carry it — the orders third-order theory predicts for the
 * field dependence (distortion cubic, astigmatism quadratic, coma linear), and
 * the closed form that ties the frame's extent to the objective's traced NA.
 *
 * Cost: one `opdMap` per field point plus § 6g.3's own patches² × source × N².
 * The grid stays small; the two closed-form rungs do not care how small.
 */

const LAMBDA = 587.5618;
const SIZE = 64;
const PUPIL_SAMPLES = 32;
const CYCLES = 8;
const SOURCE = diskSource(0.6, 5);

const GRATING: ObjectField = cosineGratingObject({
  size: SIZE,
  cycles: CYCLES,
  modulation: 0.6,
});

/** § 6b's DIN 4×/0.10 — the finite-conjugate member of the ladder. */
const din4x = () =>
  finiteConjugateMicroscope({ objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }) })
    .system;

const frameOf = (system = din4x(), pupilSamples = PUPIL_SAMPLES, size = SIZE) =>
  objectFieldFrame(system, { size, pupilSamples, wavelengthNm: LAMBDA });

/** Slope of log|y| against log|x| — the ORDER a quantity grows at. */
function fittedOrder(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += Math.log(xs[i]!);
    sy += Math.log(Math.abs(ys[i]!));
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = Math.log(xs[i]!) - mx;
    num += dx * (Math.log(Math.abs(ys[i]!)) - my);
    den += dx * dx;
  }
  return num / den;
}

function worstDifference(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
}

/** Intensity centroid, in pixels from the grid centre. */
function centroid(intensity: Float64Array, n: number): { x: number; y: number } {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = intensity[y * n + x]!;
      sum += v;
      sx += v * (x - n / 2);
      sy += v * (y - n / 2);
    }
  }
  return { x: sx / sum, y: sy / sum };
}

function peak(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

describe("§ 6h.1 — the inverse map, and the distortion it carries", () => {
  it("round-trips the traced chief ray to f64", () => {
    // The forward map is a traced chief ray and the inverse is bisected on it,
    // so the composition is an identity — the gate everything below stands on.
    const system = din4x();
    for (const h of [0.001, 0.01, 0.05, 0.2, 0.5]) {
      const r = imageRadiusForObjectHeight(system, h, LAMBDA);
      const back = objectHeightForImageRadius(system, r, LAMBDA);
      expect(Math.abs(back / h - 1)).toBeLessThan(1e-9);
    }
  });

  it("departs from the linear map as the CUBE of the field — third-order distortion", () => {
    // The whole reason the inverse is bisected rather than divided. Third-order
    // theory says distortion is the h³ term of the transverse aberration, so the
    // traced image radius minus M·h must grow as h³ — measured as an exponent,
    // not as a tolerance on a value, because the coefficient is this objective's
    // own and nothing external pins it.
    const system = din4x();
    const frame = frameOf(system);
    const m = Math.abs(frame.magnification);
    const heights = [0.05, 0.1, 0.2, 0.4, 0.8];
    const departures = heights.map((h) => imageRadiusForObjectHeight(system, h, LAMBDA) - m * h);
    // Signed and monotone: a sign flip would mean this is noise, not aberration.
    for (const d of departures) expect(Math.sign(d)).toBe(Math.sign(departures[0]!));
    expect(fittedOrder(heights, departures)).toBeCloseTo(3, 2);
    // The heights double, so a cubic multiplies the departure by exactly 8 each
    // step — a sharper statement than the fitted slope, and it holds to 0.3%.
    for (let i = 1; i < departures.length; i++) {
      expect(Math.abs(departures[i]! / departures[i - 1]! / 8 - 1)).toBeLessThan(1e-2);
    }
    // Real, not f64 noise: the bisection closes to 1e-9 of a ~1.6 mm image
    // radius, and the departure at h = 0.4 mm is 6.5e-6 mm — three orders above.
    expect(Math.abs(departures[departures.length - 1]!)).toBeGreaterThan(1e-6);
  });

  it("inverts the traced map, not the paraxial one", () => {
    // The two answers differ by exactly the distortion above. If the inverse had
    // been r/|M| this rung would read zero, and every patch off the frame centre
    // would be handed the pupil of the wrong object point.
    const system = din4x();
    const frame = frameOf(system);
    const h = 0.4;
    const r = imageRadiusForObjectHeight(system, h, LAMBDA);
    const paraxial = r / Math.abs(frame.magnification);
    expect(objectHeightForImageRadius(system, r, LAMBDA)).toBeCloseTo(h, 9);
    expect(Math.abs(paraxial / h - 1)).toBeGreaterThan(1e-6);
  });

  it("throws with the radius when no object height reaches it", () => {
    // A corner chief ray dying on a real objective is a plausible outcome, so it
    // must not come back as the nearest height that happened to work.
    const system = din4x();
    expect(() => objectHeightForImageRadius(system, 1e9, LAMBDA)).toThrow(/image radius/);
  });

  it("refuses an infinite conjugate rather than reading the field as an angle", () => {
    const singlet: Prescription = {
      surfaces: [
        {
          kind: "refract",
          curvature: 1 / 51.68,
          semiAperture: 10,
          thickness: 4,
          medium: "N-BK7",
          isStop: true,
        },
        { kind: "refract", curvature: 0, semiAperture: 10, thickness: 97.9, medium: "AIR" },
      ],
    };
    const infinite = simpleSystem(singlet, { kind: "stopRadius", value: 6 }, LAMBDA);
    expect(() => objectFieldFrame(infinite, { size: SIZE, pupilSamples: PUPIL_SAMPLES })).toThrow(
      /finite conjugate/,
    );
  });
});

describe("§ 6h.2 — the frame: pupilSamples buys field, the grid buys sampling", () => {
  it("has a half-extent independent of the grid size", () => {
    // DFT reciprocity: pixelScale ∝ 1/size and extent = size × pixelScale, so
    // the size cancels identically. Doubling the grid resolves the image better
    // and shows not one micron more of specimen.
    const system = din4x();
    const base = frameOf(system, PUPIL_SAMPLES, 64);
    for (const size of [128, 256]) {
      const f = frameOf(system, PUPIL_SAMPLES, size);
      expect(f.halfExtentMm).toBeCloseTo(base.halfExtentMm, 12);
      expect(f.pixelScaleMm * size).toBeCloseTo(base.pixelScaleMm * 64, 12);
    }
  });

  it("scales its field linearly with pupilSamples", () => {
    const system = din4x();
    const base = frameOf(system, 32);
    for (const k of [2, 4]) {
      expect(frameOf(system, 32 * k).objectHalfExtentMm / base.objectHalfExtentMm).toBeCloseTo(k, 9);
    }
  });

  it("is exactly pupilSamples·λ·R/(4·n′·r_exit) — the closed form unpacked", () => {
    // The identity the frame IS, in the numbers it is actually built from. Exact
    // to f64 at every sampling, which is what makes the departure measured in the
    // next rung attributable to physics rather than to arithmetic.
    const system = din4x();
    for (const pupilSamples of [16, 32, 64]) {
      const frame = frameOf(system, pupilSamples);
      const closed =
        (pupilSamples * LAMBDA * 1e-6 * frame.scale.referenceRadius) /
        (4 * frame.scale.nImage * frame.scale.exitRadius);
      expect(frame.halfExtentMm / closed - 1).toBeCloseTo(0, 12);
    }
  });

  it("departs from pupilSamples·λ/(4·NA) by exactly the objective's aplanatism gap", () => {
    // The textbook form is written in the NUMERICAL APERTURE; the frame is built
    // from the PARAXIAL exit pupil, whose r/R is a tangent. Two separate gaps
    // stand between them, and both are this objective's physics rather than the
    // mapping's error:
    //
    //   image side — tan u′ (paraxial pupil) against sin u′ (traced marginal ray)
    //   object side — that, against the sine condition NA = |M|·NA′
    //
    // The DIN 4× is a single cemented doublet solved for ΣS_I with ΣS_II picking
    // the root, which § 5j showed cannot be aplanatic, and its sine-condition
    // residual is 2.3%. So the image-side form is 2.7% out — ALL of it the
    // pupil-tangent gap, pinned as an identity — and the object-side form is only
    // 0.5% out because the two errors partly cancel. That cancellation is a
    // coincidence of this objective and is written down as one, not as accuracy.
    const system = din4x();
    const na = objectNumericalAperture(system, LAMBDA);
    const naPrime = imageNumericalAperture(system, LAMBDA);
    const residual = sineConditionResidual(system, 0.02, LAMBDA);
    expect(Math.abs(residual)).toBeGreaterThan(2e-2);
    for (const pupilSamples of [16, 32, 64]) {
      const frame = frameOf(system, pupilSamples);
      const tanU = frame.scale.exitRadius / frame.scale.referenceRadius;
      const imageGap = frame.halfExtentMm / ((pupilSamples * LAMBDA * 1e-6) / (4 * naPrime)) - 1;
      // Identity: the whole image-side departure is sin u′ / tan u′ − 1.
      expect(imageGap).toBeCloseTo(naPrime / tanU - 1, 12);
      expect(Math.abs(imageGap)).toBeGreaterThan(2e-2);
      // Object side, after the sine condition has partly undone it.
      const objectGap = frame.objectHalfExtentMm / ((pupilSamples * LAMBDA * 1e-6) / (4 * na)) - 1;
      expect(Math.abs(objectGap)).toBeLessThan(1e-2);
      // Neither gap grows with the sampling — they are ratios of the optics.
      expect(objectGap).toBeCloseTo(-5.01e-3, 4);
    }
  });

  it("reads a magnification that is the objective's label", () => {
    // Composition, not a new pin: § 6b already pins the traced chief ray's 4×.
    // What matters here is that the frame's object-side scale rests on it.
    const frame = frameOf();
    expect(frame.magnification).toBeLessThan(0);
    expect(Math.abs(frame.magnification)).toBeCloseTo(4, 2);
    expect(frame.objectPixelScaleMm * Math.abs(frame.magnification)).toBeCloseTo(
      frame.pixelScaleMm,
      12,
    );
  });
});

describe("§ 6h.3 — the rotation, against `imaging/render`'s own convention", () => {
  /** A pupil with x-coma only: asymmetric, so a rotation is visible. */
  const comaPupil = (): PupilFunction => ({
    amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
    phaseWaves: (px, py) => {
      const r2 = px * px + py * py;
      return 0.5 * (3 * r2 - 2) * px;
    },
  });
  const SCALE: PupilScale = {
    referenceRadius: 100,
    exitRadius: 10,
    wavelengthNm: LAMBDA,
    nImage: 1,
  };
  const psfOf = (pupil: PupilFunction) =>
    psfFromPupilFunction(pupil, SCALE, 0, { pupilSamples: 32, padFactor: 4 });

  it("agrees with `rotateKernel` at the angles where that one is exact", () => {
    // The § 3c lesson as a rung: two modules that rotate the same picture must
    // rotate it the same way. 90° and 180° map the lattice onto itself, so
    // `rotateKernel` does no interpolation there — but it is still not exact,
    // because it skips destinations whose source lands on the last row or column
    // and then renormalizes the whole array to restore the energy it just lost.
    // So the tolerance is DERIVED from that strip rather than picked: the skipped
    // pixels differ by their own value, and every other pixel by the
    // renormalization factor.
    const base = psfOf(comaPupil());
    const n = base.size;
    let stripPeak = 0;
    let stripEnergy = 0;
    for (let i = 0; i < n; i++) {
      for (const value of [
        base.intensity[i]!,
        base.intensity[(n - 1) * n + i]!,
        base.intensity[i * n]!,
        base.intensity[i * n + n - 1]!,
      ]) {
        stripPeak = Math.max(stripPeak, Math.abs(value));
        stripEnergy += value;
      }
    }
    const stripFraction = stripEnergy / base.energy;
    const bound = 2 * (stripPeak + stripFraction * base.peak);
    // The same strip moves the centroid: it sits at most n/2 pixels out, so
    // deleting `stripFraction` of the energy from there drags the centroid by at
    // most that far times the fraction. 0.023 px against a 3.6 px displacement.
    const centroidBound = stripFraction * (n / 2);
    for (const deg of [90, 180]) {
      const angle = (deg * Math.PI) / 180;
      const rotatedPupil = psfOf(rotatePupil(comaPupil(), angle));
      const rotatedKernel = rotateKernel(base.intensity, n, angle);
      expect(worstDifference(rotatedPupil.intensity, rotatedKernel)).toBeLessThan(bound);

      // …and the bound is not vacuous — but the max pixel difference is the
      // wrong instrument for saying so, because a coma PSF's bright core is
      // nearly rotation-symmetric and the orientation lives in the faint flare.
      // The CENTROID is where it shows: coma displaces it, and rotating must
      // carry that displacement round. This is also what pins the handedness —
      // a transposed convention would send +x to −y and land here.
      const c0 = centroid(base.intensity, n);
      const cp = centroid(rotatedPupil.intensity, n);
      const ck = centroid(rotatedKernel, n);
      const shift = Math.hypot(c0.x, c0.y);
      expect(shift).toBeGreaterThan(0.5); // pixels — a displacement you can see
      expect(Math.hypot(cp.x - ck.x, cp.y - ck.y)).toBeLessThan(centroidBound);
      expect(Math.hypot(cp.x - c0.x, cp.y - c0.y)).toBeGreaterThan(shift);
    }
  });

  it("is exact where `rotateKernel` cannot be: composition and the identity", () => {
    // A callback rotation has no resampling to lose, so these hold to f64 at any
    // angle — which is the asymmetry the module header names.
    const pupil = comaPupil();
    expect(rotatePupil(pupil, 0)).toBe(pupil);
    const a = 0.37;
    const b = 1.11;
    const twice = rotatePupil(rotatePupil(pupil, a), b);
    const once = rotatePupil(pupil, a + b);
    for (const [px, py] of [
      [0.3, 0.1],
      [-0.5, 0.6],
      [0.8, -0.2],
    ] as const) {
      expect(twice.phaseWaves(px, py)).toBeCloseTo(once.phaseWaves(px, py), 12);
      expect(twice.amplitude(px, py)).toBeCloseTo(once.amplitude(px, py), 12);
    }
  });

  it("leaves a rotationally symmetric pupil alone, so the axis pays nothing", () => {
    const defocus: PupilFunction = {
      amplitude: (px, py) => (px * px + py * py <= 1 ? 1 : 0),
      phaseWaves: (px, py) => 0.4 * (px * px + py * py),
    };
    const turned = rotatePupil(defocus, 0.9);
    for (const [px, py] of [
      [0.2, 0.5],
      [-0.7, 0.3],
    ] as const) {
      expect(turned.phaseWaves(px, py)).toBeCloseTo(defocus.phaseWaves(px, py), 12);
    }
  });
});

describe("§ 6h.4 — the traced pupil across the field", () => {
  it("grows coma as h¹ and astigmatism as h² — third-order field dependence", () => {
    // The reason the pupil varies at all, and the external number this unit is
    // pinned to: third-order theory makes S_II linear in the field and S_III
    // quadratic. `analysis/seidel` computes neither (it stops at S_I and S_II by
    // design), so the orders are measured on the traced wavefront — the same
    // move § 6d used to show the Lister's residual coma change order.
    const system = din4x();
    const frame = frameOf(system);
    const heights = [0.05, 0.1, 0.2, 0.4];
    const coma: number[] = [];
    const astig: number[] = [];
    for (const h of heights) {
      const r = imageRadiusForObjectHeight(system, h, LAMBDA);
      const u = 0.5 + r / (2 * frame.halfExtentMm);
      const p = fieldPupilAt(system, frame, u, 0.5);
      expect(p.objectHeightMm).toBeCloseTo(h, 9);
      coma.push(Math.hypot(coefficient(p.fit, 7), coefficient(p.fit, 8)));
      astig.push(Math.hypot(coefficient(p.fit, 5), coefficient(p.fit, 6)));
    }
    expect(fittedOrder(heights, coma)).toBeCloseTo(1, 1);
    expect(fittedOrder(heights, astig)).toBeCloseTo(2, 1);
  });

  it("reads the on-axis pupil as the axis, with no rotation applied", () => {
    const system = din4x();
    const frame = frameOf(system);
    const centre = fieldPupilAt(system, frame, 0.5, 0.5);
    expect(centre.objectHeightMm).toBe(0);
    expect(centre.azimuthRad).toBe(0);
    expect(centre.imageRadiusMm).toBe(0);
    // An axial trace is rotationally symmetric, so its odd terms must vanish;
    // 7.5e-6 waves is the least-squares fit's own noise floor on this pupil grid,
    // and it is 200× under the coma the nearest off-axis patch reads.
    expect(Math.hypot(coefficient(centre.fit, 7), coefficient(centre.fit, 8))).toBeLessThan(1e-5);
  });

  it("turns the pupil to the frame position's own azimuth", () => {
    // Without this every patch's coma would point the same way — `rotateKernel`'s
    // argument, one layer earlier. Two positions at the same radius and different
    // azimuths must see the SAME wavefront in their own rotated frames.
    const system = din4x();
    const frame = frameOf(system);
    const right = fieldPupilAt(system, frame, 1, 0.5);
    const up = fieldPupilAt(system, frame, 0.5, 1);
    expect(right.objectHeightMm).toBeCloseTo(up.objectHeightMm, 9);
    expect(right.azimuthRad).toBeCloseTo(0, 12);
    expect(up.azimuthRad).toBeCloseTo(Math.PI / 2, 12);
    // The +x pupil turned by 90° is the +y pupil: sample one at (px, py) and the
    // other at the rotated point, and they agree to f64.
    for (const [px, py] of [
      [0.4, 0.2],
      [-0.6, 0.5],
    ] as const) {
      expect(up.pupil.phaseWaves(px, py)).toBeCloseTo(right.pupil.phaseWaves(py, -px), 12);
    }
  });

  it("carries the trace's sampling, so the verdict stops reading `unknown`", () => {
    // § 6f.9's verdict has had one caller since § 6g.3 and no *traced* caller at
    // all: a bare `PupilFunction` cannot know what produced it, so every frame so
    // far ruled `unknown`. This is the wiring that fixes that.
    const system = din4x();
    const frame = frameOf(system);
    const p = fieldPupilAt(system, frame, 1, 1);
    expect(p.sampling).toBeDefined();
    const rendered = renderBrightfield(GRATING, tracedFieldPupils(system, frame), SOURCE, {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    });
    expect(rendered.fidelity.verdict).toBe("valid");
    // …and it survives `requireHonest`, which nothing traced could do before.
    expect(() =>
      renderBrightfield(GRATING, tracedFieldPupils(system, frame), SOURCE, {
        patches: 2,
        pupilSamples: PUPIL_SAMPLES,
        scale: frame.scale,
        requireHonest: true,
      }),
    ).not.toThrow();
  });
});

describe("§ 6h.5 — the bridge, composed on a traced objective", () => {
  it("makes the edge patch exactly `abbeImage` through the mapper's own pupil", () => {
    // § 6g.3's exactness result, now with a real objective on the other end:
    // `patchWeight` runs flat to the frame edge, so the outer half-patch's image
    // IS `abbeImage` through that patch's pupil. The composition is checked
    // pixel-for-pixel in that strip, which is the only place it can be checked
    // without a closed form for a non-isoplanatic partially coherent image.
    const system = din4x();
    const frame = frameOf(system);
    const patches = 2;
    const pupilAt = tracedFieldPupils(system, frame);
    const rendered = renderBrightfield(GRATING, pupilAt, SOURCE, {
      patches,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    });
    const edge = abbeImage(GRATING, pupilAt(0.25, 0.25).pupil, SOURCE, {
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    });
    // The top-left quarter-patch: weight 1 from patch (0,0) and 0 from all
    // others, so the blend is the identity there.
    let worst = 0;
    const strip = Math.floor(SIZE / (2 * patches));
    for (let y = 0; y < strip; y++) {
      for (let x = 0; x < strip; x++) {
        const i = y * SIZE + x;
        worst = Math.max(worst, Math.abs(rendered.intensity[i]! - edge.intensity[i]!));
      }
    }
    expect(worst).toBeLessThan(1e-12 * peak(edge.intensity));
    expect(rendered.pixelScaleMm).toBeCloseTo(frame.pixelScaleMm, 12);
  });

  it("finds the frame NOT isoplanatic, and converges at ratio ½ — not the fixture's 0.4", () => {
    // The measurement that decides whether this unit was worth building, and it
    // answers yes. The frame spans only pupilSamples resolution cells (§ 6h.2) —
    // 47 µm of specimen on a 4× — which looked far too small to leave the
    // objective's isoplanatic patch. It is not: the corner reads 8.8e-3 waves of
    // coma against the axis's fit-noise 7.5e-6, and the image moves by 1.4% of
    // peak between one patch and four.
    //
    // § 6g.3 pinned this convergence as a ratio because a wandering image also
    // satisfies "each step is smaller". On the labelled defocus-ramp fixture the
    // ratio was just under 0.4; on a traced objective it is 0.50. So the fixture
    // was representative in SHAPE — geometric convergence — and not in RATE,
    // which is exactly why § 6g.3 pinned a measured number and did not call it a
    // law.
    const system = din4x();
    const frame = frameOf(system);
    const pupilAt = tracedFieldPupils(system, frame);
    const levels = [1, 2, 4, 8].map((patches) =>
      renderBrightfield(GRATING, pupilAt, SOURCE, {
        patches,
        pupilSamples: PUPIL_SAMPLES,
        scale: frame.scale,
      }),
    );
    const pk = peak(levels[0]!.intensity);
    const steps: number[] = [];
    for (let i = 1; i < levels.length; i++) {
      steps.push(worstDifference(levels[i]!.intensity, levels[i - 1]!.intensity) / pk);
    }
    // Field variation is REAL: the first refinement moves the image by ~0.9%.
    expect(steps[0]!).toBeGreaterThan(5e-3);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]! / steps[i - 1]!).toBeCloseTo(0.5, 2);
    }
    // The wavefront agrees with the picture: coma, linear in the field, is what
    // varies across this frame.
    const axis = fieldPupilAt(system, frame, 0.5, 0.5);
    const corner = fieldPupilAt(system, frame, 1, 1);
    const axisComa = Math.hypot(coefficient(axis.fit, 7), coefficient(axis.fit, 8));
    const cornerComa = Math.hypot(coefficient(corner.fit, 7), coefficient(corner.fit, 8));
    expect(cornerComa / axisComa).toBeGreaterThan(100);
    expect(corner.rmsWaves).toBeGreaterThan(axis.rmsWaves);
  });

  it("is the identity when the mapper ignores the field — so the motion above is physics", () => {
    // The control the rung above needs. A mapper that hands every position the
    // AXIAL pupil must make the decomposition exact (Σ w ≡ 1), so if the 0.9%
    // were plumbing — a blend bug, a rotation applied where none belongs — it
    // would show up here too. It does not.
    const system = din4x();
    const frame = frameOf(system);
    const axial = fieldPupilAt(system, frame, 0.5, 0.5);
    const blind = () => ({ pupil: axial.pupil, sampling: axial.sampling! });
    const reference = renderBrightfield(GRATING, blind, SOURCE, {
      patches: 1,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    }).intensity;
    for (const patches of [2, 4]) {
      const rendered = renderBrightfield(GRATING, blind, SOURCE, {
        patches,
        pupilSamples: PUPIL_SAMPLES,
        scale: frame.scale,
      });
      expect(worstDifference(rendered.intensity, reference)).toBeLessThan(1e-12 * peak(reference));
    }
  });

  it("measures what the one common ruler costs", () => {
    // Every patch is blended on the on-axis scale, so the exit pupil moving with
    // the field is an error the blend cannot see. Reported, not assumed away.
    const system = din4x();
    const frame = frameOf(system);
    const drift = scaleDrift(system, frame);
    expect(drift.pixelScale).toBeLessThan(1e-5);
    expect(drift.referenceRadius).toBeLessThan(1e-5);
    // Identically zero, and that is a LIMIT of this measurement rather than a
    // result: `pupils()` is a paraxial construction with no field argument, so
    // the exit pupil cannot move with the field here whatever the optics do. What
    // this bounds is the reference sphere following the chief ray's image point;
    // a system with real pupil aberration would need a different instrument.
    expect(drift.exitRadius).toBe(0);
  });

  it("clears the frame without vignetting, so the Abbe sum never re-traces", () => {
    // The cost cliff the header names: a vignetting field point would multiply
    // the trace count by the condenser's sampling. The DIN 4× clears its own
    // glass at this frame, and the trace's `lost` is what says so.
    const system = din4x();
    const frame = frameOf(system);
    for (const [u, v] of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ] as const) {
      expect(fieldPupilAt(system, frame, u, v).lost).toBe(0);
    }
  });

  it("exposes the object-plane coordinate a distortion-carrying rasterizer needs", () => {
    // The named deferral's seam: the grid is not warped, but the object point
    // each frame position really looks at is available and carries distortion.
    const system = din4x();
    const frame = frameOf(system);
    const corner = objectPointAt(system, frame, 1, 1);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(corner.radiusMm, 12);
    expect(corner.azimuthRad).toBeCloseTo(Math.PI / 4, 12);
    expect(corner.radiusMm).toBeCloseTo(frame.objectHalfExtentMm * Math.SQRT2, 3);
  });
});
