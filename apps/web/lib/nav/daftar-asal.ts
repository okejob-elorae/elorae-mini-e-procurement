/**
 * Daftar asal sebuah alamat rincian kantor, untuk tombol "Kembali ke daftar" di
 * halaman tidak-ditemukan: `/backoffice/promos/xyz` → `/backoffice/promos`.
 * Beberapa rincian tidak punya halaman daftar di induk alamatnya (GRN dan
 * penyesuaian ada di tab Inventori) — dipetakan ke tab itu. Murni.
 */
const PENGGANTI: Record<string, string> = {
  "/backoffice/inventory/grn": "/backoffice/inventory?tab=grn",
  "/backoffice/inventory/adjustment": "/backoffice/inventory?tab=adjustments",
};

export function daftarAsal(pathname: string | null | undefined): string | null {
  const bersih = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "");
  if (!bersih.startsWith("/backoffice/")) return null;
  const bagian = bersih.split("/").filter(Boolean); // ["backoffice", ...]
  if (bagian.length < 3) return null; // /backoffice/x sendiri adalah daftar
  const induk = `/${bagian.slice(0, -1).join("/")}`;
  return PENGGANTI[induk] ?? induk;
}
