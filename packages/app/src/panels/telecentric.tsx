import { useMemo, useState } from "react";
import { Plot, type PlotMarker, type PlotSeries } from "../plot";
import {
  CURVE_SAMPLES,
  DEFAULT_BAND_NM,
  DESIGN_LINE_NM,
  MAX_BAND_SPAN_NM,
  bandRefusal,
  placeTelecentricStop,
  surveyTails,
  tailOf,
  tails,
  type PlacementChoice,
  type TailId,
} from "../telecentric";
import { refusalVoice } from "../refusal";
import { Choice, Fact, Fieldset, Guard, NumberField, num } from "../ui";

/**
 * The stop that is a millimetre — `designs/telecentric`'s first surface.
 *
 * One plot and three tables. The plot is the whole argument: FFD(λ), the front
 * focal distance the stop has to sit at, drawn across the band, with the chosen
 * placement as a horizontal line across it. Every wavelength where the line
 * meets the curve is a wavelength the system is image-space telecentric at, so
 * "a curve with k turns meets a line at most k+1 times" stops being an assertion
 * and becomes something a reader counts off the picture.
 *
 * **Two controls, not one list of presets.** `designs/telecentric` refuses to
 * fuse the lens and the placement and says why — § 6aq measured that they are
 * independent knobs — so the tail and the placement are separate here and every
 * combination is reachable, including the ones that refuse. A reader who picks
 * "turn" on the singlet gets the engine's own sentence about why a monotone
 * curve has no turn to place at, which is the most useful thing this page can
 * say about what a second glass buys.
 *
 * **The survey table runs all four tails on every frame** (~25 ms total). That
 * is § 6ah's lesson rather than a citation of it: every rung §§ 6ak–6aq built
 * ran on one tail, and each of them hid something the next one found. A page
 * about how many colours a stop can be telecentric at, showing one lens, would
 * be repeating the mistake in a nicer font.
 */

const PLACEMENT_KINDS = ["frontFocal", "turn", "distance"] as const;
type PlacementKind = (typeof PLACEMENT_KINDS)[number];

const PLACEMENT_LABEL: Record<PlacementKind, string> = {
  frontFocal: "at FFD(λ₀)",
  turn: "at a turn",
  distance: "at a distance",
};

const LIMIT_NOTE: Record<"search" | "arithmetic" | "round trip", string> = {
  search: "the spread of the same search from five brackets",
  arithmetic: "what a double can carry at this slope — 53·ε ÷ |dFFD/dλ|",
  "round trip": "how far the search missed the wavelength the stop was BUILT at",
};

export function TelecentricPanel() {
  const [tail, setTail] = useState<TailId>("apochromat");
  const [kind, setKind] = useState<PlacementKind>("frontFocal");
  const [designNm, setDesignNm] = useState(DESIGN_LINE_NM);
  const [turnIndex, setTurnIndex] = useState(0);
  const [distanceMm, setDistanceMm] = useState(53);
  const [fromNm, setFromNm] = useState(DEFAULT_BAND_NM[0]);
  const [toNm, setToNm] = useState(DEFAULT_BAND_NM[1]);

  const placement: PlacementChoice =
    kind === "frontFocal"
      ? { kind: "frontFocal", wavelengthNm: designNm }
      : kind === "turn"
        ? { kind: "turn", index: turnIndex }
        : { kind: "distance", stopToVertexMm: distanceMm };

  // Checked before either call rather than after, because the bound is on the
  // COST of the search and a refusal that arrives from inside one has already
  // been paid for.
  const bandTooWide = bandRefusal([fromNm, toNm]);

  const result = useMemo(
    () =>
      placeTelecentricStop({
        tail,
        placement,
        bandNm: [fromNm, toNm],
        curveSamples: CURVE_SAMPLES,
      }),
    [tail, kind, designNm, turnIndex, distanceMm, fromNm, toNm],
  );
  const survey = useMemo(
    () => (bandTooWide === undefined ? surveyTails([fromNm, toNm]) : []),
    [fromNm, toNm, bandTooWide],
  );
  const chosen = tailOf(tail);

  const series: PlotSeries[] = result.ok
    ? [
        {
          label: "FFD(λ)",
          color: "var(--red)",
          points: result.curve.map(([nm, mm]) => [nm, mm] as const),
          width: 1.6,
        },
      ]
    : [];
  const markers: PlotMarker[] = result.ok
    ? [
        { y: result.stopToVertexMm, color: "var(--accent-2)", label: "the stop is here" },
        // A touched pole gets a word and a crossed one does not: on the triplet
        // there are three of the latter and labelling each would print three
        // copies of the same noun across a 560 px plot.
        ...result.crossings.map((c): PlotMarker =>
          c.order === "double"
            ? { x: c.nm, color: "var(--warn)", label: "touched" }
            : { x: c.nm, color: "var(--green)" },
        ),
      ]
    : [];
  const yValues = result.ok ? result.curve.map(([, mm]) => mm) : [0, 1];
  const yLow = Math.min(...yValues, result.ok ? result.stopToVertexMm : 0);
  const yHigh = Math.max(...yValues, result.ok ? result.stopToVertexMm : 1);
  const yPad = (yHigh - yLow) * 0.08 || 0.01;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The stop that is a millimetre</h1>
      <p style={{ maxWidth: 660, color: "var(--ink-2)" }}>
        A machine-vision telecentric lens is not made telecentric by its glass. It is made
        telecentric by <em>where the aperture stop sits</em>: put the stop on the tail group&rsquo;s
        front focal plane and every chief ray leaves the last surface parallel to the axis, the exit
        pupil goes to infinity, and the image stops changing size when the sensor moves. That plane
        is a distance, and the distance is wavelength-dependent — so a stop at one fixed gap is at a
        front focal point only at the colours where the curve below comes back to the line.
      </p>
      <p style={{ maxWidth: 660, color: "var(--ink-2)" }}>
        This is the first surface in this app for <code>designs/telecentric</code>, which shipped
        with the engine and had no caller anywhere. The lens and the placement are two controls
        rather than one list, because they are two independent choices: the glass decides how many
        times the curve turns, and the placement decides whether a pole is crossed or merely touched.
      </p>

      <Fieldset title="the tail — what the stop sits in front of">
        <Choice
          label="lens"
          options={tails().map((t) => t.id)}
          value={tail}
          onChange={setTail}
          format={(id) => tailOf(id).label}
        />
      </Fieldset>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-4)", margin: "-6px 0 12px" }}>
        {chosen.note}
      </div>

      <Fieldset title="the placement — where the stop goes">
        <Choice
          label="kind"
          options={PLACEMENT_KINDS}
          value={kind}
          onChange={setKind}
          format={(k) => PLACEMENT_LABEL[k]}
        />
        {kind === "frontFocal" && (
          <NumberField label="design wavelength λ₀ (nm)" value={designNm} onChange={setDesignNm} />
        )}
        {kind === "turn" && (
          <NumberField label="turn index (0 = bluest)" value={turnIndex} onChange={setTurnIndex} />
        )}
        {kind === "distance" && (
          <NumberField label="stop to first vertex (mm)" value={distanceMm} onChange={setDistanceMm} />
        )}
      </Fieldset>

      <Fieldset title={`the band searched — a window, not a claim about the lens (at most ${MAX_BAND_SPAN_NM} nm wide)`}>
        <NumberField label="from (nm)" value={fromNm} onChange={setFromNm} />
        <NumberField label="to (nm)" value={toNm} onChange={setToNm} />
      </Fieldset>

      {!result.ok && (
        <p style={{ maxWidth: 660, color: "var(--red)", fontFamily: "var(--mono)", fontSize: 12 }}>
          {refusalVoice(result.source, "this placement")}: {result.error}
        </p>
      )}

      {result.ok && (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <Plot
              series={series}
              markers={markers}
              xLabel="wavelength (nm)"
              yLabel="front focal distance FFD(λ) (mm)"
              xMin={fromNm}
              xMax={toNm}
              yMin={yLow - yPad}
              yMax={yHigh + yPad}
              width={560}
              height={320}
            />
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.8, maxWidth: 320 }}>
              <div style={{ color: "var(--ink-3)", marginBottom: 4 }}>reading the plot</div>
              <div style={{ color: "var(--red)" }}>FFD(λ) — where the stop would have to be, per colour</div>
              <div style={{ color: "var(--accent-2)" }}>the horizontal line — where the stop actually is</div>
              <div style={{ color: "var(--green)" }}>green rule — a crossing: the pole is passed through</div>
              <div style={{ color: "var(--warn)" }}>amber rule — a turn placement: the pole is touched</div>
              <div style={{ marginTop: 12, color: "var(--ink-3)" }}>
                Count the meetings. A curve with <strong>{result.turns.length}</strong>{" "}
                {result.turns.length === 1 ? "turn" : "turns"} inside the band can meet a horizontal
                line at most <strong>{result.crossingBound}</strong>{" "}
                {result.crossingBound === 1 ? "time" : "times"}, and this one meets it{" "}
                <strong>{result.crossings.length}</strong>. That is arithmetic rather than optics,
                and it is where a deferral in the ladder once predicted four crossings from two
                turns — which needs three.
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>The design</h2>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <Fact
              label="stop to first vertex"
              value={`${result.stopToVertexMm.toFixed(6)} mm`}
              note="the whole design — this gap is the only thing that makes the system telecentric, and it is what a mount has to hold"
            />
            <Fact
              label="design wavelength"
              value={`${num(result.designWavelengthNm, 4)} nm`}
              note={
                kind === "turn"
                  ? "the wavelength FFD(λ) turns at — the stop is at the value the curve reaches rather than one it passes through"
                  : "the colour the placement was computed at"
              }
            />
            <Fact
              label="image distance"
              value={`${result.imageDistanceMm.toFixed(4)} mm`}
              note="last vertex to the image plane, the tail's own paraxial back focal distance at the design wavelength"
            />
            {result.placementGapMm !== undefined && (
              <Fact
                label="the two placements, apart"
                value={`${(Math.abs(result.placementGapMm) * 1000).toFixed(2)} µm`}
                note={
                  tail === "achromat"
                    ? "FFD(λ₀) against the first turn, computed live from a second call. This is the 3.8 µm the ladder calls the entire design decision — the difference between a pole that reverses the defocus and one that does not, on the lens it says it about"
                    : "FFD(λ₀) against the first turn, computed live from a second call — how far the mount moves between a pole that reverses the defocus and one that does not. The ladder's own case is the achromat, where this reads 3.8 µm; this is a different lens and a different number"
                }
              />
            )}
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>
            Telecentric at {result.crossings.length}{" "}
            {result.crossings.length === 1 ? "wavelength" : "wavelengths"}
          </h2>
          {/* Withdrawn when the list is empty rather than left standing over
              nothing: a paragraph about how the digits below were measured, with
              no digits below it, describes a table that is not there. */}
          {result.crossings.length > 0 && (
            <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14 }}>
              Every digit below is measured. Three different things limit how well a wavelength here
              can be known, and the coarsest of them wins: how far five brackets of the same search
              disagreed, what a double can carry when the curve crosses this shallowly, and — where
              the placement built a root on purpose — how far the search missed the answer it was
              guaranteed. Digits past the number in the ± column belong to the bracket, not to the
              lens.
            </p>
          )}
          <table style={{ fontFamily: "var(--mono)", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--ink-4)", textAlign: "left" }}>
                <th style={{ padding: "2px 16px 2px 0" }}>wavelength (nm)</th>
                <th style={{ padding: "2px 16px 2px 0" }}>± (nm)</th>
                <th style={{ padding: "2px 16px 2px 0" }}>limited by</th>
                <th style={{ padding: "2px 16px 2px 0" }}>pole</th>
              </tr>
            </thead>
            <tbody>
              {result.crossings.map((c) => (
                <tr key={c.nm}>
                  <td style={{ padding: "2px 16px 2px 0" }}>{c.text}</td>
                  <td style={{ padding: "2px 16px 2px 0", color: "var(--ink-4)" }}>
                    {c.uncertaintyNm.toExponential(1)}
                  </td>
                  <td style={{ padding: "2px 16px 2px 0", color: "var(--ink-4)" }}>{c.limitedBy}</td>
                  <td
                    style={{
                      padding: "2px 16px 2px 0",
                      color: c.order === "double" ? "var(--warn)" : "var(--green)",
                    }}
                  >
                    {c.order === "double" ? "touched (double)" : "crossed (simple)"}
                  </td>
                </tr>
              ))}
              {result.crossings.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "2px 0", color: "var(--ink-4)" }}>
                    none — this stop is at a front focal point nowhere in the band. That is a
                    finding, not a refusal: the gap is a perfectly buildable one, and no colour
                    reaches it.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-5)", marginTop: 6 }}>
            {Array.from(new Set(result.crossings.map((c) => c.limitedBy))).map((limit) => (
              <div key={limit}>
                {limit} — {LIMIT_NOTE[limit]}
              </div>
            ))}
          </div>

          {result.crossings.some((c) => c.order === "double") &&
            result.crossings.some((c) => c.order === "simple") && (
              <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14, marginTop: 12 }}>
                <strong>The band still reverses.</strong> A stop at a turn touches that pole rather
                than passing through it, so the defocus does not change direction there — and on a
                tail whose curve turns twice it comes back down to the same level further red, where
                the pole <em>is</em> crossed. A readout that gave one answer for the whole design
                would say &ldquo;double&rdquo; here and mean it about one wavelength of two.
              </p>
            )}

          {result.turns.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 28 }}>Where the curve turns</h2>
              <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14 }}>
                These bound the count above, and they are known far less precisely than the
                crossings are — four orders less. Locating a smooth extremum is a{" "}
                <em>square-root-of-epsilon</em> business: near a turn the curve is flat, so
                wavelengths a long way apart give focal distances a double cannot tell apart. A
                crossing is a sign change and is located far better. Two searches, two precisions,
                and quoting one to the other&rsquo;s digits is a mistake this ladder has already
                made and corrected.
              </p>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                {result.turns.map((t, i) => (
                  <Fact
                    key={t.nm}
                    label={`turn ${i}`}
                    value={`${t.text} ± ${t.uncertaintyNm.toExponential(1)} nm`}
                    note={LIMIT_NOTE[t.limitedBy]}
                  />
                ))}
              </div>
            </>
          )}

          {result.designWavelengthMissNm !== undefined &&
            result.designWavelengthFloorNm !== undefined && (
              <>
                <h2 style={{ fontSize: 16, marginTop: 28 }}>The check the placement gives for free</h2>
                <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14 }}>
                  The stop went to FFD(λ₀), so λ₀ <em>is</em> a root of &ldquo;FFD(λ) minus the
                  placement&rdquo; by construction. It has to come back as one of the crossings, and
                  how far off it comes back is a measured error against a known answer rather than an
                  estimate of one — which is the only honest way to price a search that has no
                  external number behind it.
                </p>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <Guard
                    label="the search misses λ₀ by"
                    value={`${result.designWavelengthMissNm.toExponential(2)} nm`}
                    level={result.designWavelengthMissNm < 1e-6 ? "ok" : "warn"}
                    detail="a wavelength the placement guarantees is a crossing, found again by bisecting for it. Picometres at worst, and it is the number the ± column above uses wherever it is the largest of the three limits"
                  />
                  <Fact
                    label="the arithmetic floor there"
                    value={`${result.designWavelengthFloorNm.toExponential(2)} nm`}
                    note="53·ε divided by the slope the curve crosses at — what a double can carry, evaluated live rather than quoted"
                  />
                  <Fact
                    label="miss ÷ floor"
                    value={(result.designWavelengthMissNm / result.designWavelengthFloorNm).toFixed(
                      1,
                    )}
                    note="above one, so the floor is a lower bound on the error and not an estimate of it: a page quoting the floor as the precision would be over-quoting by this factor"
                  />
                </div>
              </>
            )}
        </>
      )}

      <h2 style={{ fontSize: 16, marginTop: 28 }}>Every tail, not the one that makes the point</h2>
      {bandTooWide !== undefined && (
        <p style={{ maxWidth: 660, color: "var(--red)", fontFamily: "var(--mono)", fontSize: 12 }}>
          {refusalVoice("app", "this band")}: {bandTooWide}
        </p>
      )}
      <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14 }}>
        Each rung that built this capability ran on a single lens, and each of them hid something the
        next one found — a page about how many colours a stop can serve, showing one lens, would be
        repeating that. So all four run on every frame. The bound column is the arithmetic; the
        crossings column is what the lens actually does, and the two are not the same number on the
        last row.
      </p>
      <table style={{ fontFamily: "var(--mono)", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--ink-4)", textAlign: "left" }}>
            <th style={{ padding: "2px 16px 2px 0" }}>tail</th>
            <th style={{ padding: "2px 16px 2px 0" }}>turns</th>
            <th style={{ padding: "2px 16px 2px 0" }}>crossings</th>
            <th style={{ padding: "2px 16px 2px 0" }}>bound</th>
            <th style={{ padding: "2px 16px 2px 0" }}>a turn placement</th>
          </tr>
        </thead>
        <tbody>
          {survey.map((row) => (
            <tr key={row.tail} style={{ background: row.tail === tail ? "var(--bg-2)" : undefined }}>
              <td style={{ padding: "2px 16px 2px 0" }}>{row.label}</td>
              <td style={{ padding: "2px 16px 2px 0" }}>{row.turns}</td>
              <td style={{ padding: "2px 16px 2px 0" }}>{row.crossings}</td>
              <td
                style={{ padding: "2px 16px 2px 0", color: row.boundReached ? "var(--ink)" : "var(--warn)" }}
              >
                {row.bound}
                {row.boundReached ? "" : " (not reached)"}
              </td>
              <td style={{ padding: "2px 16px 2px 0", color: row.turnPlacement.ok ? "var(--ink)" : "var(--red)" }}>
                {row.turnPlacement.ok
                  ? `${(Math.abs(row.turnPlacement.gapMm) * 1000).toFixed(2)} µm away — ${row.turnPlacement.orders.join(", ")}`
                  : `${refusalVoice(row.turnPlacement.source, "it")}: ${row.turnPlacement.error.replace(/^telecentricStop: /, "")}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ maxWidth: 660, color: "var(--ink-2)", fontSize: 14, marginTop: 12 }}>
        The refusal in the last column is the engine&rsquo;s own sentence, and it is worth reading:
        the singlet has no turn to place at because its front focal distance is{" "}
        <em>monotone across the visible</em>. That is a fact about the glass, not about the request,
        and no index a caller passes can fix it. It is also the clearest statement on this page of
        what the second and third glasses buy — not sharpness, but another colour the same
        millimetre can serve.
      </p>
      {result.ok && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-5)", marginTop: 12 }}>
          {result.elapsedMs.toFixed(1)} ms for this placement, inline — no worker. The four-row
          survey above is recomputed on every frame rather than quoted.
        </p>
      )}
    </>
  );
}
