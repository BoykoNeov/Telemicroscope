/**
 * The heavy tier: test files that `npm test` leaves out and `npm run test:full`
 * runs. Every commit passes the fast tier; the full suite passes before every push
 * (CLAUDE.md, "Repo etiquette").
 *
 * A file is here because it took over 20 s on a quiet full run (2026-10-20, 227
 * files, 4 150 tests, 768 s wall, below-normal priority): 73 files and
 * 1544 tests, 90% of the summed file time. The number beside
 * each is that run's file time — what decided it, not a budget.
 *
 * This is a list of names, not of physics: nothing a heavy file checks is
 * weakened by running it less often, and a file moves between tiers only on a
 * re-measured run. A name that matches no file is a failure of the fast tier's
 * own `test-tiers.test.ts`, so a rename cannot drop a file from both tiers.
 *
 * Run one heavy file by name with `--mode full`: without it the file is
 * excluded and vitest stops with "No test files found".
 */
export const HEAVY: readonly string[] = [
  "packages/core/test/field-volume.test.ts", // 767 s
  "packages/core/test/matched-flat-field.test.ts", // 459 s
  "packages/core/test/second-objective.test.ts", // 453 s
  "packages/core/test/fourth-corner.test.ts", // 360 s
  "packages/core/test/third-magnification.test.ts", // 292 s
  "packages/core/test/refusal-boundary.test.ts", // 192 s
  "packages/core/test/focus-surface.test.ts", // 168 s
  "packages/core/test/doublet-wall.test.ts", // 156 s
  "packages/core/test/escape-interaction.test.ts", // 151 s
  "packages/core/test/escape-window.test.ts", // 138 s
  "packages/core/test/second-interval.test.ts", // 131 s
  "packages/core/test/refusal-frames.test.ts", // 127 s
  "packages/core/test/aperture-and-field.test.ts", // 123 s
  "packages/core/test/stop-default.test.ts", // 111 s
  "packages/core/test/mosaic.test.ts", // 110 s
  "packages/core/test/mosaic-spectrum.test.ts", // 101 s
  "packages/core/test/tolerance-compensated.test.ts", // 99 s
  "packages/app/test/tolerance.test.ts", // 98 s
  "packages/app/test/budget.test.ts", // 93 s
  "packages/core/test/mosaic-flat-field.test.ts", // 86 s
  "packages/core/test/branch-separation.test.ts", // 85 s
  "packages/core/test/fractional-sampling.test.ts", // 85 s
  "packages/core/test/real-aim-light.test.ts", // 80 s
  "packages/core/test/seeing-inner-scale.test.ts", // 79 s
  "packages/core/test/anisotropy-window.test.ts", // 78 s
  "packages/core/test/seeing.test.ts", // 78 s
  "packages/app/test/phase.test.ts", // 77 s
  "packages/app/test/emitter.test.ts", // 74 s
  "packages/core/test/render.test.ts", // 69 s
  "packages/core/test/mtf-share.test.ts", // 65 s
  "packages/core/test/spectral-volume.test.ts", // 65 s
  "packages/core/test/seeing-geometric.test.ts", // 65 s
  "packages/core/test/focus-correction.test.ts", // 63 s
  "packages/core/test/spectral-field-volume.test.ts", // 62 s
  "packages/core/test/cost-law.test.ts", // 60 s
  "packages/core/test/seam-branch-handover.test.ts", // 60 s
  "packages/core/test/depth-aberration.test.ts", // 58 s
  "packages/core/test/commensurate.test.ts", // 58 s
  "packages/core/test/field-seam.test.ts", // 48 s
  "packages/core/test/band-limited-peak.test.ts", // 48 s
  "packages/core/test/stage-seam-guard.test.ts", // 45 s
  "packages/core/test/edge-resolved-kernel.test.ts", // 44 s
  "packages/core/test/emitter-spectrum.test.ts", // 43 s
  "packages/app/test/builder.test.ts", // 41 s
  "packages/core/test/radial-map.test.ts", // 41 s
  "packages/core/test/tolerance-quadruplet.test.ts", // 39 s
  "packages/app/test/seeing.test.ts", // 38 s
  "packages/app/test/reflector.test.ts", // 38 s
  "packages/app/test/mech.test.ts", // 37 s
  "packages/app/test/optimize.test.ts", // 36 s
  "packages/app/test/volume-mount.test.ts", // 36 s
  "packages/core/test/anisotropy-corner.test.ts", // 36 s
  "packages/app/test/camera.test.ts", // 36 s
  "packages/core/test/lattice-disk.test.ts", // 35 s
  "packages/core/test/guard-constant.test.ts", // 35 s
  "packages/core/test/anisotropy-turn.test.ts", // 33 s
  "packages/core/test/sweep-plan.test.ts", // 33 s
  "packages/app/test/section.test.ts", // 30 s
  "packages/core/test/superachromat-lens.test.ts", // 27 s
  "packages/core/test/illumination.test.ts", // 26 s
  "packages/core/test/lister.test.ts", // 26 s
  "packages/core/test/field-seam-zero.test.ts", // 26 s
  "packages/app/test/coverslip.test.ts", // 25 s
  "packages/core/test/object-field.test.ts", // 25 s
  "packages/core/test/edge-crossing.test.ts", // 25 s
  "packages/core/test/tolerance-budget.test.ts", // 24 s
  "packages/app/test/collimation.test.ts", // 23 s
  "packages/core/test/emitter-volume.test.ts", // 22 s
  "packages/core/test/specimen.test.ts", // 21 s
  "packages/core/test/optimize.test.ts", // 21 s
  "packages/core/test/mtf-rows.test.ts", // 21 s
  "packages/core/test/fluorescence-mosaic.test.ts", // 21 s
  "packages/core/test/volume.test.ts", // 20 s
];
