import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import {
  toGrey,
  type FluorescenceReadout,
  type FluorescenceRequest,
  type FluorescenceResult,
  type TransferRequest,
  type TransferResult,
} from "../fluorescence";
import { MICROSCOPE_CATALOG, type MicroscopeKind } from "../microscope";
import { Plot } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider, thresholdLevel } from "../ui";
import { createFluorescenceSweepWorker, createFluorescenceWorker } from "../workers";

/**
 * Fluorescent beads through a traced objective — APP.md's A4.
 *
 * The first surface in this app that looks like a microscope photograph rather
 * than a test chart, and the thing to know before reading it is that **nothing
 * on the canvas is drawn**. Every blob is one point emitter convolved with the
 * objective's own incoherent PSF, so the picture is as many independent copies
 * of that kernel as there are beads, placed by the trace.
 *
 * Two of A2's and A3's conventions are deliberately broken here, and both are
 * about the fact that a bead field is *sparse*:
 *
 *  - **White comes from the image's peak, not from twice its mean.** Measured on
 *    the default scene, a single bead's peak runs 12.7× the frame mean at pupil
 *    samples 32 and 99.5× at 128, so white = 2·mean would clip every bead into a
 *    flat disc and the panel whose whole claim is *"each blob is the PSF"* would
 *    show discs with no PSF in them.
 *  - **The stretch is a display control, and it does not re-run the optics.**
 *    The worker returns the intensity grid rather than pixels, so moving the
 *    stretch remaps the same numbers. Re-tracing an objective to change a grey
 *    scale would make a display choice cost an optical render.
 *
 * And one is kept exactly: no verdict is minted. § 6i mints none — incoherent
 * imaging has a geometric branch to fall back to where brightfield does not —
 * and APP.md says this panel must not invent one. The wavefront numbers are on
 * screen as wavefront numbers; the only `Guard` is `maxGridPhaseStepWaves`.
 */

/** Half a wave between adjacent transmitting samples — `abbeImage`'s own line. */
const GRID_STEP_LIMIT = 0.5;

/**
 * Pixels per resolution cell below which the picture's brightness is mostly the
 * rasterizer, and the panel has to say so.
 *
 * `rasterizeEmitters` splats bilinearly, which is `imaging/scene`'s convention
 * and right — a bead between pixels must land between pixels, or moving one
 * produces a brightness jitter that looks exactly like scintillation. But the
 * splat still spreads a point over up to four pixels, and how much that costs
 * the *peak* depends entirely on how many pixels the PSF spans. Measured on the
 * DIN 4×, one bead walked across a pixel in eighths:
 *
 * | pixels per Abbe distance | peak spread |
 * |---|---|
 * | 2.01 (grid 128, ps 64) | **19.1%** |
 * | 4.02 (grid 128, ps 32) | 5.7% |
 * | 8.04 (grid 256, ps 32) | 1.5% |
 *
 * That matters because the corner-vs-axis kernel drop this panel reports is
 * 0.2–9.3% depending on the objective and the crop. At two pixels per cell the
 * splat jitter is *larger than the optics*, so a reader comparing two blobs by
 * eye would be reading the sub-pixel placement. The kernel peaks below are
 * computed from the pupils directly and are unaffected; the warning is about the
 * picture, and it is the reason `grid` is worth raising even though § 6h says it
 * buys no field.
 */
const PIXELS_PER_CELL_FLOOR = 3;

/** White = peak ÷ this. 1 is peak-white; 16 lifts the wings into view. */
const STRETCHES = [1, 4, 16] as const;

function BeadCanvas({
  readout,
  stretch,
  pending,
}: {
  readout: FluorescenceReadout;
  stretch: number;
  pending: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const white = readout.peak / stretch;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = readout.size;
    element.height = readout.size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copied into a fresh buffer: `ImageData` takes ownership of what it is
    // given, and the intensity grid it was mapped from arrived by structured
    // clone and is remapped every time the stretch moves.
    const pixels = new Uint8ClampedArray(toGrey(readout.intensity, readout.size, white));
    context.putImageData(new ImageData(pixels, readout.size, readout.size), 0, 0);
  }, [readout, white]);

  return (
    <canvas
      ref={canvas}
      style={{
        width: 380,
        height: 380,
        imageRendering: "pixelated",
        background: "#000",
        opacity: pending ? 0.55 : 1,
        transition: "opacity 120ms ease-out",
      }}
    />
  );
}

/**
 * The transfer against ν — A4's second job, on A2's and A3's own axis.
 *
 * Three curves and the comparison is the whole point: fluorescence rolls off
 * smoothly to **ν = 2 with no condenser in the instrument**, where brightfield
 * with the diaphragm shut is flat at 1 and then falls off a cliff at ν = 1. The
 * measured series is not the closed form re-plotted — it is `imageHarmonic` read
 * off a rendered image of `cosineGratingEmitters` through the same traced pupil
 * the picture used, so the gap below the closed form is the objective.
 *
 * In a **worker**, where A2's and A3's sweeps run on the main thread behind a
 * deferral. Theirs are pupil sums costing 190 ms and 20 ms; this one renders an
 * image per frequency and measures 1.3 s at pupil samples 64 and 2.0 s at 128.
 * On the main thread that froze the page on every objective change — found by
 * driving the panel, not by reading the timings.
 */
function TransferPlot({ request }: { request: TransferRequest }) {
  const { result: sweep } = useLatestFromWorker<TransferRequest, TransferResult>(
    createFluorescenceSweepWorker,
    request,
  );

  if (sweep === null) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
        imaging a grating at every frequency…
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
  const cutoffReached = Number.isFinite(sweep.sweep.atCutoff);
  return (
    <div>
      <Plot
        series={[
          {
            label: "brightfield, diaphragm shut",
            color: "#06a",
            points: p.map((q) => [q.nu, q.brightfieldCoherent] as const),
            dash: [5, 4],
          },
          {
            label: "ideal pupil (closed form)",
            color: "#a60",
            points: p.map((q) => [q.nu, q.closed] as const),
            width: 2.4,
          },
          {
            label: "measured, this objective",
            color: "#111",
            points: p.map((q) => [q.nu, q.measured] as const),
            dots: true,
            width: 1.2,
          },
        ]}
        markers={[{ x: 2, color: "#3a7", label: "ν = 2" }]}
        xLabel="spatial frequency ν, in NA/λ"
        yLabel="transfer T (image contrast = m · T)"
        xMin={0}
        xMax={2.2}
        yMin={-0.05}
        yMax={1.15}
      />
      <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", width: 420, marginTop: 4 }}>
        {sweep.sweep.rendered} of {sweep.sweep.available} frequencies rendered ·{" "}
        {sweep.sweep.elapsedMs.toFixed(0)} ms · worst |measured − closed| below ν = 1.9 ={" "}
        <strong>{sweep.sweep.worstResidual.toExponential(3)}</strong>. That residual holds two
        things at once — the objective&rsquo;s own aberration and § 6i.3&rsquo;s lattice
        discretization, which on an <em>ideal</em> pupil measures 3.1e-3 at pupil samples 32 and
        1.2e-3 at 64. Anything far above that is the objective.
        <br />
        {cutoffReached ? (
          <>
            At ν = 2 exactly the engine reads{" "}
            <strong>{sweep.sweep.atCutoff.toExponential(4)}</strong> where the closed form reads 0,
            against 1/{(1 / sweep.sweep.tangencyShare).toFixed(0)} ={" "}
            {sweep.sweep.tangencyShare.toExponential(4)} transmitting lattice points. The two pupil
            discs are tangent there and the tangency point is <em>on</em> the lattice, so exactly one
            term survives the sum; the gap between the two numbers is that term&rsquo;s own traced
            amplitude. Past tangency the image is flat to f64.
          </>
        ) : (
        <span style={{ color: GUARD_COLOR.warn }}>
            ν = 2 is not on this grid. It needs cycles = pupil samples, and that Fourier bin has to
            stay inside the grid&rsquo;s own Nyquist, so it wants at least{" "}
            {2 * request.pupilSamples + 2} — the next power of two being{" "}
            {2 ** Math.ceil(Math.log2(2 * request.pupilSamples + 2))}.{" "}
            {2 ** Math.ceil(Math.log2(2 * request.pupilSamples + 2)) <= 256
              ? "Raise the grid."
              : "This panel does not offer a grid that large; read the tangency at pupil samples 32 or 64."}{" "}
            A bin past Nyquist would alias, and reporting an aliased number as the transfer at the
            cutoff would invent the exact thing this sweep exists to measure.
          </span>
        )}
      </p>
    </div>
  );
}

export function FluorescencePanel() {
  const [kind, setKind] = useState<MicroscopeKind>("din-4x-010");
  const [pupilSamples, setPupilSamples] = useState(64);
  const [sizeRaw, setSize] = useState(256);
  const [patches, setPatches] = useState(1);
  const [beadCount, setBeadCount] = useState(80);
  const [seed, setSeed] = useState(7);
  const [stretch, setStretch] = useState<number>(4);

  // `incoherentPsf` throws rather than truncate a pupil that does not fit the
  // grid — a truncated pupil reads as a smaller aperture, which would look like
  // physics — so the grid follows the pupil rather than the panel walking into
  // the refusal. Derived, never written back into state: a state write chasing a
  // state write is how a control ends up fighting the finger on it.
  const minSize = pupilSamples + 2 <= 128 ? 128 : 256;
  const size = Math.max(sizeRaw, minSize);

  const request = useMemo<FluorescenceRequest>(
    () => ({ kind, pupilSamples, size, patches, beadCount, seed }),
    [kind, pupilSamples, size, patches, beadCount, seed],
  );
  const sweepRequest = useMemo<TransferRequest>(
    () => ({ kind, pupilSamples, size }),
    [kind, pupilSamples, size],
  );

  const { result, pending } = useLatestFromWorker<FluorescenceRequest, FluorescenceResult>(
    createFluorescenceWorker,
    request,
  );
  const readout = result?.ok ? result.readout : null;

  const pixelsPerCell =
    readout === null ? Number.NaN : readout.abbeResolutionNm / readout.objectPixelNm;
  const cornerDrop =
    readout === null ? Number.NaN : 1 - readout.cornerKernelPeak / readout.axisKernelPeak;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Fluorescence beads: a specimen that emits</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        A field of sub-resolution fluorescent beads on the specimen, imaged through one of the
        bench&rsquo;s objectives. <strong>Nothing here is drawn.</strong> Each bead is a point
        emitter placed through its own <em>traced chief ray</em>, so the objective&rsquo;s
        distortion is carried in where it lands, and each blob you see is that point convolved with
        the objective&rsquo;s own incoherent PSF. The picture is as many independent copies of that
        kernel as there are beads — which is exactly why a bead slide is what a real lab images to
        measure a PSF.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>Every bead emits the same power.</strong> That is not a simplification, it is the
        measurement: with the specimen carrying no brightness variation of its own, any difference
        between two blobs is the <em>optics</em>. Random fluxes would look more like a photograph
        and would delete the only comparison the picture supports. (Read the caveat under the
        canvas before trusting your eye on it — below three pixels per resolution cell the
        rasterizer&rsquo;s sub-pixel splat outweighs the optics, and the panel says so.)
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>There is no condenser in this instrument at all</strong>, and that is the contrast
        with the brightfield panel that this surface exists to show. A fluorophore absorbs a photon
        and emits a new one with no phase memory of the exciting field or of its neighbours, so the
        emitters are mutually incoherent by nature, their intensities add, and the image is a plain
        convolution. Brightfield needed the condenser fully open to reach ν = 2 and stopped at ν = 1
        with the diaphragm shut; the plot beside the picture measures fluorescence arriving at ν = 2
        with no condenser to open. Same axis, same units, three panels apart.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        What is deliberately absent: <strong>no background, no noise, no haze</strong>. Shot noise,
        photobleaching and quantum yield are all blocked on an absolute photon count, and
        out-of-focus haze is a z-stack — the next surface, not this one. A cosmetic floor would make
        the picture look more like a photograph by faking the one thing it exists to show honestly.
        And <strong>no verdict is minted</strong>: § 6i mints none, because incoherent imaging has a
        geometric branch to fall back to where brightfield does not. The wavefront numbers below are
        wavefront numbers, not a clean bill of health.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label="objective"
          options={MICROSCOPE_CATALOG.map((e) => e.kind)}
          value={kind}
          onChange={setKind}
          format={(k) => MICROSCOPE_CATALOG.find((e) => e.kind === k)!.label}
        />
        <Choice
          label={`pupil samples ${pupilSamples} — also the crop, in resolution cells`}
          options={[32, 64, 128]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={`grid ${size}² — buys PSF sampling, not field`}
          options={[128, 256]}
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
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`${beadCount} beads asked for`}
          min={1}
          max={160}
          step={1}
          value={beadCount}
          onChange={setBeadCount}
        />
        <Slider
          label={`scene seed ${seed} — the same field while the optics move`}
          min={1}
          max={16}
          step={1}
          value={seed}
          onChange={setSeed}
        />
      </div>

      {result !== null && !result.ok && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: GUARD_COLOR.bad, maxWidth: 660 }}>
          the engine refuses this render: {result.error}
        </p>
      )}

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        {readout !== null && (
          <figure style={{ margin: 0 }}>
            <BeadCanvas readout={readout} stretch={stretch} pending={pending} />
            <figcaption
              style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 380 }}
            >
              <strong>{readout.objectSpanUm.toFixed(2)} µm</strong> of specimen across the frame ·
              NA {readout.tracedNA.toFixed(4)}
              <br />
              λ/2NA = {readout.abbeResolutionNm.toFixed(0)} nm · object pixel{" "}
              {readout.objectPixelNm.toFixed(1)} nm
              <br />
              <strong>{readout.placed}</strong> of {readout.requested} beads landed on the grid ·{" "}
              {readout.densityPer100Um2 < 1
                ? readout.densityPer100Um2.toFixed(3)
                : readout.densityPer100Um2.toFixed(0)}{" "}
              per 100 µm²
              <br />
              <span
                style={{
                  color:
                    GUARD_COLOR[
                      pixelsPerCell < PIXELS_PER_CELL_FLOOR ? "warn" : "ok"
                    ],
                }}
              >
                {pixelsPerCell.toFixed(2)} pixels per resolution cell
              </span>
              {pixelsPerCell < PIXELS_PER_CELL_FLOOR && (
                <>
                  <br />
                  <span style={{ color: "#777" }}>
                    — at this sampling the bilinear splat moves a bead&rsquo;s peak by ~19% depending
                    where in a pixel it fell, which is larger than the corner-to-axis drop below.
                    Compare blobs by eye only above ~4.
                  </span>
                </>
              )}
              <br />
              peak {readout.peak.toExponential(3)} · mean {readout.meanIntensity.toExponential(3)} ·
              white = peak ÷ {stretch}
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
            </figcaption>
          </figure>
        )}
        <TransferPlot request={sweepRequest} />
      </div>

      {readout !== null && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.7,
            color: "#555",
            marginTop: 16,
            maxWidth: 660,
          }}
        >
          kernel peak on axis <strong>{readout.axisKernelPeak.toFixed(6)}</strong> · at the frame
          corner <strong>{readout.cornerKernelPeak.toFixed(6)}</strong> ·{" "}
          <span style={{ color: cornerDrop > 0 ? "#a60" : "#06a" }}>
            {cornerDrop > 0 ? "drop" : "gain"} {Math.abs(cornerDrop * 100).toFixed(3)}%
          </span>
          <br />
          RMS OPD {readout.axisRmsWaves.toFixed(5)} waves on axis ·{" "}
          {readout.cornerRmsWaves.toFixed(5)} at the corner · {readout.cornerLost} corner rays lost
          to vignetting
          <br />
          {readout.transmittingSamples} lattice points transmitted by the axial pupil
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The kernel peak is a Strehl-like readout</strong>, because the kernel is normalized
        to unit sum: light the aberration moves out of the core has to go somewhere, so a lower peak
        at the same total is a worse image. § 6i.5 measured the corner&rsquo;s traced pupil giving a
        <em> lower</em>-peaked kernel than the axis&rsquo;s — corner coma showing up in an image —
        and it holds here, but <strong>the sign is not universal and that is a correction worth
        stating</strong>. Measured at pupil samples 32: the DIN 4×/0.10 drops 0.659% and the
        infinity 20×/0.10 drops 0.997%, while the <em>Lister 40×/0.20 and the 100×/1.40 oil both
        gain ~0.18%</em> — their corner wavefront is genuinely better than their axial one at the
        system&rsquo;s own image plane, with no best-focus solve. So &ldquo;the corner is worse&rdquo;
        is a statement about a particular design, not about field position, and this panel prints the
        number rather than the moral.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The crop moves the corner, too.</strong> Raising pupil samples widens the frame —
        93.5 µm at 32, 187.1 at 64, 374.2 at 128 on the DIN 4× — so the &ldquo;corner&rdquo; walks
        further off axis and the drop grows with it: 0.659% → 2.38% → 9.33% on that objective. The
        picture at 128 shows it directly, with the outer beads visibly fatter than the central ones.
        That is the same § 6h constraint the brightfield panel is built around, arriving as a visible
        aberration rather than as a number: the frame spans <code>pupilSamples</code> resolution
        cells and there is no resampling trick to widen it.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>Light conserved</strong> is § 6i.4&rsquo;s identity, live: the kernel sums to 1 and
        the patch windows sum to 1, so neither the optics nor the patch decomposition may invent or
        lose a photon, and circular convolution makes that exact rather than edge-limited — light
        leaving one side of the frame returns on the other. It reads ~1e-15 at every patch count,
        where the brightfield render&rsquo;s equivalent split <em>deletes</em> 89% of the
        interference, because there the window has to go on the output. It is measured against the
        <em> rasterized</em> emitter field rather than the flux asked for: beads whose splat falls
        off the grid are dropped, and counting those as lost photons would print a conservation
        failure that is nothing of the kind. How many landed is the line above it.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The transfer plot has no factor of two in it</strong>, and the brightfield panel
        does. That is not an inconsistency: a brightfield specimen modulates an <em>amplitude</em>,
        t = 1 + m·cos, and squaring it puts 2·m·T into the image. A fluorescent specimen emits, so
        E = 1 + m·cos is already an intensity and the convolution is linear in it — I = 1 + m·T·cos,
        and T is the measured contrast unhalved. The sweep runs at m = 1, which is not a stress
        test: partial coherence&rsquo;s transfer walks 11.2% away from the weak-object limit at
        m = 1 and this one cannot walk at all, because a convolution leaves nothing for the
        modulation to enter. E = 1 + cos is non-negative, so it is a physical emitter density.
      </p>
    </>
  );
}
