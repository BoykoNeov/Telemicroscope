# Telemicroscope — project instructions

Physics-based telescope/microscope simulator, web platform, TypeScript
monorepo. Read `docs/ARCHITECTURE.md` before touching the engine — sign
conventions, precision strategy, and the three non-sequential-future
commitments live there and are load-bearing. `docs/ROADMAP.md` has the build
order; `docs/VALIDATION.md` tracks the physics test ladder.

## Hard rules

- `packages/core` stays pure TypeScript with **no DOM dependencies** — it must
  run under Node/vitest.
- Physics is never faked: aberrations/diffraction must emerge from rays and
  wavefronts. Analyses are readouts.
- New engine capability requires new validation-ladder tests pinned to
  external numbers (textbook/closed-form/published design), added in the same
  change and recorded in `docs/VALIDATION.md`.
- Never loosen a test tolerance to make it pass — investigate.
- Precision-critical tracing (OPD) stays on CPU f64; GPU is for f32-safe bulk
  work only.
- Units: mm for geometry, nm for wavelength (µm inside Sellmeier). Light
  starts along +z; thicknesses are signed (negative after mirrors).

## Dev servers — never guess a port, never kill a stranger

This project owns **port 5187** (range 5187–5191). Never start a web/dev
server on 3000, 5173, 8080 or any other popular default: other projects on
this machine use those, and past collisions had projects silently killing each
other's servers and drifting onto unpredictable ports.

Before raising any server, get the port from the guard — do not hand-pick one:

```js
import { acquirePort, writeMarker, releaseMarker } from "./scripts/port-guard.mjs";
const port = acquirePort();      // reclaims OUR stale server if one is holding it
writeMarker(port);               // so the next run can identify this process as ours
```

Or `node scripts/port-guard.mjs` to just print the port.

The rule the guard enforces, and that applies to anything else that touches
ports: **a process is killed only when a marker file this project wrote proves
it is ours.** An unidentified listener is never killed — step to the next port
in our range and say so loudly. Losing a port is cheap; killing another
project's server is not.

## Repo etiquette

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Every commit must typecheck and pass `npm test` on its own — no "fix tests
  in the next commit".
- Commit in stages that match a roadmap step, not one dump per session.

## Commands

- `npm test` — vitest physics suite (must stay green)
- `npm run typecheck` — strict tsc, no emit
- `npm run test:ports` — port-guard ownership tests; spawns processes and binds
  real ports, so it is deliberately outside `npm test`. Run it after touching
  `scripts/port-guard.mjs`.
