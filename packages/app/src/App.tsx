import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hueProfile,
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

export default function App() {
  const [aperture, setAperture] = useState(DEFAULTS.apertureMm);
  const [temperature, setTemperature] = useState(DEFAULTS.sourceTemperatureK);
  const [wavelengths, setWavelengths] = useState(DEFAULTS.wavelengths);
  const [exposure, setExposure] = useState(8000);

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
  });

  const singlet = useMemo(
    () => requestFor("singlet"),
    [aperture, temperature, wavelengths, exposure],
  );
  const achromat = useMemo(
    () => requestFor("achromat"),
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
