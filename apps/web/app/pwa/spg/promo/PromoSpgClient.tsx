"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, CalendarClock, Package, Tag } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PromoHp } from "@/lib/spg/promo-konter-kantor-queries";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Nama barang yang tampil sebelum "Lihat semua". */
const NAMA_TAMPIL = 6;

/**
 * Promo di toko ini, untuk SPG menawarkannya ke pembeli. Layar jual sendiri
 * yang menghitung potongannya — di sini hanya penjelasan.
 */
export function PromoSpgClient({ namaToko, promos }: { namaToko: string; promos: PromoHp[] }) {
  const t = useTranslations("pwaSpgPromo");
  const berlaku = promos.filter((p) => p.status === "BERLAKU");
  const nanti = promos.filter((p) => p.status === "TERJADWAL");

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/sale" />
      </Button>

      <header className="min-w-0">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      <section className="space-y-2" aria-labelledby="promo-berlaku">
        <h2 id="promo-berlaku" className="text-base font-semibold">
          {t("berlaku", { n: berlaku.length })}
        </h2>
        {berlaku.length === 0 ? (
          <Card className="py-0">
            <CardContent className="p-4 text-sm text-muted-foreground">{t("kosongBerlaku")}</CardContent>
          </Card>
        ) : (
          berlaku.map((p) => <KartuPromo key={p.id} p={p} />)
        )}
      </section>

      {nanti.length > 0 ? (
        <section className="space-y-2" aria-labelledby="promo-nanti">
          <h2 id="promo-nanti" className="text-base font-semibold">
            {t("akanDatang", { n: nanti.length })}
          </h2>
          {nanti.map((p) => (
            <KartuPromo key={p.id} p={p} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function KartuPromo({ p }: { p: PromoHp }) {
  const t = useTranslations("pwaSpgPromo");
  const [semua, setSemua] = useState(false);

  const masa = !p.mulai && !p.akhir
    ? t("tanpaBatas")
    : p.status === "TERJADWAL"
      ? p.akhir
        ? t("mulaiSampai", { mulai: p.mulai ?? "", akhir: p.akhir })
        : t("mulai", { mulai: p.mulai ?? "" })
      : p.akhir
        ? t("sampai", { akhir: p.akhir })
        : t("tanpaBatasAkhir");

  const nama = [...p.barang, ...p.kategori.map((k) => t("kategori", { nama: k }))];
  const tampil = semua ? nama : nama.slice(0, NAMA_TAMPIL);
  const paket = p.isiPaket.length > 0;

  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {paket ? <Package className="h-4 w-4" aria-hidden /> : <Tag className="h-4 w-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{p.name}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="whitespace-normal">
                {p.ringkasan}
              </Badge>
              {p.memberOnly ? (
                <Badge variant="outline" className="whitespace-normal">
                  <BadgeCheck aria-hidden />
                  {t("khususMember")}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        {p.memberOnly ? <p className="text-sm text-muted-foreground">{t("khususMemberBantu")}</p> : null}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
          {masa}
        </p>
        {paket ? (
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{t("isiPaket")}</p>
            <ul className="space-y-1">
              {p.isiPaket.map((k, i) => (
                <li key={`${k.jenis}-${i}`} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-semibold tabular-nums">{k.qty} ×</span>
                  <span className="min-w-0">
                    {k.nama}
                    {k.jenis === "CATEGORY" ? <span className="text-muted-foreground"> {t("isiKategori")}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-sm">
            <span className="text-muted-foreground">{p.belanja ? t("berlakuUntukBelanja") : t("berlakuUntuk")} </span>
            {p.semuaBarang ? (
              <span>{t("semuaBarang")}</span>
            ) : (
              <>
                <span>{tampil.join(", ")}</span>
                {nama.length > NAMA_TAMPIL ? (
                  <Button variant="link" size="sm" className="h-auto px-1 py-0" onClick={() => setSemua((x) => !x)}>
                    {semua ? t("ringkas") : t("lihatSemua", { n: nama.length })}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
