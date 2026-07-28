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
