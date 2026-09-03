import { getMedium } from "../materials/catalog";
import { Prescription, unfoldedTwin } from "../trace/prescription";

/**
 * Third-order (Seidel) aberration sums S_I (spherical) and S_II (coma), from the
 * paraxial marginal and chief rays.
 *
 * This is a DESIGN tool, not an analysis readout. The engine already measures
 * aberration the honest way — trace rays, build the OPD map, fit Zernikes — and
 * that stays the ground truth. What the exact trace cannot do is *solve*: given a
 * doublet's two glasses and its total power, which bending makes the spherical
 * aberration vanish? Third-order theory answers that in closed form, which is how
 * every achromat since Fraunhofer has been laid out, and it is why this module
 * exists: `designs/achromat` solves S_I = 0 here and the trace then confirms the
 * result independently (docs/VALIDATION.md § 5j). Solving on the trace's own
 * residual instead would be fitting the design to the engine — the circularity the
 * project's hard rule forbids.
 *
 * ## The formulas (Welford, *Aberrations of Optical Systems*, ch. 8)
 *
 * For each surface, with the paraxial MARGINAL ray (y, u) and CHIEF ray (ȳ, ū)
 * incident, indices n → n′ and curvature c:
 *
 *     A  = n(y·c + u)          the marginal refraction invariant (n·i)
 *     Ā  = n(ȳ·c + ū)          the chief-ray one
 *     Δ(u/n) = u′/n′ − u/n     Δ(1/n) = 1/n′ − 1/n
 *     H  = n(ū·y − u·ȳ)        the Lagrange invariant, constant through the system
 *
 *     S_I   = −A²·y·Δ(u/n)     S_II = −A·Ā·y·Δ(u/n)
 *     S_III = −Ā²·y·Δ(u/n)     S_IV = −H²·c·Δ(1/n)
 *     S_V   = (Ā/A)·(S_III + S_IV)
 *
 * All are wavefront measures in the same units as the ray heights (mm here), for
 * a marginal ray launched at the pupil edge: the wavefront aberration is
 *
 *     W(ρ, θ) = (S_I/8)·ρ⁴ + (S_II/2)·ρ³·cos θ + …
 *
 * so `w040 = S_I/8` is the peak spherical-aberration wavefront error at the rim.
 *
 * The four sums past S_II are all field-driven — Ā and H both carry the chief
 * ray — so with `fieldAngleRad` left at 0 they are identically zero, which is the
 * on-axis truth and not a missing value.
 *
 * ## Two external anchors pin this, and they are checked before anything is built
 * ## on it (test/seidel.test.ts)
 *
 *  - **A spherical mirror.** Collimated in, S_I/8 must come out h⁴/(4R³) — the
 *    number § 5g derived independently from the sphere-vs-paraboloid sag
 *    difference and pinned through the Schmidt corrector. It fixes the SCALE
 *    (the 1/8, the sign convention, the n′ = −n mirror handling).
 *  - **The thin lens in air**, whose third-order spherical aberration has a
 *    published closed form in Coddington's shape factor q = (c₁+c₂)/(c₁−c₂) and
 *    position factor p (Jenkins & White, *Fundamentals of Optics*; Hecht,
 *    *Optics* § 6.3), with p = −1 for an object at infinity:
 *
 *        W₀₄₀ = h⁴/(32·f³·n(n−1)) · [ (n+2)/(n−1)·q² + 4(n+1)·p·q
 *                                     + (3n+2)(n−1)·p² + n³/(n−1) ]
 *
 *    The sums reproduce this to 1e-8 across the shape range at two indices — the
 *    whole polynomial and its absolute scale, not one evaluation — and the
 *    residual falls linearly with the element's centre thickness, i.e. what is
 *    left is the honest thick-lens correction. Its corollaries come free: the
 *    best-form minimum at q = 2(n²−1)/(n+2) ≈ 0.71 at n = 1.5 (the steeply
 *    curved face toward the collimated beam), and a plano-convex singlet turned
 *    back-to-front carrying 27/7 ≈ 3.86× the spherical aberration.
 *
 * ## The object may be at a finite distance (the position factor)
 *
 * The marginal ray's launch is the *only* thing an object conjugate changes: it
 * enters surface 0 at height h with slope u = h/s instead of u = 0. Everything
 * after that — A, Ā, Δ(u/n), the sums — is untouched, because the recursion was
 * never told where the ray came from. So `objectDistanceMm` is one extra term at
 * the start of the loop, and omitting it leaves every existing caller's numbers
 * bit-for-bit unchanged.
 *
 * It is not a cosmetic generalisation. The published thin-lens bracket above
 * carries a **position factor** p alongside the shape factor q, and the p = −1
 * the infinite-conjugate case pins is one point on it:
 *
 *     p = 1 − 2f/s′        (−1 at infinity, 0 at s = s′ = 2f, → 1 as s → f)
 *
 * The p² and p·q terms are what a finite conjugate switches on, and they are
 * large: a doublet whose bending nulls S_I at p = −1 does not null it at
 * p = +0.6, which is where a 4× microscope objective on a 150 mm optical tube
 * actually works. That is the whole reason `designs/microscope`'s DIN objective
 * cannot reuse the infinity-solved bending (§ 6b), and it is pinned here — the
 * bracket across p, and its corollary that the best-form shape itself moves,
 *
 *     q_best(p) = −2(n²−1)·p/(n+2)
 *
 * whose p = −1 case is the classical best-form minimum already pinned above.
 *
 * SCOPE, deliberately narrow — this module does one job for one caller:
 *
 *  - **Spherical surfaces only.** A conic or an even asphere adds its own
 *    third-order term, which is a *different* closed form; rather than carry an
 *    unpinned one, a non-zero conic or asphere throws. (The aspheric presets do
 *    not need this module: §§ 5g–5i figure their correctors from the sag
 *    difference directly.)
 *  - **Every off-axis sum needs a stop surface**, and since § 6cm that stop may
 *    sit anywhere in the chain. At surface 0 the chief ray is simply (ȳ = 0,
 *    ū = θ) and nothing is solved. Anywhere else it is the ray that reaches the
 *    stop's vertex on the axis, and finding it is a two-unknown LINEAR problem,
 *    not a search: the paraxial recursion is linear in the launch, so
 *
 *        ȳ_k = α·ȳ₀ + β·ū₀      α = ȳ_k of (1, 0),  β = ȳ_k of (0, 1)
 *
 *    and two trial traces give the closed form outright. With a finite object ū
 *    is still the chief ray's slope in object space, which is an object height
 *    η = −ū·s rather than a field angle; the formula does not care, but the
 *    caller's units do, and it is η — not the slope — that is held fixed when the
 *    stop moves, because that is what "the same field point" means.
 *
 *    Lifting that restriction is what makes the **stop shift** a capability here
 *    rather than an identity the caller writes out. Welford's equations move a
 *    whole set of sums to a displaced stop,
 *
 *        S_I*   = S_I                          S_IV*  = S_IV
 *        S_II*  = S_II + E·S_I
 *        S_III* = S_III + 2E·S_II + E²·S_I
 *        S_V*   = S_V + E(3·S_III + S_IV) + 3E²·S_II + E³·S_I
 *
 *    with E = Δ(Ā/A) the eccentricity of the shift, one number for the whole
 *    system. They deliberately stay in the TEST (§ 6cm) and not here: computed on
 *    both sides they would be a same-process identity, and what pins the solve is
 *    that two machineries — a chief ray traced to the new stop, and a published
 *    polynomial in E applied to the old sums — agree while sharing no line.
 *  - **S_V is opt-in** (`distortion: true`) and the others are not, because the
 *    classical per-surface distortion term divides by A. On a surface the
 *    marginal ray crosses undeviated — a flat in a collimated beam, which the
 *    coverslip and window presets contain — A is exactly 0, and so is the
 *    bracket it divides: A = 0 forces u = −y·c, hence Δ(u/n) = −y·c·Δ(1/n) and
 *    Ā·y = H, which makes S_III + S_IV = c·Δ(1/n)·(Ā²y² − H²) vanish identically.
 *    So the term is a true 0/0 whose limit needs L'Hôpital on the pair, and an
 *    unpinned limit is worse than an absent one. Rather than guess it, or make
 *    every existing caller newly throwable, `distortion` is a flag: a caller that
 *    does not ask keeps today's behaviour bit for bit, and one that asks on such
 *    a system is refused out loud.
 *
 * ## The field sums have their own anchor, and it is shape-independent
 *
 * S_III and S_IV are pinned on the same thin lens as S_I, and the anchor is
 * stronger than the S_I one in a specific way: for a thin lens with **the stop in
 * contact**, third-order theory gives (Kingslake, *Lens Design Fundamentals*,
 * ch. 6; Welford ch. 8)
 *
 *     S_III = H²·φ            S_IV = H²·Σ(φₖ/nₖ)        S_V = 0
 *
 * — with no shape factor in them at all. Astigmatism and Petzval curvature at a
 * stop in contact depend only on the POWER and the glass, so bending the lens
 * cannot touch them, and a q-scan that leaves S_I ranging over a factor of four
 * must leave these two numerically fixed. That is a much sharper test than
 * matching one number: an error in Ā, in H, or in the Δ(1/n) of the S_IV term
 * would almost certainly show up as a spurious shape dependence.
 *
 * The S_V = 0 of the same case is the reason distortion is opt-in rather than
 * absent: it is a published zero, so it can be pinned (the sum vanishes to the
 * f64 floor while its individual surfaces do not), and it is the one distortion
 * claim reachable without stop-shift equations.
 */

export interface SeidelOptions {
  /**
   * Marginal ray height at the FIRST SURFACE (mm). Exactly one of this and
   * `marginalRadiusAtStopMm` must be given.
   */
  readonly marginalHeightMm?: number;
  /**
   * Marginal ray height at the STOP (mm) — the aperture the stop actually
   * defines, which is the only natural way to state it once the stop is allowed
   * off surface 0. It is scaled to a first-surface height here, against this
   * module's own surface list and its own stop index, so that a caller cannot
   * pair a radius measured at one index with a chief ray solved at another. That
   * pairing is not hypothetical: `analysis/field` reads its radius off
   * `pupils()`, which compiles the prescription by a different route. With the
   * stop at surface 0 the scale is exactly 1 and the two spellings coincide bit
   * for bit.
   */
  readonly marginalRadiusAtStopMm?: number;
  /**
   * Field angle for the chief ray (radians). 0 (default) leaves S_II identically
   * zero, which is the on-axis truth, not a missing value.
   */
  readonly fieldAngleRad?: number;
  /**
   * Axial object distance in front of surface 0 (mm, positive). Omitted — the
   * default — the object is at infinity and the marginal ray enters collimated,
   * which is what every pre-§ 6b caller means and what leaves their numbers
   * untouched. Given, the marginal ray leaves the axial object point and reaches
   * surface 0 at `marginalHeightMm` with slope u = h/s.
   */
  readonly objectDistanceMm?: number;
  /**
   * Compute Σ S_V (distortion) as well. Off by default, and the reason is the
   * A = 0 singularity in the header's scope note rather than cost: a surface the
   * marginal ray crosses undeviated makes the classical term 0/0, and this flag
   * keeps that refusal away from every caller that never asked for distortion.
   */
  readonly distortion?: boolean;
}

export interface SeidelSurfaceTerms {
  /**
   * The marginal refraction invariant A = n(y·c + u) at this surface, and the
   * chief-ray Ā beside it. Reported because the stop-shift eccentricity is
   * E = Δ(Ā/A) and it is *constant across the system* — a claim every text makes
   * in prose and that nothing here could check while the stop was pinned to
   * surface 0. With these two out, § 6cm measures it surface by surface.
   */
  readonly a: number;
  readonly ab: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
  readonly s4: number;
  /** Present only when `distortion` was asked for. */
  readonly s5?: number;
}

export interface SeidelResult {
  /** Σ S_I — third-order spherical aberration (mm). */
  readonly s1: number;
  /** Σ S_II — third-order coma (mm), zero unless a field angle was given. */
  readonly s2: number;
  /** Σ S_III — third-order astigmatism (mm), zero unless a field angle was given. */
  readonly s3: number;
  /**
   * Σ S_IV — the Petzval sum (mm), zero unless a field angle was given. This is
   * the field curvature that survives when astigmatism is nulled, and it is the
   * one sum that depends on no ray heights at all: −H²·Σc·Δ(1/n) is fixed by the
   * powers and the glasses.
   */
  readonly s4: number;
  /** Σ S_V — third-order distortion (mm). Present only with `distortion: true`. */
  readonly s5?: number;
  /** Wavefront spherical-aberration coefficient W₀₄₀ = S_I/8 (mm). */
  readonly w040: number;
  /**
   * The Lagrange invariant H = n(ū·y − u·ȳ), evaluated at the first surface
   * (mm·rad). Zero on axis. Reported because every field sum scales as H² and a
   * caller converting a sum into a focal-surface sag needs the same H the sums
   * were built with.
   */
  readonly lagrangeInvariant: number;
  /**
   * The marginal ray height at the first surface that the sums were actually
   * built on (mm). Equal to `marginalHeightMm` when that was given; the solved
   * value when `marginalRadiusAtStopMm` was, which is what a caller needs to
   * trace the same marginal ray itself.
   */
  readonly marginalHeightMm: number;
  /**
   * The chief ray's launch at the first surface — (ȳ₀, ū₀). Both are zero on
   * axis and (0, θ) with the stop at surface 0; off it they are the solve's
   * answer, and reporting them is what lets a rung check the SOLVE against a
   * known pupil position rather than only its downstream sums. An object-space
   * telecentric system, for instance, is exactly ū₀ = 0.
   */
  readonly chiefHeightMm: number;
  readonly chiefSlopeRad: number;
  /** Per-surface contributions, in prescription order. */
  readonly surfaces: readonly SeidelSurfaceTerms[];
}

/**
 * Per-surface constants of the paraxial recursion, resolved once up front.
 *
 * The sums and the two trial traces that solve the chief ray read the SAME
 * array, which is the point: a chief ray found for the stop's plane cannot
 * disagree with the sums about which glass sits where, or about which side of a
 * mirror the light is on. Hoisting also fixes the order the medium lookups
 * happen in, and none of the expressions below moved, so every pre-§ 6cm
 * caller's arithmetic is unchanged to the last bit.
 */
interface SeidelStep {
  /** Index in the space before the surface. */
  readonly n: number;
  /** Index after it — negated at a mirror, which is how the recursion folds. */
  readonly n2: number;
  readonly c: number;
  /** Surface power, c·(n′ − n). */
  readonly phi: number;
  /** Gap to the next vertex. */
  readonly thickness: number;
}

export function seidelSums(
  prescriptionIn: Prescription,
  wavelengthNm: number,
  opts: SeidelOptions,
): SeidelResult {
  const prescription = unfoldedTwin(prescriptionIn);
  const { marginalRadiusAtStopMm, fieldAngleRad = 0, objectDistanceMm, distortion = false } = opts;
  if ((opts.marginalHeightMm === undefined) === (marginalRadiusAtStopMm === undefined)) {
    throw new Error("seidelSums: give exactly one of marginalHeightMm and marginalRadiusAtStopMm");
  }
  const statedHeightMm = marginalRadiusAtStopMm ?? opts.marginalHeightMm!;
  if (!(statedHeightMm > 0)) {
    throw new Error("seidelSums: marginal ray height must be positive");
  }
  if (objectDistanceMm !== undefined && !(objectDistanceMm > 0 && Number.isFinite(objectDistanceMm))) {
    throw new Error("seidelSums: objectDistanceMm must be a positive finite distance (omit it for infinity)");
  }

  const objectIndex = getMedium(prescription.objectMedium ?? "AIR").n(wavelengthNm);
  const steps: SeidelStep[] = [];
  {
    let n = objectIndex;
    for (const s of prescription.surfaces) {
      if ((s.conic ?? 0) !== 0 || (s.asphereCoeffs?.length ?? 0) > 0) {
        throw new Error("seidelSums: spherical surfaces only (a conic/asphere adds an uncomputed term)");
      }
      let n2: number;
      if (s.kind === "reflect") {
        n2 = -n;
      } else {
        if (!s.medium) throw new Error("seidelSums: refract surface needs a medium");
        n2 = Math.sign(n) * getMedium(s.medium).n(wavelengthNm);
      }
      steps.push({ n, n2, c: s.curvature, phi: s.curvature * (n2 - n), thickness: s.thickness });
      n = n2;
    }
  }

  /**
   * Height at surface k's vertex of the paraxial ray entering surface 0 at
   * (y₀, u₀) — the same refract-then-transfer recursion the main loop runs,
   * driven off the same `steps`, and stopping short of surface k's own power.
   */
  const heightAt = (k: number, y0: number, u0: number): number => {
    let y = y0;
    let u = u0;
    for (let i = 0; i < k; i++) {
      const st = steps[i]!;
      u = (st.n * u - y * st.phi) / st.n2;
      y = y + u * st.thickness;
    }
    return y;
  };

  const stopIndex = prescription.surfaces.findIndex((s) => s.isStop);
  if (stopIndex < 0 && (fieldAngleRad !== 0 || marginalRadiusAtStopMm !== undefined)) {
    throw new Error(
      "seidelSums: no surface is flagged isStop, and both the chief ray and a stop radius need one",
    );
  }

  // The marginal ray, entering at the pupil edge. Collimated for an object at
  // infinity; from the axial object point at distance s it arrives with the
  // slope h/s that carried it there.
  let marginalHeightMm: number;
  if (marginalRadiusAtStopMm === undefined) {
    marginalHeightMm = opts.marginalHeightMm!;
  } else {
    // Linear again, so one trial trace converts a radius at the stop into the
    // first-surface height that produces it — exactly 1 when the stop IS the
    // first surface, which is why this spelling costs the old callers nothing.
    // |scale| because a marginal ray that has already crossed the axis fills the
    // stop from the other side, and the aperture is still a radius.
    const scale = Math.abs(heightAt(stopIndex, 1, objectDistanceMm === undefined ? 0 : 1 / objectDistanceMm));
    if (!(scale > 0) || !Number.isFinite(scale)) {
      throw new Error(
        "seidelSums: the marginal ray crosses the axis at the stop, so no first-surface height fills it",
      );
    }
    marginalHeightMm = marginalRadiusAtStopMm / scale;
  }
  let y = marginalHeightMm;
  let u = objectDistanceMm === undefined ? 0 : marginalHeightMm / objectDistanceMm;
  // Chief ray: through the centre of the stop. With the stop at surface 0 that
  // is the launch itself, and there is nothing to solve.
  let yb = 0;
  let ub = fieldAngleRad;
  if (fieldAngleRad !== 0 && stopIndex !== 0) {
    // ȳ_k = α·ȳ₀ + β·ū₀, so two trial rays give α and β exactly. The branch
    // above is this same algebra evaluated rather than a different rule: at
    // k = 0, α = 1 and β = 0, which give ū₀ = θ and ȳ₀ = 0 on both paths. It is
    // written out separately only so that the finite-conjugate case stays bit
    // for bit what it was — (θ·s)/s is not θ in f64.
    const alpha = heightAt(stopIndex, 1, 0);
    const beta = heightAt(stopIndex, 0, 1);
    if (objectDistanceMm === undefined) {
      yb = (-beta * ub) / alpha;
      if (!Number.isFinite(yb)) {
        throw new Error(
          "seidelSums: the stop sits at the rear focal plane of the surfaces ahead of it, so the " +
            "entrance pupil is at infinity — an infinite-conjugate chief ray has no finite height " +
            "at the first surface (give objectDistanceMm, where this placement is merely telecentric)",
        );
      }
    } else {
      // A finite object's field is an OBJECT HEIGHT, η = −θ·s — the reading the
      // stop-at-0 case already had — and it is η that must be held while the stop
      // moves, since holding the slope instead would move the field point.
      const eta = -fieldAngleRad * objectDistanceMm;
      ub = (-alpha * eta) / (alpha * objectDistanceMm + beta);
      yb = eta + ub * objectDistanceMm;
      if (!Number.isFinite(ub) || !Number.isFinite(yb)) {
        throw new Error(
          "seidelSums: the stop lies at an image of the object plane, so no chief ray from an " +
            "off-axis object point passes through its centre",
        );
      }
    }
  }

  // The Lagrange invariant, at the first surface. With the stop there ȳ = 0, so
  // this is n·ū·y — but it is written in full because it is the quantity the
  // recursion below must keep constant, not a special case of it, and off
  // surface 0 both of its terms are live.
  const lagrangeInvariant = objectIndex * (ub * y - u * yb);
  const chiefHeightMm = yb;
  const chiefSlopeRad = ub;

  const surfaces: SeidelSurfaceTerms[] = [];
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let s5 = 0;

  for (const st of steps) {
    const { n, n2, c, phi } = st;

    const A = n * (y * c + u);
    const Ab = n * (yb * c + ub);
    const u2 = (n * u - y * phi) / n2;
    const ub2 = (n * ub - yb * phi) / n2;
    const dun = u2 / n2 - u / n;

    const termS1 = -A * A * y * dun;
    const termS2 = -A * Ab * y * dun;
    const termS3 = -Ab * Ab * y * dun;
    const termS4 = -lagrangeInvariant * lagrangeInvariant * c * (1 / n2 - 1 / n);
    let termS5: number | undefined;
    if (distortion) {
      if (A === 0) {
        throw new Error(
          "seidelSums: distortion is singular at a surface the marginal ray crosses " +
            "undeviated (A = 0) — the classical S_V term is 0/0 there",
        );
      }
      termS5 = (Ab / A) * (termS3 + termS4);
      s5 += termS5;
    }
    surfaces.push({
      a: A,
      ab: Ab,
      s1: termS1,
      s2: termS2,
      s3: termS3,
      s4: termS4,
      ...(termS5 === undefined ? {} : { s5: termS5 }),
    });
    s1 += termS1;
    s2 += termS2;
    s3 += termS3;
    s4 += termS4;

    // Transfer to the next vertex.
    y = y + u2 * st.thickness;
    yb = yb + ub2 * st.thickness;
    u = u2;
    ub = ub2;
  }

  return {
    s1,
    s2,
    s3,
    s4,
    ...(distortion ? { s5 } : {}),
    w040: s1 / 8,
    lagrangeInvariant,
    marginalHeightMm,
    chiefHeightMm,
    chiefSlopeRad,
    surfaces,
  };
}
