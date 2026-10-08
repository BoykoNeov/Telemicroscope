/**
 * Step-9 sweep: fingerprint every canvas a panel paints, one route at a time.
 *
 * The per-panel check is the same one `drive.mjs` made for the stage, generalised
 * so that the twelve panels after it do not each need a bespoke driver. For each
 * route it waits for the panel to mount, then waits for the picture to STOP
 * CHANGING — most of these panels are a worker deep and paint progressively, and
 * two of them refine in levels, so "the page loaded" is not "the picture is
 * finished" and a hash taken at a wall-clock offset differs run to run with no
 * code change at all. Then it reads each canvas back with `getImageData` and
 * hashes it in the page.
 *
 * **A stable hash is not on its own evidence.** A canvas painted from an empty
 * placeholder buffer (`camera.ts`'s `sensorRgba: new Uint8ClampedArray(0)`), or
 * one belonging to a panel that refused the design and drew nothing, is stable
 * and identical before and after while proving nothing about the buffer this
 * step is actually changing. So every canvas also reports whether it is UNIFORM
 * — one colour over its whole surface — and a route whose canvases are all
 * uniform is reported as having no evidence in it, not as a match.
 *
 * Usage: node sweep.mjs <tag> <route> [route...]
 * Writes sweep-<tag>.json beside this script. Compare two tags with cmp.mjs.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9339;
const DIR = process.env.CANVAS_HARNESS_DIR || "W:/temp/claude/telemicroscope-canvas";
// The port preview.mjs printed — the guard's (scripts/port-guard.mjs), 5187 unless it had to step.
const APP_PORT = process.env.CANVAS_PORT || "5187";
const BASE = `http://localhost:${APP_PORT}/`;
const [TAG, ...ROUTES] = process.argv.slice(2);
if (!TAG || ROUTES.length === 0) {
  console.log("usage: node sweep.mjs <tag> <route> [route...]");
  process.exit(2);
}
const PROFILE = `${DIR}/chrome-profile-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);

mkdirSync(DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1400,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
console.log("chrome pid", chrome.pid);
for (let i = 0; i < 240 && !(await up()); i++) await sleep(500);
if (!(await up())) {
  console.log("chrome never answered its port");
  chrome.kill();
  process.exit(1);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
const open = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(new Cdp(ws)));
    ws.addEventListener("error", reject);
  });

const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) =>
  r.json(),
);
const page = await open(t.webSocketDebuggerUrl);
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const ev = async (e) => {
  const { result, exceptionDetails } = await page.send("Runtime.evaluate", {
    expression: e,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
};

/** Mounted: the shell is up and the lazy chunk has stopped saying "loading". */
const MOUNTED = `(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.innerText.trim() : null; };
  return {
    navLinks: document.querySelectorAll(".shell-nav a").length,
    loading: t(".panel-loading"),
    error: t(".panel-error"),
    // A refining render answers one job with a sequence of ever-finer frames,
    // and a level that takes longer than the stability window to compute looks
    // exactly like a finished picture. The panel says which it is, so ask it.
    busy: /(refining \d|tracing…)/.test(document.body.innerText),
    canvases: document.querySelectorAll("canvas").length,
    // Which chunks the page actually fetched. A panel-only rebuild leaves the
    // entry hash alone, so "the served index is the new one" cannot tell a
    // fresh dist from a stale one here — the panel's own chunk name can.
    chunks: performance.getEntriesByType("resource")
      .map((e) => e.name.split("/").pop())
      .filter((n) => n.endsWith(".js")),
  };
})()`;

/**
 * Every canvas on the page, hashed, with the two facts that say whether the
 * hash is worth anything: its size, and whether it is a single flat colour.
 */
const SHOT = `(() => {
  return [...document.querySelectorAll("canvas")].map((c, i) => {
    if (c.width === 0 || c.height === 0) return { i, w: c.width, h: c.height, hash: "empty", uniform: true };
    const ctx = c.getContext("2d");
    if (!ctx) return { i, w: c.width, h: c.height, hash: "no-2d", uniform: true };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let hash = 0x811c9dc5;
    for (let k = 0; k < d.length; k++) { hash ^= d[k]; hash = Math.imul(hash, 0x01000193) >>> 0; }
    let uniform = true;
    for (let k = 4; k < d.length; k += 4) {
      if (d[k] !== d[0] || d[k+1] !== d[1] || d[k+2] !== d[2] || d[k+3] !== d[3]) { uniform = false; break; }
    }
    return { i, w: c.width, h: c.height, cls: c.className, hash: hash.toString(16), uniform };
  });
})()`;

const same = (a, b) =>
  a.length === b.length && a.every((c, i) => c.hash === b[i].hash && c.w === b[i].w && c.h === b[i].h);

/** Wait for the picture to stop changing, not merely for the page to load. */
const settle = async (route) => {
  const deadline = Date.now() + 300000;
  let mounted = null;
  while (Date.now() < deadline) {
    mounted = await ev(MOUNTED);
    if (mounted.navLinks > 0 && mounted.loading === null && !mounted.busy) break;
    await sleep(500);
  }
  if (!mounted || mounted.navLinks === 0) throw new Error(`${route}: shell never mounted`);
  let prev = await ev(SHOT);
  let stable = 0;
  while (Date.now() < deadline) {
    await sleep(1000);
    const now = await ev(SHOT);
    const still = await ev(MOUNTED);
    stable = same(prev, now) && !still.busy ? stable + 1 : 0;
    prev = now;
    if (stable >= 3) return { mounted: still, canvases: now };
  }
  throw new Error(`${route}: the picture never stopped changing`);
};

const report = { tag: TAG, routes: {} };
try {
  for (const route of ROUTES) {
    // Blank between routes: a worker from the previous panel is still running,
    // and the shell keeps it alive until the route actually changes.
    await page.send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await page.send("Page.navigate", { url: `${BASE}#/${route}` });
    const { mounted, canvases } = await settle(route);
    const painted = canvases.filter((c) => !c.uniform);
    report.routes[route] = {
      error: mounted.error,
      chunks: mounted.chunks,
      canvases,
      paintedCount: painted.length,
      evidence: painted.length > 0,
    };
    console.log(
      `${painted.length > 0 ? "ok      " : "NO-PAINT"} #/${route}  ` +
        canvases.map((c) => `${c.w}x${c.h}:${c.hash}${c.uniform ? "(uniform)" : ""}`).join(" "),
    );
  }
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = String(e);
  console.log("FAILED", String(e));
} finally {
  writeFileSync(`${DIR}/sweep-${TAG}.json`, JSON.stringify(report, null, 2));
  try {
    const b = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
    const bws = await open(b.webSocketDebuggerUrl);
    await bws.send("Browser.close").catch(() => {});
  } catch {}
  await sleep(1500);
  if (chrome.exitCode === null) {
    console.log("Browser.close did not end pid", chrome.pid, "— killing that pid");
    chrome.kill();
  }
  process.exit(report.ok ? 0 : 1);
}
