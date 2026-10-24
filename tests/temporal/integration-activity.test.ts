import { describe, it, expect, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import { AppError } from "../../src/lib/AppError.js";
import { IntegrationUnavailableError } from "../../src/integrations/availability.js";
import {
  createIntegrationOperationRunner,
  toIntegrationConfigurationFailure,
} from "../../src/temporal/activities/integration-activity.js";
import { INTEGRATION_FAILURE_TYPES, isIntegrationConfigurationFailure } from "../../src/temporal/contracts.js";
import { classifyProviderError, getIntegrationProvider, ProviderHttpError } from "../../src/integrations/index.js";

const input = {
  orgId: "org-1",
  workflowDefinitionKey: "platform.test",
  requirementKey: "syntheticEcho",
  providerKey: "synthetic.echo" as const,
  operation: "echo" as const,
  scope: "integration.synthetic.echo",
  idempotencyKey: "wf-1:step",
  request: { payload: { a: 1 } },
};

const resolved = { adapter: {}, connection: { id: "conn-1", name: "Synthetic", providerKey: "synthetic.echo" } };

function makeDeps() {
  return {
    resolver: { resolve: vi.fn().mockResolvedValue(resolved) },
    idempotency: {
      run: vi.fn(async (_org, _scope, _key, _request, operation: (key: string) => Promise<unknown>) => ({
        value: await operation("op-key"),
        replayed: false,
      })),
      findSucceeded: vi.fn().mockResolvedValue(null),
    },
    providers: vi.fn(getIntegrationProvider),
  };
}

describe("runIntegrationOperation", () => {
  it("resolves before reserving and passes the resolved adapter to the operation", async () => {
    const deps = makeDeps();
    const run = createIntegrationOperationRunner(deps as never);
    const operation = vi.fn().mockResolvedValue({ ok: true });

    const result = await run(input, operation);

    expect(result).toEqual({ value: { ok: true }, replayed: false });
    expect(deps.resolver.resolve.mock.invocationCallOrder[0]).toBeLessThan(deps.idempotency.run.mock.invocationCallOrder[0]);
    expect(deps.resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ providerKey: "synthetic.echo" }));
    expect(operation).toHaveBeenCalledWith(resolved, "op-key");
    // retrySafe comes from the synthetic.echo "echo" operation declaration, not the call site.
    expect(deps.idempotency.run).toHaveBeenCalledWith("org-1", input.scope, input.idempotencyKey, input.request, expect.any(Function), { retrySafe: true });
  });

  it("takes retry safety from the declared operation and ignores call-site overrides", async () => {
    const deps = makeDeps();
    const echo = getIntegrationProvider("synthetic.echo")!;
    deps.providers.mockReturnValue({ ...echo, operations: { echo: { ...echo.operations.echo, retrySafe: false } } });
    const run = createIntegrationOperationRunner(deps as never);
    const classifyError = () => "terminal" as const;

    await run(input, vi.fn().mockResolvedValue({}), { classifyError, retrySafe: true } as never);

    expect(deps.idempotency.run.mock.calls[0][5]).toEqual({ classifyError, retrySafe: false });
  });

  it("rejects an undeclared provider operation before resolving or reserving", async () => {
    const deps = makeDeps();
    const run = createIntegrationOperationRunner(deps as never);

    const error = await run({ ...input, operation: "deliver" as never }, vi.fn()).catch((err: unknown) => err);

    expect(error).toMatchObject({ nonRetryable: true, type: INTEGRATION_FAILURE_TYPES.RESOLUTION_FAILED });
    expect(deps.resolver.resolve).not.toHaveBeenCalled();
    expect(deps.idempotency.run).not.toHaveBeenCalled();
  });

  it("fails a missing binding fast as non-retryable without creating an idempotency reservation", async () => {
    const deps = makeDeps();
    deps.resolver.resolve.mockRejectedValue(new IntegrationUnavailableError("MISSING", "Workflow integration binding not found"));
    const run = createIntegrationOperationRunner(deps as never);

    const error = await run(input, vi.fn()).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ nonRetryable: true, type: INTEGRATION_FAILURE_TYPES.MISSING });
    expect(deps.idempotency.run).not.toHaveBeenCalled();
    expect(deps.idempotency.findSucceeded).toHaveBeenCalledWith("org-1", input.scope, input.idempotencyKey, input.request);
  });

  it("replays a prior success when the binding became unavailable after the side effect completed", async () => {
    const deps = makeDeps();
    deps.resolver.resolve.mockRejectedValue(new IntegrationUnavailableError("CONNECTION_UNAVAILABLE", "Integration connection is unavailable"));
    deps.idempotency.findSucceeded.mockResolvedValue({ value: { delivered: true } });
    const run = createIntegrationOperationRunner(deps as never);
    const operation = vi.fn();

    await expect(run(input, operation)).resolves.toEqual({ value: { delivered: true }, replayed: true });
    expect(operation).not.toHaveBeenCalled();
  });

  it("lets infrastructure errors during resolution stay retryable", async () => {
    const deps = makeDeps();
    const dbError = new Error("connection reset");
    deps.resolver.resolve.mockRejectedValue(dbError);
    const run = createIntegrationOperationRunner(deps as never);

    await expect(run(input, vi.fn())).rejects.toBe(dbError);
    expect(deps.idempotency.findSucceeded).not.toHaveBeenCalled();
  });

  it("leaves provider errors to the idempotency policy", async () => {
    const deps = makeDeps();
    const providerError = new Error("503");
    const run = createIntegrationOperationRunner(deps as never);

    await expect(run(input, vi.fn().mockRejectedValue(providerError))).rejects.toBe(providerError);
    expect(deps.idempotency.run).toHaveBeenCalled();
  });
});

describe("runIntegrationOperation provider rejections", () => {
  it("turns a terminal provider error into a non-retryable INTEGRATION_PROVIDER_REJECTED", async () => {
    const deps = makeDeps();
    const run = createIntegrationOperationRunner(deps as never);
    const rejected = ProviderHttpError.fromStatus(400);

    const error = await run(input, vi.fn().mockRejectedValue(rejected), { classifyError: classifyProviderError }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({ nonRetryable: true, type: INTEGRATION_FAILURE_TYPES.PROVIDER_REJECTED });
    expect((error as Error).message).toContain("HTTP 400");
  });

  it("keeps retryable and uncertain provider errors retryable", async () => {
    for (const providerError of [ProviderHttpError.fromStatus(503), new ProviderHttpError("TIMEOUT", "timeout", { sent: true })]) {
      const run = createIntegrationOperationRunner(makeDeps() as never);
      await expect(run(input, vi.fn().mockRejectedValue(providerError), { classifyError: classifyProviderError })).rejects.toBe(providerError);
    }
  });
});

describe("toIntegrationConfigurationFailure", () => {
  it("maps every availability status, validation, and resolver AppError to a registered non-retryable type", () => {
    const statuses = ["MISSING", "DISABLED", "REQUIREMENT_MISSING", "CONNECTION_NOT_FOUND", "CONNECTION_UNAVAILABLE", "PROVIDER_MISMATCH", "PROVIDER_UNREGISTERED", "CAPABILITY_MISSING"] as const;
    const errors: unknown[] = [
      ...statuses.map((status) => new IntegrationUnavailableError(status, status)),
      z.object({ apiToken: z.string() }).safeParse({}).error,
      AppError.forbidden("Integration credentials could not be decrypted"),
    ];
    for (const error of errors) {
      const failure = toIntegrationConfigurationFailure(error);
      expect(failure?.nonRetryable).toBe(true);
      expect(isIntegrationConfigurationFailure(failure?.type)).toBe(true);
    }
    expect(toIntegrationConfigurationFailure(new Error("network"))).toBeNull();
  });
});
