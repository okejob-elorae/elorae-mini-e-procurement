import { Inject, Injectable, Logger } from "@nestjs/common";
import type { JubelioOutbox, JubelioProductMapping, Prisma } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";
import type { HandlerOutcome, OutboxHandler } from "./handler.types";

type Pemetaan = Pick<JubelioProductMapping, "jubelioItemGroupId" | "jubelioItemCode" | "erpVariantSku">;

/** Kunci varian ERP: dipangkas, huruf kecil (kolasi MariaDB prod memang abai-huruf). */
const kunci = (sku: string | null | undefined) => (sku ?? "").trim().toLowerCase();

/**
 * Satu angka yang DITERIMA Jubelio dari push stok, disimpan di `JubelioOutbox.payload.terkirim`
 * sesudah PUT-nya berhasil. Dibaca penangan webhook stok untuk menekan gema push kita sendiri
 * (`stock.handler.ts`, `ALASAN_GEMA_PUSH`). `pada` = ISO waktu PUT diterima.
 */
export type StokTerkirim = { item_code: string; end_qty: number; pada: string };

/** Baca `payload.terkirim`; payload lama (tanpa catatan) atau entri rusak → dibuang, tidak dilempar. */
export function bacaStokTerkirim(payload: unknown): StokTerkirim[] {
  const daftar = payload && typeof payload === "object" ? (payload as { terkirim?: unknown }).terkirim : undefined;
  if (!Array.isArray(daftar)) return [];
  return daftar.filter((e): e is StokTerkirim => {
    if (!e || typeof e !== "object") return false;
    const { item_code, end_qty, pada } = e as Record<string, unknown>;
    return (
      typeof item_code === "string" &&
      typeof end_qty === "number" &&
      Number.isFinite(end_qty) &&
      typeof pada === "string" &&
      Number.isFinite(Date.parse(pada))
    );
  });
}

/**
 * Push stok satu barang ERP ke Jubelio: `available` (onHand − reserved, minimal 0)
 * per baris `InventoryValue`, ke kode barang Jubelio PEMETAAN baris itu.
 *
 * Baris → kode Jubelio lewat `erpVariantSku` (kebalikan persis webhook stok, yang
 * menulis `jubelioItemId` → baris `erpVariantSku`). Kunci ERP tidak selalu sama
 * dengan kode Jubelio: ingest katalog menyimpan "27000101P-XL" untuk kode
 * "27000101P-BLK-XL", jadi mengirim `variantSku` mentah mengirim kode yang tidak
 * dikenal Jubelio.
 *
 * Baris yang TIDAK dikirim (dicatat ke log, bukan ditebak):
 *  - baris gabungan (variantSku null/"") pada barang yang pemetaannya per varian —
 *    dulu dikirim ke `jubelioItemCode` pemetaan sembarang, sehingga satu ukuran di
 *    marketplace menerima seluruh stok gabungan;
 *  - baris varian tanpa pemetaan — kode yang tidak dikenal Jubelio;
 *  - baris yang kuncinya dipakai DUA pemetaan (dua warna, satu kunci ukuran) —
 *    angkanya gabungan keduanya dan tidak bisa dibagi.
 * Barang sederhana (satu pemetaan ber-`erpVariantSku` "") memetakan baris
 * gabungannya ke satu-satunya pemetaan itu. Baris yang menuju kode yang sama
 * (kembar null/"") dijumlah jadi satu angka, clamp 0 sesudah dijumlah. Baris
 * kosong (0 pcs, 0 ditahan) yang tidak punya tujuan dilewati tanpa dicatat.
 */
@Injectable()
export class StockPushHandler implements OutboxHandler {
  private readonly logger = new Logger(StockPushHandler.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async handle(row: JubelioOutbox): Promise<HandlerOutcome> {
    const itemId = row.entityId;

    const mappings: Pemetaan[] = await this.prisma.jubelioProductMapping.findMany({ where: { itemId } });
    if (mappings.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING };
    }

    const inventory = await this.prisma.inventoryValue.findMany({ where: { itemId } });
    if (inventory.length === 0) {
      return { kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY };
    }

    const sederhana = mappings.filter((m) => kunci(m.erpVariantSku) === "");
    const perVarian = new Map<string, Pemetaan[]>();
    for (const m of mappings) {
      const k = kunci(m.erpVariantSku);
      if (k === "") continue;
      perVarian.set(k, [...(perVarian.get(k) ?? []), m]);
    }

    // grup Jubelio → kode Jubelio → available (belum di-clamp). Dijumlah per kode: baris
    // kembar null/"" (atau beda huruf) yang menuju kode yang sama harus jadi SATU angka —
    // dua entri ber-item_code sama dalam satu PUT membuat yang terakhir menang.
    const perGrup = new Map<number, Map<string, number>>();
    const dilewati: string[] = [];
    for (const iv of inventory) {
      const k = kunci(iv.variantSku);
      // Baris kosong (0 pcs, 0 ditahan) yang tidak punya tujuan tidak membawa angka — tidak dicatat.
      const kosong = Number(iv.qtyOnHand) === 0 && Number(iv.reservedQty) === 0;
      let tujuan: Pemetaan | null = null;
      if (k === "") {
        // Baris gabungan hanya punya tujuan pada barang sederhana dengan tepat satu pemetaan.
        if (perVarian.size === 0 && sederhana.length === 1) tujuan = sederhana[0];
        else if (!kosong) dilewati.push("(tanpa varian)");
      } else {
        const cocok = perVarian.get(k) ?? [];
        if (cocok.length === 1) tujuan = cocok[0];
        else if (!kosong) dilewati.push(`${iv.variantSku}${cocok.length > 1 ? " (dipetakan ke beberapa kode Jubelio)" : " (tanpa pemetaan)"}`);
      }
      if (!tujuan) continue;
      const kode = perGrup.get(tujuan.jubelioItemGroupId) ?? new Map<string, number>();
      // Push AVAILABLE, not on-hand (BOUNDARY §D6/D7).
      const tersedia = Number(iv.qtyOnHand) - Number(iv.reservedQty);
      kode.set(tujuan.jubelioItemCode, (kode.get(tujuan.jubelioItemCode) ?? 0) + tersedia);
      perGrup.set(tujuan.jubelioItemGroupId, kode);
    }

    if (dilewati.length > 0) {
      this.logger.warn(
        `Stock push itemId=${itemId}: baris stok tidak dikirim — ${dilewati.join(", ")}. ` +
          `Baris tanpa varian pada barang bervarian harus dipindah ke baris per ukuran dulu.`,
      );
    }
    if (perGrup.size === 0) {
      return { kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:stock_rows` };
    }

    // Catatan percobaan sebelumnya dipertahankan (angkanya memang sudah diterima Jubelio);
    // kode yang dikirim ulang diganti angka dan waktunya yang baru.
    const terkirim = new Map(bacaStokTerkirim(row.payload).map((e) => [kunci(e.item_code), e]));
    let jumlah = 0;
    for (const [grup, kode] of perGrup) {
      // Clamp at 0 SESUDAH dijumlah — Jubelio cannot hold negative stock; oversell is
      // surfaced via AdminNotification. Virtual-warehouse subtraction (EPIC-19) not yet modeled.
      const items = [...kode].map(([item_code, tersedia]) => ({ item_code, end_qty: Math.max(0, tersedia) }));
      await this.http.put(`/inventory/items/${grup}/stock`, { items });
      // Dicatat per grup SESUDAH PUT berhasil: kalau grup berikutnya gagal, gema grup ini
      // tetap dikenali. Angka yang dicatat = angka yang dikirim (sesudah clamp).
      const pada = new Date().toISOString();
      for (const it of items) terkirim.set(kunci(it.item_code), { ...it, pada });
      await this.catatTerkirim(row, [...terkirim.values()]);
      jumlah += items.length;
    }

    this.logger.log(`Pushed stock for itemId=${itemId} (${jumlah} variant rows)`);
    return { kind: "processed" };
  }

  /**
   * Simpan angka yang diterima Jubelio ke payload baris ini (isi lama seperti `sumber`/`ref`
   * dipertahankan). Gagal menyimpan TIDAK menggagalkan push — Jubelio sudah menerima angkanya,
   * dan mengulang PUT tidak menolong; akibatnya hanya gema push ini tidak ditekan (perilaku lama).
   */
  private async catatTerkirim(row: JubelioOutbox, terkirim: StokTerkirim[]): Promise<void> {
    const asal = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
    try {
      await this.prisma.jubelioOutbox.update({
        where: { id: row.id },
        data: { payload: { ...(asal as Prisma.JsonObject), terkirim } as Prisma.InputJsonObject },
      });
    } catch (e) {
      this.logger.warn(
        `Stock push ${row.id}: angka terkirim tidak tersimpan (${e instanceof Error ? e.message : String(e)}) — ` +
          `gema webhook stok untuk push ini tidak akan ditekan.`,
      );
    }
  }
}
