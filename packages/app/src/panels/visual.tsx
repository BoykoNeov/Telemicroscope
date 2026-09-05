import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestFromWorker } from "../hooks";
import { Plot } from "../plot";
import { Choice, Guard, Slider, thresholdLevel } from "../ui";
import { createVisualCeilingWorker, createVisualRetinaWorker } from "../workers";
import { EYEPIECE_FORMS, type EyepieceForm } from "../eyepiece";
import {
  CASSEGRAIN_SECONDARY_MAGNIFICATION,
  EYE_PUPIL_MAX_MM,
  EYE_PUPIL_MIN_MM,
  NOTICEABLE_DIOPTERS,
  OBJECTIVE_KINDS,
  OBJECTIVE_LABELS,
  OBJECTIVE_NOTES,
  describeVisual,
  type Ceiling,
  type CeilingRequest,
  type ObjectiveKind,
  type Refusal,
  type RetinaRequest,
  type RetinaResult,
  type VisualSpec,
} from "../visual";

/**
 * Visual mode — APP.md's C5, and the last of Part C's modes.
 *
 * `core/pupil/visual` (§ 5q) has existed since roadmap step 5 with **one caller
 * anywhere in the app, and it is the microscope's** (D6). No telescope had ever
 * been looked through: `afocalProperties`, `apparentFieldAngleRad` and
 * `visualSystem` were validated, exported, and unwired. This is app wiring only
 * plus **one engine fix it forced** (§ 5l.1), which is A6's and C4's precedent —
 * and the fix is the reason the objective list below has no Newtonian in it.
 *
 * ## The shape: a picture, a table and two plots, and the picture is on the retina
 *
 * The one deliberate break from every other surface here is *where the image
 * plane is*. Every picture in this app is drawn at whatever plane `bestFocus`
 * chooses, because a focuser is free. An eye's is not — the relaxed eye's retina
 * sits at the reduced model's own paraxial focus, and moving it is
 * **accommodation**, which is something the observer does and has a size. So the
 * frame is formed where the retina is, and the distance to best focus is
 * reported in diopters beside it. That is C4's refusal to auto-expose, in a
 * different currency: normalizing it away would hide the finding.
 *
 * ## Its own ranges again
 *
 * 60–250 mm of aperture, against C1's 100–400 and the star panel's 4–20. The
 * lower bound is where a 40 mm eyepiece still gives a sane exit pupil; the upper
 * is where an achromat is still a doublet somebody could own. Three sliders on
 * three panels that look alike and are not — `registry.ts`'s note, a third time.
 */

const DEFAULT_SPEC: VisualSpec = {
  objective: "achromat",
  apertureMm: 100,
  focalRatio: 10,
  form: "plossl",
  eyepieceFocalLengthMm: 20,
  eyePupilMm: 3,
};
const PUPIL_SAMPLES = 64;
/** The star panel's own display gain: white is a pixel holding 1/8000 of the frame. */
const WHITE_FRACTION = 1 / 8000;
/** Maréchal: below this the retinal image is not diffraction-limited. */
const MARECHAL_STREHL = 0.8;

const FORM_LABELS: Record<EyepieceForm, string> = {
  plossl: "Plössl (two doublets, § 5m)",
  huygens: "Huygens (two singlets, § 5o)",
};

/**
 * The retinal image, at the retina.
 *
 * Three numbers under it are the whole of § 5q in one frame: the effective
 * aperture, the Airy radius **on the retina**, and the same disc carried back to
 * the sky in arcseconds. Close the iris past the exit pupil and the first two
 * move together — the retinal disc grows by exactly D/(d_eye·|M|) — while the
 * third says what it costs where it matters, which is that the telescope has
 * stopped resolving what its aperture could.
 */
function RetinaCanvas({ request }: { request: RetinaRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, pending } = useLatestFromWorker<RetinaRequest, RetinaResult | Refusal>(
    createVisualRetinaWorker,
    request,
  );

  const image = result && "size" in result ? result : null;

  useEffect(() => {
    if (!image) return;
    const element = canvas.current;
    if (!element) return;
    element.width = image.size;
    element.height = image.size;
    const context = element.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.size, image.size), 0, 0);
  }, [image]);

  if (result && !("size" in result)) {
    return (
      <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--bad)", maxWidth: 420 }}>
        the {result.stage} refused ({result.source}): {result.error}
      </p>
    );
  }

  const accommodates = image ? image.accommodationDiopters : 0;
  return (
    <figure style={{ margin: 0, opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
      <canvas
        ref={canvas}
        style={{ width: 320, height: 320, imageRendering: "pixelated", background: "#000" }}
      />
      <figcaption style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
        {image ? (
          <>
            effective aperture <strong>{image.effectiveApertureMm.toFixed(2)} mm</strong>{" "}
            {image.irisLimited ? "— the IRIS is the stop" : "— the objective is the stop"}
            <br />
            retinal Airy radius <strong>{(image.airyRadiusMm * 1000).toFixed(3)} µm</strong> ={" "}
            {image.airyArcsec.toFixed(4)}″ on the sky
            <br />
            Strehl at the retina <strong>{image.strehl.toFixed(6)}</strong> ·{" "}
            {image.elapsedMs.toFixed(0)} ms
            <br />
            <span style={{ color: "var(--ink-4)" }}>
              best focus sits {((image.bestFocusMm - image.retinaMm) * 1000).toFixed(2)} µm{" "}
              {image.bestFocusMm > image.retinaMm ? "behind" : "in front of"} the retina, which is{" "}
              {image.retinaMm.toFixed(4)} mm from the cornea
            </span>
          </>
        ) : (
          <span>tracing the retina…</span>
        )}
      </figcaption>

      {image && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          <Guard
            label="accommodation the observer must supply"
            value={`${accommodates >= 0 ? "+" : ""}${accommodates.toFixed(3)} D`}
            level={
              accommodates < 0
                ? "bad"
                : thresholdLevel(Math.abs(accommodates), NOTICEABLE_DIOPTERS)
            }
            detail={
              accommodates < 0
                ? "NEGATIVE: best focus is in front of the retina, so the eye would have to relax BELOW its resting power — the side of infinity no accommodation reaches (§ 6q.3's diagnosis, on the other conjugate)"
                : `the quarter diopter is the usual noticing threshold; the paraxial image is on the retina by construction, so all of this is the chain's spherical aberration`
            }
          />
          <Guard
            label="diffraction-limited on the retina"
            value={image.strehl.toFixed(4)}
            level={image.strehl >= MARECHAL_STREHL ? "ok" : image.strehl >= 0.5 ? "warn" : "bad"}
            detail="Maréchal's 0.8, measured AT the retina rather than at the plane that would flatter it"
          />
          <Guard
            label="screen resolved on the FFT grid"
            value={`${image.maxGridPhaseStepWaves.toFixed(4)} waves/sample`}
            level={thresholdLevel(image.maxGridPhaseStepWaves, 0.5)}
            detail="the same number the star panel holds the seeing screen to — here it is the composed chain's own wavefront, and it stays small"
          />
        </div>
      )}
    </figure>
  );
}

/**
 * The widest apparent field this eyepiece form can be BUILT to show.
 *
 * A worker because it is ~14 eyepiece solves, and it earns its own block because
 * what stops the Plössl is not the eyepiece at all — it is § 5j's doublet
 * refusing an aperture, the same wall D6 bisects as a length.
 */
function CeilingBlock({ request }: { request: CeilingRequest }) {
  const { result, pending } = useLatestFromWorker<CeilingRequest, Ceiling>(
    createVisualCeilingWorker,
    request,
  );
  if (!result) return <p style={{ fontFamily: "var(--mono)", fontSize: 12 }}>bisecting the glass…</p>;

  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.7, opacity: pending ? 0.55 : 1 }}>
      {result.clearApertureMm === null ? (
        <>
          no clear-aperture wall below{" "}
          <strong>{result.searchedToPerFocalLength.toFixed(2)}·f_e</strong> — this form does not run
          out of glass in the range searched, so it has no ceiling to report and one is not invented
        </>
      ) : (
        <>
          widest glass <strong>{result.clearApertureMm.toFixed(4)} mm</strong> ={" "}
          <strong>{result.perFocalLength!.toFixed(7)}·f_e</strong>
          <br />
          apparent field it buys{" "}
          <strong>
            {result.apparentFieldOfViewDeg === null
              ? "—"
              : `${result.apparentFieldOfViewDeg.toFixed(3)}°`}
          </strong>{" "}
          against the catalogue formula 2·atan(r/f_e) ={" "}
          {result.geometricFieldOfViewDeg === null
            ? "—"
            : `${result.geometricFieldOfViewDeg.toFixed(3)}°`}
          <br />
          <span style={{ color: "var(--ink-4)" }}>
            distortion inflates it by{" "}
            {result.inflation === null ? "—" : `${(100 * result.inflation).toFixed(2)}%`} ·{" "}
            {result.elapsedMs.toFixed(0)} ms
          </span>
        </>
      )}
    </div>
  );
}

export function VisualPanel() {
  const [objective, setObjective] = useState<ObjectiveKind>(DEFAULT_SPEC.objective);
  const [apertureMm, setApertureMm] = useState(DEFAULT_SPEC.apertureMm);
  const [focalRatio, setFocalRatio] = useState(DEFAULT_SPEC.focalRatio);
  const [form, setForm] = useState<EyepieceForm>(DEFAULT_SPEC.form);
  const [eyepieceFocalLengthMm, setEyepieceFocalLengthMm] = useState(
    DEFAULT_SPEC.eyepieceFocalLengthMm,
  );
  const [eyePupilMm, setEyePupilMm] = useState(DEFAULT_SPEC.eyePupilMm);

  const spec: VisualSpec = useMemo(
    () => ({ objective, apertureMm, focalRatio, form, eyepieceFocalLengthMm, eyePupilMm }),
    [objective, apertureMm, focalRatio, form, eyepieceFocalLengthMm, eyePupilMm],
  );
  // Main thread, on the slider's own tick: one objective solve, one eyepiece
  // solve, and then only first-order work and real chief rays.
  const result = useMemo(() => describeVisual(spec), [spec]);

  const retina: RetinaRequest = useMemo(
    () => ({ ...spec, pupilSamples: PUPIL_SAMPLES, whiteFraction: WHITE_FRACTION }),
    [spec],
  );
  // The ceiling depends on the eyepiece and — only through the field bisection —
  // on the objective. It is NOT keyed on the eye pupil, which changes no glass.
  const ceiling: CeilingRequest = useMemo(
    () => ({ objective, apertureMm, focalRatio, form, eyepieceFocalLengthMm }),
    [objective, apertureMm, focalRatio, form, eyepieceFocalLengthMm],
  );

  const readout = result.ok ? result.readout : null;

  return (
    <>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Choice
          label="objective"
          options={OBJECTIVE_KINDS}
          value={objective}
          onChange={setObjective}
          format={(k) => OBJECTIVE_LABELS[k]}
        />
        <Choice
          label="eyepiece"
          options={EYEPIECE_FORMS}
          value={form}
          onChange={setForm}
          format={(f) => FORM_LABELS[f]}
        />
        <Slider
          label={`aperture ${apertureMm.toFixed(0)} mm`}
          min={60}
          max={250}
          step={5}
          value={apertureMm}
          onChange={setApertureMm}
        />
        <Slider
          label={`focal ratio f/${focalRatio.toFixed(1)}`}
          min={5}
          max={15}
          step={0.5}
          value={focalRatio}
          onChange={setFocalRatio}
        />
        <Slider
          label={`eyepiece f_e ${eyepieceFocalLengthMm.toFixed(0)} mm`}
          min={6}
          max={40}
          step={1}
          value={eyepieceFocalLengthMm}
          onChange={setEyepieceFocalLengthMm}
        />
        <Slider
          label={`eye pupil ${eyePupilMm.toFixed(1)} mm`}
          min={1}
          max={7}
          step={0.1}
          value={eyePupilMm}
          onChange={setEyePupilMm}
        />
      </div>

      <p style={{ maxWidth: 700, fontSize: 13, color: "var(--ink-3)", marginTop: 10 }}>
        {OBJECTIVE_NOTES[objective]}
        {objective === "cassegrain" && (
          <>
            {" "}
            — driven at a secondary magnification of {CASSEGRAIN_SECONDARY_MAGNIFICATION}, so one
            focal-ratio slider serves all three objectives.
          </>
        )}
      </p>

      {!result.ok && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--bad)", maxWidth: 700 }}>
          the {result.stage} refused ({result.source}): {result.error}
        </p>
      )}

      {readout && (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 16 }}>
          <RetinaCanvas request={retina} />

          <div style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.8 }}>
            <div>
              objective f <strong>{readout.objectiveFocalLengthMm.toFixed(1)} mm</strong>
              {readout.obstruction > 0 && <> · ε {readout.obstruction.toFixed(4)}</>}
            </div>
            <div>
              magnification <strong>{readout.magnification.toFixed(4)}×</strong> from the beam
              compression, against −f_o/f_e = {readout.nominalMagnification.toFixed(4)} — two routes,{" "}
              {readout.magnificationMiss.toExponential(2)} apart
            </div>
            <div>
              exit pupil <strong>{readout.exitPupilDiameterMm.toFixed(5)} mm</strong> by imaging the
              stop through the eyepiece, against EPD/|M| ={" "}
              {readout.exitPupilFromMagnificationMm.toFixed(5)} —{" "}
              {readout.exitPupilMiss.toExponential(2)} apart
            </div>
            <div>eye relief {readout.eyeReliefMm.toFixed(3)} mm</div>
            <div style={{ marginTop: 10 }}>
              effective aperture <strong>{readout.effectiveApertureMm.toFixed(3)} mm</strong> —{" "}
              {readout.irisLimited ? (
                <span style={{ color: "var(--warn)" }}>the iris has taken the stop</span>
              ) : (
                <span>the objective still holds it</span>
              )}
            </div>
            <div style={{ color: "var(--ink-4)" }}>
              the knee is at an eye pupil of {readout.irisKneeMm.toFixed(3)} mm, which IS the exit
              pupil — equivalently |M| = D/d_eye
            </div>
            <div style={{ marginTop: 10 }}>
              field wall <strong>{readout.fieldWallDeg.toFixed(5)}°</strong> against the front
              rim&rsquo;s atan(r_e/f_o) = {readout.fieldWallClosedFormDeg.toFixed(5)}° (
              {(100 * (readout.fieldWallDeg / readout.fieldWallClosedFormDeg - 1)).toFixed(2)}%) —{" "}
              {readout.frontRimIsFieldStop
                ? "so the front rim IS the field stop"
                : "so something BEHIND the front rim is stopping the chief ray"}
            </div>
            <div>
              apparent field <strong>{readout.apparentFieldOfViewDeg.toFixed(3)}°</strong> against
              the catalogue 2·atan(r_e/f_e) = {readout.geometricFieldOfViewDeg.toFixed(3)}° —{" "}
              {readout.frontRimIsFieldStop ? (
                <>distortion inflates it {(100 * readout.fieldInflation).toFixed(2)}%</>
              ) : (
                <span style={{ color: "var(--warn)" }}>
                  {(100 * readout.fieldInflation).toFixed(2)}%, and that is NOT distortion — the
                  formula is being applied to a surface that is not the stop
                </span>
              )}
            </div>
            <div style={{ color: "var(--ink-4)" }}>
              built at {readout.elapsedMs.toFixed(1)} ms on the main thread
            </div>
          </div>
        </div>
      )}

      {readout && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 36 }}>
            The eye takes the aperture, and the collapse is exact
          </h2>
          <p style={{ maxWidth: 700, color: "var(--ink-2)" }}>
            The telescope compresses the objective&rsquo;s beam to D/|M|. While the observer&rsquo;s
            iris is wider than that, the objective is still the stop and all of the aperture reaches
            the retina; below it the iris <em>becomes</em> the stop and what reaches the retina
            collapses to d_eye·|M|. Nothing here takes a minimum: the composed system is traced with
            <code> apertureStop: &ldquo;limiting&rdquo;</code> (§ 5p) and the curve below is the
            entrance pupil that selection produced, with § 5q&rsquo;s closed form drawn beside it.
          </p>

          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <Plot
              series={[
                {
                  label: "effective aperture, off the traced entrance pupil",
                  color: "var(--accent)",
                  dots: true,
                  points: readout.apertureCurve.map((p) => [p.eyePupilMm, p.effectiveApertureMm] as const),
                },
                {
                  label: "min(D, d_eye·|M|) — § 5q's closed form",
                  color: "var(--warn-strong)",
                  dash: [4, 3],
                  points: readout.apertureCurve.map((p) => [p.eyePupilMm, p.closedFormMm] as const),
                },
              ]}
              markers={[
                {
                  x: readout.irisKneeMm,
                  color: "var(--bad)",
                  label: `knee = exit pupil ${readout.irisKneeMm.toFixed(2)} mm`,
                },
                { x: readout.eyePupilMm, color: "var(--ok)", label: "this eye" },
              ]}
              xLabel="eye pupil (mm)"
              yLabel="aperture reaching the retina (mm)"
              xMin={EYE_PUPIL_MIN_MM}
              xMax={EYE_PUPIL_MAX_MM}
              yMin={0}
              yMax={apertureMm * 1.05}
            />

            <Plot
              series={[
                {
                  label: "θ_out/(|M|·θ) − 1, the real chief ray",
                  color: "var(--accent)",
                  dots: true,
                  points: readout.distortionCurve.map((p) => [p.fieldDeg, p.departure] as const),
                },
              ]}
              markers={[
                {
                  x: readout.fieldWallDeg,
                  color: "var(--bad)",
                  label: `wall ${readout.fieldWallDeg.toFixed(3)}°`,
                },
              ]}
              xLabel="object-space field (deg)"
              yLabel="departure from |M|·θ"
              xMin={0}
              xMax={readout.fieldWallDeg}
              yMin={0}
              yMax={Math.max(
                0.01,
                ...readout.distortionCurve.map((p) => p.departure),
              )}
            />
          </div>

          <h2 style={{ fontSize: 16, marginTop: 36 }}>
            The apparent field belongs to the eyepiece, and what caps it is a doublet
          </h2>
          <p style={{ maxWidth: 700, color: "var(--ink-2)" }}>
            Move the aperture and the focal-ratio sliders and the <em>wall</em> moves — it is
            atan(r_e/f_o), so a longer objective passes less sky — while the{" "}
            <strong>apparent</strong> field barely does: the two changes cancel, because the field
            the observer sees is the wall times the magnification and the magnification carries the
            same f_o. So an eyepiece&rsquo;s apparent field of view is a property of the eyepiece,
            which is why catalogues print it on the eyepiece and not on the telescope.
          </p>
          <CeilingBlock request={ceiling} />
          <p style={{ maxWidth: 700, fontSize: 13, color: "var(--ink-3)", marginTop: 10 }}>
            The catalogue formula 2·atan(r/f_e) has no trace in it, and on a{" "}
            <strong>Plössl</strong> it is wrong in a direction: the real chief ray leaves steeper
            than |M|·θ, so the field an observer actually gets is <em>larger</em>. That is the
            pincushion the plot above draws, evaluated at the edge instead of near the axis.
          </p>
          <p style={{ maxWidth: 700, fontSize: 13, color: "var(--ink-3)" }}>
            On a <strong>Huygens</strong> the same comparison reads the other way, and it is not
            distortion changing sign — it is the formula being pointed at the wrong glass. The wall
            lands 38% <em>short</em> of atan(r_e/f_o), which says the chief ray is dying somewhere
            behind the field lens; § 5o says exactly where, in prose, as a scope note: a
            Huygens&rsquo; field stop sits <em>between</em> its two lenses, so the eye lens is what
            runs out first. Two numbers the panel already had — the bisected wall and the front
            rim&rsquo;s closed form — turn out to say <em>which surface is the field stop</em>,
            with nothing in the engine reporting one, and the readout above prints that verdict
            rather than the ratio alone.
          </p>

          {readout.foldedObjectiveRefusal && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 36 }}>The objective that is not offered</h2>
              <p style={{ maxWidth: 700, color: "var(--ink-2)" }}>
                A Newtonian is the reflector an observer is most likely to own and it is{" "}
                <strong>absent from the selector</strong>, because building this panel is what found
                out why. It is the repo&rsquo;s only <code>folded</code> prescription;{" "}
                <code>ModulePlacement</code> carries surfaces rather than a <code>Prescription</code>
                , so the frame declaration never reaches the splice while the diagonal&rsquo;s 45°
                tilt rides along on its surface. The composed chain was therefore neither folded nor
                unfolded — and it did not say so, it <em>answered</em>: an afocal gap of 1405 mm
                where the geometry has 131, after which the chief ray missed on axis. It refuses now
                (§ 5l.1), and this cell prints whatever the engine says today:
              </p>
              <p
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--bad)",
                  maxWidth: 700,
                  background: "var(--bad-tint)",
                  padding: "8px 10px",
                }}
              >
                {readout.foldedObjectiveRefusal}
              </p>
            </>
          )}

          <h2 style={{ fontSize: 16, marginTop: 36 }}>
            Accommodation is not zero, and its sign belongs to the eyepiece
          </h2>
          <p style={{ maxWidth: 700, color: "var(--ink-2)" }}>
            The afocal solve is paraxially exact, so the <em>paraxial</em> image sits on the retina
            by construction and every micron of the offset beside the picture is the composed
            chain&rsquo;s spherical aberration. Which chain: the eye is a Cartesian ellipsoid and
            has none of its own for a collimated beam (§ 5q), so on a{" "}
            <strong>Cassegrain</strong> — exactly stigmatic on axis (§ 5e) — the whole residual is
            the <em>eyepiece&rsquo;s</em>. Select it and the demand goes negative for both forms;
            put an achromat back and the Plössl&rsquo;s crosses to positive, because the
            objective&rsquo;s own fifth-order residual and the eyepiece&rsquo;s oppose. That
            crossing is inside this panel&rsquo;s sliders.
          </p>
          <p style={{ maxWidth: 700, fontSize: 13, color: "var(--ink-3)" }}>
            The guard turns red on a <em>negative</em> demand rather than on a large one, and that
            is the physics rather than a convention: a relaxed eye is at its minimum power and can
            only add. A chain whose best focus lands in front of the retina is asking it to
            subtract, which is § 6q.3&rsquo;s &ldquo;wrong side of infinity&rdquo; arriving on the
            telescope conjugate. The Huygens does this at every focal length these sliders reach —
            and its retinal Strehl says what it costs.
          </p>
          <p style={{ maxWidth: 700, fontSize: 13, color: "var(--ink-3)" }}>
            A diopter is also the wrong unit for how much it <em>hurts</em>, and the panel shows
            both so the difference is visible. The demand is a length; the damage is a wave count
            over the beam that actually fills the eye. A short eyepiece hands the iris a narrow exit
            pupil, so it takes a large focus shift to spoil the same number of waves — on the
            stigmatic control the demand falls ~4× from f_e 8 to 32 while the Strehl gets{" "}
            <em>worse</em> over the same span. Largest where it costs least.
          </p>
        </>
      )}
    </>
  );
}
