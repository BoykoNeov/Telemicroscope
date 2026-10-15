import { paraxialImageOffset } from "@telemicroscope/core/analysis";
import { COVERSLIP_MEDIUM, coverslipSurface, reducedEye } from "@telemicroscope/core/designs";
import {
  brightfieldSpectralStack,
  colorImageFromStack,
  integratedXyz,
  resampleToSensor,
  toSrgbBytes,
  type ColorImage,
} from "@telemicroscope/core/imaging";
import type { SpectralSpecimen } from "@telemicroscope/core/imaging";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { WHITE_OVER_MEAN } from "./brightfield";
import { buildMicroscope, liveFields, type BuildSpec } from "./builder";
import { LAMBDA_NM } from "./microscope";
import { AppRefusal, refused, type Refused } from "./refusal";
import { expose, lampSamples, maxCoherenceParameter, sourceOf, type LampKind } from "./section";
import { specimenOf, type SpecimenKind } from "./specimens";

/**
 * The whole microscope, one part at a time — APP.md's Part S, as pure functions.
 *
 * `render.ts`'s commitment kept again: numbers in, numbers out, no DOM. The
 * diagram's every control lands here as a change to the INSTRUMENT — the traced
 * system, the specimen's position, the detector — and the picture is the colour
 * section's own engine path (§ 6r's polychromatic Abbe sum, seeded since § 6ct
 * so high power renders) through that instrument. Nothing here draws an effect;
 * each control changes something the trace or the sampler then has to answer to.
 *
 * ## What each part is, physically
 *
 * - **Lamp** — the source spectrum (`section.ts`'s two).
 * - **Condenser** — S = NA_cond/NA_obj, the aperture diaphragm. A dry condenser
 *   cannot exceed NA ≈ 0.95 and an oiled one ≈ 1.4, so on an oil objective the
 *   diaphragm's range is capped by which one is fitted (`condenserCap`).
 * - **Stage** — moves the SLIDE: x/y pans the specimen under the objective, and
 *   focus moves the objective along the axis by changing the gap in front of
 *   it (air, or the oil film). Not the image plane: `coverslip.ts` measures
 *   that refocusing on the image side is a different instrument, wrong by an
 *   order of magnitude for immersion.
 * - **Cover slip** — the specimen's depth in glass. An objective designed for a
 *   slip meets a different thickness unchanged (`slipSystem`'s rule: nothing is
 *   re-solved); one designed bare can be given a slip it never expected. Either
 *   way the focus knob is what a user then turns, and what is left after
 *   refocusing is the aberration.
 * - **Objective** — a `BuildSpec`, so every refusal is the builder's.
 * - **Tube lens** — on an infinity objective, a tube lens of another focal
 *   length (the objective still solved for its own); on a DIN objective, a
 *   longer or shorter mechanical tube — the sensor moves and the objective must
 *   be refocused to reach it, which is how a DIN tube error shows up.
 * - **Detector** — a camera's pixels, or an eye behind an eyepiece. Both are
 *   `resampleToSensor` — the engine's area-integrating sampler — at a pitch in
 *   the IMAGE plane, because that is the plane the colour image's
 *   `pixelScaleMm` is in. Magnification therefore enters through the trace and
 *   is never multiplied in by hand.
 */

/** Typical upper NA of a dry condenser, and of an oiled one (Abbe/aplanatic). */
export const CONDENSER_NA: Record<CondenserKind, number> = { dry: 0.95, oiled: 1.4 };
export type CondenserKind = "dry" | "oiled";

/** S moves in eighths: S·pupilSamples must be a whole number for the commensurate
 * source at both 32 and 64 samples, and 1/8 is the coarsest step that always is. */
export const S_STEP = 1 / 8;

/**
 * Foveal cone spacing, centre to centre (mm), for a triangular mosaic at the
 * mean peak density of Curcio, Sloan, Kalina & Hendrickson, "Human
 * photoreceptor topography", J. Comp. Neurol. 292:497–523 (1990): 199 000
 * cones/mm² (individual peaks 100 000–324 000). A triangular lattice of density
 * ρ has spacing √(2/(√3·ρ)) — 2.41 µm.
 */
export const CONE_DENSITY_PER_MM2 = 199_000;
export const CONE_SPACING_MM = Math.sqrt(2 / (Math.sqrt(3) * CONE_DENSITY_PER_MM2));

/**
 * The angle one cone subtends (rad): its spacing over the engine's reduced
 * eye's posterior nodal distance (1/F, 16.7 mm at the relaxed 60 D). ≈ 0.50
 * arcmin, so two cones are the 1-arcmin 20/20 definition.
 */
export const CONE_ANGLE_RAD = CONE_SPACING_MM / reducedEye({ pupilDiameterMm: 3 }).posteriorNodalDistanceMm;

/** The near point an eyepiece's magnification is quoted against (mm). */
export const EYE_NEAR_POINT_MM = 250;

export type Detector =
  | { readonly kind: "camera"; readonly pitchUm: number }
  | { readonly kind: "eye"; readonly eyepieceFocalMm: number };

/** Detector pitch in the IMAGE plane (mm) — what `resampleToSensor` is handed. */
export function detectorPitchMm(detector: Detector): number {
  return detector.kind === "camera"
    ? detector.pitchUm / 1000
    : detector.eyepieceFocalMm * CONE_ANGLE_RAD;
}

export interface ScopeRequest {
  readonly lamp: LampKind;
  /** S = NA_cond/NA_obj. A multiple of `S_STEP`. */
  readonly coherenceParameter: number;
  readonly specimen: SpecimenKind;
  /** Where the slide has been moved to (µm): the specimen point under the axis. */
  readonly stageUm: { readonly x: number; readonly y: number };
  /** The objective's distance from the slide, relative to its design (µm, + = farther). */
  readonly focusUm: number;
  /** Cover slip actually on the slide (mm), or `null` for whatever the objective was designed for. */
  readonly slipMm: number | null;
  readonly objective: BuildSpec;
  /**
   * Infinity: the tube lens's focal length (mm). DIN: the mechanical tube's
   * length change from design (mm), as a length. `null` = as designed.
   */
  readonly tubeMm: number | null;
  readonly detector: Detector;
  readonly pupilSamples: number;
  readonly size: number;
  readonly wavelengths: number;
}

/**
 * Where each slide starts on the stage (µm): a point with structure inside a
 * 5 µm window AND a 60 µm one, so a 100× field (≈5 µm across) does not open on
 * the empty glass between two diatoms while a 4× field (≈70 µm) still shows
 * several. Found by scanning each specimen's transmittance at 550 nm over
 * ±150 µm in 2 µm steps and keeping the best min(σ₅, σ₆₀) — moving the slide,
 * which is what a user would do, not a change to any specimen.
 */
export const STAGE_HOME: Record<SpecimenKind, { readonly x: number; readonly y: number }> = {
  ruled: { x: -142, y: -150 },
  diatom: { x: -82, y: 122 },
  section: { x: -62, y: 16 },
};

/** Depth of focus at the d line, λ/NA² (µm) — the focus knob's natural unit. */
export const depthOfFocusUm = (numericalAperture: number): number =>
  (LAMBDA_NM * 1e-3) / (numericalAperture * numericalAperture);

/** The DIN mechanical tube every catalogue DIN objective is quoted against (mm). */
export const DIN_TUBE_MM = 160;

/** True when the system starts with a plane plate the specimen sits under. */
function hasPlate(system: OpticalSystem): boolean {
  const p = system.prescription;
  const s0 = p.surfaces[0];
  // Not `semiAperture === Infinity`: on the oil forms the slip's top face is
  // also the aperture stop, so it carries a rim.
  return p.objectMedium !== undefined && p.objectMedium !== "AIR" && s0 !== undefined && s0.curvature === 0;
}

const finiteDistance = (system: OpticalSystem): number => {
  if (system.conjugate.kind !== "finite") throw new Error("a microscope has a finite object");
  return system.conjugate.distance;
};

/**
 * The slide's cover slip, set to `thicknessMm`.
 *
 * On an objective that looks through a plate (the oil forms, or a DIN doublet
 * built for a slip) the specimen's depth in it changes and nothing else — the
 * gap in front of the objective stays where it was. On a bare objective a
 * plate is inserted in the same physical place: the slip's top face takes the
 * medium the specimen used to sit at the end of.
 */
export function withSlip(system: OpticalSystem, thicknessMm: number): OpticalSystem {
  if (!(thicknessMm > 0)) throw new AppRefusal("a cover slip needs a positive thickness");
  if (hasPlate(system)) {
    return { ...system, conjugate: { kind: "finite", distance: thicknessMm } };
  }
  const airMm = finiteDistance(system) - thicknessMm;
  if (!(airMm > 0)) {
    throw new AppRefusal(
      `a ${thicknessMm} mm slip does not fit: this objective works ${finiteDistance(system).toFixed(3)} mm from the specimen`,
    );
  }
  return {
    ...system,
    prescription: {
      ...system.prescription,
      objectMedium: COVERSLIP_MEDIUM,
      // The gap keeps whatever the objective sat in — air, or oil on a bare immersion design.
      surfaces: [coverslipSurface(airMm, system.prescription.objectMedium ?? "AIR"), ...system.prescription.surfaces],
    },
    conjugate: { kind: "finite", distance: thicknessMm },
  };
}

/** The objective moved `deltaMm` farther from the slide — the gap in front of it grows. */
export function withObjectiveMoved(system: OpticalSystem, deltaMm: number): OpticalSystem {
  if (deltaMm === 0) return system;
  if (hasPlate(system)) {
    const [s0, ...rest] = system.prescription.surfaces;
    const gap = s0!.thickness + deltaMm;
    if (!(gap > 0)) throw new AppRefusal("the objective has been driven into the cover slip");
    return {
      ...system,
      prescription: { ...system.prescription, surfaces: [{ ...s0!, thickness: gap }, ...rest] },
    };
  }
  const distance = finiteDistance(system) + deltaMm;
  if (!(distance > 0)) throw new AppRefusal("the objective has been driven into the specimen");
  return { ...system, conjugate: { kind: "finite", distance } };
}

/** Where the image plane (the sensor) sits, from the last vertex (mm). */
export function sensorOffsetMm(system: OpticalSystem): number {
  const surfaces = system.prescription.surfaces;
  return system.imageSurface?.offsetFromLastVertex ?? surfaces[surfaces.length - 1]!.thickness;
}

/** The sensor moved `deltaMm` farther from the last lens — a longer DIN tube. */
export function withSensorMoved(system: OpticalSystem, deltaMm: number): OpticalSystem {
  if (deltaMm === 0) return system;
  return {
    ...system,
    imageSurface: { ...system.imageSurface, offsetFromLastVertex: sensorOffsetMm(system) + deltaMm },
  };
}

/**
 * The objective position (mm, relative to `system`'s) that puts the paraxial
 * image back on the sensor — what turning the focus knob until it is sharp
 * does, to first order. Secant on `paraxialImageOffset`, which is linear in
 * the gap to within the longitudinal magnification's own curvature; a handful
 * of first-order traces.
 */
export function paraxialRefocusMm(system: OpticalSystem, wavelengthNm = LAMBDA_NM): number {
  const target = sensorOffsetMm(system);
  const miss = (dz: number) => paraxialImageOffset(withObjectiveMoved(system, dz), wavelengthNm) - target;
  let a = 0;
  let fa = miss(a);
  let b = 1e-4;
  let fb = miss(b);
  for (let i = 0; i < 30 && Math.abs(fb) > 1e-10; i++) {
    const next = b - (fb * (b - a)) / (fb - fa);
    a = b;
    fa = fb;
    b = next;
    fb = miss(b);
  }
  return b;
}

/** The slide moved so `stage` sits on the axis: the specimen read at x + sx. */
function onStage(specimen: SpectralSpecimen, stageUm: { x: number; y: number }): SpectralSpecimen {
  if (stageUm.x === 0 && stageUm.y === 0) return specimen;
  const sx = stageUm.x / 1000;
  const sy = stageUm.y / 1000;
  return (x, y, nm) => specimen(x + sx, y + sy, nm);
}

/** The instrument the request describes, before the specimen is under it. */
export function scopeSystem(request: ScopeRequest): OpticalSystem {
  const infinity = request.objective.architecture === "infinity";
  const built = buildMicroscope(
    request.objective,
    infinity && request.tubeMm !== null ? { tubeFocalLengthMm: request.tubeMm } : {},
  );
  let system = built.system;
  if (!infinity && request.tubeMm !== null) system = withSensorMoved(system, request.tubeMm - DIN_TUBE_MM);
  if (request.slipMm !== null) system = withSlip(system, request.slipMm);
  return withObjectiveMoved(system, request.focusUm / 1000);
}

/** Largest S the diaphragm may open to: the grid's cap, the condenser's NA, in eighths. */
export function condenserCap(
  size: number,
  pupilSamples: number,
  objectiveNA: number,
  condenser: CondenserKind,
): number {
  const grid = maxCoherenceParameter(size, pupilSamples);
  const optics = CONDENSER_NA[condenser] / objectiveNA;
  return Math.max(0, Math.floor(Math.min(grid, optics) / S_STEP + 1e-9) * S_STEP);
}

export interface ScopeReadout {
  /** What reaches the image plane, at the optical grid. RGBA, `size`². */
  readonly optical: Uint8ClampedArray<ArrayBuffer>;
  readonly size: number;
  /** What the detector records. RGBA, `cols`². */
  readonly recorded: Uint8ClampedArray<ArrayBuffer>;
  readonly cols: number;
  /** Specimen across the frame (µm), on the ruler plane. */
  readonly objectSpanUm: number;
  /** Traced lateral magnification at the image plane, unsigned. */
  readonly magnification: number;
  /** One optical-grid pixel, on the specimen (µm). */
  readonly opticalPixelUm: number;
  /** One detector pixel (or cone), on the specimen (µm). */
  readonly detectorPixelUm: number;
  /** Abbe's limit for this condenser, λ_mean/(NA_obj + NA_cond) (µm). */
  readonly abbeLimitUm: number;
  /**
   * The focus setting (µm, the request's own scale) that would make the paraxial
   * image sharp — or `null` when no objective position reaches it: a slip too
   * thick for the oil film is the case that hits it, and it is a finding
   * (`coverslip.ts`: the thick end is where the film runs out), not a failure.
   */
  readonly sharpFocusUm: number | null;
  readonly verdict: "valid" | "unknown" | "no-honest-image";
  readonly verdictReason: string;
  readonly verdictNm: number;
  readonly planes: readonly { readonly nm: number; readonly verdict: string }[];
  readonly sourcePoints: number;
  readonly elapsedMs: number;
}

export type ScopeResult = { readonly ok: true; readonly readout: ScopeReadout } | Refused;

export interface ScopeJob {
  readonly seq: number;
  readonly request: ScopeRequest;
}

export interface ScopeDone {
  readonly seq: number;
  readonly result: ScopeResult;
}

const VERDICT_RANK = { valid: 0, unknown: 1, "no-honest-image": 2 } as const;

/** `paraxialRefocusMm` in the request's scale, or `null` if the gap would close first. */
function reachableFocusUm(system: OpticalSystem, focusUm: number): number | null {
  try {
    return focusUm + paraxialRefocusMm(system) * 1e3;
  } catch (cause) {
    if (cause instanceof AppRefusal) return null;
    throw cause;
  }
}

/** The detector's frame: square, centred, as many whole pixels as the image holds. */
function record(image: ColorImage, pitchMm: number): ColorImage {
  const extentMm = image.width * image.pixelScaleMm;
  const cols = Math.max(1, Math.min(512, Math.floor(extentMm / pitchMm)));
  return resampleToSensor(image, { pixelPitchMm: pitchMm, cols, rows: cols });
}

/** One render of the instrument: the optical image, and what the detector made of it. */
export function renderScope(request: ScopeRequest): ScopeResult {
  const started = performance.now();
  try {
    const system = scopeSystem(request);
    const samples = lampSamples(request.lamp, request.wavelengths);
    const source = sourceOf(request.coherenceParameter, request.pupilSamples);
    const specimen = onStage(specimenOf(request.specimen).specimen, request.stageUm);

    const stack = brightfieldSpectralStack(system, specimen, source, {
      size: request.size,
      pupilSamples: request.pupilSamples,
      samples,
      patches: 1,
      radialMapNodes: 32,
      layout: "exit",
      radialMapSeed: "magnification",
    });
    const image = colorImageFromStack(stack);
    const pitchMm = detectorPitchMm(request.detector);
    const recorded = record(image, pitchMm);
    const cols = recorded.width;
    const meanY = integratedXyz(recorded).y / (cols * cols);

    let worst = stack.planes[0]!;
    for (const p of stack.planes) {
      if (VERDICT_RANK[p.fidelity?.verdict ?? "unknown"] > VERDICT_RANK[worst.fidelity?.verdict ?? "unknown"]) {
        worst = p;
      }
    }
    const ruler = stack.planes.find((p) => p.resampleRatio === 1);
    if (ruler?.frame === undefined) throw new Error("no plane is the stack's own ruler — its scale cannot be read");
    const magnification = Math.abs(ruler.frame.magnification);
    const na = request.objective.numericalAperture;
    const meanNm = samples.reduce((s, x) => s + x.nm * x.weight, 0) / samples.reduce((s, x) => s + x.weight, 0);

    return {
      ok: true,
      readout: {
        optical: expose(image, stack.size * stack.size),
        size: stack.size,
        recorded: toSrgbBytes(recorded, { exposure: meanY > 0 ? 1 / (WHITE_OVER_MEAN * meanY) : 1 }),
        cols,
        objectSpanUm: ruler.frame.objectPixelScaleMm * 1e3 * stack.size,
        magnification,
        opticalPixelUm: (image.pixelScaleMm / magnification) * 1e3,
        detectorPixelUm: (pitchMm / magnification) * 1e3,
        abbeLimitUm: (meanNm * 1e-3) / (na * (1 + request.coherenceParameter)),
        sharpFocusUm: reachableFocusUm(system, request.focusUm),
        verdict: worst.fidelity?.verdict ?? "unknown",
        verdictReason: worst.fidelity?.reason ?? "no sampling was recorded for this plane",
        verdictNm: worst.nm,
        planes: stack.planes.map((p) => ({ nm: p.nm, verdict: p.fidelity?.verdict ?? "unknown" })),
        sourcePoints: source.points.length,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    return refused(cause);
  }
}

/** How the slip control reads for this objective — `liveFields`' three meanings. */
export function slipMeaning(spec: BuildSpec): "corrected-for" | "looked-through" | "not-expressible" {
  return liveFields(spec).coverslip;
}

/** The slip the objective was designed for (mm), or `null` for a bare design. */
export function designSlipMm(spec: BuildSpec): number | null {
  return spec.coverslip.kind === "slip" ? spec.coverslip.thicknessMm : null;
}
