---
name: private-assets
description: Use for protected files, resource access policies and private storage recovery.
---

# Private assets

Read `docs/blueprint/EXTENSION-CONTRACTS.md` and `DECISIONS.md` before extending.

- Use `PrivateAssetService` with a mandatory resource-specific policy. The policy
  checks current actor/org/resource/assignment rules; no permissive singleton.
- Carry a stable UUID across upload retries; changed bytes or metadata conflict.
- No public URL, public media listing or generic private download route exists.
- PENDING is unavailable. Verify size/hash/backend before publication/read;
  recover with the same operation or `recoverUpload`, or discard only under the
  authorized resource retention policy. Retry DELETING cleanup through `remove`.
- Local-only backend: isolated root, generated UUID keys, no-follow reads,
  exclusive writes and bounded bytes. S3 requires separate implementation/proof.
- A consumer download controller authenticates, applies the policy, sets private
  no-store caching and safe attachment headers. Never expose storage keys/paths.
- Back up private metadata and volume together. Never relabel protected bytes
  public for rollback. No automatic legacy confidential-URL migration is implied.
- Test policy denial, wrong scope/backend, corrupt/oversized bytes, same-key
  mismatch, races, partial storage/DB failure and recovery on owned fixtures.
