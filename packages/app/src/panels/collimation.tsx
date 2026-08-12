import { useMemo, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import {
  MISALIGN_UNIT,
  surfaceCount,
  type CollimationResult,
  type CollimationSpec,
  type MisalignKind,
  type StopPlace,
} from "../collimation";
import { Choice, Fact, Fieldset, Guard, Slider, num, thresholdLevel } from "../ui";
import { createCollimationWorker } from "../workers";
import type { LensKind } from "../render";

/**
 * Collimation — the coma node, and where a misalignment sends it.
 *
 * ROADMAP step 7's misalignment scenarios, and the surface § 1.5.3 exists for.
 * The teaching is one sentence: a collimated instrument's coma vanishes where you
 * are pointing, and a decollimated one's vanishes somewhere else. Everything on
 * screen serves making that displacement a number rather than an impression.
 *
 * ## Three curves, and the third is about the engine rather than the optics
 *
 * `aligned` and `misaligned` are the physics. The third — the same misaligned
 * system under § 1.5.3's OLD aiming — is on screen because it is the only way to
 * show what that step bought, and because what it shows depends on a control the
 * reader can move. A misalignment carries every surface AFTER it, so it moves the
 * stop only when the stop is downstream: with the stop on the front element's rim
 * (a refractor) nothing the old aim pointed at moves and the curves nearly
 * coincide; move the stop behind the doublet (a photographic objective) and they
 * separate. **The control that changes the answer is `stop`, not the size of the
 * misalignment**, which is not what a reader would guess.
 *
 * ## Two things stated on screen because both are findings
 *
 * The coma comes from a fit with piston, tilt and defocus projected out — § 1.5.3
 * measured a rigidly turned instrument, which cannot have changed, moving ~1e-2
 * waves in `OpdMap.rmsWaves` and 4.6e-5 in the balanced currency, so a raw curve
 * would draw a misalignment on an instrument that has none.
 *
 * And coma is a VECTOR whose node is a POINT, so a sweep along one line meets the
 * node only when the misalignment lies in that line's plane. Pick an out-of-plane
 * kind and the panel says the node has left the axis instead of quoting the
 * crossing it happens to draw.
 *
 * ## What it refuses
 *
 * A lost ray makes the fit an average over a shrinking sub-pupil, which falls as
 * the perturbation grows and would read as the image IMPROVING. Past that point
 * the panel prints the refusal instead of the curves' headline, which is A3's
 * rule and the one this repo keeps reaching for. A node that has left the sweep
 * entirely is reported as that rather than as a NaN.
 */

const LENSES: readonly LensKind[] = ["achromat", "singlet"];
const KINDS: readonly MisalignKind[] = ["tiltY", "tiltX", "decenterY", "decenterX"];
const STOPS: readonly StopPlace[] = ["front", "rear"];

const KIND_LABEL: Record<MisalignKind, string> = {
  tiltY: "tilt about y",
  tiltX: "tilt about x",
  decenterY: "shift in y",
  decenterX: "shift in x",
};

const STOP_LABEL: Record<StopPlace, string> = {
  front: "front element's rim",
  rear: "behind the doublet",
};

/** Full-scale for the slider, in the target's own unit. */
const FULL_SCALE: Record<MisalignKind, number> = {
  tiltY: 1,
  tiltX: 1,
  decenterY: 0.5,
  decenterX: 0.5,
};

export function CollimationPanel() {
  const [lens, setLens] = useState<LensKind>("achromat");
  const [stop, setStop] = useState<StopPlace>("rear");
  const [surface, setSurface] = useState(1);
  // A shift of the cemented interface, seen over a narrow field, and both
  // defaults are measurements rather than taste. Surface 1 is the achromat's
  // only genuinely INTERIOR surface — tilting surface 0 re-points the whole
  // instrument and surface 2 drags the image plane with it — and it is also the
  // least sensitive one, which is why the default perturbation is a shift rather
  // than a tilt: on this doublet a shift moves the node ~4× further per unit of
  // the slider. The field half-width is then set so that the displacement is a
  // visible fraction of the sweep instead of 1% of it, which is what the first
  // draft's ±0.5° showed: a picture in which the headline was invisible.
  // IN-PLANE, and that is not a detail: the field sweeps along x, so only a
  // misalignment with an x component moves the coma node onto this line. The
  // out-of-plane kinds are offered, and when one is picked the panel says the
  // node has left the axis rather than pretending the crossing it draws is one.
  const [kind, setKind] = useState<MisalignKind>("decenterX");
  const [fraction, setFraction] = useState(0.15);
  const [fieldHalfDeg, setFieldHalfDeg] = useState(0.3);
  const [pupilSamples, setPupilSamples] = useState(21);

  const surfaces = surfaceCount({ lens });
  const clampedSurface = Math.min(surface, surfaces - 1);
  const delta = fraction * FULL_SCALE[kind];

  const request = useMemo<CollimationSpec>(
    () => ({
      lens,
      apertureMm: 20,
      focalLengthMm: 100,
      stop,
      surface: clampedSurface,
      kind,
      delta,
      fieldHalfDeg,
      fieldSamples: 21,
      pupilSamples,
    }),
    [lens, stop, clampedSurface, kind, delta, fieldHalfDeg, pupilSamples],
  );

  const { result, pending } = useLatestFromWorker<CollimationSpec, CollimationResult>(
    createCollimationWorker,
    request,
  );

  const yLimit = result
    ? Math.max(
        ...result.aligned.points.map(([, y]) => Math.abs(y)),
        ...result.misaligned.points.map(([, y]) => Math.abs(y)),
      ) * 1.15
    : 1;

  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
        <Fieldset title="instrument">
          <Choice label="lens" options={LENSES} value={lens} onChange={setLens} />
          <Choice
            label="aperture stop"
            options={STOPS}
            value={stop}
            onChange={setStop}
            format={(s) => STOP_LABEL[s]}
          />
        </Fieldset>
        <Fieldset title="misalignment">
          <Choice
            label="surface"
            options={Array.from({ length: surfaces }, (_, i) => i)}
            value={clampedSurface}
            onChange={setSurface}
          />
          <Choice label="kind" options={KINDS} value={kind} onChange={setKind} format={(k) => KIND_LABEL[k]} />
          <Slider
            label={`amount  ${num(delta, 3)} ${MISALIGN_UNIT[kind]}`}
            min={-1}
            max={1}
            step={0.02}
            value={fraction}
            onChange={setFraction}
          />
        </Fieldset>
        <Fieldset title="sweep">
          <Slider
            label={`field half-width  ±${num(fieldHalfDeg, 3)}°`}
            min={0.02}
            max={0.8}
            step={0.01}
            value={fieldHalfDeg}
            onChange={setFieldHalfDeg}
          />
          <Slider
            label={`pupil samples  ${pupilSamples}`}
            min={11}
            max={41}
            step={2}
            value={pupilSamples}
            onChange={setPupilSamples}
          />
        </Fieldset>
      </div>

      {result && result.lost > 0 && (
        <Guard
          label="refused —"
          value={`${result.lost} rays vignetted`}
          level="bad"
          detail={
            "Every number below would be an average over a shrinking sub-pupil, which falls as the " +
            "misalignment grows and would read as the image getting BETTER. Reduce the misalignment " +
            "or the field half-width."
          }
        />
      )}

      {result && result.lost === 0 && (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
            <Fact
              label="coma node moved"
              value={
                Number.isFinite(result.misaligned.nodeFieldDeg)
                  ? `${num(result.nodeShiftDeg, 4)}°`
                  : "off the sweep"
              }
              note={
                Number.isFinite(result.misaligned.nodeFieldDeg)
                  ? `the coma-free point is at ${num(result.misaligned.nodeFieldDeg, 4)}°, not on axis`
                  : "the coma never crosses zero inside this field — widen the sweep to find it"
              }
            />
            <Fact
              label="coma on axis"
              value={`${num(result.misaligned.axisComaWaves, 4)} waves`}
              note={`aligned: ${num(result.aligned.axisComaWaves, 4)} — a collimated instrument has none`}
            />
            <Fact
              label="cost on axis"
              value={`${num(result.axisPenaltyWaves, 4)} waves`}
              note="total balanced wavefront, where you are pointing"
            />
            <Fact
              label="coma across the sweep"
              value={`${num(result.misaligned.crossComaWaves, 4)} waves`}
              note={
                result.misaligned.crossComaWaves > 10 * result.aligned.crossComaWaves
                  ? "the node is OFF this axis — the misalignment is out of the sweep's plane"
                  : "in-plane: the node really is on the line the sweep walks"
              }
            />
            <Fact
              label="lopsidedness"
              value={`${num(result.misaligned.asymmetryWaves, 4)} waves`}
              note={`aligned: ${num(result.aligned.asymmetryWaves, 4)} — equal coma each side means a centred node`}
            />
            <Fact
              label="what the aiming was worth"
              value={`${num(result.aimingGapFromMisalignmentWaves, 5)} waves`}
              note={`of a ${num(result.aimingGapWaves, 5)} total gap — the rest is there with nothing misaligned`}
            />
            <Fact label="elapsed" value={`${result.elapsedMs} ms`} note="three field sweeps" />
          </div>

          <Plot
            series={[
              { label: "aligned", color: "#4a90d9", points: result.aligned.points },
              { label: "misaligned", color: "#d95f4a", points: result.misaligned.points, dots: true },
              {
                label: "misaligned, old aiming",
                color: "#888",
                points: result.misalignedParaxial.points,
                dash: [4, 4],
              },
            ]}
            markers={[
              { y: 0, color: "#bbb" },
              // Only the moved one is labelled: when the misalignment is small
              // the two rules sit within a few pixels and two labels overlap
              // into an unreadable smear — which the first draft did.
              { x: result.aligned.nodeFieldDeg, color: "#4a90d9" },
              { x: result.misaligned.nodeFieldDeg, color: "#d95f4a", label: "node" },
            ]}
            xLabel="field angle (degrees)"
            yLabel="coma (waves, balanced fit)"
            xMin={-fieldHalfDeg}
            xMax={fieldHalfDeg}
            yMin={-yLimit}
            yMax={yLimit}
            width={760}
            height={320}
          />

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <Guard
              label="the curve is COMA, from a balanced fit —"
              value="not the total wavefront error"
              level={thresholdLevel(Math.abs(result.nodeShiftDeg), fieldHalfDeg, 0.2)}
              detail={
                "The total is dominated by astigmatism and field curvature, which go as field² and " +
                "stay symmetric whatever is misaligned — its minimum moves 2e-3° for a 0.2° tilt and " +
                "shows nothing. Coma is the term a misalignment displaces, and the fit has piston, " +
                "tilt and defocus projected out because a misaligned system carries a reference-frame " +
                "tilt that is not blur (VALIDATION § 1.5.3)."
              }
            />
            <Guard
              label="the grey dashed curve is the aiming this engine used before § 1.5.3 —"
              value={stop === "front" ? "barely apart" : "apart"}
              level={stop === "front" ? "ok" : "warn"}
              detail={
                stop === "front"
                  ? "A misalignment carries only the surfaces AFTER it, so with the stop in front of this one nothing the old aim pointed at moved. What gap remains is the aiming difference this lens has anyway, propagating through a system the misalignment changed. Move the stop behind the doublet to see it grow."
                  : "The stop is behind the misaligned surface and moved with it, while the old aim kept pointing at where it used to be."
              }
            />
            {clampedSurface === 0 && (
              <Guard
                label="surface 0 is not a misalignment —"
                value={kind.startsWith("tilt") ? "the whole instrument turned" : "the whole instrument moved"}
                level="warn"
                detail={
                  kind.startsWith("tilt")
                    ? `A perturbation carries every surface after it, so tilting the first one turns the lot: the node moves by exactly the tilt (${num(delta, 3)}°), because the instrument is not decollimated — it is pointed somewhere else. Pick an interior surface to decollimate it.`
                    : "A perturbation carries every surface after it, so shifting the first one slides the whole instrument sideways, which changes nothing at all and leaves the node where it was. Pick an interior surface to decollimate it."
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
