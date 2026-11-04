/**
 * Teks rekap KOL siap tempel — murni, aman untuk klien.
 *
 * Satu hari atau satu rentang. Blok yang kosong tidak ditulis. Baris judul blok
 * berhuruf kapital (dipakai versi cetak untuk dijadikan judul). Waktu ditulis
 * dalam WIB tanpa bergantung zona waktu mesin.
 */

import { angkaTitik, roas, rupiahTeks } from "./angka-konten";
import { LABEL_TAHAP, type Tahap } from "./tahap";

export const GARIS_REKAP = "=".repeat(46);
const GARIS_KAKI = "-".repeat(46);

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function bagian(hari: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hari);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** "Rabu, 7 Oktober 2026" dari hari WIB "2026-10-07". */
export function tanggalPanjang(hari: string): string {
  const b = bagian(hari);
  if (!b) return hari;
  const d = new Date(Date.UTC(b[0], b[1] - 1, b[2]));
  return `${HARI[d.getUTCDay()]}, ${b[2]} ${BULAN[b[1] - 1]} ${b[0]}`;
}

function tanggalPendek(hari: string): string {
  const b = bagian(hari);
  return b ? `${b[2]} ${BULAN_PENDEK[b[1] - 1]} ${b[0]}` : hari;
}

/** Bagian waktu WIB sebuah instan. */
function wib(w: Date | string): { hari: string; jam: string; tgl: string } {
  const d = new Date(new Date(w).getTime() + 7 * 3_600_000);
  const iso = d.toISOString();
  return { hari: iso.slice(0, 10), jam: `${iso.slice(11, 13)}.${iso.slice(14, 16)}`, tgl: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` };
}

/** "@handle" bila ada, jatuh ke nama KOL. */
export function labelKol(handle: string | null | undefined, nama: string): string {
  const h = handle?.trim().replace(/^@+/, "");
  return h ? `@${h}` : nama;
}

export type DataRekap = {
  /** Hari WIB awal dan akhir (sama = rekap satu hari). */
  dari: string;
  sampai: string;
  dibuatPada: Date | string;
  ringkasan: {
    kolBaru: number;
    barangDikirim: number;
    barangDiterima: number;
    kontenTayang: number;
    views: number;
    orders: number;
    gmv: number;
    komisi: number;
    /** Fee yang disepakati (neto untuk gross-up, bruto untuk dipotong). */
    biayaFee: number;
    /** PPh gross-up yang ditanggung Elorae; boleh tidak ada (= 0). */
    biayaPph?: number;
    /** Ongkir + HPP sampel. */
    biayaKirim: number;
    biayaBoost: number;
  };
  /** Posisi kolaborasi per tahap saat ini; yang nol tidak ditulis. */
  posisi: { tahap: Tahap; jumlah: number }[];
  perCampaign: { nama: string; kol: number; views: number; gmv: number }[];
  /** Sudah diurut pemanggil; ditulis paling banyak 10. */
  teratas: { kol: string; platform: string | null; gmv: number; orders: number }[];
  pengiriman: { kol: string; platform: string | null; kurir: string | null; resi: string | null }[];
  kontenTayang: { kol: string; platform: string | null; views: number; link: string | null; tanggal: string }[];
  kolBaru: { kol: string; platform: string | null; pengikut: number }[];
  perubahanTahap: { kol: string; dari: Tahap | null; ke: Tahap }[];
  catatan: { kol: string; waktu: Date | string; isi: string }[];
  /** Judul kelompok tugas (mis. `JUDUL_TUGAS`) dan jumlahnya; yang nol tidak ditulis. */
  tindakLanjut: { judul: string; jumlah: number }[];
};

const plat = (p: string | null) => (p ? ` (${p})` : "");

function batasi<T>(daftar: readonly T[], maks: number, tulis: (x: T, i: number) => string[]): string[] {
  const hasil = daftar.slice(0, maks).flatMap(tulis);
  if (daftar.length > maks) hasil.push(`...dan ${daftar.length - maks} lainnya`);
  return hasil;
}

export function susunRekap(d: DataRekap): string {
  const satuHari = d.dari === d.sampai;
  const blok: string[][] = [];

  const kepala = satuHari
    ? [`REKAP KOL — ${tanggalPanjang(d.dari)}`]
    : [
        `REKAP KOL — ${tanggalPanjang(d.dari)} – ${tanggalPanjang(d.sampai)}`,
        `(${Math.round((Date.parse(`${d.sampai}T00:00:00Z`) - Date.parse(`${d.dari}T00:00:00Z`)) / 86_400_000) + 1} hari)`,
      ];
  blok.push([...kepala, GARIS_REKAP]);

  const r = d.ringkasan;
  // Satu definisi biaya dengan `biayaKolaborasi`/`angkaKolaborasi`: komisi ikut
  // dihitung, supaya ROAS di rekap sama dengan ROAS di Peringkat dan Hari ini.
  const pph = r.biayaPph ?? 0;
  const biaya = Math.round((r.biayaFee + pph + r.biayaKirim + r.biayaBoost + r.komisi) * 100) / 100;
  const rasio = roas(r.gmv, biaya);
  // "fee" selalu angka yang disepakati; PPh gross-up yang ditanggung Elorae
  // ditulis sendiri, dan biaya bruto fee (termasuk PPh) disebut di barisnya.
  const rincianBiaya = [
    `fee ${rupiahTeks(r.biayaFee)}`,
    ...(pph > 0 ? [`PPh gross-up ${rupiahTeks(pph)}`] : []),
    `kirim ${rupiahTeks(r.biayaKirim)}`,
    ...(r.biayaBoost > 0 ? [`boost ${rupiahTeks(r.biayaBoost)}`] : []),
    ...(r.komisi > 0 ? [`komisi ${rupiahTeks(r.komisi)}`] : []),
  ];
  const baris = (label: string, nilai: string) => `- ${label.padEnd(19)}: ${nilai}`;
  blok.push([
    "RINGKASAN",
    baris("KOL baru", angkaTitik(r.kolBaru)),
    baris("Sampel dikirim", angkaTitik(r.barangDikirim)),
    baris("Sampel diterima", angkaTitik(r.barangDiterima)),
    baris("Konten tayang", angkaTitik(r.kontenTayang)),
    baris("Total views", angkaTitik(r.views)),
    baris("Order", angkaTitik(r.orders)),
    baris("GMV", rupiahTeks(r.gmv)),
    baris("Komisi", rupiahTeks(r.komisi)),
    baris("Biaya", `${rupiahTeks(biaya)} (${rincianBiaya.join(" + ")})`),
    ...(pph > 0
      ? [baris("Fee disepakati", `${rupiahTeks(r.biayaFee)} · biaya bruto (termasuk PPh) ${rupiahTeks(Math.round((r.biayaFee + pph) * 100) / 100)}`)]
      : []),
    baris("ROAS", rasio === null ? "—" : `${rasio.toFixed(2).replace(".", ",")}x`),
  ]);

  const posisi = d.posisi.filter((p) => p.jumlah > 0);
  if (posisi.length) {
    blok.push(["POSISI TAHAP (kondisi saat ini)", ...posisi.map((p) => `- ${LABEL_TAHAP[p.tahap].padEnd(15)}: ${angkaTitik(p.jumlah)}`)]);
  }

  if (d.perCampaign.length) {
    blok.push([
      "PER CAMPAIGN",
      ...d.perCampaign.map((c) => `- ${c.nama}: ${angkaTitik(c.kol)} KOL · ${angkaTitik(c.views)} views · ${rupiahTeks(c.gmv)}`),
    ]);
  }

  const teratas = d.teratas.slice(0, 10);
  if (teratas.length) {
    blok.push([
      `TOP PERFORMER (${teratas.length})`,
      ...teratas.map((t, i) => `${i + 1}. ${t.kol}${plat(t.platform)} — ${rupiahTeks(t.gmv)} · ${angkaTitik(t.orders)} order`),
    ]);
  }

  if (satuHari) {
    if (d.pengiriman.length) {
      blok.push([
        `PENGIRIMAN (${d.pengiriman.length})`,
        ...batasi(d.pengiriman, 40, (p) => [
          `- ${p.kol}${plat(p.platform)} | ${p.resi?.trim() ? `${p.kurir?.trim() ? `${p.kurir.trim()} ` : ""}${p.resi.trim()}` : "resi belum ada"}`,
        ]),
      ]);
    }
    if (d.kontenTayang.length) {
      blok.push([
        `KONTEN TAYANG (${d.kontenTayang.length})`,
        ...batasi(d.kontenTayang, 40, (k) => [
          `- ${k.kol}${plat(k.platform)} | ${angkaTitik(k.views)} views`,
          ...(k.link ? [`  ${k.link}`] : []),
        ]),
      ]);
    }
  } else if (d.kontenTayang.length) {
    const terbaik = [...d.kontenTayang].sort((a, b) => b.views - a.views).slice(0, 10);
    blok.push([
      `KONTEN TERBAIK (dari ${d.kontenTayang.length} konten)`,
      ...terbaik.map((k, i) => `${i + 1}. ${k.kol} — ${angkaTitik(k.views)} views · ${tanggalPanjang(k.tanggal)}`),
    ]);
  }

  if (d.kolBaru.length) {
    blok.push([
      `KOL BARU (${d.kolBaru.length})`,
      ...batasi(d.kolBaru, 30, (k) => [`- ${k.kol} (${[k.platform, `${angkaTitik(k.pengikut)} pengikut`].filter(Boolean).join(", ")})`]),
    ]);
  }

  if (d.perubahanTahap.length) {
    if (satuHari) {
      blok.push([
        `PERUBAHAN TAHAP (${d.perubahanTahap.length})`,
        ...batasi(d.perubahanTahap, 30, (p) => [`- ${p.kol}: ${p.dari ? `${LABEL_TAHAP[p.dari]} → ` : ""}${LABEL_TAHAP[p.ke]}`]),
      ]);
    } else {
      blok.push([`PERUBAHAN TAHAP: ${d.perubahanTahap.length} kali`]);
    }
  }

  if (d.catatan.length) {
    blok.push([
      `CATATAN (${d.catatan.length})`,
      ...batasi(d.catatan, satuHari ? 30 : 15, (c) => {
        const w = wib(c.waktu);
        return [`- ${c.kol} (${satuHari ? w.jam : tanggalPendek(w.hari)}): ${c.isi.replace(/\s+/g, " ").trim()}`];
      }),
    ]);
  }

  const tindak = d.tindakLanjut.filter((t) => t.jumlah > 0);
  if (tindak.length) {
    blok.push([
      `PERLU DITINDAKLANJUTI (${tindak.reduce((s, t) => s + t.jumlah, 0)})`,
      ...tindak.map((t) => `- ${t.judul}: ${angkaTitik(t.jumlah)}`),
    ]);
  }

  const w = wib(d.dibuatPada);
  blok.push([GARIS_KAKI, `Dibuat otomatis oleh Elorae ERP · ${w.tgl} ${w.jam}`]);

  return `${blok.map((b) => b.join("\n")).join("\n\n")}\n`;
}
