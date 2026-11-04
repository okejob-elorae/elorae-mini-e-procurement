import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { kunciTersedia } from "./data-sensitif";
import {
  bacaRiwayatPengiriman,
  bandingkanFormulir,
  HARI_BERLAKU_FORMULIR,
  periksaIsianFormulir,
  samaNilaiFormulir,
  teksKolom,
  type DataKolSekarang,
  type GalatFormulir,
  type IsianFormulirKol,
  type KolomFormulir,
  type KolomSensitifFormulir,
  type PerubahanFormulir,
  type RiwayatPengiriman,
} from "./formulir-kol-aturan";
import { bacaProfilUkuran, tulisProfilUkuran, type ProfilUkuran } from "./kol-aturan";
import { rapikanIsiSensitif, simpanDataSensitifKolDiTx } from "./pajak-kol-writer";
import { bentukTokenSah, buatToken, hashRahasia } from "./pantau-token";
import { normalisasiWa } from "./wa";

/*
 * Formulir data KOL lewat link — KHUSUS SERVER. Rancangan
 * `docs/superpowers/specs/2026-10-09-formulir-data-kol-design.md`, aturan murni di
 * `formulir-kol-aturan.ts`.
 *
 * Pemilik 2026-10-09: isian KOL LANGSUNG MASUK; kolom yang menimpa isian kantor
 * ditandai untuk dicek dan nilai lamanya bisa dikembalikan. Kolom `Kol` ditulis
 * langsung — BUKAN lewat `simpanProfilKolDiTx`, yang menghapus akun yang tidak
 * ikut dikirim. `AuditLog.userId` wajib, jadi jejak kiriman KOL atas nama
 * pembuat link (seperti portal toko atas nama salesnya).
 */

type Klien = Prisma.TransactionClient;

export const SUMBER_FORMULIR = "FORMULIR_KOL";
export const SUMBER_KEMBALIKAN = "KEMBALIKAN_FORMULIR";
const HARI_MS = 86_400_000;

/* ─────────────────────────── link ─────────────────────────── */

export type HasilBuatLink =
  | { ok: true; linkId: string; token: string; berlakuSampai: Date }
  | { ok: false; kode: "TIDAK_DITEMUKAN" | "KOL_DIBLOKIR" };

/** Link baru untuk satu KOL; link aktif lain milik KOL itu dicabut. Token mentah hanya dikembalikan di sini. */
export async function buatLinkFormulirKol(input: { kolId: string; olehUserId: string; sekarang?: Date }): Promise<HasilBuatLink> {
  const sekarang = input.sekarang ?? new Date();
  const { token, tokenHash } = buatToken();
  return runSerializable(async (tx): Promise<HasilBuatLink> => {
    const kol = await tx.kol.findUnique({ where: { id: input.kolId }, select: { id: true, name: true, blockedAt: true } });
    if (!kol) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (kol.blockedAt) return { ok: false, kode: "KOL_DIBLOKIR" };
    const lama = await tx.kolFormLink.findMany({ where: { kolId: kol.id, revokedAt: null, expiresAt: { gt: sekarang } }, select: { id: true } });
    if (lama.length) await tx.kolFormLink.updateMany({ where: { id: { in: lama.map((l) => l.id) } }, data: { revokedAt: sekarang } });
    const berlakuSampai = new Date(sekarang.getTime() + HARI_BERLAKU_FORMULIR * HARI_MS);
    const link = await tx.kolFormLink.create({
      data: { kolId: kol.id, tokenHash, createdById: input.olehUserId, expiresAt: berlakuSampai, createdAt: sekarang },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.FORMULIR_KOL_LINK_DIBUAT,
      entityType: "Kol",
      entityId: kol.id,
      // Tanpa token maupun hash-nya.
      metadata: { kol: kol.name, linkId: link.id, berlakuSampai: berlakuSampai.toISOString(), linkLamaDicabut: lama.length },
    });
    return { ok: true, linkId: link.id, token, berlakuSampai };
  });
}

export async function cabutLinkFormulirKol(input: { linkId: string; olehUserId: string; sekarang?: Date }): Promise<{ ok: true } | { ok: false; kode: "TIDAK_DITEMUKAN" | "SUDAH_DICABUT" }> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx) => {
    const link = await tx.kolFormLink.findUnique({ where: { id: input.linkId }, select: { id: true, kolId: true, revokedAt: true } });
    if (!link) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (link.revokedAt) return { ok: false as const, kode: "SUDAH_DICABUT" as const };
    await tx.kolFormLink.update({ where: { id: link.id }, data: { revokedAt: sekarang } });
    await catatJejak(tx, { userId: input.olehUserId, action: JEJAK.FORMULIR_KOL_LINK_DICABUT, entityType: "Kol", entityId: link.kolId, metadata: { linkId: link.id } });
    return { ok: true as const };
  });
}

export type AksesFormulir = { linkId: string; kolId: string; createdById: string; berlakuSampai: Date };

async function bukaDiKlien(db: Klien | typeof prisma, token: unknown, sekarang: Date): Promise<AksesFormulir | null> {
  if (!bentukTokenSah(token)) return null;
  const link = await db.kolFormLink.findUnique({ where: { tokenHash: hashRahasia(token) } });
  if (!link || link.revokedAt || link.expiresAt.getTime() <= sekarang.getTime()) return null;
  const kol = await db.kol.findUnique({ where: { id: link.kolId }, select: { id: true, blockedAt: true } });
  if (!kol || kol.blockedAt) return null;
  return { linkId: link.id, kolId: link.kolId, createdById: link.createdById, berlakuSampai: link.expiresAt };
}

/** Buka link dari halaman publik. Semua sebab gagal (tidak dikenal, dicabut, kedaluwarsa, KOL diblokir) SATU jawaban. */
export async function bukaLinkFormulirKol(token: unknown, sekarang: Date = new Date()): Promise<AksesFormulir | null> {
  return bukaDiKlien(prisma, token, sekarang);
}

/* ─────────────────────────── halaman publik ─────────────────────────── */

export type DataFormulirPublik = {
  namaKol: string;
  berlakuSampai: string;
  isian: Pick<
    IsianFormulirKol,
    "recipientName" | "phone" | "email" | "address" | "city" | "province" | "postalCode" | "atasan" | "bawahan" | "tinggi" | "hijab" | "catatanFit"
  >;
  /** Hanya tanda "sudah tersimpan" — isi rekening/NIK/NPWP TIDAK PERNAH dikirim ke halaman publik. */
  tersimpan: { rekeningAkhir: string | null; nikAkhir: string | null; npwp: boolean };
  /** Bagian rekening/NIK/NPWP disembunyikan bila server tidak punya kunci enkripsi. */
  bolehSensitif: boolean;
};

export async function dataFormulirPublik(akses: AksesFormulir): Promise<DataFormulirPublik | null> {
  const k = await prisma.kol.findUnique({
    where: { id: akses.kolId },
    select: {
      name: true,
      recipientName: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      province: true,
      postalCode: true,
      sizeProfile: true,
      bankLast4: true,
      bankAccountEnc: true,
      nikLast4: true,
      npwpEnc: true,
    },
  });
  if (!k) return null;
  const u = bacaProfilUkuran(k.sizeProfile);
  return {
    namaKol: k.name,
    berlakuSampai: akses.berlakuSampai.toISOString(),
    isian: {
      recipientName: k.recipientName ?? "",
      phone: k.phone ?? "",
      email: k.email ?? "",
      address: k.address ?? "",
      city: k.city ?? "",
      province: k.province ?? "",
      postalCode: k.postalCode ?? "",
      atasan: u.atasan ?? "",
      bawahan: u.bawahan ?? "",
      tinggi: u.tinggiCm === null ? "" : String(u.tinggiCm),
      hijab: u.hijab === null ? "" : u.hijab ? "ya" : "tidak",
      catatanFit: u.catatan ?? "",
    },
    tersimpan: {
      rekeningAkhir: k.bankAccountEnc ? (k.bankLast4 ?? "") : null,
      nikAkhir: k.nikLast4,
      npwp: Boolean(k.npwpEnc),
    },
    bolehSensitif: kunciTersedia(),
  };
}

/** Tandai link dipakai (dibuka) — paling sering sekali per 5 menit; tidak pernah melempar. */
export async function catatLinkDibuka(linkId: string, sekarang: Date = new Date()): Promise<void> {
  try {
    await prisma.kolFormLink.updateMany({
      where: { id: linkId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(sekarang.getTime() - 5 * 60_000) } }] },
      data: { lastUsedAt: sekarang },
    });
  } catch (e) {
    console.error("[formulir KOL] gagal mencatat link dibuka:", e);
  }
}

/* ─────────────────────────── kiriman ─────────────────────────── */

export type HasilKirimFormulir =
  | { ok: true; berubah: number }
  | { ok: false; kode: "TIDAK_BERLAKU" | "KUNCI_TIDAK_ADA" }
  | { ok: false; kode: "ISIAN_TIDAK_SAH"; galat: GalatFormulir };

function dataSekarang(k: {
  recipientName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  sizeProfile: string | null;
}): DataKolSekarang {
  return {
    recipientName: k.recipientName,
    phone: k.phone,
    email: k.email,
    address: k.address,
    city: k.city,
    province: k.province,
    postalCode: k.postalCode,
    ukuran: bacaProfilUkuran(k.sizeProfile),
  };
}

const KOLOM_UKURAN: Partial<Record<KolomFormulir, keyof ProfilUkuran>> = {
  atasan: "atasan",
  bawahan: "bawahan",
  tinggiCm: "tinggiCm",
  hijab: "hijab",
  catatanFit: "catatan",
};

/** Teks riwayat → nilai kolom profil ukuran. */
function nilaiUkuran(kolom: KolomFormulir, teks: string | null): ProfilUkuran[keyof ProfilUkuran] {
  if (teks === null) return null;
  if (kolom === "tinggiCm") return Number(teks);
  if (kolom === "hijab") return teks === "ya";
  return teks;
}

/**
 * Data kolom `Kol` + jejak sebelum/sesudah untuk serangkaian nilai teks per kolom. Dipakai kiriman
 * formulir dan "Kembalikan".
 */
function susunPerubahanKol(sekarang: { sizeProfile: string | null }, nilai: Partial<Record<KolomFormulir, string | null>>) {
  const data: Prisma.KolUpdateInput = {};
  let ukuran: ProfilUkuran | null = null;
  for (const [kolom, teks] of Object.entries(nilai) as [KolomFormulir, string | null][]) {
    const kUkuran = KOLOM_UKURAN[kolom];
    if (kUkuran) {
      ukuran ??= bacaProfilUkuran(sekarang.sizeProfile);
      (ukuran as Record<keyof ProfilUkuran, unknown>)[kUkuran] = nilaiUkuran(kolom, teks);
      continue;
    }
    if (kolom === "phone") {
      data.phone = teks;
      data.waNormal = normalisasiWa(teks);
      continue;
    }
    (data as Record<string, unknown>)[kolom] = teks;
  }
  if (ukuran) data.sizeProfile = tulisProfilUkuran(ukuran);
  return data;
}

export async function kirimFormulirKol(input: { token: unknown; isian: IsianFormulirKol; sekarang?: Date }): Promise<HasilKirimFormulir> {
  const sekarang = input.sekarang ?? new Date();
  const periksa = periksaIsianFormulir(input.isian);
  if (!periksa.ok) return { ok: false, kode: "ISIAN_TIDAK_SAH", galat: periksa.galat };
  const nilai = periksa.nilai;

  const kolomSensitif = Object.keys(nilai.sensitif) as KolomSensitifFormulir[];
  let rapiSensitif: Partial<Record<KolomSensitifFormulir, string | null>> | null = null;
  if (kolomSensitif.length) {
    const r = rapikanIsiSensitif(nilai.sensitif);
    if (!r.ok) {
      if (r.kode === "KUNCI_TIDAK_ADA") return { ok: false, kode: "KUNCI_TIDAK_ADA" };
      return { ok: false, kode: "ISIAN_TIDAK_SAH", galat: r.kolom ? { [r.kolom]: r.kode } : {} };
    }
    rapiSensitif = r.rapi;
  }

  return runSerializable(async (tx): Promise<HasilKirimFormulir> => {
    const akses = await bukaDiKlien(tx, input.token, sekarang);
    if (!akses) return { ok: false, kode: "TIDAK_BERLAKU" };
    const k = await tx.kol.findUniqueOrThrow({
      where: { id: akses.kolId },
      select: {
        name: true,
        recipientName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        province: true,
        postalCode: true,
        sizeProfile: true,
        adaNpwp: true,
      },
    });
    const perubahan = bandingkanFormulir(dataSekarang(k), nilai);

    // Rekening/NIK/NPWP lebih dulu: penolakannya kembali sebelum kolom lain ditulis.
    if (rapiSensitif) {
      const s = await simpanDataSensitifKolDiTx(tx, { kolId: akses.kolId, rapi: rapiSensitif, olehUserId: akses.createdById, sumber: SUMBER_FORMULIR });
      if (!s.ok) return s.kode === "KUNCI_TIDAK_ADA" ? { ok: false, kode: "KUNCI_TIDAK_ADA" } : { ok: false, kode: "ISIAN_TIDAK_SAH", galat: s.kolom ? { [s.kolom]: s.kode } : {} };
    }

    if (perubahan.length) {
      const nilaiBaru = Object.fromEntries(perubahan.map((p) => [p.kolom, p.sesudah])) as Partial<Record<KolomFormulir, string>>;
      await tx.kol.update({ where: { id: akses.kolId }, data: susunPerubahanKol(k, nilaiBaru) });
      await catatJejak(tx, {
        userId: akses.createdById,
        action: JEJAK.KOL_DIUBAH,
        entityType: "Kol",
        entityId: akses.kolId,
        changes: {
          before: Object.fromEntries(perubahan.map((p) => [p.kolom, p.sebelum])),
          after: Object.fromEntries(perubahan.map((p) => [p.kolom, p.sesudah])),
        },
        metadata: { sumber: SUMBER_FORMULIR, linkId: akses.linkId },
      });
    }

    await tx.kolFormLink.update({ where: { id: akses.linkId }, data: { lastUsedAt: sekarang } });
    if (!perubahan.length && !kolomSensitif.length) return { ok: true, berubah: 0 };

    const riwayat: RiwayatPengiriman = { perubahan, sensitif: kolomSensitif, npwpBaru: Boolean(nilai.sensitif.npwp) && !k.adaNpwp };
    await tx.kolFormSubmission.create({
      data: {
        linkId: akses.linkId,
        kolId: akses.kolId,
        submittedAt: sekarang,
        changes: JSON.stringify(riwayat),
        replacedCount: perubahan.filter((p) => p.menimpa).length,
      },
    });
    return { ok: true, berubah: perubahan.length + kolomSensitif.length };
  });
}

/* ─────────────────────────── pemeriksaan kantor ─────────────────────────── */

export async function tandaiKirimanDicek(input: {
  submissionId: string;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true } | { ok: false; kode: "TIDAK_DITEMUKAN" | "SUDAH_DICEK" }> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx) => {
    const s = await tx.kolFormSubmission.findUnique({ where: { id: input.submissionId }, select: { id: true, kolId: true, reviewedAt: true } });
    if (!s) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (s.reviewedAt) return { ok: false as const, kode: "SUDAH_DICEK" as const };
    await tx.kolFormSubmission.update({ where: { id: s.id }, data: { reviewedAt: sekarang, reviewedById: input.olehUserId } });
    await catatJejak(tx, { userId: input.olehUserId, action: JEJAK.FORMULIR_KOL_DICEK, entityType: "Kol", entityId: s.kolId, metadata: { submissionId: s.id } });
    return { ok: true as const };
  });
}

/**
 * Kembalikan satu kolom yang ditimpa KOL ke nilai kantor sebelumnya. Ditolak bila kolom itu sudah
 * berubah lagi sesudah kiriman (`BERUBAH_LAGI`) — tidak menimpa koreksi yang lebih baru.
 */
export async function kembalikanKolomKiriman(input: {
  submissionId: string;
  kolom: KolomFormulir;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; kode: "TIDAK_DITEMUKAN" | "TIDAK_BISA_DIKEMBALIKAN" | "BERUBAH_LAGI" }> {
  return runSerializable(async (tx) => {
    const s = await tx.kolFormSubmission.findUnique({ where: { id: input.submissionId }, select: { id: true, kolId: true, changes: true } });
    if (!s) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    const riwayat = bacaRiwayatPengiriman(s.changes);
    const i = riwayat.perubahan.findIndex((p) => p.kolom === input.kolom);
    const p: PerubahanFormulir | undefined = riwayat.perubahan[i];
    if (!p || !p.menimpa || p.dikembalikan) return { ok: false as const, kode: "TIDAK_BISA_DIKEMBALIKAN" as const };
    const k = await tx.kol.findUnique({
      where: { id: s.kolId },
      select: { recipientName: true, phone: true, email: true, address: true, city: true, province: true, postalCode: true, sizeProfile: true },
    });
    if (!k) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    const kini = teksKolom(dataSekarang(k), p.kolom);
    const masihDariKol = kini !== null && samaNilaiFormulir(p.kolom, kini, p.sesudah);
    if (!masihDariKol) return { ok: false as const, kode: "BERUBAH_LAGI" as const };

    await tx.kol.update({ where: { id: s.kolId }, data: susunPerubahanKol(k, { [p.kolom]: p.sebelum }) });
    riwayat.perubahan[i] = { ...p, dikembalikan: true };
    await tx.kolFormSubmission.update({ where: { id: s.id }, data: { changes: JSON.stringify(riwayat) } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOL_DIUBAH,
      entityType: "Kol",
      entityId: s.kolId,
      changes: { before: { [p.kolom]: kini }, after: { [p.kolom]: p.sebelum } },
      metadata: { sumber: SUMBER_KEMBALIKAN, submissionId: s.id },
    });
    return { ok: true as const };
  });
}
