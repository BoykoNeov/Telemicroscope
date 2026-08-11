import { useEffect, useMemo, useRef, useState } from "react";
import { refusalVoice } from "../refusal";
import { objectiveOf, objectiveOptions, type ObjectiveId } from "../objective";
import { readSavedBuild } from "../saved";
import { useLatestFromWorker } from "../hooks";
import { MICROSCOPE_CATALOG, entryOf, type MicroscopeKind } from "../microscope";
import { Plot } from "../plot";
import { Choice, Guard, GUARD_COLOR, ObjectiveLine, Slider, VERDICT_LEVEL } from "../ui";
import { createBrightfieldWorker } from "../workers";
import {
  cutoffSweep,
  frequencyOf,
  maxCoherenceParameter,
  WHITE_OVER_MEAN,
  type BrightfieldRequest,
  type BrightfieldResult,
  type CutoffResult,
  type PupilMode,
} from "../brightfield";

/**
 * The grating's modulation depth, fixed rather than dialled.
 *
 * 0.4 is weak enough that the image's contrast tracks the weak-object 2mT to
 * about a percent — so the panel can print both and the gap between them means
 * the finite-m nonlinearity — and strong enough to see. A slider here would
 * add a third axis to a panel whose subject is the other two.
 */
const BRIGHTFIELD_MODULATION = 0.4;

/**
 * The condenser slider's step, and it is 0.01 for a reason worth the extra
 * ticks: the whole claim of the third curve is that the textbook law and the
 * lattice disagree, and at ν = 1.3125 with an 11-point condenser they disagree
 * only for S between 0.3125 and 0.3438. A coarser step has no stop in that
 * window, so the panel could assert the gap but the reader could never stand in
 * it. Mid-drag values are dropped by the worker hook's backpressure, so the
 * finer step costs renders that were never going to be seen.
 */
const S_STEP = 0.01;

/**
 * Brightfield through a traced objective — APP.md's A2, the picture half.
 *
 * The three verdict colours this panel minted now live in `ui.tsx` as `Guard` —
 * A3 needed them, and APP.md's structural item 4 says the second surface
 * extracts rather than copies. `unknown` is still not a shade of green.
 *
 * A cosine absorption grating on the specimen, imaged by the Abbe sum over the
 * condenser's directions. Nothing here is drawn or post-processed: the contrast
 * that appears as S opens is contrast the sum produced, and the frequency at
 * which it stops appearing is the cutoff the plot beside it measures.
 *
 * Mid-grey is the frame's own mean and white is twice it — stated because it is
 * a choice, and because the alternative (a fixed white) would make the panel
 * mostly about brightness. The mean is reported as a number instead. Note the
 * one thing this model does NOT show: `abbeImage` normalizes the source weights
 * to Σ = 1, so closing the diaphragm costs no light here, where a real one goes
 * dim. What it costs is resolution, and that is the whole panel.
 */
function BrightfieldCanvas({ request }: { request: BrightfieldRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useLatestFromWorker<BrightfieldRequest, BrightfieldResult>(
    createBrightfieldWorker,
    request,
  );

  useEffect(() => {
    if (!result?.ok) return;
    const element = canvas.current;
    if (!element) return;
    element.width = result.readout.size;
    element.height = result.readout.size;
    const context = element.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(result.readout.rgba);
    context.putImageData(new ImageData(pixels, result.readout.size, result.readout.size), 0, 0);
  }, [result]);

  const readout = result?.ok ? result.readout : null;
  // Three states, not two: a source with no direction inside the pupil has no
  // cutoff to be past, and `latticeReach` says so with NaN rather than 0.
  const admits = readout !== null && Number.isFinite(readout.cutoff);
  const past = admits && readout!.nu > readout!.cutoff;

  return (
    <figure
      style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}
    >
      <canvas
        ref={canvas}
        style={{
          width: 360,
          height: 360,
          imageRendering: "pixelated",
          background: "#000",
          display: result?.ok === false ? "none" : "block",
        }}
      />
      <figcaption
        style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 360 }}
      >
        {result === null ? (
          <span>summing over the condenser…</span>
        ) : !result.ok ? (
          // The engine's own words: § 6b's and § 6d's design ceilings, or
          // `abbeImage`'s frequency-grid wall, which names the size that fixes it.
          <span style={{ color: "#c00" }}>{refusalVoice(result.source, "this render")}: {result.error}</span>
        ) : (
          <>
            <strong>ν = {readout!.nu.toFixed(4)}</strong> · period{" "}
            {readout!.periodNm.toFixed(0)} nm on a {readout!.objectSpanUm.toFixed(1)} µm crop
            <br />
            cutoff{" "}
            <strong>{admits ? readout!.cutoff.toFixed(4) : "none"}</strong> (textbook{" "}
            {readout!.textbookCutoff.toFixed(3)})
            <br />
            <span style={{ color: !admits ? "#a60" : past ? "#c00" : "#3a7" }}>
              {!admits
                ? "no illumination direction enters the pupil — there is no cutoff to be inside of"
                : past
                  ? "past the cutoff — not transmitted at any contrast"
                  : "inside the cutoff — this frequency gets through"}
            </span>
            <br />
            contrast <strong>{readout!.contrast.toFixed(5)}</strong> · weak-object 2mT{" "}
            {readout!.weakPrediction.toFixed(5)}
            <br />
            mean {readout!.meanIntensity.toFixed(4)} · 2ν{" "}
            {Number.isNaN(readout!.secondHarmonic)
              ? "off grid"
              : readout!.secondHarmonic.toFixed(5)}
            <Guard
              label="fidelity"
              value={
                readout!.phaseStepWaves === null
                  ? readout!.verdict
                  : `${readout!.verdict} · ${readout!.phaseStepWaves.toFixed(3)} waves/pupil sample`
              }
              level={VERDICT_LEVEL[readout!.verdict]}
              detail={readout!.verdictReason}
            />
            {readout!.contributingPoints}/{readout!.sourcePoints} directions contributed · grid
            step {readout!.maxGridPhaseStepWaves.toFixed(3)} waves
            <br />
            {readout!.elapsedMs.toFixed(0)} ms
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** What the sweep depends on — deliberately NOT S, which only moves a marker. */
type SweepRequest = Omit<BrightfieldRequest, "coherenceParameter" | "cycles" | "modulation">;

/**
 * The cutoff against S — APP.md's A2, the plot half.
 *
 * Three curves, and the third is the one that makes this an engine rather than
 * a demo: the textbook 1 + min(S, 1), the cutoff measured off the pupil sum by
 * bisection, and the reach of the condenser lattice that actually produced the
 * picture. Measured lands on lattice to ~1e-12 and on textbook not at all, and
 * the residual is printed rather than described.
 *
 * Main-thread behind a deferral, exactly as `MicroscopeTable` is and for the
 * same reason: it moves with the objective and the sampling, never with the S
 * slider, so it is a select-change cost. The markers — S and the object's own ν
 * — redraw without recomputing anything.
 */
function CutoffPlot({
  request,
  maxS,
  coherenceParameter,
  nu,
}: {
  request: SweepRequest;
  maxS: number;
  coherenceParameter: number;
  nu: number;
}) {
  const [sweep, setSweep] = useState<CutoffResult | null>(null);

  useEffect(() => {
    setSweep(null);
    const id = setTimeout(() => setSweep(cutoffSweep(request, maxS)), 0);
    return () => clearTimeout(id);
  }, [request, maxS]);

  if (sweep === null) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
        bisecting the cutoff…
      </p>
    );
  }
  if (!sweep.ok) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", width: 420 }}>
        {refusalVoice(sweep.source, "this objective")}: {sweep.error}
      </p>
    );
  }

  const p = sweep.sweep.points;
  return (
    <div>
      <Plot
        series={[
          {
            label: "textbook 1 + S",
            color: "#06a",
            points: p.map((q) => [q.coherenceParameter, q.textbook] as const),
            dash: [5, 4],
          },
          {
            label: "lattice reach",
            color: "#a60",
            points: p.map((q) => [q.coherenceParameter, q.lattice] as const),
            width: 2.4,
          },
          {
            label: "measured",
            color: "#111",
            points: p.map((q) => [q.coherenceParameter, q.measured] as const),
            dots: true,
            width: 1.2,
          },
        ]}
        markers={[
          { x: coherenceParameter, color: "#c00", label: `S ${coherenceParameter.toFixed(2)}` },
          { y: nu, color: "#3a7", label: `object ν ${nu.toFixed(3)}` },
        ]}
        xLabel="coherence parameter S = NA_cond / NA_obj"
        yLabel="cutoff frequency ν, in NA/λ"
        xMin={0}
        xMax={maxS}
        yMin={0.9}
        yMax={2.1}
      />
      <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", width: 420, marginTop: 4 }}>
        worst |measured − lattice| = {sweep.sweep.worstResidual.toExponential(1)} over{" "}
        {p.length} points · {sweep.sweep.elapsedMs.toFixed(0)} ms. Where the two markers cross the
        curve is where the grating appears in the picture.
      </p>
    </div>
  );
}

export function BrightfieldPanel() {
  // A2's dials. The two sliders are the panel: S is the condenser diaphragm,
  // and `cycles` is how fine the specimen's detail is, in the same frequency
  // units the cutoff is quoted in.
  // The slot is read once, at mount: `readSavedBuild` parses a string, so a
  // call during a render would hand back a fresh spec object every time and
  // refire every effect keyed on the request. A panel unmounts on a route
  // change anyway, so mount is also when a build saved on the builder's own
  // route arrives here.
  const [saved] = useState(readSavedBuild);
  const options = useMemo(() => objectiveOptions(saved), [saved]);
  const [kind, setKind] = useState<ObjectiveId>("din-4x-010");
  const objective = objectiveOf(options, kind);
  // Part F: a request carries the prescription, not a name from a list of ten.
  const spec = objective.spec;
  const [pupil, setPupil] = useState<PupilMode>("traced");
  // Own state, not the bench panel's — see the note there. The option lists are
  // narrower here on purpose: a traced brightfield sum costs 8–10× an ideal one
  // per source point, so what the bench can afford as a one-shot catalogue
  // trace would put this panel seconds past the live line.
  const [pupilSamples, setPupilSamples] = useState(32);
  const [size, setSize] = useState(128);
  const [sourceSamples, setSourceSamples] = useState(11);
  const [sRaw, setS] = useState(0.5);
  const [cyclesRaw, setCycles] = useState(8);

  // Both sliders are clamped by things the other controls decide, so the value
  // used is derived rather than corrected in an effect — a state write chasing
  // a state write is how a slider ends up fighting the finger holding it.
  // S's ceiling is `abbeImage`'s frequency-grid wall (it THROWS rather than
  // truncate, and a truncated pupil would read as a smaller aperture);
  // `cycles`'s is ν = 2, past which the pupil autocorrelation has no support.
  const maxS = Math.min(
    1.5,
    Math.floor(maxCoherenceParameter(size, pupilSamples, sourceSamples) / S_STEP) * S_STEP,
  );
  const maxCycles = Math.min(pupilSamples, size / 2 - 1);
  const s = Math.min(sRaw, maxS);
  const cycles = Math.min(cyclesRaw, maxCycles);

  const request = useMemo<BrightfieldRequest>(
    () => ({
      spec,
      pupilSamples,
      size,
      sourceSamples,
      coherenceParameter: s,
      cycles,
      modulation: BRIGHTFIELD_MODULATION,
      pupil,
    }),
    [spec, pupilSamples, size, sourceSamples, s, cycles, pupil],
  );

  // Everything the sweep depends on and nothing that only moves a marker: the
  // plot must not re-bisect on every tick of the S slider.
  const sweepRequest = useMemo(
    () => ({ spec, pupilSamples, size, sourceSamples, pupil }),
    [spec, pupilSamples, size, sourceSamples, pupil],
  );

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Brightfield: the condenser is not a brightness control</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        A cosine absorption grating on the specimen, imaged through one of the bench&rsquo;s
        objectives by summing over the directions the condenser lights it from.{" "}
        <strong>S</strong> is that condenser&rsquo;s aperture as a fraction of the
        objective&rsquo;s — the dial on the front of a real microscope — and <strong>ν</strong> is
        how fine the grating is, in units of NA/λ where 1 is the coherent limit and 2 is the
        incoherent one.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The experiment: push ν past 1 and the grating dies, then open S and watch it come back. It
        reappears exactly where the marker crosses the curve, because both come from the same sum —
        d = λ/(NA_obj + NA_cond), not written down but <em>measured</em>, by bisecting for the last
        frequency the pupil still transmits. Closing S to a pinhole costs a factor of two in
        resolution and buys back full contrast everywhere below ν = 1; that trade is what the dial
        is for.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The third curve is the one worth the panel. The measured cutoff does not land on the
        textbook line — it lands on the <strong>lattice reach</strong>, the outermost illumination
        direction the sampled condenser actually holds and the pupil actually admits. The residual
        printed under the plot is that agreement for the objective <em>currently selected</em>;
        switch objectives and it is re-measured, which is the check rather than a claim about a
        table you cannot see. The gap between the two curves is a finite condenser lattice, which
        this engine has and a real condenser does not. Raise <strong>source samples</strong> and
        watch the two close.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Past S = 1 that same discretization does something the textbook law does not predict: the
        continuum says opening further changes nothing, but the lattice&rsquo;s outermost points
        march out of the pupil entirely and the measured cutoff steps back <em>down</em>. That is
        sampling, not physics, and more source samples walk it back up.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label="objective"
          options={options.map((o) => o.id)}
          value={kind}
          onChange={setKind}
          format={(k) => objectiveOf(options, k).label}
        />
        <Choice
          label="pupil — ideal is the only way to reach the unknown verdict"
          options={["traced", "ideal"] as const}
          value={pupil}
          onChange={setPupil}
        />
        <Choice
          label={`pupil samples ${pupilSamples}`}
          options={[32, 64]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={`grid ${size}² — also the headroom the shifted pupil needs`}
          options={[128, 256]}
          value={size}
          onChange={setSize}
        />
        <Choice
          label={`source samples ${sourceSamples} across the diameter`}
          options={[7, 11, 15, 21]}
          value={sourceSamples}
          onChange={setSourceSamples}
        />
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 12, maxWidth: 720 }}>
        <ObjectiveLine label={objective.label} note={objective.note} />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`condenser S = ${s.toFixed(2)}${maxS < 1.5 ? ` (capped at ${maxS.toFixed(2)} by the grid)` : ""}`}
          min={0}
          max={maxS}
          step={S_STEP}
          value={s}
          onChange={setS}
        />
        <Slider
          label={`grating ${cycles} cycles — ν = ${frequencyOf(cycles, pupilSamples).toFixed(4)}`}
          min={1}
          max={maxCycles}
          step={1}
          value={cycles}
          onChange={setCycles}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <BrightfieldCanvas request={request} />
        <CutoffPlot
          request={sweepRequest}
          maxS={maxS}
          coherenceParameter={s}
          nu={frequencyOf(cycles, pupilSamples)}
        />
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 640 }}>
        Mid-grey is the frame&rsquo;s own mean and white is {WHITE_OVER_MEAN}× it, linearly —
        nothing is stretched. One thing the model does not show: the source weights sum to 1, so
        closing the diaphragm costs no <em>light</em> here where a real one goes dim. What it costs
        is resolution, and the mean intensity is printed so the normalization is not hiding a
        change. The contrast beside it is measured at the grating&rsquo;s own Fourier bin, and{" "}
        <strong>2mT</strong> is what it would be if the object were weak — the residual is the
        finite modulation m = {BRIGHTFIELD_MODULATION}, not an error. The number at{" "}
        <strong>2ν</strong> is a frequency no linear imager could put there from a single-frequency
        object: it is partial coherence&rsquo;s nonlinearity, as a reading rather than an assertion.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 640 }}>
        The fidelity line has <em>three</em> states and the middle one is not a shade of green. A
        traced pupil carries the sampling of the trace behind it, so it can be ruled{" "}
        <span style={{ color: GUARD_COLOR.ok }}>valid</span> or{" "}
        <span style={{ color: GUARD_COLOR.bad }}>no-honest-image</span> — the
        latter meaning the wavefront has left the regime a coherent sum describes, where a PSF would
        quietly cross-fade to a ray histogram and brightfield cannot, because rays carry no phase.
        Switch the pupil to <strong>ideal</strong> and the verdict reads{" "}
        <span style={{ color: GUARD_COLOR.warn }}>unknown</span>: a bare pupil function has no
        memory of what produced it, and this engine will not call that a clean bill of health. The
        ideal pupil is also ~3× faster, and its contrast is the ceiling the traced ones fall below —
        in wavefront order.
      </p>
    </>
  );
}
