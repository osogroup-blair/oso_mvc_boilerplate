// Public CMS page routes.
import { Router } from "express";
import { pageController } from "../controllers/page.controller.js";
import { optionalAuth } from "../middleware/auth.js";

export const pageRoutes = Router();

pageRoutes.get("/:slug", optionalAuth, pageController.render.bind(pageController));
