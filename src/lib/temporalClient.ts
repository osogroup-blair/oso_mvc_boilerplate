import { Client, Connection } from "@temporalio/client";
import { ScheduleOverlapPolicy } from "@temporalio/client";
import type {
  ScheduleDescription,
  ScheduleExecutionResult,
  ScheduleOverlapPolicy as TemporalScheduleOverlapPolicy,
  WorkflowExecutionStatusName,
} from "@temporalio/client";
import temporalProto from "@temporalio/proto";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

const { temporal } = temporalProto;

export interface TemporalDiagnostics {
  status: "ok" | "error";
  address: string;
  namespace: string;
  taskQueue: string;
  uiBaseUrl: string;
  latencyMs: number;
  error?: string;
}

export interface TemporalTaskQueueDiagnostics {
  status: "ok" | "error";
  taskQueue: string;
  workflowPollerCount: number;
  activityPollerCount: number;
  pollers: Array<{
    identity: string;
    taskQueueType: "workflow" | "activity";
    lastAccessTime?: Date;
  }>;
  error?: string;
}

export interface TemporalStartInput {
  workflowType: string;
  taskQueue: string;
  workflowId: string;
  args: unknown[];
}

export interface TemporalStartResult {
  workflowId: string;
  runId: string;
}

export interface TemporalDescribeResult {
  statusName: WorkflowExecutionStatusName;
  closeTime?: Date;
}

export interface TemporalScheduleCreateInput {
  scheduleId: string;
  workflowType: string;
  taskQueue: string;
  args: unknown[];
  cronExpression: string;
  timezone: string;
  overlapPolicy: TemporalScheduleOverlapPolicy;
  catchupWindowSeconds: number;
  pauseOnFailure: boolean;
  memo?: Record<string, unknown>;
  paused?: boolean;
}

export interface TemporalScheduleDescription {
  scheduleId: string;
  paused: boolean;
  note?: string;
  nextActionTimes: Date[];
  recentActions: ScheduleExecutionResult[];
  runningActions: ScheduleDescription["info"]["runningActions"];
  numActionsTaken: number;
  numActionsMissedCatchupWindow: number;
  numActionsSkippedOverlap: number;
  overlapPolicy: TemporalScheduleOverlapPolicy;
  catchupWindowMs: number;
  pauseOnFailure: boolean;
}

export class TemporalClientGateway {
  private connection: Connection | null = null;
  private client: Client | null = null;

  async getClient(): Promise<Client> {
    if (this.client) return this.client;

    this.connection = await Connection.connect({
      address: config.TEMPORAL_ADDRESS,
      tls: config.TEMPORAL_TLS_ENABLED ? {} : undefined,
    });

    this.client = new Client({
      connection: this.connection,
      namespace: config.TEMPORAL_NAMESPACE,
    });

    return this.client;
  }

  async getDiagnostics(): Promise<TemporalDiagnostics> {
    const start = Date.now();

    try {
      const client = await this.getClient();
      await client.connection.workflowService.getSystemInfo({});

      return {
        status: "ok",
        address: config.TEMPORAL_ADDRESS,
        namespace: config.TEMPORAL_NAMESPACE,
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        uiBaseUrl: config.TEMPORAL_UI_BASE_URL,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Temporal connection failed";
      logger.warn({ err }, "Temporal diagnostics failed");

      return {
        status: "error",
        address: config.TEMPORAL_ADDRESS,
        namespace: config.TEMPORAL_NAMESPACE,
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        uiBaseUrl: config.TEMPORAL_UI_BASE_URL,
        latencyMs: Date.now() - start,
        error: message,
      };
    }
  }

  async getTaskQueueDiagnostics(taskQueue = config.TEMPORAL_TASK_QUEUE): Promise<TemporalTaskQueueDiagnostics> {
    try {
      const client = await this.getClient();
      const [workflow, activity] = await Promise.all([
        client.connection.workflowService.describeTaskQueue({
          namespace: config.TEMPORAL_NAMESPACE,
          taskQueue: { name: taskQueue },
          taskQueueType: temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW,
          reportStats: true,
          includeTaskQueueStatus: true,
        }),
        client.connection.workflowService.describeTaskQueue({
          namespace: config.TEMPORAL_NAMESPACE,
          taskQueue: { name: taskQueue },
          taskQueueType: temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_ACTIVITY,
          reportStats: true,
          includeTaskQueueStatus: true,
        }),
      ]);
      const workflowPollers = workflow.pollers ?? [];
      const activityPollers = activity.pollers ?? [];

      return {
        status: "ok",
        taskQueue,
        workflowPollerCount: workflowPollers.length,
        activityPollerCount: activityPollers.length,
        pollers: [
          ...workflowPollers.map((poller) => ({
            identity: poller.identity ?? "unknown",
            taskQueueType: "workflow" as const,
            lastAccessTime: this.protoDate(poller.lastAccessTime),
          })),
          ...activityPollers.map((poller) => ({
            identity: poller.identity ?? "unknown",
            taskQueueType: "activity" as const,
            lastAccessTime: this.protoDate(poller.lastAccessTime),
          })),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Temporal task queue diagnostics failed";
      logger.warn({ err, taskQueue }, "Temporal task queue diagnostics failed");

      return {
        status: "error",
        taskQueue,
        workflowPollerCount: 0,
        activityPollerCount: 0,
        pollers: [],
        error: message,
      };
    }
  }

  async startWorkflow(input: TemporalStartInput): Promise<TemporalStartResult> {
    const client = await this.getClient();
    const handle = await client.workflow.start(input.workflowType, {
      taskQueue: input.taskQueue,
      workflowId: input.workflowId,
      args: input.args,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    };
  }

  async describeWorkflow(workflowId: string, runId?: string): Promise<TemporalDescribeResult> {
    const client = await this.getClient();
    const description = await client.workflow.getHandle(workflowId, runId).describe();

    return {
      statusName: description.status.name,
      closeTime: description.closeTime,
    };
  }

  async queryWorkflow<T = unknown>(workflowId: string, queryName: string, runId?: string): Promise<T> {
    const client = await this.getClient();
    return client.workflow.getHandle(workflowId, runId).query<T>(queryName);
  }

  async cancelWorkflow(workflowId: string, runId?: string): Promise<void> {
    const client = await this.getClient();
    await client.workflow.getHandle(workflowId, runId).cancel();
  }

  async signalWorkflow(workflowId: string, signalName: string, args: unknown[], runId?: string): Promise<void> {
    const client = await this.getClient();
    await client.workflow.getHandle(workflowId, runId).signal(signalName, ...args);
  }

  async createSchedule(input: TemporalScheduleCreateInput): Promise<TemporalScheduleDescription> {
    const client = await this.getClient();
    const handle = await client.schedule.create({
      scheduleId: input.scheduleId,
      spec: {
        cronExpressions: [input.cronExpression],
        timezone: input.timezone,
      },
      action: {
        type: "startWorkflow",
        workflowType: input.workflowType,
        taskQueue: input.taskQueue,
        args: input.args,
      },
      policies: {
        overlap: input.overlapPolicy,
        catchupWindow: input.catchupWindowSeconds * 1000,
        pauseOnFailure: input.pauseOnFailure,
      },
      memo: input.memo,
      state: {
        paused: input.paused ?? false,
        note: input.paused ? "Created paused from application admin" : undefined,
      },
    });

    return this.normalizeScheduleDescription(await handle.describe());
  }

  async describeSchedule(scheduleId: string): Promise<TemporalScheduleDescription> {
    const client = await this.getClient();
    return this.normalizeScheduleDescription(await client.schedule.getHandle(scheduleId).describe());
  }

  async pauseSchedule(scheduleId: string, note?: string): Promise<TemporalScheduleDescription> {
    const client = await this.getClient();
    const handle = client.schedule.getHandle(scheduleId);
    await handle.pause(note);
    return this.normalizeScheduleDescription(await handle.describe());
  }

  async unpauseSchedule(scheduleId: string, note?: string): Promise<TemporalScheduleDescription> {
    const client = await this.getClient();
    const handle = client.schedule.getHandle(scheduleId);
    await handle.unpause(note);
    return this.normalizeScheduleDescription(await handle.describe());
  }

  async triggerSchedule(scheduleId: string): Promise<void> {
    const client = await this.getClient();
    await client.schedule.getHandle(scheduleId).trigger(ScheduleOverlapPolicy.ALLOW_ALL);
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    const client = await this.getClient();
    await client.schedule.getHandle(scheduleId).delete();
  }

  async close(): Promise<void> {
    await this.connection?.close();
    this.connection = null;
    this.client = null;
  }

  private normalizeScheduleDescription(description: ScheduleDescription): TemporalScheduleDescription {
    return {
      scheduleId: description.scheduleId,
      paused: description.state.paused,
      note: description.state.note,
      nextActionTimes: description.info.nextActionTimes,
      recentActions: description.info.recentActions,
      runningActions: description.info.runningActions,
      numActionsTaken: description.info.numActionsTaken,
      numActionsMissedCatchupWindow: description.info.numActionsMissedCatchupWindow,
      numActionsSkippedOverlap: description.info.numActionsSkippedOverlap,
      overlapPolicy: description.policies.overlap,
      catchupWindowMs: description.policies.catchupWindow,
      pauseOnFailure: description.policies.pauseOnFailure,
    };
  }

  private protoDate(value: unknown): Date | undefined {
    if (!value || typeof value !== "object") return undefined;
    if (value instanceof Date) return value;
    const maybe = value as { seconds?: number | Longish; nanos?: number };
    const seconds =
      typeof maybe.seconds === "number" ? maybe.seconds : typeof maybe.seconds === "object" ? Number(maybe.seconds) : 0;
    if (!seconds) return undefined;
    return new Date(seconds * 1000 + Math.floor((maybe.nanos ?? 0) / 1_000_000));
  }
}

interface Longish {
  toString(): string;
}

export const temporalClientGateway = new TemporalClientGateway();
