import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import { Choice, Guard, Slider, thresholdLevel } from "../ui";
import { createReflectorVignetteWorker, createReflectorWorker } from "../workers";
import {
  DISPERSION_FLOOR_AIRY_RADII,
  NEWTONIAN_FOCUS_OFFSET_FRACTION,
  chiefRayFieldLimitDeg,
  describeReflectors,
  newtonianObstruction,
  type ReflectorKind,
  type ReflectorRequest,
  type ReflectorResult,
  type ReflectorRow,
  type ReflectorSpec,
  type VignetteRequest,
  type VignetteSweep,
} from "../reflector";

/**
 * The reflectors — APP.md Part C's preset gap.
 *
 * Six designs have sat in `core/designs` since roadmap step 5 with no app
 * presence at all; the app instantiated one refractor and nothing else. This is
 * **app wiring only**: every number below is § 4b's, § 5e's, § 5f's, § 5g's,
 * § 5h's or § 5i's, and no validation rung was added because no capability was.
 *
 * The panel is a table of all six and a picture of one, for the reason
 * `reflector.ts` gives: building a reflector is closed-form arithmetic and
 * belongs on the main thread beside the slider, while tracing a star through one
 * is a worker's job. A1's bench made the same call the other way round because
 * there the cheap half was the one worth comparing.
 *
 * ## Its own aperture range, and why it differs from the star panel's
 *
 * `telescope.tsx` runs 4–20 mm because `refractorPair` is a toy lens whose
 * chromatic halo has to stay on an FFT grid. A 6 mm Newtonian is not a thing, so
 * this panel runs 100–400 mm — real amateur apertures — and the two sliders
 * deliberately do not share a range. That is exactly the confusion
 * `panels/registry.ts` describes two panels having had over `pupil samples`, and
 * routing is what keeps the ranges from being read as one control.
 */

const DEFAULT_SPEC: ReflectorSpec = { apertureMm: 200, focalRatio: 10, primaryFocalRatio: 4 };
const SOURCE_K = 5800;
const WAVELENGTHS = 5;
const PUPIL_SAMPLES = 64;

function num(value: number | undefined, digits: number): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

/**
 * The six, side by side. Everything here is closed-form construction — no trace,
 * no transform — so it repaints on the same tick as the slider that changed it.
 *
 * A row that cannot exist keeps its place and shows the engine's own sentence.
 * That is A1's convention: the Cassegrain family needs F > F₁ for its secondary
 * to magnify at all, and a design refusing to be built is a finding rather than
 * a blank.
 */
function ReflectorTable({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly ReflectorRow[];
  selected: ReflectorKind;
  onSelect: (kind: ReflectorKind) => void;
}) {
  return (
    <table style={{ fontFamily: "var(--mono)", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
          <th style={{ padding: "4px 10px 4px 0" }}>design</th>
          <th style={{ padding: "4px 10px 4px 0" }}>f (mm)</th>
          <th style={{ padding: "4px 10px 4px 0" }}>ε</th>
          <th style={{ padding: "4px 10px 4px 0" }}>surf</th>
          <th style={{ padding: "4px 10px 4px 0" }}>k₁</th>
          <th style={{ padding: "4px 10px 4px 0" }}>k₂</th>
          <th style={{ padding: "4px 10px 4px 0" }}>A₄ (1/mm³)</th>
          <th style={{ padding: "4px 0" }}>what it is</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.kind}
            onClick={() => !row.error && onSelect(row.kind)}
            style={{
              borderBottom: "1px solid var(--line-2)",
              cursor: row.error ? "default" : "pointer",
              background: row.kind === selected ? "var(--bg-2)" : undefined,
              color: row.error ? "var(--bad)" : undefined,
            }}
          >
            <td style={{ padding: "4px 10px 4px 0" }}>
              {row.kind === selected ? <strong>{row.label}</strong> : row.label}
              {row.folded && <span style={{ color: "var(--ink-4)" }}> ·folded</span>}
            </td>
            {row.error ? (
              <td colSpan={7} style={{ padding: "4px 0" }}>
                refused: {row.error}
              </td>
            ) : (
              <>
                <td style={{ padding: "4px 10px 4px 0" }}>{num(row.focalLengthMm, 0)}</td>
                <td style={{ padding: "4px 10px 4px 0" }}>
                  {row.obstruction === undefined ? "none" : row.obstruction.toFixed(4)}
                </td>
                <td style={{ padding: "4px 10px 4px 0" }}>{row.surfaces}</td>
                <td style={{ padding: "4px 10px 4px 0" }}>{num(row.primaryConic, 4)}</td>
                <td style={{ padding: "4px 10px 4px 0" }}>{num(row.secondaryConic, 4)}</td>
                <td style={{ padding: "4px 10px 4px 0" }}>
                  {row.correctorA4 === undefined ? "—" : row.correctorA4.toExponential(3)}
                </td>
                <td style={{ padding: "4px 0", color: "var(--ink-3)" }}>{row.note}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A star through the selected reflector, and the numbers that make it readable.
 *
 * On axis three of these six are *perfect* — a paraboloid images an infinitely
 * distant axial point with no aberration at all, and the confocal Cassegrain and
 * the RC are exactly stigmatic — so the picture is the Airy pattern of an
 * annulus and nothing else. Which is the point: what changes between the rows is
 * the obstruction, and the obstruction is visible as ring energy rather than as
 * blur.
 */
function StarCanvas({ request }: { request: ReflectorRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useLatestFromWorker<ReflectorRequest, ReflectorResult>(
    createReflectorWorker,
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
    // Copied into a fresh array: `ImageData` needs a plain ArrayBuffer backing,
    // and the engine's arrays are declared over ArrayBufferLike so they can
    // cross the worker boundary this result just came through.
    context.putImageData(
      new ImageData(new Uint8ClampedArray(result.rgba), result.size, result.size),
      0,
      0,
    );
  }, [result]);

  const coreLoss = result ? 1 - result.coreEnergy / result.clearCoreEnergy : 0;
  const dispersed = result ? result.dispersionAiryRadii >= DISPERSION_FLOOR_AIRY_RADII : false;
  // Two routes to the same fraction, and the gap between them is the readout —
  // an area integral over a masked pupil against a count of surviving rays.
  const routeGap = result ? Math.abs(result.transmittedFraction - result.rayFraction) : 0;

  return (
    <figure
      style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}
    >
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
        {result ? (
          <>
            f/{result.fNumber.toFixed(1)} · f {result.focalLengthMm.toFixed(0)} mm · Airy radius{" "}
            {(result.airyRadiusMm * 1000).toFixed(2)} µm
            <br />
            ε <strong>{result.obstruction.toFixed(4)}</strong> · Strehl{" "}
            {result.strehl.toFixed(4)} · {result.elapsedMs.toFixed(0)} ms
            <br />
            energy inside the clear Airy zero:{" "}
            <strong>{(result.coreEnergy * 100).toFixed(2)}%</strong> against{" "}
            {(result.clearCoreEnergy * 100).toFixed(2)}% at ε = 0
            {result.obstruction > 0 && (
              <>
                {" "}
                — the annulus moved <strong>{(coreLoss * 100).toFixed(1)}%</strong> of the core into
                the rings
              </>
            )}
            <br />
            <span style={{ color: "var(--ink-4)" }}>
              raw fringe measure {result.fringeAiryRadii.toFixed(3)} Airy radii — see the note
              below; it is not chromatism
            </span>
            <br />
            <span style={{ color: dispersed ? "var(--warn)" : "var(--ink-4)" }}>
              per-λ normalized: {result.dispersionAiryRadii.toExponential(2)}{" "}
              {dispersed ? "— the corrector disperses" : "— at the ruler's floor, not measured"}
            </span>
            {result.fieldDeg > 0 && (
              <>
                <br />
                field {result.fieldDeg.toFixed(3)}° · the diagonal passes{" "}
                <strong>{(result.transmittedFraction * 100).toFixed(2)}%</strong> of the on-axis
                light, and the trace lost {result.rayLost} of {result.rayRequested} rays
              </>
            )}
          </>
        ) : (
          <span>tracing…</span>
        )}
      </figcaption>

      {result && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          <Guard
            label="light off the grid"
            value={`${(result.truncatedFraction * 100).toFixed(2)}%`}
            level={thresholdLevel(result.truncatedFraction, 0.01)}
            detail="past 1% the skirt wraps rather than vanishing and the picture is not trustworthy"
          />
          <Guard
            label="geometric branch"
            value={`${(result.geometricWeight * 100).toFixed(0)}%`}
            level={result.geometricWeight > 0 ? "warn" : "ok"}
            detail="0% means the wavefront is resolved on this pupil grid and the FFT branch rules"
          />
          {result.spikeFirstZeroPx > 0 && (
            <Guard
              label="vane spike first zero"
              value={`${result.spikeFirstZeroPx.toFixed(0)} px of ${result.gridHalfPx}`}
              level={thresholdLevel(result.spikeFirstZeroPx, result.gridHalfPx)}
              detail={
                result.spikeFirstZeroPx >= result.gridHalfPx
                  ? "padFactor/widthFraction is past the grid edge: the spike is real and has left the frame, not been suppressed"
                  : "padFactor/widthFraction — where the streak's first dark point lands, independent of aperture and focal length"
              }
            />
          )}
          {result.fieldDeg > 0 && (
            <Guard
              label="FFT mask vs ray survivors"
              value={routeGap.toExponential(1)}
              level={thresholdLevel(routeGap, 0.02)}
              detail="two independent routes to one fraction: an area integral over the masked pupil, and a count of rays that physically cleared the diagonal"
            />
          )}
        </div>
      )}
    </figure>
  );
}

/**
 * Throughput against field, by two routes that share no code.
 *
 * § 2f's mechanism as a curve. The denominator of both is the **on-axis** bundle,
 * never the field's own — that ratio would be 1 by construction however badly the
 * diagonal were sized, which is the empty rung § 2f dissects at length. The
 * sweep's right-hand edge is not a slider bound but a **wall**: past the chief-ray
 * limit `opdMap` refuses, so there is no number to plot rather than a small one.
 */
function VignettePlot({ request }: { request: VignetteRequest }) {
  const { result, pending } = useLatestFromWorker<VignetteRequest, VignetteSweep>(
    createReflectorVignetteWorker,
    request,
  );
  if (!result) return <p style={{ fontFamily: "var(--mono)", fontSize: 12 }}>sweeping…</p>;

  const closed = chiefRayFieldLimitDeg(request.spec.focalRatio);
  const last = result.points[result.points.length - 1]!;
  return (
    <figure style={{ margin: 0, opacity: pending ? 0.55 : 1 }}>
      <Plot
        series={[
          {
            label: "FFT mask (masked pupil area)",
            color: "var(--accent)",
            points: result.points.map((p) => [p.fieldDeg, p.fftFraction] as const),
            dots: true,
          },
          {
            label: "ray survivors (no mask, no FFT)",
            color: "var(--warn-strong)",
            dash: [4, 3],
            points: result.points.map((p) => [p.fieldDeg, p.rayFraction] as const),
          },
        ]}
        markers={[
          {
            x: result.chiefRayLimitDeg,
            color: "var(--bad)",
            label: `chief ray dies ${result.chiefRayLimitDeg.toFixed(3)}°`,
          },
        ]}
        xLabel="field angle (deg)"
        yLabel="light transmitted, vs on axis"
        xMin={0}
        xMax={result.chiefRayLimitDeg * 1.05}
        yMin={0}
        yMax={1.05}
        width={460}
      />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6 }}>
        {result.elapsedMs.toFixed(0)} ms · throughput 1 → {last.fftFraction.toFixed(3)} out to{" "}
        {last.fieldDeg.toFixed(3)}°
        <br />
        <span style={{ color: "var(--ink-4)" }}>
          the two routes never part by more than {result.maxDisagreement.toExponential(2)}, and the
          gap grows with the clipping rather than sitting flat
        </span>
        <br />
        chief-ray wall: bisected <strong>{result.chiefRayLimitDeg.toFixed(6)}°</strong> against the
        closed form <strong>{closed.toFixed(6)}°</strong> (
        {Math.abs(result.chiefRayLimitDeg / closed - 1).toExponential(1)})
      </figcaption>
    </figure>
  );
}

/** Vane widths as 1/n of the pupil diameter — § 5c's own units. */
const VANE_DENOMINATORS = [8, 12, 20, 30, 50] as const;

export function ReflectorPanel() {
  const [apertureMm, setApertureMm] = useState(DEFAULT_SPEC.apertureMm);
  const [focalRatio, setFocalRatio] = useState(DEFAULT_SPEC.focalRatio);
  const [primaryFocalRatio, setPrimaryFocalRatio] = useState(DEFAULT_SPEC.primaryFocalRatio);
  const [kind, setKind] = useState<ReflectorKind>("cassegrain");
  const [obstruct, setObstruct] = useState(true);
  const [vanes, setVanes] = useState(4);
  const [vaneDenominator, setVaneDenominator] = useState<number>(12);
  const [vaneAngleDeg, setVaneAngleDeg] = useState(0);
  // The field control is a FRACTION of the chief-ray wall rather than a degree
  // range, because the wall moves by an order across the focal-ratio slider
  // (2.68° at f/4, 0.147° at f/15) and a fixed degree range would be mostly
  // invalid at one end and mostly unused at the other. The closed form is exact
  // to 5e-13 against the engine's own bisection, so driving the control with it
  // is not an approximation — and the plot below shows the two agreeing.
  const [fieldFraction, setFieldFraction] = useState(0);

  const spec = useMemo<ReflectorSpec>(
    () => ({ apertureMm, focalRatio, primaryFocalRatio }),
    [apertureMm, focalRatio, primaryFocalRatio],
  );
  // Six closed-form layouts: cheap enough to rebuild on every tick, which is why
  // this is not in the worker. See `reflector.ts`'s header.
  const rows = useMemo(() => describeReflectors(spec), [spec]);
  const selected = rows.find((row) => row.kind === kind);

  // A slider can make the selected design impossible (drag F below F₁ and the
  // whole Cassegrain family has no geometry). Fall back to the Newtonian, which
  // needs only D and F and therefore cannot refuse — rather than posting a job
  // that would throw inside the worker.
  const drawable = selected && !selected.error ? kind : "newtonian";

  // Only the Newtonian's diagonal is a *minimum* one sized to the on-axis cone,
  // so it is the only member of the six whose field vignettes at all here — the
  // Cassegrain family's secondary is round and centred and clips nothing. The
  // field control therefore applies to the Newtonian and reads zero elsewhere.
  const wallDeg = chiefRayFieldLimitDeg(focalRatio);
  const fieldDeg = drawable === "newtonian" ? fieldFraction * wallDeg : 0;

  const request = useMemo<ReflectorRequest>(
    () => ({
      kind: drawable,
      spec,
      sourceTemperatureK: SOURCE_K,
      wavelengths: WAVELENGTHS,
      pupilSamples: PUPIL_SAMPLES,
      whiteFraction: 1 / 8000,
      obstruct,
      fieldDeg,
      ...(vanes > 0
        ? { spider: { vanes, widthFraction: 1 / vaneDenominator, angleDeg: vaneAngleDeg } }
        : {}),
    }),
    [drawable, spec, obstruct, fieldDeg, vanes, vaneDenominator, vaneAngleDeg],
  );

  const vignette = useMemo<VignetteRequest>(
    () => ({
      kind: "newtonian",
      spec,
      maxFieldDeg: wallDeg,
      points: 9,
      pupilSamples: 64,
      rayGrid: 101,
    }),
    [spec, wallDeg],
  );

  const newt = rows.find((row) => row.kind === "newtonian");
  const closedForm = newtonianObstruction(focalRatio);
  const sagShare = closedForm / (NEWTONIAN_FOCUS_OFFSET_FRACTION / focalRatio) - 1;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Six reflectors, from three numbers</h1>
      <p style={{ maxWidth: 680, color: "var(--ink-2)" }}>
        Every radius, conic, separation and obstruction below is <em>derived</em> — nothing is
        transcribed from a design table, because for these forms there is nothing to transcribe. Two
        of the three numbers are shared by all six; the third, the primary&rsquo;s own focal ratio,
        exists because a Cassegrain&rsquo;s secondary magnifies and there is no single
        &ldquo;focal ratio&rdquo; that means the same thing to a Newtonian and an SCT. Drag F below
        F₁ and that family stops existing, in the engine&rsquo;s own words.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Slider
          label={`aperture ${apertureMm} mm`}
          min={100}
          max={400}
          step={25}
          value={apertureMm}
          onChange={setApertureMm}
        />
        <Slider
          label={`system f/${focalRatio.toFixed(1)}`}
          min={4}
          max={15}
          step={0.5}
          value={focalRatio}
          onChange={setFocalRatio}
        />
        <Slider
          label={`primary f/${primaryFocalRatio.toFixed(2)} (Cassegrain family only)`}
          min={2.5}
          max={5}
          step={0.25}
          value={primaryFocalRatio}
          onChange={setPrimaryFocalRatio}
        />
        <Choice
          label="central obstruction"
          options={["design", "ε = 0 control"] as const}
          value={obstruct ? "design" : "ε = 0 control"}
          onChange={(value) => setObstruct(value === "design")}
        />
      </div>

      <ReflectorTable rows={rows} selected={drawable} onSelect={setKind} />

      <h1 style={{ fontSize: 20, marginTop: 36 }}>
        {selected?.error ? "Newtonian" : (selected?.label ?? "Newtonian")}, on axis
      </h1>
      <p style={{ maxWidth: 680, color: "var(--ink-2)" }}>
        Click a row to trace it. Three of these six are <strong>perfect</strong> on axis — a
        paraboloid images an infinitely distant axial point with zero aberration, and the confocal
        Cassegrain and the Ritchey-Chrétien are exactly stigmatic — so the Strehl reads 1 and what
        you are looking at is the Airy pattern of an <em>annulus</em>. Switch the obstruction to its
        ε = 0 control and the rings dim while the core fills: the secondary&rsquo;s only on-axis
        effect is where the light sits, and it is measured beside the picture rather than described.
      </p>

      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          marginBottom: 16,
          alignItems: "flex-start",
        }}
      >
        <Choice
          label="spider vanes"
          options={[0, 3, 4, 6]}
          value={vanes}
          onChange={setVanes}
          format={(n) => (n === 0 ? "none" : String(n))}
        />
        <Choice
          label="vane width (of D)"
          options={VANE_DENOMINATORS}
          value={vaneDenominator}
          onChange={setVaneDenominator}
          format={(n) => `1/${n}`}
        />
        <Choice
          label="vane azimuth"
          options={[0, 30, 45]}
          value={vaneAngleDeg}
          onChange={setVaneAngleDeg}
          format={(n) => `${n}°`}
        />
        {drawable === "newtonian" && (
          <Slider
            label={`field ${fieldDeg.toFixed(3)}° — ${(fieldFraction * 100).toFixed(0)}% of the ${wallDeg.toFixed(3)}° wall`}
            min={0}
            max={0.95}
            step={0.05}
            value={fieldFraction}
            onChange={setFieldFraction}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <StarCanvas request={request} />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 36 }}>The spikes are not drawn</h2>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        A vane is an opaque bar, the transform of a bar is a streak <em>perpendicular</em> to it, and
        the FFT produces the streak for the same reason it produces the Airy rings — so four vanes
        give a four-arm cross on the axes while three, which cannot pair into diameters, give a
        six-arm star. Turn the azimuth to 30° and the arms move to 120°, not to 60°: the spike runs
        ⊥ to the vane, and the two would sit on top of each other at the tempting 45°. Nothing in
        this panel or in the engine knows the word &ldquo;spike&rdquo;; the same predicate that zeroes
        the FFT amplitude is what the geometric branch drops rays on, which is why the two branches
        cannot disagree about where the vanes are.
      </p>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        The guard beside the picture is the honest part, and it is a measurement rather than a
        warning. A streak&rsquo;s first dark point sits at <code>padFactor/widthFraction</code>{" "}
        pixels — no aperture and no focal length in it — so a fat 1/8 vane puts it 32 px out and a{" "}
        <em>realistic</em> 1/50 one puts it at 200 px, past the edge of a 256-pixel grid. § 5c sizes
        its validation vanes fat for exactly this reason. When that guard is red the spike has not
        been suppressed, it has left the frame: correct physics, off-screen, and worth saying so
        rather than letting a reader conclude thin vanes are clean.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 36 }}>
        The diagonal clips off axis, and then it stops passing the chief ray
      </h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)" }}>
        There is <strong>no vignetting control</strong> on this panel, and that is § 2f&rsquo;s
        design rather than an omission: <code>psf()</code> builds a vignette mask by itself and only
        when the trace has already lost rays, so the criterion <em>is</em> the trace. A minimum
        diagonal is sized to the on-axis cone, so a field angle is the whole input — and both curves
        below are measured against the <em>on-axis</em> bundle, never against the field&rsquo;s own,
        which would be 1 by construction however badly the diagonal were sized.
      </p>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <VignettePlot request={vignette} />
      </div>

      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)", marginTop: 16 }}>
        The red rule is a <strong>wall</strong>, not the end of a slider. The chief ray defines both
        the image point and the reference sphere, so when it misses the diagonal the engine has no
        wavefront to be right or wrong about and <code>opdMap</code> refuses outright. That happens
        at <code>tan θ = (√2·k/2) / [(F − ½ − 1/(16F))·(F − k)]</code> — derived from § 4b&rsquo;s own
        footprint sizing, with <strong>D cancelling again</strong> — and the engine&rsquo;s bisection
        lands on it to 5e-13. So it is the sixth ceiling of this kind in the repo, after § 6b&rsquo;s
        f/4.1, § 6d&rsquo;s NA 0.343, § 6e.4&rsquo;s NA 1.411, § 6q&rsquo;s 0.88·f_e and § 6l&rsquo;s
        1.3347, and like the last of those it is one line of geometry rather than an aberration
        budget: at the wall the wavefront is an ordinary number and the rays simply stop existing.
      </p>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        It closes as <strong>1/F²</strong> — 2.681° at f/4 against 0.147° at f/15, with the local
        power running 2.34, 2.20 then 2.11 as F grows, approaching 2 from above because the exact form
        carries an extra (F − k). Which runs <em>opposite</em> to the coma § 4b pins at θ·D/(32F²): a
        fast Newtonian is comatic sooner per degree while its minimum diagonal passes several times
        more field. Both effects carry 1/F² and point opposite ways, so &ldquo;how fast should a
        Newtonian be&rdquo; has no answer that is only about aberration — and the mechanical number k
        is in one of them and not the other.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 36 }}>
        The Newtonian&rsquo;s obstruction contains no aperture
      </h2>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        Working § 4b&rsquo;s diagonal sizing through by hand, D cancels:{" "}
        <code>ε = (k/F) / (1 − 1/(16·F²))</code> with k = {NEWTONIAN_FOCUS_OFFSET_FRACTION} the
        default focus offset as a fraction of the aperture. At f/{focalRatio.toFixed(1)} that is{" "}
        <strong>{closedForm.toFixed(6)}</strong> and the engine builds{" "}
        <strong>{num(newt?.obstruction, 6)}</strong> — the app deriving what the engine computed,
        not quoting it. Move the aperture slider and neither number changes.
      </p>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        So a Newtonian&rsquo;s obstruction is a <strong>mechanical</strong> convention divided by the
        focal ratio — where the focal plane has to sit off the axis — and not an optical choice at
        all. The Cassegrain family&rsquo;s ε = s₁/f₁ is the opposite: it falls out of the
        magnification the two mirrors must supply, which is why at f/10 the Newtonian&rsquo;s{" "}
        {num(newt?.obstruction, 3)} is about a quarter of theirs. The sag term is the interesting
        half — a pure number, so also aperture-free, worth{" "}
        <strong>{(sagShare * 100).toFixed(3)}%</strong> here, and it is the 0.25%-at-f/5 that{" "}
        <code>newtonian.ts</code> derived to separate a diagonal that catches the beam from one that
        shaves it.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>
        The fringe number is not a chromatism measure, and a mirror proves it
      </h2>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        The star panel reports a chromatic spread in Airy radii, and reading it here found it is not
        what it looks like: a Newtonian, which contains <em>no glass</em>, reads about 0.36 Airy
        radii of &ldquo;fringing&rdquo;. The denominator is one Airy radius — the focus
        wavelength&rsquo;s — while the Airy pattern itself scales as λ, so red diffracting wider than
        blue is counted as dispersion. Nothing is wrong with § 3b&rsquo;s use of it, where a singlet
        and an achromat share the floor and it cancels in the comparison; as an absolute number it
        does not, and a panel with no second lens beside it is what exposes that.
      </p>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        Dividing each plane by <em>its own</em> Airy radius removes λ, and then the three all-mirror
        members read {DISPERSION_FLOOR_AIRY_RADII.toFixed(2)}-ish and below while the two
        corrector-bearing ones climb clear of it. That residue is the <em>ruler</em>, not the
        optics: <code>spectralStack</code> resamples every plane onto the mean wavelength&rsquo;s
        physical grid, cropping red where it pads blue, and the number wanders non-monotonically as
        the grid refines instead of falling. So it is refused rather than subtracted. The control
        that settles it is free — a Cassegrain and a Ritchey-Chrétien differ <em>only</em> in their
        two conic constants, and a conic has no refractive index, so the two must read essentially
        one figure. They agree to <strong>1.3e-5</strong> of each other, four orders under the
        corrector&rsquo;s excess on the same layout. Not <em>exactly</em>, and the miss is the
        informative part: different conics make different wavefronts, so the two PSFs are different
        shapes and the common-grid crop bites slightly differently on each. What survives the
        control is the ruler reacting to a different picture — still not dispersion, because neither
        system has an index anywhere in it.
      </p>
      <p style={{ maxWidth: 680, fontSize: 13, color: "var(--ink-3)" }}>
        What is left above the floor tracks the corrector&rsquo;s own figure. Sweeping the primary
        from f/4 to f/2.5 strengthens A₄ by 4.7× and the excess grows as roughly{" "}
        <strong>A₄²</strong> — an implied power of 2.07, 1.92 then 1.45 as the plate steepens and
        the small-aberration form saturates. Since A₄ ∝ F₁⁻³ that is F₁⁻⁶, which is why this slow
        f/10 Schmidt camera sits <em>at</em> the floor with a corrector in it while an SCT on an
        f/4 primary sits three times above.
      </p>
    </>
  );
}
