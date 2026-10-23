import type { Request, Response, NextFunction } from "express";
import { gettingStartedService } from "../services/getting-started.service.js";
export class GettingStartedController {
  async show(_req: Request, res: Response, next: NextFunction) {
    try {
      res.render("pages/getting-started", { layout: "getting-started", title: "Build your next application", ...await gettingStartedService.getPage() });
    } catch (err) { next(err); }
  }
}
export const gettingStartedController = new GettingStartedController();
