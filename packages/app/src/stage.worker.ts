import { renderStageTile, type StageTileDone, type StageTileJob } from "./stage";

/**
 * One tile of the stage, off the main thread — and unlike every other worker in
 * this app, **several of these run at once**.
 *
 * A tile is ~350 ms and a viewport holds tens of them, so the panel keeps a pool
 * and hands each free worker the next tile. That is legitimate because a tile
 * depends on its index and nothing else (§ 6o.8), so the tiles may be rendered
 * out of order and the composed plane is the same picture either way — the same
 * property that lets the panel cache them across a pan.
 *
 * Each worker memoizes its own `OpticalSystem` per objective (`stage.ts`), so
 * the prescription is built once per worker rather than once per tile.
 *
 * The app tsconfig ships the DOM lib, not WebWorker, so narrow `self` to the two
 * members this worker touches — `brightfield.worker.ts`'s note.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<StageTileJob>) => void) | null;
  postMessage: (message: StageTileDone) => void;
};

ctx.onmessage = (event) => {
  const { seq, request } = event.data;
  ctx.postMessage({ seq, result: renderStageTile(request) });
};
