import { describe, it, expect } from "vitest";
import { D, FRAMES, P, band, expectReproduces, fieldOf } from "./support/refusalSweep";

/**
 * § 2r.2: the exit layout, on the located rim (§ 2q.4). Every reading below is
 * on it; where the aim layout's reading is kept beside it, it says so. The
 * step's own header below quotes it as first published, on the aim layout;
 * VALIDATION § 2r.2 lists what moved, and what reversed.
 */
const EXIT = { layout: "exit", edgeSamples: 8, edgeRule: "crossing" } as const;

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
    expect(D(20, 0.15, 256, 48)).toBeCloseTo(0.6023875557712532, 12);
    expect(D(20, 0.18, 256, 48)).toBeCloseTo(1.11877070344566, 12);
    expect(D(10, 0.18, 256, 48)).toBeCloseTo(1.2700688435658931, 12);

    expect(D(20, 0.15, 256, 48)).toBeCloseTo(D(20, 0.15, 128, 48), 12);
    expect(D(20, 0.18, 256, 48)).toBeCloseTo(D(20, 0.18, 128, 48), 12);
    expect(D(10, 0.18, 256, 48)).toBeCloseTo(D(10, 0.18, 128, 48), 12);

    // The same at the smaller frame, where the pitch is halved the other way.
    expect(D(20, 0.18, 128, 24)).toBeCloseTo(1.0696970919363078, 9);
    expect(D(20, 0.18, 128, 24)).toBeCloseTo(D(20, 0.18, 64, 24), 9);
  });
});

describe("§ 6bq.5 — the 32-pixel frame found a different vertex (aim layout), reads the same one low (exit), and is excluded by measurement", () => {
  it("its best focus was 2.09× and 1.84× from the other two frames' on the aim layout — and is 5% and 9% on the exit", () => {
    expect(P(10, 0.18, 32, 12).focusMm).toBeCloseTo(0.060223863228951034, 12);
    expect(P(10, 0.18, 64, 24).focusMm).toBeCloseTo(0.06329681636777139, 12);
    expect(P(10, 0.18, 128, 48).focusMm).toBeCloseTo(0.06632315469005115, 12);

    const odd = P(10, 0.18, 32, 12).focusMm;
    expect(odd / P(10, 0.18, 64, 24).focusMm).toBeCloseTo(0.951451695122142, 12);
    expect(odd / P(10, 0.18, 128, 48).focusMm).toBeCloseTo(0.9080367710250815, 12);

    // § 2r.2 REVERSED. On the aim layout it was not a drift but a different
    // maximum: the odd vertex sat outside the ±0.03 mm either of the others
    // swept. On the exit layout it is inside both, 3.1 µm and 6.1 µm off — the
    // same maximum, read 5% and 9% low. That is still further than the kept
    // frames sit from each other (under 3.8%, below), which is what the
    // exclusion now rests on, with the 10× ladder that follows.
    for (const [size, ps] of [
      [64, 24],
      [128, 48],
    ] as const) {
      expect(Math.abs(odd - P(10, 0.18, size, ps).focusMm)).toBeLessThan(0.03 / 4);
    }
    expect(odd / P(10, 0.18, 128, 48).focusMm).toBeLessThan(1 / 1.038);
  });

  it("and its 10× ladder is non-monotone by 23% where every larger frame's is not", () => {
    const small = [0.15, 0.16, 0.17].map((na) => D(10, na, 32, 12));
    // Recorded readings — `expectReproduces` carries why they are compared as
    // relative distances. The 40% the rung is about is eleven orders above it.
    // On the aim layout it fell 40% from 0.15 to 0.16; on the exit layout it
    // rises 52% and falls back 23% at 0.17 — non-monotone still, the other way.
    expectReproduces(small, [1.0312741794667688, 1.572434267179877, 1.2765120009878754]);
    expect(small[2]!).toBeLessThan(small[1]!);
    expect(Math.abs(small[1]! / small[2]! / 1.2318209824607926 - 1)).toBeLessThan(1e-12);

    // The same three apertures at the next frame up are monotone increasing.
    const next = [0.15, 0.16, 0.17].map((na) => D(10, na, 64, 24));
    for (let i = 1; i < next.length; i++) expect(next[i]!).toBeGreaterThan(next[i - 1]!);

    // § 2r.2 REVERSED: on the aim layout it was not a 10× quirk — the 20×
    // ladder at the same frame jumped 1.86× over one aperture step and came back
    // down over the next (0.808, 1.498, 1.057). On the exit layout the 20×
    // ladder at 32 pixels is monotone, so here it is the 10×'s alone.
    expect(D(20, 0.17, 32, 12)).toBeCloseTo(0.9738277217467931, 12);
    expect(D(20, 0.18, 32, 12)).toBeCloseTo(1.1043752073031408, 12);
    expect(D(20, 0.19, 32, 12)).toBeCloseTo(1.6803139094844055, 12);
    expect(D(20, 0.18, 32, 12) / D(20, 0.17, 32, 12)).toBeCloseTo(1.1340560374705493, 12);
    expect(D(20, 0.19, 32, 12)).toBeGreaterThan(D(20, 0.18, 32, 12));
    expect(D(20, 0.18, 32, 12)).toBeGreaterThan(D(20, 0.17, 32, 12));
  });

  it("whereas the three frames the bands ARE taken over agree on the vertex to 3.8%", () => {
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
      0.9992341188081676,
      12,
    );
    expect(P(20, 0.18, 256, 96).focusMm / P(20, 0.18, 128, 48).focusMm).toBeCloseTo(
      1.0062620048324666,
      12,
    );
  });
});
