/**
 * Mencari KOL kembar — murni, aman untuk klien.
 *
 * Kembar = nomor WA sama (sesudah `normalisasiWa`) ATAU satu handle sama di
 * platform mana pun. Lintas platform dengan sengaja: orang yang sama sering
 * memakai nama yang sama di Instagram dan TikTok, dan mendaftarkannya dua kali
 * membuat sampel dikirim dua kali ke satu alamat.
 */

import { normalisasiWa } from "./wa";

const AWALAN_JALUR = new Set(["channel", "c", "user", "shop"]);

/**
 * Handle dalam bentuk pembanding: tanpa "@", huruf kecil, dan bila yang
 * diketik tautan profil, hanya nama akunnya.
 */
export function normalisasiHandle(input: string | null | undefined): string | null {
  let t = (input ?? "").trim();
  if (!t) return null;
  if (/^(https?:\/\/)?([a-z0-9-]+\.)*[a-z0-9-]+\.[a-z.]{2,}\//i.test(t) || /^https?:\/\//i.test(t)) {
    const tanpaSkema = t.replace(/^https?:\/\//i, "");
    const jalur = tanpaSkema.slice(tanpaSkema.indexOf("/") + 1).split(/[?#]/)[0];
    const bagian = jalur.split("/").filter(Boolean);
    let i = 0;
    if (bagian[0] && AWALAN_JALUR.has(bagian[0].toLowerCase()) && bagian[1]) i = 1;
    t = bagian[i] ?? "";
  }
  t = t.replace(/^@+/, "").replace(/\/+$/, "").trim().toLowerCase();
  return t || null;
}

export type CalonKembar = { id: string; nama: string; waNormal: string | null; handles: string[] };

export type SebabKembar = "WA" | "HANDLE";

export type Kembar = { id: string; nama: string; sebab: SebabKembar[] };

/** KOL di `daftar` yang kembar dengan calon, dalam urutan `daftar`. */
export function cariKembar(
  calon: { waNormal: string | null | undefined; handles: readonly (string | null | undefined)[] },
  daftar: readonly CalonKembar[],
  kecualiId?: string | null,
): Kembar[] {
  const wa = normalisasiWa(calon.waNormal);
  const handles = new Set(calon.handles.map(normalisasiHandle).filter((h): h is string => h !== null));
  const hasil: Kembar[] = [];
  for (const k of daftar) {
    if (kecualiId && k.id === kecualiId) continue;
    const sebab: SebabKembar[] = [];
    if (wa && normalisasiWa(k.waNormal) === wa) sebab.push("WA");
    if (k.handles.some((h) => {
      const n = normalisasiHandle(h);
      return n !== null && handles.has(n);
    })) {
      sebab.push("HANDLE");
    }
    if (sebab.length) hasil.push({ id: k.id, nama: k.nama, sebab });
  }
  return hasil;
}

/**
 * Kelompok kembar di dalam satu daftar ("Cek kembar"). Rantai ikut digabung:
 * A kembar B lewat handle dan A kembar C lewat WA → satu kelompok A, B, C.
 * Urutan id mengikuti `daftar`.
 */
export function kelompokKembar(daftar: readonly CalonKembar[]): { ids: string[]; sebab: SebabKembar[] }[] {
  const induk = new Map<string, string>(daftar.map((k) => [k.id, k.id]));
  const akar = (x: string): string => {
    let r = x;
    while (induk.get(r) !== r) r = induk.get(r)!;
    induk.set(x, r);
    return r;
  };

  const sisi: { a: string; b: string; sebab: SebabKembar }[] = [];
  const pemilik = new Map<string, string>();
  const catat = (kunci: string, id: string, sebab: SebabKembar) => {
    const lain = pemilik.get(kunci);
    if (!lain) {
      pemilik.set(kunci, id);
      return;
    }
    if (lain === id) return;
    sisi.push({ a: lain, b: id, sebab });
    induk.set(akar(id), akar(lain));
  };

  for (const k of daftar) {
    const wa = normalisasiWa(k.waNormal);
    if (wa) catat(`wa:${wa}`, k.id, "WA");
    for (const h of new Set(k.handles.map(normalisasiHandle))) if (h) catat(`h:${h}`, k.id, "HANDLE");
  }

  const kelompok = new Map<string, string[]>();
  for (const k of daftar) {
    const r = akar(k.id);
    kelompok.set(r, [...(kelompok.get(r) ?? []), k.id]);
  }
  return [...kelompok.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([r, ids]) => ({
      ids,
      sebab: [...new Set(sisi.filter((x) => akar(x.a) === r).map((x) => x.sebab))].sort(),
    }));
}
