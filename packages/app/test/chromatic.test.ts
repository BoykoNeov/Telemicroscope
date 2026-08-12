import { describe, it, expect } from "vitest";
import { paraxialImageOffset } from "@telemicroscope/core/analysis";
import { chromaticShift, BAND_NM, CROSSING_LINES, type ChromaticSpec } from "../src/chromatic";
import { buildSystem, FOCUS_NM } from "../src/render";

/**
 * The chromatic-focus panel — APP.md Part H, as invariants rather than as prose.
 *
 * **No engine capability was added for it, so no validation-ladder rung was**:
 * `paraxialImageOffset` is step 2's axis crossing and `spotDiagram` is step 1's
 * trace. What is pinned here is the wiring plus the two shapes the panel teaches
 * from — the singlet's curve never turning and the achromat's having a bottom —
 * which are the textbook signature of an achromat and are therefore worth
 * asserting rather than describing.
 */

const SPEC: ChromaticSpec = {
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  // 10 nm steps across 420–680, so the focus wavelength lands on a sample too.
  samples: 27,
  pupilSamples: 21,
};

const run = (patch: Partial<ChromaticSpec> = {}) => chromaticShift({ ...SPEC, ...patch });
const SINGLET = 0;
const ACHROMAT = 1;

describe("the chromatic-focus panel", () => {
  it("draws both lenses, because the image that sends readers here is a comparison", () => {
    const result = run();
    expect(result.curves.map((c) => c.lens)).toEqual(["singlet", "achromat"]);
    for (const curve of result.curves) expect(curve.points.length).toBe(SPEC.samples);
  });

  /**
   * The singlet's curve never turns: focus marches from violet to red without a
   * stationary point anywhere in the band. That is what having one glass means —
   * there is no second dispersion to cancel against, so the shift is monotone in
   * the index and the index is monotone in wavelength.
   */
  it("gives the singlet a curve with no turn in it", () => {
    const points = run().curves[SINGLET]!.points;
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.focusShiftMm, `${points[i]!.nm} nm`).toBeGreaterThan(
        points[i - 1]!.focusShiftMm,
      );
    }
  });

  /**
   * The achromat's curve has a bottom, strictly inside the band — which by
   * continuity means most values on it are reached TWICE, one wavelength either
   * side of the turn. Two colours sharing one focus is the whole trick, and this
   * is the shape that says so.
   */
  it("gives the achromat a bottom, and it is inside the band", () => {
    const points = run().curves[ACHROMAT]!.points;
    const lowest = points.reduce((best, p) => (p.focusShiftMm < best.focusShiftMm ? p : best));
    expect(lowest.nm).toBeGreaterThan(BAND_NM.min + 40);
    expect(lowest.nm).toBeLessThan(BAND_NM.max - 40);
    expect(lowest.nm).toBeCloseTo(540, -1);
    // Both ends climb away from it, so it is a turn and not a shoulder.
    expect(points[0]!.focusShiftMm).toBeGreaterThan(lowest.focusShiftMm);
    expect(points[points.length - 1]!.focusShiftMm).toBeGreaterThan(lowest.focusShiftMm);
  });

  /**
   * And the pair the shape implies is found rather than left to the reader.
   *
   * The search is for the WIDEST pair that shares a focus, not the closest one:
   * the closest pair is always a narrow one straddling the bottom, where the
   * curve is flat and neighbours agree trivially. What the achromat is for is
   * the wide pair, and asking for that is what makes this a test of the shape.
   */
  it("finds two well-separated wavelengths that focus in the same place", () => {
    const points = run({ samples: 53 }).curves[ACHROMAT]!.points;
    const lowest = points.reduce((best, p) => (p.focusShiftMm < best.focusShiftMm ? p : best));
    let widest = 0;
    let pair: [number, number] = [0, 0];
    for (const b of points.filter((p) => p.nm < lowest.nm)) {
      for (const r of points.filter((p) => p.nm > lowest.nm)) {
        if (Math.abs(b.focusShiftMm - r.focusShiftMm) * 1000 > 1) continue;
        if (r.nm - b.nm > widest) {
          widest = r.nm - b.nm;
          pair = [b.nm, r.nm];
        }
      }
    }
    // Violet and deep red — 445 and 665 nm, 220 apart, landing within a micron
    // of one plane. The red end stops short of the band's own 680 because the
    // curve is not symmetric about its bottom: the blue side climbs higher than
    // the red side ever reaches, so the reddest wavelengths have no partner.
    expect(widest).toBeGreaterThan(200);
    expect(pair[0]).toBeLessThan(470);
    expect(pair[1]).toBeGreaterThan(650);
  });

  /**
   * The design's own two wavelengths, quoted the way the panel quotes them. Not
   * zero, and the panel says why: the powers are solved from the catalogue's
   * Abbe numbers in the thin-lens sense and what this app traces is the real
   * thick lens.
   */
  it("brings F and C 28× closer together than the singlet does", () => {
    const gapFor = (lens: "singlet" | "achromat") => {
      const system = buildSystem({
        lens,
        focalLengthMm: SPEC.focalLengthMm,
        apertureMm: SPEC.apertureMm,
        sourceTemperatureK: SPEC.sourceTemperatureK,
        wavelengths: SPEC.wavelengths,
        pupilSamples: 64,
        whiteFraction: 1,
        seeingDOverR0: 0,
      });
      return Math.abs(
        paraxialImageOffset(system, CROSSING_LINES.F) -
          paraxialImageOffset(system, CROSSING_LINES.C),
      );
    };
    const singlet = gapFor("singlet");
    const achromat = gapFor("achromat");
    expect(singlet * 1000).toBeCloseTo(1544.9, 0);
    expect(achromat * 1000).toBeCloseTo(55.2, 0);
    expect(singlet / achromat).toBeGreaterThan(25);
  });

  it("measures the secondary spectrum the achromat is left with", () => {
    const result = run();
    const singlet = result.curves[SINGLET]!;
    const achromat = result.curves[ACHROMAT]!;
    expect(singlet.focusSpreadMm).toBeCloseTo(2.805, 2);
    expect(achromat.focusSpreadMm).toBeCloseTo(0.247, 2);
    expect(singlet.focusSpreadMm / achromat.focusSpreadMm).toBeGreaterThan(10);
  });

  /**
   * The effect half, and it is a traced spot rather than the first curve's
   * arithmetic — which is why the achromat's worst blur is near the diffraction
   * limit while the singlet's is ten times past it. A defocus formula would have
   * drawn a clean V and asserted the law instead of producing it.
   */
  it("turns the focus spread into a blur, at the one plane the picture has", () => {
    const result = run();
    expect(result.curves[SINGLET]!.worstSpotAiryRadii).toBeGreaterThan(8);
    expect(result.curves[ACHROMAT]!.worstSpotAiryRadii).toBeLessThan(1.5);
    for (const curve of result.curves) expect(curve.lost).toBe(0);
  });

  /**
   * ## The panel's most surprising readout, pinned so it stays surprising
   *
   * The picture is focused at 550 nm, so the natural bet is that 550 sits on the
   * zero line. It does not. This plot draws the PARAXIAL focus and the image sits
   * on the plane of least wavefront error, and the gap between those two is
   * spherical aberration — positive on both lenses, which is undercorrection:
   * the marginal rays cross ahead of the paraxial ones, so the balanced plane is
   * inside the paraxial one.
   */
  it("does not cross zero at the wavelength the picture is focused at", () => {
    const result = run();
    for (const curve of result.curves) {
      expect(curve.atFocusWavelength.nm).toBe(FOCUS_NM);
      expect(curve.atFocusWavelength.focusShiftMm, curve.lens).toBeGreaterThan(0);
    }
    // And it is spherical aberration's size, not chromatism's: an order under
    // the singlet's own band spread on the singlet, and an order under the
    // achromat's on the achromat.
    expect(result.curves[SINGLET]!.atFocusWavelength.focusShiftMm * 1000).toBeCloseTo(193, -1);
    expect(result.curves[ACHROMAT]!.atFocusWavelength.focusShiftMm * 1000).toBeCloseTo(24, -1);
  });

  /**
   * The headlines must not move when the plot's resolution does, and the two
   * lenses reach that in different ways — which is the shape difference again,
   * arriving somewhere nobody put it.
   *
   * The **singlet's** curve is monotone, so its spread is set by the two ends of
   * the band, which every sampling contains: exact equality. The **achromat's**
   * lowest point is interior, so its spread is set by a sample that moves as the
   * step changes — bounded by how flat a parabola is near its bottom, which is
   * 0.16 µm between a 20 nm step and a 5 nm one. The wavelength-specific readout
   * is its own evaluation and is exact for both.
   */
  it("reads the same spread at every sampling the panel offers", () => {
    const coarse = run({ samples: 14 });
    const fine = run({ samples: 53 });
    expect(fine.curves[SINGLET]!.focusSpreadMm).toBe(coarse.curves[SINGLET]!.focusSpreadMm);
    expect(
      Math.abs(fine.curves[ACHROMAT]!.focusSpreadMm - coarse.curves[ACHROMAT]!.focusSpreadMm) * 1000,
    ).toBeLessThan(1);
    for (let i = 0; i < 2; i++) {
      expect(fine.curves[i]!.atFocusWavelength.focusShiftMm).toBe(
        coarse.curves[i]!.atFocusWavelength.focusShiftMm,
      );
    }
  });

  it("quotes the focus wavelength from render.ts rather than keeping its own copy", () => {
    expect(FOCUS_NM).toBe(550);
    expect(run().curves[0]!.atFocusWavelength.nm).toBe(FOCUS_NM);
  });
});
