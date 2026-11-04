"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ClipboardList, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PenerimaDiharapkan } from "@/lib/field-sales/konsi-transfer/pesanan-lama-aturan";

export type PesananLamaRingkas = { id: string; orderNo: string; disetujuiLabel: string; jumlahBarang: number; pcs: number };

/**
 * "Pesanan lama — konfirmasi barang sudah sampai" di halaman toko salesman: pesanan konsinyasi
 * LAMA yang cadangannya masih ditahan. Toko tanpa SPG dikonfirmasi salesman pemegangnya saat
 * berkunjung; toko ber-SPG oleh SPG-nya — salesman hanya melihat bahwa pesanan itu menunggu.
 * Hanya nomor, tanggal, dan pcs: tidak ada harga konsinyasi di HP.
 */
export function PesananLamaToko({
  storeId,
  pesanan,
  penerima,
  sayaPemegang,
  sudahCheckIn,
}: {
  storeId: string;
  pesanan: PesananLamaRingkas[];
  penerima: PenerimaDiharapkan;
  sayaPemegang: boolean;
  sudahCheckIn: boolean;
}) {
  const t = useTranslations("pwa.pesananLama.kartu");
  if (pesanan.length === 0) return null;
  const bolehSaya = penerima === "SALESMAN" && sayaPemegang;
  return (
    <section className="space-y-2" aria-labelledby="judul-pesanan-lama">
      <h2 id="judul-pesanan-lama" className="beranda-judul px-1">
        {t("judul", { count: pesanan.length })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <ul className="divide-y">
          {pesanan.map((p) => (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <ClipboardList className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-medium leading-tight">{p.orderNo}</p>
                  <p className="text-xs text-muted-foreground">{t("disetujui", { tanggal: p.disetujuiLabel })}</p>
                  <p className="text-sm font-semibold">{t("ringkas", { count: p.jumlahBarang, pcs: p.pcs })}</p>
                </div>
              </div>
              {bolehSaya ? (
                sudahCheckIn ? (
                  <Button asChild className="w-full">
                    <Link href={`/pwa/stores/${encodeURIComponent(storeId)}/pesanan-lama/${encodeURIComponent(p.id)}`}>
                      <PackageCheck className="h-4 w-4" aria-hidden />
                      {t("tombol")}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{t("perluCheckIn")}</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  {penerima === "SPG" ? t("olehSpg") : penerima === "SALESMAN" ? t("olehPemegang") : t("tanpaPenerima")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
