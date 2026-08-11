import { Request, Response, NextFunction } from "express";
import { settingService } from "../services/setting.service.js";

export async function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const isMaintenance = await settingService.get("MAINTENANCE_MODE");
    
    // Allow admin section or asset paths to proceed regardless
    const isAdminPath = req.path.startsWith("/admin") || req.path.startsWith("/api/admin");
    const isAssetPath = req.path.includes(".") || req.path.startsWith("/js") || req.path.startsWith("/css");

    if (isMaintenance === "true" && !isAdminPath && !isAssetPath) {
      const maintenanceMessage = await settingService.get("MAINTENANCE_MESSAGE") || "We are currently performing scheduled maintenance. Please check back shortly.";
      const contactEmail = await settingService.get("CONTACT_EMAIL") || "support@example.com";
      const siteName = await settingService.get("SITE_NAME") || "My App";
      
      res.status(503);
      return res.render("maintenance", {
        layout: false, // Standalone page
        siteName,
        maintenanceMessage,
        contactEmail
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
}
