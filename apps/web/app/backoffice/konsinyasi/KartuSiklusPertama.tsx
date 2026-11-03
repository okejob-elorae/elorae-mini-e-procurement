"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import { aturBulanSiklusPertamaAction } from "@/app/actions/konsinyasi";

const labelBulan = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** Bulan WIB sekarang −24 sampai +3 — rentang yang masuk akal untuk siklus pertama. */
function pilihanBulan(): string[] {
  const kini = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const [y, m] = kini.split("-").map(Number);
  const hasil: string[] = [];
  for (let d = 3; d >= -24; d--) {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    hasil.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return hasil;
}

/**
 * Bulan siklus pertama konsinyasi (P59). Selama belum diatur, tidak ada siklus yang bisa dikunci —
 * kalau tidak, tagihan siklus bisa menagih bulan yang utangnya sudah diimpor dari kertas. Diatur
 * pemegang `consignment:lock` (tombol = izin aksinya); yang lain hanya membaca.
 */
export function KartuSiklusPertama({ bulan, bolehMengatur }: { bulan: string | null; bolehMengatur: boolean }) {
  const t = useTranslations("konsinyasi.siklusPertama");
  const tk = dinamis(useTranslations("konsinyasi.siklusPertama"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ubah, setUbah] = useState(false);
  const [isian, setIsian] = useState(bulan ?? "");

  if (bulan && !bolehMengatur) return null;

  const simpan = () =>
    startTransition(async () => {
      try {
        const r = await aturBulanSiklusPertamaAction(isian);
        if (r.ok) {
          toast.success(t("ok"));
          setUbah(false);
          router.refresh();
        } else {
          toast.error(tk(`err_${r.kode}`, { nomor: r.nomor ?? "" }));
        }
      } catch {
        toast.error(tk("err_GAGAL"));
      }
    });

  return (
    <Card className={bulan ? undefined : "border-amber-500/40 bg-amber-500/[0.05]"}>
      <CardContent className="flex flex-wrap items-start gap-3 py-4 text-sm">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">{bulan ? t("set", { month: labelBulan(bulan) }) : t("notSet")}</p>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          {bolehMengatur && (ubah || !bulan) ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="siklus-pertama">{t("label")}</Label>
                <Select value={isian} onValueChange={setIsian}>
                  <SelectTrigger id="siklus-pertama" className="w-48">
                    <SelectValue placeholder={t("placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {pilihanBulan().map((b) => (
                      <SelectItem key={b} value={b}>
                        {labelBulan(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={pending || !/^\d{4}-\d{2}$/.test(isian)} onClick={simpan}>
                {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t("save")}
              </Button>
              {bulan ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setUbah(false)}>
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          ) : bolehMengatur ? (
            <Button size="sm" variant="outline" onClick={() => setUbah(true)}>
              {t("change")}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t("lockOnly")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
