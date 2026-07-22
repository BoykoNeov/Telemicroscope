import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem, simpleSystem } from "../src/trace/system";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid, pupilFan } from "../src/pupil/aiming";
import { LINE_D } from "../src/materials/dispersion";

/**
 * OPD is the wave layer's only input, so these rungs pin the exit-pupil
 * reference sphere to physics rather than to the engine's own output.
 */

const R = -200; // concave mirror facing the incoming light; focus at R/2
const APERTURE = 10; // semi-aperture, mm -> NA = 10/100 = 0.1

function mirror(conic: number, imageOffset?: number): OpticalSystem {
  const prescription: Prescription = {
    surfaces: [
      {
        kind: "reflect",
        curvature: 1 / R,
        conic,
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
    ...(imageOffset === undefined ? {} : { imageSurface: { offsetFromLastVertex: imageOffset } }),
  };
}

describe("Fermat: a paraboloid has zero OPD at its focus", () => {
  it("OPD is flat across the pupil to far better than a thousandth of a wave", () => {
    const map = opdMap(mirror(-1), 0, LINE_D, pupilGrid(21));
    expect(map.samples.length).toBeGreaterThan(200);
    expect(map.lost).toBe(0);
    for (const s of map.samples) {
      expect(Math.abs(s.waves)).toBeLessThan(1e-3);
    }
    expect(map.rmsWaves).toBeLessThan(1e-4);
  });

  it("the image point is the paraboloid's focus", () => {
    const map = opdMap(mirror(-1), 0, LINE_D, pupilFan(5));
    expect(map.imagePoint.z).toBeCloseTo(R / 2, 9);
    expect(map.imagePoint.x).toBeCloseTo(0, 9);
  });

  it("a SPHERE at the same focus is not flat (the test can fail)", () => {
    const map = opdMap(mirror(0), 0, LINE_D, pupilGrid(21));
    // Spherical aberration at NA 0.1 is a fraction of a wave — small, but
    // enormous compared with the paraboloid's 1e-4.
    expect(map.rmsWaves).toBeGreaterThan(1e-2);
  });
});

/**
 * Rung: longitudinal defocus produces a known wavefront error. For a beam of
 * numerical aperture NA, shifting the image plane by δ gives
 *   W(ρ) = ½·δ·NA²·ρ²   (peak-to-valley ½·δ·NA² at the rim).
 * This is the leading term of an NA expansion, so the comparison is made at
 * small NA and the tolerance below is set by the NEXT term (order NA⁴/NA² ≈
 * 1% here) — not by the implementation's convenience.
 */
describe("defocus OPD matches the closed-form coefficient", () => {
  const NA = APERTURE / Math.abs(R / 2); // 0.1

  for (const delta of [0.02, 0.05, 0.1]) {
    it(`δ = ${delta} mm gives ½·δ·NA² of edge OPD`, () => {
      // Light travels −z after the mirror, so a defocus further along the beam
      // is a more negative image-plane offset.
      const defocused = mirror(-1, R / 2 - delta);
      const map = opdMap(defocused, 0, LINE_D, pupilFan(41));

      const edge = map.samples.reduce((a, b) => (Math.abs(b.px) > Math.abs(a.px) ? b : a));
      const centre = map.samples.reduce((a, b) => (Math.abs(b.px) < Math.abs(a.px) ? b : a));

      const measuredMm = Math.abs(edge.waves - centre.waves) * (LINE_D * 1e-6);
      const expectedMm = 0.5 * delta * NA * NA;

      expect(measuredMm).toBeGreaterThan(expectedMm * 0.99);
      expect(measuredMm).toBeLessThan(expectedMm * 1.01);
    });
  }

  it("defocus OPD is quadratic in the pupil coordinate", () => {
    const map = opdMap(mirror(-1, R / 2 - 0.05), 0, LINE_D, pupilFan(41));
    const centre = map.samples.reduce((a, b) => (Math.abs(b.px) < Math.abs(a.px) ? b : a));
    const at = (target: number) =>
      map.samples.reduce((a, b) =>
        Math.abs(Math.abs(b.px) - target) < Math.abs(Math.abs(a.px) - target) ? b : a,
      );
    const half = Math.abs(at(0.5).waves - centre.waves);
    const full = Math.abs(at(1.0).waves - centre.waves);
    // W ∝ ρ² ⇒ the half-pupil value is a quarter of the rim value.
    expect(full / half).toBeGreaterThan(3.9);
    expect(full / half).toBeLessThan(4.1);
  });
});

/**
 * Rung: OFF-AXIS OPD. The on-axis rungs above are rotationally symmetric and
 * therefore cannot exercise the off-axis reference-sphere convention — the
 * sphere centred on the real chief ray's image point, with a chief ray that is
 * itself tilted. This pins it against third-order aberration theory, where
 * coma is LINEAR in field angle and CUBIC in pupil radius:
 *   W_coma(ρ, θ) = W₁₃₁ · θ · ρ³ · cos φ
 * The odd (antisymmetric) part of the meridional fan isolates it, because
 * referencing to the chief ray already removes piston and tilt.
 */
describe("off-axis OPD: coma follows third-order theory", () => {
  const singlet: Prescription = {
    surfaces: [
      {
        kind: "refract",
        curvature: 1 / 51.68,
        semiAperture: 10,
        thickness: 4,
        medium: "N-BK7",
        isStop: true,
      },
      { kind: "refract", curvature: 0, semiAperture: 10, thickness: 97.9, medium: "AIR" },
    ],
  };
  const sys = simpleSystem(singlet, { kind: "stopRadius", value: 6 }, LINE_D);

  const nearest = (map: ReturnType<typeof opdMap>, target: number) =>
    map.samples.reduce((a, b) => (Math.abs(b.px - target) < Math.abs(a.px - target) ? b : a));
  const oddPart = (map: ReturnType<typeof opdMap>, rho: number) =>
    (nearest(map, rho).waves - nearest(map, -rho).waves) / 2;

  const fields = [0.5, 1, 1.5, 2];
  const maps = fields.map((f) => opdMap(sys, f, LINE_D, pupilFan(81)));

  it("is identically zero on axis, by symmetry", () => {
    const onAxis = opdMap(sys, 0, LINE_D, pupilFan(81));
    expect(Math.abs(oddPart(onAxis, 1))).toBeLessThan(1e-12);
  });

  it("grows linearly with field angle", () => {
    const perDegree = maps.map((m, i) => oddPart(m, 1) / fields[i]!);
    // Third order is the LEADING term; the residual spread is the fifth-order
    // contribution, which grows as θ³ — that bounds the tolerance, not taste.
    const min = Math.min(...perDegree.map(Math.abs));
    const max = Math.max(...perDegree.map(Math.abs));
    expect(max / min).toBeLessThan(1.04);
    expect(min).toBeGreaterThan(0.05); // and it is a real, sizeable aberration
  });

  it("grows as the cube of the pupil radius", () => {
    for (const m of maps) {
      const ratio = oddPart(m, 1) / oddPart(m, 0.5);
      // ρ³ ⇒ exactly 8; the small excess is again the fifth-order term.
      expect(ratio).toBeGreaterThan(8.0);
      expect(ratio).toBeLessThan(8.6);
    }
  });

  it("the chief ray lands off axis, and the image point follows it", () => {
    for (let i = 0; i < fields.length; i++) {
      expect(Math.abs(maps[i]!.imagePoint.x)).toBeGreaterThan(0);
      // Paraxially the image height is f·tan θ — monotone in field.
      if (i > 0) {
        expect(Math.abs(maps[i]!.imagePoint.x)).toBeGreaterThan(
          Math.abs(maps[i - 1]!.imagePoint.x),
        );
      }
    }
  });
});

describe("OPD bookkeeping", () => {
  it("vignetted rays are reported as lost, not silently dropped", () => {
    // Aperture wider than the mirror's clear semi-diameter.
    const prescription: Prescription = {
      surfaces: [
        { kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 6, thickness: R / 2, isStop: true },
      ],
    };
    const system: OpticalSystem = {
      ...simpleSystem(prescription, { kind: "stopRadius", value: 10 }, LINE_D),
    };
    const map = opdMap(system, 0, LINE_D, pupilFan(41));
    expect(map.lost).toBeGreaterThan(0);
    expect(map.samples.length + map.lost).toBe(41);
  });

  it("throughput rides along with each OPD sample", () => {
    const map = opdMap(mirror(-1), 0, LINE_D, pupilFan(5));
    for (const s of map.samples) expect(s.throughput).toBeCloseTo(1, 12);
  });
});

/**
 * Rung: OFF-AXIS OPD FOR A MIRROR.
 *
 * Every off-axis rung above uses a refracting singlet. That left a gap this
 * test closes, and the gap was hiding a real defect: the reference sphere is
 * centred on the image point and passes through the chief ray at the
 * exit-pupil PLANE, so the flat plane and the curved sphere straddle each
 * other — and off axis the sphere's centre shifts transversely, pushing an
 * entire side of the pupil INSIDE it.
 *
 * For a point inside a sphere the only forward intersection is the far one,
 * beyond the focus. Taking it added a full sphere diameter of spurious path —
 * 200 mm, or 3.4·10⁵ waves — to half the pupil. On axis every point lands
 * outside and the two readings agree, which is exactly why the symmetric rungs
 * could not see it.
 *
 * A paraboloid is perfect on axis, so at a field angle its wavefront is pure
 * third-order coma: W ∝ θ·ρ³·cos φ. Referencing to the chief ray removes
 * piston and tilt, so the ODD part of a meridional fan isolates the coma —
 * the same construction as the singlet rung above, now on the surface kind
 * that was untested.
 */
describe("off-axis OPD for a mirror follows third-order coma", () => {
  const oddPart = (field: number, rho: number): number => {
    const map = opdMap(mirror(-1), field, LINE_D, pupilFan(41));
    const at = (target: number) =>
      map.samples.reduce((a, b) =>
        Math.abs(b.px - target) < Math.abs(a.px - target) ? b : a,
      ).waves;
    return (at(rho) - at(-rho)) / 2;
  };

  it("is bounded by a wave or so — not by the sphere's diameter", () => {
    const map = opdMap(mirror(-1), 1.5, LINE_D, pupilGrid(21));
    // Before the near-crossing fix this was 3.4e5 waves.
    expect(map.rmsWaves).toBeLessThan(2);
    for (const s of map.samples) expect(Math.abs(s.waves)).toBeLessThan(5);
  });

  it("coma is cubic in the pupil coordinate", () => {
    expect(oddPart(1.5, 0.75) / oddPart(1.5, 0.5)).toBeCloseTo((0.75 / 0.5) ** 3, 1);
    expect(oddPart(1.5, 0.5) / oddPart(1.5, 0.25)).toBeCloseTo((0.5 / 0.25) ** 3, 1);
  });

  it("coma is linear in field angle", () => {
    expect(oddPart(1.5, 0.75) / oddPart(0.5, 0.75)).toBeCloseTo(3, 1);
  });

  it("vanishes identically on axis", () => {
    expect(Math.abs(oddPart(0, 0.75))).toBeLessThan(1e-6);
  });
});
