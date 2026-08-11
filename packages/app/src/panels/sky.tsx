import { useEffect, useMemo, useRef, useState } from "react";
import { useFramesFromWorker, useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import { Choice, Fact, Guard, Slider, num, thresholdLevel } from "../ui";
import { refusalVoice } from "../refusal";
import { createSkyWallWorker, createSkyWorker } from "../workers";
import {
  OPTIC_LABELS,
  PATCH_COUNTS,
  RESOLVED_AIRY_RADII,
  SKY_OPTICS,
  WALL_SWEEP_CEILING_DEG,
  cornerFieldOf,
  wallExponents,
  type SkyOptic,
  type SkyRequest,
  type SkyResult,
  type Refusal,
  type WallPoint,
  type WallRequest,
} from "../sky";

/**
 * The sky — APP.md's C7, and the last surface roadmap step 5 was waiting on.
 *
 * Every telescope panel before this one images a **star**, because until § 5v
 * the engine could only place a flux at a point. A planet is not a point: it is
 * a radiance over solid angle, and it has a limb. This panel is the first thing
 * in the app to draw one.
 *
 * ## What is deliberately not here
 *
 * No Moon, no Jupiter, no named body. The angular sizes of real objects and a
 * real limb-darkening coefficient are **measured data**, which ROADMAP files
 * beside the patent eyepiece prescriptions: sourced and cited, or not used. So
 * the disc is synthetic and both its size and its darkening are the reader's,
 * and the panel says so on screen rather than in this comment only.
 *
 * ## The pair
 *
 * The picture is the disc. The two plots are the radial profile against the law
 * it was authored with — which is where the optics shows up, since the measured
 * limb is softened by the PSF and the law's is a hard edge — and the framing
 * wall against focal ratio, which is where the Newtonian's diagonal shows up.
 * The cos³ falloff is a `Fact` and not a plot, for the reason printed beside it.
 */

const FOCAL_RATIOS = [4, 5, 6, 8, 10, 12, 15] as const;

const DEFAULTS: SkyRequest = {
  optic: "newtonian",
  apertureMm: 200,
  focalRatio: 8,
  focusOffsetOverD: 0.75,
  frameWidthDeg: 0.12,
  discDiameterDeg: 0.08,
  limbDarkening: 0.6,
  sourceTemperatureK: 5800,
  wavelengths: 5,
  pupilSamples: 32,
  patches: 2,
  whiteOverMean: 2.2,
};

/** Measured, and printed on the control rather than hidden behind it. */
const PATCH_COST: Record<number, string> = {
  1: "1 PSF/λ — 76 ms mirror, 0.7 s doublet",
  2: "25 PSFs — 441 ms mirror, 3.6 s doublet",
  3: "70 PSFs — 1.1 s mirror, 10 s doublet",
};

function SkyCanvas({ result }: { result: SkyResult }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = result.size;
    element.height = result.size;
    const context = element.getContext("2d");
    if (!context) return;
    // Copied into a fresh array: `ImageData` needs a plain ArrayBuffer backing
    // and the engine's typed arrays are declared over ArrayBufferLike so they
    // can cross the worker boundary this result just came through.
    context.putImageData(
      new ImageData(new Uint8ClampedArray(result.rgba), result.size, result.size),
      0,
      0,
    );
  }, [result]);
  return (
    <canvas
      ref={canvas}
      style={{ width: 380, height: 380, imageRendering: "pixelated", background: "#000" }}
    />
  );
}

export function SkyPanel() {
  const [optic, setOptic] = useState<SkyOptic>(DEFAULTS.optic);
  const [apertureMm, setAperture] = useState(DEFAULTS.apertureMm);
  const [focalRatio, setFocalRatio] = useState(DEFAULTS.focalRatio);
  const [focusOffsetOverD, setFocusOffset] = useState(DEFAULTS.focusOffsetOverD);
  const [frameWidthDeg, setFrame] = useState(DEFAULTS.frameWidthDeg);
  const [discDiameterDeg, setDisc] = useState(DEFAULTS.discDiameterDeg);
  const [limbDarkening, setLimb] = useState(DEFAULTS.limbDarkening);
  const [patches, setPatches] = useState(DEFAULTS.patches);
  const [whiteOverMean, setWhite] = useState(DEFAULTS.whiteOverMean);

  const request = useMemo<SkyRequest>(
    () => ({
      ...DEFAULTS,
      optic,
      apertureMm,
      focalRatio,
      focusOffsetOverD,
      frameWidthDeg,
      discDiameterDeg,
      limbDarkening,
      patches,
      whiteOverMean,
    }),
    [
      optic,
      apertureMm,
      focalRatio,
      focusOffsetOverD,
      frameWidthDeg,
      discDiameterDeg,
      limbDarkening,
      patches,
      whiteOverMean,
    ],
  );

  const wallRequest = useMemo<WallRequest>(
    () => ({ optic, apertureMm, focusOffsetOverD, focalRatios: [...FOCAL_RATIOS] }),
    [optic, apertureMm, focusOffsetOverD],
  );

  const { result, refining } = useFramesFromWorker<SkyRequest, SkyResult | Refusal>(
    createSkyWorker,
    request,
  );
  const wall = useLatestFromWorker<WallRequest, readonly WallPoint[]>(
    createSkyWallWorker,
    wallRequest,
  );

  // `ok` is the discriminant and both arms carry it — a structural `"ok" in
  // result` is true for a refusal too, which typechecks and then reads fields
  // that are not there.
  const rendered = result !== null && result.ok ? result : null;
  const refusal = result !== null && !result.ok ? result : null;

  const walls = wall.result ?? [];
  const drawn = walls.filter((p): p is WallPoint & { wallDeg: number } => p.wallDeg !== null);
  const exponents = wallExponents(walls);
  const wallMax = drawn.length > 0 ? Math.max(...drawn.map((p) => p.wallDeg)) : 1;
  // Geometry, not the trace: this is what greys the frame slider before a render
  // is asked for. The rendered result reports its own corner off the traced map,
  // and the two are printed side by side so a disagreement would be visible.
  const corner = cornerFieldOf(frameWidthDeg);
  const liveWall = drawn.find((p) => p.focalRatio === focalRatio)?.wallDeg ?? null;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>A disc, not a point</h1>
      <p style={{ maxWidth: 680, color: "#444" }}>
        Every other telescope surface in this app images a <strong>star</strong>, because a star has
        no angular size and its whole light lands at one image point. This one images a{" "}
        <strong>disc</strong>: light per unit solid angle of sky, turned into flux per pixel by
        differentiating the same chief-ray map the engine already traces. Nothing downstream knows
        the difference — the scene drops into the same field renderer the star panels use.
      </p>
      <p style={{ maxWidth: 680, color: "#a60", fontSize: 13 }}>
        The disc is <strong>synthetic</strong>. No real body&rsquo;s angular size is claimed here and
        no published limb-darkening coefficient is transcribed: those are measured data this repo
        has not sourced, and the rule that keeps patent prescriptions out of the glass catalogue
        keeps them out of here. The limb-darkening <em>law</em> is textbook; the coefficient below
        is yours.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 8 }}>
        <Choice
          label="optic"
          options={SKY_OPTICS}
          value={optic}
          onChange={setOptic}
          format={(o) => OPTIC_LABELS[o]}
        />
        <Choice
          label={`field patches — ${PATCH_COST[patches] ?? ""}`}
          options={PATCH_COUNTS}
          value={patches}
          onChange={setPatches}
          format={(p) => `${p}×${p}`}
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20 }}>
        <Slider
          label={`aperture ${apertureMm} mm`}
          min={60}
          max={400}
          step={20}
          value={apertureMm}
          onChange={setAperture}
        />
        <Slider
          label={`f/${focalRatio}`}
          min={4}
          max={15}
          step={1}
          value={focalRatio}
          onChange={setFocalRatio}
        />
        <Slider
          label={`frame ${frameWidthDeg.toFixed(3)}° wide`}
          min={0.01}
          max={1.2}
          step={0.01}
          value={frameWidthDeg}
          onChange={setFrame}
        />
        <Slider
          label={`disc ${(discDiameterDeg * 60).toFixed(2)}′ across`}
          min={0.001}
          max={1.1}
          step={0.001}
          value={discDiameterDeg}
          onChange={setDisc}
        />
        <Slider
          label={`limb darkening u = ${limbDarkening.toFixed(2)}`}
          min={0}
          max={1}
          step={0.05}
          value={limbDarkening}
          onChange={setLimb}
        />
        <Slider
          label={
            optic === "newtonian"
              ? `focuser height ${(focusOffsetOverD * apertureMm).toFixed(0)} mm`
              : "focuser height (refractor: no diagonal)"
          }
          min={0.35}
          max={1.5}
          step={0.05}
          value={focusOffsetOverD}
          onChange={setFocusOffset}
        />
        <Slider
          label={`white at ${whiteOverMean.toFixed(1)}× the frame mean`}
          min={1.1}
          max={6}
          step={0.1}
          value={whiteOverMean}
          onChange={setWhite}
        />
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <figure style={{ margin: 0, opacity: refining ? 0.55 : 1, transition: "opacity 120ms" }}>
          {rendered ? (
            <SkyCanvas result={rendered} />
          ) : (
            <div
              style={{
                width: 380,
                height: 380,
                background: refusal ? "#faf6f6" : "#000",
                border: refusal ? "1px solid #c00" : "none",
              }}
            />
          )}
          <figcaption style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
            {refusal ? (
              <span style={{ color: "#c00" }}>
                <strong>{refusalVoice(refusal.source, "this frame")}</strong> ({refusal.stage})
                <br />
                {refusal.error}
              </span>
            ) : rendered ? (
              <>
                {OPTIC_LABELS[optic]} · f/{rendered.fNumber} · {rendered.focalLengthMm.toFixed(0)} mm
                <br />
                disc {rendered.discDiameterArcsec.toFixed(1)}″ ={" "}
                {rendered.discDiameterPx.toFixed(1)} px
                <br />
                {refining ? (
                  <span style={{ color: "#a60" }}>
                    refining {rendered.patches}×{rendered.patches} → {rendered.finestPatches}×
                    {rendered.finestPatches}…
                  </span>
                ) : (
                  <>
                    {rendered.psfEvaluations} PSFs · {rendered.elapsedMs.toFixed(0)} ms ·{" "}
                    {rendered.chiefRays} chief rays
                  </>
                )}
              </>
            ) : (
              <span>tracing…</span>
            )}
          </figcaption>
        </figure>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 320 }}>
          <Guard
            label="frame corner vs the field this system passes:"
            value={
              liveWall === null
                ? `${corner.toFixed(3)}° of no wall below ${WALL_SWEEP_CEILING_DEG}°`
                : `${corner.toFixed(3)}° of ${liveWall.toFixed(3)}°`
            }
            level={liveWall === null ? "ok" : thresholdLevel(corner, liveWall)}
            detail={
              optic === "newtonian"
                ? "past it the chief ray stops clearing the diagonal and the rasterizer refuses. It is the FRAME's corner, so shrinking the disc inside the frame does not help."
                : "the refractor has no diagonal; nothing inside this panel's sweep walls it."
            }
          />
          {rendered && (
            <>
              <Guard
                label="is it a disc at all:"
                value={
                  rendered.resolved
                    ? `${rendered.discDiameterAiryRadii.toFixed(1)} Airy radii across`
                    : `${rendered.discDiameterAiryRadii.toFixed(2)} Airy radii — a star`
                }
                level={rendered.resolved ? "ok" : "warn"}
                detail={`one Airy radius is ${rendered.airyRadiusArcsec.toFixed(2)}″ here, and the threshold is ${RESOLVED_AIRY_RADII} of them — the width the image of a POINT already has, so anything narrower is reported as a star. Shrink the disc past it and the picture becomes the star it is turning into: that limit is § 5v.7, and it is the whole difference between this rasterizer and the point-source one.`}
              />
              <Fact
                label="falloff at the corner, measured"
                value={`${rendered.falloffMeasured.toFixed(6)}`}
                note={`cos³ of ${rendered.cornerFieldDeg.toFixed(3)}° is ${rendered.falloffCos3.toFixed(6)}. Not plotted: at telescope fields it is a flat line at 1.000000, and a plot of that is a misleading y-axis.`}
              />
              <Fact
                label="the fourth cosine is missing on purpose"
                value="cos³, not cos⁴"
                note="the textbook falloff's fourth cosine is the pupil's projected area, and the engine's pupil is a normalized grid whose area does not vary with field. § 5v.1 measured that before writing the module and named it a pupil-layer deferral, so both rasterizers are missing it identically and it cancels between them."
              />
              <Fact
                label="the map's error estimate"
                value={`${num(rendered.mapErrorEstimateMm, 3)} mm`}
                note="the radius table's, NOT the Jacobian's — a derivative loses an order, so this falls ×16 where the quantity the picture depends on falls ×8 (§ 5v.4). It is an estimate and not a bound."
              />
              <Fact label="scene flux" value={num(rendered.sceneFlux, 4)} />
            </>
          )}
        </div>
      </div>

      <h2 style={{ fontSize: 17, marginTop: 36 }}>The limb, measured against the law it was given</h2>
      <p style={{ maxWidth: 680, color: "#444", fontSize: 14 }}>
        The dashed line is the function handed to the rasterizer — <code>1 − u(1 − √(1 − s²))</code>,
        with a hard edge at the limb. The solid line is what came back out of the telescope. They
        part in exactly one place and for exactly one reason: the optics has a point-spread function,
        so the limb is softened over roughly an Airy radius and light appears outside{" "}
        <code>s = 1</code> where the source has none. Set <em>u</em> to zero and the law is flat —
        the engine treats that as the uniform disc bitwise, not as a special case.
      </p>
      {rendered && (
        <Plot
          series={[
            {
              label: "measured",
              color: "#06a",
              points: rendered.profile.map((p) => [p.s, p.measured] as const),
              dots: true,
            },
            {
              label: "the authored law",
              color: "#c00",
              dash: [4, 3],
              points: rendered.profile.map((p) => [p.s, p.law] as const),
            },
          ]}
          markers={[{ x: 1, color: "#999", label: "the limb" }]}
          xLabel="radius / disc radius"
          yLabel="brightness, centre = 1"
          xMin={0}
          xMax={Math.max(1.2, rendered.profile[rendered.profile.length - 1]?.s ?? 1.2)}
          yMin={0}
          yMax={1.15}
          width={520}
        />
      )}

      <h2 style={{ fontSize: 17, marginTop: 36 }}>How much sky fits, and what decides it</h2>
      <p style={{ maxWidth: 680, color: "#444", fontSize: 14 }}>
        A Newtonian&rsquo;s frame does not run out of light gradually — it stops. Past a certain
        field the chief ray misses the diagonal, and since that ray defines both the image point and
        the reference sphere, the rasterizer refuses rather than degrading. The wall below is{" "}
        <strong>measured</strong> by bisecting the same map construction the render runs, at every
        focal ratio, and it falls as roughly 1/F²
        {exponents.length > 0 && (
          <>
            {" "}
            — local exponent {exponents[0]!.toFixed(2)} at the fast end falling to{" "}
            {exponents[exponents.length - 1]!.toFixed(2)} at the slow one, which is § 2f&rsquo;s own
            2.34 → 2.11 arriving through a different routine
          </>
        )}
        . Aperture cancels: the same curve serves a 60 mm and a 400 mm.
      </p>
      <p style={{ maxWidth: 680, color: "#444", fontSize: 14 }}>
        Then move the <strong>focuser height</strong>. It is a mechanical number — tube radius plus
        focuser plus eyepiece back focus — and <code>newtonian</code> says in its own header that it
        moves no optical surface. It sizes the diagonal, and the diagonal is what the frame runs
        into, so <em>how much sky a Newtonian can frame is set by how tall its focuser is</em> while
        nothing about its imaging changes. The refractor has no such curve at all.
      </p>
      {drawn.length > 0 && (
        <Plot
          series={[
            {
              label: `${OPTIC_LABELS[optic]} — measured`,
              color: "#06a",
              points: drawn.map((p) => [p.focalRatio, p.wallDeg] as const),
              dots: true,
            },
          ]}
          markers={[
            { x: focalRatio, color: "#999", label: "you are here" },
            { y: corner, color: "#c00", label: "this frame's corner" },
          ]}
          xLabel="focal ratio"
          yLabel="largest field the chief ray reaches (°)"
          xMin={FOCAL_RATIOS[0]!}
          xMax={FOCAL_RATIOS[FOCAL_RATIOS.length - 1]!}
          yMin={0}
          yMax={Math.max(wallMax * 1.1, corner * 1.2)}
          width={520}
        />
      )}
      {wall.result !== null && drawn.length === 0 && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#3a7" }}>
          no wall below {WALL_SWEEP_CEILING_DEG}° at any focal ratio swept — which is an absence
          inside this range, not the absence of a wall.
        </p>
      )}
    </>
  );
}
