import { describe, it, expect } from "vitest";
import { runCollimation, surfaceCount, type CollimationSpec } from "../src/collimation";

/**
 * The collimation panel — ROADMAP step 7's misalignment scenarios, as invariants
 * rather than as prose.
 *
 * **No engine capability was added for the panel, so no validation-ladder rung
 * was**: every number here is § 1.5.3's and `opdMap`'s, called from the app.
 * Part B's and D10's convention. What is pinned below is the wiring plus the
 * claims the panel makes on screen that no rung states — and two of them are
 * § 1.5.3's own rigid-motion identities arriving in a reader's units, which is
 * the strongest thing this file can say: the panel is not merely consistent with
 * the step under it, it *shows* the step's headline without being told to.
 */

const SPEC: CollimationSpec = {
  lens: "achromat",
  apertureMm: 20,
  focalLengthMm: 100,
  stop: "rear",
  // Surface 1 is the cemented interface: an INTERIOR surface, which is the only
  // kind that actually decollimates — see the two identities below.
  surface: 1,
  kind: "tiltY",
  delta: 0.2,
  fieldHalfDeg: 0.5,
  fieldSamples: 21,
  pupilSamples: 21,
};

const run = (patch: Partial<CollimationSpec> = {}) => runCollimation({ ...SPEC, ...patch });

describe("the collimation panel", () => {
  it("offers every surface the prescription has", () => {
    expect(surfaceCount({ lens: "achromat" })).toBe(3);
    expect(surfaceCount({ lens: "singlet" })).toBe(2);
  });

  /**
   * The teaching, as a pair of numbers. A collimated instrument has no coma on
   * axis and its coma node sits where you are pointing; a decollimated one's
   * does not.
   */
  it("a collimated instrument's coma node is on axis, and a decollimated one's is not", () => {
    const flat = run({ delta: 0 });
    // "on axis" to the sweep's own resolution: the aligned doublet's node sits
    // at −9e-4°, which is the field step (0.05°) divided by fifty and is the
    // interpolation's floor rather than a real offset
    expect(Math.abs(flat.aligned.nodeFieldDeg)).toBeLessThan(0.005);
    expect(Math.abs(flat.nodeShiftDeg)).toBeLessThan(1e-9);

    const bent = run();
    expect(Math.abs(bent.nodeShiftDeg)).toBeGreaterThan(0.002);
    expect(Math.abs(bent.misaligned.axisComaWaves)).toBeGreaterThan(
      3 * Math.abs(bent.aligned.axisComaWaves),
    );
  });

  it("the node moves further the harder the element is knocked, and linearly", () => {
    const small = run({ delta: 0.1 }).nodeShiftDeg;
    const large = run({ delta: 0.2 }).nodeShiftDeg;
    expect(Math.sign(large)).toBe(Math.sign(small));
    // coma is linear in the perturbation, so its node's displacement is too
    expect(large / small).toBeGreaterThan(1.8);
    expect(large / small).toBeLessThan(2.3);
  });

  it("and to the other side when the misalignment reverses", () => {
    const plus = run({ delta: 0.2 }).nodeShiftDeg;
    const minus = run({ delta: -0.2 }).nodeShiftDeg;
    expect(Math.sign(plus)).toBe(-Math.sign(minus));
    expect(Math.abs(Math.abs(plus) - Math.abs(minus))).toBeLessThan(0.2 * Math.abs(plus));
  });

  /**
   * § 1.5.3's RIGID ROTATION identity, arriving in the panel's own units and
   * without the panel being told about it. A perturbation carries every surface
   * after it, so tilting surface 0 turns the whole instrument — which is not
   * decollimated, it is pointed somewhere else. The node must therefore move by
   * EXACTLY the tilt, and it does.
   */
  it("tilting the FIRST surface moves the node by exactly the tilt — it is a re-pointing", () => {
    for (const delta of [0.1, 0.2]) {
      const r = run({ surface: 0, kind: "tiltY", delta });
      expect(Math.abs(r.nodeShiftDeg - delta)).toBeLessThan(1e-3);
    }
  });

  /**
   * § 1.5.3's RIGID TRANSLATION identity, same route. Shifting surface 0 slides
   * the whole instrument sideways, which changes nothing an optical system can
   * measure — so the node must not move at all, and the bound is the machine's
   * rather than the sweep's.
   */
  it("shifting the FIRST surface does not move the node at all", () => {
    for (const delta of [0.2, 0.5]) {
      const r = run({ surface: 0, kind: "decenterY", delta });
      expect(Math.abs(r.nodeShiftDeg)).toBeLessThan(1e-9);
    }
  });

  /** An interior surface is the one that genuinely decollimates. */
  it("an interior surface decollimates where the first one does not", () => {
    const interior = Math.abs(run({ surface: 1, kind: "decenterX", delta: 0.2 }).nodeShiftDeg);
    const first = Math.abs(run({ surface: 0, kind: "decenterX", delta: 0.2 }).nodeShiftDeg);
    expect(interior).toBeGreaterThan(1e-3);
    expect(first).toBeLessThan(1e-9);
  });

  /**
   * Coma is a VECTOR in the field and its node is a POINT, so a one-dimensional
   * sweep meets the node only when the misalignment lies in the sweep's own
   * plane. This is the claim that decides what the panel may say: an
   * out-of-plane misalignment leaves the in-plane node almost where it was while
   * raising the ACROSS component, and reading the first number without the
   * second would report a collimated axis on an instrument that has none.
   *
   * It is pinned because the panel got it wrong first — plotting the coma
   * magnitude, whose sign flips under a dominant perpendicular component, drew a
   * step function and called it a node.
   */
  it("an out-of-plane misalignment moves the node OFF the sweep, not along it", () => {
    const inPlane = run({ surface: 1, kind: "decenterX", delta: 0.1 });
    const outOfPlane = run({ surface: 1, kind: "decenterY", delta: 0.1 });

    // in-plane: the node moves along the line the sweep walks, and nothing
    // appreciable appears across it
    expect(Math.abs(inPlane.nodeShiftDeg)).toBeGreaterThan(1e-3);
    expect(inPlane.misaligned.crossComaWaves).toBeLessThan(
      10 * inPlane.aligned.crossComaWaves + 1e-6,
    );

    // out-of-plane: the reverse, and by orders of magnitude on both counts
    expect(Math.abs(outOfPlane.nodeShiftDeg)).toBeLessThan(
      0.05 * Math.abs(inPlane.nodeShiftDeg),
    );
    expect(outOfPlane.misaligned.crossComaWaves).toBeGreaterThan(
      100 * outOfPlane.aligned.crossComaWaves,
    );
  });

  /**
   * The claim the panel makes about the ENGINE rather than the optics, and the
   * one a reader would not guess: what decides whether § 1.5.3's aiming changes
   * the answer is where the STOP is, not how bad the misalignment is.
   *
   * The front-stop figure is not zero and is not claimed to be: with the stop
   * upstream the misalignment does not move it, but the two aiming modes differ
   * on this lens anyway (§ 1.5.3 — a pupil plane is not a curved stop surface),
   * and that difference propagates through a system the misalignment changed.
   * What is asserted is the ratio, which is what the panel shows.
   */
  it("the aiming matters several times more when the stop is behind the misalignment", () => {
    const front = run({ stop: "front" }).aimingGapFromMisalignmentWaves;
    const rear = run({ stop: "rear" }).aimingGapFromMisalignmentWaves;
    expect(front).toBeGreaterThan(0);
    expect(rear / front).toBeGreaterThan(4);
  });

  /**
   * A lost ray makes every fit an average over a shrinking sub-pupil, which
   * falls as the perturbation grows — the curve would show the instrument
   * IMPROVING as it gets worse. Refused rather than drawn, and the refusal has to
   * be reachable INSIDE the panel's own slider range or it is decoration: the
   * decenter slider reaches 0.5 mm and the rims carry 2% of margin.
   */
  it("the refusal is reachable from the panel's own controls", () => {
    expect(run().lost).toBe(0);
    expect(run({ kind: "decenterY", delta: 0.5 }).lost).toBeGreaterThan(0);
  });

  it("the sweep is centred, so one sample lands exactly on axis", () => {
    const r = run();
    expect(r.aligned.points.length).toBe(SPEC.fieldSamples);
    expect(r.aligned.points.some(([x]) => Math.abs(x) < 1e-12)).toBe(true);
    expect(Number.isFinite(r.axisPenaltyWaves)).toBe(true);
    expect(r.axisPenaltyWaves).toBeGreaterThan(0);
  });
});
