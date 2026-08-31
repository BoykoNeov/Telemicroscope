import { describe, it, expect } from "vitest";
import { D, FRAMES, P, band, fieldOf } from "./support/refusalSweep";

/**
 * § 6bq — what the frame does to the refusal reading.
 *
 * The other half of § 6bq. `refusal-boundary.test.ts` measures WHERE
 * `renderedBestFocus` starts refusing and shows the boundary rising with
 * magnification in step with § 6bn.1's buildable ceiling. It quotes every band
 * over three frames — `(64, 24)`, `(128, 48)`, `(256, 96)` — and this file is
 * why those three, which is a precondition for that step meaning anything: a
 * boundary quoted at a frame is worth nothing until the frame is shown to be
 * either irrelevant or accounted for.
 *
 * **A matched field here is a point, not § 6bp's family.** § 6bp found that
 * `pupilSamples` fixes the field and leaves `size` free, so "at a matched field"
 * named a family of quartets spanning 3.4%, and made the band its instrument.
 * This readout has no such band: doubling `size` at a held `pupilSamples` halves
 * the pixel pitch, holds the field, and reproduces the plateau to **twelve
 * digits** at three lenses. The reason is in the source — `plateauDepths` is
 * `stepMm · sqrt(0.1/|curvature|) / depthOfFocus` where `curvature` is
 * `(y₀ − 2y₁ + y₂)/y₁`, a RATIO of frame maxima, and the frame's extent is set
 * by `pupilSamples` alone. Two readouts on one branch, one with a 3.4% sampling
 * band and one with none, and the difference is a line of algebra either could
 * have been read from.
 *
 * That invariance has a floor, and it is not pinned here because it is not this
 * step's claim: it is measured between 2.67 and 5.33 pixels per resolution cell.
 * A `(128, 96)` frame — 1.33, below Nyquist — reproduces its `(256, 96)` twin to
 * seven digits and not twelve, which is why the cheap substitution that would
 * have made this step a quarter of the price is not taken.
 *
 * **A frame can find a different vertex, and one of ours does.** The 32-pixel
 * frame is in the same family as the others — same pixel pitch, a quarter of the
 * extent — and it is not usable: on the 10×/0.18 it returns a best focus of
 * 0.1221 mm against 0.0584 mm and 0.0663 mm, 2.09× and 1.84× away and outside
 * the other two's whole ±0.03 mm fine sweep. Its ladder is non-monotone by 40%
 * where every larger frame's is monotone. So it is excluded, by measurement
 * rather than by taste, and the rule it leaves behind is that **a plateau
 * compared across frames must have its VERTEX checked first** — § 6bp's
 * instruction to quote a matched-field number with its pixel sampling is not
 * enough on its own.
 */

describe("§ 6bq.2 — this readout has no pixel-pitch family, so a matched field is a POINT", () => {
  it("doubling `size` at a held `pupilSamples` holds the field exactly", () => {
    // `halfExtent = pupilSamples · λ / (4 · NA_image)` — § 6bo.1's closed form
    // has no `size` in it, so this pair changes the pixel pitch and nothing else.
    for (const [M, na] of [
      [20, 0.15],
      [20, 0.18],
      [10, 0.18],
    ] as const) {
      expect(fieldOf(M, na, 256, 48)).toBeCloseTo(fieldOf(M, na, 128, 48), 12);
    }
  });

  it("and the plateau comes back to twelve digits at half the pitch", () => {
    expect(D(20, 0.15, 256, 48)).toBeCloseTo(0.5985464294184988, 12);
    expect(D(20, 0.18, 256, 48)).toBeCloseTo(1.0738808825086998, 12);
    expect(D(10, 0.18, 256, 48)).toBeCloseTo(1.288847552430459, 12);

    expect(D(20, 0.15, 256, 48)).toBeCloseTo(D(20, 0.15, 128, 48), 12);
    expect(D(20, 0.18, 256, 48)).toBeCloseTo(D(20, 0.18, 128, 48), 12);
    expect(D(10, 0.18, 256, 48)).toBeCloseTo(D(10, 0.18, 128, 48), 12);

    // The same at the smaller frame, where the pitch is halved the other way.
    expect(D(20, 0.18, 128, 24)).toBeCloseTo(0.9819748349292025, 9);
    expect(D(20, 0.18, 128, 24)).toBeCloseTo(D(20, 0.18, 64, 24), 9);
  });
});

describe("§ 6bq.5 — the 32-pixel frame finds a different vertex, and is excluded by measurement", () => {
  it("its best focus is 2.09× and 1.84× from the other two frames', on one lens", () => {
    expect(P(10, 0.18, 32, 12).focusMm).toBeCloseTo(0.12206135782997773, 12);
    expect(P(10, 0.18, 64, 24).focusMm).toBeCloseTo(0.05838824606511346, 12);
    expect(P(10, 0.18, 128, 48).focusMm).toBeCloseTo(0.06634114381918149, 12);

    const odd = P(10, 0.18, 32, 12).focusMm;
    expect(odd / P(10, 0.18, 64, 24).focusMm).toBeCloseTo(2.0905124927687884, 12);
    expect(odd / P(10, 0.18, 128, 48).focusMm).toBeCloseTo(1.8399043309031042, 12);

    // Not a drift — a different maximum. The fine sweep is ±0.03 mm, and the odd
    // vertex is outside the interval either of the others swept.
    for (const [size, ps] of [
      [64, 24],
      [128, 48],
    ] as const) {
      expect(Math.abs(odd - P(10, 0.18, size, ps).focusMm)).toBeGreaterThan(0.03);
    }
  });

  it("and its ladder is non-monotone by 40% where every larger frame's is not", () => {
    const small = [0.15, 0.16, 0.17].map((na) => D(10, na, 32, 12));
    expect(small).toEqual([1.1153338101745813, 0.7966335638880051, 0.8411895076626353]);
    expect(small[1]!).toBeLessThan(small[0]!);
    expect(small[0]! / small[1]!).toBeCloseTo(1.4000587732346421, 12);

    // The same three apertures at the next frame up are monotone increasing.
    const next = [0.15, 0.16, 0.17].map((na) => D(10, na, 64, 24));
    for (let i = 1; i < next.length; i++) expect(next[i]!).toBeGreaterThan(next[i - 1]!);

    // And it is not a 10× quirk: the 20× ladder at the same frame jumps 1.86×
    // over one aperture step and comes back down over the next.
    expect(D(20, 0.17, 32, 12)).toBeCloseTo(0.8075386145350787, 12);
    expect(D(20, 0.18, 32, 12)).toBeCloseTo(1.4983651975976182, 12);
    expect(D(20, 0.19, 32, 12)).toBeCloseTo(1.0568796047568005, 12);
    expect(D(20, 0.18, 32, 12) / D(20, 0.17, 32, 12)).toBeCloseTo(1.8554718878183512, 12);
    expect(D(20, 0.19, 32, 12)).toBeLessThan(D(20, 0.18, 32, 12));
  });

  it("whereas the three frames the bands ARE taken over agree on the vertex to 2%", () => {
    // The check the exclusion is made on, applied to the frames kept.
    for (const [M, na] of [
      [10, 0.15],
      [10, 0.16],
      [20, 0.17],
      [20, 0.18],
    ] as const) {
      const [lo, hi] = band([P(M, na, 64, 24).focusMm, P(M, na, 128, 48).focusMm]);
      expect(hi / lo).toBeLessThan(1.06);
    }
    expect(P(10, 0.15, 256, 96).focusMm / P(10, 0.15, 128, 48).focusMm).toBeCloseTo(
      0.9976342036647008,
      12,
    );
    expect(P(20, 0.18, 256, 96).focusMm / P(20, 0.18, 128, 48).focusMm).toBeCloseTo(
      0.9906896073656232,
      12,
    );
  });
});
