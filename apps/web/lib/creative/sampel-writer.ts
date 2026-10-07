import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { generateDocNumber } from "@/lib/docNumber";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { catatJejak, JEJAK, type NamaJejak } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { stokPerluKeluar } from "./aturan";
import { terapkanMajuOtomatis } from "./maju-otomatis";
import {
  BATAS_PENGIRIMAN,
  barisSama,
  kunciVarian,
  normalisasiResi,
  rapikanBarisSampel,
  RESI_TANPA_NOMOR,
  samaResi,
  sudahBerangkat,
  type BarisSampel,
} from "./sampel-aturan";
import { isJalurKeluar, type Tahap } from "./tahap";

/**
 * Penulis pengiriman sampel KOL (`KolShipment` + `KolShipmentLine`).
 *
 * STOK KELUAR TEPAT SEKALI per pengiriman, saat paketnya berangkat — resi DAN
 * tanggal kirim terisi (`stokPerluKeluar`). Sebelum itu pengiriman hanya
 * rencana: barisnya boleh diubah dan tidak ada yang bergerak di gudang.
 * Saat berangkat, di transaksi yang sama:
 *   - setiap baris memotong baris stok per VARIAN (`InventoryValue`, null dan
 *     "" sama-sama "tanpa varian"), ditolak seluruhnya bila stok TERSEDIA
 *     (stok − cadangan) kurang untuk satu baris saja;
 *   - satu `StockAdjustment` NEGATIVE bersumber `KOL_SEEDING` per baris, kunci
 *     idempoten per baris pengiriman — basis data menolak potongan kedua;
 *   - harga pokok rata-rata saat itu disalin ke `KolShipmentLine.unitCost`
 *     (modal sampel di biaya kolaborasi tidak ikut berubah kalau HPP berubah);
 *   - `stockIssuedAt` terisi, lalu tahap kolaborasi dimajukan dari faktanya
 *     (`terapkanMajuOtomatis`).
 * Push stok Jubelio diantrekan SESUDAH commit.
 *
 * Paling banyak SATU pengiriman belum berangkat per kolaborasi: mengisi resi
 * tanpa menyebut pengirimannya memakai yang belum berangkat itu, tidak membuat
 * baris baru (bug KOL Manager: resi di antrean Seeding selalu membuat
 * pengiriman baru, jadi rencana dari detail tertinggal sebagai baris ganda).
 *
 * Membatalkan kolaborasi TIDAK mengembalikan stok yang sudah berangkat
 * (`stokKembaliSaatBatal`); pengiriman yang sudah berangkat juga tidak bisa
 * dihapus atau diganti barangnya — barangnya sudah di tangan kurir.
 */

type Klien = Prisma.TransactionClient;

export type KodeGagalSampel =
  | "KOLABORASI_TIDAK_DITEMUKAN"
  | "PENGIRIMAN_TIDAK_DITEMUKAN"
  /** Kolaborasi di jalur keluar (ditolak/ghosting/batal) tidak dikirimi sampel baru. */
  | "KOLABORASI_TUTUP"
  | "TANPA_BARIS"
  | "QTY_TIDAK_VALID"
  | "TERLALU_BANYAK_BARIS"
  | "TERLALU_PANJANG"
  | "ONGKIR_TIDAK_VALID"
  | "BARANG_TIDAK_DITEMUKAN"
  /** Barang punya lebih dari satu varian stok: ukurannya harus dipilih. */
  | "VARIAN_WAJIB"
  | "VARIAN_TIDAK_DIKENAL"
  | "STOK_KURANG"
  /** Barang di pengiriman yang sudah berangkat tidak bisa diubah atau dihapus. */
  | "SUDAH_BERANGKAT"
  /** Tanggal kirim tanpa resi, atau resi pengiriman yang sudah berangkat dikosongkan. */
  | "RESI_WAJIB"
  | "TANGGAL_KIRIM_WAJIB"
  /** Tanggal terima untuk paket yang belum berangkat. */
  | "BELUM_BERANGKAT"
  | "TANGGAL_DI_DEPAN"
  | "TERIMA_SEBELUM_KIRIM";

export type KurangStokSampel = {
  itemId: string;
  itemName: string;
  /** "" = tanpa varian. */
  variantSku: string;
  variantLabel: string | null;
  diminta: number;
  tersedia: number;
};

export type PindahTahap = { dari: Tahap; ke: Tahap } | null;

export type HasilSimpanPengiriman =
  | {
      ok: true;
      id: string;
      /** Baris pengiriman baru dibuat (bukan mengubah yang sudah ada). */
      dibuat: boolean;
      /** Paketnya berangkat di panggilan ini — stok keluar sekarang. */
      berangkat: boolean;
      /** Tanggal terima baru terisi di panggilan ini. */
      diterima: boolean;
      /** Kiriman ulang yang sudah tercatat: tidak ada yang berubah. */
      ulang: boolean;
      tahap: PindahTahap;
    }
  | { ok: false; kode: Exclude<KodeGagalSampel, "STOK_KURANG">; detail?: string }
  | { ok: false; kode: "STOK_KURANG"; kurang: KurangStokSampel[] };

export type IsiPengiriman = {
  /** Ubah pengiriman ini. Kosong = pakai yang belum berangkat, atau buat baru. */
  id?: string | null;
  kolaborasiId: string;
  /** `undefined` = biarkan; `null`/"" = kosongkan. Berlaku untuk semua isian di bawah. */
  courier?: string | null;
  trackingNo?: string | null;
  /** Berangkat tanpa nomor resi (diantar sendiri, kurir toko) — disimpan sebagai `RESI_TANPA_NOMOR`. */
  tanpaResi?: boolean;
  /** Kosong padahal resi terisi = hari ini. */
  sentAt?: Date | null;
  receivedAt?: Date | null;
  shippingCost?: number | null;
  note?: string | null;
  /** `undefined` = barang lama; pengiriman baru mengambil rencana sampel kolaborasinya. */
  baris?: { itemId: string; variantSku: string | null; qty: number }[];
  /** Kunci formulir, dibuat sekali per isian: kiriman ulang sesudah jawaban hilang tidak dicatat dua kali. */
  kunci?: string | null;
  olehUserId: string;
};

/** Stok barang/varian kurang di tengah pemotongan — membatalkan seluruh transaksi. */
class StokSampelKurang extends Error {
  constructor(readonly kurang: KurangStokSampel[]) {
    super("STOK_KURANG");
  }
}

const hari = (d: Date) => formatDateOnlyJakarta(d);
const D = (n: number) => new Prisma.Decimal(n);

const PILIH_PENGIRIMAN = {
  id: true,
  collabId: true,
  courier: true,
  trackingNo: true,
  sentAt: true,
  receivedAt: true,
  shippingCost: true,
  stockIssuedAt: true,
  note: true,
  lines: { select: { id: true, itemId: true, itemName: true, variantSku: true, qty: true } },
} as const;

type PengirimanLama = Prisma.KolShipmentGetPayload<{ select: typeof PILIH_PENGIRIMAN }>;

const AKSI_SIMPAN: readonly NamaJejak[] = [JEJAK.SAMPEL_DIBUAT, JEJAK.SAMPEL_DIUBAH, JEJAK.SAMPEL_DIKIRIM, JEJAK.SAMPEL_DITERIMA];

/** Pengiriman yang sudah dicatat dengan kunci formulir ini (dicocokkan di JS — tanpa kolom baru). */
async function pengirimanDenganKunci(tx: Klien, kolaborasiId: string, kunci: string): Promise<string | null> {
  const baris = await tx.auditLog.findMany({
    where: { entityType: "KolBrief", entityId: kolaborasiId, action: { in: [...AKSI_SIMPAN] } },
    select: { metadata: true },
  });
  for (const b of baris) {
    const m = b.metadata as Record<string, unknown> | null;
    if (m && m.kunci === kunci && typeof m.pengirimanId === "string") return m.pengirimanId;
  }
  return null;
}

type BarisStok = { id: string; itemId: string; variantSku: string | null; qtyOnHand: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal };

const tersediaDari = (s: BarisStok | undefined) => (s ? s.qtyOnHand.toNumber() - s.reservedQty.toNumber() : 0);

/** Baris stok untuk satu kunci varian; "" mencari baris null ATAU "" (data lama memakai keduanya). */
function barisStokUntuk(stok: readonly BarisStok[], itemId: string, sku: string): BarisStok | undefined {
  const cocok = stok.filter((s) => s.itemId === itemId && (s.variantSku ?? "") === sku);
  // Kembar null + "": pakai yang null dulu (bentuk produksi), urutan tetap.
  return cocok.sort((a, b) => Number(a.variantSku !== null) - Number(b.variantSku !== null))[0];
}

type InfoBarang = { nama: string; opsi: { sku: string; label: string }[] };

function labelVarianDari(info: InfoBarang | undefined, sku: string): string | null {
  if (!sku) return null;
  return info?.opsi.find((o) => o.sku === sku)?.label ?? sku;
}

function periksaTeks(nilai: string | null | undefined, batas: number): boolean {
  return nilai === undefined || nilai === null || nilai.trim().length <= batas;
}

export async function simpanPengiriman(input: IsiPengiriman): Promise<HasilSimpanPengiriman> {
  if (
    !periksaTeks(input.courier, BATAS_PENGIRIMAN.kurir) ||
    !periksaTeks(input.trackingNo, BATAS_PENGIRIMAN.resi) ||
    !periksaTeks(input.note, BATAS_PENGIRIMAN.catatan)
  ) {
    return { ok: false, kode: "TERLALU_PANJANG" };
  }
  if (
    input.shippingCost !== undefined &&
    input.shippingCost !== null &&
    !(Number.isFinite(input.shippingCost) && input.shippingCost >= 0 && input.shippingCost <= BATAS_PENGIRIMAN.ongkir)
  ) {
    return { ok: false, kode: "ONGKIR_TIDAK_VALID" };
  }
  let barisMasuk: BarisSampel[] | undefined;
  if (input.baris !== undefined) {
    const r = rapikanBarisSampel(input.baris);
    if (!r.ok) return { ok: false, kode: r.kode };
    barisMasuk = r.baris;
  }
  const kunci = input.kunci?.trim() || null;
  const hariIni = hariIniWib();

  // Barang yang stok gudangnya bergerak di percobaan yang COMMIT (diulang dari nol tiap percobaan).
  let barangKeluar: string[] = [];
  let nomorKolaborasi = "";

  try {
    const hasil = await runSerializable(async (tx): Promise<HasilSimpanPengiriman> => {
      barangKeluar = [];
      const sekarang = new Date();

      const c = await tx.kolBrief.findUnique({
        where: { id: input.kolaborasiId },
        select: {
          id: true,
          docNo: true,
          tahap: true,
          kol: { select: { name: true } },
          items: { select: { itemId: true, variantSku: true, qty: true } },
        },
      });
      if (!c) return { ok: false, kode: "KOLABORASI_TIDAK_DITEMUKAN" };
      nomorKolaborasi = c.docNo;
      const ulang = (id: string): HasilSimpanPengiriman => ({
        ok: true,
        id,
        dibuat: false,
        berangkat: false,
        diterima: false,
        ulang: true,
        tahap: null,
      });

      // Kunci formulir PALING DULU: kiriman pertama mungkin sudah memberangkatkan paketnya,
      // dan memeriksa ulang isiannya akan menolak dengan alasan palsu atau membuat paket kedua.
      if (kunci) {
        const lama = await pengirimanDenganKunci(tx, c.id, kunci);
        if (lama) return ulang(lama);
      }

      const resiMasuk = input.tanpaResi ? RESI_TANPA_NOMOR : input.trackingNo === undefined ? undefined : normalisasiResi(input.trackingNo);

      let p: PengirimanLama | null = null;
      if (input.id) {
        p = await tx.kolShipment.findFirst({ where: { id: input.id, collabId: c.id }, select: PILIH_PENGIRIMAN });
        if (!p) return { ok: false, kode: "PENGIRIMAN_TIDAK_DITEMUKAN" };
      } else {
        p = await tx.kolShipment.findFirst({
          where: { collabId: c.id, stockIssuedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: PILIH_PENGIRIMAN,
        });
        if (!p && resiMasuk) {
          // Resi yang sama untuk kolaborasi yang sama = paket yang sama, dicatat dua kali.
          const berangkat = await tx.kolShipment.findMany({
            where: { collabId: c.id, stockIssuedAt: { not: null } },
            select: { id: true, trackingNo: true },
          });
          const kembar = berangkat.find((x) => samaResi(x.trackingNo, resiMasuk));
          if (kembar) return ulang(kembar.id);
        }
      }

      const dibuat = p === null;
      const sudahKeluar = p !== null && sudahBerangkat(p);
      const tahap = c.tahap as Tahap;

      /* ── isian akhir ── */
      const resiAkhir = resiMasuk === undefined ? (p?.trackingNo ?? null) : resiMasuk;
      if (sudahKeluar && !resiAkhir) return { ok: false, kode: "RESI_WAJIB" };
      let kirimAkhir = input.sentAt === undefined ? (p?.sentAt ?? null) : input.sentAt;
      if (sudahKeluar && !kirimAkhir) return { ok: false, kode: "TANGGAL_KIRIM_WAJIB" };
      if (kirimAkhir && !resiAkhir) return { ok: false, kode: "RESI_WAJIB" };
      if (resiAkhir && !kirimAkhir) kirimAkhir = sekarang;
      const terimaAkhir = input.receivedAt === undefined ? (p?.receivedAt ?? null) : input.receivedAt;
      const akanBerangkat = !sudahKeluar && stokPerluKeluar({ sentAt: kirimAkhir, trackingNo: resiAkhir, stockIssuedAt: null });

      if (kirimAkhir && hari(kirimAkhir) > hariIni) return { ok: false, kode: "TANGGAL_DI_DEPAN" };
      if (terimaAkhir) {
        if (!sudahKeluar && !akanBerangkat) return { ok: false, kode: "BELUM_BERANGKAT" };
        if (hari(terimaAkhir) > hariIni) return { ok: false, kode: "TANGGAL_DI_DEPAN" };
        if (kirimAkhir && hari(terimaAkhir) < hari(kirimAkhir)) return { ok: false, kode: "TERIMA_SEBELUM_KIRIM" };
      }
      if ((dibuat || akanBerangkat) && isJalurKeluar(tahap)) return { ok: false, kode: "KOLABORASI_TUTUP", detail: tahap };

      /* ── baris barang ── */
      const barisLama: BarisSampel[] = (p?.lines ?? []).map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty }));
      let barisAkhir: BarisSampel[];
      if (barisMasuk !== undefined) {
        if (sudahKeluar && !barisSama(barisMasuk, barisLama)) return { ok: false, kode: "SUDAH_BERANGKAT" };
        barisAkhir = sudahKeluar ? barisLama : barisMasuk;
      } else if (p) {
        barisAkhir = barisLama;
      } else {
        const rencana = rapikanBarisSampel(c.items);
        if (!rencana.ok) return { ok: false, kode: rencana.kode };
        barisAkhir = rencana.baris;
      }
      if (barisAkhir.length === 0) return { ok: false, kode: "TANPA_BARIS" };
      const barisBerubah = !sudahKeluar && (dibuat || !barisSama(barisAkhir, barisLama));

      const infoBarang = new Map<string, InfoBarang>();
      let stok: BarisStok[] = [];
      if (barisBerubah || akanBerangkat) {
        const idBarang = [...new Set(barisAkhir.map((b) => b.itemId))];
        // Berurutan, bukan Promise.all: satu klien transaksi menjalankan satu kueri sekali jalan.
        const barang = await tx.item.findMany({ where: { id: { in: idBarang } }, select: { id: true, nameId: true, variants: true } });
        const barisStok = await tx.inventoryValue.findMany({
          where: { itemId: { in: idBarang } },
          select: { id: true, itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, avgCost: true },
        });
        if (barang.length !== idBarang.length) return { ok: false, kode: "BARANG_TIDAK_DITEMUKAN" };
        for (const b of barang) infoBarang.set(b.id, { nama: b.nameId, opsi: variantSelectOptions(parseItemVariants(b.variants)) });
        stok = barisStok;

        for (const b of barisAkhir) {
          const sku = b.variantSku?.trim() ?? "";
          if (!sku) continue;
          const dikenal =
            infoBarang.get(b.itemId)!.opsi.some((o) => o.sku === sku) || stok.some((s) => s.itemId === b.itemId && s.variantSku === sku);
          if (!dikenal) return { ok: false, kode: "VARIAN_TIDAK_DIKENAL", detail: infoBarang.get(b.itemId)!.nama };
        }
      }

      // Saat berangkat setiap baris harus menunjuk SATU baris stok: varian yang kosong diisi
      // bila barangnya hanya punya satu kunci stok, selain itu ukurannya wajib dipilih.
      if (akanBerangkat) {
        const terurai: BarisSampel[] = [];
        for (const b of barisAkhir) {
          const sku = b.variantSku?.trim() ?? "";
          if (sku) {
            terurai.push({ ...b, variantSku: sku });
            continue;
          }
          const kunciStok = [...new Set(stok.filter((s) => s.itemId === b.itemId).map((s) => s.variantSku ?? ""))];
          const info = infoBarang.get(b.itemId)!;
          if (kunciStok.length > 1 || (kunciStok.length === 0 && info.opsi.length > 0)) {
            return { ok: false, kode: "VARIAN_WAJIB", detail: info.nama };
          }
          terurai.push({ ...b, variantSku: kunciStok[0] || null });
        }
        const rapi = rapikanBarisSampel(terurai);
        if (!rapi.ok) return { ok: false, kode: rapi.kode };
        barisAkhir = rapi.baris;

        const kurang: KurangStokSampel[] = [];
        for (const b of barisAkhir) {
          const sku = b.variantSku ?? "";
          const tersedia = tersediaDari(barisStokUntuk(stok, b.itemId, sku));
          if (tersedia < b.qty) {
            const info = infoBarang.get(b.itemId);
            kurang.push({
              itemId: b.itemId,
              itemName: info?.nama ?? b.itemId,
              variantSku: sku,
              variantLabel: labelVarianDari(info, sku),
              diminta: b.qty,
              tersedia,
            });
          }
        }
        if (kurang.length > 0) return { ok: false, kode: "STOK_KURANG", kurang };
      }

      /* ── tulis ── */
      const kurir = input.courier === undefined ? (p?.courier ?? null) : input.courier?.trim() || null;
      const ongkir = input.shippingCost === undefined ? Number(p?.shippingCost ?? 0) : input.shippingCost ?? 0;
      const catatan = input.note === undefined ? (p?.note ?? null) : input.note?.trim() || null;
      const namaBaris = (b: BarisSampel) => infoBarang.get(b.itemId)?.nama ?? p?.lines.find((l) => l.itemId === b.itemId)?.itemName ?? "";
      const dataBaris = (b: BarisSampel) => ({ itemId: b.itemId, itemName: namaBaris(b), variantSku: b.variantSku?.trim() || null, qty: b.qty });

      const isi = {
        courier: kurir,
        trackingNo: resiAkhir,
        sentAt: kirimAkhir,
        receivedAt: terimaAkhir,
        shippingCost: D(ongkir),
        note: catatan,
      };

      let pengirimanId: string;
      if (dibuat) {
        const baru = await tx.kolShipment.create({
          data: { collabId: c.id, ...isi, createdById: input.olehUserId, lines: { create: barisAkhir.map(dataBaris) } },
          select: { id: true },
        });
        pengirimanId = baru.id;
      } else {
        pengirimanId = p!.id;
        await tx.kolShipment.update({ where: { id: pengirimanId }, data: isi });
        if (barisBerubah || akanBerangkat) {
          await tx.kolShipmentLine.deleteMany({ where: { shipmentId: pengirimanId } });
          await tx.kolShipmentLine.createMany({ data: barisAkhir.map((b) => ({ shipmentId: pengirimanId, ...dataBaris(b) })) });
        }
      }

      const metaJejak = { pengirimanId, docNo: c.docNo, kol: c.kol.name, ...(kunci ? { kunci } : {}) };
      const potret = (x: { courier: string | null; trackingNo: string | null; sentAt: Date | null; receivedAt: Date | null; ongkir: number; note: string | null }) => ({
        courier: x.courier,
        trackingNo: x.trackingNo,
        sentAt: x.sentAt ? hari(x.sentAt) : null,
        receivedAt: x.receivedAt ? hari(x.receivedAt) : null,
        shippingCost: x.ongkir,
        note: x.note,
      });

      /* ── berangkat: stok keluar ── */
      let nilaiHpp = 0;
      const rincianKeluar: { itemId: string; variantSku: string | null; qty: number; unitCost: number }[] = [];
      if (akanBerangkat) {
        const tanda = await tx.kolShipment.updateMany({
          where: { id: pengirimanId, stockIssuedAt: null },
          data: { stockIssuedAt: sekarang },
        });
        if (tanda.count !== 1) throw new Error(`Pengiriman sampel ${pengirimanId} berubah di tengah penyimpanan`);

        const barisPengiriman = await tx.kolShipmentLine.findMany({
          where: { shipmentId: pengirimanId },
          select: { id: true, itemId: true, itemName: true, variantSku: true, qty: true },
        });
        // Urutan tetap (kunci stok) supaya dua pengiriman yang berpacu mengunci baris stok dengan urutan sama.
        barisPengiriman.sort((a, b) => kunciVarian(a.itemId, a.variantSku).localeCompare(kunciVarian(b.itemId, b.variantSku)));
        for (const l of barisPengiriman) {
          const sku = l.variantSku ?? "";
          const baris = barisStokUntuk(stok, l.itemId, sku)!;
          const harga = baris.avgCost.toNumber();
          const sesudah = await tx.inventoryValue.update({
            where: { id: baris.id },
            data: { qtyOnHand: { decrement: l.qty }, totalValue: { decrement: l.qty * harga }, lastUpdated: sekarang },
            select: { qtyOnHand: true, reservedQty: true },
          });
          const qtyBaru = sesudah.qtyOnHand.toNumber();
          // Penjaga sebenarnya: penulis lain bisa mengambil stok di antara bacaan di atas dan potongan ini.
          if (qtyBaru - sesudah.reservedQty.toNumber() < 0) {
            const info = infoBarang.get(l.itemId);
            throw new StokSampelKurang([
              {
                itemId: l.itemId,
                itemName: info?.nama ?? l.itemName,
                variantSku: sku,
                variantLabel: labelVarianDari(info, sku),
                diminta: l.qty,
                tersedia: qtyBaru + l.qty - sesudah.reservedQty.toNumber(),
              },
            ]);
          }
          const varian = labelVarianDari(infoBarang.get(l.itemId), sku);
          await tx.stockAdjustment.create({
            data: {
              docNumber: await generateDocNumber("ADJ", tx),
              itemId: l.itemId,
              type: "NEGATIVE",
              qtyChange: -l.qty,
              reason: `Sampel KOL ${c.docNo} — ${c.kol.name} — ${l.itemName}${varian ? ` — ${varian}` : ""}`,
              prevQty: qtyBaru + l.qty,
              newQty: qtyBaru,
              prevAvgCost: harga,
              newAvgCost: harga,
              createdById: input.olehUserId,
              source: "KOL_SEEDING",
              idempotencyKey: `kol-sampel:${l.id}`,
              externalRef: `kol-sampel:${c.docNo}`,
            },
          });
          await tx.kolShipmentLine.update({ where: { id: l.id }, data: { unitCost: D(harga) } });
          nilaiHpp += l.qty * harga;
          rincianKeluar.push({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty, unitCost: harga });
          barangKeluar.push(l.itemId);
        }
      }

      /* ── jejak ── */
      const sebelum = p
        ? potret({ courier: p.courier, trackingNo: p.trackingNo, sentAt: p.sentAt, receivedAt: p.receivedAt, ongkir: Number(p.shippingCost), note: p.note })
        : null;
      const sesudahIsi = potret({ courier: kurir, trackingNo: resiAkhir, sentAt: kirimAkhir, receivedAt: terimaAkhir, ongkir, note: catatan });
      const diterima = terimaAkhir !== null && (p?.receivedAt ?? null) === null;

      if (dibuat) {
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.SAMPEL_DIBUAT,
          entityType: "KolBrief",
          entityId: c.id,
          changes: { after: { ...sesudahIsi, baris: barisAkhir } },
          metadata: metaJejak,
        });
      } else {
        // Yang dicatat di baris "dikirim"/"diterima" tidak diulang di baris "diubah".
        const lewati = new Set<string>([
          ...(akanBerangkat ? ["courier", "trackingNo", "sentAt"] : []),
          ...(diterima ? ["receivedAt"] : []),
        ]);
        const berubahSebelum: Record<string, unknown> = {};
        const berubahSesudah: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(sesudahIsi)) {
          if (lewati.has(k)) continue;
          const lama = (sebelum as Record<string, unknown>)[k];
          if (lama !== v) {
            berubahSebelum[k] = lama;
            berubahSesudah[k] = v;
          }
        }
        if (barisBerubah) {
          berubahSebelum.baris = barisLama;
          berubahSesudah.baris = barisAkhir;
        }
        if (Object.keys(berubahSesudah).length > 0) {
          await catatJejak(tx, {
            userId: input.olehUserId,
            action: JEJAK.SAMPEL_DIUBAH,
            entityType: "KolBrief",
            entityId: c.id,
            changes: { before: berubahSebelum, after: berubahSesudah },
            metadata: metaJejak,
          });
        }
      }
      if (akanBerangkat) {
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.SAMPEL_DIKIRIM,
          entityType: "KolBrief",
          entityId: c.id,
          changes: {
            before: { trackingNo: p?.trackingNo ?? null, sentAt: p?.sentAt ? hari(p.sentAt) : null },
            after: { courier: kurir, trackingNo: resiAkhir, sentAt: hari(kirimAkhir!), baris: rincianKeluar, nilaiHpp },
          },
          metadata: metaJejak,
        });
      }
      if (diterima) {
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.SAMPEL_DITERIMA,
          entityType: "KolBrief",
          entityId: c.id,
          changes: { before: { receivedAt: null }, after: { receivedAt: hari(terimaAkhir!) } },
          metadata: metaJejak,
        });
      }

      const pindah =
        akanBerangkat || diterima
          ? await terapkanMajuOtomatis(tx, {
              kolaborasiId: c.id,
              olehUserId: input.olehUserId,
              sebab: diterima ? "tanggal terima sampel diisi" : "resi sampel diisi",
            })
          : null;

      return { ok: true, id: pengirimanId, dibuat, berangkat: akanBerangkat, diterima, ulang: false, tahap: pindah };
    });

    // Sesudah commit: stok gudang berkurang — Jubelio harus tahu. Kegagalan antrean tidak
    // membatalkan pengiriman yang sudah sah (penolongnya tidak pernah melempar).
    if (hasil.ok && barangKeluar.length > 0) {
      await antrekanPushStok(barangKeluar, { sumber: "KOL_SAMPEL", ref: `sampel KOL ${nomorKolaborasi}`, userId: input.olehUserId });
    }
    return hasil;
  } catch (e) {
    if (e instanceof StokSampelKurang) return { ok: false, kode: "STOK_KURANG", kurang: e.kurang };
    throw e;
  }
}

export type HasilTerima =
  | { ok: true; ulang: boolean; tahap: PindahTahap }
  | { ok: false; kode: "PENGIRIMAN_TIDAK_DITEMUKAN" | "BELUM_BERANGKAT" | "TANGGAL_DI_DEPAN" | "TERIMA_SEBELUM_KIRIM" };

/**
 * Tandai paket sampai. Hanya untuk paket yang sudah berangkat — paket yang
 * belum memotong stok tidak mungkin sudah di tangan KOL. Mengubah tanggal
 * yang sudah terisi dicatat sebagai koreksi.
 */
export async function tandaiDiterima(input: { pengirimanId: string; receivedAt: Date; olehUserId: string }): Promise<HasilTerima> {
  const hariIni = hariIniWib();
  return runSerializable(async (tx): Promise<HasilTerima> => {
    const p = await tx.kolShipment.findUnique({
      where: { id: input.pengirimanId },
      select: {
        id: true,
        collabId: true,
        sentAt: true,
        trackingNo: true,
        stockIssuedAt: true,
        receivedAt: true,
        collab: { select: { docNo: true, kol: { select: { name: true } } } },
      },
    });
    if (!p) return { ok: false, kode: "PENGIRIMAN_TIDAK_DITEMUKAN" };
    if (!sudahBerangkat(p)) return { ok: false, kode: "BELUM_BERANGKAT" };
    const tanggal = hari(input.receivedAt);
    if (tanggal > hariIni) return { ok: false, kode: "TANGGAL_DI_DEPAN" };
    if (p.sentAt && tanggal < hari(p.sentAt)) return { ok: false, kode: "TERIMA_SEBELUM_KIRIM" };
    if (p.receivedAt && hari(p.receivedAt) === tanggal) return { ok: true, ulang: true, tahap: null };

    await tx.kolShipment.update({ where: { id: p.id }, data: { receivedAt: input.receivedAt } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: p.receivedAt ? JEJAK.SAMPEL_DIUBAH : JEJAK.SAMPEL_DITERIMA,
      entityType: "KolBrief",
      entityId: p.collabId,
      changes: { before: { receivedAt: p.receivedAt ? hari(p.receivedAt) : null }, after: { receivedAt: tanggal } },
      metadata: { pengirimanId: p.id, docNo: p.collab.docNo, kol: p.collab.kol.name },
    });
    const tahap = await terapkanMajuOtomatis(tx, {
      kolaborasiId: p.collabId,
      olehUserId: input.olehUserId,
      sebab: "tanggal terima sampel diisi",
    });
    return { ok: true, ulang: false, tahap };
  });
}

/**
 * Hapus rencana pengiriman yang BELUM berangkat (tidak ada stok yang
 * bergerak). Yang sudah berangkat tidak pernah dihapus: barangnya sudah keluar
 * dari gudang, dan pengirimannya adalah satu-satunya catatan ke mana.
 */
export async function hapusPengiriman(input: {
  pengirimanId: string;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; kode: "PENGIRIMAN_TIDAK_DITEMUKAN" | "SUDAH_BERANGKAT" }> {
  return runSerializable(async (tx) => {
    const p = await tx.kolShipment.findUnique({
      where: { id: input.pengirimanId },
      select: { ...PILIH_PENGIRIMAN, collab: { select: { docNo: true, kol: { select: { name: true } } } } },
    });
    if (!p) return { ok: false as const, kode: "PENGIRIMAN_TIDAK_DITEMUKAN" as const };
    if (sudahBerangkat(p)) return { ok: false as const, kode: "SUDAH_BERANGKAT" as const };
    await tx.kolShipment.delete({ where: { id: p.id } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.SAMPEL_DIUBAH,
      entityType: "KolBrief",
      entityId: p.collabId,
      changes: {
        before: {
          courier: p.courier,
          shippingCost: Number(p.shippingCost),
          note: p.note,
          baris: p.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
        },
        after: null,
      },
      metadata: { pengirimanId: p.id, docNo: p.collab.docNo, kol: p.collab.kol.name, dihapus: true },
    });
    return { ok: true as const };
  });
}
