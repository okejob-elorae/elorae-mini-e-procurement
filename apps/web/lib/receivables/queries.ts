import { prisma } from '@elorae/db';
import {
  hitungSisaPiutang,
  keadaanPiutang,
  nilaiDiakui,
  returTertahan,
  selisihHari,
  type KeadaanPiutang,
  type StatusKlaim,
} from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';

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
  source: string;
  keadaan: KeadaanPiutang;
  alasan: {
    noKlaim?: string;
    nilaiTertahan?: number;
    noKontrabon?: string;
    janjiBayar?: string;
    hariTerlambat?: number;
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

    const sisa = hitungSisaPiutang(angka(r.amount), klaimList);

    const klaimMenunggu = r.claimLinks.find((l) => l.paymentClaim.status === 'DIKIRIM');
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
      source: r.source,
      keadaan,
      alasan: {
        noKlaim: klaimMenunggu?.paymentClaim.docNo,
        nilaiTertahan: tertahan > 0 ? tertahan : undefined,
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
  jumlahPiutang: number;
  perKeadaan: Record<KeadaanPiutang, { jumlah: number; nilai: number }>;
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
  let total = 0;
  for (const b of baris) {
    perKeadaan[b.keadaan].jumlah += 1;
    perKeadaan[b.keadaan].nilai += b.outstanding;
    total += b.outstanding;
  }
  return { total, jumlahPiutang: baris.length, perKeadaan };
}

export { nilaiDiakui };
