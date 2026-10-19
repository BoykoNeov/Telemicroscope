/**
 * Readings one step pins and a later step cites — held in ONE place.
 *
 * § 2w: `growth-measures` and `six-interactions` built their tables on § 6bp.3's
 * splits, § 6bo.2's plateau pair and § 6br's escape as literals copied at
 * eight to sixteen digits. Nothing compared a copy with a fresh reading, so
 * when § 2t and § 2u moved the sources the copies passed unchanged — the axial
 * split by 0.073, the rest in the fifth to seventh digit — and the verdicts
 * built on them went on being asserted from numbers no render produced.
 *
 * Each constant below is now asserted by the file that measures it, at that
 * file's own precision, so a source that moves fails where it moved; and the
 * files that cite it import it rather than copy it, so the citation moves
 * with it and the rungs built on it fail loudly instead of passing silently.
 * A `.test.ts` cannot be imported by another without registering its tests
 * twice, which is why the numbers live here and not in their source files.
 */

/** § 6bp.3's `rendOverFree` interaction, branch and Q6BO's matched field —
 *  `matched-flat-field.test.ts`, pinned there to 8 decimals. */
export const SPLIT_AXIS_BRANCH = 0.7011084950501268;
export const SPLIT_AXIS_MATCHED = 0.7170884561278572;
export const SPLIT_EDGE_BRANCH = 0.971076244414482;
export const SPLIT_EDGE_MATCHED = 0.9656957916194233;

/** § 6bo.2's plateau interaction, branch and matched —
 *  `aperture-and-field.test.ts`, pinned there to 9 decimals. */
export const PLATEAU_BRANCH = 0.9166284391500286;
export const PLATEAU_MATCHED = 0.810640661739918;

/** § 6br.1's branch escape interaction and § 6br.6's anchor ladder (k = 0.5,
 *  1, 4) — `escape-interaction.test.ts`, pinned there to 12 decimals. k = 1 is
 *  § 6br.3's matched reading at the branch's own field; k = 0.5 is the anchor
 *  the other five interactions sit at. */
export const ESCAPE_BRANCH = 0.7511314572506348;
export const ESCAPE_AT_HALF_ANCHOR = 0.36665969827957456;
export const ESCAPE_MATCHED = 0.3915111065426357;
export const ESCAPE_AT_QUADRUPLE_ANCHOR = 0.10968454479020552;

/** § 6bs.7's anisotropy interaction over the anchor ladder k = 1, 2, 4, 8 —
 *  `six-interactions.test.ts`, pinned there to 9 decimals. */
export const ANISO_ANCHOR_FAMILY = [
  0.7862300730210287, 0.9285478115301892, 0.9710985815696986, 0.9853104600763398,
] as const;

/** § 6bq.7's field move at a uniform 2× frame, NA 0.10 and NA 0.20 on the
 *  20× — `refusal-boundary.test.ts`, reproduced there to a relative 1e-12. */
export const PLATEAU_FIELD_MOVE_010 = 0.9988262742778071;
export const PLATEAU_FIELD_MOVE_020 = 0.9648806446664523;

/** § 6bn's escape cells on the 4×/0.10, 10×/0.10 and 10×/0.20 at their
 *  published digits — `fourth-corner.test.ts` (the 4×) and
 *  `escape-interaction.test.ts` (the 10×s) assert them; `second-interval`
 *  cited copies until § 2y. */
export const ESC_4 = 0.0644358;
export const ESC_10 = 0.02486524;
export const ESC_10F = 0.4758219;

/** § 6bn.3's edge splits, 10×/0.10 and 10×/0.20 —
 *  `matched-flat-field.test.ts` asserts them; `second-interval` cited copies
 *  until § 2y. */
export const ROF_EDGE_10 = 1.15514932;
export const ROF_EDGE_10F = 1.30209564;

/** § 6bm.4's six interactions on the first interval (4×→10×), as departures
 *  from 1 — `fourth-corner.test.ts` asserts them; `second-interval` cited
 *  copies until § 2y. */
export const I1_ANISO = 1.0166451;
export const I1_COST = 1.1060587;
export const I1_AXIS = 2.3061195;
export const I1_ESC = 2.0073765;
export const I1_PLATEAU = 1.1996369;
export const I1_EDGE = 1.3894409;
