import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import { Choice, Guard, Slider, thresholdLevel } from "../ui";
import { createSeeingWorker } from "../workers";
import {
  OPTIC_LABELS,
  PHASE_STEP_LIMIT_WAVES,
  SCREEN_COUNTS,
  SEEING_OPTICS,
  type Refusal,
  type SeeingOptic,
  type SeeingRequest,
  type SeeingResult,
} from "../seeing";

/**
 * Long-exposure seeing — APP.md's C6, and the last item in Part C.
 *
 * The app has had a seeing dial since roadmap step 5 and it draws **one screen**
 * — a short exposure, a speckle pattern — because that is all § 5d exported. The
 * long-exposure quantities the ladder pins were computed inside a test file and
 * were unreachable. § 5d.1 promoted the ensemble; this is the first caller.
 *
 * ## It is compute-once, and the panel is shaped around that
 *
 * There is no live dial here and there cannot be: the low-order wander converges
 * as 1/√N, so a converged mean is 120 screens and ~7 s in node. The screen count
 * is therefore an explicit choice whose options carry their own cost, and it
 * **starts at 1** — which is exactly the star panel's existing behaviour, so this
 * surface opens on the thing it is about to correct and the reader takes one
 * deliberate step to the ensemble.
 *
 * ## Three frames on one scale, and the scale is the mean's
 *
 * The draw, the mean and the atmosphere-free instrument share one white, set by
 * the **mean's** peak — the frame the panel is about — so the other two clip by
 * exactly the ratios printed beside them. See `seeing.ts`'s `toGrey` for the two
 * references that were tried first and why neither works. A10's rule is what
 * makes that acceptable: a factor is precisely what a picture cannot show the
 * size of, so the numbers carry it and the shade only has to make the shapes
 * legible. The shapes are the argument — speckle, disc, rings.
 */

/** White is this multiple of the mean's peak. Enough headroom that it does not clip. */
const WHITE_OVER_MEAN_PEAK = 1.15;

const DEFAULT: SeeingRequest = {
  optic: "achromat",
  apertureMm: 200,
  focalRatio: 8,
  friedParamMm: 50,
  screens: 1,
  pupilSamples: 32,
  seed: 10000,
  whiteOverMeanPeak: WHITE_OVER_MEAN_PEAK,
};

/** What each screen count buys, so the click is informed rather than a surprise. */
const SCREEN_LABELS: Record<number, string> = {
  1: "1 — a draw (~0.1 s)",
  10: "10 (~0.5 s)",
  30: "30 (~1.5 s)",
  120: "120 — § 5d's own (~7 s)",
};

function Frame({
  rgba,
  size,
  caption,
}: {
  rgba: Uint8ClampedArray;
  size: number;
  caption: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = size;
    element.height = size;
    const context = element.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  }, [rgba, size]);
  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvas}
        style={{ width: 240, height: 240, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, marginTop: 6, maxWidth: 240 }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function SeeingPanel() {
  const [optic, setOptic] = useState<SeeingOptic>(DEFAULT.optic);
  const [apertureMm, setApertureMm] = useState(DEFAULT.apertureMm);
  const [friedParamMm, setFriedParamMm] = useState(DEFAULT.friedParamMm);
  const [screens, setScreens] = useState<number>(DEFAULT.screens);
  const [pupilSamples, setPupilSamples] = useState(DEFAULT.pupilSamples);

  const request: SeeingRequest = useMemo(
    () => ({ ...DEFAULT, optic, apertureMm, friedParamMm, screens, pupilSamples }),
    [optic, apertureMm, friedParamMm, screens, pupilSamples],
  );
  const { result, pending } = useLatestFromWorker<SeeingRequest, SeeingResult | Refusal>(
    createSeeingWorker,
    request,
  );
  const r = result && "size" in result ? result : null;

  return (
    <>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Choice
          label="optic"
          options={SEEING_OPTICS}
          value={optic}
          onChange={setOptic}
          format={(k) => OPTIC_LABELS[k]}
        />
        <Choice
          label="screens averaged — this is the whole cost"
          options={SCREEN_COUNTS}
          value={screens}
          onChange={setScreens}
          format={(n) => SCREEN_LABELS[n] ?? `${n}`}
        />
        <Choice
          label="pupil samples"
          options={[32, 64]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Slider
          label={`aperture ${apertureMm.toFixed(0)} mm`}
          min={60}
          max={400}
          step={10}
          value={apertureMm}
          onChange={setApertureMm}
        />
        <Slider
          label={`r₀ ${friedParamMm.toFixed(0)} mm at 500 nm`}
          min={20}
          max={200}
          step={5}
          value={friedParamMm}
          onChange={setFriedParamMm}
        />
      </div>

      {result && !("size" in result) && (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", maxWidth: 700 }}>
          the {result.stage} refused ({result.source}): {result.error}
        </p>
      )}

      {r && (
        <div
          style={{
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            marginTop: 16,
            opacity: pending ? 0.55 : 1,
            transition: "opacity 120ms ease-out",
          }}
        >
          <Frame
            rgba={r.drawRgba}
            size={r.size}
            caption={
              <>
                <strong>one screen</strong> — a short exposure
                <br />
                FWHM {r.drawFwhmPx.toFixed(2)} px · peak {(100 * r.drawPeakRatio).toFixed(1)}% of the
                atmosphere-free peak
              </>
            }
          />
          <Frame
            rgba={r.meanRgba}
            size={r.size}
            caption={
              <>
                <strong>{r.screens} averaged</strong> — the seeing disc
                <br />
                FWHM {r.meanFwhmPx.toFixed(2)} px = <strong>{r.meanFwhmArcsec.toFixed(3)}″</strong> ·
                peak {(100 * r.meanPeakRatio).toFixed(1)}%
              </>
            }
          />
          <Frame
            rgba={r.cleanRgba}
            size={r.size}
            caption={
              <>
                <strong>no atmosphere</strong> — the instrument alone
                <br />
                FWHM {r.cleanFwhmPx.toFixed(2)} px = {r.diffractionFwhmArcsec.toFixed(3)}″ · Strehl{" "}
                {r.cleanStrehl.toFixed(4)}
              </>
            }
          />

          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, maxWidth: 420 }}>
            <div>
              D/r₀ <strong>{r.dOverR0.toFixed(2)}</strong> · {r.elapsedMs.toFixed(0)} ms
            </div>
            <div>
              measured <strong>{r.meanFwhmArcsec.toFixed(4)}″</strong> against Fried&rsquo;s
              0.98·λ/r₀ = {r.friedFwhmArcsec.toFixed(4)}″ (
              {(100 * (r.meanFwhmArcsec / r.friedFwhmArcsec - 1)).toFixed(1)}%)
            </div>
            <div style={{ color: r.seeingLimited ? "#777" : "#a60" }}>
              seeing-limited above {r.seeingLimitedAboveMm.toFixed(1)} mm of aperture —{" "}
              {r.seeingLimited
                ? "this telescope is past it, so 0.98·λ/r₀ is the answer"
                : "this telescope is NOT past it, so the disc is diffraction and 0.98·λ/r₀ does not apply"}
            </div>
            <div style={{ marginTop: 10 }}>
              the transfer function leaves Fried at ν{" "}
              <strong>
                {r.transferDepartsAtNu === null ? "— (not inside the band)" : r.transferDepartsAtNu.toFixed(4)}
              </strong>
            </div>
            <div style={{ color: "#777" }}>
              that is the ensemble&rsquo;s own noise floor, not the sky — it moves outward as the
              screen count grows
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
              <Guard
                label="screen resolved on the FFT grid"
                value={`${r.maxGridPhaseStepWaves.toFixed(4)} waves/sample`}
                level={thresholdLevel(r.maxGridPhaseStepWaves, PHASE_STEP_LIMIT_WAVES)}
                detail="the fidelity criterion runs on traced samples and is blind to the screen, so this is the only thing that catches an atmosphere the grid cannot represent — past ½ the mean is aliasing averaged, not a seeing disc"
              />
              <Guard
                label="ensemble converged"
                value={`${r.screens} screens`}
                level={r.screens >= 120 ? "ok" : r.screens >= 30 ? "warn" : "bad"}
                detail="the wander falls as 1/√N; § 5d.1 measures two 30-screen means at 12.5 and 13.5 px where 120 gives 15.5, so a cheap ensemble is biased NARROW rather than merely noisy"
              />
            </div>
          </div>
        </div>
      )}

      {r && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 36 }}>
            The atmospheric transfer function, and where the measurement stops being one
          </h2>
          <p style={{ maxWidth: 700, color: "#444" }}>
            Long-exposure MTF divided by the same instrument&rsquo;s diffraction MTF, bin for bin,
            against Fried&rsquo;s exp(−3.44·(ν·D/r₀)^(5/3)) — <strong>evaluated, not fitted</strong>.
            Nothing about the atmosphere is put into the curve: the screens are Kolmogorov draws, the
            transform is the same one every other panel uses, and the model is drawn on top.
          </p>

          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <Plot
              series={[
                {
                  label: "measured (long exposure / diffraction)",
                  color: "#06a",
                  dots: true,
                  points: r.transfer.map((p) => [p.nu, p.measured] as const),
                },
                {
                  label: "Fried exp(−3.44·(ν·D/r₀)^5/3)",
                  color: "#c60",
                  dash: [4, 3],
                  points: r.transfer.map((p) => [p.nu, p.fried] as const),
                },
              ]}
              markers={
                r.transferDepartsAtNu === null
                  ? []
                  : [{ x: r.transferDepartsAtNu, color: "#c00", label: "noise floor" }]
              }
              xLabel="ν = f / cutoff"
              yLabel="atmospheric modulation"
              xMin={0}
              xMax={0.5}
              yMin={0}
              yMax={1}
            />

            <Plot
              series={[
                {
                  label: "r₀_eff / r₀ recovered per frequency",
                  color: "#06a",
                  dots: true,
                  points: r.transfer
                    .filter((p) => p.effectiveFriedRatio !== null)
                    .map((p) => [p.nu, p.effectiveFriedRatio!] as const),
                },
                {
                  label: "1 — a pure r₀ shift would be flat here",
                  color: "#999",
                  dash: [3, 3],
                  points: [
                    [0, 1],
                    [0.5, 1],
                  ],
                },
              ]}
              markers={
                r.transferDepartsAtNu === null
                  ? []
                  : [{ x: r.transferDepartsAtNu, color: "#c00", label: "noise floor" }]
              }
              xLabel="ν = f / cutoff"
              yLabel="r₀_eff / r₀"
              xMin={0}
              xMax={0.5}
              yMin={0.7}
              yMax={1.6}
            />
          </div>

          <p style={{ maxWidth: 700, fontSize: 13, color: "#666", marginTop: 12 }}>
            The right-hand plot is § 5d&rsquo;s discriminator, and it is the reason that
            section&rsquo;s tolerance is earned rather than asserted. A finite screen truncates the
            largest turbulent scales, so the generator comes out a few percent mild — and if that
            error were a <em>shape</em> distortion this curve would slope. Below the noise floor it
            is flat at a few percent above 1, which is a pure r₀ shift. Past the floor it climbs,
            and that climb belongs to the ensemble rather than to the atmosphere: Fried&rsquo;s
            exponential has plunged under a mean&rsquo;s residual speckle, so the ratio runs away.
            Raise the screen count and the red rule moves right.
          </p>

          <h2 style={{ fontSize: 16, marginTop: 36 }}>
            0.98·λ/r₀ is an answer only where the telescope is seeing-limited
          </h2>
          <p style={{ maxWidth: 700, color: "#444" }}>
            The headline number every observer quotes is a statement about the atmosphere and says
            nothing about the aperture, which is fine until the aperture is small enough that its own
            Airy disc is the wider of the two. Those are equal at 1.22·λ/D = 0.98·λ/r₀, i.e. at{" "}
            <strong>D = (1.22/0.98)·r₀ = {r.seeingLimitedAboveMm.toFixed(1)} mm</strong> here — and{" "}
            <strong>λ cancels</strong>, so the crossover is a property of r₀ and the telescope and
            not of colour. Drag the aperture below it and the measured disc stops following Fried
            and settles onto the diffraction limit instead: it is not that the formula becomes
            inaccurate, it is that it is no longer describing the thing being measured.
          </p>
          <p style={{ maxWidth: 700, fontSize: 13, color: "#666" }}>
            And the instrument&rsquo;s own quality is in the number too, which the two optics make
            visible. On the same sky at D/r₀ = 4 the <strong>Newtonian</strong> — a paraboloid,
            perfect on axis — measures within about 2% of 0.98·λ/r₀, while a 200 mm f/8{" "}
            <strong>achromat</strong> whose own Strehl is {r.cleanStrehl < 0.99 ? "" : "well "}under
            1 measures ~9% wide. The seeing disc a telescope actually delivers is the atmosphere
            convolved with whatever the optic was already doing, and a mirror is the control that
            separates them.
          </p>
        </>
      )}
    </>
  );
}
