import { describe, it, expect } from "vitest";
import {
  exactCapSinAlpha,
  renderVolumeScene,
  resolveMount,
  type MountChoice,
  type VolumeRequest,
} from "../src/volume";
import { entryOf, buildFrame, LAMBDA_NM } from "../src/microscope";
import { mountAperture } from "@telemicroscope/core/imaging";
import { objectNumericalAperture } from "@telemicroscope/core/pupil";

/**
 * The picture chooses its depth wavefront — § 6k.9 arriving in the app.
 *
 * **No engine capability was added here, so no validation-ladder rung was.**
 * Every number below is § 6k.8's and § 6k.9's, called from the app; what is
 * pinned is the wiring, and the wiring here has three failure modes that a
 * screenshot would not show.
 *
 * The **first** is silence. `mountPupils`' aperture argument defaults to 0, and
 * at 0 `withObjectDefocus` is `withDefocus` **bitwise** — so a panel that forgets
 * to pass it does not throw, does not warn, and draws the osculating paraboloid
 * under a caption describing the cap. Only a picture-against-picture comparison
 * catches that, which is what the first two rungs are.
 *
 * The **second** is the wrong index. sin α = NA/n needs the medium the *depths*
 * are measured in, and this panel has two indices in scope at all times — the
 * mount's and the immersion's — which differ by 12% on a shipped row while both
 * being plausible. The band identity below is the check: it is (1 + cos α)/2 of
 * the paraboloid's, so feeding it the immersion's index moves the answer while
 * nothing else on the panel flinches.
 *
 * The **third** is the one this step could most easily have got wrong in the
 * *caption* rather than in the code. The two in-focus fractions are **equal** on
 * every setting the panel can reach, and printing them side by side without the
 * reason would read as "the correction does not matter" — the exact opposite of
 * the finding. So the rung pins the mechanism (a band ordering) rather than the
 * coincidence, and would fail if the panel's stepping ever changed underneath it.
 *
 * The one thing genuinely NEW here is the last describe: § 6k.9's guard and
 * § 6l.3's wall turn out to be the same radius, which nothing on the ladder says
 * because the two were derived one module and eight sub-steps apart. That is
 * recorded as an identity, not as a change — relaxing the guard on the strength
 * of it is an engine step with its own rung, and OPEN-PROBLEMS carries it.
 */

const OIL = entryOf("oil-100x-140").spec;
const DRY = entryOf("inf-20x-010").spec;

const base = (
  spec: VolumeRequest["spec"],
  pupilSamples: number,
  mount: MountChoice,
): VolumeRequest => ({
  spec,
  pupilSamples,
  size: pupilSamples + 2 <= 128 ? 128 : 256,
  planes: 9,
  focusPlane: 0,
  beadsPerPlane: 8,
  seed: 7,
  mount,
  depthUm: 0,
});

function readout(request: VolumeRequest) {
  const r = renderVolumeScene(request);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.readout;
}

/** Worst disagreement between two pictures, as a share of the reference's peak. */
function gapOverPeak(a: Float64Array, b: Float64Array, peak: number): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst / peak;
}

describe("§ 6k.9 in the app — the picture is on the exact cap", () => {
  it("differs from the paraboloid by a third of the peak on the shipped oil 1.40", () => {
    // The whole content of the change, as one number. The comparison picture is
    // built by asking for the aperture the app now passes and rendering the same
    // scene at sin α = 0, which is what this module drew before the change and is
    // `withDefocus` bit for bit.
    const r64 = readout(base(OIL, 64, "matched"));
    expect(r64.depthWavefront).toBe("exact");
    const paraboloid = paraboloidRender(OIL, 64, "matched");
    const gap = gapOverPeak(r64.intensity, paraboloid.intensity, paraboloid.peak);
    // Recorded reading, bracketed at its ORDER rather than pinned: it is a peak
    // difference over a bead field, so its last digits belong to which bead
    // landed where. What the bracket claims is the thing the step exists for —
    // that the osculating paraboloid is not a small error at an immersion
    // aperture, it is a third of the picture.
    expect(gap).toBeGreaterThan(0.3);
    expect(gap).toBeLessThan(0.4);
  });

  it("and the coarse default UNDER-reports it, which is why the guard is left to fire", () => {
    // 32 bins is the panel's default and the exact cap crosses its 0.5 waves per
    // sample guard there. The temptation is to raise the default; the measurement
    // says not to. The difference between the two pictures GROWS as the pupil
    // refines, so the coarse grid is under-reporting the very thing the change is
    // for, and a warning that says "refine the pupil" is the true statement.
    const gaps = [32, 48, 64].map((bins) => {
      const exact = readout(base(OIL, bins, "matched"));
      const para = paraboloidRender(OIL, bins, "matched");
      return gapOverPeak(exact.intensity, para.intensity, para.peak);
    });
    expect(gaps[0]!).toBeLessThan(gaps[1]!);
    expect(gaps[1]!).toBeLessThanOrEqual(gaps[2]!);
    // And the under-report is worth naming: a tenth of the answer, at the setting
    // a reader opens the panel on.
    expect(gaps[0]! / gaps[2]!).toBeLessThan(0.95);
  });

  it("crosses the panel's grid guard at 32 bins and clears it at 64", () => {
    // The cost, pinned so it cannot regress into silence. 0.5 is the panel's
    // GRID_STEP_LIMIT; the caption's guard is what carries this to a reader.
    expect(readout(base(OIL, 32, "matched")).maxGridPhaseStepWaves).toBeGreaterThan(0.5);
    expect(readout(base(OIL, 64, "matched")).maxGridPhaseStepWaves).toBeLessThan(0.5);
    // The paraboloid never does, at either size — so the guard firing is the cap
    // and not the mount or the objective.
    expect(paraboloidRender(OIL, 32, "matched").grid).toBeLessThan(0.5);
  });

  it("is bounded above by 1/cos α — the steeper rim, as a sampling cost", () => {
    // § 6k.8's third appearance of 1/cos α. The exact wavefront's rim slope is
    // 2w/√(1−s²ρ²) against the paraboloid's 2w, so the ratio of grid steps is
    // 1/√(1−s²ρ̄²) at whatever ρ̄ the outermost lit pair of samples straddles —
    // strictly below 1/cos α, and climbing toward it as the lattice reaches
    // closer to the rim. A closed-form ceiling with no engine in it, and the one
    // statement here that does not depend on which bead landed where.
    // The angle off the readout rather than off a literal, so this rung moves
    // with the traced objective instead of asserting one that was typed in.
    const s = readout(base(OIL, 32, "matched")).capSinAlpha!;
    const ceiling = 1 / Math.sqrt(1 - s * s);
    const ratios = [32, 48, 64, 96].map(
      (bins) =>
        readout(base(OIL, bins, "matched")).maxGridPhaseStepWaves /
        paraboloidRender(OIL, bins, "matched").grid,
    );
    for (const r of ratios) expect(r).toBeLessThan(ceiling);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeGreaterThan(ratios[i - 1]!);
    // Climbing, and still 8% short at 96 bins: the last sample is half a bin in
    // from the rim and that is where the whole factor lives.
    expect(ratios.at(-1)!).toBeGreaterThan(0.9 * ceiling);
  });

  it("changes nothing a reader would see at the panel's own default objective", () => {
    // Why this could sit unnoticed for eight sub-steps, and the non-regression
    // that matters most: the panel opens on a dry 20×/0.10, where sin α is 0.1
    // and (1 + cos α)/2 is 0.9975. The two pictures differ by parts per
    // thousand — the same fact as the third above, seen where nobody looks.
    const exact = readout(base(DRY, 32, "matched"));
    const para = paraboloidRender(DRY, 32, "matched");
    expect(gapOverPeak(exact.intensity, para.intensity, para.peak)).toBeLessThan(3e-3);
  });
});

describe("§ 6k.9 in the app — the band, and the light that happens to be in it", () => {
  it("reports the exact band as (1 + cos α)/2 of the paraboloid's, in the MOUNT's index", () => {
    // The identity that catches the wrong index. Both numbers are on the readout,
    // and their ratio is a closed form with no engine in it — so feeding sin α
    // the immersion's 1.5233 in place of the mount's index moves this and nothing
    // else on the panel.
    for (const mount of ["matched", "IMMERSION-OIL"] as MountChoice[]) {
      const r = readout(base(OIL, 32, mount));
      expect(r.capSinAlpha).not.toBeNull();
      expect(r.exactDepthOfFocusUm).not.toBeNull();
      const s = r.capSinAlpha!;
      // `toBe`, because it is the same division of the same two doubles — an
      // identity of the arithmetic, so a tolerance here would be hiding nothing.
      expect(s).toBe(r.tracedNA / r.mountIndex);
      const factor = (1 + Math.sqrt(1 - s * s)) / 2;
      // Relatively, and at a few ulps: the band is the paraboloid's times this
      // factor, so the ratio is one multiply and one divide of a well-conditioned
      // quantity and nothing here is a residue of cancellation.
      expect(Math.abs(r.exactDepthOfFocusUm! / r.depthOfFocusUm / factor - 1)).toBeLessThan(1e-15);
      // And it is a real shortening, not a rounding: about 70% of the band the
      // ladder's older readings were taken over.
      expect(factor).toBeGreaterThan(0.68);
      expect(factor).toBeLessThan(0.70);
    }
  });

  it("reads the two in-focus fractions EQUAL, and the band ordering is why", () => {
    // The caption's whole risk. These agree because the slab steps by one
    // PARABOLOID depth of focus and the focus does too: the focused plane sits at
    // offset 0 and its neighbours a whole step away, so a window 30% narrower
    // catches the same one plane and misses the same two. It is the band that
    // moved, not the light in it.
    const r = readout(base(OIL, 32, "matched"));
    expect(r.exactInFocusFraction).not.toBeNull();
    expect(r.exactInFocusFraction!).toBeCloseTo(r.inFocusFraction!, 14);

    // Pinned as the MECHANISM rather than as the coincidence, so that a change to
    // the panel's stepping fails here instead of quietly making the caption
    // false: 0 < exact half-band < paraboloid half-band < one plane step.
    const step = r.depthOfFocusUm;
    expect(0).toBeLessThan(r.exactDepthOfFocusUm! / 2);
    expect(r.exactDepthOfFocusUm! / 2).toBeLessThan(r.depthOfFocusUm / 2);
    expect(r.depthOfFocusUm / 2).toBeLessThan(step);
  });
});

describe("§ 6l.11 in the app — the two mounts that could not have it, and the rim that gave it", () => {
  it("~~shows the engine's refusal rather than defaulting past it~~ — both rows now carry the cap", () => {
    // What this rung pinned: an oil 1.40 over water or air is NA ≥ n, which
    // `objectSinAlpha` refused, so every exact-cap field was null TOGETHER and
    // the picture stayed on the paraboloid. § 6l.10 gave those rows the exact
    // phase and § 6l.11 the band at the rim their light actually reaches, so the
    // absent-together invariant is now kept by nothing being absent — which is
    // the whole of what register item 18 was blocking.
    for (const mount of ["WATER", "AIR"] as MountChoice[]) {
      const r = readout(base(OIL, 32, mount));
      expect(r.capSinAlpha).not.toBeNull();
      expect(r.exactDepthOfFocusUm).not.toBeNull();
      expect(r.exactInFocusFraction).not.toBeNull();
      expect(r.depthWavefront).toBe("exact");
      // sin α is above 1 here and is not an aperture angle: it is NA/n_s, and
      // 1/s is where the pupil goes dark (§ 6l.10).
      expect(r.capSinAlpha!).toBeGreaterThan(1);
      expect(r.capSinAlpha!).toBe(r.tracedNA / r.mountIndex);
      // The headline, and it is NA-free: the band is λ/2n, so it does not depend
      // on the traced aperture at all — 206.0 nm out of water, 275.0 out of air.
      // The outermost ray the specimen delivers is grazing and a wider pupil adds
      // none, which is why a number that used to scale as 1/NA² has stopped.
      expect(r.exactDepthOfFocusUm!).toBeCloseTo(LAMBDA_NM * 1e-3 / (2 * r.mountIndex), 12);
      // And the picture is no longer the paraboloid's: this is § 6l.10's change
      // arriving on screen, the largest one the ladder has.
      const para = paraboloidRender(OIL, 32, mount);
      expect(gapOverPeak(r.intensity, para.intensity, para.peak)).toBeGreaterThan(0.05);
    }
    // Water and air read 206.0 and 275.0 nm against paraboloid bands that differ
    // by more than that, so the percentages are NOT ordered the way the shortening
    // sentence assumed: 55% on water, 98% on air. The second is 1.4²/2 and an
    // arithmetic coincidence rather than a small correction.
    const water = readout(base(OIL, 32, "WATER"));
    const air = readout(base(OIL, 32, "AIR"));
    // Against the closed form first, so the percentages below are a reading of
    // the identity rather than two numbers that happen to agree.
    for (const r of [water, air]) {
      expect(r.exactDepthOfFocusUm! / r.depthOfFocusUm).toBeCloseTo(
        (r.capSinAlpha! * r.capSinAlpha!) / 2,
        12,
      );
    }
    expect(water.exactDepthOfFocusUm! / water.depthOfFocusUm).toBeCloseTo(0.5512, 4);
    // Air's mount index is exactly 1, so this one is 1.4²/2 and nothing else —
    // and 98% is what an arithmetic coincidence looks like beside a band that
    // changed by a factor of two in the wavefront it is read on.
    expect(air.exactDepthOfFocusUm! / air.depthOfFocusUm).toBeCloseTo(0.98, 6);
    expect(air.exactDepthOfFocusUm!).toBeGreaterThan(water.exactDepthOfFocusUm!);
    // And the helper is the one place that decides, so it says the same thing.
    // What it still refuses is the immersion-side question a mount cannot ask of
    // itself — an NA at or above the medium the objective was corrected for.
    const system = oilSystem();
    expect(exactCapSinAlpha(resolveMount(system, "WATER"), 1.4)).not.toBeNull();
    expect(exactCapSinAlpha(resolveMount(system, "matched"), 1.4)).not.toBeNull();
    expect(exactCapSinAlpha(resolveMount(system, "WATER"), 99)).toBeNull();
  });

  it("puts the mount's dark rim at exactly the cap's own branch radius", () => {
    // Nothing on the ladder says this, because the two were derived a module and
    // eight sub-steps apart. § 6l.3: no ray of invariant above n_s leaves the
    // specimen, so `withMountAberration` zeroes the amplitude beyond
    // ρ = min(NA, n_s)/NA. § 6k.8: the exact phase's radicand 1 − s²ρ² with
    // s = NA/n goes non-positive beyond ρ = 1/s = n/NA. When the mount truncates
    // at all, those are the SAME EXPRESSION — so the exact phase is defined
    // exactly where light exists and undefined exactly where none does.
    //
    // `toBe` and not a tolerance: min(NA, n)/NA and n/NA are the same division of
    // the same two doubles once the min has chosen n, so this is an identity of
    // the arithmetic and not an agreement of two derivations.
    //
    // **§ 6l.10 found the limit of that sentence, and it is the squaring.** This
    // identity is real in the RADIUS and both engine sites work in radius², where
    // (n/NA)² and 1/(NA/n)² are different roundings that disagree by an ulp in
    // either direction — on an oil 1.45 or 1.49 over air the old radicand test
    // fired on a lit sample. So "defined exactly where light exists" was true of
    // the algebra and not of the arithmetic, which is why § 6l.10's answer is to
    // delete the second boundary rather than to align it. What is pinned below
    // still holds and is still worth holding; it is just not the whole claim.
    const system = oilSystem();
    const na = objectNumericalAperture(system, LAMBDA_NM);
    for (const choice of ["WATER", "AIR"] as MountChoice[]) {
      const mount = resolveMount(system, choice);
      const spec = {
        mountIndex: mount.index,
        immersionIndex: mount.immersionIndex,
        numericalAperture: na,
        wavelengthNm: LAMBDA_NM,
        focusDepthMm: 0,
      };
      const darkRim = mountAperture(spec) / na;
      const branchRadius = mount.index / na;
      expect(darkRim).toBe(branchRadius);
      expect(darkRim).toBeLessThan(1);
    }
    // A matched mount truncates nothing, and there the radicand never runs out
    // inside the pupil either — the same statement with both sides above 1.
    const matched = resolveMount(system, "matched");
    expect(matched.index / na).toBeGreaterThan(1);
  });
});

/** The system the oil row builds, for the readouts that need it directly. */
function oilSystem() {
  return buildFrame({ spec: OIL, pupilSamples: 32, size: 128 }).system;
}

/**
 * The same scene on the **paraboloid** — this module's own pre-§ 6k.9 render.
 *
 * Not a test hook: it is the panel's own `depthWavefront` control, which exists
 * because this change is invisible on screen without both pictures. And it is
 * not a second code path either — `withObjectDefocus` at sin α 0 is `withDefocus`
 * **bitwise**, since 2wρ²/(1+1) and wρ² differ by a multiplication and a division
 * by two and binary scaling is exact. So what this returns is the picture the
 * panel drew before the change, not an approximation of it.
 */
function paraboloidRender(
  spec: VolumeRequest["spec"],
  pupilSamples: number,
  mount: MountChoice,
): { intensity: Float64Array; peak: number; grid: number } {
  const r = readout({ ...base(spec, pupilSamples, mount), depthWavefront: "paraboloid" });
  expect(r.depthWavefront).toBe("paraboloid");
  return { intensity: r.intensity, peak: r.peak, grid: r.maxGridPhaseStepWaves };
}
