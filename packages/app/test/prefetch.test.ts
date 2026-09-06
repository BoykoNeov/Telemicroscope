import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { lazyPanel, PANELS, type PanelProps } from "../src/panels/registry";

/**
 * UI-PLAN step 7: a route's chunk is fetched on hover, and a fetched chunk
 * paints without the `panel-loading` frame.
 *
 * **What can be checked here and what cannot.** Vitest has no DOM, so whether a
 * *browser* fetches `rayfan-*.js` when the pointer reaches its nav link is a
 * network-tab check, written down in the step's landing note. What the server
 * renderer CAN answer is the half that decides whether the prefetch is worth
 * anything: `renderToString` renders a suspended `lazy` as its fallback, and a
 * component that has the chunk in hand as itself. So the property "a loaded
 * panel mounts with no loading frame" is a string comparison here.
 *
 * The other pin is the same shape as `boundary.test.ts`: the hover handlers in
 * `App.tsx` can be deleted and every panel still paints exactly as before, so
 * the wiring is read from the source.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

const Fake = (props: PanelProps) => createElement("p", null, `fake panel, broken=${props.linkBroken}`);
const PROPS: PanelProps = { link: null, linkBroken: false };

/** The entry under a `Suspense` with a fallback that cannot be mistaken for the panel. */
const mount = (Component: (typeof PANELS)[number]["Component"]) =>
  renderToString(createElement(Suspense, { fallback: "LOADING" }, createElement(Component, PROPS)));

describe("lazyPanel", () => {
  it("imports once: the hover and the render share the same promise", async () => {
    let calls = 0;
    const entry = lazyPanel(async () => {
      calls += 1;
      return { default: Fake };
    });
    const first = entry.load();
    const second = entry.load();
    expect(second).toBe(first);
    expect(await first).toBe(Fake);
    // A render after the load reaches the same memo, not the loader.
    mount(entry.Component);
    expect(calls).toBe(1);
  });

  it("renders the fallback while the chunk is in flight", () => {
    const entry = lazyPanel(() => new Promise(() => {}));
    expect(mount(entry.Component)).toContain("LOADING");
  });

  it("renders a loaded panel directly — no fallback, so no loading frame", async () => {
    const entry = lazyPanel(async () => ({ default: Fake }));
    // The `lazy` path first, as a control: without the chunk it is the fallback.
    expect(mount(entry.Component)).toContain("LOADING");
    await entry.load();
    const html = mount(entry.Component);
    expect(html).toContain("fake panel, broken=false");
    expect(html).not.toContain("LOADING");
  });

  it("memoises a rejection, which is what the browser does with the URL anyway", async () => {
    let calls = 0;
    const entry = lazyPanel(() => {
      calls += 1;
      return Promise.reject(new Error("Failed to fetch dynamically imported module: /x.js"));
    });
    await expect(entry.load()).rejects.toThrow("/x.js");
    await expect(entry.load()).rejects.toThrow("/x.js");
    expect(calls).toBe(1);
  });
});

describe("the registry and the nav", () => {
  it("gives every entry a loader beside its component", () => {
    for (const panel of PANELS) {
      expect(typeof panel.load, `${panel.id} has load`).toBe("function");
      expect(typeof panel.Component, `${panel.id} has Component`).toBe("function");
    }
  });

  it("calls the loader on hover and on focus of a nav link", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).toContain("onMouseEnter={() => warm(entry)}");
    expect(app).toContain("onFocus={() => warm(entry)}");
    // `warm` is the loader with the rejection swallowed — see its comment.
    expect(app).toMatch(/function warm\(entry: Panel\): void \{\s*entry\.load\(\)\.catch/);
  });
});
