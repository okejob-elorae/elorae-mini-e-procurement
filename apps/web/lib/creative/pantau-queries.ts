import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { cekAnomaliAkun } from "./pantau-anomali";
import { dalamJamKerja, STATUS_TUGAS, type PengaturanPantau, type StatusTugasPantau } from "./pantau-aturan";
import { bacaPengaturanPantau } from "./pantau-pengaturan";
import { hitungHariIni, type HitunganHariIni } from "./pantau-writer";
import type { AnomaliTugas, PerangkatTugas } from "./tugas";

/*
 * Pembaca pantau KOL — KHUSUS SERVER (klien hanya `import type`).
 *
 * Layar Kreatif → Pemantauan, dua kelompok Hari ini (anomali akun, perangkat
 * berhenti). Tidak ada keadaan yang disimpan: "berhenti" dan "anomali"
 * dihitung ulang setiap kali dibaca.
 */

export type KeadaanPerangkat = "BELUM_TERSAMBUNG" | "KODE_KEDALUWARSA" | "AKTIF" | "DIJEDA" | "DICABUT";

export type BarisPerangkat = {
  id: string;
  nama: string;
  keadaan: KeadaanPerangkat;
  alasanJeda: string | null;
  /** ISO; null untuk jeda manual (sampai dilanjutkan). */
  dijedaSampai: string | null;
  kodeBerlakuSampai: string | null;
  tersambungAt: string | null;
  terakhirLaporAt: string | null;
  versi: string | null;
  dibuatOleh: string | null;
  dibuatAt: string;
};

export type BarisAntrean = { status: StatusTugasPantau; profil: number; konten: number };

export type BarisMasalah = {
  id: string;
  waktu: string;
  perangkat: string | null;
  jenis: string;
  kode: string | null;
  pesan: string | null;
  tugas: { jenis: string; url: string; kolId: string | null; kolNama: string | null } | null;
};

export type DataPemantauan = {
  hariIni: HitunganHariIni;
  dalamJam: boolean;
  antrean: BarisAntrean[];
  perangkat: BarisPerangkat[];
  masalah: BarisMasalah[];
  pengaturan: PengaturanPantau;
};

/** Perangkat yang tidak melapor selama ini (jam) dianggap berhenti. */
export const SENYAP_JAM = 24;
/** Anomali tampil di Hari ini selama catatan terbarunya berumur paling lama ini (hari). */
export const ANOMALI_TAMPIL_HARI = 7;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function keadaanPerangkat(
  p: { dicabutAt: Date | null; tersambungAt: Date | null; kodeBerlakuSampai: Date | null; dijedaSampai: Date | null },
  sekarang: Date,
): KeadaanPerangkat {
  if (p.dicabutAt) return "DICABUT";
  if (!p.tersambungAt) return p.kodeBerlakuSampai && p.kodeBerlakuSampai.getTime() >= sekarang.getTime() ? "BELUM_TERSAMBUNG" : "KODE_KEDALUWARSA";
  if (p.dijedaSampai && p.dijedaSampai.getTime() > sekarang.getTime()) return "DIJEDA";
  return "AKTIF";
}

export async function dataPemantauan(sekarang: Date = new Date()): Promise<DataPemantauan> {
  const pengaturan = await bacaPengaturanPantau();
  const hari = hariIniWib(sekarang);
  const rentang = { gte: parseDateOnly(hari)!, lte: parseDateOnlyEnd(hari)! };

  const [hariIni, terbuka, selesaiHariIni, perangkat, log] = await Promise.all([
    hitungHariIni(prisma, sekarang, pengaturan.kuotaHarian),
    prisma.kolTugasPantau.groupBy({ by: ["status", "jenis"], where: { status: { in: ["ANTRE", "DIPINJAM"] } }, _count: { _all: true } }),
    prisma.kolTugasPantau.groupBy({
      by: ["status", "jenis"],
      where: { status: { in: ["SELESAI", "GAGAL", "DILEWATI"] }, selesaiAt: rentang },
      _count: { _all: true },
    }),
    prisma.kolPerangkat.findMany({ orderBy: [{ dicabutAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 50 }),
    prisma.kolLogPantau.findMany({
      where: { jenis: { in: ["MASALAH", "JEDA"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
    }),
  ]);

  const hitung = new Map<string, number>();
  for (const g of [...terbuka, ...selesaiHariIni]) hitung.set(`${g.status}:${g.jenis}`, g._count._all);
  const antrean: BarisAntrean[] = STATUS_TUGAS.map((status) => ({
    status,
    profil: hitung.get(`${status}:PROFIL`) ?? 0,
    konten: hitung.get(`${status}:KONTEN`) ?? 0,
  }));

  const pembuat = await prisma.user.findMany({
    where: { id: { in: [...new Set(perangkat.map((p) => p.dibuatOlehId))] } },
    select: { id: true, name: true },
  });
  const namaPembuat = new Map(pembuat.map((u) => [u.id, u.name]));

  const tugasIds = [...new Set(log.map((l) => l.tugasId).filter((x): x is string => Boolean(x)))];
  const tugas = tugasIds.length
    ? await prisma.kolTugasPantau.findMany({
        where: { id: { in: tugasIds } },
        select: {
          id: true,
          jenis: true,
          url: true,
          account: { select: { kol: { select: { id: true, name: true } } } },
          content: { select: { collab: { select: { kol: { select: { id: true, name: true } } } } } },
        },
      })
    : [];
  const petaTugas = new Map(tugas.map((t) => [t.id, t]));
  const namaPerangkat = new Map(perangkat.map((p) => [p.id, p.nama]));

  return {
    hariIni,
    dalamJam: dalamJamKerja(sekarang, pengaturan),
    antrean,
    perangkat: perangkat.map((p) => {
      const keadaan = keadaanPerangkat(p, sekarang);
      return {
        id: p.id,
        nama: p.nama,
        keadaan,
        alasanJeda: keadaan === "DIJEDA" ? p.alasanJeda : null,
        dijedaSampai: keadaan === "DIJEDA" && p.alasanJeda !== "MANUAL" ? iso(p.dijedaSampai) : null,
        kodeBerlakuSampai: iso(p.kodeBerlakuSampai),
        tersambungAt: iso(p.tersambungAt),
        terakhirLaporAt: iso(p.terakhirLaporAt),
        versi: p.versiEkstensi,
        dibuatOleh: namaPembuat.get(p.dibuatOlehId) ?? null,
        dibuatAt: p.createdAt.toISOString(),
      };
    }),
    masalah: log.map((l) => {
      const t = l.tugasId ? petaTugas.get(l.tugasId) : undefined;
      const kol = t?.account?.kol ?? t?.content?.collab?.kol ?? null;
      return {
        id: l.id,
        waktu: l.createdAt.toISOString(),
        perangkat: l.perangkatId ? (namaPerangkat.get(l.perangkatId) ?? null) : null,
        jenis: l.jenis,
        kode: l.kode,
        pesan: l.pesan,
        tugas: t ? { jenis: t.jenis, url: t.url, kolId: kol?.id ?? null, kolNama: kol?.name ?? null } : null,
      };
    }),
    pengaturan,
  };
}

// ── Hari ini ──────────────────────────────────────────────────────────────

/**
 * Akun TikTok yang catatan terbarunya (≤ `ANOMALI_TAMPIL_HARI` hari) anomali
 * dibanding catatan sebelumnya. KOL diblokir dilewati. `akunIds` membatasi
 * bacaan (tes).
 */
export async function anomaliTugas(o: { sekarang?: Date; pengaturan?: PengaturanPantau; akunIds?: readonly string[] } = {}): Promise<AnomaliTugas[]> {
  const sekarang = o.sekarang ?? new Date();
  const pengaturan = o.pengaturan ?? (await bacaPengaturanPantau());
  const batas = new Date(sekarang.getTime() - ANOMALI_TAMPIL_HARI * 86_400_000);
  const akun = await prisma.kolAccount.findMany({
    where: {
      platform: "TIKTOK",
      snapshots: { some: { recordedAt: { gte: batas, lte: sekarang } } },
      ...(o.akunIds ? { id: { in: [...o.akunIds] } } : {}),
    },
    select: {
      id: true,
      handle: true,
      kol: { select: { id: true, name: true, blockedAt: true } },
      snapshots: {
        where: { recordedAt: { lte: sekarang } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { followers: true, er: true, recordedAt: true },
      },
    },
  });
  const hasil: AnomaliTugas[] = [];
  for (const a of akun) {
    if (!a.kol || a.kol.blockedAt) continue;
    const r = cekAnomaliAkun(
      a.snapshots.map((s) => ({ followers: s.followers, er: s.er === null ? null : Number(s.er), recordedAt: s.recordedAt })),
      pengaturan,
    );
    if (!r.terbaru || r.terbaru.getTime() < batas.getTime() || (!r.pengikut && !r.er)) continue;
    hasil.push({
      akunId: a.id,
      kolId: a.kol.id,
      kolNama: a.kol.name,
      handle: a.handle.replace(/^@+/, ""),
      hari: formatDateOnlyJakarta(r.terbaru),
      pengikut: r.pengikut,
      er: r.er,
    });
  }
  return hasil;
}

/**
 * Perangkat tersambung yang berhenti: dijeda otomatis (captcha, login, gagal
 * beruntun — jeda manual disengaja, jadi tidak ditagih), atau tidak melapor
 * lebih dari `SENYAP_JAM` jam (komputernya mati). `perangkatIds` membatasi
 * bacaan (tes).
 */
export async function perangkatBerhentiTugas(o: { sekarang?: Date; perangkatIds?: readonly string[] } = {}): Promise<PerangkatTugas[]> {
  const sekarang = o.sekarang ?? new Date();
  const senyap = new Date(sekarang.getTime() - SENYAP_JAM * 3_600_000);
  const rows = await prisma.kolPerangkat.findMany({
    where: {
      dicabutAt: null,
      tersambungAt: { not: null },
      ...(o.perangkatIds ? { id: { in: [...o.perangkatIds] } } : {}),
      OR: [{ dijedaSampai: { gt: sekarang }, NOT: { alasanJeda: "MANUAL" } }, { terakhirLaporAt: { lt: senyap } }],
    },
    select: { id: true, nama: true, dijedaSampai: true, alasanJeda: true, terakhirLaporAt: true },
  });
  if (!rows.length) return [];
  const jeda = await prisma.kolLogPantau.findMany({
    where: { perangkatId: { in: rows.map((r) => r.id) }, jenis: "JEDA" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { perangkatId: true, createdAt: true },
  });
  const jedaTerakhir = new Map<string, Date>();
  for (const j of jeda) if (j.perangkatId && !jedaTerakhir.has(j.perangkatId)) jedaTerakhir.set(j.perangkatId, j.createdAt);

  return rows.map((r) => {
    const dijeda = r.dijedaSampai !== null && r.dijedaSampai.getTime() > sekarang.getTime() && r.alasanJeda !== "MANUAL";
    const alasan: PerangkatTugas["alasan"] =
      dijeda && (r.alasanJeda === "CAPTCHA" || r.alasanJeda === "LOGIN" || r.alasanJeda === "GAGAL_BERUNTUN" || r.alasanJeda === "DIBLOKIR_TIKTOK")
        ? r.alasanJeda
        : "TIDAK_LAPOR";
    const sejak = dijeda ? (jedaTerakhir.get(r.id) ?? sekarang) : (r.terakhirLaporAt ?? sekarang);
    return {
      id: r.id,
      nama: r.nama,
      sejak: formatDateOnlyJakarta(sejak),
      alasan,
      sampai: dijeda ? r.dijedaSampai!.toISOString() : null,
    };
  });
}
