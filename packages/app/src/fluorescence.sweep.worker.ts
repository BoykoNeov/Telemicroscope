import { transferSweep, type TransferDone, type TransferJob } from "./fluorescence";

/**
 * A4's transfer sweep, off the main thread — and unlike A2's and A3's sweeps,
 * this one had to be.
 *
 * Those two sum pupil evaluations and cost 190 ms and 20 ms, which a
 * `setTimeout` deferral covers. This one renders an image per frequency: 1.3 s
 * at pupil samples 64 and 2.0 s at 128, measured in the browser. On the main
 * thread that froze the page hard enough to time a screenshot out, which is a
 * defect a slider drag would have hit on every objective change.
 *
 * A second worker beside the render one rather than a second message type on it:
 * the two jobs have independent lifetimes — the picture re-renders on every bead
 * and stretch change while the sweep does not move at all — and separate workers
 * let them run at the same time instead of queueing behind each other.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<TransferJob>) => void) | null;
  postMessage: (message: TransferDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: transferSweep(request) });
};
