import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { psf } from "../src/wave/psf";
import { geometricPsf, adaptivePsf } from "../src/wave/geometric";
import { exitBundle } from "../src/analysis/spot";
import { pupilGrid } from "../src/pupil/aiming";
import { newtonian } from "../src/designs/newtonian";

/**
 * Trace-level (partial) vignetting — a ray clipped at a downstream surface,
 * not by the aperture stop (docs/VALIDATION § 2f).
 *
 * The open item § 2e recorded: the FFT branch modelled the full disc while the
 * geometric branch dropped vignetted rays, and `blendPsf` forced their energies
 * equal — papering over a real disagreement about how much light gets through.
 * The fix carves the vignetting out of the pupil support (one `vignetteMask`
 * predicate, applied to the FFT amplitude and, through `transmittedEnergy`, to
 * the geometric branch), so both branches see one aperture. These rungs pin the
 * mask to a closed form and prove the two branches now agree honestly.
 *
 * ## The pinnable geometry
 *
 * A decentered circular aperture in the COLLIMATED space between the stop and a
 * paraboloidal mirror. On axis, before any power, the beam is parallel to the
 * axis, so a plane aperture clips an *offset circle* of the pupil — the map is
 * the identity, and the open pupil is exactly the intersection of two discs (a
 * vesica) whose area is a textbook closed form. That isolates the new physics
 * (a NON-centered mask) from folding and off-axis tracing, which the Newtonian
 * rung then layers back on as the physical demonstration.
 */

const R_STOP = 10; // stop / entrance-pupil radius, mm
const CLIP_A = 7; // decentered clip aperture radius, mm
const CLIP_DX = 6; // clip decenter along +x, mm
const MIRROR_R = -400; // concave paraboloid, focus at -200 mm

/**
 * Area of the intersection of two discs (radii R, r; centres distance d apart)
 * as a fraction of the first disc's area. The external number.
 * https://mathworld.wolfram.com/Circle-CircleIntersection.html
 */
function twoDiscOverlapFraction(R: number, r: number, d: number): number {
  const a =
    R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R)) +
    r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) -
    0.5 * Math.sqrt((-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r));
  return a / (Math.PI * R * R);
}

/**
 * Stop → decentered clip → paraboloidal mirror. `clipRadius = Infinity` removes
 * the clip, giving the unvignetted reference the fraction is measured against.
 */
function clippedMirror(clipRadius: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      // Plane window that IS the stop: air→air, so it bends nothing and only
      // defines the entrance pupil.
      { kind: "refract", curvature: 0, semiAperture: R_STOP, thickness: 20, medium: "AIR", isStop: true },
      // The decentered clip, standing in the still-collimated beam.
      {
        kind: "refract",
        curvature: 0,
        semiAperture: clipRadius,
        decenterX: CLIP_DX,
        thickness: 20,
        medium: "AIR",
      },
      // Perfect on-axis focusing element: a paraboloid images the axial point
      // with zero aberration, so the transmitted energy is all that is in play.
      { kind: "reflect", curvature: 1 / MIRROR_R, conic: -1, semiAperture: 30, thickness: MIRROR_R / 2 },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: R_STOP },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** Fraction of a dense pupil-grid bundle that survives to the image. */
function raySurvivorFraction(clip: OpticalSystem, full: OpticalSystem, grid: number): number {
  const pts = pupilGrid(grid);
  const clipped = exitBundle(clip, 0, LINE_D, pts);
  const open = exitBundle(full, 0, LINE_D, pts);
  return clipped.rays.length / open.rays.length;
}

describe("trace-level (partial) vignetting", () => {
  const EXACT = twoDiscOverlapFraction(R_STOP, CLIP_A, CLIP_DX);

  it("the test geometry is a genuine vesica, not a stopped-down disc", () => {
    // Partial overlap: the clip is neither disjoint from nor contained in the
    // stop, so the open pupil is a true two-circle lens (~38%).
    expect(EXACT).toBeGreaterThan(0.3);
    expect(EXACT).toBeLessThan(0.45);
    // The clip circle pokes outside the stop (else it would be a plain disc).
    expect(CLIP_DX + CLIP_A).toBeGreaterThan(R_STOP);
  });

  it("FFT transmitted energy shrinks to the vesica area (closed form)", () => {
    const clip = clippedMirror(CLIP_A);
    const full = clippedMirror(Infinity);
    // Two resolutions: the area is a discretization of a curved boundary, so it
    // converges as the pupil grid refines — a fixed number that did not move
    // would be arriving by cancellation, not resolution (§ 2b lesson).
    const f128 = psf(clip, 0, LINE_D, { pupilSamples: 128 }).energy / psf(full, 0, LINE_D, { pupilSamples: 128 }).energy;
    const f256 = psf(clip, 0, LINE_D, { pupilSamples: 256 }).energy / psf(full, 0, LINE_D, { pupilSamples: 256 }).energy;
    // Measured 7.1e-5 and 1.6e-5 against the closed form. The tolerances are
    // set just above what the grid actually delivers, not at a round number
    // that would pass whatever the mask did.
    expect(Math.abs(f128 - EXACT)).toBeLessThan(2e-4);
    expect(Math.abs(f256 - EXACT)).toBeLessThan(5e-5);
    // And it is resolved, not arrived at by cancellation: refining the pupil
    // grid moves the answer TOWARD the closed form (4× here).
    expect(Math.abs(f256 - EXACT)).toBeLessThan(Math.abs(f128 - EXACT));
  });

  it("geometric ray-survivor fraction hits the SAME closed form", () => {
    // An independent measurement: this counts rays that physically clear the
    // clip, with no FFT and no pupil mask in its history. That it lands on the
    // same number as the FFT area is the matched-normalization discharge — the
    // two branches agree on throughput by measuring it, not by construction.
    const f = raySurvivorFraction(clippedMirror(CLIP_A), clippedMirror(Infinity), 257);
    // Measured within 5e-4; a lattice count of a curved region converges more
    // raggedly than the area-averaged FFT edge, which is why this rung's band
    // is wider than that one's rather than both being set to a common round
    // number.
    expect(Math.abs(f - EXACT)).toBeLessThan(1e-3);
  });

  it("both branches normalize to the vignetted energy, not the full disc", () => {
    // HONESTY NOTE: the two branches share one `transmittedEnergy` call, so
    // their equality here is by construction and proves nothing on its own —
    // it is the two rungs above, which measure the SAME fraction by two
    // independent routes (pupil area vs surviving rays), that make the shared
    // number trustworthy. What this rung adds is the magnitude of what was
    // being papered over: before the mask, `energy` was the FULL-disc energy
    // while the geometric branch binned only survivors, so the histogram was
    // rescaled up by 1/fraction — a 2.61× over-brightening of a vignetted
    // field point.
    const clip = clippedMirror(CLIP_A);
    const opts = { pupilSamples: 128 } as const;
    const diff = psf(clip, 0, LINE_D, opts);
    const geo = geometricPsf(clip, 0, LINE_D, opts);
    expect(geo.energy).toBeCloseTo(diff.energy, 6);

    const full = psf(clippedMirror(Infinity), 0, LINE_D, opts);
    expect(Math.abs(diff.energy / full.energy - EXACT)).toBeLessThan(2e-4);
    // The pre-fix normalization would have been this much too bright.
    expect(full.energy / diff.energy).toBeCloseTo(1 / EXACT, 2);
  });

  it("adaptivePsf — the blend § 2e named — carries the vignetted energy", () => {
    // § 2e's concern was phrased about `blendPsf` specifically, so it is pinned
    // where it was raised rather than only argued from the two branches now
    // being equal. Whatever branch (or convex mix) the fidelity switch lands
    // on, the image integrates to the vignetted energy — not the full disc.
    const clip = clippedMirror(CLIP_A);
    const opts = { pupilSamples: 128 } as const;
    const a = adaptivePsf(clip, 0, LINE_D, opts);
    let sum = 0;
    for (let i = 0; i < a.intensity.length; i++) sum += a.intensity[i]!;
    expect(sum / psf(clippedMirror(Infinity), 0, LINE_D, opts).energy).toBeCloseTo(EXACT, 3);
  });

  it("the mask is off-centre: the surviving pupil centroid is displaced", () => {
    // A concentric stop-down would leave the centroid at the origin. This mask
    // keeps only the +x lens of the vesica, so the survivors' mean px is > 0 —
    // the non-symmetric capability the earlier code could not represent.
    const b = exitBundle(clippedMirror(CLIP_A), 0, LINE_D, pupilGrid(201));
    let sx = 0;
    for (const r of b.rays) sx += r.px;
    const meanPx = sx / b.rays.length;
    expect(meanPx).toBeGreaterThan(0.2);
  });
});

describe("off-axis Newtonian: the diagonal vignettes the field edge", () => {
  // The named real-world case (roadmap step 5). A minimum diagonal is sized to
  // the on-axis beam, so any off-axis field loses light at the diagonal's rim.
  // This folds together the fold, the off-axis trace and vignetting; the pin is
  // the mechanism (light falls off with field) and the two branches agreeing on
  // how much, not a closed-form area.
  const scope = newtonian({ apertureMm: 120, focalRatio: 5 });
  function newtSystem(fieldDeg: number): OpticalSystem {
    return {
      prescription: scope.prescription,
      aperture: { kind: "stopRadius", value: 60 },
      field: { kind: "angle", values: [fieldDeg] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
  }

  function transmittedFraction(fieldDeg: number, grid: number): number {
    const pts = pupilGrid(grid);
    const off = exitBundle(newtSystem(fieldDeg), fieldDeg, LINE_D, pts);
    const on = exitBundle(newtSystem(0), 0, LINE_D, pts);
    return off.rays.length / on.rays.length;
  }

  it("on axis the minimum diagonal loses no rays at all", () => {
    // Asserted on `lost` DIRECTLY, not as a transmitted-fraction of 1: that
    // ratio divides the on-axis bundle by itself and is 1 by construction
    // whatever the diagonal does. This is the form that can actually fail —
    // undersize the diagonal and it counts the clipped rays — so it is a real
    // cross-check of § 4b's closed-form sizing, which is derived to be exactly
    // tangent to the on-axis cone.
    for (const grid of [151, 201]) {
      const b = exitBundle(newtSystem(0), 0, LINE_D, pupilGrid(grid));
      expect(b.lost).toBe(0);
      expect(b.rays.length).toBe(pupilGrid(grid).length);
    }
  });

  it("throughput falls monotonically as the field angle grows", () => {
    // Denominator is the on-axis bundle, which the rung above proves is the
    // whole pupil — so these are true transmitted fractions, not ratios of two
    // equally-clipped counts.
    const f1 = transmittedFraction(0.3, 151);
    const f2 = transmittedFraction(0.6, 151);
    // Measured 0.9958 at 0.3° and 0.9530 at 0.6°: the field edge is clipped,
    // and progressively.
    expect(f1).toBeLessThan(1);
    expect(f2).toBeLessThan(f1);
    expect(f2).toBeLessThan(0.98);
  });

  it("the FFT amplitude mask agrees with the ray-survivor fraction", () => {
    const fieldDeg = 0.5;
    const rayFrac =
      exitBundle(newtSystem(fieldDeg), fieldDeg, LINE_D, pupilGrid(201)).rays.length /
      exitBundle(newtSystem(0), 0, LINE_D, pupilGrid(201)).rays.length;
    const fftFrac =
      psf(newtSystem(fieldDeg), fieldDeg, LINE_D, { pupilSamples: 128 }).energy /
      psf(newtSystem(0), 0, LINE_D, { pupilSamples: 128 }).energy;
    // The obstruction is common to both fields and cancels in the ratio, so this
    // isolates the diagonal's vignetting. Two discretizations of one boundary,
    // measured 1.2e-4 apart — the real content of the rung, and far tighter
    // than the ~2% of light at stake, so it would catch a mask that clipped a
    // different region than the trace does.
    expect(Math.abs(fftFrac - rayFrac)).toBeLessThan(1e-3);
    expect(fftFrac).toBeLessThan(0.99);
  });
});
