import { describe, it, expect } from "vitest";
import { renderBrightfield, type PatchPupil } from "../src/imaging/brightfield";
import { abbeImage, cosineGratingObject, type ObjectField } from "../src/illumination/abbe";
import { defocusedPupil, gratingImage, idealPupil } from "../src/illumination/transfer";
import { diskSource } from "../src/illumination/source";
import type { OpdSampling } from "../src/wave/fidelity";

/**
 * § 6g.3 — the bridge: `abbeImage` across a field whose pupil is not constant,
 * and the first caller `brightfieldFidelity` has ever had.
 *
 * Cost here is patches² × source points × one N² transform, so the grid stays
 * small and the condenser coarse. The two rungs that carry external numbers do
 * not care: one is an exact identity, and the other is § 6f's own three-order
 * closed form evaluated locally, which is exact for any source.
 */

const SIZE = 64;
const PUPIL_SAMPLES = 32;
/** 8 cycles over 64 cells: period 8, and ν = 2·cycles/pupilSamples = 0.5. */
const CYCLES = 8;
const NU = (2 * CYCLES) / PUPIL_SAMPLES;
const MODULATION = 0.6;
const SOURCE = diskSource(0.6, 9);

const GRATING: ObjectField = cosineGratingObject({
  size: SIZE,
  cycles: CYCLES,
  modulation: MODULATION,
});

/**
 * A field-varying pupil FIXTURE: defocus running linearly across the frame.
 *
 * Not a physical field curvature — a stand-in with the one property the rungs
 * need, which is that the two edges of the frame have different, exactly known
 * pupils. Real field dependence arrives through `imaging/object-field` (§ 6h),
 * and § 6h.5 runs these same rungs on a traced DIN 4× — where the convergence
 * ratio is 0.50 against this fixture's just-under-0.4, so what a labelled ramp
 * fixes is the shape and not the rate.
 */
const DEFOCUS_AT_LEFT = 0.1;
const DEFOCUS_AT_RIGHT = 0.9;
function defocusAt(u: number): number {
  return DEFOCUS_AT_LEFT + (DEFOCUS_AT_RIGHT - DEFOCUS_AT_LEFT) * u;
}
function varyingPupil(u: number): PatchPupil {
  return { pupil: defocusedPupil(defocusAt(u)) };
}

function sampling(maxGradientWavesPerRadius: number): OpdSampling {
  return { maxStepWaves: 0, spacing: 0.1, maxGradientWavesPerRadius, fitResidualWaves: 0 };
}

/**
 * Modulation depth of a periodic image over a window of whole periods.
 *
 * The image of a grating whose period divides the grid is itself exactly
 * periodic, so one period is the whole measurement — which is what lets a
 * *local* contrast be compared against a closed form with no windowing artefact
 * to argue about.
 */
function localContrast(intensity: Float64Array, x0: number, width: number, cycles: number): number {
  let dc = 0;
  let re = 0;
  let im = 0;
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let k = 0; k < width; k++) {
      const v = intensity[y * SIZE + (x0 + k)]!;
      const ang = (-2 * Math.PI * cycles * k) / width;
      dc += v;
      re += v * Math.cos(ang);
      im += v * Math.sin(ang);
      count++;
    }
  }
  const mean = dc / count;
  return mean > 0 ? (2 * Math.hypot(re, im)) / count / mean : 0;
}

function worstDifference(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
}

function peak(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

describe("the field-varying brightfield image (§ 6g.3)", () => {
  it("a field-constant pupil makes the decomposition the identity", () => {
    // Σ_p w_p ≡ 1 and every patch forms the same image, so the blend cannot
    // change it. This is the correctness gate the whole output-side scheme rests
    // on: engine-vs-itself, and the reason the input side had to be ruled out
    // separately (§ 6g.2) rather than compared against here.
    const reference = abbeImage(GRATING, idealPupil(), SOURCE, {
      pupilSamples: PUPIL_SAMPLES,
    }).intensity;
    const constant = (): PatchPupil => ({ pupil: idealPupil() });
    for (const patches of [1, 2, 4, 8]) {
      const rendered = renderBrightfield(GRATING, constant, SOURCE, {
        patches,
        pupilSamples: PUPIL_SAMPLES,
      });
      expect(worstDifference(rendered.intensity, reference)).toBeLessThan(1e-12 * peak(reference));
    }
  });

  it("the edge patches are exact, and each carries § 6f's law with its own pupil", () => {
    // `patchWeight` runs FLAT to the frame edge — the outermost half-patch is
    // covered by one window at weight 1 and by no other. So in that strip the
    // blend is not an approximation at all: the output IS `abbeImage` through
    // that patch's pupil, and its contrast is § 6f's three-order closed form for
    // that pupil, with no tolerance to argue about.
    const patches = 4;
    const flat = SIZE / (2 * patches); // 8 cells = one grating period
    const rendered = renderBrightfield(GRATING, varyingPupil, SOURCE, {
      patches,
      pupilSamples: PUPIL_SAMPLES,
    });

    const leftU = 0.5 / patches;
    const rightU = 1 - 0.5 / patches;
    const closed = (u: number): number =>
      gratingImage(defocusedPupil(defocusAt(u)), SOURCE, NU, MODULATION).contrast;

    expect(localContrast(rendered.intensity, 0, flat, 1)).toBeCloseTo(closed(leftU), 9);
    expect(localContrast(rendered.intensity, SIZE - flat, flat, 1)).toBeCloseTo(closed(rightU), 9);

    // …and the two ends really are different numbers, or the rung would pass on
    // a render that had quietly used one pupil everywhere.
    expect(Math.abs(closed(leftU) - closed(rightU))).toBeGreaterThan(0.1 * closed(leftU));
    // The whole point of the field decomposition, stated as an inequality: a
    // single patch cannot hold both ends, and it lands between them.
    const single = renderBrightfield(GRATING, varyingPupil, SOURCE, {
      patches: 1,
      pupilSamples: PUPIL_SAMPLES,
    });
    const uniform = localContrast(single.intensity, 0, flat, 1);
    expect(uniform).toBeLessThan(closed(leftU));
    expect(uniform).toBeGreaterThan(closed(rightU));
  });

  it("the interior is not exact, and converges in the patch count", () => {
    // Output windowing blends images each formed with the wrong pupil over most
    // of their support — the cost `imaging/render` objects to, paid here because
    // the input side is unavailable rather than because it is cheaper. It has no
    // closed form, so what is pinned is that refining the decomposition settles
    // rather than wanders.
    const counts = [1, 2, 4, 8, 16];
    const levels = counts.map(
      (patches) =>
        renderBrightfield(GRATING, varyingPupil, SOURCE, {
          patches,
          pupilSamples: PUPIL_SAMPLES,
        }).intensity,
    );
    const steps = [0, 1, 2, 3].map((i) => worstDifference(levels[i]!, levels[i + 1]!));
    // Geometric, at a stable rate just under 0.4 per doubling — between first
    // and second order. A stalling sequence would show a ratio drifting to 1,
    // and that is the failure this is written to catch rather than “each step
    // is smaller than the last”, which a wandering image can satisfy too.
    for (let i = 1; i < steps.length; i++) {
      const ratio = steps[i]! / steps[i - 1]!;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.5);
    }
    // Measured: 16.4% of peak at 1 → 2, and 0.97% by 8 → 16.
    expect(steps[0]!).toBeGreaterThan(0.1 * peak(levels[4]!));
    expect(steps[3]!).toBeLessThan(0.01 * peak(levels[4]!));
  });

  it("brightfieldFidelity finally has a caller, and the worst patch rules", () => {
    // The verdict § 6f.9 landed with nothing to consult it. A frame is not
    // honest in the places where it happens to be, so one bad corner decides.
    const good = sampling(1);
    const bad = sampling(20);

    const allGood = renderBrightfield(GRATING, () => ({ pupil: idealPupil(), sampling: good }), SOURCE, {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(allGood.fidelity.verdict).toBe("valid");

    // One patch of four, and it is the one that is reported.
    const oneBad = renderBrightfield(
      GRATING,
      (u, v) => ({ pupil: idealPupil(), sampling: u > 0.5 && v > 0.5 ? bad : good }),
      SOURCE,
      { patches: 2, pupilSamples: PUPIL_SAMPLES },
    );
    expect(oneBad.fidelity.verdict).toBe("no-honest-image");
    expect(oneBad.fidelity.geometricShare).toBeGreaterThan(0);

    // Absent sampling is `unknown`, never `valid` — and `unknown` does not mask
    // a `no-honest-image` beside it either.
    const noSampling = renderBrightfield(GRATING, () => ({ pupil: idealPupil() }), SOURCE, {
      patches: 2,
      pupilSamples: PUPIL_SAMPLES,
    });
    expect(noSampling.fidelity.verdict).toBe("unknown");
    expect(noSampling.fidelity.phaseStepWaves).toBeNull();

    const mixed = renderBrightfield(
      GRATING,
      (u) => (u > 0.5 ? { pupil: idealPupil(), sampling: bad } : { pupil: idealPupil() }),
      SOURCE,
      { patches: 2, pupilSamples: PUPIL_SAMPLES },
    );
    expect(mixed.fidelity.verdict).toBe("no-honest-image");
  });

  it("requireHonest refuses, and only when asked", () => {
    const bad = { pupil: idealPupil(), sampling: sampling(20) };
    expect(() =>
      renderBrightfield(GRATING, () => bad, SOURCE, {
        patches: 1,
        pupilSamples: PUPIL_SAMPLES,
        requireHonest: true,
      }),
    ).toThrow(/no-honest-image/);
    // Unknown is refused too: it is not a clean bill of health.
    expect(() =>
      renderBrightfield(GRATING, () => ({ pupil: idealPupil() }), SOURCE, {
        patches: 1,
        pupilSamples: PUPIL_SAMPLES,
        requireHonest: true,
      }),
    ).toThrow(/unknown/);
    // Without the flag the same call returns the image AND the verdict, because
    // a caller may legitimately want to look at what it cannot trust.
    expect(
      renderBrightfield(GRATING, () => bad, SOURCE, { patches: 1, pupilSamples: PUPIL_SAMPLES })
        .fidelity.verdict,
    ).toBe("no-honest-image");
  });

  it("the per-patch guards come through as max and min, not as the last patch's", () => {
    // `abbeImage` reports both per call. Aggregated the way each one means
    // something: the grid guard is a worst case, the source count a coverage
    // floor, and taking either from whichever patch happened to run last would
    // be a number that looks like a measurement.
    const patches = 2;
    const result = renderBrightfield(GRATING, varyingPupil, SOURCE, {
      patches,
      pupilSamples: PUPIL_SAMPLES,
    });
    let expectedMax = 0;
    let expectedMin = Infinity;
    for (let py = 0; py < patches; py++) {
      for (let px = 0; px < patches; px++) {
        const formed = abbeImage(GRATING, varyingPupil((px + 0.5) / patches).pupil, SOURCE, {
          pupilSamples: PUPIL_SAMPLES,
        });
        expectedMax = Math.max(expectedMax, formed.maxGridPhaseStepWaves);
        expectedMin = Math.min(expectedMin, formed.contributingPoints);
      }
    }
    expect(result.maxGridPhaseStepWaves).toBeCloseTo(expectedMax, 15);
    expect(result.contributingPoints).toBe(expectedMin);
    // The frame's steepest pupil is the one that set it — the right edge here.
    expect(result.maxGridPhaseStepWaves).toBeGreaterThan(0);
    expect(result.patches).toBe(patches);
  });

  it("the pupil is keyed on position, so the patch count refines rather than moves", () => {
    // Keying on the patch index would make "patch 2 of 4" and "patch 2 of 8"
    // different field points, and the convergence rung above would be measuring
    // nothing. The callback's arguments are normalized and their span is fixed.
    const seen: number[] = [];
    renderBrightfield(GRATING, (u) => {
      seen.push(u);
      return { pupil: idealPupil() };
    }, SOURCE, { patches: 4, pupilSamples: PUPIL_SAMPLES });
    const unique = [...new Set(seen)].sort((a, b) => a - b);
    expect(unique).toHaveLength(4);
    expect(unique[0]).toBeCloseTo(0.125, 15);
    expect(unique[3]).toBeCloseTo(0.875, 15);
    // Every level's centres lie strictly inside [0, 1], and the two extremes
    // approach the frame edges as the count rises rather than shifting sideways.
    const centres = (patches: number): number[] =>
      Array.from({ length: patches }, (_, p) => (p + 0.5) / patches);
    expect(centres(8)[0]!).toBeLessThan(centres(4)[0]!);
    expect(centres(8)[7]!).toBeGreaterThan(centres(4)[3]!);
  });

  it("rejects a patch count that is not a positive integer", () => {
    for (const patches of [0, -1, 2.5]) {
      expect(() =>
        renderBrightfield(GRATING, () => ({ pupil: idealPupil() }), SOURCE, {
          patches,
          pupilSamples: PUPIL_SAMPLES,
        }),
      ).toThrow(/positive integer/);
    }
  });
});
