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
import { imagePlaneZ, pupilGrid, pupils } from "@telemicroscope/core/pupil";
import {
  asCompiled,
  systemProperties,
  type ApertureSpec,
  type ConjugateSpec,
  type OpticalSystem,
  type Prescription,
  type SurfaceSpec,
} from "@telemicroscope/core/trace";
import {
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
 * ## The three seeds, and the check they hand over for free
 *
 * A blank surface list says nothing, so the form opens on a design the engine
 * built. Each seed is round-tripped through `fromPrescription`, so loading one
 * and editing nothing must reproduce the design's own numbers — `editor.test.ts`
 * pins exactly that, and it is a real check of the conversions rather than a
 * restatement of them.
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
export const CATALOG_MEDIA: readonly string[] = [
  AIR,
  N_BK7,
  F2,
  CAF2,
  FUSED_SILICA,
  WATER,
  IMMERSION_OIL,
  D263,
  VITREOUS,
].map((m) => m.name);

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
  readonly exitZMm: number;
  readonly exitRadiusMm: number;
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
    return {
      lines,
      eflSpreadMm: f.eflMm - c.eflMm,
      focalShiftMm: f.bfdMm - c.bfdMm,
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
      exitZMm: g.exit.z,
      exitRadiusMm: g.exit.radius,
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

  // The marginal height the Seidel sums need is the entrance pupil's, so this
  // section inherits the pupil section's failure rather than inventing a height.
  const seidel = section("seidel", (): SeidelReadout => {
    if (!pupil.ok) throw new AppRefusal(`no marginal ray height without a pupil: ${pupil.error}`);
    const marginalHeightMm = pupil.entranceRadiusMm;
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
 * The seeds — four designs the engine built, as rows.
 *
 * Chosen to span the schema rather than to be pretty: a singlet and its achromat
 * differ only in glass and show the catalog doing the work; the Cassegrain is
 * two mirrors with the negative thickness the unfolded convention requires; the
 * DIN objective is the finite conjugate, where field means a height and the
 * aperture is an object-space NA. Between them every control on the form is
 * exercised by something that is known to trace.
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

export function benchSeeds(): readonly BenchSeed[] {
  const pair = refractorPair(REFRACTOR_FOCAL_MM, REFRACTOR_SEMI_APERTURE_MM);
  const cass = cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 });
  const dinChain = finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  });

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
  ];
}

/**
 * The same NA, spelled two ways, is two different apertures — and the ratio is
 * exact.
 *
 * `ApertureSpec` offers five spellings of one constraint, and a form is the
 * first thing in this app that lets a reader switch between them on a design
 * that was authored in one. `resolveStopRadius`'s `objectNA` branch takes NA as
 * a paraxial *slope* — (NA/n)·(object → entrance pupil) — while
 * `finiteConjugateObjective` sizes its stop with the real `tan u` at
 * `sin u = NA/n`. So the two disagree by exactly
 *
 *     tan(asin(NA/n)) / (NA/n) = 1 / √(1 − (NA/n)²)
 *
 * 0.50% at NA 0.10, 15.5% at NA 0.50, 3.2× at NA 0.95. Nothing landed moves:
 * every design in `designs/` hands its chain a `stopRadius`, so this is only
 * reachable by re-spelling one, which is what this panel is for. It is a
 * paraxial-versus-exact reading of the *aperture*, in a schema whose whole point
 * is that the five spellings are one constraint — so the panel says which
 * spelling a number is in rather than letting a 0.5% cone go quietly.
 */
export const naSpellingRatio = (numericalAperture: number, objectIndex = 1): number =>
  1 / Math.sqrt(1 - (numericalAperture / objectIndex) ** 2);

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
