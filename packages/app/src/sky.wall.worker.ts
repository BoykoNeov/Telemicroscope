import { skyWallSweep, type WallPoint, type WallRequest } from "./sky";

/**
 * The framing wall against focal ratio — the panel's second plot.
 *
 * Its own worker rather than a second job on the render one, for C6's reason:
 * the sweep must stay answerable while a 10 s render is in flight, and a single
 * worker runs one job to completion before reading the next message. The sweep
 * itself is milliseconds — a focus solve and a bisection per point, no transform
 * anywhere — so what this buys is independence, not parallelism.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<{ seq: number; request: WallRequest }>) => void) | null;
  postMessage: (message: { seq: number; result: readonly WallPoint[] }) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: skyWallSweep(request) });
};
