import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PANELS, PANEL_GROUPS } from "../src/panels/registry";

/**
 * The stylesheet and the panels agree on what a token is.
 *
 * Every colour the panels name is a `var(--…)` resolved by `styles.css`, and a
 * token that one side spells and the other does not is invisible to the type
 * checker: `color: "var(--ink-6)"` compiles, and paints the browser's fallback —
 * black text on the dark theme, which is exactly the failure the tokens exist to
 * rule out. So this file reads both sides and diffs them.
 *
 * Three checks. Every token used in `src/` is defined on `:root`. Every token
 * `:root` defines for the light palette is redefined in BOTH dark blocks — the
 * system-preference one and the explicit `data-theme="dark"` one — so a token
 * added to light alone cannot ship a light colour into dark. And no hex colour
 * has crept back into a panel other than `#000`, which is the one literal the
 * house style keeps: a raster picture's canvas is an image plane in either theme.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const css = readFileSync(join(SRC, "styles.css"), "utf8");

/** The `--name: value;` declarations inside one `{ … }` block. */
function declarations(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
}

/** The body of the first block whose selector line contains `selector`. */
function blockOf(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `styles.css has a "${selector}" block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const LIGHT = declarations(blockOf(":root {"));
const DARK_SYSTEM = declarations(blockOf(':root:not([data-theme="light"])'));
const DARK_EXPLICIT = declarations(blockOf(':root[data-theme="dark"]'));

/** Tokens that are not colours and so have no reason to change with the theme. */
const THEME_INVARIANT = new Set(["--mono", "--sans", "--radius"]);

describe("the design tokens", () => {
  const files = walk(SRC);

  it("are all defined: every var(--x) a source file names is on :root", () => {
    const missing = new Map<string, string[]>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/var\((--[\w-]+)/g)) {
        const token = m[1]!;
        if (!LIGHT.has(token)) missing.set(token, [...(missing.get(token) ?? []), file]);
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it("are all themed: every colour token the light palette defines, both dark blocks redefine", () => {
    const light = [...LIGHT].filter((t) => !THEME_INVARIANT.has(t)).sort();
    const notInSystem = light.filter((t) => !DARK_SYSTEM.has(t));
    const notInExplicit = light.filter((t) => !DARK_EXPLICIT.has(t));
    expect(notInSystem).toEqual([]);
    expect(notInExplicit).toEqual([]);
    // And the two dark blocks are the same palette: a reader who picked dark by
    // hand must see what a reader whose OS picked it sees.
    expect([...DARK_EXPLICIT].sort()).toEqual([...DARK_SYSTEM].sort());
  });

  it("have replaced the hex literals in the panels, except the picture black", () => {
    // Spectral line colours are physics, not theme: F is blue and C is red on
    // any background, so the adapters that name them (`rayfan.ts`, `spot.ts`)
    // and the few series that reuse those hues are exempt by listing.
    const ALLOWED = new Set(["#000", "#111", "#2b5fd9", "#c08a00", "#9ad9bd"]);
    const offenders: string[] = [];
    for (const file of files) {
      if (!/[\\/]panels[\\/]|[\\/]ui\.tsx$|[\\/]plot\.tsx$|[\\/]App\.tsx$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?<=["'\s])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
        const hex = `#${m[1]!.toLowerCase()}`;
        if (!ALLOWED.has(hex)) offenders.push(`${file.slice(SRC.length + 1)}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the nav groups", () => {
  it("cover every panel, and every group has at least one panel", () => {
    const ids = new Set(PANEL_GROUPS.map((g) => g.id));
    for (const panel of PANELS) expect(ids.has(panel.group), `${panel.id} is in a listed group`).toBe(true);
    for (const group of PANEL_GROUPS) {
      expect(PANELS.some((p) => p.group === group.id), `${group.id} has a panel`).toBe(true);
    }
  });
});
