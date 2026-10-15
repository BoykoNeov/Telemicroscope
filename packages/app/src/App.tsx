import { Suspense, useEffect, useRef, useState } from "react";
import { PanelBoundary } from "./panels/boundary";
import { PANELS, PANEL_GROUPS, resolveHash, type Panel, type PanelGroup } from "./panels/registry";
import { TOPICS, topicOf, tourPlace } from "./guide";
import { setThemeChoice, themeChoice, useThemeVersion, type ThemeChoice } from "./theme";

/**
 * The shell: a header with the menus, a line saying where you are, and one
 * panel. Nothing else lives here.
 *
 * The page used to be a single scroll holding every surface and every control
 * group at once, which stopped scaling at four panels — see `panels/registry.ts`
 * for what routing actually fixes. What is left in this file is the route and
 * the frame around it; the physics, the prose and the controls belong to the
 * panel that says them.
 *
 * Routing is the hash and a `hashchange` listener rather than a router
 * dependency: no nesting, and since Part H exactly one kind of parameter — the
 * teaching link a clicked artifact travels along, decoded in `resolveHash` and
 * handed down as an initial value. The panel is keyed on its id **and that
 * query** so React unmounts the old one instead of reconciling two unrelated
 * trees — which is also what terminates the outgoing panel's workers, and what
 * makes a second link to the same route re-seed rather than land on a panel
 * still showing the first one's numbers.
 *
 * That key does a second job since the error boundary arrived: it is what
 * *clears* a caught error, so a panel that threw is left behind by clicking any
 * other nav link rather than by reloading. `panels/boundary.tsx` says what the
 * boundary does and does not catch — the short version is the panel's own
 * render and a chunk that will not download, not a worker's reply handler.
 *
 * ## The nav is menus, not a wall of links — APP.md Part R
 *
 * It was three always-open rows of pills, thirty-one of them, which had an
 * order only for whoever wrote the registry. Now the header holds a link to
 * the start page and one menu per branch; a menu opens into columns by topic
 * (`guide.ts`), each entry with its one plain sentence. A menu closes on a
 * route change, on Escape, and on a click anywhere outside it — the first one
 * matters most, since the header is sticky and an open menu would otherwise
 * sit over the panel it just opened.
 *
 * Under the header, every page but the start page says where it is (branch ›
 * topic), what it shows in plain words, and — on a page that is on a guided
 * path — the previous and next stops. That line is the "what leads where" a
 * first-time reader was missing.
 *
 * Each nav link fetches its route's chunk on `mouseenter` and on `focus`
 * (UI-PLAN step 7): the pointer reaches a link some hundreds of milliseconds
 * before the click, which is the round trip a lazy route otherwise spends after
 * it. `registry.ts` says how a chunk fetched that way then paints without the
 * `panel-loading` frame `lazy` alone would show. Inside a closed menu the links
 * are not rendered, so the hover that warms them is the one that happens after
 * the menu opens — still well ahead of the click.
 *
 * The theme control is three buttons — auto, light, dark — not one that cycles
 * (UI-PLAN step 8). A cycling button says only where it is; which states exist,
 * and that "auto" is a state and not the absence of one, was discoverable by
 * clicking. Three labelled options with `aria-pressed` on the current one say
 * it, and each is a tab stop, so the keyboard reaches any state in one press.
 */

/** The three states in the order they read: the OS's choice first, then the two overrides. */
const THEME_OPTIONS: readonly { choice: ThemeChoice; label: string; title: string }[] = [
  { choice: "system", label: "auto", title: "follow the OS" },
  { choice: "light", label: "light", title: "light, whatever the OS says" },
  { choice: "dark", label: "dark", title: "dark, whatever the OS says" },
];

/** The menus: every group but `start`, which is the plain link before them. */
const MENU_GROUPS = PANEL_GROUPS.filter((group) => group.id !== "start");

const groupLabel = (id: PanelGroup): string => PANEL_GROUPS.find((g) => g.id === id)?.label ?? id;

const panelById = (id: string): Panel | undefined => PANELS.find((p) => p.id === id);

/**
 * Warm a route ahead of the click. A prefetch is speculative, so its failure is
 * not reported here: if the chunk will not download, the click that follows
 * renders through `lazy`, meets the same memoised rejection, and the error
 * boundary prints it with the URL that failed. Reporting it twice would put an
 * unhandled-rejection line in the console for a route the reader never opened.
 */
function warm(entry: Panel): void {
  entry.load().catch(() => {});
}

/** One open menu: the group's topics as columns, each entry with its sentence. */
function MenuPanel({ group, current }: { group: PanelGroup; current: string }) {
  return (
    <div className="nav-menu" role="region" aria-label={`${groupLabel(group)} pages`}>
      {TOPICS.filter((topic) => topic.group === group).map((topic) => (
        <div className="nav-menu-column" key={topic.id}>
          <div className="nav-menu-topic">{topic.label}</div>
          {PANELS.filter((entry) => entry.topic === topic.id).map((entry) => (
            <a
              key={entry.id}
              href={`#/${entry.id}`}
              className="nav-menu-link"
              aria-current={entry.id === current ? "page" : undefined}
              onMouseEnter={() => warm(entry)}
              onFocus={() => warm(entry)}
            >
              <span className="nav-menu-label">{entry.label}</span>
              <span className="nav-menu-summary">{entry.summary}</span>
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Where the reader is, what the page shows, and where a guided path goes next. */
function WhereBar({ panel }: { panel: Panel }) {
  const topic = topicOf(panel.topic);
  const place = tourPlace(panel.id);
  const previous = place && place.index > 0 ? panelById(place.tour.steps[place.index - 1]!) : undefined;
  const next =
    place && place.index < place.tour.steps.length - 1
      ? panelById(place.tour.steps[place.index + 1]!)
      : undefined;
  return (
    <div className="where">
      <div className="where-trail">
        <a href="#/home">start</a>
        <span aria-hidden="true"> › </span>
        <span>{groupLabel(panel.group)}</span>
        <span aria-hidden="true"> › </span>
        <span>{topic.label}</span>
      </div>
      <p className="where-summary" title={panel.blurb}>
        {panel.summary}
      </p>
      {place ? (
        <div className="where-tour">
          <span className="where-tour-name">
            guided path: <strong>{place.tour.title}</strong> · stop {place.index + 1} of{" "}
            {place.tour.steps.length}
          </span>
          <span className="where-tour-steps">
            {previous ? (
              <a href={`#/${previous.id}`} onMouseEnter={() => warm(previous)}>
                ← {previous.label}
              </a>
            ) : (
              <a href="#/home">← start</a>
            )}
            {next ? (
              <a href={`#/${next.id}`} onMouseEnter={() => warm(next)}>
                next: {next.label} →
              </a>
            ) : (
              <a href="#/home">end of path — back to start →</a>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [openMenu, setOpenMenu] = useState<PanelGroup | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const theme = useThemeVersion();

  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash);
      // The header is sticky: a menu left open would cover the page it opened.
      setOpenMenu(null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Escape and a click outside close an open menu. Listening only while one is
  // open keeps the document free of handlers the rest of the time.
  useEffect(() => {
    if (openMenu === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    const onPointer = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [openMenu]);

  const { panel, link, linkBroken, query } = resolveHash(hash);
  const { Component } = panel;

  /**
   * The route's identity: the id and the teaching query, because a second link
   * to the same panel with different parameters is a different mount. Named
   * rather than written twice below — the fade wrapper and the error boundary
   * must reset on exactly the same event, and two copies of an expression is
   * how they would stop doing so.
   */
  const routeKey = `${panel.id}?${query}`;

  useEffect(() => {
    document.title = panel.id === "home" ? "Telemicroscope" : `${panel.label} — Telemicroscope`;
  }, [panel.id, panel.label]);

  const choice = themeChoice();
  // What is painting right now — "dark" under auto on a dark OS — which the
  // three labels cannot say on their own. `theme` is also the subscription that
  // re-renders this shell when the choice or the OS changes.
  const painting = theme.split(":")[1];

  return (
    // Wider than the 900 the two-panel layout needed: the microscope table has
    // eleven columns and every one of them is a number the panel exists to show.
    // The prose keeps its own 640 maxWidth, so only the table gets the room.
    <main className="shell">
      <header className="shell-header">
        <div className="shell-title-row">
          <nav className="shell-nav" aria-label="surfaces" ref={navRef}>
            <a href="#/home" className="shell-title" aria-current={panel.id === "home" ? "page" : undefined}>
              <strong>telemicroscope</strong>
            </a>
            {MENU_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                className="nav-menu-button"
                aria-expanded={openMenu === group.id}
                data-here={panel.group === group.id ? "true" : undefined}
                onClick={() => setOpenMenu(openMenu === group.id ? null : group.id)}
              >
                {group.label} <span aria-hidden="true">▾</span>
              </button>
            ))}
            {openMenu !== null ? <MenuPanel group={openMenu} current={panel.id} /> : null}
          </nav>
          <div className="theme-control" role="group" aria-label={`theme, currently ${painting}`}>
            <span className="nav-group-label">theme</span>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.choice}
                type="button"
                className="nav-link"
                aria-pressed={option.choice === choice}
                title={option.title}
                onClick={() => setThemeChoice(option.choice)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      {panel.id === "home" ? null : <WhereBar panel={panel} />}

      <div className="panel-fade" key={routeKey}>
        <PanelBoundary key={routeKey}>
          <Suspense fallback={<div className="panel-loading">loading {panel.label}…</div>}>
            <Component link={link} linkBroken={linkBroken} />
          </Suspense>
        </PanelBoundary>
      </div>
    </main>
  );
}
