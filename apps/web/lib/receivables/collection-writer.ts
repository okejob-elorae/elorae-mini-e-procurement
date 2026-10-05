import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { penagihPiutang } from '@/lib/stores/penanggung-jawab';
import { bentrokKunciKiriman } from './idempoten';
import { denganNomorUnik } from './nomor';
import { hitungUlangPiutang } from './writer';
import { tanggalWib } from '@/lib/dashboard/hari-wib';
import { catatJejak, JEJAK } from './jejak';
import { fotoBolehDipakai } from './foto-pencatat';
import { PERMISSIONS } from '@/lib/rbac';

/**
 * Penulis kontrabon (tanda terima / TT).
 *
 * Kontrabon adalah bukti bahwa faktur fisik sudah diserahkan ke toko dan toko
 * berjanji membayar pada tanggal tertentu. Ia TIDAK mengurangi piutang sepeser
 * pun — yang mengurangi piutang hanya klaim yang terverifikasi. Kontrabon cuma
 * memindahkan piutang dari keadaan "belum ditagih" ke "sudah dipegang toko".
 */

type Klien = Prisma.TransactionClient;

/** Yang boleh memakai foto unggahan orang lain di kontrabon: pengelola piutang. */
const IZIN_KANTOR = [PERMISSIONS.RECEIVABLES_MANAGE];

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
  | 'NOMOR_BENTROK'
  | 'BUKAN_PENAGIH'
  | 'FOTO_WAJIB'
  /** Foto `/api/foto/<id>` diunggah orang lain, dan pencatat bukan pengelola piutang. */
  | 'FOTO_BUKAN_MILIK'
  | 'PENERIMA_WAJIB'
  | 'KUNCI_DIPAKAI';

/**
 * Asal kontrabon. `OFFICE` = disusun admin di kantor. `FIELD` = janji bayar /
 * tukar faktur yang dicatat salesman di depan toko — langsung berlaku untuk
 * penagihan (ia yang membuat "lewat janji" bisa terdeteksi), tapi berstatus
 * "belum dikonfirmasi" sampai kantor mencocokkan foto tanda terimanya.
 */
export type SumberKontrabon = 'OFFICE' | 'FIELD';

/**
 * Nama jejak untuk konfirmasi kantor atas kontrabon lapangan.
 *
 * Tempat yang benar adalah `JEJAK.KONTRABON_DIKONFIRMASI` di `jejak.ts`. Berkas
 * itu di luar lingkup perubahan ini, jadi namanya ditulis di SATU tempat ini
 * saja — dan harus diganti ke sana begitu entrinya ada, supaya daftar nama
 * jejak tetap satu.
 */

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
  photoUrl?: string | null;
  note?: string | null;
  /** Bawaan `OFFICE`. */
  source?: SumberKontrabon;
  /**
   * Kalau diisi, SETIAP faktur harus ditagih orang ini menurut aturan penagih
   * (pemegang toko sekarang, atau penjualnya selama toko belum punya pemegang).
   * Laporan lapangan selalu mengisinya: layar HP sudah menyaring, tapi layar
   * bukan penjaga — kiriman dari antrean bisa tiba setelah tokonya dirotasi.
   */
  penagihId?: string | null;
  /** Kunci kiriman dari antrean offline HP. Kontrabon kantor tidak membawanya. */
  idempotencyKey?: string | null;
}): Promise<HasilKontrabon> {
  if (input.receivableIds.length === 0) return { ok: false, alasan: 'TANPA_PIUTANG' };
  // Janji bayar sebelum tanggal serah tidak punya arti apa pun di lapangan, dan
  // akan langsung tampil "lewat tempo" pada hari faktur diserahkan.
  if (input.promisedDate < input.handoverDate) {
    return { ok: false, alasan: 'JANJI_SEBELUM_SERAH' };
  }

  const sumber: SumberKontrabon = input.source ?? 'OFFICE';
  if (sumber === 'FIELD') {
    /*
     * Janji dari lapangan hanya bisa dikonfirmasi kantor lewat lembar yang
     * ditandatangani toko. Tanpa foto dan nama penandatangan, "toko janji bayar
     * tanggal 15" adalah kalimat yang tidak bisa dibuktikan maupun dibantah —
     * padahal ia langsung menggeser keadaan fakturnya.
     */
    if (!input.photoUrl?.trim()) return { ok: false, alasan: 'FOTO_WAJIB' };
    if (!input.receivedBy?.trim()) return { ok: false, alasan: 'PENERIMA_WAJIB' };
  }

  const ids = [...new Set(input.receivableIds)];
  const kunci = input.idempotencyKey?.trim() || null;

  const simpan = () =>
    denganNomorUnik(() =>
      runSerializable(async (tx) => {
        /*
         * Kiriman ulang dikenali PALING DULU, sebelum faktur diperiksa: kiriman
         * pertama sudah mengunci fakturnya, jadi memeriksanya lagi menjawab
         * "sudah di kontrabon" — dan sales mengira laporannya hilang. Kunci
         * milik orang lain tidak pernah menyerahkan kontrabon orang itu.
         */
        if (kunci) {
          const ada = await tx.collectionNote.findUnique({
            where: { idempotencyKey: kunci },
            select: { id: true, docNo: true, salesmanId: true, amount: true },
          });
          if (ada) {
            return ada.salesmanId === input.salesmanId
              ? { ok: true as const, id: ada.id, docNo: ada.docNo, nilai: Number(ada.amount) }
              : { ok: false as const, alasan: 'KUNCI_DIPAKAI' as const };
          }
        }

        // Foto lembar harus unggahan pencatatnya sendiri, kecuali pengelola
        // piutang — lihat `fotoBolehDipakai`.
        if (!(await fotoBolehDipakai(tx, { urls: [input.photoUrl], userId: input.salesmanId, izinKantor: IZIN_KANTOR }))) {
          return { ok: false as const, alasan: 'FOTO_BUKAN_MILIK' as const };
        }

        const piutang = await tx.receivable.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            storeId: true,
            salesmanId: true,
            store: { select: { salesmanId: true } },
            collectionLinks: {
              select: { collectionNote: { select: { status: true } } },
            },
          },
        });
        if (piutang.length !== ids.length) {
          return { ok: false as const, alasan: 'PIUTANG_TIDAK_DITEMUKAN' as const };
        }

        const penagih = input.penagihId;
        if (
          penagih &&
          piutang.some(
            (p) =>
              penagihPiutang({
                penanggungJawabId: p.store?.salesmanId ?? null,
                penjualId: p.salesmanId ?? '',
              }) !== penagih,
          )
        ) {
          return { ok: false as const, alasan: 'BUKAN_PENAGIH' as const };
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
        // Tahun WIB, bukan tahun jam server: serah terima 1 Januari WIB disimpan
        // 31 Desember 17.00 UTC, dan `getFullYear()` di server UTC memberi tahun lalu.
        const docNo = await nomorBerikutnya(tx, 'TT', Number(tanggalWib(input.handoverDate).slice(0, 4)));

        const nota = await tx.collectionNote.create({
          data: {
            docNo,
            storeId: piutang[0].storeId,
            salesmanId: input.salesmanId,
            handoverDate: input.handoverDate,
            promisedDate: input.promisedDate,
            receivedBy: input.receivedBy?.trim() || null,
            photoUrl: input.photoUrl?.trim() || null,
            note: input.note?.trim() || null,
            amount: new Prisma.Decimal(nilai),
            status: 'BERJALAN',
            source: sumber,
            idempotencyKey: kunci,
            receivableLinks: {
              create: ids.map((id) => ({
                receivableId: id,
                amount: new Prisma.Decimal(sisaPerPiutang.get(id) ?? 0),
              })),
            },
          },
          select: { id: true, docNo: true },
        });

        await catatJejak(tx, {
          userId: input.salesmanId,
          action: JEJAK.KONTRABON_DIBUAT,
          entityType: 'CollectionNote',
          entityId: nota.id,
          // Membuat kontrabon mengunci fakturnya dari kontrabon lain sampai
          // ditutup. Siapa yang menguncinya harus bisa ditanyakan.
          changes: { after: { docNo: nota.docNo, amount: nilai, storeId: piutang[0].storeId } },
          metadata: {
            jumlahFaktur: ids.length,
            promisedDate: input.promisedDate.toISOString(),
            sumber,
          },
        });

        return { ok: true as const, id: nota.id, docNo: nota.docNo, nilai };
      }),
    );

  try {
    try {
      return await simpan();
    } catch (err) {
      // Kiriman kembarnya menang lebih dulu. Percobaan ini membaca kuncinya
      // yang kini sudah tercatat dan mengembalikan kontrabon yang sama.
      if (!bentrokKunciKiriman(err)) throw err;
      return await simpan();
    }
  } catch (err) {
    // Sisa terakhir setelah `denganNomorUnik` kalah tiga kali berturut-turut.
    // Tiga kekalahan beruntun bukan lagi tabrakan kebetulan, jadi kabarnya
    // memang harus sampai ke layar dan bukan diulang lagi diam-diam.
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
  olehUserId: string;
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
        docNo: true,
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

    await catatJejak(tx, {
      userId: input.olehUserId,
      action:
        input.keputusan === 'SELESAI' ? JEJAK.KONTRABON_SELESAI : JEJAK.KONTRABON_DIBATALKAN,
      entityType: 'CollectionNote',
      entityId: nota.id,
      // Membatalkan membebaskan fakturnya untuk kontrabon lain. Tanpa jejak,
      // sebuah tanda terima bisa hilang dan tidak ada yang bisa menunjukkan
      // bahwa toko pernah memegangnya.
      changes: { before: { status: nota.status }, after: { status: input.keputusan } },
      metadata: { docNo: nota.docNo, jumlahFaktur: nota.receivableLinks.length },
      reason: input.catatan,
    });

    return { ok: true as const, status: input.keputusan };
  });
}

/**
 * Pasang atau ganti foto lembar kontrabon.
 *
 * Terpisah dari pembuatannya karena urutannya di lapangan memang begitu: tanda
 * terima dibuat di kantor, kertasnya ditandatangani di toko, fotonya menyusul.
 * Memaksa fotonya ada saat pembuatan berarti kontrabon tidak bisa dibuat
 * sebelum sales berangkat.
 */
export async function pasangFotoKontrabon(input: {
  collectionNoteId: string;
  photoUrl: string;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; alasan: AlasanGagalKontrabon | 'TIDAK_DITEMUKAN' }> {
  return runSerializable(async (tx) => {
    const nota = await tx.collectionNote.findUnique({
      where: { id: input.collectionNoteId },
      select: { id: true, docNo: true, photoUrl: true },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    // Mengganti bukti dengan foto orang lain sama saja dengan pencucian foto.
    if (!(await fotoBolehDipakai(tx, { urls: [input.photoUrl], userId: input.olehUserId, izinKantor: IZIN_KANTOR }))) {
      return { ok: false as const, alasan: 'FOTO_BUKAN_MILIK' as const };
    }

    await tx.collectionNote.update({
      where: { id: nota.id },
      data: { photoUrl: input.photoUrl.trim() },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTRABON_FOTO,
      entityType: 'CollectionNote',
      entityId: nota.id,
      // Mengganti foto menimpa bukti sebelumnya. Yang lama hanya hidup di sini.
      changes: { before: { photoUrl: nota.photoUrl }, after: { photoUrl: input.photoUrl } },
      metadata: { docNo: nota.docNo },
    });

    return { ok: true as const };
  });
}

export type HasilKonfirmasiKontrabon =
  | { ok: true; docNo: string; salesmanId: string; storeId: string }
  | {
      ok: false;
      alasan: 'TIDAK_DITEMUKAN' | 'BUKAN_DARI_LAPANGAN' | 'SUDAH_DIKONFIRMASI' | 'SUDAH_DITUTUP';
    };

/**
 * Kantor mengonfirmasi janji bayar yang dicatat salesman di lapangan.
 *
 * Konfirmasi TIDAK mengubah apa pun tentang uang atau penagihan: kontrabon
 * lapangan sudah berlaku sejak dicatat, karena janji yang terlewat harus
 * terdeteksi walau kantor belum sempat melihatnya. Yang dinyatakan konfirmasi
 * hanyalah bahwa seseorang di kantor sudah mencocokkan foto lembar yang
 * ditandatangani toko dengan faktur yang disebut — sehingga "janji" itu bukan
 * lagi kata sales seorang.
 *
 * Kontrabon kantor tidak bisa dikonfirmasi: ia disusun kantor sendiri, dan
 * mengonfirmasinya akan membuat penyaring "belum dikonfirmasi" tidak berarti.
 */
export async function konfirmasiKontrabon(input: {
  collectionNoteId: string;
  olehUserId: string;
}): Promise<HasilKonfirmasiKontrabon> {
  return runSerializable(async (tx) => {
    const nota = await tx.collectionNote.findUnique({
      where: { id: input.collectionNoteId },
      select: {
        id: true,
        docNo: true,
        status: true,
        source: true,
        confirmedAt: true,
        salesmanId: true,
        storeId: true,
      },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.source !== 'FIELD') return { ok: false as const, alasan: 'BUKAN_DARI_LAPANGAN' as const };
    if (nota.confirmedAt) return { ok: false as const, alasan: 'SUDAH_DIKONFIRMASI' as const };
    // Yang sudah ditutup tidak lagi menunggu apa-apa dari kantor.
    if (nota.status !== 'BERJALAN') return { ok: false as const, alasan: 'SUDAH_DITUTUP' as const };

    const sekarang = new Date();
    // Bertanding-lalu-tukar: dua admin yang menekan bersamaan tidak menulis dua
    // stempel dan dua jejak — yang kalah membaca nol baris dan ditolak.
    const hasil = await tx.collectionNote.updateMany({
      where: { id: nota.id, confirmedAt: null },
      data: { confirmedAt: sekarang, confirmedById: input.olehUserId },
    });
    if (hasil.count !== 1) return { ok: false as const, alasan: 'SUDAH_DIKONFIRMASI' as const };

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONTRABON_DIKONFIRMASI,
      entityType: 'CollectionNote',
      entityId: nota.id,
      changes: {
        before: { confirmedAt: null, confirmedById: null },
        after: { confirmedAt: sekarang.toISOString(), confirmedById: input.olehUserId },
      },
      metadata: { docNo: nota.docNo, salesmanId: nota.salesmanId },
    });

    return {
      ok: true as const,
      docNo: nota.docNo,
      salesmanId: nota.salesmanId,
      storeId: nota.storeId,
    };
  });
}
