import { vignetteSweep, type VignetteDone, type VignetteJob } from "./reflector";

/**
 * The throughput-against-field sweep, off the main thread.
 *
 * It earns its own worker rather than sharing the star one because it is a sweep
 * of *traces*: each point is a transform plus a 101×101 ray bundle, and the
 * bisection that finds the chief-ray wall adds forty more traces on top. Sharing
 * a worker with the picture would make the image wait behind the plot on every
 * slider tick, which is the distinction D6 drew between first-order work and
 * sweeps.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<VignetteJob>) => void) | null;
  postMessage: (message: VignetteDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: vignetteSweep(request) });
};
