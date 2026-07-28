import { depthStrehl, type DepthDone, type DepthJob } from "./volume";

/**
 * Strehl against depth, in a third worker — and the third worker is the point.
 *
 * The axial worker beside it depends on the panel's depth slider, because the
 * curve it draws is the response of an emitter at *that* depth. This one is a
 * sweep **over** depth, so the slider must not move it at all: it is keyed on the
 * objective and the mount, and it sits still while the reader drags anything
 * else. Sharing the axial worker would have re-run a 0.2 s bisection on every
 * step of a control whose whole answer is already on the curve.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<DepthJob>) => void) | null;
  postMessage: (message: DepthDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: depthStrehl(request) });
};
