/*
 * Isian jumlah pembayaran toko (aman untuk peramban, tanpa Prisma).
 *
 * Tagihan konsinyasi bisa berpecahan sen, jadi isian menerima koma desimal
 * (format Indonesia: titik ribuan, koma desimal, paling banyak dua angka sen)
 * dan semua perbandingan dilakukan dalam sen — sama dengan penulisnya.
 */

const keSen = (rupiah: number): number => Math.round(rupiah * 100);

/** "Rp 1.234.567,40" → 1234567.4. Titik dibuang, koma = desimal. */
export function bacaJumlah(teks: string): number {
  const bersih = teks.replace(/[^\d,]/g, "");
  const i = bersih.indexOf(",");
  const bulat = i < 0 ? bersih : bersih.slice(0, i);
  const sen = i < 0 ? "" : bersih.slice(i + 1).replace(/,/g, "");
  return (Number(bulat || "0") * 100 + Number((sen + "00").slice(0, 2))) / 100;
}

/** Merapikan ketikan: titik ribuan dipasang ulang, koma yang sedang diketik dipertahankan. */
export function rapikanJumlah(teks: string): string {
  const bersih = teks.replace(/[^\d,]/g, "");
  if (!bersih) return "";
  const i = bersih.indexOf(",");
  const bulat = (i < 0 ? bersih : bersih.slice(0, i)).replace(/^0+(?=\d)/, "");
  const bulatRapi = Number(bulat || "0").toLocaleString("id-ID");
  if (i < 0) return bulatRapi;
  return `${bulatRapi},${bersih.slice(i + 1).replace(/,/g, "").slice(0, 2)}`;
}

/** Angka → isian, persis sampai sen ("Isi sisa"). */
export function tulisJumlah(rupiah: number): string {
  const sen = keSen(Math.abs(rupiah));
  return (sen / 100).toLocaleString("id-ID", {
    minimumFractionDigits: sen % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Rupiah tanpa tanda; sen hanya ditulis kalau ada. */
export function tulisRupiah(rupiah: number): string {
  return `Rp ${tulisJumlah(rupiah)}`;
}

/** Lebih dari nol dan tidak melebihi sisa, dibandingkan per sen. */
export function jumlahDalamSisa(jumlah: number, sisa: number): boolean {
  const j = keSen(jumlah);
  return j > 0 && j <= keSen(sisa);
}
