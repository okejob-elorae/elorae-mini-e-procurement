import type { KelompokTitip } from "@/lib/spg/titip";

/** Warna lencana titip pesan — sama di HP dan kantor. */
export function nadaKelompokTitip(kelompok: KelompokTitip, status: string): string {
  if (kelompok === "datang") return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
  if (kelompok === "dikabari") return "bg-sky-500/15 text-sky-800 dark:text-sky-300";
  if (kelompok === "menunggu") return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  return status === "BATAL" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
}

/** Kelompok tampilan dari status saja (kantor tidak menghitung stok per baris). */
export function nadaStatusTitip(status: string): string {
  if (status === "TERSEDIA") return nadaKelompokTitip("datang", status);
  if (status === "DIKABARI") return nadaKelompokTitip("dikabari", status);
  if (status === "MENUNGGU") return nadaKelompokTitip("menunggu", status);
  return nadaKelompokTitip("tutup", status);
}
