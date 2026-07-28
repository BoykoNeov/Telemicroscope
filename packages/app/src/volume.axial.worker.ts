import { axialResponse, type AxialDone, type AxialJob } from "./volume";

/**
 * The axial response and the missing cone, in their own worker.
 *
 * A4's split, for A4's reason and one more. The picture re-renders on every
 * focus, bead and thickness change while these two curves do not move at all —
 * they depend on the objective alone — so separate workers let a focus drag stay
 * responsive while 161 kernels (129 for the response sweep, 32 for the cone
 * stack) are still building. Measured at 518–545 ms under `vite-node` and ~1.2 s
 * in the browser, which is well past the deferral a `setTimeout` would buy.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<AxialJob>) => void) | null;
  postMessage: (message: AxialDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: axialResponse(request) });
};
