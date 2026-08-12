import { describe, it, expect } from "vitest";
import { wavefront, type WavefrontSpec } from "../src/wavefront";

/**
 * The Zernike readout — ROADMAP's v1 analyses line, as invariants.
 *
 * **No engine capability was added, so no validation-ladder rung was**: `opdMap`
 * is step 2's traced wavefront and `fitZernike`/`fitRms`/`balancedRms`/`psf` are
 * step 3's, called from the app — `rayfan.ts`'s and the spot panel's convention.
 * What is pinned here is the wiring plus the panel's central claim, which no rung
 * states: that "RMS wavefront error" names three different quantities in this
 * engine, that exactly one of them predicts the Strehl, and that the other two
 * are wrong in opposite directions and by large factors.
 */

const SPEC: WavefrontSpec = {
  lens: "achromat",
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  fieldDeg: 0,
  wavelengthNm: 587.5618,
  traceSamples: 21,
  zernikeTerms: 28,
};

const wf = (patch: Partial<WavefrontSpec> = {}) => wavefront({ ...SPEC, ...patch });
const at = (r: ReturnType<typeof wf>, j: number) => r.terms.find((t) => t.j === j)!.waves;

describe("the wavefront panel", () => {
  /**
   * Parseval on an orthonormal basis: the three σ are nested sums over the same
   * coefficients, so they can only ever shrink as more terms come out. Pinned
   * because a sign or index slip here would be invisible on axis, where the
   * three are nearly equal.
   */
  it("orders the three RMS conventions the only way they can be ordered", () => {
    for (const fieldDeg of [0, 0.4, 0.8, 1.6]) {
      for (const lens of ["singlet", "achromat"] as const) {
        const r = wf({ lens, fieldDeg });
        expect(r.rmsWaves, `${lens} at ${fieldDeg}`).toBeGreaterThanOrEqual(r.strehlRmsWaves);
        expect(r.strehlRmsWaves, `${lens} at ${fieldDeg}`).toBeGreaterThanOrEqual(r.balancedWaves);
      }
    }
  });

  /** And they are genuinely different, or the ordering above proves nothing. */
  it("separates them off axis, where the difference is tilt and defocus", () => {
    const axis = wf();
    const off = wf({ fieldDeg: 0.8 });
    // On axis an axially symmetric lens has no tilt, so the first two coincide.
    expect(axis.rmsWaves).toBeCloseTo(axis.strehlRmsWaves, 12);
    // Off axis they part, and the gap is the chief-ray displacement.
    expect(off.rmsWaves / off.strehlRmsWaves).toBeGreaterThan(2);
  });

  /**
   * ## The panel's central claim
   *
   * Maréchal takes "the RMS wavefront error" without saying which one, and only
   * σ over j ≥ 4 — piston and tilt removed, DEFOCUS KEPT — reproduces the
   * transform. This is a real two-method comparison: `psf().strehl` is a peak
   * ratio off an FFT and this is a closed-form exponential of a fitted
   * coefficient sum, reached by different code.
   */
  it("predicts the traced Strehl from the middle convention, to four digits", () => {
    for (const patch of [
      { apertureMm: 4 },
      { apertureMm: 10 },
      { apertureMm: 4, fieldDeg: 0.8 },
      { lens: "singlet" as const, apertureMm: 4 },
    ]) {
      const r = wf(patch);
      // Where Maréchal is valid at all, it is valid to a few parts in a thousand.
      expect(r.strehlRmsWaves, JSON.stringify(patch)).toBeLessThan(0.05);
      expect(Math.abs(r.marechalStrehl - r.tracedStrehl), JSON.stringify(patch)).toBeLessThan(0.005);
    }
  });

  /**
   * Keeping tilt fails off axis and it fails hard, because a tilt SHIFTS a PSF
   * rather than dimming it. The engine keeps tilt in `fitRms` deliberately — off
   * axis it is a real chief-ray displacement — so this is the right number for
   * the wrong question, which is exactly why a panel must not print it here.
   */
  it("is wrong by three orders if tilt is left in, off axis", () => {
    const r = wf({ apertureMm: 20, fieldDeg: 0.8 });
    expect(r.tracedStrehl).toBeGreaterThan(0.3);
    expect(r.marechalFromRms).toBeLessThan(0.01);
    expect(r.tracedStrehl / r.marechalFromRms).toBeGreaterThan(100);
  });

  /**
   * And removing defocus fails wherever defocus is genuinely present: the
   * balanced σ answers "how good could this be if you refocused", while the PSF
   * is computed at the plane the image actually has.
   */
  it("is wrong by 6× if defocus is taken out where defocus is real", () => {
    const r = wf({ lens: "singlet", apertureMm: 10 });
    expect(r.tracedStrehl).toBeCloseTo(0.152, 2);
    expect(r.marechalFromBalanced).toBeCloseTo(0.963, 2);
    expect(r.marechalFromBalanced / r.tracedStrehl).toBeGreaterThan(5);
    // And the correct convention does far better on the same system, even though
    // it is past Maréchal's own validity range — which is the next test.
    expect(Math.abs(r.marechalStrehl - r.tracedStrehl)).toBeLessThan(
      Math.abs(r.marechalFromBalanced - r.tracedStrehl) / 10,
    );
  });

  /**
   * Where the approximation itself runs out, measured rather than recited. At
   * σ ≈ 0.93 λ it returns a flat zero for a lens that still has a ninth of its
   * light in the core — the kind of failure that is dangerous precisely because
   * the formula does not complain.
   */
  it("finds Maréchal's own validity limit, and it is a floor of zero", () => {
    const r = wf({ lens: "singlet", apertureMm: 20 });
    expect(r.strehlRmsWaves).toBeGreaterThan(0.8);
    expect(r.marechalStrehl).toBeLessThan(1e-6);
    expect(r.tracedStrehl).toBeGreaterThan(0.05);
  });

  /**
   * The residual matters because the PSF is built from the FIT and not from the
   * trace. It stays negligible here for the reason `wave/fidelity` states —
   * spherical aberration is exactly a low-order rotationally-symmetric term, so
   * the basis represents it however strong it gets.
   */
  it("keeps the fit residual negligible even where the wavefront is huge", () => {
    const mild = wf();
    const brutal = wf({ lens: "singlet", apertureMm: 20 });
    expect(brutal.ptvWaves / mild.ptvWaves).toBeGreaterThan(50);
    expect(brutal.residualWaves).toBeLessThan(1e-4);
    expect(brutal.residualWaves / brutal.ptvWaves).toBeLessThan(1e-4);
  });

  /** Peak-to-valley is off the RAW samples, so it exceeds any single coefficient. */
  it("quotes peak-to-valley from the trace rather than from the fit", () => {
    const r = wf({ lens: "singlet", apertureMm: 20 });
    const largest = Math.max(...r.terms.filter((t) => t.j >= 2).map((t) => Math.abs(t.waves)));
    expect(r.ptvWaves).toBeGreaterThan(largest);
  });

  it("names its terms from the engine's own table rather than a second one", () => {
    const terms = wf().terms;
    expect(terms.find((t) => t.j === 4)!.name).toBe("defocus");
    expect(terms.find((t) => t.j === 11)!.name).toBe("primary spherical");
    expect(terms.length).toBe(SPEC.zernikeTerms);
  });

  /**
   * ## On axis only the rotationally symmetric terms should exist, and the tilt
   * pair is NOT at the f64 floor — which is worth pinning rather than hiding
   *
   * An axially symmetric lens on its own axis can excite only j = 1, 4, 11, 22.
   * The first draft of this test asserted the rest were under 1e-12 and the tilt
   * pair came in at **7.3e-8** on the singlet wide open — five orders up. It is
   * not the arithmetic's floor and it is not a lens with a tilt in it; it is the
   * least-squares fit leaking, and two measurements say so:
   *
   *  - **j2 and j3 are equal to every digit.** A physical tilt has a direction;
   *    this is the same in x and y, which is the diagonal symmetry a square pupil
   *    grid clipped to a circle actually has.
   *  - **It scales far faster than the wavefront does.** Over the achromat at
   *    f/25, f/10 and f/5 the peak-to-valley grows 0.0060 → 0.0334 → 0.1619 while
   *    the leak grows 4.5e-12 → 7.1e-9 → 2.2e-6 — roughly the cube. A rounding
   *    floor would track the amplitude linearly.
   *
   * So the honest assertions are the two properties above plus the one that
   * matters for the panel: it is seven orders under the aberration that is
   * genuinely there, so nothing on screen can be misread because of it.
   */
  it("leaks a little tilt on axis, equally in x and y, and it is not the f64 floor", () => {
    const r = wf({ lens: "singlet", apertureMm: 20 });
    const tiltX = r.terms.find((t) => t.j === 2)!.waves;
    const tiltY = r.terms.find((t) => t.j === 3)!.waves;
    const spherical = r.terms.find((t) => t.j === 11)!.waves;

    // A fit artifact has no direction; a real tilt would.
    expect(tiltX).toBeCloseTo(tiltY, 15);
    // Above the floor, and far under the aberration that is really there.
    expect(Math.abs(tiltX)).toBeGreaterThan(1e-10);
    expect(Math.abs(tiltX / spherical)).toBeLessThan(1e-6);
    expect(Math.abs(spherical)).toBeGreaterThan(0.1);
  });

  /** It grows as a high power of the wavefront, which a rounding floor would not. */
  it("grows the leak superlinearly, which is what makes it a fit and not a floor", () => {
    const tilt = ([4, 10, 20] as const).map((apertureMm) => {
      const r = wf({ apertureMm });
      return { ptv: r.ptvWaves, tilt: Math.abs(r.terms.find((t) => t.j === 2)!.waves) };
    });
    const ptvRatio = tilt[2]!.ptv / tilt[0]!.ptv;
    const tiltRatio = tilt[2]!.tilt / tilt[0]!.tilt;
    expect(ptvRatio).toBeGreaterThan(20);
    // Hundreds of thousands of times, against a 27× wavefront.
    expect(tiltRatio).toBeGreaterThan(ptvRatio ** 2);
  });

  /**
   * The leak is broad rather than tilt alone — tilt, astigmatism, coma, trefoil
   * and several mid-order terms all sit around 1e-7 — and its **x/y partners are
   * equal in magnitude**, which is the fingerprint that decides the question. A
   * lens asymmetry has a direction and would not pair; a square sampling grid
   * clipped to a circle has four-fold symmetry and produces exactly this.
   */
  it("pairs the leaked terms in x and y, which a real asymmetry would not", () => {
    const r = wf({ lens: "singlet", apertureMm: 20 });
    const at = (j: number) => r.terms.find((t) => t.j === j)!.waves;
    for (const [x, y] of [
      [2, 3],
      [8, 7],
      [10, 9],
    ] as const) {
      expect(Math.abs(at(x)), `j${x}/j${y}`).toBeCloseTo(Math.abs(at(y)), 15);
    }
  });

  /**
   * And the whole leak stays six orders under the aberration that is really
   * there, which is the only property the panel depends on: nothing on screen
   * can be misread because of it.
   */
  it("keeps every non-symmetric term six orders under the real aberration", () => {
    const rotational = new Set([1, 4, 11, 22]);
    const r = wf({ lens: "singlet", apertureMm: 20 });
    const dominant = Math.max(...[...rotational].map((j) => Math.abs(at(r, j))));
    expect(dominant).toBeGreaterThan(0.1);
    for (const term of r.terms) {
      if (rotational.has(term.j)) continue;
      expect(Math.abs(term.waves), `j${term.j}`).toBeLessThan(1e-6);
      expect(Math.abs(term.waves) / dominant, `j${term.j}`).toBeLessThan(1e-6);
    }
  });

  it("loses no rays on a refractor whose stop is its own front rim", () => {
    expect(wf().lost).toBe(0);
    expect(wf({ fieldDeg: 1.6 }).lost).toBe(0);
  });
});
