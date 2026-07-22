import { describe, it, expect } from "vitest";
import { vec3 } from "../src/math/vec3";
import { applyToPoint } from "../src/math/transform";
import { compile } from "../src/trace/compile";
import { spaceToWorld } from "../src/trace/axis";
import { traceRay, makeRay } from "../src/trace";
import { systemProperties } from "../src/trace/paraxial";
import { OpticalSystem } from "../src/trace/system";
import { imagePlaneZ } from "../src/pupil/pupils";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { fitZernike, coefficient } from "../src/wave/zernike";
import { psf } from "../src/wave/psf";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { exitBundle, spotAt } from "../src/analysis/spot";
import { imagePointOf } from "../src/imaging/scene";
import { newtonian } from "../src/designs/newtonian";

/**
 * Rungs for the Newtonian preset (docs/VALIDATION.md § 4b).
 *
 * A Newtonian is a single paraboloid plus a flat, so almost everything about it
 * is a closed form and there is no design table to hide behind. The rungs below
 * pin, in order: that the fold puts focus where the mechanics say, that the
 * paraboloid is perfect on axis, and that its coma is the textbook third-order
 * coma of a stop-at-the-mirror paraboloid — in size, not merely in shape.
 */

const LAM = 550;

function system(p: ReturnType<typeof newtonian>, D: number): OpticalSystem {
  return {
    prescription: p.prescription,
    aperture: { kind: "stopRadius", value: D / 2 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

describe("Newtonian geometry", () => {
  const D = 200;
  const F = 5;
  const scope = newtonian({ apertureMm: D, focalRatio: F, focusOffsetMm: 200 });

  it("has the focal length its focal ratio names", () => {
    expect(scope.focalLengthMm).toBe(1000);
    expect(systemProperties(scope.prescription, LAM).efl).toBeCloseTo(1000, 6);
  });

  it("brings focus out the side of the tube, where the focuser is", () => {
    // The whole reason the design needs a folded chain: focus is not on the
    // axis at all. Reached here through the paraxial axis and the unfolded→world
    // map, while `fold.test.ts` reaches the same point by tracing rays.
    const c = compile(scope.prescription);
    const s = system(scope, D);
    const world = applyToPoint(spaceToWorld(c, 2), vec3(0, 0, imagePlaneZ(c, s)));
    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(200, 9); // the focus offset asked for
    expect(world.z).toBeCloseTo(-scope.diagonalDistanceMm, 9);
  });

  /**
   * Rung: the minor-axis formula is the beam the diagonal has to catch.
   *
   * m = D·(f − d)/f with no field allowance says the minor axis is exactly the
   * converging beam's diameter where the diagonal sits. Measured in the
   * tilt-free direction (+x), which is the one direction where the projection
   * is exact and the convergence asymmetry cannot contaminate it.
   */
  it("sizes the diagonal to the beam that reaches it", () => {
    const res = traceRay(scope.prescription, makeRay(vec3(D / 2, 0, -50), vec3(0, 0, 1), LAM));
    expect(res.status).toBe("ok");
    const hit = res.path[1]!; // the hit on the diagonal
    expect(Math.abs(hit.x)).toBeCloseTo(scope.diagonalMinorAxisMm / 2, 6);

    // The classic amateur-telescope formula D·(f − d)/f is the paraxial limit
    // of the same thing, and lands 0.25% narrow at f/5 because it starts the
    // marginal ray at the vertex plane instead of the sag plane. Pinned so the
    // difference is on the record rather than looking like an error.
    const classic = (D * (scope.focalLengthMm - scope.diagonalDistanceMm)) / scope.focalLengthMm;
    expect(scope.diagonalMinorAxisMm / classic).toBeCloseTo(1.0025, 4);
  });

  /**
   * Rung: the whole on-axis beam gets through — the asymmetry rung.
   *
   * A tilted flat standing in a converging beam meets one edge nearer the
   * primary, where the beam is still wider, so its footprint is NOT the m × m√2
   * ellipse the projection suggests. The preset sizes the clear aperture to
   * a·√2/(1 − 1/2F) for that reason, and this rung is what pins it: cut the
   * diagonal to the naive √2 rule instead and the pupil's own edge clips.
   */
  it("passes the whole on-axis beam, which the naive ellipse would not", () => {
    const s = system(scope, D);
    expect(opdMap(s, 0, LAM, pupilGrid(21)).lost).toBe(0);

    const naive: typeof scope.prescription = {
      ...scope.prescription,
      surfaces: [
        scope.prescription.surfaces[0]!,
        {
          ...scope.prescription.surfaces[1]!,
          semiAperture: (scope.diagonalMinorAxisMm * Math.SQRT2) / 2,
        },
      ],
    };
    const clipped = opdMap({ ...s, prescription: naive }, 0, LAM, pupilGrid(21));
    expect(clipped.lost).toBeGreaterThan(0);
  });

  it("reports the obstruction the diagonal projects onto the pupil", () => {
    // The ellipse seen along the axis is a circle of diameter equal to the
    // minor axis, so the obstruction is that over the aperture.
    expect(scope.obstruction).toBeCloseTo(scope.diagonalMinorAxisMm / D, 12);
    expect(scope.obstruction).toBeCloseTo(0.2005, 4); // ≈ (f − d)/f = 200/1000
  });

  it("refuses a focus offset that does not fit inside the tube", () => {
    expect(() => newtonian({ apertureMm: 200, focalRatio: 5, focusOffsetMm: 1200 })).toThrow(
      /does not fit/,
    );
  });
});

/**
 * Rung: on axis a paraboloid is perfect.
 *
 * The external number is exact and needs no table: a paraboloid brings every
 * ray from an infinitely distant axial point to one focus, so the wavefront
 * error is zero and the PSF is the Airy pattern of the aperture. Anything the
 * fold got wrong — a mis-mapped image plane, a reference sphere in the wrong
 * space — shows up here as wavefront error out of nowhere.
 */
describe("Newtonian on axis", () => {
  const D = 200;
  const scope = newtonian({ apertureMm: D, focalRatio: 5, focusOffsetMm: 200 });
  const s = system(scope, D);

  it("has no wavefront error at all", () => {
    const map = opdMap(s, 0, LAM, pupilGrid(21));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeLessThan(1e-6);
  });

  it("is diffraction-limited: Strehl 1", () => {
    const p = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    expect(p.strehl).toBeCloseTo(1, 6);
  });

  /**
   * Rung: the imaging layer lands a star where a mirror of focal length f does.
   *
   * `imagePointOf` walks its own path to the image plane, so it needs the map
   * as much as OPD does and is covered by none of the rungs above. The external
   * number is the plate scale of a single mirror: r = f·tan θ, exactly, since a
   * Newtonian has no distortion-inducing element to spoil it. The azimuth check
   * is what would catch the image arriving rotated by the fold.
   */
  it("puts a star at f·tan(θ), at the azimuth it came from", () => {
    const focused = withFocus(s, bestFocus(s, "paraxial").offsetFromLastVertex);
    const f = scope.focalLengthMm;
    for (const deg of [0.1, 0.5]) {
      const p = imagePointOf(focused, deg, 0, LAM);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(f * Math.tan((deg * Math.PI) / 180), 6);
    }
    const up = imagePointOf(focused, 0.2, Math.PI / 2, LAM);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(f * Math.tan((0.2 * Math.PI) / 180), 6);
  });

  it("keeps the obstruction out of the geometry and in the pupil function", () => {
    // The diagonal is not traced as a blocker, so an obstructed PSF must differ
    // from an unobstructed one only because the pupil function was told to.
    const clear = psf(s, 0, LAM, { traceSamples: 13, pupilSamples: 32, padFactor: 2 });
    const blocked = psf(s, 0, LAM, {
      traceSamples: 13,
      pupilSamples: 32,
      padFactor: 2,
      obstruction: scope.obstruction,
    });
    // An annular pupil passes less light and pushes energy out of the core.
    expect(blocked.energy).toBeLessThan(clear.energy);
    expect(blocked.energy / clear.energy).toBeCloseTo(1 - scope.obstruction ** 2, 2);
  });
});

/**
 * Rung: Newtonian coma, against third-order theory — the size, not the shape.
 *
 * For a paraboloid with the stop at the mirror the primary aberration is coma
 * with peak wavefront coefficient
 *
 *     A = θ·D / (32·F²)          (mm, at the pupil rim)
 *
 * Fitted as Noll-normalized Zernike coefficients, which ARE RMS contributions,
 * that is A/√72 waves in term j = 8 (coma x — the field runs along +x).
 *
 * The trace agrees to within half a percent, and the *residual shrinks as the
 * system slows*: 0.47% at f/4, 0.30% at f/5, 0.075% at f/10. That is the
 * signature of the higher-order coma third-order theory omits, which scales as
 * a further power of 1/F — i.e. the disagreement is the theory's, not the
 * tracer's, and it disappears in the limit where the theory is exact. The
 * tolerance below is set to admit exactly that and nothing looser.
 */
describe("Newtonian coma", () => {
  const comaWaves = (D: number, F: number, deg: number): number => {
    const scope = newtonian({ apertureMm: D, focalRatio: F, focusOffsetMm: 200 });
    const s = system(scope, D);
    const focus = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const map = opdMap(withFocus(s, focus.offsetFromLastVertex), deg, LAM, pupilGrid(33));
    return coefficient(fitZernike(map.samples, 28), 8);
  };

  const thirdOrder = (D: number, F: number, deg: number): number => {
    const theta = (deg * Math.PI) / 180;
    const A = (theta * D) / (32 * F * F); // mm
    return (A * 1e6) / LAM / Math.sqrt(72); // waves RMS, Noll normalization
  };

  it("matches the third-order coefficient", () => {
    for (const [D, F, deg] of [
      [200, 5, 0.1],
      [200, 5, 0.4],
      [200, 10, 0.2],
      [100, 5, 0.2],
    ] as const) {
      const traced = comaWaves(D, F, deg);
      const theory = thirdOrder(D, F, deg);
      expect(traced / theory).toBeGreaterThan(0.99);
      expect(traced / theory).toBeLessThan(1.0);
    }
  });

  it("grows in proportion to field angle", () => {
    const one = comaWaves(200, 5, 0.1);
    const four = comaWaves(200, 5, 0.4);
    expect(four / one).toBeCloseTo(4, 3);
  });

  it("falls as 1/F² — the reason a fast Newtonian has a small usable field", () => {
    // 3.991, not 4.000, and the shortfall is real rather than numerical: the
    // exact trace sits below third-order theory by more at f/5 (0.30%) than at
    // f/10 (0.075%), so their ratio inherits the difference. A tolerance loose
    // enough to call it 4.000 would also admit a genuine scaling error, so the
    // rung asserts the sign of the deviation too — the faster system must fall
    // further below the third-order line, never above it.
    const fast = comaWaves(200, 5, 0.2);
    const slow = comaWaves(200, 10, 0.2);
    expect(fast / slow).toBeGreaterThan(3.98);
    expect(fast / slow).toBeLessThan(4.0);
  });

  it("is proportional to aperture at fixed focal ratio", () => {
    const big = comaWaves(200, 5, 0.2);
    const small = comaWaves(100, 5, 0.2);
    expect(big / small).toBeCloseTo(2, 3);
  });

  /**
   * Rung: the comatic patch is 3:2, and that ratio is pure third-order geometry.
   *
   * With W = A·ρ³cos φ the transverse aberrations are
   *     Δx ∝ ρ²(2 + cos 2φ),  Δy ∝ ρ² sin 2φ
   * so over the filled pupil Δx spans [0, 3] and Δy spans [−1, 1]: the flare is
   * exactly one and a half times as long as it is wide, whatever the aperture,
   * focal ratio or field angle. Nothing about the fold or the map can move it,
   * which is what makes it a good check that the spot really is coma.
   */
  it("throws a flare exactly 3:2, length to width", () => {
    const D = 200;
    const scope = newtonian({ apertureMm: D, focalRatio: 5, focusOffsetMm: 200 });
    const s = system(scope, D);
    const focus = bestFocus(s, "paraxial");
    const spot = spotAt(exitBundle(withFocus(s, focus.offsetFromLastVertex), 0.1, LAM, pupilGrid(41)), focus.z);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of spot.points) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    expect((maxX - minX) / (maxY - minY)).toBeCloseTo(1.5, 1);

    // ...and the length itself is the textbook tangential coma, 3θ/(16F²) rad.
    const theta = (0.1 * Math.PI) / 180;
    expect(maxX - minX).toBeCloseTo((3 * theta * scope.focalLengthMm) / (16 * 25), 3);
  });
});
