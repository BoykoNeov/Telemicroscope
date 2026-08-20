import { describe, it, expect } from "vitest";
import { OpticalSystem } from "../src/trace/system";
import { Prescription } from "../src/trace/prescription";
import { paraxialTrace } from "../src/trace/paraxial";
import { paraxialImageOffset } from "../src/analysis/focus";
import { pupils } from "../src/pupil/pupils";
import { objectFieldFrame, fieldPupilAt, tracedFieldPupils } from "../src/imaging/object-field";
import { rasterizeSpecimen, specimenPointAt } from "../src/imaging/specimen";
import { renderBrightfield } from "../src/imaging/brightfield";
import { diskSource } from "../src/illumination/source";
import { cosineGratingObject, imageHarmonic } from "../src/illumination/abbe";
import {
  brightfieldResolutionMm,
  gratingImage,
  idealPupil,
  weakObjectTransfer,
  weakObjectTransferDisk,
} from "../src/illumination/transfer";
import { getMedium } from "../src/materials/catalog";
import { LINE_D } from "../src/materials/dispersion";

/**
 * Step 6al — scene content through a telecentric frame.
 *
 * § 6ak lifted the guard that made an image-space telecentric system
 * unrenderable, and its own "not yet pinned" list closed with the sentence this
 * step exists to answer: *the frame now has a size and the transform now runs,
 * but nothing has been put through it end to end, and "the ruler is right" is a
 * weaker claim than "the image is right."*
 *
 * So: a specimen, authored as a callback in object millimetres, rasterized onto
 * the frame § 6ak.5 gave a size to, imaged through the objective's own traced
 * pupils under a condenser, and measured. **No new physics and no new engine
 * code** — every component below is one § 6f/§ 6h/§ 6n already pinned; what is
 * new is that they are run in series on the fixture whose exit pupil is at
 * infinity, and that the picture that comes out is checked against numbers from
 * outside the engine rather than against its own ruler.
 *
 * ## The external numbers
 *
 *  - **Fresnel at normal incidence.** A clear field's brightness is (1 − R)² for
 *    the two uncoated N-BK7 surfaces the light crosses, R = ((n−1)/(n+1))².
 *    Nothing in the imaging chain is allowed to invent or lose light, and this is
 *    the only rung here that would catch it — everything else is a contrast
 *    ratio, and a ratio divides a lost factor out (§ 6al.1).
 *  - **The three-order Abbe sum**, evaluated in closed form off the DFT lattice
 *    (`gratingImage`), against the same image formed by the transform (§ 6al.3).
 *  - **Hopkins' partially coherent transfer for a disc source**, the closed form
 *    § 6f pins, against the traced pupil's own — so the departure is the
 *    objective's aberration and is reported as such (§ 6al.4).
 *  - **Abbe's resolution limit** λ/(NA_obj + NA_cond), in millimetres on the
 *    specimen, against the period at which the rendered contrast vanishes — with
 *    the objective's object-space NA taken from the *entrance pupil's* geometry
 *    and not from the frame's ruler, so the two routes are independent (§ 6al.5).
 *
 * ## And two properties of telecentricity that only an image can show
 *
 * § 6ak.5 pinned that the ruler does not drift **across the field**. The axis it
 * did not touch is the sensor's own position, and that is the textbook reason to
 * build image-space telecentric at all: the chief rays leave parallel to the
 * axis, so moving the image plane blurs the picture without rescaling it
 * (§ 6al.6). Against the ordinary fixture, whose magnification goes as 1 + δ/R.
 *
 * And § 6al.8 is the only claim here about the image being **nonlinear** in the
 * object: the picture carries a periodicity at 2ν, put there by the beat between
 * two diffracted orders, at frequencies whose linear transfer is exactly zero.
 * That is the property that leaves brightfield with no fallback branch at all.
 *
 * The second is a negative, and it matters because the name invites the mistake:
 * **this system is image-space telecentric and is NOT object-space telecentric**
 * (§ 6al.7). Its entrance pupil is the stop, 400 mm ahead of the specimen, so
 * the illumination cone walks off centre by h/r_ep at object height h — the
 * § 6x displacement `renderBrightfield` translates the source by, alive on a
 * fixture whose *other* end is telecentric. The two are independent properties
 * of the two ends of the same system.
 */

const STOP_R = 2;

/** § 6aj's fixture, unchanged — the same thick asymmetric singlet as the tail. */
const LENS_FRONT = {
  kind: "refract" as const,
  curvature: 1 / 40,
  semiAperture: 20,
  thickness: 9,
  medium: "N-BK7",
};
const lensBack = (medium: string, thickness: number) => ({
  kind: "refract" as const,
  curvature: -1 / 80,
  semiAperture: 20,
  thickness,
  medium,
});
const group = (medium: string): Prescription => ({ surfaces: [LENS_FRONT, lensBack(medium, 0)] });

/** The tail's front focal distance — the gap at which the exit pupil is at infinity. */
const frontFocalDistance = (): number => {
  const g = group("AIR");
  const c = paraxialTrace(g, LINE_D, { y: 1, u: 0 }).u;
  const d = paraxialTrace(g, LINE_D, { y: 0, u: 1 }).u;
  return -d / c;
};
const FFD = frontFocalDistance();

/**
 * § 6ak.5's finite-conjugate arrangement, with the image plane offset by
 * `defocus` from the paraxial solve — the sensor-position axis § 6al.6 walks.
 */
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
        LENS_FRONT,
        lensBack("AIR", 100),
      ],
    },
    aperture: { kind: "stopRadius", value: STOP_R },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: LINE_D, weight: 1 }],
    conjugate: { kind: "finite", distance: 400 },
  };
  return {
    ...base,
    imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, LINE_D) + defocus },
  };
};

const TELECENTRIC = finiteAt(FFD);
/** The same optics with the stop 20 mm ahead of the tail: an ordinary exit pupil. */
const ORDINARY = finiteAt(20);

const SIZE = 32;
const PUPIL_SAMPLES = 16;
const FRAME_OPTIONS = { size: SIZE, pupilSamples: PUPIL_SAMPLES } as const;

/** Coherence parameter of the condenser every render below is lit by. */
const S = 0.5;
/** 177 directions. § 6al.4 measures where this sampling stops being faithful. */
const SOURCE = diskSource(S, 15);
/** Weak enough that the closed forms apply; § 6al.4 accounts for the m² left over. */
const MOD = 0.02;

const frameOf = (system: OpticalSystem) => objectFieldFrame(system, FRAME_OPTIONS);

/** Full width of the frame on the specimen (mm) — `size` × the object pixel. */
const objectExtentOf = (frame: { size: number; objectPixelScaleMm: number }): number =>
  frame.size * frame.objectPixelScaleMm;

/** t(x) = 1 + m·cos(2πx/period), authored in **object millimetres**. */
const cosineSpecimen =
  (periodMm: number, modulation = MOD) =>
  (xMm: number, _yMm: number) => ({
    re: 1 + modulation * Math.cos((2 * Math.PI * xMm) / periodMm),
    im: 0,
  });

/** Rasterize → image → read the harmonic at `cycles`. The whole path, once. */
function renderGrating(
  system: OpticalSystem,
  frame: ReturnType<typeof frameOf>,
  cycles: number,
  options: { map?: "traced" | "uniform"; patches?: number; modulation?: number } = {},
) {
  const specimen = cosineSpecimen(objectExtentOf(frame) / cycles, options.modulation ?? MOD);
  const object = rasterizeSpecimen(system, frame, specimen, { map: options.map ?? "uniform" });
  const rendered = renderBrightfield(object, tracedFieldPupils(system, frame), SOURCE, {
    pupilSamples: PUPIL_SAMPLES,
    scale: frame.scale,
    patches: options.patches ?? 1,
  });
  return { rendered, harmonic: imageHarmonic(rendered.intensity, frame.size, cycles, 0) };
}

/** ν in `illumination/transfer`'s units: 1 is the coherent cutoff, 2 the incoherent. */
const nuOf = (cycles: number): number => (2 * cycles) / PUPIL_SAMPLES;

describe("§ 6al.1 — the clear field renders, and its brightness is Fresnel's", () => {
  it("puts a specimen through the whole path and comes back with a picture", () => {
    const frame = frameOf(TELECENTRIC);
    // The branch this step is about, asserted where it is used: a future change
    // that gives this fixture a finite exit pupil must not leave the rungs below
    // green while testing something else entirely.
    expect(frame.scale.exitRadius).toBe(Infinity);
    expect(frame.scale.slopeRadius).toBe(0.03776953728795632);

    const object = rasterizeSpecimen(TELECENTRIC, frame, () => ({ re: 1, im: 0 }), {
      map: "uniform",
    });
    const rendered = renderBrightfield(object, tracedFieldPupils(TELECENTRIC, frame), SOURCE, {
      pupilSamples: PUPIL_SAMPLES,
      scale: frame.scale,
      patches: 1,
    });

    // Brightfield is the one place with no second branch (ARCHITECTURE.md): it
    // rules rather than falling back. A rung claiming "the image is right" on a
    // verdict of `unknown` would be claiming what the engine declines to certify.
    expect(rendered.fidelity.verdict).toBe("valid");
    expect(rendered.fidelity.geometricShare).toBe(0);
    expect(rendered.contributingPoints).toBe(SOURCE.points.length);
    // The frame's own ruler survives the render, in millimetres.
    expect(rendered.pixelScaleMm).toBe(frame.pixelScaleMm);
    expect(rendered.pixelScaleMm).toBeCloseTo(0.003889124954857188, 15);
  });

  it("and the level is (1 − R)² for two uncoated N-BK7 surfaces", () => {
    // THE EXTERNAL NUMBER. Fresnel at normal incidence, R = ((n−1)/(n+1))², twice
    // — the only rung in this file that would notice the imaging chain inventing
    // or losing light, because everything else here is a contrast ratio and a
    // ratio divides a lost factor out.
    const n = getMedium("N-BK7").n(LINE_D);
    const reflectance = ((n - 1) / (n + 1)) ** 2;
    expect(reflectance).toBeCloseTo(0.042164567068204935, 15);
    const transmitted = (1 - reflectance) ** 2;

    const frame = frameOf(TELECENTRIC);
    const object = rasterizeSpecimen(TELECENTRIC, frame, () => ({ re: 1, im: 0 }), {
      map: "uniform",
    });
    const { intensity } = renderBrightfield(
      object,
      tracedFieldPupils(TELECENTRIC, frame),
      SOURCE,
      { pupilSamples: PUPIL_SAMPLES, scale: frame.scale, patches: 1 },
    );

    let min = Infinity;
    let max = -Infinity;
    for (const v of intensity) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // A clear field is FLAT to the last bit — one patch, one pupil, one constant
    // object, so any structure at all would be the transform's own.
    expect(max).toBe(min);
    expect(min).toBeCloseTo(0.9174487379809863, 15);
    // 2.7e−8 from the closed form: the traced amplitude is Fresnel evaluated at
    // each ray's real incidence, which on this f/100 axial cone is normal to
    // within that. Not a tolerance chosen to fit — the gap closes as the cone.
    expect(Math.abs(min / transmitted - 1)).toBeLessThan(1e-7);
    expect(min).toBeCloseTo(transmitted, 7);
  });
});

describe("§ 6al.2 — a specimen authored in millimetres lands where the ruler says", () => {
  it("the uniform map reproduces `cosineGratingObject` at an even cycle count", () => {
    // The two rasterizers meet here for the first time. `cosineGratingObject`
    // counts cycles across the GRID; the specimen callback knows only object
    // millimetres and reaches the grid through `objectPixelScaleMm`, which on
    // this fixture is the slope-derived pixel of § 6ak.5 divided by |M|. If that
    // ruler were wrong by any factor the grating would land at a different
    // number of cycles and this difference would be O(m), not O(ε).
    const frame = frameOf(TELECENTRIC);
    const cycles = 4;
    const authored = rasterizeSpecimen(
      TELECENTRIC,
      frame,
      cosineSpecimen(objectExtentOf(frame) / cycles),
      { map: "uniform" },
    );
    const reference = cosineGratingObject({ size: SIZE, cycles, modulation: MOD });
    let worst = 0;
    for (let i = 0; i < authored.re.length; i++) {
      worst = Math.max(worst, Math.abs(authored.re[i]! - reference.re[i]!));
    }
    expect(worst).toBeLessThan(2e-16);

    // EVEN is not a convenience. `specimenPointAt`'s pixel convention puts the
    // frame's centre ON pixel size/2, so the authored phase is shifted by
    // π·cycles relative to a grating counted from pixel 0 — the two agree for
    // even cycles and are exactly opposite in their AC part for odd ones. Stated
    // rather than avoided: a half-pixel registration error looks like this, and
    // it would be invisible if the rung only ever used even counts without
    // saying why.
    const odd = rasterizeSpecimen(TELECENTRIC, frame, cosineSpecimen(objectExtentOf(frame) / 5), {
      map: "uniform",
    });
    const oddReference = cosineGratingObject({ size: SIZE, cycles: 5, modulation: MOD });
    let oppositeWorst = 0;
    for (let i = 0; i < odd.re.length; i++) {
      oppositeWorst = Math.max(oppositeWorst, Math.abs(odd.re[i]! - (2 - oddReference.re[i]!)));
    }
    expect(oppositeWorst).toBeLessThan(3e-16);
  });

  it("and the traced map is nearly the identity HERE, which is a measurement not an assumption", () => {
    // § 6n's warp is the authoring path's whole reason for existing, and on this
    // fixture it is 1.3e−4 of a pixel — a stop plus one singlet at 0.13×, over a
    // 0.94 mm field, has almost no distortion to carry. Recorded so that the
    // renders below may use the cheap map without that being a silent choice:
    // where the warp is this small the two maps are the same picture, and where
    // it is not (§ 6m.4's mosaic, 49 ppm at 0.8 mm) this rung is the negative
    // control that says so.
    const frame = frameOf(TELECENTRIC);
    let worstMm = 0;
    for (const [ix, iy] of [
      [0, 0],
      [SIZE - 1, SIZE - 1],
      [0, SIZE - 1],
      [SIZE / 2, 0],
      [SIZE - 1, SIZE / 2],
    ] as const) {
      const uniform = specimenPointAt(TELECENTRIC, frame, ix, iy, { map: "uniform" });
      const traced = specimenPointAt(TELECENTRIC, frame, ix, iy, { map: "traced" });
      worstMm = Math.max(worstMm, Math.hypot(uniform.x - traced.x, uniform.y - traced.y));
    }
    expect(worstMm).toBeCloseTo(3.833067166115257e-6, 12);
    expect(worstMm / frame.objectPixelScaleMm).toBeCloseTo(1.3047366543567158e-4, 10);
  });
});

describe("§ 6al.3 — the rendered image IS the three-order sum, on a telecentric frame", () => {
  it("agrees with `gratingImage` to f64 accumulation, across the frequency axis", () => {
    // The transform leg. `gratingImage` evaluates the SAME traced pupil and the
    // SAME sampled source at exact continuous coordinates and does the inverse
    // transform in closed form — no FFT, no grid. The render does it on the DFT
    // lattice through `rasterizeSpecimen` → `abbeImage`. Two computations of one
    // number with almost nothing in common but the pupil.
    //
    // What this pins that § 6f did not: § 6f ran it on an ideal pupil with no
    // system behind it. Here the pupil is traced through a system whose exit
    // pupil is at infinity and whose grid spacing therefore comes from
    // `slopeRadius` — the substitution § 6ak made — so a wrong ruler would put
    // the object's three lines on the wrong lattice bins and the two would part.
    const frame = frameOf(TELECENTRIC);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);
    expect(centre.exitRadius).toBe(Infinity);
    expect(centre.slopeRadius).toBe(frame.scale.slopeRadius);

    for (const cycles of [2, 4, 8, 11]) {
      const { harmonic } = renderGrating(TELECENTRIC, frame, cycles);
      const closed = gratingImage(centre.pupil, SOURCE, nuOf(cycles), MOD);
      expect(Math.abs(harmonic.contrast / closed.contrast - 1)).toBeLessThan(1e-12);
    }
  });
});

describe("§ 6al.4 — and the three-order sum is Hopkins' closed form, to the aberration", () => {
  it("the sampled source is faithful below ν = 0.5 and the departure is the objective's", () => {
    // Three quantities and two gaps, so that neither gap is attributed to the
    // other. `weakObjectTransferDisk` is the closed form for a UNIFORM disc and a
    // PERFECT pupil; the sampled disc and the traced pupil each depart from it.
    const frame = frameOf(TELECENTRIC);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);

    for (const cycles of [1, 2, 3, 4]) {
      const nu = nuOf(cycles);
      // Gap one: the 177-point lattice against the continuous disc. Zero to six
      // decimals out here — the carrying region is a large fraction of the
      // source, so the lattice resolves it.
      const sampling = weakObjectTransfer(idealPupil(), SOURCE, nu) / weakObjectTransferDisk(S, nu);
      expect(sampling).toBeCloseTo(1, 6);
    }

    // Gap two: the objective's own wavefront, 0.0179 waves RMS on this fixture.
    // 4.9e−4 of transfer at ν = 0.25, and it is physics — the closed form is for
    // an aberration-free pupil and this pupil is traced.
    const nu = nuOf(2);
    const aberrated = weakObjectTransfer(centre.pupil, SOURCE, nu);
    expect(centre.rmsWaves).toBeCloseTo(0.017869938342837545, 12);
    expect(aberrated / weakObjectTransferDisk(S, nu)).toBeCloseTo(0.9995117746725329, 12);

    // And the rendered picture is that, times the finite-modulation correction
    // the weak-object limit drops: `gratingImage`'s dc carries m²/2 of sideband
    // power, so contrast/(2m) is the transfer divided by (1 + m²/2).
    const { harmonic } = renderGrating(TELECENTRIC, frame, 2);
    expect(harmonic.contrast / (2 * MOD)).toBeCloseTo(aberrated / (1 + (MOD * MOD) / 2), 6);
  });

  it("and near the cutoff it is the SOURCE LATTICE that departs, not the image", () => {
    // The honest limit of the leg above, measured rather than left as a
    // tolerance. At ν = 1.375 the directions that carry contrast are a thin
    // crescent of the source disc, and a lattice samples a thin crescent badly —
    // § 6ab.12's "aperture yes, sampling no", here as a smooth error instead of a
    // missing harmonic. Refining the lattice moves the answer by 30%, which is
    // why no rung above compares to the closed form at this frequency.
    const nu = nuOf(11);
    const coarse = weakObjectTransfer(idealPupil(), diskSource(S, 7), nu);
    const fine = weakObjectTransfer(idealPupil(), diskSource(S, 25), nu);
    const closed = weakObjectTransferDisk(S, nu);
    expect(coarse / closed).toBeCloseTo(1.3497410125339433, 9);
    expect(fine / closed).toBeCloseTo(0.9872338830599421, 9);
    // The image is not what moved: the render tracks whichever source it was
    // handed, to the 1e−12 of § 6al.3. So the sampling error is ten orders of
    // magnitude larger than the render's, which is the ordering the explanation
    // requires and the reason the closed form is not the thing to blame here.
    expect(Math.abs(fine / coarse - 1)).toBeGreaterThan(1e-2);
  });
});

describe("§ 6al.5 — the cutoff lands on Abbe's period, in millimetres on the specimen", () => {
  it("contrast survives at 11 cycles and is f64 zero at 12, which is (1 + S)", () => {
    // The rung this step is for. Everything above says the picture is the sum
    // the theory names; this says the picture STOPS where the physics says it
    // must, in a unit that exists outside the engine.
    const frame = frameOf(TELECENTRIC);
    // ν = 1 + S = 1.5 at 2·cycles/pupilSamples ⇒ cycles = 12, exactly on the grid.
    expect(nuOf(12)).toBe(1 + S);
    const below = renderGrating(TELECENTRIC, frame, 11).harmonic;
    const atCutoff = renderGrating(TELECENTRIC, frame, 12).harmonic;
    const above = renderGrating(TELECENTRIC, frame, 13).harmonic;
    expect(below.contrast).toBeCloseTo(0.002590429654361757, 12);
    expect(atCutoff.contrast).toBeLessThan(1e-14);
    expect(above.contrast).toBeLessThan(1e-14);
    // Not a small number against a threshold: eleven orders below the frequency
    // one step lower, which is what "the aperture does not carry this at all"
    // looks like as opposed to "it carries it weakly".
    expect(below.contrast / atCutoff.contrast).toBeGreaterThan(1e11);
  });

  it("and the period there is λ/(NA_obj + NA_cond), off the entrance pupil's own geometry", () => {
    // THE EXTERNAL NUMBER, and the two routes to it are kept apart on purpose.
    //
    // Route one is the frame's: the object period at 12 cycles is
    // size·objectPixelScaleMm/12, which is the slope-derived pixel of § 6ak.5
    // carried to the object side by the traced magnification.
    //
    // Route two never touches the frame. The entrance pupil of this system IS
    // the stop — the first surface — so its object-space marginal tangent is
    // r_ep/z_obj = 2/400, and Abbe's limit follows from that and λ alone.
    const frame = frameOf(TELECENTRIC);
    const gridPeriodMm = objectExtentOf(frame) / 12;

    const entrance = pupils(TELECENTRIC, LINE_D).entrance;
    expect(entrance.z).toBe(0);
    expect(entrance.radius).toBe(STOP_R);
    const objectDistance = 400 + entrance.z;
    const tanU = entrance.radius / objectDistance;
    expect(tanU).toBe(0.005);

    const abbeTangent = brightfieldResolutionMm(LINE_D, tanU, S * tanU);
    expect(abbeTangent).toBeCloseTo(0.07834157333333333, 15);
    expect(gridPeriodMm).toBeCloseTo(0.07834157497486424, 15);
    // 2.1e−8 apart, and that residual is the paraxial construction against the
    // traced one — nothing in the imaging chain sits between them.
    expect(Math.abs(gridPeriodMm / abbeTangent - 1)).toBeLessThan(3e-8);

    // AND THE FORK IS NAMED RATHER THAN AVERAGED OVER. § 6ak.3 recorded that the
    // engine's NA is the TANGENT reading and Abbe's is the SINE, 3.3% apart at
    // NA 0.25. That fork reaches the picture here: the frequency axis is built on
    // n·tan u, so the engine's cutoff period is 1/√(1 − NA²) SHORT of the sine
    // condition's — the engine claims very slightly finer resolution than Abbe
    // allows. On this f/100 fixture that is 1.2e−5, thirteen nanometres out of
    // 78 micrometres, which no 32-pixel grid can show and which is why the
    // render's zero lands on 12 cycles under either reading. The size of it is
    // pinned so that a higher-NA fixture inherits a number and not a surprise.
    const sinU = tanU / Math.hypot(1, tanU);
    const abbeSine = brightfieldResolutionMm(LINE_D, sinU, S * sinU);
    expect(abbeSine / abbeTangent).toBeCloseTo(Math.hypot(1, tanU), 15);
    expect(abbeSine / abbeTangent).toBeCloseTo(1 / Math.sqrt(1 - sinU * sinU), 12);
    expect(abbeSine / abbeTangent - 1).toBeCloseTo(1.2499921875e-5, 12);
    // A cycle count is an integer, and the two readings put the cutoff 1.5e−4 of
    // one cycle apart — so they cannot disagree about which bin is the last.
    expect(Math.abs(objectExtentOf(frame) / abbeSine - 12)).toBeLessThan(1e-3);
  });
});

describe("§ 6al.6 — the sensor moves and the picture does not rescale", () => {
  it("the telecentric ruler is BITWISE invariant under defocus; the ordinary one is not", () => {
    // The textbook reason for image-space telecentricity, on the axis § 6ak.5 did
    // not walk: it pinned that the ruler does not drift across the FIELD, and
    // this is the sensor's own position. The chief rays leave parallel to the
    // axis, so where the sensor sits cannot change how large the picture is —
    // and `pixelScaleMm` reads `tan u′`, a pupil property with no image-plane
    // position in it, so the invariance is exact rather than small.
    const reference = frameOf(TELECENTRIC);
    for (const defocus of [0.1, 0.25, 0.5, 1, 2]) {
      const moved = frameOf(finiteAt(FFD, defocus));
      expect(moved.pixelScaleMm).toBe(reference.pixelScaleMm);
      expect(moved.scale.slopeRadius).toBe(reference.scale.slopeRadius);
      // The magnification is traced rather than read off the slope, so it carries
      // the probe ray's own noise and not a defocus term: 1e−9 over 20× of shift.
      expect(Math.abs(moved.magnification / reference.magnification - 1)).toBeLessThan(1e-8);
    }
  });

  it("and the ordinary fixture's magnification is 1 + δ/R, which is the same statement", () => {
    // The control, and it is the closed form rather than "it moves": the chief
    // ray leaves the exit pupil at height h and slope h/R, so δ of sensor shift
    // scales the image by exactly 1 + δ/R. Telecentric is R = ∞ in that formula,
    // which is why the rung above is an equality and not a tolerance.
    const reference = frameOf(ORDINARY);
    const R = reference.scale.referenceRadius;
    expect(R).toBeCloseTo(98.2738331654491, 12);
    for (const defocus of [0.1, 0.25, 0.5, 1]) {
      const moved = frameOf(finiteAt(20, defocus));
      expect(moved.magnification / reference.magnification).toBeCloseTo(1 + defocus / R, 10);
      expect(moved.pixelScaleMm / reference.pixelScaleMm).toBeCloseTo(1 + defocus / R, 10);
    }
  });

  it("so a defocused telecentric render is blurred and NOT resized", () => {
    // Said in pictures, which is the point of this step. Same specimen, same
    // grid, sensor 1 mm out: the contrast at the same eight cycles falls by 29%
    // and the millimetres those cycles occupy are the same to the last bit. A
    // system that rescaled instead would have moved the grating off its bin.
    const sharp = frameOf(TELECENTRIC);
    const defocused = finiteAt(FFD, 1);
    const blurred = frameOf(defocused);
    const sharpImage = renderGrating(TELECENTRIC, sharp, 8);
    const blurredImage = renderGrating(defocused, blurred, 8);

    expect(sharpImage.rendered.pixelScaleMm).toBe(blurredImage.rendered.pixelScaleMm);
    expect(sharpImage.harmonic.contrast).toBeCloseTo(0.01726909396386918, 12);
    expect(blurredImage.harmonic.contrast).toBeCloseTo(0.012188958439591573, 12);
    expect(blurredImage.harmonic.contrast).toBeLessThan(sharpImage.harmonic.contrast);
    // Still an image the engine will certify: 0.076 waves RMS is inside the
    // regime the coherent sum describes, so this is a defocused picture and not
    // a refusal wearing one.
    expect(blurredImage.rendered.fidelity.verdict).toBe("valid");
  });
});

describe("§ 6al.7 — image-space telecentric is not object-space telecentric", () => {
  it("the illumination cone walks off centre by h/r_ep, on the telecentric fixture", () => {
    // The negative the name invites. This system's exit pupil is at infinity and
    // its ENTRANCE pupil is the stop, 400 mm ahead of the specimen — so the § 6x
    // displacement is fully alive here, and `renderBrightfield` translates the
    // condenser by it at every field point off the axis. Exactly h/r_ep, which is
    // the closed form § 6x derives, on a fixture built to be telecentric.
    const frame = frameOf(TELECENTRIC);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);
    expect(centre.radialIlluminationOffset).toBe(0);

    const off = fieldPupilAt(TELECENTRIC, frame, 0.75, 0.5);
    expect(off.objectHeightMm).toBeCloseTo(0.23502489001161359, 12);
    expect(off.radialIlluminationOffset).toBeCloseTo(off.objectHeightMm / STOP_R, 12);
    expect(off.radialIlluminationOffset).toBeCloseTo(0.11751244500580679, 12);
  });

  it("so the frame is not isoplanatic, and the patch decomposition earns its keep", () => {
    // The consequence in the picture, which is the only place it is visible: one
    // patch images the whole frame through the axial pupil under a centred cone,
    // four patches give each quadrant its own pupil and its own translated cone,
    // and they differ by 5%. Not a convergence claim — § 6h.5 owns that — but the
    // statement that a telecentric image plane buys nothing on the object side.
    const frame = frameOf(TELECENTRIC);
    const one = renderGrating(TELECENTRIC, frame, 4, { map: "traced", patches: 1 });
    const four = renderGrating(TELECENTRIC, frame, 4, { map: "traced", patches: 2 });
    expect(one.harmonic.contrast).toBeCloseTo(0.03972344923993551, 12);
    expect(four.harmonic.contrast).toBeCloseTo(0.03771756163402071, 12);
    expect(one.harmonic.contrast / four.harmonic.contrast - 1).toBeCloseTo(0.0531, 3);
    expect(four.rendered.fidelity.verdict).toBe("valid");
  });
});


describe("§ 6al.8 — the picture carries a frequency a linear imager could not put there", () => {
  it("the rendered second harmonic is the order-pair beat, to f64 accumulation", () => {
    // The one claim in this file that is about the image being NONLINEAR in the
    // object, which is the property that makes brightfield the one branch with no
    // fallback at all (ARCHITECTURE.md). `gratingImage.secondHarmonic` is the
    // beat between the +1 and −1 orders — a product of pupil samples 2ν apart —
    // and it has no counterpart in any transfer function.
    //
    // Ratios, not amplitudes: the two computations normalize their intensity
    // differently and § 6al.3 dodged that by comparing contrast. Here the second
    // harmonic is read against the fundamental of the same picture.
    const frame = frameOf(TELECENTRIC);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);
    const expected = [0.004995809761011927, 0.004965595376895924, 0.003440521300677634];
    [2, 4, 6].forEach((cycles, i) => {
      const { rendered, harmonic } = renderGrating(TELECENTRIC, frame, cycles);
      const second = imageHarmonic(rendered.intensity, frame.size, 2 * cycles, 0);
      const closed = gratingImage(centre.pupil, SOURCE, nuOf(cycles), MOD);
      const measured = second.amplitude / harmonic.amplitude;
      expect(measured).toBeCloseTo(expected[i]!, 12);
      expect(Math.abs(measured / (closed.secondHarmonic / closed.fundamental) - 1)).toBeLessThan(
        1e-10,
      );
    });
  });

  it("and it is ALIVE at a frequency whose linear transfer is exactly zero", () => {
    // The demonstration, and it is the same image bin read two ways on one system
    // and one grid. § 6al.5 renders a 12-cycle grating and gets f64 zero at bin
    // 12, because ν = 1.5 is (1 + S) and the aperture carries nothing there.
    // Render a SIX-cycle grating instead and bin 12 comes back at 1.0e−4 of
    // contrast — the picture has a periodicity at a frequency the objective
    // cannot transmit, put there by the image being |Σ orders|² and not a
    // filtered copy of the object's intensity.
    //
    // A linear-in-intensity imager could not: the object's own |t|² does carry
    // m²/2 at 2ν, and multiplying it by a transfer that is exactly 0 there gives
    // exactly 0.
    const frame = frameOf(TELECENTRIC);
    expect(weakObjectTransferDisk(S, 2 * nuOf(6))).toBe(0);
    expect(weakObjectTransferDisk(S, 2 * nuOf(7))).toBe(0);

    const six = renderGrating(TELECENTRIC, frame, 6);
    const seven = renderGrating(TELECENTRIC, frame, 7);
    expect(imageHarmonic(six.rendered.intensity, frame.size, 12, 0).contrast).toBeCloseTo(
      1.0350664975467584e-4,
      12,
    );
    expect(imageHarmonic(seven.rendered.intensity, frame.size, 14, 0).contrast).toBeCloseTo(
      4.159726761923105e-5,
      12,
    );
    // Eleven orders above the same bin's reading when the OBJECT is what puts a
    // frequency there — § 6al.5's 12-cycle render, whose contrast is 7e−16.
    expect(renderGrating(TELECENTRIC, frame, 12).harmonic.contrast).toBeLessThan(1e-14);
  });

  it("and it dies past ν = 1, which is § 6ab.12's h·ν < 2 seen in a render", () => {
    // The second harmonic's own cutoff, and it is NOT (1 + S): two orders 2ν
    // apart cannot both sit inside a pupil of radius 1 once 2ν reaches the
    // diameter, whatever the condenser does. So ν = 1 caps it, and § 6ab.12
    // pins that from the aperture geometry. Here it is the picture: at ν = 1.125
    // the bin is 3e−16, and the closed form is exactly 0.
    const frame = frameOf(TELECENTRIC);
    const nine = renderGrating(TELECENTRIC, frame, 9);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);
    expect(gratingImage(centre.pupil, SOURCE, nuOf(9), MOD).secondHarmonic).toBe(0);
    expect(imageHarmonic(nine.rendered.intensity, frame.size, 18, 0).amplitude).toBeLessThan(1e-15);
  });

  it("and the sweep stops below 8 cycles because bin 16 is Nyquist, where the reading is 2× high", () => {
    // NOT a physics limit and NOT a tolerance — a defect in the MEASUREMENT, and
    // it is exactly a factor of two. `imageHarmonic` doubles a bin's modulus
    // because "a real image splits its energy between the ±k bins", which is true
    // of every bin except k = 0 and k = N/2: the Nyquist bin is its own conjugate
    // and there is no partner to add. At 8 cycles the second harmonic lands on
    // bin 16 of a 32 grid, and the render and the closed form — which agree to
    // 1e−10 at every other frequency in this file — differ by 2.0000000000 there.
    //
    // Recorded rather than worked around, because `app/brightfield.ts` and
    // `app/phase.ts` both compute a harmonic bin as h·cycles and can reach N/2.
    const frame = frameOf(TELECENTRIC);
    const centre = fieldPupilAt(TELECENTRIC, frame, 0.5, 0.5);
    const { rendered, harmonic } = renderGrating(TELECENTRIC, frame, 8);
    const nyquist = imageHarmonic(rendered.intensity, frame.size, 16, 0);
    const closed = gratingImage(centre.pupil, SOURCE, nuOf(8), MOD);
    const ratio =
      nyquist.amplitude / harmonic.amplitude / (closed.secondHarmonic / closed.fundamental);
    expect(ratio).toBeCloseTo(2, 10);
  });
});
