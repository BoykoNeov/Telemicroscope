import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    /**
     * A render is a physics computation, not a unit assertion: the star-field
     * golden traces 4×4 patches × 5 wavelengths and takes ~4 s alone, which the
     * 5 s default clears on an idle machine and misses once the other twenty
     * files are running beside it. That failure says nothing about the image,
     * so the budget is raised rather than the test being made cheaper — a
     * golden that renders less is a golden that pins less.
     *
     * **Raised to 60 s while wiring § 6o.8.** § 6p.7 renders a 3 228-point
     * condenser and takes 29.2 s alone — inside the old budget, and past it once
     * the rest of the suite is competing for cores. It was already failing that
     * way on this machine *before* § 6o.8 added a file, so the ladder had a rung
     * whose pass depended on machine load, which is worse than a slow suite. Same
     * reasoning as above, same answer: a timeout is a budget, not a tolerance, and
     * no physics is loosened by moving it.
     */
    testTimeout: 60_000,
  },
});
