import { renderVolumeScene, type VolumeDone, type VolumeJob } from "./volume";

/**
 * The focus stack, moved off the main thread.
 *
 * One reply per job, `fluorescence.worker.ts`'s shape exactly — and its
 * departure kept too: the reply carries the **intensity grid** rather than
 * pixels, so the display stretch remaps the same numbers instead of re-rendering
 * a stack of planes to change a grey scale.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<VolumeJob>) => void) | null;
  postMessage: (message: VolumeDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderVolumeScene(request) });
};
