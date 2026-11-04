"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ellipsis, House, ReceiptText, Store, Wallet } from "lucide-react";
import { hitungBelumTerkirim, PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { tabAktif, tampilkanMenu } from "@/lib/pwa/menu";
import { MenuBawah } from "./MenuBawah";

/**
 * Menu bawah tunggal aplikasi salesman.
 *
 * Lima tab — batas sebelum ikon berdesakan di layar HP. Yang sering (toko,
 * tagihan, pelunasan) dapat tab sendiri; yang jarang (retur, jual van, beban,
 * tampilan, keluar) dikumpulkan di Lainnya. Kapan menu tampil dan tab mana
 * yang menyala diatur `lib/pwa/menu.ts` (dites).
 */
export function MenuBawahSalesman() {
  const t = useTranslations("pwaMenu");
  const path = usePathname();
  const [tertahan, setTertahan] = useState(0);

  // Titik di Lainnya: ada kiriman yang belum sampai. Dihitung ulang tiap
  // pindah halaman dan tiap antrean berubah — murah (hitungan IndexedDB).
  useEffect(() => {
    let batal = false;
    const hitung = () =>
      hitungBelumTerkirim().then(
        (n) => !batal && setTertahan(n),
        () => undefined,
      );
    void hitung();
    window.addEventListener(PERISTIWA_ANTREAN, hitung);
    return () => {
      batal = true;
      window.removeEventListener(PERISTIWA_ANTREAN, hitung);
    };
  }, [path]);

  if (!tampilkanMenu(path)) return null;

  return (
    <MenuBawah
      label={t("label")}
      aktif={tabAktif(path)}
      item={[
        { kunci: "beranda", href: "/pwa", ikon: House, label: t("beranda") },
        { kunci: "toko", href: "/pwa/stores", ikon: Store, label: t("toko") },
        { kunci: "tagihan", href: "/pwa/piutang", ikon: ReceiptText, label: t("tagihan") },
        { kunci: "pelunasan", href: "/pwa/bkm", ikon: Wallet, label: t("pelunasan") },
        {
          kunci: "lainnya",
          href: "/pwa/lainnya",
          ikon: Ellipsis,
          label: t("lainnya"),
          titik: tertahan > 0 ? t("unsynced", { count: tertahan }) : null,
        },
      ]}
    />
  );
}
