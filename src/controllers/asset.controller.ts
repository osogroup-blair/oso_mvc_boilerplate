import type { Request, Response, NextFunction } from "express";
import { assetService } from "../services/asset.service.js";
import { ok } from "../lib/response.js";
import { AppError } from "../lib/AppError.js";

export class AssetController {
  // Render asset library view
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const assets = await assetService.getAll();
      
      // Calculate formatted sizes for display
      const formattedAssets = assets.map((asset) => {
        let sizeStr = `${asset.size} B`;
        if (asset.size > 1024 * 1024) {
          sizeStr = `${(asset.size / (1024 * 1024)).toFixed(2)} MB`;
        } else if (asset.size > 1024) {
          sizeStr = `${(asset.size / 1024).toFixed(2)} KB`;
        }
        
        const isImage = asset.mimeType.startsWith("image/");

        return {
          ...asset,
          sizeFormatted: sizeStr,
          isImage,
        };
      });

      res.render("admin/assets", {
        layout: "main",
        title: "Media Library",
        assets: formattedAssets,
        activePage: "assets",
        user: req.user,
        query: req.query,
      });

    } catch (err) {
      next(err);
    }
  }

  // Handle upload request (AJAX or direct form)
  async upload(req: Request, res: Response, next: NextFunction) {
    const isJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    try {
      if (!req.file) {
        throw AppError.badRequest("No file uploaded");
      }

      const asset = await assetService.upload({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        userId: req.user?.id,
      });

      if (isJson) {
        return res.status(201).json(ok({ asset }));
      }

      res.redirect("/admin/assets?success=1");
    } catch (err) {
      if (isJson) return next(err);
      res.redirect(`/admin/assets?error=${encodeURIComponent(err instanceof Error ? err.message : "Upload failed")}`);
    }
  }

  // Delete asset
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assetService.delete(id);
      res.redirect("/admin/assets?deleted=1");
    } catch (err) {
      next(err);
    }
  }
}

export const assetController = new AssetController();



