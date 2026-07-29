import { slipReadout, type ReadoutDone, type ReadoutJob } from "./coverslip";

/**
 * The one slip the sliders are standing on — both refocus models, ~200 ms.
 *
 * The live half of A6, and the reason the sweeps are keyed without the sliders.
 * 200 ms is past the line where a main-thread call would stutter the drag, and
 * `useLatestFromWorker`'s backpressure drops the intermediate values a slider
 * emits rather than queueing them.
 *
 * It is ~500 ms at the one slip where the focus bracket has to widen (§ 1.6.1),
 * which is the honest cost of the answer being a minimum rather than an edge.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ReadoutJob>) => void) | null;
  postMessage: (message: ReadoutDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: slipReadout(request) });
};
