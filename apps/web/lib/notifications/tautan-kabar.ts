import type { JenisKabar } from "./kabar-pengguna";

/**
 * Ke mana sebuah kabar membawa salesman/SPG saat diketuk — murni, tanpa basis
 * data, supaya bisa dipakai layar Kabar, lencana, dan (nanti) service worker
 * yang menangani ketukan pada notifikasi push.
 *
 * Impor dari `kabar-pengguna` HANYA tipe: modul itu menarik Prisma dan Firebase
 * Admin, dan berkas ini harus aman dibundel ke klien maupun service worker.
 *
 * `Record<JenisKabar, …>` membuat jenis kabar baru tanpa tautan menjadi galat
 * tipe. Karena type-check `apps/web` tidak dijalankan di sini, tesnya juga
 * menyisir `JENIS_KABAR` satu per satu — itu jaring yang benar-benar berjalan.
 */

type Pembuat = (data: Record<string, unknown>) => string;

/** Id dari kolom `data` (JSON) — hanya string tak kosong yang dipercaya. */
function id(data: Record<string, unknown>, kunci: string): string | null {
  const nilai = data[kunci];
  return typeof nilai === "string" && nilai.trim() !== "" ? encodeURIComponent(nilai.trim()) : null;
}

/*
 * Tanpa id, kabar pesanan/toko tetap membawa ke daftarnya — lebih berguna
 * daripada ketukan yang tidak ke mana-mana.
 */
const pesanan: Pembuat = (d) => {
  const orderId = id(d, "orderId");
  return orderId ? `/pwa/orders/${orderId}` : "/pwa/orders";
};

const toko: Pembuat = (d) => {
  const storeId = id(d, "storeId");
  return storeId ? `/pwa/stores/${storeId}` : "/pwa/stores";
};

const tagihanToko: Pembuat = (d) => {
  const storeId = id(d, "storeId");
  return storeId ? `/pwa/piutang/${storeId}` : "/pwa/piutang";
};

const mutasi: Pembuat = (d) => {
  const transferId = id(d, "transferId");
  return transferId ? `/pwa/spg/mutasi/${transferId}` : "/pwa/spg/mutasi";
};

const TAUTAN: Record<JenisKabar, Pembuat> = {
  PESANAN_DISETUJUI: pesanan,
  // Toko memesan sendiri lewat portal → pemegang toko dibawa ke pesanannya.
  PESANAN_PORTAL: pesanan,
  PESANAN_DITOLAK: pesanan,
  PESANAN_DIKIRIM: pesanan,
  PESANAN_DITUTUP: pesanan,
  PELUNASAN_TERVERIFIKASI: () => "/pwa/bkm",
  PELUNASAN_DITOLAK: () => "/pwa/bkm",
  PELUNASAN_DIBATALKAN: () => "/pwa/bkm",
  RETUR_DIHITUNG: () => "/pwa/retur",
  RETUR_DIBEBANKAN: () => "/pwa/beban",
  RETUR_DIPINDAH_TOKO: () => "/pwa/retur",
  RETUR_DIBATALKAN: () => "/pwa/retur",
  PERUBAHAN_TOKO_DISETUJUI: toko,
  PERUBAHAN_TOKO_DITOLAK: toko,
  // Disetujui membawa ke toko yang baru dibuat; ditolak ke daftar usulan sendiri.
  TOKO_BARU_DISETUJUI: toko,
  TOKO_BARU_DITOLAK: () => "/pwa/stores/usulan",
  KONTRABON_DIKONFIRMASI: tagihanToko,
  KONTRABON_DIBATALKAN: tagihanToko,
  GIRO_CAIR: () => "/pwa/bkm",
  GIRO_DITOLAK: () => "/pwa/bkm",
  BIAYA_DISETUJUI: () => "/pwa/biaya",
  BIAYA_DITOLAK: () => "/pwa/biaya",
  BIAYA_DIBAYAR: () => "/pwa/biaya",
  // Dikirim 18.30 WIB, sering baru dibaca esok pagi — buka hari yang diringkas, bukan "hari ini".
  RINGKASAN_HARIAN: (d) => {
    const t = id(d, "tanggal");
    return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? `/pwa/hari-ini?tanggal=${t}` : "/pwa/hari-ini";
  },
  TUKAR_DISETUJUI: () => "/pwa/tukar",
  TUKAR_DITOLAK: () => "/pwa/tukar",
  TUKAR_SELESAI: () => "/pwa/tukar",
  TUKAR_DIBATALKAN: () => "/pwa/tukar",
  TUGAS_TAGIH_BARU: tagihanToko,
  // Jadwal kunjungan dari kantor: buka hari pertama yang dijadwalkan.
  JADWAL_KUNJUNGAN: (d) => {
    const t = id(d, "tanggal");
    return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? `/pwa/jadwal?tanggal=${t}` : "/pwa/jadwal";
  },
  PENGUMUMAN: (d) => {
    const a = id(d, "announcementId");
    return a ? `/pwa/pengumuman/${a}` : "/pwa/pengumuman";
  },
  IZIN_DISETUJUI: () => "/pwa/absen",
  IZIN_DITOLAK: () => "/pwa/absen",
  IZIN_DIBATALKAN: () => "/pwa/absen",
  MUTASI_DISETUJUI: mutasi,
  MUTASI_DITOLAK: mutasi,
  // SPG toko tujuan langsung dibawa ke layar hitung-dan-terima kiriman itu.
  MUTASI_MASUK: (d) => {
    const transferId = id(d, "transferId");
    return transferId ? `/pwa/spg/terima/MUTASI/${transferId}` : "/pwa/spg/terima";
  },
  MUTASI_DITERIMA: mutasi,
  MUTASI_DIBATALKAN: mutasi,
  PERMINTAAN_STOK_DIPROSES: () => "/pwa/spg/stok",
  KIRIMAN_MENUNGGU: () => "/pwa/spg/terima",
  PERMINTAAN_SPG_MASUK: (d) => {
    const requestId = id(d, "requestId");
    return requestId ? `/pwa/permintaan/${requestId}` : "/pwa/permintaan";
  },
  REKOMENDASI_MASUK: (d) => {
    const r = id(d, "recommendationId");
    return r ? `/pwa/spg/rekomendasi/${r}` : "/pwa/spg/rekomendasi";
  },
  REKOMENDASI_DIJAWAB: (d) => {
    const r = id(d, "recommendationId");
    return r ? `/pwa/rekomendasi/${r}` : "/pwa/rekomendasi";
  },
  TITIP_PESAN_TERSEDIA: (d) => {
    const r = id(d, "requestId");
    return r ? `/pwa/spg/titip/${r}` : "/pwa/spg/titip";
  },
  JADWAL_SPG: () => "/pwa/spg/jadwal",
  TUKAR_SHIFT_DIMINTA: () => "/pwa/spg/jadwal",
  TUKAR_SHIFT_DIPUTUSKAN: () => "/pwa/spg/jadwal",
  KOMISI_SPG: () => "/pwa/spg/gaji",
  KIRIMAN_RUSAK_DIPUTUSKAN: () => "/pwa/spg/terima",
  TUTUP_HARI_PENGINGAT: () => "/pwa/spg/tutup",
  BEBAN_HILANG_DITETAPKAN: () => "/pwa/beban",
};

/**
 * Alamat PWA untuk sebuah kabar, atau `null` kalau jenisnya tidak dikenal
 * (mis. notifikasi backoffice yang kebetulan masuk ke antrean orang yang sama)
 * — ketukannya lalu hanya menandai dibaca.
 */
export function tautanKabar(type: string, data: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(TAUTAN, type)) return null;
  const isi = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return TAUTAN[type as JenisKabar](isi);
}
