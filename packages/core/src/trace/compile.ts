import { Vec3, vec3 } from "../math/vec3";
import {
  Transform,
  IDENTITY,
  MAT3_IDENTITY,
  compose,
  invert,
  rotationX,
  rotationY,
  mat3Mul,
  translation,
} from "../math/transform";
import { SurfaceGeometry } from "../geometry/surfaces";
import { Medium } from "../materials/dispersion";
import { getMedium } from "../materials/catalog";
import { Prescription, SurfaceSpec, surfaceGeometry } from "./prescription";

/**
 * A `Prescription` is authoring data; the tracer never consumes it directly.
 * Compiling resolves geometry, frames, and media ONCE — resolving them per
 * ray costs a geometry object plus closures at every surface of every ray.
 * Measured on a 6-surface system at 3096 pupil rays, compiling first is
 * ~6.3× faster with identical results (docs/ARCHITECTURE.md § Precision).
 *
 * Frames are full rigid transforms, so tilt/decenter is a data change rather
 * than an engine change (architecture commitment #3). Purely axial surfaces
 * are flagged and fast-pathed, so the general form costs nothing.
 */

export interface CompiledSurface {
  readonly kind: "refract" | "reflect";
  readonly geometry: SurfaceGeometry;
  /** Surface frame in world coordinates (vertex at origin, axis +z locally). */
  readonly frame: Transform;
  /** Precomputed inverse — the tracer needs world→local every ray. */
  readonly inverseFrame: Transform;
  /** True when the frame is a pure z-translation: enables the scalar fast path. */
  readonly isAxial: boolean;
  /** Vertex z (world). Only meaningful when `isAxial`. */
  readonly vertexZ: number;
  /** Signed axial distance to the next vertex, along this surface's local z. */
  readonly thickness: number;
  readonly semiAperture: number;
  /** Medium after the surface; null for mirrors (which keep the incident one). */
  readonly mediumAfter: Medium | null;
  readonly isStop: boolean;
  /** Mirror reflectance / explicit surface transmittance override, or null for Fresnel. */
  readonly reflectance: number | null;
}

export interface CompiledSystem {
  readonly compiled: true;
  readonly surfaces: readonly CompiledSurface[];
  readonly objectMedium: Medium;
  readonly prescription: Prescription;
  /**
   * Refractive indices at a wavelength: `[n_object, n_after_0, n_after_1, …]`.
   * Cached per λ — a Sellmeier `sqrt` per ray per surface is pure waste when
   * every ray in a pupil pass shares the wavelength.
   */
  indices(wavelengthNm: number): readonly number[];
}

/** Rotation for a surface's tilt: X first, then Y (degrees). */
function tiltRotation(spec: SurfaceSpec) {
  const tx = spec.tiltXDeg ?? 0;
  const ty = spec.tiltYDeg ?? 0;
  if (tx === 0 && ty === 0) return MAT3_IDENTITY;
  return mat3Mul(rotationY((ty * Math.PI) / 180), rotationX((tx * Math.PI) / 180));
}

function isPureAxial(tf: Transform): boolean {
  const r = tf.rotation;
  for (let i = 0; i < 9; i++) {
    if (r[i] !== MAT3_IDENTITY[i]) return false;
  }
  return tf.translation.x === 0 && tf.translation.y === 0;
}

export function compile(p: Prescription): CompiledSystem {
  const objectMedium = getMedium(p.objectMedium ?? "AIR");
  const surfaces: CompiledSurface[] = [];

  // Local coordinate chain: frame_{i+1} = frame_i ∘ translate(0,0,t_i) ∘ tilt_{i+1}.
  // Thickness advances along the CURRENT (already tilted) surface's local z —
  // see the tilt-semantics decision in docs/ARCHITECTURE.md.
  let frame: Transform = IDENTITY;

  for (let i = 0; i < p.surfaces.length; i++) {
    const spec = p.surfaces[i]!;
    const local: Transform = {
      rotation: tiltRotation(spec),
      translation: vec3(spec.decenterX ?? 0, spec.decenterY ?? 0, 0),
    };
    const surfaceFrame = compose(frame, local);

    if (spec.kind === "refract" && !spec.medium) {
      throw new Error(`surface ${i}: refract surface needs a medium`);
    }

    surfaces.push({
      kind: spec.kind,
      geometry: surfaceGeometry(spec),
      frame: surfaceFrame,
      inverseFrame: invert(surfaceFrame),
      isAxial: isPureAxial(surfaceFrame),
      vertexZ: surfaceFrame.translation.z,
      thickness: spec.thickness,
      semiAperture: spec.semiAperture,
      mediumAfter: spec.kind === "reflect" ? null : getMedium(spec.medium!),
      isStop: spec.isStop === true,
      reflectance: spec.reflectance ?? null,
    });

    // Advance to the next vertex along this surface's local +z.
    frame = compose(surfaceFrame, translation(vec3(0, 0, spec.thickness)));
  }

  const cache = new Map<number, readonly number[]>();

  return {
    compiled: true,
    surfaces,
    objectMedium,
    prescription: p,
    indices(wavelengthNm: number): readonly number[] {
      let table = cache.get(wavelengthNm);
      if (!table) {
        const t = [objectMedium.n(wavelengthNm)];
        let prev = t[0]!;
        for (const s of surfaces) {
          prev = s.mediumAfter ? s.mediumAfter.n(wavelengthNm) : prev;
          t.push(prev);
        }
        table = t;
        cache.set(wavelengthNm, table);
      }
      return table;
    },
  };
}

/**
 * Compiled form for a prescription, memoized. Lets call sites keep passing a
 * `Prescription` and still get the compiled hot path.
 */
const CACHE = new WeakMap<Prescription, CompiledSystem>();

export function asCompiled(p: Prescription | CompiledSystem): CompiledSystem {
  if ((p as CompiledSystem).compiled === true) return p as CompiledSystem;
  const prescription = p as Prescription;
  let c = CACHE.get(prescription);
  if (!c) {
    c = compile(prescription);
    CACHE.set(prescription, c);
  }
  return c;
}

/** World vertex positions (only meaningful for axial systems). */
export function vertexZs(c: CompiledSystem): number[] {
  return c.surfaces.map((s) => s.vertexZ);
}

/** World-space position of a surface vertex, tilts included. */
export function vertexPoint(c: CompiledSystem, i: number): Vec3 {
  return c.surfaces[i]!.frame.translation;
}
