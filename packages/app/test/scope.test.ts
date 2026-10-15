import { describe, it, expect } from "vitest";
import { COVERSLIP_MEDIUM, IMMERSION_MEDIUM, plateFocusShiftMm } from "@telemicroscope/core/designs";
import { getMedium } from "@telemicroscope/core/materials";
import { entryOf, LAMBDA_NM, type MicroscopeKind } from "../src/microscope";
import { renderSection } from "../src/section";
import {
  CONE_ANGLE_RAD,
  CONE_SPACING_MM,
  condenserCap,
  paraxialRefocusMm,
  renderScope,
  scopeSystem,
  STAGE_HOME,
  type ScopeReadout,
  type ScopeRequest,
} from "../src/scope";

/**
 * The whole microscope — APP.md Part S.
 *
 * No engine capability is added here (§ 6ct is the one this panel needed, and
 * it has its own rungs); what is pinned is that each part of the diagram is
 * wired to the physics it claims, and the two places it could silently lie:
 *
 * 1. **Nominal is the colour section, byte for byte.** With every part as
 *    designed and the slide at the origin, the diagram's optical image is
 *    `renderSection`'s spectral image. The diagram path is seeded (§ 6ct) and
 *    the section's is not; § 6ct.2 measures that difference at six ulp, and
 *    it does not reach a byte.
 * 2. **The detector samples the IMAGE plane.** A camera whose pitch equals
 *    the optical grid's own image-plane pixel records the optical image
 *    exactly — so the pitch is in the right space and the right way up. A
 *    pitch read as object-space would be off by |M| with nothing on screen to
 *    say so.
 *
 * Then one closed form per part that has one: the plate focus shift t(1 − 1/n)
 * for a slip under a dry objective, its immersion form Δt·n_oil/n_slip, the
 * tube lens's M ∝ f_tube, Newton's M = x′/f for a DIN tube, and the cone
 * spacing a published density implies.
 */

const at = (kind: MicroscopeKind, overrides: Partial<ScopeRequest> = {}): ScopeRequest => ({
  lamp: "equal-energy",
  coherenceParameter: 0.5,
  specimen: "diatom",
  stageUm: STAGE_HOME.diatom,
  focusUm: 0,
  slipMm: null,
  objective: entryOf(kind).spec,
  tubeMm: null,
  detector: { kind: "camera", pitchUm: 3.45 },
  pupilSamples: 32,
  size: 64,
  wavelengths: 3,
  ...overrides,
});

function render(request: ScopeRequest): ScopeReadout {
  const result = renderScope(request);
  if (!result.ok) throw new Error(result.error);
  return result.readout;
}

/** σ/μ of the green channel — a sharpness reading on the optical image. */
function contrast(readout: ScopeReadout): number {
  const n = readout.size * readout.size;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const g = readout.optical[i * 4 + 1]!;
    s += g;
    s2 += g * g;
  }
  const mean = s / n;
  return Math.sqrt(s2 / n - mean * mean) / mean;
}

const N_SLIP = getMedium(COVERSLIP_MEDIUM).n(LAMBDA_NM);
const N_OIL = getMedium(IMMERSION_MEDIUM).n(LAMBDA_NM);

describe("Part S — the diagram draws through the colour section's engine path", () => {
  it("is the colour section byte for byte when every part is as designed", () => {
    const scope = render(at("inf-10x-010", { stageUm: { x: 0, y: 0 } }));
    const section = renderSection({
      spec: entryOf("inf-10x-010").spec,
      specimen: "diatom",
      pupilSamples: 32,
      size: 64,
      wavelengths: 3,
      coherenceParameter: 0.5,
      lamp: "equal-energy",
    });
    if (!section.ok) throw new Error(section.error);
    expect(scope.size).toBe(section.readout.size);
    expect(Array.from(scope.optical)).toEqual(Array.from(section.readout.rgbaSpectral));
  });

  it("records the optical image exactly when the pixel is the optical grid's own", () => {
    const first = render(at("oil-100x-125"));
    const pitchUm = first.opticalPixelUm * first.magnification;
    const matched = render(at("oil-100x-125", { detector: { kind: "camera", pitchUm } }));
    expect(matched.cols).toBe(matched.size);
    expect(Array.from(matched.recorded)).toEqual(Array.from(matched.optical));
  });

  it("puts as many pixels across the frame as the image-plane pitch allows", () => {
    for (const pitchUm of [2.4, 6.5, 13]) {
      const r = render(at("inf-10x-010", { detector: { kind: "camera", pitchUm } }));
      const imageExtentUm = r.objectSpanUm * r.magnification;
      expect(r.cols).toBe(Math.floor(imageExtentUm / pitchUm + 1e-9));
      expect(r.detectorPixelUm).toBeCloseTo(pitchUm / r.magnification, 12);
    }
  });
});

describe("Part S — each part changes the instrument the way its closed form says", () => {
  it("focus: moving the objective off focus by three depths of focus lowers the contrast", () => {
    const sharp = contrast(render(at("inf-10x-010")));
    const soft = contrast(render(at("inf-10x-010", { focusUm: 3 * (LAMBDA_NM * 1e-3) / 0.01 })));
    expect(soft).toBeLessThan(sharp);
  });

  it("a slip under a dry objective refocuses by the plate shift t(1 − 1/n)", () => {
    const t = 0.17;
    const dz = paraxialRefocusMm(scopeSystem(at("inf-10x-010", { slipMm: t })));
    expect(Math.abs(dz - plateFocusShiftMm(t, N_SLIP))).toBeLessThan(1e-7);
  });

  it("an oil objective's thicker slip refocuses by Δt·n_oil/n_slip, and the image comes back", () => {
    const nominal = contrast(render(at("oil-100x-125")));
    const thick = at("oil-100x-125", { slipMm: 0.185 });
    const dz = paraxialRefocusMm(scopeSystem(thick));
    expect(Math.abs(dz + (0.015 * N_OIL) / N_SLIP)).toBeLessThan(1e-7);
    // Unfocused, the picture is nearly gone; refocused, it is back to within 10%
    // of the design slip's — index-matched, so the mismatch was a focus shift.
    expect(contrast(render(thick))).toBeLessThan(0.3 * nominal);
    expect(Math.abs(contrast(render({ ...thick, focusUm: dz * 1e3 })) / nominal - 1)).toBeLessThan(0.1);
  });

  it("an oil slip too thick for the film has no sharp position, and says so rather than failing", () => {
    const r = render(at("oil-100x-125", { slipMm: 0.2 }));
    expect(r.sharpFocusUm).toBeNull();
  });

  it("the tube lens scales the traced magnification as f_tube", () => {
    const design = render(at("inf-10x-010")).magnification;
    for (const f of [100, 300]) {
      const m = render(at("inf-10x-010", { tubeMm: f })).magnification;
      expect(Math.abs(m / design - f / 200)).toBeLessThan(1e-3);
    }
  });

  it("a longer DIN tube, refocused, magnifies by Newton's x′/f to within its thick-lens departure", () => {
    const request = at("din-4x-010", { tubeMm: 200 });
    const dz = paraxialRefocusMm(scopeSystem(request));
    const m = render({ ...request, focusUm: dz * 1e3 }).magnification;
    // x′ = 150 mm at design for a nominal 4×, so f = 37.5 mm; 40 mm more tube is x′ = 190.
    expect(Math.abs(m / (190 / 37.5) - 1)).toBeLessThan(0.01);
  });

  it("caps the condenser at what a dry one can pass, and an oiled one lifts it", () => {
    expect(condenserCap(64, 32, 1.25, "dry")).toBe(0.75);
    expect(condenserCap(64, 32, 1.25, "oiled")).toBe(0.875);
    expect(condenserCap(64, 32, 0.1, "dry")).toBe(0.875);
  });

  it("samples the eye at Curcio's cone spacing, two cones to the 1-arcmin 20/20 line", () => {
    expect(CONE_SPACING_MM * 1e3).toBeCloseTo(2.409, 3);
    const twoConesArcmin = (2 * CONE_ANGLE_RAD * 180 * 60) / Math.PI;
    expect(Math.abs(twoConesArcmin - 1)).toBeLessThan(0.01);
  });
});
