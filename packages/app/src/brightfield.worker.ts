import {
  renderBrightfieldScene,
  type BrightfieldDone,
  type BrightfieldJob,
} from "./brightfield";

/**
 * The brightfield render, moved off the main thread.
 *
 * One reply per job, like the star worker: `renderBrightfield` at `patches` = 1
 * has nothing to refine across, so there is no coarse-to-fine sequence to post
 * the way the field worker does. ~245 ms of Abbe sum per S the slider stops on,
 * and the hook's backpressure drops the values it passes through.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<BrightfieldJob>) => void) | null;
  postMessage: (message: BrightfieldDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderBrightfieldScene(request) });
};
