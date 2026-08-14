import {
  solveParaxial,
  solveScalar,
  withVariable,
  type ParaxialTarget,
  type ScalarSolveResult,
  type SolveVariable,
} from "@telemicroscope/core/analysis";
import { systemProperties, type Prescription } from "@telemicroscope/core/trace";
import { getMedium, LINE_C, LINE_D, LINE_F } from "@telemicroscope/core/materials";
import { cassegrain, refractorPair } from "@telemicroscope/core/designs";
import { AppRefusal, refusalOf, type Refusal } from "./refusal";

/**
 * Design mode's first half on a screen — "what does this number have to be?" —
 * drawing `core/analysis/solve` (VALIDATION § 1.7), which had **no caller
 * anywhere in `packages/app`** until this file.
 *
 * Every other panel in this app is a *readout*: it takes a lens and says what
 * the lens does. This one runs the other way. You state a first-order property
 * you want, name one number the design is allowed to move, and the engine
 * returns the value that number has to take — which is the smallest complete
 * piece of design mode, and the half ROADMAP's v2+ entry had landed in the
 * engine with nothing to surface it.
 *
 * ## The panel is a form over one refusal the module makes on purpose
 *
 * `solveScalar` will not go looking for a root on its own: the caller states the
 * interval, because only the caller knows which values of a curvature are a lens
 * rather than an arithmetic possibility. So every seed here **states its
 * interval**, and every one of them is this panel's guess rather than a physical
 * fact — the two fixtures borrowed from § 1.7 carry that step's own intervals so
 * the numbers on screen are the numbers the ladder pinned, and the three lenses
 * this app ships carry an interval built by the rule in `spread` below, which is
 * a convenience and says so on screen.
 *
 * ## What driving it measured, in the order the panel says it
 *
 * **1. Every focal-length solve reachable from here lands on the last bit, and
 * the exactness is in the POWER rather than in the millimetres.** § 1.7 states
 * the mechanism — the paraxial system matrix is a product of [[1,0],[−φ,1]] and
 * [[1,t],[0,1]] factors, so it is affine in any one curvature or any one
 * thickness, and so is the power — and pins `residual === 0` on its own thick
 * lens. On this app's doublet the *millimetre* residual is 0 at some targets and
 * 5.7e-14 mm at others, which looks like a converged solve and is not: the power
 * residual is 0 or 4.3e-19 /mm, one ulp, and |Δf| = f²·|ΔP| turns that ulp into
 * 5.7e-14 mm at 400 mm and 2.3e-13 at 1000 mm. The number that moves is the unit,
 * not the answer. The panel prints both residuals for that reason.
 *
 * **2. The affineness is visible as WORK, which is a second witness for it.** A
 * 64-cell scan costs 65 evaluations whatever is being solved. An EFL target then
 * costs **2 more** — one Brent interpolation, which lands on the root of a
 * straight line exactly, plus the candidate check. A BFD target on the same
 * variable costs up to **55 more**, because BFD is a ratio of two affine
 * functions and Brent has to iterate. Nothing in the result says "this was
 * exact"; the evaluation count says it.
 *
 * **3. Through this door there is always exactly one root — and that is why the
 * coupled seed exists.** `roots` carries every solution in the interval so a
 * caller can see that a target was reachable two ways. But the power is affine in
 * a single prescription number and BFD is a Möbius function of it, so both have
 * exactly one root: measured over all **28** combinations of surface, variable
 * and target on the app's own three lenses, of which **17** reach an answer and
 * every one returns `roots` of length 1. The other eleven refuse because the
 * target is outside that variable's range — a cemented doublet's focal length
 * barely moves with a thickness, and a last thickness moves neither first-order
 * property at all — never because two roots hid each other. Multiplicity needs
 * two numbers moving together, which
 * `SolveVariable` deliberately cannot express — hence the equiconvex seed, where
 * c₂ = −c₁ is supplied as a closure and the power becomes a parabola.
 *
 * **4. Of the two lenses that deliver one focal length, one has its focus inside
 * itself — exactly.** On the equiconvex family the two roots' back focal
 * distances are +7.458932121 and −7.458932121 mm at f = 2·f_min, and they sum to
 * zero at every reachable target (measured 0, ±1e-15, −2e-14 at four of them).
 * That is not a coincidence and it is not a rung: BFD = f(1 − (d/n)(n−1)c), the
 * two roots are symmetric about the parabola's vertex c* = n/(d(n−1)), and
 * (d/n)(n−1)·2c* = 2 exactly, so the two back focal distances cancel. "Reachable
 * two ways" is therefore a real design statement rather than a curiosity: one of
 * the two is a lens you can put a sensor behind and the other is not.
 *
 * **5. A single-variable solve hits its target and spends the correction the lens
 * existed for.** Retargeting the shipped f = 500 achromat through its crown
 * curvature takes the F-to-C focal spread from −0.0439 mm to −1.277 mm at 400 mm
 * (29× worse) and to +1.826 mm at 600 mm (42× and the other sign); through the
 * flint's inner curvature it is 158× and 240×. The same moves on the singlet of
 * the same pair change its spread by 0.8× and 1.2×, because a singlet has no
 * balance to lose — its colour is the glass and the focal length, and one
 * curvature cannot make it worse. **The corrected lens is the fragile one**, and
 * that is the argument for the damped-least-squares half of design mode, which
 * moves several numbers at once and is blocked on a pin rather than on code.
 *
 * **6. "Where does this system go afocal?" is a question the solver refuses,
 * every time, and the refusal is the answer.** § 1.7 records the wall convention
 * — an `evaluate` that throws marks a region as "not a system" rather than being
 * allowed to manufacture a sign change — and says it had to be pinned on
 * synthetic closures because `systemProperties` only throws at |u| < 1e-15, which
 * a 64-cell scan meets with probability zero. A scan does. **A bisection aimed at
 * the afocal point meets it with probability one**, because the wall is the root
 * it is converging to, and the two widths say so: the engine throws at
 * |u| < 1e-15 and u is −1/f, so the hole is exactly where |1/f| < 1e-15, and this
 * fixture's power moves 3.565e-4 per mm of gap — which makes the hole
 * **5.615e-12 mm** wide (measured edge to edge: the last gap that is a system is
 * 9.015987757053926 and the first one above is 9.015987757059541). Brent's
 * convergence width there is 8·eps·120 = 2.13e-13 mm, **26× narrower**, so the
 * final bracket fits inside the hole and the candidate fails its own residual
 * check. The engine then reports "every sign change was a pole rather than a
 * root" **and names the place**: 9.015987757 mm. The panel asks the question,
 * quotes the refusal, and brackets the crossing off its own curve samples — it
 * does not parse the sentence.
 *
 * That measurement corrects a number in § 1.7's own prose, which called that
 * fixture afocal at "a 9.67 mm gap"; bisecting the sign of the power puts it at
 * 9.0159878 mm.
 *
 * **7. A solve hands you a number; whether it is a surface is a question nothing
 * in the solve asks.** The module header says exactly that, and the panel makes
 * it a red readout rather than a sentence. Asking the shipped achromat for a
 * 500 mm back focus through its crown's *thickness* returns −0.899 mm of N-BK7,
 * and 506.5 mm returns −8.284 mm: both are correct roots of the equation and
 * neither is glass. The reachable half of that variable stops at ~498.77 mm of
 * back focus, where the crown reaches 0.5 mm; the wall at zero thickness is not a
 * wall the solver can see.
 */

/** The lines a lens is quoted at, matching `mtf.ts` and `curvature.ts`. */
export const DESIGN_LINES: readonly { readonly nm: number; readonly name: string }[] = [
  { nm: LINE_F, name: "F (blue)" },
  { nm: LINE_D, name: "d (yellow)" },
  { nm: LINE_C, name: "C (red)" },
];

export type DesignSeedId = "achromat" | "singlet" | "cassegrain" | "equiconvex" | "airspaced";

/**
 * What the solve is allowed to move.
 *
 * The first two are `SolveVariable` exactly. The third is not, and cannot be:
 * nothing in `SolveVariable` couples two surfaces, which is a deliberate limit —
 * § 1.7 pins its multiplicity rung by handing `solveScalar` a closure instead,
 * and this panel does the same. It is named here rather than hidden because the
 * two paths through this file are genuinely different calls.
 */
export type DesignVariable = SolveVariable | { readonly kind: "equiconvex" };

export type TargetKind = "efl" | "bfd";

export interface DesignOption {
  readonly variable: DesignVariable;
  /** How the control reads — "crown front curvature", "the air gap". */
  readonly label: string;
  /** 1/mm for a curvature, mm for a thickness. */
  readonly unit: string;
  /** Where to look. Stated, never expanded — see the file header. */
  readonly interval: readonly [number, number];
}

export interface DesignSeed {
  readonly id: DesignSeedId;
  readonly label: string;
  readonly note: string;
  readonly prescription: Prescription;
  readonly options: readonly DesignOption[];
  readonly defaultOption: number;
  readonly defaultTarget: { readonly kind: TargetKind; readonly value: number };
  /** Whether the seed's intervals are § 1.7's own or this panel's rule. */
  readonly intervalsAreFixtures: boolean;
}

const REFRACTOR_FOCAL_MM = 500;
/** Editor's number, and the f/10 rim of a 500 mm lens — see `benchSeeds`. */
const REFRACTOR_SEMI_APERTURE_MM = 25;

/**
 * The interval rule for the three lenses this app ships: symmetric about the
 * value the design already has, three times as wide as that value, with a floor
 * so that a plane (c = 0) still gets somewhere to look.
 *
 * It is a convenience and the panel says so on screen. The module's own
 * doctrine is that the caller states the interval because only the caller knows
 * what is physical, and a rule like this knows nothing of the sort — it is wide
 * enough to contain the curvature that makes each of these lenses afocal, which
 * is what makes finding 6 reachable from the app's own doublet.
 */
function spread(x0: number, floor: number): readonly [number, number] {
  const half = Math.max(3 * Math.abs(x0), floor);
  return [x0 - half, x0 + half];
}

/** Every surface × both variables, in reading order. */
function optionsFor(prescription: Prescription, names: readonly string[]): readonly DesignOption[] {
  const out: DesignOption[] = [];
  prescription.surfaces.forEach((s, i) => {
    const name = names[i] ?? `surface ${i}`;
    out.push({
      variable: { kind: "curvature", surface: i },
      label: `${name} curvature`,
      unit: "1/mm",
      interval: spread(s.curvature, 0.005),
    });
    out.push({
      variable: { kind: "thickness", surface: i },
      label: `${name} thickness`,
      unit: "mm",
      interval: spread(s.thickness, 20),
    });
  });
  return out;
}

/** § 1.7's multiplicity fixture: N-BK7, 8 mm thick, held equiconvex. */
const EQUICONVEX_THICKNESS_MM = 8;

export function equiconvexLens(curvature: number): Prescription {
  return {
    surfaces: [
      {
        kind: "refract",
        curvature,
        semiAperture: 10,
        thickness: EQUICONVEX_THICKNESS_MM,
        medium: "N-BK7",
      },
      { kind: "refract", curvature: -curvature, semiAperture: 10, thickness: 100, medium: "AIR" },
    ],
  };
}

/**
 * The parabola the equiconvex constraint produces, in closed form — P(c) =
 * 2(n−1)c − (d/n)(n−1)²c², vertex at c* = n/(d(n−1)).
 *
 * Quoted here so the panel can print the shortest achievable focal length beside
 * the solver's answer. It is § 1.7's algebra, not a second implementation of the
 * engine: the curve on screen is always traced.
 */
export function equiconvexVertex(wavelengthNm: number): {
  readonly curvature: number;
  readonly shortestFocalMm: number;
} {
  const n = getMedium("N-BK7").n(wavelengthNm);
  const a = -(EQUICONVEX_THICKNESS_MM / n) * (n - 1) * (n - 1);
  const b = 2 * (n - 1);
  const curvature = -b / (2 * a);
  return { curvature, shortestFocalMm: 1 / (a * curvature * curvature + b * curvature) };
}

/** § 1.7's pole fixture: f ≈ +58 then f ≈ −48, afocal as the gap opens. */
function airSpacedPair(gap: number): Prescription {
  return {
    surfaces: [
      { kind: "refract", curvature: 1 / 60, semiAperture: 10, thickness: 2, medium: "N-BK7" },
      { kind: "refract", curvature: -1 / 60, semiAperture: 10, thickness: gap, medium: "AIR" },
      { kind: "refract", curvature: -1 / 50, semiAperture: 10, thickness: 2, medium: "N-BK7" },
      { kind: "refract", curvature: 1 / 50, semiAperture: 10, thickness: 100, medium: "AIR" },
    ],
  };
}

const AIR_SPACED_DEFAULT_GAP_MM = 20;

export function designSeeds(): readonly DesignSeed[] {
  // The SAME pair the star image is made from — `rayfan.ts`'s reason, and the
  // reason finding 5 is about this app rather than about optics in general.
  const pair = refractorPair(REFRACTOR_FOCAL_MM, REFRACTOR_SEMI_APERTURE_MM, REFRACTOR_FOCAL_MM);
  const cass = cassegrain({ apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 }).prescription;
  const airPair = airSpacedPair(AIR_SPACED_DEFAULT_GAP_MM);

  return [
    {
      id: "achromat",
      label: "BK7/F2 achromat, f = 500, f/10",
      note: "the lens this app renders its stars through — three surfaces, and a colour correction that is a balance between them",
      prescription: pair.achromat,
      options: optionsFor(pair.achromat, ["crown front", "cemented", "flint back"]),
      defaultOption: 0,
      defaultTarget: { kind: "efl", value: 510 },
      intervalsAreFixtures: false,
    },
    {
      id: "singlet",
      label: "BK7 singlet of the same power",
      note: "the same focal length in one glass, so there is no balance for a solve to spend",
      prescription: pair.singlet,
      options: optionsFor(pair.singlet, ["front", "back"]),
      defaultOption: 0,
      defaultTarget: { kind: "efl", value: 510 },
      intervalsAreFixtures: false,
    },
    {
      id: "cassegrain",
      label: "classical Cassegrain, 200 mm f/10",
      note: "two mirrors, so the thickness between them is negative — and a conic has no index, which makes it the colour control",
      prescription: cass,
      options: optionsFor(cass, ["primary", "secondary"]),
      defaultOption: 2,
      defaultTarget: { kind: "efl", value: 2040 },
      intervalsAreFixtures: false,
    },
    {
      id: "equiconvex",
      label: "§ 1.7's equiconvex lens, 8 mm of N-BK7",
      note: "two curvatures moving together, which is the only way to reach a target twice — and the fixture the ladder pinned multiplicity on",
      prescription: equiconvexLens(0.1074546282),
      options: [
        {
          variable: { kind: "equiconvex" },
          label: "both curvatures, c₂ = −c₁",
          unit: "1/mm",
          interval: [0.01, 0.9],
        },
      ],
      defaultOption: 0,
      // 2·f_min, where § 1.7 finds both roots and checks them against the
      // quadratic formula. Rounded to the digits the panel prints.
      defaultTarget: { kind: "efl", value: 10.5485 },
      intervalsAreFixtures: true,
    },
    {
      id: "airspaced",
      label: "§ 1.7's air-spaced pair",
      note: "a weak positive lens in front of a stronger negative one: opening the gap drives the power through zero, so the focal length runs to ±∞ on the way",
      prescription: airPair,
      options: [
        {
          variable: { kind: "thickness", surface: 1 },
          label: "the air gap",
          unit: "mm",
          interval: [1, 120],
        },
        {
          variable: { kind: "curvature", surface: 0 },
          label: "front curvature",
          unit: "1/mm",
          interval: spread(1 / 60, 0.005),
        },
      ],
      defaultOption: 0,
      defaultTarget: { kind: "efl", value: 50 },
      intervalsAreFixtures: true,
    },
  ];
}

export const DESIGN_SEEDS = designSeeds();

export const seedById = (id: DesignSeedId): DesignSeed =>
  DESIGN_SEEDS.find((s) => s.id === id) ?? DESIGN_SEEDS[0]!;

export interface DesignSpec {
  readonly seed: DesignSeedId;
  /** Index into the seed's own option list. */
  readonly option: number;
  readonly target: { readonly kind: TargetKind; readonly value: number };
  readonly interval: readonly [number, number];
  readonly scanCells: number;
  /** Which root to prefer when there are several — `ScalarSolveOptions.seed`. */
  readonly preferNear: number;
  readonly wavelengthNm: number;
  /** Points on the two curves. Cost is one paraxial trace each. */
  readonly curveSamples: number;
}

/** One sample of the property, at one value of the variable. */
export interface DesignCurvePoint {
  readonly x: number;
  /** The quantity the solver actually roots on: power for an EFL target, mm for a BFD one. */
  readonly solved: number;
  /** The focal length in mm, which is where a pole lives. */
  readonly eflMm: number;
  /** False where the system is not a system — the wall, drawn as a gap. */
  readonly finite: boolean;
}

/** One solution, with what it is worth knowing about the lens it names. */
export interface DesignRoot {
  readonly x: number;
  readonly value: number;
  readonly eflMm: number;
  readonly bfdMm: number;
  /** Vertex radius, when the variable is a curvature. Infinity for a plane. */
  readonly radiusMm: number | null;
  /**
   * |R| ÷ the surface's own clear semi-aperture. Below 1 the sphere is smaller
   * than the rim it must carry, so the number the solver returned is not a
   * surface. `null` when the variable is not a curvature.
   */
  readonly rimRatio: number | null;
  /** Glass thickness that came back negative — a root that is not a lens. */
  readonly negativeGlass: boolean;
}

export interface LineReadout {
  readonly nm: number;
  readonly name: string;
  readonly eflMm: number;
  readonly bfdMm: number;
}

export interface DesignSolution {
  readonly x: number;
  readonly value: number;
  /** value − target, in the target's own units (mm). */
  readonly residualMm: number;
  /**
   * The same miss in the currency the EFL solve is actually performed in —
   * 1/f against 1/target. Zero or one ulp; see finding 1.
   */
  readonly residualPower: number;
  readonly roots: readonly DesignRoot[];
  readonly evaluations: number;
  /** Evaluations past the scan itself: the refinement plus the candidate checks. */
  readonly beyondTheScan: number;
  /** The built lens at F, d and C — the solve holds at exactly one of them. */
  readonly lines: readonly LineReadout[];
  /** Largest |property − target| across the other two lines (mm). */
  readonly worstOtherLineMm: number;
  /** EFL(F) − EFL(C) before the solve and after it. */
  readonly spreadBeforeMm: number;
  readonly spreadAfterMm: number;
  readonly valueFrom: number;
  readonly valueTo: number;
}

export interface DesignReadout {
  readonly seed: DesignSeed;
  readonly option: DesignOption;
  readonly curve: readonly DesignCurvePoint[];
  readonly solution: DesignSolution | Refusal<DesignStage>;
  /**
   * Roots the same question has at four times the scan resolution, computed
   * whether or not the solve above succeeded — which is the whole point of it.
   * § 1.7's blind cell is a pair of roots closer together than one cell, and it
   * presents as a REFUSAL: the coarse scan reports the target as unreachable,
   * naming the resolution it searched at. `-1` when the finer scan also refuses.
   */
  readonly rootsAtFinerScan: number;
  /** The scan the line above ran at. */
  readonly finerScanCells: number;
  /**
   * The same EFL question asked straight at the focal length instead of at the
   * power — § 1.7's pole, from the caller's side. Only meaningful for an `efl`
   * target; `null` for a `bfd` one, where there is no reciprocal to take.
   */
  readonly naive: NaiveControl | null;
  /** "Where does this variable make the system afocal?" — see finding 6. */
  readonly afocal: AfocalProbe;
  /** Property values at the interval's two ends, for the "is it in range" line. */
  readonly rangeLoMm: number;
  readonly rangeHiMm: number;
  readonly elapsedMs: number;
}

export type DesignStage = "build" | "solve" | "naive" | "afocal";

export interface NaiveControl {
  /** Whether it landed on the same lens, refused, or disagreed. */
  readonly verdict: "same" | "refused" | "different";
  readonly x: number | null;
  readonly evaluations: number | null;
  readonly message: string | null;
}

export interface AfocalProbe {
  /** True when the engine refused, which is the expected answer — see finding 6. */
  readonly refused: boolean;
  /** The engine's own sentence, never rewritten. */
  readonly message: string | null;
  /** A value it returned instead, on the rare path where one survives the check. */
  readonly x: number | null;
  /** Where the panel's own samples bracket a sign change of the power, if any. */
  readonly bracket: readonly [number, number] | null;
}

export type DesignDescription = ({ readonly ok: true } & DesignReadout) | Refusal<DesignStage>;

/** Cells the blindness guard re-scans at — see § 1.7 and finding in the panel. */
const FINER_SCAN_FACTOR = 4;

export function describeDesign(spec: DesignSpec): DesignDescription {
  const started = performance.now();
  const seed = seedById(spec.seed);
  const option = seed.options[spec.option] ?? seed.options[seed.defaultOption]!;
  const nm = spec.wavelengthNm;

  /** The prescription this variable produces at x. */
  const buildAt = (x: number): Prescription =>
    option.variable.kind === "equiconvex"
      ? equiconvexLens(x)
      : withVariable(seed.prescription, option.variable, x);

  const propertyAt = (x: number, kind: TargetKind): number => {
    const p = systemProperties(buildAt(x), nm);
    return kind === "efl" ? p.efl : p.bfd;
  };

  const [lo, hi] = spec.interval;
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) {
    return refusalOf(
      new AppRefusal(
        `the interval [${lo}, ${hi}] is not somewhere to look — the solver needs lo < hi, ` +
          `and it will not expand a bracket for you.`,
      ),
      "build",
    );
  }
  if (!(Number.isFinite(spec.target.value) && spec.target.value !== 0)) {
    return refusalOf(
      new AppRefusal(`a ${spec.target.kind} target of ${spec.target.value} is not a design target.`),
      "build",
    );
  }

  // The curve, sampled before anything is solved: a refused solve with its own
  // curve drawn is the most useful failure this panel has, because the picture
  // says whether the target was out of range or the interval was in the wrong
  // place — which is the same pair of readings the engine's refusal names.
  const curve: DesignCurvePoint[] = [];
  for (let i = 0; i < spec.curveSamples; i++) {
    const x = lo + ((hi - lo) * i) / (spec.curveSamples - 1);
    try {
      const p = systemProperties(buildAt(x), nm);
      curve.push({
        x,
        solved: spec.target.kind === "efl" ? 1 / p.efl : p.bfd,
        eflMm: p.efl,
        finite: true,
      });
    } catch {
      curve.push({ x, solved: Number.NaN, eflMm: Number.NaN, finite: false });
    }
  }
  if (!curve.some((p) => p.finite)) {
    return refusalOf(
      new AppRefusal(
        `nothing over [${lo}, ${hi}] is a system this engine has first-order properties for.`,
      ),
      "build",
    );
  }

  const options = {
    interval: spec.interval,
    scanCells: spec.scanCells,
    seed: spec.preferNear,
  } as const;

  // Spelled out rather than passed through: `{ kind: "efl" | "bfd" }` is not the
  // engine's discriminated union, and widening it here would be the panel's
  // control type leaking into a call the engine narrows on.
  const target: ParaxialTarget =
    spec.target.kind === "efl"
      ? { kind: "efl", value: spec.target.value }
      : { kind: "bfd", value: spec.target.value };

  /** The solve, run the honest way: an EFL target is a target on the power. */
  const runSolve = (cells: number): ScalarSolveResult => {
    if (option.variable.kind !== "equiconvex") {
      return solveParaxial(seed.prescription, option.variable, target, nm, {
        ...options,
        scanCells: cells,
      });
    }
    // The coupled branch does by hand what `solveParaxial` does, because
    // `SolveVariable` cannot express a constraint across two surfaces. Same
    // reciprocal, same tolerance conversion — |ΔP| = |Δf|/f² — so that the panel
    // is not quietly running a looser solve on the one seed with two roots.
    if (spec.target.kind === "bfd") {
      return solveScalar((x) => propertyAt(x, "bfd"), spec.target.value, {
        ...options,
        scanCells: cells,
      });
    }
    const powerTarget = 1 / spec.target.value;
    const inPower = solveScalar((x) => 1 / propertyAt(x, "efl"), powerTarget, {
      ...options,
      scanCells: cells,
      valueTolerance: 1e-9 * Math.abs(powerTarget) + 1e-15,
    });
    const roots = inPower.roots.map((r) => ({ x: r.x, value: 1 / r.value }));
    const value = 1 / inPower.value;
    return {
      x: inPower.x,
      value,
      residual: value - spec.target.value,
      roots,
      evaluations: inPower.evaluations,
    };
  };

  const describeRoot = (x: number, value: number): DesignRoot => {
    const built = buildAt(x);
    const p = systemProperties(built, nm);
    const isCurvature = option.variable.kind !== "thickness";
    const surface = option.variable.kind === "equiconvex" ? 0 : option.variable.surface;
    const rim = built.surfaces[surface]!.semiAperture;
    const radiusMm = isCurvature ? (x === 0 ? Infinity : 1 / x) : null;
    return {
      x,
      value,
      eflMm: p.efl,
      bfdMm: p.bfd,
      radiusMm,
      rimRatio: radiusMm === null ? null : Math.abs(radiusMm) / rim,
      negativeGlass:
        option.variable.kind === "thickness" &&
        x <= 0 &&
        built.surfaces[option.variable.surface]!.kind === "refract" &&
        (built.surfaces[option.variable.surface]!.medium ?? "AIR") !== "AIR",
    };
  };

  let solution: DesignSolution | Refusal<DesignStage>;
  let solvedX: number | null = null;
  try {
    const r = runSolve(spec.scanCells);
    const built = buildAt(r.x);
    const before = seed.prescription;
    const lines = DESIGN_LINES.map((l): LineReadout => {
      const p = systemProperties(built, l.nm);
      return { nm: l.nm, name: l.name, eflMm: p.efl, bfdMm: p.bfd };
    });
    const at = (p: Prescription, w: number) => systemProperties(p, w);
    const worstOtherLineMm = Math.max(
      ...lines
        .filter((l) => l.nm !== nm)
        .map((l) =>
          Math.abs((spec.target.kind === "efl" ? l.eflMm : l.bfdMm) - spec.target.value),
        ),
    );
    solvedX = r.x;
    solution = {
      x: r.x,
      value: r.value,
      residualMm: r.residual,
      residualPower:
        spec.target.kind === "efl" ? 1 / r.value - 1 / spec.target.value : Number.NaN,
      roots: r.roots.map((q) => describeRoot(q.x, q.value)),
      evaluations: r.evaluations,
      beyondTheScan: r.evaluations - (spec.scanCells + 1),
      lines,
      worstOtherLineMm,
      spreadBeforeMm: at(before, LINE_F).efl - at(before, LINE_C).efl,
      spreadAfterMm: at(built, LINE_F).efl - at(built, LINE_C).efl,
      valueFrom:
        option.variable.kind === "equiconvex"
          ? seed.prescription.surfaces[0]!.curvature
          : option.variable.kind === "curvature"
            ? seed.prescription.surfaces[option.variable.surface]!.curvature
            : seed.prescription.surfaces[option.variable.surface]!.thickness,
      valueTo: r.x,
    };
  } catch (cause) {
    solution = refusalOf(cause, "solve");
  }

  // § 1.7's blind cell, live: a cell holding two roots shows no sign change
  // across it, so a pair closer together than one cell is stepped over — and
  // what that looks like from outside is not a wrong answer but a REFUSAL, at a
  // resolution the message names. Run whether or not the solve above succeeded,
  // because the case worth catching is exactly the one where it did not.
  const finerScanCells = spec.scanCells * FINER_SCAN_FACTOR;
  let rootsAtFinerScan: number;
  try {
    rootsAtFinerScan = runSolve(finerScanCells).roots.length;
  } catch {
    rootsAtFinerScan = -1;
  }

  // The control: the same EFL question asked straight at the focal length. The
  // guard inside `solveScalar` means this is not usually WRONG — a pole's
  // candidate fails its own residual check and is discarded — so what the two
  // routes differ in is which sentence comes back when the target is out of
  // reach, and how much work it took to get there.
  let naive: NaiveControl | null = null;
  if (spec.target.kind === "efl") {
    try {
      const r = solveScalar((x) => propertyAt(x, "efl"), spec.target.value, options);
      const same =
        solvedX !== null && Math.abs(r.x - solvedX) <= 1e-9 * Math.max(1, Math.abs(r.x));
      naive = {
        verdict: same ? "same" : "different",
        x: r.x,
        evaluations: r.evaluations,
        message: null,
      };
    } catch (cause) {
      naive = {
        verdict: "refused",
        x: null,
        evaluations: null,
        message: (cause as Error).message,
      };
    }
  }

  // "Where is this system afocal?" — a design question with an answer, asked of a
  // solver that cannot return it. See finding 6.
  let afocal: AfocalProbe;
  try {
    const r = solveScalar((x) => 1 / propertyAt(x, "efl"), 0, options);
    afocal = { refused: false, message: null, x: r.x, bracket: null };
  } catch (cause) {
    afocal = { refused: true, message: (cause as Error).message, x: null, bracket: null };
  }
  // The bracket is the panel's own, off the curve it already sampled — at the
  // curve's resolution and not at the solver's, which is why it is reported as a
  // pair of x values rather than as a number. Consecutive FINITE samples, so a
  // sample that landed in the hole itself widens the bracket instead of hiding
  // the crossing behind it.
  let bracket: readonly [number, number] | null = null;
  let previous: DesignCurvePoint | null = null;
  for (const point of curve) {
    if (!point.finite) continue;
    if (previous !== null) {
      const pa = 1 / previous.eflMm;
      const pb = 1 / point.eflMm;
      if (pa !== 0 && pb !== 0 && pa > 0 !== pb > 0) {
        bracket = [previous.x, point.x];
        break;
      }
    }
    previous = point;
  }
  afocal = { ...afocal, bracket };

  const endValue = (x: number): number => {
    try {
      return propertyAt(x, spec.target.kind);
    } catch {
      return Number.NaN;
    }
  };

  return {
    ok: true,
    seed,
    option,
    curve,
    solution,
    rootsAtFinerScan,
    finerScanCells,
    naive,
    afocal,
    rangeLoMm: endValue(lo),
    rangeHiMm: endValue(hi),
    elapsedMs: performance.now() - started,
  };
}

/** What a fresh panel opens on: the app's own doublet, retargeted by 2%. */
export function defaultSpec(): DesignSpec {
  const seed = seedById("achromat");
  const option = seed.options[seed.defaultOption]!;
  return {
    seed: seed.id,
    option: seed.defaultOption,
    target: seed.defaultTarget,
    interval: option.interval,
    scanCells: 64,
    preferNear: (option.interval[0] + option.interval[1]) / 2,
    wavelengthNm: LINE_D,
    curveSamples: 241,
  };
}
