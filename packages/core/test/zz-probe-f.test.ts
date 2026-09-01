import { describe, it } from "vitest";
import { mosaicSeamShiftMm, type FluorescenceMosaicOptions } from "../src/imaging/fluorescence-mosaic";
import { objectFieldTile } from "../src/imaging/object-field";
import type { TileStageMm } from "../src/imaging/focus-tiles";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import type { OpticalSystem } from "../src/trace/system";
import type { EmitterSlabs } from "../src/imaging/emitter-volume";

const DESIGN = 587.5618;
const THIN: EmitterSlabs = { depthsMm: [0], thicknessMm: [0.016] };
const build = (M: number, NA: number): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: M, numericalAperture: NA }),
  }).system;
const FREE_STAGE: TileStageMm = () => 0;
function mosaicOptions(
  size: number,
  ps: number,
  over: Partial<FluorescenceMosaicOptions> = {},
): FluorescenceMosaicOptions {
  return {
    size,
    pupilSamples: ps,
    slabs: THIN,
    samples: [
      { nm: 430, weight: 1 },
      { nm: DESIGN, weight: 1 },
      { nm: 656.2725, weight: 1 },
    ],
    tiles: 3,
    guardCells: 4,
    stageMm: FREE_STAGE,
    radialMapSeed: "magnification",
    centreMm: { x: 4, y: 0 },
    ...over,
  };
}
type Cell = "s10" | "f10" | "s20" | "f20";
const LENS: Record<Cell, OpticalSystem> = {
  s10: build(10, 0.1),
  f10: build(10, 0.2),
  s20: build(20, 0.1),
  f20: build(20, 0.2),
};
const Q6BO: Record<Cell, readonly [number, number]> = {
  s10: [128, 32],
  f10: [256, 64],
  s20: [128, 16],
  f20: [128, 32],
};
const CELLS: readonly Cell[] = ["s10", "f10", "s20", "f20"];
const interact = (sl: number, fl: number, sh: number, fh: number): number => fh / sh / (fl / sl);
const inter4 = (v: readonly number[]): number => interact(v[0]!, v[1]!, v[2]!, v[3]!);
const BIG = 2 ** 26;
const PS_AT = (c: Cell, j: number): number => (Q6BO[c][1] * j) / 16;
const guardAt = (j: number, i: number): number => (i * j) / 2 ** 24;
const legal = (j: number, i: number): boolean =>
  CELLS.every((c) => Number.isInteger(guardAt(j, i) * (BIG / PS_AT(c, j))));
const shift = (c: Cell, j: number, i: number, x: number) =>
  mosaicSeamShiftMm(
    LENS[c],
    mosaicOptions(BIG, PS_AT(c, j), {
      guardCells: guardAt(j, i),
      centreMm: { x, y: 0 },
      scan: "stage",
    }),
    65,
  );
const aniso = (c: Cell, j: number, i: number, x: number): number => {
  const s = shift(c, j, i, x);
  return s.betweenRowsMm / s.betweenColumnsMm;
};
const ratioOfHalf = (j: number, x: number): number =>
  objectFieldTile(LENS.s20, {
    size: BIG,
    pupilSamples: PS_AT("s20", j),
    wavelengthNm: DESIGN,
    centreMm: { x, y: 0 },
  }).halfExtentMm / x;


const interactAt = (j: number, i: number, x: number): number =>
  inter4(CELLS.map((c) => aniso(c, j, i, x)));

describe("probe F", () => {
  it("brackets the maximum in ratio at several guards", () => {
    console.log("start");
    for (const [i, x] of [[10000, 4], [100000, 4], [400000, 4], [809443, 4], [2000000, 4], [809443, 2], [400000, 2]] as const) {
      let best = -Infinity;
      let bestJ = 0;
      const vals: [number, number][] = [];
      for (let j = 32; j <= 128; j += 2) {
        if (!legal(j, i)) continue;
        const v = interactAt(j, i, x);
        vals.push([j, v]);
        if (v > best) {
          best = v;
          bestJ = j;
        }
      }
      const n = vals.findIndex(([j]) => j === bestJ);
      const lo = vals[n - 1]?.[0] ?? bestJ;
      const hi = vals[n + 1]?.[0] ?? bestJ;
      console.log(
        `x=${x} i=${i} argmax j=${bestJ} ratio=${ratioOfHalf(bestJ, x).toFixed(5)} bracket=(${ratioOfHalf(lo, x).toFixed(5)}, ${ratioOfHalf(hi, x).toFixed(5)}) peak=${best.toFixed(9)}`,
      );
    }
  }, 3600000);
});
