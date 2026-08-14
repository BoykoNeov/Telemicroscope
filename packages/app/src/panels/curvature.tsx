import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { fieldCurvature, CURVATURE_LINES } from "../curvature";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import type { LensKind } from "../render";

/**
 * The two focal surfaces and distortion — ROADMAP's v1 analyses line, and the
 * entry it twice recorded as already having a surface when it did not.
 *
 * Two plots. The first is the one this panel exists for: three predicted
 * surfaces drawn behind two traced ones, against field, in millimetres of sag
 * from the on-axis focus. The second is distortion, in parts per million,
 * because on the lenses this app ships it is *that small* and drawing it as a
 * percentage would be drawing a flat line and calling it a measurement.
 *
 * **Both lenses are computed on every frame**, not just the selected one. The
 * panel's headline is a comparison — the achromat did not flatten the field —
 * and a comparison quoted from prose is a number that can go stale while the
 * page still looks right. `docs(app)`'s own history in this repo is exactly that
 * failure (a panel printing 0.0852 under a test citing 0.11), so the sentence on
 * screen reads its second number from a live second call. It costs ~21 ms.
 *
 * Runs inline rather than in a worker, on `mtf.tsx`'s precedent and further
 * inside it: two fans of 41 rays at 13 fields, plus a paraxial recursion, is
 * ~21 ms per lens — a slider that tracks.
 */

const APERTURE = { min: 20, max: 120, step: 5 };
const FOCAL = { min: 400, max: 2000, step: 100 };
const FIELD = { min: 0.4, max: 3, step: 0.1 };
const FAN_SAMPLES = [21, 31, 41] as const;
const FIELD_STEPS = 13;

/** The other one — the comparison this panel is built on. */
const OTHER: Record<LensKind, LensKind> = { singlet: "achromat", achromat: "singlet" };

export function CurvaturePanel() {
  const [lens, setLens] = useState<LensKind>("achromat");
  const [focalLengthMm, setFocalLengthMm] = useState(1000);
  const [apertureMm, setApertureMm] = useState(100);
  const [maxFieldDeg, setMaxFieldDeg] = useState(1.6);
  const [wavelengthNm, setWavelengthNm] = useState(587.5618);
  const [fanSamples, setFanSamples] = useState<(typeof FAN_SAMPLES)[number]>(41);

  const run = (which: LensKind) =>
    fieldCurvature({
      lens: which,
      focalLengthMm,
      apertureMm,
      sourceTemperatureK: 5800,
      wavelengths: 5,
      wavelengthNm,
      maxFieldDeg,
      fieldSteps: FIELD_STEPS,
      fanSamples,
    });
  const deps = [lens, focalLengthMm, apertureMm, maxFieldDeg, wavelengthNm, fanSamples];
  const result = useMemo(() => run(lens), deps);
  const other = useMemo(() => run(OTHER[lens]), deps);

  const s = result.samples;
  const at = (pick: (sample: (typeof s)[number]) => number) =>
    s.map((sample) => [sample.fieldDeg, pick(sample)] as const);

  /**
   * The predictions are drawn FAT and the measurements THIN on top of them.
   *
   * Drawn the other way round — the obvious way — this panel shows one curve
   * where its legend promises two, at every setting, because the traced and
   * predicted surfaces agree to about a part in a thousand and a 2 px line hides
   * a 1.4 px one completely. A reader would see a missing series rather than an
   * agreement. Fat-under-thin turns the same fact into a visible halo of dashes
   * around the measurement, and the width difference is not a claim about which
   * curve is more certain: the closed form is exact and it is the traced one
   * that carries the sampling.
   */
  const predicted = { width: 2.8, dash: [5, 4] } as const;
  const measured = { width: 1.4, dots: true } as const;

  const surfaces: PlotSeries[] = [
    { label: "third-order tangential", color: "#e8a29a", points: at((v) => v.thirdOrderTangentialMm), ...predicted },
    { label: "third-order sagittal", color: "#9ad9bd", points: at((v) => v.thirdOrderSagittalMm), ...predicted },
    { label: "Petzval", color: "#06c", points: at((v) => v.petzvalMm), dash: [2, 3], width: 1.4 },
    { label: "medial", color: "#999", points: at((v) => v.medialSagMm), width: 1 },
    { label: "tangential (traced)", color: "#c0392b", points: at((v) => v.tangentialSagMm), ...measured },
    { label: "sagittal (traced)", color: "#2b7", points: at((v) => v.sagittalSagMm), ...measured },
  ];

  const distortion: PlotSeries[] = [
    { label: "third-order S_V cubic", color: "#bbb", points: at((v) => v.thirdOrderDistortionPpm), ...predicted },
    { label: "traced chief ray", color: "#c0392b", points: at((v) => v.distortionPpm), ...measured },
  ];

  const sagFloor = Math.min(...s.map((v) => v.tangentialSagMm)) * 1.08;
  const sagCeiling = Math.max(0, ...s.map((v) => v.sagittalSagMm));
  const ppmFloor = Math.min(0, ...s.map((v) => v.distortionPpm)) * 1.1;
  const ppmCeiling = Math.max(0, ...s.map((v) => v.distortionPpm)) * 1.1;

  const petzvalRatioToOther = result.edge.petzvalMm / other.edge.petzvalMm;
  const flatter = petzvalRatioToOther < 1;
  const truncated = result.maxLost > 0;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Where the flat detector goes, when the image is not flat</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Every other analysis on this site asks about one point in the field. This one asks the
        question a <em>sensor</em> asks. An off-axis pencil has no single focus: the fan in the plane
        containing the axis and the field point comes to a line focus at one distance, the fan at
        right angles to it at another, and swept over field those are two curved surfaces. A flat
        detector has to sit somewhere between them. The dashed curves are not fits — they are the
        published third-order expressions evaluated on this lens&rsquo;s own Seidel sums, drawn
        behind the traced answer.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice label="lens" options={["singlet", "achromat"] as const} value={lens} onChange={setLens} />
        <Slider
          label={`focal length ${focalLengthMm} mm`}
          {...FOCAL}
          value={focalLengthMm}
          onChange={setFocalLengthMm}
        />
        <Slider
          label={`aperture ${apertureMm} mm (f/${(focalLengthMm / apertureMm).toFixed(1)})`}
          {...APERTURE}
          value={apertureMm}
          onChange={setApertureMm}
        />
        <Slider
          label={`half-field ${maxFieldDeg.toFixed(1)}°`}
          {...FIELD}
          value={maxFieldDeg}
          onChange={setMaxFieldDeg}
        />
        <Choice
          label="wavelength"
          options={CURVATURE_LINES.map((l) => l.nm)}
          value={wavelengthNm}
          onChange={setWavelengthNm}
          format={(nm) => CURVATURE_LINES.find((l) => l.nm === nm)!.name}
        />
        <Choice
          label="rays per fan"
          options={FAN_SAMPLES}
          value={fanSamples}
          onChange={setFanSamples}
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={surfaces}
          markers={[{ y: result.flatPlaneMm, color: "#a60", label: "a flat sensor here" }]}
          xLabel="field angle (degrees off axis)"
          yLabel="sag from the on-axis focus (mm)"
          xMin={0}
          xMax={maxFieldDeg}
          yMin={sagFloor}
          yMax={sagCeiling}
          width={560}
          height={320}
        />
        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, maxWidth: 320 }}>
          <div style={{ color: "#666", marginBottom: 4 }}>reading the plot</div>
          <div style={{ color: "#c0392b" }}>tangential — the fan in the field&rsquo;s own plane</div>
          <div style={{ color: "#2b7" }}>sagittal — the fan at right angles to it</div>
          <div style={{ color: "#999" }}>medial — halfway, where the blur is roundest</div>
          <div style={{ color: "#06c" }}>Petzval — where both would lie with astigmatism nulled</div>
          <div style={{ marginTop: 12, color: "#666" }}>
            Everything is negative: both surfaces bend <em>toward</em> the lens, inside the on-axis
            focus. The tangential one is always the further of the two, and by a factor the third
            order fixes at exactly 3 — see below.
          </div>
          <div style={{ marginTop: 12, color: "#666" }}>
            Each pale dashed curve is a prediction and the solid line on top of it is the trace. They
            are drawn fat-under-thin on purpose: they agree to about a part in a thousand, so drawn
            the other way round this plot would show three curves where the legend lists five, and a
            reader would see a missing series rather than an agreement.
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>
        The {lens} {flatter ? "has the flatter field" : "did not flatten the field"}
      </h2>
      <p style={{ maxWidth: 660, color: "#444", fontSize: 14 }}>
        The achromat is this app&rsquo;s whole demonstration: it fixes the singlet&rsquo;s colour and
        its spherical aberration. Against this aberration it does nothing. The Petzval surface is the
        part of the curvature no balancing can move — it is a sum of element powers over their
        indices — so correcting colour by adding glass tends to make it slightly <em>worse</em>, and
        here it does.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <Fact
          label={`Petzval sag at ${maxFieldDeg.toFixed(1)}°`}
          value={`${result.edge.petzvalMm.toFixed(4)} mm`}
          note={`the ${OTHER[lens]} on the same geometry: ${other.edge.petzvalMm.toFixed(4)} mm — this lens is ${(Math.abs(petzvalRatioToOther - 1) * 100).toFixed(1)}% ${flatter ? "flatter" : "more curved"}. Computed live from a second call, not quoted from prose`}
        />
        <Fact
          label="tangential sag there"
          value={`${result.edge.tangentialSagMm.toFixed(4)} mm`}
          note={`the ${OTHER[lens]}'s is ${other.edge.tangentialSagMm.toFixed(4)} mm — ${(Math.abs(result.edge.tangentialSagMm / other.edge.tangentialSagMm - 1) * 100).toFixed(1)}% apart. Two lenses whose Strehl ratios and spot sizes are nothing like each other land on nearly the same curved field`}
        />
        <Fact
          label="astigmatic interval"
          value={`${Math.abs(result.astigmaticIntervalMm).toFixed(4)} mm`}
          note="tangential minus sagittal — the gap no single plane can be inside for both orientations"
        />
        <Guard
          label="(tangential − Petzval) / (sagittal − Petzval)"
          value={result.petzvalRatio.toFixed(4)}
          level={thresholdLevel(Math.abs(result.petzvalRatio - 3), 0.1)}
          detail="identically 3 in third order, because x_t − x_p = 3(x_s − x_p) falls straight out of the two expressions. The traced surfaces are not third-order surfaces, so this is a measurement landing on an identity rather than an assertion of one"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>What that costs a flat sensor</h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Fact
          label="depth of focus"
          value={`±${result.depthOfFocusMm.toFixed(4)} mm`}
          note="the QUARTER-WAVE (Rayleigh) figure, ±λ/2NA² = ±2λ(f/#)². Some texts quote the full-wave number, which is twice this; the two conventions differ by exactly the factor a caption on the seeing page once got wrong"
        />
        <Fact
          label={`the ${maxFieldDeg.toFixed(1)}° corner, in depths of focus`}
          value={result.cornerDepths.toFixed(1)}
          note="how far the tangential focus at the edge of the frame is from the plane the axis is sharp on. Stopping down fixes this without flattening anything: the depth of focus grows as the square of the focal ratio while these surfaces, as measured below, barely move with aperture at all"
        />
        <Fact
          label="best flat plane"
          value={`${result.flatPlaneMm.toFixed(4)} mm`}
          note="midpoint of the medial surface's range over the sampled field — a midpoint, NOT a solve. No criterion was optimized to get it and nothing here claims it is the optimum"
        />
        <Fact
          label="worst medial miss from that plane"
          value={result.flatPlaneWorstDepths.toFixed(1)}
          note="in depths of focus. This is the number that says whether the frame can be sharp corner to corner at all — put the sensor at the best plane available and this is what is still left over. Neither of these two is a red guard: they are what the lens does, not the engine refusing to answer"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>Distortion, and the plane it has to be read at</h2>
      <p style={{ maxWidth: 660, color: "#444", fontSize: 14 }}>
        Distortion is the chief ray landing somewhere other than where the paraxial image height says
        it should — the one term in the transverse expansion with no pupil coordinate in it, so it
        moves the image point instead of blurring it. On a two-element lens with the stop at the front
        vertex there is almost none: the axis below is <strong>parts per million</strong>, not
        percent, and a plot drawn in percent would be a flat line through zero dressed up as a
        measurement. Negative is barrel — the direction a stop ahead of a positive lens gives.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={distortion}
          xLabel="field angle (degrees off axis)"
          yLabel="distortion (parts per million)"
          xMin={0}
          xMax={maxFieldDeg}
          yMin={ppmFloor}
          yMax={ppmCeiling}
          width={470}
          height={280}
        />
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", maxWidth: 420 }}>
          <Fact
            label={`distortion at ${maxFieldDeg.toFixed(1)}°`}
            value={`${result.edge.distortionPpm.toFixed(3)} ppm`}
            note={`${(Math.abs(result.edge.distortionPpm) / 1e4).toExponential(1)}% — for scale, a wide-angle camera lens is a few percent. The curve goes as the square of the field because the height it is a fraction of goes as the field and the error goes as its cube`}
          />
          <Fact
            label="traced against the S_V cubic"
            value={result.distortionDeparture.toExponential(2)}
            note="two disjoint machineries agreeing at the ppm level: an exactly traced skew ray here, a paraxial y–u recursion through the Seidel sums there. The residual grows as the square of the field, which is the fifth-order term showing through"
          />
          <Fact
            label="what the wrong plane would have cost"
            value={`${result.defocusLeverRatio.toFixed(0)}×`}
            note="the gap between the paraxial plane and the on-axis best-spot plane, as a pure scale error, against the real distortion at the edge. The engine picks the plane itself and will not accept one — this number is what that refusal is worth on THIS lens, and it is far larger than the 13× the module was written against"
          />
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>What has an aperture in it, and what does not</h2>
      <p style={{ maxWidth: 660, color: "#444", fontSize: 14 }}>
        The dashed surfaces have no aperture in them at all — they are ratios of Seidel sums to
        n′u′², and it cancels — and neither does the traced distortion, which is a chief ray. The
        traced surfaces do: they are where a real fan&rsquo;s spot is smallest. How much they move
        when you open the lens up is this panel&rsquo;s measurement of what <em>else</em> is in the
        design, and it is the reason the two pairs of curves do not lie on top of each other.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Fact
          label="traced tangential vs third order"
          value={result.tangentialDeparture.toExponential(2)}
          note="on the singlet this grows steadily with aperture and CHANGES SIGN near 35 mm, so the two curves lying on top of each other at one aperture is not a check on anything. Walk the aperture slider and watch it move"
        />
        <Fact
          label="traced sagittal vs third order"
          value={result.sagittalDeparture.toExponential(2)}
          note="an order of magnitude steadier than the tangential across the same aperture range, on both lenses"
        />
        <Guard
          label="rays lost, worst field"
          value={String(result.maxLost)}
          level={result.maxLost > 0 ? "warn" : "ok"}
          detail={
            truncated
              ? "the engine documents a non-zero loss as invalidating these sags, and on this app's own doublet it fires — the crown closes on itself at 73% of its semi-diameter, which the MTF page measures from the other side"
              : "nothing was vignetted or lost to total internal reflection at any sampled field"
          }
        />
        <Fact
          label="the control for it"
          value={truncated ? result.controlDeparture.toExponential(2) : "not needed"}
          note={
            truncated
              ? `the same edge field re-traced at ${result.controlApertureMm.toFixed(0)} mm, which loses ${result.controlLost}, against the sag on the plot. It says the truncation did not move this number. It does not say why — the obvious reason, a rim lost evenly all the way round, is a mechanism nothing here measured`
              : "the guard did not fire, so there is nothing to control against"
          }
        />
        <Fact
          label="elapsed"
          value={`${(result.elapsedMs + other.elapsedMs).toFixed(0)} ms`}
          note="both lenses, every frame, no worker — the comparison above is live rather than quoted"
        />
      </div>
    </>
  );
}
