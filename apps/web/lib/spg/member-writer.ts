import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { ENTITAS_MEMBER, JEJAK_MEMBER } from "./member";
import { bacaAturanMemberDb } from "./member-queries";

/**
 * Penulis member. Mendaftar dilakukan SPG di konter (dari nota atau dari
 * rincian pelanggan); menonaktifkan / mengaktifkan kembali dilakukan kantor
 * dengan alasan. Setiap perubahan meninggalkan jejak `AuditLog` di dalam
 * transaksinya. Member yang dinonaktifkan kantor tidak bisa didaftarkan ulang
 * diam-diam oleh SPG (`MEMBER_NONAKTIF`) — kantor yang mengaktifkannya.
 */

type Klien = Prisma.TransactionClient;

export type HasilDaftarMember = { ok: true; id: string; baru: boolean } | { ok: false; code: "PROGRAM_MATI" | "MEMBER_NONAKTIF" };

/** Daftarkan nomor ini sebagai member, di dalam transaksi pemanggil. Sudah member aktif = tidak berubah. */
export async function daftarkanMemberDiTx(
  tx: Klien,
  input: { phone: string; nama: string; storeId: string; userId: string; sekarang: Date; sumber: "NOTA" | "PELANGGAN"; docNo?: string | null },
): Promise<HasilDaftarMember> {
  const ada = await tx.member.findUnique({ where: { phone: input.phone }, select: { id: true, isActive: true } });
  if (ada) return ada.isActive ? { ok: true, id: ada.id, baru: false } : { ok: false, code: "MEMBER_NONAKTIF" };
  const aturan = await bacaAturanMemberDb(tx);
  if (!aturan.aktif) return { ok: false, code: "PROGRAM_MATI" };
  const baru = await tx.member.create({
    data: {
      phone: input.phone,
      name: input.nama,
      consentAt: input.sekarang,
      joinedAt: input.sekarang,
      joinedStoreId: input.storeId,
      joinedById: input.userId,
    },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: JEJAK_MEMBER.DIDAFTARKAN,
      entityType: ENTITAS_MEMBER,
      entityId: baru.id,
      changes: { before: null, after: { name: input.nama, joinedStoreId: input.storeId, isActive: true } } as Prisma.InputJsonValue,
      metadata: { sumber: input.sumber, ...(input.docNo ? { docNo: input.docNo } : {}) } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, id: baru.id, baru: true };
}

export type HasilDaftarPelanggan = HasilDaftarMember | { ok: false; code: "PELANGGAN_TIDAK_ADA" | "LEWAT_NOTA" };

/**
 * SPG mendaftarkan pelanggan tokonya sendiri sebagai member (dari rincian
 * pelanggan). Bila kantor mengisi belanja minimal untuk mendaftar, pendaftaran
 * hanya lewat nota yang mencapainya (`LEWAT_NOTA`) — syarat itu tidak bisa
 * dilewati dari layar pelanggan.
 */
export async function daftarkanMemberPelanggan(input: { customerId: string; storeId: string; userId: string; sekarang?: Date }): Promise<HasilDaftarPelanggan> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilDaftarPelanggan> => {
    const p = await tx.storeCustomer.findFirst({ where: { id: input.customerId, storeId: input.storeId }, select: { name: true, phone: true } });
    if (!p) return { ok: false, code: "PELANGGAN_TIDAK_ADA" };
    const ada = await tx.member.findUnique({ where: { phone: p.phone }, select: { id: true, isActive: true } });
    if (!ada) {
      const aturan = await bacaAturanMemberDb(tx);
      if (!aturan.aktif) return { ok: false, code: "PROGRAM_MATI" };
      if (aturan.minBelanjaDaftar > 0) return { ok: false, code: "LEWAT_NOTA" };
    }
    return daftarkanMemberDiTx(tx, { phone: p.phone, nama: p.name, storeId: input.storeId, userId: input.userId, sekarang, sumber: "PELANGGAN" });
  });
}

export type HasilAturMember = { ok: true; berubah: boolean } | { ok: false; code: "TIDAK_ADA" | "ALASAN_WAJIB" };

/** Kantor menonaktifkan (alasan wajib) atau mengaktifkan kembali member. */
export async function aturAktifMember(input: { memberId: string; aktif: boolean; userId: string; alasan?: string | null; sekarang?: Date }): Promise<HasilAturMember> {
  const alasan = (input.alasan ?? "").trim().slice(0, 500);
  if (!input.aktif && !alasan) return { ok: false, code: "ALASAN_WAJIB" };
  if (typeof input.memberId !== "string" || !input.memberId) return { ok: false, code: "TIDAK_ADA" };
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilAturMember> => {
    const lama = await tx.member.findUnique({ where: { id: input.memberId }, select: { id: true, isActive: true } });
    if (!lama) return { ok: false, code: "TIDAK_ADA" };
    if (lama.isActive === input.aktif) return { ok: true, berubah: false };
    await tx.member.update({
      where: { id: lama.id },
      data: input.aktif
        ? { isActive: true, deactivatedAt: null, deactivatedById: null }
        : { isActive: false, deactivatedAt: sekarang, deactivatedById: input.userId },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.aktif ? JEJAK_MEMBER.DIAKTIFKAN : JEJAK_MEMBER.DINONAKTIFKAN,
        entityType: ENTITAS_MEMBER,
        entityId: lama.id,
        reason: alasan || null,
        changes: { before: { isActive: lama.isActive }, after: { isActive: input.aktif } } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, berubah: true };
  });
}

