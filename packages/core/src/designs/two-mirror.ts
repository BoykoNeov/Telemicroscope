/**
 * The shared paraxial layout of a Cassegrain-form two-mirror telescope: a
 * concave primary and a convex secondary on ONE axis, the secondary re-imaging
 * the prime focus back through a hole in the primary to an accessible focus
 * behind it.
 *
 * The classical Cassegrain and the Ritchey-Chrétien are the *same* layout —
 * identical aperture, focal length, magnification, separations, radii and
 * obstruction. They differ ONLY in the two conic constants: the Cassegrain
 * takes a paraboloidal primary and the confocal hyperboloidal secondary; the RC
 * takes two hyperboloids chosen to null coma as well as spherical aberration.
 * So the load-bearing closed-form geometry lives here, computed once, and each
 * preset applies its own conics to it — the layout cannot drift between the two.
 *
 * ## The design math (all magnitudes; engine signs applied by the preset)
 *
 * From aperture D, primary focal ratio F₁ and system focal ratio F:
 *
 *     f₁ = D·F₁            primary focal length
 *     f  = D·F             system focal length
 *     m  = f/f₁ = F/F₁     secondary (transverse) magnification, m > 1
 *
 * With `b` the back focal distance (primary vertex → final focus, behind the
 * primary), the primary→secondary separation follows from requiring the
 * secondary to image the prime focus to a point `b` behind the primary:
 *
 *     d  = (m·f₁ − b)/(m + 1)      primary → secondary
 *     s₁ = f₁ − d                  secondary → prime focus (its near conjugate)
 *     s₂ = m·s₁ = d + b            secondary → final focus (its far conjugate)
 *
 * The convex secondary images its virtual object at s₁ to a real image at s₂, so
 * in this engine's frame 2/R₂ = 1/s₂ − 1/s₁ with R₂ negative (convex toward the
 * −z beam):
 *
 *     |R₂| = 2·m·s₁/(m − 1)
 *
 * The secondary intercepts the converging beam where it has shrunk to (D/2)·s₁/f₁,
 * so the central obstruction it projects onto the pupil is ε = s₁/f₁. The mirror
 * is sized a hair larger — the marginal ray leaves the primary's rim at the SAG
 * plane, not the vertex, starting (f₁ + z_sag) from the prime focus — so the
 * true footprint radius is (D/2)·s₁/(f₁ + z_sag), z_sag = −D²/(16·f₁). The
 * leading sag term is conic-independent (the conic enters at r⁴), so this
 * footprint is exact for the paraboloid and correct to 4th order for the RC's
 * mild-hyperboloid primary.
 */

export interface TwoMirrorSpec {
  /** Clear aperture of the primary (mm). */
  readonly apertureMm: number;
  /** System focal ratio f/D — the number on the box. Must exceed the primary's. */
  readonly focalRatio: number;
  /** Primary focal ratio f₁/D. Faster than the system: the secondary magnifies. */
  readonly primaryFocalRatio: number;
  /**
   * Back focal distance (mm): primary vertex → final focus, behind the primary.
   * A mechanical number — it slides the secondary along the tube and changes its
   * curvature, but not the system focal length or magnification. Defaults to
   * 0.2·D, a plausible amount to clear the primary cell and reach a focuser,
   * standing in until the mech layer owns tube dimensions.
   */
  readonly backFocusMm?: number;
}

export interface TwoMirrorLayout {
  /** Aperture D (mm). */
  readonly apertureMm: number;
  /** Primary focal length f₁ = D·F₁ (mm). */
  readonly primaryFocalLengthMm: number;
  /** System focal length f = D·F (mm). */
  readonly focalLengthMm: number;
  /** Secondary transverse magnification m = F/F₁ (> 1). */
  readonly secondaryMagnification: number;
  /** Back focal distance b (mm), echoed since the default is computed. */
  readonly backFocusMm: number;
  /** Primary → secondary separation d (mm). */
  readonly primarySeparationMm: number;
  /** Secondary → prime focus s₁ (mm) — its near conjugate. */
  readonly secondaryToPrimeFocusMm: number;
  /** Secondary → final focus s₂ = d + b (mm) — its far conjugate. */
  readonly secondaryToFocusMm: number;
  /** Secondary radius-of-curvature magnitude |R₂| (mm). */
  readonly secondaryRadiusMm: number;
  /** Sag-exact clear-aperture radius of the secondary (mm). */
  readonly secondaryClearRadiusMm: number;
  /** Central obstruction ε = s₁/f₁, a fraction of the pupil RADIUS. */
  readonly obstruction: number;
  /** Primary curvature −1/(2f₁) (1/mm), concave toward the −z beam. */
  readonly primaryCurvature: number;
}

/**
 * The closed-form Cassegrain-form layout shared by both reflecting presets.
 * Validation (positive dimensions, F > F₁, reachable back focus) is done here
 * so both presets refuse the same impossible geometries identically.
 */
export function twoMirrorLayout(spec: TwoMirrorSpec, label: string): TwoMirrorLayout {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  const F1 = spec.primaryFocalRatio;
  if (!(D > 0) || !(F > 0) || !(F1 > 0)) {
    throw new Error(`${label}: aperture and focal ratios must be positive`);
  }
  if (!(F > F1)) {
    throw new Error(
      `${label}: system focal ratio ${F} must exceed the primary's ${F1} (the secondary magnifies)`,
    );
  }

  const f1 = D * F1;
  const f = D * F;
  const m = f / f1; // = F / F1 > 1
  const b = spec.backFocusMm ?? 0.2 * D;

  const d = (m * f1 - b) / (m + 1);
  if (!(d > 0)) {
    throw new Error(
      `${label}: back focus ${b} mm is too large for this geometry (secondary would sit at or behind the primary)`,
    );
  }

  const s1 = f1 - d; // secondary → prime focus
  const s2 = d + b; // secondary → final focus (= m·s1)
  const R2 = (2 * m * s1) / (m - 1); // magnitude; convex secondary re-images s1 → s2

  const zSag = -(D * D) / (16 * f1);
  const secondaryClearRadius = ((D / 2) * s1) / (f1 + zSag);
  const obstruction = s1 / f1;

  return {
    apertureMm: D,
    primaryFocalLengthMm: f1,
    focalLengthMm: f,
    secondaryMagnification: m,
    backFocusMm: b,
    primarySeparationMm: d,
    secondaryToPrimeFocusMm: s1,
    secondaryToFocusMm: s2,
    secondaryRadiusMm: R2,
    secondaryClearRadiusMm: secondaryClearRadius,
    obstruction,
    primaryCurvature: -1 / (2 * f1),
  };
}
