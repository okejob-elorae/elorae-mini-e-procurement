/**
 * Baris Prisma → objek yang boleh dikirim aksi server ke komponen klien:
 * setiap kolom Decimal (decimal.js) menjadi angka, kolom lain apa adanya.
 *
 * Dikenali dari bentuknya (`toNumber`), bukan dari kelasnya — adaptor bisa
 * membawa salinan kelas Decimal sendiri. Sengaja umum: daftar nama kolom
 * pernah ketinggalan `commissionPerPcs` saat `Item` mendapatkannya, dan halaman
 * perintah kerja lalu gagal dengan "Decimal objects are not supported".
 * Hanya satu tingkat — relasi bersarang diserialisasi pemanggilnya.
 */
export function adalahDecimal(v: unknown): boolean {
  return v != null && typeof v === "object" && !(v instanceof Date) && typeof (v as { toNumber?: unknown }).toNumber === "function";
}

export function decimalKeAngka<T extends Record<string, unknown>>(baris: T): T {
  return Object.fromEntries(Object.entries(baris).map(([k, v]) => [k, adalahDecimal(v) ? Number(v) : v])) as T;
}
