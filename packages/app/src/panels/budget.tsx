import { useMemo, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import {
  MARECHAL_WAVES,
  SHEET_LENSES,
  type BudgetRequest,
  type BudgetResult,
  type SheetLens,
  type SheetRow,
} from "../budget";
import {
  Choice,
  Fact,
  Fieldset,
  Guard,
  GUARD_COLOR,
  num,
  Slider,
  thresholdLevel,
  type GuardLevel,
} from "../ui";
import { createBudgetWorker } from "../workers";

/**
 * APP.md Part P — the tolerance sheet, and the second lens that says what the
 * first one's numbers were a property of.
 *
 * ## What is on screen, and why each half is here
 *
 * The **table** is a drawing. Eleven rows for the cemented triplet and eight for
 * the doublet — one per number a shop would have to hold — each priced in both
 * of § 6au's currencies, allocated in whichever of them binds it, and quoted in
 * the unit that row is actually inspected in. The centring rows carry a second
 * unit because § 6au.3 proved they are the same error twice: runout in
 * micrometres and wedge in arcminutes, α = asin(δ·c) exactly rather than by a
 * rule of thumb.
 *
 * The **curve** is the argument the table cannot make. § 6au measures that the
 * eleven rows CANCEL — applied together they cost 0.76 of the root-sum-square a
 * budget predicts — and is careful to say the factor "belongs to this lens
 * rather than to the method". One lens cannot show that; a reader has to take
 * it. So this panel always draws BOTH, and they land on opposite sides of one:
 * **the triplet's rows cancel at 0.587 and the doublet's reinforce at 1.134**,
 * each flat across three decades of budget and bending only where the pupil
 * starts losing points. An RSS budget is pessimistic on one of the two lenses
 * this repo ships and optimistic on the other, and neither is the method's
 * fault. That is § 6au's sentence turned into a measurement, and it is the
 * finding this surface exists for.
 *
 * ## Three things the panel says that a number alone would not
 *
 *  - **A colour budget never mentions the alignment, on either lens.** Every
 *    centring row's colour column reads a clean **0** — not small, zero — on the
 *    triplet and on the doublet both, because a decentred sphere is a prism and a
 *    prism has no paraxial power. So half of § 6au's headline is lens-independent
 *    and half is not: "the two currencies disagree by up to 26×" is a fact about
 *    apochromats (the doublet's columns agree to within 1.2–2.6×, its own
 *    residual colour being ten times looser), while "colour cannot see the
 *    alignment at all" is a fact about tolerancing.
 *  - **Four of the numbers on this sheet are not tolerances**, and the sheet says
 *    which. An inverse-sensitivity budget divides a target by a slope and will
 *    return a number for anything: the triplet's rear airspace comes back at
 *    3.1 mm on a 1.2 mm element and the doublet's at 30 mm on a 0.6 mm one.
 *    Those rows are the statement that neither currency constrains that
 *    parameter and the mechanical drawing does. The verdict column is not
 *    decoration — it is the difference between a budget and a list of quotients.
 *  - **The allowance is an extrapolation and the sheet re-measures it.** Every
 *    row's `lin` is the binding currency evaluated AT the allowance, over the
 *    share it was given. One means the slope reached where the budget sent it.
 *    0.68 on the triplet's rear centring row means it did not, and that row's
 *    number is not a tolerance either.
 *
 * ## What it refuses
 *
 * Walk the budget slider to the top on the triplet and rows begin to refuse
 * rather than to report: the allowance is large enough that the chief ray no
 * longer clears the glass, and `opdMap` throws from three frames down. The sheet
 * survives it row by row — one shallow-sloped row cannot cost the other ten —
 * and says which one went and why. A budget that asks for a lens the tracer
 * cannot follow is a refusal, not a large number.
 */

const APERTURES = [10, 20, 40] as const;
const FOCAL_RATIOS = [4, 6, 10] as const;
const PUPIL_SAMPLES = [11, 21, 31] as const;

/** Where the coupling curve is sampled: three decades, half a decade apart. */
const SWEEP_SCALES = [1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1] as const;

const LENS_COLOR: Record<SheetLens, string> = {
  apochromat: "#4a9eff",
  achromat: "#ff9c4a",
};

const VERDICT_LEVEL: Record<SheetRow["verdict"], GuardLevel> = {
  ok: "ok",
  loose: "warn",
  "not a tolerance": "warn",
  refused: "bad",
};

/**
 * A number in the unit its own row is inspected in, and `—` where the currency
 * has no opinion at all.
 *
 * The unit is chosen by the KIND of row rather than by the size of the number,
 * because a column that switches units partway down is a column a reader has to
 * check twice: a shop quotes runout in micrometres whether it is 39 or 103 of
 * them, and centre thickness in millimetres whether it is 0.20 or 3.1.
 */
function quote(row: SheetRow): string {
  const value = row.allowance;
  if (!Number.isFinite(value)) return "—";
  if (row.unit === "relative") return `${num(value * 100, 3)}%`;
  if (row.unit === "deg") return `${num(value * 60, 3)}′`;
  return row.label.includes("centring")
    ? `${num(value * 1000, 3)} µm`
    : `${num(value, 3)} mm`;
}

export function BudgetPanel() {
  const [lens, setLens] = useState<SheetLens>("apochromat");
  const [apertureMm, setApertureMm] = useState<number>(10);
  const [focalRatio, setFocalRatio] = useState<number>(6);
  const [pupilSamples, setPupilSamples] = useState<number>(21);
  // The slider walks the EXPONENT, because the interesting range is three
  // decades wide and the interesting behaviour is at the bottom of it.
  const [scaleExponent, setScaleExponent] = useState<number>(0);

  const budgetScale = 10 ** scaleExponent;

  const request = useMemo<BudgetRequest>(
    () => ({
      spec: { lens, apertureMm, focalRatio },
      budgetScale,
      pupilSamples,
      scales: [...SWEEP_SCALES],
    }),
    [lens, apertureMm, focalRatio, budgetScale, pupilSamples],
  );

  const { result, pending } = useLatestFromWorker<BudgetRequest, BudgetResult>(
    createBudgetWorker,
    request,
  );

  const sheet = result?.sheet ?? null;
  const drawing = sheet?.drawing ?? null;

  const series = useMemo(
    () =>
      (result?.sweeps ?? []).map((s) => ({
        label: s.lens,
        color: LENS_COLOR[s.lens],
        points: s.points.flatMap((p) =>
          p.couplingRatio === null
            ? []
            : ([[Math.log10(p.budgetScale), p.couplingRatio]] as const),
        ) as readonly (readonly [number, number])[],
        dots: s.lens === lens,
        width: s.lens === lens ? 2 : 1,
        ...(s.lens === lens ? {} : { dash: [4, 3] as const }),
      })),
    [result, lens],
  );

  const couplingLevel: GuardLevel =
    drawing === null ? "bad" : drawing.pointsDropped > 0 ? "warn" : "ok";

  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms" }}>
      <p style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 860, lineHeight: 1.7 }}>
        Every number a shop would have to hold, priced in <strong>both</strong> of
        § 6au&apos;s currencies — the blur a focuser cannot remove, and the colour a
        cemented objective was bought to not have — and quoted from whichever one
        binds it. The curve underneath is why there are two lenses here: applied
        together, the triplet&apos;s rows <strong>cancel</strong> and the
        doublet&apos;s <strong>reinforce</strong>, so a root-sum-square budget is
        pessimistic on one and optimistic on the other.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "12px 0" }}>
        <Choice label="lens" options={SHEET_LENSES} value={lens} onChange={setLens} />
        <Choice
          label="aperture"
          options={APERTURES}
          value={apertureMm}
          onChange={setApertureMm}
          format={(v) => `${v} mm`}
        />
        <Choice
          label="focal ratio"
          options={FOCAL_RATIOS}
          value={focalRatio}
          onChange={setFocalRatio}
          format={(v) => `f/${v}`}
        />
        <Choice
          label="pupil samples"
          options={PUPIL_SAMPLES}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Slider
          label={`budget ${num(budgetScale * 100, 3)}% of target`}
          min={-3}
          max={0}
          step={0.25}
          value={scaleExponent}
          onChange={setScaleExponent}
        />
      </div>

      {sheet !== null && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
          <Fact label="lens" value={`${sheet.surfaces} surfaces, ${sheet.rows.length} rows`} />
          <Fact label="focal length" value={`${num(sheet.focalLengthMm, 4)} mm`} />
          <Fact
            label="its own residual colour"
            value={sheet.nominalColour.toExponential(3)}
            note="the colour budget's target"
          />
          <Fact
            label="blur target"
            value={`${num(MARECHAL_WAVES * sheet.budgetScale, 3)} waves`}
            note="Maréchal's λ/14, times the budget above"
          />
          <Fact
            label="which currency binds"
            value={`${sheet.colourRows} colour / ${sheet.blurRows} blur`}
          />
          <Fact label="elapsed" value={`${result?.elapsedMs ?? 0} ms`} />
        </div>
      )}

      {drawing !== null ? (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
          <Guard
            label="every row at once ÷ their RSS"
            value={num(drawing.couplingRatio, 4)}
            level={couplingLevel}
            detail={
              drawing.couplingRatio < 1
                ? "below one: the rows CANCEL, and the independence estimate is pessimistic"
                : "above one: the rows REINFORCE, and the independence estimate is optimistic"
            }
          />
          <Guard
            label="the whole sheet, traced once"
            value={`${num(drawing.combinedWaves, 4)} waves`}
            level={thresholdLevel(drawing.combinedWaves, MARECHAL_WAVES)}
            detail={`against ${num(drawing.rssWaves, 4)} predicted by adding the rows in quadrature`}
          />
          <Guard
            label="common pupil support"
            value={`${drawing.pointsRetained} points`}
            level={drawing.pointsDropped > 0 ? "warn" : "ok"}
            detail={
              drawing.pointsDropped > 0
                ? `${drawing.pointsDropped} dropped — variances add exactly only over ONE support, so the ratio beside this is drifting`
                : "none dropped: every row and the combined trace are on the same points"
            }
          />
        </div>
      ) : (
        sheet !== null && (
          <div style={{ marginBottom: 16 }}>
            <Guard label="the combined trace" value="refused" level="bad" detail={sheet.refusal} />
          </div>
        )
      )}

      {sheet !== null && (
        <Fieldset title="the sheet">
          <table
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              borderCollapse: "collapse",
              lineHeight: 1.6,
            }}
          >
            <thead>
              <tr style={{ color: "#999", textAlign: "right" }}>
                <th style={{ textAlign: "left", paddingRight: 16 }}>row</th>
                <th style={{ paddingRight: 16 }}>colour ÷ target</th>
                <th style={{ paddingRight: 16 }}>blur ÷ target</th>
                <th style={{ paddingRight: 16 }}>binds</th>
                <th style={{ paddingRight: 16 }}>by</th>
                <th style={{ paddingRight: 16 }}>allowed</th>
                <th style={{ paddingRight: 16 }}>as wedge</th>
                <th style={{ paddingRight: 16 }}>lin</th>
                <th style={{ textAlign: "left" }}>reading</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.label} style={{ textAlign: "right" }}>
                  <td style={{ textAlign: "left", paddingRight: 16 }}>{row.label}</td>
                  <td style={{ paddingRight: 16, color: row.binds === "colour" ? undefined : "#999" }}>
                    {row.colourPerUnit === 0 ? "0" : num(row.colourPerUnit, 4)}
                  </td>
                  <td style={{ paddingRight: 16, color: row.binds === "blur" ? undefined : "#999" }}>
                    {num(row.blurPerUnit, 4)}
                  </td>
                  <td style={{ paddingRight: 16 }}>{row.binds}</td>
                  <td style={{ paddingRight: 16 }}>
                    {Number.isFinite(row.bindsBy) ? `${num(row.bindsBy, 3)}×` : "only"}
                  </td>
                  <td style={{ paddingRight: 16 }}>{quote(row)}</td>
                  <td style={{ paddingRight: 16 }}>
                    {row.wedgeArcmin === null ? "—" : `${num(row.wedgeArcmin, 3)}′`}
                  </td>
                  <td style={{ paddingRight: 16 }}>
                    {Number.isNaN(row.linearity) ? "—" : num(row.linearity, 3)}
                  </td>
                  <td style={{ textAlign: "left", color: GUARD_COLOR[VERDICT_LEVEL[row.verdict]] }}>
                    {row.verdict === "ok" ? "a tolerance" : row.verdict}
                    {row.note !== "" && <span style={{ color: "#777" }}> — {row.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#999", maxWidth: 860, lineHeight: 1.7 }}>
            A cemented block of <em>n</em> surfaces carries 3<em>n</em>−1 numbers and not
            4<em>n</em>−1: wedge is not a row beside centring, it is the{" "}
            <strong>same freedom in another unit</strong>. Tilting a sphere about its vertex by α
            and decentring it by δ = −R·sin α produce the same surface, and the chief ray through
            the two prescriptions is bit-for-bit identical — so the wedge column is a second
            reading of the allowance to its left, not a twelfth through fifteenth row.
          </p>
        </Fieldset>
      )}

      <Fieldset title="the coupling, against the budget it was measured at">
        <Plot
          series={series}
          markers={[
            { y: 1, color: "#666", label: "rows independent" },
            // The slider's own position, unlabelled: at its default it sits ON
            // the right-hand axis, and a label there is drawn off the plot.
            { x: scaleExponent, color: "#bbb" },
          ]}
          xLabel="budget, log₁₀ of the target"
          yLabel="every row at once ÷ their RSS"
          xMin={-3}
          xMax={0}
          yMin={0}
          yMax={1.4}
          width={720}
          height={280}
        />
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#999", maxWidth: 860, lineHeight: 1.7 }}>
          Solid with dots is the lens the table above describes; dashed is the other one, drawn
          for comparison and nothing else. Both curves are flat over the first three decades —
          which is what says the factor is a property of the lens rather than of the budget it
          was measured at — and both bend at the top, where the perturbations start clipping the
          pupil and the common support the σ&apos;s share begins to shrink. Read the bend as the
          measurement running out of domain, not as physics.
        </p>
      </Fieldset>
    </div>
  );
}
