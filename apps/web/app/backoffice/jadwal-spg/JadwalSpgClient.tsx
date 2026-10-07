"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeftRight, CalendarRange, ChevronLeft, ChevronRight, Store } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDisplayDate } from "@/lib/date-only";
import { geserHari } from "@/lib/spg/shift";
import type { BarisTukarKantor, DataJadwalSpgKantor, TokoBerSpg } from "@/lib/spg/shift-queries";
import { KisiJadwalSpg, versiKisi } from "./KisiJadwalSpg";
import { TukarShiftKantor } from "./TukarShiftKantor";

const ALAMAT = "/backoffice/jadwal-spg";

export type PropsJadwalSpg = {
  tab: "jadwal" | "tukar";
  toko: TokoBerSpg[];
  storeId: string | null;
  senin: string;
  hariIni: string;
  mingguIni: string;
  sebelum: string;
  sesudah: string;
  data: DataJadwalSpgKantor | null;
  tukar: { menunggu: BarisTukarKantor[]; riwayat: BarisTukarKantor[]; menungguRekan: number } | null;
  menungguKantor: number;
  bolehUbah: boolean;
};

/**
 * Layar kantor Jadwal & shift SPG: tab Jadwal (kisi SPG × 7 hari satu toko,
 * disunting sebagai draf lalu disimpan sekali) dan tab Tukar shift.
 * Pindah toko/minggu/tab dengan perubahan yang belum disimpan meminta
 * konfirmasi lebih dulu — drafnya hilang saat pindah.
 */
export function JadwalSpgClient(props: PropsJadwalSpg) {
  const t = useTranslations("jadwalSpg");
  const locale = useLocale();
  const router = useRouter();
  const [belumDisimpan, setBelumDisimpan] = useState(0);
  const [tujuan, setTujuan] = useState<string | null>(null);

  const alamat = (o: { tab?: "jadwal" | "tukar"; toko?: string | null; minggu?: string }) => {
    const q = new URLSearchParams();
    const tab = o.tab ?? props.tab;
    const toko = o.toko !== undefined ? o.toko : props.storeId;
    if (tab === "tukar") q.set("tab", "tukar");
    if (toko) q.set("toko", toko);
    q.set("minggu", o.minggu ?? props.senin);
    return `${ALAMAT}?${q.toString()}`;
  };
  const pindah = (url: string) => {
    if (belumDisimpan > 0) setTujuan(url);
    else router.push(url);
  };
  const tanggal = (day: string) => formatDisplayDate(new Date(`${day}T00:00:00+07:00`), locale);

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} />

      <Tabs
        value={props.tab}
        onValueChange={(v) => v !== props.tab && pindah(alamat({ tab: v === "tukar" ? "tukar" : "jadwal" }))}
      >
        <TabsList aria-label={t("judul")}>
          <TabsTrigger value="jadwal">
            <CalendarRange className="mr-2 h-4 w-4" aria-hidden />
            {t("tab.jadwal")}
          </TabsTrigger>
          <TabsTrigger value="tukar">
            <ArrowLeftRight className="mr-2 h-4 w-4" aria-hidden />
            {t("tab.tukar")}
            {props.menungguKantor > 0 ? <Badge className="ml-2 px-1.5 py-0 tabular-nums">{props.menungguKantor}</Badge> : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {props.tab === "tukar" ? (
        <TukarShiftKantor data={props.tukar ?? { menunggu: [], riwayat: [], menungguRekan: 0 }} bolehUbah={props.bolehUbah} />
      ) : props.toko.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={Store} title={t("kosongTokoJudul")} description={t("kosongTokoIsi")} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Select value={props.storeId ?? undefined} onValueChange={(id) => pindah(alamat({ toko: id }))}>
              <SelectTrigger className="w-full sm:w-[300px]" aria-label={t("pilihToko")}>
                <SelectValue placeholder={t("pilihToko")} />
              </SelectTrigger>
              <SelectContent>
                {props.toko.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nama} · {t("jumlahSpg", { count: s.jumlahSpg })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label={t("mingguSebelum")} onClick={() => pindah(alamat({ minggu: props.sebelum }))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[11rem] text-center text-sm font-medium tabular-nums">
                {t("rentangMinggu", { dari: tanggal(props.senin), sampai: tanggal(geserHari(props.senin, 6)) })}
              </span>
              <Button variant="outline" size="icon" aria-label={t("mingguSesudah")} onClick={() => pindah(alamat({ minggu: props.sesudah }))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              {props.senin !== props.mingguIni ? (
                <Button variant="ghost" size="sm" onClick={() => pindah(alamat({ minggu: props.mingguIni }))}>
                  {t("mingguIni")}
                </Button>
              ) : null}
            </div>
          </div>

          {!props.bolehUbah ? <p className="text-sm text-muted-foreground">{t("hanyaLihat")}</p> : null}

          {props.data ? <KisiJadwalSpg key={versiKisi(props.data)} data={props.data} bolehUbah={props.bolehUbah} onBelumDisimpan={setBelumDisimpan} /> : null}
        </>
      )}

      <AlertDialog open={tujuan !== null} onOpenChange={(o) => !o && setTujuan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("buangJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("buangIsi", { count: belumDisimpan })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tetapDiSini")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const url = tujuan;
                setTujuan(null);
                setBelumDisimpan(0);
                if (url) router.push(url);
              }}
            >
              {t("buang")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
