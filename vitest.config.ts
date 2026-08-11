import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    /**
     * Drops each worker to below-normal OS priority so a full run leaves the
     * machine usable. The reasoning for doing it per worker rather than once in
     * this file — and for below-normal rather than idle — is in the setup file
     * itself, next to the call.
     */
    setupFiles: ["./vitest.setup.ts"],
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
     *
     * The priority reduction above spends this headroom on purpose: niced
     * workers wait behind other work, so the margin between 29.2 s and this
     * budget is now a function of what else the machine is doing. A rung that
     * starts failing on time should be repeated with
     * `TELEMICROSCOPE_TEST_PRIORITY=normal` before the failure is believed — if
     * it passes unniced, the finding is about load, not about physics.
     */
    testTimeout: 60_000,
  },
});
