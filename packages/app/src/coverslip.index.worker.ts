import { indexSweep, type IndexDone, type IndexJob } from "./coverslip";

/**
 * A6's index sweep, in its own worker beside the thickness one.
 *
 * Not folded into it, though the two are keyed identically: they are ~3 s each
 * and independent, so two workers finish in the time one would take to run the
 * first. The § 6l precedent is the same shape for the opposite reason — there a
 * third worker existed because the sweeps had DIFFERENT keys; here it exists
 * because they have the same key and no dependency.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<IndexJob>) => void) | null;
  postMessage: (message: IndexDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: indexSweep(request) });
};
