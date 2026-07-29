import { slipSweep, type SweepDone, type SweepJob } from "./coverslip";

/**
 * A6's thickness sweep — σ, the delivered aperture and the oil's own W₀₄₀
 * across the No. 1.5 band, under both refocus models.
 *
 * ~2 s at NA 1.0 and ~5 s at 1.40, where the ray wall is bisected as well. It is
 * keyed on the aperture and the sampling ALONE: the two sliders beside it move a
 * marker on this curve and a separate one-point readout, and re-running a
 * five-second sweep to move a dashed line would make the panel unusable.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SweepJob>) => void) | null;
  postMessage: (message: SweepDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: slipSweep(request) });
};
