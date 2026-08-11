---
name: using-cross-cutting-services
description: Use when a feature needs authentication, authorization/permissions,
  caching, file storage, or audit logging. Explains when and how to use each
  shared service (AuthService, PermissionsService, CacheService, StorageService,
  AuditService) rather than reinventing them inline.
---

# SKILL: Using Cross-Cutting Services

Five shared services handle concerns that span features. Use them — do not
reinvent auth, caching, or file handling inside a domain service.

## AuthService — sessions & identity
`src/services/auth.service.ts`. Handles login, session verification, logout.
- You rarely call it directly; the `requireAuth` middleware does. Protect a
  route by adding `requireAuth` (see SKILL-route). It attaches `req.user`.
- The password hash is a stub — replace with argon2/bcrypt before production.

## PermissionsService — "can this actor do X?"
`src/services/permissions.service.ts`. A role→action matrix.
- Enforce in a service or controller:
  ```ts
  permissionsService.assert(req.user.role, "delete"); // throws AppError.forbidden if not allowed
  ```
- **To add a rule**: edit the `MATRIX` (add an action to a role) or extend the
  `Action` type for a new capability. For per-resource rules (e.g. "editors may
  only edit their own pages"), add a method like
  `canEditPage(user, page): boolean` and call it from the service.

## CacheService — swappable cache
`src/services/cache.service.ts`. In-memory Map today; the interface is
Redis-ready.
- Use for expensive, rarely-changing reads:
  ```ts
  const key = `user:${id}`;
  const hit = await cacheService.get<User>(key);
  if (hit) return hit;
  const fresh = await this.model.findById(id);
  await cacheService.set(key, fresh, 60); // ttl seconds
  return fresh;
  ```
- **Invalidate on write**: after update/delete, `cacheService.del(key)`.
- Don't cache per-request or user-specific auth state.

## StorageService — swappable file storage
`src/services/storage.service.ts`. Local disk now; S3-ready interface.
- Save an upload and store the returned URL on your model:
  ```ts
  const { url } = await storageService.put(`avatars/${id}.png`, buffer);
  await this.model.update(id, { avatarUrl: url });
  ```
- `get(key)` reads, `delete(key)` removes. Keep keys namespaced by domain.

## AuditService — who changed what
`src/services/audit.service.ts`. Already called by the example services on every
create/update/delete.
- **Always audit mutations.** Copy the pattern from `UserService`:
  ```ts
  await this.audit.record({ actorId, action: "widget.update", entityType: "Widget", entityId: id, changes: { before, after } });
  ```
- Auditing is best-effort and never throws — a failed audit won't break the
  primary operation.

## Rule of thumb
If a concern is not specific to one domain (identity, access, caching, files,
audit trail), it belongs in one of these services, injected into your domain
service — not written inline.
