import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bacaTokoTerkunci, KUNCI_TOKO_TERKUNCI } from "./pengaturan";
import {
  bolehBuatRekomendasi,
  catatanSetujuToko,
  ENTITAS_REKOMENDASI,
  JEJAK_REKOMENDASI,
  KUNCI_MAKS_REKOMENDASI,
  namaBarisRekomendasi,
  opsiVarianBarang,
  rapikanBarisRekomendasi,
  rapikanTeksRekomendasi,
  SUMBER_SETUJU_TOKO,
  type KodeTolakBaris,
  type StatusRekomendasi,
  type SumberSetujuToko,
} from "./rekomendasi-aturan";

/**
 * Penulis rekomendasi barang salesman → toko. Aturannya di
 * `rekomendasi-aturan.ts`.
 *
 * Setiap perubahan keadaan adalah bandingkan-lalu-tukar (`updateMany where
 * status …` + cek jumlah) DI DALAM `runSerializable` — Prisma 7 `updateMany`
 * bukan compare-and-swap, dan di luar transaksi serializable dua orang yang
 * menekan bersamaan (SPG menerima, salesman membatalkan) bisa sama-sama
 * "berhasil". Jejak `AuditLog` ditulis di transaksi yang sama. Kabar dikirim
 * SESUDAH transaksi dan tidak pernah membatalkannya.
 *
 * SELESAI tidak ditulis di sini: katalog yang menandainya begitu pesanan dari
 * rekomendasi ini tercatat (`tautkanSumberPesanan`).
 */

type Klien = Prisma.TransactionClient;

export type KodeTolakBuat =
  | "KUNCI_WAJIB"
  | "KUNCI_DIPAKAI"
  | "TOKO_TIDAK_DITEMUKAN"
  | "BUKAN_PEMEGANG"
  | "BARANG_TIDAK_DIKENAL"
  | "BARANG_TIDAK_AKTIF"
  | "VARIAN_TIDAK_DIKENAL"
  | "TEKS_TERLALU_PANJANG"
  | KodeTolakBaris;

export type HasilBuatRekomendasi = { ok: true; id: string; ulang: boolean } | { ok: false; kode: KodeTolakBuat };

export type KodeTolakTransisi =
  | "TIDAK_DITEMUKAN"
  | "BUKAN_TOKO_ANDA"
  | "BUKAN_PEMBUAT"
  | "SUDAH_BERUBAH"
  | "TOKO_PUNYA_SPG"
  | "SUMBER_TIDAK_VALID"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG";

export type HasilTransisiRekomendasi =
  | { ok: true; ulang: boolean; status: StatusRekomendasi }
  | { ok: false; kode: KodeTolakTransisi; status?: StatusRekomendasi };

// ─── Membuat ─────────────────────────────────────────────────────────────────

type DataKabarBaru = { id: string; storeId: string; namaToko: string; baris: number; pcs: number };

/**
 * Salesman mengirim rekomendasi ke sebuah toko. Kunci kiriman diperiksa PALING
 * DULU: kiriman ulang (dua ketukan, jaringan putus setelah tersimpan)
 * mengembalikan rekomendasi yang sudah ada apa adanya.
 *
 * Yang dipercaya dari HP hanya barang, ukuran, jumlah, dan alasannya. Nama
 * barang dan label ukurannya disusun di sini; ukuran harus salah satu varian
 * barang itu (barang bervarian tidak boleh berbaris tanpa ukuran — katalog
 * tidak akan bisa mengisinya).
 */
export async function buatRekomendasi(input: {
  salesmanId: string;
  storeId: string;
  baris: unknown;
  catatan?: unknown;
  idempotencyKey: unknown;
}): Promise<HasilBuatRekomendasi> {
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > KUNCI_MAKS_REKOMENDASI) return { ok: false, kode: "KUNCI_WAJIB" };

  let kabar: DataKabarBaru | null = null;
  const simpan = () =>
    runSerializable(async (tx): Promise<HasilBuatRekomendasi> => {
      kabar = null;
      const ada = await tx.storeRecommendation.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, salesmanId: true } });
      if (ada) return ada.salesmanId === input.salesmanId ? { ok: true, id: ada.id, ulang: true } : { ok: false, kode: "KUNCI_DIPAKAI" };

      const catatan = rapikanTeksRekomendasi(input.catatan, false);
      if (!catatan.ok) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
      const rapi = rapikanBarisRekomendasi(input.baris);
      if (!rapi.ok) return rapi;

      const toko = await tx.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, name: true, isActive: true, salesmanId: true },
      });
      if (!toko || !toko.isActive) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
      const setelan = await tx.systemSetting.findUnique({ where: { key: KUNCI_TOKO_TERKUNCI }, select: { value: true } });
      if (!bolehBuatRekomendasi({ terkunci: bacaTokoTerkunci(setelan?.value), pemegangId: toko.salesmanId, userId: input.salesmanId })) {
        return { ok: false, kode: "BUKAN_PEMEGANG" };
      }

      const itemIds = [...new Set(rapi.baris.map((b) => b.itemId))];
      const [items, stok] = await Promise.all([
        tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, nameId: true, variants: true, isActive: true, type: true } }),
        tx.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true } }),
      ]);
      const itemById = new Map(items.map((i) => [i.id, i]));

      const data: { itemId: string; variantSku: string; productName: string; qty: number; alasan: string }[] = [];
      for (const b of rapi.baris) {
        const item = itemById.get(b.itemId);
        if (!item || item.type !== "FINISHED_GOOD") return { ok: false, kode: "BARANG_TIDAK_DIKENAL" };
        if (!item.isActive) return { ok: false, kode: "BARANG_TIDAK_AKTIF" };
        const opsi = opsiVarianBarang({
          variants: item.variants,
          skuInduk: item.sku,
          skuStok: stok.filter((s) => s.itemId === item.id).map((s) => s.variantSku),
        });
        const pilihan = opsi.find((o) => o.sku === b.variantSku);
        if (opsi.length > 0 ? !pilihan : b.variantSku !== "") return { ok: false, kode: "VARIAN_TIDAK_DIKENAL" };
        data.push({
          itemId: b.itemId,
          variantSku: b.variantSku,
          productName: namaBarisRekomendasi(item.nameId, pilihan?.label ?? null),
          qty: b.qty,
          alasan: b.alasan,
        });
      }

      const rek = await tx.storeRecommendation.create({
        data: {
          storeId: toko.id,
          salesmanId: input.salesmanId,
          status: "TERKIRIM",
          note: catatan.teks,
          idempotencyKey: kunci,
          lines: { create: data },
        },
        select: { id: true },
      });
      const pcs = data.reduce((n, b) => n + b.qty, 0);
      await tx.auditLog.create({
        data: {
          userId: input.salesmanId,
          action: JEJAK_REKOMENDASI.DIKIRIM,
          entityType: ENTITAS_REKOMENDASI,
          entityId: rek.id,
          changes: { before: null, after: { status: "TERKIRIM", storeId: toko.id, baris: data.length, pcs } },
          metadata: { storeId: toko.id, alasan: [...new Set(data.map((b) => b.alasan))] },
        },
      });
      kabar = { id: rek.id, storeId: toko.id, namaToko: toko.name, baris: data.length, pcs };
      return { ok: true, id: rek.id, ulang: false };
    });

  let hasil: HasilBuatRekomendasi;
  try {
    hasil = await simpan();
  } catch (err) {
    // Kiriman kembarnya menang lebih dulu; percobaan ini menemukan rekomendasinya.
    if (!bentrokKunciKiriman(err)) throw err;
    hasil = await simpan();
  }
  const k: DataKabarBaru | null = kabar;
  if (hasil.ok && !hasil.ulang && k) await kabariSpgToko(k, input.salesmanId);
  return hasil;
}

/** SPG toko = pengguna yang toko tetapnya toko ini (`User` tidak punya penanda aktif). */
export async function spgToko(client: { user: Klien["user"] }, storeId: string): Promise<string[]> {
  const rows = await client.user.findMany({ where: { assignedStoreId: storeId }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function kabariSpgToko(k: DataKabarBaru, salesmanId: string): Promise<void> {
  try {
    const [penerima, salesman] = await Promise.all([
      spgToko(prisma, k.storeId),
      prisma.user.findUnique({ where: { id: salesmanId }, select: { name: true } }),
    ]);
    const dari = salesman?.name?.trim() || "Salesman";
    for (const id of penerima) {
      await kabariPengguna(id, {
        jenis: JENIS_KABAR.REKOMENDASI_MASUK,
        judul: "Rekomendasi barang dari sales",
        isi: `${dari} merekomendasikan ${k.baris} barang (${k.pcs} pcs) untuk ${k.namaToko}. Buka untuk menerima atau menolak.`,
        data: { recommendationId: k.id },
      });
    }
  } catch (err) {
    console.error("[kabar] rekomendasi masuk gagal", k.id, err);
  }
}

// ─── Jawaban & pembatalan ────────────────────────────────────────────────────

type Rek = { id: string; storeId: string; salesmanId: string; status: StatusRekomendasi; respondedById: string | null };

async function bacaRek(tx: Klien, id: string): Promise<Rek | null> {
  return tx.storeRecommendation.findUnique({
    where: { id },
    select: { id: true, storeId: true, salesmanId: true, status: true, respondedById: true },
  });
}

async function catatJejak(
  tx: Klien,
  r: Rek,
  userId: string,
  action: string,
  ke: StatusRekomendasi,
  tambahan: { responseNote?: string | null; reason?: string | null; sumber?: SumberSetujuToko },
) {
  await tx.auditLog.create({
    data: {
      userId,
      action,
      entityType: ENTITAS_REKOMENDASI,
      entityId: r.id,
      changes: {
        before: { status: r.status },
        after: { status: ke, ...(tambahan.responseNote !== undefined ? { responseNote: tambahan.responseNote } : {}) },
      },
      metadata: { storeId: r.storeId, ...(tambahan.sumber ? { sumber: tambahan.sumber } : {}) },
      reason: tambahan.reason ?? null,
    },
  });
}

type KabarJawab = { rekId: string; storeId: string; salesmanId: string; spgId: string; diterima: boolean; alasan: string | null };

/**
 * SPG toko itu menjawab rekomendasi yang masih TERKIRIM. Tokonya selalu toko
 * tetap SPG dari server (`ambilTokoTetap`), tidak pernah dari HP. Ketukan
 * kedua untuk jawaban yang sama mengembalikan berhasil (`ulang`).
 */
async function jawab(input: {
  recommendationId: string;
  userId: string;
  storeIdTetap: string;
  diterima: boolean;
  teks: unknown;
}): Promise<HasilTransisiRekomendasi> {
  const teks = rapikanTeksRekomendasi(input.teks, !input.diterima);
  if (!teks.ok) return teks;
  const ke: StatusRekomendasi = input.diterima ? "DITERIMA" : "DITOLAK";

  let kabar: KabarJawab | null = null;
  const hasil = await runSerializable(async (tx): Promise<HasilTransisiRekomendasi> => {
    kabar = null;
    const r = await bacaRek(tx, input.recommendationId);
    if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (r.storeId !== input.storeIdTetap) return { ok: false, kode: "BUKAN_TOKO_ANDA" };
    if (r.status === ke && r.respondedById === input.userId) return { ok: true, ulang: true, status: ke };
    if (r.status !== "TERKIRIM") return { ok: false, kode: "SUDAH_BERUBAH", status: r.status };

    const n = await tx.storeRecommendation.updateMany({
      where: { id: r.id, status: "TERKIRIM" },
      data: { status: ke, respondedById: input.userId, respondedAt: new Date(), responseNote: teks.teks },
    });
    if (n.count !== 1) return { ok: false, kode: "SUDAH_BERUBAH" };
    await catatJejak(tx, r, input.userId, input.diterima ? JEJAK_REKOMENDASI.DITERIMA : JEJAK_REKOMENDASI.DITOLAK, ke, {
      responseNote: teks.teks,
      reason: input.diterima ? null : teks.teks,
    });
    kabar = { rekId: r.id, storeId: r.storeId, salesmanId: r.salesmanId, spgId: input.userId, diterima: input.diterima, alasan: teks.teks };
    return { ok: true, ulang: false, status: ke };
  });

  const k: KabarJawab | null = kabar;
  if (hasil.ok && !hasil.ulang && k) await kabariPembuat(k);
  return hasil;
}

async function kabariPembuat(k: KabarJawab): Promise<void> {
  try {
    const [toko, spg] = await Promise.all([
      prisma.store.findUnique({ where: { id: k.storeId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: k.spgId }, select: { name: true } }),
    ]);
    const namaToko = toko?.name ?? "Toko";
    const siapa = spg?.name?.trim() || "SPG";
    await kabariPengguna(k.salesmanId, {
      jenis: JENIS_KABAR.REKOMENDASI_DIJAWAB,
      judul: k.diterima ? `Rekomendasi diterima ${namaToko}` : `Rekomendasi ditolak ${namaToko}`,
      isi: k.diterima
        ? `${siapa} menerima rekomendasi Anda. Buat pesanannya dari halaman rekomendasi.`
        : `${siapa} menolak rekomendasi Anda. Alasan: ${k.alasan ?? "-"}`,
      data: { recommendationId: k.rekId },
    });
  } catch (err) {
    console.error("[kabar] rekomendasi dijawab gagal", k.rekId, err);
  }
}

export function terimaRekomendasi(input: { recommendationId: string; userId: string; storeIdTetap: string; catatan?: unknown }) {
  return jawab({ ...input, diterima: true, teks: input.catatan });
}

export function tolakRekomendasi(input: { recommendationId: string; userId: string; storeIdTetap: string; alasan: unknown }) {
  return jawab({ ...input, diterima: false, teks: input.alasan });
}

/**
 * Toko TANPA SPG: manager menjawab lewat WhatsApp atau langsung, lalu salesman
 * pembuatnya yang menandai "toko setuju" (DITERIMA, dijawab oleh salesman
 * sendiri, sumbernya di catatan jawaban). Toko yang punya SPG ditolak — di
 * sana SPG yang menjawab, supaya persetujuan tidak dicatat sepihak.
 */
export async function tandaiTokoSetuju(input: {
  recommendationId: string;
  salesmanId: string;
  sumber: unknown;
  catatan?: unknown;
}): Promise<HasilTransisiRekomendasi> {
  if (!(SUMBER_SETUJU_TOKO as readonly unknown[]).includes(input.sumber)) return { ok: false, kode: "SUMBER_TIDAK_VALID" };
  const sumber = input.sumber as SumberSetujuToko;
  const teks = rapikanTeksRekomendasi(input.catatan, false);
  if (!teks.ok) return teks;
  const catatan = catatanSetujuToko(sumber, teks.teks);

  return runSerializable(async (tx): Promise<HasilTransisiRekomendasi> => {
    const r = await bacaRek(tx, input.recommendationId);
    if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (r.salesmanId !== input.salesmanId) return { ok: false, kode: "BUKAN_PEMBUAT" };
    if (r.status === "DITERIMA" && r.respondedById === input.salesmanId) return { ok: true, ulang: true, status: "DITERIMA" };
    if (r.status !== "TERKIRIM") return { ok: false, kode: "SUDAH_BERUBAH", status: r.status };
    if ((await spgToko(tx, r.storeId)).length > 0) return { ok: false, kode: "TOKO_PUNYA_SPG" };

    const n = await tx.storeRecommendation.updateMany({
      where: { id: r.id, status: "TERKIRIM", salesmanId: input.salesmanId },
      data: { status: "DITERIMA", respondedById: input.salesmanId, respondedAt: new Date(), responseNote: catatan },
    });
    if (n.count !== 1) return { ok: false, kode: "SUDAH_BERUBAH" };
    await catatJejak(tx, r, input.salesmanId, JEJAK_REKOMENDASI.DISETUJUI_TOKO, "DITERIMA", { responseNote: catatan, sumber });
    return { ok: true, ulang: false, status: "DITERIMA" };
  });
}

/** Pembuatnya membatalkan selama belum menjadi pesanan (TERKIRIM atau DITERIMA). Alasan tidak wajib. */
export async function batalkanRekomendasi(input: { recommendationId: string; salesmanId: string; alasan?: unknown }): Promise<HasilTransisiRekomendasi> {
  const alasan = rapikanTeksRekomendasi(input.alasan, false);
  if (!alasan.ok) return alasan;

  return runSerializable(async (tx): Promise<HasilTransisiRekomendasi> => {
    const r = await bacaRek(tx, input.recommendationId);
    if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (r.salesmanId !== input.salesmanId) return { ok: false, kode: "BUKAN_PEMBUAT" };
    if (r.status === "DIBATALKAN") return { ok: true, ulang: true, status: "DIBATALKAN" };
    if (r.status !== "TERKIRIM" && r.status !== "DITERIMA") return { ok: false, kode: "SUDAH_BERUBAH", status: r.status };

    const n = await tx.storeRecommendation.updateMany({
      where: { id: r.id, salesmanId: input.salesmanId, status: { in: ["TERKIRIM", "DITERIMA"] } },
      data: { status: "DIBATALKAN" },
    });
    if (n.count !== 1) return { ok: false, kode: "SUDAH_BERUBAH" };
    await catatJejak(tx, r, input.salesmanId, JEJAK_REKOMENDASI.DIBATALKAN, "DIBATALKAN", { reason: alasan.teks });
    return { ok: true, ulang: false, status: "DIBATALKAN" };
  });
}
