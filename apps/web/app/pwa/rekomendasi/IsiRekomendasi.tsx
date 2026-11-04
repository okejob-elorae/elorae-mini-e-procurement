"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianRekomendasi } from "@/lib/salesman/rekomendasi-queries";
import { cn } from "@/lib/utils";
import { NADA_STATUS_REKOMENDASI } from "./tampilan";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/**
 * Bagian yang sama di rincian salesman dan rincian SPG: kepala (toko, status,
 * tanggal), catatan pengirim, jawaban, dan baris barangnya. Tidak ada harga.
 */
export function KepalaRekomendasi({ rincian, untukSpg = false }: { rincian: RincianRekomendasi; untukSpg?: boolean }) {
  const t = useTranslations("pwaRekomendasi");
  const td = dinamis(t);
  return (
    <header className="space-y-1">
      <div className="flex items-center gap-1">
        <h1 className="min-w-0 break-words text-2xl font-bold">{untukSpg ? t("rincian.judulSpg") : rincian.toko.nama}</h1>
        <TombolBantuanHp judul={untukSpg ? t("rincian.judulSpg") : rincian.toko.nama} />
      </div>
      <p className="text-sm text-muted-foreground">
        {untukSpg && rincian.pembuat ? t("rincian.dari", { nama: rincian.pembuat }) : td(`jenis.${rincian.toko.jenis}`)} · {rincian.dibuat}
      </p>
      <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", NADA_STATUS_REKOMENDASI[rincian.status])}>
        {td(`status.${rincian.status}`)}
      </span>
    </header>
  );
}

export function CatatanJawaban({ rincian }: { rincian: RincianRekomendasi }) {
  const t = useTranslations("pwaRekomendasi.rincian");
  if (!rincian.catatan && !rincian.jawaban) return null;
  const ditolak = rincian.status === "DITOLAK";
  return (
    <section className="beranda-kartu space-y-2 text-sm">
      {rincian.catatan ? (
        <div className="space-y-0.5">
          <p className="text-muted-foreground">{t("catatanPengirim")}</p>
          <p className="whitespace-pre-line">{rincian.catatan}</p>
        </div>
      ) : null}
      {rincian.jawaban ? (
        <div className={cn("space-y-0.5 rounded-lg px-3 py-2", ditolak ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <p className="font-medium">
            {t(ditolak ? "ditolakOleh" : "dijawabOleh", { nama: rincian.jawaban.oleh ?? "—", tanggal: rincian.jawaban.pada })}
          </p>
          {rincian.jawaban.catatan ? <p className="whitespace-pre-line">{rincian.jawaban.catatan}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export function DaftarBarisRekomendasi({ rincian }: { rincian: RincianRekomendasi }) {
  const t = useTranslations("pwaRekomendasi");
  const td = dinamis(t);
  return (
    <section className="space-y-2" aria-labelledby="judul-baris-rekomendasi">
      <h2 id="judul-baris-rekomendasi" className="beranda-judul px-1">
        {t("rincian.barisJudul", { baris: rincian.baris.length, pcs: rincian.totalPcs })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <ul className="divide-y">
          {rincian.baris.map((b) => (
            <li key={b.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium leading-tight">{b.productName}</p>
                {b.alasan && b.alasan !== "MANUAL" ? (
                  <Badge variant="outline" className="whitespace-normal">
                    {td(`alasan.${b.alasan}`)}
                  </Badge>
                ) : null}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{t("pcs", { n: b.qty })}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
