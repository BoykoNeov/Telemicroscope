import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker, useRenderedField } from "../hooks";
import { Slider } from "../ui";
import { linkHref, type TeachingLink } from "../teaching";
import { createStarWorker } from "../workers";
import {
  hueProfile,
  type FieldRequest,
  type LensKind,
  type RenderRequest,
  type RenderResult,
} from "../render";

/**
 * Ugly UI, correct physics — roadmap step 4, stated in those words.
 *
 * Every number on screen comes from the engine. Nothing here fakes, tints or
 * post-processes anything: the two canvases are the same pipeline the
 * validation ladder pins, run twice with one glass changed.
 *
 * Each panel traces in its own web worker, which keeps the cost off the main
 * thread without hiding it — the elapsed time is still displayed and the panel
 * dims while its worker catches up. That was only a change of *caller*:
 * `renderStar` was already a pure function. Progressive refinement within a
 * frame is the obvious next step from here.
 *
 * ## Since Part H this page is also the sender
 *
 * ROADMAP step 7 asks that every artifact in the image link to the plot that
 * explains it, and both artifacts it names by name are on this route: the halo
 * on the singlet's star, and the tails on the field's corner stars. Each link
 * carries the sliders' live values, so the plot on the other end is about *this*
 * lens (`teaching.ts` says why that is a correctness requirement and not a
 * nicety).
 *
 * The field image's hotspots sit on `FieldResult.stars` — where the renderer
 * says it put each star, from the same traced chief ray the rasterizer used.
 * Nothing here places a marker by eye, and a marker placed by eye is the thing
 * this app must never draw: it would be a claim about where an artifact is,
 * dressed as a measurement of it.
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

  // The artifact's own link, and it carries this canvas's sliders rather than
  // the panel's defaults — the two canvases differ only in `lens`, and a link
  // that lost that would send both of them to the same plot.
  const explain: TeachingLink = {
    lens: request.lens,
    focalLengthMm: request.focalLengthMm,
    apertureMm: request.apertureMm,
    sourceTemperatureK: request.sourceTemperatureK,
    wavelengths: request.wavelengths,
    fieldDeg: 0,
    from: "telescope",
  };

  return (
    <figure
      style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}
    >
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6 }}>
        {result ? (
          <>
            <strong>{request.lens}</strong> · f/{result.fNumber.toFixed(1)}
            <br />
            Airy radius {(result.airyRadiusMm * 1000).toFixed(2)} µm ·{" "}
            {(result.pixelScaleMm * 1000).toFixed(3)} µm/px
            <br />
            chromatic spread <strong>{result.fringeAiryRadii.toFixed(1)}</strong> Airy radii{" "}
            <a href={linkHref("chromatic", explain)} title="the plot that explains this number">
              why?
            </a>
            <br />
            hue x: core {core.toFixed(3)} → halo {halo.toFixed(3)}{" "}
            {halo < core ? "(halo bluer)" : "(no drift)"}
            <br />
            {result.elapsedMs.toFixed(0)} ms
            {request.seeingDOverR0 > 0 && (
              <>
                <br />
                <span style={{ color: "var(--accent)" }}>
                  atmosphere D/r₀ {request.seeingDOverR0.toFixed(1)} — one short-exposure
                  realization (a speckle, not the long-exposure disc)
                </span>
                <br />
                {/* The guard, shown as a live number rather than a warning that never
                    fires: the fixed 256²/oversize-4 screen keeps the step well under
                    ½ at every dial value, so the honest thing is to display where it
                    actually sits (engine number, red only if it ever crosses). */}
                <span style={{ color: result.seeingPhaseStepWaves >= 0.5 ? "var(--bad)" : "var(--ok)" }}>
                  screen {result.seeingPhaseStepWaves >= 0.5 ? "UNDER-RESOLVED" : "resolved"} on the
                  FFT grid: {result.seeingPhaseStepWaves.toFixed(2)} waves/sample (limit ½)
                </span>
              </>
            )}
            {result.geometricWeight > 0 && (
              <>
                <br />
                <span style={{ color: "var(--warn)" }}>
                  geometric branch {(result.geometricWeight * 100).toFixed(0)}% — the wavefront
                  aliases on this pupil grid
                </span>
              </>
            )}
            {result.truncatedFraction > 0.01 && (
              <>
                <br />
                <strong style={{ color: "var(--bad)" }}>
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
 * frame — so the on-axis star is a tight disk and the off-axis ones wear coma
 * tails that lengthen with field angle. Nothing is drawn: the tails are where
 * the light actually lands.
 *
 * The frame refines coarsest-first (`useRenderedField`), so a blocky preview
 * appears fast and sharpens in place rather than the panel sitting blank.
 *
 * ## The hotspots, and why they are allowed to be there
 *
 * Each star is covered by a transparent link to the ray fan at that star's own
 * field angle. Both halves of that come from `FieldResult.stars`, which the
 * renderer fills in from the traced chief ray it placed the star with — so the
 * hotspot is over the artifact because the engine says that is where the
 * artifact is. The ring is drawn at a fixed radius in CSS pixels and makes no
 * claim about the tail's size; it is a target, and the plot it opens is where
 * the measurement lives.
 */
const HOTSPOT_PX = 26;

function FieldCanvas({ request }: { request: FieldRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, refining } = useRenderedField(request);
  const displayPx = 420;

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
      <div style={{ position: "relative", width: displayPx, height: displayPx }}>
        <canvas
          ref={canvas}
          style={{
            width: displayPx,
            height: displayPx,
            imageRendering: "pixelated",
            background: "#000",
            display: "block",
          }}
        />
        {result?.stars.map((star) => {
          const scale = displayPx / result.size;
          return (
            <a
              key={`${star.xPx.toFixed(2)},${star.yPx.toFixed(2)}`}
              href={linkHref("rayfan", {
                lens: request.lens,
                focalLengthMm: request.focalLengthMm,
                apertureMm: request.apertureMm,
                sourceTemperatureK: request.sourceTemperatureK,
                wavelengths: request.wavelengths,
                fieldDeg: star.fieldDeg,
                from: "telescope",
              })}
              title={`field ${star.fieldDeg.toFixed(2)}° — open the ray fan for this star`}
              style={{
                position: "absolute",
                left: star.xPx * scale - HOTSPOT_PX / 2,
                top: star.yPx * scale - HOTSPOT_PX / 2,
                width: HOTSPOT_PX,
                height: HOTSPOT_PX,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            />
          );
        })}
      </div>
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6 }}>
        {result ? (
          <>
            <strong>{request.lens}</strong> field · f/{result.fNumber.toFixed(1)} ·{" "}
            {result.starCount} stars ·{" "}
            <span style={{ color: "var(--ink-4)" }}>click a star for its ray fan</span>
            <br />
            {refining ? (
              <span style={{ color: "var(--warn)" }}>
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
 * The two star surfaces are one route, not two, because they share one slider
 * row: the field panel is the same optics and the same dials with the frame
 * widened, and the prose below reads as a pair. Splitting them would duplicate
 * five sliders into two independent copies and lose the cross-reference.
 */
export function TelescopePanel() {
  const [aperture, setAperture] = useState(DEFAULTS.apertureMm);
  const [temperature, setTemperature] = useState(DEFAULTS.sourceTemperatureK);
  const [wavelengths, setWavelengths] = useState(DEFAULTS.wavelengths);
  const [exposure, setExposure] = useState(8000);
  const [seeing, setSeeing] = useState(DEFAULTS.seeingDOverR0);

  // Each panel traces in its own worker, so the sliders never touch the optical
  // pipeline: the thumb tracks the finger and the panel dims while its worker
  // catches up. The request objects are memoised only so their identity is
  // stable between unrelated re-renders — the worker hook keys its post on that
  // identity.
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
    <>
      <h1 style={{ fontSize: 20 }}>One star, two lenses</h1>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
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

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        Open the aperture and the singlet&rsquo;s halo grows as f·NA²; cool the source and the
        fringe reddens because the spectrum moved, not because anything was recoloured. Each panel
        traces in its own worker — the elapsed time is real, and it is why the panel dims while it
        catches up.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        The <strong>seeing</strong> dial stamps an atmospheric phase screen — one Kolmogorov draw,
        scaled to the aperture — onto both star panels. It is a single short exposure, so what you
        see is a speckle, not the fuzzy long-exposure disc (that is an ensemble average, the next
        step). One screen serves the whole spectrum, and the blue speckles smear more because the
        same air is more wavelengths deep to them. The field panel below is left seeing-free for now.
      </p>

      <h1 style={{ fontSize: 20, marginTop: 40 }}>The same star, across the field</h1>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        Twenty-five <em>identical</em> stars imaged through the achromat at once. The only thing
        that changes star to star is where it sits in the field, so every difference in the picture
        is the optics: a tight disk on axis, and a coma tail that lengthens with field angle. The
        frame is convolved against a PSF that is re-traced for each patch of the field — a single
        shift-invariant blur could not show this. <strong>Click any star</strong> to open its ray
        fan, at that star&rsquo;s own field angle and this panel&rsquo;s aperture.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        This paragraph used to end &ldquo;<s>points radially outward</s>&rdquo;, and building the
        ray fan is what caught it. On this achromat the tails point <strong>inward</strong>, toward
        the middle of the frame. Three measurements say so and none of them is this sentence: the
        ray fan&rsquo;s even half is negative at the pupil rim, the traced wavefront PSF&rsquo;s
        centre of light sits 2.52 µm on the axis side of the chief ray at 1.13°, and the centre of
        light of the stars in this very frame is 5–7 µm inward of where the renderer placed them.
        Which way a comet points is a property of the lens and not a rule of optics, and the
        original sentence had recited the rule.
      </p>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <FieldCanvas request={field} />
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        The blocky first frame is a coarse patch grid; it sharpens in place as finer grids finish,
        so the cost of a field-varying PSF stays visible without leaving the panel blank. Widen the
        aperture to grow the coma, or move to the corners of the frame to watch it lengthen.
      </p>
    </>
  );
}
