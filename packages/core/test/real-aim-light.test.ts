import { describe, it, expect } from "vitest";
import { collectedPower } from "./support/collected-power";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
} from "../src/designs/microscope";
import { listerObjective } from "../src/designs/lister";
import { oilImmersionObjective } from "../src/designs/immersion";
import { objectFieldTile, fieldPupilAt } from "../src/imaging/object-field";
import { incoherentPsf } from "../src/imaging/fluorescence";
import { canonicalApertureSine } from "../src/pupil/opd";
import { asCompiled } from "../src/trace/compile";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 2z.3 — the reading: an emitter's light under real aiming is the power the
 * stop passes.
 *
 * The hypothesis was committed before any of this was read (§ 2z). The engine's
 * light is `incoherentPsf`'s `energy` on the exit layout, turned into a fraction
 * of what an isotropic emitter sends out by § 2n's units — the exit density is
 * p(θ)·|∂c/∂e| with c = n·(L, M)/ν, so Σ over the cells, each (2/PS)² of
 * coordinate, is π·PS²·n²·P/ν². The referee (`support/collected-power`) counts
 * the same P in object-space directions with no pupil coordinate in it, at the
 * object point the tile's centre looks at (a tile is placed in IMAGE mm).
 */

const PS = 128;
const SIZE = 256;
const BOUND = 2e-5;

const din = (numericalAperture: number, fieldNumberMm?: number) =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({
      magnification: 4,
      numericalAperture,
      ...(fieldNumberMm === undefined ? {} : { fieldNumberMm }),
    }),
  }).system;
const infinity = (objective: Parameters<typeof infinityCorrectedMicroscope>[0]["objective"]) =>
  infinityCorrectedMicroscope({ objective, tubeLens: tubeLens({ focalLengthMm: 200 }), infinitySpaceMm: 100 })
    .system;

const DIN_010 = din(0.1);
const DIN_010_FN = din(0.1, 18);
const INF_4X = infinity(
  microscopeObjective({ magnification: 4, numericalAperture: 0.1, tubeFocalLengthMm: 200, fieldNumberMm: 18 }),
);
const LISTER = infinity(listerObjective({ magnification: 40, numericalAperture: 0.2, tubeFocalLengthMm: 200 }));

const paraxial = (s: OpticalSystem): OpticalSystem => ({ ...s, rayAiming: "paraxial" });

/** The engine's emitter light on the tile centred at image height `tileMm`, as a fraction of 4π. */
function engineLight(system: OpticalSystem, tileMm: number, nm: number): { light: number; objectMm: number } {
  const frame = objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PS,
    wavelengthNm: nm,
    centreMm: { x: tileMm, y: 0 },
    layout: "exit",
  });
  const energy = incoherentPsf(fieldPupilAt(system, frame, 0.5, 0.5).pupil, {
    pupilSamples: PS,
    size: SIZE,
    edgeSamples: 8,
    edgeRule: "crossing",
  }).energy;
  const nu = canonicalApertureSine(system, nm);
  const n = Math.abs(asCompiled(system.prescription).indices(nm)[0]!);
  return {
    light: (energy * nu * nu) / (Math.PI * n * n * PS * PS),
    objectMm: Math.hypot(frame.centreObjectMm.x, frame.centreObjectMm.y),
  };
}

const off = (system: OpticalSystem, tileMm: number, nm: number) => {
  const e = engineLight(system, tileMm, nm);
  return e.light / collectedPower(system, e.objectMm, nm, { azimuths: 1024 }) - 1;
};

describe("§ 2z.3 — under real aiming an emitter's light is the power the stop passes", () => {
  const D_LINE = DIN_010.wavelengths[0]!.nm;

  it("the DIN 4×/0.10, un-field-sized, at 550 nm and at its design wavelength", () => {
    for (const nm of [550, D_LINE]) {
      for (const tile of [0, 2.25, 4.5, 6, 9]) {
        const d = off(DIN_010, tile, nm);
        console.log(`DIN_010 ${nm} ${tile} ${d.toExponential(3)}`);
        expect(Math.abs(d), `${nm} nm, ${tile} mm`).toBeLessThan(BOUND);
      }
    }
  });

  it("the DIN 4×/0.10 sized for FN 18", () => {
    for (const nm of [550, D_LINE]) {
      for (const tile of [0, 2.25, 4.5, 6, 9]) {
        const d = off(DIN_010_FN, tile, nm);
        console.log(`DIN_010_FN ${nm} ${tile} ${d.toExponential(3)}`);
        expect(Math.abs(d), `${nm} nm, ${tile} mm`).toBeLessThan(BOUND);
      }
    }
  });

  it("the infinity 4×/0.10 and the Lister 40×/0.20", () => {
    // The Lister's 9 mm tile (its field edge, 0.226 mm of object) is left out:
    // a downstream aperture cuts 1.9% of that pupil inside the stop's outline,
    // and the light read there moves with the lattice under EITHER aim —
    // −4.3e-6, −4.7e-5, −2.7e-4 at 64/128/256 real, a 3.8e-4 drift paraxial.
    // Refuted there, and not by the aim (register item 46).
    for (const [name, sys, tiles] of [
      ["INF_4X", INF_4X, [0, 2.25, 9]],
      ["LISTER", LISTER, [0, 0.225]],
    ] as const) {
      const nm = sys.wavelengths[0]!.nm;
      for (const tile of tiles) {
        const d = off(sys, tile, nm);
        console.log(`${name} ${nm} ${tile} ${d.toExponential(3)}`);
        expect(Math.abs(d), `${name} ${tile} mm`).toBeLessThan(BOUND);
      }
    }
  });

  it("the paraxial aim is short on the 4×/0.10's axis — the negative control", () => {
    const nm = D_LINE;
    const d = engineLight(paraxial(DIN_010), 0, nm).light / collectedPower(DIN_010, 0, nm, { azimuths: 1024 }) - 1;
    console.log(`paraxial DIN_010 axis ${d.toExponential(4)}`);
    expect(d).toBeLessThan(-5e-3);
  });

  it("the overfilled 4×/0.15 does not move; the 4×/0.20, refuting the hypothesis, does", () => {
    const d15 = din(0.15, 18);
    const nm15 = d15.wavelengths[0]!.nm;
    const moved15 = engineLight(d15, 0, nm15).light / engineLight(paraxial(d15), 0, nm15).light - 1;
    console.log(`DIN 4x/0.15 real/paraxial ${moved15.toExponential(3)}`);
    expect(Math.abs(moved15)).toBeLessThan(BOUND);

    // Predicted not to move, since the stop clipped the overfill. On the paraxial
    // stop (7.853 mm) it moved 1.1e-4 toward the referee, and the real aim's miss
    // fell as the lattice's square (1.2e-4, 3.0e-5, 6.8e-6 at 64/128/256). That
    // stop delivered NA 0.1895, not 0.20; sized by the real ray (§ 2z.5) it is
    // 8.570 mm, and there the stop-to-direction map's slope halves toward the
    // rim (0.223 at the centre, 0.113 at it). The paraxial aim now overfills and
    // reads 7.0e-4 over; the real aim's miss — 7.8e-5, −2.9e-5, −5.5e-5, −6.1e-5
    // at 64/128/256/512 — is a 1/PS² term converging onto the 21-node density
    // lattice's −6.3e-5 (§ 2aa, register item 47).
    const d20 = din(0.2);
    const nm = d20.wavelengths[0]!.nm;
    const real = off(d20, 0, nm);
    const parax = engineLight(paraxial(d20), 0, nm).light / collectedPower(d20, 0, nm, { azimuths: 1024 }) - 1;
    console.log(`DIN 4x/0.20 real ${real.toExponential(3)} paraxial ${parax.toExponential(3)}`);
    expect(real).toBeLessThan(-2e-5);
    expect(real).toBeGreaterThan(-4e-5);
    expect(parax).toBeGreaterThan(5e-4);
  });

  it("on the oil 100×, whose stop is its flat front face, the light does not move at all", () => {
    for (const na of [1.25, 1.4]) {
      const sys = infinity(oilImmersionObjective({ magnification: 100, numericalAperture: na, tubeFocalLengthMm: 200 }));
      const nm = sys.wavelengths[0]!.nm;
      const d = engineLight(sys, 0, nm).light / engineLight(paraxial(sys), 0, nm).light - 1;
      console.log(`oil ${na} real/paraxial ${d.toExponential(3)}`);
      expect(Math.abs(d), `oil ${na}`).toBeLessThan(1e-12);
    }
  });
});
