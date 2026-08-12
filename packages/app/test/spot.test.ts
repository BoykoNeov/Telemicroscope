import { describe, it, expect } from "vitest";
import { bestFocus, spotDiagram } from "@telemicroscope/core/analysis";
import { pupilGrid } from "@telemicroscope/core/pupil";
import { MEASURE_GRID, spotMatrix, type SpotSpec } from "../src/spot";
import { buildSystem, FOCUS_NM } from "../src/render";

/**
 * The spot-diagram panel — ROADMAP's v1 analyses line, as invariants.
 *
 * **No engine capability was added for it, so no validation-ladder rung was**:
 * `exitBundle`, `pupilGrid`, `spotAt` and `bestSpotZ` are steps 1–2 called from
 * the app, which is `rayfan.ts`'s convention and Part B's before it. What is
 * pinned here is the wiring plus the three claims the panel makes on screen that
 * no rung states — that a spot diagram misdescribes a GOOD lens, that the
 * engine's geometric switch is answering a different question and visibly parts
 * company with this one, and that the two focus criteria disagree by a length
 * that is a definition rather than a colour.
 */

const SPEC: SpotSpec = {
  lens: "achromat",
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  maxFieldDeg: 1.2,
  fields: 4,
  gridSamples: 21,
  focusSteps: 5,
};

const matrix = (patch: Partial<SpotSpec> = {}) => spotMatrix({ ...SPEC, ...patch });
const D_LINE = 587.5618;
/** The middle of the three drawn wavelengths, which every scalar is quoted at. */
const D = 1;

const system = (patch: Partial<SpotSpec> = {}) => {
  const s = { ...SPEC, ...patch };
  return buildSystem({
    lens: s.lens,
    focalLengthMm: s.focalLengthMm,
    apertureMm: s.apertureMm,
    sourceTemperatureK: s.sourceTemperatureK,
    wavelengths: s.wavelengths,
    pupilSamples: 64,
    whiteFraction: 1,
    seeingDOverR0: 0,
  });
};

describe("the spot-diagram panel", () => {
  it("refuses grids with no chief ray and rows with no image plane", () => {
    expect(() => matrix({ gridSamples: 14 })).toThrow(/odd/);
    expect(() => matrix({ focusSteps: 4 })).toThrow(/odd/);
  });

  /**
   * Every cloud is drawn from the d-line chief ray of its own row, so the
   * middle column's yellow scatter is centred on the origin exactly. The other
   * two wavelengths are NOT re-centred — their offset is lateral colour, which
   * is a real thing about the lens rather than a plotting choice, and a panel
   * that zeroed each colour separately would erase it.
   */
  it("draws from the d chief ray, and does not re-centre the other colours", () => {
    const row = matrix().rows[3]!;
    const centre = row.cells.find((c) => c.rayleigh === 0)!;
    const dChief = centre.clouds[D]!.points.find(([x, y]) => x === 0 && y === 0);
    expect(dChief).toBeDefined();

    const blueChief = centre.clouds[0]!.points[
      centre.clouds[D]!.points.findIndex(([x, y]) => x === 0 && y === 0)
    ]!;
    // Lateral colour at 1.2° on this achromat: small, and not zero.
    expect(Math.abs(blueChief[0])).toBeGreaterThan(1e-6);
  });

  /**
   * The middle column IS `spotDiagram` on the same system — the panel is not
   * reimplementing the intersection, it is calling it. Pinned bitwise, because
   * anything else would mean the grid and the engine disagree about what plane
   * the image is on.
   *
   * On `MEASURE_GRID` and not on `SPEC.gridSamples`: the cells' NUMBERS come off
   * the measurement grid while their dots come off the display's, which is the
   * separation this panel exists in its current shape because of. Importing the
   * constant rather than writing 31 keeps the two from drifting apart silently.
   */
  it("puts the engine's own image plane in the middle column, bit for bit", () => {
    const row = matrix().rows[2]!;
    const centre = row.cells.find((c) => c.rayleigh === 0)!;
    const direct = spotDiagram(system(), row.fieldDeg, D_LINE, pupilGrid(MEASURE_GRID));
    expect(centre.rmsRadiusMm).toBe(direct.rmsRadius);
    expect(centre.geoRadiusMm).toBe(direct.geoRadius);
  });

  /**
   * ## The identity, and it is deliberately NOT presented as corroboration
   *
   * Every exit ray is a straight line, so transverse position is linear in the
   * plane's z and the MEAN SQUARE radius about the (itself moving) centroid is
   * an exact quadratic in it. `bestSpotZ` minimises that quadratic in closed
   * form; the panel's columns sample it. So a parabola through any three columns
   * has its vertex at `bestSpotZ`'s answer — to rounding, by construction, on
   * the same rays and the same algebra.
   *
   * This is worth pinning because a refactor that breaks one side and not the
   * other is a real bug. It is not worth *believing* as evidence, and the panel
   * says so on screen rather than claiming two methods agree.
   */
  it("has a through-focus curve that is exactly the parabola the closed form solves", () => {
    for (const row of matrix().rows) {
      const [a, b, c] = [row.cells[1]!, row.cells[2]!, row.cells[3]!];
      // Vertex of the parabola through three equally-spaced samples of r².
      const ya = a.rmsRadiusMm ** 2;
      const yb = b.rmsRadiusMm ** 2;
      const yc = c.rmsRadiusMm ** 2;
      const vertex = (0.5 * (ya - yc)) / (ya - 2 * yb + yc);
      expect(vertex, `field ${row.fieldDeg}`).toBeCloseTo(row.spotFocusRayleigh, 6);
    }
  });

  /**
   * And the quadratic is exact rather than a good fit: equally spaced samples of
   * a quadratic have a vanishing third difference, and this one vanishes to the
   * arithmetic's floor at every field.
   *
   * **The denominator is the curve's largest value and not its smallest, and the
   * first draft of this test got that wrong.** Normalising by the middle column
   * divides a rounding error by the parabola's own MINIMUM, which on axis is
   * three hundred times smaller than the outer columns — so the ratio read
   * 2.8e-11 there while the absolute residual was the same ~9e-18 as everywhere
   * else, and the test passed only because it happened to look at the last row.
   * The residual is a property of the sum, not of the vertex it is measured
   * against.
   *
   * The floor itself is accounted for rather than accepted: `rmsRadius` sums 149
   * rays, so it carries ~√149·ε of relative error, squaring doubles it, and eight
   * such terms combine to ~4e-18 against a measured 9e-18. That is accumulation
   * in the RMS sum and not the parabola being approximate.
   */
  it("is quadratic to f64, not merely close to it", () => {
    for (const row of matrix().rows) {
      const y = row.cells.map((c) => c.rmsRadiusMm ** 2);
      const third = y[4]! - 3 * y[3]! + 3 * y[2]! - y[1]!;
      expect(Math.abs(third), `field ${row.fieldDeg}`).toBeLessThan(1e-16);
      expect(Math.abs(third) / Math.max(...y), `field ${row.fieldDeg}`).toBeLessThan(1e-12);
    }
  });

  /**
   * The panel's composition against the engine's own focus API: the gap it
   * prints is the difference between two criteria `analysis/focus` implements,
   * so it must be reproducible by asking that module twice.
   */
  it("agrees with analysis/focus about what the two criteria disagree by", () => {
    const base = matrix();
    const s = system();
    const spot = bestFocus(s, "minRmsSpot", { wavelengthNm: FOCUS_NM, pupilSamples: 31 });
    const wave = bestFocus(s, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
    expect(base.criterionGapMm).toBeCloseTo(spot.z - wave.z, 6);
  });

  /**
   * And the currency matters: quoted at the d line the same subtraction changes
   * SIGN, because the rest of it is the chromatic focal shift between 550 nm and
   * 587.56. The panel quotes the 550 figure and says why.
   */
  it("separates the criterion gap from the colour that would swamp it", () => {
    const base = matrix();
    expect(base.criterionGapMm * 1000).toBeCloseTo(-6.81, 1);
    expect(base.rows[0]!.spotFocusOffsetMm * 1000).toBeCloseTo(7.21, 1);
    // Opposite signs — so the d-line number cannot stand in for the criterion.
    expect(Math.sign(base.criterionGapMm)).not.toBe(Math.sign(base.rows[0]!.spotFocusOffsetMm));
  });

  /**
   * ## The measurement does not ride on how dense a picture the reader wanted
   *
   * Driving the panel found this: `gridSamples` is a viewing choice, and while
   * the criterion gap was computed on that same grid, clicking a sparser picture
   * moved a printed physical number by 12%. Swept against pupil sampling the gap
   * reads −8.29, −6.79, −6.09, −6.83, −6.81, −6.78 µm at 7, 11, 15, 21, 31 and
   * 51 rays — settled from about 21 on, with the app's ORIGINAL default of 15
   * sitting on an outlier. It is now measured on its own fixed grid inside the
   * settled range.
   *
   * Two assertions, because either alone would pass for the wrong reason: the
   * gap is invariant to the display density, AND the grid it is fixed on is
   * genuinely converged rather than merely fixed.
   */
  it("holds EVERY printed number fixed against the display density", () => {
    const runs = ([11, 15, 21, 31] as const).map((gridSamples) => matrix({ gridSamples }));
    const first = runs[0]!;
    for (const run of runs) {
      // Bitwise, not close: these come off the same grid, so anything else
      // would mean a viewing control had leaked into the measurement again.
      expect(run.criterionGapMm).toBe(first.criterionGapMm);
      run.rows.forEach((row, i) => {
        expect(row.spotFocusOffsetMm).toBe(first.rows[i]!.spotFocusOffsetMm);
        expect(row.rmsOverAiry).toBe(first.rows[i]!.rmsOverAiry);
        row.cells.forEach((cell, j) => {
          expect(cell.rmsRadiusMm).toBe(first.rows[i]!.cells[j]!.rmsRadiusMm);
        });
      });
    }
    // The control: the PICTURE did change, so the test above is not passing
    // because nothing moved.
    const dots = (m: typeof first) => m.rows[0]!.cells[0]!.clouds[0]!.points.length;
    expect(dots(runs[3]!)).toBeGreaterThan(dots(runs[0]!) * 3);
  });

  it("fixes it on a grid that has actually converged, not merely a fixed one", () => {
    const s = system();
    const at = (pupilSamples: number) =>
      bestFocus(s, "minRmsSpot", { wavelengthNm: FOCUS_NM, pupilSamples }).z;
    const converged = at(31);
    // Within 0.1 µm of a four-times-denser grid.
    expect(Math.abs(at(101) - converged) * 1000).toBeLessThan(0.1);
    // And the coarse grid the panel used to default to is NOT within that —
    // which is the finding, and without it the test above proves nothing.
    expect(Math.abs(at(15) - converged) * 1000).toBeGreaterThan(0.5);
  });

  /**
   * ## A spot diagram misdescribes a GOOD lens
   *
   * The panel's headline, and it runs opposite to the intuition. The scatter is
   * an honest picture while it is bigger than the diffraction disc; when the
   * lens is well corrected the cell draws a point where the real image is an
   * Airy disc orders wider.
   */
  it("is a hundred times too small on a well-corrected lens, and honest on a poor one", () => {
    const good = matrix({ apertureMm: 4 }).rows[0]!;
    expect(good.rmsOverAiry).toBeLessThan(0.02);

    const poor = matrix({ lens: "singlet", apertureMm: 20 }).rows[0]!;
    expect(poor.rmsOverAiry).toBeGreaterThan(5);
  });

  /**
   * ## The two switches answer different questions, and here is where they part
   *
   * The obvious move is to reuse `wave/fidelity` for the claim above rather than
   * introduce a second threshold. This is the measurement that says it would be
   * wrong. `fidelity.ts` is explicit that its criterion is *phase change per
   * pupil sample, not total wave error*: it asks whether the FFT can resolve the
   * wavefront, which is a question about arithmetic, and a wavefront can be tens
   * of waves deep while still perfectly smooth across 64 samples.
   *
   * The singlet wide open is exactly that case — as geometric a spot as this app
   * can build, with the engine's geometric share still at the floor. Both
   * readouts are on the panel, each labelled with its own question.
   */
  it("has a 7-Airy-radius spot where the engine's geometric share is still zero", () => {
    const row = matrix({ lens: "singlet", apertureMm: 20 }).rows[0]!;
    expect(row.rmsOverAiry).toBeCloseTo(7.46, 1);
    expect(row.geometricShare).toBe(0);
  });

  /** The control: the share is not stuck at zero, it is genuinely small here. */
  it("does move the geometric share once the wavefront outruns the sampling", () => {
    const shares = matrix({ lens: "singlet", apertureMm: 20, maxFieldDeg: 1.6 }).rows.map(
      (r) => r.geometricShare,
    );
    expect(Math.max(...shares)).toBeGreaterThan(0);
    // Still nowhere near the switch, which is the point being made.
    expect(Math.max(...shares)).toBeLessThan(0.5);
  });

  /**
   * The column step is λ/(2·NA²) — the defocus that puts a quarter wave at the
   * pupil rim — so the same five columns mean the same thing at every aperture.
   * Pinned against the closed form and against its own NA scaling.
   */
  it("steps the columns in Rayleigh units, not in millimetres", () => {
    const wide = matrix({ apertureMm: 20 });
    const na = 20 / (2 * 100);
    expect(wide.rayleighMm).toBeCloseTo((D_LINE * 1e-6) / (2 * na * na), 12);
    // Halving the aperture quadruples the unit.
    expect(matrix({ apertureMm: 10 }).rayleighMm / wide.rayleighMm).toBeCloseTo(4, 9);
  });

  /**
   * The columns cost intersections and not traces, which is the property the
   * whole grid shape rests on and the reason the panel runs without a worker.
   * Nine columns must not cost meaningfully more tracing than five — measured as
   * ray counts rather than as milliseconds, which no test should assert.
   */
  it("adds columns for free: more planes, the same rays", () => {
    const five = matrix({ focusSteps: 5 });
    const nine = matrix({ focusSteps: 9 });
    const rays = (m: typeof five) =>
      m.rows[0]!.cells[0]!.clouds.reduce((n, c) => n + c.points.length, 0);
    expect(rays(nine)).toBe(rays(five));
    expect(nine.rows[0]!.cells.length).toBe(9);
    // And the shared planes hold the same numbers.
    expect(nine.rows[0]!.cells.find((c) => c.rayleigh === 0)!.rmsRadiusMm).toBe(
      five.rows[0]!.cells.find((c) => c.rayleigh === 0)!.rmsRadiusMm,
    );
  });

  it("shares one box across the whole grid, so a small cell reads as small", () => {
    const m = matrix();
    const worst = Math.max(
      ...m.rows.flatMap((r) =>
        r.cells.flatMap((c) => c.clouds.flatMap((cl) => cl.points.map(([x, y]) => Math.hypot(x, y)))),
      ),
    );
    expect(m.boundUm).toBeGreaterThanOrEqual(worst);
    // The Airy circle is inside the box too: a diffraction-limited row must not
    // be zoomed until its scatter fills the frame.
    expect(m.boundUm).toBeGreaterThan(m.airyRadiusMm * 1000);
  });

  /**
   * ## The densest grid the panel offers must not take the stack out
   *
   * The shared box was originally `Math.max(...everyRayInTheGrid)`, which passes
   * every ray as a separate ARGUMENT. That is rows × columns × wavelengths ×
   * rays of them — 42,300 at the panel's own 31-ray setting — and probing
   * convergence at 101 rays hit `RangeError: Maximum call stack size exceeded`.
   * The shipped range happened to fit on the machine it was written on, which is
   * the kind of limit that is not a promise, so the reduction is a loop and this
   * rung runs past the top of the panel's own range.
   */
  it("survives far past the densest grid it offers, where a spread argument list would not", () => {
    const dense = matrix({ gridSamples: 101, fields: 4, focusSteps: 5 });
    expect(dense.boundUm).toBeGreaterThan(0);
    expect(dense.rows[0]!.cells[0]!.clouds[0]!.points.length).toBeGreaterThan(7000);
  });

  it("loses no rays on a refractor whose stop is its own front rim", () => {
    for (const row of matrix().rows) {
      for (const cell of row.cells) {
        for (const cloud of cell.clouds) expect(cloud.lost).toBe(0);
      }
    }
  });
});
