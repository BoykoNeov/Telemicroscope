import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription, SurfaceSpec } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { paraxialImageOffset } from "../src/analysis/focus";
import { pupils } from "../src/pupil/pupils";
import { lateralMagnification } from "../src/pupil/microscope";
import { objectFieldTile } from "../src/imaging/object-field";
import { diskSource } from "../src/illumination/source";
import { achromaticObjective } from "../src/designs/achromat";
import { telecentricStop } from "../src/designs/telecentric";
import {
  brightfieldSpectralStack,
  formBrightfieldPlane,
} from "../src/imaging/brightfield-spectrum";
import { colorImageFromStack, pixelXyz } from "../src/imaging/image";
import { chromaticity, spectrumToXyz, type Chromaticity } from "../src/photometry/cmf";
import { spectralSamples, spectralXyz } from "../src/photometry/spectrum";
import { getMedium } from "../src/materials/catalog";
import { LINE_D, LINE_F, LINE_C } from "../src/materials/dispersion";
import type { SpectralSpecimen } from "../src/imaging/specimen";

/**
 * Step 6ap — an achromatic telecentric tail.
 *
 * § 6an's "not yet pinned" list opens on it: *the band there is set by a
 * SINGLET's axial colour, and an achromatic tail would move it — the telecentric
 * condition would still hold at one wavelength, but 1/R(λ) would be secondary
 * spectrum rather than primary. Nothing here says how much.* This step says how
 * much, and the sentence it had to correct on the way is its own headline.
 *
 * **Telecentricity holds at TWO wavelengths here, not one.** The stop wants the
 * tail's front focal distance, and FFD(λ) for a singlet is monotone — it crosses
 * the stop once and that is § 6an's whole story. Achromatise the tail and FFD(λ)
 * TURNS AROUND inside the visible band, so a stop placed at FFD(d) is at a front
 * focal point at two wavelengths, 528.35 nm and the d line. The exit pupil is at
 * infinity at both, the defocus rescale 1 + δ/R(λ) reverses sign twice, and blue
 * and red end up on the SAME side of the pair rather than on opposite sides.
 *
 * And it makes the pole's own character a **design choice**, which § 6an could
 * not see: put the stop at the value FFD(λ) takes twice and the root is simple
 * and the sign reverses; put it at the TURN and the root is double — the pole is
 * touched rather than crossed, and the sign never reverses at all (§ 6ap.5).
 *
 * ## The external numbers
 *
 *  - **The glass pair's secondary spectrum**, Δf/f = −(P₁−P₂)/(V₁−V₂) off the
 *    catalogue's partial dispersions and Abbe numbers alone, for what the tail's
 *    residual colour has to BE once the primary is split away (§ 6ap.1) — and
 *    −1/V for the singlet the comparison is against.
 *  - **Gaussian optics on Sellmeier's n(λ)**: the 2×2 ray-transfer product for a
 *    three-surface cemented tail, its principal planes, and hence Newton's f²
 *    for where the exit pupil is at each wavelength (§ 6ap.3), and the 1/R(λ)
 *    the traced magnification is measured against (§ 6ap.4). Nothing traced.
 *  - **§ 6an's own measured numbers**, at identical `size` and `pupilSamples`,
 *    for every comparison that says "smaller than the singlet's" — a band read
 *    at a different sampling would be a picture of the sampling (§ 6ap.2, 7).
 *  - **The CIE 1931 observer at 1 nm** over Fresnel at the doublet's three
 *    interfaces, for the colour of a band the singlet could not render (§ 6ap.8).
 *
 * ## No new engine code
 *
 * `packages/core` was byte-for-byte what § 6ao left. The tail is `designs/achromat`'s
 * computed cemented doublet — the § 6b constructor, not a transcribed patent —
 * and everything else was § 6aj's fixture with a different lens in it.
 *
 * **The STOP is now a catalogue entry too.** § 6ar shipped `designs/telecentric`,
 * whose whole subject is the millimetre this step spends its rungs on, and this
 * file's two placements — the d line's front focal distance, and the turn 3.8 µm
 * inside it — are that constructor called twice with one option changed. Every
 * number below is § 6ap's own and unchanged.
 */

const STOP_R = 2;
const OBJECT_DISTANCE = 400;
const SIZE = 32;
const PUPIL_SAMPLES = 16;
const S = 0.5;
const SOURCE = diskSource(S, 15);
const ORIGIN = { x: 0, y: 0 } as const;
/** § 6al's probe height, so these magnifications are § 6an's magnifications. */
const PROBE_MM = OBJECT_DISTANCE * 1e-4;
const CLEAR: SpectralSpecimen = () => ({ re: 1, im: 0 });

/** Front focal distance of a group — § 6an's own −d/c form, on three surfaces. */
const ffd = (g: Prescription, nm: number): number =>
  -paraxialTrace(g, nm, { y: 0, u: 1 }).u / paraxialTrace(g, nm, { y: 1, u: 0 }).u;
/** Paraxial EFL of a group. */
const efl = (g: Prescription, nm: number): number => -1 / paraxialTrace(g, nm, { y: 1, u: 0 }).u;

/** § 6an's singlet tail, verbatim — the fixture this step replaces, and the
 *  control every "smaller than" below is measured against. */
const SINGLET_FRONT: SurfaceSpec = {
  kind: "refract",
  curvature: 1 / 40,
  semiAperture: 20,
  thickness: 9,
  medium: "N-BK7",
};
const singletBack = (thickness: number): SurfaceSpec => ({
  kind: "refract",
  curvature: -1 / 80,
  semiAperture: 20,
  thickness,
  medium: "AIR",
});
const SINGLET: Prescription = { surfaces: [SINGLET_FRONT, singletBack(0)] };
const SINGLET_FFD = ffd(SINGLET, LINE_D);

/**
 * The achromatic tail, at the singlet's focal length so nothing else moves.
 *
 * Two sizing decisions, because both change the numbers:
 *
 *  - **D = 5 mm, not 2·r_stop = 4.** The 2 mm stop sits ~53 mm ahead of the
 *    glass and the object 400 mm ahead of the stop, so the marginal ray is at
 *    2·(400+53)/400 = 2.265 mm where the glass is — wider than a D = 4 lens's
 *    own rim. Built at D = 4 the tail vignettes its own beam, and the fidelity
 *    criterion then reports the rim rather than the wavefront. At D = 5 the
 *    render is BITWISE what the same design with a 20 mm rim gives, which is
 *    what "the aperture stop is the only stop" is supposed to mean.
 *  - **The bending is solved at the finite conjugate.** § 6b measured that a
 *    doublet bent for a collimated object is a materially different lens; the
 *    tail sees the object at 400 + FFD ≈ 453 mm, and 453 is what it is solved
 *    at. (FFD comes out 52.988, so the conjugate the design used and the one it
 *    ends up at differ by 0.012 mm — four orders under anything here.)
 *
 * ΣS_I is nulled at zero, which is the one target that does NOT depend on the
 * marginal height the constructor evaluates it at: S_I ∝ h⁴, so a null at D/2 is
 * a null at 2.265 mm as well. The footgun in `AchromaticObjectiveSpec` is about
 * a NON-zero target, and this is not one.
 */
const DESIGN = achromaticObjective({
  apertureMm: 5,
  focalRatio: 53 / 5,
  objectDistanceMm: 453,
});
const TAIL = DESIGN.prescription.surfaces;
const TAIL_THICKNESS = TAIL[0]!.thickness + TAIL[1]!.thickness;
/** The tail alone, last thickness stripped — what a focal length is OF. */
const GROUP: Prescription = {
  surfaces: TAIL.map((s, i) => (i === TAIL.length - 1 ? { ...s, thickness: 0 } : s)),
};
/**
 * Where the stop goes — and it now comes from `designs/telecentric`, which § 6ar
 * shipped, rather than from a local `ffd` call.
 *
 * The placement IS the design here: `frontFocal` puts the stop at the value
 * FFD(λ) passes through at the d line, `turn` at the value it turns at, and the
 * whole of § 6ap.5 is the 3.8 µm between them. Both come off one constructor with
 * one option changed, which is exactly the pair this file's own deferral asked a
 * `designs/` entry to carry.
 */
const PLACED = telecentricStop({ tail: { surfaces: TAIL }, imageDistanceMm: 100 });
const PLACED_TURN = telecentricStop({
  tail: { surfaces: TAIL },
  placement: { kind: "turn" },
  imageDistanceMm: 100,
});
const FFD_D = PLACED.stopToVertexMm;

/** § 6aj's fixture with the achromatic tail in it — everything else unchanged. */
const finiteAt = (gap: number, defocus = 0): OpticalSystem => {
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
        ...TAIL.slice(0, -1),
        { ...TAIL[TAIL.length - 1]!, thickness: 100 },
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
/** Where the sensor is, on the axis the stop's vertex starts at z = 0. */
const IMAGE_Z = FFD_D + TAIL_THICKNESS + paraxialImageOffset(TELECENTRIC, LINE_D);

/** The same fixture with § 6an's singlet, for the comparisons that need one. */
const singletAt = (defocus = 0): OpticalSystem => {
  const base: OpticalSystem = {
    prescription: {
      surfaces: [
        {
          kind: "refract",
          curvature: 0,
          semiAperture: 30,
          thickness: SINGLET_FFD,
          medium: "AIR",
          isStop: true,
        },
        SINGLET_FRONT,
        singletBack(100),
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

/**
 * The tail in closed form: the Gaussian ray-transfer product on (y, n·u), its
 * principal planes, and Newton's f² for the stop's image. Sellmeier's n(λ) for
 * the two glasses is the only input and nothing here is traced — § 6an.3's route,
 * one element further in, where the thick-lens formula it used no longer applies.
 *
 * The system matrix is M = R₃T₂R₂T₁R₁ with R = [[1,0],[−(n′−n)c,1]] and
 * T = [[1,t/n],[0,1]]. Then f = −1/C, the front focal point is D·f before the
 * first vertex and the back focal point A·f after the last, and the stop — which
 * is at z = 0 on this axis — images to f²/frontFocus beyond the back focal point.
 */
function closedFormTail(nm: number, stopToVertex: number = FFD_D) {
  const c = TAIL.map((s) => s.curvature);
  const t = [TAIL[0]!.thickness, TAIL[1]!.thickness];
  const n = [1, getMedium(TAIL[0]!.medium!).n(nm), getMedium(TAIL[1]!.medium!).n(nm), 1];
  const mul = (A: readonly number[], B: readonly number[]): number[] => [
    A[0]! * B[0]! + A[1]! * B[2]!,
    A[0]! * B[1]! + A[1]! * B[3]!,
    A[2]! * B[0]! + A[3]! * B[2]!,
    A[2]! * B[1]! + A[3]! * B[3]!,
  ];
  const refract = (i: number): number[] => [1, 0, -(n[i + 1]! - n[i]!) * c[i]!, 1];
  const transfer = (i: number): number[] => [1, t[i]! / n[i + 1]!, 0, 1];
  let M = refract(0);
  M = mul(transfer(0), M);
  M = mul(refract(1), M);
  M = mul(transfer(1), M);
  M = mul(refract(2), M);
  const f = -1 / M[2]!;
  const frontFocus = stopToVertex - M[3]! * f;
  const backFocus = stopToVertex + t[0]! + t[1]! + M[0]! * f;
  return { f, frontFocus, backFocus, exitZ: backFocus + (f * f) / frontFocus };
}

/** Bisection on a sign change, to the last bits — used to FIND a pole, not to fit. */
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
/** Golden-section minimum, for the TURN in FFD(λ). */
const argmin = (g: (x: number) => number, a: number, b: number): number => {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 400; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (g(m1) < g(m2)) hi = m2;
    else lo = m1;
  }
  return 0.5 * (lo + hi);
};

/** The second wavelength at which the stop is at a front focal point. */
/**
 * The second wavelength the d-line placement is telecentric at. § 6ap bisected
 * for it here; it is now the constructor's own second crossing, and § 6ar.7 pins
 * the two routes equal.
 */
const SECOND_TELECENTRIC_NM = PLACED.telecentricWavelengthsNm.find(
  (nm) => Math.abs(nm - LINE_D) > 1,
)!;
/** Where FFD(λ) turns — the stop placement that makes the root double. */
const TURN_NM = PLACED.turningPointsNm[0]!;
const FFD_TURN = PLACED_TURN.stopToVertexMm;

const tileAt = (nm: number, system: OpticalSystem = TELECENTRIC) =>
  objectFieldTile(system, {
    size: SIZE,
    pupilSamples: PUPIL_SAMPLES,
    wavelengthNm: nm,
    centreMm: ORIGIN,
  });

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

const stackOver = (fromNm: number, toNm: number, count: number) =>
  brightfieldSpectralStack(TELECENTRIC, CLEAR, SOURCE, {
    size: SIZE,
    pupilSamples: PUPIL_SAMPLES,
    samples: spectralSamples(() => 1, { count, fromNm, toNm }),
    map: "uniform",
    patches: 1,
  });

/** A traced 61-plane stack costs seconds, and two rungs read the same four. */
const STACKS = new Map<number, ReturnType<typeof stackOver>>();
const stackAt = (count: number): ReturnType<typeof stackOver> => {
  const had = STACKS.get(count);
  if (had) return had;
  const built = stackOver(400, 700, count);
  STACKS.set(count, built);
  return built;
};
const SAMPLE_COUNTS = [11, 21, 31, 61];

/** § 6an.1's own measurements on the singlet, at THIS size and pupil sampling. */
const SINGLET_PHASE_STEP_470 = 0.3605176139086672;
const SINGLET_PHASE_STEP_480 = 0.3170573468954293;

const centreChromaticity = (stack: ReturnType<typeof stackOver>): Chromaticity =>
  chromaticity(pixelXyz(colorImageFromStack(stack), stack.size >> 1, stack.size >> 1));
const distance = (a: Chromaticity, b: Chromaticity): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Fresnel at normal incidence over the tail's THREE interfaces: air–crown,
 *  the cement joint, flint–air. § 6al.1's number for a doublet. */
const N_BK7 = getMedium("N-BK7");
const F2 = getMedium("F2");
const transmittance = (nm: number): number => {
  const n1 = N_BK7.n(nm);
  const n2 = F2.n(nm);
  const r = (a: number, b: number) => ((a - b) / (a + b)) ** 2;
  return (1 - r(1, n1)) * (1 - r(n1, n2)) * (1 - r(n2, 1));
};

/** Sensor moved by δ, as a fraction of the in-focus magnification. */
const shiftAt = (stopAt: number, nm: number, delta: number): number =>
  lateralMagnification(finiteAt(stopAt, delta), PROBE_MM, nm) /
    lateralMagnification(finiteAt(stopAt), PROBE_MM, nm) -
  1;
const singletShiftAt = (nm: number, delta: number): number =>
  lateralMagnification(singletAt(delta), PROBE_MM, nm) /
    lateralMagnification(singletAt(), PROBE_MM, nm) -
  1;

describe("§ 6ap.1 — the tail is achromatic, to the glass pair's own number", () => {
  it("the primary colour is 162× the singlet's smaller, and the singlet's own is −1/V", () => {
    // The ruler first, with no doublet in it: a thin singlet's fractional focal
    // shift between the F and C lines is −1/V by the definition of the Abbe
    // number, and § 6an's tail is thick enough to sit 2.4% off that. So the
    // control is a known quantity before the achromat is asked to beat it.
    const singletF = efl(SINGLET, LINE_F);
    const singletC = efl(SINGLET, LINE_C);
    const singletPrimary = (singletF - singletC) / efl(SINGLET, LINE_D);
    expect(singletPrimary).toBeCloseTo(-1.522484e-2, 8);
    // `DESIGN.crownAbbe` is N-BK7's V here only because the crown defaults to
    // N-BK7 — the same glass the singlet is made of. Swap the crown and this
    // control silently becomes a comparison between two different glasses.
    expect(DESIGN.crownMedium).toBe(SINGLET_FRONT.medium);
    expect(Math.abs(singletPrimary / (-1 / DESIGN.crownAbbe) - 1)).toBeLessThan(0.025);

    // And the doublet, whose two powers were split so this term cancels.
    const fD = efl(GROUP, LINE_D);
    const primary = (efl(GROUP, LINE_F) - efl(GROUP, LINE_C)) / fD;
    expect(primary).toBeCloseTo(-9.373168e-5, 10);
    expect(Math.abs(singletPrimary / primary)).toBeGreaterThan(160);
  });

  it("and what is LEFT is the pair's secondary spectrum, −(P₁−P₂)/(V₁−V₂)", () => {
    // THE EXTERNAL NUMBER, and it is a property of two glasses and nothing else:
    // the crown and flint are united at F and C by construction, so the d line
    // focuses short of them by a fraction fixed by the relative partial
    // dispersions. `designs/achromat` computes it off the catalogue; here it is
    // measured on the traced paraxial tail as the d focus against the F/C mean.
    const fD = efl(GROUP, LINE_D);
    const measured = (fD - 0.5 * (efl(GROUP, LINE_F) + efl(GROUP, LINE_C))) / fD;
    expect(DESIGN.secondarySpectrum).toBeCloseTo(-4.993389917e-4, 12);
    expect(measured).toBeCloseTo(-4.781165e-4, 10);
    expect(Math.abs(measured / DESIGN.secondarySpectrum - 1)).toBeLessThan(0.043);
  });

  it("and the 4.3% it misses by is the elements' THICKNESS, shown by doubling it", () => {
    // The gap above wants a mechanism, and a mechanism has to predict what would
    // CHANGE it. The power split is the THIN-lens closed form, so a thick pair
    // keeps Gullstrand's separation term and is not exactly achromatic: the
    // residual primary above is that term, and it should be proportional to the
    // element thicknesses while the secondary is not.
    //
    // So build the same design at 1×, 2× and 3× the centre thicknesses. The
    // residual primary tracks the thickness — 8.97e−5 per unit of it, through an
    // intercept two orders below the 1× value, so it extrapolates to zero for a
    // thin pair — and the gap to the closed form follows it up.
    const at = (scale: number) => {
      const d = achromaticObjective({
        apertureMm: 5,
        focalRatio: 53 / 5,
        objectDistanceMm: 453,
        crownThicknessMm: 0.5 * scale,
        flintThicknessMm: 0.3 * scale,
      });
      const s = d.prescription.surfaces;
      const g: Prescription = {
        surfaces: s.map((x, i) => (i === s.length - 1 ? { ...x, thickness: 0 } : x)),
      };
      const fD = efl(g, LINE_D);
      return {
        primary: (efl(g, LINE_F) - efl(g, LINE_C)) / fD,
        gap: (fD - 0.5 * (efl(g, LINE_F) + efl(g, LINE_C))) / fD / d.secondarySpectrum - 1,
      };
    };
    const one = at(1);
    const two = at(2);
    const three = at(3);

    // Linear in thickness to 4.3% over 1×…3×, with an intercept that is not the
    // effect: the slope is 8.97e−5 per unit scale and the extrapolated t = 0
    // value is 4.1e−6, 4.3% of the 1× reading. A thin pair is achromatic; this
    // one is thick. (The 4.3% is the separation term's own higher order, which
    // is why the second difference is smaller than the first and not larger.)
    const slope = two.primary - one.primary;
    expect(Math.abs((three.primary - two.primary) / slope - 1)).toBeLessThan(0.05);
    const intercept = one.primary - slope;
    expect(Math.abs(intercept / one.primary)).toBeLessThan(0.05);

    // And the gap to the glass pair's figure grows with it, which is the claim:
    // it is the thickness that separates the traced tail from the closed form,
    // not the closed form being the wrong number.
    expect(Math.abs(one.gap)).toBeCloseTo(0.0425, 3);
    expect(Math.abs(two.gap)).toBeGreaterThan(0.08);
    expect(Math.abs(three.gap)).toBeGreaterThan(0.12);
  });
});

describe("§ 6ap.2 — the refusal § 6an.1 measured is gone", () => {
  it("the wavefront per pupil sample is 18× smaller at the singlet's band edge", () => {
    // § 6an.1's band was NOT the visible band, and it was not a choice: brightfield
    // has no geometric branch to fall back to (ARCHITECTURE.md), so the criterion
    // refuses, and on a singlet it refused 470 nm at 0.3605 waves per pupil sample
    // and accepted 480 at 0.3171. Those are the numbers this is measured against,
    // at the same `size` and `pupilSamples` — a band read at a different sampling
    // would be a picture of the sampling and not of the tail.
    const at470 = planeAt(470);
    expect(at470.fidelity.verdict).toBe("valid");
    expect(at470.fidelity.phaseStepWaves).toBeCloseTo(0.024451901, 8);
    expect(SINGLET_PHASE_STEP_470 / at470.fidelity.phaseStepWaves!).toBeGreaterThan(14);

    const at480 = planeAt(480);
    expect(at480.fidelity.phaseStepWaves).toBeCloseTo(0.017748031, 8);
    expect(SINGLET_PHASE_STEP_480 / at480.fidelity.phaseStepWaves!).toBeGreaterThan(17);

    // The floor is at the d line, where the sensor actually is, and it is not
    // zero: a plane at focus still carries the tail's own spherical aberration.
    expect(planeAt(LINE_D).fidelity.phaseStepWaves).toBeCloseTo(0.000592605, 8);
  });

  it("so the whole visible band is honest, and 400 nm is not the edge either", () => {
    for (const nm of [380, 400, 440, 480, 550, 700, 800]) {
      expect(planeAt(nm).fidelity.verdict).toBe("valid");
    }
    // Still monotone away from focus in both directions, and still asymmetric —
    // n(λ) is steep in the blue and nearly flat in the red, so 380 nm costs more
    // than 800 does. That shape is the singlet's; only the scale changed.
    expect(planeAt(380).fidelity.phaseStepWaves).toBeGreaterThan(
      planeAt(800).fidelity.phaseStepWaves!,
    );
  });

  it("and § 6an.1's negative control — a 400…700 stack — now passes", () => {
    // § 6an.1 used this exact stack to show its band was measured rather than
    // chosen: on the singlet it carried a refusal, because the worst plane's
    // verdict is the stack's (§ 6r's contract). The same call on the same frame
    // with an achromatic tail is `valid`, which is the whole step in one line.
    expect(stackOver(400, 700, 9).fidelity?.verdict).toBe("valid");
  });
});

describe("§ 6ap.3 — telecentricity holds at TWO wavelengths, not one", () => {
  it("FFD(λ) turns around inside the band, so the stop is at a focal point twice", () => {
    // § 6an.3's sentence was "a front focal point is a length divided by a power
    // and a power is dispersive, so the stop is at the front focal point of one
    // wavelength and of no other." The first half survives; the second does not,
    // and the reason is that a MONOTONE FFD(λ) was doing the work rather than a
    // dispersive one. Achromatised, FFD(λ) has an interior minimum at 556.11 nm,
    // so the value it takes at the d line it also takes at 528.35.
    expect(TURN_NM).toBeCloseTo(556.1139, 3);
    expect(FFD_TURN - FFD_D).toBeCloseTo(-3.774536e-3, 8);
    expect(SECOND_TELECENTRIC_NM).toBeCloseTo(528.349225534, 8);

    // Both are exactly the stop's own position, so the exit pupil is at infinity
    // at both — and the engine says so on its own branch, not by the tolerance
    // of the search: `pupils` reports Infinity, which it only does when the
    // paraxial stop-image matrix's angle term vanishes outright.
    expect(pupils(TELECENTRIC, LINE_D).exit.z).toBe(Infinity);
    expect(pupils(TELECENTRIC, SECOND_TELECENTRIC_NM).exit.z).toBe(Infinity);
    expect(tileAt(LINE_D).scale.exitRadius).toBe(Infinity);
    expect(tileAt(SECOND_TELECENTRIC_NM).scale.exitRadius).toBe(Infinity);
  });

  it("and the same wavelength falls out of Sellmeier with nothing traced", () => {
    // THE EXTERNAL ROUTE. The second telecentric wavelength is where the closed
    // form's own front focal point reaches the stop, and the closed form is a
    // 2×2 matrix product on two Sellmeier indices. It agrees with the paraxial
    // engine's on the same double — not to a tolerance, bitwise.
    // Pinned to twelve digits rather than bitwise, though bitwise is what it
    // measures today: these are two different expression trees — a 2×2 matrix
    // product and a y–u trace — and an equality between them would turn any
    // ULP-level change in `paraxialTrace` into a failure that looks like physics.
    const closedFormSecond = bisect((nm) => closedFormTail(nm).frontFocus, 500, 560);
    expect(closedFormSecond).toBeCloseTo(SECOND_TELECENTRIC_NM, 9);
    // The d line is authored, so the closed form puts the front focal point at
    // zero there, the way § 6an.3 did on the singlet — and to its digit count.
    expect(closedFormTail(LINE_D).frontFocus).toBeCloseTo(0, 12);
  });

  it("so blue and red sit on the SAME side of the stop, and the middle on the other", () => {
    // The consequence that § 6an's fixture cannot have. With one crossing the
    // front focal point is past the stop on one side of it and short on the
    // other; with two, the band's ENDS share a sign and its middle takes the
    // opposite one. This is what makes § 6ap.7's cancellation happen.
    expect(closedFormTail(480).frontFocus).toBeLessThan(0);
    expect(closedFormTail(700).frontFocus).toBeLessThan(0);
    expect(closedFormTail(550).frontFocus).toBeGreaterThan(0);

    // Seen as the pupil rather than as the focal point: real and far behind the
    // image between the two poles, virtual and far in front outside them.
    expect(pupils(TELECENTRIC, 550).exit.z).toBeGreaterThan(IMAGE_Z);
    expect(pupils(TELECENTRIC, 480).exit.z).toBeLessThan(0);
    expect(pupils(TELECENTRIC, 700).exit.z).toBeLessThan(0);
  });

  it("and where the pupil is, is Newton's f² on Sellmeier — to 2e−12", () => {
    // § 6an.3's rung, on a tail its thick-lens formula no longer covers. The
    // wavelengths are taken away from both poles, where the quantity is finite
    // and the comparison is about the optics rather than about cancellation.
    for (const nm of [400, 450, 480, 500, 550, 620, 660, 700, 800]) {
      const closed = closedFormTail(nm).exitZ;
      const traced = pupils(TELECENTRIC, nm).exit.z;
      expect(Math.abs(closed / traced - 1)).toBeLessThan(2e-12);
    }
    // Within 0.05 nm of the second pole the pupil is 2e8 mm away — six orders
    // past the system's own length — and the two routes still agree to 1e−9,
    // which is what a removable singularity looks like from outside.
    const near = SECOND_TELECENTRIC_NM + 0.05;
    expect(Math.abs(pupils(TELECENTRIC, near).exit.z)).toBeGreaterThan(1e8);
    expect(Math.abs(closedFormTail(near).exitZ / pupils(TELECENTRIC, near).exit.z - 1)).toBeLessThan(
      1e-9,
    );
  });
});

describe("§ 6ap.4 — so the defocus rescale reverses sign TWICE", () => {
  it("the sensor still rescales as 1 + δ/R(λ), linear in δ", () => {
    // Unchanged from § 6an.4 and worth re-measuring only because R(λ) is a
    // different function now: the coefficient is the reciprocal of the closed
    // form's exit-pupil-to-image distance, and the traced magnification is
    // linear in the sensor's travel to the last bits.
    for (const nm of [400, 480, 550, 620, 700]) {
      const R = IMAGE_Z - closedFormTail(nm).exitZ;
      const base = lateralMagnification(TELECENTRIC, PROBE_MM, nm);
      let slope = NaN;
      for (const delta of [0.5, 1, 2]) {
        const moved = lateralMagnification(finiteAt(FFD_D, delta), PROBE_MM, nm);
        const measured = (moved / base - 1) / delta;
        // 2e−10 rather than § 6an.4's 5e−12, and the difference is not a worse
        // trace: the probe ray's absolute floor is the same 7e−10 per millimetre
        // there and here (the rung below), and here it is divided by a
        // coefficient twenty times smaller. A relative bound inherits that.
        if (Number.isNaN(slope)) slope = measured;
        else expect(Math.abs(measured / slope - 1)).toBeLessThan(2e-10);
        // ABSOLUTE, not relative, and that is the point of the rung below.
        expect(Math.abs(measured - 1 / R)).toBeLessThan(1e-9);
      }
    }
  });

  it("and what it misses by is a CONSTANT 6.8e−10 per millimetre, not a fraction", () => {
    // § 6an.4 quoted this agreement as a relative one (1e−5) and separately
    // recorded "4e−10 per millimetre at the design wavelength" as the probe
    // ray's floor. They are the same number. Here the coefficient itself runs
    // over two orders across the band and changes sign twice, so a relative
    // tolerance would be 7e−6 at 400 nm and 5e−4 at 550 — which would read as
    // the closed form failing near the poles when nothing is failing at all.
    //
    // The absolute difference is flat: −6.6e−10 at 400 nm and −6.84e−10 at
    // 700 nm, through a coefficient that passes through zero between them.
    const residuals = [400, 480, 550, 620, 700].map(
      (nm) => shiftAt(FFD_D, nm, 1) - 1 / (IMAGE_Z - closedFormTail(nm).exitZ),
    );
    for (const r of residuals) expect(r).toBeGreaterThan(-7e-10);
    for (const r of residuals) expect(r).toBeLessThan(-6.5e-10);
    const spread = Math.max(...residuals) - Math.min(...residuals);
    expect(spread).toBeLessThan(3e-11);
  });

  it("and the sign is +, −, + across the band — two reversals, not one", () => {
    // § 6an.4's picture was "a defocused edge fringes one way inside focus and
    // the other way outside it, with the reversal at the design wavelength."
    // Here there are two reversals and neither of them is at the middle of the
    // band: the ends agree with each other and the middle disagrees with both.
    expect(shiftAt(FFD_D, 400, 1)).toBeGreaterThan(1e-5);
    expect(shiftAt(FFD_D, 480, 1)).toBeGreaterThan(1e-5);
    expect(shiftAt(FFD_D, 550, 1)).toBeLessThan(-1e-6);
    expect(shiftAt(FFD_D, 570, 1)).toBeLessThan(-1e-6);
    expect(shiftAt(FFD_D, 620, 1)).toBeGreaterThan(1e-6);
    expect(shiftAt(FFD_D, 700, 1)).toBeGreaterThan(1e-5);

    // At both telecentric wavelengths it is the probe ray's own floor.
    expect(Math.abs(shiftAt(FFD_D, LINE_D, 1))).toBeLessThan(1e-9);
    expect(Math.abs(shiftAt(FFD_D, SECOND_TELECENTRIC_NM, 1))).toBeLessThan(1e-9);

    // And reversing the sensor's travel reverses the colour, so this is a
    // rescale about a pole and not an aberration with a sign of its own.
    expect(shiftAt(FFD_D, 480, -1) * shiftAt(FFD_D, 480, 1)).toBeLessThan(0);
  });
});

describe("§ 6ap.5 — put the stop at the TURN and the pole is touched, not crossed", () => {
  it("the sign never reverses, because the root is double", () => {
    // The finding § 6an could not have: whether the defocus colour reverses
    // across the band is a placement decision, not a property of the glass. At
    // FFD(d) the stop sits at a value FFD(λ) takes twice, so there are two
    // simple roots and two reversals. Move it 3.8 µm to where FFD(λ) turns and
    // the two roots merge: the pole is touched rather than crossed, 1/R(λ)
    // reaches zero and comes back on the same side, and the whole band fringes
    // in ONE direction.
    for (const nm of [400, 450, 480, 520, 540, 550, 570, LINE_D, 620, 656, 700]) {
      expect(shiftAt(FFD_TURN, nm, 1)).toBeGreaterThan(0);
    }
    // It really does reach the floor at the turn — a double root is still a
    // root, so telecentricity holds there exactly, once.
    expect(Math.abs(shiftAt(FFD_TURN, TURN_NM, 1))).toBeLessThan(1e-9);
    expect(pupils(finiteAt(FFD_TURN), TURN_NM).exit.z).toBe(Infinity);

    // The neighbourhood is what distinguishes the two placements: at the turn
    // the coefficient is quadratic in (λ − λ₀) and stays positive on both sides,
    // where at FFD(d) it is linear through each root and changes sign.
    expect(shiftAt(FFD_TURN, TURN_NM - 6, 1)).toBeGreaterThan(0);
    expect(shiftAt(FFD_TURN, TURN_NM + 6, 1)).toBeGreaterThan(0);
    expect(shiftAt(FFD_D, SECOND_TELECENTRIC_NM - 6, 1)).toBeGreaterThan(0);
    expect(shiftAt(FFD_D, SECOND_TELECENTRIC_NM + 6, 1)).toBeLessThan(0);
  });

  it("and it costs 3.8 µm of stop placement, which is the whole design decision", () => {
    // Said as the number a mount would have to hold: the two placements differ
    // by 3.8 µm out of 53 mm, a part in 14000. Nothing else about the system
    // changes — same glass, same powers, same conjugates — so "does the defocus
    // colour reverse" is decided by a spacer, not by the prescription.
    expect(Math.abs(FFD_TURN - FFD_D)).toBeLessThan(4e-3);
    expect(Math.abs(FFD_TURN - FFD_D) / FFD_D).toBeCloseTo(7.1e-5, 6);
  });
});

describe("§ 6ap.6 — two removable branch switches in one band", () => {
  it("the object pixel walks through both poles without a step", () => {
    // § 6an.5's rung, and it now has to hold twice. `imagePixelScaleMm` has two
    // formulas — one off `exitRadius/referenceRadius`, one off `slopeRadius` —
    // and this fixture takes the second at two wavelengths, so there are two
    // seams a spectral stack could show. Neither is there: the object pixel per
    // nanometre is monotone across both, with a total variation of 3.3e−10 over
    // 520…600 nm, which is the ruler's own λ drift (§ 6an.2's 1.1e−9 over 220 nm)
    // and not a step at either switch.
    const probes = [
      520,
      525,
      528,
      SECOND_TELECENTRIC_NM,
      529,
      535,
      550,
      570,
      587,
      LINE_D,
      588,
      600,
    ];
    const perNm = probes.map((nm) => tileAt(nm).objectPixelScaleMm / nm);
    for (let i = 1; i < perNm.length; i++) expect(perNm[i]!).toBeGreaterThan(perNm[i - 1]!);
    expect(Math.abs(perNm[perNm.length - 1]! / perNm[0]! - 1)).toBeLessThan(4e-10);

    // Locally, across the second switch alone, the ruler moves by 1.1e−11 —
    // three orders under the § 6an.2 residual that a real seam would have to
    // hide inside.
    const local = [527.5, 528.3, SECOND_TELECENTRIC_NM, 528.4, 529.5].map(
      (nm) => tileAt(nm).objectPixelScaleMm / nm,
    );
    expect(Math.abs(local[local.length - 1]! / local[0]! - 1)).toBeLessThan(2e-11);
  });

  it("and both switches are really exercised, on either side of each", () => {
    // The neighbours are on the finite branch with a reference sphere five to
    // eight orders longer than the system, and the poles themselves take the
    // slope branch, where the reference radius is 1 by construction.
    expect(tileAt(SECOND_TELECENTRIC_NM).scale.referenceRadius).toBe(1);
    expect(tileAt(LINE_D).scale.referenceRadius).toBe(1);
    expect(tileAt(SECOND_TELECENTRIC_NM).scale.slopeRadius).toBeCloseTo(0.037713043888, 11);
    expect(tileAt(LINE_D).scale.slopeRadius).toBeCloseTo(0.037711939481, 11);

    for (const nm of [528.3, 528.4, 587.55, 587.57]) {
      expect(tileAt(nm).scale.slopeRadius).toBeUndefined();
      expect(tileAt(nm).scale.referenceRadius).toBeGreaterThan(1e8);
    }
  });
});

describe("§ 6ap.7 — what the achromat buys, and why it is more than the excursion", () => {
  it("the blue-to-red defocus colour is 51× smaller than the singlet's", () => {
    // § 6an.4's closing quantity: the ratio of the blue and red magnifications,
    // 1 in focus and 3.5e−4 away from it a millimetre out. The same measurement
    // on the same frame with an achromatic tail is 6.8e−6.
    const ratio = (delta: number) =>
      lateralMagnification(finiteAt(FFD_D, delta), PROBE_MM, 480) /
      lateralMagnification(finiteAt(FFD_D, delta), PROBE_MM, 700);
    const defocused = Math.abs(ratio(1) / ratio(0) - 1);
    expect(defocused).toBeCloseTo(6.7511e-6, 9);

    const singletDefocused = Math.abs(singletShiftAt(480, 1) - singletShiftAt(700, 1));
    expect(singletDefocused).toBeCloseTo(3.479408e-4, 9);
    expect(singletDefocused / defocused).toBeGreaterThan(51);

    // In focus the two colours share a ruler to the probe's floor, exactly as
    // the singlet did: the frame has no lateral colour of its own, and what
    // defocus makes is the sensor's doing and not the lens's.
    expect(Math.abs(ratio(0) / ratio(1e-9) - 1)).toBeLessThan(1e-12);
  });

  it("but only 17× of that is the excursion — the rest is the SIGN", () => {
    // This is the rung that keeps § 6ap.7 from being a slogan. The quantity the
    // rescale is built out of is how far FFD(λ) wanders from the stop, and that
    // improves by 17.4× over 480…700. Per wavelength the improvement is 18.6× at
    // 480 and 7.2× at 700 — neither of them 51.
    const spanOf = (g: Prescription, stop: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let nm = 480; nm <= 700; nm += 1) {
        const v = ffd(g, nm) - stop;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    const excursionRatio = spanOf(SINGLET, SINGLET_FFD) / spanOf(GROUP, FFD_D);
    expect(excursionRatio).toBeCloseTo(17.4039, 3);

    expect(Math.abs(singletShiftAt(480, 1) / shiftAt(FFD_D, 480, 1))).toBeCloseTo(18.64, 1);
    expect(Math.abs(singletShiftAt(700, 1) / shiftAt(FFD_D, 700, 1))).toBeCloseTo(7.16, 1);

    // The remaining factor of three is § 6ap.3's two poles. On the singlet blue
    // and red straddle the single crossing, so their shifts have OPPOSITE signs
    // and the blue-to-red difference is their SUM; on the doublet both ends sit
    // outside the pair of poles, so the difference is what is left after they
    // cancel. Same signs is worth more than a smaller excursion here.
    expect(singletShiftAt(480, 1) * singletShiftAt(700, 1)).toBeLessThan(0);
    expect(shiftAt(FFD_D, 480, 1) * shiftAt(FFD_D, 700, 1)).toBeGreaterThan(0);
  });

  it("and over 400…700 — a band the singlet could not render — it is 7.5e−5", () => {
    // The honest way to quote the whole-band figure: the comparison above runs
    // over § 6an's band because that is the only band both fixtures have. Over
    // the band this one actually has, the defocus colour is larger, because
    // 400 nm is where the tail's residual colour is steepest.
    const ratio = (delta: number) =>
      lateralMagnification(finiteAt(FFD_D, delta), PROBE_MM, 400) /
      lateralMagnification(finiteAt(FFD_D, delta), PROBE_MM, 700);
    expect(Math.abs(ratio(1) / ratio(0) - 1)).toBeCloseTo(7.4981e-5, 8);
  });
});

describe("§ 6ap.8 — the whole visible band renders, and its colour is the CIE integral", () => {
  it("the imaging chain carries the spectrum across the wider band, to 4.1e−10", () => {
    // THE IMAGING HALF, and it is a separate rung for § 6an.6's reason: the two
    // answers below have residuals four orders apart, and reporting the larger
    // one as "the imaging error" would blame the lens for the ruler.
    //
    // Here the observer is held fixed and only the spectrum's route differs: the
    // rendered chromaticity against what the SAME observer gives for Fresnel at
    // the tail's three interfaces — air–crown, the cement joint, flint–air —
    // evaluated straight off Sellmeier. The frames, the per-λ Abbe sums and the
    // stack's resampling carry the spectrum and add 4e−10 to it, at every sample
    // count. This is the rung a regression in the imaging chain has to pass.
    for (const count of SAMPLE_COUNTS) {
      const stack = stackAt(count);
      expect(stack.fidelity?.verdict).toBe("valid");
      const rendered = centreChromaticity(stack);
      const throughObserver = chromaticity(
        spectralXyz(
          stack.samples,
          stack.samples.map((s) => transmittance(s.nm)),
        ),
      );
      expect(distance(rendered, throughObserver)).toBeLessThan(5e-10);

      // The negative control, on that same fixed observer: an equal-energy lamp
      // that never met the glass. The render sits a million times closer to the
      // tinted spectrum than to the flat one, so the rung above is a measurement
      // and not two small numbers agreeing.
      const flatObserver = chromaticity(
        spectralXyz(
          stack.samples,
          stack.samples.map(() => 1),
        ),
      );
      expect(distance(rendered, flatObserver) / distance(rendered, throughObserver)).toBeGreaterThan(
        1e6,
      );
    }
  });

  it("and the absolute colour is the CIE integral at 1 nm, over a band § 6an could not reach", () => {
    // THE EXTERNAL HALF. § 6an.6 asked this over 480…700 nm because the engine
    // refused everything bluer; the band is what is new, and the observer is the
    // CIE 1931 one walked at 1 nm with no optical system in it.
    const closed = chromaticity(spectrumToXyz(transmittance, { fromNm: 400, toNm: 700, stepNm: 1 }));
    const flat = chromaticity(spectrumToXyz(() => 1, { fromNm: 400, toNm: 700, stepNm: 1 }));

    // The tint first: both glasses reflect more in the blue, so what gets through
    // is warmer than what lit it, and a lamp that never met the glass is 5.3e−4
    // away — the distance the agreement below is measured against.
    expect(distance(closed, flat)).toBeCloseTo(5.2752e-4, 7);
    expect(closed.x - flat.x).toBeGreaterThan(3e-4);

    for (const count of SAMPLE_COUNTS) {
      const rendered = centreChromaticity(stackAt(count));
      expect(distance(rendered, closed)).toBeLessThan(2e-6);
      expect(distance(rendered, flat) / distance(rendered, closed)).toBeGreaterThan(250);
    }
  });

  it("and that gap is the OBSERVER's, reproduced with no optical system in it", () => {
    // The attribution, measured rather than asserted — § 6ao.8's lesson, which
    // is that a mechanism named is not a mechanism shown. The claim is that the
    // 1e−6-ish residual above is `spectralXyzBasis`'s binned observer against
    // `spectrumToXyz`'s 1 nm walk and has nothing to do with the optics. What
    // discriminates it is running the same two routes with the lens removed: the
    // gap comes back to within 0.2%, and it does so at four sample counts where
    // it is not even monotone in the count — 1.7e−6 at 11 planes, 8.2e−8 at 21.
    //
    // Which is also why the residual above is NOT a convergence: a quadrature
    // error would fall with the count, and this wanders.
    const closed = chromaticity(spectrumToXyz(transmittance, { fromNm: 400, toNm: 700, stepNm: 1 }));
    for (const count of SAMPLE_COUNTS) {
      const stack = stackAt(count);
      const rendered = centreChromaticity(stack);
      const throughObserver = chromaticity(
        spectralXyz(
          stack.samples,
          stack.samples.map((s) => transmittance(s.nm)),
        ),
      );
      expect(
        Math.abs(distance(throughObserver, closed) / distance(rendered, closed) - 1),
      ).toBeLessThan(2e-3);
    }
  });
});
