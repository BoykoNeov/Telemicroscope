import { describe, it, expect } from "vitest";
import { vec3, normalize, dot } from "../src/math/vec3";
import { interact, reflectDir } from "../src/trace/interaction";

describe("refraction (vector Snell)", () => {
  it("matches scalar Snell's law at 30° into n=1.5", () => {
    const thetaI = (30 * Math.PI) / 180;
    const d = normalize(vec3(Math.sin(thetaI), 0, Math.cos(thetaI)));
    const res = interact(d, vec3(0, 0, -1), 1.0, 1.5);
    expect(res.tir).toBe(false);
    const sinT = Math.abs(res.refracted!.x);
    expect(sinT).toBeCloseTo(Math.sin(thetaI) / 1.5, 12);
    expect(res.refracted!.z).toBeGreaterThan(0); // continues forward
  });

  it("normal orientation does not matter", () => {
    const d = normalize(vec3(0.3, 0.1, 1));
    const a = interact(d, vec3(0, 0, -1), 1.0, 1.5);
    const b = interact(d, vec3(0, 0, 1), 1.0, 1.5);
    expect(a.refracted!.x).toBeCloseTo(b.refracted!.x, 14);
    expect(a.R).toBeCloseTo(b.R, 14);
  });

  it("refracted direction stays unit length", () => {
    const d = normalize(vec3(0.4, -0.2, 1));
    const res = interact(d, vec3(0, 0, -1), 1.0, 1.7);
    expect(dot(res.refracted!, res.refracted!)).toBeCloseTo(1, 12);
  });
});

describe("total internal reflection", () => {
  it("occurs beyond the critical angle glass→air", () => {
    const critical = Math.asin(1 / 1.5);
    const dOver = normalize(vec3(Math.sin(critical + 0.01), 0, Math.cos(critical + 0.01)));
    const over = interact(dOver, vec3(0, 0, -1), 1.5, 1.0);
    expect(over.tir).toBe(true);
    expect(over.R).toBe(1);

    const dUnder = normalize(vec3(Math.sin(critical - 0.01), 0, Math.cos(critical - 0.01)));
    expect(interact(dUnder, vec3(0, 0, -1), 1.5, 1.0).tir).toBe(false);
  });
});

describe("Fresnel energy split (the future-ghost commitment)", () => {
  it("normal incidence: R = ((n1−n2)/(n1+n2))², air→BK7 ≈ 4%", () => {
    const res = interact(vec3(0, 0, 1), vec3(0, 0, -1), 1.0, 1.5168);
    const expected = ((1 - 1.5168) / (1 + 1.5168)) ** 2;
    expect(res.R).toBeCloseTo(expected, 12);
    expect(res.R).toBeCloseTo(0.0421, 3);
    expect(res.R + res.T).toBeCloseTo(1, 15);
  });

  it("Brewster's angle: p-reflectance vanishes, so unpolarized R = Rs/2", () => {
    const n2 = 1.5;
    const brewster = Math.atan(n2);
    const d = normalize(vec3(Math.sin(brewster), 0, Math.cos(brewster)));
    const res = interact(d, vec3(0, 0, -1), 1.0, n2);
    // At Brewster: rp = 0 exactly; R = rs²/2
    const cosI = Math.cos(brewster);
    const cosT = Math.sqrt(1 - (Math.sin(brewster) / n2) ** 2);
    const rs = (cosI - n2 * cosT) / (cosI + n2 * cosT);
    expect(res.R).toBeCloseTo((rs * rs) / 2, 12);
  });

  it("reflected ray always exists (secondary for the sequential engine)", () => {
    const d = normalize(vec3(0.2, 0, 1));
    const res = interact(d, vec3(0, 0, -1), 1.0, 1.5);
    expect(res.reflected.z).toBeLessThan(0); // bounced back
    expect(dot(res.reflected, res.reflected)).toBeCloseTo(1, 12);
  });
});

describe("reflection", () => {
  it("mirror law: angle in = angle out, in plane", () => {
    const d = normalize(vec3(0.3, 0, 1));
    const r = reflectDir(d, vec3(0, 0, -1));
    expect(r.x).toBeCloseTo(d.x, 14);
    expect(r.z).toBeCloseTo(-d.z, 14);
  });
});
