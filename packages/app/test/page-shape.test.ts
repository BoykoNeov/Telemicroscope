import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The page shape — UI-PLAN step 11, "picture first".
 *
 * A panel opens with its title and ONE short paragraph (`className="lead"`),
 * then the controls and the picture, and the long explanation sits under them
 * in `<Notes>` folds. `npm test` renders no React, so this pins the source, the
 * way `theme.test.ts` and `boundary.test.ts` do.
 *
 * **The list below is the work queue of UI-PLAN step 12**, and the test is
 * built so the queue can only shrink: a panel named in `NOT_YET` is skipped,
 * but a panel that HAS been converted and is still named there fails — so the
 * commit that converts a panel has to delete its line, and nobody has to
 * remember to. When the set is empty, delete it and the branch that reads it.
 *
 * No engine capability is involved, so no validation-ladder rung is.
 */

const PANELS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "panels");

/** Files in `panels/` that are not pages a reader lands on, with the reason. */
const NOT_A_PAGE = new Set([
  "boundary.tsx", // the error boundary
  "home.tsx", // the start page: a map, no experiment
  "home-art.tsx", // the start page's drawings
  "scope.tsx", // the whole microscope: a diagram and cards, its own shape (APP.md Part S)
]);

/** UI-PLAN step 12's queue. Convert a panel, then delete its line here. */
const NOT_YET = new Set([
  "bench.tsx",
  "budget.tsx",
  "builder.tsx",
  "camera.tsx",
  "chromatic.tsx",
  "collimation.tsx",
  "coverslip.tsx",
  "curvature.tsx",
  "design.tsx",
  "editor.tsx",
  "emitter.tsx",
  "eyepiece.tsx",
  "fluorescence.tsx",
  "mech.tsx",
  "mtf.tsx",
  "optimize.tsx",
  "phase.tsx",
  "reflector.tsx",
  "section.tsx",
  "seeing.tsx",
  "sky.tsx",
  "spot.tsx",
  "stage.tsx",
  "telecentric.tsx",
  "tolerance.tsx",
  "visual.tsx",
  "volume.tsx",
  "wavefront.tsx",
]);

const pages = readdirSync(PANELS_DIR)
  .filter((name) => name.endsWith(".tsx") && !NOT_A_PAGE.has(name))
  .sort();

const source = (name: string): string => readFileSync(join(PANELS_DIR, name), "utf8").replace(/\r\n/g, "\n");

/**
 * What "converted" means, mechanically:
 *  - one lead paragraph, directly under the first title;
 *  - at least one `<Notes>` fold;
 *  - no `.prose` paragraph between that title and the first control or
 *    picture — that stretch is exactly the wall this step removes.
 */
function shape(text: string): { lead: boolean; notes: boolean; wall: number } {
  const title = text.indexOf("<h1");
  const afterTitle = title === -1 ? "" : text.slice(text.indexOf("</h1>", title) + 5);
  const lead = /^\s*<p className="lead">/.test(afterTitle);
  const notes = text.includes("<Notes ");
  const firstControl = afterTitle.search(/<(Slider|Choice|Toggles|NumberField|Fieldset|canvas|Plot)\b|className="controls"/);
  const head = firstControl === -1 ? afterTitle : afterTitle.slice(0, firstControl);
  const wall = (head.match(/<p className="prose"/g) ?? []).length;
  return { lead, notes, wall };
}

describe("the page shape (UI-PLAN step 11)", () => {
  it("covers every file in panels/: each is a page, or is listed as not one", () => {
    expect(pages.length).toBeGreaterThan(25);
    for (const name of NOT_YET) expect(pages, `${name} is in NOT_YET but is not a panel file`).toContain(name);
  });

  for (const name of pages) {
    if (NOT_YET.has(name)) {
      it(`${name} is still queued — and has not been converted behind the queue's back`, () => {
        const s = shape(source(name));
        const converted = s.lead && s.notes && s.wall === 0;
        expect(converted, `${name} is converted: delete it from NOT_YET in this file`).toBe(false);
      });
    } else {
      it(`${name} opens on a lead, then the experiment, with its notes beneath`, () => {
        const s = shape(source(name));
        expect(s.lead, "a <p className=\"lead\"> directly under the first <h1>").toBe(true);
        expect(s.notes, "at least one <Notes> fold").toBe(true);
        expect(s.wall, "no .prose paragraph between the title and the first control").toBe(0);
      });
    }
  }

  it("keeps Choice and Toggles on the shared class, not on inline styles", () => {
    const ui = readFileSync(join(PANELS_DIR, "..", "ui.tsx"), "utf8");
    expect(ui.match(/className="choice-option"/g)?.length).toBe(2);
    expect(ui).toContain("aria-pressed={option === props.value}");
  });
});
