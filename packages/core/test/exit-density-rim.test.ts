import { describe, it, expect } from "vitest";
import { finiteConjugateMicroscope, finiteConjugateObjective, infinityCorrectedMicroscope, tubeLens } from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import type { OpticalSystem } from "../src/trace/system";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { opdMap, exitApertureSine, canonicalApertureSine } from "../src/pupil/opd";
import { traceRay } from "../src/trace/sequential";
import { asCompiled, compile } from "../src/trace/compile";
import { exitDensity } from "../src/wave/exit-density";
import { laidPupil } from "../src/wave/psf";
import { exitCoordinate } from "../src/pupil/opd";
import { toImageSpace } from "../src/trace/axis";
import { LINE_D } from "../src/materials/dispersion";
import { emitterLaunchEnergy, exactPupilEnergy, exitDensityEnergy } from "./support/exitEnergy";

/**
 * § 2q.5 — the density's derivative slides inward where the continued chain ends.
 *
 * § 2q.4 left the exit layout's light "not concave in field before the clip":
 * on the DIN 4×/0.10, carried back onto the aim disc with no grid (§ 2l), it
 * wobbled by 1.3e-5 of itself between 0 and 2 mm of image radius. Split piece by
 * piece against the light read off the launches alone — p(θ)·T·|∂c/∂a|, which
 * owes nothing to the exit coordinate — the fit, the throughput and the clip
 * each carried under 2e-7; the lattice's node densities carried all of it, and
 * twelve rim nodes carried those, each 4.5e-4 dark. `exitDensity` traces two
 * rings past the stop through the chain with every rim removed, so a centred
 * stencil finds its ±2 neighbours. The rims go; the glass stays: a ray aimed
 * past 1.168 of the stop misses the first lens's back surface outright, the
 * ring at 1.2 is never traced, and those nodes fell back to second order.
 * Which nodes lost their ring changed with field — the wobble.
 *
 * **Hypothesis:** a derivative that slides its window inward, onto the seven
 * consecutive nodes nearest to centred that all exist, at sixth order, removes
 * the wobble at no extra trace. **Refuted by** the DIN's exit-layout light
 * departing from the launches' by more than 1e-7 anywhere from 0 to 2 mm, or a
 * node, rim included, departing from p·|∂c/∂e| by more than 5e-6.
 *
 * And the throughput rides in the density's fit (`ExitDensity.transmitted`):
 * the six-term fit § 2j inherited from the aim layout read the oil 100×'s light
 * 1.6e-4 high on axis and 5.5e-4 at 10 µm.
 *
 * External numbers: the change of variables ∫|P|²dA_exit = ∫p·T·|∂c/∂a|dA_aim
 * (`emitterLaunchEnergy`), which holds for any lens; the density's closed form
 * p·|∂c/∂e| at each node, differenced off fresh traces at 1e-5; and the oil's
 * light inside half its exit radius, read off the launches as a 1-D integral on
 * the axis — § 2j.3's question, whose two branches had agreed by cancelling.
 */

const L = 550;

const din = (): OpticalSystem =>
  finiteConjugateMicroscope({ objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }) })
    .system;
const oil = (): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0],
  }).system;

/** Gauss–Legendre on [0, 1]. */
function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 1;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const step = p1 / dp;
      z -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    x.push((1 - z) / 2);
    w.push(1 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}

/**
 * The fraction of an on-axis pupil's light inside half its exit radius, off the
 * launches alone. On the axis everything is a function of the aim radius r, so
 * per unit aim area an emitter carries p·T·|∂c/∂a| ∝ T·(dL/dr)(L/r)/cos θ and a
 * transmitted field's components cos θ·T·|∂e/∂a| ∝ cos θ·T·(de/dr)(e/r) (one per
 * exit cell, § 2n); the constants cancel in the fraction, and r* where |e| = ½
 * is bisected.
 */
function exactInsideHalf(system: OpticalSystem, source: "emitter" | "field"): number {
  const c = asCompiled(system.prescription);
  const map = opdMap(system, 0, LINE_D, pupilGrid(21));
  const sigma = exitApertureSine(system, LINE_D);
  const at = (r: number) => {
    const ray = aimRay(system, map.pupil, 0, { px: r, py: 0 }, LINE_D);
    const res = traceRay(c, ray);
    const e = exitCoordinate(map, toImageSpace(c, res.ray!))!;
    const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
    return { e: e[0] / sigma, l: ray.dir.x / len, cos: Math.abs(ray.dir.z) / len, t: res.throughput };
  };
  const d = 1e-6;
  const weight = (r: number) => {
    const p = at(r);
    const q = at(r + d);
    const m = at(r - d);
    if (source === "emitter") return (p.t * ((q.l - m.l) / (2 * d)) * (p.l / r)) / p.cos;
    return p.cos * p.t * ((q.e - m.e) / (2 * d)) * (p.e / r);
  };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid).e < 0.5) lo = mid;
    else hi = mid;
  }
  const { x, w } = gaussLegendre(64);
  const over = (a: number, b: number) => x.reduce((s, xi, i) => s + weight(a + (b - a) * xi) * (a + (b - a) * xi) * w[i]! * (b - a), 0);
  const inside = over(0, lo);
  return inside / (inside + over(lo, 1));
}

/** Object heights of the DIN at 0, 0.5, 1, 1.5 and 2 mm of image radius (|M| = 4). */
const DIN_HEIGHTS = [0, 0.125, 0.25, 0.375, 0.5];

/** The worst node, rim included, against p·|∂c/∂e| differenced at 1e-5 off fresh traces. */
function worstNode(system: OpticalSystem, h: number): number {
  const map = opdMap(system, h, L, pupilGrid(21));
  const sigma = exitApertureSine(system, L);
  const density = exitDensity(system, map, sigma);
  const n = Math.abs(map.pupil.entrance.n);
  const nu = canonicalApertureSine(system, L);
  const d = 1e-5;
  const at = (px: number, py: number) => {
    const r = aimRay(system, map.pupil, h, { px, py }, L).dir;
    const len = Math.hypot(r.x, r.y, r.z);
    const q = opdMap(system, h, L, [{ px, py }]).samples[0]!;
    return { l: r.x / len, m: r.y / len, dz: Math.abs(r.z) / len, ex: q.exitX / sigma, ey: q.exitY / sigma };
  };
  let worst = 0;
  for (const q of density.nodes) {
    const xp = at(q.px + d, q.py);
    const xm = at(q.px - d, q.py);
    const yp = at(q.px, q.py + d);
    const ym = at(q.px, q.py - d);
    const jc = (Math.abs((xp.l - xm.l) * (yp.m - ym.m) - (yp.l - ym.l) * (xp.m - xm.m)) / (4 * d * d)) * (n / nu) ** 2;
    const je = Math.abs((xp.ex - xm.ex) * (yp.ey - ym.ey) - (yp.ex - ym.ex) * (xp.ey - xm.ey)) / (4 * d * d);
    worst = Math.max(worst, Math.abs(q.density / ((1 / at(q.px, q.py).dz) * (jc / je)) - 1));
  }
  return worst;
}

describe("§ 2q.5 — the ring past the stop is not always there", () => {
  it("on the DIN 4× a ray aimed past 1.168 of the stop misses the first lens's back surface", () => {
    // The chain `exitDensity` traces its rings through: every rim removed, the
    // glass kept. Its outer ring sits at 1 + 2h = 1.2 on the 21-node lattice.
    const system = din();
    const c = asCompiled(system.prescription);
    const open = compile({ ...c.prescription, surfaces: c.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })) });
    const map = opdMap(system, 0, L, pupilGrid(21));
    const trace = (px: number) => traceRay(open, aimRay(system, map.pupil, 0, { px, py: 0 }, L));
    expect(trace(1.1).status).toBe("ok");
    expect(trace(1.16).status).toBe("ok");
    const past = trace(1.17);
    expect(past.status).toBe("miss");
    // Surface 2: the singlet's back, curvature −0.0467, and no rim to blame.
    expect(past.status === "miss" ? past.failedAt : -1).toBe(2);
    expect(trace(1.2).status).toBe("miss");
  });
});

describe("§ 2q.5 — every node, the rim's included, is p·|∂c/∂e|", () => {
  it("the DIN 4× on and off axis, to 3.5e-6 — where a centred stencil left the rim 4.5e-4 dark", () => {
    // 6.0e-7, 7.3e-7 and 3.5e-6 at 0, 1 and 2 mm of image radius. The same
    // check skipping the rim nodes read 1.0e-6 before (§ 2n.1) and never saw them.
    for (const h of [0, 0.25, 0.5]) expect(worstNode(din(), h)).toBeLessThan(5e-6);
  });

  it("the oil 100× on the axis, to 2.2e-4 — its cubic map read 1.66e-3 off at fourth order", () => {
    // The rest is the lattice's: 1.6e-5 at 61 nodes across (§ 2j.1's reading).
    expect(worstNode(oil(), 0)).toBeLessThan(2.5e-4);
  });
});

describe("§ 2q.5 — the exit layout's light is the launches' light", () => {
  it("the DIN 4×, 0–2 mm: the density and the laid pupil within 7e-8, where the wobble reached 1.9e-5", () => {
    // Density alone (no throughput): −6.09e-8, −5.84e-8, −5.59e-8, −2.93e-8,
    // −2.3e-9. With it, the laid pupil: −6.08e-8 … −2.1e-9 — the throughput adds
    // under 2.2e-10. Before § 2q.5 the laid pupil read −9.6e-6 on axis and
    // −5.6e-6 to −1.9e-5 across the field. The rule is resolved: 48×256 agrees
    // to every printed digit at 2 mm.
    const system = din();
    for (const h of DIN_HEIGHTS) {
      const bare = exitDensityEnergy(system, h, L) / emitterLaunchEnergy(system, h, L, { throughput: false }) - 1;
      const laid = exactPupilEnergy(system, h, L, "exit") / emitterLaunchEnergy(system, h, L, { throughput: true }) - 1;
      expect(Math.abs(bare)).toBeLessThan(7e-8);
      expect(Math.abs(laid)).toBeLessThan(7e-8);
      expect(Math.abs(laid - bare)).toBeLessThan(1e-9);
    }
  });

  it("the oil 100× on the axis: the throughput is carried to 1.4e-6, the lattice leaves 1.6e-4", () => {
    // The density alone reads −1.581e-4 (−1.208e-3 at fourth order) and the laid
    // pupil −1.595e-4: what the throughput adds is −1.4e-6, where the six-term fit
    // read +1.66e-4. The −1.6e-4 is the lattice's on this map (1.6e-5 at 61 across).
    const system = oil();
    const bare = exitDensityEnergy(system, 0, L) / emitterLaunchEnergy(system, 0, L, { throughput: false }) - 1;
    const laid = exactPupilEnergy(system, 0, L, "exit") / emitterLaunchEnergy(system, 0, L, { throughput: true }) - 1;
    expect(bare).toBeCloseTo(-1.581e-4, 6);
    expect(laid).toBeCloseTo(-1.595e-4, 6);
    expect(Math.abs(laid - bare)).toBeLessThan(2e-6);
  });
});

describe("§ 2q.5 — § 2j.3's two branches agreed by cancelling", () => {
  it.each([
    ["emitter", 0.20521, 3e-5],
    ["field", 0.29867, 1e-4],
  ] as const)("%s on the oil 100×: the transform's light inside half the exit radius is the launches'", (source, exact, bound) => {
    // Off the launches 0.205210 and 0.298668. The transform's pupil reads 0.205224
    // and 0.298726 — where it read 0.206654 and 0.300526 before § 2q.5, 1.4e-3 and
    // 1.9e-3 high. § 2j.3's ray histogram reads 0.20625 for the emitter: 1.0e-3
    // high, which is why the two once agreed to 4e-4.
    const system = oil();
    expect(exactInsideHalf(system, source)).toBeCloseTo(exact, 5);
    const laid = laidPupil(system, opdMap(system, 0, LINE_D, pupilGrid(21)), { layout: "exit", source }).pupil;
    let inside = 0;
    let total = 0;
    const N = 801;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -1 + (2 * (i + 0.5)) / N;
        const y = -1 + (2 * (j + 0.5)) / N;
        const a = laid.amplitude(x, y);
        total += a * a;
        if (x * x + y * y <= 0.25) inside += a * a;
      }
    }
    expect(Math.abs(inside / total - exact)).toBeLessThan(bound);
  });
});
