import { describe, it, expect } from "vitest";
import type { OpticalSystem } from "../src/trace/system";
import { LINE_D } from "../src/materials/dispersion";
import { getMedium } from "../src/materials/catalog";
import { paraxialTrace } from "../src/trace/paraxial";
import { paraxialImageOffset } from "../src/analysis/focus";
import { pupils } from "../src/pupil/pupils";
import { aimRay, pupilGrid } from "../src/pupil/aiming";
import { canonicalApertureSine, exitApertureSine, opdMap } from "../src/pupil/opd";
import {
  finiteConjugateMicroscope,
  finiteConjugateObjective,
  infinityCorrectedMicroscope,
  tubeLens,
} from "../src/designs/microscope";
import { oilImmersionObjective } from "../src/designs/immersion";
import { abbeCondenser } from "../src/designs/condenser";
import { exitDensity } from "../src/wave/exit-density";
import {
  fieldPupilAt,
  illuminationOffset,
  imageRadiusForObjectHeight,
  objectFieldFrame,
  objectFieldTile,
  pupilDirectionMap,
  pupilSlopeFrame,
  tracedFieldPupils,
} from "../src/imaging/object-field";
import { diaphragmLanding, reverseCondenser, tracedCondenserCone } from "../src/imaging/condenser-field";
import { rasterizeSpecimen } from "../src/imaging/specimen";
import { renderBrightfield } from "../src/imaging/brightfield";
import { diskSource } from "../src/illumination/source";

/**
 * § 2n — brightfield on the exit layout (register item 24's first finite chain).
 *
 * § 2m flipped every chain imaging from infinity. A finite chain cannot be
 * flipped by the conjugate, so the brightfield one is flipped by its frame: a
 * frame owns its layout and every pupil laid on it follows (`ObjectFieldFrame`),
 * and the brightfield panel asks for `"exit"`. Fluorescence, the volume panels
 * and the mosaic stay on the aim layout until their own steps.
 *
 * The exit layout was a PSF's, and a brightfield image asks two things of it a
 * PSF never did.
 *
 * **Where a direction sits.** `abbeImage` evaluates P(f + s): the specimen's
 * spectrum f on a lattice the frame's ruler makes linear in the object's optical
 * direction sine — a period p diffracts by n·ΔL = λ/p and lands at (λ/p)/ν,
 * ν = |M|·n′·σ (`canonicalApertureSine`) — and the condenser's directions s. On
 * the aim layout s was the aimer's tangent coordinate; on the exit layout it must
 * be on f's map, or the zero order and the diffracted ones are summed on two
 * rulers. So `pupilDirectionMap` places a direction at n·(L − L_c)/ν, and both
 * `illuminationOffset` and the traced condenser (§ 6ag) go through it.
 *
 * **How bright a direction is.** The exit density was a point's — power per exit
 * area, |P|² = S/|∂e/∂a| normalized at the chief ray — and at a finite conjugate
 * that normalization is a choice of the aim's scale: |P(0)|² read 0.985 on the
 * DIN 4×/0.10 and 0.32 on the oil 100×, and § 6al.1's clear field came out 0.27%
 * BRIGHTER than Fresnel allows. Two fixes, one per source. An emitter's density
 * is made absolute, p·|∂c/∂e| (§ 2n.1). A transmitted field has no change of
 * variables at all: one lattice cell is one plane-wave component on both sides of
 * the lens, so its |P|² is that component's own power, cos θ (§ 2n.4) — the
 * Jacobian version lost 9.2e-4 of § 6al's clear field to the singlet's
 * sine-condition offence.
 *
 * ## The hypothesis, and the numbers that refute it
 *
 * On the exit layout, a direction placed by its optical sine and a field
 * component weighted by its own power make brightfield conserve light and keep
 * Abbe's sum on one ruler. Refuted by any of:
 *
 *  - a normal-incidence clear field off Fresnel's (1 − R)² by more than the
 *    density fit's ~1e-7, or the S = 0.5 cone off (1 − R)²·⟨cos θ⟩;
 *  - the canonical offset departing from the traced exit coordinate of the
 *    axis-parallel ray at FIRST order in field — the Lagrange invariant makes
 *    them one there;
 *  - the traced condenser's aberration-free limit failing to converge on the
 *    SINE ratio NA_c/ν as NA³ on this layout (§ 6ag.3's finding, inverted);
 *  - an emitter's absolute density departing from p·|∂c/∂e| node for node by
 *    more than the density lattice's own differencing.
 */

const L = LINE_D;
const FIELD = { source: "field" } as const;

const oil = () =>
  infinityCorrectedMicroscope({
    objective: oilImmersionObjective({ magnification: 100, numericalAperture: 1.25, tubeFocalLengthMm: 200 }),
    tubeLens: tubeLens({ focalLengthMm: 200 }),
    objectHeightsMm: [0],
  }).system;
/** § 6x's rim-stopped DIN: not object-space telecentric, so its offset is alive. */
const rimDin = () =>
  finiteConjugateMicroscope({
    objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1, stopPlacement: "rim" }),
  }).system;
/** The shipped DIN 4×/0.10, back-focal stopped since § 6ai: object-space telecentric. */
const din = () =>
  finiteConjugateMicroscope({ objective: finiteConjugateObjective({ magnification: 4, numericalAperture: 0.1 }) })
    .system;

/** § 6al's singlet, its stop at the front focus: image-space telecentric. */
const LENS_FRONT = { kind: "refract" as const, curvature: 1 / 40, semiAperture: 20, thickness: 9, medium: "N-BK7" };
const lensBack = (thickness: number) => ({
  kind: "refract" as const,
  curvature: -1 / 80,
  semiAperture: 20,
  thickness,
  medium: "AIR",
});
const singlet = (): OpticalSystem => {
  const g = { surfaces: [LENS_FRONT, lensBack(0)] };
  const ffd = -paraxialTrace(g, L, { y: 0, u: 1 }).u / paraxialTrace(g, L, { y: 1, u: 0 }).u;
  const base: OpticalSystem = {
    prescription: {
      surfaces: [
        { kind: "refract", curvature: 0, semiAperture: 30, thickness: ffd, medium: "AIR", isStop: true },
        LENS_FRONT,
        lensBack(100),
      ],
    },
    aperture: { kind: "stopRadius", value: 2 },
    field: { kind: "objectHeight", values: [0] },
    wavelengths: [{ nm: L, weight: 1 }],
    conjugate: { kind: "finite", distance: 400 },
  };
  return { ...base, imageSurface: { offsetFromLastVertex: paraxialImageOffset(base, L) } };
};

const tanOf = (na: number) => na / Math.sqrt(1 - na * na);

function chiefNode(nodes: readonly { readonly px: number; readonly py: number; readonly density: number }[]) {
  return nodes.find((q) => q.px === 0 && q.py === 0)!.density;
}

/** Mean of a rendered frame — a clear field's level. */
function level(intensity: Float64Array): number {
  let t = 0;
  for (const v of intensity) t += v;
  return t / intensity.length;
}

describe("§ 2n.1 — a finite pupil's units are absolute", () => {
  it("a transmitted field's |P|² is each component's own cos θ, and 1 at the axis, exactly", () => {
    for (const s of [din(), rimDin(), oil(), singlet()]) {
      const sigma = exitApertureSine(s, L);
      const dens = exitDensity(s, opdMap(s, 0, L, pupilGrid(21)), sigma, FIELD);
      expect(chiefNode(dens.nodes)).toBe(1);
      const geo = pupils(s, L);
      for (const q of dens.nodes) {
        const d = aimRay(s, geo, 0, { px: q.px, py: q.py }, L).dir;
        // To the last bit or two: the engine normalizes by √(x² + y² + z²), not hypot.
        expect(Math.abs(q.density / (Math.abs(d.z) / Math.hypot(d.x, d.y, d.z)) - 1)).toBeLessThan(4 * Number.EPSILON);
      }
    }
  });

  it("an emitter's |P(0)|² is 1 on every lens, to the density lattice's differencing", () => {
    // 1/|∂e/∂a|(0) before: 0.985 on the DIN, 0.32 on the oil, 1.0036 on the
    // singlet. Now the residue is the lattice's: refining it 21 → 41 cuts the DIN's
    // 2.2e-6 and the oil's 3.7e-5 to 6.6e-8 and 2.7e-6. The singlet's 4.6e-8 does
    // not move with the lattice — it is the chief ray's own (n/ν)²·|∂(L,M)/∂a|
    // against the paraxial ν, a second-order pupil aberration, and it is below the
    // fit every transform reads.
    const cases: [OpticalSystem, number][] = [
      [din(), 3e-6],
      [rimDin(), 3e-6],
      [oil(), 5e-5],
      [singlet(), 1e-7],
    ];
    for (const [s, bound] of cases) {
      const dens = exitDensity(s, opdMap(s, 0, L, pupilGrid(21)), exitApertureSine(s, L), { source: "emitter" });
      expect(Math.abs(chiefNode(dens.nodes) - 1)).toBeLessThan(bound);
    }
  });

  it("…and its source term is p·|∂c/∂a|: |d_z|⁴ is the direction-cosine area per aim area", () => {
    // The dz³ (emitter) and dz⁵ (field) of § 2j are p(θ) times a direction-cosine
    // Jacobian derived for the paraxial aim. Checked here against that Jacobian
    // DIFFERENCED off the launch directions, so the derivation is measured rather
    // than trusted: |∂(L,M)/∂a| / d_z⁴ is one constant across the pupil.
    for (const s of [rimDin(), oil(), singlet()]) {
      const geo = pupils(s, L);
      const d = 1e-5;
      const cos = (px: number, py: number) => {
        const r = aimRay(s, geo, 0, { px, py }, L).dir;
        const n = Math.hypot(r.x, r.y, r.z);
        return { l: r.x / n, m: r.y / n, dz: Math.abs(r.z) / n };
      };
      const ratios: number[] = [];
      for (const q of pupilGrid(11)) {
        const xp = cos(q.px + d, q.py);
        const xm = cos(q.px - d, q.py);
        const yp = cos(q.px, q.py + d);
        const ym = cos(q.px, q.py - d);
        const jc = Math.abs((xp.l - xm.l) * (yp.m - ym.m) - (yp.l - ym.l) * (xp.m - xm.m)) / (4 * d * d);
        ratios.push(jc / cos(q.px, q.py).dz ** 4);
      }
      const r0 = ratios[Math.floor(ratios.length / 2)]!;
      for (const r of ratios) expect(Math.abs(r / r0 - 1)).toBeLessThan(1e-7);
    }
  });

  it("…and the density is p·|∂c/∂e| node for node, to the lattice's differencing", () => {
    // Measured against the same quantity differenced at 1e-5 off fresh traces —
    // the launch's direction cosines and the exit coordinate. 1.0e-6 on the rim
    // DIN on and off axis; 1.7e-3 on the oil 100×, whose cubic exit map is the
    // one § 2j.1 found the lattice's area reading coarsest on.
    const cases: [OpticalSystem, number, number][] = [
      [rimDin(), 0, 2e-6],
      [rimDin(), 1, 2e-6],
      [oil(), 0, 2e-3],
    ];
    for (const [s, h, bound] of cases) {
      const sigma = exitApertureSine(s, L);
      const dens = exitDensity(s, opdMap(s, h, L, pupilGrid(21)), sigma, { source: "emitter" });
      const n = Math.abs(pupils(s, L).entrance.n);
      const nu = canonicalApertureSine(s, L);
      const geo = pupils(s, L);
      const d = 1e-5;
      const at = (px: number, py: number) => {
        const r = aimRay(s, geo, h, { px, py }, L).dir;
        const len = Math.hypot(r.x, r.y, r.z);
        const q = opdMap(s, h, L, [{ px, py }]).samples[0]!;
        return { l: r.x / len, m: r.y / len, dz: Math.abs(r.z) / len, ex: q.exitX / sigma, ey: q.exitY / sigma };
      };
      let worst = 0;
      for (const q of dens.nodes) {
        if (Math.hypot(q.px, q.py) > 0.95) continue;
        const xp = at(q.px + d, q.py);
        const xm = at(q.px - d, q.py);
        const yp = at(q.px, q.py + d);
        const ym = at(q.px, q.py - d);
        const jc = (Math.abs((xp.l - xm.l) * (yp.m - ym.m) - (yp.l - ym.l) * (xp.m - xm.m)) / (4 * d * d)) * (n / nu) ** 2;
        const je = Math.abs((xp.ex - xm.ex) * (yp.ey - ym.ey) - (yp.ex - ym.ex) * (xp.ey - xm.ey)) / (4 * d * d);
        worst = Math.max(worst, Math.abs(q.density / ((1 / at(q.px, q.py).dz) * (jc / je)) - 1));
      }
      expect(worst).toBeLessThan(bound);
    }
  });
});

describe("§ 2n.2 — a direction sits at its optical sine", () => {
  it("the canonical offset is the axis-parallel ray's traced exit coordinate, to second order in field", () => {
    // −n·L_c/ν against where that ray actually lands. The Lagrange invariant makes
    // them one at first order, so the gap must grow as h², from nothing: on the oil
    // 100× 1.7e-7, 4.3e-6, 6.9e-5 at h = 0.1, 0.5, 2 µm; on the rim DIN 1.2e-7 at
    // 10 µm and 7.5e-5 at 0.25 mm. Far off axis it does not stay small — 13% at
    // 0.1 mm on the oil — and that is the frame not being isoplanatic, which an
    // offset placed either way cannot fix (register item 28).
    const traced = (s: OpticalSystem, h: number) => {
      const a = pupilSlopeFrame(s, h, L).pupilOf(0);
      return opdMap(s, h, L, [{ px: a, py: 0 }]).samples[0]!.exitX / exitApertureSine(s, L);
    };
    const gap = (s: OpticalSystem, h: number) =>
      Math.abs(illuminationOffset(s, h, L, { layout: "exit" }) / traced(s, h) - 1);
    const o = oil();
    expect(gap(o, 1e-4)).toBeLessThan(3e-7);
    // ×4 in h, ×16 in the gap: second order.
    expect(gap(o, 2e-3) / gap(o, 5e-4)).toBeCloseTo(16, 0);
    const r = rimDin();
    expect(gap(r, 0.01)).toBeLessThan(2e-7);
    expect(gap(r, 0.25) / gap(r, 0.01)).toBeGreaterThan(400);
    // …and against the aim coordinate it is 1/cos-ish wrong at FIRST order: the
    // oil's offset is 1.759× the aim's on the axis' doorstep.
    expect(illuminationOffset(o, 1e-4, L, { layout: "exit" }) / illuminationOffset(o, 1e-4, L)).toBeCloseTo(1.759, 3);
  });

  it("an object-space telecentric objective's offset is the f64 zero on both layouts", () => {
    const s = din();
    for (const h of [0, 0.25, 1, 2.25, 3.2]) {
      expect(illuminationOffset(s, h, L, { layout: "exit" })).toBe(0);
      expect(illuminationOffset(s, h, L, { layout: "aim" })).toBe(0);
    }
  });

  it("a frame's tile carries its layout's offset, read through the frame's own probe", () => {
    const s = rimDin();
    for (const layout of ["aim", "exit"] as const) {
      const tile = objectFieldTile(s, {
        size: 32,
        pupilSamples: 16,
        wavelengthNm: L,
        layout,
        centreMm: { x: imageRadiusForObjectHeight(s, 1, L), y: 0 },
      });
      const p = fieldPupilAt(s, tile, 0.5, 0.5, FIELD);
      expect(p.radialIlluminationOffset).toBe(
        illuminationOffset(s, p.objectHeightMm, L, { layout, probeHeightMm: tile.probeHeightMm }),
      );
    }
  });
});

describe("§ 2n.3 — the traced condenser's currency, inverted", () => {
  // § 6ag.3 found the aim layout's pupil coordinate is a TANGENT: the
  // aberration-free cone converged on tan(NA_c)/tan(u_max) as NA³ and the sine
  // ratio floored at 0.5%. On the exit layout the coordinate is the optical sine
  // over ν, so the finding must turn over.
  const s = rimDin();
  const edgeOf = (na: number) => {
    const c = abbeCondenser({ numericalAperture: na });
    const rev = reverseCondenser(c, L);
    const map = pupilDirectionMap(s, 0, L, { layout: "exit" });
    const inside = (rho: number) => {
      const sl = map.slopesOf(rho, 0);
      if (sl === null) return false;
      const b = diaphragmLanding(rev, 0, sl[0], sl[1]);
      return b !== null && Math.hypot(b.x, b.y) <= c.diaphragmRadiusMm;
    };
    let lo = 0;
    let hi = 4;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  it("closing the aperture reaches the SINE ratio as NA³, and the tangent ratio never", () => {
    const nu = canonicalApertureSine(s, L);
    const span = pupilDirectionMap(s, 0, L, { layout: "aim" }).unit;
    const nas = [0.1, 0.05, 0.01, 0.001];
    const absSin = nas.map((na) => Math.abs(edgeOf(na) - na / nu));
    const relTan = nas.map((na) => Math.abs(edgeOf(na) / (tanOf(na) / span) - 1));
    // 5.169e-3, 6.39e-4, 5.10e-6, 5.10e-9: NA³ — § 6ag.3's tangent numbers, now on the sine.
    expect(absSin[3]!).toBeLessThan(1e-8);
    for (let i = 1; i < nas.length; i++) {
      expect(absSin[i - 1]! / absSin[i]! / (nas[i - 1]! / nas[i]!) ** 3).toBeCloseTo(1, 1);
    }
    // The tangent floors at the gap between the aimer's tangent ruler and the
    // frame's sine one — 1.16e-2, tan u_max/ν − 1, and no lens improves it.
    expect(relTan[3]!).toBeCloseTo(span / nu - 1, 5);
    expect(relTan[3]!).toBeGreaterThan(1e-2);
  });
});

describe("§ 2n.5 — the traced condenser, on the exit layout", () => {
  // § 6ag's cone built through the canonical map: the same construction, read in
  // sines. Its dial becomes a ratio of numerical apertures, and the finding § 6ag.4
  // led with — the condenser's aberration lands in the WEIGHTS, 1.32% across the
  // cone on axis — turns out to be half currency: an Abbe condenser maps its
  // diaphragm nearly uniformly onto direction SINES, so read in sines the axial
  // cone is flat to 2.4e-4. Off axis the spread is the condenser's own field
  // aberration and survives the change of units almost whole.
  const s = rimDin();
  const rev = reverseCondenser(abbeCondenser({ numericalAperture: 0.1 }), L);
  const coneAt = (h: number, layout: "aim" | "exit") =>
    tracedCondenserCone(s, rev, h, { pupilSamples: 16, apertureFraction: 0.8, layout });

  it("its dial is apertureFraction·NA_c/ν, a ratio of sines, exactly", () => {
    const nu = canonicalApertureSine(s, L);
    expect(coneAt(0, "exit").coherenceParameter).toBe((0.8 * 0.1) / nu);
    // The aim layout's is the tangent ratio, 0.8 exactly on this matched pair.
    expect(coneAt(0, "aim").coherenceParameter).toBeCloseTo(0.8, 12);
  });

  it("on axis its weights are flat in sines, where the tangent reading spread them 1.32%", () => {
    expect(coneAt(0, "aim").weightSpread).toBeCloseTo(1.323e-2, 4);
    expect(coneAt(0, "exit").weightSpread).toBeLessThan(3e-4);
  });

  it("off axis the spread is the condenser's own, in either currency", () => {
    // 4.95% and 11.3% read through the tangent, 4.82% and 10.6% through the sine.
    for (const [h, aim, exit] of [
      [1, 4.954e-2, 4.822e-2],
      [2.25, 1.13e-1, 1.057e-1],
    ] as const) {
      expect(coneAt(h, "aim").weightSpread).toBeCloseTo(aim, 3);
      expect(coneAt(h, "exit").weightSpread).toBeCloseTo(exit, 3);
    }
  });

  it("…and it is centred where `illuminationOffset` says, through the same map", () => {
    // The weighted centroid against the axial direction's own coordinate: equal on
    // axis, and off it apart by the cone's coma (§ 6ag.8) in either currency —
    // 0.2157 against 0.2198 at 1 mm on the exit layout, 0.1989 against 0.2174 on
    // the aim one.
    for (const layout of ["aim", "exit"] as const) {
      const centroid = (h: number) => coneAt(h, layout).points.reduce((t, p) => t + p.weight * p.sx, 0);
      expect(Math.abs(centroid(0))).toBeLessThan(1e-15);
      const off = illuminationOffset(s, 1, L, { layout });
      expect(Math.abs(centroid(1) / off - 1)).toBeLessThan(0.1);
    }
  });
});

describe("§ 2n.4 — the clear field is Fresnel's, and the cone darkens it by its own obliquity", () => {
  const s = singlet();
  const n = getMedium("N-BK7").n(L);
  const T = (1 - ((n - 1) / (n + 1)) ** 2) ** 2;
  const frame = objectFieldFrame(s, { size: 32, pupilSamples: 16, layout: "exit" });
  const clear = (source: ReturnType<typeof diskSource>) => {
    const object = rasterizeSpecimen(s, frame, () => ({ re: 1, im: 0 }), { map: "uniform" });
    return level(
      renderBrightfield(object, tracedFieldPupils(s, frame, FIELD), source, {
        pupilSamples: 16,
        scale: frame.scale,
        patches: 1,
      }).intensity,
    );
  };

  it("lit straight through it is (1 − R)² for the two uncoated surfaces, to the fit", () => {
    // 1.37e-7: the 45-term fit of √|P|² read at the pupil's centre.
    expect(Math.abs(clear(diskSource(0, 1)) / T - 1)).toBeLessThan(3e-7);
  });

  it("lit by an S = 0.5 cone it is (1 − R)²·⟨cos θ⟩ over the cone, θ from its optical sine", () => {
    // The prediction, written before the run: a source weight is a wave's
    // amplitude² (`illumination/source`), and the field component's own power is
    // cos θ, so the level is T·Σw·cos θ — about −1.6e-6, where the Jacobian
    // density read −9.18e-4. Measured −1.5435e-6.
    const source = diskSource(0.5, 15);
    const nu = canonicalApertureSine(s, L);
    let mean = 0;
    for (const p of source.points) mean += p.weight * Math.sqrt(1 - (Math.hypot(p.sx, p.sy) * nu) ** 2);
    const got = clear(source) / T;
    expect(mean - 1).toBeLessThan(-1.4e-6);
    expect(Math.abs(got - mean)).toBeLessThan(3e-7);
  });

  it("…and stays flat across tiles on an objective that is not object-space telecentric", () => {
    // The rim DIN's cone walks off centre by § 6x's offset, so each tile reads the
    // pupil at different points. A field component's power does not depend on
    // where in the pupil it lands, so the tiles agree to the throughput's own
    // drift — the aim layout, which carries no radiometry at all, drifts 3.1e-5
    // over the same 2 mm; this one 4.2e-5.
    const r = rimDin();
    const at = (h: number) => {
      const tile = objectFieldTile(r, {
        size: 32,
        pupilSamples: 16,
        wavelengthNm: L,
        layout: "exit",
        centreMm: { x: h === 0 ? 0 : imageRadiusForObjectHeight(r, h, L), y: 0 },
      });
      const object = rasterizeSpecimen(r, tile, () => ({ re: 1, im: 0 }), { map: "uniform" });
      return level(
        renderBrightfield(object, tracedFieldPupils(r, tile, FIELD), diskSource(0.5, 15), {
          pupilSamples: 16,
          scale: tile.scale,
          patches: 1,
        }).intensity,
      );
    };
    const axis = at(0);
    expect(Math.abs(at(2) / axis - 1)).toBeLessThan(6e-5);
  });
});
