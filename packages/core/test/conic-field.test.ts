import { describe, it, expect } from "vitest";
import { seidelSums } from "../src/analysis/seidel";
import { fieldSurfaces, thirdOrderSags } from "../src/analysis/field";
import { schmidt } from "../src/designs/schmidt";
import { cassegrain } from "../src/designs/cassegrain";
import { ritcheyChretien } from "../src/designs/ritchey";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";

/**
 * The reflectors' field aberrations — docs/VALIDATION.md § 5j.3.
 *
 * Every reflecting preset (§ 4b, § 5e, § 5f, § 5i) closed with the same
 * sentence: astigmatism and field curvature are *present in the trace and
 * unpinned*, because § 6ac's closed-form half runs through `seidelSums` and
 * that module refused a conic outright. It no longer does, and this file is
 * what the refusal was standing in front of.
 *
 * Nothing here is a new measurement. `fieldSurfaces` has traced both focal
 * surfaces of these systems since § 6ac; what arrives is the *other* machinery
 * — a paraxial y–u recursion carrying a quartic figure term — and four closed
 * forms with no engine in them for the two to be checked against:
 *
 *  1. **A mirror stopped at itself has a FLAT sagittal field**, at every conic.
 *     S_III + S_IV is n²ū²y²c(n′ − n)(n + n′)/(n·n′²) for a single surface with
 *     the stop on it and the object at infinity — a finite conjugate replaces
 *     the y·c by (u + y·c) and keeps the (n + n′) — and a mirror is n′ = −n. So
 *     x_s = 0 and x_t = −2·x_p
 *     identically: the tangential surface lies OUTSIDE the paraxial focus while
 *     the Petzval surface lies inside, and the field the eye sees is neither.
 *  2. **The Schmidt camera's film holder has radius f.** With the stop at the
 *     mirror's centre of curvature the chief ray strikes the mirror normally,
 *     so it is undeviated and the whole design is anastigmatic — the residual
 *     is the corrector's own GLASS PATH, and that is a closed form too (below).
 *     What survives is Petzval, and its radius is the mirror's focal length.
 *  3. **The classical Cassegrain's conics null ΣS_I**; the Ritchey-Chrétien's
 *     null ΣS_I and ΣS_II together. Both conic pairs come from the presets'
 *     published formulas, and third-order theory reaches the same verdict
 *     through machinery that shares no line with them.
 *  4. **Neither pair touches astigmatism**, which is what makes an RC an
 *     aplanat and not an anastigmat — § 5f measured that by trace and could not
 *     say why.
 */

const LAM = 550;

/* ────────────────── a bare paraboloid at prime focus ────────────────── */

const PRIME_R = 1600;
const PRIME_D = 200; // f/4, the Newtonian preset's own primary
/** The glass is wider than the beam, so an edge ray cannot be lost to a tie. */
const primary = (K: number, h: number): Prescription => ({
  surfaces: [
    {
      kind: "reflect",
      curvature: -1 / PRIME_R,
      conic: K,
      semiAperture: h * 1.05,
      thickness: -PRIME_R / 2,
      isStop: true,
    },
  ],
});
const primarySystem = (K: number, h: number = PRIME_D / 2): OpticalSystem => ({
  prescription: primary(K, h),
  aperture: { kind: "stopRadius", value: h },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm: LAM, weight: 1 }],
  conjugate: { kind: "infinite" },
});

const PRIME_FIELDS = [0.05, 0.1, 0.2, 0.4] as const;
const rad = (deg: number): number => (deg * Math.PI) / 180;

describe("§ 5j.3 — the paraboloid's field: flat sagittal, tangential the other way", () => {
  it("puts the sagittal surface ON the paraxial focal plane, at every conic", () => {
    // The closed form has no conic in it — every aspheric field term carries the
    // chief ray height, which is zero at the stop — so the sphere, the parabola
    // and a wild oblate figure must all report the same flat sagittal surface.
    for (const K of [0, -1, -2, 0.7] as const) {
      for (const deg of PRIME_FIELDS) {
        const sags = thirdOrderSags(primarySystem(K), deg, LAM);
        expect(Math.abs(sags.sagittalMm)).toBeLessThan(1e-14 * Math.abs(sags.petzvalMm));
      }
    }
  });

  it("puts the Petzval surface at radius R/2 = f, curving toward the mirror", () => {
    // x_p = −θ²R/4 with the image height η = f·θ, so η²/(2·x_p) = −f: the
    // Petzval radius of a single mirror is its own focal length. This is the
    // number a Schmidt's curved film holder is cut to (below), read here off the
    // bare mirror where nothing else is in the way.
    const f = PRIME_R / 2;
    for (const deg of PRIME_FIELDS) {
      const sags = thirdOrderSags(primarySystem(-1), deg, LAM);
      expect(sags.petzvalMm).toBeCloseTo((-(rad(deg) ** 2) * PRIME_R) / 4, 12);
      const eta = f * rad(deg);
      expect((eta * eta) / (2 * sags.petzvalMm)).toBeCloseTo(-f, 6);
    }
  });

  it("and the tangential surface twice as far the OTHER way — x_t = −2·x_p", () => {
    // x_t − x_p = 3(x_s − x_p) is the classical 3:1, and with x_s = 0 it forces
    // the tangential surface to the far side of the paraxial plane. A ratio test
    // alone would pass with both signs flipped, so the side is asserted too.
    for (const deg of PRIME_FIELDS) {
      const sags = thirdOrderSags(primarySystem(-1), deg, LAM);
      expect(sags.tangentialMm).toBeCloseTo(-2 * sags.petzvalMm, 12);
      expect(sags.petzvalMm).toBeLessThan(0);
      expect(sags.tangentialMm).toBeGreaterThan(0);
    }
  });

  /** Traced sags and the closed form beside them, at three apertures. */
  const traced = ([100, 50, 25] as const).map((h) => {
    const surfaces = fieldSurfaces(primarySystem(-1, h), [...PRIME_FIELDS], LAM, { fanSamples: 41 });
    return {
      h,
      rows: surfaces.foci.map((focus) => ({
        focus,
        pred: thirdOrderSags(primarySystem(-1, h), focus.fieldValue, LAM),
      })),
    };
  });

  it("THE DEFERRAL: the traced tangential surface reproduces the closed form", () => {
    // § 4b and § 5e both close on "what is missing is the external number, not
    // the measurement". This is the measurement meeting the number. The on-axis
    // reference is exact here in a way § 6ac's achromat's was not — a paraboloid
    // is stigmatic on axis, so best-spot focus IS the paraxial plane and the sags
    // carry no reference offset at all. At f/16 the two agree to 0.1%.
    const slow = traced[2]!;
    for (const { focus, pred } of slow.rows) {
      expect(focus.lost).toBe(0);
      expect(Math.abs(focus.tangentialSagMm / pred.tangentialMm - 1)).toBeLessThan(1.2e-3);
    }
  });

  it("…and the gap is the APERTURE's, not the field's: 1.5% at f/4, ×¼ per halving", () => {
    // The closed-form sags contain no aperture at all — x_t = θ²R/2 — so a
    // departure that scales with the aperture is the trace carrying a term the
    // theory omits, and its power says which. Two readings make that case rather
    // than one tolerance: at a fixed aperture the excess is the SAME fraction at
    // every field over an 8× range (so it is not a field term hiding), and it
    // falls 4× for every halving of the aperture (so it is quadratic in it —
    // the η²ρ⁴ oblique spherical aberration, fifth order, exactly the term
    // third-order theory drops).
    const excess = traced.map((t) => t.rows.map(({ focus, pred }) => focus.tangentialSagMm / pred.tangentialMm - 1));
    // Read at f/4, where the h² term is the whole story: 0.11% of drift across
    // 0.05° → 0.4°. It is asserted THERE and not at the slower apertures on
    // purpose — the h² term shrinks 16× across this scan and a θ⁴ one does not,
    // so by f/16 the drift is 1.8% of a residual that is itself sixteen times
    // smaller. Quoting the tight bound at every aperture would be claiming the
    // fifth-order term is the only one left, which the drift itself refutes.
    const fast = excess[0]!;
    expect((Math.max(...fast) - Math.min(...fast)) / Math.max(...fast)).toBeLessThan(2e-3);
    expect(excess[0]![0]!).toBeCloseTo(1.5248e-2, 5);
    for (let i = 1; i < excess.length; i++) {
      expect(Math.abs(excess[i - 1]![0]! / excess[i]![0]! / 4 - 1)).toBeLessThan(0.02);
    }
  });

  it("…and the traced sagittal sag is that same fifth-order term, on a surface predicted FLAT", () => {
    // The closed form says exactly zero, so whatever the trace reads there is
    // pure residue — and it is the same residue: θ²·h², growing 4× per doubling
    // of field and shrinking 4× per halving of the aperture. That is what makes
    // "the sagittal field of a mirror is flat" a statement about the mirror
    // rather than about how hard anyone looked: at f/4 the reading is 0.2% of
    // the tangential sag, and it is on its way to nothing.
    for (const t of traced) {
      for (let i = 1; i < t.rows.length; i++) {
        const r = t.rows[i]!.focus.sagittalSagMm / t.rows[i - 1]!.focus.sagittalSagMm;
        const step = (t.rows[i]!.focus.fieldValue / t.rows[i - 1]!.focus.fieldValue) ** 2;
        expect(Math.abs(r / step - 1)).toBeLessThan(1e-3);
      }
    }
    for (let i = 1; i < traced.length; i++) {
      const r = traced[i - 1]!.rows[0]!.focus.sagittalSagMm / traced[i]!.rows[0]!.focus.sagittalSagMm;
      expect(Math.abs(r / 4 - 1)).toBeLessThan(0.01);
    }
    for (const { focus } of traced[0]!.rows) {
      expect(Math.abs(focus.sagittalSagMm)).toBeLessThan(5e-3 * Math.abs(focus.tangentialSagMm));
    }
  });
});

/* ─────────────────────── the Schmidt camera ─────────────────────── */

const SCH_D = 200;
const SCH_F = 3;

describe("§ 5j.3 — the Schmidt camera is an anastigmat, and its residual is the glass", () => {
  const sch = schmidt({ apertureMm: SCH_D, focalRatio: SCH_F });
  const R = sch.mirrorRadiusMm;
  const h = SCH_D / 2;

  const sums = (t: number, deg: number) =>
    seidelSums(schmidt({ apertureMm: SCH_D, focalRatio: SCH_F, plateThicknessMm: t }).prescription, LAM, {
      marginalHeightMm: h,
      fieldAngleRad: rad(deg),
    });

  it("nulls coma and astigmatism in the thin-plate limit, and the departure is a CLOSED FORM", () => {
    // The chief ray leaves the stop at the mirror's centre of curvature, so it
    // would strike the mirror normally and be undeviated — Ā = 0, and every
    // off-axis sum with it. What breaks that is the plate's own glass path: a
    // flat of thickness t displaces the chief ray by t(1 − 1/n), so
    //
    //     Ā = θ·t(n − 1)/(n·R)   ⟹   ΣS_II = −2h³Ā/R² ,  ΣS_III = 2h²Ā²/R
    //
    // exactly, the two flats contributing nothing (no power, so Δ(u/n) = 0 on a
    // collimated marginal ray) and the plate's r⁴ figure contributing to S_I
    // alone (ȳ = 0 at the stop). Coma is linear in the plate thickness and
    // astigmatism quadratic, which is the shape a fudge factor cannot have.
    const n = sch.correctorIndex;
    const deg = 0.3;
    for (const t of [4, 2, 1, 0.25] as const) {
      const Ab = rad(deg) * t * (n - 1) / (n * R);
      const s = sums(t, deg);
      expect(s.s2).toBeCloseTo((-2 * h ** 3 * Ab) / R ** 2, 14);
      expect(s.s3).toBeCloseTo((2 * h * h * Ab * Ab) / R, 16);
    }
  });

  it("so both vanish as the plate thins — 16× in coma, 256× in astigmatism, per 16×", () => {
    const thick = sums(4, 0.3);
    const thin = sums(0.25, 0.3);
    expect(Math.abs(thick.s2 / thin.s2)).toBeCloseTo(16, 6);
    expect(Math.abs(thick.s3 / thin.s3)).toBeCloseTo(256, 4);
    // Against the sum that does NOT thin with the plate: Petzval is the mirror's
    // alone, and it is the same double at both thicknesses.
    expect(thin.s4).toBe(thick.s4);
  });

  it("leaves the curved focal surface the design is famous for: radius f", () => {
    // A Schmidt's film is held on a spherical former of radius equal to the
    // focal length. With astigmatism gone, all three surfaces coincide with
    // Petzval, so that former is the Petzval surface — and the number is the
    // bare mirror's from the block above, arriving through a three-surface
    // prescription with a corrector on the front.
    const system: OpticalSystem = {
      prescription: sch.prescription,
      aperture: { kind: "stopRadius", value: h },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LAM, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    const f = sch.focalLengthMm;
    for (const deg of [0.1, 0.2, 0.4] as const) {
      const sags = thirdOrderSags(system, deg, LAM);
      const eta = f * rad(deg);
      expect((eta * eta) / (2 * sags.petzvalMm)).toBeCloseTo(-f, 6);
      // …and the sagittal surface is on it, to the plate's own small residual.
      expect(Math.abs(sags.sagittalMm / sags.petzvalMm - 1)).toBeLessThan(1e-5);
    }
  });
});

/* ─────────────────── the two-mirror telescopes ─────────────────── */

const TWO_MIRROR = { apertureMm: 200, focalRatio: 12, primaryFocalRatio: 4, backFocusMm: 250 } as const;

describe("§ 5j.3 — the two-mirror conics, checked by the machinery that did not choose them", () => {
  const cass = cassegrain(TWO_MIRROR);
  const rc = ritcheyChretien(TWO_MIRROR);
  const h = TWO_MIRROR.apertureMm / 2;
  const DEG = 0.3;

  /** The same layout with both mirrors left spherical — the scale to judge a null against. */
  const spherical: Prescription = {
    surfaces: cass.prescription.surfaces.map((s) => ({ ...s, conic: 0 })),
  };

  const at = (p: Prescription) =>
    seidelSums(p, LAM, { marginalHeightMm: h, fieldAngleRad: rad(DEG) });

  it("the spherical control is aberrated, so a null below it means something", () => {
    const s = at(spherical);
    expect(Math.abs(s.s1)).toBeGreaterThan(1e-3);
    expect(Math.abs(s.s2)).toBeGreaterThan(1e-6);
  });

  it("the classical Cassegrain's confocal conics null ΣS_I and leave ΣS_II standing", () => {
    const ref = at(spherical);
    const s = at(cass.prescription);
    expect(Math.abs(s.s1)).toBeLessThan(1e-14 * Math.abs(ref.s1));
    // Coma is exactly what the classical design does NOT correct, and the whole
    // Newtonian/Cassegrain coma ladder (§ 4b, § 5e) is about its size.
    expect(Math.abs(s.s2)).toBeGreaterThan(0.1 * Math.abs(ref.s2));
  });

  it("THE APLANAT: the RC's conics null ΣS_I and ΣS_II together", () => {
    const ref = at(spherical);
    const s = at(rc.prescription);
    expect(Math.abs(s.s1)).toBeLessThan(1e-13 * Math.abs(ref.s1));
    expect(Math.abs(s.s2)).toBeLessThan(1e-13 * Math.abs(ref.s2));
    // The conics themselves were never handed to this module as a target: they
    // come from ritchey.ts's published formula, and the sums are a paraxial
    // recursion that has never heard of aplanatism.
    expect(rc.primaryConic).toBeLessThan(-1);
    expect(rc.secondaryConic).toBeLessThan(cass.secondaryConic);
  });

  it("and NEITHER pair touches astigmatism — the reason an RC is not an anastigmat", () => {
    // CONSISTENCY CHECK, not an external pin: both numbers come from this
    // module. What it does say independently is that § 5f's traced ratio — the
    // RC's astigmatism 1.1–1.2× the classical Cassegrain's at the same D and F —
    // is a third-order fact and not a fifth-order accident, and that the Petzval
    // sum is identical to the bit, the conics having no power in them.
    const c = at(cass.prescription);
    const r = at(rc.prescription);
    expect(r.s4).toBe(c.s4);
    expect(r.s3 / c.s3).toBeGreaterThan(1.05);
    expect(r.s3 / c.s3).toBeLessThan(1.3);
  });
});
