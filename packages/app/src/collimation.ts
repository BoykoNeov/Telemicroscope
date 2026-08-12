import { refractorPair } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { balancedRms, coefficient, fitZernike } from "@telemicroscope/core/wave";
import type { OpticalSystem, Prescription, RayAiming } from "@telemicroscope/core/trace";
import type { LensKind } from "./render";

/**
 * Collimation — where the coma node goes when an element is knocked out of
 * line. ROADMAP step 7's *"misalignment (tilt/decenter) scenarios"*, and the
 * surface § 1.5.3 was built for.
 *
 * No DOM, no React, `render.ts`'s pattern again. The engine side is § 1.5.3's
 * real ray aiming plus `opdMap`, and **no capability is added here**, so no
 * validation-ladder rung is; what this file's own tests pin is the wiring and
 * the claims the panel makes that no rung states.
 *
 * ## What the panel is about, in one sentence
 *
 * An aligned instrument has no coma on axis and coma growing linearly either
 * side of it, so the point where coma vanishes — **the node** — is the point you
 * are aiming at. Misalign an element and the node moves off the axis. Putting it
 * back is what a collimation screw does, and how far it has gone is this panel's
 * headline. No rung in the ladder states it: every rung sits on a system that is
 * either aligned or measured only on axis.
 *
 * ## Three things it must get right, and each was measured rather than assumed
 *
 * **The quantity is coma, not the total.** The obvious curve — total wavefront
 * error against field, minimum marked — is the wrong one, and measuring it said
 * so: the total is dominated by astigmatism and field curvature, which go as
 * field² and stay symmetric about the axis whatever is misaligned, so its
 * minimum moves by 2e-3° for a 0.2° tilt and the picture shows nothing. Coma is
 * the term a misalignment displaces. Its node moves ~1.6× further than that for
 * the same tilt and, more to the point, it is what a collimator is looking at.
 *
 * **The currency is the balanced wavefront**, which is § 1.5.3's finding and the
 * reason the coma coefficients here come from a fit that has had piston, tilt and
 * defocus projected out. `OpdMap.rmsWaves` removes piston alone, so a misaligned
 * system carries a reference-frame tilt that is not blur — a rigidly turned
 * instrument, which cannot have changed, moves ~1e-2 waves in that currency and
 * 4.6e-5 in this one.
 *
 * **Misaligning the FIRST surface is not a misalignment**, and the panel gets
 * this as a free self-check rather than as an assertion. A perturbation carries
 * every surface after it, so perturbing surface 0 moves the whole instrument:
 * tilt it by β and the node moves by **exactly β** — the telescope is not
 * decollimated, it is pointed somewhere else — and shift it and the node does not
 * move **at all**. Those are § 1.5.3's two rigid-motion identities, appearing on
 * screen in a reader's own units. Only an interior surface actually decollimates.
 *
 * ## And where the stop is, which is what § 1.5.3 was for
 *
 * A perturbation moves the stop only when the stop is downstream of it. A
 * refractor's stop is the front element's own rim, so nothing the aim points at
 * moves; put it behind the doublet, as a photographic objective does, and the
 * same misalignment moves it. The third curve is the misaligned system under the
 * old aiming, and `aimingGapFromMisalignmentWaves` is how much of the gap the
 * misalignment caused — several times larger with the stop behind.
 */

export const FOCUS_NM = 587.5618;

/** Which surface a misalignment sits on, and what kind it is. */
export type MisalignKind = "tiltY" | "tiltX" | "decenterY" | "decenterX";

export const MISALIGN_UNIT: Record<MisalignKind, string> = {
  tiltY: "°",
  tiltX: "°",
  decenterY: "mm",
  decenterX: "mm",
};

/** Where the aperture stop sits — the control that decides if aiming matters. */
export type StopPlace = "front" | "rear";

export interface CollimationSpec {
  readonly lens: LensKind;
  readonly apertureMm: number;
  readonly focalLengthMm: number;
  readonly stop: StopPlace;
  /** Index of the misaligned surface. */
  readonly surface: number;
  readonly kind: MisalignKind;
  /** In `MISALIGN_UNIT[kind]`. */
  readonly delta: number;
  /** Half-width of the field sweep, degrees. */
  readonly fieldHalfDeg: number;
  /** Field samples across the whole sweep; odd, so one lands on axis. */
  readonly fieldSamples: number;
  /** Pupil grid resolution across the diameter. */
  readonly pupilSamples: number;
}

export interface CollimationCurve {
  readonly label: string;
  /**
   * [fieldDeg, coma waves] — the signed IN-PLANE coma, Noll 8.
   *
   * COMA, and not the total wavefront error, because the total is the wrong
   * quantity for this panel and measuring it said so: the total is dominated by
   * astigmatism and field curvature, which grow as field² and are symmetric
   * about the axis whatever is misaligned, so its minimum barely moves — 2e-3°
   * for a 0.2° tilt. Coma is the term a misalignment actually displaces, and
   * displacing it is what a collimation screw is for.
   *
   * IN-PLANE and SIGNED, both learned the hard way. Coma is a vector in the
   * field, (Noll 7, Noll 8), and its node is a POINT — so a one-dimensional
   * sweep meets it only if the misalignment lies in the sweep's own plane. The
   * component along the sweep is the one whose zero is the node's position on
   * this axis, and it must be carried with its sign: the magnitude cannot go
   * negative, so it turns a line through zero into a V, and where the
   * perpendicular component dominates into a STEP — which is what this panel
   * drew before it drew a line.
   */
  readonly points: readonly (readonly [number, number])[];
  /** Field where the in-plane coma crosses zero — the node. Linear interpolation. */
  readonly nodeFieldDeg: number;
  /** In-plane coma on axis, waves. Zero for a collimated instrument. */
  readonly axisComaWaves: number;
  /**
   * The largest ACROSS-sweep coma (Noll 7) anywhere on the sweep.
   *
   * Non-zero means the node is off this line entirely — the misalignment has a
   * component perpendicular to the field sweep, and no point the sweep visits
   * nulls the coma. It is on screen because it is the difference between "the
   * node is at −0.008°" and "the node is not on this axis at all", and a reader
   * cannot tell those apart from the curve.
   */
  readonly crossComaWaves: number;
  /** Total balanced wavefront on axis, for context. */
  readonly axisWaves: number;
  /** |coma(+h) − coma(−h)| at the sweep's edge — zero only if the node is centred. */
  readonly asymmetryWaves: number;
}

export interface CollimationResult {
  readonly aligned: CollimationCurve;
  readonly misaligned: CollimationCurve;
  /** The same misaligned system under § 1.5.3's OLD aiming, for comparison. */
  readonly misalignedParaxial: CollimationCurve;
  /** How far the coma node moved off the axis, degrees — the headline. */
  readonly nodeShiftDeg: number;
  /** What the misalignment costs at the point you are actually aiming at. */
  readonly axisPenaltyWaves: number;
  /** Largest gap between the two aiming modes across the sweep, waves. */
  readonly aimingGapWaves: number;
  /**
   * How much of that gap the MISALIGNMENT is responsible for.
   *
   * The two modes differ on an aligned system too, and by more than nothing:
   * § 1.5.3 measures it and gives the reason — paraxial aiming targets the
   * entrance-pupil PLANE and real aiming the curved stop SURFACE, so an off-axis
   * ray crosses them at different heights, and a remote stop adds § 1.5.2's
   * pupil aberration on top. That difference is a property of the lens, present
   * with nothing knocked out of line, and quoting the raw gap as "what the new
   * aiming bought" would be claiming it.
   *
   * So this is the difference of the differences, pointwise: the aiming gap on
   * the misaligned system minus the aiming gap on the aligned one, at the same
   * field. What survives is the part that exists BECAUSE the stop moved.
   */
  readonly aimingGapFromMisalignmentWaves: number;
  /** Rays the pupil lost anywhere in the sweep. Non-zero invalidates the fit. */
  readonly lost: number;
  readonly elapsedMs: number;
}

/** The surfaces a reader may misalign: every one the prescription has. */
export function surfaceCount(spec: Pick<CollimationSpec, "lens">): number {
  return spec.lens === "singlet" ? 2 : 3;
}

/**
 * Glass wider than the beam, and the margin is deliberate.
 *
 * The aperture is set by the STOP — `resolveStopRadius` reads it off the
 * `EPD` spec — while `semiAperture` only clips. Sizing the rims exactly to the
 * beam would put the marginal ray on the rim, where a misalignment walks the
 * footprint sideways and starts losing rays to geometry rather than to physics.
 * The margin keeps the refusal below meaningful: a lost ray then means the
 * misalignment really did walk the beam off the glass.
 */
const RIM_MARGIN = 1.02;

function prescriptionOf(spec: CollimationSpec): Prescription {
  const pair = refractorPair(spec.focalLengthMm, (spec.apertureMm / 2) * RIM_MARGIN, spec.focalLengthMm);
  const base = spec.lens === "singlet" ? pair.singlet : pair.achromat;
  const last = base.surfaces.length - 1;
  return {
    ...base,
    surfaces: base.surfaces.map((s, i) => ({
      ...s,
      isStop: spec.stop === "front" ? i === 0 : i === last,
    })),
  };
}

const perturbed = (p: Prescription, spec: CollimationSpec): Prescription => ({
  ...p,
  surfaces: p.surfaces.map((s, i) =>
    i === spec.surface
      ? { ...s, [spec.kind === "tiltY" ? "tiltYDeg" : spec.kind === "tiltX" ? "tiltXDeg" : spec.kind]: spec.delta }
      : s,
  ),
});

/**
 * The nominal, focused once and then held.
 *
 * Focus is solved on the ALIGNED system and reused for the misaligned ones, on
 * purpose: refocusing each would fold a compensator into the comparison and
 * report a smaller penalty than a reader with a fixed focuser would see. § 5t
 * separates the two deliberately; this panel is about the misalignment, so the
 * focus is a constant.
 */
function systemOf(p: Prescription, spec: CollimationSpec, aim: RayAiming, focusMm: number): OpticalSystem {
  const base: OpticalSystem = {
    prescription: p,
    aperture: { kind: "EPD", value: spec.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: FOCUS_NM, weight: 1 }],
    conjugate: { kind: "infinite" },
    rayAiming: aim,
  };
  return withFocus(base, focusMm);
}

function curve(
  p: Prescription,
  spec: CollimationSpec,
  aim: RayAiming,
  focusMm: number,
  label: string,
): { curve: CollimationCurve; lost: number } {
  const grid = pupilGrid(spec.pupilSamples);
  const system = systemOf(p, spec, aim, focusMm);
  const points: [number, number][] = [];
  let axisWaves = Number.NaN;
  let crossComaWaves = 0;
  let lost = 0;
  for (let i = 0; i < spec.fieldSamples; i++) {
    const t = spec.fieldSamples === 1 ? 0.5 : i / (spec.fieldSamples - 1);
    const fieldDeg = -spec.fieldHalfDeg + 2 * spec.fieldHalfDeg * t;
    const map = opdMap(system, fieldDeg, FOCUS_NM, grid);
    lost += map.lost;
    const fit = fitZernike(map.samples, 15);
    // Coma is a VECTOR in the field, (Noll 7, Noll 8), and its node is a POINT
    // rather than a level — which is the whole reason only the in-plane
    // component is plotted. The field lies in the x–z plane, so Noll 8 (coma x)
    // is the component along the sweep and its zero IS the node's position on
    // this axis; Noll 7 is the component across, which a perpendicular
    // misalignment raises and which no point on this line can null. Plotting the
    // magnitude instead looks reasonable and is wrong: it cannot go negative, so
    // it turns a line through zero into a V — and where the perpendicular
    // component dominates, into a step, because the sign of the vanishing
    // component flips under it. This panel drew that step before it drew this.
    points.push([fieldDeg, coefficient(fit, 8)]);
    crossComaWaves = Math.max(crossComaWaves, Math.abs(coefficient(fit, 7)));
    if (Math.abs(fieldDeg) < 1e-12) axisWaves = balancedRms(fit);
  }

  // Where the coma crosses zero. Linear between the straddling samples, because
  // coma IS linear in field to third order — a parabola through a minimum would
  // be fitting the wrong shape to a curve that has a root rather than a floor.
  let nodeFieldDeg = Number.NaN;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (y0 === 0) nodeFieldDeg = x0;
    else if (y0 < 0 !== y1 < 0) {
      nodeFieldDeg = x0 + ((x1 - x0) * -y0) / (y1 - y0);
      break;
    }
  }

  const axis = points.find(([x]) => Math.abs(x) < 1e-12);
  return {
    lost,
    curve: {
      label,
      points,
      nodeFieldDeg,
      axisComaWaves: axis ? axis[1] : Number.NaN,
      crossComaWaves,
      axisWaves,
      asymmetryWaves: Math.abs(
        Math.abs(points[points.length - 1]![1]) - Math.abs(points[0]![1]),
      ),
    },
  };
}

export function runCollimation(spec: CollimationSpec): CollimationResult {
  const started = Date.now();
  const nominal = prescriptionOf(spec);

  // One focus, solved on the aligned system with real aiming, and reused.
  const seed: OpticalSystem = {
    prescription: nominal,
    aperture: { kind: "EPD", value: spec.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: FOCUS_NM, weight: 1 }],
    conjugate: { kind: "infinite" },
    rayAiming: "real",
  };
  const focusMm = bestFocus(seed, "minRmsWavefront", { wavelengthNm: FOCUS_NM }).offsetFromLastVertex;

  const bent = perturbed(nominal, spec);
  const a = curve(nominal, spec, "real", focusMm, "aligned");
  const b = curve(bent, spec, "real", focusMm, "misaligned");
  const c = curve(bent, spec, "paraxial", focusMm, "misaligned, old aiming");
  // The fourth sweep is never drawn. It exists so the aiming gap can be quoted
  // as what the MISALIGNMENT caused rather than what the lens always had.
  const d = curve(nominal, spec, "paraxial", focusMm, "aligned, old aiming");

  let aimingGapWaves = 0;
  let aimingGapFromMisalignmentWaves = 0;
  for (let i = 0; i < b.curve.points.length; i++) {
    const bent_i = b.curve.points[i]![1] - c.curve.points[i]![1];
    const flat_i = a.curve.points[i]![1] - d.curve.points[i]![1];
    aimingGapWaves = Math.max(aimingGapWaves, Math.abs(bent_i));
    aimingGapFromMisalignmentWaves = Math.max(aimingGapFromMisalignmentWaves, Math.abs(bent_i - flat_i));
  }

  return {
    aligned: a.curve,
    misaligned: b.curve,
    misalignedParaxial: c.curve,
    nodeShiftDeg: b.curve.nodeFieldDeg - a.curve.nodeFieldDeg,
    axisPenaltyWaves: b.curve.axisWaves - a.curve.axisWaves,
    aimingGapWaves,
    aimingGapFromMisalignmentWaves,
    lost: a.lost + b.lost + c.lost + d.lost,
    elapsedMs: Date.now() - started,
  };
}

export interface CollimationJob {
  readonly seq: number;
  readonly request: CollimationSpec;
}

export interface CollimationDone {
  readonly seq: number;
  readonly result: CollimationResult;
}
