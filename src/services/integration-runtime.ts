import { config } from "../config/index.js";
import type { ProviderRuntime } from "../integrations/index.js";

/** Platform egress options for providers; providers never read config themselves. */
export function providerRuntimeFromConfig(): ProviderRuntime {
  return { allowPrivateNetwork: config.INTEGRATION_ALLOW_PRIVATE_EGRESS };
}
