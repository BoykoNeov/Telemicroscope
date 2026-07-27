import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  listerObjective,
  microscopeObjective,
  oilImmersionObjective,
  tubeLens,
} from "@telemicroscope/core/designs";
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
 * Three catalogue entries exist to be *refused* by the engine at the aperture
 * they name — § 6b's f/4.1 cemented-doublet ceiling and § 6d's measured NA 0.343
 * wall for the Lister form. `describeEntry` catches per entry and returns the
 * engine's own message, because a picker that hid those would hide two of the
 * branch's measured findings behind a blank row.
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
  readonly build: () => OpticalSystem;
}

const din = (magnification: number, numericalAperture: number) => (): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification, numericalAperture }),
  }).system;

const infinity = (magnification: number, numericalAperture: number) => (): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification, numericalAperture }),
    tubeLens: tubeLens(),
  }).system;

const lister = (magnification: number, numericalAperture: number) => (): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: listerObjective({ magnification, numericalAperture }),
    tubeLens: tubeLens(),
  }).system;

const oil = (numericalAperture: number) => (): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({
      magnification: 100,
      numericalAperture,
      tubeFocalLengthMm: 200,
    }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
  }).system;

/**
 * The ladder's objectives, ordered so the two findings above read off the table.
 *
 * Rows 4–6 hold NA and vary M (the span does not move); rows 1–3 hold M and vary
 * NA (it does, as 1/NA, until the form runs out).
 */
export const MICROSCOPE_CATALOG: readonly MicroscopeEntry[] = [
  {
    kind: "din-4x-010",
    label: "DIN 4×/0.10",
    architecture: "DIN 160 mm",
    nominalMagnification: 4,
    nominalNA: 0.1,
    note: "§ 6b's finite conjugate — a re-solved lens, not an infinity objective used differently.",
    build: din(4, 0.1),
  },
  {
    kind: "din-4x-015",
    label: "DIN 4×/0.15",
    architecture: "DIN 160 mm",
    nominalMagnification: 4,
    nominalNA: 0.15,
    note: "Same M, 1.5× the NA: the span shrinks as 1/NA — 93.5 → 62.0 µm.",
    build: din(4, 0.15),
  },
  {
    kind: "din-4x-020",
    label: "DIN 4×/0.20",
    architecture: "DIN 160 mm",
    nominalMagnification: 4,
    nominalNA: 0.2,
    note: "§ 6b's f/4.1 ceiling, as an error message: the cemented doublet stops existing here.",
    build: din(4, 0.2),
  },
  {
    kind: "inf-4x-010",
    label: "infinity 4×/0.10",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 4,
    nominalNA: 0.1,
    note: "§ 6a's chain. Same NA as the DIN 4× and the same span, on a different architecture.",
    build: infinity(4, 0.1),
  },
  {
    kind: "inf-10x-010",
    label: "infinity 10×/0.10",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 10,
    nominalNA: 0.1,
    note: "2.5× the magnification buys no field: identical span, image pixel 2.5× larger.",
    build: infinity(10, 0.1),
  },
  {
    kind: "inf-20x-010",
    label: "infinity 20×/0.10",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 20,
    nominalNA: 0.1,
    note: "And again at 5×. Magnification moves the pixel, never the crop.",
    build: infinity(20, 0.1),
  },
  {
    kind: "lister-40x-020",
    label: "Lister 40×/0.20",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 40,
    nominalNA: 0.2,
    note: "§ 6d's aplanat — two doublets bent together for ΣS_I = ΣS_II = 0.",
    build: lister(40, 0.2),
  },
  {
    kind: "lister-40x-040",
    label: "Lister 40×/0.40",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 40,
    nominalNA: 0.4,
    note: "§ 6d's measured wall at NA 0.343 — the form, not the glass. Past it the joint root is gone.",
    build: lister(40, 0.4),
  },
  {
    kind: "oil-100x-125",
    label: "oil 100×/1.25",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 100,
    nominalNA: 1.25,
    note: "§ 6e.4 — dome, two aplanatic menisci, Lister rear, through slip and oil.",
    build: oil(1.25),
  },
  {
    kind: "oil-100x-140",
    label: "oil 100×/1.40",
    architecture: "infinity + 200 mm tube",
    nominalMagnification: 100,
    nominalNA: 1.4,
    note: "The branch's headline, and the narrowest crop in the table: 2.6 µm of specimen.",
    build: oil(1.4),
  },
];

export function entryOf(kind: MicroscopeKind): MicroscopeEntry {
  const entry = MICROSCOPE_CATALOG.find((e) => e.kind === kind);
  if (!entry) throw new Error(`unknown objective ${kind}`);
  return entry;
}

export interface FrameRequest {
  readonly kind: MicroscopeKind;
  /** Frequency bins across the pupil diameter — the frame's width, in cells. */
  readonly pupilSamples: number;
  /** Grid size, a power of two. Buys sampling, NOT field. */
  readonly size: number;
}

/** What one objective delivers, all of it read back off the trace. */
export interface FrameReadout {
  readonly kind: MicroscopeKind;
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

export type FrameResult =
  | { readonly ok: true; readonly readout: FrameReadout }
  | { readonly ok: false; readonly kind: MicroscopeKind; readonly error: string };

/**
 * Build one entry's system and frame, and read everything off them.
 *
 * The frame itself is one on-axis trace (1–6 ms); `scaleDrift` is six more field
 * traces and is the bulk of the ~40 ms, which is why `elapsedMs` is reported
 * rather than the frame's own cost being quoted as the panel's.
 */
export function describeEntry(request: FrameRequest): FrameResult {
  const entry = entryOf(request.kind);
  const started = performance.now();
  try {
    const system = entry.build();
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
        kind: request.kind,
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
    // findings, and their error messages carry the measured numbers.
    return { ok: false, kind: request.kind, error: (cause as Error).message };
  }
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

/** The frame itself, for the panels that will form an image on it (A2 onward). */
export function buildFrame(request: FrameRequest): {
  system: OpticalSystem;
  frame: ObjectFieldFrame;
} {
  const system = entryOf(request.kind).build();
  return {
    system,
    frame: objectFieldFrame(system, {
      size: request.size,
      pupilSamples: request.pupilSamples,
      wavelengthNm: LAMBDA_NM,
    }),
  };
}
