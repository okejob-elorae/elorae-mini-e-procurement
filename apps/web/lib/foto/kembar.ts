import type { Prisma } from "@elorae/db";
import { KOLOM_FOTO, urlFotoDalam } from "./pembersih";

/**
 * Foto yang "dicuci": bukti milik orang lain yang diunduh lalu diunggah ulang.
 *
 * Pemeriksaan pemilik (`fotoBolehDipakai` di `lib/receivables/foto-pencatat.ts`,
 * `fotoMilik` di bukti terima) hanya membandingkan PENGUNGGAH. Foto rekan yang
 * diunduh dari dokumennya lalu diunggah lagi menjadi baris `Foto` baru milik
 * pengunggah ulang — lolos sebagai "foto sendiri" padahal isinya bukti orang lain
 * yang sudah dipakai (mis. bukti transfer yang sama untuk dua BKM).
 *
 * Isi foto disidik saat unggah (`Foto.sha256`, `lib/foto/sidik.ts`). Foto yang
 * dipakai sebuah laporan DITOLAK (`FOTO_SUDAH_DIPAKAI`) bila ada foto lain dengan
 * sidik yang sama, diunggah orang LAIN (atau tak dikenal), dan sudah ditunjuk
 * dokumen lain (kolom mana pun di `KOLOM_FOTO`).
 *
 * Yang sengaja dibiarkan:
 * - kembaran milik pelapor sendiri (ia mengunggah ulang fotonya sendiri);
 * - kembaran yang belum dipakai dokumen apa pun (belum ada bukti yang dicuci);
 * - foto lama tanpa sidik (diunggah sebelum kolomnya ada dan belum diisi);
 * - alamat yang bukan `/api/foto/<id>` persis — urusan pemeriksaan pemilik.
 *
 * Murah di jalur biasa: dua kueri (sidik foto laporan, lalu kembarannya). Kueri
 * dokumen hanya berjalan bila kembaran milik orang lain benar-benar ada.
 */

export const KODE_FOTO_SUDAH_DIPAKAI = "FOTO_SUDAH_DIPAKAI" as const;

/** Bentuk satu-satunya yang dihasilkan unggahan: `/api/foto/<id>`. */
const POLA_FOTO = /^\/api\/foto\/([A-Za-z0-9_-]{1,64})$/;

/** Jendela kolom JSON (sama dengan rute baca foto): dokumen ditulis sesudah fotonya diunggah. */
const HARI_MS = 24 * 60 * 60 * 1000;
const JENDELA_JSON_HARI = 15;

type Klien = Prisma.TransactionClient;
type Delegasi = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };

export type HasilFotoKembar =
  | { boleh: true }
  | { boleh: false; kode: typeof KODE_FOTO_SUDAH_DIPAKAI; fotoId: string; kembarId: string };

/**
 * Periksa foto-foto sebuah laporan sebelum disimpan (panggil di dalam transaksi
 * penulisnya, sesudah pemeriksaan pemilik).
 *
 * `kecuali`: dokumen yang sedang dikoreksi — tautannya sendiri ke kembaran tidak
 * dihitung "dokumen lain".
 */
export async function periksaFotoKembar(
  db: Klien,
  masukan: {
    urls: readonly (string | null | undefined)[];
    userId: string;
    kecuali?: { model: string; id: string };
  },
): Promise<HasilFotoKembar> {
  const ids = new Set<string>();
  for (const mentah of masukan.urls) {
    const cocok = POLA_FOTO.exec(typeof mentah === "string" ? mentah.trim() : "");
    if (cocok) ids.add(cocok[1]);
  }
  if (ids.size === 0) return { boleh: true };

  const foto = await db.foto.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, sha256: true },
  });
  const fotoPerSidik = new Map<string, string>();
  for (const f of foto) if (f.sha256 && !fotoPerSidik.has(f.sha256)) fotoPerSidik.set(f.sha256, f.id);
  if (fotoPerSidik.size === 0) return { boleh: true };

  const kembar = await db.foto.findMany({
    where: { sha256: { in: [...fotoPerSidik.keys()] }, id: { notIn: [...ids] } },
    select: { id: true, sha256: true, uploadedById: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const k of kembar) {
    // Kembaran milik pelapor sendiri: ia mengunggah ulang fotonya sendiri.
    if (k.uploadedById === masukan.userId) continue;
    if (await ditunjukDokumen(db, `/api/foto/${k.id}`, k.createdAt, masukan.kecuali)) {
      return { boleh: false, kode: KODE_FOTO_SUDAH_DIPAKAI, fotoId: fotoPerSidik.get(k.sha256 ?? "") ?? "", kembarId: k.id };
    }
  }
  return { boleh: true };
}

/** Apakah ada dokumen (kolom mana pun di `KOLOM_FOTO`) yang menunjuk URL foto ini. */
async function ditunjukDokumen(
  db: Klien,
  url: string,
  dibuat: Date,
  kecuali?: { model: string; id: string },
): Promise<boolean> {
  for (const { model, kolom, json } of KOLOM_FOTO) {
    const syarat: Record<string, unknown>[] = [];
    if (json) {
      // Kolom JSON tidak bisa dicari isinya sama di Postgres dan MariaDB.
      syarat.push({
        updatedAt: { gte: new Date(dibuat.getTime() - HARI_MS) },
        createdAt: { lte: new Date(dibuat.getTime() + JENDELA_JSON_HARI * HARI_MS) },
      });
    } else {
      syarat.push({ OR: kolom.map((k) => ({ [k]: { contains: url } })) });
    }
    if (kecuali && kecuali.model === model) syarat.push({ NOT: { id: kecuali.id } });

    const delegasi = (db as unknown as Record<string, Delegasi>)[model];
    const baris = await delegasi.findMany({
      where: { AND: syarat },
      select: Object.fromEntries(kolom.map((k) => [k, true])),
      take: json ? undefined : 20,
    });
    // `contains` bisa mengenai id lain yang diawali id ini; cocokkan URL utuh.
    if (baris.some((b) => kolom.some((k) => urlFotoDalam(b[k]).includes(url)))) return true;
  }
  return false;
}
