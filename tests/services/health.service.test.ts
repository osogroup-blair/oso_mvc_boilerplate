import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthService } from "../../src/services/health.service.js";

const makeSystem = () => ({
  pingDatabase: vi.fn(),
});

const makeTemporal = () => ({
  getDiagnostics: vi.fn(),
});

describe("HealthService", () => {
  let system: ReturnType<typeof makeSystem>;
  let temporal: ReturnType<typeof makeTemporal>;
  let service: HealthService;

  beforeEach(() => {
    system = makeSystem();
    temporal = makeTemporal();
    service = new HealthService(system as never, temporal as never);
  });

  it("reports up when database and Temporal are available", async () => {
    system.pingDatabase.mockResolvedValue(undefined);
    temporal.getDiagnostics.mockResolvedValue({
      status: "ok",
      address: "localhost:7233",
      namespace: "default",
      taskQueue: "oso-workflows",
      uiBaseUrl: "http://localhost:8233",
      latencyMs: 4,
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      status: "up",
      db: "up",
      temporal: { status: "ok" },
    });
  });

  it("reports degraded when Temporal is unavailable but the database is up", async () => {
    system.pingDatabase.mockResolvedValue(undefined);
    temporal.getDiagnostics.mockResolvedValue({
      status: "error",
      address: "localhost:7233",
      namespace: "default",
      taskQueue: "oso-workflows",
      uiBaseUrl: "http://localhost:8233",
      latencyMs: 12,
      error: "connection refused",
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      status: "degraded",
      db: "up",
      temporal: { status: "error" },
    });
  });

  it("reports down when the database is unavailable", async () => {
    system.pingDatabase.mockRejectedValue(new Error("db unavailable"));
    temporal.getDiagnostics.mockResolvedValue({
      status: "ok",
      address: "localhost:7233",
      namespace: "default",
      taskQueue: "oso-workflows",
      uiBaseUrl: "http://localhost:8233",
      latencyMs: 3,
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      status: "down",
      db: "down",
      temporal: { status: "ok" },
    });
  });
});
