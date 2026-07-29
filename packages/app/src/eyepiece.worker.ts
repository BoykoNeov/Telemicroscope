import { sweepFocalLengths, type SweepDone, type SweepJob } from "./eyepiece";

/**
 * D6's focal-length sweep — exit pupil, magnification and eye relief across the
 * eyepiece the instrument is looked through with.
 *
 * ~160 ms on the DIN 4×/0.10 and ~220 ms on the 100×/1.40 oil at 21 points, and
 * essentially all of it is 21 **eyepiece solves**: a Plössl is found by secant
 * on its doublet's focal length (~7.5 ms), where § 6q's composition itself is
 * ~30 µs. That is why the panel's own readout runs on the main thread and this
 * does not — the split here is builds against traces, not physics against wiring.
 *
 * Keyed on the optics ALONE. The eye pupil is deliberately not a parameter: the
 * two-stop crossover is min(exit pupil, iris), so the panel computes it live
 * from these points and the iris slider costs nothing.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SweepJob>) => void) | null;
  postMessage: (message: SweepDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: sweepFocalLengths(request) });
};
