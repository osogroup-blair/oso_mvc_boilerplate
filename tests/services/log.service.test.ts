import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogService } from "../../src/services/log.service.js";

const makeModel = () => ({
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
});

describe("LogService", () => {
  let model: ReturnType<typeof makeModel>;
  let service: LogService;

  beforeEach(() => {
    model = makeModel();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new LogService(model as any);
  });

  it("passes filters through to the model list method", async () => {
    model.list.mockResolvedValue([]);
    const params = { skip: 0, take: 10 };
    const filters = { action: "user." };
    await service.list(params, filters);
    expect(model.list).toHaveBeenCalledWith(params, filters);
  });

  it("getSystemHealth returns expected shape", async () => {
    const health = await service.getSystemHealth();
    expect(health).toHaveProperty("db");
    expect(health.db).toHaveProperty("status");
    expect(health.db).toHaveProperty("latencyMs");
    expect(health).toHaveProperty("uptime");
    expect(health).toHaveProperty("memory");
    expect(health.memory).toHaveProperty("rss");
    expect(health).toHaveProperty("nodeVersion");
    expect(health).toHaveProperty("env");
  });
});
