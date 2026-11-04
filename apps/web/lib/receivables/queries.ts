import { prisma } from '@elorae/db';
import {
  hitungSisaPiutang,
  keadaanPiutang,
  nilaiDiakui,
  pisahTahananRetur,
  selisihHari,
  tertahanPiutangRinci,
  type JenisTahanan,
  type KeadaanPiutang,
  type StatusKlaim,
} from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';
import {
  hariLewatJatuhTempo,
  keadaanTampil,
  lewatTempoDiLuarTahanan,
  nilaiLewatJatuhTempo,
  type KeadaanTampil,
} from './jatuh-tempo';
import { asalTagihan, type AsalTagihan } from "./jenis-tagihan";

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
  /**
   * Tagihan konsinyasi (`Receivable.isConsignment`, diisi saat dibuat). Sejak
   * keputusan 2026-10-29 tagihan konsinyasi ikut di Piutang; di HP ia hanya
   * sampai ke pemegang toko sekarang (P31).
   */
  konsi: boolean;
  /** Asal tagihan untuk label sumbernya (`asalTagihan`). */
  asal: AsalTagihan;
  /** Siklus konsinyasi asal tagihan, kalau lahir dari kunci siklus. */
  siklusId: string | null;
  /** Nomor nota admin penjualan siklusnya, kalau sudah dicatat. */
  nomorNotaKonsi: string | null;
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
    /**
     * Bagian prorata FAKTUR INI dari potongan retur yang ditahan — yang menunggu
     * returnya beres ditambah tahanan tetap (`pisahTahananRetur`). BKM gabungan
     * tidak lagi menghitung seluruh potongannya di setiap faktur.
     */
    nilaiTertahan?: number;
    /** Q15: bagian faktur ini yang menunggu returnya beres (tidak boleh dilunasi BKM lain). */
    ditahanRetur?: number;
    /** Mengapa bagian itu menunggu. */
    sebabDitahan?: JenisTahanan;
    /** P46: bagian bebas faktur yang sebagian ditahan, yang jatuh temponya sudah lewat. */
    lewatTempoDiLuarTahanan?: { hari: number; nilai: number };
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
 * diketik dan tidak pernah dikurangi bertahap — termasuk uang yang masuk lewat
 * pembayaran kantor (`paidAmount`). Kolomnya tetap ada sebagai cache untuk
 * penyaringan cepat, bukan sebagai kebenaran.
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
   *
   * Tagihan KONSINYASI hanya lewat pemegang toko sekarang (P31, "pemegang
   * toko"): jalur penjual-tanpa-pemegang dan jalur tugas tagih tidak membukanya.
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
   * mungkin: penulisnya selalu menulis kolom ini saat sisanya berubah —
   * termasuk pembayaran kantor dan pembatalannya (`selaraskanSisaPiutang`) —
   * jadi yang benar-benar terbuka tidak akan pernah tersaring keluar.
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
     * Tagihan konsinyasi IKUT di sini (keputusan pemilik 2026-10-29 mencabut
     * "toko konsinyasi tidak pernah muncul di piutang"): tagihan siklus lahir
     * saat angka terjualnya dikunci, dan utang konsi di kertas masuk lewat impor
     * atau faktur manual (P32). Penandanya `isConsignment`.
     *
     * VOIDED bukan piutang: nota yang tidak jadi dikirim, atau tagihan siklus
     * yang kuncinya dibuka. Disaring di kueri supaya setiap pemanggil — layar,
     * dasbor, pengingat — mendapat aturan yang sama tanpa harus mengingatnya.
     */
    where: {
      status: { not: "VOIDED" },
      ...(opts?.salesmanId ? { salesmanId: opts.salesmanId } : {}),
      ...(opts?.penagihId
        ? {
            OR: [
              { store: { salesmanId: opts.penagihId } },
              { salesmanId: opts.penagihId, store: { salesmanId: null }, isConsignment: false },
              ...(fakturTugas.length > 0 ? [{ id: { in: fakturTugas }, isConsignment: false }] : []),
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
      paidAmount: true,
      source: true,
      isConsignment: true,
      consignmentCycleId: true,
      sellThroughId: true,
      consignmentCycle: { select: { noNota: true } },
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

    const sisa = hitungSisaPiutang(angka(r.amount), klaimList, angka(r.paidBeforeImport), angka(r.paidAmount));

    const semuaMenunggu = r.claimLinks.filter((l) => l.paymentClaim.status === 'DIKIRIM');
    const klaimMenunggu = semuaMenunggu[0];
    // Dicatat kantor atas nama sales → yang disebut pencatatnya, bukan salesnya.
    const pelaporKlaim = klaimMenunggu
      ? klaimMenunggu.paymentClaim.createdById === klaimMenunggu.paymentClaim.salesmanId
        ? (klaimMenunggu.paymentClaim.salesman?.name ?? null)
        : (klaimMenunggu.paymentClaim.createdBy?.name ?? null)
      : undefined;
    // Q15: SATU pembagian sisa — yang boleh ditagih, yang menunggu returnya
    // beres, dan angka tahanan faktur ini (prorata per faktur, bukan seluruh
    // potongan BKM gabungan di setiap fakturnya).
    const pisah = pisahTahananRetur(sisa, tertahanPiutangRinci(klaimList));

    const kontrabonAktif = r.collectionLinks
      .map((l) => l.collectionNote)
      .find((n) => n.status === 'BERJALAN');

    const keadaan = keadaanPiutang({
      sisa,
      klaimMenunggu: klaimMenunggu ? { docNo: klaimMenunggu.paymentClaim.docNo } : null,
      nilaiTertahan: pisah.nilaiTertahan,
      kontrabon: kontrabonAktif
        ? { docNo: kontrabonAktif.docNo, janjiBayar: kontrabonAktif.promisedDate }
        : null,
      hariIni,
    });
    const hariJatuhTempo = hariLewatJatuhTempo({ keadaan, dueDate: r.dueDate, hariIni });
    const lewatSebagian = lewatTempoDiLuarTahanan({
      keadaan,
      bebas: pisah.bebas,
      adaKontrabon: Boolean(kontrabonAktif),
      dueDate: r.dueDate,
      hariIni,
    });
    const menunggu = keadaan === "tertahan" && pisah.ditahan > 0;

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
      bolehDilunasi: pisah.bebas,
      source: r.source,
      konsi: r.isConsignment,
      asal: asalTagihan(r),
      siklusId: r.consignmentCycleId,
      nomorNotaKonsi: r.consignmentCycle?.noNota ?? null,
      keadaan,
      keadaanTampil: keadaanTampil({ keadaan, hariLewatJatuhTempo: hariJatuhTempo }),
      alasan: {
        noKlaim: klaimMenunggu?.paymentClaim.docNo,
        klaimMenunggu: semuaMenunggu.length > 0 ? semuaMenunggu.map((l) => l.paymentClaim.docNo) : undefined,
        pelaporKlaim,
        nilaiTertahan: pisah.nilaiTertahan > 0 ? pisah.nilaiTertahan : undefined,
        ditahanRetur: menunggu ? pisah.ditahan : undefined,
        sebabDitahan: menunggu ? (pisah.sebab ?? undefined) : undefined,
        lewatTempoDiLuarTahanan: lewatSebagian ?? undefined,
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
  /**
   * Sama, tetapi `belum` yang lewat jatuh tempo dipisah ke `jatuh_tempo`.
   * BUKAN partisi lagi (P46): nota yang sebagian ditahan dan bagian bebasnya
   * lewat tempo dihitung di `tertahan` (seluruh sisanya) DAN di `jatuh_tempo`
   * (bagian bebasnya saja).
   */
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
    if (b.keadaanTampil !== "jatuh_tempo") {
      perKeadaanTampil[b.keadaanTampil].jumlah += 1;
      perKeadaanTampil[b.keadaanTampil].nilai += b.outstanding;
    }
    const lewat = nilaiLewatJatuhTempo(b);
    if (lewat !== null) {
      perKeadaanTampil.jatuh_tempo.jumlah += 1;
      perKeadaanTampil.jatuh_tempo.nilai += lewat;
    }
    total += b.outstanding;
    if (b.outstanding > 0) terbuka += 1;
  }
  return { total, jumlahPiutang: terbuka, perKeadaan, perKeadaanTampil };
}

export { nilaiDiakui };
