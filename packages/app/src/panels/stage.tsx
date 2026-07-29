import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MICROSCOPE_CATALOG, type MicroscopeKind } from "../microscope";
import { Choice, Guard, GUARD_COLOR, Slider, VERDICT_LEVEL } from "../ui";
import { createStageWorker } from "../workers";
import { SPECIMENS, specimenOf, type SpecimenKind } from "../specimens";
import {
  FIELD_NUMBER_MM,
  stageInfo,
  WHITE_INTENSITY,
  type StageInfo,
  type StageRequest,
  type StageTileDone,
  type StageTileJob,
  type StageTileReadout,
} from "../stage";

/**
 * The stage — APP.md's A7, and the first surface in this repo that looks like a
 * microscope rather than an experiment.
 *
 * Every other microscope panel shows one frame, which § 6h.2 says spans
 * `pupilSamples` resolution cells and no more: 93.5 µm at 4×/0.10, 2.6 µm at
 * 100×/1.40, and raising the grid cannot widen it. This one pans across a
 * specimen that is larger than a frame, by tiling — § 6m put a tile off axis,
 * § 6n warped its grid so two tiles agree about where the specimen is, § 6o
 * bounded what the crop between them costs, and § 6p made a traced tile
 * affordable. This is what those four steps were for.
 *
 * ## Three things it is required to say, and one it is required not to offer
 *
 * **Its own span, against the real field.** A1 established that a microscope
 * frame is labelled with `objectSpanUm`; a stage that covered a fraction of a
 * millimetre of a 4.5 mm field and did not say so would be the "view through the
 * eyepiece" claim this app has refused all the way down.
 *
 * **The guard, S, and the source point count — all three.** § 6o corrected D0.2
 * on exactly this: the crop error is not a function of the guard alone. Under a
 * coherent source it falls as `guard^(−1/2)` with no free coefficient; a filled
 * condenser beats that by a factor which *doubles* with the guard; and D0.2's
 * apparent ~4e-3 floor turned out to be the condenser's own quadrature. So the
 * panel prints the three numbers that determine it and does **not** print a
 * bound — the partially coherent exponent is not pinned anywhere, which § 6o
 * states in those words.
 *
 * **The worst tile's verdict.** § 6g.3's rule, one level further out: a picture
 * is not honest in the places where it happens to be, so the fidelity readout is
 * the worst tile on screen and never the middle one.
 *
 * **No live full-field drag.** D0.1 and D9. A tile is ~350 ms, so the viewport is
 * rendered where you are looking, nearest tile first, and panning re-uses the
 * cache — a tile depends on its index and nothing else (§ 6o.8), which is what
 * makes the cache legitimate rather than merely convenient.
 */

/** Workers in the pool. Tiles are independent (§ 6o.8), so this is a straight
 * wall-clock division — three because a browser tab has other work to do. */
const POOL = 3;

/**
 * Viewport, in **tiles** rather than in pixels — D0's "a viewport holds tens of
 * tiles, not 181", as code instead of as a comment.
 *
 * A fixed pixel viewport looks harmless and is not: the guard is paid at full
 * price and thrown away, so `usefulPixels` is 48 at ps 32 / guard 4 but **8** at
 * ps 16 / guard 6 — and a 224-pixel window over 8-pixel tiles is 841 renders,
 * which is the live full-field drag this panel's own closing paragraph promises
 * it will never offer. Sizing the window in tiles holds the cost fixed at ~25 of
 * them whatever the guard and the sampling do; what changes is how much specimen
 * that buys, which is the honest variable and is printed.
 */
const TILES_ACROSS = 5;

const key = (col: number, row: number) => `${col},${row}`;

interface Pending {
  readonly col: number;
  readonly row: number;
}

export function StagePanel() {
  const [kind, setKind] = useState<MicroscopeKind>("din-4x-010");
  const [specimen, setSpecimen] = useState<SpecimenKind>("section");
  const [pupilSamples, setPupilSamples] = useState(32);
  const [guardCells, setGuardCells] = useState(4);
  // S is quantized to the pupil's own frequency step: `commensurateSource`
  // REFUSES a lattice it is not on (§ 6p) rather than rounding one, so the
  // slider steps by 1/pupilSamples and cannot walk into the refusal.
  const [sTicks, setSTicks] = useState(16);
  const [zoom, setZoom] = useState(2);
  // Where the viewport's CENTRE sits on the composed plane, in plane pixels —
  // the centre and not the corner, so `(0, 0)` is the axis whatever the viewport
  // size turns out to be, and changing the guard does not slide the picture.
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Two pixels per resolution cell — the finest sampling `abbeImage` admits at
  // S = 1 and, since the warped rasterizer is per-pixel and dominates a traced
  // tile, the sampling that decides what the stage costs. See `stage.ts`.
  const size = 2 * pupilSamples;
  // `abbeImage` THROWS rather than truncate a shifted pupil that leaves the
  // frequency grid, so the ceiling is derived and the slider stops there:
  // a source point at S needs size ≥ ceil(pupilSamples·(1 + S)) + 2.
  const sTickMax = Math.floor(((size - 2) / pupilSamples - 1) * pupilSamples);
  const ticks = Math.min(sTicks, sTickMax);
  const coherenceParameter = ticks / pupilSamples;

  const request = useMemo<StageRequest>(
    () => ({ kind, specimen, pupilSamples, size, guardCells, coherenceParameter }),
    [kind, specimen, pupilSamples, size, guardCells, coherenceParameter],
  );

  const [info, setInfo] = useState<{ ok: true; info: StageInfo } | { ok: false; error: string } | null>(
    null,
  );
  useEffect(() => {
    setInfo(null);
    const id = setTimeout(() => setInfo(stageInfo(request)), 0);
    return () => clearTimeout(id);
  }, [request]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useRef(new Map<string, StageTileReadout>());
  const failures = useRef(new Map<string, string>());
  const workers = useRef<Worker[]>([]);
  const busy = useRef<boolean[]>([]);
  const queue = useRef<Pending[]>([]);
  const epoch = useRef(0);
  const started = useRef(0);
  /** The `pan` the queue effect last ran for — how it tells a drag from a
   * configuration change, which arrive through the same effect. */
  const panned = useRef({ x: 0, y: 0 });
  const [progress, setProgress] = useState({ done: 0, total: 0, elapsedMs: 0 });
  const [stats, setStats] = useState<{
    verdict: "valid" | "unknown" | "no-honest-image";
    reason: string;
    contributingPoints: number;
    maxGridPhaseStepWaves: number;
    slowestMs: number;
    centre: { x: number; y: number } | null;
  } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /** Tiles the last pan had to ask for. `0` is the cache claim, as a readout. */
  const [lastPanQueued, setLastPanQueued] = useState<number | null>(null);

  const useful = info?.ok === true ? info.info.usefulPixels : 0;
  const view = useful * TILES_ACROSS;

  /** Repaint from the cache. Nothing is resampled: a tile's kept pixels are its
   * own (§ 6o), and the composed plane is exactly them, laid side by side. */
  const paint = useCallback(() => {
    const element = canvas.current;
    if (!element || useful === 0) return;
    const context = element.getContext("2d");
    if (!context) return;
    context.fillStyle = "#111";
    context.fillRect(0, 0, view, view);
    const left = pan.x - view / 2;
    const top = pan.y - view / 2;
    for (const tile of tiles.current.values()) {
      context.putImageData(
        new ImageData(new Uint8ClampedArray(tile.rgba), tile.size, tile.size),
        tile.col * useful - left,
        tile.row * useful - top,
      );
    }
  }, [pan.x, pan.y, useful, view]);

  /** Hand every free worker the next tile — nearest the viewport centre first,
   * which is D4's "live centre tile" and falls straight out of the ordering. */
  const pump = useCallback(() => {
    for (let i = 0; i < workers.current.length; i++) {
      if (busy.current[i]) continue;
      const next = queue.current.shift();
      if (!next) return;
      busy.current[i] = true;
      workers.current[i]!.postMessage({
        seq: epoch.current,
        request: { ...request, col: next.col, row: next.row },
      } satisfies StageTileJob);
    }
  }, [request]);

  // The pool is built once and outlives every configuration, so what it calls
  // has to be read at call time and not captured: a handler holding the first
  // render's `paint` would hold one from before the anchor had been traced —
  // `usefulPixels` is 0 there, and every repaint would return without drawing.
  const paintRef = useRef(paint);
  const pumpRef = useRef(pump);
  paintRef.current = paint;
  pumpRef.current = pump;

  useEffect(() => {
    const pool: Worker[] = [];
    for (let i = 0; i < POOL; i++) {
      const worker = createStageWorker();
      worker.onmessage = (event: MessageEvent<StageTileDone>) => {
        const slot = pool.indexOf(worker);
        if (slot >= 0) busy.current[slot] = false;
        // A superseded configuration keeps arriving for a few hundred ms; its
        // tiles are of a different picture and are dropped whole.
        if (event.data.seq === epoch.current) {
          const result = event.data.result;
          if (result.ok) {
            tiles.current.set(key(result.readout.col, result.readout.row), result.readout);
          } else {
            failures.current.set(key(result.col, result.row), result.error);
            setRefused(result.error);
          }
          setProgress((p) => ({
            done: p.done + 1,
            total: p.total,
            elapsedMs: performance.now() - started.current,
          }));
          paintRef.current();
        }
        pumpRef.current();
      };
      pool.push(worker);
    }
    workers.current = pool;
    busy.current = pool.map(() => false);
    return () => {
      for (const worker of pool) worker.terminate();
      workers.current = [];
      busy.current = [];
      queue.current = [];
    };
    // Mount only: re-creating the pool when `paint` or `pump` changed would
    // terminate a worker mid-tile on every pan, which is why they are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new configuration is a new picture: the cache is not a cache of anything
  // that still exists, so it goes, and in-flight replies are dropped by epoch.
  //
  // `request` and NOTHING else. `paint` changes identity with the pan, so having
  // it here — which is what the dependency lint asks for — threw the cache away
  // on every drag and re-rendered the whole viewport: 36 tiles where 11 were
  // new. That is the cache claim being quietly false while the panel says it.
  useEffect(() => {
    epoch.current += 1;
    tiles.current.clear();
    failures.current.clear();
    setRefused(null);
    setStats(null);
    setProgress({ done: 0, total: 0, elapsedMs: 0 });
    setLastPanQueued(null);
    queue.current = [];
    paintRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Ask for whatever the viewport is short of, nearest the centre first. Pans
  // that reveal nothing new queue nothing at all — that is the cache paying.
  useEffect(() => {
    if (useful === 0) return;
    const left = pan.x - view / 2;
    const top = pan.y - view / 2;
    const c0 = Math.floor(left / useful);
    const r0 = Math.floor(top / useful);
    const c1 = Math.floor((left + view - 1) / useful);
    const r1 = Math.floor((top + view - 1) / useful);
    const cx = pan.x;
    const cy = pan.y;
    const wanted: Pending[] = [];
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const k = key(col, row);
        if (tiles.current.has(k) || failures.current.has(k)) continue;
        if (queue.current.some((q) => q.col === col && q.row === row)) continue;
        wanted.push({ col, row });
      }
    }
    // The cache claim, as a number rather than as prose: a pan that reveals
    // nothing new asks for nothing, and the panel has to be able to SHOW that.
    // Only a *pan* counts — this effect also runs when the configuration
    // changes, and a fresh render reporting "the cache served this" would be
    // the readout lying in the panel's own favour.
    if (panned.current !== pan) {
      panned.current = pan;
      setLastPanQueued(wanted.length);
    }
    if (wanted.length === 0) return;
    const distance = (t: Pending) =>
      Math.hypot((t.col + 0.5) * useful - cx, (t.row + 0.5) * useful - cy);
    wanted.sort((a, b) => distance(a) - distance(b));
    queue.current = [...queue.current, ...wanted].sort((a, b) => distance(a) - distance(b));
    if (progress.total === progress.done) started.current = performance.now();
    setProgress((p) => ({
      done: p.total === p.done ? 0 : p.done,
      total: p.total === p.done ? wanted.length : p.total + wanted.length,
      elapsedMs: 0,
    }));
    pump();
    // `progress` is read to decide whether this is a fresh batch; depending on it
    // would re-run the effect on every completed tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan, useful, view, request, pump]);

  useEffect(paint, [paint]);

  // The readouts, folded over the tiles ON SCREEN — the worst verdict, the worst
  // sampling, the slowest tile. § 6g.3's rule: a picture is not honest in the
  // tiles where it happens to be.
  useEffect(() => {
    if (useful === 0) return;
    const rank = { valid: 0, unknown: 1, "no-honest-image": 2 } as const;
    let worst: StageTileReadout | null = null;
    let contributingPoints = Infinity;
    let maxGridPhaseStepWaves = 0;
    let slowestMs = 0;
    let centre: { x: number; y: number } | null = null;
    const left = pan.x - view / 2;
    const top = pan.y - view / 2;
    const cc = Math.floor(pan.x / useful);
    const cr = Math.floor(pan.y / useful);
    for (const tile of tiles.current.values()) {
      if (tile.col * useful + tile.size <= left || tile.col * useful >= left + view) continue;
      if (tile.row * useful + tile.size <= top || tile.row * useful >= top + view) continue;
      if (worst === null || rank[tile.verdict] > rank[worst.verdict]) worst = tile;
      contributingPoints = Math.min(contributingPoints, tile.contributingPoints);
      maxGridPhaseStepWaves = Math.max(maxGridPhaseStepWaves, tile.maxGridPhaseStepWaves);
      slowestMs = Math.max(slowestMs, tile.elapsedMs);
      if (tile.col === cc && tile.row === cr) centre = tile.objectCentreMm;
    }
    setStats(
      worst === null
        ? null
        : {
            verdict: worst.verdict,
            reason: worst.verdictReason,
            contributingPoints,
            maxGridPhaseStepWaves,
            slowestMs,
            centre,
          },
    );
  }, [progress, pan, useful, view]);

  // Drag to pan — the viewport's centre moves against the pointer, and the delta
  // is divided by the display zoom because the zoom is a property of the screen
  // and not of the picture.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const from = drag.current;
    if (!from) return;
    const dx = Math.round((event.clientX - from.x) / zoom);
    const dy = Math.round((event.clientY - from.y) / zoom);
    if (dx === 0 && dy === 0) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setPan((p) => ({ x: p.x - dx, y: p.y - dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const spanUm = info?.ok === true ? (view * info.info.objectPixelNm) / 1000 : 0;
  const fieldFraction =
    info?.ok === true ? spanUm / 1000 / info.info.fieldMm : 0;

  return (
    <>
      <h1 style={{ fontSize: 20 }}>The stage: a field of view is reached by tiling</h1>
      <p style={{ maxWidth: 660, color: "#444" }}>
        Drag the picture. Each tile is a whole brightfield render — its own traced pupils, its own
        warped grid, its own Abbe sum over the condenser — and they are laid side by side with
        nothing blended and nothing resampled. A microscope frame in this engine spans{" "}
        <strong>pupilSamples resolution cells and no more</strong> (§ 6h.2), so this is the only way
        the view gets wider: not a bigger frame, more frames.
      </p>
      <p style={{ maxWidth: 660, color: "#444" }}>
        A tile is identified by its <strong>index from the axis</strong>, never by where you have
        panned to — § 6o.8 pins that it is bit for bit the tile a whole mosaic composes, and measures
        what the alternative costs: re-anchoring on the viewport moves the grid 16 px a third of a
        tile off centre. That is what makes the cache legitimate, so a pan that reveals nothing new
        renders nothing at all.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <Choice
          label="objective"
          options={MICROSCOPE_CATALOG.map((e) => e.kind)}
          value={kind}
          onChange={setKind}
          format={(k) => MICROSCOPE_CATALOG.find((e) => e.kind === k)!.label}
        />
        <Choice
          label="specimen"
          options={SPECIMENS.map((s) => s.kind)}
          value={specimen}
          onChange={setSpecimen}
          format={(k) => specimenOf(k).label}
        />
        <Choice
          label={`pupil samples ${pupilSamples} — the tile's width in cells, and its cost`}
          options={[16, 32]}
          value={pupilSamples}
          onChange={setPupilSamples}
        />
        <Choice label={`display zoom ${zoom}×`} options={[1, 2, 3]} value={zoom} onChange={setZoom} />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <Slider
          label={`guard ${guardCells} cells — ${info?.ok === true ? `${info.info.usefulPixels} of ${info.info.tilePixels} px kept` : "…"}`}
          min={0}
          max={6}
          step={1}
          value={guardCells}
          onChange={setGuardCells}
        />
        <Slider
          label={`condenser S = ${coherenceParameter.toFixed(4)} (${ticks}/${pupilSamples} — the pupil's own frequency step)`}
          min={1}
          max={sTickMax}
          step={1}
          value={ticks}
          onChange={setSTicks}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <canvas
            ref={canvas}
            width={view}
            height={view}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              width: view * zoom,
              height: view * zoom,
              imageRendering: "pixelated",
              background: "#111",
              cursor: drag.current ? "grabbing" : "grab",
              touchAction: "none",
            }}
          />
          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, marginTop: 4 }}>
            {progress.total > progress.done ? (
              <span>
                {progress.done}/{progress.total} tiles · {(progress.elapsedMs / 1000).toFixed(1)} s
              </span>
            ) : (
              <span style={{ color: "#777" }}>
                {/* The zero case is the panel's own cache claim, and it has to be
                    reachable: gated on the batch total instead, it never fires
                    after the first render and the claim has no readout. */}
                {lastPanQueued === 0
                  ? "0 tiles — the cache served this pan whole"
                  : progress.total > 0
                    ? `${progress.total} tiles in ${(progress.elapsedMs / 1000).toFixed(1)} s`
                    : "nothing asked for yet"}
                {stats && ` · slowest tile ${stats.slowestMs.toFixed(0)} ms`}
              </span>
            )}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#777" }}>
            {view}² plane pixels — {TILES_ACROSS}×{TILES_ACROSS} tiles, whatever the guard and the
            sampling do to how much specimen that is
          </div>
        </div>

        <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, maxWidth: 400 }}>
          {info === null ? (
            <span>tracing the anchor…</span>
          ) : !info.ok ? (
            <span style={{ color: "#c00" }}>the engine refuses this stage: {info.error}</span>
          ) : (
            <>
              <strong>{spanUm.toFixed(1)} µm</strong> of specimen on screen —{" "}
              <strong>{(100 * fieldFraction).toFixed(1)}%</strong> of the{" "}
              {info.info.fieldMm.toFixed(2)} mm this objective would really show
              <br />
              <span style={{ color: "#777" }}>
                field = {FIELD_NUMBER_MM} mm field number ÷ {info.info.magnification.toFixed(1)}×, a
                stated convention and not a traced number
              </span>
              <br />
              tile {info.info.tileSpanUm.toFixed(1)} µm kept · {info.info.objectPixelNm.toFixed(0)} nm
              per pixel · NA {info.info.tracedNA.toFixed(4)}
              <br />
              {stats?.centre
                ? `centre of the field at (${(stats.centre.x * 1000).toFixed(1)}, ${(stats.centre.y * 1000).toFixed(1)}) µm on the specimen`
                : "centre tile pending"}
              <br />
              <br />
              {stats && (
                <Guard
                  label="fidelity, worst tile on screen"
                  value={stats.verdict}
                  level={VERDICT_LEVEL[stats.verdict]}
                  detail={stats.reason}
                />
              )}
              <div style={{ marginTop: 8 }}>
                <strong>the crop</strong>: guard {guardCells} cells · S{" "}
                {coherenceParameter.toFixed(4)} · {info.info.sourcePoints} directions
                <br />
                <span style={{ color: "#777" }}>
                  all three, because § 6o measured that the guard alone does not decide it: a
                  coherent source falls as guard^(−1/2) and a filled condenser beats that by a
                  factor that doubles with the guard. No bound is printed — the partially coherent
                  exponent is not pinned.
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                {stats && (
                  <>
                    {stats.contributingPoints}/{info.info.sourcePoints} directions contributed in the
                    worst tile · grid step {stats.maxGridPhaseStepWaves.toFixed(3)} waves
                  </>
                )}
              </div>
              {refused && (
                <div style={{ marginTop: 8, color: GUARD_COLOR.bad }}>
                  some tiles were refused: {refused}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <p style={{ marginTop: 24, fontSize: 13, color: "#666", maxWidth: 660 }}>
        Mid-grey is intensity 1 — a <em>clear field</em> — and white is {WHITE_INTENSITY}× it,
        linearly. That reference is fixed rather than per tile on purpose: the other panels put
        mid-grey at their own frame&rsquo;s mean, which here would give every tile a slightly
        different brightness and paint a grid of seams the physics does not have. Because{" "}
        <code>abbeImage</code> normalizes the source weights to Σ = 1, a clear field is 1 whatever
        the condenser does, so the whole plane can share one white.
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "#666", maxWidth: 660 }}>
        There is no live full-field drag and there will not be: D0.1 measured a 4×&rsquo;s real
        5 mm field at ~181 tiles, which is tens of minutes even across workers. What is live is the
        tile you are looking at — the queue is ordered by distance from the centre of the viewport,
        so the middle fills first and the corners follow. The <strong>ruled grid</strong> is the
        specimen to judge it by, and the thing to look for is what is <em>not</em> there: a ruling
        crosses a seam with no step in it. That is § 6n — each tile evaluates the specimen at the
        object point its own traced chief ray reaches, so two tiles agree about where the specimen
        is. The <em>curvature</em> of those rulings is real too, but it is a millimetre-scale
        effect (§ 6n measured the sagitta growing ×2.00 per doubling of field) and a third of a
        millimetre of stage is nowhere near enough to see it.
      </p>
    </>
  );
}
