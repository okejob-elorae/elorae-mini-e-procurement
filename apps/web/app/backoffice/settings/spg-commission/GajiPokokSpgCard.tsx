"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { aturGajiBulananSpgAction, daftarGajiBulananSpgAction } from "@/app/actions/settings/spg-gaji";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisGajiBulananSpg } from "@/lib/spg/gaji-pokok-queries";
import { formatYearMonth } from "./format";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const bulanWibSekarang = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

function geserBulan(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Pengaturan → Komisi SPG #gaji-pokok (P7a): satu gaji bulanan per SPG, berlaku mulai bulan kerja
 * tertentu. Bulan yang sudah dibayar terkunci — perubahan yang menggeser gajinya ditolak dan bulan
 * itu disebut. Tombol = `spg_commission:manage`, sama dengan aksinya; tanpa izin itu kartu ini
 * tidak tampil.
 */
export function GajiPokokSpgCard({ locale }: { locale: string }) {
  const t = useTranslations("settings.spgCommission.gaji");
  const td = dinamis(useTranslations("settings.spgCommission.gaji"));
  const [baris, setBaris] = useState<BarisGajiBulananSpg[] | null>(null);
  const [tanpaAkses, setTanpaAkses] = useState(false);
  const [sibuk, mulai] = useTransition();
  const [ubah, setUbah] = useState<{ userId: string; jumlah: string; mulai: string } | null>(null);

  const muat = useCallback(async () => {
    const r = await daftarGajiBulananSpgAction();
    if (!r.ok) {
      setTanpaAkses(true);
      return;
    }
    setBaris(r.baris);
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  if (tanpaAkses) return null;

  const kini = bulanWibSekarang();
  const pilihanBulan = Array.from({ length: 15 }, (_, i) => geserBulan(kini, i - 12)).reverse();

  const simpan = () =>
    mulai(async () => {
      const u = ubah;
      if (!u) return;
      try {
        const r = await aturGajiBulananSpgAction({ userId: u.userId, jumlah: u.jumlah.replace(/\./g, ""), berlakuMulai: u.mulai });
        if (!r.ok) {
          toast.error(r.bulan ? t("errBulanDibayar", { bulan: formatYearMonth(r.bulan, locale) }) : td(`err.${r.code}`));
          return;
        }
        toast.success(t("ok"));
        setUbah(null);
        await muat();
      } catch {
        toast.error(td("err.GAGAL"));
      }
    });

  return (
    <Card id="gaji-pokok">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 shrink-0" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("isi")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {baris === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : baris.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        ) : (
          baris.map((b) => {
            const berlaku = b.riwayat.filter((r) => r.effectiveFrom <= kini).at(-1) ?? null;
            const sedangUbah = ubah?.userId === b.userId;
            return (
              <div key={b.userId} className="space-y-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {b.nama}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {b.namaToko ?? "—"}
                      {b.berhenti ? ` · ${t("berhenti")}` : ""}
                      {!b.mulai ? ` · ${t("tanpaMulai")}` : ""}
                    </span>
                  </p>
                  <p className="tabular-nums">{berlaku ? t("berlaku", { jumlah: rupiah(berlaku.jumlah), bulan: formatYearMonth(berlaku.effectiveFrom, locale) }) : t("belumDiatur")}</p>
                </div>
                {b.riwayat.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    {b.riwayat.map((r) => `${formatYearMonth(r.effectiveFrom, locale)}: ${rupiah(r.jumlah)}`).join(" · ")}
                  </p>
                ) : null}
                {b.bulanDibayarTerakhir ? (
                  <p className="text-xs text-muted-foreground">{t("terkunciSampai", { bulan: formatYearMonth(b.bulanDibayarTerakhir, locale) })}</p>
                ) : null}
                {sedangUbah && ubah ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`gaji-${b.userId}`}>{t("jumlah")}</Label>
                      <Input
                        id={`gaji-${b.userId}`}
                        inputMode="numeric"
                        className="w-40"
                        value={ubah.jumlah}
                        onChange={(e) => {
                          const angka = e.target.value.replace(/\D/g, "");
                          setUbah({ ...ubah, jumlah: angka ? Number(angka).toLocaleString("id-ID") : "" });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`mulai-${b.userId}`}>{t("mulai")}</Label>
                      <Select value={ubah.mulai} onValueChange={(v) => setUbah({ ...ubah, mulai: v })}>
                        <SelectTrigger id={`mulai-${b.userId}`} className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pilihanBulan.map((m) => (
                            <SelectItem key={m} value={m} disabled={b.bulanDibayar.includes(m)}>
                              {formatYearMonth(m, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" disabled={sibuk || !ubah.jumlah} onClick={simpan}>
                      {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                      {t("simpan")}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={sibuk} onClick={() => setUbah(null)}>
                      {t("batal")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUbah({ userId: b.userId, jumlah: berlaku ? berlaku.jumlah.toLocaleString("id-ID") : "", mulai: kini })}
                  >
                    {berlaku ? t("ubah") : t("atur")}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
