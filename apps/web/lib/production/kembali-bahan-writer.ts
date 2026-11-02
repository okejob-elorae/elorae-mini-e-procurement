// Bukan aksi server: penulis "kembalikan bahan". Pemagarnya (sesi + izin)
// adalah `kembalikanBahan` di app/actions/production.ts.

import { Decimal } from "decimal.js";
import { prisma, moveMainStock, type Prisma, type StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { gerakStokPerDokumen, type GerakDokumen } from "@/lib/inventory/kartu-stok-queries";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bagianBahanPenerimaan } from "./biaya-penerimaan";
import {
  AKSI_KEMBALI_BAHAN,
  BATAS_CATATAN_KEMBALI,
  SUMBER_KEMBALI_BAHAN,
  alasanKembaliBahan,
  awalanKunciKembali,
  barisHargaPengeluaran,
  barisPengeluaran,
  batasNilaiKembali,
  catatanDariAlasan,
  hargaDalamBatas,
  hargaDariAlasan,
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
  /**
   * Harga (sebagian) diambil dari DOKUMEN pengeluaran bahan, karena kartu stok
   * tidak menyimpan nilai pengeluarannya (keputusan pemilik 2026-11-01).
   */
  hargaDariDokumen: boolean;
};

export type HasilKembaliBahan =
  | {
      ok: true;
      ulangan: boolean;
      baris: BarisKembaliTercatat[];
      totalNilai: number;
      /** Nilai diperkecil karena biaya bahan sudah dibebankan ke barang jadi (`batasNilaiKembali`). */
      dibatasi: boolean;
      /** Barang (itemId) yang harganya diambil dari dokumen pengeluaran — untuk pesan berhasil. */
      barangHargaDokumen: string[];
    }
  | {
      ok: false;
      code: KodeTolakKembaliBahan;
      itemId?: string;
      sisa?: number;
      /** `HARGA_KELUAR_TIDAK_DIKETAHUI`: nomor dokumen pengeluaran yang tidak mencantumkan harga. */
      dokumen?: string[];
    };

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
    const dariAlasan = hargaDariAlasan(r.reason);
    const qty = new Decimal(String(r.qtyChange)).abs();
    const harga = dariAlasan.harga ?? new Decimal(0);
    return {
      itemId: r.itemId,
      qty: qty.toNumber(),
      hargaSatuan: harga.toNumber(),
      nilai: qty.mul(harga).toDecimalPlaces(2).toNumber(),
      docNumber: r.docNumber,
      hargaDariDokumen: dariAlasan.dariDokumen,
    };
  });
}

function ringkas(baris: BarisKembaliTercatat[], ulangan: boolean, dibatasi: boolean): HasilKembaliBahan {
  const total = baris.reduce((s, b) => s.plus(b.nilai), new Decimal(0));
  const barangHargaDokumen = [...new Set(baris.filter((b) => b.hargaDariDokumen).map((b) => b.itemId))];
  return { ok: true, ulangan, baris, totalNilai: total.toDecimalPlaces(2).toNumber(), dibatasi, barangHargaDokumen };
}

export type GerakanKeluarBahan = { qty: string; unitCost: string; variantSku: string };

/**
 * Gerakan keluar satu bahan ke WO ini, dari pembaca kartu stok per dokumen
 * (`gerakStokPerDokumen`: buku besar stok dulu, arsip `StockMovement` hanya untuk
 * pengeluaran lama — satu sumber per pengeluaran, tidak pernah dijumlah dua kali).
 * Buku besar tidak menyimpan harga satuan, jadi harganya |totalCost| ÷ |qty|.
 * Pengeluaran yang nilainya tidak tercatat (`null`) tidak ikut: menimbangnya
 * sebagai Rp 0 menurunkan harga bahan yang kembali.
 */
export function gerakanKeluarBahan(gerak: ReadonlyMap<string, GerakDokumen | null>, itemId: string): GerakanKeluarBahan[] {
  return [...gerak.values()].flatMap((dokumen) => gerakanSatuPengeluaran(dokumen, itemId));
}

/** Gerakan keluar satu bahan di SATU pengeluaran; nilai tidak tercatat (`null`) → kosong. */
function gerakanSatuPengeluaran(dokumen: GerakDokumen | null | undefined, itemId: string): GerakanKeluarBahan[] {
  const hasil: GerakanKeluarBahan[] = [];
  if (!dokumen) return hasil;
  for (const g of dokumen.baris) {
    if (g.itemId !== itemId) continue;
    const q = new Decimal(g.qty).abs();
    if (q.isZero()) continue;
    hasil.push({ qty: q.toString(), unitCost: new Decimal(g.totalCost).abs().div(q).toString(), variantSku: g.variantSku });
  }
  return hasil;
}

export type DasarHargaKembali = {
  /** Gerakan keluar di kartu stok, dari pengeluaran yang mencatat nilai bahan ini. */
  kartuStok: GerakanKeluarBahan[];
  /** Harga di dokumen pengeluaran, untuk pengeluaran yang nilainya tidak ada di kartu stok. */
  dokumen: Array<{ qty: string; unitCost: string }>;
  /** Nomor pengeluaran yang nilainya tidak ada di kartu stok DAN dokumennya tanpa harga. */
  tanpaHarga: string[];
};

/**
 * Dasar harga satu bahan yang kembali, PER pengeluaran WO ini (keputusan pemilik
 * 2026-11-01). Kartu stok lebih dulu: pengeluaran yang gerakan bahan ini bernilai di
 * kartu stok dibaca dari sana, persis seperti sebelumnya. Bila tidak — nilainya tidak
 * tercatat (`null`), tidak ada gerakan sama sekali (data di luar layar, data lama), atau
 * gerakannya tanpa baris bahan ini — dipakai harga di DOKUMEN pengeluarannya
 * (`avgCostAtIssue`, harga rata-rata gudang saat keluar), tidak lagi Rp 0. Pengeluaran
 * yang dokumennya pun tanpa harga tidak ikut ditimbang; bila tidak ada satu pun dasar
 * harga, pemanggil menolak pengembaliannya.
 */
export function dasarHargaKembali(
  pengeluaran: ReadonlyArray<{ id: string; docNumber: string; items: unknown }>,
  gerak: ReadonlyMap<string, GerakDokumen | null>,
  itemId: string,
): DasarHargaKembali {
  const kartuStok: GerakanKeluarBahan[] = [];
  const dokumen: Array<{ qty: string; unitCost: string }> = [];
  const tanpaHarga: string[] = [];
  for (const p of pengeluaran) {
    const dariKartu = gerakanSatuPengeluaran(gerak.get(p.id), itemId);
    if (dariKartu.length > 0) {
      kartuStok.push(...dariKartu);
      continue;
    }
    let adaBaris = false;
    let berharga = false;
    for (const b of barisHargaPengeluaran(p.items)) {
      if (b.itemId !== itemId || b.qty.lte(0)) continue;
      adaBaris = true;
      if (b.harga == null) continue;
      berharga = true;
      dokumen.push({ qty: b.qty.toString(), unitCost: b.harga.toString() });
    }
    if (adaBaris && !berharga) tanpaHarga.push(p.docNumber);
  }
  return { kartuStok, dokumen, tanpaHarga };
}

/**
 * Bahan kembali dari CMT ke gudang. Satu transaksi serializable:
 *  1. kunci idempotensi PALING DULU — isian yang sudah tercatat dikembalikan apa adanya;
 *  2. penjaga WO (ada, belum batal) dan sisa per barang dibaca DI DALAM transaksi,
 *     jadi dua pengembalian serentak tidak bisa melewati sisa bersama-sama;
 *  3. per barang: harga keluarnya dari kartu stok, atau dari dokumen pengeluaran
 *     bila kartu stok tidak menyimpan nilainya (`dasarHargaKembali`; tanpa keduanya
 *     ditolak `HARGA_KELUAR_TIDAK_DIKETAHUI`). Stok gudang bertambah pada harga itu
 *     (rata-rata gudang dicampur) lewat `moveMainStock` — entri buku stok merujuk
 *     satu `StockAdjustment` POSITIVE — dan `returnedQty` rencana naik;
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
          issues: { select: { id: true, docNumber: true, items: true, totalCost: true } },
          receipts: { select: { materialCost: true, totalCostValue: true } },
        },
      });
      if (!wo) return { ok: false, code: "WO_TIDAK_DITEMUKAN" };
      if (wo.status === "CANCELLED") return { ok: false, code: "WO_SUDAH_DIBATALKAN" };

      const sisa = await bacaSisaBahanWo(tx, m.woId, wo.issues);
      const periksa = periksaBarisKembali(m.baris, sisa);
      if (!periksa.ok) return periksa;

      // Harga dan varian keluarnya dibaca dari kartu stok pengeluaran WO ini; pengeluaran
      // yang nilainya tidak ada di kartu stok dinilai dengan harga di dokumennya.
      const gerakPengeluaran = await gerakStokPerDokumen(
        tx,
        "MaterialIssue",
        wo.issues.map((i) => i.id),
      );
      // Pengeluaran yang nilainya tidak tercatat (null) tetap tahu variannya di buku besar stok:
      // dipakai memilih baris gudang tujuan bila harganya dari dokumen.
      const idTanpaNilai = wo.issues.filter((i) => gerakPengeluaran.get(i.id) == null).map((i) => i.id);
      const varianTanpaNilai = idTanpaNilai.length
        ? await tx.stockLedgerEntry.findMany({
            where: { refType: "MaterialIssue", refId: { in: idTanpaNilai }, locationType: "MAIN" },
            select: { itemId: true, variantSku: true, qty: true },
          })
        : [];
      const perBaris: Array<{
        itemId: string;
        qty: Decimal;
        /** null = tidak ada dasar harga sama sekali (kartu stok maupun dokumen). */
        harga: Decimal | null;
        gerakan: GerakanKeluarBahan[];
        dariDokumen: boolean;
        tanpaHarga: string[];
      }> = [];
      for (const b of periksa.baris) {
        const dasar = dasarHargaKembali(wo.issues, gerakPengeluaran, b.itemId);
        const semua = [...dasar.kartuStok, ...dasar.dokumen];
        const harga = semua.length > 0 ? hargaKeluar(semua).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
        perBaris.push({
          itemId: b.itemId,
          qty: b.qty,
          harga,
          gerakan: dasar.kartuStok,
          dariDokumen: dasar.dokumen.length > 0,
          tanpaHarga: dasar.tanpaHarga,
        });
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

      // Tanpa dasar harga sama sekali: DITOLAK, tidak diam-diam Rp 0 (keputusan pemilik
      // 2026-11-01) — kecuali batasnya sudah 0: seluruh biaya bahan WO sudah dibebankan ke
      // barang jadi, jadi berapa pun harganya nilai yang kembali tetap Rp 0.
      const tanpaDasar = perBaris.find((b) => b.harga == null);
      if (tanpaDasar && !(batas != null && batas.lte(0))) {
        return { ok: false, code: "HARGA_KELUAR_TIDAK_DIKETAHUI", itemId: tanpaDasar.itemId, dokumen: tanpaDasar.tanpaHarga };
      }
      const dasarBatas = perBaris.map((b) => ({ qty: b.qty, harga: b.harga ?? new Decimal(0) }));
      const nilaiPenuh = dasarBatas.reduce((s, b) => s.plus(b.qty.mul(b.harga)), new Decimal(0));
      const dalamBatas = hargaDalamBatas(dasarBatas, batas);
      const hargaAkhir = dalamBatas.harga;
      // Baris tanpa dasar harga hanya lolos karena batas 0: nilainya ditetapkan batas itu.
      const dibatasi = dalamBatas.dibatasi || tanpaDasar != null;

      const tercatat: BarisKembaliTercatat[] = [];
      for (const [i, pb] of perBaris.entries()) {
        const b = { itemId: pb.itemId, qty: pb.qty };
        const harga = hargaAkhir[i];
        const gerakan = pb.gerakan;
        // Disebut "dari dokumen" hanya bila harga dokumen itu benar-benar menentukan nilai
        // (bukan bila batas sudah menekannya menjadi 0).
        const hargaDariDokumen = pb.dariDokumen && harga.gt(0);

        // Baris gudang tujuan: varian yang paling banyak dikeluarkan ke WO ini (kartu stok
        // bernilai, atau baris buku besar tanpa nilai bila harganya dari dokumen);
        // tanpa varian → baris gabungan null/"" (pencarian toleran keduanya).
        const perVarian = new Map<string, Decimal>();
        for (const g of gerakan) {
          perVarian.set(g.variantSku, (perVarian.get(g.variantSku) ?? new Decimal(0)).plus(g.qty));
        }
        if (perVarian.size === 0) {
          for (const g of varianTanpaNilai) {
            if (g.itemId !== b.itemId) continue;
            const v = g.variantSku ?? "";
            perVarian.set(v, (perVarian.get(v) ?? new Decimal(0)).plus(new Decimal(String(g.qty)).abs()));
          }
        }
        const varian = [...perVarian.entries()].sort((a, z) => z[1].comparedTo(a[1]))[0]?.[0] ?? "";
        // Pencari baku (tie-break sama dengan `moveMainStock`), jadi baris kembar
        // null/"" selalu jatuh ke baris yang sama dengan penulis stok lainnya.
        const baris = await findExistingInventoryValueRow(tx, b.itemId, varian || null);

        const stokSebelum = baris ? new Decimal(String(baris.qtyOnHand)) : new Decimal(0);
        const rataSebelum = baris ? new Decimal(String(baris.avgCost)) : new Decimal(0);
        const stokSesudah = stokSebelum.plus(b.qty);
        const rataSesudah = rataRataSesudahKembali(stokSebelum, rataSebelum, b.qty, harga);
        const nilaiSesudah = stokSesudah.mul(rataSesudah);
        const nilaiKembali = b.qty.mul(harga).toDecimalPlaces(2);

        const docNumber = await generateDocNumber("ADJ", tx);
        // Kolom penyesuaian tidak punya harga satuan maupun sumbernya, jadi riwayat
        // membacanya dari alasan; catatan tidak pernah terpotong (nama CMT yang dipendekkan).
        const alasan = alasanKembaliBahan({
          woDocNumber: wo.docNumber,
          harga: harga.toFixed(2),
          hargaDariDokumen,
          vendor: wo.vendor?.name,
          catatan,
        });
        const penyesuaian = await tx.stockAdjustment.create({
          data: {
            docNumber,
            itemId: b.itemId,
            type: "POSITIVE",
            qtyChange: b.qty.toNumber(),
            reason: alasan,
            prevQty: stokSebelum.toNumber(),
            newQty: stokSesudah.toNumber(),
            prevAvgCost: rataSebelum.toNumber(),
            newAvgCost: rataSesudah.toNumber(),
            createdById: m.userId,
            source: SUMBER_KEMBALI_BAHAN,
            externalRef: m.woId,
            idempotencyKey: kunciBarisKembali(m.woId, m.kunci, b.itemId),
          },
          select: { id: true },
        });
        // Stok gudang bertambah lewat penggerak stok (entri buku stok di transaksi yang sama),
        // rata-rata campuran ikut ditulis di pernyataan yang sama. Baris yang belum ada dibuat
        // penggeraknya, ejaan tanpa varian null.
        await moveMainStock(tx, {
          itemId: b.itemId,
          variantSku: varian,
          qtyDelta: b.qty.toNumber(),
          unitCost: harga.toNumber(),
          avgCost: rataSesudah.toNumber(),
          totalValue: nilaiSesudah.toNumber(),
          totalCost: nilaiKembali.toNumber(),
          balanceValue: nilaiSesudah.toNumber(),
          inventoryValueId: baris?.id,
          createIfMissing: true,
          refType: "StockAdjustment" satisfies StockLedgerRefType,
          refId: penyesuaian.id,
          refDocNumber: docNumber,
          createdById: m.userId,
        });
        tercatat.push({
          itemId: b.itemId,
          qty: b.qty.toNumber(),
          hargaSatuan: harga.toNumber(),
          nilai: nilaiKembali.toNumber(),
          docNumber,
          hargaDariDokumen,
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
            baris: tercatat.map((t) => ({
              itemId: t.itemId,
              qty: t.qty,
              hargaSatuan: t.hargaSatuan,
              docNumber: t.docNumber,
              hargaDariDokumen: t.hargaDariDokumen,
            })),
          },
          metadata: {
            kunciIdempotensi: m.kunci,
            totalNilai: hasil.ok ? hasil.totalNilai : 0,
            woDocNumber: wo.docNumber,
            dibatasi,
            nilaiPenuh: nilaiPenuh.toDecimalPlaces(2).toNumber(),
            batasNilai: batas == null ? null : batas.toNumber(),
            barangHargaDokumen: hasil.ok ? hasil.barangHargaDokumen : [],
            // Barang tanpa dasar harga yang lolos karena batas 0 (nilainya Rp 0 oleh batas).
            barangTanpaHarga: perBaris.filter((b) => b.harga == null).map((b) => b.itemId),
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
  /** Harga diambil dari dokumen pengeluaran (kartu stok tidak menyimpan nilainya). */
  hargaDariDokumen: boolean;
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
    return {
      id: r.id,
      docNumber: r.docNumber,
      itemId: r.itemId,
      qty: ringkasan.qty,
      hargaSatuan: ringkasan.hargaSatuan,
      nilai: ringkasan.nilai,
      hargaDariDokumen: ringkasan.hargaDariDokumen,
      catatan: catatanDariAlasan(r.reason),
      createdAt: r.createdAt,
      oleh: r.createdBy?.name ?? r.createdBy?.email ?? null,
    };
  });
}
