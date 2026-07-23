import { renderFieldScene, type FieldFrame, type FieldJob } from "./render";

/**
 * The multi-star field render, moved off the main thread.
 *
 * Unlike the single-star worker, one job answers with SEVERAL frames: the field
 * render refines coarse-to-fine (`renderFieldScene`'s `onLevel`), and each level
 * is posted as it lands, stamped with the job's `seq` and a `done` flag on the
 * finest. The caller shows every matching frame but only pulls its next queued
 * job once `done` arrives, so refinement is never cut off mid-flight.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to just the two members this worker touches rather than pull
 * in the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<FieldJob>) => void) | null;
  postMessage: (message: FieldFrame) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  renderFieldScene(request, (result, done) => {
    ctx.postMessage({ seq, result, done });
  });
};
