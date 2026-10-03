/**
 * Alamat sumber keranjang terisi: `permintaan:<id>` (permintaan barang SPG)
 * atau `rekomendasi:<id>` (rekomendasi salesman yang diterima toko).
 * Murni dan aman untuk klien.
 */
export type SumberKeranjang = { jenis: "permintaan" | "rekomendasi"; id: string };

const POLA = /^(permintaan|rekomendasi):([A-Za-z0-9_-]{1,64})$/;

export function bacaSumberKeranjang(raw: string | null | undefined): SumberKeranjang | null {
  const m = POLA.exec(raw ?? "");
  return m ? { jenis: m[1] as SumberKeranjang["jenis"], id: m[2] } : null;
}

export function tulisSumberKeranjang(s: SumberKeranjang): string {
  return `${s.jenis}:${s.id}`;
}
