import { measureWall, type WallDone, type WallJob } from "./eyepiece";

/**
 * D6's clear-aperture wall — the widest glass the eyepiece form admits at the
 * selected focal length, bisected rather than quoted.
 *
 * § 6q.9 pins the wall as a **bracket**: a computed Plössl builds at 22 mm of
 * clear aperture at f_e = 25 and refuses 24, which is where "about 0.88·f_e"
 * comes from. Asking the constructor where it actually stops is A6's move on
 * § 6e.4's NA ceiling, and it costs ~14 more solves — ~100 ms for a Plössl,
 * ~2 ms for a Huygens — so it is its own worker keyed on the focal-length
 * slider, and never blocks the readout beside it.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WallJob>) => void) | null;
  postMessage: (message: WallDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: measureWall(request) });
};
