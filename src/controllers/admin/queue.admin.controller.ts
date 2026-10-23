import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../../lib/queue.js";

/**
 * Mounts the Bull Board queue dashboard as an Express sub-app.
 * Only wires up queues that actually exist (i.e. Redis is available).
 */
export function createQueueBoard() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/jobs");

  const board = createBullBoard({ queues: [], serverAdapter });
  let boundQueue = emailQueue;
  if (boundQueue) board.setQueues([new BullMQAdapter(boundQueue)]);
  const router = Router();
  router.use((_req, _res, next) => {
    if (boundQueue !== emailQueue) {
      boundQueue = emailQueue;
      board.setQueues(boundQueue ? [new BullMQAdapter(boundQueue)] : []);
    }
    next();
  }, serverAdapter.getRouter());
  return router;
}
