import { lazy, type ComponentType } from "react";
import { decodeLink, type TeachingLink } from "../teaching";

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
 *
 * ## Every component is lazy — APP.md's structural item 6
 *
 * Thirty-one panels each import their own adapter, and an adapter imports the
 * engine, so one eager registry pulled every adapter into the entry chunk: the
 * production bundle was 840 KB of JavaScript before a single route had painted,
 * of which the route on screen needed a fraction. `lazy(() => import(...))`
 * makes each panel its own chunk that Vite emits beside its worker, loaded on
 * the first visit and cached after. The shell shows `panel-loading` for the
 * few milliseconds the chunk takes on a warm cache; nothing about a panel's own
 * behaviour changes, because the shell already keyed and remounted it per route.
 *
 * The `.then(m => ({ default: m.X }))` shape is because the panels export a
 * named component and `lazy` wants a default; it is written out rather than
 * hidden behind a helper so a search for `BenchPanel` still lands here.
 */
export type PanelGroup = "telescope" | "microscope" | "design";

export type Panel = {
  readonly id: string;
  /** How the nav reads. Short — it sits in a row. */
  readonly label: string;
  /** One line under the nav, saying what the surface is for. */
  readonly blurb: string;
  /** Which row of the nav it sits on: the branch of the engine it draws. */
  readonly group: PanelGroup;
  readonly Component: ComponentType<PanelProps>;
};

/** The nav's rows, in the order they appear, with the word each row wears. */
export const PANEL_GROUPS: readonly { readonly id: PanelGroup; readonly label: string }[] = [
  { id: "telescope", label: "telescope" },
  { id: "microscope", label: "microscope" },
  { id: "design", label: "design & tolerance" },
];

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
    group: "telescope",
    Component: lazy(() => import("./telescope").then((m) => ({ default: m.TelescopePanel }))),
  },
  {
    id: "rayfan",
    label: "the ray fan",
    blurb: "APP.md Part H — where each ray in the pupil lands, and the half of the fan coma adds",
    group: "telescope",
    Component: lazy(() => import("./rayfan").then((m) => ({ default: m.RayFanPanel }))),
  },
  {
    id: "chromatic",
    label: "chromatic focus",
    blurb: "APP.md Part H — where each colour focuses, and what it costs at the one plane the image has",
    group: "telescope",
    Component: lazy(() => import("./chromatic").then((m) => ({ default: m.ChromaticPanel }))),
  },
  {
    id: "spot",
    label: "the spot diagram",
    blurb: "ROADMAP v1 — where a pupil-full of rays lands, and the lens a spot diagram lies about",
    group: "telescope",
    Component: lazy(() => import("./spot").then((m) => ({ default: m.SpotPanel }))),
  },
  {
    id: "sky",
    label: "a disc, not a point",
    blurb: "APP.md C7 — a source with an angular size, and the diagonal that decides how much sky fits",
    group: "telescope",
    Component: lazy(() => import("./sky").then((m) => ({ default: m.SkyPanel }))),
  },
  {
    id: "wavefront",
    label: "the wavefront",
    blurb: "ROADMAP v1 — the Zernike terms, and which RMS the Strehl formula actually wants",
    group: "telescope",
    Component: lazy(() => import("./wavefront").then((m) => ({ default: m.WavefrontPanel }))),
  },
  {
    id: "mtf",
    label: "the MTF",
    blurb: "ROADMAP v1 — the contrast that survives, and the cutoff of an aperture that did not transmit",
    group: "telescope",
    Component: lazy(() => import("./mtf").then((m) => ({ default: m.MtfPanel }))),
  },
  {
    id: "curvature",
    label: "the curved field",
    blurb: "ROADMAP v1 — the two surfaces a flat sensor sits between, and the one the achromat did not flatten",
    group: "telescope",
    Component: lazy(() => import("./curvature").then((m) => ({ default: m.CurvaturePanel }))),
  },
  {
    id: "reflector",
    label: "the reflectors",
    blurb: "APP.md Part C — six presets from three numbers, and an obstruction the trace never sees",
    group: "telescope",
    Component: lazy(() => import("./reflector").then((m) => ({ default: m.ReflectorPanel }))),
  },
  {
    id: "camera",
    label: "the sensor",
    blurb: "APP.md C4 — a pixel that integrates, and a critical pitch that is per wavelength",
    group: "telescope",
    Component: lazy(() => import("./camera").then((m) => ({ default: m.CameraPanel }))),
  },
  {
    id: "visual",
    label: "visual mode",
    blurb: "APP.md C5 — the eye takes the aperture, and the apparent field belongs to the eyepiece",
    group: "telescope",
    Component: lazy(() => import("./visual").then((m) => ({ default: m.VisualPanel }))),
  },
  {
    id: "seeing",
    label: "long exposure",
    blurb: "APP.md C6 — one screen is a speckle pattern, and only the mean is the seeing disc",
    group: "telescope",
    Component: lazy(() => import("./seeing").then((m) => ({ default: m.SeeingPanel }))),
  },
  {
    id: "train",
    label: "the mechanical train",
    blurb: "APP.md C3 — a part's length and its optical cost are different numbers",
    group: "telescope",
    Component: lazy(() => import("./mech").then((m) => ({ default: m.MechPanel }))),
  },
  {
    id: "bench",
    label: "microscope bench",
    blurb: "APP.md A1 — every objective traced, and the crop a frame actually covers",
    group: "microscope",
    Component: lazy(() => import("./bench").then((m) => ({ default: m.BenchPanel }))),
  },
  {
    id: "editor",
    label: "the bench editor",
    blurb: "ROADMAP v1 — the surface list itself, and the order the aperture says is really there",
    group: "microscope",
    Component: lazy(() => import("./editor").then((m) => ({ default: m.EditorPanel }))),
  },
  {
    id: "telecentric",
    label: "the telecentric stop",
    blurb: "VALIDATION § 6ar — the stop is a millimetre, and how many colours one millimetre can serve",
    group: "microscope",
    Component: lazy(() => import("./telecentric").then((m) => ({ default: m.TelecentricPanel }))),
  },
  {
    id: "design",
    label: "the solve",
    blurb: "ROADMAP v2+ — design mode's first half: what a number has to be, and the pole that is not a root",
    group: "design",
    Component: lazy(() => import("./design").then((m) => ({ default: m.DesignPanel }))),
  },
  {
    id: "optimize",
    label: "the compromise",
    blurb: "ROADMAP v2+ — design mode's second half: several wishes at once, and the leftover that is part of the answer",
    group: "design",
    Component: lazy(() => import("./optimize").then((m) => ({ default: m.OptimizePanel }))),
  },
  {
    id: "builder",
    label: "the builder",
    blurb: "APP.md D8 — the parameters the catalogue defaulted, and a wall measured for what you built",
    group: "microscope",
    Component: lazy(() => import("./builder").then((m) => ({ default: m.BuilderPanel }))),
  },
  {
    id: "brightfield",
    label: "brightfield",
    blurb: "APP.md A2 — the condenser, the Abbe sum, and where the cutoff really lands",
    group: "microscope",
    Component: lazy(() => import("./brightfield").then((m) => ({ default: m.BrightfieldPanel }))),
  },
  {
    id: "phase",
    label: "the phase null",
    blurb: "APP.md A3 — a specimen that absorbs nothing, and the term that survives it",
    group: "microscope",
    Component: lazy(() => import("./phase").then((m) => ({ default: m.PhasePanel }))),
  },
  {
    id: "fluorescence",
    label: "fluorescence beads",
    blurb: "APP.md A4 — a specimen that emits, and the cutoff reached with no condenser",
    group: "microscope",
    Component: lazy(() => import("./fluorescence").then((m) => ({ default: m.FluorescencePanel }))),
  },
  {
    id: "emitter",
    label: "a source with a size",
    blurb: "APP.md Part Q — a density, not a point, and the one error the grid cannot refine away",
    group: "microscope",
    Component: lazy(() => import("./emitter").then((m) => ({ default: m.EmitterPanel }))),
  },
  {
    id: "stage",
    label: "the stage",
    blurb: "APP.md A7 — a field of view reached by tiling, and a tile that knows its own index",
    group: "microscope",
    Component: lazy(() => import("./stage").then((m) => ({ default: m.StagePanel }))),
  },
  {
    id: "section",
    label: "the section, in colour",
    blurb: "APP.md A9 — colour integrated per wavelength, beside the tint that cannot be a stain",
    group: "microscope",
    Component: lazy(() => import("./section").then((m) => ({ default: m.SectionPanel }))),
  },
  {
    id: "coverslip",
    label: "the cover slip",
    blurb: "APP.md A6 — a plate the objective does not control, and two walls that are not aberration",
    group: "microscope",
    Component: lazy(() => import("./coverslip").then((m) => ({ default: m.CoverslipPanel }))),
  },
  {
    id: "eyepiece",
    label: "the eyepiece",
    blurb: "APP.md D6 — the chain ends at an eye, and which NA the exit pupil's law takes",
    group: "microscope",
    Component: lazy(() => import("./eyepiece").then((m) => ({ default: m.EyepiecePanel }))),
  },
  {
    id: "collimation",
    label: "collimation",
    blurb: "ROADMAP step 7 — the coma node an element knocked out of line takes with it",
    group: "telescope",
    Component: lazy(() => import("./collimation").then((m) => ({ default: m.CollimationPanel }))),
  },
  {
    id: "tolerance",
    label: "tolerances",
    blurb: "APP.md Part B — a slider per manufacturing error, and the budget that is not a bound",
    group: "design",
    Component: lazy(() => import("./tolerance").then((m) => ({ default: m.TolerancePanel }))),
  },
  {
    id: "budget",
    label: "the tolerance sheet",
    blurb: "APP.md Part P — every number a shop holds, in two currencies, and the lens whose rows reinforce",
    group: "design",
    Component: lazy(() => import("./budget").then((m) => ({ default: m.BudgetPanel }))),
  },
  {
    id: "volume",
    label: "haze & the focus stack",
    blurb: "APP.md A5 — every plane delivers its whole flux, and the missing cone that follows",
    group: "microscope",
    Component: lazy(() => import("./volume").then((m) => ({ default: m.VolumePanel }))),
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
