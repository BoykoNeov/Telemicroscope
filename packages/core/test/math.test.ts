import { describe, it, expect } from "vitest";
import { vec3, dot, cross, normalize, length } from "../src/math/vec3";
import {
  rotationX, rotationY, translation, compose, invert,
  applyToPoint, applyToDirection, IDENTITY,
} from "../src/math/transform";

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
