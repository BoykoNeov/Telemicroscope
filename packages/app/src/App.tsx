import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hueProfile,
  type FieldFrame,
  type FieldJob,
  type FieldRequest,
  type FieldResult,
  type LensKind,
  type RenderDone,
  type RenderJob,
  type RenderRequest,
  type RenderResult,
} from "./render";

/**
 * Runs one star through the worker, keeping the last good image on screen.
 *
 * Backpressure, not a queue: at most one render is in flight and at most one
 * request waits behind it — a newer request overwrites the waiting one, so the
 * intermediate values a slider emits mid-drag are dropped rather than traced in
 * turn. `seq` guards against a stale reply landing after a newer one. The main
 * thread never blocks, so the slider thumb stays glued to the finger; the panel
 * dims (`pending`) while it catches up.
 */
function useRenderedStar(request: RenderRequest): {
  result: RenderResult | null;
  pending: boolean;
} {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<RenderRequest | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [pending, setPending] = useState(true);

  const post = useCallback((req: RenderRequest) => {
    const worker = workerRef.current;
    if (!worker) return;
    seqRef.current += 1;
    busyRef.current = true;
    setPending(true);
    worker.postMessage({ seq: seqRef.current, request: req } satisfies RenderJob);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<RenderDone>) => {
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
  }, [post]);

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
 * first, then the finest), so this differs from `useRenderedStar` in one place
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

const DEFAULTS: Omit<RenderRequest, "lens"> = {
  focalLengthMm: 100,
  apertureMm: 10,
  sourceTemperatureK: 5800,
  wavelengths: 9,
  pupilSamples: 64,
  whiteFraction: 1 / 8000,
  seeingDOverR0: 0,
};

function StarCanvas({ request }: { request: RenderRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useRenderedStar(request);

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

export default function App() {
  const [aperture, setAperture] = useState(DEFAULTS.apertureMm);
  const [temperature, setTemperature] = useState(DEFAULTS.sourceTemperatureK);
  const [wavelengths, setWavelengths] = useState(DEFAULTS.wavelengths);
  const [exposure, setExposure] = useState(8000);
  const [seeing, setSeeing] = useState(DEFAULTS.seeingDOverR0);

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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 900 }}>
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
    </main>
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
