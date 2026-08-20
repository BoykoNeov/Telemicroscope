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
 * headings. An index that costs as much as the text is not an index. So the
 * shape is a rung like any other, and for the same reason the tolerances
 * elsewhere are numbers rather than opinions: a convention nobody can fail is a
 * convention that erodes.
 *
 * **What changed here is the shape of the budget, and the reason is that the old
 * shape charged the wrong thing.** For two passes the binding number was an
 * absolute cap on the whole block, and it worked while the trimming was the
 * point. Then § 6am's row spent the last of the slack (19972 of 20000) and the
 * rule that was left — "the next row must buy its own space" — is a tax on a
 * step EXISTING, not on it being verbose. The row count is not the table's to
 * control: it is the ladder's, and the ladder only grows. Under an absolute cap
 * every future step, however terse, pays by cutting a clause out of a step that
 * has nothing to do with it, until the table is uniformly unreadable and still
 * full. That is not the invariant anyone wanted; it is what an absolute number
 * decays into once the thing it measures has a monotone term in it.
 *
 * So the budget is now scale-free, and it is charged where the cost accrues:
 *
 *   - **The MEAN row** is the load-bearing rule. A row at or under the average
 *     costs nothing, and a fat one raises the mean by its excess divided by the
 *     row count — so it is paid for, but by a trim proportional to how much it
 *     overran rather than by its whole length. That is the price signal the
 *     absolute cap was reaching for.
 *   - **The MAX row** stays as the anti-essay backstop, at today's fattest row,
 *     so seventy-five short rows can never bankroll one monster.
 *   - **The non-row prose** in the block — heading, table header, the two
 *     paragraphs after it — keeps an absolute cap, because that text genuinely
 *     does not grow with the ladder and an absolute number is honest about it.
 *     Amortizing it across the rows, as `blockBytes / rows.length` would, makes
 *     the preamble MORE forgiving the longer the ladder gets.
 *
 * Caps are set at what the table measures today, rounded up to the next ten,
 * not at a comfortable number above it — a rework that leaves headroom is a
 * raised budget wearing a different hat. If the next row cannot be written
 * inside them, that is the signal to re-examine the caps with a case, the way
 * this comment does, and not to nudge a constant.
 *
 * The share of VALIDATION.md the table occupies is deliberately NOT pinned.
 * A step adds ~7-9 KB of section against ~250 characters of row, so the ratio
 * falls with every rung whatever the table does; a cap on it would bind for
 * reasons having nothing to do with index quality, and it would pay a step for
 * padding its own section.
 *
 * One more rule, and it is the one that caps growth rather than pricing it:
 * **a row is for a numbered STEP, and an increment folds into its parent's row**
 * as a bolded sub-clause the way § 5d.1, § 5l.1, § 5r.1 and § 6b.5 already do.
 * The ladder's sub-steps outnumber its steps, and the treadmill was partly that
 * nothing said where they belong. Pinned below by the label's own shape.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATION = join(HERE, "..", "..", "..", "docs", "VALIDATION.md");

/** The heading the table lives under. Rows are measured in CHARACTERS, which
 *  is what "an index row is one line" is about — an em dash is one column and
 *  three UTF-8 bytes, and this table is full of them. */
const INDEX_HEADING = "## The ladder at a glance";
/** Measured 249.8 at § 6am. A new row is free at or below this; above it, the
 *  overrun is what has to be trimmed, not the row. */
const ROW_MEAN_MAX_CHARS = 250;
/** Measured 440 at § 6am (§ 6ab's row, the fattest). */
const ROW_MAX_CHARS = 440;
/** Measured 694 at § 6am. The one number here that does not scale, because the
 *  text it bounds does not either. */
const PREAMBLE_MAX_CHARS = 700;

/** GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens.
 *  It KEEPS letters outside ASCII — "Chrétien" slugs to "chrétien" — and the
 *  first version of this function did not, which made it agree with a link
 *  regex that could not match those anchors either. Two errors that cancel
 *  leave a blind spot rather than a failure: every link into the 46 headings
 *  with an accent, a Greek letter or a subscript in them was silently
 *  unchecked, two of which exist today (§ 5f, § 5m) and are both correct. An em
 *  dash is punctuation and still vanishes, leaving the doubled hyphen the
 *  links already carry. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
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
const preamble = block.filter((l) => !l.startsWith("| ["));

describe("VALIDATION.md's summary table stays an index", () => {
  it("is where this test thinks it is", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // Guards against the block silently emptying out and the budget passing
    // for the wrong reason.
    expect(rows.length).toBeGreaterThan(40);
  });

  it("costs, per row, less than the sections it stands in for", () => {
    const total = rows.reduce((sum, r) => sum + r.length, 0);
    expect(total / rows.length).toBeLessThanOrEqual(ROW_MEAN_MAX_CHARS);
  });

  it("has no row that is an essay", () => {
    const over = rows
      .filter((r) => r.length > ROW_MAX_CHARS)
      .map((r) => `${r.slice(0, 60)}… (${r.length} chars)`);
    expect(over).toEqual([]);
  });

  it("keeps the prose around the table from growing with the table", () => {
    const chars = preamble.reduce((sum, l) => sum + l.length, 0);
    expect(chars).toBeLessThanOrEqual(PREAMBLE_MAX_CHARS);
  });

  it("gives a row to a step and not to an increment", () => {
    // "1.5" and "6am" are steps; "5d.1" is § 5d's own refinement and belongs in
    // § 5d's row. The shapes differ in one place: a letter after the decimal's
    // digits is a step's suffix, a decimal after the letter is a sub-step's
    // index.
    const stray = rows
      .map((r) => /^\| \[([^\]]+)\]/.exec(r)?.[1] ?? r.slice(0, 20))
      .filter((label) => !/^\d+(\.\d+)?[a-z]*$/.test(label));
    expect(stray).toEqual([]);
  });

  it("links only to headings that exist", () => {
    const headings = new Set(
      lines
        .filter((l) => /^#{2,4} /.test(l))
        .map((l) => slug(l.replace(/^#+ /, "").trim())),
    );
    const broken = [...doc.matchAll(/\]\(#([^)\s]+)\)/g)]
      .map((m) => m[1]!)
      .filter((anchor) => !headings.has(anchor));
    expect([...new Set(broken)]).toEqual([]);
  });
});
