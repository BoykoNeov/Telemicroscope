import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { pupils } from "../src/pupil/pupils";
import { LINE_D } from "../src/materials/dispersion";
import { N_BK7 } from "../src/materials/catalog";
import { psf, radialProfile, encircledEnergy, Psf } from "../src/wave/psf";
import { bestFocus, paraxialImageOffset } from "../src/analysis/focus";
import { exitBundle, spotAt } from "../src/analysis/spot";
import { imageSpaceMarginalSin } from "../src/imaging/exposure";

/**
 * § 2g — the image formed in a medium: the Cartesian ellipsoid.
 *
 * Every system on the ladder before this one forms its image in air. The oil
 * objective (§ 6e) has its oil in OBJECT space, where it enters through the NA
 * and is carried, while the tube lens forms the image in air; so the one place
 * the image-space index enters the wave layer — `imagePixelScaleMm` divides by
 * `nImage`, read off the exit pupil — had never been exercised by a system
 * whose `nImage` was not 1. ROADMAP recorded that as "unpinned only because no
 * system in the ladder has one". This is that system.
 *
 * ## The fixture is a closed form, and it is exact to all orders
 *
 * A single refracting surface between air and a medium of index n images a
 * collimated beam to a perfect point when the surface is the Cartesian oval
 * for that conjugate — which for an object at infinity is an ELLIPSOID of
 * eccentricity e = 1/n (Descartes, 1637). In the engine's conic convention that
 * is
 *
 *     k = −e² = −1/n²
 *
 * and the stigmatic point is the ellipse's far focus, a·(1 + e) from the
 * vertex. With vertex radius R = b²/a = a·(1 − e²) that distance is
 * R/(1 − e) = n·R/(n − 1): exactly the paraxial image distance of the surface,
 * so the paraxial focus and the exact focus coincide at every aperture. Nothing
 * here is third order — a ray at any height inside the ellipse's semi-minor
 * axis reaches the same point, by the defining property of the ellipse under
 * Fermat's principle. That makes this the same class of pin as § 6c's plate:
 * Snell's law and a conic section, no truncation, no reference design.
 *
 * ## What the wave layer must then produce
 *
 * Inside the glass the wavelength is λ/n, so the Airy pattern at the focus has
 * its first dark ring at 0.61·λ/(n·sin u′) — the same 1.22·λ/(2·NA) as § 2b,
 * with the image-space NA now carrying the index. The engine forms that ring
 * through `pixelScaleMm`, which is the one place `nImage` acts; the negative
 * control is the ring the AIR formula predicts, which is n times too large.
 *
 * The aperture for the PSF rungs is NA 0.1 in the glass, for § 2b's reason:
 * the pupil→image scale identifies NA with n·r/R, a paraxial identification,
 * and the rungs are made where the neglected term is bounded. The stigmatic
 * rungs run much faster than that, because the closed form has no such limit.
 */

const N = N_BK7.n(LINE_D);
/** Vertex radius of curvature (mm). Positive: centre of curvature at +z. */
const R = 20;
/** The Cartesian ellipsoid for a collimated beam entering index N. */
const CARTESIAN_CONIC = -1 / (N * N);
/** Where the ellipse's far focus is: n·R/(n − 1) from the vertex. */
const FOCUS_MM = (N * R) / (N - 1);
/** The ellipse's semi-minor axis, which bounds the heights the surface has. */
const SEMI_MINOR_MM = (R / (1 - 1 / (N * N))) * Math.sqrt(1 - 1 / (N * N));

function immersedSystem(semiAperture: number, conic = CARTESIAN_CONIC): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 1 / R,
        conic,
        semiAperture,
        thickness: FOCUS_MM,
        medium: "N-BK7",
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: semiAperture },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** Semi-aperture that gives a paraxial image-space NA of `na` IN THE GLASS:
 *  NA′ = n·h/f′ with f′ = n·R/(n − 1), so h = NA′·R/(n − 1). */
const heightForGlassNa = (na: number): number => (na * R) / (N - 1);

/** § 2b's fast aperture is NA 0.1; the stigmatic rungs go to 0.45. */
const FAST_NA = 0.45;
const PSF_NA = 0.1;

/** First dark ring of the radial profile, to sub-pixel by parabolic fit —
 *  § 2b's helper, unchanged. */
function firstMinimumPixels(p: Psf): number {
  const { radius, mean } = radialProfile(p, p.size / 2);
  let peak = 0;
  for (const v of mean) if (v > peak) peak = v;
  for (let i = 1; i < mean.length - 1; i++) {
    if (mean[i]! < peak * 0.02 && mean[i]! < mean[i - 1]! && mean[i]! <= mean[i + 1]!) {
      const a = mean[i - 1]!;
      const b = mean[i]!;
      const c = mean[i + 1]!;
      const denom = a - 2 * b + c;
      const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const step = radius[1]! - radius[0]!;
      return radius[i]! + shift * step;
    }
  }
  throw new Error("no dark ring found in the radial profile");
}

describe("§ 2g.1 — the far focus of the ellipse is the paraxial image, n·R/(n − 1)", () => {
  it("the paraxial image distance is the Gaussian single-surface formula", () => {
    // n′/s′ = (n′ − n)/R with the object at infinity: s′ = n′·R/(n′ − 1).
    // The engine walks the paraxial chain; the number is Descartes'.
    const s = immersedSystem(heightForGlassNa(PSF_NA));
    expect(paraxialImageOffset(s, LINE_D)).toBeCloseTo(FOCUS_MM, 9);
    // And the exit pupil — the stop itself, nothing follows it — sits in the
    // glass, which is the fact the whole step is about.
    const p = pupils(s, LINE_D);
    expect(p.exit.n).toBeCloseTo(N, 12);
    expect(p.exit.n).toBeGreaterThan(1.5);
  });
});

describe("§ 2g.2 — the ellipsoid of eccentricity 1/n is stigmatic at every aperture", () => {
  const fast = immersedSystem(heightForGlassNa(FAST_NA));

  it("the aperture is real: NA 0.45 in the glass, within the ellipse's semi-minor axis", () => {
    const h = heightForGlassNa(FAST_NA);
    expect(h).toBeLessThan(SEMI_MINOR_MM);
    // The traced marginal ray, read in the glass: n·sin u′ is above 0.4, so
    // this is not a paraxial fixture wearing a fast label.
    const sinU = imageSpaceMarginalSin(fast, LINE_D);
    expect(N * sinU).toBeGreaterThan(0.4);
    expect(N * sinU).toBeLessThan(0.5);
  });

  it("the traced OPD across the pupil is at the tracer's own Newton floor", () => {
    // 1e-12 mm of surface-intersection tolerance is 1.7e-6 waves at the d
    // line; the RMS over 21×21 rays lands below 1e-7 waves. Stated at 1e-5 so
    // the bound is about the closed form and not about how many rays happen to
    // hit the tolerance's edge; a third-order design at this aperture is ten
    // orders of magnitude away from it (see the negative control).
    const map = opdMap(fast, 0, LINE_D, pupilGrid(21));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeLessThan(1e-5);
    let pv = 0;
    for (const s of map.samples) pv = Math.max(pv, Math.abs(s.waves));
    expect(pv).toBeLessThan(1e-4);
  });

  it("every ray passes through the far focus: the spot at n·R/(n − 1) has no size", () => {
    // The image plane is the last vertex plus the prescription's own
    // thickness, which is the far focus by construction; the single surface's
    // vertex is at z = 0.
    const bundle = exitBundle(fast, 0, LINE_D, pupilGrid(21));
    expect(bundle.lost).toBe(0);
    const spot = spotAt(bundle, FOCUS_MM);
    expect(spot.rmsRadius).toBeLessThan(1e-9);
  });

  it("NEGATIVE CONTROL: the sphere of the same vertex radius is aberrated by waves", () => {
    const sphere = immersedSystem(heightForGlassNa(FAST_NA), 0);
    const map = opdMap(sphere, 0, LINE_D, pupilGrid(21));
    expect(map.lost).toBe(0);
    expect(map.rmsWaves).toBeGreaterThan(1);
  });

  it("the wavefront focus solve lands on the paraxial focus: there is no spherical shift to balance", () => {
    // A best focus that differs from the paraxial one is the signature of
    // spherical aberration (§ 1.6's 4/3 and 2 ratios). Here the two coincide,
    // which is the ellipse's far focus stated as a minimum rather than a root.
    const focus = bestFocus(fast, "minRmsWavefront", { wavelengthNm: LINE_D });
    expect(Math.abs(focus.shiftFromParaxial)).toBeLessThan(1e-6);
  });
});

describe("§ 2g.3 — the Airy pattern inside the glass is 1/n the size the air formula says", () => {
  const slow = immersedSystem(heightForGlassNa(PSF_NA));
  /** Radius of the c-th Airy ring in image-plane mm, with the INDEX in the NA:
   *  c·λ/(2·n·sin u′), the paraxial n·sin u′ being the NA the fixture was
   *  sized to. */
  const ringMmInGlass = (c: number): number => (c * LINE_D * 1e-6) / (2 * PSF_NA);

  it("83.8% of the energy converges inside the first dark ring at 1.22·λ/(2·n·sin u′)", () => {
    // § 2b's primary Airy pin, on a pupil in glass: the ring radius comes from
    // the closed form WITH n and is converted to pixels through pixelScaleMm,
    // so a scale that forgot the index moves the answer by 1.5× and fails.
    const enclosedAt = (pupilSamples: number): number => {
      const p = psf(slow, 0, LINE_D, { pupilSamples, padFactor: 4 });
      return encircledEnergy(p, ringMmInGlass(1.22) / p.pixelScaleMm);
    };
    const coarse = enclosedAt(64);
    const mid = enclosedAt(128);
    const fine = enclosedAt(256);
    expect(coarse).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(fine);
    expect(Math.abs(2 * fine - mid - 0.838)).toBeLessThan(0.002);
  });

  it("the first dark ring approaches 1.22·λ/(2·n·sin u′) as image sampling refines", () => {
    const expectedMm = ringMmInGlass(1.22);
    const errorAt = (padFactor: number): number => {
      const p = psf(slow, 0, LINE_D, { pupilSamples: 64, padFactor });
      return (firstMinimumPixels(p) * p.pixelScaleMm) / expectedMm - 1;
    };
    const coarse = errorAt(4);
    const fine = errorAt(16);
    expect(Math.abs(fine)).toBeLessThan(0.015);
    expect(Math.abs(fine)).toBeLessThan(Math.abs(coarse) / 3);
  });

  it("NEGATIVE CONTROL: the ring the AIR formula predicts is n times too large", () => {
    // The whole content of the step in one ratio. sin u′ is read off the traced
    // marginal ray — so this is the measured ring against 0.61·λ/sin u′ with
    // the index left out, and the miss must be the index itself.
    const p = psf(slow, 0, LINE_D, { pupilSamples: 64, padFactor: 16 });
    const measuredMm = firstMinimumPixels(p) * p.pixelScaleMm;
    const sinU = imageSpaceMarginalSin(slow, LINE_D);
    const airMm = (1.22 * LINE_D * 1e-6) / (2 * sinU);
    expect(airMm / measuredMm).toBeGreaterThan(N * 0.985);
    expect(airMm / measuredMm).toBeLessThan(N * 1.015);
  });
});
