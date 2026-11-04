import { rasioKontras } from '@/lib/production-colors/palet/kontras';
import type { LembarPalet } from '@/lib/production-colors/palet/lembar';
import type { KeterbacaanSablon, PeranSablon } from '@/lib/production-colors/sablon/saran';

/**
 * Ekspor palet di peramban: lembar cetak (PDF lewat dialog cetak) dan gambar
 * PNG. Keduanya membaca `LembarPalet` yang sama; tidak ada yang dikirim ke
 * server.
 */

/** Nama berkas yang aman di semua sistem: huruf kecil, angka, dan tanda hubung. */
export function namaBerkas(nama: string, cadangan: string): string {
  const slug = nama
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `palet-${slug || cadangan}`;
}

/*
 * Pola cetak yang sama dengan nota dan surat jalan: dokumen ditulis ke iframe
 * tersembunyi lalu dialog cetak dibuka — di sana orang memilih "Simpan sebagai
 * PDF". Judul halaman dipinjam sebentar karena Chrome dan Safari menamai berkas
 * PDF dari judul halaman induk, bukan dari iframe.
 */
export function cetakHtml(html: string, judul: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
  iframe.setAttribute('title', judul);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const judulAsli = document.title;
  setTimeout(() => {
    document.title = judul;
    iframe.contentWindow?.print();
    document.title = judulAsli;
    setTimeout(() => iframe.remove(), 500);
  }, 350);
}

export function unduh(blob: Blob, berkas: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = berkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type LabelGambarPalet = {
  title: string;
  untitled: string;
  sub: string;
  fabric: string;
  base: string;
  role: (peran: PeranSablon) => string;
  readability: (k: KeterbacaanSablon) => string;
  note: string;
  footer: string;
};

const W = 1600;
const TEPI = 80;
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TINTA = '#111827';
const PUDAR = '#6b7280';
const GARIS = '#e5e7eb';

function kotakBulat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ubin(ctx: CanvasRenderingContext2D, hex: string, x: number, y: number, w: number, h: number, r: number) {
  kotakBulat(ctx, x, y, w, h, r);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function teks(ctx: CanvasRenderingContext2D, isi: string, x: number, y: number, font: string, warna: string, maks?: number, rata: CanvasTextAlign = 'left') {
  ctx.font = font;
  ctx.fillStyle = warna;
  ctx.textAlign = rata;
  let s = isi;
  if (maks && ctx.measureText(s).width > maks) {
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maks) s = s.slice(0, -1);
    s = `${s}…`;
  }
  ctx.fillText(s, x, y);
}

function muatGambar(svg: string): Promise<HTMLImageElement> {
  return new Promise((selesai, gagal) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      selesai(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      gagal(new Error('SVG kaos tidak bisa dimuat'));
    };
    img.src = url;
  });
}

function keBlob(kanvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((selesai, gagal) => {
    try {
      kanvas.toBlob((b) => (b ? selesai(b) : gagal(new Error('Kanvas kosong'))), 'image/png');
    } catch (e) {
      // Sebagian peramban menandai kanvas "kotor" setelah menggambar SVG.
      gagal(e);
    }
  });
}

/**
 * Kartu palet sebagai PNG selebar 1600 px, latar putih — untuk WhatsApp atau
 * presentasi. Kalau peramban menolak mengekspor kanvas yang memuat gambar kaos
 * (SVG), kartu digambar ulang tanpa kaos alih-alih gagal.
 */
export async function buatGambarPalet(lembar: LembarPalet, opsi: { kaosSvg: string | null; labels: LabelGambarPalet; angka: (n: number) => string }): Promise<Blob> {
  let kaos: HTMLImageElement | null = null;
  if (opsi.kaosSvg) {
    try {
      kaos = await muatGambar(opsi.kaosSvg);
    } catch {
      kaos = null;
    }
  }
  try {
    return await keBlob(gambar(lembar, kaos, opsi));
  } catch (e) {
    if (!kaos) throw e;
    return keBlob(gambar(lembar, null, opsi));
  }
}

function gambar(lembar: LembarPalet, kaos: HTMLImageElement | null, opsi: { labels: LabelGambarPalet; angka: (n: number) => string }): HTMLCanvasElement {
  const { labels, angka } = opsi;
  const berkain = lembar.kain !== null;
  const lebarIsi = W - 2 * TEPI;

  const KEPALA = 250;
  const TINGGI_BARIS = 158;
  const TINGGI_KAIN = 150;
  const kaosLebar = 560;
  const kaosTinggi = (kaosLebar * 420) / 400;
  const tinggiBadan = berkain
    ? Math.max(kaos ? kaosTinggi : 0, TINGGI_KAIN + lembar.baris.length * TINGGI_BARIS)
    : 520 + 190;
  const H = KEPALA + tinggiBadan + 150;

  const kanvas = document.createElement('canvas');
  kanvas.width = W;
  kanvas.height = H;
  const ctx = kanvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  teks(ctx, labels.title.toUpperCase(), TEPI, 104, `600 24px ${SANS}`, PUDAR);
  teks(ctx, lembar.nama || labels.untitled, TEPI, 176, `700 64px ${SANS}`, TINTA, lebarIsi);
  teks(ctx, labels.sub, TEPI, 222, `400 28px ${SANS}`, PUDAR, lebarIsi);

  const atas = KEPALA + 20;

  if (berkain) {
    const kanan = kaos ? TEPI + kaosLebar + 60 : TEPI;
    const lebarKanan = W - TEPI - kanan;
    if (kaos) ctx.drawImage(kaos, TEPI, atas, kaosLebar, kaosTinggi);

    const kain = lembar.kain!;
    ubin(ctx, kain.hex, kanan, atas, 96, 96, 16);
    teks(ctx, labels.fabric.toUpperCase(), kanan + 124, atas + 26, `600 20px ${SANS}`, PUDAR);
    teks(ctx, kain.nama ?? kain.hex, kanan + 124, atas + 64, `700 32px ${SANS}`, TINTA, lebarKanan - 124);
    teks(ctx, kain.hex, kanan + 124, atas + 96, `400 24px ${MONO}`, PUDAR);

    lembar.baris.forEach((b, i) => {
      const y = atas + TINGGI_KAIN + i * TINGGI_BARIS;
      ubin(ctx, b.hex, kanan, y, 112, 112, 18);
      teks(ctx, b.label, kanan + 56, y + 70, `700 40px ${SANS}`, rasioKontras(b.hex, '#000000') >= rasioKontras(b.hex, '#ffffff') ? '#000000' : '#ffffff', undefined, 'center');

      const persis = b.pantoneC && b.pantoneC.deltaE < 0.05;
      const judul = persis ? `PANTONE ${b.pantoneC!.kode}` : b.hex;
      const x = kanan + 140;
      const lebarTeks = lebarKanan - 140 - 150;
      teks(ctx, judul, x, y + 36, `700 34px ${SANS}`, TINTA, lebarTeks);
      // HEX sudah jadi judul kalau tidak ada Pantone yang persis — jangan diulang.
      teks(ctx, `${persis ? `${b.hex} · ` : ''}RGB ${b.rgb.join(' ')} · CMYK ${b.cmyk.join(' ')}`, x, y + 72, `400 22px ${MONO}`, PUDAR, lebarTeks);
      const baris3 = [
        !persis && b.pantoneC ? `C ${b.pantoneC.kode} ΔE ${angka(b.pantoneC.deltaE)}` : null,
        b.pantoneTcx ? `TCX ${b.pantoneTcx.kode}${b.pantoneTcx.nama ? ` ${b.pantoneTcx.nama}` : ''}` : null,
        b.keterbacaan ? labels.readability(b.keterbacaan) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      teks(ctx, baris3, x, y + 104, `400 22px ${SANS}`, PUDAR, lebarTeks);

      teks(ctx, `${b.porsi ?? 0}%`, W - TEPI, y + 50, `700 48px ${SANS}`, TINTA, undefined, 'right');
      if (b.peran) teks(ctx, labels.role(b.peran), W - TEPI, y + 86, `400 22px ${SANS}`, PUDAR, undefined, 'right');

      kotakBulat(ctx, x, y + 124, lebarKanan - 140, 8, 4);
      ctx.fillStyle = '#f3f4f6';
      ctx.fill();
      kotakBulat(ctx, x, y + 124, Math.max(8, ((lebarKanan - 140) * Math.min(100, b.porsi ?? 0)) / 100), 8, 4);
      ctx.fillStyle = b.hex;
      ctx.fill();
    });
  } else {
    const jarak = 24;
    const lebar = (lebarIsi - jarak * (lembar.baris.length - 1)) / lembar.baris.length;
    lembar.baris.forEach((b, i) => {
      const x = TEPI + i * (lebar + jarak);
      ubin(ctx, b.hex, x, atas, lebar, 520, 20);
      teks(ctx, `${b.label}${b.dasar ? ` · ${labels.base}` : ''}`, x, atas + 570, `700 26px ${SANS}`, TINTA, lebar);
      teks(ctx, b.hex, x, atas + 610, `700 30px ${MONO}`, TINTA, lebar);
      teks(ctx, `RGB ${b.rgb.join(' ')}`, x, atas + 644, `400 20px ${MONO}`, PUDAR, lebar);
      if (b.pantoneC) teks(ctx, `C ${b.pantoneC.kode}`, x, atas + 674, `400 20px ${SANS}`, PUDAR, lebar);
      if (b.pantoneTcx) teks(ctx, `TCX ${b.pantoneTcx.kode}`, x, atas + 702, `400 20px ${SANS}`, PUDAR, lebar);
    });
  }

  const kaki = H - 90;
  ctx.fillStyle = GARIS;
  ctx.fillRect(TEPI, kaki, lebarIsi, 2);
  teks(ctx, labels.footer, TEPI, kaki + 50, `600 22px ${SANS}`, TINTA);
  teks(ctx, labels.note, W - TEPI, kaki + 50, `400 22px ${SANS}`, PUDAR, lebarIsi - 420, 'right');

  return kanvas;
}
