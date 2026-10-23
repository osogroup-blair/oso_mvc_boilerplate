import { Router } from "express";
import { gettingStartedController } from "../controllers/getting-started.controller.js";
export const gettingStartedRoutes = Router();
gettingStartedRoutes.get("/", gettingStartedController.show.bind(gettingStartedController));
