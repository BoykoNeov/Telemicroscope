import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createServer } from "vite";
import { acquirePort, writeMarker, releaseMarker } from "../../scripts/port-guard.mjs";

/**
 * Dev server launcher.
 *
 * The port is never hand-picked: `acquirePort` reclaims OUR stale server if one
 * is holding the range and steps to the next port otherwise. A listener this
 * project cannot prove it owns is never killed — losing a port is cheap,
 * killing another project's server is not (CLAUDE.md § Dev servers).
 *
 * Vite is started through its Node API rather than the CLI so the guard runs
 * BEFORE the port is bound, and so the marker is released on the way out.
 */

const here = dirname(fileURLToPath(import.meta.url));
const port = acquirePort();
writeMarker(port);

const server = await createServer({
  root: here,
  configFile: `${here}/vite.config.ts`,
  server: { port, strictPort: true },
});

await server.listen();
server.printUrls();

const shutdown = async () => {
  releaseMarker();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", releaseMarker);
