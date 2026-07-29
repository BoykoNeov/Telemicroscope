import {
  neutralSpecimen,
  type SpecimenValue,
  type SpectralSpecimen,
} from "@telemicroscope/core/imaging";

/**
 * The specimens, in one place and **spectral** — what the app puts under the
 * objective, authored in object millimetres.
 *
 * They were `stage.ts`'s until a second surface needed them (A9, the colour
 * panel), and the move came with a type change: a `Specimen` is a transmittance
 * at one wavelength, a `SpectralSpecimen` is one that reads λ. Everything the
 * stage draws is unchanged — it binds `atWavelength(spec, LAMBDA_NM)` and never
 * learns a spectrum exists, which is exactly the seam `imaging/specimen` keeps.
 *
 * ## They are pictures, not physics, and the ladder does not pin one
 *
 * `stage.ts`'s rule, carried over verbatim: no rung pins a specimen, so they
 * live in the app rather than in `core`. Each is a real **absorption**
 * (amplitude in [0, 1]) rather than a phase object, because § 6f's null is that
 * brightfield transfers no phase at all and A3 is the panel that spends it.
 *
 * ## The stain is SYNTHETIC, and that is a hard-rule statement rather than a caveat
 *
 * § 6r lists "a rung pinning a published stain's transmittance" as **open**, and
 * real dye spectra are measured data this repo does not have. So the bands below
 * are invented: two Gaussian absorbances with round numbers, named for what they
 * do to the band and not for any dye. Nothing here is H&E, nothing is a
 * transcribed absorption spectrum, and no readout computed from them is a claim
 * about a real stain — what the colour panel measures is that the *path* carries
 * a specimen's own spectrum into the image, which is true of any spectrum.
 *
 * ## Two dyes compose by absorbance, not by multiplication of stain fractions
 *
 * Beer–Lambert: optical depths add, so a pixel carrying both dyes transmits
 * `exp(−(a₁k₁ + a₂k₂))` of the *intensity*. The specimen returns an **amplitude**
 * transmittance, so it is the square root of that — § 6r.5's own form, and
 * getting it wrong is invisible in the picture and wrong in the physics.
 */

/** A raised-cosine edge — smooth over `w`, so nothing on screen is the grid's
 * own aliasing wearing a specimen's clothes. */
function ramp(d: number, w: number): number {
  if (d <= 0) return 0;
  if (d >= w) return 1;
  return 0.5 - 0.5 * Math.cos((Math.PI * d) / w);
}

/** A deterministic hash — a stained section needs structure that is the same on
 * every tile that reaches it, and a seeded RNG walked per pixel would not be. */
function hash2(i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A Gaussian absorption band, peak 1 at `centreNm`. */
const band = (nm: number, centreNm: number, widthNm: number): number =>
  Math.exp(-(((nm - centreNm) / widthNm) ** 2));

/**
 * The two invented dyes, as **absorbance per unit of the structure that carries
 * them** — see the header on why they are invented.
 *
 * Their centres are chosen for what a reader will see rather than from data: one
 * removes the middle of the band and leaves both ends, which is the purple line's
 * direction (§ 6r.5's magenta); the other removes the long end and leaves blue
 * and green. A section stained with both therefore reads pink where only the
 * first is and blue-violet where both are, which is what a stained section looks
 * like — arrived at by choosing two centres, not by copying a stain.
 *
 * Both are wide enough to absorb appreciably at the d line as well as at their
 * own peaks, which is not cosmetic: `LAMBDA_NM` is where the **stage** binds
 * them, and a dye that vanished at 587.6 nm would empty a panel that already
 * exists to make room for one that does not.
 */
const CYTOPLASM_BAND = { centreNm: 530, widthNm: 45, absorbance: 2.3 } as const;
const NUCLEUS_BAND = { centreNm: 600, widthNm: 50, absorbance: 1.8 } as const;

/**
 * Amplitude transmittance of a pixel carrying `cyto` and `nuc` of the two dyes.
 *
 * `cyto`/`nuc` are coverage in [0, 1] — the geometry — and the dyes' own
 * absorbances are the constants above, so the *structure* and the *spectrum* are
 * separable and the picture's shape does not move when a band does.
 */
function stainAmplitude(cyto: number, nuc: number, nm: number): SpecimenValue {
  const absorbance =
    cyto * CYTOPLASM_BAND.absorbance * band(nm, CYTOPLASM_BAND.centreNm, CYTOPLASM_BAND.widthNm) +
    nuc * NUCLEUS_BAND.absorbance * band(nm, NUCLEUS_BAND.centreNm, NUCLEUS_BAND.widthNm);
  // Intensity transmittance is exp(−A); the amplitude is its square root, so the
  // exponent halves. Written as one exp rather than Math.sqrt(Math.exp(−A)) to
  // keep it exact at the deep end, where the intensity underflows before the
  // amplitude does.
  return { re: Math.exp(-0.5 * absorbance), im: 0 };
}

export type SpecimenKind = "ruled" | "diatom" | "section";

export interface SpecimenEntry {
  readonly kind: SpecimenKind;
  readonly label: string;
  /** Why it is in the list; one line, and it is the teaching. */
  readonly note: string;
  /**
   * True when the specimen ignores λ — `neutralSpecimen`, so neutral **by
   * construction** rather than by measurement.
   *
   * A colour panel needs the distinction on screen: § 6r's first rung is
   * "neutral in, neutral out", and a reader looking at a grey image of the ruled
   * grid should know whether it is grey because the path preserved a flat
   * spectrum or because nothing in the frame had one.
   */
  readonly neutral: boolean;
  readonly specimen: SpectralSpecimen;
}

export const SPECIMENS: readonly SpecimenEntry[] = [
  {
    kind: "ruled",
    label: "ruled grid, 20 µm",
    note: "§ 6n's bow, at field scale: a straight object line images CURVED, and a mosaic is where you can see it.",
    neutral: true,
    specimen: neutralSpecimen((x, y) => {
      // Distance in mm to the nearest ruling of a 20 µm square grid, then a
      // 1.5 µm line with a 1 µm soft edge — resolved by every objective in the
      // catalogue, so what changes across the picker is the field, not the line.
      const p = 0.02;
      const toLine = (u: number): number => {
        const frac = (u / p) % 1;
        return (0.5 - Math.abs((frac < 0 ? frac + 1 : frac) - 0.5)) * p;
      };
      const on = (d: number): number => 1 - ramp(d - 0.0015, 0.001);
      return { re: 1 - 0.85 * Math.max(on(toLine(x)), on(toLine(y))), im: 0 };
    }),
  },
  {
    kind: "diatom",
    label: "diatoms, 60 µm",
    note: "The classic resolution test object: areolae on a polar lattice, crowding toward the centre.",
    neutral: true,
    specimen: neutralSpecimen((x, y) => {
      // Scattered on a 150 µm lattice rather than one on the axis, so panning
      // finds another instead of leaving the field empty — and each one is
      // turned by its own cell's hash, so the rays do not line up across the
      // stage and read as one periodic object.
      const p = 0.15;
      const ci = Math.floor(x / p);
      const cj = Math.floor(y / p);
      const cx = (ci + 0.2 + 0.6 * hash2(ci, cj)) * p;
      const cy = (cj + 0.2 + 0.6 * hash2(cj, ci + 5)) * p;
      const r = Math.hypot(x - cx, y - cy);
      const R = 0.03;
      if (r > R) return { re: 1, im: 0 };
      const theta = Math.atan2(y - cy, x - cx) + 6.283 * hash2(ci + 2, cj + 9);
      // 48 rays and rings of 3 µm pitch. The radial pitch is fixed and the
      // tangential one is 2πr/48 — 3.9 µm at the rim and 1.3 µm a third of the
      // way in — so one specimen carries a range of frequencies straddling the
      // 4×/0.10's own 2.94 µm Abbe limit rather than a single one.
      const ring = Math.cos((2 * Math.PI * r) / 0.003);
      const ray = Math.cos(48 * theta);
      const pore = 0.5 + 0.5 * ring * ray;
      const rim = 1 - ramp(R - r, 0.004);
      return { re: 1 - 0.8 * (0.35 + 0.5 * pore) * (1 - rim) - 0.7 * rim * (1 - ramp(R - r, 0.001)), im: 0 };
    }),
  },
  {
    kind: "section",
    label: "stained section (two synthetic dyes)",
    note: "The only λ-dependent entry: two invented absorption bands, so what colour it images in is the specimen's and the optics', not the display's.",
    neutral: false,
    specimen: (x, y, nm) => {
      // Cells on a 25 µm lattice, each jittered and sized by its own hash, with
      // a darker nucleus — deterministic in the object plane, so two tiles that
      // reach the same cell draw the same cell.
      const p = 0.025;
      const ci = Math.floor(x / p);
      const cj = Math.floor(y / p);
      let cyto = 0;
      let nuc = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          const cx = (i + 0.25 + 0.5 * hash2(i, j)) * p;
          const cy = (j + 0.25 + 0.5 * hash2(j, i + 7)) * p;
          const rad = (0.28 + 0.12 * hash2(i + 3, j + 11)) * p;
          const d = Math.hypot(x - cx, y - cy);
          // The two dyes' coverages are tracked separately and each is a max
          // over neighbours rather than a sum, so overlapping cells do not stack
          // into an opacity no single cell has — the same convention the
          // monochrome version used, kept so the picture is the one A7 draws.
          cyto = Math.max(cyto, ramp(rad - d, 0.3 * rad));
          nuc = Math.max(nuc, ramp(0.4 * rad - d, 0.25 * rad));
        }
      }
      return stainAmplitude(cyto, nuc, nm);
    },
  },
];

export function specimenOf(kind: SpecimenKind): SpecimenEntry {
  const entry = SPECIMENS.find((s) => s.kind === kind);
  if (!entry) throw new Error(`unknown specimen ${kind}`);
  return entry;
}
