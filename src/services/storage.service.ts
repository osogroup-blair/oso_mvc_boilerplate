import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseService } from "./BaseService.js";
import { settingService } from "./setting.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");

export class StorageService extends BaseService {
  constructor() {
    super("StorageService");
  }

  async upload(key: string, fileBuffer: Buffer, mimeType: string): Promise<{ url: string; provider: string }> {
    const provider = (await settingService.get("STORAGE_PROVIDER")) || "local";

    if (provider === "s3") {
      const bucket = await settingService.get("S3_BUCKET");
      const region = await settingService.get("S3_REGION") || "us-east-1";
      const endpoint = await settingService.get("S3_ENDPOINT");
      const accessKeyId = await settingService.get("S3_ACCESS_KEY_ID") || "";
      const secretAccessKey = await settingService.get("S3_SECRET_ACCESS_KEY") || "";

      const s3Client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: !!endpoint, // typically needed for MinIO/R2
      });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
        })
      );

      // Generate cloud URL
      const publicUrl = endpoint 
        ? `${endpoint}/${bucket}/${key}` 
        : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      return { url: publicUrl, provider: "s3" };
    } else {
      // Local storage
      const localDir = await settingService.get("STORAGE_LOCAL_DIR") || "public/uploads";
      const publicPrefix = await settingService.get("STORAGE_PUBLIC_URL_PREFIX") || "/uploads";
      
      const absoluteUploadPath = join(rootDir, localDir, key);
      
      // Ensure directory exists
      await mkdir(dirname(absoluteUploadPath), { recursive: true });
      await writeFile(absoluteUploadPath, fileBuffer);

      const publicUrl = `${publicPrefix}/${key}`;
      return { url: publicUrl, provider: "local" };
    }
  }

  async delete(key: string, provider: string): Promise<void> {
    if (provider === "s3") {
      const bucket = await settingService.get("S3_BUCKET");
      const region = await settingService.get("S3_REGION") || "us-east-1";
      const endpoint = await settingService.get("S3_ENDPOINT");
      const accessKeyId = await settingService.get("S3_ACCESS_KEY_ID") || "";
      const secretAccessKey = await settingService.get("S3_SECRET_ACCESS_KEY") || "";

      const s3Client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        credentials: { accessKeyId, secretAccessKey },
      });

      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    } else {
      const localDir = await settingService.get("STORAGE_LOCAL_DIR") || "public/uploads";
      const absolutePath = join(rootDir, localDir, key);
      try {
        await unlink(absolutePath);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          this.log.error({ err, path: absolutePath }, "Failed to delete local file");
          throw err;
        }
      }
    }
  }
}

export const storageService = new StorageService();
