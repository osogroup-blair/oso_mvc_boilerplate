import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { runWorkerLifecycle } from "../../src/temporal/worker-lifecycle.js";

it("drains one run despite repeated signals, closes only after settlement and removes listeners", async () => {
  const signals = new EventEmitter();
  let finish!: () => void;
  const run = new Promise<void>(resolve => { finish = resolve; });
  const close = vi.fn(); const shutdown = vi.fn();
  const pending = runWorkerLifecycle({ run: () => run, shutdown }, close, signals as never);
  signals.emit("SIGTERM"); signals.emit("SIGINT");
  expect(shutdown).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  finish(); await pending;
  expect(close).toHaveBeenCalledOnce(); expect(signals.listenerCount("SIGTERM")).toBe(0);
});
it("cleans up after run failure and preserves rejection", async () => {
  const close = vi.fn(); const failure = new Error("synthetic run failure");
  await expect(runWorkerLifecycle({ run: async () => { throw failure; }, shutdown: vi.fn() }, close, new EventEmitter() as never)).rejects.toBe(failure);
  expect(close).toHaveBeenCalledOnce();
});
it("reports cleanup failure and removes listeners even when shutdown throws", async () => {
  const signals = new EventEmitter(); let finish!: () => void;
  const pending = runWorkerLifecycle({ run: () => new Promise<void>(r => { finish = r; }), shutdown: () => { throw new Error("shutdown"); } },
    async () => { throw new Error("close"); }, signals as never);
  signals.emit("SIGTERM"); finish();
  await expect(pending).rejects.toBeInstanceOf(AggregateError);
  expect(signals.listenerCount("SIGINT")).toBe(0);
});
