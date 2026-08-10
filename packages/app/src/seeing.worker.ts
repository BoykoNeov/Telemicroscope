import { renderSeeing, type SeeingDone, type SeeingJob } from "./seeing";

/**
 * C6's long exposure — the heaviest single job in the app, and the only one that
 * is heavy for a reason that is not resolution.
 *
 * ~50–60 ms per screen, so 120 screens is ~7 s in node and roughly twice that in
 * a browser. Almost none of that is the transform: generating one 256²
 * Kolmogorov screen with six subharmonic levels costs more than transforming the
 * pupil it lands on, which is why a 4× finer PSF grid is only ~1.2× the bill.
 * The screen count is the whole cost, it is the user's explicit choice, and the
 * panel prints the elapsed time so the choice stays informed.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SeeingJob>) => void) | null;
  postMessage: (message: SeeingDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderSeeing(request) });
};
