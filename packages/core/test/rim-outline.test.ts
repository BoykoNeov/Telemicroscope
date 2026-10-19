import { describe, it, expect } from "vitest";
import { rimOutline, rimPolygon } from "../src/pupil/rim-outline";

/**
 * § 2v — the outline through the rim rays, against closed forms with no trace
 * in them.
 *
 * An off-centre ellipse sampled at 32 equal steps of its parameter is what a
 * decentred, foreshortened rim looks like to `rimOutline`: x and y are first
 * harmonics of the parameter, so the trigonometric interpolant is the ellipse
 * itself and its radius along any direction from the origin is a quadratic's
 * root. The polygon in angle (§ 2l–§ 2u) is the contrast.
 */
const N = 32;

/** An ellipse centred at (x0, y0), semi-axes a, b, sampled at parameter 2πk/N; `sense` −1 runs it clockwise. */
const ellipse = (x0: number, y0: number, a: number, b: number, sense = 1) =>
  Array.from({ length: N }, (_, k) => {
    const t = (sense * 2 * Math.PI * k) / N;
    return { px: x0 + a * Math.cos(t), py: y0 + b * Math.sin(t), reach: 1 };
  });

/** The ellipse's radius along exit angle φ from the origin. */
const ellipseRadius = (x0: number, y0: number, a: number, b: number, phi: number) => {
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  const A = (ux * ux) / (a * a) + (uy * uy) / (b * b);
  const B = -2 * ((ux * x0) / (a * a) + (uy * y0) / (b * b));
  const C = (x0 * x0) / (a * a) + (y0 * y0) / (b * b) - 1;
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
};

describe("§ 2v — the outline through the rim rays", () => {
  it.each([
    ["anticlockwise", 1],
    ["clockwise, as an odd number of mirrors lays it", -1],
  ] as const)("an off-centre ellipse, %s: its radius to rounding at every exit angle, where the polygon misses by 1e-3", (_, sense) => {
    // Centred 0.2 off the chief ray, 1.05 × 0.95: a rim far more lopsided than
    // the oil 100×'s at 20 µm. The polygon misses by 1.6e-3 at worst and its
    // area is 2.1e-4 large; the curve misses by 3.3e-15, its area 6e-16 off.
    const [x0, y0, a, b] = [0.2, -0.05, 1.05, 0.95];
    const curve = rimOutline(ellipse(x0, y0, a, b, sense), 1);
    const poly = rimPolygon(ellipse(x0, y0, a, b, sense), 1);
    expect(curve.scheme).toBe("curve");
    let worstCurve = 0;
    let worstPoly = 0;
    for (let k = 0; k < 997; k++) {
      const phi = -Math.PI + (2 * Math.PI * (k + 0.5)) / 997;
      const r = ellipseRadius(x0, y0, a, b, phi);
      worstCurve = Math.max(worstCurve, Math.abs(curve.radiusAt(phi) - r));
      worstPoly = Math.max(worstPoly, Math.abs(poly.radiusAt(phi) - r));
      // And `inside` agrees with the radius on both sides of it.
      expect(curve.inside((r - 1e-12) * Math.cos(phi), (r - 1e-12) * Math.sin(phi))).toBe(true);
      expect(curve.inside((r + 1e-12) * Math.cos(phi), (r + 1e-12) * Math.sin(phi))).toBe(false);
    }
    expect(worstCurve).toBeLessThan(1e-14);
    expect(worstPoly).toBeGreaterThan(1e-3);
    // πab, from the series' coefficients alone.
    expect(Math.abs(curve.area / (Math.PI * a * b) - 1)).toBeLessThan(1e-14);
  });

  it("a rim carrying every harmonic below the 32 rays' Nyquist is still its own curve", () => {
    // z(θ) = e^{iθ} + Σ 0.001·e^{i(mθ + m)}, m = −15 … 15 but 1: every point
    // z(θ) lies on the outline, |z| along arg z, to rounding.
    const z = (t: number): [number, number] => {
      let x = Math.cos(t);
      let y = Math.sin(t);
      for (let m = -15; m <= 15; m++) {
        if (m === 1) continue;
        x += 0.001 * Math.cos(m * t + m);
        y += 0.001 * Math.sin(m * t + m);
      }
      return [x, y];
    };
    const rim = Array.from({ length: N }, (_, k) => {
      const [px, py] = z((2 * Math.PI * k) / N);
      return { px, py, reach: 1 };
    });
    const outline = rimOutline(rim, 1);
    let worst = 0;
    for (let k = 0; k < 997; k++) {
      const [x, y] = z((2 * Math.PI * (k + 0.5)) / 997);
      worst = Math.max(worst, Math.abs(outline.radiusAt(Math.atan2(y, x)) - Math.hypot(x, y)));
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it("where the reach varies, the outline stays the polygon: a vignetted rim's corner is no curve", () => {
    const rim = ellipse(0.1, 0, 1, 1).map((p, k) => (k < 8 ? { ...p, reach: 0.9 } : p));
    expect(rimOutline(rim, 1).scheme).toBe("polygon");
  });

  it("a rim that does not turn once around the chief ray is refused", () => {
    expect(() => rimOutline(ellipse(1.5, 0, 1, 1), 1)).toThrow(/turns/);
  });
});
