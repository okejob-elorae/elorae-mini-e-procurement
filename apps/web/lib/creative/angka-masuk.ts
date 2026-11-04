/**
 * Parser angka pemaaf — murni, aman untuk klien.
 *
 * Angka views, pengikut, GMV, dan fee diketik orang dari layar lain: "52k",
 * "1,2jt", "Rp 1.250.000", "4,8". Menolaknya memaksa orang menghitung ulang di
 * kepala; membacanya salah lebih buruk lagi. Aturannya:
 *   - akhiran: k/rb/ribu = ribu; jt/juta/m/mio = juta (gaya media sosial, "1.2M"
 *     berarti 1,2 juta pengikut); miliar/milyar/b/bn = miliar.
 *   - bila titik DAN koma muncul, yang terakhir pemisah desimal;
 *   - satu jenis pemisah yang muncul lebih dari sekali = pemisah ribuan;
 *   - satu pemisah tunggal diikuti TEPAT tiga digit tanpa akhiran = ribuan
 *     ("88.000", "1,250"), selain itu desimal ("4,8", "12,50", "1.2jt").
 */

// Urutannya penting: "rb" harus terbaca ribu sebelum "b" sempat terbaca miliar.
const AKHIRAN: [RegExp, number][] = [
  [/(ribu|rb|k)$/, 1_000],
  [/(juta|jt|mio|m)$/, 1_000_000],
  [/(miliar|milyar|bn|b)$/, 1_000_000_000],
];

export function bacaAngka(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let t = (input ?? "").toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  t = t.replace(/^(rp\.?|idr)/, "").replace(/%$/, "");

  let kali = 1;
  for (const [pola, nilai] of AKHIRAN) {
    if (pola.test(t)) {
      t = t.replace(pola, "");
      kali = nilai;
      break;
    }
  }

  const negatif = t.startsWith("-");
  if (negatif) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;

  const titik = (t.match(/\./g) ?? []).length;
  const koma = (t.match(/,/g) ?? []).length;
  let bersih: string;
  if (titik && koma) {
    const desimal = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const ribuan = desimal === "." ? "," : ".";
    if ((t.match(desimal === "." ? /\./g : /,/g) ?? []).length > 1) return null;
    bersih = t.split(ribuan).join("").replace(desimal, ".");
  } else if (titik || koma) {
    const p = titik ? "." : ",";
    const n = titik || koma;
    if (n > 1) {
      const bagian = t.split(p);
      if (bagian.slice(1).some((b) => b.length !== 3)) return null;
      bersih = bagian.join("");
    } else {
      const [depan, belakang] = t.split(p);
      bersih = belakang.length === 3 && kali === 1 ? `${depan}${belakang}` : `${depan || "0"}.${belakang}`;
    }
  } else {
    bersih = t;
  }

  const n = Number(bersih);
  if (!Number.isFinite(n)) return null;
  const hasil = Math.round(n * kali * 100) / 100;
  return negatif ? -hasil : hasil;
}

/** Untuk views, pengikut, order: bilangan bulat ≥ 0 (pecahan dibulatkan ke bawah), atau null. */
export function bacaBilanganBulat(input: string | number | null | undefined): number | null {
  const n = bacaAngka(input);
  if (n === null || n < 0) return null;
  return Math.floor(n);
}
