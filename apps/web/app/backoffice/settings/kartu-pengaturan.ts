import { FileDigit, Layers, Percent, Ruler, Shield, Store, Tags, Target, UserPlus, Users, type LucideIcon } from "lucide-react";

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
