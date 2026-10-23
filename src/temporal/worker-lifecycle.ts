/** A shutdown request initiates drain; only the run promise signals completion. */
export async function runWorkerLifecycle(
  worker: { run(): Promise<void>; shutdown(): void },
  close: () => Promise<void>,
  signals: Pick<NodeJS.Process, "on" | "off"> = process,
) {
  let requested = false;
  let failure: unknown;
  const shutdown = () => {
    if (requested) return;
    requested = true;
    try { worker.shutdown(); } catch (error) { failure = error; }
  };
  signals.on("SIGTERM", shutdown);
  signals.on("SIGINT", shutdown);
  try {
    try { await worker.run(); } catch (error) { failure = error; }
  } finally {
    signals.off("SIGTERM", shutdown);
    signals.off("SIGINT", shutdown);
    try { await close(); } catch (error) { failure = failure ? new AggregateError([failure, error], "Worker run and cleanup failed") : error; }
  }
  if (failure) throw failure;
}
