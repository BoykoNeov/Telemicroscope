# Telemicroscope

A physics-based optical simulator with two branches — **telescope** and
**microscope** — running on one shared engine. Build an optical system from
real components (lenses, mirrors, glasses, eyepieces, objectives), and see the
image it actually produces: diffraction, aberrations, chromatic fringing,
seeing, noise — all emerging from the physics, not painted on.

The hero output is the **simulated image**. Engineering plots (spot diagrams,
ray fans, MTF, Zernike terms) are the teaching layer that explains *why* the
image looks the way it does.

## Status

Steps 1–7 of the build order are closed; step 8, the **light budget**, is
open and has its first rung. `docs/OPEN-PROBLEMS.md` is the register of what
is still open and the suggested order for it.

Steps 1–4 are complete and validated: geometry and materials, exact + paraxial
tracing, pupils and OPD, the wave layer (PSF/MTF, Zernike, polychromatic
stacking), and the rendered hero image.

Step 5's **optics** have landed — Newtonian, Cassegrain, Ritchey-Chrétien,
Schmidt, Schmidt-Cassegrain and SCT presets, achromat and ED refractors,
computed eyepieces, spider diffraction, atmospheric seeing, visual and camera
modes, and tolerancing. Its mechanical layer has since closed (§ 5u), and so has
the **bench editor** — the prescription schema on a form, with the paraxial and
exact tracers reported side by side (APP.md Part E). What is still open here is
the scenes (star/planet/lunar): their engine step landed as § 5v, and what
remains is a panel and the content itself.

Both microscope architectures trace and image: infinity-corrected (§ 6a) and
the classic 160 mm DIN (§ 6b), with the `160/0.17` coverslip (§ 6c), oil
immersion (§ 6e), brightfield under a real condenser (§ 6f), fluorescence in
three dimensions and in colour (§ 6i–§ 6l, § 6ba–§ 6bb), an eyepiece on the
intermediate image (§ 6q), telecentric objectives (§ 6u–§ 6x) and a pannable,
colour mosaic stage (§ 6m–§ 6t, § 6bh–§ 6bj). Step 7's teaching layer, the
collimation scenarios and the design mode (solves and damped least squares)
are all on screen. Step 8 opened with the photon zero point and shot noise
(§ 8a); the image formed inside a medium is pinned (§ 2g).

There is a working UI in `packages/app` — deliberately ugly, correct physics.

## Layout

```
docs/ARCHITECTURE.md   engine design, module map, conventions, key decisions
docs/ROADMAP.md        build order, v1 feature cut, v2+
docs/VALIDATION.md     the textbook-physics test ladder — index at the top
docs/OPEN-PROBLEMS.md  what is still open, what would pin it, and in what order
packages/core          pure-TypeScript physics core (no DOM), unit-tested
packages/app           the browser UI (React + render workers), port 5187
scripts/               dev tooling (dev-server port ownership)
start.cmd              launch the dev server via the port guard
```

## Commands

```
npm install        # once
npm test           # run the validation/test suite (vitest)
npm run typecheck  # strict TypeScript check
npm run test:ports # port-guard ownership tests (spawns processes, binds ports)
```

## Dev servers

This project owns port **5187**. `scripts/port-guard.mjs` hands out the port
and will reclaim a stale server *of this project* — but never kills a listener
it cannot positively identify as ours. See CLAUDE.md for the rule.

## Principles

- **Physics emerges, is never faked.** Coma, chromatic aberration, diffraction
  spikes appear because rays and wavefronts say so. Analyses are readouts.
- **Validated against textbooks.** Every engine capability lands with tests
  pinned to known results (Airy radius, Abbe limit, published designs).
- **One data model.** A Newtonian and a 100x oil objective are the same schema:
  an ordered surface prescription plus a scene and a detector.
- **Future-proof for non-sequential tracing** (ghosts, stray light): geometry
  is traversal-agnostic, interactions compute the full reflected/refracted
  split, elements are placed by 3D transforms. See docs/ARCHITECTURE.md.

## License

**Boyko Non-Commercial License v1.0 (BNCL-1.0)** — see [LICENSE](LICENSE) and
[NOTICE](NOTICE). Copyright (c) 2026 Boyko Neov.

The source is public, but this is **not** an open-source license. Use, copying,
modification and redistribution are permitted for non-commercial purposes only,
with attribution retained. Commercial use — including internal use by a
for-profit organization — requires a separate license from the copyright
holder.
