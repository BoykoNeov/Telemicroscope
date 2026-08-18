import { useMemo, useState } from "react";
import { Plot, type PlotSeries } from "../plot";
import {
  OPTIMIZE_LINES,
  OPTIMIZE_SEEDS,
  defaultSpec,
  describeOptimize,
  optimizeSeedById,
  type Currency,
  type OptimizeSeedId,
  type OptimizeSpec,
  type Wish,
} from "../optimize";
import { Choice, Fact, Fieldset, Guard, NumberField, num, type GuardLevel } from "../ui";
import { refusalVoice } from "../refusal";

/**
 * Design mode's second half: the panel that asks the engine for a compromise.
 *
 * Part M asks what a number has to be and gets a root. This asks for several
 * things at once and gets the best available disappointment — which is what a
 * real design question is, and it changes what a screen has to show.
 *
 * **The answer block is one box on purpose.** § 1.8's sharpest measurement is a
 * run that stops with its convergence test satisfied while sitting 400 mm from
 * the target, so "stopped because" and "here is what you did not get" are
 * printed together, per wish, in the wish's own unit. Splitting them across two
 * sections would lose the finding this panel exists to teach.
 *
 * Runs inline on every keystroke, like Part M and for the same reason: every
 * residual here is a paraxial trace or a third-order sum. The whole readout —
 * the optimisation, up to 48 replays of it for the convergence trail, a
 * single-variable control, a second-start control and a thin-lens control — is
 * 0.1 to 20 ms in this browser, against 0.7–1.9 ms for Part M.
 */

const CURRENCIES: readonly Currency[] = ["power", "focal"];
const ITERATION_CAPS = [3, 10, 30, 100] as const;
const OFFSETS = [0.02, 0.08, 0.25, 1] as const;
/** log₁₀ of a merit that reached zero — there is no such point on a log axis. */
const LOG_FLOOR = -40;

const logOf = (v: number): number =>
  !Number.isFinite(v) || v <= 0 ? LOG_FLOOR : Math.max(LOG_FLOOR, Math.log10(v));

/** How badly a wish was missed, as a colour. Relative to its own target. */
function wishLevel(relative: number): GuardLevel {
  if (!Number.isFinite(relative)) return "bad";
  if (relative < 1e-6) return "ok";
  if (relative < 1e-2) return "warn";
  return "bad";
}

const REASON_GLOSS: Record<string, string> = {
  gradient:
    "the merit stopped responding to every variable at once. That is what an optimum looks like — and also what a plateau looks like, which is why the leftovers above are the reading and this is not",
  step: "the steps got shorter than the variables' own precision",
  merit: "an accepted step changed the merit by less than a part in 10¹⁵",
  iterations: "it ran out of the iterations it was allowed — this is not a converged answer and does not claim to be",
  damping: "every step failed, however short: the damping grew past every scale in the problem",
};

export function OptimizePanel() {
  const [spec, setSpec] = useState<OptimizeSpec>(defaultSpec);

  const pickSeed = (id: OptimizeSeedId) => {
    const seed = optimizeSeedById(id);
    setSpec((s) => ({ ...s, seed: id, wishes: seed.wishes }));
  };
  const patch = (part: Partial<OptimizeSpec>) => setSpec((s) => ({ ...s, ...part }));
  const patchWish = (index: number, part: Partial<Wish>) =>
    setSpec((s) => ({
      ...s,
      wishes: s.wishes.map((w, i) => (i === index ? { ...w, ...part } : w)),
    }));

  const seed = optimizeSeedById(spec.seed);
  const result = useMemo(() => describeOptimize(spec), [spec]);

  const controls = (
    <Controls spec={spec} seedId={spec.seed} pickSeed={pickSeed} patch={patch} patchWish={patchWish} />
  );

  if (!result.ok) {
    return (
      <>
        <Heading />
        {controls}
        <p style={{ color: "#c00", maxWidth: 640, fontFamily: "monospace", fontSize: 13 }}>
          {refusalVoice(result.source, "this merit")}: {result.error}
        </p>
      </>
    );
  }

  const { trail, wishes, single, basin, reference } = result;
  const meritSeries: PlotSeries[] = [
    {
      label: "merit",
      color: "#c0392b",
      width: 1.8,
      dots: trail.length <= 48,
      points: trail.map((p) => [p.work, logOf(p.merit)] as const),
    },
  ];
  const wishSeries: PlotSeries[] = wishes.map((w, i) => ({
    label: w.label,
    color: WISH_COLORS[i % WISH_COLORS.length]!,
    width: 1.8,
    points: trail.map((p) => [p.work, logOf(p.relative[i]!)] as const),
  }));
  const meritLo = Math.min(...meritSeries[0]!.points.map((p) => p[1]));
  const meritHi = Math.max(...meritSeries[0]!.points.map((p) => p[1]));
  const wishValues = wishSeries.flatMap((s) => s.points.map((p) => p[1]));
  const wishLo = wishValues.length > 0 ? Math.min(...wishValues) : -1;
  const wishHi = wishValues.length > 0 ? Math.max(...wishValues) : 1;

  return (
    <>
      <Heading />
      <p style={{ maxWidth: 700, color: "#444" }}>
        Part M asks what one number has to be, and there is an answer. This asks for several things
        at once with fewer freedoms than wishes, and what comes back is a <em>compromise</em> — so
        the leftover error is part of the answer rather than a diagnostic. The box below prints why
        the optimiser stopped and what each wish did not get, together, because those two readings
        can disagree: on the currency seed it stops with its convergence test satisfied while sitting
        150 mm from the focal length it was asked for.
      </p>

      {controls}
      <p style={{ maxWidth: 700, color: "#666", fontSize: 13, marginTop: -4 }}>
        <strong>{seed.label}</strong> — {seed.note}
      </p>

      <div
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          padding: "10px 14px",
          border: "1px solid #ddd",
          background: "#fafafa",
          display: "inline-block",
          minWidth: 520,
          marginBottom: 14,
        }}
      >
        {result.from.map((v, i) => (
          <div key={i} style={{ fontSize: 15 }}>
            {seed.variableLabels[i]}{" "}
            <span style={{ color: "#999" }}>{v.toPrecision(9)} →</span>{" "}
            <strong>{result.to[i]!.toPrecision(10)}</strong>{" "}
            <span style={{ color: "#999" }}>{seed.variableUnits[i]}</span>
          </div>
        ))}
        <div style={{ marginTop: 8, color: "#555" }}>
          stopped because:{" "}
          <strong style={{ color: result.reason === "iterations" ? "#c60" : "#333" }}>
            {result.reason}
          </strong>
          <div style={{ fontSize: 11, color: "#888", maxWidth: 520 }}>
            {REASON_GLOSS[result.reason]}
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          {wishes.map((w, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              <Guard
                label={`${w.label}: wanted ${num(w.target, 6)} ${w.unit}, got`}
                value={`${Number.isFinite(w.value) ? w.value.toPrecision(10) : "no such lens"} ${w.unit}`}
                level={wishLevel(w.relative)}
                detail={`leftover ${w.leftover.toExponential(3)} ${w.unit} — ${w.relative.toExponential(2)} of what was asked for. Weight ${w.weight}, and the merit saw this wish in ${w.solvedUnit}`}
              />
            </div>
          ))}
        </div>
        {result.builtIsAfocal && (
          <div style={{ color: "#c00", marginTop: 8 }}>
            The lens this answer names is afocal: it has no focal length at all.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={meritSeries}
          xLabel="iterations spent (accepted and rejected alike)"
          yLabel="log₁₀ merit"
          xMin={0}
          xMax={Math.max(1, result.iterations)}
          yMin={Math.min(meritLo, meritHi - 1)}
          yMax={meritHi + 0.5}
          width={430}
        />
        <Plot
          series={wishSeries}
          xLabel="iterations spent"
          yLabel="log₁₀ of each wish's relative miss"
          xMin={0}
          xMax={Math.max(1, result.iterations)}
          yMin={Math.min(wishLo, wishHi - 1)}
          yMax={wishHi + 0.5}
          width={430}
        />
      </div>
      <p style={{ maxWidth: 880, color: "#666", fontSize: 13 }}>
        Both curves are drawn by running the optimiser again with its iteration cap set to 1, 2,
        3 … The algorithm is deterministic, so a capped run <em>is</em> the longer run&rsquo;s prefix
        — this panel&rsquo;s test pins that on every field the result carries, not just on the
        answer. The x axis is therefore <strong>work</strong> and not progress: a rejected step
        spends an iteration and moves nothing, and a run that starts with a flat stretch is the
        damping being raised until a step fits. This run spent {result.accepted} accepted steps and{" "}
        {result.rejected} rejected ones.
        {trail.length < result.iterations &&
          ` The trail is sampled at ${trail.length} of them, because a capped run at k costs O(k) and drawing every one is quadratic.`}
      </p>

      {single !== null && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24 }}>One number against two, on the same lens</h2>
          <p style={{ maxWidth: 700, color: "#444", fontSize: 14 }}>
            Part M measured that retargeting this achromat through a single curvature hits the focal
            length exactly and spends the colour correction the lens exists for. Both sides are
            recomputed here rather than quoted, so they cannot drift apart: the same target, the same
            lens, one freedom against two.
          </p>
          <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#777", textAlign: "left" }}>
                <th style={CELL}>solve</th>
                <th style={CELL}>focal length (mm)</th>
                <th style={CELL}>F − C spread (mm)</th>
                <th style={CELL}>× the lens as shipped</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={CELL}>as shipped</td>
                <td style={CELL}>{num(result.startEflMm, 4)}</td>
                <td style={CELL}>{result.spreadBeforeMm.toExponential(4)}</td>
                <td style={CELL}>1</td>
              </tr>
              <tr>
                <td style={CELL}>one variable ({single.label})</td>
                <td style={CELL}>{single.refused ?? single.eflMm.toPrecision(10)}</td>
                <td style={CELL}>{single.spreadMm.toExponential(4)}</td>
                <td style={{ ...CELL, color: "#c00" }}>{num(Math.abs(single.spreadRatio), 2)}×</td>
              </tr>
              <tr>
                <td style={CELL}>both, with the colour as a wish</td>
                <td style={CELL}>{num(result.wishes[0]?.value ?? Number.NaN, 6)}</td>
                <td style={CELL}>{result.spreadAfterMm.toExponential(4)}</td>
                <td style={{ ...CELL, color: "#2b7" }}>
                  {num(Math.abs(result.spreadAfterMm / result.spreadBeforeMm), 2)}×
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ maxWidth: 700, color: "#666", fontSize: 13 }}>
            The two-variable answer is better corrected than the lens it started from, and that is
            worth saying out loud: it is the numerical power split that VALIDATION § 5j.2
            deliberately <em>refused</em> to build. Solving the split until a thick doublet united F
            and C would have made that step&rsquo;s headline chromatic rung true by construction and
            worth nothing. Here it is exactly what you want. Same computation, opposite verdict —
            the difference is whether you are designing or validating.
          </p>
        </>
      )}

      {reference !== null && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24 }}>Against the closed form</h2>
          {reference.kind === "thin-split" ? (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {reference.expected.map((e, i) => (
                <Fact
                  key={i}
                  label={`${seed.variableLabels[i]} — textbook`}
                  value={e.toPrecision(12)}
                  note={`found ${reference.found[i]!.toPrecision(12)}, a relative ${Math.abs(reference.found[i]! / e - 1).toExponential(2)}`}
                />
              ))}
              <Fact label={reference.label} value="exact here" note={reference.note} />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <Fact
                label="shape factor found"
                value={reference.shapeFactor!.toPrecision(9)}
                note={`q = (c₁+c₂)/(c₁−c₂), from the two curvatures above`}
              />
              <Fact
                label={reference.label}
                value={reference.shapeFactorStar!.toPrecision(9)}
                note="the published minimum, which is a THIN-lens result"
              />
              <Guard
                label="gap on this lens"
                value={reference.gapHere!.toExponential(3)}
                level={Math.abs(reference.gapHere!) < 1e-2 ? "warn" : "bad"}
                detail={`this singlet is ${reference.thicknessMm} mm thick, and a real thickness genuinely moves the best shape — the gap is linear in it`}
              />
              <Guard
                label="the same solve on a 1 nm version"
                value={reference.gapThin!.toExponential(3)}
                level={Math.abs(reference.gapThin!) < 1e-4 ? "ok" : "bad"}
                detail="the control that separates the two causes: what is left here is the weighted constraint, which holds the focal length only to O(1/weight). Raise the focal weight and watch it shrink — then keep raising it and watch it come back, because the aberration term stops being visible in the merit at all"
              />
            </div>
          )}
        </>
      )}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>The basin, which is all a descent can report</h2>
      <p style={{ maxWidth: 700, color: "#444", fontSize: 14 }}>
        Part M&rsquo;s solver scans an interval and reports <em>every</em> root in it. A descent
        method cannot: it reports where it rolled to from where it started. So this panel starts a
        second run {Math.round(basin.offset * 100)}% away from the design and says whether the two
        agreed.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Guard
          label={`a second start, +${Math.round(basin.offset * 100)}%`}
          value={basin.refused !== null ? "refused" : basin.agreed ? "same answer" : "a different lens"}
          level={basin.refused !== null ? "bad" : basin.agreed ? "ok" : "warn"}
          detail={
            basin.refused !== null
              ? basin.refused
              : basin.agreed
                ? `the two runs agree to ${basin.worstRelative.toExponential(2)} relative on every variable — which is evidence about this basin and not a proof there is only one`
                : `the worst variable differs by ${basin.worstRelative.toExponential(2)} relative, at merit ${basin.merit.toExponential(3)} against ${result.merit.toExponential(3)}. Both are answers to the question you asked; the optimiser has no way to tell you about the one you did not land in`
          }
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>The lens this answer names</h2>
      <table style={{ fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#777", textAlign: "left" }}>
            <th style={CELL}>line</th>
            <th style={CELL}>EFL (mm)</th>
            <th style={CELL}>BFD (mm)</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((l) => (
            <tr key={l.nm}>
              <td style={CELL}>{l.name}</td>
              <td style={CELL}>{num(l.eflMm, 5)}</td>
              <td style={CELL}>{num(l.bfdMm, 5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ maxWidth: 700, color: "#999", fontSize: 12 }}>
        The solve holds at one line — d, {num(OPTIMIZE_LINES[1]!.nm, 1)} nm — and the other two are
        what the glasses do with it. A colour wish is the only thing here that makes them agree.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 24 }}>
        <Fact
          label="work"
          value={`${result.iterations} iterations, ${result.evaluations} evaluations`}
          note={`${result.accepted} accepted, ${result.rejected} rejected. An evaluation is one residual vector: the Jacobian costs two per variable per iteration, because the differences are central`}
        />
        <Fact
          label="damping at the stop"
          value={result.damping.toExponential(3)}
          note="λ, scaled per variable by how strongly the merit already responds to it. It rises when a step fails and relaxes when one succeeds — a large value at the end means the optimiser was pinned against something"
        />
        <Fact
          label="gradient measure"
          value={result.gradient.toExponential(3)}
          note="the cosine between the residual vector and the Jacobian's columns, so it is free of every unit and weight in the problem. With a single wish there is nothing for it to be orthogonal to and it stays at 1 until the residual is zero"
        />
        <Fact
          label="elapsed"
          value={`${result.elapsedMs.toFixed(2)} ms`}
          note={`the optimisation, ${result.trail.length} replays for the trail, and the controls. Every residual is a paraxial trace or a third-order sum; a merit over traced quantities is measured rather than guessed: 430× a third-order sum for an RMS spot (§ 1.8.5), 4.1× that again for a wavefront (§ 1.8.7) and ~7 000× for an MTF at a frequency (§ 1.8.8), and none of the three is offered here`}
        />
        <Fact
          label="what pins the machinery"
          value="VALIDATION § 1.8"
          note="two merits whose minimisers are known in closed form — Coddington's best form recovered rather than evaluated, and the achromat's power split on a fixture where both wishes reach zero together"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>What this does not do</h2>
      <ul style={{ maxWidth: 700, color: "#444", fontSize: 14, lineHeight: 1.6 }}>
        <li>
          <strong>No traced targets here — the engine has them.</strong> Every wish on this panel
          is first-order or third-order. The engine gained an RMS-spot merit, and both halves of
          what this bullet used to guess at were measured and wrong: a traced residual is 430× a
          third-order sum rather than four orders, and it carries no sampling noise at all — over a
          fixed ray set it differences cleanly across ten decades of step. What bites is a ray
          leaving the surviving set, which the engine handles by holding the set. § 1.8.7 then added the wavefront — an RMS
          over the fitted map, and one named Zernike coefficient with a target of its own — at
          4.1× the spot again, and § 1.8.8 the MTF at a frequency, at ~7 000× a third-order sum
          and with a merit that is genuinely multimodal: a design 133× worse than
          diffraction-limited can match a perfect one at one frequency to 2.8e-4. What is missing here is the wiring and a cost decision: at 430× a
          residual, and a convergence trail that replays the run up to 48 times, this
          panel&rsquo;s millisecond readout becomes seconds.
        </li>
        <li>
          <strong>No conditions here — the engine has those too.</strong> &ldquo;Hold the focal
          length <em>exactly</em> while minimising aberration&rdquo; is a different mathematical
          object from a wish with a big weight, and the engine now solves it as one. What it buys is
          not a more accurate answer, which is what everyone expected: it is the focal length held
          to the last bit instead of to a part in ten million, a multiplier that says what holding
          it is costing in aberration, and no weight to guess at. This panel still asks by weight,
          so the two gaps below are what a weight looks like.
        </li>
        <li>
          <strong>The variables are the seed&rsquo;s.</strong> Choosing which numbers a design may
          move is the next control this panel wants, and it is a bigger question than it looks: two
          variables that do nearly the same thing are what the damping exists to survive, and a
          panel that lets you pick them should say so when you have.
        </li>
        <li>
          <strong>No writing back.</strong> As in Part M, an answer is a set of values; building the
          lens is a separate explicit step, and sending one to the bench editor would couple two
          panels&rsquo; state in the way the registry exists to prevent.
        </li>
      </ul>
    </>
  );
}

const WISH_COLORS = ["#36c", "#c0392b", "#2b7", "#c60"] as const;
const CELL = { padding: "2px 10px 2px 0", borderBottom: "1px solid #eee" } as const;

function Heading() {
  return (
    <h1 style={{ fontSize: 20 }}>Design mode: what is the best this lens can do?</h1>
  );
}

function Controls(props: {
  spec: OptimizeSpec;
  seedId: OptimizeSeedId;
  pickSeed: (id: OptimizeSeedId) => void;
  patch: (part: Partial<OptimizeSpec>) => void;
  patchWish: (index: number, part: Partial<Wish>) => void;
}) {
  const { spec, patch } = props;
  return (
    <>
      <Fieldset title="the lens, and what may move">
        <Choice
          label="seed"
          options={OPTIMIZE_SEEDS.map((s) => s.id)}
          value={spec.seed}
          onChange={props.pickSeed}
          format={(id) => optimizeSeedById(id).label}
        />
      </Fieldset>
      <Fieldset title="the wishes — a target, and what it is worth against the others">
        {spec.wishes.map((w, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <NumberField
              label={`${w.label} (${w.unit})`}
              value={w.target}
              onChange={(target) => props.patchWish(i, { target })}
              width={110}
            />
            <NumberField
              label="weight"
              value={w.weight}
              onChange={(weight) => props.patchWish(i, { weight })}
              width={80}
            />
          </div>
        ))}
        <p style={{ maxWidth: 420, color: "#999", fontSize: 11, margin: "4px 0 0" }}>
          The merit is the sum of the squared weighted misses, so a weight is an exchange rate
          between quantities in different units — how many millimetres of focus one diopter is worth.
          Nothing physical fixes it. Where every wish can be granted at once, as on the thin doublet,
          the answer does not depend on these at all.
        </p>
      </Fieldset>
      <Fieldset title="the currency a focal-length wish is asked in">
        <Choice
          label="ask for"
          options={CURRENCIES}
          value={spec.currency}
          onChange={(currency) => patch({ currency })}
          format={(c) => (c === "power" ? "power, 1/f" : "focal length, f")}
        />
        <p style={{ maxWidth: 420, color: "#999", fontSize: 11, margin: "4px 0 0" }}>
          The same wish, in two units. It changes the answer on every seed here — in millimetres a
          focal-length miss is a million times larger than the same miss in diopters, so it swamps
          whatever else the merit wanted, and where the target is on the far side of an afocal
          configuration it cannot be reached at all.
        </p>
      </Fieldset>
      <Fieldset title="how hard to try">
        <Choice
          label="iteration cap"
          options={ITERATION_CAPS}
          value={spec.maxIterations as (typeof ITERATION_CAPS)[number]}
          onChange={(maxIterations) => patch({ maxIterations })}
        />
        <Choice
          label="second start, away by"
          options={OFFSETS}
          value={spec.startOffset as (typeof OFFSETS)[number]}
          onChange={(startOffset) => patch({ startOffset })}
          format={(o) => `${Math.round(o * 100)}%`}
        />
      </Fieldset>
    </>
  );
}
