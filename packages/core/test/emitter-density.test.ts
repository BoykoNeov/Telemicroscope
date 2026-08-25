import { describe, it, expect } from "vitest";
import {
  objectFieldTile,
  objectHeightForImageRadius,
  tracedFieldPupils,
  type ObjectFieldFrame,
} from "../src/imaging/object-field";
import { buildRadialMap, radialMapCovering } from "../src/imaging/radial-map";
import {
  discEmitter,
  gaussianEmitter,
  rasterizeEmitterDensity,
} from "../src/imaging/emitter-density";
import { rasterizeEmitters, renderFluorescence } from "../src/imaging/fluorescence";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6as — the extended fluorescent specimen, and the Jacobian it needs.
 *
 * § 6i imaged beads. A **point** emitter is placed through its own traced chief
 * ray, so there is no density to transform and no Jacobian to get wrong — which
 * is exactly why beads were the branch's first specimen. § 6n then built the
 * warped-grid rasterizer and was careful to say that it carries no Jacobian
 * *either*, because an amplitude transmittance is a property of a point. Between
 * the two, one case was named and left open: an **extended** fluorescent
 * specimen is an emitter density, and warping a density without det J moves flux
 * between pixels. This step closes it.
 *
 * **No optics are added.** Every ray was traced by § 6s; what is new is that the
 * map is differentiated rather than only evaluated. So the rungs are about the
 * derivative and about energy, and the two external numbers are:
 *
 * - **1/M² on the axis.** Both factors of the area element go to the same limit
 *   there, so the product is (dh/dr)² exactly, and on a system that images at M
 *   that is 1/M² — the objective's nameplate, not a number this engine chose.
 *   § 5v pinned its own axis limit at 1/f² by the identical argument.
 * - **the error function**, which is what a Gaussian density truncated by a
 *   square frame loses: `1 − erf(√2·a/w)²` exactly, over four decades (§ 6as.4).
 *
 * and the one **bracket** is the Gauss circle problem: a hard-edged disc
 * point-sampled on a lattice miscounts its own area by the lattice-point
 * discrepancy, whose exponent has been open since Gauss. Sierpiński's 1906
 * bound gives a relative error falling as R^(−4/3); the conjectured average
 * behaviour would give R^(−3/2). § 6as.4 measures −1.3415 and reports it as
 * sitting *inside that bracket* rather than as a law of its own — § 6ao.9's
 * discipline, where a collapse radius bracketed a cutoff instead of measuring
 * it.
 *
 * **§ 5v.5 met the same lattice count and refused to claim any rate**, because
 * the residual it saw changed *sign* between disc sizes and "a sequence like
 * this does not have one". That refusal was right for a single placement, which
 * measures the lattice accident rather than the law. The rung below averages
 * |residual| over sixteen sub-pixel offsets, which is what turns the accident
 * into a law with an exponent to bracket. § 5v.5 stands; this is a different
 * measurement, not a correction of it.
 *
 * **What is deliberately NOT claimed:** no photometric zero point (§ 3a's
 * deferral, so every number here is a ratio), and no spectral emitter density —
 * `rasterizeEmitters` has no spectrum either, and the emission band lives in
 * `imaging/emission` where it serves both.
 */

const LAMBDA = 587.5618;

/** § 6n's, § 6o's and § 6s's own probe: the DIN 4×/0.10. */
const SYSTEM: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
}).system;

/** The nameplate magnification — the number from outside the engine. */
const NAMEPLATE = 4;

/**
 * Nodes for every map here. § 6s's own floor argument, re-measured for the
 * DERIVATIVE rather than for the height: the table's dh/dr stops improving at
 * ~3e-12 relative by 128 nodes and 512 buys nothing, because what it reaches
 * there is the traced chief ray's own rounding and not the interpolant's.
 */
const NODES = 128;

const tileAt = (x: number, y: number, size = 128): ObjectFieldFrame =>
  objectFieldTile(SYSTEM, { size, pupilSamples: 32, wavelengthNm: LAMBDA, centreMm: { x, y } });

const total = (values: Float64Array): number => {
  let s = 0;
  for (const v of values) s += v;
  return s;
};

const centroid = (values: Float64Array, n: number): { flux: number; x: number; y: number } => {
  let flux = 0;
  let sx = 0;
  let sy = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const v = values[iy * n + ix]!;
      flux += v;
      sx += v * ix;
      sy += v * iy;
    }
  }
  return { flux, x: sx / flux, y: sy / flux };
};

/**
 * `erfc` to f64, so § 6as.4's closed form is the error function and not a fit.
 *
 * Series below 3, continued fraction above — the split is where each is the
 * accurate one, and the rung reads the two against the rasterizer over four
 * decades of truncation, which no single approximation formula would survive.
 */
function erfc(x: number): number {
  if (x < 3) {
    let s = x;
    let t = x;
    let n = 0;
    while (Math.abs(t) > 1e-18 * Math.abs(s)) {
      n++;
      t *= (-x * x) / n;
      s += t / (2 * n + 1);
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * s;
  }
  let f = 0;
  for (let k = 60; k >= 1; k--) f = k / 2 / (x + f);
  return Math.exp(-x * x) / ((x + f) * Math.sqrt(Math.PI));
}

/** Least-squares slope of log y against log x — the exponent, not a ratio. */
const logSlope = (xs: readonly number[], ys: readonly number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return num / den;
};

describe("§ 6as — the extended fluorescent specimen", () => {
  it("§ 6as.1 — the area element on the axis is 1/M², the objective's nameplate", () => {
    const map = buildRadialMap(SYSTEM, { maxRadiusMm: 2, nodes: NODES, wavelengthNm: LAMBDA });

    // Both factors go to the same limit on the axis, so the product is (dh/dr)².
    const radial = map.heightSlopeAt(0);
    expect(Math.abs(radial * NAMEPLATE - 1)).toBeLessThan(1e-13);

    const axis = map.objectAreaPerImageArea(0);
    expect(Math.abs(axis * NAMEPLATE * NAMEPLATE - 1)).toBeLessThan(1e-12);

    // And it is the LIMIT of the real map, not a special case bolted on. The
    // approach is **quadratic in r** — ×100 per decade, to four digits over four
    // decades — because what separates a nearby radius from the axis is E·h²
    // and nothing else. A clamp would show a step here; an interpolation
    // artefact would not scale as r². The table agrees with the bisected truth
    // to 6e-15 at every one of these radii, so this is the optics.
    const departure = (r: number): number => Math.abs(map.objectAreaPerImageArea(r) / axis - 1);
    for (const r of [1e-5, 1e-4, 1e-3]) {
      expect(departure(r * 10) / departure(r)).toBeGreaterThan(99);
      expect(departure(r * 10) / departure(r)).toBeLessThan(101);
    }
    // Far enough in, the limit is reached in f64 rather than merely approached.
    expect(departure(1e-8)).toBeLessThan(1e-15);
  });

  it("§ 6as.2 — the tangential and radial factors depart in the ratio 3, nothing fitted", () => {
    const map = buildRadialMap(SYSTEM, { maxRadiusMm: 2, nodes: NODES, wavelengthNm: LAMBDA });
    const axis = map.heightSlopeAt(0);

    // Third-order distortion is r = M·h·(1 + E·h²). The tangential factor h/r
    // then departs from its axis value by −E·h² and the radial factor dh/dr by
    // −3E·h², so the ratio of the departures is 3 with NO fitted coefficient —
    // E never appears. This is § 6m.4's ratio-3, carried onto the area element.
    const ratios: number[] = [];
    for (const r of [0.125, 0.25, 0.5, 1.0, 2.0]) {
      const tangential = map.heightAt(r) / r / axis - 1;
      const radial = map.heightSlopeAt(r) / axis - 1;
      // Both departures are negative on this objective — it is a real map, and
      // the sign is a fact about it rather than a convention.
      expect(tangential).toBeLessThan(0);
      expect(radial).toBeLessThan(0);
      ratios.push(radial / tangential);
    }

    // At the small end the cubic is the whole story and the ratio is 3 to parts
    // per million.
    expect(Math.abs(ratios[0]! - 3)).toBeLessThan(1e-5);
    // It stays 3 to a part in a thousand across a 16× span of field, and the
    // drift is MONOTONE and downward — the quintic, the same term § 6s's node
    // count is about, and not noise.
    for (const ratio of ratios) expect(Math.abs(ratio - 3)).toBeLessThan(3e-3);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeLessThan(ratios[i - 1]!);
  });

  it("§ 6as.3 — the derivative comes off the table; the best differenced step is worse", () => {
    const gold = buildRadialMap(SYSTEM, { maxRadiusMm: 2, nodes: 512, wavelengthNm: LAMBDA });
    const map = buildRadialMap(SYSTEM, { maxRadiusMm: 2, nodes: NODES, wavelengthNm: LAMBDA });
    const at = 1.0;
    const reference = gold.heightSlopeAt(at);

    const tableError = Math.abs(map.heightSlopeAt(at) / reference - 1);

    // The negative control: difference the per-pixel bisection instead, and
    // sweep the step, which a caller cannot do. Even its BEST step loses.
    const height = (r: number): number =>
      objectHeightForImageRadius(SYSTEM, r, LAMBDA, { magnification: NAMEPLATE });
    let best = Infinity;
    for (const d of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8]) {
      const differenced = (height(at + d) - height(at - d)) / (2 * d);
      best = Math.min(best, Math.abs(differenced / reference - 1));
    }

    expect(tableError).toBeLessThan(3e-12);
    expect(best).toBeGreaterThan(4 * tableError);

    // And the cost runs the same way: the table is nodes + 1 bisections for a
    // WHOLE frame, where differencing is two extra per pixel.
    expect(map.inversions).toBe(NODES + 1);
    expect(map.inversions).toBeLessThan(128 * 128);
  });

  it("§ 6as.4 — energy: the Gaussian's residual is the frame truncation, in closed form", () => {
    const frame = tileAt(0, 0, 256);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
    const a = frame.objectHalfExtentMm;

    // A Gaussian has no edge, so what it loses is not sampling — it is the tail
    // outside the square frame, and that is the error function exactly:
    // ∫∫_square peak·exp(−2r²/w²) = (πw²/2)·erf(√2·a/w)².
    const ratios: number[] = [];
    for (const fraction of [0.5, 0.42, 0.35, 0.3]) {
      const waistMm = a * fraction;
      const got = total(
        rasterizeEmitterDensity(frame, gaussianEmitter({ waistMm, peak: 1 }), { radialMap: map })
          .values,
      );
      const deficit = 1 - got / ((Math.PI * waistMm * waistMm) / 2);
      const tail = erfc((Math.SQRT2 * a) / waistMm);
      const closedForm = 1 - (1 - tail) * (1 - tail);
      ratios.push(deficit / closedForm);
    }

    // Four decades of truncation — 1.3e-4 down to 5.2e-11 — and the rasterizer
    // tracks the error function to 1% over all of it. The residual 0.1…1% is
    // the point sampling, which is what is LEFT once the truncation is named.
    for (const ratio of ratios) expect(Math.abs(ratio - 1)).toBeLessThan(0.02);
    // It is a real trend and not scatter: the sampling residual grows as the
    // truncation shrinks past it.
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
  });

  it("§ 6as.4 — energy: the hard edge's error sits inside the Gauss circle bracket", () => {
    // A disc's edge is a discontinuity, so point-sampling it miscounts the area
    // by the lattice-point discrepancy of a circle — the Gauss circle problem,
    // open since Gauss. Sierpiński (1906) bounds the count error by O(R^(2/3)),
    // so the RELATIVE error against R² falls as R^(−4/3); the conjectured
    // average behaviour R^(1/2) would give R^(−3/2).
    const sizes = [64, 128, 256];
    const logR: number[] = [];
    const logErr: number[] = [];

    for (const size of sizes) {
      const frame = tileAt(0, 0, size);
      const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
      const radiusMm = frame.objectHalfExtentMm * 0.5;
      const closedForm = Math.PI * radiusMm * radiusMm;

      // Averaged over sub-pixel placements, because WHICH pixels fall inside a
      // hard edge is a lattice accident — § 6ao's coin toss — and a single
      // placement measures that accident rather than the law. That is exactly
      // what § 5v.5 saw when it watched the residual change sign and declined to
      // claim a rate; the averaging is the whole difference.
      let acc = 0;
      const placements = 16;
      for (let j = 0; j < placements; j++) {
        const x = ((j * 0.6180339887) % 1) * frame.objectPixelScaleMm;
        const y = ((j * 0.4142135624) % 1) * frame.objectPixelScaleMm;
        const got = total(
          rasterizeEmitterDensity(
            frame,
            discEmitter({ radiusMm, density: 1, centreMm: { x, y } }),
            { radialMap: map },
          ).values,
        );
        acc += Math.abs(got / closedForm - 1);
      }
      logR.push(Math.log(size / 4));
      logErr.push(Math.log(acc / placements));
    }

    const exponent = logSlope(logR, logErr);
    // Measured −1.3415. Reported as sitting INSIDE the bracket, not as a law:
    // the true exponent is an open problem, so a rung claiming one would be
    // claiming more than mathematics knows. The bound is the bracket itself and
    // not the bracket plus slack — the placements are a deterministic
    // golden-ratio walk, so 0.008 of headroom is all there is and all that is
    // needed.
    expect(exponent).toBeLessThan(-4 / 3);
    expect(exponent).toBeGreaterThan(-3 / 2);
  });

  it("§ 6as.8 — the residual tabulation costs the DERIVATIVE what it never cost the height", () => {
    // § 6s tabulates either the height or the height minus the map's own
    // first-node slope, and § 6s.6 found the residual form buys **nothing**: a
    // cubic reproduces a linear function exactly, so subtracting the linear part
    // first and adding it back is a null. Both new readouts have to add that
    // linear part back too — the derivative adds `slope`, the height adds
    // `slope·r` — and a dropped term would be invisible to every rung above,
    // all of which run on the default. Hence this rung.
    //
    // It found something § 6s.6 could not have: the null does NOT extend to the
    // derivative. The residual table's values carry ulp(h) of cancellation from
    // the subtraction, and `lagrange4Slope` divides by the node spacing — so the
    // disagreement is **amplified by 1/spacing**, where the height's is not.
    const at = (nodes: number) => {
      const options = { maxRadiusMm: 2, nodes, wavelengthNm: LAMBDA } as const;
      const height = buildRadialMap(SYSTEM, { ...options, tabulate: "height" });
      const residual = buildRadialMap(SYSTEM, { ...options, tabulate: "residual" });
      let slope = 0;
      let area = 0;
      let h = 0;
      for (let i = 1; i <= 200; i++) {
        const r = (2 * i) / 200.5;
        slope = Math.max(slope, Math.abs(residual.heightSlopeAt(r) / height.heightSlopeAt(r) - 1));
        area = Math.max(
          area,
          Math.abs(residual.objectAreaPerImageArea(r) / height.objectAreaPerImageArea(r) - 1),
        );
        h = Math.max(h, Math.abs(residual.heightAt(r) / height.heightAt(r) - 1));
      }
      return { slope, area, h };
    };

    const coarse = at(32);
    const fine = at(512);

    // The HEIGHT is § 6s.6's null at both ends — one or two ulps, and flat in
    // the node count, which is what "buys nothing" means.
    expect(coarse.h).toBeLessThan(1e-15);
    expect(fine.h).toBeLessThan(1e-15);
    expect(fine.h / coarse.h).toBeLessThan(3);

    // The DERIVATIVE is not. It grows with the node count — ×16 of spacing buys
    // ×20 of disagreement — which identifies the mechanism, since nothing about
    // the map itself got worse.
    expect(coarse.slope).toBeGreaterThan(coarse.h * 4);
    expect(fine.slope / coarse.slope).toBeGreaterThan(8);

    // It stays far below what the table is worth anyway (§ 6as.3's 3e-12 floor),
    // so this is a documented property and not a refusal: 2.9e-14 at the node
    // count every rung here uses.
    expect(at(NODES).slope).toBeLessThan(1e-13);
    expect(at(NODES).area).toBeLessThan(1e-13);

    // And the residual form still reaches the same external number on the axis,
    // which is where a dropped `slope` would be least visible — the derivative
    // there IS the whole of the linear part.
    const residual = buildRadialMap(SYSTEM, {
      maxRadiusMm: 2,
      nodes: NODES,
      wavelengthNm: LAMBDA,
      tabulate: "residual",
    });
    expect(Math.abs(residual.objectAreaPerImageArea(0) * NAMEPLATE * NAMEPLATE - 1)).toBeLessThan(
      1e-12,
    );
  });

  it("§ 6as.5 — NEGATIVE CONTROL: without det J the flux is wrong by the distortion", () => {
    // The naive rasterizer a caller would write: treat the object grid as
    // uniform, `objectPixelScaleMm` squared per pixel. That is the LINEAR
    // reference, so it is nearly right on the axis and wrong off it by exactly
    // the distortion — which is the whole reason this module exists.
    const size = 128;
    const errors: number[] = [];
    for (const radiusMm of [0, 0.25, 0.5, 1.0, 2.0]) {
      const frame = tileAt(radiusMm, 0, size);
      const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
      const withJacobian = total(rasterizeEmitterDensity(frame, () => 1, { radialMap: map }).values);
      const naive = size * size * frame.objectPixelScaleMm * frame.objectPixelScaleMm;
      errors.push(Math.abs(naive / withJacobian - 1));
    }

    // On the axis the two nearly agree — and the residual is not zero, because a
    // tile has EXTENT. § 6n.3 already recorded this number from the other side:
    // total |t|² drifts by "1e-5 growing as the field's square, which is det J −
    // 1". Here it is det J itself, and it is the same 1e-5.
    expect(errors[0]!).toBeGreaterThan(5e-6);
    expect(errors[0]!).toBeLessThan(5e-5);

    // Off axis it grows QUADRATICALLY in the field — E·h², the third-order
    // signature again, approaching ×4 per doubling as the cubic takes over.
    for (let i = 2; i < errors.length; i++) {
      const growth = errors[i]! / errors[i - 1]!;
      expect(growth).toBeGreaterThan(3);
      expect(growth).toBeLessThan(4.1);
    }
    // And by 2 mm it is 1.8e-3 — a part in 550 of the flux, thrown away by a
    // rasterizer that looked correct.
    expect(errors[errors.length - 1]!).toBeGreaterThan(1e-3);
  });

  it("§ 6as.6 — the point limit: a shrinking disc lands where § 6i's bead lands", () => {
    // The third rasterizer joins the two § 6n.1 pinned against each other. The
    // comparison is on CENTROID rather than pixel-by-pixel, and that is forced
    // by the two being different instruments: `rasterizeEmitters` splats a bead
    // bilinearly so a sub-pixel move cannot make brightness jitter, while this
    // one point-samples a density. They agree about where the light IS; they
    // cannot agree pixel-for-pixel, and a rung pretending otherwise would be
    // measuring the splat.
    const size = 128;
    const frame = tileAt(0.5, 0, size);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
    const at = frame.centreObjectMm;

    const offsets: number[] = [];
    for (const pixels of [8, 4, 2]) {
      const radiusMm = pixels * frame.objectPixelScaleMm;
      const flux = Math.PI * radiusMm * radiusMm;
      const disc = rasterizeEmitterDensity(
        frame,
        discEmitter({ radiusMm, density: 1, centreMm: at }),
        { radialMap: map },
      );
      const bead = rasterizeEmitters(SYSTEM, frame, [{ xMm: at.x, yMm: at.y, flux }]);
      const d = centroid(disc.values, size);
      const b = centroid(bead.values, size);

      // Same place, to a part in 10⁵ of a pixel at 8 px across.
      expect(Math.abs(d.x - b.x)).toBeLessThan(3e-5);
      // Nothing off-axis in y: the tile is on the x axis and the map is radial.
      expect(Math.abs(d.y - b.y)).toBeLessThan(1e-12);
      // The flux agrees to the disc's own edge-sampling error (§ 6as.4), which
      // at 8 px across is percent-level and is the DISC's, not the placement's.
      expect(Math.abs(d.flux / b.flux - 1)).toBeLessThan(0.05);
      offsets.push(Math.abs(d.x - b.x));
    }

    // And the residual is quadratic in the disc's radius — it is the second-order
    // variation of det J across the disc, a real effect that vanishes with the
    // extent, rather than a misregistration that would not.
    //
    // § 5v.6's centroid agreed EXACTLY at every size, and the difference is the
    // field position rather than either module's quality: its disc is on the
    // axis, where the area element is symmetric about the disc's own centre and
    // the first moment cancels however coarse the quadrature is. This tile is
    // 0.5 mm off axis, so there is a real first moment to find — and finding it
    // converging as R² says more than finding zero would have.
    expect(offsets[0]! / offsets[1]!).toBeGreaterThan(3.6);
    expect(offsets[0]! / offsets[1]!).toBeLessThan(4.4);
  });

  it("§ 6as.7 — an extended fluorescent specimen images, through the unchanged chain", () => {
    // The architectural claim: `renderFluorescence` was built at § 6i and does
    // not move for a stained section. Nothing below the authoring layer learns
    // that the specimen had an extent.
    const size = 64;
    const frame = tileAt(0.5, 0, size);
    const map = radialMapCovering(SYSTEM, [frame], { nodes: NODES });
    const at = frame.centreObjectMm;
    const object = rasterizeEmitterDensity(
      frame,
      gaussianEmitter({ waistMm: 8 * frame.objectPixelScaleMm, peak: 1, centreMm: at }),
      { radialMap: map },
    );
    const pupils = tracedFieldPupils(SYSTEM, frame);
    const formed = renderFluorescence(object, pupils, { pupilSamples: 32, scale: frame.scale });

    expect(formed.size).toBe(size);
    // Incoherent imaging of a non-negative emitter field is non-negative, and
    // the PSF is normalized to sum 1, so the image conserves the object's flux
    // up to the wrap the circular convolution takes at the frame's edge.
    let minimum = Infinity;
    for (const v of formed.intensity) minimum = Math.min(minimum, v);
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(total(formed.intensity) / total(object.values)).toBeCloseTo(1, 6);

    // The image is broader than the object — that IS the imaging, and it is the
    // one thing that would be missing if the chain had silently passed through.
    const objectPeak = Math.max(...object.values);
    const imagePeak = Math.max(...formed.intensity);
    expect(imagePeak).toBeLessThan(objectPeak);
  });

  it("refuses a map that is not the frame's, and an unphysical density", () => {
    const frame = tileAt(0, 0, 64);
    const wrong = buildRadialMap(SYSTEM, {
      maxRadiusMm: 2,
      nodes: NODES,
      wavelengthNm: LAMBDA + 50,
    });
    expect(() => rasterizeEmitterDensity(frame, () => 1, { radialMap: wrong })).toThrow(
      /rasterizeEmitterDensity/,
    );

    expect(() => discEmitter({ radiusMm: 0, density: 1 })).toThrow(/radiusMm/);
    expect(() => discEmitter({ radiusMm: 1, density: -1 })).toThrow(/density/);
    expect(() => gaussianEmitter({ waistMm: -1, peak: 1 })).toThrow(/waistMm/);
  });
});
