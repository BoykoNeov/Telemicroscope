import os from "node:os";
import { afterEach } from "vitest";

/**
 * Runs inside each forked worker, and drops that worker to below-normal OS
 * priority. Vitest forks one worker per core minus one — fifteen on this
 * machine — and a physics render saturates every one of them, so a full run
 * otherwise takes the machine away from whatever else is on it.
 *
 * The obvious place for this is `vitest.config.ts`, since a child inherits its
 * parent's priority on both Windows and POSIX and one call there would cover
 * all fifteen. It is here instead because that call also nices the process
 * doing the coordinating, which is the one process in the run that must stay
 * responsive: the workers report progress to it over RPC with its own short
 * timeout, and starving it turns a healthy run into `Timeout calling
 * "onTaskUpdate"`. It does no arithmetic worth nicing anyway. So the reduction
 * is applied per worker, where the CPU actually is.
 *
 * That is one way to produce that error and it is not the one this suite hit —
 * see the hook below, where the coordinator is measured to be responsive and
 * the stall is worker-side. Priority is worth ruling out, not assuming.
 *
 * Below-normal, not idle: an idle-class process runs only when nothing else
 * wants the CPU at all, which against the timeout in `vitest.config.ts` is a
 * way of manufacturing failures rather than avoiding them. Below-normal yields
 * only to work that is actually asking for the core.
 *
 * Unguarded on purpose — a throw here should fail the run. A caught error would
 * leave a suite believed to be niced and silently not, with nothing observable
 * from outside to contradict the belief. `TELEMICROSCOPE_TEST_PRIORITY=normal`
 * is the way out, and re-running a time-based failure that way is how to tell a
 * real regression from a loaded machine.
 *
 * Setup files run once per test file against a reused worker, so this repeats;
 * setting a priority a process already has is a no-op.
 */
if (process.env.TELEMICROSCOPE_TEST_PRIORITY !== "normal") {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
}

/**
 * Gives the worker's event loop one turn between tests.
 *
 * A worker reports progress with a FIRE-AND-FORGET `onTaskUpdate` RPC —
 * `sendTasksUpdate` in `@vitest/runner` keeps the promise on a list and only
 * awaits it once the file is done — and that call arms a 60 s timer which
 * vitest hardcodes (`DEFAULT_TIMEOUT` in its bundled birpc; `getRpcOptions`
 * passes serialize/deserialize/post/on and no timeout, so no config reaches
 * it). Physics tests are long synchronous stretches, and awaiting an
 * already-resolved promise stays in the MICROTASK queue, so a whole file of
 * them runs without the loop ever reaching its poll phase: the coordinator's
 * reply is sent promptly — its loop delay was measured to peak at 267 ms — and
 * then sits unread. When the loop finally turns, Node runs the timers phase
 * BEFORE poll, so the expired timer throws over an answer that had been waiting
 * for it. Measured: the four files running longer than 60 s stalled their
 * worker for exactly their own duration (86.8, 75.4, 71.2, 69.4 s).
 *
 * `setImmediate` rather than `setTimeout`, because the check phase is reached
 * only THROUGH poll — the yield and the message-read are the same event. What
 * it buys is a bound of one test instead of one file: the longest single test
 * is ~14 s against the 60 s budget in `vitest.config.ts`, and a test that did
 * approach 60 s would be busting that budget anyway, which is a finding rather
 * than a false alarm. It is also why the answer is not "split the slow files":
 * the quantity crossing the line is the SUM over a file, so splitting moves the
 * threshold without removing it.
 *
 * Unconditional rather than gated behind an elapsed-time check, because the
 * cost measured smaller than the complexity of managing it: paired runs put the
 * overhead at 0.55% (830.4 s of test time against 825.9 s), and the number of
 * progress RPCs is unchanged (629 against 634) because `sendTasksUpdate` is
 * throttled — the extra hook completions do not each buy their own timer.
 *
 * What this is NOT is a guarantee, and the honest claim is distributional. The
 * failure was never deterministic: the same tree produced 4, 4, 5, 4 and 5
 * errors on five runs. With this hook 10 of 11 runs were clean; without it 0 of
 * 5. The one exception still failed, with 9 errors and three times the usual
 * test time, has not recurred, and is unexplained — the machine's virus scanner
 * is the suspect, not the hook. Two things are therefore still open: that run,
 * and a measurement against deliberate competing CPU load, which is the case
 * that matters most for workers that are niced on purpose.
 */
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
