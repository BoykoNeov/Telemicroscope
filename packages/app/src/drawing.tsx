import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitLayout, staggered, type LayoutReadout } from "./layout";
import { resolveColor, useThemeVersion } from "./theme";

/**
 * The section drawing — `layout.ts`'s numbers as a picture.
 *
 * The same posture as `plot.tsx`: a canvas, no dependency, nothing smoothed.
 * Each profile is the sampled sag joined by straight segments and each ray is
 * its hit points joined by straight segments, which between surfaces is what a
 * ray is. Colours are tokens resolved through `theme.ts`, so the drawing is UI
 * and follows the theme — it is a diagram of the prescription, not an image
 * plane, which is why it is not on black like the raster pictures.
 *
 * What is on it, and why each thing is drawn the way it is:
 *
 * - **Glass** is a filled polygon between two profiles, tinted through
 *   `globalAlpha` rather than a translucent literal so the tint is a theme
 *   token. Immersion media take a second tint, so a reader can tell oil from
 *   crown at a glance without reading the table.
 * - **A mirror** is a heavier stroke with a short hatched back, the drafting
 *   convention, so the two Cassegrain surfaces cannot be mistaken for two
 *   refracting planes.
 * - **The stop** is two bars outside the rim of the flagged surface. It sits ON
 *   a surface in this schema (`stopIndex` is a surface index), so that is where
 *   it is drawn.
 * - **Rays** in the on-axis fan are blue and the off-axis fan red — the plot
 *   palette's two series colours, so a reader who has met them on the ray-fan
 *   panel meets them here. A ray the tracer lost is drawn in the warn colour
 *   as far as it got, and ends in a small cross at the last surface it reached,
 *   which is where a reader composing a lens wants to look.
 * - **The image plane** is a labelled vertical, and callers may add `marks`
 *   (best focus, the paraxial focus) as dashed ones.
 * - **A scale bar** says what a millimetre is along the axis, and beside it the
 *   vertical exaggeration when there is one. Without that line the fitted
 *   picture would be quietly lying about the shape of every lens in it.
 *
 * The width follows the container — the first canvas in the app to do so,
 * ahead of UI-PLAN step 6 — clamped so a narrow window gets a narrower drawing
 * rather than a sideways scroll.
 *
 * Hover reports the nearest surface, so the panel can light the matching table
 * row, and `highlight` draws the row the pointer is on in the accent colour.
 * That pairing is the composition aid this file exists for: the drawing and the
 * table are two views of one list, and pointing at either should find the
 * other.
 */

export interface LayoutMark {
  readonly zMm: number;
  readonly label: string;
  readonly color: string;
}

export interface LayoutCanvasProps {
  readonly layout: LayoutReadout;
  readonly marks?: readonly LayoutMark[];
  readonly trueScale?: boolean;
  readonly height?: number;
  /** Surface index to draw in the accent colour, or `null`. */
  readonly highlight?: number | null;
  readonly onHover?: (index: number | null) => void;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 760;
const DEFAULT_HEIGHT = 260;
const PAD = { left: 10, right: 10, top: 14, bottom: 26 };

/** Pixels within which a pointer counts as "on" a surface's vertex. */
const HOVER_PX = 9;

const FIELD_COLORS = ["var(--blue)", "var(--red)", "var(--green)", "var(--purple)"] as const;

/** Media that are fluids, tinted differently from glass. */
const IMMERSION = new Set(["WATER", "IMMERSION-OIL", "VITREOUS"]);

/** 1, 2, 5 × 10ⁿ, at most `target` mm — the length a scale bar reads well at. */
function barLength(spanMm: number): number {
  const target = spanMm / 5;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

function LayoutCanvasInner(props: LayoutCanvasProps) {
  const figure = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const height = props.height ?? DEFAULT_HEIGHT;
  const [width, setWidth] = useState(MAX_WIDTH);

  useLayoutEffect(() => {
    const element = figure.current;
    if (!element) return;
    const measure = () => {
      const w = element.clientWidth;
      if (w > 0) setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(w))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { layout, marks, trueScale, highlight } = props;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    const c = element.getContext("2d");
    if (!c) return;
    const paint = (color: string) => resolveColor(element, color);
    const mono = getComputedStyle(element).getPropertyValue("--mono").trim() || "monospace";
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    c.font = `10px ${mono}`;
    c.textBaseline = "middle";

    const boxW = width - PAD.left - PAD.right;
    const boxH = height - PAD.top - PAD.bottom;
    const fit = fitLayout(layout, boxW, boxH, trueScale === true);
    const sz = (z: number) => PAD.left + fit.zOrigin + z * fit.zScale;
    const sx = (x: number) => PAD.top + fit.xOrigin - x * fit.xScale;
    const leftEdge = layout.zRangeMm[0];

    const surfaces = layout.surfaces;
    const n = surfaces.length;

    /** A surface's profile as canvas points, or a vertical line at a frame edge. */
    const edge = (index: number): readonly (readonly [number, number])[] => {
      if (index < 0) return [[leftEdge, layout.xRangeMm[0]], [leftEdge, layout.xRangeMm[1]]];
      if (index >= n) return [[layout.imagePlaneZMm, layout.xRangeMm[0]], [layout.imagePlaneZMm, layout.xRangeMm[1]]];
      return surfaces[index]!.profile;
    };

    // Glass first, under everything.
    for (const body of layout.bodies) {
      const a = edge(body.from);
      const b = edge(body.to);
      if (a.length < 2 || b.length < 2) continue;
      c.save();
      c.globalAlpha = 0.16;
      c.fillStyle = paint(IMMERSION.has(body.medium) ? "var(--green)" : "var(--blue)");
      c.beginPath();
      a.forEach(([z, x], i) => (i === 0 ? c.moveTo(sz(z), sx(x)) : c.lineTo(sz(z), sx(x))));
      for (let i = b.length - 1; i >= 0; i--) c.lineTo(sz(b[i]![0]), sx(b[i]![1]));
      c.closePath();
      c.fill();
      c.restore();
    }

    // The axis.
    c.save();
    c.strokeStyle = paint("var(--line)");
    c.setLineDash([4, 4]);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(PAD.left, Math.round(sx(0)) + 0.5);
    c.lineTo(width - PAD.right, Math.round(sx(0)) + 0.5);
    c.stroke();
    c.restore();

    // Rays under the surfaces, so a profile reads on top of the light crossing it.
    for (const ray of layout.rays) {
      if (ray.points.length < 2) continue;
      const color = ray.lostAt === null ? FIELD_COLORS[ray.field % FIELD_COLORS.length]! : "var(--warn)";
      c.save();
      c.strokeStyle = paint(color);
      c.globalAlpha = ray.lostAt === null ? 0.85 : 0.9;
      c.lineWidth = 1;
      c.beginPath();
      ray.points.forEach(([z, x], i) => (i === 0 ? c.moveTo(sz(z), sx(x)) : c.lineTo(sz(z), sx(x))));
      c.stroke();
      if (ray.lostAt !== null) {
        const [z, x] = ray.points[ray.points.length - 1]!;
        const px = sz(z);
        const py = sx(x);
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(px - 3, py - 3);
        c.lineTo(px + 3, py + 3);
        c.moveTo(px - 3, py + 3);
        c.lineTo(px + 3, py - 3);
        c.stroke();
      }
      c.restore();
    }

    // Index labels: three surfaces in 4.5 mm on a 600 mm axis land on one
    // pixel, so labels that would overlap step upward instead of over-printing.
    const indexRow = staggered(
      surfaces.map((s) => sz(s.vertexZMm)),
      14,
    );

    // The surfaces.
    for (const s of surfaces) {
      if (s.profile.length < 2) continue;
      const lit = highlight === s.index;
      c.save();
      c.strokeStyle = paint(lit ? "var(--accent)" : s.kind === "reflect" ? "var(--ink-2)" : "var(--ink)");
      c.lineWidth = s.kind === "reflect" ? (lit ? 3.5 : 2.5) : lit ? 2.5 : 1.4;
      c.lineJoin = "round";
      c.beginPath();
      s.profile.forEach(([z, x], i) => (i === 0 ? c.moveTo(sz(z), sx(x)) : c.lineTo(sz(z), sx(x))));
      c.stroke();

      if (s.kind === "reflect") {
        // Hatch the back: light arrives from −z, so the back is at +z... unless
        // the chain is already returning. The hatch goes on the side the profile
        // bulges away from, read off the sag at the rim, which is the back for
        // a concave primary and a convex secondary alike.
        const rim = s.profile[s.profile.length - 1]!;
        const back = rim[0] >= s.vertexZMm ? -1 : 1;
        c.globalAlpha = 0.6;
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i < s.profile.length; i += 4) {
          const [z, x] = s.profile[i]!;
          c.moveTo(sz(z), sx(x));
          c.lineTo(sz(z) - back * 5, sx(x) + 4);
        }
        c.stroke();
      }

      if (s.isStop) {
        c.strokeStyle = paint("var(--ink)");
        c.lineWidth = 3;
        c.beginPath();
        const zPx = Math.round(sz(s.vertexZMm)) + 0.5;
        const top = sx(s.semiApertureMm);
        const bottom = sx(-s.semiApertureMm);
        c.moveTo(zPx, top);
        c.lineTo(zPx, Math.max(PAD.top, top - 10));
        c.moveTo(zPx, bottom);
        c.lineTo(zPx, Math.min(height - PAD.bottom, bottom + 10));
        c.stroke();
      }

      // Index above the rim, in the accent when lit so the pair reads as one.
      c.fillStyle = paint(lit ? "var(--accent)" : "var(--ink-4)");
      c.textAlign = "center";
      const labelY = Math.max(PAD.top - 6, sx(s.semiApertureMm) - 8) - 10 * indexRow[s.index]!;
      c.fillText(String(s.index), sz(s.vertexZMm), labelY);
      c.restore();
    }

    // The image plane and any marks. Their labels stagger for the same reason
    // the indices do: best focus, the paraxial focus and the image plane are
    // usually within a few pixels of each other, which is the panel's point.
    const verticals = [
      { zMm: layout.imagePlaneZMm, label: "image", color: "var(--ink-3)", dash: [] as readonly number[] },
      ...(marks ?? []).map((m) => ({ zMm: m.zMm, label: m.label, color: m.color, dash: [3, 3] as readonly number[] })),
    ];
    const verticalRow = staggered(
      verticals.map((v) => sz(v.zMm)),
      70,
    );
    verticals.forEach((v, i) => {
      c.save();
      c.strokeStyle = paint(v.color);
      c.fillStyle = paint(v.color);
      c.setLineDash([...v.dash]);
      c.lineWidth = 1;
      const zPx = Math.round(sz(v.zMm)) + 0.5;
      c.beginPath();
      c.moveTo(zPx, PAD.top);
      c.lineTo(zPx, height - PAD.bottom);
      c.stroke();
      c.setLineDash([]);
      const flip = zPx > width - 70;
      c.textAlign = flip ? "right" : "left";
      c.fillText(v.label, zPx + (flip ? -4 : 4), height - PAD.bottom - 7 - 12 * verticalRow[i]!);
      c.restore();
    });

    if (layout.objectShown && layout.objectZMm !== null) {
      c.save();
      c.fillStyle = paint("var(--ink-3)");
      c.textAlign = "left";
      c.fillText("object", sz(layout.objectZMm) + 4, PAD.top + 2);
      c.restore();
    }

    // Scale bar, bottom left; the exaggeration beside it.
    const spanMm = layout.zRangeMm[1] - layout.zRangeMm[0];
    const bar = barLength(spanMm);
    const barPx = bar * fit.zScale;
    c.save();
    c.strokeStyle = paint("var(--ink-3)");
    c.fillStyle = paint("var(--ink-3)");
    c.lineWidth = 1;
    const y = height - 9.5;
    c.beginPath();
    c.moveTo(PAD.left + 0.5, y);
    c.lineTo(PAD.left + 0.5 + barPx, y);
    c.moveTo(PAD.left + 0.5, y - 3);
    c.lineTo(PAD.left + 0.5, y + 3);
    c.moveTo(PAD.left + 0.5 + barPx, y - 3);
    c.lineTo(PAD.left + 0.5 + barPx, y + 3);
    c.stroke();
    c.textAlign = "left";
    const barLabel = bar >= 1 ? `${bar} mm` : `${bar * 1000} µm`;
    const scaleNote =
      Math.abs(fit.exaggeration - 1) < 1e-6
        ? `${barLabel} · true scale`
        : `${barLabel} along the axis · heights ×${fit.exaggeration.toFixed(1)}`;
    c.fillText(scaleNote, PAD.left + barPx + 8, y);
    c.restore();
  }, [layout, marks, trueScale, highlight, width, height, theme]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!props.onHover) return;
    const element = canvas.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const boxW = width - PAD.left - PAD.right;
    const boxH = height - PAD.top - PAD.bottom;
    const fit = fitLayout(layout, boxW, boxH, trueScale === true);
    let best: number | null = null;
    let bestDistance = HOVER_PX;
    for (const s of layout.surfaces) {
      const d = Math.abs(PAD.left + fit.zOrigin + s.vertexZMm * fit.zScale - px);
      if (d < bestDistance) {
        bestDistance = d;
        best = s.index;
      }
    }
    props.onHover(best);
  };

  return (
    <figure ref={figure} style={{ margin: 0, maxWidth: MAX_WIDTH }}>
      <canvas
        ref={canvas}
        style={{ width, height, display: "block", cursor: props.onHover ? "crosshair" : "default" }}
        onMouseMove={onMove}
        onMouseLeave={() => props.onHover?.(null)}
      />
    </figure>
  );
}

/** Memoized like `Plot`: the draw is an effect over these props and nothing else. */
export const LayoutCanvas = memo(LayoutCanvasInner);
