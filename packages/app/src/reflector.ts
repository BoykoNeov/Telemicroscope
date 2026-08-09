import {
  cassegrain,
  commercialSct,
  newtonian,
  ritcheyChretien,
  schmidt,
  schmidtCassegrain,
} from "@telemicroscope/core/designs";
import { bestFocus, exitBundle, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem, Prescription } from "@telemicroscope/core/trace";
import { blackbodySpectrum, spectralSamples } from "@telemicroscope/core/photometry";
import { opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { encircledEnergy, psf, spectralStack, type SpiderSpec } from "@telemicroscope/core/wave";
import {
  colorImageFromStack,
  integratedXyz,
  toSrgbBytes,
  type ColorImage,
} from "@telemicroscope/core/imaging";

/**
 * The reflectors — APP.md Part C's preset gap, as one pure adapter.
 *
 * Six designs have existed in `core/designs` since roadmap step 5 and the app
 * has instantiated none of them: it hardcodes `refractorPair`. Nothing below is
 * new physics. Every number is § 4b's, § 5e's, § 5f's, § 5g's, § 5h's or § 5i's,
 * called from the app, so **no validation-ladder rung was added for this** — the
 * boundary APP.md's own "what is scopeable at all" section draws.
 *
 * ## Why the table is all six and the image is one
 *
 * A1's bench traces the whole objective catalogue because the *comparison* is
 * the finding and a selector would hide it behind a click. That reasoning
 * applies here too, but the expensive half is a different half: constructing a
 * reflector is closed-form arithmetic (six of them are microseconds — every
 * radius, conic, separation and obstruction is derived, not solved), while the
 * polychromatic star through one of them is a trace plus a transform per
 * wavelength. So the table is all six and the picture is whichever one is
 * selected.
 *
 * ## The three numbers that drive them, and why they cannot be one
 *
 * A Newtonian and a Schmidt are determined by aperture and focal ratio. The
 * Cassegrain family needs a *third*, the primary's own focal ratio, because its
 * secondary magnifies: m = F/F₁, and F must exceed F₁ for the layout to exist at
 * all. There is no single "focal ratio" that means the same thing to all six,
 * and pretending otherwise would be the fake this repo's rules forbid — so the
 * spec carries all three and each preset consumes what it needs. When F ≤ F₁ the
 * two-mirror family genuinely has no geometry, and the engine says so in its own
 * words; `describeReflectors` puts that sentence in the cell rather than hiding
 * the row, which is what A1 does with the three objectives that wall out.
 *
 * ## The obstruction is a pupil fact, not a traced blocker
 *
 * Every design with a secondary reports `obstruction` as a fraction of the pupil
 * RADIUS — the spelling `PsfOptions` takes — and `newtonian.ts` is explicit that
 * the diagonal is *not* traced as a blocker: it is reported and applied in the
 * pupil function, where a central obstruction belongs. So the picture below
 * needs no engine option beyond passing that number through, and the on-axis
 * trace loses exactly zero rays while a fifth of the pupil is dark. That pairing
 * is § 2f's, and this adapter is where it becomes visible.
 */

export type ReflectorKind =
  | "newtonian"
  | "cassegrain"
  | "ritchey"
  | "schmidt"
  | "schmidt-cassegrain"
  | "sct";

export const REFLECTOR_KINDS: readonly ReflectorKind[] = [
  "newtonian",
  "cassegrain",
  "ritchey",
  "schmidt",
  "schmidt-cassegrain",
  "sct",
];

/** The three numbers all six are derived from. See the header on why not one. */
export interface ReflectorSpec {
  /** Clear aperture of the primary (mm). */
  readonly apertureMm: number;
  /** System focal ratio f/D — the number on the box. */
  readonly focalRatio: number;
  /** Primary focal ratio f₁/D. Used by the Cassegrain family only; F > F₁. */
  readonly primaryFocalRatio: number;
}

/**
 * One row of the table: what the closed forms produced, or why they refused.
 *
 * Deliberately flat and optional-heavy rather than a discriminated union per
 * family. The panel renders one table, and a Ritchey-Chrétien's second conic
 * belongs in the same column as a Cassegrain's whether or not the other five
 * have one — a column that is blank for four rows still says something.
 */
export interface ReflectorRow {
  readonly kind: ReflectorKind;
  /** How the row reads. */
  readonly label: string;
  /** One line on what the design IS — the ladder's own verdict, not a boast. */
  readonly note: string;
  /** The engine's own refusal text when this geometry does not exist. */
  readonly error?: string;
  readonly prescription?: Prescription;
  readonly focalLengthMm?: number;
  /** Fraction of the pupil RADIUS blocked by the secondary. Absent for the Schmidt. */
  readonly obstruction?: number;
  /** Optical surfaces the trace walks — a corrector is two of them. */
  readonly surfaces?: number;
  /** Whether the chain leaves the axis, i.e. needs § 4a's folded frame. */
  readonly folded?: boolean;
  /** Powered-mirror conics, where the design has them to state. */
  readonly primaryConic?: number;
  readonly secondaryConic?: number;
  /** The Schmidt corrector's fourth-order figure (1/mm³), where there is one. */
  readonly correctorA4?: number;
  readonly backFocusMm?: number;
  /** Newtonian only: the diagonal's minor axis (mm) — what the obstruction is. */
  readonly diagonalMinorAxisMm?: number;
}

const LABELS: Record<ReflectorKind, string> = {
  newtonian: "Newtonian",
  cassegrain: "Cassegrain",
  ritchey: "Ritchey-Chrétien",
  schmidt: "Schmidt camera",
  "schmidt-cassegrain": "Schmidt-Cassegrain",
  sct: "commercial SCT",
};

/**
 * What each design is, in the validation ladder's own terms.
 *
 * These are the ladder's verdicts and their limits, not marketing: § 5i is
 * explicit that the all-spherical SCT is NOT an anastigmat and that its
 * off-axis coma and astigmatism remain unpinned, and saying so in the table is
 * the same honesty the guards get.
 */
const NOTES: Record<ReflectorKind, string> = {
  newtonian: "one paraboloid — perfect on axis, coma ∝ θ/F² off it (§ 4b)",
  cassegrain: "confocal conics — exactly stigmatic on axis, coma remains (§ 5e)",
  ritchey: "two hyperboloids — the coma null, pinned against the Cassegrain (§ 5f)",
  schmidt: "corrector at the centre of curvature — an anastigmat (§ 5g)",
  "schmidt-cassegrain": "§ 5g's corrector on § 5e's pair; every number a closed form (§ 5h)",
  sct: "spheres + a corrector nulling their combined SA — NOT an anastigmat (§ 5i)",
};

/**
 * Build all six from one spec, catching the refusals.
 *
 * Cheap enough to run on the main thread on every slider tick: all six are
 * closed-form layout arithmetic with no trace anywhere in them. That is the
 * asymmetry the header describes, and it is why this returns prescriptions
 * rather than images.
 */
export function describeReflectors(spec: ReflectorSpec): readonly ReflectorRow[] {
  return REFLECTOR_KINDS.map((kind) => describeReflector(kind, spec));
}

export function describeReflector(kind: ReflectorKind, spec: ReflectorSpec): ReflectorRow {
  const base = { kind, label: LABELS[kind], note: NOTES[kind] } as const;
  const two = {
    apertureMm: spec.apertureMm,
    focalRatio: spec.focalRatio,
    primaryFocalRatio: spec.primaryFocalRatio,
  };
  try {
    switch (kind) {
      case "newtonian": {
        const s = newtonian({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio });
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          obstruction: s.obstruction,
          surfaces: s.prescription.surfaces.length,
          folded: true,
          primaryConic: -1,
          diagonalMinorAxisMm: s.diagonalMinorAxisMm,
        };
      }
      case "cassegrain": {
        const s = cassegrain(two);
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          obstruction: s.obstruction,
          surfaces: s.prescription.surfaces.length,
          folded: false,
          primaryConic: -1,
          secondaryConic: s.secondaryConic,
          backFocusMm: s.backFocusMm,
        };
      }
      case "ritchey": {
        const s = ritcheyChretien(two);
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          obstruction: s.obstruction,
          surfaces: s.prescription.surfaces.length,
          folded: false,
          primaryConic: s.primaryConic,
          secondaryConic: s.secondaryConic,
          backFocusMm: s.backFocusMm,
        };
      }
      case "schmidt": {
        const s = schmidt({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio });
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          surfaces: s.prescription.surfaces.length,
          folded: false,
          correctorA4: s.correctorA4,
        };
      }
      case "schmidt-cassegrain": {
        const s = schmidtCassegrain(two);
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          obstruction: s.obstruction,
          surfaces: s.prescription.surfaces.length,
          folded: false,
          primaryConic: 0,
          secondaryConic: s.secondaryConic,
          correctorA4: s.correctorA4,
          backFocusMm: s.backFocusMm,
        };
      }
      case "sct": {
        const s = commercialSct(two);
        return {
          ...base,
          prescription: s.prescription,
          focalLengthMm: s.focalLengthMm,
          obstruction: s.obstruction,
          surfaces: s.prescription.surfaces.length,
          folded: false,
          primaryConic: 0,
          secondaryConic: 0,
          correctorA4: s.correctorA4,
          backFocusMm: s.backFocusMm,
        };
      }
    }
  } catch (e) {
    // The engine's own sentence, verbatim. A1's precedent: a design that cannot
    // exist is a finding, and the honest cell is what the engine said about it.
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `newtonian`'s default focus offset, as a fraction of the aperture.
 *
 * Not a physical constant — `newtonian.ts` picks 0.75·D as a plausible
 * tube-plus-focuser and says so, standing in until a mech layer owns barrel
 * sizes. It is named here because the closed form below is a statement *about
 * that convention*, and reading it off the design would hide which of the two
 * numbers is optics.
 */
export const NEWTONIAN_FOCUS_OFFSET_FRACTION = 0.75;

/**
 * The Newtonian's central obstruction in closed form — and it contains no
 * aperture.
 *
 * Working § 4b's sizing through by hand, the minor axis is
 * m = D·(f − d)/(f + z_sag) with d = f − offset and z_sag = −D²/(16f), so
 *
 *     ε = m/D = (offset/D) / (F − 1/(16·F)) = (k/F) / (1 − 1/(16·F²))
 *
 * D cancels completely. So a Newtonian's obstruction is a **mechanical**
 * convention (how far the focal plane sits off the axis, as a fraction of the
 * aperture) divided by the focal ratio — not an optical choice the design makes,
 * which is the opposite of the Cassegrain family, whose ε = s₁/f₁ falls out of
 * the magnification the two mirrors have to supply.
 *
 * The sag term is the interesting half. It is a pure number, 1/(16F²), so it too
 * is aperture-free: at f/5 it makes the diagonal 0.251% wider, which is the
 * 0.25% `newtonian.ts` quotes in its own header, and it is what separates a
 * diagonal that catches the beam from one that shaves it. This function exists so
 * the panel can put the closed form beside the engine's number and let a reader
 * watch the two agree — the app deriving what the engine computed, rather than
 * quoting it.
 */
export function newtonianObstruction(focalRatio: number): number {
  return NEWTONIAN_FOCUS_OFFSET_FRACTION / (focalRatio - 1 / (16 * focalRatio));
}

/**
 * The field at which a minimum diagonal stops passing the **chief ray** — and it
 * has no aperture in it either.
 *
 * Past this the engine does not degrade, it **refuses**: `opdMap` throws
 * `chief ray failed (vignetted)`, because the chief ray defines both the image
 * point and the reference sphere, and a system with no chief ray has no
 * wavefront to be right or wrong about. So this is not a tolerance, it is a wall
 * of the kind the microscope branch kept finding — § 6b's f/4.1, § 6d's NA 0.343,
 * § 6e.4's NA 1.411, § 6q's 0.88·f_e, § 6l's 1.3347 — arriving in the telescope
 * branch, and like § 6l's it is a single line of geometry rather than an
 * aberration budget.
 *
 * The chief ray leaves the primary's vertex (the stop is the primary) toward an
 * image point at f·tan θ, so at the diagonal, distance d along, it stands at
 * d·tan θ. § 4b sizes the flat's clear radius to the marginal beam's footprint,
 * (D/2)·√2·(f − d)/(f − D/2 + z_sag). Setting the two equal and substituting
 * d = D(F − k), f − d = kD, z_sag = −D/(16F):
 *
 *     tan θ_max = (√2·k/2) / [ (F − ½ − 1/(16F)) · (F − k) ]
 *
 * D cancels again, and for large F this is ≈ √2·k/(2F²) — so the diagonal-limited
 * field closes as **1/F²**, measured 1.5935° at f/5 against 0.3460° at f/10.
 *
 * Which runs *opposite* to § 4b's coma. A Newtonian's off-axis coma grows as
 * θ·D/(32F²), so a fast one is comatic sooner per degree while its minimum
 * diagonal passes several times more field; the two effects both carry 1/F² and
 * point in opposite directions, which is why "how fast should a Newtonian be" has
 * no answer that is only about aberration.
 */
export function chiefRayFieldLimitDeg(focalRatio: number): number {
  const k = NEWTONIAN_FOCUS_OFFSET_FRACTION;
  const tan =
    ((Math.SQRT2 * k) / 2) / ((focalRatio - 0.5 - 1 / (16 * focalRatio)) * (focalRatio - k));
  return (Math.atan(tan) * 180) / Math.PI;
}

/**
 * Below this, `dispersionAiryRadii` is not a measurement.
 *
 * The three all-mirror members contain no glass and so cannot disperse at all,
 * and they read 1.1e-2 to 2.6e-2 — wandering non-monotonically as the grid
 * refines (the Newtonian: 1.72e-2, 1.20e-2, 1.67e-2 at pupilSamples 32/64/128),
 * so it is neither resolution nor optics. It is `spectralStack`'s common-grid
 * step: `pixelScaleMm` is ∝ λ, so every plane is resampled onto the mean
 * wavelength's grid and the red planes are cropped where the blue ones are
 * padded, biasing an energy-weighted mean radius by a λ-dependent amount.
 *
 * The floor is therefore stated as a refusal rather than subtracted. Anything at
 * this level is the ruler, and the panel says so instead of drawing it.
 */
export const DISPERSION_FLOOR_AIRY_RADII = 0.03;

/** Focus wavelength for every reflector below — one criterion, one line. */
const FOCUS_NM = 550;

/**
 * Wrap a prescription as a system and put it in focus.
 *
 * `stopRadius` rather than `EPD`, matching what every one of these presets is
 * validated through in `core/test`: the stop is the primary (or the corrector)
 * and its radius is the aperture the design was derived from, so declaring an
 * entrance-pupil diameter instead would re-derive a number the design already
 * owns. Focus by minimum RMS wavefront at one wavelength for all six, so a
 * comparison between them measures the optics rather than six focus criteria.
 */
export function reflectorSystem(
  row: ReflectorRow,
  spec: ReflectorSpec,
  temperatureK: number,
  wavelengths: number,
): OpticalSystem {
  if (!row.prescription) throw new Error(`${row.label}: ${row.error ?? "no prescription"}`);
  const base: OpticalSystem = {
    prescription: row.prescription,
    aperture: { kind: "stopRadius", value: spec.apertureMm / 2 },
    field: { kind: "angle", values: [0] },
    wavelengths: spectralSamples(blackbodySpectrum(temperatureK), { count: wavelengths }),
    conjugate: { kind: "infinite" },
  };
  return withFocus(
    base,
    bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM }).offsetFromLastVertex,
  );
}

export interface ReflectorRequest {
  readonly kind: ReflectorKind;
  readonly spec: ReflectorSpec;
  readonly sourceTemperatureK: number;
  readonly wavelengths: number;
  readonly pupilSamples: number;
  /** Display gain: white is a pixel holding 1/`whiteFraction` of the frame. */
  readonly whiteFraction: number;
  /** Apply the design's own central obstruction. Off is the ε = 0 control. */
  readonly obstruct: boolean;
  /**
   * The vanes holding the secondary, if any (§ 5c).
   *
   * Passed straight through to `PsfOptions`. Nothing here computes a spike: a
   * vane is an opaque bar, the transform of a bar is a streak perpendicular to
   * it, and the FFT produces both for the same reason it produces the Airy
   * rings. This adapter's only contribution is that the *same* spec reaches the
   * pupil function, so the geometric branch's ray-drop and the FFT branch's
   * amplitude zero cannot disagree about where the vanes are.
   */
  readonly spider?: SpiderSpec;
  /**
   * Field angle, degrees. Nonzero is what makes § 2f's vignetting happen.
   *
   * There is deliberately **no vignetting option**. `psf()` builds a
   * `vignetteMask` by itself, and only when the trace already lost rays, so the
   * criterion is the trace and an unvignetted system never pays for it. A field
   * angle is therefore the whole input: a minimum diagonal is sized to the
   * on-axis cone, so any off-axis bundle spills past its rim.
   */
  readonly fieldDeg: number;
}

export interface ReflectorResult {
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  readonly image: ColorImage;
  readonly pixelScaleMm: number;
  readonly elapsedMs: number;
  readonly fNumber: number;
  readonly focalLengthMm: number;
  readonly airyRadiusMm: number;
  /** The ε that was applied — 0 when the control is on, or for the Schmidt. */
  readonly obstruction: number;
  /**
   * Chromatic spread of the halo in Airy radii, the same energy-weighted
   * mean-radius measure `render.ts` uses on the refractor — kept verbatim, and
   * **it is not zero on a mirror.**
   *
   * That was this adapter's own wrong prediction and it is worth keeping on
   * screen rather than quietly replacing. A Newtonian contains no glass, so it
   * has no dispersion at all, and this number still reads ~0.36 Airy radii on
   * it. The reason is in the denominator: every plane's mean radius is divided
   * by ONE Airy radius, the focus wavelength's, while the Airy pattern itself
   * scales as λ. So a dispersion-free system spreads simply because red
   * diffracts wider than blue, and the measure counts that as fringing.
   *
   * Nothing is wrong with § 3b's use of it — there it compares a singlet against
   * an achromat at the same aperture and focal length, so the λ-scaling floor is
   * common to both and cancels in the comparison. As an *absolute* number it
   * does not, which is what a panel with no second lens beside it exposes.
   */
  readonly fringeAiryRadii: number;
  /**
   * The same spread with each plane divided by **its own** Airy radius — the
   * measure that is actually zero when nothing disperses.
   *
   * λ cancels, so what is left is only the wavelength-to-wavelength change in
   * where the light lands *relative to its own diffraction scale*. An all-mirror
   * design reads the f64 floor; the two Schmidt-corrected members and the SCT do
   * not, because a corrector plate is glass and § 5g's figure is exact at one
   * wavelength only. That is the chromatic half § 5g–§ 5i left open, arriving as
   * a number rather than as a caveat.
   */
  readonly dispersionAiryRadii: number;
  /**
   * Encircled energy inside the unobstructed Airy first zero, and the same
   * fraction with ε = 0 — the obstruction's cost to the core, measured.
   *
   * One monochromatic transform each at the focus wavelength, so the pair is a
   * *control* on one grid rather than two polychromatic stacks differenced.
   */
  readonly coreEnergy: number;
  readonly clearCoreEnergy: number;
  readonly strehl: number;
  readonly truncatedFraction: number;
  readonly geometricWeight: number;
  readonly fieldDeg: number;
  /**
   * Light this field angle keeps, against what the SAME pupil keeps on axis.
   *
   * The denominator is the load-bearing choice and § 2f says why in its own
   * words: a first draft of its rung read `onAxis / onAxis` and was 1 by
   * construction however badly the diagonal were sized. So the reference here is
   * the *on-axis* transform of the same system with the same obstruction and the
   * same vanes — both of which cancel — leaving the diagonal's clipping and
   * nothing else. On axis this is exactly 1 because § 4b's diagonal is derived to
   * be tangent to the on-axis cone, which is a statement that can go red.
   */
  readonly transmittedFraction: number;
  /**
   * The same fraction counted a completely different way: rays that physically
   * cleared the diagonal, over rays launched.
   *
   * An area integral over a masked pupil and a count of surviving rays share no
   * code path — the second never builds a mask and never runs an FFT — so their
   * agreement is evidence rather than bookkeeping. § 2f pins them 1.2e-4 apart on
   * its own geometry; here the panel measures the gap live.
   */
  readonly rayFraction: number;
  /** Rays the trace lost at this field, of `rayGrid` requested. */
  readonly rayLost: number;
  readonly rayRequested: number;
  /**
   * Where a vane's first dark point lands, in pixels — `padFactor/widthFraction`.
   *
   * Not a warning but a measurement, and the honest guard for this panel: a spike
   * is a sinc whose first zero sits at that radius regardless of aperture or
   * focal length, so a *realistic* vane (w = D/50) throws it 200 px out and off a
   * 256-pixel grid entirely. § 5c's validation vanes are deliberately fat for
   * exactly this reason. Compared against the grid half-width below, so a reader
   * can see the spike leave the frame rather than wonder where it went.
   */
  readonly spikeFirstZeroPx: number;
  readonly gridHalfPx: number;
}

/** One point of the throughput-against-field sweep. */
export interface VignettePoint {
  readonly fieldDeg: number;
  /** FFT route: masked pupil energy over the on-axis pupil's. */
  readonly fftFraction: number;
  /** Ray route: survivors over launched, on the same field. */
  readonly rayFraction: number;
}

export interface VignetteSweep {
  readonly points: readonly VignettePoint[];
  /** Largest |FFT − ray| across the sweep: the two routes' live disagreement. */
  readonly maxDisagreement: number;
  /** The measured chief-ray wall (degrees) — bisected, not quoted. */
  readonly chiefRayLimitDeg: number;
  /** What `chiefRayFieldLimitDeg` predicts for the same geometry. */
  readonly predictedLimitDeg: number;
  readonly elapsedMs: number;
}

export interface VignetteRequest {
  readonly kind: ReflectorKind;
  readonly spec: ReflectorSpec;
  readonly maxFieldDeg: number;
  readonly points: number;
  readonly pupilSamples: number;
  /** Rays per pupil diameter for the independent count. */
  readonly rayGrid: number;
}

export interface VignetteJob {
  readonly seq: number;
  readonly request: VignetteRequest;
}

export interface VignetteDone {
  readonly seq: number;
  readonly result: VignetteSweep;
}

export interface ReflectorJob {
  readonly seq: number;
  readonly request: ReflectorRequest;
}

export interface ReflectorDone {
  readonly seq: number;
  readonly result: ReflectorResult;
}

/**
 * The Airy first zero in PIXELS on this grid.
 *
 * 1.22·size/pupilSamples = 1.22·padFactor, independent of the system's scale —
 * the identity `psfFromPupilFunction` documents. Written once so the encircled
 * energy below and the panel's caption cannot disagree about where the core ends.
 */
const PAD_FACTOR = 4;
const AIRY_ZERO_PX = 1.22 * PAD_FACTOR;

/**
 * Rays per pupil diameter for the independent survivor count.
 *
 * A ray count of a curved region converges more raggedly than a subdivided edge
 * — § 2f measures ~5e-4 for the lattice against 1.6e-5 for the area — so this is
 * the number that sets how tightly the two routes can be expected to agree, and
 * it is named rather than inlined for that reason.
 */
const RAY_GRID = 101;

/** A star through one reflector: trace, transform, stack, expose. */
export function renderReflector(request: ReflectorRequest): ReflectorResult {
  const started = performance.now();
  const row = describeReflector(request.kind, request.spec);
  const system = reflectorSystem(
    row,
    request.spec,
    request.sourceTemperatureK,
    request.wavelengths,
  );
  const obstruction = request.obstruct ? (row.obstruction ?? 0) : 0;
  const options = {
    pupilSamples: request.pupilSamples,
    padFactor: PAD_FACTOR,
    traceSamples: 21,
    ...(obstruction > 0 ? { obstruction } : {}),
    ...(request.spider ? { spider: request.spider } : {}),
  } as const;

  const stack = spectralStack(system, request.fieldDeg, options);
  const image = colorImageFromStack(stack);
  const elapsedMs = performance.now() - started;

  // The core/ring pair, monochromatic and on ONE grid: the same system, the
  // same wavelength, the same transform, with the obstruction the only thing
  // that differs. Differencing two polychromatic stacks would have measured the
  // spectrum as well as the annulus.
  const obstructed = psf(system, request.fieldDeg, FOCUS_NM, options);
  const clear = psf(system, request.fieldDeg, FOCUS_NM, { ...options, obstruction: 0 });
  // The vignetting reference: the SAME pupil on axis. See `transmittedFraction`
  // on why the denominator cannot be this field's own energy.
  const onAxis =
    request.fieldDeg === 0 ? obstructed : psf(system, 0, FOCUS_NM, options);
  const rays = exitBundle(system, request.fieldDeg, FOCUS_NM, pupilGrid(RAY_GRID));

  const f = row.focalLengthMm ?? request.spec.apertureMm * request.spec.focalRatio;
  const naImage = request.spec.apertureMm / (2 * f);
  const airyRadiusMm = (1.22 * FOCUS_NM * 1e-6) / (2 * naImage);

  // Energy-weighted mean radius per wavelength; its spread across the spectrum
  // is the fringing. Same measure the refractor panel and § 3b's rungs use.
  const radii = stack.planes.map((plane) => {
    const c = stack.size / 2;
    let acc = 0;
    let total = 0;
    for (let y = 0; y < stack.size; y++) {
      for (let x = 0; x < stack.size; x++) {
        const v = plane.intensity[y * stack.size + x]!;
        if (v === 0) continue;
        acc += v * Math.hypot(x - c, y - c);
        total += v;
      }
    }
    return total > 0 ? (acc / total) * stack.pixelScaleMm : 0;
  });
  // The same radii against each plane's OWN Airy radius, which is ∝ λ. See the
  // two result fields: this is the one that vanishes when nothing disperses.
  const scaled = stack.planes.map((plane, i) => radii[i]! / (airyRadiusMm * (plane.nm / FOCUS_NM)));

  const totalY = integratedXyz(image).y;
  return {
    rgba: toSrgbBytes(image, { exposure: 1 / (totalY * request.whiteFraction) }),
    size: image.width,
    image,
    pixelScaleMm: image.pixelScaleMm,
    elapsedMs,
    fNumber: f / request.spec.apertureMm,
    focalLengthMm: f,
    airyRadiusMm,
    obstruction,
    fringeAiryRadii: (Math.max(...radii) - Math.min(...radii)) / airyRadiusMm,
    dispersionAiryRadii: Math.max(...scaled) - Math.min(...scaled),
    coreEnergy: encircledEnergy(obstructed, AIRY_ZERO_PX),
    clearCoreEnergy: encircledEnergy(clear, AIRY_ZERO_PX),
    strehl: obstructed.strehl,
    truncatedFraction: stack.truncatedFraction,
    geometricWeight: Math.max(...stack.planes.map((p) => p.geometricWeight)),
    fieldDeg: request.fieldDeg,
    transmittedFraction: onAxis.energy > 0 ? obstructed.energy / onAxis.energy : 0,
    rayFraction: rays.rays.length / (rays.rays.length + rays.lost),
    rayLost: rays.lost,
    rayRequested: rays.rays.length + rays.lost,
    spikeFirstZeroPx: request.spider ? PAD_FACTOR / request.spider.widthFraction : 0,
    gridHalfPx: stack.size / 2,
  };
}

/**
 * Throughput against field angle — § 2f's mechanism as a curve, twice over.
 *
 * Two routes per point, and they share no code: an area integral over the masked
 * FFT pupil, and a count of rays that physically cleared the diagonal. Plotting
 * both is the point. § 2f pins them 1.2e-4 apart on its own geometry and the
 * panel is where that agreement stops being a number in a document.
 *
 * The on-axis transform is computed **once** and reused as every point's
 * denominator, which is both cheaper and the only correct thing: a per-point
 * denominator would be the self-ratio § 2f warns about.
 */
export function vignetteSweep(request: VignetteRequest): VignetteSweep {
  const started = performance.now();
  const row = describeReflector(request.kind, request.spec);
  const system = reflectorSystem(row, request.spec, 5800, 1);
  const options = {
    pupilSamples: request.pupilSamples,
    padFactor: PAD_FACTOR,
    traceSamples: 21,
    ...(row.obstruction ? { obstruction: row.obstruction } : {}),
  } as const;

  // Find the wall first, because the sweep has to stay inside it — past it there
  // is no chief ray, so there is no number to plot rather than a small one.
  // Bisected on a 3-point pupil, which is all the criterion needs: the chief ray
  // is the pupil centre and `opdMap` traces it before anything else.
  const chiefRayLimitDeg = bisectChiefRayLimit(system, request.maxFieldDeg);
  const ceiling = Math.min(request.maxFieldDeg, 0.98 * chiefRayLimitDeg);

  const reference = psf(system, 0, FOCUS_NM, options).energy;
  const grid = pupilGrid(request.rayGrid);

  const points: VignettePoint[] = [];
  let maxDisagreement = 0;
  for (let i = 0; i < request.points; i++) {
    const fieldDeg = (i / (request.points - 1)) * ceiling;
    const fftFraction = psf(system, fieldDeg, FOCUS_NM, options).energy / reference;
    const bundle = exitBundle(system, fieldDeg, FOCUS_NM, grid);
    // Survivors over LAUNCHED, so this is a true transmitted fraction rather than
    // two equally-clipped counts divided by each other (§ 2f's empty-rung note).
    const rayFraction = bundle.rays.length / grid.length;
    points.push({ fieldDeg, fftFraction, rayFraction });
    maxDisagreement = Math.max(maxDisagreement, Math.abs(fftFraction - rayFraction));
  }
  return {
    points,
    maxDisagreement,
    chiefRayLimitDeg,
    predictedLimitDeg: chiefRayFieldLimitDeg(request.spec.focalRatio),
    elapsedMs: performance.now() - started,
  };
}

/**
 * The largest field angle whose chief ray still clears every surface.
 *
 * The criterion is the engine's own refusal — `opdMap` throwing — rather than a
 * reimplementation of the clip test, which is the same discipline § 2f used in
 * making the trace itself the vignetting criterion. 40 halvings takes it to f64,
 * and each probe traces three rays.
 */
function bisectChiefRayLimit(system: OpticalSystem, searchTo: number): number {
  const passes = (fieldDeg: number): boolean => {
    try {
      opdMap(system, fieldDeg, FOCUS_NM, pupilGrid(3));
      return true;
    } catch {
      return false;
    }
  };
  // Walk outward first: the wall may lie beyond whatever the caller asked for,
  // in which case the sweep is simply unconstrained and the number is still worth
  // reporting.
  let hi = Math.max(searchTo, 0.05);
  for (let i = 0; i < 12 && passes(hi); i++) hi *= 2;
  if (passes(hi)) return hi;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (passes(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
