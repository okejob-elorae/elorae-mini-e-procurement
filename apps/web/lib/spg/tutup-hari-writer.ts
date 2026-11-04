import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { bacaTutupHari, KUNCI_TUTUP_HARI } from "./pengaturan";
import {
  bacaFotoLaporan,
  ENTITAS_TUTUP_HARI,
  hariTutupSah,
  idFotoTutup,
  JEJAK_TUTUP_HARI,
  nilaiLaporan,
  periksaIsianTutupHari,
  type KodeTolakTutup,
  type NilaiLaporanTutup,
} from "./tutup-hari";
import { ringkasanTutupHari } from "./tutup-hari-queries";

/**
 * Kirim laporan tutup hari SPG.
 *
 * Satu laporan per toko per hari WIB: yang menutup terakhir MENIMPA laporan
 * (rekan setoko bisa membetulkan jumlah pengunjung yang salah ketik), dan
 * setiap kiriman menulis jejak `AuditLog` dengan pasangan sebelum/sesudah DI
 * DALAM transaksi yang sama — barisnya hanya menyimpan keadaan terakhir, jadi
 * laporan yang tertimpa hanya hidup di jejaknya.
 *
 * Angka penjualan diambil sistem saat dikirim (`ringkasanTutupHari`), tidak
 * pernah dari HP. Kunci idempotensi diperiksa PALING DULU: jawaban yang hilang
 * di jalan lalu dikirim ulang tidak menulis jejak kedua — bahkan kalau hari
 * sudah berganti di antaranya.
 */

export type KodeGagalTutup = KodeTolakTutup | "HARI_TIDAK_SAH" | "TOKO_TIDAK_DITEMUKAN" | "KUNCI_TIDAK_SAH";

export type HasilKirimTutup =
  | { ok: true; id: string; ulangan: boolean; diperbarui: boolean; laporan: NilaiLaporanTutup }
  | { ok: false; kode: KodeGagalTutup };

export type MasukanKirimTutup = {
  userId: string;
  /** SELALU toko tetap SPG dari server, tidak pernah dari HP. */
  storeId: string;
  day: string;
  isi: { pengunjung?: unknown; totalKasir?: unknown; catatan?: unknown; foto?: unknown };
  idempotencyKey: string;
};

const MAKS_ULANG_BENTROK = 3;

function keNilai(c: {
  closedById: string;
  notaCount: number;
  pcs: number;
  returnPcs: number;
  grossTotal: unknown;
  discountTotal: unknown;
  netTotal: unknown;
  visitorCount: number | null;
  cashierTotal: unknown;
  note: string | null;
  photoUrls: unknown;
}): NilaiLaporanTutup {
  return {
    closedById: c.closedById,
    notaCount: c.notaCount,
    pcs: c.pcs,
    returnPcs: c.returnPcs,
    grossTotal: Number(c.grossTotal),
    discountTotal: Number(c.discountTotal),
    netTotal: Number(c.netTotal),
    visitorCount: c.visitorCount,
    cashierTotal: c.cashierTotal === null ? null : Number(c.cashierTotal),
    note: c.note,
    photoUrls: bacaFotoLaporan(c.photoUrls),
  };
}

type Tx = Prisma.TransactionClient;

/** Laporan toko-hari ini sudah pernah ditulis dengan kunci ini? */
async function sudahDenganKunci(tx: Tx, closeId: string, kunci: string): Promise<boolean> {
  const jejak = await tx.auditLog.findMany({
    where: { entityType: ENTITAS_TUTUP_HARI, entityId: closeId, action: { in: [JEJAK_TUTUP_HARI.DIKIRIM, JEJAK_TUTUP_HARI.DIPERBARUI] } },
    select: { metadata: true },
  });
  return jejak.some((j) => {
    const m = j.metadata;
    return m !== null && typeof m === "object" && !Array.isArray(m) && (m as Record<string, unknown>).idempotencyKey === kunci;
  });
}

const bentrokUnik = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function kirimTutupHari(m: MasukanKirimTutup, sekarang: Date = new Date()): Promise<HasilKirimTutup> {
  const kunci = typeof m.idempotencyKey === "string" ? m.idempotencyKey.trim() : "";
  if (kunci.length < 8 || kunci.length > 100) return { ok: false, kode: "KUNCI_TIDAK_SAH" };

  // Kiriman ulang dengan kunci yang sama: kembalikan laporan yang sudah ada.
  if (typeof m.day === "string") {
    const ada = await prisma.spgDailyClose.findUnique({ where: { storeId_day: { storeId: m.storeId, day: m.day } } });
    if (ada && (await sudahDenganKunci(prisma, ada.id, kunci))) {
      return { ok: true, id: ada.id, ulangan: true, diperbarui: false, laporan: keNilai(ada) };
    }
  }

  if (!hariTutupSah(m.day, sekarang)) return { ok: false, kode: "HARI_TIDAK_SAH" };
  const day = m.day;

  const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TUTUP_HARI }, select: { value: true } });
  const cek = periksaIsianTutupHari(m.isi, bacaTutupHari(setelan?.value));
  if (!cek.ok) return cek;
  const isi = cek.nilai;

  // Angka sistem saat dikirim — dibaca di luar transaksi serializable supaya
  // laporan tidak berebut kunci dengan nota yang sedang dicatat di konter.
  const ringkasan = await ringkasanTutupHari(m.storeId, day);
  if (!ringkasan) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
  const sesudah = nilaiLaporan(m.userId, ringkasan, isi);

  for (let percobaan = 1; ; percobaan++) {
    try {
      return await runSerializable(async (tx): Promise<HasilKirimTutup> => {
        const lama = await tx.spgDailyClose.findUnique({ where: { storeId_day: { storeId: m.storeId, day } } });
        if (lama && (await sudahDenganKunci(tx, lama.id, kunci))) {
          return { ok: true, id: lama.id, ulangan: true, diperbarui: false, laporan: keNilai(lama) };
        }
        const sebelum = lama ? keNilai(lama) : null;

        // Foto harus unggahan pengirim sendiri, atau foto yang sudah ada di
        // laporan ini (rekan yang menutup ulang mempertahankan foto rekannya).
        // Tanpa syarat ini jalur `/api/foto/<id>` milik siapa pun — bukti
        // transfer, nota retur toko lain — bisa ditempelkan di laporan.
        const fotoLama = new Set(sebelum?.photoUrls ?? []);
        const fotoBaru = isi.foto.filter((u) => !fotoLama.has(u));
        if (fotoBaru.length > 0) {
          const ids = fotoBaru.map((u) => idFotoTutup(u)!);
          const milik = await tx.foto.findMany({ where: { id: { in: ids }, uploadedById: m.userId }, select: { id: true } });
          if (milik.length !== new Set(ids).size) return { ok: false, kode: "FOTO_TIDAK_SAH" };
        }

        const data = {
          closedById: sesudah.closedById,
          notaCount: sesudah.notaCount,
          pcs: sesudah.pcs,
          returnPcs: sesudah.returnPcs,
          grossTotal: sesudah.grossTotal,
          discountTotal: sesudah.discountTotal,
          netTotal: sesudah.netTotal,
          visitorCount: sesudah.visitorCount,
          cashierTotal: sesudah.cashierTotal,
          note: sesudah.note,
          photoUrls: sesudah.photoUrls as Prisma.InputJsonValue,
        };
        const baris = lama
          ? await tx.spgDailyClose.update({ where: { id: lama.id }, data, select: { id: true } })
          : await tx.spgDailyClose.create({ data: { storeId: m.storeId, day, ...data }, select: { id: true } });

        await tx.auditLog.create({
          data: {
            userId: m.userId,
            action: lama ? JEJAK_TUTUP_HARI.DIPERBARUI : JEJAK_TUTUP_HARI.DIKIRIM,
            entityType: ENTITAS_TUTUP_HARI,
            entityId: baris.id,
            changes: { before: sebelum, after: sesudah } as Prisma.InputJsonValue,
            metadata: { idempotencyKey: kunci, storeId: m.storeId, day },
          },
        });
        return { ok: true, id: baris.id, ulangan: false, diperbarui: lama !== null, laporan: sesudah };
      });
    } catch (e) {
      // Dua SPG menutup toko yang sama bersamaan: yang kalah membuat baris yang
      // baru saja dibuat rekannya. Diulang — percobaan berikutnya membacanya
      // dan menjadi pembaruan, dengan `before` yang benar.
      if (bentrokUnik(e) && percobaan < MAKS_ULANG_BENTROK) continue;
      throw e;
    }
  }
}
