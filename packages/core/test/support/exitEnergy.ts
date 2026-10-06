import { OpticalSystem } from "../../src/trace/system";
import { traceRay } from "../../src/trace/sequential";
import { asCompiled } from "../../src/trace/compile";
import { toImageSpace } from "../../src/trace/axis";
import { aimRay, pupilGrid } from "../../src/pupil/aiming";
import { opdMap, exitApertureSine, exitCoordinate, exitRim } from "../../src/pupil/opd";
import { laidPupil, type PupilLayout } from "../../src/wave/psf";

/**
 * § 2l — a traced pupil's transmitted energy with no FFT grid in it.
 *
 * `psf().energy` is a sum over the pupil grid, and its edge cells count the
 * aperture's outline on a sub-sample lattice: an error of the lattice, not of
 * the light. This reads the same pupil function as an integral instead, by
 * changing variables onto the AIM disc, which is a circle at every field:
 *
 *     ∫ |P(e)|² dA_exit = ∫ |P(e(a))|²·|∂e/∂a| dA_aim
 *
 * with e(a) traced ray by ray and |∂e/∂a| centrally differenced. On the aim
 * layout e is the identity and this is ∫|P(a)|² dA_aim. The rule is Gauss–
 * Legendre in the radius and uniform in angle, its nodes strictly inside the
 * rim, so none sits ON the outline where a support's ≤ is a coin toss.
 *
 * Unvignetted systems only: it launches every node and does not ask the
 * vignette mask, which § 2l did not measure.
 *
 * `obstruction` (§ 2m) is the caller's ε, applied through the engine's own
 * pupil — so what is integrated is the mask `exitCoordinatePupil` builds, not
 * one written here. The rule is then split at ρ_aim = ε, the obstruction's
 * edge in the coordinate it is defined in, so no node sits on it either.
 */
export function exactPupilEnergy(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  layout: PupilLayout,
  rule: { readonly radial: number; readonly angular: number } = { radial: 24, angular: 128 },
  obstruction = 0,
): number {
  const c = asCompiled(system.prescription);
  const map = opdMap(system, fieldValue, wavelengthNm, pupilGrid(21));
  if (map.lost > 0) throw new Error("exactPupilEnergy: the map vignettes — not measured at § 2l");
  const pupil = laidPupil(system, map, { layout, ...(obstruction > 0 ? { obstruction } : {}) }).pupil;
  const sigma = layout === "exit" ? exitApertureSine(system, wavelengthNm) : 1;
  const at = (px: number, py: number): readonly [number, number] => {
    if (layout === "aim") return [px, py];
    const res = traceRay(c, aimRay(system, map.pupil, fieldValue, { px, py }, wavelengthNm, {}));
    if (res.status !== "ok" || !res.ray) throw new Error("exactPupilEnergy: a node did not trace");
    const e = exitCoordinate(map, toImageSpace(c, res.ray));
    if (e === null) throw new Error("exactPupilEnergy: a node missed the reference sphere");
    return [e[0] / sigma, e[1] / sigma];
  };
  const { x, w } = gaussLegendreUnit(rule.radial);
  const d = 1e-4;
  let sum = 0;
  for (const [r0, r1] of obstruction > 0 ? [[0, obstruction], [obstruction, 1]] : [[0, 1]]) {
    for (let i = 0; i < rule.radial; i++) {
      for (let k = 0; k < rule.angular; k++) {
        const r = r0! + (r1! - r0!) * x[i]!;
        const phi = (2 * Math.PI * (k + 0.5)) / rule.angular;
        const px = r * Math.cos(phi);
        const py = r * Math.sin(phi);
        const xp = at(px + d, py);
        const xm = at(px - d, py);
        const yp = at(px, py + d);
        const ym = at(px, py - d);
        const jac = Math.abs(((xp[0] - xm[0]) * (yp[1] - ym[1]) - (xp[1] - xm[1]) * (yp[0] - ym[0])) / (4 * d * d));
        const e = at(px, py);
        sum += pupil.amplitude(e[0], e[1]) ** 2 * jac * w[i]! * (r1! - r0!) * r * ((2 * Math.PI) / rule.angular);
      }
    }
  }
  return sum;
}

/**
 * The area inside the exit layout's outline — the 32 traced rim rays joined
 * linearly in angle, as `exitCoordinatePupil`'s support joins them — against
 * the same construction on `rays` aimed rim points, which is the traced image
 * of the aim circle to the interpolation's own error. One scheme on both sides,
 * so neither carries a polygon's bias the other does not.
 */
export function exitOutlineArea(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  rays?: number,
): number {
  const c = asCompiled(system.prescription);
  const map = opdMap(system, fieldValue, wavelengthNm, pupilGrid(21));
  const sigma = exitApertureSine(system, wavelengthNm);
  const rim =
    rays === undefined
      ? exitRim(system, map).map((p) => [p.px / sigma, p.py / sigma] as const)
      : Array.from({ length: rays }, (_, k) => {
          const a = (2 * Math.PI * k) / rays;
          const res = traceRay(c, aimRay(system, map.pupil, fieldValue, { px: Math.cos(a), py: Math.sin(a) }, wavelengthNm, {}));
          if (res.status !== "ok" || !res.ray) throw new Error("exitOutlineArea: a rim ray did not trace");
          const e = exitCoordinate(map, toImageSpace(c, res.ray));
          if (e === null) throw new Error("exitOutlineArea: a rim ray missed the reference sphere");
          return [e[0] / sigma, e[1] / sigma] as const;
        });
  const pts = rim.map(([x, y]) => ({ a: Math.atan2(y, x), r: Math.hypot(x, y) })).sort((u, v) => u.a - v.a);
  // ½∮ r(φ)² dφ, r linear in φ between rim angles: exact per segment.
  let area = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const q = pts[(k + 1) % pts.length]!;
    let span = q.a - p.a;
    if (span <= 0) span += 2 * Math.PI;
    area += (span * (p.r * p.r + p.r * q.r + q.r * q.r)) / 6;
  }
  return area;
}

/** Gauss–Legendre nodes and weights on [0, 1], by Newton on Pₙ. */
function gaussLegendreUnit(n: number): { x: number[]; w: number[] } {
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
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push((1 - z) / 2);
    w.push(1 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}
