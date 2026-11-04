import { Inject, Injectable, Logger } from "@nestjs/common";
import { applyJubelioStockAdjustment, parseJubelioQty } from "@elorae/db";
import type { JubelioWebhookEvent } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { OUTBOX_STATUS } from "../outbox/outbox-status";
import { bacaStokTerkirim } from "../outbox/handlers/stock-push.handler";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

/**
 * Penekan gema push stok (analisis-webhook-stok §5, Usulan B).
 *
 * ERP mendorong `end_qty` (onHand − penahanan sales lapangan, lihat jubelio-stock-contract.ts)
 * ke Jubelio, dan webhook ini menulis balik `end_qty` sebagai onHand (penulis menambahkan
 * penahanan yang terbuka saat webhook diterapkan). Gema push kita sendiri tidak membawa perubahan
 * apa pun dari Jubelio — dan bila penahanan berubah sejak push, menuliskannya menggeser onHand —
 * jadi tidak ditulis ulang. Varian yang `end_qty`-nya SAMA dengan push stok terakhir untuk
 * kodenya dilewati, selama push itu:
 *  - diterima Jubelio paling lama JENDELA_GEMA_PUSH_MS sebelum webhook ini DITERIMA (lebih tua →
 *    tidak menekan apa pun; diukur dari waktu terima, jadi gema yang tertahan di antrean tetap dikenali);
 *  - belum disusul webhook stok yang benar-benar DITERAPKAN untuk kode itu SESUDAH push (Jubelio
 *    sudah berubah sesudah push, jadi angka yang sama berikutnya adalah perubahan sah, mis.
 *    7 → 5 → 7). Penerapan SEBELUM push tidak membatalkan apa pun.
 * `end_qty` yang berbeda tetap ditulis seperti dulu (arti `end_qty` tidak diubah di sini).
 */
export const JENDELA_GEMA_PUSH_MS = 10 * 60_000;
export const ALASAN_GEMA_PUSH = "echo_of_push";

/** Kode Jubelio dibandingkan dipangkas + huruf kecil (kolasi MariaDB prod abai-huruf). */
const kunciKode = (kode: string) => kode.trim().toLowerCase();

type StockWebhookPayload = {
  action?: string;
  item_group_id?: number;
  item_group_name?: string;
  item_ids?: number[];
  location_id?: number | null;
  // old shape — still recognised so we can flag it explicitly
  item_code?: string;
  end_qty?: number | string;
};

type GroupDetailSku = {
  item_id: number;
  item_code?: string;
  end_qty?: number | string | null;
};

type GroupDetailResponse = {
  item_group_id?: number;
  product_skus?: GroupDetailSku[];
};

@Injectable()
export class StockWebhookHandler implements WebhookEventHandler {
  private readonly logger = new Logger(StockWebhookHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioWebhookEvent): Promise<HandlerOutcome> {
    const payload = row.rawPayload as unknown as StockWebhookPayload;

    // Old shape used to send { item_code, end_qty }. Jubelio switched to a change
    // notification with { item_group_id, item_ids[] } — no qty inline. Fail fast
    // on the old shape rather than half-supporting both.
    if (typeof payload?.item_code === "string" && payload.item_ids === undefined) {
      return { kind: "skipped", reason: SKIP_REASONS.UNSUPPORTED_PAYLOAD_SHAPE };
    }

    const groupId = payload?.item_group_id;
    if (typeof groupId !== "number") {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID };
    }

    const itemIds = Array.isArray(payload?.item_ids)
      ? payload.item_ids.filter((n): n is number => typeof n === "number")
      : [];
    if (itemIds.length === 0) {
      return { kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS };
    }

    const detail = await this.http.get<GroupDetailResponse>(`/inventory/items/group/${groupId}`);
    const productSkus = Array.isArray(detail?.product_skus) ? detail.product_skus : [];
    /* Kept RAW: parseJubelioQty validates before coercing, so null and "" never become 0. */
    const rawEndQtyByItemId = new Map<number, unknown>();
    for (const sku of productSkus) {
      if (typeof sku?.item_id === "number" && sku.end_qty !== undefined) {
        rawEndQtyByItemId.set(sku.item_id, sku.end_qty);
      }
    }

    const mappings = await this.prisma.jubelioProductMapping.findMany({
      where: { jubelioItemId: { in: itemIds } },
    });
    if (mappings.length === 0) {
      return { kind: "skipped", reason: `${SKIP_REASONS.ORPHAN_GROUP}:${groupId}` };
    }

    // Dibaca SESUDAH detail grup diambil: push yang selesai selama GET pun ikut terhitung.
    const pushTerakhir = await this.pushTerakhirPerKode([...new Set(mappings.map((m) => m.itemId))], row.receivedAt);

    let diterapkan = 0;
    const gema: string[] = [];
    for (const m of mappings) {
      if (!rawEndQtyByItemId.has(m.jubelioItemId)) {
        this.logger.warn(
          `stock webhook ${row.id}: item_id ${m.jubelioItemId} in payload but missing from group ${groupId} detail — skipping this sku`,
        );
        continue;
      }
      const rawEndQty = rawEndQtyByItemId.get(m.jubelioItemId);
      const endQty = parseJubelioQty(rawEndQty);
      if (endQty === null) {
        this.logger.warn(
          `stock webhook ${row.id}: item_id ${m.jubelioItemId} end_qty ${JSON.stringify(rawEndQty)} is not a valid Jubelio quantity — skipping this sku`,
        );
        continue;
      }
      if (pushTerakhir.get(kunciKode(m.jubelioItemCode)) === endQty) {
        gema.push(`${m.jubelioItemCode}=${endQty}`);
        continue;
      }
      diterapkan += 1;

      /*
       * The RAW end_qty goes to the writer, which adds the field-sales holds back itself inside
       * its transaction, after locking the row, and only while stock pushes are enabled — see
       * effectiveOfflineReservedQty in jubelio-stock-contract.ts. Never pre-adjust it here.
       */
      await applyJubelioStockAdjustment(this.prisma, {
        itemId: m.itemId,
        variantSku: m.erpVariantSku,
        jubelioEndQty: endQty,
        idempotencyKey: `${row.id}:${m.jubelioItemId}`,
        externalRef: `${groupId}/${m.jubelioItemCode}`,
        reason: `Jubelio stock webhook ${row.id} item_id=${m.jubelioItemId}`,
      });
    }

    if (gema.length > 0) {
      this.logger.log(
        `stock webhook ${row.id}: ${ALASAN_GEMA_PUSH} — ${gema.join(", ")} sama dengan push stok terakhir ERP; tidak ditulis ke onHand`,
      );
      if (diterapkan === 0) return { kind: "skipped", reason: ALASAN_GEMA_PUSH };
    }
    return { kind: "processed" };
  }

  /**
   * Angka push stok terakhir per kode Jubelio (kunci huruf kecil) yang masih bisa menggema.
   * Sumbernya `JubelioOutbox.payload.terkirim`, ditulis penangan push sesudah setiap PUT
   * berhasil — jadi status baris tidak menentukan: baris PENDING/PROCESSING (angka sudah
   * diterima sebelum `markDone`) dan baris DEAD (grup lain gagal sesudah grup ini diterima)
   * ikut dibaca.
   *
   * Jendela diukur mundur dari saat webhook DITERIMA (bila lebih awal dari sekarang): gema
   * yang tertahan di antrean, dihidupkan sweeper, atau dicoba ulang admin tetap dikenali.
   */
  private async pushTerakhirPerKode(itemIds: string[], diterimaPada?: Date | null): Promise<Map<string, number>> {
    const sekarang = Date.now();
    const diterima = diterimaPada instanceof Date && Number.isFinite(diterimaPada.getTime()) ? diterimaPada.getTime() : sekarang;
    const batas = new Date(Math.min(diterima, sekarang) - JENDELA_GEMA_PUSH_MS);
    const baris = await this.prisma.jubelioOutbox.findMany({
      where: {
        entityType: "stock_push",
        entityId: { in: itemIds },
        OR: [
          { processedAt: { gte: batas } },
          { deadAt: { gte: batas } },
          { status: { in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.PROCESSING] } },
        ],
      },
      select: { payload: true },
    });

    const terakhir = new Map<string, { endQty: number; pada: number }>();
    for (const b of baris) {
      for (const e of bacaStokTerkirim(b.payload)) {
        const pada = Date.parse(e.pada);
        // Jendela ditegakkan dari waktu PUT, bukan dari status baris.
        if (pada < batas.getTime()) continue;
        const k = kunciKode(e.item_code);
        const lama = terakhir.get(k);
        if (!lama || pada > lama.pada) terakhir.set(k, { endQty: e.end_qty, pada });
      }
    }
    if (terakhir.size === 0) return new Map();

    // Webhook yang sudah diterapkan sesudah push = Jubelio sudah berubah sejak angka kita;
    // push itu bukan lagi keadaan terakhir. externalRef penulis = `<grup>/<kode Jubelio>`.
    const sudahDiterapkan = await this.prisma.stockAdjustment.findMany({
      where: { source: "JUBELIO_WEBHOOK", itemId: { in: itemIds }, createdAt: { gte: batas } },
      select: { externalRef: true, createdAt: true },
    });
    for (const a of sudahDiterapkan) {
      const ref = a.externalRef ?? "";
      const garis = ref.indexOf("/");
      if (garis < 0) continue;
      const k = kunciKode(ref.slice(garis + 1));
      const push = terakhir.get(k);
      if (push && a.createdAt.getTime() >= push.pada) terakhir.delete(k);
    }

    return new Map([...terakhir].map(([k, v]) => [k, v.endQty]));
  }
}
