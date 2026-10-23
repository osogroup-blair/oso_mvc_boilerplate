import { constants } from "node:fs";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { AppError } from "../lib/AppError.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const inside = (parent: string, child: string) => {
  const part = relative(parent, child);
  return !part || !part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part);
};

/** An explicit private backend. It never consults public storage settings. */
export class PrivateAssetStorageService {
  constructor(readonly root = resolve(config.PRIVATE_ASSET_ROOT ?? resolve(projectRoot, "var/private-assets")),
    readonly id = config.PRIVATE_ASSET_STORE_ID, private readonly publicRoot = resolve(projectRoot, "public")) {}

  private async path(key: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) throw AppError.badRequest("Invalid private storage key");
    // Check lexical containment before creating anything, then reject symlink roots.
    const root = resolve(this.root);
    const publicRoot = await realpath(this.publicRoot);
    if (inside(publicRoot, root) || inside(root, publicRoot)) throw AppError.conflict("Private store must be separate from public files");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const actual = await realpath(root);
    if (actual !== root || inside(publicRoot, actual) || inside(actual, publicRoot)) throw AppError.conflict("Unsafe private storage root");
    return resolve(actual, key);
  }

  async write(key: string, buffer: Buffer) {
    const handle = await open(await this.path(key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(buffer); await handle.sync(); }
    finally { await handle.close(); }
  }

  async read(key: string, maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 10 * 1024 * 1024) throw AppError.badRequest("Invalid private read bound");
    const handle = await open(await this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw AppError.conflict("Private asset integrity mismatch");
      // Bound allocation/read even if another process grows the file after stat.
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > stat.size) throw AppError.conflict("Private asset integrity mismatch");
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  }

  async remove(key: string) {
    try { await unlink(await this.path(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
