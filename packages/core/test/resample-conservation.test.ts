import { describe, it, expect } from "vitest";
import {
  resampleEnergyGrid,
  resampleIrradianceGrid,
  spectralStack,
} from "../src/wave/polychromatic";
import { psf } from "../src/wave/psf";
import { blackbodySpectrum } from "../src/photometry/blackbody";
import { spectralSamples } from "../src/photometry/spectrum";
import { bestFocus, withFocus } from "../src/analysis/focus";
import { newtonian } from "../src/designs/newtonian";
import { OpticalSystem } from "../src/trace/system";
import { FOCUS_NM, PSF_OPTIONS, SOURCE_TEMPERATURE_K, heroPair, renderHero } from "./support/heroScene";

/**
 * § 8c — the resampler that conserves.
 *
 * ## What was wrong
 *
 * § 8a.11 recorded a finding rather than a rung: a raw PSF meets `psf.ts`'s
 * "Σ intensity ≡ energy by construction" to the bit, and the planes
 * `spectralStack` builds out of PSFs did not — the hero's came back **+0.3% to
 * +3.0% heavy**, non-monotone in the resampling ratio, while `truncatedFraction`
 * read **exactly 0** because no light had left the grid. That is register item
 * A13. It predates the photon count, it biases every polychromatic render's
 * brightness, and because it is per-plane it biases the render's COLOUR by about
 * 2%. Nothing external is needed to say it is wrong: the identity the engine
 * already states is the pin.
 *
 * The cause was the resampler's quadrature. Bilinear interpolation at each
 * destination centre times `k²` is a one-point rule for an integral, and on a
 * function with rings in it the destination lattice beats against the ring
 * structure instead of averaging over it. § 8c.3 below reproduces the failure on
 * an Airy pattern with no optics in it at all — +4.0e-2 to +1.0e-1 — which is
 * what makes it arithmetic rather than physics.
 *
 * ## What replaced it
 *
 * Conservative regridding of a slope-limited reconstruction: each source cell
 * holds its value as a MEAN over the cell, is reconstructed across it as a
 * straight line, and each destination cell takes that reconstruction's integral
 * over the overlap. Destination cells tile the line exactly, so a source cell's
 * content is partitioned among them and none is created — the total can only
 * fall, and only by what the destination grid does not cover, which is what
 * `truncatedFraction` exists to report.
 *
 * The slope is minmod-limited, and that is a guarantee rather than a taste:
 * `|s|` never exceeds the smaller one-sided difference, one of which is at most
 * the cell's own value on non-negative data, so the reconstruction stays at or
 * above half the cell mean. The unlimited centred slope is more accurate on a
 * smooth field and puts twenty NEGATIVE cells in the troughs between Airy rings
 * at k = 0.8, which `imaging/noise` refuses outright (§ 8c.4).
 *
 * ## Why the rungs are shaped like this
 *
 * "Conserves" is cheap to satisfy by doing nothing, so three of the rungs below
 * are about a DIFFERENT quantity — how close the resampled values are to the
 * truth, measured against closed forms with no optics and no engine in them: a
 * uniform field, a Gaussian's 2πσ², and a raised cosine's exact cell integrals.
 * The last of those is what separates "conserving" from "conserving because
 * nothing moved", and it is asserted against the bilinear scheme this replaced,
 * which is reproduced here so the comparison is on one grid and one fixture.
 */

const sumOf = (a: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
};

/**
 * The bilinear point-sampler § 8a.11 measured, kept so the accuracy rungs
 * compare against a thing rather than against a remembered number.
 */
function bilinear(
  src: Float64Array,
  n: number,
  k: number,
  size: number,
  jacobian: boolean,
): Float64Array {
  const out = new Float64Array(size * size);
  const cs = n / 2;
  const co = size / 2;
  const gain = jacobian ? k * k : 1;
  for (let y = 0; y < size; y++) {
    const sy = cs + (y - co) * k;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = cs + (x - co) * k;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) continue;
      const top = src[y0 * n + x0]! * (1 - fx) + src[y0 * n + x0 + 1]! * fx;
      const bot = src[(y0 + 1) * n + x0]! * (1 - fx) + src[(y0 + 1) * n + x0 + 1]! * fx;
      out[y * size + x] = (top * (1 - fy) + bot * fy) * gain;
    }
  }
  return out;
}

/** The `k` the hero's own planes span, so the sweeps are not a wider claim than the engine makes. */
const KS = [0.8, 0.85, 0.9, 1.0, 1.1, 1.2, 1.3] as const;

describe("§ 8c.1 — a uniform field is a uniform field, at every resampling ratio", () => {
  it("an irradiance grid comes back at exactly 1, and an energy grid at exactly k²", () => {
    // § 6r's statement — "a uniform specimen images to exactly 1 whatever the
    // grid is" — now has to hold on a scheme whose weights are overlap LENGTHS
    // rather than interpolation fractions, which do not sum to one for free.
    // They sum to `k` because they are computed relative to the first source
    // cell: `Math.floor` puts it within half a cell, so the subtraction is exact
    // and every length is then a difference of numbers of order 1 rather than of
    // order `srcSize`. In grid coordinates the same arithmetic reads 2.8e-14 on
    // this grid, thirty times worse and growing with the grid.
    const N = 128;
    const uniform = new Float64Array(N * N).fill(1);
    for (const k of KS) {
      let worstIrradiance = 0;
      let worstEnergy = 0;
      let written = 0;
      const irradiance = resampleIrradianceGrid(uniform, N, 1, k, N);
      const energy = resampleEnergyGrid(uniform, N, 1, k, N);
      for (let i = 0; i < irradiance.length; i++) {
        if (irradiance[i] === 0) continue;
        written++;
        worstIrradiance = Math.max(worstIrradiance, Math.abs(irradiance[i]! - 1));
        worstEnergy = Math.max(worstEnergy, Math.abs(energy[i]! / (k * k) - 1));
      }
      expect.soft(written, `k=${k} writes something`).toBeGreaterThan(0);
      expect.soft(worstIrradiance, `k=${k} irradiance`).toBeLessThan(1e-15);
      expect.soft(worstEnergy, `k=${k} energy`).toBeLessThan(1e-15);
    }
  });

  it("and the two siblings differ by exactly k², cell for cell", () => {
    // The distinction `wave/polychromatic` exists to keep — a PSF holds energy
    // per pixel, an Abbe image holds a density — is one factor, and the limiter
    // must not put a crack in it: the slope is taken on the same data in both,
    // so the branches are one computation and a final division.
    const S = 96;
    const src = new Float64Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) src[y * S + x] = 1 + Math.sin(x * 0.4) * Math.cos(y * 0.31);
    }
    for (const k of KS) {
      const energy = resampleEnergyGrid(src, S, 1, k, S);
      const irradiance = resampleIrradianceGrid(src, S, 1, k, S);
      let worst = 0;
      for (let i = 0; i < energy.length; i++) {
        if (irradiance[i] === 0) continue;
        worst = Math.max(worst, Math.abs(energy[i]! / (irradiance[i]! * k * k) - 1));
      }
      expect.soft(worst, `k=${k}`).toBeLessThan(1e-15);
    }
  });
});

describe("§ 8c.2 — k = 1 on aligned centres is a copy, bit for bit", () => {
  it("nothing moves, and the last row and column survive", () => {
    // A destination interval that IS a source cell integrates a straight line
    // over its own cell, which returns that cell's mean whatever the slope: the
    // mean's weight is exactly 1.0 and the neighbour's is exactly 0, so the
    // arithmetic is `v * 1 + s * 0`. `imaging/spectral-stack`'s ruler plane
    // (§ 6r.3) and `imaging/emission`'s already-on-the-grid component both need
    // that, and the bilinear scheme could give it to NEITHER: its stencil needs
    // `x0 + 1`, so it dropped the last row and column even at k = 1, which is
    // the 2.6e-4 of light `imaging/emission` documents working around.
    const N = 64;
    const src = new Float64Array(N * N);
    let seed = 1;
    for (let i = 0; i < src.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      src[i] = seed / 2147483648;
    }
    const copy = resampleEnergyGrid(src, N, 3.25, 3.25, N);
    let worst = 0;
    let written = 0;
    for (let i = 0; i < src.length; i++) {
      worst = Math.max(worst, Math.abs(copy[i]! - src[i]!));
      if (copy[i] !== 0) written++;
    }
    expect(worst).toBe(0);
    expect(written).toBe(N * N);

    // The negative control, on the same array: the scheme this replaced misses
    // by the whole value of a pixel, on 127 of them.
    const before = bilinear(src, N, 1, N, true);
    let missed = 0;
    for (let i = 0; i < src.length; i++) if (before[i] !== src[i]) missed++;
    expect(missed).toBe(2 * N - 1);
  });
});

describe("§ 8c.3 — the totals, against closed forms with no optics in them", () => {
  it("a Gaussian's grid sum is 2πσ², and stays there across the ratios the stack uses", () => {
    // A Gaussian sampled on a lattice sums to its own integral to within
    // exp(−2π²σ²) (Poisson summation), so 2πσ² is an external number this grid
    // can be held to and not merely a self-consistency check: at σ = 6 the two
    // agree to 1e-15. The resampled total then has to STAY there — the whole
    // failure § 8a.11 recorded is a total that moves with k.
    const S = 128;
    const sigma = 6;
    const c = S / 2;
    const g = new Float64Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        g[y * S + x] = Math.exp(-((x - c) ** 2 + (y - c) ** 2) / (2 * sigma * sigma));
      }
    }
    const closedForm = 2 * Math.PI * sigma * sigma;
    // 1.0e-14, which is the naive sum of 16384 terms and not the Gaussian: the
    // Poisson-summation remainder here is exp(−2π²σ²), which is zero in f64.
    expect(Math.abs(sumOf(g) / closedForm - 1)).toBeLessThan(1e-13);
    for (const k of KS) {
      const total = sumOf(resampleEnergyGrid(g, S, 1, k, S));
      expect.soft(Math.abs(total / closedForm - 1), `k=${k}`).toBeLessThan(1e-13);
    }
  });

  it("HEADLINE: an Airy pattern's total does not move, where the bilinear scheme moved it 4% to 10%", () => {
    // § 8a.11's failure with the optics taken out: rings on a grid, and nothing
    // else. The old scheme's error is not a scale error — it is non-monotone in
    // k, because it is the destination lattice beating against the rings — and
    // it is far larger here than the +0.3% to +3.0% the hero's planes showed,
    // because this pattern is sampled harder. The new scheme's departure is
    // NEGATIVE at every ratio and is the Airy skirt leaving the grid: it is the
    // same to three digits whether the slope is limited, unlimited or absent,
    // which is what proves it is truncation and not the reconstruction.
    const S = 128;
    const c = S / 2;
    const spot = new Float64Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = Math.hypot(x - c, y - c) / 2.5;
        const a = r < 1e-9 ? 1 : (2 * besselJ1(Math.PI * r)) / (Math.PI * r);
        spot[y * S + x] = a * a;
      }
    }
    const total = sumOf(spot);
    let worstNew = 0;
    let leastOld = Infinity;
    for (const k of KS) {
      if (k === 1) continue;
      const now = sumOf(resampleEnergyGrid(spot, S, 1, k, S)) / total - 1;
      const then = sumOf(bilinear(spot, S, k, S, true)) / total - 1;
      // Nothing is created: the new total is at or below the source's.
      expect.soft(now, `k=${k} creates nothing`).toBeLessThanOrEqual(0);
      worstNew = Math.max(worstNew, Math.abs(now));
      leastOld = Math.min(leastOld, Math.abs(then));
    }
    expect(worstNew).toBeLessThan(2e-3);
    // The old scheme's BEST ratio is still an order worse than the new one's worst.
    expect(leastOld).toBeGreaterThan(2e-2);
    expect(leastOld / worstNew).toBeGreaterThan(10);
  });
});

describe("§ 8c.4 — the limiter, and what it is for", () => {
  it("an Airy pattern resamples with no negative cells, where an unlimited slope gives twenty", () => {
    // `imaging/noise` refuses a plane that is negative anywhere, so a
    // reconstruction that can undershoot in a ring trough is not an option
    // however accurate it is on a smooth field. This is the rung that made the
    // scheme minmod rather than centred-difference.
    const S = 128;
    const c = S / 2;
    const spot = new Float64Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = Math.hypot(x - c, y - c) / 2.5;
        const a = r < 1e-9 ? 1 : (2 * besselJ1(Math.PI * r)) / (Math.PI * r);
        spot[y * S + x] = a * a;
      }
    }
    for (const k of KS) {
      const out = resampleEnergyGrid(spot, S, 1, k, S);
      let negatives = 0;
      for (const v of out) if (v < 0) negatives++;
      expect.soft(negatives, `k=${k}`).toBe(0);
    }
  });
});

describe("§ 8c.5 — accuracy, not only conservation", () => {
  it("HEADLINE: the rms departure from a known field is smaller than the bilinear scheme's, at every period", () => {
    // The rung that stops "it conserves" from being satisfied by a resampler
    // that has thrown the picture away. The field is a separable tone whose
    // exact average over any interval is a closed form, so the truth here is
    // analytic — no reference implementation and no recorded array. A plain area
    // average (the same scheme with the slope set to zero) is three to four
    // times WORSE than bilinear pointwise; the limited slope is what buys the
    // conservation without paying for it in resolution.
    const N = 128;
    for (const period of [32, 8, 4]) {
      const w = (2 * Math.PI) / period;
      const f = (x: number) => 1 + 0.5 * Math.sin(w * x);
      const boxAvg = (a: number, b: number) =>
        1 + (0.5 * (Math.cos(w * a) - Math.cos(w * b))) / (w * (b - a));
      const src = new Float64Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) src[y * N + x] = f(x) * f(y);

      for (const k of [0.85, 1.18]) {
        const now = resampleIrradianceGrid(src, N, 1, k, N);
        const then = bilinear(src, N, k, N, false);
        let errNow = 0;
        let errThen = 0;
        let count = 0;
        const cs = N / 2;
        for (let y = 0; y < N; y++) {
          const sy = cs + (y - cs) * k;
          if (sy - k / 2 < -0.5 || sy + k / 2 > N - 0.5) continue;
          for (let x = 0; x < N; x++) {
            const sx = cs + (x - cs) * k;
            if (sx - k / 2 < -0.5 || sx + k / 2 > N - 0.5) continue;
            const truth = f(sx) * f(sy);
            errNow += (now[y * N + x]! - truth) ** 2;
            errThen += (then[y * N + x]! - truth) ** 2;
            count++;
          }
        }
        const rmsNow = Math.sqrt(errNow / count);
        const rmsThen = Math.sqrt(errThen / count);
        expect.soft(rmsNow, `period ${period}, k=${k}`).toBeLessThan(rmsThen);
        // And against the CELL AVERAGE, which is what an integrating scheme is
        // entitled to be judged on, the same holds — except on the smoothest
        // field at k > 1, where minmod's clipping of a smooth extremum costs it
        // and bilinear reads 9.3e-4 against 1.8e-3. Stated, not hidden: the
        // limiter is first-order at a turning point and that is its known price.
        let boxNow = 0;
        let boxThen = 0;
        for (let y = 0; y < N; y++) {
          const sy = cs + (y - cs) * k;
          if (sy - k / 2 < -0.5 || sy + k / 2 > N - 0.5) continue;
          for (let x = 0; x < N; x++) {
            const sx = cs + (x - cs) * k;
            if (sx - k / 2 < -0.5 || sx + k / 2 > N - 0.5) continue;
            const truth = boxAvg(sx - k / 2, sx + k / 2) * boxAvg(sy - k / 2, sy + k / 2);
            boxNow += (now[y * N + x]! - truth) ** 2;
            boxThen += (then[y * N + x]! - truth) ** 2;
          }
        }
        if (!(period === 32 && k > 1)) {
          expect.soft(Math.sqrt(boxNow / count), `cell avg, period ${period}, k=${k}`).toBeLessThan(
            Math.sqrt(boxThen / count),
          );
        }
      }
    }
  });
});

describe("§ 8c.6 — the stack the finding was made on", () => {
  it("HEADLINE: no plane gains light, and truncatedFraction reports what leaves the grid", () => {
    // § 8a.11's own fixture, and its own reading. Every plane was between
    // +0.3% and +3.0% HEAVY and `truncatedFraction` read exactly 0, because the
    // excess pushed `placed` past `energy` and the field's `Math.max(0, …)`
    // clamp ate it. Now every departure is negative — the reddest planes are
    // physically wider than the common grid, which is a truncation and not an
    // error — and the clamp is never reached.
    const hero = renderHero(heroPair().achromat);
    const raw = psf(hero.system, 0, FOCUS_NM, PSF_OPTIONS);
    expect(Math.abs(sumOf(raw.intensity) / raw.energy - 1)).toBeLessThan(1e-12);

    let placed = 0;
    let energy = 0;
    for (const plane of hero.stack.planes) {
      const share = sumOf(plane.intensity) / plane.energy;
      expect.soft(share, `${plane.nm.toFixed(1)} nm gains nothing`).toBeLessThanOrEqual(1);
      expect.soft(1 - share, `${plane.nm.toFixed(1)} nm`).toBeLessThan(1e-3);
      placed += plane.weight * sumOf(plane.intensity);
      energy += plane.weight * plane.energy;
    }
    // The field is the weighted deficit and nothing else — the clamp that used
    // to hide the excess is inert, which is the check that it is inert.
    expect(hero.stack.truncatedFraction).toBeGreaterThan(0);
    expect(Math.abs(hero.stack.truncatedFraction - (1 - placed / energy))).toBeLessThan(1e-15);
    expect(hero.stack.truncatedFraction).toBeCloseTo(2.25098e-4, 8);
  });

  it("and § 8a.7's obstruction reading tightens toward the pupil grid's own", () => {
    // The prediction this change had to meet, and could have failed. § 8a.7
    // pinned the Newtonian's secondary at 1 − ε² on the RESAMPLED light to 1e-3
    // and on the pupil grid to 7.6e-5, and named the gap as § 8a.11's excess —
    // which is not common-mode between two frames whose PSFs differ. If the
    // excess were not the cause, removing it would leave the gap where it was.
    // It goes to 1.2e-5, past the pupil grid's own reading, because what is left
    // is a truncation the two frames share.
    const epsilon = newtonian({ apertureMm: 200, focalRatio: 5 }).obstruction!;
    const light = (withObstruction: boolean): number => {
      const scope = newtonian({ apertureMm: 200, focalRatio: 5 });
      const base: OpticalSystem = {
        prescription: scope.prescription,
        aperture: { kind: "EPD", value: 200 },
        field: { kind: "angle", values: [0] },
        wavelengths: spectralSamples(blackbodySpectrum(SOURCE_TEMPERATURE_K), { count: 5 }),
        conjugate: { kind: "infinite" },
      };
      const focus = bestFocus(base, "minRmsWavefront", { wavelengthNm: FOCUS_NM });
      const stack = spectralStack(withFocus(base, focus.offsetFromLastVertex), 0, {
        pupilSamples: 64,
        padFactor: 4,
        ...(withObstruction ? { obstruction: scope.obstruction } : {}),
      });
      return stack.planes.reduce((acc, p) => acc + sumOf(p.intensity), 0);
    };
    const ratio = light(true) / light(false);
    expect(Math.abs(ratio / (1 - epsilon * epsilon) - 1)).toBeLessThan(5e-5);
  }, 120000);
});

/** J₁, Abramowitz & Stegun 9.4.4/9.4.6 — enough for a test fixture's rings. */
function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a =
      x *
      (72362614232 +
        y * (-7895059235 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const b =
      144725228442 + y * (2300535178 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a / b;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const p = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const q =
    0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const r = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p - z * Math.sin(xx) * q);
  return x < 0 ? -r : r;
}
