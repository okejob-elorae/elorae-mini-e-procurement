import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import {
  ENTITAS_PELANGGAN,
  JEJAK_PELANGGAN,
  periksaIsianPelanggan,
  samarkanHp,
  type IsianPelanggan,
  type IsianPelangganSah,
  type KodeTolakPelanggan,
} from "./pelanggan";

/**
 * Penulis data pembeli (`StoreCustomer`) dari HP SPG.
 *
 * Toko SELALU dari pemanggil (toko tetap SPG), tidak pernah dari layar.
 * Nomor yang sudah terdaftar di toko itu tidak membuat pelanggan kedua: yang
 * dikembalikan pelanggan yang sudah ada (`sudahAda`), dan layar membukanya.
 *
 * Setiap perubahan menulis jejaknya DI transaksi yang sama. Nomor HP di jejak
 * DISAMARKAN (`0812****7890`): jejak cukup menunjukkan bahwa nomornya berganti,
 * tanpa menyebarkan data pribadi ke layar riwayat kantor.
 */

type Tx = Prisma.TransactionClient;

export type HasilTambahPelanggan =
  | { ok: true; id: string; sudahAda: boolean; nama: string }
  | { ok: false; code: KodeTolakPelanggan };

export type HasilUbahPelanggan =
  | { ok: true; id: string }
  | { ok: false; code: KodeTolakPelanggan | "TIDAK_DITEMUKAN" }
  | { ok: false; code: "HP_DIPAKAI"; idLain: string; namaLain: string };

const jejakIsi = (p: { name: string; phone: string; note: string | null }) => ({ nama: p.name, hp: samarkanHp(p.phone), catatan: p.note });

/**
 * Catat pelanggan baru DI DALAM transaksi pemanggil, atau kembalikan yang
 * sudah ada dengan nomor itu. Dipakai juga oleh penulis titip pesan, supaya
 * pembeli baru dan permintaannya tercatat bersama atau tidak sama sekali.
 */
export async function catatPelangganTx(
  tx: Tx,
  input: { storeId: string; userId: string; data: IsianPelangganSah; sekarang: Date },
): Promise<{ id: string; sudahAda: boolean; nama: string }> {
  const ada = await tx.storeCustomer.findUnique({
    where: { storeId_phone: { storeId: input.storeId, phone: input.data.hp } },
    select: { id: true, name: true },
  });
  if (ada) return { id: ada.id, sudahAda: true, nama: ada.name };
  const baru = await tx.storeCustomer.create({
    data: {
      storeId: input.storeId,
      name: input.data.nama,
      phone: input.data.hp,
      note: input.data.catatan,
      consentAt: input.sekarang,
      createdById: input.userId,
    },
    select: { id: true, name: true, phone: true, note: true },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: JEJAK_PELANGGAN.DIBUAT,
      entityType: ENTITAS_PELANGGAN,
      entityId: baru.id,
      changes: { before: null, after: { ...jejakIsi(baru), setujuPada: input.sekarang.toISOString() } } as Prisma.InputJsonValue,
      metadata: { storeId: input.storeId } as Prisma.InputJsonValue,
    },
  });
  return { id: baru.id, sudahAda: false, nama: baru.name };
}

const nomorBentrok = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function tambahPelanggan(input: {
  storeId: string;
  userId: string;
  isian: IsianPelanggan;
  sekarang?: Date;
}): Promise<HasilTambahPelanggan> {
  const cek = periksaIsianPelanggan(input.isian, true);
  if (!cek.ok) return cek;
  const sekarang = input.sekarang ?? new Date();
  try {
    const hasil = await runSerializable((tx) => catatPelangganTx(tx, { storeId: input.storeId, userId: input.userId, data: cek.data, sekarang }));
    return { ok: true, ...hasil };
  } catch (e) {
    // Dua HP mencatat nomor yang sama bersamaan: yang kalah membuka pelanggan yang menang.
    if (!nomorBentrok(e)) throw e;
    const ada = await prisma.storeCustomer.findUnique({
      where: { storeId_phone: { storeId: input.storeId, phone: cek.data.hp } },
      select: { id: true, name: true },
    });
    if (!ada) throw e;
    return { ok: true, id: ada.id, sudahAda: true, nama: ada.name };
  }
}

/**
 * Ubah nama, nomor, atau catatan. Nomor yang DIGANTI butuh persetujuan baru
 * dari pemilik nomor itu (`setuju`), dan `consentAt` ikut diperbarui. Nomor
 * yang sudah dipakai pelanggan lain di toko ini ditolak dengan menyebut siapa.
 */
export async function ubahPelanggan(input: {
  storeId: string;
  userId: string;
  id: string;
  isian: IsianPelanggan;
  sekarang?: Date;
}): Promise<HasilUbahPelanggan> {
  const sekarang = input.sekarang ?? new Date();
  // Pemeriksaan pertama tanpa syarat persetujuan; syarat itu baru diketahui
  // sesudah nomor lamanya dibaca.
  const awal = periksaIsianPelanggan(input.isian, false);
  if (!awal.ok) return awal;

  try {
    return await runSerializable(async (tx): Promise<HasilUbahPelanggan> => {
      const lama = await tx.storeCustomer.findFirst({
        where: { id: input.id, storeId: input.storeId },
        select: { id: true, name: true, phone: true, note: true, consentAt: true },
      });
      if (!lama) return { ok: false, code: "TIDAK_DITEMUKAN" };
      const gantiNomor = lama.phone !== awal.data.hp;
      if (gantiNomor) {
        const cek = periksaIsianPelanggan(input.isian, true);
        if (!cek.ok) return cek;
        const lain = await tx.storeCustomer.findUnique({
          where: { storeId_phone: { storeId: input.storeId, phone: awal.data.hp } },
          select: { id: true, name: true },
        });
        if (lain && lain.id !== lama.id) return { ok: false, code: "HP_DIPAKAI", idLain: lain.id, namaLain: lain.name };
      }
      // Catatan yang tidak dikirim berarti tidak diubah; string kosong menghapusnya.
      const catatan = input.isian.catatan === undefined ? lama.note : awal.data.catatan;
      if (!gantiNomor && lama.name === awal.data.nama && (lama.note ?? null) === catatan) return { ok: true, id: lama.id };

      const baru = await tx.storeCustomer.update({
        where: { id: lama.id },
        data: {
          name: awal.data.nama,
          phone: awal.data.hp,
          note: catatan,
          ...(gantiNomor ? { consentAt: sekarang } : {}),
        },
        select: { id: true, name: true, phone: true, note: true, consentAt: true },
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: JEJAK_PELANGGAN.DIUBAH,
          entityType: ENTITAS_PELANGGAN,
          entityId: lama.id,
          changes: {
            before: { ...jejakIsi(lama), setujuPada: lama.consentAt.toISOString() },
            after: { ...jejakIsi(baru), setujuPada: baru.consentAt.toISOString() },
          } as Prisma.InputJsonValue,
          metadata: { storeId: input.storeId, gantiNomor } as Prisma.InputJsonValue,
        },
      });
      return { ok: true, id: lama.id };
    });
  } catch (e) {
    if (!nomorBentrok(e)) throw e;
    const lain = await prisma.storeCustomer.findUnique({
      where: { storeId_phone: { storeId: input.storeId, phone: awal.data.hp } },
      select: { id: true, name: true },
    });
    if (!lain) throw e;
    return { ok: false, code: "HP_DIPAKAI", idLain: lain.id, namaLain: lain.name };
  }
}
