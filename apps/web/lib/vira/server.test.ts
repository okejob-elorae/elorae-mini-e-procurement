import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@elorae/db";
import type { ViraActor } from "./akses";
import { verifyConfirmToken } from "./confirm-token";
import { ViraInputError, ViraNotFoundError } from "./errors";
import { buildViraServer, buildViraServerFrom } from "./server";
import { assertUniqueToolNames, VIRA_PARITY_CASES, VIRA_TOOLS } from "./tools";
import {
  defineTool,
  defineWriteTool,
  type ViraPrepared,
  type ViraTool,
  type ViraWriteTool,
} from "./tools/types";

const actor = (permissions: string[]): ViraActor => ({ id: "u-1", name: "Uji", permissions });
const ctxFor = (permissions: string[]) => ({ actor: actor(permissions), baseUrl: "https://x.test" });

const FAKE_TOOLS: ViraTool[] = [
  defineTool({
    name: "open_tool",
    title: "Open",
    description: "Any valid token.",
    gate: { kind: "anyValidToken" },
    inputShape: {},
    handler: async () => ({ ok: true }),
  }),
  defineTool({
    name: "items_tool",
    title: "Items",
    description: "Needs items:view.",
    gate: { kind: "code", code: "items:view" },
    inputShape: { q: z.string().optional() },
    handler: async (input) => ({ q: input.q ?? null }),
  }),
  defineTool({
    name: "stock_tool",
    title: "Stock",
    description: "Needs inventory:view.",
    gate: { kind: "code", code: "inventory:view" },
    inputShape: {},
    handler: async () => ({
      qty: new Prisma.Decimal("12.50"),
      at: new Date("2026-11-16T05:00:00.000Z"),
      rows: [{ cost: new Prisma.Decimal("3") }],
    }),
  }),
  defineTool({
    name: "not_found_tool",
    title: "Not found",
    description: "Throws ViraNotFoundError.",
    gate: { kind: "anyValidToken" },
    inputShape: {},
    handler: async () => {
      throw new ViraNotFoundError("No such record.");
    },
  }),
  defineTool({
    name: "bad_input_tool",
    title: "Bad input",
    description: "Throws ViraInputError.",
    gate: { kind: "anyValidToken" },
    inputShape: {},
    handler: async () => {
      throw new ViraInputError("Two stores match that name.");
    },
  }),
  defineTool({
    name: "broken_tool",
    title: "Broken",
    description: "Throws a plain Error.",
    gate: { kind: "anyValidToken" },
    inputShape: { secret: z.string().optional() },
    handler: async () => {
      throw new Error("db exploded");
    },
  }),
];

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function listNames(server: McpServer): Promise<string[]> {
  const client = await connect(server);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name).sort();
}

function textOf(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0].text);
}

describe("buildViraServerFrom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tools whose gate denies the actor are not listed", async () => {
    const names = await listNames(buildViraServerFrom(FAKE_TOOLS, ctxFor(["items:view"])));
    expect(names).toEqual(["bad_input_tool", "broken_tool", "items_tool", "not_found_tool", "open_tool"]);
    expect(names).not.toContain("stock_tool");
  });

  it('a "*" actor sees every fake tool', async () => {
    const names = await listNames(buildViraServerFrom(FAKE_TOOLS, ctxFor(["*"])));
    expect(names).toEqual(FAKE_TOOLS.map((t) => t.name).sort());
  });

  it("every listed tool is read-only, non-destructive and closed-world", async () => {
    const client = await connect(buildViraServerFrom(FAKE_TOOLS, ctxFor(["*"])));
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.length).toBe(FAKE_TOOLS.length);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
  });

  it("handler errors map to NOT_FOUND / INVALID_INPUT / INTERNAL", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await connect(buildViraServerFrom(FAKE_TOOLS, ctxFor(["*"])));
    const nf = await client.callTool({ name: "not_found_tool", arguments: {} });
    const bi = await client.callTool({ name: "bad_input_tool", arguments: {} });
    const br = await client.callTool({ name: "broken_tool", arguments: { secret: "do-not-log-me" } });
    await client.close();
    expect(nf.isError).toBe(true);
    expect(textOf(nf)).toEqual({ error: { code: "NOT_FOUND", message: "No such record." } });
    expect(bi.isError).toBe(true);
    expect(textOf(bi)).toEqual({ error: { code: "INVALID_INPUT", message: "Two stores match that name." } });
    expect(br.isError).toBe(true);
    expect(textOf(br)).toEqual({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe("[vira] tool failed");
    expect(logged.mock.calls[0][1]).toBe("broken_tool");
    expect(JSON.stringify(logged.mock.calls[0].map(String))).not.toContain("do-not-log-me");
  });

  it("Decimal and Date in a handler result come back serialized", async () => {
    const client = await connect(buildViraServerFrom(FAKE_TOOLS, ctxFor(["inventory:view"])));
    const res = await client.callTool({ name: "stock_tool", arguments: {} });
    await client.close();
    const expected = { qty: 12.5, at: "2026-11-16T05:00:00.000Z", rows: [{ cost: 3 }] };
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(expected);
    expect(textOf(res)).toEqual(expected);
  });

  it("passes validated input to the handler", async () => {
    const client = await connect(buildViraServerFrom(FAKE_TOOLS, ctxFor(["items:view"])));
    const res = await client.callTool({ name: "items_tool", arguments: { q: "kaos" } });
    await client.close();
    expect(res.structuredContent).toEqual({ q: "kaos" });
  });

  it("re-checks the gate at call time and returns FORBIDDEN when it no longer allows", async () => {
    const permissions = ["items:view"];
    const ctx = { actor: actor(permissions), baseUrl: "https://x.test" };
    const client = await connect(buildViraServerFrom(FAKE_TOOLS, ctx));
    permissions.splice(0, permissions.length);
    const res = await client.callTool({ name: "items_tool", arguments: {} });
    await client.close();
    expect(res.isError).toBe(true);
    expect(textOf(res)).toEqual({ error: { code: "FORBIDDEN", message: "You do not have access to this data." } });
  });
});

describe("whoami and the registry", () => {
  it("whoami returns the actor's id, name and permissions", async () => {
    const client = await connect(buildViraServer(ctxFor(["vira:use", "items:view"])));
    const { tools } = await client.listTools();
    const res = await client.callTool({ name: "whoami", arguments: {} });
    await client.close();
    expect(tools.map((t) => t.name)).toContain("whoami");
    expect(res.structuredContent).toEqual({ id: "u-1", name: "Uji", permissions: ["vira:use", "items:view"] });
  });

  it("VIRA_TOOLS starts with whoami and has unique names; every parity case names a real tool", () => {
    expect(VIRA_TOOLS[0]?.name).toBe("whoami");
    expect(() => assertUniqueToolNames(VIRA_TOOLS)).not.toThrow();
    const nama = new Set(VIRA_TOOLS.map((t) => t.name));
    expect(VIRA_PARITY_CASES.filter((c) => !nama.has(c.tool))).toEqual([]);
  });

  it("duplicate tool names throw", () => {
    expect(() => assertUniqueToolNames([FAKE_TOOLS[0], { ...FAKE_TOOLS[1], name: "open_tool" }])).toThrow(
      /duplicate tool name: open_tool/,
    );
  });
});

const WRITE_PREVIEW = {
  title: "Setujui pesanan SO-1",
  summary: "Menyetujui pesanan ini.",
  details: [{ label: "Nomor", value: "SO-1" }],
  confirmLabel: "Setujui",
  cancelLabel: "Batal",
  destructive: false,
  target: { type: "FieldSalesOrder", id: "ord-1", url: "https://x.test/o/ord-1" },
};

const WRITE_ARGS = { orderId: "ord-1" };

function makeFakeWrite(options?: {
  destructive?: boolean;
  prepare?: ViraWriteTool["prepare"];
  execute?: ViraWriteTool["execute"];
}): { tool: ViraWriteTool; prepare: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } {
  const prepare =
    options?.prepare ??
    vi.fn(async (): Promise<ViraPrepared<typeof WRITE_ARGS>> => ({
      preview: { ...WRITE_PREVIEW, details: [...WRITE_PREVIEW.details] },
      args: WRITE_ARGS,
    }));
  const execute =
    options?.execute ??
    vi.fn(async () => ({
      ok: true as const,
      message: "Done",
      url: WRITE_PREVIEW.target.url,
      entityType: "FieldSalesOrder",
      entityId: "ord-1",
    }));
  const tool = defineWriteTool({
    kind: "write",
    name: "approve_fake_order",
    title: "Approve fake",
    description: "Prepare an approval.",
    gate: { kind: "code", code: "field_sales_orders:approve" },
    destructive: options?.destructive ?? false,
    inputShape: { orderId: z.string() },
    argsSchema: z.object({ orderId: z.string() }),
    prepare,
    execute,
    revalidate: () => ["/backoffice/field-sales"],
  });
  return { tool, prepare: prepare as ReturnType<typeof vi.fn>, execute: execute as ReturnType<typeof vi.fn> };
}

describe("prepare-only write tools", () => {
  const SECRET = "test-vira-token-secret-0123456789abcdefg";

  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("a user with the gate but without vira:write does not see the write tool", async () => {
    const { tool } = makeFakeWrite();
    const names = await listNames(
      buildViraServerFrom(FAKE_TOOLS, ctxFor(["field_sales_orders:approve"]), [tool]),
    );
    expect(names).not.toContain("approve_fake_order");
  });

  it("with vira:write, tools/list shows it with readOnlyHint false and the right destructiveHint", async () => {
    const { tool } = makeFakeWrite({ destructive: true });
    const client = await connect(
      buildViraServerFrom(
        FAKE_TOOLS,
        ctxFor(["vira:write", "field_sales_orders:approve"]),
        [tool],
      ),
    );
    const { tools } = await client.listTools();
    await client.close();
    const listed = tools.find((t) => t.name === "approve_fake_order");
    expect(listed).toBeDefined();
    expect(listed?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("tools/call runs prepare, never execute, and returns awaiting_confirmation with a verifiable token", async () => {
    const { tool, prepare, execute } = makeFakeWrite();
    const client = await connect(
      buildViraServerFrom(
        FAKE_TOOLS,
        ctxFor(["vira:write", "field_sales_orders:approve"]),
        [tool],
      ),
    );
    const res = await client.callTool({ name: "approve_fake_order", arguments: { orderId: "ord-1" } });
    await client.close();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatchObject({
      status: "awaiting_confirmation",
      title: WRITE_PREVIEW.title,
      summary: WRITE_PREVIEW.summary,
      note: expect.stringContaining("Nothing has been changed yet"),
    });

    const meta = (res as { _meta?: Record<string, unknown> })._meta?.["elorae/confirmation"] as
      | { token: string; expiresAt: string; destructive: boolean }
      | undefined;
    expect(meta?.token).toBeTruthy();
    expect(meta?.destructive).toBe(false);
    expect(JSON.stringify(res.content)).not.toContain(meta!.token);

    const claims = await verifyConfirmToken(meta!.token);
    expect(claims.sub).toBe("u-1");
    expect(claims.tool).toBe("approve_fake_order");
    expect(claims.args).toEqual(WRITE_ARGS);
  });

  it("prepare throwing ViraInputError → INVALID_INPUT, no token issued", async () => {
    const { tool, execute } = makeFakeWrite({
      prepare: async () => {
        throw new ViraInputError("Order is not pending.");
      },
    });
    const client = await connect(
      buildViraServerFrom(
        FAKE_TOOLS,
        ctxFor(["vira:write", "field_sales_orders:approve"]),
        [tool],
      ),
    );
    const res = await client.callTool({ name: "approve_fake_order", arguments: { orderId: "ord-1" } });
    await client.close();
    expect(execute).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(textOf(res)).toEqual({
      error: { code: "INVALID_INPUT", message: "Order is not pending." },
    });
    expect((res as { _meta?: unknown })._meta).toBeUndefined();
  });
});
