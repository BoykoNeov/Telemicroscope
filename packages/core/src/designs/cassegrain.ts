import { Prescription } from "../trace/prescription";
import { twoMirrorLayout, TwoMirrorSpec } from "./two-mirror";

/**
 * The classical Cassegrain: a paraboloidal primary and a convex hyperboloidal
 * secondary, on ONE axis. It is the second reflecting preset, and it is the
 * pinnable member of the Cassegrain family — everything below is a closed form
 * or a traced consequence of one, with no design table to hide behind.
 *
 * ## Why classical Cassegrain, and not the SCT the roadmap names
 *
 * A commercial Schmidt-Cassegrain corrects two spherical mirrors with an
 * aspheric corrector plate whose *production* figure is an OPTIMIZED, proprietary
 * surface: there is no external number to pin that exact surface to, so it would
 * violate the project's hard rule (new capability pinned to textbook/closed-form/
 * published values). The classical Cassegrain has its number for free, because it
 * is defined by a geometric property rather than an optimization — see below. The
 * aspheric corrector's clean external pin is the *Schmidt camera* (single spherical
 * mirror + corrector, textbook figure); the two-mirror all-spherical case then
 * lands in `sct.ts` (§ 5i) at its *third-order closed form* — the pinnable
 * idealization the optimized commercial figure departs from.
 *
 * ## It is `unfolded`, not folded
 *
 * Unlike the Newtonian, a Cassegrain has no lateral fold. The primary reflects
 * the beam straight back (−z); the secondary reflects it forward again (+z),
 * back through a hole in the primary, to a focus a distance `b` behind the
 * primary vertex. Every vertex is on one z-axis and thicknesses simply alternate
 * sign with each mirror — exactly the two-curved-mirror case pinned against the
 * mirror equation in `compile.test.ts`. So this preset needs no new trace
 * machinery; its only new content is the design math and its rungs.
 *
 * The central hole in the primary needs no annular aperture: the sequential
 * trace meets the primary once, on the way in, where the beam is wide and the
 * hole is a small near-axis region the marginal rays miss; the returning beam is
 * post-secondary and is never re-tested against the primary. The hole is
 * obstruction bookkeeping, and the secondary's own shadow already accounts for
 * it.
 *
 * ## The exact pin: two confocal conics
 *
 * A paraboloid images an infinitely distant axial point to its focus with ZERO
 * wavefront error — this is the Newtonian's on-axis rung. A convex hyperboloid
 * has two geometric foci and images one perfectly onto the other. Place the
 * hyperboloid so its NEAR focus coincides with the paraboloid's focus (the
 * prime focus) and its FAR focus is where you want the Cassegrain image, and the
 * two-mirror system is stigmatic on axis *exactly* — not to third order, to
 * numerical precision. So the headline rung is the Newtonian's, restated for two
 * curved mirrors: on axis, Strehl = 1. A spherical secondary breaks it, which is
 * the negative control.
 *
 * ## The design math (all magnitudes; engine signs applied at the end)
 *
 * From aperture D, primary focal ratio F₁ and system focal ratio F:
 *
 *     f₁ = D·F₁            primary focal length
 *     f  = D·F             system focal length
 *     m  = f/f₁ = F/F₁     secondary (transverse) magnification, m > 1
 *
 * With `b` the back focal distance (primary vertex → Cassegrain focus, behind
 * the primary), the primary→secondary separation follows from requiring the
 * secondary to image the prime focus to a point `b` behind the primary:
 *
 *     d  = (m·f₁ − b)/(m + 1)
 *     s₁ = f₁ − d = (f₁ + b)/(m + 1)     secondary → prime focus (its near conj.)
 *     s₂ = m·s₁ = d + b                  secondary → Cassegrain focus (its far conj.)
 *
 * The secondary is the convex mirror imaging its VIRTUAL object at s₁ (the prime
 * focus, beyond it) to a real image at s₂. In this engine's frame that is
 * 2/R₂ = 1/s₂ − 1/s₁, so R₂ is negative (convex toward the −z beam) with
 *
 *     |R₂| = 2·m·s₁/(m − 1) = 2·m·(f₁ + b)/((m − 1)(m + 1))
 *
 * and the confocal condition fixes its conic — the defining number of the whole
 * design:
 *
 *     k₂ = −((m + 1)/(m − 1))²           (a hyperboloid, k₂ < −1)
 *
 * The secondary intercepts the converging beam where it has shrunk to a radius
 * (D/2)·s₁/f₁, so the central obstruction it projects onto the pupil is
 *
 *     ε = s₁/f₁ = (f₁ − d)/f₁            (fraction of the pupil RADIUS)
 *
 * The mirror itself is sized a hair larger than that, exactly as the Newtonian's
 * diagonal is: the marginal ray leaves the paraboloid's rim at the SAG plane,
 * not the vertex plane, so it starts (f₁ + z_sag) from the prime focus rather
 * than f₁, and the true footprint radius is
 *
 *     (D/2)·(f₁ − d)/(f₁ + z_sag),      z_sag = −D²/(16·f₁)
 *
 * 0.4% wider at these ratios — the difference between a secondary that catches
 * the whole beam and one that shaves its rim. The reported obstruction stays the
 * clean paraxial figure ε; the clear aperture is the sag-exact footprint.
 *
 * SCOPE. The primary's central hole is not traced as a blocker (as above), and
 * coma — the residual the classical design does NOT correct — is the only
 * off-axis term pinned here. Astigmatism and field curvature are present in the
 * trace and unpinned, as they are for the Newtonian. All are recorded in
 * docs/VALIDATION.md § 5e.
 */

/** The classical Cassegrain shares the Cassegrain-form layout (see two-mirror.ts). */
export type CassegrainSpec = TwoMirrorSpec;

export interface Cassegrain {
  readonly prescription: Prescription;
  /** System effective focal length (mm) = m·f₁ = D·F. */
  readonly focalLengthMm: number;
  /** Primary focal length (mm) = D·F₁. */
  readonly primaryFocalLengthMm: number;
  /** Secondary transverse magnification m = F/F₁. */
  readonly secondaryMagnification: number;
  /** Primary vertex → secondary vertex, along the axis (mm). */
  readonly primarySeparationMm: number;
  /** Back focal distance (mm), echoed since the default is computed. */
  readonly backFocusMm: number;
  /** Secondary radius of curvature magnitude (mm). */
  readonly secondaryRadiusMm: number;
  /** Secondary conic (a hyperboloid, < −1). */
  readonly secondaryConic: number;
  /**
   * Central obstruction as a fraction of the pupil RADIUS — the spelling
   * `psf()` and the geometric branch both take.
   */
  readonly obstruction: number;
}

export function cassegrain(spec: CassegrainSpec): Cassegrain {
  const L = twoMirrorLayout(spec, "cassegrain");
  const { secondaryMagnification: m, primarySeparationMm: d, backFocusMm: b } = L;

  // The confocal condition fixes the secondary conic — the defining number of
  // the classical design: a hyperboloid whose near focus sits on the primary's.
  const k2 = -(((m + 1) / (m - 1)) ** 2);

  return {
    prescription: {
      surfaces: [
        {
          // Concave paraboloid: centre of curvature at −z, so R₁ = −2f₁, and the
          // conic −1 is what makes it aberration-free on axis.
          kind: "reflect",
          curvature: L.primaryCurvature,
          conic: -1,
          semiAperture: L.apertureMm / 2,
          thickness: -d, // secondary sits d back down the returning beam (−z)
          isStop: true,
        },
        {
          // Convex hyperboloid facing the incoming (−z-travelling) beam: centre
          // of curvature also at −z, so R₂ is negative in this frame.
          kind: "reflect",
          curvature: -1 / L.secondaryRadiusMm,
          conic: k2,
          semiAperture: L.secondaryClearRadiusMm,
          thickness: d + b, // forward (+z) to the Cassegrain focus, b behind primary
        },
      ],
    },
    focalLengthMm: L.focalLengthMm,
    primaryFocalLengthMm: L.primaryFocalLengthMm,
    secondaryMagnification: m,
    primarySeparationMm: d,
    backFocusMm: b,
    secondaryRadiusMm: L.secondaryRadiusMm,
    secondaryConic: k2,
    obstruction: L.obstruction,
  };
}
