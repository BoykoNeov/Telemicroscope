import { describe, it, expect } from "vitest";
import { vec3, normalize } from "../src/math/vec3";
import { makeConic, makePlane, makeEvenAsphere, conicSag } from "../src/geometry/surfaces";

describe("conic sag", () => {
  it("sphere sag matches exact circle formula", () => {
    const R = 100;
    const r = 30;
    // circle: z = R − √(R² − r²)
    const exact = R - Math.sqrt(R * R - r * r);
    expect(conicSag(1 / R, 0, r * r)).toBeCloseTo(exact, 12);
  });

  it("paraboloid sag is exactly r²/(2R)", () => {
    const R = -200; // concave mirror facing incoming light
    expect(conicSag(1 / R, -1, 20 * 20)).toBeCloseTo((20 * 20) / (2 * R), 12);
  });
});

describe("conic intersection", () => {
  it("axial ray hits sphere vertex", () => {
    const s = makeConic(1 / 50);
    const hit = s.intersect(vec3(0, 0, -10), vec3(0, 0, 1))!;
    expect(hit.t).toBeCloseTo(10, 12);
    expect(hit.point.z).toBeCloseTo(0, 12);
    expect(hit.normal.z).toBeCloseTo(-1, 12);
  });

  it("intersection point satisfies x²+y²+(z−R)² = R² for a sphere", () => {
    const R = 80;
    const s = makeConic(1 / R);
    const dir = normalize(vec3(0.05, 0.02, 1));
    const hit = s.intersect(vec3(3, -2, -25), dir)!;
    const p = hit.point;
    const lhs = p.x * p.x + p.y * p.y + (p.z - R) * (p.z - R);
    expect(lhs).toBeCloseTo(R * R, 9);
    // and lies on the vertex branch: |z| ≤ |R|
    expect(Math.abs(p.z)).toBeLessThan(Math.abs(R));
  });

  it("intersection point z equals sag(r²)", () => {
    const s = makeConic(-1 / 120, -0.7);
    const hit = s.intersect(vec3(8, 4, -30), normalize(vec3(-0.02, 0.01, 1)))!;
    const r2 = hit.point.x ** 2 + hit.point.y ** 2;
    expect(hit.point.z).toBeCloseTo(s.sag(r2), 10);
  });

  it("plane intersection", () => {
    const s = makePlane();
    const hit = s.intersect(vec3(1, 1, -5), vec3(0, 0, 1))!;
    expect(hit.t).toBeCloseTo(5, 12);
  });

  it("ray traveling −z hits a surface behind it in coordinates but ahead in travel", () => {
    // Mirror-return geometry: ray at z = 0 traveling −z, plane vertex at z = 0
    // is excluded (t≈0), but a plane at local z = −100 is reachable.
    const s = makePlane();
    const hit = s.intersect(vec3(0.5, 0, 100), vec3(0, 0, -1))!;
    expect(hit.t).toBeCloseTo(100, 12);
  });

  it("misses when the quadric is not reached", () => {
    const s = makeConic(1 / 10); // small steep sphere, R=10
    const hit = s.intersect(vec3(50, 0, -20), vec3(0, 0, 1));
    expect(hit).toBeNull(); // ray at height 50 misses an R=10 sphere entirely
  });
});

describe("even asphere", () => {
  it("with zero coefficients matches the base conic", () => {
    const conic = makeConic(1 / 60, -0.5);
    const asph = makeEvenAsphere(1 / 60, -0.5, [0, 0]);
    const dir = normalize(vec3(0.03, -0.01, 1));
    const h1 = conic.intersect(vec3(2, 1, -15), dir)!;
    const h2 = asph.intersect(vec3(2, 1, -15), dir)!;
    expect(h2.t).toBeCloseTo(h1.t, 9);
    expect(h2.normal.x).toBeCloseTo(h1.normal.x, 8);
  });

  it("intersection satisfies z = sag(r²) with nonzero coefficients", () => {
    const asph = makeEvenAsphere(1 / 60, 0, [1e-6, -1e-10]);
    const hit = asph.intersect(vec3(6, 3, -20), normalize(vec3(-0.01, 0.005, 1)))!;
    const r2 = hit.point.x ** 2 + hit.point.y ** 2;
    expect(hit.point.z).toBeCloseTo(asph.sag(r2), 10);
  });
});
