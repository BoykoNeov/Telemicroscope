import { Prescription } from "../trace/prescription";

/**
 * The Newtonian: a paraboloid and a flat, and the first instrument in this
 * engine that could not be written down at all until the chain learned to fold.
 *
 * Everything here is derived from two numbers a user actually knows — aperture
 * and focal ratio — plus one mechanical one. Nothing is transcribed from a
 * design table, because there is nothing to transcribe: a Newtonian's optics
 * are fully determined by D, f, and where the diagonal sits.
 *
 * ## Why it is the first folded preset
 *
 * The primary alone is trivially expressible. The *diagonal* is not: it is a
 * tilted mirror with a surface downstream of it, so the coordinate chain has to
 * follow the beam out the side of the tube. That is exactly the `"folded"`
 * convention, and it is why the eyepiece can be placed where it physically sits
 * (docs/ARCHITECTURE.md § Tilt / decenter semantics).
 *
 * The optical consequence worth naming: **a Newtonian is a single paraboloid**.
 * On axis it is perfect — a paraboloid images an infinitely distant axial point
 * with zero aberration, so the on-axis PSF is the Airy pattern of its aperture
 * and nothing else. Off axis it has coma, the whole coma, and coma of a size
 * fixed by the focal ratio alone:
 *
 *     W_coma = θ·D / (32·F²)      (peak, at the pupil rim, mm)
 *
 * so a fast Newtonian's usable field shrinks as 1/F². That is the single most
 * important thing about the design, and the validation ladder pins it.
 *
 * ## The diagonal
 *
 * Sizing is a closed form, not a taste. At distance d from the primary the
 * converging on-axis beam has shrunk to D·(f − d)/f, and a field of diameter L
 * adds its own share, giving the classic minor axis
 *
 *     m = D·(f − d)/f + L·d/f
 *
 * That first term is paraxial, and this engine can do better cheaply: the
 * marginal ray leaves the rim of the primary at the *sag* plane, not the vertex
 * plane, so it starts (f + z_sag) from focus rather than f. The exact on-axis
 * term is D·(f − d)/(f + z_sag) with z_sag = −D²/(16f) — 0.25% wider at f/5,
 * which is the difference between a diagonal that catches the beam and one that
 * shaves it. The field allowance is left in its paraxial form; it is a small
 * correction on a term that is itself an allowance.
 *
 * The diagonal is elliptical — minor axis m across the tube, major m·√2 along
 * the tilt — and its projection back onto the pupil is a circle of diameter m,
 * which is the central obstruction the PSF needs.
 *
 * ## The footprint is not that ellipse, and the trace says so
 *
 * A 45° flat standing in a CONVERGING beam does not get an m × m√2 footprint.
 * The plane tilts through the beam, so one edge is met nearer the primary —
 * where the beam is still wider — and the other further along, where it has
 * narrowed. Intersecting the marginal ray (which leaves the rim of the primary
 * at (D/2, z_sag) and runs to the focus at −f) with the tilted plane gives the
 * far edge in closed form:
 *
 *     ρ = (D/2)·√2·(f − d) / (f − D/2 + z_sag),     z_sag = −D²/(16f)
 *
 * At f/5 that is 11% beyond where the naive ellipse ends, so a diagonal cut to
 * m·√2/2 clips its own beam. The sag term is not decoration either: dropping it
 * leaves the estimate 0.3% short — enough to vignette the pupil's own edge, and
 * the trace says so. Real Newtonians answer this by *offsetting* the diagonal
 * down the tube and away from the focuser; this preset answers it by sizing the
 * clear aperture to the footprint it actually has, which loses no light and
 * moves no ray.
 *
 * SCOPE, and it is a real one: `semiAperture` is a circular radius, so the
 * ellipse a diagonal actually is cannot be expressed. The flat is therefore
 * modelled slightly larger than the ideal offset ellipse. That changes no
 * traced ray — nothing clips either way — and the obstruction is not traced as
 * a blocker at all: it is reported here and applied in the pupil function,
 * where a central obstruction belongs. The reported figure is the ideal
 * elliptical diagonal's, m/D. Both limits are recorded in docs/VALIDATION.md,
 * as is the diagonal offset this preset does not yet model.
 */

export interface NewtonianSpec {
  /** Clear aperture of the primary (mm). */
  readonly apertureMm: number;
  /** Focal ratio f/D. */
  readonly focalRatio: number;
  /**
   * Optical axis → focal plane (mm): tube radius plus focuser height plus the
   * eyepiece's own back focus. A mechanical number, not an optical one — it
   * moves the diagonal up and down the tube without changing the optics at all.
   * Defaults to 0.75·D, which is a plausible tube-plus-focuser for a typical
   * amateur instrument and stands in until the mech layer owns barrel sizes.
   */
  readonly focusOffsetMm?: number;
  /**
   * Diameter of the field to keep FULLY illuminated (mm). Default 0 — a
   * diagonal sized to the on-axis beam exactly, which is the smallest one that
   * loses no light on axis and the cleanest thing to validate against.
   */
  readonly fullyIlluminatedFieldMm?: number;
}

export interface Newtonian {
  readonly prescription: Prescription;
  readonly focalLengthMm: number;
  /** Primary vertex → diagonal vertex, along the tube (mm). */
  readonly diagonalDistanceMm: number;
  /** Diagonal minor axis (mm): what the obstruction projects to. */
  readonly diagonalMinorAxisMm: number;
  /**
   * Central obstruction as a fraction of the pupil RADIUS — the spelling
   * `psf()` and the geometric branch both take.
   */
  readonly obstruction: number;
  /** Axis → focal plane (mm), echoed back since the default is computed. */
  readonly focusOffsetMm: number;
}

export function newtonian(spec: NewtonianSpec): Newtonian {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  if (!(D > 0) || !(F > 0)) throw new Error("newtonian: aperture and focal ratio must be positive");

  const f = D * F;
  const focusOffsetMm = spec.focusOffsetMm ?? 0.75 * D;
  const d = f - focusOffsetMm;
  if (!(d > 0)) {
    throw new Error(
      `newtonian: focus offset ${focusOffsetMm} mm does not fit inside a ${f} mm focal length`,
    );
  }

  const L = spec.fullyIlluminatedFieldMm ?? 0;
  // Sag of the paraboloid at its own rim: where the marginal ray really starts.
  const sag = -(D * D) / (16 * f);
  const onAxisMinor = (D * (f - d)) / (f + sag);
  const minor = onAxisMinor + (L * d) / f;

  // Far edge of the real footprint (see above), then scaled by whatever field
  // allowance the caller asked for, so L = 0 stays exactly the traced bound.
  const footprint = ((D / 2) * Math.SQRT2 * (f - d)) / (f - D / 2 + sag);
  const clearRadius = (footprint * minor) / onAxisMinor;

  return {
    prescription: {
      mirrorFrames: "folded",
      surfaces: [
        {
          // Concave toward the incoming light: the centre of curvature lies at
          // −z, so R = −2f. Conic −1 is what makes it aberration-free on axis.
          kind: "reflect",
          curvature: -1 / (2 * f),
          conic: -1,
          semiAperture: D / 2,
          thickness: d,
          isStop: true,
        },
        {
          // 45° about x, so the chain — and the beam — leaves along +y.
          kind: "reflect",
          curvature: 0,
          // The far edge of the footprint, not the ellipse's semi-major: see
          // the convergence note above.
          semiAperture: clearRadius,
          tiltXDeg: 45,
          thickness: focusOffsetMm,
        },
      ],
    },
    focalLengthMm: f,
    diagonalDistanceMm: d,
    diagonalMinorAxisMm: minor,
    obstruction: minor / D,
    focusOffsetMm,
  };
}
