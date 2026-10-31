import { prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { kirimanMenunggu } from "./kiriman";
import { ENTITAS_MUTASI, JEJAK_MUTASI, KATEGORI_NOTIF_MUTASI } from "./mutasi-aturan";
import { bacaAturanMutasiTx } from "./mutasi-terima";

/**
 * Pengingat harian untuk barang yang menunggu di toko — dipanggil cron
 * (`lib/cron/jobs.ts`), aman dipanggil berulang.
 *
 * - Mutasi yang sudah DIKIRIM lebih dari `hariPengingat` hari tanpa diterima:
 *   SATU catatan kantor (`STORE_TRANSFER_STALE`, ke pengelola toko yang boleh
 *   menerima atas nama toko) dan satu pengingat ke SPG toko tujuan, sekali per
 *   mutasi. Penandanya jejak `STORE_TRANSFER_STALE_NOTIFIED`.
 * - Kiriman apa pun yang menunggu diterima lebih dari sehari: kabar
 *   `KIRIMAN_MENUNGGU` ke SPG toko itu, sekali per toko per hari (WIB).
 *   Penandanya jejak `STORE_DELIVERY_WAITING_NOTIFIED` pada toko itu.
 *
 * Penanda ditulis di transaksi serializable bersama pemeriksaannya, jadi dua
 * server yang menjalankan cron bersamaan tidak mengirim dua kali. Kabar dan
 * sebaran catatan dikirim SESUDAH transaksi.
 *
 * `transferIds`/`storeIds` membatasi sapuan — WAJIB dipakai tes (basis data bersama).
 */

const HARI_MS = 86_400_000;

/** Awal hari kalender Jakarta yang memuat `d`. */
export function awalHariWib(d: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${ymd}T00:00:00+07:00`);
}

export async function ingatkanMutasiMacet(opsi: { sekarang?: Date; transferIds?: string[] } = {}): Promise<{ dikabarkan: number }> {
  const sekarang = opsi.sekarang ?? new Date();
  const aturan = await runSerializable((tx) => bacaAturanMutasiTx(tx));
  const batas = new Date(sekarang.getTime() - aturan.hariPengingat * HARI_MS);
  const calon = await prisma.storeTransfer.findMany({
    where: { status: "DIKIRIM", shippedAt: { lte: batas }, ...(opsi.transferIds ? { id: { in: opsi.transferIds } } : {}) },
    orderBy: { shippedAt: "asc" },
    take: 200,
    select: { id: true, docNo: true, createdById: true, toStoreId: true, shippedAt: true, toStore: { select: { name: true } }, fromStore: { select: { name: true } } },
  });

  let dikabarkan = 0;
  for (const m of calon) {
    let catatan: AdminNotification | null = null;
    const ditulis = await runSerializable(async (tx) => {
      catatan = null;
      const sudah = await tx.auditLog.findFirst({
        where: { entityType: ENTITAS_MUTASI, entityId: m.id, action: JEJAK_MUTASI.MACET_DIKABARKAN },
        select: { id: true },
      });
      if (sudah) return false;
      const masih = await tx.storeTransfer.findFirst({ where: { id: m.id, status: "DIKIRIM" }, select: { id: true } });
      if (!masih) return false;
      await tx.auditLog.create({
        data: {
          userId: m.createdById,
          action: JEJAK_MUTASI.MACET_DIKABARKAN,
          entityType: ENTITAS_MUTASI,
          entityId: m.id,
          metadata: { hariPengingat: aturan.hariPengingat, otomatis: true },
        },
      });
      catatan = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_MUTASI.MACET,
          severity: "WARNING",
          title: `Mutasi ${m.docNo} belum diterima ${aturan.hariPengingat} hari`,
          message: `Barang dari ${m.fromStore.name} ke ${m.toStore.name} sudah dikirim tapi belum diterima. Hubungi tokonya, atau terima atas nama toko di halaman mutasi.`,
          metadata: { transferId: m.id },
        },
      });
      return true;
    });
    if (!ditulis) continue;
    dikabarkan += 1;
    const terkirim: AdminNotification | null = catatan;
    if (terkirim) void fanOutAdminNotification(terkirim);
    const spg = await prisma.user.findMany({ where: { assignedStoreId: m.toStoreId }, select: { id: true } });
    for (const s of spg) {
      await kabariPengguna(s.id, {
        jenis: JENIS_KABAR.MUTASI_MASUK,
        judul: `Mutasi ${m.docNo} belum diterima`,
        isi: `Barang dari ${m.fromStore.name} sudah dikirim ${aturan.hariPengingat} hari lalu. Hitung dan terima di menu Terima kiriman.`,
        data: { transferId: m.id },
      });
    }
  }
  return { dikabarkan };
}

export async function kabarkanKirimanMenunggu(opsi: { sekarang?: Date; storeIds?: string[] } = {}): Promise<{ toko: number; orang: number }> {
  const sekarang = opsi.sekarang ?? new Date();
  const awalHari = awalHariWib(sekarang);
  const batas = new Date(sekarang.getTime() - HARI_MS);
  const spg = await prisma.user.findMany({
    where: { assignedStoreId: opsi.storeIds ? { in: opsi.storeIds } : { not: null } },
    select: { id: true, assignedStoreId: true },
    orderBy: { id: "asc" },
  });
  const perToko = new Map<string, string[]>();
  for (const s of spg) {
    if (!s.assignedStoreId) continue;
    perToko.set(s.assignedStoreId, [...(perToko.get(s.assignedStoreId) ?? []), s.id]);
  }

  let toko = 0;
  let orang = 0;
  for (const [storeId, spgIds] of perToko) {
    const lama = (await kirimanMenunggu(storeId, sekarang)).filter((k) => k.tanggal <= batas);
    if (lama.length === 0) continue;
    const ditulis = await runSerializable(async (tx) => {
      const sudah = await tx.auditLog.findFirst({
        where: { entityType: "Store", entityId: storeId, action: JEJAK_MUTASI.KIRIMAN_MENUNGGU_DIKABARKAN, createdAt: { gte: awalHari } },
        select: { id: true },
      });
      if (sudah) return false;
      await tx.auditLog.create({
        data: {
          userId: spgIds[0],
          action: JEJAK_MUTASI.KIRIMAN_MENUNGGU_DIKABARKAN,
          entityType: "Store",
          entityId: storeId,
          metadata: { kiriman: lama.length, penerima: spgIds.length, otomatis: true },
          createdAt: sekarang,
        },
      });
      return true;
    });
    if (!ditulis) continue;
    toko += 1;
    for (const id of spgIds) {
      orang += 1;
      await kabariPengguna(id, {
        jenis: JENIS_KABAR.KIRIMAN_MENUNGGU,
        judul: lama.length === 1 ? "1 kiriman menunggu diterima" : `${lama.length} kiriman menunggu diterima`,
        isi: `Paling lama ${lama[0].docNo}. Hitung barangnya dan terima di menu Terima kiriman, supaya stok toko benar.`,
        data: { storeId },
      });
    }
  }
  return { toko, orang };
}
