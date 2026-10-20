import { describe, it, expect } from "vitest";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { exitApertureSine, exitCoordinate, exitRim, exitRimArcs, opdMap } from "../src/pupil/opd";
import { STOP_EDGE, rimOutline, rimPolygon, type RimOutline } from "../src/pupil/rim-outline";
import { aimRay, UnreachableStopPoint } from "../src/pupil/aiming";
import { traceRay } from "../src/trace/sequential";
import { asCompiled, compile } from "../src/trace/compile";
import { toImageSpace } from "../src/trace/axis";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 2y — register item 43: where what makes the edge changes around the rim,
 * the outline is arcs between located corners.
 *
 * **Hypothesis** (committed at e6e40f1, before the reading): with each corner
 * bisected in aim angle and each arc the polynomial through its landings at
 * Chebyshev nodes, the outline is the traced rim, and a rim cut all round by one
 * constraint takes § 2v's curve. **Refuted by** an area between outline and
 * traced rim above 1e-11 of π on the DIN 4×/0.10 at 0.8 or 1.1 mm or the DIN
 * 10×/0.20 at 0.2, 0.5 or 1.0 mm. Read at 2048 exit angles: 1.5e-15, 1.3e-15,
 * 1.4e-12 (the curve, no corner), 9.6e-16 and 1.6e-15, where the polygon read
 * 5.2e-5, 6.8e-4, 1.3e-6, 4.1e-4 and 1.3e-3. The rungs below re-read the two
 * cases with the most corners and the one with none at 256 angles.
 */
const L = 587.5618;
const din = (magnification: number, numericalAperture: number): OpticalSystem =>
  finiteConjugateMicroscope({ objective: finiteConjugateObjective({ magnification, numericalAperture }) }).system;

/**
 * The area between an outline and the traced rim, over π. The traced rim at
 * exit angle φ is the edge ray landing there — its aim angle bisected, and its
 * reach bisected to the last bit through the chain with only the stop's rim
 * kept — so no outline enters it.
 */
function misplaced(system: OpticalSystem, h: number, angles: number): { polygon: number; outline: number; scheme: string } {
  const c = asCompiled(system.prescription);
  const map = opdMap(system, h, L, []);
  const sigma = exitApertureSine(system, L);
  const stopOnly = compile({
    ...c.prescription,
    surfaces: c.prescription.surfaces.map((s, i) => (i === map.pupil.stopIndex ? s : { ...s, semiAperture: Infinity })),
  });
  const lands = (rho: number, t: number): readonly [number, number] | null => {
    let ray;
    try {
      ray = aimRay(system, map.pupil, h, { px: rho * Math.cos(t), py: rho * Math.sin(t) }, L);
    } catch (e) {
      // Under real aiming a stop point past a knife edge has no ray (§ 2z.4).
      if (e instanceof UnreachableStopPoint) return null;
      throw e;
    }
    const res = traceRay(stopOnly, ray);
    return res.status === "ok" && res.ray ? exitCoordinate(map, toImageSpace(stopOnly, res.ray)) : null;
  };
  const edgeAt = (t: number): readonly [number, number] => {
    const one = lands(1, t);
    if (one !== null) return one;
    let lo = 0;
    let hi = 1;
    let best = lands(0, t)!;
    for (;;) {
      const mid = 0.5 * (lo + hi);
      if (mid === lo || mid === hi) return best;
      const d = lands(mid, t);
      if (d === null) hi = mid;
      else {
        lo = mid;
        best = d;
      }
    }
  };
  const rim = exitRim(system, map);
  const outlines: RimOutline[] = [rimPolygon(rim, sigma), rimOutline(rim, sigma, exitRimArcs(system, map, rim))];
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const angleOf = (e: readonly [number, number]) => Math.atan2(e[1] / sigma, e[0] / sigma);
  const rimAngles = rim.map((p) => angleOf([p.px, p.py]));
  const dir = wrap(rimAngles[1]! - rimAngles[0]!) > 0 ? 1 : -1;
  const sums = [0, 0];
  for (let k = 0; k < angles; k++) {
    const phi = -Math.PI + (2 * Math.PI * (k + 0.5)) / angles;
    let near = 0;
    for (let j = 1; j < rim.length; j++) {
      if (Math.abs(wrap(rimAngles[j]! - phi)) < Math.abs(wrap(rimAngles[near]! - phi))) near = j;
    }
    let lo = (2 * Math.PI * near) / rim.length - 0.3;
    let hi = lo + 0.6;
    for (;;) {
      const m = 0.5 * (lo + hi);
      if (m === lo || m === hi) break;
      if (wrap(angleOf(edgeAt(m)) - phi) * dir < 0) lo = m;
      else hi = m;
    }
    const e = edgeAt(0.5 * (lo + hi));
    const rt = Math.hypot(e[0], e[1]) / Math.abs(sigma);
    outlines.forEach((o, i) => {
      const ro = o.radiusAt(phi);
      sums[i] = sums[i]! + Math.abs(ro * ro - rt * rt) / 2;
    });
  }
  const scale = 2 / angles;
  return { polygon: sums[0]! * scale, outline: sums[1]! * scale, scheme: outlines[1]!.scheme };
}

describe("§ 2y — the outline turns at the rim's corners", () => {
  it.each([
    ["DIN 4×/0.10 at 1.1 mm: the stop's rim and a miss on surface 2", 4, 0.1, 1.1, "arcs", 6.8e-4],
    ["DIN 10×/0.20 at 1.0 mm: four corners, two cuts and the stop", 10, 0.2, 1.0, "arcs", 1.3e-3],
    ["DIN 10×/0.20 at 0.2 mm: vignetted by the stop all round, no corner", 10, 0.2, 0.2, "curve", 1.3e-6],
  ] as const)("%s — the outline is the traced rim", (_, m, na, h, scheme, polygon) => {
    const read = misplaced(din(m, na), h, 256);
    expect(read.scheme).toBe(scheme);
    expect(read.outline).toBeLessThan(1e-11);
    expect(read.polygon / polygon).toBeGreaterThan(0.5);
  });

  it("every edge ray reports what made its edge", () => {
    // The DIN 10×/0.20 at 1.0 mm: from ray 0, miss@2 ×7, the stop's own ×19,
    // miss@2 ×6 — the crown's knife edge on either side and the diaphragm between.
    // On the diaphragm as built (§ 2z.5, 1.4% wider than `f·tan u`); on the
    // paraxially sized one the stop's arc read vignetted@3 ×5, its own ×9,
    // vignetted@3 ×5, surface 3 being the diaphragm itself.
    const system = din(10, 0.2);
    const runs: string[] = [];
    for (const p of exitRim(system, opdMap(system, 1.0, L, []))) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.startsWith(`${p.edge}×`)) runs[runs.length - 1] = `${p.edge}×${Number(last.split("×")[1]) + 1}`;
      else runs.push(`${p.edge}×1`);
    }
    expect(runs).toEqual(["miss@2×7", `${STOP_EDGE}×19`, "miss@2×6"]);
  });
});

