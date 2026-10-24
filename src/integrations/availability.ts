import { IntegrationConnectionStatus } from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import { getIntegrationProvider, type IntegrationProviderRegistration } from "./index.js";

/**
 * Single source of truth for "can this connection serve this requirement?".
 * Workflow start gating (IntegrationService) and Activity-side resolution
 * (IntegrationConnectionResolverService / IntegrationResolverService) must both
 * call these functions so the start page never reports AVAILABLE for a
 * connection the Worker would reject.
 */
export type IntegrationAvailabilityStatus =
  | "AVAILABLE"
  | "MISSING"
  | "DISABLED"
  | "REQUIREMENT_MISSING"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_UNAVAILABLE"
  | "PROVIDER_MISMATCH"
  | "PROVIDER_UNREGISTERED"
  | "CAPABILITY_MISSING";

export interface IntegrationAvailability {
  status: IntegrationAvailabilityStatus;
  reason: string;
}

export interface AvailabilityConnection {
  orgId: string;
  providerKey: string;
  status: IntegrationConnectionStatus | string;
  disabledAt?: Date | null;
  deletedAt?: Date | null;
}

export interface AvailabilityRequirement {
  providerKey?: string | null;
  capabilityKey?: string | null;
}

export interface AvailabilityBinding {
  isEnabled: boolean;
  connection: AvailabilityConnection | null;
}

type ProviderLookup = (providerKey: string) => Pick<IntegrationProviderRegistration, "capabilities"> | null;

const AVAILABLE: IntegrationAvailability = { status: "AVAILABLE", reason: "Connection is available" };

export function evaluateConnectionAvailability(
  orgId: string,
  connection: AvailabilityConnection | null,
  requirement: AvailabilityRequirement,
  lookupProvider: ProviderLookup = getIntegrationProvider
): IntegrationAvailability {
  if (!connection || connection.orgId !== orgId || connection.deletedAt) {
    return { status: "CONNECTION_NOT_FOUND", reason: "Integration connection not found" };
  }
  if (connection.status !== IntegrationConnectionStatus.ACTIVE || connection.disabledAt) {
    return { status: "CONNECTION_UNAVAILABLE", reason: "Integration connection is unavailable" };
  }
  if (requirement.providerKey && connection.providerKey !== requirement.providerKey) {
    return { status: "PROVIDER_MISMATCH", reason: "Integration provider mismatch" };
  }
  const provider = lookupProvider(connection.providerKey);
  if (!provider) {
    return { status: "PROVIDER_UNREGISTERED", reason: "Integration provider is not registered" };
  }
  if (requirement.capabilityKey && !provider.capabilities.includes(requirement.capabilityKey)) {
    return { status: "CAPABILITY_MISSING", reason: "Integration capability is unavailable" };
  }
  return AVAILABLE;
}

export function evaluateBindingAvailability(
  orgId: string,
  binding: AvailabilityBinding | null,
  requirement: AvailabilityRequirement,
  lookupProvider: ProviderLookup = getIntegrationProvider
): IntegrationAvailability {
  if (!binding) return { status: "MISSING", reason: "Workflow integration binding not found" };
  if (!binding.isEnabled) return { status: "DISABLED", reason: "Workflow integration binding is disabled" };
  return evaluateConnectionAvailability(orgId, binding.connection, requirement, lookupProvider);
}

const STATUS_CODES: Record<Exclude<IntegrationAvailabilityStatus, "AVAILABLE">, number> = {
  MISSING: 404,
  REQUIREMENT_MISSING: 404,
  CONNECTION_NOT_FOUND: 404,
  DISABLED: 403,
  CONNECTION_UNAVAILABLE: 409,
  PROVIDER_MISMATCH: 400,
  PROVIDER_UNREGISTERED: 400,
  CAPABILITY_MISSING: 400,
};

/** Thrown by resolvers when availability is not AVAILABLE; Activities map it to a non-retryable failure. */
export class IntegrationUnavailableError extends AppError {
  constructor(public readonly availabilityStatus: Exclude<IntegrationAvailabilityStatus, "AVAILABLE">, message: string) {
    super(message, STATUS_CODES[availabilityStatus], `INTEGRATION_${availabilityStatus}`);
    this.name = "IntegrationUnavailableError";
  }
}

export function assertAvailable(availability: IntegrationAvailability) {
  if (availability.status !== "AVAILABLE") {
    throw new IntegrationUnavailableError(availability.status, availability.reason);
  }
}
