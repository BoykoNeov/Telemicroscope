/**
 * The app's map — APP.md's Part R. Which surfaces sit together, in what words,
 * and the three guided paths through them.
 *
 * The shell used to show every route at once: thirty-one pills in three rows
 * under the title, each labelled by its finding ("the phase null", "a disc, not
 * a point") and each blurb citing the doc section that scoped it. That reads
 * well to whoever wrote the docs and to nobody else — a first-time reader had
 * no way to tell where to begin, or which surface leads to which. This module
 * is the fix's data: a **topic** per surface (a second level under the three
 * branches, so a menu holds four or six entries instead of fourteen), and a
 * **tour** per branch — an ordered path that a reader can follow with "next".
 *
 * Pure data, no React and no registry import, so `guide.test.ts` can check it
 * against the registry in both directions without either module loading the
 * other's panels. The registry imports the types from here, not the reverse.
 *
 * ## The words are plain on purpose
 *
 * Every string in this file is written for someone who has not read the repo:
 * no section numbers, no internal names, nothing that only means something to
 * the ladder. The doc-facing blurb stays on each registry entry, where it is
 * still the right pointer for a maintainer, and the shell shows it as a tooltip
 * rather than as the line a reader meets first.
 */

/** The engine branch a surface draws — and a top-level menu in the header. */
export type PanelGroup = "start" | "microscope" | "telescope" | "design";

export type TopicId =
  | "start"
  | "scope-look"
  | "scope-light"
  | "scope-parts"
  | "sky-view"
  | "sky-flaws"
  | "sky-hardware"
  | "design-solve"
  | "design-make";

export interface Topic {
  readonly id: TopicId;
  readonly group: PanelGroup;
  /** The heading a menu column and a start-page section wear. */
  readonly label: string;
  /** One sentence: what a reader will find under it. */
  readonly hint: string;
}

/** In reading order: the menus and the start page both walk this list. */
export const TOPICS: readonly Topic[] = [
  { id: "start", group: "start", label: "start", hint: "Where everything is, and where to begin." },
  {
    id: "scope-look",
    group: "microscope",
    label: "look through it",
    hint: "A whole microscope, a slide to pan around, and the view through the eyepiece.",
  },
  {
    id: "scope-light",
    group: "microscope",
    label: "how the image forms",
    hint: "Each way of lighting a specimen, and what it can and cannot show.",
  },
  {
    id: "scope-parts",
    group: "microscope",
    label: "the parts, one at a time",
    hint: "Objectives, their lens surfaces, the cover glass and the aperture stop, taken apart.",
  },
  {
    id: "sky-view",
    group: "telescope",
    label: "what you see",
    hint: "Stars and planets as a telescope delivers them to a camera or to your eye.",
  },
  {
    id: "sky-flaws",
    group: "telescope",
    label: "a lens's flaws, measured",
    hint: "The standard pictures optical engineers use to say what a lens gets wrong.",
  },
  {
    id: "sky-hardware",
    group: "telescope",
    label: "the hardware",
    hint: "Mirrors, tubes, focusers and alignment — the physical telescope.",
  },
  {
    id: "design-solve",
    group: "design",
    label: "designing a lens",
    hint: "Say what you want the lens to do and let the solver find its shape.",
  },
  {
    id: "design-make",
    group: "design",
    label: "making it for real",
    hint: "How precisely each part has to be made, and what each error costs.",
  },
];

export function topicOf(id: TopicId): Topic {
  const topic = TOPICS.find((t) => t.id === id);
  if (!topic) throw new Error(`unknown topic ${id}`);
  return topic;
}

export interface Tour {
  readonly id: string;
  readonly group: PanelGroup;
  readonly title: string;
  /** Why follow it, in one sentence. */
  readonly why: string;
  /** Route ids, in the order the tour visits them. */
  readonly steps: readonly string[];
}

/**
 * One guided path per branch. A surface sits on at most one tour, so "next"
 * on any page has exactly one meaning — `guide.test.ts` holds that.
 */
export const TOURS: readonly Tour[] = [
  {
    id: "microscope",
    group: "microscope",
    title: "How a microscope makes a picture",
    why: "Start with the whole instrument, then each way of lighting the slide and what it can and cannot show you.",
    steps: ["scope", "brightfield", "phase", "fluorescence", "volume", "section"],
  },
  {
    id: "telescope",
    group: "telescope",
    title: "Why a star is not a point",
    why: "From the blurred star to the four standard ways of measuring why it is blurred.",
    steps: ["telescope", "rayfan", "spot", "wavefront", "mtf", "seeing"],
  },
  {
    id: "design",
    group: "design",
    title: "From an idea to a lens you can order",
    why: "Compose an objective, edit its surfaces, solve and optimise it, then set its tolerances.",
    steps: ["builder", "editor", "design", "optimize", "tolerance", "budget"],
  },
];

export interface TourPlace {
  readonly tour: Tour;
  /** Zero-based position of the route in `tour.steps`. */
  readonly index: number;
}

/** Which tour a route is on, and where — `null` for a route on none. */
export function tourPlace(routeId: string): TourPlace | null {
  for (const tour of TOURS) {
    const index = tour.steps.indexOf(routeId);
    if (index !== -1) return { tour, index };
  }
  return null;
}
