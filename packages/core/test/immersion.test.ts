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
  minimumDomeRadiusMm,
  oilImmersionObjective,
  planeLayerHeightMm,
} from "../src/designs/immersion";
import { listerObjective } from "../src/designs/lister";
import { infinityCorrectedMicroscope, tubeLens } from "../src/designs/microscope";
import { OpticalSystem } from "../src/trace/system";
import { opdMap } from "../src/pupil/opd";
import { pupilGrid } from "../src/pupil/aiming";
import { bestFocus, withFocus } from "../src/analysis/focus";
import {
  abbeResolutionMm,
  lateralMagnification,
  objectNumericalAperture,
  sineConditionResidual,
} from "../src/pupil/microscope";
import { LINE_D, constantIndex } from "../src/materials/dispersion";
import { getMedium, registerMedium } from "../src/materials/catalog";
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

/**
 * § 6e.4 — the composed oil-immersion objective: § 6e's aplanatic front, then
 * § 6d's Lister, spliced into an `InfinityCorrectedObjective`.
 *
 * **Third-order theory is deliberately absent here.** `analysis/seidel` seeds its
 * marginal ray with the paraxial slope h/s — a TANGENT — and § 6c measured that
 * the tan and sin conventions part company by a factor of three at NA 0.65. At
 * NA 1.25 a Seidel sum is not a wrong number, it is not a number. Everything
 * below is read off the traced wavefront or off real rays.
 */
describe("§ 6e.4 — the oil-immersion objective", () => {
  const TUBE_MM = 200;
  const FIELD_MM = 0.002;
  const MARECHAL_W = 1 / 14;
  const objective = (NA: number, over: Record<string, unknown> = {}) =>
    oilImmersionObjective({
      magnification: 100,
      numericalAperture: NA,
      tubeFocalLengthMm: TUBE_MM,
      ...over,
    });
  const scopeOf = (o: ReturnType<typeof objective>): OpticalSystem =>
    infinityCorrectedMicroscope({
      objective: o,
      tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
      objectHeightsMm: [0, FIELD_MM],
    }).system;
  /** σ on axis at best focus, in waves. */
  const sigmaOf = (s: OpticalSystem): number => {
    const f = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const map = opdMap(withFocus(s, f.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21));
    expect(map.lost).toBe(0);
    return map.rmsWaves;
  };
  const flagship = objective(1.25);

  it("the traced object NA IS the label, at 1.25 and at 1.40", () => {
    // NOT circular: the stop radius is § 6e.2's closed plane-layer sum, computed
    // from the label and never solved against a traced NA. What this measures is
    // that the exact tracer, through 13 surfaces and a real cover slip, delivers
    // the cone that stop implies — at an aperture where the sine and the tangent
    // differ by 2.6×, so nothing small-angle could be hiding.
    for (const NA of [1.0, 1.25, 1.4]) {
      expect(objectNumericalAperture(scopeOf(objective(NA)), LAMBDA)).toBeCloseTo(NA, 7);
    }
  });

  it("100× really is 100×, and the EFL is f_tube/M", () => {
    // The magnification is a real-ray measurement through the tube lens, so it
    // carries distortion — it comes out 0.04% shy of nominal at a 2 µm field
    // height, and that residual is the finding rather than an error.
    const m = lateralMagnification(scopeOf(flagship), FIELD_MM, LAMBDA);
    expect(m).toBeLessThan(0); // a microscope's real image is inverted
    expect(Math.abs(m)).toBeCloseTo(100, 0);
    expect(Math.abs(Math.abs(m) / 100 - 1)).toBeLessThan(2e-3);
    // The paraxial EFL of the whole objective is f_tube/M to a part in 10⁹ — the
    // two groups' powers were never added by hand, only placed.
    expect(flagship.paraxialFocalLengthMm).toBeCloseTo(TUBE_MM / 100, 8);
    expect(flagship.focalLengthMm).toBe(TUBE_MM / 100);
  });

  it("DIFFRACTION-LIMITED across the whole immersion range", () => {
    // The point of the step. σ at best focus stays 3–7× inside Maréchal from
    // NA 1.0 to NA 1.40 — a 100×/1.4 oil objective that is diffraction-limited
    // because every element in front of the doublets is exact to all orders.
    for (const NA of [1.0, 1.1, 1.25, 1.35, 1.4]) {
      const sigma = sigmaOf(scopeOf(objective(NA)));
      expect(sigma).toBeLessThan(MARECHAL_W);
      expect(sigma).toBeLessThan(0.35 * MARECHAL_W);
    }
  });

  it("the CEILING is geometric, not aberration — § 6d.4's shape again", () => {
    // § 6d found the Lister stopped EXISTING before it stopped being
    // diffraction-limited. The same is true here for a different reason: the
    // cover slip's apparent depth puts a floor under the dome radius, the
    // placement puts a ceiling on it, and they meet at NA 1.411 — where the
    // wavefront is still λ/50.
    const builds = (NA: number): boolean => {
      try {
        objective(NA);
        return true;
      } catch {
        return false;
      }
    };
    let lo = 1.0;
    let hi = 1.6;
    for (let i = 0; i < 28; i++) {
      const mid = 0.5 * (lo + hi);
      if (builds(mid)) lo = mid;
      else hi = mid;
    }
    expect(lo).toBeGreaterThan(1.40);
    expect(lo).toBeLessThan(1.42);
    // At the wall the two radii have met: the placement solve wants exactly what
    // the stack's apparent depth allows and not a micron more.
    const atWall = objective(lo);
    expect(atWall.domeRadiusMm / minimumDomeRadiusMm({ numericalAperture: lo })).toBeCloseTo(1, 2);
    // …and the wavefront there is nowhere near its own limit.
    const sigma = sigmaOf(scopeOf(atWall));
    expect(sigma).toBeLessThan(MARECHAL_W / 3);
    expect(1 / sigma).toBeGreaterThan(45);
  });

  it("the EXTREMA, not the endpoints: the dome's equator and the last micron", () => {
    // Sweeping NA 1.0 → 1.4 in steps steps OVER the two points where this form is
    // most likely to break, so they are tested by name instead of interpolated.
    //
    // (a) Rim utilisation h/R is scale-free and peaks near 1 — the marginal ray
    // arriving at the dome's EQUATOR, which is grazing incidence and where the
    // self-vignetting bug in § 6e.3 actually lived. For D263 the peak is at
    // NA 1.275, INSIDE the working range and between two of the swept points.
    let peak = { NA: 0, rim: 0 };
    for (let NA = 1.0; NA <= 1.408; NA += 0.005) {
      const rim = objective(NA).frontGroup.hyperhemisphere.rimUtilisation;
      if (rim > peak.rim) peak = { NA, rim };
    }
    expect(peak.NA).toBeCloseTo(1.275, 2);
    expect(peak.rim).toBeGreaterThan(0.9999);
    expect(peak.rim).toBeLessThanOrEqual(1);
    // At the equator it still builds, still delivers its aperture exactly, and is
    // still diffraction-limited — the cap is a real rim, not a clipped one.
    const atPeak = objective(peak.NA);
    expect(objectNumericalAperture(scopeOf(atPeak), LAMBDA)).toBeCloseTo(peak.NA, 7);
    expect(sigmaOf(scopeOf(atPeak))).toBeLessThan(0.35 * MARECHAL_W);
    // And the peak is a maximum of h/R, so NA 1.4 sits PAST it on the way down.
    expect(objective(1.4).frontGroup.hyperhemisphere.rimUtilisation).toBeLessThan(peak.rim);

    // (b) The last micron before the wall: it must fail by THROWING, not by
    // quietly handing back a build whose marginal ray is outside a rim.
    expect(objective(1.41).frontGroup.hyperhemisphere.rimUtilisation).toBeLessThan(1);
    expect(sigmaOf(scopeOf(objective(1.41)))).toBeLessThan(MARECHAL_W);
    expect(() => objective(1.411)).toThrow(/does not survive this geometry|too shallow for the stack/);
  });

  it("the COVER SLIP HELPS: its spherical partly cancels the rear group's", () => {
    // Counter-intuitive and classical. § 6e.1 says the slip adds spherical
    // aberration; § 6d says the Lister leaves a fifth-order residual. They are of
    // opposite sign, so the objective WITH its slip is better corrected than the
    // same objective in a perfectly index-matched bath — which is why a real
    // objective is corrected as a whole *including* the glass it looks through,
    // and why using one without its slip is worse than not correcting at all
    // (§ 6c's sign, arriving at the aperture it matters most).
    const matched = objective(1.25, {
      coverslipSpec: null,
      immersionMedium: FRONT_ELEMENT_MEDIUM,
    });
    const withSlip = sigmaOf(scopeOf(flagship));
    const bare = sigmaOf(scopeOf(matched));
    expect(withSlip).toBeLessThan(bare);
    expect(bare / withSlip).toBeGreaterThan(1.5);
    // Both are still inside the limit — the slip is a refinement here, not a
    // rescue, and saying otherwise would overstate it.
    expect(bare).toBeLessThan(MARECHAL_W);
  });

  it("the sine condition holds to ~1%, and it is the REAR group's residual", () => {
    // The front group is aplanatic to f64 (§ 6e.3). What is left is the Lister's
    // own offence against Abbe, which § 6d measured at 1.3% at NA 0.20 — and the
    // rear group here runs at NA 0.232, so ~1% is exactly what should survive.
    // Attributing it matters: it is not the immersion front misbehaving.
    const residual = Math.abs(sineConditionResidual(scopeOf(flagship), FIELD_MM, LAMBDA));
    expect(residual).toBeLessThan(0.02);
    expect(residual).toBeGreaterThan(1e-3);
  });

  it("resolution: what NA 1.4 buys over the best dry objective", () => {
    // The reason any of this exists. Abbe's d = λ/(2·NA), so the gain over a dry
    // NA 0.95 is exactly the NA ratio — 1.47× finer detail, 210 nm against
    // 309 nm at the d line. Not a modelling artifact: it is the immersion fluid's
    // index appearing in n·sinu, which is where NA > 1 comes from at all.
    const wet = abbeResolutionMm(LAMBDA, 1.4);
    const dry = abbeResolutionMm(LAMBDA, 0.95);
    expect(dry / wet).toBeCloseTo(1.4 / 0.95, 12);
    expect(wet * 1e6).toBeCloseTo(210, 0);
    // And NA > 1 is impossible dry, which is the whole point of the fluid.
    expect(() => hyperhemisphere({ numericalAperture: 1.25, radiusMm: 0.5, immersionMedium: "AIR" })).toThrow();
  });

  it("NEGATIVE CONTROLS: the rear group cannot do this alone, and says so", () => {
    // A Lister asked for NA 1.25 directly is not a hard design problem, it is an
    // impossible one — sin u > 1 in air. The constructor refuses on those terms.
    expect(() => listerObjective({ magnification: 100, numericalAperture: 1.25 })).toThrow(
      /must lie in \(0, 1\)/,
    );
    // And with too few menisci the aperture handed back is over § 6d's measured
    // ceiling, so the Lister refuses with ITS OWN reason — the failure quotes the
    // previous step's number rather than a new one invented here.
    for (const meniscusCount of [0, 1]) {
      expect(() => objective(1.25, { meniscusCount })).toThrow(
        /two cemented doublets do not reach/,
      );
    }
  });

  it("one aperture, one flag — and the placement solve is exact", () => {
    // § 6a's rule: both groups declare their own surface 0 a stop, so a naive
    // splice would carry two. `seidelSums` throws unless the flagged stop is
    // surface 0, and `stopIndex` would silently take the first and look fine.
    const flags = flagship.prescription.surfaces.filter((s) => s.isStop);
    expect(flags.length).toBe(1);
    expect(flagship.prescription.surfaces[0]!.isStop).toBe(true);

    // The dome radius is solved, not chosen: the front group's virtual image
    // lands at exactly `frontImageFactor` of the rear group's object distance,
    // and the gap is the rest of it.
    const factor = 0.75;
    const o = objective(1.25, { frontImageFactor: factor });
    expect(o.frontGroup.virtualImageDistanceMm / o.rearGroup.objectDistanceMm).toBeCloseTo(
      factor,
      10,
    );
    expect(o.groupGapMm).toBeCloseTo((1 - factor) * o.rearGroup.objectDistanceMm, 10);
    // …which rests on every length in the front group being exactly proportional
    // to R. Asserted directly, because the solve is a division that assumes it.
    const a = aplanaticFrontGroup({ numericalAperture: 1.25, radiusMm: 0.5 });
    const b = aplanaticFrontGroup({ numericalAperture: 1.25, radiusMm: 1.5 });
    expect(b.virtualImageDistanceMm / a.virtualImageDistanceMm).toBeCloseTo(3, 10);
    expect(b.magnification).toBeCloseTo(a.magnification, 12);
  });

  it("the minimum dome radius is a CLOSED FORM, exact on a matched stack", () => {
    // § 6e.2's floor, checked against where the constructor ACTUALLY starts
    // refusing rather than against itself: bisect the radius at fixed NA and
    // compare. The formula is a homogeneous-medium statement — the marginal ray
    // meets the dome R(1−cosφ) below its vertex — so it should be exact exactly
    // when the stack is index-matched, and that is the shape the measurement has.
    const thresholdOf = (NA: number, over: Record<string, unknown>): number => {
      const spec = { numericalAperture: NA, ...over };
      const predicted = minimumDomeRadiusMm(spec);
      const builds = (R: number): boolean => {
        try {
          hyperhemisphere({ ...spec, radiusMm: R });
          return true;
        } catch {
          return false;
        }
      };
      let lo = predicted * 0.5;
      let hi = predicted * 3;
      for (let i = 0; i < 50; i++) {
        const mid = 0.5 * (lo + hi);
        if (builds(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    const MATCHED = { coverslipSpec: null, immersionMedium: FRONT_ELEMENT_MEDIUM };
    for (const NA of [0.5, 0.9, 1.25, 1.4]) {
      const predicted = minimumDomeRadiusMm({ numericalAperture: NA, ...MATCHED });
      // Exact to a part in 10⁷ — the residual is the bisection's own resolution.
      expect(thresholdOf(NA, MATCHED) / predicted - 1).toBeLessThan(1e-7);
    }
    // On the real bench it is an UNDER-estimate, by exactly the amount the stack
    // bends the ray away from the homogeneous geometry — 1.2e-5 at NA 0.5 rising
    // to 3.7e-3 at NA 1.4. Conservative in the safe direction (the constructor
    // refuses slightly more than the formula predicts), and it grows with the
    // mismatch's leverage rather than randomly, which is what makes it an
    // explanation rather than a discrepancy.
    const relative = (NA: number) => thresholdOf(NA, {}) / minimumDomeRadiusMm({ numericalAperture: NA }) - 1;
    expect(relative(0.5)).toBeGreaterThan(0);
    expect(relative(0.5)).toBeLessThan(1e-4);
    expect(relative(1.4)).toBeGreaterThan(2e-3);
    expect(relative(1.4)).toBeGreaterThan(relative(1.25));
    expect(relative(1.25)).toBeGreaterThan(relative(0.9));
    expect(relative(0.9)).toBeGreaterThan(relative(0.5));

    // A slip makes the floor an order of magnitude higher than a bare specimen
    // in fluid — the fixed 0.17 mm of glass is what forces a big dome, and a big
    // dome is what forces the front group to be compact.
    expect(minimumDomeRadiusMm({ numericalAperture: 1.25 })).toBeGreaterThan(
      8 * minimumDomeRadiusMm({ numericalAperture: 1.25, coverslipSpec: null }),
    );
  });
});

/**
 * § 6e.5 — the slip TOLERANCE: what refocusing fixes, and what it cannot
 *
 * § 6e.4 measured σ with the *nominal* 0.17 mm cover slip. That is the design
 * point, and a design point is not a tolerance: a real slip is never exactly
 * nominal, and the § 6e.4 finding that the slip's spherical partly cancels the
 * Lister's residual makes the flagship's correction depend on a plate it does
 * not control. This step measures the dependence instead of assuming it either
 * way, and the answer separates cleanly into three different mechanisms.
 *
 * **The model matters more than the number here.** A real immersion objective is
 * focused by MOVING IT, which changes the thickness of the oil film — the gap is
 * the focus control. Holding the gap fixed and refocusing only on the image side
 * is not "a conservative assumption", it is a different instrument, and it gives
 * answers an order of magnitude out (the negative control below). So the sweeps
 * refocus the way the closed form says to: hold the stack's paraxial apparent
 * distance n_g·Σtᵢ/nᵢ — § 6c's own quantity, generalised in § 6e.1 — constant.
 *
 * Three mechanisms, and they behave completely differently:
 *
 *  1. **Thickness** costs nothing in aberration. The slip and the front element
 *     are the same glass (§ 6e chose D263 for the front for exactly this
 *     reason), so (n_slip² − n_out²) = 0 and a thickness error contributes an
 *     EXACT zero to `stackWavefrontErrorMm` — bit-identical, not merely small.
 *     A thickness error is therefore a pure axial displacement of the specimen,
 *     and refocusing is precisely the operation that removes one.
 *  2. **Thickness does move the delivered APERTURE**, which is not obvious and is
 *     what actually ends the range. The glass rims are fixed; a thinner slip puts
 *     the specimen closer to them, so the same rim subtends a WIDER cone. The
 *     relation is § 6e.2's `planeLayerHeightMm` read backwards, and at NA 1.40 it
 *     walks the design into § 6e.4's own 1.411 ceiling from below.
 *  3. **Index** is the tolerance refocusing cannot touch. It breaks the match
 *     that makes (1) free, so it aberrates — symmetrically, and at NA 1.40 a
 *     realistic ±0.003 is already outside Maréchal.
 *
 * Nothing here is pinned to a published slip tolerance: the pin is the closed
 * form (refocus = constant apparent distance), which is stronger and is already
 * in the engine. The nominal 0.17 mm and the No. 1.5 band are context, not pins.
 */
describe("§ 6e.5 — the slip tolerance", () => {
  const TUBE_MM = 200;
  const MARECHAL_W = 1 / 14;
  const T0 = 0.17;
  const N_SLIP = getMedium(FRONT_ELEMENT_MEDIUM).n(LAMBDA);
  const N_OIL = getMedium(IMMERSION_MEDIUM).n(LAMBDA);

  const objective = (NA: number) =>
    oilImmersionObjective({
      magnification: 100,
      numericalAperture: NA,
      tubeFocalLengthMm: TUBE_MM,
    });

  /**
   * The same objective — same glass, same spacings — with a DIFFERENT slip in
   * front of it and the oil film set to `gapMm`. Nothing is re-solved: this is a
   * built instrument meeting a plate it was not designed for.
   */
  const withSlip = (
    o: ReturnType<typeof objective>,
    thicknessMm: number,
    gapMm: number,
    medium?: string,
  ): OpticalSystem => {
    const [s0, ...rest] = o.prescription.surfaces;
    return infinityCorrectedMicroscope({
      objective: {
        ...o,
        objectDistanceMm: thicknessMm,
        prescription: {
          ...o.prescription,
          ...(medium ? { objectMedium: medium } : {}),
          surfaces: [{ ...s0!, thickness: gapMm }, ...rest],
        },
      },
      tubeLens: tubeLens({ focalLengthMm: TUBE_MM }),
      objectHeightsMm: [0],
    }).system;
  };

  /**
   * The oil film that keeps the stack's paraxial apparent distance where the
   * design put it — the closed form for "refocus", not a search. n_g cancels:
   * Δt/n_slip + Δg/n_oil = 0.
   */
  const refocusedGapMm = (o: ReturnType<typeof objective>, t: number): number =>
    o.frontGroup.hyperhemisphere.immersionGapMm - ((t - T0) * N_OIL) / N_SLIP;

  const sigmaAt = (s: OpticalSystem): number => {
    const f = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
    const map = opdMap(withFocus(s, f.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21));
    expect(map.lost).toBe(0);
    return map.rmsWaves;
  };

  it("MECHANISM: a thickness error adds EXACTLY zero stack aberration", () => {
    // Not "negligible" — the summand carries (nᵢ²−n_out²) as a factor and the
    // slip IS the front element's glass, so the layer contributes a hard zero and
    // its thickness cannot appear in the answer at all. Asserted with toBe.
    const h = objective(1.4).frontGroup.hyperhemisphere;
    expect(h.coverslip!.medium).toBe(FRONT_ELEMENT_MEDIUM);
    const nominal = stackWavefrontErrorMm(h.stack, h.glassIndex, 1.4);
    for (const dt of [-0.02, -0.005, 0.005, 0.02]) {
      const perturbed = h.stack.map((l, i) =>
        i === 0 ? { ...l, thicknessMm: l.thicknessMm + dt } : l,
      );
      expect(stackWavefrontErrorMm(perturbed, h.glassIndex, 1.4)).toBe(nominal);
    }
    // The oil is the only mismatched layer, so it carries the whole residual.
    const oilOnly = h.stack.filter((l) => l.n !== h.glassIndex);
    expect(oilOnly.length).toBe(1);
    expect(stackWavefrontErrorMm(oilOnly, h.glassIndex, 1.4)).toBe(nominal);
  });

  it("REFOCUSED, the objective holds Maréchal across the whole No. 1.5 band", () => {
    // Refocused by the closed form — one evaluation per point, no optimiser — σ
    // never approaches the limit at NA 1.0 or 1.25 across 0.15–0.18 mm, and at
    // NA 1.0 it is nearly INVARIANT: a ±20 µm slip error moves σ by under 15%,
    // because to first order it is not an error at all, just a different place
    // for the specimen to stand.
    for (const [NA, worst] of [
      [1.0, 0.10],
      [1.25, 0.35],
    ] as const) {
      const o = objective(NA);
      for (const t of [0.15, 0.16, 0.165, 0.17, 0.175, 0.18]) {
        expect(sigmaAt(withSlip(o, t, refocusedGapMm(o, t)))).toBeLessThan(worst * MARECHAL_W);
      }
    }
    const o1 = objective(1.0);
    const flat = [0.15, 0.16, 0.17, 0.18].map((t) => sigmaAt(withSlip(o1, t, refocusedGapMm(o1, t))));
    expect(Math.max(...flat) / Math.min(...flat)).toBeLessThan(1.15);
  });

  it("NEGATIVE CONTROL: refocus on the IMAGE side alone is a different instrument", () => {
    // The same slip errors with the oil film held fixed — i.e. pretending the
    // focus knob does not move the objective. σ blows through Maréchal within a
    // couple of microns. This is the rung that makes the one above mean
    // something: the tolerance measured is a property of the refocus model as
    // much as of the glass, and picking the wrong model is worth an order of
    // magnitude in the answer.
    for (const NA of [1.25, 1.4]) {
      const o = objective(NA);
      const g0 = o.frontGroup.hyperhemisphere.immersionGapMm;
      const fixed = sigmaAt(withSlip(o, T0 + 0.005, g0));
      const moved = sigmaAt(withSlip(o, T0 + 0.005, refocusedGapMm(o, T0 + 0.005)));
      expect(fixed).toBeGreaterThan(MARECHAL_W);
      expect(fixed).toBeGreaterThan(4 * moved);
    }
    // At NA 1.40, +5 µm of slip with the film held fixed is already 3× the whole
    // budget — and under half of it once the objective is allowed to move.
    const o = objective(1.4);
    expect(sigmaAt(withSlip(o, 0.175, o.frontGroup.hyperhemisphere.immersionGapMm))).toBeGreaterThan(
      3 * MARECHAL_W,
    );
    expect(sigmaAt(withSlip(o, 0.175, refocusedGapMm(o, 0.175)))).toBeLessThan(0.5 * MARECHAL_W);
  });

  it("the delivered NA is SLIP-DEPENDENT, and that is what ends the range", () => {
    // The finding of this step. The stop is a fixed rim at a fixed plane, sized
    // from the nominal slip; the specimen sits on the slip's underside. Thin the
    // slip and the specimen moves CLOSER to that rim, so the same rim subtends a
    // wider cone — the objective delivers more NA than its label. The relation is
    // § 6e.2's `planeLayerHeightMm` inverted, with no new physics in it:
    //
    //     h = t·tanθ,  NA = n_slip·sinθ   ⟹   NA(t) = n_slip·h / √(t² + h²)
    //
    const o = objective(1.4);
    const h = o.stopRadiusMm;
    expect(h).toBeCloseTo(planeLayerHeightMm([{ thicknessMm: T0, n: N_SLIP }], 1.4), 12);
    const predictedNA = (t: number) => (N_SLIP * h) / Math.hypot(t, h);
    for (const t of [0.1625, 0.165, 0.17, 0.18]) {
      const traced = objectNumericalAperture(withSlip(o, t, refocusedGapMm(o, t)), LAMBDA);
      expect(Math.abs(traced / predictedNA(t) - 1)).toBeLessThan(2e-4);
    }
    // Monotone, and signed the surprising way: THINNER slip, HIGHER aperture.
    expect(predictedNA(0.16)).toBeGreaterThan(1.4);
    expect(predictedNA(0.18)).toBeLessThan(1.4);

    // And it is the mechanism that ends the thin side: § 6e.4 measured a ceiling
    // at NA 1.411, and the slip thickness at which the delivered NA reaches it is
    // a closed form — 0.1613 mm, i.e. only 8.7 µm thin. PREDICTED first, then the
    // tracer is asked, and it starts losing rays across exactly that thickness.
    const tCeiling = Math.sqrt(((N_SLIP * h) / 1.411) ** 2 - h * h);
    expect(tCeiling).toBeCloseTo(0.1613, 4);
    expect(T0 - tCeiling).toBeGreaterThan(0.008);
    const lostAt = (t: number): number => {
      const s = withSlip(o, t, refocusedGapMm(o, t));
      const f = bestFocus(s, "minRmsWavefront", { pupilSamples: 21 });
      return opdMap(withFocus(s, f.offsetFromLastVertex), 0, LAMBDA, pupilGrid(21)).lost;
    };
    expect(lostAt(tCeiling + 0.0012)).toBe(0);
    expect(lostAt(tCeiling - 0.0013)).toBeGreaterThan(0);
    // Below NA 1.25 the same effect exists but reaches nothing: the delivered
    // aperture at the thin end of the band is still far under the ceiling.
    const o125 = objective(1.25);
    const h125 = o125.stopRadiusMm;
    expect((N_SLIP * h125) / Math.hypot(0.15, h125)).toBeLessThan(1.3);
  });

  it("the THICK end is bounded by the oil film, not by aberration", () => {
    // Refocusing a thicker slip means a thinner film, and the film runs out
    // before the wavefront does: at 0.19 mm the closed form asks for 0.11 µm of
    // oil, which is optical contact and not a film. So the thick-side limit is
    // set by `immersionGapMm` — 20 µm here against the ~130 µm a real 100×/1.4
    // carries — and it is a knob, not a property of the form. Asserting the bound
    // rather than only writing it down, so a later reader cannot cite the σ at
    // 0.19 mm as though a 110 nm film were a working instrument.
    const o = objective(1.4);
    const g0 = o.frontGroup.hyperhemisphere.immersionGapMm;
    expect(g0).toBeCloseTo(0.02, 12);
    expect(refocusedGapMm(o, 0.19)).toBeLessThan(0.0002);
    // Held to a film of at least 5 µm, the usable thick side is +15 µm…
    const usable = [0.175, 0.18, 0.185].filter((t) => refocusedGapMm(o, t) >= 0.005);
    expect(usable).toEqual([0.175, 0.18, 0.185]);
    for (const t of usable) {
      expect(sigmaAt(withSlip(o, t, refocusedGapMm(o, t)))).toBeLessThan(MARECHAL_W);
    }
    // …and it is the FILM that stops it, not σ: the wavefront at the last
    // physically sensible film is still comfortably inside the budget.
    expect(sigmaAt(withSlip(o, 0.185, refocusedGapMm(o, 0.185)))).toBeLessThan(0.7 * MARECHAL_W);
  });

  it("INDEX is the tolerance refocusing cannot fix", () => {
    // Mechanism (3). Changing n_slip breaks the match that made thickness free,
    // so the slip becomes a mismatched layer and aberrates — symmetrically in the
    // sign of Δn, unlike thickness, and not removable by any axial motion. At
    // NA 1.40 a ±0.003 slip — inside real batch variation — is already outside
    // Maréchal, which makes index the binding tolerance of this design.
    const nd = getMedium(FRONT_ELEMENT_MEDIUM).n(LAMBDA);
    for (const dn of [-0.003, 0.003]) {
      registerMedium(constantIndex(`SLIP-6e5${dn}`, nd + dn));
    }
    const o = objective(1.4);
    const g0 = o.frontGroup.hyperhemisphere.immersionGapMm;
    const nominal = sigmaAt(withSlip(o, T0, g0));
    const lo = sigmaAt(withSlip(o, T0, g0, "SLIP-6e5-0.003"));
    const hi = sigmaAt(withSlip(o, T0, g0, "SLIP-6e50.003"));
    expect(nominal).toBeLessThan(0.35 * MARECHAL_W);
    expect(lo).toBeGreaterThan(MARECHAL_W);
    expect(hi).toBeGreaterThan(MARECHAL_W);
    // Symmetric to ~5%, which is what distinguishes it from a displacement: a
    // displacement is signed, a broken index match is not.
    expect(Math.abs(lo / hi - 1)).toBeLessThan(0.05);
    // At NA 1.25 the same ±0.003 is survivable — the cost climbs with aperture,
    // so index tolerance is part of what a higher-NA design spends to get there.
    const o125 = objective(1.25);
    const g125 = o125.frontGroup.hyperhemisphere.immersionGapMm;
    expect(sigmaAt(withSlip(o125, T0, g125, "SLIP-6e50.003"))).toBeLessThan(MARECHAL_W);
  });

  it("MEASURED, NOT ACTED ON: the placement solve is off its own optimum", () => {
    // The specimen is placed at the dome's paraxial Weierstrass point. That is
    // exact for the dome alone, but the objective it sits in also carries the
    // oil's mismatch and § 6d's fifth-order residual, and the σ optimum is
    // displaced from the paraxial point by well under a micron of apparent
    // distance — worth an order of magnitude at NA 1.0–1.25.
    //
    // Recorded rather than fixed: moving the placement would re-solve every
    // number in §§ 6e.2–6e.4, and it is the same open item as correcting for the
    // stack deliberately (§ 6c's `targetS1Mm`). What is pinned here is that the
    // gain EXISTS and roughly how big it is, so the later step has a target.
    for (const [NA, minGain] of [
      [1.0, 5],
      [1.25, 8],
    ] as const) {
      const o = objective(NA);
      const g0 = o.frontGroup.hyperhemisphere.immersionGapMm;
      const asBuilt = sigmaAt(withSlip(o, T0, g0));
      // A shift of the specimen alone, in units of apparent distance: ~0.8 µm.
      const better = sigmaAt(withSlip(o, T0, g0 + (0.0008 * N_OIL) / N_SLIP));
      expect(asBuilt / better).toBeGreaterThan(minGain);
    }
  });
});
