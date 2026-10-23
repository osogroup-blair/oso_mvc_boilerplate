import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { PayloadCodec } from "@temporalio/common";
import temporalProto from "@temporalio/proto";
import { config } from "../config/index.js";

const Payload = temporalProto.temporal.api.common.v1.Payload;
const encoding = "binary/boilerplate-aes-gcm-v1";
export class EncryptedPayloadCodec implements PayloadCodec {
  constructor(private readonly active: string, private readonly keys: Record<string, string>, private readonly encrypt = true, private readonly legacy = true) {}
  private key(version: string) {
    const material = this.keys[version];
    if (!material || material.length < 32) throw Error("Payload key version unavailable");
    return Buffer.from(hkdfSync("sha256", material, "boilerplate-payload", version, 32));
  }
  async encode(payloads: temporalProto.temporal.api.common.v1.IPayload[]) {
    if (!this.encrypt) return payloads;
    return payloads.map(payload => {
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(this.active), iv);
      cipher.setAAD(Buffer.from(`${encoding}:${this.active}`));
      const ciphertext = Buffer.concat([cipher.update(Payload.encode(payload).finish()), cipher.final()]);
      return { metadata: { encoding: Buffer.from(encoding), keyVersion: Buffer.from(this.active) }, data: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]) };
    });
  }
  async decode(payloads: temporalProto.temporal.api.common.v1.IPayload[]) {
    return payloads.map(payload => {
      const format = Buffer.from(payload.metadata?.encoding ?? []).toString();
      if (format !== encoding) {
        if (format.startsWith("binary/boilerplate-") || !this.legacy) throw Error("Unsupported payload encoding");
        return payload;
      }
      const version = Buffer.from(payload.metadata?.keyVersion ?? []).toString(); const bytes = Buffer.from(payload.data ?? []);
      if (bytes.length < 28) throw Error("Invalid encrypted payload");
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key(version), bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(`${encoding}:${version}`)); decipher.setAuthTag(bytes.subarray(12, 28));
        return Payload.decode(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
      } catch { throw Error("Payload authentication or retained key unavailable"); }
    });
  }
}
export const payloadCodec = new EncryptedPayloadCodec(config.INTEGRATION_CREDENTIAL_KEY_VERSION,
  { ...config.INTEGRATION_CREDENTIAL_KEY_RING, [config.INTEGRATION_CREDENTIAL_KEY_VERSION]: config.INTEGRATION_CREDENTIAL_KEY },
  config.TEMPORAL_PAYLOAD_ENCRYPTION_ENABLED, config.TEMPORAL_ALLOW_LEGACY_PLAINTEXT);
export const temporalDataConverter = { payloadCodecs: [payloadCodec] };
// Start intents are always encrypted, including on local plaintext test servers.
const intentCodec = new EncryptedPayloadCodec(config.INTEGRATION_CREDENTIAL_KEY_VERSION,
  { ...config.INTEGRATION_CREDENTIAL_KEY_RING, [config.INTEGRATION_CREDENTIAL_KEY_VERSION]: config.INTEGRATION_CREDENTIAL_KEY }, true, false);
export async function sealIntent(value: unknown) {
  const [payload] = await intentCodec.encode([{ data: Buffer.from(JSON.stringify(value)), metadata: { encoding: Buffer.from("json/plain") } }]);
  return { data: Buffer.from(payload.data!).toString("base64"), metadata: Object.fromEntries(Object.entries(payload.metadata!).map(([key, bytes]) => [key, Buffer.from(bytes).toString("base64")])) };
}
export async function openIntent(envelope: unknown) {
  const stored = envelope as { data: string; metadata: Record<string, string> };
  const [payload] = await intentCodec.decode([{ data: Buffer.from(stored.data, "base64"), metadata: Object.fromEntries(Object.entries(stored.metadata).map(([key, value]) => [key, Buffer.from(value, "base64")])) }]);
  return JSON.parse(Buffer.from(payload.data!).toString());
}
