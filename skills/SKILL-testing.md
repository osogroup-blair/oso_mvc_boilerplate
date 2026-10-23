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
- `tests/setup.ts` overwrites the unit database URL with an unreachable synthetic
  endpoint and replaces Prisma with a throwing guard. Mock models/services;
  never disable the guard or copy a real application URL into unit tests.
- Test configuration skips dotenv. Owned fixtures supply explicit infrastructure.
- `npm run test:platform:owned -- --image=<local-image-or-digest>` creates a
  labelled disposable PostgreSQL container, ownership sentinel and per-run DB,
  deploys migrations, runs integration tests and removes only owned resources.
- After build, add `--temporal` for the actual built Worker SIGTERM/drain/restart
  test on a separate owned Temporal stack. This does not prove force deadlines
  or cross-release replay.
- Browser/upload acceptance has no localhost/browser fallback. It requires
  ownership checks for the app process, database and isolated browser profile.
- See `docs/blueprint/EXTENSION-CONTRACTS.md` for manifests, native dependency
  portability and the distinction between unit, runtime and release acceptance.

## Reference implementations
`tests/services/user.service.test.ts` and `tests/services/page.service.test.ts`.


October 20 local completion: recoverable starts, fenced effects, Update receipts, patch-gated Workflow modules, payload protection and owned full-stack acceptance are now implemented. See `docs/blueprint/EXTENSION-CONTRACTS.md` and `docs/blueprint/LOCAL-OPERATIONS.md` for current contracts and `docs/blueprint/EXECUTION-REPORT-2026-10-20.md` for evidence. Run `npm run test:local:all` after provisioning the explicit owned fixture dependencies. Existing production execution compatibility is still gated on the actual deployed history inventory.
