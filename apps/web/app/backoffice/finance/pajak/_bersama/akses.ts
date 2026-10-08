import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { AksesPajak } from "./NavPajak";

/** Akses halaman pajak dari izin sesi (murni). */
export function aksesPajak(izin: string[]): AksesPajak & { kelola: boolean } {
  return {
    bacaJurnal: hasPermission(izin, PERMISSIONS.JOURNALS_VIEW),
    faktur: hasPermission(izin, PERMISSIONS.TAX_INVOICES_VIEW),
    pengaturan: hasPermission(izin, PERMISSIONS.SETTINGS_TAX_VIEW) || hasPermission(izin, PERMISSIONS.SETTINGS_TAX_MANAGE),
    kelola: hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE),
  };
}

/** "2026-09" → "September 2026" (id) / "September 2026" (en). */
export function labelMasa(masa: string, locale: string = "id"): string {
  const [t, b] = masa.split("-").map(Number);
  if (!t || !b) return masa;
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(t, b - 1, 1)),
  );
}
