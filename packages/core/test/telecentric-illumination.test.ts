import { describe, it, expect } from "vitest";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  microscopeObjective,
  tubeLens,
  type StopPlacement,
} from "../src/designs/microscope";
import {
  fieldPupilAt,
  illuminationOffset,
  imageRadiusForObjectHeight,
  objectFieldFrame,
  objectFieldTile,
  tracedFieldPupils,
} from "../src/imaging/object-field";
import { renderBrightfield, type PatchPupil } from "../src/imaging/brightfield";
import { renderFluorescence, rasterizeEmitters } from "../src/imaging/fluorescence";
import { abbeImage, cosineGratingObject, uniformObject } from "../src/illumination/abbe";
import {
  commensurateSource,
  diskSource,
  translateSource,
  type CondenserSource,
} from "../src/illumination/source";
import { pupils } from "../src/pupil/pupils";
import type { OpticalSystem } from "../src/trace/system";

/**
 * § 6x — what telecentricity is worth to the illumination.
 *
 * § 6v put the shipped infinity objective's stop on its back focal plane and
 * § 6w sized its glass for a field. Both are about the light the objective
 * COLLECTS. This step is the other side: §§ 6f/6h/6m/6o each hand every field
 * point one `CondenserSource` with its points centred on the pupil, and each
 * recorded that as an assumption about the *condenser*. It is not one.
 *
 * ## The correction, which is the step
 *
 * Köhler illumination images the lamp onto the condenser's aperture diaphragm,
 * so each diaphragm point lights the whole field with one collimated beam. That
 * is exact and it is the condenser's own property: the set of DIRECTIONS is the
 * same at every specimen point, and `illumination/source` is a set of directions.
 *
 * But `illumination/source`'s coordinates are the OBJECTIVE's pupil, and a ray
 * leaving object height h with object-space slope u arrives at the entrance pupil
 * at height h + u·z_ep, so
 *
 *     ρ = h/R_ep + u/u_max.
 *
 * The field term vanishes exactly when R_ep is infinite, which is object-space
 * telecentricity and nothing else. So the assumption was never about the lamp:
 * it is a property of the objective, and § 6v is what made it true — for the
 * infinity presets, and for those only. The DIN still carries its stop on the
 * rim (§ 6w's own open item) and is this step's live subject rather than a
 * hypothetical.
 *
 * ## What is external here
 *
 * `h/R_ep` is the closed form, and the engine never computes it: the offset is
 * read off the aimer as the pupil coordinate whose ray leaves the specimen
 * parallel to the axis. 6x.1 pins the two against each other, which is the same
 * shape of check as § 6v.1's `tan u` — a traced quantity against the paraxial
 * statement it must reduce to.
 *
 * ## Cost
 *
 * Nothing, on axis or under telecentricity: `translateSource` returns its input
 * object at a zero offset, so those paths reach `abbeImage` with the identical
 * source they always did. Off axis on a rim-stopped system it costs § 6p's
 * cache — see 6x.5, where that turns out to be a statement about telecentricity
 * rather than about the cache.
 */

const L = 587.5618;
const SIZE = 64;
const PS = 32;

/** § 6b's DIN 4×/0.10 — rim-stopped by construction, so the subject. */
const din = (): OpticalSystem =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }),
  }).system;

/** § 6v's infinity 4×/0.10, in both placements — the pair the claim needs. */
const infinity = (stopPlacement: StopPlacement): OpticalSystem =>
  infinityCorrectedMicroscope({
    objective: microscopeObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement }),
    tubeLens: tubeLens(),
  }).system;

const frameOf = (system: OpticalSystem, pupilSamples = PS, size = SIZE) =>
  objectFieldFrame(system, { size, pupilSamples, wavelengthNm: L });

const tileAtHeight = (system: OpticalSystem, hMm: number, pupilSamples = PS, size = SIZE) =>
  objectFieldTile(system, {
    size,
    pupilSamples,
    wavelengthNm: L,
    centreMm: { x: hMm === 0 ? 0 : imageRadiusForObjectHeight(system, hMm, L), y: 0 },
  });

const meanOf = (a: Float64Array): number => {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
};

const peakOf = (a: Float64Array): number => {
  let m = 0;
  for (const v of a) if (v > m) m = v;
  return m;
};

const worstDifference = (a: Float64Array, b: Float64Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

/* ── 6x.1 — the offset is the entrance pupil's own h/R, and zero at infinity ── */

describe("§ 6x.1 — the illumination offset IS h/R_ep, and telecentricity kills it", () => {
  it("agrees with the closed form to ten digits, on both rim-stopped members", () => {
    // The traced side is an inversion of the aimer; the closed side is the
    // paraxial statement about where a parallel ray crosses the entrance pupil.
    // They share no code — `illuminationOffset` never asks for `entrance.radius`
    // — so the agreement is a check and not a restatement.
    for (const system of [din(), infinity("rim")]) {
      const R = pupils(system, L).entrance.radius;
      expect(Number.isFinite(R)).toBe(true);
      for (const h of [0.0235, 0.1, 0.5, 1, 2]) {
        expect(illuminationOffset(system, h, L) / (h / R)).toBeCloseTo(1, 10);
      }
    }
  });

  it("is 0.217 of a pupil radius per millimetre on the shipped DIN 4×/0.10", () => {
    // The number the whole step is about, stated once in the units it bites in.
    // S is rarely above 1, so at a millimetre of field the cone this objective is
    // lit through sits a fifth of the way out of the aperture that must catch it.
    const system = din();
    const perMm = illuminationOffset(system, 1, L);
    expect(perMm).toBeCloseTo(0.21736, 5);
    // Exactly linear in the field, because h/R_ep is: the ratio over 100× of
    // field is the field ratio itself.
    expect(illuminationOffset(system, 2, L) / perMm).toBeCloseTo(2, 12);
    expect(illuminationOffset(system, 0.02, L) / perMm).toBeCloseTo(0.02, 12);
  });

  it("is BITWISE zero on § 6v's telecentric objective, at every field height", () => {
    // Not small — zero. `aimRay` takes its object-space branch when the entrance
    // pupil is at infinity, and there a pupil coordinate names a slope (§ 6u.1),
    // so the chief ray's slope is the literal 0 of § 6v.4 and the quotient never
    // happens. That is what licenses `translateSource` returning its input object
    // and every telecentric render staying byte-identical.
    const tele = infinity("backFocal");
    expect(pupils(tele, L).entrance.radius).toBe(Infinity);
    for (const h of [0, 0.001, 0.1, 1, 3]) {
      expect(illuminationOffset(tele, h, L)).toBe(0);
    }
    // And its own negative control, on identical geometry, is not zero anywhere
    // off axis — so the null is the stop placement and not the lens.
    const rim = infinity("rim");
    expect(illuminationOffset(rim, 0, L)).toBe(0);
    for (const h of [0.001, 0.1, 1, 3]) {
      expect(Math.abs(illuminationOffset(rim, h, L))).toBeGreaterThan(0);
    }
  });

  it("points radially OUTWARD, and carries the field position's own azimuth", () => {
    // The sign the whole wiring rests on, checked where it is visible rather than
    // derived: a ray leaving +h parallel to the axis crosses the entrance pupil
    // at +h, so the cone moves to the SAME side as the field point. The +y case
    // is the one a meridional rung cannot make — it is the only witness that the
    // offset is turned by the same rotation as the pupil.
    const system = din();
    const frame = frameOf(system);
    const at = (u: number, v: number) => fieldPupilAt(system, frame, u, v);

    const px = at(1, 0.5);
    expect(px.illuminationOffset.sx).toBeGreaterThan(0);
    expect(px.illuminationOffset.sx).toBe(px.radialIlluminationOffset);
    expect(Math.abs(px.illuminationOffset.sy)).toBeLessThan(1e-15);

    const py = at(0.5, 1);
    expect(py.illuminationOffset.sy).toBeGreaterThan(0);
    expect(Math.abs(py.illuminationOffset.sx)).toBeLessThan(1e-15);
    // Same field height, same magnitude — an axial system has no preferred
    // azimuth and the offset must not invent one.
    expect(py.radialIlluminationOffset).toBeCloseTo(px.radialIlluminationOffset, 12);

    const nx = at(0, 0.5);
    expect(nx.illuminationOffset.sx).toBeLessThan(0);

    // The corner: 45°, so the two components are equal and the magnitude is the
    // radial offset at that (larger) height.
    const corner = at(1, 1);
    expect(corner.illuminationOffset.sx).toBeCloseTo(corner.illuminationOffset.sy, 12);
    expect(Math.hypot(corner.illuminationOffset.sx, corner.illuminationOffset.sy)).toBeCloseTo(
      corner.radialIlluminationOffset,
      12,
    );
  });
});

/* ── 6x.2 — the cone walks out of the aperture, and it is a count ──────────── */

describe("§ 6x.2 — the aperture stops admitting the whole cone, and that is countable", () => {
  it("loses source points from the FIELD's side of the pupil, 97 → 90 at 1 mm", () => {
    // § 6w's claim in the same currency — a discrete count of lattice points
    // rather than a fraction — and the discriminating one, because a *dimming*
    // is not: displacing a disc by ±d pushes the same number of points out
    // whichever way it went, so a mean intensity cannot see a wrong sign. WHICH
    // points leave can.
    const system = din();
    const source = diskSource(0.9, 11);
    expect(source.points.length).toBe(97);

    const inside = (s: CondenserSource): number =>
      s.points.filter((p) => Math.hypot(p.sx, p.sy) <= 1).length;

    const at = (hMm: number): CondenserSource => {
      const tile = tileAtHeight(system, hMm, PS, 128);
      const p = fieldPupilAt(system, tile, 0.5, 0.5);
      return translateSource(source, p.illuminationOffset.sx, p.illuminationOffset.sy);
    };

    expect(inside(at(0))).toBe(97);
    expect(inside(at(0.5))).toBe(97);
    const far = at(1);
    expect(inside(far)).toBe(90);

    // The seven that left are the seven furthest out along +x — the field's own
    // direction. This is the sign check, and it is not sign-blind.
    const lost = far.points.filter((p) => Math.hypot(p.sx, p.sy) > 1);
    expect(lost).toHaveLength(7);
    const smallestLost = Math.min(...lost.map((p) => p.sx));
    const largestKept = Math.max(
      ...far.points.filter((p) => Math.hypot(p.sx, p.sy) <= 1).map((p) => p.sx),
    );
    expect(smallestLost).toBeGreaterThan(0);
    expect(smallestLost).toBeGreaterThan(largestKept - 2 * (0.9 / 11));
  });

  it("CONTROL: § 6v's telecentric objective admits all 97 at every field", () => {
    // And the control is needed, because the telescope-shaped reading of "the
    // clear field dims off axis" is TRUE on the telecentric objective too —
    // 0.8158 → 0.7737 over the same sweep — for § 6v.5's reason, which is the
    // imaging bundle walking off the glass. The two mechanisms are separated by
    // this count and not by a brightness.
    const tele = infinity("backFocal");
    const source = diskSource(0.9, 11);
    for (const h of [0, 0.5, 1]) {
      const tile = tileAtHeight(tele, h, PS, 128);
      const p = fieldPupilAt(tele, tile, 0.5, 0.5);
      const lit = translateSource(source, p.illuminationOffset.sx, p.illuminationOffset.sy);
      expect(lit).toBe(source);
      expect(lit.points.filter((q) => Math.hypot(q.sx, q.sy) <= 1)).toHaveLength(97);
    }
  });

  it("costs a clear field nothing at all while the cone is still inside", () => {
    // The null that says the offset is not a fudge factor on brightness: a clear
    // field uses only the undiffracted order, which every source point still
    // carries as long as it is inside the pupil. So until S + d crosses 1 the
    // displacement is exactly invisible in the background — and § 6f's whole
    // contrast story is what it is visible in instead.
    const system = din();
    const source = diskSource(0.6, 5);
    const means: number[] = [];
    for (const h of [0, 0.1, 0.2, 0.4]) {
      const tile = tileAtHeight(system, h);
      const p = fieldPupilAt(system, tile, 0.5, 0.5);
      const lit = translateSource(source, p.illuminationOffset.sx, p.illuminationOffset.sy);
      expect(0.6 + p.radialIlluminationOffset).toBeLessThan(1);
      means.push(meanOf(abbeImage(uniformObject(SIZE), p.pupil, lit, { pupilSamples: PS }).intensity));
    }
    for (const m of means) expect(m / means[0]! - 1).toBeCloseTo(0, 5);
  });
});

/* ── 6x.3 — the fluorescence null: no condenser in the expression ──────────── */

describe("§ 6x.3 — a self-luminous specimen does not move, bit for bit", () => {
  it("renders identically through the same `PatchPupil` that carries the offset", () => {
    // § 6i's "there is no condenser in the expression at all", promoted from a
    // sentence to a test. `tracedFieldPupils` is shared by both renderers, so
    // the offset it now reports travels into the fluorescence path — and must be
    // ignored there, because a fluorophore has no phase memory of the field that
    // excited it and its image is a plain convolution. Bitwise, not to a
    // tolerance: nothing in that path may read this field.
    const system = din();
    const frame = frameOf(system);
    const emitters = rasterizeEmitters(
      system,
      frame,
      [
        { xMm: 0, yMm: 0, flux: 1 },
        { xMm: 0.012, yMm: 0.008, flux: 0.6 },
        { xMm: -0.02, yMm: 0.015, flux: 0.4 },
      ],
      {},
    );
    const traced = tracedFieldPupils(system, frame);
    const stripped = (u: number, v: number): PatchPupil => {
      const p = traced(u, v);
      return { pupil: p.pupil, ...(p.sampling === undefined ? {} : { sampling: p.sampling }) };
    };
    // The offset is genuinely non-zero at the patches this render uses, so the
    // null is a null and not a vacuous one.
    expect(Math.abs(traced(0.25, 0.25).illuminationOffset!.sx)).toBeGreaterThan(0);

    const withOffset = renderFluorescence(emitters, traced, { patches: 2, pupilSamples: PS });
    const without = renderFluorescence(emitters, stripped, { patches: 2, pupilSamples: PS });
    expect(withOffset.intensity).toEqual(without.intensity);
  });
});

/* ── 6x.4 — the composition, and what it does to a picture ─────────────────── */

describe("§ 6x.4 — the offset reaches the image, and the axis is untouched", () => {
  it("changes nothing on axis and everything at a millimetre", () => {
    // The two ends. On axis h is zero so the offset is zero and `translateSource`
    // hands back its own argument — the rendered array must be byte-identical to
    // the pre-§ 6x one, which is asserted here as identity against the stripped
    // path rather than against a stored image.
    const system = din();
    const source = diskSource(0.6, 5);
    const grating = cosineGratingObject({ size: SIZE, cycles: 8, modulation: 0.6 });
    const render = (tile: ReturnType<typeof tileAtHeight>, strip: boolean) => {
      const traced = tracedFieldPupils(system, tile);
      const at = strip
        ? (u: number, v: number): PatchPupil => {
            const p = traced(u, v);
            return { pupil: p.pupil, ...(p.sampling === undefined ? {} : { sampling: p.sampling }) };
          }
        : traced;
      return renderBrightfield(grating, at, source, {
        patches: 1,
        pupilSamples: PS,
        scale: tile.scale,
      }).intensity;
    };

    const axial = tileAtHeight(system, 0);
    expect(render(axial, false)).toEqual(render(axial, true));

    const off = tileAtHeight(system, 1);
    const moved = render(off, false);
    const still = render(off, true);
    expect(moved).not.toEqual(still);
    expect(worstDifference(moved, still) / peakOf(still)).toBeGreaterThan(0.05);
  });
});

/* ── 6x.5 — what it costs: § 6p's cache is telecentric-only ────────────────── */

describe("§ 6x.5 — commensurability is a claim about WHERE the source sits", () => {
  it("survives a zero offset and does not survive a real one", () => {
    // § 6p's saving is licensed by every source point sitting on the pupil's own
    // frequency lattice. An offset read off a trace is not a whole number of half
    // steps, so it cannot be carried — and rounding it onto the lattice would be
    // exactly the lie `commensurateSource` refuses one function up. So the
    // metadata is dropped and `abbeImage` evaluates the pupil per source point.
    //
    // Which makes the cache a telecentric-only optimisation, and that is a fact
    // about telecentricity rather than a limitation of the cache.
    const source = commensurateSource(0.5, 32, 2);
    expect(source.pupilLattice).toBeDefined();
    expect(translateSource(source, 0, 0)).toBe(source);
    expect(translateSource(source, 0, 0).pupilLattice).toBeDefined();

    const moved = translateSource(source, 0.0217, 0);
    expect(moved.pupilLattice).toBeUndefined();
    expect(moved.offset).toEqual({ dx: 0.0217, dy: 0 });
    expect(moved.coherenceParameter).toBe(source.coherenceParameter);
    expect(moved.points).toHaveLength(source.points.length);
  });

  it("still forms the image the uncached path forms — the fallback is not a downgrade", () => {
    // What is lost is evaluations, not accuracy: a translated source takes the
    // per-point path and that path is the one every § 6f rung is pinned on. The
    // check is that a translated commensurate source and the same points handed
    // over as a plain source agree exactly, so nothing about the metadata's
    // absence changes the sum.
    const grating = cosineGratingObject({ size: SIZE, cycles: 8, modulation: 0.6 });
    const system = din();
    const p = fieldPupilAt(system, tileAtHeight(system, 0.5), 0.5, 0.5);
    const moved = translateSource(commensurateSource(0.5, PS, 2), p.illuminationOffset.sx, 0);
    const plain: CondenserSource = {
      points: moved.points,
      coherenceParameter: moved.coherenceParameter,
      samples: moved.samples,
    };
    const a = abbeImage(grating, p.pupil, moved, { pupilSamples: PS });
    const b = abbeImage(grating, p.pupil, plain, { pupilSamples: PS });
    expect(a.intensity).toEqual(b.intensity);
    expect(a.pupilEvaluations).toBe(b.pupilEvaluations);
  });

  it("and the saving it gives up is § 6p's own count, exactly", () => {
    // The cost as an integer rather than as a wall clock, which is how § 6p
    // pinned it in the first place: the cached path evaluates the pupil over one
    // box, the uncached one over that box per contributing direction. Stated here
    // because this step was scoped believing `commensurateSource` had no caller
    // and it has three — A7/A10's stage is a mosaic and therefore off axis by
    // construction, so it is the one that pays. In wall clock that is 404 ms → 727
    // ms a tile, 1.8× rather than § 6p's 10.76×, because § 6s moved the bill back
    // onto the Abbe sum; the count below is the part that has not changed.
    const grating = cosineGratingObject({ size: SIZE, cycles: 8, modulation: 0.6 });
    const system = din();
    const p = fieldPupilAt(system, tileAtHeight(system, 0.5), 0.5, 0.5);
    const centred = commensurateSource(0.5, PS, 2);
    const cached = abbeImage(grating, p.pupil, centred, { pupilSamples: PS });
    const uncached = abbeImage(
      grating,
      p.pupil,
      translateSource(centred, p.illuminationOffset.sx, p.illuminationOffset.sy),
      { pupilSamples: PS },
    );
    expect(cached.pupilEvaluations).toBeGreaterThan(0);
    expect(uncached.pupilEvaluations).toBeGreaterThan(cached.pupilEvaluations);
    // And it is a *count* of directions, not a fudge: the ratio is bounded by the
    // contributing-point count, which is what § 6p's saving was defined as.
    expect(uncached.pupilEvaluations / cached.pupilEvaluations).toBeLessThanOrEqual(
      uncached.contributingPoints,
    );
  });
});

/* ── 6x.6 — the pupil lattice is the binding knob, not the source count ────── */

describe("§ 6x.6 — a moved cone is decided by the PUPIL sampling", () => {
  it("converges at ½ with the offset in, and the excess over ½ is the illumination", () => {
    // The control § 6h.5's re-pinned rung refers to. Suppress the offset and the
    // patch-refinement sequence converges at 0.5001/0.4999; restore it and the
    // same fixture gives 0.5092/0.5067 with a FIRST step that is smaller
    // (1.24e-2 against 1.71e-2), not larger. That direction is worth the rung on
    // its own: the displacement partly cancels the field aberration's effect on
    // the image, so a rim-stopped objective's frame is slightly MORE isoplanatic
    // than its wavefront alone predicts.
    //
    // 64 bins and not 32, which is this rung's other half: at 32 the sequence
    // with the offset does not converge at all, and refining the SOURCE does not
    // rescue it (ratios 1.95/0.87 at 21 points, 0.82/0.69 at 97, 0.46/0.51 at
    // 349) while refining the pupil does at every source count. A source point
    // crossing the aperture rim is a step change, and how much of the image it
    // carries is set by how finely the rim is resolved.
    const system = din();
    const size = 128;
    const pupilSamples = 64;
    const source = diskSource(0.6, 5);
    const frame = frameOf(system, pupilSamples, size);
    const grating = cosineGratingObject({ size, cycles: 8, modulation: 0.6 });
    const traced = tracedFieldPupils(system, frame);
    const stripped = (u: number, v: number): PatchPupil => {
      const p = traced(u, v);
      return { pupil: p.pupil, ...(p.sampling === undefined ? {} : { sampling: p.sampling }) };
    };

    const sequence = (at: (u: number, v: number) => PatchPupil): number[] => {
      const levels = [1, 2, 4].map((patches) =>
        renderBrightfield(grating, at, source, { patches, pupilSamples, scale: frame.scale }),
      );
      const pk = peakOf(levels[0]!.intensity);
      return [
        worstDifference(levels[1]!.intensity, levels[0]!.intensity) / pk,
        worstDifference(levels[2]!.intensity, levels[1]!.intensity) / pk,
      ];
    };

    const control = sequence(stripped);
    const moved = sequence(traced);
    expect(control[1]! / control[0]!).toBeCloseTo(0.5, 3);
    expect(moved[1]! / moved[0]!).toBeCloseTo(0.509, 3);
    // The first step SHRINKS when the cone is put where it belongs.
    expect(moved[0]!).toBeLessThan(control[0]!);
    expect(moved[0]! / control[0]!).toBeCloseTo(0.727, 2);
  });
});
