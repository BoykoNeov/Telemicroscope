import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  listerObjective,
  microscopeObjective,
  oilImmersionObjective,
  tubeLens,
  type ImageFormingMicroscope,
} from "@telemicroscope/core/designs";
import type { OpticalSystem } from "@telemicroscope/core/trace";

/**
 * The microscope builder's adapter — APP.md's D8.
 *
 * `render.ts`'s commitment, kept for the sixth time: numbers in, numbers out, no
 * DOM and no React. Nothing here is new capability. Every constructor this
 * module calls has been in `designs/` since § 6a–§ 6e; what did not exist was a
 * way to reach their parameters, because `MICROSCOPE_CATALOG` called them with
 * two arguments each and defaulted the other twenty.
 *
 * ## What a builder is actually for, in this repo
 *
 * Not breadth for its own sake. The engine **refuses** designs that do not
 * exist — § 6b's f/4.1 cemented-doublet ceiling, § 6d's measured NA 0.343 wall,
 * § 6e.4's NA 1.411 geometric one — and it refuses them with error text carrying
 * the measured number. A1 established that showing that text *is* the handling.
 * A catalogue can show three such walls because three rows were written to fail;
 * a builder is where a reader walks into them **on purpose**, at whatever
 * aperture they choose, which is the difference between reading a finding and
 * reproducing it.
 *
 * ## Two refusals that are the APP's and not the engine's, and why they are marked
 *
 * The design space is **not** the product architecture × form. Two of the six
 * cells have no engine call at all to refuse them:
 *
 * - **DIN × Lister / DIN × oil.** `listerObjective` and `oilImmersionObjective`
 *   are infinity-space forms; the finite-conjugate DIN Lister is a *named open
 *   item* in ROADMAP § 6d, not a thing that fails. There is no exception to
 *   quote, so this module raises its own — and tags it `"app"`, because this
 *   repo does not let an app-authored sentence wear the engine's voice.
 * - **A cover slip on the infinity doublet or on the Lister.** § 6c solved the
 *   slip into the DIN objective's *bending* (`targetS1Mm`), and § 6e's oil forms
 *   look *through* one as a plane layer. Neither `MicroscopeObjectiveSpec` nor
 *   `ListerObjectiveSpec` has anywhere to put it — both are recorded open in the
 *   ROADMAP ("the infinity-corrected member's slip", "the coverslip through a
 *   two-group target"). So the slip control means three different things across
 *   the four forms — *corrected for*, *looked through*, *not expressible* — and
 *   the panel says which rather than presenting one uniform knob that quietly
 *   changes meaning.
 *
 * ## The one trap in `CoverslipChoice`, which is why it is not an optional field
 *
 * The two engine specs read an absent slip in **opposite** directions:
 * `FiniteConjugateObjectiveSpec.coverslip` omitted means a specimen bare in air,
 * while `HyperhemisphereSpec.coverslipSpec` omitted means a real 0.17 mm D263
 * slip and `null` is what means bare. An optional field here would inherit both
 * readings at once, and the first thing it would do is give every DIN preset a
 * cover slip it was never built with — silently moving A1's landed numbers.
 * `CoverslipChoice` is therefore explicit on both sides, and the presets below
 * state `"none"` where the engine call states nothing.
 *
 * ## What this form does NOT reach, stated rather than implied
 *
 * The engine takes more than this: `frontImageFactor`, `meniscusGapFactor`,
 * `meniscusThicknessFactor`, `meniscusMedium`, `immersionGapMm`,
 * `glassMarginFactor` and `designWavelengthNm` are all defaulted here. The line
 * is not arbitrary — it is drawn at the parameters that change what the design
 * *is* rather than how comfortably it is built, plus λ, which A1 fixes at the d
 * line for every microscope readout in the app.
 *
 * The group orientations were on the wrong side of that line and were moved:
 * the aplanat's own refusal text names them ("…or this split/separation/**
 * orientation** admits none"), so leaving them defaulted would have had the
 * panel quote a cause a reader could not investigate.
 */

export type BuildArchitecture = "din" | "infinity";

/** Which objective form. `doublet` is the cemented pair on either architecture. */
export type BuildForm = "doublet" | "lister" | "oil";

export type CoverslipChoice =
  | { readonly kind: "none" }
  | { readonly kind: "slip"; readonly thicknessMm: number; readonly medium: string };

/** The catalog media a builder may pick from, by their registry names. */
export const CROWN_MEDIA = ["N-BK7", "FUSED-SILICA", "CAF2"] as const;
export const FLINT_MEDIA = ["F2", "N-BK7"] as const;
export const SLIP_MEDIA = ["D263", "N-BK7", "FUSED-SILICA"] as const;
export const IMMERSION_MEDIA = ["IMMERSION-OIL", "WATER"] as const;

/**
 * Everything the engine's microscope constructors take, in one flat record.
 *
 * Flat rather than a discriminated union because it is a **form**: switching the
 * form control must not discard the numbers typed under the previous one. Which
 * fields are live is `liveFields` below, and it is the panel's business to grey
 * the rest rather than this module's to forget them.
 */
export interface BuildSpec {
  readonly architecture: BuildArchitecture;
  readonly form: BuildForm;
  /** What the label claims, against `tubeLengthMm`. */
  readonly magnification: number;
  /** Object-space n·sin u the design is solved for. */
  readonly numericalAperture: number;
  readonly crownMedium: string;
  readonly flintMedium: string;
  /**
   * DIN: Newton's x′, the optical tube length (mm), default 150.
   * Infinity: the tube lens focal length (mm), default 200 — and the objective's
   * `tubeFocalLengthMm` is tied to it, because a magnification quoted against
   * one tube and formed by another is not a magnification.
   */
  readonly tubeLengthMm: number;
  readonly coverslip: CoverslipChoice;
  /** DIN doublet only: which face meets the specimen (§ 6b's turn-around). */
  readonly orientation: "flintFirst" | "crownFirst";
  /**
   * Lister and oil rear group: which face of each group meets the beam.
   *
   * Exposed because the engine's own refusal for the aplanat names them — "…or
   * this split/separation/**orientation** admits none" — and a panel that quotes
   * that sentence while defaulting the parameter would name a cause the reader
   * cannot investigate.
   */
  readonly frontGroupOrientation: "flintFirst" | "crownFirst";
  readonly rearGroupOrientation: "flintFirst" | "crownFirst";
  /** Infinity only: objective rear vertex → tube lens front vertex (mm). */
  readonly infinitySpaceMm: number;
  /** Lister and the oil form's rear group: the front group's share of the power. */
  readonly powerSplit: number;
  /** Lister and the oil rear group: group gap, in focal lengths. */
  readonly separationFactor: number;
  /** Oil only: aplanatic menisci after the dome (§ 6e.3). */
  readonly meniscusCount: number;
  /** Oil only: the fluid the front element is immersed in. */
  readonly immersionMedium: string;
}

/** Thrown by this module rather than by the engine — see the header. */
export class AppRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRefusal";
  }
}

/** Which controls do anything for a given architecture and form. */
export function liveFields(spec: BuildSpec): {
  readonly orientation: boolean;
  readonly infinitySpace: boolean;
  readonly listerGroups: boolean;
  readonly meniscus: boolean;
  readonly immersion: boolean;
  /** How the slip control reads for this form — three meanings, never one. */
  readonly coverslip: "corrected-for" | "looked-through" | "not-expressible";
} {
  const infinity = spec.architecture === "infinity";
  return {
    orientation: spec.architecture === "din" && spec.form === "doublet",
    infinitySpace: infinity,
    listerGroups: spec.form === "lister" || spec.form === "oil",
    meniscus: spec.form === "oil",
    immersion: spec.form === "oil",
    coverslip:
      spec.form === "oil"
        ? "looked-through"
        : spec.architecture === "din" && spec.form === "doublet"
          ? "corrected-for"
          : "not-expressible",
  };
}

/** The composed instrument, plus the objective's own solved numbers. */
export interface BuiltMicroscope {
  readonly system: OpticalSystem;
  readonly chain: ImageFormingMicroscope;
  readonly objective: ObjectiveNumbers;
}

/** What every form solves, whatever else it has. */
export interface CommonObjectiveNumbers {
  /** The focal length the nominal magnification implies (mm). */
  readonly focalLengthMm: number;
  /** What the traced paraxial chain actually delivers (mm). */
  readonly paraxialFocalLengthMm: number;
  /** Surface 0's vertex to the specimen (mm, in front). */
  readonly objectDistanceMm: number;
  /** Aperture stop semi-diameter (mm) — the cone that delivers the stated NA. */
  readonly stopRadiusMm: number;
}

/**
 * The per-form numbers, as a union rather than a flat record with holes.
 *
 * The forms genuinely do not solve the same things: only the finite conjugate
 * has a free working distance and a working focal ratio, only the Lister has two
 * bendings and a Seidel cancellation, only the oil form has a dome. A flat
 * interface would have to make all of those optional, and an optional number
 * that is *structurally* absent reads on screen as one that failed to compute.
 */
export type ObjectiveNumbers =
  | (CommonObjectiveNumbers & {
      readonly form: "doublet-din";
      /** f/(2·stopRadius) — § 6b's ceiling is quoted in this. */
      readonly workingFocalRatio: number;
      readonly freeWorkingDistanceMm: number;
      readonly airGapMm: number;
      readonly airEquivalentObjectDistanceMm: number;
      readonly opticalTubeLengthMm: number;
      readonly tracedOpticalTubeLengthMm: number;
      readonly imageDistanceMm: number;
    })
  | (CommonObjectiveNumbers & {
      readonly form: "doublet-infinity";
      /** 1/(2·NA) — a function of NA alone, so § 6b's ceiling reads differently here. */
      readonly focalRatio: number;
      /** f·NA: the sine-condition height, NOT the stop radius. */
      readonly pupilRadiusMm: number;
    })
  | (CommonObjectiveNumbers & { readonly form: "lister" } & ListerNumbers)
  | (CommonObjectiveNumbers & {
      readonly form: "oil";
      readonly domeRadiusMm: number;
      /** NA / the front group's magnification — what the Lister behind it sees. */
      readonly rearNumericalAperture: number;
      readonly groupGapMm: number;
      readonly meniscusCount: number;
      readonly rear: ListerNumbers;
    });

/** § 6d's joint solve, read back off it. */
export interface ListerNumbers {
  readonly separationMm: number;
  readonly frontFocalLengthMm: number;
  readonly rearFocalLengthMm: number;
  readonly frontBending: number;
  readonly rearBending: number;
  readonly seidelS1: number;
  readonly seidelS2: number;
  /** How completely the two groups' third-order sums cancel. */
  readonly cancellation: number;
  readonly rootCount: number;
}

const listerNumbers = (lens: {
  separationMm: number;
  frontFocalLengthMm: number;
  rearFocalLengthMm: number;
  frontBending: number;
  rearBending: number;
  seidelS1: number;
  seidelS2: number;
  cancellation: number;
  roots: readonly unknown[];
}): ListerNumbers => ({
  separationMm: lens.separationMm,
  frontFocalLengthMm: lens.frontFocalLengthMm,
  rearFocalLengthMm: lens.rearFocalLengthMm,
  frontBending: lens.frontBending,
  rearBending: lens.rearBending,
  seidelS1: lens.seidelS1,
  seidelS2: lens.seidelS2,
  cancellation: lens.cancellation,
  rootCount: lens.roots.length,
});

/**
 * Build one spec, or throw.
 *
 * Two throw sites, and they are different in kind. `AppRefusal` is this module
 * saying the combination has no engine call; anything else is the engine's own
 * exception, propagated untouched so its measured numbers reach the screen.
 */
export function buildMicroscope(spec: BuildSpec): BuiltMicroscope {
  const glass = { crownMedium: spec.crownMedium, flintMedium: spec.flintMedium };

  if (spec.architecture === "din") {
    if (spec.form !== "doublet") {
      throw new AppRefusal(
        `the ${spec.form === "lister" ? "Lister" : "oil-immersion"} form is an infinity-space ` +
          `design — the finite-conjugate DIN member is a named open item in the ROADMAP ` +
          `(§ 6d), not a design the engine can be asked for and refuse.`,
      );
    }
    const objective = finiteConjugateObjective({
      magnification: spec.magnification,
      numericalAperture: spec.numericalAperture,
      opticalTubeLengthMm: spec.tubeLengthMm,
      orientation: spec.orientation,
      ...glass,
      ...(spec.coverslip.kind === "none"
        ? {}
        : {
            coverslip: {
              thicknessMm: spec.coverslip.thicknessMm,
              medium: spec.coverslip.medium,
            },
          }),
    });
    const chain = finiteConjugateMicroscope({ objective });
    return {
      system: chain.system,
      chain,
      objective: {
        form: "doublet-din",
        focalLengthMm: objective.focalLengthMm,
        paraxialFocalLengthMm: objective.paraxialFocalLengthMm,
        objectDistanceMm: objective.objectDistanceMm,
        stopRadiusMm: objective.stopRadiusMm,
        workingFocalRatio: objective.workingFocalRatio,
        freeWorkingDistanceMm: objective.freeWorkingDistanceMm,
        airGapMm: objective.airGapMm,
        airEquivalentObjectDistanceMm: objective.airEquivalentObjectDistanceMm,
        opticalTubeLengthMm: objective.opticalTubeLengthMm,
        tracedOpticalTubeLengthMm: objective.tracedOpticalTubeLengthMm,
        imageDistanceMm: objective.imageDistanceMm,
      },
    };
  }

  // Every infinity form shares one tube lens, and its focal length IS the one the
  // objective's magnification is quoted against. Two controls would let a reader
  // build a 4× that forms 3.6×, which is a mislabelled lens rather than a design.
  const tube = tubeLens({ focalLengthMm: spec.tubeLengthMm, ...glass });
  const compose = (
    objective: Parameters<typeof infinityCorrectedMicroscope>[0]["objective"],
  ) =>
    infinityCorrectedMicroscope({
      objective,
      tubeLens: tube,
      infinitySpaceMm: spec.infinitySpaceMm,
    });

  if (spec.form === "doublet") {
    requireNoSlip(spec, "the infinity-corrected objective's cover slip is § 6c's named deferral");
    const objective = microscopeObjective({
      magnification: spec.magnification,
      numericalAperture: spec.numericalAperture,
      tubeFocalLengthMm: spec.tubeLengthMm,
      ...glass,
    });
    const chain = compose(objective);
    return {
      system: chain.system,
      chain,
      objective: {
        form: "doublet-infinity",
        focalLengthMm: objective.focalLengthMm,
        paraxialFocalLengthMm: objective.paraxialFocalLengthMm,
        objectDistanceMm: objective.objectDistanceMm,
        stopRadiusMm: objective.stopRadiusMm,
        focalRatio: objective.focalRatio,
        pupilRadiusMm: objective.pupilRadiusMm,
      },
    };
  }

  if (spec.form === "lister") {
    requireNoSlip(spec, "§ 6d's two-group form has no target parameter to solve a slip into");
    const objective = listerObjective({
      magnification: spec.magnification,
      numericalAperture: spec.numericalAperture,
      tubeFocalLengthMm: spec.tubeLengthMm,
      powerSplit: spec.powerSplit,
      separationFactor: spec.separationFactor,
      frontOrientation: spec.frontGroupOrientation,
      rearOrientation: spec.rearGroupOrientation,
      ...glass,
    });
    const chain = compose(objective);
    return {
      system: chain.system,
      chain,
      objective: {
        form: "lister",
        focalLengthMm: objective.focalLengthMm,
        paraxialFocalLengthMm: objective.paraxialFocalLengthMm,
        objectDistanceMm: objective.objectDistanceMm,
        stopRadiusMm: objective.stopRadiusMm,
        ...listerNumbers(objective),
      },
    };
  }

  const objective = oilImmersionObjective({
    magnification: spec.magnification,
    numericalAperture: spec.numericalAperture,
    tubeFocalLengthMm: spec.tubeLengthMm,
    powerSplit: spec.powerSplit,
    separationFactor: spec.separationFactor,
    meniscusCount: spec.meniscusCount,
    immersionMedium: spec.immersionMedium,
    // `null` is the engine's word for "bare in the fluid"; omitting it would mean
    // a real 0.17 D263 slip, which is the opposite of what "none" says here.
    coverslipSpec:
      spec.coverslip.kind === "none"
        ? null
        : { thicknessMm: spec.coverslip.thicknessMm, medium: spec.coverslip.medium },
    ...glass,
  });
  const chain = compose(objective);
  return {
    system: chain.system,
    chain,
    objective: {
      form: "oil",
      focalLengthMm: objective.focalLengthMm,
      paraxialFocalLengthMm: objective.paraxialFocalLengthMm,
      objectDistanceMm: objective.objectDistanceMm,
      stopRadiusMm: objective.stopRadiusMm,
      domeRadiusMm: objective.domeRadiusMm,
      rearNumericalAperture: objective.rearNumericalAperture,
      groupGapMm: objective.groupGapMm,
      meniscusCount: spec.meniscusCount,
      rear: listerNumbers(objective.rearGroup),
    },
  };
}

/**
 * The aperture this exact design stops existing at, measured now.
 *
 * ## Why this is measured rather than quoted
 *
 * The branch's walls are catalogued as constants — § 6b's f/4.1, § 6d's NA
 * 0.343, § 6e.4's NA 1.411 — and building the form that reaches them shows they
 * are not constants at all. Two of the three move with parameters this panel
 * exposes:
 *
 * - The **Lister**'s wall is a function of the *stated* split and separation.
 *   At the engine's own defaults (0.6, 0.6) it is NA 0.273; at (0.5, 0.3) it is
 *   0.345, and at (0.7, 0.8) it is 0.165 — a factor of 2.1 across the same grid
 *   § 6d checks its solve over. It does **not** move with magnification at all
 *   (identical to four figures at M = 10, 20, 40, 100), which is the form's
 *   scale-freedom showing up as a flat number.
 * - The **oil** form's is 1.411 with § 6e.4's own 0.17 mm D263 slip, 1.472 with
 *   no slip at all, 0.966 with one meniscus instead of two, and 1.316 in water.
 *
 * A guard coloured against a hardcoded constant would therefore be wrong for
 * most of the space it is shown in. So the panel bisects the refusal boundary
 * for the spec actually in the form, and the reader gets *their* wall.
 *
 * ## What it does not claim
 *
 * Bisection finds **a** boundary and assumes the refusal is monotone in NA.
 * Nothing here proves the design does not build again somewhere above it — this
 * is where the engine first says no, not a proof that it says no forever.
 * `iterations` and the bracket are reported so the number is readable as the
 * measurement it is.
 */
export interface ApertureWall {
  /** The largest NA that still builds, to `toleranceNA`. */
  readonly numericalAperture: number;
  /** Half-width of the final bracket. */
  readonly toleranceNA: number;
  readonly builds: number;
  readonly elapsedMs: number;
}

export function measureApertureWall(
  spec: BuildSpec,
  options: { readonly maxNA?: number; readonly iterations?: number } = {},
): ApertureWall | null {
  const maxNA = options.maxNA ?? 4;
  const iterations = options.iterations ?? 14;
  const started = performance.now();
  let builds = 0;
  const ok = (numericalAperture: number) => {
    builds += 1;
    try {
      buildMicroscope({ ...spec, numericalAperture });
      return true;
    } catch {
      return false;
    }
  };
  if (!ok(spec.numericalAperture)) return null;
  let lo = spec.numericalAperture;
  let hi = lo * 2;
  while (ok(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > maxNA) return null;
  }
  for (let i = 0; i < iterations; i++) {
    const mid = 0.5 * (lo + hi);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return {
    numericalAperture: lo,
    toleranceNA: 0.5 * (hi - lo),
    builds,
    elapsedMs: performance.now() - started,
  };
}

function requireNoSlip(spec: BuildSpec, because: string): void {
  if (spec.coverslip.kind === "none") return;
  throw new AppRefusal(
    `this form cannot be given a cover slip — ${because}. ` +
      `Only the DIN doublet is corrected for one, and only the oil form looks through one.`,
  );
}

/** The default a fresh form opens on: A1's own DIN 4×/0.10, spelled out. */
export const DEFAULT_SPEC: BuildSpec = {
  architecture: "din",
  form: "doublet",
  magnification: 4,
  numericalAperture: 0.1,
  crownMedium: "N-BK7",
  flintMedium: "F2",
  tubeLengthMm: 150,
  coverslip: { kind: "none" },
  orientation: "flintFirst",
  frontGroupOrientation: "flintFirst",
  rearGroupOrientation: "flintFirst",
  infinitySpaceMm: 100,
  powerSplit: 0.6,
  separationFactor: 0.6,
  meniscusCount: 2,
  immersionMedium: "IMMERSION-OIL",
};

/**
 * The engine defaults every constructor applies when a field is omitted — the
 * numbers `DEFAULT_SPEC` and the presets are written against.
 *
 * Stated once here so that a spec which reproduces a catalogue row does so
 * *visibly*, and so the difference between "the form's default" and "the
 * engine's default" is a thing this file can be checked on rather than a thing
 * it assumes.
 */
export const ENGINE_DEFAULTS = {
  opticalTubeLengthMm: 150,
  tubeFocalLengthMm: 200,
  infinitySpaceMm: 100,
  powerSplit: 0.6,
  separationFactor: 0.6,
  meniscusCount: 2,
  groupOrientation: "flintFirst",
  crownMedium: "N-BK7",
  flintMedium: "F2",
  immersionMedium: "IMMERSION-OIL",
  slipThicknessMm: 0.17,
  slipMedium: "D263",
} as const;

/** A DIN doublet at the engine's own defaults. */
export const dinSpec = (magnification: number, numericalAperture: number): BuildSpec => ({
  ...DEFAULT_SPEC,
  architecture: "din",
  form: "doublet",
  magnification,
  numericalAperture,
  tubeLengthMm: ENGINE_DEFAULTS.opticalTubeLengthMm,
  coverslip: { kind: "none" },
});

/** An infinity-corrected cemented doublet on a 200 mm tube. */
export const infinitySpec = (magnification: number, numericalAperture: number): BuildSpec => ({
  ...DEFAULT_SPEC,
  architecture: "infinity",
  form: "doublet",
  magnification,
  numericalAperture,
  tubeLengthMm: ENGINE_DEFAULTS.tubeFocalLengthMm,
  coverslip: { kind: "none" },
});

/** § 6d's aplanat on the same tube. */
export const listerSpec = (magnification: number, numericalAperture: number): BuildSpec => ({
  ...infinitySpec(magnification, numericalAperture),
  form: "lister",
});

/**
 * § 6e.4's oil objective — and the one preset that carries a slip, because the
 * engine's own default for `coverslipSpec` is a real 0.17 mm D263 one.
 */
export const oilSpec = (numericalAperture: number): BuildSpec => ({
  ...infinitySpec(100, numericalAperture),
  form: "oil",
  coverslip: {
    kind: "slip",
    thicknessMm: ENGINE_DEFAULTS.slipThicknessMm,
    medium: ENGINE_DEFAULTS.slipMedium,
  },
});
