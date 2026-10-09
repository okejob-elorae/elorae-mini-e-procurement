import { Prisma, prisma } from "@elorae/db";
import { isRetryableTxError, runSerializable } from "@/lib/db/tx-retry";
import { kunciMinta, PRIORITAS_PANTAU } from "./pantau-antrean";
import type { PengaturanPantau } from "./pantau-aturan";
import { urlKontenKanonik, videoIdDariLink } from "./pantau-muatan";
import { bacaPengaturanPantau } from "./pantau-pengaturan";
import { tulisLog } from "./pantau-writer";

/*
 * "Cek sekarang" di Kreatif → Performa video — KHUSUS SERVER (klien hanya `import type`).
 *
 * Angka video berubah terus sesudah dibaca; jadwal otomatis (H+1/3/7/30, lalu berkala) bisa
 * berhari-hari lagi. Permintaan ini menaruh video di DEPAN antrean ekstensi: prioritas
 * `KONTEN_SEGERA` (95), jatuh tempo sekarang. Satu video paling banyak satu tugas terbuka — yang
 * masih ANTRE dinaikkan dan dimajukan, yang sedang DIPINJAM perangkat dibiarkan. Diperiksa di
 * `runSerializable` supaya dua klik serentak tidak membuat dua tugas. Setiap cek memakan kuota
 * harian seperti cek otomatis.
 */

export const MAKS_CEK_SEKARANG = 100;

export type HasilCekSekarang =
  | { ok: true; diantrekan: number; sudahAntre: number; dilewati: number; perangkatDilanjutkan: number }
  | { ok: false; kode: "KOSONG" | "TERLALU_BANYAK" };

/**
 * Jeda yang dilepas oleh permintaan langsung: yang dipasang otomatis karena kegagalan beruntun atau
 * karena perangkat lama tidak melapor. Captcha/login (perlu diselesaikan orang di Chrome) dan jeda
 * yang dipasang orang sendiri dari Pemantauan (MANUAL) tetap.
 */
const JEDA_DILEPAS_PERMINTAAN = ["GAGAL_BERUNTUN", "TIDAK_LAPOR", "DIBLOKIR_TIKTOK"] as const;

async function lepasJedaOtomatis(sekarang: Date, perangkatIds?: readonly string[]): Promise<number> {
  if (perangkatIds && perangkatIds.length === 0) return 0;
  return runSerializable(async (tx) => {
    const dijeda = await tx.kolPerangkat.findMany({
      where: {
        dicabutAt: null,
        alasanJeda: { in: [...JEDA_DILEPAS_PERMINTAAN] },
        dijedaSampai: { gt: sekarang },
        ...(perangkatIds ? { id: { in: [...perangkatIds] } } : {}),
      },
      select: { id: true, alasanJeda: true },
    });
    for (const p of dijeda) {
      await tx.kolPerangkat.update({ where: { id: p.id }, data: { dijedaSampai: null, alasanJeda: null } });
      await tulisLog(tx, { perangkatId: p.id, jenis: "LANJUT", kode: "CEK_SEKARANG", pesan: p.alasanJeda, waktu: sekarang });
    }
    return dijeda.length;
  });
}

type HasilSatu = "DIANTREKAN" | "SUDAH_ANTRE" | "DILEWATI";

/**
 * `runSerializable` menyerah sesudah 4 benturan tanpa jeda; beberapa klik serentak pada video yang
 * sama bisa melewati itu. Di sini benturan dicoba lagi dengan jeda yang makin panjang.
 */
const MAKS_ULANG_BENTURAN = 6;
const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function satu(contentId: string, sekarang: Date): Promise<HasilSatu> {
  for (let ke = 1; ; ke++) {
    try {
      return await satuSekali(contentId, sekarang);
    } catch (e) {
      if (!isRetryableTxError(e) || ke >= MAKS_ULANG_BENTURAN) throw e;
      await jeda(20 * ke + Math.floor(Math.random() * 30));
    }
  }
}

async function satuSekali(contentId: string, sekarang: Date): Promise<HasilSatu> {
  try {
    return await runSerializable(async (tx): Promise<HasilSatu> => {
      const c = await tx.kolContent.findUnique({ where: { id: contentId }, select: { platform: true, link: true } });
      if (!c || c.platform !== "TIKTOK" || !c.link || !videoIdDariLink(c.link)) return "DILEWATI";
      const terbuka = await tx.kolTugasPantau.findFirst({
        where: { contentId, jenis: "KONTEN", status: { in: ["ANTRE", "DIPINJAM"] } },
        select: { id: true, status: true, prioritas: true, jatuhAt: true },
      });
      if (terbuka) {
        if (terbuka.status === "ANTRE") {
          await tx.kolTugasPantau.update({
            where: { id: terbuka.id },
            data: {
              prioritas: Math.max(terbuka.prioritas, PRIORITAS_PANTAU.KONTEN_SEGERA),
              jatuhAt: terbuka.jatuhAt.getTime() > sekarang.getTime() ? sekarang : terbuka.jatuhAt,
            },
          });
        }
        return "SUDAH_ANTRE";
      }
      await tx.kolTugasPantau.create({
        data: {
          kunci: kunciMinta(contentId, sekarang.getTime()),
          jenis: "KONTEN",
          platform: "TIKTOK",
          contentId,
          url: urlKontenKanonik(c.link),
          titikH: null,
          prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA,
          jatuhAt: sekarang,
          createdAt: sekarang,
        },
      });
      return "DIANTREKAN";
    });
  } catch (e) {
    // Klik kembar pada milidetik yang sama: kunci yang sama sudah dibuat yang lain.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "SUDAH_ANTRE";
    throw e;
  }
}

/** `perangkatIds` hanya untuk tes (membatasi perangkat yang jedanya boleh dilepas). */
export async function mintaCekSekarang(input: {
  kontenIds: readonly string[];
  sekarang?: Date;
  perangkatIds?: readonly string[];
}): Promise<HasilCekSekarang> {
  const ids = [...new Set(input.kontenIds.filter((x) => typeof x === "string" && x))];
  if (!ids.length) return { ok: false, kode: "KOSONG" };
  if (ids.length > MAKS_CEK_SEKARANG) return { ok: false, kode: "TERLALU_BANYAK" };
  const sekarang = input.sekarang ?? new Date();
  const hasil = { ok: true as const, diantrekan: 0, sudahAntre: 0, dilewati: 0, perangkatDilanjutkan: 0 };
  for (const id of ids) {
    const r = await satu(id, sekarang);
    if (r === "DIANTREKAN") hasil.diantrekan += 1;
    else if (r === "SUDAH_ANTRE") hasil.sudahAntre += 1;
    else hasil.dilewati += 1;
  }
  // Orang menunggu angkanya: jeda otomatis tidak boleh membuatnya menunggu sampai satu jam.
  if (hasil.diantrekan + hasil.sudahAntre > 0) hasil.perangkatDilanjutkan = await lepasJedaOtomatis(sekarang, input.perangkatIds);
  return hasil;
}

/**
 * Apakah permintaan cek akan segera dikerjakan? Untuk pesan di layar sesudah "Cek sekarang"
 * (dipanggil SESUDAH jeda otomatis dilepas):
 * - NONAKTIF: pemantauan otomatis dimatikan di Kreatif → Pemantauan;
 * - TANPA_PERANGKAT: tidak ada perangkat tersambung yang melapor dalam 10 menit terakhir
 *   (Chrome dengan ekstensi tidak terbuka);
 * - DIJEDA: semua perangkat yang hidup masih dijeda karena captcha/login TikTok atau dijeda orang
 *   dari Pemantauan — `sampai` dan `alasan` milik jeda yang paling cepat berakhir;
 * - SIAP: dicek dalam ±1 menit (permintaan langsung tidak menunggu jam kerja).
 * `perangkatIds` hanya untuk tes yang berbagi basis data.
 */
export type KeadaanPemantau =
  | { keadaan: "SIAP" | "NONAKTIF" | "TANPA_PERANGKAT" }
  | { keadaan: "DIJEDA"; sampai: string; alasan: string | null };

const BARU_MELAPOR_MS = 10 * 60_000;

export async function keadaanPemantau(
  opsi: { sekarang?: Date; pengaturan?: PengaturanPantau; perangkatIds?: readonly string[] } = {},
): Promise<KeadaanPemantau> {
  const sekarang = opsi.sekarang ?? new Date();
  const pg = opsi.pengaturan ?? (await bacaPengaturanPantau());
  if (!pg.aktif) return { keadaan: "NONAKTIF" };
  const hidup = await prisma.kolPerangkat.findMany({
    where: {
      dicabutAt: null,
      tokenHash: { not: null },
      terakhirLaporAt: { gte: new Date(sekarang.getTime() - BARU_MELAPOR_MS) },
      ...(opsi.perangkatIds ? { id: { in: [...opsi.perangkatIds] } } : {}),
    },
    select: { dijedaSampai: true, alasanJeda: true },
  });
  if (!hidup.length) return { keadaan: "TANPA_PERANGKAT" };
  const jeda = hidup
    .filter((p): p is { dijedaSampai: Date; alasanJeda: string | null } => p.dijedaSampai !== null && p.dijedaSampai.getTime() > sekarang.getTime())
    .sort((a, b) => a.dijedaSampai.getTime() - b.dijedaSampai.getTime());
  if (jeda.length === hidup.length) return { keadaan: "DIJEDA", sampai: jeda[0].dijedaSampai.toISOString(), alasan: jeda[0].alasanJeda };
  return { keadaan: "SIAP" };
}
