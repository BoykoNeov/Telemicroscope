import { runScales, type ScaleDone, type ScaleJob } from "./tolerance";

/**
 * What each slider's full scale MEANS, and where the glass runs out.
 *
 * Keyed on the lens, the aperture and which (surface, target) each row names —
 * and **not** on the fractions, which is the whole reason it is a second worker.
 * A drag moves four fractions; re-reading four linear coefficients and
 * re-bisecting the ones that need it costs 130–600 ms, and paying that per frame
 * of a drag would make the sliders unusable to buy nothing, since the scaling
 * does not move when a fraction does.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ScaleJob>) => void) | null;
  postMessage: (message: ScaleDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: runScales(request) });
};
