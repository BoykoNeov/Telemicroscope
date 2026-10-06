import { describe, it, expect } from "vitest";
import { defaultPupilLayout, psf, type Psf } from "../src/wave/psf";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { cassegrain } from "../src/designs/cassegrain";
import { ritcheyChretien } from "../src/designs/ritchey";
import { OpticalSystem } from "../src/trace/system";
import { type PhaseScreen } from "../src/wave/seeing";

/**
 * § 2m — the telescope chain on the exit layout.
 *
 * Register item 24 flips the default pupil layout one chain at a time. The
 * telescope chain is every system whose object is at infinity, so the default
 * is now chosen by the conjugate (`defaultPupilLayout`): `"exit"` at infinity,
 * `"aim"` at a finite object until the microscope chains flip.
 *
 * The exit layout reads the transform's ruler off the cone the light actually
 * leaves in, where the aim layout read the paraxial one. On a telescope those
 * differ by the instrument's offence against the sine condition, and for the
 * mirrors that offence is exact geometry:
 *
 * - a paraboloid lays its rays out as h = 2f·tan(u′/2) (its focal property), so
 *   f·sin u′/h = cos²(u′/2), which at the rim is 1/(1 + 1/16F²);
 * - a classical Cassegrain's hyperboloid maps the primary's focal angles as
 *   tan(u′/2) = tan(u/2)/m (the focus-to-focus property of a conic), so the
 *   whole telescope lays its rays out as a paraboloid of the SYSTEM's focal
 *   length does — the geometry behind the textbook statement that a classical
 *   Cassegrain has the coma of a paraboloid at its own focal ratio;
 * - a Ritchey–Chrétien is aplanatic to third order, so its sine is D/2f up to
 *   fifth-order terms.
 */

const NM = 550;
const GRID = { pupilSamples: 64, padFactor: 4 } as const;

function paraboloid(focalRatio: number, apertureMm = 200): OpticalSystem {
  const radius = -2 * focalRatio * apertureMm;
  return {
    prescription: {
      surfaces: [{ kind: "reflect", curvature: 1 / radius, conic: -1, semiAperture: apertureMm, thickness: radius / 2 }],
    },
    aperture: { kind: "EPD", value: apertureMm },
    field: { kind: "angle", values: [0] },
    wavelengths: [{ nm: NM, weight: 1 }],
    conjugate: { kind: "infinite" },
  };
}

/** Traced over paraxial aperture sine: the aim layout's pixel over the exit layout's. */
function ruler(system: OpticalSystem): number {
  return (
    psf(system, 0, NM, { ...GRID, layout: "aim" }).pixelScaleMm / psf(system, 0, NM, { ...GRID, layout: "exit" }).pixelScaleMm
  );
}

const cosSquaredHalfRim = (focalRatio: number) => 1 / (1 + 1 / (16 * focalRatio * focalRatio));

describe("§ 2m.0 — the default follows the conjugate", () => {
  it("exit at an infinite object, aim at a finite one — and unasked is exactly the named layout", () => {
    const telescope = paraboloid(5);
    const finite: OpticalSystem = { ...telescope, conjugate: { kind: "finite", distance: 4000 } };
    expect(defaultPupilLayout(telescope)).toBe("exit");
    expect(defaultPupilLayout(finite)).toBe("aim");
    const opts = { pupilSamples: 32, padFactor: 4 } as const;
    expect(psf(telescope, 0, NM, opts).intensity).toEqual(psf(telescope, 0, NM, { ...opts, layout: "exit" }).intensity);
    expect(psf(finite, 0, NM, opts).intensity).toEqual(psf(finite, 0, NM, { ...opts, layout: "aim" }).intensity);
    // ...and the two layouts are not one, or the two lines above are empty.
    expect(psf(telescope, 0, NM, { ...opts, layout: "aim" }).pixelScaleMm).not.toBe(
      psf(telescope, 0, NM, opts).pixelScaleMm,
    );
  });
});

describe("§ 2m.1 — the ruler is the cone the light leaves in (closed forms)", () => {
  it("a paraboloid's is cos²(u′/2) of its rim: 1/(1 + 1/16F²) at f/3, f/5, f/10", () => {
    for (const F of [3, 5, 10]) {
      expect(Math.abs(ruler(paraboloid(F)) / cosSquaredHalfRim(F) - 1)).toBeLessThan(1e-14);
    }
  });

  it("a classical Cassegrain's is the paraboloid's of the SYSTEM's focal ratio — exact geometry, not third order", () => {
    // f/10 from an f/4 primary: the paraboloid of f/4 would read 0.99611, the
    // telescope reads f/10's 0.99938 to 3e-14.
    const scope = cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 });
    const system: OpticalSystem = {
      prescription: scope.prescription,
      aperture: { kind: "EPD", value: 200 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: NM, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const r = ruler(system);
    expect(Math.abs(r / cosSquaredHalfRim(10) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(r / cosSquaredHalfRim(4) - 1)).toBeGreaterThan(3e-3);
  });

  it("a Ritchey–Chrétien's is the paraxial one to fifth order — the aplanat the Cassegrain is not", () => {
    const scope = ritcheyChretien({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 });
    const system: OpticalSystem = {
      prescription: scope.prescription,
      aperture: { kind: "EPD", value: 200 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: NM, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    // 2.3e-6, against the Cassegrain's 6.2e-4 on the same layout.
    expect(Math.abs(ruler(system) - 1)).toBeLessThan(5e-6);
  });
});

/** A ramp of `a` waves across the entrance RADIUS, along x. */
function rampScreen(a: number, apertureMm: number): PhaseScreen {
  const N = 64;
  const physicalSizeMm = 2 * apertureMm;
  const slope = (a * NM * 1e-6) / (apertureMm / 2);
  const opdMm = new Float64Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) opdMm[iy * N + ix] = slope * ((ix - N / 2) * (physicalSizeMm / N));
  }
  return {
    samples: N,
    physicalSizeMm,
    apertureDiameterMm: apertureMm,
    opdMm,
    friedParamMm: 1,
    refWavelengthNm: 500,
    innerScaleMm: undefined,
  };
}

function centroidXMm(p: Psf): number {
  let sx = 0;
  let s = 0;
  for (let y = 0; y < p.size; y++) {
    for (let x = 0; x < p.size; x++) {
      const v = p.intensity[y * p.size + x]!;
      sx += v * x;
      s += v;
    }
  }
  return (sx / s - p.size / 2) * p.pixelScaleMm;
}

describe("§ 2m.2 — a tilted wavefront is a field angle, and only the exit layout knows it", () => {
  it("the screened star converges on the star at Δθ = aλ/R; the aim layout stalls at the paraboloid's cos²", () => {
    // A ramp of a waves across the entrance radius R is a plane wave arriving
    // Δθ = aλ/R off axis — so the screened on-axis star must land where the
    // unscreened star at Δθ lands: its chief ray's image point plus the comatic
    // centroid that a paraboloid's off-axis image has. Read at f/3, where the
    // two layouts' rulers are 0.69% apart.
    const system = paraboloid(3);
    const R = 100;
    const a = 1;
    const fieldDeg = ((a * NM * 1e-6) / R) * (180 / Math.PI);
    const screen = rampScreen(a, 2 * R);
    const miss = (pupilSamples: number, layout: "aim" | "exit") => {
      const opts = { pupilSamples, padFactor: 4, layout } as const;
      const star = psf(system, fieldDeg, NM, opts);
      const truth = opdMap(system, fieldDeg, NM, pupilGrid(21)).imagePoint.x + centroidXMm(star);
      // Each sign of the ramp, halved: the on-axis star's own few-1e-7 µm
      // centroid then cancels rather than biasing one side.
      const plus = centroidXMm(psf(system, 0, NM, { ...opts, seeing: screen }));
      const minus = centroidXMm(psf(system, 0, NM, { ...opts, seeing: rampScreen(-a, 2 * R) }));
      return (plus - minus) / 2 / truth - 1;
    };
    // Exit: −1.4e-3, −9.1e-4, −4.5e-4 — halving with the grid, as the edge's
    // discretization does.
    const exit = [64, 128, 256].map((ps) => miss(ps, "exit"));
    expect(Math.abs(exit[1]!)).toBeLessThan(Math.abs(exit[0]!));
    expect(Math.abs(exit[2]!)).toBeLessThan(Math.abs(exit[1]!));
    expect(Math.abs(exit[2]!)).toBeLessThan(6e-4);
    // Aim: −8.2e-3, −7.7e-3, −7.3e-3 — converging, but on the paraxial ruler's
    // 1 − cos²(u′/2) = 6.9e-3 short of the star, not on the star.
    for (const ps of [64, 256]) {
      const m = miss(ps, "aim");
      expect(m).toBeLessThan(-(1 - cosSquaredHalfRim(3)));
    }
  }, 120_000);
});
