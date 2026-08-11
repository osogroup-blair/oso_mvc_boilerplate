// Reusable list-query parsing: pagination, sorting, filtering.
// Controllers pass req.query here; services pass the result to models.
import { z } from "zod";

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().optional(), // free-text search term
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface ListParams {
  skip: number;
  take: number;
  orderBy?: Record<string, "asc" | "desc">;
  search?: string;
}

export function toListParams(query: ListQuery, defaultSort = "createdAt"): ListParams {
  return {
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    orderBy: { [query.sortBy ?? defaultSort]: query.sortOrder },
    search: query.q,
  };
}

export function buildMeta(query: ListQuery, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}
