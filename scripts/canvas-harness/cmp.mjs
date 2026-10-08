/**
 * Compare two sweeps, route by route and canvas by canvas.
 *
 * A route passes only if every canvas matches in size and hash AND at least one
 * of them was actually painted — a uniform canvas is stable and identical
 * whatever the buffer underneath it did, so it is reported as no evidence
 * rather than as a match.
 *
 * Usage: node cmp.mjs <base-tag> <after-tag> [route...]
 */
import { readFileSync } from "node:fs";

const DIR = process.env.CANVAS_HARNESS_DIR || "W:/temp/claude/telemicroscope-canvas";
const [A, B, ...ONLY] = process.argv.slice(2);
const load = (tag) => JSON.parse(readFileSync(`${DIR}/sweep-${tag}.json`, "utf8"));
const a = load(A);
const b = load(B);

const routes = ONLY.length > 0 ? ONLY : Object.keys(b.routes);
let bad = 0;
for (const route of routes) {
  const x = a.routes[route];
  const y = b.routes[route];
  if (!x) { console.log(`MISSING  #/${route} not in ${A}`); bad++; continue; }
  if (!y) { console.log(`MISSING  #/${route} not in ${B}`); bad++; continue; }
  const n = Math.max(x.canvases.length, y.canvases.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    const p = x.canvases[i];
    const q = y.canvases[i];
    if (!p || !q) { diffs.push(`canvas ${i} present in only one sweep`); continue; }
    if (p.w !== q.w || p.h !== q.h) diffs.push(`canvas ${i} size ${p.w}x${p.h} -> ${q.w}x${q.h}`);
    else if (p.hash !== q.hash) diffs.push(`canvas ${i} ${p.hash} -> ${q.hash}`);
  }
  const evidence = y.evidence && x.evidence;
  if (diffs.length > 0) { console.log(`DIFF     #/${route}  ${diffs.join("; ")}`); bad++; }
  else if (!evidence) { console.log(`NO-PAINT #/${route}  every canvas is one flat colour — no evidence`); bad++; }
  else console.log(`ok       #/${route}  ${y.paintedCount} painted canvas(es) identical`);
}
console.log(bad === 0 ? `\nall ${routes.length} route(s) identical` : `\n${bad} route(s) need a look`);
process.exit(bad === 0 ? 0 : 1);
