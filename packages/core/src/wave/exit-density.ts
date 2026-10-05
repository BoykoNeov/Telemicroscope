import { Vec3, length } from "../math/vec3";
import { Ray } from "../trace/ray";
import { traceRay } from "../trace/sequential";
import { CompiledSystem, asCompiled, compile } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { AimOptions, aimRay, pupilGrid } from "../pupil/aiming";
import { OpdMap, exitCoordinate } from "../pupil/opd";
import { fitZernike, wavefrontSampler, MAX_ZERNIKE_TERMS } from "./zernike";

/**
 * What fills a FINITE-conjugate system's entrance pupil — § 2j.
 *
 * At an infinite conjugate there is one answer, a plane wave filling the
 * entrance pupil, and this is not asked. At a finite one the light leaving the
 * object depends on the object, and the two that the engine images differ in
 * the sign of their tilt:
 *
 * - `"emitter"` — a point radiating equal power per solid angle: a fluorophore,
 *   and every point-spread function. Its angular spectrum is 1/cos θ (Weyl's
 *   expansion of a spherical wave), so per unit of object-space direction-cosine
 *   area it carries 1/cos θ, and an aplanat hands it to the exit pupil as
 *   irradiance ∝ 1/cos θ — register item 23's closed form.
 * - `"field"` — a thin object's transmitted field, one plane-wave component per
 *   spatial frequency: the brightfield chain. A component of uniform amplitude
 *   carries power |A|²·cos θ through the object plane, so per direction-cosine
 *   area it carries cos θ, and an aplanat hands it on as cos θ.
 *
 * θ is the ray's angle to the axis in the object's own medium. At the oil
 * 100×/1.25's rim the two are 1.75 and 0.57 of the centre's: a factor of three
 * apart in |P|², which is why the caller says which it means.
 */
export type PupilSource = "emitter" | "field";

/** The density lattice's resolution across the pupil diameter. Odd, so the chief ray is a node. */
export const DENSITY_GRID = 21;

/** Rings of nodes past the stop's rim, so every in-disc node has both its ±2 neighbours. */
const RINGS = 2;

/**
 * The exit pupil's irradiance, traced: power per unit exit-coordinate area
 * (§ 2j), in the aim layout's units.
 *
 * Energy is carried by ray tubes. A ray aimed at `a` carries the source power
 * of its aim cell, S(a)·dA_aim, and delivers it to the exit-pupil cell
 * dA_exit = |∂e/∂a|·dA_aim it lands in, so the irradiance there is
 *
 *     |P(e)|² = S(a) / |∂e/∂a|
 *
 * — the Jacobian of the map § 2i lays samples out by, and the source's own
 * term. That is the textbook apodization of every closed case. On the reference
 * sphere a paraboloid focusing a plane wave gives Richards and Wolf's amplitude
 * 2/(1 + cos θ′) and an aplanat √cos θ′; projected onto the exit coordinate,
 * |P|² = |a|²/cos θ′, so the paraboloid's is 1/(cos⁴(θ′/2)·cos θ′) and the
 * aplanat's is uniform — and an emitter through an aplanat is 1/cos θ, θ in the
 * object. The transform's pupil is |P| (Parseval: Σ|P|² is the light through).
 *
 * The source term per unit AIM area is S = (source per direction-cosine area) ×
 * (direction-cosine area per aim area). For the paraxial aim at a finite
 * conjugate the aim is a target on the entrance-pupil plane (or, telecentric, a
 * slope), so dΩ = |d_z|³·dA_aim up to a constant, and the direction-cosine area
 * is |d_z|·dΩ:
 *
 *     emitter  S = (1/|d_z|)·|d_z|·|d_z|³ = |d_z|³
 *     field    S =  |d_z|  ·|d_z|·|d_z|³ = |d_z|⁵
 *
 * with d the launch's unit direction. Under real aiming the aim names a point on
 * the STOP, and the entrance-pupil target it solved to is not linear in it: S
 * then carries |∂q/∂a| as well, read off the solved targets. At an infinite
 * conjugate S is that Jacobian alone — uniform under the paraxial aim.
 *
 * ## How the Jacobian is read
 *
 * On a lattice of `DENSITY_GRID` across the diameter, traced through the chain
 * with EVERY rim removed — the map's analytic continuation, so a vignetting
 * aperture cannot change the density, and a clipped system and its open twin
 * share one — out to `RINGS` nodes past the stop's rim, so every in-disc node
 * has its ±1 and ±2 neighbours. Central differences at h and 2h, Richardson-
 * combined to fourth order: at second order alone the oil objective's
 * cubic map reads its area 2% wrong at the centre (§ 2j.1 measures the rest).
 * Where the map is already traced on this lattice and lost nothing, the in-disc
 * nodes are its own samples and only the rings are new traces.
 *
 * √(|P|²) is then fitted over the nodes' exit coordinates — the transform asks
 * for it at grid points, not at nodes.
 *
 * ## The units
 *
 * S is divided by the chief ray's S, and nothing else: J is left in exit
 * coordinate per aim coordinate. Then Σ|P|² over the pupil is ∫S/S₀·dA_aim —
 * for a plane wave the aim disc's area, π, which is the energy the aim layout
 * has always reported. So no energy moves between the layouts on a telescope.
 * Normalizing at the chief ray instead would carry the chief's own local
 * magnification into every reading, and the uniform layout § 2i shipped carried
 * the exit support's area — the off-axis foreshortening register item 24
 * measured as 2.1e-3 on `extended`'s achromat from 0° to 2°, 2.4e-4 in these
 * units, where the aim layout reads 7.7e-7.
 */
export interface ExitDensity {
  /** √(|P|²) at a normalized exit coordinate — the transform's amplitude factor. */
  readonly amplitude: (ex: number, ey: number) => number;
  /**
   * Source power per unit aim area for a ray aimed at (px, py) and launched along
   * `dir`, normalized at the chief ray — what a ray histogram weights each ray by,
   * because the exit cell it lands in is where it lands and needs no Jacobian.
   */
  readonly sourceWeight: (px: number, py: number, dir: Vec3) => number;
  /** The in-disc lattice nodes, for the rungs: aim, normalized exit coordinate, |P|². */
  readonly nodes: readonly {
    readonly px: number;
    readonly py: number;
    readonly ex: number;
    readonly ey: number;
    readonly density: number;
  }[];
}

const OPEN = new WeakMap<CompiledSystem, CompiledSystem>();

/** The chain with every rim removed, the stop's too — the map's continuation past it. */
function open(c: CompiledSystem): CompiledSystem {
  let u = OPEN.get(c);
  if (!u) {
    u = compile({
      ...c.prescription,
      surfaces: c.prescription.surfaces.map((s) => ({ ...s, semiAperture: Infinity })),
    });
    OPEN.set(c, u);
  }
  return u;
}

/** Fourth-order central derivative along one lattice axis, falling back as neighbours run out. */
function derivative(
  at: (k: number) => readonly [number, number] | null,
  h: number,
): readonly [number, number] | null {
  const p1 = at(1);
  const m1 = at(-1);
  const p2 = at(2);
  const m2 = at(-2);
  const c0 = at(0);
  if (p1 && m1) {
    const d1x = (p1[0] - m1[0]) / (2 * h);
    const d1y = (p1[1] - m1[1]) / (2 * h);
    if (p2 && m2) {
      const d2x = (p2[0] - m2[0]) / (4 * h);
      const d2y = (p2[1] - m2[1]) / (4 * h);
      return [(4 * d1x - d2x) / 3, (4 * d1y - d2y) / 3];
    }
    return [d1x, d1y];
  }
  if (!c0) return null;
  // One-sided, second order where two neighbours on one side exist.
  for (const s of [1, -1]) {
    const a1 = at(s);
    const a2 = at(2 * s);
    if (a1 && a2) {
      return [
        (s * (-3 * c0[0] + 4 * a1[0] - a2[0])) / (2 * h),
        (s * (-3 * c0[1] + 4 * a1[1] - a2[1])) / (2 * h),
      ];
    }
    if (a1) return [(s * (a1[0] - c0[0])) / h, (s * (a1[1] - c0[1])) / h];
  }
  return null;
}

export function exitDensity(
  system: OpticalSystem,
  map: OpdMap,
  apertureSine: number,
  options: { readonly source?: PupilSource; readonly aim?: AimOptions } = {},
): ExitDensity {
  const aim = options.aim ?? {};
  const source = options.source ?? "emitter";
  const c = asCompiled(system.prescription);
  const chain = open(c);
  const pupil = map.pupil;
  const finite = system.conjugate.kind === "finite";
  const real = system.rayAiming === "real";
  const epZ = pupil.entrance.z;

  const n = DENSITY_GRID;
  const h = 2 / (n - 1);
  const half = (n - 1) / 2;
  const span = half + RINGS;
  const side = 2 * span + 1;
  // A stencil node is within 2h of an in-disc one along an axis, so within 1 + 2h.
  const reach = 1 + RINGS * h + 1e-9;
  const idx = (i: number, j: number) => (i + span) * side + (j + span);

  // The map's own traces, where it is this lattice and lost nothing.
  const own = new Map<number, readonly [number, number]>();
  if (map.lost === 0) {
    const grid = pupilGrid(n);
    if (
      grid.length === map.samples.length &&
      grid.every((g, k) => g.px === map.samples[k]!.px && g.py === map.samples[k]!.py)
    ) {
      for (const s of map.samples) {
        own.set(idx(Math.round(s.px / h), Math.round(s.py / h)), [s.exitX / apertureSine, s.exitY / apertureSine]);
      }
    }
  }

  const exitAt: (readonly [number, number] | null)[] = new Array(side * side).fill(null);
  const targetAt: (readonly [number, number] | null)[] = new Array(side * side).fill(null);
  const dirZ = new Float64Array(side * side).fill(NaN);
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const px = i * h;
      const py = j * h;
      if (Math.hypot(px, py) > reach) continue;
      const k = idx(i, j);
      let ray: Ray;
      try {
        ray = aimRay(system, pupil, map.fieldValue, { px, py }, map.wavelengthNm, aim);
      } catch {
        continue;
      }
      dirZ[k] = Math.abs(ray.dir.z) / length(ray.dir);
      if (real) {
        const t = (epZ - ray.origin.z) / ray.dir.z;
        targetAt[k] = [ray.origin.x + ray.dir.x * t, ray.origin.y + ray.dir.y * t];
      }
      const mine = own.get(k);
      if (mine) {
        exitAt[k] = mine;
        continue;
      }
      const res = traceRay(chain, ray);
      if (res.status !== "ok" || !res.ray) continue;
      const e = exitCoordinate(map, toImageSpace(c, res.ray));
      if (e !== null) exitAt[k] = [e[0] / apertureSine, e[1] / apertureSine];
    }
  }

  const inside = (i: number, j: number) => Math.abs(i) <= span && Math.abs(j) <= span;
  const along = (
    values: readonly (readonly [number, number] | null)[],
    i: number,
    j: number,
    di: number,
    dj: number,
  ) => (s: number) => (inside(i + s * di, j + s * dj) ? values[idx(i + s * di, j + s * dj)]! : null);
  const area = (values: readonly (readonly [number, number] | null)[], i: number, j: number): number | null => {
    const u = derivative(along(values, i, j, 1, 0), h);
    const v = derivative(along(values, i, j, 0, 1), h);
    return u && v ? Math.abs(u[0] * v[1] - u[1] * v[0]) : null;
  };

  /** Source power per aim area at a node, unnormalized. */
  const cosPower = finite ? (source === "emitter" ? 3 : 5) : 0;
  const sourceAt = (i: number, j: number): number | null => {
    const dz = dirZ[idx(i, j)]!;
    if (Number.isNaN(dz)) return null;
    let s = dz ** cosPower;
    if (real) {
      const jq = area(targetAt, i, j);
      if (jq === null) return null;
      s *= jq;
    }
    return s;
  };

  const chief = sourceAt(0, 0);
  if (chief === null || !(chief > 0)) {
    throw new Error(`exit density: the chief ray at field ${map.fieldValue} could not be launched`);
  }
  const nodes: { px: number; py: number; ex: number; ey: number; density: number }[] = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const px = i * h;
      const py = j * h;
      if (px * px + py * py > 1 + 1e-12) continue;
      const e = exitAt[idx(i, j)];
      const je = area(exitAt, i, j);
      const s = sourceAt(i, j);
      if (!e || je === null || s === null || !(je > 0)) continue;
      nodes.push({ px, py, ex: e[0], ey: e[1], density: s / chief / je });
    }
  }

  const terms = [MAX_ZERNIKE_TERMS, 28, 15, 10, 6, 3].find((t) => nodes.length >= 2 * t) ?? 1;
  const fit = wavefrontSampler(
    fitZernike(
      nodes.map((q) => ({ px: q.ex, py: q.ey, waves: Math.sqrt(q.density) })),
      terms,
    ),
  );

  // The ray branch's weight. Under real aiming the solved target's Jacobian is
  // smooth and near-constant — the pupil's own aberration — and is fitted over
  // the aim; otherwise it is one number and drops out.
  let targetJacobian: ((px: number, py: number) => number) | null = null;
  if (real) {
    const samples: { px: number; py: number; waves: number }[] = [];
    for (let i = -half; i <= half; i++) {
      for (let j = -half; j <= half; j++) {
        if ((i * h) ** 2 + (j * h) ** 2 > 1 + 1e-12) continue;
        const jq = area(targetAt, i, j);
        if (jq !== null) samples.push({ px: i * h, py: j * h, waves: jq });
      }
    }
    targetJacobian = wavefrontSampler(fitZernike(samples, terms));
  }
  const chiefDz = dirZ[idx(0, 0)]!;
  const chiefJq = real ? targetJacobian!(0, 0) : 1;

  return {
    // A fit can dip below zero in a corner it was never constrained in; an
    // irradiance cannot.
    amplitude: (ex, ey) => Math.max(0, fit(ex, ey)),
    sourceWeight: (px, py, dir) => {
      const dz = Math.abs(dir.z) / length(dir);
      const s = (dz / chiefDz) ** cosPower;
      return targetJacobian === null ? s : (s * targetJacobian(px, py)) / chiefJq;
    },
    nodes,
  };
}
