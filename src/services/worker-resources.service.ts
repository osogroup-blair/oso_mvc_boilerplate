import { BaseService } from "./BaseService.js";
import { closeDatabase } from "../lib/prisma.js";
import { temporalClientGateway } from "../lib/temporalClient.js";
import { emailQueue, redisConnection } from "../lib/queue.js";

/** No server/Worker startup imports; only resources owned by this process. */
export class WorkerResourcesService extends BaseService {
  constructor() { super("WorkerResourcesService"); }
  async close() {
    try { await temporalClientGateway.close(); }
    finally {
      try { await emailQueue?.close(); }
      finally {
        try { redisConnection?.disconnect(); }
        finally { await closeDatabase(); }
      }
    }
  }
}
export const workerResourcesService = new WorkerResourcesService();
