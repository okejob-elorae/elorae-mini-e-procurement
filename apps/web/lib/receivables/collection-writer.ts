import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { hitungUlangPiutang } from './writer';

/**
 * Penulis kontrabon (tanda terima / TT).
 *
 * Kontrabon adalah bukti bahwa faktur fisik sudah diserahkan ke toko dan toko
 * berjanji membayar pada tanggal tertentu. Ia TIDAK mengurangi piutang sepeser
 * pun — yang mengurangi piutang hanya klaim yang terverifikasi. Kontrabon cuma
 * memindahkan piutang dari keadaan "belum ditagih" ke "sudah dipegang toko".
 */

type Klien = Prisma.TransactionClient;

/**
 * Nomor dokumen berikutnya untuk sebuah awalan, dalam tahun berjalan.
 *
 * Sengaja tidak lewat `generateDocNumber`: kolom `DocType` adalah enum di
 * database, jadi menambah satu anggota berarti migrasi enum di dua dialek
 * ditambah dua peta `Record<DocType, …>` yang kalau salah satunya terlewat
 * mematahkan build. Nomor klaim (`BKM/`) juga sudah hidup di luar enum itu.
 *
 * Penjagaan sesungguhnya terhadap nomor kembar adalah batasan `@unique` di
 * kolomnya, bukan hitungan di sini — dua admin yang menekan Simpan pada detik
 * yang sama akan bertabrakan di sana, dan pemanggilnya mengulang.
 */
async function nomorBerikutnya(tx: Klien, awalan: string, tahun: number): Promise<string> {
  const depan = `${awalan}/${tahun}/`;
  const terakhir = await tx.collectionNote.findFirst({
    where: { docNo: { startsWith: depan } },
    orderBy: { docNo: 'desc' },
    select: { docNo: true },
  });
  const urutan = terakhir ? Number(terakhir.docNo.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

export type AlasanGagalKontrabon =
  | 'TANPA_PIUTANG'
  | 'PIUTANG_TIDAK_DITEMUKAN'
  | 'BEDA_TOKO'
  | 'SUDAH_LUNAS'
  | 'SUDAH_DI_KONTRABON'
  | 'JANJI_SEBELUM_SERAH'
  | 'NOMOR_BENTROK';

export type HasilKontrabon =
  | { ok: true; id: string; docNo: string; nilai: number }
  | { ok: false; alasan: AlasanGagalKontrabon };

/**
 * Buat kontrabon untuk sekumpulan piutang satu toko.
 *
 * Nilainya dihitung dari sisa piutang yang dihitung ulang saat itu juga, bukan
 * dari kolom `outstanding` yang tersimpan — aturan yang sama seperti di seluruh
 * modul ini: sisa tidak pernah diketik.
 */
export async function buatKontrabon(input: {
  receivableIds: string[];
  salesmanId: string;
  handoverDate: Date;
  promisedDate: Date;
  receivedBy?: string | null;
  note?: string | null;
}): Promise<HasilKontrabon> {
  if (input.receivableIds.length === 0) return { ok: false, alasan: 'TANPA_PIUTANG' };
  // Janji bayar sebelum tanggal serah tidak punya arti apa pun di lapangan, dan
  // akan langsung tampil "lewat tempo" pada hari faktur diserahkan.
  if (input.promisedDate < input.handoverDate) {
    return { ok: false, alasan: 'JANJI_SEBELUM_SERAH' };
  }

  const ids = [...new Set(input.receivableIds)];

  try {
    return await runSerializable(async (tx) => {
      const piutang = await tx.receivable.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          storeId: true,
          collectionLinks: {
            select: { collectionNote: { select: { status: true } } },
          },
        },
      });
      if (piutang.length !== ids.length) {
        return { ok: false as const, alasan: 'PIUTANG_TIDAK_DITEMUKAN' as const };
      }

      // Satu kontrabon diserahkan ke satu toko — mencampur toko akan membuat
      // tanda terimanya tidak bisa ditandatangani siapa pun.
      const toko = new Set(piutang.map((p) => p.storeId));
      if (toko.size > 1) return { ok: false as const, alasan: 'BEDA_TOKO' as const };

      // Sebuah piutang hanya boleh berada di SATU kontrabon berjalan. Kalau
      // tidak, dua sales bisa menagih faktur yang sama ke toko yang sama —
      // persis kebocoran yang program ini dibuat untuk menutup.
      const sudahDipegang = piutang.some((p) =>
        p.collectionLinks.some((l) => l.collectionNote.status === 'BERJALAN'),
      );
      if (sudahDipegang) return { ok: false as const, alasan: 'SUDAH_DI_KONTRABON' as const };

      const sisaPerPiutang = new Map<string, number>();
      for (const p of piutang) {
        sisaPerPiutang.set(p.id, await hitungUlangPiutang(tx, p.id));
      }
      // Menyerahkan faktur yang sudah lunas berarti menagih uang yang sudah
      // masuk. Ditolak seluruhnya, bukan disaring diam-diam, supaya yang
      // menyusun tanda terima tahu daftarnya sudah basi.
      if ([...sisaPerPiutang.values()].some((s) => s === 0)) {
        return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };
      }

      const nilai = [...sisaPerPiutang.values()].reduce((a, b) => a + b, 0);
      const docNo = await nomorBerikutnya(tx, 'TT', input.handoverDate.getFullYear());

      const nota = await tx.collectionNote.create({
        data: {
          docNo,
          storeId: piutang[0].storeId,
          salesmanId: input.salesmanId,
          handoverDate: input.handoverDate,
          promisedDate: input.promisedDate,
          receivedBy: input.receivedBy?.trim() || null,
          note: input.note?.trim() || null,
          amount: new Prisma.Decimal(nilai),
          status: 'BERJALAN',
          receivableLinks: {
            create: ids.map((id) => ({
              receivableId: id,
              amount: new Prisma.Decimal(sisaPerPiutang.get(id) ?? 0),
            })),
          },
        },
        select: { id: true, docNo: true },
      });

      return { ok: true as const, id: nota.id, docNo: nota.docNo, nilai };
    });
  } catch (err) {
    // Nomor kembar dari dua penyimpanan bersamaan. Pemanggil boleh mencoba lagi;
    // percobaan berikutnya membaca nomor terakhir yang sudah bergerak.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

export type HasilTutupKontrabon =
  | { ok: true; status: 'SELESAI' | 'BATAL' }
  | { ok: false; alasan: 'TIDAK_DITEMUKAN' | 'SUDAH_DITUTUP' | 'MASIH_ADA_SISA' | 'ALASAN_WAJIB' };

/**
 * Tutup kontrabon — selesai kalau semua piutangnya sudah lunas, batal kalau
 * fakturnya ditarik kembali dari toko.
 *
 * Membatalkan menuntut alasan: kontrabon yang hilang tanpa jejak membuat sales
 * dan admin berdebat tentang faktur yang sebenarnya masih di tangan toko.
 */
export async function tutupKontrabon(input: {
  collectionNoteId: string;
  keputusan: 'SELESAI' | 'BATAL';
  catatan?: string | null;
}): Promise<HasilTutupKontrabon> {
  if (input.keputusan === 'BATAL' && !input.catatan?.trim()) {
    return { ok: false, alasan: 'ALASAN_WAJIB' };
  }

  return runSerializable(async (tx) => {
    const nota = await tx.collectionNote.findUnique({
      where: { id: input.collectionNoteId },
      select: {
        id: true,
        status: true,
        note: true,
        receivableLinks: { select: { receivableId: true } },
      },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status !== 'BERJALAN') return { ok: false as const, alasan: 'SUDAH_DITUTUP' as const };

    if (input.keputusan === 'SELESAI') {
      // Sisa dihitung ulang, bukan dibaca dari kolom — menandai selesai adalah
      // pernyataan bahwa uangnya sudah masuk, dan itu harus benar saat ini juga.
      for (const link of nota.receivableLinks) {
        const sisa = await hitungUlangPiutang(tx, link.receivableId);
        if (sisa > 0) return { ok: false as const, alasan: 'MASIH_ADA_SISA' as const };
      }
    }

    await tx.collectionNote.update({
      where: { id: nota.id },
      data: {
        status: input.keputusan,
        note: input.catatan?.trim()
          ? [nota.note, input.catatan.trim()].filter(Boolean).join('\n')
          : nota.note,
      },
    });

    return { ok: true as const, status: input.keputusan };
  });
}
