import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import {
  darkfieldSource,
  frequencyOf,
  gridReach,
  sourceFits,
  PANEL_SOURCE_SAMPLES,
  threeOrderCheck,
  transferSweep,
  DARKFIELD_INNER,
  DARKFIELD_OUTER,
  WHITE_OVER_MEAN,
  type HarmonicSupport,
  type Illumination,
  type PhaseFrame,
  type PhaseRequest,
  type PhaseResult,
  type TransferResult,
} from "../phase";
import { Plot } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider, thresholdLevel, VERDICT_LEVEL } from "../ui";
import { createPhaseWorker } from "../workers";

/**
 * Half a wave between adjacent transmitting samples and the DFT lattice has
 * stopped carrying the pupil it was handed.
 *
 * The same number `telescope.tsx` holds `seeingPhaseStepWaves` to, and for the
 * same reason: past it the sampled phase is aliased and the image is a picture
 * of the sampling. It is reachable here — defocus adds quadratic phase, so the
 * step grows linearly with w₂₀ — and the slider's range is set from where it is
 * actually crossed rather than from arithmetic. Measured: at pupilSamples 32 the
 * step runs 0.0303 at a quarter wave, 0.4844 at 4 waves and 0.7266 at 6, so it
 * crosses near w₂₀ = 4.1. At pupilSamples 64 it is exactly half that and 6 waves
 * reaches only 0.369 — a finer pupil grid carries more defocus, which is the
 * guard being a statement about the grid rather than about the physics.
 */
const GRID_STEP_LIMIT = 0.5;

/** Far enough that pupilSamples 32 crosses the guard on screen. */
const MAX_DEFOCUS_WAVES = 6;

function GuardBlock({ frame }: { frame: PhaseFrame }) {
  return (
    <>
      <Guard
        label="grid step"
        value={`${frame.maxGridPhaseStepWaves.toFixed(4)} waves / sample`}
        level={thresholdLevel(frame.maxGridPhaseStepWaves, GRID_STEP_LIMIT)}
        detail={`the DFT lattice carries the pupil while this stays under ${GRID_STEP_LIMIT}`}
      />
      <Guard
        label="fidelity"
        value={frame.verdict}
        level={VERDICT_LEVEL[frame.verdict]}
        detail={frame.verdictReason}
      />
    </>
  );
}

/** `13.05` → `13.0`, `7.4e11` → `7.4e+11`. Never a ratio in 12 digits. */
function ratioText(ratio: number): string {
  if (!Number.isFinite(ratio)) return "∞";
  return ratio < 1000 ? ratio.toFixed(2) : ratio.toExponential(1);
}

/**
 * What the source-samples control does to the 2ν reading above it.
 *
 * Printed unconditionally and in one voice, with no threshold deciding whether
 * it is worth showing and no colour grading it. § 6ab.10 left "what the panel
 * should print" open between fewer digits, a stated uncertainty and a refusal;
 * this is none of the three, because all three need a boundary and the
 * measurements say there is not one to have — the reading is 9.4× uncertain at
 * ν = 1 and S = 0.25 and inside 1.05× at ν = 1.94 and S = 1.5. So the line
 * states a fact about this panel's own control instead, which is exact wherever
 * it is printed and needs no boundary at all.
 *
 * A range and not a ± : the four readings are what they are, and turning them
 * into a centre and a half-width would invent a distribution and a best estimate
 * that nothing here measured.
 */
function SpreadLine({ spread }: { spread: PhaseFrame["secondHarmonicSpread"] }) {
  if (!spread) return null;
  // One reading has two causes and they are opposite claims. At S = 0 every
  // option is the same source, so the reading is count-free and that is a
  // strength. Past the frequency grid it is the reverse — nothing was compared —
  // and printing "(1.00×)" from a single number would read as agreement.
  if (spread.readings.length === 1) {
    return (
      <span style={{ color: "#777" }}>
        &nbsp;&nbsp;
        {spread.skipped.length === 0
          ? "source samples do not enter: one illumination direction"
          : `unchecked: ${spread.skipped.join("/")} are past the frequency grid at this S`}
      </span>
    );
  }
  return (
    <span style={{ color: "#777" }}>
      &nbsp;&nbsp;across source samples {spread.readings.map((r) => r.samples).join("/")}:{" "}
      {spread.min.toExponential(2)} … {spread.max.toExponential(2)} (
      <strong>{ratioText(spread.ratio)}×</strong>)
      {spread.skipped.length > 0 && (
        <>
          {" "}
          · {spread.skipped.join("/")} past the frequency grid at this S, not rendered
        </>
      )}
    </span>
  );
}

/**
 * Why there is no 2ν reading here — § 6ab.12's gate, said out loud.
 *
 * The number the render produced is printed *beside* the refusal rather than
 * hidden, because the two failures look different and the difference is the
 * lesson: where nothing carries 2ν the figure is f64 roundoff, and where the
 * lattice is blind to a set the aperture has it is an exact zero. It is labelled
 * as the arithmetic's leftover and not as a contrast, which is the whole change —
 * before this it sat on the line above in four significant figures, and at φ = 3
 * one of these cells reads 6.8e-7 and looks like a weak real signal.
 */
function SupportLine({
  support,
  measured,
}: {
  support: HarmonicSupport;
  measured: number;
}) {
  return (
    <span style={{ color: GUARD_COLOR.warn }}>
      &nbsp;&nbsp;{support.reason}
      {Number.isFinite(measured) && (
        <>
          {" "}
          · the sum leaves {measured.toExponential(2)}, which is arithmetic and not contrast
        </>
      )}
    </span>
  );
}

/**
 * One canvas of the pair, with the two harmonics read off it.
 *
 * The layout puts contrast at ν and contrast at 2ν on adjacent lines on purpose:
 * they are the same image measured at two bins, one of them is f64 noise and the
 * other is not, and side by side that is a single glance rather than a paragraph.
 */
function Frame({
  frame,
  support,
  title,
  note,
  size,
  phi,
  nu,
}: {
  frame: PhaseFrame;
  /** Shared by both frames on purpose — support is geometry, so it is one answer
   *  for the pair where `secondHarmonicSpread` is one per frame. */
  support: HarmonicSupport;
  title: string;
  note: string;
  size: number;
  phi: number;
  nu: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = size;
    element.height = size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copy: the buffer arrived by structured clone and `ImageData` takes
    // ownership of what it is given.
    context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), size, size), 0, 0);
  }, [frame, size]);

  const nulled = frame.contrast < 1e-9;

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 4 }}>
        <strong>{title}</strong>
        <br />
        <span style={{ color: "#777" }}>{note}</span>
      </figcaption>
      <canvas
        ref={canvas}
        style={{ width: 300, height: 300, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption
        style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 300 }}
      >
        <span style={{ color: nulled ? GUARD_COLOR.ok : "#111" }}>
          contrast at ν <strong>{frame.contrast.toExponential(3)}</strong>
        </span>
        <br />
        contrast at 2ν{" "}
        <strong>
          {!support.exists
            ? "none"
            : Number.isNaN(frame.secondHarmonic)
              ? "off grid"
              : frame.secondHarmonic.toExponential(3)}
        </strong>
        <br />
        {support.exists ? (
          <SpreadLine spread={frame.secondHarmonicSpread} />
        ) : (
          <SupportLine support={support} measured={frame.secondHarmonic} />
        )}
        <br />
        mean {frame.meanIntensity.toExponential(4)}
        <br />
        <span style={{ color: "#777" }}>
          weak-phase 2φT = {frame.weakPrediction.toExponential(3)}
          {phi > 0 && frame.weakPrediction > 1e-9 && (
            <>
              {" "}
              (gap{" "}
              {(
                Math.abs(frame.contrast - frame.weakPrediction) / frame.weakPrediction
              ).toExponential(1)}
              )
            </>
          )}
        </span>
        <br />
        {frame.besselCheck === null ? (
          <span style={{ color: "#777" }}>
            no closed form here — it needs S = 0 and 0.5 &lt; ν &lt; 1 (ν = {nu.toFixed(4)})
          </span>
        ) : (
          <span style={{ color: "#06a" }}>
            2ν · mean = {frame.besselCheck.measured.toFixed(9)}
            <br />
            2·J₁(φ)² &nbsp;&nbsp; = {frame.besselCheck.closed.toFixed(9)}
            <br />
            residual &nbsp;&nbsp;= <strong>{frame.besselCheck.residual.toExponential(2)}</strong>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** What the sweep depends on — not `cycles`, which only moves a marker. */
type SweepRequest = Pick<
  PhaseRequest,
  "size" | "pupilSamples" | "sourceSamples" | "illumination" | "coherenceParameter" | "defocusWaves"
>;

/**
 * The transfer against ν — A3's plot half.
 *
 * Three curves, and the subject is the flat one. The y-range is **fixed**, not
 * autoscaled: an autoscaled axis would take the in-focus phase curve — which is
 * bit-exact zero — and draw f64 noise as a signal with its own tick labels. The
 * magnitude is printed underneath in exponential instead, which is the same move
 * A2 makes with `worstResidual` and for the same reason: "the flat line is 0e+0"
 * is a claim and "0.0000" is a rounding.
 */
function TransferPlot({ request, nu }: { request: SweepRequest; nu: number }) {
  const [sweep, setSweep] = useState<TransferResult | null>(null);

  useEffect(() => {
    setSweep(null);
    const id = setTimeout(() => setSweep(transferSweep(request)), 0);
    return () => clearTimeout(id);
  }, [request]);

  if (sweep === null) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
        summing the orders…
      </p>
    );
  }
  if (!sweep.ok) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", width: 420 }}>
        the engine refuses this source: {sweep.error}
      </p>
    );
  }

  // Every curve here is normalized by the undiffracted energy, and darkfield
  // puts that at exactly zero — so the engine's guarded division returns 0 and
  // all three curves lie on the axis. Drawing them would be a picture of 0/0
  // beside a paragraph about a null, which is the one confusion this panel
  // cannot afford: the flat line would look like the finding when it is an
  // artifact, and the ABSORPTION curve would be flat too, saying something
  // plainly false about an image that visibly has contrast.
  if (!(sweep.sweep.directBeam > 0)) {
    return (
      <div style={{ width: 420 }}>
        <p style={{ fontFamily: "monospace", fontSize: 12, color: GUARD_COLOR.warn }}>
          no transfer curve exists here.
        </p>
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", lineHeight: 1.7 }}>
          Every transfer in <code>illumination/transfer</code> is a ratio to the undiffracted
          energy Σw·|P(s)|², and darkfield puts that at exactly <strong>0</strong> — the annulus
          lies wholly outside the pupil, so no illuminating beam enters it. The engine guards the
          division and returns 0; plotting that would draw three flat lines that look like this
          panel&rsquo;s null and are nothing of the kind. In particular it is <em>not</em> true
          that darkfield transfers no contrast — the canvases beside this have structure at 2ν and
          the numbers under them measure it. What has gone to zero is the quantity the transfer is
          a ratio to, not the contrast.
          <br />
          <br />
          Switch back to brightfield for the curves. The <strong>null itself survives darkfield</strong>{" "}
          and is measured directly off the image: the contrast at ν under the in-focus canvas.
        </p>
      </div>
    );
  }

  const p = sweep.sweep.points;
  return (
    <div>
      <Plot
        series={[
          {
            label: "absorption, in focus",
            color: "#06a",
            points: p.map((q) => [q.nu, q.absorption] as const),
            dash: [5, 4],
          },
          {
            label: `phase, defocused ${request.defocusWaves.toFixed(2)}λ`,
            color: "#a60",
            points: p.map((q) => [q.nu, q.phaseDefocused] as const),
            width: 2.4,
          },
          {
            label: "phase, in focus",
            color: "#111",
            points: p.map((q) => [q.nu, q.phaseFocused] as const),
            width: 2.6,
          },
        ]}
        markers={[{ x: nu, color: "#3a7", label: `object ν ${nu.toFixed(3)}` }]}
        xLabel="spatial frequency ν, in NA/λ"
        yLabel="transfer T (image contrast = 2·φ·T)"
        xMin={0}
        xMax={2.2}
        // Headroom on BOTH sides, and the bottom one is not cosmetic. The
        // in-focus phase curve is bit-exact zero, so at yMin = 0 it is drawn
        // underneath the axis rule and the one line this panel exists to show
        // is the one line the reader cannot see. Sixteen orders of magnitude of
        // margin below the data is the honest way to make a null visible; the
        // dishonest way is to autoscale to it and let f64 noise grow tick
        // labels. The top margin keeps the absorption curve's flat 1 off the
        // frame, where it read as part of the border.
        yMin={-0.06}
        yMax={1.15}
      />
      <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", width: 420, marginTop: 4 }}>
        max in-focus phase transfer over {p.length} frequencies ={" "}
        <strong>{sweep.sweep.worstNull.toExponential(3)}</strong> · {sweep.sweep.elapsedMs.toFixed(0)}{" "}
        ms. The flat line on the axis is the whole panel; the dashed one is what the same instrument
        does to an object that absorbs. The sample count follows the defocus — at S = 0 the
        defocused curve is exactly |sin(2π·w₂₀·ν²)|, whose lobes narrow to 1/(4·w₂₀) at ν = 1, so a
        fixed count would draw the sampling instead of the transfer at the top of the slider.
      </p>
    </div>
  );
}

export function PhasePanel() {
  const [size, setSize] = useState(128);
  const [pupilSamples, setPupilSamples] = useState(32);
  const [sourceSamples, setSourceSamples] = useState(11);
  const [illumination, setIllumination] = useState<Illumination>("brightfield");
  const [sRaw, setS] = useState(0);
  const [cyclesRaw, setCycles] = useState(12);
  const [phi, setPhi] = useState(0.4);
  const [defocusWaves, setDefocus] = useState(0.25);

  // Darkfield's annulus lies entirely outside the pupil, so its outermost
  // lattice point sits past |s| = 1 and needs frequency-grid headroom that
  // pupilSamples 64 on a 128 grid does not have. The check runs on the source's
  // own points rather than on a formula in S, because an annulus's reach is not
  // something a formula in S describes — measured, the N = 11 ring reaches
  // |s| = 1.371 against a reach of 0.969 there. The engine's throw is still
  // caught and shown; this only stops the panel walking into it.
  const darkfieldFits = useMemo(
    () => sourceFits(darkfieldSource(sourceSamples), size, pupilSamples),
    [sourceSamples, size, pupilSamples],
  );
  const illuminationUsed: Illumination =
    illumination === "darkfield" && !darkfieldFits ? "brightfield" : illumination;

  // S's ceiling is `abbeImage`'s frequency-grid wall; `cycles`'s keeps 2ν on the
  // grid, which is stricter than A2's cap because A3's second measurement IS the
  // 2ν bin and reporting it as "off grid" at the top of the slider would remove
  // half the panel exactly where φ makes it largest.
  // The binding disc-lattice sample sits at radius S·(1 − 1/N), so the ceiling
  // is `gridReach` divided by that — A2's exact form, rather than `gridReach`
  // alone, which is what this panel first used and is stricter than the wall
  // actually is (0.97 against 1.07 at pupil samples 64 on a 128 grid).
  // `sourceFits` is the exact check either way and stays wired to the annulus,
  // whose reach no formula in S describes.
  const maxS = Math.min(
    1.5,
    Math.floor(gridReach(size, pupilSamples) / (1 - 1 / sourceSamples) / 0.01) * 0.01,
  );
  const maxCycles = Math.max(1, Math.min(pupilSamples, Math.floor(size / 4) - 1));
  const s = illuminationUsed === "darkfield" ? 0 : Math.min(sRaw, maxS);
  const cycles = Math.min(cyclesRaw, maxCycles);
  const nu = frequencyOf(cycles, pupilSamples);

  const request = useMemo<PhaseRequest>(
    () => ({
      size,
      pupilSamples,
      sourceSamples,
      illumination: illuminationUsed,
      coherenceParameter: s,
      cycles,
      amplitudeRadians: phi,
      defocusWaves,
    }),
    [size, pupilSamples, sourceSamples, illuminationUsed, s, cycles, phi, defocusWaves],
  );

  const sweepRequest = useMemo<SweepRequest>(
    () => ({
      size,
      pupilSamples,
      sourceSamples,
      illumination: illuminationUsed,
      coherenceParameter: s,
      defocusWaves,
    }),
    [size, pupilSamples, sourceSamples, illuminationUsed, s, defocusWaves],
  );

  const { result, pending } = useLatestFromWorker<PhaseRequest, PhaseResult>(
    createPhaseWorker,
    request,
  );
  const readout = result?.ok ? result.readout : null;
  const inRegime = threeOrderCheck(request, nu);

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The phase null: why unstained cells are invisible</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        A specimen that absorbs nothing. <strong>|t| = 1 everywhere</strong> — a photographic plate
        at the object plane would see a blank sheet, and so does a brightfield microscope: the two
        sidebands a phase grating diffracts arrive in quadrature with the direct beam and 180° apart
        from each other, so they <em>cancel identically</em>. Living cells are phase objects. That
        cancellation is why stains exist, why phase contrast was worth a Nobel prize, and it is a{" "}
        <strong>null</strong> — so the picture alone could not tell it from a broken render, and the
        curve beside it is not decoration.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Everything here runs on an <strong>ideal pupil</strong>, never a traced objective, and that
        is the stronger version rather than the cheaper one: the null&rsquo;s precondition is a real
        (unaberrated) pupil, so a traced objective&rsquo;s residual turns an exact zero into a small
        number, and a small number cannot be told from a bug. There is therefore no objective here
        and no honest µm scale — the panel works in ν and grid units throughout. Break the pupil
        instead, deliberately, with the <strong>defocus</strong> slider, and watch the null lift.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>The canvas is not blank, and that is the finding.</strong>{" "}
        <code>phaseGratingObject</code> carries every Bessel order the grid can hold, not the
        weak-object truncation — so squaring it leaves the ν bin (the 0×±1 beat) cancelled and the{" "}
        <strong>2ν bin (the +1×−1 beat) alive</strong>, at order φ². What is null is the{" "}
        <em>linear</em> response, which is exactly what the plot draws. So the picture shows
        structure at twice the frequency of the object that made it, while the transfer at the
        object&rsquo;s own frequency sits on the axis. Both numbers are under each canvas.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Two controls exist to <em>fail</em> to break it. <strong>φ</strong> is not a brightness dial:
        the textbook statement is about a weak phase object, and measured, the ν bin stays at f64
        noise out to φ = 3 radians, where the object is nothing like weak. <strong>Darkfield</strong>{" "}
        moves the whole condenser outside the pupil, so a clear field goes to a hard zero — but the
        annulus is still symmetric under s → −s, which is the null&rsquo;s other precondition, so the
        null survives it untouched. Darkfield changes the background, not the null. φ = 0 is the
        clear field, and it is where that zero is.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label="illumination"
          options={["brightfield", "darkfield"] as const}
          value={illuminationUsed}
          onChange={setIllumination}
        />
        <Choice
          label={`pupil samples ${pupilSamples}`}
          options={[32, 64]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={`grid ${size}²`}
          options={[128, 256]}
          value={size}
          onChange={setSize}
        />
        <Choice
          label={`source samples ${sourceSamples} across the diameter`}
          // The same list `SamplingSpread` enumerates. Shared rather than typed
          // out twice: the spread's whole claim is that it covers every option
          // this control offers, and a fifth option added here alone would make
          // that sentence false without touching the code that says it.
          options={[...PANEL_SOURCE_SAMPLES]}
          value={sourceSamples}
          onChange={setSourceSamples}
        />
      </div>
      {illumination === "darkfield" && !darkfieldFits && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: GUARD_COLOR.warn, maxWidth: 660 }}>
          darkfield is unavailable at pupil samples {pupilSamples} on a {size}² grid: the{" "}
          {DARKFIELD_INNER}–{DARKFIELD_OUTER} annulus reaches past |s| ={" "}
          {gridReach(size, pupilSamples).toFixed(3)}, which is all the frequency grid has, and{" "}
          <code>abbeImage</code> would refuse the render rather than truncate the pupil. Raise the
          grid or lower pupil samples. Showing brightfield instead.
        </p>
      )}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`defocus w₂₀ = ${defocusWaves.toFixed(2)} waves`}
          min={0}
          max={MAX_DEFOCUS_WAVES}
          step={0.05}
          value={defocusWaves}
          onChange={setDefocus}
        />
        <Slider
          label={`phase depth φ = ${phi.toFixed(2)} rad${phi === 0 ? " — the clear field" : ""}`}
          min={0}
          max={3}
          step={0.05}
          value={phi}
          onChange={setPhi}
        />
        <Slider
          label={`grating ${cycles} cycles — ν = ${nu.toFixed(4)}`}
          min={1}
          max={maxCycles}
          step={1}
          value={cycles}
          onChange={setCycles}
        />
        <Slider
          label={
            illuminationUsed === "darkfield"
              ? "condenser S — not used by darkfield"
              : `condenser S = ${s.toFixed(2)}${s === 0 ? " — the coherent limit" : ""}`
            }
          min={0}
          max={maxS}
          step={0.01}
          value={s}
          onChange={setS}
        />
      </div>

      {result !== null && !result.ok && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: GUARD_COLOR.bad, maxWidth: 660 }}>
          the engine refuses this render: {result.error}
        </p>
      )}

      <div
        style={{
          display: "flex",
          gap: 28,
          flexWrap: "wrap",
          alignItems: "flex-start",
          opacity: pending ? 0.55 : 1,
          transition: "opacity 120ms ease-out",
        }}
      >
        {readout !== null && (
          <>
            <Frame
              frame={readout.focused}
              support={readout.secondHarmonicSupport}
              title="in focus"
              note="the linear term is gone"
              size={readout.size}
              phi={phi}
              nu={nu}
            />
            <Frame
              frame={readout.defocused}
              support={readout.secondHarmonicSupport}
              title={`defocused ${defocusWaves.toFixed(2)} waves`}
              note={defocusWaves === 0 ? "the same image — the slider is at zero" : "the null lifts"}
              size={readout.size}
              phi={phi}
              nu={nu}
            />
          </>
        )}
        <TransferPlot request={sweepRequest} nu={nu} />
      </div>

      {readout !== null && (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 16 }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#777" }}>
              defocused frame&rsquo;s guards
            </div>
            <GuardBlock frame={readout.defocused} />
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, color: "#555" }}>
            {readout.sourcePoints} illumination direction
            {readout.sourcePoints === 1 ? "" : "s"} · {readout.defocused.contributingPoints}{" "}
            contributed
            <br />
            white = {readout.displayWhite.toExponential(4)} · display gain{" "}
            <strong>×{(WHITE_OVER_MEAN / readout.displayWhite).toFixed(1)}</strong>
            <br />
            {readout.elapsedMs.toFixed(0)} ms, of which {readout.checkMs.toFixed(0)} ms for the{" "}
            {readout.checkFrames} convergence{" "}
            {readout.checkFrames === 1 ? "render" : "renders"} under the 2ν lines
            <br />
            orders on the grid |m| &le; {readout.truncation.maxOrder} · light not on it{" "}
            <strong
              style={{ color: readout.truncation.droppedEnergy > 0.01 ? "#a33" : "inherit" }}
            >
              {(100 * readout.truncation.droppedEnergy).toPrecision(3)}%
            </strong>
          </div>
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The closed form under the canvases</strong> appears only where it applies: one on-axis
        plane wave (S = 0) and 0.5 &lt; ν &lt; 1, so exactly three orders reach the image. There the
        algebra gives <code>contrast(2ν) · mean = 2·J₁(φ)²</code> with no free parameter, and the
        engine&rsquo;s own <code>besselJ1</code> supplies the right-hand side. It is written that way
        round, multiplying by the <em>measured</em> mean rather than dividing by a computed one,
        because the engine has no J₀ and a form that needed one would have to invent it here.{" "}
        <strong>The residual is printed rather than claimed</strong>, and that is not politeness: it
        runs 1e-16 to 1e-14 through most of the regime but reaches <strong>6.1e-10</strong> at
        ν = 0.8125 with φ = 3, and it is not even monotone in ν — ν = 0.9375 at the same φ is back at
        2.6e-15. Which lattice samples the ±1 orders land on is what moves it. A flat
        &ldquo;agrees to 1e-14&rdquo; here would have been overclaiming by four orders at a setting
        two slider drags from the default, so the number is on screen and never has to be taken on
        trust.{" "}
        {inRegime
          ? "You are in that regime now."
          : "You are outside it now — the line under each canvas says which condition is unmet."}{" "}
        Outside it the form is not approximately right, it is wrong: at ν ≤ 0.5 the ±2 orders get
        through (99% error) and at S = 0.4 the source is no longer one plane wave (70%).
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>And the sharpest thing the defocus slider does</strong> is inside that same regime:
        drag it and <code>2ν · mean</code> does not move — not approximately, but in every printed
        digit — while the contrast at ν runs from 0 to 0.74 and back. Defocus is a pure phase, and
        orders +1 and −1 sit at the <em>same</em> pupil radius, so the beat that makes 2ν picks up no
        phase difference at all, while the 0×±1 beat that makes ν picks up sin(2π·w₂₀·ν²). One
        slider, two terms in one image, and only one of them is listening.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>&ldquo;Every Bessel order&rdquo; is a promise a finite grid cannot keep</strong>, and
        the readout says which ones it kept. A grating&rsquo;s orders run to infinity; the grid holds
        the ones with |m|·cycles inside it, which at 13 cycles on 128 bins is |m| &le; 4. The rest
        used to <em>fold</em> — order 5 landing on bin −63, which is no order at all — and the
        imaging sum then let them through the pupil as light the object had diffracted into those
        directions. It had not. That is what made a darkfield cell with no possible second harmonic
        read 1.2e-7, and the same false orders were in the picture everywhere else, hidden under
        whatever real signal was there. So what does not fit is now <em>left out</em> rather than
        misplaced, and the cost is the second number: <strong>light not on the grid</strong>. It is
        1.6e-14 at φ = 0.4 and 12 cycles, and <strong>23%</strong> at the top of both sliders, where
        the grid holds only |m| &le; 2 and J₃(3) = 0.31 goes over the side. There is no threshold
        dividing those, which is exactly why it is printed rather than refused — and a band-limited
        object is not quite a pure phase object, so at that corner &ldquo;absorbs nothing&rdquo; is
        the thing that has stopped being true, not the null.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        Both canvases share <strong>one</strong> grey scale — white is {WHITE_OVER_MEAN}× the
        in-focus frame&rsquo;s mean — because the panel is a comparison and two independently
        normalized pictures would rescale against each other. That fixes the pair against itself
        and <em>not</em> against the rest of the app, so the{" "}
        <strong>display gain is printed as a number</strong> beside it: brightfield sits at ×1 and
        darkfield at ~×51, because a darkfield mean runs ~50× below a brightfield one and this
        display stretches it back up. The alternative — an absolute scale, where darkfield is
        rendered as honestly dark — makes it a black rectangle indistinguishable from a broken
        render, which is the failure a panel about a null can least afford. The stretch is a
        choice, so it is on screen as a factor rather than hidden in a normalization. The{" "}
        <strong>2φT</strong> line is <code>weakPhaseTransfer</code>&rsquo;s weak-phase prediction for
        the measured contrast, and the gap beside it is the finite-φ term — measured to run as φ²,
        ×4 per doubling of φ, from 6.7e-4 at φ = 0.05 to 4.2e-2 at φ = 0.4.
      </p>
    </>
  );
}
