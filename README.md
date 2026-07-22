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

Early — step 2 of the build order. Step 1 (geometry, materials, paraxial +
exact sequential tracing) is complete and validated. Currently building the
prerequisites the wave layer needs: the system specification, pupils and ray
aiming, the compiled trace path, and OPD at the exit pupil. No UI yet.

## Layout

```
docs/ARCHITECTURE.md   engine design, module map, conventions, key decisions
docs/ROADMAP.md        build order, v1 feature cut, v2+
docs/VALIDATION.md     the textbook-physics test ladder and its status
packages/core          pure-TypeScript physics core (no DOM), unit-tested
scripts/               dev tooling (dev-server port ownership)
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
