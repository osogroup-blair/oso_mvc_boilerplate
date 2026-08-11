/**
 * BullMQ Worker for the "email" queue.
 * Processes jobs that were enqueued by auth.service (and any other service).
 * Falls back gracefully — this file is only imported when Redis is available.
 */
import { Worker, Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { emailService, SendMailOptions } from "../services/email.service.js";
import { logger } from "../lib/logger.js";

export type EmailJobData = SendMailOptions;

let emailWorker: Worker | null = null;

export function startEmailWorker() {
  if (!redisConnection) {
    logger.warn("Email worker not started — Redis unavailable");
    return null;
  }

  emailWorker = new Worker<EmailJobData>(
    "email",
    async (job: Job<EmailJobData>) => {
      logger.info({ jobId: job.id, to: job.data.to }, "Processing email job");
      await emailService.send(job.data);
    },
    {
      connection: redisConnection,
      concurrency: 3,
    }
  );

  emailWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Email job completed");
  });

  emailWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Email job failed");
  });

  logger.info("Email worker started");
  return emailWorker;
}

export async function stopEmailWorker() {
  if (emailWorker) {
    await emailWorker.close();
    logger.info("Email worker stopped");
  }
}
