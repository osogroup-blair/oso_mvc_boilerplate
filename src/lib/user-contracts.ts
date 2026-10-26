/** Explicit output allowlist; auth-only credential records must stay internal. */
export function safeUser<T extends { id: string; name: string; email: string; roleId: string; isActive: boolean }>(user: T) {
  return { id: user.id, name: user.name, email: user.email, roleId: user.roleId, isActive: user.isActive };
}
