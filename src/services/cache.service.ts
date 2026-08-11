// Swappable cache. In-memory Map now; replace internals with Redis later
// WITHOUT changing any calling service. That is the point of the interface.
import { BaseService } from "./BaseService.js";

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

export class CacheService extends BaseService {
  private store = new Map<string, Entry>();

  constructor() {
    super("CacheService");
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export const cacheService = new CacheService();
