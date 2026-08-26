/**
 * Every worker factory, in one module at `src/` level, and the placement is a
 * constraint rather than tidiness.
 *
 * Vite resolves `new Worker(new URL("./x.worker.ts", import.meta.url))` only
 * when the URL is a *literal*, and it resolves it relative to the file the
 * literal sits in. TypeScript cannot check that string — `new URL` accepts any
 * — so a path that silently rots during a refactor fails at runtime as a 404
 * and a panel that never paints. Keeping the literals here, beside the workers
 * they name, means a panel under `src/panels/` imports a factory and never
 * carries a path. **A file holding a worker URL literal lives in `src/`.**
 *
 * They are module-level constants for a second reason the hooks depend on:
 * `useLatestFromWorker` keys its mount effect on the factory's identity, so an
 * inline closure would tear the worker down and rebuild it on every render.
 */

export const createStarWorker = () =>
  new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });

export const createFieldWorker = () =>
  new Worker(new URL("./render.field.worker.ts", import.meta.url), { type: "module" });

export const createSkyWorker = () =>
  new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" });

export const createSkyWallWorker = () =>
  new Worker(new URL("./sky.wall.worker.ts", import.meta.url), { type: "module" });

export const createReflectorWorker = () =>
  new Worker(new URL("./reflector.worker.ts", import.meta.url), { type: "module" });

export const createReflectorVignetteWorker = () =>
  new Worker(new URL("./reflector.vignette.worker.ts", import.meta.url), { type: "module" });

export const createBrightfieldWorker = () =>
  new Worker(new URL("./brightfield.worker.ts", import.meta.url), { type: "module" });

export const createPhaseWorker = () =>
  new Worker(new URL("./phase.worker.ts", import.meta.url), { type: "module" });

export const createFluorescenceWorker = () =>
  new Worker(new URL("./fluorescence.worker.ts", import.meta.url), { type: "module" });

export const createFluorescenceSweepWorker = () =>
  new Worker(new URL("./fluorescence.sweep.worker.ts", import.meta.url), { type: "module" });

export const createEmitterWorker = () =>
  new Worker(new URL("./emitter.worker.ts", import.meta.url), { type: "module" });

export const createVolumeWorker = () =>
  new Worker(new URL("./volume.worker.ts", import.meta.url), { type: "module" });

export const createVolumeAxialWorker = () =>
  new Worker(new URL("./volume.axial.worker.ts", import.meta.url), { type: "module" });

export const createVolumeDepthWorker = () =>
  new Worker(new URL("./volume.depth.worker.ts", import.meta.url), { type: "module" });

export const createCoverslipSweepWorker = () =>
  new Worker(new URL("./coverslip.worker.ts", import.meta.url), { type: "module" });

export const createCoverslipIndexWorker = () =>
  new Worker(new URL("./coverslip.index.worker.ts", import.meta.url), { type: "module" });

export const createCoverslipPointWorker = () =>
  new Worker(new URL("./coverslip.point.worker.ts", import.meta.url), { type: "module" });

export const createEyepieceSweepWorker = () =>
  new Worker(new URL("./eyepiece.worker.ts", import.meta.url), { type: "module" });

export const createEyepieceWallWorker = () =>
  new Worker(new URL("./eyepiece.wall.worker.ts", import.meta.url), { type: "module" });

export const createSeeingWorker = () =>
  new Worker(new URL("./seeing.worker.ts", import.meta.url), { type: "module" });

export const createVisualRetinaWorker = () =>
  new Worker(new URL("./visual.worker.ts", import.meta.url), { type: "module" });

export const createVisualCeilingWorker = () =>
  new Worker(new URL("./visual.ceiling.worker.ts", import.meta.url), { type: "module" });

export const createSectionWorker = () =>
  new Worker(new URL("./section.worker.ts", import.meta.url), { type: "module" });

export const createToleranceWorker = () =>
  new Worker(new URL("./tolerance.worker.ts", import.meta.url), { type: "module" });

export const createToleranceScaleWorker = () =>
  new Worker(new URL("./tolerance.scale.worker.ts", import.meta.url), { type: "module" });

export const createCameraWorker = () =>
  new Worker(new URL("./camera.worker.ts", import.meta.url), { type: "module" });

export const createMechOpticsWorker = () =>
  new Worker(new URL("./mech.optics.worker.ts", import.meta.url), { type: "module" });

export const createMechParfocalWorker = () =>
  new Worker(new URL("./mech.parfocal.worker.ts", import.meta.url), { type: "module" });

export const createCollimationWorker = () =>
  new Worker(new URL("./collimation.worker.ts", import.meta.url), { type: "module" });

export const createOptimizeWorker = () =>
  new Worker(new URL("./optimize.worker.ts", import.meta.url), { type: "module" });

export const createBudgetWorker = () =>
  new Worker(new URL("./budget.worker.ts", import.meta.url), { type: "module" });

/** The one factory a panel calls MORE THAN ONCE — A7 keeps a pool of these, one
 * tile per worker at a time. See `stage.worker.ts` for why that is allowed. */
export const createStageWorker = () =>
  new Worker(new URL("./stage.worker.ts", import.meta.url), { type: "module" });
