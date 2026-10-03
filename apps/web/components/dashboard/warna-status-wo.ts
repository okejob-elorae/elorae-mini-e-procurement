/**
 * Warna status perintah kerja — SATU tempat untuk lencana dan batang
 * komposisinya.
 *
 * Sebelumnya batangnya memakai palet grafik menurut URUTAN baris yang terisi,
 * sementara lencana di bawahnya memakai rona per status: DRAFT abu di lencana
 * bisa biru di batang, dan warnanya pindah pemilik begitu satu status kosong.
 * Sekarang keduanya dari rona yang sama, terkunci ke statusnya.
 */
export const WO_STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  ISSUED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PRODUCTION: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  PARTIAL: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

/** Ruas batang: rona yang sama dengan lencananya, cukup pekat untuk angka putih. */
export const WO_STATUS_BAR_CLASS: Record<string, string> = {
  DRAFT: "bg-gray-500",
  ISSUED: "bg-blue-600",
  IN_PRODUCTION: "bg-amber-600",
  PARTIAL: "bg-purple-600",
  COMPLETED: "bg-green-600",
  CANCELLED: "bg-red-600",
};

export const WO_STATUS_LABEL_KEY: Record<string, "draft" | "issued" | "inProduction" | "partial" | "completed" | "cancelled"> = {
  DRAFT: "draft",
  ISSUED: "issued",
  IN_PRODUCTION: "inProduction",
  PARTIAL: "partial",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};
