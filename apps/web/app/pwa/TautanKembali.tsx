"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { adaSebelumnya, bacaRiwayat } from "@/lib/pwa/riwayat";

/**
 * Tombol "← Kembali" aplikasi HP: kembali ke halaman yang BENAR-BENAR dibuka
 * sebelumnya (beranda, Lainnya, Kabar, halaman toko…), bukan ke tujuan yang
 * dipatok. Bila tidak ada halaman sebelumnya — layar dibuka langsung dari
 * notifikasi atau tautan — ia menuju `cadangan`.
 *
 * Tetap sebuah tautan ke `cadangan`, jadi tetap bekerja sebelum JavaScript siap
 * dan bisa dibuka di tab baru. Labelnya selalu "Kembali": tujuan sebenarnya
 * baru diketahui saat diketuk, jadi nama halaman di label bisa menyesatkan.
 */
export function TautanKembali({
  cadangan,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href" | "children"> & { cadangan: string }) {
  const router = useRouter();
  const t = useTranslations("common");
  return (
    <Link
      href={cadangan}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (adaSebelumnya(bacaRiwayat())) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("back")}
    </Link>
  );
}
