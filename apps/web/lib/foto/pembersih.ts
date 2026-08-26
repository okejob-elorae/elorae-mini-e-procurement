import { prisma } from '@elorae/db';

/**
 * Penyapu foto yatim.
 *
 * Foto diunggah SEBELUM dokumennya disimpan — itu memang bentuk formulirnya:
 * sales memotret nota, melihat hasilnya, baru menekan Kirim. Kalau ia menutup
 * halaman di antara dua langkah itu, barisnya tetap ada dan tidak ada satu
 * kolom pun yang menunjuknya. Isinya bytes, bukan tautan ke penyimpanan lain,
 * jadi setiap yatim membawa serta ukurannya sendiri ke dalam basis data dan
 * ikut ke dalam setiap cadangan, selamanya.
 *
 * Tidak ada yang membersihkannya sebelum ini. Enam megabyte per foto, satu
 * sales yang batal beberapa kali sehari, dan sebuah basis data yang tumbuh
 * karena hal yang tidak dipakai siapa pun.
 */

/**
 * Umur minimum sebelum sebuah foto boleh dianggap yatim.
 *
 * INI YANG PALING PENTING DI BERKAS INI. Foto yang baru diunggah SELALU yatim
 * — kolom penunjuknya baru terisi saat dokumennya disimpan, beberapa detik
 * atau beberapa menit kemudian. Menyapu tanpa lantai umur berarti menghapus
 * foto dari formulir yang sedang diisi orang, dan yang bersangkutan hanya
 * melihat gambarnya berubah jadi rusak tanpa tahu sebabnya.
 *
 * Enam jam: jauh lebih lama daripada pengisian formulir mana pun, jauh lebih
 * pendek daripada waktu yang dibutuhkan sampah untuk jadi masalah.
 */
export const JAM_MASA_TENGGANG = 6;

export type HasilSapu = {
  diperiksa: number;
  dihapus: number;
  byteDibebaskan: number;
  /** Id yang dihapus — dicatat supaya penyapuan bisa ditelusuri, bukan hanya dihitung. */
  id: string[];
};

/**
 * Kumpulkan setiap URL foto yang sedang dipakai sebuah dokumen.
 *
 * Dibaca sebagai teks URL, bukan id, karena itulah yang benar-benar tersimpan
 * di kolom-kolomnya. Menebak bentuk id dari URL akan meleset begitu bentuk
 * URL-nya berubah; mencocokkan teks utuh tidak.
 *
 * Empat kolom, dan daftar ini harus ikut bertambah setiap kali ada kolom foto
 * baru. Yang terlewat berarti foto yang masih dipakai ikut tersapu — maka
 * penyapuannya sengaja mengumpulkan yang TERPAKAI, bukan menebak yang yatim.
 */
async function urlTerpakai(): Promise<Set<string>> {
  const dipakai = new Set<string>();

  const [klaim, kontrabon, retur] = await Promise.all([
    prisma.paymentClaim.findMany({
      where: { OR: [{ transferPhotoUrl: { not: null } }, { breakdownPhotoUrl: { not: null } }] },
      select: { transferPhotoUrl: true, breakdownPhotoUrl: true },
    }),
    prisma.collectionNote.findMany({
      where: { photoUrl: { not: null } },
      select: { photoUrl: true },
    }),
    prisma.storeReturn.findMany({
      where: { photoUrl: { not: null } },
      select: { photoUrl: true },
    }),
  ]);

  for (const k of klaim) {
    if (k.transferPhotoUrl) dipakai.add(k.transferPhotoUrl);
    if (k.breakdownPhotoUrl) dipakai.add(k.breakdownPhotoUrl);
  }
  for (const k of kontrabon) if (k.photoUrl) dipakai.add(k.photoUrl);
  for (const r of retur) if (r.photoUrl) dipakai.add(r.photoUrl);

  return dipakai;
}

/**
 * Sapu foto yang tidak ditunjuk dokumen mana pun.
 *
 * `kering` (dry run) menghitung tanpa menghapus. Itu bawaannya SENGAJA: sebuah
 * fungsi yang menghapus baris harus diminta secara terang-terangan, bukan
 * kebetulan terpanggil.
 */
export async function sapuFotoYatim(opts?: {
  kering?: boolean;
  jamTenggang?: number;
  /** Batas jumlah yang diperiksa sekali jalan, supaya satu putaran tidak berjam-jam. */
  batas?: number;
}): Promise<HasilSapu> {
  const kering = opts?.kering ?? true;
  const jam = opts?.jamTenggang ?? JAM_MASA_TENGGANG;
  const batas = opts?.batas ?? 500;

  const batasWaktu = new Date(Date.now() - jam * 60 * 60 * 1000);

  const kandidat = await prisma.foto.findMany({
    where: { createdAt: { lt: batasWaktu } },
    orderBy: { createdAt: 'asc' },
    take: batas,
    select: { id: true, sizeBytes: true },
  });
  if (kandidat.length === 0) {
    return { diperiksa: 0, dihapus: 0, byteDibebaskan: 0, id: [] };
  }

  const dipakai = await urlTerpakai();
  const yatim = kandidat.filter((f) => !dipakai.has(`/api/foto/${f.id}`));
  const byte = yatim.reduce((s, f) => s + f.sizeBytes, 0);

  if (!kering && yatim.length > 0) {
    /*
     * Dihapus menurut daftar id yang sudah dihitung, BUKAN dengan mengulang
     * saringannya sebagai `deleteMany` bersyarat. Kalau syaratnya ditulis dua
     * kali, yang kedua bisa melebar tanpa ada yang menyadarinya — dan yang
     * melebar di sini menghapus bukti transfer.
     */
    await prisma.foto.deleteMany({ where: { id: { in: yatim.map((f) => f.id) } } });
  }

  return {
    diperiksa: kandidat.length,
    dihapus: kering ? 0 : yatim.length,
    byteDibebaskan: byte,
    id: yatim.map((f) => f.id),
  };
}

export type PemakaianFoto = {
  jumlah: number;
  totalByte: number;
  yatimJumlah: number;
  yatimByte: number;
};

/**
 * Berapa besar foto yang sedang disimpan, dan berapa di antaranya sampah.
 *
 * Tanpa angka ini, satu-satunya cara mengetahui basis datanya membengkak karena
 * foto adalah dengan sudah terlanjur kehabisan tempat.
 */
export async function pemakaianFoto(): Promise<PemakaianFoto> {
  const [agregat, sapu] = await Promise.all([
    prisma.foto.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    sapuFotoYatim({ kering: true, batas: 10_000 }),
  ]);
  return {
    jumlah: agregat._count._all,
    totalByte: agregat._sum.sizeBytes ?? 0,
    yatimJumlah: sapu.id.length,
    yatimByte: sapu.byteDibebaskan,
  };
}
