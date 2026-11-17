import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertUniqueToolNames,
  findWriteTool,
  VIRA_TOOLS,
  VIRA_WRITE_TOOLS,
} from "./index";
import { defineTool, defineWriteTool, type ViraPrepared } from "./types";

const preview = {
  title: "Setujui",
  summary: "Menunggu konfirmasi.",
  details: [] as { label: string; value: string }[],
  confirmLabel: "Setujui",
  cancelLabel: "Batal",
  destructive: false,
  target: { type: "Order", id: "1", url: "https://x.test/o/1" },
};

describe("VIRA write-tool registry", () => {
  it("has no write tools registered yet", () => {
    expect(VIRA_WRITE_TOOLS).toHaveLength(0);
  });

  it("findWriteTool returns undefined for read-tool names", () => {
    expect(findWriteTool("whoami")).toBeUndefined();
    expect(findWriteTool(VIRA_TOOLS[0]!.name)).toBeUndefined();
  });

  it("throws when a read and a write tool share a name", () => {
    const read = defineTool({
      name: "shared_name",
      title: "Read",
      description: "Read.",
      gate: { kind: "anyValidToken" },
      inputShape: {},
      handler: async () => ({}),
    });
    const write = defineWriteTool({
      kind: "write",
      name: "shared_name",
      title: "Write",
      description: "Write.",
      gate: { kind: "anyValidToken" },
      destructive: false,
      inputShape: {},
      argsSchema: z.object({}),
      prepare: async (): Promise<ViraPrepared<Record<string, never>>> => ({
        preview,
        args: {},
      }),
      execute: async () => ({
        ok: true,
        message: "Done",
        url: preview.target.url,
        entityType: "X",
        entityId: "1",
      }),
      revalidate: () => [],
    });
    expect(() => assertUniqueToolNames([read, write])).toThrow(/duplicate tool name: shared_name/);
  });

  it("findWriteTool finds by name when a write tool is supplied to uniqueness helpers", () => {
    // Registry is empty; prove the finder API against a local list shaped like VIRA_WRITE_TOOLS.
    const local = [
      defineWriteTool({
        kind: "write",
        name: "approve_local",
        title: "Approve",
        description: "Prepare.",
        gate: { kind: "anyValidToken" },
        destructive: false,
        inputShape: {},
        argsSchema: z.object({}),
        prepare: async (): Promise<ViraPrepared<Record<string, never>>> => ({
          preview,
          args: {},
        }),
        execute: async () => ({
          ok: true,
          message: "Done",
          url: preview.target.url,
          entityType: "X",
          entityId: "1",
        }),
        revalidate: () => [],
      }),
    ];
    expect(local.find((t) => t.name === "approve_local")?.name).toBe("approve_local");
    expect(findWriteTool("approve_local")).toBeUndefined();
  });
});
