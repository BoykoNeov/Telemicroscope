import { Vec3, vec3 } from "./vec3";

/** Row-major 3×3 rotation matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m[3 * r + c] =
        a[3 * r]! * b[c]! + a[3 * r + 1]! * b[3 + c]! + a[3 * r + 2]! * b[6 + c]!;
  return m as unknown as Mat3;
}

export const mat3Apply = (m: Mat3, v: Vec3): Vec3 =>
  vec3(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );

export const mat3Transpose = (m: Mat3): Mat3 =>
  [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const rotationX = (rad: number): Mat3 => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};

export const rotationY = (rad: number): Mat3 => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

/**
 * Householder reflection in the plane through the origin with unit normal `n`:
 * L = I − 2·n·nᵀ. Improper (det = −1) by construction — reflecting a frame in a
 * mirror's tangent plane flips its handedness, which is what a mirror does to
 * an image. `mat3Transpose` remains the inverse, since L is still orthogonal.
 */
export function reflectionAbout(n: Vec3): Mat3 {
  const len = Math.hypot(n.x, n.y, n.z);
  const x = n.x / len, y = n.y / len, z = n.z / len;
  return [
    1 - 2 * x * x, -2 * x * y, -2 * x * z,
    -2 * y * x, 1 - 2 * y * y, -2 * y * z,
    -2 * z * x, -2 * z * y, 1 - 2 * z * z,
  ];
}

/**
 * Rigid transform: p_world = R · p_local + t.
 * Elements are placed in the world by one of these; the sequential engine
 * moves rays into each surface's local frame (vertex at origin, axis +z).
 */
export interface Transform {
  readonly rotation: Mat3;
  readonly translation: Vec3;
}

export const IDENTITY: Transform = { rotation: MAT3_IDENTITY, translation: vec3(0, 0, 0) };

export const translation = (t: Vec3): Transform => ({ rotation: MAT3_IDENTITY, translation: t });

/** Apply a to the result of b: world = a ∘ b (b first). */
export const compose = (a: Transform, b: Transform): Transform => ({
  rotation: mat3Mul(a.rotation, b.rotation),
  translation: vec3(
    a.rotation[0] * b.translation.x + a.rotation[1] * b.translation.y + a.rotation[2] * b.translation.z + a.translation.x,
    a.rotation[3] * b.translation.x + a.rotation[4] * b.translation.y + a.rotation[5] * b.translation.z + a.translation.y,
    a.rotation[6] * b.translation.x + a.rotation[7] * b.translation.y + a.rotation[8] * b.translation.z + a.translation.z,
  ),
});

export const applyToPoint = (tf: Transform, p: Vec3): Vec3 => {
  const r = mat3Apply(tf.rotation, p);
  return vec3(r.x + tf.translation.x, r.y + tf.translation.y, r.z + tf.translation.z);
};

export const applyToDirection = (tf: Transform, d: Vec3): Vec3 => mat3Apply(tf.rotation, d);

export function invert(tf: Transform): Transform {
  const rt = mat3Transpose(tf.rotation);
  const t = mat3Apply(rt, tf.translation);
  return { rotation: rt, translation: vec3(-t.x, -t.y, -t.z) };
}
