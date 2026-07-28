import { describe, it, expect } from "vitest";
import {
  fieldPupilAt,
  imagePointAt,
  imageRadiusForObjectHeight,
  objectFieldFrame,
  objectFieldTile,
  objectHeightForImageRadius,
  objectPointAt,
  rotatePupil,
  scaleDrift,
  tracedFieldPupils,
} from "../src/imaging/object-field";
import { rotateKernel } from "../src/imaging/render";
import { renderBrightfield } from "../src/imaging/brightfield";
import { rasterizeEmitters } from "../src/imaging/fluorescence";
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
import { simpleSystem, type OpticalSystem } from "../src/trace/system";
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

/**
 * § 6m — the off-axis frame.
 *
 * § 6h.2 pinned that a frame's extent is set by `pupilSamples` and not by the
 * grid, which makes it a **cost** statement: a real 5 mm field at a 4×'s own
 * resolution wants pupilSamples ≈ 1800. So a microscope's field is reached by
 * tiling and never by widening, and `objectFieldTile` is the tile.
 *
 * The step is small in code — `imagePointAt` gains an offset — and it is the
 * first thing in this branch that reaches **millimetres of specimen**. Three
 * external numbers only a millimetre can see carry it: third-order theory's
 * field dependence for defocus (h², field curvature) where § 6h.4 could reach
 * only coma and astigmatism; the factor 3 between the radial and tangential
 * local magnifications, which is the derivative of § 6h.1's own cubic; and the
 * reference sphere's plain geometry, hypot(R_axis, r).
 */

/** A § 6m tile of the same construction as `frameOf`, centred where asked. */
const tileOf = (system: OpticalSystem, x: number, y = 0, pupilSamples = PUPIL_SAMPLES) =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples,
    wavelengthNm: LAMBDA,
    centreMm: { x, y },
  });

/** The image radius the chief ray from `h` reaches — where a tile is put. */
const imageRadius = (system: OpticalSystem, h: number) =>
  imageRadiusForObjectHeight(system, h, LAMBDA);

describe("§ 6m.1 — the tile is the frame, moved", () => {
  it("reproduces `objectFieldFrame` bitwise when it is centred on the axis", () => {
    // The gate. A tile at the origin traces field 0, which is the frame's own
    // trace, so nothing may differ — not to a tolerance, in the last bit. If the
    // offset arithmetic or a defaulted option had drifted, this is where it
    // shows, and every rung below stands on the tile being one construction.
    const system = din4x();
    const frame = frameOf(system);
    const tile = tileOf(system, 0, 0);
    expect(tile.scale).toEqual(frame.scale);
    expect(tile.pixelScaleMm).toBe(frame.pixelScaleMm);
    expect(tile.halfExtentMm).toBe(frame.halfExtentMm);
    expect(tile.magnification).toBe(frame.magnification);
    expect(tile.objectPixelScaleMm).toBe(frame.objectPixelScaleMm);
    expect(tile.objectHalfExtentMm).toBe(frame.objectHalfExtentMm);
    expect(tile.probeHeightMm).toBe(frame.probeHeightMm);
    expect(tile.centreMm).toEqual({ x: 0, y: 0 });
    expect(tile.centreObjectMm).toEqual({ x: 0, y: 0 });
    // …and so is the image it forms, which is the statement that matters to a
    // mosaic: the axial tile is not a near-copy of the frame, it IS the frame.
    const axial = renderBrightfield(GRATING, tracedFieldPupils(system, frame), SOURCE, {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    });
    const viaTile = renderBrightfield(GRATING, tracedFieldPupils(system, tile), SOURCE, {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
      scale: tile.scale,
    });
    expect(worstDifference(axial.intensity, viaTile.intensity)).toBe(0);
  });

  it("is exactly pupilSamples·λ·R/(4·n′·r_exit) in its OWN reference radius", () => {
    // § 6h.2's closed form, re-read on a moved ruler. The identity is what makes
    // the tile's extent attributable: it is not the frame's extent plus an
    // error, it is the same closed form evaluated at a different R.
    const system = din4x();
    for (const r of [0, 0.8, 3.2]) {
      for (const pupilSamples of [16, 32, 64]) {
        const tile = tileOf(system, r, 0, pupilSamples);
        const closed =
          (pupilSamples * LAMBDA * 1e-6 * tile.scale.referenceRadius) /
          (4 * tile.scale.nImage * tile.scale.exitRadius);
        expect(tile.halfExtentMm / closed - 1).toBeCloseTo(0, 12);
      }
    }
  });

  it("looks through the pupil the parent frame gives that field position", () => {
    // A tile is a window onto one field, not a second field. Its centre pupil
    // must be the pupil the un-tiled construction would hand that position —
    // bitwise, because both reach it through the same inverse and the same trace.
    const system = din4x();
    const frame = frameOf(system);
    const r = imageRadius(system, 0.02);
    const u = 0.5 + r / (2 * frame.halfExtentMm);
    const viaFrame = fieldPupilAt(system, frame, u, 0.5);
    const viaTile = fieldPupilAt(system, tileOf(system, r), 0.5, 0.5);
    expect(viaTile.objectHeightMm).toBe(viaFrame.objectHeightMm);
    expect(viaTile.azimuthRad).toBe(viaFrame.azimuthRad);
    expect(viaTile.referenceRadius).toBe(viaFrame.referenceRadius);
    for (const [px, py] of [
      [0.4, 0.2],
      [-0.6, 0.5],
    ] as const) {
      expect(viaTile.pupil.phaseWaves(px, py)).toBe(viaFrame.pupil.phaseWaves(px, py));
      expect(viaTile.pupil.amplitude(px, py)).toBe(viaFrame.pupil.amplitude(px, py));
    }
  });

  it("places an emitter through the tile it is looking at — the first consumer moved", () => {
    // `rasterizeEmitters` measured from the grid centre and called it the axis,
    // which was the same point until § 6m. It now reads `frame.centreMm`, and
    // this is the rung that says so: a bead at the tile's OWN `centreObjectMm`
    // lands on the tile's centre pixel, through the traced chief ray — while the
    // axial frame, 0.047 mm wide, clips that same bead out entirely.
    const system = din4x();
    const tile = tileOf(system, imageRadius(system, 0.2));
    const bead = [{ xMm: tile.centreObjectMm.x, yMm: tile.centreObjectMm.y, flux: 1 }];
    const onTile = rasterizeEmitters(system, tile, bead);
    const centrePixel = onTile.values[(SIZE / 2) * SIZE + SIZE / 2]!;
    expect(centrePixel).toBeGreaterThan(0.999);
    let total = 0;
    for (const v of onTile.values) total += v;
    expect(total).toBeCloseTo(1, 12);
    // The control: the same bead, the same call, the axial frame — and nothing.
    const onFrame = rasterizeEmitters(system, frameOf(system), bead);
    let axialTotal = 0;
    for (const v of onFrame.values) axialTotal += v;
    expect(axialTotal).toBe(0);
  });

  it("works in every quadrant, not just the two the rungs are written in", () => {
    // Every tile above sits at (r, 0) or (0, r), and a stage pans in four
    // directions — so the first drag lands somewhere no rung has been. A tile
    // due west is the east tile turned by π and a tile due south by −π/2: the
    // same object height in the last bit, and the same wavefront through the
    // rotation. Reasoning says `atan2` and a magnitude cover it; this measures.
    const system = din4x();
    const r = imageRadius(system, 0.4);
    const east = fieldPupilAt(system, tileOf(system, r, 0), 0.5, 0.5);
    for (const [x, y, azimuth] of [
      [-r, 0, Math.PI],
      [0, -r, -Math.PI / 2],
    ] as const) {
      const tile = tileOf(system, x, y);
      const p = fieldPupilAt(system, tile, 0.5, 0.5);
      expect(p.objectHeightMm).toBe(east.objectHeightMm);
      expect(p.azimuthRad).toBeCloseTo(azimuth, 15);
      expect(tile.centreObjectMm.x).toBeCloseTo(Math.sign(x) * Math.abs(tile.centreObjectMm.x), 15);
      const c = Math.cos(azimuth);
      const s = Math.sin(azimuth);
      for (const [px, py] of [
        [0.4, 0.2],
        [-0.6, 0.5],
      ] as const) {
        expect(p.pupil.phaseWaves(px, py)).toBeCloseTo(
          east.pupil.phaseWaves(px * c + py * s, -px * s + py * c),
          15,
        );
      }
    }
  });

  it("refuses a centre it cannot mean, and an infinite conjugate", () => {
    const system = din4x();
    expect(() => tileOf(system, Number.NaN)).toThrow(/centreMm must be finite/);
    expect(() => tileOf(system, Number.POSITIVE_INFINITY)).toThrow(/centreMm must be finite/);
    // The mapping is a finite-conjugate construction and a tile inherits that.
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
    expect(() =>
      objectFieldTile(infinite, {
        size: SIZE,
        pupilSamples: PUPIL_SAMPLES,
        centreMm: { x: 1, y: 0 },
      }),
    ).toThrow(/finite conjugate/);
  });
});

describe("§ 6m.2 — registration: one global map, restricted to a tile", () => {
  it("sends the same image point to the same object point from two tiles, bitwise", () => {
    // The statement the mosaic leans on. Two tiles overlapping an image point
    // must agree about which specimen point is there — not to 1e-9, which would
    // be a seam the guard band could not close, but in the last bit.
    //
    // Set up so that the shared point is named by the SAME f64 expression from
    // both sides — a tile centred on another's edge reaches it at (0.5, 0.5),
    // where the normalized arithmetic contributes nothing — because otherwise
    // this rung would be measuring the coordinate algebra and not the map. The
    // seam a mosaic really lays is the next rung down.
    const system = din4x();
    const a = tileOf(system, imageRadius(system, 0.2));
    const east = tileOf(system, a.centreMm.x + a.halfExtentMm, a.centreMm.y);
    const north = tileOf(system, a.centreMm.x, a.centreMm.y + a.halfExtentMm);
    for (const [tile, u, v] of [
      [east, 1, 0.5],
      [north, 0.5, 1],
    ] as const) {
      const viaA = objectPointAt(system, a, u, v);
      const viaOwn = objectPointAt(system, tile, 0.5, 0.5);
      expect(viaOwn.radiusMm).toBe(viaA.radiusMm);
      expect(viaOwn.azimuthRad).toBe(viaA.azimuthRad);
      expect(viaOwn.x).toBe(viaA.x);
      expect(viaOwn.y).toBe(viaA.y);
      // …and the tile agrees with itself about where it is looking.
      expect(tile.centreObjectMm).toEqual({ x: viaOwn.x, y: viaOwn.y });
    }
  });

  it("costs a seam the ulp of the image point, and no more", () => {
    // The general case, where two abutting tiles name their shared edge through
    // different normalized coordinates and the arithmetic no longer coincides.
    // What is left is not a property of the map — it is a pure function of the
    // image radius, pinned bitwise below — but of the f64 route to the point, so
    // the bound is DERIVED from the image points' own disagreement rather than
    // picked: an object point may not be further out than the image point that
    // named it, referred through the magnification.
    const system = din4x();
    const a = tileOf(system, imageRadius(system, 0.2));
    const b = tileOf(system, a.centreMm.x + 2 * a.halfExtentMm);
    const edgeX = a.centreMm.x + a.halfExtentMm;
    const uB = 0.5 + (edgeX - b.centreMm.x) / (2 * b.halfExtentMm);
    const m = Math.abs(a.magnification);
    for (const v of [0.5, 0.25, 0.75]) {
      const vB = 0.5 + ((v - 0.5) * a.halfExtentMm) / b.halfExtentMm;
      const ia = imagePointAt(a, 1, v);
      const ib = imagePointAt(b, uB, vB);
      const named = Math.hypot(ib.x - ia.x, ib.y - ia.y);
      expect(named).toBeLessThan(4 * Number.EPSILON * Math.hypot(ia.x, ia.y));
      const pa = objectPointAt(system, a, 1, v);
      const pb = objectPointAt(system, b, uB, vB);
      expect(Math.hypot(pb.x - pa.x, pb.y - pa.y)).toBeLessThanOrEqual((2 * named) / m);
    }
  });

  it("does not depend on the bracket the inverse was seeded with", () => {
    // Why the above is bitwise rather than merely close, and the reason
    // `magnification` may stay the on-axis reading in every tile: the bisection
    // runs 60 halvings and stops when the interval reaches adjacent f64s, so the
    // seed chooses the path and not the answer. Six seeds over 10⁷ agree in the
    // last bit — and the control shows the mechanism rather than luck: a seed
    // 4 000× too small opens a bracket 60 halvings cannot exhaust, and it costs
    // 1.3e-15, which is the mantissa and nothing physical.
    const system = din4x();
    const r = imageRadius(system, 0.4);
    const base = objectHeightForImageRadius(system, r, LAMBDA, { magnification: 4 });
    for (const magnification of [0.1, 1, 4, 17, 1e3, 1e6]) {
      expect(objectHeightForImageRadius(system, r, LAMBDA, { magnification })).toBe(base);
    }
    expect(objectHeightForImageRadius(system, r, LAMBDA)).toBe(base);
    const starved = objectHeightForImageRadius(system, r, LAMBDA, { magnification: 1e-3 });
    expect(starved).not.toBe(base);
    expect(Math.abs(starved / base - 1)).toBeLessThan(1e-14);
  });

  it("measures the azimuth about the SYSTEM's axis, not the tile's", () => {
    // The one-line bug this rung exists to catch: a tile-relative azimuth
    // produces a perfectly plausible mosaic in which every tile's coma points
    // the same way, and nothing but the picture would say so. A tile due north
    // must see the due-east tile's wavefront turned by 90°, and it is the same
    // trace underneath — the two tiles sit at the same image radius, so their
    // object heights agree in the last bit and only the rotation stands between
    // them. The wavefront itself agrees to 1e-16 and not bitwise, for § 6h.3's
    // own reason: `Math.cos(π/2)` is 6.1e-17 rather than 0, so a quarter turn
    // costs one rounding even though `rotatePupil` never resamples anything.
    const system = din4x();
    const r = imageRadius(system, 0.4);
    const east = fieldPupilAt(system, tileOf(system, r, 0), 0.5, 0.5);
    const north = fieldPupilAt(system, tileOf(system, 0, r), 0.5, 0.5);
    expect(east.azimuthRad).toBe(0);
    expect(north.azimuthRad).toBe(Math.PI / 2);
    expect(north.objectHeightMm).toBe(east.objectHeightMm);
    for (const [px, py] of [
      [0.4, 0.2],
      [-0.6, 0.5],
    ] as const) {
      expect(north.pupil.phaseWaves(px, py)).toBeCloseTo(east.pupil.phaseWaves(py, -px), 15);
    }
  });

  it("finds the pitch is not the span, and bounds what a uniform one costs", () => {
    // A tile's extent is read on its own ruler, so it depends on where the tile
    // is — and abutment is therefore a FIXED POINT, not an offset known in
    // advance. It converges immediately (three iterations to f64), and the
    // question a mosaic actually has is whether it may skip the solve: laying
    // tiles on the axial pitch mismatches the true span by 1.9e-5 of a tile,
    // which is 1.2e-3 of a pixel at 1.6 mm off axis.
    const system = din4x();
    const a = tileOf(system, 1.6);
    let cx = a.centreMm.x + 2 * a.halfExtentMm;
    const moves: number[] = [];
    for (let i = 0; i < 3; i++) {
      const next = a.centreMm.x + a.halfExtentMm + tileOf(system, cx).halfExtentMm;
      moves.push(Math.abs(next - cx));
      cx = next;
    }
    expect(moves[0]! / a.pixelScaleMm).toBeLessThan(1e-3);
    expect(moves[2]!).toBeLessThan(1e-15);
    const uniform = tileOf(system, a.centreMm.x + 2 * a.halfExtentMm);
    expect(Math.abs(uniform.halfExtentMm / a.halfExtentMm - 1)).toBeLessThan(2e-5);
  });
});

describe("§ 6m.3 — the ruler, and why a tile reads it on its own axis", () => {
  it("puts the reference sphere at hypot(R_axis, r) — the ruler's whole field story", () => {
    // The reference sphere is centred on the image point and passes through the
    // chief ray at the exit-pupil plane. That plane does not move (`pupils()` is
    // paraxial) and the image point moves laterally by r, so R is a hypotenuse
    // and nothing else. Pinned to 2.4e-15 at 0.2 mm — and its departure grows as
    // r⁴, ×16.0 per doubling over four of them, which is the chief ray's own
    // cubic miss of the pupil centre multiplied by the lever arm r. Naming the
    // order is what makes it attributable rather than a residual.
    const system = din4x();
    const axis = frameOf(system).scale.referenceRadius;
    const radii = [0.4, 0.8, 1.6, 3.2, 6.4];
    const departures = radii.map((r) =>
      Math.abs(tileOf(system, r).scale.referenceRadius / Math.hypot(axis, r) - 1),
    );
    expect(
      Math.abs(tileOf(system, 0.2).scale.referenceRadius / Math.hypot(axis, 0.2) - 1),
    ).toBeLessThan(1e-14);
    expect(fittedOrder(radii, departures)).toBeCloseTo(4, 2);
    for (let i = 1; i < departures.length; i++) {
      expect(Math.abs(departures[i]! / departures[i - 1]! / 16 - 1)).toBeLessThan(2e-2);
    }
  });

  it("cannot move the exit pupil at all — § 6h.5's limit of the instrument, at 6 mm", () => {
    // The other half of the scale is identically the axial one at every tile,
    // and that is a property of `pupils()` rather than of the optics: it is a
    // paraxial construction with no field argument. § 6h.5 recorded this on a
    // 47 µm frame where it could be mistaken for smallness; at 6.4 mm off axis
    // it is still exactly zero, which is what a limit looks like.
    const system = din4x();
    const axis = frameOf(system).scale;
    for (const r of [0.8, 6.4]) {
      const tile = tileOf(system, r);
      expect(tile.scale.exitRadius).toBe(axis.exitRadius);
      expect(tile.scale.nImage).toBe(axis.nImage);
      expect(scaleDrift(system, tile).exitRadius).toBe(0);
    }
  });

  it("pays h_e(r+h_e)/R² on its own ruler where the axial one would cost r²/2R²", () => {
    // The trade the departure from § 6h's one-ruler rule buys, and it falls out
    // of the hypotenuse with no fitted constant at either end. `scaleDrift`'s
    // worst sample is the far corner, at radius √((r+h_e)² + h_e²), so
    //
    //   own ruler, across the tile   (ρ² − r²)/2R² = h_e(r + h_e)/R²
    //   axial ruler, AT the tile      r²/2R²
    //
    // — the first linear in the field, the second quadratic, and the on-axis
    // drift § 6h.5 measured is the same formula at r = 0 (h_e²/R² = 9.7e-7, and
    // it is). So the crossover is at r = (1+√3)·h_e = 2.73 half-extents, the
    // gain past it is r²/2h_e(r+h_e) → r/2h_e, and the tile's own ruler is
    // 0.73× at 0.4 mm — WORSE — 8.1× at 3.2 mm and 16.6× at 6.4 mm. A tile is
    // not automatically better off on its own ruler; it is better off once it is
    // three half-extents out, which every tile in a real mosaic is.
    const system = din4x();
    const frame = frameOf(system);
    const R = frame.scale.referenceRadius;
    const crossover = (1 + Math.sqrt(3)) * frame.halfExtentMm;
    expect(scaleDrift(system, frame).pixelScale).toBeCloseTo(
      (frame.halfExtentMm * frame.halfExtentMm) / (R * R),
      12,
    );
    for (const r of [0.4, 0.8, 1.6, 3.2, 6.4]) {
      const tile = tileOf(system, r);
      const he = tile.halfExtentMm;
      const own = scaleDrift(system, tile).pixelScale;
      const axial = Math.abs(tile.scale.referenceRadius / R - 1);
      // Both closed forms, to a part in 1000 at every field. Each is the
      // leading term of a hypotenuse read on its OWN centre, so the tile's drift
      // divides by R_tile and the axial error by R_axis; using one for the other
      // costs 0.11% at 6.4 mm, which is the difference between them.
      const Rtile = tile.scale.referenceRadius;
      expect(own / ((he * (r + he)) / (Rtile * Rtile)) - 1).toBeCloseTo(0, 3);
      expect(axial / ((r * r) / (2 * R * R)) - 1).toBeCloseTo(0, 3);
      // The trade itself: which ruler is cheaper, and by how much.
      // Relative, because the gain runs from 0.7 to 17 and an absolute bound
      // would mean something different at each end. The 1e-3 is the (R_tile/R)²
      // the two forms differ by, which is r²/R² and largest at 6.4 mm.
      const gain = axial / own;
      expect(Math.abs(gain / ((r * r) / (2 * he * (r + he))) - 1)).toBeLessThan(2e-3);
      if (r < crossover) expect(gain).toBeLessThan(1);
      else expect(gain).toBeGreaterThan(1);
    }
  });
});

describe("§ 6m.4 — a millimetre of field, which one frame could not see", () => {
  it("grows defocus as h² across tile centres — the objective's field curvature", () => {
    // The external number § 6h could not reach. Third-order theory makes the
    // Petzval/astigmatic focal surface depart from the flat image plane as h²,
    // so a MOSAIC on a flat plane must show defocus growing quadratically with
    // field. § 6h.4 measured coma and astigmatism and not this, because inside
    // one 47 µm frame the term is ~1e-6 waves and sits under the fit's own
    // noise. Tiles reach 0.8 mm, where it is 5.3e-2 waves — and it is ×4.000 per
    // doubling, to 0.1%, which is the sharpest field-order rung in the branch.
    const system = din4x();
    const onAxis = coefficient(fieldPupilAt(system, frameOf(system), 0.5, 0.5).fit, 4);
    const heights = [0.1, 0.2, 0.4, 0.8];
    const defocus = heights.map(
      (h) =>
        coefficient(
          fieldPupilAt(system, tileOf(system, imageRadius(system, h)), 0.5, 0.5).fit,
          4,
        ) - onAxis,
    );
    for (const d of defocus) expect(Math.sign(d)).toBe(Math.sign(defocus[0]!));
    expect(fittedOrder(heights, defocus)).toBeCloseTo(2, 3);
    for (let i = 1; i < defocus.length; i++) {
      expect(Math.abs(defocus[i]! / defocus[i - 1]! / 4 - 1)).toBeLessThan(1e-3);
    }
    // Real, and large: 5.3e-2 waves is 700× the axial fit's own noise floor.
    expect(Math.abs(defocus[defocus.length - 1]!)).toBeGreaterThan(5e-2);
  });

  it("keeps coma h¹ and astigmatism h² over 8× of field, where § 6h.4 had a frame", () => {
    // Composition rather than a new pin — § 6h.4 already measured these orders,
    // reaching outside its own frame to do it. What is new is that they are read
    // at tile CENTRES, in range, on tiles that render: the same third-order
    // dependence surviving across 8× of field — 0.1 mm to 0.8 mm — rather than
    // across one 47 µm frame.
    const system = din4x();
    const heights = [0.1, 0.2, 0.4, 0.8];
    const coma: number[] = [];
    const astig: number[] = [];
    for (const h of heights) {
      const p = fieldPupilAt(system, tileOf(system, imageRadius(system, h)), 0.5, 0.5);
      expect(p.objectHeightMm).toBeCloseTo(h, 9);
      coma.push(Math.hypot(coefficient(p.fit, 7), coefficient(p.fit, 8)));
      astig.push(Math.hypot(coefficient(p.fit, 5), coefficient(p.fit, 6)));
    }
    expect(fittedOrder(heights, coma)).toBeCloseTo(1, 3);
    expect(fittedOrder(heights, astig)).toBeCloseTo(2, 3);
  });

  it("finds an off-axis tile ANISOTROPIC, in the ratio 3 the cubic implies", () => {
    // The finding, and the one that reaches D2 rather than D4. A tile off axis
    // is not a scaled copy of an axial one: it is a rectangle. Differentiating
    // § 6h.1's own r = M·h + C·h³, the two local magnifications are
    //
    //   tangential  r/h    = M +   C·h²   (the chief ray's own lever)
    //   radial      dr/dh  = M + 3·C·h²   (its slope)
    //
    // so their departures from M stand in the ratio 3 — exactly, and with no
    // free coefficient, which is why it is a pin and not a measurement. Measured
    // on the tile's OWN edges rather than on the closed form: 2.97 at 0.4 mm and
    // 2.998 at 1.6 mm, approaching 3 from below as the h³ term climbs clear of
    // the inverse's 1e-9 closure. A tile 0.8 mm off axis is 33 ppm out of square
    // — small on this objective, and a thing no single per-tile scale can carry.
    const system = din4x();
    const m = Math.abs(frameOf(system).magnification);
    const ratios: number[] = [];
    for (const h of [0.4, 0.8, 1.6]) {
      const tile = tileOf(system, imageRadius(system, h));
      const span = 2 * tile.halfExtentMm;
      const radial =
        span / (objectPointAt(system, tile, 1, 0.5).x - objectPointAt(system, tile, 0, 0.5).x);
      const tangential =
        span / (objectPointAt(system, tile, 0.5, 1).y - objectPointAt(system, tile, 0.5, 0).y);
      // Both are barrel — below the linear reference — and the radial one more so.
      expect(radial).toBeLessThan(m);
      expect(tangential).toBeLessThan(m);
      expect(Math.abs(radial - m)).toBeGreaterThan(Math.abs(tangential - m));
      // The tangential edge measurement IS the closed form r/h, to 0.6%.
      expect(tangential / (imageRadius(system, h) / h) - 1).toBeCloseTo(0, 4);
      ratios.push((radial / m - 1) / (tangential / m - 1));
    }
    expect(ratios[ratios.length - 1]!).toBeCloseTo(3, 2);
    for (const ratio of ratios) expect(Math.abs(ratio / 3 - 1)).toBeLessThan(1e-2);
    // Exactly square on the axis, where C·h² vanishes — the negative control.
    const axial = tileOf(system, 0);
    const ax = objectPointAt(system, axial, 1, 0.5).x - objectPointAt(system, axial, 0, 0.5).x;
    const ay = objectPointAt(system, axial, 0.5, 1).y - objectPointAt(system, axial, 0.5, 0).y;
    expect(ax).toBe(ay);
  });

  it("renders a tile that is still honest, and softer, the further out it sits", () => {
    // What the mosaic will actually show. The tiles rule `valid` — they are
    // traced, so § 6f.9's verdict has the sampling it needs — and the picture
    // degrades because the OBJECTIVE does: a single cemented doublet solved on
    // axis carries 0.140 waves rms there and 0.632 at 1.6 mm, and the grating's
    // contrast follows it down from 0.687 to 0.343. That is the DIN 4×'s own
    // field and not the mapping's limit; nothing here vignettes.
    const system = din4x();
    const rowContrast = (intensity: Float64Array) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = 0; x < SIZE; x++) {
        const value = intensity[(SIZE / 2) * SIZE + x]!;
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      return (hi - lo) / (hi + lo);
    };
    const seen: { rms: number; contrast: number }[] = [];
    for (const h of [0, 0.8, 1.6]) {
      const tile = tileOf(system, h === 0 ? 0 : imageRadius(system, h));
      const centre = fieldPupilAt(system, tile, 0.5, 0.5);
      expect(centre.lost).toBe(0);
      const out = renderBrightfield(GRATING, tracedFieldPupils(system, tile), SOURCE, {
        patches: 2,
        pupilSamples: PUPIL_SAMPLES,
        scale: tile.scale,
        requireHonest: true,
      });
      expect(out.fidelity.verdict).toBe("valid");
      seen.push({ rms: centre.rmsWaves, contrast: rowContrast(out.intensity) });
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.rms).toBeGreaterThan(seen[i - 1]!.rms);
      expect(seen[i]!.contrast).toBeLessThan(seen[i - 1]!.contrast);
    }
    expect(seen[0]!.rms).toBeCloseTo(0.14, 2);
    expect(seen[2]!.rms).toBeCloseTo(0.632, 2);
    expect(seen[0]!.contrast).toBeCloseTo(0.687, 2);
    expect(seen[2]!.contrast).toBeCloseTo(0.343, 2);
  });
});
