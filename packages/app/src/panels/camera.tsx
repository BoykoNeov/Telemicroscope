import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import { Choice, Guard, Slider, thresholdLevel, type GuardLevel } from "../ui";
import { createCameraWorker } from "../workers";
import {
  APERTURE_RANGE,
  CAMERA_OPTICS,
  FOCUS_NM,
  MIN_SENSOR_COLS,
  OPTIC_LABELS,
  OPTIC_NOTES,
  PITCH_SLIDER_MAX_UM,
  buildCameraSystem,
  chromaticDeparturePoints,
  chromaticPitchSpread,
  criticalPitchAt,
  criticalPitchByWavelength,
  describeFormats,
  detectorMtfSweep,
  focalLengthOf,
  focusOffsetMm,
  mtfQuadratureRefinement,
  rulingRow,
  sineDeparture,
  type CameraOptic,
  type CameraRequest,
  type CameraResult,
  type CameraSpec,
} from "../camera";

/**
 * Camera mode — APP.md C4, and the last app-wiring gap in Part C.
 *
 * `core/imaging/camera` (§ 5r) and `core/imaging/exposure` (§ 5s) have existed
 * since roadmap step 5 with **no app presence at all**: no `Sensor` had ever been
 * instantiated. This is app wiring plus the one engine fix driving it forced
 * (see `camera.ts` and § 5r.1) — every physical number is § 5r's or § 5s's.
 *
 * ## The one panel in this app that does not auto-expose
 *
 * Every other picture here normalizes to its own total. This one cannot: the
 * rebin conserves energy, so auto-exposing would exactly cancel § 5r's headline
 * — that a pixel covering a 4×4 footprint reads 16× — and § 5s's whole axis is a
 * ratio. So the exposure is fixed, the light-grasp factor is applied explicitly
 * because it is measurably not in the image already, and the frame is allowed to
 * clip. A camera whose picture cannot blow out is not showing you exposure.
 *
 * ## Its shape: one picture, one table, two plots
 *
 * The picture is the expensive half and lives in a worker. Everything beside it
 * — the format table, the per-λ critical pitches, both MTF sweeps — runs no
 * transform and repaints on the slider's own tick. `reflector.tsx`'s asymmetry,
 * falling the same way.
 *
 * That half is **not** free, though, and this comment said it was until it was
 * measured: 50 ms in node, ~115 ms in a browser at A4's 2.3×, of which 21–28 ms
 * is one `buildCameraSystem` — because in this engine building a system is not
 * construction, it is a `bestFocus` solve. The memo keys below are what keep it
 * usable, and they are chosen by what each block genuinely varies with rather
 * than by what is in scope.
 */

const DEFAULT: CameraSpec = {
  optic: "achromat",
  apertureMm: APERTURE_RANGE.achromat.preset,
  focalRatio: 10,
  sourceTemperatureK: 5800,
  wavelengths: 5,
  pupilSamples: 64,
};

const PITCH_PRESETS = [1.5, 2.4, 3.76, 5.94, 9] as const;

function pct(value: number, digits = 3): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * The picture: the continuous optical image, and the same light rebinned.
 *
 * Both are drawn at the **same** exposure, which is the whole point — the sensor
 * frame is brighter because a bigger pixel collects more, not because it was
 * re-levelled. The native frame is scaled up to match the sensor frame's box so
 * the two are the same size on screen and only the sampling differs.
 */
function Pictures({ request }: { request: CameraRequest }) {
  const nativeRef = useRef<HTMLCanvasElement>(null);
  const sensorRef = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useLatestFromWorker<CameraRequest, CameraResult>(
    createCameraWorker,
    request,
  );

  useEffect(() => {
    if (!result) return;
    const paint = (
      element: HTMLCanvasElement | null,
      rgba: Uint8ClampedArray,
      size: number,
    ): void => {
      if (!element || size === 0) return;
      element.width = size;
      element.height = size;
      const context = element.getContext("2d");
      if (!context) return;
      // Copied into a fresh array: `ImageData` needs a plain ArrayBuffer backing
      // and the engine's arrays are declared over ArrayBufferLike so they can
      // cross the worker boundary this result just came through.
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
    };
    paint(nativeRef.current, result.nativeRgba, result.nativeSize);
    paint(sensorRef.current, result.sensorRgba, result.sensorCols);
  }, [result]);

  const box = 280;
  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms" }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <figure style={{ margin: 0 }}>
          <canvas
            ref={nativeRef}
            style={{ width: box, height: box, imageRendering: "pixelated", background: "#000" }}
          />
          <figcaption style={{ fontFamily: "monospace", fontSize: 11, color: "#666" }}>
            the optical image — {result?.nativeSize ?? "…"} px at{" "}
            {result ? (result.nativePixelScaleMm * 1000).toFixed(4) : "…"} µm
          </figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          {result?.refusal ? (
            <div
              style={{
                width: box,
                height: box,
                border: "1px solid #c00",
                color: "#c00",
                fontFamily: "monospace",
                fontSize: 12,
                padding: 12,
                boxSizing: "border-box",
                lineHeight: 1.6,
              }}
            >
              refused — {result.refusal}
            </div>
          ) : (
            <canvas
              ref={sensorRef}
              style={{ width: box, height: box, imageRendering: "pixelated", background: "#000" }}
            />
          )}
          <figcaption style={{ fontFamily: "monospace", fontSize: 11, color: "#666" }}>
            what the sensor records — {result?.sensorCols ?? "…"} px at{" "}
            {request.pitchUm.toFixed(2)} µm
          </figcaption>
        </figure>
      </div>
      {result && <FrameGuards result={result} />}
      {result && !result.refusal && <PictureReadouts result={result} />}
      {result && <ExposureReadouts result={result} />}
    </div>
  );
}

/**
 * § 3b's two guards, and on this panel they are not boilerplate.
 *
 * APP.md's trait 2 — *"an app that showed that silently would be lying with more
 * conviction than one that showed nothing"* — and both of these bite **inside
 * this panel's own slider ranges**, which is why they are here rather than
 * assumed away. At the fast end, singlet f/4 with a 20 mm aperture, the frame
 * loses **1.45%** of its light off the grid (where it *wraps* rather than
 * vanishing) and `geometricWeight` reaches **1.000000** — the fidelity switch
 * abandoning the transform entirely for a ray histogram.
 *
 * That second one is the dangerous one *for this surface specifically*, and it
 * is a coupling no other panel has: everything to the right of the picture — the
 * critical pitch, the sampling verdict, the whole λ/(4·NA) contest — is about a
 * **diffraction** limit, and a fully geometric frame is not showing one. The
 * numbers stay true of the system; the picture stops illustrating them. Saying
 * so is the difference between a panel and a plausible one.
 *
 * Thresholds are C1's, deliberately: `thresholdLevel(·, 0.01)` for truncation
 * and warn on any geometric weight at all. A reader who learned what red means
 * on the reflector panel should not have to relearn it here.
 */
function FrameGuards({ result }: { result: CameraResult }) {
  return (
    <div style={{ marginTop: 8, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <Guard
        label="light that left the grid:"
        value={`${(result.truncatedFraction * 100).toFixed(2)}%`}
        level={thresholdLevel(result.truncatedFraction, 0.01)}
        detail="off-grid light WRAPS rather than vanishing, so a red number here means the frame is vivid and wrong — not merely dim (§ 3b)"
      />
      <Guard
        label="geometric branch:"
        value={`${(result.geometricWeight * 100).toFixed(0)}%`}
        level={result.geometricWeight > 0 ? "warn" : "ok"}
        detail={
          result.geometricWeight > 0
            ? "the wavefront is too aberrated for the FFT here, so this frame is part ray histogram — and everything beside it is about a DIFFRACTION limit, which a geometric frame does not show"
            : "the frame is the diffraction branch throughout, which is what the critical-pitch table beside it assumes"
        }
      />
    </div>
  );
}

/**
 * What the rebin did, in numbers — because a factor is exactly what a picture
 * cannot show the size of (A10's rule, arriving on the telescope side).
 */
function PictureReadouts({ result }: { result: CameraResult }) {
  const fp2 = result.footprint * result.footprint;
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
      <div>
        footprint <strong>{result.footprint.toFixed(3)}</strong> native px · covers{" "}
        {pct(result.coveredFraction, 4)} of the frame · energy kept{" "}
        <strong>{result.energyRatio.toFixed(9)}</strong>
      </div>
      <div style={{ color: "#666" }}>
        the shortfall is `cols = floor(span/pitch)` dropping an edge sliver, not the rebin —
        which conserves by construction
      </div>
      <div>
        peak gain: flat field <strong>{result.flatFieldPeakRatio.toFixed(12)}</strong> × footprint²
        — exact — against this star&rsquo;s <strong>{result.starPeakRatio.toFixed(4)}</strong> of{" "}
        {fp2.toFixed(2)}
      </div>
      <div style={{ color: "#666" }}>
        a pixel integrating a peak collects less than one integrating a plateau, so the deficit is
        the PSF core and not the rebin. The flat field is the control that separates them.
      </div>
      <div style={{ color: result.axisOnPixelCentre ? "#666" : "#a60" }}>
        the axis lands {result.axisOnPixelCentre ? "on a pixel centre" : "on the seam between two pixels"} (
        {result.sensorCols} columns, {result.axisOnPixelCentre ? "even" : "odd"}) — sample-at-centre,
        so the peak gain swings ~3.7× on this parity as the pitch walks. It is not a smooth function
        of pitch. § 5r&rsquo;s centroid is blind to it; the flat field is immune.
      </div>
      {result.clippedFraction > 0 && (
        <div>
          clipped <strong>{pct(result.clippedFraction, 2)}</strong> of sensor pixels at this exposure
        </div>
      )}
    </div>
  );
}

/** § 5s, and which of its two laws is a pin. */
function ExposureReadouts({ result }: { result: CameraResult }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
      <div>
        display exposure <strong>{result.displayExposure.toExponential(4)}</strong> — fixed, and the
        same scalar on both frames
      </div>
      <div>
        light grasp π·r² = <strong>{result.lightGrasp.toFixed(3)}</strong> mm² ·{" "}
        <span style={{ color: "#666" }}>
          ∝ D², which § 5s labels a <em>consistency check, not a pin</em>: with a front stop the
          entrance pupil is the declared aperture and π·r² recovers D² by construction
        </span>
      </div>
      <div>
        extended-source illuminance π·sin²u′ ={" "}
        <strong>{result.extendedIlluminance.toExponential(6)}</strong> ·{" "}
        <span style={{ color: "#666" }}>
          § 5s&rsquo;s <em>pinned</em>, trace-emergent law — f/10 → f/5 measures 4.037 against the
          paraxial 4, the excess being the faster stop&rsquo;s sine-condition departure. Printed and
          not drawn: this picture is a point source, and the 1/F² law is about extended ones.
        </span>
      </div>
    </div>
  );
}

export function CameraPanel() {
  const [spec, setSpec] = useState<CameraSpec>(DEFAULT);
  const [pitchUm, setPitchUm] = useState(3.76);
  const [seconds, setSeconds] = useState(1);
  const [gain, setGain] = useState(1);

  const set = <K extends keyof CameraSpec>(key: K, value: CameraSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  const request = useMemo<CameraRequest>(
    () => ({ ...spec, pitchUm, seconds, gain }),
    [spec, pitchUm, seconds, gain],
  );

  // Everything below is chief rays and array arithmetic — no transform — so it
  // runs here rather than in the worker and repaints with the slider. It is not
  // free, though, and the split below is what keeps it usable: **building a
  // system is a `bestFocus` solve**, 21–28 ms, and the whole main-thread block
  // measured 50 ms in node (~115 ms in a browser, at A4's 2.3×). Almost all of
  // that was being spent for nothing on a pitch drag — the contest rebuilds
  // three systems and depends on the pitch through *no* quantity it draws — so
  // the system is memoized on the spec and the contest on the three fields it
  // genuinely varies with. A pitch tick is now the cheap half alone.
  const system = useMemo(() => buildCameraSystem(spec), [spec]);

  const geometry = useMemo(() => {
    const pitchMm = pitchUm / 1000;
    const rows = criticalPitchByWavelength(system, spec, pitchMm);
    let offsetMm: number | undefined;
    try {
      offsetMm = focusOffsetMm(system, FOCUS_NM);
    } catch {
      offsetMm = undefined;
    }
    return {
      rows,
      ruling: rulingRow(rows),
      spread: chromaticPitchSpread(rows),
      sine: sineDeparture(system, spec),
      formats: describeFormats(system, pitchMm, FOCUS_NM),
      offsetMm,
    };
  }, [system, spec, pitchUm]);

  // The contest: all three optics at the CURRENT focal ratio, each at its own
  // preset aperture, because the sampling question is about focal ratio and
  // dispersion rather than absolute size.
  //
  // Keyed on the three fields it actually varies with, NOT on `spec` and not on
  // the pitch: the departure curve is a property of the glass and the focal
  // ratio, so a pitch drag or an aperture drag must not pay for three
  // `bestFocus` solves it would not change.
  const { focalRatio, sourceTemperatureK, wavelengths } = spec;
  const contest = useMemo(
    () =>
      CAMERA_OPTICS.map((optic) => {
        const s: CameraSpec = {
          optic,
          apertureMm: APERTURE_RANGE[optic].preset,
          focalRatio,
          sourceTemperatureK,
          wavelengths,
          pupilSamples: 64,
        };
        // The pitch only reaches `rows[].regime`, which this block never draws.
        const rows = criticalPitchByWavelength(buildCameraSystem(s), s, 0);
        return {
          optic,
          rows,
          spread: chromaticPitchSpread(rows),
          departure: chromaticDeparturePoints(rows),
        };
      }),
    [focalRatio, sourceTemperatureK, wavelengths],
  );

  const mtf = useMemo(() => detectorMtfSweep(pitchUm / 1000), [pitchUm]);
  const refinement = useMemo(() => mtfQuadratureRefinement(pitchUm / 1000), [pitchUm]);

  const range = APERTURE_RANGE[spec.optic];
  const focalLengthMm = focalLengthOf(spec);
  const regimeLevel: GuardLevel =
    geometry.ruling.regime === "critical"
      ? "ok"
      : geometry.ruling.regime === "oversampled"
        ? "warn"
        : "bad";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Choice
          label="optic"
          options={CAMERA_OPTICS}
          value={spec.optic}
          onChange={(optic) =>
            setSpec((s) => ({ ...s, optic, apertureMm: APERTURE_RANGE[optic].preset }))
          }
          format={(o) => OPTIC_LABELS[o as CameraOptic]}
        />
        <Slider
          label={`aperture ${spec.apertureMm.toFixed(1)} mm (f = ${focalLengthMm.toFixed(0)} mm)`}
          min={range.min}
          max={range.max}
          step={range.step}
          value={spec.apertureMm}
          onChange={(v) => set("apertureMm", v)}
        />
        <Slider
          label={`focal ratio f/${spec.focalRatio.toFixed(1)}`}
          min={4}
          max={15}
          step={0.5}
          value={spec.focalRatio}
          onChange={(v) => set("focalRatio", v)}
        />
        {/* Max 30 µm, not 20: at `pupilSamples` 32 the frame is 174.2 µm, so a
            20 µm pitch records exactly 8 columns — `MIN_SENSOR_COLS` and not
            below it, which left the refusal branch unreachable from the
            controls. A guard the sliders cannot reach is the same honesty
            problem as one that never fires. 25 µm reaches it. */}
        <Slider
          label={`pixel pitch ${pitchUm.toFixed(2)} µm`}
          min={1}
          max={PITCH_SLIDER_MAX_UM}
          step={0.02}
          value={pitchUm}
          onChange={setPitchUm}
        />
        <Choice
          label="pitch presets (µm)"
          options={PITCH_PRESETS}
          value={PITCH_PRESETS.find((p) => Math.abs(p - pitchUm) < 1e-9) ?? PITCH_PRESETS[2]}
          onChange={setPitchUm}
        />
        <Slider
          label={`exposure ${seconds.toFixed(2)} s`}
          min={0.1}
          max={4}
          step={0.05}
          value={seconds}
          onChange={setSeconds}
        />
        <Slider
          label={`gain ×${gain.toFixed(1)}`}
          min={0.5}
          max={4}
          step={0.1}
          value={gain}
          onChange={setGain}
        />
        <Choice
          label="pupil samples"
          options={[32, 64, 128]}
          value={spec.pupilSamples}
          onChange={(v) => set("pupilSamples", v)}
        />
      </div>

      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 900, margin: 0 }}>
        {OPTIC_NOTES[spec.optic]}. Apertures are per optic and deliberately do not share a range —
        `refractorPair` is a toy lens whose halo must stay on an FFT grid, and a 6 mm Newtonian is
        not a thing. What makes the three comparable is that the sampling question turns on focal
        ratio and dispersion, not on size.
      </p>

      <section>
        <h3 style={{ fontFamily: "monospace", fontSize: 13, margin: "0 0 8px" }}>
          the sensor, and the light it actually records
        </h3>
        <Pictures request={request} />
      </section>

      <section>
        <h3 style={{ fontFamily: "monospace", fontSize: 13, margin: "0 0 8px" }}>
          one sensor, three verdicts — the critical pitch is per wavelength
        </h3>
        <Guard
          label={`sampling at ${geometry.ruling.nm.toFixed(0)} nm, the shortest plane in the stack:`}
          value={geometry.ruling.regime}
          level={regimeLevel}
          detail={`critical pitch there is ${(geometry.ruling.criticalPitchMm * 1000).toFixed(4)} µm against this sensor's ${pitchUm.toFixed(2)} µm. The verdict is ruled on the worst plane, not the middle one — § 6g.3's rule, since a frame is not honest in the places where it happens to be.`}
        />
        {/* The three-verdict state is the section's whole point, so it is a
            button rather than a sentence asking the reader to find it. */}
        <button
          onClick={() => {
            const target = criticalPitchAt(geometry.rows, 550);
            if (target !== undefined) setPitchUm(Number((target * 1000).toFixed(2)));
          }}
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            margin: "6px 0",
            padding: "3px 10px",
            border: "1px solid #333",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          snap the pitch to critical at 550 nm →{" "}
          {((criticalPitchAt(geometry.rows, 550) ?? 0) * 1000).toFixed(2)} µm
        </button>
        <table
          style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}
        >
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th style={{ padding: "4px 12px 4px 0" }}>λ (nm)</th>
              <th style={{ padding: "4px 12px 4px 0" }}>traced NA</th>
              <th style={{ padding: "4px 12px 4px 0" }}>λ/(4·NA) (µm)</th>
              <th style={{ padding: "4px 0" }}>this sensor</th>
            </tr>
          </thead>
          <tbody>
            {geometry.rows.map((row) => (
              <tr key={row.nm} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "4px 12px 4px 0" }}>{row.nm.toFixed(1)}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>{row.tracedNa.toFixed(7)}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>
                  {(row.criticalPitchMm * 1000).toFixed(4)}
                </td>
                <td
                  style={{
                    padding: "4px 0",
                    color:
                      row.regime === "critical"
                        ? "#3a7"
                        : row.regime === "oversampled"
                          ? "#a60"
                          : "#c00",
                  }}
                >
                  {row.regime}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 900 }}>
          `criticalPitchMm` ∝ λ, so the band is a {geometry.spread.lambdaRatio.toFixed(3)}× spread
          against `samplingRegime`&rsquo;s 2% tolerance: at the pitch that is exactly critical at
          550 nm the blue plane is undersampled and the red is oversampled, on one sensor. The NA is
          the <strong>traced</strong> marginal sine, not the paraxial 1/(2F) — those differ by{" "}
          {pct(geometry.sine.departure, 3)} here, growing with aperture as § 5s&rsquo;s
          sine-condition rung says it must, and inside the 2% tolerance so the verdict does not move
          even though the printed pitch does.
        </p>
      </section>

      <section>
        <h3 style={{ fontFamily: "monospace", fontSize: 13, margin: "0 0 8px" }}>
          …and how far the band spreads is the lens&rsquo;s chromatic correction
        </h3>
        <Plot
          series={contest.map((c, i) => ({
            label: `${OPTIC_LABELS[c.optic]} — ${(c.spread.departure * 100).toFixed(3)}% at the red end`,
            color: ["#c33", "#36c", "#3a7"][i]!,
            points: c.departure.map((d) => [d.nm, d.departure * 100] as const),
            dots: true,
          }))}
          markers={[{ y: 0, color: "#999", label: "λ/(4·NA) with λ alone moving" }]}
          xLabel="wavelength (nm)"
          yLabel="departure from proportional-in-λ (%)"
          xMin={Math.min(...geometry.rows.map((r) => r.nm)) - 20}
          xMax={Math.max(...geometry.rows.map((r) => r.nm)) + 20}
          yMin={Math.min(-0.3, ...contest.flatMap((c) => c.departure.map((d) => d.departure * 100))) * 1.2}
          yMax={Math.max(0.3, ...contest.flatMap((c) => c.departure.map((d) => d.departure * 100))) * 1.2}
          width={460}
        />
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 900, margin: "2px 0 0" }}>
          Plotted as the <em>departure</em> rather than as the pitch itself: the three raw curves
          differ by under 3% over the band and land on top of each other, so the picture would say
          only that λ/(4·NA) is linear in λ while the table beside it carried the whole finding.
          Zero at the blue end is the normalization, not a measurement — the shape after it is the
          lens.
        </p>
        <table
          style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse", marginTop: 4 }}
        >
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th style={{ padding: "4px 12px 4px 0" }}>optic</th>
              <th style={{ padding: "4px 12px 4px 0" }}>critical ratio across the band</th>
              <th style={{ padding: "4px 12px 4px 0" }}>λ ratio</th>
              <th style={{ padding: "4px 0" }}>departure</th>
            </tr>
          </thead>
          <tbody>
            {contest.map((c) => (
              <tr key={c.optic} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "4px 12px 4px 0" }}>{OPTIC_LABELS[c.optic]}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>{c.spread.ratio.toFixed(9)}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>{c.spread.lambdaRatio.toFixed(9)}</td>
                <td style={{ padding: "4px 0" }}>
                  <strong>{(c.spread.departure * 100).toFixed(6)}%</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 900 }}>
          The critical pitch is <em>not</em> λ/(4·NA) with λ alone moving — the traced NA moves too.
          A singlet&rsquo;s falls monotonically and its spread runs <strong>wider</strong> than the
          wavelength ratio; an achromat&rsquo;s peaks mid-band at the crossing, so its spread runs
          <strong> narrower</strong>, 17× smaller and opposite in sign. The mirror is the control
          that makes this a statement about glass: a conic has no refractive index, so its NA is
          bitwise identical at every λ and its departure is <strong>exactly zero</strong>, at any
          aperture. § 3b&rsquo;s singlet-versus-achromat contest, in pixels rather than in colour.
        </p>
      </section>

      <section>
        <h3 style={{ fontFamily: "monospace", fontSize: 13, margin: "0 0 8px" }}>
          the pixel is a box integrator — measured, not drawn
        </h3>
        <Plot
          series={[
            {
              label: "measured through resampleGridToSensor",
              color: "#36c",
              points: mtf.points
                .filter((p) => p.fractionOfNyquist < 1)
                .map((p) => [p.fractionOfNyquist, p.measured] as const),
              dots: true,
            },
            {
              label: "|sinc(π·f·pitch)| — reference only",
              color: "#c33",
              dash: [4, 3],
              points: mtf.points
                .filter((p) => p.fractionOfNyquist < 1)
                .map((p) => [p.fractionOfNyquist, p.sinc] as const),
            },
            {
              label: "above Nyquist, plotted where it folds to",
              color: "#a60",
              points: mtf.points
                .filter((p) => p.aliasedToCyclesPerMm !== undefined)
                .map(
                  (p) =>
                    [p.aliasedToCyclesPerMm! / mtf.nyquistCyclesPerMm, p.measured] as const,
                )
                .sort((a, b) => a[0] - b[0]),
              dots: true,
            },
          ]}
          xLabel="target frequency / sensor Nyquist"
          yLabel="modulation"
          xMin={0}
          xMax={1}
          yMin={0}
          yMax={1.05}
          width={460}
        />
        <Guard
          label="exactly Nyquist is refused, not plotted:"
          value="no value"
          level="warn"
          detail={mtf.refusedAtNyquist}
        />
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, marginTop: 6 }}>
          largest departure from the closed form below Nyquist:{" "}
          <strong>{mtf.maxRelativeDeparture.toExponential(3)}</strong>
          <div style={{ color: "#666" }}>
            …and it belongs to the <em>target&rsquo;s</em> staircase, not the detector. Refining the
            source subdivision at fixed frequency:{" "}
            {refinement.map((r) => `${r.subdivision}:${r.ratio.toFixed(6)}`).join("  ")} — error
            falling ×4.00 per doubling, which is the midpoint rule&rsquo;s own second order. A
            detector effect would not move with the target&rsquo;s sampling at all.
          </div>
          <div style={{ color: "#666" }}>
            The orange series is the same measurement above Nyquist, drawn at the frequency it folds
            to: projecting at f and at |1/p − f| returns the <strong>bit-identical</strong> number,
            because on the sampled grid those two frequencies are one frequency. That is the
            sampling theorem produced rather than asserted.
          </div>
        </div>
      </section>

      <section>
        <h3 style={{ fontFamily: "monospace", fontSize: 13, margin: "0 0 8px" }}>
          plate scale, field of view, and the floor that is not distortion
        </h3>
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7 }}>
          plate scale <strong>{geometry.formats[0]?.arcsecPerPixel.toFixed(4) ?? "—"}</strong> ″/px
          at {FOCUS_NM} nm ·{" "}
          <span style={{ color: "#666" }}>
            this is a per-wavelength number too — it runs off `systemProperties(λ).efl`, moving
            0.12% across the band on the achromat and non-monotonically, the same crossing. A panel
            printing one plate scale is picking a wavelength, so this one says which.
          </span>
          <div style={{ marginTop: 4 }}>
            image plane sits{" "}
            <strong>
              {geometry.offsetMm === undefined
                ? "—"
                : `${(geometry.offsetMm * 1000).toFixed(3)} µm`}
            </strong>{" "}
            from the paraxial focal plane
          </div>
        </div>
        <table
          style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse", marginTop: 8 }}
        >
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th style={{ padding: "4px 12px 4px 0" }}>format</th>
              <th style={{ padding: "4px 12px 4px 0" }}>pixels</th>
              <th style={{ padding: "4px 12px 4px 0" }}>FOV w × h (°)</th>
              <th style={{ padding: "4px 12px 4px 0" }}>paraxial w (°)</th>
              <th style={{ padding: "4px 0" }}>distortion</th>
            </tr>
          </thead>
          <tbody>
            {geometry.formats.map((row) => (
              <tr
                key={row.key}
                style={{ borderBottom: "1px solid #eee", color: row.error ? "#c00" : undefined }}
              >
                <td style={{ padding: "4px 12px 4px 0" }}>{row.label}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>
                  {row.cols}×{row.rows}
                </td>
                {row.error ? (
                  <td colSpan={3} style={{ padding: "4px 0" }}>
                    refused: {row.error}
                  </td>
                ) : (
                  <>
                    <td style={{ padding: "4px 12px 4px 0" }}>
                      {row.fovWidthDeg!.toFixed(4)} × {row.fovHeightDeg!.toFixed(4)}
                    </td>
                    <td style={{ padding: "4px 12px 4px 0" }}>
                      {row.paraxialWidthDeg!.toFixed(4)}
                    </td>
                    <td style={{ padding: "4px 0" }}>
                      {row.distortion === undefined
                        ? "—"
                        : `${(row.distortion * 100).toExponential(3)}%`}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 900 }}>
          The obvious readout — traced FOV against the paraxial 2·atan(½w/EFL) — has a{" "}
          <strong>floor</strong> in it, 0.0212% on the f/10 achromat and still there at 0.029° of
          field where distortion is identically zero. Calling that &ldquo;distortion&rdquo; would be
          C1&rsquo;s own fringe error repeating one panel later. Moving the image plane to the last
          vertex sends the floor to +3.4553% and leaves the field-dependent part unchanged, so the
          departure <em>factorizes</em>: a plane-position scale times a distortion. The column above
          is the distortion alone — the implied EFL at this field against the implied EFL on axis —
          and it runs ×4.00 per doubling of field, third-order theory&rsquo;s cubic in its
          fractional form. The paraboloid is the control: its focus offset is 2e-5 µm and its
          distortion is <strong>0 to f64</strong>, so both floors vanish together.
        </p>
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 900 }}>
          A refused row is § 2f&rsquo;s wall, and it is real: past a certain field a Newtonian&rsquo;s
          diagonal stops passing the chief ray, so the sensor corner has no image point rather than a
          bad one. Driving this panel is what found that `fieldOfView`&rsquo;s bracket started
          <em> outside</em> that field and threw on questions the system could answer — fixed in the
          engine and pinned at § 5r.1, where the refusal boundary now lands on § 2f&rsquo;s own
          closed form to 4e-6.
        </p>
      </section>
    </div>
  );
}
