import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The one rung that pins a DOCUMENT rather than the physics.
 *
 * CLAUDE.md tells a reader to open VALIDATION.md's summary table first and
 * then only the step they need. That instruction is only worth following while
 * the table is cheaper than the sections it stands in for, and it stopped being
 * so by drift rather than by decision: the early steps' rows are one line, and
 * nine of the later ones had grown to between 1.5 and 4.5 KB — 23 KB of the
 * table's 40, restating arguments that were already written out under their own
 * headings. An index that costs as much as the text is not an index.
 *
 * So the shape is a rung like any other, and for the same reason the tolerances
 * elsewhere are numbers rather than opinions: a convention nobody can fail is a
 * convention that erodes. A second pass then spent the slack the first one left
 * — the five rows between 800 and 1500 bytes — so that the ROW cap could come
 * down to where it is the binding constraint, which is what CLAUDE.md's rule
 * actually says.
 *
 * **The slack is gone, and the block budget is what binds now.** § 6am's row was
 * the one that spent the last of it: the table went to 20370 and the row cap was
 * not touched, because no row is anywhere near 800 — the fattest is 440. So the
 * rule ran as written for the first time and four rows paid for the new one
 * (§ 0, § 3c, § 6aa, and § 6am trimming itself), each by dropping a clause that
 * restated reasoning already written out under its own heading. The table is
 * 19972 of 20000: the NEXT row must buy its own space the same way. Do not raise
 * either number — this is the one file in the repo whose whole value is being
 * small, and the reasoning it would be protecting already has a home in the
 * step's own section.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATION = join(HERE, "..", "..", "..", "docs", "VALIDATION.md");

/** The heading the table lives under, and the budget for the block it spans.
 *  The row cap is the binding constraint and the block budget is the backstop,
 *  not the other way around — the drift that cost 23 KB was rows creeping up
 *  one at a time, each too small to notice against a whole-table number. */
const INDEX_HEADING = "## The ladder at a glance";
const INDEX_MAX_BYTES = 20_000;
const ROW_MAX_CHARS = 800;

/** GitHub's heading slug: lowercase, drop all but alphanumerics/space/hyphen,
 *  then spaces to hyphens. An em dash vanishes and leaves the doubled hyphen
 *  the existing links already carry. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

const doc = readFileSync(VALIDATION, "utf8");
/** Split on either ending and rejoin with "\n" below: `core.autocrlf` is on,
 *  so this file is CRLF in a Windows working tree and LF in the repo. Measuring
 *  what happens to be on disk would make the budget platform-dependent and put
 *  a row one character from its cap for one checkout and not the other. */
const lines = doc.split(/\r?\n/);

const start = lines.findIndex((l) => l.startsWith(INDEX_HEADING));
const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
const block = lines.slice(start, end);
const rows = block.filter((l) => l.startsWith("| ["));

describe("VALIDATION.md's summary table stays an index", () => {
  it("is where this test thinks it is", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // Guards against the block silently emptying out and the budget passing
    // for the wrong reason.
    expect(rows.length).toBeGreaterThan(40);
  });

  it("costs less than the sections it stands in for", () => {
    const bytes = Buffer.byteLength(block.join("\n"), "utf8");
    expect(bytes).toBeLessThanOrEqual(INDEX_MAX_BYTES);
  });

  it("has no row that is an essay", () => {
    const over = rows
      .filter((r) => r.length > ROW_MAX_CHARS)
      .map((r) => `${r.slice(0, 60)}… (${r.length} chars)`);
    expect(over).toEqual([]);
  });

  it("links only to headings that exist", () => {
    const headings = new Set(
      lines
        .filter((l) => /^#{2,4} /.test(l))
        .map((l) => slug(l.replace(/^#+ /, "").trim())),
    );
    const broken = [...doc.matchAll(/\]\(#([a-z0-9-]+)\)/g)]
      .map((m) => m[1]!)
      .filter((anchor) => !headings.has(anchor));
    expect([...new Set(broken)]).toEqual([]);
  });
});
