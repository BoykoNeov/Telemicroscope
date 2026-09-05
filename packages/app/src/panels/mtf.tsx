import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { mtfCurves, MTF_LINES, MODULATION_FLOOR } from "../mtf";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import type { LensKind } from "../render";

/**
 * The optical MTF — ROADMAP's v1 analyses line, the LAST of the four entries
 * that had no surface.
 *
 * Three curves and a fourth behind them: the two directional sections (§ 6ad),
 * the azimuthal average they replace, and the closed-form perfect lens. Drawn
 * together because each one only means something against the others — a section
 * on its own is a curve, and a section against the diffraction limit is a
 * verdict.
 *
 * Runs inline rather than in a worker, on `spot.tsx` and `wavefront.tsx`'s
 * precedent: one PSF and one transform is 30–50 ms here, which is a slider that
 * tracks, and a worker would buy nothing while dragging in the Vite worker-URL
 * constraint `App.tsx` documents.
 */

const APERTURE = { min: 20, max: 120, step: 5 };
const FOCAL = { min: 400, max: 2000, step: 100 };
const FIELD = { min: 0, max: 1.6, step: 0.05 };
const TRACE_SAMPLES = [21, 31, 41] as const;
const BINS = 81;

export function MtfPanel() {
  const [lens, setLens] = useState<LensKind>("achromat");
  const [focalLengthMm, setFocalLengthMm] = useState(1000);
  const [apertureMm, setApertureMm] = useState(100);
  const [fieldDeg, setFieldDeg] = useState(0.8);
  const [wavelengthNm, setWavelengthNm] = useState(587.5618);
  const [traceSamples, setTraceSamples] = useState<(typeof TRACE_SAMPLES)[number]>(31);

  const result = useMemo(
    () =>
      mtfCurves({
        lens,
        focalLengthMm,
        apertureMm,
        sourceTemperatureK: 5800,
        wavelengths: 5,
        fieldDeg,
        wavelengthNm,
        traceSamples,
        bins: BINS,
      }),
    [lens, focalLengthMm, apertureMm, fieldDeg, wavelengthNm, traceSamples],
  );

  const c = result.curves;
  const pairs = (values: readonly number[]) =>
    c.nu.map((v, i) => [v, values[i]!] as const);

  const series: PlotSeries[] = [
    { label: "perfect", color: "var(--ink-5)", points: pairs(c.perfect), dash: [5, 4] },
    { label: "radial average", color: "var(--pink)", points: pairs(c.radial), width: 1 },
    { label: "tangential", color: "var(--red)", points: pairs(c.tangential), width: 2 },
    { label: "sagittal", color: "var(--green)", points: pairs(c.sagittal), width: 2 },
  ];

  const truncated = result.transmittedCutoffFraction < 0.97;
  const onAxis = fieldDeg === 0;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The optical MTF, and how many of them there are</h1>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        A spot diagram says how big the blur is and a wavefront readout says what shape it is.
        Neither answers the question a lens is actually bought for — <em>can it separate these two
        things</em> — and that is what a modulation transfer function is: the contrast that survives,
        against how fine the detail is. It is also the one readout here whose perfect answer is known
        in closed form, so the grey dashed curve below is not a fit or a reference measurement but an
        expression, drawn behind the real lens.
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
          label={`field ${fieldDeg.toFixed(2)}°`}
          {...FIELD}
          value={fieldDeg}
          onChange={setFieldDeg}
        />
        <Choice
          label="wavelength"
          options={MTF_LINES.map((l) => l.nm)}
          value={wavelengthNm}
          onChange={setWavelengthNm}
          format={(nm) => MTF_LINES.find((l) => l.nm === nm)!.name}
        />
        <Choice
          label="rays across the pupil"
          options={TRACE_SAMPLES}
          value={traceSamples}
          onChange={setTraceSamples}
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={series}
          xLabel="ν = frequency / the cutoff the aperture was asked for"
          yLabel="modulation"
          xMin={0}
          xMax={1}
          yMin={0}
          yMax={1.02}
          width={560}
        />
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.8, maxWidth: 320 }}>
          <div style={{ color: "var(--ink-3)", marginBottom: 4 }}>what the four curves are</div>
          <div style={{ color: "var(--red)" }}>tangential — bars across the field radius</div>
          <div style={{ color: "var(--green)" }}>sagittal — bars along it</div>
          <div style={{ color: "var(--pink)" }}>the azimuthal average of the whole array</div>
          <div style={{ color: "var(--ink-5)" }}>the closed form for this aperture</div>
          <div style={{ marginTop: 12, color: "var(--ink-3)" }}>
            {onAxis
              ? "On axis the pupil is round, so the two sections are the same curve — the split below is the f64 floor, not a lens."
              : "Off axis the blur has a direction, so contrast depends on which way the bars run."}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>There are two MTFs, not one</h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <Fact
          label="largest gap between the sections"
          value={result.largestSplit < 1e-6 ? result.largestSplit.toExponential(1) : result.largestSplit.toFixed(4)}
          note={`at ν = ${result.splitAtNu.toFixed(2)} — how much worse one orientation of a bar target is than the other`}
        />
        <Guard
          label="most the average misstates a section by"
          value={result.averageMisstatesBy.toFixed(4)}
          level={result.averageMisstatesBy > 0.02 ? "warn" : "ok"}
          detail={
            result.averageMisstatesBy > 0.02
              ? "the summary curve sits between the two and so reports a contrast neither orientation of a bar target actually gets — this is what is wrong with averaging, and it is not that the average leaves the band"
              : "on a round pupil there is nothing to summarize away, and the average lies on both sections"
          }
        />
        <Fact
          label="…and drops below BOTH by"
          value={result.averageBelowBoth.toExponential(1)}
          note="the 45° azimuths, which are worse than either axis on a comatic pupil. Real, and three orders under the gap above — the first draft of this panel had those two the other way round, having measured the effect through a profile binned too coarsely"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>
        The cutoff is two numbers, and only one of them is on the axis above
      </h2>
      <p style={{ maxWidth: 640, color: "var(--ink-2)", fontSize: 14 }}>
        The engine reports 2·NA/λ, computed from the exit pupil radius — the cutoff of the aperture
        the system was <em>asked</em> for. Where the curve actually reaches its floor is the cutoff
        of the aperture that <em>transmitted</em>. Those are the same number only when every ray gets
        through, and on this app&rsquo;s own doublet past about f/20 they are not: the design fixes
        the crown&rsquo;s centre thickness at 3 mm whatever the focal length, so the two surfaces
        meet and the tracer reports a miss from the rim inward.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Fact
          label="cutoff asked for"
          value={`${result.nominalCutoffCyclesPerMm.toFixed(2)} c/mm`}
          note="2·NA/λ off the exit pupil radius — what the ν axis above is scaled by"
        />
        <Guard
          label="cutoff transmitted"
          value={`${result.transmittedCutoffCyclesPerMm.toFixed(2)} c/mm`}
          level={thresholdLevel(1 - result.transmittedCutoffFraction, 0.2)}
          detail={`${(result.transmittedCutoffFraction * 100).toFixed(0)}% of the nominal — where the modulation falls below ${MODULATION_FLOOR}`}
        />
        <Guard
          label="outermost ray that got through"
          value={result.tracedRadiusFraction.toFixed(4)}
          level={thresholdLevel(1 - result.tracedRadiusFraction, 0.2)}
          detail={`${result.lost} rays lost. This is the trace agreeing with the transform beside it — two different machineries, which is what says the short cutoff is aperture and not aberration. But read it as a LATTICE point and not as the wall: it is the outermost sample that happened to fall inside, so it moves with the ray count (0.7280 / 0.7211 / 0.7280 at 21 / 31 / 41) without the lens changing at all. The wall itself is at 0.7326, where the crown's two sags meet, and no ray grid sits exactly on it.`}
        />
        <Fact label="Strehl" value={result.strehl.toFixed(4)} note="peak over diffraction-limited peak, same field and wavelength" />
      </div>
      {truncated && (
        <p style={{ maxWidth: 640, color: "var(--warn)", fontSize: 13, marginTop: 8 }}>
          This lens is transmitting {(result.tracedRadiusFraction * 100).toFixed(0)}% of its stated
          radius, so it is really an f/
          {(focalLengthMm / (apertureMm * result.tracedRadiusFraction)).toFixed(1)} lens wearing an
          f/{(focalLengthMm / apertureMm).toFixed(1)} label. Widen the focal length or narrow the
          aperture and the wall goes away — it moves as √f, so it is a length and not a focal ratio.
        </p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 28 }}>What looks like a mistake on the plot</h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Guard
          label="most the measured curve exceeds the closed form"
          value={result.overshoot.toFixed(4)}
          level={thresholdLevel(result.overshoot, 0.02)}
          detail="a lens cannot beat its own aperture: this is the pupil sampled on a 64-wide grid, so its rim is a staircase, plus the interpolation between frequency bins. It is inside the 0.01 the engine's own closed-form rung allows"
        />
        <Fact label="elapsed" value={`${result.elapsedMs.toFixed(0)} ms`} note="one traced wavefront, one transform, no worker" />
      </div>
    </>
  );
}
