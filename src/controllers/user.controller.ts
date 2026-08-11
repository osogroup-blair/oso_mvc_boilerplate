// Example REST controller (non-admin). Shows the standard flow:
//   validate → call service → wrap in response envelope.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { userService } from "../services/user.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { ok } from "../lib/response.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "USER"]).default("USER"),
});

export class UserController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query);
      const [users, total] = await Promise.all([
        userService.list(params),
        userService.count(params.search),
      ]);
      res.json(ok(users, buildMeta(query, total)));
    } catch (err) {
      next(err);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(req.params.id);
      res.json(ok(user));
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createUserSchema.parse(req.body);
      const user = await userService.create(data, req.user?.id);
      res.status(201).json(ok(user));
    } catch (err) {
      next(err);
    }
  }
}

export const userController = new UserController();
