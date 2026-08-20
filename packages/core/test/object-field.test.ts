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
  type FieldPupil,
} from "../src/imaging/object-field";
import { rotateKernel } from "../src/imaging/render";
import { renderBrightfield } from "../src/imaging/brightfield";
import { rasterizeEmitters } from "../src/imaging/fluorescence";
import { abbeImage, cosineGratingObject, type ObjectField } from "../src/illumination/abbe";
import { diskSource, translateSource } from "../src/illumination/source";
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

/**
 * The same objective with § 6x's stop placement, kept as a named control.
 *
 * § 6ai moved the default to `"backFocal"`, and several rungs below therefore
 * read one number on the shipped lens and its pair on this one. The ratio
 * between them is the finding; re-pinning the new number alone would hide it.
 */
const rimDin4x = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({
      magnification: 4,
      numericalAperture: 0.1,
      stopPlacement: "rim",
    }),
  }).system;

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
    slopeRadius: undefined,
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
    // An axial trace is rotationally symmetric, so its odd terms must vanish.
    // What is left is the least-squares fit's own floor — 1.07e-5 waves here and
    // 7.52e-6 on the rim control, and NEITHER moves when `pupilSamples` is swept
    // 16 → 96, which is what says the residue belongs to the fit's own grid and
    // not to the sampling this frame was asked for.
    //
    // So the bound that carries the claim is not the absolute number, which is a
    // property of that grid: it is the coma the nearest off-axis patch reads,
    // which is what "under the noise" has to beat to mean anything. § 6ai cut
    // that margin from 886× to 183× — the stop shift subtracts from coma
    // (§ 6m.4) while the fit's floor moved the other way — and 183× is still two
    // orders, which is why the rung stands rather than being re-pinned.
    const odd = (p: FieldPupil) => Math.hypot(coefficient(p.fit, 7), coefficient(p.fit, 8));
    const margin = (sys: OpticalSystem) => {
      const f = frameOf(sys);
      const u = 0.5 + imageRadius(sys, 0.05) / (2 * f.halfExtentMm);
      return odd(fieldPupilAt(sys, f, u, 0.5)) / odd(fieldPupilAt(sys, f, 0.5, 0.5));
    };
    expect(odd(centre)).toBeLessThan(1.1e-5);
    expect(margin(system)).toBeGreaterThan(100);
    expect(margin(rimDin4x())).toBeGreaterThan(800);
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
    //
    // § 6x added the second half of "that patch's pupil": a patch is lit from a
    // cone this rim-stopped DIN puts off centre, so the reference side has to
    // translate the source the same way `renderBrightfield` does. Written with
    // the patch's own reported offset rather than a repeat of the formula — the
    // identity being checked is the composition, and § 6x.1 is where the offset
    // itself is pinned. Handed the untranslated source this reads 2.5e-3 rather
    // than 1e-12, which is the size of the thing the wiring is carrying.
    const system = din4x();
    const frame = frameOf(system);
    const patches = 2;
    const pupilAt = tracedFieldPupils(system, frame);
    const rendered = renderBrightfield(GRATING, pupilAt, SOURCE, {
      patches,
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
    });
    const edgePatch = pupilAt(0.25, 0.25);
    const lit = translateSource(
      SOURCE,
      edgePatch.illuminationOffset!.sx,
      edgePatch.illuminationOffset!.sy,
    );
    const edge = abbeImage(GRATING, edgePatch.pupil, lit, {
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
    // answers yes. The frame spans only pupilSamples resolution cells (§ 6h.2),
    // which looked far too small to leave the objective's isoplanatic patch. It
    // is not: the corner's coma runs more than 100× the axis's fit noise, and the
    // image moves by over 1% of peak between one patch and two.
    //
    // § 6g.3 pinned this convergence as a ratio because a wandering image also
    // satisfies "each step is smaller". On the labelled defocus-ramp fixture the
    // ratio was just under 0.4; on a traced objective it is 0.50. So the fixture
    // was representative in SHAPE — geometric convergence — and not in RATE,
    // which is exactly why § 6g.3 pinned a measured number and did not call it a
    // law.
    //
    // **The sampling moved to 64 bins at § 6x, and the reason is that step's own
    // finding.** This rung ran at 32 for its whole life and read 0.50. Once the
    // illumination cone is placed where the rim-stopped DIN actually puts it,
    // each patch is lit from a slightly different point of the pupil, so a source
    // point crossing the aperture rim is a step change that happens BETWEEN
    // patches — and at 32 bins the sequence stops converging at all
    // (7.8e-3, 1.5e-2, 1.3e-2; ratios 1.95, 0.87). Refining the source does not
    // fix it (0.82/0.69 at 97 points, 0.46/0.51 at 349) and refining the PUPIL
    // does, at every source count (§ 6x.6). That is not a tolerance being
    // loosened: the claim is the same claim, and the fixture is the thing that
    // was too coarse to carry it once the cone was allowed to move.
    const system = din4x();
    const size = 128;
    const pupilSamples = 64;
    const frame = frameOf(system, pupilSamples, size);
    const grating = cosineGratingObject({ size, cycles: CYCLES, modulation: 0.6 });
    const pupilAt = tracedFieldPupils(system, frame);
    const levels = [1, 2, 4, 8].map((patches) =>
      renderBrightfield(grating, pupilAt, SOURCE, {
        patches,
        pupilSamples,
        scale: frame.scale,
      }),
    );
    const pk = peak(levels[0]!.intensity);
    const steps: number[] = [];
    for (let i = 1; i < levels.length; i++) {
      steps.push(worstDifference(levels[i]!.intensity, levels[i - 1]!.intensity) / pk);
    }
    // Field variation is REAL: the first refinement moves the image by ~1.2%.
    expect(steps[0]!).toBeGreaterThan(5e-3);
    // **§ 6ai turned the paragraph above into a confirmed prediction.** With the
    // stop on the rim this read 0.5092 and 0.5067 — geometric, and just ABOVE a
    // half — and § 6x.6 attributed the excess to the illumination by suppressing
    // the offset in the fixture and getting 0.5001/0.4999. A back-focal stop
    // suppresses that same offset for a physical reason instead of a test one:
    // the entrance pupil is at infinity, so every field point is lit down a cone
    // on its OWN axis and no patch sees the source displaced across the rim. The
    // sequence now reads 0.50107 and 0.50004 — § 6x.6's number, reached by moving
    // the diaphragm rather than by editing the illumination.
    //
    // The first step is untouched (1.2390e-2 against 1.2395e-2), which is the
    // control the claim needs: the field variation did not shrink, only the part
    // of the convergence that was the lighting's.
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
const tileOf = (
  system: OpticalSystem,
  x: number,
  y = 0,
  pupilSamples = PUPIL_SAMPLES,
  size = SIZE,
) =>
  objectFieldTile(system, {
    size,
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
    //
    // The frame leg has to say WHICH position, and it says it as a fraction of
    // the frame: u = ½ + r/2h_e. Whether `(u − ½)·2h_e` gives back exactly r is
    // then arithmetic and not optics, and § 6ai changed the h_e it divides by. On
    // the rim control the round trip is exact and the whole chain is bitwise; on
    // the shipped lens it is one ulp short, and that ulp is the entire difference
    // — 4.4e-16 of the object height, with the pupil samples agreeing to 1e-15.
    // The control is traced rather than quoted, because "bitwise except for the
    // coordinate round trip" is only worth asserting if the exception is shown.
    const check = (system: OpticalSystem, roundTripExact: boolean) => {
      const frame = frameOf(system);
      const r = imageRadius(system, 0.02);
      const u = 0.5 + r / (2 * frame.halfExtentMm);
      expect((u - 0.5) * 2 * frame.halfExtentMm === r).toBe(roundTripExact);
      const viaFrame = fieldPupilAt(system, frame, u, 0.5);
      const viaTile = fieldPupilAt(system, tileOf(system, r), 0.5, 0.5);
      expect(viaTile.azimuthRad).toBe(viaFrame.azimuthRad);
      if (roundTripExact) {
        expect(viaTile.objectHeightMm).toBe(viaFrame.objectHeightMm);
        expect(viaTile.referenceRadius).toBe(viaFrame.referenceRadius);
      } else {
        expect(Math.abs(viaTile.objectHeightMm / viaFrame.objectHeightMm - 1)).toBeLessThan(
          4 * Number.EPSILON,
        );
      }
      for (const [px, py] of [
        [0.4, 0.2],
        [-0.6, 0.5],
      ] as const) {
        if (roundTripExact) {
          expect(viaTile.pupil.phaseWaves(px, py)).toBe(viaFrame.pupil.phaseWaves(px, py));
          expect(viaTile.pupil.amplitude(px, py)).toBe(viaFrame.pupil.amplitude(px, py));
        } else {
          expect(viaTile.pupil.phaseWaves(px, py)).toBeCloseTo(
            viaFrame.pupil.phaseWaves(px, py),
            15,
          );
          expect(viaTile.pupil.amplitude(px, py)).toBeCloseTo(
            viaFrame.pupil.amplitude(px, py),
            15,
          );
        }
      }
    };
    check(rimDin4x(), true);
    check(din4x(), false);
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
    // seed chooses the path and not the answer. Five seeds over 10⁶ agree in the
    // last bit, on both members of § 6ai's pair.
    //
    // The control that shows the mechanism rather than luck used to be a seed
    // 4 000× too small, which opened a bracket 60 halvings could not exhaust and
    // cost 1.3e-15 — the mantissa and nothing physical. On the shipped lens that
    // seed no longer returns a number at all: it REFUSES, because the bracket it
    // opens runs to 1 600 mm of object height and the telecentric objective's
    // chief ray stops reaching the image past 5.225 mm, where the rim member is
    // still tracing beyond 100. That is the flip's own cost written down — a rear
    // stop buys the entrance pupil at infinity and pays for it in field — and a
    // refusal that names the vignetted ray is a better control than a silent
    // 1.3e-15, so both are kept, each on the member that has it.
    const seeds = [1, 4, 17, 1e3, 1e6];
    for (const member of [din4x(), rimDin4x()]) {
      const radius = imageRadius(member, 0.4);
      const base = objectHeightForImageRadius(member, radius, LAMBDA, { magnification: 4 });
      for (const magnification of seeds) {
        expect(objectHeightForImageRadius(member, radius, LAMBDA, { magnification })).toBe(base);
      }
      expect(objectHeightForImageRadius(member, radius, LAMBDA)).toBe(base);
    }

    const rimmed = rimDin4x();
    const rRim = imageRadius(rimmed, 0.4);
    const baseRim = objectHeightForImageRadius(rimmed, rRim, LAMBDA, { magnification: 4 });
    const starved = objectHeightForImageRadius(rimmed, rRim, LAMBDA, { magnification: 1e-3 });
    expect(starved).not.toBe(baseRim);
    expect(Math.abs(starved / baseRim - 1)).toBeLessThan(1e-14);

    const system = din4x();
    const r = imageRadius(system, 0.4);
    expect(() => objectHeightForImageRadius(system, r, LAMBDA, { magnification: 1e-3 })).toThrow(
      /no object height reaches image radius/,
    );
    // …and the field where it stops reaching is a property of the lens, not of
    // the seed: 5.2 mm telecentric against 100 mm and more on the rim.
    const reaches = (sys: OpticalSystem, h: number) => {
      try {
        imageRadius(sys, h);
        return true;
      } catch {
        return false;
      }
    };
    expect(reaches(system, 5.2)).toBe(true);
    expect(reaches(system, 5.3)).toBe(false);
    expect(reaches(rimmed, 100)).toBe(true);
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
    // advance. It converges immediately, and the question a mosaic actually has
    // is whether it may skip the solve: laying tiles on the axial pitch
    // mismatches the true span by 2.9e-5 of a tile, which is 9.4e-4 of a pixel at
    // 1.6 mm off axis.
    //
    // Both halves of that moved with § 6ai, by ONE factor, and it is the factor
    // the whole § 6m.3 story is written in: the mismatch is a departure read
    // against the reference sphere, so it goes as 1/R², and the flip took R from
    // 189.87 mm to 150.78. (189.87/150.78)² is 1.5857 and the measured ratio is
    // 1.5850 — 0.04% — so this rung is re-pinned to a closed form and not to a
    // fresh number. The convergence floor is stated the same way: the fixed point
    // lands within a few ulps of its own coordinate by the third step and moves
    // by exactly nothing on the fourth, which says more than "< 1e-15" did and
    // does not depend on how far off axis the tile happens to sit.
    const settle = (member: OpticalSystem) => {
      const a = tileOf(member, 1.6);
      let cx = a.centreMm.x + 2 * a.halfExtentMm;
      const moves: number[] = [];
      for (let i = 0; i < 4; i++) {
        const next = a.centreMm.x + a.halfExtentMm + tileOf(member, cx).halfExtentMm;
        moves.push(Math.abs(next - cx));
        cx = next;
      }
      expect(moves[0]! / a.pixelScaleMm).toBeLessThan(1e-3);
      expect(moves[2]!).toBeLessThan(4 * Number.EPSILON * cx);
      expect(moves[3]!).toBe(0);
      const uniform = tileOf(member, a.centreMm.x + 2 * a.halfExtentMm);
      return Math.abs(uniform.halfExtentMm / a.halfExtentMm - 1);
    };
    const system = din4x();
    const rimmed = rimDin4x();
    const mismatch = settle(system);
    const rimMismatch = settle(rimmed);
    expect(mismatch).toBeLessThan(3e-5);
    expect(rimMismatch).toBeLessThan(2e-5);
    const rSquared =
      (frameOf(rimmed).scale.referenceRadius / frameOf(system).scale.referenceRadius) ** 2;
    expect(mismatch / rimMismatch / rSquared - 1).toBeCloseTo(0, 3);
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
    const departureOn = (sys: OpticalSystem): number[] => {
      const r0 = frameOf(sys).scale.referenceRadius;
      return radii.map((r) =>
        Math.abs(tileOf(sys, r).scale.referenceRadius / Math.hypot(r0, r) - 1),
      );
    };
    const departures = departureOn(system);
    expect(
      Math.abs(tileOf(system, 0.2).scale.referenceRadius / Math.hypot(axis, 0.2) - 1),
    ).toBeLessThan(1e-11);
    expect(fittedOrder(radii, departures)).toBeCloseTo(4, 2);
    for (let i = 1; i < departures.length; i++) {
      expect(Math.abs(departures[i]! / departures[i - 1]! / 16 - 1)).toBeLessThan(2e-2);
    }

    // THE CONSTANT MOVED WITH § 6ai AND THE LAW DID NOT, and the two halves of
    // that sentence are worth different things. The r⁴ order is the physics —
    // 4.00 rim, 4.00 telecentric, sixteens either way — and it is what the rung
    // is for. The magnitude is a property of the LENS: this departure is the
    // chief ray's cubic miss of the exit pupil's CENTRE, so it carries the arm
    // to that pupil, and § 6ai moved the exit pupil from 0.8 mm behind the last
    // vertex to 39.9. Re-pinning 1e-14 to 1e-11 and saying nothing would be
    // loosening a tolerance; measured against the rim member it is a ratio with
    // a mechanism, which is why the control is traced here rather than quoted.
    const rimDepartures = departureOn(rimDin4x());
    // The same law on the control, to the same sixteens.
    expect(fittedOrder(radii, rimDepartures)).toBeCloseTo(4, 2);
    // …and the ratio between the two is ONE number at every radius, because it
    // is the arm and not the field: ~840×, flat to 3% over sixteen-fold in r.
    const ratios = departures.map((x, i) => x / rimDepartures[i]!);
    for (const q of ratios) expect(Math.abs(q / ratios[0]! - 1)).toBeLessThan(0.03);
    expect(ratios[0]!).toBeGreaterThan(700);
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
    // drift § 6h.5 measured is the same formula at r = 0 (h_e²/R² = 1.54e-6, and
    // it is). So the crossover is at r = (1+√3)·h_e = 2.73 half-extents, the
    // gain past it is r²/2h_e(r+h_e) → r/2h_e, and the tile's own ruler is
    // 0.73× at 0.4 mm — WORSE — 8.1× at 3.2 mm and 16.6× at 6.4 mm. A tile is
    // not automatically better off on its own ruler; it is better off once it is
    // three half-extents out, which every tile in a real mosaic is.
    //
    // **The r = 0 leg is now stated as a leading term with its own next term**,
    // and § 6ai is what forced that. h_e²/R² is the first term of the hypotenuse
    // √(R² + 2h_e²), whose next one is −h_e⁴/2R⁴ — so the closed form must miss
    // by −½·(h_e/R)² RELATIVE, and no absolute tolerance can be right at two
    // different R. That is the whole re-pin: the miss is not a residual, it is a
    // term, and it has a coefficient the expansion names in advance.
    //
    // The rim control reads −0.4916 — the −½, to 1.7%. The shipped lens reads
    // −3.3027, because with a rear stop the chief ray's cubic miss of the exit
    // pupil's CENTRE is 71× larger (§ 6m.4's distortion rung), and that miss sits
    // at the same order in h_e. So the geometry is alone in the coefficient only
    // on the control, which is where it is checked against −½.
    //
    // Both are swept over 8× of half-extent and neither is checked as "×4 per
    // doubling", because that is not what the arithmetic can deliver: `scaleDrift`
    // reports max|x/y − 1| and a subtraction from 1 throws away everything below
    // one ulp, so a point whose drift is (h_e/R)² can pin the coefficient only to
    // ±ε/(h_e/R)⁴ — 6.0e-2 at pupilSamples 8, falling to 1.5e-5 at 64. Measured
    // against the best-resolved point every other point lands inside its own bar
    // (1.9e-2 of 6.0e-2, 2.2e-3 of 3.8e-3, 9.6e-5 of 2.4e-4 on the control), and
    // that is the statement worth making: the spread down the sweep IS the
    // subtraction, and what is left over once it is accounted for is one number.
    const system = din4x();
    const frame = frameOf(system);
    const R = frame.scale.referenceRadius;
    const crossover = (1 + Math.sqrt(3)) * frame.halfExtentMm;
    const coefficientAt = (member: OpticalSystem, pupilSamples: number) => {
      const f = frameOf(member, pupilSamples);
      const squared = (f.halfExtentMm / f.scale.referenceRadius) ** 2;
      return {
        coefficient: (scaleDrift(member, f).pixelScale / squared - 1) / squared,
        resolution: (2 * Number.EPSILON) / (squared * squared),
      };
    };
    const settled = (member: OpticalSystem) => {
      const best = coefficientAt(member, 64);
      for (const n of [8, 16, 32]) {
        const here = coefficientAt(member, n);
        expect(Math.abs(here.coefficient - best.coefficient)).toBeLessThan(here.resolution);
      }
      expect(best.coefficient).toBeLessThan(0);
      return best.coefficient;
    };
    const rimCoefficient = settled(rimDin4x());
    const teleCoefficient = settled(system);
    expect(rimCoefficient).toBeCloseTo(-0.4916, 3);
    expect(Math.abs(rimCoefficient / -0.5 - 1)).toBeLessThan(0.02);
    expect(teleCoefficient).toBeCloseTo(-3.3027, 3);
    //
    // Across the field the same three forms are read, and the axial one is the
    // one with an exact next term to check against: r²/2R² is the leading term
    // of √(R² + r²)/R − 1, so it must miss by −r²/4R² relative. Measured against
    // that, the miss is ONE number over sixteen-fold in r — 0.983 on the rim
    // control and 6.60 telecentric, flat to 0.06% and 0.9% respectively — and
    // the ratio between those two, 6.717, is the SAME lever as the on-axis
    // coefficients' 6.718, to 0.02%. Two independent legs of the geometry, one
    // number, and that number is what a rear stop does to the chief ray's miss
    // of the pupil centre. That cross-check is the rung; the other two forms
    // have h_e and r entering together and are bounded as second order in r/R
    // rather than pinned, because they are not a single power of anything.
    const nextOrder: number[] = [];
    const rimNextOrder: number[] = [];
    for (const member of [system, rimDin4x()]) {
      const axis = frameOf(member).scale.referenceRadius;
      const into = member === system ? nextOrder : rimNextOrder;
      for (const r of [0.4, 0.8, 1.6, 3.2, 6.4]) {
        const tile = tileOf(member, r);
        const he = tile.halfExtentMm;
        const own = scaleDrift(member, tile).pixelScale;
        const axial = Math.abs(tile.scale.referenceRadius / axis - 1);
        const Rtile = tile.scale.referenceRadius;
        const second = (r / Rtile) ** 2;
        into.push((axial / ((r * r) / (2 * axis * axis)) - 1) / (-second / 4));
        expect(Math.abs(own / ((he * (r + he)) / (Rtile * Rtile)) - 1)).toBeLessThan(8 * second);
        // The trade itself: which ruler is cheaper, and by how much.
        // Relative, because the gain runs from 0.7 to 17 and an absolute bound
        // would mean something different at each end.
        const gain = axial / own;
        expect(Math.abs(gain / ((r * r) / (2 * he * (r + he))) - 1)).toBeLessThan(8 * second);
        if (r < crossover) expect(gain).toBeLessThan(1);
        else expect(gain).toBeGreaterThan(1);
      }
    }
    for (const set of [nextOrder, rimNextOrder]) {
      for (const q of set) expect(Math.abs(q / set[0]! - 1)).toBeLessThan(1.5e-2);
    }
    expect(rimNextOrder[0]!).toBeCloseTo(0.983, 2);
    expect(nextOrder[0]!).toBeCloseTo(6.605, 2);
    // The same lever, reached twice: the ratio of the two members' next-order
    // coefficients here and the ratio of their on-axis ones agree to 0.02%.
    expect(
      nextOrder[0]! / rimNextOrder[0]! / (teleCoefficient / rimCoefficient) - 1,
    ).toBeCloseTo(0, 3);
  });
});

describe("§ 6m.4 — a millimetre of field, which one frame could not see", () => {
  it("grows defocus as h² across tile centres — the objective's field curvature", () => {
    // The external number § 6h could not reach. Third-order theory makes the
    // Petzval/astigmatic focal surface depart from the flat image plane as h²,
    // so a MOSAIC on a flat plane must show defocus growing quadratically with
    // field. § 6h.4 measured coma and astigmatism and not this, because inside
    // one 47 µm frame the term is ~1e-6 waves and sits under the fit's own
    // noise. Tiles reach 0.8 mm, where it is 0.106 waves — and it is ×4.00 per
    // doubling, which is one of the sharpest field-order rungs in the branch.
    //
    // § 6ai DOUBLED the term and left the order alone, which is the shape a stop
    // shift has: −8.28e-4 waves at 0.1 mm on the rim against −1.66e-3 telecentric,
    // the same sign, 2.00× at every height. Third-order theory says why the sign
    // and the order cannot move — the Petzval sum depends on the powers and the
    // indices only, so no diaphragm can touch it — while the astigmatic part of
    // the same surface DOES move with the stop, and that is the factor two.
    //
    // The ×4 is pinned to 2e-3 on the shipped lens and 1e-3 on the control, and
    // the reason is the accompanying h⁴ term rather than a slacker rung: the
    // departure from four runs 0.07% → 0.17% across the range telecentric and
    // 0.007% → 0.09% on the rim, i.e. it grows with the term it corrects.
    const measure = (member: OpticalSystem) => {
      const onAxis = coefficient(fieldPupilAt(member, frameOf(member), 0.5, 0.5).fit, 4);
      return [0.1, 0.2, 0.4, 0.8].map(
        (h) =>
          coefficient(
            fieldPupilAt(member, tileOf(member, imageRadius(member, h)), 0.5, 0.5).fit,
            4,
          ) - onAxis,
      );
    };
    const heights = [0.1, 0.2, 0.4, 0.8];
    const system = din4x();
    const defocus = measure(system);
    const rimDefocus = measure(rimDin4x());
    for (const d of defocus) expect(Math.sign(d)).toBe(Math.sign(defocus[0]!));
    expect(fittedOrder(heights, defocus)).toBeCloseTo(2, 2);
    expect(fittedOrder(heights, rimDefocus)).toBeCloseTo(2, 3);
    for (let i = 1; i < defocus.length; i++) {
      expect(Math.abs(defocus[i]! / defocus[i - 1]! / 4 - 1)).toBeLessThan(2e-3);
      expect(Math.abs(rimDefocus[i]! / rimDefocus[i - 1]! / 4 - 1)).toBeLessThan(1e-3);
    }
    // The stop shift is a clean factor: same sign, 2.00× at every height.
    for (let i = 0; i < heights.length; i++) {
      expect(Math.sign(defocus[i]!)).toBe(Math.sign(rimDefocus[i]!));
      expect(defocus[i]! / rimDefocus[i]!).toBeCloseTo(2, 1);
    }
    // Real, and large: 0.106 waves is 10⁴× the axial fit's own noise floor.
    expect(Math.abs(defocus[defocus.length - 1]!)).toBeGreaterThan(1e-1);
  });

  it("keeps coma h¹ and astigmatism h² over 8× of field, where § 6h.4 had a frame", () => {
    // Composition rather than a new pin — § 6h.4 already measured these orders,
    // reaching outside its own frame to do it. What is new is that they are read
    // at tile CENTRES, in range, on tiles that render: the same third-order
    // dependence surviving across 8× of field — 0.1 mm to 0.8 mm — rather than
    // across one 47 µm frame.
    //
    // **§ 6ai split this rung in two, and the split is the finding.** The stop
    // shift equations say S_II* = S_II + E·S_I and S_III* = S_III + 2E·S_II +
    // E²·S_I: moving the diaphragm cannot change coma or astigmatism unless the
    // system has spherical aberration to lend them, and a single cemented doublet
    // solved on axis has plenty. Measured, at 0.1 mm: coma falls to 0.294 of the
    // rim member's and astigmatism rises to 2.38× — one subtracting, one adding,
    // which is the sign pattern those two equations have.
    //
    // The consequence is that the pure h¹ law is no longer READABLE over 8× of
    // field on the shipped lens: with third-order coma cut to 29%, the fifth-order
    // term it always had is no longer negligible at 0.8 mm, so the fitted order
    // runs 0.948 and falls monotonically along the sweep (2.00, 1.96, 1.84 per
    // doubling). The external law is unharmed — it still reads 1.00002 on the
    // control, and 0.99 over the first doubling here, where the cubic has not
    // caught up. So the sharp pins stay on the rim member, which is the one that
    // can carry them, and the shipped lens carries the departure with its cause.
    const orders = (member: OpticalSystem) => {
      const heights = [0.1, 0.2, 0.4, 0.8];
      const coma: number[] = [];
      const astig: number[] = [];
      for (const h of heights) {
        const p = fieldPupilAt(member, tileOf(member, imageRadius(member, h)), 0.5, 0.5);
        expect(p.objectHeightMm).toBeCloseTo(h, 9);
        coma.push(Math.hypot(coefficient(p.fit, 7), coefficient(p.fit, 8)));
        astig.push(Math.hypot(coefficient(p.fit, 5), coefficient(p.fit, 6)));
      }
      return { heights, coma, astig };
    };
    const rim = orders(rimDin4x());
    expect(fittedOrder(rim.heights, rim.coma)).toBeCloseTo(1, 3);
    expect(fittedOrder(rim.heights, rim.astig)).toBeCloseTo(2, 3);

    const tele = orders(din4x());
    expect(tele.coma[0]! / rim.coma[0]!).toBeCloseTo(0.294, 3);
    expect(tele.astig[0]! / rim.astig[0]!).toBeCloseTo(2.377, 2);
    // Astigmatism keeps the law outright; coma keeps it only near the axis.
    expect(fittedOrder(tele.heights, tele.astig)).toBeCloseTo(2, 2);
    expect(Math.log2(tele.coma[1]! / tele.coma[0]!)).toBeCloseTo(1, 1);
    const comaOrder = fittedOrder(tele.heights, tele.coma);
    expect(comaOrder).toBeGreaterThan(0.94);
    expect(comaOrder).toBeLessThan(1);
    // …and it is sub-linear because the cubic SUBTRACTS: each doubling buys less
    // than the last, monotonically, which a fit-noise story would not produce.
    for (let i = 2; i < tele.coma.length; i++) {
      expect(tele.coma[i]! / tele.coma[i - 1]!).toBeLessThan(tele.coma[i - 1]! / tele.coma[i - 2]!);
    }
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
    // on the tile's OWN edges rather than on the closed form: ~2.97 at 0.4 mm and
    // ~3.00 at 1.6 mm, as the h³ term climbs clear of the inverse's 1e-9 closure.
    //
    // **§ 6ai flipped the sign of C and left the 3 alone, which is the textbook
    // result and the sharpest external number in this rung.** A stop in front of
    // a lens gives barrel distortion and a stop behind it gives pincushion — that
    // is the standard statement, and the DIN objective was carrying the front-stop
    // case only because its diaphragm sat on the specimen-side glass. With the
    // diaphragm on the back focal plane every departure changes sign: radial and
    // tangential magnifications go from BELOW the linear reference to ABOVE it,
    // at every field, while their ratio stays 3 because that ratio is a derivative
    // and does not know the sign of what it differentiates.
    //
    // The size moved with the sign: |radial − M| is 71× the rim member's, and it
    // is ONE number at 0.4, 0.8 and 1.6 mm (70.7, 70.8, 71.1 — flat to 0.6%), so
    // it is the stop's lever arm and not the field. 1.4% out of square at 1.6 mm
    // where the rim lens was 0.02% is the real cost of the flip for a mosaic, and
    // it is a thing no single per-tile scale can carry.
    const anisotropy = (member: OpticalSystem) => {
      const m = Math.abs(frameOf(member).magnification);
      return [0.4, 0.8, 1.6].map((h) => {
        const tile = tileOf(member, imageRadius(member, h));
        const span = 2 * tile.halfExtentMm;
        const radial =
          span / (objectPointAt(member, tile, 1, 0.5).x - objectPointAt(member, tile, 0, 0.5).x);
        const tangential =
          span / (objectPointAt(member, tile, 0.5, 1).y - objectPointAt(member, tile, 0.5, 0).y);
        // The radial departure is always the larger — it is the one carrying 3C.
        expect(Math.abs(radial - m)).toBeGreaterThan(Math.abs(tangential - m));
        // The tangential edge measurement IS the closed form r/h, to 0.6%.
        expect(tangential / (imageRadius(member, h) / h) - 1).toBeCloseTo(0, 4);
        return { radial: radial - m, tangential: tangential - m, ratio: (radial / m - 1) / (tangential / m - 1) };
      });
    };
    const system = din4x();
    const tele = anisotropy(system);
    const rim = anisotropy(rimDin4x());
    for (const set of [tele, rim]) {
      for (const s of set) expect(Math.abs(s.ratio / 3 - 1)).toBeLessThan(1e-2);
      expect(Math.abs(set[set.length - 1]!.ratio / 3 - 1)).toBeLessThan(3e-3);
    }
    // The textbook sign: stop in front → barrel, stop behind → pincushion.
    for (const s of rim) {
      expect(s.radial).toBeLessThan(0);
      expect(s.tangential).toBeLessThan(0);
    }
    for (const s of tele) {
      expect(s.radial).toBeGreaterThan(0);
      expect(s.tangential).toBeGreaterThan(0);
    }
    // …and the magnitude is the stop's arm, so it is one number at every field.
    const lever = tele.map((s, i) => Math.abs(s.radial / rim[i]!.radial));
    for (const q of lever) expect(Math.abs(q / lever[0]! - 1)).toBeLessThan(1e-2);
    expect(lever[0]!).toBeCloseTo(70.7, 0);
    // Exactly square on the axis, where C·h² vanishes — the negative control,
    // and it holds whichever side of the lens the diaphragm is on.
    for (const member of [system, rimDin4x()]) {
      const axial = tileOf(member, 0);
      const ax = objectPointAt(member, axial, 1, 0.5).x - objectPointAt(member, axial, 0, 0.5).x;
      const ay = objectPointAt(member, axial, 0.5, 1).y - objectPointAt(member, axial, 0.5, 0).y;
      expect(ax).toBe(ay);
    }
  });

  it("renders a tile that is still honest, and softer, the further out it sits", () => {
    // What the mosaic will actually show. The tiles rule `valid` — they are
    // traced, so § 6f.9's verdict has the sampling it needs — and the picture
    // degrades because the OBJECTIVE does: a single cemented doublet solved on
    // axis carries 0.140 waves rms there and 0.632 at 1.6 mm, and the grating's
    // contrast follows it down from 0.870 to 0.231. That is the DIN 4×'s own
    // field and not the mapping's limit; nothing here vignettes.
    //
    // **Two of those numbers moved at § 6x and one did not, which is the point.**
    // The rms figures are the WAVEFRONT and are untouched — an illumination
    // offset is not an aberration. The contrasts are the picture, and they fell
    // because a rim-stopped objective lights 1.6 mm of field from a cone sitting
    // 0.348 of a pupil radius off centre. This rung also moved to 64 bins with
    // them, and for § 6h.5's reason: swept by hand at 32 bins the contrast
    // against the offset is not even monotone (0.340, 0.239, 0.172, 0.320, 0.165
    // over d = 0 → its true value), so the number there was the lattice's and not
    // the objective's. At 64 it falls smoothly — 0.525, 0.457, 0.378, 0.257,
    // 0.205 — and stops moving when the source is refined (§ 6x.6).
    //
    // **§ 6ai took that offset to exactly zero and charged for it in clipping**,
    // and the two together are why this rung now runs on both members. The offset
    // is 0 at 0, 0.8 and 1.6 mm — not small, the f64 zero — because a back focal
    // stop puts the entrance pupil at infinity and every field point is then lit
    // down a cone on its own axis. That is the definition of object-space
    // telecentric, and it is the most direct measurement of it in the branch.
    //
    // What it costs is the last sentence above: "nothing here vignettes" is no
    // longer true. The diaphragm is sized on the PARAXIAL marginal ray, so an
    // off-axis pencil that has to cross it obliquely runs past the rim — 8 rays
    // of 349 at 0.8 mm and 38 at 1.6. The picture stays honest (`valid` at every
    // field, the verdict having the traced sampling it needs) and the contrast
    // still falls with field, but the rms now falls with the clipping too — 0.323
    // waves at 1.6 mm against the rim member's 0.632 — and reading that as a
    // better lens would be exactly the wrong conclusion: it is a smaller pupil.
    // Hence both members here, and § 6ai.4 for the clipping on its own.
    const system = din4x();
    const size = 128;
    const pupilSamples = 64;
    const grating = cosineGratingObject({ size, cycles: CYCLES, modulation: 0.6 });
    const rowContrast = (intensity: Float64Array) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = 0; x < size; x++) {
        const value = intensity[(size / 2) * size + x]!;
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      return (hi - lo) / (hi + lo);
    };
    const walk = (member: OpticalSystem) => {
      const seen: { rms: number; contrast: number; lost: number; offset: number }[] = [];
      for (const h of [0, 0.8, 1.6]) {
        const tile = tileOf(member, h === 0 ? 0 : imageRadius(member, h), 0, pupilSamples, size);
        const centre = fieldPupilAt(member, tile, 0.5, 0.5);
        const out = renderBrightfield(grating, tracedFieldPupils(member, tile), SOURCE, {
          patches: 2,
          pupilSamples,
          scale: tile.scale,
          requireHonest: true,
        });
        expect(out.fidelity.verdict).toBe("valid");
        seen.push({
          rms: centre.rmsWaves,
          contrast: rowContrast(out.intensity),
          lost: centre.lost,
          offset: centre.radialIlluminationOffset,
        });
      }
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]!.rms).toBeGreaterThan(seen[i - 1]!.rms);
        expect(seen[i]!.contrast).toBeLessThan(seen[i - 1]!.contrast);
      }
      return seen;
    };
    const rim = walk(rimDin4x());
    for (const s of rim) expect(s.lost).toBe(0);
    expect(rim[0]!.rms).toBeCloseTo(0.14, 2);
    expect(rim[2]!.rms).toBeCloseTo(0.632, 2);
    expect(rim[0]!.contrast).toBeCloseTo(0.87, 2);
    expect(rim[2]!.contrast).toBeCloseTo(0.231, 2);
    // On axis the offset is identically zero, so that first contrast is the one
    // number here § 6x cannot have touched — it is the fixture change alone.
    expect(rim[0]!.offset).toBe(0);
    expect(rim[2]!.offset).toBeCloseTo(0.3478, 4);

    const seen = walk(system);
    // Telecentric: no offset at ANY field, and it is the f64 zero.
    for (const s of seen) expect(s.offset).toBe(0);
    // …paid for on the paraxially-sized diaphragm, which clips off axis.
    expect(seen[0]!.lost).toBe(0);
    expect(seen[1]!.lost).toBe(8);
    expect(seen[2]!.lost).toBe(38);
    expect(seen[0]!.rms).toBeCloseTo(0.142, 2);
    expect(seen[2]!.rms).toBeCloseTo(0.323, 2);
    expect(seen[0]!.contrast).toBeCloseTo(0.87, 2);
    expect(seen[2]!.contrast).toBeCloseTo(0.264, 2);
    // The axial picture is the SAME picture — 4e-5 of contrast between the two
    // members — which is what says the falls above are field and not fixture.
    expect(Math.abs(seen[0]!.contrast - rim[0]!.contrast)).toBeLessThan(1e-4);
  });
});
