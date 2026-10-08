import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import type { Prescription } from "../src/trace/prescription";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { aimOrientation, exitApertureSine } from "../src/pupil/opd";
import { paraxialImageOffset, withFocus } from "../src/analysis/focus";

/**
 * § 2q.1 — the traced aperture sine is the system's, not the prescription's.
 *
 * `exitApertureSine` is read once per key and cached on the COMPILED
 * PRESCRIPTION, which two systems share whenever one is spread from the other —
 * `withFocus`, a moved stop, a stopped-down aperture. Until § 2q the key named
 * the wavelength, the conjugate and the aim and nothing else, so the second
 * system read the first one's rim: the exit layout's ruler, its orientation and
 * every pupil laid on it, wrong by the difference between the two rims and
 * silent about it. A refocused DIN 4× reads its rim 0.50% inside the as-built
 * one's, and that is what § 2n read as the refocus excess vanishing (§ 6r.5).
 *
 * The rung is order-independence: a variant read AFTER its base must equal the
 * same variant on a cloned prescription, which no earlier read can have touched
 * — bitwise, because a cache that returns a different number is not a cache.
 * And each variant must differ from its base, or the rung could not fail.
 */

const BASE: OpticalSystem = finiteConjugateMicroscope({
  objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement: "rim" }),
}).system;

const NM = 450;

/** The same system on a prescription no cache has seen. */
const fresh = (system: OpticalSystem): OpticalSystem => {
  const p: Prescription = system.prescription;
  return { ...system, prescription: { ...p, surfaces: p.surfaces.map((s) => ({ ...s })) } };
};

const stopRadius = BASE.aperture.kind === "stopRadius" ? BASE.aperture.value : NaN;

const VARIANTS: readonly (readonly [string, OpticalSystem])[] = [
  ["refocused to 450 nm's paraxial plane", withFocus(BASE, paraxialImageOffset(BASE, NM))],
  ["stop moved onto the front surface", { ...BASE, apertureStop: { kind: "surface", index: 0 } }],
  ["stopped down to 80%", { ...BASE, aperture: { kind: "stopRadius", value: 0.8 * stopRadius } }],
];

describe("§ 2q.1 — the traced aperture sine is the system's, not the prescription's", () => {
  it("a variant read after its base reads what it reads alone, bitwise", () => {
    const base = exitApertureSine(BASE, NM);
    for (const [, variant] of VARIANTS) {
      // The base is read first, so a key that left this variant's difference out
      // would hand back `base` here.
      expect(exitApertureSine(BASE, NM)).toBe(base);
      const after = exitApertureSine(variant, NM);
      const alone = exitApertureSine(fresh(variant), NM);
      expect(Object.is(after, alone)).toBe(true);
      expect(aimOrientation(variant, NM)).toBe(aimOrientation(fresh(variant), NM));
    }
  });

  it("and every variant's rim is its own — the rung is not vacuous", () => {
    const base = exitApertureSine(BASE, NM);
    const moved = VARIANTS.map(([, v]) => Math.abs(exitApertureSine(v, NM) / base - 1));
    // The refocus moves the rim least, and it is the one § 2n met: 0.50%.
    expect(moved[0]).toBeCloseTo(5.035e-3, 6);
    for (const m of moved) expect(m).toBeGreaterThan(1e-3);
  });
});
