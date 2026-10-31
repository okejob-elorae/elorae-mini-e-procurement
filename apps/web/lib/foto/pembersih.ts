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
 * SETIAP kolom yang bisa menyimpan URL `/api/foto/<id>`. Foto yang tidak
 * ditunjuk kolom mana pun di sini dianggap yatim dan DIHAPUS — jadi kolom foto
 * baru WAJIB ditambahkan ke daftar ini. `pembersih-skema.test.ts` membaca skema
 * Prisma dan gagal kalau ada kolom bernama foto/photo/image/selfie/… yang
 * tidak terdaftar di sini maupun di `KOLOM_BUKAN_FOTO_DB`.
 *
 * Sampai 2026-10-03 daftar ini hanya berisi BKM, kontrabon, dan nota retur:
 * foto bukti terima, struk biaya, swafoto absen, usulan toko, harga pesaing,
 * izin, panduan display, dan konten kreatif semuanya tersapu jam 03.10 begitu
 * berumur enam jam.
 *
 * `json: true` = kolom JSON (bisa berisi beberapa URL); kolom teks pun dibaca
 * dengan mencari SEMUA `/api/foto/<id>` di dalamnya, karena beberapa kolom teks
 * menyimpan daftar URL (mis. `GRN.photoUrls`).
 */
/**
 * `wajib`: kolom yang di skema WAJIB terisi (bukan `?`). Prisma menolak
 * saringan `not: null` pada kolom wajib, jadi tabelnya dibaca tanpa saringan.
 */
export const KOLOM_FOTO: readonly { model: string; kolom: readonly string[]; json?: boolean; wajib?: boolean }[] = [
  { model: "paymentClaim", kolom: ["transferPhotoUrl", "breakdownPhotoUrl"] },
  { model: "collectionNote", kolom: ["photoUrl"] },
  { model: "storeReturn", kolom: ["photoUrl"] },
  { model: "fieldSalesDelivery", kolom: ["podPhotoUrl"] },
  { model: "gRN", kolom: ["photoUrls"] },
  { model: "materialIssue", kolom: ["ackPhotoUrl"] },
  { model: "fGReceipt", kolom: ["qcPhotos"] },
  { model: "contentPlan", kolom: ["imageUrl"] },
  { model: "storeReceiptLine", kolom: ["damagePhotoUrl"] },
  { model: "storeProposal", kolom: ["photoUrl"] },
  { model: "expenseClaim", kolom: ["photoUrl"] },
  { model: "attendance", kolom: ["selfieUrl"] },
  { model: "competitorPrice", kolom: ["photoUrl"] },
  { model: "displayGuide", kolom: ["imageUrl"] },
  { model: "leaveRequest", kolom: ["photoUrl"] },
  { model: "itemImage", kolom: ["url"], wajib: true },
  { model: "user", kolom: ["image"] },
  { model: "spgDailyClose", kolom: ["photoUrls"], json: true },
  { model: "kolPaymentTerm", kolom: ["buktiTransferUrl"] },
  // Keuangan (akuntansi & pajak lengkap, 2026-10-08): bukti voucher kas/bank,
  // bukti transfer pembayaran pemasok, bukti setor pajak.
  { model: "cashVoucher", kolom: ["photoUrl"] },
  { model: "supplierPayment", kolom: ["proofPhotoUrl"] },
  { model: "taxPayment", kolom: ["proofPhotoUrl"] },
  // SKB (Surat Keterangan Bebas) pemasok — opsional, data master pemasok.
  { model: "supplier", kolom: ["skbPhotoUrl"] },
];

/**
 * Kolom yang NAMANYA mirip foto tapi tidak pernah menyimpan `/api/foto/…`,
 * beserta alasannya — supaya tes skema tidak menuntutnya masuk daftar.
 */
export const KOLOM_BUKAN_FOTO_DB: Readonly<Record<string, string>> = {
  "JubelioWebhookEvent.signature": "tanda tangan HMAC webhook, bukan gambar",
  "JubelioPushDefaults.useSingleImageSet": "saklar boolean",
  "ItemImage.jubelioImageId": "id gambar di Jubelio",
  "ItemImage.jubelioImageKey": "kunci gambar di Jubelio",
  "ItemImage.jubelioImageThumbnail": "URL thumbnail Jubelio",
  "Item.images": "relasi ke ItemImage (kolom url-nya terdaftar)",
  "StoreVisit.photos": "relasi ke VisitPhoto — foto kunjungan di R2, bukan tabel Foto",
  "User.fotoDiunggah": "relasi ke Foto itu sendiri",
  "KolPaymentTerm.nomorBuktiPotong": "nomor bukti potong PPh dari Coretax (teks), bukan gambar",
  "KolPaymentTerm.buktiPotongAt": "tanggal bukti potong PPh, bukan gambar",
};

const POLA_URL_FOTO = /\/api\/foto\/([A-Za-z0-9_-]+)/g;

/** Semua `/api/foto/<id>` di dalam sebuah nilai kolom (teks atau JSON). */
export function urlFotoDalam(nilai: unknown): string[] {
  if (nilai === null || nilai === undefined) return [];
  const teks = typeof nilai === "string" ? nilai : JSON.stringify(nilai);
  return [...teks.matchAll(POLA_URL_FOTO)].map((m) => `/api/foto/${m[1]}`);
}

type Delegasi = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };

/**
 * Kumpulkan setiap URL foto yang sedang dipakai sebuah dokumen.
 *
 * Dibaca sebagai teks URL, bukan id, karena itulah yang benar-benar tersimpan
 * di kolom-kolomnya. Penyapuannya sengaja mengumpulkan yang TERPAKAI, bukan
 * menebak yang yatim — kolom yang terlewat berarti foto yang masih dipakai ikut
 * tersapu, maka daftarnya dijaga tes skema.
 */
async function urlTerpakai(): Promise<Set<string>> {
  const dipakai = new Set<string>();
  const hasil = await Promise.all(
    KOLOM_FOTO.map(({ model, kolom, json, wajib }) => {
      const delegasi = (prisma as unknown as Record<string, Delegasi>)[model];
      const select = Object.fromEntries(kolom.map((k) => [k, true]));
      // Kolom JSON tidak bisa disaring `not: null` dengan cara yang sama di
      // semua dialek; tabelnya kecil, jadi dibaca utuh.
      const where = json || wajib ? undefined : { OR: kolom.map((k) => ({ [k]: { not: null } })) };
      return delegasi.findMany({ where, select });
    }),
  );
  for (const baris of hasil) {
    for (const b of baris) {
      for (const nilai of Object.values(b)) for (const url of urlFotoDalam(nilai)) dipakai.add(url);
    }
  }
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
