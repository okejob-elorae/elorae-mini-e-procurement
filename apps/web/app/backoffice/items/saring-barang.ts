/**
 * Saringan daftar barang di alamat (`?type=&search=&kategori=&status=&page=`),
 * supaya daftar yang tersaring bisa dibagikan dan dibuka ulang.
 */

export type StatusBarang = "" | "aktif" | "nonaktif";

type Param = string | string[] | undefined;

const pertama = (v: Param): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

export function bacaSaringBarang(sp: { kategori?: Param; status?: Param }): { kategori: string; status: StatusBarang } {
  const status = pertama(sp.status);
  return {
    kategori: pertama(sp.kategori),
    status: status === "aktif" || status === "nonaktif" ? status : "",
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
  s: { type: string; search: string; kategori: string; status: StatusBarang; page: number },
): string {
  const params = new URLSearchParams();
  if (s.type) params.set("type", s.type);
  if (s.search.trim()) params.set("search", s.search.trim());
  if (s.kategori) params.set("kategori", s.kategori);
  if (s.status) params.set("status", s.status);
  if (s.page > 1) params.set("page", String(s.page));
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
