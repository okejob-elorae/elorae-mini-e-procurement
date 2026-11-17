import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { hasPermission } from "@/lib/rbac";
import { gateAllows } from "./akses";
import { signConfirmToken } from "./confirm-token";
import { VIRA_WRITE_PERMISSION } from "./config";
import { ViraInputError, ViraNotFoundError } from "./errors";
import { serialize, toolConfirmation, toolError, toolResult } from "./output";
import { VIRA_TOOLS, VIRA_WRITE_TOOLS } from "./tools";
import type { ViraTool, ViraToolContext, ViraWriteTool } from "./tools/types";

async function runTool(tool: ViraTool, input: unknown, ctx: ViraToolContext): Promise<CallToolResult> {
  if (!gateAllows(tool.gate, ctx.actor.permissions)) {
    return toolError("FORBIDDEN", "You do not have access to this data.");
  }
  try {
    const result = await tool.handler(input as Parameters<ViraTool["handler"]>[0], ctx);
    return toolResult(serialize(result));
  } catch (err) {
    if (err instanceof ViraNotFoundError) return toolError("NOT_FOUND", err.message);
    if (err instanceof ViraInputError) return toolError("INVALID_INPUT", err.message);
    // Tool name and error only — never the input values.
    console.error("[vira] tool failed", tool.name, err);
    return toolError("INTERNAL", "Something went wrong. Please try again.");
  }
}

/** Prepare only — never calls execute. Confirm token goes only into _meta. */
async function runWriteTool(
  tool: ViraWriteTool,
  input: unknown,
  ctx: ViraToolContext,
): Promise<CallToolResult> {
  const perms = ctx.actor.permissions;
  if (!gateAllows(tool.gate, perms) || !hasPermission(perms, VIRA_WRITE_PERMISSION)) {
    return toolError("FORBIDDEN", "You do not have access to this data.");
  }
  try {
    const prepared = await tool.prepare(
      input as Parameters<ViraWriteTool["prepare"]>[0],
      ctx,
    );
    // Button style always matches the static flag on the tool.
    prepared.preview.destructive = tool.destructive;
    const { token, expiresAt } = await signConfirmToken({
      userId: ctx.actor.id,
      tool: tool.name,
      args: prepared.args,
    });
    return toolConfirmation(prepared.preview, token, expiresAt);
  } catch (err) {
    if (err instanceof ViraNotFoundError) return toolError("NOT_FOUND", err.message);
    if (err instanceof ViraInputError) return toolError("INVALID_INPUT", err.message);
    console.error("[vira] tool failed", tool.name, err);
    return toolError("INTERNAL", "Something went wrong. Please try again.");
  }
}

/** Builds a server from the given tools. Exported for tests; production code uses buildViraServer. */
export function buildViraServerFrom(
  tools: readonly ViraTool[],
  ctx: ViraToolContext,
  writeTools: readonly ViraWriteTool[] = [],
): McpServer {
  const server = new McpServer({ name: "elorae", version: "1.0.0" });
  const perms = ctx.actor.permissions;

  for (const tool of tools) {
    if (!gateAllows(tool.gate, perms)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      (input: unknown) => runTool(tool, input, ctx),
    );
  }

  for (const tool of writeTools) {
    if (!gateAllows(tool.gate, perms) || !hasPermission(perms, VIRA_WRITE_PERMISSION)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: tool.destructive,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      (input: unknown) => runWriteTool(tool, input, ctx),
    );
  }

  return server;
}

/** A new server per request, with only the tools this actor may use. */
export function buildViraServer(ctx: ViraToolContext): McpServer {
  return buildViraServerFrom(VIRA_TOOLS, ctx, VIRA_WRITE_TOOLS);
}
