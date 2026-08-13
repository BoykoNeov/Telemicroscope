import { describe, it, expect } from "vitest";
import { achromaticObjective } from "../src/designs/achromat";
import { refractorPair } from "../src/designs/refractor";
import { exitBundle, spotAt, bestSpotZ } from "../src/analysis/spot";
import { pupilGrid } from "../src/pupil/aiming";
import { opdMap } from "../src/pupil/opd";
import { psf } from "../src/wave/psf";
import { mtf, mtfAt, mtfProfile, mtfSections, diffractionLimitedMtf } from "../src/wave/mtf";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Rungs for the two directional MTF sections — docs/VALIDATION.md § 6ad.
 *
 * `wave/mtf` has said since it was written that the tangential/sagittal split is
 * "a separate function when field curvature work arrives". It arrived at § 6ac,
 * which gave the two sections their two focal surfaces; this file is the readout
 * that names them in frequency space, and the rungs that decide whether the
 * naming means anything.
 *
 * WHAT IS ACTUALLY AT RISK HERE. The modulus itself is already pinned — § 2b put
 * the on-axis MTF against the closed-form circular-pupil curve and § 2b's cutoff
 * rung put its scale against 2·NA/λ. Slicing a row and a column out of that array
 * adds no physics. What it adds is a CLAIM ABOUT DIRECTION — that the row is the
 * meridional section and the column is the other one — and a direction is exactly
 * the kind of thing that passes every magnitude test while being backwards. So
 * the rungs below spend almost all of their effort on the direction:
 *
 *  1. **The closed form, twice.** On axis both sections are the published
 *     (2/π)·[arccos ν − ν√(1−ν²)] (Goodman, *Introduction to Fourier Optics*).
 *     External number, and it is what stops a section from being some other
 *     array entirely.
 *
 *  2. **On axis the two are the same curve to the f64 floor.** A rotationally
 *     symmetric pupil has no meridional plane, so a split there would be the
 *     sampler inventing one. Measured 1.4e-16 — a floor, not a tolerance.
 *
 *  3. **The monocentric negative control, which is the load-bearing one.** A
 *     spherical mirror with the aperture stop at its centre of curvature is
 *     symmetric about that stop for EVERY field angle — the Schmidt camera's
 *     whole premise — so coma, astigmatism and distortion all vanish identically
 *     and only spherical aberration and a curved field survive. It is therefore a
 *     system that is genuinely off axis and genuinely round, and any machinery
 *     that manufactures a split out of a non-zero field angle rather than out of
 *     an asymmetry fails here — and it is used at 0.75 waves RMS, because a round
 *     system is round for free if it is also perfect. Measured split 1.2e-4
 *     against the achromat's 0.226 at the same field: three orders.
 *
 *  4. **The direction itself, agreed by three machineries.** On the § 5j achromat
 *     at 0.8° the coma flare lies in the meridional plane, and the ray spot's
 *     second moments (geometry, no transform anywhere), the PSF intensity's
 *     second moments (one transform) and the section split (two transforms) all
 *     say the blur is along x — 1.848, 1.390 and 1.48× respectively. Three routes,
 *     one answer, and only the last of them is the code under test.
 *
 * WHY NOT REFOCUS TO THE TWO FOCAL SURFACES. The obvious rung — put the image
 * plane at § 6ac's tangential focus and watch the tangential section win — was
 * tried and does not hold on this achromat, and the reason is worth recording so
 * it is not attempted again as a bug: at 0.8–1.6° this lens is coma-dominated,
 * not astigmatism-dominated, so BOTH sections are best at the sagittal focus and
 * the crossover never happens. The classical crossover is a statement about pure
 * astigmatism, and a real lens at a field where its astigmatism is measurable has
 * coma several times larger. A rung that needed a coma-free astigmatic system
 * would need a design this repo does not have; the direction is pinned by
 * agreement between machineries instead, which is stronger anyway.
 */

const LAM = LINE_D;
const D = 100;

/** § 5j's achromat, the same one `field-curvature.test.ts` benches on. */
const achromat = achromaticObjective({ apertureMm: D, focalRatio: 10 });
const lens = (deg: number): OpticalSystem => ({
  prescription: achromat.prescription,
  aperture: { kind: "stopRadius", value: D / 2 },
  field: { kind: "angle", values: [deg] },
  wavelengths: [{ nm: LAM, weight: 1 }],
  conjugate: { kind: "infinite" },
});

/**
 * A spherical mirror with the stop at its centre of curvature.
 *
 * The stop is a flat surface `|R|` in front of the mirror, so the mirror's vertex
 * lands at z = 200 and its centre of curvature at z = 200 + R = 0, on the stop.
 * Every field angle then sees the same system rotated about the stop, which is
 * why the odd-order field aberrations are identically absent rather than small.
 */
const MONO_R = -200;
const MONO_SEMI = 15;
function monocentric(deg: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 0,
        semiAperture: MONO_SEMI,
        thickness: -MONO_R,
        medium: "AIR",
        isStop: true,
      },
      { kind: "reflect", curvature: 1 / MONO_R, semiAperture: 60, thickness: MONO_R / 2 },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: MONO_SEMI },
    field: { kind: "angle", values: [deg] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** A paraboloid at its focus — § 2b's own geometrically perfect system. */
const PARA_R = -200;
const PARA_SEMI = 10;
const paraboloid: OpticalSystem = {
  prescription: {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / PARA_R,
        conic: -1,
        semiAperture: PARA_SEMI,
        thickness: PARA_R / 2,
        isStop: true,
      },
    ],
  },
  aperture: { kind: "stopRadius", value: PARA_SEMI },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LAM, weight: 1 }],
  conjugate: { kind: "infinite" },
};

const GRID = { pupilSamples: 64, padFactor: 4, traceSamples: 31, zernikeTerms: 28 } as const;

/** Largest |T − S| over the band, ignoring ν = 0 where both are exactly 1. */
function largestSplit(s: ReturnType<typeof mtfSections>): number {
  let worst = 0;
  for (let b = 1; b < s.nu.length; b++) {
    worst = Math.max(worst, Math.abs(s.tangential[b]! - s.sagittal[b]!));
  }
  return worst;
}

describe("§ 6ad — on axis, both sections are the closed-form curve", () => {
  const p = psf(paraboloid, 0, LAM, GRID);
  const m = mtf(p);
  const sections = mtfSections(m, 41, p.pupilSamples);

  /**
   * Rung: the published circular-pupil MTF, reached twice by two different rows
   * of the same array. No fitted constants.
   */
  it("reproduces (2/π)·[arccos ν − ν√(1 − ν²)] in both sections", () => {
    for (let b = 0; b < sections.nu.length; b++) {
      const analytic = diffractionLimitedMtf(sections.nu[b]!);
      expect(Math.abs(sections.tangential[b]! - analytic)).toBeLessThan(0.01);
      expect(Math.abs(sections.sagittal[b]! - analytic)).toBeLessThan(0.01);
    }
  });

  it("is exactly 1 at zero frequency, in both sections", () => {
    expect(sections.nu[0]).toBe(0);
    expect(sections.tangential[0]).toBeCloseTo(1, 12);
    expect(sections.sagittal[0]).toBeCloseTo(1, 12);
  });

  it("spans [0, 1] inclusive, unlike the profile's bin centres", () => {
    expect(sections.nu[sections.nu.length - 1]).toBe(1);
    // The endpoint is the cutoff, where the pupil autocorrelation has run out.
    expect(sections.tangential[sections.nu.length - 1]!).toBeLessThan(0.01);
    expect(sections.sagittal[sections.nu.length - 1]!).toBeLessThan(0.01);
    // …and the profile deliberately does NOT reach either end.
    const profile = mtfProfile(m, 41, p.pupilSamples);
    expect(profile.nu[0]).toBeGreaterThan(0);
    expect(profile.nu[40]).toBeLessThan(1);
  });

  /**
   * A rotationally symmetric pupil has no meridional plane. A split here would
   * be the sampler inventing a direction, so this is a floor and not a tolerance
   * — 1.4e-16 measured, which is f64 on numbers of order 1.
   */
  it("splits by nothing at all on axis", () => {
    expect(largestSplit(sections)).toBeLessThan(1e-15);
  });

  /**
   * `mtfAt` has always sampled along +x. Off axis that is the meridional
   * direction, so every caller of it has been reading the tangential section
   * under a name that says "the MTF" — stated as an identity so the two cannot
   * drift apart, and so the older callers keep meaning what they meant.
   */
  it("is the same sampler `mtfAt` already was", () => {
    for (let b = 0; b < sections.nu.length; b++) {
      expect(sections.tangential[b]).toBe(mtfAt(m, sections.nu[b]!, p.pupilSamples));
    }
  });
});

/**
 * Rung: a system that is off axis, heavily aberrated, and has no off-axis
 * ASYMMETRY.
 *
 * This is the control that gives the direction rung below its meaning. Without
 * it, machinery that split the array on any non-zero field — a mis-shifted
 * centre, an x-only interpolation error, a chief-ray offset leaking into the
 * grid — would pass every test in this file.
 *
 * **Why the aperture is 15 mm and not 10.** A round system is round for free if
 * it is also perfect, so a control that is near diffraction-limited proves
 * almost nothing. At semi-aperture 10 this mirror carries 0.135 waves RMS at
 * 0.8° and only 0.0698 at 1.6° — the second is INSIDE Maréchal's 0.0745 and so
 * is very nearly a perfect system agreeing with itself. At 15 the spherical
 * aberration is 0.747 and 0.593 waves, an order past the diffraction limit and
 * a Strehl under 0.11, and the sections still agree to 5e-4. That is the
 * statement worth pinning: **large aberration, no asymmetry, no split.**
 *
 * (The wavefront falls with field rather than rising, which is not a mistake:
 * the focal surface of a monocentric system is a sphere about the stop, so a
 * flat image plane sits at a different defocus at each field, and here that
 * defocus partly cancels the spherical aberration. It is irrelevant to the
 * control and would be a puzzle to meet later, so it is written down now.)
 */
describe("§ 6ad — the monocentric mirror splits by nothing off axis either", () => {
  for (const deg of [0.8, 1.6]) {
    it(`at ${deg}°: coma and astigmatism are absent by symmetry, and so is the split`, () => {
      const p = psf(monocentric(deg), deg, LAM, GRID);
      const sections = mtfSections(mtf(p), 41, p.pupilSamples);

      // The system really is off axis: the image point has moved by f·tan θ.
      const bundle = exitBundle(monocentric(deg), deg, LAM, pupilGrid(31), {});
      const spot = spotAt(bundle, bestSpotZ(bundle));
      expect(spot.lost).toBe(0);
      const expectedHeight = Math.abs(MONO_R / 2) * Math.tan((deg * Math.PI) / 180);
      expect(Math.abs(spot.centroidX) / expectedHeight).toBeGreaterThan(0.9);

      // …and it really is aberrated: 0.747 and 0.593 waves RMS, against
      // Maréchal's 0.0745. The control must not be a perfect system.
      const map = opdMap(monocentric(deg), deg, LAM, pupilGrid(31), {});
      expect(map.rmsWaves).toBeGreaterThan(0.3);
      expect(p.strehl).toBeLessThan(0.15);

      // …and still round. 1.2e-4 at 0.8° and 4.6e-4 at 1.6° — the
      // fit-over-a-discrete-pupil leak Part J identified, which stops being
      // x↔y symmetric once the chief ray is displaced along x, and which grows
      // with the wavefront exactly as Part J measured. Against the achromat's
      // 0.226 below: three orders.
      expect(largestSplit(sections)).toBeLessThan(1e-3);
    });
  }
});

/**
 * Rung: which section is the tangential one, decided by three machineries that
 * share no code below the trace.
 */
describe("§ 6ad — the § 5j achromat at 0.8°, where coma picks a direction", () => {
  const DEG = 0.8;
  const sys = lens(DEG);
  const p = psf(sys, DEG, LAM, GRID);
  const sections = mtfSections(mtf(p), 41, p.pupilSamples);

  /** Second moments of the traced spot — geometry, with no transform in it. */
  const rayRatio = (() => {
    const axial = exitBundle(lens(0), 0, LAM, pupilGrid(31), {});
    const plane = bestSpotZ(axial);
    const spot = spotAt(exitBundle(sys, DEG, LAM, pupilGrid(31), {}), plane);
    let xx = 0;
    let yy = 0;
    for (const q of spot.points) {
      xx += (q.x - spot.centroidX) ** 2;
      yy += (q.y - spot.centroidY) ** 2;
    }
    return Math.sqrt(xx / yy);
  })();

  /** Second moments of the PSF intensity — one transform. */
  const psfRatio = (() => {
    const n = p.size;
    let w = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = p.intensity[y * n + x]!;
        w += v;
        sx += v * x;
        sy += v * y;
      }
    }
    const cx = sx / w;
    const cy = sy / w;
    let xx = 0;
    let yy = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = p.intensity[y * n + x]!;
        xx += v * (x - cx) ** 2;
        yy += v * (y - cy) ** 2;
      }
    }
    return Math.sqrt(xx / yy);
  })();

  it("blurs along the meridional direction, by rays and by the transform alike", () => {
    // 1.848 and 1.390. They are not the same number and are not meant to be —
    // an unweighted ray count and an energy-weighted intensity weigh a coma
    // flare's thin tail completely differently. What is being pinned is that
    // both exceed 1, i.e. that both call x the blurred direction.
    expect(rayRatio).toBeGreaterThan(1.5);
    expect(psfRatio).toBeGreaterThan(1.2);
    expect(Math.abs(rayRatio / 1.848 - 1)).toBeLessThan(0.02);
    expect(Math.abs(psfRatio / 1.390 - 1)).toBeLessThan(0.02);
  });

  it("puts the tangential section below the sagittal one, across the band", () => {
    // Held from ν = 0.05 out to the cutoff. At 1.6° the two cross back below
    // ν ≈ 0.15, which is a real feature of a coma-dominated OTF and not a
    // failure — hence a field where the statement is clean, and a floor on ν.
    for (let b = 0; b < sections.nu.length; b++) {
      if (sections.nu[b]! < 0.05) continue;
      expect(sections.tangential[b]!).toBeLessThan(sections.sagittal[b]!);
    }
    // 0.4702 against 0.6961 at ν = 0.1: a 1.48× split, three orders above the
    // monocentric control's 1.1e-4.
    const at = (v: number, arr: Float64Array) => arr[Math.round(v * (sections.nu.length - 1))]!;
    expect(Math.abs(at(0.1, sections.tangential) / 0.4702 - 1)).toBeLessThan(0.02);
    expect(Math.abs(at(0.1, sections.sagittal) / 0.6961 - 1)).toBeLessThan(0.02);
  });

  /**
   * The summary this replaces, shown failing to be a summary: an azimuthal
   * average is not bracketed by the two sections, because the azimuths between
   * them are worse than either. A panel drawing only the average would be
   * reporting a contrast no orientation of a bar target actually gets.
   */
  it("is not bracketed by its own radial average", () => {
    const profile = mtfProfile(mtf(p), 41, p.pupilSamples);
    let below = 0;
    for (let b = 1; b < profile.nu.length; b++) {
      const t = sections.tangential[b]!;
      const s = sections.sagittal[b]!;
      if (profile.modulation[b]! < Math.min(t, s) - 1e-9) below++;
    }
    expect(below).toBeGreaterThan(0);
  });
});

/**
 * Rung: `cutoffCyclesPerMm` is the cutoff of the aperture that was ASKED FOR.
 *
 * `wave/mtf`'s header used to call the cutoff landing at exactly `pupilSamples`
 * frequency bins "a strong internal check on the whole pupil→image scale". It is
 * not one, and this is the rung that says so. The scale comes from the exit pupil
 * RADIUS; the array's real support comes from the rays that survived the trace,
 * and nothing makes those the same aperture.
 *
 * The system that parts them is not exotic — it is the one the app ships.
 * `refractorPair` fixes the crown's centre thickness at 3 mm whatever the focal
 * length, so past some semi-diameter the two sags meet and the tracer reports
 * `miss` from the rim inward: APP.md Part B's aperture wall, measured there as an
 * EPD going as √f. Here the same wall is measured as a MODULATION reaching zero
 * early, which is where it stops being a lost-ray count and becomes a wrong
 * number on a plot.
 *
 * WHAT MAKES THIS APERTURE AND NOT ABERRATION. A badly aberrated system also has
 * very little contrast at high frequency, so "the curve is near zero at ν = 0.8"
 * proves nothing on its own. The aberration-free PSF — same pupil, phase zeroed,
 * `keepDiffractionLimited` — cuts off in the SAME place. A perfect system with
 * contrast that stops at 0.73 of its stated cutoff has a smaller aperture than it
 * says it has, and there is no other reading.
 */
describe("§ 6ad — the reported cutoff is the aperture you asked for", () => {
  const D = 100;
  /** As `packages/app/src/render.ts` builds it: full aperture as the rim. */
  const shipped = (focalLengthMm: number): OpticalSystem => ({
    prescription: refractorPair(focalLengthMm, D, focalLengthMm).achromat,
    aperture: { kind: "EPD", value: D },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LAM, weight: 1 }],
    conjugate: { kind: "infinite" },
  });

  /** Largest ν at which the modulation is still above the f64 grass. */
  function measuredCutoff(sections: ReturnType<typeof mtfSections>): number {
    let last = 0;
    for (let b = 0; b < sections.nu.length; b++) {
      if (sections.tangential[b]! > 1e-5) last = sections.nu[b]!;
    }
    return last;
  }

  // f/20 keeps its whole pupil; f/10 and f/5 do not. The measured ν is the
  // surviving radius fraction, which is the point: 0.728 and 0.515 of the
  // aperture transmits, and 0.73 and 0.51 of the stated cutoff carries contrast.
  for (const [focalLengthMm, tracedRho] of [
    [2000, 1.0],
    [1000, 0.728],
    [500, 0.515],
  ] as const) {
    it(`at f=${focalLengthMm} the pupil transmits to ρ = ${tracedRho}, and so does the MTF`, () => {
      const sys = shipped(focalLengthMm);
      const map = opdMap(sys, 0, LAM, pupilGrid(41), {});
      let maxRho = 0;
      for (const s of map.samples) maxRho = Math.max(maxRho, Math.hypot(s.px, s.py));
      expect(Math.abs(maxRho / tracedRho - 1)).toBeLessThan(0.02);

      const p = psf(sys, 0, LAM, { ...GRID, keepDiffractionLimited: true });
      const real = mtfSections(mtf(p), 81, p.pupilSamples);
      expect(Math.abs(measuredCutoff(real) / tracedRho - 1)).toBeLessThan(0.06);

      // The same pupil with its phase zeroed stops in the same place: aperture,
      // not aberration.
      const flat = mtf({ ...p, intensity: p.diffractionLimitedIntensity! });
      const perfect = mtfSections(flat, 81, p.pupilSamples);
      expect(Math.abs(measuredCutoff(perfect) / tracedRho - 1)).toBeLessThan(0.06);

      // …and `cutoffCyclesPerMm` reports the full aperture regardless. It is
      // 2·NA/λ off the exit pupil radius and knows nothing about the trace.
      const nominal = (2 * (D / (2 * focalLengthMm))) / (LAM * 1e-6);
      expect(Math.abs(mtf(p).cutoffCyclesPerMm / nominal - 1)).toBeLessThan(0.01);
    });
  }

  /**
   * The negative control, and it is the same glass form: the SINGLET's 5 mm
   * centre and much flatter crown never close inside D = 100, so it traces its
   * whole pupil at every focal length the achromat loses one at. Without this,
   * the rungs above would pass on a tracer that had simply started dropping rays.
   */
  it("the singlet of the same pair keeps its whole pupil where the achromat loses it", () => {
    for (const focalLengthMm of [2000, 1000, 500]) {
      const sys: OpticalSystem = {
        prescription: refractorPair(focalLengthMm, D, focalLengthMm).singlet,
        aperture: { kind: "EPD", value: D },
        field: { kind: "angle", values: [0] },
        wavelengths: [{ nm: LAM, weight: 1 }],
        conjugate: { kind: "infinite" },
      };
      const map = opdMap(sys, 0, LAM, pupilGrid(41), {});
      expect(map.lost).toBe(0);
      let maxRho = 0;
      for (const s of map.samples) maxRho = Math.max(maxRho, Math.hypot(s.px, s.py));
      expect(maxRho).toBeCloseTo(1, 6);
    }
  });
});

/**
 * Rung: `mtfProfile` refuses a bin count its own array cannot fill.
 *
 * Found by the panel, not by this file: asking for 161 bins across a 64-bin band
 * left annuli with no pixels in them, and an empty bin fell through to
 * `modulation = 0` — which on a plot is indistinguishable from a frequency the
 * lens transmits nothing at. It read 0.51 of modulation BELOW the two sections,
 * i.e. it looked exactly like the finding the panel exists to show, at four
 * times the size. § 6ac's rule applies — an identity a caller can get wrong
 * silently is refused, not documented — and the caller here genuinely cannot
 * notice, because the returned array is the right length and full of numbers.
 */
describe("§ 6ad — the radial profile refuses a bin count it cannot fill", () => {
  const p = psf(paraboloid, 0, LAM, GRID);
  const m = mtf(p);

  it("refuses more bins than there are frequency bins", () => {
    expect(() => mtfProfile(m, p.pupilSamples + 1, p.pupilSamples)).toThrow(/no pixels/);
    expect(() => mtfProfile(m, 161, p.pupilSamples)).toThrow(/at most 64/);
  });

  it("accepts exactly as many as the band has, and fills every one of them", () => {
    const profile = mtfProfile(m, p.pupilSamples, p.pupilSamples);
    // Every bin has to carry a real average: the innermost is the DC pixel alone
    // and the rest have more, so a zero anywhere would be an empty annulus.
    for (let b = 0; b < profile.modulation.length; b++) {
      expect(profile.modulation[b]!, `bin ${b}`).toBeGreaterThan(0);
    }
  });

  it("refuses a bin count that is not a usable integer", () => {
    expect(() => mtfProfile(m, 1, p.pupilSamples)).toThrow(/≥ 2/);
    expect(() => mtfProfile(m, 20.5, p.pupilSamples)).toThrow(/≥ 2/);
  });
});
