import { DEFAULT_SPEC, type BuildSpec, type CoverslipChoice } from "./builder";

/**
 * One saved build, and the picker every imaging panel offers it through —
 * APP.md's Part F, decision 2.
 *
 * ## What this exists to fix
 *
 * D8 let a reader compose an objective and Part E let them author the surface
 * list under it, and neither could be *looked through*: a panel that draws a
 * picture held a `MicroscopeKind`, which is a name from a closed list of ten.
 * The seam is open now — a request carries a `BuildSpec` — but a spec built on
 * the builder's route dies when that panel unmounts, because `registry.ts` gives
 * every panel its own route and a route change is an unmount.
 *
 * ## Why a slot and not the URL
 *
 * `registry.ts` states the property being traded: *"`id` is the URL hash, so a
 * route survives a reload and can be linked to."* A spec in the hash would keep
 * that — the design and the view as one link, sendable to another person — at
 * the cost of an encoding that has to be versioned before the first link is
 * shared, or an old link silently decodes into a design that merely resembles
 * the one it was made from. One slot in `localStorage` is the smaller thing that
 * is honestly finishable: it survives a reload, it needs no wire format anyone
 * else will hold, and it is strictly more than the nothing that came before.
 * **The hash is left possible** — `encodeBuild` is already a string, so the
 * additive step is a route parameter, not a rewrite.
 *
 * ## The version is not decoration
 *
 * `localStorage` outlives the code that wrote it. A spec saved today and read
 * after `BuildSpec` gains a field would be missing it, and a build silently
 * missing a field is exactly the "resembles it" failure the paragraph above
 * refuses. So the stored value carries a version, `decodeBuild` returns `null`
 * on anything it does not recognise, and every field is checked rather than
 * trusted — the validator is a `Record<keyof BuildSpec, …>`, so a field added to
 * the spec breaks this build instead of quietly reading as `undefined`.
 */

const SLOT_KEY = "telemicroscope.build";

/**
 * Bump when `BuildSpec` changes shape. An older payload then decodes to `null`
 * and the reader is offered the catalogue, which is a slot that lost its
 * contents — visible, and preferable to one that lies about them.
 */
const SLOT_VERSION = 1;

type Check = (value: unknown) => boolean;

const isFiniteNumber: Check = (v) => typeof v === "number" && Number.isFinite(v);
const isString: Check = (v) => typeof v === "string" && v.length > 0;
const oneOf =
  (...allowed: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && allowed.includes(v);

const isCoverslip: Check = (v) => {
  if (typeof v !== "object" || v === null) return false;
  const slip = v as Partial<CoverslipChoice> & { kind?: unknown };
  if (slip.kind === "none") return true;
  if (slip.kind !== "slip") return false;
  const { thicknessMm, medium } = v as { thicknessMm?: unknown; medium?: unknown };
  return isFiniteNumber(thicknessMm) && isString(medium);
};

/**
 * One check per field, and the compiler insists it is one per field.
 *
 * Media are checked as *non-empty strings* rather than against the registries in
 * `builder.ts`, deliberately: an unknown medium is a refusal the engine states
 * in its own words, and this file rewriting that sentence would put a second
 * definition of "which glasses exist" in the app. What this guards is shape.
 */
const SPEC_CHECKS: Record<keyof BuildSpec, Check> = {
  architecture: oneOf("din", "infinity"),
  form: oneOf("doublet", "lister", "oil"),
  magnification: isFiniteNumber,
  numericalAperture: isFiniteNumber,
  crownMedium: isString,
  flintMedium: isString,
  tubeLengthMm: isFiniteNumber,
  coverslip: isCoverslip,
  orientation: oneOf("flintFirst", "crownFirst"),
  frontGroupOrientation: oneOf("flintFirst", "crownFirst"),
  rearGroupOrientation: oneOf("flintFirst", "crownFirst"),
  infinitySpaceMm: isFiniteNumber,
  fieldNumberMm: isFiniteNumber,
  powerSplit: isFiniteNumber,
  separationFactor: isFiniteNumber,
  meniscusCount: isFiniteNumber,
  immersionMedium: isString,
};

const SPEC_KEYS = Object.keys(SPEC_CHECKS) as (keyof BuildSpec)[];

/** The stored string. Public because the hash route, if it lands, is this. */
export function encodeBuild(spec: BuildSpec): string {
  const fields: Record<string, unknown> = {};
  for (const key of SPEC_KEYS) fields[key] = spec[key];
  return JSON.stringify({ version: SLOT_VERSION, spec: fields });
}

/**
 * A stored string back to a spec, or `null` — never a partial one.
 *
 * `null` covers every way this can go wrong at once: not JSON, a version this
 * code does not know, a missing field, a field of the wrong kind. The caller
 * has one branch and it is the honest one, since a spec that is 15/16 right
 * builds a *different lens* rather than failing.
 */
export function decodeBuild(text: string): BuildSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, spec } = parsed as { version?: unknown; spec?: unknown };
  if (version !== SLOT_VERSION) return null;
  if (typeof spec !== "object" || spec === null) return null;
  const fields = spec as Record<string, unknown>;
  const checked: Record<string, unknown> = {};
  for (const key of SPEC_KEYS) {
    if (!(key in fields)) return null;
    if (!SPEC_CHECKS[key](fields[key])) return null;
    checked[key] = fields[key];
  }
  // Copied key by key rather than spread wholesale: a stored object may carry
  // fields this version does not know, and a spec is what the builder holds and
  // what `specKey` hashes, so it gets exactly the sixteen it is defined to have.
  // `DEFAULT_SPEC` underneath makes the result a `BuildSpec` by construction
  // rather than a cast over a bag that happened to pass a loop.
  return { ...DEFAULT_SPEC, ...(checked as unknown as BuildSpec) };
}

/**
 * `localStorage`, or nothing.
 *
 * Every access is guarded: the API exists and throws in a Chrome profile with
 * third-party storage blocked, and in Safari's private mode it has thrown on
 * *write*. A reader whose browser refuses to store a build should get a panel
 * that offers the ten rows, not a panel that does not paint.
 */
export function readSavedBuild(): BuildSpec | null {
  try {
    const stored = localStorage.getItem(SLOT_KEY);
    return stored === null ? null : decodeBuild(stored);
  } catch {
    return null;
  }
}

/** `true` if the browser took it. `false` is a fact the panel has to say. */
export function writeSavedBuild(spec: BuildSpec): boolean {
  try {
    localStorage.setItem(SLOT_KEY, encodeBuild(spec));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedBuild(): void {
  try {
    localStorage.removeItem(SLOT_KEY);
  } catch {
    // Nothing to report: a slot that cannot be cleared cannot have been written.
  }
}
