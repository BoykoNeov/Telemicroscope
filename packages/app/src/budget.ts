import type { OpticalSystem } from "@telemicroscope/core/trace";
import type { Prescription } from "@telemicroscope/core/trace";
import { paraxialTrace } from "@telemicroscope/core/trace";
import { LINE_D } from "@telemicroscope/core/materials";
import { achromaticObjective, apochromaticObjective } from "@telemicroscope/core/designs";
import {
  applyPerturbations,
  centringError,
  curvatureError,
  equivalentWedgeDeg,
  sensitivity,
  thicknessError,
  toleranceBudget,
  withTrailingReference,
  type PerturbationGroup,
  type ToleranceCurrency,
  type ToleranceOptions,
  type ToleranceParameter,
  type ToleranceUnit,
} from "@telemicroscope/core/analysis";

/**
 * APP.md Part P — the tolerance sheet, and the second lens it takes to know
 * what the first one's numbers were a property of.
 *
 * § 6au built a real tolerance budget on the shipped apochromat and reported
 * two things this surface exists to put a control under. The first is that a
 * tolerance has **two currencies** — the blur a focuser cannot remove, and the
 * colour a three-glass lens was bought to not have — and that which one binds
 * a row is measured rather than assumed. The second is that the eleven rows
 * **cancel**: applied together they cost 0.76 of the root-sum-square the budget
 * predicts, and § 6au is careful to say the factor "belongs to this lens rather
 * than to the method, so it is measured and not offered as a law".
 *
 * A rung can state that. Only a second lens can show it, and that is what this
 * module is for: the same eleven-row machinery run on the cemented DOUBLET
 * `designs/achromat` ships, where the same number comes back on the **other
 * side of one**. See `panels/budget.tsx` for what the screen says about it.
 *
 * Pure functions and no DOM, so this runs in the worker, in the panel, and in
 * vitest unchanged — APP.md's structural item 2, held once more.
 */

/** The two cemented objectives the ladder ships, and the whole lens choice. */
export type SheetLens = "apochromat" | "achromat";

export interface SheetSpec {
  readonly lens: SheetLens;
  /** Entrance pupil diameter, mm. § 6au's own fixture is 10. */
  readonly apertureMm: number;
  /** § 6au's own fixture is 6. */
  readonly focalRatio: number;
}

/** § 5t's currency and its target: the balanced wavefront Maréchal allows. */
export const MARECHAL_WAVES = 1 / 14;

/**
 * The band the colour currency is measured over, and it is ONE band for both
 * lenses on purpose.
 *
 * § 6au measures the apochromat over the span its three united lines cover.
 * Widening or narrowing a band changes a colour residual by a lot — § 6at's own
 * headline ratio moves 12× between two defensible bands — so a doublet measured
 * over the doublet's band and a triplet over the triplet's would differ by an
 * amount that is partly the bands' and partly the lenses', with nothing on
 * screen able to say which. The comparison this surface exists to make needs
 * one ruler.
 */
const BAND_LO_NM = 430;
const BAND_HI_NM = 680;
const BAND_STEP_NM = 2.5;

/** Probe sizes, small enough to stay in each row's linear range (§ 6au's). */
const CURVATURE_PROBE = 1e-5;
const LENGTH_PROBE = 1e-3;

const efl = (p: Prescription, nm: number): number => -1 / paraxialTrace(p, nm, { y: 1, u: 0 }).u;

/**
 * The colour a refocus cannot remove: the worst fractional focal-length
 * departure over the band, measured against **this prescription's own d line**.
 *
 * The reference is the whole content of the definition. § 6at.7's first version
 * compared a perturbed lens to the ORIGINAL d-line focal length, which leaves
 * the refocusable part of the error inside the "chromatic" number and put the
 * result 74× from its closed form. Each prescription is referred to itself, so
 * what is left is colour and nothing else.
 */
export function axialColour(p: Prescription): number {
  const fd = efl(p, LINE_D);
  let worst = 0;
  for (let nm = BAND_LO_NM; nm <= BAND_HI_NM; nm += BAND_STEP_NM) {
    worst = Math.max(worst, Math.abs(fd / efl(p, nm) - 1));
  }
  return worst;
}

export interface SheetLensBuild {
  /** With § 6au's trailing reference plane: the rear surface's local errors
   * need a successor to carry their compensation, and there is none without it. */
  readonly prescription: Prescription;
  readonly system: OpticalSystem;
  /** The lens's OWN residual colour — the target the colour budget is set to. */
  readonly nominalColour: number;
  readonly focalLengthMm: number;
  /** One per drawing number: 3n−1 of them for an n-surface cemented block. */
  readonly parameters: readonly ToleranceParameter[];
  /** Element centre thicknesses and surface clear semi-apertures, so a row can
   * say when its allowance has outgrown the part it describes. */
  readonly thicknessesMm: readonly number[];
  readonly semiAperturesMm: readonly number[];
}

/**
 * The lens, and the eleven (or eight) freedoms its drawing carries.
 *
 * **Not fifteen, and that is § 6au.3 rather than an omission.** A sphere is
 * fixed by its centre and its radius, so tilting one about its vertex by α and
 * decentring it by δ = −R·sin α produce the SAME surface — the chief ray through
 * the two prescriptions is bit-for-bit identical. Wedge is therefore not a row
 * beside centring, it is another *unit* for centring, and it appears in this
 * sheet as a column rather than as four more lines.
 */
export function buildSheetLens(spec: SheetSpec): SheetLensBuild {
  const design =
    spec.lens === "apochromat"
      ? apochromaticObjective({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio })
      : achromaticObjective({ apertureMm: spec.apertureMm, focalRatio: spec.focalRatio });
  const bare = design.prescription;
  const p = withTrailingReference(bare);
  const nSurfaces = bare.surfaces.length;

  const parameters: ToleranceParameter[] = [
    ...Array.from({ length: nSurfaces }, (_, s) => ({
      label: `c${s + 1}`,
      unit: "relative" as ToleranceUnit,
      at: (m: number) => curvatureError(p, s, m),
      probe: CURVATURE_PROBE,
    })),
    ...Array.from({ length: nSurfaces - 1 }, (_, s) => ({
      label: `t${s + 1}`,
      unit: "mm" as ToleranceUnit,
      at: (m: number) => thicknessError(p, s, m),
      probe: LENGTH_PROBE,
    })),
    ...Array.from({ length: nSurfaces }, (_, s) => ({
      label: `s${s + 1} centring`,
      unit: "mm" as ToleranceUnit,
      at: (m: number) => centringError(p, s, m),
      probe: LENGTH_PROBE,
    })),
  ];

  return {
    prescription: p,
    system: {
      prescription: p,
      aperture: { kind: "stopRadius", value: spec.apertureMm / 2 },
      field: { kind: "angle", values: [0] },
      wavelengths: [{ nm: LINE_D, weight: 1 }],
      conjugate: { kind: "infinite" },
    },
    nominalColour: axialColour(p),
    focalLengthMm: efl(p, LINE_D),
    parameters,
    thicknessesMm: bare.surfaces.slice(0, nSurfaces - 1).map((s) => s.thickness),
    semiAperturesMm: bare.surfaces.map((s) => s.semiAperture ?? Infinity),
  };
}

/** § 6at.7's colour currency, closed over one prescription. */
export function colourCurrencyFor(build: SheetLensBuild): ToleranceCurrency {
  return (_system, groups) =>
    Math.abs(
      axialColour(
        applyPerturbations(
          build.prescription,
          groups.flatMap((g) => g.perturbations),
        ),
      ) - build.nominalColour,
    );
}

export type Currency = "colour" | "blur";

/**
 * What a row's number is worth reading as.
 *
 * `ok` is a tolerance. The other three are not, and saying so is most of what
 * this sheet is for — an inverse-sensitivity budget divides a target by a slope
 * and will hand back a number for anything, including parameters neither
 * currency constrains at all.
 */
export type RowVerdict = "ok" | "loose" | "not a tolerance" | "refused";

export interface SheetRow {
  readonly label: string;
  readonly unit: ToleranceUnit;
  /** Currency spent per unit of this parameter, divided by that currency's
   * target — which is what makes the two columns comparable at all. */
  readonly colourPerUnit: number;
  readonly blurPerUnit: number;
  readonly binds: Currency;
  /** How much the binding currency beats the other by. `Infinity` where the
   * other reads a clean zero, which is every centring row in colour. */
  readonly bindsBy: number;
  /** What each currency alone would allow, in `unit`. `Infinity` where that
   * currency has no slope on this row — which is colour, on every centring row,
   * on both lenses. */
  readonly colourAllowance: number;
  readonly blurAllowance: number;
  /** The size of error this parameter is allowed: the tighter of the two, which
   * is the binding currency's by construction. */
  readonly allowance: number;
  /** The binding currency RE-MEASURED at `allowance`, over its share. One says
   * the slope reached where the budget sent it. */
  readonly linearity: number;
  /** The same allowance as a wedge callout, arcminutes — § 6au.3's α = asin(δ·c).
   * `null` for a row that is not a centring row, and for a PLANE surface, where
   * the conversion diverges and the engine refuses rather than returning a large
   * number. */
  readonly wedgeArcmin: number | null;
  readonly verdict: RowVerdict;
  /** Why, when the verdict is not `ok`. Empty otherwise. */
  readonly note: string;
}

export interface SheetRequest {
  readonly spec: SheetSpec;
  /**
   * The budget, as a fraction of each currency's nominal target — λ/14 of blur,
   * and the lens's own residual colour.
   *
   * It is a control rather than a constant because the allowance is a LINEAR
   * EXTRAPOLATION from a probe a thousand times smaller, and nothing in that
   * arithmetic knows where linearity stops. Walking it is how a reader finds
   * out; `linearity` and the dropped-point count are what report it.
   */
  readonly budgetScale: number;
  /** Pupil grid across the full diameter. 21 is § 5t's and § 6au's. */
  readonly pupilSamples: number;
}

export interface Drawing {
  /** Every row at its allowance, applied together and traced ONCE. */
  readonly combinedWaves: number;
  /** √(Σσᵢ²) over the same rows on the same support — the estimate that assumes
   * the rows are independent. */
  readonly rssWaves: number;
  /** `combined / rss`. Below one the rows cancel, above one they reinforce, and
   * § 6au's whole point is that this is a fact about the LENS. */
  readonly couplingRatio: number;
  /** Pupil samples every row and the combined trace all kept. Variances add
   * exactly only over a common support, so without this the ratio above has a
   * third explanation and stops being a measurement. */
  readonly pointsRetained: number;
  readonly pointsDropped: number;
}

export interface Sheet {
  readonly lens: SheetLens;
  readonly surfaces: number;
  readonly focalLengthMm: number;
  readonly nominalColour: number;
  readonly budgetScale: number;
  readonly rows: readonly SheetRow[];
  /** How many rows each currency ended up paying for. */
  readonly colourRows: number;
  readonly blurRows: number;
  /** `null` when the combined trace could not be taken — see `refusal`. */
  readonly drawing: Drawing | null;
  /** Set when the budget asked for a lens the tracer cannot follow. */
  readonly refusal: string;
  readonly elapsedMs: number;
}

const LOOSE_BAND = 0.05;

/**
 * The slope, measured at the probe and NOT through the allocator.
 *
 * `allocateEqualShare` measures a slope and then re-measures the currency AT the
 * allowance it computed, which is the diagnostic that makes it trustworthy — and
 * it means a single-row call spends the WHOLE target on that row, which can
 * perturb the lens past the point where the chief ray still clears the glass. It
 * throws there, from three frames inside `opdMap`. A sheet cannot lose ten good
 * rows because the eleventh has a shallow slope, so the slope is taken here and
 * the re-measurement is done row by row below, each inside its own `try`.
 */
function slopeOf(
  system: OpticalSystem,
  parameter: ToleranceParameter,
  currency: ToleranceCurrency,
  target: number,
): number {
  return currency(system, [parameter.at(parameter.probe)]) / Math.abs(parameter.probe) / target;
}

const blurCurrencyFor =
  (opts: ToleranceOptions): ToleranceCurrency =>
  (system, groups: readonly PerturbationGroup[]) =>
    sensitivity(system, groups[0]!, opts).sigmaWaves;

/**
 * Everything about a lens that does not depend on the size of the budget.
 *
 * The slopes are the expensive half — one traced wavefront per row per currency
 * — and they are scale-free by construction, so the curve below re-uses them at
 * every point instead of re-measuring six times over. That is the difference
 * between a ~10 s job and a ~4 s one on the triplet, and it is the only reason
 * the sweep is affordable beside the sheet at all.
 */
export interface SheetContext {
  readonly spec: SheetSpec;
  readonly build: SheetLensBuild;
  readonly opts: ToleranceOptions;
  readonly colour: ToleranceCurrency;
  readonly blur: ToleranceCurrency;
  readonly slopes: readonly { readonly colour: number; readonly blur: number }[];
  readonly binds: readonly Currency[];
  readonly colourRows: number;
  readonly blurRows: number;
  /** Surfaces the LENS has — the trailing reference plane is not one of them. */
  readonly nSurfaces: number;
  /** Index of the first centring row, which is where the wedge column starts. */
  readonly centringFirst: number;
}

export function prepareSheet(spec: SheetSpec, pupilSamples: number): SheetContext {
  const build = buildSheetLens(spec);
  const opts: ToleranceOptions = { pupilSamples };
  const colour = colourCurrencyFor(build);
  const blur = blurCurrencyFor(opts);
  const slopes = build.parameters.map((p) => ({
    colour: slopeOf(build.system, p, colour, build.nominalColour),
    blur: slopeOf(build.system, p, blur, MARECHAL_WAVES),
  }));
  const binds: Currency[] = slopes.map((s) => (s.colour > s.blur ? "colour" : "blur"));
  const colourRows = binds.filter((b) => b === "colour").length;
  const nSurfaces = build.prescription.surfaces.length - 1;
  return {
    spec,
    build,
    opts,
    colour,
    blur,
    slopes,
    binds,
    colourRows,
    blurRows: binds.length - colourRows,
    nSurfaces,
    centringFirst: 2 * nSurfaces - 1,
  };
}

/**
 * Each currency's budget divided among EVERY row, and the row quoted at the
 * tighter of the two allowances that come back.
 *
 * That is one rule, and it is § 6au.6's: both its currency columns are
 * allocated over all eleven rows and every drawing number it quotes comes from
 * whichever one binds. The rule also makes both budgets true at once, which is
 * not automatic — a row quoted at its colour allowance is still spending blur,
 * and if the blur budget had been divided only among the rows colour cannot see
 * then the rows colour CAN see would be spending it a second time. On the
 * apochromat that second helping is the whole budget over again: § 6au.7's
 * seven-four grouping, assembled and traced, spends **1.04× the λ/14** it
 * allowed, and 99.4% of that comes from the seven rows the blur share was never
 * divided among. § 6au.7 is measuring a coupling ratio rather than issuing a
 * drawing, so this is a difference between two allocations and not a defect in
 * either — but a sheet has to pick the one whose numbers a shop could work to.
 *
 * Because the share is the same √N for both currencies, the currency with the
 * larger normalized slope is always the one with the smaller allowance: "binds"
 * and "tighter" are the same word, and the quote is the minimum.
 */
function shareOf(ctx: SheetContext, currency: Currency, budgetScale: number): number {
  const target = currency === "colour" ? ctx.build.nominalColour : MARECHAL_WAVES;
  return (target * budgetScale) / Math.sqrt(ctx.build.parameters.length);
}

function allowanceIn(
  ctx: SheetContext,
  i: number,
  currency: Currency,
  budgetScale: number,
): number {
  const s = ctx.slopes[i]!;
  const normalized = currency === "colour" ? s.colour : s.blur;
  const target = currency === "colour" ? ctx.build.nominalColour : MARECHAL_WAVES;
  const perUnit = normalized * target;
  return perUnit > 0 ? shareOf(ctx, currency, budgetScale) / perUnit : Infinity;
}

function allowanceOf(ctx: SheetContext, i: number, budgetScale: number): number {
  return allowanceIn(ctx, i, ctx.binds[i]!, budgetScale);
}

/** Every row at its allowance, applied together and traced once — or the reason
 * that could not be done. */
function drawingAt(
  ctx: SheetContext,
  budgetScale: number,
): { drawing: Drawing | null; refusal: string } {
  const groups = ctx.build.parameters.flatMap((p, i) => {
    const allowance = allowanceOf(ctx, i, budgetScale);
    return Number.isFinite(allowance) ? [p.at(allowance)] : [];
  });
  try {
    const budget = toleranceBudget(ctx.build.system, groups, ctx.opts);
    return {
      drawing: {
        combinedWaves: budget.combinedWaves,
        rssWaves: budget.rssWaves,
        couplingRatio: budget.rssWaves > 0 ? budget.combinedWaves / budget.rssWaves : 1,
        pointsRetained: budget.pointsRetained,
        pointsDropped: budget.pointsDropped,
      },
      refusal: "",
    };
  } catch (error) {
    return {
      drawing: null,
      refusal: `the whole sheet at once leaves no traceable lens (${(error as Error).message})`,
    };
  }
}

/**
 * The sheet: every drawing number, the currency that binds it, and what that
 * currency allows it.
 *
 * **Each row is allocated in the currency that binds it**, which is the sheet a
 * shop receives — § 6au's own prose quotes its drawing numbers "from whichever
 * currency binds". That is not the only defensible grouping and the difference
 * is visible: § 6au.7 measures its coupling ratio with every row colour can see
 * allocated in colour, which puts the apochromat's t₃ in the colour group where
 * this sheet puts it in blur, and that one row moves the combined-against-RSS
 * ratio from 0.763 to 0.576. Both are honest, they are answers to different
 * questions, and only one of them is a drawing.
 */
export function sheetAt(ctx: SheetContext, budgetScale: number): Sheet {
  const started = Date.now();
  const { build } = ctx;

  const rows: SheetRow[] = build.parameters.map((p, i) => {
    const s = ctx.slopes[i]!;
    const binds = ctx.binds[i]!;
    const normalized = binds === "colour" ? s.colour : s.blur;
    const other = binds === "colour" ? s.blur : s.colour;
    const currency = binds === "colour" ? ctx.colour : ctx.blur;
    const share = shareOf(ctx, binds, budgetScale);
    const allowance = allowanceOf(ctx, i, budgetScale);

    let linearity = NaN;
    let verdict: RowVerdict = "ok";
    let note = "";
    if (!Number.isFinite(allowance)) {
      verdict = "refused";
      note = "neither currency has a slope here";
    } else {
      try {
        linearity = currency(build.system, [p.at(allowance)]) / share;
      } catch (error) {
        verdict = "refused";
        note = `the allowance leaves no traceable lens (${(error as Error).message})`;
      }
    }

    // An allowance bigger than the part it describes is not a tolerance. It is
    // the statement that this currency does not constrain this parameter and the
    // MECHANICAL drawing does, and § 6au leaves two such rows out of its own
    // summary sentence for exactly that reason.
    const partMm =
      i >= ctx.centringFirst
        ? build.semiAperturesMm[i - ctx.centringFirst]
        : i >= ctx.nSurfaces
          ? build.thicknessesMm[i - ctx.nSurfaces]
          : undefined;
    if (verdict === "ok" && partMm !== undefined && allowance > partMm) {
      verdict = "not a tolerance";
      note = `${allowance.toPrecision(3)} mm on a part ${partMm.toPrecision(3)} mm across`;
    }
    if (verdict === "ok" && p.unit === "relative" && allowance > 0.5) {
      verdict = "not a tolerance";
      note = `${(allowance * 100).toPrecision(3)}% of a radius is a different lens`;
    }
    if (verdict === "ok" && Math.abs(linearity - 1) > LOOSE_BAND) {
      verdict = "loose";
      note = `the slope reached ${(linearity * 100).toFixed(0)}% of where the budget sent it`;
    }

    let wedgeArcmin: number | null = null;
    if (i >= ctx.centringFirst && Number.isFinite(allowance)) {
      try {
        wedgeArcmin = Math.abs(
          equivalentWedgeDeg(build.prescription, i - ctx.centringFirst, allowance) * 60,
        );
      } catch {
        // A plane has no equivalent wedge at all: δ = −R·sin α diverges as
        // R → ∞, so the engine refuses rather than returning a large number, and
        // the cell says so rather than printing one.
        wedgeArcmin = null;
      }
    }

    return {
      label: p.label,
      unit: p.unit,
      colourPerUnit: s.colour,
      blurPerUnit: s.blur,
      binds,
      bindsBy: other > 0 ? normalized / other : Infinity,
      colourAllowance: allowanceIn(ctx, i, "colour", budgetScale),
      blurAllowance: allowanceIn(ctx, i, "blur", budgetScale),
      allowance,
      linearity,
      wedgeArcmin,
      verdict,
      note,
    };
  });

  const { drawing, refusal } = drawingAt(ctx, budgetScale);

  return {
    lens: ctx.spec.lens,
    surfaces: ctx.nSurfaces,
    focalLengthMm: build.focalLengthMm,
    nominalColour: build.nominalColour,
    budgetScale,
    rows,
    colourRows: ctx.colourRows,
    blurRows: ctx.blurRows,
    drawing,
    refusal,
    elapsedMs: Date.now() - started,
  };
}

/** One sheet, for a caller that has no context yet — the tests', mostly. */
export function toleranceSheet(request: SheetRequest): Sheet {
  return sheetAt(prepareSheet(request.spec, request.pupilSamples), request.budgetScale);
}

export interface CouplingPoint {
  readonly budgetScale: number;
  /** `null` where the budget asked for a lens the tracer cannot follow. */
  readonly couplingRatio: number | null;
  readonly combinedWaves: number | null;
  readonly pointsDropped: number | null;
}

/**
 * The coupling ratio against the budget it was measured at.
 *
 * The curve is the argument the table cannot make. A single ratio is a number a
 * reader has to take on trust; a ratio that holds flat across three decades of
 * budget and then bends exactly where the pupil starts losing points is a
 * measurement with its own domain of validity drawn on it.
 */
export function couplingSweep(
  ctx: SheetContext,
  scales: readonly number[],
): readonly CouplingPoint[] {
  return scales.map((budgetScale) => {
    const { drawing } = drawingAt(ctx, budgetScale);
    return {
      budgetScale,
      couplingRatio: drawing?.couplingRatio ?? null,
      combinedWaves: drawing?.combinedWaves ?? null,
      pointsDropped: drawing?.pointsDropped ?? null,
    };
  });
}

export interface BudgetRequest {
  readonly spec: SheetSpec;
  readonly budgetScale: number;
  readonly pupilSamples: number;
  /** Where the coupling curve is sampled, as budget fractions. */
  readonly scales: readonly number[];
}

export interface LensSweep {
  readonly lens: SheetLens;
  readonly points: readonly CouplingPoint[];
}

export interface BudgetResult {
  readonly sheet: Sheet;
  /**
   * BOTH lenses, always, and that is the surface's argument rather than a
   * convenience. § 6au measures its coupling factor on one lens and says in as
   * many words that the factor belongs to that lens; a reader can only take that
   * on trust from one curve. Two curves on one pair of axes, one of them below
   * one and the other above it, is the same sentence as a measurement.
   *
   * It is affordable because the second lens is a second slope measurement and
   * nothing else — about 0.4 s against the chosen lens's own ~0.7 s.
   */
  readonly sweeps: readonly LensSweep[];
  readonly elapsedMs: number;
}

export const SHEET_LENSES: readonly SheetLens[] = ["apochromat", "achromat"];

export interface BudgetJob {
  readonly seq: number;
  readonly request: BudgetRequest;
}

export interface BudgetDone {
  readonly seq: number;
  readonly result: BudgetResult;
}

/**
 * The worker's whole job: the sheet at the chosen budget, and the curve.
 *
 * One context serves both, which is the point of having one — the slopes cost a
 * traced wavefront per row and neither the sheet's budget nor the curve's points
 * change them.
 */
export function runBudget(request: BudgetRequest): BudgetResult {
  const started = Date.now();
  const ctx = prepareSheet(request.spec, request.pupilSamples);
  const sheet = sheetAt(ctx, request.budgetScale);
  const sweeps = SHEET_LENSES.map((lens) => ({
    lens,
    points:
      lens === request.spec.lens
        ? couplingSweep(ctx, request.scales)
        : couplingSweep(
            prepareSheet({ ...request.spec, lens }, request.pupilSamples),
            request.scales,
          ),
  }));
  return { sheet, sweeps, elapsedMs: Date.now() - started };
}
