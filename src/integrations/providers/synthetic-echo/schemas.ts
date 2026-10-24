import { z } from "zod";

export const syntheticCredentialSchema = z.object({
  apiToken: z.string().trim().min(8, "Synthetic API token must be at least 8 characters"),
});

export const syntheticConfigSchema = z.object({
  endpointLabel: z.string().trim().max(120).optional().or(z.literal("")),
});

export const DEFAULT_ENDPOINT_LABEL = "Local synthetic endpoint";
