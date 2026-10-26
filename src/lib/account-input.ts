import { z } from "zod";
const fields = z.object({
  name: z.string().min(1).max(120), email: z.string().email().max(254),
  roleId: z.string().min(1).max(160).optional(), role: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(), bio: z.string().max(10000).nullable().optional(),
  address: z.object({ street: z.string().max(300).optional(), city: z.string().max(120).optional(), zip: z.string().max(40).optional() }).strict().optional(),
  tags: z.array(z.string().max(80)).max(100).optional(),
}).strict();
export const accountCreate = fields.extend({ password: z.string().min(8).max(256) });
export const accountUpdate = fields.partial().extend({ password: z.union([z.literal(""), z.string().min(8).max(256)]).optional() });
