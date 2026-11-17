import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { gateAllows } from "./akses";
import { ViraInputError, ViraNotFoundError } from "./errors";
import { serialize, toolError, toolResult } from "./output";
import { VIRA_TOOLS } from "./tools";
import type { ViraTool, ViraToolContext } from "./tools/types";

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

/** Builds a server from the given tools. Exported for tests; production code uses buildViraServer. */
export function buildViraServerFrom(tools: readonly ViraTool[], ctx: ViraToolContext): McpServer {
  const server = new McpServer({ name: "elorae", version: "1.0.0" });
  for (const tool of tools) {
    if (!gateAllows(tool.gate, ctx.actor.permissions)) continue;
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
  return server;
}

/** A new server per request, with only the tools this actor may use. */
export function buildViraServer(ctx: ViraToolContext): McpServer {
  return buildViraServerFrom(VIRA_TOOLS, ctx);
}
