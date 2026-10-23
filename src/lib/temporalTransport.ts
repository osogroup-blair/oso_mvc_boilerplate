import { open } from "node:fs/promises";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { config } from "../config/index.js";

export interface TemporalTransportConfig {
  TEMPORAL_ADDRESS: string;
  TEMPORAL_TLS_ENABLED: boolean;
  TEMPORAL_TLS_CA_PATH?: string;
  TEMPORAL_TLS_CLIENT_CERT_PATH?: string;
  TEMPORAL_TLS_CLIENT_KEY_PATH?: string;
  TEMPORAL_TLS_SERVER_NAME?: string;
  TEMPORAL_API_KEY?: string;
  NODE_ENV: string;
}
async function material(path: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw Error("Invalid TLS material size");
    return await file.readFile();
  } finally { await file.close(); }
}

/** SDK Client and NativeConnection share this validated, non-logging seam. */
export async function temporalConnectionOptions(input: TemporalTransportConfig = config) {
  if (Boolean(input.TEMPORAL_TLS_CLIENT_CERT_PATH) !== Boolean(input.TEMPORAL_TLS_CLIENT_KEY_PATH)) throw Error("Temporal certificate and key must be supplied together");
  const hasCredentials = input.TEMPORAL_API_KEY || input.TEMPORAL_TLS_CA_PATH || input.TEMPORAL_TLS_CLIENT_CERT_PATH || input.TEMPORAL_TLS_SERVER_NAME;
  if (!input.TEMPORAL_TLS_ENABLED) {
    if (input.NODE_ENV === "production" || hasCredentials) throw Error("Temporal TLS is required");
    return { address: input.TEMPORAL_ADDRESS, tls: undefined, apiKey: undefined };
  }
  try {
    const ca = input.TEMPORAL_TLS_CA_PATH ? await material(input.TEMPORAL_TLS_CA_PATH) : undefined;
    if (ca) new X509Certificate(ca);
    const pair = input.TEMPORAL_TLS_CLIENT_CERT_PATH && input.TEMPORAL_TLS_CLIENT_KEY_PATH
      ? { crt: await material(input.TEMPORAL_TLS_CLIENT_CERT_PATH), key: await material(input.TEMPORAL_TLS_CLIENT_KEY_PATH) } : undefined;
    if (pair && !new X509Certificate(pair.crt).checkPrivateKey(createPrivateKey(pair.key))) throw Error("TLS certificate mismatch");
    return { address: input.TEMPORAL_ADDRESS, apiKey: input.TEMPORAL_API_KEY,
      tls: { serverRootCACertificate: ca, clientCertPair: pair, serverNameOverride: input.TEMPORAL_TLS_SERVER_NAME } };
  } catch (_error) {
    // Paths, certificate contents and library errors can contain private data.
    // eslint-disable-next-line preserve-caught-error -- Transport failures must not retain secret-bearing causes.
    throw Error("Unable to load valid Temporal TLS material");
  }
}
