"use client";

import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganSinkronPengunjung } from "@/components/spg/PenghitungPengunjungMini";
import { usePenghitungPengunjung, type AwalPengunjung } from "@/components/spg/usePenghitungPengunjung";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiwayatPengunjungHp } from "@/lib/spg/pengunjung-queries";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/**
 * Layar penghitung pengunjung SPG: tombol besar "+1 pengunjung", "Batalkan 1",
 * angka saya hari ini dan total toko hari ini (semua SPG toko ini). Setiap
 * ketukan tersimpan di HP dulu, lalu dikirim sendiri — tanpa sinyal pun tetap
 * menghitung. Riwayat beberapa hari terakhir dari server membuktikan hitungan
 * kemarin sudah sampai.
 */
export function PenghitungPengunjungClient({
  userId,
  storeId,
  namaToko,
  awal,
  labelHari,
  riwayat,
}: {
  userId: string;
  storeId: string;
  namaToko: string;
  awal: AwalPengunjung;
  labelHari: string;
  riwayat: (RiwayatPengunjungHp & { label: string })[];
}) {
  const t = useTranslations("pwaSpgPengunjung");
  const p = usePenghitungPengunjung({ userId, storeId, awal });
  // Layar dibiarkan terbuka melewati tengah malam: label tanggal dari server sudah usang.
  const tanggal = p.hari === awal.day ? labelHari : t("hariIni");

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subjudul", { toko: namaToko, tanggal })}</p>
      </header>

      <Card className="py-0">
        <CardContent className="space-y-1 p-5 text-center">
          <p className="text-sm text-muted-foreground">{t("sayaHariIni")}</p>
          <p className="text-6xl font-bold tracking-tight tabular-nums" aria-live="polite">
            {p.saya}
          </p>
          <p className="text-sm tabular-nums">{t("totalToko", { n: p.totalToko })}</p>
        </CardContent>
      </Card>

      <Button className="h-32 w-full flex-col gap-1 text-2xl font-semibold" onClick={p.tambah} aria-label={t("tambahLabel")}>
        <Plus className="size-8" aria-hidden />
        {t("tambah")}
      </Button>
      <Button variant="outline" className="h-14 w-full text-base" onClick={p.kurangi} disabled={p.saya === 0}>
        <Minus className="h-5 w-5" aria-hidden />
        {t("batalkan")}
      </Button>

      <KeteranganSinkronPengunjung status={p.status} />

      {riwayat.length > 0 ? (
        <Card className="gap-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("riwayat.judul")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="divide-y">
              {riwayat.map((r) => (
                <li key={r.day} className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm">
                  <span className="min-w-0">{r.label}</span>
                  <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                    {r.toko === null
                      ? t("riwayat.kosong")
                      : t("riwayat.angka", { saya: r.saya ?? 0, toko: r.toko })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
