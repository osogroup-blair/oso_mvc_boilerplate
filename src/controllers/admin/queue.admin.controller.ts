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

  const queues = [];
  if (emailQueue) queues.push(new BullMQAdapter(emailQueue));

  createBullBoard({ queues, serverAdapter });

  return serverAdapter.getRouter();
}
