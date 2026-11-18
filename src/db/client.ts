// The page's side of the database worker: sends a method name and arguments, gets back a promise
// of the result. Everything crossing over must be plain data (it is copied, not shared).
import type { WorkerRequest, WorkerResponse } from './worker';

export interface DbClient {
  call<T>(method: string, ...args: unknown[]): Promise<T>;
}

export function startDb(): DbClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'honed-db' });
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let next = 1;

  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const call = waiting.get(data.id);
    if (!call) return;
    waiting.delete(data.id);
    if (data.ok) call.resolve(data.value);
    else call.reject(new Error(data.error));
  };

  return {
    call<T>(method: string, ...args: unknown[]) {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
        worker.postMessage({ id, method, args } satisfies WorkerRequest);
      });
    },
  };
}
