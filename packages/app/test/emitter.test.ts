import { describe, it, expect } from "vitest";
import { renderEmitterScene, emitterOf, type EmitterRequest } from "../src/emitter";
import { objectiveOf, objectiveOptions } from "../src/objective";
import type { MicroscopeKind } from "../src/microscope";

/**
 * APP.md Part Q — the extended emitter.
 *
 * **What is swept, and what is not.** Part P shipped a headline claimed for
 * eighteen reachable configurations with one of them measured, and the
 * correction is this file's starting point rather than its lesson to learn. The
 * claim-bearing axes here are the **objective** (ten rows), the **crop**
 * (pupil samples, which § 6h makes the field), the **grid** (which separates the
 * two errors), the **shape** (a hard edge and a smooth one converge differently)
 * and the **offset** (the area element only departs from 1/M² off axis). All
 * five are swept below.
 *
 * `patches` is not, and that is a statement rather than an omission: it changes
 * how the pupil is allowed to vary across the field, not what the rasterizer
 * does with a density, and its measured effect on the imaged peak is 0.44% from
 * 1 to 2 and 0.004% from 2 to 4 — while costing 2.5× and 8×. It is offered
 * because an extended source is exactly the object a field-varying pupil is for;
 * it carries no claim on this page. `display stretch` is a display control and
 * never reaches the engine.
 *
 * **No ladder rung is added by any of this.** Part Q is app wiring over § 6as,
 * so the pins here are that the app's path reproduces the rung's own published
 * numbers, and that the panel's readouts mean what the panel says they mean.
 */

const options = objectiveOptions(null);

/** Every bench row, in the catalogue's order. */
const KINDS: readonly MicroscopeKind[] = [
  "din-4x-010",
  "din-4x-015",
  "din-4x-020",
  "inf-4x-010",
  "inf-10x-010",
  "inf-20x-010",
  "lister-40x-020",
  "lister-40x-040",
  "oil-100x-125",
  "oil-100x-140",
];

/** The panel's own default request, and the axes vary off it. */
function req(kind: MicroscopeKind, over: Partial<EmitterRequest> = {}): EmitterRequest {
  return {
    spec: objectiveOf(options, kind).spec,
    pupilSamples: 64,
    size: 256,
    patches: 1,
    shape: "disc",
    scaleUm: 23.4,
    offsetUm: 0,
    ...over,
  };
}

function readoutOf(request: EmitterRequest) {
  const result = renderEmitterScene(request);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.error}`);
  return result.readout;
}

/** The five rows whose frame fits inside their own field at the default crop. */
const REACHED = ["din-4x-010", "din-4x-015", "din-4x-020", "inf-4x-010", "inf-10x-010"] as const;

/**
 * The frame's own half width (µm), so a configuration can be stated as a
 * fraction of it.
 *
 * **This helper is the first correction this file cost.** The rungs below were
 * first written at a fixed micron size and offset, which is a *different*
 * fraction of every objective's frame — § 6h fixes the crop at
 * `pupilSamples·λ/(4·NA)`, so the 4×/0.20 sees half the specimen the 4×/0.10
 * does. Two claims came out of that: an off-axis multiplier of "9–10× on every
 * objective", which was really the emitter being clipped on the narrow frames,
 * and a negative-control range whose lower end moved as soon as the emitter size
 * changed. Both were artefacts of comparing unlike configurations. A claim about
 * *lenses* has to hold the emitter's geometry fixed **relative to the frame**,
 * and that is what this exists for.
 */
function halfOf(kind: MicroscopeKind, pupilSamples = 64): number {
  return readoutOf(req(kind, { pupilSamples, scaleUm: 1 })).frameHalfUm;
}

describe("Part Q — the closed forms the optics cannot touch", () => {
  it("a disc's and a Gaussian's total flux are the authored integrals, not the engine's", () => {
    // The whole point of weighing an extended emitter this way: `π·r²` and
    // `π·w²/2` are properties of what was authored, so a rasterizer that put the
    // area element in wrong has nothing to hide behind.
    const disc = emitterOf({ ...req("din-4x-010"), shape: "disc", scaleUm: 23.4 });
    expect(disc.closedFlux).toBeCloseTo(Math.PI * 0.0234 * 0.0234, 15);
    const gauss = emitterOf({ ...req("din-4x-010"), shape: "gaussian", scaleUm: 23.4 });
    expect(gauss.closedFlux).toBeCloseTo((Math.PI * 0.0234 * 0.0234) / 2, 15);
    // Half, exactly — and that ratio is the one thing about the two shapes that
    // is independent of the frame they are rasterized on.
    expect(disc.closedFlux / gauss.closedFlux).toBeCloseTo(2, 12);
  });

  it("§ 6as.4's four decades of erf truncation come back through the app path", () => {
    // The rung tabulates a centred Gaussian on the DIN 4× at grid 256 and finds
    // the deficit tracking `1 − erf(√2·a/w)²` from 1.27e−4 down to 5.29e−11.
    // Those are VALIDATION.md's own published numbers; reproducing them from the
    // app's adapter is the check that this surface is driving § 6as and not a
    // near neighbour of it. The frame half-width is 93.539 µm at pupil samples
    // 64, so the waist fractions below are the rung's 0.5, 0.35 and 0.3.
    const aUm = readoutOf(req("din-4x-010")).frameHalfUm;
    expect(aUm).toBeCloseTo(93.5386, 3);
    const deficitAt = (fraction: number): number =>
      -readoutOf(req("din-4x-010", { shape: "gaussian", scaleUm: aUm * fraction })).fluxResidual;
    // Published: 1.27e−4 at a/w = 2, and 5.29e−11 at a/w = 10/3.
    expect(deficitAt(0.5)).toBeGreaterThan(1.26e-4);
    expect(deficitAt(0.5)).toBeLessThan(1.28e-4);
    expect(deficitAt(0.35)).toBeGreaterThan(2.2e-8);
    expect(deficitAt(0.35)).toBeLessThan(2.3e-8);
    expect(deficitAt(0.3)).toBeGreaterThan(5.2e-11);
    expect(deficitAt(0.3)).toBeLessThan(5.4e-11);
  });

  it("the area element on the axis is 1/M², to the precision M itself is known", () => {
    // Every objective that runs, not the fixture: this is the claim that does
    // not belong to one lens, and § 6as.1 pins it on the map while this pins it
    // through the app's own frame.
    for (const kind of KINDS) {
      const result = renderEmitterScene(req(kind, { pupilSamples: 16, scaleUm: 1 }));
      if (!result.ok) continue;
      const d = result.readout;
      expect(d.detJAxis * d.magnification * d.magnification, kind).toBeCloseTo(1, 6);
      // Not merely close — the residual is the traced magnification's own
      // departure from the label, doubled, because the element is M squared.
      expect(d.detJAxisAgainstM2, kind).toBeLessThan(1e-6);
    }
  });
});

describe("Part Q — the two errors, and each is deaf to the other's control", () => {
  it("the sampling residual is the same number on every objective, to five figures", () => {
    // The panel's headline half that is NOT about optics. A disc's total is a
    // count of lattice points inside a circle, so once the emitter is the same
    // fraction of the frame on every row, the residual has nothing left to
    // depend on — and it does not.
    const residuals = REACHED.map((kind) =>
      readoutOf(req(kind, { scaleUm: 0.1 * halfOf(kind) })).fluxResidual,
    );
    // Relative, not decimal places: "five significant figures" is the claim, and
    // −1.111004e−2 against −1.111081e−2 differs in the sixth. A `toBeCloseTo`
    // with six digits reads as the stronger claim and fails on the real spread,
    // which is how this line found its own wording.
    for (const residual of residuals) expect(Math.abs(residual / -1.1110e-2 - 1)).toBeLessThan(1e-4);
    const spread = Math.max(...residuals) / Math.min(...residuals) - 1;
    expect(Math.abs(spread)).toBeLessThan(1e-4);
  });

  it("...and it follows the emitter's radius in PIXELS, not anything optical", () => {
    // The same disc in pixels on two objectives 2.5× apart in magnification and
    // at two crops. If the residual were optical this would be four numbers.
    const at = (kind: MicroscopeKind, pupilSamples: number): number =>
      readoutOf(req(kind, { pupilSamples, scaleUm: 0.1 * halfOf(kind, pupilSamples) }))
        .fluxResidual;
    for (const kind of ["din-4x-010", "inf-10x-010"] as const) {
      for (const pupilSamples of [32, 64]) {
        expect(
          readoutOf(req(kind, { pupilSamples, scaleUm: 0.1 * halfOf(kind, pupilSamples) }))
            .emitterPixels,
          `${kind} ${pupilSamples}`,
        ).toBeCloseTo(12.8, 3);
        expect(at(kind, pupilSamples), `${kind} ${pupilSamples}`).toBeCloseTo(-1.111e-2, 5);
      }
    }
  });

  it("the residual moves with the grid, and it does not move monotonically", () => {
    // § 6as.4's open exponent, live. Recorded as three signed numbers rather
    // than as a convergence rate, because the Gauss circle problem does not have
    // one — a rung asserting "it falls" would pass at these three sizes and be
    // stating something nobody has proved.
    const a = halfOf("din-4x-010");
    const at = (size: number): number =>
      readoutOf(req("din-4x-010", { size, scaleUm: 0.1 * a })).fluxResidual;
    expect(at(128)).toBeCloseTo(2.49e-3, 5);
    expect(at(256)).toBeCloseTo(-1.111e-2, 5);
    expect(at(512)).toBeCloseTo(1.032e-3, 5);
    // Two sign changes over three grids: this is a discrepancy, not a residual
    // converging to zero, and the panel says so rather than implying otherwise.
    expect(Math.sign(at(128))).not.toBe(Math.sign(at(256)));
    expect(Math.sign(at(256))).not.toBe(Math.sign(at(512)));
  });

  it("the Jacobian's worth is flat to nine figures over the same ×4 of grid", () => {
    // The other half, and a smooth emitter is what makes it a clean statement: a
    // hard edge re-quantizes its own lattice count when the grid changes, which
    // moves the third digit for a reason that has nothing to do with the
    // Jacobian. Swept over every row that runs.
    for (const kind of REACHED) {
      const a = halfOf(kind);
      const worthAt = (size: number): number =>
        readoutOf(
          req(kind, { shape: "gaussian", size, scaleUm: 0.1 * a, offsetUm: 0.4 * a }),
        ).jacobianWorth;
      expect(Math.abs(worthAt(512) / worthAt(128) - 1), kind).toBeLessThan(1e-8);
    }
  });

  it("...and it spreads 179× across the objectives the grid could not tell apart", () => {
    // The comparison the panel is built on: same emitter geometry, same grid,
    // same crop — the sampling residual agrees to five figures and this one does
    // not agree at all, because it is the distortion of five different designs.
    const centred = REACHED.map((kind) =>
      readoutOf(req(kind, { scaleUm: 0.1 * halfOf(kind) })).jacobianWorth,
    );
    const spread = Math.max(...centred) / Math.min(...centred);
    expect(spread).toBeGreaterThan(150);
    expect(spread).toBeLessThan(210);
    // The two ends the panel names by lens, so a reworded page is caught here.
    expect(readoutOf(req("din-4x-020", { scaleUm: 0.1 * halfOf("din-4x-020") })).jacobianWorth)
      .toBeCloseTo(4.35e-9, 10);
    expect(readoutOf(req("inf-10x-010", { scaleUm: 0.1 * halfOf("inf-10x-010") })).jacobianWorth)
      .toBeCloseTo(7.80e-7, 8);
  });

  it("throwing the area element away costs more off axis, on every row, by a factor that is each lens's", () => {
    // The ORDERING is the claim; the factor is recorded and explicitly not
    // offered as a law, which is § 6au's caution and Part P's correction applied
    // one part later. 35× to 380× is a spread of eleven, on five lenses, at one
    // configuration — nothing about it generalizes and the panel says so.
    const factors: number[] = [];
    for (const kind of REACHED) {
      const a = halfOf(kind);
      const centred = readoutOf(req(kind, { scaleUm: 0.1 * a })).jacobianWorth;
      const offAxis = readoutOf(req(kind, { scaleUm: 0.1 * a, offsetUm: 0.4 * a })).jacobianWorth;
      expect(centred, kind).toBeGreaterThan(0);
      expect(offAxis, kind).toBeGreaterThan(centred);
      factors.push(offAxis / centred);
    }
    expect(factors.length).toBe(5);
    expect(Math.min(...factors)).toBeGreaterThan(30);
    expect(Math.max(...factors)).toBeLessThan(400);
    // Recorded so the "it does not generalize" sentence has a number behind it.
    expect(Math.max(...factors) / Math.min(...factors)).toBeGreaterThan(5);
  });

  it("the whole negative control stays inside the range the panel quotes", () => {
    // 4.4e−9 to 2.7e−5 over the five rows and both offsets. Both ends are named
    // in the prose, so both ends are pinned.
    const all: number[] = [];
    for (const kind of REACHED) {
      const a = halfOf(kind);
      all.push(readoutOf(req(kind, { scaleUm: 0.1 * a })).jacobianWorth);
      all.push(readoutOf(req(kind, { scaleUm: 0.1 * a, offsetUm: 0.4 * a })).jacobianWorth);
    }
    expect(Math.min(...all)).toBeGreaterThan(4e-9);
    expect(Math.max(...all)).toBeLessThan(3e-5);
  });

  it("the light the chain forms is the light the emitter emitted, to f64", () => {
    // § 6as.7 from the app's side, and the architectural claim with it: the
    // incoherent render was built before the extended emitter and does not move
    // for one. Swept over both shapes and both offsets so a shape-specific
    // leak could not hide.
    for (const shape of ["disc", "gaussian"] as const) {
      for (const offsetUm of [0, 30]) {
        const d = readoutOf(req("din-4x-010", { shape, offsetUm, scaleUm: 12 }));
        expect(d.lightResidual, `${shape} ${offsetUm}`).toBeLessThan(1e-12);
      }
    }
  });
});

describe("Part Q — the frame's corner is what decides, and the panel says so either way", () => {
  it("headroom is exactly inverse in the crop, on every row that builds", () => {
    // The corner grows in proportion to pupil samples (§ 6h fixes the object
    // crop, so the image-side extent is that times |M|) and the field limit is
    // the design's. So the ratio halves when the crop doubles, and it does so
    // whether or not the configuration runs — which is why the refusal carries
    // the number.
    for (const kind of KINDS) {
      const at = (pupilSamples: number): number | null => {
        const r = renderEmitterScene(req(kind, { pupilSamples, scaleUm: 1 }));
        return r.ok ? r.readout.fieldHeadroom : (r.headroom?.fieldHeadroom ?? null);
      };
      const small = at(32);
      const large = at(64);
      if (small === null || large === null) continue;
      expect(small / large, kind).toBeCloseTo(2, 6);
    }
  });

  it("five rows of ten run at the default crop, and seven of the nine that build at 16", () => {
    // The count the panel prints, counted. A row that stops building is counted
    // separately from a row whose frame will not fit, because they are different
    // failures and only the second one is about this surface.
    const runs = (pupilSamples: number): { ok: number; noFrame: number } => {
      let ok = 0;
      let noFrame = 0;
      for (const kind of KINDS) {
        const r = renderEmitterScene(req(kind, { pupilSamples, scaleUm: 1 }));
        if (r.ok) ok++;
        else if (r.headroom === null) noFrame++;
      }
      return { ok, noFrame };
    };
    expect(runs(64)).toEqual({ ok: 5, noFrame: 1 });
    expect(runs(16)).toEqual({ ok: 7, noFrame: 1 });
  });

  it("the infinity 20× misses by one percent, which is why it is the row to look at", () => {
    const r = renderEmitterScene(req("inf-20x-010", { pupilSamples: 32, scaleUm: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.headroom).not.toBeNull();
    expect(r.headroom!.fieldHeadroom).toBeGreaterThan(0.98);
    expect(r.headroom!.fieldHeadroom).toBeLessThan(1);
    // One halving of the crop is all it needs, and the panel says so.
    const half = renderEmitterScene(req("inf-20x-010", { pupilSamples: 16, scaleUm: 1 }));
    expect(half.ok).toBe(true);
  });

  it("a refusal with no frame carries no headroom, rather than a number about nothing", () => {
    // The 40×/0.40 Lister refuses at the prescription, so there is no frame to
    // measure a corner on. A headroom printed there would be a claim about a
    // system that was never built.
    const r = renderEmitterScene(req("lister-40x-040"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.headroom).toBeNull();
    expect(r.source).toBe("engine");
    expect(r.error).toContain("listerObjective");
  });

  it("an emitter with no extent is refused as the app's own, not the engine's", () => {
    const r = renderEmitterScene(req("din-4x-010", { scaleUm: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.source).toBe("app");
    // And the frame existed, so the headroom travels with it.
    expect(r.headroom).not.toBeNull();
  });
});

describe("Part Q — the guard that stops a truncation being read as a sampling failure", () => {
  it("the same emitter is inside one objective's frame and half outside another's", () => {
    // Found by walking the offset control, and it is the reason `reachUm` is a
    // readout at all: § 6h fixes the crop at `pupilSamples·λ/(4·NA)`, so the
    // HIGHER aperture sees less specimen and clips first. Same emitter, same
    // crop, same grid — only the objective differs.
    const wide = readoutOf(req("din-4x-010", { scaleUm: 23.4, offsetUm: 46.8 }));
    const narrow = readoutOf(req("din-4x-020", { scaleUm: 23.4, offsetUm: 46.8 }));
    expect(wide.reachUm).toBeCloseTo(70.2, 6);
    expect(narrow.reachUm).toBeCloseTo(70.2, 6);
    expect(wide.reachUm).toBeLessThan(wide.frameHalfUm);
    expect(narrow.reachUm).toBeGreaterThan(narrow.frameHalfUm);
    // And the residual is what a reader would otherwise misread: a part in a
    // thousand where the emitter fits, half the flux where it does not.
    expect(Math.abs(wide.fluxResidual)).toBeLessThan(1e-2);
    expect(narrow.fluxResidual).toBeLessThan(-0.5);
  });

  it("the reach is the emitter's own geometry and nothing the frame did", () => {
    // Pinned separately because the guard is a comparison of two numbers, and a
    // reach that quietly depended on the frame would make the comparison
    // circular.
    for (const kind of ["din-4x-010", "inf-10x-010"] as const) {
      for (const scaleUm of [5, 23.4]) {
        for (const offsetUm of [0, 20]) {
          const d = readoutOf(req(kind, { scaleUm, offsetUm }));
          expect(d.reachUm, `${kind} ${scaleUm} ${offsetUm}`).toBeCloseTo(scaleUm + offsetUm, 9);
        }
      }
    }
  });

  it("the emitter's size in object pixels is the ruler the picture is read with", () => {
    // Doubling the grid doubles it and doubling the crop halves it — the two
    // controls that look alike and are not, which is § 6h's constraint arriving
    // at a third surface.
    // The RATIOS are the claim; the absolute value is 32.02 rather than 32
    // because 23.4 µm is a round number in microns and not in object pixels, and
    // pinning it to 32 would be pinning the rounding of the slider's default.
    const base = readoutOf(req("din-4x-010", { scaleUm: 23.4 })).emitterPixels;
    expect(base).toBeCloseTo(32.02, 2);
    const finerGrid = readoutOf(
      req("din-4x-010", { scaleUm: 23.4, size: 512 }),
    ).emitterPixels;
    const smallerCrop = readoutOf(
      req("din-4x-010", { scaleUm: 23.4, pupilSamples: 32 }),
    ).emitterPixels;
    expect(finerGrid / base).toBeCloseTo(2, 9);
    expect(smallerCrop / base).toBeCloseTo(2, 9);
  });
});

describe("Part Q — the optics, which is one number and is not a verdict", () => {
  it("a smaller emitter loses more of its peak, and it is the only optical readout here", () => {
    // § 6as.6's point limit, driven: as the disc shrinks toward the PSF the
    // convolution takes more of the peak. Monotone across four sizes, and no
    // verdict is minted from it — § 6i mints none and this surface inherits that.
    const drops = [46.8, 23.4, 9.4, 2.8].map(
      (scaleUm) => readoutOf(req("din-4x-010", { scaleUm })).peakDrop,
    );
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i]!, `size index ${i}`).toBeGreaterThan(drops[i - 1]!);
    }
    expect(drops[0]!).toBeLessThan(0.02);
    expect(drops[3]!).toBeGreaterThan(0.4);
  });

  it("patches changes the imaged peak by under a percent, which is why it carries no claim", () => {
    // Recorded rather than pinned tightly: the axis is offered because an
    // extended source is what a field-varying pupil is for, and the honest thing
    // to say about it here is how little it moves.
    const peakAt = (patches: number): number =>
      readoutOf(req("din-4x-010", { patches, scaleUm: 46.8 })).imagePeak;
    const one = peakAt(1);
    const two = peakAt(2);
    expect(Math.abs(two / one - 1)).toBeLessThan(0.01);
  });
});
