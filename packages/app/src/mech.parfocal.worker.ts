import { mountSweep, type MountDone, type MountJob } from "./mech";

/**
 * C3's mount sweep — the barrel against magnification, and the floor bisected on
 * the refusal.
 *
 * ~2 s: every point is a solved objective, and the floor search is another two
 * dozen of them. Its own worker rather than a share of the optics one because it
 * is keyed on entirely different controls — an aperture in NA and a parfocal
 * standard — and the two must not re-run each other.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<MountJob>) => void) | null;
  postMessage: (message: MountDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: mountSweep(request) });
};
