import { runCollimation, type CollimationDone, type CollimationJob } from "./collimation";

/**
 * Three field sweeps per request — aligned, misaligned, and misaligned under the
 * old aiming — each a wavefront fit per field sample. Well past a frame, and the
 * whole reason this is a worker: the magnitude slider stays glued to the finger
 * while the panel dims and catches up.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CollimationJob>) => void) | null;
  postMessage: (message: CollimationDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: runCollimation(request) });
};
