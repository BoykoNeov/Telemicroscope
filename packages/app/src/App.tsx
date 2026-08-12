import { useEffect, useState } from "react";
import { PANELS, resolveHash } from "./panels/registry";

/**
 * The shell: a nav row and one panel. Nothing else lives here.
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
 */
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const { panel, link, linkBroken, query } = resolveHash(hash);
  const { Component } = panel;

  return (
    // Wider than the 900 the two-panel layout needed: the microscope table has
    // eleven columns and every one of them is a number the panel exists to show.
    // The prose keeps its own 640 maxWidth, so only the table gets the room.
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1240 }}>
      <nav
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "baseline",
          borderBottom: "1px solid #ddd",
          paddingBottom: 10,
          marginBottom: 18,
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#777", marginRight: 8 }}>
          telemicroscope
        </span>
        {PANELS.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              padding: "3px 10px",
              textDecoration: "none",
              border: entry.id === panel.id ? "1px solid #333" : "1px solid #ccc",
              background: entry.id === panel.id ? "#333" : "#fff",
              color: entry.id === panel.id ? "#fff" : "#333",
            }}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      <p style={{ fontFamily: "monospace", fontSize: 12, color: "#777", marginTop: 0 }}>
        {panel.blurb}
      </p>

      <Component key={`${panel.id}?${query}`} link={link} linkBroken={linkBroken} />
    </main>
  );
}
