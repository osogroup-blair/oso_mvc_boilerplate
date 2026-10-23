import type { ActivityInterceptorsFactory } from "@temporalio/worker";
import { logger } from "../lib/logger.js";

/** Allowlisted correlation only: never Activity arguments, results or error text. */
export const activityLogging: ActivityInterceptorsFactory = (context) => ({
  inbound: {
    async execute(input, next) {
      const info = context.info;
      const log = logger.child({ workflowId: info.workflowExecution?.workflowId,
        runId: info.workflowExecution?.runId, activityId: info.activityId,
        activityType: info.activityType, attempt: info.attempt, taskQueue: info.taskQueue });
      const started = Date.now();
      log.info("Activity started");
      try {
        const result = await next(input);
        log.info({ elapsedMs: Date.now() - started }, "Activity completed");
        return result;
      } catch (error) {
        log.warn({ elapsedMs: Date.now() - started, cancelled: context.cancellationSignal.aborted }, "Activity failed");
        throw error;
      }
    },
  },
});
