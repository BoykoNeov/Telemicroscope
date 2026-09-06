import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The frame keeps standing when the picture inside it falls over.
 *
 * Without this, a panel that throws while rendering unmounts the whole tree —
 * React 18 does that deliberately, on the grounds that a half-rendered UI is
 * worse than none — and the whole tree here includes the nav. The page goes
 * white, and the only way back to a working surface is editing the URL by hand.
 * Lazy routes added a second way in: `registry.ts` wraps every panel in
 * `lazy(() => import(...))`, and an import that cannot be fetched rejects, which
 * `Suspense` re-throws as a render error with exactly the same blast radius.
 *
 * ## What this catches, and what it does not
 *
 * Stated plainly because the gap is large and an error boundary reads as if it
 * catches everything. `componentDidCatch` sees throws from **render and the
 * lifecycle methods below it**, which is the panel's own render, and a rejected
 * `lazy()` chunk. It does not see:
 *
 * - a throw inside a worker's `onmessage` handler, or any `.then` — and that is
 *   where nearly every panel here does its real work, since the physics runs in
 *   a worker and the reply lands in a callback. Those already do not blank the
 *   page (an unhandled rejection is not a render error), so nothing regressed;
 *   they just do not arrive here either.
 * - a throw in an event handler — a slider's `onChange`, a canvas click.
 * - a throw in `App`'s own render, above this boundary: hash resolution, the
 *   registry, the nav. Those still blank the page, and the fix for them is that
 *   they must not throw.
 *
 * So the honest claim is narrow: **a panel whose render throws, and a panel
 * whose chunk will not load, now cost the panel instead of the page.**
 *
 * ## The reset, which is the part that goes wrong quietly
 *
 * An error boundary latches: once it has caught, it renders the message for
 * every subsequent render until something remounts it. If it were mounted above
 * the route key, clicking a different nav link would change the hash, resolve a
 * new panel, and then render this message again — nav links that visibly do
 * nothing, which is a worse failure than the blank page, because it looks like
 * the app rather than like a crash.
 *
 * So the boundary is keyed on the route, in `App.tsx`, with the same expression
 * the fade wrapper uses. Today it sits *inside* that wrapper, so the wrapper's
 * key alone would already remount it; the second key is written anyway, because
 * "the error clears when you click another panel" should not be a property of a
 * div that exists to run a 140 ms animation.
 *
 * ## Why a class
 *
 * There is no hook form. `getDerivedStateFromError` / `componentDidCatch` are
 * the only API React exposes for this, and both are class-only — this is the
 * one component in `packages/app` that cannot be a function.
 */

/**
 * The sentence to show for whatever was thrown.
 *
 * `throw` takes any value, so the message is not simply `error.message`: a
 * panel could throw a string, and an `Error` with an empty message would print
 * a blank line where the explanation goes. The chunk-load case matters most and
 * is an ordinary `Error` ("Failed to fetch dynamically imported module: …"), so
 * the common path is the first branch.
 */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name || "Error";
  if (typeof cause === "string") return cause || "unknown error";
  return String(cause) || "unknown error";
}

type BoundaryProps = { readonly children: ReactNode };

/**
 * A wrapper object rather than the thrown value itself, and not an optional
 * field. `throw` takes any value including `undefined` and `null`, so
 * `error: unknown` has no value left to mean "nothing was caught" — a panel
 * that threw `null` would render its children again, throw again, and loop. The
 * box makes "caught" a fact about the box and not about what was in it.
 * (`caught?: …` would be worse still: `exactOptionalPropertyTypes` is on, so an
 * absent field and a present `undefined` one are different types for a state
 * object that is replaced wholesale.)
 */
type BoundaryState = { readonly caught: { readonly cause: unknown } | null };

export class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { caught: null };

  static getDerivedStateFromError(cause: unknown): BoundaryState {
    return { caught: { cause } };
  }

  override componentDidCatch(cause: unknown, info: ErrorInfo): void {
    // React logs the error itself; what it does not log in production builds is
    // which panel was mounted. The stack is kept because a chunk failure names
    // the URL that would not load, which is the whole diagnosis.
    console.error("[panel] render failed:", cause, info.componentStack);
  }

  override render(): ReactNode {
    const { caught } = this.state;
    if (caught === null) return this.props.children;

    return (
      <div className="panel-error" role="alert">
        <p className="panel-error-line">this panel stopped: {errorMessage(caught.cause)}</p>
        <p className="panel-error-note">
          the other surfaces are unaffected — pick one from the nav above. if the panel could not
          be downloaded, reload the page: a chunk that has already failed is not fetched again.
        </p>
      </div>
    );
  }
}
