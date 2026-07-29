import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { MICROSCOPE_CATALOG, type MicroscopeKind } from "../microscope";
import {
  maxCoherenceParameter,
  type LampKind,
  type SectionReadout,
  type SectionRequest,
  type SectionResult,
} from "../section";
import { SPECIMENS, specimenOf, type SpecimenKind } from "../specimens";
import { Choice, Guard, GUARD_COLOR, Slider, VERDICT_LEVEL } from "../ui";
import { createSectionWorker } from "../workers";

/**
 * The section in colour — APP.md's A9, and the first colour microscopy in the app.
 *
 * Every other microscope panel in this repo is grey, including the stage, and
 * § 6r's polychromatic Abbe sum had **no caller in the app at all** until this
 * one. So the panel's subject is not "the picture is prettier": it is that the
 * colour in it came from the specimen's spectrum and the objective's dispersion,
 * and the only way to show that is to put the *cheap wrong way* next to it.
 *
 * ## The pair
 *
 * Left, the engine's path: one Abbe sum per wavelength, each on its own frame
 * through its own traced pupil, stacked on the bluest plane's ruler, collapsed
 * against the CIE observer. Right, the same planes summed to grey first and then
 * multiplied by the lamp's colour — which is what "render it and tint it" means,
 * and it produces a perfectly plausible stained section.
 *
 * The number under each says which is which without appealing to taste. The
 * tint's chromaticity spread is **zero by construction**, since every pixel is a
 * scalar times one XYZ; the spectral path's is a measurement. That is § 6r.5's
 * rung, drawn, and § 3b's own negative control transplanted into this branch.
 *
 * ## Two sources of colour, and the picker separates them
 *
 * The ruled grid and the diatoms are `neutralSpecimen` — no wavelength anywhere
 * in them — so any hue in their images is the **objective's**. The section
 * carries two invented absorption bands, so its colour is the **specimen's**.
 * Both are measured with the same two numbers, which is the only reason the
 * comparison means anything, and the result corrected this panel's own scoped
 * expectation: on the worst pixel the *neutral* grid spreads further (0.2227
 * against 0.1556), because axial colour is concentrated exactly at an edge and a
 * ruling is nothing but edges. What separates a stain from a fringe is the
 * frame's **mean**: the section moves it 0.0200 off the lamp's white and the
 * grid moves it 0.0010.
 */

/**
 * S's step. Coarser than A2's 0.01 because nothing here turns on a narrow window
 * of S — the panel's claims are about colour, and S only sets how much of the
 * pupil is filled. Each stop is a whole re-render of every wavelength.
 */
const S_STEP = 0.05;

const LAMPS: readonly LampKind[] = ["equal-energy", "tungsten-3200"];
const LAMP_LABEL: Record<LampKind, string> = {
  "equal-energy": "equal energy (§ 3a's white)",
  "tungsten-3200": "tungsten, 3200 K",
};

/** One image of the pair, with the number that says what kind of claim it is. */
function ColourFrame({
  rgba,
  size,
  title,
  note,
  spread,
  meanSpread,
  proof,
}: {
  rgba: Uint8ClampedArray;
  size: number;
  title: string;
  note: string;
  spread: number;
  meanSpread: number;
  /** True when the number below is zero BY CONSTRUCTION rather than by measurement. */
  proof: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = size;
    element.height = size;
    const context = element.getContext("2d");
    if (!context) return;
    // A fresh buffer: `ImageData` takes ownership of what it is given, and this
    // one arrived by structured clone from the worker.
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  }, [rgba, size]);

  return (
    <figure style={{ margin: 0 }}>
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption
        style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, maxWidth: 320 }}
      >
        <strong>{title}</strong>
        <br />
        <span style={{ color: "#666" }}>{note}</span>
        <br />
        hue spread <strong>{spread.toExponential(3)}</strong> worst pixel ·{" "}
        {meanSpread.toExponential(3)} mean
        <br />
        <span style={{ color: proof ? "#06a" : "#111" }}>
          {proof
            ? "zero by construction — one hue times a scalar cannot vary"
            : "measured, on this specimen through this objective"}
        </span>
      </figcaption>
    </figure>
  );
}

/** The per-wavelength table — § 6r.7 is a statement about a plane, not a frame. */
function PlaneTable({ readout }: { readout: SectionReadout }) {
  return (
    <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>
          <th style={{ padding: "2px 10px 2px 0" }}>λ (nm)</th>
          <th style={{ padding: "2px 10px 2px 0" }}>weight</th>
          <th style={{ padding: "2px 10px 2px 0" }}>ruler ratio</th>
          <th style={{ padding: "2px 10px 2px 0" }}>directions</th>
          <th style={{ padding: "2px 10px 2px 0" }}>verdict</th>
        </tr>
      </thead>
      <tbody>
        {readout.planes.map((plane) => (
          <tr key={plane.nm} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "2px 10px 2px 0" }}>
              {plane.nm.toFixed(1)}
              {plane.resampleRatio === 1 ? " ← ruler" : ""}
            </td>
            <td style={{ padding: "2px 10px 2px 0" }}>{plane.weight.toFixed(4)}</td>
            <td style={{ padding: "2px 10px 2px 0" }}>{plane.resampleRatio.toFixed(6)}</td>
            <td style={{ padding: "2px 10px 2px 0" }}>{plane.contributingPoints ?? "—"}</td>
            <td
              style={{
                padding: "2px 10px 2px 0",
                color: GUARD_COLOR[VERDICT_LEVEL[plane.verdict]],
              }}
            >
              {plane.verdict}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SectionPanel() {
  const [kind, setKind] = useState<MicroscopeKind>("din-4x-010");
  const [specimen, setSpecimen] = useState<SpecimenKind>("section");
  const [wavelengths, setWavelengths] = useState(3);
  // 32 / 64 is not a sampling nicety here: § 6r.7's blue plane refuses at 32 on
  // this objective and passes at 64, and 64 costs 17× (812 directions against
  // 208). The panel defaults to the cheap one *and shows the refusal*, because
  // the guard firing is the honest first thing to see.
  const [pupilSamples, setPupilSamples] = useState(32);
  const [size, setSize] = useState(64);
  const [lamp, setLamp] = useState<LampKind>("equal-energy");
  const [sRaw, setS] = useState(0.5);

  // Derived rather than corrected in an effect — a state write chasing a state
  // write is how a slider ends up fighting the finger holding it.
  const reach = maxCoherenceParameter(size, pupilSamples);
  // Negative reach is not "S = 0": the engine refuses an unshifted pupil of this
  // many bins on this grid as well, so there is no condenser at all until the
  // grid grows. Driving the panel is what found that — see `maxCoherenceParameter`.
  const gridHoldsPupil = reach >= 0;
  const maxS = Math.max(0, Math.floor(reach / S_STEP) * S_STEP);
  const s = Math.min(sRaw, maxS);

  const request = useMemo<SectionRequest>(
    () => ({ kind, specimen, pupilSamples, size, wavelengths, coherenceParameter: s, lamp }),
    [kind, specimen, pupilSamples, size, wavelengths, s, lamp],
  );

  const { result, pending } = useLatestFromWorker<SectionRequest, SectionResult>(
    createSectionWorker,
    request,
  );
  const readout = result?.ok ? result.readout : null;
  const entry = specimenOf(specimen);

  return (
    <>
      <h1 style={{ fontSize: 20 }}>A stained section, and the cheap way to fake one</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Every other microscope surface here is grey. This one runs the Abbe sum{" "}
        <strong>once per wavelength</strong> — each on its own frame, through its own traced pupil,
        because a frame&rsquo;s width goes as λ and the images have to be brought onto one ruler
        before they can be added — and integrates colour against the CIE observer while the
        wavelengths are still separate.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Beside it is the implementation that is always tempting: sum the wavelengths into one grey
        image first, then multiply by the lamp&rsquo;s colour. It looks like a stained section. It
        cannot be one — every pixel of it is the same hue at a different brightness, so the number
        under it is <strong>zero because of what it is</strong>, not because the sum came out small.
        The number on the left is a measurement of the same frame. That pair is the whole panel.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The picker separates the two ways an image can have colour. The ruled grid and the diatoms
        contain <em>no wavelength at all</em> — whatever hue survives in their images is the
        objective&rsquo;s own dispersion, which is § 3b&rsquo;s purple fringing arriving in the
        microscope branch on an object with no colour in it. Only the section carries absorption
        bands. Watch the two numbers under the left image: a fringe moves the <em>worst pixel</em>{" "}
        and a stain moves the <em>frame&rsquo;s mean</em> off the lamp&rsquo;s white.
      </p>
      <p style={{ maxWidth: 640, color: "#666", fontSize: 13 }}>
        The two dyes are <strong>invented</strong> — two Gaussian absorption bands with round
        numbers, composing by Beer–Lambert. Real dye spectra are measured data this repo does not
        have, and § 6r lists a rung against a published stain&rsquo;s transmittance as open, so
        nothing on this page is a claim about a real stain. What is being shown is that the{" "}
        <em>path</em> carries a specimen&rsquo;s own spectrum into the image, which is true of any
        spectrum.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <Choice
          label="objective"
          options={MICROSCOPE_CATALOG.map((e) => e.kind)}
          value={kind}
          onChange={setKind}
          format={(k) => MICROSCOPE_CATALOG.find((e) => e.kind === k)!.label}
        />
        <Choice
          label="specimen"
          options={SPECIMENS.map((entry) => entry.kind)}
          value={specimen}
          onChange={setSpecimen}
          format={(k) => specimenOf(k).label}
        />
        <Choice
          label={`wavelengths ${wavelengths} across 400–700 nm`}
          options={[3, 5, 9]}
          value={wavelengths}
          onChange={setWavelengths}
        />
        <Choice label="lamp" options={LAMPS} value={lamp} onChange={setLamp} format={(l) => LAMP_LABEL[l]} />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label={`pupil samples ${pupilSamples} — the blue plane's verdict turns on this`}
          options={[32, 64]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice label={`grid ${size}²`} options={[64, 128]} value={size} onChange={setSize} />
        {/*
          Two ways the slider can have nothing to offer, and they are different
          sentences. A cap of exactly zero leaves the coherent limit, which is a
          real setting. A NEGATIVE reach leaves nothing at all — the grid cannot
          hold this pupil even unshifted — and offering the coherent limit there
          would be the panel promising a render the engine refuses.
        */}
        {!gridHoldsPupil ? (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", maxWidth: 320 }}>
            no condenser fits: a pupil of {pupilSamples} bins needs a grid of at least{" "}
            {pupilSamples + 2}, and this one is {size}. Not even the coherent limit renders —
            raise the grid.
          </p>
        ) : maxS < S_STEP ? (
          <p style={{ fontFamily: "monospace", fontSize: 12, color: "#a60", maxWidth: 320 }}>
            condenser S = 0 — this grid has no room for a pupil shifted at all, so the coherent
            limit is the only condenser it admits. Raise the grid to open it.
          </p>
        ) : (
          <Slider
            label={`condenser S = ${s.toFixed(2)} (grid caps it at ${maxS.toFixed(2)})`}
            min={0}
            max={maxS}
            step={S_STEP}
            value={s}
            onChange={setS}
          />
        )}
      </div>

      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#666", maxWidth: 660 }}>
        {entry.note}
      </p>

      {result === null ? (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777" }}>
          summing over the condenser, once per wavelength…
        </p>
      ) : !result.ok ? (
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#c00", maxWidth: 660 }}>
          the engine refuses this render: {result.error}
        </p>
      ) : (
        <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <ColourFrame
              rgba={readout!.rgbaSpectral}
              size={readout!.size}
              title="colour integrated per wavelength"
              note={`${readout!.planes.length} Abbe sums, stacked on the ${readout!.rulerWavelengthNm.toFixed(0)} nm ruler`}
              spread={readout!.spectralSpread}
              meanSpread={readout!.spectralMeanSpread}
              proof={false}
            />
            <ColourFrame
              rgba={readout!.rgbaTinted}
              size={readout!.size}
              title="the same stack, summed then tinted"
              note="one grey image times the lamp's own colour"
              spread={readout!.tintedSpread}
              meanSpread={readout!.tintedMeanSpread}
              proof
            />
          </div>

          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, maxWidth: 660 }}>
            frame mean ({readout!.meanChromaticity.x.toFixed(4)},{" "}
            {readout!.meanChromaticity.y.toFixed(4)}) · lamp white (
            {readout!.lampChromaticity.x.toFixed(4)}, {readout!.lampChromaticity.y.toFixed(4)}) ·{" "}
            <strong>{readout!.meanFromLamp.toFixed(4)}</strong> apart
            <br />
            <span style={{ color: "#666" }}>
              {entry.neutral
                ? "a neutral specimen removes no colour on average, so this distance is the cast the OPTICS left"
                : "a stain fills the frame, so this distance is the dye — a fleck would move the spread and not the mean"}
            </span>
            <br />
            span {readout!.objectSpanUm.toFixed(1)} µm — § 6h&rsquo;s crop at the{" "}
            <strong>ruler</strong> wavelength, so a colour frame is narrower than the same
            objective&rsquo;s d-line frame by λ_blue/λ_d · crop {readout!.croppedPixels} px per side
            <br />
            spread measured over {readout!.measuredPixels} interior px ({readout!.darkPixels} too
            dark to have a hue) · {readout!.sourcePoints} illumination directions ·{" "}
            {readout!.elapsedMs.toFixed(0)} ms
            <Guard
              label={`worst plane — ${readout!.verdictNm.toFixed(0)} nm`}
              value={readout!.verdict}
              level={VERDICT_LEVEL[readout!.verdict]}
              detail={readout!.verdictReason}
            />
            {readout!.verdict === "no-honest-image" && pupilSamples < 64 ? (
              <p style={{ color: "#c00", maxWidth: 640 }}>
                § 6r.7, on screen: the blue end is the worst-resolved plane by 2.56× where λ alone
                would give 1.22, so it is the first to run out of pupil lattice. Raising{" "}
                <strong>pupil samples</strong> to 64 clears it — and costs about 17×, because the
                commensurate condenser&rsquo;s direction count goes with it.
              </p>
            ) : null}
          </div>

          <div style={{ marginTop: 12 }}>
            <PlaneTable readout={readout!} />
          </div>
        </div>
      )}

      <p style={{ maxWidth: 660, color: "#444", marginTop: 16 }}>
        Two things this panel does not do. There is no polychromatic{" "}
        <strong>mosaic</strong> — the useful span of a tile is ∝ λ, so § 6o&rsquo;s pitch and guard
        band would each need one reference wavelength chosen, and that is an engine step rather
        than a control. And the lamp is not a light <em>budget</em>: the source weights are
        normalized, so closing S costs resolution and never brightness, exactly as the brightfield
        panel says.
      </p>
    </>
  );
}
