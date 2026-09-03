import { OpticalSystem } from "../trace/system";
import { asCompiled } from "../trace/compile";
import { axialTwin } from "../trace/axis";
import { PlaneRay, paraxialRefract, paraxialTransfer } from "../trace/paraxial";
import { AimOptions, pupilFan, chiefRay } from "../pupil/aiming";
import { pupils } from "../pupil/pupils";
import { traceRay } from "../trace/sequential";
import { toImageSpace } from "../trace/axis";
import { exitBundle, bestSpotZ } from "./spot";
import { paraxialImageOffset } from "./focus";
import { seidelSums } from "./seidel";

/**
 * The astigmatic focal surfaces, and distortion — docs/VALIDATION.md § 6ac.
 *
 * An off-axis pencil does not have *a* focus. The fan in the plane containing
 * the axis and the field point (the TANGENTIAL or meridional section) comes to a
 * line focus at one axial position, the fan at right angles to it (the SAGITTAL
 * section) at another, and the two swept over field are the two focal surfaces
 * that decide where a flat detector should sit. Nothing here is new physics: the
 * foci are `bestSpotZ` on a `pupilFan` per axis, both of which the ladder already
 * pins on axis. What is new is the CLAIM — that those two traced numbers are the
 * third-order astigmatism and Petzval sums of a published closed form — and that
 * belongs beside the ladder rather than inside a panel.
 *
 * ## Two ways to get a plausible wrong answer, both refused here
 *
 * **A sag is a difference, so its reference must be traced the same way.** The
 * sags below are measured from the system's own on-axis best-spot focus, and that
 * reference is traced *inside* this module with the identical fan. It has to be:
 * on the § 5j achromat the on-axis best-spot plane moves 2.80e-3 mm between a
 * 21-point fan and a 41-point one — fifth-order spherical residual, sampled
 * differently — and that difference is 59× the whole astigmatic interval at
 * 0.0125° of field. Measured against a mismatched reference, both sags acquire a
 * field-INDEPENDENT offset, the h² law flattens out, and the 3:1 ratio the step
 * exists to check reads 1.02 instead of 3. It looks like physics and it is
 * sampling. So `fanSamples` is one number used for every trace in a call, and
 * the reference is not a parameter a caller can supply.
 *
 * **Distortion is only distortion at the paraxial image plane.** The chief ray is
 * a straight line in image space, so its height at a plane Δz away from the
 * paraxial one is scaled by roughly (1 + Δz/f) — a constant relative error with
 * no field dependence. On the same achromat, evaluating at the best-spot plane
 * instead of the paraxial one puts 3.07e-5 of pure defocus lever on a distortion
 * whose real third-order term is 2.3e-6 at the edge of the field: thirteen times
 * the signal, in a shape (constant in h) that no distortion has. So
 * `distortionProfile` chooses the plane itself, from `paraxialImageOffset`, and
 * does not accept one.
 *
 * ## Sign, which a ratio cannot check
 *
 * Both sags come out NEGATIVE for a positive lens — both focal surfaces bend
 * toward the lens, inside the paraxial focus — and the tangential one is the
 * further of the two. A test that asserts only the 3:1 ratio would pass on a
 * system with the sign of either sag flipped, so the readout reports the signed
 * sags and the rungs assert the side as well as the ratio.
 */

/** Where one field point's two sections focus, and how far that is from axial focus. */
export interface AstigmaticFocus {
  /** Field angle (deg) or object height (mm), as the system's conjugate spells it. */
  readonly fieldValue: number;
  /** Best-focus z of the tangential (meridional) fan, in image space (mm). */
  readonly tangentialZ: number;
  /** Best-focus z of the sagittal fan, in image space (mm). */
  readonly sagittalZ: number;
  /** (t + s)/2 — the medial surface, where the blur is roundest. */
  readonly medialZ: number;
  /** t − s: the astigmatic interval. Zero exactly on axis. */
  readonly astigmaticIntervalMm: number;
  /** t − axialZ (mm, signed) — negative is inside the axial focus. */
  readonly tangentialSagMm: number;
  /** s − axialZ (mm, signed). */
  readonly sagittalSagMm: number;
  /** Rays lost to vignetting/TIR, summed over both fans — non-zero invalidates the sags. */
  readonly lost: number;
}

export interface FieldSurfaces {
  /** The on-axis best-spot focus every sag is measured from (mm), traced with the same fan. */
  readonly axialZ: number;
  readonly fanSamples: number;
  readonly wavelengthNm: number;
  readonly foci: readonly AstigmaticFocus[];
}

export interface FieldSurfacesOptions {
  /**
   * Rays per fan. Odd is preferable — the centre ray then sits on the chief ray.
   * One value serves both sections and the axial reference; see the header.
   */
  readonly fanSamples?: number;
  readonly aim?: AimOptions;
}

/**
 * Trace the two sections at each field value and report both focal surfaces.
 *
 * The tangential section is the pupil fan along **x** because a field point is
 * displaced along x in this engine (`objectPoint`/`fieldDirection`), so the plane
 * containing the axis and the field point is the x–z plane. That is a convention,
 * not a derivation, and the rungs check it the only way a convention can be
 * checked: the x fan's sag is the one that comes out three times the y fan's.
 */
export function fieldSurfaces(
  system: OpticalSystem,
  fieldValues: readonly number[],
  wavelengthNm: number,
  options: FieldSurfacesOptions = {},
): FieldSurfaces {
  const fanSamples = options.fanSamples ?? 41;
  if (!Number.isInteger(fanSamples) || fanSamples < 2) {
    throw new Error("fieldSurfaces: fanSamples must be an integer ≥ 2");
  }
  const tanFan = pupilFan(fanSamples, "x");
  const sagFan = pupilFan(fanSamples, "y");
  const aim = options.aim ?? {};

  // The reference, traced here so it cannot be sampled differently from the
  // field points it is subtracted from.
  const axial = exitBundle(system, 0, wavelengthNm, tanFan, aim);
  const axialZ = bestSpotZ(axial);

  const foci = fieldValues.map((fieldValue): AstigmaticFocus => {
    const t = exitBundle(system, fieldValue, wavelengthNm, tanFan, aim);
    const s = exitBundle(system, fieldValue, wavelengthNm, sagFan, aim);
    const tangentialZ = bestSpotZ(t);
    const sagittalZ = bestSpotZ(s);
    return {
      fieldValue,
      tangentialZ,
      sagittalZ,
      medialZ: (tangentialZ + sagittalZ) / 2,
      astigmaticIntervalMm: tangentialZ - sagittalZ,
      tangentialSagMm: tangentialZ - axialZ,
      sagittalSagMm: sagittalZ - axialZ,
      lost: t.lost + s.lost,
    };
  });

  return { axialZ, fanSamples, wavelengthNm, foci };
}

/** The three third-order focal surfaces at one field, as sags from paraxial focus. */
export interface ThirdOrderSags {
  /** −(S_III + S_IV)/(2·n′·u′²) — the sagittal surface (mm, signed). */
  readonly sagittalMm: number;
  /** −(3·S_III + S_IV)/(2·n′·u′²) — the tangential surface (mm, signed). */
  readonly tangentialMm: number;
  /** −S_IV/(2·n′·u′²) — the Petzval surface: where both would lie with astigmatism nulled. */
  readonly petzvalMm: number;
  readonly s3: number;
  readonly s4: number;
  /** n′·u′² — the image-space marginal ray's factor, which converts a sum into a length. */
  readonly imageFactor: number;
  /** The image-space paraxial marginal ray's slope u′ (negative for a converging beam). */
  readonly imageSlope: number;
  /** The index in image space, n′. */
  readonly imageIndex: number;
}

/**
 * The published third-order prediction for the same two surfaces (Welford,
 * *Aberrations of Optical Systems*, ch. 8):
 *
 *     x_s = −(S_III + S_IV)/(2·n′·u′²)
 *     x_t = −(3·S_III + S_IV)/(2·n′·u′²)
 *     x_p = −S_IV/(2·n′·u′²)
 *
 * whence the classical statement the rungs check: the tangential surface departs
 * from the Petzval surface three times as far as the sagittal one, on the same
 * side, because x_t − x_p = 3(x_s − x_p) identically.
 *
 * Infinite conjugate only. A finite conjugate would need the chief-ray
 * slope-vs-object-height convention of § 6b applied to H as well, and § 6h
 * already traces the finite-conjugate field map — so rather than carry an
 * untested second convention, this throws.
 *
 * **The stop may sit anywhere** since § 6cm; before it, this refused any
 * placement but the first surface. The aperture is handed to `seidelSums` as a
 * radius AT THE STOP rather than a height at surface 0, and that is not a
 * spelling preference: `pupils()` numbers surfaces on its own compilation of the
 * prescription and `seidelSums` on `unfoldedTwin`'s, so passing a height would
 * be pairing a radius measured at one index with a chief ray solved at another.
 * They agree today, and nothing here would notice the day they stopped. For the
 * same reason the image-space marginal ray below is launched from the height the
 * sums actually used, not from the stop radius — off surface 0 those differ, and
 * u′ is the factor that turns a sum into a length.
 */
export function thirdOrderSags(
  system: OpticalSystem,
  fieldValueDeg: number,
  wavelengthNm: number,
): ThirdOrderSags {
  if (system.conjugate.kind !== "infinite") {
    throw new Error(
      "thirdOrderSags: infinite conjugate only — § 6h is the finite-conjugate field map",
    );
  }
  const c = axialTwin(asCompiled(system.prescription));
  const pu = pupils(system, wavelengthNm);

  const sums = seidelSums(system.prescription, wavelengthNm, {
    marginalRadiusAtStopMm: pu.stopRadius,
    fieldAngleRad: (fieldValueDeg * Math.PI) / 180,
  });

  // The same marginal ray the sums were built with, carried to image space, so
  // the length conversion cannot be quoted at a different aperture than the sums.
  let st: PlaneRay = { y: sums.marginalHeightMm, u: 0, n: c.indices(wavelengthNm)[0]! };
  for (let i = 0; i < c.surfaces.length; i++) {
    st = paraxialRefract(c, i, wavelengthNm, st);
    if (i < c.surfaces.length - 1) st = paraxialTransfer(st, c.surfaces[i]!.thickness);
  }
  const imageFactor = st.n * st.u * st.u;
  if (!(Math.abs(imageFactor) > 0)) {
    throw new Error("thirdOrderSags: afocal in image space — no focal surface to place");
  }

  const denom = 2 * imageFactor;
  return {
    sagittalMm: -(sums.s3 + sums.s4) / denom,
    tangentialMm: -(3 * sums.s3 + sums.s4) / denom,
    petzvalMm: -sums.s4 / denom,
    s3: sums.s3,
    s4: sums.s4,
    imageFactor,
    imageSlope: st.u,
    imageIndex: st.n,
  };
}

/**
 * The third-order prediction for the chief ray's own height error — distortion as
 * a length rather than as a sum.
 *
 * The transverse ray aberration of the pupil-independent term in the Seidel set is
 *
 *     δη′ = S_V/(2·n′·u′)
 *
 * (Welford ch. 8; it is the one term in the transverse expansion carrying no
 * factor of ρ, which is exactly what makes it a shift of the image point rather
 * than a blur of it). This is what `distortionProfile`'s traced departure must
 * reproduce, and the two are computed from disjoint machinery: paraxial y–u
 * recursion here, an exactly traced skew ray there.
 *
 * The MAGNITUDE is the published prediction and it is what the rung checks — 1e-6
 * relative on the § 5j achromat at 0.05°. The overall SIGN is a convention of this
 * engine's transverse axis and its u′, in the same way the mirror anchor fixes the
 * sign of S_I, and it is not left to the comparison to decide: the § 5j achromat
 * carries its stop at the FRONT vertex, i.e. ahead of the lens, and a stop ahead
 * of a positive lens gives BARREL distortion — the textbook direction. The traced
 * departure is negative, barrel, so the conversion carries no minus sign.
 *
 * Carries `thirdOrderSags`' restrictions, plus `seidelSums`' A = 0 refusal — the
 * plano-convex singlet turned back-to-front is the everyday system that hits it.
 */
export function thirdOrderDistortionMm(
  system: OpticalSystem,
  fieldValueDeg: number,
  wavelengthNm: number,
): number {
  const sags = thirdOrderSags(system, fieldValueDeg, wavelengthNm);
  const pu = pupils(system, wavelengthNm);
  const sums = seidelSums(system.prescription, wavelengthNm, {
    marginalRadiusAtStopMm: pu.stopRadius,
    fieldAngleRad: (fieldValueDeg * Math.PI) / 180,
    distortion: true,
  });
  return sums.s5! / (2 * sags.imageIndex * sags.imageSlope);
}

export interface DistortionSample {
  /** Field angle (deg). */
  readonly fieldValueDeg: number;
  /** Traced chief-ray height at the paraxial image plane (mm). */
  readonly tracedHeightMm: number;
  /** Paraxial chief-ray height there (mm) — the distortion-free reference. */
  readonly paraxialHeightMm: number;
  /** traced/paraxial − 1. Positive is pincushion, negative barrel. */
  readonly relative: number;
}

export interface DistortionProfile {
  /** The plane every height is measured on — the paraxial image plane (mm). */
  readonly paraxialZ: number;
  readonly wavelengthNm: number;
  readonly samples: readonly DistortionSample[];
}

/**
 * Traced chief-ray height against the paraxial one, at the paraxial image plane.
 *
 * The reference is a paraxial trace rather than f·tanθ: they agree for a thin
 * lens with the stop in contact and part company as soon as the stop moves or the
 * glass has thickness, and the definition of distortion is the departure from the
 * PARAXIAL image height. Infinite conjugate only — § 6h's `objectFieldFrame`
 * inverts the traced chief ray for the finite-conjugate branch and pins its cubic
 * there.
 */
export function distortionProfile(
  system: OpticalSystem,
  fieldValuesDeg: readonly number[],
  wavelengthNm: number,
  options: AimOptions = {},
): DistortionProfile {
  if (system.conjugate.kind !== "infinite") {
    throw new Error(
      "distortionProfile: infinite conjugate only — § 6h maps the finite-conjugate field",
    );
  }
  const c = axialTwin(asCompiled(system.prescription));
  const raw = asCompiled(system.prescription);
  const pu = pupils(system, wavelengthNm);
  const last = c.surfaces[c.surfaces.length - 1]!;
  const paraxialZ = last.vertexZ + paraxialImageOffset(system, wavelengthNm);
  const n0 = c.indices(wavelengthNm)[0]!;

  const samples = fieldValuesDeg.map((fieldValueDeg): DistortionSample => {
    const th = (fieldValueDeg * Math.PI) / 180;
    const slope = Math.tan(th);

    // Paraxial chief ray: through the centre of the entrance pupil at slope
    // tan θ (the paraxial angle convention IS the tangent), started at surface
    // 0's vertex with whatever height that geometry implies.
    let st: PlaneRay = { y: (c.surfaces[0]!.vertexZ - pu.entrance.z) * slope, u: slope, n: n0 };
    for (let i = 0; i < c.surfaces.length; i++) {
      st = paraxialRefract(c, i, wavelengthNm, st);
      st = paraxialTransfer(st, i < c.surfaces.length - 1 ? c.surfaces[i]!.thickness : paraxialZ - last.vertexZ);
    }
    const paraxialHeightMm = st.y;

    const cr = chiefRay(system, pu, fieldValueDeg, wavelengthNm, options);
    const tr = traceRay(system.prescription, cr);
    if (tr.status !== "ok" || !tr.ray) {
      throw new Error(`distortionProfile: chief ray failed (${tr.status}) at field ${fieldValueDeg}`);
    }
    const im = toImageSpace(raw, tr.ray);
    const t = (paraxialZ - im.origin.z) / im.dir.z;
    const tracedHeightMm = im.origin.x + im.dir.x * t;

    return {
      fieldValueDeg,
      tracedHeightMm,
      paraxialHeightMm,
      relative: paraxialHeightMm === 0 ? 0 : tracedHeightMm / paraxialHeightMm - 1,
    };
  });

  return { paraxialZ, wavelengthNm, samples };
}
