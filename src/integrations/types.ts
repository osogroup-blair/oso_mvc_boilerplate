import type { FormDefinition } from "../lib/forms.js";

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

/** Data classes an operation may send or receive; drives retention and redaction rules. */
export type IntegrationDataClass = "none" | "pii" | "financial" | "credentials";

/**
 * Declared semantics of one provider operation. Activities read these through
 * runIntegrationOperation instead of passing per-call literals, so retry
 * behaviour is reviewed once, next to the adapter that implements it.
 */
export interface ProviderOperation {
  description: string;
  /** True only when repeating the same operation key cannot duplicate an external side effect. */
  retrySafe: boolean;
  /** True when the provider accepts an idempotency key (the Activity operationKey) for this call. */
  supportsProviderIdempotencyKey: boolean;
  /** Days to keep the stored Activity response; enforced from Phase 4 (INT-14). */
  responseRetentionDays?: number;
  dataClasses: readonly IntegrationDataClass[];
}

export interface IntegrationProviderRegistration<
  TKey extends string = string,
  TAdapter = unknown,
  TOperation extends string = string,
> {
  key: TKey;
  label: string;
  description?: string;
  capabilities: readonly string[];
  operations: Readonly<Record<TOperation, ProviderOperation>>;
  credentialForm: FormDefinition;
  configForm: FormDefinition;
  validateCredentials(input: unknown): Record<string, unknown>;
  validateConfig(input: unknown): Record<string, unknown>;
  /** Must honour `signal`; the platform aborts it when the admin test timeout elapses. */
  testConnection(input: {
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<IntegrationTestResult>;
  createAdapter(input: {
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
    connectionId: string;
  }): TAdapter;
  redactConfig(config: Record<string, unknown>): Record<string, unknown>;
  /** Optional provider-specific scrubbing of test messages, applied after credential-value scrubbing. */
  redactMessage?(message: string): string;
}

/** Identity helper that keeps literal key/operation types for the typed registry. */
export function defineIntegrationProvider<const TKey extends string, TAdapter, const TOperation extends string>(
  registration: IntegrationProviderRegistration<TKey, TAdapter, TOperation>
) {
  return registration;
}
