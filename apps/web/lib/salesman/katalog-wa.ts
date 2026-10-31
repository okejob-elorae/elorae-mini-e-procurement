/**
 * "Kirim katalog" ke pemilik toko lewat WhatsApp — bagian yang murni: pesan
 * teks, harga yang boleh tampil, pembungkusan teks kartu, nama berkas. Gambar
 * kartunya digambar di HP (`app/pwa/stores/[id]/kirim-katalog/gambar-kartu.ts`);
 * tidak ada yang dicatat ke server.
 *
 * Nomor WhatsApp memakai penormal yang sama dengan tombol "Perlu ditagih" di
 * beranda (`tautanWhatsApp` di `dasbor.ts`), supaya satu nomor toko tidak
 * ditafsirkan dua cara.
 */

import { tautanWhatsApp } from "./dasbor";

/** Satu kiriman paling banyak sepuluh kartu: lebih dari itu obrolan toko tenggelam gambar. */
export const BATAS_PRODUK_KATALOG = 10;

/**
 * Harga yang boleh tampil di kartu dan pesan. Toko konsinyasi TIDAK PERNAH
 * melihat harga — barang titipan bukan barang yang dijual ke toko — jadi
 * pilihan salesman diabaikan untuk mereka.
 */
export function hargaTampil(jenisToko: "PUTUS" | "KONSI", tampilkanHarga: boolean, harga: number | null): number | null {
  if (jenisToko !== "PUTUS" || !tampilkanHarga) return null;
  return harga;
}

/** Label varian katalog ("Hitam · XL (SKU)") tanpa akhiran SKU — pemilik toko membaca ukurannya, bukan kodenya. */
export function labelVarian(label: string, variantSku: string): string {
  const bersih = label.trim();
  if (!bersih) return variantSku;
  const akhiran = ` (${variantSku})`;
  return bersih.endsWith(akhiran) ? bersih.slice(0, -akhiran.length).trim() || variantSku : bersih;
}

/** Ukuran/varian yang ada stoknya, urutan katalog, tanpa ganda. */
export function ukuranTersedia(
  varian: readonly { variantSku: string; variantLabel: string; available: number }[],
): string[] {
  const hasil: string[] = [];
  for (const v of varian) {
    if (v.available <= 0) continue;
    const l = labelVarian(v.variantLabel, v.variantSku);
    if (!hasil.includes(l)) hasil.push(l);
  }
  return hasil;
}

/**
 * Bungkus teks ke beberapa baris selebar `lebar` menurut `ukur` (di kanvas:
 * `ctx.measureText(s).width`). Baris yang tidak muat di `maksBaris` dipotong
 * dengan elipsis di baris terakhir, supaya nama panjang tidak menabrak harga.
 */
export function bungkusTeks(teks: string, lebar: number, ukur: (s: string) => number, maksBaris: number): string[] {
  const kata = teks.trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0 || maksBaris < 1) return [];

  // Kata yang lebih lebar dari satu baris dipecah per huruf lebih dulu.
  const potongan: string[] = [];
  for (const k of kata) {
    if (ukur(k) <= lebar) {
      potongan.push(k);
      continue;
    }
    let sisa = "";
    for (const huruf of k) {
      if (sisa && ukur(sisa + huruf) > lebar) {
        potongan.push(sisa);
        sisa = huruf;
      } else sisa += huruf;
    }
    if (sisa) potongan.push(sisa);
  }

  const baris: string[] = [];
  let i = 0;
  while (i < potongan.length && baris.length < maksBaris) {
    const terakhir = baris.length === maksBaris - 1;
    if (terakhir) {
      const semua = potongan.slice(i).join(" ");
      if (ukur(semua) <= lebar) {
        baris.push(semua);
        i = potongan.length;
        break;
      }
      // Tidak muat: ambil awalan terpanjang yang masih muat bersama elipsis.
      let awal = "";
      for (const huruf of semua) {
        if (ukur(`${(awal + huruf).trimEnd()}…`) > lebar) break;
        awal += huruf;
      }
      baris.push(`${awal.trimEnd()}…`);
      i = potongan.length;
      break;
    }
    let isi = potongan[i];
    i++;
    while (i < potongan.length && ukur(`${isi} ${potongan[i]}`) <= lebar) {
      isi = `${isi} ${potongan[i]}`;
      i++;
    }
    baris.push(isi);
  }
  return baris;
}

/** Nama berkas gambar kartu: urutan dua digit supaya galeri HP menyimpannya berurutan. */
export function namaBerkasKartu(sku: string, urutan: number): string {
  const aman = sku.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "produk";
  return `elorae-${String(urutan + 1).padStart(2, "0")}-${aman}.jpg`;
}

/**
 * Pilihan awal di layar kirim katalog: saran toko ini dulu, lalu barang baru,
 * tanpa ganda, hanya yang memang ada di katalog (ada stoknya), paling banyak `batas`.
 */
export function pilihAwal(
  saranIds: readonly string[],
  baruIds: readonly string[],
  diKatalog: ReadonlySet<string>,
  batas: number = BATAS_PRODUK_KATALOG,
): string[] {
  const hasil: string[] = [];
  for (const id of [...saranIds, ...baruIds]) {
    if (hasil.length >= batas) break;
    if (diKatalog.has(id) && !hasil.includes(id)) hasil.push(id);
  }
  return hasil;
}

export type ProdukPesan = { nama: string; sku: string; harga: number | null; ukuran: string[] };

/**
 * Pesan teks yang menyertai gambar. Kalimat pembuka/penutup sudah diterjemahkan
 * oleh pemanggil (next-intl); di sini hanya susunannya. Nama dibuat tebal
 * dengan `*…*` gaya WhatsApp; bintang di nama barang dibuang supaya tebalnya
 * tidak pecah.
 *
 * `harga` sudah melewati `hargaTampil` — fungsi ini tidak memutuskan apa pun
 * soal boleh-tidaknya harga tampil.
 */
export function susunPesanKatalog(opsi: {
  pembuka: string;
  penutup: string;
  labelUkuran: string;
  formatHarga: (n: number) => string;
  produk: readonly ProdukPesan[];
  catatan?: string | null;
}): string {
  const baris: string[] = [opsi.pembuka.trim(), ""];
  opsi.produk.forEach((p, i) => {
    const nama = p.nama.replace(/\*/g, "").trim();
    baris.push(`${i + 1}. *${nama}* (${p.sku})`);
    if (p.ukuran.length > 0) baris.push(`   ${opsi.labelUkuran}: ${p.ukuran.join(", ")}`);
    if (p.harga !== null) baris.push(`   ${opsi.formatHarga(p.harga)}`);
  });
  const catatan = (opsi.catatan ?? "").trim();
  if (catatan) baris.push("", catatan);
  baris.push("", opsi.penutup.trim());
  return baris.join("\n");
}

/**
 * Tautan wa.me dengan pesan terisi. Kalau nomor toko bukan nomor HP (telepon
 * rumah/kantor) atau kosong, tautannya tanpa nomor: WhatsApp membuka pemilih
 * obrolan dan salesman memilih sendiri — lebih baik daripada mengirim ke
 * obrolan yang tidak pernah dibaca siapa pun.
 */
export function tautanWaKatalog(telepon: string | null | undefined, pesan: string): string {
  return tautanWhatsApp(telepon, pesan) ?? `https://wa.me/?text=${encodeURIComponent(pesan)}`;
}
