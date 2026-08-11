import type { OpticalSystem } from "@telemicroscope/core/trace";
import {
  fieldPupilAt,
  objectFieldFrame,
  scaleDrift,
  type ObjectFieldFrame,
} from "@telemicroscope/core/imaging";
import {
  abbeResolutionMm,
  objectNumericalAperture,
} from "@telemicroscope/core/pupil";
import {
  buildMicroscope,
  dinSpec,
  infinitySpec,
  listerSpec,
  measureApertureWall,
  oilSpec,
  type ApertureWall,
  type BuildSpec,
  type ObjectiveNumbers,
} from "./builder";
import { refused, type Refused } from "./refusal";

/**
 * The microscope substrate, as pure functions — APP.md's A1.
 *
 * `render.ts`'s commitment, kept: numbers in, numbers out, no DOM and no React,
 * so this drops into a worker unchanged if a surface ever needs one. A1 does
 * not: the whole catalogue costs ~40 ms an entry (measured below in
 * `elapsedMs`), which is a select-change cost rather than a drag cost.
 *
 * What this module *is* is the thing every other microscope panel sits on: the
 * objective, the system it composes into, and the frame that says which piece of
 * specimen a brightfield or fluorescence render will actually cover. A2–A6 all
 * consume `buildFrame`; this is where the frame's size gets said once.
 *
 * ## The one number a caller must internalise
 *
 * A brightfield frame spans `pupilSamples` resolution cells and **no more** —
 * § 6h's closed form, object half-extent = pupilSamples·λ/(4·NA), in which the
 * grid `size` has cancelled. The telescope panels' escape hatch (choose a coarser
 * pixel and resample the PSF onto it, `renderFieldScene`) does not exist here,
 * because the Abbe sum's grid IS its frequency lattice.
 *
 * Two consequences the catalogue is arranged to make visible rather than
 * explain: the span is set by **NA alone** — the 4×, 10× and 20× at NA 0.10
 * cover the same 93.5 µm while their image pixels scale exactly with M — and it
 * moves the *wrong* way, so the objective that resolves best shows least. At
 * `pupilSamples` = 128 the frame is still ~13× narrower than a real 4×'s field.
 * Nothing here is "the view through the eyepiece"; it is a detail crop, and
 * `objectSpanUm` is what it should be labelled with.
 *
 * ## Errors are readouts too
 *
 * Some catalogue entries are *refused* by the engine at the aperture they name,
 * and `describeEntry` catches per entry and returns the engine's own message,
 * because a picker that hid those would hide a measured finding behind a blank
 * row.
 *
 * **How many is a measurement, not a constant, and this header used to state
 * it as one.** Three rows were written to fail against the engine of the day —
 * § 6b's f/4.1 cemented-doublet ceiling and § 6d's NA 0.343 wall for the Lister
 * form. **§ 6b.5.6 moved the first of those**: seeding the doublet solve
 * differently made designs build that had refused, and today only
 * `lister-40x-040` refuses at all, while `din-4x-020` draws a picture. A1's own
 * point about this is the reason it is worth writing down: *"showing the
 * engine's own text means a fix upstream arrives here for nothing — and means a
 * wrong sentence would have too."* The sentence was this one. Part F pins the
 * count against the catalogue rather than restating it.
 */

/** The wavelength every readout is quoted at — the d line, fixed, no control. */
export const LAMBDA_NM = 587.5618;

/** σ ≤ λ/14 — the Maréchal criterion the ladder judges every objective by. */
export const MARECHAL_WAVES = 1 / 14;

export type MicroscopeKind =
  | "din-4x-010"
  | "din-4x-015"
  | "din-4x-020"
  | "inf-4x-010"
  | "inf-10x-010"
  | "inf-20x-010"
  | "lister-40x-020"
  | "lister-40x-040"
  | "oil-100x-125"
  | "oil-100x-140";

export type Architecture = "DIN 160 mm" | "infinity + 200 mm tube";

export interface MicroscopeEntry {
  readonly kind: MicroscopeKind;
  readonly label: string;
  readonly architecture: Architecture;
  /** What the label claims — the traced values are read back against these. */
  readonly nominalMagnification: number;
  readonly nominalNA: number;
  /** Why this row is in the table. One line; it is the teaching. */
  readonly note: string;
  /**
   * The row, as a point in D8's design space rather than as a closure over two
   * arguments. Every field the engine takes is stated here, so the builder
   * cannot offer a space that fails to contain the catalogue, and a preset
   * loaded into the form rebuilds *this* system rather than one that resembles
   * it. The presets are written against the engine's own defaults
   * (`ENGINE_DEFAULTS`), which is what keeps this a restatement and not a
   * change: every row below builds byte-identically to the two-argument
   * constructor calls it replaced.
   */
  readonly spec: BuildSpec;
  readonly build: () => OpticalSystem;
}

const entry = (
  kind: MicroscopeKind,
  label: string,
  architecture: Architecture,
  note: string,
  spec: BuildSpec,
): MicroscopeEntry => ({
  kind,
  label,
  architecture,
  nominalMagnification: spec.magnification,
  nominalNA: spec.numericalAperture,
  note,
  spec,
  build: () => buildMicroscope(spec).system,
});

/**
 * The ladder's objectives, ordered so the two findings above read off the table.
 *
 * Rows 4–6 hold NA and vary M (the span does not move); rows 1–3 hold M and vary
 * NA (it does, as 1/NA, until the form runs out).
 */
export const MICROSCOPE_CATALOG: readonly MicroscopeEntry[] = [
  entry(
    "din-4x-010",
    "DIN 4×/0.10",
    "DIN 160 mm",
    "§ 6b's finite conjugate — a re-solved lens, not an infinity objective used differently.",
    dinSpec(4, 0.1),
  ),
  entry(
    "din-4x-015",
    "DIN 4×/0.15",
    "DIN 160 mm",
    "Same M, 1.5× the NA: the span shrinks as 1/NA — 93.5 → 62.0 µm.",
    dinSpec(4, 0.15),
  ),
  entry(
    "din-4x-020",
    "DIN 4×/0.20",
    "DIN 160 mm",
    "Written to fail at § 6b's f/4.1 ceiling — and it builds: § 6b.5.6 seeded the solve differently.",
    dinSpec(4, 0.2),
  ),
  entry(
    "inf-4x-010",
    "infinity 4×/0.10",
    "infinity + 200 mm tube",
    "§ 6a's chain. Same NA as the DIN 4× and the same span, on a different architecture.",
    infinitySpec(4, 0.1),
  ),
  entry(
    "inf-10x-010",
    "infinity 10×/0.10",
    "infinity + 200 mm tube",
    "2.5× the magnification buys no field: identical span, image pixel 2.5× larger.",
    infinitySpec(10, 0.1),
  ),
  entry(
    "inf-20x-010",
    "infinity 20×/0.10",
    "infinity + 200 mm tube",
    "And again at 5×. Magnification moves the pixel, never the crop.",
    infinitySpec(20, 0.1),
  ),
  entry(
    "lister-40x-020",
    "Lister 40×/0.20",
    "infinity + 200 mm tube",
    "§ 6d's aplanat — two doublets bent together for ΣS_I = ΣS_II = 0.",
    listerSpec(40, 0.2),
  ),
  entry(
    "lister-40x-040",
    "Lister 40×/0.40",
    "infinity + 200 mm tube",
    "§ 6d's measured wall at NA 0.343 — the form, not the glass. Past it the joint root is gone.",
    listerSpec(40, 0.4),
  ),
  entry(
    "oil-100x-125",
    "oil 100×/1.25",
    "infinity + 200 mm tube",
    "§ 6e.4 — dome, two aplanatic menisci, Lister rear, through slip and oil.",
    oilSpec(1.25),
  ),
  entry(
    "oil-100x-140",
    "oil 100×/1.40",
    "infinity + 200 mm tube",
    "The branch's headline, and the narrowest crop in the table: 2.6 µm of specimen.",
    oilSpec(1.4),
  ),
];

export function entryOf(kind: MicroscopeKind): MicroscopeEntry {
  const entry = MICROSCOPE_CATALOG.find((e) => e.kind === kind);
  if (!entry) throw new Error(`unknown objective ${kind}`);
  return entry;
}

/**
 * What a frame is built from — Part F's seam, and the whole of it.
 *
 * This carried a `MicroscopeKind` until Part F. The name was pure indirection
 * after D8 made every catalogue row a `BuildSpec`, and it was also a wall: a
 * ten-member string union cannot name a lens a reader designed, so every panel
 * that draws a picture could only draw one of ten. A spec is strings, numbers
 * and one plain union, so it structured-clones across `postMessage` where
 * `MicroscopeEntry.build` — a closure — cannot. **Send the spec, never the
 * entry.**
 */
export interface FrameRequest {
  readonly spec: BuildSpec;
  /** Frequency bins across the pupil diameter — the frame's width, in cells. */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Buys sampling, NOT field. */
  readonly size: number;
}

/**
 * Every field of a spec, as a value the compiler checks for completeness.
 *
 * A hand-written list of reads would compile perfectly while ignoring a field
 * added to `BuildSpec` later, and a cache key that ignores a field serves the
 * wrong system for two designs that differ only in it. This shape cannot: a new
 * field makes the literal below fail to satisfy `Record<keyof BuildSpec, true>`.
 */
const SPEC_FIELDS: Record<keyof BuildSpec, true> = {
  architecture: true,
  form: true,
  magnification: true,
  numericalAperture: true,
  crownMedium: true,
  flintMedium: true,
  tubeLengthMm: true,
  coverslip: true,
  orientation: true,
  frontGroupOrientation: true,
  rearGroupOrientation: true,
  infinitySpaceMm: true,
  powerSplit: true,
  separationFactor: true,
  meniscusCount: true,
  immersionMedium: true,
};

/** Sorted, so the order is this file's and not the literal's above. */
const SPEC_KEY_ORDER = (Object.keys(SPEC_FIELDS) as (keyof BuildSpec)[]).sort();

/**
 * A spec as a map key, with the field order fixed here rather than inherited.
 *
 * `Object.keys` order survives a structured clone, but it is the order the
 * *sender* happened to build the object in, and two specs that differ only in
 * that would key differently and each build a second identical system.
 */
export function specKey(spec: BuildSpec): string {
  return JSON.stringify(
    SPEC_KEY_ORDER.map((field) =>
      // The one field that is not a scalar, and `JSON.stringify` would take its
      // key order from the sender for the same reason the top level cannot.
      field === "coverslip"
        ? spec.coverslip.kind === "none"
          ? ["none"]
          : ["slip", spec.coverslip.thicknessMm, spec.coverslip.medium]
        : spec[field],
    ),
  );
}

/** What one objective delivers, all of it read back off the trace. */
export interface FrameReadout {
  /** n·sin u at the specimen, from the marginal ray's own launch angle. */
  readonly tracedNA: number;
  /** Image height over object height, from the traced chief ray. Signed. */
  readonly tracedMagnification: number;
  /** The crop, across the whole frame, on the specimen (µm). */
  readonly objectSpanUm: number;
  /** Specimen nm per pixel. */
  readonly objectPixelNm: number;
  /** Image-plane µm per pixel. */
  readonly imagePixelUm: number;
  /** λ/(2·NA) at the traced NA (nm) — the limit the crop is measured in. */
  readonly abbeResolutionNm: number;
  /**
   * The crop's width in resolution cells: span ÷ λ/(2·NA), with λ the **vacuum**
   * wavelength (`abbeResolutionMm`'s convention — the medium enters through NA).
   *
   * § 6h's closed form says this is `pupilSamples`, and for the dry objectives it
   * is, to a percent. The immersion rows land ~2.5× under it, because the frame's
   * own extent carries the wavelength in the medium as well and this app does not
   * re-derive that — APP.md quotes the immersion span as a measurement for the
   * same reason. Reported with that stated rather than hidden: a column that
   * silently disagrees with the closed form reads as a bug, and one that is
   * removed leaves the claim standing with nothing to check it against.
   */
  readonly resolutionCells: number;
  /** Worst relative drift of the per-field ruler from the on-axis one. */
  readonly scaleDriftPixel: number;
  /** Rays the corner field point lost to vignetting — A2's cost cliff, pre-warned. */
  readonly cornerLost: number;
  /**
   * RMS OPD (waves) on axis and at the frame corner, straight from the trace —
   * about its own mean at the system's **own image plane**, with no best-focus
   * solve. That is deliberately the number a render will actually see, and it
   * makes the Maréchal comparison one-sided: balanced σ ≤ this, so under λ/14
   * means genuinely diffraction-limited, while over it means "not at this
   * focus" rather than "not correctable".
   */
  readonly axisRmsWaves: number;
  readonly cornerRmsWaves: number;
  readonly elapsedMs: number;
}

/**
 * A readout, or the reason there is not one.
 *
 * `source` says **whose** refusal it is. `"engine"` is a design that does not
 * exist and said so with its own measured number — § 6b's f/4.1, § 6d's NA
 * 0.343 — and its message is quoted verbatim. `"app"` is D8's own: a
 * combination of controls with no engine call behind it at all. The distinction
 * is not cosmetic; this repo does not let an app sentence wear the engine's
 * voice, so the panel colours and labels the two differently.
 */
export type FrameResult = { readonly ok: true; readonly readout: FrameReadout } | Refused;

/**
 * Build a system and frame from any builder, and read everything off them.
 *
 * The frame itself is one on-axis trace (1–6 ms); `scaleDrift` is six more field
 * traces and is the bulk of the ~40 ms, which is why `elapsedMs` is reported
 * rather than the frame's own cost being quoted as the panel's.
 *
 * A1's catalogue and D8's form share this function rather than each having their
 * own: "A1's readouts, unchanged, against whatever was built" is only true if it
 * is literally the same code, and a second copy would drift the first time a
 * column was added.
 */
export function describeSystem(
  build: () => OpticalSystem,
  request: { readonly pupilSamples: number; readonly size: number },
): FrameResult {
  const started = performance.now();
  try {
    const system = build();
    const frame = objectFieldFrame(system, {
      size: request.size,
      pupilSamples: request.pupilSamples,
      wavelengthNm: LAMBDA_NM,
    });
    const tracedNA = objectNumericalAperture(system, LAMBDA_NM);
    const drift = scaleDrift(system, frame);
    // The corner is where vignetting and off-axis aberration both bite, and
    // `object-field`'s header names `lost` as the number that says what A2's
    // per-source-point re-trace is about to cost.
    const axis = fieldPupilAt(system, frame, 0.5, 0.5);
    const corner = fieldPupilAt(system, frame, 1, 1);
    const objectSpanMm = 2 * frame.objectHalfExtentMm;
    return {
      ok: true,
      readout: {
        tracedNA,
        tracedMagnification: frame.magnification,
        objectSpanUm: objectSpanMm * 1000,
        objectPixelNm: frame.objectPixelScaleMm * 1e6,
        imagePixelUm: frame.pixelScaleMm * 1000,
        abbeResolutionNm: abbeResolutionMm(LAMBDA_NM, tracedNA) * 1e6,
        resolutionCells: objectSpanMm / abbeResolutionMm(LAMBDA_NM, tracedNA),
        scaleDriftPixel: drift.pixelScale,
        cornerLost: corner.lost,
        axisRmsWaves: axis.rmsWaves,
        cornerRmsWaves: corner.rmsWaves,
        elapsedMs: performance.now() - started,
      },
    };
  } catch (cause) {
    // The engine's own words, not a paraphrase: § 6b's and § 6d's ceilings are
    // findings, and their error messages carry the measured numbers. D8's own
    // refusals arrive through the same channel and are tagged apart from them
    // by `AppRefusal`'s name, so the panel can decline to speak in the engine's
    // voice.
    return refused(cause);
  }
}

/** One catalogue entry, by kind. */
export function describeEntry(request: {
  readonly kind: MicroscopeKind;
  readonly pupilSamples: number;
  readonly size: number;
}): FrameResult {
  const entry = entryOf(request.kind);
  return describeSystem(entry.build, request);
}

/** The whole catalogue at one sampling — what the table shows. */
export function describeCatalog(
  pupilSamples: number,
  size: number,
): readonly FrameResult[] {
  return MICROSCOPE_CATALOG.map((entry) =>
    describeEntry({ kind: entry.kind, pupilSamples, size }),
  );
}

/**
 * D8's readout: A1's frame numbers plus the objective's own solved ones.
 *
 * The second half is what a *builder* answers that a catalogue cannot. A1's
 * table says what a frame covers; a form that changes the glass, the tube length
 * or the group split has to show what those did to the lens — the solved
 * specimen plane, the working focal ratio § 6b's ceiling is quoted in, the
 * Lister's two bendings and its Seidel cancellation, the dome radius § 6e.4
 * solves rather than picks.
 */
export type BuildDescription =
  | {
      readonly ok: true;
      readonly readout: FrameReadout;
      readonly objective: ObjectiveNumbers;
      /** Composed-chain first-order numbers, from the paraxial trace. */
      readonly nominalMagnification: number;
      readonly objectDistanceMm: number;
      readonly imageDistanceMm: number;
      /**
       * Where THIS design stops building, bisected on the aperture with every
       * other control held. `null` when no refusal was found below the cap.
       * See `measureApertureWall` for why it is measured and not quoted.
       */
      readonly wall: ApertureWall | null;
    }
  | Refused;

export function describeBuild(
  spec: BuildSpec,
  request: { readonly pupilSamples: number; readonly size: number },
): BuildDescription {
  // Built once and held, so the objective's own numbers come from the very
  // system the frame was read off rather than from a second, equal-looking build.
  // The clock starts here rather than inside `describeSystem` because the solve
  // is part of what a form-submit costs.
  const started = performance.now();
  let made: ReturnType<typeof buildMicroscope>;
  try {
    made = buildMicroscope(spec);
  } catch (cause) {
    return refused(cause);
  }
  const frame = describeSystem(() => made.system, request);
  if (!frame.ok) return frame;
  return {
    ok: true,
    readout: { ...frame.readout, elapsedMs: performance.now() - started },
    objective: made.objective,
    nominalMagnification: made.chain.nominalMagnification,
    objectDistanceMm: made.chain.objectDistanceMm,
    imageDistanceMm: made.chain.imageDistanceMm,
    // Deliberately outside the clock above: the wall is ~15 more solves and is
    // the larger half of a submit, so the panel reports the two separately
    // rather than letting one number hide the other.
    wall: measureApertureWall(spec),
  };
}

/** The frame itself, for the panels that will form an image on it (A2 onward). */
export function buildFrame(request: FrameRequest): {
  system: OpticalSystem;
  frame: ObjectFieldFrame;
} {
  const system = buildMicroscope(request.spec).system;
  return {
    system,
    frame: objectFieldFrame(system, {
      size: request.size,
      pupilSamples: request.pupilSamples,
      wavelengthNm: LAMBDA_NM,
    }),
  };
}
