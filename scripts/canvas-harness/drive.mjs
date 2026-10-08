/**
 * Step-9 check for `panels/stage.tsx`: the panel paints its cached tiles from
 * the transferred buffer itself, with no copy in between.
 *
 * Two questions, and neither of them is a PNG diff. The canvas is read directly
 * — `getImageData` over the whole surface, hashed in the page — because that is
 * the actual pixel evidence the plan asks for, without a screenshot's clipping,
 * scaling or device-pixel-ratio to argue about, and because the same read also
 * counts how much of the surface is still the "#111" ground a painted tile would
 * have covered: a buffer that `putImageData` had consumed would come back as a
 * blank tile, and the count says so without anyone having to look.
 *
 *   1. **The picture is the same one.** Run this against the build before the
 *      change and the build after it; the settled hash must match.
 *   2. **A cached tile survives being painted twice.** Drag the viewport away
 *      and back to exactly where it started. The tiles that come back are cache
 *      hits repainted from the same arrays — the assumption the copy was hiding.
 *
 * The panel is three workers deep and paints progressively, so every hash is
 * taken only once the readout has stopped counting tiles; a hash taken at a
 * wall-clock offset would differ run to run with no code change at all.
 *
 * Usage: node drive.mjs <tag>   (writes report-<tag>.json and stage-<tag>.png)
 * Chrome is closed through its own debugging port, then by the PID recorded at
 * launch if it survives that — never by name.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9339;
const DIR = process.env.CANVAS_HARNESS_DIR || "W:/temp/claude/telemicroscope-canvas";
// The port preview.mjs printed — the guard's (scripts/port-guard.mjs), 5187 unless it had to step.
const APP_PORT = process.env.CANVAS_PORT || "5187";
const TAG = process.argv[2] || "run";
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

const report = { tag: TAG, steps: [] };
const note = (name, value) => {
  report.steps.push({ name, ...value });
  console.log(name, JSON.stringify(value));
};

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

/** Which entry the server actually served — a sweep of a stale `dist` is a lie. */
const servedEntry = () =>
  ev(`[...document.querySelectorAll("script[src]")].map((s) => s.src).join(",")`);

/** The tile counter has stopped, and the canvas has a size to read. */
const settled = async (label) => {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const s = await ev(`(() => {
      const c = document.querySelector("canvas.raster");
      const r = document.querySelector(".readout");
      const text = r ? r.textContent : "";
      return { has: !!c, w: c ? c.width : 0, counting: /\\d+\\/\\d+ tiles/.test(text), text: text.trim().slice(0, 80) };
    })()`);
    if (s.has && s.w > 0 && !s.counting) {
      await sleep(600);
      return s;
    }
    await sleep(500);
  }
  throw new Error(`stage never settled at ${label}`);
};

/**
 * A fingerprint of every pixel on the canvas, plus how much of it is still the
 * `#111` ground a painted tile would have covered.
 */
const fingerprint = () =>
  ev(`(() => {
  const c = document.querySelector("canvas.raster");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5, ground = 0;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === 17 && d[i + 1] === 17 && d[i + 2] === 17) ground++;
  }
  return { hash: h.toString(16), w: c.width, h: c.height, pixels: d.length / 4, ground };
})()`);

/** Drag the canvas by (dx, dy) client pixels, in the steps a real pointer takes. */
const dragBy = async (dx, dy) => {
  const box = await ev(
    `(() => { const r = document.querySelector("canvas.raster").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const steps = 4;
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
  });
  for (let i = 1; i <= steps; i++) {
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: box.x + (dx * i) / steps, y: box.y + (dy * i) / steps, button: "left", buttons: 1, pointerType: "mouse",
    });
    await sleep(60);
  }
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: box.x + dx, y: box.y + dy, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
  });
  await sleep(300);
};

const shot = async (name) => {
  const clip = await ev(
    `(() => { const r = document.querySelector("canvas.raster").getBoundingClientRect(); return { x: Math.floor(r.x + scrollX), y: Math.floor(r.y + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 }; })()`,
  );
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    clip,
    captureBeyondViewport: true,
  });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(data, "base64"));
};

try {
  await page.send("Page.navigate", { url: `http://localhost:${APP_PORT}/#/stage` });
  note("served", { scripts: await servedEntry() });
  note("settled", await settled("first paint"));

  const first = await fingerprint();
  note("first paint", first);
  await shot(`stage-${TAG}`);

  // Away: new tiles, rendered and cached. Then back to exactly where we were,
  // which is a repaint of tiles this panel has already painted once.
  await dragBy(-120, -80);
  const away = await settled("panned away");
  note("panned away", { ...away, ...(await fingerprint()) });

  await dragBy(120, 80);
  await settled("panned back");
  const back = await fingerprint();
  note("panned back", back);
  await shot(`stage-${TAG}-repaint`);

  report.first = first;
  report.back = back;
  report.repaintIdentical = first.hash === back.hash;
  report.painted = first.ground < first.pixels;
  report.ok = report.repaintIdentical && report.painted;
  if (!report.painted) report.error = "nothing was painted at all";
  else if (!report.repaintIdentical)
    report.error = "the repaint of a cached tile is not the first paint";
} catch (e) {
  report.ok = false;
  report.error = String(e);
  console.log("FAILED", String(e));
} finally {
  writeFileSync(`${DIR}/report-${TAG}.json`, JSON.stringify(report, null, 2));
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
