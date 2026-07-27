import { describe, it, expect } from "vitest";
import { vec3, dot, cross, normalize, length } from "../src/math/vec3";
import {
  rotationX, rotationY, translation, compose, invert,
  applyToPoint, applyToDirection, IDENTITY,
} from "../src/math/transform";
import { BESSEL_SERIES_LIMIT, besselJ1, jinc } from "../src/math/bessel";

describe("vec3", () => {
  it("cross product is orthogonal to both inputs", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-2, 0.5, 4);
    const c = cross(a, b);
    expect(dot(a, c)).toBeCloseTo(0, 12);
    expect(dot(b, c)).toBeCloseTo(0, 12);
  });

  it("normalize produces unit length", () => {
    expect(length(normalize(vec3(3, 4, 12)))).toBeCloseTo(1, 15);
  });
});

describe("rigid transforms", () => {
  it("inverse round-trips points and directions", () => {
    const tf = compose(
      translation(vec3(5, -2, 30)),
      { rotation: rotationX(0.3), translation: vec3(0, 0, 0) },
    );
    const inv = invert(tf);
    const p = vec3(1.5, -0.7, 2.2);
    const back = applyToPoint(inv, applyToPoint(tf, p));
    expect(back.x).toBeCloseTo(p.x, 12);
    expect(back.y).toBeCloseTo(p.y, 12);
    expect(back.z).toBeCloseTo(p.z, 12);

    const d = normalize(vec3(0.1, 0.2, 0.97));
    const dBack = applyToDirection(inv, applyToDirection(tf, d));
    expect(dBack.x).toBeCloseTo(d.x, 12);
    expect(dBack.z).toBeCloseTo(d.z, 12);
  });

  it("rotationY by 90° maps +z to +x", () => {
    const d = applyToDirection({ rotation: rotationY(Math.PI / 2), translation: vec3(0, 0, 0) }, vec3(0, 0, 1));
    expect(d.x).toBeCloseTo(1, 12);
    expect(d.z).toBeCloseTo(0, 12);
  });

  it("identity is neutral in composition", () => {
    const tf = compose(IDENTITY, translation(vec3(1, 2, 3)));
    expect(applyToPoint(tf, vec3(0, 0, 0)).y).toBe(2);
  });
});

describe("besselJ1 — the closed form the coherence rungs compare against (§ 6g.0)", () => {
  // Tabulated zeros of J₁. These are the external numbers: the same j₁,₁ that
  // makes Rayleigh's 0.61 and the Airy ring's 1.22, plus the next two so the
  // series is checked where its cancellation is worst.
  const ZEROS = [3.8317059702075125, 7.015586669815619, 10.17346813506272];

  it("agrees with Bessel's integral, which is an independent definition", () => {
    // J₁(x) = (1/π)∫₀^π cos(θ − x·sin θ) dθ. A second definition of the same
    // function, computed a completely different way — so this pins the series
    // against mathematics rather than against a remembered table of values.
    //
    // The integrand is smooth and periodic on [0, 2π], so the trapezoid rule
    // converges geometrically: 4096 nodes puts it at the f64 floor, which is
    // what makes this a pin and not a fit. (A finite-difference check of the
    // ODE would instead amplify the series' own cancellation by 1/h², and at
    // x ≈ 10 that noise is 1e-5 — larger than anything it could catch.)
    const nodes = 4096;
    const integral = (x: number): number => {
      // Compensated summation: 4096 naive additions of O(1) terms leak a few
      // 1e-15, which would otherwise be mistaken here for the series' error.
      let sum = 0;
      let carry = 0;
      for (let i = 0; i < nodes; i++) {
        const theta = (Math.PI * (i + 0.5)) / nodes;
        const term = Math.cos(theta - x * Math.sin(theta)) - carry;
        const next = sum + term;
        carry = next - sum - term;
        sum = next;
      }
      return sum / nodes;
    };
    // The tolerance is the series' own cancellation floor, derived rather than
    // tuned: the terms have total magnitude Σ|t_k| = I₁(x) ≈ e^x/√(2πx) and
    // sum to something below 0.6, so f64 can only deliver ε·I₁(x) of absolute
    // accuracy. Measured, the loss runs about a tenth of that — the roundoff is
    // a random walk, not an adversary — so this bound holds with an order of
    // headroom at every x while still growing the way the numerics do.
    const seriesFloor = (x: number): number =>
      2.3e-16 * (Math.exp(x) / Math.sqrt(2 * Math.PI * x));
    for (const x of [0.5, 1.5, 3, 6.2, 9.7, 14, 20, BESSEL_SERIES_LIMIT]) {
      expect(Math.abs(besselJ1(x) - integral(x))).toBeLessThan(1e-15 + seriesFloor(x));
    }
    // And the floor really is a floor, not a licence: out to x = 10, where
    // every caller in this engine lives, the two definitions agree to 13
    // digits — 15 below x = 3, and 13 by 9.7, which is the cancellation
    // arriving exactly on the schedule the bound above predicts.
    for (const x of [0.5, 1.5, 3]) {
      expect(besselJ1(x)).toBeCloseTo(integral(x), 15);
    }
    for (const x of [6.2, 9.7]) {
      expect(besselJ1(x)).toBeCloseTo(integral(x), 13);
    }
  });

  it("vanishes at the tabulated zeros, and only there between them", () => {
    for (const z of ZEROS) expect(Math.abs(besselJ1(z))).toBeLessThan(1e-12);
    // Between consecutive zeros it keeps one sign — the oscillation is simple,
    // so a series that had lost its alternation would show up as a sign flip
    // where there is no zero.
    const bounds = [0, ...ZEROS];
    for (let i = 0; i < bounds.length - 1; i++) {
      const expected = i % 2 === 0 ? 1 : -1;
      // Integer steps: accumulating 0.1 would put the last sample a rounding
      // error short of the next zero, where the sign is whatever 1e-16 happens
      // to be — a flake that says nothing about J₁.
      for (let j = 1; j <= 9; j++) {
        const x = bounds[i]! + (j / 10) * (bounds[i + 1]! - bounds[i]!);
        expect(Math.sign(besselJ1(x))).toBe(expected);
      }
    }
  });

  it("is odd, and J₁(0) = 0", () => {
    expect(besselJ1(0)).toBe(0);
    for (const x of [0.3, 2.2, 8.4]) {
      expect(besselJ1(-x)).toBeCloseTo(-besselJ1(x), 14);
    }
  });

  it("jinc fills its removable singularity: 2J₁(v)/v → 1", () => {
    expect(jinc(0)).toBe(1);
    // Approaching 0 the quadratic 1 − v²/8 takes over; either side of the cut
    // the two expressions must agree, or a plot of the coherence curve would
    // have a step in it at 1e-8. The next term of the series is +v⁴/192, so
    // the quadratic IS the f64 answer only while v⁴/192 is below the mantissa —
    // which is why this checks it at 1e-4 and not at 1e-2.
    for (const v of [1e-9, 1e-7, 1e-4]) {
      expect(jinc(v)).toBeCloseTo(1 - (v * v) / 8, 14);
    }
    // One term further out the v⁶/9216 term takes over — at v = 0.1 it is
    // 1.1e-10, which is why this stops at 1e-2 rather than marching on.
    expect(jinc(1e-2)).toBeCloseTo(1 - 1e-4 / 8 + 1e-8 / 192, 14);
    for (const v of [0.7, 2.5, 5.1]) {
      expect(jinc(v)).toBeCloseTo((2 * besselJ1(v)) / v, 15);
    }
  });

  it("refuses arguments where the series would be noise", () => {
    expect(() => besselJ1(BESSEL_SERIES_LIMIT + 0.1)).toThrow(/power series/);
    expect(() => besselJ1(NaN)).toThrow(/finite/);
    // At the limit itself it is still accurate — the refusal is a cliff placed
    // where the digits run out, not a margin around a smaller working range.
    expect(Math.abs(besselJ1(BESSEL_SERIES_LIMIT))).toBeLessThan(0.2);
  });
});
