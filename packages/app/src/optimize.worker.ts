import { describeOptimize, type TracedDone, type TracedJob } from "./optimize";

/**
 * The optimiser panel's traced readout, moved off the main thread.
 *
 * One reply per job, and the job is the whole spec rather than the traced wish
 * alone: a traced merit is the seed's paraxial wishes AND the traced one, and
 * splitting them across two calls would let the page show a run whose focal
 * wish came from a different set of controls than its spot wish.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<TracedJob>) => void) | null;
  postMessage: (message: TracedDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: request === null ? null : describeOptimize(request) });
};
