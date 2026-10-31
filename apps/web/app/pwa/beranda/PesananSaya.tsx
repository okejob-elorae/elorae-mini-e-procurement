"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PesananSaya as DataPesanan } from "@/lib/salesman/queries";
import { cn } from "@/lib/utils";

/**
 * Empat angka status pesanan salesman dalam SATU baris.
 *
 * Dulu kisi 2×2 berlatar — setinggi kartu target, untuk empat angka yang
 * biasanya nol. Satu baris cukup: angkanya dibaca sekilas, dan yang perlu
 * perhatian (menunggu, ditolak) diberi warna. Kiriman yang tertahan di HP
 * tidak di sini lagi — sudah jadi tugas di atas dan titik di menu Lainnya.
 *
 * Setiap angka menaut ke tab daftar "Pesanan saya" yang sama. Alamatnya ditulis
 * di sini, bukan diimpor dari `lib/field-sales/pwa-queries` — modul itu memuat
 * Prisma dan tidak boleh ikut ke bundel HP. Nilai `status` harus sama dengan
 * `TAB_PESANAN` di sana. Tab "Disetujui" = angka "Siap dikirim" persis; tab
 * lain lebih luas dari angkanya (semua yang terkirim / ditolak, bukan hanya
 * bulan ini / 7 hari), sehingga yang dihitung di sini selalu ada di tab itu.
 */
export function PesananSaya({ data }: { data: DataPesanan }) {
  const t = useTranslations("pwa.beranda");
  const sel = [
    { label: t("ordersWaiting"), nilai: data.menunggu, nada: data.menunggu > 0 ? "tunggu" : null, href: "/pwa/orders?status=menunggu" },
    { label: t("ordersToShip"), nilai: data.siapKirim, nada: null, href: "/pwa/orders?status=disetujui" },
    { label: t("ordersDelivered"), nilai: data.terkirimBulanIni, nada: null, href: "/pwa/orders?status=dikirim" },
    {
      label: t("ordersRejected"),
      nilai: data.ditolak7Hari,
      nada: data.ditolak7Hari > 0 ? "buruk" : null,
      href: "/pwa/orders?status=ditolak",
    },
  ] as const;

  return (
    <section className="beranda-kartu">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul">{t("ordersTitle")}</h2>
        <Link
          href="/pwa/orders"
          className="-my-2 inline-flex min-h-11 items-center text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
        >
          {t("ordersSeeAll")}
        </Link>
      </div>
      <ul className="mt-1 grid grid-cols-4 gap-2">
        {sel.map((u) => (
          <li key={u.href} className="min-w-0">
            <Link
              href={u.href}
              className="-mx-1 flex min-h-11 flex-col rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60"
            >
              <span
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  u.nada === "tunggu" && "text-amber-700 dark:text-amber-400",
                  u.nada === "buruk" && "text-destructive",
                )}
              >
                {u.nilai}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">{u.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
