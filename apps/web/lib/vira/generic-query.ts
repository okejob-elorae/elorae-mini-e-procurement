/**
 * Policy-driven Prisma read helpers for VIRA generic tools.
 * Callers: lib/vira/tools/generic.ts + tests.
 */
import { Prisma, prisma } from "@elorae/db";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { ViraInputError } from "./errors";
import {
  allowedFieldNames,
  findRelation,
  getEntity,
  isDeniedField,
  type ViraEntityDef,
  type ViraEntityField,
  type ViraFieldType,
} from "./entities";
import type { ViraActor } from "./akses";
import { gateAllows } from "./akses";
import { recordUrl, toPage, type Page } from "./output";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const MAX_WHERE_DEPTH = 3;
const MAX_INCLUDE_DEPTH = 2;
const MAX_GROUPS = 50;

type Delegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  count: (args: unknown) => Promise<number>;
  groupBy: (args: unknown) => Promise<Record<string, unknown>[]>;
  aggregate: (args: unknown) => Promise<Record<string, unknown>>;
};

function delegateFor(entity: ViraEntityDef): Delegate {
  const d = (prisma as unknown as Record<string, unknown>)[entity.model];
  if (!d || typeof d !== "object") {
    throw new ViraInputError(`Entity "${entity.name}" is not queryable (missing Prisma model ${entity.model}).`);
  }
  return d as Delegate;
}

function fieldMap(entity: ViraEntityDef): Map<string, ViraEntityField> {
  return new Map(entity.fields.filter((f) => !isDeniedField(f.name)).map((f) => [f.name, f]));
}

function validFieldList(entity: ViraEntityDef): string {
  return allowedFieldNames(entity).sort().join(", ");
}

function assertKnownField(entity: ViraEntityDef, name: string): ViraEntityField {
  if (isDeniedField(name)) {
    throw new ViraInputError(
      `Field "${name}" is not allowed. Valid fields: ${validFieldList(entity)}`,
    );
  }
  const f = fieldMap(entity).get(name);
  if (!f) {
    throw new ViraInputError(
      `Unknown field "${name}". Valid fields: ${validFieldList(entity)}`,
    );
  }
  return f;
}

const OPS = new Set(["equals", "in", "not", "contains", "startsWith", "gt", "gte", "lt", "lte"]);

/** `bound: "end"` for lt/lte so YYYY-MM-DD is inclusive end-of-day WIB. */
function coerceDate(value: unknown, bound: "start" | "end"): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) {
    const d = bound === "end" ? parseDateOnlyEnd(value) : parseDateOnly(value);
    if (!d) throw new ViraInputError(`Invalid date value: ${value}`);
    return d;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ViraInputError(`Invalid date value: ${String(value)}`);
    return d;
  }
  throw new ViraInputError(`Invalid date value: ${String(value)}`);
}

function coerceValue(type: ViraFieldType, value: unknown, dateBound: "start" | "end" = "start"): unknown {
  if (value === null) return null;
  if (type === "date") return coerceDate(value, dateBound);
  if (type === "number" && typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ViraInputError(`Invalid number: ${value}`);
    return n;
  }
  return value;
}

function isDateOnlyString(v: unknown): v is string {
  return typeof v === "string" && DATE_ONLY.test(v.trim());
}

/** Whole WIB calendar day — bare/equals date-only must not match a single midnight instant. */
function dateOnlyDayRange(value: string): { gte: Date; lte: Date } {
  return { gte: coerceDate(value, "start"), lte: coerceDate(value, "end") };
}

function parseFieldFilter(entity: ViraEntityDef, field: string, raw: unknown): unknown {
  const meta = assertKnownField(entity, field);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    if (meta.type === "date" && isDateOnlyString(raw)) return dateOnlyDayRange(raw);
    return coerceValue(meta.type, raw);
  }
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [op, val] of Object.entries(obj)) {
    if (!OPS.has(op)) {
      throw new ViraInputError(`Unsupported operator "${op}" on field "${field}".`);
    }
    const dateBound: "start" | "end" = op === "lt" || op === "lte" ? "end" : "start";
    if (op === "equals" && meta.type === "date" && isDateOnlyString(val)) {
      Object.assign(out, dateOnlyDayRange(val));
      continue;
    }
    if (op === "in") {
      if (!Array.isArray(val)) throw new ViraInputError(`"${field}.in" must be an array.`);
      if (meta.type === "date" && val.every(isDateOnlyString)) {
        out.OR = val.map((d) => dateOnlyDayRange(d));
        continue;
      }
      out.in = val.map((v) => coerceValue(meta.type, v, dateBound));
      continue;
    }
    if (op === "not") {
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        out.not = parseFieldFilter(entity, field, val);
      } else if (meta.type === "date" && isDateOnlyString(val)) {
        out.not = dateOnlyDayRange(val);
      } else {
        out.not = coerceValue(meta.type, val, dateBound);
      }
      continue;
    }
    if ((op === "contains" || op === "startsWith") && meta.type !== "string") {
      throw new ViraInputError(`"${op}" only applies to string fields (got ${field}).`);
    }
    if ((op === "gt" || op === "gte" || op === "lt" || op === "lte") && meta.type !== "number" && meta.type !== "date") {
      throw new ViraInputError(`"${op}" only applies to number/date fields (got ${field}).`);
    }
    out[op] = coerceValue(meta.type, val, dateBound);
  }
  return out;
}

/** Validate + convert a client `where` into a Prisma where (entity fields only). */
export function parseWhere(
  entity: ViraEntityDef,
  where: unknown,
  depth = 0,
): Record<string, unknown> {
  if (where == null) return {};
  if (typeof where !== "object" || Array.isArray(where)) {
    throw new ViraInputError("`where` must be an object.");
  }
  if (depth > MAX_WHERE_DEPTH) {
    throw new ViraInputError(`where nesting exceeds max depth ${MAX_WHERE_DEPTH}.`);
  }
  const input = where as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (input.AND !== undefined) {
    if (!Array.isArray(input.AND)) throw new ViraInputError("`where.AND` must be an array.");
    out.AND = input.AND.map((w) => parseWhere(entity, w, depth + 1));
  }
  if (input.OR !== undefined) {
    if (!Array.isArray(input.OR)) throw new ViraInputError("`where.OR` must be an array.");
    out.OR = input.OR.map((w) => parseWhere(entity, w, depth + 1));
  }
  if (input.NOT !== undefined) {
    out.NOT = parseWhere(entity, input.NOT, depth + 1);
  }

  for (const [key, val] of Object.entries(input)) {
    if (key === "AND" || key === "OR" || key === "NOT") continue;
    if (!fieldMap(entity).get(key)?.filterable && fieldMap(entity).has(key)) {
      throw new ViraInputError(`Field "${key}" is not filterable.`);
    }
    out[key] = parseFieldFilter(entity, key, val);
  }
  return out;
}

export type Selection = {
  entity: ViraEntityDef;
  /** Scalars to return (id and the document number are always added). */
  fields: string[];
  /**
   * True when the actor lacks this entity's gate and may only see `parentShows`.
   * Prisma must not widen past `fields` then — otherwise hidden allowlist
   * scalars (e.g. store creditLimit) land in the row before `project`.
   */
  restricted: boolean;
  children: Map<string, Selection>;
};

function parseSelection(
  actor: ViraActor,
  entity: ViraEntityDef,
  fields: unknown,
  include: unknown,
  depth: number,
  /** Set when the actor lacks this entity's gate: the only fields the parent page shows. */
  only?: readonly string[],
): Selection {
  if (fields !== undefined && (!Array.isArray(fields) || fields.some((n) => typeof n !== "string"))) {
    throw new ViraInputError("`fields` must be an array of field names.");
  }
  const asked = fields as string[] | undefined;
  const names = asked?.length ? asked : (only ?? allowedFieldNames(entity));
  for (const name of names) {
    assertKnownField(entity, name);
    if (only && !only.includes(name)) {
      throw new ViraInputError(
        `You do not have access to "${name}" of entity "${entity.name}". Allowed here: ${only.join(", ")}`,
      );
    }
  }
  const children = new Map<string, Selection>();
  const restricted = Boolean(only);
  if (include == null) return { entity, fields: [...names], restricted, children };
  if (typeof include !== "object" || Array.isArray(include)) {
    throw new ViraInputError("`include` must be an object of relation names.");
  }
  if (only) throw new ViraInputError(`You do not have access to relations of entity "${entity.name}".`);
  if (depth >= MAX_INCLUDE_DEPTH) {
    throw new ViraInputError(`include nesting exceeds max depth ${MAX_INCLUDE_DEPTH}.`);
  }
  for (const [name, val] of Object.entries(include as Record<string, unknown>)) {
    const rel = findRelation(entity, name);
    if (!rel) {
      const allowed = entity.relations.map((r) => r.name).join(", ") || "(none)";
      throw new ViraInputError(`Unknown or disallowed relation "${name}". Allowed: ${allowed}`);
    }
    const child = getEntity(rel.entity);
    // A row-scoped entity is only readable through its own query, where the scope is applied.
    if (!child || child.rowScope) throw new ViraInputError(`Relation "${name}" cannot be included.`);
    if (val !== true && (val === null || typeof val !== "object" || Array.isArray(val))) {
      throw new ViraInputError(`include.${name} must be true or { fields?, include? }.`);
    }
    const allowed = gateAllows(child.gate, actor.permissions);
    if (!allowed && !rel.parentShows?.length) {
      throw new ViraInputError(`You do not have access to entity "${rel.entity}".`);
    }
    const nested = val === true ? {} : (val as { fields?: unknown; include?: unknown });
    children.set(
      name,
      parseSelection(
        actor,
        child,
        nested.fields,
        nested.include,
        depth + 1,
        allowed ? undefined : rel.parentShows,
      ),
    );
  }
  return { entity, fields: [...names], restricted, children };
}

/**
 * Builds the Prisma `select`. Unrestricted: full allowlist + docNumber + mask
 * helpers (urlPath / isVisible; `project` still returns only `sel.fields`).
 * Restricted (`parentShows`): `id` + `sel.fields` only — never widen.
 */
export function toPrismaSelect(sel: Selection): Record<string, unknown> {
  const out: Record<string, unknown> = { id: true };
  const scalars = sel.restricted ? sel.fields : allowedFieldNames(sel.entity);
  for (const name of scalars) out[name] = true;
  if (!sel.restricted) {
    if (sel.entity.docNumberField) out[sel.entity.docNumberField] = true;
    Object.assign(out, sel.entity.mask?.select);
  }
  for (const [name, child] of sel.children) out[name] = { select: toPrismaSelect(child) };
  return out;
}

function project(sel: Selection, row: Record<string, unknown>): Record<string, unknown> {
  const { entity } = sel;
  const hidden = entity.mask && !entity.mask.isVisible(row) ? entity.mask.fields : [];
  const names = new Set(["id", ...sel.fields]);
  if (entity.docNumberField && (!sel.restricted || sel.fields.includes(entity.docNumberField))) {
    names.add(entity.docNumberField);
  }
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = hidden.includes(name) ? null : scrubValue(row[name]);
  for (const [name, child] of sel.children) {
    const value = row[name];
    if (Array.isArray(value)) out[name] = value.map((v) => project(child, v as Record<string, unknown>));
    else out[name] = value ? project(child, value as Record<string, unknown>) : null;
  }
  return out;
}

function whereUses(where: unknown, names: readonly string[]): boolean {
  if (Array.isArray(where)) return where.some((w) => whereUses(w, names));
  if (where === null || typeof where !== "object") return false;
  return Object.entries(where).some(
    ([k, v]) => names.includes(k) || ((k === "AND" || k === "OR" || k === "NOT") && whereUses(v, names)),
  );
}

/** Hidden values must not be discoverable by filtering, sorting or aggregating on them. */
function maskWhere(
  entity: ViraEntityDef,
  where: Record<string, unknown>,
  usedFields: readonly string[],
): { where: Record<string, unknown>; note?: string } {
  const mask = entity.mask;
  if (!mask) return { where };
  if (!whereUses(where, mask.fields) && !usedFields.some((n) => mask.fields.includes(n))) return { where };
  return {
    where: { AND: [mask.visibleWhere, where] },
    note: `Rows whose ${mask.fields.join(", ")} are hidden from users are left out of this result.`,
  };
}

/** Wrong enum value or value type: say what is wrong instead of "Something went wrong". */
async function runRead<T>(entity: ViraEntityDef, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientValidationError) {
      const reason = e.message.trim().split("\n").pop()?.slice(0, 300) ?? "";
      throw new ViraInputError(`Invalid value for entity "${entity.name}". ${reason}`);
    }
    throw e;
  }
}

/** Asia/Jakarta wall time as ISO-8601 with +07:00 offset. */
export function toWibIso(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000+07:00`;
}

function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (value instanceof Date) return toWibIso(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isDeniedField(k) || v === undefined) continue;
      out[k] = scrubValue(v);
    }
    return out;
  }
  return value;
}

function mergeWhere(
  entity: ViraEntityDef,
  actor: ViraActor,
  where: Record<string, unknown>,
): Record<string, unknown> {
  const scope = entity.rowScope?.(actor) ?? null;
  if (!scope || Object.keys(scope).length === 0) return where;
  if (Object.keys(where).length === 0) return scope;
  return { AND: [scope, where] };
}

export function requireEntityAccess(actor: ViraActor, entityName: string): ViraEntityDef {
  const entity = getEntity(entityName);
  if (!entity) {
    throw new ViraInputError(
      `Unknown entity "${entityName}". Call list_entities for valid names.`,
    );
  }
  if (!gateAllows(entity.gate, actor.permissions)) {
    throw new ViraInputError(`You do not have access to entity "${entityName}".`);
  }
  return entity;
}

export async function queryEntity(opts: {
  actor: ViraActor;
  baseUrl: string;
  entity: string;
  where?: unknown;
  fields?: string[];
  include?: unknown;
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit: number;
  offset: number;
}): Promise<Page<Record<string, unknown>> & { note?: string }> {
  const entity = requireEntityAccess(opts.actor, opts.entity);
  const orderField = opts.orderBy?.field ?? entity.defaultSort.field;
  assertKnownField(entity, orderField);
  const orderDir = opts.orderBy?.dir ?? entity.defaultSort.dir;
  const masked = maskWhere(entity, parseWhere(entity, opts.where), [orderField]);
  const where = mergeWhere(entity, opts.actor, masked.where);
  const selection = parseSelection(opts.actor, entity, opts.fields, opts.include, 0);

  const del = delegateFor(entity);
  const [rows, total] = await runRead(entity, () =>
    Promise.all([
      del.findMany({
        where,
        // id breaks ties, so paging never repeats or skips a row.
        orderBy: orderField === "id" ? { id: orderDir } : [{ [orderField]: orderDir }, { id: "asc" }],
        skip: opts.offset,
        take: opts.limit,
        select: toPrismaSelect(selection),
      }),
      del.count({ where }),
    ]),
  );

  const items = rows.map((row) => ({
    ...project(selection, row),
    url: recordUrl(opts.baseUrl, entity.urlPath(row)),
  }));
  return { ...toPage(items, total, opts.offset, opts.limit), ...(masked.note ? { note: masked.note } : {}) };
}

export async function aggregateEntity(opts: {
  actor: ViraActor;
  entity: string;
  where?: unknown;
  groupBy?: string[];
  count?: boolean;
  sum?: string[];
  avg?: string[];
  min?: string[];
  max?: string[];
}): Promise<{ groups: Record<string, unknown>[]; hasMore: boolean; note?: string }> {
  const entity = requireEntityAccess(opts.actor, opts.entity);
  const groupBy = opts.groupBy ?? [];
  const masked = maskWhere(entity, parseWhere(entity, opts.where), [
    ...groupBy,
    ...(opts.sum ?? []),
    ...(opts.avg ?? []),
    ...(opts.min ?? []),
    ...(opts.max ?? []),
  ]);
  const where = mergeWhere(entity, opts.actor, masked.where);
  for (const g of groupBy) assertKnownField(entity, g);

  const numeric = (names: string[] | undefined, label: string) => {
    if (!names?.length) return undefined;
    const out: Record<string, boolean> = {};
    for (const n of names) {
      const meta = assertKnownField(entity, n);
      if (meta.type !== "number" || meta.aggregatable === false) {
        throw new ViraInputError(`"${label}" field "${n}" must be a numeric aggregatable field.`);
      }
      out[n] = true;
    }
    return out;
  };

  if (
    !opts.count &&
    !opts.sum?.length &&
    !opts.avg?.length &&
    !opts.min?.length &&
    !opts.max?.length
  ) {
    throw new ViraInputError("Provide at least one of count, sum, avg, min, max.");
  }

  const measures: Record<string, unknown> = {
    ...(opts.count ? { _count: { _all: true } } : {}),
    ...(numeric(opts.sum, "sum") ? { _sum: numeric(opts.sum, "sum") } : {}),
    ...(numeric(opts.avg, "avg") ? { _avg: numeric(opts.avg, "avg") } : {}),
    ...(numeric(opts.min, "min") ? { _min: numeric(opts.min, "min") } : {}),
    ...(numeric(opts.max, "max") ? { _max: numeric(opts.max, "max") } : {}),
  };
  const del = delegateFor(entity);
  const rows = await runRead(entity, async () =>
    groupBy.length === 0
      ? [await del.aggregate({ where, ...measures })]
      : del.groupBy({
          by: groupBy,
          where,
          ...measures,
          orderBy: groupBy.map((f) => ({ [f]: "asc" })),
          take: MAX_GROUPS + 1,
        }),
  );
  return {
    groups: rows.slice(0, MAX_GROUPS).map((r) => scrubValue(r) as Record<string, unknown>),
    hasMore: rows.length > MAX_GROUPS,
    ...(masked.note ? { note: masked.note } : {}),
  };
}

export function describeEntity(entity: ViraEntityDef) {
  const fields = entity.fields
    .filter((f) => !isDeniedField(f.name))
    .map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? f.name,
      filterable: f.filterable !== false && f.type !== "json",
      aggregatable: Boolean(f.aggregatable),
    }));
  return {
    name: entity.name,
    descriptionId: entity.descriptionId,
    descriptionEn: entity.descriptionEn,
    docNumberField: entity.docNumberField ?? null,
    defaultSort: entity.defaultSort,
    fields,
    filterableFields: fields.filter((f) => f.filterable).map((f) => f.name),
    relations: entity.relations
      .filter((r) => !isDeniedField(r.name))
      .map((r) => ({
        name: r.name,
        entity: r.entity,
        description: r.description ?? r.name,
      })),
  };
}
