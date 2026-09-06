import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The port deliberately does not appear here: `dev-server.mjs` gets it from the
// port guard and passes it in, so there is no hard-coded default to drift from.
//
// `worker: { format: "es" }` is deliberately NOT set, and the reasoning is
// measured rather than assumed — see `docs/UI-PLAN.md` § 4. Vite bundles each
// `new Worker(new URL(...))` entry in its own Rollup pass, so there is no chunk
// graph spanning the thirty-two workers for a shared engine copy to live in.
// Switching the format buys the 17 bytes of IIFE wrapper per worker and nothing
// else. Do not re-add it expecting `dist/` to shrink.
export default defineConfig({ plugins: [react()] });
