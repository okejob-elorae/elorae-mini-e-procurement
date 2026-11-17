import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildViraServerFrom } from "../server";
import { VIRA_PARITY_CASES, VIRA_WRITE_TOOLS } from "./index";
import { defineWriteTool, type ViraWriteTool } from "./types";

/**
 * Prove that no MCP tools/call can reach a write tool's `execute` (or its mirrored writer).
 * Tool cards add rows to `VIRA_WRITE_TOOLS` and attach `__sampleInput` for the call args.
 * With an empty registry this file stays green; missing parity cases fail loudly.
 * A file-local fake (below) proves the MCP/token/execute+writer assertions today.
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

async function assertNeverExecute(
  tool: ViraWriteTool,
  sample: Record<string, unknown>,
  writer: ReturnType<typeof vi.fn>,
): Promise<void> {
  const executeSpy = vi.spyOn(tool, "execute");
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
  const res = await client.callTool({ name: tool.name, arguments: sample });
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

  it("self-test fake: prepare-only MCP never reaches execute or writer; token stays out of content", async () => {
    const writer = vi.fn(async () => ({
      ok: true as const,
      message: "done",
      url: "/x",
      entityType: "Fake",
      entityId: "1",
    }));
    const tool = defineWriteTool({
      kind: "write",
      name: "never_execute_fake",
      title: "Never-execute fake",
      description: "File-local harness only.",
      gate: { kind: "anyValidToken" },
      destructive: false,
      inputShape: { id: z.string() },
      argsSchema: z.object({ id: z.string() }),
      prepare: async (input) => ({
        preview: {
          title: "Fake",
          summary: "Would write if confirmed.",
          details: [],
          confirmLabel: "Ya",
          cancelLabel: "Batal",
          destructive: false,
          target: { type: "Fake", id: input.id, url: "/x" },
        },
        args: { id: input.id },
      }),
      // Writer is only reachable from execute — proves MCP never gets there.
      execute: async (args, ctx) => writer(args, ctx),
      revalidate: () => ["/x"],
    });
    await assertNeverExecute(tool, { id: "ord-1" }, writer);
  });

  it.each(VIRA_WRITE_TOOLS.map((t) => [t.name, t] as const))(
    "%s: MCP tools/call never reaches execute; token stays out of content",
    async (_nama, tool) => {
      const kasus = VIRA_PARITY_CASES.find(
        (c) => c.tool === tool.name && c.kind === "writeAction",
      );
      expect(kasus, `${tool.name} needs a writeAction parity case`).toBeDefined();
      if (!kasus || kasus.kind !== "writeAction") return;

      const sample = (tool as WriteToolWithSample).__sampleInput;
      expect(sample, `${tool.name} must define __sampleInput for never-execute`).toBeDefined();

      // Registry tools are already constructed; doMock cannot rebind their closed-over
      // writer imports. Spy execute on the live tool object; writer non-invocation for
      // prepare-only is covered by the self-test fake above. Tool cards must keep writers
      // out of prepare (and attach __sampleInput).
      const executeSpy = vi.spyOn(tool, "execute");
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
      const res = await client.callTool({ name: tool.name, arguments: sample });
      await client.close();

      expect(executeSpy).not.toHaveBeenCalled();
      expect(res.isError).toBeFalsy();
      expect(textOf(res)).toMatchObject({ status: "awaiting_confirmation" });

      const contentJson = JSON.stringify((res as { content: unknown }).content);
      const meta = (res as { _meta?: Record<string, unknown> })._meta?.[
        "elorae/confirmation"
      ] as { token?: string } | undefined;
      expect(meta?.token).toBeTruthy();
      expect(contentJson).not.toContain(meta!.token);
    },
  );
});
