import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildViraServerFrom } from "../server";
import { VIRA_PARITY_CASES, VIRA_WRITE_TOOLS } from "./index";
import type { ViraWriteTool } from "./types";

/**
 * Prove that no MCP tools/call can reach a write tool's `execute` (or its mirrored writer).
 * Tool cards add rows to `VIRA_WRITE_TOOLS` and attach `__sampleInput` for the call args.
 * With an empty registry this file stays green; missing parity cases fail loudly.
 */

type WriteToolWithSample = ViraWriteTool & {
  __sampleInput?: Record<string, unknown>;
};

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "never-execute-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
}

describe("VIRA write tools — model can never execute", () => {
  const SECRET = "test-vira-token-secret-0123456789abcdefg";

  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("every write tool has a writeAction parity case (empty registry is green)", () => {
    const missing = VIRA_WRITE_TOOLS.filter(
      (t) => !VIRA_PARITY_CASES.some((c) => c.tool === t.name && c.kind === "writeAction"),
    ).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it.each(VIRA_WRITE_TOOLS.map((t) => [t.name, t] as const))(
    "%s: MCP tools/call never reaches execute or the writer; token stays out of content",
    async (_nama, tool) => {
      const kasus = VIRA_PARITY_CASES.find(
        (c) => c.tool === tool.name && c.kind === "writeAction",
      );
      expect(kasus, `${tool.name} needs a writeAction parity case`).toBeDefined();
      if (!kasus || kasus.kind !== "writeAction") return;

      const sample = (tool as WriteToolWithSample).__sampleInput;
      expect(sample, `${tool.name} must define __sampleInput for never-execute`).toBeDefined();

      const executeSpy = vi.spyOn(tool, "execute");

      vi.resetModules();
      const writer = vi.fn(async () => {
        throw new Error(`${kasus.writerExport} must not be called from MCP prepare`);
      });
      vi.doMock(kasus.writerModule, async (asli) => {
        const nyata = (await asli().catch(() => ({}))) as Record<string, unknown>;
        return { ...nyata, [kasus.writerExport]: writer };
      });

      try {
        const client = await connect(
          buildViraServerFrom(
            [],
            {
              actor: { id: "u-1", name: "Uji", permissions: ["*"] },
              baseUrl: "https://x.test",
            },
            [tool],
          ),
        );
        const res = await client.callTool({
          name: tool.name,
          arguments: sample,
        });
        await client.close();

        expect(executeSpy).not.toHaveBeenCalled();
        expect(writer).not.toHaveBeenCalled();
        expect(res.isError).toBeFalsy();
        expect(textOf(res)).toMatchObject({ status: "awaiting_confirmation" });

        const contentJson = JSON.stringify((res as { content: unknown }).content);
        const meta = (res as { _meta?: Record<string, unknown> })._meta?.[
          "elorae/confirmation"
        ] as { token?: string } | undefined;
        expect(meta?.token).toBeTruthy();
        expect(contentJson).not.toContain(meta!.token);
      } finally {
        vi.doUnmock(kasus.writerModule);
      }
    },
  );
});
