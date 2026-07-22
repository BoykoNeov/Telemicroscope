#!/usr/bin/env node
/**
 * port-guard — hand out a dev-server port for THIS project, reclaiming only
 * this project's own stale servers.
 *
 * The failure this exists to prevent: several projects default to the same
 * popular port (3000, 5173, 8080), so starting one dev server silently kills
 * another project's, or quietly drifts onto an unpredictable port.
 *
 * Two rules follow from that:
 *
 *  1. **Avoidance beats cleanup.** This project owns one canonical port that
 *     is not a common default. Collisions should be rare by construction.
 *  2. **Never kill what you cannot positively identify as your own.** A
 *     listener is reclaimed only when a marker file *this project wrote*
 *     vouches for it. Anything unidentified is left strictly alone, and we
 *     step to the next port in our own range with a loud warning — silence is
 *     what made the original problem hard to see.
 *
 * Usage:
 *   node scripts/port-guard.mjs            # print the port to use
 *   node scripts/port-guard.mjs --release  # drop our marker (server stopped)
 *
 *   import { acquirePort, writeMarker, releaseMarker } from './port-guard.mjs'
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = join(PROJECT_ROOT, ".dev-server.json");
const PROJECT_ID = "telemicroscope";

/**
 * Canonical port, deliberately away from the crowded defaults (3000, 4200,
 * 5173, 8000, 8080). The extra ports are a fallback for a genuine foreign
 * collision only — landing on one is a warning, not business as usual.
 */
export const CANONICAL_PORT = 5187;
export const PORT_RANGE = [5187, 5188, 5189, 5190, 5191];

const isWindows = process.platform === "win32";

/* ------------------------------------------------------------------ probing */

function sh(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // "no match" is a non-zero exit for both netstat and lsof
  }
}

/** PID listening on `port`, or null. */
export function listenerPid(port) {
  if (isWindows) {
    for (const line of sh("netstat", ["-ano", "-p", "TCP"]).split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
      if (m && Number(m[1]) === port) return Number(m[2]);
    }
    return null;
  }
  const out = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).trim();
  return out ? Number(out.split(/\s+/)[0]) : null;
}

/** Full command line of a process, or "" if it cannot be read. */
export function commandLineOf(pid) {
  if (isWindows) {
    return sh("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]).trim();
  }
  return sh("ps", ["-p", String(pid), "-o", "command="]).trim();
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // alive, just not ours to signal
  }
}

/* ------------------------------------------------------------------- marker */

export function readMarker() {
  if (!existsSync(MARKER)) return null;
  try {
    const m = JSON.parse(readFileSync(MARKER, "utf8"));
    return m && m.project === PROJECT_ID ? m : null;
  } catch {
    return null; // truncated by a hard kill; treat as absent
  }
}

export function writeMarker(port, pid = process.pid) {
  writeFileSync(
    MARKER,
    JSON.stringify({ project: PROJECT_ID, root: PROJECT_ROOT, port, pid }, null, 2) + "\n",
  );
}

export function releaseMarker() {
  if (existsSync(MARKER)) rmSync(MARKER);
}

/* --------------------------------------------------------------- ownership */

/**
 * Can we prove this listener is ours?
 *
 * `marker` is authoritative but not sufficient on its own: after a crash the
 * OS may hand the recorded PID to an unrelated process. So a marker match
 * must agree on PID *and* the port it recorded *and* still look like a Node
 * process. Only when all three line up do we claim it.
 *
 * The command-line fallback catches orphans whose marker was lost. It is
 * weak — `npm run dev` often launches a bundler by relative path, so the
 * project root never appears in the command line — and that is fine: failing
 * to reclaim costs one port, killing a stranger costs someone their work.
 *
 * @returns {"ours-marker"|"ours-cmdline"|"foreign"}
 */
export function classify(port, pid, marker = readMarker()) {
  if (
    marker &&
    marker.pid === pid &&
    marker.port === port &&
    marker.root === PROJECT_ROOT &&
    /node|npm|vite/i.test(commandLineOf(pid))
  ) {
    return "ours-marker";
  }
  const cmd = commandLineOf(pid);
  if (cmd && cmd.toLowerCase().includes(PROJECT_ROOT.toLowerCase())) return "ours-cmdline";
  return "foreign";
}

/* ------------------------------------------------------------------ killing */

function killTree(pid) {
  if (isWindows) {
    sh("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

function waitForRelease(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listenerPid(port) === null) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); // sync sleep
  }
  return false;
}

/* ------------------------------------------------------------------ acquire */

/**
 * A port for this project's dev server, with our own stale instance cleared
 * out of the way. Throws if the whole range is held by foreign processes —
 * better to stop than to scatter onto an arbitrary port.
 */
export function acquirePort({ log = console.warn } = {}) {
  const marker = readMarker();

  for (const port of PORT_RANGE) {
    const pid = listenerPid(port);

    if (pid === null) {
      if (port !== CANONICAL_PORT) {
        log(`[port-guard] canonical port ${CANONICAL_PORT} is taken by another app; using ${port}.`);
      }
      return port;
    }

    const verdict = classify(port, pid, marker);
    if (verdict === "foreign") {
      log(
        `[port-guard] port ${port} is held by pid ${pid}, which is NOT this project — ` +
          `leaving it alone. Trying the next port.`,
      );
      continue;
    }

    log(`[port-guard] reclaiming port ${port} from our own stale server (pid ${pid}, ${verdict}).`);
    killTree(pid);
    if (!waitForRelease(port)) {
      log(`[port-guard] pid ${pid} did not release port ${port} in time; trying the next port.`);
      continue;
    }
    releaseMarker();
    return port;
  }

  throw new Error(
    `[port-guard] every port in ${PORT_RANGE.join(", ")} is held by processes that do not ` +
      `belong to this project. Refusing to kill them — stop one manually, or widen PORT_RANGE.`,
  );
}

/* ---------------------------------------------------------------------- CLI */

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes("--release")) {
    releaseMarker();
  } else {
    process.stdout.write(String(acquirePort()));
  }
}
