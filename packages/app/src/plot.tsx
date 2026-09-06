import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveColor, useThemeVersion } from "./theme";

/**
 * A minimal axes-and-lines canvas — APP.md's structural item 5.
 *
 * Roughly half the microscope surfaces are curves and the app had no plotting
 * at all, so this is the smallest thing that can draw one honestly: linear axes,
 * nice ticks, polylines, and straight-line markers for "you are here". No
 * dependency, no interaction, no tooltips. The no-dependency posture is the
 * point — a chart library would arrive with its own opinions about smoothing,
 * and a smoothed curve through measured points is a drawing of a claim rather
 * than the claim.
 *
 * Points are drawn as given. Nothing is interpolated, resampled or fitted.
 */

export interface PlotSeries {
  readonly label: string;
  readonly color: string;
  readonly points: readonly (readonly [number, number])[];
  /** Canvas dash pattern; omit for solid. */
  readonly dash?: readonly number[];
  readonly width?: number;
  /** Draw a dot at each sample — for the series that IS the measurement. */
  readonly dots?: boolean;
}

/** A vertical or horizontal rule: "the slider is here", "the object is here". */
export interface PlotMarker {
  readonly x?: number;
  readonly y?: number;
  readonly color: string;
  readonly label?: string;
}

export interface PlotProps {
  readonly series: readonly PlotSeries[];
  readonly markers?: readonly PlotMarker[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { left: 46, right: 12, top: 12, bottom: 34 };
/** Narrower than this and the tick labels collide; below it the canvas scales instead. */
const MIN_WIDTH = 280;

/** 1, 2, 2.5 or 5 × 10ⁿ — the step a reader can do arithmetic on. */
function niceStep(span: number, target: number): number {
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function ticks(min: number, max: number, target = 5): number[] {
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    // Kill the 0.30000000000000004 the accumulation leaves behind.
    out.push(Number(t.toFixed(10)));
  }
  return out;
}

function PlotCanvas(props: PlotProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const requested = props.width ?? 420;
  const height = props.height ?? 280;
  // The requested width is a ceiling — UI-PLAN step 6. The canvas takes the
  // column (`width: 100%`) up to that ceiling (`maxWidth: requested`), so what
  // it actually gets is read back off the element and the plot is drawn at THAT
  // size rather than scaled into it. Clamped at `MIN_WIDTH` so a very narrow
  // column scales the picture instead of making the axes unreadable. The
  // percentage is on `width`, not `maxWidth`: a replaced element's percentage
  // WIDTH contributes nothing to its container's minimum size, but a percentage
  // max-width over a fixed width is honoured in a direct flex item and ignored
  // one nesting deeper (Chrome, `panels/volume.tsx`'s rows), where the fixed
  // width became the floor and the page scrolled sideways.
  const [available, setAvailable] = useState(requested);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const w = element.getBoundingClientRect().width;
      if (w > 0) setAvailable(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(MIN_WIDTH, Math.min(requested, Math.floor(available)));
  // A canvas cannot read a CSS variable, so the theme is a dependency of the
  // draw: switching palettes redraws the axes in the new greys (see `theme.ts`).
  const theme = useThemeVersion();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    const c = element.getContext("2d");
    if (!c) return;
    const paint = (color: string) => resolveColor(element, color);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    c.font = `11px ${getComputedStyle(element).getPropertyValue("--mono").trim() || "monospace"}`;
    c.textBaseline = "middle";

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + ((x - props.xMin) / (props.xMax - props.xMin)) * plotW;
    const sy = (y: number) => PAD.top + plotH - ((y - props.yMin) / (props.yMax - props.yMin)) * plotH;

    // Grid and ticks first, so every line sits on top of them.
    c.strokeStyle = paint("var(--line-2)");
    c.fillStyle = paint("var(--ink-4)");
    c.lineWidth = 1;
    c.textAlign = "right";
    for (const t of ticks(props.yMin, props.yMax)) {
      const y = Math.round(sy(t)) + 0.5;
      c.beginPath();
      c.moveTo(PAD.left, y);
      c.lineTo(PAD.left + plotW, y);
      c.stroke();
      c.fillText(String(t), PAD.left - 6, y);
    }
    c.textAlign = "center";
    for (const t of ticks(props.xMin, props.xMax)) {
      const x = Math.round(sx(t)) + 0.5;
      c.beginPath();
      c.moveTo(x, PAD.top);
      c.lineTo(x, PAD.top + plotH);
      c.stroke();
      c.fillText(String(t), x, PAD.top + plotH + 12);
    }

    c.strokeStyle = paint("var(--ink-5)");
    c.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW, plotH);

    c.fillStyle = paint("var(--ink-2)");
    c.fillText(props.xLabel, PAD.left + plotW / 2, height - 8);
    c.save();
    c.translate(11, PAD.top + plotH / 2);
    c.rotate(-Math.PI / 2);
    c.fillText(props.yLabel, 0, 0);
    c.restore();

    // Markers under the data: they say where to look, they are not the data.
    for (const m of props.markers ?? []) {
      c.save();
      c.strokeStyle = paint(m.color);
      c.setLineDash([3, 3]);
      c.lineWidth = 1;
      c.beginPath();
      if (m.x !== undefined) {
        const x = Math.round(sx(m.x)) + 0.5;
        c.moveTo(x, PAD.top);
        c.lineTo(x, PAD.top + plotH);
      }
      if (m.y !== undefined) {
        const y = Math.round(sy(m.y)) + 0.5;
        c.moveTo(PAD.left, y);
        c.lineTo(PAD.left + plotW, y);
      }
      c.stroke();
      if (m.label) {
        c.fillStyle = paint(m.color);
        c.setLineDash([]);
        if (m.x !== undefined) {
          c.textAlign = "left";
          c.fillText(m.label, Math.min(sx(m.x) + 4, PAD.left + plotW - 40), PAD.top + 8);
        } else if (m.y !== undefined) {
          c.textAlign = "right";
          c.fillText(m.label, PAD.left + plotW - 4, sy(m.y) - 8);
        }
      }
      c.restore();
    }

    c.save();
    c.beginPath();
    c.rect(PAD.left, PAD.top, plotW, plotH);
    c.clip();
    for (const s of props.series) {
      if (s.points.length === 0) continue;
      c.strokeStyle = paint(s.color);
      c.lineWidth = s.width ?? 1.6;
      c.setLineDash(s.dash ? [...s.dash] : []);
      c.beginPath();
      s.points.forEach(([x, y], i) => {
        if (i === 0) c.moveTo(sx(x), sy(y));
        else c.lineTo(sx(x), sy(y));
      });
      c.stroke();
      if (s.dots) {
        c.fillStyle = paint(s.color);
        c.setLineDash([]);
        for (const [x, y] of s.points) {
          c.beginPath();
          c.arc(sx(x), sy(y), 2, 0, 2 * Math.PI);
          c.fill();
        }
      }
    }
    c.restore();
  }, [props, width, height, theme]);

  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={canvas} style={{ width: "100%", maxWidth: requested, height }} />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.7 }}>
        {/* Each entry is an inline-block, not a nowrap span: it still moves to the
            next line as a unit when it fits there, but a label longer than the
            column wraps inside itself instead of holding the figure open (a nowrap
            label is a hard floor under the width the canvas can shrink to). */}
        {props.series.map((s) => (
          <span key={s.label} style={{ marginRight: 12, display: "inline-block" }}>
            <span
              style={{
                display: "inline-block",
                width: 14,
                borderTop: `${s.dash ? "2px dashed" : "2px solid"} ${s.color}`,
                verticalAlign: "middle",
                marginRight: 4,
              }}
            />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Memoized on a shallow compare of `props` — UI-PLAN step 1.
 *
 * The draw is an effect keyed on the whole `props` object, and JSX builds a
 * fresh one every render, so without this every render of a panel repainted
 * every plot on it. Shallow compare only pays once the caller stops rebuilding
 * `series` and `markers` inline, which is the other half of the step: a panel
 * that hands over a fresh array each render defeats this by construction.
 */
export const Plot = memo(PlotCanvas);
