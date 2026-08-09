import { Prescription, SurfaceSpec } from "../trace/prescription";
import { MechPart } from "./path";

/**
 * # The feedback: mechanical changes become optical spacings
 *
 * ARCHITECTURE gives `mech/` one job the other layers do not have — "mechanical
 * changes feed back into optical spacings" — and this is the whole of it. The
 * mech layer does **not** model what glass does to an image. It splices the
 * glass into the prescription as real plane surfaces and lets the sequential
 * tracer find the focus, which is the hard rule ("physics is never faked")
 * applied to a layer that is otherwise a parts list.
 *
 * That matters more than it looks. `glassFocusShiftMm` has a closed form, and it
 * would have been easy to *apply* it — to move the image plane by t(1−1/n) and
 * call the mechanical layer done. The result would have been a chain that shifts
 * focus correctly and carries no spherical aberration and no colour, because
 * neither was put in by hand. Splicing gets all three from one operation, and
 * § 5u pins the closed form against the trace rather than the other way round.
 *
 * ## Where the glass goes
 *
 * All of it, contiguously, at `gapMm` past the last optical surface. The chain's
 * air is not modelled as air surfaces because air is not a surface: what the
 * spacers do is set the total, and the total is the trailing thickness that was
 * already there.
 *
 * Flattening the glass together is exact rather than convenient — see `path.ts`
 * on why a plane plate's effect in a converging beam does not depend on where
 * along the beam it sits — and § 5u pins it by tracing the same glass at two
 * gaps and comparing wavefronts.
 *
 * ## What this does not yet do
 *
 * The inserted surfaces default to an unbounded clear aperture, so a 1.25″
 * diagonal in a 2″ beam does not vignette here. It physically does, and § 2f's
 * machinery is exactly what would catch it — `semiApertureMm` is the hook, and
 * a barrel-limited field is named as open in docs/VALIDATION.md § 5u.
 */

export interface GlassPathOptions {
  /** Last optical surface → the glass's first face (mm along the beam). Default 0. */
  readonly gapMm?: number;
  /**
   * Clear semi-aperture of the inserted faces (mm). Default unbounded, which
   * means the barrel never clips — see the note above.
   */
  readonly semiApertureMm?: number;
  /**
   * The medium the beam is in on either side of the glass. Default "AIR", which
   * is what every mechanical train in both branches actually is.
   */
  readonly emergentMedium?: string;
}

/**
 * Splice a mechanical chain's glass into a prescription as plane surfaces,
 * leaving the image plane exactly where it was.
 *
 * The trailing thickness is *repartitioned*, not extended: the last optical
 * surface's distance to the image is split into the gap, the glass, and what is
 * left. So the image plane does not move and the focus does — which is the
 * honest way round, because it is what happens when you drop a filter into a
 * focused imaging train and the stars go soft.
 *
 * Signs follow the beam. A chain whose trailing thickness is negative is an
 * unfolded prescription in a reversed segment (an odd number of mirrors so far),
 * and every inserted thickness takes the same sign, so a Newtonian and a
 * refractor are one code path.
 */
export function withGlassPath(
  p: Prescription,
  chain: readonly MechPart[],
  options: GlassPathOptions = {},
): Prescription {
  // No wavelength anywhere in this function: placing the glass needs its
  // thickness and its catalog name, never its index. The dispersion arrives
  // when the tracer resolves the medium, which is why the spliced chain carries
  // colour without this layer knowing what colour is.
  const layers: { thicknessMm: number; medium: string }[] = [];
  for (const part of chain) {
    for (const l of part.glass ?? []) {
      layers.push({ thicknessMm: l.thicknessMm, medium: l.medium });
    }
  }
  if (layers.length === 0) return p;

  const surfaces = p.surfaces;
  if (surfaces.length === 0) throw new Error("withGlassPath: the prescription has no surfaces");
  const last = surfaces[surfaces.length - 1]!;

  const gapMm = options.gapMm ?? 0;
  if (!(gapMm >= 0)) throw new Error("withGlassPath: the gap to the glass is a distance along the beam");

  const sign = last.thickness >= 0 ? 1 : -1;
  const available = Math.abs(last.thickness);
  const glassMm = layers.reduce((a, l) => a + l.thicknessMm, 0);
  const remaining = available - gapMm - glassMm;
  // Refused rather than extended. Growing the trailing thickness to make room
  // would move the image plane, and then a rung measuring how far focus moved
  // would be measuring this function's arithmetic instead of the glass.
  if (!(remaining >= 0)) {
    throw new Error(
      `withGlassPath: ${gapMm} mm of gap and ${glassMm} mm of glass do not fit in the ` +
        `${available} mm from the last surface to the image plane`,
    );
  }

  const semiAperture = options.semiApertureMm ?? Infinity;
  const emergent = options.emergentMedium ?? "AIR";
  const plane = (medium: string, thicknessMm: number): SurfaceSpec => ({
    kind: "refract",
    curvature: 0,
    semiAperture,
    thickness: sign * thicknessMm,
    medium,
  });

  const spliced: SurfaceSpec[] = [
    ...surfaces.slice(0, -1),
    { ...last, thickness: sign * gapMm },
    ...layers.map((l) => plane(l.medium, l.thicknessMm)),
    plane(emergent, remaining),
  ];
  return { ...p, surfaces: spliced };
}
