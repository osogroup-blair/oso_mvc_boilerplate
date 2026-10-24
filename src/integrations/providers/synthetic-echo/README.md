# synthetic.echo

Local, no-network provider that proves the integration platform end to end:
encrypted credentials, admin connection tests, workflow requirement bindings,
Activity-side resolution, and idempotent replay. It is the binding target for
`platform.test` and every migrated showcase workflow.

| | |
|---|---|
| Capabilities | `echo` |
| Credentials | `apiToken` (min 8 chars; development-only synthetic secret) |
| Config | `endpointLabel` (optional, non-secret) |
| Egress | none |

## Operations

| Operation | retrySafe | Provider idempotency key | Data classes | Notes |
|---|---|---|---|---|
| `echo` | yes | no | none | Returns the payload plus `connectionId`/`endpointLabel`. No side effect, so repeats are harmless. |

## Files

- `schemas.ts`: Zod credential and config schemas.
- `adapter.ts`: `SyntheticEchoAdapter` interface and factory.
- `index.ts`: the provider registration (forms, validation, test, adapter, redaction, operations).
- `contract.fixture.ts`: inputs for the provider contract suite (`tests/providers/`).

Do not copy this provider for real network integrations; copy
`webhook-outbound` instead (egress policy, shared HTTP client, signed requests,
provider idempotency keys, error classification).
