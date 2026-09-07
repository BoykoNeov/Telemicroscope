/**
 * Hand a worker's reply over instead of copying it.
 *
 * `postMessage` without a transfer list structured-clones the message, and the
 * messages in this app are pictures: a 256²×4 RGBA frame is 262 kB, and the
 * two results that also carry their `ColorImage` carry a 256²×3 `Float64Array`
 * — 1.57 MB — beside it. The refining renders (`render.field`, `sky`) post one
 * of those per level. Listing the buffers as transferable moves them rather
 * than copying them: the worker's view is detached and the main thread owns the
 * same memory.
 *
 * **Why a walk rather than a literal list at each call site.** The results are
 * not one shape. Some are `{ ok: true, readout } | Refused` unions, where the
 * buffer only exists on one arm; `CameraResult` has three buffers and one of
 * them is optional; `PhaseResult` carries an array of frames with one buffer
 * each; `RenderResult` and `ReflectorResult` nest a `ColorImage`. A hand-written
 * list per worker would need a type guard per arm — and the first draft of this
 * step, written that way, missed `image.xyz`, which is the largest buffer in the
 * app by six times.
 *
 * **What the walk assumes.** That the message is structured-cloneable, which it
 * already had to be, and that its buffers sit in plain objects and arrays —
 * which is every result in `src/`. Anything a clone would reject (a function, a
 * class with methods) cannot be in a message to begin with. The gap in the other
 * direction is a `Map` or a `Set`: both clone, and `Object.values` does not
 * enter either, so a buffer held in one would be missed. Nothing posts one
 * today, and the failure would be a silent copy rather than a crash — which is
 * exactly why it is written down here.
 *
 * **What it must not be used for.** A buffer the worker keeps across jobs — a
 * module-level scratch array, a memoized frame. Transferring one detaches it and
 * the next job writes into nothing. No adapter in `src/` has one (the two caches
 * that exist, `stage.ts`'s `SYSTEMS` and `GEOMETRIES`, hold no typed array that
 * reaches a result), and no worker reads its result after posting it. A worker
 * that grows either habit must stop using this.
 *
 * **Why the results declare `Uint8ClampedArray<ArrayBuffer>` rather than the
 * bare name.** Since TypeScript 5.7 a typed array is generic over its buffer,
 * and the bare `Uint8ClampedArray` means `Uint8ClampedArray<ArrayBufferLike>` —
 * which admits a `SharedArrayBuffer`, which `ImageData` refuses. A panel holding
 * one of those had to copy it into a fresh array before it could paint it, and
 * four of them carried a comment saying exactly that.
 *
 * The copy was buying a type, not a buffer. Every RGBA array in this app is
 * allocated by a `new Uint8ClampedArray(...)` in the worker and then transferred
 * — transfer detaches the worker's view and hands the same plain `ArrayBuffer`
 * to the main thread — and nothing here allocates a `SharedArrayBuffer` at all
 * (the walk below names the shared kind only in order to skip it). So the narrow
 * type is the true one, and saying it at the declaration is what lets the paint
 * sites drop the copy. UI-PLAN's step 9.
 */

/** Anything that owns a `postMessage` willing to take a transfer list. */
export interface TransferringContext<Message> {
  readonly postMessage: (message: Message, transfer?: Transferable[]) => void;
}

/**
 * Every distinct `ArrayBuffer` reachable from `message`.
 *
 * Distinct is load-bearing: `postMessage` throws `DataCloneError` on a list
 * naming one buffer twice, and two views over one buffer is a shape this walk
 * has to survive even though no result currently has it.
 */
export function transferables(message: unknown): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const seen = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (ArrayBuffer.isView(value)) {
      // `.buffer` is `ArrayBufferLike`: a `SharedArrayBuffer` is not
      // transferable (it is already shared), so name only the plain kind.
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
      return;
    }
    if (value instanceof ArrayBuffer) {
      buffers.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };

  visit(message);
  return [...buffers];
}

/**
 * Post a worker's reply, handing over every buffer inside it.
 *
 * The transfer list is derived from the message that is being sent, in one
 * expression, so the two cannot drift apart — a list built from the wrong object
 * is silently ignored by the browser rather than reported, which is exactly the
 * bug a separate `transferables(...)` argument at 15 call sites would invite.
 */
export function postTransferring<Message>(
  ctx: TransferringContext<Message>,
  message: Message,
): void {
  ctx.postMessage(message, transferables(message));
}
