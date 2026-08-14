import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PANELS } from "../src/panels/registry";

/**
 * The check nobody was running: a capability the docs mark as surfaced has a
 * route, and that route exists.
 *
 * **The failure this file was written against.** Distortion/field curvature was
 * recorded in ROADMAP as surfaced, in two different sentences, while it had no
 * panel, no route, and no part in APP.md. Every check that existed passed: the
 * registry is checked against APP.md, APP.md is checked against the engine, and
 * ROADMAP was checked against neither, so the one claim that was false was the
 * one claim nothing read.
 *
 * **No engine capability is involved**, so no validation-ladder rung is — this
 * pins two documents against one array.
 *
 * The two halves are not the same check and neither is sufficient:
 *
 * - APP.md's *Every landed section* table catches a ✅ section that never
 *   reached a screen, and a panel that ships with no section claiming it. It
 *   cannot catch a capability nobody wrote a section for.
 * - ROADMAP's *six analyses* table catches exactly that — a roadmap claim with
 *   no route behind it — because the claim itself is now a row rather than a
 *   sentence.
 *
 * **What it still does not catch, stated plainly rather than left to be
 * discovered:** a route that resolves to a panel drawing the wrong thing, and a
 * capability that is absent from ROADMAP's table as well as from the app. The
 * first is what every panel's own test is for; the second is a gap only a reader
 * closes. This is a bookkeeping rung, not a physics one.
 *
 * Both tables were written by reading the documents' own ✅ claims, not by
 * printing `PANELS` — a table generated from the thing it is checked against
 * agrees by construction and asserts nothing.
 *
 * **Damage table — proving the comparison can fail**, run before this landed.
 * The first row is the historical bug reconstructed: the `curvature` panel taken
 * out of `PANELS`, APP.md's Part L returned to unscoped with its row removed,
 * ROADMAP's table left claiming the analysis surfaced. That is the tree at
 * `d3c5b79`, one commit before the panel arrived.
 *
 * | Damage | Caught by |
 * | --- | --- |
 * | The state at `d3c5b79` | ROADMAP's ✅ row names a route nothing resolves |
 * | A row's route misspelt (`#/trian`) | *names only routes the registry has* |
 * | A landed section's row deleted | *has a row for every section marked ✅* **and** *claims every panel the app ships* |
 *
 * **The first row is the one worth reading, and it failed only in the ROADMAP
 * half.** With Part L unscoped there is no ✅ section for APP.md's table to be
 * missing a row for, so all three of its assertions stayed green — which is the
 * caveat two paragraphs up, measured rather than asserted. The half that catches
 * the real failure is the half where the roadmap's claim is itself a row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "..", "..", "docs");

/** `core.autocrlf` is on, so these files are CRLF in a Windows working tree and
 *  LF in the repo. Splitting on either keeps a captured route from carrying a
 *  trailing `\r` into a set comparison and failing as if it were a rename. */
function lines(name: string): string[] {
  return readFileSync(join(DOCS, name), "utf8").split(/\r?\n/);
}

/** The block a `## ` heading opens, up to the next `## `. */
function block(all: string[], heading: string): string[] {
  const start = all.findIndex((l) => l.startsWith(heading));
  expect(start, `${heading} is not where this test thinks it is`).toBeGreaterThanOrEqual(0);
  const end = all.findIndex((l, i) => i > start && l.startsWith("## "));
  return all.slice(start + 1, end === -1 ? all.length : end);
}

/** A table row's cells — `| a | b | c |` without the empty ends. */
function cells(row: string): string[] {
  return row
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function isRow(l: string): boolean {
  return l.startsWith("| ") && !/^\|\s*-{2,}/.test(l) && !l.startsWith("| Section") && !l.startsWith("| Analysis");
}

/** Every `#/id` in a cell. The leading `[a-z]` matters: APP.md contains a bare
 *  `#/` in prose, and `#/[a-z]*` matches it as the empty route. */
function routesIn(cell: string): string[] {
  return [...cell.matchAll(/#\/([a-z][a-z-]*)/g)].map((m) => m[1]!);
}

const PANEL_IDS = new Set(PANELS.map((p) => p.id));

const app = lines("APP.md");
const appTable = block(app, "## Every landed section, and the route it reached").filter(isRow);

/** The section key a landed heading declares — `A1`, `C7`, `D10`, `Part B`. */
const LANDED = /^#{2,3} (Part [A-Z]|[A-Z]\d+)\b/;
const landedSections = app
  .filter((l) => l.includes("✅"))
  .map((l) => LANDED.exec(l)?.[1])
  .filter((k): k is string => k !== undefined);

describe("APP.md's landed sections and the app's routes are the same list", () => {
  it("found both a table and some landed sections", () => {
    // The original failure was a check nobody ran; a parse that silently finds
    // nothing and passes would rebuild it inside the fix.
    expect(appTable.length).toBeGreaterThan(0);
    expect(landedSections.length).toBeGreaterThan(0);
  });

  it("has a row for every section marked ✅, and no row for a section that is not", () => {
    const rowKeys = appTable.map((r) => cells(r)[0]!).filter((k) => !k.startsWith("ROADMAP"));
    expect([...new Set(rowKeys)].sort()).toEqual([...new Set(landedSections)].sort());
  });

  it("names only routes the registry has", () => {
    const unknown = appTable
      .flatMap((r) => routesIn(cells(r)[1]!).map((id) => ({ id, section: cells(r)[0]! })))
      .filter((r) => !PANEL_IDS.has(r.id))
      .map((r) => `${r.section} → #/${r.id}`);
    expect(unknown).toEqual([]);
  });

  it("claims every panel the app ships", () => {
    const claimed = new Set(appTable.flatMap((r) => routesIn(cells(r)[1]!)));
    const unclaimed = [...PANEL_IDS].filter((id) => !claimed.has(id));
    expect(unclaimed).toEqual([]);
  });
});

const roadmap = lines("ROADMAP.md");
const analyses = block(roadmap, "### The six analyses,").filter(isRow);

describe("ROADMAP's analyses claim a route each, and the routes exist", () => {
  it("found the table", () => {
    expect(analyses.length).toBeGreaterThan(0);
  });

  it("gives every ✅ row a route the registry has, and every other row none", () => {
    const bad = analyses
      .map((r) => cells(r))
      .filter(([, surfaced, route]) => {
        const ids = routesIn(route!);
        return surfaced === "✅"
          ? ids.length === 0 || ids.some((id) => !PANEL_IDS.has(id))
          : ids.length > 0;
      })
      .map(([name, surfaced, route]) => `${name}: ${surfaced || "(blank)"} / ${route}`);
    expect(bad).toEqual([]);
  });
});
