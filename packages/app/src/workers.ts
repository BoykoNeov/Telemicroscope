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

export const createBrightfieldWorker = () =>
  new Worker(new URL("./brightfield.worker.ts", import.meta.url), { type: "module" });

export const createPhaseWorker = () =>
  new Worker(new URL("./phase.worker.ts", import.meta.url), { type: "module" });

export const createFluorescenceWorker = () =>
  new Worker(new URL("./fluorescence.worker.ts", import.meta.url), { type: "module" });

export const createFluorescenceSweepWorker = () =>
  new Worker(new URL("./fluorescence.sweep.worker.ts", import.meta.url), { type: "module" });

export const createVolumeWorker = () =>
  new Worker(new URL("./volume.worker.ts", import.meta.url), { type: "module" });

export const createVolumeAxialWorker = () =>
  new Worker(new URL("./volume.axial.worker.ts", import.meta.url), { type: "module" });

/** The one factory a panel calls MORE THAN ONCE — A7 keeps a pool of these, one
 * tile per worker at a time. See `stage.worker.ts` for why that is allowed. */
export const createStageWorker = () =>
  new Worker(new URL("./stage.worker.ts", import.meta.url), { type: "module" });
