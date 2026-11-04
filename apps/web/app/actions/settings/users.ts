"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { runSerializable } from "@/lib/db/tx-retry";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  perannyaSpg,
  rapikanEmail,
  tolakAkunSistem,
  validasiPengguna,
  type KodeAkunSistem,
  type KodeValidasi,
} from "@/lib/users/validasi";
import { peranLamaDari } from "@/lib/users/peran-lama";
import { periksaMulaiSpg, tolakPerubahanSpg, type KodeTolakMulai } from "@/lib/users/spg-berhenti";
import { adaRiwayatSpg, aturMulaiSpgDalamTx } from "@/lib/users/spg-berhenti-writer";

/**
 * Tambah dan ubah akun pengguna (sales, SPG, admin, …) dari Pengaturan.
 *
 * Dijaga `settings_security:manage` — izin yang sama dengan mengganti peran
 * pengguna. Sandi hanya pernah disimpan sebagai hash bcrypt dan tidak pernah
 * dikembalikan ke layar. Setiap perubahan menulis jejak audit TANPA sandi.
 *
 * Akun dan peran sistem (izin penuh) hanya boleh disentuh admin sistem —
 * dibaca dari peran pelaku di basis data, bukan dari '*' di JWT, supaya admin
 * yang sudah diturunkan perannya tidak tetap berkuasa sampai sesinya habis.
 *
 * Kolom peran lama (`User.role`) ditulis bersama `roleId` di transaksi yang
 * sama, diturunkan dari peran baru (`peranLamaDari`), dan ikut jejak sebagai
 * `legacyRole`. Dulu hanya Akun Profil yang mengisinya, jadi admin yang
 * diangkat di sini tetap USER di kolom itu dan admin yang diturunkan tetap ADMIN.
 *
 * SPG (keputusan pemilik 2026-11-02, P66, dan fakta "SPG tidak mungkin pindah
 * toko"): SPG yang sudah punya riwayat di tokonya tidak dipindah toko atau diganti
 * perannya lewat formulir ini (`SPG_GUNAKAN_BERHENTI` — pakai "SPG berhenti"); SPG
 * yang sudah berhenti tidak wajib punya toko tetap, dan tokonya hanya kembali lewat
 * "Batalkan berhenti" (`BERHENTI_BATALKAN_DULU`). Aturannya satu dengan
 * `lib/users/spg-berhenti.ts`. Riwayatnya (`adaRiwayatSpg`) dibaca lewat transaksi yang
 * sama dengan penulisan toko dan peran, supaya check-in atau penjualan pertama yang masuk
 * di sela-selanya tidak lolos dari penjaga itu.
 *
 * Tanggal mulai bekerja SPG (`spgStartedOn`, P62; perbaikan peserta gaji B20): WAJIB
 * diisi (`MULAI_WAJIB`) setiap kali formulir ini menyimpan peran SPG dengan toko tetap
 * untuk akun yang belum punya tanggal itu — tanpa tanggal, SPG yang belum punya jadwal,
 * penjualan, atau catatan hadir tidak masuk peserta gaji mana pun, jadi tidak ada yang
 * menahan atau mengingatkan pembayarannya. Aturannya tidak disalin di sini:
 * - akun baru: `periksaMulaiSpg` dengan kegiatan pertama kosong — akun yang belum ada
 *   belum punya check-in, penjualan, atau gaji yang dibayar, jadi hanya keabsahan
 *   tanggalnya yang berlaku; tanggalnya ikut ditulis saat akun dibuat dan masuk jejak
 *   `USER_CREATED`;
 * - akun lama: penulisnya sendiri, `aturMulaiSpgDalamTx` (penjaga yang sama dengan tombol
 *   "Atur tanggal mulai": tidak sesudah check-in/penjualan pertama di toko itu, terkunci
 *   begitu ada gaji dibayar, jejak `USER_UPDATED` sebelum/sesudah), di transaksi yang sama
 *   dengan penyimpanan akunnya. Ditolak → seluruh penyimpanan dibatalkan.
 * Tanggal yang sudah tersimpan tidak pernah ditimpa dari sini (isian `mulai` diabaikan);
 * mengubahnya tetap lewat "Atur tanggal mulai". SPG yang sudah berhenti tidak punya toko
 * tetap, jadi tidak dimintai tanggal itu di sini.
 */

export type KodeSimpanPengguna =
  | KodeValidasi
  | KodeAkunSistem
  | "FORBIDDEN"
  | "VALIDATION"
  | "PERAN_TIDAK_DITEMUKAN"
  | "TOKO_TIDAK_DITEMUKAN"
  | "EMAIL_DIPAKAI"
  | "TIDAK_DITEMUKAN"
  | "PERAN_SENDIRI"
  | "SPG_GUNAKAN_BERHENTI"
  | "BERHENTI_BATALKAN_DULU"
  | "MULAI_WAJIB"
  | "MULAI_TIDAK_SAH"
  | "MULAI_SESUDAH_KEGIATAN"
  | "MULAI_TERKUNCI";

/**
 * Kode tolak aturan tanggal mulai → kode formulir ini. `BUKAN_SPG` tidak terjadi di sini
 * (penulisnya dipanggil sesudah toko tetap tertulis), dipetakan ke "tidak ditemukan".
 */
const KODE_MULAI: Record<KodeTolakMulai, KodeSimpanPengguna> = {
  TANGGAL_TIDAK_SAH: "MULAI_TIDAK_SAH",
  MULAI_SESUDAH_KEGIATAN: "MULAI_SESUDAH_KEGIATAN",
  MULAI_TERKUNCI: "MULAI_TERKUNCI",
  BUKAN_SPG: "TIDAK_DITEMUKAN",
};

/** Dilempar di dalam transaksi supaya penyimpanan akun yang sudah ditulis ikut dibatalkan. */
class TolakSimpanPengguna extends Error {
  constructor(readonly kode: KodeSimpanPengguna) {
    super(kode);
    this.name = "TolakSimpanPengguna";
  }
}

export type HasilSimpanPengguna = { ok: true; id: string } | { ok: false; codes: KodeSimpanPengguna[] };

const schema = z.object({
  id: z.string().min(1).nullable(),
  nama: z.string().max(191),
  email: z.string().max(191),
  roleId: z.string().min(1),
  tokoId: z.string().min(1).nullable(),
  sandi: z.string().max(200),
  ulangSandi: z.string().max(200),
  mulai: z.string().max(32).nullable().optional(),
});

export async function simpanPenggunaAction(input: unknown): Promise<HasilSimpanPengguna> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE)) {
    return { ok: false, codes: ["FORBIDDEN"] };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, codes: ["VALIDATION"] };
  const d = parsed.data;
  const baru = d.id === null;

  const [peran, pelaku, lama] = await Promise.all([
    prisma.roleDefinition.findUnique({
      where: { id: d.roleId },
      select: { id: true, name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { roleDefinition: { select: { isSystem: true } } } }),
    baru
      ? null
      : prisma.user.findUnique({
          where: { id: d.id as string },
          select: {
            name: true,
            email: true,
            roleId: true,
            assignedStoreId: true,
            spgEndedOn: true,
            roleDefinition: { select: { isSystem: true } },
          },
        }),
  ]);
  if (!peran) return { ok: false, codes: ["PERAN_TIDAK_DITEMUKAN"] };
  if (!baru && !lama) return { ok: false, codes: ["TIDAK_DITEMUKAN"] };

  const pelakuSistem = pelaku?.roleDefinition?.isSystem === true;
  const tolak = tolakAkunSistem({
    pelakuSistem,
    targetSistem: lama?.roleDefinition?.isSystem === true,
    peranSistem: peran.isSystem,
  });
  if (tolak) return { ok: false, codes: [tolak] };

  // Admin yang mengganti perannya sendiri bisa terkunci keluar dari halaman ini.
  if (!baru && d.id === session.user.id && lama?.roleId !== peran.id) return { ok: false, codes: ["PERAN_SENDIRI"] };

  const butuhToko = perannyaSpg(
    peran.permissions.map((p) => p.permission.code),
    peran.isSystem,
  );

  // SPG yang sudah berhenti tidak wajib punya toko tetap: tokonya dilepas saat ditandai berhenti
  // (dibaca ulang di dalam transaksi di bawah).
  const berhentiAwal = lama?.spgEndedOn != null;
  const galat = validasiPengguna({
    baru,
    nama: d.nama,
    email: d.email,
    sandi: d.sandi,
    ulangSandi: d.ulangSandi,
    butuhToko: butuhToko && !berhentiAwal,
    tokoId: d.tokoId,
  });
  if (galat.length) return { ok: false, codes: galat };

  const tokoId = butuhToko ? d.tokoId : null;
  if (tokoId) {
    const toko = await prisma.store.count({ where: { id: tokoId, isActive: true } });
    if (!toko) return { ok: false, codes: ["TOKO_TIDAK_DITEMUKAN"] };
  }

  const isianMulai = d.mulai?.trim() ? d.mulai.trim() : null;
  // Akun baru: diperiksa di sini, sebelum apa pun ditulis (akun lama: di dalam transaksinya).
  let mulaiBaru: string | null = null;
  if (baru && tokoId) {
    if (!isianMulai) return { ok: false, codes: ["MULAI_WAJIB"] };
    const m = periksaMulaiSpg({ mulai: isianMulai, kegiatanPertama: null });
    if (!m.ok) return { ok: false, codes: [KODE_MULAI[m.kode]] };
    mulaiBaru = m.mulai;
  }

  const email = rapikanEmail(d.email);
  const nama = d.nama.trim();
  const sandiBaru = d.sandi !== "";
  const passwordHash = sandiBaru ? await bcrypt.hash(d.sandi, 10) : undefined;
  const peranLama = peranLamaDari(peran);

  try {
    if (baru) {
      const dibuat = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { name: nama, email, role: peranLama, roleId: peran.id, assignedStoreId: tokoId, spgStartedOn: mulaiBaru, passwordHash },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "USER_CREATED",
            entityType: "User",
            entityId: u.id,
            changes: {
              after: {
                name: nama,
                email,
                role: peran.name,
                legacyRole: peranLama,
                assignedStoreId: tokoId,
                ...(mulaiBaru ? { spgStartedOn: mulaiBaru } : {}),
              },
            },
          },
        });
        return u;
      });
      revalidatePath("/backoffice/settings/users");
      return { ok: true, id: dibuat.id };
    }

    const id = d.id as string;
    // Peran target dibaca ulang DI DALAM transaksi serializable: akun yang baru
    // saja diangkat menjadi admin oleh orang lain tidak boleh tertimpa oleh
    // pemeriksaan yang dibaca sebelum pengangkatan itu.
    const hasil = await runSerializable(async (tx): Promise<KodeSimpanPengguna | null> => {
      const sebelum = await tx.user.findUnique({
        where: { id },
        select: {
          name: true,
          email: true,
          role: true,
          roleId: true,
          assignedStoreId: true,
          spgStartedOn: true,
          spgEndedOn: true,
          roleDefinition: { select: { isSystem: true, permissions: { select: { permission: { select: { code: true } } } } } },
        },
      });
      if (!sebelum) return "TIDAK_DITEMUKAN";
      const tolakKini = tolakAkunSistem({
        pelakuSistem,
        targetSistem: sebelum.roleDefinition?.isSystem === true,
        peranSistem: peran.isSystem,
      });
      if (tolakKini) return tolakKini;

      // Keadaan SPG dibaca di sini, bukan dari bacaan di luar transaksi: penanda berhenti dan
      // pembatalannya ditulis lewat jalurnya sendiri (`settings/spg-berhenti.ts`).
      const berhenti = sebelum.spgEndedOn != null;
      if (butuhToko && !berhenti && !tokoId) return "TOKO_WAJIB";
      const spgLama = perannyaSpg(
        (sebelum.roleDefinition?.permissions ?? []).map((p) => p.permission.code),
        sebelum.roleDefinition?.isSystem === true,
      );
      const tokoLama = sebelum.assignedStoreId;
      const riwayatPenting = !berhenti && spgLama && tokoLama !== null && (!butuhToko || tokoId !== tokoLama);
      const tolakSpg = tolakPerubahanSpg({
        berhenti,
        adaRiwayat: riwayatPenting ? await adaRiwayatSpg(id, tokoLama as string, tx) : false,
        tokoLama,
        tokoBaru: tokoId,
        spgLama,
        spgBaru: butuhToko,
      });
      if (tolakSpg) return tolakSpg;
      // Tanggal mulai diperiksa dan ditulis oleh penulisnya sendiri sesudah toko tetap tertulis
      // (ia membaca toko dari akunnya); tanggal yang sudah ada tidak disentuh.
      const butuhMulai = tokoId !== null && !berhenti && sebelum.spgStartedOn === null;
      if (butuhMulai && !isianMulai) return "MULAI_WAJIB";

      // Selalu ditulis, juga bila perannya tidak berganti: menyimpan akun sekali
      // membetulkan kolom lama yang basi dari sebelum Pengguna ikut mengisinya.
      await tx.user.update({
        where: { id },
        data: { name: nama, email, role: peranLama, roleId: peran.id, assignedStoreId: tokoId, ...(passwordHash ? { passwordHash } : {}) },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: id,
          changes: {
            before: {
              name: sebelum.name,
              email: sebelum.email,
              roleId: sebelum.roleId,
              legacyRole: sebelum.role,
              assignedStoreId: sebelum.assignedStoreId,
            },
            after: { name: nama, email, roleId: peran.id, legacyRole: peranLama, assignedStoreId: tokoId },
          },
          metadata: { sandiDiganti: sandiBaru },
        },
      });
      if (butuhMulai) {
        const m = await aturMulaiSpgDalamTx(tx, { userId: id, mulai: isianMulai, olehUserId: session.user.id });
        if (!m.ok) throw new TolakSimpanPengguna(KODE_MULAI[m.kode]);
      }
      return null;
    });
    if (hasil) return { ok: false, codes: [hasil] };
    revalidatePath("/backoffice/settings/users");
    return { ok: true, id };
  } catch (err) {
    if (err instanceof TolakSimpanPengguna) return { ok: false, codes: [err.kode] };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, codes: ["EMAIL_DIPAKAI"] };
    }
    throw err;
  }
}
