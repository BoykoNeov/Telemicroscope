import {
  renderedBestFocus,
  type FocusProbe,
  type FocusSweepOptions,
  type FocusSweepPoint,
} from "../../src/imaging/focus-surface";
import { gaussianBallEmitter, uniformSlabs } from "../../src/imaging/emitter-volume";
import { objectFieldTile } from "../../src/imaging/object-field";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../../src/designs/microscope";
import type { OpticalSystem } from "../../src/trace/system";

/**
 * § 6bq's sweep, shared by the two files that measure the refusal boundary.
 *
 * `refusal-boundary.test.ts` asks WHERE the boundary is and how it moves with
 * magnification; `refusal-frames.test.ts` asks what the FRAME does to
 * the reading, which is what says whether a boundary quoted at one frame means
 * anything. They are one step, § 6bq, and they were one file until it was
 * measured: 177 s of sweeps in a single module is 177 s on a single worker, and
 * a worker cannot be split. Against the other fifteen it ran at about two thirds
 * speed, so it took 273 s of wall clock that nothing else could absorb, and the
 * suite's parallelism fell from about 13× to 9×. Splitting the rungs across two
 * modules costs the fixtures that both need — they are memoised per process, so
 * the shared ones are built twice — and buys back the tail.
 *
 * Nothing here changes a number. The split line is conceptual as well as
 * cheap, which is why it is this one and not a cut through the ladders.
 *
 * Fixtures are memoised and built on first READ, never at module level: § 6bo's
 * file spent 41 s of collect on eager sweeps, which every `-t` rerun paid before
 * the rung it asked for started. The reasoning is in `fourth-corner.test.ts`.
 */

export const DESIGN = 587.5618;
export const LAMBDA = 430;

const LENSES = new Map<string, OpticalSystem>();
export const lens = (M: number, na: number): OpticalSystem => {
  const key = `${M}|${na}`;
  let built = LENSES.get(key);
  if (built === undefined) {
    built = finiteConjugateMicroscope({
      objective: finiteConjugateObjective({ magnification: M, numericalAperture: na }),
    }).system;
    LENSES.set(key, built);
  }
  return built;
};

const BALL: FocusProbe = (centreMm) =>
  gaussianBallEmitter({ waistMm: 0.005, axialWaistMm: 0.004, peak: 1, centreMm });

/**
 * § 6bk's sweep through § 6bo's, with the threshold opened so a refusing lens
 * still yields a number to compare — § 6bk.8's device. § 6bq.8 puts the real
 * threshold back, to check that the number is what gets reported.
 */
export const sweep = (size: number, ps: number, maxPlateauDepths = 1e9): FocusSweepOptions => ({
  size,
  pupilSamples: ps,
  slabs: uniformSlabs(-0.008, 0.008, 3),
  probe: BALL,
  stepMm: 0.005,
  halfMm: 0.03,
  maxPlateauDepths,
  radialMapSeed: "magnification",
});

const POINTS = new Map<string, FocusSweepPoint>();
/** One sweep, memoised on (M, NA, size, pupilSamples) — lazily, per the header. */
export const P = (M: number, na: number, size: number, ps: number): FocusSweepPoint => {
  const key = `${M}|${na}|${size}|${ps}`;
  let point = POINTS.get(key);
  if (point === undefined) {
    point = renderedBestFocus(lens(M, na), LAMBDA, 0, sweep(size, ps));
    POINTS.set(key, point);
  }
  return point;
};
export const D = (M: number, na: number, size: number, ps: number): number =>
  P(M, na, size, ps).plateauDepths;

export const fieldOf = (M: number, na: number, size: number, ps: number): number =>
  objectFieldTile(lens(M, na), {
    size,
    pupilSamples: ps,
    wavelengthNm: DESIGN,
    centreMm: { x: 0, y: 0 },
  }).halfExtentMm;

/** § 6bo.5's seven, at the sweep's own sampling. */
export const LADDER = [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25] as const;
/** The 10× ladder. 0.25 does not build there — § 6bn.1's ceiling. */
export const FINE10 = [0.1, 0.12, 0.15, 0.16, 0.17, 0.18, 0.2, 0.22] as const;

/** The three frames every band is taken over: one pixel pitch, 4× of extent. */
export const FRAMES = [
  [64, 24],
  [128, 48],
  [256, 96],
] as const;

export const band = (xs: readonly number[]): readonly [number, number] => [
  Math.min(...xs),
  Math.max(...xs),
];
export const straddlesOne = (xs: readonly number[]): boolean => {
  const [lo, hi] = band(xs);
  return lo < 1 && hi > 1;
};
