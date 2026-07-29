import { runTolerance, type ToleranceDone, type ToleranceJob } from "./tolerance";

/**
 * Part B's whole job: the budget, the rss-against-combined sweep, both Strehls
 * and both star frames.
 *
 * ~480 ms in node and about 1.1 s in the browser at the panel's defaults, which
 * is past § 2's ~800 ms live line — so this is a **backpressured compute-once**
 * surface in A5's and A6's sense, not a drag surface. The panel prints its own
 * elapsed time and dims while it catches up.
 *
 * It carries the pictures as well as the numbers deliberately: the σ table
 * describes the perturbed frame beside it, so two jobs could transiently show
 * one lens's star under another's budget. A3's argument, with three things bound
 * rather than two.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ToleranceJob>) => void) | null;
  postMessage: (message: ToleranceDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: runTolerance(request) });
};
