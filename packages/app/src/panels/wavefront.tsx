import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { wavefront, TERM_FLOOR_WAVES, WAVEFRONT_LINES } from "../wavefront";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import type { LensKind } from "../render";

/**
 * The Zernike readout — ROADMAP's v1 analyses line, second of the four entries
 * that had no surface.
 *
 * The bar chart is a `Plot` used as a stem plot: one two-point vertical series
 * per term. That is a slight abuse of a line renderer and it is the honest one
 * available — the alternative was a `bars` mode on a file every other panel
 * shares, and a Zernike spectrum is the only thing in the app that wants one.
 * Each stem is drawn at its own Noll index, so the horizontal axis is the basis
 * itself and the gaps are terms this lens does not excite.
 */

const APERTURE = { min: 4, max: 20, step: 1 };
const FIELD = { min: 0, max: 1.6, step: 0.05 };
const TRACE_SAMPLES = [15, 21, 31] as const;
const TERMS = [15, 28, 45] as const;

/** Where Maréchal is conventionally trusted, and this page measures rather than recites. */
const MARECHAL_GOOD = 0.05;

export function WavefrontPanel() {
  const [lens, setLens] = useState<LensKind>("singlet");
  const [aperture, setAperture] = useState(10);
  const [fieldDeg, setFieldDeg] = useState(0);
  const [wavelengthNm, setWavelengthNm] = useState(587.5618);
  const [traceSamples, setTraceSamples] = useState<(typeof TRACE_SAMPLES)[number]>(21);
  const [zernikeTerms, setZernikeTerms] = useState<(typeof TERMS)[number]>(28);

  const result = useMemo(
    () =>
      wavefront({
        lens,
        focalLengthMm: 100,
        apertureMm: aperture,
        sourceTemperatureK: 5800,
        wavelengths: 9,
        fieldDeg,
        wavelengthNm,
        traceSamples,
        zernikeTerms,
      }),
    [lens, aperture, fieldDeg, wavelengthNm, traceSamples, zernikeTerms],
  );

  // Piston is dropped from the picture, not from the fit: it is a constant
  // offset of the whole wavefront and carries no image information, and at this
  // lens it is also the largest coefficient — plotting it would set the scale
  // and flatten every aberration into the axis.
  const drawn = result.terms.filter((t) => t.j >= 2 && Math.abs(t.waves) > TERM_FLOOR_WAVES);
  const stems: PlotSeries[] = drawn.map((t) => ({
    label: `j${t.j}`,
    color: t.j === 4 ? "var(--green)" : t.j <= 3 ? "var(--ink-5)" : "var(--red)",
    points: [
      [t.j, 0],
      [t.j, t.waves],
    ],
    width: 4,
  }));
  const bound = Math.max(1e-4, ...drawn.map((t) => Math.abs(t.waves))) * 1.15;

  const biggest = [...drawn]
    .filter((t) => t.j >= 4)
    .sort((a, b) => Math.abs(b.waves) - Math.abs(a.waves))
    .slice(0, 4);

  const marechalError = Math.abs(result.marechalStrehl - result.tracedStrehl);
  const balancedMiss =
    result.tracedStrehl > 0 ? result.marechalFromBalanced / result.tracedStrehl : 0;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The wavefront, broken into named aberrations</h1>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        Trace the optical path difference across the pupil and fit it to the Zernike basis, and every
        aberration in the lens becomes one number with a name. The basis is orthonormal, so a
        coefficient <em>is</em> that aberration&rsquo;s own share of the RMS error — the terms add in
        quadrature and nothing is double-counted. Each stem below is one term at its Noll index; the
        gaps are terms this lens does not excite.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice label="lens" options={["singlet", "achromat"] as const} value={lens} onChange={setLens} />
        <Slider
          label={`aperture ${aperture.toFixed(0)} mm (f/${(100 / aperture).toFixed(1)})`}
          {...APERTURE}
          value={aperture}
          onChange={setAperture}
        />
        <Slider
          label={`field ${fieldDeg.toFixed(2)}°`}
          {...FIELD}
          value={fieldDeg}
          onChange={setFieldDeg}
        />
        <Choice
          label="wavelength"
          options={WAVEFRONT_LINES.map((l) => l.nm)}
          value={wavelengthNm}
          onChange={setWavelengthNm}
        />
        <Choice
          label="rays across the pupil"
          options={TRACE_SAMPLES}
          value={traceSamples}
          onChange={setTraceSamples}
        />
        <Choice label="terms fitted" options={TERMS} value={zernikeTerms} onChange={setZernikeTerms} />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={stems}
          markers={[{ y: 0, color: "var(--ink-5)" }]}
          xLabel="Noll index j  (green = defocus, grey = tilt, red = aberration)"
          yLabel="coefficient (waves)"
          xMin={1}
          xMax={zernikeTerms + 1}
          yMin={-bound}
          yMax={bound}
          width={520}
        />
        <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ color: "var(--ink-3)", marginBottom: 4 }}>largest terms, piston and tilt aside</div>
          {biggest.map((t) => (
            <div key={t.j}>
              <span style={{ color: "var(--ink-5)" }}>j{String(t.j).padStart(2)}</span>{" "}
              {t.name === "" ? `n=${t.n} m=${t.m}` : t.name}{" "}
              {/* Exponential under 1e-4: four decimals turns a real 8e-5 term
                  into "-0.0000", which reads as a zero the fit did not find. */}
              <strong>
                {t.waves >= 0 ? "+" : ""}
                {Math.abs(t.waves) >= 1e-4 ? t.waves.toFixed(4) : t.waves.toExponential(1)}
              </strong>{" "}
              λ
            </div>
          ))}
          {biggest.length === 0 && <div style={{ color: "var(--ok)" }}>nothing above the floor</div>}
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>
        &ldquo;RMS wavefront error&rdquo; is three different numbers
      </h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <Fact
          label="σ from j≥2 — tilt kept"
          value={`${result.rmsWaves.toFixed(4)} λ`}
          note="the engine's fitRms: piston out, tilt in, because off axis a tilt is a real chief-ray displacement"
        />
        <Fact
          label="σ from j≥4 — tilt out, defocus in"
          value={`${result.strehlRmsWaves.toFixed(4)} λ`}
          note="the one that predicts the Strehl at the plane the image is on"
        />
        <Fact
          label="σ from j≥5 — balanced"
          value={`${result.balancedWaves.toFixed(4)} λ`}
          note="the engine's balancedRms: how good this could be if you refocused"
        />
        <Fact
          label="peak-to-valley"
          value={`${result.ptvWaves.toFixed(3)} λ`}
          note="off the raw traced samples, not off the fit"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>Maréchal against the transform</h2>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Fact
          label="traced Strehl"
          value={result.tracedStrehl.toFixed(4)}
          note="peak over diffraction-limited peak, on the actual FFT — the measurement"
        />
        <Guard
          label="Maréchal on σ(j≥4)"
          value={result.marechalStrehl.toFixed(4)}
          level={thresholdLevel(marechalError, 0.05, 0.4)}
          detail={`exp(−(2πσ)²) — off by ${(marechalError * 100).toFixed(2)} points of Strehl${
            result.strehlRmsWaves > MARECHAL_GOOD
              ? "; σ is past 0.05 λ, where the approximation is known to go"
              : ""
          }`}
        />
        <Guard
          label="the same formula on the balanced σ"
          value={result.marechalFromBalanced.toFixed(4)}
          level={balancedMiss > 1.5 || balancedMiss < 0.67 ? "bad" : "ok"}
          detail={`${balancedMiss.toFixed(2)}× the traced value — this is the convention error, not the approximation`}
        />
        <Guard
          label="fit residual"
          value={`${result.residualWaves.toExponential(2)} λ`}
          level={thresholdLevel(result.residualWaves, 0.01, 0.1)}
          detail={`what ${zernikeTerms} terms could not represent, over ${result.samplesUsed} traced samples`}
        />
        <Guard
          label="rays lost in the pupil"
          value={String(result.lost)}
          level={thresholdLevel(result.lost, 1, 0.5)}
          detail={result.lost === 0 ? "the whole pupil survives the trace" : "vignetting: the fit is over a carved pupil"}
        />
        <Fact label="traced in" value={`${result.elapsedMs.toFixed(0)} ms`} note="on this thread — see below" />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Which σ you pick decides whether the answer is right</h2>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        The Maréchal approximation, Strehl ≈ exp(−(2πσ)²), is the most quoted formula in optical
        tolerancing, and it takes an RMS wavefront error as its input without saying{" "}
        <em>which one</em>. This engine offers two and the right answer is a third. Feeding it each
        in turn and comparing against the transform — different physics, different code, so this is a
        real check and not an algebraic identity — settles it:
      </p>
      <ul style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        <li>
          <strong>Piston and tilt out, defocus kept</strong> is correct. On the achromat at f/10 on
          axis it predicts <strong>0.9962</strong> against a traced <strong>0.9962</strong>.
        </li>
        <li>
          <strong>Keeping tilt</strong> fails off axis, and spectacularly: at f/5 and 0.8° it
          predicts <strong>0.0003</strong> where the transform says <strong>0.4002</strong>. A tilt
          moves a PSF sideways; it does not dim it. The engine keeps tilt in <code>fitRms</code> on
          purpose — off axis it is a real chief-ray displacement, and hiding it would report
          distortion as perfection — so this is the right number for the wrong question.
        </li>
        <li>
          <strong>Removing defocus</strong> fails wherever defocus is genuinely there: the singlet at
          f/10 on axis predicts <strong>0.9633</strong> against a traced <strong>0.1523</strong>, a
          factor of <strong>6.3</strong>. The balanced σ answers &ldquo;how good could this be if you
          refocused&rdquo;, and the PSF is at the plane the image actually has.
        </li>
      </ul>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        And where even the correct σ runs out is the classical validity limit, measured here rather
        than recited: four digits of agreement below about <strong>0.05 λ</strong>, 32% out at 0.20 λ,
        and at 0.93 λ — the singlet wide open — the formula returns{" "}
        <strong>0.0000</strong> while the transform still finds <strong>0.0886</strong>. An
        approximation declaring a dead image for a lens that still has a ninth of its light in the
        core is a good place to stop trusting it.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>What the basis could not represent</h2>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        The residual is the part of the traced wavefront the fitted terms cannot express, and it
        matters because the PSF is built from the <em>fit</em> and not from the trace. On these
        lenses it is tiny — 5e-7 λ on the achromat at f/10 — and the reason is stated in the
        engine&rsquo;s own fidelity note: spherical aberration is exactly a low-order,
        rotationally-symmetric term, so the basis represents it perfectly however strong it gets. A
        residual that climbs is the signal that the wavefront being transformed has stopped being the
        wavefront that was traced, which is why it is a guard here and not a footnote.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        One thing to know before reading a small stem as physics. Put the singlet on axis, where an
        axially symmetric lens can only have the rotationally symmetric terms, and the others do not
        come back as zero — they come back around <strong>1e-7 λ</strong>. That is the fit leaking
        over a discrete pupil, not a lens with a tilt in it, and two things say so: the x and y
        partners are <em>equal in magnitude</em>, where a real asymmetry would have a direction, and
        the leak grows as roughly the <em>cube</em> of the wavefront where a rounding floor would
        track it. It stays six orders under the terms that are really there, so it changes nothing
        above — but it is why this page does not invite you to read the bottom of the spectrum.
      </p>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        No web worker on this route. One traced pupil and one transform —{" "}
        <strong>{result.elapsedMs.toFixed(0)} ms</strong> — which is the ray fan&rsquo;s bracket
        rather than the spot grid&rsquo;s, because this page traces one field where that one traces
        four. If it grows, this paragraph is what has stopped being true.
      </p>
    </>
  );
}
