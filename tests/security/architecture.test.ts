import { describe, expect, it } from "vitest";
import { checkSource } from "../../scripts/check-architecture.mjs";

describe("architecture boundaries", () => {
  it("rejects runtime layer crossings, including dynamic imports and re-exports", () => {
    expect(checkSource("src/controllers/example.ts", 'import { model } from "../models/example.model.js";')).toHaveLength(1);
    expect(checkSource("src/controllers/example.ts", 'await import("../models/example.model.js");')).toHaveLength(1);
    expect(checkSource("src/routes/example.ts", 'export * from "../services/example.service.js";')).toHaveLength(1);
    expect(checkSource("src/temporal/workflows/example.ts", 'import { readFile } from "node:fs";')).toHaveLength(1);
    expect(checkSource("src/services/example.ts", 'import { prisma } from "../lib/prisma.js";')).toHaveLength(1);
    expect(checkSource("src/services/example.ts", 'const x = process.env.SECRET;')).toHaveLength(1);
  });
  it("keeps integration providers out of Workflow runtime code and application layers out of providers", () => {
    expect(checkSource("src/temporal/workflows/example.ts", 'import { getIntegrationProvider } from "../../integrations/index.js";')).toHaveLength(1);
    expect(checkSource("src/temporal/workflows/example.ts", 'import { workflowRegistrations } from "../workflow-registry.js";')).toHaveLength(1);
    expect(checkSource("src/temporal/workflows/example.ts", 'import type { RequirementKeyFor } from "../workflow-registry.js";')).toEqual([]);
    expect(checkSource("src/temporal/workflows/example.ts", 'import type { SyntheticEchoAdapter } from "../../integrations/index.js";')).toEqual([]);
    expect(checkSource("src/integrations/providers/example/index.ts", 'import { settingService } from "../../../services/setting.service.js";')).toHaveLength(1);
    expect(checkSource("src/integrations/providers/example/index.ts", 'import { prisma } from "../../../lib/prisma.js";')).not.toEqual([]);
    expect(checkSource("src/integrations/providers/example/index.ts", 'import { config } from "../../../config/index.js";')).toHaveLength(1);
    expect(checkSource("src/integrations/index.ts", 'import { activities } from "../temporal/activities/index.js";')).toHaveLength(1);
    expect(checkSource("src/integrations/providers/example/index.ts", 'import { z } from "zod";')).toEqual([]);
    expect(checkSource("src/integrations/availability.ts", 'import { AppError } from "../lib/AppError.js";')).toEqual([]);
    expect(checkSource("src/integrations/providers/example/adapter.ts", 'import { request } from "node:https";')).toHaveLength(1);
    expect(checkSource("src/integrations/providers/example/adapter.ts", 'await fetch("https://api.example.com");')).toHaveLength(1);
    expect(checkSource("src/integrations/providers/example/adapter.ts", 'import { createHmac } from "node:crypto";')).toEqual([]);
    expect(checkSource("src/integrations/http.ts", 'import { request } from "node:https";')).toEqual([]);
  });

  it("permits types/enums and the narrow cleanup seam without permitting arbitrary queries", () => {
    expect(checkSource("src/controllers/example.ts", 'import type { Row } from "../models/example.model.js";')).toEqual([]);
    expect(checkSource("src/services/example.ts", 'import { WorkflowExecutionStatus } from "@prisma/client";')).toEqual([]);
    expect(checkSource("src/services/example.ts", 'import { PrismaClient } from "@prisma/client";')).toHaveLength(1);
    expect(checkSource("src/server.ts", 'import { closeDatabase } from "./lib/prisma.js";')).toEqual([]);
    expect(checkSource("src/server.ts", 'import { prisma, closeDatabase } from "./lib/prisma.js";')).toHaveLength(1);
  });
});
