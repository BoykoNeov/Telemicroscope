import { renderCamera, type CameraDone, type CameraJob } from "./camera";

/**
 * One star through one sensor, off the main thread.
 *
 * The same change-of-caller every worker in this app is: `renderCamera` is pure,
 * so this file is a mailbox. It answers one job at a time and stamps the reply
 * with the job's `seq` so `useLatestFromWorker` can drop a superseded frame.
 *
 * What does **not** come through here is everything the panel computes beside
 * the picture — the format table, the per-λ critical pitches, both MTF sweeps.
 * None of them runs a transform, so they belong on the main thread where they
 * repaint on the same tick as the slider that changed them. Only the
 * trace-and-transform half is worth a worker. That is `reflector.worker.ts`'s
 * asymmetry, and it falls the same way here.
 *
 * **They are not free, though, and the first version of this comment said they
 * were.** Measured: the whole main-thread block is 50 ms in node — call it
 * 115 ms in a browser at A4's 2.3× — of which 21–28 ms is a single
 * `buildCameraSystem`, because that runs a `bestFocus` solve. "A dozen chief
 * rays" describes `describeFormats` (8 ms) and the sweeps (5.4 and 1.2 ms)
 * accurately and describes the *system construction* not at all. The panel's
 * memo split is what keeps it usable; see `panels/camera.tsx`.
 *
 * `self` is narrowed rather than typed through the WebWorker lib, for the reason
 * `render.worker.ts` gives: the app tsconfig ships DOM, whose globals collide.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<CameraJob>) => void) | null;
  postMessage: (message: CameraDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderCamera(request) });
};
