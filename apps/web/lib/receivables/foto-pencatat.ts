import { Prisma } from "@elorae/db";

/**
 * Foto bukti di laporan piutang harus foto PENCATATNYA sendiri.
 *
 * `/api/foto/<id>` milik siapa pun bisa diketik ke formulir mana pun: bukti
 * transfer sales lain, nota retur toko lain, lembar tanda terima yang pernah
 * dipotret orang lain. Fotonya sah — hanya bukan bukti orang yang melapor.
 * Sama dengan `fotoMilik` di penulis bukti terima pengiriman.
 *
 * Pengecualian: orang kantor modul itu (izinnya diberikan pemanggil). Kantor
 * menyalin foto laporan sales saat "Buat ulang", dan memasang foto lembar yang
 * dipotret sales — mereka bukan pelapor yang bisa diuntungkan buktinya.
 *
 * Izin kantor dibaca dari BASIS DATA (peran pencatat), bukan dari sesi, supaya
 * penulis tidak bergantung pada pemanggil yang ingat mengoper izin. Peran
 * sistem (admin) selalu lolos, sama seperti `lib/auth.ts` memberinya `*`.
 *
 * Yang sengaja dibiarkan:
 * - alamat yang bukan rute foto kita (foto lama di R2) — seperti sebelumnya;
 * - id yang tidak ada di tabel `Foto` — tidak ada foto siapa pun yang bisa
 *   dicuci lewat id kosong; layar kantor hanya menampilkan gambar rusak.
 */

type Klien = Prisma.TransactionClient;

/** Bentuk satu-satunya yang dihasilkan unggahan: `/api/foto/<id>`. */
const POLA_FOTO = /^\/api\/foto\/([A-Za-z0-9_-]{1,64})$/;
/** Apa pun yang menunjuk rute foto kita, termasuk yang disamarkan. */
const MENUNJUK_RUTE_FOTO = /api(\/|%2f)foto/i;
/** Jalur yang sudah dinormalkan seperti peramban menormalkannya. */
const JALUR_RUTE_FOTO = /\/api\/+foto(\/|$)/i;
/** Basis tiruan untuk mengurai alamat relatif — hanya jalurnya yang dibaca. */
const BASIS = "http://alamat.invalid";

/**
 * Jalur alamat sesudah dinormalkan seperti peramban sebelum meminta gambar:
 * `\` menjadi `/`, `.`/`..`/`%2e` diselesaikan, huruf bersandi (`%61pi`)
 * dilepas. Tanpa ini `/api/./foto/<id>` lolos sebagai "bukan rute foto" padahal
 * menampilkan foto yang sama.
 */
function jalurTernormal(alamat: string): string {
  let jalur = alamat;
  try {
    jalur = new URL(alamat, BASIS).pathname;
  } catch {
    // Tidak bisa diurai — teks mentahnya yang diperiksa.
  }
  for (let i = 0; i < 3; i++) {
    let lepas: string;
    try {
      lepas = decodeURIComponent(jalur);
    } catch {
      break;
    }
    if (lepas === jalur) break;
    jalur = lepas;
  }
  return jalur;
}

/** Alamat menunjuk rute foto kita dalam bentuk apa pun. */
function menunjukRuteFoto(alamat: string): boolean {
  return MENUNJUK_RUTE_FOTO.test(alamat) || JALUR_RUTE_FOTO.test(jalurTernormal(alamat));
}

export const KODE_FOTO_BUKAN_MILIK = "FOTO_BUKAN_MILIK" as const;

/**
 * `true` bila setiap foto di `urls` boleh dipakai `userId`.
 *
 * Alamat yang menunjuk rute foto kita dalam bentuk lain (`?v=1`, alamat
 * lengkap, garis miring di ujung, `/api/./foto/…`, `/api\foto\…`) tetap
 * disajikan rute itu tetapi tidak bisa dicocokkan pemiliknya — diperlakukan
 * sebagai foto orang lain.
 */
export async function fotoBolehDipakai(
  tx: Klien,
  masukan: { urls: readonly (string | null | undefined)[]; userId: string; izinKantor: readonly string[] },
): Promise<boolean> {
  const ids: string[] = [];
  let tidakTerperiksa = false;
  for (const mentah of masukan.urls) {
    const alamat = typeof mentah === "string" ? mentah.trim() : "";
    if (!alamat) continue;
    const cocok = POLA_FOTO.exec(alamat);
    if (cocok) ids.push(cocok[1]);
    else if (menunjukRuteFoto(alamat)) tidakTerperiksa = true;
  }
  if (ids.length === 0 && !tidakTerperiksa) return true;

  let milikOrangLain = tidakTerperiksa;
  if (!milikOrangLain && ids.length > 0) {
    const foto = await tx.foto.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { uploadedById: true },
    });
    milikOrangLain = foto.some((f) => f.uploadedById !== masukan.userId);
  }
  if (!milikOrangLain) return true;
  return punyaIzinKantor(tx, masukan.userId, masukan.izinKantor);
}

/** Peran pengguna (di basis data) adalah peran sistem atau memegang salah satu izin. */
async function punyaIzinKantor(tx: Klien, userId: string, izin: readonly string[]): Promise<boolean> {
  if (!userId) return false;
  const syarat: Prisma.RoleDefinitionWhereInput[] = [{ isSystem: true }];
  if (izin.length > 0) syarat.push({ permissions: { some: { permission: { code: { in: [...izin] } } } } });
  const orang = await tx.user.findFirst({
    where: { id: userId, roleDefinition: { OR: syarat } },
    select: { id: true },
  });
  return orang !== null;
}
