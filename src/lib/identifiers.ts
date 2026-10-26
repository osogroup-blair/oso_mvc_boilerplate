import { z } from "zod";
// Database IDs are strings: retain named seed/consumer IDs as well as UUIDs.
export const recordId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/, "Invalid record ID");
