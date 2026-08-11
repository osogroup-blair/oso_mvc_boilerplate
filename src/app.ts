// Express app assembly. Order matters: security → parsing → logging →
// routes → 404 → error handler (last).
import express from "express";
import { engine } from "express-handlebars";
import Handlebars from "handlebars";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { securityHeaders, rateLimiter } from "./middleware/security.js";
import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { injectNavigation } from "./middleware/navigation.js";
import { registerAdminHelpers } from "./views/helpers/renderField.js";
import { registerViewHelpers } from "./views/helpers/viewHelpers.js";
import { router } from "./routes/index.js";
import { optionalAuth } from "./middleware/auth.js";
import { dynamicRouting } from "./middleware/dynamicRouting.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // View engine (Handlebars) — register helpers.
  registerAdminHelpers(Handlebars);
  registerViewHelpers(Handlebars);
  app.engine(
    "hbs",
    engine({
      extname: ".hbs",
      handlebars: Handlebars,
      defaultLayout: "main",
      layoutsDir: join(__dirname, "views/layouts"),
      partialsDir: join(__dirname, "views/partials"),
    })
  );
  app.set("view engine", "hbs");
  app.set("views", join(__dirname, "views"));

  // Security + infra middleware
  app.use(requestId);
  app.use(securityHeaders);
  app.use(rateLimiter);
  app.use(requestLogger);

  // Body parsing — extended:true reconstructs nested names like posts[0][title].
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Static assets
  app.use(express.static(join(process.cwd(), "public")));

  // Routes
  app.use(optionalAuth);
  app.use(injectNavigation);
  
  // Inject global settings into public layout views, and verify maintenance mode
  app.use(async (_req, res, next) => {
    try {
      const { settingService } = await import("./services/setting.service.js");
      const settings = await settingService.getAll();
      res.locals.siteName = settings.SITE_NAME || "My App";
      res.locals.siteDescription = settings.SITE_DESCRIPTION || "";
      res.locals.accentColor = settings.ACCENT_COLOR || "#6366f1";
      res.locals.logoUrl = settings.LOGO_URL || "";
      res.locals.footerText = settings.FOOTER_TEXT || "";
    } catch (_err) {
      // Ignored if service is not initialized
    }
    next();
  });

  // Since app.use requires synchronous middleware registration, we wrap maintenanceMiddleware asynchronously internally inside a handler
  app.use(async (req, res, next) => {
    try {
      const { maintenanceMiddleware } = await import("./middleware/maintenance.js");
      await maintenanceMiddleware(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.use(router);
  app.use(dynamicRouting);

  // 404 + errors (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

