import { prisma, transferKonsiStock, konsiTransferKeyForLine, type KonsiTransferShortLine } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";

/**
 * Koreksi data lama: barang konsinyasi yang DIKIRIM sebelum aturan "toko konsinyasi = gudang
 * lain" tidak pernah keluar dari stok gudang utama, sementara returnya (NRI) sudah menambahkannya
 * kembali — stok gudang membengkak.
 *
 * Yang dikoreksi hanya baris kiriman modul konsinyasi (`ConsignmentShipmentItem`) yang menunjuk
 * barang katalog. Baris yang hanya diketik namanya tidak punya baris gudang — tidak pernah dipotong.
 * "Sudah dipotong" = baris itu sudah punya penyesuaian KONSI_TRANSFER dengan kuncinya
 * (`konsi-kirim-<baris kiriman>`), jadi koreksi dan `kirimTitipan` memakai kunci yang SAMA:
 * menjalankan ulang tidak pernah memotong dua kali.
 *
 * Baris pesanan KONSI salesman yang DISETUJUI hanya DILAPORKAN — tidak pernah dipotong dan
 * cadangannya tidak pernah dilepas di sini. Persetujuan hanya mencadangkan; stoknya pindah lewat
 * alur pengiriman (`issueKonsiTransfer` saat pengiriman selesai, yang memakai cadangan itu sebagian
 * demi sebagian), dan sisa yang tidak jadi dikirim dilepas lewat tutup sisa pesanan. Cadangan
 * RESERVED adalah keadaan "menunggu kirim" yang biasa: memotongnya di sini membuat pengiriman
 * berikutnya ditolak karena cadangannya sudah habis, atau memotong dua kali untuk baris yang
 * sebagian sudah dikirim. Baris yang masih menunggu tampil sebagai MENUNGGU_KIRIM; yang sudah
 * selesai (cadangan CONSUMED, atau dipotong penulis lama berkunci `konsi-transfer-line-<baris>`)
 * sebagai SUDAH_DIPOTONG.
 *
 * Retur tidak dikoreksi: NRI yang sudah menambah stok memang benar menurut aturan baru (barang
 * kembali dari gudang lain). Hanya sisi kirim yang hilang.
 *
 * Dua kasus kiriman yang TIDAK dipotong otomatis, hanya dilaporkan:
 *   - TERTIMPA — sesudah tanggal kirim, angka gudang barang itu sudah ditetapkan ulang secara
 *     mutlak (opname gudang, webhook stok Jubelio, rekonsiliasi Jubelio). Hitungan itu sudah tidak
 *     memuat barang yang ada di toko; memotongnya lagi = memotong dua kali. Penyesuaian stok tidak
 *     menyimpan varian, jadi penilaiannya per BARANG. `sertakanTertimpa` memaksa ikut dipotong.
 *   - VARIAN_TIDAK_PASTI — kiriman lama per barang untuk barang yang stok gudangnya per varian:
 *     tidak ada cara tahu varian mana yang keluar.
 * Saat diterapkan, baris yang stok fisiknya lebih kecil dari jumlah kirim ditolak (stok gudang
 * tidak dibuat negatif) dan dilaporkan sebagai gagal. Potongannya tercatat di buku stok
 * (`transferKonsiStock` → `moveMainStock`).
 *
 * Fungsi ini menyapu seluruh basis data bila cakupan tidak diisi — spesifikasi WAJIB mengisi
 * `orderIds`/`shipmentIds` dengan fixture-nya sendiri.
 */

const SUMBER_HITUNG_ULANG = ["ERP_OPNAME", "JUBELIO_WEBHOOK", "JUBELIO_RECONCILE"] as const;
/*
 * Penyesuaian JUBELIO_RECONCILE dari `backfill-reservations.ts` (docNumber `BACKFILL-…`) MENAMBAH
 * stok (pemulihan cadangan marketplace), bukan menetapkan ulang angka gudang — tidak membuat
 * kiriman konsinyasi sebelumnya "sudah termasuk", jadi tidak dihitung sebagai hitung ulang.
 */
const DOKUMEN_BUKAN_HITUNG_ULANG = "BACKFILL-";
const POTONGAN = 500;

export type SumberKirimKonsi = "PESANAN" | "KIRIMAN";
export type KeadaanBarisKoreksi =
  | "SUDAH_DIPOTONG"
  | "AKAN_DIPOTONG"
  | "TERTIMPA"
  | "VARIAN_TIDAK_PASTI"
  /** Cadangan pesanan sudah dilepas tanpa memotong (tutup sisa pesanan, atau koreksi lama sesudah opname). */
  | "CADANGAN_DILEPAS"
  /** Pesanan yang belum selesai dikirim: stoknya pindah lewat alur pengiriman, tidak lewat koreksi ini. */
  | "MENUNGGU_KIRIM";

export type BarisKoreksiKonsi = {
  sumber: SumberKirimKonsi;
  dokumenId: string;
  dokumen: string;
  barisId: string;
  storeId: string;
  itemId: string;
  variantSku: string;
  qty: number;
  tanggal: Date;
  keadaan: KeadaanBarisKoreksi;
  /** Pesanan yang cadangannya masih RESERVED: sisa yang masih ditahan untuk pengiriman (informasi). */
  cadanganLama: number;
  /** Untuk TERTIMPA: sumber penetapan ulang angka gudang yang TERAKHIR sesudah tanggal kirim. */
  sumberHitungUlang: string | null;
};

export type RingkasanBarangKoreksi = {
  itemId: string;
  sku: string;
  nama: string;
  variantSku: string;
  /** Tanpa baris MENUNGGU_KIRIM: barang itu belum tentu berangkat. */
  terkirim: number;
  sudahDipotong: number;
  /** terkirim − sudah dipotong − cadangan dilepas (sisa yang belum diselesaikan). */
  selisih: number;
  akanDipotong: number;
  tertimpa: number;
  variantTidakPasti: number;
  /** Baris pesanan yang cadangannya sudah dilepas tanpa memotong (tidak masuk selisih). */
  cadanganDilepas: number;
  /** Baris pesanan MENUNGGU_KIRIM (pcs): diurus alur pengiriman, tidak masuk terkirim maupun selisih. */
  menungguKirim: number;
  /**
   * Cadangan RESERVED milik baris TERTIMPA. Selalu 0: hanya kiriman yang bisa TERTIMPA, dan kiriman
   * tidak pernah mencadangkan. Dipertahankan agar bentuk laporan tidak berubah.
   */
  cadanganLamaTertimpa: number;
  /** Sumber penetapan ulang terakhir sesudah kirim, bila ada baris TERTIMPA. */
  sumberHitungUlang: string | null;
  stokGudang: number | null;
  cadanganGudang: number | null;
  avgCost: number | null;
  /** Retur NRI final dari toko KONSI yang sudah menambah stok (informasi). */
  returDariKonsi: number;
};

export type GagalKoreksi = { sumber: SumberKirimKonsi; dokumen: string; kurang: KonsiTransferShortLine[] };

export type LaporanKoreksiStokKonsi = {
  baris: BarisKoreksiKonsi[];
  perBarang: RingkasanBarangKoreksi[];
  /** Retur NRI dari toko konsi atas barang yang tidak pernah tercatat dikirim (informasi saja). */
  returTanpaKiriman: { itemId: string; sku: string; nama: string; variantSku: string; qty: number }[];
  /** `cadanganDilepas` selalu 0: koreksi ini tidak pernah melepas cadangan (lihat `lepasCadanganOpname`). */
  diterapkan: null | { dokumenDipotong: number; barisDipotong: number; cadanganDilepas: number; gagal: GagalKoreksi[] };
};

const kunciBarang = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;
const kunciKiriman = (shipmentItemId: string) => `konsi-kirim-${shipmentItemId}`;

function potong<T>(xs: T[]): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < xs.length; i += POTONGAN) hasil.push(xs.slice(i, i + POTONGAN));
  return hasil;
}

async function kunciYangAda(kunci: string[]): Promise<Set<string>> {
  const ada = new Set<string>();
  for (const k of potong(kunci)) {
    const rows = await prisma.stockAdjustment.findMany({ where: { idempotencyKey: { in: k } }, select: { idempotencyKey: true } });
    for (const r of rows) if (r.idempotencyKey) ada.add(r.idempotencyKey);
  }
  return ada;
}

export async function koreksiStokKonsi(opsi: {
  terapkan: boolean;
  /** Cakupan pesanan KONSI (id FieldSalesOrder). undefined = semua; [] = tidak ada. */
  orderIds?: string[];
  /** Cakupan kiriman modul konsinyasi (id ConsignmentShipment). undefined = semua; [] = tidak ada. */
  shipmentIds?: string[];
  /** Ikut potong baris TERTIMPA (hanya sesudah dipastikan hitung ulangnya belum memuatnya). */
  sertakanTertimpa?: boolean;
  /**
   * DITOLAK bila `true`. Dulu melepas cadangan RESERVED pesanan yang gudangnya sudah diopname
   * sesudah disetujui. Cadangan itu kini milik alur pengiriman — melepasnya di sini membuka stok
   * yang masih harus dikirim, lalu pengirimannya ditolak. Sisa pesanan yang memang tidak akan
   * dikirim ditutup dari halaman pesanan (tutup sisa), yang melepas cadangannya sekaligus mencatat
   * alasannya.
   */
  lepasCadanganOpname?: boolean;
  olehUserId?: string | null;
}): Promise<LaporanKoreksiStokKonsi> {
  if (opsi.lepasCadanganOpname === true) {
    throw new Error(
      "lepasCadanganOpname tidak berlaku lagi: cadangan pesanan konsinyasi milik alur pengiriman. Tutup sisa pesanan dari halaman pesanan.",
    );
  }
  const lingkupPesanan = opsi.orderIds ? { id: { in: opsi.orderIds } } : {};
  const lingkupKiriman = opsi.shipmentIds ? { id: { in: opsi.shipmentIds } } : {};

  const [pesanan, kiriman] = await Promise.all([
    prisma.fieldSalesOrder.findMany({
      where: { ...lingkupPesanan, orderType: "KONSI", status: "APPROVED" },
      select: {
        id: true,
        orderNo: true,
        storeId: true,
        approvedAt: true,
        createdAt: true,
        lines: { select: { id: true, itemId: true, variantSku: true, qty: true } },
      },
    }),
    prisma.consignmentShipment.findMany({
      where: lingkupKiriman,
      select: {
        id: true,
        noKirim: true,
        storeId: true,
        shippedAt: true,
        items: { where: { itemId: { not: null } }, select: { id: true, itemId: true, variantSku: true, qty: true } },
      },
    }),
  ]);

  const idBarisPesanan = pesanan.flatMap((o) => o.lines.map((l) => l.id));
  const idBarisKiriman = kiriman.flatMap((k) => k.items.map((i) => i.id));
  const sudah = await kunciYangAda([...idBarisPesanan.map(konsiTransferKeyForLine), ...idBarisKiriman.map(kunciKiriman)]);

  const cadangan = new Map<string, { state: string; sisa: number }>();
  for (const k of potong(idBarisPesanan)) {
    const rows = await prisma.stockReservation.findMany({
      where: { fieldSalesLineId: { in: k } },
      select: { fieldSalesLineId: true, state: true, qty: true, consumedQty: true },
    });
    for (const r of rows) {
      if (r.fieldSalesLineId) cadangan.set(r.fieldSalesLineId, { state: r.state, sisa: Number(r.qty) - Number(r.consumedQty) });
    }
  }

  const idBarang = [...new Set([...pesanan.flatMap((o) => o.lines.map((l) => l.itemId)), ...kiriman.flatMap((k) => k.items.map((i) => i.itemId as string))])];
  const [stokRows, barangRows, hitungUlang] = await Promise.all([
    prisma.inventoryValue.findMany({
      where: { itemId: { in: idBarang } },
      select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true, avgCost: true },
    }),
    prisma.item.findMany({ where: { id: { in: idBarang } }, select: { id: true, sku: true, nameId: true } }),
    prisma.stockAdjustment.groupBy({
      by: ["itemId", "source"],
      where: {
        itemId: { in: idBarang },
        source: { in: [...SUMBER_HITUNG_ULANG] },
        NOT: { docNumber: { startsWith: DOKUMEN_BUKAN_HITUNG_ULANG } },
      },
      _max: { createdAt: true },
    }),
  ]);
  // Per barang: penetapan ulang TERAKHIR (tanggal + sumbernya).
  const terakhirDihitungUlang = new Map<string, { tanggal: Date; sumber: string }>();
  for (const h of hitungUlang) {
    const t = h._max.createdAt;
    if (!t) continue;
    const lama = terakhirDihitungUlang.get(h.itemId);
    if (!lama || t > lama.tanggal) terakhirDihitungUlang.set(h.itemId, { tanggal: t, sumber: h.source });
  }
  const varianGudang = new Map<string, Set<string>>();
  for (const r of stokRows) {
    const s = varianGudang.get(r.itemId) ?? new Set<string>();
    s.add(r.variantSku ?? "");
    varianGudang.set(r.itemId, s);
  }

  const hitungUlangSesudah = (itemId: string, tanggal: Date) => {
    const t = terakhirDihitungUlang.get(itemId);
    return t && t.tanggal > tanggal ? t.sumber : null;
  };
  const keadaanKiriman = (itemId: string, tanggal: Date): KeadaanBarisKoreksi =>
    hitungUlangSesudah(itemId, tanggal) ? "TERTIMPA" : "AKAN_DIPOTONG";

  const baris: BarisKoreksiKonsi[] = [];
  for (const o of pesanan) {
    const tanggal = o.approvedAt ?? o.createdAt;
    for (const l of o.lines) {
      const c = cadangan.get(l.id);
      const berkunci = sudah.has(konsiTransferKeyForLine(l.id));
      // Selesai: dipotong penulis lama (berkunci), atau cadangannya habis dipakai pengiriman
      // (CONSUMED). RELEASED tanpa kunci = sisa yang dilepas tanpa memotong. Selain itu — cadangan
      // masih RESERVED, atau tidak ada sama sekali — barisnya milik alur pengiriman.
      const keadaan: KeadaanBarisKoreksi =
        berkunci || c?.state === "CONSUMED" ? "SUDAH_DIPOTONG" : c?.state === "RELEASED" ? "CADANGAN_DILEPAS" : "MENUNGGU_KIRIM";
      baris.push({
        sumber: "PESANAN",
        dokumenId: o.id,
        dokumen: o.orderNo,
        barisId: l.id,
        storeId: o.storeId,
        itemId: l.itemId,
        variantSku: l.variantSku ?? "",
        qty: l.qty,
        tanggal,
        keadaan,
        cadanganLama: c && c.state === "RESERVED" ? c.sisa : 0,
        sumberHitungUlang: hitungUlangSesudah(l.itemId, tanggal),
      });
    }
  }
  for (const k of kiriman) {
    for (const i of k.items) {
      const itemId = i.itemId as string;
      let variantSku = i.variantSku?.trim() ?? "";
      let tidakPasti = false;
      if (!variantSku) {
        const v = [...(varianGudang.get(itemId) ?? new Set<string>())];
        if (v.length > 1) tidakPasti = true;
        else variantSku = v[0] ?? "";
      }
      const sudahDipotong = sudah.has(kunciKiriman(i.id));
      baris.push({
        sumber: "KIRIMAN",
        dokumenId: k.id,
        dokumen: k.noKirim,
        barisId: i.id,
        storeId: k.storeId,
        itemId,
        variantSku,
        qty: i.qty,
        tanggal: k.shippedAt,
        keadaan: sudahDipotong ? "SUDAH_DIPOTONG" : tidakPasti ? "VARIAN_TIDAK_PASTI" : keadaanKiriman(itemId, k.shippedAt),
        cadanganLama: 0,
        sumberHitungUlang: hitungUlangSesudah(itemId, k.shippedAt),
      });
    }
  }

  // Retur NRI final (layak jual) dari toko KONSI — informasi: yang sudah menambah gudang. Dengan
  // cakupan, hanya toko milik dokumen dalam cakupan; tanpa cakupan, semua toko KONSI.
  const adaCakupan = opsi.orderIds !== undefined || opsi.shipmentIds !== undefined;
  const tokoCakupan = [...new Set([...pesanan.map((o) => o.storeId), ...kiriman.map((k) => k.storeId)])];
  const retur = await prisma.warehouseReturnItem.findMany({
    where: {
      itemId: { not: null },
      condition: "LAYAK",
      warehouseReturn: {
        status: "FINAL",
        store: { termsType: "KONSI" },
        ...(adaCakupan ? { storeId: { in: tokoCakupan } } : {}),
      },
    },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const returPerKunci = new Map<string, number>();
  for (const r of retur) {
    const k = kunciBarang(r.itemId as string, r.variantSku);
    returPerKunci.set(k, (returPerKunci.get(k) ?? 0) + r.qty);
  }

  const nama = new Map(barangRows.map((b) => [b.id, b]));
  const ringkas = new Map<string, RingkasanBarangKoreksi>();
  for (const b of baris) {
    const k = kunciBarang(b.itemId, b.variantSku);
    let r = ringkas.get(k);
    if (!r) {
      const stok = stokRows.find((s) => s.itemId === b.itemId && (s.variantSku ?? "") === b.variantSku);
      r = {
        itemId: b.itemId,
        sku: nama.get(b.itemId)?.sku ?? "",
        nama: nama.get(b.itemId)?.nameId ?? b.itemId,
        variantSku: b.variantSku,
        terkirim: 0,
        sudahDipotong: 0,
        selisih: 0,
        akanDipotong: 0,
        tertimpa: 0,
        variantTidakPasti: 0,
        cadanganDilepas: 0,
        menungguKirim: 0,
        cadanganLamaTertimpa: 0,
        sumberHitungUlang: null,
        stokGudang: stok ? Number(stok.qtyOnHand) : null,
        cadanganGudang: stok ? Number(stok.reservedQty) : null,
        avgCost: stok ? Number(stok.avgCost) : null,
        returDariKonsi: returPerKunci.get(k) ?? 0,
      };
      ringkas.set(k, r);
    }
    if (b.keadaan === "MENUNGGU_KIRIM") {
      r.menungguKirim += b.qty;
      continue;
    }
    r.terkirim += b.qty;
    if (b.keadaan === "SUDAH_DIPOTONG") r.sudahDipotong += b.qty;
    else if (b.keadaan === "CADANGAN_DILEPAS") r.cadanganDilepas += b.qty;
    else r.selisih += b.qty;
    if (b.keadaan === "AKAN_DIPOTONG") r.akanDipotong += b.qty;
    if (b.keadaan === "TERTIMPA") {
      r.tertimpa += b.qty;
      r.cadanganLamaTertimpa += b.cadanganLama;
      r.sumberHitungUlang = b.sumberHitungUlang;
    }
    if (b.keadaan === "VARIAN_TIDAK_PASTI") r.variantTidakPasti += b.qty;
  }
  const perBarang = [...ringkas.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.variantSku.localeCompare(b.variantSku));

  // Retur dari toko konsi untuk barang yang TIDAK pernah tercatat dikirim lewat sistem: tidak
  // dikoreksi (barangnya mungkin sudah di toko sebelum sistem dipakai), tapi diperlihatkan.
  const tanpaKirimKunci = [...returPerKunci.keys()].filter((k) => !ringkas.has(k));
  const idTanpaKirim = [...new Set(tanpaKirimKunci.map((k) => k.split("::")[0]))];
  const namaTanpaKirim = new Map(
    (idTanpaKirim.length > 0
      ? await prisma.item.findMany({ where: { id: { in: idTanpaKirim } }, select: { id: true, sku: true, nameId: true } })
      : []
    ).map((b) => [b.id, b]),
  );
  const returTanpaKiriman = tanpaKirimKunci
    .map((k) => {
      const [itemId, variantSku] = k.split("::");
      return { itemId, sku: namaTanpaKirim.get(itemId)?.sku ?? "", nama: namaTanpaKirim.get(itemId)?.nameId ?? itemId, variantSku, qty: returPerKunci.get(k) ?? 0 };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.variantSku.localeCompare(b.variantSku));

  if (!opsi.terapkan) return { baris, perBarang, returTanpaKiriman, diterapkan: null };

  // Terapkan: per dokumen, satu transaksi per dokumen — dokumen yang kurang stok batal sendiri.
  // Hanya kiriman: baris pesanan tidak pernah AKAN_DIPOTONG/TERTIMPA, dan penjagaan ini
  // memastikan tetap begitu.
  const dipotong = (b: BarisKoreksiKonsi) =>
    b.sumber === "KIRIMAN" && (b.keadaan === "AKAN_DIPOTONG" || (opsi.sertakanTertimpa === true && b.keadaan === "TERTIMPA"));
  const perDokumen = new Map<string, BarisKoreksiKonsi[]>();
  for (const b of baris.filter(dipotong)) {
    const k = `${b.sumber}:${b.dokumenId}`;
    perDokumen.set(k, [...(perDokumen.get(k) ?? []), b]);
  }

  class Kurang extends Error {
    constructor(readonly kurang: KonsiTransferShortLine[]) {
      super("KURANG");
    }
  }
  let dokumenDipotong = 0;
  let barisDipotong = 0;
  const gagal: GagalKoreksi[] = [];
  for (const daftar of perDokumen.values()) {
    const pertama = daftar[0];
    try {
      const n = await runSerializable(async (tx) => {
        const r = await transferKonsiStock(tx, {
          guard: "ON_HAND",
          lines: daftar.map((b) => ({
            itemId: b.itemId,
            variantSku: b.variantSku,
            qty: b.qty,
            idempotencyKey: kunciKiriman(b.barisId),
            docNumber: `${b.dokumen}-${b.barisId}`,
            reason: `Koreksi data lama: kirim titipan ${b.dokumen} ke toko (stok pindah ke toko)`,
            externalRef: `konsi-kirim:${b.dokumen}`,
            createdById: opsi.olehUserId ?? null,
          })),
        });
        if (r.shortLines.length > 0) throw new Kurang(r.shortLines);
        return r.transferred;
      });
      if (n > 0) dokumenDipotong += 1;
      barisDipotong += n;
    } catch (e) {
      if (e instanceof Kurang) gagal.push({ sumber: pertama.sumber, dokumen: pertama.dokumen, kurang: e.kurang });
      else throw e;
    }
  }

  return { baris, perBarang, returTanpaKiriman, diterapkan: { dokumenDipotong, barisDipotong, cadanganDilepas: 0, gagal } };
}
