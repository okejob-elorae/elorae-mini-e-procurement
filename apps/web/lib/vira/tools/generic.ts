/**
 * Generic policy-driven read tools.
 * Wired from tools/index.ts MODULES. No prior generic browse tool existed.
 */
import { z } from "zod";
import { entitiesForActor, VIRA_ENTITIES } from "../entities";
import { ViraInputError } from "../errors";
import {
  aggregateEntity,
  describeEntity,
  queryEntity,
  requireEntityAccess,
} from "../generic-query";
import { listInputShape } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

const entityName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe(`Entity name. One of: ${VIRA_ENTITIES.map((e) => e.name).join(", ")}.`);

const whereSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Filter object: field equals / {equals,in,not,contains,startsWith,gt,gte,lt,lte}, plus AND/OR/NOT (max depth 3).",
  );

const listEntitiesTool = defineTool({
  name: "list_entities",
  title: "List readable entities",
  description:
    "Lists the back-office entities this user may read with query_entity / aggregate_entity. Call it without input for the names, then with `entity` for that entity's fields, filterable fields and relations. Use specialised tools when they already answer the question.",
  gate: { kind: "anyValidToken" },
  // Models send "" for "no entity", so an empty name means the list.
  inputShape: { entity: z.string().trim().max(80).optional().describe("Leave out for the list of names.") },
  handler: async (input, ctx) => {
    if (input.entity) return describeEntity(requireEntityAccess(ctx.actor, input.entity));
    // Names only: every field of every entity would overflow the chat's result limit.
    const entities = entitiesForActor(ctx.actor).map((e) => ({
      name: e.name,
      descriptionId: e.descriptionId,
      descriptionEn: e.descriptionEn,
    }));
    return { entities, total: entities.length };
  },
});

const queryEntityTool = defineTool({
  name: "query_entity",
  title: "Query an entity",
  description:
    "Reads rows for one policy entity with a validated where clause, optional fields/include, and paging (max 50). Every item includes a back-office url. Denied fields (PII, secrets, salary, GPS, photos) are never returned.",
  gate: { kind: "anyValidToken" },
  inputShape: {
    entity: entityName,
    where: whereSchema,
    fields: z
      .array(z.string().trim().min(1).max(80))
      .max(50)
      .optional()
      .describe("Scalar fields to return. Omit for all allowed fields."),
    include: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Allowed relations only, e.g. { store: true } or { store: { fields: [\"name\"] } }."),
    orderBy: z
      .object({
        field: z.string().trim().min(1).max(80),
        dir: z.enum(["asc", "desc"]).optional(),
      })
      .optional()
      .describe("Sort field (allowed scalars only). Defaults to the entity's defaultSort."),
    ...listInputShape,
  },
  handler: async (input, ctx) => {
    const { limit, offset } = input;
    if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
    return queryEntity({
      actor: ctx.actor,
      baseUrl: ctx.baseUrl,
      entity: input.entity,
      where: input.where,
      fields: input.fields,
      include: input.include,
      orderBy: input.orderBy,
      limit,
      offset,
    });
  },
});

const aggregateEntityTool = defineTool({
  name: "aggregate_entity",
  title: "Aggregate an entity",
  description:
    "Groups and aggregates numeric fields for one policy entity (count/sum/avg/min/max). Max 50 groups; hasMore tells when there are more. Same where + denylist + gate rules as query_entity.",
  gate: { kind: "anyValidToken" },
  inputShape: {
    entity: entityName,
    where: whereSchema,
    groupBy: z
      .array(z.string().trim().min(1).max(80))
      .max(5)
      .optional()
      .describe("Fields to group by."),
    count: z.boolean().optional().describe("Include row counts per group."),
    sum: z.array(z.string()).max(10).optional().describe("Numeric fields to sum."),
    avg: z.array(z.string()).max(10).optional().describe("Numeric fields to average."),
    min: z.array(z.string()).max(10).optional().describe("Numeric fields for min."),
    max: z.array(z.string()).max(10).optional().describe("Numeric fields for max."),
  },
  handler: async (input, ctx) => {
    return aggregateEntity({
      actor: ctx.actor,
      entity: input.entity,
      where: input.where,
      groupBy: input.groupBy,
      count: input.count,
      sum: input.sum,
      avg: input.avg,
      min: input.min,
      max: input.max,
    });
  },
});

export const tools: ViraTool[] = [listEntitiesTool, queryEntityTool, aggregateEntityTool];

/** Entity gates are parity-checked in parity.spec.ts against VIRA_ENTITIES (not these tools). */
export const parityCases: ParityCase[] = [];
