import {
  renderFluorescenceScene,
  type FluorescenceDone,
  type FluorescenceJob,
} from "./fluorescence";

/**
 * The bead field, moved off the main thread.
 *
 * One reply per job, `phase.worker.ts`'s shape exactly. The reply carries the
 * **intensity grid** rather than pixels, which is the one difference from A2 and
 * A3 and it is deliberate: the display stretch on this panel is a slider over
 * the same numbers, and re-tracing an objective to change a grey scale would
 * make a display choice cost an optical render.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<FluorescenceJob>) => void) | null;
  postMessage: (message: FluorescenceDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderFluorescenceScene(request) });
};
