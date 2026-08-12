import { bestSpotZ, exitBundle, spotAt, type ExitBundle } from "@telemicroscope/core/analysis";
import { imagePlaneZ, opdMap, pupilGrid } from "@telemicroscope/core/pupil";
import { asCompiled } from "@telemicroscope/core/trace";
import {
  fitZernike,
  geometricWeight,
  opdSampling,
  phaseStepPerSample,
} from "@telemicroscope/core/wave";
import { buildSystem, FOCUS_NM, type LensKind } from "./render";

/**
 * The spot diagram — where a pupil-full of rays actually lands, drawn as the
 * scatter it is. ROADMAP's v1 analyses line, the first of its four entries and
 * the only one that is a picture rather than a curve.
 *
 * No DOM, no React, `render.ts`'s pattern again. **No engine capability is
 * added**: `exitBundle` is step 2's aiming, `pupilGrid` is the pupil sampling it
 * has always offered, `spotAt` is step 1's intersection and `bestSpotZ` is step
 * 2's closed form. So no validation-ladder rung is added either, and what this
 * file's tests pin is the wiring plus the three claims the panel makes that no
 * rung states.
 *
 * ## Trace once, evaluate at many planes — and that is the whole grid
 *
 * `analysis/spot` advertises the property this module is built on: every ray
 * leaving the last surface is a straight line, so its transverse position is
 * linear in z and a plane costs an intersection rather than a trace. The
 * through-focus row is therefore free. What the grid actually costs is
 * `fields × (wavelengths + 1)` bundles — three drawn wavelengths plus the one
 * `MEASURE_GRID` pass that every number comes off — which is **sixteen** at the
 * shipped four rows. The column count does not appear in the bill at all, which
 * is why the columns are five and the rows are four rather than the other way
 * round.
 *
 * ## The columns are Rayleigh units, not millimetres
 *
 * A through-focus row in millimetres is unreadable across apertures: at f/5 the
 * whole interesting range is 20 µm and at f/20 it is 300. The column step is
 * therefore **λ/(2·NA²)**, the defocus that puts a quarter wave at the pupil rim
 * — one Rayleigh unit — so the same five columns mean the same thing at every
 * aperture the panel offers, and column ±1 is the classical tolerance rather
 * than a round number of microns.
 *
 * ## Three claims this panel makes that no rung states
 *
 * 1. **The image plane is not the minimum-spot plane, and the gap is a real
 *    length.** `buildSystem` focuses by minimum RMS *wavefront*; `bestSpotZ`
 *    answers minimum RMS *spot*. ROADMAP step 2 says in print that the criteria
 *    "genuinely disagree" — `criterionGapMm` is that sentence as a number, on
 *    the lens the app actually ships. It is measured **on axis at `FOCUS_NM`**,
 *    the wavelength `buildSystem` focused at, and that is not fussiness: at the
 *    d line the same subtraction is +7.21 µm where the criterion is worth −6.81,
 *    because the rest is the chromatic focal shift between 550 nm and 587.56.
 *    Quoting the d-line number as "the criteria disagree" would be attributing
 *    a colour to a definition. The per-row `spotFocusOffsetMm` is the d-line
 *    figure and carries both, which is the honest thing for a row of d-line
 *    spots to carry.
 * 2. **The scatter's own parabola.** `rmsRadiusMm` sampled across the columns is
 *    the quadratic `bestSpotZ` minimises in closed form, so the scanned minimum
 *    and the closed form agree *by construction* — same rays, same algebra. That
 *    is an identity worth pinning (a refactor that breaks one side breaks the
 *    rung) and it is NOT two methods agreeing, so the panel does not say it is.
 * 3. **Where the picture stops being true — and it is the good lens, not the bad
 *    one.** A spot diagram draws ray landings and nothing else, so it is honest
 *    while the scatter is *larger* than the Airy disc and a lie when it is
 *    smaller: the achromat at f/25 on axis has an RMS spot 0.01× the Airy
 *    radius, and its spot diagram draws a hundredth of the real image. That is
 *    `rmsOverAiry`, and it is the readout this panel is worth having for.
 *
 * ## The engine's geometric switch answers a DIFFERENT question, and the two part company
 *
 * The obvious move is to reuse `wave/fidelity` for claim 3 rather than invent a
 * second threshold, and the measurement says that would be wrong. The singlet at
 * f/5 has an RMS spot **7.5 Airy radii** — as geometric as anything this app can
 * build — and `geometricWeight` reads **0.00** there. Nothing is broken:
 * `fidelity.ts` is explicit that its criterion is *phase change per pupil
 * sample, not total wave error*, so it asks **"can the FFT resolve this
 * wavefront at this sampling?"** and this panel asks **"is ray spread or
 * diffraction the bigger blur?"** A wavefront can be tens of waves deep and
 * still perfectly smooth across 64 samples, which is exactly that singlet.
 *
 * So there are three thresholds here and they are not each other:
 *
 *  - `rmsOverAiry` ≪ 1 — the scatter is far smaller than the diffraction disc.
 *    **The spot diagram is misleading**, and the PSF is the honest picture.
 *  - `rmsOverAiry` ≫ 1 — the scatter essentially *is* the image and diffraction
 *    is a detail on it.
 *  - `geometricShare` > 0 — the renderer stops trusting its own FFT. On the two
 *    lenses and the apertures this panel offers it never exceeds 0.04, so the
 *    diffraction branch is valid across the whole grid *including* the cells
 *    where the spot picture has stopped meaning much.
 *
 * Both are surfaced, labelled with the question each answers. A panel that
 * printed one of them as "is this diagram trustworthy" would be quoting an
 * answer to the other question.
 */

/** The F, d and C lines, as `rayfan.ts` draws them — one app, one set of lines. */
export const SPOT_LINES: readonly {
  readonly nm: number;
  readonly name: string;
  readonly color: string;
}[] = [
  { nm: 486.1327, name: "F (blue)", color: "#2b5fd9" },
  { nm: 587.5618, name: "d (yellow)", color: "#c08a00" },
  { nm: 656.2725, name: "C (red)", color: "#c0392b" },
];

/** The d line, which every scalar readout here is quoted at. */
const D_LINE = 587.5618;

/**
 * The grid every NUMBER on this panel is measured on — never the display's.
 *
 * **This separation is the main thing driving the panel taught, and the first
 * fix for it was too narrow.** `gridSamples` is a viewing choice: how many dots
 * a reader wants in a cell. Every scalar here — the RMS spot radius, the ratio
 * against the Airy disc, where the minimum-spot plane sits — is a property of
 * the LENS, and while they shared the display's grid, clicking a sparser picture
 * moved printed physics. Measured against pupil sampling the criterion gap reads
 * −8.29, −6.79, −6.09, −6.83, −6.81 and −6.78 µm at 7, 11, 15, 21, 31 and 51
 * rays: settled from about 21 on, with the app's first default of 15 sitting on
 * an outlier 12% from the converged value. The singlet's spot-to-Airy ratio
 * moved 7.29 → 7.50 over the same change.
 *
 * So the scatter is drawn on `gridSamples` and everything numeric — including
 * the through-focus curve, which must have its minimum where the printed best
 * plane says it is — comes off this one. It costs one extra bundle per row.
 */
export const MEASURE_GRID = 31;

export interface SpotSpec {
  readonly lens: LensKind;
  readonly focalLengthMm: number;
  readonly apertureMm: number;
  readonly sourceTemperatureK: number;
  /** Spectral sample count of the system — see `buildSystem`; geometry-neutral. */
  readonly wavelengths: number;
  /** Outermost field angle of the grid, degrees. Row 0 is always the axis. */
  readonly maxFieldDeg: number;
  /** Rows. Fields are evenly spaced from 0 to `maxFieldDeg` inclusive. */
  readonly fields: number;
  /** `pupilGrid` samples across the pupil diameter — the scatter's density. */
  readonly gridSamples: number;
  /** Columns. Odd, so one column is the image plane itself. */
  readonly focusSteps: number;
}

/** One wavelength's scatter on one plane, in µm from the row's own chief ray. */
export interface SpotCloud {
  readonly nm: number;
  readonly name: string;
  readonly color: string;
  /** [x, y] in µm, measured from the reference below. */
  readonly points: readonly (readonly [number, number])[];
  /** Rays this wavelength lost in the pupil. This IS vignetting. */
  readonly lost: number;
}

export interface SpotCell {
  /** Defocus from the image plane in Rayleigh units — the column's own label. */
  readonly rayleigh: number;
  readonly defocusMm: number;
  readonly clouds: readonly SpotCloud[];
  /** RMS spot radius at the d line (mm), unweighted — the standard convention. */
  readonly rmsRadiusMm: number;
  /** Largest ray distance from the d-line centroid (mm). */
  readonly geoRadiusMm: number;
}

export interface SpotRow {
  readonly fieldDeg: number;
  readonly cells: readonly SpotCell[];
  /**
   * Where minimum RMS spot sits for this field, as a signed offset from the
   * image plane (mm). Positive is further from the lens.
   */
  readonly spotFocusOffsetMm: number;
  /** The same offset in the columns' own currency, so it can be read off the row. */
  readonly spotFocusRayleigh: number;
  /**
   * RMS spot radius at the image plane over the Airy radius, d line.
   *
   * **Below 1 this diagram is drawing something smaller than the real image**
   * and the PSF is the honest picture; above 1 the scatter essentially is the
   * image. See the header — this is not the engine's geometric switch and does
   * not agree with it.
   */
  readonly rmsOverAiry: number;
  /**
   * Geometric share the engine's fidelity criterion gives this field at the d
   * line, 0…1 — **"can the FFT resolve this wavefront", not "is this diagram
   * meaningful"**. Carried so the two questions can be read side by side rather
   * than one standing in for the other.
   */
  readonly geometricShare: number;
}

export interface SpotResult {
  readonly rows: readonly SpotRow[];
  /** Airy radius at the d line (mm) — the circle every cell is drawn against. */
  readonly airyRadiusMm: number;
  /** One Rayleigh unit of defocus (mm) — the column step. */
  readonly rayleighMm: number;
  readonly fNumber: number;
  /** Half-width of the plotted box (µm), one scale for every cell in the grid. */
  readonly boundUm: number;
  /**
   * Minimum-spot plane minus the image plane, **on axis and at `FOCUS_NM`** —
   * the focus criteria disagreeing, with no colour in it. See claim 1.
   */
  readonly criterionGapMm: number;
  readonly elapsedMs: number;
}

/**
 * The chief ray of a bundle — the ρ = 0 sample, which `pupilGrid` includes
 * whenever `gridSamples` is odd.
 *
 * Every cloud is drawn from it rather than from the axis, for `rayfan.ts`'s
 * reason: off axis the image height is hundreds of microns and the spot is a
 * few, so a scatter drawn from the axis would be a dot in the corner with the
 * entire subject of the picture inside its own radius. It is drawn from the
 * **d-line** chief ray of the same field, not from each wavelength's own, so
 * the colours keep their separation — that separation is lateral colour, and it
 * is a real thing about the lens rather than a plotting choice.
 */
function chiefOf(bundle: ExitBundle, z: number): { x: number; y: number } {
  const spot = spotAt(bundle, z);
  const chief = spot.points.find((p) => p.px === 0 && p.py === 0);
  if (chief === undefined) {
    throw new Error(
      `the chief ray was lost at field ${bundle.fieldValue}°: no reference for the spot`,
    );
  }
  return { x: chief.x, y: chief.y };
}

/**
 * The engine's own answer to "is a ray picture honest here", at this field.
 *
 * Read rather than re-derived: `wave/fidelity` measures the criterion on the RAW
 * traced samples and `wave/geometric` turns it into the share the renderer
 * actually uses, so a panel that computed its own spot-versus-Airy threshold
 * would be a second opinion on a question the engine has already answered. The
 * `pupilSamples` handed in is the PSF grid the star page renders at, because the
 * criterion is about sampling a phase and that is the grid it would be sampled
 * on.
 */
function geometricShareAt(
  system: ReturnType<typeof buildSystem>,
  fieldDeg: number,
  pupilSamples: number,
): number {
  const map = opdMap(system, fieldDeg, D_LINE, pupilGrid(21), {});
  const sampling = opdSampling(map, fitZernike(map.samples, 28));
  return geometricWeight(phaseStepPerSample(sampling, pupilSamples));
}

export function spotMatrix(spec: SpotSpec): SpotResult {
  const started = performance.now();
  if (spec.gridSamples % 2 === 0) {
    throw new Error("a spot grid needs an odd sample count so one ray is the chief ray");
  }
  if (spec.focusSteps % 2 === 0) {
    throw new Error("a through-focus row needs an odd column count so one column is the image plane");
  }

  // The SAME system the star image is made from, for `rayfan.ts`'s reason: a
  // plot built on its own defaults would explain a different lens while looking
  // exactly as convincing.
  const system = buildSystem({
    lens: spec.lens,
    focalLengthMm: spec.focalLengthMm,
    apertureMm: spec.apertureMm,
    sourceTemperatureK: spec.sourceTemperatureK,
    wavelengths: spec.wavelengths,
    pupilSamples: 64,
    whiteFraction: 1,
    seeingDOverR0: 0,
  });

  const compiled = asCompiled(system.prescription);
  const imageZ = imagePlaneZ(compiled, system);
  const points = pupilGrid(spec.gridSamples);
  const measurePoints = pupilGrid(MEASURE_GRID);

  const naImage = spec.apertureMm / (2 * spec.focalLengthMm);
  const airyRadiusMm = (1.22 * D_LINE * 1e-6) / (2 * naImage);
  // λ/(2·NA²): the defocus that puts a quarter wave at the pupil rim.
  const rayleighMm = (D_LINE * 1e-6) / (2 * naImage * naImage);

  const half = (spec.focusSteps - 1) / 2;
  const columns: number[] = [];
  for (let i = -half; i <= half; i++) columns.push(i);

  const rows: SpotRow[] = [];
  for (let r = 0; r < spec.fields; r++) {
    const fieldDeg = spec.fields === 1 ? 0 : (r / (spec.fields - 1)) * spec.maxFieldDeg;
    // One bundle per wavelength for the whole row — the columns are
    // intersections of these same rays, which is the property this grid is
    // shaped around.
    const bundles = SPOT_LINES.map((line) => ({
      line,
      bundle: exitBundle(system, fieldDeg, line.nm, points),
    }));
    const dBundle = bundles.find((b) => b.line.nm === D_LINE)!.bundle;
    const reference = chiefOf(dBundle, imageZ);
    // The numbers come off their own grid — see MEASURE_GRID. One extra bundle
    // per row, and it is what stops a viewing choice from moving a measurement.
    const measureBundle = exitBundle(system, fieldDeg, D_LINE, measurePoints);

    const cells: SpotCell[] = columns.map((n) => {
      const defocusMm = n * rayleighMm;
      const z = imageZ + defocusMm;
      const dSpot = spotAt(measureBundle, z);
      return {
        rayleigh: n,
        defocusMm,
        clouds: bundles.map(({ line, bundle }) => {
          const spot = spotAt(bundle, z);
          return {
            nm: line.nm,
            name: line.name,
            color: line.color,
            points: spot.points.map(
              (p) => [(p.x - reference.x) * 1000, (p.y - reference.y) * 1000] as const,
            ),
            lost: bundle.lost,
          };
        }),
        rmsRadiusMm: dSpot.rmsRadius,
        geoRadiusMm: dSpot.geoRadius,
      };
    });

    const spotFocusOffsetMm = bestSpotZ(measureBundle) - imageZ;
    const atImagePlane = cells.find((c) => c.rayleigh === 0)!;
    rows.push({
      fieldDeg,
      cells,
      spotFocusOffsetMm,
      spotFocusRayleigh: spotFocusOffsetMm / rayleighMm,
      rmsOverAiry: atImagePlane.rmsRadiusMm / airyRadiusMm,
      geometricShare: geometricShareAt(system, fieldDeg, 64),
    });
  }

  // The criteria disagreeing, with the colour taken out of it: same field (the
  // axis), same wavelength the system was focused at. One extra bundle, and it
  // buys the difference between a definition and a chromatic shift.
  //
  // On MEASURE_GRID like every other number here, so clicking a sparser picture
  // changes the picture and not the physics.
  const criterionGapMm = bestSpotZ(exitBundle(system, 0, FOCUS_NM, measurePoints)) - imageZ;

  // One box for the whole grid, so a cell that is small is small against the
  // others rather than against a rescaled axis of its own. The Airy circle is in
  // the maximum for the same reason: a diffraction-limited row must not be
  // zoomed until its scatter fills the frame.
  //
  // **A loop and not `Math.max(...points)`, and this is a crash rather than a
  // style note.** The spread form passes every ray in the grid as a separate
  // ARGUMENT, and the grid holds rows × columns × wavelengths × rays of them: at
  // the panel's own 31-ray setting that is 42,300 arguments in one call, and
  // probing convergence at 101 rays took the engine's stack out with
  // `RangeError: Maximum call stack size exceeded`. The shipped range happened
  // to fit on the machine it was written on, which is exactly the kind of limit
  // that is not a promise.
  let spread = airyRadiusMm * 1000;
  for (const row of rows) {
    for (const cell of row.cells) {
      for (const cloud of cell.clouds) {
        for (const [x, y] of cloud.points) {
          const r = Math.hypot(x, y);
          if (r > spread) spread = r;
        }
      }
    }
  }

  return {
    rows,
    airyRadiusMm,
    rayleighMm,
    fNumber: spec.focalLengthMm / spec.apertureMm,
    boundUm: spread * 1.1,
    criterionGapMm,
    elapsedMs: performance.now() - started,
  };
}
