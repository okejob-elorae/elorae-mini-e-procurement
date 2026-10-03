import { tandaiFotoPanduanAction } from "@/app/actions/panduan-display";

/**
 * Tanda "foto ini hasil panduan display X" yang belum sampai ke server.
 *
 * Fotonya naik lewat antrean foto kunjungan yang sudah ada (Dexie
 * `pendingPhotos`), yang tidak membawa panduan. Tandanya disimpan di sini
 * (localStorage) dan dikirim ulang sampai server menemukan fotonya — setelah
 * setiap sinkron antrean, saat layar daftar periksa atau tombol eksekusi di
 * halaman toko dibuka. Tanpa localStorage (mode privat) tandanya dicoba sekali
 * dan fotonya tetap tersimpan sebagai foto kunjungan biasa.
 */

const KUNCI = "elorae.fotoPanduan.v1";
/** Tanda yang tidak kunjung berhasil dibuang — fotonya mungkin sudah dihapus dari antrean. */
const UMUR_MAKS_MS = 14 * 24 * 3600_000;

export type TandaFotoPanduan = { clientId: string; guideId: string; visitId: string; dibuat: number };

function baca(): TandaFotoPanduan[] {
  try {
    const raw = localStorage.getItem(KUNCI);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const batas = Date.now() - UMUR_MAKS_MS;
    return arr.filter(
      (t): t is TandaFotoPanduan =>
        !!t &&
        typeof t.clientId === "string" &&
        typeof t.guideId === "string" &&
        typeof t.visitId === "string" &&
        typeof t.dibuat === "number" &&
        t.dibuat > batas,
    );
  } catch {
    return [];
  }
}

function tulis(daftar: TandaFotoPanduan[]) {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(daftar));
  } catch {
    // Penyimpanan penuh atau diblokir — tanda hanya dicoba sekali.
  }
}

export function tambahTandaFotoPanduan(t: Omit<TandaFotoPanduan, "dibuat">) {
  tulis([...baca().filter((x) => x.clientId !== t.clientId), { ...t, dibuat: Date.now() }]);
}

export function tandaUntukKunjungan(visitId: string): TandaFotoPanduan[] {
  return baca().filter((t) => t.visitId === visitId);
}

let berjalan = false;

/**
 * Kirim semua tanda yang tertahan. `tambahan` = tanda yang baru dibuat, ikut
 * dikirim walau localStorage tidak bisa ditulis. Mengembalikan jumlah yang
 * masih tertahan.
 */
export async function kirimTandaFotoPanduan(tambahan: TandaFotoPanduan[] = []): Promise<number> {
  const tersimpan = baca();
  const daftar = [...tersimpan, ...tambahan.filter((t) => !tersimpan.some((x) => x.clientId === t.clientId))];
  if (daftar.length === 0 || berjalan) return daftar.length;
  if (typeof navigator !== "undefined" && !navigator.onLine) return daftar.length;
  berjalan = true;
  try {
    const r = await tandaiFotoPanduanAction(daftar.slice(0, 50).map((t) => ({ clientId: t.clientId, guideId: t.guideId })));
    if (!r.ok) return daftar.length;
    const selesai = new Set(r.selesai);
    // Dibaca ulang: tanda baru bisa masuk selama permintaan berjalan.
    const sisa = baca().filter((t) => !selesai.has(t.clientId));
    tulis(sisa);
    return sisa.length;
  } catch {
    // Aksi server tak terjangkau (sinyal) — dicoba lagi nanti.
    return daftar.length;
  } finally {
    berjalan = false;
  }
}
