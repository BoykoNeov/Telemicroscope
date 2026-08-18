import { describe, expect, it } from "vitest";
import { abbeCondenser } from "../src/designs/condenser";
import { finiteConjugateMicroscope, finiteConjugateObjective } from "../src/designs/microscope";
import { makeRay } from "../src/trace/ray";
import { traceRay } from "../src/trace/sequential";
import {
  diaphragmLanding,
  reverseCondenser,
  tracedCondenserCone,
} from "../src/imaging/condenser-field";
import {
  fieldPupilAt,
  illuminationOffset,
  imageRadiusForObjectHeight,
  objectFieldTile,
  pupilSlopeFrame,
  tracedPupil,
} from "../src/imaging/object-field";
import { renderBrightfield } from "../src/imaging/brightfield";
import { brightfieldFidelity } from "../src/illumination/fidelity";
import { latticeDiskSource, translateSource, type SourcePoint } from "../src/illumination/source";
import { abbeImage, cosineGratingObject } from "../src/illumination/abbe";

/**
 * Step 6ag — the traced cone into `CondenserSource`.
 *
 * § 6x's last deferral, second half, and the microscope branch's last piece.
 * § 6af built the condenser and measured its aberration as an AMBIGUITY in
 * `illumination/source`'s premise; this step is the wiring, and the wiring turned
 * out to change what the finding is.
 *
 * ## The construction, and why it is not the obvious one
 *
 * Forward — sample the diaphragm, solve for the ray that reaches the specimen
 * point — is what § 6af's fixture does and it costs a ninety-step bisection per
 * direction. Backwards — launch from the specimen point in a chosen direction and
 * see where it lands on the diaphragm — costs **one trace** and inverts the
 * forward solve to 1e-15. That is a change of variables in the source integral,
 * from diaphragm area to solid angle, and it carries the Jacobian
 * `dA_diaphragm/ds` as the weight.
 *
 * It is not a convenience. It moves the condenser's aberration out of the sample
 * POSITIONS and into the sample WEIGHTS, and that has two consequences the
 * deferral note did not anticipate — one of them the opposite of what it
 * predicted.
 *
 * ## What is EXTERNAL here, and the honest answer is nothing new
 *
 * § 6af spent this branch's external numbers on the lens itself: Coddington's
 * thin-lens polynomial and the Abbe number's own linearization error, both
 * published closed forms, both pinned there. There is no catalogued number for
 * "the source an Abbe condenser presents to a DIN objective" — nobody publishes
 * one — and this file does not pretend otherwise.
 *
 * What it pins instead, and each is a real constraint rather than a restatement:
 *
 *  - **The forward solve**, which is § 6af's own independently-written fixture,
 *    inverted to machine precision. Two constructions, no shared code.
 *  - **The aberration-free limit**, reached by closing the condenser's aperture,
 *    where the traced cone must become the paraxial disc — and it does, as NA³.
 *  - **`h/R_ep`**, § 6x.1's closed form, as the σ = 0 case of the same frame.
 *  - **Convergence** in the diaphragm sampling, and in the field.
 *
 * ## The fixture
 *
 * The shipped DIN 4×/0.10, rim-stopped (its default), with a matched Abbe
 * condenser at NA 0.10 and its diaphragm at 0.8 of wide open. Grids are small;
 * every rung that pins a number says which quadrature it was measured on,
 * because two of them are quadrature-sensitive and saying so is the point.
 */

const L = 587.5618;
const SIZE = 64;
const PS = 16;
const CYCLES = 4;
const APERTURE = 0.8;
const FIELD_EDGE = 2.25;

const din4x = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  }).system;

const tanOf = (na: number) => na / Math.sqrt(1 - na * na);

const GRATING = cosineGratingObject({ size: SIZE, cycles: CYCLES, modulation: 0.6 });

/**
 * A perfect pupil — the control the WEIGHT rungs are measured on, and not a
 * convenience.
 *
 * What this step adds is a property of the **source**, and measuring it through
 * a traced objective would put that objective's own aberration in the answer.
 * It also puts the objective's own *sampling* there: the shipped DIN's traced
 * wavefront is `no-honest-image` at this file's `pupilSamples` past about a
 * millimetre of field (§ 6ag.4's last rung pins that, rather than leaving the
 * fixture to be trusted), so a contrast measured through it off axis would be a
 * number the engine itself refuses. The ideal pupil has neither problem and
 * isolates exactly one thing.
 *
 * § 6ag.4 then measures, separately and at a field point where the traced pupil
 * IS honest, how much the real lens amplifies it — which turns out to be 2.9x
 * and is a finding rather than a caveat.
 */
const IDEAL = {
  amplitude: (px: number, py: number) => (px * px + py * py <= 1 ? 1 : 0),
  phaseWaves: () => 0,
};

/**
 * FORWARD: one ray from diaphragm point `xd`, aimed at height `aim` on the
 * condenser's first vertex. § 6af's own fixture, repeated here deliberately —
 * § 6ag.1 checks the backwards construction against it, and a shared helper
 * would make that a check of one thing against itself.
 */
function shoot(c: ReturnType<typeof abbeCondenser>, xd: number, aim: number) {
  const dz = c.frontFocalDistanceMm;
  const dx = aim - xd;
  const norm = Math.hypot(dx, dz);
  const ux = dx / norm;
  const uz = dz / norm;
  const back = 1;
  const r = makeRay({ x: xd - (ux * back) / uz, y: 0, z: -back }, { x: ux, y: 0, z: uz }, L);
  const t = traceRay(c.prescription, r);
  if (t.status !== "ok" || !t.ray) return null;
  const slope = t.ray.dir.x / t.ray.dir.z;
  const zSpecimen = c.prescription.surfaces.reduce((z, s) => z + s.thickness, 0);
  return { h: t.ray.origin.x + slope * (zSpecimen - t.ray.origin.z), slope };
}

/** FORWARD: the slope diaphragm point `xd` sends to specimen height `yTarget`. */
function slopeTo(c: ReturnType<typeof abbeCondenser>, xd: number, yTarget: number) {
  const find = (sign: 1 | -1) => {
    for (let a = c.glassSemiDiameterMm * 0.999; a > 1e-4; a *= 0.97) {
      const f = shoot(c, xd, sign * a);
      if (f) return { aim: sign * a, h: f.h };
    }
    return null;
  };
  const lower = find(-1);
  const upper = find(1);
  if (!lower || !upper) return null;
  if ((lower.h - yTarget) * (upper.h - yTarget) > 0) return null;
  let lo = lower.aim;
  let hi = upper.aim;
  let hLo = lower.h;
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    const f = shoot(c, xd, mid);
    if (!f) return null;
    if ((hLo - yTarget) * (f.h - yTarget) <= 0) hi = mid;
    else {
      lo = mid;
      hLo = f.h;
    }
  }
  return shoot(c, xd, 0.5 * (lo + hi))!.slope;
}

/**
 * The cone's edge in PUPIL coordinates, by bisection — resolution-free, where
 * reading the outermost lattice point is limited by the lattice.
 *
 * `dir` picks the +x or −x meridional edge. The predicate is the mask's own:
 * does the back-traced ray land inside the diaphragm.
 */
function coneEdge(
  system: ReturnType<typeof din4x>,
  c: ReturnType<typeof abbeCondenser>,
  h: number,
  dir: 1 | -1,
  apertureFraction = 1,
): number {
  const rev = reverseCondenser(c, L);
  const frame = pupilSlopeFrame(system, h, L);
  const radius = c.diaphragmRadiusMm * apertureFraction;
  const inside = (rho: number): boolean => {
    const b = diaphragmLanding(rev, h, frame.slopeOf(rho), 0);
    return b !== null && Math.hypot(b.x, b.y) <= radius;
  };
  const start = frame.chief === 0 ? 0 : frame.pupilOf(0);
  let lo = start;
  let hi = start + dir * 4;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Both weightings on ONE fine quadrature — the only way to measure what the
 * weights do without the mask's own discretization in the answer.
 *
 * A Cartesian grid over a hard-edged mask converges at the boundary cells only,
 * so a difference of two *differently* masked images carries an O(1/n) error that
 * does not cancel — measured, and it is why this rung compares the Jacobian
 * against uniform weights on an IDENTICAL point set instead of comparing the
 * traced cone against a displaced disc. The quadrature then cancels exactly and
 * what is left is the weights.
 */
function weightedPair(
  system: ReturnType<typeof din4x>,
  c: ReturnType<typeof abbeCondenser>,
  h: number,
  n: number,
) {
  const rev = reverseCondenser(c, L);
  const frame = pupilSlopeFrame(system, h, L);
  const centre = frame.chief === 0 ? 0 : frame.pupilOf(0);
  const reach = 1.3 * APERTURE;
  const radius = c.diaphragmRadiusMm * APERTURE;
  const r2 = radius * radius;
  const d = 1e-4;
  const pts: SourcePoint[] = [];
  let jMin = Infinity;
  let jMax = 0;
  for (let jy = 0; jy < n; jy++) {
    const sy = reach * ((2 * (jy + 0.5)) / n - 1);
    for (let jx = 0; jx < n; jx++) {
      const sx = centre + reach * ((2 * (jx + 0.5)) / n - 1);
      const s0x = frame.slopeOf(sx);
      const s0y = sy * frame.span;
      const b = diaphragmLanding(rev, h, s0x, s0y);
      if (b === null || b.x * b.x + b.y * b.y > r2) continue;
      const dx = d * frame.span;
      const xp = diaphragmLanding(rev, h, s0x + dx, s0y);
      const xm = diaphragmLanding(rev, h, s0x - dx, s0y);
      const yp = diaphragmLanding(rev, h, s0x, s0y + dx);
      const ym = diaphragmLanding(rev, h, s0x, s0y - dx);
      if (!xp || !xm || !yp || !ym) continue;
      const jac = Math.abs(
        ((xp.x - xm.x) / (2 * d)) * ((yp.y - ym.y) / (2 * d)) -
          ((yp.x - ym.x) / (2 * d)) * ((xp.y - xm.y) / (2 * d)),
      );
      jMin = Math.min(jMin, jac);
      jMax = Math.max(jMax, jac);
      pts.push({ sx, sy, weight: jac });
    }
  }
  const norm = (ps: SourcePoint[]) => {
    const t = ps.reduce((a, p) => a + p.weight, 0);
    return {
      points: ps.map((p) => ({ sx: p.sx, sy: p.sy, weight: p.weight / t })),
      coherenceParameter: APERTURE,
      samples: n,
    };
  };
  return {
    jacobian: norm(pts),
    uniform: norm(pts.map((p) => ({ ...p, weight: 1 }))),
    spread: jMax / jMin - 1,
    count: pts.length,
  };
}

function contrastAt(intensity: Float64Array, n: number, kx: number): number {
  let dc = 0;
  let re = 0;
  let im = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = intensity[y * n + x]!;
      dc += v;
      const ang = (-2 * Math.PI * kx * x) / n;
      re += v * Math.cos(ang);
      im += v * Math.sin(ang);
    }
  }
  const mean = dc / (n * n);
  return (2 * Math.hypot(re, im)) / (n * n) / mean;
}

/** The tile at object height `h`, and the pupil its centre looks through. */
function tileAt(system: ReturnType<typeof din4x>, h: number, pupilSamples = PS, size = SIZE) {
  const frame = objectFieldTile(system, {
    size,
    pupilSamples,
    wavelengthNm: L,
    centreMm: { x: imageRadiusForObjectHeight(system, h, L), y: 0 },
  });
  return {
    frame,
    patch: fieldPupilAt(system, frame, 0.5, 0.5),
    objectSpanMm: size * frame.objectPixelScaleMm,
    halfWidthMm: (size / 2) * frame.objectPixelScaleMm,
  };
}

describe("§ 6ag.1 — the construction runs BACKWARDS, and that is what makes it cheap", () => {
  const system = din4x();

  it("inverts § 6af's forward solve to 1e-15, at two apertures across the field", () => {
    // The forward fixture bisects on the aim — ninety traces to find the ray from
    // one diaphragm point that reaches one specimen point. The backwards one
    // launches from the specimen point and reads the diaphragm off the ray, in
    // ONE trace. They are independent constructions through the same glass, and
    // they agree to the last bits rather than to a bisection tolerance.
    for (const na of [0.1, 0.3]) {
      const c = abbeCondenser({ numericalAperture: na });
      const rev = reverseCondenser(c, L);
      for (const h of [0, 0.5, FIELD_EDGE]) {
        for (const rho of [0, 0.5, 0.999]) {
          const xd = c.diaphragmRadiusMm * rho;
          const sigma = slopeTo(c, xd, h);
          expect(sigma).not.toBeNull();
          const landing = diaphragmLanding(rev, h, sigma!, 0);
          expect(landing).not.toBeNull();
          expect(Math.abs(landing!.x - xd)).toBeLessThan(2e-15);
        }
      }
    }
  });

  it("costs 5 traces per surviving direction, where the forward solve costs ~90", () => {
    // One for membership, four for the central difference that gives the weight.
    // Reported off the constructor rather than counted here, because the cost is
    // a property of the thing that ships.
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const rev = reverseCondenser(c, L);
    const cone = tracedCondenserCone(system, rev, FIELD_EDGE, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    expect(cone.points.length).toBe(128);
    // Candidates outside the mask cost one trace, members cost five.
    expect(cone.traces).toBeGreaterThan(5 * cone.points.length);
    expect(cone.traces / cone.points.length).toBeLessThan(90);
  });

  it("refuses a lattice too coarse to land in the diaphragm at all", () => {
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const rev = reverseCondenser(c, L);
    // Off axis, because ON axis the refusal is unreachable and that is a fact
    // about the construction rather than a gap in it: the candidate grid is the
    // global lattice, so it always contains the origin, and the axial direction
    // always lands on the diaphragm's own centre. A cone at h = 0 therefore
    // degenerates to one on-axis point instead of to none — which is
    // `latticeDiskSource`'s "S → 0 becomes `coherentSource` without a special
    // case", reached here through a trace.
    expect(() =>
      tracedCondenserCone(system, rev, FIELD_EDGE, {
        pupilSamples: PS,
        stepMultiple: 64,
        apertureFraction: 0.02,
      }),
    ).toThrow(/landed no point inside a diaphragm/);
    const degenerate = tracedCondenserCone(system, rev, 0, {
      pupilSamples: PS,
      stepMultiple: 64,
      apertureFraction: 0.02,
    });
    expect(degenerate.points.length).toBe(1);
    expect(degenerate.points[0]).toEqual({ sx: 0, sy: 0, weight: 1 });
    expect(() =>
      tracedCondenserCone(system, rev, 0, { pupilSamples: 24, apertureFraction: APERTURE }),
    ).toThrow(/power of two/);
    expect(() =>
      tracedCondenserCone(system, rev, 0, { pupilSamples: PS, apertureFraction: 1.5 }),
    ).toThrow(/cannot be opened past its own engraved NA/);
  });
});

describe("§ 6ag.2 — the mask is EXPLICIT, and that is load-bearing rather than tidy", () => {
  const system = din4x();

  it("the reversed chain's own stop carries the WIDE-OPEN radius, so the trace cannot close it", () => {
    // `reversePrescription` moves `isStop` with its surface, so the diaphragm
    // ends up at the far end of the reversed chain still carrying the
    // semi-diameter the condenser was *engraved* at. The tracer therefore clips
    // at wide open and at nothing else — which means a closed diaphragm is
    // expressed by this module's mask or it is not expressed at all.
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const rev = reverseCondenser(c, L);
    const last = rev.prescription.surfaces[rev.prescription.surfaces.length - 1]!;
    expect(last.isStop).toBe(true);
    expect(last.semiAperture).toBe(c.diaphragmRadiusMm);

    // And the mask does close it: the cone's edge follows `apertureFraction`.
    const wide = coneEdge(system, c, 0, 1, 1);
    const closed = coneEdge(system, c, 0, 1, 0.5);
    expect(closed / wide).toBeGreaterThan(0.49);
    expect(closed / wide).toBeLessThan(0.51);
    // Without the mask the trace would have given the wide-open edge for both,
    // so the ratio would have been 1 — which is the failure this rung exists for.
    expect(closed).toBeLessThan(0.6 * wide + 1e-12);
  });
});

describe("§ 6ag.3 — CURRENCY: the pupil coordinate is a tangent, and a sine never converges", () => {
  const system = din4x();

  it("the aimer's span IS tan u_max, bitwise, at three field heights", () => {
    for (const h of [0, 1, FIELD_EDGE]) {
      expect(pupilSlopeFrame(system, h, L).span).toBe(tanOf(0.1));
    }
  });

  it("`illuminationOffset` is the sigma = 0 case of the same frame, bitwise", () => {
    // The refactor that exported the frame must not have moved § 6x.1's pin.
    for (const h of [0.25, 1, FIELD_EDGE]) {
      const frame = pupilSlopeFrame(system, h, L);
      expect(illuminationOffset(system, h, L)).toBe(frame.pupilOf(0));
    }
    // …and the telecentric/on-axis zero stays a bitwise zero, which is what lets
    // `translateSource` return its input object (§ 6x).
    expect(illuminationOffset(system, 0, L)).toBe(0);
  });

  it("THE MEASUREMENT: closing the aperture reaches the TANGENT ratio as NA³, and the sine ratio never", () => {
    // The aberration-free limit, on axis. As the condenser's own NA closes, its
    // cone must become the paraxial disc — and which disc depends on a choice
    // that looks like bookkeeping and is not. `illumination/source` says a point
    // at radius rho is illumination NA rho·NA_obj, a ratio of SINES. The aimer
    // parametrizes the pupil by a TANGENT.
    //
    // Against the tangent reading the residual falls as NA³ — third-order
    // spherical, which is the only thing left — and it is the ABSOLUTE departure
    // that carries that order. As a fraction of the cone's own radius, which
    // itself falls as NA, the same quantity falls as NA²; both are asserted,
    // because quoting one order for the other is precisely the kind of slip this
    // rung is about.
    //
    // Against the sine reading it stops falling at 0.5% and stays there, because
    // that is not an aberration — it is the currency, and no lens improves it.
    const absTan: number[] = [];
    const relTan: number[] = [];
    const relSin: number[] = [];
    const nas = [0.1, 0.05, 0.01, 0.001];
    for (const na of nas) {
      const c = abbeCondenser({ numericalAperture: na });
      const edge = coneEdge(system, c, 0, 1, 1);
      const tanRatio = tanOf(na) / tanOf(0.1);
      absTan.push(Math.abs(edge - tanRatio));
      relTan.push(Math.abs(edge - tanRatio) / tanRatio);
      relSin.push(Math.abs(edge - na / 0.1) / (na / 0.1));
    }
    expect(absTan[0]!).toBeCloseTo(5.188e-3, 5);
    expect(absTan[3]!).toBeLessThan(1e-8);
    for (let i = 1; i < nas.length; i++) {
      const ratio = nas[i - 1]! / nas[i]!;
      // Absolute: NA³, to better than 1%.
      expect(absTan[i - 1]! / absTan[i]! / ratio ** 3).toBeCloseTo(1, 1);
      // Relative: NA², to the same.
      expect(relTan[i - 1]! / relTan[i]! / ratio ** 2).toBeCloseTo(1, 1);
    }
    // The sine reading floors at the tan/sin gap of the OBJECTIVE's own NA, and
    // reaches it from both sides — at NA 0.05 the condenser's aberration happens
    // to cancel part of it, which is why the band is a floor and not an equality.
    for (let i = 1; i < nas.length; i++) expect(relSin[i]!).toBeGreaterThan(2e-3);
    expect(relSin[3]!).toBeCloseTo(1 - 0.1 / tanOf(0.1) / (0.1 / 0.1), 4);
    expect(relSin[3]!).toBeCloseTo(5.0e-3, 4);
    // Six orders between the two readings at the smallest aperture — the point.
    expect(relSin[3]! / relTan[3]!).toBeGreaterThan(1e3);
  });
});

describe("§ 6ag.4 — THE FINDING: the condenser's aberration lands in the WEIGHTS", () => {
  const system = din4x();
  const c = abbeCondenser({ numericalAperture: 0.1 });

  it("the cone's Jacobian spread grows from 1.3% on axis to 11.3% at the field edge", () => {
    // What every `CondenserSource` before this one assumed was uniform. On axis
    // the spread is rotationally symmetric and is the condenser's spherical; off
    // axis it becomes a one-sided taper, and it is that taper the image sees.
    const rev = reverseCondenser(c, L);
    const spreads = [0, 1, FIELD_EDGE].map(
      (h) =>
        tracedCondenserCone(system, rev, h, {
          pupilSamples: PS,
          apertureFraction: APERTURE,
        }).weightSpread,
    );
    expect(spreads[0]!).toBeCloseTo(0.0132, 3);
    expect(spreads[1]!).toBeCloseTo(0.0495, 3);
    expect(spreads[2]!).toBeCloseTo(0.113, 2);
    // Monotone in the field, which a spherical-plus-coma taper must be.
    expect(spreads[1]!).toBeGreaterThan(spreads[0]!);
    expect(spreads[2]!).toBeGreaterThan(spreads[1]!);
  });

  it("THE MEASUREMENT: on an IDENTICAL point set, the weights alone move the image", () => {
    // The quadrature cancels exactly — same points, same mask, only the weights
    // differ — so this is the weights and nothing else, on a perfect pupil so it
    // is the SOURCE and nothing else. Two refinements, because the claim is that
    // the number has converged and not that one grid said it.
    const at = (h: number) =>
      [31, 45].map((n) => {
        const p = weightedPair(system, c, h, n);
        const opts = { pupilSamples: PS };
        return (
          contrastAt(abbeImage(GRATING, IDEAL, p.jacobian, opts).intensity, SIZE, CYCLES) /
            contrastAt(abbeImage(GRATING, IDEAL, p.uniform, opts).intensity, SIZE, CYCLES) -
          1
        );
      });

    // On axis the taper is rotationally symmetric — it is the condenser's own
    // spherical — and it RAISES contrast, slightly.
    const onAxis = at(0);
    expect(onAxis[0]!).toBeGreaterThan(0);
    expect(onAxis[0]!).toBeCloseTo(6.89e-4, 5);
    expect(Math.abs(onAxis[1]! - onAxis[0]!)).toBeLessThan(5e-5);

    // At the field edge it becomes one-sided, and LOWERS contrast by ten times
    // as much. Converged to four digits across grids 2.1x apart in point count.
    const edge = at(FIELD_EDGE);
    expect(edge[0]!).toBeLessThan(0);
    expect(edge[0]!).toBeCloseTo(-6.613e-3, 5);
    expect(Math.abs(edge[1]! - edge[0]!)).toBeLessThan(5e-5);
    expect(Math.abs(edge[0]! / onAxis[0]!)).toBeGreaterThan(8);
  });

  it("…and the objective's OWN aberration amplifies it 2.9x, so the two are not independent", () => {
    // Measured at 1 mm and at `pupilSamples` 32, which is where the shipped DIN's
    // traced wavefront still rules `valid` — the rung below pins that this fixture
    // choice is forced rather than preferred. Same cone, same weights, same
    // points: the only change is a real pupil in place of the perfect one, and
    // the source's reweighting comes out nearly three times larger through it.
    const bigSize = 128;
    const bigPs = 32;
    const bigGrating = cosineGratingObject({ size: bigSize, cycles: 8, modulation: 0.6 });
    const tile = tileAt(system, 1, bigPs, bigSize);
    expect(brightfieldFidelity(tile.patch.sampling, bigPs).verdict).toBe("valid");
    const opts = { pupilSamples: bigPs, scale: tile.frame.scale };
    const through = [21, 31].map((n) => {
      const p = weightedPair(system, c, tile.patch.objectHeightMm, n);
      return (
        contrastAt(abbeImage(bigGrating, tile.patch.pupil, p.jacobian, opts).intensity, bigSize, 8) /
          contrastAt(abbeImage(bigGrating, tile.patch.pupil, p.uniform, opts).intensity, bigSize, 8) -
        1
      );
    });
    // The finer grid is the quoted number; the coarser is there to say it has
    // stopped moving. A third level costs 5 s of suite time and moved it 3e-4
    // when it was run, so two are what ship.
    expect(through[1]!).toBeCloseTo(-4.86e-3, 4);
    expect(Math.abs(through[1]! - through[0]!)).toBeLessThan(1e-3);
    // The same field point through the ideal pupil, for the ratio.
    const ideal = (() => {
      const p = weightedPair(system, c, 1, 31);
      const o = { pupilSamples: PS };
      return (
        contrastAt(abbeImage(GRATING, IDEAL, p.jacobian, o).intensity, SIZE, CYCLES) /
          contrastAt(abbeImage(GRATING, IDEAL, p.uniform, o).intensity, SIZE, CYCLES) -
        1
      );
    })();
    expect(ideal).toBeCloseTo(-1.599e-3, 5);
    expect(through[1]! / ideal).toBeGreaterThan(2.5);
    expect(through[1]! / ideal).toBeLessThan(3.3);
  });

  it("THE CONTROL: the aberration-free limit flattens the weights entirely", () => {
    // § 6ae.5's shape — not a second design, the same lens with its aperture
    // closed. The spread has to vanish, and it does, at roughly NA². "Roughly"
    // is meant: a max/min ratio is not an aberration coefficient, so the measured
    // per-halving factors are 4.26 and 4.70 rather than 4.00, and pinning them as
    // 4 exactly would be pinning a coincidence.
    const spreads = [0.1, 0.05, 0.025].map((na) => {
      const cc = abbeCondenser({ numericalAperture: na });
      return tracedCondenserCone(system, reverseCondenser(cc, L), 0, {
        pupilSamples: 128,
        stepMultiple: 4,
        apertureFraction: 1,
        reach: 1.3 * (na / 0.1),
      }).weightSpread;
    });
    expect(spreads[0]!).toBeCloseTo(2.084e-2, 4);
    expect(spreads[2]!).toBeCloseTo(1.040e-3, 4);
    // Twenty-fold over four-fold of aperture, which is the NA² claim in the form
    // that does not depend on the two intermediate ratios.
    expect(spreads[0]! / spreads[2]!).toBeGreaterThan(16);
    expect(spreads[0]! / spreads[2]!).toBeLessThan(25);
    for (let i = 1; i < spreads.length; i++) {
      expect(spreads[i - 1]! / spreads[i]!).toBeGreaterThan(3.5);
      expect(spreads[i - 1]! / spreads[i]!).toBeLessThan(5.5);
    }
  });

  it("the fixture's own honesty, pinned rather than trusted", () => {
    // Why the weight rungs use a perfect pupil: this file's `pupilSamples` cannot
    // carry the shipped DIN's traced wavefront off axis, so a contrast measured
    // through it there would be one `illumination/fidelity` refuses. Stating the
    // boundary is what makes the choice a reason instead of a preference — and it
    // is also the § 6h.5 result restated in this file's own units.
    expect(brightfieldFidelity(tileAt(system, 0, PS).patch.sampling, PS).verdict).toBe("valid");
    expect(brightfieldFidelity(tileAt(system, 1, PS).patch.sampling, PS).verdict).toBe(
      "no-honest-image",
    );
    expect(brightfieldFidelity(tileAt(system, 1, 32, 128).patch.sampling, 32).verdict).toBe("valid");
    expect(
      brightfieldFidelity(tileAt(system, FIELD_EDGE, 32, 128).patch.sampling, 32).verdict,
    ).toBe("no-honest-image");
    expect(
      brightfieldFidelity(tileAt(system, FIELD_EDGE, 64, 256).patch.sampling, 64).verdict,
    ).toBe("valid");
  });
});

describe("§ 6ag.5 — the coupling is ONE knob, and the failure mode is discrete", () => {
  const system = din4x();
  const c = abbeCondenser({ numericalAperture: 0.1 });
  const rev = reverseCondenser(c, L);

  it("THE LAW: a tile's object span times the source's sampling step is CONSTANT", () => {
    // § 6af deferred "patch size and source sampling are coupled" as the thing to
    // pin. They are coupled through `pupilSamples` and through nothing else, in
    // opposite directions, and the product is a constant of the system — so a
    // caller cannot buy a wider tile without buying a coarser cone. § 6af's own
    // two feasibility patch sizes, 0.094 mm and 0.374 mm, are pupilSamples 32 and
    // 128 and are not independent choices at all.
    const products = [16, 32, 64, 128].map((ps) => {
      const frame = objectFieldTile(system, {
        size: SIZE,
        pupilSamples: ps,
        wavelengthNm: L,
        centreMm: { x: 0, y: 0 },
      });
      return SIZE * frame.objectPixelScaleMm * (2 / ps);
    });
    for (const p of products) expect(p).toBeCloseTo(products[0]!, 12);
    expect(products[0]!).toBeCloseTo(5.846166e-3, 9);

    // And the two feasibility sizes § 6af quoted are exactly these two rows.
    const span = (ps: number) =>
      SIZE *
      objectFieldTile(system, { size: SIZE, pupilSamples: ps, wavelengthNm: L, centreMm: { x: 0, y: 0 } })
        .objectPixelScaleMm;
    expect(span(32)).toBeCloseTo(0.0935, 4);
    expect(span(128)).toBeCloseTo(0.3742, 4);
  });

  it("the failure mode is MEMBERSHIP, and refining the source does not reduce it", () => {
    // Forward, the hazard was a direction drifting a fraction of a step across
    // the patch. Backwards, positions do not drift at all: what changes across a
    // tile is the weights (smoothly, and small) and membership (discretely — a
    // lattice point in the cone at one tile edge and out at the other, which is a
    // step in the image and not a small error).
    //
    // The fraction is scale-INVARIANT in the sampling step, because the mask's
    // boundary grows with the point count exactly as fast as the count does. So
    // the flips cannot be refined away by sampling the cone more finely; they are
    // reduced by narrowing the tile, which is the same knob pulling the other way.
    const rows = [16, 32, 64].map((ps) => {
      const tile = tileAt(system, 1, ps);
      return [1, 2].map((m) => {
        const cone = tracedCondenserCone(system, rev, 1, {
          pupilSamples: ps,
          stepMultiple: m,
          apertureFraction: APERTURE,
          tileHalfWidthMm: tile.halfWidthMm,
        });
        return { ps, m, cone, span: tile.objectSpanMm };
      });
    });
    // At one pupilSamples, halving the step quadruples the count and leaves the
    // FRACTION where it was — within a factor of two, on counts 4x apart.
    //
    // Asserted from `pupilSamples` 32 up, and the exclusion is the claim's own
    // limit rather than a convenience: at 16 with `stepMultiple` 2 the cone holds
    // 33 points, its mask boundary is a dozen of them, and a boundary that sparse
    // has no fraction to be invariant — it reads exactly 0 flips, which is a
    // rounding of the geometry and not evidence about it.
    for (const [fine, coarse] of rows.slice(1).map((r) => [r[0]!, r[1]!] as const)) {
      expect(fine.cone.fidelity.membershipFlips).toBeGreaterThan(0);
      expect(coarse.cone.points.length).toBeLessThan(fine.cone.points.length / 2);
      expect(coarse.cone.fidelity.flipFraction).toBeGreaterThan(
        0.4 * fine.cone.fidelity.flipFraction,
      );
      expect(coarse.cone.fidelity.flipFraction).toBeLessThan(
        2.5 * fine.cone.fidelity.flipFraction,
      );
    }
    // Across pupilSamples it GROWS, because the tile widens with it.
    expect(rows[2]![0]!.cone.fidelity.flipFraction).toBeGreaterThan(
      1.5 * rows[1]![0]!.cone.fidelity.flipFraction,
    );
    expect(rows[1]![0]!.cone.fidelity.flipFraction).toBeCloseTo(0.029, 2);
    expect(rows[2]![0]!.cone.fidelity.flipFraction).toBeCloseTo(0.058, 2);
  });

  it("the verdict reports, and says which knob — never throws, and never assumes", () => {
    // `illumination/fidelity`'s convention: absent information reads `unknown`
    // rather than fine, and a verdict is a field a caller decides about.
    const noTile = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    expect(noTile.fidelity.verdict).toBe("unknown");
    expect(noTile.fidelity.reason).toMatch(/not measured/);

    const narrow = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
      tileHalfWidthMm: tileAt(system, 1, PS).halfWidthMm,
    });
    expect(narrow.fidelity.verdict).toBe("valid");

    const wide = tracedCondenserCone(system, rev, 1, {
      pupilSamples: 64,
      apertureFraction: APERTURE,
      tileHalfWidthMm: tileAt(system, 1, 64).halfWidthMm,
    });
    expect(wide.fidelity.verdict).toBe("coarse");
    // The refusal names the knob that helps AND the one that does not, which is
    // the whole content of the law above.
    expect(wide.fidelity.reason).toMatch(/Lower pupilSamples/);
    expect(wide.fidelity.reason).toMatch(/refining stepMultiple does NOT help/);
  });
});

describe("§ 6ag.5b — the three readouts that had to respond, and one that had to turn", () => {
  const system = din4x();
  const c = abbeCondenser({ numericalAperture: 0.1 });
  const rev = reverseCondenser(c, L);

  it("THE AZIMUTH TURNS THE CONE, and the cone is not symmetric so that is not free", () => {
    // The condenser is rotationally symmetric; the cone it delivers to a field
    // point is NOT — § 6ag.8 measures it reaching +0.9236 and −1.0702 about its
    // own offset, which is coma. So a field point at azimuth φ is lit by the
    // meridional cone TURNED by φ, and handing every tile the meridional one
    // would point every tile's illumination asymmetry the same way. That is
    // `imaging/object-field`'s own named hazard, on the other side of the
    // specimen, and it is invisible to any fixture that only ever sits on +x.
    const mer = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    const quarter = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
      azimuthRad: Math.PI / 2,
    });
    // Same cone, so the same point count and the same multiset of weights.
    expect(quarter.points.length).toBe(mer.points.length);
    expect(quarter.weightSpread).toBeCloseTo(mer.weightSpread, 12);
    // A quarter turn is exact on a square lattice, so this one can be checked as
    // an identity: (sx, sy) -> (-sy, sx), weight unchanged.
    const key = (x: number, y: number) => `${Math.round(x * 1e9)},${Math.round(y * 1e9)}`;
    // Relative, and at 1e-10 rather than at the last bit, for a reason that is
    // arithmetic rather than optical: the weight is a CENTRAL DIFFERENCE at a
    // 1e-4 step, so it carries ~5e-12 of cancellation noise before anything is
    // rotated (f64 positions of order 1 mm, divided by a 2e-5 mm interval). The
    // turn itself contributes less — cos(π/2) is 6.1e-17 rather than a bitwise
    // zero. Tightening this past the difference's own floor would be pinning
    // the noise, so the threshold sits an order above it and the identity is
    // still 8 orders tighter than any physical difference here.
    const turned = new Map(mer.points.map((p) => [key(-p.sy, p.sx), p.weight]));
    for (const p of quarter.points) {
      const t = turned.get(key(p.sx, p.sy));
      expect(t).toBeDefined();
      expect(Math.abs(t! - p.weight) / p.weight).toBeLessThan(1e-10);
    }
    // …and it really did move: the meridional cone is NOT its own quarter turn,
    // which is the assertion that fails if `azimuthRad` is ignored.
    const same = new Map(mer.points.map((p) => [key(p.sx, p.sy), p.weight]));
    let differing = 0;
    for (const p of quarter.points) if (same.get(key(p.sx, p.sy)) !== p.weight) differing++;
    expect(differing).toBeGreaterThan(0.2 * quarter.points.length);
    // Still on the lattice after turning, because the ROTATION IS APPLIED TO THE
    // SAMPLING and not to the result — the whole reason it is done that way.
    for (const p of quarter.points) {
      expect(Number.isInteger(p.sx * PS)).toBe(true);
      expect(Number.isInteger(p.sy * PS)).toBe(true);
    }
  });

  it("…and an arbitrary azimuth stays on the lattice too, where turning the RESULT would not", () => {
    const odd = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
      azimuthRad: 0.7,
    });
    expect(odd.pupilLattice).toBeDefined();
    for (const p of odd.points) {
      expect(Number.isInteger(p.sx * PS)).toBe(true);
      expect(Number.isInteger(p.sy * PS)).toBe(true);
    }
    // A rotation of the finished points by 0.7 rad lands on no lattice at all —
    // stated as the thing that was avoided, not as a property of the code.
    const rotated = { sx: 0.125 * Math.cos(0.7), sy: 0.125 * Math.sin(0.7) };
    expect(Number.isInteger(rotated.sx * PS)).toBe(false);
  });

  it("REFUSES a candidate grid the cone reaches the edge of, rather than truncating it", () => {
    // S > 1 is modelled (`abbeImage`, and darkfield lives there), so a condenser
    // with more aperture than the objective puts the cone past the default reach
    // — and the mask is then never asked about what lies outside. Silently
    // truncated, that is a plausible image; refused, it is a message naming the
    // knob.
    const bright = abbeCondenser({ numericalAperture: 0.3 });
    const brightRev = reverseCondenser(bright, L);
    expect(() =>
      tracedCondenserCone(system, brightRev, 0, { pupilSamples: PS, apertureFraction: 1 }),
    ).toThrow(/TRUNCATED cone/);
    // With room to hold it, the same cone builds — and reaches past 1, which is
    // what the default could not have covered.
    const wide = tracedCondenserCone(system, brightRev, 0, {
      pupilSamples: PS,
      apertureFraction: 1,
      reach: 4,
    });
    let maxR = 0;
    for (const p of wide.points) maxR = Math.max(maxR, Math.hypot(p.sx, p.sy));
    expect(maxR).toBeGreaterThan(1.35);
  });

  it("`coherenceParameter` is S = NA_cond/NA_obj, NOT the fraction the diaphragm is closed to", () => {
    // The two coincide exactly when the two lenses share an aperture, which is
    // this file's own fixture — so the rung is written on a condenser whose NA
    // differs from the objective's, or it would pass under either reading. That
    // is § 6ag.3's currency slip in the shape it would actually have shipped in:
    // `intensityCutoff` and `weakObjectTransferDisk` both take an S, and a panel
    // would hand them this field.
    const half = abbeCondenser({ numericalAperture: 0.05 });
    const cone = tracedCondenserCone(system, reverseCondenser(half, L), 0, {
      pupilSamples: PS,
      apertureFraction: 0.8,
      reach: 0.8,
    });
    expect(cone.coherenceParameter).not.toBeCloseTo(0.8, 3);
    expect(cone.coherenceParameter).toBeCloseTo((0.8 * tanOf(0.05)) / tanOf(0.1), 12);
    expect(cone.coherenceParameter).toBeCloseTo(0.398493, 6);
    // And on the matched pair the two DO coincide, which is why the fixture
    // could not have caught it.
    const matched = tracedCondenserCone(system, rev, 0, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    expect(matched.coherenceParameter).toBeCloseTo(APERTURE, 12);
  });

  it("`traces` counts the verdict's own builds, so the cost readout responds to asking for one", () => {
    // Before quoting what an option costs, check the readout moves when it is
    // set. Asking for a verdict runs the whole build twice more, and a `traces`
    // that counted only the centre build would have said the verdict was free.
    const bare = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    const judged = tracedCondenserCone(system, rev, 1, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
      tileHalfWidthMm: tileAt(system, 1, PS).halfWidthMm,
    });
    expect(bare.fidelity.traces).toBe(0);
    expect(judged.fidelity.traces).toBeGreaterThan(0);
    expect(judged.traces / bare.traces).toBeGreaterThan(2.8);
    expect(judged.traces / bare.traces).toBeLessThan(3.2);
  });
});

describe("§ 6ag.6 — § 6p's cache SURVIVES the traced cone, which the deferral predicted it would not", () => {
  const system = din4x();
  const c = abbeCondenser({ numericalAperture: 0.1 });
  const rev = reverseCondenser(c, L);

  it("every point is on the pupil's own lattice, at every field height", () => {
    // The construction never adds the field displacement to a coordinate: it
    // enters through `chief` and decides WHICH lattice points the mask admits.
    // So `abbeImage`'s `latticeOffset` precondition holds off axis, where
    // `translateSource` cannot make it hold at all.
    for (const h of [0, 0.5, 1, FIELD_EDGE]) {
      const cone = tracedCondenserCone(system, rev, h, {
        pupilSamples: PS,
        apertureFraction: APERTURE,
      });
      expect(cone.pupilLattice).toEqual({ pupilSamples: PS, stepMultiple: 1 });
      for (const p of cone.points) {
        expect(Number.isInteger(p.sx * PS)).toBe(true);
        expect(Number.isInteger(p.sy * PS)).toBe(true);
      }
      // Odd, so `abbeImage` infers parity 0 — which is the parity this grid has.
      expect(cone.samples % 2).toBe(1);
    }
  });

  it("THE MEASUREMENT: 289 pupil evaluations where the rigid translation needs 35 088", () => {
    // The saving is exactly the point count, and off axis it is the difference
    // between having the cache and not having it — `translateSource` drops
    // `pupilLattice` because an offset read off a trace is not a whole number of
    // half-steps, and it is right to. This construction never needed it to be.
    const tile = tileAt(system, FIELD_EDGE);
    const opts = { pupilSamples: PS, scale: tile.frame.scale };
    const cone = tracedCondenserCone(system, rev, tile.patch.objectHeightMm, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    const rigid = translateSource(
      latticeDiskSource(APERTURE, PS, 1),
      tile.patch.radialIlluminationOffset,
      0,
    );
    expect(rigid.pupilLattice).toBeUndefined();

    const formedTraced = abbeImage(GRATING, tile.patch.pupil, cone, opts);
    const formedRigid = abbeImage(GRATING, tile.patch.pupil, rigid, opts);
    expect(formedTraced.pupilEvaluations).toBe(289);
    expect(formedRigid.pupilEvaluations).toBe(35088);
    expect(formedRigid.pupilEvaluations / formedTraced.pupilEvaluations).toBeGreaterThan(100);
  });

  it("but § 6p.1's BITWISE identity does NOT transplant, and that is not a defect", () => {
    // A traced cone is a different quadrature of the same physical cone: its mask
    // is not the disc and its weights are not uniform. So its image is NOT a
    // reordering of a `diskSource`'s and must not be compared to one bit for bit
    // — the same caveat `latticeDiskSource` carries, and it is stated because the
    // shared `pupilLattice` field would otherwise imply the opposite.
    const tile = tileAt(system, 0);
    const opts = { pupilSamples: PS, scale: tile.frame.scale };
    const cone = tracedCondenserCone(system, rev, 0, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    const disc = latticeDiskSource(APERTURE, PS, 1);
    const a = abbeImage(GRATING, tile.patch.pupil, cone, opts).intensity;
    const b = abbeImage(GRATING, tile.patch.pupil, disc, opts).intensity;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBeGreaterThan(1e-9);
    // …and they are nonetheless the same picture, which is what says the
    // difference is the condenser rather than a broken construction.
    expect(worst).toBeLessThan(0.05 * Math.max(...a));
  });
});

describe("§ 6ag.7 — the seam, and the composition it must refuse", () => {
  const system = din4x();
  const c = abbeCondenser({ numericalAperture: 0.1 });
  const rev = reverseCondenser(c, L);

  it("a traced cone REPLACES the source, and reproduces `abbeImage` through it exactly", () => {
    const tile = tileAt(system, 1);
    const cone = tracedCondenserCone(system, rev, tile.patch.objectHeightMm, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    const rendered = renderBrightfield(
      GRATING,
      () => ({
        pupil: tile.patch.pupil,
        // Conditional spread rather than a `!`: `exactOptionalPropertyTypes` is
        // on, and `PatchPupil.sampling` being absent is what makes the verdict
        // read `unknown` — a non-null assertion here would be asserting the very
        // thing § 6ag.9 is checking.
        ...(tile.patch.sampling === undefined ? {} : { sampling: tile.patch.sampling }),
        source: cone,
      }),
      latticeDiskSource(APERTURE, PS, 1),
      { patches: 1, pupilSamples: PS, scale: tile.frame.scale },
    );
    const direct = abbeImage(GRATING, tile.patch.pupil, cone, {
      pupilSamples: PS,
      scale: tile.frame.scale,
    });
    // One patch, weight 1 everywhere: the blend is the identity, so this is an
    // exact identity and is checked as one.
    for (let i = 0; i < direct.intensity.length; i++) {
      expect(rendered.intensity[i]).toBe(direct.intensity[i]);
    }
  });

  it("REFUSES a patch carrying both, because translating a traced cone is an IMAGE and not an error", () => {
    // The hazard this rung exists for: a traced cone's points are absolute pupil
    // coordinates with the field displacement already in them, so translating
    // them again double-counts § 6x — and the result is a perfectly plausible
    // picture of the wrong illumination. Nothing downstream could see it.
    const tile = tileAt(system, 1);
    const cone = tracedCondenserCone(system, rev, tile.patch.objectHeightMm, {
      pupilSamples: PS,
      apertureFraction: APERTURE,
    });
    expect(() =>
      renderBrightfield(
        GRATING,
        () => ({
          pupil: tile.patch.pupil,
          source: cone,
          illuminationOffset: tile.patch.illuminationOffset,
        }),
        latticeDiskSource(APERTURE, PS, 1),
        { patches: 1, pupilSamples: PS, scale: tile.frame.scale },
      ),
    ).toThrow(/both a traced `source` and an `illuminationOffset`/);
  });

  it("and `imaging/object-field` never sets both", () => {
    // The producer's half of the same statement: `fieldPupilAt` reports the
    // offset and no source, so the two halves cannot be composed by accident.
    const tile = tileAt(system, 1);
    expect(tile.patch.illuminationOffset).toBeDefined();
    expect((tile.patch as { source?: unknown }).source).toBeUndefined();
  });
});

describe("§ 6ag.8 — what closing the aperture does NOT control, and why the axis is special", () => {
  const system = din4x();

  it("the axial diaphragm point's own direction is BITWISE aperture-free, and grows as h³", () => {
    // § 6af found `fieldBeamW040Mm` bitwise independent of the illumination NA:
    // every diaphragm point lights the whole field with one beam, so the beam's
    // width at the glass is the FIELD's and closing the diaphragm never narrows
    // it. This is the same invariance one derivative down — the beam's wavefront
    // is h⁴, so the direction it delivers is h³ — and it is the reason the
    // aberration-free control is an ON-AXIS control only.
    const slopes = [0.1, 0.05, 0.01].map((na) => {
      const c = abbeCondenser({ numericalAperture: na });
      return [0.25, 0.5, 1, 2].map((h) => slopeTo(c, 0, h)!);
    });
    for (let i = 1; i < slopes.length; i++) {
      for (let k = 0; k < slopes[0]!.length; k++) {
        expect(slopes[i]![k]).toBe(slopes[0]![k]);
      }
    }
    for (let k = 1; k < slopes[0]!.length; k++) {
      expect(slopes[0]![k]! / slopes[0]![k - 1]!).toBeGreaterThan(7.9);
      expect(slopes[0]![k]! / slopes[0]![k - 1]!).toBeLessThan(8.4);
    }
  });

  it("so off axis the cone's centre lags § 6x's rigid displacement by a fixed amount", () => {
    // § 6x puts the cone's centre at `h/R_ep`. The diaphragm's centre actually
    // lands short of that by the axial beam's own field error — which closing the
    // aperture cannot touch — and at the field edge that is § 6af's own measured
    // 0.0428, recovered here from the other construction entirely.
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const rev = reverseCondenser(c, L);
    const lag = (h: number): number => {
      const frame = pupilSlopeFrame(system, h, L);
      const off = frame.chief === 0 ? 0 : frame.pupilOf(0);
      let lo = off - 0.3;
      let hi = off + 0.3;
      const f = (r: number) => diaphragmLanding(rev, h, frame.slopeOf(r), 0)!.x;
      const fLo = f(lo);
      for (let i = 0; i < 200; i++) {
        const mid = 0.5 * (lo + hi);
        if (fLo * f(mid) <= 0) hi = mid;
        else lo = mid;
      }
      return off - 0.5 * (lo + hi);
    };
    // On axis the lag is a bisected zero rather than a constructed one — the
    // ray IS the axis, but it was found by search — so it is pinned as a
    // magnitude. `illuminationOffset` is what carries the bitwise zero (§ 6ag.3).
    expect(Math.abs(lag(0))).toBeLessThan(1e-15);
    expect(lag(FIELD_EDGE)).toBeCloseTo(0.0428, 4);
    // h³, as the rung above says it must be.
    expect(lag(2) / lag(1)).toBeGreaterThan(7.9);
    expect(lag(2) / lag(1)).toBeLessThan(8.4);
  });
});

/** Kept honest: the traced-pupil path and the ideal path see the same source. */
describe("§ 6ag.9 — composed on the traced objective", () => {
  it("a traced cone and a traced pupil compose, and the verdict stays honest", () => {
    const system = din4x();
    const c = abbeCondenser({ numericalAperture: 0.1 });
    const rev = reverseCondenser(c, L);
    // At `pupilSamples` 32 and 1 mm of field, where § 6ag.4's last rung pins the
    // traced wavefront still rules `valid` — a composition rung has to compose on
    // a configuration the engine will actually form an image of.
    const ps = 32;
    const size = 128;
    const grating = cosineGratingObject({ size, cycles: 8, modulation: 0.6 });
    const tile = tileAt(system, 1, ps, size);
    const cone = tracedCondenserCone(system, rev, tile.patch.objectHeightMm, {
      pupilSamples: ps,
      apertureFraction: APERTURE,
      tileHalfWidthMm: tile.halfWidthMm,
    });
    const rendered = renderBrightfield(
      grating,
      () => ({
        pupil: tile.patch.pupil,
        // Conditional spread rather than a `!`: `exactOptionalPropertyTypes` is
        // on, and `PatchPupil.sampling` being absent is what makes the verdict
        // read `unknown` — a non-null assertion here would be asserting the very
        // thing § 6ag.9 is checking.
        ...(tile.patch.sampling === undefined ? {} : { sampling: tile.patch.sampling }),
        source: cone,
      }),
      latticeDiskSource(APERTURE, ps, 1),
      { patches: 1, pupilSamples: ps, scale: tile.frame.scale },
    );
    // The brightfield verdict is about the WAVEFRONT and is unchanged by the
    // source; the cone's own verdict is about the tile. Two verdicts, two
    // questions, and neither stands in for the other.
    expect(rendered.fidelity.verdict).toBe("valid");
    expect(cone.fidelity.verdict).toBe("valid");
    expect(rendered.contributingPoints).toBe(cone.points.length);
    // The pupil the tile traced is the one that was used.
    expect(tracedPupil(system, tile.patch.objectHeightMm, L).rmsWaves).toBeCloseTo(
      tile.patch.rmsWaves,
      12,
    );
  });
});
