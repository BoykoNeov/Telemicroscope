import { describe, it, expect } from "vitest";
import {
  axialResponse,
  depthStrehl,
  MARECHAL_FLOOR,
  memoizedPupil,
  renderVolumeScene,
  resolveMount,
  type MountChoice,
  type VolumeRequest,
} from "../src/volume";
import { buildFrame, LAMBDA_NM } from "../src/microscope";
import { fieldPupilAt } from "@telemicroscope/core/imaging";
import { getMedium } from "@telemicroscope/core/materials";

/**
 * D10 — A5's z-slider through a real mount, as invariants rather than as prose.
 *
 * **No engine capability was added here, so no validation-ladder rung was**: every
 * number these tests reach for is § 6l's, called from the app. What is pinned is
 * the *wiring*, and the wiring is where this step's two failure modes live.
 *
 * The first is § 6l.9's coupling. `renderVolume` turns a slice's millimetres into
 * waves with W = ½·δ·NA²/n, and the n there is the **mount**; if the panel let the
 * immersion's index reach it, every slice would be aberrated for a depth 14% wrong
 * and nothing in the resulting image would look wrong. `mountVolumeOptions`
 * refuses the override, so what is left to check on this side is that the depth of
 * focus the panel derives carries the same index — a plane step is half a wave
 * only if it does.
 *
 * The second is the identity D10 promises the reader: **a matched mount must
 * reproduce this panel's pre-mount self**. The *mechanism* is bit-for-bit —
 * `withMountAberration` returns the pupil object itself when the indices agree,
 * so no arithmetic is done at all — but the *render* is not quite, and the
 * difference is worth being exact about rather than overclaiming: the slab is now
 * authored at absolute depths, so a slice's defocus is computed as (D + z) −
 * (D + f) where it used to be z − f, and the low bits of D do not cancel. What is
 * pinned below is therefore the hard zero (`toBe(0)`, at every depth) and f64
 * agreement of the image, which is what the physics actually says.
 *
 * The third thing these tests hold is a rule neither the engine nor § 6l has any
 * reason to state, because it only exists once a *panel* puts a slab somewhere:
 * **no plane may sit above the coverslip.** The stack is linear in depth and
 * would happily continue through negative thickness, handing a plane above the
 * slip the aberration of a mismatch with the wrong sign — where the truth is
 * zero, since its light crosses only what the objective was corrected for. Both
 * the picture's slab and the cone's own stack are anchored so it cannot happen.
 */

const base: Omit<VolumeRequest, "mount" | "depthUm"> = {
  kind: "oil-100x-125",
  pupilSamples: 32,
  size: 128,
  planes: 5,
  focusPlane: 0,
  beadsPerPlane: 6,
  seed: 7,
};

const render = (mount: MountChoice, depthUm: number) => {
  const result = renderVolumeScene({ ...base, mount, depthUm });
  if (!result.ok) throw new Error(result.error);
  return result.readout;
};

describe("D10 — the mount reaches the render, and a matched one is a hard zero", () => {
  it("resolves `matched` to the objective's own object medium, index-for-index", () => {
    // Not to the immersion oil: § 6e puts the specimen under the slip, so
    // `objectMedium` for the 100× oil rows is the cover glass D263 (1.5233) and
    // not the oil (1.5151). A panel that called the matched setting "immersion"
    // would be quietly wrong on exactly the rows where the mount matters.
    const { system } = buildFrame({ kind: "oil-100x-125", pupilSamples: 32, size: 128 });
    const matched = resolveMount(system, "matched");
    expect(matched.name).toBe("D263");
    expect(matched.matched).toBe(true);
    expect(matched.index).toBe(matched.immersionIndex);

    // And picking the immersion oil off the list is a real mismatch, small but
    // not zero — the near-match that a name comparison would have called equal.
    const oil = resolveMount(system, "IMMERSION-OIL");
    expect(oil.matched).toBe(false);
    expect(Math.abs(oil.index - oil.immersionIndex)).toBeGreaterThan(1e-3);

    // A dry objective's matched mount is air, and choosing AIR reaches the same
    // branch rather than a near miss: the comparison is on the index.
    const dry = buildFrame({ kind: "inf-20x-010", pupilSamples: 32, size: 128 }).system;
    expect(resolveMount(dry, "AIR")).toEqual(resolveMount(dry, "matched"));
  });

  it("puts the MOUNT's index in the depth of focus, not the objective's medium", () => {
    // § 6l.9's coupling seen from the app's side: W = ½·δ·NA²/n with n the mount,
    // so the depth of focus that makes one plane step exactly half a wave has to
    // carry the same index. The ratio is the indices' and nothing else.
    const matched = render("matched", 0);
    const water = render("WATER", 0);
    const nWater = getMedium("WATER").n(LAMBDA_NM);
    expect(water.depthOfFocusUm / matched.depthOfFocusUm).toBeCloseTo(
      nWater / matched.objectMediumIndex,
      12,
    );
  });

  it("aberrates identically zero at every depth when the mount is matched", () => {
    // The layer carries (n_s²−n_i²) as an explicit factor, so this is a `toBe(0)`
    // and not a small residual — § 6l.2, arriving where a microscopist meets it.
    for (const depthUm of [0, 2.5, 12, 20]) {
      expect(render("matched", depthUm).focusDepthWaves).toBe(0);
    }
    // And a mismatched one does not, with the sign the physics predicts: water is
    // RARER than the cover glass, so the wavefront is negative.
    expect(render("WATER", 5).focusDepthWaves).toBeLessThan(0);
  });

  it("so a matched slab renders the same image wherever it is put", () => {
    // Not bit-for-bit, and the reason is arithmetic rather than physics: the slab
    // is authored at absolute depths, so a slice's defocus is (D + z) − (D + f)
    // where it used to be z − f, and the low bits of D do not cancel. What is
    // invariant is the physics, and it survives to f64.
    const here = render("matched", 0);
    const deep = render("matched", 18);
    expect(deep.peakOverMean!).toBeCloseTo(here.peakOverMean!, 9);
    expect(deep.totalLight).toBeCloseTo(here.totalLight, 9);
    for (let i = 0; i < here.intensity.length; i += 977) {
      expect(deep.intensity[i]!).toBeCloseTo(here.intensity[i]!, 12);
    }
  });

  it("and a mismatched one is worse the deeper it goes — the slab is already in it", () => {
    // Note what a mismatched mount costs at a depth control of ZERO: the slab has
    // thickness and its top face is the origin, so every plane below the first is
    // already looking through the mount. Only a single-plane slab at zero would
    // be free, which is the difference between "the specimen starts at the slip"
    // and "the specimen is at the slip".
    const shallow = render("WATER", 0);
    const deep = render("WATER", 18);
    expect(deep.peakOverMean!).toBeLessThan(0.9 * shallow.peakOverMean!);
    expect(render("matched", 18).peakOverMean!).toBeGreaterThan(1.1 * deep.peakOverMean!);

    // A one-plane slab at the slip IS free, and that is the same identity from
    // the other side: no plane is below the origin, so nothing is looked through.
    const single = { ...base, planes: 1, focusPlane: 0, depthUm: 0 };
    const wet = renderVolumeScene({ ...single, mount: "WATER" });
    const dry = renderVolumeScene({ ...single, mount: "matched" });
    if (!wet.ok || !dry.ok) throw new Error("refused");
    expect(wet.readout.peakOverMean!).toBeCloseTo(dry.readout.peakOverMean!, 9);
  });

  it("keeps every plane at or below the coverslip, at every setting", () => {
    // The reason the control is the slab's TOP FACE and not its middle. A plane
    // above the slip has no mount to look through — its light crosses the slip
    // and the immersion, which is what the objective was corrected for — while
    // the stack, being linear in depth, would hand it a mismatch of the WRONG
    // SIGN. Anchoring to the top face makes negative depth unreachable rather
    // than clamped, so the focused plane's own depth is never negative either.
    for (const planes of [1, 5, 27]) {
      for (const focusPlane of [-(planes - 1) / 2, 0, (planes - 1) / 2]) {
        const r = renderVolumeScene({ ...base, planes, focusPlane, mount: "WATER", depthUm: 0 });
        if (!r.ok) throw new Error(r.error);
        expect(r.readout.focusDepthUm).toBeGreaterThanOrEqual(0);
        // A rarer mount aberrates negative, so a plane above the slip would show
        // up here as a POSITIVE wavefront. None does.
        expect(r.readout.focusDepthWaves).toBeLessThanOrEqual(0);
      }
    }
  });

  it("caps the delivered NA at the mount's own index — a readout, not a blur", () => {
    // § 6l.3. An objective engraved 1.40 collects nothing of higher invariant than
    // the mount can carry, so the resolution beside it is quoted at the cap.
    const oil = renderVolumeScene({ ...base, kind: "oil-100x-140", mount: "WATER", depthUm: 0 });
    if (!oil.ok) throw new Error(oil.error);
    expect(oil.readout.deliveredNA).toBe(getMedium("WATER").n(LAMBDA_NM));
    expect(oil.readout.deliveredNA).toBeLessThan(oil.readout.tracedNA);
    expect(oil.readout.abbeResolutionNm).toBeGreaterThan(
      (LAMBDA_NM / (2 * oil.readout.tracedNA)) * 1.04,
    );

    // The same objective in air is capped harder still, and by exactly 1.
    const dry = renderVolumeScene({ ...base, kind: "oil-100x-140", mount: "AIR", depthUm: 0 });
    if (!dry.ok) throw new Error(dry.error);
    expect(dry.readout.deliveredNA).toBe(1);
  });
});

describe("D10 — the two questions, and what each one keeps", () => {
  it("anchors the cone stack below the slip too, and its span moves with the mount", () => {
    // The cone asks the VOLUME question, so it has a thickness of specimen behind
    // it — ±4 waves about its focus — and the same rule applies: no slice above
    // the slip. Its shallowest is the depth control exactly, and its depth in
    // MICRONS carries the mount's index, because a wave of defocus is four depths
    // of focus and a depth of focus is n·λ/(2·NA²).
    const dry = axialResponse({ kind: "oil-100x-125", mount: "matched", depthUm: 0 });
    const wet = axialResponse({ kind: "oil-100x-125", mount: "WATER", depthUm: 7.5 });
    if (!dry.ok || !wet.ok) throw new Error("refused");
    expect(dry.readout.coneTopDepthUm).toBe(0);
    expect(wet.readout.coneTopDepthUm).toBe(7.5);
    expect(wet.readout.coneBottomDepthUm).toBeGreaterThan(wet.readout.coneTopDepthUm);
    const nWater = getMedium("WATER").n(LAMBDA_NM);
    expect(
      (wet.readout.coneBottomDepthUm - 7.5) / dry.readout.coneBottomDepthUm,
    ).toBeCloseTo(nWater / dry.readout.objectMediumIndex, 12);
  });

  it("keeps the missing cone EMPTY through a mount, and loses the support LAW", () => {
    // § 6l.6 exactly, and the split is the content. The ν = 0 null needs only an
    // amplitude that does not move with depth, and depth-dependent SA is a pure
    // phase — so it survives. The support boundary ν·(2 − ν) needed the stack to
    // be a DEFOCUS family, and it is not one any more — so it does not. A panel
    // that coloured the second one red would be reporting a broken rung where
    // there is a measurement.
    const wet = axialResponse({ kind: "oil-100x-125", mount: "WATER", depthUm: 10 });
    if (!wet.ok) throw new Error(wet.error);
    expect(wet.readout.cones[0]!.worstNonDc).toBeLessThan(1e-12);
    const moved = wet.readout.cones.filter((c) => c.nu > 0 && c.edgeBins > 1);
    expect(moved.length).toBeGreaterThan(0);

    // And both come back when the mount does.
    const dry = axialResponse({ kind: "oil-100x-125", mount: "matched", depthUm: 10 });
    if (!dry.ok) throw new Error(dry.error);
    expect(dry.readout.cones[0]!.worstNonDc).toBeLessThan(1e-12);
    for (const c of dry.readout.cones.filter((c) => c.nu > 0)) {
      expect(c.edgeBins).toBeLessThanOrEqual(1.001);
    }
  });

  it("separates the mount's asymmetry from the objective's own residual defocus", () => {
    // A1 traces to the system's own image plane, so a row carries a residual
    // defocus that is already an asymmetry about w₂₀ = 0 with no mount in it —
    // the 100×/1.25 reads 0.47× at zero depth. Quoting the mounted number alone
    // would hand that share to the mount. The ideal-pupil control is what says
    // which is which, and a matched mount makes it exactly 1.
    const flat = axialResponse({ kind: "oil-100x-125", mount: "matched", depthUm: 10 });
    if (!flat.ok) throw new Error(flat.error);
    // The ideal control is REFUSED here rather than reading 1, and that is the
    // floor doing its job: an unaberrated pupil at ±1 wave sits exactly on
    // sinc²'s own null, so the ratio is two rounding errors divided by each
    // other. "Exactly 1" would have been arithmetic dressed as a measurement.
    expect(flat.readout.sweep.asymmetryIdeal).toBeNull();
    // The traced pupil's own residual defocus lifts it off that null, so its
    // pair IS defined — and the two agree, because a matched mount does nothing.
    expect(flat.readout.sweep.asymmetry).toBe(flat.readout.sweep.asymmetryBare);
    expect(flat.readout.sweep.asymmetry).not.toBeNull();

    const wet = axialResponse({ kind: "oil-100x-125", mount: "WATER", depthUm: 10 });
    if (!wet.ok) throw new Error(wet.error);
    // The mount's own share is LARGER than the mounted objective's, because the
    // objective's residual works the other way — which is the whole reason the
    // pair is printed rather than the single number.
    expect(wet.readout.sweep.asymmetryIdeal!).toBeGreaterThan(wet.readout.sweep.asymmetry!);
    expect(wet.readout.sweep.asymmetryBare!).toBeLessThan(1);
    // Best focus moves POSITIVE: water is rarer than D263, so the depth
    // aberration is negative and the compensating defocus is not.
    expect(wet.readout.sweep.peakWaves).toBeGreaterThan(0);
    expect(wet.readout.depthWaves).toBeLessThan(0);
  });
});

describe("D10 — the depth budget, bisected", () => {
  it("floors the over-report at (λ/14)/σ(0.8) = 0.9501 where third-order theory is right", () => {
    // The number is arithmetic, not a fit: Maréchal's λ/14 is an APPROXIMATION to
    // Strehl 0.8 — exp(−(2πσ)²) at σ = λ/14 is 0.8177 — so a bisection at 0.8 runs
    // 1.0525× deeper than the coefficient allows at EVERY aperture, whatever the
    // wavefront does. A dry 0.10 into water has no third-order departure left to
    // add to it, so the ratio lands on the floor and the whole bisection is
    // checked against a closed form rather than against itself.
    expect(MARECHAL_FLOOR).toBeCloseTo(0.9501, 4);
    const result = depthStrehl({ kind: "inf-20x-010", mount: "WATER" });
    if (!result.ok) throw new Error(result.error);
    expect(result.readout.overReport!).toBeCloseTo(MARECHAL_FLOOR, 2);
  });

  it("refuses to quote a budget where the engine does, and says which refusal", () => {
    // Two different refusals, and § 6l.9 turns on telling them apart. A matched
    // mount has no budget because there is nothing to spend; an objective whose
    // engraved NA the mount cannot deliver has none because the ceiling is OPEN —
    // the aperture is approached and never reached, so a tolerance quoted there
    // would be about rays that do not exist. The bisection still works in the
    // second case, because a mask's boundary is one lattice point of measure zero.
    const matched = depthStrehl({ kind: "oil-100x-125", mount: "matched" });
    if (!matched.ok) throw new Error(matched.error);
    expect(matched.readout.quotedMarechalUm).toBeNull();
    expect(matched.readout.quotedRefusal).toMatch(/identically zero/);
    expect(matched.readout.bisectedIdealUm).toBeNull();
    for (const point of matched.readout.curve) expect(point.ideal).toBe(1);

    const overNa = depthStrehl({ kind: "oil-100x-140", mount: "WATER" });
    if (!overNa.ok) throw new Error(overNa.error);
    expect(overNa.readout.quotedMarechalUm).toBeNull();
    expect(overNa.readout.quotedRefusal).toMatch(/not delivered|OPEN/);
    expect(overNa.readout.bisectedIdealUm!).toBeGreaterThan(0);
    expect(overNa.readout.bisectedIdealUm!).toBeLessThan(2);
  });

  it("over-reports by several times at an immersion aperture, and falls with depth", () => {
    // § 6l.4 on the row it can actually be quoted for. The departure is not the
    // objective's: it is the exact wavefront outrunning its own leading term as
    // the aperture nears the MOUNT's index, the smallest number in the stack.
    const result = depthStrehl({ kind: "oil-100x-125", mount: "WATER" });
    if (!result.ok) throw new Error(result.error);
    const r = result.readout;
    expect(r.overReport!).toBeGreaterThan(4);
    expect(r.bisectedIdealUm!).toBeLessThan(5);
    // Monotone, and it reaches the crossing inside the window the panel draws.
    expect(r.curve[0]!.ideal).toBe(1);
    expect(r.curve[r.curve.length - 1]!.ideal).toBeLessThan(0.8);
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i]!.ideal).toBeLessThanOrEqual(r.curve[i - 1]!.ideal + 1e-12);
    }
  });
});

describe("D10 — the memo is exact", () => {
  it("returns the pupil's own values, bit for bit, on a second look", () => {
    // It is memoization of a pure function and not a model of one: § 6s's radial
    // map is a cache with a MEASURED error because it could not be exact, and
    // this one can be, so any tolerance here would be hiding something.
    const { system, frame } = buildFrame({ kind: "oil-100x-125", pupilSamples: 32, size: 128 });
    const pupil = fieldPupilAt(system, frame, 0.5, 0.5).pupil;
    const memo = memoizedPupil(pupil);
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const px = i / 9;
        const py = j / 9;
        expect(memo.amplitude(px, py)).toBe(pupil.amplitude(px, py));
        expect(memo.phaseWaves(px, py)).toBe(pupil.phaseWaves(px, py));
        // Twice, so the cached branch is the one being compared.
        expect(memo.amplitude(px, py)).toBe(pupil.amplitude(px, py));
        expect(memo.phaseWaves(px, py)).toBe(pupil.phaseWaves(px, py));
      }
    }
  });
});
