import { runBudget, type BudgetDone, type BudgetJob } from "./budget";

/**
 * Part P's whole job: the sheet at the chosen budget, and the coupling curve
 * beside it.
 *
 * ~0.7 s in node on the triplet at the panel's defaults and ~0.4 s on the
 * doublet, which is past § 2's ~800 ms live line once the browser's slower
 * arithmetic is in it — so this is a **backpressured compute-once** surface in
 * A5's and A6's sense rather than a drag surface. The panel prints its own
 * elapsed time and dims while it catches up.
 *
 * The curve costs almost nothing beside the sheet and that is a property of the
 * split rather than luck: a row's slope is measured once per currency and is
 * scale-free, so every extra point on the curve is one combined trace and one
 * per row, not a whole re-measurement. Seven points cost about what the sheet
 * costs alone, which is why they are in the same job instead of a second worker.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<BudgetJob>) => void) | null;
  postMessage: (message: BudgetDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: runBudget(request) });
};
