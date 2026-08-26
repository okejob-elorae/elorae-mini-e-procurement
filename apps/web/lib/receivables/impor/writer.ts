import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatJejak, JEJAK } from '../jejak';
import type { BarisImpor } from './baris';

/**
 * Penyimpan hasil impor faktur.
 *
 * Dijalankan setelah pengguna meninjau. Yang bermasalah TIDAK diam-diam
 * diperbaiki di sini — ia dilewati dan dilaporkan, karena menebak nilai uang
 * atau tanggal tagih atas nama pengguna adalah cara tercepat membuat tagihan
 * yang tidak pernah ada.
 */

const D = (n: number) => new Prisma.Decimal(n);

export type AlasanLewat =
  | 'BARIS_BERMASALAH'
  | 'TOKO_TIDAK_DITEMUKAN'
  | 'TOKO_KONSI'
  | 'SUDAH_ADA'
  | 'LUNAS';

export type HasilImpor = {
  masuk: number;
  dilewati: { baris: number; noFaktur: string; alasan: AlasanLewat }[];
};

export type TinjauanImpor = {
  siap: number;
  akanDilewati: { baris: number; noFaktur: string; alasan: AlasanLewat }[];
  totalNilai: number;
  totalSisa: number;
};

type Konteks = {
  tokoPerKode: Map<string, { id: string; konsi: boolean }>;
  tokoPerNama: Map<string, { id: string; konsi: boolean }>;
  fakturAda: Set<string>;
};

async function muatKonteks(noFaktur: string[]): Promise<Konteks> {
  const [toko, ada] = await Promise.all([
    prisma.store.findMany({ select: { id: true, code: true, name: true, termsType: true } }),
    prisma.receivable.findMany({
      where: { invoiceNo: { in: noFaktur } },
      select: { invoiceNo: true },
    }),
  ]);

  const tokoPerKode = new Map<string, { id: string; konsi: boolean }>();
  const tokoPerNama = new Map<string, { id: string; konsi: boolean }>();
  for (const s of toko) {
    const nilai = { id: s.id, konsi: s.termsType === 'KONSI' };
    if (s.code) tokoPerKode.set(s.code.trim().toLowerCase(), nilai);
    tokoPerNama.set(s.name.trim().toLowerCase(), nilai);
  }

  return {
    tokoPerKode,
    tokoPerNama,
    fakturAda: new Set(ada.map((r) => r.invoiceNo)),
  };
}

/**
 * Cocokkan baris ke sebuah toko.
 *
 * Kode lebih dulu, baru nama. Nama toko diketik ulang orang di setiap berkas
 * dan sering berbeda ejaan; kodenya tidak.
 */
function cariToko(b: BarisImpor, k: Konteks) {
  if (b.kodeToko) {
    const lewatKode = k.tokoPerKode.get(b.kodeToko.trim().toLowerCase());
    if (lewatKode) return lewatKode;
  }
  if (b.namaToko) return k.tokoPerNama.get(b.namaToko.trim().toLowerCase());
  return undefined;
}

function nilaiBaris(b: BarisImpor, k: Konteks): { ok: true; storeId: string } | { ok: false; alasan: AlasanLewat } {
  if (b.masalah.length > 0) return { ok: false, alasan: 'BARIS_BERMASALAH' };
  if (k.fakturAda.has(b.noFaktur)) return { ok: false, alasan: 'SUDAH_ADA' };

  const toko = cariToko(b, k);
  if (!toko) return { ok: false, alasan: 'TOKO_TIDAK_DITEMUKAN' };
  /*
   * Toko konsinyasi ditolak. Barang di sana masih milik kita sampai terjual,
   * jadi tidak ada piutang yang bisa lahir dari toko itu — sebuah berkas yang
   * memuatnya hampir pasti mencampur pengiriman titipan dengan penjualan.
   */
  if (toko.konsi) return { ok: false, alasan: 'TOKO_KONSI' };

  // Sisa nol berarti fakturnya memang sudah lunas; ia tidak perlu dibuat
  // sebagai piutang hidup, dan membuatnya akan menagih uang yang sudah masuk.
  if (b.sisa === 0) return { ok: false, alasan: 'LUNAS' };

  return { ok: true, storeId: toko.id };
}

/** Ringkasan sebelum menyimpan: berapa yang akan masuk, dan apa yang tidak. */
export async function tinjauImpor(baris: BarisImpor[]): Promise<TinjauanImpor> {
  const k = await muatKonteks(baris.map((b) => b.noFaktur).filter(Boolean));

  let siap = 0;
  let totalNilai = 0;
  let totalSisa = 0;
  const akanDilewati: TinjauanImpor['akanDilewati'] = [];

  for (const b of baris) {
    const hasil = nilaiBaris(b, k);
    if (!hasil.ok) {
      akanDilewati.push({ baris: b.baris, noFaktur: b.noFaktur, alasan: hasil.alasan });
      continue;
    }
    siap += 1;
    totalNilai += b.nilai ?? 0;
    totalSisa += b.sisa ?? 0;
  }

  return { siap, akanDilewati, totalNilai, totalSisa };
}

/** Simpan baris yang lolos. Yang tidak lolos dilaporkan, bukan diperbaiki. */
export async function simpanImpor(
  baris: BarisImpor[],
  opts: { olehUserId: string; salesmanId?: string | null },
): Promise<HasilImpor> {
  const k = await muatKonteks(baris.map((b) => b.noFaktur).filter(Boolean));

  const siap: { b: BarisImpor; storeId: string }[] = [];
  const dilewati: HasilImpor['dilewati'] = [];
  // Nomor faktur kembar DI DALAM berkas yang sama juga ditolak — kalau tidak,
  // baris kedua lolos pemeriksaan "sudah ada" dan menciptakan duplikat.
  const terlihat = new Set<string>();

  for (const b of baris) {
    const hasil = nilaiBaris(b, k);
    if (!hasil.ok) {
      dilewati.push({ baris: b.baris, noFaktur: b.noFaktur, alasan: hasil.alasan });
      continue;
    }
    if (terlihat.has(b.noFaktur)) {
      dilewati.push({ baris: b.baris, noFaktur: b.noFaktur, alasan: 'SUDAH_ADA' });
      continue;
    }
    terlihat.add(b.noFaktur);
    siap.push({ b, storeId: hasil.storeId });
  }

  if (siap.length === 0) return { masuk: 0, dilewati };

  await runSerializable(async (tx) => {
    const dibuat: string[] = [];
    for (const { b, storeId } of siap) {
      const baru = await tx.receivable.create({
        data: {
          invoiceNo: b.noFaktur,
          storeId,
          salesmanId: opts.salesmanId ?? null,
          invoiceDate: b.tglFaktur ?? b.jatuhTempo!,
          dueDate: b.jatuhTempo!,
          amount: D(b.nilai!),
          outstanding: D(b.sisa!),
          settledAt: null,
          source: 'IMPORT',
        },
        select: { id: true },
      });
      dibuat.push(baru.id);
    }

    /*
     * SATU jejak untuk seluruh impor, bukan satu per faktur.
     *
     * Yang perlu bisa ditelusuri adalah tindakannya — siapa mengimpor berkas
     * apa, kapan, dan berapa yang masuk. Dua ratus jejak identik hanya
     * mengubur jejak lain, dan tidak menambah satu pun fakta baru.
     *
     * Impor belum bisa dibatalkan lewat layar, jadi daftar id yang dibuat
     * disimpan di sini — itulah yang dibutuhkan untuk membatalkannya nanti,
     * dan tanpa itu satu-satunya jalan adalah menebak dari waktu pembuatan.
     */
    await catatJejak(tx, {
      userId: opts.olehUserId,
      action: JEJAK.FAKTUR_IMPOR,
      entityType: 'Receivable',
      entityId: dibuat[0] ?? 'batch',
      changes: { after: { masuk: dibuat.length, dilewati: dilewati.length } },
      metadata: {
        receivableIds: dibuat,
        alasanDilewati: dilewati.map((d) => ({ baris: d.baris, alasan: d.alasan })),
      },
    });
  });

  return { masuk: siap.length, dilewati };
}
