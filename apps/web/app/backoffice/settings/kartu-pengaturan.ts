import { FileDigit, Layers, Percent, Ruler, Shield, Store, Tags, Target, UserPlus, Users, type LucideIcon } from "lucide-react";
import { PERMISSIONS } from "@/lib/rbac";

/**
 * Kartu pusat pengaturan (`/backoffice/settings`): pengaturan usaha yang
 * dipakai bersama, dikelompokkan. `judul`/`isi` adalah kunci relatif
 * `settings`; bila tidak diisi, kartu memakai `<key>.title`/`<key>.description`
 * (yang juga dipakai daftar Bantuan).
 */
export type KartuPengaturan = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Kunci judul pengganti — mis. halaman Pajak juga memuat kartu Surat PO. */
  judul?: string;
  isi?: string;
};

export type KelompokPengaturan = { judulKey: string; items: KartuPengaturan[] };

export const KELOMPOK_PENGATURAN: KelompokPengaturan[] = [
  {
    judulKey: "hub.groupField",
    items: [
      { key: "salesman", href: "/backoffice/settings/salesman", icon: Target },
      { key: "spg", href: "/backoffice/settings/spg", icon: Store },
      { key: "jenisPotongan", href: "/backoffice/settings/jenis-potongan", icon: Tags },
      // Fiturnya kini "Rencana kirim" dan tombol "+1 pack" katalog, bukan lagi smart request.
      { key: "packRatio", href: "/backoffice/settings/pack-ratio", icon: Layers, isi: "hub.packRatioDescription" },
    ],
  },
  {
    judulKey: "hub.groupData",
    items: [
      { key: "documents", href: "/backoffice/settings/documents", icon: FileDigit },
      { key: "itemCodes", href: "/backoffice/settings/item-codes", icon: FileDigit },
      { key: "uom", href: "/backoffice/settings/uom", icon: Ruler },
      // Halaman Pajak juga memuat kalimat pembuka/penutup surat PO — orang yang mencari "surat PO" harus menemukannya.
      { key: "tax", href: "/backoffice/settings/tax", icon: Percent, judul: "hub.taxTitle", isi: "hub.taxDescription" },
    ],
  },
  {
    judulKey: "hub.groupAccess",
    items: [
      { key: "users", href: "/backoffice/settings/users", icon: UserPlus },
      { key: "rbac", href: "/backoffice/settings/rbac", icon: Users },
      { key: "security", href: "/backoffice/settings/security", icon: Shield },
    ],
  },
];

export const kunciJudulKartu = (k: KartuPengaturan) => k.judul ?? `${k.key}.title`;
export const kunciIsiKartu = (k: KartuPengaturan) => k.isi ?? `${k.key}.description`;

/**
 * Kartu yang hanya tampil bagi pemegang salah satu izin ini; kartu lain selalu tampil.
 * Daftarnya WAJIB memuat izin yang diminta rutenya (`ROUTE_PERMISSIONS`) — kartu yang tampil
 * untuk orang yang tidak bisa membuka halamannya hanya mengantar ke /backoffice.
 */
export const IZIN_KARTU_PENGATURAN: Record<string, string[]> = {
  "/backoffice/settings/pack-ratio": [PERMISSIONS.SETTINGS_PACK_RATIO_VIEW, PERMISSIONS.SETTINGS_PACK_RATIO_MANAGE],
  "/backoffice/settings/spg-commission": [PERMISSIONS.SPG_COMMISSION_MANAGE],
  "/backoffice/settings/piutang": [PERMISSIONS.RECEIVABLES_MANAGE],
};
