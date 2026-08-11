import { renderSky, type SkyFrame, type SkyJob } from "./sky";

/**
 * The sky render, moved off the main thread.
 *
 * Multi-frame, like the star field's: `renderField` refines coarse-to-fine and
 * each level is posted as it lands, stamped with the job's `seq` and a `done`
 * flag on the finest. At the achromat's ~10 s the first level arrives in ~0.7 s,
 * which is the whole reason this shape is worth its extra hook.
 *
 * A refusal is posted as a `done` frame rather than thrown: the caller has to
 * release its queue either way, and a wall a reader walked into is a result the
 * panel prints, not an error the worker dies of.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so `self` is typed as a
 * Window; narrow it to the two members this worker touches rather than pull in
 * the WebWorker lib, whose globals collide with DOM.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<SkyJob>) => void) | null;
  postMessage: (message: SkyFrame) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  const out = renderSky(request, (result, done) => {
    // The finest level is posted below with the refusal path, so that a frame
    // and a refusal leave here through exactly one statement.
    if (!done) ctx.postMessage({ seq, result, done: false });
  });
  ctx.postMessage({ seq, result: out, done: true });
};
