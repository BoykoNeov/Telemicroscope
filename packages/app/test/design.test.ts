import { describe, it, expect } from "vitest";
import { systemProperties } from "@telemicroscope/core/trace";
import { withVariable } from "@telemicroscope/core/analysis";
import {
  DESIGN_SEEDS,
  defaultSpec,
  describeDesign,
  equiconvexVertex,
  seedById,
  type DesignDescription,
  type DesignReadout,
  type DesignSolution,
  type DesignSpec,
} from "../src/design";

/**
 * The design-solve panel — ROADMAP's v2+ design-mode entry, first half — as
 * invariants.
 *
 * The engine half is VALIDATION § 1.7 and carries its own rungs, pinned against
 * Gullstrand's thick-lens equation inverted in closed form. **No physics is
 * added here and no rung is claimed.** What this file pins is the wiring, and
 * the seven things the panel says on screen that no ladder rung states, because
 * they are statements about the lenses this app ships and about what the solver
 * does when a real design question is put to it:
 *
 *  1. the solve is exact, and the exactness is in the POWER — a millimetre
 *     residual that moves with the target is the unit moving,
 *  2. the same claim as WORK: two evaluations past the scan for an affine
 *     target, fifty-six for the same question asked in millimetres,
 *  3. exactly one root through a single prescription number, always, which is
 *     why the coupled seed exists at all,
 *  4. two roots when two numbers move together — with back focal distances that
 *     are equal and opposite, so only one of the pair is a lens you can put a
 *     sensor behind,
 *  5. the answer holds at one wavelength, and the miss at the other two is the
 *     colour correction: 0.34 mm on the achromat against 5.44 on the singlet,
 *  6. one curvature is enough to spend that correction — 29× and 42× — while
 *     the same move on the singlet costs 20%, so the corrected lens is the
 *     fragile one, and
 *  7. "where does this go afocal?" is refused every time, because the wall is
 *     the root the refinement is converging to.
 *
 * The specs below are the panel's own defaults wherever they can be, so a change
 * that makes the default view wrong fails here rather than being found by
 * opening the page.
 */

const spec = (patch: Partial<DesignSpec> = {}): DesignSpec => ({
  ...defaultSpec(),
  ...patch,
});

/** The readout, with the "this is not even a question" path ruled out. */
function readout(patch: Partial<DesignSpec> = {}): DesignReadout {
  const r: DesignDescription = describeDesign(spec(patch));
  expect(r.ok, "ok" in r ? "" : (r as { error: string }).error).toBe(true);
  return r as DesignReadout & { ok: true };
}

/** The solution, asserted to be one rather than a refusal. */
function solutionOf(patch: Partial<DesignSpec> = {}): DesignSolution {
  const s = readout(patch).solution;
  if (!("x" in s)) throw new Error(`expected a solve, got a refusal: ${s.error}`);
  return s;
}

/** A seed's own defaults, which is what the panel opens each one on. */
function seedSpec(id: (typeof DESIGN_SEEDS)[number]["id"], patch: Partial<DesignSpec> = {}) {
  const seed = seedById(id);
  const option = seed.options[seed.defaultOption]!;
  return spec({
    seed: id,
    option: seed.defaultOption,
    target: seed.defaultTarget,
    interval: option.interval,
    preferNear: (option.interval[0] + option.interval[1]) / 2,
    ...patch,
  });
}

describe("the design panel — the answer it opens on", () => {
  /**
   * The default view: the doublet this app renders its stars through, asked for
   * 2% more focal length through its crown's front curvature.
   */
  it("solves the shipped achromat's crown for a 510 mm focal length", () => {
    const s = solutionOf();
    expect(s.x).toBeCloseTo(0.004388091745, 12);
    expect(s.valueFrom).toBeCloseTo(0.004466151806, 12);
    expect(s.roots).toHaveLength(1);
    const root = s.roots[0]!;
    expect(root.radiusMm).toBeCloseTo(227.88949, 4);
    expect(root.eflMm).toBeCloseTo(510, 9);
    // The rim is the design's own 25 mm semi-aperture, so this curvature is a
    // surface nine times bigger than the hole it has to fill.
    expect(root.rimRatio).toBeCloseTo(9.1156, 3);
    expect(root.negativeGlass).toBe(false);
  });

  /**
   * Claim 1. The residual is zero here in BOTH currencies, and the point of
   * pinning it at three targets is that the millimetre one is not always zero
   * while the power one always is: |Δf| = f²·|ΔP| magnifies one ulp of power
   * into 5.7e-14 mm at 400 mm and 2.3e-13 at 1000 mm. A reader who took the
   * millimetre number for the solver's convergence would be reading the unit.
   */
  it("lands exactly, in the units it actually solved in", () => {
    for (const value of [510, 400, 1000, 499.714]) {
      const s = solutionOf({ target: { kind: "efl", value } });
      // One ulp of a power near 0.002 /mm is 4.3e-19; nothing here exceeds it.
      expect(Math.abs(s.residualPower), `efl=${value}`).toBeLessThanOrEqual(5e-19);
      // …and the same answer read in millimetres is up to three ulp of f.
      expect(Math.abs(s.residualMm), `efl=${value}`).toBeLessThanOrEqual(
        3 * value * Number.EPSILON,
      );
    }
    // The two are the same statement scaled by f², which is what the panel says
    // and what makes the millimetre column safe to print. It holds to within a
    // power of two rather than exactly, and that is not slack in the check: both
    // residuals are ulp-quantized, so their ratio carries the square of the gap
    // between the target and its own binade — measured 1.048576 at 1000 mm,
    // which is (1024/1000)² and not a millimetre of anything.
    const far = solutionOf({ target: { kind: "efl", value: 1000 } });
    expect(far.residualPower).not.toBe(0);
    const magnification = Math.abs(far.residualMm / (far.residualPower * 1000 * 1000));
    expect(magnification).toBeGreaterThan(0.5);
    expect(magnification).toBeLessThan(2);
  });

  /**
   * Claim 2, and it is the more convincing half: nothing in the result says
   * "this was exact", the evaluation count does. A 64-cell scan is 65
   * evaluations whatever is being solved; an affine target then needs ONE
   * interpolation plus one candidate check, and the same question asked in
   * millimetres — where f is a reciprocal and not a line — iterates.
   */
  it("shows the affineness as work, not as an assertion", () => {
    const efl = solutionOf({ target: { kind: "efl", value: 510 } });
    expect(efl.evaluations).toBe(67);
    expect(efl.beyondTheScan).toBe(2);

    // The same variable, the same lens, a target that is not affine in it.
    const bfd = solutionOf({ target: { kind: "bfd", value: 500 } });
    expect(bfd.beyondTheScan).toBeGreaterThan(40);

    // And the control the panel prints beside it: the identical focal-length
    // question asked straight at f instead of at 1/f.
    const naive = readout().naive;
    expect(naive?.verdict).toBe("same");
    expect(naive!.evaluations! - 65).toBeGreaterThan(40);
  });
});

describe("the design panel — one root, or two", () => {
  /**
   * Claim 3. The power is affine in any single curvature or thickness and the
   * back focal distance is a ratio of two affine functions, so both have exactly
   * one root — there is no way to reach a target twice through the engine's own
   * `SolveVariable`. The sweep is over every surface and both variables of the
   * three lenses the panel ships, at targets 2% off what each already delivers.
   *
   * The count of solves that succeeded is asserted too: most of these variables
   * cannot reach the target at all (a cemented doublet's focal length barely
   * moves with a thickness), and a sweep that refused everywhere would pass this
   * while checking nothing.
   */
  it("never reaches a target two ways through a single prescription number", () => {
    let solves = 0;
    let combinations = 0;
    for (const id of ["achromat", "singlet", "cassegrain"] as const) {
      const seed = seedById(id);
      // What the lens already delivers, so each target is 2% off the property
      // it belongs to rather than off some other property's magnitude — a back
      // focus asked for at a focal length's size refuses on arithmetic and
      // would have made this sweep look thorough while testing nothing.
      const now = systemProperties(seed.prescription, defaultSpec().wavelengthNm);
      for (let index = 0; index < seed.options.length; index++) {
        const option = seed.options[index]!;
        for (const kind of ["efl", "bfd"] as const) {
          combinations++;
          const r = describeDesign(
            seedSpec(id, {
              option: index,
              interval: option.interval,
              preferNear: (option.interval[0] + option.interval[1]) / 2,
              target: { kind, value: (kind === "efl" ? now.efl : now.bfd) * 1.02 },
            }),
          );
          const where = `${id} option ${index} (${option.label}) ${kind}`;
          expect(r.ok, where).toBe(true);
          if (!r.ok) continue;
          const s = r.solution;
          // Most of these are out of range — a cemented doublet's focal length
          // barely moves with a thickness, and a last thickness moves neither
          // property at all — and a refusal is a legitimate outcome. It just
          // does not get to stand in for the claim, which is why the count
          // below is asserted.
          if (!("x" in s)) continue;
          solves++;
          expect(s.roots, where).toHaveLength(1);
          expect(r.rootsAtFinerScan, where).toBe(1);
        }
      }
    }
    // 28 combinations: (3 + 2 + 2) surfaces × 2 variables × 2 targets.
    expect(combinations).toBe(28);
    expect(solves).toBeGreaterThanOrEqual(15);
  });

  /**
   * Claim 4. Two curvatures held equal and opposite make the power a parabola,
   * so a target longer than the family's shortest focal length is reachable
   * twice — § 1.7's multiplicity fixture, driven through this panel.
   *
   * The back focal distances are the part that is this file's rather than
   * § 1.7's: they are equal and opposite, exactly, because BFD = f(1 −
   * (d/n)(n−1)c) and the two roots are symmetric about c* = n/(d(n−1)), where
   * (d/n)(n−1)·2c* is 2. So one of the two lenses focuses behind its own last
   * surface, and "reachable two ways" is a design statement rather than a
   * curiosity.
   */
  it("finds both equiconvex lenses, whose back focal distances cancel", () => {
    const s = solutionOf(seedSpec("equiconvex"));
    expect(s.roots).toHaveLength(2);
    expect(s.roots[0]!.x).toBeCloseTo(0.107454911, 8);
    expect(s.roots[1]!.x).toBeCloseTo(0.626291187, 8);
    expect(s.roots[0]!.bfdMm).toBeCloseTo(7.458907761, 8);
    expect(s.roots[1]!.bfdMm).toBeCloseTo(-7.458907761, 8);
    expect(Math.abs(s.roots[0]!.bfdMm + s.roots[1]!.bfdMm)).toBeLessThan(1e-12);
    for (const root of s.roots) expect(root.eflMm).toBeCloseTo(10.5485, 9);
    // Both are numbers and neither is a surface at the fixture's own 10 mm rim:
    // 9.31 mm and 1.60 mm of radius. That is what a solver fixture looks like
    // when it is asked to be a lens, and it is why the panel prints the ratio.
    expect(s.roots[0]!.rimRatio).toBeCloseTo(0.931, 3);
    expect(s.roots[1]!.rimRatio).toBeCloseTo(0.16, 3);
  });

  it("lets the seed choose between them, and nothing else does", () => {
    const low = solutionOf(seedSpec("equiconvex", { preferNear: 0.02 }));
    const high = solutionOf(seedSpec("equiconvex", { preferNear: 0.85 }));
    expect(low.x).toBeCloseTo(0.107454911, 8);
    expect(high.x).toBeCloseTo(0.626291187, 8);
    expect(low.roots.map((r) => r.x)).toEqual(high.roots.map((r) => r.x));
  });

  /**
   * § 1.7's blind cell, reached from a panel control. A cell holding two roots
   * shows no sign change across it, so a pair closer together than one cell is
   * stepped over — and from outside that is not a wrong answer, it is a REFUSAL
   * naming a resolution. The guard is the same question asked four times finer,
   * which is the only thing that tells "your scan was too coarse" apart from
   * "this lens cannot do that".
   */
  it("refuses a pair it cannot resolve, and says so by finding them at four times the cells", () => {
    const vertex = equiconvexVertex(defaultSpec().wavelengthNm);
    const target = { kind: "efl" as const, value: 1.0005 * vertex.shortestFocalMm };
    for (const scanCells of [8, 16]) {
      const r = readout(seedSpec("equiconvex", { target, scanCells, preferNear: 0.4 }));
      const s = r.solution;
      expect("x" in s, `cells=${scanCells}`).toBe(false);
      if (!("x" in s)) expect(s.error).toMatch(new RegExp(`scanned in ${scanCells} cells`));
      // The guard: four times finer resolves the pair the refusal walked past.
      expect(r.rootsAtFinerScan, `cells=${scanCells}`).toBe(2);
    }
    for (const scanCells of [32, 64]) {
      const s = solutionOf(seedSpec("equiconvex", { target, scanCells, preferNear: 0.4 }));
      expect(s.roots, `cells=${scanCells}`).toHaveLength(2);
      expect(s.roots[0]!.x).toBeCloseTo(0.358671568, 8);
      expect(s.roots[1]!.x).toBeCloseTo(0.37507453, 8);
      // The cancellation again, on a pair 0.016 apart rather than 0.5.
      expect(Math.abs(s.roots[0]!.bfdMm + s.roots[1]!.bfdMm)).toBeLessThan(1e-12);
    }
    // …and the vertex the whole rung sits under is the closed form's.
    expect(vertex.curvature).toBeCloseTo(0.3668730489, 9);
    expect(vertex.shortestFocalMm).toBeCloseTo(5.274261483, 8);
  });
});

describe("the design panel — the pole, and the wall behind it", () => {
  /**
   * § 1.7's pole fixture, both ways round. A focal-length target is solved as a
   * power target, which turns the pole into an ordinary zero; asked straight at
   * f, the same question meets a sign change that is not a root. Neither route
   * returns the pole — the candidate check discards it — so what the panel can
   * actually show is that the two refusals are about different things.
   */
  it("refuses an unreachable focal length differently depending on the currency", () => {
    const r = readout(seedSpec("airspaced", { target: { kind: "efl", value: 20 } }));
    const s = r.solution;
    expect("x" in s).toBe(false);
    if (!("x" in s)) {
      expect(s.error).toMatch(/is not reached over/);
      expect(s.error).not.toMatch(/pole/);
    }
    expect(r.naive?.verdict).toBe("refused");
    expect(r.naive?.message).toMatch(/was a pole rather than a root/);
  });

  it("agrees with the naive route wherever the target is actually reachable", () => {
    const r = readout(seedSpec("airspaced", { target: { kind: "efl", value: 50 } }));
    const s = r.solution;
    expect("x" in s).toBe(true);
    if ("x" in s) {
      expect(s.x).toBeCloseTo(65.116912, 5);
      expect(s.roots).toHaveLength(1);
      expect(r.naive?.verdict).toBe("same");
    }
  });

  /**
   * Claim 7, and the finding this panel carries back to § 1.7. That step records
   * the wall convention and says it had to be pinned on synthetic closures,
   * because `systemProperties` only throws at |u| < 1e-15 and a 64-cell scan
   * meets that with probability zero. A scan does. A refinement aimed at the
   * afocal point meets it with probability one, because the wall IS the root it
   * is converging to. The engine throws at |u| < 1e-15 and u is −1/f, so the
   * hole is exactly where |1/f| < 1e-15: measured edge to edge on this fixture
   * it is 5.615e-12 mm of gap, against Brent's 8·eps·120 = 2.13e-13 mm, 26×
   * narrower — so the final bracket fits inside the hole.
   *
   * So the answer arrives as a refusal that names the place, and the place is
   * 9.0159878 mm — where § 1.7's own prose estimated 9.67.
   */
  it("cannot return the afocal value, and refuses in a sentence that contains it", () => {
    const r = readout(seedSpec("airspaced"));
    expect(r.afocal.refused).toBe(true);
    expect(r.afocal.message).toMatch(/was a pole rather than a root/);
    expect(r.afocal.message).toMatch(/9\.01598775/);
    // The panel's own bracket, off its 241 curve samples — a different route to
    // the same crossing, at the curve's resolution rather than the solver's.
    const bracket = r.afocal.bracket!;
    expect(bracket[0]).toBeLessThan(9.0159878);
    expect(bracket[1]).toBeGreaterThan(9.0159878);
  });

  /**
   * The mechanism behind the rung above, as the two widths rather than as a
   * sentence: the hole has to be WIDER than what the refinement converges to,
   * or the refusal would be luck. Measured by bisecting for the last gap that
   * is a system on each side — 9.015987757053926 and 9.015987757059541.
   */
  it("has a hole wider than the refinement that walks into it", () => {
    const seed = seedById("airspaced");
    const gap = (value: number) =>
      withVariable(seed.prescription, { kind: "thickness", surface: 1 }, value);
    const isSystem = (value: number) => {
      try {
        systemProperties(gap(value), defaultSpec().wavelengthNm);
        return true;
      } catch {
        return false;
      }
    };
    const edge = (from: number, into: number) => {
      let good = from;
      let bad = into;
      for (let i = 0; i < 200; i++) {
        const mid = (good + bad) / 2;
        if (mid === good || mid === bad) break;
        if (isSystem(mid)) good = mid;
        else bad = mid;
      }
      return good;
    };
    const inside = 9.015987757055768;
    expect(isSystem(inside)).toBe(false);
    const width = edge(9.1, inside) - edge(9.0, inside);
    expect(width).toBeCloseTo(5.615e-12, 15);
    // Brent's own convergence width on this interval, from the module's default
    // `8·eps·max(|lo|, |hi|)` at [1, 120]. The hole is 26× wider, which is why
    // the refinement lands in it rather than beside it.
    const refinement = 8 * Number.EPSILON * 120;
    expect(width / refinement).toBeGreaterThan(10);
  });

  /**
   * And it is not a property of that fixture: the doublet this app ships goes
   * afocal at a crown curvature of 0.00059578 /mm — R = 1678 mm, a nearly flat
   * crown — which sits inside the interval the panel's own rule states. So the
   * default view has a pole in its right-hand plot, and that is why both plots
   * are cut at the crossing rather than drawn through it.
   */
  it("finds the same wall on the app's own achromat", () => {
    const r = readout();
    expect(r.afocal.refused).toBe(true);
    expect(r.afocal.message).toMatch(/0\.00059577805/);
    const bracket = r.afocal.bracket!;
    expect(bracket[0]).toBeLessThan(0.0005957781);
    expect(bracket[1]).toBeGreaterThan(0.0005957781);
    expect(r.curve.every((p) => p.finite)).toBe(true);
  });

  /**
   * The Cassegrain's curve lands ON the wall rather than straddling it: at 241
   * samples over the interval the panel states, one sample is a system with no
   * focal length and the engine refuses it outright. Pinned because the panel
   * prints that count and because the bracket has to survive it — a sign change
   * measured between consecutive FINITE samples still finds the crossing that a
   * sample sitting in the hole would otherwise hide.
   */
  it("draws a gap where a sample is not a system, and still brackets the crossing", () => {
    const r = readout(seedSpec("cassegrain"));
    const walls = r.curve.filter((p) => !p.finite);
    expect(walls.length).toBeGreaterThanOrEqual(1);
    expect(r.afocal.bracket).not.toBeNull();
    const bracket = r.afocal.bracket!;
    expect(bracket[0]).toBeLessThan(walls[0]!.x);
    expect(bracket[1]).toBeGreaterThan(walls[0]!.x);
  });
});

describe("the design panel — what the solve costs the lens", () => {
  /**
   * Claim 5. The solve is an equation at one wavelength, so the property it
   * delivers is the one you asked for at exactly one colour. How far the other
   * two miss is the correction, and on this app's own pair it is a factor of 16
   * — the same demonstration the star image makes, arriving in a design tool.
   */
  it("holds at the line it was solved on and misses at the others, by the correction", () => {
    const achromat = solutionOf();
    const singlet = solutionOf(seedSpec("singlet"));
    expect(achromat.worstOtherLineMm).toBeCloseTo(0.340854, 5);
    expect(singlet.worstOtherLineMm).toBeCloseTo(5.43835, 4);
    expect(singlet.worstOtherLineMm / achromat.worstOtherLineMm).toBeGreaterThan(10);

    // The control, and it is exact rather than merely better: a conic has no
    // index, so a two-mirror system delivers the same focal length at every
    // wavelength and there is nothing for a solve to be per-colour about.
    const mirror = solutionOf(seedSpec("cassegrain"));
    expect(mirror.worstOtherLineMm).toBe(0);
    expect(mirror.spreadBeforeMm).toBe(0);
    expect(mirror.spreadAfterMm).toBe(0);
  });

  /**
   * Claim 6, and the panel's headline. A colour correction is a balance between
   * elements, and a single-variable solve hits its target by spending it: ±20%
   * of focal length through the crown costs 29× and 42× of the F−C spread, with
   * the sign reversed at the far end; through the flint's cemented face, 158×
   * and 240×. The same targets on the singlet of the same power move its spread
   * by 20%, because there is no balance there to lose.
   *
   * This is the measured argument for the damped-least-squares half of design
   * mode — several numbers at once — which is blocked on a pin rather than on
   * code.
   */
  it("spends the achromat's correction to hit its target, and cannot spend the singlet's", () => {
    const ratio = (s: DesignSolution) => s.spreadAfterMm / s.spreadBeforeMm;

    const crown400 = solutionOf({ target: { kind: "efl", value: 400 } });
    const crown600 = solutionOf({ target: { kind: "efl", value: 600 } });
    expect(ratio(crown400)).toBeCloseTo(29.11, 1);
    expect(ratio(crown600)).toBeCloseTo(-41.62, 1);

    const flint = (value: number) =>
      solutionOf({
        option: 2,
        interval: seedById("achromat").options[2]!.interval,
        preferNear: 0,
        target: { kind: "efl", value },
      });
    expect(ratio(flint(400))).toBeCloseTo(158.05, 0);
    expect(ratio(flint(600))).toBeCloseTo(-239.77, 0);

    for (const value of [400, 600]) {
      const single = solutionOf(seedSpec("singlet", { target: { kind: "efl", value } }));
      expect(Math.abs(ratio(single)), `singlet at ${value}`).toBeGreaterThan(0.75);
      expect(Math.abs(ratio(single)), `singlet at ${value}`).toBeLessThan(1.25);
    }
  });

  /**
   * The module's own sentence — a solve hands you a number, it does not hand you
   * a system — as a readout. Both of these are correct roots of the equation and
   * neither is glass; the reachable half of the variable stops where the crown
   * reaches 0.5 mm, and zero thickness is not a wall a paraxial trace objects to.
   */
  it("returns negative glass without noticing, and the panel notices", () => {
    const crownThickness = (value: number) =>
      solutionOf({
        option: 1,
        interval: seedById("achromat").options[1]!.interval,
        preferNear: 3,
        target: { kind: "bfd", value },
      });

    const shorter = crownThickness(498);
    expect(shorter.x).toBeCloseTo(1.378374584, 8);
    expect(shorter.roots[0]!.negativeGlass).toBe(false);

    for (const [value, thickness] of [
      [500, -0.8990364735],
      [506.5, -8.283864232],
    ] as const) {
      const s = crownThickness(value);
      expect(s.x, `bfd=${value}`).toBeCloseTo(thickness, 7);
      expect(s.roots[0]!.negativeGlass, `bfd=${value}`).toBe(true);
    }
  });
});

describe("the design panel — the shape of the readout", () => {
  it("draws a curve for a target it refuses, because the picture is the diagnosis", () => {
    const r = readout({ target: { kind: "efl", value: 40 } });
    expect("x" in r.solution).toBe(false);
    expect(r.curve.length).toBe(defaultSpec().curveSamples);
    expect(r.curve.filter((p) => p.finite).length).toBeGreaterThan(200);
    // And the ends of the range say why: 40 mm is nowhere near what this
    // curvature can deliver over the interval it was given.
    expect(Math.min(Math.abs(r.rangeLoMm), Math.abs(r.rangeHiMm))).toBeGreaterThan(40);
  });

  it("refuses an interval that is not somewhere to look, in its own voice", () => {
    for (const interval of [[5, 5], [10, 1], [Number.NaN, 1]] as const) {
      const r = describeDesign(spec({ interval }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.source).toBe("app");
        expect(r.error).toMatch(/somewhere to look/);
      }
    }
    const zero = describeDesign(spec({ target: { kind: "efl", value: 0 } }));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toMatch(/not a design target/);
  });

  /**
   * Every seed opens on a state that answers rather than refuses — except the
   * two borrowed fixtures, which are allowed to refuse only if their own default
   * target says so, and neither does. Cheap, and it is the check that would have
   * caught a default interval edited without its target.
   */
  it("opens every seed on a question that has an answer", () => {
    for (const seed of DESIGN_SEEDS) {
      const r = describeDesign(seedSpec(seed.id));
      expect(r.ok, seed.id).toBe(true);
      if (r.ok) expect("x" in r.solution, `${seed.id}: ${JSON.stringify(r.solution)}`).toBe(true);
    }
  });

  /**
   * Loose on purpose: the claim on screen is 0.75 ms for the whole readout —
   * a 241-point curve, the solve, the same solve at four times the cells, and
   * two control solves — and a bound at 50 would still catch the kind of
   * regression that matters here, which is a traced quantity finding its way
   * into a first-order panel and costing four orders more.
   */
  it("stays a paraxial panel", () => {
    expect(readout().elapsedMs).toBeLessThan(50);
  });
});

