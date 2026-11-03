import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatJejak, JEJAK } from '../jejak';
import type { BarisImpor } from './baris';
import { bacaTanggalMulaiTagihan, tagihanSesudahMulaiBuku } from '../gerbang-tanggal-mulai';
import { muatBulanSiklusPertama } from "@/lib/konsinyasi/siklus-pertama";
import { fakturKonsiLewatSiklusPertama } from "@/lib/konsinyasi/siklus-pertama-aturan";

/**
 * Penyimpan hasil impor faktur.
 *
 * Dijalankan setelah pengguna meninjau. Yang bermasalah TIDAK diam-diam
 * diperbaiki di sini — ia dilewati dan dilaporkan, karena menebak nilai uang
 * atau tanggal tagih atas nama pengguna adalah cara tercepat membuat tagihan
 * yang tidak pernah ada.
 */

const D = (n: number) => new Prisma.Decimal(n);

/** `status` modul pembayaran kantor untuk faktur yang diimpor: dari sisa terhadap nilainya, dalam sen. */
function statusImpor(nilai: number, sisa: number): 'OUTSTANDING' | 'PARTIAL' | 'PAID' {
  const sisaSen = Math.round(sisa * 100);
  if (sisaSen <= 0) return 'PAID';
  return sisaSen < Math.round(nilai * 100) ? 'PARTIAL' : 'OUTSTANDING';
}

export type AlasanLewat =
  | 'BARIS_BERMASALAH'
  | 'TOKO_TIDAK_DITEMUKAN'
  /** Utang toko konsinyasi bertanggal pada/sesudah bulan siklus pertama di sistem (P59) — bulan itu ditagih siklus. */
  | "KONSI_SESUDAH_SIKLUS_PERTAMA"
  | 'SUDAH_ADA'
  | 'LUNAS'
  /** Bertanggal pada/sesudah tanggal mulai buku besar — tagihan barang sejak itu hanya lewat nota tagihan. */
  | 'SESUDAH_TANGGAL_MULAI';

export type HasilImpor = {
  masuk: number;
  dilewati: { baris: number; noFaktur: string; alasan: AlasanLewat }[];
  /** Id faktur yang dibuat — untuk kait jurnal pasca-commit (tidak dikirim ke layar). */
  ids?: string[];
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
  tanggalMulai: string | null;
  /** Bulan siklus konsinyasi pertama di sistem ("YYYY-MM"), atau null kalau belum diatur. */
  siklusPertama: string | null;
};

async function muatKonteks(noFaktur: string[]): Promise<Konteks> {
  const [toko, ada, tanggalMulai, pertama] = await Promise.all([
    prisma.store.findMany({ select: { id: true, code: true, name: true, termsType: true } }),
    prisma.receivable.findMany({
      where: { invoiceNo: { in: noFaktur } },
      select: { invoiceNo: true },
    }),
    bacaTanggalMulaiTagihan(prisma),
    muatBulanSiklusPertama(prisma),
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
    tanggalMulai,
    siklusPertama: pertama.diatur ? pertama.bulan : null,
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

function nilaiBaris(
  b: BarisImpor,
  k: Konteks,
): { ok: true; storeId: string; konsi: boolean } | { ok: false; alasan: AlasanLewat } {
  if (b.masalah.length > 0) return { ok: false, alasan: 'BARIS_BERMASALAH' };
  if (k.fakturAda.has(b.noFaktur)) return { ok: false, alasan: 'SUDAH_ADA' };

  const toko = cariToko(b, k);
  if (!toko) return { ok: false, alasan: 'TOKO_TIDAK_DITEMUKAN' };

  // Sisa nol berarti fakturnya memang sudah lunas; ia tidak perlu dibuat
  // sebagai piutang hidup, dan membuatnya akan menagih uang yang sudah masuk.
  if (b.sisa === 0) return { ok: false, alasan: 'LUNAS' };

  // Impor memindahkan tagihan LAMA. Yang bertanggal pada/sesudah tanggal mulai
  // buku besar adalah penjualan baru tanpa barang — sejak itu penagihan barang
  // hanya lewat nota tagihan pengiriman (pemilik, 2026-10-08). Tanggal yang
  // dinilai sama dengan yang akan disimpan sebagai tanggal faktur.
  const tanggal = b.tglFaktur ?? b.jatuhTempo;
  if (tanggal && tagihanSesudahMulaiBuku(tanggal, k.tanggalMulai)) return { ok: false, alasan: 'SESUDAH_TANGGAL_MULAI' };

  /*
   * Toko konsinyasi DITERIMA (P32: utang toko konsi di kertas boleh masuk lewat
   * impor), ditandai `isConsignment`. Yang bertanggal pada/sesudah bulan siklus
   * pertama di sistem dilewati (P59): bulan itu dan sesudahnya ditagih siklus,
   * jadi menerimanya di sini menagih bulan yang sama dua kali. Di sini dibaca
   * sekali untuk pratinjau; `simpanImpor` membacanya LAGI di dalam transaksi
   * serializable (`konsiTertolakDiTransaksi`), karena pengaturan yang disimpan
   * di antara keduanya tidak boleh lolos.
   */
  if (toko.konsi && tanggal && fakturKonsiLewatSiklusPertama(tanggal, k.siklusPertama)) {
    return { ok: false, alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA" };
  }

  return { ok: true, storeId: toko.id, konsi: toko.konsi };
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

  const siap: { b: BarisImpor; storeId: string; konsi: boolean }[] = [];
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
    siap.push({ b, storeId: hasil.storeId, konsi: hasil.konsi });
  }

  if (siap.length === 0) return { masuk: 0, dilewati, ids: [] };

  const tersimpan = await runSerializable(async (tx) => {
    /*
     * Gerbang P59 dibaca ulang DI DALAM transaksi. `aturBulanSiklusPertama` yang
     * tersimpan sesudah `muatKonteks` di atas belum melihat faktur impor ini
     * (pemeriksaan ADA_TAGIHAN_KONSI_LAMA_SESUDAHNYA-nya), jadi tanpa bacaan
     * ini faktur konsi bertanggal sejak bulan itu lolos dan bulan itu tertagih
     * dua kali: lewat impor dan lewat siklusnya. Sama dengan `tulisPiutangManual`.
     * Dikumpulkan per percobaan — `runSerializable` bisa mengulang callback ini.
     */
    const pertama = siap.some((s) => s.konsi) ? await muatBulanSiklusPertama(tx) : null;
    const bulanPertama = pertama?.diatur ? pertama.bulan : null;
    const dibuat: string[] = [];
    const lewatDiTransaksi: HasilImpor["dilewati"] = [];
    for (const { b, storeId, konsi } of siap) {
      const tanggal = b.tglFaktur ?? b.jatuhTempo;
      if (konsi && tanggal && fakturKonsiLewatSiklusPertama(tanggal, bulanPertama)) {
        lewatDiTransaksi.push({ baris: b.baris, noFaktur: b.noFaktur, alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA" });
        continue;
      }
      const baru = await tx.receivable.create({
        data: {
          invoiceNo: b.noFaktur,
          storeId,
          salesmanId: opts.salesmanId ?? null,
          invoiceDate: b.tglFaktur ?? b.jatuhTempo!,
          dueDate: b.jatuhTempo!,
          amount: D(b.nilai!),
          outstanding: D(b.sisa!),
          // Yang sudah dibayar sebelum impor disimpan sendiri, bukan hanya
          // tersirat di `outstanding`: kolom itu cache dan ditimpa setiap
          // perhitungan ulang, sedangkan yang ini ikut dikurangkan
          // `hitungSisaPiutang` sehingga faktur tidak kembali bernilai penuh.
          // Lewat Decimal, bukan selisih float: 1.250.000,75 − 250.000,50 tidak
          // boleh menyisakan pecahan sen palsu.
          paidBeforeImport: Prisma.Decimal.max(0, D(b.nilai!).minus(b.sisa!)),
          settledAt: null,
          // Kolom yang dibaca layar pembayaran kantor (Keuangan → Piutang).
          // `paidAmount` tetap 0: kolom itu hanya uang yang dialokasikan lewat
          // pembayaran kantor, dan yang dibayar sebelum impor sudah ada di
          // `paidBeforeImport`.
          originalAmount: D(b.nilai!),
          outstandingAmount: D(b.sisa!),
          status: statusImpor(b.nilai!, b.sisa!),
          source: 'IMPORT',
          isConsignment: konsi,
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
     * Impor yang seluruh barisnya tertolak di sini tidak mencatat apa pun —
     * sama dengan impor yang tidak punya baris siap sama sekali.
     */
    if (dibuat.length > 0) {
      const semuaLewat = [...dilewati, ...lewatDiTransaksi];
      await catatJejak(tx, {
        userId: opts.olehUserId,
        action: JEJAK.FAKTUR_IMPOR,
        entityType: "Receivable",
        entityId: dibuat[0],
        changes: { after: { masuk: dibuat.length, dilewati: semuaLewat.length } },
        metadata: {
          receivableIds: dibuat,
          alasanDilewati: semuaLewat.map((d) => ({ baris: d.baris, alasan: d.alasan })),
        },
      });
    }
    return { dibuat, lewatDiTransaksi };
  });

  dilewati.push(...tersimpan.lewatDiTransaksi);
  dilewati.sort((a, b) => a.baris - b.baris);
  return { masuk: tersimpan.dibuat.length, dilewati, ids: tersimpan.dibuat };
}
