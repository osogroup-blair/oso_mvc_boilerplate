import { AppError } from "./AppError.js";
import { temporalDataConverter } from "./temporalPayload.js";
import { Client, Connection, WorkflowIdReusePolicy, WorkflowIdConflictPolicy, WorkflowExecutionAlreadyStartedError, WorkflowUpdateFailedError } from "@temporalio/client";
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
import { temporalConnectionOptions } from "./temporalTransport.js";

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
  requestHash?: string;
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
  private connecting: Promise<Client> | null = null;

  async getClient(): Promise<Client> {
    if(this.client)return this.client;
    if(!this.connecting)this.connecting=this.connectClient();
    try{return await this.connecting;}finally{this.connecting=null;}
  }
  private async connectClient():Promise<Client> {
    this.connection=await Connection.connect(await temporalConnectionOptions());
    this.client=new Client({connection:this.connection,namespace:config.TEMPORAL_NAMESPACE,dataConverter:temporalDataConverter});return this.client;
  }
  async applicationCanary(timeoutMs=10000, taskQueue=config.TEMPORAL_TASK_QUEUE) {
    const client=await this.getClient();
    return client.connection.withDeadline(Date.now()+timeoutMs,async()=>{
      const handle=await client.workflow.start("temporalApplicationCanaryWorkflow",{workflowId:`application-canary-${crypto.randomUUID()}`,taskQueue,args:[],workflowExecutionTimeout:timeoutMs});
      return {workflowId:handle.workflowId,result:await handle.result()};
    });
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
      const message = "TEMPORAL_UNAVAILABLE";
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
      const recent = (poller: {lastAccessTime?:unknown}) => { const date=this.protoDate(poller.lastAccessTime);return Boolean(date && Date.now()-date.getTime()<120000); };
      const workflowPollers = (workflow.pollers ?? []).filter(recent);
      const activityPollers = (activity.pollers ?? []).filter(recent);

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
      const message = "TEMPORAL_POLLER_CHECK_FAILED";
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
    try {
      const handle = await client.workflow.start(input.workflowType, {
        taskQueue: input.taskQueue, workflowId: input.workflowId, args: input.args,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
        memo: input.requestHash ? { applicationStartHash: input.requestHash } : undefined,
      });
      return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError) || !input.requestHash) throw error;
      const existing = await client.workflow.getHandle(input.workflowId).describe();
      if (existing.memo?.applicationStartHash !== input.requestHash || existing.type !== input.workflowType) throw error;
      return { workflowId: input.workflowId, runId: existing.runId };
    }
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

  async workflowResult(workflowId: string, runId?: string): Promise<unknown> {
    const client = await this.getClient();
    return client.workflow.getHandle(workflowId, runId).result();
  }

  async cancelWorkflow(workflowId: string, runId?: string): Promise<void> {
    const client = await this.getClient();
    await client.workflow.getHandle(workflowId, runId).cancel();
  }

  async submitHumanAction(workflowId: string, signalName: string, input: { operationId: string }, runId?: string) {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId, runId);
    return client.connection.withDeadline(Date.now() + 10_000, async () => {
      try {
        return await handle.executeUpdate<{ accepted: true; operationId: string }, [typeof input]>(
          `${signalName}.submit`, { updateId: input.operationId, args: [input] },
        );
      } catch (error) {
        const type = (error as { cause?: { type?: string } })?.cause?.type;
        if (error instanceof WorkflowUpdateFailedError && ["ACTION_REJECTED", "ACTION_CONFLICT", "ACTION_ID_REQUIRED"].includes(type ?? ""))
          throw new AppError("Workflow rejected this action before queue acceptance", 409, "WORKFLOW_ACTION_REJECTED");
        // A Workflow may have closed after accepting the Update. Its retained
        // acknowledgement is still readable by operation ID.
        try { return await handle.getUpdateHandle<{ accepted: true; operationId: string }>(input.operationId).result(); }
        catch { throw error; }
      }
    });
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
    await this.connecting?.catch(()=>undefined);
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
