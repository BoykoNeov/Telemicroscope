/**
 * The frequency lattice a partially coherent sum reads the pupil on, and the
 * one guard that says whether it carried it.
 *
 * Both forms of the sum — Abbe's, over source points (`abbe.ts`), and Hopkins',
 * over pairs of object frequencies (`hopkins.ts`) — visit exactly the same
 * samples: for each illumination direction s, the DFT lattice offset by s,
 * clipped to the box where the shifted pupil can transmit. That the two agree
 * about which samples those are is not a coincidence to be maintained by hand;
 * the box arithmetic and the phase-step guard live here so there is one of each.
 *
 * The lesson is § 3c's kernel-rotation drift, and `wave/psf`'s `spiderObscures`
 * is the same move: write the geometry once, and two branches cannot disagree
 * about it.
 */

/** The lattice bins a direction's shifted pupil can reach, inclusive. */
export interface ShiftedPupilBox {
  readonly ixLo: number;
  readonly ixHi: number;
  readonly iyLo: number;
  readonly iyHi: number;
}

/**
 * Where P(u + s) is supported on an `n`-bin frequency grid whose pupil spans
 * `pupilSamples` bins across its diameter.
 *
 * Visiting only this box is what keeps a *traced* `PupilFunction` from being
 * asked about frequencies it could never transmit — the pupil evaluation is the
 * expensive currency (§ 6f, § 6p), not the arithmetic.
 *
 * It **throws** when the box runs off the grid rather than clamping. Clamping
 * would truncate the pupil, and a truncated pupil is indistinguishable from a
 * smaller aperture — a coverage cap that would read as physics (§ 6f.3).
 */
export function shiftedPupilBox(
  who: string,
  n: number,
  pupilSamples: number,
  sx: number,
  sy: number,
): ShiftedPupilBox {
  const half = n / 2;
  const step = 2 / pupilSamples;
  const ixLo = Math.ceil(half + (-1 - sx) / step);
  const ixHi = Math.floor(half + (1 - sx) / step);
  const iyLo = Math.ceil(half + (-1 - sy) / step);
  const iyHi = Math.floor(half + (1 - sy) / step);
  if (ixLo < 0 || iyLo < 0 || ixHi > n - 1 || iyHi > n - 1) {
    const reach = Math.max(Math.abs(sx), Math.abs(sy));
    throw new Error(
      `${who}: the pupil shifted to (${sx.toFixed(3)}, ${sy.toFixed(3)}) runs off a ` +
        `${n}-bin frequency grid at pupilSamples ${pupilSamples} — raise size to at least ` +
        `${Math.ceil(pupilSamples * (1 + reach)) + 2}, or lower pupilSamples`,
    );
  }
  return { ixLo, ixHi, iyLo, iyHi };
}

/**
 * Largest |Δphase| in waves between adjacent *transmitting* samples of the
 * lattice a sum actually evaluated on — `wave/psf`'s number, measured where the
 * sum reads it, and maximized over illumination directions rather than taken at
 * s = 0 (§ 6f.9 gives the ripple that makes the maximum load-bearing).
 *
 * A blocked sample breaks the chain in both directions: a step across the
 * aperture rim is not a wavefront step, and counting it would make an
 * obstruction look like an unresolved wavefront.
 *
 * The state is one row of previous-row phases plus the previous column, which
 * is all a 4-neighbour difference needs — and it rides *inside* the caller's
 * evaluation loop rather than in a second pass, because `pupil.phaseWaves` may
 * re-trace rays and asking it again per neighbour pair would be the expensive
 * way to learn the same number.
 */
export class LatticePhaseGuard {
  private readonly rowPhase: Float64Array;
  private readonly rowIn: Uint8Array;
  private prevIn = false;
  private prevPhase = 0;
  private worst = 0;

  constructor(n: number) {
    this.rowPhase = new Float64Array(n);
    this.rowIn = new Uint8Array(n);
  }

  /** Begin an illumination direction: nothing above this box has been seen. */
  beginPoint(box: ShiftedPupilBox): void {
    this.rowIn.fill(0, box.ixLo, box.ixHi + 1);
    this.prevIn = false;
    this.prevPhase = 0;
  }

  /** Begin a row: there is no sample to the left of its first column. */
  beginRow(): void {
    this.prevIn = false;
    this.prevPhase = 0;
  }

  /** A sample the aperture blocks. */
  block(ix: number): void {
    this.prevIn = false;
    this.rowIn[ix] = 0;
  }

  /** A transmitting sample, carrying `w` waves of wavefront error. */
  transmit(ix: number, w: number): void {
    if (this.prevIn) {
      const d = Math.abs(w - this.prevPhase);
      if (d > this.worst) this.worst = d;
    }
    if (this.rowIn[ix] === 1) {
      const d = Math.abs(w - this.rowPhase[ix]!);
      if (d > this.worst) this.worst = d;
    }
    this.prevIn = true;
    this.prevPhase = w;
    this.rowIn[ix] = 1;
    this.rowPhase[ix] = w;
  }

  /** The maximum over every direction offered so far. */
  get max(): number {
    return this.worst;
  }
}
