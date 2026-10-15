import { renderScope, type ScopeDone, type ScopeJob } from "./scope";
import { postTransferring } from "./transfer";

/**
 * The whole-microscope render, off the main thread — APP.md Part S.
 *
 * One reply per job, like the colour section's worker it is built on: ~130–200
 * ms at the quick sampling and a few seconds at the fine one, and the hook's
 * backpressure drops the settings a dragged slider passes through.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is narrowed to
 * the two members this worker touches.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ScopeJob>) => void) | null;
  postMessage: (message: ScopeDone, transfer?: Transferable[]) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  postTransferring(ctx, { seq, result: renderScope(request) });
};
