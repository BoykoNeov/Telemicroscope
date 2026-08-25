import type { ComponentType } from "react";
import { decodeLink, type TeachingLink } from "../teaching";
import { BenchPanel } from "./bench";
import { ChromaticPanel } from "./chromatic";
import { BrightfieldPanel } from "./brightfield";
import { BuilderPanel } from "./builder";
import { CameraPanel } from "./camera";
import { CollimationPanel } from "./collimation";
import { CoverslipPanel } from "./coverslip";
import { CurvaturePanel } from "./curvature";
import { DesignPanel } from "./design";
import { EditorPanel } from "./editor";
import { EyepiecePanel } from "./eyepiece";
import { FluorescencePanel } from "./fluorescence";
import { MechPanel } from "./mech";
import { PhasePanel } from "./phase";
import { RayFanPanel } from "./rayfan";
import { ReflectorPanel } from "./reflector";
import { SectionPanel } from "./section";
import { SeeingPanel } from "./seeing";
import { SkyPanel } from "./sky";
import { SpotPanel } from "./spot";
import { StagePanel } from "./stage";
import { TelecentricPanel } from "./telecentric";
import { TelescopePanel } from "./telescope";
import { TolerancePanel } from "./tolerance";
import { WavefrontPanel } from "./wavefront";
import { MtfPanel } from "./mtf";
import { OptimizePanel } from "./optimize";
import { VisualPanel } from "./visual";
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
 *
 * Since Part H that sentence is load-bearing rather than a nicety: a teaching
 * link is a route *plus a query* (`#/rayfan?v=1&lens=achromat&…`), and the panel
 * it lands on seeds itself from what the query says. See `resolveHash` below for
 * the bug that shape walked into.
 */
export type Panel = {
  readonly id: string;
  /** How the nav reads. Short — it sits in a row. */
  readonly label: string;
  /** One line under the nav, saying what the surface is for. */
  readonly blurb: string;
  readonly Component: ComponentType<PanelProps>;
};

/**
 * What a panel is handed. Every panel may ignore it — a component declaring no
 * props is assignable — and only the teaching plots read it.
 *
 * `link` is an **initial value**, not shared state: the receiving panel copies
 * it into its own controls and owns them from there, so the "a panel owns its
 * own state" rule in this file survives a link landing on it.
 */
export type PanelProps = {
  /** The decoded query, or `null` when there was none or it did not survive. */
  readonly link: TeachingLink | null;
  /** `true` only when a query WAS present and failed to decode — see `teaching.ts`. */
  readonly linkBroken: boolean;
};

export const PANELS: readonly Panel[] = [
  {
    id: "telescope",
    label: "star & field",
    blurb: "roadmap step 4 — chromatic fringing, and a field-varying PSF across 25 stars",
    Component: TelescopePanel,
  },
  {
    id: "rayfan",
    label: "the ray fan",
    blurb: "APP.md Part H — where each ray in the pupil lands, and the half of the fan coma adds",
    Component: RayFanPanel,
  },
  {
    id: "chromatic",
    label: "chromatic focus",
    blurb: "APP.md Part H — where each colour focuses, and what it costs at the one plane the image has",
    Component: ChromaticPanel,
  },
  {
    id: "spot",
    label: "the spot diagram",
    blurb: "ROADMAP v1 — where a pupil-full of rays lands, and the lens a spot diagram lies about",
    Component: SpotPanel,
  },
  {
    id: "sky",
    label: "a disc, not a point",
    blurb: "APP.md C7 — a source with an angular size, and the diagonal that decides how much sky fits",
    Component: SkyPanel,
  },
  {
    id: "wavefront",
    label: "the wavefront",
    blurb: "ROADMAP v1 — the Zernike terms, and which RMS the Strehl formula actually wants",
    Component: WavefrontPanel,
  },
  {
    id: "mtf",
    label: "the MTF",
    blurb: "ROADMAP v1 — the contrast that survives, and the cutoff of an aperture that did not transmit",
    Component: MtfPanel,
  },
  {
    id: "curvature",
    label: "the curved field",
    blurb: "ROADMAP v1 — the two surfaces a flat sensor sits between, and the one the achromat did not flatten",
    Component: CurvaturePanel,
  },
  {
    id: "reflector",
    label: "the reflectors",
    blurb: "APP.md Part C — six presets from three numbers, and an obstruction the trace never sees",
    Component: ReflectorPanel,
  },
  {
    id: "camera",
    label: "the sensor",
    blurb: "APP.md C4 — a pixel that integrates, and a critical pitch that is per wavelength",
    Component: CameraPanel,
  },
  {
    id: "visual",
    label: "visual mode",
    blurb: "APP.md C5 — the eye takes the aperture, and the apparent field belongs to the eyepiece",
    Component: VisualPanel,
  },
  {
    id: "seeing",
    label: "long exposure",
    blurb: "APP.md C6 — one screen is a speckle pattern, and only the mean is the seeing disc",
    Component: SeeingPanel,
  },
  {
    id: "train",
    label: "the mechanical train",
    blurb: "APP.md C3 — a part's length and its optical cost are different numbers",
    Component: MechPanel,
  },
  {
    id: "bench",
    label: "microscope bench",
    blurb: "APP.md A1 — every objective traced, and the crop a frame actually covers",
    Component: BenchPanel,
  },
  {
    id: "editor",
    label: "the bench editor",
    blurb: "ROADMAP v1 — the surface list itself, and the order the aperture says is really there",
    Component: EditorPanel,
  },
  {
    id: "telecentric",
    label: "the telecentric stop",
    blurb: "VALIDATION § 6ar — the stop is a millimetre, and how many colours one millimetre can serve",
    Component: TelecentricPanel,
  },
  {
    id: "design",
    label: "the solve",
    blurb: "ROADMAP v2+ — design mode's first half: what a number has to be, and the pole that is not a root",
    Component: DesignPanel,
  },
  {
    id: "optimize",
    label: "the compromise",
    blurb: "ROADMAP v2+ — design mode's second half: several wishes at once, and the leftover that is part of the answer",
    Component: OptimizePanel,
  },
  {
    id: "builder",
    label: "the builder",
    blurb: "APP.md D8 — the parameters the catalogue defaulted, and a wall measured for what you built",
    Component: BuilderPanel,
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
    id: "section",
    label: "the section, in colour",
    blurb: "APP.md A9 — colour integrated per wavelength, beside the tint that cannot be a stain",
    Component: SectionPanel,
  },
  {
    id: "coverslip",
    label: "the cover slip",
    blurb: "APP.md A6 — a plate the objective does not control, and two walls that are not aberration",
    Component: CoverslipPanel,
  },
  {
    id: "eyepiece",
    label: "the eyepiece",
    blurb: "APP.md D6 — the chain ends at an eye, and which NA the exit pupil's law takes",
    Component: EyepiecePanel,
  },
  {
    id: "collimation",
    label: "collimation",
    blurb: "ROADMAP step 7 — the coma node an element knocked out of line takes with it",
    Component: CollimationPanel,
  },
  {
    id: "tolerance",
    label: "tolerances",
    blurb: "APP.md Part B — a slider per manufacturing error, and the budget that is not a bound",
    Component: TolerancePanel,
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

/**
 * The route half of a hash, with any teaching query split off first.
 *
 * **The `?` is why this function was edited rather than left alone.** The
 * original matched the whole post-`#/` string against `p.id`, so
 * `#/rayfan?v=1&lens=achromat` produced the id `"rayfan?v=1&lens=achromat"`,
 * matched nothing, and fell through to the default panel — which is the star
 * image itself. A teaching link would have returned the reader to the picture
 * they clicked, with every type checking and no error anywhere. `resolveHash`
 * below is tested against exactly that string.
 */
export function panelFor(hash: string): Panel {
  const id = hash.replace(/^#\/?/, "").split("?")[0]!;
  return PANELS.find((p) => p.id === id) ?? DEFAULT_PANEL;
}

/** What the shell needs from a hash: which panel, and what it was handed. */
export interface Route {
  readonly panel: Panel;
  /** The decoded query, or `null` when there was none or it did not survive. */
  readonly link: TeachingLink | null;
  /** `true` only when a query was present AND failed to decode. */
  readonly linkBroken: boolean;
  /**
   * The raw query, so the shell can remount a panel when only the parameters
   * change — a link is an initial value, and a new one has to re-seed.
   */
  readonly query: string;
}

export function resolveHash(hash: string): Route {
  const rest = hash.replace(/^#\/?/, "");
  const cut = rest.indexOf("?");
  const query = cut === -1 ? "" : rest.slice(cut + 1);
  const panel = panelFor(hash);
  const link = query === "" ? null : decodeLink(query);
  // Broken means *present and unreadable*. A plain `#/rayfan` is not a broken
  // link, it is no link, and a panel that announced a failure there would be
  // crying wolf on its own nav entry.
  return { panel, link, linkBroken: query !== "" && link === null, query };
}
