// Base class every service extends. Establishes the consistent shape:
//   - constructor injection of dependencies (default to singletons)
//   - a logger scoped to the service name
// See skills/SKILL-service.md for the full pattern.
import { logger } from "../lib/logger.js";
import type { Logger } from "pino";

export abstract class BaseService {
  protected readonly log: Logger;

  constructor(serviceName: string) {
    this.log = logger.child({ service: serviceName });
  }
}
