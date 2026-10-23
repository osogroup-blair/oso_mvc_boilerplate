export interface PrivateAssetScope {
  orgId: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
}

/** Domain adapters must check current membership, assignment and resource policy. */
export interface PrivateAssetPolicy {
  authorize(scope: PrivateAssetScope, action: "upload" | "read" | "delete"): Promise<boolean>;
  allowedMimeTypes: readonly string[];
  maxBytes: number;
}
