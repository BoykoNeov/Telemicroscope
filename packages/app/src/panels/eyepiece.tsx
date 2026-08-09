import { useMemo, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { MICROSCOPE_CATALOG, type MicroscopeKind } from "../microscope";
import { Plot, type PlotMarker, type PlotSeries } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider, thresholdLevel } from "../ui";
import { createEyepieceSweepWorker, createEyepieceWallWorker } from "../workers";
import {
  DEFAULT_NEAR_POINT_MM,
  EYEPIECE_FORMS,
  NEAR_POINTS,
  NOTICEABLE_DIOPTERS,
  describeInstrument,
  type EyepieceForm,
  type InstrumentReadout,
  type Sweep,
  type SweepRequest,
  type Wall,
  type WallRequest,
} from "../eyepiece";
import { visualDetailRatio } from "@telemicroscope/core/pupil";

/**
 * The eyepiece on the intermediate image — APP.md's D6, and the panel § 6q had
 * been waiting for.
 *
 * The seventh reuse of the adapter/worker/plot pattern, and the surface that
 * makes the branch's chain end at an **eye** rather than at an image. There is
 * no picture here for a reason that is not a shortfall: the exit beam of a
 * visual microscope is collimated, so there is no image plane to render — the
 * retinal PSF is § 6q's own named open item. What § 6q produced instead is a
 * null and two invariances, and APP.md's third constraint says pair every one of
 * those with a plot.
 *
 * ## The three things on screen that are easy to get wrong, and how they are put
 *
 * 1. **"Traced" is reserved for real rays.** The magnification is a real chief
 *    ray's exit angle and the engraved NA is a real marginal ray's launch sine.
 *    The exit pupil is the aperture stop imaged *paraxially* through the
 *    eyepiece, and the NA the Lagrange invariant takes is n·u off that same
 *    pupil geometry — so those two agreeing is one bookkeeping being
 *    self-consistent, which is what § 6q.5 pins and is weaker than two
 *    independent routes agreeing. Every label below says which it is.
 * 2. **The textbook exit pupil is drawn, wrong, on purpose.** `500·NA/M` is the
 *    Lagrange invariant fed the engraved sine NA, and the invariant is a law
 *    about paraxial slopes. It misses by 0.50% at NA 0.10 and by 61% at NA 1.40,
 *    where the paraxial figure is 3.55 — larger than the immersion oil's own
 *    index, so not a physically realizable aperture at all. Both forms are
 *    plotted and `sec u` is the guard that says when they part company.
 * 3. **The negative control is live.** § 6q.3's +70.5 D is not quoted: the same
 *    two modules are re-spliced at `afocalTelescope`'s own gap and the vergence
 *    is read off the trace, for whatever the reader has selected.
 *
 * ## Scheduling, and why it differs from every microscope panel since A2
 *
 * The readout is on the **main thread** — ~8 ms — because § 6q's composition is
 * one affine solve with no FFT and no pupil sum. The two workers are both sweeps
 * of *builds*: 21 eyepiece solves for the focal-length sweep, ~14 more for the
 * clear-aperture wall. The panel prints its own elapsed time, so the claim that
 * this fits under a live slider is checkable rather than asserted.
 */

const FE_MIN_MM = 8;
const FE_MAX_MM = 50;
const FE_STEP_MM = 0.5;
const SWEEP_POINTS = 21;

const FN_MIN_MM = 4;
const FN_MAX_MM = 30;
const FN_STEP_MM = 0.5;

/** 2–3 mm photopic, up to ~7 mm dark-adapted — `ReducedEyeSpec`'s own range. */
const EYE_PUPIL_MIN_MM = 1.5;
const EYE_PUPIL_MAX_MM = 7;

const FORM_LABEL: Record<EyepieceForm, string> = {
  plossl: "Plössl (§ 5m)",
  huygens: "Huygens (§ 5o)",
};

const signed = (value: number, digits = 3): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

/**
 * Empty magnification, as the invariance it is rather than as the 500–1000·NA
 * rule it explains.
 *
 * The ratio is computed here and not in the worker, and that is the scheduling
 * decision: the working pupil is min(exit pupil, iris) — literally what
 * `visualMicroscopeSystem` returns — so the iris slider moves the crossover
 * live while the 21 eyepiece solves behind the curve stay keyed on the optics.
 */
function EmptyMagnificationPlot({
  sweep,
  eyePupilMm,
  nearPointMm,
  readout,
}: {
  sweep: Sweep;
  eyePupilMm: number;
  nearPointMm: number;
  readout: InstrumentReadout | null;
}) {
  const points = sweep.points.map(
    (p) =>
      [
        p.magnification,
        visualDetailRatio(
          p.magnification,
          p.naParaxial,
          nearPointMm,
          Math.min(p.exitPupilDiameterMm, eyePupilMm),
        ),
      ] as const,
  );
  const magnifications = sweep.points.map((p) => p.magnification);
  const markers: PlotMarker[] = [{ y: 1, color: "#a60", label: "the crossover" }];
  if (readout) {
    markers.push(
      { x: readout.usefulMagnification.min, color: "#777", label: "500·NA" },
      { x: readout.usefulMagnification.max, color: "#777", label: "1000·NA" },
      { x: Math.abs(readout.visualMagnification), color: "#06a" },
    );
  }
  return (
    <Plot
      series={[
        {
          label: "|M|·p / (2·NA·D), p = min(exit pupil, iris)",
          color: "#111",
          points,
          dots: true,
          width: 2,
        },
      ]}
      markers={markers}
      xLabel="|M| — the traced chief ray's, as the eyepiece is changed"
      yLabel="what the objective delivers ÷ what the eye can carry"
      xMin={Math.min(...magnifications)}
      xMax={Math.max(...magnifications)}
      yMin={0}
      yMax={1.25}
    />
  );
}

/** The exit pupil, and which numerical aperture the invariant takes. */
function ExitPupilPlot({
  sweep,
  eyePupilMm,
  readout,
}: {
  sweep: Sweep;
  eyePupilMm: number;
  readout: InstrumentReadout | null;
}) {
  const magnifications = sweep.points.map((p) => p.magnification);
  const series: PlotSeries[] = [
    {
      label: "the stop imaged through the eyepiece (paraxial)",
      color: "#111",
      points: sweep.points.map((p) => [p.magnification, p.exitPupilDiameterMm] as const),
      dots: true,
      width: 2,
    },
    {
      label: "D·NA_paraxial / |M| — the invariant's own NA",
      color: "#06a",
      points: sweep.points.map((p) => [p.magnification, p.lagrangeParaxialMm] as const),
      dash: [6, 4],
      width: 2.4,
    },
    {
      label: "D·NA_engraved / |M| — the textbook 500·NA/M",
      color: "#c00",
      points: sweep.points.map((p) => [p.magnification, p.lagrangeEngravedMm] as const),
      dash: [2, 3],
      width: 1.6,
    },
  ];
  const top = Math.max(
    eyePupilMm,
    ...sweep.points.map((p) => Math.max(p.exitPupilDiameterMm, p.lagrangeParaxialMm)),
  );
  const markers: PlotMarker[] = [
    { y: eyePupilMm, color: "#a60", label: `the iris, ${eyePupilMm.toFixed(1)} mm` },
  ];
  if (readout) markers.push({ x: Math.abs(readout.visualMagnification), color: "#06a" });
  return (
    <Plot
      series={series}
      markers={markers}
      xLabel="|M|"
      yLabel="exit pupil diameter (mm)"
      xMin={Math.min(...magnifications)}
      xMax={Math.max(...magnifications)}
      yMin={0}
      yMax={top * 1.1}
    />
  );
}

/** What departing from the solved gap costs, in the currency an observer feels. */
function PlacementPlot({ readout }: { readout: InstrumentReadout }) {
  const window = Math.abs(readout.gapCurve[0]!.deltaMm);
  const inside = readout.gapCurve.filter((p) => Math.abs(p.diopters) <= 4 * NOTICEABLE_DIOPTERS);
  const yMax = 4 * NOTICEABLE_DIOPTERS;
  return (
    <Plot
      series={[
        {
          label: "traced vergence of the exit beam",
          color: "#111",
          points: inside.map((p) => [p.deltaMm, p.diopters] as const),
          dots: true,
          width: 2,
        },
        {
          label: "1000·Δ/f_e² — the thin-lens form, as a label",
          color: "#06a",
          points: readout.gapCurve.map((p) => [p.deltaMm, p.newtonDiopters] as const),
          dash: [6, 4],
        },
      ]}
      markers={[
        { y: NOTICEABLE_DIOPTERS, color: "#a60", label: "a quarter diopter" },
        { y: -NOTICEABLE_DIOPTERS, color: "#a60" },
        { x: readout.bandPlusMm, color: "#777" },
        { x: readout.bandMinusMm, color: "#777" },
      ]}
      xLabel="eyepiece displacement from its solved position (mm)"
      yLabel="exit vergence (diopters) — + converges, − diverges"
      xMin={-window}
      xMax={window}
      yMin={-yMax}
      yMax={yMax}
    />
  );
}

/** Eye relief against magnification — the classic complaint about high power. */
function EyeReliefPlot({ sweep, readout }: { sweep: Sweep; readout: InstrumentReadout | null }) {
  const magnifications = sweep.points.map((p) => p.magnification);
  const reliefs = sweep.points.map((p) => p.eyeReliefMm);
  const markers: PlotMarker[] = [];
  if (readout) markers.push({ x: Math.abs(readout.visualMagnification), color: "#06a" });
  return (
    <Plot
      series={[
        {
          label: "eye lens vertex → exit pupil (mm)",
          color: "#111",
          points: sweep.points.map((p) => [p.magnification, p.eyeReliefMm] as const),
          dots: true,
          width: 2,
        },
      ]}
      markers={markers}
      xLabel="|M|"
      yLabel="eye relief (mm)"
      xMin={Math.min(...magnifications)}
      xMax={Math.max(...magnifications)}
      yMin={0}
      yMax={Math.max(...reliefs) * 1.15}
    />
  );
}

function WallLine({ wall, focalLengthMm }: { wall: Wall | null; focalLengthMm: number }) {
  if (wall === null) {
    return <Guard label="clear-aperture wall:" value="bisecting…" level="warn" />;
  }
  if (wall.clearApertureMm === null) {
    return (
      <Guard
        label="clear-aperture wall:"
        value={`none below ${wall.searchedToPerFocalLength.toFixed(2)}·f_e`}
        level="ok"
        detail={`this form builds at ${(wall.searchedToPerFocalLength * focalLengthMm).toFixed(1)} mm of glass — the search stopped there rather than finding an edge`}
      />
    );
  }
  return (
    <Guard
      label="clear-aperture wall:"
      value={`${wall.clearApertureMm.toFixed(3)} mm = ${wall.perFocalLength!.toFixed(6)}·f_e`}
      level="ok"
      detail={`bisected to ${wall.bracketMm.toExponential(1)} mm · a field number past it is refused by the doublet solve, not by this panel`}
    />
  );
}

export function EyepiecePanel() {
  const [kind, setKind] = useState<MicroscopeKind>("din-4x-010");
  const [form, setForm] = useState<EyepieceForm>("plossl");
  const [focalLengthMm, setFocalLength] = useState(25);
  const [fieldStop, setFieldStop] = useState(true);
  const [fieldNumberMm, setFieldNumber] = useState(20);
  const [eyePupilMm, setEyePupil] = useState(2);
  const [nearPointMm, setNearPoint] = useState<number>(DEFAULT_NEAR_POINT_MM);

  // ~8 ms, so it runs where the sliders are rather than behind a worker. The
  // whole of § 6q is first-order work: one affine gap solve, one chief ray, one
  // marginal ray and a paraxial pupil image.
  const instrument = useMemo(
    () =>
      describeInstrument({
        kind,
        form,
        eyepieceFocalLengthMm: focalLengthMm,
        fieldNumberMm: fieldStop ? fieldNumberMm : null,
        nearPointMm,
        eyePupilMm,
      }),
    [kind, form, focalLengthMm, fieldStop, fieldNumberMm, nearPointMm, eyePupilMm],
  );

  // Keyed on the optics alone — NOT on the iris, and not on the field number.
  const sweepRequest = useMemo<SweepRequest>(
    () => ({
      kind,
      form,
      nearPointMm,
      minFocalLengthMm: FE_MIN_MM,
      maxFocalLengthMm: FE_MAX_MM,
      points: SWEEP_POINTS,
    }),
    [kind, form, nearPointMm],
  );
  const wallRequest = useMemo<WallRequest>(
    () => ({ form, focalLengthMm }),
    [form, focalLengthMm],
  );

  const sweep = useLatestFromWorker<SweepRequest, Sweep>(createEyepieceSweepWorker, sweepRequest);
  const wall = useLatestFromWorker<WallRequest, Wall>(createEyepieceWallWorker, wallRequest);

  const readout = instrument.ok ? instrument.readout : null;
  const entry = MICROSCOPE_CATALOG.find((e) => e.kind === kind)!;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The eyepiece: the chain ends at an eye, not at an image</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Every other microscope surface in this app ends at a plane where an image is formed. A
        microscope you <em>look through</em> does not: the eyepiece collimates the intermediate
        image, so the instrument hands the observer a parallel beam and the last lens in the chain
        is the eye. The blocker was one line — <code>afocalTelescope</code> solves its group spacing
        from a ray entering <em>collimated</em>, which is what a telescope objective sees and what a
        microscope eyepiece never does, since the image it collimates sits a finite distance in
        front of it. <code>collimatingGap</code> is that solve, and it is affine in the gap, so it
        is exact rather than iterative.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>Nothing here is rendered, and that is the physics rather than a shortfall.</strong>{" "}
        There is no image plane behind an afocal exit — the retinal PSF is § 6q&rsquo;s own open
        item. What the step produced is a null (the exit beam is flat to f64 noise) and two
        invariances, so this is a plot surface: four curves, and a control that walks each of them
        into a wall.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 8 }}>
        <Choice
          label="objective — A1's catalogue"
          options={MICROSCOPE_CATALOG.map((e) => e.kind)}
          value={kind}
          onChange={setKind}
          format={(k) => MICROSCOPE_CATALOG.find((e) => e.kind === k)!.label}
        />
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label="eyepiece form"
          options={EYEPIECE_FORMS}
          value={form}
          onChange={setForm}
          format={(f) => FORM_LABEL[f]}
        />
        <Slider
          label={`f_e ${focalLengthMm.toFixed(1)} mm`}
          min={FE_MIN_MM}
          max={FE_MAX_MM}
          step={FE_STEP_MM}
          value={focalLengthMm}
          onChange={setFocalLength}
        />
        <Choice
          label="field stop at the intermediate image"
          options={["yes", "no"] as const}
          value={fieldStop ? "yes" : "no"}
          onChange={(v) => setFieldStop(v === "yes")}
        />
        <Slider
          label={`field number ${fieldNumberMm.toFixed(1)} mm`}
          min={FN_MIN_MM}
          max={FN_MAX_MM}
          step={FN_STEP_MM}
          value={fieldNumberMm}
          onChange={setFieldNumber}
        />
        <Slider
          label={`eye pupil ${eyePupilMm.toFixed(1)} mm`}
          min={EYE_PUPIL_MIN_MM}
          max={EYE_PUPIL_MAX_MM}
          step={0.1}
          value={eyePupilMm}
          onChange={setEyePupil}
        />
        <Choice
          label="near point (a convention, not a law)"
          options={NEAR_POINTS}
          value={nearPointMm}
          onChange={setNearPoint}
          format={(d) => `${d} mm`}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, width: 440 }}>
          {!instrument.ok ? (
            <Guard
              label={`the ${instrument.stage} refused:`}
              value={instrument.source === "engine" ? "no such design" : "not expressible"}
              level={instrument.source === "engine" ? "bad" : "warn"}
              detail={instrument.error}
            />
          ) : (
            <>
              <Guard
                label="exit vergence:"
                value={`${readout!.vergenceDiopters.toExponential(2)} D`}
                level={thresholdLevel(Math.abs(readout!.vergenceDiopters), NOTICEABLE_DIOPTERS)}
                detail={`collimated for a relaxed eye. The gap solve is affine, so this is f64 noise and not a converged residual — the closed form (image distance + the eyepiece's own front focal distance) agrees to ${Math.abs(readout!.gapMm / readout!.gapFromFrontFocalDistanceMm - 1).toExponential(1)}`}
              />
              {readout!.telescope.ok ? (
                <Guard
                  label="the telescope's own gap, same two modules:"
                  value={`${signed(readout!.telescope.diopters, 1)} D`}
                  level="bad"
                  detail={`${signed(readout!.telescope.gapErrorMm, 1)} mm of gap. The SIGN is the diagnosis: positive means the exit beam converges to a real point ${readout!.telescope.crossingMm.toFixed(1)} mm past the eye lens — the side no accommodation reaches, since accommodation only adds positive power`}
                />
              ) : (
                <Guard
                  label="the telescope's own gap, same two modules:"
                  value="refused — there is no such spacing"
                  level="bad"
                  detail={`${readout!.telescope.reason} — the CONTROL failed, not the instrument beside it. On a short-focus objective the collimated-in solve asks for a negative separation, so here § 6q.3's point arrives one step earlier: the telescope's placement is not merely unusable, it does not exist`}
                />
              )}
              <Guard
                label="visual magnification, traced chief ray:"
                value={`${readout!.visualMagnification.toFixed(2)}×`}
                level="ok"
                detail={`M_obj × (D/f_e) = ${readout!.nominalVisualMagnification.toFixed(2)}, and the trace is ${Math.abs(Math.abs(readout!.visualMagnification) / readout!.nominalVisualMagnification - 1).toExponential(1)} from it. Negative because a compound microscope inverts — the sign is pinned against a magnifier, which reads +D/f erect`}
              />
              <Guard
                label="exit pupil, stop imaged paraxially:"
                value={`${readout!.exitPupilDiameterMm.toFixed(4)} mm`}
                level="ok"
                detail={`D·NA_paraxial/|M| = ${readout!.lagrangeParaxialMm.toFixed(4)} mm (the invariant in its own NA) · D·NA_engraved/|M| = ${readout!.lagrangeEngravedMm.toFixed(4)} mm, the textbook 500·NA/M, off by ${(100 * readout!.engravedMiss).toFixed(2)}%`}
              />
              <Guard
                label="sec u = NA_paraxial / NA_engraved:"
                value={readout!.secU.toFixed(4)}
                level={thresholdLevel(readout!.secU - 1, 0.1)}
                detail={`n·u ${readout!.naParaxial.toFixed(4)} against n·sin u ${readout!.naEngraved.toFixed(4)}. The Lagrange invariant is a law about paraxial SLOPES; the engraving is a sine. Where this leaves 1, "exit pupil = 500·NA/M" and the useful range ${readout!.usefulMagnification.min.toFixed(0)}–${readout!.usefulMagnification.max.toFixed(0)}× stop being about the same aperture`}
              />
              <Guard
                label="eye relief:"
                value={`${readout!.eyeReliefMm.toFixed(2)} mm`}
                level="ok"
                detail={`where the observer's iris belongs — the exit pupil's distance from the eye lens, roughly proportional to f_e`}
              />
              <Guard
                label={readout!.irisLimited ? "the IRIS carries the beam:" : "the INSTRUMENT carries the beam:"}
                value={`${readout!.workingPupilMm.toFixed(4)} mm`}
                level="ok"
                detail={`exit pupil ${readout!.exitPupilDiameterMm.toFixed(4)} mm against an iris of ${readout!.eyePupilMm.toFixed(1)} mm, and which one wins comes from limiting-stop selection on the composed trace rather than from taking the smaller`}
              />
              <Guard
                label="detail ratio:"
                value={readout!.detailRatio.toFixed(6)}
                level={readout!.detailRatio >= 1 - 1e-6 ? "warn" : "ok"}
                detail={
                  readout!.detailRatio >= 1 - 1e-6
                    ? "past the crossover: the working pupil IS the exit pupil, which shrinks exactly as fast as M grows, so the M cancels and more magnification cannot change what the eye resolves"
                    : "below the crossover: the iris is the bottleneck and more magnification buys real resolution, exactly in proportion"
                }
              />
              <Guard
                label="the field:"
                value={
                  readout!.objectFieldDiameterMm === null
                    ? "limited only by the glass"
                    : `${readout!.objectFieldDiameterMm.toFixed(3)} mm of specimen`
                }
                level="ok"
                detail={
                  readout!.objectFieldDiameterMm === null
                    ? "no field stop was spliced in, so nothing vignettes the field until a rim does"
                    : `FN/M_obj, through a REAL annular surface at the intermediate image — a field beyond it vignettes in the trace. Apparent field ${readout!.apparentFieldOfViewDeg!.toFixed(2)}°`
                }
              />
              <WallLine wall={wall.result} focalLengthMm={focalLengthMm} />
              <Guard
                label="the placement band:"
                value={`${signed(readout!.bandPlusMm, 4)} / ${signed(readout!.bandMinusMm, 4)} mm`}
                level="ok"
                detail={`how far the eyepiece may sit from its solved position before the exit beam asks a quarter diopter of the observer — bisected on the trace. ${
                  readout!.poleDeltaMm === null
                    ? "no sign flip was found within 400 mm."
                    : `Push it ${Math.abs(readout!.poleDeltaMm).toFixed(3)} mm closer and the vergence changes sign through a pole; past that is the far branch, where the telescope's gap lives.`
                }`}
              />
              <span style={{ color: "#777" }}>
                {readout!.elapsedMs.toFixed(1)} ms on the main thread · gap {readout!.gapMm.toFixed(3)} mm,
                intermediate image {readout!.intermediateImageDistanceMm.toFixed(3)} mm, eyepiece FFD{" "}
                {readout!.eyepieceFrontFocalDistanceMm.toFixed(3)} mm
              </span>
            </>
          )}
        </div>
        <div style={{ maxWidth: 620, fontSize: 13, color: "#666" }}>
          <p style={{ marginTop: 0 }}>
            <strong>The negative control is the whole argument, and it is recomputed here</strong>{" "}
            rather than quoted: the same objective and the same eyepiece, separated by the gap{" "}
            <code>afocalTelescope</code> solves for instead. On the DIN 4× that leaves the exit beam
            at tens of diopters against 1e-12 for the solved one — hundreds of times the quarter
            diopter an observer notices — and the sign is the diagnosis rather than the size: a gap
            that short puts the eyepiece <em>in front of</em> the image it should collimate, so its
            object is virtual and the beam converges to a real point just past the eye lens. That is
            not merely more accommodation than an eye has, it is the wrong side of infinity, since
            accommodation only ever adds positive power. On a short-focus objective the control does
            not even get that far — the collimated-in solve asks for a <em>negative</em> separation
            and is refused — so the control is guarded separately from the instrument, because it is
            the control that fails there and not the microscope.
          </p>
          <p>
            <strong>{entry.label}</strong> — {entry.note}
          </p>
          <p>
            The <em>traced</em> quantities here are the magnification (a real chief ray&rsquo;s exit
            angle, so it carries distortion and is only one number near the axis) and the engraved
            NA (a real marginal ray&rsquo;s launch sine). The exit pupil is the aperture stop imaged{" "}
            <em>paraxially</em> through everything behind it, and the NA the Lagrange invariant
            takes is n·u off that same pupil geometry — so those two agreeing is one bookkeeping
            being self-consistent through a traced M, not two independent computations meeting.
            Said here because on this surface the distinction is the finding.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginTop: 24,
          opacity: sweep.pending ? 0.55 : 1,
          transition: "opacity 120ms ease-out",
        }}
      >
        {sweep.result === null || sweep.result.points.length === 0 ? (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
            solving {SWEEP_POINTS} eyepieces…
          </p>
        ) : (
          <>
            <div>
              <EmptyMagnificationPlot
                sweep={sweep.result}
                eyePupilMm={eyePupilMm}
                nearPointMm={nearPointMm}
                readout={readout}
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
                empty magnification, as an <em>invariance</em>. Left of the crossover the iris is
                the bottleneck and the ratio is exactly ∝ M; right of it the working pupil IS the
                exit pupil, which is D·NA/|M|, so the M cancels identically and the curve is flat.
                The 500·NA and 1000·NA rules are that, seen through two stated pupil conventions —
                the digits appear nowhere in the engine. Move the iris and watch the knee travel.
              </p>
            </div>
            <div>
              <ExitPupilPlot sweep={sweep.result} eyePupilMm={eyePupilMm} readout={readout} />
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#777",
                  width: 420,
                  marginTop: 4,
                }}
              >
                the red curve is the formula every microscopy text prints. On a dry objective it
                hides under the others at half a percent; on the 100×/1.40 oil it is low by a
                factor, because sec u is 2.54 there and the invariant is a law about slopes. The
                iris line is where this plot and the one beside it are the same picture.
              </p>
            </div>
          </>
        )}
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
        {readout !== null && (
          <div>
            <PlacementPlot readout={readout} />
            <p
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "#777",
                width: 420,
                marginTop: 4,
              }}
            >
              the null, paired with what leaving it costs. The dashed line is the thin-lens Newton
              form 1000·Δ/f_e², drawn as a <em>label</em> rather than as a rung — and the gap
              between the two curves really is the eyepiece&rsquo;s thickness, because read
              backwards as f_e²·(¼ D ÷ band) the measurement is <em>affine</em> in f_e with an
              intercept of exactly 1000, which is the thin-lens limit. The band closes as 1/f_e², so
              a short eyepiece is the one that has to be placed carefully: ±0.025 mm at f_e 10
              against ±0.40 at 40.
            </p>
          </div>
        )}
        {sweep.result !== null && sweep.result.points.length > 0 && (
          <div style={{ opacity: sweep.pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
            <EyeReliefPlot sweep={sweep.result} readout={readout} />
            <p
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "#777",
                width: 420,
                marginTop: 4,
              }}
            >
              why short eyepieces are uncomfortable, out of the pupil imaging rather than out of a
              rule. {sweep.result.elapsedMs.toFixed(0)} ms for {sweep.result.points.length} eyepiece
              solves, which is what the two curves above cost as well — they are one sweep.
            </p>
          </div>
        )}
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The field number is a real aperture, and it walks into § 5j&rsquo;s wall.</strong> A
        field stop of FN millimetres needs FN millimetres of glass behind it, and a computed Plössl
        stops admitting glass at a definite fraction of its own focal length — the readout above
        bisects for it rather than quoting one, which is the move A6 made on § 6e.4&rsquo;s aperture
        ceiling. § 6q.9 states it as a bracket — 24 mm builds at f_e = 25 and 24.5 does not — and
        bisected it is <strong>0.9615248·f_e</strong>, a constant: the form is exactly
        scale-invariant, so the fraction does not move with focal length at all. It read
        0.899195·f_e until § 6b.5.7 stopped the doublet&rsquo;s bending scan counting a root no
        glass can be bent to; the wall is the same refusal, measured once its count meant what its
        message said.
        Past it the <em>doublet solve</em> refuses, in its own words, and that refusal is
        printed here rather than being caught and softened. This is the fourth wall of its kind in
        the branch, after § 6b&rsquo;s f/4.1, § 6d&rsquo;s NA 0.343 and § 6e.4&rsquo;s NA 1.411, and
        a genuinely wide field is a different eyepiece form — the transcribed patent members, still
        blocked on published prescription data — rather than more aperture on this one.{" "}
        <strong>It is the Plössl&rsquo;s wall rather than the eyepiece&rsquo;s:</strong> switch forms
        and it disappears, because a Huygens has no cemented doublet to fail.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The Huygens is worth switching to.</strong> It collimates as exactly as the Plössl
        does, and its front focal distance is <em>negative</em> — the plane it collimates lies{" "}
        <em>inside</em> the eyepiece, between the two singlets, which is where a Huygens&rsquo; field
        stop physically is. So asking this composition for an external field stop at the
        intermediate image is refused, with the engine&rsquo;s own sentence, and the refusal is a
        correct statement about the form rather than a limitation of the code. Turn the field stop
        off and it composes, magnifies and collimates like any other eyepiece.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The near point is a convention about human eyes, not optics.</strong> Every
        magnification on this page is a ratio against whichever value that control is set to;
        changing it scales M exactly and moves no ray at all — the same split this engine makes for
        the 200/180/165 tube lengths. A microscope quoted against 254 mm really is a different
        number, and the <span style={{ color: GUARD_COLOR.ok }}>500·NA</span> and{" "}
        <span style={{ color: GUARD_COLOR.ok }}>1000·NA</span> rules move with it.
      </p>
    </>
  );
}
