import { useMemo, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot, type PlotMarker, type PlotSeries } from "../plot";
import { Choice, Guard, GUARD_COLOR, Slider } from "../ui";
import { createMechOpticsWorker, createMechParfocalWorker } from "../workers";
import {
  APERTURES_MM,
  CAMERA_KEYS,
  CAMERA_LABEL,
  DEFAULT_CHAIN,
  DEFAULT_FOCUSER,
  DIAGONAL_KINDS,
  DIN_PARFOCAL_MM,
  budgetShare,
  chainGlassMm,
  chainReadout,
  colourReadout,
  travelSweep,
  type ApertureMm,
  type CameraKey,
  type ChainSpec,
  type Crossing,
  type DiagonalKind,
  type MountSweep,
  type MountSweepRequest,
  type OpticsSweep,
  type OpticsSweepRequest,
} from "../mech";

/**
 * The mechanical train — APP.md's C3.
 *
 * The first surface in this app whose subject is not light. `core/mech` has had
 * no app presence since it landed, which ROADMAP names in bold, and what it says
 * is one thing: **a part's mechanical length and its optical cost are different
 * numbers.** So the headline here is not a picture and not a wavefront — it is
 * two verdicts about one parts list, disagreeing, with a focuser the reader can
 * walk between them.
 *
 * ## Four blocks, and only the first is about lengths
 *
 * The budget and the reach are arithmetic. What follows are the three things a
 * budget made of lengths cannot see: what the glass costs the image (§ 5u.6,
 * which the ladder computed and never traced), the colour it adds (§ 5u.5), and
 * the ceiling a *mount* puts on an optical design (§ 5u.7). The last is why this
 * is the first entry in APP.md that belongs to neither branch: the DIN parfocal
 * standard is a microscope's, and it is sitting in ROADMAP step 5.
 *
 * ## Everything on screen is measured, including both walls
 *
 * A6's rule, and it applies twice here. § 5u's f/5.315 and its 4.236 are numbers
 * in the validation ladder, not engine exports, so this panel bisects for them —
 * and the second bisection has to tell **two different refusals apart**, because
 * `finiteConjugateObjective` can fail either because the standard cannot hold
 * the lens (§ 5u.7's mount) or because no such doublet exists (§ 6b.5's
 * aperture). Catching both as one exception reports a mount ceiling of 12.6× at
 * NA 0.25, where the truth is that nothing can be built there at all.
 */

const TRAVEL_POINTS = 25;
const SWEEP_POINTS = 17;
const MIN_RATIO = 3;
const MAX_RATIO = 20;

/** Where the σ plot stops, in budgets — log₁₀, because the range is five decades. */
const LOG_SIGMA_MIN = -3.2;
const LOG_SIGMA_MAX = 2;

const MOUNT_POINTS = 13;
const MOUNT_MIN_M = 4;
const MOUNT_MAX_M = 60;

const fmt = (value: number, digits = 3): string =>
  `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(digits)}`;

function CrossingLine({ label, crossing, colour }: {
  label: string;
  crossing: Crossing;
  colour: string;
}) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ color: colour }}>{label} </span>
      <strong>
        {crossing.focalRatio === null ? "—" : `f/${crossing.focalRatio.toFixed(3)}`}
      </strong>
      {crossing.reason !== undefined && (
        <span style={{ color: "#777" }}> · {crossing.reason}</span>
      )}
    </div>
  );
}

/** Required travel against the glass inside a fixed light path. */
function TravelPlot({
  spec,
  focuser,
}: {
  spec: ChainSpec;
  focuser: typeof DEFAULT_FOCUSER;
}) {
  const sweep = useMemo(
    () => travelSweep(spec, focuser, TRAVEL_POINTS),
    [spec, focuser],
  );
  const ys = sweep.flatMap((p) => [p.requiredTravelMm, p.naiveRequiredTravelMm]);
  const lo = Math.min(...ys, -focuser.inwardTravelMm) - 6;
  const hi = Math.max(...ys, focuser.outwardTravelMm) + 6;
  const series: PlotSeries[] = [
    {
      label: "traced budget — the glass hands travel back",
      color: "#111",
      points: sweep.map((p) => [p.prismGlassMm, p.requiredTravelMm] as const),
      width: 2,
      dots: true,
    },
    {
      label: "glass counted as air — the spreadsheet",
      color: "#c00",
      points: sweep.map((p) => [p.prismGlassMm, p.naiveRequiredTravelMm] as const),
      dash: [5, 4],
    },
  ];
  const markers: PlotMarker[] = [
    { y: focuser.outwardTravelMm, color: "#a60", label: "racked out" },
    { y: -focuser.inwardTravelMm, color: "#a60", label: "racked in" },
  ];
  // "You are here" only when the chain really is somewhere on this axis. A
  // mirror diagonal is x = 0 exactly; a chain with NO diagonal is 110 mm shorter
  // than every point on the curve, so marking it at 0 would point at a train the
  // readouts above are not describing.
  if (spec.diagonal !== "none") {
    markers.push({ x: spec.diagonal === "prism" ? spec.prismGlassMm : 0, color: "#06a" });
  }
  return (
    <Plot
      series={series}
      markers={markers}
      xLabel={`glass inside a ${spec.diagonalPathMm.toFixed(0)} mm light path (mm) — 0 IS a mirror diagonal`}
      // Short, because `Plot` rotates this into the plot's own height and a
      // longer sentence is silently clipped rather than wrapped.
      yLabel="travel needed (mm), + is out"
      xMin={0}
      xMax={spec.diagonalPathMm}
      yMin={lo}
      yMax={hi}
    />
  );
}

/** σ against focal ratio, with and without the glass, in Maréchal budgets. */
function SigmaPlot({ sweep, glassMm }: { sweep: OpticsSweep; glassMm: number }) {
  const logBudgets = (waves: number): number =>
    Math.log10(Math.max(budgetShare(waves), 10 ** LOG_SIGMA_MIN));
  const bare: (readonly [number, number])[] = [];
  const glassed: (readonly [number, number])[] = [];
  const plate: (readonly [number, number])[] = [];
  for (const p of sweep.points) {
    if (p.bare.ok) bare.push([p.focalRatio, logBudgets(p.bare.sigmaWaves)]);
    if (p.glassed.ok) glassed.push([p.focalRatio, logBudgets(p.glassed.sigmaWaves)]);
    if (glassMm > 0) plate.push([p.focalRatio, logBudgets(p.closedPlateWaves)]);
  }
  const markers: PlotMarker[] = [{ y: 0, color: "#a60", label: "Maréchal λ/14" }];
  if (sweep.glassedMarechal.focalRatio !== null) {
    markers.push({ x: sweep.glassedMarechal.focalRatio, color: "#111" });
  }
  if (sweep.plateRayleigh.focalRatio !== null) {
    markers.push({ x: sweep.plateRayleigh.focalRatio, color: "#777", label: "§ 5u's f/5.315" });
  }
  return (
    <Plot
      series={[
        { label: "doublet + the chain's glass", color: "#111", points: glassed, width: 2, dots: true },
        { label: "the doublet alone", color: "#06a", points: bare, dash: [5, 4], width: 1.6 },
        { label: "the plate alone, closed form", color: "#3a7", points: plate, width: 1.6 },
      ]}
      markers={markers}
      xLabel="focal ratio of the doublet the glass sits in"
      yLabel="log₁₀ σ, in Maréchal budgets"
      xMin={MIN_RATIO}
      xMax={MAX_RATIO}
      yMin={LOG_SIGMA_MIN}
      yMax={LOG_SIGMA_MAX}
    />
  );
}

/**
 * The panel's own measurement against the closed form it is measured with.
 *
 * Drawn because the ratio is the finding and not the σ: it never converges to
 * one. See the caption — the floor is the pupil lattice's quadrature, and it is
 * larger than the departure it would have to resolve.
 */
function RatioPlot({ sweep }: { sweep: OpticsSweep }) {
  const measured: (readonly [number, number])[] = [];
  const exact: (readonly [number, number])[] = [];
  for (const p of sweep.points) {
    if (p.measuredPlateWaves !== null && p.closedPlateWaves > 0) {
      measured.push([p.focalRatio, p.measuredPlateWaves / p.closedPlateWaves]);
    }
    exact.push([p.focalRatio, p.exactOverThird]);
  }
  const ys = [...measured, ...exact].map(([, y]) => y);
  const hi = Math.max(1.02, ...ys) + 0.01;
  return (
    <Plot
      series={[
        {
          label: "traced (glassed − bare) ÷ W₀₄₀/(6√5)",
          color: "#111",
          points: measured,
          width: 2,
          dots: true,
        },
        {
          label: "the exact plate form ÷ the third-order one",
          color: "#3a7",
          points: exact,
          dash: [5, 4],
        },
      ]}
      markers={[{ y: 1, color: "#a60", label: "the closed form" }]}
      xLabel="focal ratio"
      yLabel="measured ÷ closed form"
      xMin={MIN_RATIO}
      xMax={MAX_RATIO}
      yMin={0.98}
      yMax={hi}
    />
  );
}

/** Paraxial focus against wavelength, bare and glassed, on both glass pairs. */
function ColourPlot({
  readout,
}: {
  readout: ReturnType<typeof colourReadout>;
}) {
  const series: PlotSeries[] = [];
  const colours = ["#111", "#a0a"];
  const ys: number[] = [];
  readout.curves.forEach((curve, i) => {
    if (!curve.ok) return;
    for (const p of curve.points) ys.push(p.bareMm, p.glassedMm);
    series.push({
      label: `${curve.label} — bare`,
      color: colours[i]!,
      points: curve.points.map((p) => [p.wavelengthNm, p.bareMm] as const),
      dash: [5, 4],
    });
    series.push({
      label: `${curve.label} — with the glass`,
      color: colours[i]!,
      points: curve.points.map((p) => [p.wavelengthNm, p.glassedMm] as const),
      width: 2,
      dots: true,
    });
  });
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const pad = 0.12 * (hi - lo || 1);
  return (
    <Plot
      series={series}
      // Only one of the two rules is named. They sit a depth of focus apart —
      // 29 µm on a 0.7 mm axis — and `Plot` writes every horizontal label at its
      // own line's height, so two would overprint. The unlabelled one is the
      // axis zero, which the y label already says each curve is drawn against.
      markers={[
        { y: 0, color: "#777" },
        { y: readout.depthOfFocusMm, color: "#a60", label: "one Rayleigh depth of focus" },
      ]}
      xLabel="wavelength (nm) — F line at the left, C at the right"
      yLabel="focus (mm) vs the d line"
      xMin={480}
      xMax={660}
      yMin={lo - pad}
      yMax={hi + pad}
    />
  );
}

/** Barrel length against magnification, and the two walls under it. */
function MountPlot({ sweep }: { sweep: MountSweep }) {
  const fits = sweep.points.filter((p) => p.verdict === "fits");
  const barrel = fits.map((p) => [p.magnification, p.barrelMm!] as const);
  const objectDistance = sweep.points
    .filter((p) => p.objectDistanceMm !== null)
    .map((p) => [p.magnification, p.objectDistanceMm!] as const);
  // The two floors are 2% apart on a 0–60 axis, so they are one line to look at
  // and the readout beside the plot is what separates them — only the outer one
  // is named, A6's rule for rules that land on top of each other. The doublet
  // wall, when it exists at all, is nowhere near either and keeps its label.
  const markers: PlotMarker[] = [
    // Named for what it IS rather than for what binds, because above ~NA 0.22 it
    // binds nothing: a grey rule labelled "the floor" at 4.14 while the buildable
    // range starts at 43 would be this panel's own refusal rule, broken.
    { x: sweep.thinLensFloor, color: "#777", label: "thin-lens floor" },
  ];
  if (sweep.measuredFloor !== null) {
    markers.push({ x: sweep.measuredFloor, color: "#c00" });
  }
  if (sweep.doubletFloor !== null) {
    markers.push({ x: sweep.doubletFloor, color: "#a0a", label: "no doublet below" });
  }
  return (
    <Plot
      series={[
        { label: "barrel — shoulder to first vertex", color: "#111", points: barrel, width: 2, dots: true },
        {
          label: "working distance — first vertex to specimen",
          color: "#06a",
          points: objectDistance,
          dash: [5, 4],
        },
      ]}
      markers={markers}
      xLabel="magnification against a 150 mm optical tube"
      yLabel="mm below the shoulder"
      xMin={0}
      xMax={MOUNT_MAX_M}
      yMin={0}
      yMax={50}
    />
  );
}

export function MechPanel() {
  const [diagonal, setDiagonal] = useState<DiagonalKind>(DEFAULT_CHAIN.diagonal);
  const [prismGlassMm, setPrismGlass] = useState(DEFAULT_CHAIN.prismGlassMm);
  const [filterMm, setFilter] = useState(DEFAULT_CHAIN.filterMm);
  const [spacerMm, setSpacer] = useState(DEFAULT_CHAIN.spacerMm);
  const [camera, setCamera] = useState<CameraKey>(DEFAULT_CHAIN.camera);
  const [backFocusMm, setBackFocus] = useState(DEFAULT_FOCUSER.backFocusMm);
  const [outwardTravelMm, setOutward] = useState(DEFAULT_FOCUSER.outwardTravelMm);

  const [apertureMm, setAperture] = useState<ApertureMm>(100);
  const [pupilSamples, setPupilSamples] = useState(21);
  const [focalRatio, setFocalRatio] = useState(5);

  const [numericalAperture, setNumericalAperture] = useState(0.1);
  // `DIN_PARFOCAL_MM` comes off an `as const` table, so its type is the literal
  // 45 — the slider needs the state widened to a number to write to it.
  const [parfocalDistanceMm, setParfocal] = useState<number>(DIN_PARFOCAL_MM);

  const spec = useMemo<ChainSpec>(
    () => ({
      diagonal,
      diagonalPathMm: DEFAULT_CHAIN.diagonalPathMm,
      prismGlassMm,
      filterMm,
      spacerMm,
      camera,
    }),
    [diagonal, prismGlassMm, filterMm, spacerMm, camera],
  );
  const focuser = useMemo(
    () => ({ backFocusMm, inwardTravelMm: DEFAULT_FOCUSER.inwardTravelMm, outwardTravelMm }),
    [backFocusMm, outwardTravelMm],
  );
  const readout = useMemo(() => chainReadout(spec, focuser), [spec, focuser]);
  const glassMm = chainGlassMm(spec);

  // Keyed on the cone and the glass ALONE. A spacer, a camera body and the
  // focuser are all lengths, and a length does not change a cone angle — so
  // nothing block 1 offers may re-run a 1.5 s trace.
  const opticsRequest = useMemo<OpticsSweepRequest>(
    () => ({
      apertureMm,
      glassMm,
      minRatio: MIN_RATIO,
      maxRatio: MAX_RATIO,
      points: SWEEP_POINTS,
      pupilSamples,
    }),
    [apertureMm, glassMm, pupilSamples],
  );
  const mountRequest = useMemo<MountSweepRequest>(
    () => ({
      numericalAperture,
      parfocalDistanceMm,
      minMagnification: MOUNT_MIN_M,
      maxMagnification: MOUNT_MAX_M,
      points: MOUNT_POINTS,
    }),
    [numericalAperture, parfocalDistanceMm],
  );

  const optics = useLatestFromWorker<OpticsSweepRequest, OpticsSweep>(
    createMechOpticsWorker,
    opticsRequest,
  );
  const mount = useLatestFromWorker<MountSweepRequest, MountSweep>(
    createMechParfocalWorker,
    mountRequest,
  );
  const colour = useMemo(
    () => colourReadout(apertureMm, focalRatio, glassMm),
    [apertureMm, focalRatio, glassMm],
  );

  const nullDifference = optics.result?.positionNull.differenceWaves ?? null;
  const bkPair = colour.curves[0];

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The mechanical train: a length that is not its own cost</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        A 2″ prism star diagonal occupies about 110 mm of light path, of which about 40 mm is
        glass. Mechanically it consumes all 110. Optically the glass pushes the focal plane back
        by t(1−1/n), so the chain behind it gets <strong>13.63 mm</strong> of that back — a third
        of the prism, with the engine&rsquo;s own catalog index in it rather than a rule of thumb.
        A parts-list budget that counts glass as air is wrong by exactly Σtᵢ(1−1/nᵢ), and always
        in the direction that says a train will not reach focus when it will.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        <strong>The mech layer never applies that formula to an image.</strong>{" "}
        <code>withGlassPath</code> splices plane surfaces into the prescription and the tracer
        finds the focus, which is what makes the closed form a <em>test</em> rather than a
        substitute — and what makes the spliced chain carry spherical aberration and colour that
        nobody put in by hand. The three blocks below the budget are those two, plus a ceiling
        that comes from a mount.
      </p>

      <h2 style={{ fontSize: 15, marginBottom: 4 }}>1 · The budget, and the two verdicts</h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
        <Choice label="diagonal" options={DIAGONAL_KINDS} value={diagonal} onChange={setDiagonal} />
        <Choice
          label="camera body — flange focal distance"
          options={CAMERA_KEYS}
          value={camera}
          onChange={setCamera}
          format={(key) => CAMERA_LABEL[key]}
        />
        <Slider
          label={`prism glass ${prismGlassMm.toFixed(0)} mm${diagonal === "prism" ? "" : " (no prism in the chain)"}`}
          min={0}
          max={DEFAULT_CHAIN.diagonalPathMm}
          step={1}
          value={prismGlassMm}
          onChange={setPrismGlass}
        />
        <Slider
          label={`filter ${filterMm.toFixed(1)} mm of substrate`}
          min={0}
          max={6}
          step={0.5}
          value={filterMm}
          onChange={setFilter}
        />
        <Slider
          label={`extension ${spacerMm.toFixed(0)} mm`}
          min={0}
          max={80}
          step={1}
          value={spacerMm}
          onChange={setSpacer}
        />
        <Slider
          label={`focuser back focus ${backFocusMm.toFixed(0)} mm`}
          min={80}
          max={260}
          step={1}
          value={backFocusMm}
          onChange={setBackFocus}
        />
        <Slider
          label={`out-travel ${outwardTravelMm.toFixed(0)} mm (in-travel fixed at ${DEFAULT_FOCUSER.inwardTravelMm})`}
          min={0}
          max={80}
          step={1}
          value={outwardTravelMm}
          onChange={setOutward}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, width: 420 }}>
          <Guard
            label="does it reach focus?"
            value={readout.reaches ? "yes" : "no"}
            level={readout.reaches ? "ok" : "bad"}
            detail={`the train needs ${fmt(readout.requiredTravelMm)} mm of travel, and has +${outwardTravelMm} / −${DEFAULT_FOCUSER.inwardTravelMm}`}
          />
          <Guard
            label="what a parts-list budget says:"
            value={readout.naiveReaches ? "yes" : "no"}
            level={readout.verdictsDisagree ? "warn" : readout.naiveReaches ? "ok" : "bad"}
            detail={
              readout.verdictsDisagree
                ? `it asks for ${fmt(readout.naiveRequiredTravelMm)} mm — THE TWO DISAGREE, and the parts list is the one that is wrong`
                : `it asks for ${fmt(readout.naiveRequiredTravelMm)} mm; both verdicts agree here`
            }
          />
          <Guard
            label="the glass hands back:"
            value={`${readout.focusShiftMm.toFixed(4)} mm`}
            level="ok"
            detail={`${readout.glassThicknessMm.toFixed(1)} mm of N-BK7 in a ${readout.mechanicalLengthMm.toFixed(1)} mm chain — the naive sum is wrong by ${(readout.naiveErrorFraction * 100).toFixed(2)}% of the whole chain's length`}
          />
          <span style={{ color: "#777" }}>
            mechanically {readout.mechanicalLengthMm.toFixed(2)} mm · honestly{" "}
            {readout.consumedMm.toFixed(2)} mm out of back focus · margin {fmt(readout.marginMm)} mm
          </span>
        </div>
        <TravelPlot spec={spec} focuser={focuser} />
      </div>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 4 }}>
        <strong>The red line is flat, and that is the whole layer in one picture.</strong> Filling
        a fixed-length diagonal with more glass does not change what it <em>occupies</em>, so a
        budget made of lengths cannot see this axis at all, while the honest one slopes at
        (1 − 1/n) = 0.3407 per millimetre. Every other control on this page translates both lines
        together; only this one separates them. The x = 0 end is not a fiction — a diagonal with
        no glass in it is a mirror diagonal, and it is built as one.
      </p>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 8 }}>
        <strong>And the honest line leaves the focuser at both ends</strong>, which is not something
        the budget arithmetic suggests. Too little glass and the train wants to rack further{" "}
        <em>in</em> than the drawtube goes; too much and it wants more <em>out</em>-travel than
        there is. On the default focuser the band of trains that reach focus is roughly 5 to 100 mm
        of glass, so &ldquo;a prism diagonal buys back back-focus&rdquo; has a ceiling as well as a
        floor — a solid block of glass the length of the fold would push the focal plane past the
        end of the travel.
      </p>

      <h2 style={{ fontSize: 15, marginTop: 28, marginBottom: 4 }}>
        2 · What the glass costs the image
      </h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
        <Choice
          label="doublet aperture"
          options={APERTURES_MM}
          value={apertureMm}
          onChange={setAperture}
          format={(mm) => `${mm} mm`}
        />
        <Choice
          label={`pupil samples ${pupilSamples} across the diameter`}
          options={[15, 21, 31]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Slider
          label={`colour block at f/${focalRatio.toFixed(1)}`}
          min={MIN_RATIO}
          max={15}
          step={0.5}
          value={focalRatio}
          onChange={setFocalRatio}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          opacity: optics.pending ? 0.55 : 1,
          transition: "opacity 120ms ease-out",
        }}
      >
        {optics.result === null ? (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
            tracing the doublet twice at every focal ratio…
          </p>
        ) : (
          <>
            <div>
              <SigmaPlot sweep={optics.result} glassMm={glassMm} />
              <div style={{ width: 420, marginTop: 6 }}>
                <CrossingLine
                  label="the plate alone, Rayleigh λ/4 on the peak:"
                  crossing={optics.result.plateRayleigh}
                  colour="#3a7"
                />
                <CrossingLine
                  label="the same plate, Maréchal λ/14 on σ:"
                  crossing={optics.result.plateMarechal}
                  colour="#3a7"
                />
                <CrossingLine
                  label="the doublet alone, traced:"
                  crossing={optics.result.bareMarechal}
                  colour="#06a"
                />
                <CrossingLine
                  label="the doublet with the glass in it, traced:"
                  crossing={optics.result.glassedMarechal}
                  colour="#111"
                />
              </div>
            </div>
            <div>
              <RatioPlot sweep={optics.result} />
              <div style={{ width: 420, marginTop: 6 }}>
                <Guard
                  label="the glass does not care where it sits:"
                  value={
                    nullDifference === null
                      ? "not measured here"
                      : `${nullDifference.toExponential(2)} waves`
                  }
                  level={nullDifference !== null && nullDifference < 1e-8 ? "ok" : "warn"}
                  detail={`the same glass at a ${optics.result.positionNull.nearGapMm.toFixed(0)} mm and a ${optics.result.positionNull.farGapMm.toFixed(0)} mm gap, at f/${optics.result.positionNull.focalRatio.toFixed(1)} — § 5u.2's identity, measured rather than assumed`}
                />
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#777" }}>
                  {optics.result.elapsedMs.toFixed(0)} ms
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 8 }}>
        <strong>
          § 5u.6&rsquo;s f/5.315 is a statement about the plate in isolation, and no real refractor
          reaches it first.
        </strong>{" "}
        On a 100 mm doublet the lens itself leaves the Maréchal budget at{" "}
        <strong>f/6.007</strong> and the lens with the diagonal in it at <strong>f/6.192</strong> —
        both <em>slower</em> than the plate&rsquo;s own quarter-wave crossing. So the practical
        reading of &ldquo;a diagonal is marginal on a common f/5&rdquo; is not that the diagonal
        spoils an otherwise diffraction-limited instrument: at f/5 the doublet is already 2.6
        budgets over on its own, and the diagonal is the smaller of the two problems. It costs 3.1%
        of focal ratio, and it is <em>never</em> free — the difference is positive at every ratio
        swept, because a plate&rsquo;s spherical aberration has the same sign as an achromat&rsquo;s
        own residual and the two add. That is the opposite of § 6e.4&rsquo;s immersion oil, which is
        rarer than the glass either side of it and therefore <em>helps</em>.
      </p>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 8 }}>
        <strong>The right-hand plot is why § 5u.6 was closed form only.</strong> The traced
        difference reproduces W₀₄₀/(6√5) to about ±1% — but the residual never converges to one,
        and it is not physics: it is the <em>pupil lattice&rsquo;s own quadrature</em>. Move the
        sampling control and it wanders non-monotonically (1.061 at 9, 0.956 at 15, 1.007 at 21,
        0.995 at 31, 0.988 at 61) and the <em>same</em> sequence comes back where the lens&rsquo;s
        share of the total is four times different — bare ÷ plate is 3.64 at f/10 and 0.90 at
        f/40, and the two wobbles agree to 2.5e-3 — so it is not the lens&rsquo;s higher orders
        either. That ±1% is <em>larger</em> than the exact
        form&rsquo;s departure from the third-order one at every ratio slower than about f/4 — the
        green dashed line is under the black one&rsquo;s noise — so this route cannot resolve
        § 5u.6&rsquo;s 1.0018 at f/10. A surface that draws a quantity a rung only summarized has
        found the sampling the rung could afford to ignore, for the fifth time in this doc.
      </p>

      <h2 style={{ fontSize: 15, marginTop: 28, marginBottom: 4 }}>
        3 · The colour a budget made of lengths cannot see
      </h2>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ColourPlot readout={colour} />
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, width: 420 }}>
          {colour.curves.map((curve) =>
            curve.ok ? (
              <Guard
                key={curve.label}
                label={`${curve.label}:`}
                value={`F−C ${fmt(curve.bareSpreadMm, 4)} → ${fmt(curve.glassedSpreadMm, 4)} mm`}
                level={curve.reduced ? "ok" : "warn"}
                detail={`the plate moved it by ${fmt(curve.addedMm, 6)} mm — ${(curve.addedMm / colour.depthOfFocusMm).toFixed(2)} Rayleigh depths of focus at f/${colour.focalRatio.toFixed(1)}`}
              />
            ) : (
              <Guard
                key={curve.label}
                label={`${curve.label}:`}
                value="refused"
                level="bad"
                detail={curve.reason}
              />
            ),
          )}
          <span style={{ color: "#777" }}>
            one depth of focus is 2λ(f/#)² = {(colour.depthOfFocusMm * 1000).toFixed(1)} µm ·{" "}
            {colour.elapsedMs.toFixed(1)} ms
          </span>
        </div>
      </div>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 4 }}>
        t(1−1/n) grows with n, so a plate pushes <strong>blue further back</strong> — the opposite
        of what a positive element does, and that half is a law. The tempting next sentence is not.
        &ldquo;A glass diagonal is a colour compensator&rdquo; needs the lens&rsquo;s F−C spread to
        have the opposite sign, and for an achromat that spread is a <em>residual</em> whose sign
        belongs to the lens rather than to lenses — so both glass pairs are drawn rather than one
        being asserted and the other assumed. What is exactly identical across them is the{" "}
        <strong>amount</strong>: {bkPair?.ok ? fmt(bkPair.addedMm, 6) : "—"} mm on both, because the
        plate does not know what it is bolted to. At f/5 that is more than four Rayleigh depths of
        focus and inside one at f/10 — invisible to any budget made of lengths, which is the point.
      </p>

      <h2 style={{ fontSize: 15, marginTop: 28, marginBottom: 4 }}>
        4 · The ceiling that comes from a mount
      </h2>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
        <Slider
          label={`objective NA ${numericalAperture.toFixed(2)}`}
          min={0.05}
          max={0.3}
          step={0.01}
          value={numericalAperture}
          onChange={setNumericalAperture}
        />
        <Slider
          label={`parfocal standard ${parfocalDistanceMm.toFixed(0)} mm${parfocalDistanceMm === DIN_PARFOCAL_MM ? " (DIN)" : ""}`}
          min={30}
          max={95}
          step={1}
          value={parfocalDistanceMm}
          onChange={setParfocal}
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          alignItems: "flex-start",
          opacity: mount.pending ? 0.55 : 1,
          transition: "opacity 120ms ease-out",
        }}
      >
        {mount.result === null ? (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", width: 420 }}>
            solving an objective at every magnification…
          </p>
        ) : (
          <>
            <MountPlot sweep={mount.result} />
            <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, width: 420 }}>
              <Guard
                label="thin-lens floor, before any glass:"
                value={`${mount.result.thinLensFloor.toFixed(4)}×`}
                level="ok"
                detail="[x′ + √(x′² + 4Px′)] / 2P — a single group cannot stand closer than x′(M+1)/M²"
              />
              <Guard
                label="the floor with real glass, bisected:"
                value={
                  mount.result.measuredFloor === null
                    ? "the mount is not what is binding here"
                    : `${mount.result.measuredFloor.toFixed(4)}×`
                }
                level={mount.result.measuredFloor === null ? "warn" : "bad"}
                detail={
                  mount.result.measuredFloor === null
                    ? `below ${mount.result.doubletFloor?.toFixed(3) ?? "this range"}× no doublet exists at all — § 6b.5's aperture wall, not § 5u.7's mount`
                    : `${mount.result.glassPenalty!.toFixed(5)}× the thin-lens floor: the built doublet is thick, and its glass eats a budget the thin-lens floor has already spent`
                }
              />
              {mount.result.doubletFloor !== null && mount.result.measuredFloor !== null && (
                <Guard
                  label="and the other wall:"
                  value={`${mount.result.doubletFloor.toFixed(3)}×`}
                  level="warn"
                  detail="below this the glass pair admits no lens at this aperture — a different refusal on the same axis"
                />
              )}
              <span style={{ color: "#777" }}>
                {mount.result.elapsedMs.toFixed(0)} ms ·{" "}
                {mount.result.points.filter((p) => p.verdict === "fits").length} of{" "}
                {mount.result.points.length} swept magnifications fit the standard
              </span>
            </div>
          </>
        )}
      </div>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 4 }}>
        <strong>The barrel is what makes a turret work, and it is not a constant.</strong> Every
        objective must put its specimen the same distance below the shoulder whatever its
        magnification, and the optics are already solved — so the mount absorbs the difference: a
        10× still stands well back from its specimen and needs a short barrel, a 40× is nearly
        against it and needs almost the whole standard as mount. Below the floor the standard is
        unreachable <em>by construction</em>, which is why a real 4× DIN objective cannot be one
        doublet: a mechanical standard reaching back into an optical design and demanding a front
        group closer than a single group can be.
      </p>
      <p style={{ maxWidth: 880, fontSize: 13, color: "#666", marginTop: 8 }}>
        <strong>
          The ceiling is not the constant the ladder quoted — it is a function of the aperture the
          ladder defaulted.
        </strong>{" "}
        § 5u pins 4.236 and that is the NA 0.10 answer; walk the slider and it runs 4.173 at NA 0.05,
        4.236 at 0.10, 4.506 at 0.20, because a faster objective is a thicker one and the thickness
        is what the standard runs out of room for. Above about NA 0.22 the mount stops being the
        binding wall at all and{" "}
        <span style={{ color: GUARD_COLOR.warn }}>§ 6b.5&rsquo;s aperture refusal</span> takes over,
        which is a wall of an entirely different kind sitting on the same axis — and telling them
        apart is not optional: a search that catches both as one exception reports a mount ceiling of
        12.6× at NA 0.25, where the truth is that no doublet exists there to mount. The thin-lens
        floor moves too, with the standard rather than with the glass: 5.122 at a 35 mm parfocal,
        4.139 at DIN&rsquo;s 45, 2.273 at 95, and the real floor tracks it at a near-constant
        1.022–1.029×.
      </p>
    </>
  );
}
