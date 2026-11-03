/**
 * Saringan daftar barang di alamat (`?type=&search=&kategori=&status=&saluran=&page=`),
 * supaya daftar yang tersaring bisa dibagikan dan dibuka ulang. `saluran` = "Dijual di"
 * (jawaban pemilik P3, 2026-11-02), selalu barang jadi saja.
 */

import { bacaSaluranJual, type SaluranJual } from "@/lib/items/saluran-jual";

export type StatusBarang = "" | "aktif" | "nonaktif";

type Param = string | string[] | undefined;

const pertama = (v: Param): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export function bacaSaringBarang(sp: { kategori?: Param; status?: Param; saluran?: Param }): {
  kategori: string;
  status: StatusBarang;
  saluran: SaluranJual | "";
} {
  const status = pertama(sp.status);
  return {
    kategori: pertama(sp.kategori),
    status: status === "aktif" || status === "nonaktif" ? status : "",
    saluran: bacaSaluranJual(pertama(sp.saluran)) ?? "",
  };
}

/** Untuk `listItems({ isActive })`: kosong = semua barang. */
export function isActiveDariStatus(status: StatusBarang): boolean | undefined {
  if (status === "aktif") return true;
  if (status === "nonaktif") return false;
  return undefined;
}

export function alamatDaftarBarang(
  pathname: string,
  s: { type: string; search: string; kategori: string; status: StatusBarang; saluran?: SaluranJual | ""; page: number },
): string {
  const params = new URLSearchParams();
  if (s.type) params.set("type", s.type);
  if (s.search.trim()) params.set("search", s.search.trim());
  if (s.kategori) params.set("kategori", s.kategori);
  if (s.status) params.set("status", s.status);
  if (s.saluran) params.set("saluran", s.saluran);
  if (s.page > 1) params.set("page", String(s.page));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
