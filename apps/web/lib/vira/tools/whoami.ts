import { defineTool, type ParityCase, type ViraTool } from "./types";

export const tools: ViraTool[] = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description:
      "Returns the current Elorae user's id, name and permission codes. Call this first if you are unsure what the user may see.",
    gate: { kind: "anyValidToken" },
    inputShape: {},
    handler: async (_input, ctx) => ({
      id: ctx.actor.id,
      name: ctx.actor.name,
      permissions: ctx.actor.permissions,
    }),
  }),
];

/** whoami has no UI equivalent. */
export const parityCases: ParityCase[] = [];
