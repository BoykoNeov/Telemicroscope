import { LINE_D } from "@telemicroscope/core/materials";
import { aimRay, imagePlaneZ, pupilFan, pupils } from "@telemicroscope/core/pupil";
import { asCompiled, traceRay, type OpticalSystem } from "@telemicroscope/core/trace";

/**
 * The layout drawing's numbers — a meridional section of an `OpticalSystem`,
 * with rays through it — for the bench editor and anything else that composes
 * a surface list and wants to see what it wrote.
 *
 * `render.ts`'s commitment holds: numbers in, numbers out, no DOM and no React.
 * `drawing.tsx` turns these into pixels and is the only file that knows what a
 * canvas is. And **no engine capability** — every call here is `traceRay`,
 * `aimRay` and the surface geometry's own `sag`, which have been in `core`
 * since step 1. What did not exist was a picture of the prescription itself:
 * every other picture in this app is of the *image* a design forms, and the
 * bench editor showed the surface list as a table of numbers and nothing else,
 * so a reader composing a lens had no way to see that the thickness they
 * typed put a vertex inside the element before it, or which surface a ray was
 * lost at, except by reading the vertex-z column and imagining.
 *
 * ## What is drawn, and what is honest about it
 *
 * The x–z plane, z to the right. Every surface is its own sag curve sampled
 * across its clear semi-aperture — a plane is a line, a sphere a circular arc,
 * a paraboloid the parabola `r²/2R` exactly — so the profile IS the geometry
 * the tracer intersects, not a symbol for it. A glass gap is the polygon
 * between the two profiles that bound it. The rays are `traceRay`'s own hit
 * points joined by straight lines, extended to the image plane after the last
 * surface; between hits a ray *is* straight, so the polyline is the trace and
 * not an illustration of one.
 *
 * Two things a reader should know are NOT physics in the picture:
 *
 * - An unbounded semi-aperture (`Infinity`) has no rim to draw to, so it is
 *   drawn to the largest finite one in the list and flagged `unbounded`. The
 *   tracer treats it as infinite; the picture cannot.
 * - A Cassegrain's primary has no hole in this engine — "an obstruction the
 *   trace never sees", as the reflector panel's blurb says — so the returning
 *   rays are drawn passing through the primary's profile to the focus behind
 *   it, because that is what the trace does.
 *
 * ## The frame
 *
 * The drawing spans the vertices and the image plane, with a margin on the
 * object side for rays to arrive across. A finite-conjugate object is shown
 * only when it sits within one system-length of the first vertex: the DIN
 * objective's specimen (45 mm in front of a 170 mm chain) is in the picture,
 * § 6ar's triplet's (453 mm in front of 57 mm of optics) is not, and the
 * readout says which so the caption can. Rays are cut at the frame's edge,
 * not re-aimed — the trace is the same either way.
 */

/** A point in the section: `[z, x]` in mm — z along the axis, x the height. */
export type SectionPoint = readonly [zMm: number, xMm: number];

export interface LayoutSurface {
  readonly index: number;
  readonly kind: "refract" | "reflect";
  readonly vertexZMm: number;
  /** 1/curvature, `Infinity` for a plane — so a caller with no table can still say what a surface is. */
  readonly radiusMm: number;
  /** The height the profile is drawn to. Finite even when the spec is not. */
  readonly semiApertureMm: number;
  /** True when the spec says `Infinity` and the height above is borrowed. */
  readonly unbounded: boolean;
  readonly isStop: boolean;
  /** Medium after the surface, or `null` on a mirror (which keeps the incident one). */
  readonly mediumAfter: string | null;
  /** The sag curve, `[z, x]` from −semi to +semi. Points past a hemisphere are dropped. */
  readonly profile: readonly SectionPoint[];
}

/**
 * A gap that is not air: the polygon between two profiles that a reader
 * should see as a piece of glass. `from: -1` is the object space (an immersion
 * medium, from the frame's left edge to surface 0); `to: surfaces.length` runs
 * to the image plane.
 */
export interface LayoutBody {
  readonly from: number;
  readonly to: number;
  readonly medium: string;
}

export interface LayoutRay {
  /** Index into `fields`. */
  readonly field: number;
  /** Normalized pupil coordinate along the fan: −1 at one rim, +1 at the other. */
  readonly pupil: number;
  /** `[z, x]` from the frame's left edge, through every hit, to the image plane. */
  readonly points: readonly SectionPoint[];
  /** The surface the ray did not get past, or `null` when it reached the image. */
  readonly lostAt: number | null;
}

export interface LayoutReadout {
  readonly surfaces: readonly LayoutSurface[];
  readonly bodies: readonly LayoutBody[];
  readonly rays: readonly LayoutRay[];
  /** The field values the fans were aimed at, in the order `LayoutRay.field` indexes. */
  readonly fields: readonly number[];
  /** Why there are no rays, when there are none — the engine's own sentence. */
  readonly raysRefusal: string | null;
  readonly imagePlaneZMm: number;
  /** Where the rays are drawn from. The object point when `objectShown`. */
  readonly startZMm: number;
  readonly objectShown: boolean;
  /** Object z for a finite conjugate; `null` at infinity. */
  readonly objectZMm: number | null;
  /** The section's extent, padded for the canvas: `[zMin, zMax]` and `[xMin, xMax]`. */
  readonly zRangeMm: readonly [number, number];
  readonly xRangeMm: readonly [number, number];
  readonly lost: number;
  readonly traced: number;
  readonly wavelengthNm: number;
  readonly elapsedMs: number;
}

export interface LayoutOptions {
  /** Field values to fan, in the conjugate's own spelling. Default `[0]`. */
  readonly fields?: readonly number[];
  /** Rays across the pupil diameter per field. Default 7; odd keeps the chief ray. */
  readonly raysAcross?: number;
  readonly wavelengthNm?: number;
}

/** Samples per profile — enough that a 25 mm f/2 arc reads as an arc. */
const PROFILE_SAMPLES = 41;

/** Fraction of the system's length left in front of the first vertex for rays to arrive across. */
const OBJECT_MARGIN = 0.2;

/** Padding around the section, as a fraction of each extent. */
const PAD_FRACTION = 0.08;

/**
 * A finite object is in the picture when it is at most this many system
 * lengths in front — beyond that the optics would be a sliver at the right edge.
 */
const OBJECT_SHOWN_WITHIN = 1;

export function describeLayout(system: OpticalSystem, options: LayoutOptions = {}): LayoutReadout {
  const started = performance.now();
  const fields = options.fields ?? [0];
  const raysAcross = Math.max(1, Math.round(options.raysAcross ?? 7));
  const wavelengthNm = options.wavelengthNm ?? LINE_D;

  const compiled = asCompiled(system.prescription);
  const imagePlaneZMm = imagePlaneZ(compiled, system);

  // The height an unbounded rim borrows: the largest finite one in the list,
  // failing that the stop the aperture resolves to, failing that ten millimetres.
  const finiteRims = compiled.surfaces.map((s) => s.semiAperture).filter((a) => Number.isFinite(a) && a > 0);
  let borrowed = finiteRims.length > 0 ? Math.max(...finiteRims) : NaN;
  if (!Number.isFinite(borrowed)) {
    try {
      borrowed = pupils(system, wavelengthNm).stopRadius;
    } catch {
      borrowed = 10;
    }
  }
  if (!Number.isFinite(borrowed) || borrowed <= 0) borrowed = 10;

  const surfaces = compiled.surfaces.map((s, index): LayoutSurface => {
    const unbounded = !Number.isFinite(s.semiAperture);
    const semiApertureMm = unbounded ? borrowed : s.semiAperture;
    const profile: SectionPoint[] = [];
    for (let i = 0; i < PROFILE_SAMPLES; i++) {
      const x = -semiApertureMm + (2 * semiApertureMm * i) / (PROFILE_SAMPLES - 1);
      const sag = s.geometry.sag(x * x);
      if (Number.isFinite(sag)) profile.push([s.vertexZ + sag, x]);
    }
    return {
      index,
      kind: s.kind,
      vertexZMm: s.vertexZ,
      radiusMm: s.geometry.curvature === 0 ? Infinity : 1 / s.geometry.curvature,
      semiApertureMm,
      unbounded,
      isStop: s.isStop,
      mediumAfter: s.mediumAfter?.name ?? null,
      profile,
    };
  });

  const bodies: LayoutBody[] = [];
  if (compiled.objectMedium.name !== "AIR") bodies.push({ from: -1, to: 0, medium: compiled.objectMedium.name });
  compiled.surfaces.forEach((s, i) => {
    if (s.kind === "refract" && s.mediumAfter && s.mediumAfter.name !== "AIR") {
      bodies.push({ from: i, to: i + 1, medium: s.mediumAfter.name });
    }
  });

  const vertexZs = surfaces.map((s) => s.vertexZMm);
  const zLo = Math.min(...vertexZs, imagePlaneZMm);
  const zHi = Math.max(...vertexZs, imagePlaneZMm);
  const span = Math.max(zHi - zLo, 1e-6);

  const objectZMm = system.conjugate.kind === "finite" ? -system.conjugate.distance : null;
  const objectShown = objectZMm !== null && zLo - objectZMm <= OBJECT_SHOWN_WITHIN * span;
  const startZMm = objectShown ? objectZMm! : zLo - OBJECT_MARGIN * span;

  const rays: LayoutRay[] = [];
  let raysRefusal: string | null = null;
  let lost = 0;
  let traced = 0;
  try {
    const pupil = pupils(system, wavelengthNm);
    const fan = pupilFan(raysAcross, "x");
    fields.forEach((fieldValue, field) => {
      for (const point of fan) {
        const launch = aimRay(system, pupil, fieldValue, point, wavelengthNm);
        const result = traceRay(system.prescription, launch);
        traced++;
        const points: SectionPoint[] = [];

        // From the frame's edge: the launch ray is a straight line in object
        // space, so it can be walked back (or cut) to `startZMm` freely — unless
        // that would put the start past the first hit, which a deeply curved
        // first surface in a tiny system could do, in which case the origin is
        // the honest start.
        const first = result.path[0];
        const t = (startZMm - launch.origin.z) / launch.dir.z;
        const atEdge = Number.isFinite(t)
          ? { x: launch.origin.x + t * launch.dir.x, z: startZMm }
          : { x: launch.origin.x, z: launch.origin.z };
        if (first !== undefined && atEdge.z >= first.z) points.push([launch.origin.z, launch.origin.x]);
        else points.push([atEdge.z, atEdge.x]);

        for (const hit of result.path) points.push([hit.z, hit.x]);

        if (result.status === "ok" && result.ray) {
          const exit = result.ray;
          const tImage = (imagePlaneZMm - exit.origin.z) / exit.dir.z;
          if (Number.isFinite(tImage) && tImage >= 0) {
            points.push([imagePlaneZMm, exit.origin.x + tImage * exit.dir.x]);
          } else {
            // Leaving away from the image plane, or along it: show the direction.
            const reach = OBJECT_MARGIN * span;
            points.push([exit.origin.z + reach * exit.dir.z, exit.origin.x + reach * exit.dir.x]);
          }
          rays.push({ field, pupil: point.px, points, lostAt: null });
        } else {
          lost++;
          rays.push({ field, pupil: point.px, points, lostAt: result.failedAt ?? null });
        }
      }
    });
  } catch (cause) {
    raysRefusal = (cause as Error).message;
  }

  // Extents: everything drawn, padded. The x range is symmetric about the axis
  // so the axis sits mid-canvas, which is where a reader looks for it.
  let xMax = 0;
  for (const s of surfaces) xMax = Math.max(xMax, s.semiApertureMm);
  for (const r of rays) for (const [, x] of r.points) if (Number.isFinite(x)) xMax = Math.max(xMax, Math.abs(x));
  if (!(xMax > 0)) xMax = 1;
  let zMin = Math.min(startZMm, zLo);
  let zMax = zHi;
  for (const s of surfaces) for (const [z] of s.profile) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  for (const r of rays) for (const [z] of r.points) if (Number.isFinite(z)) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const zPad = PAD_FRACTION * Math.max(zMax - zMin, 1e-6);
  const xPad = PAD_FRACTION * xMax;

  return {
    surfaces,
    bodies,
    rays,
    fields,
    raysRefusal,
    imagePlaneZMm,
    startZMm,
    objectShown,
    objectZMm,
    zRangeMm: [zMin - zPad, zMax + zPad],
    xRangeMm: [-(xMax + xPad), xMax + xPad],
    lost,
    traced,
    wavelengthNm,
    elapsedMs: performance.now() - started,
  };
}

/**
 * How the section maps onto a box of pixels — pure, so the choice is testable.
 *
 * A telescope objective is a 50 mm disc at the end of 500 mm of air, and drawn
 * at true scale in a 640 px box it is a line 6 px tall. So the default *fits*
 * each axis to the box independently, which stretches heights relative to
 * lengths, and the caption prints the factor: the lens looks fatter than it is
 * and the reader is told by how much. The stretch is capped so that a fast
 * microscope objective, which fits at true scale anyway, is never inflated
 * into a caricature, and `trueScale` turns it off entirely — one scale for
 * both axes, the picture centred, an arc drawn as the circle it is.
 */
export interface LayoutFit {
  /** Pixels per mm along the axis. */
  readonly zScale: number;
  /** Pixels per mm of height. */
  readonly xScale: number;
  /** `xScale / zScale` — 1 at true scale. */
  readonly exaggeration: number;
  /** Canvas x of z = 0 and canvas y of x = 0. */
  readonly zOrigin: number;
  readonly xOrigin: number;
}

export const MAX_EXAGGERATION = 6;

export function fitLayout(
  layout: Pick<LayoutReadout, "zRangeMm" | "xRangeMm">,
  boxWidth: number,
  boxHeight: number,
  trueScale: boolean,
): LayoutFit {
  const [z0, z1] = layout.zRangeMm;
  const [x0, x1] = layout.xRangeMm;
  const zFit = boxWidth / Math.max(z1 - z0, 1e-9);
  const xFit = boxHeight / Math.max(x1 - x0, 1e-9);
  let zScale: number;
  let xScale: number;
  if (trueScale) {
    zScale = xScale = Math.min(zFit, xFit);
  } else {
    zScale = zFit;
    // Never shrink heights below the axis scale, and never inflate them past the cap.
    xScale = Math.min(xFit, zFit * MAX_EXAGGERATION);
    if (xScale < zFit) zScale = xScale;
  }
  // Centre whatever slack is left on each axis.
  const zOrigin = (boxWidth - (z1 - z0) * zScale) / 2 - z0 * zScale;
  const xOrigin = (boxHeight - (x1 - x0) * xScale) / 2 + x1 * xScale;
  return { zScale, xScale, exaggeration: xScale / zScale, zOrigin, xOrigin };
}

/**
 * A row per label so that labels closer than `minGap` pixels stack instead of
 * over-printing: sorted by x, each label sits one row above the last label it
 * would collide with. Returns the row for each input, in input order.
 */
export function staggered(xs: readonly number[], minGap: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const rows = new Array<number>(xs.length).fill(0);
  const placed: { x: number; row: number }[] = [];
  for (const { x, i } of order) {
    let row = 0;
    while (placed.some((p) => Math.abs(p.x - x) < minGap && p.row === row)) row++;
    rows[i] = row;
    placed.push({ x, row });
  }
  return rows;
}
