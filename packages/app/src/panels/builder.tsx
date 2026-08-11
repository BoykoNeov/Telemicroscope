import { useEffect, useState } from "react";
import {
  CROWN_MEDIA,
  DEFAULT_SPEC,
  FLINT_MEDIA,
  IMMERSION_MEDIA,
  SLIP_MEDIA,
  liveFields,
  type BuildForm,
  type BuildSpec,
} from "../builder";
import {
  describeBuild,
  LAMBDA_NM,
  MARECHAL_WAVES,
  MICROSCOPE_CATALOG,
  type BuildDescription,
} from "../microscope";
import { Choice, Fact, Fieldset, Guard, NumberField, num, thresholdLevel } from "../ui";
import { clearSavedBuild, readSavedBuild, writeSavedBuild } from "../saved";
import { customLabel } from "../objective";

/**
 * The microscope builder — APP.md's D8.
 *
 * A1's table asks *which of these ten objectives*; this asks *what is an
 * objective*. The ten rows were never the design space — they were ten calls
 * with two arguments each and twenty defaults — and this panel is where the
 * other twenty become controls.
 *
 * ## Why the walls are the point
 *
 * Three of the branch's five measured geometric ceilings are reachable from this
 * form, and reaching them is the surface's content rather than its failure mode:
 * § 6b's f/4.1 cemented-doublet ratio, § 6d's NA 0.343 for the two-doublet
 * aplanat, § 6e.4's NA 1.411 where the slip's apparent-depth floor meets the
 * dome placement. A catalogue can show three walls because three rows were
 * written to fail. Here a reader picks an aperture and finds out — and the guards
 * below say how close the current design is *before* the engine refuses it,
 * which is the difference between a wall you hit and a wall you can see.
 *
 * ## Two voices, and they are not styled the same
 *
 * A refusal from the engine is quoted verbatim and in red: it is a measured
 * finding with a number in it. A refusal from this app — a combination with no
 * engine call behind it, like the finite-conjugate Lister — is amber and says so.
 * `describeBuild` tags which is which; this panel does not decide it.
 *
 * ## Cost
 *
 * ~50 ms a build, all of it `scaleDrift`'s six field traces (A1 measured that).
 * That is a form-submit cost, so this panel submits: nothing recomputes while a
 * control moves. Every other microscope panel here re-renders on drag and pays
 * for backpressure to do it; this one buys the same honesty by not dragging.
 */

const PUPIL_SAMPLES = 32;
const GRID = 64;


/** The objective's own solved numbers — per form, because the forms differ. */
function ObjectiveFacts({ objective }: { objective: Extract<BuildDescription, { ok: true }>["objective"] }) {
  const common = (
    <>
      <Fact label="f = f_tube/M (mm)" value={num(objective.focalLengthMm)} />
      <Fact
        label="paraxial EFL (mm)"
        value={num(objective.paraxialFocalLengthMm)}
        note="traced, not assumed — § 5j's Gullstrand remainder lives in the gap"
      />
      <Fact label="specimen plane (mm)" value={num(objective.objectDistanceMm, 4)} />
      <Fact label="stop radius (mm)" value={num(objective.stopRadiusMm, 4)} />
    </>
  );
  if (objective.form === "doublet-din") {
    return (
      <>
        {common}
        <Fact
          label="working f/#"
          value={`f/${num(objective.workingFocalRatio, 2)}`}
          note="the 4×/0.10 sits at f/4.08, and the form survives to ~f/2.3 — measured, and nearly flat in M"
        />
        <Fact label="free working distance (mm)" value={num(objective.freeWorkingDistanceMm, 4)} />
        <Fact label="air gap (mm)" value={num(objective.airGapMm, 4)} />
        <Fact
          label="air-equivalent object (mm)"
          value={num(objective.airEquivalentObjectDistanceMm, 4)}
          note="solved from the trace, never from t/n — that closed form stays a pin"
        />
        <Fact label="image distance (mm)" value={num(objective.imageDistanceMm, 3)} />
        <Fact
          label="x′ asked / delivered (mm)"
          value={`${num(objective.opticalTubeLengthMm, 1)} / ${num(objective.tracedOpticalTubeLengthMm, 3)}`}
        />
      </>
    );
  }
  if (objective.form === "doublet-infinity") {
    return (
      <>
        {common}
        <Fact
          label="f/# = 1/(2·NA)"
          value={`f/${num(objective.focalRatio, 2)}`}
          note="a function of NA alone here — the finite conjugate's is faster by (1+1/M)"
        />
        <Fact
          label="glass semi-aperture (mm)"
          value={num(objective.pupilRadiusMm, 4)}
          note="f·NA, the sine-condition height — NOT the stop radius"
        />
      </>
    );
  }
  if (objective.form === "lister") {
    return (
      <>
        {common}
        <ListerFacts numbers={objective} />
      </>
    );
  }
  return (
    <>
      {common}
      <Fact
        label="dome radius (mm)"
        value={num(objective.domeRadiusMm, 4)}
        note="solved, not picked: every length in the front group is ∝ R"
      />
      <Fact
        label="NA into the rear group"
        value={num(objective.rearNumericalAperture, 4)}
        note={`NA ÷ the front group's magnification, ${objective.meniscusCount} menisci`}
      />
      <Fact label="group gap (mm)" value={num(objective.groupGapMm, 4)} />
      <ListerFacts numbers={objective.rear} />
    </>
  );
}

function ListerFacts({
  numbers,
}: {
  numbers: {
    separationMm: number;
    frontFocalLengthMm: number;
    rearFocalLengthMm: number;
    frontBending: number;
    rearBending: number;
    seidelS1: number;
    seidelS2: number;
    cancellation: number;
    rootCount: number;
  };
}) {
  return (
    <>
      <Fact
        label="group separation (mm)"
        value={num(numbers.separationMm, 4)}
        note={`f_front ${num(numbers.frontFocalLengthMm, 3)} · f_rear ${num(numbers.rearFocalLengthMm, 3)}`}
      />
      <Fact
        label="bendings (front / rear)"
        value={`${num(numbers.frontBending, 4)} / ${num(numbers.rearBending, 4)}`}
        note={`${numbers.rootCount} joint root${numbers.rootCount === 1 ? "" : "s"} — solved together, which one doublet cannot be`}
      />
      <Fact
        label="ΣS_I / ΣS_II"
        value={`${numbers.seidelS1.toExponential(2)} / ${numbers.seidelS2.toExponential(2)}`}
        note={`cancellation ${numbers.cancellation.toExponential(2)} — § 6d's aplanatic condition`}
      />
    </>
  );
}

export function BuilderPanel() {
  const [spec, setSpec] = useState<BuildSpec>(DEFAULT_SPEC);
  const [submitted, setSubmitted] = useState<BuildSpec>(DEFAULT_SPEC);
  // Part F's slot, read at mount for the same reason the picture panels read
  // it there: it is a parse, and a parse in a render is a new object a memo
  // cannot see through. Held in state so the label below follows the button.
  const [saved, setSaved] = useState(readSavedBuild);
  const [storageRefused, setStorageRefused] = useState(false);
  const [result, setResult] = useState<BuildDescription | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const set = <K extends keyof BuildSpec>(key: K, value: BuildSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  // Choosing a form the DIN architecture has no engine call for moves the
  // architecture with it, so the impossible pair is not offered. The reason is
  // printed beside the control rather than only discovered by pressing build.
  const setForm = (form: BuildForm) =>
    setSpec((s) => ({
      ...s,
      form,
      architecture: form === "doublet" ? s.architecture : "infinity",
      tubeLengthMm:
        form === "doublet" ? s.tubeLengthMm : s.architecture === "din" ? 200 : s.tubeLengthMm,
      // The oil form's engine default IS a real slip; the others' is bare glass.
      coverslip:
        form === "oil"
          ? { kind: "slip", thicknessMm: 0.17, medium: "D263" }
          : form === "doublet" && s.architecture === "din"
            ? s.coverslip
            : { kind: "none" },
    }));

  useEffect(() => {
    setResult(null);
    // Deferred a turn so "building…" paints first: ~50 ms of real ray tracing on
    // the main thread, dominated by `scaleDrift`'s six field traces.
    const id = setTimeout(() => {
      const started = performance.now();
      const next = describeBuild(submitted, { pupilSamples: PUPIL_SAMPLES, size: GRID });
      setElapsedMs(performance.now() - started);
      setResult(next);
    }, 0);
    return () => clearTimeout(id);
  }, [submitted]);

  const live = liveFields(spec);
  const dirty = JSON.stringify(spec) !== JSON.stringify(submitted);
  const slipOn = spec.coverslip.kind === "slip";

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The microscope builder: compose one, and walk into the walls</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        The bench traces ten objectives. Those ten were never the design space — they were ten
        constructor calls with <em>two</em> arguments each and everything else defaulted. This is
        the same engine with the parameters that decide what the design <em>is</em> put on a form:
        architecture, form, glasses, tube length, cover slip, the doublet&rsquo;s turn-around and the
        two-group orientations, infinity space, the Lister&rsquo;s split and separation, the
        dome&rsquo;s meniscus count and immersion fluid. What stays defaulted is the scaffolding —
        glass margins, meniscus gap and thickness factors, the front-image factor, the oil film,
        and λ, which every microscope readout in this app fixes at the d line.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Its best feature was already built. The engine <strong>refuses</strong> designs that do not
        exist, and refuses them in its own words — the cemented doublet when its two
        spherical-aberration-null bendings stop being two, the aplanat when the joint root is gone,
        the oil form when the slip&rsquo;s apparent depth crowds out the dome. The bench can only
        show the walls its rows were written to hit, and only while the engine still refuses them —
        three rows were written to fail and <strong>one still does</strong>, because § 6b.5.6 seeded
        the doublet solve differently and the design it used to refuse now builds. Here you choose
        an aperture and find out, against the engine as it is today.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        And the walls turn out <strong>not to be constants</strong>, which is the thing only a
        builder can show. The Lister&rsquo;s refusal already says so in its own text — it names
        § 6d&rsquo;s NA 0.343 <em>or</em> &ldquo;this split/separation/orientation admits none&rdquo;
        — and building the form is what settles which. At the engine&rsquo;s own defaults (0.6, 0.6)
        the aplanat stops at <strong>NA 0.273</strong>; at (0.5, 0.3) it reaches <strong>0.345</strong>;
        at (0.7, 0.8) only <strong>0.165</strong>. A factor of 2.1 across the very grid § 6d checks
        its solve over — and flat in magnification to four figures, which is the form&rsquo;s
        scale-freedom as a number. So the guard below quotes nothing: it{" "}
        <strong>bisects the refusal boundary for the design in the form</strong>, every other control
        held, and shows you your own wall.
      </p>

      <Fieldset title="preset — the bench's ten rows, as points in this space">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {MICROSCOPE_CATALOG.map((e) => (
            <button
              key={e.kind}
              onClick={() => {
                setSpec(e.spec);
                setSubmitted(e.spec);
              }}
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                padding: "2px 6px",
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      </Fieldset>

      <Fieldset title="architecture and form">
        <Choice
          label="architecture"
          options={["din", "infinity"] as const}
          value={spec.architecture}
          onChange={(v) => set("architecture", v)}
          format={(v) => (v === "din" ? "DIN finite conjugate" : "infinity + tube lens")}
        />
        <Choice
          label="objective form"
          options={["doublet", "lister", "oil"] as const}
          value={spec.form}
          onChange={setForm}
          format={(v) =>
            v === "doublet" ? "cemented doublet" : v === "lister" ? "Lister aplanat" : "oil immersion"
          }
        />
        {spec.form !== "doublet" && (
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#a60", maxWidth: 320, margin: 0 }}>
            the Lister and oil forms are infinity-space designs, so the architecture follows the form.
            A finite-conjugate Lister is a <em>named open item</em> in the ROADMAP (§ 6d) — there is no
            engine call to refuse, which is why this sentence is the app&rsquo;s and not the
            engine&rsquo;s.
          </p>
        )}
      </Fieldset>

      <Fieldset title="what the label claims">
        <NumberField label="magnification ×" value={spec.magnification} onChange={(v) => set("magnification", v)} />
        <NumberField
          label="numerical aperture"
          value={spec.numericalAperture}
          onChange={(v) => set("numericalAperture", v)}
        />
        <NumberField
          label={spec.architecture === "din" ? "optical tube x′ (mm)" : "tube lens f (mm)"}
          value={spec.tubeLengthMm}
          onChange={(v) => set("tubeLengthMm", v)}
        />
        <NumberField
          label="infinity space (mm)"
          value={spec.infinitySpaceMm}
          disabled={!live.infinitySpace}
          onChange={(v) => set("infinitySpaceMm", v)}
        />
        <NumberField
          label="field number (mm, 0 = axial glass)"
          value={spec.fieldNumberMm}
          disabled={!live.fieldNumber}
          onChange={(v) => set("fieldNumberMm", v)}
        />
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 300, margin: 0 }}>
          the tube length and the objective&rsquo;s own <code>tubeFocalLengthMm</code> are one control:
          a magnification quoted against one tube and formed by another is a mislabelled lens, not a
          design. The infinity space changes no first-order property — that is why it exists, and it
          is a rung of its own.
        </p>
        {live.fieldNumber && (
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 300, margin: 0 }}>
            the field number sizes the <em>glass</em> and not the aperture (§ 6w): a telecentric
            bundle from the field edge arrives centred on <code>FN/2M</code>, so the element is
            <code> f·NA + FN/2M</code>. Set it to 0 and the objective is § 6v&rsquo;s — sized to its
            axial beam, and losing 27% of the pupil at the field edge. The oversize is a{" "}
            <em>ratio</em> with no magnification in it, <code>1 + FN/(2·f_tube·NA)</code>, and it
            costs 2.1% of working distance and drops the form&rsquo;s NA ceiling by exactly{" "}
            <code>FN/(2·f_tube)</code>.
          </p>
        )}
      </Fieldset>

      <Fieldset title="glass">
        <Choice
          label="crown"
          options={CROWN_MEDIA}
          value={spec.crownMedium}
          onChange={(v) => set("crownMedium", v)}
        />
        <Choice
          label="flint"
          options={FLINT_MEDIA}
          value={spec.flintMedium}
          onChange={(v) => set("flintMedium", v)}
        />
        {live.orientation ? (
          <Choice
            label="orientation — which face meets the specimen"
            options={["flintFirst", "crownFirst"] as const}
            value={spec.orientation}
            onChange={(v) => set("orientation", v)}
            format={(v) => (v === "flintFirst" ? "flint first" : "crown first")}
          />
        ) : live.listerGroups ? (
          <>
            <Choice
              label="front group — which face meets the specimen"
              options={["flintFirst", "crownFirst"] as const}
              value={spec.frontGroupOrientation}
              onChange={(v) => set("frontGroupOrientation", v)}
              format={(v) => (v === "flintFirst" ? "flint first" : "crown first")}
            />
            <Choice
              label="rear group — which face meets the beam"
              options={["flintFirst", "crownFirst"] as const}
              value={spec.rearGroupOrientation}
              onChange={(v) => set("rearGroupOrientation", v)}
              format={(v) => (v === "flintFirst" ? "flint first" : "crown first")}
            />
            <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 280, margin: 0 }}>
              these two are here because the aplanat&rsquo;s refusal names them — &ldquo;or this
              split/separation/<em>orientation</em> admits none&rdquo;. A panel that quoted that
              while defaulting the parameter would name a cause you could not check.
            </p>
          </>
        ) : (
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 280, margin: 0 }}>
            orientation is the finite-conjugate doublet&rsquo;s turn-around (§ 6b); the
            infinity-corrected doublet is authored specimen-side first and has no such choice.
          </p>
        )}
      </Fieldset>

      <Fieldset title="cover slip — one control, three meanings">
        <Choice
          label="slip"
          options={["none", "slip"] as const}
          value={spec.coverslip.kind}
          onChange={(v) =>
            set(
              "coverslip",
              v === "none" ? { kind: "none" } : { kind: "slip", thicknessMm: 0.17, medium: "D263" },
            )
          }
          format={(v) => (v === "none" ? "bare specimen" : "cover slip")}
        />
        <NumberField
          label="thickness (mm)"
          value={slipOn ? spec.coverslip.thicknessMm : 0.17}
          disabled={!slipOn}
          onChange={(v) => set("coverslip", { kind: "slip", thicknessMm: v, medium: slipOn ? spec.coverslip.medium : "D263" })}
        />
        <Choice
          label="slip glass — the index comes from measured dispersion, not a slider"
          options={SLIP_MEDIA}
          value={slipOn ? spec.coverslip.medium : "D263"}
          onChange={(v) =>
            set("coverslip", {
              kind: "slip",
              thicknessMm: slipOn ? spec.coverslip.thicknessMm : 0.17,
              medium: v,
            })
          }
        />
        <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 340, margin: 0 }}>
          {live.coverslip === "corrected-for" &&
            "corrected FOR: § 6c re-solves the bending to ΣS_I = −(the plate's), so the lens alone is deliberately aberrated and the pair is stigmatic."}
          {live.coverslip === "looked-through" &&
            "looked THROUGH: § 6e.1's plane stack — slip, oil film, flat dome underside — exact to all orders, and the engine's own default for this form is a real 0.17 mm D263 slip rather than none."}
          {live.coverslip === "not-expressible" &&
            "not expressible on this form: the infinity-corrected objective's slip and the Lister's two-group target are both recorded open in the ROADMAP. Asking for one here is refused by the app, not by the engine."}
        </p>
      </Fieldset>

      <Fieldset title="two-group and immersion parameters">
        <NumberField
          label="power split (front's share)"
          value={spec.powerSplit}
          disabled={!live.listerGroups}
          onChange={(v) => set("powerSplit", v)}
        />
        <NumberField
          label="separation (in f)"
          value={spec.separationFactor}
          disabled={!live.listerGroups}
          onChange={(v) => set("separationFactor", v)}
        />
        <Choice
          label="aplanatic menisci after the dome"
          options={[0, 1, 2, 3]}
          value={spec.meniscusCount}
          onChange={(v) => set("meniscusCount", v)}
        />
        <Choice
          label="immersion fluid"
          options={IMMERSION_MEDIA}
          value={spec.immersionMedium}
          onChange={(v) => set("immersionMedium", v)}
        />
        {live.listerGroups && (
          <p style={{ fontFamily: "monospace", fontSize: 11, color: "#777", maxWidth: 300, margin: 0 }}>
            the split and the separation are <em>stated</em>, not solved — § 6d&rsquo;s solve holds
            across k ∈ [0.3, 0.8], which is what makes the aplanat a property of the form rather than
            of a lucky pick. Move them and watch ΣS_I and ΣS_II stay at zero.
          </p>
        )}
      </Fieldset>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button
          onClick={() => setSubmitted(spec)}
          disabled={!dirty}
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            padding: "6px 16px",
            border: "1px solid #333",
            background: dirty ? "#333" : "#eee",
            color: dirty ? "#fff" : "#999",
            cursor: dirty ? "pointer" : "default",
          }}
        >
          build it
        </button>
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#777" }}>
          {dirty
            ? "the form has moved — nothing recomputes until you press it"
            : result
              ? `${elapsedMs.toFixed(0)} ms — the build and its frame, then ~15 more solves to find the wall`
              : "building…"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button
          onClick={() => {
            const kept = writeSavedBuild(submitted);
            setSaved(kept ? submitted : null);
            setStorageRefused(!kept);
          }}
          // A design that does not build is not a design, and a slot holding one
          // would put a refusal on every picture panel a reader then opened.
          disabled={!result?.ok}
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            padding: "6px 16px",
            border: "1px solid #333",
            background: result?.ok ? "#fff" : "#eee",
            color: result?.ok ? "#333" : "#999",
            cursor: result?.ok ? "pointer" : "default",
          }}
        >
          keep it, and look through it
        </button>
        {saved && (
          <button
            onClick={() => {
              clearSavedBuild();
              setSaved(null);
            }}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              padding: "6px 12px",
              border: "1px solid #ccc",
              background: "#fff",
              color: "#777",
              cursor: "pointer",
            }}
          >
            forget it
          </button>
        )}
        <span style={{ fontFamily: "monospace", fontSize: 12, color: storageRefused ? "#c00" : "#777" }}>
          {storageRefused
            ? "this browser refused to store it — the picture panels will show the bench's ten rows only"
            : saved
              ? `kept: ${customLabel(saved)} — it is now an eleventh row on every panel that draws a picture, until you replace or forget it`
              : "one slot, kept in this browser. The picture panels offer the bench's ten rows and whatever is in it."}
        </span>
      </div>

      {result && !result.ok && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            border: `1px solid ${result.source === "engine" ? "#c00" : "#a60"}`,
            color: result.source === "engine" ? "#c00" : "#a60",
            padding: 12,
            maxWidth: 720,
            marginBottom: 16,
          }}
        >
          <strong>
            {result.source === "engine"
              ? "the engine refuses this design, in its own words:"
              : "this app cannot ask the engine for that:"}
          </strong>
          <br />
          {result.error}
          <br />
          <span style={{ color: "#777", fontSize: 11 }}>
            {result.source === "engine"
              ? "that message carries a measured number — it is a finding in the validation ladder, not a validation error."
              : "no engine call exists for this combination, so there is no exception to quote. This sentence is the app's."}
          </span>
        </div>
      )}

      {result?.ok && (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <Guard
              label="traced NA against this design's own wall"
              value={
                result.wall
                  ? `${result.readout.tracedNA.toFixed(4)} / ${result.wall.numericalAperture.toFixed(4)}`
                  : result.readout.tracedNA.toFixed(4)
              }
              level={
                result.wall
                  ? thresholdLevel(result.readout.tracedNA, result.wall.numericalAperture)
                  : "warn"
              }
              detail={
                result.wall
                  ? `bisected just now — ${result.wall.builds} solves, ±${result.wall.toleranceNA.toExponential(1)}, ${result.wall.elapsedMs.toFixed(0)} ms. Every other control held; the wall moves when they do.`
                  : "no refusal found below NA 4 with everything else held — a wall this panel did not reach, not a wall that is not there"
              }
            />
            <Guard
              label="σ on axis (waves)"
              value={result.readout.axisRmsWaves.toFixed(4)}
              level={thresholdLevel(result.readout.axisRmsWaves, MARECHAL_WAVES)}
              detail={`Maréchal λ/14 = ${MARECHAL_WAVES.toFixed(4)}, as traced at this system's own image plane — no best-focus solve, so red means "not at this focus", not "not correctable"`}
            />
            <Guard
              label="σ at the corner (waves)"
              value={result.readout.cornerRmsWaves.toFixed(4)}
              level={thresholdLevel(result.readout.cornerRmsWaves, MARECHAL_WAVES)}
              detail={`${result.readout.cornerLost} rays vignetted at the corner`}
            />
          </div>

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>the lens this solved to</h2>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
            <ObjectiveFacts objective={result.objective} />
          </div>

          <h2 style={{ fontSize: 15, marginBottom: 4 }}>the instrument, and the frame it covers</h2>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
            <Fact
              label="nominal / traced M"
              value={`${num(result.nominalMagnification, 2)} / ${num(Math.abs(result.readout.tracedMagnification), 2)}`}
              note="the second is the traced chief ray's; the first is what the tube length implies"
            />
            <Fact label="specimen → surface 0 (mm)" value={num(result.objectDistanceMm, 4)} />
            <Fact label="last vertex → image (mm)" value={num(result.imageDistanceMm, 3)} />
            <Fact
              label="crop on the specimen (µm)"
              value={num(result.readout.objectSpanUm, 2)}
              note={`${result.readout.resolutionCells.toFixed(1)} resolution cells at ${PUPIL_SAMPLES} pupil samples`}
            />
            <Fact label="specimen per pixel (nm)" value={num(result.readout.objectPixelNm, 1)} />
            <Fact label="image per pixel (µm)" value={num(result.readout.imagePixelUm, 4)} />
            <Fact label="λ/(2·NA) (nm)" value={num(result.readout.abbeResolutionNm, 0)} />
            <Fact
              label="ruler drift"
              value={result.readout.scaleDriftPixel.toExponential(1)}
              note="what one common ruler costs across the frame"
            />
          </div>
        </>
      )}

      <p style={{ marginTop: 16, fontSize: 13, color: "#666", maxWidth: 680 }}>
        The frame numbers are the bench&rsquo;s, unchanged and from the same function — at{" "}
        {PUPIL_SAMPLES} pupil samples on a {GRID}² grid, λ = {LAMBDA_NM} nm. The crop still spans{" "}
        <code>pupil samples</code> resolution cells whatever is built here, because that is § 6h and
        not a property of any one objective. What a builder adds is the half above it: the lens the
        engine actually <em>solved</em> — the specimen plane, the working ratio, the Lister&rsquo;s two
        bendings, the dome radius that was computed rather than chosen.
      </p>
      <p style={{ fontSize: 13, color: "#666", maxWidth: 680 }}>
        Nothing here is new physics. Every constructor has been in <code>designs/</code> since
        § 6a–§ 6e with these parameters; the catalogue simply never passed them. The ten preset
        buttons above are those rows re-expressed as points in this space — they rebuild the bench&rsquo;s
        systems identically, which is what makes this a form over the engine rather than a second
        engine.
      </p>
    </>
  );
}
