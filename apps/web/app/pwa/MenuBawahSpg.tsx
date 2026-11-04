"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Boxes, Ellipsis, House, ReceiptText, ScanLine } from "lucide-react";
import { tabAktifSpg, tampilkanMenuSpg } from "@/lib/pwa/menu-spg";
import { MenuBawah } from "./MenuBawah";

/**
 * Menu bawah SPG: Beranda, Jual, Stok, Nota, Lainnya. Kapan tampil dan tab
 * mana yang menyala diatur `lib/pwa/menu-spg.ts` (dites).
 */
export function MenuBawahSpg() {
  const t = useTranslations("pwaMenuSpg");
  const path = usePathname();
  if (!tampilkanMenuSpg(path)) return null;

  return (
    <MenuBawah
      label={t("label")}
      aktif={tabAktifSpg(path)}
      item={[
        { kunci: "beranda", href: "/pwa", ikon: House, label: t("beranda") },
        { kunci: "jual", href: "/pwa/spg/sale", ikon: ScanLine, label: t("jual") },
        { kunci: "stok", href: "/pwa/spg/stok", ikon: Boxes, label: t("stok") },
        { kunci: "nota", href: "/pwa/spg/nota", ikon: ReceiptText, label: t("nota") },
        { kunci: "lainnya", href: "/pwa/spg/lainnya", ikon: Ellipsis, label: t("lainnya") },
      ]}
    />
  );
}
