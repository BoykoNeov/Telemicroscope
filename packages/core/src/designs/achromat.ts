import { Prescription, SurfaceSpec } from "../trace/prescription";
import { getMedium } from "../materials/catalog";
import { abbeNumber, LINE_D, LINE_F, LINE_C } from "../materials/dispersion";
import { systemProperties } from "../trace/paraxial";
import { seidelSums } from "../analysis/seidel";

/**
 * The cemented achromatic doublet objective — the refractor preset, and the
 * first preset that is a LENS rather than a mirror system.
 *
 * Like every design in this folder it is *computed*, not transcribed: give it an
 * aperture and a focal ratio and it derives its own four numbers (three radii and
 * the power split) from the glass catalog and third-order theory. Change N-BK7's
 * Sellmeier coefficients and the colours stop landing together; change nothing and
 * the spherical aberration stays nulled, because the bending was solved, not
 * fitted. A transcribed patent prescription would pin nothing about the physics —
 * it would only prove the tracer can read a table (that rung exists separately in
 * docs/VALIDATION.md as "published prescriptions reproduce catalogued EFL/BFD").
 *
 * ## What the design has to satisfy, and what is free
 *
 * A cemented doublet has three curvatures c₁, c₂, c₃ (surface 2 is shared: the
 * cement joint) and two glasses. Two conditions consume two degrees of freedom:
 *
 *  - **Total power.** φ = φ₁ + φ₂ = 1/f, with φᵢ from the thin-lens maker's
 *    equation: φ₁ = (n₁−1)(c₁−c₂), φ₂ = (n₂−1)(c₂−c₃).
 *  - **Achromatism.** dφ/dλ = 0 between the F and C lines requires
 *    φ₁/V₁ + φ₂/V₂ = 0, hence the classical split
 *
 *        φ₁ = φ·V₁/(V₁−V₂),      φ₂ = −φ·V₂/(V₁−V₂)
 *
 *    — the crown does more than the whole job and the flint takes some back. This
 *    is the same closed form `refractor.ts` uses for the step-4 hero pair; here it
 *    fixes only the *differences* c₁−c₂ and c₂−c₃.
 *
 * That leaves ONE free parameter: the **bending** c₁, which slides all three
 * curvatures together without touching either condition. Bending changes no
 * first-order property and no chromatic one — but it changes the spherical
 * aberration, and it is the whole reason a doublet can be sharp where a singlet
 * cannot (a singlet's third-order spherical aberration has a strictly positive
 * minimum over its own shape factor; a doublet's crosses zero, `analysis/seidel`).
 *
 * ## The bending is SOLVED from third-order theory (the external number)
 *
 * The bending is chosen by setting the third-order spherical aberration sum to
 * zero, S_I(c₁) = 0, evaluated by the published Seidel formulas (Welford ch. 8)
 * on the REAL thick prescription — the classical "third-order solve" every
 * achromat since Fraunhofer has been laid out by, and the standard first step of
 * any lens design. `analysis/seidel` is pinned to the thin-lens closed form and
 * the spherical-mirror figure BEFORE this uses it (§ 5j), so the solve rests on an
 * external number rather than on the engine's own residual. Solving instead on the
 * traced wavefront would be fitting the design to the tracer — the circularity the
 * project's hard rule forbids — and would leave the trace with nothing independent
 * left to confirm.
 *
 * S_I(c₁) has **two** roots — the classical pair of SA-null bendings for a
 * crown-first cemented doublet — and something has to choose. Both null the same
 * third order, so the choice must be made on what third-order theory does NOT
 * model: the fifth and higher orders it leaves behind. The criterion is how
 * violently the surfaces cancel, Σᵢ|S_I,ᵢ| over the individual surface
 * contributions. A solution whose surfaces each contribute little is the robust
 * one; a solution that reaches zero by subtracting two large numbers carries large
 * un-modelled higher-order terms with it (and, for the same reason, tighter
 * manufacturing tolerances). In every catalog pair tried this picks the visibly
 * shallower-surfaced root, which is why the option is spelled `branch: "shallow"`
 * (default) / `"steep"` — the name is the shape you can see, the criterion is the
 * physics. The trace confirms it: the shallow root is 2.4× better on axis for
 * N-BK7/F2, 3.2× for fused silica/F2, and **8×** for the fluorite pair.
 *
 * It is a third-order PROXY, though, and worth knowing as one: Σ|S_I,ᵢ| is checked
 * against the exact trace for the catalog's glass pairs (§ 5k), not proven for
 * arbitrary glass, and the selection is made here without tracing — a `designs/`
 * function reaching into the wave layer would invert the layering. So for some
 * untried pair the proxy could hand back the worse root without saying so. Both
 * roots are genuinely SA-nulled designs, and `branch: "steep"` builds the other, so
 * a caller who suspects a mispick can measure the two and choose.
 *
 * **Not** the coma sum, though that was the obvious first guess. S_II runs
 * monotonically through the bending and crosses zero *between* the two roots, so
 * the pair straddles the coma-free bending: their comas come out similar in
 * magnitude and opposite in sign (+0.111 vs −0.129 mm/rad for N-BK7/F2 at 100 mm
 * f/10). Neither root is aplanatic, the margin between them is a few percent, and
 * for CaF₂/N-BK7 the smaller |S_II| belongs to the root that is EIGHT TIMES worse
 * on axis. Coma is reported per branch, and it is not what decides. Making S_I and
 * S_II vanish together is not a matter of bending at all: it is a constraint on the
 * *glass pair*, or it needs the third freedom a broken-contact air gap provides.
 *
 * For N-BK7/F2 the chosen root is the near-equiconvex crown with an almost flat
 * rear face, the shape a Fraunhofer objective is recognised by (468.3 / −429.0 /
 * −4520.6 mm at 100 mm f/10).
 *
 * ## Some glass pairs have no solution at all, and that is an answer
 *
 * The two roots are not guaranteed. For CaF₂/F2 — fluorite against a heavy flint —
 * S_I stays strictly positive at every bending, so no cemented doublet of that pair
 * is spherically correctable at all. The preset throws rather than returning the
 * least-bad bending: "no real solution" is a fact about the glasses, and hiding it
 * behind a nearly-nulled design would be the more expensive kind of wrong.
 *
 * ## What is corrected, and what honestly is not
 *
 *  - **Spherical aberration** is nulled to *third* order. A fifth-order residual
 *    survives — this is a third-order solve, not an optimisation — so the on-axis
 *    rung is "diffraction-limited at ordinary focal ratios, and orders better than
 *    a singlet", never "perfect". The residual grows as the objective speeds up,
 *    which is why fast achromats are hard and slow ones are cheap.
 *  - **Chromatically**, F and C are united by construction; d is not. The residual
 *    is the **secondary spectrum**, and it too is a closed form from the catalog:
 *    with P(λ) = (n(λ)−n_C)/(n_F−n_C) the relative partial dispersion,
 *
 *        Δφ(λ)/φ = (P₁(λ)−P₂(λ))/(V₁−V₂)   ⇒   Δf(λ)/f = −(P₁(λ)−P₂(λ))/(V₁−V₂)
 *
 *    ≈ −1/2000 at the d line for N-BK7/F2. It is not a defect of this design but
 *    of the *glass pair*: no bending and no thickness touches it, and beating it is
 *    exactly what an ED/apochromatic pairing (an anomalous-partial-dispersion
 *    glass) is for. `secondarySpectrum` reports it so a preset can be judged on it.
 *  - **Coma** is only minimised by the branch choice, not nulled (see above).
 *    Astigmatism and field curvature are traced and unpinned.
 *
 * SCOPE. The stop is at the front vertex, where a refractor's cell puts it. The
 * glass carries a small margin over D/2 so that off-axis pencils are not shaved by
 * the surfaces' own sag, which means — as for §§ 5g–5i — the preset must be driven
 * by `{kind:"stopRadius", value: D/2}`; an `fNumber`/`EPD` spec would read the
 * oversized glass edge instead of the pupil. Cement layer thickness, coatings and
 * the lens cell are mechanical, not optical, and absent. The reported
 * `focalLengthMm` is the thin-lens design target D·F; the traced paraxial EFL sits
 * a few parts in 10⁴ below it, the Gullstrand thickness term, and is reported
 * separately as `paraxialFocalLengthMm` rather than papered over.
 */

export interface AchromaticObjectiveSpec {
  /** Clear aperture / entrance pupil diameter (mm). */
  readonly apertureMm: number;
  /** Focal ratio f/D. */
  readonly focalRatio: number;
  /** Front (positive) element glass — the crown. Default "N-BK7". */
  readonly crownMedium?: string;
  /** Rear (negative) element glass — the flint. Must be the more dispersive of the two. Default "F2". */
  readonly flintMedium?: string;
  /** Wavelength (nm) the powers are computed at. Default the d line, 587.5618 nm. */
  readonly designWavelengthNm?: number;
  /** Crown centre thickness (mm). Mechanical. Default 0.10·D. */
  readonly crownThicknessMm?: number;
  /** Flint centre thickness (mm). Mechanical. Default 0.06·D. */
  readonly flintThicknessMm?: number;
  /**
   * Which root of S_I(c₁) = 0 to build. Both null the third-order spherical
   * aberration; `"shallow"` (default) is the one whose surfaces cancel least
   * violently — see the header. `"steep"` builds the other, which exists so the
   * rungs can measure what the choice is worth.
   */
  readonly branch?: "shallow" | "steep";
  /**
   * Distance from the last vertex to the image plane (mm). Defaults to the
   * paraxial back focal distance at the design wavelength, so the prescription
   * itself lands on focus; a focus solve normally replaces it.
   */
  readonly backFocusMm?: number;
}

/** One SA-null bending, with the numbers that distinguish it from the other. */
export interface AchromatBranch {
  readonly curvatures: readonly [number, number, number];
  /**
   * Σᵢ|S_I,ᵢ| — the sum of the surfaces' individual third-order contributions,
   * which the design nulls by cancellation. THIS is what picks the branch: the
   * smaller it is, the less un-modelled fifth-and-higher order comes with it.
   */
  readonly cancellation: number;
  /** max|c|·(D/2) over the three surfaces — the steepness the criterion tracks. */
  readonly maxSurfaceSlope: number;
  /** Σ S_II per radian of field (mm/rad) — reported, but NOT the selector. */
  readonly comaPerRadian: number;
}

export interface AchromaticObjective {
  readonly prescription: Prescription;
  /** The thin-lens design target (mm) = D·F. */
  readonly focalLengthMm: number;
  /**
   * The traced paraxial EFL at the design wavelength (mm). A few parts in 10⁴
   * below `focalLengthMm`: the elements are thick and the power split is the
   * thin-lens closed form, so Gullstrand's separation term is left in, honestly,
   * rather than absorbed by a fitted split.
   */
  readonly paraxialFocalLengthMm: number;
  /** Surface curvatures (1/mm): front, cemented joint, rear. */
  readonly curvatures: readonly [number, number, number];
  /** Surface radii (mm) — Infinity for a flat. The design's headline numbers. */
  readonly radiiMm: readonly [number, number, number];
  /** Crown element power (1/mm) = φ·V₁/(V₁−V₂). */
  readonly crownPower: number;
  /** Flint element power (1/mm) = −φ·V₂/(V₁−V₂), negative. */
  readonly flintPower: number;
  readonly crownIndex: number;
  readonly flintIndex: number;
  readonly crownAbbe: number;
  readonly flintAbbe: number;
  /** Relative partial dispersions P = (n_d−n_C)/(n_F−n_C) of the two glasses. */
  readonly crownPartialDispersion: number;
  readonly flintPartialDispersion: number;
  /**
   * Secondary spectrum at the d line, as a fraction of the focal length:
   * Δf/f = −(P₁−P₂)/(V₁−V₂). Negative: the middle of the band focuses SHORT of
   * the united F and C focus. A property of the glass pair alone.
   */
  readonly secondarySpectrum: number;
  /** Residual Σ S_I at the solution (mm) — zero to solver precision, by construction. */
  readonly seidelS1: number;
  /** Σ S_II per radian of field (mm/rad) for the branch built. */
  readonly comaPerRadian: number;
  /** Both SA-null roots, chosen and rejected, in the order the solver found them. */
  readonly branches: readonly [AchromatBranch, AchromatBranch];
  /** Which root was built. */
  readonly branch: "shallow" | "steep";
  /** Paraxial back focal distance at the design wavelength (mm), echoed since it defaults. */
  readonly backFocusMm: number;
  readonly crownThicknessMm: number;
  readonly flintThicknessMm: number;
  readonly designWavelengthNm: number;
  readonly crownMedium: string;
  readonly flintMedium: string;
}

/** Sag of a sphere of curvature c at radius r — for the edge-thickness check. */
const sag = (c: number, r: number): number => {
  const d = 1 - c * c * r * r;
  if (d <= 0) return c * r * r; // hemispherical or worse; the caller rejects it anyway
  return (c * r * r) / (1 + Math.sqrt(d));
};

export function achromaticObjective(spec: AchromaticObjectiveSpec): AchromaticObjective {
  const D = spec.apertureMm;
  const F = spec.focalRatio;
  if (!(D > 0) || !(F > 0)) {
    throw new Error("achromaticObjective: aperture and focal ratio must be positive");
  }
  const f = D * F;
  const phi = 1 / f;

  const crownMedium = spec.crownMedium ?? "N-BK7";
  const flintMedium = spec.flintMedium ?? "F2";
  const crown = getMedium(crownMedium);
  const flint = getMedium(flintMedium);
  const designWavelengthNm = spec.designWavelengthNm ?? LINE_D;

  const V1 = abbeNumber(crown);
  const V2 = abbeNumber(flint);
  if (!(V1 > V2)) {
    throw new Error(
      `achromaticObjective: the crown must be the less dispersive glass (V ${crownMedium}=${V1.toFixed(2)}, ${flintMedium}=${V2.toFixed(2)}) — swap them`,
    );
  }
  const n1 = crown.n(designWavelengthNm);
  const n2 = flint.n(designWavelengthNm);
  if (!(n1 > 1) || !(n2 > 1)) {
    throw new Error("achromaticObjective: both glasses must have index > 1");
  }

  // The achromatic power split, and with it the two curvature DIFFERENCES. The
  // bending c₁ is what is left free.
  const crownPower = (phi * V1) / (V1 - V2);
  const flintPower = (-phi * V2) / (V1 - V2);
  const dc1 = crownPower / (n1 - 1); // c₁ − c₂
  const dc2 = flintPower / (n2 - 1); // c₂ − c₃

  if (spec.crownThicknessMm !== undefined && !(spec.crownThicknessMm > 0)) {
    throw new Error("achromaticObjective: element thicknesses must be positive");
  }
  if (spec.flintThicknessMm !== undefined && !(spec.flintThicknessMm > 0)) {
    throw new Error("achromaticObjective: element thicknesses must be positive");
  }
  // Provisional thicknesses for the first solve; the defaults are finalised from
  // the resulting sags below, since a fast doublet's crown needs more glass than
  // a slow one just to keep an edge.
  let crownThicknessMm = spec.crownThicknessMm ?? 0.1 * D;
  let flintThicknessMm = spec.flintThicknessMm ?? 0.06 * D;

  const curvaturesFrom = (c1: number): [number, number, number] => {
    const c2 = c1 - dc1;
    return [c1, c2, c2 - dc2];
  };

  // The front face is the stop and carries a 0.5% margin over D/2. Rays are aimed
  // at the entrance-pupil PLANE (z = 0), but the surface is curved: off axis a
  // pencil crosses that plane at D/2 and then meets the glass a further sag·tan θ
  // out, so a face sized to exactly D/2 shaves its own rim ring — the sag-exact
  // footprint issue the Newtonian and Schmidt presets each hit. Half a percent
  // clears a couple of degrees of field at any sane focal ratio. NOTE, as for
  // §§ 5g–5i: the pupil is D/2 as set by the system's *stop-radius* aperture spec,
  // NOT this glass edge, so drive the preset with `{kind:"stopRadius", value: D/2}`
  // (as the rungs do); an `fNumber`/`EPD` spec would read the oversized surface.
  // The two rear faces carry 2%, since an off-axis pencil walks further across
  // them — clipping there is an artifact of sizing to the on-axis beam, not a
  // real refractor's cell.
  const frontClearRadius = (D / 2) * 1.005;
  const rearClearRadius = (D / 2) * 1.02;
  const build = (cs: readonly [number, number, number], lastThickness: number): Prescription => ({
    surfaces: [
      { kind: "refract", curvature: cs[0], semiAperture: frontClearRadius, thickness: crownThicknessMm, medium: crownMedium, isStop: true },
      { kind: "refract", curvature: cs[1], semiAperture: rearClearRadius, thickness: flintThicknessMm, medium: flintMedium },
      { kind: "refract", curvature: cs[2], semiAperture: rearClearRadius, thickness: lastThickness, medium: "AIR" },
    ] satisfies SurfaceSpec[],
  });

  const s1Of = (c1: number): number =>
    seidelSums(build(curvaturesFrom(c1), f), designWavelengthNm, { marginalHeightMm: D / 2 }).s1;

  /**
   * Scan the bending for sign changes of S_I, then bisect each. The classical
   * result is that S_I(c₁) has TWO roots for a crown-first cemented doublet;
   * finding a different count means the glass pair does not admit the classical
   * solution, and that is worth saying out loud rather than silently picking one.
   */
  const solveBendings = (): [AchromatBranch, AchromatBranch] => {
    const span = Math.abs(dc1) + Math.abs(dc2);
    const lo = -3 * span;
    const hi = 3 * span;
    const steps = 2000;
    const roots: number[] = [];
    let prevC = lo;
    let prevS = s1Of(lo);
    for (let i = 1; i <= steps; i++) {
      const c = lo + ((hi - lo) * i) / steps;
      const s = s1Of(c);
      if (prevS === 0) roots.push(prevC);
      else if (prevS * s < 0) {
        let a = prevC;
        let b = c;
        let fa = prevS;
        for (let k = 0; k < 100 && b - a > Math.abs(b) * 1e-15; k++) {
          const mid = 0.5 * (a + b);
          const fm = s1Of(mid);
          if (fm === 0) {
            a = mid;
            b = mid;
            break;
          }
          if (fa * fm < 0) b = mid;
          else {
            a = mid;
            fa = fm;
          }
        }
        roots.push(0.5 * (a + b));
      }
      prevC = c;
      prevS = s;
    }
    if (roots.length !== 2) {
      throw new Error(
        `achromaticObjective: expected two spherical-aberration-null bendings, found ${roots.length} — this glass pair does not admit the classical doublet solution`,
      );
    }
    return roots.map((c1): AchromatBranch => {
      const cs = curvaturesFrom(c1);
      // S_II is linear in field angle, so one radian is just a normalisation.
      const s = seidelSums(build(cs, f), designWavelengthNm, {
        marginalHeightMm: D / 2,
        fieldAngleRad: 1,
      });
      return {
        curvatures: cs,
        cancellation: s.surfaces.reduce((total, x) => total + Math.abs(x.s1), 0),
        maxSurfaceSlope: Math.max(...cs.map((c) => Math.abs(c) * (D / 2))),
        comaPerRadian: s.s2,
      };
    }) as [AchromatBranch, AchromatBranch];
  };

  const branch = spec.branch ?? "shallow";
  const pick = (bs: readonly [AchromatBranch, AchromatBranch]): AchromatBranch => {
    const shallowFirst = bs[0].cancellation <= bs[1].cancellation;
    return branch === "shallow"
      ? (shallowFirst ? bs[0] : bs[1])
      : (shallowFirst ? bs[1] : bs[0]);
  };

  // First pass: solve at the provisional thicknesses, then finalise any thickness
  // the caller left to us. A defaulted element gets whatever its own sags demand
  // plus a 2%-of-diameter edge — a fast crown is deeply curved and needs more
  // glass than a slow one — with the 0.10·D / 0.06·D floors of an ordinary
  // objective. Re-solving afterwards keeps the bending consistent with the
  // thicknesses it was solved at (the coupling is weak, so one pass suffices; the
  // edge check below is on the final geometry either way).
  {
    const first = pick(solveBendings()).curvatures;
    const h = D / 2;
    if (spec.crownThicknessMm === undefined) {
      crownThicknessMm = Math.max(0.1 * D, sag(first[0], h) - sag(first[1], h) + 0.02 * D);
    }
    if (spec.flintThicknessMm === undefined) {
      flintThicknessMm = Math.max(0.06 * D, sag(first[1], h) - sag(first[2], h) + 0.02 * D);
    }
  }

  const branches = solveBendings();
  const chosen = pick(branches);
  const curvatures = chosen.curvatures;

  // A cemented doublet whose elements meet before the rim cannot be made.
  const crownEdge = crownThicknessMm + sag(curvatures[1], D / 2) - sag(curvatures[0], D / 2);
  const flintEdge = flintThicknessMm + sag(curvatures[2], D / 2) - sag(curvatures[1], D / 2);
  if (!(crownEdge > 0) || !(flintEdge > 0)) {
    throw new Error(
      `achromaticObjective: element edge thickness is negative (crown ${crownEdge.toFixed(2)} mm, flint ${flintEdge.toFixed(2)} mm) — give the elements more centre thickness`,
    );
  }
  for (const c of curvatures) {
    if (Math.abs(c) * (D / 2) >= 1) {
      throw new Error("achromaticObjective: a surface is hemispherical or steeper at this aperture");
    }
  }

  const backFocusMm = spec.backFocusMm
    ?? systemProperties(build(curvatures, 0), designWavelengthNm).bfd;
  const prescription = build(curvatures, backFocusMm);

  const partial = (m: typeof crown): number =>
    (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C));
  const crownPartialDispersion = partial(crown);
  const flintPartialDispersion = partial(flint);

  return {
    prescription,
    focalLengthMm: f,
    paraxialFocalLengthMm: systemProperties(prescription, designWavelengthNm).efl,
    curvatures,
    radiiMm: curvatures.map((c) => (c === 0 ? Infinity : 1 / c)) as unknown as [number, number, number],
    crownPower,
    flintPower,
    crownIndex: n1,
    flintIndex: n2,
    crownAbbe: V1,
    flintAbbe: V2,
    crownPartialDispersion,
    flintPartialDispersion,
    secondarySpectrum: -(crownPartialDispersion - flintPartialDispersion) / (V1 - V2),
    seidelS1: seidelSums(prescription, designWavelengthNm, { marginalHeightMm: D / 2 }).s1,
    comaPerRadian: chosen.comaPerRadian,
    branches,
    branch,
    backFocusMm,
    crownThicknessMm,
    flintThicknessMm,
    designWavelengthNm,
    crownMedium,
    flintMedium,
  };
}
