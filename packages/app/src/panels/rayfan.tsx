import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { rayFan, FAN_LINES } from "../rayfan";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import { linkHref } from "../teaching";
import type { LensKind } from "../render";
import type { PanelProps } from "./registry";

/**
 * The ray fan — APP.md Part H, and the plot ROADMAP step 7 names for the coma
 * flare.
 *
 * ## What is different about this panel
 *
 * Every other surface in this app is reached from the nav row and starts from
 * its own defaults. This one is usually reached from a **star**: the reader
 * clicked a comet in the field image and arrived here with that star's field
 * angle and that lens's aperture already in the controls. The link is an initial
 * value — the sliders are this panel's from the first frame — but the arrival
 * state is the sender's, which is the only way the claim "that flare is this
 * curve" can be true rather than merely plausible.
 *
 * ## No worker, and that is a departure this panel has to justify
 *
 * Every panel since A2 traces in a web worker. This one does not, because it
 * measured its cost first: **6–19 ms** for three wavelengths × two fans at 21–81
 * rays, against ~550 ms for the bench catalogue and ~2 s for a brightfield
 * frame. A worker exists to keep a slow trace off the thumb of a slider; posting
 * a 6 ms job across a thread boundary adds latency to hide none. APP.md's rule
 * for a panel that breaks a house convention is that it says why on screen, and
 * the elapsed number is on screen for exactly that reason — if it ever grows, the
 * justification is visibly gone.
 */

const APERTURE = { min: 4, max: 20, step: 1 };
const FIELD = { min: 0, max: 1.2, step: 0.01 };
const RAY_COUNTS = [21, 41, 81] as const;

/** µm, from mm — a fan's whole subject is a few of them. */
const µm = (mm: number) => mm * 1000;

export function RayFanPanel({ link, linkBroken }: PanelProps) {
  const [lens, setLens] = useState<LensKind>(link?.lens ?? "achromat");
  const [aperture, setAperture] = useState(link?.apertureMm ?? 10);
  // `??` and not `||` here, which is the opposite choice from the outbound link
  // in `chromatic.tsx` and is deliberate: a link that says field 0 means the
  // reader clicked an on-axis image, and seeding 0.8 instead would answer a
  // question they did not ask. The panel handles the empty case by naming it —
  // see the on-axis notice below — rather than by avoiding it.
  const [fieldDeg, setFieldDeg] = useState(link?.fieldDeg ?? 0.8);
  const [rays, setRays] = useState<(typeof RAY_COUNTS)[number]>(41);
  const focalLengthMm = link?.focalLengthMm ?? 100;
  const sourceTemperatureK = link?.sourceTemperatureK ?? 5800;
  const wavelengths = link?.wavelengths ?? 9;

  const result = useMemo(
    () =>
      rayFan({
        lens,
        focalLengthMm,
        apertureMm: aperture,
        sourceTemperatureK,
        wavelengths,
        fieldDeg,
        rays,
      }),
    [lens, focalLengthMm, aperture, sourceTemperatureK, wavelengths, fieldDeg, rays],
  );

  const airy = µm(result.airyRadiusMm);
  const series = (which: "tangential" | "sagittal"): PlotSeries[] =>
    result.curves.map((curve) => ({
      label: curve.name,
      color: curve.color,
      points: curve[which].map(([rho, mm]) => [rho, µm(mm)] as const),
      dots: true,
    }));

  // One scale for both plots, so the sagittal fan's flatness is a fact about the
  // lens rather than an artifact of its axis having been rescaled to fill.
  const span = Math.max(
    airy,
    ...result.curves.flatMap((c) =>
      [...c.tangential, ...c.sagittal].map(([, mm]) => Math.abs(µm(mm))),
    ),
  );
  const bound = span * 1.15;

  const d = result.curves[1]!;
  const comaAiry = d.evenPeakMm / result.airyRadiusMm;
  const lost = Math.max(...result.curves.map((c) => c.lost));

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Where each ray in the pupil lands</h1>
      {linkBroken && (
        <p style={{ color: "var(--bad)", fontFamily: "var(--mono)", fontSize: 12 }}>
          The link that opened this page did not decode, so these are the panel&rsquo;s own
          defaults and <strong>not</strong> the image you came from. Set the lens, aperture and
          field yourself, or go back and click the artifact again.
        </p>
      )}
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        A ray fan is the one picture in this app where an aberration is laid out against the thing
        that <em>causes</em> it — position in the pupil — instead of summed over the pupil the way a
        spot, a PSF or an image is. Each curve is one wavelength: the horizontal axis is where the
        ray entered the pupil, from one rim (−1) through the centre to the other (+1), and the
        vertical axis is how far it missed the chief ray at the image plane.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        Read it by symmetry. <strong>Defocus</strong> is a straight line. <strong>Spherical
        aberration</strong> is a cubic and it is <em>odd</em> — the ray from +ρ and the ray from −ρ
        miss by the same amount in opposite directions, so they still straddle a centre.{" "}
        <strong>Coma is the even half</strong>: both rim rays miss on the <em>same</em> side, and
        half a pupil&rsquo;s worth of light piled to one side of the chief ray is not a disc, it is
        a comet. That is the flare in the star field, and this is the number under it.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice label="lens" options={["singlet", "achromat"] as const} value={lens} onChange={setLens} />
        <Slider
          label={`aperture ${aperture.toFixed(0)} mm (f/${(focalLengthMm / aperture).toFixed(1)})`}
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
          label="rays across the pupil"
          options={RAY_COUNTS}
          value={rays}
          onChange={setRays}
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 14, fontFamily: "var(--mono)", margin: "0 0 4px" }}>
            tangential — the plane the field lies in
          </h2>
          <Plot
            series={series("tangential")}
            markers={[
              { y: airy, color: "var(--ink-5)", label: "Airy radius" },
              { y: -airy, color: "var(--ink-5)" },
            ]}
            xLabel="pupil coordinate ρ"
            yLabel="miss from chief ray (µm)"
            xMin={-1}
            xMax={1}
            yMin={-bound}
            yMax={bound}
          />
        </div>
        <div>
          <h2 style={{ fontSize: 14, fontFamily: "var(--mono)", margin: "0 0 4px" }}>
            sagittal — the plane across it
          </h2>
          <Plot
            series={series("sagittal")}
            markers={[
              { y: airy, color: "var(--ink-5)", label: "Airy radius" },
              { y: -airy, color: "var(--ink-5)" },
            ]}
            xLabel="pupil coordinate ρ"
            yLabel="miss from chief ray (µm)"
            xMin={-1}
            xMax={1}
            yMin={-bound}
            yMax={bound}
          />
        </div>
      </div>

      {fieldDeg === 0 && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--warn)", maxWidth: 640 }}>
          You are on the axis, so the even half below is a floor and not a measurement — an axially
          symmetric lens has no coma there, and a fan that looks empty of it is the panel working.
          Walk the field slider out to see the quantity this page is about.
        </p>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16 }}>
        <Fact
          label="coma — even half of the d fan"
          value={`${µm(d.evenPeakMm).toFixed(2)} µm`}
          note={`${comaAiry.toFixed(2)} Airy radii · piles ${d.evenRimSign < 0 ? "toward the axis" : "away from the axis"}`}
        />
        <Fact
          label="spherical + defocus — odd half"
          value={`${µm(d.oddPeakMm).toFixed(2)} µm`}
          note="what is left when the two rim rays cancel"
        />
        <Fact
          label="Airy radius at the d line"
          value={`${airy.toFixed(2)} µm`}
          note={`f/${result.fNumber.toFixed(1)} — diffraction's own scale`}
        />
        <Guard
          label="rays lost in the pupil"
          value={String(lost)}
          level={thresholdLevel(lost, 1, 0.5)}
          detail={
            lost === 0
              ? "the whole fan survives the trace — no vignetting here"
              : "the fan has a hole in it: those rays did not reach the image, and are not drawn at zero"
          }
        />
        <Fact label="traced in" value={`${result.elapsedMs.toFixed(0)} ms`} note="on this thread — see below" />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>What the two plots say together</h2>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        Put the field slider at zero. The tangential fan becomes an odd curve through the origin and
        the even number above collapses by eleven orders, to about 1e-13 µm. An axially symmetric
        lens cannot tell +ρ from −ρ on its own axis, so coma there is not a small quantity, it is an
        absent one. It is worth knowing why the reading is not the flat zero you would expect from
        that sentence, because the answer is not about the lens: the pupil sampler spells the pair
        either side of centre +0.10000000000000009 and −0.09999999999999998, so those two rays are
        not mirror images but rays at two slightly different heights. Where the sampling{" "}
        <em>is</em> exact — the rim pair, ±1 — the cancellation is bitwise. What is left in the curve is the odd
        cubic: spherical aberration, 0.66 µm on the achromat at f/10 against an Airy radius of 7.17.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        Now walk the field out. The even half appears and grows in proportion to the field angle —
        7.67 µm at 1.13° on the achromat at f/10, which is 1.07 Airy radii and therefore a comet you
        can see rather than a coefficient. The <strong>sagittal</strong> fan stays even-free at every
        field — the same floor, at every field angle rather than only on axis — and that is the other
        half of the shape: a comatic star is stretched along the direction it sits from the axis and
        not across it.
      </p>
      <p style={{ maxWidth: 640, color: "var(--ink-2)" }}>
        The sign is worth reading rather than assuming. On this achromat the even half is{" "}
        <strong>negative</strong> at the rim, meaning both rim rays land on the side of the chief ray
        nearer the axis — so the tail points <strong>inward</strong>, toward the middle of the frame.
        Two independent measurements agree on that and one printed sentence in this app did not; see
        the star field&rsquo;s own note.
      </p>

      <p style={{ marginTop: 24, fontSize: 13, color: "var(--ink-3)", maxWidth: 640 }}>
        No web worker on this route, which every other tracing panel uses. The reason is the elapsed
        number above: a fan is a few dozen traced rays and lands in{" "}
        <strong>{result.elapsedMs.toFixed(0)} ms</strong>, where the cost of posting the job to a
        thread would be a visible share of the work. If that number ever grows, this paragraph is
        the thing that has stopped being true — <em>in the built app</em>, which is the reading that
        counts. Under the dev server the first trace on a cold route ran 13.8 seconds against the
        build&rsquo;s 45 ms, all of it interpreter warm-up on unbundled modules, and reading this
        justification&rsquo;s own number off a dev page would condemn the decision it supports.
      </p>

      <p style={{ marginTop: 16, fontSize: 13 }}>
        <a href={`#${link?.from ?? "telescope"}`}>← back to the star field this explains</a>
        {" · "}
        <a
          href={linkHref("chromatic", {
            lens,
            focalLengthMm,
            apertureMm: aperture,
            sourceTemperatureK,
            wavelengths,
            fieldDeg,
            from: "rayfan",
          })}
        >
          the other artifact: where each colour focuses →
        </a>
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-5)", fontFamily: "var(--mono)", maxWidth: 640 }}>
        wavelengths drawn: {FAN_LINES.map((l) => `${l.name} ${l.nm.toFixed(1)} nm`).join(" · ")}
      </p>
    </>
  );
}
