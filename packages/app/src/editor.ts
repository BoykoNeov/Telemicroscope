import {
  AIR,
  CAF2,
  D263,
  F2,
  FUSED_SILICA,
  IMMERSION_OIL,
  LINE_C,
  LINE_D,
  LINE_F,
  N_BK7,
  VITREOUS,
  WATER,
} from "@telemicroscope/core/materials";
import {
  bestSpotZ,
  exitBundle,
  paraxialImageOffset,
  seidelSums,
  spotAt,
  type Spot,
} from "@telemicroscope/core/analysis";
import { imagePlaneZ, marginalRay, pupilGrid, pupils } from "@telemicroscope/core/pupil";
import {
  asCompiled,
  systemProperties,
  traceRay,
  type ApertureSpec,
  type ConjugateSpec,
  type OpticalSystem,
  type Prescription,
  type SurfaceSpec,
} from "@telemicroscope/core/trace";
import {
  apochromaticObjective,
  cassegrain,
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  refractorPair,
} from "@telemicroscope/core/designs";
import { AppRefusal, refusalOf, type Refusal } from "./refusal";

/**
 * The bench editor's adapter — ROADMAP's v1 line "bench editor over the
 * prescription schema; exact + paraxial tracing; glass catalog", and the last
 * thing step 5 still had open that is not an engine step.
 *
 * `render.ts`'s commitment again: numbers in, numbers out, no DOM and no React.
 * And **no new engine capability** — every function called here has been in
 * `trace/`, `pupil/` and `analysis/` since steps 1–2. What did not exist was a
 * way to reach `Prescription` itself. D8's builder edits the *parameters a
 * design is solved from*; this edits the surface list a design solves **to**,
 * which is the layer under every panel in this app.
 *
 * ## Why an editor is authoring data and not a second schema
 *
 * `SurfaceSpec` stores **curvature** (1/mm) because that is what the sag formula
 * and the paraxial recursion consume; every optician and every catalogue quotes
 * **R**. The conversion happens exactly twice — `toPrescription` on the way down,
 * `fromPrescription` on the way up — and nowhere else, so the row a reader edits
 * is the number they typed rather than 1/(1/R) with a float's opinion added.
 * A plane is R = ±∞ and R = 0 is refused in the app's own voice, because c = ∞
 * is not a surface the engine has an error for: it produces NaN geometry and a
 * silent all-rays-lost, which is the one failure this panel must not have.
 *
 * ## What this increment does NOT edit, stated rather than implied
 *
 * `SurfaceSpec` also carries `tiltXDeg`/`tiltYDeg`, `decenterX`/`decenterY` and
 * `reflectance`, and `Prescription` carries `mirrorFrames`. **This form is
 * unfolded and axial**, and says so on screen. That is not timidity about extra
 * columns: a folded chain's thicknesses run along the beam while an unfolded
 * chain's alternate sign at every mirror, and a table that lets a reader flip
 * `mirrorFrames` under a surface list authored in the other convention silently
 * re-reads every number in it. Part B already owns tilt/decenter as
 * *perturbations* of a built design, which is the meaning that has rungs behind
 * it (§ 4a, § 5t). Authoring them from scratch needs the module layer
 * ARCHITECTURE.md § Data model schedules, not four more columns here.
 *
 * ## The seeds, and the check they hand over for free
 *
 * A blank surface list says nothing, so the form opens on a design the engine
 * built. Each seed is round-tripped through `fromPrescription`, so loading one
 * and editing nothing must reproduce the design's own numbers — `editor.test.ts`
 * pins exactly that, and it is a real check of the conversions rather than a
 * restatement of them.
 *
 * What that check turned out to be pinning is **R and not c**, and the fifth
 * seed is what found it: `1/(1/c)` returns c for 88% of curvatures and not for
 * the other 12%, so "the conversion happens once in each direction" above is a
 * statement about the number a reader TYPED — a radius, which survives the trip
 * exactly and always — and not about the curvature it was derived from, which
 * comes back within one ulp. The four seeds this file opened with carried ten
 * non-trivial curvatures between them and all ten survived, which had a 27.5%
 * chance of happening; § 6ar's triplet has four and one does not. The cost is
 * one ulp of EFL (7.1e−15 mm on 53), and `editor.test.ts` now pins the
 * invariant that is true rather than the one that was lucky.
 */

/** The d line is the design wavelength; F and C are what make the glass visible. */
export const LINES = [
  { nm: LINE_F, label: "F 486.1", weight: 0.5 },
  { nm: LINE_D, label: "d 587.6", weight: 1 },
  { nm: LINE_C, label: "C 656.3", weight: 0.5 },
] as const;

/**
 * The catalog, by name, read off the media themselves.
 *
 * `materials/catalog.ts` keeps a private registry and exports every member as a
 * constant; the names come from `m.name` rather than from a hand-typed list, so
 * this cannot drift from what `getMedium` will accept. (An exported enumeration
 * belongs in core the day a second caller wants one — this app has no business
 * being the first to put a function there.)
 */
const MEDIA = [AIR, N_BK7, F2, CAF2, FUSED_SILICA, WATER, IMMERSION_OIL, D263, VITREOUS];

export const CATALOG_MEDIA: readonly string[] = MEDIA.map((m) => m.name);

/** The same list as a lookup — `objectSinU` needs an index, not a name. */
const MEDIA_BY_NAME = new Map(MEDIA.map((m) => [m.name, m]));

/**
 * One editable row.
 *
 * Deliberately NOT a `SurfaceSpec`: it holds R where the engine holds c, and it
 * holds a medium string even on a mirror (which the engine ignores) so that
 * flipping a surface from mirror to lens does not lose the glass that was typed
 * under it — the same reason D8's `BuildSpec` is flat rather than a union.
 */
export interface BenchSurface {
  readonly kind: "refract" | "reflect";
  /** Vertex radius of curvature (mm). ±Infinity = plane. */
  readonly radiusMm: number;
  /** Conic constant. 0 sphere, −1 paraboloid, < −1 hyperboloid. */
  readonly conic: number;
  /** Clear semi-aperture (mm). Infinity = unbounded. */
  readonly semiApertureMm: number;
  /** Signed axial distance to the next vertex (mm) — negative after a mirror. */
  readonly thicknessMm: number;
  /** Medium AFTER the surface. Ignored by the engine on a mirror. */
  readonly medium: string;
  readonly isStop: boolean;
}

/** The whole editable state: a surface list plus what makes it well-posed. */
export interface BenchDraft {
  readonly objectMedium: string;
  readonly surfaces: readonly BenchSurface[];
  readonly aperture: ApertureSpec;
  readonly conjugate: ConjugateSpec;
  /**
   * The off-axis point to evaluate: a field ANGLE in degrees at an infinite
   * conjugate, an object HEIGHT in mm at a finite one. One control, because the
   * schema's `FieldSpec` is one choice and the conjugate decides which spelling
   * is meaningful.
   */
  readonly fieldValue: number;
  /** Rays across a pupil diameter for the exact trace. */
  readonly pupilRays: number;
}

const curvatureOf = (radiusMm: number): number => (Number.isFinite(radiusMm) ? 1 / radiusMm : 0);

/** ±∞ for a plane, and the engine's own c = 0 comes back as +∞ rather than −∞. */
const radiusOf = (curvature: number): number => (curvature === 0 ? Infinity : 1 / curvature);

export function toPrescription(draft: BenchDraft): Prescription {
  if (draft.surfaces.length === 0) {
    throw new AppRefusal("a system needs at least one surface — add a row before tracing.");
  }
  const surfaces = draft.surfaces.map((s, i): SurfaceSpec => {
    if (s.radiusMm === 0) {
      throw new AppRefusal(
        `surface ${i}: R = 0 is not a surface. A plane is R = ∞, and c = 1/R = ∞ is a ` +
          `geometry the engine has no error for — it would trace to NaN and lose every ray.`,
      );
    }
    return {
      kind: s.kind,
      curvature: curvatureOf(s.radiusMm),
      ...(s.conic === 0 ? {} : { conic: s.conic }),
      semiAperture: s.semiApertureMm,
      thickness: s.thicknessMm,
      ...(s.kind === "refract" ? { medium: s.medium } : {}),
      ...(s.isStop ? { isStop: true } : {}),
    };
  });
  return { objectMedium: draft.objectMedium, surfaces };
}

export function toSystem(draft: BenchDraft): OpticalSystem {
  return {
    prescription: toPrescription(draft),
    aperture: draft.aperture,
    field:
      draft.conjugate.kind === "infinite"
        ? { kind: "angle", values: [0, draft.fieldValue] }
        : { kind: "objectHeight", values: [0, draft.fieldValue] },
    wavelengths: LINES.map((l) => ({ nm: l.nm, weight: l.weight })),
    conjugate: draft.conjugate,
  };
}

/** A prescription as rows — the seed direction, and the only other conversion. */
export function fromPrescription(
  prescription: Prescription,
  envelope: Omit<BenchDraft, "objectMedium" | "surfaces">,
): BenchDraft {
  return {
    ...envelope,
    objectMedium: prescription.objectMedium ?? "AIR",
    surfaces: prescription.surfaces.map(
      (s): BenchSurface => ({
        kind: s.kind,
        radiusMm: radiusOf(s.curvature),
        conic: s.conic ?? 0,
        semiApertureMm: s.semiAperture,
        thicknessMm: s.thickness,
        medium: s.medium ?? "AIR",
        isStop: s.isStop === true,
      }),
    ),
  };
}

export type BenchStage = "build" | "paraxial" | "pupil" | "trace" | "seidel" | "order";

/**
 * A section is its numbers or its own refusal.
 *
 * Not one all-or-nothing result, because the sections genuinely fail
 * independently and each failure is informative: an afocal chain has no EFL and
 * still has a spot, a stop that no cone reaches kills the pupil section while
 * the paraxial one is unaffected. Collapsing them would throw away which half of
 * the readout the edit broke — and a refusal in this app is a finding, not an
 * error page.
 */
export type Section<T> = ({ readonly ok: true } & T) | Refusal<BenchStage>;

const section = <T>(stage: BenchStage, compute: () => T): Section<T> => {
  try {
    return { ok: true, ...compute() };
  } catch (cause) {
    return refusalOf(cause, stage);
  }
};

export interface LineProperties {
  readonly nm: number;
  readonly label: string;
  /** Effective focal length (mm). */
  readonly eflMm: number;
  /** Last vertex → paraxial focus (mm, signed). */
  readonly bfdMm: number;
}

export interface ParaxialReadout {
  readonly lines: readonly LineProperties[];
  /** EFL(F) − EFL(C): zero for a mirror, the whole point of an achromat. */
  readonly eflSpreadMm: number;
  /** BFD(F) − BFD(C): the axial colour a focus solve cannot remove. */
  readonly focalShiftMm: number;
  /**
   * max BFD − min BFD over the three lines, which is the focus range a sensor
   * actually has to straddle — and NOT `focalShiftMm`, on exactly the designs
   * `focalShiftMm` was invented for. A doublet unites F and C *because that is
   * what it corrects*, so their difference is the one number guaranteed to be
   * small; the d line is then the outlier, and the range exceeds it by **4.7×**
   * on the f = 500 achromat and by **24×** on the DIN objective. Where the
   * colour is monotonic in λ — the singlet, and the apochromat seed — the two
   * are the same number to the bit, so this costs nothing to read.
   *
   * **Read the ratio, though, and it is the DENOMINATOR that moves.** Divided by
   * each lens's own EFL the two doublets leave 5.30e−4 and 5.11e−4 — the same
   * relative focus range to 4%, a 500 mm telescope objective and a 37.7 mm
   * microscope one. What differs by 5× is how tightly each put F and C
   * together, which is the ratio's bottom. So 4.7 and 24 are two *correction
   * qualities* and one leftover, not two magnitudes of the same defect, and the
   * number worth comparing across lenses is range ÷ EFL.
   *
   * **What they agree on is the GLASS.** Both are N-BK7/F2 cemented in opposite
   * order, and a thin achromatized doublet's relative secondary spectrum is that
   * pair's own (P₁ − P₂)/(V₁ − V₂) = 4.993e−4 — four catalogue constants and no
   * tracing. The measured pair sit 6.0% and 2.3% above it, the formula being
   * thin and these lenses not. Quoting the two seeds against *each other* would
   * have made a claim about the code for a number that belongs to the glasses.
   * Against the closed form the apochromat's 3.38e−4 is **32% lower** (36% below
   * the achromat seed as built), which is what nulling the third colour is
   * worth — real, and not an order of magnitude, because what it removes is the
   * secondary spectrum and what is left is the principal planes walking. (The
   * singlet, for scale, is 1.55e−2 — 29× either doublet, and 1/V.)
   */
  readonly focusRangeMm: number;
  /**
   * Where the paraxial image lands for the *conjugate actually set* (mm from the
   * last vertex), which equals the BFD only at an infinite one.
   */
  readonly imageOffsetMm: number;
  /** What the prescription's own last thickness says instead. */
  readonly authoredOffsetMm: number;
}

export interface PupilReadout {
  readonly stopIndex: number;
  readonly stopRadiusMm: number;
  readonly stopZMm: number;
  readonly entranceZMm: number;
  readonly entranceRadiusMm: number;
  /**
   * `tan u` — what the entrance pupil has INSTEAD of a radius when it is at
   * infinity, defined exactly when `entranceRadiusMm` is not finite (§ 6u's
   * invariant, arriving at the panel).
   *
   * Present because "r = Infinity mm at z = -Infinity" is a true sentence that
   * throws away the answer: a diaphragm on the front group's back focal plane
   * is a perfectly ordinary design, and its aperture is an ANGLE. § 5s.5 is the
   * rung — and the reason it is not enough to print the ∞ honestly is what
   * happens a wavelength away, where the same pupil comes back finite and
   * enormous (64 338.9 mm on the shipped 4× objective at 550 nm) and reads as a
   * plausible number instead.
   */
  readonly entranceSlope?: number;
  readonly exitZMm: number;
  readonly exitRadiusMm: number;
  /**
   * `tan u′` — the same quantity on the exit pupil, and the half of the
   * invariant this panel was deliberately missing one step ago.
   *
   * The exit `Fact` used to carry a note saying the engine had no image-space
   * slope to fall back on. It has one now (§ 6aj), so the panel prints the
   * angle where the semi-diameter does not exist, exactly as the entrance side
   * does. The note it replaces is NOT retired wholesale: the reachable defect on
   * this side was never the ∞ but the plausible number beside it —
   * 2 659 670.894 mm at z = 26 952 190.75, three rows from the shipped form —
   * and a slope does nothing about that, so the large-radius warning stays and
   * says what it is warning about.
   */
  readonly exitSlope?: number;
}

export interface FieldReadout {
  readonly fieldValue: number;
  /** RMS spot radius on the prescription's own image plane (mm). */
  readonly rmsRadiusMm: number;
  readonly geoRadiusMm: number;
  /** Rays that did not make it out — this IS the vignetting. */
  readonly lost: number;
  readonly traced: number;
  /** Best-focus plane, as an offset from the last vertex (mm). */
  readonly bestFocusOffsetMm: number;
  /** RMS there, which is what the design is capable of at this field. */
  readonly bestRmsRadiusMm: number;
}

export interface ExactReadout {
  readonly fields: readonly FieldReadout[];
  readonly imagePlaneZMm: number;
  readonly lastVertexZMm: number;
  readonly vertexZsMm: readonly number[];
  readonly rayCount: number;
}

export interface SeidelReadout {
  /** ΣS_I (mm) — third-order spherical, on the marginal ray the pupil resolved. */
  readonly s1Mm: number;
  /** W₀₄₀ = S_I/8 (mm), and the same in waves at the d line. */
  readonly w040Mm: number;
  readonly w040Waves: number;
  readonly marginalHeightMm: number;
}

export interface OrderStep {
  readonly stopFraction: number;
  readonly stopRadiusMm: number;
  /** On-axis RMS at that aperture's own best focus (mm). */
  readonly rmsRadiusMm: number;
}

/**
 * Which aberration order survives, read off the aperture instead of assumed.
 *
 * Close the stop by half and the on-axis residual falls by 2^p, where p is the
 * order of the lowest term that has not been corrected: 3 for uncorrected
 * spherical, 5 when the third has been nulled. The exponent is therefore a
 * *measurement of the design's correction state* that needs no Seidel formula —
 * and the two routes are independent, which is what makes them worth showing
 * together. `seidelSums` refuses conics outright; this works on anything that
 * traces.
 */
export interface OrderReadout {
  readonly steps: readonly OrderStep[];
  /** log₂ of the ratio between successive steps — one per gap. */
  readonly slopes: readonly number[];
  /** The narrowest gap's slope: the order that is still there at the end. */
  readonly order: number;
  /**
   * True when the full-aperture residual is already at float noise (< 1 pm), in
   * which case there is no aberration to take a slope of and the number printed
   * would be the shape of the rounding error. A stigmatic design is the honest
   * reason a slope can be absent.
   */
  readonly noiseFloor: boolean;
}

export interface BenchReadout {
  readonly paraxial: Section<ParaxialReadout>;
  readonly pupil: Section<PupilReadout>;
  readonly exact: Section<ExactReadout>;
  readonly seidel: Section<SeidelReadout>;
  readonly order: Section<OrderReadout>;
  readonly surfaceCount: number;
  readonly elapsedMs: number;
}

export type BenchDescription = ({ readonly ok: true } & BenchReadout) | Refusal<BenchStage>;

/**
 * Trace the draft, both ways.
 *
 * The exact half and the paraxial half are computed from the SAME system and
 * reported side by side without either being converted into the other. That
 * restraint is the panel's content: third order says the wavefront carries
 * W₀₄₀; the trace says best focus sits somewhere the paraxial focus is not. The
 * formula relating them is real and this repo has no rung for it, so the two
 * numbers stay two numbers.
 */
export function describeBench(draft: BenchDraft): BenchDescription {
  const started = performance.now();
  let system: OpticalSystem;
  try {
    system = toSystem(draft);
    // Compile now rather than inside the first section: an unknown medium or a
    // refract surface with none is a refusal about the *system*, and reporting it
    // as "the paraxial section failed" would point at the wrong thing.
    asCompiled(system.prescription);
  } catch (cause) {
    return refusalOf(cause, "build");
  }

  const compiled = asCompiled(system.prescription);
  const lastVertexZMm = compiled.surfaces[compiled.surfaces.length - 1]!.vertexZ;
  // Clamped here too, not only at the control: this is the boundary a worker or
  // a test would come through, and an unbounded loop is not a thing to leave to
  // whoever calls next.
  const points = pupilGrid(clampPupilRays(draft.pupilRays));

  const paraxial = section("paraxial", (): ParaxialReadout => {
    const lines = LINES.map((l): LineProperties => {
      const p = systemProperties(system.prescription, l.nm);
      return { nm: l.nm, label: l.label, eflMm: p.efl, bfdMm: p.bfd };
    });
    const [f, , c] = lines as unknown as [LineProperties, LineProperties, LineProperties];
    const bfds = lines.map((l) => l.bfdMm);
    return {
      lines,
      eflSpreadMm: f.eflMm - c.eflMm,
      focalShiftMm: f.bfdMm - c.bfdMm,
      focusRangeMm: Math.max(...bfds) - Math.min(...bfds),
      imageOffsetMm: paraxialImageOffset(system, LINE_D),
      authoredOffsetMm: system.prescription.surfaces[system.prescription.surfaces.length - 1]!.thickness,
    };
  });

  const pupil = section("pupil", (): PupilReadout => {
    const g = pupils(system, LINE_D);
    return {
      stopIndex: g.stopIndex,
      stopRadiusMm: g.stopRadius,
      stopZMm: g.stopZ,
      entranceZMm: g.entrance.z,
      entranceRadiusMm: g.entrance.radius,
      ...(g.entrance.slopeRadius === undefined ? {} : { entranceSlope: g.entrance.slopeRadius }),
      exitZMm: g.exit.z,
      exitRadiusMm: g.exit.radius,
      ...(g.exit.slopeRadius === undefined ? {} : { exitSlope: g.exit.slopeRadius }),
    };
  });

  const exact = section("trace", (): ExactReadout => {
    const imageZ = imagePlaneZ(compiled, system);
    const fields = [0, draft.fieldValue].map((fieldValue): FieldReadout => {
      const bundle = exitBundle(system, fieldValue, LINE_D, points);
      const here: Spot = spotAt(bundle, imageZ);
      const bestZ = bestSpotZ(bundle);
      const best: Spot = spotAt(bundle, bestZ);
      return {
        fieldValue,
        rmsRadiusMm: here.rmsRadius,
        geoRadiusMm: here.geoRadius,
        lost: bundle.lost,
        traced: bundle.rays.length,
        bestFocusOffsetMm: bestZ - lastVertexZMm,
        bestRmsRadiusMm: best.rmsRadius,
      };
    });
    return {
      fields,
      imagePlaneZMm: imageZ,
      lastVertexZMm,
      vertexZsMm: compiled.surfaces.map((s) => s.vertexZ),
      rayCount: points.length,
    };
  });

  // The marginal height the Seidel sums need is the axial ray's height AT THE
  // FIRST SURFACE, and this section inherits the pupil section's failure rather
  // than inventing a height.
  //
  // It used to read the entrance pupil's radius, which is the same number only
  // when the stop is surface 0 — and § 6ai made that stop being anywhere else
  // the ordinary case. A telecentric objective's entrance pupil is at infinity
  // WITH AN INFINITE RADIUS, so the old reading handed `seidelSums` an Infinity
  // and every aberration coefficient came back NaN, silently, in a section that
  // reported itself as ok. The height is now traced: aim the marginal ray and
  // read where it actually crosses the first surface, which is the same number
  // as before on a front-stopped lens and a finite one on every other.
  const seidel = section("seidel", (): SeidelReadout => {
    if (!pupil.ok) throw new AppRefusal(`no marginal ray height without a pupil: ${pupil.error}`);
    const traced = traceRay(
      system.prescription,
      marginalRay(system, pupils(system, LINE_D), 0, LINE_D),
    );
    const entry = traced.path[0];
    if (entry === undefined) {
      throw new AppRefusal("the marginal ray does not reach the first surface");
    }
    const marginalHeightMm = Math.hypot(entry.x, entry.y);
    if (!(marginalHeightMm > 0) || !Number.isFinite(marginalHeightMm)) {
      throw new AppRefusal(
        `the marginal ray enters the first surface at ${marginalHeightMm} mm, which is not a height`,
      );
    }
    const r = seidelSums(system.prescription, LINE_D, {
      marginalHeightMm,
      ...(draft.conjugate.kind === "finite" ? { objectDistanceMm: draft.conjugate.distance } : {}),
    });
    return {
      s1Mm: r.s1,
      w040Mm: r.w040,
      w040Waves: r.w040 / (LINE_D * 1e-6),
      marginalHeightMm,
    };
  });

  const order = section("order", (): OrderReadout => {
    if (!pupil.ok) throw new AppRefusal(`no aperture to close without a pupil: ${pupil.error}`);
    const full = pupil.stopRadiusMm;
    const steps = ORDER_FRACTIONS.map((stopFraction): OrderStep => {
      const stopRadiusMm = full * stopFraction;
      const narrowed: OpticalSystem = { ...system, aperture: { kind: "stopRadius", value: stopRadiusMm } };
      const bundle = exitBundle(narrowed, 0, LINE_D, points);
      return { stopFraction, stopRadiusMm, rmsRadiusMm: spotAt(bundle, bestSpotZ(bundle)).rmsRadius };
    });
    const slopes = steps
      .slice(1)
      .map((s, i) => Math.log(steps[i]!.rmsRadiusMm / s.rmsRadiusMm) / Math.log(steps[i]!.stopFraction / s.stopFraction));
    return {
      steps,
      slopes,
      order: slopes[slopes.length - 1] ?? NaN,
      noiseFloor: steps[0]!.rmsRadiusMm < ORDER_NOISE_FLOOR_MM,
    };
  });

  return {
    ok: true,
    paraxial,
    pupil,
    exact,
    seidel,
    order,
    surfaceCount: system.prescription.surfaces.length,
    elapsedMs: performance.now() - started,
  };
}

/** Halved three times: enough gaps to see the exponent settle, four bundles of cost. */
const ORDER_FRACTIONS = [1, 0.5, 0.25, 0.125] as const;

/** A picometre. Below this the spot is the tracer's rounding, not the design's. */
const ORDER_NOISE_FLOOR_MM = 1e-9;

/**
 * The seeds — five designs the engine built, as rows.
 *
 * Chosen to span the schema rather than to be pretty: a singlet and its achromat
 * differ only in glass and show the catalog doing the work; the Cassegrain is
 * two mirrors with the negative thickness the unfolded convention requires; the
 * DIN objective is the finite conjugate, where field means a height and the
 * aperture is an object-space NA. Between them every control on the form is
 * exercised by something that is known to trace.
 *
 * The fifth is § 6ar's cemented triplet, and it is here because it is the first
 * thing in this app to offer a `designs/` entry that shipped after the panels
 * did — three glasses, one of them the catalogue's only fluorite, at the exact
 * aperture, focal ratio and object distance the ladder pinned it at. What it
 * added is not a row: it is `focusRangeMm`, above. Put a lens whose EFL is the
 * same number at all three lines next to `eflSpreadMm` and the readout reads
 * zero, which is correct and says nothing; look at the BFDs instead and the
 * colour is all still there, monotonic in λ, because the powers were united and
 * the principal planes were not. Then the same column on the two *corrected
 * doublets* — the f = 500 achromat and the DIN objective — shows F and C sitting
 * together with d well outside them, which `focalShiftMm`, being F − C, cannot
 * report at all. A seed that made one number read zero is what found that the
 * number beside it was understating every corrected lens in the list.
 */
export interface BenchSeed {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly draft: BenchDraft;
}

const REFRACTOR_FOCAL_MM = 500;
const REFRACTOR_SEMI_APERTURE_MM = 25;
const DEFAULT_PUPIL_RAYS = 15;

/**
 * § 6ar's triplet, spelled the way that step's own fixtures spell it.
 *
 * Not this app's guess: 5 mm at f/10.6 with the object 453 mm in front is the
 * spec `telecentric-design.test.ts` and `telecentric-apochromat.test.ts` both
 * build, so the radii the form opens on (18.348, −16.871, −19.012, −670.472)
 * are the ones the ladder pinned. The focal ratio is not free — § 6ar.6 found
 * that the default triple refuses at f/5, the steep branch's surfaces having
 * gone past hemispherical — so a seed that "rounded" it to f/10 would be
 * choosing an aperture the ladder never traced.
 */
const TRIPLET_SPEC = {
  apertureMm: 5,
  focalRatio: 53 / 5,
  media: ["CAF2", "F2", "N-BK7"],
  thicknessesMm: [1.6, 1.2, 1.2],
  objectDistanceMm: 453,
} as const;

export function benchSeeds(): readonly BenchSeed[] {
  const pair = refractorPair(REFRACTOR_FOCAL_MM, REFRACTOR_SEMI_APERTURE_MM);
  const cass = cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 });
  const dinChain = finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  });
  const triplet = apochromaticObjective(TRIPLET_SPEC);

  const infinite: Omit<BenchDraft, "objectMedium" | "surfaces"> = {
    aperture: { kind: "EPD", value: 2 * REFRACTOR_SEMI_APERTURE_MM },
    conjugate: { kind: "infinite" },
    fieldValue: 0.25,
    pupilRays: DEFAULT_PUPIL_RAYS,
  };

  return [
    {
      id: "achromat",
      label: "BK7/F2 achromat, f = 500, f/10",
      note: "§ 1's hero pair — the colours land together because the Abbe numbers say so",
      draft: fromPrescription(pair.achromat, infinite),
    },
    {
      id: "singlet",
      label: "BK7 singlet of the same power",
      note: "the same power in one glass: watch EFL(F) − EFL(C) go from microns to millimetres",
      draft: fromPrescription(pair.singlet, infinite),
    },
    {
      id: "cassegrain",
      label: "classical Cassegrain, 200 mm f/10",
      note: "§ 5e — two mirrors, and the thickness between them is negative because after the first one the light travels −z",
      draft: fromPrescription(cass.prescription, {
        ...infinite,
        aperture: { kind: "EPD", value: 200 },
        fieldValue: 0.1,
      }),
    },
    {
      id: "din",
      label: "DIN 4×/0.10 objective",
      note: "§ 6b — the finite conjugate, where field is a height in mm and the stop is a solved radius",
      // The chain's system rather than the bare objective's prescription: the
      // constructor authors the objective with a trailing thickness of ZERO and
      // lets the chain place the image, so seeding from the objective alone
      // would open the form on a design whose image plane is its own last vertex
      // — a 3.25 mm spot for a lens that is 14 µm at focus. The seed has to be
      // the thing the engine actually images with, or the free check is worth
      // nothing. Its aperture is the design's own `stopRadius`, for the same
      // reason (and see `objectNA` below, which is not the same number).
      draft: fromPrescription(dinChain.system.prescription, {
        aperture: dinChain.system.aperture,
        conjugate: dinChain.system.conjugate,
        fieldValue: 0.05,
        pupilRays: DEFAULT_PUPIL_RAYS,
      }),
    },
    {
      id: "apochromat",
      label: "CaF₂/F2/BK7 apochromat, f = 53, f/10.6",
      note: "§ 6ar — three glasses unite three colours in EFL, so watch the BFDs instead: the colour is still there, and it no longer crosses",
      // The design's own stop radius rather than an EPD: at a finite conjugate
      // "entrance pupil diameter" is a solved quantity, and surface 0 carries
      // `isStop` with a semi-aperture deliberately 0.5% oversize of D/2 — the
      // mechanical edge, not the beam. Seeding from the oversize number would
      // open the form on a slightly faster lens than the one § 6ar traced.
      draft: fromPrescription(triplet.prescription, {
        aperture: { kind: "stopRadius", value: TRIPLET_SPEC.apertureMm / 2 },
        conjugate: { kind: "finite", distance: TRIPLET_SPEC.objectDistanceMm },
        // An object height, because the conjugate is finite. 1 mm is this app's
        // choice and not the ladder's — § 6ar solves the bending on axis and
        // never states a field — so it is picked to be visibly off-axis at a
        // 2.5 mm semi-aperture without being a field this design was corrected
        // for. The off-axis spot is what it is; nothing here claims otherwise.
        fieldValue: 1,
        pupilRays: DEFAULT_PUPIL_RAYS,
      }),
    },
  ];
}

/**
 * `ApertureSpec` offers five spellings of one constraint, and this form is the
 * first thing in the app that lets a reader switch between them on a design
 * authored in one. That is what turned an engine defect into something a panel
 * could reach: `resolveStopRadius`'s two NA branches read NA as a paraxial
 * *slope*, (NA/n)·arm, where the design that authored the number sized its stop
 * with the real `tan u` at `sin u = NA/n` — so the same objective came back
 * 1/√(1 − (NA/n)²) narrower for being asked for in the currency it was designed
 * in. This panel used to print that ratio beside the pupil, because a 0.5% cone
 * going quietly is worse than a caption.
 *
 * **The engine now reads the sine** (§ 1.5.1), so the caption is gone and the
 * five spellings really are one constraint. What is left of the finding is a
 * test — `test/editor.test.ts` pins the two spellings landing on one stop
 * radius, from the surface that made the disagreement visible — and this, the
 * half-angle the panel prints in its place: `sin u` is what an NA *is*, and
 * showing it is how a reader sees that 0.95 in air and 1.4 in oil are the same
 * kind of number and that the engine has an index in hand.
 */
export const objectSinU = (draft: BenchDraft, numericalAperture: number): number => {
  const medium = MEDIA_BY_NAME.get(draft.objectMedium);
  // `toPrescription` refuses an unknown medium rather than asserting, and this
  // renders inside the panel — a throw here is a blank page, not a refusal.
  if (!medium) throw new AppRefusal(`unknown object medium: ${draft.objectMedium}`);
  return numericalAperture / medium.n(LINE_D);
};

/**
 * The draft with its last thickness moved to the paraxial image — the focus
 * solve every design in `designs/` is used with, and that a raw prescription
 * does not carry.
 *
 * A surface list says where the image lands by its own last thickness, and an
 * authored one usually says something round: `refractorPair`'s says 500 mm for a
 * lens whose BFD is 496.58, because it is a *placeholder* its own doc calls one.
 * Pressing this replaces the placeholder with the trace's answer — and the exact
 * best focus is still not there, which is the panel's whole subject.
 *
 * **Total by construction.** A draft that does not build, or that builds and has
 * no focus at all, is an ordinary state of an editor — and this runs inside a
 * React state updater, where a throw is a blank page rather than a refusal. So
 * an unsolvable draft comes back unchanged and the refusal a reader sees is the
 * one `describeBench` already put on screen. The panel disables the button in
 * exactly that case, so "unchanged" is never the only feedback.
 */
export function solveParaxialFocus(draft: BenchDraft): BenchDraft {
  let offset: number;
  try {
    offset = paraxialImageOffset(toSystem(draft), LINE_D);
  } catch {
    return draft;
  }
  const last = draft.surfaces.length - 1;
  return {
    ...draft,
    surfaces: draft.surfaces.map((s, i) => (i === last ? { ...s, thicknessMm: offset } : s)),
  };
}

/**
 * Rays across a pupil diameter, bounded — the one control here that costs
 * quadratically and has nothing in the engine to refuse it.
 *
 * `pupilGrid(n)` loops n², and `NumberField` now accepts ±Infinity because R and
 * the semi-aperture mean it. Handed Infinity this field does not throw, refuse,
 * or return: it hangs the tab, which is the one failure mode that cannot be
 * reported on screen. 101 across a diameter is 7 845 rays, already ~50× the
 * default and far past where a spot RMS stops moving.
 */
export const PUPIL_RAYS_MAX = 101;

export const clampPupilRays = (rays: number): number =>
  Number.isFinite(rays) ? Math.min(PUPIL_RAYS_MAX, Math.max(3, Math.round(rays))) : DEFAULT_PUPIL_RAYS;

/** What a fresh form opens on. */
export const DEFAULT_DRAFT: BenchDraft = benchSeeds()[0]!.draft;

/** A row to append: a plane in air, which changes nothing until it is edited. */
export const BLANK_SURFACE: BenchSurface = {
  kind: "refract",
  radiusMm: Infinity,
  conic: 0,
  semiApertureMm: 25,
  thicknessMm: 0,
  medium: "AIR",
  isStop: false,
};
