import { useCallback, useEffect, useRef, useState } from "react";
import { createFieldWorker } from "./workers";
import type { FieldFrame, FieldJob, FieldRequest, FieldResult } from "./render";

/**
 * Runs one request through a worker, keeping the last good reply on screen.
 *
 * Backpressure, not a queue: at most one job is in flight and at most one
 * request waits behind it — a newer request overwrites the waiting one, so the
 * intermediate values a slider emits mid-drag are dropped rather than traced in
 * turn. `seq` guards against a stale reply landing after a newer one. The main
 * thread never blocks, so the slider thumb stays glued to the finger; the panel
 * dims (`pending`) while it catches up.
 *
 * Generic over the job because the star render and the brightfield render are
 * the same shape — one request in, one reply out — and A2 arriving was the
 * point at which a third hand-copied copy would have been two too many
 * (APP.md's structural item 3). The multi-reply shape stays separate below:
 * `useRenderedField` differs in exactly one line, and it is load-bearing.
 *
 * `createWorker` must be a module-level constant, not an inline closure — see
 * `workers.ts`, which is where all three of them live and why.
 */
export function useLatestFromWorker<Req, Res>(
  createWorker: () => Worker,
  request: Req,
): { result: Res | null; pending: boolean } {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<Req | null>(null);
  const [result, setResult] = useState<Res | null>(null);
  const [pending, setPending] = useState(true);

  const post = useCallback((req: Req) => {
    const worker = workerRef.current;
    if (!worker) return;
    seqRef.current += 1;
    busyRef.current = true;
    setPending(true);
    worker.postMessage({ seq: seqRef.current, request: req });
  }, []);

  useEffect(() => {
    const worker = createWorker();
    worker.onmessage = (event: MessageEvent<{ seq: number; result: Res }>) => {
      if (event.data.seq === seqRef.current) setResult(event.data.result);
      // A newer request may have arrived while the worker was busy. Send the
      // most recent one and drop everything before it.
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next) {
        post(next);
      } else {
        busyRef.current = false;
        setPending(false);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      // Reset the flags so a StrictMode remount starts clean: a leftover
      // busyRef would queue forever and the panel would never paint.
      busyRef.current = false;
      queuedRef.current = null;
    };
  }, [post, createWorker]);

  useEffect(() => {
    if (!workerRef.current) return;
    if (busyRef.current) {
      queuedRef.current = request;
      setPending(true);
    } else {
      post(request);
    }
  }, [request, post]);

  return { result, pending };
}

/**
 * Runs a star field through the field worker, painting each refinement level.
 *
 * The field render answers one job with several frames (coarse patch grids
 * first, then the finest), so this differs from `useLatestFromWorker` in one place
 * that matters: it advances its backpressure queue only when a frame arrives
 * with `done`. Advancing on the first (coarse) frame — as the single-reply hook
 * does — would fire the next queued job mid-refinement and the finest grid would
 * never paint. The stale-`seq` guard still drops frames from a superseded job.
 */
export function useRenderedField(request: FieldRequest): {
  result: FieldResult | null;
  refining: boolean;
} {
  const workerRef = useRef<Worker | null>(null);
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const queuedRef = useRef<FieldRequest | null>(null);
  const [result, setResult] = useState<FieldResult | null>(null);
  const [refining, setRefining] = useState(true);

  const post = useCallback((req: FieldRequest) => {
    const worker = workerRef.current;
    if (!worker) return;
    seqRef.current += 1;
    busyRef.current = true;
    setRefining(true);
    worker.postMessage({ seq: seqRef.current, request: req } satisfies FieldJob);
  }, []);

  useEffect(() => {
    const worker = createFieldWorker();
    worker.onmessage = (event: MessageEvent<FieldFrame>) => {
      // A superseded job keeps posting its remaining levels; drop them whole.
      if (event.data.seq !== seqRef.current) return;
      setResult(event.data.result);
      // Every frame paints, but only the finest releases the queue: the worker
      // runs a job to completion before reading the next message, so the queued
      // request waits here until `done` rather than interrupting refinement.
      if (!event.data.done) return;
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next) {
        post(next);
      } else {
        busyRef.current = false;
        setRefining(false);
      }
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      busyRef.current = false;
      queuedRef.current = null;
    };
  }, [post]);

  useEffect(() => {
    if (!workerRef.current) return;
    if (busyRef.current) {
      queuedRef.current = request;
    } else {
      post(request);
    }
  }, [request, post]);

  return { result, refining };
}
