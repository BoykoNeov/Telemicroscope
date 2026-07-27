import { describe, it, expect } from "vitest";
import {
  PlaneLayer,
  coverslip,
  coverslipIndex,
  plateLongitudinalAberrationMm,
  plateW040Mm,
  plateWavefrontErrorMm,
  stackApparentDistanceMm,
  stackLongitudinalAberrationMm,
  stackW040Mm,
  stackWavefrontErrorMm,
} from "../src/designs/coverslip";
import { LINE_D } from "../src/materials/dispersion";
import { getMedium } from "../src/materials/catalog";
import { Prescription } from "../src/trace/prescription";
import { traceRay } from "../src/trace/sequential";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";

/**
 * Rungs for oil immersion — docs/VALIDATION.md § 6e.
 *
 * § 6d measured a wall: two cemented doublets stop solving near NA 0.35, for two
 * different glass pairs, so it is the FORM and not the glass. The way past it is
 * not a faster doublet — it is to put an element in front that reduces the
 * aperture *without adding aberration*, which is only possible at a surface's
 * aplanatic conjugates. § 6d.1 already pinned that closed form and used it for
 * nothing. This step uses it.
 *
 * § 6e.1 comes first and needs no lens: the plane STACK an immersion objective
 * actually looks through — cover glass, fluid, the flat underside of the front
 * element — as the exact N-layer generalisation of § 6c's single plate. Like
 * § 6c it is solvable to all orders from Snell alone, which makes it the same
 * unusually strong kind of pin, and it carries the identity the whole immersion
 * idea rests on: an index-MATCHED stack aberrates exactly zero, at any aperture.
 */

const LAMBDA = LINE_D;

const SLIP = coverslip();
const N_SLIP = coverslipIndex(SLIP, LAMBDA);
const T_SLIP = SLIP.thicknessMm;
const N_OIL = getMedium("IMMERSION-OIL").n(LAMBDA);
const N_GLASS = getMedium("N-BK7").n(LAMBDA);
const N_AIR = 1;

/** The real triad a 100×/1.25 oil objective looks through, in order. */
const GAP_MM = 0.02;
const T_FRONT_MM = 0.64;
const REAL_STACK: readonly PlaneLayer[] = [
  { thicknessMm: T_SLIP, n: N_SLIP },
  { thicknessMm: GAP_MM, n: N_OIL },
  { thicknessMm: T_FRONT_MM, n: N_GLASS },
];

/** The same three thicknesses, every layer at the front element's index. */
const MATCHED_STACK: readonly PlaneLayer[] = REAL_STACK.map((l) => ({
  thicknessMm: l.thicknessMm,
  n: N_GLASS,
}));

const MARECHAL = 1 / 14;

/**
 * Balanced RMS wavefront error, in waves, of a stack at object-space aperture
 * `NA` — the currency Maréchal is stated in, and the one § 6c was careful to
 * separate from the peak W.
 *
 * The pupil coordinate is ρ = q/NA, which is the sine-condition mapping: an
 * aplanatic system maps object-space n·sinu linearly onto pupil radius, so equal
 * steps in q ARE equal steps in ρ. Sampling uniformly in ρ² rather than in ρ is
 * how the 2ρdρ area weight is carried without a weighted sum. Piston and defocus
 * are projected out by least squares in {1, ρ²} — `analysis/tolerance`'s
 * compensator move done by hand, exactly as § 6c's `balancedRms` does it, so the
 * comparison stays against the closed form rather than against another module.
 */
function balancedSigmaWaves(
  layers: readonly PlaneLayer[],
  nOut: number,
  NA: number,
  samples = 4001,
): number {
  const rows: { r2: number; w: number }[] = [];
  for (let i = 1; i <= samples; i++) {
    const r2 = (i - 0.5) / samples;
    rows.push({
      r2,
      w: stackWavefrontErrorMm(layers, nOut, Math.sqrt(r2) * NA) / (LAMBDA * 1e-6),
    });
  }
  let s00 = 0, s01 = 0, s11 = 0, r0 = 0, r1 = 0;
  for (const r of rows) {
    s00 += 1;
    s01 += r.r2;
    s11 += r.r2 * r.r2;
    r0 += r.w;
    r1 += r.r2 * r.w;
  }
  const det = s00 * s11 - s01 * s01;
  const c0 = (r0 * s11 - r1 * s01) / det;
  const c1 = (s00 * r1 - s01 * r0) / det;
  let acc = 0;
  for (const r of rows) acc += (r.w - c0 - c1 * r.r2) ** 2;
  return Math.sqrt(acc / rows.length);
}

describe("§ 6e.1 — the plane stack: § 6c's plate, exactly, at N layers", () => {
  it("REDUCES to § 6c: one layer emerging into air is the single-plate form", () => {
    // The rationalised N-layer expressions collapse term for term onto § 6c's
    // single-plate ones — the reduction is an algebraic IDENTITY, so the claim
    // here is not "close" but "the same number to the last bits f64 has". What
    // stops it being bit-exact is only the order the same factors are multiplied
    // in (t·q·q·X against t·s²·X, and so on): measured at 4 ULP, and the bound
    // below is stated in ULP for that reason rather than as a physical tolerance.
    // A genuine error in the generalisation is a relative 1e-3 or worse — the
    // (nᵢ²−n_out²) factor, the emergent-root pairing — and none of it can hide
    // under four ulps.
    const ulps = (a: number, b: number): number =>
      Math.abs(a - b) / (Math.max(Math.abs(a), Math.abs(b)) * Number.EPSILON);
    const one: readonly PlaneLayer[] = [{ thicknessMm: T_SLIP, n: N_SLIP }];
    for (const q of [0.05, 0.25, 0.5, 0.75, 0.9, 0.95]) {
      expect(
        ulps(stackLongitudinalAberrationMm(one, N_AIR, q), plateLongitudinalAberrationMm(T_SLIP, N_SLIP, q)),
      ).toBeLessThanOrEqual(4);
      expect(
        ulps(stackWavefrontErrorMm(one, N_AIR, q), plateWavefrontErrorMm(T_SLIP, N_SLIP, q)),
      ).toBeLessThanOrEqual(4);
      expect(ulps(stackW040Mm(one, N_AIR, q), plateW040Mm(T_SLIP, N_SLIP, q))).toBeLessThanOrEqual(4);
    }
    // And the paraxial half: apparent depth, per § 6c.
    expect(stackApparentDistanceMm(one, N_AIR)).toBeCloseTo(T_SLIP / N_SLIP, 15);
  });

  it("a MATCHED stack aberrates exactly zero — an identity, not a small number", () => {
    // The physical claim immersion rests on: index-match the fluid to the cover
    // glass and the front element and 0.83 mm of glass in the steepest cone in
    // the instrument becomes optically invisible. Every summand carries
    // (nᵢ² − n_out²) as a factor, so this is a HARD zero at every aperture —
    // including q = 1.4, where a single unmatched plate of the same thickness
    // would be catastrophic.
    for (const q of [0.1, 0.6, 1.0, 1.25, 1.4, 1.5]) {
      expect(stackLongitudinalAberrationMm(MATCHED_STACK, N_GLASS, q)).toBe(0);
      expect(stackWavefrontErrorMm(MATCHED_STACK, N_GLASS, q)).toBe(0);
      expect(stackW040Mm(MATCHED_STACK, N_GLASS, q)).toBe(0);
    }
    // Paraxially it is the bare geometric thickness — no apparent-depth shift at
    // all, because there is no interface left to shift anything.
    const total = MATCHED_STACK.reduce((a, l) => a + l.thicknessMm, 0);
    expect(stackApparentDistanceMm(MATCHED_STACK, N_GLASS)).toBeCloseTo(total, 14);
  });

  it("NEGATIVE CONTROL: the same stack DRY is ruinous at the same aperture", () => {
    // Take the oil away — replace the fluid layer with air — and ask for the
    // largest aperture that still propagates. It is q < 1 by definition now, and
    // even at q = 0.95 the wavefront error is enormous, which is the entire
    // reason the fluid is there. Quoted in waves at the d line.
    const dry: readonly PlaneLayer[] = [
      { thicknessMm: T_SLIP, n: N_SLIP },
      { thicknessMm: GAP_MM, n: N_AIR },
    ];
    const waves = stackWavefrontErrorMm(dry, N_AIR, 0.95) / (LAMBDA * 1e-6);
    expect(waves).toBeGreaterThan(20);
    // And it does not propagate at all past q = 1: air is the limit.
    expect(() => stackWavefrontErrorMm(dry, N_AIR, 1.05)).toThrow(/total internal reflection/);
  });

  it("the REAL triad spends most of the error budget on ITSELF at NA 1.25", () => {
    // Cargille Type B (1.51512), D 263 T eco (1.52330) and N-BK7 (1.51680) are
    // all "1.515 glass" and all different in the third decimal, and the stack
    // they make is not free. Quoted as balanced σ, which is the currency
    // Maréchal is stated in — the peak W is 0.59 waves at NA 1.25 and comparing
    // THAT to λ/14 would be comparing two different quantities, § 6c's warning.
    expect(N_OIL).not.toBe(N_GLASS);
    expect(N_SLIP).not.toBe(N_GLASS);
    const sigma = (NA: number) => balancedSigmaWaves(REAL_STACK, N_GLASS, NA);

    // NA 0.95 — a dry objective's ceiling — is comfortable: 14% of budget.
    expect(sigma(0.95)).toBeLessThan(0.2 * MARECHAL);
    // NA 1.25 is the finding. It is INSIDE Maréchal, and only just: the stack
    // alone eats 91% of the whole diffraction-limited budget, leaving 9% for the
    // objective that has to look through it. "Inside the limit" and "affordable"
    // are not the same statement, and this is where they part.
    expect(sigma(1.25)).toBeLessThan(MARECHAL);
    expect(sigma(1.25) / MARECHAL).toBeGreaterThan(0.88);
    // NA 1.4 is outside it by 2.9×, on the stack alone.
    expect(sigma(1.4) / MARECHAL).toBeGreaterThan(2.8);
    expect(sigma(1.4) / MARECHAL).toBeLessThan(3.0);

    // WHICH layer it is matters, and it is not the one the folklore blames. The
    // 0.17 mm cover glass dominates; the 0.02 mm fluid film is a thin correction
    // of the OPPOSITE sign (it is rarer than the front element) and buys back
    // only a few percent.
    const slipOnly: readonly PlaneLayer[] = [REAL_STACK[0]!];
    const oilOnly: readonly PlaneLayer[] = [REAL_STACK[1]!];
    expect(stackWavefrontErrorMm(slipOnly, N_GLASS, 1.25)).toBeGreaterThan(0);
    expect(stackWavefrontErrorMm(oilOnly, N_GLASS, 1.25)).toBeLessThan(0);
    expect(sigma(1.25)).toBeLessThan(balancedSigmaWaves(slipOnly, N_GLASS, 1.25));

    // The lever that helps most is a DESIGN choice, not a better fluid: build
    // the front element from the cover glass's own borosilicate and the dominant
    // layer's (nᵢ²−n_out²) collapses entirely. Worth 6.5× — and NOT more, which
    // is the interesting half. Moving the front element onto the slip moves it
    // OFF the oil (Δn 0.0017 → 0.0082), so the thin film's contribution grows by
    // nearly five as the thick slip's vanishes. There is no single index that
    // matches both, and that three-way compromise is the constraint the whole
    // business of specifying immersion fluid to four decimals exists to fight.
    const d263Front: readonly PlaneLayer[] = REAL_STACK.map((l, i) =>
      i === 2 ? { thicknessMm: l.thicknessMm, n: N_SLIP } : l,
    );
    const matched = balancedSigmaWaves(d263Front, N_SLIP, 1.25);
    const gain = sigma(1.25) / matched;
    expect(gain).toBeGreaterThan(6);
    expect(gain).toBeLessThan(7);
    // And it is the bench that leaves room to build a lens: 14% of the budget at
    // NA 1.25 and still inside it at 1.4, where the N-BK7 front is 2.9× outside.
    expect(matched / MARECHAL).toBeLessThan(0.15);
    expect(balancedSigmaWaves(d263Front, N_SLIP, 1.4)).toBeLessThan(MARECHAL);

    // The front element's OWN layer contributes nothing: it is the emergent
    // medium, so its (nᵢ²−n_out²) is identically zero however thick it is.
    const withoutFront = REAL_STACK.slice(0, 2);
    expect(stackWavefrontErrorMm(withoutFront, N_GLASS, 1.25)).toBe(
      stackWavefrontErrorMm(REAL_STACK, N_GLASS, 1.25),
    );
  });

  it("higher orders DOMINATE the stack at immersion apertures", () => {
    // § 6c could quote W₀₄₀ and be nearly right, because a dry objective's NA
    // caps at 1. An immersion stack does not have that excuse: at NA 1.25 the
    // exact wavefront is 2.9× the third-order coefficient and at 1.4 it is 5.3×.
    // Anything that toleranced an immersion stack on W₀₄₀ alone would be wrong
    // by a factor of five, in the safe-looking direction.
    const ratio = (q: number) =>
      stackWavefrontErrorMm(REAL_STACK, N_GLASS, q) / stackW040Mm(REAL_STACK, N_GLASS, q);
    expect(ratio(0.5)).toBeGreaterThan(1.1);
    expect(ratio(0.5)).toBeLessThan(1.2);
    expect(ratio(1.25)).toBeGreaterThan(2.8);
    expect(ratio(1.4)).toBeGreaterThan(5.2);
  });

  it("the SIGN follows the contrast: denser layers aberrate one way, rarer the other", () => {
    const denser: readonly PlaneLayer[] = [{ thicknessMm: 0.1, n: N_GLASS + 0.05 }];
    const rarer: readonly PlaneLayer[] = [{ thicknessMm: 0.1, n: N_GLASS - 0.05 }];
    expect(stackWavefrontErrorMm(denser, N_GLASS, 1.0)).toBeGreaterThan(0);
    expect(stackWavefrontErrorMm(rarer, N_GLASS, 1.0)).toBeLessThan(0);
    expect(stackLongitudinalAberrationMm(denser, N_GLASS, 1.0)).toBeGreaterThan(0);
    expect(stackLongitudinalAberrationMm(rarer, N_GLASS, 1.0)).toBeLessThan(0);
    // So a stack can be balanced against ITSELF — the D 263 slip is denser than
    // N-BK7 and the Type B oil is rarer, and they partly cancel. Measured: the
    // real triad's error is well under the slip's own contribution alone.
    const slipOnly: readonly PlaneLayer[] = [REAL_STACK[0]!];
    expect(Math.abs(stackWavefrontErrorMm(REAL_STACK, N_GLASS, 1.25))).toBeLessThan(
      Math.abs(stackWavefrontErrorMm(slipOnly, N_GLASS, 1.25)),
    );
  });

  it("the third-order coefficient IS the small-aperture limit of the exact form", () => {
    // Same discipline as § 6c: W₀₄₀ is the leading term, and the exact form must
    // walk onto it as q → 0 and away from it at real apertures. Both halves are
    // the rung; only the second one would catch a wrong higher-order term.
    const near = stackWavefrontErrorMm(REAL_STACK, N_GLASS, 0.01);
    expect(near / stackW040Mm(REAL_STACK, N_GLASS, 0.01)).toBeCloseTo(1, 4);
    const far = stackWavefrontErrorMm(REAL_STACK, N_GLASS, 1.4);
    expect(Math.abs(far / stackW040Mm(REAL_STACK, N_GLASS, 1.4) - 1)).toBeGreaterThan(0.1);
  });
});

describe("§ 6e.1 — the stack against the EXACT TRACER", () => {
  /**
   * The real triad as a prescription: specimen under the slip, oil above it, the
   * front element's flat underside above that, and a zero-power reference plane
   * to stop the trace on so the accumulated OPL is the path to a known plane.
   */
  const stackChain: Prescription = {
    objectMedium: SLIP.medium,
    surfaces: [
      { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: GAP_MM, medium: "IMMERSION-OIL" },
      { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: T_FRONT_MM, medium: "N-BK7" },
      { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: 0, medium: "N-BK7" },
    ],
  };
  /** Exit plane, measured from the specimen. */
  const Z_EXIT = GAP_MM + T_FRONT_MM;
  const D_PARAXIAL = stackApparentDistanceMm(REAL_STACK, N_GLASS);

  /** Trace the ray of invariant q from the specimen, inside the slip. */
  function trace(q: number) {
    const sinSlip = q / N_SLIP;
    const dir = vec3(sinSlip, 0, Math.sqrt(1 - sinSlip * sinSlip));
    const res = traceRay(stackChain, makeRay(vec3(0, 0, -T_SLIP), dir, LAMBDA));
    expect(res.status).toBe("ok");
    return { ray: res.ray!, opl: res.opl };
  }

  const APERTURES = [0.2, 0.6, 0.9, 1.1, 1.25, 1.4] as const;

  it("the traced axial crossing is the closed-form LSA, to all orders", () => {
    for (const q of APERTURES) {
      const { ray } = trace(q);
      // Distance in FRONT of the exit plane at which the emergent ray's line
      // meets the axis.
      const crossing = Z_EXIT - (ray.origin.z - (ray.origin.x * ray.dir.z) / ray.dir.x);
      expect(D_PARAXIAL - crossing).toBeCloseTo(
        stackLongitudinalAberrationMm(REAL_STACK, N_GLASS, q),
        12,
      );
    }
  });

  it("the traced WAVEFRONT is the closed-form W, to all orders", () => {
    // Built from the tracer's own accumulated optical path and the geometry of
    // the emergent ray — the reference is the paraxial image point, and the
    // axial ray's value is subtracted so the piston is gone. Nothing here
    // consults the closed form until the comparison.
    const zP = Z_EXIT - D_PARAXIAL;
    const measure = (q: number): number => {
      const { ray, opl } = trace(q);
      const rz = ray.origin.z - zP;
      const rx = ray.origin.x;
      const dot = (rx * ray.dir.x + rz * ray.dir.z) / Math.hypot(ray.dir.x, ray.dir.z);
      return opl - N_GLASS * dot;
    };
    const axial = measure(1e-9);
    for (const q of APERTURES) {
      expect(measure(q) - axial).toBeCloseTo(
        stackWavefrontErrorMm(REAL_STACK, N_GLASS, q),
        12,
      );
    }
  });

  it("POSITIVE CONTROL: matched media leave the traced wavefront flat", () => {
    // The same chain with the fluid and the slip replaced by the front element's
    // own glass. Not "small" — the exact tracer, at q = 1.4, through 0.83 mm of
    // glass, returns the axial ray's own optical path to f64's last digits.
    const matched: Prescription = {
      objectMedium: "N-BK7",
      surfaces: stackChain.surfaces.map((s) => ({ ...s, medium: "N-BK7" })),
    };
    const crossingOf = (q: number): number => {
      const sinG = q / N_GLASS;
      const dir = vec3(sinG, 0, Math.sqrt(1 - sinG * sinG));
      const res = traceRay(matched, makeRay(vec3(0, 0, -T_SLIP), dir, LAMBDA));
      expect(res.status).toBe("ok");
      const r = res.ray!;
      return r.origin.z - (r.origin.x * r.dir.z) / r.dir.x;
    };
    const paraxial = crossingOf(1e-9);
    for (const q of [0.6, 1.0, 1.25, 1.4]) {
      expect(Math.abs(crossingOf(q) - paraxial)).toBeLessThan(1e-13);
    }
    // …and it is the geometric object plane, not an apparent one.
    expect(paraxial).toBeCloseTo(-T_SLIP, 12);
  });
});
