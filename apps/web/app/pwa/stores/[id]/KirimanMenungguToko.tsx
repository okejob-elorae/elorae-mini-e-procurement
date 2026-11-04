"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";

export type KirimanMenungguRingkas = {
  sourceType: "KONSI_TRANSFER" | "PUTUS_DELIVERY";
  sourceId: string;
  docNo: string;
  tanggalLabel: string;
  pcs: number;
};

/**
 * "Kiriman menunggu diterima" di halaman toko salesman pemegang, selama ia berkunjung, untuk toko
 * yang SPG-nya sudah berhenti (P45/P45a): barangnya sudah diserahkan ke toko, tetapi belum ada
 * yang menerimanya di sistem. Penanggung jawab toko yang menerima; salesman mencatatnya. Hanya
 * nomor, tanggal, dan pcs — tidak ada harga.
 */
export function KirimanMenungguToko({ storeId, kiriman }: { storeId: string; kiriman: KirimanMenungguRingkas[] }) {
  const t = useTranslations("pwa.terimaPemegang");
  const td = dinamis(t);
  if (kiriman.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="judul-kiriman-menunggu">
      <h2 id="judul-kiriman-menunggu" className="beranda-judul px-1">
        {t("kartu.judul", { count: kiriman.length })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <p className="px-4 pt-3 text-sm text-muted-foreground">{t("kartu.petunjuk")}</p>
        <ul className="divide-y">
          {kiriman.map((k) => (
            <li key={`${k.sourceType}:${k.sourceId}`} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Truck className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-medium leading-tight">{k.docNo}</p>
                  <p className="text-xs text-muted-foreground">{td(`jenis.${k.sourceType}`)}</p>
                  <p className="text-sm font-semibold">{t("kartu.ringkas", { pcs: k.pcs, tanggal: k.tanggalLabel })}</p>
                </div>
              </div>
              <Button asChild className="w-full">
                <Link
                  href={`/pwa/stores/${encodeURIComponent(storeId)}/terima/${k.sourceType}/${encodeURIComponent(k.sourceId)}`}
                >
                  <PackageCheck className="h-4 w-4" aria-hidden />
                  {t("kartu.tombol")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
