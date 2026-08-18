import { useEffect, useState } from "react";

/**
 * The controls every panel shares, plus the one readout they share — APP.md's
 * structural item 4, landed with A3.
 *
 * It is still not a component library: a panel's ordinary readouts stay its own,
 * because each says a different engine number in its own words. What is shared
 * is narrower and load-bearing — **the way a guard turns red**. Every surface in
 * this app puts an engine threshold on screen (`truncatedFraction`,
 * `geometricWeight`, `seeingPhaseStepWaves`, `fidelity.verdict`,
 * `maxGridPhaseStepWaves`), and APP.md's rule is that they must look the same
 * and turn red the same way, because a reader who has learned that red means
 * "the engine says do not trust this" should not have to re-learn it per panel.
 *
 * The rule the doc attached to this — *"the next surface that needs a guard
 * readout extracts it rather than copying it"* — means A2's local
 * `VERDICT_COLOR` moved here in the same change that added A3's. A shared
 * component sitting beside a private copy would have made the problem worse
 * rather than solved it.
 */

/** A small radio row — for axes that take a few discrete values, not a range. */
export function Choice<T extends string | number>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** How the button reads, when the value itself is a key rather than a label. */
  format?: (value: T) => string;
}) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
      {props.label}
      <br />
      {props.options.map((option) => (
        <button
          key={option}
          onClick={() => props.onChange(option)}
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            marginRight: 4,
            padding: "2px 8px",
            border: option === props.value ? "1px solid #333" : "1px solid #ccc",
            background: option === props.value ? "#333" : "#fff",
            color: option === props.value ? "#fff" : "#333",
            cursor: "pointer",
          }}
        >
          {props.format ? props.format(option) : option}
        </button>
      ))}
    </div>
  );
}

/**
 * `Choice` where the answer is a SET rather than one of the options.
 *
 * A separate component and not a flag on `Choice`, because the two ask
 * different questions and a control that silently changes what a click means is
 * worse than two controls. Selected options carry the same filled style, so a
 * reader who has met one has met both; what differs is that clicking a
 * selected one takes it out again.
 */
export function Toggles<T extends string>(props: {
  label: string;
  options: readonly T[];
  values: readonly T[];
  onToggle: (value: T) => void;
  format?: (value: T) => string;
  /** A note under an option — what it is, or what it would cost to free it. */
  note?: (value: T) => string | undefined;
}) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
      {props.label}
      <br />
      {props.options.map((option) => {
        const on = props.values.includes(option);
        const note = props.note?.(option);
        return (
          <button
            key={option}
            onClick={() => props.onToggle(option)}
            title={note}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              marginRight: 4,
              marginBottom: 4,
              padding: "2px 8px",
              border: on ? "1px solid #333" : "1px solid #ccc",
              background: on ? "#333" : "#fff",
              color: on ? "#fff" : "#333",
              cursor: "pointer",
            }}
          >
            {on ? "✓ " : ""}
            {props.format ? props.format(option) : option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Three states, and the middle one is not a shade of green.
 *
 * `warn` exists because § 6f.9's verdict has three values and the middle one is
 * `unknown` — the engine declining to rule, which is a different statement from
 * both "fine" and "broken" and must not be rounded to either. Numeric guards
 * borrow the same three: below the threshold, approaching it, past it.
 */
export type GuardLevel = "ok" | "warn" | "bad";

export const GUARD_COLOR: Record<GuardLevel, string> = {
  ok: "#3a7",
  warn: "#a60",
  bad: "#c00",
};

/** § 6f.9's `BrightfieldVerdict`, in this file's three colours. */
export const VERDICT_LEVEL: Record<"valid" | "unknown" | "no-honest-image", GuardLevel> = {
  valid: "ok",
  unknown: "warn",
  "no-honest-image": "bad",
};

/**
 * A number against a ceiling it must stay under.
 *
 * `warn` at 80% of the way there, so a slider being walked toward a wall says so
 * before it hits it. Both bounds are the caller's: this file knows about
 * colours, not about which engine numbers mean what.
 */
export function thresholdLevel(value: number, bad: number, warnFraction = 0.8): GuardLevel {
  if (!Number.isFinite(value)) return "warn";
  if (value >= bad) return "bad";
  return value >= bad * warnFraction ? "warn" : "ok";
}

/**
 * One guard: what the engine measured, what it is allowed to be, and the colour.
 *
 * `detail` is where the engine's own words go — a verdict's `reason`, a
 * threshold's units. It is deliberately a separate slot rather than something
 * the caller concatenates, so that every guard in the app puts the machine's
 * explanation in the same place and the same grey.
 */
export function Guard(props: {
  label: string;
  value: string;
  level: GuardLevel;
  detail?: string;
}) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ color: GUARD_COLOR[props.level] }}>
        {props.label} <strong>{props.value}</strong>
      </span>
      {props.detail !== undefined && (
        <>
          <br />
          <span style={{ color: "#777" }}>{props.detail}</span>
        </>
      )}
    </div>
  );
}

/**
 * A free-typed number — extracted from `builder.tsx` the day its own note said
 * it would be ("it moves the day a second form exists"), which is the bench
 * editor.
 *
 * It keeps a draft string so that typing "0." or "1.4" does not get rounded out
 * from under the cursor, and reports the parse rather than swallowing it: an
 * unparseable field leaves the last good value in the model and marks itself
 * red, instead of silently committing something the caller did not type.
 *
 * `Infinity` is accepted and round-trips, because the editor's plane is R = ∞
 * and an unbounded aperture is `semiAperture: Infinity` — both are values the
 * schema means, not overflow. `label` is optional: in a table the column heading
 * has already said what the cell is, and repeating it per row would be noise.
 */
export function NumberField(props: {
  label?: string;
  value: number;
  disabled?: boolean;
  width?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  // NaN rather than "not finite": ±Infinity is a value the schema means (a plane
  // is R = ∞, an unbounded rim is semiAperture ∞), and `String(Infinity)` is
  // what this field shows, so what it shows is also what it accepts back.
  const parsed = Number(draft);
  const bad = draft.trim() === "" || Number.isNaN(parsed);
  return (
    <label
      style={{
        fontFamily: "monospace",
        fontSize: 12,
        opacity: props.disabled ? 0.35 : 1,
        display: "block",
      }}
    >
      {props.label !== undefined && (
        <>
          {props.label}
          <br />
        </>
      )}
      <input
        type="text"
        inputMode="decimal"
        disabled={props.disabled}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== "" && !Number.isNaN(next)) props.onChange(next);
        }}
        style={{
          fontFamily: "monospace",
          fontSize: 12,
          width: props.width ?? 90,
          padding: "2px 4px",
          border: `1px solid ${bad ? "#c00" : "#ccc"}`,
        }}
      />
    </label>
  );
}

/**
 * A titled group of controls, and one labelled engine number — the rest of what
 * a *form* needs, extracted alongside `NumberField` for the same reason and in
 * the same change.
 *
 * These are containers, not readouts: the words inside a `Fact` stay the
 * panel's, exactly as this file's header requires. What is shared is that two
 * forms in one app should not put their labels in different greys.
 */
export function Fieldset(props: { children: React.ReactNode; title: string }) {
  return (
    <fieldset
      style={{
        border: "1px solid #ddd",
        padding: "8px 12px 12px",
        marginBottom: 12,
        display: "flex",
        gap: 20,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      <legend style={{ fontFamily: "monospace", fontSize: 11, color: "#777" }}>{props.title}</legend>
      {props.children}
    </fieldset>
  );
}

export function Fact(props: { label: string; value: string; note?: string }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, minWidth: 190 }}>
      <span style={{ color: "#777" }}>{props.label}</span>
      <br />
      <strong>{props.value}</strong>
      {props.note && (
        <>
          <br />
          <span style={{ color: "#999", fontSize: 11 }}>{props.note}</span>
        </>
      )}
    </div>
  );
}

/** Fixed point where it reads, exponent where it would not. */
export const num = (value: number, digits = 3): string =>
  !Number.isFinite(value)
    ? String(value)
    : Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 1e-3)
      ? value.toExponential(2)
      : value.toFixed(digits);

export function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ fontFamily: "monospace", fontSize: 12 }}>
      {props.label}
      <br />
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * Which objective the picture above was drawn through, in the voice its design
 * has earned — Part F's decision 3, as the smaller of its two halves.
 *
 * A catalogue row carries a one-line measured teaching, and that line is quoted.
 * A build a reader composed carries none, and this prints **that** rather than
 * borrowing the nearest row's — A4's rule ("a stale reading may be shown greyed
 * only if nothing on screen misdescribes it") is about numbers, and a sentence
 * naming a lens that is not on screen is the same failure with worse manners.
 *
 * It is shared for `ui.tsx`'s stated reason: six panels need it, and the one
 * thing worse than six copies of a rule about honesty is six copies that drift.
 */
export function ObjectiveLine(props: {
  label: string;
  /** The catalogue's line. `null` for a design nothing here has measured. */
  note: string | null;
}) {
  return (
    <p>
      <strong>{props.label}</strong>
      {props.note === null ? (
        <>
          {" — "}
          <span style={{ color: "#a60" }}>
            your own build. Nothing in this app has measured it, so the numbers quoted in the prose
            on this page are about the ten bench rows and not about this lens. The readouts and
            plots are live and are about this one.
          </span>
        </>
      ) : (
        <>
          {" — "}
          {props.note}
        </>
      )}
    </p>
  );
}
