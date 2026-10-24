// Local signed-webhook receiver for webhook.outbound tests, acceptance runs and
// local development (`npm run mock:webhook`). It verifies HMAC signatures,
// deduplicates on Idempotency-Key (the receiver half of exactly-once), and can
// inject faults to exercise retry semantics. Test fixture only.
import { createServer } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * @typedef {"503" | "500-after-processing" | "reset-after-processing" | "hang"} MockWebhookFault
 * @param {{ signingSecret: string, port?: number, host?: string, toleranceSeconds?: number, log?: (line: string) => void }} options
 */
export async function startMockWebhookServer({ signingSecret, port = 0, host = "127.0.0.1", toleranceSeconds = 300, log } = {}) {
  /** Processed deliveries keyed by Idempotency-Key. */
  const deliveries = new Map();
  /** Every request with its outcome, in arrival order. */
  const requests = [];
  /** @type {MockWebhookFault[]} */
  const faults = [];
  const verify = (timestamp, signature, body) => {
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
    const expected = Buffer.from(`v1=${createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex")}`);
    const actual = Buffer.from(String(signature));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const key = req.headers["idempotency-key"];
      const record = { method: req.method, path: req.url, idempotencyKey: key, event: req.headers["x-webhook-event"], test: req.headers["x-webhook-test"] === "1", outcome: "" };
      requests.push(record);
      const finish = (outcome) => { record.outcome = outcome; log?.(`${req.method} ${req.url} key=${key} -> ${outcome}`); };
      if (!verify(req.headers["x-webhook-timestamp"], req.headers["x-webhook-signature"], body)) {
        finish("unauthorized");
        res.writeHead(401).end();
        return;
      }
      const fault = faults.shift();
      if (fault === "503") { finish("503"); res.writeHead(503).end(); return; }
      if (fault === "hang") { finish("hang"); return; }
      if (record.test) { finish("test"); res.writeHead(200).end(); return; }
      const existing = deliveries.get(key);
      if (existing) {
        finish("duplicate");
        res.writeHead(200, { "x-delivery-id": existing.deliveryId, "x-webhook-duplicate": "1" }).end();
        return;
      }
      const deliveryId = randomUUID();
      deliveries.set(key, { deliveryId, event: record.event, body: JSON.parse(body), headers: { ...req.headers } });
      if (fault === "500-after-processing") { finish("processed-then-500"); res.writeHead(500).end(); return; }
      if (fault === "reset-after-processing") { finish("processed-then-reset"); req.socket.destroy(); return; }
      finish("processed");
      res.writeHead(200, { "x-delivery-id": deliveryId, "content-type": "application/json" }).end(JSON.stringify({ received: true }));
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    deliveries,
    requests,
    /** @param {...MockWebhookFault} next */
    injectFaults: (...next) => { faults.push(...next); },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_WEBHOOK_PORT ?? 4010);
  const mock = await startMockWebhookServer({
    signingSecret: process.env.MOCK_WEBHOOK_SECRET ?? "seed-webhook-signing-secret",
    port,
    log: (line) => console.log(`[mock-webhook] ${line}`),
  });
  console.log(`[mock-webhook] listening on ${mock.url} (Idempotency-Key dedupe, HMAC-SHA256 verification)`);
}
