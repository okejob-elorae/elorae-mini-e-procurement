import { bungkusTeks } from "@/lib/salesman/katalog-wa";

/**
 * Menggambar satu kartu produk (1080×1350, rasio 4:5 — ukuran yang ditampilkan
 * utuh oleh WhatsApp tanpa dipotong) di kanvas, di HP salesman. Tidak ada yang
 * dikirim ke server.
 *
 * Foto diambil lewat `/api/gambar-produk/[itemId]` — asal yang sama dengan
 * aplikasi. Foto dari R2/CDN langsung akan "mencemari" kanvas dan `toBlob`
 * ditolak peramban.
 */

export const LEBAR_KARTU = 1080;
export const TINGGI_KARTU = 1350;

const TEPI = 64;
const TINGGI_FOTO = 920;
const TINGGI_KAKI = 104;
const WARNA_TEKS = "#111827";
const WARNA_REDUP = "#6b7280";
const WARNA_LATAR_FOTO = "#f3f4f6";

export type IsiKartu = {
  itemId: string;
  punyaFoto: boolean;
  nama: string;
  sku: string;
  ukuran: string[];
  /** Sudah diformat, atau null bila harga tidak boleh tampil. */
  harga: string | null;
};

export type TeksKartu = { ukuran: string; merek: string };

async function muatFoto(itemId: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = `/api/gambar-produk/${encodeURIComponent(itemId)}`;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Foto utuh di dalam kotak (contain), bukan dipotong — produk pakaian tidak boleh terpotong kepalanya. */
function gambarFoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const skala = Math.min(LEBAR_KARTU / img.naturalWidth, TINGGI_FOTO / img.naturalHeight);
  const w = img.naturalWidth * skala;
  const h = img.naturalHeight * skala;
  ctx.drawImage(img, (LEBAR_KARTU - w) / 2, (TINGGI_FOTO - h) / 2, w, h);
}

/** Teks berjarak antarhuruf, digambar per huruf: `ctx.letterSpacing` belum ada di semua Safari. */
function teksBerjarak(ctx: CanvasRenderingContext2D, teks: string, tengahX: number, y: number, jarak: number) {
  const huruf = [...teks];
  const lebar = huruf.reduce((n, h) => n + ctx.measureText(h).width, 0) + jarak * (huruf.length - 1);
  let x = tengahX - lebar / 2;
  for (const h of huruf) {
    ctx.fillText(h, x, y);
    x += ctx.measureText(h).width + jarak;
  }
}

export async function buatKartu(isi: IsiKartu, teks: TeksKartu, keluargaHuruf: string): Promise<Blob> {
  const kanvas = document.createElement("canvas");
  kanvas.width = LEBAR_KARTU;
  kanvas.height = TINGGI_KARTU;
  const ctx = kanvas.getContext("2d");
  if (!ctx) throw new Error("KANVAS_TIDAK_ADA");
  const huruf = (tebal: number, ukuran: number) => `${tebal} ${ukuran}px ${keluargaHuruf}`;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LEBAR_KARTU, TINGGI_KARTU);

  // Foto — atau inisial nama bila barangnya belum punya foto.
  ctx.fillStyle = WARNA_LATAR_FOTO;
  ctx.fillRect(0, 0, LEBAR_KARTU, TINGGI_FOTO);
  const foto = isi.punyaFoto ? await muatFoto(isi.itemId) : null;
  if (foto) gambarFoto(ctx, foto);
  else {
    ctx.fillStyle = "#d1d5db";
    ctx.font = huruf(700, 320);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((isi.nama.trim()[0] ?? "?").toUpperCase(), LEBAR_KARTU / 2, TINGGI_FOTO / 2);
  }

  // Keterangan: nama (≤ 2 baris), ukuran yang ada stoknya, lalu baris bawah
  // berisi SKU di kiri dan harga di kanan — harga besar, yang pertama dicari
  // pemilik toko.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lebarTeks = LEBAR_KARTU - TEPI * 2;
  const ukur = (s: string) => ctx.measureText(s).width;
  let y = TINGGI_FOTO + 40;

  ctx.fillStyle = WARNA_TEKS;
  ctx.font = huruf(700, 54);
  for (const baris of bungkusTeks(isi.nama, lebarTeks, ukur, 2)) {
    ctx.fillText(baris, TEPI, y);
    y += 66;
  }

  if (isi.ukuran.length > 0) {
    ctx.fillStyle = WARNA_TEKS;
    ctx.font = huruf(500, 34);
    const [baris] = bungkusTeks(`${teks.ukuran}: ${isi.ukuran.join(" · ")}`, lebarTeks, ukur, 1);
    if (baris) ctx.fillText(baris, TEPI, y);
  }

  const dasarBawah = TINGGI_KARTU - TINGGI_KAKI - 30;
  ctx.textBaseline = "alphabetic";
  let lebarHarga = 0;
  if (isi.harga) {
    ctx.fillStyle = WARNA_TEKS;
    ctx.font = huruf(800, 60);
    ctx.textAlign = "right";
    ctx.fillText(isi.harga, LEBAR_KARTU - TEPI, dasarBawah);
    lebarHarga = ukur(isi.harga) + 32;
  }
  ctx.fillStyle = WARNA_REDUP;
  ctx.font = huruf(500, 32);
  ctx.textAlign = "left";
  const [sku] = bungkusTeks(isi.sku, Math.max(120, lebarTeks - lebarHarga), ukur, 1);
  if (sku) ctx.fillText(sku, TEPI, dasarBawah);

  // Kaki bermerek.
  ctx.fillStyle = WARNA_TEKS;
  ctx.fillRect(0, TINGGI_KARTU - TINGGI_KAKI, LEBAR_KARTU, TINGGI_KAKI);
  ctx.fillStyle = "#ffffff";
  ctx.font = huruf(700, 40);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  teksBerjarak(ctx, teks.merek, LEBAR_KARTU / 2, TINGGI_KARTU - TINGGI_KAKI / 2, 14);

  return new Promise<Blob>((selesai, gagal) => {
    kanvas.toBlob((blob) => (blob ? selesai(blob) : gagal(new Error("KANVAS_GAGAL"))), "image/jpeg", 0.9);
  });
}
