import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuildSpec } from "../builder";
import { useLatestFromWorker } from "../hooks";
import { customLabel, objectiveOf, objectiveOptions, type ObjectiveId } from "../objective";
import { refusalVoice } from "../refusal";
import { readSavedBuild } from "../saved";
import {
  CONDENSER_NA,
  DIN_TUBE_MM,
  EYE_NEAR_POINT_MM,
  STAGE_HOME,
  S_STEP,
  condenserCap,
  depthOfFocusUm,
  designSlipMm,
  slipMeaning,
  type CondenserKind,
  type Detector,
  type ScopeReadout,
  type ScopeRequest,
  type ScopeResult,
} from "../scope";
import type { LampKind } from "../section";
import { SPECIMENS, specimenOf, type SpecimenKind } from "../specimens";
import { Choice, Guard, ObjectiveLine, Slider, VERDICT_LEVEL } from "../ui";
import { createScopeWorker } from "../workers";

/**
 * The whole microscope — APP.md's Part S.
 *
 * Every other microscope surface takes the instrument apart and asks one
 * question of one piece. This one puts it back together: a drawing of the
 * light path, lamp to detector, where clicking a part opens its controls, and
 * beside it the picture that instrument actually forms — re-traced on every
 * change, through `scope.ts`, on the colour section's own engine path.
 *
 * The drawing is a SCHEMATIC. Its cones widen with the condenser opening and
 * the objective's aperture, the slip thickens, the image plane moves with the
 * tube — but nothing in it is to scale, and nothing in the picture is read off
 * it. The picture is the engine's.
 *
 * Each part's card says in plain words what it does and links to the surface
 * that measures that part properly — the diagram is the map of the
 * instrument the way the start page is the map of the app.
 *
 * ## The comparison is the point
 *
 * "See what changes" needs a before. The panel keeps the previous recording
 * and the name of the change that replaced it, and shows them side by side —
 * otherwise a reader comparing two renders is comparing a picture with a
 * memory of one.
 */

type PartId = "lamp" | "condenser" | "stage" | "slip" | "objective" | "tube" | "detector";

const LAMP_LABEL: Record<LampKind, string> = {
  "equal-energy": "white light (equal energy)",
  "tungsten-3200": "tungsten bulb, 3200 K",
};

const QUALITY = {
  quick: { pupilSamples: 32, size: 64, label: "quick (~0.2 s)" },
  fine: { pupilSamples: 64, size: 128, label: "fine (~3–7 s)" },
} as const;
type Quality = keyof typeof QUALITY;

const MAGNIFICATIONS = [4, 10, 20, 40, 60, 100] as const;
const EYEPIECE_POWERS = [5, 10, 15, 20, 25] as const;
const CAMERA_PITCHES = [1.85, 2.4, 3.45, 5.86, 6.5, 9, 13] as const;

/** Where each part sits in the drawing, and which row its label takes. */
const PART_X: Record<PartId, number> = {
  lamp: 55,
  condenser: 190,
  stage: 312,
  slip: 338,
  objective: 425,
  tube: 640,
  detector: 860,
};

const PART_NAME: Record<PartId, string> = {
  lamp: "lamp",
  condenser: "condenser",
  stage: "stage & slide",
  slip: "cover slip",
  objective: "objective",
  tube: "tube lens",
  detector: "camera / eye",
};

const ORDER: readonly PartId[] = ["lamp", "condenser", "stage", "slip", "objective", "tube", "detector"];

interface DiagramState {
  readonly lamp: LampKind;
  readonly s: number;
  readonly condenser: CondenserKind;
  readonly specimen: SpecimenKind;
  readonly slipMm: number | null;
  readonly spec: BuildSpec;
  readonly tubeRatio: number;
  readonly detector: Detector;
}

const SPECIMEN_COLOUR: Record<SpecimenKind, string> = {
  section: "var(--pink)",
  diatom: "var(--green)",
  ruled: "var(--ink-3)",
};

/** The light path, drawn. Schematic: angles grow with NA, nothing is to scale. */
function Diagram({
  state,
  selected,
  onSelect,
}: {
  state: DiagramState;
  selected: PartId;
  onSelect: (part: PartId) => void;
}) {
  const axis = 140;
  const infinity = state.spec.architecture === "infinity";
  const oil = state.spec.form === "oil";
  const na = state.spec.numericalAperture;
  // The cones: half-heights at a fixed run, growing with NA but clamped to fit.
  const objectiveCone = Math.min(26, 4 + 22 * (na / 1.45));
  const condenserOpen = 6 + 48 * Math.min(1, state.s);
  const slipWidth = state.slipMm === null ? (designSlipMm(state.spec) ?? 0) * 70 : state.slipMm * 70;
  const slipShown = state.slipMm !== null || designSlipMm(state.spec) !== null;
  const slideRight = 320;
  const slipRight = slideRight + (slipShown ? Math.max(3, slipWidth) : 0);
  const front = slipRight + (oil ? 16 : 30);
  const imageX = Math.max(720, Math.min(820, 640 + 120 * state.tubeRatio));
  const beam = 30;

  const part = (id: PartId, hit: { x: number; w: number }, children: ReactNode, row: 0 | 1) => (
    <g
      key={id}
      className={`scope-part${selected === id ? " selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected === id}
      aria-label={PART_NAME[id]}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(id);
        }
      }}
    >
      <rect className="scope-hit" x={hit.x} y={28} width={hit.w} height={row === 0 ? 248 : 268} rx={6} />
      {children}
      <text className="scope-label" x={PART_X[id]} y={row === 0 ? 268 : 290} textAnchor="middle">
        {PART_NAME[id]}
      </text>
    </g>
  );

  return (
    <svg className="scope-svg" viewBox="0 0 1000 300" role="group" aria-label="the microscope, lamp to detector">
      <line className="scope-axis" x1={20} y1={axis} x2={980} y2={axis} />

      {/* Light: lamp → condenser → specimen → objective → (infinity) → image. */}
      <polygon
        className="scope-light"
        points={`75,${axis - 8} 190,${axis - condenserOpen} 190,${axis + condenserOpen} 75,${axis + 8}`}
      />
      <polygon
        className="scope-light"
        points={`190,${axis - condenserOpen} ${slideRight},${axis} 190,${axis + condenserOpen}`}
      />
      <polygon
        className="scope-light"
        points={`${slideRight},${axis} ${front},${axis - objectiveCone} ${front},${axis + objectiveCone}`}
      />
      {infinity ? (
        <>
          <rect className="scope-light" x={480} y={axis - beam} width={160} height={2 * beam} />
          <polygon className="scope-light" points={`640,${axis - beam} ${imageX},${axis} 640,${axis + beam}`} />
        </>
      ) : (
        <polygon className="scope-light" points={`480,${axis - beam} ${imageX},${axis} 480,${axis + beam}`} />
      )}

      {part(
        "lamp",
        { x: 22, w: 66 },
        <>
          <circle
            cx={55}
            cy={axis}
            r={20}
            className="scope-bulb"
            style={{ fill: state.lamp === "tungsten-3200" ? "var(--orange)" : "var(--bg)" }}
          />
          <path className="scope-wire" d={`M47,${axis + 6} l4,-12 l4,12 l4,-12 l4,12`} />
        </>,
        0,
      )}

      {part(
        "condenser",
        { x: 130, w: 100 },
        <>
          <rect className="scope-metal" x={150} y={axis - 70} width={6} height={70 - condenserOpen} />
          <rect className="scope-metal" x={150} y={axis + condenserOpen} width={6} height={70 - condenserOpen} />
          <path
            className="scope-glass"
            d={`M190,${axis - 66} Q${state.condenser === "oiled" ? 222 : 214},${axis} 190,${axis + 66} Q166,${axis} 190,${axis - 66} Z`}
          />
        </>,
        1,
      )}

      {part(
        "stage",
        { x: 292, w: 28 },
        <>
          <rect className="scope-metal" x={296} y={axis + 76} width={34} height={10} />
          <rect className="scope-glass" x={312} y={axis - 90} width={8} height={180} />
          <circle cx={slideRight - 1} cy={axis} r={4} style={{ fill: SPECIMEN_COLOUR[state.specimen] }} />
        </>,
        0,
      )}

      {part(
        "slip",
        { x: 321, w: 26 },
        slipShown ? (
          <rect className="scope-glass" x={slideRight} y={axis - 60} width={Math.max(3, slipWidth)} height={120} />
        ) : (
          <rect className="scope-dashed" x={slideRight} y={axis - 60} width={8} height={120} />
        ),
        1,
      )}

      {oil ? <rect className="scope-oil" x={slipRight} y={axis - 14} width={front - slipRight} height={28} rx={6} /> : null}

      {part(
        "objective",
        { x: front - 6, w: 480 - front + 12 },
        <>
          <polygon
            className="scope-metal"
            points={`${front},${axis - 22} ${front},${axis + 22} ${front + 30},${axis + 52} 480,${axis + 52} 480,${axis - 52} ${front + 30},${axis - 52}`}
          />
          <text className="scope-inner" x={(front + 480) / 2 + 10} y={axis + 5} textAnchor="middle">
            {state.spec.magnification}×/{state.spec.numericalAperture}
          </text>
        </>,
        0,
      )}

      {part(
        "tube",
        { x: 600, w: 80 },
        infinity ? (
          <path className="scope-glass" d={`M640,${axis - 46} Q656,${axis} 640,${axis + 46} Q624,${axis} 640,${axis - 46} Z`} />
        ) : (
          <>
            <rect className="scope-dashed" x={560} y={axis - 46} width={160} height={92} />
            <text className="scope-note" x={640} y={axis - 52} textAnchor="middle">
              DIN: a {Math.round(DIN_TUBE_MM * state.tubeRatio)} mm tube, no lens
            </text>
          </>
        ),
        1,
      )}

      <line className="scope-image" x1={imageX} y1={axis - 40} x2={imageX} y2={axis + 40} />
      <text className="scope-note" x={imageX} y={axis - 46} textAnchor="middle">
        image
      </text>

      {part(
        "detector",
        { x: imageX - 8, w: 990 - imageX },
        state.detector.kind === "camera" ? (
          <>
            <rect className="scope-metal" x={imageX} y={axis - 36} width={80} height={72} rx={6} />
            <rect className="scope-sensor" x={imageX} y={axis - 24} width={5} height={48} />
          </>
        ) : (
          <>
            <path
              className="scope-glass"
              d={`M${imageX + 40},${axis - 36} Q${imageX + 54},${axis} ${imageX + 40},${axis + 36} Q${imageX + 26},${axis} ${imageX + 40},${axis - 36} Z`}
            />
            <ellipse className="scope-eye" cx={imageX + 110} cy={axis} rx={26} ry={20} />
            <circle cx={imageX + 92} cy={axis} r={6} style={{ fill: "var(--ink-2)" }} />
          </>
        ),
        0,
      )}
    </svg>
  );
}

/** One picture, drawn into a fixed CSS width from its own pixel grid. */
function Picture({
  rgba,
  side,
  width,
  title,
  note,
}: {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  side: number;
  width: number;
  title: string;
  note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = side;
    element.height = side;
    const context = element.getContext("2d");
    // A fresh ImageData on a copy: the same readout is drawn twice (now, and
    // later as "before"), and ImageData would otherwise share the buffer.
    context?.putImageData(new ImageData(new Uint8ClampedArray(rgba), side, side), 0, 0);
  }, [rgba, side]);
  return (
    <figure className="scope-figure" style={{ maxWidth: width }}>
      <canvas ref={canvas} className="raster" style={{ width, imageRendering: "pixelated", background: "#000" }} />
      <figcaption className="readout-note">
        <strong style={{ color: "var(--ink-2)" }}>{title}</strong>
        {note ? <> — {note}</> : null}
      </figcaption>
    </figure>
  );
}

const VERDICT_WORDS: Record<ScopeReadout["verdict"], string> = {
  valid: "trustworthy",
  unknown: "cannot be judged",
  "no-honest-image": "not trustworthy at this quality",
};

function Card({ title, children, deeper }: { title: string; children: ReactNode; deeper: readonly [string, string][] }) {
  return (
    <section className="scope-card">
      <h2>{title}</h2>
      {children}
      <p className="scope-deeper">
        go deeper:{" "}
        {deeper.map(([id, label], i) => (
          <span key={id}>
            {i > 0 ? " · " : null}
            <a href={`#/${id}`}>{label}</a>
          </span>
        ))}
      </p>
    </section>
  );
}

export function ScopePanel() {
  const [saved] = useState(readSavedBuild);
  const options = useMemo(() => objectiveOptions(saved), [saved]);

  const [selected, setSelected] = useState<PartId>("objective");
  const [lamp, setLamp] = useState<LampKind>("equal-energy");
  const [condenser, setCondenser] = useState<CondenserKind>("dry");
  const [sRaw, setS] = useState(0.5);
  const [specimen, setSpecimen] = useState<SpecimenKind>("diatom");
  const [stage, setStage] = useState(STAGE_HOME.diatom);
  const [focusUm, setFocus] = useState(0);
  const [slipMm, setSlip] = useState<number | null>(null);
  const [objectiveId, setObjectiveId] = useState<ObjectiveId>("inf-10x-010");
  const [magnification, setMagnification] = useState<number | null>(null);
  const [naRaw, setNa] = useState<number | null>(null);
  const [tubeMm, setTube] = useState<number | null>(null);
  const [detectorKind, setDetectorKind] = useState<Detector["kind"]>("camera");
  const [pitchUm, setPitch] = useState(3.45);
  const [eyepiecePower, setEyepiecePower] = useState(10);
  const [quality, setQuality] = useState<Quality>("quick");

  /** The name of the last change — it captions the "before" picture. */
  const changeRef = useRef("the starting settings");
  const change = <T,>(label: string, set: (value: T) => void) => (value: T) => {
    changeRef.current = label;
    set(value);
  };

  const preset = objectiveOf(options, objectiveId);
  const spec: BuildSpec = {
    ...preset.spec,
    magnification: magnification ?? preset.spec.magnification,
    numericalAperture: naRaw ?? preset.spec.numericalAperture,
  };
  const tuned = spec.magnification !== preset.spec.magnification || spec.numericalAperture !== preset.spec.numericalAperture;
  const infinity = spec.architecture === "infinity";
  const { pupilSamples, size } = QUALITY[quality];
  const cap = condenserCap(size, pupilSamples, spec.numericalAperture, condenser);
  const s = Math.min(sRaw, cap);
  const detector: Detector =
    detectorKind === "camera"
      ? { kind: "camera", pitchUm }
      : { kind: "eye", eyepieceFocalMm: EYE_NEAR_POINT_MM / eyepiecePower };
  const dof = depthOfFocusUm(spec.numericalAperture);
  const designSlip = designSlipMm(spec);

  // A new objective starts as designed: in focus, on its own slip and tube.
  // Reset here rather than in an effect so no render ever pairs an objective
  // with the previous one's focus offset.
  const pickObjective = (id: ObjectiveId) => {
    changeRef.current = `objective → ${objectiveOf(options, id).label}`;
    setObjectiveId(id);
    setMagnification(null);
    setNa(null);
    setFocus(0);
    setSlip(null);
    setTube(null);
  };

  const request = useMemo<ScopeRequest>(
    () => ({
      lamp,
      coherenceParameter: s,
      specimen,
      stageUm: stage,
      focusUm,
      slipMm,
      objective: spec,
      tubeMm,
      detector,
      pupilSamples,
      size,
      wavelengths: 3,
    }),
    // `spec` and `detector` are rebuilt every render; key on what they are made
    // of, or every render would post a new job to the worker.
    [lamp, s, specimen, stage, focusUm, slipMm, objectiveId, magnification, naRaw, tubeMm, detectorKind, pitchUm, eyepiecePower, pupilSamples, size, preset],
  );

  const { result, pending } = useLatestFromWorker<ScopeRequest, ScopeResult>(createScopeWorker, request);

  // Keep the previous successful recording, captioned by the change that replaced it.
  const shownRef = useRef<ScopeReadout | null>(null);
  const [previous, setPrevious] = useState<{ readout: ScopeReadout; label: string } | null>(null);
  useEffect(() => {
    if (!result?.ok) return;
    if (shownRef.current !== null && shownRef.current !== result.readout) {
      setPrevious({ readout: shownRef.current, label: changeRef.current });
    }
    shownRef.current = result.readout;
  }, [result]);

  const readout = result?.ok ? result.readout : null;
  const state: DiagramState = {
    lamp,
    s,
    condenser,
    specimen,
    slipMm,
    spec,
    tubeRatio: infinity ? (tubeMm ?? spec.tubeLengthMm) / spec.tubeLengthMm : (tubeMm ?? DIN_TUBE_MM) / DIN_TUBE_MM,
    detector,
  };

  const cards: Record<PartId, ReactNode> = {
    lamp: (
      <Card title="Lamp" deeper={[["section", "the section, in colour"]]}>
        <p className="prose">
          The light source. Its spectrum is what every colour in the picture is made of: a warm bulb has
          little blue, so the whole image shifts toward yellow and the blue end of the image is dimmer.
        </p>
        <Choice
          label="source"
          options={["equal-energy", "tungsten-3200"] as const}
          value={lamp}
          onChange={change("lamp", setLamp)}
          format={(l) => LAMP_LABEL[l]}
        />
      </Card>
    ),
    condenser: (
      <Card title="Condenser and its diaphragm" deeper={[["brightfield", "brightfield"]]}>
        <p className="prose">
          The condenser focuses the lamp onto the slide, and its diaphragm sets how wide that cone of
          light is, as a fraction of what the objective accepts. Open it and finer detail gets through;
          close it and contrast and depth go up while the finest detail is lost.
        </p>
        <Slider
          label={`diaphragm: ${s.toFixed(3)} of the objective's cone (condenser NA ${(s * spec.numericalAperture).toFixed(3)})${cap < 1 ? ` — opens to ${cap.toFixed(3)} here` : ""}`}
          min={0}
          max={cap}
          step={S_STEP}
          value={s}
          onChange={change("condenser diaphragm", setS)}
        />
        <Choice
          label="condenser"
          options={["dry", "oiled"] as const}
          value={condenser}
          onChange={change("condenser type", setCondenser)}
          format={(k) => `${k} (NA up to ${CONDENSER_NA[k]})`}
        />
        <p className="readout-note">
          A dry condenser cannot pass more than NA {CONDENSER_NA.dry}, so on an oil objective it cannot
          fill the cone; oiling it to the slide lifts that. The opening also stops where the simulation
          grid runs out — the &ldquo;fine&rdquo; quality has more room.
        </p>
      </Card>
    ),
    stage: (
      <Card
        title="Stage, slide and focus"
        deeper={[
          ["stage", "the stage"],
          ["volume", "haze & the focus stack"],
        ]}
      >
        <p className="prose">
          The slide, and the knobs that move it: sideways to choose what is under the objective, and
          along the axis to focus. Focusing moves the objective toward or away from the slide — through
          air, or through the oil film on an oil objective.
        </p>
        <Choice
          label="slide"
          options={SPECIMENS.map((entry) => entry.kind)}
          value={specimen}
          onChange={(kind: SpecimenKind) => {
            changeRef.current = `slide → ${specimenOf(kind).label}`;
            setSpecimen(kind);
            setStage(STAGE_HOME[kind]);
          }}
          format={(k) => specimenOf(k).label}
        />
        <p className="readout-note">{specimenOf(specimen).note}</p>
        <Slider
          label={`stage left–right: ${stage.x} µm`}
          min={STAGE_HOME[specimen].x - 150}
          max={STAGE_HOME[specimen].x + 150}
          step={1}
          value={stage.x}
          onChange={change("stage moved", (x: number) => setStage({ ...stage, x }))}
        />
        <Slider
          label={`stage up–down: ${stage.y} µm`}
          min={STAGE_HOME[specimen].y - 150}
          max={STAGE_HOME[specimen].y + 150}
          step={1}
          value={stage.y}
          onChange={change("stage moved", (y: number) => setStage({ ...stage, y }))}
        />
        <Slider
          label={`focus: objective ${focusUm >= 0 ? "+" : ""}${focusUm.toFixed(2)} µm (depth of focus here ≈ ${dof.toFixed(2)} µm)`}
          min={Math.round(-10 * dof * 100) / 100 + (readout?.sharpFocusUm ?? 0)}
          max={Math.round(10 * dof * 100) / 100 + (readout?.sharpFocusUm ?? 0)}
          step={Math.max(0.01, Math.round(dof * 25) / 100)}
          value={focusUm}
          onChange={change("focus", setFocus)}
        />
        <div className="scope-buttons">
          <button
            type="button"
            disabled={readout?.sharpFocusUm == null}
            onClick={() => {
              if (readout?.sharpFocusUm == null) return;
              changeRef.current = "refocused";
              setFocus(Math.round(readout.sharpFocusUm * 100) / 100);
            }}
          >
            focus it
          </button>
          <button
            type="button"
            onClick={() => {
              changeRef.current = "stage back to start";
              setStage(STAGE_HOME[specimen]);
            }}
          >
            stage back to start
          </button>
        </div>
        {readout && readout.sharpFocusUm === null ? (
          <p className="readout" style={{ color: "var(--warn)" }}>
            No objective position brings this into focus: the gap in front of the objective would have to
            close completely first. On an oil objective that is a cover slip too thick for its oil film.
          </p>
        ) : null}
      </Card>
    ),
    slip: (
      <Card title="Cover slip" deeper={[["coverslip", "the cover slip"]]}>
        <p className="prose">
          The thin glass over the specimen.{" "}
          {slipMeaning(spec) === "looked-through"
            ? "This oil objective looks through it with oil of nearly the same refractive index, so a slip of the wrong thickness mostly just moves the focus — refocus and the image comes back. Too thick, and the oil film runs out before focus is reached."
            : designSlip !== null
              ? "This objective was designed for a slip of a particular thickness; any other thickness leaves an error refocusing cannot remove — at high aperture, not at this one."
              : "This objective was designed for a bare specimen. Adding a slip moves the focus (refocus to follow it) and adds an error that grows steeply with aperture — small at NA 0.1, serious past about 0.4."}
        </p>
        {designSlip === null ? (
          <Choice
            label="on the slide"
            options={["none", "slip"] as const}
            value={slipMm === null ? "none" : "slip"}
            onChange={change("cover slip", (v: "none" | "slip") => setSlip(v === "none" ? null : 0.17))}
            format={(v) => (v === "none" ? "no cover slip (as designed)" : "a cover slip")}
          />
        ) : null}
        {designSlip !== null || slipMm !== null ? (
          <>
            <Slider
              label={`thickness: ${(slipMm ?? designSlip ?? 0.17).toFixed(3)} mm${designSlip !== null ? ` (designed for ${designSlip} mm)` : ""}`}
              min={0.1}
              max={0.25}
              step={0.005}
              value={slipMm ?? designSlip ?? 0.17}
              onChange={change("cover slip thickness", (t: number) => setSlip(t))}
            />
            {designSlip !== null ? (
              <div className="scope-buttons">
                <button
                  type="button"
                  onClick={() => {
                    changeRef.current = "cover slip as designed";
                    setSlip(null);
                  }}
                >
                  as designed
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    ),
    objective: (
      <Card
        title="Objective"
        deeper={[
          ["builder", "the builder"],
          ["bench", "microscope bench"],
        ]}
      >
        <p className="prose">
          The lens that does the real work. Its <strong>aperture</strong> (NA) sets the finest detail the
          microscope can resolve; its <strong>magnification</strong> only sets how large the image is.
          Every objective here is a real design the engine solves — and some combinations cannot be built,
          in which case the engine says so.
        </p>
        <Choice
          label="objective"
          options={options.map((o) => o.id)}
          value={objectiveId}
          onChange={pickObjective}
          format={(k) => objectiveOf(options, k).label}
        />
        <Choice
          label="magnification"
          options={MAGNIFICATIONS}
          value={spec.magnification as (typeof MAGNIFICATIONS)[number]}
          onChange={change("magnification", setMagnification)}
          format={(m) => `${m}×`}
        />
        <Slider
          label={`aperture: NA ${spec.numericalAperture.toFixed(2)}`}
          min={spec.form === "oil" ? 1 : 0.05}
          max={spec.form === "oil" ? 1.45 : 0.45}
          step={0.01}
          value={spec.numericalAperture}
          onChange={change("aperture", setNa)}
        />
        <div className="readout">
          <ObjectiveLine label={tuned ? customLabel(spec) : preset.label} note={tuned ? null : preset.note} />
        </div>
      </Card>
    ),
    tube: (
      <Card title={infinity ? "Tube lens" : "Tube (DIN)"} deeper={[["builder", "the builder"]]}>
        {infinity ? (
          <>
            <p className="prose">
              An infinity objective sends out parallel light; the tube lens brings it to an image.
              Magnification is the tube lens&rsquo;s focal length over the objective&rsquo;s, so this
              objective is &ldquo;{spec.magnification}×&rdquo; only behind a {spec.tubeLengthMm} mm tube
              lens. A different one makes the image bigger or smaller on the camera — it does not change
              what the optics resolve, only how finely the camera or eye samples it.
            </p>
            <Slider
              label={`tube lens focal length: ${tubeMm ?? spec.tubeLengthMm} mm (designed for ${spec.tubeLengthMm})`}
              min={100}
              max={300}
              step={5}
              value={tubeMm ?? spec.tubeLengthMm}
              onChange={change("tube lens", setTube)}
            />
          </>
        ) : (
          <>
            <p className="prose">
              A DIN objective forms the image itself, at the end of a {DIN_TUBE_MM} mm tube. A longer or
              shorter tube puts the camera somewhere the image is not: the picture blurs until the
              objective is refocused, and then it is a little larger or smaller, with a small error left
              in it.
            </p>
            <Slider
              label={`tube length: ${tubeMm ?? DIN_TUBE_MM} mm (designed for ${DIN_TUBE_MM})`}
              min={140}
              max={200}
              step={5}
              value={tubeMm ?? DIN_TUBE_MM}
              onChange={change("tube length", setTube)}
            />
          </>
        )}
      </Card>
    ),
    detector: (
      <Card
        title="Camera or eye"
        deeper={[
          ["eyepiece", "the eyepiece"],
          ["camera", "the sensor"],
        ]}
      >
        <p className="prose">
          What records the image. A camera adds up the light falling on each pixel; an eye looking
          through an eyepiece samples it with its cones. Either way, detail smaller than about two
          samples is lost — that is why a camera with big pixels needs more magnification in front of it.
        </p>
        <Choice
          label="detector"
          options={["camera", "eye"] as const}
          value={detectorKind}
          onChange={change("detector", setDetectorKind)}
          format={(k) => (k === "camera" ? "camera" : "eye + eyepiece")}
        />
        {detectorKind === "camera" ? (
          <Choice
            label="pixel size (µm)"
            options={CAMERA_PITCHES}
            value={pitchUm as (typeof CAMERA_PITCHES)[number]}
            onChange={change("camera pixel size", setPitch)}
          />
        ) : (
          <>
            <Choice
              label="eyepiece"
              options={EYEPIECE_POWERS}
              value={eyepiecePower as (typeof EYEPIECE_POWERS)[number]}
              onChange={change("eyepiece", setEyepiecePower)}
              format={(p) => `${p}×`}
            />
            <p className="readout-note">
              The eye is modelled as a perfect lens sampled by foveal cones 2.41 µm apart (Curcio et al.
              1990&rsquo;s peak density), about half an arcminute each. Its own aberrations are left out;
              at the small exit pupils a microscope delivers they are minor.
            </p>
          </>
        )}
      </Card>
    ),
  };

  return (
    <>
      <h1>The whole microscope</h1>
      <p className="prose">
        A microscope, lamp to camera. <strong>Click any part of the drawing</strong> to change it — every
        change re-traces the light through the instrument and re-forms the picture below, and the picture
        before your change stays beside it for comparison. Nothing in the picture is drawn on: blur,
        colour and lost detail come out of the optics.
      </p>

      <Diagram state={state} selected={selected} onSelect={setSelected} />
      <p className="readout-note" style={{ marginTop: 0 }}>
        The drawing is a schematic, not to scale. Parts in order of the light:{" "}
        {ORDER.map((id, i) => (
          <span key={id}>
            {i > 0 ? " → " : null}
            <button type="button" className="scope-chip" aria-pressed={selected === id} onClick={() => setSelected(id)}>
              {PART_NAME[id]}
            </button>
          </span>
        ))}
      </p>

      <div className="scope-grid">
        <div>{cards[selected]}</div>

        <div>
          {result === null ? (
            <p className="panel-loading">tracing the light through the instrument…</p>
          ) : !result.ok ? (
            <p className="readout" style={{ color: result.source === "app" ? "var(--warn)" : "var(--bad)" }}>
              {refusalVoice(result.source, "this instrument")}: {result.error}
            </p>
          ) : null}
          {readout ? (
            <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease-out" }}>
              <div className="scope-pictures">
                <Picture
                  rgba={readout.recorded}
                  side={readout.cols}
                  width={320}
                  title={detectorKind === "camera" ? "what the camera records" : "what your eye sees"}
                  note={`${readout.cols} × ${readout.cols} ${detectorKind === "camera" ? "pixels" : "cones"}`}
                />
                <div className="scope-side">
                  <Picture
                    rgba={readout.optical}
                    side={readout.size}
                    width={150}
                    title="the light itself"
                    note="the image before it is recorded"
                  />
                  {previous ? (
                    <Picture
                      rgba={previous.readout.recorded}
                      side={previous.readout.cols}
                      width={150}
                      title="before"
                      note={`your last change: ${previous.label}`}
                    />
                  ) : null}
                </div>
              </div>
              <Readouts readout={readout} detector={detector} eyepiecePower={eyepiecePower} focusUm={focusUm} />
            </div>
          ) : null}
          <Choice
            label="simulation quality"
            options={["quick", "fine"] as const}
            value={quality}
            onChange={change("quality", setQuality)}
            format={(q) => QUALITY[q].label}
          />
        </div>
      </div>
    </>
  );
}

function Readouts({
  readout,
  detector,
  eyepiecePower,
  focusUm,
}: {
  readout: ScopeReadout;
  detector: Detector;
  eyepiecePower: number;
  focusUm: number;
}) {
  const sampled = readout.detectorPixelUm <= readout.abbeLimitUm / 2;
  return (
    <div className="readout scope-readouts">
      <div>
        <strong>{readout.objectSpanUm.toFixed(1)} µm</strong> of slide across these pictures (the centre of
        the field; a real field of view is wider)
      </div>
      <div>
        magnified <strong>{readout.magnification.toFixed(1)}×</strong> onto the image plane (traced)
        {detector.kind === "eye" ? (
          <>
            , <strong>{(readout.magnification * eyepiecePower).toFixed(0)}×</strong> to your eye with the{" "}
            {eyepiecePower}× eyepiece
          </>
        ) : null}
      </div>
      <div>
        finest detail the optics pass: about <strong>{readout.abbeLimitUm.toFixed(2)} µm</strong> (Abbe:
        wavelength ÷ (objective NA + condenser NA))
      </div>
      <div style={{ color: sampled ? "var(--ok)" : "var(--warn)" }}>
        one {detector.kind === "camera" ? "pixel" : "cone"} covers {readout.detectorPixelUm.toFixed(3)} µm of
        slide —{" "}
        {sampled
          ? "fine enough to record that detail"
          : "too coarse to record it: some detail the optics deliver is lost here (more magnification, or smaller pixels, would keep it)"}
      </div>
      <div>
        {readout.sharpFocusUm === null
          ? "focus: no reachable position is sharp"
          : Math.abs(readout.sharpFocusUm - focusUm) < 0.01
            ? "in focus"
            : `out of focus by ${(focusUm - readout.sharpFocusUm).toFixed(2)} µm — "focus it" on the stage card`}
      </div>
      <Guard
        label={`simulation — worst colour ${readout.verdictNm.toFixed(0)} nm:`}
        value={VERDICT_WORDS[readout.verdict]}
        level={VERDICT_LEVEL[readout.verdict]}
        detail={
          readout.verdict === "valid"
            ? `${readout.sourcePoints} illumination directions · ${readout.elapsedMs.toFixed(0)} ms`
            : `${readout.verdictReason} — try "fine" quality · ${readout.elapsedMs.toFixed(0)} ms`
        }
      />
    </div>
  );
}
