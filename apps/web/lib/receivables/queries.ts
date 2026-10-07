import { prisma } from '@elorae/db';
import {
  hitungSisaPiutang,
  keadaanPiutang,
  nilaiDiakui,
  returTertahan,
  selisihHari,
  sisaBolehDilunasi,
  tertahanPiutang,
  type KeadaanPiutang,
  type StatusKlaim,
} from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';
import { hariLewatJatuhTempo, keadaanTampil, type KeadaanTampil } from './jatuh-tempo';

/**
 * Baris piutang siap tampil, lengkap dengan keadaannya dan bahan untuk
 * menyusun kalimat alasan.
 *
 * Kalimat alasannya dirakit di sisi klien dari `alasan`, bukan disimpan sebagai
 * teks jadi — supaya ikut berganti bahasa bersama sisa aplikasi.
 */
export type BarisPiutang = {
  id: string;
  invoiceNo: string;
  storeId: string;
  storeName: string;
  salesmanName: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  outstanding: number;
  /**
   * Yang masih boleh dilunasi BKM baru: sisa dikurangi bagian yang sedang
   * ditahan potongan retur BKM terverifikasi (`sisaBolehDilunasi`). Penulis BKM
   * menolak yang melebihinya dengan `RETUR_DITAHAN`.
   */
  bolehDilunasi: number;
  source: string;
  keadaan: KeadaanPiutang;
  /**
   * Keadaan untuk layar kantor: enam keadaan uang ditambah `jatuh_tempo` —
   * faktur `belum` yang jatuh temponya sudah lewat (`lib/receivables/jatuh-tempo.ts`).
   */
  keadaanTampil: KeadaanTampil;
  alasan: {
    noKlaim?: string;
    /** Semua BKM yang masih menunggu verifikasi atas faktur ini (nomornya). */
    klaimMenunggu?: string[];
    /**
     * Siapa yang melaporkan BKM `noKlaim`: salesnya kalau dilaporkan dari
     * lapangan, pencatatnya kalau dicatat kantor atas nama sales.
     */
    pelaporKlaim?: string | null;
    nilaiTertahan?: number;
    noKontrabon?: string;
    janjiBayar?: string;
    hariTerlambat?: number;
    /** Hari kalender WIB sejak jatuh tempo — hanya untuk `jatuh_tempo`. */
    hariLewatJatuhTempo?: number;
  };
};

/** Ubah Decimal Prisma ke number. Aturan uang sengaja tidak menyentuh Decimal. */
const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Daftar piutang beserta keadaannya.
 *
 * Sisa yang tersimpan di kolom `outstanding` TIDAK dipercaya di sini — dihitung
 * ulang dari klaim yang menyentuhnya, sesuai aturan bahwa sisa tidak pernah
 * diketik dan tidak pernah dikurangi bertahap. Kolomnya tetap ada sebagai
 * cache untuk penyaringan cepat, bukan sebagai kebenaran.
 */
export type LingkupPiutang = {
  /** Penjual faktur (`Receivable.salesmanId`). Untuk layar kantor. */
  salesmanId?: string;
  /**
   * Yang MENAGIH: pemegang toko sekarang (`Store.salesmanId`), atau penjual
   * aslinya selama toko belum punya pemegang. Keputusan pemilik — toko yang
   * dirotasi, sales baru membantu menagih faktur sales lama. Layar sales
   * memakai ini, bukan `salesmanId`. Aturannya (murni, dites):
   * `penagihPiutang` di `lib/stores/penanggung-jawab.ts`. DITAMBAH faktur di tugas
   * tagih TERBUKA yang ditugaskan kantor ke orang ini (`fakturTugasTagihTerbuka`).
   */
  penagihId?: string;
  /** Hanya piutang tertentu — dipakai layar yang menampilkan satu dokumen. */
  receivableIds?: string[];
  storeId?: string;
  /**
   * Hanya yang kolom `outstanding`-nya masih di atas nol.
   *
   * Penyaringan KASAR, memakai kolom cache. Ia hanya boleh dipakai pemanggil
   * yang memang cuma butuh yang terbuka — memilih faktur untuk kontrabon atau
   * BKM — karena satu-satunya risikonya adalah baris yang sudah lunas ikut
   * terbawa lalu tersaring lagi setelah dihitung ulang. Arah sebaliknya tidak
   * mungkin: penulisnya selalu menulis kolom ini saat sisanya berubah, jadi
   * yang benar-benar terbuka tidak akan pernah tersaring keluar.
   */
  hanyaTerbuka?: boolean;
};

/**
 * Faktur di tugas tagih TERBUKA yang ditugaskan kantor ke orang ini.
 *
 * Kantor boleh menugaskan penagihan ke orang yang bukan pemegang toko. Tanpa
 * ini ia melihat tugasnya tetapi tidak bisa membuka fakturnya — tidak bisa
 * melapor BKM, jadi tugasnya tidak mungkin diselesaikan. Penugasan MENAMBAH
 * penagih, tidak memindahkan: pemegang toko tetap menagih faktur yang sama.
 */
async function fakturTugasTagihTerbuka(userId: string): Promise<string[]> {
  const tugas = await prisma.collectionTask.findMany({
    where: { assigneeId: userId, status: 'TERBUKA' },
    select: { receivableIds: true },
  });
  const ids = new Set<string>();
  for (const t of tugas) {
    if (!Array.isArray(t.receivableIds)) continue;
    for (const id of t.receivableIds) if (typeof id === 'string' && id) ids.add(id);
  }
  return [...ids];
}

export async function daftarPiutang(opts?: LingkupPiutang): Promise<BarisPiutang[]> {
  const fakturTugas = opts?.penagihId ? await fakturTugasTagihTerbuka(opts.penagihId) : [];
  const rows = await prisma.receivable.findMany({
    /*
     * Toko konsinyasi TIDAK PERNAH muncul di sini. Barang di toko konsi masih
     * milik kita sampai terjual — mengirimnya bukan penjualan, jadi tidak ada
     * piutang yang lahir dari sana. Kalau toko konsi ikut terdaftar, sales
     * menagih uang untuk barang yang belum laku, dan angkanya ikut menaikkan
     * total piutang perusahaan yang sebenarnya tidak ada.
     *
     * Disaring di kueri, bukan di layar: setiap pemanggil `daftarPiutang`
     * mendapat aturan ini tanpa harus mengingatnya.
     */
    where: {
      store: { termsType: { not: 'KONSI' } },
      ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}),
      ...(opts?.penagihId
        ? {
            OR: [
              { store: { salesmanId: opts.penagihId } },
              { salesmanId: opts.penagihId, store: { salesmanId: null } },
              ...(fakturTugas.length > 0 ? [{ id: { in: fakturTugas } }] : []),
            ],
          }
        : {}),
      ...(opts?.receivableIds ? { id: { in: opts.receivableIds } } : {}),
      ...(opts?.storeId ? { storeId: opts.storeId } : {}),
      ...(opts?.hanyaTerbuka ? { outstanding: { gt: 0 } } : {}),
    },
    orderBy: [{ dueDate: 'asc' }],
    select: {
      id: true,
      invoiceNo: true,
      invoiceDate: true,
      dueDate: true,
      amount: true,
      outstanding: true,
      paidBeforeImport: true,
      source: true,
      storeId: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      claimLinks: {
        select: {
          settledAmount: true,
          paymentClaim: {
            select: {
              docNo: true,
              status: true,
              invoiceAmount: true,
              salesmanId: true,
              createdById: true,
              salesman: { select: { name: true } },
              createdBy: { select: { name: true } },
              deductions: { select: PILIH_POTONGAN },
            },
          },
        },
      },
      collectionLinks: {
        select: {
          collectionNote: {
            select: { docNo: true, promisedDate: true, status: true },
          },
        },
      },
    },
  });

  const hariIni = new Date();

  return rows.map((r) => {
    const klaimList = r.claimLinks.map((link) => ({
      status: link.paymentClaim.status as StatusKlaim,
      nilaiFaktur: angka(link.paymentClaim.invoiceAmount),
      potonganRetur: potonganRetur(link.paymentClaim.deductions),
      nilaiDilunasiPiutangIni: angka(link.settledAmount),
    }));

    const sisa = hitungSisaPiutang(angka(r.amount), klaimList, angka(r.paidBeforeImport));

    const semuaMenunggu = r.claimLinks.filter((l) => l.paymentClaim.status === 'DIKIRIM');
    const klaimMenunggu = semuaMenunggu[0];
    // Dicatat kantor atas nama sales → yang disebut pencatatnya, bukan salesnya.
    const pelaporKlaim = klaimMenunggu
      ? klaimMenunggu.paymentClaim.createdById === klaimMenunggu.paymentClaim.salesmanId
        ? (klaimMenunggu.paymentClaim.salesman?.name ?? null)
        : (klaimMenunggu.paymentClaim.createdBy?.name ?? null)
      : undefined;
    const tertahan = r.claimLinks
      .filter((l) => l.paymentClaim.status === 'TERVERIFIKASI')
      .reduce((sum, l) => sum + returTertahan(potonganRetur(l.paymentClaim.deductions)), 0);

    const kontrabonAktif = r.collectionLinks
      .map((l) => l.collectionNote)
      .find((n) => n.status === 'BERJALAN');

    const keadaan = keadaanPiutang({
      sisa,
      klaimMenunggu: klaimMenunggu ? { docNo: klaimMenunggu.paymentClaim.docNo } : null,
      nilaiTertahan: tertahan,
      kontrabon: kontrabonAktif
        ? { docNo: kontrabonAktif.docNo, janjiBayar: kontrabonAktif.promisedDate }
        : null,
      hariIni,
    });
    const hariJatuhTempo = hariLewatJatuhTempo({ keadaan, dueDate: r.dueDate, hariIni });

    return {
      id: r.id,
      invoiceNo: r.invoiceNo,
      storeId: r.storeId,
      storeName: r.store.name,
      salesmanName: r.salesman?.name ?? null,
      invoiceDate: r.invoiceDate.toISOString(),
      dueDate: r.dueDate.toISOString(),
      amount: angka(r.amount),
      outstanding: sisa,
      bolehDilunasi: sisaBolehDilunasi(sisa, tertahanPiutang(klaimList)),
      source: r.source,
      keadaan,
      keadaanTampil: keadaanTampil({ keadaan, hariLewatJatuhTempo: hariJatuhTempo }),
      alasan: {
        noKlaim: klaimMenunggu?.paymentClaim.docNo,
        klaimMenunggu: semuaMenunggu.length > 0 ? semuaMenunggu.map((l) => l.paymentClaim.docNo) : undefined,
        pelaporKlaim,
        nilaiTertahan: tertahan > 0 ? tertahan : undefined,
        hariLewatJatuhTempo: hariJatuhTempo ?? undefined,
        noKontrabon: kontrabonAktif?.docNo,
        janjiBayar: kontrabonAktif?.promisedDate.toISOString(),
        hariTerlambat: kontrabonAktif
          ? Math.max(0, selisihHari(kontrabonAktif.promisedDate, hariIni))
          : undefined,
      },
    };
  });
}

export type RingkasanPiutang = {
  total: number;
  /** Faktur yang sisanya masih di atas nol. Yang lunas bukan piutang lagi. */
  jumlahPiutang: number;
  perKeadaan: Record<KeadaanPiutang, { jumlah: number; nilai: number }>;
  /** Sama, tetapi `belum` yang lewat jatuh tempo dipisah ke `jatuh_tempo`. */
  perKeadaanTampil: Record<KeadaanTampil, { jumlah: number; nilai: number }>;
};

/** Ringkasan untuk kepala halaman: berapa banyak, dan menumpuk di keadaan mana. */
export function ringkasPiutang(baris: BarisPiutang[]): RingkasanPiutang {
  const kosong = { jumlah: 0, nilai: 0 };
  const perKeadaan: Record<KeadaanPiutang, { jumlah: number; nilai: number }> = {
    lunas: { ...kosong },
    klaim: { ...kosong },
    tertahan: { ...kosong },
    lewat: { ...kosong },
    tt: { ...kosong },
    belum: { ...kosong },
  };
  const perKeadaanTampil: Record<KeadaanTampil, { jumlah: number; nilai: number }> = {
    ...structuredClone(perKeadaan),
    jatuh_tempo: { ...kosong },
  };
  let total = 0;
  let terbuka = 0;
  for (const b of baris) {
    perKeadaan[b.keadaan].jumlah += 1;
    perKeadaan[b.keadaan].nilai += b.outstanding;
    perKeadaanTampil[b.keadaanTampil].jumlah += 1;
    perKeadaanTampil[b.keadaanTampil].nilai += b.outstanding;
    total += b.outstanding;
    if (b.outstanding > 0) terbuka += 1;
  }
  return { total, jumlahPiutang: terbuka, perKeadaan, perKeadaanTampil };
}

export { nilaiDiakui };
