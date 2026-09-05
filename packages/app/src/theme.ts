import { useSyncExternalStore } from "react";

/**
 * The theme: which of the three states `styles.css` knows the page is in, and
 * the one helper canvas code needs because a `strokeStyle` cannot read a CSS
 * variable.
 *
 * "system" is the absence of a choice — nothing on `<html>`, and the stylesheet's
 * `prefers-color-scheme` block decides. The two explicit states are stamped as
 * `data-theme` and remembered in `localStorage`, so a reader who picked dark
 * gets dark on the next reload. Every read of storage is guarded: a private
 * window, or a browser told to block site data, throws on the accessor itself,
 * and the page must still render with the system default.
 */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "telemicroscope.theme";
const listeners = new Set<() => void>();
let choice: ThemeChoice = readStored();

function readStored(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(next: ThemeChoice): void {
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
}

function notify(): void {
  for (const l of listeners) l();
}

/** The reader's explicit choice, or "system". */
export function themeChoice(): ThemeChoice {
  return choice;
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  apply(next);
  try {
    if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage refused; the choice still holds for this page.
  }
  notify();
}

/** Which palette is actually painting right now, whatever the choice was. */
export function resolvedTheme(): "light" | "dark" {
  if (choice !== "system") return choice;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The next state on the toggle: system → dark → light → system. */
export function cycleTheme(): void {
  setThemeChoice(choice === "system" ? "dark" : choice === "dark" ? "light" : "system");
}

// Stamp the stored choice before the first paint, and follow the OS while the
// choice is "system" — a canvas drawn in light greys on a page that just went
// dark is a plot nobody can read.
if (typeof document !== "undefined") {
  apply(choice);
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", notify);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A version that changes whenever the palette does. Canvas effects list it
 * among their dependencies so a theme switch redraws the axes in the new greys;
 * nothing else should need it, because everything in the DOM re-styles itself.
 */
export function useThemeVersion(): string {
  return useSyncExternalStore(subscribe, () => `${choice}:${resolvedTheme()}`);
}

const VAR = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/;

/**
 * A colour a canvas can use, from a colour a stylesheet would.
 *
 * Panels hand `Plot` the same tokens they use in inline styles — `var(--ink-4)`,
 * `var(--bad)` — and the canvas resolves them against the element it draws on,
 * which is where the cascade has already decided which palette applies. A
 * literal (`#c0392b`, `rgba(…)`) passes through untouched, so the spectral line
 * colours in `rayfan.ts` and `spot.ts` need no change: F is blue and C is red in
 * either theme.
 */
export function resolveColor(element: Element, color: string): string {
  const m = VAR.exec(color.trim());
  if (!m) return color;
  const value = getComputedStyle(element).getPropertyValue(m[1]!).trim();
  return value !== "" ? value : (m[2]?.trim() ?? color);
}
