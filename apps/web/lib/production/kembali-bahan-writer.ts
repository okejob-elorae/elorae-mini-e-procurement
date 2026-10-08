// Bukan aksi server: penulis "kembalikan bahan". Pemagarnya (sesi + izin)
// adalah `kembalikanBahan` di app/actions/production.ts.

import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bagianBahanPenerimaan } from "./biaya-penerimaan";
import {
  AKSI_KEMBALI_BAHAN,
  BATAS_CATATAN_KEMBALI,
  SUMBER_KEMBALI_BAHAN,
  awalanKunciKembali,
  barisPengeluaran,
  batasNilaiKembali,
  hargaDalamBatas,
  hargaKeluar,
  jumlahPerBarang,
  kunciBarisKembali,
  periksaBarisKembali,
  rataRataSesudahKembali,
  sisaBahanDiCmt,
  type KodeTolakKembaliBahan,
  type SisaBahan,
} from "./kembali-bahan";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Sisa bahan di CMT per barang, dari DOKUMEN: Σ `MaterialIssue.items` −
 * Σ `StockAdjustment` bersumber `WO_MATERIAL_RETURN` milik WO ini. Bukan dari
 * salinan `issuedQty`/`returnedQty` di rencana (yang juga ditambah retur ke
 * pemasok dan bisa menyimpang dari dokumen).
 */
export async function bacaSisaBahanWo(
  klien: Klien,
  woId: string,
  pengeluaran?: Array<{ items: unknown }>,
): Promise<SisaBahan[]> {
  const issues =
    pengeluaran ?? (await klien.materialIssue.findMany({ where: { woId }, select: { items: true } }));
  const keluar = jumlahPerBarang(issues.flatMap((i) => barisPengeluaran(i.items)));
  const kembaliRows = await klien.stockAdjustment.findMany({
    where: { source: SUMBER_KEMBALI_BAHAN, externalRef: woId },
    select: { itemId: true, qtyChange: true },
  });
  const kembali = jumlahPerBarang(kembaliRows.map((r) => ({ itemId: r.itemId, qty: new Decimal(String(r.qtyChange)).abs() })));
  return sisaBahanDiCmt(keluar, kembali);
}

/**
 * Σ nilai bahan yang sudah kembali ke gudang (qty × harga keluarnya). Biaya
 * bahan yang dipikul penerimaan barang jadi dikurangi angka ini — bahan yang
 * kembali sudah bernilai lagi di gudang, jadi tidak boleh ikut masuk HPP.
 */
export async function nilaiBahanKembaliWo(klien: Klien, woId: string): Promise<Decimal> {
  const rows = await klien.stockAdjustment.findMany({
    where: { source: SUMBER_KEMBALI_BAHAN, externalRef: woId },
    select: { itemId: true, qtyChange: true, newAvgCost: true, prevAvgCost: true, docNumber: true, reason: true },
  });
  return dariPenyesuaian(rows).reduce((s, b) => s.plus(b.nilai), new Decimal(0));
}

export type BarisKembaliTercatat = {
  itemId: string;
  qty: number;
  hargaSatuan: number;
  nilai: number;
  docNumber: string;
};

export type HasilKembaliBahan =
  | {
      ok: true;
      ulangan: boolean;
      baris: BarisKembaliTercatat[];
      totalNilai: number;
      /** Nilai diperkecil karena biaya bahan sudah dibebankan ke barang jadi (`batasNilaiKembali`). */
      dibatasi: boolean;
    }
  | { ok: false; code: KodeTolakKembaliBahan; itemId?: string; sisa?: number };

export type MasukanKembaliBahan = {
  woId: string;
  baris: Array<{ itemId: string; qty: unknown }>;
  catatan?: string | null;
  /** Kunci idempotensi per isian formulir (dibuat sekali di layar). */
  kunci: string;
  userId: string;
};

function dariPenyesuaian(rows: Array<{ itemId: string; qtyChange: unknown; newAvgCost: unknown; prevAvgCost: unknown; docNumber: string; reason: string }>): BarisKembaliTercatat[] {
  return rows.map((r) => {
    // Harga satuan bahan yang kembali disimpan di alasan ("@ <harga>") — kolom
    // prev/newAvgCost milik baris gudang, bukan milik bahan yang kembali.
    const m = /@ (\d+(?:\.\d+)?)/.exec(r.reason);
    const qty = new Decimal(String(r.qtyChange)).abs();
    const harga = m ? new Decimal(m[1]) : new Decimal(0);
    return {
      itemId: r.itemId,
      qty: qty.toNumber(),
      hargaSatuan: harga.toNumber(),
      nilai: qty.mul(harga).toDecimalPlaces(2).toNumber(),
      docNumber: r.docNumber,
    };
  });
}

function ringkas(baris: BarisKembaliTercatat[], ulangan: boolean, dibatasi: boolean): HasilKembaliBahan {
  const total = baris.reduce((s, b) => s.plus(b.nilai), new Decimal(0));
  return { ok: true, ulangan, baris, totalNilai: total.toDecimalPlaces(2).toNumber(), dibatasi };
}

/**
 * Bahan kembali dari CMT ke gudang. Satu transaksi serializable:
 *  1. kunci idempotensi PALING DULU — isian yang sudah tercatat dikembalikan apa adanya;
 *  2. penjaga WO (ada, belum batal) dan sisa per barang dibaca DI DALAM transaksi,
 *     jadi dua pengembalian serentak tidak bisa melewati sisa bersama-sama;
 *  3. per barang: stok gudang bertambah pada harga keluarnya (rata-rata gudang
 *     dicampur), satu `StockAdjustment` POSITIVE, `returnedQty` rencana naik;
 *  4. satu baris `AuditLog` untuk seluruh pengembalian.
 */
export async function kembalikanBahanWo(m: MasukanKembaliBahan): Promise<HasilKembaliBahan> {
  const catatan = (m.catatan ?? "").trim();
  if (catatan.length > BATAS_CATATAN_KEMBALI) return { ok: false, code: "CATATAN_TERLALU_PANJANG" };

  const jalan = () =>
    runSerializable(async (tx): Promise<HasilKembaliBahan> => {
      const lama = await tx.stockAdjustment.findMany({
        where: { idempotencyKey: { startsWith: awalanKunciKembali(m.woId, m.kunci) } },
        select: { itemId: true, qtyChange: true, newAvgCost: true, prevAvgCost: true, docNumber: true, reason: true },
        orderBy: { docNumber: "asc" },
      });
      if (lama.length > 0) {
        // Jejaknya membawa kunci di metadata; dicocokkan di JS (barisnya sedikit per WO).
        const jejak = await tx.auditLog.findMany({
          where: { entityType: "WorkOrder", entityId: m.woId, action: AKSI_KEMBALI_BAHAN },
          select: { metadata: true },
        });
        const meta = jejak
          .map((j) => j.metadata as { kunciIdempotensi?: unknown; dibatasi?: unknown } | null)
          .find((x) => x?.kunciIdempotensi === m.kunci);
        return ringkas(dariPenyesuaian(lama), true, meta?.dibatasi === true);
      }

      const wo = await tx.workOrder.findUnique({
        where: { id: m.woId },
        select: {
          docNumber: true,
          status: true,
          consumptionPlan: true,
          vendor: { select: { name: true } },
          issues: { select: { id: true, items: true, totalCost: true } },
          receipts: { select: { materialCost: true, totalCostValue: true } },
        },
      });
      if (!wo) return { ok: false, code: "WO_TIDAK_DITEMUKAN" };
      if (wo.status === "CANCELLED") return { ok: false, code: "WO_SUDAH_DIBATALKAN" };

      const sisa = await bacaSisaBahanWo(tx, m.woId, wo.issues);
      const periksa = periksaBarisKembali(m.baris, sisa);
      if (!periksa.ok) return periksa;

      const issueIds = wo.issues.map((i) => i.id);
      const perBaris: Array<{ itemId: string; qty: Decimal; harga: Decimal; gerakan: Array<{ qty: unknown; variantSku: string | null }> }> = [];
      for (const b of periksa.baris) {
        const gerakan = issueIds.length
          ? await tx.stockMovement.findMany({
              where: { refType: "WO_ISSUE", refId: { in: issueIds }, itemId: b.itemId },
              select: { qty: true, unitCost: true, variantSku: true },
            })
          : [];
        const harga = hargaKeluar(
          gerakan.map((g) => ({ qty: String(g.qty), unitCost: g.unitCost == null ? null : String(g.unitCost) })),
        ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        perBaris.push({ itemId: b.itemId, qty: b.qty, harga, gerakan });
      }

      // Sesudah ada penerimaan barang jadi, nilai yang kembali dibatasi biaya
      // bahan yang belum dibebankan (aturan sementara di `batasNilaiKembali`).
      // Penerimaan dibaca di transaksi yang sama: penerimaan serentak konflik.
      const batas = batasNilaiKembali({
        adaPenerimaan: wo.receipts.length > 0,
        biayaBahanWo: wo.issues.reduce((s, i) => s.plus(String(i.totalCost)), new Decimal(0)),
        sudahKembali: await nilaiBahanKembaliWo(tx, m.woId),
        // Bagian BAHAN penerimaan, bukan totalCostValue (yang kini memuat ongkos jahit).
        sudahDibebankan: wo.receipts.reduce((s, r) => s.plus(bagianBahanPenerimaan(r)), new Decimal(0)),
      });
      const nilaiPenuh = perBaris.reduce((s, b) => s.plus(b.qty.mul(b.harga)), new Decimal(0));
      const { harga: hargaAkhir, dibatasi } = hargaDalamBatas(perBaris, batas);

      const tercatat: BarisKembaliTercatat[] = [];
      for (const [i, pb] of perBaris.entries()) {
        const b = { itemId: pb.itemId, qty: pb.qty };
        const harga = hargaAkhir[i];
        const gerakan = pb.gerakan;

        // Baris gudang tujuan: varian yang paling banyak dikeluarkan ke WO ini;
        // tanpa varian → baris gabungan null/"" (pencarian toleran keduanya).
        const perVarian = new Map<string, Decimal>();
        for (const g of gerakan) {
          const v = g.variantSku ?? "";
          perVarian.set(v, (perVarian.get(v) ?? new Decimal(0)).plus(new Decimal(String(g.qty)).abs()));
        }
        const varian = [...perVarian.entries()].sort((a, z) => z[1].comparedTo(a[1]))[0]?.[0] ?? "";
        const baris = varian === ""
          ? await tx.inventoryValue.findFirst({
              where: { itemId: b.itemId, OR: [{ variantSku: null }, { variantSku: "" }] },
              select: { id: true, qtyOnHand: true, avgCost: true },
            })
          : await tx.inventoryValue.findFirst({
              where: { itemId: b.itemId, variantSku: varian },
              select: { id: true, qtyOnHand: true, avgCost: true },
            });

        const stokSebelum = baris ? new Decimal(String(baris.qtyOnHand)) : new Decimal(0);
        const rataSebelum = baris ? new Decimal(String(baris.avgCost)) : new Decimal(0);
        const stokSesudah = stokSebelum.plus(b.qty);
        const rataSesudah = rataRataSesudahKembali(stokSebelum, rataSebelum, b.qty, harga);
        const nilaiSesudah = stokSesudah.mul(rataSesudah);

        if (baris) {
          await tx.inventoryValue.update({
            where: { id: baris.id },
            data: {
              qtyOnHand: stokSesudah.toNumber(),
              avgCost: rataSesudah.toNumber(),
              totalValue: nilaiSesudah.toNumber(),
              lastUpdated: new Date(),
            },
          });
        } else {
          await tx.inventoryValue.create({
            data: {
              itemId: b.itemId,
              variantSku: varian,
              qtyOnHand: stokSesudah.toNumber(),
              reservedQty: 0,
              avgCost: rataSesudah.toNumber(),
              totalValue: nilaiSesudah.toNumber(),
            },
          });
        }

        const docNumber = await generateDocNumber("ADJ", tx);
        // Harga satuan PERTAMA (sesudah nomor WO, yang tidak memuat "@"): kolom
        // penyesuaian tidak punya harga satuan, jadi riwayat membacanya dari sini.
        const alasan = `Kembali bahan ${wo.docNumber} @ ${harga.toFixed(2)} dari ${wo.vendor?.name ?? "CMT"}${catatan ? ` — ${catatan}` : ""}`;
        await tx.stockAdjustment.create({
          data: {
            docNumber,
            itemId: b.itemId,
            type: "POSITIVE",
            qtyChange: b.qty.toNumber(),
            reason: alasan.slice(0, 190),
            prevQty: stokSebelum.toNumber(),
            newQty: stokSesudah.toNumber(),
            prevAvgCost: rataSebelum.toNumber(),
            newAvgCost: rataSesudah.toNumber(),
            createdById: m.userId,
            source: SUMBER_KEMBALI_BAHAN,
            externalRef: m.woId,
            idempotencyKey: kunciBarisKembali(m.woId, m.kunci, b.itemId),
          },
        });
        tercatat.push({
          itemId: b.itemId,
          qty: b.qty.toNumber(),
          hargaSatuan: harga.toNumber(),
          nilai: b.qty.mul(harga).toDecimalPlaces(2).toNumber(),
          docNumber,
        });
      }

      // Salinan di rencana: returnedQty naik (dibaca layar lama & dasbor).
      let rencana: unknown = wo.consumptionPlan;
      if (typeof rencana === "string") {
        try {
          rencana = JSON.parse(rencana);
        } catch {
          rencana = null;
        }
      }
      if (Array.isArray(rencana)) {
        const barisRencana = rencana as Array<{ itemId?: unknown; returnedQty?: unknown }>;
        let berubah = false;
        for (const t of tercatat) {
          const p = barisRencana.find((r) => r?.itemId === t.itemId);
          if (!p) continue;
          p.returnedQty = new Decimal(Number(p.returnedQty) || 0).plus(t.qty).toNumber();
          berubah = true;
        }
        if (berubah) {
          await tx.workOrder.update({ where: { id: m.woId }, data: { consumptionPlan: JSON.stringify(barisRencana) } });
        }
      }

      const hasil = ringkas(tercatat, false, dibatasi);
      await tx.auditLog.create({
        data: {
          userId: m.userId,
          action: AKSI_KEMBALI_BAHAN,
          entityType: "WorkOrder",
          entityId: m.woId,
          reason: catatan || null,
          changes: {
            baris: tercatat.map((t) => ({ itemId: t.itemId, qty: t.qty, hargaSatuan: t.hargaSatuan, docNumber: t.docNumber })),
          },
          metadata: {
            kunciIdempotensi: m.kunci,
            totalNilai: hasil.ok ? hasil.totalNilai : 0,
            woDocNumber: wo.docNumber,
            dibatasi,
            nilaiPenuh: nilaiPenuh.toDecimalPlaces(2).toNumber(),
            batasNilai: batas == null ? null : batas.toNumber(),
          },
        },
      });
      return hasil;
    });

  try {
    return await jalan();
  } catch (err) {
    // Kembarannya commit lebih dulu dan bentrok di kolom kunci: baca pemenangnya.
    if (!bentrokKunciKiriman(err)) throw err;
    return jalan();
  }
}

export type BarisRiwayatKembali = {
  id: string;
  docNumber: string;
  itemId: string;
  qty: number;
  hargaSatuan: number;
  nilai: number;
  catatan: string | null;
  createdAt: Date;
  oleh: string | null;
};

/** Riwayat bahan kembali sebuah WO, terbaru dulu. */
export async function riwayatKembaliBahan(woId: string): Promise<BarisRiwayatKembali[]> {
  const rows = await prisma.stockAdjustment.findMany({
    where: { source: SUMBER_KEMBALI_BAHAN, externalRef: woId },
    select: {
      id: true,
      docNumber: true,
      itemId: true,
      qtyChange: true,
      newAvgCost: true,
      prevAvgCost: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const [ringkasan] = dariPenyesuaian([r]);
    const pisah = r.reason.indexOf(" — ");
    return {
      id: r.id,
      docNumber: r.docNumber,
      itemId: r.itemId,
      qty: ringkasan.qty,
      hargaSatuan: ringkasan.hargaSatuan,
      nilai: ringkasan.nilai,
      catatan: pisah >= 0 ? r.reason.slice(pisah + 3) : null,
      createdAt: r.createdAt,
      oleh: r.createdBy?.name ?? r.createdBy?.email ?? null,
    };
  });
}
