import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  defineWriteTool,
  isWriteTool,
  type ViraExecuteResult,
  type ViraPrepared,
} from "./types";

const preview = {
  title: "Setujui",
  summary: "Menunggu konfirmasi.",
  details: [] as { label: string; value: string }[],
  confirmLabel: "Setujui",
  cancelLabel: "Batal",
  destructive: false,
  target: { type: "Order", id: "1", url: "https://x.test/o/1" },
};

describe("defineWriteTool / isWriteTool", () => {
  it("defineWriteTool returns the tool with kind: write", () => {
    const tool = defineWriteTool({
      kind: "write",
      name: "approve_thing",
      title: "Approve",
      description: "Prepare an approval.",
      gate: { kind: "anyValidToken" },
      destructive: false,
      inputShape: { id: z.string() },
      argsSchema: z.object({ id: z.string() }),
      prepare: async (input): Promise<ViraPrepared<{ id: string }>> => ({
        preview,
        args: { id: input.id },
      }),
      execute: async (): Promise<ViraExecuteResult> => ({
        ok: true,
        message: "Done",
        url: preview.target.url,
        entityType: "Order",
        entityId: "1",
      }),
      revalidate: () => [],
    });
    expect(tool.kind).toBe("write");
    expect(tool.name).toBe("approve_thing");
    expect(isWriteTool(tool)).toBe(true);
  });

  it("isWriteTool is true only for write tools", () => {
    const read = defineTool({
      name: "whoami_fake",
      title: "Who",
      description: "Read.",
      gate: { kind: "anyValidToken" },
      inputShape: {},
      handler: async () => ({}),
    });
    expect(isWriteTool(read)).toBe(false);
  });
});
