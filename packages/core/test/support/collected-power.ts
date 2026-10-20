import { vec3, normalize } from "../../src/math/vec3";
import { makeRay } from "../../src/trace/ray";
import { traceRay } from "../../src/trace/sequential";
import { compile } from "../../src/trace/compile";
import { objectPoint, aimRay } from "../../src/pupil/aiming";
import { pupils } from "../../src/pupil/pupils";
import type { OpticalSystem } from "../../src/trace/system";

/**
 * The power an isotropic point source sends through a finite-conjugate system,
 * as a fraction of all it emits — counted in OBJECT-SPACE DIRECTIONS, with no
 * pupil coordinate and no aiming anywhere in it (§ 2z.2).
 *
 *     P = (1/4π) ∫ T(L, M) dL dM / N
 *
 * over the direction cosines (L, M) whose ray from the object point gets through
 * every aperture, T its traced throughput and N = √(1 − L² − M²), so dL·dM/N is
 * the solid angle. The domain is read in polar coordinates about one direction
 * inside it: along each of `azimuths` bearings the edge of the passing rays is
 * bisected to the last bits, the radial integral is Gauss–Legendre on
 * `radialNodes` nodes (T/N is smooth inside), and the azimuthal one is the
 * trapezoid rule, which is spectral on a smooth periodic edge and second order
 * where the edge has corners.
 *
 * It assumes the passing set is star-shaped about that direction: one edge per
 * bearing. § 2z.2 checks that against a plain lattice count.
 *
 * Register item 31's "brute-force count" (§ 2p) was a direction-cosine lattice
 * with the same integrand, stable to 5e-4; this is the same quantity with the
 * edge located instead of counted.
 */
export function collectedPower(
  system: OpticalSystem,
  objectHeightMm: number,
  wavelengthNm: number,
  options: { readonly azimuths?: number; readonly radialNodes?: number } = {},
): number {
  const K = options.azimuths ?? 720;
  const [nodes, weights] = gaussLegendre(options.radialNodes ?? 16);
  const paraxial: OpticalSystem = { ...system, rayAiming: "paraxial" };
  const pupil = pupils(paraxial, wavelengthNm);
  // The stop is the system's aperture, which can be smaller than the stop
  // surface's own glass rim (the Lister's: 0.630 mm in a 0.800 mm rim) — clip
  // there, as the aperture spec says, and every other surface at its rim.
  const c = compile({
    ...system.prescription,
    surfaces: system.prescription.surfaces.map((s, i) =>
      i === pupil.stopIndex ? { ...s, semiAperture: Math.min(s.semiAperture, pupil.stopRadius) } : s,
    ),
  });
  const o = objectPoint(system, objectHeightMm);
  // The centre of the polar grid: any direction inside the domain serves; the
  // paraxial chief ray is one, and nothing but the grid's origin depends on it.
  const chief = aimRay(paraxial, pupil, objectHeightMm, { px: 0, py: 0 }, wavelengthNm).dir;
  const cl = Math.hypot(chief.x, chief.y, chief.z);
  const L0 = chief.x / cl;
  const M0 = chief.y / cl;

  const throughput = (L: number, M: number): number | null => {
    const n2 = 1 - L * L - M * M;
    if (!(n2 > 0)) return null;
    const res = traceRay(c, makeRay(o, normalize(vec3(L, M, Math.sqrt(n2))), wavelengthNm));
    return res.status === "ok" ? res.throughput : null;
  };
  if (throughput(L0, M0) === null) throw new Error("collectedPower: the centre direction does not pass");

  let total = 0;
  for (let a = 0; a < K; a++) {
    const phi = (2 * Math.PI * a) / K;
    const cx = Math.cos(phi);
    const cy = Math.sin(phi);
    const passes = (r: number) => throughput(L0 + r * cx, M0 + r * cy) !== null;
    let lo = 0;
    let hi = 1e-3;
    while (passes(hi)) {
      lo = hi;
      hi *= 2;
      if (hi > 2) throw new Error("collectedPower: no edge along a bearing");
    }
    for (let i = 0; i < 60 && hi - lo > 1e-16; i++) {
      const mid = (lo + hi) / 2;
      if (passes(mid)) lo = mid;
      else hi = mid;
    }
    const edge = lo;
    let radial = 0;
    for (let k = 0; k < nodes.length; k++) {
      const r = (edge * (nodes[k]! + 1)) / 2;
      const L = L0 + r * cx;
      const M = M0 + r * cy;
      const t = throughput(L, M);
      if (t === null) throw new Error("collectedPower: the passing set is not star-shaped about its centre");
      radial += weights[k]! * (t / Math.sqrt(1 - L * L - M * M)) * r;
    }
    total += (radial * edge) / 2;
  }
  return (total * (2 * Math.PI)) / K / (4 * Math.PI);
}

/** Gauss–Legendre nodes and weights on [−1, 1], by Newton on Pₙ. */
export function gaussLegendre(n: number): [number[], number[]] {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  return [x, w];
}
