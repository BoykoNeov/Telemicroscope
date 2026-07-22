import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The port deliberately does not appear here: `dev-server.mjs` gets it from the
// port guard and passes it in, so there is no hard-coded default to drift from.
export default defineConfig({ plugins: [react()] });
