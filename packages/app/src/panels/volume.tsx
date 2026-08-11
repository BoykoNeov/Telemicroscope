import { useEffect, useMemo, useRef, useState } from "react";
import { refusalVoice } from "../refusal";
import { objectiveOf, objectiveOptions, type ObjectiveId } from "../objective";
import { readSavedBuild } from "../saved";
import { useLatestFromWorker } from "../hooks";
import { MICROSCOPE_CATALOG, MARECHAL_WAVES, entryOf, type MicroscopeKind } from "../microscope";
import { Plot } from "../plot";
import { Choice, Guard, GUARD_COLOR, ObjectiveLine, Slider, thresholdLevel } from "../ui";
import {
  axialSincSq,
  AXIAL_PUPIL_SAMPLES,
  CONE_PUPIL_SAMPLES,
  ASYMMETRY_FLOOR,
  MOUNT_MEDIA,
  toGrey,
  WAVEFRONT_RHO,
  type AxialRequest,
  type AxialResult,
  type DepthRequest,
  type DepthResult,
  type MountChoice,
  type VolumeReadout,
  type VolumeRequest,
  type VolumeResult,
} from "../volume";
import {
  createVolumeAxialWorker,
  createVolumeDepthWorker,
  createVolumeWorker,
} from "../workers";

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
 *
 * ## D10 — the mount, and the two questions it makes the reader choose between
 *
 * The specimen now sits in something. Every control above still means what it
 * did, and two new ones say what the slab is mounted in and how deep below the
 * slip it sits — after which the panel is asking § 6l's two different questions
 * at once and labels which is which:
 *
 *  - **the picture and the cone** put each plane through its own thickness of
 *    mount (`mountPupils`), so the stack stops being symmetric about focus;
 *  - **the axial response** fixes one emitter at that depth and sweeps the focus
 *    through it (`defocusing(withMountAberration(...))`), which is a different
 *    curve and the one that shows where best focus moved to.
 *
 * The third plot is neither: it is a sweep over depth, and its content is the gap
 * between the depth budget `mountDepthTolerance` quotes and the depth a bisection
 * on the Strehl actually finds.
 *
 * **A matched mount costs exactly nothing**, at every depth and every aperture —
 * a hard zero carried by an explicit (n_s²−n_i²) factor, so `withMountAberration`
 * returns the pupil object itself and no arithmetic happens at all. That is
 * § 6l.9's identity rung arriving as a UI invariant, and
 * `packages/app/test/volume-mount.test.ts` holds it there, including the part the
 * panel had to decide for itself: **no plane may sit above the coverslip**, where
 * there is no mount to look through and a stack linear in depth would sign the
 * aberration backwards. Both the slab and the cone's own stack are anchored so
 * that it cannot be reached rather than clamped after the fact.
 */

/** Half a wave between adjacent transmitting samples — `abbeImage`'s own line. */
const GRID_STEP_LIMIT = 0.5;

/**
 * A ratio said in the direction it actually points.
 *
 * The asymmetry is (past focus) ÷ (before focus), and printing "0.30× brighter"
 * for a value below 1 says the opposite of what the number means — the response
 * past focus is 3.3× *dimmer* there. The mount pushes it far above 1 and the
 * objective's own residual can push it below, so both directions are reachable
 * on the same line and the wording has to follow the value.
 */
const formatRatio = (value: number): string =>
  value >= 1 ? `${value.toFixed(2)}× brighter` : `${(1 / value).toFixed(2)}× dimmer`;

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
        {refusalVoice(sweep.source, "this objective")}: {sweep.error}
      </p>
    );
  }

  const r = sweep.readout;
  const asym = r.sweep;
  const closed = r.sweep.waves.map((w) => [w, axialSincSq(w)] as const);
  const measured = r.sweep.waves.map((w, i) => [w, r.sweep.measured[i]!] as const);
  const cone = r.cones.find((c) => c.nu === 0)!;
  const sigmaShare = r.axisRmsWaves > 0 ? r.sweep.defocusSigmaWaves / r.axisRmsWaves : Number.NaN;
  /**
   * Whether the peak's offset may be read as a share of A1's traced σ — and it
   * may only when nothing but the objective is in the beam.
   *
   * The decomposition below says "this much of A1's σ is *focus*", and it is a
   * statement about a pupil carrying the objective's own aberration and nothing
   * else. A mount moves best focus by its own compensating defocus, which is a
   * larger number than the whole traced σ on the immersion rows — so the same
   * arithmetic would hand the mount's defocus to the lens and, clamped at 100%,
   * read as "this objective's error is all focus" for a reason that is not the
   * objective's at all.
   */
  const readsA1Sigma = r.mountMatched || r.depthUm === 0;

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
          own
          {readsA1Sigma ? (
            <>
              , against the traced σ of {r.axisRmsWaves.toFixed(5)} —{" "}
              <strong>{(Math.min(sigmaShare, 1) * 100).toFixed(0)}%</strong> of it
              {Math.abs(r.sweep.peakWaves) <= 2 / 32 && (
                <span style={{ color: GUARD_COLOR.warn }}>
                  {" "}
                  — but the peak is within two of this sweep&rsquo;s own 1/32-wave steps of zero, so
                  that share is quantized by the sweep rather than measured by it
                </span>
              )}
              .
            </>
          ) : (
            <span style={{ color: GUARD_COLOR.warn }}>
              {" "}
              — and that is <em>not</em> a share of A1&rsquo;s traced σ ({r.axisRmsWaves.toFixed(5)}
              ), which is what this line reads when the mount is matched and the depth is zero. Here
              the offset is dominated by the <strong>mount&rsquo;s</strong> compensating defocus:
              the depth aberration is what moved best focus, so dividing it into the objective&rsquo;s
              own wavefront error would attribute the mount&rsquo;s to the lens — and at{" "}
              {(sigmaShare).toFixed(2)}× the traced σ it is not even a fraction. Set the mount back
              to matched to read A1&rsquo;s number.
            </span>
          )}
          <br />
          <span style={{ color: r.mountMatched ? "#3a7" : "#a60" }}>
            <strong>±1 wave: </strong>
            {asym.asymmetry === null ? (
              <>
                refused — one wave before focus is where sinc² has its own <em>null</em>, and this
                pupil sits within {(ASYMMETRY_FLOOR * 100).toFixed(0)}% of it, so the ratio would be
                two rounding errors divided by each other rather than an asymmetry
              </>
            ) : (
              <>
                <strong>{formatRatio(asym.asymmetry)}</strong> one wave <em>past</em> focus against
                one wave <em>before</em> it
              </>
            )}
            {asym.asymmetry !== null && (
              <>
                {" — "}
                {r.mountMatched
                  ? "and a matched mount is a hard zero at every depth, so this is the objective's own residual defocus and nothing else"
                  : `of which the mount's own share is ${asym.asymmetryIdeal === null ? "refused" : formatRatio(asym.asymmetryIdeal)} (this NA, ideal pupil) against ${asym.asymmetryBare === null ? "refused" : formatRatio(asym.asymmetryBare)} the objective already carried at zero depth`}
              </>
            )}
            .
          </span>
          <br />
          sinc²(π·w₂₀) is <em>even</em>, so an unaberrated pupil reads exactly 1 — the mount is what
          breaks it, and the direction is the diagnosis: a mount <em>rarer</em> than{" "}
          {r.objectMedium} aberrates negative and the compensating defocus is positive. Depth{" "}
          {r.depthUm.toFixed(2)} µm carries{" "}
          <strong>{r.depthWaves.toFixed(4)}</strong> waves at {WAVEFRONT_RHO.toFixed(2)} of the
          delivered rim.
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
          <strong>traced</strong> pupil, through this mount:{" "}
          <strong>{cone.worstNonDc.toExponential(3)}</strong> of the DC bin. The cone is not an
          artifact of an ideal lens, and <em>this step does not fill it</em> (§ 6l.6): the depth
          aberration is a pure phase and the mount&rsquo;s aperture truncation does not vary with
          depth, so the one thing that would fill the cone — an amplitude that moves with z — is
          still absent. It needs only a pupil whose amplitude does not vary with depth.
          <br />
          support edges, measured against ν·(2 − ν), in axial bins — § 6k.4 pins them to within
          one, because a finite stack leaks its own window across a sharp boundary:
          <br />
          {r.cones
            .filter((c) => c.nu > 0)
            .map((c) => (
              <span key={c.nu} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                ν {c.nu} → {c.edgeMeasured.toFixed(3)} vs {c.edgeLaw.toFixed(3)}{" "}
                <span
                  style={{
                    color: r.mountMatched
                      ? GUARD_COLOR[c.edgeBins <= 1.001 ? "ok" : "bad"]
                      : GUARD_COLOR.warn,
                  }}
                >
                  ({c.edgeBins.toFixed(1)})
                </span>
              </span>
            ))}
          <br />
          {!r.mountMatched && (
            <>
              <span style={{ color: GUARD_COLOR.warn }}>
                Through a mismatched mount those numbers stop being a check and become a{" "}
                <em>measurement</em>, which is why they are amber rather than red.
              </span>{" "}
              ν·(2 − ν) is a <strong>defocus-only</strong> law: it is derived from a stack whose
              members differ by nothing but w₂₀, and here they differ by their own depth&rsquo;s
              spherical aberration as well. So the two halves of § 6k.4 come apart, and the split is
              exactly § 6l.6&rsquo;s: the ν = 0 <em>null</em> survives, because it needs only an
              amplitude that does not move with depth — while the support <em>boundary</em> does
              not, because it needed the family to be a defocus family. Set the mount back to
              matched and both return.
              <br />
            </>
          )}
          <span style={{ color: "#777" }}>
            the stack spans <strong>{r.coneWindowWaves}</strong> waves at {CONE_PUPIL_SAMPLES}{" "}
            bins — {r.coneTopDepthUm.toFixed(2)}–{r.coneBottomDepthUm.toFixed(2)} µm of specimen,
            anchored at the depth control so no slice sits above the slip where there is no mount to
            look through — against a lattice period of{" "}
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

/**
 * Strehl against depth — and the two vertical rules on it are the whole surface.
 *
 * One is `mountDepthTolerance`'s Maréchal budget, a third-order coefficient held
 * to λ/14; the other is where the engine's own exact wavefront actually crosses
 * Strehl 0.8, bisected. On the low-NA rows they nearly coincide, which is
 * third-order theory being right; at an immersion aperture the quoted one is
 * several times deeper than the truth, because the exact wavefront outruns its
 * leading term as the aperture approaches the *mount's* index — the smallest
 * number anywhere in an immersion stack.
 *
 * Withdrawn rather than dimmed while stale, A4's rule: the caption quotes an NA
 * and a mount by name.
 */
function DepthPlot({ request }: { request: DepthRequest }) {
  const { result, pending } = useLatestFromWorker<DepthRequest, DepthResult>(
    createVolumeDepthWorker,
    request,
  );
  const depth = pending ? null : result;

  if (depth === null) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
        bisecting the depth budget on this objective&rsquo;s own Strehl…
      </p>
    );
  }
  if (!depth.ok) {
    return (
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", width: 420 }}>
        {refusalVoice(depth.source, "this objective")}: {depth.error}
      </p>
    );
  }

  const d = depth.readout;
  const span = d.curve[d.curve.length - 1]!.depthUm;
  const markers = [
    { y: 0.8, color: "#3a7", label: "Maréchal, Strehl 0.8" },
    ...(d.bisectedIdealUm !== null && d.bisectedIdealUm <= span
      ? [{ x: d.bisectedIdealUm, color: "#c00", label: "bisected" } as const]
      : []),
    ...(d.quotedMarechalUm !== null && d.quotedMarechalUm <= span
      ? [{ x: d.quotedMarechalUm, color: "#06a", label: "quoted budget" } as const]
      : []),
  ];

  return (
    <div>
      <Plot
        series={[
          {
            label: `the depth's own cost — ideal pupil at NA ${d.deliveredNA.toFixed(4)}`,
            color: "#111",
            points: d.curve.map((p) => [p.depthUm, p.ideal] as const),
            width: 2.4,
            dots: true,
          },
          {
            label: "this objective, traced",
            color: "#a60",
            points: d.curve.map((p) => [p.depthUm, p.traced] as const),
            width: 1.4,
            dash: [5, 4],
            dots: true,
          },
        ]}
        markers={markers}
        xLabel="depth below the coverslip, µm"
        yLabel="peak at best focus ÷ its value at zero depth"
        xMin={0}
        xMax={span}
        yMin={-0.05}
        yMax={1.1}
      />
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
        Every point is that pupil at its <strong>own best focus</strong>, over the same at zero
        depth — so what falls is the depth, with the objective&rsquo;s own residual and the
        mount&rsquo;s aperture truncation divided out. That division is legitimate because the
        truncation does <em>not</em> vary with depth (§ 6l.6); the support is identical at every
        point on these curves. The dots are where it was measured, and they thin out past the
        crossing: the two rules have to share one axis and are several times apart, so the sampling
        is dense where the curve turns and sparse where it is only carrying the reader to the
        quoted budget.
        <br />
        {d.quotedMarechalUm === null ? (
          <span style={{ color: GUARD_COLOR.warn }}>
            the engine refuses to quote a budget here — {d.quotedRefusal}
          </span>
        ) : (
          <>
            quoted <strong>{d.quotedMarechalUm.toFixed(3)} µm</strong> Maréchal ·{" "}
            {d.quotedQuarterUm!.toFixed(3)} µm at Rayleigh&rsquo;s quarter wave
          </>
        )}
        <br />
        bisected{" "}
        {d.bisectedIdealUm === null ? (
          <span style={{ color: GUARD_COLOR.warn }}>
            never — the Strehl does not reach 0.8 at any depth the search covered, which for a
            matched mount is the hard zero and not a limit of the search
          </span>
        ) : (
          <>
            <strong>{d.bisectedIdealUm.toFixed(3)} µm</strong> (ideal) ·{" "}
            {d.bisectedTracedUm === null ? "never (traced)" : `${d.bisectedTracedUm.toFixed(3)} µm (traced)`}
          </>
        )}
        {d.overReport !== null && (
          <>
            <br />
            <span
              style={{ color: d.overReport > 1.5 * d.marechalFloor ? GUARD_COLOR.warn : "#3a7" }}
            >
              the quoted budget over-reports by <strong>{d.overReport.toFixed(2)}×</strong>
            </span>{" "}
            — against a floor of {d.marechalFloor.toFixed(4)}, which is not 1 because λ/14 is
            Maréchal&rsquo;s <em>approximation</em> to Strehl 0.8 and actually delivers 0.8177. The
            wavefront is linear in depth, so a bisection at 0.8 runs{" "}
            {(1 / d.marechalFloor).toFixed(4)}× deeper than the coefficient allows at{" "}
            <em>every</em> aperture. Everything above that floor is the exact wavefront outrunning
            its own leading term.
            <br />
            {d.elapsedMs.toFixed(0)} ms · does not recompute when the depth slider moves
          </>
        )}
        {d.overReport === null && (
          <>
            <br />
            {d.elapsedMs.toFixed(0)} ms · does not recompute when the depth slider moves
          </>
        )}
      </div>
    </div>
  );
}

export function VolumePanel() {
  // The slot is read once, at mount: `readSavedBuild` parses a string, so a
  // call during a render would hand back a fresh spec object every time and
  // refire every effect keyed on the request. A panel unmounts on a route
  // change anyway, so mount is also when a build saved on the builder's own
  // route arrives here.
  const [saved] = useState(readSavedBuild);
  const options = useMemo(() => objectiveOptions(saved), [saved]);
  const [kind, setKind] = useState<ObjectiveId>("inf-20x-010");
  const objective = objectiveOf(options, kind);
  // Part F: a request carries the prescription, not a name from a list of ten.
  const spec = objective.spec;
  const [pupilSamples, setPupilSamples] = useState(32);
  const [sizeRaw, setSize] = useState(128);
  const [planes, setPlanes] = useState<number>(9);
  const [focusRaw, setFocus] = useState(0);
  const [beadsPerPlane, setBeadsPerPlane] = useState(8);
  const [seed, setSeed] = useState(7);
  const [stretch, setStretch] = useState<number>(4);
  // Matched and at the slip: the panel opens reproducing its own pre-D10 self,
  // and the interesting configuration is one click away.
  const [mount, setMount] = useState<MountChoice>("matched");
  const [depthUm, setDepthUm] = useState(0);

  // A4's floor: `incoherentPsf` refuses to truncate a pupil that does not fit
  // the grid, so the grid follows the pupil. Derived, never written back.
  const minSize = pupilSamples + 2 <= 128 ? 128 : 256;
  const size = Math.max(sizeRaw, minSize);
  // Clamped rather than reset, so shrinking the stack and growing it again does
  // not silently move the focus a reader had chosen.
  const halfPlanes = (planes - 1) / 2;
  const focusPlane = Math.max(-halfPlanes, Math.min(halfPlanes, focusRaw));

  const request = useMemo<VolumeRequest>(
    () => ({ spec, pupilSamples, size, planes, focusPlane, beadsPerPlane, seed, mount, depthUm }),
    [spec, pupilSamples, size, planes, focusPlane, beadsPerPlane, seed, mount, depthUm],
  );
  const axialRequest = useMemo<AxialRequest>(
    () => ({ spec, mount, depthUm }),
    [spec, mount, depthUm],
  );
  // Deliberately NOT keyed on the depth: this one is a sweep over depth, so the
  // slider is already on its x axis and re-running it would be re-deriving the
  // curve the reader is looking at.
  const depthRequest = useMemo<DepthRequest>(() => ({ spec, mount }), [spec, mount]);

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
          options={options.map((o) => o.id)}
          value={kind}
          onChange={setKind}
          format={(k) => objectiveOf(options, k).label}
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
      <div style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 12, maxWidth: 720 }}>
        <ObjectiveLine label={objective.label} note={objective.note} />
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
        <Slider
          label={
            readout === null
              ? `${depthUm.toFixed(2)} µm below the coverslip`
              : `${depthUm.toFixed(2)} µm below the coverslip — the slab's top face, and the axial sweep's emitter${readout.mountMatched ? "; a matched mount costs nothing at any depth" : ""}`
          }
          min={0}
          max={20}
          step={0.25}
          value={depthUm}
          onChange={setDepthUm}
        />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Choice
          label={
            readout === null
              ? "mounted in"
              : `mounted in ${readout.mountMedium} (n = ${readout.mountIndex.toFixed(4)}) — the objective was corrected for ${readout.objectMedium} (${readout.objectMediumIndex.toFixed(4)})`
          }
          options={MOUNT_MEDIA}
          value={mount}
          onChange={setMount}
          format={(m) => (m === "matched" ? "matched" : m.toLowerCase())}
        />
      </div>

      {result !== null && !result.ok && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: GUARD_COLOR.bad, maxWidth: 660 }}>
          {refusalVoice(result.source, "this render")}: {result.error}
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
              <strong>{readout.slabThicknessUm.toFixed(2)} µm</strong> deep, its top face{" "}
              {readout.slabDepthUm.toFixed(2)} µm down · NA {readout.tracedNA.toFixed(4)} engraved
              in {readout.objectMedium} ({readout.objectMediumIndex.toFixed(4)}), mounted in{" "}
              {readout.mountMedium} ({readout.mountIndex.toFixed(4)})
              <br />
              <span
                style={{ color: readout.deliveredNA < readout.tracedNA ? GUARD_COLOR.warn : "#3a7" }}
              >
                delivered NA <strong>{readout.deliveredNA.toFixed(4)}</strong>
                {readout.deliveredNA < readout.tracedNA
                  ? " — the mount's own index caps it, and that is not an aberration: no ray of higher invariant leaves the specimen, so the rim of the pupil is simply dark"
                  : " — the mount carries the whole pupil"}
              </span>
              <br />
              depth of focus {readout.depthOfFocusUm.toFixed(3)} µm = one plane step = half a wave —
              measured in the <em>mount</em>, so this step in µm moves with the mount control while
              the step in waves does not
              <br />
              focused {readout.focusDepthUm.toFixed(3)} µm down, which costs{" "}
              <span style={{ color: readout.mountMatched ? "#3a7" : "#a60" }}>
                <strong>{readout.focusDepthWaves.toFixed(4)}</strong> waves
              </span>{" "}
              at {WAVEFRONT_RHO.toFixed(2)} of the delivered rim
              {readout.mountMatched && " — identically zero, at every depth and every aperture"}
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
              {readout.peakOverMean === null ? (
                <span style={{ color: GUARD_COLOR.warn }}>
                  peak ÷ mean is 0/0 on an empty frame
                </span>
              ) : (
                <>
                  peak ÷ mean <strong>{readout.peakOverMean.toFixed(2)}</strong> — signal against
                  haze
                </>
              )}
              <br />
              total light {readout.totalLight.toPrecision(12)} · throughput drift{" "}
              {readout.throughputDrift === null ? (
                <span style={{ color: GUARD_COLOR.warn }}>
                  undefined — fewer than two planes carry light, and a drift over nothing is 0 by
                  initialization, which is the value that would mean it holds exactly
                </span>
              ) : (
                <span style={{ color: "#3a7" }}>{readout.throughputDrift.toExponential(2)}</span>
              )}
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
        <DepthPlot request={depthRequest} />
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
        can hold shrinks the harder of the two: <em>on the bench&rsquo;s rows</em>, at 4×/0.10 nine
        planes is <em>529 µm</em> of specimen — thicker than any real slide — while at 100×/1.40 the
        same nine planes is <em>4.1 µm</em>, about one cell. The slab for whatever is selected here,
        including a lens you built, is printed under the picture. That is A1&rsquo;s &ldquo;the span
        is set by NA
        alone&rdquo; with the axial direction added, and it is why the immersion rows are where a
        z-stack means something.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>
          Where the axial peak sits is a reading of A1&rsquo;s σ — with the mount matched.
        </strong>{" "}
        Everything in this paragraph is a statement about an objective with nothing but itself in
        the beam, and the numbers in it are read at <em>matched, zero depth</em>. Put a mismatched
        mount under the specimen and the peak moves by the depth&rsquo;s own compensating defocus
        instead, which on the immersion rows is several times the whole traced σ — so the caption
        above stops quoting a share and says so rather than clamping one. A1 reports the
        wavefront error as traced, about the pupil&rsquo;s own mean at the system&rsquo;s{" "}
        <em>own</em> image plane with no best-focus solve, and says a red number means &ldquo;not at
        this focus&rdquo; rather than &ldquo;not correctable&rdquo;. The left-hand plot measures
        that: a residual defocus moves the axial peak off w₂₀ = 0, and the defocus it takes to get
        there carries σ = |w|/(2√3) of its own. <em>Measured on the bench&rsquo;s ten rows</em>, for
        the three whose traced σ is over λ/14 that accounts for <strong>90%, 92% and 100%</strong>{" "}
        of it — the DIN 4×/0.10 peaks 0.438 waves away and is 1.79× brighter there, the 100×/1.25
        oil 0.156 waves and 1.10×, the 100×/1.40 oil 0.281 waves and 1.27×. Their red is{" "}
        <em>focus</em>, and almost nothing else. The well-corrected rows sit one step of this sweep
        from zero (the infinity 20× and the Lister both at 0.031 waves, 1.002× and 1.006×), which
        is a bound rather than a measurement, and the caption says so where it happens. Those five
        numbers belong to those five lenses; <strong>the same three quantities for whatever is
        selected — the peak offset, the ratio, and the share of σ it accounts for — are printed
        under the left-hand plot</strong>, swept live, so a design of your own is measured here
        rather than compared to a table it is not in. A1&rsquo;s wording was right and this is the
        number behind it.
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
        <strong>The specimen is mounted in something, and that is where the depth goes.</strong>{" "}
        Focusing d below the slip drags the cone through d of a medium the objective was not
        corrected for, and adds spherical aberration <em>that grows with d</em> — the dominant real
        defect of deep imaging, and the reason correction collars exist. No new physics was needed
        for it: § 6c solves a plate to all orders and § 6e the N-layer stack, and a focal depth is
        one more layer. Three consequences are on this page rather than asserted. It is{" "}
        <strong>exactly linear in depth</strong>, at every aperture and to all orders. It is{" "}
        <strong>identically zero for a matched mount</strong> — a hard zero carried by an explicit
        (n_s²−n_i²) factor, not a small residual, which is the whole reason water and glycerol
        objectives exist and why setting the mount control back to <em>matched</em> reproduces this
        panel&rsquo;s pre-mount self to the bit. And unlike a slip error, which is a fixed one-off,{" "}
        <strong>depth is unbounded</strong>: every mismatched mount has a depth past which no
        objective is diffraction-limited, which is the third plot.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>The wall in the delivered NA is not aberration at all.</strong> A ray inside the
        specimen carries q = n_s·sinθ_s, strictly below n_s, so <em>no ray of higher invariant ever
        leaves it</em> — an objective engraved 1.40 collects at most 1.3334 from a water mount
        however well it is made, and the outer annulus of its pupil receives nothing. That costs
        resolution with no aberration in it, and it is why the resolution above is quoted at the
        delivered aperture. The ceiling is also <em>open</em>, which is why the budget plot refuses
        to quote a number for an objective whose engraved NA the mount cannot deliver: the aperture
        is approached and never reached, so a tolerance quoted there would be a statement about rays
        that do not exist. The same asymmetry is what lets the pupil <em>mask</em> use that number —
        a mask&rsquo;s boundary is one lattice point of measure zero.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>Two questions, and the panel asks both rather than blurring them.</strong> &ldquo;A
        pupil that varies with depth&rdquo; means two physically different things. Each plane of a
        thick specimen sits at its own depth and looks through its own thickness of mount — that is
        the picture and the cone. One emitter at a known depth with the objective walked through it
        is the other, and it is the axial response: its aberration is set once and only the focus
        moves. They give different curves, so the engine makes a caller compose the second by hand
        rather than offering a flag, and this panel labels which is which. What the second one shows
        is that <em>refocusing buys back the paraxial half and no more</em>: best focus moves, the
        response stops being even in the defocus, and the peak never comes back to where it was.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        <strong>One thing is still deliberately absent.</strong> There is no{" "}
        <em>field decomposition</em>: `renderVolume` takes one pupil keyed on depth, not one keyed
        on position, so the whole frame is imaged through the on-axis traced pupil and the previous
        panel&rsquo;s corner-versus-axis comparison has no analogue here. The mount inherits that
        limit exactly — a plate in a non-telecentric beam adds coma and astigmatism as well, and the
        object-space ray aiming that would express it is § 6a&rsquo;s standing blocker.
      </p>
    </>
  );
}
