/**
 * Ownership tests for port-guard. Kept out of `npm test` on purpose: the
 * physics suite is hermetic, while this one spawns processes and binds real
 * ports. Run it with `npm run test:ports` after touching port-guard.mjs.
 *
 * The property under test is the dangerous one: a process we cannot prove is
 * ours must survive.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquirePort,
  listenerPid,
  classify,
  writeMarker,
  releaseMarker,
  isAlive,
  CANONICAL_PORT,
} from "./port-guard.mjs";

const failures = [];
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  -> ${extra}` : ""}`);
  if (!ok) failures.push(name);
}
const quiet = () => {};

// A listener OUTSIDE the project tree: its command line mentions nothing of
// this project, which is precisely the foreign case we must not kill.
const dir = mkdtempSync(join(tmpdir(), "port-guard-"));
const script = join(dir, "listen.mjs");
writeFileSync(
  script,
  `import { createServer } from "node:http";\n` +
    `createServer((_, r) => r.end()).listen(Number(process.argv[2]));\n`,
);

releaseMarker();
const probe = spawn(process.execPath, [script, String(CANONICAL_PORT)], { stdio: "ignore" });
await sleep(1200);

const pid = listenerPid(CANONICAL_PORT);
check("a listener on the canonical port is detected", pid !== null, `pid=${pid}`);

// Foreign: no marker vouches for it.
check("an unmarked listener is classified foreign", classify(CANONICAL_PORT, pid) === "foreign");
const stepped = acquirePort({ log: quiet });
check("the foreign holder is left running", isAlive(pid));
check("acquirePort steps past it", stepped === CANONICAL_PORT + 1, `got ${stepped}`);

// Ours: the same process, now vouched for by a marker this project wrote.
writeMarker(CANONICAL_PORT, pid);
check("a marked listener is classified ours", classify(CANONICAL_PORT, pid) === "ours-marker");
const reclaimed = acquirePort({ log: quiet });
check("our own stale server is killed", !isAlive(pid));
check("the canonical port is reclaimed", reclaimed === CANONICAL_PORT, `got ${reclaimed}`);

// PID reuse: a marker must agree on the port too, not just the PID.
writeMarker(9999, process.pid);
check(
  "a marker recorded for another port does not vouch",
  classify(CANONICAL_PORT + 3, process.pid) !== "ours-marker",
);

releaseMarker();
try {
  probe.kill();
} catch {
  /* already reclaimed */
}

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nall passed");
process.exit(failures.length ? 1 : 0);
