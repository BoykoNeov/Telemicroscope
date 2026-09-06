import { Suspense, useEffect, useState } from "react";
import { PanelBoundary } from "./panels/boundary";
import { PANELS, PANEL_GROUPS, resolveHash, type Panel } from "./panels/registry";
import { setThemeChoice, themeChoice, useThemeVersion, type ThemeChoice } from "./theme";

/**
 * The shell: a header with the nav, and one panel. Nothing else lives here.
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
 * The nav is three rows, one per engine branch, because thirty-one entries in
 * one wrapped row had no order a reader could see. The registry's array order
 * is unchanged — it is what `panelFor` falls back on and what the tests read —
 * and the rows are a *view* of it, filtered by `group`.
 *
 * Each nav link fetches its route's chunk on `mouseenter` and on `focus`
 * (UI-PLAN step 7): the pointer reaches a link some hundreds of milliseconds
 * before the click, which is the round trip a lazy route otherwise spends after
 * it. `registry.ts` says how a chunk fetched that way then paints without the
 * `panel-loading` frame `lazy` alone would show.
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

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const theme = useThemeVersion();

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
    document.title = `${panel.label} — Telemicroscope`;
  }, [panel.label]);

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
          <span className="shell-title">
            <strong>telemicroscope</strong> · a physics-based telescope and microscope bench
          </span>
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
        <nav className="shell-nav" aria-label="surfaces">
          {PANEL_GROUPS.map((group) => (
            <div className="nav-group" key={group.id}>
              <span className="nav-group-label">{group.label}</span>
              {PANELS.filter((entry) => entry.group === group.id).map((entry) => (
                <a
                  key={entry.id}
                  href={`#/${entry.id}`}
                  className="nav-link"
                  aria-current={entry.id === panel.id ? "page" : undefined}
                  onMouseEnter={() => warm(entry)}
                  onFocus={() => warm(entry)}
                >
                  {entry.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </header>
      <p className="shell-blurb">{panel.blurb}</p>

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
