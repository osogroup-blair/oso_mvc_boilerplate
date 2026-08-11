---
name: writing-tests
description: Use when writing or running tests, or when you need to verify a
  change. Covers the Vitest setup, the mock-the-model isolation pattern (and why
  constructor injection enables it), what to test at each layer, the test-DB
  strategy, and the commands to run.
---

# SKILL: Writing Tests

Tests use **Vitest**. The core pattern: services are testable in isolation
because dependencies are injected through the constructor — pass mocks in tests.

## Run
```bash
npm test          # once
npm run test:watch
```

## Why services are unit-testable
Every service takes its dependencies as constructor arguments with defaults:
```ts
constructor(private readonly model = new UserModel(), private readonly audit = auditService) {}
```
In production the defaults are used. In tests you pass mocks, so no database is
touched and you assert on behavior (e.g. "an audit entry was written").

## Service test pattern (copy this)
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WidgetService } from "../../src/services/widget.service.js";

const makeModel = () => ({ findById: vi.fn(), create: vi.fn(), /* …every method used… */ });
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("WidgetService", () => {
  let model: ReturnType<typeof makeModel>;
  let service: WidgetService;
  beforeEach(() => {
    model = makeModel();
    // casts isolate the mock's loose typing from the real signature
    service = new WidgetService(model as any, makeAudit() as any);
  });

  it("throws 404 when absent", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.getById("x")).rejects.toMatchObject({ statusCode: 404 });
  });
});
```
Note the `.js` extension on the import — see SKILL-conventions.

## What to test at each layer
- **Service** (highest value): business logic, error paths (404/403/conflict),
  that audit/permission calls happen. Mock the model.
- **Model**: only if it has non-trivial query logic worth locking down. These
  are integration tests — they need a real test database (see below).
- **Controller**: validation rejection and status/envelope shape. Mock the
  service.
- **View helper**: pure functions like `blockPartial` — test directly, no mocks.

## Test database strategy
- Model/integration tests run against a separate DB. `tests/setup.ts` points
  `DATABASE_URL` at `…/boilerplate_test` when unset.
- Create it once: `createdb boilerplate_test` (or a Docker equivalent), then
  `DATABASE_URL=…_test npx prisma migrate deploy`.
- Keep unit tests (mocked) and integration tests (real DB) separate so the fast
  suite stays fast.

## Reference implementations
`tests/services/user.service.test.ts` and `tests/services/page.service.test.ts`.
