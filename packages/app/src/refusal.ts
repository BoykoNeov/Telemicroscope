/**
 * One refusal shape, shared — the app's own extraction rule applied a second
 * time.
 *
 * `ui.tsx` states it for the guards ("the next surface that needs a guard
 * readout extracts it rather than copying it") and D6 landed the first version
 * of this beside them, privately, in `eyepiece.ts`. C5 is the second surface
 * that composes an objective with an eyepiece and has to say **which piece
 * refused**, so the type moves here rather than being duplicated.
 *
 * What is shared is narrow on purpose: an engine refusal's *text* is the
 * engine's and is never rewritten, and `source` records whether the sentence
 * came from `core` or from an app-side bound. `stage` stays a caller-chosen
 * string union, because the stages of a microscope and of a visual telescope
 * are not the same list and flattening them into one enum would make a panel
 * print a stage it cannot reach.
 *
 * ## Why `source` is split out from `stage`
 *
 * Part F made the imaging adapters take a `BuildSpec` rather than a name from
 * the catalogue, and a spec a reader typed can be one the *app* refuses — so
 * `AppRefusal` became reachable from inside a render, where before only the
 * engine's own ceilings were. Those adapters need `source` and have exactly one
 * stage, and a one-member `stage` union would be a field that never says
 * anything. `Refused` is therefore the part every refusing surface needs and
 * `Refusal<Stage>` is that plus the stage, so neither shape carries a field it
 * cannot fill honestly.
 */

/** An error the app itself raised, as opposed to one the engine did. */
export class AppRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRefusal";
  }
}

/** Whose sentence this is. Never inferred by a panel — recorded at the throw. */
export type RefusalSource = "engine" | "app";

/** A refusal with no stage to name: the shape a one-step surface can fill. */
export type Refused = {
  readonly ok: false;
  readonly error: string;
  readonly source: RefusalSource;
};

export type Refusal<Stage extends string> = Refused & {
  readonly stage: Stage;
};

export const refused = (cause: unknown): Refused => ({
  ok: false,
  error: (cause as Error).message,
  source: (cause as Error).name === "AppRefusal" ? "app" : "engine",
});

export const refusalOf = <Stage extends string>(cause: unknown, stage: Stage): Refusal<Stage> => ({
  ...refused(cause),
  stage,
});

/**
 * The clause a panel puts in front of a quoted refusal — "the engine refuses
 * this render", "this app refuses this render".
 *
 * Nine panels wrote the engine's half unconditionally, which was true while the
 * only reachable refusals came from `core`. Part F made a reader's own spec
 * reach a render, so the app's own half became reachable and the sentence had
 * to start asking. Shared rather than copied for the same reason `Refusal` is:
 * whose voice a sentence is in is a repo rule, and a rule written out nine times
 * is one that will be wrong in one of them.
 */
export const refusalVoice = (source: RefusalSource, subject: string): string =>
  source === "app" ? `this app refuses ${subject}` : `the engine refuses ${subject}`;
