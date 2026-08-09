/**
 * # Mechanical standards — transcribed data, and NOT rungs
 *
 * Every number in this file is a figure from a published interface standard or
 * an exact unit conversion. None of it is a validation rung, and the distinction
 * is the whole reason the file is separate: docs/VALIDATION.md's rule is that a
 * rung asserts a number *from outside the engine*, and engine-vs-itself is a
 * consistency check. A test asserting `TWO_INCH_MM === 50.8` is neither — it is
 * a spelling check on a constant, and counting it as a rung would inflate the
 * ladder with arithmetic.
 *
 * So the table is anchored the way `materials/catalog` anchors glass: the source
 * is named beside each value, and what the ladder pins is what the engine
 * *computes* from them (docs/VALIDATION.md § 5u).
 *
 * Two kinds of number live here and they are not equally trustworthy:
 *
 *  - **Exact conversions.** A 1.25″ barrel is 31.75 mm because an inch is
 *    25.4 mm by definition. These cannot be wrong, only misapplied.
 *  - **Transcribed interface figures.** A flange focal distance is a
 *    manufacturer's specification. These are as good as the transcription, and
 *    where a figure is quoted inconsistently in the wild it is marked.
 *
 * Nothing here is used by the tracer. The mech layer's *only* route into the
 * optics is `withGlassPath` — see `path.ts` and `insert.ts`.
 */

/** Millimetres per inch, exactly, by international definition since 1959. */
export const MM_PER_INCH = 25.4;

/**
 * Eyepiece / accessory barrel outer diameters (mm). Exact conversions of the
 * nominal inch sizes, except the 0.965″ Japanese standard, which is also an
 * exact conversion and is included because it is what old department-store
 * telescopes take and what makes their eyepieces unusable elsewhere.
 */
export const BARREL_DIAMETER_MM = {
  /** 0.965″ — the obsolete Japanese standard. */
  japanese: 0.965 * MM_PER_INCH,
  /** 1.25″ — the near-universal small barrel. */
  small: 1.25 * MM_PER_INCH,
  /** 2″ — the wide-field barrel. */
  large: 2 * MM_PER_INCH,
  /** 3″ — large-format imaging trains. */
  imaging: 3 * MM_PER_INCH,
} as const;

/**
 * Thread specifications: major diameter and pitch, both mm.
 *
 * `tpi` threads are quoted in threads per inch and converted here rather than
 * carried in two units — pitch = 25.4/TPI exactly.
 */
export interface ThreadSpec {
  readonly name: string;
  /** Major diameter (mm). */
  readonly diameterMm: number;
  /** Pitch (mm). */
  readonly pitchMm: number;
}

const tpiThread = (name: string, diameterMm: number, tpi: number): ThreadSpec => ({
  name,
  diameterMm,
  pitchMm: MM_PER_INCH / tpi,
});

export const THREADS = {
  /**
   * T2 — the astronomy camera thread. M42×0.75, and it is NOT the M42×1
   * photographic screw mount below, which fits and then binds.
   */
  t2: { name: "T2 (M42×0.75)", diameterMm: 42, pitchMm: 0.75 },
  /** The old Pentax/Praktica photographic screw mount. Same diameter, coarser. */
  m42Photo: { name: "M42×1", diameterMm: 42, pitchMm: 1 },
  /** Schmidt-Cassegrain rear cell, 2″×24 TPI. */
  sctRear: tpiThread("SCT rear cell (2″-24)", 2 * MM_PER_INCH, 24),
  /**
   * Royal Microscopical Society objective thread, 0.800″×36 TPI (Whitworth
   * form). The thread every finite-conjugate objective in this repo's catalogue
   * would physically carry.
   */
  rms: tpiThread("RMS (0.800″-36)", 0.8 * MM_PER_INCH, 36),
  /** The metric objective thread of most modern infinity-corrected systems. */
  m25: { name: "M25×0.75", diameterMm: 25, pitchMm: 0.75 },
  /** The long-working-distance metric objective thread. */
  m26: { name: "M26×0.706", diameterMm: 26, pitchMm: 0.706 },
  /** The large metric objective thread. */
  m32: { name: "M32×0.75", diameterMm: 32, pitchMm: 0.75 },
} as const satisfies Record<string, ThreadSpec>;

/**
 * Flange focal distance (mm): mounting flange to the sensor/film plane. This is
 * the length a camera body *consumes* out of an instrument's back focus, and it
 * is the single most common reason an otherwise sound imaging train will not
 * reach focus.
 *
 * Transcribed manufacturer figures. The T2 entry is the one an astronomical
 * accessory is designed around — 55 mm from the T-thread face to the sensor is
 * why T-rings for different camera mounts have different thicknesses: each makes
 * up 55 mm minus its own body's flange distance.
 */
export const FLANGE_FOCAL_DISTANCE_MM = {
  /** The astronomical convention, from the T-thread face. */
  t2: 55.0,
  canonEf: 44.0,
  canonRf: 20.0,
  nikonF: 46.5,
  nikonZ: 16.0,
  sonyE: 18.0,
  microFourThirds: 19.25,
  /** C-mount — 17.526 mm is 0.69″ exactly, which is where the odd figure comes from. */
  cMount: 0.69 * MM_PER_INCH,
} as const;

/**
 * Objective parfocal distance (mm): the nosepiece shoulder to the specimen
 * plane. **This is the number that makes a turret work** — swap objectives and
 * the specimen stays very nearly in focus, because every objective on the turret
 * is built to put its own object plane at the same distance below the shoulder.
 *
 * It is a *mechanical* standard with an optical consequence, which is exactly
 * what this layer is for: it fixes the barrel length behind the glass, and the
 * glass is what the engine solved. See `parfocalBarrelLengthMm` in `path.ts`.
 */
/**
 * ## Read this before adding a key
 *
 * A parfocal distance and a **tube length** are different standards that share
 * the same standards *names*, and the repo holds them in two files. Tube lengths
 * live with the optics that compute against them —
 * `designs/microscope.MECHANICAL_TUBE_LENGTH_MM` (shoulder to eyepiece seat) and
 * `OPTICAL_TUBE_LENGTH_MM` (Newton's x′, which is what the magnification is a
 * ratio against). Parfocal distances live here, because nothing optical computes
 * with them: they fix a **mount**.
 *
 * The trap is that "DIN" and "JIS" index both tables with different numbers, so
 * a key present in one and absent in the other reads as an omission when it is a
 * category difference. § 6l.9's rule applies — an identity a caller can get
 * wrong silently is refused or named, not left to be inferred — so:
 * **only DIN's parfocal distance is transcribed here.** The JIS finite-conjugate
 * parfocal is quoted elsewhere as a different figure from DIN's and is not
 * carried, because no rung needs it and a half-remembered standard in a table
 * that looks authoritative is worse than a gap.
 */
export const PARFOCAL_DISTANCE_MM = {
  /**
   * DIN finite-conjugate, and most 45 mm infinity systems. The figure § 5u's
   * parfocal ceiling is derived against.
   */
  din: 45.0,
  /** Nikon CFI60 — the "60 mm parfocal, 200 mm tube" infinity standard. */
  cfi60: 60.0,
  /** Mitutoyo M Plan long-working-distance objectives. */
  mitutoyo: 95.0,
} as const;

/**
 * Eyepiece tube inner diameter (mm) — what bounds a microscope's field number,
 * and therefore the field of view § 6q's field stop vignettes at.
 */
export const EYEPIECE_TUBE_DIAMETER_MM = {
  din: 23.2,
  wideField: 30.0,
} as const;
