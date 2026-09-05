import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { chromaticShift, BAND_NM, CROSSING_LINES } from "../chromatic";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import { FOCUS_NM } from "../render";
import { linkHref } from "../teaching";
import type { PanelProps } from "./registry";

/**
 * Chromatic focal shift — APP.md Part H, and the plot ROADMAP step 7 names for
 * the purple fringe.
 *
 * Two plots, because the halo takes two facts to explain and either one alone is
 * a half-truth. The upper plot is **where each colour focuses**, first-order and
 * exact. The lower one is **how big the blur is at the single plane the picture
 * was taken on**, traced ray by ray — which is the halo itself, in millimetres.
 *
 * Both lenses are always drawn even when the link named one, because the image
 * that sends readers here is itself a comparison: an achromat's curve is only
 * remarkable next to the singlet's.
 *
 * No worker here either, for the ray fan panel's measured reason — see the note
 * at the foot of this panel and the elapsed number beside it.
 */

const APERTURE = { min: 4, max: 20, step: 1 };
/** Steps that keep the focus wavelength on a sample where they can. */
const STEP_NM = [20, 10, 5] as const;
const PUPIL = [17, 21, 33] as const;

const LENS_COLOR = { singlet: "var(--red)", achromat: "#2b5fd9" } as const;

export function ChromaticPanel({ link, linkBroken }: PanelProps) {
  const [aperture, setAperture] = useState(link?.apertureMm ?? 10);
  const [stepNm, setStepNm] = useState<(typeof STEP_NM)[number]>(10);
  const [pupilSamples, setPupilSamples] = useState<(typeof PUPIL)[number]>(21);
  const focalLengthMm = link?.focalLengthMm ?? 100;
  const sourceTemperatureK = link?.sourceTemperatureK ?? 5800;
  const wavelengths = link?.wavelengths ?? 9;

  const result = useMemo(
    () =>
      chromaticShift({
        focalLengthMm,
        apertureMm: aperture,
        sourceTemperatureK,
        wavelengths,
        samples: Math.round((BAND_NM.max - BAND_NM.min) / stepNm) + 1,
        pupilSamples,
      }),
    [focalLengthMm, aperture, sourceTemperatureK, wavelengths, stepNm, pupilSamples],
  );

  const shiftSeries: PlotSeries[] = result.curves.map((curve) => ({
    label: curve.lens,
    color: LENS_COLOR[curve.lens],
    points: curve.points.map((p) => [p.nm, p.focusShiftMm] as const),
    dots: true,
  }));
  const spotSeries: PlotSeries[] = result.curves.map((curve) => ({
    label: curve.lens,
    color: LENS_COLOR[curve.lens],
    points: curve.points.map((p) => [p.nm, p.rmsSpotMm * 1000] as const),
    dots: true,
  }));

  const shiftBound = Math.max(
    ...result.curves.flatMap((c) => c.points.map((p) => Math.abs(p.focusShiftMm))),
  );
  const spotBound = Math.max(...result.curves.flatMap((c) => c.points.map((p) => p.rmsSpotMm)));
  const singlet = result.curves[0]!;
  const achromat = result.curves[1]!;
  const lost = Math.max(...result.curves.map((c) => c.lost));

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Where each colour focuses, and what it costs</h1>
      {linkBroken && (
        <p style={{ color: "var(--bad)", fontFamily: "var(--mono)", fontSize: 12 }}>
          The link that opened this page did not decode, so these are the panel&rsquo;s own
          defaults and <strong>not</strong> the image you came from. Set the aperture yourself, or
          go back and click the artifact again.
        </p>
      )}
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        The violet halo around the singlet&rsquo;s star is not &ldquo;the blue focuses somewhere
        else&rdquo;. It is <em>the blue focuses somewhere else <strong>and the sensor is not
        there</strong></em>, and it takes both plots to say so. Above: where each wavelength&rsquo;s
        image plane actually is, as a distance from the one plane the picture was taken on. Below:
        how big that colour&rsquo;s blur is <em>at that plane</em> — a traced spot, not the first
        plot&rsquo;s arithmetic, which is why the middle of the band does not go to zero.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Slider
          label={`aperture ${aperture.toFixed(0)} mm (f/${(focalLengthMm / aperture).toFixed(1)})`}
          {...APERTURE}
          value={aperture}
          onChange={setAperture}
        />
        <Choice
          label="sample every"
          options={STEP_NM}
          value={stepNm}
          onChange={setStepNm}
          format={(v) => `${v} nm`}
        />
        <Choice label="pupil grid" options={PUPIL} value={pupilSamples} onChange={setPupilSamples} />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 14, fontFamily: "var(--mono)", margin: "0 0 4px" }}>
            the cause — where the colour focuses
          </h2>
          <Plot
            series={shiftSeries}
            markers={[
              { y: 0, color: "var(--ink)", label: "the plane the picture is on" },
              { x: CROSSING_LINES.F, color: "var(--ink-5)", label: "F" },
              { x: CROSSING_LINES.C, color: "var(--ink-5)", label: "C" },
            ]}
            xLabel="wavelength (nm)"
            yLabel="focus, from the picture's plane (mm)"
            xMin={BAND_NM.min}
            xMax={BAND_NM.max}
            yMin={-shiftBound * 1.15}
            yMax={shiftBound * 1.15}
          />
        </div>
        <div>
          <h2 style={{ fontSize: 14, fontFamily: "var(--mono)", margin: "0 0 4px" }}>
            the effect — the blur there, traced
          </h2>
          <Plot
            series={spotSeries}
            markers={[
              { y: result.airyRadiusMm * 1000, color: "var(--ok)", label: "Airy radius" },
              { x: FOCUS_NM, color: "var(--ink-5)", label: "focused at" },
            ]}
            xLabel="wavelength (nm)"
            yLabel="RMS spot radius (µm)"
            xMin={BAND_NM.min}
            xMax={BAND_NM.max}
            yMin={0}
            yMax={spotBound * 1150}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16 }}>
        <Fact
          label="singlet — focus spread over the band"
          value={`${singlet.focusSpreadMm.toFixed(3)} mm`}
          note={`worst blur ${singlet.worstSpotAiryRadii.toFixed(1)} Airy radii`}
        />
        <Fact
          label="achromat — focus spread over the band"
          value={`${achromat.focusSpreadMm.toFixed(3)} mm`}
          note={`worst blur ${achromat.worstSpotAiryRadii.toFixed(2)} Airy radii`}
        />
        <Fact
          label="what the second glass bought"
          value={`${(singlet.focusSpreadMm / achromat.focusSpreadMm).toFixed(1)}×`}
          note="on focus spread — the flint is not adding power, it is cancelling dispersion"
        />
        <Fact
          label={`the ${FOCUS_NM} nm paraxial plane`}
          value={`${(achromat.atFocusWavelength.focusShiftMm * 1000).toFixed(0)} µm`}
          note="off the picture's plane, on the achromat — and that gap is not chromatic; see below"
        />
        <Guard
          label="rays lost in the sweep"
          value={String(lost)}
          level={thresholdLevel(lost, 1, 0.5)}
          detail={
            lost === 0 ? "every ray reached the image plane" : "some rays did not reach the image"
          }
        />
        <Fact label="traced in" value={`${result.elapsedMs.toFixed(0)} ms`} note="on this thread" />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Three things in these curves</h2>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        <strong>The singlet&rsquo;s curve never turns.</strong> Focus marches steadily from the
        violet end to the red — 2.8 mm across this band at any aperture, because where a colour
        focuses is a property of the glass and not of how much of it you let through. Every colour
        but one is out of focus, and the one is a knife edge.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        <strong>The achromat&rsquo;s curve has a bottom.</strong> It comes down from the violet,
        turns near 540 nm, and climbs again into the red — so for most of the band there are{" "}
        <em>two</em> wavelengths sharing one focus, one either side of the turn. That is the whole
        trick, and it is why the residual is called secondary spectrum rather than error: 0.25 mm
        against the singlet&rsquo;s 2.8. Between the F and C lines specifically — the two the design
        equalizes — the two foci land 55 µm apart against the singlet&rsquo;s 1 545, which is 28×.
        Not zero, and the reason it is not is worth knowing: the powers are solved from the
        catalogue&rsquo;s Abbe numbers in the thin-lens sense, and what this app traces is the real
        thick lens.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        <strong>And the curve does not cross zero where you would bet it does.</strong> The picture
        is focused at {FOCUS_NM} nm, so the natural guess is that the {FOCUS_NM} nm point sits on the
        black line. It does not — it is{" "}
        {(achromat.atFocusWavelength.focusShiftMm * 1000).toFixed(0)} µm off on the achromat and{" "}
        {(singlet.atFocusWavelength.focusShiftMm * 1000).toFixed(0)} µm on the singlet. Nothing is
        wrong: this plot draws the <em>paraxial</em> focus, the plane where rays near the axis cross,
        while the image is focused on the plane of least wavefront error, which is a compromise the
        marginal rays get a vote in. The gap between them is spherical aberration, measured, in the
        same millimetres — and it is why the lower plot&rsquo;s minimum is not zero either.
      </p>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        No web worker on this route. The sweep is {Math.round((BAND_NM.max - BAND_NM.min) / stepNm) + 1}{" "}
        first-order solves and the same number of traced spots per lens, and it lands in{" "}
        <strong>{result.elapsedMs.toFixed(0)} ms</strong> in the built app — see the ray fan panel
        for the full version of this argument, including why a number read off the dev server is not
        the measurement, and treat a growing number here as it stopping being true.
      </p>

      <p style={{ marginTop: 16, fontSize: 13 }}>
        <a href={`#${link?.from ?? "telescope"}`}>← back to the star this explains</a>
        {" · "}
        <a
          href={linkHref("rayfan", {
            lens: link?.lens ?? "achromat",
            focalLengthMm,
            apertureMm: aperture,
            sourceTemperatureK,
            wavelengths,
            // `||` and not `??`, and the difference is the whole link: a reader
            // who came from the STAR image arrives with fieldDeg 0, because that
            // image is on axis and honestly says so. Carrying the zero through
            // would open the fan where coma is absent by symmetry — a correct
            // plot of nothing. So an on-axis sender is moved off axis, and the
            // link says it is doing that rather than doing it quietly.
            fieldDeg: link?.fieldDeg || 0.8,
            from: "chromatic",
          })}
        >
          the other artifact: where each ray lands, {link?.fieldDeg ? "at that star" : "off axis"} →
        </a>
      </p>
    </>
  );
}
