/**
 * The controls every panel shares, and nothing else.
 *
 * Deliberately not a component library: a panel's readouts are its own, because
 * each one says a different engine number with its own threshold. APP.md's
 * structural item 4 — one shared guard readout with one way of turning red — is
 * still open, and it lands with the next surface that needs one rather than
 * being invented here for panels that already have theirs.
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
