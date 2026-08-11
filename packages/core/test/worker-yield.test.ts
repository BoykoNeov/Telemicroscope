import { describe, it, expect } from "vitest";

/**
 * The second rung that pins the HARNESS rather than the physics, and the only
 * one whose subject is the event loop.
 *
 * The suite used to end on four or five `[vitest-worker]: Timeout calling
 * "onTaskUpdate"` errors and a non-zero exit while every assertion passed,
 * which made this repo's own "every commit must pass `npm test`" rule
 * unmeetable. The count varied run to run; the cause does not, and it is
 * neither load nor physics:
 *
 *  - A worker reports progress by calling `onTaskUpdate` over RPC. That call is
 *    FIRE-AND-FORGET — `sendTasksUpdate` in `@vitest/runner` pushes the promise
 *    onto a list and only awaits it when the file is finished — and it arms a
 *    60 s timer that vitest hardcodes (`DEFAULT_TIMEOUT = 6e4` in its bundled
 *    birpc; no config option reaches it).
 *  - Our tests are long stretches of synchronous physics, and an `await` on an
 *    already-resolved promise resolves in the MICROTASK queue. A whole file of
 *    such tests therefore runs without the event loop ever reaching its poll
 *    phase, so the main process's reply — which was sent promptly; its measured
 *    loop delay peaks at 267 ms — sits unread in the IPC queue.
 *  - When the loop finally turns, Node runs the timers phase BEFORE poll. The
 *    expired timer fires and throws, though the answer had been waiting for it.
 *
 * Measured: the four files whose total runtime exceeded 60 s stalled their
 * worker for exactly their own duration (86.8 s, 75.4 s, 71.2 s, 69.4 s). No
 * single test is anywhere near 60 s — the longest is ~14 s — so the quantity
 * that crossed the line is the SUM over a file, which is why splitting a file
 * only moves the threshold around.
 *
 * So `vitest.setup.ts` yields one event-loop turn after each test, and this
 * rung is what makes that a fact rather than an intention: without the hook the
 * immediate scheduled below is still pending when the next test reads it, as
 * this file was watched to fail before the hook existed. It pins the mechanism
 * and not the outcome — the outcome is distributional (10 of 11 runs clean
 * against 0 of 5) and the exit code is what measures that. What this rung
 * defends against is the hook being deleted as an unexplained oddity, which
 * would restore a red suite that no assertion accounts for: the failure mode
 * that cost the most to find.
 */

let turnedBetweenTests = false;

describe("the worker's event loop turns between tests", () => {
  it("schedules an immediate and does no other work", () => {
    setImmediate(() => {
      turnedBetweenTests = true;
    });
    // Nothing else: the point is that this test does not itself yield, so the
    // only thing that can run the callback is the harness between the two.
    expect(turnedBetweenTests).toBe(false);
  });

  it("has run it by the time the next test starts", () => {
    expect(turnedBetweenTests).toBe(true);
  });
});
