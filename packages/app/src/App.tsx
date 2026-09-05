import { Suspense, useEffect, useState } from "react";
import { PANELS, PANEL_GROUPS, resolveHash } from "./panels/registry";
import { cycleTheme, themeChoice, useThemeVersion } from "./theme";

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
 * The nav is three rows, one per engine branch, because thirty-one entries in
 * one wrapped row had no order a reader could see. The registry's array order
 * is unchanged — it is what `panelFor` falls back on and what the tests read —
 * and the rows are a *view* of it, filtered by `group`.
 */
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

  useEffect(() => {
    document.title = `${panel.label} — Telemicroscope`;
  }, [panel.label]);

  const choice = themeChoice();
  const themeLabel = choice === "system" ? "theme: auto" : `theme: ${choice}`;

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
          <button
            type="button"
            className="theme-toggle"
            onClick={cycleTheme}
            title="auto follows the OS; click to cycle auto → dark → light"
            aria-label={`${themeLabel}, currently ${theme.split(":")[1]}`}
          >
            {themeLabel}
          </button>
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
                >
                  {entry.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </header>
      <p className="shell-blurb">{panel.blurb}</p>

      <div className="panel-fade" key={`${panel.id}?${query}`}>
        <Suspense fallback={<div className="panel-loading">loading {panel.label}…</div>}>
          <Component link={link} linkBroken={linkBroken} />
        </Suspense>
      </div>
    </main>
  );
}
