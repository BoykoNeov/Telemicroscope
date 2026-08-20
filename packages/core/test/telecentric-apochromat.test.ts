import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription, SurfaceSpec } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { paraxialImageOffset } from "../src/analysis/focus";
import { seidelSums } from "../src/analysis/seidel";
import { lateralMagnification } from "../src/pupil/microscope";
import { diskSource } from "../src/illumination/source";
import { achromaticObjective } from "../src/designs/achromat";
import { apochromaticObjective, cementedTripletForm } from "../src/designs/apochromat";
import { formBrightfieldPlane } from "../src/imaging/brightfield-spectrum";
import { getMedium } from "../src/materials/catalog";
import { abbeNumber, LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import type { SpectralSpecimen } from "../src/imaging/specimen";

/**
 * Step 6aq — an apochromatic telecentric tail.
 *
 * § 6ap's "not yet pinned" list names it: *three glasses unite three
 * wavelengths, so FFD(λ) would have two interior turning points and the stop
 * could sit at a value it takes FOUR times. Whether the visible band is wide
 * enough to contain them all is the question, and nothing here answers it.*
 *
 * **The shape was predicted right and the count was wrong.** FFD(λ) does get a
 * second turning point, and both of them do land inside the visible band. But a
 * curve with two turns is cut by a horizontal line at most THREE times, not four
 * — four crossings need three turns, which is four united wavelengths and not
 * three. So the deferral's own arithmetic is what this step corrects: a stop is
 * telecentric at three wavelengths here, and the number is bounded by the turn
 * count rather than by the band being wide enough.
 *
 * Three at once, and they are 454.97, 587.56 and 678.03 nm for the stop at the
 * d line's front focal distance — § 6ap's placement, unchanged, giving one more
 * pole because the tail has one more glass. The defocus rescale then reverses
 * sign three times rather than twice, and the placements that make a root double
 * — § 6ap.5's touched pole — now come in two kinds, because there are two turns
 * to sit on.
 *
 * ## The external numbers
 *
 *  - **The catalogue's three-glass power split**: Σφᵢ = φ, Σφᵢ/Vᵢ = 0 and
 *    Σφᵢ·Pᵢ/Vᵢ = 0 solved on two Abbe numbers and two partial dispersions per
 *    glass and nothing else, for what the triplet's powers tend to as the glass
 *    goes thin (§ 6aq.1). The thick solve is 1.5% off it, and that gap is
 *    thickness — halved when the thicknesses are halved, five times over.
 *  - **Gaussian optics on Sellmeier's n(λ)**: the 2×2 ray-transfer product for a
 *    four-surface cemented triplet, for the focal length and the front focal
 *    distance the paraxial solve is confirmed against (§ 6aq.2) and the 1/R(λ)
 *    the traced magnification is measured against (§ 6aq.5). Nothing traced.
 *  - **Welford's third-order S_I**, for the bending — the same solve
 *    `designs/achromat` uses, on the real thick prescription (§ 6aq.7).
 *  - **§ 6ap's own doublet**, `designs/achromat`'s computed pair at the same
 *    focal length and conjugate, as the one-turn control every "one more turn"
 *    below is measured against.
 *
 * ## No new engine code
 *
 * `packages/core` was byte-for-byte what § 6ap left. What was new in this file
 * and was not in § 6ap's is that the fixture carried **its own design solve**:
 * there was no `designs/apochromat` to borrow, so the triplet's three curvatures
 * were solved here from the catalogue split and Newton's method on the paraxial
 * first order. That is why § 6aq.2 exists — a design solved on `paraxialTrace`
 * and then measured with `paraxialTrace` would be pinned to nothing, so the
 * closed-form matrix confirms it before any claim rests on it.
 *
 * **§ 6ar shipped that solve as `designs/apochromat`, and this file now calls
 * it.** Every number below is § 6aq's own, unchanged — which is the point: the
 * constructor had to reproduce the fixture to the digit before the fixture was
 * allowed to depend on it, and § 6ar.7 is the rung that says so. What is still
 * solved locally is § 6aq.3's 1044-design SURVEY, which is a bulk sweep over
 * glass orders and thicknesses rather than a design, and has no business being a
 * catalogue entry.
 */

const STOP_R = 2;
const OBJECT_DISTANCE = 400;
const SIZE = 32;
const PUPIL_SAMPLES = 16;
const S = 0.5;
const SOURCE = diskSource(S, 15);
const ORIGIN = { x: 0, y: 0 } as const;
/** § 6al's probe height, so these magnifications are § 6an's and § 6ap's. */
const PROBE_MM = OBJECT_DISTANCE * 1e-4;
const CLEAR: SpectralSpecimen = () => ({ re: 1, im: 0 });

/** Front focal distance of a group — § 6an's own −d/c form, on four surfaces. */
const ffd = (g: Prescription, nm: number): number =>
  -paraxialTrace(g, nm, { y: 0, u: 1 }).u / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
/** Paraxial EFL of a group. */
const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/**
 * The tail: a cemented CaF₂ / F2 / N-BK7 triplet at § 6ap's focal length and
 * aperture, so nothing but the glass count changes between the two steps.
 *
 * CaF₂ is not decoration. A three-glass split needs the 3×3 system below to be
 * conditioned, and it is conditioned only by a glass whose partial dispersion is
 * anomalous for its Abbe number — which in this catalogue means fluorite. Every
 * solvable triple in `materials/catalog` contains it, and the element powers
 * come out ~2.5× the total either way; a triplet of ordinary glasses is not a
 * near-miss apochromat, it is a singular matrix.
 */
const EFL_TARGET = 53;
const APERTURE = 5;
const GLASS = ["CAF2", "F2", "N-BK7"] as const;
const THICKNESS = [1.6, 1.2, 1.2] as const;
/** § 6ap's conjugate: the object 400 mm ahead of a stop ~53 mm ahead of the glass. */
const CONJUGATE = 453;

interface Glass {
  readonly name: string;
  readonly nD: number;
  readonly V: number;
  readonly P: number;
}
/** Abbe number and the relative partial dispersion `designs/achromat` uses. */
const glassOf = (name: string): Glass => {
  const m = getMedium(name);
  return {
    name,
    nD: m.n(LINE_D),
    V: abbeNumber(m),
    P: (m.n(LINE_D) - m.n(LINE_C)) / (m.n(LINE_F) - m.n(LINE_C)),
  };
};
const GLASSES = GLASS.map(glassOf);

/** Gauss-Jordan with partial pivoting on a 3×3 — small, and used for one thing. */
function solve3x3(rows: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const M = rows.map((r, i) => [...r, rhs[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k]![i]!) > Math.abs(M[p]![i]!)) p = k;
    [M[i], M[p]] = [M[p]!, M[i]!];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const factor = M[k]![i]! / M[i]![i]!;
      for (let j = i; j < 4; j++) M[k]![j]! -= factor * M[i]![j]!;
    }
  }
  return [0, 1, 2].map((i) => M[i]![3]! / M[i]![i]!);
}

/**
 * THE EXTERNAL NUMBER — the classical three-glass split, in units of the total
 * power. Three conditions on three element powers:
 *
 *   Σφᵢ = φ            the lens has the focal length asked for
 *   Σφᵢ/Vᵢ = 0         F and C are united (the achromatic condition)
 *   Σφᵢ·Pᵢ/Vᵢ = 0      and d joins them (the apochromatic one)
 *
 * Two Abbe numbers and two partial dispersions per glass, off the catalogue, and
 * nothing traced. It is a THIN-lens statement, and § 6aq.1 measures how far the
 * real thick triplet's powers sit from it and shows the gap is the thickness.
 */
const thinSplit = (gs: readonly Glass[]): number[] =>
  solve3x3(
    [gs.map(() => 1), gs.map((g) => 1 / g.V), gs.map((g) => (g.P / g.V))],
    [1, 0, 0],
  );

const prescriptionOf = (
  curvature: readonly number[],
  thickness: readonly number[],
  semiAperture = APERTURE / 2,
): Prescription => ({
  surfaces: curvature.map((c, i): SurfaceSpec => ({
    kind: "refract",
    curvature: c,
    semiAperture,
    thickness: i < 3 ? thickness[i]! : 0,
    medium: i < 3 ? GLASS[i]! : "AIR",
  })),
});

/**
 * Solve the three trailing curvatures so the triplet's focal length is the
 * target AND takes the same value at F, d and C. The bending c₁ stays free, as
 * it does for a doublet: it slides all four curvatures together, changes no
 * first-order and no chromatic property, and is what § 6aq.7 spends.
 *
 * **Why this is Newton and not a closed form.** The 3×3 split above is exact for
 * thin elements, and at these thicknesses it is 1.5% wrong — which sounds small
 * and is not, because an apochromat's whole residual is smaller than that. A
 * thin-lens triplet built at 1.2 mm centre thickness is not apochromatic at all;
 * it is 30× WORSE than § 6ap's doublet, because the separation term the split
 * ignores dwarfs the tertiary spectrum the split is buying. So the powers are
 * solved on the thick first order, and the thin split is what they are measured
 * against (§ 6aq.1) rather than what they are.
 */
/**
 * The design solve is `designs/apochromat`'s, not this file's.
 *
 * § 6aq built its own — there was no `designs/apochromat` to borrow — and that
 * was the last thing on this ladder's deferral list still living in a test file.
 * § 6ar shipped it, and these two helpers are all that is left here: the form,
 * for the rungs that need the SAME bending at a different thickness, and the
 * design itself.
 *
 * `curvaturesAt` is the same Newton on the same thick first order, with two
 * differences § 6ar.3 measured and this file's numbers do not feel: the
 * finite-difference step is relative rather than absolute, and the step is damped
 * by backtracking. At both roots the damped and undamped solves agree to twelve
 * significant digits, which is why every digit below is § 6aq's unchanged.
 */
const formAt = (thickness: readonly [number, number, number]) =>
  cementedTripletForm({
    apertureMm: APERTURE,
    focalLengthMm: EFL_TARGET,
    media: GLASS,
    thicknessesMm: thickness,
  });
const FORM = formAt(THICKNESS);
const solveTriplet = (
  bending: number,
  thickness: readonly [number, number, number] = THICKNESS,
): readonly number[] => formAt(thickness).curvaturesAt(bending);

/** Third-order spherical aberration of a bending, at the conjugate it is used at. */
const sphericalOf = (bending: number): number =>
  seidelSums(prescriptionOf(solveTriplet(bending), THICKNESS), LINE_D, {
    marginalHeightMm: APERTURE / 2,
    objectDistanceMm: CONJUGATE,
  }).s1;

/** Bisection on a sign change, to the last bits. */
const bisect = (g: (x: number) => number, a: number, b: number): number => {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(lo) * g(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
};
/** Golden-section extremum, for a turn in FFD(λ). */
const goldenSection = (g: (x: number) => number, a: number, b: number, sign = 1): number => {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 400; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (sign * g(m1) < sign * g(m2)) hi = m2;
    else lo = m1;
  }
  return 0.5 * (lo + hi);
};

/**
 * The two bendings that null S_I, found rather than transcribed. A cemented
 * doublet has two (`designs/achromat`'s `branch`), and so does this triplet —
 * and § 6aq.7 is that the two are NOT interchangeable here for a reason that has
 * nothing to do with aberration.
 *
 * § 6aq found them by bisecting inside two hand-chosen brackets. They now come
 * off `designs/apochromat`'s own scan, which searches the whole bending window
 * and picks between the roots on Σ|S_I,ᵢ| — the criterion `designs/achromat`
 * uses. The two routes agree: the constructor's default branch IS the bending
 * § 6aq called robust, which the third rung of § 6aq.7 measures and calls a
 * coincidence, and the radii below are unchanged to every digit § 6aq pinned.
 */
const DESIGN = apochromaticObjective({
  apertureMm: APERTURE,
  focalRatio: EFL_TARGET / APERTURE,
  media: GLASS,
  thicknessesMm: THICKNESS,
  objectDistanceMm: CONJUGATE,
});
const DESIGN_STEEP = apochromaticObjective({
  apertureMm: APERTURE,
  focalRatio: EFL_TARGET / APERTURE,
  media: GLASS,
  thicknessesMm: THICKNESS,
  objectDistanceMm: CONJUGATE,
  branch: "steep",
});
const BENDING_ROBUST = DESIGN.curvatures[0];
const BENDING_OTHER = DESIGN_STEEP.curvatures[0];

const CURVATURE = DESIGN.curvatures;
/** The tail alone — what a focal length and a front focal distance are OF. */
const GROUP = prescriptionOf(CURVATURE, THICKNESS);
/** Where the stop goes: the tail's front focal distance AT THE D LINE. */
const FFD_D = ffd(GROUP, LINE_D);

/** § 6ap's fixture with the apochromatic tail in it — everything else unchanged. */
const finiteAt = (gap: number, defocus = 0, semiAperture = APERTURE / 2): OpticalSystem => {
  const glass = prescriptionOf(CURVATURE, THICKNESS, semiAperture).surfaces;
  const base: OpticalSystem = {
    prescription: {
      surfaces: [
        {
          kind: "refract",
          curvature: 0,
          semiAperture: 30,
          thickness: gap,
          medium: "AIR",
          isStop: true,
        },
        ...glass.slice(0, -1),
        { ...glass[glass.length - 1]!, thickness: 100 },
      ],
    },
    aperture: { kind: "stopRadius", value: STOP_R },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance: OBJECT_DISTANCE },
  };
  return {
    ...base,
    imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, LINE_D) + defocus },
  };
};
const TELECENTRIC = finiteAt(FFD_D);

/**
 * § 6ap's doublet, built exactly as § 6ap built it — the control for every
 * "one more turn" and "one more pole" below. Two united wavelengths, one turn.
 */
const DOUBLET = achromaticObjective({
  apertureMm: APERTURE,
  focalRatio: EFL_TARGET / APERTURE,
  objectDistanceMm: CONJUGATE,
});
const DOUBLET_GROUP: Prescription = {
  surfaces: DOUBLET.prescription.surfaces.map((s, i, all) =>
    i === all.length - 1 ? { ...s, thickness: 0 } : s,
  ),
};

/**
 * The tail in closed form: the Gaussian ray-transfer product on (y, n·u) for
 * FOUR surfaces, its principal planes, and Newton's f² for the stop's image.
 * § 6ap.3's route with one more element in it, and Sellmeier's n(λ) for the
 * three glasses is the only input — nothing here is traced.
 *
 * M = R₄T₃R₃T₂R₂T₁R₁ with R = [[1,0],[−(n′−n)c,1]] and T = [[1,t/n],[0,1]].
 * Then f = −1/C, the front focal point is D·f before the first vertex and the
 * back focal point A·f after the last, and the stop — at z = 0 on this axis —
 * images to f²/frontFocus beyond the back focal point.
 */
function closedFormTail(nm: number, stopToVertex: number = FFD_D) {
  const c = CURVATURE;
  const t = THICKNESS;
  const n = [1, ...GLASS.map((g) => getMedium(g).n(nm)), 1];
  const mul = (A: readonly number[], B: readonly number[]): number[] => [
    A[0]! * B[0]! + A[1]! * B[2]!,
    A[0]! * B[1]! + A[1]! * B[3]!,
    A[2]! * B[0]! + A[3]! * B[2]!,
    A[2]! * B[1]! + A[3]! * B[3]!,
  ];
  const refract = (i: number): number[] => [1, 0, -(n[i + 1]! - n[i]!) * c[i]!, 1];
  const transfer = (i: number): number[] => [1, t[i]! / n[i + 1]!, 0, 1];
  let M = refract(0);
  for (let i = 0; i < 3; i++) {
    M = mul(transfer(i), M);
    M = mul(refract(i + 1), M);
  }
  const f = -1 / M[2]!;
  const thick = t[0]! + t[1]! + t[2]!;
  const frontFocus = stopToVertex - M[3]! * f;
  const backFocus = stopToVertex + thick + M[0]! * f;
  return { f, ffd: M[3]! * f, frontFocus, backFocus, exitZ: backFocus + (f * f) / frontFocus };
}

const planeAt = (nm: number, system: OpticalSystem = TELECENTRIC) =>
  formBrightfieldPlane(
    system,
    CLEAR,
    SOURCE,
    {
      size: SIZE,
      pupilSamples: PUPIL_SAMPLES,
      samples: [{ nm, weight: 1 }],
      map: "uniform",
      patches: 1,
    },
    { nm, weight: 1 },
    ORIGIN,
  );

/** Where the sensor is, on the axis the stop's vertex starts at z = 0. */
const imageZ =
  FFD_D + THICKNESS[0]! + THICKNESS[1]! + THICKNESS[2]! + paraxialImageOffset(TELECENTRIC, LINE_D);

/** Sensor moved by δ, as a fraction of the in-focus magnification. */
const shiftAt = (stopAt: number, nm: number, delta: number): number =>
  lateralMagnification(finiteAt(stopAt, delta), PROBE_MM, nm) /
    lateralMagnification(finiteAt(stopAt), PROBE_MM, nm) -
  1;

/** Count the turning points of a function of wavelength over a band. */
const turningPoints = (g: (nm: number) => number, from: number, to: number, step = 0.1): number[] => {
  const found: number[] = [];
  let previous = g(from + step) - g(from);
  for (let nm = from + step; nm <= to; nm += step) {
    const slope = g(nm + step) - g(nm);
    if (previous * slope < 0) found.push(nm);
    previous = slope;
  }
  return found;
};

/** The wavelengths at which FFD(λ) equals a stop placement, to the last bits. */
const polesFor = (level: number, from = 380, to = 800): number[] => {
  const g = (nm: number) => ffd(GROUP, nm) - level;
  const roots: number[] = [];
  let previous = g(from);
  for (let nm = from + 0.05; nm <= to; nm += 0.05) {
    const value = g(nm);
    if (previous * value < 0) roots.push(bisect(g, nm - 0.05, nm));
    previous = value;
  }
  return roots;
};

describe("§ 6aq.1 — three glasses unite three wavelengths, and the thin limit is the catalogue's", () => {
  it("F, d and C land on one focal length, where the doublet joins only two", () => {
    // The doublet first, as the ruler: `designs/achromat` splits two powers so
    // that F and C coincide, and the d line is left over as the secondary
    // spectrum — § 6ap.1's −4.78e−4, a property of the glass pair.
    const doubletD = efl(DOUBLET_GROUP, LINE_D);
    const doubletPrimary = (efl(DOUBLET_GROUP, LINE_F) - efl(DOUBLET_GROUP, LINE_C)) / doubletD;
    expect(doubletPrimary).toBeCloseTo(-9.373168e-5, 10);
    const doubletSecondary =
      (doubletD - 0.5 * (efl(DOUBLET_GROUP, LINE_F) + efl(DOUBLET_GROUP, LINE_C))) / doubletD;
    expect(doubletSecondary).toBeCloseTo(-4.781165e-4, 10);

    // The triplet's third condition is that the leftover be zero too, and it is
    // — to the last bits of a double, at all three lines at once. This is the
    // solve's own target and proves only that the solve converged; what makes it
    // a measurement is § 6aq.2, where a closed form that never saw the solve
    // agrees, and § 6aq.1's next two rungs, where the design is compared to a
    // number the solve does not contain.
    const fD = efl(GROUP, LINE_D);
    expect(fD).toBeCloseTo(EFL_TARGET, 11);
    expect((efl(GROUP, LINE_F) - fD) / fD).toBeCloseTo(0, 14);
    expect((efl(GROUP, LINE_C) - fD) / fD).toBeCloseTo(0, 14);
  });

  it("and what is left over the visible band is 8.3× under the doublet's", () => {
    // The comparison has to be over ONE band, and 400…700 is the band both
    // tails render (§ 6aq.8). Quoting the doublet's F-to-C figure against the
    // triplet's worst would be two different measurements wearing one name — the
    // mistake § 6ap.7 had to unpick, in the other direction.
    const worstOver = (g: Prescription): { at: number; value: number } => {
      const f0 = efl(g, LINE_D);
      let at = 400;
      let value = 0;
      for (let nm = 400; nm <= 700; nm += 0.5) {
        const d = Math.abs(efl(g, nm) - f0) / f0;
        if (d > value) {
          value = d;
          at = nm;
        }
      }
      return { at, value };
    };
    const triplet = worstOver(GROUP);
    const doublet = worstOver(DOUBLET_GROUP);
    expect(triplet.value).toBeCloseTo(5.7919e-4, 7);
    expect(doublet.value).toBeCloseTo(4.8343e-3, 6);
    expect(doublet.value / triplet.value).toBeGreaterThan(8.3);
    // Both worst at the blue end, which is where a residual dispersion is
    // steepest and is why an apochromat is quoted over a band and not at a line.
    expect(triplet.at).toBe(400);
    expect(doublet.at).toBe(400);
  });

  it("and the 1.5% the thick solve sits off the catalogue split is THICKNESS", () => {
    // THE EXTERNAL NUMBER. A triplet has no clean closed form for what is left
    // after three colours are united — the doublet's −(P₁−P₂)/(V₁−V₂) has no
    // three-glass analogue that is a property of the glasses alone — so what
    // pins this design to the catalogue rather than to the tracer is its THIN
    // LIMIT: as the elements go thin the solved powers must approach the 3×3
    // split, which is two Abbe numbers and two partial dispersions per glass.
    //
    // They do, and linearly: halve the thicknesses and the deviation halves,
    // five times over. A thin triplet IS the catalogue's; this one is thick.
    const split = thinSplit(GLASSES);
    expect(split[0]).toBeCloseTo(2.578140565, 9);
    expect(split[1]).toBeCloseTo(-0.21365216, 9);
    expect(split[2]).toBeCloseTo(-1.364488404, 9);
    // The strong positive element is the fluorite, and the two that take power
    // back are the flint and the crown — the arrangement anomalous partial
    // dispersion forces, not one chosen for looks.
    expect(GLASSES[0]!.name).toBe("CAF2");
    expect(split[0]! * split[1]!).toBeLessThan(0);
    expect(split[0]! * split[2]!).toBeLessThan(0);

    const deviationAt = (scale: number): number => {
      const thickness = THICKNESS.map((t) => t * scale) as unknown as readonly [
        number,
        number,
        number,
      ];
      const c = solveTriplet(BENDING_ROBUST, thickness);
      const power = [0, 1, 2].map((i) => (GLASSES[i]!.nD - 1) * (c[i]! - c[i + 1]!) * EFL_TARGET);
      return Math.max(...[0, 1, 2].map((i) => Math.abs(power[i]! - split[i]!)));
    };
    const scales = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
    const deviation = scales.map(deviationAt);
    expect(deviation[0]).toBeCloseTo(3.797258e-2, 7);
    // 1.5% of the fluorite's own power, and it is not slack: each halving takes
    // it down by a factor of two to better than 2%, so it extrapolates to zero.
    expect(deviation[0]! / Math.abs(split[0]!)).toBeCloseTo(0.0147, 4);
    for (let i = 1; i < scales.length; i++) {
      expect(deviation[i - 1]! / deviation[i]!).toBeGreaterThan(1.96);
      expect(deviation[i - 1]! / deviation[i]!).toBeLessThan(2.04);
    }
  });

  it("and a triplet built ON the thin split at these thicknesses is not apochromatic", () => {
    // The negative control, and the reason the Newton solve exists at all. Build
    // the same three glasses with the catalogue's powers taken literally and the
    // focal length moves by 2.9e−4 of itself between F and C — THREE times the
    // doublet's own primary colour, on a design whose entire purpose is to have
    // none. The thin closed form is the right external number and the wrong
    // prescription; a step that used it directly would have measured the
    // separation term and called it tertiary spectrum.
    const split = thinSplit(GLASSES).map((p) => p / EFL_TARGET);
    const c = [BENDING_ROBUST];
    for (let i = 0; i < 3; i++) c.push(c[i]! - split[i]! / (GLASSES[i]!.nD - 1));
    const naive = prescriptionOf(c, THICKNESS);
    const fD = efl(naive, LINE_D);
    const primary = (efl(naive, LINE_F) - efl(naive, LINE_C)) / fD;
    // Bounded rather than transcribed: the claim is that a thin-split triplet is
    // not apochromatic at these thicknesses, and the digit it misses by is a
    // property of the bending it happens to be built at, which this rung is not
    // about. (It measures 2.90e−4.)
    expect(Math.abs(primary)).toBeGreaterThan(2.5e-4);
    expect(Math.abs(primary / -9.373168e-5)).toBeGreaterThan(3);
  });
});

describe("§ 6aq.2 — the solve is confirmed by a closed form that never saw it", () => {
  it("a four-surface Gaussian matrix reproduces EFL and FFD to the last bits", () => {
    // The solve ran on `paraxialTrace` and every claim below is read off
    // `paraxialTrace`, so on its own the design would be pinned to the tracer
    // agreeing with itself. The 2×2 ray-transfer product is the independent
    // route — Sellmeier's n(λ), four refractions and three transfers, no ray
    // stepped through a surface — and § 6ap.3 already used it one element
    // shorter.
    let worstFocal = 0;
    let worstFront = 0;
    for (let nm = 380; nm <= 800; nm += 2.5) {
      worstFocal = Math.max(worstFocal, Math.abs(closedFormTail(nm).f - efl(GROUP, nm)));
      worstFront = Math.max(worstFront, Math.abs(closedFormTail(nm).ffd - ffd(GROUP, nm)));
    }
    expect(worstFocal).toBeLessThan(1e-12);
    expect(worstFront).toBeLessThan(1e-12);
    // And the two numbers the rest of the step is built on, off the closed form
    // alone: the focal length asked for, and the stop placement.
    expect(closedFormTail(LINE_D).f).toBeCloseTo(EFL_TARGET, 11);
    expect(closedFormTail(LINE_D).ffd).toBeCloseTo(FFD_D, 10);
  });
});

describe("§ 6aq.3 — FFD(λ) has TWO turns, so a stop is telecentric at most THREE times", () => {
  it("the doublet's one turn becomes two, and both are inside the visible band", () => {
    // § 6ap's whole finding was that achromatising puts ONE turn in FFD(λ), at
    // 556.1 nm, where a singlet's is monotone. Uniting a third wavelength puts a
    // second one there.
    const doubletTurns = turningPoints((nm) => ffd(DOUBLET_GROUP, nm), 370, 830);
    expect(doubletTurns.length).toBe(1);
    expect(doubletTurns[0]).toBeCloseTo(556.1, 0);

    const turns = turningPoints((nm) => ffd(GROUP, nm), 370, 830);
    expect(turns.length).toBe(2);
    const low = goldenSection((nm) => ffd(GROUP, nm), 430, 570, 1);
    const high = goldenSection((nm) => ffd(GROUP, nm), 570, 720, -1);
    expect(low).toBeCloseTo(498.76, 2);
    expect(high).toBeCloseTo(634.26, 2);
    // Two decimals and not twelve, and the reason is measured rather than
    // asserted: a golden section on a smooth extremum locates it to √ε, so the
    // SAME lens searched from five different brackets gives five answers 3.2e−4
    // nm apart. That spread is the search's, not the lens's — the bending root
    // the design hangs on moves the same turn by only 1e−5 nm — and a number
    // quoted past it would be pinning the bracket.
    const spread = ([[430, 570], [440, 560], [450, 550], [460, 540], [470, 530]] as const)
      .map(([a, b]) => goldenSection((nm) => ffd(GROUP, nm), a, b, 1));
    expect(Math.max(...spread) - Math.min(...spread)).toBeLessThan(1e-3);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(1e-5);

    // A minimum then a maximum, both between 400 and 700 — which is what the
    // deferral asked and is the half of its prediction that was right.
    expect(ffd(GROUP, low)).toBeLessThan(ffd(GROUP, 400));
    expect(ffd(GROUP, high)).toBeGreaterThan(ffd(GROUP, low));
    expect(ffd(GROUP, high)).toBeGreaterThan(ffd(GROUP, 700));
  });

  it("so the count is three, and the deferral's FOUR was arithmetic, not physics", () => {
    // A horizontal line cuts a curve with k interior turns at most k+1 times.
    // Two turns therefore admit at most three telecentric wavelengths, and the
    // deferral's "a value it takes four times" needed three turns — which is
    // four united wavelengths, a superachromat, and one more glass than this.
    //
    // The rung is that no placement does better, measured rather than argued:
    // sweep the stop across the whole range FFD(λ) covers and count.
    const low = goldenSection((nm) => ffd(GROUP, nm), 430, 570, 1);
    const high = goldenSection((nm) => ffd(GROUP, nm), 570, 720, -1);
    let best = 0;
    for (let k = 0; k <= 400; k++) {
      const level = ffd(GROUP, low) + (ffd(GROUP, high) - ffd(GROUP, low)) * (k / 400);
      best = Math.max(best, polesFor(level).length);
    }
    expect(best).toBe(3);
  });

  it("and two turns is what a triplet has — 1044 designs, never three", () => {
    // The two-turn claim is a MEASUREMENT and not a theorem, and the difference
    // matters. Rolle gives two critical points to the FOCAL LENGTH, because
    // three wavelengths share a value. FFD is a different function — the focal
    // length displaced by a principal plane, and the displacement has its own
    // dispersion — and § 6ap.1's lesson was precisely that the two do not have
    // to behave alike: here the focal length turns at 521.6 and 623.7 nm and the
    // front focal distance at 498.8 and 634.3, so the principal-plane term MOVES
    // both turns by tens of nanometres. What the sweep shows is that it never
    // adds a third.
    const focalTurns = turningPoints((nm) => efl(GROUP, nm), 370, 830);
    expect(focalTurns.length).toBe(2);
    expect(focalTurns[0]).toBeCloseTo(521.6, 0);
    expect(focalTurns[1]).toBeCloseTo(623.7, 0);

    // Twelve glass orders that solve, three thickness sets, twenty-nine bendings.
    // The histogram is 0, 1 or 2 and nothing else.
    const orders = [
      ["CAF2", "N-BK7", "F2"], ["CAF2", "F2", "N-BK7"], ["N-BK7", "CAF2", "F2"],
      ["N-BK7", "F2", "CAF2"], ["F2", "CAF2", "N-BK7"], ["F2", "N-BK7", "CAF2"],
      ["CAF2", "FUSED-SILICA", "D263"], ["D263", "CAF2", "FUSED-SILICA"],
      ["CAF2", "D263", "FUSED-SILICA"], ["CAF2", "F2", "D263"],
      ["D263", "F2", "CAF2"], ["FUSED-SILICA", "CAF2", "D263"],
    ];
    let tried = 0;
    const histogram = new Map<number, number>();
    for (const names of orders) {
      const gs = names.map(glassOf);
      const split = thinSplit(gs).map((p) => p / EFL_TARGET);
      for (const thickness of [[1.6, 1.2, 1.2], [3, 2, 2], [0.8, 0.6, 0.6]]) {
        const build = (c: readonly number[]): Prescription => ({
          surfaces: c.map((cv, i): SurfaceSpec => ({
            kind: "refract",
            curvature: cv,
            semiAperture: APERTURE / 2,
            thickness: i < 3 ? thickness[i]! : 0,
            medium: i < 3 ? names[i]! : "AIR",
          })),
        });
        for (let k = -14; k <= 14; k++) {
          const bending = k * 0.005;
          const start = [bending];
          for (let i = 0; i < 3; i++) start.push(start[i]! - split[i]! / (gs[i]!.nD - 1));
          let v = start.slice(1);
          const residual = (w: readonly number[]): number[] => {
            const p = build([bending, ...w]);
            const fD = efl(p, LINE_D);
            return [fD - EFL_TARGET, efl(p, LINE_F) - fD, efl(p, LINE_C) - fD];
          };
          for (let step = 0; step < 60; step++) {
            const r = residual(v);
            if (Math.max(...r.map(Math.abs)) < 1e-13) break;
            const h = 1e-9;
            const column: number[][] = [];
            for (let j = 0; j < 3; j++) {
              const bumped = v.slice();
              bumped[j]! += h;
              const rb = residual(bumped);
              column.push([0, 1, 2].map((i) => (rb[i]! - r[i]!) / h));
            }
            const delta = solve3x3(
              [0, 1, 2].map((i) => [column[0]![i]!, column[1]![i]!, column[2]![i]!]),
              r.map((x) => -x),
            );
            v = v.map((x, i) => x + delta[i]!);
          }
          const solved = build([bending, ...v]);
          const fD = efl(solved, LINE_D);
          // Every one of them converges; none is skipped for failing to.
          expect(Math.abs(fD - EFL_TARGET)).toBeLessThan(1e-8);
          expect(Math.abs(efl(solved, LINE_F) - fD)).toBeLessThan(1e-10);
          tried++;
          const turns = turningPoints((nm) => ffd(solved, nm), 370, 830).length;
          histogram.set(turns, (histogram.get(turns) ?? 0) + 1);
        }
      }
    }
    expect(tried).toBe(1044);
    // The whole histogram and not just its largest key: a maximum of two is also
    // what 1043 monotone designs and one turning one would report, and that
    // would not be evidence for "never three". Two turns is the COMMON case.
    expect([...histogram.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(histogram.get(0)).toBe(428);
    expect(histogram.get(1)).toBe(49);
    expect(histogram.get(2)).toBe(567);
    expect([...histogram.values()].reduce((a, b) => a + b, 0)).toBe(tried);
  });
});

describe("§ 6aq.4 — a stop at the d line's front focal distance is telecentric three times", () => {
  it("454.97, 587.56 and 678.03 nm, off Sellmeier on the same triplet", () => {
    // § 6ap's placement, unchanged: the stop sits where the d line's front focal
    // point is. On the doublet that bought a second wavelength; here it buys a
    // third, and the d line is one of the three by construction.
    const poles = polesFor(FFD_D);
    expect(poles.length).toBe(3);
    expect(poles[0]).toBeCloseTo(454.965737917, 6);
    expect(poles[1]).toBeCloseTo(LINE_D, 8);
    expect(poles[2]).toBeCloseTo(678.030794906, 6);
    expect(FFD_D).toBeCloseTo(53.0071155, 7);
  });

  it("...and the d line's own pole is quoted to what the BISECTION can locate", () => {
    // § 6aq wrote this pin at NINE decimals, and § 6ar found that nine was the
    // bracket and not the lens — the same mistake § 6aq.3 caught for the TURN, made
    // one rung earlier and left standing there.
    //
    // The d line is a pole by construction, so the temptation is to demand it
    // back to the last bits, and the reasoning offered for that was "a sign is
    // exact". The sign is exact; the FUNCTION is not. FFD(λ) − FFD(d) is a
    // difference of two numbers near 53 mm, so it carries no information below
    // 53·ε ≈ 1.2e−14 mm, and at d the curve climbs at only 2.84e−5 mm/nm. The
    // crossing is therefore locatable to about
    //
    //     53·ε / |dFFD/dλ| = 4.1e−10 nm
    //
    // and bisection spends a couple of those, which is 5e−10 gone before the lens
    // is consulted. Measured on § 6aq's OWN triplet, five brackets around the same
    // pole spread 1.6e−9 nm and four of the five miss the d line by more than the
    // nine-decimal pin allowed: it passed because `polesFor` walks at 0.05 nm from
    // 380 and happens to hand bisection one bracket rather than another.
    const g = (nm: number) => ffd(GROUP, nm) - FFD_D;
    const answers = ([[587.5, 587.6], [587.55, 587.57], [587, 588], [585, 590],
      [587.56, 587.5619]] as const).map(([a, b]) => bisect(g, a, b));
    const spread = Math.max(...answers) - Math.min(...answers);
    // The spread is the search's, and it is what the digits are quoted to. Bounded
    // rather than transcribed, because the exact figure is a property of which
    // brackets this rung happens to list.
    expect(spread).toBeGreaterThan(4.1e-10);
    expect(spread).toBeLessThan(5e-9);
    // Every bracket puts the pole within the floor of the d line, and none within
    // nine decimals of it — which is the whole finding.
    for (const nm of answers) expect(Math.abs(nm - LINE_D)).toBeLessThan(5e-9);
    expect(Math.max(...answers.map((nm) => Math.abs(nm - LINE_D)))).toBeGreaterThan(5e-10);

    // The floor is not a fitted number: it is ε on the FFD scale over the slope.
    const slope = (ffd(GROUP, LINE_D + 1) - ffd(GROUP, LINE_D - 1)) / 2;
    expect(slope).toBeCloseTo(2.8377e-5, 8);
    const floor = (Math.abs(FFD_D) * Number.EPSILON) / Math.abs(slope);
    expect(floor).toBeCloseTo(4.148e-10, 12);
    expect(spread).toBeGreaterThan(floor);
  });

  it("and Newton's f² puts the exit pupil at infinity at all three, either side real", () => {
    // Nothing traced: the 2×2 product's principal planes and f²/frontFocus, the
    // route § 6ap.3 used across two poles and this uses across three. At a pole
    // the front focus lands on the stop, so the image of it runs away.
    for (const nm of polesFor(FFD_D)) {
      expect(Math.abs(closedFormTail(nm).frontFocus)).toBeLessThan(1e-9);
      expect(Math.abs(closedFormTail(nm).exitZ)).toBeGreaterThan(1e9);
    }
    // Between and outside, the pupil is finite and it alternates side — four
    // regions cut by three poles, which is one more region than § 6ap had.
    const sign = [420, 470, 550, 620, 690].map((nm) => Math.sign(closedFormTail(nm).exitZ));
    expect(sign).toEqual([-1, 1, 1, -1, 1]);
  });
});

describe("§ 6aq.5 — so the defocus rescale reverses sign THREE times", () => {
  it("+, −, +, − across the band, at the probe ray's floor at each pole", () => {
    // The traced quantity a caller sees: move the sensor 1 mm and read the
    // magnification against its in-focus value. § 6an had one sign change,
    // § 6ap two, and this has three — the pattern is the pole count, not the
    // glass count, and they differ by one.
    const sample = [400, 420, 470, 500, 550, 620, 650, 690, 700];
    const sign = sample.map((nm) => Math.sign(shiftAt(FFD_D, nm, 1)));
    expect(sign).toEqual([1, 1, -1, -1, -1, 1, 1, -1, -1]);

    for (const nm of polesFor(FFD_D)) {
      expect(Math.abs(shiftAt(FFD_D, nm, 1))).toBeLessThan(3e-9);
    }
    // And the excursion the caller actually sees, blue end to red end.
    expect(shiftAt(FFD_D, 400, 1)).toBeCloseTo(7.8183e-6, 9);
    expect(shiftAt(FFD_D, 700, 1)).toBeCloseTo(-3.2384e-7, 10);
  });

  it("and it is linear in δ and follows the closed form's 1/R(λ) absolutely", () => {
    // § 6ap.4's shape, one pole further on. The rescale is 1 + δ/R(λ) with R the
    // exit pupil's distance from the image, so the traced shift over δ should be
    // 1/R and independent of δ.
    for (const nm of [430, 520, 600, 660]) {
      const one = shiftAt(FFD_D, nm, 1);
      const two = shiftAt(FFD_D, nm, 2);
      expect(two / one).toBeCloseTo(2, 4);
    }
    // Quoted ABSOLUTELY, which is § 6ap.4's correction and matters more here:
    // the coefficient passes through zero three times inside the band, so a
    // relative bound would read as the closed form failing at each pole. The
    // difference is a constant — the traced probe ray's own floor.
    const miss = [400, 450, 520, 600, 660, 700].map((nm) => {
      const cf = closedFormTail(nm);
      return shiftAt(FFD_D, nm, 1) - 1 / (imageZ - cf.exitZ);
    });
    for (const m of miss) {
      expect(Math.abs(m + 1.26e-9)).toBeLessThan(2e-10);
    }
  });
});

describe("§ 6aq.6 — the three-pole placement is a 1.61 µm window with two unlike edges", () => {
  it("the window, and where § 6ap's d-line placement sits inside it", () => {
    // § 6ap's headline was that a 3.8 µm spacer decides whether the pole is
    // crossed or touched. With three poles the same question has a width: the
    // stop placements that give three of them form an interval, and it is
    // 1.61 µm wide. The d-line placement is inside it with 0.9 µm of margin one
    // way and 0.7 µm the other, which is why § 6aq.4 works at all — and it is
    // luck, not design, in the same way § 6ap's turn landing inside the band was.
    const high = goldenSection((nm) => ffd(GROUP, nm), 570, 720, -1);
    const lower = ffd(GROUP, 700);
    const upper = ffd(GROUP, high);
    expect((upper - lower) * 1e3).toBeCloseTo(1.6125, 3);
    expect((FFD_D - lower) * 1e3).toBeCloseTo(0.9061, 3);
    expect((upper - FFD_D) * 1e3).toBeCloseTo(0.7064, 3);
    expect(polesFor(0.5 * (lower + upper)).length).toBe(3);
  });

  it("and the two edges end the three differently — one leaves the band, one merges", () => {
    // The edges are not the same kind of edge, which is the part § 6ap could not
    // show with one turn.
    //
    // At the TOP the level meets the maximum, so two of the three roots merge
    // into a double one: the pole is touched rather than crossed, and the third
    // pole is still crossed. A touched pole and a crossed pole in one band.
    const high = goldenSection((nm) => ffd(GROUP, nm), 570, 720, -1);
    const atTop = polesFor(ffd(GROUP, high), 380, 700);
    expect(atTop.length).toBe(1);
    expect(Math.sign(shiftAt(ffd(GROUP, high), 620, 1))).toBe(
      Math.sign(shiftAt(ffd(GROUP, high), 660, 1)),
    );

    // At the BOTTOM nothing merges: the reddest root simply walks off the end of
    // the band. Three poles are still there in the arithmetic; the band has only
    // two of them. An edge that is about the band and not about the lens.
    const lower = ffd(GROUP, 700);
    expect(polesFor(lower - 1e-7, 380, 700).length).toBe(2);
    expect(polesFor(lower - 1e-7, 380, 800).length).toBe(3);
  });

  it("and 2.6 µm further in, the other turn gives § 6ap.5's touch-only placement", () => {
    // Put the stop at the MINIMUM and the root is double and alone: the rescale
    // reaches zero at 498.76 nm and comes back on the same side, so a defocused
    // frame fringes in one direction across the whole band. That is exactly
    // § 6ap.5's finding, reproduced on a triplet — and it is now one of THREE
    // placements a spacer chooses between, 2.6 µm from the d-line one.
    const low = goldenSection((nm) => ffd(GROUP, nm), 430, 570, 1);
    const touch = ffd(GROUP, low);
    expect((FFD_D - touch) * 1e3).toBeCloseTo(2.6334, 3);
    expect(polesFor(touch, 400, 700).length).toBe(0);
    for (const nm of [400, 450, 550, 600, 700]) {
      expect(shiftAt(touch, nm, 1)).toBeGreaterThan(0);
    }
    // At the touch itself the rescale is −1.3e−9 rather than +0, and that is the
    // probe ray's floor and not a reversal: § 6ap.5's number on this fixture, the
    // same one § 6aq.5 measures as a constant miss away from the poles.
    expect(Math.abs(shiftAt(touch, low, 1))).toBeLessThan(3e-9);
  });
});

describe("§ 6aq.7 — which spherical-null bending is built decides the pole count", () => {
  it("both bendings null S_I on the same glasses and the same three colours", () => {
    // A cemented triplet's bending is free after the three chromatic conditions,
    // exactly as a doublet's is after two, and S_I(c₁) has two roots here as it
    // does there. Both are genuine designs: same glasses, same focal length,
    // same three united wavelengths, third-order spherical nulled.
    expect(1 / BENDING_ROBUST).toBeCloseTo(18.348013, 5);
    expect(1 / BENDING_OTHER).toBeCloseTo(-102.648789, 4);
    for (const bending of [BENDING_ROBUST, BENDING_OTHER]) {
      const p = prescriptionOf(solveTriplet(bending), THICKNESS);
      const fD = efl(p, LINE_D);
      expect(fD).toBeCloseTo(EFL_TARGET, 10);
      expect((efl(p, LINE_F) - fD) / fD).toBeCloseTo(0, 13);
      expect((efl(p, LINE_C) - fD) / fD).toBeCloseTo(0, 13);
      expect(Math.abs(sphericalOf(bending))).toBeLessThan(1e-11);
    }
  });

  it("but the other one's turns fall outside the band, and it is telecentric ONCE", () => {
    // And here the two stop being interchangeable. The bending moves the turns —
    // § 6aq.3's sweep is that same motion seen in bulk — and on the second root
    // it moves them to 383.6 and 805.3 nm, effectively out of the visible. FFD is
    // then monotone across the band the way a SINGLET's is, and § 6ap's
    // placement buys nothing: the stop is at a front focal point at the d line
    // and nowhere else.
    const other = prescriptionOf(solveTriplet(BENDING_OTHER), THICKNESS);
    const turns = turningPoints((nm) => ffd(other, nm), 370, 830);
    expect(turns.length).toBe(2);
    expect(turns[0]).toBeCloseTo(383.6, 0);
    expect(turns[1]).toBeCloseTo(805.3, 0);
    expect(turningPoints((nm) => ffd(other, nm), 400, 700).length).toBe(0);

    const level = ffd(other, LINE_D);
    const g = (nm: number) => ffd(other, nm) - level;
    let crossings = 0;
    let crossingAt = NaN;
    let previous = g(400);
    for (let nm = 400.05; nm <= 700; nm += 0.05) {
      if (previous * g(nm) < 0) {
        crossings++;
        crossingAt = bisect(g, nm - 0.05, nm);
      }
      previous = g(nm);
    }
    // Once, and the once is the d line itself — the placement's own design
    // wavelength and nothing else, which is § 6an's SINGLET behaviour on a lens
    // that unites three colours.
    expect(crossings).toBe(1);
    expect(crossingAt).toBeCloseTo(LINE_D, 6);
  });

  it("and the criterion that picks between them knows nothing about any of this", () => {
    // `designs/achromat` chooses its branch on Σ|S_I,ᵢ|: a design whose surfaces
    // each contribute little carries less of the fifth order third-order theory
    // does not model. That criterion is about aberration and only aberration,
    // and applied here it picks the bending with three poles — 5.29e−3 against
    // 2.30e−2, a factor of 4.3.
    //
    // Recorded as a coincidence, because that is what it is. Nothing in a
    // robustness criterion knows where FFD(λ) turns, and on a different glass
    // triple it could as easily have picked the other one. What the rung pins is
    // that the two questions are independent, not that they agree.
    const spread = (bending: number): number =>
      seidelSums(prescriptionOf(solveTriplet(bending), THICKNESS), LINE_D, {
        marginalHeightMm: APERTURE / 2,
        objectDistanceMm: CONJUGATE,
      }).surfaces.reduce((sum, s) => sum + Math.abs(s.s1), 0);
    expect(spread(BENDING_ROBUST)).toBeCloseTo(5.2881e-3, 6);
    expect(spread(BENDING_OTHER)).toBeCloseTo(2.2979e-2, 5);
    expect(spread(BENDING_OTHER) / spread(BENDING_ROBUST)).toBeGreaterThan(4.3);
  });
});

describe("§ 6aq.8 — the fixture renders, and the aperture stop is the only stop", () => {
  it("every wavelength from 380 to 800 nm is honest, and the floor moved", () => {
    // § 6ap's band, on the tail that replaced its own. Brightfield refuses where
    // the wavefront aliases (ARCHITECTURE.md), so a band is measured and not
    // chosen, and these are at § 6ap's `size` 32 and `pupilSamples` 16 — a
    // number read at a different sampling would be a picture of the sampling.
    for (const nm of [380, 400, 440, 480, 550, 700, 800]) {
      expect(planeAt(nm).fidelity.verdict).toBe("valid");
    }
    // § 6ap.2 measured 0.024451901 waves per pupil sample at 470 nm on the
    // doublet. The triplet is under it, and the whole blue end with it.
    expect(planeAt(470).fidelity.phaseStepWaves).toBeCloseTo(0.0144281, 6);
    expect(planeAt(470).fidelity.phaseStepWaves!).toBeLessThan(0.024451901);
    expect(planeAt(400).fidelity.phaseStepWaves).toBeCloseTo(0.048319, 5);
    // Still asymmetric for the singlet's reason: n(λ) is steep in the blue.
    expect(planeAt(380).fidelity.phaseStepWaves!).toBeGreaterThan(
      planeAt(800).fidelity.phaseStepWaves!,
    );
  });

  it("and a 20 mm rim renders bitwise the same frame", () => {
    // § 6ap sized its doublet at D = 5 rather than 2·r_stop = 4 because the
    // marginal ray is 2.265 mm where the glass is and a D = 4 lens vignettes its
    // own beam — the fidelity criterion would then report the rim. The triplet
    // keeps D = 5 and the same check: open the rim to 20 mm and not one pixel
    // moves, which is what "the aperture stop is the only stop" means.
    const narrow = planeAt(LINE_D).input.intensity;
    const wide = planeAt(LINE_D, finiteAt(FFD_D, 0, 20)).input.intensity;
    expect(narrow.length).toBe(wide.length);
    for (let i = 0; i < narrow.length; i++) expect(narrow[i]).toBe(wide[i]);
  });
});
