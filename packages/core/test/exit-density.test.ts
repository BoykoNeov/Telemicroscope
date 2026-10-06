import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";
import { pupils } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { exitApertureSine, opdMap } from "../src/pupil/opd";
import { imageNumericalAperture } from "../src/pupil/microscope";
import { infinityCorrectedMicroscope, tubeLens } from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import { laidPupil } from "../src/wave/psf";
import { geometricPsf } from "../src/wave/geometric";
import type { PupilSource } from "../src/wave/exit-density";

/**
 * § 2j — the exit pupil's irradiance, traced (register items 23 and 24).
 *
 * § 2i laid each traced sample where its ray went and kept the amplitude
 * uniform in that coordinate. Energy is carried by ray tubes, not by
 * coordinates: a ray aimed at `a` carries the source power of its aim cell and
 * delivers it to the exit cell it lands in, so the exit pupil's irradiance is
 * S(a)/|∂e/∂a|. Uniform in the exit coordinate is that only where the map is
 * linear — and the § 2f vesica, whose mirror is an off-axis segment, read
 * 5.4e-4 then 6.3e-4 through it, not converging.
 *
 * ## The hypothesis, and the numbers that refute it
 *
 * |P|² = S/|∂e/∂a|, with S the source's power per aim area — a plane wave's
 * uniform one at infinity; at a finite conjugate |d_z|³ for an isotropic
 * emitter and |d_z|⁵ for a transmitted field (`PupilSource`) — is the pupil the
 * transform needs. Refuted by any of:
 *
 *  - a fast paraboloid's profile away from Richards and Wolf's 2/(1 + cos θ) on
 *    the sphere, 1/(cos⁴(θ/2)·cos θ) projected, by more than the lattice's own
 *    differencing;
 *  - an ellipsoid imaging focus to focus away from (r₂/r₁)²/cos β — the two foci
 *    see one mirror element at equal incidence, so dΩ₁/dΩ₂ = (r₂/r₁)² — for the
 *    emitter, and that times cos²α for the field;
 *  - the oil 100×/1.25's two branches disagreeing about the light inside half
 *    the exit radius: the transform's pupil reads it through the Jacobian, the
 *    ray histogram through S alone, and they share nothing but the trace;
 *  - the irradiance moving when the same light is aimed differently.
 *
 * **Restated at § 2n for a transmitted field.** A field's |P|² is now each plane-
 * wave component's own power, cos α at its launch direction, with no Jacobian: in
 * `abbeImage` one lattice cell is one component on both sides of the lens, and the
 * Jacobian is how a CONTINUOUS spectrum is laid onto the exit lattice — a point's
 * question. On an aplanat the two agree; the focus-to-focus ellipsoid is stigmatic
 * but far off the sine condition, so § 2j.2's field closed form is now cos α, and
 * the ray branch (still the point's construction — brightfield never blends with
 * it, § 6f.12) sits apart from the wave branch on the oil by the size of its offence.
 */

const L = LINE_D;
const EXIT = { layout: "exit" } as const;

/** In-disc node at the chief ray — the shape's normalization in every rung below. */
function centre(nodes: readonly { readonly px: number; readonly py: number; readonly density: number }[]): number {
  return nodes.find((q) => q.px === 0 && q.py === 0)!.density;
}

describe("§ 2j.1 — a plane wave through a fast paraboloid: Richards and Wolf", () => {
  // Stop 100 mm in front of the mirror, so no rim ray meets the mirror before
  // the stop (its sag is 46 mm at the lattice's outer ring). f/0.67: the rim
  // sits at θ′ = 41°, where the projected profile is 1.72× the centre's.
  const F = 200;
  const mirror: OpticalSystem = {
    prescription: {
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: 150, thickness: 100, medium: "AIR", isStop: true },
        { kind: "reflect", curvature: -1 / (2 * F), conic: -1, semiAperture: 400, thickness: -F },
      ],
    },
    aperture: { kind: "stopRadius", value: 150 },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: L, weight: 1 }],
    conjugate: { kind: "infinite" },
  };

  it("the traced irradiance is 1/(cos⁴(θ′/2)·cos θ′) to the lattice's fourth order", () => {
    const laid = laidPupil(mirror, opdMap(mirror, 0, L, pupilGrid(21)), EXIT);
    const density = laid.density!;
    const sigma = Math.abs(exitApertureSine(mirror, L));
    const c0 = centre(density.nodes);
    const a0 = density.amplitude(0, 0) ** 2;
    let node = 0;
    let fitted = 0;
    let rim = 0;
    for (const q of density.nodes) {
      // The exit coordinate IS sin θ′ over the rim's: every ray passes the focus.
      const t = Math.asin(Math.hypot(q.ex, q.ey) * sigma);
      const closed = 1 / (Math.cos(t / 2) ** 4 * Math.cos(t));
      rim = Math.max(rim, closed);
      node = Math.max(node, Math.abs(q.density / c0 / closed - 1));
      fitted = Math.max(fitted, Math.abs(density.amplitude(q.ex, q.ey) ** 2 / a0 / closed - 1));
    }
    expect(rim).toBeGreaterThan(1.7);
    // 1.5e-5 at the nodes — Richardson's h⁴; 1.5e-4 through the 45-term fit
    // the transform reads.
    expect(node).toBeLessThan(5e-5);
    expect(fitted).toBeLessThan(5e-4);
  });
});

describe("§ 2j.2 — an emitter and a field through an ellipsoid, focus to focus", () => {
  // a = 100, ε = ½: vertex radius a(1 − ε²) = 75, object at the near focus 50 mm
  // out, image at the far one, 150. Stigmatic to all orders, so every ray
  // passes F₂ and the closed form is the ellipse's alone.
  const A = 100;
  const EPS = 0.5;
  const P = A * (1 - EPS * EPS);
  const C = A * EPS;
  const mirror: OpticalSystem = {
    prescription: {
      surfaces: [
        { kind: "reflect", curvature: -1 / P, conic: -EPS * EPS, semiAperture: 40, thickness: -(A + C), isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: 40 },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: L, weight: 1 }],
    conjugate: { kind: "finite", distance: A - C },
  };

  /** (r₂/r₁)²/cos β for a ray leaving F₁ at cos α, over its axial value 9. */
  function closedForm(cosAlpha: number, source: PupilSource): number {
    const r1 = P / (1 + EPS * cosAlpha);
    const r2 = 2 * A - r1;
    const x = r1 * Math.sqrt(1 - cosAlpha * cosAlpha);
    const z = r1 * cosAlpha + 2 * C;
    const cosBeta = z / Math.hypot(x, z);
    const emitter = (r2 / r1) ** 2 / cosBeta / 9;
    return source === "emitter" ? emitter : emitter * cosAlpha * cosAlpha;
  }

  it.each(["emitter"] as const)("%s: the traced irradiance is the ellipse's own", (source) => {
    const laid = laidPupil(mirror, opdMap(mirror, 0, L, pupilGrid(21)), { ...EXIT, source });
    const density = laid.density!;
    const pg = pupils(mirror, L);
    const c0 = centre(density.nodes);
    const a0 = density.amplitude(0, 0) ** 2;
    let node = 0;
    let fitted = 0;
    let rim = Infinity;
    for (const q of density.nodes) {
      const d = aimRay(mirror, pg, 0, { px: q.px, py: q.py }, L).dir;
      const closed = closedForm(Math.abs(d.z) / Math.hypot(d.x, d.y, d.z), source);
      rim = Math.min(rim, closed);
      node = Math.max(node, Math.abs(q.density / c0 / closed - 1));
      fitted = Math.max(fitted, Math.abs(density.amplitude(q.ex, q.ey) ** 2 / a0 / closed - 1));
    }
    // The rim is 0.837 of the centre, measured 6.1e-5 from its closed form. Until
    // § 2n the field read this times cos²α, 0.511 at the rim.
    expect(rim).toBeLessThan(0.85);
    expect(node).toBeLessThan(2e-4);
    expect(fitted).toBeLessThan(2e-4);
  });

  it("field: each component's own power, cos α, where the ellipse's Jacobian no longer enters (§ 2n)", () => {
    const laid = laidPupil(mirror, opdMap(mirror, 0, L, pupilGrid(21)), { ...EXIT, source: "field" });
    const density = laid.density!;
    const pg = pupils(mirror, L);
    let node = 0;
    let fitted = 0;
    let rim = Infinity;
    for (const q of density.nodes) {
      const d = aimRay(mirror, pg, 0, { px: q.px, py: q.py }, L).dir;
      const cosAlpha = Math.abs(d.z) / Math.hypot(d.x, d.y, d.z);
      rim = Math.min(rim, cosAlpha);
      node = Math.max(node, Math.abs(q.density / cosAlpha - 1));
      fitted = Math.max(fitted, Math.abs(density.amplitude(q.ex, q.ey) ** 2 / cosAlpha - 1));
    }
    // 0.781 at the rim, where the Jacobian reading was 0.511; 2.2e-16 at the
    // nodes, 4.2e-8 through the fit the transform reads.
    expect(rim).toBeLessThan(0.79);
    expect(node).toBeLessThan(4 * Number.EPSILON);
    expect(fitted).toBeLessThan(1e-7);
  });
});

describe("§ 2j.3 — the two branches agree, and share nothing but the trace", () => {
  const oil = () =>
    infinityCorrectedMicroscope({
      objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 }),
      tubeLens: tubeLens({ focalLengthMm: 200 }),
      objectHeightsMm: [0],
    }).system;

  it.each(["emitter", "field"] as const)(
    "%s on the oil 100×: the light inside half the exit radius, by Jacobian and by ray",
    (source) => {
      const s0 = oil();
      // The transform's pupil: |P|² summed inside e < ½ over the whole.
      const laid = laidPupil(s0, opdMap(s0, 0, L, pupilGrid(21)), { ...EXIT, source });
      let inside = 0;
      let total = 0;
      const N = 801;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x = -1 + (2 * (i + 0.5)) / N;
          const y = -1 + (2 * (j + 0.5)) / N;
          const a = laid.pupil.amplitude(x, y);
          total += a * a;
          if (x * x + y * y <= 0.25) inside += a * a;
        }
      }
      // The histogram of an image-side defocus — § 2i.4's fixture, whose blur is
      // linear in the exit sine to 8e-5 — each ray weighted by S alone.
      const last = s0.prescription.surfaces.length - 1;
      const dz = 20;
      const s1: OpticalSystem = {
        ...s0,
        prescription: {
          ...s0.prescription,
          surfaces: s0.prescription.surfaces.map((x, i) => (i === last ? { ...x, thickness: x.thickness + dz } : x)),
        },
      };
      const g = geometricPsf(s1, 0, L, { ...EXIT, source, pupilSamples: 64, padFactor: 4 });
      const na = imageNumericalAperture(s0, L);
      const halfBlurMm = (dz * na) / Math.sqrt(1 - na * na) / 2;
      const c = g.size / 2;
      let hin = 0;
      let htot = 0;
      for (let y = 0; y < g.size; y++) {
        for (let x = 0; x < g.size; x++) {
          const v = g.intensity[y * g.size + x]!;
          htot += v;
          if (Math.hypot(x - c, y - c) * g.pixelScaleMm <= halfBlurMm) hin += v;
        }
      }
      // 0.20665 against 0.20625 (emitter): the histogram's pixel edge on a 41-pixel
      // radius, as § 2i.4 measured it. A transmitted field's wave branch has carried
      // each component's own power since § 2n, and its ray branch still the point's
      // irradiance: 0.30053 against 0.29741, 3.1e-3 apart — the oil's own
      // sine-condition offence (9.2e-3 at its rim), which the two now read
      // differently. Recorded rather than bounded away; brightfield never blends.
      if (source === "emitter") expect(Math.abs(inside / total - hin / htot)).toBeLessThan(1.5e-3);
      else expect(inside / total - hin / htot).toBeCloseTo(3.12e-3, 4);
    },
    180_000,
  );
});

describe("§ 2j.4 — the irradiance is the light's, not the aim's", () => {
  // A singlet with its stop 20 mm behind it, at 5°: the paraxial aim and the
  // real one send a pupil coordinate to points 1.3e-2 apart in the exit
  // coordinate, and the irradiance there is 4.8% higher on one side than the
  // other. The two must still draw one irradiance, up to its overall scale —
  // the real aim's S is the solved target's own Jacobian, normalized at its
  // own chief ray.
  const lens = (rayAiming: "paraxial" | "real"): OpticalSystem => ({
    prescription: {
      surfaces: [
        { kind: "refract", curvature: 1 / 100, semiAperture: 20, thickness: 5, medium: "N-BK7" },
        { kind: "refract", curvature: -1 / 100, semiAperture: 20, thickness: 20, medium: "AIR" },
        { kind: "refract", curvature: 0, semiAperture: 3, thickness: 77, medium: "AIR", isStop: true },
      ],
    },
    aperture: { kind: "stopRadius", value: 3 },
    field: { kind: "angle", values: [0, 5] },
    wavelengths: [{ nm: L, weight: 1 }],
    conjugate: { kind: "infinite" },
    rayAiming,
  });

  it("at 5° the real aim and the paraxial one agree to 4e-5 where they land 1.3e-2 apart", () => {
    const [paraxial, real] = (["paraxial", "real"] as const).map((k) => {
      const s = lens(k);
      return laidPupil(s, opdMap(s, 5, L, pupilGrid(21)), EXIT).density!;
    });
    let worst = 0;
    for (const r of [0, 0.3, 0.6, 0.85]) {
      for (const t of [0, 1.1, 2.5, 4]) {
        const x = r * Math.cos(t);
        const y = r * Math.sin(t);
        const a = paraxial!.amplitude(x, y) / paraxial!.amplitude(0, 0);
        const b = real!.amplitude(x, y) / real!.amplitude(0, 0);
        worst = Math.max(worst, Math.abs(b / a - 1));
      }
    }
    let apart = 0;
    for (let k = 0; k < paraxial!.nodes.length; k++) {
      const p = paraxial!.nodes[k]!;
      const q = real!.nodes[k]!;
      apart = Math.max(apart, Math.hypot(p.ex - q.ex, p.ey - q.ey));
    }
    const lopsided = paraxial!.amplitude(0.8, 0) ** 2 / paraxial!.amplitude(-0.8, 0) ** 2;
    expect(apart).toBeGreaterThan(1e-2);
    expect(Math.abs(lopsided - 1)).toBeGreaterThan(0.04);
    expect(worst).toBeLessThan(2e-4);
  });
});
