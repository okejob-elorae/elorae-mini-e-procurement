import { Prisma, prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { gantiPemegangToko } from "./penanggung-jawab-writer";
import { cekDuplikatUsulan } from "./usulan-queries";
import {
  BATAS_USULAN,
  validasiPersetujuan,
  validasiUsulanToko,
  type GalatPersetujuan,
  type GalatUsulan,
  type KandidatDuplikat,
  type MasukanPersetujuan,
  type MasukanUsulanToko,
} from "./usulan-toko";

/**
 * Penulis usulan toko baru: salesman mengajukan dari HP, admin menyetujui
 * (tokonya dibuat) atau menolak (dengan alasan).
 *
 * Baris usulan hanya menyimpan keadaan terakhir. Siapa menyetujui dengan isian
 * apa, dan kenapa ditolak, hidup di `AuditLog` yang ditulis DI DALAM
 * transaksinya — sama seperti perubahan data toko lainnya.
 */

export const AKSI_USULAN_TOKO = {
  DISETUJUI: "STORE_PROPOSAL_APPROVED",
  DITOLAK: "STORE_PROPOSAL_REJECTED",
  TOKO_DIBUAT: "STORE_CREATED_FROM_PROPOSAL",
} as const;

/**
 * Kategori `AdminNotification` untuk usulan baru. Lonceng admin baru berbunyi
 * setelah kategori ini dipetakan ke izin di `admin-fanout.ts`; sebelum itu
 * barisnya tetap tertulis dan jumlah yang menunggu tampil di Master Toko.
 */
export const KATEGORI_NOTIF_USULAN_TOKO = "STORE_PROPOSAL";

const BATAS_KUNCI = 191;

export type HasilAjukan =
  | { ok: true; id: string; ulang: boolean }
  | { ok: false; code: GalatUsulan | "AREA_TIDAK_ADA" | "KUNCI_TIDAK_SAH" | "KUNCI_MILIK_LAIN" }
  | { ok: false; code: "MUNGKIN_DUPLIKAT"; kandidat: KandidatDuplikat[] };

function unikBentrok(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Ajukan toko baru.
 *
 * Kunci idempoten diperiksa PALING DULU: kiriman ulang dari HP yang sinyalnya
 * putus di tengah jalan harus mendapat usulan yang sama, bukan usulan kedua —
 * dan bukan pula "mungkin duplikat" melawan dirinya sendiri.
 *
 * Tanpa `tetapAjukan`, usulan yang mirip toko/usulan lain ditahan dan
 * kandidatnya dikembalikan. Pemeriksaan ini diulang di server walau HP sudah
 * memeriksanya: rekan bisa saja mengusulkan toko yang sama semenit sebelumnya.
 */
export async function ajukanUsulanToko(input: {
  userId: string;
  masukan: MasukanUsulanToko;
  idempotencyKey: string;
  tetapAjukan: boolean;
}): Promise<HasilAjukan> {
  const kunci = input.idempotencyKey.trim();
  if (kunci === "" || kunci.length > BATAS_KUNCI) return { ok: false, code: "KUNCI_TIDAK_SAH" };

  const sudahAda = await prisma.storeProposal.findUnique({
    where: { idempotencyKey: kunci },
    select: { id: true, proposedById: true },
  });
  if (sudahAda) {
    return sudahAda.proposedById === input.userId
      ? { ok: true, id: sudahAda.id, ulang: true }
      : { ok: false, code: "KUNCI_MILIK_LAIN" };
  }

  const v = validasiUsulanToko(input.masukan);
  if (!v.ok) return { ok: false, code: v.galat[0] };
  const data = v.data;

  if (data.groupId) {
    const area = await prisma.storeGroup.count({ where: { id: data.groupId, isActive: true } });
    if (area === 0) return { ok: false, code: "AREA_TIDAK_ADA" };
  }

  if (!input.tetapAjukan) {
    const kandidat = await cekDuplikatUsulan({ name: data.name, lat: data.lat, lng: data.lng });
    if (kandidat.length > 0) return { ok: false, code: "MUNGKIN_DUPLIKAT", kandidat };
  }

  let notifikasi: AdminNotification | undefined;
  try {
    const id = await prisma.$transaction(async (tx) => {
      const dibuat = await tx.storeProposal.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          contactName: data.contactName,
          termsType: data.termsType,
          groupId: data.groupId,
          lat: data.lat === null ? null : new Prisma.Decimal(data.lat),
          lng: data.lng === null ? null : new Prisma.Decimal(data.lng),
          photoUrl: data.photoUrl,
          note: data.note,
          proposedById: input.userId,
          status: "PENDING",
          idempotencyKey: kunci,
        },
        select: { id: true },
      });
      notifikasi = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_USULAN_TOKO,
          severity: "INFO",
          title: `Usulan toko baru: ${data.name}`,
          message: `Salesman mengusulkan toko baru "${data.name}". Tinjau di Master Toko → Usulan toko baru.`,
          metadata: { storeProposalId: dibuat.id },
        },
      });
      return dibuat.id;
    });
    // Di luar transaksi dan tidak ditunggu: pengiriman push memanggil jaringan,
    // dan salesman sedang menatap pemutar di HP dengan sinyal pas-pasan.
    if (notifikasi) void fanOutAdminNotification(notifikasi);
    return { ok: true, id, ulang: false };
  } catch (e) {
    // Dua kiriman dengan kunci yang sama berpacu: yang kalah membaca pemenangnya.
    if (unikBentrok(e)) {
      const pemenang = await prisma.storeProposal.findUnique({
        where: { idempotencyKey: kunci },
        select: { id: true, proposedById: true },
      });
      if (pemenang) {
        return pemenang.proposedById === input.userId
          ? { ok: true, id: pemenang.id, ulang: true }
          : { ok: false, code: "KUNCI_MILIK_LAIN" };
      }
    }
    throw e;
  }
}

export type KodeGagalSetujui =
  | GalatPersetujuan
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "KODE_DIPAKAI"
  | "AREA_TIDAK_ADA"
  | "PEMEGANG_TIDAK_ADA";

export type HasilSetujui = { ok: true; storeId: string } | { ok: false; code: KodeGagalSetujui };

/** Dilempar di dalam transaksi supaya toko yang sudah dibuat ikut dibatalkan. */
class BatalSetujui extends Error {
  constructor(readonly code: KodeGagalSetujui) {
    super(code);
  }
}

/**
 * Setujui usulan: buat tokonya dan tandai usulan DISETUJUI — satu transaksi.
 *
 * Penanda status memakai compare-and-swap (`updateMany … where status PENDING`):
 * dua admin yang menekan Setujui bersamaan tidak boleh menghasilkan dua toko.
 * Yang kalah melempar, dan toko yang terlanjur dibuatnya ikut dibatalkan.
 *
 * Toko dibuat di sini, bukan lewat `createStore`, karena pembuatan itu harus
 * berada di transaksi yang sama dengan penanda usulan dan jejaknya.
 */
export async function setujuiUsulanToko(input: {
  proposalId: string;
  reviewerId: string;
  masukan: MasukanPersetujuan;
}): Promise<HasilSetujui> {
  const v = validasiPersetujuan(input.masukan);
  if (!v.ok) return { ok: false, code: v.galat[0] };
  const isian = v.data;

  let pengusul: { id: string; name: string } | null = null;
  let storeId: string;
  try {
    storeId = await runSerializable(async (tx) => {
      pengusul = null;
      const usulan = await tx.storeProposal.findUnique({ where: { id: input.proposalId } });
      if (!usulan) throw new BatalSetujui("TIDAK_DITEMUKAN");
      if (usulan.status !== "PENDING") throw new BatalSetujui("SUDAH_DIPUTUSKAN");

      // Berurutan, bukan Promise.all: satu transaksi interaktif = satu koneksi.
      if ((await tx.store.count({ where: { code: isian.code } })) > 0) throw new BatalSetujui("KODE_DIPAKAI");
      // Tanpa foreign key (`relationMode = "prisma"`), id yang salah tersimpan
      // diam-diam dan tokonya lenyap dari saringan area/pemegang.
      if (isian.groupId && (await tx.storeGroup.count({ where: { id: isian.groupId } })) === 0) {
        throw new BatalSetujui("AREA_TIDAK_ADA");
      }
      if (isian.salesmanId && (await tx.user.count({ where: { id: isian.salesmanId } })) === 0) {
        throw new BatalSetujui("PEMEGANG_TIDAK_ADA");
      }

      const toko = await tx.store.create({
        data: {
          code: isian.code,
          name: isian.name,
          address: isian.address,
          phone: isian.phone,
          contactName: isian.contactName,
          termsType: isian.termsType,
          paymentTempo: isian.paymentTempo,
          marginPercent: isian.marginPercent === null ? null : new Prisma.Decimal(isian.marginPercent),
          lat: usulan.lat,
          lng: usulan.lng,
          isPkp: isian.isPkp,
          groupId: isian.groupId,
          salesmanId: isian.salesmanId,
        },
        select: { id: true },
      });

      const ditandai = await tx.storeProposal.updateMany({
        where: { id: usulan.id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: input.reviewerId, reviewedAt: new Date(), storeId: toko.id, reviewNote: null },
      });
      if (ditandai.count !== 1) throw new BatalSetujui("SUDAH_DIPUTUSKAN");

      // Isian yang dirapikan admin — tanpa ini, perbedaan antara usulan lapangan
      // dan toko yang terdaftar tidak tercatat di mana pun.
      const dirapikan: Record<string, { usulan: string | null; toko: string | null }> = {};
      for (const kolom of ["name", "address", "phone", "contactName"] as const) {
        if ((usulan[kolom] ?? null) !== isian[kolom]) dirapikan[kolom] = { usulan: usulan[kolom] ?? null, toko: isian[kolom] };
      }

      await tx.auditLog.create({
        data: {
          userId: input.reviewerId,
          action: AKSI_USULAN_TOKO.TOKO_DIBUAT,
          entityType: "Store",
          entityId: toko.id,
          changes: {
            after: {
              code: isian.code,
              name: isian.name,
              address: isian.address,
              phone: isian.phone,
              contactName: isian.contactName,
              termsType: isian.termsType,
              paymentTempo: isian.paymentTempo,
              marginPercent: isian.marginPercent,
              isPkp: isian.isPkp,
              groupId: isian.groupId,
              salesmanId: isian.salesmanId,
              lat: usulan.lat === null ? null : usulan.lat.toNumber(),
              lng: usulan.lng === null ? null : usulan.lng.toNumber(),
            },
          },
          metadata: { storeProposalId: usulan.id, proposedById: usulan.proposedById },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: input.reviewerId,
          action: AKSI_USULAN_TOKO.DISETUJUI,
          entityType: "StoreProposal",
          entityId: usulan.id,
          changes: { before: { status: "PENDING" }, after: { status: "APPROVED", storeId: toko.id } },
          metadata: { dirapikan },
        },
      });
      // Pemegang pertama juga perpindahan pemegang: riwayat siapa memegang toko
      // mana hanya hidup di jejak ini, mulai dari hari toko itu ada.
      await gantiPemegangToko(tx, { storeId: toko.id, sebelum: null, sesudah: isian.salesmanId, olehUserId: input.reviewerId });

      pengusul = { id: usulan.proposedById, name: isian.name };
      return toko.id;
    });
  } catch (e) {
    if (e instanceof BatalSetujui) return { ok: false, code: e.code };
    if (unikBentrok(e)) return { ok: false, code: "KODE_DIPAKAI" };
    throw e;
  }

  const p = pengusul as { id: string; name: string } | null;
  if (p && p.id !== input.reviewerId) {
    void kabariPengguna(p.id, {
      jenis: JENIS_KABAR.TOKO_BARU_DISETUJUI,
      judul: `Toko baru ${p.name} disetujui`,
      isi: `Sudah terdaftar dengan kode ${isian.code}. Anda sudah bisa check-in di toko ini.`,
      data: { storeId, proposalId: input.proposalId },
    });
  }
  return { ok: true, storeId };
}

export type HasilTolak =
  | { ok: true }
  | { ok: false; code: "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" | "TIDAK_DITEMUKAN" | "SUDAH_DIPUTUSKAN" };

/** Tolak usulan. Alasannya wajib — itulah satu-satunya yang dibaca salesman di HP. */
export async function tolakUsulanToko(input: {
  proposalId: string;
  reviewerId: string;
  alasan: string;
}): Promise<HasilTolak> {
  const alasan = input.alasan.trim();
  if (alasan === "") return { ok: false, code: "ALASAN_WAJIB" };
  if (alasan.length > BATAS_USULAN.alasan) return { ok: false, code: "ALASAN_TERLALU_PANJANG" };

  const hasil = await prisma.$transaction(async (tx) => {
    const usulan = await tx.storeProposal.findUnique({
      where: { id: input.proposalId },
      select: { id: true, status: true, name: true, proposedById: true },
    });
    if (!usulan) return { ok: false as const, code: "TIDAK_DITEMUKAN" as const };
    const ditandai = await tx.storeProposal.updateMany({
      where: { id: usulan.id, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: input.reviewerId, reviewedAt: new Date(), reviewNote: alasan },
    });
    if (ditandai.count !== 1) return { ok: false as const, code: "SUDAH_DIPUTUSKAN" as const };
    await tx.auditLog.create({
      data: {
        userId: input.reviewerId,
        action: AKSI_USULAN_TOKO.DITOLAK,
        entityType: "StoreProposal",
        entityId: usulan.id,
        changes: { before: { status: usulan.status }, after: { status: "REJECTED" } },
        reason: alasan,
      },
    });
    return { ok: true as const, pengusul: usulan.proposedById, nama: usulan.name };
  });
  if (!hasil.ok) return hasil;

  if (hasil.pengusul !== input.reviewerId) {
    void kabariPengguna(hasil.pengusul, {
      jenis: JENIS_KABAR.TOKO_BARU_DITOLAK,
      judul: `Usulan toko ${hasil.nama} ditolak`,
      isi: `Alasan: ${alasan}`,
      data: { proposalId: input.proposalId },
    });
  }
  return { ok: true };
}
