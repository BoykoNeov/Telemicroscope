import { describe, expect, it } from "vitest";
import {
  annularSource,
  apertureCarriesHarmonic,
  diskSource,
  harmonicCarryingArea,
  harmonicCarryingChord,
  harmonicSupportWeight,
  idealPupil,
} from "../src/illumination";
import { adaptiveIntegral } from "../src/math";

/**
 * § 6ab.14 — how much of the condenser carries the harmonic, which is the
 * question § 6ab.12 could only answer yes or no.
 *
 * § 6ab.12 gated the phase panel's 2ν readout on two legs that have to agree:
 * `apertureCarriesHarmonic`, closed form, asked of the aperture; and
 * `harmonicSupportWeight`, asked of the sampled source an image was actually
 * formed from. It measured that the gate is not conservative — where the sampled
 * weight is zero the rendered harmonic is f64 roundoff, where it is positive the
 * reading is thirteen orders larger — and left one thing open: whether that
 * sampled weight *converges* to anything. It could not be checked, because the
 * quantity it would converge to did not exist in the repo.
 *
 * It does now. `annularSource` and `diskSource` weight equal-area cells equally,
 * so the sampled weight is a midpoint estimate of the **area fraction** of the
 * aperture that carries the harmonic, and `harmonicCarryingArea` is that
 * fraction. Three things follow and each is a rung below:
 *
 *  - **The number § 6ab.12 compared against was not an area.** It quoted "the
 *    aperture's own 6.6%" from a scan over (ring index, angle) with equal weight
 *    per sample — which is ∫∫ dr dφ, not ∫∫ r dr dφ. The two converge to
 *    different numbers, 6.562% and 7.030%, and the second is the one the lattice
 *    is estimating. Restoring the r turns the three sampled readings from "5.6,
 *    8.8, 7.8 against 6.6" into "against 7.027".
 *  - **It converges, and not monotonically.** |sampled − exact| stays under
 *    0.55/samples ~~across 7…255~~ **at the eleven counts below** — n = 17 reads
 *    0.7373/n and was never asked, which § 6ab.17 found and corrects to 0.74/n
 *    over a ladder exhaustive to n = 121 — but a finer lattice is regularly a
 *    worse one: 31
 *    samples beats 45 by 2.8×, because what matters is which stripes of the
 *    carrying set the lattice lands on, not how many points it has.
 *  - **A new cutoff falls out of the same geometry.** Below
 *    ν* = √((1 − S²)/2) *every* direction of a brightfield condenser carries the
 *    second harmonic; above it some stop, while the harmonic itself survives to
 *    ν = 1. Closed form, sharp at ±1e-9, and it is not the cutoff anyone would
 *    guess: the binding row is neither the axis nor the rim.
 */

const PUPIL = idealPupil();
const DARK_INNER = 1.1;
const DARK_OUTER = 1.4;

/** ν = 0.75 on the panel's own grid — 12 cycles across 32 pupil samples. */
const ORDERS = { cycles: 12, pupilSamples: 32 };

/** The exact carrying fraction of A3's ring at ν = 0.75, to every digit f64 has. */
const RING_AT_075 = 0.070267681347553;

describe("§ 6ab.14 — the integrator, pinned before anything is integrated with it", () => {
  it("recovers π/4 from a square-root endpoint, and prices what one costs", () => {
    // ∫₀¹ √(1−x²) dx = π/4, and the endpoint has infinite slope — the shape an
    // aperture rim makes. The answer is never the problem: every run that
    // finishes is right to 2e-16. What a cusp costs is bisections, and it costs
    // them without limit, because the panel error falls like w^1.5 while the
    // budget each child inherits falls like w. 53 levels at 1e-13, 37 at 1e-9,
    // and no depth at all suffices if the tolerance is pushed far enough.
    const cusp = (x: number) => Math.sqrt(Math.max(0, 1 - x * x));
    expect(adaptiveIntegral(cusp, 0, 1, { tolerance: 1e-13, maxDepth: 60 })).toBeCloseTo(
      Math.PI / 4,
      15,
    );
    expect(() => adaptiveIntegral(cusp, 0, 1, { tolerance: 1e-13, maxDepth: 40 })).toThrow(
      /bisections/,
    );
    // The same integral in the variable `harmonicCarryingArea` actually uses:
    // x = sin θ turns it into ∫₀^{π/2} cos²θ dθ, which is analytic, and the pair
    // takes it in ONE panel at a tolerance the cusp form cannot reach at any
    // depth. That is the whole argument for substituting rather than refining.
    expect(
      adaptiveIntegral((theta) => Math.cos(theta) ** 2, 0, Math.PI / 2, { tolerance: 1e-15 }),
    ).toBeCloseTo(Math.PI / 4, 15);
  });

  it("is exact on degree 21, which the Gauss half alone is not", () => {
    // Kronrod 15 integrates degree 22; Gauss 7 stops at 13. A degree-21
    // monomial therefore cannot be passing on the Gauss nodes' strength:
    // ∫₀¹ x²¹ dx = 1/22.
    expect(adaptiveIntegral((x) => x ** 21, 0, 1)).toBeCloseTo(1 / 22, 14);
    expect(adaptiveIntegral((x) => x ** 21, -1, 1)).toBeCloseTo(0, 14);
  });

  it("refuses rather than returning what it reached", () => {
    // 1/√x is not integrable to a tolerance by bisection in any sane depth. The
    // failure mode this avoids is the one § 6ab.12 was about: a number returned
    // where the thing that would justify it does not exist.
    expect(() =>
      adaptiveIntegral((x) => (x <= 0 ? 0 : 1 / Math.sqrt(x)), 0, 1, {
        tolerance: 1e-14,
        maxDepth: 8,
      }),
    ).toThrow(/bisections/);
    expect(() => adaptiveIntegral((x) => x, 1, 0)).toThrow(/a <= b/);
  });
});

describe("§ 6ab.14 — the area agrees with the predicate, exactly and in both directions", () => {
  it("is zero exactly where `apertureCarriesHarmonic` says no, over 1 600 cells", () => {
    // Not "small where it says no" — zero, bit for bit, because every row's
    // carrying set is empty and the integrand is 0 at every node. That is what
    // lets a gate be built on it without a threshold, which was § 6ab.12's whole
    // finding. What it does NOT say is that positive readings stand clear of
    // zero — the fraction reaches its cutoffs continuously, so the smallest
    // positive one measures the ν grid and not the quantity: 2.9e-4 on these
    // steps of 0.01, and 6.4e-6 on steps of 1e-4 near the ring's own 0.8.
    const apertures: [number, number][] = [
      [0, 0.3],
      [0, 0.6],
      [0, 1],
      [0.5, 0.8],
      [DARK_INNER, DARK_OUTER],
      [0.9, 1.2],
      [1.05, 2],
      [0.999, 1.001],
    ];
    let smallestPositive = 1;
    let cells = 0;
    for (const [inner, outer] of apertures) {
      for (let step = 1; step <= 200; step++) {
        const nu = step / 100;
        const { fraction } = harmonicCarryingArea(inner, outer, nu);
        const carries = apertureCarriesHarmonic(inner, outer, nu);
        cells++;
        if (carries) {
          expect(fraction).toBeGreaterThan(0);
          smallestPositive = Math.min(smallestPositive, fraction);
        } else {
          expect(fraction).toBe(0);
        }
      }
    }
    expect(cells).toBe(1600);
    // Recorded, not relied on: this is the grid's number, and a finer grid finds
    // a smaller one. What it guards is the other direction from the `toBe(0)`
    // above — a near-zero area returned where the predicate says the aperture
    // DOES carry, which is what a quadrature that had started missing a thin
    // stripe would look like.
    expect(smallestPositive).toBeGreaterThan(2e-4);
    expect(harmonicCarryingArea(DARK_INNER, DARK_OUTER, 0.7999).fraction).toBeCloseTo(6.352e-6, 9);
  });

  it("gives the ν = 1 defect its number: a carrying set of exactly no area", () => {
    // § 6ab.12's second disagreement. The carrying set at ν = 1 is the single
    // axial direction — order −1 at −1 and order +1 at +1, both on the rim of a
    // CLOSED pupil — and the lattice that puts a point there read 8e-4. The area
    // is not "small enough to ignore"; it is zero, and the closed pupil is what
    // makes that a statement about area rather than about the rim test.
    expect(harmonicCarryingArea(0, 0.6, 1).area).toBe(0);
    expect(harmonicCarryingChord(0, 0.6, 1, 0)).toBe(0);
    expect(harmonicCarryingArea(0, 0.6, 1 - 1e-6).fraction).toBeGreaterThan(0);
  });

  it("thins to the darkfield cutoff instead of falling off it, now as an area", () => {
    // § 6ab.12 showed this shape with the scan; these are the areas themselves.
    // A continuous approach to zero at exactly (1 + outer)/3 = 0.8 is what says
    // the cutoff is a boundary of the geometry rather than of the question.
    const fractions = [0.25, 0.5, 0.7, 0.75, 0.79].map(
      (nu) => harmonicCarryingArea(DARK_INNER, DARK_OUTER, nu).fraction,
    );
    expect(fractions[0]!).toBeCloseTo(0.55112337, 7);
    expect(fractions[1]!).toBeCloseTo(0.44310129, 7);
    expect(fractions[2]!).toBeCloseTo(0.19657358, 7);
    expect(fractions[3]!).toBeCloseTo(RING_AT_075, 12);
    expect(fractions[4]!).toBeCloseTo(0.00633873, 7);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]!).toBeLessThan(fractions[i - 1]!);
    expect(harmonicCarryingArea(DARK_INNER, DARK_OUTER, 0.8).fraction).toBe(0);
  });

  it("and the h·ν < 2 cap is an area statement too, at every h", () => {
    // The third harmonic stops at 2/3 of the second's ceiling and nothing in the
    // code says so — it is the same "two orders h·ν apart in a pupil of diameter
    // 2" the h = 1 leg recovers Abbe from. 2/h is the ceiling over ALL apertures;
    // reaching it needs a condenser that fills the pupil, which is why the
    // positive readings below the cap are taken at S = 1 and the S = 0.6 disc
    // stops earlier — at 1 + S for h = 1, which is Abbe's law again.
    for (const harmonic of [1, 2, 3, 4]) {
      const cap = 2 / harmonic;
      expect(harmonicCarryingArea(0, 1, cap * 0.99, harmonic).fraction).toBeGreaterThan(0);
      for (const aperture of [1, 0.6, DARK_OUTER] as const) {
        expect(harmonicCarryingArea(0, aperture, cap, harmonic).fraction).toBe(0);
        expect(harmonicCarryingArea(0, aperture, cap * 1.01, harmonic).fraction).toBe(0);
      }
    }
    expect(harmonicCarryingArea(0, 0.6, 1.98, 1).fraction).toBe(0);
    expect(harmonicCarryingArea(0, 0.6, 1.59, 1).fraction).toBeGreaterThan(0);
  });

  it("and a ring's carrying row is the difference of two discs', exactly", () => {
    // Whether a direction carries depends on the direction alone — nothing in
    // the criterion knows which aperture the direction came from — so the ring's
    // carrying set has to be the outer disc's minus the inner disc's, row by row
    // and bit for bit. That is the check on the two-interval branch of
    // `harmonicCarryingChord`, which is the only part of it a disc never
    // exercises, and it is the reason a darkfield ring can be reasoned about
    // with the same intervals as a brightfield disc.
    //
    // Agreement is to rounding rather than bitwise, and the difference is worth
    // stating: the two sides add the same lengths in different orders, so they
    // are equal as reals and 1 ULP apart in f64. ν = 0.75 happens to come out
    // exact — over half its rows are empty on both sides — and ν = 0.25, where
    // the ring carries 55% and both chord intervals are working on nearly every
    // row, reads 2.2e-16. Pinning the exact case alone would have pinned the
    // coincidence.
    for (const nu of [0.25, 0.5, 0.75]) {
      let worst = 0;
      let carrying = 0;
      for (let step = 0; step <= 2000; step++) {
        const sy = (DARK_OUTER * step) / 2000;
        const ring = harmonicCarryingChord(DARK_INNER, DARK_OUTER, nu, sy);
        const discs =
          harmonicCarryingChord(0, DARK_OUTER, nu, sy) -
          harmonicCarryingChord(0, DARK_INNER, nu, sy);
        if (ring !== 0) carrying++;
        worst = Math.max(worst, Math.abs(ring - discs));
      }
      expect(carrying).toBeGreaterThan(500);
      expect(worst).toBeLessThan(4e-16);
    }
  });
});

describe("§ 6ab.14 — what the scan behind '6.6%' was measuring", () => {
  /** § 6ab.12's scan: equal weight per (ring, angle) sample. */
  function scan(nu: number, rings: number, angles: number, weightByRadius: boolean): number {
    let hit = 0;
    let total = 0;
    for (let ir = 0; ir <= rings; ir++) {
      const r = DARK_INNER + ((DARK_OUTER - DARK_INNER) * ir) / rings;
      const weight = weightByRadius ? r : 1;
      for (let ip = 0; ip < angles; ip++) {
        const phi = (2 * Math.PI * ip) / angles;
        const sx = r * Math.cos(phi);
        const sy = r * Math.sin(phi);
        total += weight;
        const span = (1 + r) / nu;
        for (let m = Math.ceil(-span) - 1; m <= Math.floor(span) + 1; m++) {
          const near = m * nu + sx;
          const far = (m + 2) * nu + sx;
          if (near * near + sy * sy <= 1 && far * far + sy * sy <= 1) {
            hit += weight;
            break;
          }
        }
      }
    }
    return hit / total;
  }

  it("converges on a different number, and it is not the one the lattice estimates", () => {
    // The scan steps uniformly in r and φ and weights every sample the same, so
    // it computes ∫∫ dr dφ over the carrying set — a fraction of DIRECTIONS
    // sampled that way, not of area. Refining it does not move it toward the
    // area: it converges, to 6.562%, and stays 4.6e-3 away from 7.027%.
    const plain = [
      scan(0.75, 120, 360, false),
      scan(0.75, 240, 720, false),
      scan(0.75, 480, 1440, false),
    ];
    expect(plain[0]!).toBeCloseTo(0.06579, 4);
    expect(plain[2]!).toBeCloseTo(0.06562, 4);
    expect(Math.abs(plain[2]! - RING_AT_075)).toBeGreaterThan(4e-3);
    // Refinement does not help, which is the evidence it is a different limit
    // and not a coarse reading of this one.
    expect(Math.abs(plain[2]! - RING_AT_075)).toBeGreaterThan(0.8 * Math.abs(plain[0]! - RING_AT_075));
  });

  it("and putting the r back makes the same scan land on the area", () => {
    // One factor of r — the Jacobian the polar scan dropped — and the same
    // samples converge to the quadrature's answer. That is the cross-check on
    // `harmonicCarryingArea` by a route that shares no code with it: no rows, no
    // intervals, no Gauss nodes, just points tested one at a time.
    const weighted = [scan(0.75, 120, 360, true), scan(0.75, 480, 1440, true)];
    expect(Math.abs(weighted[0]! - RING_AT_075)).toBeLessThan(3e-4);
    expect(Math.abs(weighted[1]! - RING_AT_075)).toBeLessThan(4e-5);
    expect(Math.abs(weighted[1]! - RING_AT_075)).toBeLessThan(
      Math.abs(weighted[0]! - RING_AT_075),
    );
  });
});

describe("§ 6ab.14 — the quadrature, checked where it is easiest to fool", () => {
  /** Midpoint over rows: it cannot miss a feature wider than its step. */
  function rowSum(inner: number, outer: number, nu: number, harmonic: number, rows: number) {
    const step = outer / rows;
    let sum = 0;
    for (let i = 0; i < rows; i++) {
      sum += harmonicCarryingChord(inner, outer, nu, (i + 0.5) * step, harmonic);
    }
    return (2 * sum * step) / (Math.PI * (outer * outer - inner * inner));
  }

  it("matches a brute-force row sum on the aperture that hides a stripe", () => {
    // A 0.999–1.001 ring is nearly a circle of directions, so its carrying set
    // is a few very narrow bands in s_y. Splitting only at the four rows a
    // reader would name leaves a panel straddling one of them, the fifteen
    // Kronrod nodes all miss it, the pair AGREES on the value they have both
    // missed, and the answer comes back 0.11700 against a true 0.11656 with
    // every sign of having converged. Splitting at the crossings instead is why
    // this passes — see `carryingRowEdges`.
    for (const [inner, outer, nu, harmonic] of [
      [0.999, 1.001, 0.933433, 2],
      [0.999, 1.001, 0.622322, 3],
      [DARK_INNER, DARK_OUTER, 0.75, 2],
      [0, 0.9, 0.75, 2],
      [0.5, 0.8, 0.4, 3],
    ] as [number, number, number, number][]) {
      const quadrature = harmonicCarryingArea(inner, outer, nu, harmonic).fraction;
      expect(quadrature).toBeCloseTo(rowSum(inner, outer, nu, harmonic, 200_000), 6);
    }
  });

  it("reproduces the aperture's own area wherever the whole aperture carries", () => {
    // The one value in the integrand's range with a closed form of its own: when
    // every row carries its whole chord, the integral IS π(outer² − inner²), so
    // this is the quadrature pinned against a number that owes it nothing.
    for (const [inner, outer, nu] of [
      [0, 0.6, 0.3],
      [0, 0.2, 0.5],
      [0.3, 0.5, 0.4],
    ] as [number, number, number][]) {
      const { area, fraction } = harmonicCarryingArea(inner, outer, nu);
      expect(area).toBeCloseTo(Math.PI * (outer * outer - inner * inner), 12);
      expect(fraction).toBeCloseTo(1, 12);
    }
  });
});

describe("§ 6ab.14 — ν* = √((1 − S²)/2), where a condenser stops carrying with all of itself", () => {
  /**
   * The row where full coverage fails first, from the interval picture.
   *
   * A row carries its whole chord two ways: the intervals close their gaps
   * (2R ≥ (h+1)·ν), which binds hardest at the *outermost* row where R is
   * smallest; or, for EVEN h only, the one interval centred on the axis already
   * covers the chord (c ≤ R − h·ν/2), which binds hardest at the axis. The two
   * pull in opposite directions across the aperture, so the binding row is where
   * they cross — an interior row, which is why the answer is neither 1 − S nor
   * √(1 − S²).
   */
  function bindingRow(S: number, harmonic: number): { nu: number; sy: number } {
    const gapless = (2 / (harmonic + 1)) * Math.sqrt(1 - S * S);
    if (harmonic % 2 === 1) return { nu: gapless, sy: S };
    const ratio = (harmonic - 1) / (harmonic + 1);
    const crossing = (S * S - ratio * ratio) / (1 - ratio * ratio);
    if (!(crossing > 0)) return { nu: (2 * (1 - S)) / harmonic, sy: 0 };
    return { nu: (2 / (harmonic + 1)) * Math.sqrt(1 - crossing), sy: Math.sqrt(crossing) };
  }

  it("flips at ±1e-9 on the row the closed form names, at h = 2", () => {
    for (const S of [0.2, 1 / 3, 0.5, 0.6, 0.9]) {
      const { nu, sy } = bindingRow(S, 2);
      // Above S = 1/3 it is √((1 − S²)/2); below, the axial branch takes over at
      // 1 − S, and the two agree exactly at S = 1/3.
      if (S > 1 / 3) expect(nu).toBeCloseTo(Math.sqrt((1 - S * S) / 2), 12);
      if (S < 1 / 3) expect(nu).toBeCloseTo(1 - S, 12);
      const chord = 2 * Math.sqrt(S * S - sy * sy);
      expect(harmonicCarryingChord(0, S, nu - 1e-9, sy)).toBeCloseTo(chord, 12);
      expect(harmonicCarryingChord(0, S, nu + 1e-9, sy)).toBeLessThan(chord - 1e-11);
    }
  });

  it("and the aperture is full below it — the harmonic outlives the coverage", () => {
    // At S = 0.6 every direction carries 2ν out to ν = 0.5657, and 2ν itself
    // survives to ν = 1. Between the two the condenser is imaging the harmonic
    // with a shrinking part of itself, which is the regime where a sampled
    // lattice starts to matter and where the panel's own slider spends most of
    // its travel.
    for (const S of [0.4, 0.6, 0.9]) {
      const { nu } = bindingRow(S, 2);
      expect(harmonicCarryingArea(0, S, nu - 1e-6).fraction).toBeCloseTo(1, 11);
      expect(harmonicCarryingArea(0, S, 0.999).fraction).toBeGreaterThan(0);
      expect(harmonicCarryingArea(0, S, 0.999).fraction).toBeLessThan(0.5);
    }
  });

  it("loses its second branch at odd h, where no interval sits on the axis", () => {
    // For odd h the intervals are centred on half-integer multiples of ν, so
    // nothing covers the axis outright and only the gap-closing branch is left:
    // ν* = 2√(1 − S²)/(h + 1), binding at the rim. Checked at h = 1 and 3, the
    // same ±1e-9.
    for (const harmonic of [1, 3]) {
      for (const S of [0.2, 0.5, 0.8]) {
        const { nu, sy } = bindingRow(S, harmonic);
        expect(nu).toBeCloseTo((2 * Math.sqrt(1 - S * S)) / (harmonic + 1), 12);
        expect(sy).toBe(S);
        // The binding row is the rim, where the chord shrinks to a point, so the
        // flip is not readable on one row — it is read on the area instead, and
        // the aperture leaves 1 the moment ν passes ν*.
        expect(harmonicCarryingArea(0, S, nu - 1e-6, harmonic).fraction).toBeCloseTo(1, 11);
        expect(harmonicCarryingArea(0, S, nu + 1e-4, harmonic).fraction).toBeLessThan(1 - 1e-9);
      }
    }
  });
});

describe("§ 6ab.14 — the open item: does the sampled weight converge to it", () => {
  const ring = (samples: number) => annularSource(DARK_OUTER, DARK_INNER, samples);
  const COUNTS = [7, 11, 15, 21, 31, 45, 65, 91, 127, 181, 255];

  it("restates § 6ab.12's three readings against the reference they were missing", () => {
    // 2 of 36, 6 of 68, 10 of 128 — the same three numbers, now with something
    // to be wrong about. Against 6.6% they read −16%, +34%, +19%; against the
    // area they are estimating they read −21%, +26%, +11%, and the finest is the
    // closest, which the old comparison did not show.
    const errors = [11, 15, 21].map(
      (samples) => harmonicSupportWeight(PUPIL, ring(samples), ORDERS) / RING_AT_075 - 1,
    );
    expect(errors[0]!).toBeCloseTo(-0.2094, 3);
    expect(errors[1]!).toBeCloseTo(0.2557, 3);
    expect(errors[2]!).toBeCloseTo(0.1119, 3);
    expect(Math.abs(errors[2]!)).toBeLessThan(Math.abs(errors[1]!));
  });

  it("converges, under 0.55/samples at these eleven counts and on a disc as well", () => {
    // The quadrature statement § 6ab.12 wanted. It is a bound and not a rate:
    // the observed decay is faster than 1/n over this range, but not steadily
    // enough for a rate to be the honest claim.
    //
    // **This rung's title used to say "across 7…255" and § 6ab.17 found that
    // false.** ELEVEN counts are not a range: the ring at n = 17 — which is not
    // one of them — reads 0.7373/n, 34% past this constant. What survives is the
    // statement about these eleven, which is what is asserted here; the bound
    // over a ladder exhaustive to n = 121 is 0.74/n, in § 6ab.17's block below.
    for (const samples of COUNTS) {
      const sampled = harmonicSupportWeight(PUPIL, ring(samples), ORDERS);
      expect(Math.abs(sampled - RING_AT_075) * samples).toBeLessThan(0.55);
    }
    const disc = harmonicCarryingArea(0, 0.9, 0.75).fraction;
    expect(disc).toBeCloseTo(0.427757583792, 11);
    for (const samples of COUNTS) {
      const sampled = harmonicSupportWeight(PUPIL, diskSource(0.9, samples), ORDERS);
      expect(Math.abs(sampled - disc) * samples).toBeLessThan(0.55);
    }
  });

  it("but not monotonically — a finer lattice is regularly a worse one", () => {
    // 31 samples reads 7.246% and 45 reads 6.410%: half again as many points and
    // 2.8× the error. What sets the reading is which stripes of the carrying set
    // the lattice lands on, and that is not improved by adding points, only on
    // average. Anyone reading "more samples" as "more accurate" here is wrong in
    // a way no tolerance would have caught.
    const errors = COUNTS.map((samples) =>
      Math.abs(harmonicSupportWeight(PUPIL, ring(samples), ORDERS) - RING_AT_075),
    );
    const regressions = errors.filter((error, i) => i > 0 && error > errors[i - 1]!);
    expect(regressions.length).toBeGreaterThanOrEqual(2);
    const at31 = errors[COUNTS.indexOf(31)]!;
    const at45 = errors[COUNTS.indexOf(45)]!;
    expect(at45 / at31).toBeGreaterThan(2.5);
  });

  it("and the 7-sample ring's zero is the bound's own extreme", () => {
    // § 6ab.12's headline cell: 16 points, none of them in the carrying set, so
    // the weight is exactly 0 and the error is the whole 7.027%. That is 0.49 of
    // the 0.55 budget — the bound is set by the case the gate exists to catch,
    // not by the asymptotics.
    expect(harmonicSupportWeight(PUPIL, ring(7), ORDERS)).toBe(0);
    expect(RING_AT_075 * 7).toBeCloseTo(0.4919, 3);
  });
});

/**
 * § 6ab.17 — "whether the bound is a rate", which § 6ab.14 left open, and the
 * first thing the wider measurement finds is that the bound is not the bound.
 *
 * § 6ab.14 wrote: "Across 7…255 samples on the ring and on an S = 0.9 disc,
 * |sampled − exact| stays below 0.55/samples." It was checked at **eleven**
 * counts. Asked at every integer from 7 to 121, the ring at **n = 17** reads
 * `0.7373/n` — 34% past the constant, on a lattice one point coarser than the
 * 21 the panel's own control offers. Eleven samples of a range is not a claim
 * about the range, and this is the second time in § 6ab that a number outlived
 * what it was measured on (§ 6ab.15's ν = 1 exclusion was the first).
 *
 * **So this block states its own quantifier carefully.** The ladder is every
 * integer 7…121, odd counts to 255, and every twentieth to 801 — because the
 * cost is n² and because every binding case measured falls inside the exhaustive
 * window: the q = 1 maxima are at n = 17, 7 and 17, and the q = 4/3 maxima at
 * n = 17, 26 and 108. Above 121 the quantity is falling and the ladder is a
 * sample, which is what the rungs below say.
 *
 * ## What the answer to "is it a rate" actually is
 *
 * **n^{-4/3} is an envelope over the measured range and n^{-3/2} is not**, and
 * the test that separates them needs no theorem: if the error decayed like
 * n^{-p}, then e·n^q is larger at the *bottom* of the range than at the top when
 * q < p, and larger at the top when q > p. Comparing sup e·n^q over n ≤ 121
 * against sup over n ≥ 200, in three cells:
 *
 *     q = 1     tail/head = 0.338, 0.287, 0.314   — well below 1
 *     q = 4/3   tail/head = 0.807, 0.736, 0.630   — below 1 in all three
 *     q = 3/2   tail/head = 1.246, 1.033, 0.727   — at or above 1 in two
 *
 * So the exponent is **between 4/3 and 3/2 and is not one number across
 * apertures**, which is why the deliverable is a measured envelope and not a
 * rate. That is not a gap this file can close by measuring further: what the
 * quantity *is* is a lattice count inside a region bounded by circular arcs, and
 * the exponent for those is the Gauss-circle family, where the proven and the
 * conjectured bounds differ and the truth is a famous open question. Recorded as
 * the reason to stop, not as a pin — nothing below is anchored on it.
 */
describe("§ 6ab.17 — the 0.55 was eleven counts, and the envelope is n^{-4/3}", () => {
  const COUNTS = [7, 11, 15, 21, 31, 45, 65, 91, 127, 181, 255];

  /** Exhaustive where every binding case falls, thinning where the cost is n²
   *  and the quantity is on its way down. ~3 s for all three cells. */
  const LADDER: number[] = (() => {
    const ns: number[] = [];
    for (let n = 7; n <= 121; n++) ns.push(n);
    for (let n = 123; n <= 255; n += 2) ns.push(n);
    for (let n = 261; n <= 801; n += 20) ns.push(n);
    return ns;
  })();

  /** The window the ladder asks exhaustively, and the tail it samples. */
  const EXHAUSTIVE_TO = 121;

  /** Three apertures at two ν, so an envelope is not one aperture's habit. The
   *  third is a genuinely PARTIAL disc at a different ν — § 6ab.14's two are both
   *  at ν = 0.75, and a disc below ν* = √((1−S²)/2) carries everywhere and would
   *  be exact for a reason that has nothing to do with quadrature. */
  const CELLS = [
    {
      label: "ring 1.1–1.4, ν = 0.75",
      source: (n: number) => annularSource(DARK_OUTER, DARK_INNER, n),
      orders: ORDERS,
      exact: RING_AT_075,
    },
    {
      label: "disc S = 0.9, ν = 0.75",
      source: (n: number) => diskSource(0.9, n),
      orders: ORDERS,
      exact: harmonicCarryingArea(0, 0.9, 0.75).fraction,
    },
    {
      label: "disc S = 0.5, ν = 0.875",
      source: (n: number) => diskSource(0.5, n),
      orders: { cycles: 14, pupilSamples: 32 },
      exact: harmonicCarryingArea(0, 0.5, 0.875).fraction,
    },
  ];

  /** |sampled − exact| at every count on the ladder, for one cell. */
  function errors(cell: (typeof CELLS)[number]): { n: number; e: number }[] {
    return LADDER.map((n) => ({
      n,
      e: Math.abs(harmonicSupportWeight(PUPIL, cell.source(n), cell.orders) - cell.exact),
    }));
  }

  /** sup e·n^q over a subset of the ladder. */
  function sup(rows: { n: number; e: number }[], q: number): number {
    return rows.reduce((a, r) => Math.max(a, r.e * r.n ** q), 0);
  }

  /** Where e·n^q is largest. */
  function peak(rows: { n: number; e: number }[], q: number): number {
    return rows.reduce((a, r) => (r.e * r.n ** q > a.e * a.n ** q ? r : a)).n;
  }

  const measured = CELLS.map((cell) => ({ cell, rows: errors(cell) }));

  it("is broken at n = 17, which § 6ab.14 never asked", () => {
    // The ring one point coarser than the panel's 21. 0.7373 against 0.55, and
    // the eleven counts' own worst is 0.4919 at n = 7 — so the constant was not
    // conservative, it was measured on a set that missed its own maximum.
    const ring = measured[0]!.rows;
    const at17 = ring.find((r) => r.n === 17)!;
    expect(at17.e * 17).toBeGreaterThan(0.55);
    expect(at17.e * 17).toBeCloseTo(0.7373, 4);
    // And the counts § 6ab.14 did ask all still pass, so nothing there was wrong
    // except the range the sentence claimed.
    for (const n of COUNTS) {
      const row = ring.find((r) => r.n === n)!;
      expect(row.e * n, `n = ${n}`).toBeLessThan(0.55);
    }
  });

  it("holds at 0.74/samples over this ladder, in all three cells", () => {
    // Measured sups: 0.7373 at n = 17 (ring), 0.5348 at n = 7 (S = 0.9 disc),
    // 0.4653 at n = 17 (S = 0.5 disc). **0.74 is the ring's own maximum rounded
    // up in the fourth digit — a 0.36% margin, not a conservative constant** —
    // and all three maxima are inside the window the ladder asks exhaustively,
    // which is the part § 6ab.14's own sentence did not have.
    for (const { cell, rows } of measured) {
      expect(sup(rows, 1), cell.label).toBeLessThan(0.74);
      expect(peak(rows, 1), cell.label).toBeLessThanOrEqual(EXHAUSTIVE_TO);
    }
    expect(peak(measured[0]!.rows, 1)).toBe(17);
  });

  it("and is loose past n ≈ 30 — five times loose by the top of the range", () => {
    // What kills "1/n is the rate": the same quantity that reaches 0.74 at n = 17
    // is under 0.14 for every n ≥ 401 on the ladder. A bound whose slack grows
    // with n is not a description of the decay.
    for (const { cell, rows } of measured) {
      const tail = rows.filter((r) => r.n >= 401);
      expect(tail.length).toBeGreaterThan(15);
      const worst = sup(tail, 1);
      expect(worst, cell.label).toBeLessThan(0.14);
      expect(sup(rows, 1) / worst, cell.label).toBeGreaterThan(4);
    }
  });

  it("has n^{4/3} smaller at the TOP of the range than at the bottom, in every cell", () => {
    // The exponent test: e·n^q falls across the range when q is below the true
    // decay. Measured tail/head at q = 4/3: 0.807, 0.736, 0.630 — and the sup
    // itself stays under 1.9 (1.896 at n = 17 on the ring).
    for (const { cell, rows } of measured) {
      const head = rows.filter((r) => r.n <= EXHAUSTIVE_TO);
      const tail = rows.filter((r) => r.n >= 200);
      expect(sup(rows, 4 / 3), cell.label).toBeLessThan(1.9);
      expect(sup(tail, 4 / 3) / sup(head, 4 / 3), cell.label).toBeLessThan(1);
      // And q = 1, the same test on § 6ab.14's own exponent, is emphatic: 0.338,
      // 0.287, 0.314 — which is the same fact as "loose past n ≈ 30" above,
      // stated in the form the exponent question needs.
      expect(sup(tail, 1) / sup(head, 1), cell.label).toBeLessThan(0.5);
    }
  });

  it("NEGATIVE CONTROL: n^{3/2} is NOT smaller at the top, so it is not an envelope", () => {
    // The same comparison at q = 3/2 gives 1.246, 1.033 and 0.727: the tail is at
    // or above the head in the two ν = 0.75 cells. An exponent whose e·n^q grows
    // across the range is above the true decay, so 3/2 over-corrects — and the
    // third cell, where it does not, is why the honest statement is a BRACKET
    // rather than an exponent. The decay is between n^{-4/3} and n^{-3/2} and it
    // is not the same in every aperture.
    const ratios = measured.map(({ rows }) => {
      const head = rows.filter((r) => r.n <= EXHAUSTIVE_TO);
      const tail = rows.filter((r) => r.n >= 200);
      return sup(tail, 1.5) / sup(head, 1.5);
    });
    expect(ratios.filter((r) => r >= 1)).toHaveLength(2);
    expect(ratios.filter((r) => r < 1)).toHaveLength(1);
  });

  it("has an exact zero to be an envelope of, which is what makes the sup meaningful", () => {
    // § 6ab.14's own guarantee, restated as this block's precondition: where no
    // row carries, every integrand evaluation is exactly 0 and so is the sampled
    // weight, so none of the errors above is a difference of two approximations.
    //
    // An S = 0.3 disc at ν = 1.0625, past the disc's own 2/h = 1: no direction it
    // holds gets both ±1 orders through, so nothing carries 2ν at all.
    const beyond = { cycles: 17, pupilSamples: 32 };
    expect(apertureCarriesHarmonic(0, 0.3, 1.0625)).toBe(false);
    expect(harmonicCarryingArea(0, 0.3, 1.0625).fraction).toBe(0);
    for (const n of [7, 17, 45, 255]) {
      expect(harmonicSupportWeight(PUPIL, diskSource(0.3, n), beyond), `n = ${n}`).toBe(0);
    }
  });
});
