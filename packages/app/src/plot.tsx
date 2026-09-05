import { useEffect, useRef } from "react";
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

export function Plot(props: PlotProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = props.width ?? 420;
  const height = props.height ?? 280;
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
      <canvas ref={canvas} style={{ width, height }} />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.7 }}>
        {props.series.map((s) => (
          <span key={s.label} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
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
