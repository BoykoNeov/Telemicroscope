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
 */

/** An error the app itself raised, as opposed to one the engine did. */
export class AppRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRefusal";
  }
}

export type Refusal<Stage extends string> = {
  readonly ok: false;
  readonly error: string;
  readonly source: "engine" | "app";
  readonly stage: Stage;
};

export const refusalOf = <Stage extends string>(cause: unknown, stage: Stage): Refusal<Stage> => ({
  ok: false,
  error: (cause as Error).message,
  source: (cause as Error).name === "AppRefusal" ? "app" : "engine",
  stage,
});
