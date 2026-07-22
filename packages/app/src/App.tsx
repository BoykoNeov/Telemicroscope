import { useEffect, useMemo, useRef, useState } from "react";
import { hueProfile, renderStar, type LensKind, type RenderRequest } from "./render";

/**
 * Ugly UI, correct physics — roadmap step 4, stated in those words.
 *
 * Every number on screen comes from the engine. Nothing here fakes, tints or
 * post-processes anything: the two canvases are the same pipeline the
 * validation ladder pins, run twice with one glass changed.
 *
 * It renders synchronously on the main thread, which is honest about the cost
 * rather than hiding it — the elapsed time is displayed. A worker and
 * progressive refinement are the obvious next step and `renderStar` is already
 * a pure function, so that is a change of caller, not of code.
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
  const result = useMemo(() => renderStar(request), [request]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = result.size;
    element.height = result.size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copied into a fresh array: `ImageData` requires a plain ArrayBuffer
    // backing, and the engine's typed arrays are declared over ArrayBufferLike
    // so that they can cross a worker boundary later.
    const pixels = new Uint8ClampedArray(result.rgba);
    context.putImageData(new ImageData(pixels, result.size, result.size), 0, 0);
  }, [result]);

  const hue = hueProfile(result.image);
  const core = hue[0]?.x ?? 0;
  const halo = hue[Math.min(hue.length - 1, 12)]?.x ?? 0;

  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
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
      </figcaption>
    </figure>
  );
}

export default function App() {
  const [aperture, setAperture] = useState(DEFAULTS.apertureMm);
  const [temperature, setTemperature] = useState(DEFAULTS.sourceTemperatureK);
  const [wavelengths, setWavelengths] = useState(DEFAULTS.wavelengths);
  const [exposure, setExposure] = useState(8000);

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
        fringe reddens because the spectrum moved, not because anything was recoloured. Both
        panels render on the main thread — the elapsed time is real.
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
