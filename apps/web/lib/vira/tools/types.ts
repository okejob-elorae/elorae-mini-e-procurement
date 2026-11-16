import type { z } from "zod";
import type { ViraActor, ViraGate } from "../akses";

export type ViraToolContext = { actor: ViraActor; baseUrl: string };

export type ViraTool<I extends z.ZodRawShape = z.ZodRawShape> = {
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
  | { tool: string; kind: "pageCode"; pageFile: string; codes: string[] };
