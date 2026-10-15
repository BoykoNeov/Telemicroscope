import { describe, it, expect } from "vitest";
import { TOPICS, TOURS, tourPlace } from "../src/guide";
import { PANELS, PANEL_GROUPS, panelFor } from "../src/panels/registry";

/**
 * The app's map against the registry — APP.md's Part R.
 *
 * No engine capability is involved, so no validation rung is: this pins one
 * data file against one array, in both directions, so the start page and the
 * menus cannot drift from the routes. The start page and the menus are built
 * FROM these two lists, so "every panel is reachable from the start page" is
 * the statement that every panel has a topic the page walks — checked below
 * rather than assumed from the construction.
 *
 * Damage run before this landed, to prove each check can fail:
 *
 * | Damage | Caught by |
 * | --- | --- |
 * | a panel's `topic` set to a microscope topic while its group says telescope | *sits in a topic of its own branch* |
 * | a tour step misspelt (`brightfeld`) | *visits only routes that exist* |
 * | `phase` added to the telescope tour as well | *puts a route on at most one tour* |
 * | a summary reading "APP.md A3 — the phase null" | *says it in plain words* |
 */

const ids = new Set(PANELS.map((p) => p.id));
const groups = new Set(PANEL_GROUPS.map((g) => g.id));

/** Doc-internal shorthand a first-time reader cannot decode. */
const JARGON = /§|APP\.md|ROADMAP|VALIDATION|\bPart [A-Z]\b|\bstep \d/;

describe("every surface is on the map", () => {
  it("lands a bare hash on the start page", () => {
    expect(PANELS[0]!.id).toBe("home");
    expect(panelFor("").id).toBe("home");
  });

  it("gives every surface a plain sentence", () => {
    for (const panel of PANELS) {
      expect(panel.summary.length, `${panel.id} has a summary`).toBeGreaterThan(10);
      expect(panel.summary, `${panel.id}'s summary`).not.toMatch(JARGON);
    }
  });

  it("puts every surface in a listed topic that sits in its own branch", () => {
    for (const panel of PANELS) {
      const topic = TOPICS.find((t) => t.id === panel.topic);
      expect(topic, `${panel.id}'s topic ${panel.topic} is listed`).toBeDefined();
      expect(topic!.group, `${panel.id} sits in a topic of its own branch`).toBe(panel.group);
    }
  });

  it("reaches every surface but itself from the start page's sections", () => {
    // What `home.tsx` walks: every group but `start`, every topic in it.
    const shown = new Set(
      TOPICS.filter((t) => t.group !== "start" && groups.has(t.group)).flatMap((t) =>
        PANELS.filter((p) => p.topic === t.id).map((p) => p.id),
      ),
    );
    expect(PANELS.filter((p) => p.id !== "home" && !shown.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it("leaves no topic empty, and says what each holds in plain words", () => {
    for (const topic of TOPICS) {
      expect(groups.has(topic.group), `${topic.id}'s group is listed`).toBe(true);
      expect(PANELS.some((p) => p.topic === topic.id), `${topic.id} has a surface`).toBe(true);
      expect(topic.hint, `${topic.id}'s hint`).not.toMatch(JARGON);
    }
  });
});

describe("the guided paths", () => {
  it("visit only routes that exist, and say why in plain words", () => {
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(1);
      for (const step of tour.steps) expect(ids.has(step), `${tour.id} → ${step}`).toBe(true);
      expect(tour.why).not.toMatch(JARGON);
      expect(tour.title).not.toMatch(JARGON);
    }
  });

  it("put a route on at most one tour, so 'next' has one meaning", () => {
    const seen = new Map<string, string>();
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        expect(seen.get(step), `${step} is on ${seen.get(step)} and ${tour.id}`).toBeUndefined();
        seen.set(step, tour.id);
      }
    }
  });

  it("finds a route's place on its tour, and nothing for a route on none", () => {
    const tour = TOURS[0]!;
    const last = tour.steps.length - 1;
    expect(tourPlace(tour.steps[last]!)).toEqual({ tour, index: last });
    expect(tourPlace("home")).toBeNull();
  });
});
