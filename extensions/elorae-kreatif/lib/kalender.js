// Kalender rentang tanggal untuk panel — murni, diuji node --test. Meniru isian rentang Elorae
// (apps/web/components/ui/rentang-tanggal-input.tsx + lib/tanggal-isian.ts): pilihan cepat,
// Mulai → Selesai, minggu mulai Senin. Semua tanggal teks "YYYY-MM-DD" hari kalender WIB, dihitung
// dengan Date.UTC supaya zona waktu komputer tidak menggeser hari.

const HARI_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;
const POLA = /^(\d{4})-(\d{2})-(\d{2})$/;

export const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const HARI_PENDEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** "2026-10-09" → { tahun, bulan (1–12), hari }, atau null bila bukan tanggal sungguhan. */
export function bacaTanggal(teks) {
  const m = POLA.exec(String(teks ?? ""));
  if (!m) return null;
  const [tahun, bulan, hari] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (d.getUTCFullYear() !== tahun || d.getUTCMonth() !== bulan - 1 || d.getUTCDate() !== hari) return null;
  return { tahun, bulan, hari };
}

function keTeks(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function keMs(teks) {
  const b = bacaTanggal(teks);
  return b ? Date.UTC(b.tahun, b.bulan - 1, b.hari) : null;
}

/** Hari ini menurut WIB. */
export function hariIniWib(sekarangMs) {
  return keTeks(sekarangMs + WIB_MS);
}

export function geserHari(teks, n) {
  return keTeks(keMs(teks) + n * HARI_MS);
}

/** Awal ≤ akhir, ke arah mana pun orang menarik. */
export function urutkanRentang(a, b) {
  return a <= b ? { dari: a, sampai: b } : { dari: b, sampai: a };
}

/** Jumlah hari termasuk kedua ujung; 0 bila salah satu kosong. */
export function jumlahHari(dari, sampai) {
  const a = keMs(dari);
  const b = keMs(sampai);
  if (a === null || b === null) return 0;
  return Math.abs(b - a) / HARI_MS + 1;
}

/**
 * Pilihan cepat. "Hari ini", "Kemarin" dan "Minggu ini" milik isian Elorae tidak dipakai: video
 * < 48 jam belum dihitung, jadi rentang itu hampir selalu kosong.
 */
export const PILIHAN_CEPAT = [
  { kunci: "mingguLalu", label: "Minggu lalu" },
  { kunci: "tujuhHari", label: "7 hari terakhir" },
  { kunci: "tigaPuluhHari", label: "30 hari terakhir" },
  { kunci: "sembilanPuluhHari", label: "90 hari terakhir" },
  { kunci: "bulanIni", label: "Bulan ini" },
  { kunci: "bulanLalu", label: "Bulan lalu" },
  { kunci: "tigaBulanLalu", label: "3 bulan lalu" },
  { kunci: "tahunIni", label: "Tahun ini" },
];

/** Rentang satu pilihan cepat, dihitung dari hari ini (WIB). */
export function rentangCepat(kunci, hariIni) {
  const [th, bl] = hariIni.split("-");
  const awalBulan = `${th}-${bl}-01`;
  const keSenin = (new Date(keMs(hariIni)).getUTCDay() + 6) % 7;
  const seninIni = geserHari(hariIni, -keSenin);
  const awalBulanKe = (n) => {
    const d = new Date(Date.UTC(Number(th), Number(bl) - 1 + n, 1));
    return keTeks(d.getTime());
  };
  switch (kunci) {
    case "mingguLalu":
      return { dari: geserHari(seninIni, -7), sampai: geserHari(seninIni, -1) };
    case "tujuhHari":
      return { dari: geserHari(hariIni, -6), sampai: hariIni };
    case "tigaPuluhHari":
      return { dari: geserHari(hariIni, -29), sampai: hariIni };
    case "sembilanPuluhHari":
      return { dari: geserHari(hariIni, -89), sampai: hariIni };
    case "bulanIni":
      return { dari: awalBulan, sampai: hariIni };
    case "bulanLalu":
      return { dari: awalBulanKe(-1), sampai: geserHari(awalBulan, -1) };
    case "tigaBulanLalu":
      return { dari: awalBulanKe(-3), sampai: geserHari(awalBulan, -1) };
    case "tahunIni":
      return { dari: `${th}-01-01`, sampai: hariIni };
    default:
      return null;
  }
}

/** Bulan ke-n dari { tahun, bulan }. */
export function geserBulan(b, n) {
  const d = new Date(Date.UTC(b.tahun, b.bulan - 1 + n, 1));
  return { tahun: d.getUTCFullYear(), bulan: d.getUTCMonth() + 1 };
}

/**
 * Minggu-minggu satu bulan, Senin dulu. Sel di luar bulan itu `null` (dua bulan berdampingan tidak
 * boleh menyorot satu tanggal dua kali). Selalu kelipatan 7 sel.
 */
export function gridBulan(tahun, bulan) {
  const awal = Date.UTC(tahun, bulan - 1, 1);
  const banyak = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const geser = (new Date(awal).getUTCDay() + 6) % 7;
  const sel = Array.from({ length: geser }, () => null);
  for (let h = 0; h < banyak; h++) sel.push(keTeks(awal + h * HARI_MS));
  while (sel.length % 7) sel.push(null);
  const minggu = [];
  for (let i = 0; i < sel.length; i += 7) minggu.push(sel.slice(i, i + 7));
  return minggu;
}

/** "9 Okt 2026" / "9 Okt" tanpa tahun. */
export function labelTanggal(teks, { tahun = true } = {}) {
  const b = bacaTanggal(teks);
  if (!b) return "";
  return `${b.hari} ${BULAN_PENDEK[b.bulan - 1]}${tahun ? ` ${b.tahun}` : ""}`;
}

/** "1–30 Sep 2026", "28 Sep – 4 Okt 2026", "28 Des 2025 – 4 Jan 2026"; `tahun: false` membuang tahunnya. */
export function labelRentang(dari, sampai, { tahun = true } = {}) {
  const a = bacaTanggal(dari);
  const b = bacaTanggal(sampai);
  if (!a || !b) return "";
  const th = (x) => (tahun ? ` ${x}` : "");
  if (dari === sampai) return labelTanggal(dari, { tahun });
  if (a.tahun === b.tahun && a.bulan === b.bulan) return `${a.hari}–${b.hari} ${BULAN_PENDEK[b.bulan - 1]}${th(b.tahun)}`;
  if (a.tahun === b.tahun) return `${a.hari} ${BULAN_PENDEK[a.bulan - 1]} – ${b.hari} ${BULAN_PENDEK[b.bulan - 1]}${th(b.tahun)}`;
  return `${labelTanggal(dari)} – ${labelTanggal(sampai)}`;
}

// Lebar isi: daftar pilihan cepat 228 + bulan 252 (+ 20 jarak antar-bulan) + 24 padding + 2 bingkai.
export const LEBAR_DUA_BULAN = 784;
export const LEBAR_SATU_BULAN = 512;

/**
 * Tata letak kalender menurut ruang di samping panel (px): dua bulan + daftar pilihan cepat,
 * satu bulan + daftar, atau "sempit" (di atas panel, pilihan cepat sebagai chip).
 */
export function tataLetakKalender(ruang) {
  if (ruang >= LEBAR_DUA_BULAN) return "dua";
  if (ruang >= LEBAR_SATU_BULAN) return "satu";
  return "sempit";
}
