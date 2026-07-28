import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { MICROSCOPE_CATALOG, MARECHAL_WAVES, type MicroscopeKind } from "../microscope";
import { Plot } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider, thresholdLevel } from "../ui";
import {
  axialSincSq,
  AXIAL_PUPIL_SAMPLES,
  CONE_PUPIL_SAMPLES,
  toGrey,
  type AxialRequest,
  type AxialResult,
  type VolumeReadout,
  type VolumeRequest,
  type VolumeResult,
} from "../volume";
import { createVolumeAxialWorker, createVolumeWorker } from "../workers";

/**
 * Out-of-focus haze and the focus stack — APP.md's A5.
 *
 * The surface where the specimen stops being a plane. Everything before it
 * images one layer; a real widefield fluorescence image is dominated by light
 * from emitters that are *not* in the focal plane, and this panel is that
 * difference, stated as one fact twice over.
 *
 * **A defocus is a pure phase.** It moves no pupil amplitude, so no plane's
 * total light moves either — every plane of a thick specimen delivers its whole
 * flux to the image however far out of focus it is. So a slab three times
 * thicker is exactly three times hazier, and **refocusing cannot help**: it
 * changes which plane is sharp and nothing else. Transform that constant along
 * the depth axis and it is the **missing cone**, the second plot.
 *
 * Two conventions are inherited unchanged and one is new:
 *
 *  - **White comes from the image's peak** (A4), because a bead field is sparse
 *    even once haze has lifted the floor — and because the panel's claim is a
 *    comparison *across* thickness, which a scale that moved with the mean would
 *    hide.
 *  - **The plot is withdrawn while stale, the picture only dims** (A4). Same
 *    asymmetry, same reason: the curves' legend names the objective.
 *  - New: **the two halves have different grid guards**, and both are shown. The
 *    picture's says whether the frame it is drawing is honest; the axial stack's
 *    says whether the pupil is carried at its worst member. § 6k.4's own stack
 *    crosses the half-wave line and still measures every support edge exactly.
 */

/** Half a wave between adjacent transmitting samples — `abbeImage`'s own line. */
const GRID_STEP_LIMIT = 0.5;

/** Below this the bilinear splat outweighs the optics — A4's measured floor. */
const PIXELS_PER_CELL_FLOOR = 3;

/** White = peak ÷ this. */
const STRETCHES = [1, 4, 16] as const;

/** Odd, so there is always a middle plane for the focus slider to start on. */
const PLANE_COUNTS = [1, 3, 5, 9, 17, 27] as const;

/**
 * A plane step is exactly half a wave of defocus, and that is arithmetic.
 *
 * § 6j defines the depth of focus so that half of it is a quarter wave, so a
 * whole one is half a wave. The slices step by one depth of focus and the focus
 * does too, so **plane j sits at (j − focus)/2 waves** with no engine number in
 * it — which is why this panel can mark its own plot without waiting for a
 * render, and why the integer-wave nulls land on even plane offsets.
 */
const WAVES_PER_PLANE = 0.5;

function StackCanvas({ readout, stretch }: { readout: VolumeReadout; stretch: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const white = readout.peak / stretch;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = readout.size;
    element.height = readout.size;
    const context = element.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(toGrey(readout.intensity, readout.size, white));
    context.putImageData(new ImageData(pixels, readout.size, readout.size), 0, 0);
  }, [readout, white]);

  return (
    <canvas
      ref={canvas}
      style={{ width: 340, height: 340, imageRendering: "pixelated", background: "#000" }}
    />
  );
}

/**
 * The two curves, from one worker and one traced pupil.
 *
 * Withdrawn rather than dimmed while it catches up — A4's rule, and it applies
 * for the same reason: the sweep's readouts name the objective and quote its σ,
 * and a faint wrong sentence is still a wrong sentence.
 */
function AxialPlots({ request, markWaves }: { request: AxialRequest; markWaves: number }) {
  const { result, pending } = useLatestFromWorker<AxialRequest, AxialResult>(
    createVolumeAxialWorker,
    request,
  );
  const sweep = pending ? null : result;

  if (sweep === null) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
        building the focus stacks through this objective…
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

  const r = sweep.readout;
  const closed = r.sweep.waves.map((w) => [w, axialSincSq(w)] as const);
  const measured = r.sweep.waves.map((w, i) => [w, r.sweep.measured[i]!] as const);
  const cone = r.cones.find((c) => c.nu === 0)!;
  const sigmaShare = r.axisRmsWaves > 0 ? r.sweep.defocusSigmaWaves / r.axisRmsWaves : Number.NaN;

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <Plot
          series={[
            {
              label: "sinc²(π·w₂₀), closed form",
              color: "#a60",
              points: closed,
              width: 2.4,
            },
            {
              label: "measured, this objective",
              color: "#111",
              points: measured,
              width: 1.3,
            },
          ]}
          markers={[
            // Only when it is on the axis. A marker clamped to the edge would
            // say "the worst plane is at 2 waves" for a slab whose worst plane
            // is at 6, which is a wrong number rather than a missing one.
            ...(Math.abs(markWaves) <= 2
              ? [{ x: markWaves, color: "#06a", label: "worst plane" } as const]
              : []),
            { y: 8 / (Math.PI * Math.PI), color: "#3a7", label: "8/π² at ¼ wave" },
          ]}
          xLabel="defocus w₂₀, waves at the pupil rim"
          yLabel="on-axis intensity ÷ its value at w₂₀ = 0"
          xMin={-2}
          xMax={2}
          yMin={-0.05}
          yMax={Math.max(1.15, r.sweep.peakRatio * 1.08)}
        />
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", width: 420, marginTop: 4 }}>
          Exactly <strong>zero at every integer wave</strong> — all of the light in the rings, and
          the plane&rsquo;s total unmoved. An ideal pupil reproduces the closed form to 7.6e-3 at{" "}
          {AXIAL_PUPIL_SAMPLES} bins across the pupil and 2.0e-3 at 64, so a gap much larger than
          that is this objective.
          <br />
          <span style={{ color: r.sweep.peakRatio > 1.01 ? "#a60" : "#3a7" }}>
            the axial peak sits at w₂₀ = <strong>{r.sweep.peakWaves.toFixed(3)}</strong> waves
            {r.sweep.peakAtEdge && " (at the sweep's edge — a bound, not a value)"}, where the
            response is <strong>{r.sweep.peakRatio.toFixed(3)}×</strong> its value at the plane the
            system calls its image plane
          </span>
          <br />
          that offset carries σ = |w|/(2√3) = {r.sweep.defocusSigmaWaves.toFixed(5)} waves on its
          own, against the traced σ of {r.axisRmsWaves.toFixed(5)} —{" "}
          <strong>{(sigmaShare * 100).toFixed(0)}%</strong> of it
          {Math.abs(r.sweep.peakWaves) <= 2 / 32 && (
            <span style={{ color: GUARD_COLOR.warn }}>
              {" "}
              — but the peak is within two of this sweep&rsquo;s own 1/32-wave steps of zero, so
              that share is quantized by the sweep rather than measured by it
            </span>
          )}
          .
        </p>
      </div>

      <div>
        <Plot
          series={r.cones.map((c, i) => ({
            label: c.nu === 0 ? "ν = 0 — the cone" : `ν = ${c.nu}`,
            color: ["#c00", "#06a", "#111", "#a60"][i] ?? "#666",
            points: c.cyclesPerWave.map((mu, j) => [mu, c.magnitude[j]!] as const),
            width: c.nu === 0 ? 2.4 : 1.4,
            // ν = 1.5 dashed: it shares its support edge with ν = 0.5, so the
            // two curves land on the same marker and would otherwise be read as
            // one line reaching further than it does.
            ...(i === 3 ? { dash: [5, 4] } : {}),
          }))}
          markers={[
            { x: 1, color: "#3a7", label: "μ = ν(2−ν)" },
            { x: 0.75, color: "#3a7" },
          ]}
          xLabel="axial frequency μ, cycles per wave of defocus"
          yLabel="|axial transfer| ÷ its own peak"
          xMin={0}
          xMax={2}
          yMin={-0.05}
          yMax={1.1}
        />
        {/* A div rather than a p: `Guard` renders a block, and a div inside a p
            is invalid nesting that React unmounts the subtree over. */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "#777",
            width: 420,
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          At ν = 0 the transfer of every plane is its own total, which does not move — so its
          transform is zero at every axial frequency but DC. Measured on this{" "}
          <strong>traced</strong> pupil: <strong>{cone.worstNonDc.toExponential(3)}</strong> of the
          DC bin. The cone is not an artifact of an ideal lens; it needs only a pupil whose
          amplitude does not vary with depth.
          <br />
          support edges, measured against ν·(2 − ν), in axial bins — § 6k.4 pins them to within
          one, because a finite stack leaks its own window across a sharp boundary:
          <br />
          {r.cones
            .filter((c) => c.nu > 0)
            .map((c) => (
              <span key={c.nu} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                ν {c.nu} → {c.edgeMeasured.toFixed(3)} vs {c.edgeLaw.toFixed(3)}{" "}
                <span style={{ color: GUARD_COLOR[c.edgeBins <= 1.001 ? "ok" : "bad"] }}>
                  ({c.edgeBins.toFixed(1)})
                </span>
              </span>
            ))}
          <br />
          <span style={{ color: "#777" }}>
            the stack spans <strong>{r.coneWindowWaves}</strong> waves at {CONE_PUPIL_SAMPLES}{" "}
            bins, against a lattice period of{" "}
            <strong>{r.conePeriodWaves.toFixed(2)}</strong> at the highest ν drawn — the sampled
            pupil makes the axial transfer <em>exactly</em> periodic in w₂₀ with period
            pupilSamples/(4ν), so a longer window would draw a comb of the lattice instead of the
            transfer.
          </span>
          <br />
          <Guard
            label="cone stack grid step"
            value={`${r.stackGridPhaseStepWaves.toFixed(4)} waves / sample`}
            level={thresholdLevel(r.stackGridPhaseStepWaves, GRID_STEP_LIMIT)}
            detail="a different quantity from the picture's guard: that one is about the frame being drawn, this one about the pupil at the stack's worst-defocused member."
          />
          throughput drift over the stack {r.throughputDrift.toExponential(2)} ·{" "}
          {r.elapsedMs.toFixed(0)} ms
        </div>
      </div>
    </div>
  );
}

export function VolumePanel() {
  const [kind, setKind] = useState<MicroscopeKind>("inf-20x-010");
  const [pupilSamples, setPupilSamples] = useState(32);
  const [sizeRaw, setSize] = useState(128);
  const [planes, setPlanes] = useState<number>(9);
  const [focusRaw, setFocus] = useState(0);
  const [beadsPerPlane, setBeadsPerPlane] = useState(8);
  const [seed, setSeed] = useState(7);
  const [stretch, setStretch] = useState<number>(4);

  // A4's floor: `incoherentPsf` refuses to truncate a pupil that does not fit
  // the grid, so the grid follows the pupil. Derived, never written back.
  const minSize = pupilSamples + 2 <= 128 ? 128 : 256;
  const size = Math.max(sizeRaw, minSize);
  // Clamped rather than reset, so shrinking the stack and growing it again does
  // not silently move the focus a reader had chosen.
  const halfPlanes = (planes - 1) / 2;
  const focusPlane = Math.max(-halfPlanes, Math.min(halfPlanes, focusRaw));

  const request = useMemo<VolumeRequest>(
    () => ({ kind, pupilSamples, size, planes, focusPlane, beadsPerPlane, seed }),
    [kind, pupilSamples, size, planes, focusPlane, beadsPerPlane, seed],
  );
  const axialRequest = useMemo<AxialRequest>(() => ({ kind }), [kind]);

  const { result, pending } = useLatestFromWorker<VolumeRequest, VolumeResult>(
    createVolumeWorker,
    request,
  );
  const readout = result?.ok ? result.readout : null;

  // Panel arithmetic, not a readout: the worst plane is (planes−1)/2 away from
  // the middle and the focus is `focusPlane` from it, at half a wave per plane.
  const worstPlaneWaves =
    WAVES_PER_PLANE * Math.max(Math.abs(-halfPlanes - focusPlane), Math.abs(halfPlanes - focusPlane));
  const pixelsPerCell =
    readout === null ? Number.NaN : readout.abbeResolutionNm / readout.objectPixelNm;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Out-of-focus haze: the specimen stops being a plane</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The same fluorescent beads as the previous panel, now scattered through a <em>slab</em> —
        one bead field per plane, the planes stepping by exactly one depth of focus. Move the focus
        slider and the objective picks a different plane out of the stack. Everything else you can
        see is <strong>haze</strong>: light from the planes that are not in focus, spread into a
        background that carries no detail.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        <strong>A defocus is a pure phase.</strong> It changes no amplitude anywhere in the pupil,
        so the pupil&rsquo;s transmitted energy does not move, so — by Parseval, through the
        engine&rsquo;s own transform — neither does the kernel&rsquo;s total. Every plane of the
        slab delivers its <em>entire</em> flux to the image however far out of focus it sits. Two
        things follow, and both are numbers under the picture rather than claims: a slab three times
        thicker is exactly three times hazier, and <strong>refocusing cannot help</strong> — the
        in-focus fraction and the image&rsquo;s total light do not move in any printed digit while
        you drag the focus.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The right-hand plot is that same fact transformed along the depth axis. A constant sequence
        has a transform that is zero everywhere but DC, so the widefield instrument carries{" "}
        <strong>no axial information at all</strong> about how bright the specimen is — the{" "}
        <strong>missing cone</strong>. That is why deconvolution is ill-posed structurally rather
        than numerically, and why confocal exists: a detection pinhole is a finite aperture, and
        while the kernel&rsquo;s <em>total</em> is invariant to defocus, no finite aperture&rsquo;s
        share of it is.
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
          label={`pupil samples ${pupilSamples} — the crop, and the axial headroom`}
          options={[32, 64, 128]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={
            size > sizeRaw
              ? `grid ${size}² — floored: a ${pupilSamples}-bin pupil needs ${pupilSamples + 2}`
              : `grid ${size}² — buys PSF sampling, not field`
          }
          options={[128, 256]}
          value={size}
          onChange={setSize}
        />
        <Choice
          label={`${planes} planes — the slab, in depths of focus`}
          options={PLANE_COUNTS}
          value={planes}
          onChange={setPlanes}
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
          label={`focus on plane ${focusPlane > 0 ? `+${focusPlane}` : focusPlane} of ±${halfPlanes} — ${(focusPlane * WAVES_PER_PLANE).toFixed(2)} waves from the middle`}
          min={-halfPlanes}
          max={halfPlanes}
          step={1}
          value={focusPlane}
          onChange={setFocus}
        />
        <Slider
          label={`${beadsPerPlane} beads on every plane — ${planes * beadsPerPlane} in the slab`}
          min={1}
          max={24}
          step={1}
          value={beadsPerPlane}
          onChange={setBeadsPerPlane}
        />
        <Slider
          label={`scene seed ${seed} — the same slab while the optics move`}
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
          <figure
            style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}
          >
            <StackCanvas readout={readout} stretch={stretch} />
            <figcaption
              style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 340 }}
            >
              <strong>{readout.objectSpanUm.toFixed(2)} µm</strong> across ×{" "}
              <strong>{readout.slabThicknessUm.toFixed(2)} µm</strong> deep · NA{" "}
              {readout.tracedNA.toFixed(4)} in {readout.objectMedium} (n ={" "}
              {readout.objectMediumIndex.toFixed(4)})
              <br />
              depth of focus {readout.depthOfFocusUm.toFixed(3)} µm = one plane step = half a wave
              <br />
              <strong>{readout.placedTotal}</strong> of {readout.requestedTotal} beads landed ·{" "}
              {readout.placedMin}–{readout.placedMax} per plane
              <br />
              <span
                style={{
                  color: GUARD_COLOR[pixelsPerCell < PIXELS_PER_CELL_FLOOR ? "warn" : "ok"],
                }}
              >
                {pixelsPerCell.toFixed(2)} pixels per resolution cell
              </span>
              <br />
              peak ÷ mean <strong>{readout.peakOverMean.toFixed(2)}</strong> — signal against haze
              <br />
              total light {readout.totalLight.toPrecision(12)} · throughput drift{" "}
              <span style={{ color: "#3a7" }}>{readout.throughputDrift.toExponential(2)}</span>
              <br />
              {readout.inFocusFraction === null || readout.emittedInFocusShare === null ? (
                <span style={{ color: GUARD_COLOR.warn }}>
                  no bead landed on the grid — the in-focus fraction is a ratio to zero here, and
                  printing it as 0 would report a haze law for an empty slab
                </span>
              ) : (
                <>
                  in focus <strong>{readout.inFocusFraction.toFixed(9)}</strong>
                  <br />
                  <span style={{ color: "#3a7" }}>
                    = the specimen&rsquo;s own emitted share{" "}
                    {readout.emittedInFocusShare.toFixed(9)} to{" "}
                    {Math.abs(readout.inFocusFraction - readout.emittedInFocusShare).toExponential(1)}
                  </span>
                  <br />
                  <span style={{ color: "#777" }}>
                    equal-flux ideal 1/{planes} = {readout.equalFluxIdeal.toFixed(6)}
                  </span>
                </>
              )}
              <br />
              <Guard
                label="grid step"
                value={`${readout.maxGridPhaseStepWaves.toFixed(4)} waves / sample`}
                level={thresholdLevel(readout.maxGridPhaseStepWaves, GRID_STEP_LIMIT)}
                detail={`worst plane is ${worstPlaneWaves.toFixed(2)} waves out; its kernel puts ${(readout.worstSliceOutsideFraction * 100).toFixed(1)}% of its light outside the frame's inscribed circle`}
              />
              σ {readout.axisRmsWaves.toFixed(5)} waves on axis, as traced (λ/14 ={" "}
              {MARECHAL_WAVES.toFixed(5)}) · {readout.elapsedMs.toFixed(0)} ms
            </figcaption>
          </figure>
        )}
        <AxialPlots request={axialRequest} markWaves={worstPlaneWaves} />
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The in-focus fraction is the specimen&rsquo;s, not the instrument&rsquo;s.</strong>{" "}
        Because every plane delivers its whole flux, the image&rsquo;s in-focus share is exactly the
        share of the emitters that lie within half a depth of focus — the two agree to ~1e-16 above,
        and that identity is what &ldquo;refocusing cannot help&rdquo; means arithmetically. It
        lands on 1/planes to the extent that each plane holds the same number of{" "}
        <em>landed</em> beads; the small gap is beads whose splat fell off the grid edge, which is
        the scene and not the optics. The exact statement beside it is the throughput drift: each plane&rsquo;s own
        flux ÷ its emitters, identical across the slab to ~1e-14. That is read from the delivered
        light and <em>not</em> from the kernels&rsquo; own totals, which are normalized to 1 and
        would report the identity by arithmetic — the trap `formedSum` exists to avoid.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The frame has a depth as well as a width, and the depth runs out faster.</strong> The
        lateral crop falls as 1/NA (§ 6h) and the depth of focus falls as n/NA², so the slab a panel
        can hold shrinks the harder of the two: at 4×/0.10 nine planes is <em>529 µm</em> of
        specimen — thicker than any real slide — while at 100×/1.40 the same nine planes is{" "}
        <em>4.1 µm</em>, about one cell. That is A1&rsquo;s &ldquo;the span is set by NA
        alone&rdquo; with the axial direction added, and it is why the immersion rows are where a
        z-stack means something.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>Where the axial peak sits is a reading of A1&rsquo;s σ.</strong> A1 reports the
        wavefront error as traced, about the pupil&rsquo;s own mean at the system&rsquo;s{" "}
        <em>own</em> image plane with no best-focus solve, and says a red number means &ldquo;not at
        this focus&rdquo; rather than &ldquo;not correctable&rdquo;. The left-hand plot measures
        that: a residual defocus moves the axial peak off w₂₀ = 0, and the defocus it takes to get
        there carries σ = |w|/(2√3) of its own. For the three rows whose traced σ is over
        λ/14 that accounts for <strong>90%, 92% and 100%</strong> of it — the DIN 4×/0.10 peaks
        0.438 waves away and is 1.79× brighter there, the 100×/1.25 oil 0.156 waves and 1.10×, the
        100×/1.40 oil 0.281 waves and 1.27×. Their red is <em>focus</em>, and almost nothing else.
        The well-corrected rows sit one step of this sweep from zero (the infinity 20× and the
        Lister both at 0.031 waves, 1.002× and 1.006×), which is a bound rather than a
        measurement, and the caption says so where it happens. A1&rsquo;s wording was right and
        this is the number behind it.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>What the guard turning red looks like.</strong> A pupil sampled on a lattice has a{" "}
        <em>periodic</em> kernel, so once a badly defocused plane&rsquo;s PSF is wider than one
        period its tails fold back in and the frame fills with a false uniform glow. The number
        beside the guard is that, measured: the worst plane&rsquo;s kernel energy outside the
        frame&rsquo;s inscribed circle, which runs 0.4% in focus (the Airy wings, a fixed cost)
        to 4.6% at four waves and 30% at six, on an ideal pupil at 32 bins. Raising the{" "}
        <em>grid</em> does not help — measured identical at 128 and 256, because the kernel scales
        with it. Only raising pupil samples does, and that is the axis worth spending on when the
        slab gets thick. Focusing at an <em>end</em> of the stack doubles the worst plane&rsquo;s
        defocus, so the guard moves while you drag the focus even though the physics does not.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>Two things are deliberately absent.</strong> There is no{" "}
        <em>depth-dependent spherical aberration</em>: focusing into a specimen whose index does not
        match the immersion adds aberration that grows with depth — the dominant real defect of deep
        widefield imaging, and the reason correction collars exist — and while § 6c solves the plate
        to all orders and § 6e the whole layer stack, wiring focal depth into that stack is its own
        engine step with its own rungs. `DepthPupils` is the hook and this panel passes it phase
        only, so the stack here is exactly symmetric about focus in a way a real one is not. And
        there is <em>no field decomposition</em>: `renderVolume` takes one pupil keyed on depth, not
        one keyed on position, so the whole frame is imaged through the on-axis traced pupil and the
        previous panel&rsquo;s corner-versus-axis comparison has no analogue here.
      </p>
    </>
  );
}
