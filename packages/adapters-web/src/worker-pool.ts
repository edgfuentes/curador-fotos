/**
 * Grupo de Web Workers con cola de prioridad y cancelación.
 * Las miniaturas visibles tienen prioridad sobre las que quedaron fuera de pantalla.
 */
import { CancelledError, type CancelSignal } from '@curador/core';
import type { WorkerRequestBody, WorkerResponse } from './worker-protocol';

type Ok = Extract<WorkerResponse, { ok: true }>;

export class WorkerTaskError extends Error {
  constructor(
    message: string,
    readonly unsupported: boolean,
  ) {
    super(message);
    this.name = 'WorkerTaskError';
  }
}

interface Task {
  id: number;
  body: WorkerRequestBody;
  priority: number;
  seq: number;
  signal?: CancelSignal;
  resolve(v: Ok): void;
  reject(e: unknown): void;
}

export class WorkerPool {
  private readonly workers: { worker: Worker; busy: Task | null }[] = [];
  private queue: Task[] = [];
  private nextId = 1;
  private seq = 0;

  constructor(
    private readonly create: () => Worker,
    readonly size = Math.max(2, Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1)),
  ) {}

  run(body: WorkerRequestBody, opts: { priority?: number; signal?: CancelSignal } = {}): Promise<Ok> {
    return new Promise<Ok>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new CancelledError());
      const task: Task = { id: this.nextId++, body, priority: opts.priority ?? 0, seq: this.seq++, resolve, reject };
      if (opts.signal) task.signal = opts.signal;
      this.queue.push(task);
      this.pump();
    });
  }

  /** Cambia la prioridad de las tareas pendientes (p. ej. al hacer scroll). */
  reprioritize(fn: (body: WorkerRequestBody, current: number) => number): void {
    for (const t of this.queue) t.priority = fn(t.body, t.priority);
  }

  get pending(): number {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }

  private pump(): void {
    // Descartar tareas canceladas antes de empezar.
    this.queue = this.queue.filter((t) => {
      if (t.signal?.aborted) {
        t.reject(new CancelledError());
        return false;
      }
      return true;
    });
    while (this.queue.length) {
      let slot = this.workers.find((w) => !w.busy);
      if (!slot && this.workers.length < this.size) slot = this.spawn();
      if (!slot) return;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i]!;
        const b = this.queue[best]!;
        if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const task = this.queue.splice(best, 1)[0]!;
      slot.busy = task;
      slot.worker.postMessage({ ...task.body, id: task.id });
    }
  }

  private spawn() {
    const worker = this.create();
    const slot = { worker, busy: null as Task | null };
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const task = slot.busy;
      slot.busy = null;
      if (task && task.id === ev.data.id) {
        if (ev.data.ok) task.resolve(ev.data);
        else task.reject(new WorkerTaskError(ev.data.error, ev.data.unsupported));
      }
      this.pump();
    };
    worker.onerror = (ev) => {
      const task = slot.busy;
      slot.busy = null;
      task?.reject(new WorkerTaskError(ev.message || 'Error en el worker', false));
      // Reemplazar el worker dañado.
      worker.terminate();
      this.workers.splice(this.workers.indexOf(slot), 1);
      this.pump();
    };
    this.workers.push(slot);
    return slot;
  }

  terminate(): void {
    for (const w of this.workers) w.worker.terminate();
    this.workers.length = 0;
    for (const t of this.queue) t.reject(new CancelledError());
    this.queue = [];
  }
}
