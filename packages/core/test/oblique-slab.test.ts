import { describe, it, expect } from "vitest";
import {
  coverslip,
  coverslipIndex,
  stackObliqueSeidelMm,
  stackW040Mm,
  stackWavefrontErrorMm,
  stackWavefrontVectorMm,
  type PlaneLayer,
} from "../src/designs/coverslip";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
  type StopPlacement,
} from "../src/designs/microscope";
import {
  mountWavefrontWaves,
  mountWavefrontWavesVector,
  withMountAberration,
  type ChiefInvariant,
  type MountSpec,
} from "../src/imaging/depth-aberration";
import { chiefRayInvariant } from "../src/pupil/microscope";
import { illuminationOffset } from "../src/imaging/object-field";
import { traceRay } from "../src/trace/sequential";
import { registerMedium } from "../src/materials/catalog";
import { constantIndex } from "../src/materials/dispersion";
import { makeRay } from "../src/trace/ray";
import { vec3 } from "../src/math/vec3";
import type { Prescription } from "../src/trace/prescription";
import type { OpticalSystem } from "../src/trace/system";
import type { PupilFunction } from "../src/wave/psf";

/**
 * § 6y — the plane stack off axis, and what telecentricity is worth to it.
 *
 * § 6l's own "Not yet pinned" opened with "Off axis", and gave a reason that had
 * already expired: "the object-space ray aiming that would express it is § 6a's
 * standing blocker". § 6u built that aiming and § 6v spent it. The sentence
 * survived because no structural check can see a comment that quietly stopped
 * matching the engine — which is APP.md's Part F lesson arriving in `core`.
 *
 * ## The physics is one sentence, and it adds nothing
 *
 * A plane stack is symmetric about its own NORMAL, not about the beam. Both
 * components of the transverse invariant are conserved at every plane face, so
 * the wavefront is W(|q|) and nothing else — the same W § 6c solved to all orders
 * and § 6e.1 generalised to N layers. Tilting the bundle moves the pupil's disc
 * of invariants OFF the origin of the plane that W is radial in:
 *
 *     q(ρ, φ) = q_chief + NA·ρ·(cos φ, sin φ)
 *
 * and a quartic evaluated on a displaced disc is not a quartic in ρ. That is the
 * whole step: no new physics, a new pupil coordinate.
 *
 * ## What is external here
 *
 * Two independent pins, deliberately of different kinds.
 *
 * **The tracer** (6y.1). The identity q·x_exit removes exactly the transverse
 * displacement, leaving Σ tᵢ√(nᵢ²−q²) — so a real ray pushed through a real
 * plane face by `traceRay` reconstructs the closed form at any obliquity, with no
 * lens, no image plane and no pupil convention in the way. § 6c.1's strength
 * (the plate is solvable exactly, so the tracer can be checked at NA 0.95) is
 * still available off axis, and this is it.
 *
 * **The classical plate coefficients** (6y.3). W = A|q|⁴ expanded on the
 * displaced disc gives the 1 : 4 : 4 : 2 : 4 pattern of the plane-parallel plate
 * — Welford's plate, Smith's *Modern Optical Engineering* — and the exact form
 * has to converge onto it as the aperture shrinks.
 *
 * ## The headline is INVARIANCE, and it is not zero
 *
 * On a telecentric objective the chief invariant is a bitwise zero at every field
 * height, so the slab's wavefront is the SAME wavefront everywhere in the field —
 * not a small variation. The spherical part is untouched and full strength; what
 * vanishes is everything that depends on the field. The rim-stopped control is
 * what gives that a size, and § 6y.5 measures it on the shipped DIN 4×/0.10.
 */

const LAMBDA = 587.5618;

/** Cargille Type B under a water mount — § 6l's own worked case. */
const N_OIL = 1.515;
const N_WATER = 1.333;
const DEPTH_MM = 0.01;

const SLIP = coverslip();
const N_SLIP = coverslipIndex(SLIP, LAMBDA);

const mountLayers = (depthMm = DEPTH_MM): readonly PlaneLayer[] => [
  { thicknessMm: depthMm, n: N_WATER },
];

const spec = (na: number, overrides: Partial<MountSpec> = {}): MountSpec => ({
  mountIndex: N_WATER,
  immersionIndex: N_OIL,
  numericalAperture: na,
  wavelengthNm: LAMBDA,
  focusDepthMm: DEPTH_MM,
  ...overrides,
});

/* ── 6y.1 — the vector form against real traced rays ───────────────────────── */

// Fixed indices, so the check owns no dispersion argument: what is being pinned
// is a geometry, and a Sellmeier fit in the middle of it would be a second claim.
registerMedium(constantIndex("MOUNT-6Y", N_WATER));
registerMedium(constantIndex("IMMERSION-6Y", N_OIL));

describe("§ 6y.1 — the vector form is what the tracer does, at any obliquity", () => {
  /** One plane face: the mount below it, the immersion above. */
  const slab: Prescription = {
    objectMedium: "MOUNT-6Y",
    surfaces: [
      { kind: "refract", curvature: 0, semiAperture: Infinity, thickness: 1, medium: "IMMERSION-6Y" },
    ],
  };

  /**
   * The reduced phase Φ(q) = OPL − q·x_exit, measured on a ray the engine really
   * traced.
   *
   * That subtraction is the Legendre transform that turns a path into a phase,
   * and it is the only algebra on this side of the check: the optical path is the
   * tracer's own `opl` and the exit point is the tracer's own intersection, so
   * nothing here recomputes the refraction it is checking. The identity it must
   * land on, t·√(n²−q²), is what makes the stack's formulas a sum over layers.
   */
  const reducedPhaseFromTrace = (qx: number, qy: number, depthMm: number): number => {
    const q = Math.hypot(qx, qy);
    const sinS = q / N_WATER;
    const tanS = sinS / Math.sqrt(1 - sinS * sinS);
    const dir = vec3(q === 0 ? 0 : (qx / q) * tanS, q === 0 ? 0 : (qy / q) * tanS, 1);
    const res = traceRay(slab, makeRay(vec3(0, 0, -depthMm), dir, LAMBDA));
    expect(res.status).toBe("ok");
    const exit = res.path[0]!;
    return res.opl - (qx * exit.x + qy * exit.y);
  };

  it("reconstructs t·√(n²−q²) from a traced ray, to the f64 floor", () => {
    for (const q of [0, 0.2, 0.6, 1.0, 1.3]) {
      for (const azimuth of [0, Math.PI / 3]) {
        const qx = q * Math.cos(azimuth);
        const qy = q * Math.sin(azimuth);
        const got = reducedPhaseFromTrace(qx, qy, DEPTH_MM);
        const want = DEPTH_MM * Math.sqrt(N_WATER * N_WATER - q * q);
        expect(Math.abs(got - want)).toBeLessThan(2e-16);
      }
    }
  });

  it("is the wavefront once the reference is removed, at every azimuth", () => {
    // W = [Φ(q) − Φ(0)] − D·[√(n_out²−q²) − n_out], D the apparent distance.
    const D = (N_OIL * DEPTH_MM) / N_WATER;
    for (const q of [0.2, 0.6, 1.0, 1.3]) {
      for (const azimuth of [0, 1.1, 2.7]) {
        const qx = q * Math.cos(azimuth);
        const qy = q * Math.sin(azimuth);
        const phi = reducedPhaseFromTrace(qx, qy, DEPTH_MM);
        const phi0 = reducedPhaseFromTrace(0, 0, DEPTH_MM);
        const w = phi - phi0 - D * (Math.sqrt(N_OIL * N_OIL - q * q) - N_OIL);
        const closed = stackWavefrontVectorMm(mountLayers(), N_OIL, qx, qy);
        expect(Math.abs(w - closed)).toBeLessThan(1e-15);
      }
    }
  });
});

/* ── 6y.2 — the reduction on axis, and it is bitwise ───────────────────────── */

describe("§ 6y.2 — an axial chief invariant is the scalar path, bit for bit", () => {
  const s = spec(1.25);

  it("agrees with the scalar form on every pupil point, by delegation", () => {
    for (const px of [0, 0.13, -0.5, 0.97]) {
      for (const py of [0, 0.21, -0.77]) {
        const rho = Math.hypot(px, py);
        if (rho > 1) continue;
        expect(mountWavefrontWavesVector(s, DEPTH_MM, px, py)).toBe(
          mountWavefrontWaves(s, DEPTH_MM, rho),
        );
      }
    }
  });

  it("and an explicit zero chief is the same object, not a parallel route", () => {
    const zero: ChiefInvariant = { qx: 0, qy: 0 };
    for (const px of [0.31, 0.66]) {
      expect(mountWavefrontWavesVector(s, DEPTH_MM, px, 0, zero)).toBe(
        mountWavefrontWaves(s, DEPTH_MM, px),
      );
    }
  });

  it("leaves `withMountAberration` returning its own argument where it used to", () => {
    const flat: PupilFunction = { amplitude: () => 1, phaseWaves: () => 0 };
    // Matched mount, no truncation: the pre-§ 6y fast path, still taken.
    const matched = spec(1.0, { mountIndex: N_OIL });
    expect(withMountAberration(flat, matched, DEPTH_MM)).toBe(flat);
  });
});

/* ── 6y.3 — the classical plate coefficients ───────────────────────────────── */

/**
 * Least squares of the exact vector wavefront onto {1, ρcos φ, ρ², ρ²cos²φ,
 * ρ³cos φ, ρ⁴} over a pupil grid — the six terms the fourth power of a displaced
 * radius contains, and no others, so a residual is evidence of a higher order
 * rather than of a missing term.
 */
function fitPlateTerms(
  layers: readonly PlaneLayer[],
  nOut: number,
  na: number,
  qc: number,
  samples = 41,
): { piston: number; w311: number; w220: number; w222: number; w131: number; w040: number } {
  const rows: { basis: number[]; w: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const rho = (i + 0.5) / samples;
    for (let j = 0; j < samples; j++) {
      const phi = (2 * Math.PI * j) / samples;
      const c = Math.cos(phi);
      const qx = qc + na * rho * c;
      const qy = na * rho * Math.sin(phi);
      rows.push({
        basis: [1, rho * c, rho * rho, rho * rho * c * c, rho ** 3 * c, rho ** 4],
        w: stackWavefrontVectorMm(layers, nOut, qx, qy),
      });
    }
  }
  const m = 6;
  const ata = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const atb = new Array<number>(m).fill(0);
  for (const r of rows) {
    for (let a = 0; a < m; a++) {
      atb[a]! += r.basis[a]! * r.w;
      for (let b = 0; b < m; b++) ata[a]![b]! += r.basis[a]! * r.basis[b]!;
    }
  }
  // Gaussian elimination with partial pivoting — six unknowns, no library.
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(ata[r]![col]!) > Math.abs(ata[pivot]![col]!)) pivot = r;
    }
    [ata[col], ata[pivot]] = [ata[pivot]!, ata[col]!];
    [atb[col], atb[pivot]] = [atb[pivot]!, atb[col]!];
    for (let r = col + 1; r < m; r++) {
      const f = ata[r]![col]! / ata[col]![col]!;
      for (let cc = col; cc < m; cc++) ata[r]![cc]! -= f * ata[col]![cc]!;
      atb[r]! -= f * atb[col]!;
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = atb[r]!;
    for (let cc = r + 1; cc < m; cc++) s -= ata[r]![cc]! * x[cc]!;
    x[r] = s / ata[r]![r]!;
  }
  return {
    piston: x[0]!,
    w311: x[1]!,
    w220: x[2]!,
    w222: x[3]!,
    w131: x[4]!,
    w040: x[5]!,
  };
}

describe("§ 6y.3 — the exact form converges onto the classical plate set", () => {
  it("is 1 : 4 : 4 : 2 : 4 on A, exactly, in the closed form", () => {
    const layers = mountLayers();
    const na = 0.4;
    const qc = 0.1;
    const s = stackObliqueSeidelMm(layers, N_OIL, na, qc);
    // A read back off `stackW040Mm` at the rim rather than at q = 1: the two are
    // the same coefficient, and only one of them is a legal invariant here.
    const rim = qc + na;
    const a = stackW040Mm(layers, N_OIL, rim) / rim ** 4;
    expect(s.w040 / (a * na ** 4)).toBeCloseTo(1, 15);
    expect(s.w131 / (a * qc * na ** 3)).toBeCloseTo(4, 15);
    expect(s.w222 / (a * qc * qc * na * na)).toBeCloseTo(4, 15);
    expect(s.w220 / (a * qc * qc * na * na)).toBeCloseTo(2, 15);
    expect(s.w311 / (a * qc ** 3 * na)).toBeCloseTo(4, 15);
    expect(s.piston / (a * qc ** 4)).toBeCloseTo(1, 15);
  });

  /**
   * The relative error of each fitted term against the closed form, over a
   * geometry held similar as the aperture shrinks (q_c = NA/4, so the coma-to-
   * spherical ratio 4·q_c/NA is fixed at 1 and only the ORDER is varying).
   */
  const sweep = (na: number) => {
    const layers = mountLayers();
    const qc = na / 4;
    const want = stackObliqueSeidelMm(layers, N_OIL, na, qc);
    const got = fitPlateTerms(layers, N_OIL, na, qc);
    const rel = (k: "w040" | "w131" | "w222" | "w220" | "w311") => got[k] / want[k] - 1;
    return { w040: rel("w040"), w131: rel("w131"), w222: rel("w222"), w220: rel("w220"), w311: rel("w311") };
  };

  it("converges onto every term at fourth order — the error quarters as NA halves", () => {
    const a = sweep(0.2);
    const b = sweep(0.1);
    const c = sweep(0.05);
    for (const k of ["w040", "w131", "w222", "w220", "w311"] as const) {
      // Third order is the leading term and the next one is q² down, so the
      // relative error falls as NA². Pinned as a RATIO rather than as a level,
      // which is what separates "converging on the closed form" from "small" —
      // and the ratio approaches 4 FROM ABOVE, each halving landing closer than
      // the last, which is what separates a fourth-order tail from a fit.
      const coarse = a[k] / b[k];
      const fine = b[k] / c[k];
      expect(fine).toBeGreaterThan(4);
      expect(coarse).toBeGreaterThan(fine);
      expect(fine).toBeLessThan(4.05);
    }
    // Measured levels at NA 0.10, and the signs are the content: the two terms
    // that carry ρ² and ρ (field curvature and distortion) approach from BELOW
    // while the other three approach from above. Third order is not uniformly an
    // under- or over-estimate off axis, so a single "third order over-reports"
    // sentence — which is what § 6l.4 could say on axis — does not travel here.
    expect(b.w131).toBeCloseTo(9.7869e-3, 6);
    expect(b.w040).toBeCloseTo(9.6756e-3, 6);
    expect(b.w222).toBeCloseTo(1.1724e-2, 6);
    expect(b.w220).toBeCloseTo(-2.8623e-2, 6);
    expect(b.w311).toBeCloseTo(-2.8291e-2, 6);
  });

  it("refuses a rim that has left the stack — a coefficient for absent rays", () => {
    expect(() => stackObliqueSeidelMm(mountLayers(), N_OIL, 1.2, 0.2)).toThrow(
      /does not propagate|never leaves/,
    );
    // …while the exact form answers for the samples that DO exist and zeroes the
    // ones that do not, which is the crescent. The surviving side is NEGATIVE,
    // and that is `stackW040Mm`'s sign rule off axis: a mount RARER than the
    // immersion contributes the opposite sign to a coverslip, which is § 6l.8's
    // whole trade seen at a pupil point rather than in a budget.
    expect(mountWavefrontWavesVector(spec(1.2), DEPTH_MM, 1, 0, { qx: 0.2, qy: 0 })).toBe(0);
    expect(mountWavefrontWavesVector(spec(1.2), DEPTH_MM, -1, 0, { qx: 0.2, qy: 0 })).toBeLessThan(0);
  });
});

/* ── 6y.4 — the truncation off axis is a crescent, not an annulus ──────────── */

describe("§ 6y.4 — what the mount's ceiling cuts off axis is asymmetric", () => {
  const flat: PupilFunction = { amplitude: () => 1, phaseWaves: () => 0 };

  it("cuts one side and not the other, where a centred pupil would cut a ring", () => {
    const s = spec(1.25);
    const chief: ChiefInvariant = { qx: 0.15, qy: 0 };
    const p = withMountAberration(flat, s, DEPTH_MM, chief);
    // n_s = 1.333 is the ceiling. At +x the rim invariant is 1.25 + 0.15 = 1.40,
    // past it; at −x it is 1.10, comfortably inside.
    expect(p.amplitude(1, 0)).toBe(0);
    expect(p.amplitude(-1, 0)).toBe(1);
    // The centred version cuts neither, because the whole disc is inside 1.333.
    const centred = withMountAberration(flat, s, DEPTH_MM);
    expect(centred.amplitude(1, 0)).toBe(1);
    expect(centred.amplitude(-1, 0)).toBe(1);
  });

  it("counts the lost fraction, and it is a crescent rather than a ring", () => {
    const s = spec(1.25);
    const chief: ChiefInvariant = { qx: 0.15, qy: 0 };
    const p = withMountAberration(flat, s, DEPTH_MM, chief);
    let lostPlus = 0;
    let lostMinus = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const px = (2 * (i + 0.5)) / n - 1;
        const py = (2 * (j + 0.5)) / n - 1;
        if (px * px + py * py > 1) continue;
        if (p.amplitude(px, py) === 0) {
          if (px > 0) lostPlus++;
          else lostMinus++;
        }
      }
    }
    expect(lostMinus).toBe(0);
    expect(lostPlus).toBeGreaterThan(0);
  });
});

/* ── 6y.5 — the headline: invariance, and the rim-stopped control ──────────── */

/** § 6b's DIN 4×/0.10 — rim-stopped by construction, so the live subject. */
/**
 * The DIN 4×/0.10 **rim-stopped**, which § 6ai made a name rather than a default.
 *
 * Every rung below that uses this one needs a chief ray that leaves the specimen
 * at an ANGLE — the oblique invariant q_c is the whole subject, and on the
 * shipped telecentric lens it is a bitwise zero. So this is the negative control
 * in the strict sense: not an old spelling kept around, but the only member of
 * the pair that has the quantity being measured. § 6y.5's telecentric arm is the
 * other member, and the contrast is the rung.
 */
const din = (): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({
      magnification: 4,
      numericalAperture: 0.1,
      stopPlacement: "rim",
    }),
  }).system;

/** § 6v's infinity 4×/0.10, in both placements — the pair the claim needs. */
const infinity = (stopPlacement: StopPlacement): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement }),
    tubeLens: tubeLens(),
  }).system;

describe("§ 6y.5 — telecentricity makes the slab's wavefront field-INVARIANT", () => {
  /**
   * The heights are kept inside 0.1 mm deliberately. § 6v.5 measured a
   * telecentric bundle walking off an axially-sized front element — 11% of the
   * pupil at 1 mm on this very lens — and that is an AMPLITUDE effect. The claim
   * here is about the PHASE, so the field range is one where no glass is lost and
   * the two cannot be confused. § 6w's `fieldNumberMm` is what buys the range
   * back, and it is not this rung's subject.
   */
  const HEIGHTS = [0, 0.02, 0.05, 0.1];

  it("reads a bitwise zero chief invariant at every height, on the telecentric lens", () => {
    const sys = infinity("backFocal");
    for (const h of HEIGHTS) {
      expect(chiefRayInvariant(sys, h, LAMBDA)).toBe(0);
    }
  });

  it("so the slab's pupil phase is the SAME wavefront at every height, bit for bit", () => {
    const sys = infinity("backFocal");
    const s = spec(0.1);
    const at = (h: number, px: number): number => {
      const qc = chiefRayInvariant(sys, h, LAMBDA);
      return mountWavefrontWavesVector(s, DEPTH_MM, px, 0, { qx: qc, qy: 0 });
    };
    for (const px of [0.25, 0.5, 1]) {
      const reference = at(0, px);
      // Non-vacuous: the axial wavefront it is being compared against is real.
      expect(Math.abs(reference)).toBeGreaterThan(0);
      for (const h of HEIGHTS) expect(at(h, px)).toBe(reference);
    }
  });

  it("while the rim-stopped members tilt, linearly in field and with a sign", () => {
    for (const sys of [din(), infinity("rim")]) {
      const first = chiefRayInvariant(sys, 0.05, LAMBDA);
      expect(Math.abs(first)).toBeGreaterThan(0);
      // Linear in h: doubling the height doubles the invariant, to the third
      // order the chief ray's own path allows.
      const second = chiefRayInvariant(sys, 0.1, LAMBDA);
      expect(second / first).toBeCloseTo(2, 3);
      // …and it reverses with the field, which a magnitude could not show.
      expect(chiefRayInvariant(sys, -0.05, LAMBDA)).toBeCloseTo(-first, 15);
      expect(chiefRayInvariant(sys, 0, LAMBDA)).toBe(0);
    }
  });

  /**
   * § 6x.1 pinned the illumination offset's azimuth ("+x positive, sy under
   * 1e-15, roles swap at +y, equal components at the 45° corner") because every
   * meridional rung is blind to it. The same blindness applies here, and this is
   * § 6y's version — with one extra thing to say, because a chief invariant is a
   * DIRECTION where an illumination offset is a pupil COORDINATE. Two different
   * kinds of quantity are consumed by the same rotation in `fieldPupilAt`, so
   * that one convention serves both is a fact to check rather than a default.
   *
   * It does: both are odd in the height, so both are read at a positive radius
   * and rotated. The first draft of this rung asserted the opposite about the
   * offset and was corrected by running it.
   */
  it("composes with an azimuth exactly once, and the offset's convention is the same one", () => {
    const sys = din();
    const h = 0.1;
    const radial = chiefRayInvariant(sys, h, LAMBDA);
    // The field point at azimuth π is the SAME point the tracer reaches at −h, so
    // the rotation and the trace have to land on one vector. If the sign were
    // folded in twice this reads +radial and the tilt points the wrong way.
    const rotated = { qx: radial * Math.cos(Math.PI), qy: radial * Math.sin(Math.PI) };
    const traced = chiefRayInvariant(sys, -h, LAMBDA);
    expect(rotated.qx).toBeCloseTo(traced, 15);
    expect(Math.abs(rotated.qy)).toBeLessThan(1e-18);
    expect(traced).toBeCloseTo(-radial, 15);
    // The parallel case, carried so the shared rotation is checked and not
    // assumed: § 6x's offset is h/R_ep, so it is odd in h exactly as this is.
    expect(illuminationOffset(sys, -h, LAMBDA)).toBeCloseTo(-illuminationOffset(sys, h, LAMBDA), 15);
  });

  it("so the slab's wavefront mirrors with the field, pupil point for pupil point", () => {
    const sys = din();
    const s = spec(0.1);
    const at = (h: number, px: number): number =>
      mountWavefrontWavesVector(s, DEPTH_MM, px, 0, {
        qx: chiefRayInvariant(sys, h, LAMBDA),
        qy: 0,
      });
    for (const px of [0.3, 0.7, 1]) {
      // The physical statement the composition is FOR: mirroring the field and
      // the pupil together is the same wavefront. A sign counted twice breaks
      // this and nothing meridional would have noticed.
      expect(at(0.1, px)).toBeCloseTo(at(-0.1, -px), 18);
      // Non-vacuous: the two sides are not the same number by symmetry alone.
      expect(at(0.1, px)).not.toBe(at(0.1, -px));
    }
  });

  it("and what it costs is one ratio, 4·q_c/NA, with no stack in it", () => {
    const sys = din();
    const layers = mountLayers();
    // The DIN 4×/0.10's chief invariant is 2.184557e-3 per 0.1 mm of field, and
    // exactly linear in it — measured off the aimer, not derived.
    const qc = Math.abs(chiefRayInvariant(sys, 0.1, LAMBDA));
    expect(qc).toBeCloseTo(2.184557e-3, 9);
    const set = stackObliqueSeidelMm(layers, N_OIL, 0.1, qc);
    // Coma against spherical is 4·q_c/NA: the whole of the off-axis story in one
    // ratio, and a property of the GEOMETRY rather than of the stack — every
    // coefficient carries the same A, so it cancels. 8.738e-2 at 0.1 mm, and by
    // 1 mm of field the coma is 87% of the spherical term on the same lens.
    expect(set.w131 / set.w040).toBeCloseTo((4 * qc) / 0.1, 12);
    expect(set.w131 / set.w040).toBeCloseTo(8.73823e-2, 7);
    const far = Math.abs(chiefRayInvariant(sys, 1, LAMBDA));
    const farSet = stackObliqueSeidelMm(layers, N_OIL, 0.1, far);
    expect(farSet.w131 / farSet.w040).toBeCloseTo(0.8736, 4);
    // On the telecentric lens the same expression is a zero, from a chief
    // invariant that is itself zero. Signed, because A is negative for a mount
    // rarer than its immersion and the product keeps the sign bit.
    const tele = Math.abs(chiefRayInvariant(infinity("backFocal"), 1, LAMBDA));
    expect(Math.abs(stackObliqueSeidelMm(layers, N_OIL, 0.1, tele).w131)).toBe(0);
  });
});

/* ── 6y.6 — the coverslip is the same story, and it is the bigger one ──────── */

describe("§ 6y.6 — the slip carries this too, and a dry lens carries it further", () => {
  it("puts the slip's own coma beside the mount's, at the same field", () => {
    const sys = din();
    const qc = Math.abs(chiefRayInvariant(sys, 1, LAMBDA));
    // The DIN is dry, so the slip emerges into air: n_out = 1, and the mismatch
    // is the whole of the slip's index rather than oil-against-water.
    const slipLayers: readonly PlaneLayer[] = [{ thicknessMm: SLIP.thicknessMm, n: N_SLIP }];
    const slip = stackObliqueSeidelMm(slipLayers, 1, 0.1, qc);
    const mount = stackObliqueSeidelMm(mountLayers(), N_OIL, 0.1, qc);
    // Same geometry, so the same 4·q_c/NA — what differs is A, and by 67×: 0.17 mm
    // of glass against air against 10 µm of water against oil. They also differ in
    // SIGN, the slip being denser than what it emerges into and the mount rarer.
    expect(slip.w131 / slip.w040).toBeCloseTo(mount.w131 / mount.w040, 12);
    expect(Math.sign(slip.w131)).toBe(-Math.sign(mount.w131));
    expect(Math.abs(slip.w131 / mount.w131)).toBeCloseTo(66.61, 1);
    // In waves at the d line: the coverslip's coma at 1 mm of field is 1.18e-3
    // waves against its own 1.35e-3 of spherical — comparable, and both four
    // orders under Maréchal. § 6c's "low-power objectives are slip-insensitive"
    // survives the off-axis half rather than being confined to the axis.
    const toWaves = 1 / (LAMBDA * 1e-6);
    expect(slip.w131 * toWaves).toBeCloseTo(1.1803e-3, 6);
    expect(slip.w040 * toWaves).toBeCloseTo(1.3510e-3, 6);
  });

  it("and a matched stack is an exact zero off axis as well as on", () => {
    const matched: readonly PlaneLayer[] = [{ thicknessMm: 0.5, n: N_OIL }];
    const set = stackObliqueSeidelMm(matched, N_OIL, 0.6, 0.3);
    expect(set.w040).toBe(0);
    expect(set.w131).toBe(0);
    expect(set.w222).toBe(0);
    expect(set.w220).toBe(0);
    expect(set.w311).toBe(0);
    // …and the exact form agrees, at an obliquity where the third-order set has
    // no business being trusted on its own.
    expect(stackWavefrontVectorMm(matched, N_OIL, 0.3, 0.4)).toBe(0);
    expect(stackWavefrontErrorMm(matched, N_OIL, 0.5)).toBe(0);
  });
});
