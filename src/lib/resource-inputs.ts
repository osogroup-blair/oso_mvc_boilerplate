import { z } from "zod";
export const projectFields = z.object({
  name: z.string().min(1).max(120), description: z.string().max(20000).nullable().optional(),
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
}).strict();
export const taskFields = z.object({
  title: z.string().min(1).max(200), description: z.string().max(20000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  dueDate: z.preprocess(value => value === "" ? null : value, z.coerce.date().nullable().optional()),
  meta: z.object({ estimatedHours: z.number().finite().nonnegative().nullable().optional(), storyPoints: z.number().finite().nonnegative().nullable().optional() }).strict().optional(),
}).strict();
