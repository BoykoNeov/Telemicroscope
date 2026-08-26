import { renderEmitterScene, type EmitterDone, type EmitterJob } from "./emitter";

/**
 * The extended emitter, moved off the main thread.
 *
 * One reply per job, `fluorescence.worker.ts`'s shape exactly, and the reply
 * carries the two **grids** rather than pixels for that worker's reason: the
 * display stretch is a slider over the same numbers, and re-tracing an objective
 * to change a grey scale would make a display choice cost an optical render.
 *
 * Two grids rather than one, which is the difference from A4: this surface shows
 * the emitter as it was authored beside the emitter as it images, and the whole
 * claim is that the first one carries the area element. A panel that only
 * received the image could not draw the object the Jacobian was applied to.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<EmitterJob>) => void) | null;
  postMessage: (message: EmitterDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderEmitterScene(request) });
};
