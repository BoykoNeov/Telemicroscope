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
     * golden traces 4×4 patches × 5 wavelengths and took ~4 s alone, which the
     * 5 s default clears on an idle machine and misses once the other twenty
     * files are running beside it. That failure says nothing about the image,
     * so the budget is raised rather than the test being made cheaper — a
     * golden that renders less is a golden that pins less. (That rung is now
     * 2.2 s, § 3c.1's PSF radius cache having roughly halved it, and its file
     * 4.4 s. The number that keeps this budget where it is was never this one.)
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
     *
     * **Raised to 180 s when the mosaic branch's fixtures went lazy**, and the
     * first thing to say is that 60 s was ALREADY marginal. On the run before
     * that change the slowest rung was § 6bm.7's forced surface at **44.7 s**
     * and § 6bl.5's refusing sweep at 33 s — 1.34× of headroom on the worst one,
     * in a suite that already had load-dependent timeouts on record (see the
     * hook in `vitest.setup.ts`). The refactor did not create that; it exposed it.
     *
     * What the refactor changed is WHERE the cost sits. Those five files built
     * their sweeps and mosaics as module-level `const`s, so 181.8 s of it sat in
     * COLLECT, which no per-test budget covers. Wrapped in `once` (see
     * `fourth-corner.test.ts`) the same work lands inside whichever rung reads a
     * fixture first — the same work, in a region that IS budgeted. Measured on a
     * full run: the slowest rung is now **70 s**, § 6bm.1's borrowed-number rung,
     * which is 30.3 s alone — a 2.3× load multiplier — and **eight** rungs across
     * four files sit above 40 s. So the budget covers a band and not one outlier,
     * and 180 s is 2.6× the measured maximum.
     *
     * Global rather than per-rung on purpose. `it()` takes its own timeout and
     * the surgical fix looks tempting, but WHICH rung constructs a file's
     * fixtures is a property of rung ORDER: insert a rung that reads a fixture
     * earlier and the cost moves to it. Hand-placed budgets would have to be
     * re-derived every time that happens, which is bookkeeping that goes stale
     * silently. A global budget is invariant to the ordering.
     *
     * The same rule as every raise above applies: this is a budget, not a
     * tolerance, and nothing about the physics moved — the numeric literals in
     * all five files are identical, and in the same order, before and after.
     * What is lost is detection speed on a genuine hang, and the 60 s figure was
     * already not really providing that for a suite whose slowest file runs 80 s.
     */
    testTimeout: 180_000,
  },
});
