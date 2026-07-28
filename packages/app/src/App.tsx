import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeCatalog,
  LAMBDA_NM,
  MARECHAL_WAVES,
  MICROSCOPE_CATALOG,
  type FrameResult,
  type MicroscopeKind,
} from "./microscope";
import {
  cutoffSweep,
  frequencyOf,
  maxCoherenceParameter,
  WHITE_OVER_MEAN,
  type BrightfieldRequest,
  type BrightfieldResult,
  type CutoffResult,
  type PupilMode,
} from "./brightfield";
import { Plot } from "./plot";
import {
  hueProfile,
  type FieldFrame,
  type FieldJob,
  type FieldRequest,
  type FieldResult,
  type LensKind,
  type RenderRequest,
  type RenderResult,
} from "./render";

/**
 * Runs one request through a worker, keeping the last good reply on screen.
 *
 * Backpressure, not a queue: at most one job is in flight and at most one
 * request waits behind it — a newer request overwrites the waiting one, so the
 * intermediate values a slider emits mid-drag are dropped rather than traced in
 * turn. `seq` guards against a stale reply landing after a newer one. The main
 * thread never blocks, so the slider thumb stays glued to the finger; the panel
 * dims (`pending`) while it catches up.
 *
 * Generic over the job because the star render and the brightfield render are
 * the same shape — one request in, one reply out — and A2 arriving was the
 * point at which a third hand-copied copy would have been two too many
 * (APP.md's structural item 3). The multi-reply shape stays separate below:
 * `useRenderedField` differs in exactly one line, and it is load-bearing.
 *
 * `createWorker` must be a module-level constant, not an inline closure: Vite
 * resolves `new URL("./x.worker.ts", import.meta.url)` statically, and a stable
 * identity is also what keeps the mount effect from tearing the worker down on
 * every render.
 */
function useLatestFromWorker<Req, Res>(
  createWorker: () => Worker,
  request: Req,
): { result: Res | null; pending: boolean } {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<Req | null>(null);
  const [result, setResult] = useState<Res | null>(null);
  const [pending, setPending] = useState(true);

  const post = useCallback((req: Req) => {
    const worker = workerRef.current;
    if (!worker) return;
    seqRef.current += 1;
    busyRef.current = true;
    setPending(true);
    worker.postMessage({ seq: seqRef.current, request: req });
  }, []);

  useEffect(() => {
    const worker = createWorker();
    worker.onmessage = (event: MessageEvent<{ seq: number; result: Res }>) => {
      if (event.data.seq === seqRef.current) setResult(event.data.result);
      // A newer request may have arrived while the worker was busy. Send the
      // most recent one and drop everything before it.
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next) {
        post(next);
      } else {
        busyRef.current = false;
        setPending(false);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      // Reset the flags so a StrictMode remount starts clean: a leftover
      // busyRef would queue forever and the panel would never paint.
      busyRef.current = false;
      queuedRef.current = null;
    };
  }, [post, createWorker]);

  useEffect(() => {
    if (!workerRef.current) return;
    if (busyRef.current) {
      queuedRef.current = request;
      setPending(true);
    } else {
      post(request);
    }
  }, [request, post]);

  return { result, pending };
}

/**
 * Runs a star field through the field worker, painting each refinement level.
 *
 * The field render answers one job with several frames (coarse patch grids
 * first, then the finest), so this differs from `useLatestFromWorker` in one place
 * that matters: it advances its backpressure queue only when a frame arrives
 * with `done`. Advancing on the first (coarse) frame — as the single-reply hook
 * does — would fire the next queued job mid-refinement and the finest grid would
 * never paint. The stale-`seq` guard still drops frames from a superseded job.
 */
function useRenderedField(request: FieldRequest): {
  result: FieldResult | null;
  refining: boolean;
} {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<FieldRequest | null>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [refining, setRefining] = useState(true);

  const post = useCallback((req: FieldRequest) => {
    const worker = workerRef.current;
    if (!worker) return;
    seqRef.current += 1;
    busyRef.current = true;
    setRefining(true);
    worker.postMessage({ seq: seqRef.current, request: req } satisfies FieldJob);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("./render.field.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<FieldFrame>) => {
      // A superseded job keeps posting its remaining levels; drop them whole.
      if (event.data.seq !== seqRef.current) return;
      setResult(event.data.result);
      // Every frame paints, but only the finest releases the queue: the worker
      // runs a job to completion before reading the next message, so the queued
      // request waits here until `done` rather than interrupting refinement.
      if (!event.data.done) return;
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next) {
        post(next);
      } else {
        busyRef.current = false;
        setRefining(false);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      busyRef.current = false;
      queuedRef.current = null;
    };
  }, [post]);

  useEffect(() => {
    if (!workerRef.current) return;
    if (busyRef.current) {
      queuedRef.current = request;
    } else {
      post(request);
    }
  }, [request, post]);

  return { result, refining };
}

/**
 * Ugly UI, correct physics — roadmap step 4, stated in those words.
 *
 * Every number on screen comes from the engine. Nothing here fakes, tints or
 * post-processes anything: the two canvases are the same pipeline the
 * validation ladder pins, run twice with one glass changed.
 *
 * Each panel traces in its own web worker (`useRenderedStar`), which keeps the
 * cost off the main thread without hiding it — the elapsed time is still
 * displayed and the panel dims while its worker catches up. That was only a
 * change of *caller*: `renderStar` was already a pure function. Progressive
 * refinement within a frame is the obvious next step from here.
 */

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

const DEFAULTS: Omit<RenderRequest, "lens"> = {
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  pupilSamples: 64,
  whiteFraction: 1 / 8000,
  seeingDOverR0: 0,
};

/**
 * The worker factories, at module scope so their identity is stable and Vite
 * can resolve each URL statically.
 */
const createStarWorker = () =>
  new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
const createBrightfieldWorker = () =>
  new Worker(new URL("./brightfield.worker.ts", import.meta.url), { type: "module" });

function StarCanvas({ request }: { request: RenderRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useLatestFromWorker<RenderRequest, RenderResult>(
    createStarWorker,
    request,
  );

  useEffect(() => {
    if (!result) return;
    const element = canvas.current;
    if (!element) return;
    element.width = result.size;
    element.height = result.size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copied into a fresh array: `ImageData` requires a plain ArrayBuffer
    // backing, and the engine's typed arrays are declared over ArrayBufferLike
    // so that they can cross the worker boundary this result just came through.
    const pixels = new Uint8ClampedArray(result.rgba);
    context.putImageData(new ImageData(pixels, result.size, result.size), 0, 0);
  }, [result]);

  const hue = result ? hueProfile(result.image) : [];
  const core = hue[0]?.x ?? 0;
  const halo = hue[Math.min(hue.length - 1, 12)]?.x ?? 0;

  return (
    <figure
      style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}
    >
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
        {result ? (
          <>
            <strong>{request.lens}</strong> · f/{result.fNumber.toFixed(1)}
            <br />
            Airy radius {(result.airyRadiusMm * 1000).toFixed(2)} µm ·{" "}
            {(result.pixelScaleMm * 1000).toFixed(3)} µm/px
            <br />
            chromatic spread <strong>{result.fringeAiryRadii.toFixed(1)}</strong> Airy radii
            <br />
            hue x: core {core.toFixed(3)} → halo {halo.toFixed(3)}{" "}
            {halo < core ? "(halo bluer)" : "(no drift)"}
            <br />
            {result.elapsedMs.toFixed(0)} ms
            {request.seeingDOverR0 > 0 && (
              <>
                <br />
                <span style={{ color: "#06a" }}>
                  atmosphere D/r₀ {request.seeingDOverR0.toFixed(1)} — one short-exposure
                  realization (a speckle, not the long-exposure disc)
                </span>
                <br />
                {/* The guard, shown as a live number rather than a warning that never
                    fires: the fixed 256²/oversize-4 screen keeps the step well under
                    ½ at every dial value, so the honest thing is to display where it
                    actually sits (engine number, red only if it ever crosses). */}
                <span style={{ color: result.seeingPhaseStepWaves >= 0.5 ? "#c00" : "#3a7" }}>
                  screen {result.seeingPhaseStepWaves >= 0.5 ? "UNDER-RESOLVED" : "resolved"} on the
                  FFT grid: {result.seeingPhaseStepWaves.toFixed(2)} waves/sample (limit ½)
                </span>
              </>
            )}
            {result.geometricWeight > 0 && (
              <>
                <br />
                <span style={{ color: "#a60" }}>
                  geometric branch {(result.geometricWeight * 100).toFixed(0)}% — the wavefront
                  aliases on this pupil grid
                </span>
              </>
            )}
            {result.truncatedFraction > 0.01 && (
              <>
                <br />
                <strong style={{ color: "#c00" }}>
                  {(result.truncatedFraction * 100).toFixed(0)}% of the light fell off the grid —
                  this image is not trustworthy. Raise pupil samples or stop down.
                </strong>
              </>
            )}
          </>
        ) : (
          <span>
            <strong>{request.lens}</strong> · tracing…
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * A field of identical stars, imaged through a PSF that changes across the
 * frame — so the on-axis star is a tight disk and the corner stars wear coma
 * tails that point radially outward, because that is what the achromat does off
 * axis. Nothing is drawn: the tails are where the light actually lands.
 *
 * The frame refines coarsest-first (`useRenderedField`), so a blocky preview
 * appears fast and sharpens in place rather than the panel sitting blank.
 */
function FieldCanvas({ request }: { request: FieldRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, refining } = useRenderedField(request);

  useEffect(() => {
    if (!result) return;
    const element = canvas.current;
    if (!element) return;
    element.width = result.size;
    element.height = result.size;
    const context = element.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(result.rgba);
    context.putImageData(new ImageData(pixels, result.size, result.size), 0, 0);
  }, [result]);

  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvas}
        style={{ width: 420, height: 420, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
        {result ? (
          <>
            <strong>{request.lens}</strong> field · f/{result.fNumber.toFixed(1)} ·{" "}
            {result.starCount} stars
            <br />
            {refining ? (
              <span style={{ color: "#a60" }}>
                refining {result.patches}×{result.patches} → {result.finestPatches}×
                {result.finestPatches}…
              </span>
            ) : (
              <>
                {result.finestPatches}×{result.finestPatches} field patches ·{" "}
                {result.psfEvaluations} PSFs · {result.elapsedMs.toFixed(0)} ms
              </>
            )}
          </>
        ) : (
          <span>
            <strong>{request.lens}</strong> field · tracing…
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * The microscope substrate — APP.md's A1, and the branch's first app surface.
 *
 * Not a picture: the thing every picture will sit on. One row per objective in
 * the ladder, every number read back off the trace, and the two columns that
 * decide what A2 can show — the crop the frame actually covers on the specimen,
 * and how many resolution cells wide it is.
 *
 * The whole catalogue is traced rather than one selected entry, because the
 * finding worth showing is a *comparison*: three rows share NA 0.10 and cover an
 * identical 93.5 µm while their image pixels scale exactly with magnification.
 * A selector would hide that behind a click.
 *
 * The three rows that fail are not omitted. § 6b's cemented-doublet ceiling and
 * § 6d's measured NA 0.343 wall are findings, and the engine states them in its
 * own error text — which is the honest thing to put in the cell.
 */
function MicroscopeTable({ pupilSamples, size }: { pupilSamples: number; size: number }) {
  const [rows, setRows] = useState<readonly FrameResult[] | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setRows(null);
    // Deferred one turn so the "tracing…" state paints first: this is ~400 ms of
    // real ray tracing on the main thread. `render.ts`'s panels earn a worker by
    // being re-run on a slider; this runs on a sampling change and does not.
    const id = setTimeout(() => {
      const started = performance.now();
      const next = describeCatalog(pupilSamples, size);
      setElapsedMs(performance.now() - started);
      setRows(next);
    }, 0);
    return () => clearTimeout(id);
  }, [pupilSamples, size]);

  const cell: React.CSSProperties = { padding: "3px 6px", textAlign: "right", whiteSpace: "nowrap" };
  const head: React.CSSProperties = { ...cell, borderBottom: "1px solid #ccc", color: "#444" };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>objective</th>
            <th style={head}>traced NA</th>
            <th style={head}>traced M</th>
            <th style={head}>crop (µm)</th>
            <th style={head}>cells</th>
            <th style={head}>specimen/px</th>
            <th style={head}>image/px</th>
            <th style={head}>λ/2NA</th>
            <th style={head}>σ axis</th>
            <th style={head}>σ corner</th>
            <th style={head}>drift</th>
            <th style={head}>lost</th>
          </tr>
        </thead>
        <tbody>
          {MICROSCOPE_CATALOG.map((entry, i) => {
            const row = rows?.[i];
            const na = entry.nominalNA;
            const m = entry.nominalMagnification;
            return (
              <tr key={entry.kind} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ ...cell, textAlign: "left" }}>
                  <strong>{entry.label}</strong>
                  <br />
                  <span style={{ color: "#777", fontSize: 11 }}>{entry.note}</span>
                </td>
                {!row ? (
                  <td style={{ ...cell, color: "#999" }} colSpan={11}>
                    tracing…
                  </td>
                ) : !row.ok ? (
                  // The engine's own message, in full. It carries the measured
                  // ceiling; a "not available" would carry nothing.
                  <td style={{ ...cell, textAlign: "left", color: "#c00", whiteSpace: "normal" }} colSpan={11}>
                    the engine refuses this design: {row.error}
                  </td>
                ) : (
                  <>
                    <td style={cell}>
                      {row.readout.tracedNA.toFixed(4)}
                      <br />
                      <span style={{ color: "#777" }}>
                        {relative(row.readout.tracedNA, na)}
                      </span>
                    </td>
                    <td style={cell}>
                      {row.readout.tracedMagnification.toFixed(2)}
                      <br />
                      <span style={{ color: "#777" }}>
                        {relative(Math.abs(row.readout.tracedMagnification), m)}
                      </span>
                    </td>
                    <td style={{ ...cell, fontWeight: 600 }}>{row.readout.objectSpanUm.toFixed(2)}</td>
                    <td style={cell}>{row.readout.resolutionCells.toFixed(1)}</td>
                    <td style={cell}>{row.readout.objectPixelNm.toFixed(1)} nm</td>
                    <td style={cell}>{row.readout.imagePixelUm.toFixed(3)} µm</td>
                    <td style={cell}>{row.readout.abbeResolutionNm.toFixed(0)} nm</td>
                    <td style={{ ...cell, color: row.readout.axisRmsWaves > MARECHAL_WAVES ? "#c00" : "#3a7" }}>
                      {row.readout.axisRmsWaves.toFixed(4)}
                    </td>
                    <td style={{ ...cell, color: row.readout.cornerRmsWaves > MARECHAL_WAVES ? "#c00" : "#3a7" }}>
                      {row.readout.cornerRmsWaves.toFixed(4)}
                    </td>
                    <td style={cell}>{row.readout.scaleDriftPixel.toExponential(1)}</td>
                    <td style={{ ...cell, color: row.readout.cornerLost > 0 ? "#a60" : "#777" }}>
                      {row.readout.cornerLost}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777" }}>
        {rows ? `${elapsedMs.toFixed(0)} ms for the whole catalogue` : "tracing the catalogue…"} ·
        λ = {LAMBDA_NM} nm · drift is what one common ruler costs across the frame · lost is rays
        vignetted at the corner
      </p>
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", maxWidth: 720 }}>
        σ is the RMS wavefront <em>as traced</em>, about its own mean at each system&rsquo;s own
        image plane — no best-focus solve, because that is the wavefront a render will actually see.
        The comparison against Maréchal&rsquo;s λ/14 = {MARECHAL_WAVES.toFixed(4)} waves is therefore
        one-sided: a balanced σ can only be smaller, so <span style={{ color: "#3a7" }}>green</span>{" "}
        means genuinely diffraction-limited and <span style={{ color: "#c00" }}>red</span> means
        &ldquo;not at this focus&rdquo;, not &ldquo;not correctable&rdquo;.
      </p>
    </div>
  );
}

/** The three verdict states, and `unknown` is not a shade of green. */
const VERDICT_COLOR = {
  valid: "#3a7",
  unknown: "#a60",
  "no-honest-image": "#c00",
} as const;

/**
 * Brightfield through a traced objective — APP.md's A2, the picture half.
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
          <span style={{ color: "#c00" }}>the engine refuses this render: {result.error}</span>
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
            <br />
            <span style={{ color: VERDICT_COLOR[readout!.verdict] }}>
              fidelity <strong>{readout!.verdict}</strong>
              {readout!.phaseStepWaves !== null && (
                <> · {readout!.phaseStepWaves.toFixed(3)} waves/pupil sample</>
              )}
            </span>
            <br />
            <span style={{ color: "#777" }}>{readout!.verdictReason}</span>
            <br />
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
        the engine refuses this objective: {sweep.error}
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

/** "+0.02%" — a traced number against the number on the label. */
function relative(traced: number, nominal: number): string {
  const d = (traced / nominal - 1) * 100;
  if (Math.abs(d) < 0.005) return "= label";
  return `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;
}

export default function App() {
  const [aperture, setAperture] = useState(DEFAULTS.apertureMm);
  const [temperature, setTemperature] = useState(DEFAULTS.sourceTemperatureK);
  const [wavelengths, setWavelengths] = useState(DEFAULTS.wavelengths);
  const [exposure, setExposure] = useState(8000);
  const [seeing, setSeeing] = useState(DEFAULTS.seeingDOverR0);
  // The microscope substrate's two axes. `pupilSamples` IS the frame's width in
  // resolution cells (§ 6h), so it is the only control that widens the crop;
  // `size` buys sampling on that same crop and nothing else.
  const [scopePupilSamples, setScopePupilSamples] = useState(32);
  const [scopeSize, setScopeSize] = useState(64);

  // A2's dials. The two sliders are the panel: S is the condenser diaphragm,
  // and `cycles` is how fine the specimen's detail is, in the same frequency
  // units the cutoff is quoted in.
  const [bfKind, setBfKind] = useState<MicroscopeKind>("din-4x-010");
  const [bfPupil, setBfPupil] = useState<PupilMode>("traced");
  const [bfPupilSamples, setBfPupilSamples] = useState(32);
  const [bfSize, setBfSize] = useState(128);
  const [bfSourceSamples, setBfSourceSamples] = useState(11);
  const [bfSRaw, setBfS] = useState(0.5);
  const [bfCyclesRaw, setBfCycles] = useState(8);

  // Both sliders are clamped by things the other controls decide, so the value
  // used is derived rather than corrected in an effect — a state write chasing
  // a state write is how a slider ends up fighting the finger holding it.
  // S's ceiling is `abbeImage`'s frequency-grid wall (it THROWS rather than
  // truncate, and a truncated pupil would read as a smaller aperture);
  // `cycles`'s is ν = 2, past which the pupil autocorrelation has no support.
  const bfMaxS = Math.min(
    1.5,
    Math.floor(maxCoherenceParameter(bfSize, bfPupilSamples, bfSourceSamples) / S_STEP) * S_STEP,
  );
  const bfMaxCycles = Math.min(bfPupilSamples, bfSize / 2 - 1);
  const bfS = Math.min(bfSRaw, bfMaxS);
  const bfCycles = Math.min(bfCyclesRaw, bfMaxCycles);

  const brightfield = useMemo<BrightfieldRequest>(
    () => ({
      kind: bfKind,
      pupilSamples: bfPupilSamples,
      size: bfSize,
      sourceSamples: bfSourceSamples,
      coherenceParameter: bfS,
      cycles: bfCycles,
      modulation: BRIGHTFIELD_MODULATION,
      pupil: bfPupil,
    }),
    [bfKind, bfPupilSamples, bfSize, bfSourceSamples, bfS, bfCycles, bfPupil],
  );

  // Everything the sweep depends on and nothing that only moves a marker: the
  // plot must not re-bisect on every tick of the S slider.
  const brightfieldSweep = useMemo(
    () => ({
      kind: bfKind,
      pupilSamples: bfPupilSamples,
      size: bfSize,
      sourceSamples: bfSourceSamples,
      pupil: bfPupil,
    }),
    [bfKind, bfPupilSamples, bfSize, bfSourceSamples, bfPupil],
  );

  // Each panel traces in its own worker (`useRenderedStar`), so the sliders
  // never touch the optical pipeline: the thumb tracks the finger and the panel
  // dims while its worker catches up. The request objects are memoised only so
  // their identity is stable between unrelated re-renders — the worker hook
  // keys its post on that identity.
  const requestFor = (lens: LensKind): RenderRequest => ({
    ...DEFAULTS,
    lens,
    apertureMm: aperture,
    sourceTemperatureK: temperature,
    wavelengths,
    whiteFraction: 1 / exposure,
    seeingDOverR0: seeing,
  });

  const singlet = useMemo(
    () => requestFor("singlet"),
    [aperture, temperature, wavelengths, exposure, seeing],
  );
  const achromat = useMemo(
    () => requestFor("achromat"),
    [aperture, temperature, wavelengths, exposure, seeing],
  );

  // The field panel shares the same sliders but renders the achromat across the
  // whole frame. `wavelengths` here are quadrature nodes, not SED weights — the
  // field renderer puts the source spectrum on each star (see `renderFieldScene`).
  const field = useMemo<FieldRequest>(
    () => ({
      lens: "achromat",
      focalLengthMm: DEFAULTS.focalLengthMm,
      apertureMm: aperture,
      sourceTemperatureK: temperature,
      wavelengths,
      pupilSamples: DEFAULTS.pupilSamples,
      patches: 4,
      starGrid: 5,
      whiteFraction: 1 / exposure,
    }),
    [aperture, temperature, wavelengths, exposure],
  );

  return (
    // Wider than the 900 the two-panel layout needed: the microscope table has
    // eleven columns and every one of them is a number the panel exists to show.
    // The prose keeps its own 640 maxWidth, so only the table gets the room.
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1240 }}>
      <h1 style={{ fontSize: 20 }}>One star, two lenses</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Same star, same aperture, same focus criterion, <strong>same exposure</strong>. The only
        difference is the glass: an equiconvex N-BK7 singlet against an N-BK7/F2 achromat whose
        powers are computed from the catalogue&rsquo;s own Abbe numbers. The violet halo is not
        drawn — it is where the short wavelengths actually land.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`aperture ${aperture.toFixed(0)} mm (f/${(100 / aperture).toFixed(1)})`}
          min={4}
          max={20}
          step={1}
          value={aperture}
          onChange={setAperture}
        />
        <Slider
          label={`source ${temperature} K`}
          min={3000}
          max={12000}
          step={200}
          value={temperature}
          onChange={setTemperature}
        />
        <Slider
          label={`${wavelengths} wavelengths`}
          min={3}
          max={15}
          step={2}
          value={wavelengths}
          onChange={setWavelengths}
        />
        <Slider
          label={`exposure 1/${exposure}`}
          min={1000}
          max={40000}
          step={1000}
          value={exposure}
          onChange={setExposure}
        />
        <Slider
          label={seeing === 0 ? "seeing off" : `seeing D/r₀ ${seeing.toFixed(1)}`}
          min={0}
          max={4}
          step={0.5}
          value={seeing}
          onChange={setSeeing}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <StarCanvas request={singlet} />
        <StarCanvas request={achromat} />
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 640 }}>
        Open the aperture and the singlet&rsquo;s halo grows as f·NA²; cool the source and the
        fringe reddens because the spectrum moved, not because anything was recoloured. Each panel
        traces in its own worker — the elapsed time is real, and it is why the panel dims while it
        catches up.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 640 }}>
        The <strong>seeing</strong> dial stamps an atmospheric phase screen — one Kolmogorov draw,
        scaled to the aperture — onto both star panels. It is a single short exposure, so what you
        see is a speckle, not the fuzzy long-exposure disc (that is an ensemble average, the next
        step). One screen serves the whole spectrum, and the blue speckles smear more because the
        same air is more wavelengths deep to them. The field panel below is left seeing-free for now.
      </p>

      <h1 style={{ fontSize: 20, marginTop: 40 }}>The same star, across the field</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Twenty-five <em>identical</em> stars imaged through the achromat at once. The only thing
        that changes star to star is where it sits in the field, so every difference in the picture
        is the optics: a tight disk on axis, a coma tail toward each corner that points radially
        outward and lengthens with field angle. The frame is convolved against a PSF that is
        re-traced for each patch of the field — a single shift-invariant blur could not show this.
      </p>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <FieldCanvas request={field} />
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 640 }}>
        The blocky first frame is a coarse patch grid; it sharpens in place as finer grids finish,
        so the cost of a field-varying PSF stays visible without leaving the panel blank. Widen the
        aperture to grow the coma, or move to the corners of the frame to watch it lengthen.
      </p>

      <h1 style={{ fontSize: 20, marginTop: 40 }}>The microscope bench: what a frame actually covers</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The microscope branch&rsquo;s objectives, every one of them traced. This is not a picture and
        not a view through an eyepiece — it is the <strong>substrate</strong> the pictures will sit
        on, and the number it exists to say out loud is the <strong>crop</strong>: how much specimen
        a rendered frame can hold. A brightfield frame spans <code>pupil samples</code> resolution
        cells and no more, because the illumination sum&rsquo;s grid <em>is</em> its frequency
        lattice — so unlike the star field above, it cannot be widened by choosing a coarser pixel.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The <strong>cells</strong> column is that claim, checked: crop ÷ λ/(2·NA), which lands on the
        pupil-sample count to within a percent for every dry objective here. The two immersion rows
        come in ~2.5× under it, and the panel does not paper over the gap — the frame&rsquo;s extent
        carries the wavelength <em>in the medium</em> as well, where λ/(2·NA) is quoted at the vacuum
        wavelength and lets the medium in through NA alone. Their crop is a <em>measurement</em>{" "}
        here, not a derivation; recovering the closed form is a physics question, and this panel adds
        no physics.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Read the three <strong>NA 0.10</strong> rows together: 4×, 10× and 20× cover an{" "}
        <em>identical</em> 93.5 µm while their image pixels scale exactly with magnification.
        Reaching for a stronger objective does not widen or narrow the crop — only NA moves it, and
        it moves the wrong way, so the objective that resolves best shows least. The 100×/1.40 oil
        holds 2.6 µm. A real 4× shows ~5 mm, so even at 128 samples this is a detail crop by a
        factor of thirteen, and any panel that called it a field of view would be lying.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label={`pupil samples ${scopePupilSamples} — the crop, in resolution cells`}
          options={[32, 64, 128]}
          value={scopePupilSamples}
          onChange={setScopePupilSamples}
        />
        <Choice
          label={`grid ${scopeSize}² — sampling on that same crop, not more of it`}
          options={[64, 128, 256]}
          value={scopeSize}
          onChange={setScopeSize}
        />
      </div>

      <MicroscopeTable pupilSamples={scopePupilSamples} size={scopeSize} />

      <p style={{ marginTop: 16, fontSize: 13, color: "#666", maxWidth: 640 }}>
        Move the grid and watch the crop <em>not</em> change: that is the constraint stated as an
        experiment. Move the pupil samples and it scales exactly, which is the only lever there is.
        Three rows carry an error instead of numbers — the cemented doublet has a focal-ratio
        ceiling and the Lister form a measured aperture wall, and where the engine refuses to build
        a design it says so in its own words rather than showing a blank.
      </p>

      <h1 style={{ fontSize: 20, marginTop: 40 }}>
        Brightfield: the condenser is not a brightness control
      </h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        A cosine absorption grating on the specimen, imaged through the objective above by summing
        over the directions the condenser lights it from. <strong>S</strong> is that condenser&rsquo;s
        aperture as a fraction of the objective&rsquo;s — the dial on the front of a real microscope
        — and <strong>ν</strong> is how fine the grating is, in units of NA/λ where 1 is the coherent
        limit and 2 is the incoherent one.
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
          options={MICROSCOPE_CATALOG.map((e) => e.kind)}
          value={bfKind}
          onChange={setBfKind}
          format={(k) => MICROSCOPE_CATALOG.find((e) => e.kind === k)!.label}
        />
        <Choice
          label="pupil — ideal is the only way to reach the unknown verdict"
          options={["traced", "ideal"] as const}
          value={bfPupil}
          onChange={setBfPupil}
        />
        <Choice
          label={`pupil samples ${bfPupilSamples}`}
          options={[32, 64]}
          value={bfPupilSamples}
          onChange={setBfPupilSamples}
        />
        <Choice
          label={`grid ${bfSize}² — also the headroom the shifted pupil needs`}
          options={[128, 256]}
          value={bfSize}
          onChange={setBfSize}
        />
        <Choice
          label={`source samples ${bfSourceSamples} across the diameter`}
          options={[7, 11, 15, 21]}
          value={bfSourceSamples}
          onChange={setBfSourceSamples}
        />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`condenser S = ${bfS.toFixed(2)}${bfMaxS < 1.5 ? ` (capped at ${bfMaxS.toFixed(2)} by the grid)` : ""}`}
          min={0}
          max={bfMaxS}
          step={S_STEP}
          value={bfS}
          onChange={setBfS}
        />
        <Slider
          label={`grating ${bfCycles} cycles — ν = ${frequencyOf(bfCycles, bfPupilSamples).toFixed(4)}`}
          min={1}
          max={bfMaxCycles}
          step={1}
          value={bfCycles}
          onChange={setBfCycles}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <BrightfieldCanvas request={brightfield} />
        <CutoffPlot
          request={brightfieldSweep}
          maxS={bfMaxS}
          coherenceParameter={bfS}
          nu={frequencyOf(bfCycles, bfPupilSamples)}
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
        <span style={{ color: VERDICT_COLOR.valid }}>valid</span> or{" "}
        <span style={{ color: VERDICT_COLOR["no-honest-image"] }}>no-honest-image</span> — the
        latter meaning the wavefront has left the regime a coherent sum describes, where a PSF would
        quietly cross-fade to a ray histogram and brightfield cannot, because rays carry no phase.
        Switch the pupil to <strong>ideal</strong> and the verdict reads{" "}
        <span style={{ color: VERDICT_COLOR.unknown }}>unknown</span>: a bare pupil function has no
        memory of what produced it, and this engine will not call that a clean bill of health. The
        ideal pupil is also ~3× faster, and its contrast is the ceiling the traced ones fall below —
        in wavefront order.
      </p>
    </main>
  );
}

/** A small radio row — for axes that take a few discrete values, not a range. */
function Choice<T extends string | number>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** How the button reads, when the value itself is a key rather than a label. */
  format?: (value: T) => string;
}) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
      {props.label}
      <br />
      {props.options.map((option) => (
        <button
          key={option}
          onClick={() => props.onChange(option)}
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            marginRight: 4,
            padding: "2px 8px",
            border: option === props.value ? "1px solid #333" : "1px solid #ccc",
            background: option === props.value ? "#333" : "#fff",
            color: option === props.value ? "#fff" : "#333",
            cursor: "pointer",
          }}
        >
          {props.format ? props.format(option) : option}
        </button>
      ))}
    </div>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ fontFamily: "monospace", fontSize: 12 }}>
      {props.label}
      <br />
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
