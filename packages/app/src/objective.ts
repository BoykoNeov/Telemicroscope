import type { BuildSpec } from "./builder";
import { MICROSCOPE_CATALOG, type MicroscopeKind } from "./microscope";

/**
 * The objective picker every imaging panel shows — the catalogue, plus the one
 * build a reader saved. APP.md's Part F.
 *
 * ## Why this is not six copies of a `find`
 *
 * Six panels held the same two lines: `options={MICROSCOPE_CATALOG.map(e =>
 * e.kind)}` and `format={k => MICROSCOPE_CATALOG.find(e => e.kind === k)!.label}`.
 * The `!` is the reason this module exists — it is the assertion that every
 * selectable objective is a catalogue row, and Part F's whole content is that it
 * is not. Six non-null assertions against a list that grew an eleventh member is
 * six `undefined.label`s, so the lookup moves here and returns the entry rather
 * than asserting one.
 *
 * ## The one rule the caption layer inherits
 *
 * An `Objective` carries a `note` that is `null` for a saved build, and callers
 * are expected to *print nothing* rather than print something else. The
 * catalogue's notes are one-line measured teachings written against a specific
 * lens ("the span shrinks as 1/NA — 93.5 → 62.0 µm"); beside a design nobody has
 * measured they would be false. A5's rule, which this repo already applies to
 * stale plots, applied to prose.
 */

/** The id a panel keeps in state. A catalogue kind, or the saved slot. */
export type ObjectiveId = MicroscopeKind | "custom";

export interface Objective {
  readonly id: ObjectiveId;
  readonly spec: BuildSpec;
  readonly label: string;
  /** The catalogue's one-line teaching. `null` for a build nobody described. */
  readonly note: string | null;
  /** Whether the caption layer may name measured facts about this design. */
  readonly custom: boolean;
}

/**
 * A saved build's own label, read off the spec.
 *
 * Engraved the way a real objective is — magnification, aperture, and the thing
 * about the design a reader would say out loud — because the alternative is a
 * name they have to have typed, and Part F's slot deliberately holds one build
 * rather than a library that would need naming and deletion.
 */
export function customLabel(spec: BuildSpec): string {
  const form =
    spec.form === "oil"
      ? "oil"
      : spec.form === "lister"
        ? "Lister"
        : spec.architecture === "din"
          ? "DIN"
          : "infinity";
  return `your ${form} ${spec.magnification}×/${spec.numericalAperture}`;
}

const fromEntry = (entry: (typeof MICROSCOPE_CATALOG)[number]): Objective => ({
  id: entry.kind,
  spec: entry.spec,
  label: entry.label,
  note: entry.note,
  custom: false,
});

/**
 * Everything selectable right now: the ten rows, and the slot if it holds one.
 *
 * `saved` is passed in rather than read here, and that is load-bearing rather
 * than tidy. `readSavedBuild` parses a string, so calling it during a render
 * would hand back a **fresh spec object every time** — and a spec is what the
 * request memo is keyed on, so the request would change identity on every
 * render, the effect behind it would refire, and a panel would re-trace forever
 * while typecheck and vitest both stayed green. Panels read the slot once, at
 * mount.
 */
export function objectiveOptions(saved: BuildSpec | null): readonly Objective[] {
  const rows = MICROSCOPE_CATALOG.map(fromEntry);
  if (saved === null) return rows;
  return [
    ...rows,
    { id: "custom", spec: saved, label: customLabel(saved), note: null, custom: true },
  ];
}

/**
 * The selected objective, or the first row.
 *
 * The fallback is reachable in exactly one way — a panel mounted with `custom`
 * selected and no slot — which routing makes impossible today, since a panel
 * reads the slot as it mounts and cannot be mounted across a clear. It resolves
 * to a real catalogue row rather than to a null the six call sites would each
 * have to spend, and every panel shows which objective it drew from.
 */
export function objectiveOf(options: readonly Objective[], id: ObjectiveId): Objective {
  return options.find((o) => o.id === id) ?? options[0]!;
}
