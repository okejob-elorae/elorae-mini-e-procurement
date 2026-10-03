/**
 * Aturan sales penanggung jawab toko — murni, tanpa basis data.
 *
 * Setiap toko dipegang satu sales (`Store.salesmanId`), dan pemegangnya sering
 * dirotasi. Siapa yang MENJUAL tetap tercatat di faktur dan pesanan; pemegang
 * menyatakan siapa yang bertanggung jawab atas toko itu SEKARANG.
 */

/**
 * Bolehkah seorang sales membuka dan check-in di toko ini.
 *
 * Kunci "hanya toko sendiri" dinyalakan pemilik dari Pengaturan → Salesman,
 * setelah semua toko punya pemegang. Selama mati, semua toko terbuka seperti
 * sebelumnya. Saat menyala, toko tanpa pemegang TERTUTUP untuk semua orang:
 * ia pekerjaan admin yang belum selesai, bukan toko bebas.
 */
export function bolehPegangToko(opts: {
  terkunci: boolean;
  penanggungJawabId: string | null;
  userId: string;
}): boolean {
  if (!opts.terkunci) return true;
  return opts.penanggungJawabId !== null && opts.penanggungJawabId === opts.userId;
}

/**
 * Siapa yang menagih sebuah piutang (keputusan pemilik): pemegang toko yang
 * sekarang — sales baru membantu menagih faktur sales lama. Selama toko belum
 * punya pemegang, penjual aslinya.
 */
export function penagihPiutang(opts: { penanggungJawabId: string | null; penjualId: string }): string {
  return opts.penanggungJawabId ?? opts.penjualId;
}

export type LingkupPindah = {
  /** Area (StoreGroup). */
  groupId?: string;
  /** Pemegang sekarang; "TANPA" = toko yang belum punya pemegang. */
  dari?: string | "TANPA";
  /** Toko yang dipilih satu per satu. */
  storeIds?: string[];
};

type WhereToko =
  | { groupId: string }
  | { salesmanId: string | null }
  | { id: { in: string[] } };

/**
 * Lingkup pindah massal → filter toko. Lingkup KOSONG ditolak: tanpa itu satu
 * klik memindahkan seluruh toko ke satu orang.
 */
export function lingkupPindah(
  l: LingkupPindah,
): { ok: true; where: { AND: WhereToko[] } } | { ok: false; alasan: "LINGKUP_KOSONG" } {
  const syarat: WhereToko[] = [];
  if (l.groupId) syarat.push({ groupId: l.groupId });
  if (l.dari) syarat.push({ salesmanId: l.dari === "TANPA" ? null : l.dari });
  if (l.storeIds && l.storeIds.length > 0) syarat.push({ id: { in: l.storeIds } });
  if (syarat.length === 0) return { ok: false, alasan: "LINGKUP_KOSONG" };
  return { ok: true, where: { AND: syarat } };
}
