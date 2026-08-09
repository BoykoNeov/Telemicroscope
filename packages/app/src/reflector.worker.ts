import { renderReflector, type ReflectorDone, type ReflectorJob } from "./reflector";

/**
 * One reflector's star image, off the main thread.
 *
 * The same change-of-caller `render.worker.ts` is: `renderReflector` is pure, so
 * this file is a mailbox. It answers one job at a time and stamps the reply with
 * the job's `seq` so `useLatestFromWorker` can drop a superseded frame.
 *
 * The table beside the picture does **not** come through here — six closed-form
 * layouts are microseconds and belong on the main thread, where they can repaint
 * on the same tick as the slider. Only the trace-and-transform half is worth a
 * worker, which is the asymmetry `reflector.ts`'s header describes.
 *
 * `self` is narrowed rather than typed through the WebWorker lib, for the reason
 * `render.worker.ts` gives: the app tsconfig ships DOM, whose globals collide.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ReflectorJob>) => void) | null;
  postMessage: (message: ReflectorDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderReflector(request) });
};
