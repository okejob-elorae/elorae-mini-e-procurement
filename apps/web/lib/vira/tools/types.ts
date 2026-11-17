import type { z } from "zod";
import type { ViraActor, ViraGate } from "../akses";

export type ViraToolContext = { actor: ViraActor; baseUrl: string };

export type ViraTool<I extends z.ZodRawShape = z.ZodRawShape> = {
  /** Optional so phase 1 tools compile unchanged. */
  kind?: "read";
  name: string; // snake_case, unique
  title: string; // short human title
  description: string; // what it answers + what it does NOT cover
  gate: ViraGate;
  inputShape: I;
  handler: (input: z.infer<z.ZodObject<I>>, ctx: ViraToolContext) => Promise<unknown>;
};

/** Typed helper so modules can export arrays of tools with different inputs. */
export function defineTool<I extends z.ZodRawShape>(tool: ViraTool<I>): ViraTool {
  // The handler is checked against its own input shape here; the array only needs the erased form.
  return tool as unknown as ViraTool;
}

export type ViraConfirmationPreview = {
  title: string; // e.g. "Setujui pesanan SO/2026/0123"
  summary: string; // one sentence, Indonesian
  details: { label: string; value: string }[]; // max 12 rows
  confirmLabel: string; // e.g. "Setujui"
  cancelLabel: string; // e.g. "Batal"
  destructive: boolean; // true for reject/close/cancel-type actions (button styling hint)
  target: { type: string; id: string; url: string };
};

export type ViraPrepared<A> = { preview: ViraConfirmationPreview; args: A };

export type ViraExecuteResult =
  | {
      ok: true;
      message: string;
      url: string;
      entityType: string;
      entityId: string;
      /** Small values `afterSuccess` needs from the writer's result (e.g. docNumber). Never returned to VIRA. */
      extra?: Record<string, string>;
    }
  | { ok: false; code: string; message: string; url?: string };

export type ViraWriteTool<I extends z.ZodRawShape = z.ZodRawShape, A = unknown> = {
  kind: "write";
  name: string;
  title: string;
  description: string;
  gate: ViraGate;
  /** Static: true for reject/close/cancel-type tools. Drives MCP destructiveHint and preview.destructive. */
  destructive: boolean;
  inputShape: I;
  /** Zod schema for `args`; the confirm route re-parses the token's args with it. */
  argsSchema: z.ZodType<A>;
  prepare: (input: z.infer<z.ZodObject<I>>, ctx: ViraToolContext) => Promise<ViraPrepared<A>>;
  execute: (args: A, ctx: ViraToolContext) => Promise<ViraExecuteResult>;
  /** Copy of the mirrored action's revalidatePath list. */
  revalidate: (args: A, result: ViraExecuteResult) => string[];
  /** Optional side effect after a successful execute (e.g. a notification the action sends). Must not throw. */
  afterSuccess?: (
    args: A,
    result: Extract<ViraExecuteResult, { ok: true }>,
    ctx: ViraToolContext,
  ) => Promise<void>;
};

/** Typed helper so modules can export arrays of write tools with different inputs. */
export function defineWriteTool<I extends z.ZodRawShape, A>(tool: ViraWriteTool<I, A>): ViraWriteTool {
  return tool as unknown as ViraWriteTool;
}

export type AnyViraTool = ViraTool | ViraWriteTool;

export function isWriteTool(t: AnyViraTool): t is ViraWriteTool {
  return (t as ViraWriteTool).kind === "write";
}

/** How the parity spec (VIRA-10) proves a tool's gate equals the UI's gate. */
export type ParityCase =
  | {
      tool: string;
      kind: "action";
      actionModule: string;
      actionExport: string;
      libModule: string;
      libExport: string;
      args: unknown[];
    }
  | { tool: string; kind: "route"; path: string }
  | { tool: string; kind: "predicate"; module: string; exportName: string }
  | { tool: string; kind: "pageCode"; pageFile: string; codes: string[] }
  | {
      tool: string;
      kind: "writeAction";
      actionModule: string;
      actionExport: string;
      writerModule: string;
      writerExport: string;
      args: unknown[];
    };
