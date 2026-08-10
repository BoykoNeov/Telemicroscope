import { renderRetina, type RetinaDone, type RetinaJob } from "./visual";

/**
 * C5's retinal image — the trace and the focus solve.
 *
 * Two costs, and the second is the one this doc's model keeps under-counting.
 * The PSF through a ten-surface (objective + eyepiece + eye) chain is 150–470 ms
 * of trace, Zernike fit and transform; `bestFocus` beside it is another
 * 100–230 ms, because C4's lesson holds here too — a focus solve is a solve, and
 * this one runs on the same composed system rather than on the objective alone.
 * Together they are past anything a slider may block on, and the two travel
 * together because the accommodation readout is meaningless without the frame it
 * is measured against.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RetinaJob>) => void) | null;
  postMessage: (message: RetinaDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderRetina(request) });
};
