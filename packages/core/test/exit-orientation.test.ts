import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { pupils, imagePlaneZ } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { aimOrientation, exitApertureSine, opdMap } from "../src/pupil/opd";
import { exitBundle } from "../src/analysis/spot";
import { asCompiled } from "../src/trace/compile";
import { laidPupil, psf, type PupilLayout } from "../src/wave/psf";
import { pupilDirectionMap } from "../src/imaging/object-field";

/**
 * § 2o — the exit layout's orientation is the geometry's, not the aim's.
 *
 * Found while flipping fluorescence (register item 24): on the DIN presets, which
 * are telecentric in object space, the transform's PSF centroid sat on the wrong
 * side of the rays' at 550 and 583 nm, on BOTH layouts, at every pupil grid and
 * inside a fixed window — so not the estimator. The traced map itself had its odd
 * terms reversed there and nowhere else. The cause is the aim: chromatically the
 * entrance pupil of an object-space telecentric objective passes through infinity
 * (§ 6az: twice on the DIN 4×), and between the two crossings it lies BEYOND
 * infinity — a paraxial aim at a point on it sends px = +1 out the other side.
 * The rays are the same rays; only their labels are mirrored.
 *
 * The aim layout lays a sample where it was aimed, so in that band its pupil is
 * the true one reflected — register item 30, left open by the user's choice. The
 * exit layout lays a sample where it went, which is right — but it normalized by
 * the aim rim ray's SIGNED sine, and so copied the mirror back in. § 2o signs the
 * sine by the beam's convergence instead (`exitApertureSine`), reports the aim's
 * own orientation (`aimOrientation`), and has `pupilDirectionMap` multiply by it so
 * a condenser direction lands on the side its ray reaches.
 *
 * External pin: the centroid theorem — an incoherent PSF's centroid is the
 * irradiance-weighted mean of the rays' transverse intercepts — the first moment of
 * |FT P|² is the |P|²-weighted mean wavefront slope (Mahajan, *Optical Imaging
 * and Aberrations* I). Exact sums over the rays, no histogram.
 */

const telecentric = (magnification: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification, numericalAperture: 0.1 }),
  }).system;
const rimStop = (): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement: "rim" }),
  }).system;

/** The design wavelength, where the presets are telecentric and the aim is by slope. */
const LAMBDA_D = 587.5618;

/** Centroid along x of a PSF over its whole grid, in µm from the chief ray's image point. */
const psfCentroidUm = (system: OpticalSystem, h: number, nm: number, layout: PupilLayout): number => {
  const p = psf(system, h, nm, { layout, pupilSamples: 64, padFactor: 4 });
  const n = p.size;
  const c = n / 2;
  let sx = 0;
  let sw = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const w = p.intensity[y * n + x]!;
      sx += w * (x - c);
      sw += w;
    }
  }
  return (sx / sw) * p.pixelScaleMm * 1e3;
};

/** The rays' mean intercept along x, weighted by the exit layout's own source power (§ 2j), in µm. */
const rayCentroidUm = (system: OpticalSystem, h: number, nm: number): number => {
  const map = opdMap(system, h, nm, pupilGrid(21));
  const density = laidPupil(system, map, { layout: "exit" }).density!;
  const planeZ = imagePlaneZ(asCompiled(system.prescription), system);
  let sx = 0;
  let sw = 0;
  for (const r of exitBundle(system, h, nm, pupilGrid(151)).rays) {
    const t = (planeZ - r.ray.origin.z) / r.ray.dir.z;
    const w = r.throughput * density.sourceWeight(r.px, r.py, r.launchDir);
    sx += w * (r.ray.origin.x + r.ray.dir.x * t - map.imagePoint.x);
    sw += w;
  }
  return (sx / sw) * 1e3;
};

describe("§ 2o — the exit layout's orientation is the geometry's, not the aim's", () => {
  it("§ 2o.1 — the aim mirrors exactly where the entrance pupil lies beyond infinity", () => {
    // A statement about the paraxial pupil, read off `pupils` and nothing the
    // exit layout computes: between the two crossings the entrance pupil's z is
    // negative and finite, and there — and only there — the aim rim ray leaves on
    // the side opposite its label. At the design wavelength the pupil is at
    // infinity, the aim is by slope, and nothing is mirrored.
    const sweep = [430, 480, 520, 528, 532, 540, 550, 570, 586, 587, LAMBDA_D, 588, 600, 650, 680];
    for (const make of [() => telecentric(4), () => telecentric(10)]) {
      const system = make();
      let mirrored = 0;
      for (const nm of sweep) {
        const z = pupils(system, nm).entrance.z;
        const expected = Number.isFinite(z) && z < 0 ? -1 : 1;
        expect(aimOrientation(system, nm), `${nm} nm, entrance pupil at ${z}`).toBe(expected);
        if (expected === -1) mirrored++;
      }
      // The band is real on both presets, not an empty claim: from 531 nm on the
      // 4× and 528 nm on the 10×, up to 587 nm on both — six and seven of the
      // sweep's fifteen wavelengths.
      expect(mirrored).toBeGreaterThanOrEqual(6);
      // And the aperture sine is the rim's magnitude, signed by the converging beam.
      for (const nm of sweep) expect(exitApertureSine(system, nm)).toBeGreaterThan(0);
    }
    // The rim stop is not telecentric: its pupil is the stop, and nothing is mirrored.
    const rim = rimStop();
    for (const nm of sweep) expect(aimOrientation(rim, nm), `${nm} nm`).toBe(1);
  });

  it("§ 2o.2 — the exit layout's centroid is the rays', inside the band and out of it", () => {
    // Object height 0.2 mm: 0.8 mm of image on the DIN 4×, where § 6ba.9's lateral
    // colour is read. The rays run −1.4 to −2.4 µm; the transform's full-grid
    // centroid sits a common 0.014–0.034 µm beyond them at pupil samples 64, the
    // periodic grid's own first moment, and the aim layout's flip moved it 3.3 µm.
    const system = telecentric(4);
    const h = 0.2;
    for (const nm of [530, 550, 583.333, 600, 633.333]) {
      const rays = rayCentroidUm(system, h, nm);
      const transform = psfCentroidUm(system, h, nm, "exit");
      expect(rays, `${nm}`).toBeLessThan(-1.3);
      expect(Math.abs(transform - rays), `${nm}: transform ${transform}, rays ${rays}`).toBeLessThan(0.035);
    }
    // NEGATIVE CONTROL: the aim layout, which lays the mirrored labels where they
    // were aimed. Inside the band its centroid is on the far side of the rays'.
    for (const nm of [550, 583.333]) {
      const rays = rayCentroidUm(system, h, nm);
      const aim = psfCentroidUm(system, h, nm, "aim");
      expect(aim, `${nm}`).toBeGreaterThan(1.3);
      expect(Math.sign(aim)).toBe(-Math.sign(rays));
    }
    // ...and outside it the two layouts agree on the side.
    expect(psfCentroidUm(system, h, 633.333, "aim")).toBeLessThan(-1.3);
  });

  it("§ 2o.3 — nothing jumps where the entrance pupil crosses infinity", () => {
    // The optics are continuous in wavelength, so a centroid read across the
    // crossing at the design wavelength must be too. Three points 1 nm apart
    // straddling it lie on a line to the curvature of the lateral colour; on the
    // aim layout the middle one is 1.94 µm off it, because 586.5 is labelled
    // mirrored and 587.5618 and 588.5 are not — a 4.1 µm jump between 1 nm
    // neighbours. The exit layout reads 9.5e-4 µm, the lateral colour curve's
    // own bend over the 2 nm.
    const system = telecentric(4);
    const h = 0.2;
    const offLine = (layout: PupilLayout): number => {
      const [a, b, c] = [586.5, LAMBDA_D, 588.5].map((nm) => psfCentroidUm(system, h, nm, layout));
      const t = (LAMBDA_D - 586.5) / (588.5 - 586.5);
      return b! - (a! + t * (c! - a!));
    };
    expect(Math.abs(offLine("exit"))).toBeLessThan(2e-3);
    expect(Math.abs(offLine("aim"))).toBeGreaterThan(1.5);
  });

  it("§ 2o.4 — a condenser direction lands on the side its ray reaches", () => {
    // `pupilDirectionMap` places an object-space direction in the exit layout's
    // canonical coordinate. Signed by the aim alone it mirrored with the aim, so
    // in the band the direction of the ray aimed at (1, 0) — which leaves through
    // the exit coordinate −1 — was placed at +1. Now the direction placed at a
    // ray's own exit coordinate is that ray's direction, to the 4×'s sine-condition
    // residual (−2.0e-3 at 550 nm, −3.1e-3 at 650), in the band and out of it.
    const system = telecentric(4);
    for (const nm of [550, 650]) {
      const map = opdMap(system, 0, nm, [{ px: 1, py: 0 }]);
      const e = map.samples[0]!.exitX / exitApertureSine(system, nm);
      expect(Math.abs(Math.abs(e) - 1)).toBeLessThan(1e-12);
      expect(Math.sign(e)).toBe(aimOrientation(system, nm));
      const pupil = pupils(system, nm);
      const launched = aimRay(system, pupil, 0, { px: 1, py: 0 }, nm, {}).dir;
      const slope = launched.x / launched.z;
      const placed = pupilDirectionMap(system, 0, nm, { layout: "exit" }).slopesOf(e, 0)!;
      expect(Math.sign(placed[0]), `${nm}`).toBe(Math.sign(slope));
      expect(Math.abs(placed[0] / slope - 1), `${nm}`).toBeLessThan(1e-2);
    }
  });
});
