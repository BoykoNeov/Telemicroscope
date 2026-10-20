import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The heavy tier's list is names, and a name that matches nothing excludes
 * nothing: a renamed heavy file would silently join the fast tier, and a typo
 * would leave its real file there. This file is in the fast tier, so the list
 * is checked on every commit. Read as text rather than imported, because the
 * list sits at the repo root, outside this package's compilation.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const listed = [...readFileSync(join(root, "vitest.heavy.ts"), "utf8").matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]!);

describe("the test tiers (vitest.heavy.ts)", () => {
  it("names real test files, each once, inside the suite's include", () => {
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed).size).toBe(listed.length);
    for (const name of listed) {
      expect(name, name).toMatch(/^packages\/[^/]+\/test\/.+\.test\.ts$/);
      expect(existsSync(join(root, name)), name).toBe(true);
    }
  });

  it("does not list itself — the check has to run in the fast tier", () => {
    expect(listed).not.toContain("packages/core/test/test-tiers.test.ts");
  });
});
