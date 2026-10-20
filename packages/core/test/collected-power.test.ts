import { describe, it, expect } from "vitest";
import { collectedPower, gaussLegendre } from "./support/collected-power";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { traceRay } from "../src/trace/sequential";
import { asCompiled } from "../src/trace/compile";
import { makeRay } from "../src/trace/ray";
import { vec3, normalize } from "../src/math/vec3";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 2z.2 — the referee: an emitter's collected power, counted in object-space
 * directions.
 *
 * Register item 31 measured the exit layout's light against a direction-cosine
 * lattice (§ 2p), stable to 5e-4 — too coarse to judge a restatement by. The
 * referee locates the edge along each bearing instead (`support/collected-power`)
 * and owes nothing to a pupil coordinate or to aiming, so it can rule on both
 * aims. Pinned here to the closed forms of a bare aperture, and to a lattice
 * count where the aperture is cut.
 */

const D = 20;
const A = 4;

/** One flat aperture of radius A, D in front of the object point, in air. */
const BARE: OpticalSystem = {
  prescription: {
    surfaces: [{ kind: "refract", curvature: 0, semiAperture: A, thickness: 10, medium: "AIR", isStop: true }],
  },
  aperture: { kind: "stopRadius", value: A },
  field: { kind: "objectHeight", values: [0] },
  wavelengths: [{ nm: 550, weight: 1 }],
  conjugate: { kind: "finite", distance: D },
};

/** The disc's solid angle from height h, integrated over the disc itself. */
function discSolidAngle(h: number): number {
  const [nodes, weights] = gaussLegendre(40);
  const PSI = 512;
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    // Gauss in s², where the area element is uniform and the integrand smooth;
    // the trapezoid in ψ, which is spectral on a periodic integrand
    const s = A * Math.sqrt((nodes[i]! + 1) / 2);
    let ring = 0;
    for (let k = 0; k < PSI; k++) {
      const psi = (2 * Math.PI * k) / PSI;
      const dx = s * Math.cos(psi) - h;
      const dy = s * Math.sin(psi);
      ring += D / (D * D + dx * dx + dy * dy) ** 1.5;
    }
    total += (weights[i]! / 2) * (ring / PSI);
  }
  return total * Math.PI * A * A;
}

describe("§ 2z.2 — the referee, against closed forms", () => {
  // Both to 1.5e-12, not the last bit: the trace clips at radius² × (1 + 1e-12), so
  // the edge it reports sits 5e-13 of a radius out — 9.5e-13 of the light, read.
  it("on the axis of a bare aperture it is (1 − cos u)/2", () => {
    const exact = (1 - D / Math.hypot(D, A)) / 2;
    expect(Math.abs(collectedPower(BARE, 0, 550) / exact - 1)).toBeLessThan(1.5e-12);
  });

  it("off the axis it is the disc's solid angle over 4π", () => {
    for (const h of [1, 3, 6]) {
      const exact = discSolidAngle(h) / (4 * Math.PI);
      expect(Math.abs(collectedPower(BARE, h, 550) / exact - 1), `${h}`).toBeLessThan(1.5e-12);
    }
  });

  it("where a lens cuts the aperture it meets a lattice count", () => {
    // The un-field-sized DIN 4×/0.10 at 4.5 mm: § 6bc.4's hard clip, where the
    // domain is the stop's disc cut by the lens's rims — the case the
    // star-shaped assumption is exposed in.
    const sys = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
    }).system;
    const nm = sys.wavelengths[0]!.nm;
    const h = 4.5;
    const referee = collectedPower(sys, h, nm, { azimuths: 2048 });
    const c = asCompiled(sys.prescription);
    if (sys.conjugate.kind !== "finite") throw new Error("the DIN preset is finite-conjugate");
    const o = vec3(h, 0, -sys.conjugate.distance);
    const N = 601;
    const span = 0.13;
    const step = (2 * span) / (N - 1);
    let lattice = 0;
    for (let i = 0; i < N; i++) {
      const L = -span + i * step;
      for (let j = 0; j < N; j++) {
        const M = -span + j * step;
        const n = Math.sqrt(1 - L * L - M * M);
        const res = traceRay(c, makeRay(o, normalize(vec3(L, M, n)), nm));
        if (res.status === "ok") lattice += res.throughput / n;
      }
    }
    lattice *= (step * step) / (4 * Math.PI);
    // 1.1e-5 read, the lattice's own edge count; a bearing with two edges would
    // drop a piece of the domain and read as a deficit of its size.
    expect(Math.abs(referee / lattice - 1)).toBeLessThan(5e-5);
  });
});
