import { renderPhaseScene, type PhaseDone, type PhaseJob } from "./phase";

/**
 * The phase-null pair, moved off the main thread.
 *
 * One reply per job, and one job carries **both** images — see
 * `renderPhaseScene`. Two jobs would let a slider drag show an in-focus frame at
 * one φ beside a defocused one at another, and the whole panel is the comparison
 * between them. ~146 ms per pair at the default sampling under `vite-node`.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<PhaseJob>) => void) | null;
  postMessage: (message: PhaseDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderPhaseScene(request) });
};
