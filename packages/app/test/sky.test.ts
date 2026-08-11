import { describe, it, expect } from "vitest";
import {
  RESOLVED_AIRY_RADII,
  WALL_SWEEP_CEILING_DEG,
  cornerFieldOf,
  renderSky,
  skyWallSweep,
  wallExponents,
  type SkyRequest,
  type SkyResult,
} from "../src/sky";

/**
 * C7 — the sky surface, as invariants rather than as prose.
 *
 * The engine step it wires landed as § 5v and is pinned in
 * `core/test/extended.test.ts`; **nothing here re-pins the Jacobian, the cos³
 * law or the point-source limit.** What is pinned is the wiring plus the five
 * claims the panel makes that no rung states.
 *
 * 1. **The framing wall is measured, and its exponent is § 2f's.** ROADMAP
 *    quotes § 2f's closed form for the *minimal* diagonal, and this preset's
 *    clear radius is larger, so the formula reads 7.7× low against what the
 *    engine does — a caption with two numbers that far apart is the failure C1
 *    and C6 both record. What survives is the exponent: § 2f reports its
 *    boundary running 2.34 → 2.11 from above, and the rasterizer's chief ray
 *    finds the same numbers through a different routine.
 * 2. **How much sky a Newtonian frames is set by its focuser height**, which
 *    `newtonian` calls mechanical and which moves no optical surface. Aperture,
 *    meanwhile, cancels exactly.
 * 3. **The frame's corner is what walls, not the disc.** A reader shrinking the
 *    disc to escape a refusal must not be rescued by it, or the guard's wording
 *    is a lie.
 * 4. **A disc below one Airy radius is a star**, and the panel says which side
 *    of that it is on.
 * 5. **The measured limb profile is the authored law**, softened by the PSF at
 *    the limb and nowhere else.
 */

const BASE: SkyRequest = {
  optic: "newtonian",
  apertureMm: 200,
  focalRatio: 8,
  focusOffsetOverD: 0.75,
  frameWidthDeg: 0.12,
  discDiameterDeg: 0.08,
  limbDarkening: 0.6,
  sourceTemperatureK: 5800,
  wavelengths: 3,
  pupilSamples: 32,
  patches: 1,
  whiteOverMean: 2.2,
};

const FOCAL_RATIOS = [4, 5, 6, 8, 10, 12, 15];

const cache = new Map<string, SkyResult>();
const run = (overrides: Partial<SkyRequest> = {}): SkyResult => {
  const request = { ...BASE, ...overrides };
  const key = JSON.stringify(request);
  const hit = cache.get(key);
  if (hit) return hit;
  const made = renderSky(request);
  if (!made.ok) throw new Error(`expected a render, got: ${made.error}`);
  cache.set(key, made);
  return made;
};

describe("C7.1 — the framing wall is measured, and it falls as § 2f's exponent", () => {
  const sweep = skyWallSweep({
    optic: "newtonian",
    apertureMm: 200,
    focusOffsetOverD: 0.75,
    focalRatios: FOCAL_RATIOS,
  });

  it("every focal ratio has one, and it falls monotonically", () => {
    expect(sweep.every((p) => p.wallDeg !== null)).toBe(true);
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i]!.wallDeg!).toBeLessThan(sweep[i - 1]!.wallDeg!);
    }
    // The panel's headline pair, to the digits it prints.
    expect(sweep[0]!.wallDeg!).toBeCloseTo(2.3834, 3);
    expect(sweep[sweep.length - 1]!.wallDeg!).toBeCloseTo(0.1308, 3);
  });

  it("the local exponent runs 2.334 → 2.099, beside § 2f's 2.34 → 2.11", () => {
    const exponents = wallExponents(sweep);
    expect(exponents.length).toBe(FOCAL_RATIOS.length - 1);
    // § 2f reports "local power 2.34 → 2.11 from above" for the same boundary
    // reached through `opdMap`'s refusal. These come from the chief ray failing
    // to trace — a different routine, a different preset parameterization, and
    // the same wall. Pinned as MEASURED rather than asserted equal to § 2f's
    // pair: they agree to two significant figures and to three decimals they do
    // not, and writing 2.34 here would be claiming an identity this panel has
    // not got. What is claimed is the shape, and the shape is exact.
    expect(exponents[0]!).toBeCloseTo(2.334, 3);
    expect(exponents[exponents.length - 1]!).toBeCloseTo(2.099, 3);
    // Monotone from above, which is what "from above" means and is the shape a
    // pure 1/F² would not have.
    for (let i = 1; i < exponents.length; i++) {
      expect(exponents[i]!).toBeLessThan(exponents[i - 1]!);
    }
    expect(Math.min(...exponents)).toBeGreaterThan(2);
  });

  it("the refractor has no wall inside the swept range — an absence, not the absence", () => {
    const refractor = skyWallSweep({
      optic: "achromat",
      apertureMm: 200,
      focusOffsetOverD: 0.75,
      focalRatios: FOCAL_RATIOS,
    });
    // `null` is the honest report: the bisection reached its ceiling without a
    // refusal. The panel prints that sentence rather than "no wall".
    expect(refractor.every((p) => p.wallDeg === null)).toBe(true);
    expect(WALL_SWEEP_CEILING_DEG).toBe(8);
  });
});

describe("C7.2 — a mechanical number sets how much sky fits, and aperture does not", () => {
  const wallAt = (focusOffsetOverD: number, apertureMm = 200): number => {
    const point = skyWallSweep({
      optic: "newtonian",
      apertureMm,
      focusOffsetOverD,
      focalRatios: [8],
    })[0]!;
    if (point.wallDeg === null) throw new Error("expected a wall");
    return point.wallDeg;
  };

  it("the wall moves 3.5× over a focuser height that moves no optical surface", () => {
    // `newtonian`'s own header: the focus offset is "a mechanical number, not an
    // optical one" and "moves the diagonal up and down the tube without changing
    // the optics at all". It sizes the diagonal, and the diagonal is what the
    // frame runs into.
    const low = wallAt(0.5); // 100 mm on a 200 mm aperture
    const high = wallAt(1.5); // 300 mm
    expect(low).toBeCloseTo(0.3204, 3);
    expect(high).toBeCloseTo(1.1091, 3);
    expect(high / low).toBeGreaterThan(3.4);
  });

  it("aperture cancels exactly — the same wall at 100, 200 and 400 mm", () => {
    const a = wallAt(0.75, 100);
    const b = wallAt(0.75, 200);
    const c = wallAt(0.75, 400);
    // Not "close": the bisection converges on the identical value, which is
    // § 2f's "D cancels again" reproduced through this routine.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("C7.3 — the FRAME's corner is what refuses, and shrinking the disc does not help", () => {
  it("the corner is √2 of the half-frame, and it is what the wall applies to", () => {
    // Geometry the panel uses to grey a slider before paying for a render; the
    // rendered result derives its own corner from the traced map instead.
    const rendered = run();
    expect(cornerFieldOf(BASE.frameWidthDeg)).toBeCloseTo(rendered.cornerFieldDeg, 6);
    expect(rendered.cornerFieldDeg).toBeGreaterThan(BASE.frameWidthDeg / 2);
  });

  it("a frame past the wall refuses, in the engine's own words", () => {
    const refusal = renderSky({ ...BASE, frameWidthDeg: 0.9, discDiameterDeg: 0.5 });
    expect(refusal.ok).toBe(false);
    if (refusal.ok) throw new Error("unreachable");
    expect(refusal.source).toBe("engine");
    expect(refusal.stage).toBe("frame");
    expect(refusal.error).toContain("stops tracing past");
  });

  it("and shrinking the disc inside that frame does not rescue it", () => {
    // The claim the guard's wording makes. A disc a thousandth of a degree
    // across is nothing but empty frame around it, and the frame is the problem.
    const refusal = renderSky({ ...BASE, frameWidthDeg: 0.9, discDiameterDeg: 0.001 });
    expect(refusal.ok).toBe(false);
  });

  it("the same frame passes on the refractor, which has no diagonal", () => {
    const wide = run({ optic: "achromat", frameWidthDeg: 0.9, discDiameterDeg: 0.5 });
    expect(wide.cornerFieldDeg).toBeGreaterThan(0.6);
  });

  it("a disc that does not fit its frame is refused by the app, not by the engine", () => {
    const refusal = renderSky({ ...BASE, discDiameterDeg: BASE.frameWidthDeg });
    expect(refusal.ok).toBe(false);
    if (refusal.ok) throw new Error("unreachable");
    expect(refusal.source).toBe("app");
  });
});

describe("C7.4 — inside the Airy disc, a disc is a star", () => {
  it("the panel's own verdict tracks the Airy radius it prints", () => {
    const big = run();
    expect(big.resolved).toBe(true);
    expect(big.discDiameterAiryRadii).toBeGreaterThan(100);

    // Frame held fixed and the disc shrunk inside it — the framing choice this
    // panel is built on, and § 5v.7's limit made reachable from a slider.
    const tiny = run({ discDiameterDeg: 0.0002 });
    expect(tiny.resolved).toBe(false);
    // 0.72″ against an Airy radius of 0.69″ — just over one radius and well
    // inside the Airy DISC, which is the threshold `RESOLVED_AIRY_RADII` states.
    // A first draft compared the disc's diameter to the Airy *radius* and called
    // this resolved, which is a diameter against a radius: C6's unit error in a
    // second place, caught here by the case that straddles it.
    expect(tiny.discDiameterAiryRadii).toBeGreaterThan(1);
    expect(tiny.discDiameterAiryRadii).toBeLessThan(RESOLVED_AIRY_RADII);
    // Same frame, so the pixel scale is untouched and the two pictures are
    // comparable: what changed is the source and nothing else.
    expect(tiny.pixelScaleMm).toBe(big.pixelScaleMm);
  });

  it("the falloff at these fields is cos³ to six digits, which is why it is not plotted", () => {
    const rendered = run();
    expect(rendered.falloffMeasured).toBeCloseTo(rendered.falloffCos3, 6);
    // A flat line at 1.000000. The panel says this in a Fact and draws no axes
    // for it — § 5v.3 measures the falloff as 0.73% at 4°, and no frame here
    // reaches a tenth of that.
    expect(rendered.falloffMeasured).toBeGreaterThan(0.99999);
  });
});

describe("C7.5 — the measured limb is the authored law, softened only at the limb", () => {
  it("the interior reproduces 1 − u(1 − √(1 − s²)) to a few percent", () => {
    const rendered = run();
    const interior = rendered.profile.filter((p) => p.s > 0.1 && p.s < 0.8);
    expect(interior.length).toBeGreaterThan(10);
    for (const point of interior) {
      expect(point.measured).toBeCloseTo(point.law, 1);
    }
    // And it really is darkening rather than a flat disc: at u = 0.6 the law
    // falls to 0.4 at the limb, and the measurement follows it down.
    const mid = interior[Math.floor(interior.length / 2)]!;
    expect(mid.law).toBeLessThan(1);
    expect(mid.measured).toBeLessThan(1);
  });

  it("light appears outside the limb, where the source has none — that is the PSF", () => {
    const rendered = run();
    const outside = rendered.profile.filter((p) => p.s > 1.02 && p.s < 1.2);
    expect(outside.length).toBeGreaterThan(0);
    for (const point of outside) {
      expect(point.law).toBe(0);
      expect(point.measured).toBeGreaterThan(0);
    }
  });

  it("u = 0 authors a flat disc, and the measurement is flat with it", () => {
    const flat = run({ limbDarkening: 0 });
    // § 5v.11 pins u = 0 as `uniformDisc` bitwise in the engine; what the panel
    // adds is that the drawn law is then constant and the picture agrees.
    for (const point of flat.profile.filter((p) => p.s < 0.9)) {
      expect(point.law).toBe(1);
    }
    const interior = flat.profile.filter((p) => p.s > 0.1 && p.s < 0.8);
    for (const point of interior) {
      expect(point.measured).toBeCloseTo(1, 1);
    }
  });
});

describe("C7.6 — the cost is where the panel says it is", () => {
  it("the rasterizer is not the bill, and the chief-ray count is an integer", () => {
    const rendered = run();
    // § 5v reports its cost as forward chief rays rather than a wall clock, and
    // this surface carries that through: nodes + 1 per wavelength, plus the
    // covering search's last trace.
    expect(rendered.chiefRays).toBe(BASE.wavelengths * 66);
    expect(rendered.psfEvaluations).toBe(BASE.wavelengths);
  });

  it("more patches means more PSFs and the same scene", () => {
    const one = run();
    const two = run({ patches: 2 });
    expect(two.psfEvaluations).toBe(5 * BASE.wavelengths);
    // The scene is rasterized once either way, so its flux cannot move with a
    // rendering choice.
    expect(two.sceneFlux).toBe(one.sceneFlux);
    expect(two.chiefRays).toBe(one.chiefRays);
  });
});
