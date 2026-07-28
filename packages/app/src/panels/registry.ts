import type { ComponentType } from "react";
import { BenchPanel } from "./bench";
import { BrightfieldPanel } from "./brightfield";
import { FluorescencePanel } from "./fluorescence";
import { PhasePanel } from "./phase";
import { StagePanel } from "./stage";
import { TelescopePanel } from "./telescope";
import { VolumePanel } from "./volume";

/**
 * The panels, in reading order, and the routing table is exactly this list.
 *
 * One surface per route rather than one long scroll. That is APP.md's
 * structural item 1, and the concrete thing it fixes is that two panels carried
 * a `pupil samples` / `grid` pair each — the same engine parameters with
 * different affordable ranges — sitting side by side with no way to tell which
 * belonged to what. Routing separates them; sharing their state would not (see
 * the note in `bench.tsx`).
 *
 * A panel owns its own controls and its own state, so switching routes
 * unmounts it and terminates its workers. That costs a re-trace on return —
 * ~550 ms for the bench catalogue — and it is the honest trade: nothing keeps
 * computing behind a tab you are not looking at, and every panel already shows
 * its own elapsed time while it catches up.
 *
 * `id` is the URL hash, so a route survives a reload and can be linked to.
 */
export type Panel = {
  readonly id: string;
  /** How the nav reads. Short — it sits in a row. */
  readonly label: string;
  /** One line under the nav, saying what the surface is for. */
  readonly blurb: string;
  readonly Component: ComponentType;
};

export const PANELS: readonly Panel[] = [
  {
    id: "telescope",
    label: "star & field",
    blurb: "roadmap step 4 — chromatic fringing, and a field-varying PSF across 25 stars",
    Component: TelescopePanel,
  },
  {
    id: "bench",
    label: "microscope bench",
    blurb: "APP.md A1 — every objective traced, and the crop a frame actually covers",
    Component: BenchPanel,
  },
  {
    id: "brightfield",
    label: "brightfield",
    blurb: "APP.md A2 — the condenser, the Abbe sum, and where the cutoff really lands",
    Component: BrightfieldPanel,
  },
  {
    id: "phase",
    label: "the phase null",
    blurb: "APP.md A3 — a specimen that absorbs nothing, and the term that survives it",
    Component: PhasePanel,
  },
  {
    id: "fluorescence",
    label: "fluorescence beads",
    blurb: "APP.md A4 — a specimen that emits, and the cutoff reached with no condenser",
    Component: FluorescencePanel,
  },
  {
    id: "stage",
    label: "the stage",
    blurb: "APP.md A7 — a field of view reached by tiling, and a tile that knows its own index",
    Component: StagePanel,
  },
  {
    id: "volume",
    label: "haze & the focus stack",
    blurb: "APP.md A5 — every plane delivers its whole flux, and the missing cone that follows",
    Component: VolumePanel,
  },
];

/** The route a bare or unknown hash lands on — the first entry, so the nav's
 * reading order and the default are the same fact stated once. */
const DEFAULT_PANEL = PANELS[0]!;

export function panelFor(hash: string): Panel {
  const id = hash.replace(/^#\/?/, "");
  return PANELS.find((p) => p.id === id) ?? DEFAULT_PANEL;
}
