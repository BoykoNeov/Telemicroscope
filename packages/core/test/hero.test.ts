import { describe, it, expect } from "vitest";
import { chromaticity } from "../src/photometry/cmf";
import { xyzToLinearRgb } from "../src/photometry/srgb";
import {
  annulusXyz,
  colorImageFromStack,
  integratedXyz,
  radialColorProfile,
} from "../src/imaging/image";
import {
  HeroRender,
  defocusMm,
  heroPair,
  meanRadiusMm,
  renderHero,
} from "./support/heroScene";

/**
 * Step 4's milestone: purple fringing appears for a singlet and shrinks for an
 * achromat BECAUSE THE GLASS DATA SAYS SO.
 *
 * The lenses come from `src/designs/refractor`, computed from the catalog's own
 * Abbe numbers and already pinned by the step-1 rungs in `physics.test.ts`
 * (F−C shift ≈ f/V for the singlet, ≫10× smaller for the doublet, EFL
 * preserved). Nothing here re-states those; this file asks whether the
 * RENDERED IMAGE carries the consequence, which is a different question and
 * has its own ways to be wrong.
 *
 * Both lenses are focused by the same criterion at the same wavelength — a
 * fringing metric on two differently-focused systems measures the focus
 * difference, not the chromatism.
 */

const singlet = renderHero(heroPair().singlet);
const achromat = renderHero(heroPair().achromat);

describe("the rendered blur reproduces the chromatic focal shift", () => {
  it("each wavelength's blur radius = (2/3)·|δz|·NA where defocus dominates", () => {
    // Two closed forms already on the ladder, joined: the paraxial chromatic
    // focal shift (step 1) says WHERE each colour focuses, and the uniform-disc
    // geometric spot (step 2d) says how big the blur is when it does not focus
    // here. A uniform disc of radius R has mean radius (2/3)R, and R = |δz|·NA.
    //
    // Asserted only where the defocus blur clears the diffraction floor by 4×;
    // near focus the Airy pattern sets the size and a geometric prediction is
    // simply the wrong physics there, which is the fidelity switch's whole
    // premise.
    let asserted = 0;
    for (const plane of singlet.stack.planes) {
      const predicted = (2 / 3) * Math.abs(defocusMm(singlet, plane.nm)) * singlet.naImage;
      if (predicted < 4 * singlet.airyRadiusMm) continue;
      const measured = meanRadiusMm(plane.intensity, singlet.stack.size, singlet.stack.pixelScaleMm);
      // 30%: bounded by the singlet's own spherical aberration, which is real
      // and is NOT a defocus. See the asymmetry rung below, which identifies it.
      expect(Math.abs(measured / predicted - 1)).toBeLessThan(0.3);
      asserted++;
    }
    expect(asserted).toBeGreaterThanOrEqual(4);
  });

  it("the residual is spherical aberration: it flips sign with the sign of δz", () => {
    // The rung that says WHAT the 30% is. A wrong pupil→image scale, a wrong NA
    // or a wrong pixel size would bias every wavelength the same way. Residual
    // undercorrected spherical aberration cannot: it adds to the blur on one
    // side of focus and partly cancels it on the other, so the ratio must sit
    // above 1 for δz < 0 and below 1 for δz > 0.
    let inside = 0;
    let outside = 0;
    for (const plane of singlet.stack.planes) {
      const dz = defocusMm(singlet, plane.nm);
      const predicted = (2 / 3) * Math.abs(dz) * singlet.naImage;
      if (predicted < 4 * singlet.airyRadiusMm) continue;
      const ratio =
        meanRadiusMm(plane.intensity, singlet.stack.size, singlet.stack.pixelScaleMm) / predicted;
      if (dz < 0) {
        expect(ratio).toBeGreaterThan(1);
        inside++;
      } else {
        expect(ratio).toBeLessThan(1);
        outside++;
      }
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });
});

describe("the milestone: a singlet fringes and an achromat does not", () => {
  const spread = (r: HeroRender): number => {
    const radii = r.stack.planes.map((p) =>
      meanRadiusMm(p.intensity, r.stack.size, r.stack.pixelScaleMm),
    );
    return Math.max(...radii) - Math.min(...radii);
  };

  it("the singlet's colours land at visibly different sizes; the achromat's do not", () => {
    // The F−C focal shifts differ by 28× (validated at step 1). The blur spread
    // cannot show all of it, because the achromat's shortest wavelength is
    // already close enough to focus that diffraction sets its size — a floor
    // the singlet never reaches. So the visible ratio is compressed, and 5× is
    // asserted rather than 28×.
    const singletSpread = spread(singlet);
    const achromatSpread = spread(achromat);
    expect(singletSpread / achromatSpread).toBeGreaterThan(5);
    // In units a user would recognise: the singlet smears colour over many Airy
    // radii, the achromat over a couple.
    expect(singletSpread / singlet.airyRadiusMm).toBeGreaterThan(8);
    expect(achromatSpread / achromat.airyRadiusMm).toBeLessThan(2);
  });

  it("the singlet's halo is blue and the achromat has no halo to be blue", () => {
    // "Purple fringing", stated as a number. Beyond the radius where the
    // achromat's light has run out, the singlet still has the short wavelengths
    // — they are the most defocused — so that annulus is blue-dominant.
    const outer = (r: HeroRender) => {
      const image = colorImageFromStack(r.stack);
      const inner = 8 * r.airyRadiusMm / r.stack.pixelScaleMm;
      const rgb = xyzToLinearRgb(annulusXyz(image, inner, r.stack.size / 2));
      return rgb.b / rgb.r;
    };
    expect(outer(singlet)).toBeGreaterThan(3);
    expect(outer(achromat)).toBeLessThan(1.5);
  });

  it("the singlet's hue moves toward blue with radius; the achromat's stays put", () => {
    // The strongest form of the claim, because it is about STRUCTURE rather
    // than an average: a single colour over the whole image cannot distinguish
    // "blue halo" from "blue star".
    const hueDrift = (r: HeroRender): number => {
      const profile = radialColorProfile(colorImageFromStack(r.stack), 32);
      const at = (bin: number) =>
        chromaticity({
          x: profile.xyz[bin * 3]!,
          y: profile.xyz[bin * 3 + 1]!,
          z: profile.xyz[bin * 3 + 2]!,
        }).x;
      return at(0) - at(12); // core minus mid-halo; positive means the halo is bluer
    };
    expect(hueDrift(singlet)).toBeGreaterThan(0.1);
    expect(Math.abs(hueDrift(achromat))).toBeLessThan(0.05);
  });

  it("both lenses still render the star's own colour overall", () => {
    // A guard against fixing the fringe by breaking the colour: whatever the
    // aberrations do to WHERE the light lands, the total is the source's
    // spectrum through the same glass, so both must agree on it closely.
    const c = (r: HeroRender) => chromaticity(integratedXyz(colorImageFromStack(r.stack)));
    const a = c(singlet);
    const b = c(achromat);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.01);
    // ...and it is a sun-like white, not an artifact of the pipeline.
    expect(a.x).toBeGreaterThan(0.30);
    expect(a.x).toBeLessThan(0.36);
  });
});

describe("colour has to be integrated per wavelength (negative control)", () => {
  it("tinting the monochrome stack by its mean λ produces NO radial colour", () => {
    // The failure this whole design exists to avoid, made explicit. Collapse
    // the stack to one grayscale image and give it the mean wavelength's
    // colour: every pixel then has identical chromaticity by construction, so
    // the hue drift that IS the milestone reads exactly zero — on the very
    // system that fringes most.
    const stack = singlet.stack;
    const grey = new Float64Array(stack.size * stack.size);
    for (const p of stack.planes) {
      for (let i = 0; i < grey.length; i++) grey[i] = grey[i]! + p.intensity[i]! * p.weight;
    }
    const tintChromaticity = (bin: number, xyz: Float64Array) =>
      chromaticity({ x: xyz[bin * 3]!, y: xyz[bin * 3 + 1]!, z: xyz[bin * 3 + 2]! }).x;

    // A tinted grayscale image: XYZ ∝ grey, so chromaticity is constant.
    const tinted = new Float64Array(grey.length * 3);
    for (let i = 0, o = 0; i < grey.length; i++, o += 3) {
      tinted[o] = grey[i]! * 0.4;
      tinted[o + 1] = grey[i]! * 0.35;
      tinted[o + 2] = grey[i]! * 0.25;
    }
    const tintedProfile = radialColorProfile(
      { width: stack.size, height: stack.size, pixelScaleMm: stack.pixelScaleMm, xyz: tinted },
      32,
    );
    expect(
      Math.abs(tintChromaticity(0, tintedProfile.xyz) - tintChromaticity(12, tintedProfile.xyz)),
    ).toBeLessThan(1e-12);

    // The per-wavelength integration of the SAME rays, in contrast, moves.
    const real = radialColorProfile(colorImageFromStack(stack), 32);
    expect(
      Math.abs(tintChromaticity(0, real.xyz) - tintChromaticity(12, real.xyz)),
    ).toBeGreaterThan(0.1);
  });
});
