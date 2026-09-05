import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postTransferring, transferables } from "../src/transfer";

/**
 * The transfer list a worker hands to `postMessage`, and the shapes it has to
 * survive.
 *
 * `transfer.ts` exists because the results are not one shape — unions with the
 * buffer on one arm, an optional third image, an array of frames with one image
 * each, a nested `ColorImage` — and a hand-written list per worker would need a
 * guard per arm. This file pins the walk against the shapes the app actually
 * posts, written out here rather than imported so that a change to a result type
 * shows up as a failing expectation and not as a silently smaller list.
 *
 * **What this file cannot check, and nothing under vitest can.** Whether the
 * browser honoured the list. A transfer list naming the wrong buffer is ignored
 * without error — the message still arrives, by copy — so "the panel paints" is
 * true either way. The only proof is worker-side, after the post: a transferred
 * view has `byteLength === 0`. That check belongs in a browser and is recorded
 * in the step's notes, not here. What IS checkable here is the list itself, and
 * that is the half where the shape bugs live.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

describe("transferables", () => {
  it("finds the buffer on the arm the union actually took", () => {
    const readout = { ok: true as const, readout: { rgba: new Uint8ClampedArray(16), size: 2 } };
    expect(transferables({ seq: 1, result: readout })).toEqual([readout.readout.rgba.buffer]);

    const refused = { ok: false as const, error: "no honest image", source: "engine" as const };
    expect(transferables({ seq: 1, result: refused })).toEqual([]);
  });

  it("finds a nested ColorImage's xyz — the largest buffer in the app", () => {
    // `RenderResult` and `ReflectorResult` carry both: the 256²×4 bytes the
    // panel paints, and the 256²×3 doubles it was encoded from, which is six
    // times larger. A list written by hand from the panel's point of view sees
    // only the first.
    const rgba = new Uint8ClampedArray(4);
    const image = { width: 1, height: 1, pixelScaleMm: 1, xyz: new Float64Array(3) };
    const list = transferables({ seq: 7, result: { rgba, size: 1, image, elapsedMs: 3 } });
    expect(new Set(list)).toEqual(new Set([rgba.buffer, image.xyz.buffer]));
  });

  it("takes the optional buffer only when it is there", () => {
    const withoutObserved = { nativeRgba: new Uint8ClampedArray(4), sensorRgba: new Uint8ClampedArray(4) };
    expect(transferables({ seq: 2, result: withoutObserved })).toHaveLength(2);

    const withObserved = { ...withoutObserved, observedRgba: new Uint8ClampedArray(4) };
    expect(transferables({ seq: 2, result: withObserved })).toHaveLength(3);
  });

  it("walks an array of frames", () => {
    // `PhaseResult` posts one image per defocus step; the count is a control.
    const frames = [0, 1, 2].map((defocusWaves) => ({
      defocusWaves,
      rgba: new Uint8ClampedArray(4),
    }));
    expect(transferables({ seq: 3, result: { ok: true, frames } })).toHaveLength(3);
  });

  it("names a buffer once however many views reach it", () => {
    // `postMessage` throws DataCloneError on a repeated entry, so the dedup is
    // not tidiness. No result aliases two views onto one buffer today; this
    // pins that a result which did would still post.
    const shared = new ArrayBuffer(32);
    const message = { a: new Float64Array(shared, 0, 2), b: new Float64Array(shared, 16, 2) };
    expect(transferables(message)).toEqual([shared]);
  });

  it("survives the values a result is allowed to hold", () => {
    // `optimize.worker.ts` posts `result: null`; refusals carry strings; the
    // sweeps carry arrays of plain objects and `null`s where a reading has no
    // answer. None of these is a buffer and none of them may throw.
    expect(transferables({ seq: 4, result: null })).toEqual([]);
    expect(transferables(null)).toEqual([]);
    expect(transferables(undefined)).toEqual([]);
    expect(transferables({ sweep: [{ x: 1, y: null }, { x: 2, y: 0.5 }], note: "" })).toEqual([]);
  });

  it("does not loop on a message that points at itself", () => {
    const message: Record<string, unknown> = { rgba: new Uint8ClampedArray(4) };
    message["self"] = message;
    expect(transferables(message)).toHaveLength(1);
  });
});

/**
 * The list reaches `postMessage`, and not only the function that builds it.
 *
 * This is the check that stops the step being undone by accident. `transfer?:
 * Transferable[]` is OPTIONAL in every worker's narrowed `postMessage`, so
 * dropping the second argument — collapsing the helper back to a one-liner,
 * "simplifying" a call site — compiles, passes every expectation above, and
 * paints every panel. The only symptom is that the copy comes back, and nothing
 * in a test runner can see that: the proof is a detached buffer inside a real
 * browser's worker. So pin the seam here instead, where a stub can watch it.
 */
describe("postTransferring", () => {
  it("hands the list to postMessage, not just to itself", () => {
    const rgba = new Uint8ClampedArray(16);
    const calls: unknown[][] = [];
    postTransferring(
      { postMessage: (message, transfer) => calls.push([message, transfer]) },
      { seq: 1, result: { rgba } },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual([rgba.buffer]);
  });

  it("still posts a message with nothing to hand over", () => {
    const calls: unknown[][] = [];
    postTransferring(
      { postMessage: (message, transfer) => calls.push([message, transfer]) },
      { seq: 2, result: { ok: false, error: "refused" } },
    );
    expect(calls[0]![1]).toEqual([]);
  });
});

/**
 * The workers that hand their buffers over do it consistently.
 *
 * Not every worker needs this — a sweep that answers with numbers has nothing to
 * transfer, and adding the helper there would read as coverage while quietly
 * licensing the walk over results the step never looked at. What must hold is
 * that a worker which HAS adopted it did so completely: the narrowed
 * `postMessage` accepts the second argument, and no post slipped through the
 * plain path beside it. A half-converted worker is the failure that costs
 * nothing at runtime and shows up as a copy nobody notices.
 */
describe("the workers that transfer", () => {
  const workers = readdirSync(SRC)
    .filter((name) => name.endsWith(".worker.ts"))
    .map((name) => ({ name, source: readFileSync(join(SRC, name), "utf8") }));

  it("finds the workers", () => {
    expect(workers.length).toBeGreaterThan(30);
  });

  for (const { name, source } of workers) {
    if (!source.includes("postTransferring")) continue;

    it(`${name} declares the transfer list and posts through it`, () => {
      expect(source).toContain("transfer?: Transferable[]");
      expect(source).not.toContain("ctx.postMessage(");
    });
  }
});
