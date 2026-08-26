import { useEffect, useMemo, useRef, useState } from "react";
import { refusalVoice } from "../refusal";
import { objectiveOf, objectiveOptions, type ObjectiveId } from "../objective";
import { readSavedBuild } from "../saved";
import { useLatestFromWorker } from "../hooks";
import { toGrey } from "../fluorescence";
import {
  type EmitterReadout,
  type EmitterRequest,
  type EmitterResult,
  type EmitterShape,
} from "../emitter";
import { Choice, Fact, Guard, GUARD_COLOR, ObjectiveLine, Slider, thresholdLevel } from "../ui";
import { createEmitterWorker } from "../workers";

/**
 * A fluorescent source with a size — APP.md's Part Q.
 *
 * The panel next door images **points**: a bead is placed through its own traced
 * chief ray, and a point has no area to redistribute. This one images a
 * **density**, and the whole difference is one scalar per pixel — the area
 * element `(h/r)·(dh/dr)`, which is `1/M²` on the axis and departs from it by
 * exactly the distortion off axis.
 *
 * ## What the surface is for
 *
 * Two departures from one picture, side by side, and driving the controls shows
 * they are orthogonal — each moves on the axis the other is deaf to:
 *
 *  - the **flux residual** — the rasterized total against a closed form the
 *    optics cannot touch — which is the grid's, and is the *same number on every
 *    objective* (five figures);
 *  - the **Jacobian's worth** — the same grid with the area element replaced by
 *    the frame's uniform object cell — which is the lens's, flat to nine figures
 *    over ×4 of grid and spread 179× across the five objectives that run.
 *
 * The second is § 6as.5's negative control, and it is the reason the module
 * exists. It is also small — a few parts in 10⁵ at worst — which is § 6as.5's
 * own finding stated from the app's side: this is an error that no picture shows
 * and no test that lacked a rung would have caught.
 *
 * ## The one thing driving it added
 *
 * **The size and offset controls can walk the emitter off the frame**, and the
 * flux residual then reads the truncation rather than the sampling. A 23.4 µm
 * disc pushed 46.8 µm off axis sits entirely inside the 4×/0.10's crop and half
 * outside the 4×/0.20's, because § 6h fixes the crop at `pupilSamples·λ/(4·NA)`
 * and the higher aperture sees *less* specimen. The residual there is −0.52, and
 * without the reach guard below a reader would take that for a broken Jacobian.
 * The guard is a comparison of two numbers the readout already carried.
 */

/** Half a wave between adjacent transmitting samples — `abbeImage`'s own line. */
const GRID_STEP_LIMIT = 0.5;

/** White = peak ÷ this. 1 is peak-white; 16 lifts the wings into view. */
const STRETCHES = [1, 4, 16] as const;

const SHAPES: readonly EmitterShape[] = ["disc", "gaussian"];

function EmitterCanvas({
  values,
  size,
  peak,
  stretch,
  caption,
}: {
  values: Float64Array;
  size: number;
  peak: number;
  stretch: number;
  caption: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const white = peak / stretch;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = size;
    element.height = size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copied into a fresh buffer, for `BeadCanvas`'s reason: `ImageData` takes
    // ownership of what it is given, and these grids arrived by structured clone
    // and are remapped every time the stretch moves.
    const pixels = new Uint8ClampedArray(toGrey(values, size, white));
    context.putImageData(new ImageData(pixels, size, size), 0, 0);
  }, [values, size, white]);

  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption
        style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 320 }}
      >
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * The two errors, as a table, because the comparison between them is the claim.
 *
 * Printed with the control that separates them named in the row: one falls when
 * `grid` rises and one does not, and a reader who has not been told which is
 * which can find out in two clicks.
 */
function ErrorRows({ readout }: { readout: EmitterReadout }) {
  const clipped = readout.reachUm > readout.frameHalfUm;
  return (
    <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ color: "#777", textAlign: "left" }}>
          <th style={{ padding: "3px 14px 3px 0" }}>departure</th>
          <th style={{ padding: "3px 14px 3px 0" }}>measured</th>
          <th style={{ padding: "3px 14px 3px 0" }}>what it is</th>
          <th style={{ padding: "3px 0" }}>does the grid move it?</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ padding: "3px 14px 3px 0" }}>flux vs closed form</td>
          <td
            style={{
              padding: "3px 14px 3px 0",
              color: clipped ? GUARD_COLOR.warn : undefined,
            }}
          >
            {readout.fluxResidual.toExponential(3)}
          </td>
          <td style={{ padding: "3px 14px 3px 0", color: "#777" }}>
            {clipped
              ? "the frame, not the sampling — see the reach below"
              : "point sampling — the same on every objective"}
          </td>
          <td style={{ padding: "3px 0", color: "#3a7" }}>yes — and not monotonically</td>
        </tr>
        <tr>
          <td style={{ padding: "3px 14px 3px 0" }}>without the area element</td>
          <td style={{ padding: "3px 14px 3px 0" }}>
            {readout.jacobianWorth.toExponential(4)}
          </td>
          <td style={{ padding: "3px 14px 3px 0", color: "#777" }}>
            the distortion — § 6as.5&rsquo;s negative control, and it is this lens&rsquo;s
          </td>
          <td style={{ padding: "3px 0", color: "#a60" }}>no — nine figures flat</td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmitterPanel() {
  // Read once, at mount — `fluorescence.tsx`'s reason: `readSavedBuild` parses a
  // string, so a call during a render hands back a fresh spec object every time
  // and refires every effect keyed on the request.
  const [saved] = useState(readSavedBuild);
  const options = useMemo(() => objectiveOptions(saved), [saved]);
  const [kind, setKind] = useState<ObjectiveId>("din-4x-010");
  const objective = objectiveOf(options, kind);
  const spec = objective.spec;
  const [shape, setShape] = useState<EmitterShape>("disc");
  const [pupilSamples, setPupilSamples] = useState(64);
  const [sizeRaw, setSize] = useState(256);
  const [patches, setPatches] = useState(1);
  const [scaleUm, setScaleUm] = useState(23.4);
  const [offsetUm, setOffsetUm] = useState(0);
  const [stretch, setStretch] = useState<number>(1);

  // `incoherentPsf` throws rather than truncate a pupil that does not fit the
  // grid, so the grid follows the pupil rather than the panel walking into the
  // refusal. Derived, never written back into state — A4's note on why.
  const minSize = pupilSamples + 2 <= 128 ? 128 : 256;
  const size = Math.max(sizeRaw, minSize);

  const request = useMemo<EmitterRequest>(
    () => ({ spec, pupilSamples, size, patches, shape, scaleUm, offsetUm }),
    [spec, pupilSamples, size, patches, shape, scaleUm, offsetUm],
  );

  const { result, pending } = useLatestFromWorker<EmitterRequest, EmitterResult>(
    createEmitterWorker,
    request,
  );
  const readout = result?.ok ? result.readout : null;
  const clipped = readout !== null && readout.reachUm > readout.frameHalfUm;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The extended emitter: a source with a size</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The fluorescence panel images <em>points</em> — beads, each one placed through its own
        traced chief ray. This one images an <strong>emitter density</strong>: power per unit area
        of specimen, spread over a patch with a real size. That sounds like a small step and it is
        the one place on this branch where a Jacobian is unavoidable.{" "}
        <strong>A density has to be transformed, not just relocated.</strong> Warping one without
        the area element moves flux between pixels — light appears where the lens did not put it.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The area element is a single number per pixel, and the axial symmetry is why: a pixel at
        image radius <em>r</em> looks at object height <em>h</em>, and covers{" "}
        <code>(h/r)·(dh/dr)</code> of specimen per unit of image. On the axis both factors go to the
        same limit, so it is <strong>1/M²</strong> exactly — the objective&rsquo;s own nameplate
        magnification, a number from outside this engine, and the first thing printed below.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>Two departures are on screen, and they are orthogonal.</strong> A density&rsquo;s
        total flux has a closed form — <code>π·r²</code> for a disc, <code>π·w²/2</code> for a
        Gaussian — that no optic can touch, so the rasterized total can be weighed against it. That
        residual belongs to the <em>grid</em>: it is a count of lattice points inside a circle, it
        moves when you change the grid, and it is the <strong>same number on every objective
        here</strong>. Beside it sits the same grid with the area element thrown away, which is what
        a rasterizer written without thinking produces. That one belongs to the <em>lens</em>: no
        grid moves it at all, and it differs by 179× between the objectives in the list. Drive the
        grid control and then the objective control — each number ignores one of them.
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
          label="emitter"
          options={SHAPES}
          value={shape}
          onChange={setShape}
          format={(s) => (s === "disc" ? "uniform disc" : "Gaussian")}
        />
        <Choice
          label={`pupil samples ${pupilSamples} — also the crop, in resolution cells`}
          options={[16, 32, 64, 96]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={
            size > sizeRaw
              ? `grid ${size}² — floored here: a ${pupilSamples}-bin pupil needs ${pupilSamples + 2}`
              : `grid ${size}² — the control that separates the two errors`
          }
          options={[128, 256, 512]}
          value={size}
          onChange={setSize}
        />
        <Choice
          label={`patches ${patches}² — > 1 lets the pupil vary across the field`}
          options={[1, 2, 4]}
          value={patches}
          onChange={setPatches}
        />
        <Choice
          label={`display stretch — white = peak ÷ ${stretch}`}
          options={STRETCHES}
          value={stretch}
          onChange={setStretch}
          format={(v) => `×${v}`}
        />
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 12, maxWidth: 720 }}>
        <ObjectiveLine label={objective.label} note={objective.note} />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`${shape === "disc" ? "radius" : "1/e² waist"} ${scaleUm.toFixed(1)} µm`}
          min={0.5}
          max={100}
          step={0.5}
          value={scaleUm}
          onChange={setScaleUm}
        />
        <Slider
          label={`off axis ${offsetUm.toFixed(1)} µm — where the area element stops being 1/M²`}
          min={0}
          max={100}
          step={0.5}
          value={offsetUm}
          onChange={setOffsetUm}
        />
      </div>

      {result !== null && !result.ok && (
        <div
          style={{ fontFamily: "monospace", fontSize: 12, maxWidth: 700, marginBottom: 16 }}
        >
          <p style={{ color: GUARD_COLOR.bad }}>
            {refusalVoice(result.source, "this render")}: {result.error}
          </p>
          {result.headroom !== null && (
            <p style={{ color: "#777" }}>
              The frame&rsquo;s corner is{" "}
              <strong>{result.headroom.cornerRadiusMm.toFixed(4)} mm</strong> from the axis and this
              objective&rsquo;s chief ray reaches{" "}
              <strong>{result.headroom.fieldLimitMm.toFixed(4)} mm</strong> — a headroom of{" "}
              <strong style={{ color: GUARD_COLOR.bad }}>
                {result.headroom.fieldHeadroom.toFixed(2)}
              </strong>
              . The map has to cover the frame&rsquo;s <em>diagonal</em>, and this one does not fit
              inside the field. Headroom is exactly inverse in the crop, so halving pupil samples
              doubles it: the number above says how many halvings away this configuration is.
            </p>
          )}
        </div>
      )}

      {readout !== null && (
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
          <EmitterCanvas
            values={readout.object}
            size={readout.size}
            peak={readout.objectPeak}
            stretch={stretch}
            caption={
              <>
                <strong>as authored</strong> — the density, times the area element, per pixel
                <br />
                {readout.objectSpanUm.toFixed(2)} µm of specimen across the frame · object pixel{" "}
                {readout.objectPixelNm.toFixed(1)} nm
                <br />
                the emitter is <strong>{readout.emitterPixels.toFixed(1)}</strong> object pixels
                across its {shape === "disc" ? "radius" : "waist"}
                <br />
                <span style={{ color: clipped ? GUARD_COLOR.warn : "#777" }}>
                  reaches {readout.reachUm.toFixed(1)} µm of a {readout.frameHalfUm.toFixed(1)} µm
                  half frame
                  {clipped ? " — clipped" : ""}
                </span>
              </>
            }
          />
          <EmitterCanvas
            values={readout.intensity}
            size={readout.size}
            peak={readout.imagePeak}
            stretch={stretch}
            caption={
              <>
                <strong>as imaged</strong> — through the same chain the beads use, unchanged
                <br />
                NA {readout.tracedNA.toFixed(4)} · λ/2NA {readout.abbeResolutionNm.toFixed(0)} nm ·
                image pixel {readout.imagePixelUm.toFixed(3)} µm
                <br />
                peak fell <strong>{(readout.peakDrop * 100).toFixed(2)}%</strong> — the only number
                here about the optics
                <br />
                <span style={{ color: "#3a7" }}>
                  light conserved to {readout.lightResidual.toExponential(2)}
                </span>
                <br />
                <Guard
                  label="grid step"
                  value={`${readout.maxGridPhaseStepWaves.toFixed(4)} waves / sample`}
                  level={thresholdLevel(readout.maxGridPhaseStepWaves, GRID_STEP_LIMIT)}
                  detail={`the DFT lattice carries the pupil while this stays under ${GRID_STEP_LIMIT}`}
                />
                {readout.elapsedMs.toFixed(0)} ms
              </>
            }
          />
        </div>
      )}

      {readout !== null && (
        <div
          style={{
            marginTop: 20,
            opacity: pending ? 0.55 : 1,
            transition: "opacity 120ms ease-out",
          }}
        >
          <ErrorRows readout={readout} />
          <div
            style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 16, rowGap: 14 }}
          >
            <Fact
              label="area element on the axis"
              value={readout.detJAxis.toExponential(6)}
              note={`1/M² to ${readout.detJAxisAgainstM2.toExponential(1)} — M traced at ${readout.magnification.toFixed(6)}`}
            />
            <Fact
              label="across the frame"
              value={`${(readout.detJCornerDeparture * 100).toFixed(4)}%`}
              note="corner against axis — the distortion, in this currency"
            />
            <Fact
              label="field headroom"
              value={readout.fieldHeadroom.toFixed(2)}
              note={`chief ray reaches ${readout.fieldLimitMm.toFixed(3)} mm · frame corner ${readout.cornerRadiusMm.toFixed(3)} mm`}
            />
          </div>
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The area element on the axis is the objective&rsquo;s nameplate.</strong> Not
        approximately — the two factors of <code>(h/r)·(dh/dr)</code> go to the same limit there, so
        it is <code>(dh/dr)²</code> exactly, and what is left over is how far the <em>traced</em>{" "}
        magnification sits from the label. <em>On the DIN 4×/0.10 that is 6.4e−8</em>, which is
        twice the 1.6e−8 by which the traced M misses 4.000000: the Jacobian is right to the
        precision the magnification is known, not to its own.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>
          One of the two numbers is arithmetic and the other is the lens, and that split is what
          driving this panel showed.
        </strong>{" "}
        <em>
          Measured on an emitter a tenth of the half frame across, at pupil samples 64 and grid 256,
          on the five bench rows this surface reaches
        </em>
        : the sampling residual is <strong>−1.1110e−2 on every one of them, agreeing to five
        figures</strong>, and it tracks the emitter&rsquo;s radius <em>in pixels</em> — 12.8 pixels
        gives the same number on the 4×/0.10 and the 10×/0.10 at two different crops. It is not
        optics at all; it is the count of lattice points inside a circle, the Gauss circle problem,
        whose exponent is still open. Which is why it does not fall tidily either:{" "}
        <strong>+2.490e−3, −1.1110e−2, +1.032e−3</strong> across grids 128, 256 and 512, sign
        included. The Jacobian&rsquo;s worth, on the same pictures, spreads{" "}
        <strong>179×</strong> — 4.35e−9 on the DIN 4×/0.20 to 7.80e−7 on the infinity 10×/0.10 — and
        a Gaussian holds it flat to <strong>nine significant figures</strong> over that same ×4 of
        grid.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>
          Two of those five rows form a picture the grid step guard rejects, and the guard is the
          only thing on this page that says so.
        </strong>{" "}
        Everything above is read off the <em>authored</em> canvas — the density times the area
        element — which involves no DFT lattice and no pupil at all. The <em>imaged</em> canvas
        beside it does, and <code>abbeImage</code>&rsquo;s criterion is half a wave between adjacent
        transmitting samples. <em>Measured over every crop this panel offers</em>: the DIN 4×/0.10,
        the infinity 4×/0.10 and the infinity 10×/0.10 stay under it everywhere (worst 0.272), while
        the <strong>DIN 4×/0.15 runs 0.84 to 2.86 and the DIN 4×/0.20 runs 6.58 to 21.8</strong> —
        over the line at <em>every</em> setting, not at the extremes of one. Those two designs carry
        enough residual wavefront that the lattice cannot represent their pupil at any sampling this
        surface reaches. <strong>So the rasterizer reaches five objectives and the picture reaches
        three</strong>, and the guard turns red rather than the canvas being withheld — the numbers
        the panel is actually about are on the other canvas and stay true.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The negative control is small, and that is the finding rather than a let-off.</strong>{" "}
        Across those five rows, throwing the area element away costs between{" "}
        <strong>4.4e−9</strong> and <strong>2.7e−5</strong> of the flux, and{" "}
        <em>nothing on either canvas would look different</em>. That is exactly the shape of the
        defect § 6as.5 was written to catch: a rasterizer that treats the object grid as uniform is
        nearly right on the axis and wrong off it by precisely the distortion, and the only witness
        is a conservation number nobody would have printed. Pushing the emitter to 0.4 of the half
        frame multiplies it by <strong>35× to 380×</strong> depending on the objective —{" "}
        <em>the ordering holds on all five and the factor belongs to each design</em>, which is the
        same caution the tolerance sheet ends on: what travels is the direction, not the number.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>Whether this surface runs at all is a ratio, not a magnification.</strong> The
        rasterizer asks the map for every pixel&rsquo;s radius, so the table must cover the
        frame&rsquo;s <em>diagonal</em>; against that stands the largest image radius the
        objective&rsquo;s chief ray reaches. Both move with magnification and they move opposite
        ways — the crop is fixed in <em>object</em> millimetres, so the image-side corner grows as
        |M| while the field a high-power design reaches shrinks. <em>At the default crop, five of
        the bench&rsquo;s ten rows fit</em>; drop the sampling control to 16 and{" "}
        <em>seven of the nine that build</em> do, because headroom is exactly inverse in the crop.
        The infinity 20×/0.10 is the one to look at: it fails at pupil samples 32 with a headroom of{" "}
        <strong>0.99</strong>, missing by one percent. Two rows — the Lister 40×/0.20 and the 100×
        oil at NA 1.25 — never reach 1 at any crop offered here, and the 40×/0.40 Lister does not
        build at all, for a reason that is about its own form and predates this panel.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>What stays out.</strong> No spectrum: an emitter&rsquo;s <em>colour</em> does not
        vary with position here, which is what a two-stain preparation would need. No depth: this
        module warps a plane, and an emitter density through a focus stack needs the third dimension
        of the same Jacobian — which is not <code>(h/r)·(dh/dr)</code> and is not a scalar. And no
        absolute photon count, so every number on this page is a ratio. Those three are the engine
        step&rsquo;s own open list, unchanged by putting a surface on it.
      </p>
    </>
  );
}
