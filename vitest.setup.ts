import os from "node:os";

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
