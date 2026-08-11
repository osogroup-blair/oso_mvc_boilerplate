// Base for all models. Models are the ONLY layer that touches Prisma directly.
// They wrap queries and translate DB errors — no business logic here.
// See skills/SKILL-model.md.
import { prisma } from "../lib/prisma.js";

export abstract class BaseModel {
  protected readonly db = prisma;
}
