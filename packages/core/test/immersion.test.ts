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
import {
  FRONT_ELEMENT_MEDIUM,
  IMMERSION_MEDIUM,
  aplanaticFrontGroup,
  aplanaticMeniscus,
  hyperhemisphere,
} from "../src/designs/immersion";
import { LINE_D } from "../src/materials/dispersion";
import { getMedium } from "../src/materials/catalog";
import { paraxialTrace } from "../src/trace/paraxial";
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

/**
 * §§ 6e.2–6e.3 — the aplanatic front: a dome at its Weierstrass conjugates, then
 * menisci that divide the aperture angle by n apiece.
 *
 * The discipline is a positive/negative control pair rather than a tolerance. An
 * aplanatic surface is exact to ALL orders, so the right assertion is that the
 * traced axial crossing does not move at all across the aperture — and the only
 * thing that makes it move is § 6e.1's index mismatch, which is measured
 * separately and switched off by matching the media. A design that was merely
 * third-order-correct would fail these by six orders of magnitude.
 */

/** Trace at invariant q; where the emergent ray's line meets the axis, and how steep it is. */
function emergentOf(p: Prescription, objectDistanceMm: number, q: number) {
  const n0 = getMedium(p.objectMedium!).n(LAMBDA);
  const sin = q / n0;
  const res = traceRay(
    p,
    makeRay(vec3(0, 0, -objectDistanceMm), vec3(sin, 0, Math.sqrt(1 - sin * sin)), LAMBDA),
  );
  expect(res.status).toBe("ok");
  const r = res.ray!;
  return {
    crossing: r.origin.z - (r.origin.x / r.dir.x) * r.dir.z,
    sinOut: Math.hypot(r.dir.x, r.dir.y) / Math.hypot(r.dir.x, r.dir.y, r.dir.z),
    sinIn: sin,
    hits: res.path,
  };
}

/** Last vertex's z, with surface 0's vertex at the origin. */
const lastVertexZ = (p: Prescription): number =>
  p.surfaces.slice(0, -1).reduce((a, s) => a + s.thickness, 0);

describe("§ 6e.2 — the hyperhemisphere", () => {
  const NA = 1.25;
  const R = 0.5;
  /** Every medium at the front element's own glass: § 6e.1's exact-zero stack. */
  const matched = hyperhemisphere({
    numericalAperture: NA,
    radiusMm: R,
    coverslipSpec: null,
    immersionMedium: FRONT_ELEMENT_MEDIUM,
  });
  /** The real bench: a D 263 slip, a Type B film, a D 263 dome. */
  const real = hyperhemisphere({ numericalAperture: NA, radiusMm: R });
  const N_FRONT = matched.glassIndex;
  const APERTURES = [1e-6, 0.3, 0.6, 0.9, 1.1, 1.25] as const;
  const spreadOf = (p: Prescription, d: number): number => {
    const cs = APERTURES.map((q) => emergentOf(p, d, q).crossing);
    return Math.max(...cs) - Math.min(...cs);
  };

  it("MATCHED: the axial crossing does not move from q = 1e-6 to 1.25", () => {
    // Exactly stigmatic, not stigmatic to third order. The spread below is f64's
    // limit and nothing else — this surface has no aberration to measure.
    expect(spreadOf(matched.prescription, matched.objectDistanceMm)).toBeLessThan(1e-12);
    // …and it lands where the closed form puts it: v = R(n+1) in front of the
    // dome's vertex, read off the trace rather than restated.
    const crossing = emergentOf(matched.prescription, matched.objectDistanceMm, NA).crossing;
    const domeVertexZ = lastVertexZ(matched.prescription);
    expect(domeVertexZ - crossing).toBeCloseTo(R * (N_FRONT + 1), 10);
    expect(matched.virtualImageDistanceMm).toBeCloseTo(R * (N_FRONT + 1), 12);
    // Virtual: in front of the dome, on the specimen's side.
    expect(crossing).toBeLessThan(domeVertexZ);
  });

  it("MATCHED: sinu′/sinu is CONSTANT at 1/n — Abbe, so coma-free too", () => {
    // Stigmatic and aplanatic are different claims. The first is one point
    // imaging to one point; the second is that EVERY zone delivers the same
    // magnification, which is what kills coma. Only the ratio being flat says so.
    const ratios = APERTURES.map((q) => {
      const e = emergentOf(matched.prescription, matched.objectDistanceMm, q);
      return e.sinOut / e.sinIn;
    });
    for (const r of ratios) expect(r).toBeCloseTo(1 / N_FRONT, 9);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-12);
    // The aperture is divided by n², the magnification multiplied by it. Read
    // from the trace; the module's own numbers are compared to it, not used.
    const e = emergentOf(matched.prescription, matched.objectDistanceMm, NA);
    expect(e.sinOut).toBeCloseTo(NA / (N_FRONT * N_FRONT), 12);
    expect(matched.emergentSine).toBeCloseTo(e.sinOut, 12);
    expect(matched.magnification).toBeCloseTo(N_FRONT * N_FRONT, 12);
  });

  it("NEGATIVE CONTROL: moving the specimen off the point breaks it at once", () => {
    // The aplanatic pair is a POINT, not a region — § 6d.1's finding, now on a
    // built element with real thicknesses rather than a bare surface. Moving the
    // SPECIMEN is the honest perturbation: it is the one thing a bench can get
    // wrong, and a correction collar exists because of it.
    const off = (frac: number) =>
      spreadOf(matched.prescription, matched.objectDistanceMm * (1 + frac));
    expect(off(0)).toBeLessThan(1e-12);
    expect(off(0.01)).toBeGreaterThan(1e-8);
    expect(off(0.1)).toBeGreaterThan(off(0.01));
  });

  it("the REAL stack's mismatch is the ONLY thing that moves the crossing", () => {
    // Positive and negative control in one: identical geometry, identical
    // aperture, and the sole difference is whether the media match. § 6e.1 said
    // the residual is an exact zero when they do; here the tracer says it too,
    // through a real dome rather than through bare layers.
    expect(spreadOf(matched.prescription, matched.objectDistanceMm)).toBeLessThan(1e-12);
    expect(spreadOf(real.prescription, real.objectDistanceMm)).toBeGreaterThan(1e-4);
    // And the sine ratio stops being constant by the same mechanism: the stack
    // is not aplanatic, so the element it feeds cannot be either.
    const ratios = APERTURES.map((q) => {
      const e = emergentOf(real.prescription, real.objectDistanceMm, q);
      return e.sinOut / e.sinIn;
    });
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(1e-6);
  });

  it("the rim fraction is a CLOSED FORM and is scale-free", () => {
    // h/R = sin(θ + arcsin(sinθ/n)) with sinθ = NA/n — no R in it. So a bigger
    // dome buys no rim margin, which is why a high-NA front element is a ball
    // cut past its own equator rather than a gentler one.
    const predicted = (q: number, n: number) => {
      const th = Math.asin(q / n);
      return Math.sin(th + Math.asin(Math.sin(th) / n));
    };
    expect(matched.rimUtilisation).toBeCloseTo(predicted(NA, N_FRONT), 9);
    for (const radius of [0.3, 1.5, 4]) {
      const h = hyperhemisphere({
        numericalAperture: NA,
        radiusMm: radius,
        coverslipSpec: null,
        immersionMedium: FRONT_ELEMENT_MEDIUM,
      });
      expect(h.rimUtilisation).toBeCloseTo(matched.rimUtilisation, 9);
    }
    // It PEAKS at 1 near NA 1.275 for this glass, where the marginal ray grazes
    // the equator exactly and no dome of any radius has room to spare. Either
    // side of that it comes back down — the constraint is a ridge, not a wall,
    // and a design has to know which side of it its aperture sits on.
    const peak = predicted(1.275, N_FRONT);
    expect(peak).toBeGreaterThan(0.9999);
    expect(predicted(1.4, N_FRONT)).toBeLessThan(peak);
    expect(predicted(1.0, N_FRONT)).toBeLessThan(peak);
  });

  it("the STOP RADIUS is exact at a plane face — § 6a's blocker, closed", () => {
    // § 6a recorded that its aperture seed "is a tangent and is 2.6× out at
    // NA 1.4". The tangent was never the problem: at a PLANE face a ray leaving
    // the specimen at θ and crossing t of medium lands at exactly t·tanθ, to all
    // orders. What was 2.6× out was using the sine-condition height f·sinu as if
    // it were a stop radius, which it never was. Here the marginal ray's own hit
    // on surface 0 IS the stop radius, at NA 1.25 and at NA 1.40, no solve.
    for (const q of [0.5, 1.0, 1.25, 1.4]) {
      const el = hyperhemisphere({ numericalAperture: q, radiusMm: 0.5 });
      const hit = emergentOf(el.prescription, el.objectDistanceMm, q).hits[0]!;
      expect(Math.hypot(hit.x, hit.y)).toBeCloseTo(el.stopRadiusMm, 12);
    }
    // The ratio § 6a was quoting, for the record: tangent over sine in the cover
    // glass at NA 1.4 really is 2.5–2.6. It is a real number about a real cone;
    // it was only ever the wrong number to size a stop with.
    const sin = 1.4 / N_SLIP;
    expect(1 / Math.sqrt(1 - sin * sin)).toBeGreaterThan(2.5);
  });

  it("the NA ceiling is the RAREST medium in the chain, and it is not the glass", () => {
    // q is conserved across every plane face, so a ray with q ≥ nᵢ never leaves
    // layer i. The fluid is the rarest of the three, so it — not the dome's glass
    // and not the cover glass — is what caps an immersion objective's aperture.
    const nFluid = getMedium(IMMERSION_MEDIUM).n(LAMBDA);
    expect(nFluid).toBeLessThan(N_FRONT);
    expect(nFluid).toBeLessThan(N_SLIP);
    expect(() => hyperhemisphere({ numericalAperture: nFluid + 1e-6, radiusMm: 0.5 })).toThrow(
      /rarest medium/,
    );
  });
});

describe("§ 6e.3 — the aplanatic meniscus, and the front group", () => {
  const NA = 1.25;
  const R = 0.5;
  const matchedSpec = {
    numericalAperture: NA,
    radiusMm: R,
    coverslipSpec: null,
    immersionMedium: FRONT_ELEMENT_MEDIUM,
  } as const;
  const group = aplanaticFrontGroup(matchedSpec);
  const N_FRONT = group.hyperhemisphere.glassIndex;
  const APERTURES = [1e-6, 0.3, 0.6, 0.9, 1.1, 1.25] as const;

  it("the CONCENTRIC surface bends nothing at all — that is its whole job", () => {
    // The first surface of a meniscus is centred ON the incoming object point,
    // so every ray meets it at normal incidence. Not "small deviation": the
    // emergent direction is the incident one to f64. A design that used the
    // Weierstrass form here instead would bend, and the group would stop being
    // exact — which is why the two stigmatic pairs are never interchangeable.
    const m = aplanaticMeniscus({ objectDistanceMm: 2, thicknessMm: 1 });
    const front: Prescription = {
      objectMedium: "AIR",
      surfaces: [{ ...m.surfaces[0]!, semiAperture: Infinity, thickness: 0.5 }],
    };
    for (const sin of [0.1, 0.3, 0.5]) {
      const res = traceRay(
        front,
        makeRay(vec3(0, 0, -2), vec3(sin, 0, Math.sqrt(1 - sin * sin)), LAMBDA),
      );
      expect(res.status).toBe("ok");
      const d = res.ray!.dir;
      expect(Math.hypot(d.x, d.y) / Math.hypot(d.x, d.y, d.z)).toBeCloseTo(sin, 13);
    }
    // Its radius is not a free parameter dressed as one: concentricity fixes it.
    expect(m.frontRadiusMm).toBe(2);
    // And the rear surface is Weierstrass for the same point, now in glass.
    expect(m.rearRadiusMm).toBeCloseTo((3 * m.glassIndex) / (m.glassIndex + 1), 12);
    expect(m.virtualImageDistanceMm).toBeCloseTo(3 * m.glassIndex, 12);
    expect(m.magnification).toBeCloseTo(m.glassIndex, 12);
  });

  it("MATCHED group: still exactly stigmatic after a dome and two menisci", () => {
    // Three aplanatic surfaces and one that bends nothing, composed. Because
    // each is exact to all orders, so is the stack of them — the crossing does
    // not move across the whole aperture, which no third-order design does.
    const cs = APERTURES.map(
      (q) => emergentOf(group.prescription, group.objectDistanceMm, q).crossing,
    );
    expect(Math.max(...cs) - Math.min(...cs)).toBeLessThan(1e-11);
    expect(lastVertexZ(group.prescription) - cs[0]!).toBeCloseTo(
      group.virtualImageDistanceMm,
      9,
    );
  });

  it("MATCHED group: the aperture is divided by exactly n²·nᵏ, and so is the angle", () => {
    // The reduction is the bare product of the elements': n² at the dome, n at
    // each meniscus. Read off the trace, and the sine ratio is flat — the group
    // is aplanatic, not merely stigmatic.
    const ratios = APERTURES.map((q) => {
      const e = emergentOf(group.prescription, group.objectDistanceMm, q);
      return e.sinOut / e.sinIn;
    });
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-12);
    for (const count of [0, 1, 2, 3]) {
      const g = aplanaticFrontGroup({ ...matchedSpec, meniscusCount: count });
      const e = emergentOf(g.prescription, g.objectDistanceMm, NA);
      const expected = N_FRONT * N_FRONT * N_FRONT ** count;
      expect(g.magnification).toBeCloseTo(expected, 10);
      expect(e.sinOut).toBeCloseTo(NA / expected, 11);
      expect(g.emergentSine).toBeCloseTo(e.sinOut, 11);
    }
  });

  it("MATCHED group: the traced transverse magnification IS n²·nᵏ", () => {
    // The aperture ratio and the magnification are different measurements, and
    // the Lagrange invariant ties them: whatever divides the aperture must
    // multiply the height by the same factor, or the group is not aplanatic. A
    // paraxial chief ray through the front vertex measures it WITH ITS SIGN, so
    // a virtual erect image cannot be mistaken for a real inverted one.
    const p = group.prescription;
    const d = group.objectDistanceMm;
    const marginal = paraxialTrace(p, LAMBDA, { y: d, u: 1 });
    const imageFromLastVertex = -marginal.y / marginal.u;
    expect(imageFromLastVertex).toBeLessThan(0); // virtual
    const h = 1e-5;
    const chief = paraxialTrace(p, LAMBDA, { y: 0, u: -h / d });
    const m = (chief.y + chief.u * imageFromLastVertex) / h;
    expect(m).toBeCloseTo(group.magnification, 6);
    expect(m).toBeGreaterThan(0); // erect, because the image is virtual
  });

  it("THE BUDGET: NA 1.25 and 1.40 land under § 6d's measured 0.343 ceiling", () => {
    // This is what the whole step is for. § 6d measured that two cemented
    // doublets stop solving at NA 0.343 (N-BK7/F2) and 0.383 (fused silica/F2) —
    // a property of the FORM, since two glass pairs wall out together. The front
    // group's job is to deliver an aperture under that number, and the count of
    // menisci is set by it rather than by taste.
    const LISTER_CEILING = 0.343;
    const emergent = (na: number, count: number) =>
      aplanaticFrontGroup({ ...matchedSpec, numericalAperture: na, meniscusCount: count })
        .emergentSine;
    // One meniscus is NOT enough at either aperture — 0.354 and 0.401, both over.
    expect(emergent(1.25, 1)).toBeGreaterThan(LISTER_CEILING);
    expect(emergent(1.4, 1)).toBeGreaterThan(LISTER_CEILING);
    // Two is, at both — 0.232 and 0.260, and 0.260 is under § 6d's DEFAULT reach
    // of 0.273 as well, so the rear group need not be pushed to its own edge.
    expect(emergent(1.25, 2)).toBeLessThan(LISTER_CEILING);
    expect(emergent(1.4, 2)).toBeLessThan(0.273);
    expect(emergent(1.25, 2)).toBeCloseTo(0.2321, 4);
    expect(emergent(1.4, 2)).toBeCloseTo(0.26, 4);
  });

  it("NEGATIVE CONTROL: a rear surface 1% off Weierstrass stops being exact", () => {
    // The menisci are not "roughly aplanatic shells". Perturbing the rear radius
    // by 1% — a curvature a bench could not distinguish by eye — takes the group
    // from f64-flat to visibly aberrated, which is the difference between using
    // the closed form and gesturing at it.
    const bent = (frac: number): number => {
      const surfaces = group.prescription.surfaces.map((s, i) =>
        // Surface 3 is the first meniscus's rear (dome: flat + sphere, then the
        // meniscus's concentric front).
        i === 3 ? { ...s, curvature: s.curvature * (1 + frac) } : s,
      );
      const p: Prescription = { ...group.prescription, surfaces };
      const cs = APERTURES.map((q) => emergentOf(p, group.objectDistanceMm, q).crossing);
      return Math.max(...cs) - Math.min(...cs);
    };
    expect(bent(0)).toBeLessThan(1e-11);
    expect(bent(0.01)).toBeGreaterThan(1e-4);
    expect(bent(0.01) / bent(0)).toBeGreaterThan(1e6);
  });

  it("the solve holds across the stated split — a FORM, not a lucky pick", () => {
    // § 6d's discipline: the gap and thickness factors are STATED, so the claim
    // has to be that the design does not depend on them. Every combination below
    // is exactly stigmatic and delivers the same aperture reduction, because the
    // aplanatic condition is re-imposed at each element whatever the geometry.
    for (const meniscusGapFactor of [0.1, 0.2, 0.5]) {
      for (const meniscusThicknessFactor of [0.3, 0.5, 0.9]) {
        const g = aplanaticFrontGroup({
          ...matchedSpec,
          meniscusGapFactor,
          meniscusThicknessFactor,
        });
        const cs = APERTURES.map(
          (q) => emergentOf(g.prescription, g.objectDistanceMm, q).crossing,
        );
        expect(Math.max(...cs) - Math.min(...cs)).toBeLessThan(1e-10);
        expect(g.emergentSine).toBeCloseTo(group.emergentSine, 12);
      }
    }
  });
});
