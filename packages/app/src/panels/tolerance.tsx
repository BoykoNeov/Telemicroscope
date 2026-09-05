import { useEffect, useMemo, useRef, useState } from "react";
import type { PerturbTarget } from "@telemicroscope/core/analysis";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import {
  MARECHAL_WAVES,
  TARGET_UNIT,
  scaleSignature,
  type Row,
  type RowScale,
  type ScaleRequest,
  type ScaleResult,
  type ToleranceRequest,
  type ToleranceResult,
} from "../tolerance";
import { Choice, Guard, GUARD_COLOR, thresholdLevel } from "../ui";
import { createToleranceScaleWorker, createToleranceWorker } from "../workers";
import type { LensKind } from "../render";

/**
 * A slider per tolerance, and the two numbers that disagree — APP.md's Part B,
 * ROADMAP step 5's named leftover.
 *
 * The picture degrading is the easy half and it is not what the panel is for.
 * `toleranceBudget` returns two σ computed *differently* — `rssWaves`, √(Σσᵢ²),
 * which assumes the perturbations' wavefronts are orthogonal, and
 * `combinedWaves`, everything applied at once and traced ONCE — and the surface
 * exists so a reader can move sliders until they part company.
 *
 * **They part company in the direction this doc did not predict.** APP.md scoped
 * the moment as `combinedWaves` running above `rssWaves` when the modes
 * correlate, and the `correlated` preset below does exactly that: two identical
 * decenters add LINEARLY, so combined ÷ rss reads √2. But the larger departure
 * is the other way. The `cancelling` preset puts a conic error on the front
 * surface and a curvature error on the rear one — different parameters, different
 * surfaces, every instinct says independent — each spending half the Maréchal
 * budget, and the pair spends **none**: the RSS reads 0.050 waves and the honest
 * trace reads 2e-4. Both make spherical aberration, of opposite sign. So the
 * claim the panel can make is not "RSS under-reports" but **"RSS is not a bound
 * in either direction"**, and that is why every slider goes negative.
 *
 * ## Three things on screen that a σ cannot say
 *
 *  - **A σ has no sign and an image does.** § 5t is careful that every external
 *    rung sits on a *perfect* nominal, "the one place the currency's design
 *    subtlety cannot bite". This nominal is a real doublet with its own
 *    spherical residual, so a delta wavefront parallel to that residual costs
 *    differently in the two directions while |σ| is the same to three digits:
 *    measured on the achromat at f/5, a conic error of ±0.0675 reads σ = 0.0716
 *    both ways and a Strehl ratio of **0.675 against 0.979**. Flip the curvature
 *    slider negative far enough and the perturbed star is *better* than the
 *    nominal (1.040). The panel shows the measured Strehl beside Maréchal's
 *    prediction and prints their ratio, because that gap IS the finding.
 *  - **The focus compensator is worth 1× to 357×, per row.** `focusGain` is
 *    `sigmaBeforeFocusWaves ÷ sigmaWaves`, and it separates the tolerances a
 *    focuser removes (curvature 127×, an inner airspace 357×) from the ones it
 *    cannot touch at all (tilt and decenter, 1.00) with a conic in between at
 *    3.86× — § 5t's compensator story as a column rather than a paragraph.
 *  - **Two rows are refusals, not zeros.** The last surface's thickness is
 *    *inert*: `withFocus` sets the image plane as an offset from the last vertex,
 *    so that airspace never reaches the image and σ is exactly 0 — including
 *    `sigmaBeforeFocusWaves`, which is what tells an inert row from a compensated
 *    one. And past the aperture wall the nominal itself loses rays, so every σ
 *    downstream is an RMS over a shrinking sub-pupil. Both are refused with the
 *    reason, never drawn as a short bar. A3's rule, twice.
 */

const TARGETS: readonly PerturbTarget[] = [
  "curvature",
  "conic",
  "thickness",
  "tiltX",
  "tiltY",
  "decenterX",
  "decenterY",
];

const TARGET_LABEL: Record<PerturbTarget, string> = {
  curvature: "curv",
  conic: "conic",
  thickness: "thick",
  tiltX: "tiltX",
  tiltY: "tiltY",
  decenterX: "decX",
  decenterY: "decY",
};

/** Four rows: enough for a pair plus two zeroed spectators. */
const DEFAULT_ROWS: readonly Row[] = [
  { surface: 0, target: "curvature", fraction: 0 },
  { surface: 0, target: "conic", fraction: 0.5 },
  { surface: 1, target: "decenterX", fraction: 0 },
  { surface: 0, target: "tiltY", fraction: 0.5 },
];

/**
 * The three arrangements worth reaching in one click, and the middle one is
 * § 5t's own negative control.
 *
 * `lastSurface` is passed in because the singlet has two surfaces and the
 * achromat three, and a preset naming surface 2 on a singlet would silently
 * become a preset naming nothing.
 */
function presets(lastSurface: number): Record<string, readonly Row[]> {
  return {
    independent: [
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0.5 },
      { surface: 0, target: "curvature", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ],
    correlated: [
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 0, target: "conic", fraction: 0 },
      { surface: 0, target: "tiltY", fraction: 0 },
    ],
    orthogonal: [
      { surface: 1, target: "decenterX", fraction: 0.4 },
      { surface: 1, target: "decenterY", fraction: 0.4 },
      { surface: 0, target: "conic", fraction: 0 },
      { surface: 0, target: "tiltY", fraction: 0 },
    ],
    // Named for the MECHANISM and not for the result: how far the two cancel is
    // a property of the lens, measured 189× at f = 100 / EPD 20, 214× at
    // f = 50 / EPD 14, 78× on the singlet and only 8× at f = 100 / EPD 10. A
    // button called `cancelling` that reads 1.02 would be the mislabel this repo
    // keeps correcting; `independenceRatio` beside it says what happened.
    "both spherical": [
      { surface: 0, target: "conic", fraction: 0.5 },
      { surface: lastSurface, target: "curvature", fraction: 0.5 },
      { surface: 0, target: "tiltY", fraction: 0 },
      { surface: 1, target: "decenterX", fraction: 0 },
    ],
    clear: DEFAULT_ROWS.map((r) => ({ ...r, fraction: 0 })),
  };
}

const WHITE_DIVISORS = [1, 4, 16] as const;
const SWEEP_POINTS = 9;

/**
 * Focal length and aperture are buttons, not sliders, and that is a cost
 * decision rather than a taste one.
 *
 * Both re-derive every row's scaling — four linear coefficients, the bisections
 * the nonlinear ones need, and the aperture wall — which measures 0.6–2 s. A
 * slider would put that under every frame of a drag, and the backpressure hook
 * would answer by dropping intermediate values, so the reader would get the
 * jerk without the exploration. The continuous axes on this panel are the
 * tolerances, which is what it is about; these two say which lens.
 *
 * 25 and 30 mm are past the achromat's own wall at f = 100 and they are offered
 * anyway: walking into it is one of the things the panel has to show.
 */
const FOCAL_LENGTHS = [50, 100, 200] as const;
const APERTURES = [10, 14, 20, 25, 30] as const;

/**
 * The no-scaling-yet fallback, hoisted so it keeps ONE identity.
 *
 * Written inline it is a fresh `[]` on every render, which changes the memoized
 * request's identity, which re-fires the worker hook's post effect, which
 * re-renders — a post-per-render spin that saturates the worker queue and locks
 * the tab. Found by driving the panel: the headless suite calls `runTolerance`
 * directly and has no render loop to spin.
 */
const NO_SCALES: readonly RowScale[] = [];
/** Where the FFT grid stops holding the star. `render.ts`'s own guard. */
const TRUNCATION_LIMIT = 1e-3;

function StarCanvas({ rgba, size }: { rgba: Uint8ClampedArray; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = size;
    element.height = size;
    const context = element.getContext("2d");
    if (!context) return;
    // A fresh buffer: `ImageData` takes ownership, and this one arrived by
    // structured clone and is repainted whenever the job answers.
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  }, [rgba, size]);
  return (
    <canvas
      ref={canvas}
      style={{ width: 260, height: 260, imageRendering: "pixelated", background: "#000" }}
    />
  );
}

const fmt = (v: number, digits = 4): string =>
  Math.abs(v) >= 1e-3 && Math.abs(v) < 1e5 ? v.toFixed(digits) : v.toExponential(3);

export function TolerancePanel() {
  const [lens, setLens] = useState<LensKind>("achromat");
  const [focalLengthMm, setFocalLengthMm] = useState(100);
  const [apertureMm, setApertureMm] = useState(20);
  const [rows, setRows] = useState<readonly Row[]>(DEFAULT_ROWS);
  const [refocus, setRefocus] = useState(true);
  const [whiteDivisor, setWhiteDivisor] = useState<number>(4);

  const surfaceCount = lens === "singlet" ? 2 : 3;
  const lastSurface = surfaceCount - 1;

  // Changing the lens can leave a row naming a surface that no longer exists.
  useEffect(() => {
    setRows((current) => {
      // `current` unchanged when nothing needs clamping, or this fires on mount,
      // changes `rows` identity, and pays the 1.7–3.4 s scaling a second time
      // before the first paint.
      if (current.every((r) => r.surface <= surfaceCount - 1)) return current;
      return current.map((r) =>
        r.surface > surfaceCount - 1 ? { ...r, surface: surfaceCount - 1 } : r,
      );
    });
  }, [surfaceCount]);

  const spec = useMemo(
    () => ({ lens, focalLengthMm, apertureMm }),
    [lens, focalLengthMm, apertureMm],
  );

  // Keyed on strictly less than the render is — see `tolerance.scale.worker.ts`.
  const scaleRequest = useMemo(
    (): ScaleRequest => ({
      spec,
      targets: rows.map((r) => ({ surface: r.surface, target: r.target })),
    }),
    [spec, rows],
  );
  const scaleJob = useLatestFromWorker<ScaleRequest, ScaleResult>(
    createToleranceScaleWorker,
    scaleRequest,
  );

  /**
   * The scaling answers a question, and it is only usable while that question is
   * still the one on screen.
   *
   * `useLatestFromWorker` keeps the last good reply, which is right for a
   * picture and wrong here: a scaling names (surface, target) pairs and an
   * aperture, so holding the previous one for the ~0.6–2 s the next takes would
   * print "±1 = 0.27 mm of decentre" under a row that already says *curvature*,
   * and the σ beside it would be a different lens's. So the reply carries the
   * question it answers and everything derived from a stale one is **withdrawn**
   * — A4's rule that a stale reading may be greyed only when nothing on screen
   * misdescribes it. The controls stay live throughout; only the measurements go.
   */
  const fresh: ScaleResult | null = useMemo(() => {
    const r = scaleJob.result;
    if (!r || r.apertureMm !== apertureMm || r.targets.length !== rows.length) return null;
    return r.targets.every((t, i) => t.surface === rows[i]!.surface && t.target === rows[i]!.target)
      ? r
      : null;
  }, [scaleJob.result, rows, apertureMm]);
  const scales: readonly RowScale[] = fresh?.scales ?? NO_SCALES;

  // Always a valid request: with no scaling yet, every row's delta is zero and
  // the job renders the nominal twice. That costs one cheap render rather than
  // a special case in the worker, and nothing it produces is shown while
  // `fresh` is null.
  const request = useMemo(
    (): ToleranceRequest => ({
      spec,
      rows,
      scales,
      refocus,
      whiteDivisor,
      sweepPoints: SWEEP_POINTS,
    }),
    [spec, rows, scales, refocus, whiteDivisor],
  );
  const job = useLatestFromWorker<ToleranceRequest, ToleranceResult>(
    createToleranceWorker,
    request,
  );
  // Withdrawn unless the reply ran on the scaling now on screen. A row change
  // fires a render against the previous scaling (or against none) before the
  // new scaling lands, and that render is a plausible table of zeros — which
  // reads as "these tolerances cost nothing" rather than as "not measured yet".
  const result =
    fresh && job.result?.scaleSignature === scaleSignature(scales) ? job.result : null;

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const wall = fresh?.apertureWallMm;
  const pastWall = wall !== undefined && apertureMm > wall;

  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6 }}>
      <p style={{ maxWidth: 760, color: "var(--ink-2)" }}>
        Every slider is a manufacturing error, scaled so that <strong>±1</strong> is the drift
        that spends the whole Maréchal budget (σ = λ/14) on its own — measured for this lens,
        not chosen. The two numbers below the bars are the point of the panel:{" "}
        <strong>rss</strong> is what a tolerance budget predicts if the errors are independent,{" "}
        <strong>combined</strong> is all of them applied at once and traced once. Try the
        presets.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Choice label="lens" options={["singlet", "achromat"] as const} value={lens} onChange={setLens} />
        <Choice
          label="focal length mm"
          options={FOCAL_LENGTHS}
          value={focalLengthMm}
          onChange={setFocalLengthMm}
        />
        <Choice
          label={`aperture mm — f/${(focalLengthMm / apertureMm).toFixed(2)}`}
          options={APERTURES}
          value={apertureMm}
          onChange={setApertureMm}
        />
        <Choice
          label="focus compensator"
          options={["on", "off"] as const}
          value={refocus ? "on" : "off"}
          onChange={(v) => setRefocus(v === "on")}
        />
        <Choice
          label="white = nominal peak ÷"
          options={WHITE_DIVISORS}
          value={whiteDivisor}
          onChange={setWhiteDivisor}
        />
      </div>

      {/* Buttons rather than a `Choice`: these are actions, not a value. A radio
          row would have to show which preset is selected, and the moment a
          slider moves none of them is. */}
      <div style={{ marginTop: 10 }}>
        preset
        <br />
        {Object.entries(presets(lastSurface)).map(([name, preset]) => (
          <button
            key={name}
            onClick={() => setRows(preset)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              marginRight: 4,
              padding: "2px 8px",
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* The aperture wall is measured, and it is mechanical rather than optical. */}
      {wall !== undefined && (
        <div style={{ marginTop: 8 }}>
          <Guard
            label="whole pupil up to EPD"
            value={`${wall.toFixed(2)} mm (f/${(focalLengthMm / wall).toFixed(2)})`}
            level={pastWall ? "bad" : thresholdLevel(apertureMm, wall)}
            detail={
              pastWall
                ? `at ${apertureMm} mm the NOMINAL loses ${fresh?.nominalLost ?? 0} of ` +
                  `${result?.gridPoints ?? 0} rays — every σ below is an RMS over a sub-pupil, ` +
                  `and it shrinks as the perturbation grows. Not a tolerance reading.`
                : `a fixed ${lens === "singlet" ? 5 : 3} mm centre thickness, so the two sags ` +
                  `meet at h = √(t·R) — a wall in √f, not in f/#: EPD ` +
                  (lens === "singlet" ? "31.8 / 45.2 / 64.1" : "16.1 / 23.0 / 32.6") +
                  ` at f = 50 / 100 / 200` +
                  (lens === "singlet"
                    ? ". Past every aperture offered here, so the singlet never reaches its own wall"
                    : "")
            }
          />
        </div>
      )}

      <table style={{ marginTop: 14, borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--ink-3)" }}>
            <th style={{ paddingRight: 10 }}>surface</th>
            <th style={{ paddingRight: 10 }}>parameter</th>
            <th style={{ paddingRight: 10 }}>drift</th>
            <th style={{ paddingRight: 10 }}>value</th>
            <th style={{ paddingRight: 10 }}>
              {(result?.refocus ?? refocus)
                ? "σ waves — projected / real focuser"
                : "σ waves — before the focuser / projected"}
            </th>
            <th style={{ paddingRight: 10 }}>focuser buys</th>
            <th style={{ paddingRight: 10 }}>boresight</th>
            <th>share of variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const scale = scales[i];
            const readout = result?.rows[i];
            const unit = TARGET_UNIT[row.target];
            return (
              <tr key={i} style={{ borderTop: "1px solid var(--line-2)" }}>
                <td style={{ paddingRight: 10, whiteSpace: "nowrap" }}>
                  <Choice
                    label=""
                    options={Array.from({ length: surfaceCount }, (_, s) => s)}
                    value={Math.min(row.surface, lastSurface)}
                    onChange={(surface) => setRow(i, { surface })}
                  />
                </td>
                <td style={{ paddingRight: 10, whiteSpace: "nowrap" }}>
                  <Choice
                    label=""
                    options={TARGETS}
                    value={row.target}
                    onChange={(target) => setRow(i, { target })}
                    format={(t) => TARGET_LABEL[t]}
                  />
                </td>
                <td style={{ paddingRight: 10, whiteSpace: "nowrap" }}>
                  <input
                    type="range"
                    min={-2}
                    max={2}
                    step={0.02}
                    value={row.fraction}
                    disabled={scale?.inert !== undefined}
                    onChange={(e) => setRow(i, { fraction: Number(e.target.value) })}
                  />
                  <br />
                  {row.fraction.toFixed(2)} × budget
                </td>
                <td style={{ paddingRight: 10, whiteSpace: "nowrap" }}>
                  {scale?.inert ? (
                    <span style={{ color: GUARD_COLOR.bad }}>refused</span>
                  ) : readout ? (
                    <>
                      {fmt(readout.delta, 5)} {unit}
                      {readout.radiusChangeMm !== undefined && (
                        <>
                          <br />
                          <span style={{ color: "var(--ink-4)" }}>
                            R {readout.radiusMm!.toFixed(2)} → {(readout.radiusMm! + readout.radiusChangeMm).toFixed(2)} mm
                          </span>
                        </>
                      )}
                      {row.target === "curvature" && readout.radiusChangeMm === undefined && (
                        <>
                          <br />
                          <span style={{ color: "var(--ink-4)" }}>flat surface — no radius to quote</span>
                        </>
                      )}
                    </>
                  ) : (
                    "…"
                  )}
                </td>
                <td style={{ paddingRight: 10, whiteSpace: "nowrap" }}>
                  {scale?.inert ? (
                    "—"
                  ) : readout ? (
                    // The compensator control decides which σ describes the
                    // picture, so it decides which σ is the primary reading. Off,
                    // that is the un-compensated one — printing the projected
                    // currency large beside an un-refocused star would label the
                    // image with a number that has the defocus removed from it.
                    <>
                      {fmt(result!.refocus ? readout.sigmaWaves : readout.sigmaBeforeFocusWaves, 5)}
                      <br />
                      <span style={{ color: "var(--ink-4)" }}>
                        {fmt(result!.refocus ? readout.physicalRefocusWaves : readout.sigmaWaves, 5)}
                      </span>
                    </>
                  ) : (
                    "…"
                  )}
                </td>
                <td style={{ paddingRight: 10 }}>
                  {scale?.inert || !readout || readout.sigmaWaves === 0
                    ? "—"
                    : `${readout.focusGain.toFixed(2)}×`}
                </td>
                <td style={{ paddingRight: 10 }}>
                  {readout && readout.boresightRad > 0 ? `${(readout.boresightRad * 1e6).toFixed(1)} µrad` : "—"}
                </td>
                <td style={{ minWidth: 170 }}>
                  {readout && readout.varianceShare > 0 && (
                    <>
                      <span
                        style={{
                          display: "inline-block",
                          height: 9,
                          width: `${Math.round(readout.varianceShare * 140)}px`,
                          background: "var(--blue)",
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      />
                      {(readout.varianceShare * 100).toFixed(1)}%
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* The refusals and the scaling checks, per row, under the table they belong to. */}
      <div style={{ marginTop: 6, color: "var(--ink-4)", fontSize: 11 }}>
        {rows.map((row, i) => {
          const scale = scales[i];
          if (!scale) return null;
          const name = `s${row.surface} ${TARGET_LABEL[row.target]}`;
          if (scale.inert) {
            return (
              <div key={i} style={{ color: GUARD_COLOR.bad }}>
                {name}: {scale.inert}
              </div>
            );
          }
          if (!scale.reachable) {
            return (
              <div key={i} style={{ color: GUARD_COLOR.warn }}>
                {name}: the budget is out of reach — the pupil goes hollow at{" "}
                {fmt(scale.fullScaleDelta, 4)} {TARGET_UNIT[row.target]}, where σ is only{" "}
                {fmt(scale.sigmaAtFullScale, 4)} waves. ±1 is that wall, not λ/14.
              </div>
            );
          }
          const off = Math.abs(scale.nonlinearity - 1);
          return (
            <div key={i} style={{ color: off > 0.1 ? GUARD_COLOR.warn : "var(--ink-4)" }}>
              {name}: ±1 = {fmt(scale.fullScaleDelta, 5)} {TARGET_UNIT[row.target]}, σ there ={" "}
              {scale.sigmaAtFullScale.toFixed(5)} waves. Linear extrapolation from the coefficient{" "}
              would have said {fmt(MARECHAL_WAVES / scale.coefficientWavesPerUnit, 5)} —{" "}
              {off > 0.1
                ? `off by ${(1 / scale.nonlinearity).toFixed(1)}×, so δW is NOT linear here`
                : `bisected ÷ extrapolated = ${scale.nonlinearity.toFixed(4)}`}
              .
            </div>
          );
        })}
      </div>

      {result && (
        <>
          <div style={{ display: "flex", gap: 28, marginTop: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ opacity: job.pending ? 0.45 : 1 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div>
                  <StarCanvas rgba={result.rgbaNominal} size={result.size} />
                  <div>nominal — Strehl {result.strehlNominal.toFixed(5)}</div>
                </div>
                <div>
                  <StarCanvas rgba={result.rgbaPerturbed} size={result.size} />
                  <div>
                    perturbed — Strehl {result.strehlPerturbed.toFixed(5)}
                    <br />
                    {result.refocus ? "at its own best focus" : "at the NOMINAL's focus plane"}
                  </div>
                </div>
              </div>
              <div style={{ color: "var(--ink-4)", marginTop: 4, maxWidth: 540 }}>
                One exposure for both frames, taken from the nominal (Y ={" "}
                {result.exposureReferenceY.toExponential(3)}, white = peak ÷ {whiteDivisor}).
                Exposing each on its own total would re-brighten the degradation into
                invisibility. Pixel {(result.pixelScaleMm * 1e3).toFixed(3)} µm.
              </div>
            </div>

            <div style={{ minWidth: 320 }}>
              <div style={{ fontSize: 13 }}>
                <div>
                  rss (independent modes) <strong>{result.rssWaves.toFixed(5)}</strong> waves
                </div>
                <div>
                  combined (one trace) <strong>{result.combinedWaves.toFixed(5)}</strong> waves
                </div>
                {/* With every slider at zero there are no modes to be orthogonal,
                    and rss = 0 makes the ratio fall back to 1 — printing "quadrature
                    holds" about nothing. A3's rule: refused, not defaulted. */}
                {result.rssWaves === 0 ? (
                  <div style={{ color: GUARD_COLOR.warn }}>
                    combined ÷ rss — refused: no row is perturbed, so there is nothing
                    for the budget to be a budget of
                  </div>
                ) : (
                <div
                  style={{
                    color:
                      Math.abs(result.independenceRatio - 1) > 0.05
                        ? GUARD_COLOR.warn
                        : GUARD_COLOR.ok,
                  }}
                >
                  combined ÷ rss = <strong>{result.independenceRatio.toFixed(4)}</strong>{" "}
                  {Math.abs(result.independenceRatio - 1) <= 0.05
                    ? "— quadrature holds: the modes are orthogonal"
                    : result.independenceRatio > 1
                      ? "— correlated, so they add more nearly linearly (√2 is perfect correlation)"
                      : "— they CANCEL, and the RSS budget is " +
                        `${(1 / Math.max(result.independenceRatio, 1e-12)).toFixed(0)}× pessimistic`}
                </div>
                )}
                {result.rssWaves > 0 && result.independenceRatio < 0.5 && (
                  <div style={{ color: "var(--ink-4)", marginTop: 4, maxWidth: 380 }}>
                    But the cancellation is in the <em>projected</em> currency, and a real
                    focuser does not get it. The projection removes ρ² by least squares on one
                    reference plane — which is what makes the RSS exact — while the instrument
                    removes it by moving the image plane, and here that is a 1.9 mm move
                    undoing 17 waves of defocus. The residual it leaves is in the grey σ beside
                    each row, and the picture is what it costs.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div>
                  Maréchal from the combined σ: <strong>{result.strehlMarechal.toFixed(5)}</strong>
                </div>
                <div>
                  measured Strehl ratio:{" "}
                  {result.strehlRatioMeaningful ? (
                    <>
                      <strong>{result.strehlRatio.toFixed(5)}</strong>{" "}
                      <span style={{ color: "var(--ink-4)" }}>(real PSF, perturbed ÷ nominal)</span>
                    </>
                  ) : (
                    <span style={{ color: GUARD_COLOR.bad }}>
                      refused — the NOMINAL is at Strehl {result.strehlNominal.toFixed(5)},
                      below the 0.8 diffraction limit, so this would be two small numbers
                      divided. On the singlet at f/4 it reads 1.179, the perturbed system
                      &ldquo;better&rdquo; than a nominal that is not forming an image.
                    </span>
                  )}
                </div>
                {/* Refused rather than printed when the compensator is off: the
                    two numbers then describe different systems, and a ratio
                    between them is arithmetic rather than a comparison. A3's
                    rule — a readout whose value is undefined is refused. */}
                {!result.strehlRatioMeaningful ? null : result.refocus ? (
                  <div
                    style={{
                      color:
                        Math.abs(result.strehlRatio / result.strehlMarechal - 1) > 0.1
                          ? GUARD_COLOR.warn
                          : "var(--ink-4)",
                    }}
                  >
                    measured ÷ predicted ={" "}
                    {(result.strehlRatio / Math.max(result.strehlMarechal, 1e-12)).toFixed(4)}
                  </div>
                ) : (
                  <div style={{ color: GUARD_COLOR.warn }}>
                    measured ÷ predicted — refused: the compensator is off, so these two
                    describe different systems
                  </div>
                )}
                {/* Both of these describe a ratio; neither is shown when the
                    ratio is refused, or the panel invites a reader to watch a
                    number that is not on the page. */}
                {!result.strehlRatioMeaningful ? (
                  <div style={{ color: "var(--ink-4)", marginTop: 4, maxWidth: 380 }}>
                    The budget above is still a wavefront and still means what it says — a
                    delta σ does not need the nominal to be any good. What is unavailable is
                    the *image* comparison, because this lens is not forming one: the
                    guards below read the frame as a ray histogram with 6.5% of its light
                    off the grid.
                  </div>
                ) : (
                <div style={{ color: "var(--ink-4)", marginTop: 4, maxWidth: 380 }}>
                  {result.refocus
                    ? "A σ has no sign and an image does. § 5t pins every external rung on a " +
                      "PERFECT nominal; this one is a real doublet with its own spherical " +
                      "residual, so a delta parallel to it costs differently in the two " +
                      "directions while |σ| does not move. Drag a conic or curvature slider " +
                      "through zero and watch this ratio swing."
                    : "The compensator is off, so this pair is the un-refocused image — the " +
                      "column σ_before_focus describes it, and the budget currency (which has " +
                      "the defocus projected out) does not. Maréchal above is still the " +
                      "compensated number and is quoted for contrast, not for agreement."}
                </div>
                )}
              </div>
            </div>

            <Plot
              series={[
                {
                  label: "rss — √(Σσᵢ²), the independent-modes estimate",
                  color: "var(--warn-strong)",
                  points: result.sweep.map((s) => [s.k, s.rssWaves] as const),
                  dash: [5, 4],
                },
                {
                  label: "combined — one trace",
                  color: "var(--blue)",
                  points: result.sweep.map((s) => [s.k, s.combinedWaves] as const),
                  dots: true,
                },
              ]}
              markers={[
                { x: 1, color: "var(--ink-5)", label: "sliders" },
                { y: MARECHAL_WAVES, color: "var(--warn)", label: "λ/14" },
              ]}
              xLabel="k — every slider scaled by this"
              yLabel="σ waves"
              xMin={0}
              xMax={2}
              yMin={0}
              yMax={Math.max(
                MARECHAL_WAVES * 1.3,
                ...result.sweep.map((s) => Math.max(s.rssWaves, s.combinedWaves)),
              )}
              width={400}
              height={260}
            />
          </div>

          <div style={{ display: "flex", gap: 26, marginTop: 14, flexWrap: "wrap" }}>
            <Guard
              label="light off the PSF grid, nominal / perturbed"
              value={`${result.truncatedFractionNominal.toExponential(2)} / ${result.truncatedFractionPerturbed.toExponential(2)}`}
              level={thresholdLevel(
                Math.max(result.truncatedFractionNominal, result.truncatedFractionPerturbed),
                TRUNCATION_LIMIT,
              )}
              detail={
                "off-grid light WRAPS rather than vanishing. Turning the compensator off puts " +
                "a curvature error's whole defocus into the frame, and this is where it says so."
              }
            />
            <Guard
              label="geometric share, nominal / perturbed"
              value={`${result.geometricWeightNominal.toFixed(3)} / ${result.geometricWeightPerturbed.toFixed(3)}`}
              level={result.geometricWeightPerturbed > 0.5 ? "warn" : "ok"}
              detail="1.000 means the picture is a ray histogram — no Airy rings in it to compare."
            />
            <Guard
              label="rays lost, nominal / perturbed"
              value={`${result.nominalLost} / ${result.perturbedLost} of ${result.gridPoints}`}
              level={result.perturbedLost > 0 ? "bad" : "ok"}
              detail={
                result.perturbedLost > 0
                  ? "σ is an RMS over the SURVIVING pupil, so it can fall as the perturbation " +
                    "grows. Not a tolerance reading — back the sliders off."
                  : "every σ above is over the whole pupil"
              }
            />
            <div style={{ color: "var(--ink-4)" }}>
              {result.elapsedMs.toFixed(0)} ms{job.pending ? " — recomputing" : ""}
              {fresh && ` · scaling ${fresh.elapsedMs.toFixed(0)} ms`}
              <br />
              nominal wavefront {fresh?.nominalRmsWaves.toFixed(5)} waves rms
            </div>
          </div>
        </>
      )}
      {!result && <p>{fresh ? "tracing…" : "rescaling — every row's full scale is measured for this lens"}</p>}
    </div>
  );
}
