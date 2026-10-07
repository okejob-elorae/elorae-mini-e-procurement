import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ResyncSeedService, type SeedResyncBatchResult } from "./resync-seed.service";

class ResyncSalesOrdersBody {
  salesorderNos!: string[];
  // TODO(sub-A follow-up): { settlementId, unmatchedOnly } expansion — server
  // resolves the settlement's UNMATCHED SettlementLine orderNos into Jubelio
  // salesorderNo values (e.g. via salesorderNoForSettlement) and seeds those.
  // Deferred: needs apps/web's settlement match-key helper, out of scope for
  // this apps/api-only slice.
}

// Dijaga InternalSignGuard (APP_GUARD global di AuthModule): hanya apps/web
// yang menandatangani lewat apiFetch yang bisa memicu resync. JANGAN pasang
// @Public() di sini — auth/route-guard-audit.spec.ts akan gagal.
@ApiTags("jubelio-resync")
@Controller("jubelio/salesorders")
export class JubelioResyncController {
  constructor(private readonly seed: ResyncSeedService) {}

  @Post("resync")
  @HttpCode(200)
  @ApiOperation({
    summary: "Resync Jubelio salesorders the webhook pipeline missed",
    description:
      "Seeds JubelioSalesOrderResync rows (PENDING) under a new batchId for each given " +
      "Jubelio salesorder number. A background poller + BullMQ queue (concurrency 1) then " +
      "resolves no→id, fetches the detail from Jubelio, and drives the existing " +
      "SalesOrderWebhookHandler — same ingest as a live webhook, zero writer changes. " +
      "Does NOT re-run settlement matching; call matchSettlement separately once the batch " +
      "finishes. Protected by InternalSignGuard (signed channel from apps/web).",
  })
  @ApiOkResponse({ description: "{ batchId, seeded } — seeded is post-dedup row count." })
  async resync(
    @Body() body: ResyncSalesOrdersBody,
    @Req() req: Request & { userId?: string },
  ): Promise<SeedResyncBatchResult> {
    // Hanya teks yang diteruskan; angka/null dulu membuat seedBatch melempar 500.
    const salesorderNos: string[] = Array.isArray(body?.salesorderNos)
      ? (body.salesorderNos as unknown[]).filter((no): no is string => typeof no === "string")
      : [];
    // userId berasal dari header yang ikut ditandatangani (diset guard), jadi bisa dipercaya.
    const enqueuedById = typeof req.userId === "string" && req.userId !== "" ? req.userId : undefined;
    return this.seed.seedBatch({ salesorderNos, enqueuedById });
  }
}
