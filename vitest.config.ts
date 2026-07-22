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
     */
    testTimeout: 30_000,
  },
});
