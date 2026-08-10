import { useMemo, useState } from "react";
import {
  BLANK_SURFACE,
  CATALOG_MEDIA,
  DEFAULT_DRAFT,
  LINES,
  benchSeeds,
  describeBench,
  naSpellingRatio,
  solveParaxialFocus,
  type BenchDraft,
  type BenchSurface,
  type Section,
} from "../editor";
import { Choice, Fact, Fieldset, Guard, NumberField, num, type GuardLevel } from "../ui";
import type { ApertureSpec } from "@telemicroscope/core/trace";

/**
 * The bench editor — ROADMAP's v1 line, and the last thing step 5 left open that
 * is not an engine step.
 *
 * Every other panel in this app shows what a *design* does. This shows the
 * surface list underneath one, and lets a reader change a number in it. That is
 * the whole difference: D8's builder edits the arguments a constructor is called
 * with and the constructor decides what surfaces exist; here the surfaces are
 * the input, and nothing solves anything unless you press something that says it
 * will.
 *
 * ## What it is for, given that the engine already refuses bad designs
 *
 * The panel's subject is the gap between the two tracers this repo runs on the
 * same data. Paraxial says where the image is; exact says where the light
 * actually goes; and a form is the first place in this app where a reader can
 * make that gap move. Three of its readouts are that gap in different clothes —
 * the authored back focus against the paraxial one, the paraxial focus against
 * the exact best focus, and ΣS_I against the order the aperture sweep measures.
 *
 * ## The one number this panel found
 *
 * Closing the stop by half divides the on-axis residual by 2^p, and p is the
 * lowest aberration order that has NOT been corrected. So the exponent is a
 * *measurement of a design's correction state* that needs no Seidel formula at
 * all — and unlike `seidelSums`, which refuses a conic outright, it works on
 * anything that traces. The singlet reads 3.00, the DIN objective 5.01, and the
 * second is § 6b's ΣS_I = 0 confirmed by a route that never computes S_I.
 *
 * ## Cost, and why this one is live
 *
 * 2.4–4.0 ms for the seeds: three paraxial traces, one pupil solve, two exact
 * bundles and four more for the aperture sweep, at 149 rays each. (The first
 * render reads ~16 ms and that is warm-up, not the trace — it settles inside one
 * edit.) D8 submits because a build is 50 ms of solving; this recomputes on
 * every keystroke because a trace is cheap and a table you have to press a
 * button to see the effect of is not an editor.
 */

const cell: React.CSSProperties = { padding: "2px 5px", textAlign: "right", whiteSpace: "nowrap" };
const head: React.CSSProperties = { ...cell, borderBottom: "1px solid #ccc", color: "#444", fontWeight: 400 };
const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 12 };
const note: React.CSSProperties = { ...mono, color: "#777", maxWidth: 640, margin: "4px 0 0" };

/** A small square button — the row actions, which are all one glyph. */
function Tiny(props: { onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
      style={{
        ...mono,
        width: 22,
        padding: "1px 0",
        border: "1px solid #ccc",
        background: "#fff",
        color: props.disabled ? "#ccc" : "#333",
        cursor: props.disabled ? "default" : "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

/** A section that failed says so where its numbers would have been. */
function SectionRefusal({ section }: { section: Section<unknown> }) {
  if (section.ok) return null;
  return (
    <div
      style={{
        ...mono,
        border: `1px solid ${section.source === "engine" ? "#c00" : "#a60"}`,
        color: section.source === "engine" ? "#c00" : "#a60",
        padding: "6px 10px",
        maxWidth: 720,
        marginBottom: 12,
      }}
    >
      <strong>the {section.stage} readout is not available — </strong>
      {section.source === "engine" ? "the engine says: " : "this app says: "}
      {section.error}
    </div>
  );
}

const APERTURE_KINDS = ["EPD", "fNumber", "objectNA", "imageNA", "stopRadius"] as const;

const APERTURE_LABEL: Record<ApertureSpec["kind"], string> = {
  EPD: "entrance pupil ⌀ (mm)",
  fNumber: "focal ratio f/#",
  objectNA: "object NA",
  imageNA: "image NA",
  stopRadius: "stop radius (mm)",
};

export function EditorPanel() {
  const seeds = useMemo(() => benchSeeds(), []);
  const [draft, setDraft] = useState<BenchDraft>(DEFAULT_DRAFT);
  const [seedId, setSeedId] = useState(seeds[0]!.id);

  const result = useMemo(() => describeBench(draft), [draft]);

  const setSurface = (i: number, next: Partial<BenchSurface>) =>
    setDraft((d) => ({
      ...d,
      surfaces: d.surfaces.map((s, j) => (j === i ? { ...s, ...next } : s)),
    }));

  // Exactly one stop, because `stopIndex` reads the FIRST flagged surface and a
  // second flag would be a number the table shows and the engine ignores.
  const setStop = (i: number) =>
    setDraft((d) => ({ ...d, surfaces: d.surfaces.map((s, j) => ({ ...s, isStop: j === i })) }));

  const insertAfter = (i: number) =>
    setDraft((d) => ({
      ...d,
      surfaces: [...d.surfaces.slice(0, i + 1), BLANK_SURFACE, ...d.surfaces.slice(i + 1)],
    }));

  const removeAt = (i: number) =>
    setDraft((d) => ({ ...d, surfaces: d.surfaces.filter((_, j) => j !== i) }));

  const swap = (i: number, j: number) =>
    setDraft((d) => {
      const surfaces = [...d.surfaces];
      const a = surfaces[i]!;
      surfaces[i] = surfaces[j]!;
      surfaces[j] = a;
      return { ...d, surfaces };
    });

  const seed = seeds.find((s) => s.id === seedId)!;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The bench: the surface list, and both tracers on it</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Every other panel here shows what a <em>design</em> does. This is the{" "}
        <strong>prescription</strong> underneath one — the ordered surface list that both branches
        share, with a row per surface and nothing solved for you. The builder next door edits the
        arguments a constructor is called with; here the surfaces <em>are</em> the input, which is
        the layer under every picture in this app.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The subject is the gap between the two tracers running on the same rows. Paraxial says where
        the image is; exact says where the light goes. The seeds open on that gap already: the two
        refractors carry a last thickness of <strong>500 mm</strong> because{" "}
        <code>refractorPair</code> authors one as a placeholder its own doc calls a stand-in, while
        the paraxial focus is at <strong>496.577</strong>. Press <em>solve focus</em> and the
        placeholder becomes the trace&rsquo;s answer — and the exact best focus is{" "}
        <strong>still 95 µm short of it</strong>, which is the spherical aberration that a first-order
        engine cannot see and a designer cannot remove by refocusing.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The panel&rsquo;s own finding is the <strong>order</strong> readout. Halve the stop and the
        on-axis spot falls by 2<sup>p</sup>, where p is the lowest aberration order that has{" "}
        <em>not</em> been corrected — so the exponent measures a design&rsquo;s correction state
        without computing a single Seidel term. The BK7 singlet reads <strong>3.00</strong>; the DIN
        4×/0.10 objective reads <strong>5.01</strong>, because § 6b solved its third order to zero
        and the fifth is what is left. Those are two independent routes to the same claim about the
        same lens, and the panel prints both — including where the Seidel route{" "}
        <em>refuses</em>, since a conic is outside it and the Cassegrain has two.
      </p>

      <Fieldset title="a design the engine built, as rows — load one and edit nothing to check the form against it">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {seeds.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setDraft(s.draft);
                setSeedId(s.id);
              }}
              style={{
                ...mono,
                fontSize: 11,
                padding: "2px 6px",
                border: s.id === seedId ? "1px solid #333" : "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p style={{ ...note, maxWidth: 420 }}>{seed.note}</p>
      </Fieldset>

      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ ...mono, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>#</th>
              <th style={head}>kind</th>
              <th style={head}>R (mm)</th>
              <th style={head}>conic k</th>
              <th style={head}>semi-⌀ (mm)</th>
              <th style={head}>thickness (mm)</th>
              <th style={head}>medium after</th>
              <th style={head}>stop</th>
              <th style={head}>vertex z</th>
              <th style={head}></th>
            </tr>
          </thead>
          <tbody>
            {draft.surfaces.map((s, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ ...cell, textAlign: "left", color: "#777" }}>{i}</td>
                <td style={cell}>
                  <button
                    onClick={() => setSurface(i, { kind: s.kind === "refract" ? "reflect" : "refract" })}
                    style={{
                      ...mono,
                      padding: "2px 6px",
                      border: "1px solid #ccc",
                      background: s.kind === "reflect" ? "#333" : "#fff",
                      color: s.kind === "reflect" ? "#fff" : "#333",
                      cursor: "pointer",
                    }}
                  >
                    {s.kind}
                  </button>
                </td>
                <td style={cell}>
                  <NumberField
                    value={s.radiusMm}
                    width={86}
                    onChange={(radiusMm) => setSurface(i, { radiusMm })}
                  />
                </td>
                <td style={cell}>
                  <NumberField value={s.conic} width={62} onChange={(conic) => setSurface(i, { conic })} />
                </td>
                <td style={cell}>
                  <NumberField
                    value={s.semiApertureMm}
                    width={70}
                    onChange={(semiApertureMm) => setSurface(i, { semiApertureMm })}
                  />
                </td>
                <td style={cell}>
                  <NumberField
                    value={s.thicknessMm}
                    width={82}
                    onChange={(thicknessMm) => setSurface(i, { thicknessMm })}
                  />
                </td>
                <td style={cell}>
                  <select
                    value={s.medium}
                    disabled={s.kind === "reflect"}
                    onChange={(e) => setSurface(i, { medium: e.target.value })}
                    style={{ ...mono, opacity: s.kind === "reflect" ? 0.35 : 1 }}
                  >
                    {CATALOG_MEDIA.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={cell}>
                  <input
                    type="radio"
                    name="bench-stop"
                    checked={s.isStop}
                    onChange={() => setStop(i)}
                  />
                </td>
                <td style={{ ...cell, color: "#777" }}>
                  {result.ok && result.exact.ok ? num(result.exact.vertexZsMm[i] ?? NaN, 3) : "—"}
                </td>
                <td style={cell}>
                  <Tiny onClick={() => swap(i, i - 1)} title="move up" disabled={i === 0}>
                    ↑
                  </Tiny>{" "}
                  <Tiny
                    onClick={() => swap(i, i + 1)}
                    title="move down"
                    disabled={i === draft.surfaces.length - 1}
                  >
                    ↓
                  </Tiny>{" "}
                  <Tiny onClick={() => insertAfter(i)} title="insert a plane below">
                    +
                  </Tiny>{" "}
                  <Tiny onClick={() => removeAt(i)} title="remove this surface">
                    ✕
                  </Tiny>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={note}>
        R is the vertex radius of curvature and the engine stores c = 1/R, so the conversion happens
        exactly once in each direction and never twice — a plane is <code>Infinity</code>, and R = 0
        is refused by this app because c = ∞ is a geometry the engine has no error for. Thickness is
        the <em>signed</em> distance to the next vertex and goes <strong>negative after a mirror</strong>,
        which is why the Cassegrain&rsquo;s second vertex sits at −560. The medium is the one{" "}
        <em>after</em> the surface, and a mirror keeps the one it was in — so that column greys out
        rather than lying. The stop is a radio because <code>stopIndex</code> reads the first flagged
        surface and defaults to surface 0.
      </p>

      <Fieldset title="what makes the surface list well-posed — the four specs a prescription does not carry">
        <label style={mono}>
          object medium
          <br />
          <select
            value={draft.objectMedium}
            onChange={(e) => setDraft((d) => ({ ...d, objectMedium: e.target.value }))}
            style={mono}
          >
            {CATALOG_MEDIA.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <Choice
          label="aperture — five spellings of one constraint"
          options={APERTURE_KINDS}
          value={draft.aperture.kind}
          onChange={(kind) => setDraft((d) => ({ ...d, aperture: { kind, value: d.aperture.value } }))}
        />
        <NumberField
          label={APERTURE_LABEL[draft.aperture.kind]}
          value={draft.aperture.value}
          onChange={(value) => setDraft((d) => ({ ...d, aperture: { kind: d.aperture.kind, value } }))}
        />
        <Choice
          label="conjugate"
          options={["infinite", "finite"] as const}
          value={draft.conjugate.kind}
          onChange={(kind) =>
            setDraft((d) => ({
              ...d,
              conjugate:
                kind === "infinite"
                  ? { kind: "infinite" }
                  : { kind: "finite", distance: d.conjugate.kind === "finite" ? d.conjugate.distance : 100 },
            }))
          }
          format={(v) => (v === "infinite" ? "at infinity" : "finite distance")}
        />
        {draft.conjugate.kind === "finite" && (
          <NumberField
            label="object → surface 0 (mm)"
            value={draft.conjugate.distance}
            onChange={(distance) => setDraft((d) => ({ ...d, conjugate: { kind: "finite", distance } }))}
          />
        )}
        <NumberField
          label={draft.conjugate.kind === "infinite" ? "field angle (deg)" : "object height (mm)"}
          value={draft.fieldValue}
          onChange={(fieldValue) => setDraft((d) => ({ ...d, fieldValue }))}
        />
        <NumberField
          label="rays across the pupil"
          value={draft.pupilRays}
          onChange={(pupilRays) => setDraft((d) => ({ ...d, pupilRays: Math.max(3, Math.round(pupilRays)) }))}
        />
        <p style={{ ...note, flex: "1 1 280px", maxWidth: 360 }}>
          the wavelengths are fixed at the F, d and C lines — a set with weights, never one λ, which
          is what makes the glass column mean something. The field spelling follows the conjugate:
          angles at infinity, heights at a finite one.
        </p>
      </Fieldset>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setDraft(solveParaxialFocus)}
          style={{ ...mono, fontSize: 13, padding: "6px 16px", border: "1px solid #333", background: "#333", color: "#fff", cursor: "pointer" }}
        >
          solve focus
        </button>
        <button
          onClick={() => setDraft(seed.draft)}
          style={{ ...mono, fontSize: 13, padding: "6px 16px", border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
        >
          reset to {seed.label}
        </button>
        <span style={{ ...mono, color: "#777" }}>
          {result.ok
            ? `${result.elapsedMs.toFixed(1)} ms · ${result.surfaceCount} surfaces · every keystroke re-traces`
            : "not traced"}
        </span>
      </div>

      {!result.ok ? (
        <div
          style={{
            ...mono,
            fontSize: 13,
            border: `1px solid ${result.source === "engine" ? "#c00" : "#a60"}`,
            color: result.source === "engine" ? "#c00" : "#a60",
            padding: 12,
            maxWidth: 720,
          }}
        >
          <strong>
            {result.source === "engine"
              ? "the engine refuses this prescription, in its own words:"
              : "this app cannot hand the engine that:"}
          </strong>
          <br />
          {result.error}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <OrderGuard result={result} />
            <FocusGuard result={result} />
          </div>

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>paraxial — three lines, one surface list</h2>
          <SectionRefusal section={result.paraxial} />
          {result.paraxial.ok && (
            <>
              <table style={{ ...mono, borderCollapse: "collapse", marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={{ ...head, textAlign: "left" }}>line</th>
                    <th style={head}>EFL (mm)</th>
                    <th style={head}>BFD (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.paraxial.lines.map((l) => (
                    <tr key={l.nm}>
                      <td style={{ ...cell, textAlign: "left" }}>{l.label}</td>
                      <td style={cell}>{num(l.eflMm, 4)}</td>
                      <td style={cell}>{num(l.bfdMm, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
                <Fact
                  label="EFL(F) − EFL(C)"
                  value={`${num(result.paraxial.eflSpreadMm, 4)} mm`}
                  note="exactly zero for a mirror, which has no glass to disperse"
                />
                <Fact
                  label="BFD(F) − BFD(C)"
                  value={`${num(result.paraxial.focalShiftMm, 4)} mm`}
                  note="the axial colour no focus solve can remove"
                />
                <Fact
                  label="image: paraxial / authored"
                  value={`${num(result.paraxial.imageOffsetMm, 3)} / ${num(result.paraxial.authoredOffsetMm, 3)}`}
                  note="from the last vertex — the second is whatever the last thickness says"
                />
              </div>
            </>
          )}

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>the pupil the aperture spec resolved to</h2>
          <SectionRefusal section={result.pupil} />
          {result.pupil.ok && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
              <Fact
                label="stop"
                value={`surface ${result.pupil.stopIndex}, r = ${num(result.pupil.stopRadiusMm, 4)} mm`}
                note={`at z = ${num(result.pupil.stopZMm, 3)}`}
              />
              <Fact
                label="entrance pupil"
                value={`r = ${num(result.pupil.entranceRadiusMm, 4)} mm`}
                note={`at z = ${num(result.pupil.entranceZMm, 3)}`}
              />
              <Fact
                label="exit pupil"
                value={`r = ${num(result.pupil.exitRadiusMm, 4)} mm`}
                note={`at z = ${num(result.pupil.exitZMm, 3)}`}
              />
              {draft.aperture.kind === "objectNA" && (
                <Fact
                  label="…but as an objectNA"
                  value={`×${naSpellingRatio(draft.aperture.value).toFixed(6)} smaller`}
                  note="this spelling reads NA as a paraxial slope; a design sizing its own stop uses tan u at sin u = NA. Same constraint, 1/√(1−NA²) apart."
                />
              )}
            </div>
          )}

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>exact — where the rays actually land</h2>
          <SectionRefusal section={result.exact} />
          {result.exact.ok && (
            <>
              <table style={{ ...mono, borderCollapse: "collapse", marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={{ ...head, textAlign: "left" }}>field</th>
                    <th style={head}>RMS at the plane</th>
                    <th style={head}>geometric radius</th>
                    <th style={head}>best focus</th>
                    <th style={head}>RMS there</th>
                    <th style={head}>lost</th>
                  </tr>
                </thead>
                <tbody>
                  {result.exact.fields.map((f, i) => (
                    <tr key={i}>
                      <td style={{ ...cell, textAlign: "left" }}>
                        {f.fieldValue}
                        {draft.conjugate.kind === "infinite" ? "°" : " mm"}
                      </td>
                      <td style={cell}>{num(f.rmsRadiusMm * 1000, 3)} µm</td>
                      <td style={cell}>{num(f.geoRadiusMm * 1000, 3)} µm</td>
                      <td style={cell}>{num(f.bestFocusOffsetMm, 4)} mm</td>
                      <td style={cell}>{num(f.bestRmsRadiusMm * 1000, 3)} µm</td>
                      <td style={{ ...cell, color: f.lost > 0 ? "#a60" : "#777" }}>
                        {f.lost}/{f.lost + f.traced}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={note}>
                the image plane sits at z = {num(result.exact.imagePlaneZMm, 3)}, the last vertex at{" "}
                {num(result.exact.lastVertexZMm, 3)}, and best focus is quoted as an offset from that
                vertex so it compares directly with the paraxial one above. {result.exact.rayCount}{" "}
                rays per bundle; <em>lost</em> is rays that did not make it out, which is what
                vignetting is.
              </p>
            </>
          )}

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>
            third order, and the order the aperture says is really there
          </h2>
          <SectionRefusal section={result.seidel} />
          {result.seidel.ok && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
              <Fact
                label="ΣS_I"
                value={`${result.seidel.s1Mm.toExponential(4)} mm`}
                note={`on the marginal ray at h = ${num(result.seidel.marginalHeightMm, 4)} mm`}
              />
              <Fact
                label="W₀₄₀ = S_I/8"
                value={`${num(result.seidel.w040Waves, 4)} waves`}
                note="at the d line — third order's prediction of the wavefront, not converted into anything else"
              />
            </div>
          )}
          <SectionRefusal section={result.order} />
          {result.order.ok && (
            <>
              <table style={{ ...mono, borderCollapse: "collapse", marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={{ ...head, textAlign: "left" }}>stop</th>
                    {result.order.steps.map((s) => (
                      <th key={s.stopFraction} style={head}>
                        ×{s.stopFraction}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...cell, textAlign: "left", color: "#777" }}>on-axis RMS at focus</td>
                    {result.order.steps.map((s) => (
                      <td key={s.stopFraction} style={cell}>
                        {s.rmsRadiusMm.toExponential(2)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ ...cell, textAlign: "left", color: "#777" }}>implied order</td>
                    <td style={cell}>—</td>
                    {result.order.slopes.map((s, i) => (
                      <td key={i} style={cell}>
                        {s.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p style={note}>
                {result.order.noiseFloor
                  ? "the full-aperture residual is already under a picometre, so these are the tracer's rounding and the slope through them is a number about nothing. That is what a design which is stigmatic on axis by construction looks like from here."
                  : "the exponent settles as the aperture closes, because the higher orders die faster than the one being measured. 3 is uncorrected spherical; 5 means the third order has been solved to zero and the fifth is what is left."}
              </p>
            </>
          )}

          <p style={{ marginTop: 16, fontSize: 13, color: "#666", maxWidth: 680 }}>
            Nothing here is new physics, and no engine capability was added:{" "}
            <code>systemProperties</code>, <code>pupils</code>, <code>exitBundle</code>,{" "}
            <code>bestSpotZ</code> and <code>seidelSums</code> have been in the engine since steps
            1–2. What did not exist was a way to reach <code>Prescription</code> itself — every
            other surface in this app reaches designs, which are the things that <em>produce</em> one.
          </p>
          <p style={{ fontSize: 13, color: "#666", maxWidth: 680 }}>
            <strong>What this form does not edit, said out loud.</strong> <code>SurfaceSpec</code>{" "}
            also carries tilt, decenter and a reflectance override, and <code>Prescription</code>{" "}
            carries <code>mirrorFrames</code>. This table is <strong>unfolded and axial</strong>: a
            folded chain&rsquo;s thicknesses run along the beam while an unfolded chain&rsquo;s
            alternate sign at every mirror, so a control that flipped the convention under a list
            authored in the other one would silently re-read every number in it. Tilt and decenter
            already have a home as <em>perturbations</em> of a built design — that is Part B, where
            they have rungs behind them — and authoring them from scratch is what the module layer in
            ARCHITECTURE.md § Data model is for.
          </p>
        </>
      )}
    </>
  );
}

/** The headline: which order survives, and whether it can be read at all. */
function OrderGuard({ result }: { result: Extract<ReturnType<typeof describeBench>, { ok: true }> }) {
  if (!result.order.ok) {
    return <Guard label="the order that survives" value="—" level="warn" detail={result.order.error} />;
  }
  if (result.order.noiseFloor) {
    return (
      <Guard
        label="the order that survives"
        value="none"
        level="ok"
        detail="stigmatic on axis to the tracer's own precision — the residual is under a picometre, and an exponent through it would be the shape of the rounding"
      />
    );
  }
  const p = result.order.order;
  // Not a threshold: 3 and 5 are both correct answers about different lenses.
  // The colour says how *cleanly* the exponent has settled, which is the only
  // thing here that can be wrong.
  const nearest = Math.round(p);
  const level: GuardLevel = Math.abs(p - nearest) < 0.1 ? "ok" : Math.abs(p - nearest) < 0.3 ? "warn" : "bad";
  return (
    <Guard
      label="the order that survives"
      value={p.toFixed(2)}
      level={level}
      detail={
        level === "ok"
          ? `halving the stop divides the on-axis spot by 2^${nearest} — ${nearest === 3 ? "uncorrected spherical" : nearest === 5 ? "the third order has been nulled" : "the lowest term still present"}`
          : "the exponent has not settled: more than one order is contributing at this aperture, so no single number describes it"
      }
    />
  );
}

/** The other gap: paraxial focus against the exact best one. */
function FocusGuard({ result }: { result: Extract<ReturnType<typeof describeBench>, { ok: true }> }) {
  if (!result.exact.ok || !result.paraxial.ok) {
    return <Guard label="paraxial focus vs best focus" value="—" level="warn" detail="both tracers are needed" />;
  }
  const axis = result.exact.fields[0]!;
  const gap = axis.bestFocusOffsetMm - result.paraxial.imageOffsetMm;
  return (
    <Guard
      label="best focus − paraxial focus"
      value={`${num(gap, 4)} mm`}
      level="ok"
      detail="what the first-order engine cannot see. It is not an error in either tracer: the paraxial focus is where the axis ray goes, and the rays at the rim go somewhere else."
    />
  );
}
