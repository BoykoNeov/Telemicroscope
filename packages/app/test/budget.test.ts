import { describe, it, expect } from "vitest";
import {
  allocateEqualShare,
  toleranceBudget,
  type ToleranceParameter,
} from "@telemicroscope/core/analysis";
import {
  MARECHAL_WAVES,
  prepareSheet,
  runBudget,
  sheetAt,
  type SheetLens,
} from "../src/budget";

/**
 * APP.md Part P — the tolerance sheet.
 *
 * The adapter runs the allocation itself rather than calling
 * `allocateEqualShare` on the whole set, because that routine re-measures its
 * currency AT the allowance it computed and throws when the allowance is large
 * enough to stop the chief ray clearing the glass — which a sheet cannot let
 * cost it ten good rows. So the first rung here is that the two agree wherever
 * the engine's own version can answer at all: what is app-side is the fault
 * tolerance and the presentation, not the arithmetic.
 *
 * Everything else is pinned to § 6au's published drawing — the same radii,
 * thicknesses, runouts and wedge callouts, to the digits that step quotes — and
 * then asked of a SECOND lens, which is what the panel exists for.
 */

const SPEC = { apertureMm: 10, focalRatio: 6 } as const;
const SAMPLES = 21;

const ctxFor = (lens: SheetLens) => prepareSheet({ ...SPEC, lens }, SAMPLES);

describe("Part P — the arithmetic is the engine's, and only the fault tolerance is ours", () => {
  it("every allowance equals `allocateEqualShare`'s, in both currencies, to f64", () => {
    // The whole justification for the app-side loop. If these ever part company,
    // the sheet has grown a budget of its own and the ladder no longer pins it.
    for (const lens of ["apochromat", "achromat"] as const) {
      const ctx = ctxFor(lens);
      const rows = ctx.build.parameters as ToleranceParameter[];
      const sheet = sheetAt(ctx, 1);
      const colour = allocateEqualShare(
        ctx.build.system,
        rows,
        ctx.build.nominalColour,
        ctx.opts,
        ctx.colour,
      );
      const blur = allocateEqualShare(ctx.build.system, rows, MARECHAL_WAVES, ctx.opts);
      sheet.rows.forEach((row, i) => {
        expect(row.colourAllowance, `${lens} ${row.label} colour`).toBeCloseTo(
          colour.rows[i]!.allowance,
          12,
        );
        expect(row.blurAllowance, `${lens} ${row.label} blur`).toBeCloseTo(
          blur.rows[i]!.allowance,
          12,
        );
      });
    }
  });

  it("a cemented block of n surfaces carries 3n−1 rows, not 4n−1", () => {
    // § 6au.3: wedge is the same freedom as centring on a sphere, so it is a
    // COLUMN and not four more rows. Eleven for the triplet, eight for the
    // doublet, and the wedge callout sits beside the centring rows only.
    for (const [lens, surfaces] of [
      ["apochromat", 4],
      ["achromat", 3],
    ] as const) {
      const sheet = sheetAt(ctxFor(lens), 1);
      expect(sheet.surfaces).toBe(surfaces);
      expect(sheet.rows).toHaveLength(3 * surfaces - 1);
      const withWedge = sheet.rows.filter((r) => r.wedgeArcmin !== null);
      expect(withWedge).toHaveLength(surfaces);
      for (const r of withWedge) expect(r.label).toContain("centring");
    }
  });
});

describe("Part P — the sheet reproduces § 6au's drawing, number for number", () => {
  const sheet = sheetAt(ctxFor("apochromat"), 1);
  const row = (label: string) => sheet.rows.find((r) => r.label === label)!;

  it("the four radii are 0.36%, 0.13%, 0.20% and 6.3%", () => {
    expect(row("c1").allowance * 100).toBeCloseTo(0.357, 2);
    expect(row("c2").allowance * 100).toBeCloseTo(0.133, 2);
    expect(row("c3").allowance * 100).toBeCloseTo(0.203, 2);
    expect(row("c4").allowance * 100).toBeCloseTo(6.26, 1);
  });

  it("the first two centre thicknesses are 0.20 mm and 0.42 mm", () => {
    expect(row("t1").allowance).toBeCloseTo(0.196, 3);
    expect(row("t2").allowance).toBeCloseTo(0.424, 3);
  });

  it("the three centring rows are 69, 39 and 103 µm", () => {
    expect(row("s1 centring").allowance * 1000).toBeCloseTo(69.1, 1);
    expect(row("s2 centring").allowance * 1000).toBeCloseTo(38.8, 1);
    expect(row("s3 centring").allowance * 1000).toBeCloseTo(103.4, 1);
  });

  it("...and the same three are 12.1, 6.6 and 15.5 arcmin of wedge", () => {
    // The other half of § 6ar.6's deferral, which turned out to be another UNIT
    // rather than another row. α = asin(δ·c), which § 6au.3 makes exact.
    expect(row("s1 centring").wedgeArcmin!).toBeCloseTo(12.11, 1);
    expect(row("s2 centring").wedgeArcmin!).toBeCloseTo(6.57, 1);
    expect(row("s3 centring").wedgeArcmin!).toBeCloseTo(15.48, 1);
  });

  it("six rows are set by colour and five by blur, t₃ being the one that turns", () => {
    expect(sheet.rows.map((r) => r.binds)).toEqual([
      "colour", "colour", "colour", "colour",
      "colour", "colour", "blur",
      "blur", "blur", "blur", "blur",
    ]);
    expect(sheet.colourRows).toBe(6);
    expect(sheet.blurRows).toBe(5);
  });

  it("and the two rows § 6au leaves out of its summary are marked, not printed", () => {
    // 3.1 mm of extra glass on a 1.2 mm element, and a rear centring row whose
    // slope reached 68% of where the budget sent it. Neither is a tolerance; a
    // sheet that printed them in the same column as 39 µm would be lying.
    expect(row("t3").verdict).toBe("not a tolerance");
    expect(row("s4 centring").verdict).toBe("loose");
    for (const label of ["c1", "c2", "c3", "c4", "t1", "t2", "s1 centring", "s2 centring", "s3 centring"]) {
      expect(row(label).verdict, label).toBe("ok");
    }
  });
});

describe("Part P — the second lens, which is what the panel is for", () => {
  it("the rows CANCEL on the triplet and REINFORCE on the doublet", () => {
    // § 6au measures 0.76 on the apochromat under its own seven-four grouping and
    // says the factor "belongs to this lens rather than to the method". This is
    // that sentence as a measurement: the same machinery, a second lens, and the
    // answer on the OTHER side of one. An RSS budget is pessimistic on one of the
    // two objectives this repo ships and optimistic on the other.
    const apo = sheetAt(ctxFor("apochromat"), 1e-2).drawing!;
    const ach = sheetAt(ctxFor("achromat"), 1e-2).drawing!;
    expect(apo.couplingRatio).toBeLessThan(1);
    expect(ach.couplingRatio).toBeGreaterThan(1);
    expect(apo.couplingRatio).toBeCloseTo(0.587, 2);
    expect(ach.couplingRatio).toBeCloseTo(1.134, 2);
    // …and on ONE support, which is what makes the comparison a measurement.
    expect(apo.pointsDropped).toBe(0);
    expect(ach.pointsDropped).toBe(0);
  });

  it("both factors are flat over three decades of budget, so they are the LENS's", () => {
    // The curve's whole argument. A ratio measured at one budget could be a
    // property of that budget; one that does not move while the budget moves a
    // thousandfold is not.
    for (const [lens, expected] of [
      ["apochromat", 0.587],
      ["achromat", 1.134],
    ] as const) {
      const ctx = ctxFor(lens);
      for (const scale of [1e-3, 1e-2, 3e-2]) {
        expect(sheetAt(ctx, scale).drawing!.couplingRatio, `${lens} at ${scale}`).toBeCloseTo(
          expected,
          2,
        );
      }
    }
  });

  it("colour cannot see the alignment AT ALL, on either lens", () => {
    // The half of § 6au's headline that is lens-independent, and the reason it
    // is: a decentred sphere is a prism, and a prism has no paraxial power. Zero
    // rather than small — this is an exact statement about the currency.
    for (const lens of ["apochromat", "achromat"] as const) {
      const centring = sheetAt(ctxFor(lens), 1).rows.filter((r) => r.label.includes("centring"));
      expect(centring.length).toBeGreaterThan(2);
      for (const r of centring) {
        expect(r.colourPerUnit, `${lens} ${r.label}`).toBe(0);
        expect(r.binds).toBe("blur");
        expect(r.colourAllowance).toBe(Infinity);
      }
    }
  });

  it("...while the SIZE of the disagreement is a fact about apochromats only", () => {
    // The other half, which does not travel. The triplet's two currencies part
    // company by up to 25.9× where both can see a row; the doublet's agree to
    // within 2.6×, its own residual colour being ten times looser.
    const spread = (lens: SheetLens): number[] =>
      sheetAt(ctxFor(lens), 1)
        .rows.filter((r) => r.colourPerUnit > 0)
        .map((r) => r.bindsBy);
    const apo = spread("apochromat");
    const ach = spread("achromat");
    expect(Math.max(...apo)).toBeGreaterThan(20);
    expect(Math.max(...ach)).toBeLessThan(3);
    expect(Math.min(...apo)).toBeGreaterThan(2);
    // Ten times looser, which is where the difference comes from.
    const colourOf = (lens: SheetLens) => sheetAt(ctxFor(lens), 1).nominalColour;
    expect(colourOf("achromat") / colourOf("apochromat")).toBeCloseTo(9.99, 1);
  });
});

describe("Part P — a budget that asks for an untraceable lens is a refusal", () => {
  it("one row's refusal does not cost the sheet the other ten", () => {
    // The reason the allocation is done row by row. At a budget this far past the
    // linear regime some rows perturb the lens until the chief ray no longer
    // clears it, and `opdMap` throws from three frames down. Every other row is
    // still a number, and the sheet says which one went.
    const ctx = prepareSheet({ ...SPEC, lens: "apochromat" }, SAMPLES);
    const sheet = sheetAt(ctx, 60);
    expect(sheet.rows.some((r) => r.verdict === "refused")).toBe(true);
    expect(sheet.rows.some((r) => r.verdict !== "refused")).toBe(true);
    for (const r of sheet.rows) {
      if (r.verdict === "refused") expect(r.note).not.toBe("");
    }
  });

  it("the combined trace refuses as a whole rather than reporting a large number", () => {
    const sheet = sheetAt(prepareSheet({ ...SPEC, lens: "apochromat" }, SAMPLES), 60);
    expect(sheet.drawing).toBeNull();
    expect(sheet.refusal).toContain("traceable");
  });
});

describe("Part P — the worker's job", () => {
  it("carries BOTH lenses' curves whichever one the table describes", () => {
    const out = runBudget({
      spec: { ...SPEC, lens: "achromat" },
      budgetScale: 1e-2,
      pupilSamples: SAMPLES,
      scales: [1e-3, 1e-2, 1e-1],
    });
    expect(out.sheet.lens).toBe("achromat");
    expect(out.sweeps.map((s) => s.lens)).toEqual(["apochromat", "achromat"]);
    for (const s of out.sweeps) expect(s.points).toHaveLength(3);
    // The pair the plot draws: one below one, one above it, at the same budget.
    const at = (lens: SheetLens) =>
      out.sweeps.find((s) => s.lens === lens)!.points.find((p) => p.budgetScale === 1e-2)!
        .couplingRatio!;
    expect(at("apochromat")).toBeLessThan(1);
    expect(at("achromat")).toBeGreaterThan(1);
  });
});

const APERTURES = [10, 20, 40] as const;
const RATIOS = [4, 6, 10] as const;

describe("Part P — every configuration the panel offers answers, or refuses in a way it can draw", () => {
  it("no combination of the three controls throws", () => {
    // The worker posts one message and has no catch, so a constructor that
    // refused at some aperture or focal ratio would leave the panel dimmed for
    // ever with nothing on screen to say why — the one failure the per-row
    // refusal handling exists to prevent. Eighteen sheets, and the assertion is
    // that a sheet comes back at all.
    for (const lens of ["apochromat", "achromat"] as SheetLens[]) {
      for (const apertureMm of APERTURES) {
        for (const focalRatio of RATIOS) {
          const sheet = sheetAt(prepareSheet({ lens, apertureMm, focalRatio }, 11), 1);
          expect(sheet.rows.length, `${lens} ${apertureMm} f/${focalRatio}`).toBe(
            3 * sheet.surfaces - 1,
          );
          // At a full budget five of the eighteen cannot take the combined
          // trace — the allowance perturbs the lens past what the tracer can
          // follow. That is a `drawing: null` with a reason, never an exception.
          if (sheet.drawing === null) expect(sheet.refusal).not.toBe("");
        }
      }
    }
  });
});

describe("Part P — how far the headline travels, which is not everywhere", () => {
  /** Coupling in the flat region, where the extrapolation still holds. */
  const flat = (lens: SheetLens, apertureMm: number, focalRatio: number): number =>
    sheetAt(prepareSheet({ lens, apertureMm, focalRatio }, 21), 1e-2).drawing!.couplingRatio;

  it("the triplet's rows cancel in ALL NINE configurations", () => {
    // The robust half. Between 0.27 and 0.75, never once above one.
    const all = APERTURES.flatMap((a) => RATIOS.map((f) => flat("apochromat", a, f)));
    for (const c of all) expect(c).toBeLessThan(1);
    expect(Math.max(...all)).toBeLessThan(0.75);
    expect(Math.min(...all)).toBeGreaterThan(0.26);
  });

  it("...and the doublet's reinforce in seven of nine, and TURN OVER in two", () => {
    // The half that does not travel, and the reason this rung exists: the
    // panel's headline is measured at the ladder's own fixture, and a reader
    // who moves the focal-ratio control can walk out of it. At f/4 and f/6 the
    // doublet is above one at every aperture; at f/10 the two smaller apertures
    // fall below it. "Opposite sides of one" is a statement about a PAIR of
    // lenses at a configuration, not a law about doublets.
    for (const a of APERTURES) {
      for (const f of [4, 6] as const) expect(flat("achromat", a, f), `${a} f/${f}`).toBeGreaterThan(1);
    }
    expect(flat("achromat", 40, 10)).toBeGreaterThan(1);
    expect(flat("achromat", 10, 10)).toBeLessThan(1);
    expect(flat("achromat", 20, 10)).toBeLessThan(1);
  });

  it("the currency spread is always wider on the triplet, but not by 26× everywhere", () => {
    // Same shape a third time. At the ladder's fixture the triplet spreads to
    // 25.9× and the doublet to 2.6×; over the whole grid the triplet reaches
    // 133× and the doublet 11.6×, so the ORDERING is robust and the numbers are
    // not. APP.md's Part P quotes the fixture's pair and says which is which.
    const widest = (lens: SheetLens, a: number, f: number): number =>
      Math.max(
        ...sheetAt(prepareSheet({ lens, apertureMm: a, focalRatio: f }, 21), 1e-2)
          .rows.filter((r) => r.colourPerUnit > 0)
          .map((r) => r.bindsBy),
      );
    for (const a of APERTURES) {
      for (const f of RATIOS) {
        expect(widest("apochromat", a, f), `${a} f/${f}`).toBeGreaterThan(widest("achromat", a, f));
      }
    }
    expect(widest("apochromat", 10, 10)).toBeGreaterThan(100);
    expect(widest("achromat", 10, 10)).toBeLessThan(15);
  });
});

describe("Part P — why the sheet does not use § 6au.7's grouping", () => {
  it("that grouping spends the blur budget twice, by 1.04×", () => {
    // The claim `budget.ts` makes in prose and APP.md repeats, pinned. § 6au.7
    // divides colour over the seven rows it can SEE and blur over the four it
    // cannot; assembled and traced, the result costs more blur than it allowed,
    // because the seven colour-allocated rows spend blur too and no share was
    // ever set aside for them. This sheet divides each currency over every row
    // and quotes the tighter, which keeps both budgets true.
    const ctx = prepareSheet({ ...SPEC, lens: "apochromat" }, SAMPLES);
    const rows = ctx.build.parameters as ToleranceParameter[];
    const scale = 1e-2;
    const sees = ctx.slopes.map((s) => s.colour > 0);
    expect(sees.filter(Boolean)).toHaveLength(7);
    const co = allocateEqualShare(
      ctx.build.system,
      rows.filter((_, i) => sees[i]),
      ctx.build.nominalColour * scale,
      ctx.opts,
      ctx.colour,
    );
    const bl = allocateEqualShare(
      ctx.build.system,
      rows.filter((_, i) => !sees[i]),
      MARECHAL_WAVES * scale,
      ctx.opts,
    );
    let ci = 0;
    let bi = 0;
    const groups = rows.map((p, i) =>
      p.at(sees[i] ? co.rows[ci++]!.allowance : bl.rows[bi++]!.allowance),
    );
    const all = toleranceBudget(ctx.build.system, groups, ctx.opts);
    expect(all.combinedWaves / (MARECHAL_WAVES * scale)).toBeCloseTo(1.04, 2);

    // …and of that, the four rows the blur share WAS divided among contribute
    // 4.4e−6 waves against the seven it was not, at 7.4e−4. Quoted as the two
    // measurements rather than as a percentage: they combine in quadrature, so a
    // linear share of them is not a share of anything.
    const colourAllocated = toleranceBudget(
      ctx.build.system,
      groups.filter((_, i) => sees[i]),
      ctx.opts,
    );
    const blurAllocated = toleranceBudget(
      ctx.build.system,
      groups.filter((_, i) => !sees[i]),
      ctx.opts,
    );
    expect(colourAllocated.combinedWaves).toBeCloseTo(7.42e-4, 5);
    expect(blurAllocated.combinedWaves).toBeCloseTo(4.4e-6, 6);

    // The sheet's own grouping, for contrast: both budgets met, neither over.
    const sheet = sheetAt(ctx, scale);
    expect(sheet.drawing!.combinedWaves).toBeLessThan(MARECHAL_WAVES * scale);
  });
});
