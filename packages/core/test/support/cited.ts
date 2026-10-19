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
export const SPLIT_AXIS_BRANCH = 0.7024134089688632;
export const SPLIT_AXIS_MATCHED = 0.7183255607546881;
export const SPLIT_EDGE_BRANCH = 0.9710761152743042;
export const SPLIT_EDGE_MATCHED = 0.9656918686444873;

/** § 6bo.2's plateau interaction, branch and matched —
 *  `aperture-and-field.test.ts`, pinned there to 9 decimals. */
export const PLATEAU_BRANCH = 0.9166284391500286;
export const PLATEAU_MATCHED = 0.810640661739918;

/** § 6br.1's branch escape interaction and § 6br.6's anchor ladder (k = 0.5,
 *  1, 4) — `escape-interaction.test.ts`, pinned there to 12 decimals. k = 1 is
 *  § 6br.3's matched reading at the branch's own field; k = 0.5 is the anchor
 *  the other five interactions sit at. */
export const ESCAPE_BRANCH = 0.7511288264140593;
export const ESCAPE_AT_HALF_ANCHOR = 0.36666027861117056;
export const ESCAPE_MATCHED = 0.39149648627580136;
export const ESCAPE_AT_QUADRUPLE_ANCHOR = 0.10968529225303913;

/** § 6bs.7's anisotropy interaction over the anchor ladder k = 1, 2, 4, 8 —
 *  `six-interactions.test.ts`, pinned there to 9 decimals. */
export const ANISO_ANCHOR_FAMILY = [
  0.7862300730210287, 0.9285478115301892, 0.9710985815696986, 0.9853104600763398,
] as const;

/** § 6bq.7's field move at a uniform 2× frame, NA 0.10 and NA 0.20 on the
 *  20× — `refusal-boundary.test.ts`, reproduced there to a relative 1e-12. */
export const PLATEAU_FIELD_MOVE_010 = 0.9988262742778071;
export const PLATEAU_FIELD_MOVE_020 = 0.9648806446664523;
