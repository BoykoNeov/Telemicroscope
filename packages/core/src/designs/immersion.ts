import { Prescription, SurfaceSpec } from "../trace/prescription";
import { spliceModules } from "../trace/compose";
import { systemProperties } from "../trace/paraxial";
import { traceRay } from "../trace/sequential";
import { makeRay } from "../trace/ray";
import { vec3 } from "../math/vec3";
import { getMedium } from "../materials/catalog";
import { LINE_D } from "../materials/dispersion";
import { Coverslip, CoverslipSpec, PlaneLayer, coverslip, coverslipSurface } from "./coverslip";
import { GroupOrientation, ListerObjective, listerObjective } from "./lister";
import {
  DEFAULT_TUBE_FOCAL_LENGTH_MM,
  InfinityCorrectedObjective,
} from "./microscope";

/**
 * The aplanatic front — how an objective gets past NA 0.35.
 *
 * ## The wall this exists to climb
 *
 * § 6d measured a ceiling and measured it twice: two cemented doublets solved
 * jointly for ΣS_I = ΣS_II = 0 stop *existing* near NA 0.343 with N-BK7/F2 and
 * near 0.383 with fused silica/F2. Two glass pairs walling out together makes it
 * a statement about the FORM, so the answer is not a better doublet. It is to put
 * something in front that reduces the aperture **without adding aberration** —
 * and there is exactly one way for a spherical surface to do that.
 *
 * ## The Weierstrass points, used rather than admired
 *
 * § 6d.1 pinned the closed form and no design consumed it: a spherical surface of
 * radius R between n₁ and n₂ is EXACTLY stigmatic, to all orders and satisfying
 * the sine condition, for the one conjugate pair
 *
 *     u = R(n₁+n₂)/n₁      v = R(n₁+n₂)/n₂      m = n₁²/n₂²
 *
 * measured from the vertex, with the image virtual. Two elements are built on it
 * here, and the difference between them is which stigmatic pair of the sphere
 * each surface uses:
 *
 *  - **The hyperhemisphere.** One dome, worked at the Weierstrass pair with the
 *    specimen inside the dense medium. The object-space aperture n·sinu is
 *    divided by n² and the image is magnified by n² — the single biggest step
 *    available from one surface, and the reason an immersion front element is a
 *    ball rather than a lens.
 *  - **The aplanatic meniscus.** Two surfaces. The first is CONCENTRIC about the
 *    incoming (virtual) object point, so every ray meets it at normal incidence
 *    and it bends nothing at all — its only job is to let glass exist there. The
 *    second is the Weierstrass surface of that same point, now inside the glass.
 *    A meniscus divides the aperture *angle* by n and magnifies by n.
 *
 * Neither is an approximation and neither is a third-order design. They are exact
 * to all orders, which is precisely why they can be stacked: NA 1.25 through a
 * dome and two menisci comes out at 0.232, comfortably inside the 0.343 § 6d
 * measured — the previous step's ceiling is this step's budget.
 *
 * ## The concentric surface is not a Weierstrass surface
 *
 * A sphere has THREE stigmatic conjugate pairs, and only the middle one is
 * interesting: object at the centre (concentric — perfect, but no bending and no
 * change of aperture), object at the vertex (trivial), and the Weierstrass pair
 * (perfect, and the aperture changes). The meniscus uses the first and the third,
 * one per surface. Conflating them costs the whole design, because the concentric
 * surface's magnification is n₁/n₂ and the Weierstrass surface's is n₁²/n₂² — so
 * a meniscus in air is m = (1/n)·n² = n, not n².
 *
 * ## What the specimen looks out through, and where it has to sit
 *
 * Between the specimen and the dome there is a plane STACK — cover glass, fluid
 * film, the element's own flat underside — and § 6e.1 solved it exactly. Its
 * paraxial half is all that is needed to *place* the specimen: each layer is seen
 * through its own reduced thickness, so the Weierstrass distance is matched in
 * apparent terms,
 *
 *     n_glass · Σᵢ tᵢ/nᵢ  =  u  =  R(n_glass+1)/n_glass
 *
 * and the element's thickness is what closes it. The residual is then honestly
 * whatever § 6e.1 says the stack's index mismatch costs — nothing here pretends
 * it away, and with a matched stack it is an exact zero rather than a small one.
 *
 * ## The aperture stop, and § 6a's blocker closed
 *
 * § 6a recorded that its stop rule "is a tangent and is 2.6× out at NA 1.4". The
 * diagnosis was half right. A tangent is not an approximation *at a plane face* —
 * a ray leaving the specimen at θ and crossing t of medium lands at exactly
 * t·tanθ, to all orders. What was 2.6× out was using the sine-condition height
 * f·sinu as though it were a stop radius, which it never was (§ 6a's own finding,
 * at 2% for a 4×/0.10 and at 2.6× by NA 1.4).
 *
 * Here the stop sits on surface 0 — the first plane face of the stack — and its
 * radius is the exact plane-layer sum
 *
 *     r = Σᵢ tᵢ·tanθᵢ = Σᵢ tᵢ·q/√(nᵢ²−q²),     q = NA
 *
 * over the layers *before* it. No solve, no seed, no small-angle form, and no
 * ceiling: it is exact at NA 1.4 for the same reason it is exact at NA 0.01.
 *
 * ## Honest limits
 *
 * The aperture reduction is exact **on axis**. These elements are aplanatic, so
 * they are also coma-free to the extent the sine condition governs, but nothing
 * here computes astigmatism or field curvature — `analysis/seidel`'s scope, and
 * § 6d's open item, inherited. Telecentricity is still § 6a's deferral: the stop
 * is on the front face rather than at the back focal plane, which changes no
 * axial property and no magnification, only the chief-ray angle.
 */

/** Cargille Type B, the ISO 8036 standard fluid (§ 1). */
export const IMMERSION_MEDIUM = "IMMERSION-OIL";

/**
 * The front element's glass. D 263 T eco — the COVER GLASS's own borosilicate,
 * not the oil's index, and the choice is measured rather than inherited: § 6e.1
 * found that matching the front element to the slip beats matching it to the
 * fluid by 6.5×, because the slip is 0.17 mm and the film is 0.02 mm. It is
 * bounded at 6.5× and not more, since moving onto the slip moves off the oil.
 */
export const FRONT_ELEMENT_MEDIUM = "D263";

/** Exact ray height at the exit of a stack of plane layers, for invariant q. */
export function planeLayerHeightMm(layers: readonly PlaneLayer[], q: number): number {
  let h = 0;
  for (const l of layers) {
    if (q >= l.n) {
      throw new Error(
        `planeLayerHeightMm: q = ${q} exceeds a layer index of ${l.n} — the ray never leaves that layer`,
      );
    }
    h += (l.thicknessMm * q) / Math.sqrt(l.n * l.n - q * q);
  }
  return h;
}

export interface HyperhemisphereSpec {
  /** Object-space numerical aperture n·sinu the element must accept. */
  readonly numericalAperture: number;
  /** Dome radius magnitude (mm) — the element's whole scale. */
  readonly radiusMm: number;
  /** Front element glass. Default D 263 — see `FRONT_ELEMENT_MEDIUM`. */
  readonly glassMedium?: string;
  /** Immersion fluid. Default Cargille Type B. */
  readonly immersionMedium?: string;
  /** The cover glass. Pass `null` for a specimen sitting bare in the fluid. */
  readonly coverslipSpec?: CoverslipSpec | null;
  /** Fluid film thickness (mm). Default 0.02. Stated, not solved. */
  readonly immersionGapMm?: number;
  readonly designWavelengthNm?: number;
  /** Glass semi-aperture as a multiple of the traced marginal height. Default 1.15. */
  readonly glassMarginFactor?: number;
}

/**
 * The smallest dome radius the stack in front of it permits (mm).
 *
 * The marginal ray meets the dome a distance R(1−cosφ) below its vertex, where
 * φ = θ + arcsin(sinθ/n) is the same angle the rim fraction uses. The element's
 * flat face has to sit below that, and the thickness is whatever the stack's
 * apparent depth leaves over, so
 *
 *     R · [ (n+1)/n − (1−cosφ) ]  >  n · Σᵢ tᵢ/nᵢ
 *
 * **This is why an immersion front group is COMPACT.** A cover slip's apparent
 * depth is a fixed length that does not scale with the design, so it puts a floor
 * under the dome; the rest of the group then has to be short enough that a dome
 * that big still lands its virtual image where the rear group wants it. It is
 * also the ceiling on the whole form — the bracket goes to zero as φ → 180°, so
 * past some aperture no dome is deep enough at any radius.
 *
 * Exported because it is the constraint a caller has to design against, and
 * because a rung should be able to check the closed form against the radius at
 * which the constructor actually starts refusing.
 */
export function minimumDomeRadiusMm(spec: Omit<HyperhemisphereSpec, "radiusMm">): number {
  const NA = spec.numericalAperture;
  const wavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const nGlass = getMedium(spec.glassMedium ?? FRONT_ELEMENT_MEDIUM).n(wavelengthNm);
  const nFluid = getMedium(spec.immersionMedium ?? IMMERSION_MEDIUM).n(wavelengthNm);
  const gap = spec.immersionGapMm ?? 0.02;
  const slip = spec.coverslipSpec === null ? null : coverslip(spec.coverslipSpec ?? {});
  const reducedAhead =
    (slip ? slip.thicknessMm / getMedium(slip.medium).n(wavelengthNm) : 0) + gap / nFluid;
  const theta = Math.asin(NA / nGlass);
  const phi = theta + Math.asin(Math.sin(theta) / nGlass);
  const depthFactor = (nGlass + 1) / nGlass - (1 - Math.cos(phi));
  if (!(depthFactor > 0)) return Infinity;
  return (nGlass * reducedAhead) / depthFactor;
}

export interface Hyperhemisphere {
  /** Authored specimen-side first, trailing thickness 0. Stop on surface 0. */
  readonly prescription: Prescription;
  /** Specimen → surface 0's vertex (mm) — a slip thickness, or the fluid film. */
  readonly objectDistanceMm: number;
  /** Aperture stop semi-diameter (mm): the exact plane-layer sum, see the header. */
  readonly stopRadiusMm: number;
  /** The in-glass Weierstrass distance u = R(n+1)/n (mm), dome vertex → object. */
  readonly weierstrassDistanceMm: number;
  /** Dome vertex → the VIRTUAL image, in front of it (mm): v = R(n+1). */
  readonly virtualImageDistanceMm: number;
  /** Solved element thickness, flat face → dome vertex (mm). */
  readonly thicknessMm: number;
  /** Specimen → the element's flat underside (mm) — the free working distance. */
  readonly workingDistanceMm: number;
  readonly domeRadiusMm: number;
  /**
   * Where the marginal ray meets the dome, as a fraction of R — how much of the
   * sphere the design is using. Scale-FREE: the geometry gives
   *
   *     h/R = sin(θ + arcsin(sinθ/n)),     sinθ = NA/n
   *
   * which has no R in it, so a bigger dome does not buy rim margin. It peaks at
   * 1 when θ + arcsin(sinθ/n) = 90° — near NA 1.275 for n = 1.5233 — where the
   * marginal ray grazes the equator exactly and no hyperhemisphere of ANY radius
   * has room to spare. That is a real property of the form, and the reason a
   * high-NA front element is a ball cut past its own equator.
   */
  readonly rimUtilisation: number;
  /**
   * The smallest dome radius the stack in front of it permits (mm):
   *
   *     R_min = n·Σᵢtᵢ/nᵢ / [ (n+1)/n − (1−cosφ) ],    φ = θ + arcsin(sinθ/n)
   *
   * The marginal ray meets the dome R(1−cosφ) below its vertex, and the flat
   * face must sit below *that*; the thickness is whatever the stack's apparent
   * depth leaves over, so a fixed slip thickness becomes a floor on R. It is the
   * reason an immersion front group has to be compact — see the module header.
   */
  readonly minimumRadiusMm: number;
  /** Transverse magnification n²/1 — and the factor the aperture is divided by. */
  readonly magnification: number;
  /** Emergent marginal sine in air: NA/n². */
  readonly emergentSine: number;
  /** The plane stack the specimen looks out through, § 6e.1's layers. */
  readonly stack: readonly PlaneLayer[];
  readonly coverslip: Coverslip | null;
  readonly immersionGapMm: number;
  readonly glassIndex: number;
  readonly numericalAperture: number;
  readonly designWavelengthNm: number;
}

/** Marginal-ray heights at every surface, or null if the ray does not survive. */
function marginalHeights(
  p: Prescription,
  objectDistanceMm: number,
  q: number,
  wavelengthNm: number,
): number[] | null {
  const n0 = getMedium(p.objectMedium ?? "AIR").n(wavelengthNm);
  const sin = q / n0;
  if (!(sin < 1)) return null;
  const res = traceRay(
    p,
    makeRay(vec3(0, 0, -objectDistanceMm), vec3(sin, 0, Math.sqrt(1 - sin * sin)), wavelengthNm),
  );
  if (res.status !== "ok") return null;
  return res.path.map((v) => Math.hypot(v.x, v.y));
}

/**
 * The aplanatic hyperhemisphere: a dome worked at its Weierstrass conjugates,
 * with the specimen placed through the immersion stack in front of it.
 *
 * Divides the object-space numerical aperture by n² and magnifies by n², both
 * exactly and to all orders — the single largest aperture reduction one surface
 * can perform without aberration.
 */
export function hyperhemisphere(spec: HyperhemisphereSpec): Hyperhemisphere {
  const NA = spec.numericalAperture;
  const R = spec.radiusMm;
  if (!(NA > 0)) throw new Error("hyperhemisphere: NA must be positive");
  if (!(R > 0)) throw new Error("hyperhemisphere: give the dome radius as a positive magnitude");
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const glassMedium = spec.glassMedium ?? FRONT_ELEMENT_MEDIUM;
  const immersionMedium = spec.immersionMedium ?? IMMERSION_MEDIUM;
  const immersionGapMm = spec.immersionGapMm ?? 0.02;
  const margin = spec.glassMarginFactor ?? 1.15;
  if (!(immersionGapMm > 0)) throw new Error("hyperhemisphere: the fluid film must be positive");

  const slip =
    spec.coverslipSpec === null ? null : coverslip(spec.coverslipSpec ?? {});
  const nGlass = getMedium(glassMedium).n(designWavelengthNm);
  const nFluid = getMedium(immersionMedium).n(designWavelengthNm);
  const nSlip = slip ? getMedium(slip.medium).n(designWavelengthNm) : null;

  // The aperture an immersion chain can carry is set by its RAREST medium: q is
  // conserved across every plane face, so a ray with q ≥ nᵢ never leaves layer i.
  // This is the physical ceiling on NA, and it is not the front element's glass.
  const rarest = Math.min(nGlass, nFluid, ...(nSlip === null ? [] : [nSlip]));
  if (NA >= rarest) {
    throw new Error(
      `hyperhemisphere: NA ${NA} is not carried by this chain — its rarest medium has n = ${rarest.toFixed(4)}, and q ≥ n total-internal-reflects`,
    );
  }

  // Weierstrass, in the glass, measured from the dome's vertex.
  const weierstrassDistanceMm = (R * (nGlass + 1)) / nGlass;
  const virtualImageDistanceMm = R * (nGlass + 1);

  // Place the specimen by matching APPARENT distance: each plane layer is seen
  // through its own reduced thickness (§ 6e.1's paraxial half), so
  //   n_glass·(t_slip/n_slip + gap/n_fluid + t_glass/n_glass) = u
  // and the element's thickness is the unknown that closes it.
  const reducedAhead =
    (slip ? slip.thicknessMm / nSlip! : 0) + immersionGapMm / nFluid;
  const thicknessMm = weierstrassDistanceMm - nGlass * reducedAhead;
  if (!(thicknessMm > 0)) {
    throw new Error(
      `hyperhemisphere: the stack is deeper than the Weierstrass distance (${(nGlass * reducedAhead).toFixed(4)} mm apparent against u = ${weierstrassDistanceMm.toFixed(4)} mm) — the element would have negative thickness. Use a larger dome radius.`,
    );
  }

  // The dome must be DEEP ENOUGH: the marginal ray meets it a distance
  // R(1−cosφ) below the vertex, where φ = θ + arcsin(sinθ/n) is the same angle
  // the rim fraction uses, and the flat face has to sit below that or the ray
  // leaves the glass before it ever reaches the dome. Since the thickness is
  // whatever the stack's apparent depth leaves over, that is a floor on R:
  //
  //     R · [ (n+1)/n − (1−cosφ) ]  >  n·Σᵢ tᵢ/nᵢ      (over the layers ahead)
  //
  // This is why an immersion front group is COMPACT. A cover slip's apparent
  // depth is a fixed length that does not scale with the design, so it demands a
  // minimum dome, and the rest of the group has to be short enough to let a dome
  // that big still land its virtual image where the rear group wants it.
  const minimumRadiusMm = minimumDomeRadiusMm(spec);
  if (!Number.isFinite(minimumRadiusMm)) {
    throw new Error(
      `hyperhemisphere: at NA ${NA} the marginal ray meets the dome deeper than the Weierstrass point itself — no element of this glass carries it at any radius`,
    );
  }
  if (!(R > minimumRadiusMm)) {
    throw new Error(
      `hyperhemisphere: a dome of radius ${R} is too shallow for the stack in front of it — the marginal ray would leave the glass before reaching the dome. The apparent depth of ${(nGlass * reducedAhead).toFixed(4)} mm needs R > ${minimumRadiusMm.toFixed(4)} mm at NA ${NA}.`,
    );
  }

  const stack: readonly PlaneLayer[] = [
    ...(slip ? [{ thicknessMm: slip.thicknessMm, n: nSlip! }] : []),
    { thicknessMm: immersionGapMm, n: nFluid },
    { thicknessMm, n: nGlass },
  ];

  const objectDistanceMm = slip ? slip.thicknessMm : immersionGapMm;
  // Exact, at a plane face: the layers BEFORE surface 0. With a slip that is the
  // slip alone; without one, surface 0 is the element's flat face and the fluid
  // film is what precedes it.
  const stopRadiusMm = planeLayerHeightMm(
    slip ? [{ thicknessMm: slip.thicknessMm, n: nSlip! }] : [{ thicknessMm: immersionGapMm, n: nFluid }],
    NA,
  );

  const dome = (semiAperture: number): SurfaceSpec => ({
    kind: "refract",
    // Centre of curvature toward the specimen — the dome a real object inside
    // the glass looks out through. Getting this sign backwards builds a
    // plausible NON-aplanatic surface (§ 6d.1's measured warning).
    curvature: -1 / R,
    semiAperture,
    thickness: 0,
    medium: "AIR",
  });
  const build = (semis: readonly number[]): Prescription => {
    const surfaces: SurfaceSpec[] = [];
    if (slip) {
      surfaces.push({
        ...coverslipSurface(immersionGapMm, immersionMedium),
        semiAperture: semis[0]!,
        isStop: true,
      });
    }
    surfaces.push({
      kind: "refract",
      curvature: 0,
      semiAperture: semis[surfaces.length]!,
      thickness: thicknessMm,
      medium: glassMedium,
      ...(slip ? {} : { isStop: true }),
    });
    surfaces.push(dome(semis[surfaces.length]!));
    return { objectMedium: slip ? slip.medium : immersionMedium, surfaces };
  };

  // Size the glass from the TRACE, as § 6d does: nothing here knows in closed
  // form where a ray at NA 1.4 meets a dome, and a formula for it would be a
  // second implementation of the intersection the tracer already does.
  const open = build([Infinity, Infinity, Infinity]);
  const heights = marginalHeights(open, objectDistanceMm, NA, designWavelengthNm);
  if (!heights) {
    throw new Error(
      `hyperhemisphere: the marginal ray at NA ${NA} does not survive this geometry — the dome radius is too small for the stack in front of it`,
    );
  }
  // The dome cannot be wider than its own sphere: a semi-aperture past R is not
  // a rim, it is a different surface. So the margin is advisory on the dome and
  // the equator is the hard cap.
  const semis = heights.map((h, i) =>
    i === heights.length - 1 ? Math.min(margin * h, R) : margin * h,
  );
  const domeHeight = heights[heights.length - 1]!;
  if (!(domeHeight < R)) {
    throw new Error(
      `hyperhemisphere: the marginal ray meets the dome at ${domeHeight.toFixed(4)} mm on a sphere of radius ${R} — at or past its equator, so no dome carries NA ${NA} with n = ${nGlass.toFixed(4)}`,
    );
  }

  return {
    prescription: build(semis),
    objectDistanceMm,
    stopRadiusMm,
    weierstrassDistanceMm,
    virtualImageDistanceMm,
    thicknessMm,
    workingDistanceMm: (slip ? slip.thicknessMm : 0) + immersionGapMm,
    domeRadiusMm: R,
    rimUtilisation: domeHeight / R,
    minimumRadiusMm,
    magnification: nGlass * nGlass,
    emergentSine: NA / (nGlass * nGlass),
    stack,
    coverslip: slip,
    immersionGapMm,
    glassIndex: nGlass,
    numericalAperture: NA,
    designWavelengthNm,
  };
}

export interface AplanaticMeniscusSpec {
  /**
   * Distance from the incoming (virtual) object point to this element's FIRST
   * vertex (mm). It is not a free choice dressed as one: the first surface is
   * concentric about that point, so this distance IS its radius.
   */
  readonly objectDistanceMm: number;
  /** Axial thickness (mm). Stated, not solved. */
  readonly thicknessMm: number;
  readonly glassMedium?: string;
  readonly designWavelengthNm?: number;
}

export interface AplanaticMeniscus {
  /** Two surfaces, authored object-side first, trailing thickness 0. */
  readonly surfaces: readonly SurfaceSpec[];
  /** First surface radius = the object distance, by concentricity. */
  readonly frontRadiusMm: number;
  /** Second surface radius: R₂ = (R₁+t)·n/(n+1), the Weierstrass condition. */
  readonly rearRadiusMm: number;
  /** Object → second vertex, in glass (mm): u₂ = R₁ + t. */
  readonly weierstrassDistanceMm: number;
  /** Second vertex → the new VIRTUAL image, in front of it (mm): v₂ = u₂·n. */
  readonly virtualImageDistanceMm: number;
  /** Transverse magnification (1/n)·n² = n. */
  readonly magnification: number;
  /** The factor the aperture ANGLE's sine is divided by: n. */
  readonly sineDivisor: number;
  readonly thicknessMm: number;
  readonly glassIndex: number;
  readonly designWavelengthNm: number;
}

/**
 * The aplanatic meniscus: a concentric first surface that bends nothing, and a
 * Weierstrass second surface that divides the aperture angle by n.
 *
 * Both surfaces are exactly stigmatic for the same object point, so the element
 * is aberration-free to all orders on axis. Returned as bare surfaces rather than
 * a `Prescription`, because a meniscus is never used alone — it exists to be
 * spliced behind a dome.
 */
export function aplanaticMeniscus(spec: AplanaticMeniscusSpec): AplanaticMeniscus {
  const R1 = spec.objectDistanceMm;
  const t = spec.thicknessMm;
  if (!(R1 > 0)) throw new Error("aplanaticMeniscus: the object distance must be positive");
  if (!(t > 0)) throw new Error("aplanaticMeniscus: the thickness must be positive");
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const glassMedium = spec.glassMedium ?? FRONT_ELEMENT_MEDIUM;
  const n = getMedium(glassMedium).n(designWavelengthNm);

  const weierstrassDistanceMm = R1 + t;
  const R2 = (weierstrassDistanceMm * n) / (n + 1);

  return {
    surfaces: [
      {
        kind: "refract",
        // Concentric about the object point: centre at distance R₁ in FRONT of
        // this vertex, so the same sign convention as the dome. Every ray meets
        // it at normal incidence and nothing bends.
        curvature: -1 / R1,
        semiAperture: Infinity,
        thickness: t,
        medium: glassMedium,
      },
      {
        kind: "refract",
        curvature: -1 / R2,
        semiAperture: Infinity,
        thickness: 0,
        medium: "AIR",
      },
    ],
    frontRadiusMm: R1,
    rearRadiusMm: R2,
    weierstrassDistanceMm,
    virtualImageDistanceMm: weierstrassDistanceMm * n,
    // (1/n) at the concentric surface, n² at the Weierstrass surface.
    magnification: n,
    sineDivisor: n,
    thicknessMm: t,
    glassIndex: n,
    designWavelengthNm,
  };
}

export interface AplanaticFrontGroupSpec extends HyperhemisphereSpec {
  /**
   * How many aplanatic menisci follow the dome. Default 2, which is what brings
   * NA 1.25 (and 1.40) under the NA 0.343 ceiling § 6d measured for two cemented
   * doublets. Zero is legal and leaves the dome alone.
   */
  readonly meniscusCount?: number;
  /**
   * Gap from a virtual image to the next meniscus's front vertex, as a fraction
   * of that image's distance. Default 0.1. Stated, not solved — the first
   * surface is concentric whatever the gap is, so this sets the element's scale
   * rather than its correction, and the rungs check the design does not depend
   * on it.
   *
   * The defaults are deliberately COMPACT, and the reason is `minimumRadiusMm`.
   * Each meniscus multiplies the group's virtual-image distance by
   * (1+gap)(1+thickness)·n, so a loose group pushes that image far out — and
   * since the image has to land on the rear group's front focus, a far image
   * means a SMALL dome. A cover slip's apparent depth is a fixed length that
   * does not scale with the design, so it puts a floor under the dome, and a
   * loose front group cannot clear it. At the old (0.2, 0.5) a 100×/1.4 through
   * a real slip has no solution at any placement; at (0.1, 0.3) it does.
   */
  readonly meniscusGapFactor?: number;
  /** Meniscus thickness as a fraction of its front radius. Default 0.3. Stated. */
  readonly meniscusThicknessFactor?: number;
  /** Meniscus glass. Defaults to the front element's. */
  readonly meniscusMedium?: string;
}

export interface AplanaticFrontGroup {
  /** The whole group, specimen-side first, trailing thickness 0. Stop on surface 0. */
  readonly prescription: Prescription;
  readonly hyperhemisphere: Hyperhemisphere;
  readonly menisci: readonly AplanaticMeniscus[];
  /** Specimen → surface 0's vertex (mm). */
  readonly objectDistanceMm: number;
  readonly stopRadiusMm: number;
  /** Last vertex → the group's final VIRTUAL image, in front of it (mm). */
  readonly virtualImageDistanceMm: number;
  /** Product of every element's magnification: n_dome²·Πn_meniscus. */
  readonly magnification: number;
  /** The marginal sine emerging into air, NA divided by `magnification`. */
  readonly emergentSine: number;
  /** Gaps from each vertex to the next element's front vertex (mm). */
  readonly gapsMm: readonly number[];
  readonly numericalAperture: number;
  readonly designWavelengthNm: number;
}

/**
 * Dome plus menisci: the whole aplanatic front, spliced and sized from the trace.
 *
 * Every element is exact to all orders, so the group's aperture reduction is the
 * bare product of theirs and its residual is § 6e.1's stack mismatch and nothing
 * else. That is the claim the rungs check, and it is why this composes with
 * § 6d's Lister rather than needing a re-solve.
 */
export function aplanaticFrontGroup(spec: AplanaticFrontGroupSpec): AplanaticFrontGroup {
  const count = spec.meniscusCount ?? 2;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("aplanaticFrontGroup: meniscusCount must be a non-negative integer");
  }
  const gapFactor = spec.meniscusGapFactor ?? 0.1;
  const thicknessFactor = spec.meniscusThicknessFactor ?? 0.3;
  if (!(gapFactor > 0)) throw new Error("aplanaticFrontGroup: the gap factor must be positive");
  if (!(thicknessFactor > 0)) {
    throw new Error("aplanaticFrontGroup: the thickness factor must be positive");
  }
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const dome = hyperhemisphere(spec);
  const meniscusMedium = spec.meniscusMedium ?? spec.glassMedium ?? FRONT_ELEMENT_MEDIUM;
  const margin = spec.glassMarginFactor ?? 1.15;

  // Walk the virtual images forward. Each meniscus sits a stated fraction of the
  // incoming image distance behind the previous vertex; its front radius is then
  // fixed by concentricity, and its rear radius by Weierstrass.
  const menisci: AplanaticMeniscus[] = [];
  const gapsMm: number[] = [];
  let imageDistance = dome.virtualImageDistanceMm;
  for (let i = 0; i < count; i++) {
    const gap = gapFactor * imageDistance;
    const R1 = imageDistance + gap;
    const m = aplanaticMeniscus({
      objectDistanceMm: R1,
      thicknessMm: thicknessFactor * R1,
      glassMedium: meniscusMedium,
      designWavelengthNm,
    });
    menisci.push(m);
    gapsMm.push(gap);
    imageDistance = m.virtualImageDistanceMm;
  }

  const magnification = menisci.reduce((a, m) => a * m.magnification, dome.magnification);
  const domeSurfaces = dome.prescription.surfaces;
  const build = (semis: readonly number[]): Prescription => {
    const surfaces: SurfaceSpec[] = [];
    const push = (s: SurfaceSpec, thickness: number) =>
      surfaces.push({ ...s, thickness, semiAperture: semis[surfaces.length]! });
    domeSurfaces.forEach((s, i) =>
      push(s, i === domeSurfaces.length - 1 ? (gapsMm[0] ?? 0) : s.thickness),
    );
    menisci.forEach((m, i) => {
      push(m.surfaces[0]!, m.thicknessMm);
      push(m.surfaces[1]!, gapsMm[i + 1] ?? 0);
    });
    return { objectMedium: dome.prescription.objectMedium ?? "AIR", surfaces };
  };

  const openSemis = new Array(domeSurfaces.length + 2 * count).fill(Infinity);
  const heights = marginalHeights(
    build(openSemis),
    dome.objectDistanceMm,
    spec.numericalAperture,
    designWavelengthNm,
  );
  if (!heights) {
    throw new Error(
      `aplanaticFrontGroup: the marginal ray at NA ${spec.numericalAperture} does not survive ${count} meniscus/menisci at these factors`,
    );
  }
  // Radii, in the same order as the surfaces, so a spherical rim can be capped
  // at its own sphere the way the dome's is.
  const radii = [
    ...domeSurfaces.map((s) => (s.curvature === 0 ? Infinity : Math.abs(1 / s.curvature))),
    ...menisci.flatMap((m) => [m.frontRadiusMm, m.rearRadiusMm]),
  ];
  // Same rule as the dome's, and it must be the SAME rule: a sphere's rim caps
  // at its own radius, not at a hair under it. Capping the group at 0.999·R
  // while the element capped at R put the marginal ray outside a rim sized from
  // that very ray — the design vignetted itself, and only at the apertures where
  // the dome runs near its equator, which is every aperture this step is for.
  heights.forEach((h, i) => {
    if (!(h < radii[i]!)) {
      throw new Error(
        `aplanaticFrontGroup: the marginal ray meets surface ${i} at ${h.toFixed(4)} mm on a sphere of radius ${radii[i]!.toFixed(4)} — at or past its equator`,
      );
    }
  });
  const semis = heights.map((h, i) => Math.min(margin * h, radii[i]!));

  return {
    prescription: build(semis),
    hyperhemisphere: dome,
    menisci,
    objectDistanceMm: dome.objectDistanceMm,
    stopRadiusMm: dome.stopRadiusMm,
    virtualImageDistanceMm: imageDistance,
    magnification,
    emergentSine: spec.numericalAperture / magnification,
    gapsMm,
    numericalAperture: spec.numericalAperture,
    designWavelengthNm,
  };
}

export interface OilImmersionObjectiveSpec
  extends Omit<AplanaticFrontGroupSpec, "numericalAperture" | "radiusMm"> {
  /** Nominal magnification against `tubeFocalLengthMm` (e.g. 100 for a 100×). */
  readonly magnification: number;
  /** Object-space numerical aperture n·sinu, in the immersion fluid (e.g. 1.25). */
  readonly numericalAperture: number;
  /** The tube lens this magnification is quoted against (mm). Default 200. */
  readonly tubeFocalLengthMm?: number;
  /**
   * Where the front group's virtual image sits, as a fraction of the rear
   * group's own object distance. Default 0.9, so the remaining 10% is the air
   * gap between the two. Stated, not solved — and it is the knob that SETS the
   * dome radius rather than a separate one, since every length in the front
   * group is exactly proportional to R.
   */
  readonly frontImageFactor?: number;
  /** Rear group (§ 6d Lister) parameters. */
  readonly powerSplit?: number;
  readonly separationFactor?: number;
  readonly frontOrientation?: GroupOrientation;
  readonly rearOrientation?: GroupOrientation;
  readonly crownMedium?: string;
  readonly flintMedium?: string;
}

export interface OilImmersionObjective extends InfinityCorrectedObjective {
  readonly frontGroup: AplanaticFrontGroup;
  /** § 6d's two-doublet aplanat, doing the work the front group brought into range. */
  readonly rearGroup: ListerObjective;
  /** Front group's last vertex → the Lister's first vertex (mm). */
  readonly groupGapMm: number;
  /** The dome radius the placement solved to (mm). */
  readonly domeRadiusMm: number;
  /** The aperture handed to the rear group: NA / the front group's magnification. */
  readonly rearNumericalAperture: number;
  /** Traced paraxial EFL of the whole objective at the design wavelength (mm). */
  readonly paraxialFocalLengthMm: number;
  readonly magnification: number;
  readonly numericalAperture: number;
  readonly tubeFocalLengthMm: number;
}

/**
 * The oil-immersion objective: § 6e's aplanatic front, then § 6d's Lister.
 *
 * ## Why this composes instead of needing a re-solve
 *
 * The front group is exact to all orders and leaves a VIRTUAL image; the Lister
 * was solved for a real object at its own front focal distance. Put the virtual
 * image exactly there and the rear group sees the conjugate pair and the cone it
 * was solved for, unchanged — so its ΣS_I = ΣS_II = 0 still holds and nothing is
 * re-derived. That is the entire benefit of an aplanatic front: it changes the
 * aperture and the magnification without changing the aberration problem.
 *
 * ## What sets what
 *
 * The front group's magnification n²·nᵏ is fixed by the glass and the meniscus
 * count alone — no length enters it — so the rear group's share is known before
 * any geometry exists:
 *
 *     f_rear = (f_tube/M) · m_front       NA_rear = NA / m_front
 *
 * and the Lister is built at those. Only then does the dome radius get chosen,
 * and it is not an independent parameter: every length in the front group is
 * exactly proportional to R, so R is whatever puts the virtual image at
 * `frontImageFactor` of the rear group's object distance. Solved by building the
 * group once at R = 1 and scaling — no closed form restated, and the linearity
 * is a rung.
 *
 * ## The one aperture
 *
 * Both groups declare their own surface 0 as a stop. The composed prescription
 * keeps exactly one, on surface 0 — § 6a's rule, and `seidelSums` throws
 * otherwise. The stop is the specimen-side face of the cover slip, and its
 * radius is § 6e.2's exact plane-layer sum.
 */
export function oilImmersionObjective(
  spec: OilImmersionObjectiveSpec,
): OilImmersionObjective {
  const M = spec.magnification;
  const NA = spec.numericalAperture;
  if (!(M > 0)) throw new Error("oilImmersionObjective: magnification must be positive");
  if (!(NA > 0)) throw new Error("oilImmersionObjective: NA must be positive");
  const tubeFocalLengthMm = spec.tubeFocalLengthMm ?? DEFAULT_TUBE_FOCAL_LENGTH_MM;
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;
  const frontImageFactor = spec.frontImageFactor ?? 0.9;
  if (!(frontImageFactor > 0) || frontImageFactor >= 1) {
    throw new Error(
      "oilImmersionObjective: frontImageFactor must lie strictly inside (0, 1) — at 1 the two groups touch",
    );
  }

  // A probe front group, built at twice the smallest radius the stack allows so
  // it exists for anything the form can carry at all. Its magnification is what
  // the rear group's share is computed from, and its virtual image distance is
  // the proportionality constant the radius is solved with — every length in the
  // group is exactly proportional to R, so ANY valid probe radius gives the same
  // constant. Building it costs one trace and saves restating the group's own
  // arithmetic here.
  const probeRadiusMm = 2 * minimumDomeRadiusMm({ ...spec, numericalAperture: NA });
  if (!Number.isFinite(probeRadiusMm)) {
    throw new Error(
      `oilImmersionObjective: no hyperhemisphere of any radius carries NA ${NA} in this glass — the marginal ray meets the dome deeper than the Weierstrass point`,
    );
  }
  const probeSpec = { ...spec, numericalAperture: NA, radiusMm: probeRadiusMm };
  const probe = aplanaticFrontGroup(probeSpec);
  const mFront = probe.magnification;
  const rearNumericalAperture = NA / mFront;

  const rearGroup = listerObjective({
    // f_rear = (f_tube/M)·m_front, expressed the only way `listerObjective`
    // takes a focal length: as a magnification against the same tube lens.
    magnification: M / mFront,
    numericalAperture: rearNumericalAperture,
    tubeFocalLengthMm,
    designWavelengthNm,
    ...(spec.powerSplit === undefined ? {} : { powerSplit: spec.powerSplit }),
    ...(spec.separationFactor === undefined ? {} : { separationFactor: spec.separationFactor }),
    ...(spec.frontOrientation === undefined ? {} : { frontOrientation: spec.frontOrientation }),
    ...(spec.rearOrientation === undefined ? {} : { rearOrientation: spec.rearOrientation }),
    ...(spec.crownMedium === undefined ? {} : { crownMedium: spec.crownMedium }),
    ...(spec.flintMedium === undefined ? {} : { flintMedium: spec.flintMedium }),
    ...(spec.glassMarginFactor === undefined ? {} : { glassMarginFactor: spec.glassMarginFactor }),
  });

  // Every length in the front group is exactly proportional to R, so this is a
  // division and not a search.
  const domeRadiusMm =
    (probeRadiusMm * frontImageFactor * rearGroup.objectDistanceMm) /
    probe.virtualImageDistanceMm;
  const frontGroup = aplanaticFrontGroup({ ...probeSpec, radiusMm: domeRadiusMm });
  const groupGapMm = rearGroup.objectDistanceMm - frontGroup.virtualImageDistanceMm;
  if (!(groupGapMm > 0)) {
    throw new Error(
      `oilImmersionObjective: the front group's virtual image lands behind the rear group's front vertex (gap ${groupGapMm.toFixed(4)} mm) — lower frontImageFactor`,
    );
  }

  const spliced = spliceModules(
    [
      { surfaces: frontGroup.prescription.surfaces, gapAfterMm: groupGapMm },
      { surfaces: rearGroup.prescription.surfaces, gapAfterMm: 0 },
    ],
    frontGroup.prescription.objectMedium ?? "AIR",
  );
  // One aperture, one flag — § 6a's rule. Both groups flagged their own surface
  // 0, and `seidelSums` throws unless the flagged stop is surface 0.
  const prescription: Prescription = {
    ...spliced,
    surfaces: spliced.surfaces.map((s, i) => ({ ...s, isStop: i === 0 })),
  };

  return {
    prescription,
    focalLengthMm: tubeFocalLengthMm / M,
    paraxialFocalLengthMm: systemProperties(prescription, designWavelengthNm).efl,
    objectDistanceMm: frontGroup.objectDistanceMm,
    stopRadiusMm: frontGroup.stopRadiusMm,
    frontGroup,
    rearGroup,
    groupGapMm,
    domeRadiusMm,
    rearNumericalAperture,
    magnification: M,
    numericalAperture: NA,
    tubeFocalLengthMm,
    designWavelengthNm,
  };
}
