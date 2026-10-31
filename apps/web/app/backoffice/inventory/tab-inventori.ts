/** Tab halaman Inventori yang boleh datang dari `?tab=`. */
export const TAB_INVENTORI = ["stock", "grn", "rolls", "adjustments"] as const;
export type TabInventori = (typeof TAB_INVENTORI)[number];

export function tabInventori(nilai: string | null | undefined): TabInventori {
  return (TAB_INVENTORI as readonly string[]).includes(nilai ?? "") ? (nilai as TabInventori) : "stock";
}
