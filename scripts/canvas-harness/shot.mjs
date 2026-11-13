/**
 * Screenshot routes of the running app in a headless Chrome of our own.
 * Usage: node shot.mjs <tag> <light|dark> <width> <route> [route...]
 * A route may carry "@full" to capture the whole page rather than the viewport.
 * Writes <CANVAS_HARNESS_DIR>/shots/<tag>-<route>.png and prints, per route,
 * the page's state (canvases, sideways overflow, height, text length) and any
 * console error or uncaught exception.
 *
 * This is the "look at it" check of UI-PLAN steps 11–15. Start the app first
 * (`node packages/app/dev-server.mjs`, or `preview.mjs` for a build) and pass
 * its port as CANVAS_PORT if the guard stepped off 5187. The Chrome it starts
 * is its own — own profile, own debugging port — and it closes that one and
 * nothing else. Example, every guided-path page in the dark theme:
 *
 *   node scripts/canvas-harness/shot.mjs before dark 1400 home scope@full brightfield@full
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
const DIR = process.env.CANVAS_HARNESS_DIR || "W:/temp/claude/telemicroscope-canvas";
const OUT = `${DIR}/shots`;
const BASE = `http://localhost:${process.env.CANVAS_PORT || "5187"}/`;
const [TAG, SCHEME, WIDTH, ...ROUTES] = process.argv.slice(2);
const W = Number(WIDTH);
const H = Number(process.env.SHOT_H || 900);
const SETTLE_MS = Number(process.env.SETTLE_MS || 90000);
const PROFILE = `${DIR}/chrome-profile-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);

mkdirSync(OUT, { recursive: true });
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
    `--window-size=${W},${H}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
console.log("chrome pid", chrome.pid);

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) for (const h of this.handlers) h(m);
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

let ok = true;
try {
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error("chrome never answered its port");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const page = await open(t.webSocketDebuggerUrl);
  let problems = [];
  page.handlers.push((m) => {
    if (m.method === "Runtime.exceptionThrown")
      problems.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
      problems.push(m.params.type.toUpperCase() + " " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
      problems.push("LOG " + m.params.entry.text.slice(0, 300) + " " + (m.params.entry.url ?? ""));
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: SCHEME }] });
  const ev = async (e) => {
    const { result, exceptionDetails } = await page.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  };
  const STATE = `(() => ({
    shell: !!document.querySelector(".shell-nav"),
    loading: !!document.querySelector(".panel-loading"),
    error: document.querySelector(".panel-error")?.innerText ?? null,
    busy: /(refining \\d|tracing…|solving…|computing…)/.test(document.body.innerText),
    canvases: document.querySelectorAll("canvas").length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
    text: document.body.innerText.length,
  }))()`;
  for (const spec of ROUTES) {
    const full = spec.endsWith("@full");
    const route = full ? spec.slice(0, -5) : spec;
    problems = [];
    await page.send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await page.send("Page.navigate", { url: `${BASE}#/${route}` });
    const deadline = Date.now() + SETTLE_MS;
    let s = null;
    let prevText = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      await sleep(700);
      s = await ev(STATE).catch(() => null);
      if (!s || !s.shell || s.loading || s.busy) { stable = 0; continue; }
      stable = s.text === prevText ? stable + 1 : 0;
      prevText = s.text;
      if (stable >= 3) break;
    }
    const clipH = full ? Math.min(s?.height ?? H, 12000) : H;
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: full,
      clip: { x: 0, y: 0, width: W, height: clipH, scale: 1 },
    });
    const name = `${OUT}/${TAG}-${route.replace(/[^a-z0-9]+/gi, "_")}.png`;
    writeFileSync(name, Buffer.from(shot.data, "base64"));
    console.log(`#/${route} -> ${name}  state=${JSON.stringify(s)}`);
    for (const p of [...new Set(problems)]) console.log("   ! " + p);
  }
} catch (e) {
  ok = false;
  console.log("FAILED", String(e));
} finally {
  try {
    const b = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
    const bws = await open(b.webSocketDebuggerUrl);
    await bws.send("Browser.close").catch(() => {});
  } catch {}
  await sleep(1500);
  if (chrome.exitCode === null) {
    console.log("Browser.close did not end pid", chrome.pid, "- killing that pid");
    chrome.kill();
  }
  process.exit(ok ? 0 : 1);
}
