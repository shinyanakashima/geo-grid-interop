/** gridWorker への Promise ベースのクライアント */

import type { WorkerRequest } from "./gridWorker";

const worker = new Worker(new URL("./gridWorker.ts", import.meta.url), {
  type: "module",
});

let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

worker.onmessage = (
  ev: MessageEvent<{
    requestId: number;
    ok: boolean;
    result?: unknown;
    error?: string;
  }>
) => {
  const entry = pending.get(ev.data.requestId);
  if (!entry) return;
  pending.delete(ev.data.requestId);
  if (ev.data.ok) entry.resolve(ev.data.result);
  else entry.reject(new Error(ev.data.error));
};

export function callWorker<T>(payload: WorkerRequest): Promise<T> {
  const requestId = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    worker.postMessage({ requestId, payload });
  });
}
