import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { LINE_D } from "../src/materials/dispersion";
import { psf } from "../src/wave/psf";
import { newtonian } from "../src/designs/newtonian";
import { integratedXyz } from "../src/imaging/image";
import { renderField } from "../src/imaging/render";
import { rasterizePointSources } from "../src/imaging/scene";
import {
  buildFieldMap,
  limbDarkenedDisc,
  rasterizeExtendedSource,
  uniformDisc,
} from "../src/imaging/extended";
import { heroPair, heroSystem, PSF_OPTIONS } from "./support/heroScene";
import { bestFocus, withFocus } from "../src/analysis/focus";

/**
 * Step 5v — the extended incoherent source.
 *
 * A star is a flux at a point; a planet is a **radiance over solid angle**, and
 * the whole difference is one Jacobian. These rungs pin that Jacobian against a
 * closed form that exists outside this engine — cos³θ/f², the geometric three
 * quarters of the textbook cos⁴θ falloff — on the one fixture where the closed
 * form is exactly true, and then measure what a real lens does instead.
 *
 * The fixture is psf.test's own paraboloid at its focus, and it is exact here
 * for a reason worth stating: its stop is AT the mirror, so the chief ray from
 * any field angle strikes the vertex and reflects there, giving
 * `r = f·tan θ` to the last bit. On that map — and only on that map — the
 * Jacobian is cos³θ/f² identically.
 */

const R = -200; // concave mirror facing the light; focus at R/2 = −100
const APERTURE = 10;
const F = Math.abs(R / 2);
const GRID = { pupilSamples: 64, padFactor: 4 } as const;
const SAMPLES = [{ nm: LINE_D, weight: 1 }];
const FLAT = () => 1;

function mirror(): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic: -1,
        semiAperture: APERTURE,
        thickness: R / 2,
        isStop: true,
      },
    ],
  };
  return {
    prescription,
    aperture: { kind: "stopRadius", value: APERTURE },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** The step-4 hero achromat, focused — a system with real distortion in it. */
const achromat = (() => {
  const base = heroSystem(heroPair().achromat);
  const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: 550 });
  return withFocus(base, focus.offsetFromLastVertex);
})();

/** Exact solid angle of a cone of angular DIAMETER `deg`. */
function discSolidAngle(deg: number): number {
  return 2 * Math.PI * (1 - Math.cos(((deg / 2) * Math.PI) / 180));
}

function total(a: Float64Array): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

describe("5v.1 — the fourth cosine is not in the engine, so it is not applied here", () => {
  it("the transmitted pupil energy is flat in field where cos θ is not", () => {
    // The measurement that decided the module's signature. The textbook cos⁴θ
    // splits as a geometric cos³ (this module's Jacobian) times the entrance
    // pupil's projected area cos. If `psf().energy` already carried that fourth
    // cosine, applying it here would double it.
    //
    // It does not: the engine's pupil is a NORMALIZED grid, so its area is
    // field-independent by construction. What little field dependence the
    // energy has is the pupil lattice's own quantization, and it is three
    // orders under the cosine and not even the same shape.
    const p0 = psf(achromat, 0, 550, PSF_OPTIONS);
    const p2 = psf(achromat, 2, 550, PSF_OPTIONS);
    const measured = Math.abs(p2.energy / p0.energy - 1);
    const cosine = 1 - Math.cos((2 * Math.PI) / 180);

    expect(measured).toBeLessThan(1e-6);
    expect(cosine).toBeGreaterThan(6e-4);
    // Three orders apart. The obliquity is absent, not merely small.
    expect(cosine / measured).toBeGreaterThan(500);
  });

  it("and it is absent from the point-source rasterizer identically, so it cancels", () => {
    // This is why the deferral is the PUPIL layer's and not this module's: both
    // rasterizers are missing the same cosine, so the point-source limit
    // (5v.7) compares like with like. A cosine applied on one side only would
    // have made a star and a disc of equal flux render at different
    // brightnesses.
    const star = (fieldXDeg: number) =>
      total(
        rasterizePointSources(achromat, [{ fieldXDeg, fieldYDeg: 0, flux: 1, spectrum: FLAT }], SAMPLES, {
          size: 64,
          pixelScaleMm: 0.05,
        }).planes[0]!,
      );
    // A star's rasterized flux does not know its field angle at all.
    expect(star(0)).toBeCloseTo(star(0.5), 12);
  });
});

describe("5v.2 — the fixture: a stop at the mirror maps r = f·tan θ exactly", () => {
  it("the traced chief ray is f·tan θ to one ulp over four degrees", () => {
    // The licence for every closed form below. Not an approximation that holds
    // near the axis: the chief ray reflects AT the vertex, so this is the
    // reflection law and nothing else.
    //
    // Asserted on the TABLE's own entries — `map.radii[k]` is the traced radius
    // at `k·spacing` — rather than on `radiusAt`, which would add the
    // interpolant's remainder (2.3e-13 here) to a number that has none. The
    // fixture's exactness is the trace's, and the interpolation is 5v.4's
    // subject rather than this rung's.
    const map = buildFieldMap(mirror(), { maxFieldDeg: 4, nodes: 64, wavelengthNm: LINE_D });
    for (const k of [1, 8, 16, 32, 64]) {
      const th = k * map.spacingRad;
      expect(Math.abs(map.radii[k]! / (F * Math.tan(th)) - 1)).toBeLessThan(4e-16);
    }
  });
});

describe("5v.3 — the Jacobian is cos³θ/f², and the axis is exactly 1/f²", () => {
  const map = buildFieldMap(mirror(), { maxFieldDeg: 4, nodes: 64, wavelengthNm: LINE_D });

  it("dΩ/dA reproduces the closed form to 1.3e-10 over four degrees", () => {
    // The external number. cos³θ/f² is the geometric three quarters of the
    // textbook cos⁴θ natural-vignetting law; the missing quarter is 5v.1's.
    for (const deg of [0.5, 1, 2, 3, 4]) {
      const th = (deg * Math.PI) / 180;
      const got = map.solidAnglePerArea(F * Math.tan(th));
      const want = Math.cos(th) ** 3 / (F * F);
      expect(Math.abs(got / want - 1)).toBeLessThan(1.3e-10);
    }
  });

  it("the axis is the exact limit of two vanishing quantities, not a clamp", () => {
    // sin θ/r and dθ/dr are the same limit on the axis, so the product is
    // (dθ/dr)² — a closed form rather than 0/0. On a system that images at f
    // it is 1/f², which is a number from outside the engine.
    expect(map.solidAnglePerArea(0)).toBeCloseTo(1 / (F * F), 15);
    expect(Math.abs(map.solidAnglePerArea(0) * F * F - 1)).toBeLessThan(1e-11);
  });

  it("the falloff is real but tiny at telescope fields — 0.73% at 4°", () => {
    // Worth stating because the cos⁴ law is famous from wide-angle
    // photography, where it bites. A telescope's field is degrees at most, so
    // natural vignetting is a fraction of a percent and no observer has ever
    // seen it. The rung exists to pin the law, not to promise a visible effect.
    const edge = map.solidAnglePerArea(F * Math.tan((4 * Math.PI) / 180));
    const axis = map.solidAnglePerArea(0);
    expect(1 - edge / axis).toBeGreaterThan(7.2e-3);
    expect(1 - edge / axis).toBeLessThan(7.4e-3);
  });
});

describe("5v.4 — a derivative loses an order, and the error estimate is the wrong quantity's", () => {
  it("the Jacobian converges ×8 per doubling where the radius converges ×16", () => {
    // § 6s pinned the interpolant as fourth-order in the VALUE. This module
    // reads its DERIVATIVE, and differentiating a piecewise polynomial costs
    // exactly one order — so the same table that places a pixel to h⁴ reports
    // that pixel's solid angle to h³. Measured rather than assumed, because it
    // is the number that says how many nodes a Jacobian needs.
    const worstOf = (nodes: number): number => {
      const map = buildFieldMap(mirror(), { maxFieldDeg: 4, nodes, wavelengthNm: LINE_D });
      let worst = 0;
      for (const deg of [0.5, 1, 2, 3, 4]) {
        const th = (deg * Math.PI) / 180;
        const got = map.solidAnglePerArea(F * Math.tan(th));
        const want = Math.cos(th) ** 3 / (F * F);
        worst = Math.max(worst, Math.abs(got / want - 1));
      }
      return worst;
    };
    const errors = [8, 16, 32, 64].map(worstOf);
    for (let i = 1; i < errors.length; i++) {
      const ratio = errors[i - 1]! / errors[i]!;
      // Third order: 8. Not 16, which is what the value converges at.
      expect(ratio).toBeGreaterThan(7.5);
      expect(ratio).toBeLessThan(8.5);
    }
  });

  it("`errorEstimateMm` falls ×16, so it does not describe the Jacobian's error", () => {
    // § 6s.2 recorded that the estimate under-reads the truth by 7–17%. Here it
    // is worse than under-reading and the difference is structural: the
    // estimate is the interpolated RADIUS's remainder, which is fourth-order,
    // while the quantity actually consumed is third-order. Reported, not fixed
    // — an estimate of the wrong order is still the number that says when more
    // nodes stop buying anything, and naming what it measures is the fix.
    //
    // 14.91, 15.47, 15.74: sixteen approached from below, which is a fourth
    // difference resolving its own stencil as the table refines.
    const estimates = [8, 16, 32, 64].map(
      (nodes) => buildFieldMap(mirror(), { maxFieldDeg: 4, nodes, wavelengthNm: LINE_D }).errorEstimateMm,
    );
    let previous = 0;
    for (let i = 1; i < estimates.length; i++) {
      const ratio = estimates[i - 1]! / estimates[i]!;
      expect(ratio).toBeGreaterThan(14.5);
      expect(ratio).toBeLessThan(16);
      // Monotonically toward 16, which is what distinguishes "fourth order"
      // from "about fifteen".
      expect(ratio).toBeGreaterThan(previous);
      previous = ratio;
    }
  });
});

describe("5v.5 — the inversion is Newton on the interpolant, and round-trips to f64", () => {
  it("field → radius → field returns the field to the last bit", () => {
    // The map is built forward (one chief ray per node, no search) and
    // inverted afterwards. If the inversion were bisected to a tolerance
    // instead, the derivative taken beside it would carry that tolerance.
    const map = buildFieldMap(mirror(), { maxFieldDeg: 4, nodes: 64, wavelengthNm: LINE_D });
    for (const deg of [0.3, 1.7, 2.5, 3.9]) {
      const th = (deg * Math.PI) / 180;
      expect(Math.abs(map.fieldAt(map.radiusAt(th)) / th - 1)).toBeLessThan(1e-15);
    }
  });
});

describe("5v.6 — a density's flux converges rather than conserving", () => {
  const PIXEL = psf(achromat, 0, 550, PSF_OPTIONS).pixelScaleMm;

  const discFlux = (diameterDeg: number, size: number): number =>
    total(
      rasterizeExtendedSource(
        achromat,
        uniformDisc({ diameterDeg, radiance: 1, spectrum: FLAT }),
        SAMPLES,
        { size, pixelScaleMm: PIXEL },
      ).planes[0]!,
    );

  /** Signed relative departure of the rasterized flux from the exact solid angle. */
  const residual = (diameterDeg: number): number =>
    discFlux(diameterDeg, 256) / discSolidAngle(diameterDeg) - 1;

  it("the total is the disc's own solid angle, to a residual that shrinks with the disc", () => {
    // `imaging/specimen` records that energy is NOT a witness for an amplitude
    // warp. Here it is one, because a radiance is a density — and it is a
    // CONVERGING witness, not an exact one: the radiance is point-sampled at
    // each pixel's field direction (§ 6n's convention, so nothing is
    // resampled), and a point sample of a hard-edged disc counts lattice
    // points inside a circle.
    //
    // The bound is stated per disc radius in pixels, because that is what the
    // count depends on — 3.2, 6.3, 12.7, 25.4 px here.
    for (const [diameterDeg, bound] of [
      [0.005, 1.8e-1],
      [0.01, 2.0e-2],
      [0.02, 2.4e-3],
      [0.04, 2.1e-4],
    ] as const) {
      expect(Math.abs(residual(diameterDeg))).toBeLessThan(bound);
    }
  });

  it("the residual CHANGES SIGN, so it is the lattice and not a quadrature bias", () => {
    // +1.70e-1, +1.95e-2, −2.27e-3, +1.99e-4. A systematic under- or
    // over-count would keep its sign and could be corrected by a factor; this
    // is the Gauss circle problem — the number of lattice points inside a
    // circle oscillates about its area — and § 6i.2 met the same thing
    // counting a pupil's points.
    //
    // Asserted as the sign flip rather than as a rate, because a rate is
    // exactly what a sequence like this does not have.
    const rs = [0.005, 0.01, 0.02, 0.04].map(residual);
    const positive = rs.filter((r) => r > 0).length;
    expect(positive).toBeGreaterThan(0);
    expect(positive).toBeLessThan(rs.length);
    // The magnitude does fall throughout, which is the convergence half.
    for (let i = 1; i < rs.length; i++) {
      expect(Math.abs(rs[i]!)).toBeLessThan(Math.abs(rs[i - 1]!));
    }
  });

  it("a bigger frame adds no light — to 1e-14, and not bitwise, for a stated reason", () => {
    // The frame is a window on the sky, not a scale. If the flux moved with
    // the frame size the Jacobian would be carrying a grid dependence, which
    // is exactly the class of error § 6r.3's ruler was about.
    //
    // Not bitwise, and the reason is worth keeping: each frame tabulates its
    // map out to its OWN corner, so a wider frame spreads the same node count
    // over a longer span and its interpolant differs in the last bits. The
    // sampled sky is identical; the table under it is not.
    const a = discFlux(0.01, 64);
    const b = discFlux(0.01, 128);
    const c = discFlux(0.01, 256);
    expect(Math.abs(a / b - 1)).toBeLessThan(1e-14);
    expect(Math.abs(b / c - 1)).toBeLessThan(1e-14);
  });
});

describe("5v.7 — the point-source limit, and the control with no Jacobian in it", () => {
  const PIXEL = psf(achromat, 0, 550, PSF_OPTIONS).pixelScaleMm;

  it("a shrinking disc of fixed flux approaches the star it is becoming", () => {
    // NOT bitwise, and § 6n.2's emitter pin is why the difference is worth
    // stating: `rasterizePointSources` splats one flux bilinearly over four
    // pixels, while a disc is point-sampled over however many pixel centres
    // fall inside it. The two converge in flux and agree exactly in centroid;
    // asking for bit equality would be asking two different quadratures to
    // round the same way.
    const centroid = (a: Float64Array, n: number) => {
      let sx = 0;
      let sy = 0;
      let s = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const v = a[y * n + x]!;
          sx += v * x;
          sy += v * y;
          s += v;
        }
      }
      return { x: sx / s, y: sy / s };
    };

    const size = 128;
    const star = rasterizePointSources(
      achromat,
      [{ fieldXDeg: 0, fieldYDeg: 0, flux: 1, spectrum: FLAT }],
      SAMPLES,
      { size, pixelScaleMm: PIXEL },
    ).planes[0]!;

    let previous = Infinity;
    for (const diameterDeg of [0.004, 0.01, 0.03]) {
      const disc = rasterizeExtendedSource(
        achromat,
        uniformDisc({ diameterDeg, radiance: 1 / discSolidAngle(diameterDeg), spectrum: FLAT }),
        SAMPLES,
        { size, pixelScaleMm: PIXEL },
      ).planes[0]!;
      const err = Math.abs(total(disc) / total(star) - 1);
      expect(err).toBeLessThan(previous);
      previous = err;
      // The centroid is the map's, not the quadrature's, so it is exact at
      // every size — a disc centred on the axis images centred on the axis.
      expect(centroid(disc, size).x).toBeCloseTo(centroid(star, size).x, 10);
      expect(centroid(disc, size).y).toBeCloseTo(centroid(star, size).y, 10);
    }
    expect(previous).toBeLessThan(3e-3);
  });

  it("dropping the Jacobian renders a uniform sky uniform, which it is not", () => {
    // The negative control, and it is the whole content of the module: without
    // dΩ/dA the plane is a radiance map wearing a flux's units. On the
    // paraboloid the error it makes is exactly 1 − cos³θ; on a real lens it
    // additionally carries the distortion (5v.8).
    const sys = mirror();
    const map = buildFieldMap(sys, { maxFieldDeg: 4, nodes: 64, wavelengthNm: LINE_D });
    for (const deg of [1, 2, 4]) {
      const th = (deg * Math.PI) / 180;
      const honest = map.solidAnglePerArea(F * Math.tan(th)) / map.solidAnglePerArea(0);
      // The flat alternative is 1 everywhere by construction, so the error it
      // makes is exactly the falloff.
      //
      // Compared as an ABSOLUTE difference against 5v.3's own measured
      // accuracy, not as a ratio: the falloff vanishes on the axis while the
      // interpolant's error does not, so a relative test tightens without limit
      // toward θ = 0 and would be reading the table rather than the physics.
      // 1.2e-10 is what 5v.3 pins the Jacobian to; this asks for no better.
      expect(Math.abs((1 - honest) - (1 - Math.cos(th) ** 3))).toBeLessThan(5e-10);
    }
  });
});

describe("5v.8 — on a real lens the departure from cos³ IS the distortion", () => {
  it("it runs ×4.00 per doubling of field — § 6h.1's cubic, one derivative down", () => {
    // The Jacobian's departure from the distortion-free closed form is
    // quadratic in field where the height's own departure is cubic, because
    // this reads the map's slope rather than the map. That completes a ladder
    // off one coefficient with § 6h.1's ×8.00 cubic, § 6m.4's slope and
    // § 6n's ×2.00 sagitta.
    //
    // Normalized to the map's OWN axial scale rather than to the paraxial EFL,
    // which removes C4's constant 0.0212% plane-position offset and leaves the
    // field-dependent term — the distortion — on its own.
    const map = buildFieldMap(achromat, { maxFieldDeg: 2, nodes: 64, wavelengthNm: 550 });
    const fEff = 1 / Math.sqrt(map.solidAnglePerArea(0));
    const departure = (deg: number): number => {
      const th = (deg * Math.PI) / 180;
      return map.solidAnglePerArea(map.radiusAt(th)) / (Math.cos(th) ** 3 / (fEff * fEff)) - 1;
    };
    const points = [0.125, 0.25, 0.5, 1, 2].map(departure);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]! / points[i - 1]!).toBeCloseTo(4, 2);
    }
    // A paraboloid has no distortion to find, and reads zero on the same test.
    const perfect = buildFieldMap(mirror(), { maxFieldDeg: 2, nodes: 64, wavelengthNm: LINE_D });
    const fPerfect = 1 / Math.sqrt(perfect.solidAnglePerArea(0));
    const th = (2 * Math.PI) / 180;
    expect(
      Math.abs(
        perfect.solidAnglePerArea(perfect.radiusAt(th)) /
          (Math.cos(th) ** 3 / (fPerfect * fPerfect)) -
          1,
      ),
    ).toBeLessThan(1e-9);
  });
});

describe("5v.9 — the scene drops into `renderField` unchanged", () => {
  const sys = mirror();
  const p = psf(sys, 0, LINE_D, GRID);
  const PIXEL = p.pixelScaleMm;
  const OPTIONS = { patches: 1, ...GRID } as const;

  it("a disc and a star of equal total flux integrate to the same light", () => {
    // The architectural claim of the step, as a number: the field-varying
    // render, the polychromatic stack and the colour integration were built at
    // step 4 and none of them had to learn that a source can have a size.
    // Exact at one patch, where the render is a plain convolution and
    // therefore linear.
    const size = 128;
    const diameterDeg = 0.01;
    const disc = rasterizeExtendedSource(
      sys,
      uniformDisc({ diameterDeg, radiance: 1 / discSolidAngle(diameterDeg), spectrum: FLAT }),
      SAMPLES,
      { size, pixelScaleMm: PIXEL },
    );
    const flux = total(disc.planes[0]!);
    const star = rasterizePointSources(
      sys,
      [{ fieldXDeg: 0, fieldYDeg: 0, flux, spectrum: FLAT }],
      SAMPLES,
      { size, pixelScaleMm: PIXEL },
    );
    const yDisc = integratedXyz(renderField(sys, disc, OPTIONS).image).y;
    const yStar = integratedXyz(renderField(sys, star, OPTIONS).image).y;
    expect(Math.abs(yDisc / yStar - 1)).toBeLessThan(1e-13);
  });

  it("and the rendered light is exactly linear in the radiance", () => {
    const size = 128;
    const diameterDeg = 0.01;
    const render = (radiance: number): number =>
      integratedXyz(
        renderField(
          sys,
          rasterizeExtendedSource(sys, uniformDisc({ diameterDeg, radiance, spectrum: FLAT }), SAMPLES, {
            size,
            pixelScaleMm: PIXEL,
          }),
          OPTIONS,
        ).image,
      ).y;
    // Bitwise 2, because doubling a radiance doubles every pixel before
    // anything nonlinear could touch it. Incoherent imaging is linear in
    // intensity and this is the shortest statement of it in the branch.
    expect(render(2) / render(1)).toBe(2);
  });

  it("a disc's image reaches f·tan(D/2), which no point source can say", () => {
    // The capability itself: the source has an angular size and the image
    // knows what it is. Pinned against the geometry rather than against the
    // rasterizer — the last lit pixel must be the geometric edge's own pixel.
    const size = 128;
    const diameterDeg = 0.05;
    const scene = rasterizeExtendedSource(
      sys,
      uniformDisc({ diameterDeg, radiance: 1, spectrum: FLAT }),
      SAMPLES,
      { size, pixelScaleMm: PIXEL },
    );
    const edgePx = (F * Math.tan(((diameterDeg / 2) * Math.PI) / 180)) / PIXEL;
    const c = size / 2;
    let last = 0;
    for (let x = c; x < size; x++) if (scene.planes[0]![c * size + x]! > 0) last = x - c;
    expect(last).toBe(Math.floor(edgePx));
  });
});

describe("5v.10 — what it refuses", () => {
  it("a radius outside the tabulated range, rather than extrapolating", () => {
    const map = buildFieldMap(mirror(), { maxFieldDeg: 1, nodes: 16, wavelengthNm: LINE_D });
    expect(() => map.fieldAt(map.maxRadiusMm * 1.5)).toThrow(/outside the tabulated range/);
  });

  it("a frame whose corner reaches further than the system passes light", () => {
    // C4's lesson, applied before it could bite: a bracket that assumes its own
    // field passes unnoticed until something folded arrives. A Newtonian's
    // chief ray stops clearing the diagonal at § 2f's wall — 1.56° at f/5 —
    // and a frame reaching past it is refused rather than quietly clipped.
    const scope = newtonian({ apertureMm: 120, focalRatio: 5 });
    const scopeSystem: OpticalSystem = {
      prescription: scope.prescription,
      aperture: { kind: "stopRadius", value: 60 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    // A frame well inside the wall builds.
    expect(() =>
      rasterizeExtendedSource(scopeSystem, () => 1, SAMPLES, { size: 16, pixelScaleMm: 0.2 }),
    ).not.toThrow();
    // One reaching several degrees out does not.
    expect(() =>
      rasterizeExtendedSource(scopeSystem, () => 1, SAMPLES, { size: 16, pixelScaleMm: 3 }),
    ).toThrow();
  });

  it("a table too coarse to resolve its own fourth difference", () => {
    expect(() => buildFieldMap(mirror(), { maxFieldDeg: 1, nodes: 3, wavelengthNm: LINE_D })).toThrow(
      /nodes must be an integer >= 4/,
    );
  });
});

describe("5v.11 — the limb-darkening law, and its own limit", () => {
  it("u = 0 is the uniform disc, bitwise", () => {
    // The law is `I(μ)/I(0) = 1 − u(1 − μ)`, textbook; the coefficient is not
    // supplied here because a real u is measured data and belongs to a star and
    // a wavelength. What is pinned is that the law contains the uniform disc
    // exactly, so the two authoring helpers cannot drift apart.
    const a = uniformDisc({ diameterDeg: 0.05, radiance: 3, spectrum: FLAT });
    const b = limbDarkenedDisc({ diameterDeg: 0.05, radiance: 3, spectrum: FLAT, u: 0 });
    for (let i = -30; i <= 30; i += 3) {
      for (let j = -30; j <= 30; j += 3) {
        expect(b(i * 0.001, j * 0.001, 550)).toBe(a(i * 0.001, j * 0.001, 550));
      }
    }
  });

  it("μ is the sphere's geometry, so the limb is dark and the centre is not", () => {
    // A darkened disc carries less flux than a uniform one of the same central
    // radiance — the physical content of the law — and the centre is untouched.
    const u = 0.6;
    const bright = limbDarkenedDisc({ diameterDeg: 0.05, radiance: 1, spectrum: FLAT, u });
    expect(bright(0, 0, 550)).toBe(1);
    // At the limb μ → 0, so the law reads 1 − u exactly.
    expect(bright(0.02499, 0, 550)).toBeLessThan(1 - u + 0.02);
    expect(bright(0.025, 0, 550)).toBeCloseTo(1 - u, 12);
    // And half way out in projected radius, μ = √(1 − ¼) = √3/2.
    expect(bright(0.0125, 0, 550)).toBeCloseTo(1 - u * (1 - Math.sqrt(3) / 2), 12);
  });
});
