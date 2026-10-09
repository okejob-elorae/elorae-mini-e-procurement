// Hitungan murni untuk panel Elorae di halaman TikTok (dimuat konten.js, diuji node --test).
//
// ER akun di panel memakai aturan yang SAMA dengan server (apps/web/lib/creative/pantau-er.ts,
// keputusan sementara P2): rata-rata ER per posting atas ≤ 12 posting terbaru yang tidak
// disematkan, berumur ≥ 48 jam, dan ber-views > 0; ER posting = (like + komentar + share + save)
// ÷ views × 100; kurang dari 3 posting sah → null. Ubah keduanya bersamaan, atau panel
// menampilkan angka yang berbeda dari yang tersimpan di Elorae.

export const MAKS_POSTING_ER = 12;
export const MIN_POSTING_ER = 3;
export const UMUR_MIN_POSTING_JAM = 48;
export const MAKS_BATANG = 12;
/** Di bawah angka ini angka ditulis lengkap ("1.314"); di atasnya diringkas ("1,12 jt"). */
export const BATAS_RINGKAS = 10_000;

const bulat2 = (n) => Math.round(Number((n * 100).toFixed(4))) / 100;

/** ER satu posting dalam persen, atau null bila views 0/tak terbaca. */
export function erPosting(p) {
  if (!p || !(p.views > 0)) return null;
  const interaksi = (p.like ?? 0) + (p.komentar ?? 0) + (p.share ?? 0) + (p.save ?? 0);
  return bulat2((interaksi / p.views) * 100);
}

/** Posting unik (id pertama menang), terbaru dulu. */
function unik(posting) {
  const dilihat = new Set();
  const hasil = [];
  for (const p of posting ?? []) {
    if (!p || dilihat.has(p.id)) continue;
    dilihat.add(p.id);
    hasil.push(p);
  }
  return hasil.sort((a, b) => b.dibuatPada - a.dibuatPada || String(a.id).localeCompare(String(b.id)));
}

/** `{ er, avgViews, postsCounted }` — sama dengan hitungErAkun di server. */
export function hitungErAkun(posting, sekarangMs) {
  const batasDetik = Math.floor(sekarangMs / 1000) - UMUR_MIN_POSTING_JAM * 3600;
  const dipakai = unik(posting)
    .filter((p) => !p.disematkan && p.dibuatPada <= batasDetik && p.views > 0)
    .slice(0, MAKS_POSTING_ER);
  if (dipakai.length < MIN_POSTING_ER) return { er: null, avgViews: null, postsCounted: dipakai.length };
  const er = bulat2(dipakai.reduce((s, p) => s + ((p.like + p.komentar + p.share + p.save) / p.views) * 100, 0) / dipakai.length);
  const avgViews = Math.round(dipakai.reduce((s, p) => s + p.views, 0) / dipakai.length);
  return { er, avgViews, postsCounted: dipakai.length };
}

/**
 * Batang grafik views: ≤ 12 video terbaru yang tidak disematkan, urut lama → baru (kiri → kanan).
 * `tinggi` 0..1 terhadap views terbesar; `muda` = belum 48 jam (tidak ikut ER, digambar pudar).
 */
export function batangViews(posting, sekarangMs, maks = MAKS_BATANG) {
  const batasDetik = Math.floor(sekarangMs / 1000) - UMUR_MIN_POSTING_JAM * 3600;
  const dipilih = unik(posting)
    .filter((p) => !p.disematkan && Number.isFinite(p.views) && p.views >= 0)
    .slice(0, maks)
    .reverse();
  const puncak = Math.max(0, ...dipilih.map((p) => p.views));
  return dipilih.map((p) => ({
    id: p.id,
    views: p.views,
    tinggi: puncak > 0 ? p.views / puncak : 0,
    muda: p.dibuatPada > batasDetik,
  }));
}

const lengkap = new Intl.NumberFormat("id-ID");
const ringkas = new Intl.NumberFormat("id-ID", { notation: "compact", maximumSignificantDigits: 3 });
const persen = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.314", "12,3 rb", "1,12 jt", "1,23 M"; "—" bila tak ada angka. */
export function angkaPendek(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Math.abs(n) < BATAS_RINGKAS ? lengkap.format(n) : ringkas.format(n);
}

/** Angka lengkap untuk keterangan (title): "1.121.908". */
export function angkaLengkap(n) {
  return typeof n === "number" && Number.isFinite(n) ? lengkap.format(n) : "—";
}

/** "6,84%" atau "—". */
export function teksPersen(n) {
  return typeof n === "number" && Number.isFinite(n) ? `${persen.format(n)}%` : "—";
}

/** Inisial untuk lingkaran avatar: huruf/angka pertama handle, huruf besar. */
export function inisial(handle) {
  const m = String(handle ?? "").replace(/^@/, "").match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "?";
}
