import { useMemo, useState } from "react";
import { Plot, type PlotMarker, type PlotSeries } from "../plot";
import {
  DESIGN_LINES,
  DESIGN_SEEDS,
  defaultSpec,
  describeDesign,
  equiconvexVertex,
  seedById,
  type DesignCurvePoint,
  type DesignSeedId,
  type DesignSpec,
  type TargetKind,
} from "../design";
import { Choice, Fact, Fieldset, Guard, NumberField, num } from "../ui";
import { refusalVoice } from "../refusal";

/**
 * Design mode: the panel that asks the engine what a number has to be.
 *
 * Every other surface in this app is a readout — here is a lens, here is what it
 * does. This one runs the other way, which is the whole of ROADMAP's v2+
 * design-mode entry that has landed: state a first-order property, name one
 * number the design may move, and `core/analysis/solve` returns the value that
 * number must take.
 *
 * Runs inline and on every keystroke, on `mtf.tsx`'s precedent taken to its
 * limit: the entire readout — a 241-point curve, the solve, the same solve again
 * at four times the scan resolution, and two control solves — is **0.7–1.9 ms**
 * in the browser and 0.75 ms in a tight loop with nothing else running.
 * There is no worker here and there is nothing to progressively refine; the
 * elapsed readout is at the bottom because it is the least interesting number on
 * the page, which is itself the finding about first-order targets.
 *
 * ## Two plots, because the pole is only in one of them
 *
 * The left plot is the quantity the solver actually roots on — the POWER for a
 * focal-length target — and the right one is the focal length itself. They are
 * the same solve. A system whose power passes through zero has a power plot that
 * crosses the axis once, tidily, and a focal-length plot that runs to +∞,
 * reappears at −∞, and crosses every finite target on the way. That difference
 * is § 1.7's whole reason for solving an `efl` target as a power target, and it
 * is a picture rather than a paragraph.
 *
 * Both plots are cut where the system goes afocal rather than being drawn
 * through it: a polyline that connects +∞ to −∞ draws a vertical line at a place
 * where the lens has no focal length at all.
 */

const SCAN_CELLS = [8, 16, 32, 64, 256] as const;
const CURVE_SAMPLES = 241;

/** A run of consecutive samples with no afocal crossing and no wall inside it. */
interface Branch {
  readonly points: readonly DesignCurvePoint[];
}

/**
 * Split the sampled curve where the system passes through afocal, or where it
 * stopped being a system at all.
 *
 * The rule is one rule for both plots: the power's sign change is where the
 * focal length's pole is, so cutting there is cutting at the same physical event
 * in both currencies.
 */
function branchesOf(curve: readonly DesignCurvePoint[]): readonly Branch[] {
  const out: DesignCurvePoint[][] = [];
  let current: DesignCurvePoint[] = [];
  let lastPower: number | null = null;
  for (const point of curve) {
    if (!point.finite) {
      if (current.length > 0) out.push(current);
      current = [];
      lastPower = null;
      continue;
    }
    const power = 1 / point.eflMm;
    if (lastPower !== null && lastPower !== 0 && power !== 0 && lastPower > 0 !== power > 0) {
      out.push(current);
      current = [];
    }
    current.push(point);
    lastPower = power;
  }
  if (current.length > 0) out.push(current);
  return out.map((points) => ({ points }));
}

/**
 * The window a plot is scaled to: the branch being solved on, plus the target.
 *
 * **Full range is the rule and the tail is the exception, and it has to be that
 * way round.** A branch that ends at a pole runs to tens of thousands of
 * millimetres in its last few samples, so scaling to min/max squashes the target
 * and the root into the bottom pixel row — the first draft of this panel drew
 * exactly that. But cropping every curve to its middle would throw away the ends
 * of the power plot, which is a straight line and has no tail to crop. So the
 * heavy tail is *detected*: when the full range is more than eight times the
 * middle 80% of it, the window is built from that middle instead and the
 * asymptote runs off the top, clipped by the plot's own frame, which is what an
 * asymptote should look like.
 */
function windowFor(
  branches: readonly Branch[],
  valueOf: (point: DesignCurvePoint) => number,
  focusX: number,
  target: number | null,
): readonly [number, number] {
  let best: Branch | null = null;
  let bestDistance = Infinity;
  for (const branch of branches) {
    for (const point of branch.points) {
      const d = Math.abs(point.x - focusX);
      if (d < bestDistance) {
        bestDistance = d;
        best = branch;
      }
    }
  }
  const values = (best?.points ?? [])
    .map(valueOf)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (values.length === 0) return [0, 1];
  const at = (q: number) => values[Math.min(values.length - 1, Math.round(q * (values.length - 1)))]!;
  let lo = values[0]!;
  let hi = values[values.length - 1]!;
  const core = at(0.9) - at(0.1);
  if (core > 0 && hi - lo > 8 * core) {
    lo = at(0.1) - core;
    hi = at(0.9) + core;
  }
  if (target !== null && Number.isFinite(target)) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  if (hi === lo) {
    hi = lo + Math.max(1e-9, Math.abs(lo) * 0.1);
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

const seriesFrom = (
  branches: readonly Branch[],
  valueOf: (point: DesignCurvePoint) => number,
  color: string,
  label: string,
): PlotSeries[] =>
  branches.map((branch, i) => ({
    label: i === 0 ? label : `${label} — branch ${i + 1}`,
    color,
    width: 1.8,
    points: branch.points.map((p) => [p.x, valueOf(p)] as const),
  }));

export function DesignPanel() {
  const [spec, setSpec] = useState<DesignSpec>(defaultSpec);

  /** Changing the seed or the variable re-states the interval, because the
   *  interval belongs to the variable and a stale one is a search in the wrong
   *  place — which the solver reports as "unreachable", indistinguishable from a
   *  target the lens cannot make. */
  const pickSeed = (id: DesignSeedId) => {
    const seed = seedById(id);
    const option = seed.options[seed.defaultOption]!;
    setSpec((s) => ({
      ...s,
      seed: id,
      option: seed.defaultOption,
      target: seed.defaultTarget,
      interval: option.interval,
      preferNear: (option.interval[0] + option.interval[1]) / 2,
    }));
  };
  const pickOption = (index: number) => {
    const seed = seedById(spec.seed);
    const option = seed.options[index]!;
    setSpec((s) => ({
      ...s,
      option: index,
      interval: option.interval,
      preferNear: (option.interval[0] + option.interval[1]) / 2,
    }));
  };
  const patch = (part: Partial<DesignSpec>) => setSpec((s) => ({ ...s, ...part }));

  const seed = seedById(spec.seed);
  const result = useMemo(() => describeDesign({ ...spec, curveSamples: CURVE_SAMPLES }), [spec]);

  if (!result.ok) {
    return (
      <>
        <h1 style={{ fontSize: 20 }}>Design mode: what does this number have to be?</h1>
        <Controls spec={spec} pickSeed={pickSeed} pickOption={pickOption} patch={patch} />
        <p style={{ color: "var(--bad)", maxWidth: 640, fontFamily: "var(--mono)", fontSize: 13 }}>
          {refusalVoice(result.source, "this question")}: {result.error}
        </p>
      </>
    );
  }

  const { option, curve, solution, naive, afocal } = result;
  const solved = "x" in solution ? solution : null;
  const refusal = "x" in solution ? null : solution;
  const isCurvature = option.variable.kind !== "thickness";
  const walls = curve.filter((p) => !p.finite).length;
  const branches = branchesOf(curve);
  const focusX = solved?.x ?? spec.preferNear;

  const solvedTarget = spec.target.kind === "efl" ? 1 / spec.target.value : spec.target.value;
  const solvedWindow = windowFor(branches, (p) => p.solved, focusX, solvedTarget);
  const eflWindow = windowFor(
    branches,
    (p) => p.eflMm,
    focusX,
    spec.target.kind === "efl" ? spec.target.value : null,
  );

  const rootMarkers: PlotMarker[] = (solved?.roots ?? []).map((r) => ({
    x: r.x,
    color: "var(--green)",
    label: "root",
  }));

  const vertex = spec.seed === "equiconvex" ? equiconvexVertex(spec.wavelengthNm) : null;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>Design mode: what does this number have to be?</h1>
      <p style={{ maxWidth: 680, color: "var(--ink-2)" }}>
        Every other page here takes a lens and says what it does. This one runs the other way. Name a
        first-order property you want and one number the design is allowed to move, and the engine
        returns the value that number has to take — a <em>root</em>, not a minimum, which is why it
        is a different solver from the focus solve every imaging panel already uses. It is the half
        of design mode that has landed; the other half moves several numbers at once and is waiting
        on a merit whose answer is known in closed form, because a test that says only &ldquo;it
        converged&rdquo; is regression rather than validation.
      </p>

      <Controls spec={spec} pickSeed={pickSeed} pickOption={pickOption} patch={patch} />
      <p style={{ maxWidth: 680, color: "var(--ink-3)", fontSize: 13, marginTop: -4 }}>
        <strong>{seed.label}</strong> — {seed.note}
      </p>

      {solved ? (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 15,
            padding: "10px 14px",
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
            display: "inline-block",
            marginBottom: 14,
          }}
        >
          {option.label} ={" "}
          <strong style={{ fontSize: 18 }}>{solved.x.toPrecision(10)}</strong> {option.unit}
          {isCurvature && (
            <span style={{ color: "var(--ink-3)" }}>
              {"  →  R = "}
              {solved.roots.find((r) => r.x === solved.x)?.radiusMm?.toFixed(4) ?? "—"} mm
            </span>
          )}
          <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 4 }}>
            was {solved.valueFrom.toPrecision(9)} {option.unit} — the solve returns the value, it
            does not hand back a lens
          </div>
        </div>
      ) : (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            padding: "10px 14px",
            border: "1px solid var(--bad)",
            color: "var(--bad)",
            maxWidth: 680,
            marginBottom: 14,
          }}
        >
          {refusalVoice(refusal!.source, "this target")}: {refusal!.error}
          <div style={{ color: "var(--ink-4)", marginTop: 6 }}>
            A refusal here is a reading, not an error page — and the plots below still draw, because
            the picture is what says whether the target is out of the variable&rsquo;s range or the
            interval was in the wrong place.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Plot
          series={seriesFrom(
            branches,
            (p) => p.solved,
            "var(--red)",
            spec.target.kind === "efl" ? "power, 1/f" : "back focal distance",
          )}
          markers={[
            { y: solvedTarget, color: "var(--ink-4)", label: "target" },
            ...rootMarkers,
          ]}
          xLabel={`${option.label} (${option.unit})`}
          yLabel={spec.target.kind === "efl" ? "power (1/mm)" : "BFD (mm)"}
          xMin={spec.interval[0]}
          xMax={spec.interval[1]}
          yMin={solvedWindow[0]}
          yMax={solvedWindow[1]}
          width={430}
        />
        <Plot
          series={seriesFrom(branches, (p) => p.eflMm, "var(--blue)", "focal length")}
          markers={
            spec.target.kind === "efl"
              ? [{ y: spec.target.value, color: "var(--ink-4)", label: "target" }, ...rootMarkers]
              : rootMarkers
          }
          xLabel={`${option.label} (${option.unit})`}
          yLabel="focal length (mm)"
          xMin={spec.interval[0]}
          xMax={spec.interval[1]}
          yMin={eflWindow[0]}
          yMax={eflWindow[1]}
          width={430}
        />
      </div>
      <p style={{ maxWidth: 880, color: "var(--ink-3)", fontSize: 13 }}>
        The same solve in two currencies. The left plot is what the solver actually roots on — for a
        focal-length target that is the <em>power</em>, 1/f, which is a straight line in any single
        curvature or thickness. The right plot is the focal length you asked for, and it is where a
        pole lives: where the power crosses zero the focal length runs off both ends of the axis and
        crosses every finite target on the way, at a place that is not a lens of that focal length.
        Both curves are cut there rather than drawn through it.
        {branches.length > 1 &&
          ` This interval contains ${branches.length - 1} such crossing${branches.length > 2 ? "s" : ""}, so the curve is drawn in ${branches.length} pieces.`}
      </p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Exact — and the exactness is in the power</h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 14 }}>
        The paraxial system matrix is a product of refraction and translation factors, so it is
        affine in any one curvature or any one thickness — and so is the power. Brent&rsquo;s first
        interpolation step lands on the root of a straight line exactly. What you can read below is
        that the answer is exact and the <em>millimetres</em> are not: |Δf| = f²·|ΔP| turns one ulp
        of power into 5.7e-14 mm at 400 mm and 2.3e-13 mm at 1000 mm, so a residual that moves with
        the target is the unit moving, not the solve.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Fact
          label="residual, in the target's units"
          value={solved ? `${solved.residualMm} mm` : "—"}
          note="value − target, as the caller asked it"
        />
        <Fact
          label="residual, in the units solved"
          value={
            solved
              ? spec.target.kind === "efl"
                ? `${solved.residualPower} /mm`
                : "same as above"
              : "—"
          }
          note={
            spec.target.kind === "efl"
              ? "1/f against 1/target — zero, or one ulp of a number near 0.002"
              : "a BFD target is solved in millimetres directly; there is no reciprocal to take"
          }
        />
        <Fact
          label="evaluations past the scan"
          value={solved ? String(solved.beyondTheScan) : "—"}
          note={`the scan itself is ${spec.scanCells + 1} evaluations whatever is being solved. What follows is the refinement and the candidate checks: an affine target needs one interpolation, a rational one iterates`}
        />
        {naive !== null && (
          <Guard
            label="the same question asked straight at the focal length"
            value={
              naive.verdict === "refused"
                ? "refused"
                : naive.evaluations !== null
                  ? `${naive.evaluations - spec.scanCells - 1} evaluations past the scan`
                  : "—"
            }
            level={naive.verdict === "different" ? "bad" : "ok"}
            detail={
              naive.verdict === "refused"
                ? `and it refuses for a different reason than the solve above did — quoted under "where this goes afocal" below. ${naive.message ?? ""}`
                : naive.verdict === "same"
                  ? "it lands on the same lens: the guard inside the solver re-checks every candidate at its own x, so a pole is discarded rather than returned. What differs is the work — f is not affine in anything, so the root finder has to iterate for an answer the power gives in one step"
                  : "the two routes disagree about the answer, which they should never do — one of them is returning a pole"
            }
          />
        )}
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>
        One root — unless two numbers move together
      </h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 14 }}>
        The solver reports <em>every</em> root in the interval, so that a target reachable two ways
        is never silently resolved one way. Through a single prescription number it never has to:
        the power is affine in it and the back focal distance is a ratio of two affine functions, so
        both have exactly one root — measured over every surface and both variables on the three
        lenses above. Multiplicity needs a constraint across two surfaces, which the engine&rsquo;s
        variable type deliberately cannot express; the equiconvex seed supplies one as a closure and
        the power becomes a parabola with a vertex, so there is a shortest achievable focal length
        and two ways to reach anything longer.
      </p>
      <table style={{ fontFamily: "var(--mono)", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--ink-4)", textAlign: "left" }}>
            <th style={CELL}>root</th>
            <th style={CELL}>{option.unit}</th>
            {isCurvature && <th style={CELL}>R (mm)</th>}
            <th style={CELL}>EFL (mm)</th>
            <th style={CELL}>BFD (mm)</th>
            {isCurvature && <th style={CELL}>|R| / rim</th>}
          </tr>
        </thead>
        <tbody>
          {(solved?.roots ?? []).map((r, i) => (
            <tr key={r.x} style={{ background: solved && r.x === solved.x ? "var(--ok-tint)" : undefined }}>
              <td style={CELL}>{i + 1}</td>
              <td style={CELL}>{r.x.toPrecision(9)}</td>
              {isCurvature && <td style={CELL}>{r.radiusMm === null ? "—" : r.radiusMm.toPrecision(8)}</td>}
              <td style={CELL}>{r.eflMm.toPrecision(9)}</td>
              <td style={CELL}>{r.bfdMm.toPrecision(9)}</td>
              {isCurvature && (
                <td style={{ ...CELL, color: (r.rimRatio ?? 9) < 1 ? "var(--bad)" : "var(--ink)" }}>
                  {r.rimRatio === null ? "—" : r.rimRatio.toFixed(3)}
                </td>
              )}
            </tr>
          ))}
          {solved === null && (
            <tr>
              <td style={CELL} colSpan={6}>
                no roots — see the refusal above
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {solved !== null && solved.roots.length > 1 && (
        <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 13 }}>
          Two lenses, one focal length — and their back focal distances are{" "}
          <strong>equal and opposite</strong>, which is not a coincidence and is worth the algebra:
          BFD = f(1 − (d/n)(n−1)c), the two roots are symmetric about the parabola&rsquo;s vertex
          c* = n/(d(n−1)), and (d/n)(n−1)·2c* is exactly 2, so the two cancel. One of the pair puts
          its focus behind its own last surface. &ldquo;Reachable two ways&rdquo; is a design
          statement rather than a curiosity: only one of the two is something you can put a sensor
          behind. Which one this panel returns is decided by <em>prefer the root near</em> and by
          nothing else — the interval and the roots are unchanged by it.
        </p>
      )}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 8 }}>
        <Guard
          label={`roots at ${result.finerScanCells} cells`}
          value={result.rootsAtFinerScan < 0 ? "still none" : String(result.rootsAtFinerScan)}
          level={
            result.rootsAtFinerScan > (solved?.roots.length ?? 0) ? "bad" : "ok"
          }
          detail={
            result.rootsAtFinerScan > (solved?.roots.length ?? 0)
              ? `this scan resolution is hiding a root. A cell holding an EVEN number of roots shows no sign change across it, so a pair closer together than one cell is stepped over as if it were not there — and what that looks like from outside is not a wrong answer but a refusal, at a resolution the message names. Four times finer finds ${result.rootsAtFinerScan}.`
              : "the same answer four times finer, so the scan is resolving what is there. This is the only check on a blindness that is otherwise silent"
          }
        />
        {vertex !== null && (
          <Fact
            label="shortest focal length this family can make"
            value={`${vertex.shortestFocalMm.toFixed(6)} mm`}
            note={`at c = ${vertex.curvature.toFixed(9)} /mm, from the parabola's vertex — ask for anything shorter and the refusal names how close the scan came`}
          />
        )}
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>The solve holds at exactly one wavelength</h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 14 }}>
        Every index in the chain is dispersive, so &ldquo;make the focal length 510 mm&rdquo; is a
        different equation at F than at C. The answer is a design value at the line it was solved on
        and nowhere else — and how far the other lines miss by is the lens&rsquo;s colour correction,
        measured rather than claimed.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <table style={{ fontFamily: "var(--mono)", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--ink-4)", textAlign: "left" }}>
              <th style={CELL}>line</th>
              <th style={CELL}>EFL (mm)</th>
              <th style={CELL}>BFD (mm)</th>
            </tr>
          </thead>
          <tbody>
            {(solved?.lines ?? []).map((l) => (
              <tr key={l.nm} style={{ background: l.nm === spec.wavelengthNm ? "var(--ok-tint)" : undefined }}>
                <td style={CELL}>{l.name}</td>
                <td style={CELL}>{l.eflMm.toFixed(4)}</td>
                <td style={CELL}>{l.bfdMm.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Fact
          label="worst miss at the other two lines"
          value={solved ? `${num(solved.worstOtherLineMm, 4)} mm` : "—"}
          note="the same property, at the colours the solve was not asked about. On the shipped achromat this is 0.341 mm and on the singlet of the same power 5.438 mm — a factor of 16, which is the correction doing its job"
        />
        <Guard
          label="F−C focal spread, after ÷ before"
          value={
            solved && solved.spreadBeforeMm !== 0
              ? `×${(solved.spreadAfterMm / solved.spreadBeforeMm).toFixed(2)}`
              : "—"
          }
          level={
            solved && solved.spreadBeforeMm !== 0
              ? Math.abs(solved.spreadAfterMm / solved.spreadBeforeMm) > 2
                ? "bad"
                : Math.abs(solved.spreadAfterMm / solved.spreadBeforeMm) > 1.3
                  ? "warn"
                  : "ok"
              : "ok"
          }
          detail={
            solved
              ? `${num(solved.spreadBeforeMm, 5)} mm → ${num(solved.spreadAfterMm, 5)} mm. A colour correction is a BALANCE between the elements, and one curvature is enough to spend it: retargeting the shipped achromat to 400 mm through its crown costs 29× of this number and to 600 mm costs 42× with the sign reversed, through the flint's inner face 158× and 240×. The same moves on the singlet change it by 0.8× and 1.2×, because a singlet has no balance to lose. The corrected lens is the fragile one — which is the argument for moving several numbers at once, and that is the half of design mode still waiting on a pin.`
              : ""
          }
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>A number, not a lens</h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 14 }}>
        The solver answers the question it was asked. Whether the answer is a piece of glass is a
        question nothing in the solve asks — so the two cheapest ways to notice are here, computed
        from the prescription&rsquo;s own numbers rather than from anything the solve returned.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Guard
          label="glass thickness returned"
          value={solved ? (solved.roots.some((r) => r.negativeGlass) ? "negative" : "positive") : "—"}
          level={solved?.roots.some((r) => r.negativeGlass) ? "bad" : "ok"}
          detail={
            solved?.roots.some((r) => r.negativeGlass)
              ? "a correct root of the equation and not an element: asking the shipped achromat for a 500 mm back focus through its crown's thickness returns −0.899 mm of N-BK7, and 506.5 mm returns −8.284 mm. The reachable half of that variable stops at about 498.77 mm of back focus, where the crown reaches 0.5 mm — and zero is not a wall the solver can see, because nothing in a paraxial trace objects to negative glass"
              : "the element this answer names has a positive axial thickness"
          }
        />
        {isCurvature && (
          <Guard
            label="smallest |R| ÷ its own clear semi-aperture"
            value={
              solved && solved.roots.length > 0
                ? Math.min(...solved.roots.map((r) => r.rimRatio ?? Infinity)).toFixed(3)
                : "—"
            }
            level={
              solved && solved.roots.some((r) => (r.rimRatio ?? 9) < 1)
                ? "bad"
                : solved && solved.roots.some((r) => (r.rimRatio ?? 9) < 2)
                  ? "warn"
                  : "ok"
            }
            detail="below 1 the sphere is smaller than the rim it would have to carry, so the curvature the solver returned is not a surface at all. Both roots of the equiconvex fixture fail it at that fixture's own 10 mm semi-aperture — which is what a solver fixture looks like when you ask it to be a lens"
          />
        )}
        <Fact
          label="property at the interval's ends"
          value={`${num(result.rangeLoMm, 4)} … ${num(result.rangeHiMm, 4)}`}
          note="what this variable can deliver at the two ends of where you told the solver to look. The interval is stated, never expanded — only the caller knows which values are a lens rather than an arithmetic possibility"
        />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Where this system goes afocal</h2>
      <p style={{ maxWidth: 680, color: "var(--ink-2)", fontSize: 14 }}>
        &ldquo;Which value makes the power zero?&rdquo; is an ordinary design question with an exact
        answer, and it is the one question this solver cannot return. The engine has no first-order
        properties for an afocal chain, so it throws — and the module treats a throw as a{" "}
        <em>wall</em>, a region that is not a system, rather than letting it manufacture a crossing.
        A scan meets that wall with probability zero. A refinement aimed at it meets it with
        probability one, because the wall <em>is</em> the root it is converging to — and the two
        widths say so. The engine throws at |u| &lt; 1e-15 and u is −1/f, so the hole is exactly
        where |1/f| &lt; 1e-15: on the air-spaced seed that is <strong>5.6e-12 mm</strong> of gap,
        measured edge to edge, against a refinement that narrows to 2.1e-13 mm — 26 times finer, so
        its last bracket fits inside the hole. The answer arrives as a refusal that names the place.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Guard
          label="asked for the afocal value, the engine"
          value={afocal.refused ? "refuses" : `returns ${afocal.x?.toPrecision(9) ?? "—"}`}
          level={afocal.refused ? "warn" : "ok"}
          detail={afocal.message ?? "no crossing of zero power inside this interval"}
        />
        <Fact
          label="this panel's own bracket on it"
          value={
            afocal.bracket
              ? `${afocal.bracket[0].toPrecision(8)} … ${afocal.bracket[1].toPrecision(8)}`
              : "none in the interval"
          }
          note="read off the 241 curve samples above, at the curve's resolution and not at the solver's — the panel does not parse the sentence beside it"
        />
        <Fact
          label="samples that are not a system"
          value={String(walls)}
          note="curve points where the engine refused outright. A wall is drawn as a gap, never bridged"
        />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 24 }}>
        <Fact
          label="elapsed"
          value={`${result.elapsedMs.toFixed(2)} ms`}
          note={`a ${CURVE_SAMPLES}-point curve, the solve, the same solve again at ${result.finerScanCells} cells, and two control solves — 0.7 to 1.9 ms in this browser and 0.75 ms in a tight loop off-screen, four orders under a traced panel. Everything here is a paraxial trace; a target on a traced quantity, an RMS spot or a Zernike term, changes that cost model completely and wants a different search than a full scan`}
        />
        <Fact
          label="what pins the machinery"
          value="VALIDATION § 1.7"
          note="Gullstrand's thick-lens equation INVERTED in closed form, so every rung compares the solver against an algebraic expression for the same root rather than against what it converged to last time"
        />
      </div>
    </>
  );
}

const CELL = { padding: "2px 10px 2px 0", borderBottom: "1px solid var(--line-2)" } as const;

function Controls(props: {
  spec: DesignSpec;
  pickSeed: (id: DesignSeedId) => void;
  pickOption: (index: number) => void;
  patch: (part: Partial<DesignSpec>) => void;
}) {
  const { spec, patch } = props;
  const seed = seedById(spec.seed);
  return (
    <>
      <Fieldset title="the lens">
        <Choice
          label="seed"
          options={DESIGN_SEEDS.map((s) => s.id)}
          value={spec.seed}
          onChange={props.pickSeed}
          format={(id) => seedById(id).label}
        />
      </Fieldset>
      <Fieldset title="the question">
        <Choice
          label="move"
          options={seed.options.map((_, i) => i)}
          value={spec.option}
          onChange={props.pickOption}
          format={(i) => seed.options[i]!.label}
        />
        <Choice
          label="until"
          options={["efl", "bfd"] as const}
          value={spec.target.kind}
          onChange={(kind: TargetKind) => patch({ target: { ...spec.target, kind } })}
          format={(kind) => (kind === "efl" ? "focal length" : "back focus")}
        />
        <NumberField
          label="equals (mm)"
          value={spec.target.value}
          onChange={(value) => patch({ target: { ...spec.target, value } })}
        />
        <Choice
          label="at"
          options={DESIGN_LINES.map((l) => l.nm)}
          value={spec.wavelengthNm}
          onChange={(wavelengthNm) => patch({ wavelengthNm })}
          format={(nm) => DESIGN_LINES.find((l) => l.nm === nm)!.name}
        />
      </Fieldset>
      <Fieldset title="where to look — stated by the caller, never expanded by the solver">
        <NumberField
          label="from"
          value={spec.interval[0]}
          onChange={(lo) => patch({ interval: [lo, spec.interval[1]] })}
        />
        <NumberField
          label="to"
          value={spec.interval[1]}
          onChange={(hi) => patch({ interval: [spec.interval[0], hi] })}
        />
        <NumberField
          label="prefer the root near"
          value={spec.preferNear}
          onChange={(preferNear) => patch({ preferNear })}
        />
        <Choice
          label="scan cells"
          options={SCAN_CELLS}
          value={spec.scanCells as (typeof SCAN_CELLS)[number]}
          onChange={(scanCells) => patch({ scanCells })}
        />
      </Fieldset>
      {!seed.intervalsAreFixtures && (
        <p style={{ maxWidth: 680, color: "var(--ink-5)", fontSize: 12, marginTop: -6 }}>
          This seed&rsquo;s interval is <em>this panel&rsquo;s</em> guess — three times the value the
          design already has, either side of it — and not a physical statement. The two fixtures
          borrowed from the validation ladder carry that step&rsquo;s own intervals instead.
        </p>
      )}
    </>
  );
}
