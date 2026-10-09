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

/** Posting yang dipakai ER akun: ≤ 12 terbaru, bukan pin, berumur ≥ 48 jam, views > 0. */
function postingEr(posting, sekarangMs) {
  const batasDetik = Math.floor(sekarangMs / 1000) - UMUR_MIN_POSTING_JAM * 3600;
  return unik(posting)
    .filter((p) => !p.disematkan && p.dibuatPada <= batasDetik && p.views > 0)
    .slice(0, MAKS_POSTING_ER);
}

/** `{ er, avgViews, postsCounted }` — sama dengan hitungErAkun di server. */
export function hitungErAkun(posting, sekarangMs) {
  const dipakai = postingEr(posting, sekarangMs);
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

// ---------------------------------------------------------------- ringkasan akun

/** Median, atau null untuk daftar kosong. */
export function median(angka) {
  const a = (angka ?? []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const t = Math.floor(a.length / 2);
  return a.length % 2 ? a[t] : Math.round((a[t - 1] + a[t]) / 2);
}

const HARI_DETIK = 86_400;

/**
 * Pelengkap ER untuk menilai akun:
 * - `medianViews` atas posting yang sama dengan ER (satu video viral tidak mengangkatnya);
 * - `rasioViews` = rata-rata views ÷ pengikut × 100 (berapa persen pengikut yang menonton);
 * - `perMinggu` = video per minggu dalam 28 hari terakhir (atau rentang yang tertangkap bila lebih pendek).
 */
export function ringkasAkun(posting, pengikut, sekarangMs, opsi = {}) {
  const er = hitungErAkun(posting, sekarangMs);
  const dipakai = er.er == null ? [] : postingEr(posting, sekarangMs);
  const medianViews = median(dipakai.map((p) => p.views));
  const rasioViews = er.avgViews != null && pengikut > 0 ? Math.round((er.avgViews / pengikut) * 1000) / 10 : null;

  const kini = Math.floor(sekarangMs / 1000);
  const biasa = unik(posting).filter((p) => !p.disematkan);
  let perMinggu = null;
  let hariDasar = 0;
  if (biasa.length) {
    const tertua = biasa[biasa.length - 1].dibuatPada;
    const semua = Number.isFinite(opsi.jumlahVideo) && unik(posting).length >= opsi.jumlahVideo;
    const span = tertua <= kini - 28 * HARI_DETIK || semua ? 28 * HARI_DETIK : Math.max(HARI_DETIK, kini - tertua);
    hariDasar = Math.round(span / HARI_DETIK);
    const n = biasa.filter((p) => p.dibuatPada > kini - span).length;
    perMinggu = Math.round((n / (span / (7 * HARI_DETIK))) * 10) / 10;
  }
  return { ...er, medianViews, rasioViews, perMinggu, hariDasar };
}

// ---------------------------------------------------------------- periode

function blok(daftar) {
  const v = daftar.map((p) => p.views);
  const jumlah = (k) => daftar.reduce((s, p) => s + (Number.isFinite(p[k]) ? p[k] : 0), 0);
  const erList = daftar.map(erPosting).filter((x) => x !== null);
  return {
    video: daftar.length,
    views: jumlah("views"),
    rataViews: daftar.length ? Math.round(jumlah("views") / daftar.length) : null,
    medianViews: median(v),
    like: jumlah("like"),
    komentar: jumlah("komentar"),
    share: jumlah("share"),
    save: jumlah("save"),
    er: erList.length ? bulat2(erList.reduce((s, x) => s + x, 0) / erList.length) : null,
  };
}

/**
 * Performa video yang DIUNGGAH dalam `hari` terakhir dibanding `hari` sebelumnya.
 *
 * Kedua jendela digeser mundur 48 jam (sama dengan aturan ER): video yang baru diunggah masih
 * mengumpulkan views, jadi kalau ikut dihitung periode terbaru selalu tampak turun. Jendela kini
 * = [sekarang − 48 jam − hari, sekarang − 48 jam), jendela lalu = hari sebelum itu.
 *
 * `lengkapKini`/`lengkapLalu`: daftar video yang tertangkap memang mencakup jendela itu — ada video
 * (bukan pin) yang lebih tua dari awal jendela, atau seluruh video akun sudah tertangkap
 * (`opsi.jumlahVideo`). Kalau tidak, angkanya sebagian dan panel meminta menggulir daftar video.
 */
export function ringkasPeriode(posting, hari, sekarangMs, opsi = {}) {
  const akhir = Math.floor(sekarangMs / 1000) - UMUR_MIN_POSTING_JAM * 3600;
  const awal = akhir - hari * HARI_DETIK;
  const awalLalu = awal - hari * HARI_DETIK;
  const semua = unik(posting);
  const biasa = semua.filter((p) => !p.disematkan);
  const tertua = biasa.length ? biasa[biasa.length - 1].dibuatPada : null;
  const seluruhAkun = Number.isFinite(opsi.jumlahVideo) && semua.length >= opsi.jumlahVideo;
  const dalam = (a, b) => semua.filter((p) => p.dibuatPada >= a && p.dibuatPada < b);
  return {
    hari,
    kini: blok(dalam(awal, akhir)),
    lalu: blok(dalam(awalLalu, awal)),
    lengkapKini: seluruhAkun || (tertua !== null && tertua < awal),
    lengkapLalu: seluruhAkun || (tertua !== null && tertua < awalLalu),
    mudaDilewati: semua.filter((p) => p.dibuatPada >= akhir).length,
  };
}

/** Perubahan dalam persen (satu desimal), null bila pembandingnya 0 atau tak ada. */
export function perubahanPersen(baru, lama) {
  if (!Number.isFinite(baru) || !Number.isFinite(lama) || lama === 0) return null;
  return Math.round(((baru - lama) / lama) * 1000) / 10;
}

// ---------------------------------------------------------------- harga

const pembulatHarga = (n) => Math.round(n / 50_000) * 50_000;

/**
 * Perkiraan harga wajar satu video = views dasar × harga per 1.000 views (rentang asumsi).
 * Views dasar = MEDIAN views posting ER, bukan rata-rata: video viral tidak boleh menaikkan harga.
 */
export function perkiraanHarga(viewsDasar, cpmMin, cpmMaks) {
  if (!(viewsDasar > 0) || !(cpmMin > 0) || !(cpmMaks >= cpmMin)) return null;
  const min = pembulatHarga((viewsDasar / 1000) * cpmMin);
  const maks = pembulatHarga((viewsDasar / 1000) * cpmMaks);
  return { min, maks, tengah: pembulatHarga((min + maks) / 2) };
}

/** Harga yang diminta KOL → harga per 1.000 views + penilaian terhadap rentang asumsi. */
export function nilaiHargaDiminta(harga, viewsDasar, cpmMin, cpmMaks) {
  if (!(harga > 0) || !(viewsDasar > 0)) return null;
  const cpm = Math.round((harga / viewsDasar) * 1000);
  const nilai = cpm < cpmMin ? "MURAH" : cpm <= cpmMaks ? "WAJAR" : "MAHAL";
  return { cpm, nilai };
}

/** "15jt", "12,5 juta", "15.000.000", "800rb", "800k" → rupiah; null bila tak terbaca. */
export function bacaRupiah(teks) {
  const t = String(teks ?? "").toLowerCase().replace(/rp\.?/g, "").replace(/\s+/g, "");
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)*)(jt|juta|rb|ribu|k)?$/.exec(t);
  if (!m) return null;
  let n;
  if (m[2]) {
    n = Number(m[1].replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    n *= m[2] === "jt" || m[2] === "juta" ? 1_000_000 : 1_000;
  } else {
    n = Number(m[1].replace(/[.,]/g, ""));
  }
  // Di atas Rp 10 miliar per video hampir pasti salah ketik.
  return Number.isFinite(n) && n > 0 && n <= 10_000_000_000 ? Math.round(n) : null;
}

/** "Rp 12,1 jt", "Rp 850 rb", "Rp 9.500". */
export function rupiahPendek(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `Rp ${angkaPendek(n)}`;
}
