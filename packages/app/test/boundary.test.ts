import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../src/panels/boundary";

/**
 * The error boundary is mounted, and it is mounted where it resets.
 *
 * **What can be checked here and what cannot.** Vitest collects `.test.ts` only
 * and runs with no DOM environment, so nothing in this repo can render a React
 * tree — there is no way to throw from a panel and assert what the page looks
 * like afterwards. That check is a browser one, and it is written down in the
 * step's landing note in `docs/UI-PLAN.md`.
 *
 * What is left is the half where this step gets silently undone, and it is a
 * real half: deleting the `<PanelBoundary>` wrapper from `App.tsx` compiles,
 * typechecks, passes every other test in this directory, and paints all
 * thirty-one panels exactly as before. The only symptom is a white page on a day
 * something throws. Same failure mode as the transfer list in step 2, and the
 * same answer — pin the wiring by reading the source.
 *
 * Two things are pinned, not one. That the boundary wraps the panel subtree, and
 * that it is **keyed on the route**, because an unkeyed boundary is worse than
 * none: it latches on the first error and then renders that message for every
 * route the reader clicks afterwards, so the nav appears to stop working.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const app = readFileSync(join(SRC, "App.tsx"), "utf8");

describe("the panel error boundary", () => {
  it("wraps the lazy panel, not just the shell", () => {
    expect(app).toContain("<PanelBoundary");
    // Order in the file is the nesting: the boundary opens before `Suspense`,
    // so a rejected `lazy()` chunk is caught rather than escaping to the root.
    const boundary = app.indexOf("<PanelBoundary");
    const suspense = app.indexOf("<Suspense");
    expect(boundary).toBeGreaterThanOrEqual(0);
    expect(suspense).toBeGreaterThan(boundary);
  });

  it("is keyed on the route, with the same key as the fade wrapper", () => {
    // One expression, used twice. If the two ever diverge the error would clear
    // on a different event than the panel remounts on, which is the bug that
    // reads as "the nav does nothing".
    expect(app).toContain("const routeKey = ");
    expect(app).toContain('className="panel-fade" key={routeKey}');
    expect(app).toContain("<PanelBoundary key={routeKey}>");
  });

  it("has a style to render into, in a token rather than a literal", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    expect(css).toContain(".panel-error");
    expect(css).toMatch(/\.panel-error-line\s*\{[^}]*var\(--bad\)/);
  });
});

/**
 * `throw` takes any value, and the boundary has to print a sentence for
 * whatever arrives. The case that actually matters is the first one — a failed
 * chunk import is an ordinary `Error` — and the rest are here because a
 * boundary that renders `undefined` where the explanation goes is a second
 * failure on top of the first.
 */
describe("errorMessage", () => {
  it("takes an Error's message", () => {
    expect(errorMessage(new Error("Failed to fetch dynamically imported module: /x.js"))).toBe(
      "Failed to fetch dynamically imported module: /x.js",
    );
  });

  it("falls back to the name when the message is empty", () => {
    expect(errorMessage(new TypeError(""))).toBe("TypeError");
  });

  it("takes a thrown string as itself", () => {
    expect(errorMessage("nope")).toBe("nope");
  });

  it("says something for a value that is neither", () => {
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(7)).toBe("7");
  });

  it("never returns the empty string, which would render a blank explanation", () => {
    // The same failure the `Error` branch guards against, from the other side:
    // `throw ""` is legal, and "this panel stopped: " with nothing after it is
    // a second failure on top of the first.
    expect(errorMessage("")).toBe("unknown error");
  });
});
