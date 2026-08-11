import { useEffect, useState } from "react";
import {
  describeCatalog,
  LAMBDA_NM,
  MARECHAL_WAVES,
  MICROSCOPE_CATALOG,
  type FrameResult,
} from "../microscope";
import { refusalVoice } from "../refusal";
import { Choice } from "../ui";

/**
 * The microscope substrate — APP.md's A1, and the branch's first app surface.
 *
 * Not a picture: the thing every picture will sit on. One row per objective in
 * the ladder, every number read back off the trace, and the two columns that
 * decide what A2 can show — the crop the frame actually covers on the specimen,
 * and how many resolution cells wide it is.
 *
 * The whole catalogue is traced rather than one selected entry, because the
 * finding worth showing is a *comparison*: three rows share NA 0.10 and cover an
 * identical 93.5 µm while their image pixels scale exactly with magnification.
 * A selector would hide that behind a click.
 *
 * The rows that fail are not omitted. § 6d's measured NA 0.343 wall is a
 * finding, and the engine states it in its own error text — which is the honest
 * thing to put in the cell.
 *
 * **How many fail is read off the table, never asserted beside it.** Three rows
 * were written to fail; § 6b.5.6 re-seeded the doublet solve and one of them
 * builds now, so this table's own cells are the only current answer. Saying a
 * number here would be the failure A1 named when it chose to quote the engine:
 * a fix upstream arrives for nothing, and a wrong sentence arrives the same way.
 */
function MicroscopeTable({ pupilSamples, size }: { pupilSamples: number; size: number }) {
  const [rows, setRows] = useState<readonly FrameResult[] | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setRows(null);
    // Deferred one turn so the "tracing…" state paints first: this is ~400 ms of
    // real ray tracing on the main thread. `render.ts`'s panels earn a worker by
    // being re-run on a slider; this runs on a sampling change and does not.
    const id = setTimeout(() => {
      const started = performance.now();
      const next = describeCatalog(pupilSamples, size);
      setElapsedMs(performance.now() - started);
      setRows(next);
    }, 0);
    return () => clearTimeout(id);
  }, [pupilSamples, size]);

  const cell: React.CSSProperties = { padding: "3px 6px", textAlign: "right", whiteSpace: "nowrap" };
  const head: React.CSSProperties = { ...cell, borderBottom: "1px solid #ccc", color: "#444" };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>objective</th>
            <th style={head}>traced NA</th>
            <th style={head}>traced M</th>
            <th style={head}>crop (µm)</th>
            <th style={head}>cells</th>
            <th style={head}>specimen/px</th>
            <th style={head}>image/px</th>
            <th style={head}>λ/2NA</th>
            <th style={head}>σ axis</th>
            <th style={head}>σ corner</th>
            <th style={head}>drift</th>
            <th style={head}>lost</th>
          </tr>
        </thead>
        <tbody>
          {MICROSCOPE_CATALOG.map((entry, i) => {
            const row = rows?.[i];
            const na = entry.nominalNA;
            const m = entry.nominalMagnification;
            return (
              <tr key={entry.kind} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ ...cell, textAlign: "left" }}>
                  <strong>{entry.label}</strong>
                  <br />
                  <span style={{ color: "#777", fontSize: 11 }}>{entry.note}</span>
                </td>
                {!row ? (
                  <td style={{ ...cell, color: "#999" }} colSpan={11}>
                    tracing…
                  </td>
                ) : !row.ok ? (
                  // The engine's own message, in full. It carries the measured
                  // ceiling; a "not available" would carry nothing.
                  <td style={{ ...cell, textAlign: "left", color: "#c00", whiteSpace: "normal" }} colSpan={11}>
                    {refusalVoice(row.source, "this design")}: {row.error}
                  </td>
                ) : (
                  <>
                    <td style={cell}>
                      {row.readout.tracedNA.toFixed(4)}
                      <br />
                      <span style={{ color: "#777" }}>
                        {relative(row.readout.tracedNA, na)}
                      </span>
                    </td>
                    <td style={cell}>
                      {row.readout.tracedMagnification.toFixed(2)}
                      <br />
                      <span style={{ color: "#777" }}>
                        {relative(Math.abs(row.readout.tracedMagnification), m)}
                      </span>
                    </td>
                    <td style={{ ...cell, fontWeight: 600 }}>{row.readout.objectSpanUm.toFixed(2)}</td>
                    <td style={cell}>{row.readout.resolutionCells.toFixed(1)}</td>
                    <td style={cell}>{row.readout.objectPixelNm.toFixed(1)} nm</td>
                    <td style={cell}>{row.readout.imagePixelUm.toFixed(3)} µm</td>
                    <td style={cell}>{row.readout.abbeResolutionNm.toFixed(0)} nm</td>
                    <td style={{ ...cell, color: row.readout.axisRmsWaves > MARECHAL_WAVES ? "#c00" : "#3a7" }}>
                      {row.readout.axisRmsWaves.toFixed(4)}
                    </td>
                    <td style={{ ...cell, color: row.readout.cornerRmsWaves > MARECHAL_WAVES ? "#c00" : "#3a7" }}>
                      {row.readout.cornerRmsWaves.toFixed(4)}
                    </td>
                    <td style={cell}>{row.readout.scaleDriftPixel.toExponential(1)}</td>
                    <td style={{ ...cell, color: row.readout.cornerLost > 0 ? "#a60" : "#777" }}>
                      {row.readout.cornerLost}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777" }}>
        {rows ? `${elapsedMs.toFixed(0)} ms for the whole catalogue` : "tracing the catalogue…"} ·
        λ = {LAMBDA_NM} nm · drift is what one common ruler costs across the frame · lost is rays
        vignetted at the corner
      </p>
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", maxWidth: 720 }}>
        σ is the RMS wavefront <em>as traced</em>, about its own mean at each system&rsquo;s own
        image plane — no best-focus solve, because that is the wavefront a render will actually see.
        The comparison against Maréchal&rsquo;s λ/14 = {MARECHAL_WAVES.toFixed(4)} waves is therefore
        one-sided: a balanced σ can only be smaller, so <span style={{ color: "#3a7" }}>green</span>{" "}
        means genuinely diffraction-limited and <span style={{ color: "#c00" }}>red</span> means
        &ldquo;not at this focus&rdquo;, not &ldquo;not correctable&rdquo;.
      </p>
    </div>
  );
}

/** "+0.02%" — a traced number against the number on the label. */
function relative(traced: number, nominal: number): string {
  const d = (traced / nominal - 1) * 100;
  if (Math.abs(d) < 0.005) return "= label";
  return `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;
}

export function BenchPanel() {
  // The microscope substrate's two axes. `pupilSamples` IS the frame's width in
  // resolution cells (§ 6h), so it is the only control that widens the crop;
  // `size` buys sampling on that same crop and nothing else.
  //
  // These deliberately do NOT share state with the brightfield panel's pair of
  // the same name. Same engine parameters, different affordable range: this is
  // one catalogue trace on a sampling change, where traced brightfield costs
  // 8–10× per source point and 128/256 would put it seconds past its live line.
  // Routing is what stops the two groups from being confusable; sharing the
  // state would only make one of the two panels lie about its cost.
  const [pupilSamples, setPupilSamples] = useState(32);
  const [size, setSize] = useState(64);

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The microscope bench: what a frame actually covers</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The microscope branch&rsquo;s objectives, every one of them traced. This is not a picture and
        not a view through an eyepiece — it is the <strong>substrate</strong> the pictures will sit
        on, and the number it exists to say out loud is the <strong>crop</strong>: how much specimen
        a rendered frame can hold. A brightfield frame spans <code>pupil samples</code> resolution
        cells and no more, because the illumination sum&rsquo;s grid <em>is</em> its frequency
        lattice — so unlike the star field, it cannot be widened by choosing a coarser pixel.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The <strong>cells</strong> column is that claim, checked: crop ÷ λ/(2·NA), which lands on the
        pupil-sample count to within a percent for every dry objective here. The two immersion rows
        come in ~2.5× under it, and the panel does not paper over the gap — the frame&rsquo;s extent
        carries the wavelength <em>in the medium</em> as well, where λ/(2·NA) is quoted at the vacuum
        wavelength and lets the medium in through NA alone. Their crop is a <em>measurement</em>{" "}
        here, not a derivation; recovering the closed form is a physics question, and this panel adds
        no physics.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        Read the three <strong>NA 0.10</strong> rows together: 4×, 10× and 20× cover an{" "}
        <em>identical</em> 93.5 µm while their image pixels scale exactly with magnification.
        Reaching for a stronger objective does not widen or narrow the crop — only NA moves it, and
        it moves the wrong way, so the objective that resolves best shows least. The 100×/1.40 oil
        holds 2.6 µm. A real 4× shows ~5 mm, so even at 128 samples this is a detail crop by a
        factor of thirteen, and any panel that called it a field of view would be lying.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Choice
          label={`pupil samples ${pupilSamples} — the crop, in resolution cells`}
          options={[32, 64, 128]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice
          label={`grid ${size}² — sampling on that same crop, not more of it`}
          options={[64, 128, 256]}
          value={size}
          onChange={setSize}
        />
      </div>

      <MicroscopeTable pupilSamples={pupilSamples} size={size} />

      <p style={{ marginTop: 16, fontSize: 13, color: "#666", maxWidth: 640 }}>
        Move the grid and watch the crop <em>not</em> change: that is the constraint stated as an
        experiment. Move the pupil samples and it scales exactly, which is the only lever there is.
        A row that carries an error instead of numbers is a design the engine will not build — the
        Lister form has a measured aperture wall, the cemented doublet a focal-ratio ceiling — and
        where it refuses it says so in its own words rather than showing a blank. <strong>How many
        rows do that is whatever the table shows above</strong>: three were written to fail, and
        § 6b.5.6 seeded the doublet solve differently, so the 4×/0.20 that used to be one of them
        now builds. A number written here instead would be the wrong sentence the quoting was meant
        to avoid.
      </p>
    </>
  );
}
