# oso.model-router

OpenAI-compatible integration for the internal Oso Model Router.

| | |
|---|---|
| Credentials | `apiKey` (Bearer token; encrypted at rest and write-only in Admin Integrations) |
| Config | `baseUrl` (HTTPS origin; defaults to `https://models.oso.group`) |
| Capabilities | `chat.completions`, `tool-calling`, `json-output` |
| Operation | `complete` → `POST /v1/chat/completions` |
| Egress | Configured base URL host only; private/loopback IPs are blocked by the shared egress client |

The adapter supports the router's non-streaming chat completion contract,
function-calling request fields, structured output fields, and Oso `routing`
extensions. It returns only the completion id, model, choices, and token usage;
it omits router diagnostics and response headers. Streaming is intentionally
not supported by this Activity-compatible adapter.

The operation is not marked retry-safe and does not claim provider idempotency.
A timeout can leave a billable generation with an unknown outcome, so callers
must not automatically retry it as though it were a read-only operation.

## Using it for an agent framework

Resolve the connection inside an Activity and call `adapter.complete(...)` from
that Activity. Treat model text and tool-call arguments as untrusted output.
Do not put prompts, transcripts, API keys, raw completions, or tool payloads in
workflow input, signals, workflow state, summaries, audit records, or browser
payloads. An agent Activity should own prompt construction, tool execution,
and any safe result/reference returned to its Workflow.

To create the connection, open **Admin → Integrations → New Connection**, choose
**Oso Model Router**, enter the key in **Model Router API Key**, keep the router
base URL at its default unless your environment uses another origin, then use
**Test Connection** and save. The key is encrypted and cannot be viewed later;
rotate it by entering a replacement on the connection detail page.
