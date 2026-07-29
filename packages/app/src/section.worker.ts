import { renderSection, type SectionDone, type SectionJob } from "./section";

/**
 * The polychromatic render, moved off the main thread.
 *
 * One reply per job, like the brightfield worker — `renderSection` runs its
 * wavelengths to completion before the stack can be collapsed into colour, so
 * there is no partial image to post. (A per-λ progressive reply would need a
 * *different* stack each time: the common grid is the bluest plane's, so the
 * ruler moves as planes arrive and every earlier frame would have to be
 * resampled again. That is a real design, and it is not this one.)
 *
 * 149 ms at 3 λ and 2.5 s at ps 64 — the range is why this runs in a worker at
 * all, since the second of those would drop frames on the main thread.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SectionJob>) => void) | null;
  postMessage: (message: SectionDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderSection(request) });
};
