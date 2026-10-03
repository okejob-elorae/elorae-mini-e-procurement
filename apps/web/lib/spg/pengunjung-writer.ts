import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { kirimanMenang, periksaKirimanPengunjung, type KodeTolakPengunjung } from "./pengunjung";
import type { PengunjungHp } from "./pengunjung-queries";

/**
 * Simpan angka penghitung pengunjung dari HP SPG. Angka MUTLAK + waktu ubah:
 * kiriman ditulis hanya bila waktu ubahnya lebih baru dari yang tersimpan
 * (`kirimanMenang`), jadi kiriman ulang atau kiriman lama yang tiba terlambat
 * tidak pernah menggandakan atau memundurkan hitungan.
 *
 * Bandingkan-lalu-tulis berjalan di `runSerializable`: dua kiriman bersamaan
 * dari orang yang sama (dua tab, antrean + ketukan) tidak bisa sama-sama
 * membaca baris lama lalu saling menimpa — basis data menolak salah satunya
 * dan percobaan ulang membaca yang sudah ditulis.
 *
 * Tanpa `AuditLog`: ini hitungan ketukan yang dikirim setiap beberapa detik,
 * bukan keputusan; barisnya sendiri sudah memuat pemilik, hari dan waktu ubah.
 *
 * `storeId` SELALU toko tetap SPG dari server (pemanggil memakai
 * `ambilTokoTetap`), tidak pernah dari isian HP.
 */

export type HasilCatatPengunjung = ({ ok: true; diterapkan: boolean } & PengunjungHp) | { ok: false; kode: KodeTolakPengunjung };

export async function catatPengunjung(m: {
  userId: string;
  storeId: string;
  isian: unknown;
  sekarang?: Date;
}): Promise<HasilCatatPengunjung> {
  const cek = periksaKirimanPengunjung(m.isian, m.sekarang ?? new Date());
  if (!cek.ok) return cek;
  const { day, count, clientUpdatedAt } = cek.nilai;
  const { userId, storeId } = m;

  const tulis = () =>
    runSerializable(async (tx) => {
      const kunci = { storeId_userId_day: { storeId, userId, day } };
      const ada = await tx.spgVisitorCount.findUnique({ where: kunci, select: { id: true, count: true, clientUpdatedAt: true } });
      let simpan = ada;
      let diterapkan = false;
      if (!ada) {
        simpan = await tx.spgVisitorCount.create({
          data: { storeId, userId, day, count, clientUpdatedAt },
          select: { id: true, count: true, clientUpdatedAt: true },
        });
        diterapkan = true;
      } else if (kirimanMenang(ada.clientUpdatedAt, clientUpdatedAt)) {
        simpan = await tx.spgVisitorCount.update({
          where: { id: ada.id },
          data: { count, clientUpdatedAt },
          select: { id: true, count: true, clientUpdatedAt: true },
        });
        diterapkan = true;
      }
      const total = await tx.spgVisitorCount.aggregate({ where: { storeId, day }, _sum: { count: true } });
      return {
        ok: true as const,
        diterapkan,
        day,
        saya: simpan ? { count: simpan.count, clientUpdatedAt: simpan.clientUpdatedAt.toISOString() } : null,
        totalToko: total._sum.count ?? 0,
      };
    });

  try {
    return await tulis();
  } catch (e) {
    // Dua kiriman PERTAMA bersamaan sama-sama tidak menemukan baris lalu
    // sama-sama membuat; yang kalah mendapat pelanggaran unik. Sekali ulang:
    // kini barisnya ada, dan aturan "lebih baru menang" yang memutuskan.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return await tulis();
    throw e;
  }
}
