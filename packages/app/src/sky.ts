import { achromaticObjective, newtonian } from "@telemicroscope/core/designs";
import { bestFocus, withFocus } from "@telemicroscope/core/analysis";
import type { OpticalSystem } from "@telemicroscope/core/trace";
import { blackbodySpectrum, quadratureSamples } from "@telemicroscope/core/photometry";
import { spectralStack } from "@telemicroscope/core/wave";
import {
  buildFieldMap,
  integratedXyz,
  limbDarkenedDisc,
  rasterizeExtendedSource,
  renderField,
  toSrgbBytes,
  type ColorImage,
} from "@telemicroscope/core/imaging";
import { AppRefusal, refusalOf, type Refusal as SharedRefusal } from "./refusal";

/**
 * The sky — APP.md's C7, and roadmap step 5's last leftover.
 *
 * Everything this app has ever imaged from the sky has been a **star**:
 * `rasterizePointSources` places a flux at a point, and a point is all any
 * telescope panel here has ever been handed. § 5v gave the engine the other
 * kind of source — a radiance over solid angle, which is what a planet or the
 * Moon actually is — and it landed with no app surface at all. This is that
 * surface, and it is wiring: `rasterizeExtendedSource` produces the same
 * `ImagePlaneScene` `renderField` has consumed since roadmap step 4, so nothing
 * downstream of the authoring step learns that the source had an angular size.
 *
 * **No validation-ladder rung was added for this.** Every number below is
 * § 5v's, § 4b's or § 2f's, called from the app — the boundary APP.md's "what is
 * scopeable at all" section draws. What this file's own test pins is the four
 * claims the *panel* makes that no rung states, and they are listed there.
 *
 * ## The disc is synthetic, and that is a rule rather than a shortcut
 *
 * ROADMAP step 5 lists the scenes' remaining half as "an albedo map, lunar
 * terrain and a real limb-darkening coefficient", and files it under measured
 * data rather than under engine or wiring. So this surface authors a disc and
 * lets a reader set its size and its limb darkening; it claims no real body's
 * dimensions and transcribes no published coefficient. The limb-darkening
 * **law** is textbook and lives in `core/imaging/extended`; the coefficient on
 * screen is the reader's, exactly as § 5v.11 requires.
 *
 * ## The frame is fixed in field angle and the disc moves inside it
 *
 * The obvious framing — size the frame to the disc — makes the disc the same
 * number of pixels across at every angular size, which hides the one thing that
 * separates this module from `rasterizePointSources`: a source small enough
 * stops being a disc and becomes a **star**. Fixing the frame and shrinking the
 * disc inside it is § 5v.7's point-source limit made visible, and it also makes
 * the refusal below unambiguous — the wall is a property of the FRAME, so
 * shrinking the disc never escapes it.
 *
 * ## What refuses, and it is a diagonal
 *
 * A Newtonian's frame runs into `imagePointOf` failing with the engine's own
 * words, *chief ray failed (vignetted)*: past a certain field the chief ray
 * stops clearing the diagonal, which is § 2f's wall arriving at a rasterizer
 * that had no reason to expect it. Measured here rather than derived — ROADMAP
 * quotes § 2f's closed form for the *minimal* diagonal (`fullyIlluminatedFieldMm`
 * = 0 and no √2 footprint allowance), and this preset's `clearRadius` is larger
 * than that, so the closed form reads 7.7× low against what the engine actually
 * does. Printing it beside the measurement would be C1's and C6's failure a
 * third time. What survives the arithmetic is the **exponent**, and the panel
 * says that instead.
 */

export const SKY_OPTICS = ["newtonian", "achromat"] as const;
export type SkyOptic = (typeof SKY_OPTICS)[number];

export const OPTIC_LABELS: Record<SkyOptic, string> = {
  newtonian: "Newtonian (§ 4b)",
  achromat: "achromat refractor (§ 5j)",
};

/**
 * The patch counts offered, with their measured cost.
 *
 * Priced the way C6 prices its screen counts. Re-measured after § 3c's PSF
 * radius cache landed, since the numbers this comment used to carry were taken
 * before it and the change is most of a factor of two — median of three warm
 * runs in node at pupilSamples 32, 5 wavelengths, on a 200 mm f/8:
 *
 * | patches | 1 | 2 | 3 |
 * |---|---|---|---|
 * | Newtonian | 94 ms | 190 ms | 363 ms |
 * | achromat | 1277 ms | 1936 ms | 3332 ms |
 *
 * against **290 / 1002** and **3704 / 6757** at 2 and 3 before the cache. One
 * patch is untouched by it and reads the same either way, which is what says
 * the two columns were measured on the same machine on the same day.
 *
 * Two things the table says that the panel's copy leans on. The doublet is an
 * order of magnitude dearer per PSF than the mirror at identical settings —
 * that is the doublet's own traced wavefront and not this surface's doing. And
 * the level-to-level step is now ~1.9× rather than the ~2.9× it was, because
 * what a level adds is no longer p² traces: a 3×3 grid has nine patches but
 * three radii, and one of those three is the axis the 1×1 preview already
 * traced.
 */
export const PATCH_COUNTS = [1, 2, 3] as const;

export const FOCUS_NM = 550;
const PAD_FACTOR = 4;
const TRACE_SAMPLES = 21;

/** Where the wall bisection gives up. Reported, so "no wall" is never asserted. */
export const WALL_SWEEP_CEILING_DEG = 8;

/** Bins in the radial profile. 48 across a half-frame is ~2 px a bin at size 128. */
const PROFILE_BINS = 48;

/**
 * Mean luminance per annulus — and the reason this is not `radialColorProfile`.
 *
 * The shared helper **sums** each annulus and divides by nothing; `image.ts`
 * says so in its own header, and `hueProfile` gets away with it because
 * chromaticity is a ratio *within* a bin, where the missing normalization
 * cancels exactly. A brightness profile is the case where it does not: an
 * annulus at twice the radius holds about twice the pixels, so a uniform disc
 * comes back as a straight line rising ~8× across the frame, which is a
 * perfectly convincing picture of nothing.
 *
 * So the count is carried alongside the sum. The clipping the square frame does
 * to the outer annuli comes out in the division rather than being modelled,
 * which is why this counts pixels instead of using 2πr·Δr.
 */
function radialMeanLuminance(image: ColorImage, bins: number): Float64Array {
  const cx = image.width / 2;
  const cy = image.height / 2;
  const maxR = Math.min(cx, cy);
  const sum = new Float64Array(bins);
  const count = new Float64Array(bins);
  for (let iy = 0; iy < image.height; iy++) {
    const dy = iy - cy;
    for (let ix = 0; ix < image.width; ix++) {
      const dx = ix - cx;
      const r = Math.hypot(dx, dy);
      if (r >= maxR) continue;
      const b = Math.min(bins - 1, Math.floor((r / maxR) * bins));
      sum[b] = sum[b]! + image.xyz[(iy * image.width + ix) * 3 + 1]!;
      count[b] = count[b]! + 1;
    }
  }
  const mean = new Float64Array(bins);
  for (let b = 0; b < bins; b++) mean[b] = count[b]! > 0 ? sum[b]! / count[b]! : 0;
  return mean;
}

/** Bin centres, in image-plane mm — `radialColorProfile`'s own convention. */
function radialBinRadiiMm(image: ColorImage, bins: number): Float64Array {
  const maxR = Math.min(image.width / 2, image.height / 2);
  const out = new Float64Array(bins);
  for (let b = 0; b < bins; b++) out[b] = ((b + 0.5) / bins) * maxR * image.pixelScaleMm;
  return out;
}

/**
 * How many Airy radii across a disc must be before the picture is a disc.
 *
 * A display convention, stated rather than implied: the threshold is the Airy
 * pattern's own **diameter**, so a source narrower than the image a point
 * already makes is reported as a star. `discDiameterAiryRadii` is printed
 * beside the verdict so a reader can apply a different convention by eye.
 */
export const RESOLVED_AIRY_RADII = 2;

const RAD_TO_ARCSEC = (180 / Math.PI) * 3600;
const DEG_TO_RAD = Math.PI / 180;

export type RefusalStage = "optic" | "frame" | "render";
export type Refusal = SharedRefusal<RefusalStage>;

export interface SkyRequest {
  readonly optic: SkyOptic;
  readonly apertureMm: number;
  readonly focalRatio: number;
  /**
   * Axis → focal plane, as a fraction of the aperture — tube radius plus
   * focuser height plus the eyepiece's back focus, and `newtonian`'s own words
   * for it are "a mechanical number, not an optical one".
   *
   * It is a control because of what it turns out to do; see `FRAMING_NOTE`.
   * Ignored by the refractor, which has no diagonal to move.
   */
  readonly focusOffsetOverD: number;
  /** Frame width, degrees of field. The disc lives inside it. */
  readonly frameWidthDeg: number;
  /** The disc's angular diameter, degrees. Nothing here claims it is anything's. */
  readonly discDiameterDeg: number;
  /** Linear limb-darkening coefficient. 0 is the uniform disc, bitwise (§ 5v.11). */
  readonly limbDarkening: number;
  readonly sourceTemperatureK: number;
  /** Quadrature nodes — NOT SED weights. The disc carries the spectrum. */
  readonly wavelengths: number;
  readonly pupilSamples: number;
  readonly patches: number;
  /** Display gain: white is a pixel holding this multiple of the frame's mean. */
  readonly whiteOverMean: number;
}

/** One annulus of the rendered disc, beside the law it was authored with. */
export interface ProfilePoint {
  /** Image radius as a fraction of the disc's own radius. 1 is the limb. */
  readonly s: number;
  /** Measured luminance, normalized to the frame's centre. */
  readonly measured: number;
  /**
   * `1 − u(1 − √(1 − s²))` — the authored law, evaluated at the same radius and
   * normalized the same way. Zero outside the disc. Not a fit: it is the
   * function that was handed to the rasterizer, drawn again.
   */
  readonly law: number;
}

export interface WallPoint {
  readonly focalRatio: number;
  /** Largest field the chief ray still reaches, degrees; `null` past the ceiling. */
  readonly wallDeg: number | null;
}

export interface SkyResult {
  readonly ok: true;
  readonly rgba: Uint8ClampedArray;
  readonly size: number;
  readonly pixelScaleMm: number;

  readonly focalLengthMm: number;
  readonly fNumber: number;
  readonly obstruction: number;

  /** The frame's half-width and its CORNER, in degrees — the corner is what walls. */
  readonly halfFrameDeg: number;
  readonly cornerFieldDeg: number;
  /** Measured largest field this system passes, degrees. `null` past the ceiling. */
  readonly wallDeg: number | null;

  readonly discDiameterArcsec: number;
  readonly discDiameterPx: number;
  /** The disc's diameter in Airy radii — whether it is a disc at all. */
  readonly discDiameterAiryRadii: number;
  readonly airyRadiusArcsec: number;
  /** Whether the disc is wider than the image a point already makes; see `RESOLVED_AIRY_RADII`. */
  readonly resolved: boolean;

  /** dΩ/dA at the frame corner over its axial value — the falloff, measured. */
  readonly falloffMeasured: number;
  /** cos³ of the corner field. The closed form § 5v.3 pins the measurement to. */
  readonly falloffCos3: number;

  /** Forward chief rays the maps cost, summed over wavelengths (§ 5v's integer). */
  readonly chiefRays: number;
  /** The radius table's own error estimate — NOT the Jacobian's (§ 5v.4). */
  readonly mapErrorEstimateMm: number;

  readonly profile: readonly ProfilePoint[];
  /** Total flux the scene holds — the quantity a star of equal flux would share. */
  readonly sceneFlux: number;

  readonly patches: number;
  readonly finestPatches: number;
  readonly psfEvaluations: number;
  readonly elapsedMs: number;
}

/** A sky render asked of the worker; `seq` lets the caller discard stale replies. */
export interface SkyJob {
  readonly seq: number;
  readonly request: SkyRequest;
}

/** One frame of a sky render; refinement emits several, `done` marks the finest. */
export interface SkyFrame {
  readonly seq: number;
  readonly result: SkyResult | Refusal;
  readonly done: boolean;
}

/**
 * The sentence the focuser-height control exists for, kept beside the number it
 * describes so the panel and this file cannot drift.
 *
 * `newtonian` calls the focus offset mechanical and says it "moves the diagonal
 * up and down the tube without changing the optics at all". Measured on a
 * 200 mm f/8 with the minimal diagonal, the largest field the chief ray reaches
 * moves **0.3204° → 1.1091°** over a focuser height of 100 → 300 mm. So how
 * large an object a Newtonian can *frame* is set by how tall its focuser is,
 * while nothing about its imaging changes.
 */
export const FRAMING_NOTE =
  "the focuser height is mechanical and moves no optical surface — but it sizes the diagonal, " +
  "and the diagonal is what the frame runs into";

function buildOptic(request: SkyRequest) {
  const spec = { apertureMm: request.apertureMm, focalRatio: request.focalRatio };
  const built =
    request.optic === "newtonian"
      ? newtonian({ ...spec, focusOffsetMm: request.focusOffsetOverD * request.apertureMm })
      : { ...achromaticObjective(spec), obstruction: 0 };
  // Pure quadrature: the blackbody rides on the disc, never on the samples. A
  // scene render handed SED-weighted samples applies the spectrum twice and
  // produces a plausible image of the wrong colour — `core/imaging` has a rung
  // pinned to exactly that trap, and `render.ts` carries the same note.
  const samples = quadratureSamples({ count: request.wavelengths });
  const base: OpticalSystem = {
    prescription: built.prescription,
    aperture: { kind: "EPD", value: request.apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: samples,
    conjugate: { kind: "infinite" },
  };
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
  return {
    system: withFocus(base, focus.offsetFromLastVertex),
    obstruction: built.obstruction,
    samples,
    focalLengthMm: request.apertureMm * request.focalRatio,
  };
}

/**
 * The largest field this system still passes, by bisection on `buildFieldMap`.
 *
 * Measured, not derived — see the header. The probe is the same construction the
 * rasterizer runs, so what it finds is exactly what the render would hit: a
 * coarse 8-node table, since the question is whether the chief ray traces at all
 * and not how well the table interpolates. ~1 ms, which is why the panel can
 * afford to know where the wall is *before* it renders.
 *
 * `null` means the bisection reached its ceiling without a refusal. That is the
 * honest report: an absence inside the range swept, not the absence of a wall.
 */
export function fieldWallDeg(system: OpticalSystem, wavelengthNm = FOCUS_NM): number | null {
  const reaches = (deg: number): boolean => {
    try {
      buildFieldMap(system, { maxFieldDeg: deg, wavelengthNm, nodes: 8 });
      return true;
    } catch {
      return false;
    }
  };
  if (reaches(WALL_SWEEP_CEILING_DEG)) return null;
  let lo = 1e-3;
  let hi = WALL_SWEEP_CEILING_DEG;
  if (!reaches(lo)) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface WallRequest {
  readonly optic: SkyOptic;
  readonly apertureMm: number;
  readonly focusOffsetOverD: number;
  readonly focalRatios: readonly number[];
}

/**
 * The wall against focal ratio — the panel's second plot, and its own worker.
 *
 * Cheap enough to sweep live: a focus solve plus a bisection is a few
 * milliseconds a point, because no transform is involved anywhere. The optic is
 * rebuilt per ratio rather than scaled, since a Newtonian's diagonal is
 * re-derived from f and the focuser height every time and that is the whole
 * subject.
 */
export function skyWallSweep(request: WallRequest): readonly WallPoint[] {
  return request.focalRatios.map((focalRatio) => {
    try {
      const { system } = buildOptic({
        ...WALL_SWEEP_DEFAULTS,
        optic: request.optic,
        apertureMm: request.apertureMm,
        focusOffsetOverD: request.focusOffsetOverD,
        focalRatio,
      });
      return { focalRatio, wallDeg: fieldWallDeg(system) };
    } catch {
      // A ratio this preset cannot build at all is not a wall — it is a missing
      // point, and the plot draws a gap rather than a zero.
      return { focalRatio, wallDeg: null };
    }
  });
}

/** The fields `buildOptic` reads that a wall sweep has no opinion about. */
const WALL_SWEEP_DEFAULTS = {
  frameWidthDeg: 0.1,
  discDiameterDeg: 0.05,
  limbDarkening: 0,
  sourceTemperatureK: 5800,
  wavelengths: 1,
  pupilSamples: 32,
  patches: 1,
  whiteOverMean: 1,
} as const;

/**
 * Local exponent of the wall in focal ratio, point to point.
 *
 * The wall falls as roughly 1/F² and this is what "roughly" means: § 2f reports
 * its own boundary running 2.34 → 2.11 from above, and these are the same
 * numbers measured through a different routine — the rasterizer's chief ray
 * rather than `opdMap`'s refusal. That agreement is the claim the panel makes;
 * the closed form itself is not printed, for the reason in the header.
 */
export function wallExponents(points: readonly WallPoint[]): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.wallDeg === null || b.wallDeg === null) continue;
    out.push(-Math.log(b.wallDeg / a.wallDeg) / Math.log(b.focalRatio / a.focalRatio));
  }
  return out;
}

/**
 * The whole surface — one trace, one rasterization, then `patches²` PSFs.
 *
 * The rasterization is NOT the bill: 22–78 ms against 94 ms to 3.3 s of render
 * at the settings offered, so the cost knob a reader turns is `patches` and the
 * optic, exactly as `PATCH_COUNTS` prices them. That is worth stating because it
 * is the opposite of the microscope branch's shape, where § 6s found the raster
 * dominating a traced tile.
 *
 * The render's end of that span used to reach 10 s and now stops at 3.3; the
 * raster did not move, so § 3c's radius cache narrowed the gap the sentence
 * rests on without closing it.
 */
export function renderSky(
  request: SkyRequest,
  onLevel?: (result: SkyResult, done: boolean) => void,
): SkyResult | Refusal {
  const started = performance.now();

  let optic: ReturnType<typeof buildOptic>;
  try {
    optic = buildOptic(request);
  } catch (cause) {
    return refusalOf(cause, "optic");
  }
  const { system, obstruction, samples, focalLengthMm } = optic;

  const psfOptions = {
    pupilSamples: request.pupilSamples,
    padFactor: PAD_FACTOR,
    traceSamples: TRACE_SAMPLES,
    ...(obstruction > 0 ? { obstruction } : {}),
  } as const;

  let scene: ReturnType<typeof rasterizeExtendedSource>;
  let size: number;
  let pixelScaleMm: number;
  let halfFrameDeg: number;
  let wallDeg: number | null;
  try {
    if (!(request.discDiameterDeg < request.frameWidthDeg)) {
      throw new AppRefusal(
        `a disc ${request.discDiameterDeg}° across does not fit in a ${request.frameWidthDeg}° ` +
          `frame — widen the frame or shrink the disc, and note that the frame is what the ` +
          `system's own field limit applies to`,
      );
    }
    // The PSF grid is `pupilSamples`×`padFactor` on a side and the convolution
    // needs the scene to match it, so read the size off the on-axis stack rather
    // than reconstructing the padding rule here (`render.ts`'s reason, unchanged).
    size = spectralStack(system, 0, psfOptions).size;
    halfFrameDeg = request.frameWidthDeg / 2;
    const halfFrameMm = focalLengthMm * Math.tan(halfFrameDeg * DEG_TO_RAD);
    pixelScaleMm = halfFrameMm / (size / 2);
    wallDeg = fieldWallDeg(system);

    const radiance = limbDarkenedDisc({
      diameterDeg: request.discDiameterDeg,
      radiance: 1,
      spectrum: blackbodySpectrum(request.sourceTemperatureK),
      u: request.limbDarkening,
    });
    scene = rasterizeExtendedSource(system, radiance, samples, { size, pixelScaleMm });
  } catch (cause) {
    return refusalOf(cause, "frame");
  }

  const map = scene.maps[Math.floor(scene.maps.length / 2)]!;
  // The corner, not the edge: it is the furthest field in the frame and it is
  // what the wall applies to. Held just inside the table's own last node, since
  // `FieldMap` refuses a radius outside the span it was built over.
  const cornerRadiusMm = Math.hypot(size / 2, size / 2) * pixelScaleMm * (1 - 1e-9);
  const cornerFieldRad = map.fieldAt(cornerRadiusMm);
  const falloffMeasured = map.solidAnglePerArea(cornerRadiusMm) / map.solidAnglePerArea(0);

  let sceneFlux = 0;
  for (const plane of scene.planes) for (const v of plane) sceneFlux += v;

  const naImage = 1 / (2 * request.focalRatio);
  const airyRadiusRad = (1.22 * FOCUS_NM * 1e-6) / (2 * naImage) / focalLengthMm;
  const discDiameterRad = request.discDiameterDeg * DEG_TO_RAD;
  const discRadiusMm = focalLengthMm * Math.tan(discDiameterRad / 2);

  const encode = (image: ColorImage, patches: number, psfEvaluations: number): SkyResult => {
    // White is a multiple of the frame's MEAN rather than of its peak: a disc
    // fills a large share of the frame, so a peak-referenced exposure would
    // re-normalize every time the disc is resized and hide the one thing the
    // limb-darkening dial does. The mean moves with the disc's area too, which
    // is why the control is offered rather than fixed.
    const meanY = integratedXyz(image).y / (image.width * image.width);
    const rgba = toSrgbBytes(image, { exposure: 1 / (meanY * request.whiteOverMean) });

    const mean = radialMeanLuminance(image, PROFILE_BINS);
    const radii = radialBinRadiiMm(image, PROFILE_BINS);
    const centreY = mean[0] ?? 0;
    const profile: ProfilePoint[] = [];
    for (let b = 0; b < PROFILE_BINS; b++) {
      const radiusMm = radii[b]!;
      const y = mean[b]!;
      const s = discRadiusMm > 0 ? radiusMm / discRadiusMm : 0;
      const mu = s <= 1 ? Math.sqrt(Math.max(0, 1 - s * s)) : 0;
      profile.push({
        s,
        measured: centreY > 0 ? y / centreY : 0,
        law: s <= 1 ? 1 - request.limbDarkening * (1 - mu) : 0,
      });
    }

    return {
      ok: true,
      rgba,
      size: image.width,
      pixelScaleMm: image.pixelScaleMm,
      focalLengthMm,
      fNumber: request.focalRatio,
      obstruction,
      halfFrameDeg,
      cornerFieldDeg: (cornerFieldRad * 180) / Math.PI,
      wallDeg,
      discDiameterArcsec: discDiameterRad * RAD_TO_ARCSEC,
      discDiameterPx: (2 * discRadiusMm) / pixelScaleMm,
      discDiameterAiryRadii: discDiameterRad / airyRadiusRad,
      airyRadiusArcsec: airyRadiusRad * RAD_TO_ARCSEC,
      resolved: discDiameterRad / airyRadiusRad > RESOLVED_AIRY_RADII,
      falloffMeasured,
      falloffCos3: Math.cos(cornerFieldRad) ** 3,
      chiefRays: scene.chiefRays,
      mapErrorEstimateMm: map.errorEstimateMm,
      profile,
      sceneFlux,
      patches,
      finestPatches: request.patches,
      psfEvaluations,
      elapsedMs: performance.now() - started,
    };
  };

  try {
    const out = renderField(system, scene, {
      ...psfOptions,
      patches: request.patches,
      onRefinement: (image, patches) => onLevel?.(encode(image, patches, 0), false),
    });
    const final = encode(out.image, out.patches, out.psfEvaluations);
    onLevel?.(final, true);
    return final;
  } catch (cause) {
    return refusalOf(cause, "render");
  }
}

/**
 * The frame's corner, which is what the wall applies to — degrees.
 *
 * Geometry, not a trace: the panel needs it to grey a frame slider *before*
 * asking for a render, and a render is the expensive thing this exists to
 * avoid. The rendered result reports its corner from the traced map instead, so
 * the two are separately derived and the panel can be caught disagreeing.
 */
export const cornerFieldOf = (frameWidthDeg: number): number =>
  (Math.atan(Math.SQRT2 * Math.tan((frameWidthDeg / 2) * DEG_TO_RAD)) * 180) / Math.PI;
