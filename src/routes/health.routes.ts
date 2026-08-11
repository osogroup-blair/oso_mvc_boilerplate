import { Router } from "express";
import { ok, fail } from "../lib/response.js";
import { systemModel } from "../models/system.model.js";

export const healthRoutes = Router();

healthRoutes.get("/health", async (_req, res) => {
  try {
    await systemModel.pingDatabase();
    res.json(ok({ status: "up", db: "up" }));
  } catch {
    res.status(503).json(fail("DB_UNAVAILABLE", "Database unreachable"));
  }
});
