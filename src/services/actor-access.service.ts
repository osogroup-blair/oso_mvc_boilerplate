import { BaseService } from "./BaseService.js";
import { userModel } from "../models/user.model.js";
import { AppError } from "../lib/AppError.js";

/** Resolve current actor authority, rather than trusting browser role claims. */
export class ActorAccessService extends BaseService {
  constructor(private readonly users = userModel) { super("ActorAccessService"); }

  async actor(actorId?: string) {
    if (!actorId) throw AppError.unauthorized();
    const actor = await this.users.findAuthorizationById(actorId);
    if (!actor || !actor.isActive || actor.deletedAt || actor.role.deletedAt) throw AppError.forbidden("Actor is inactive");
    return actor;
  }

  can(actor: Awaited<ReturnType<ActorAccessService["actor"]>>, permission: string) {
    return actor.role.permissions.includes(permission);
  }

  async require(actorId: string | undefined, permission: string) {
    const actor = await this.actor(actorId);
    if (!this.can(actor, permission)) throw AppError.forbidden(`Missing permission: ${permission}`);
    return actor;
  }
}

export const actorAccessService = new ActorAccessService();
