import { Vec3, vec3, sub, dot, length, add, scale } from "../math/vec3";
import { Ray } from "../trace/ray";
import { traceRay } from "../trace/sequential";
import { CompiledSystem, asCompiled, compile } from "../trace/compile";
import { toImageSpace } from "../trace/axis";
import { OpticalSystem } from "../trace/system";
import { PupilGeometry, pupils, imagePlaneZ } from "./pupils";
import { PupilPoint, AimOptions, aimRay, chiefRay } from "./aiming";
import { lateralMagnification } from "./microscope";

/**
 * OPD — optical path difference at the exit pupil. This is the wave layer's
 * entire input, and it is NOT the raw accumulated OPL: that also contains the
 * reference geometry. Two conventions convert one into the other
 * (docs/ARCHITECTURE.md § Wavefront reference):
 *
 *  1. rays launched from an equal-phase surface (handled in `aimRay`), and
 *  2. path measured to a **reference sphere** centred on the image point with
 *     radius equal to the exit-pupil distance, differenced against the chief
 *     ray:  OPD = OPL_to_sphere(ray) − OPL_to_sphere(chief).
 *
 * Sign: positive OPD means the ray's path is LONGER than the chief ray's —
 * that part of the wavefront lags.
 *
 * COORDINATE. Rays are traced through the real prescription, folds included,
 * and their exit segments are then re-expressed in unfolded IMAGE-SPACE
 * coordinates (`toImageSpace`). Path length is invariant under that rigid map,
 * so the OPD is untouched by it; what the map buys is that the image plane and
 * the reference sphere can go on being described by one axial number. For an
 * axial system it is the identity and nothing here changes.
 */

export interface OpdSample extends PupilPoint {
  /** OPD in waves at the sample's wavelength. */
  readonly waves: number;
  /** Surviving energy fraction along this ray (Fresnel + coatings). */
  readonly throughput: number;
  /**
   * Where this ray actually lands in the pupil the TRANSFORM needs — see
   * `exitCoordinate`: its crossing of the reference sphere less the chief ray's,
   * over the sphere's radius. Unnormalized: a sine, not a pupil fraction.
   * `(px, py)` is where the ray was AIMED; this is where it went, and on an
   * aperture far from paraxial the two are not proportional (§ 2i). See
   * `exitApertureSine` for the number that normalizes it.
   */
  readonly exitX: number;
  readonly exitY: number;
}

export interface OpdMap {
  readonly wavelengthNm: number;
  readonly fieldValue: number;
  /** Samples that made it through; vignetted/TIR/missed rays are dropped. */
  readonly samples: readonly OpdSample[];
  /** How many requested samples were lost to vignetting — this IS vignetting. */
  readonly lost: number;
  /** Chief-ray image point, in unfolded image-space coordinates. */
  readonly imagePoint: Vec3;
  /** The chief ray's unit exit direction, in the same coordinates. */
  readonly chiefDirection: Vec3;
  /** Where the chief ray crosses the reference sphere. */
  readonly chiefSpherePoint: Vec3;
  /** The exit pupil is at infinity, and `referenceRadius` a stand-in. */
  readonly exitAtInfinity: boolean;
  readonly referenceRadius: number;
  readonly pupil: PupilGeometry;
  /** RMS OPD in waves about its own mean (piston removed). */
  readonly rmsWaves: number;
}

/**
 * Signed distance along a ray to the crossing of the reference sphere that still
 * has the sphere's CENTRE ahead of it.
 *
 * Not "first forward", and not "nearest" either — and neither difference is
 * cosmetic. The sphere is centred on the image point and passes through the
 * chief ray where it crosses the exit-pupil plane. That plane is flat and the
 * sphere is curved, so the traced rays straddle it: some land just outside, some
 * just inside, by of order the sagitta. Off axis the sphere's centre also shifts
 * transversely, which pushes a whole side of the pupil inside it. For a point
 * INSIDE the sphere the only forward crossing is the far one, beyond the focus —
 * a full sphere diameter away, ~2R of spurious path (200 mm, or 3·10⁵ waves, on
 * an f/5 system) on half the pupil. So the quantity wanted is a SIGNED path,
 * negative when the ray's endpoint has already passed the sphere, and "first
 * forward" is wrong.
 *
 * "Nearest" gets that case right and one other case wrong, which is why this
 * reads the way it does now rather than as `Math.abs(t1) <= Math.abs(t2)`. Near
 * the sphere's CENTRE the two roots are ±radius and the comparison is decided by
 * rounding, so a handful of rays out of a pupil-full pick the far crossing and
 * come back a sphere diameter long. That is not a corner case: an evaluation
 * plane sitting AT the image puts every ray there, which is exactly what § 6au's
 * trailing reference plane does, and it made a 0.0055-wave tolerance read
 * 3.1·10⁴ waves with no ray reported lost.
 *
 * The rule that covers both is the geometric one — the wavefront is sampled
 * where the ray crosses on its way TO the image point, never on the far side
 * after passing it — and it costs no test to apply. Substituting each root into
 * dot(centre − o − t·d, d) gives +√disc/2 for `(−b − √disc)/2` and −√disc/2
 * for the other, so the root is fixed by the algebra: the smaller root, always.
 *
 * On axis every point lands outside the sphere and all three readings agree,
 * which is why the symmetric rungs never saw either failure.
 */
function intersectSphere(o: Vec3, d: Vec3, centre: Vec3, radius: number): number | null {
  const oc = sub(o, centre);
  const b = 2 * dot(oc, d);
  const cc = dot(oc, oc) - radius * radius;
  const disc = b * b - 4 * cc; // a = 1 for a unit direction
  if (disc < 0) return null;
  return (-b - Math.sqrt(disc)) / 2;
}

/** Where a ray meets the (flat) image plane. */
function atPlaneZ(r: Ray, z: number): Vec3 {
  const t = (z - r.origin.z) / r.dir.z;
  return vec3(r.origin.x + r.dir.x * t, r.origin.y + r.dir.y * t, z);
}

/** Total optical path from launch to the reference sphere, or null if lost. */
function pathToSphere(
  system: OpticalSystem,
  ray: Ray,
  centre: Vec3,
  radius: number,
  nImage: number,
): { opl: number; throughput: number; exit: Ray } | null {
  const c = asCompiled(system.prescription);
  const res = traceRay(system.prescription, ray);
  if (res.status !== "ok" || !res.ray) return null;
  const exit = toImageSpace(c, res.ray);
  const t = intersectSphere(exit.origin, exit.dir, centre, radius);
  if (t === null) return null;
  return { opl: res.opl + Math.abs(nImage) * t, throughput: res.throughput, exit };
}

const unit = (d: Vec3): Vec3 => {
  const n = length(d);
  return vec3(d.x / n, d.y / n, d.z / n);
};

/** What `exitCoordinate` needs of a map: its reference sphere and chief ray. */
export type ExitFrame = Pick<
  OpdMap,
  "imagePoint" | "referenceRadius" | "chiefDirection" | "chiefSpherePoint" | "exitAtInfinity"
>;

/**
 * A traced exit ray's coordinate in the pupil the transform needs (§ 2i): where
 * it crosses the reference sphere, less where the chief ray does, over the
 * sphere's radius — transverse x and y, unnormalized. `null` if it misses the
 * sphere.
 *
 * The SPHERE point and not the ray's direction, which is the same number for a
 * perfect wavefront and not for an aberrated one: a ray's direction carries its
 * own transverse aberration over R, and on a strongly undercorrected objective
 * (the DIN 10×/0.2 among them) the rim rays' directions fold back toward the
 * axis while their sphere crossings march on outward. The aberration belongs in
 * the phase, which is where the sphere point leaves it.
 *
 * With the exit pupil at INFINITY the radius is a stand-in (`opdMap`'s unit
 * sphere), and the coordinate is the direction less the chief's, negated to the
 * sphere point's sign — the sphere point's own limit as R grows.
 */
export function exitCoordinate(frame: ExitFrame, exit: Ray): readonly [number, number] | null {
  const d = unit(exit.dir);
  const cd = frame.chiefDirection;
  if (frame.exitAtInfinity) return [-(d.x - cd.x), -(d.y - cd.y)];
  const t = intersectSphere(exit.origin, d, frame.imagePoint, frame.referenceRadius);
  if (t === null) return null;
  const q = frame.chiefSpherePoint;
  const r = frame.referenceRadius;
  return [(exit.origin.x + d.x * t - q.x) / r, (exit.origin.y + d.y * t - q.y) / r];
}

export function opdMap(
  system: OpticalSystem,
  fieldValue: number,
  wavelengthNm: number,
  points: readonly PupilPoint[],
  options: AimOptions = {},
): OpdMap {
  const c = asCompiled(system.prescription);
  const pupil = pupils(system, wavelengthNm);
  const nImage = Math.abs(c.indices(wavelengthNm)[c.surfaces.length]!);

  // The chief ray defines both the image point and the reference sphere.
  const chief = chiefRay(system, pupil, fieldValue, wavelengthNm, options);
  const chiefTrace = traceRay(system.prescription, chief);
  if (chiefTrace.status !== "ok" || !chiefTrace.ray) {
    throw new Error(`chief ray failed (${chiefTrace.status}) at field ${fieldValue}`);
  }
  const chiefExit = toImageSpace(c, chiefTrace.ray);
  const imagePoint = atPlaneZ(chiefExit, imagePlaneZ(c, system));

  // Reference sphere: centred on the image point, passing through the chief
  // ray where it crosses the exit-pupil plane.
  const qz = Number.isFinite(pupil.exit.z) ? pupil.exit.z : imagePoint.z - 1;
  const q = atPlaneZ(chiefExit, qz);
  const referenceRadius = length(sub(imagePoint, q));

  const chiefPath = pathToSphere(system, chief, imagePoint, referenceRadius, nImage);
  if (!chiefPath) throw new Error("chief ray does not reach the reference sphere");
  const cd = unit(chiefPath.exit.dir);
  const tc = intersectSphere(chiefPath.exit.origin, cd, imagePoint, referenceRadius)!;
  const frame: ExitFrame = {
    imagePoint,
    referenceRadius,
    chiefDirection: cd,
    chiefSpherePoint: add(chiefPath.exit.origin, scale(cd, tc)),
    exitAtInfinity: !Number.isFinite(pupil.exit.z),
  };

  const samples: OpdSample[] = [];
  let lost = 0;
  const mmToWaves = 1e6 / wavelengthNm;

  for (const p of points) {
    const ray = aimRay(system, pupil, fieldValue, p, wavelengthNm, options);
    const got = pathToSphere(system, ray, imagePoint, referenceRadius, nImage);
    if (!got) {
      lost++;
      continue;
    }
    const [exitX, exitY] = exitCoordinate(frame, got.exit) ?? [NaN, NaN];
    samples.push({
      px: p.px,
      py: p.py,
      waves: (got.opl - chiefPath.opl) * mmToWaves,
      throughput: got.throughput,
      exitX,
      exitY,
    });
  }

  let mean = 0;
  for (const s of samples) mean += s.waves;
  mean = samples.length > 0 ? mean / samples.length : 0;
  let acc = 0;
  for (const s of samples) acc += (s.waves - mean) ** 2;
  const rmsWaves = samples.length > 0 ? Math.sqrt(acc / samples.length) : 0;

  return {
    wavelengthNm,
    fieldValue,
    samples,
    lost,
    imagePoint,
    chiefDirection: cd,
    chiefSpherePoint: frame.chiefSpherePoint,
    exitAtInfinity: frame.exitAtInfinity,
    referenceRadius,
    pupil,
    rmsWaves,
  };
}

/**
 * Is the ray through this normalized pupil point clipped before the image?
 *
 * This is *trace-level* (partial) vignetting — a ray stopped at a downstream
 * surface's clear aperture, not the aperture stop. `OpdMap.lost` already
 * *counts* it; this reports *where* it happens, at any pupil coordinate the FFT
 * grid asks about, so the diffraction branch's amplitude support can shrink to
 * the light that actually gets through (docs/VALIDATION § 2f).
 *
 * The criterion is the trace itself — `status !== "ok"` — which is the SAME
 * test `opdMap` drops samples on and `exitBundle` drops rays on. Writing it
 * once is what keeps the two PSF branches from disagreeing about the aperture,
 * the discipline the spider mask already follows: with an identical mask on
 * both, their energies agree honestly rather than being forced equal by
 * `blendPsf` (docs/VALIDATION § 2e).
 *
 * SCOPE. Any clip counts — a hard stop, a TIR loss, a miss — because all three
 * mean "no light here", which is what a pupil amplitude of zero says. The
 * predicate re-aims and re-traces one ray per query, so a caller applies it
 * only when the trace already shows loss (`OpdMap.lost > 0`); on the common
 * unvignetted system it is never built and costs nothing.
 */
export function vignetteMask(
  system: OpticalSystem,
  pupil: PupilGeometry,
  fieldValue: number,
  wavelengthNm: number,
  options: AimOptions = {},
): (px: number, py: number) => boolean {
  return (px, py) => {
    const ray = aimRay(system, pupil, fieldValue, { px, py }, wavelengthNm, options);
    return traceRay(system.prescription, ray).status !== "ok";
  };
}

const STOP_ONLY = new WeakMap<CompiledSystem, Map<number, CompiledSystem>>();

/**
 * The chain with every rim removed BUT the stop's. The rim readers ask where the
 * stop's own edge is, so the stop has to stay: removing it too (aiming's
 * `unclipped`, which is right for a solve) reads an edge the stop blocks — the
 * DIN 10×/0.2's ρ = 1 ray is stopped AT the stop, and an edge read past it put
 * the light where none goes.
 */
function stopOnly(c: CompiledSystem, stopIndex: number): CompiledSystem {
  let perStop = STOP_ONLY.get(c);
  if (!perStop) STOP_ONLY.set(c, (perStop = new Map()));
  let u = perStop.get(stopIndex);
  if (!u) {
    u = compile({
      ...c.prescription,
      surfaces: c.prescription.surfaces.map((s, i) =>
        i === stopIndex ? s : { ...s, semiAperture: Infinity },
      ),
    });
    perStop.set(stopIndex, u);
  }
  return u;
}

/**
 * A ray's exit coordinate, traced with every rim but the stop's removed: where
 * the aim sends it, whether or not a downstream aperture would have stopped it.
 * Vignetting is the vignette mask's question; these readers ask only where the
 * stop's own rim is. `null` where the stop blocks the ray or the ray does not
 * exist at all — misses a surface or turns back.
 */
function unclippedExitCoordinate(
  system: OpticalSystem,
  frame: ExitFrame,
  pupil: PupilGeometry,
  fieldValue: number,
  point: PupilPoint,
  wavelengthNm: number,
  options: AimOptions,
): readonly [number, number] | null {
  const c = asCompiled(system.prescription);
  let res;
  try {
    res = traceRay(
      stopOnly(c, pupil.stopIndex),
      aimRay(system, pupil, fieldValue, point, wavelengthNm, options),
    );
  } catch {
    // Real aiming refuses a stop point no launch reaches: the same verdict.
    return null;
  }
  if (res.status !== "ok" || !res.ray) return null;
  return exitCoordinate(frame, toImageSpace(c, res.ray));
}

/** Bisection steps for the reachable edge: 2⁻⁴⁰ of the pupil radius. */
const EDGE_STEPS = 40;

/**
 * The farthest ray out along the direction (cx, cy) of the aim that exists —
 * the stop's rim where it is reachable, and otherwise the edge of the light,
 * found by bisection on the aim radius. § 6ad's telescope is the case: its stop
 * reaches past what the lens can pass, and its pupil transmits only to ρ = 0.728
 * on the axis, so a rim ray at ρ = 1 is not a ray at all.
 */
function reachableExit(
  system: OpticalSystem,
  frame: ExitFrame,
  pupil: PupilGeometry,
  fieldValue: number,
  cx: number,
  cy: number,
  wavelengthNm: number,
  options: AimOptions,
): { readonly at: readonly [number, number]; readonly rho: number } {
  const at = (rho: number) =>
    unclippedExitCoordinate(
      system,
      frame,
      pupil,
      fieldValue,
      { px: rho * cx, py: rho * cy },
      wavelengthNm,
      options,
    );
  const rim = at(1);
  if (rim !== null) return { at: rim, rho: 1 };
  let lo = 0;
  let hi = 1;
  let best = at(0);
  if (best === null) {
    throw new Error(`exit coordinate: the chief ray at field ${fieldValue} does not leave the system`);
  }
  for (let i = 0; i < EDGE_STEPS; i++) {
    const mid = 0.5 * (lo + hi);
    const d = at(mid);
    if (d === null) hi = mid;
    else {
      lo = mid;
      best = d;
    }
  }
  return { at: best, rho: lo };
}

/**
 * The traced image-space aperture SINE — the number that turns a ray's
 * `exitX/exitY` into the transform's pupil coordinate (§ 2i).
 *
 * Read on the axis (field 0), on the rim ray aimed at (1, 0), as its
 * `exitCoordinate` on the axial map's sphere. On the axis because the
 * transform's ruler must be one number for every field a frame stacks (a ruler
 * per field would put each patch on its own grid); on the rim because that is
 * where the aperture is.
 *
 * **Signed by the geometry, not by the aim (§ 2o).** Its magnitude is the rim's;
 * its sign is +1 where the beam converges on the image point and −1 where it
 * diverges from it, because that — the sign of the reference sphere's radius —
 * is what the Debye integral's orientation turns on: a diverging beam would
 * otherwise mirror the pupil. It was the aim rim ray's own sign until § 2o, and
 * the two agree wherever the aim labels a ray on the side it physically leaves.
 * They do not on an objective telecentric in object space: chromatically its
 * entrance pupil passes through infinity, the paraxial aim at a point on a pupil
 * beyond infinity sends px = +1 the other way, and on the DIN presets every
 * wavelength from ~531 nm to just short of 587.5618 nm is labelled mirrored
 * (`aimOrientation` reads −1 there). Signed by the aim, the exit layout copied
 * the mirror and every odd aberration in that band came out reversed — the
 * transform's centroid on the wrong side of the rays'.
 *
 * It is the paraxial exit pupil's r/R wherever the pupil maps linearly onto the
 * exit cone, and it is NOT that number on an aperture where it does not: on
 * § 6e's oil 100×/1.25 the aim is uniform in tan θ and the cone in sin θ, and
 * r/R reads 1.766× too wide (item 21 of the register).
 *
 * Where the rim ray does not exist (§ 6ad), the sine is the secant through the
 * farthest one that does, e(ρ*)/ρ*: the edge of the light then lands at ρ* in
 * the transform, where the aim layout put it.
 */
const APERTURE_SINE = new WeakMap<CompiledSystem, Map<string, ApertureSine>>();

interface ApertureSine {
  /** |rim| signed by the beam's convergence. */
  readonly sine: number;
  /** +1 where the aim labels a ray on the side it leaves, −1 where it mirrors it. */
  readonly aimOrientation: 1 | -1;
}

export function exitApertureSine(
  system: OpticalSystem,
  wavelengthNm: number,
  options: AimOptions = {},
): number {
  return apertureSineOf(system, wavelengthNm, options).sine;
}

/**
 * Whether the aim labels a pupil point on the side its ray physically leaves
 * (+1) or mirrors it (−1), at this wavelength — § 2o.
 *
 * The aim layout lays a sample where it was aimed, so where this is −1 its
 * pupil is the true one reflected (register item 30); the exit layout lays it
 * where it went and is right either way. A map from an object-space direction
 * to the exit layout's coordinate that goes through the aim (`pupilDirectionMap`)
 * multiplies by this to land on the physical side.
 */
export function aimOrientation(
  system: OpticalSystem,
  wavelengthNm: number,
  options: AimOptions = {},
): 1 | -1 {
  return apertureSineOf(system, wavelengthNm, options).aimOrientation;
}

function apertureSineOf(system: OpticalSystem, wavelengthNm: number, options: AimOptions): ApertureSine {
  // A property of the system, the wavelength and the aim — not of the field —
  // and every pupil of a frame asks for it, so it is read once per key. The cache
  // hangs off the PRESCRIPTION, which two systems can share while differing in
  // what the rim is — the stop's choice, the aperture's size, the image sphere —
  // so every field of the system the reading depends on is in the key (§ 2q).
  const c = asCompiled(system.prescription);
  const conj = system.conjugate;
  const key = [
    wavelengthNm,
    conj.kind,
    conj.kind === "finite" ? conj.distance : "",
    system.rayAiming ?? "",
    options.launchZ ?? "",
    JSON.stringify(system.aperture),
    JSON.stringify(system.apertureStop ?? null),
    JSON.stringify(system.imageSurface ?? null),
  ].join("|");
  let perSystem = APERTURE_SINE.get(c);
  if (!perSystem) APERTURE_SINE.set(c, (perSystem = new Map()));
  const known = perSystem.get(key);
  if (known !== undefined) return known;
  const s = readApertureSine(system, wavelengthNm, options);
  perSystem.set(key, s);
  return s;
}

function readApertureSine(system: OpticalSystem, wavelengthNm: number, options: AimOptions): ApertureSine {
  // The axial map's own sphere: the chief ray and nothing else.
  const axial = opdMap(system, 0, wavelengthNm, [], options);
  // Where the rim is not a ray, the farthest one that is, read as a secant:
  // the light's edge then sits at its own aim radius, as it always did.
  const rim = reachableExit(system, axial, axial.pupil, 0, 1, 0, wavelengthNm, options);
  const s = rim.at[0] / rim.rho;
  if (!(Math.abs(s) > 0)) {
    throw new Error("exit coordinate: the axial rim ray leaves parallel to the chief ray — no aperture");
  }
  // At infinity `exitCoordinate` is already a direction difference, which
  // carries the sphere's sign itself; on a finite sphere it is a crossing over
  // |R|, and the beam converges where the image point lies ahead of the chief
  // ray's crossing.
  const converging = axial.exitAtInfinity || dot(sub(axial.imagePoint, axial.chiefSpherePoint), axial.chiefDirection) > 0;
  const geometric = converging ? 1 : -1;
  return {
    sine: geometric * Math.abs(s),
    aimOrientation: Math.sign(s) === geometric ? 1 : -1,
  };
}

/**
 * One unit of the canonical pupil coordinate at a finite conjugate, as an
 * object-space OPTICAL direction sine: ν = |M|·n′·|σ| (§ 2n).
 *
 * The frame's ruler puts a specimen period p at pupil coordinate (λ/p)/ν — the
 * pixel `imagePixelScaleMm` reads off σ, referred to the specimen through the
 * axial probe's |M| — and a period p diffracts by n·ΔL = λ/p. So ν is what turns
 * an object-space direction into the coordinate the frequency lattice is in, and
 * the one number the condenser's directions (`pupilDirectionMap`) and the exit
 * pupil's irradiance (`exitDensity`) are both measured against. Paraxially it is
 * n·u, the Lagrange invariant's own statement, so the canonical coordinate and the
 * traced exit coordinate agree to first order at the chief ray.
 *
 * `probeHeightMm` is the frame's (default 1e-4 of the conjugate distance, the
 * frame's own default); the magnification moves with it only by distortion.
 */
export function canonicalApertureSine(
  system: OpticalSystem,
  wavelengthNm: number,
  options: AimOptions = {},
  probeHeightMm?: number,
): number {
  if (system.conjugate.kind !== "finite") {
    throw new Error("canonicalApertureSine: needs a finite conjugate — at infinity the object has no direction sine");
  }
  const m = lateralMagnification(system, probeHeightMm ?? system.conjugate.distance * 1e-4, wavelengthNm);
  return Math.abs(m) * Math.abs(pupils(system, wavelengthNm).exit.n) * Math.abs(exitApertureSine(system, wavelengthNm, options));
}

/** Rays around the stop's rim `exitRim` traces. Linear in angle between them. */
export const RIM_RAYS = 32;

/**
 * The stop's rim as the transform sees it: `RIM_RAYS` rays aimed at the unit
 * circle at this field, each turned into `exitX/exitY` against `map`'s chief ray.
 *
 * The aperture's edge, traced rather than assumed. A pupil that maps linearly
 * onto the exit cone keeps a circular rim; one that does not still keeps a
 * closed curve around the chief ray, and on the axis of a symmetric system it is
 * a circle again whatever the mapping — so the edge never depends on how well a
 * fit can invert the map, which on the oil objective is only to 3e-3 (§ 2i).
 */
export function exitRim(
  system: OpticalSystem,
  map: OpdMap,
  options: AimOptions = {},
): readonly PupilPoint[] {
  const out: PupilPoint[] = [];
  for (let k = 0; k < RIM_RAYS; k++) {
    const a = (2 * Math.PI * k) / RIM_RAYS;
    // Off axis a rim ray can fail to exist where the axial one does; the edge of
    // the light along that azimuth is then the farthest ray that does.
    const [x, y] = reachableExit(
      system,
      map,
      map.pupil,
      map.fieldValue,
      Math.cos(a),
      Math.sin(a),
      map.wavelengthNm,
      options,
    ).at;
    out.push({ px: x, py: y });
  }
  return out;
}
