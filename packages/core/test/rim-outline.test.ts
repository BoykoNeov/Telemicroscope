import { describe, it, expect } from "vitest";
import { STOP_EDGE, rimArcs, rimOutline, rimPolygon, type RimSample } from "../src/pupil/rim-outline";

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
    return { px: x0 + a * Math.cos(t), py: y0 + b * Math.sin(t), reach: 1, edge: STOP_EDGE };
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
      return { px, py, reach: 1, edge: STOP_EDGE };
    });
    const outline = rimOutline(rim, 1);
    let worst = 0;
    for (let k = 0; k < 997; k++) {
      const [x, y] = z((2 * Math.PI * (k + 0.5)) / 997);
      worst = Math.max(worst, Math.abs(outline.radiusAt(Math.atan2(y, x)) - Math.hypot(x, y)));
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it("where the edge changes around the rim the arcs are the rim, and without them the outline refuses (§ 2y)", () => {
    const rim = ellipse(0.1, 0, 1, 1).map((p, k) => (k < 8 ? { ...p, reach: 0.9, edge: "miss@2" } : p));
    expect(() => rimOutline(rim, 1)).toThrow(/arcs/);
  });

  it("a rim cut all round by one constraint has no corner, and takes the curve whatever its reach (§ 2y)", () => {
    const rim = ellipse(0.1, 0, 1, 1).map((p, k) => ({ ...p, reach: 0.9 + 0.001 * k, edge: "vignetted@3" }));
    expect(rimOutline(rim, 1).scheme).toBe("curve");
  });

  it("a rim that does not turn once around the chief ray is refused", () => {
    expect(() => rimOutline(ellipse(1.5, 0, 1, 1), 1)).toThrow(/turns/);
  });
});

/**
 * § 2y — a vignetted pupil in closed form: the unit aim circle cut by circles
 * that hold the chief ray, carried to the exit plane by a fixed affine map. Its
 * corners are where the circles cross; its radius along any exit angle is the
 * smaller of the boundaries' quadratic roots, pulled back through the map; and
 * with one cut its area is the two circles' lens times |det|. `rimArcs` is
 * handed the same circles as its probe, so no trace enters.
 */
const T = { a: 1.07, b: 0.12, c: -0.05, d: 0.93, ex: 0.08, ey: -0.03 };
const det = T.a * T.d - T.b * T.c;
const forward = (x: number, y: number): [number, number] => [T.a * x + T.b * y + T.ex, T.c * x + T.d * y + T.ey];
const back = (X: number, Y: number): [number, number] => {
  const x = X - T.ex;
  const y = Y - T.ey;
  return [(T.d * x - T.b * y) / det, (-T.c * x + T.a * y) / det];
};
type Cut = readonly [cx: number, cy: number, r: number];
/** A circle's radius along aim angle θ from the origin, which it holds. */
const reachOf = (t: number, [cx, cy, r]: Cut) => {
  const b = Math.cos(t) * cx + Math.sin(t) * cy;
  return b + Math.sqrt(b * b - (cx * cx + cy * cy - r * r));
};
/** The clipped pupil as `exitRim` and its probe would report it. */
function clipped(cuts: readonly Cut[]) {
  const edge = (t: number): RimSample => {
    let reach = 1;
    let cls = STOP_EDGE;
    cuts.forEach((c, i) => {
      const q = reachOf(t, c);
      if (q < reach) {
        reach = q;
        cls = `cut${i}`;
      }
    });
    const [px, py] = forward(reach * Math.cos(t), reach * Math.sin(t));
    return { px, py, reach, edge: cls };
  };
  const probe = {
    stop: (t: number) => (edge(t).edge === STOP_EDGE ? forward(Math.cos(t), Math.sin(t)) : null),
    edge,
  };
  const rim = Array.from({ length: N }, (_, k) => edge((2 * Math.PI * k) / N));
  return { rim, probe, edge };
}
/** The pupil's radius along exit angle φ: the nearest boundary, pulled back through the map. */
function exactRadius(cuts: readonly Cut[], phi: number): number {
  const [ox, oy] = back(0, 0);
  const [vx, vy] = back(Math.cos(phi) + T.ex, Math.sin(phi) + T.ey);
  const root = ([qx, qy, r]: Cut) => {
    const A = vx * vx + vy * vy;
    const B = 2 * ((ox - qx) * vx + (oy - qy) * vy);
    const C = (ox - qx) ** 2 + (oy - qy) ** 2 - r * r;
    return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  };
  return Math.min(root([0, 0, 1]), ...cuts.map(root));
}

describe("§ 2y — the outline turns at the rim's corners", () => {
  it.each([
    // Centre and radius of the cutting circle: depth 1 + |c| − r where it cuts.
    ["one ray", [-2, 0, 2.995]],
    ["nine rays", [-0.5, 0, 1.43]],
    ["a cut centred off every ray", [-0.6, -0.4, 1.6]],
    ["most of the rim", [0.3, 0.2, 0.9]],
  ] as const)("a circle clipped by a circle, foreshortened — %s cut: radius, corners and area to rounding", (_, cut) => {
    // Radius within 2.0e-15 at worst, area within 7.1e-15, corners within the
    // bisection's 1e-9 (6.5e-10 at worst).
    const { rim, probe } = clipped([cut]);
    const arcs = rimArcs(rim, probe)!;
    const outline = rimOutline(rim, 1, arcs);
    expect(outline.scheme).toBe("arcs");
    for (let k = 0; k < 997; k++) {
      const phi = -Math.PI + (2 * Math.PI * (k + 0.5)) / 997;
      const r = exactRadius([cut], phi);
      expect(Math.abs(outline.radiusAt(phi) - r)).toBeLessThan(1e-14);
      expect(outline.inside((r - 1e-12) * Math.cos(phi), (r - 1e-12) * Math.sin(phi))).toBe(true);
      expect(outline.inside((r + 1e-12) * Math.cos(phi), (r + 1e-12) * Math.sin(phi))).toBe(false);
    }
    // The circles cross at x = (1 + d² − r²)/(2d) along their centre line.
    const [cx, cy, r] = cut;
    const d = Math.hypot(cx, cy);
    const spread = Math.acos((1 + d * d - r * r) / (2 * d));
    const corner = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const want = [corner(Math.atan2(cy, cx) - spread), corner(Math.atan2(cy, cx) + spread)].sort((u, v) => u - v);
    const got = arcs.map((a) => a.from % (2 * Math.PI)).sort((u, v) => u - v);
    got.forEach((g, i) => expect(Math.abs(g - want[i]!)).toBeLessThan(1e-9));
    const lens =
      Math.acos((d * d + 1 - r * r) / (2 * d)) +
      r * r * Math.acos((d * d + r * r - 1) / (2 * d * r)) -
      0.5 * Math.sqrt((-d + 1 + r) * (d + 1 - r) * (d - 1 + r) * (d + 1 + r));
    expect(Math.abs(outline.area / (Math.abs(det) * lens) - 1)).toBeLessThan(2e-14);
  });

  it("two cuts that meet with the stop nowhere between them: the corner between two cuts is located too", () => {
    // Radius within 1.6e-15 — the DIN 10×/0.20 at 0.5 mm, miss@2 against vignetted@3, is this shape.
    const cuts: Cut[] = [
      [-0.5, 0, 1.43],
      [-0.2, -0.45, 1.4],
    ];
    const { rim, probe, edge } = clipped(cuts);
    expect(new Set(rim.map((p) => p.edge)).size).toBe(3);
    const outline = rimOutline(rim, 1, rimArcs(rim, probe));
    for (let k = 0; k < 2003; k++) {
      const p = edge((2 * Math.PI * (k + 0.5)) / 2003);
      const phi = Math.atan2(p.py, p.px);
      expect(Math.abs(outline.radiusAt(phi) - Math.hypot(p.px, p.py))).toBeLessThan(1e-14);
    }
  });

  it("a cut between two rays that read the stop is found where an arc's node lands in it", () => {
    // Centred between rays 20 and 21, 3e-3 deep: no rim ray sees it, a node of
    // the stop's arc does, and its corners are located from there — 1.6e-15.
    const a = (20.5 * 2 * Math.PI) / N;
    const cuts: Cut[] = [
      [-0.5, 0, 1.43],
      [3 * Math.cos(a), 3 * Math.sin(a), 4 - 3e-3],
    ];
    const { rim, probe, edge } = clipped(cuts);
    expect(rim.some((p) => p.edge === "cut1")).toBe(false);
    const arcs = rimArcs(rim, probe)!;
    expect(arcs.map((arc) => arc.edge)).toContain("cut1");
    const outline = rimOutline(rim, 1, arcs);
    for (let k = 0; k < 2003; k++) {
      const p = edge((2 * Math.PI * (k + 0.5)) / 2003);
      expect(Math.abs(outline.radiusAt(Math.atan2(p.py, p.px)) - Math.hypot(p.px, p.py))).toBeLessThan(1e-14);
    }
  });

  it("what it cannot see: a cut no rim ray and no node lands in is missed by its depth", () => {
    // 1e-3 deep, between rays, where no node of the stop's arc falls: the
    // outline keeps the stop's rim across it, 9.4e-4 out in exit radius (the
    // map's own scale) — the polygon and the curve missed it the same way.
    const a = -Math.PI / 2 + 0.1;
    const cuts: Cut[] = [
      [-0.5, 0, 1.43],
      [3 * Math.cos(a), 3 * Math.sin(a), 4 - 1e-3],
    ];
    const { rim, probe, edge } = clipped(cuts);
    const outline = rimOutline(rim, 1, rimArcs(rim, probe));
    let worst = 0;
    for (let k = 0; k < 20011; k++) {
      const p = edge((2 * Math.PI * (k + 0.5)) / 20011);
      worst = Math.max(worst, Math.abs(outline.radiusAt(Math.atan2(p.py, p.px)) - Math.hypot(p.px, p.py)));
    }
    expect(worst).toBeGreaterThan(0.9e-3);
    expect(worst).toBeLessThan(1e-3);
  });
});
