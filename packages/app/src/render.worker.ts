import { renderStar, type RenderDone, type RenderJob } from "./render";

/**
 * The optical pipeline, moved off the main thread.
 *
 * `renderStar` was written pure for exactly this (see its header): the worker is
 * a change of *caller*, not of code. It answers one job at a time and stamps the
 * reply with the job's `seq`; the caller keeps only one render in flight and
 * queues the newest request, so a drag's intermediate frames are never traced.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window here and its `postMessage` signature is the wrong one. Rather than pull
 * in the WebWorker lib — whose globals collide with DOM — narrow `self` to just
 * the two members this worker touches.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RenderJob>) => void) | null;
  postMessage: (message: RenderDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderStar(request) });
};
