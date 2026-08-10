import { measureCeiling, type CeilingDone, type CeilingJob } from "./visual";

/**
 * C5's apparent-field ceiling — the widest glass the eyepiece form admits, and
 * the sky it buys.
 *
 * D6's `eyepiece.wall.worker` measures the same refusal as a *length*; this asks
 * what the length is worth in apparent field, which needs one afocal
 * composition and a field bisection on top of the ~14 eyepiece builds. Same
 * reason for the worker as D6's: a Plössl is a secant solve per build, so the
 * bisection is ~150 ms and belongs off the slider's thread.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CeilingJob>) => void) | null;
  postMessage: (message: CeilingDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: measureCeiling(request) });
};
