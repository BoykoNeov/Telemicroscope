import { useEffect, useMemo, useRef, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import { spotMatrix, SPOT_LINES, type SpotCell } from "../spot";
import { Choice, Fact, Guard, Slider, thresholdLevel } from "../ui";
import type { LensKind } from "../render";

/**
 * The spot diagram — ROADMAP's v1 analyses line, and the only entry on it that
 * is a picture rather than a curve.
 *
 * ## Why this panel does not use `Plot`
 *
 * Every other curve in the app goes through `plot.tsx`, and a spot cell cannot:
 * it needs a **square** aspect, a **reference circle**, and **no per-cell axes**.
 * `Plot`'s padding is fixed and asymmetric (46 px of y-axis against 12), so its
 * drawing area is never square — a scatter through it would be sheared, and the
 * Airy disc, which is the one thing on screen that is exactly round, would draw
 * as an ellipse. Adding an equal-aspect mode and a circle marker to a file every
 * other panel shares, to serve one of them, is the worse trade. The
 * through-focus curve underneath the grid IS a `Plot`, because it is a curve.
 *
 * ## What a reader is meant to do here
 *
 * Read down a column to see an aberration grow with field, and across a row to
 * see it trade against defocus. The two are not independent, and each row has
 * its own best plane — but on this lens that drift is **less than one column**
 * (+0.06 on axis to −0.44 at 1.2°), so the grid cannot show it and the
 * through-focus curve below is where it is legible. An earlier draft of this
 * panel highlighted "the best cell in each row" and was deleted for claiming
 * exactly the thing the display could not resolve; see `SpotCanvas`.
 */

const APERTURE = { min: 4, max: 20, step: 1 };
const FIELD = { min: 0.2, max: 1.6, step: 0.1 };
const GRID_SAMPLES = [11, 15, 21, 31] as const;

/** Cell size in CSS px. Five columns of these plus labels fits a 900 px column. */
const CELL = 116;

/**
 * One cell: the scatter, square, with the Airy disc drawn round it.
 *
 * The Airy circle is drawn UNDER the rays and in grey for `plot.tsx`'s reason —
 * it says where to look and it is not the measurement. It is also the only
 * honest way to read a cell whose scatter is tiny: a dot in the middle of a
 * large grey circle is a lens whose spot diagram has stopped describing it.
 *
 * **Every cell is drawn at full strength, and an earlier draft dimmed all but
 * the one nearest that row's best-focus plane.** Driving the panel killed it for
 * two reasons. The drift this page is about is ±0.44 Rayleigh units and the
 * columns are a whole unit apart, so the highlight sat on the middle column at
 * every field and illustrated nothing; and dimming four cells in five degrades
 * the picture to make a point the through-focus curve underneath already makes
 * properly, on a continuous axis, where the 1.20° parabola's minimum is visibly
 * left of zero. The drift is now a number on each row label and a curve below.
 */
function SpotCanvas({
  cell,
  boundUm,
  airyUm,
}: {
  cell: SpotCell;
  boundUm: number;
  airyUm: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(CELL * dpr);
    element.height = Math.round(CELL * dpr);
    const c = element.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, CELL, CELL);

    // Equal scale on both axes by construction: one `s` for x and y, which is
    // the property `Plot` cannot give this display.
    const s = (CELL / 2 - 1) / boundUm;
    const cx = CELL / 2;
    const cy = CELL / 2;

    c.strokeStyle = "#ddd";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, CELL - 1, CELL - 1);
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx, CELL - 2);
    c.moveTo(2, cy);
    c.lineTo(CELL - 2, cy);
    c.stroke();

    c.strokeStyle = "#bbb";
    c.setLineDash([3, 3]);
    c.beginPath();
    c.arc(cx, cy, airyUm * s, 0, 2 * Math.PI);
    c.stroke();
    c.setLineDash([]);

    for (const cloud of cell.clouds) {
      c.fillStyle = cloud.color;
      for (const [x, y] of cloud.points) {
        // y up, as an image plane is drawn, not as a canvas counts rows.
        c.fillRect(cx + x * s - 0.5, cy - y * s - 0.5, 1.2, 1.2);
      }
    }
  }, [cell, boundUm, airyUm]);

  return <canvas ref={canvas} style={{ width: CELL, height: CELL, display: "block" }} />;
}

export function SpotPanel() {
  const [lens, setLens] = useState<LensKind>("achromat");
  const [aperture, setAperture] = useState(10);
  const [maxFieldDeg, setMaxFieldDeg] = useState(1.2);
  const [gridSamples, setGridSamples] = useState<(typeof GRID_SAMPLES)[number]>(21);

  const result = useMemo(
    () =>
      spotMatrix({
        lens,
        focalLengthMm: 100,
        apertureMm: aperture,
        sourceTemperatureK: 5800,
        wavelengths: 9,
        maxFieldDeg,
        fields: 4,
        gridSamples,
        focusSteps: 5,
      }),
    [lens, aperture, maxFieldDeg, gridSamples],
  );

  const airyUm = result.airyRadiusMm * 1000;
  const columns = result.rows[0]!.cells.map((c) => c.rayleigh);
  const axis = result.rows[0]!;
  const edge = result.rows[result.rows.length - 1]!;
  const lost = Math.max(
    ...result.rows.flatMap((r) => r.cells.flatMap((c) => c.clouds.map((cl) => cl.lost))),
  );
  const worstShare = Math.max(...result.rows.map((r) => r.geometricShare));

  // The through-focus curve: the parabola `bestSpotZ` solves, drawn. Same rays
  // as the grid above it, evaluated on the same five planes.
  const focusSeries: PlotSeries[] = result.rows.map((row, i) => ({
    label: `${row.fieldDeg.toFixed(2)}°`,
    color: ["#111", "#2b7", "#c08a00", "#c0392b"][i] ?? "#666",
    points: row.cells.map((c) => [c.rayleigh, c.rmsRadiusMm * 1000] as const),
    dots: true,
  }));

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Where a pupil-full of rays lands</h1>
      <p style={{ maxWidth: 640, color: "#444" }}>
        A spot diagram is the most direct picture in optics: trace a grid of rays through the pupil,
        mark where each one crosses a plane, and that is the drawing. Every dot below is one traced
        ray. Down the page the field angle grows; across the page the plane moves through focus. The
        dashed circle is the <strong>Airy radius</strong> — diffraction&rsquo;s own scale, the same in
        every cell.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The grid is a grid because the two axes are not independent: an off-axis bundle focuses on a
        different plane from the axial one, so each row has its own best plane and it is not the
        middle column. On this achromat that drift runs from +0.06 columns on axis to −0.44 at 1.2°,
        which is <em>less than one column</em> — too small for the grid to show, and the reason the{" "}
        <strong>best</strong> figure sits on each row label and the through-focus curve below draws
        it on a continuous axis. That is field curvature, and the last commit of this panel deleted a
        highlight that claimed to show it in the grid and could not.
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
          label={`outer field ${maxFieldDeg.toFixed(1)}°`}
          {...FIELD}
          value={maxFieldDeg}
          onChange={setMaxFieldDeg}
        />
        <Choice
          label="rays across the pupil"
          options={GRID_SAMPLES}
          value={gridSamples}
          onChange={setGridSamples}
        />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
          <thead>
            <tr>
              <th />
              {columns.map((n) => (
                <th key={n} style={{ padding: "0 0 4px", fontWeight: 400, color: "#666" }}>
                  {n > 0 ? `+${n}` : n} × λ/2NA²
                  <div style={{ color: "#999" }}>
                    {(n * result.rayleighMm * 1000).toFixed(0)} µm
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.fieldDeg}>
                <th
                  style={{
                    padding: "0 8px 0 0",
                    textAlign: "right",
                    fontWeight: 400,
                    color: "#666",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.fieldDeg.toFixed(2)}°
                  <div style={{ color: "#999" }}>{row.rmsOverAiry.toFixed(2)} × Airy</div>
                  {/* This row's own best plane, which is what drifts. The grid
                      cannot show the drift — it is a fraction of one column —
                      so the row states it and the curve below draws it. */}
                  <div style={{ color: "#999" }}>
                    best {row.spotFocusRayleigh >= 0 ? "+" : ""}
                    {row.spotFocusRayleigh.toFixed(2)}
                  </div>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.rayleigh} style={{ padding: 2 }}>
                    <SpotCanvas cell={cell} boundUm={result.boundUm} airyUm={airyUm} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontFamily: "monospace", fontSize: 11, color: "#666", marginTop: 4 }}>
        {SPOT_LINES.map((l) => (
          <span key={l.nm} style={{ marginRight: 12 }}>
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: l.color,
                marginRight: 4,
              }}
            />
            {l.name}
          </span>
        ))}
        <span style={{ color: "#999" }}>
          · box ±{result.boundUm.toFixed(1)} µm, shared by every cell · Airy radius{" "}
          {airyUm.toFixed(2)} µm · &ldquo;best&rdquo; on each row is that field&rsquo;s own
          minimum-spot plane, in columns
        </span>
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 20, alignItems: "flex-start" }}>
        <Plot
          series={focusSeries}
          markers={[{ y: airyUm, color: "#bbb", label: "Airy radius" }]}
          xLabel="defocus (λ/2NA² — one quarter wave at the rim)"
          yLabel="RMS spot radius (µm)"
          xMin={columns[0]!}
          xMax={columns[columns.length - 1]!}
          yMin={0}
          yMax={Math.max(
            airyUm * 1.1,
            ...result.rows.flatMap((r) => r.cells.map((c) => c.rmsRadiusMm * 1000)),
          )}
        />
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", maxWidth: 420 }}>
          <Guard
            label="on-axis spot vs the Airy disc"
            value={`${axis.rmsOverAiry.toFixed(2)} ×`}
            level={axis.rmsOverAiry < 1 ? "warn" : "ok"}
            detail={
              axis.rmsOverAiry < 1
                ? "under 1: the scatter is smaller than diffraction, so this diagram is drawing something smaller than the real image. The PSF is the honest picture here."
                : "over 1: the scatter is the image, and diffraction is a detail on top of it"
            }
          />
          <Fact
            label="the two focus criteria, on axis"
            value={`${(result.criterionGapMm * 1000).toFixed(2)} µm`}
            note="minimum-spot plane minus the image plane, both at 550 nm"
          />
          <Fact
            label={`spot focus at ${edge.fieldDeg.toFixed(2)}°`}
            value={`${edge.spotFocusRayleigh.toFixed(2)} × λ/2NA²`}
            note={`${(edge.spotFocusOffsetMm * 1000).toFixed(1)} µm off the image plane — this is field curvature`}
          />
          <Fact
            label="engine's geometric share"
            value={worstShare.toFixed(2)}
            note="a different question — see below"
          />
          <Guard
            label="rays lost in the pupil"
            value={String(lost)}
            level={thresholdLevel(lost, 1, 0.5)}
            detail={
              lost === 0
                ? "every ray survives the trace — no vignetting here"
                : "those rays never reached the image, and are not drawn at the origin"
            }
          />
          <Fact label="traced in" value={`${result.elapsedMs.toFixed(0)} ms`} note="on this thread — see below" />
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>A spot diagram lies about a good lens, not a bad one</h2>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The intuition runs the wrong way round. A spot diagram is a drawing of ray landings and
        nothing else, so it is at its most honest when the lens is <em>poor</em> — when the rays are
        scattered over an area far bigger than the diffraction disc, the scatter essentially{" "}
        <em>is</em> the image. It fails when the lens is <strong>good</strong>. Put the achromat at
        f/25 and the on-axis RMS spot is 0.01 of the Airy radius: the cell draws a point, and the
        real image is a disc a hundred times wider that no ray in this picture knows about. The ratio
        beside each row is there so that cell cannot be misread.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The comparison is worth making because the app has a <em>second</em> switch that sounds like
        it should answer the same question and does not. The renderer chooses between a diffraction
        PSF and a ray-histogram PSF on a criterion in <code>wave/fidelity</code>, and that criterion
        is <strong>phase change per pupil sample, not total wave error</strong> — it asks whether the
        FFT can still resolve the wavefront, which is a question about arithmetic. The two come apart
        cleanly: the <strong>singlet at f/5 has an RMS spot of 7.5 Airy radii</strong>, about as
        geometric as anything this app can build, and the engine&rsquo;s geometric share there is{" "}
        <strong>0.00</strong>. Nothing is wrong. A wavefront can be tens of waves deep and still
        perfectly smooth across 64 samples, so the FFT handles it correctly, and the ray picture is
        also a fair description. Both numbers are on this page, each labelled with the question it
        answers, because a panel that printed one of them as &ldquo;is this diagram trustworthy&rdquo;
        would be quoting the answer to the other one.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>What the curve underneath is, and what it is not</h2>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The through-focus curve is a parabola, exactly, and not approximately: every ray leaving the
        last surface is a straight line, so its distance from the centroid is linear in the plane
        position and the mean square of it is a quadratic. That is why the engine solves best focus
        in closed form instead of searching, and why the column grid was free — five planes cost five
        intersections, not five traces.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        So the curve&rsquo;s minimum and the engine&rsquo;s closed form agree, and that agreement is{" "}
        <em>not</em> evidence of anything: it is the same algebra applied to the same rays, and it
        would agree if both were wrong together. It is worth pinning as an identity — a change that
        breaks one side and not the other is a real bug — but this page does not present it as two
        methods confirming each other, because it is one method drawn twice.
      </p>
      <p style={{ maxWidth: 640, color: "#444" }}>
        The number that <em>is</em> a measurement is the gap above: the image plane comes from
        minimum RMS <strong>wavefront</strong> and this curve minimises RMS <strong>spot</strong>,
        and on the achromat at f/10 those disagree by −6.8 µm on axis. It is quoted at 550 nm, the
        wavelength the system was focused at, and that matters more than it looks: the same
        subtraction at the d line reads +7.2 µm, and the difference between the two is not a
        criterion at all — it is the chromatic focal shift between the two wavelengths. Quoting the
        d-line figure as &ldquo;the criteria disagree&rdquo; would be attributing a colour to a
        definition.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>No web worker, and the honest version of why</h2>
      <p style={{ maxWidth: 640, fontSize: 13, color: "#666" }}>
        Every tracing panel in this app posts its work to a worker; the ray fan is the one exception,
        and it justified itself at <strong>6–19 ms</strong>. This route is the second exception and it
        is <em>not</em> as comfortable, so it says so rather than borrowing that sentence. Measured in
        the built app: <strong>{result.elapsedMs.toFixed(0)} ms</strong> right now, 34 ms at the
        default density, 61 at the densest, 86 on a cold route. Sixteen bundles — twelve for the
        three wavelengths across four fields, four more for the measurement grid — and the five
        columns are free, being intersections of rays already traced.
      </p>
      <p style={{ maxWidth: 640, fontSize: 13, color: "#666" }}>
        At 34 ms a slider still tracks the thumb; at the <strong>31-ray</strong> setting it visibly
        does not, and the number above understates that, because it times the <em>tracing</em> and
        the densest grid also asks the canvas for 42,300 individual dots. That is the honest state of
        this decision: a worker would move the trace off the thumb and would not move the drawing, so
        it would buy less than half of what is being felt. If the ray count grows or a row is added,
        this paragraph is the thing that has stopped being true.
      </p>
    </>
  );
}
