import { useMemo, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { MARECHAL_WAVES } from "../microscope";
import { Plot, type PlotMarker, type PlotSeries } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider, thresholdLevel } from "../ui";
import {
  createCoverslipIndexWorker,
  createCoverslipPointWorker,
  createCoverslipSweepWorker,
} from "../workers";
import {
  MINIMUM_FILM_MM,
  NOMINAL_SLIP_MM,
  OIL_INDEX,
  SLIP_APERTURES,
  SLIP_INDEX,
  budgetShare,
  dryToleranceCurve,
  type IndexSweep,
  type IndexSweepRequest,
  type SigmaReadout,
  type SlipAperture,
  type SlipReadout,
  type SlipReadoutRequest,
  type SlipSweep,
  type SlipSweepRequest,
} from "../coverslip";

/**
 * The coverslip, and what mismatching it costs — APP.md's A6.
 *
 * The sixth reuse of the adapter/worker/plot pattern and the first surface in
 * the app whose subject is a piece of glass the objective does not contain. Its
 * results are sharp and entirely numeric, so this is a plot surface: three
 * curves and a readout, no picture. § 6c's headline is a **null** — at NA 0.10
 * the correction a slip demands is 400× under the objective's own residual — and
 * a panel that drew that would be drawing nothing at all.
 *
 * ## What is on screen, and which of it is a measurement
 *
 * Everything except the dry curve is traced. The delivered aperture is drawn
 * twice — closed form and traced — because they are different computations that
 * must agree, and the ray wall between them is **bisected** rather than quoted:
 * § 6e.4's 1.411 ceiling is a number in the validation ladder, not an engine
 * export, so this panel asks the tracer where it starts losing rays and reads
 * the aperture there. It comes back 1.4112.
 *
 * ## The σ curves are refused where the pupil is not whole
 *
 * A3's rule, and here it is the whole thin end of the band. `opdMap` still
 * returns an RMS when a third of the pupil is dark, and it RISES — which draws
 * as "aberration grows toward a thin slip" when what is happening is that the
 * rays have stopped existing. Every refused point is a gap in the curve and a
 * sentence in the readout, never a plotted zero.
 */

const THICKNESS_STEP_MM = 0.0005;
const MIN_THICKNESS_MM = 0.15;
const MAX_THICKNESS_MM = 0.19;
const SWEEP_POINTS = 21;

/** ±0.004 covers real batch variation and both Maréchal crossings at NA 1.40. */
const MAX_DELTA_N = 0.004;
const DELTA_N_STEP = 0.0002;
const INDEX_POINTS = 17;

/** Where the σ plots stop, in budgets. The film-pinned curve leaves the frame. */
const MAX_BUDGETS = 3;

/** The dry curve's apertures — § 6c's own 1/NA⁴ run, ending at a dry 0.95. */
const DRY_APERTURES = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

const shareOf = (sigma: SigmaReadout): number | null =>
  sigma.ok ? budgetShare(sigma.sigmaWaves) : null;

/** Points a refused σ drops out of, rather than contributing a zero to. */
function share<T>(
  points: readonly T[],
  x: (p: T) => number,
  sigma: (p: T) => SigmaReadout,
): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const p of points) {
    const s = shareOf(sigma(p));
    if (s !== null) out.push([x(p), s] as const);
  }
  return out;
}

function SigmaLine({ label, sigma }: { label: string; sigma: SigmaReadout }) {
  if (!sigma.ok) {
    return (
      <Guard
        label={label}
        value="refused"
        level={sigma.source === "app" ? "warn" : "bad"}
        detail={sigma.reason}
      />
    );
  }
  return (
    <Guard
      label={label}
      value={`${sigma.sigmaWaves.toFixed(5)} waves — ${budgetShare(sigma.sigmaWaves).toFixed(2)}× the budget`}
      level={thresholdLevel(budgetShare(sigma.sigmaWaves), 1)}
      detail={`best focus at ${sigma.focusOffsetMm.toFixed(4)} mm from the last vertex`}
    />
  );
}

/** σ against slip thickness, both refocus models, with both walls marked. */
function ThicknessPlot({
  sweep,
  thicknessMm,
}: {
  sweep: SlipSweep;
  thicknessMm: number;
}) {
  const p = sweep.points;
  const series: PlotSeries[] = [
    {
      label: "refocused — the objective moves",
      color: "#111",
      points: share(p, (q) => q.thicknessMm, (q) => q.refocused),
      dots: true,
      width: 2,
    },
    {
      label: "film pinned — image side only",
      color: "#c00",
      points: share(p, (q) => q.thicknessMm, (q) => q.pinned),
      dash: [5, 4],
    },
  ];
  // Three vertical rules within 30 µm of each other, and `Plot` writes every
  // label at the same height — so only the two walls are named, and the
  // slider's own rule is left unlabelled because the control above already
  // reads it out. Both wall names are short for the same reason.
  const markers: PlotMarker[] = [
    { y: 1, color: "#a60", label: "Maréchal λ/14" },
    { x: thicknessMm, color: "#06a" },
    { x: sweep.filmWallThicknessMm, color: "#777", label: "film out" },
  ];
  if (sweep.rayWall) {
    markers.push({ x: sweep.rayWall.thicknessMm, color: "#777", label: "rays stop" });
  }
  return (
    <Plot
      series={series}
      markers={markers}
      xLabel="cover slip thickness (mm) — nominal 0.17"
      yLabel="σ, in Maréchal budgets (λ/14)"
      xMin={MIN_THICKNESS_MM}
      xMax={MAX_THICKNESS_MM}
      yMin={0}
      yMax={MAX_BUDGETS}
    />
  );
}

/** The delivered aperture: closed form, traced, and the wall between them. */
function AperturePlot({
  sweep,
  numericalAperture,
  thicknessMm,
}: {
  sweep: SlipSweep;
  numericalAperture: number;
  thicknessMm: number;
}) {
  const p = sweep.points;
  const traced: (readonly [number, number])[] = [];
  for (const q of p) if (q.deliveredNa !== null) traced.push([q.thicknessMm, q.deliveredNa]);
  const predicted = p.map((q) => [q.thicknessMm, q.predictedNa] as const);
  const lo = Math.min(...predicted.map(([, y]) => y));
  const hi = Math.max(...predicted.map(([, y]) => y));
  const pad = 0.1 * (hi - lo);
  const markers: PlotMarker[] = [
    { y: numericalAperture, color: "#a60", label: `engraved ${numericalAperture.toFixed(2)}` },
    { x: thicknessMm, color: "#06a" },
  ];
  if (sweep.rayWall) {
    markers.push({
      y: sweep.rayWall.deliveredNa,
      color: "#c00",
      label: `wall ${sweep.rayWall.deliveredNa.toFixed(4)}`,
    });
  }
  return (
    <Plot
      series={[
        {
          label: "n_slip·h/√(t²+h²) — closed form",
          color: "#06a",
          points: predicted,
          dash: [5, 4],
          width: 2.4,
        },
        { label: "traced", color: "#111", points: traced, dots: true, width: 1.2 },
      ]}
      markers={markers}
      xLabel="cover slip thickness (mm)"
      yLabel="delivered NA = n·sin u at the specimen"
      xMin={MIN_THICKNESS_MM}
      xMax={MAX_THICKNESS_MM}
      yMin={lo - pad}
      yMax={hi + pad}
    />
  );
}

/** σ against the slip's index — the axis no refocus reaches. */
function IndexPlot({ sweep, deltaN }: { sweep: IndexSweep; deltaN: number }) {
  const p = sweep.points;
  return (
    <Plot
      series={[
        {
          label: "refocused for the apparent-distance change",
          color: "#111",
          points: share(p, (q) => q.deltaN, (q) => q.refocused),
          dots: true,
          width: 2,
        },
        {
          label: "film pinned (§ 6e.5's own rung)",
          color: "#c00",
          points: share(p, (q) => q.deltaN, (q) => q.pinned),
          dash: [5, 4],
        },
      ]}
      markers={[
        { y: 1, color: "#a60", label: "Maréchal λ/14" },
        { x: deltaN, color: "#06a", label: `Δn ${deltaN >= 0 ? "+" : ""}${deltaN.toFixed(4)}` },
      ]}
      xLabel={`slip index − ${SLIP_INDEX.toFixed(4)} (D263 at the d line)`}
      yLabel="σ, in Maréchal budgets (λ/14)"
      xMin={-MAX_DELTA_N}
      xMax={MAX_DELTA_N}
      yMin={0}
      yMax={MAX_BUDGETS}
    />
  );
}

/**
 * The DRY story, closed form: how far a slip may stray, as 1/NA⁴.
 *
 * Plotted as log₁₀ µm because the quantity runs four decades over the aperture
 * range it is interesting on — 31 mm at NA 0.10 to 3.9 µm at 0.95. The
 * transform is on the VALUE, not on the drawing: `Plot` interpolates nothing,
 * and a log axis drawn by smoothing a linear one would be a picture of a claim.
 */
function DryTolerancePlot() {
  const curve = useMemo(() => dryToleranceCurve(DRY_APERTURES), []);
  return (
    <Plot
      series={[
        {
          label: "Rayleigh λ/4 on W₀₄₀",
          color: "#111",
          points: curve.map((q) => [q.numericalAperture, Math.log10(q.quarterWaveUm)] as const),
          dots: true,
          width: 2,
        },
        {
          label: "Maréchal on the balanced residual",
          color: "#06a",
          points: curve.map((q) => [q.numericalAperture, Math.log10(q.marechalUm)] as const),
          dash: [5, 4],
        },
      ]}
      markers={[
        { y: Math.log10(NOMINAL_SLIP_MM * 1000), color: "#a60", label: "a whole 0.17 mm slip" },
      ]}
      xLabel="dry objective NA"
      yLabel="log₁₀ of the slip error the budget allows (µm)"
      xMin={0}
      xMax={1}
      yMin={0.5}
      yMax={5.2}
    />
  );
}

export function CoverslipPanel() {
  const [numericalAperture, setAperture] = useState<SlipAperture>(1.4);
  const [pupilSamples, setPupilSamples] = useState(21);
  const [thicknessMm, setThickness] = useState(NOMINAL_SLIP_MM);
  const [deltaN, setDeltaN] = useState(0);

  // Keyed on the objective and the sampling, and on NOTHING the sliders touch:
  // these are seconds, and the sliders move a dashed line and a readout.
  const sweepRequest = useMemo<SlipSweepRequest>(
    () => ({
      numericalAperture,
      minThicknessMm: MIN_THICKNESS_MM,
      maxThicknessMm: MAX_THICKNESS_MM,
      points: SWEEP_POINTS,
      pupilSamples,
    }),
    [numericalAperture, pupilSamples],
  );
  const indexRequest = useMemo<IndexSweepRequest>(
    () => ({ numericalAperture, maxDeltaN: MAX_DELTA_N, points: INDEX_POINTS, pupilSamples }),
    [numericalAperture, pupilSamples],
  );
  const readoutRequest = useMemo<SlipReadoutRequest>(
    () => ({ numericalAperture, thicknessMm, deltaN, pupilSamples }),
    [numericalAperture, thicknessMm, deltaN, pupilSamples],
  );

  const sweep = useLatestFromWorker<SlipSweepRequest, SlipSweep>(
    createCoverslipSweepWorker,
    sweepRequest,
  );
  const index = useLatestFromWorker<IndexSweepRequest, IndexSweep>(
    createCoverslipIndexWorker,
    indexRequest,
  );
  const point = useLatestFromWorker<SlipReadoutRequest, SlipReadout>(
    createCoverslipPointWorker,
    readoutRequest,
  );

  const readout = point.result;
  const filmUm = readout ? readout.filmMm * 1000 : null;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The coverslip: a plate the objective does not control</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The <strong>0.17</strong> in <code>160/0.17</code>. A cover glass has no power and no
        first-order effect on anything, and it is still engraved on every objective, because a
        plate in a steeply convergent beam carries spherical aberration — and the beam between a
        specimen and an objective is the steepest one in the instrument. § 6e.4 found the slip is
        carrying part of the <em>correction</em> of the 100×/1.40 oil: its aberration has the
        opposite sign to the Lister residual behind it, so the objective with its slip is better
        corrected than the same objective in a perfectly matched bath. That makes the flagship&rsquo;s
        performance depend on a piece of glass it does not contain, which is what this panel
        measures.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        <strong>The modelling choice decides every number here, so it is a control.</strong> A real
        immersion objective is focused by <em>moving it</em>, which changes the thickness of the oil
        film — the film IS the focus knob. Refocusing on the image side alone, with the film pinned,
        is not a conservative assumption; it is a different instrument, and it is wrong by an order
        of magnitude. Both curves are drawn: the black one refocuses the way the instrument does
        (hold the stack&rsquo;s paraxial apparent distance — one evaluation, no search), the red one
        does not.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label="objective — 100× oil, § 6e.4"
          options={SLIP_APERTURES}
          value={numericalAperture}
          onChange={setAperture}
          format={(na) => `NA ${na.toFixed(2)}`}
        />
        <Choice
          label={`pupil samples ${pupilSamples} across the diameter`}
          options={[15, 21]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Slider
          label={`slip ${(thicknessMm * 1000).toFixed(1)} µm${
            thicknessMm === NOMINAL_SLIP_MM ? " (nominal)" : ""
          }`}
          min={MIN_THICKNESS_MM}
          max={MAX_THICKNESS_MM}
          step={THICKNESS_STEP_MM}
          value={thicknessMm}
          onChange={setThickness}
        />
        <Slider
          label={`slip index ${(SLIP_INDEX + deltaN).toFixed(4)} (Δn ${deltaN >= 0 ? "+" : ""}${deltaN.toFixed(4)})`}
          min={-MAX_DELTA_N}
          max={MAX_DELTA_N}
          step={DELTA_N_STEP}
          value={deltaN}
          onChange={setDeltaN}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          opacity: point.pending ? 0.55 : 1,
          transition: "opacity 120ms ease-out",
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, width: 420 }}>
          {readout === null ? (
            <span>tracing the slip…</span>
          ) : (
            <>
              <SigmaLine label="σ, objective moved:" sigma={readout.refocused} />
              <SigmaLine label="σ, film pinned:" sigma={readout.pinned} />
              <Guard
                label="oil film the refocus asks for:"
                value={`${filmUm!.toFixed(2)} µm`}
                level={
                  readout.filmMm < MINIMUM_FILM_MM
                    ? "bad"
                    : thresholdLevel(MINIMUM_FILM_MM / readout.filmMm, 1)
                }
                detail={`nominal ${(readout.nominalFilmMm * 1000).toFixed(1)} µm · the specimen's apparent position moved ${readout.apparentShiftUm >= 0 ? "+" : ""}${readout.apparentShiftUm.toFixed(3)} µm`}
              />
              <Guard
                label="delivered NA:"
                value={
                  readout.deliveredNa === null
                    ? `${readout.predictedNa.toFixed(5)} (closed form only)`
                    : readout.deliveredNa.toFixed(5)
                }
                level={
                  sweep.result?.rayWall && readout.predictedNa >= sweep.result.rayWall.deliveredNa
                    ? "bad"
                    : "ok"
                }
                detail={`closed form ${readout.predictedNa.toFixed(5)} · engraved ${numericalAperture.toFixed(2)} — a thinner slip delivers MORE aperture`}
              />
              <span style={{ color: "#777" }}>
                the oil layer&rsquo;s own W₀₄₀ is {readout.oilW040Waves.toFixed(4)} waves — negative,
                because the oil (n {OIL_INDEX.toFixed(4)}) is rarer than the glass either side of it
                <br />
                {readout.elapsedMs.toFixed(0)} ms
              </span>
            </>
          )}
        </div>
        <div style={{ maxWidth: 640, fontSize: 13, color: "#666" }}>
          <p style={{ marginTop: 0 }}>
            <strong>Thickness costs no aberration at all.</strong> The slip and the objective&rsquo;s
            front element are both D263, so the layer&rsquo;s (n² − n_out²) factor is identically
            zero and a thickness error contributes an <em>exact</em> zero to the stack&rsquo;s
            wavefront — not a small number, a hard one. What is left is a pure axial displacement of
            the specimen, and refocusing is precisely the operation that removes one. That is why
            the black curve is nearly flat at NA 1.00 and the red one is a cliff.
          </p>
          <p>
            <strong>What thickness does change is the aperture.</strong> The rims are fixed glass,
            sized from a nominal slip, and the specimen sits on the slip&rsquo;s underside — so a
            thinner slip puts it <em>closer</em> to those rims and the same rim subtends a wider
            cone. Signed the surprising way, and it is what ends the band.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ opacity: sweep.pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
          {sweep.result === null ? (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
              sweeping the No. 1.5 band…
            </p>
          ) : (
            <>
              <ThicknessPlot sweep={sweep.result} thicknessMm={thicknessMm} />
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#777",
                  width: 420,
                  marginTop: 4,
                }}
              >
                {sweep.result.rayWall
                  ? `rays stop existing below ${(sweep.result.rayWall.thicknessMm * 1000).toFixed(1)} µm, where the delivered NA reaches ${sweep.result.rayWall.deliveredNa.toFixed(4)} — bisected, not quoted`
                  : "no ray is lost anywhere in the band at this aperture"}{" "}
                · the film runs out above{" "}
                {(sweep.result.filmWallThicknessMm * 1000).toFixed(1)} µm ·{" "}
                {sweep.result.elapsedMs.toFixed(0)} ms
              </p>
            </>
          )}
        </div>
        <div style={{ opacity: sweep.pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
          {sweep.result !== null && (
            <>
              <AperturePlot
                sweep={sweep.result}
                numericalAperture={numericalAperture}
                thicknessMm={thicknessMm}
              />
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#777",
                  width: 420,
                  marginTop: 4,
                }}
              >
                two different computations of one aperture: § 6e.2&rsquo;s plane-layer height read
                backwards, and the marginal ray&rsquo;s own launch angle out of the trace. The
                traced series stops where the rays do.
              </p>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginTop: 24,
        }}
      >
        <div style={{ opacity: index.pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
          {index.result === null ? (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
              sweeping the slip&rsquo;s index…
            </p>
          ) : (
            <>
              <IndexPlot sweep={index.result} deltaN={deltaN} />
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#777",
                  width: 420,
                  marginTop: 4,
                }}
              >
                the binding tolerance. Both curves are drawn because a wrong index <em>does</em>{" "}
                shift the apparent distance — so there is a refocus to try, and trying it barely
                moves the answer. {index.result.elapsedMs.toFixed(0)} ms
              </p>
            </>
          )}
        </div>
        <div>
          <DryTolerancePlot />
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "#777",
              width: 420,
              marginTop: 4,
            }}
          >
            closed form, no trace — `coverslipTolerance`, both criteria, 1/NA⁴. The two differ by a
            constant 3.833 = 24√5/14, which is why quoting the wrong one is a factor of four.
          </p>
        </div>
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 640 }}>
        <strong>Both ends of the band are geometric, and neither is aberration.</strong> Thin the
        slip and the delivered aperture climbs into § 6e.4&rsquo;s own ceiling: the tracer starts
        losing rays, and every σ over an incomplete pupil is{" "}
        <span style={{ color: GUARD_COLOR.warn }}>refused</span> rather than drawn — it still has a
        value, it still <em>rises</em>, and it is a number about a pupil that is a third dark.
        Thicken it and the refocus asks for less oil than there is: at 0.19 mm the closed form wants
        0.11 µm of film, which is optical contact. The wavefront is comfortably inside budget at
        both walls. This is the fifth time this branch has met a wall that is a piece of geometry
        rather than an aberration, after § 6b&rsquo;s f/4.1, § 6d&rsquo;s NA 0.343, § 6e.4&rsquo;s
        NA 1.411 and § 6q&rsquo;s 0.88·f_e.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 640 }}>
        <strong>The σ minimum is not at the nominal slip</strong>, and the third readout says why.
        The oil is the only mismatched layer in the stack, and it is <em>rarer</em> than the glass
        either side of it, so its W₀₄₀ is negative — the opposite sign to the Lister residual behind
        it. Refocusing a thinner slip <em>thickens</em> the film, which buys more of that
        cancellation, so at NA 1.40 the best slip in the band is about 5 µm under nominal and the
        curve turns over before the rays run out. § 6e.4&rsquo;s &ldquo;the slip helps&rdquo; is
        this, with the film as the knob — and the index slider is the same mechanism on the other
        axis, since a slightly <em>rarer</em> slip adds negative aberration too. Neither is a
        recommendation: § 6e.5 records the same kind of gain in the placement solve and deliberately
        does not act on it, because moving it re-solves every number in the design.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 640 }}>
        The dry curve on the right is the reason none of this matters at 4×. The tolerance runs as
        1/NA⁴, from <strong>31 mm</strong> at NA 0.10 — 180× a whole cover slip, so a 4×/0.10 cannot
        tell whether one is there — to <strong>3.9 µm</strong> at NA 0.95, where a dry objective is
        the hardest instrument in a catalogue to use. λ/14 and Maréchal is 3.833× looser than
        Rayleigh&rsquo;s λ/4 at every aperture, because a microscope&rsquo;s focus knob really does
        buy back most of the damage; the literature quotes both, and they are easy to confuse.
      </p>
    </>
  );
}
