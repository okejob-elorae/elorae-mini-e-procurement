import { listSettlements } from "@/lib/finance/settlement/queries";
import { ViraInputError } from "../errors";
import { listInputShape, recordUrl, toPage } from "../output";
import { defineTool, type ParityCase, type ViraTool } from "./types";

export const tools: ViraTool[] = [
  defineTool({
    name: "list_marketplace_settlements",
    title: "Marketplace settlements (pencairan dana)",
    description:
      "Lists marketplace settlements (pencairan dana): id, channel, period start/end, status, and a link to the record. " +
      "Does not return totals, fees, or net amounts; open the link to see those in the app.",
    gate: { kind: "code", code: "finance:settlements:view" },
    // listSettlements has no filters; paging only.
    inputShape: { ...listInputShape },
    handler: async (input, ctx) => {
      const { limit, offset } = input;
      if (offset % limit !== 0) throw new ViraInputError("offset must be a multiple of limit");
      const { items: rows, totalCount } = await listSettlements({ page: offset / limit + 1, pageSize: limit });
      // listSettlements carries no money columns (no gross, fee, Jubelio fee or net), so none are returned.
      const items = rows.map((s) => ({
        id: s.id,
        channel: s.marketplace,
        periodStart: s.periodFromIso,
        periodEnd: s.periodToIso,
        status: s.status,
        url: recordUrl(ctx.baseUrl, `/backoffice/finance/settlements/${s.id}`),
      }));
      return toPage(items, totalCount, offset, limit);
    },
  }),
];

export const parityCases: ParityCase[] = [
  {
    tool: "list_marketplace_settlements",
    kind: "pageCode",
    pageFile: "apps/web/app/backoffice/finance/settlements/page.tsx",
    codes: ["finance:settlements:view"],
  },
];
