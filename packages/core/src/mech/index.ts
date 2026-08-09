/**
 * `core/mech` — the mechanical layer (docs/ARCHITECTURE.md, docs/VALIDATION.md
 * § 5u).
 *
 * Three files, and the split is the layer's whole discipline:
 *
 *  - `standards.ts` — transcribed interface data. Barrels, threads, flange and
 *    parfocal distances. **Not rungs**, and the file says so at the top.
 *  - `path.ts` — rules over that data: what a chain occupies, what its glass
 *    hands back, and whether the train reaches focus.
 *  - `insert.ts` — the one route into the optics. Glass becomes real surfaces
 *    and the tracer finds the focus; nothing here applies a formula to an image.
 */
export * from "./standards";
export * from "./path";
export * from "./parts";
export * from "./insert";
