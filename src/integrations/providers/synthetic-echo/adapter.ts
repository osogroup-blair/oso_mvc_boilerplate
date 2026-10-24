import { DEFAULT_ENDPOINT_LABEL } from "./schemas.js";

export interface SyntheticEchoAdapter {
  echo(input: Record<string, unknown>): Promise<{
    providerKey: "synthetic.echo";
    connectionId: string;
    endpointLabel: unknown;
    echoed: Record<string, unknown>;
  }>;
}

export function createSyntheticEchoAdapter(input: {
  config: Record<string, unknown>;
  connectionId: string;
}): SyntheticEchoAdapter {
  return {
    async echo(payload) {
      return {
        providerKey: "synthetic.echo",
        connectionId: input.connectionId,
        endpointLabel: input.config.endpointLabel ?? DEFAULT_ENDPOINT_LABEL,
        echoed: payload,
      };
    },
  };
}
