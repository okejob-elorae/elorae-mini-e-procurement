import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Prisma } from "@elorae/db";
import { asalPermintaan } from "@/lib/creative/kalender-langganan";
import { getViraEnv, VIRA_LIST_DEFAULT_LIMIT, VIRA_LIST_MAX_LIMIT } from "./config";

/** Spread into every list tool's input shape. */
export const listInputShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(VIRA_LIST_MAX_LIMIT)
    .default(VIRA_LIST_DEFAULT_LIMIT)
    .describe("Rows to return, 1–50. Default 20."),
  offset: z.number().int().min(0).default(0).describe("Rows to skip, for paging."),
};

export type Page<T> = { items: T[]; total: number; offset: number; limit: number; hasMore: boolean };

/** For sources that are already paged by the DB. */
export function toPage<T>(items: T[], total: number, offset: number, limit: number): Page<T> {
  return { items, total, offset, limit, hasMore: offset + items.length < total };
}

/** For sources that return every row (daftarPiutang, daftarSiklus, store stock rows).
 *  Slices rows[offset, offset+limit); total = rows.length. */
export function sliceToPage<T>(rows: T[], offset: number, limit: number): Page<T> {
  return toPage(rows.slice(offset, offset + limit), rows.length, offset, limit);
}

/** Base for record links: VIRA_APP_URL if set, else the existing asalPermintaan(request) helper. */
export function getBaseUrl(request: Request): string {
  const appUrl = getViraEnv().appUrl;
  if (appUrl) return appUrl;
  return asalPermintaan((nama) => request.headers.get(nama), new URL(request.url).origin);
}

/** Joins base + path (path must start with "/"). */
export function recordUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) throw new Error(`recordUrl: path must start with "/" (got "${path}")`);
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Recursively: Prisma Decimal → number, Date → ISO string, bigint → number,
 *  undefined keys removed. Leaves other values as they are. */
export function serialize<T>(value: T): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value === null || typeof value !== "object") return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as unknown as Prisma.Decimal).toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => serialize(v));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[key] = serialize(v);
  }
  return out;
}

export type ViraToolErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "INTERNAL";

function asStructured(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return { items: data };
  if (data !== null && typeof data === "object") return data as Record<string, unknown>;
  return { value: data };
}

/** MCP CallToolResult for success:
 *  { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } */
export function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: asStructured(data),
  };
}

/** MCP CallToolResult for failure:
 *  { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] } */
export function toolError(code: ViraToolErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
  };
}
