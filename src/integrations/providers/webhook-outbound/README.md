# webhook.outbound

Reference provider for **real outbound HTTP with side effects**. Copy this
module (not `synthetic-echo`) when adding a provider that calls an external API.

| | |
|---|---|
| Capabilities | `deliver` |
| Credentials | `signingSecret` (min 16 chars, HMAC-SHA256 key) |
| Config | `baseUrl` (http(s), no credentials/query/fragment), `path`, optional `testPath`, optional non-secret `extraHeaders` ("Name: value" lines; reserved headers refused) |
| Egress | `{ hosts: "config.baseUrl" }`: requests may only go to the configured host; private/loopback addresses and plain http are refused unless the platform sets `INTEGRATION_ALLOW_PRIVATE_EGRESS=true` (never in production) |

## Operations

| Operation | retrySafe | Provider idempotency key | Data classes | Retention |
|---|---|---|---|---|
| `deliver` | yes | yes (`Idempotency-Key: <operationKey>`) | pii | 30 days |

`deliver` POSTs `{ event, payload }` with:

- `X-Webhook-Timestamp` and `X-Webhook-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`;
- `Idempotency-Key`: the Activity operation key. It stays the same across
  Temporal retries, so a receiver that deduplicates on it processes each event
  exactly once, even when a response is lost after processing;
- `X-Webhook-Event`.

The result is `{ status, deliveryId, duplicate }` (from `X-Delivery-Id` /
`X-Webhook-Duplicate: 1`). The response body is never stored.

## Failure semantics

All network calls go through `src/integrations/http.ts`. Non-2xx responses
become `ProviderHttpError`, and Activities pass `classifyProviderError` as
`policy.classifyError`:

- 429/5xx and failures before the request was sent: **retryable**;
- other 4xx and egress denials: **terminal**. `runIntegrationOperation` raises
  non-retryable `INTEGRATION_PROVIDER_REJECTED`;
- timeouts or connection loss after sending: **uncertain**. The retry reuses the
  same `Idempotency-Key`.

`testConnection` sends a signed `webhook.test` event (with `X-Webhook-Test: 1`)
to `testPath` (or `path`) and always returns `{ ok, message }`. It never throws
and never echoes response bodies.

## Files

- `schemas.ts`: Zod credential and config schemas, reserved headers.
- `adapter.ts`: `WebhookOutboundAdapter`, request signing, the egress-checked client.
- `index.ts`: the registration (forms, validation, test, adapter, redaction, operations, egress).
- `contract.fixture.ts`: inputs for the provider contract suite (`tests/providers/`).

Local receiver: `npm run mock:webhook` (port 4010, secret
`seed-webhook-signing-secret`, matching the seeded, disabled "Seed Billing
Webhook (local mock)" connection).
