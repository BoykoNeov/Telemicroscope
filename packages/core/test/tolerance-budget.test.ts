import { describe, it, expect } from "vitest";
import { Prescription } from "../src/trace/prescription";
import { OpticalSystem } from "../src/trace/system";
import { compile } from "../src/trace/compile";
import { paraxialTrace, systemProperties } from "../src/trace/paraxial";
import { bestFocus } from "../src/analysis/focus";
import { getMedium } from "../src/materials/catalog";
import { LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import { apochromaticObjective } from "../src/designs/apochromat";
import {
  applyPerturbations,
  centringError,
  curvatureError,
  equivalentWedgeDeg,
  groupDecentre,
  sensitivity,
  thicknessError,
  toleranceBudget,
  wedgeError,
  withTrailingReference,
  allocateEqualShare,
  type ToleranceCurrency,
  type ToleranceParameter,
} from "../src/analysis/tolerance";

/**
 * § 6au — a real tolerance budget, on the triplet `designs/apochromat` ships.
 *
 * § 6ar.6's own deferral, restated verbatim by § 6at: *"the tolerance rung is
 * one perturbation, not a tolerance budget… thicknesses, wedge, centring, and
 * the couplings between them are untouched."* Both of those steps move ONE
 * curvature and read the focal length. This one moves everything a drawing
 * carries, and it needs two things neither had.
 *
 * ## A surface edit is not a manufacturing error
 *
 * The frame chain is cumulative, so decentring surface *k* slides every later
 * surface with it and tilting it swings the whole tail. § 5t's rungs are written
 * on exactly that reading — a misaligned *group* — and it is not what a shop
 * quotes. Centring (surface *k*'s centre of curvature off the common axis) and
 * wedge (surface *k* tilted about its own vertex) are LOCAL: nothing else moves.
 * Each is therefore a group of surface edits — the error plus the edit that puts
 * the chain back — counted as ONE contributor. `analysis/tolerance` grows those
 * groups, an exact compensation derived rather than fitted, and the
 * inverse-sensitivity allocation that turns slopes into drawing numbers.
 *
 * ## Two currencies, and an apochromat is where they come apart
 *
 * § 5t prices a tolerance in wavefront error. § 6ar.6 and § 6at price it in
 * injected COLOUR. For an apochromat neither is the answer on its own: the lens
 * exists to unite three wavelengths, and a tolerance that leaves the
 * monochromatic image diffraction-limited while undoing the third glass has not
 * been paid for. Every row below is priced in both, and which one binds is the
 * step's result rather than its assumption.
 *
 * ## What is external here
 *
 *  - **The wedge deviation is exact, not thin.** With the ray normally incident
 *    on the first face, a wedge of apex α deviates it by `asin(n sin α) − α` —
 *    Snell twice and nothing else. The fixture is built so the chief ray meets
 *    the wedged face at its vertex, which is what makes the closed form exact
 *    rather than approximate.
 *  - **…and so is its colour.** The same formula at F and at C differs by the
 *    prism's dispersion, `≈ (n_F − n_C)·α`. A wedge has no power, so what it
 *    makes is LATERAL colour, and that is what a centring tolerance costs in
 *    colour.
 *  - **A decentred element is a prism of deviation δ/f** (Smith, *Modern
 *    Optical Engineering*) — thin, so a 4 mm singlet sits a few percent off it,
 *    quoted the way § 6ar.6 quotes 6% and § 6at.7 quotes 3.2%.
 *  - **A thickness error moves the power by `(n−1)²c₁c₂/n`**, the thick-lens
 *    maker's equation differentiated. Exact for a lens in air, so this one is
 *    pinned to the finite-difference floor and not to a percentage.
 *  - **Wedge and centring are ONE freedom on a sphere**, δ = −R·sin α — the same
 *    surface, not two similar ones. Counting both would double the centring rows
 *    of every budget below.
 *  - **§ 6at.8's break-even ε, re-measured on the traced thick lens.** That step
 *    computed 4.319e−3 from thin element powers; the worst curvature row here
 *    gives 4.413e−3 by tracing, 2.2% apart.
 */

const AP = 10;
/** Glass margin over the stop, so no rung is decided by a rim ray. */
const RIM = 12;
const F_RATIO = 6;

/** A convexo-plano singlet: curved front, PLANE rear. The plane rear is where
 * the wedge rungs live — the on-axis chief ray meets it at its own vertex with
 * nothing downstream, which is what makes the deviation closed form exact. */
const singlet = (glass = "N-BK7"): Prescription => {
  const p: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: RIM, thickness: 4, medium: glass, isStop: true },
      { kind: "refract", curvature: 0, semiAperture: RIM, thickness: 100, medium: "AIR" },
    ],
  };
  return { surfaces: [p.surfaces[0]!, { ...p.surfaces[1]!, thickness: systemProperties(p, LINE_D).bfd }] };
};

/** A biconvex singlet — the degeneracy rungs need a CURVED surface with a
 * carrier after it, and surface 1 here is both. */
const biconvex = (conic = 0): Prescription => {
  const p: Prescription = {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: RIM, thickness: 4, medium: "N-BK7", isStop: true },
      { kind: "refract", curvature: -1 / 60, conic, semiAperture: RIM, thickness: 100, medium: "AIR" },
    ],
  };
  return { surfaces: [p.surfaces[0]!, { ...p.surfaces[1]!, thickness: systemProperties(p, LINE_D).bfd }] };
};

const systemOf = (p: Prescription, semi = AP, nm = LINE_D): OpticalSystem => ({
  prescription: p,
  aperture: { kind: "stopRadius", value: semi },
  field: { kind: "angle", values: [0] },
  wavelengths: [{ nm, weight: 1 }],
  conjugate: { kind: "infinite" },
});

/** The shipped apochromat, with the trailing reference plane its rear surface's
 * centring and wedge need a carrier on. */
const apo = apochromaticObjective({ apertureMm: AP, focalRatio: F_RATIO });
const APO = withTrailingReference(apo.prescription);
const apoSystem = systemOf(APO, AP / 2);

const efl = (p: Prescription, nm: number): number => -1 / paraxialTrace(p, nm, { y: 1, u: 0 }).u;

/**
 * The COLOUR currency, § 6at.7's: R(λ) = f_d/f_λ − 1 against each prescription's
 * OWN d line, so the refocusable part is gone and what is left is colour a
 * refocus cannot remove. Worst over the band the triplet's three lines span.
 */
const axialColour = (p: Prescription): number => {
  const fd = efl(p, LINE_D);
  let worst = 0;
  for (let l = 430; l <= 680; l += 2.5) worst = Math.max(worst, Math.abs(fd / efl(p, l) - 1));
  return worst;
};

/** The lens's OWN residual colour — the target the colour budget is set to. */
const NOMINAL_COLOUR = axialColour(APO);

const colourCurrency: ToleranceCurrency = (_sys, groups) =>
  Math.abs(
    axialColour(applyPerturbations(APO, groups.flatMap((g) => g.perturbations))) - NOMINAL_COLOUR,
  );

/** The eleven freedoms a cemented triplet's drawing carries: four curvatures,
 * three centre thicknesses, four centring errors. NOT eight alignment rows —
 * § 6au.3 is why wedge is not a twelfth through fifteenth. */
const CURVATURES: ToleranceParameter[] = [0, 1, 2, 3].map((s) => ({
  label: `c${s + 1}`, unit: "relative" as const, at: (m: number) => curvatureError(APO, s, m), probe: 1e-5,
}));
const THICKNESSES: ToleranceParameter[] = [0, 1, 2].map((s) => ({
  label: `t${s + 1}`, unit: "mm" as const, at: (m: number) => thicknessError(APO, s, m), probe: 1e-3,
}));
const CENTRING: ToleranceParameter[] = [0, 1, 2, 3].map((s) => ({
  label: `centring s${s + 1}`, unit: "mm" as const, at: (m: number) => centringError(APO, s, m), probe: 1e-3,
}));
const ROWS = [...CURVATURES, ...THICKNESSES, ...CENTRING];

const DIFFRACTION_WAVES = 1 / 14;

describe("§ 6au.1 — a local error is a GROUP, and the compensation is exact", () => {
  it("every surface from the carrier on is back where it was, to rounding", () => {
    // The invariant the whole step rests on. A wedge is four edits and a centring
    // error two; if the compensation were first-order-only, every σ below would
    // be a wedge PLUS a misaligned tail and nothing would say so. Compiled
    // frames, not a re-derivation of the same algebra.
    const nom = compile(APO).surfaces.map((s) => s.frame);
    for (const [what, g] of [
      ["wedge", wedgeError(APO, 1, 0.3)],
      ["centring", centringError(APO, 1, 0.05)],
      ["wedge rear", wedgeError(APO, 3, 0.3)],
      ["centring rear", centringError(APO, 3, 0.05)],
    ] as const) {
      const got = compile(applyPerturbations(APO, g.perturbations)).surfaces.map((s) => s.frame);
      const from = g.perturbations[0]!.surface + 1;
      expect(from).toBeLessThan(nom.length);
      for (let i = from; i < nom.length; i++) {
        for (let k = 0; k < 9; k++) {
          expect(Math.abs(got[i]!.rotation[k]! - nom[i]!.rotation[k]!), `${what} rot ${i}`).toBeLessThan(1e-15);
        }
        for (const ax of ["x", "y", "z"] as const) {
          expect(Math.abs(got[i]!.translation[ax] - nom[i]!.translation[ax]), `${what} ${ax} ${i}`).toBeLessThan(1e-14);
        }
      }
    }
  });

  it("and only the wedged surface is tilted — the carrier is put back flat", () => {
    // The negative half of the rung above: without the −α on the carrier, the
    // decentre alone would still restore every LATER surface and the invariant
    // would pass while surface k+1 sat crooked.
    const got = compile(applyPerturbations(APO, wedgeError(APO, 1, 0.3).perturbations)).surfaces;
    const nom = compile(APO).surfaces;
    expect(Math.abs(got[1]!.frame.rotation[5]! - nom[1]!.frame.rotation[5]!)).toBeGreaterThan(1e-4);
    expect(Math.abs(got[2]!.frame.rotation[5]! - nom[2]!.frame.rotation[5]!)).toBeLessThan(1e-15);
  });

  it("the trailing reference plane is optically nothing, and inert to perturb", () => {
    // It exists so the REAR surface has somewhere to put its compensation, and it
    // earns that only by being nothing: same medium either side, zero thickness,
    // and no first-order or wavefront consequence. Its own decentre is a pure
    // lateral shift of the image plane, which the currency removes as tilt — σ is
    // exactly zero — and its own tilt costs 1.5e−11 waves. So the compensation
    // edits it carries add nothing of their own to any row below.
    expect(efl(APO, LINE_D)).toBeCloseTo(efl(apo.prescription, LINE_D), 12);
    const plain = systemOf(apo.prescription, AP / 2);
    const s = sensitivity(plain, curvatureError(apo.prescription, 0, 1e-6));
    const t = sensitivity(apoSystem, curvatureError(APO, 0, 1e-6));
    expect(Math.abs(t.sigmaWaves / s.sigmaWaves - 1)).toBeLessThan(1e-6);
    // The focus is a SEARCHED extremum, so it agrees to golden section's own
    // floor and not to twelve decimals — § 6aq.3's lesson, in passing.
    const z = (sys: OpticalSystem): number =>
      bestFocus(sys, "minRmsWavefront", { pupilSamples: 21, wavelengthNm: LINE_D }).z;
    expect(Math.abs(z(apoSystem) - z(plain))).toBeLessThan(1e-6);

    const last = APO.surfaces.length - 1;
    expect(sensitivity(apoSystem, { surface: last, target: "decenterY", delta: 0.2 }).sigmaWaves).toBe(0);
    expect(sensitivity(apoSystem, { surface: last, target: "tiltX", delta: 0.2 }).sigmaWaves).toBeLessThan(1e-10);
  });
});

describe("§ 6au.2 — a wedge deviates by asin(n sin α) − α, and it disperses", () => {
  it("the exact two-surface prism law, to nine digits", () => {
    // The fixture is built for this: the rear face is PLANE and last, so the
    // on-axis chief ray reaches it at its own vertex having been bent by nothing,
    // meets it at incidence α from inside the glass, and leaves with nothing
    // downstream to bend it again. Snell twice — no thin-prism approximation and
    // no third-order theory anywhere in the path.
    const p = withTrailingReference(singlet());
    const n = getMedium("N-BK7").n(LINE_D);
    for (const alphaDeg of [0.05, 0.2, 0.5]) {
      const a = (alphaDeg * Math.PI) / 180;
      const exact = Math.asin(n * Math.sin(a)) - a;
      const got = sensitivity(systemOf(p), wedgeError(p, 1, alphaDeg)).boresightRad;
      expect(Math.abs(got / exact - 1)).toBeLessThan(1e-9);
      // …and the thin-prism (n−1)α every text quotes is that to 0.03% here.
      expect(Math.abs(exact / ((n - 1) * a) - 1)).toBeLessThan(3e-4);
    }
  });

  it("and the SAME wedge deviates F and C apart by the prism's dispersion", () => {
    // The colour currency for a wedge, and it is not the axial one. A wedge has
    // no power, so it unites no wavelengths differently and moves no focus; what
    // it makes is LATERAL colour, and the amount is the prism's own dispersion.
    const p = withTrailingReference(singlet());
    const g = getMedium("N-BK7");
    const alphaDeg = 0.2;
    const a = (alphaDeg * Math.PI) / 180;
    const dev = (nm: number): number =>
      sensitivity(systemOf(p, AP, nm), wedgeError(p, 1, alphaDeg), { wavelengthNm: nm }).boresightRad;
    const spread = dev(LINE_F) - dev(LINE_C);
    const exact = Math.asin(g.n(LINE_F) * Math.sin(a)) - Math.asin(g.n(LINE_C) * Math.sin(a));
    expect(Math.abs(spread / exact - 1)).toBeLessThan(1e-8);
    expect(Math.abs(exact / ((g.n(LINE_F) - g.n(LINE_C)) * a) - 1)).toBeLessThan(1e-3);
  });
});

describe("§ 6au.3 — wedge and centring are ONE freedom on a sphere", () => {
  it("δ = −R sin α is the same surface, in the chief ray AND in the blur", () => {
    // A sphere is its centre and its radius. Tilting about the vertex moves the
    // centre to (0, −R sin α, R cos α); decentring by δ moves it to (0, δ, R).
    // Equal centres, equal radius, ONE surface — so a budget carrying a wedge row
    // and a centring row for the same surface has counted one freedom twice, and
    // the eleven rows below would have been fifteen.
    const p = withTrailingReference(biconvex());
    const sys = systemOf(p);
    // The chief ray does not merely agree — it is the SAME NUMBER, bit for bit,
    // at every displacement tried, because the two prescriptions put the same
    // sphere in the same place and the trace has nothing else to go on.
    for (const [delta, tol] of [[0.01, 6e-7], [0.05, 4.4e-6], [0.2, 3.9e-5]] as const) {
      const alphaDeg = equivalentWedgeDeg(p, 1, delta);
      const c = sensitivity(sys, centringError(p, 1, delta));
      const w = sensitivity(sys, wedgeError(p, 1, alphaDeg));
      expect(w.boresightRad).toBe(c.boresightRad);
      // The BLUR is not bit-identical, and what survives is second order: the
      // centre's own axial offset R(cos α − 1), and the clear aperture, which is
      // cut about the VERTEX and the two realizations put the vertex in different
      // places. It grows from 5.9e−7 at 10 µm to 3.9e−5 at 200 µm — faster than
      // linear, slower than square, because those two sources scale differently.
      // The chief-ray form is the one pinned exactly, since the rim cannot reach it.
      expect(Math.abs(w.sigmaWaves / c.sigmaWaves - 1)).toBeLessThan(tol);
      expect(c.sigmaWaves).toBeGreaterThan(1e-4);
    }
  });

  it("a PLANE has no centring equivalent, and a CONIC breaks the blur equality", () => {
    // Two negative controls that fail in different directions. δ = −R sin α
    // diverges as R → ∞: decentring a plane is a no-op, so no centring error
    // imitates a plane's wedge and the conversion refuses rather than returning a
    // huge number. And the degeneracy is a property of SPHERICITY — a conic of
    // revolution tilted about its vertex is not that conic translated. It breaks
    // where a conic differs from its own osculating sphere, which is off axis, so
    // the CHIEF RAY barely notices — 2e−6, against bit-identical on a sphere —
    // while the blur is 5.1× out. § 5t's
    // conic rung sits on the other side of that same statement.
    const flat = withTrailingReference(singlet());
    expect(() => equivalentWedgeDeg(flat, 1, 0.05)).toThrow(/plane/);

    const p = withTrailingReference(biconvex(-6));
    const sys = systemOf(p);
    const delta = 0.05;
    const c = sensitivity(sys, centringError(p, 1, delta));
    const w = sensitivity(sys, wedgeError(p, 1, equivalentWedgeDeg(p, 1, delta)));
    // Bit-identical on the sphere; here only 2e−6, because a conic is genuinely
    // a different surface — but 2e−6 against 5.1× is the whole point: the break
    // lives where a conic departs from its own osculating sphere, which is off
    // axis, and the chief ray never goes there.
    expect(Math.abs(w.boresightRad / c.boresightRad - 1)).toBeLessThan(1e-5);
    expect(Math.abs(w.boresightRad / c.boresightRad - 1)).toBeGreaterThan(1e-8);
    expect(w.sigmaWaves / c.sigmaWaves).toBeCloseTo(5.10, 1);
  });
});

describe("§ 6au.4 — a decentred element is a prism of deviation δ/f", () => {
  it("the thin-lens prism law, and the thick singlet's gap from it", () => {
    // Smith's rule: displacing a thin lens by δ puts a prism of deviation δ·φ in
    // the beam. The WHOLE element moves here — both faces — which is why it needs
    // `groupDecentre` and not a per-surface row, and why a cemented triplet gets
    // no such row at all: its joints belong to two elements at once.
    const p = withTrailingReference(biconvex());
    const sys = systemOf(p);
    const f = systemProperties(p, LINE_D).efl;
    for (const delta of [0.05, 0.1, 0.2]) {
      const got = sensitivity(sys, groupDecentre(p, 0, 1, delta)).boresightRad;
      expect(Math.abs(got / (delta / f) - 1)).toBeLessThan(0.05);
    }
  });

  it("a rigid lateral shift is a null only for a PERFECT lens", () => {
    // § 5t measured σ ≈ 2e−11 for decentring the stop of a paraboloid and read it
    // as the pupil moving with the surface. Half of that is right and the half
    // that matters is the nominal being perfect. The pupil is a set of aiming
    // coordinates fixed in SPACE, so sliding an aberrated lens sideways samples
    // its own residual off centre — a quartic on a displaced disc is not a
    // quartic, which is § 6y's sentence in a different section. On the triplet
    // that costs 3.91e−2 waves per mm, linear in the shift; on the paraboloid,
    // where there is no residual to sample, it is nothing.
    const R = -200;
    const paraboloid: Prescription = {
      surfaces: [{ kind: "reflect", curvature: 1 / R, conic: -1, semiAperture: 10, thickness: R / 2, isStop: true }],
    };
    const perfect: OpticalSystem = {
      prescription: paraboloid,
      aperture: { kind: "stopRadius", value: 10 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    };
    expect(sensitivity(perfect, { surface: 0, target: "decenterY", delta: 0.2 }).sigmaWaves).toBeLessThan(1e-9);

    const slope = (d: number): number =>
      sensitivity(apoSystem, { surface: 0, target: "decenterY", delta: d }).sigmaWaves / d;
    expect(slope(0.05)).toBeCloseTo(3.913e-2, 4);
    expect(slope(0.1) / slope(0.05)).toBeCloseTo(1, 3);
  });
});

describe("§ 6au.5 — a thickness error against the differentiated maker's equation", () => {
  it("d(1/f)/dt = (n−1)²c₁c₂/n, to the finite-difference floor", () => {
    // The thickness analogue of § 6ar.6's curvature amplification, and it is
    // tighter because the thick-lens maker's equation is EXACT for a lens in air:
    // 1/f = (n−1)[c₁ − c₂ + (n−1)·t·c₁c₂/n]. Differentiating in t leaves a
    // constant, so the only error in the comparison is the central difference's
    // own O(h²) — this rung is pinned to that floor and not to a percentage.
    const p = biconvex();
    const n = getMedium("N-BK7").n(LINE_D);
    const closed = ((n - 1) ** 2 * p.surfaces[0]!.curvature * p.surfaces[1]!.curvature) / n;
    const h = 1e-3;
    const power = (dt: number): number =>
      1 / efl(applyPerturbations(p, thicknessError(p, 0, dt).perturbations), LINE_D);
    expect(Math.abs((power(h) - power(-h)) / (2 * h) / closed - 1)).toBeLessThan(1e-6);
  });
});

describe("§ 6au.6 — the budget: eleven rows, two currencies, and which one binds", () => {
  it("every row is priced in both, and neither currency binds all of them", () => {
    // The step's result. Each row is normalized by its own currency's TARGET —
    // the diffraction limit λ/14 for blur, the lens's own residual colour for
    // colour — which makes the two comparable without extrapolating either to an
    // allowance. Whichever normalized slope is larger is the constraint the shop
    // actually has to meet.
    //
    // Seven rows are set by COLOUR and four by BLUR, and the two are 3.6× to 26×
    // apart where they compete. The curvatures are the tight ones: c2 spends 227
    // times its colour budget per unit against 22 times its blur budget, so
    // holding the monochromatic image diffraction-limited leaves the third glass
    // undone by an order of magnitude.
    const colour = allocateEqualShare(apoSystem, ROWS, NOMINAL_COLOUR, {}, colourCurrency);
    const blur = allocateEqualShare(apoSystem, ROWS, DIFFRACTION_WAVES);
    const norm = ROWS.map((_r, i) => ({
      colour: colour.rows[i]!.perUnit / NOMINAL_COLOUR,
      blur: blur.rows[i]!.perUnit / DIFFRACTION_WAVES,
    }));
    const binds = norm.map((n) => (n.colour > n.blur ? "colour" : "blur"));
    expect(binds).toEqual([
      "colour", "colour", "colour", "colour", // the four curvatures
      "colour", "colour", "blur", //            t1, t2 — but not t3
      "blur", "blur", "blur", "blur", //        the four centring rows
    ]);
    // The two glasses whose joint carries the most power are the tight rows, and
    // the ratio is how badly a blur-only budget would under-specify them.
    expect(norm[1]!.colour).toBeCloseTo(226.6, 0);
    expect(norm[1]!.colour / norm[1]!.blur).toBeCloseTo(10.08, 1);
    expect(norm[2]!.colour / norm[2]!.blur).toBeCloseTo(16.76, 1);
    // …and the alignment rows are invisible to colour, exactly, so blur is not
    // merely the tighter constraint there but the ONLY one.
    for (const i of [7, 8, 9, 10]) expect(norm[i]!.colour).toBe(0);
    expect(norm[8]!.blur).toBeCloseTo(7.78, 1);
  });

  it("the allowance is an extrapolation, and the allocation checks its own", () => {
    // `allocateEqualShare` divides the budget and inverts a slope, which is a
    // linear extrapolation from a probe a thousand times smaller. It re-measures
    // the currency AT the allowance rather than trusting itself, and on this lens
    // every row comes back within 3% except the two whose allowance is larger
    // than the part — t2 at 11 mm of glass on a 1.2 mm element (0.54) and the
    // rear centring row at 4.9 mm (0.68). Those two numbers are not tolerances:
    // they say the diffraction budget does not constrain those parameters, and
    // the mechanical drawing does.
    const blur = allocateEqualShare(apoSystem, ROWS, DIFFRACTION_WAVES);
    for (const i of [0, 1, 2, 3, 4, 6, 7, 8, 9]) {
      expect(Math.abs(blur.rows[i]!.linearity - 1), blur.rows[i]!.label).toBeLessThan(0.03);
    }
    expect(blur.rows[5]!.allowance).toBeGreaterThan(5); // t2: 11 mm of extra glass
    expect(blur.rows[5]!.linearity).toBeLessThan(0.6);
    expect(blur.rows[10]!.linearity).toBeLessThan(0.7);
  });

  it("and the worst curvature row reproduces § 6at.8's break-even to 2.2%", () => {
    // The cross-pin, and the reason the colour currency here is worth trusting.
    // § 6at.8 computed the relative curvature error at which the colour a triplet
    // INJECTS equals the colour it was built to remove — 4.319e−3 — from thin
    // element powers at the shallowest bending. This traces the shipped f/6 lens
    // at its spherical-aberration-nulled bending and asks the same question of
    // the worst of its four surfaces. Two different routes, 2.2% apart.
    const colour = allocateEqualShare(apoSystem, CURVATURES, NOMINAL_COLOUR, {}, colourCurrency);
    const worst = Math.max(...colour.rows.map((r) => r.perUnit));
    const breakEven = NOMINAL_COLOUR / worst;
    expect(breakEven).toBeCloseTo(4.413e-3, 5);
    expect(Math.abs(breakEven / 4.319e-3 - 1)).toBeLessThan(0.03);
  });

  it("a centring error's colour is LATERAL, and the axial zero is a readout limit", () => {
    // The four zeros above are exact, and stating them without this rung would be
    // dishonest: `paraxialTrace` is first order about the axis and does not read
    // tilt or decentre at all, so a rotationally-symmetric colour readout CANNOT
    // see a centring error. What it misses is real and is measured here by ray
    // trace: 50 µm on the front surface deviates the chief ray by 1.11e−3 rad,
    // and F and C leave 1.17e−5 rad apart — 1.05% of the deviation, the same
    // dispersive fraction § 6au.2 pinned in closed form on a wedge.
    const g = centringError(APO, 0, 0.05);
    const dev = (nm: number): number =>
      sensitivity(systemOf(APO, AP / 2, nm), g, { wavelengthNm: nm }).boresightRad;
    const d = dev(LINE_D);
    const spread = dev(LINE_F) - dev(LINE_C);
    expect(d).toBeCloseTo(1.111e-3, 6);
    expect(spread).toBeCloseTo(1.169e-5, 7);
    expect(spread / d).toBeCloseTo(0.01052, 4);
    // …while the axial colour it injects is zero to the last bit.
    expect(colourCurrency(apoSystem, [g])).toBe(0);
  });
});

describe("§ 6au.7 — the couplings, and the support they are measured on", () => {
  it("the eleven rows CANCEL: the combined trace is 0.76 of the RSS", () => {
    // § 5t's RSS rung is two orthogonal modes on a perfect nominal. Eleven rows on
    // a real lens are neither orthogonal nor independent, and the direction of the
    // failure is the interesting part: the combined trace comes in BELOW the RSS,
    // so the independence estimate is pessimistic here — the same sign § 5t's app
    // probe found on the achromat and for the same reason, several rows producing
    // spherical of opposite sign. The factor belongs to this lens, not to the
    // method, so it is measured and not offered as a law.
    const scale = 1e-2;
    const colour = allocateEqualShare(apoSystem, [...CURVATURES, ...THICKNESSES], NOMINAL_COLOUR * scale, {}, colourCurrency);
    const blur = allocateEqualShare(apoSystem, CENTRING, DIFFRACTION_WAVES * scale);
    const groups = [
      ...colour.rows.map((r, i) => [...CURVATURES, ...THICKNESSES][i]!.at(r.allowance)),
      ...blur.rows.map((r, i) => CENTRING[i]!.at(r.allowance)),
    ];
    const b = toleranceBudget(apoSystem, groups);
    expect(b.contributions).toHaveLength(11);
    expect(b.combinedWaves / b.rssWaves).toBeCloseTo(0.763, 2);
    expect(colour.couplingRatio).toBeCloseTo(0.378, 2);
  });

  it("…and every σ in that comparison is on ONE support, which is why it means something", () => {
    // The control the finding above needs. Contributions vignette the pupil
    // differently, and variances add exactly only over a common support, so a
    // gap between RSS and combined has a third explanation until the supports are
    // intersected. At a hundredth of the budget nothing is lost — 313 points, none
    // dropped — and at a tenth the tilted rows start clipping and 19 go, which is
    // what the intersection is for.
    const small = allocateEqualShare(apoSystem, CENTRING, DIFFRACTION_WAVES * 1e-2);
    const tenth = allocateEqualShare(apoSystem, CENTRING, DIFFRACTION_WAVES * 1e-1);
    const bs = toleranceBudget(apoSystem, small.rows.map((r, i) => CENTRING[i]!.at(r.allowance)));
    const bt = toleranceBudget(apoSystem, tenth.rows.map((r, i) => CENTRING[i]!.at(r.allowance)));
    expect(bs.pointsRetained).toBe(313);
    expect(bs.pointsDropped).toBe(0);
    expect(bt.pointsDropped).toBeGreaterThan(0);
    expect(bt.pointsRetained).toBeLessThan(bs.pointsRetained);
    for (const c of bt.contributions) expect(c.pointsOwn).toBeGreaterThanOrEqual(bt.pointsRetained);
  });
});
