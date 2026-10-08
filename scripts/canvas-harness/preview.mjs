/**
 * Serve a step-9 production build on the guarded port. Step 8's preview, with
 * the dist directory taken from `STEP9_DIST` so the before-build and the
 * after-build can be served by two separate runs rather than by one server
 * reading a directory that changed underneath it.
 */
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { acquirePort, writeMarker, releaseMarker } from "../port-guard.mjs";

const APP = fileURLToPath(new URL("../../packages/app/", import.meta.url));
const OUT = process.env.CANVAS_HARNESS_DIR || "W:/temp/claude/telemicroscope-canvas";

const port = acquirePort();
writeMarker(port);
const server = await preview({
  root: APP,
  configFile: `${APP}vite.config.ts`,
  build: { outDir: process.env.STEP9_DIST || `${OUT}/dist-after` },
  preview: { port, strictPort: true },
});
server.printUrls();
const shutdown = () => { releaseMarker(); server.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", releaseMarker);
