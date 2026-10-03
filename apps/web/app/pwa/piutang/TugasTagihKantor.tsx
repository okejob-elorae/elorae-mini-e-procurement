"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, ChevronRight, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import { tandaiSudahDitagihAction } from "@/app/actions/tugas-tagih";
import type { KeadaanTugas } from "@/lib/receivables/tugas-tagih";
import type { KeadaanPiutang } from "@/lib/receivables/rules";

/** Satu tugas tagih untuk HP; tanggal sudah diformat di server. */
export type TugasTagihHp = {
  id: string;
  storeId: string;
  storeName: string;
  keadaan: KeadaanTugas;
  note: string | null;
  totalSisa: number;
  tenggatTeks: string | null;
  faktur: { id: string; invoiceNo: string; sisa: number; keadaan: KeadaanPiutang }[];
  /**
   * Toko ini ada di daftar tagihan orang ini (ia penagihnya). Kalau tidak —
   * kantor menugaskan orang lain selain pemegang toko — halaman tagihan toko
   * tidak terbuka untuknya, jadi barisnya tidak ditautkan ke sana.
   */
  bisaDibuka: boolean;
};

/**
 * "Tugas tagih dari kantor" — di kepala layar Tagihan.
 *
 * Tugas tidak mengubah sisa apa pun; ia hanya menyebut toko mana yang kantor
 * minta ditagih sampai kapan. Yang lewat tenggat merah. Yang sisanya sudah
 * dilaporkan bayar disebut MENUNGGU VERIFIKASI, tidak pernah lunas — klaim
 * bukan pembayaran.
 */
export function TugasTagihKantor({ tugas }: { tugas: TugasTagihHp[] }) {
  const t = useTranslations("pwa.tugasTagih");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [buka, setBuka] = useState<TugasTagihHp | null>(null);
  const [hasil, setHasil] = useState("");
  const [galat, setGalat] = useState<string | null>(null);

  if (tugas.length === 0) return null;
  const total = tugas.reduce((s, x) => s + x.totalSisa, 0);

  const simpan = () => {
    if (!buka) return;
    if (!hasil.trim()) {
      setGalat(t("err_HASIL_WAJIB"));
      return;
    }
    startTransition(async () => {
      let h: Awaited<ReturnType<typeof tandaiSudahDitagihAction>>;
      try {
        h = await tandaiSudahDitagihAction(buka.id, hasil);
      } catch {
        setGalat(t("err_GAGAL"));
        return;
      }
      if (h.ok) {
        toast.success(t("okSelesai"));
        setBuka(null);
        router.refresh();
      } else {
        setGalat(td(`err_${h.kode}`));
      }
    });
  };

  return (
    <section className="beranda-kartu beranda-kartu-daftar">
      <div className="px-4 pb-1 pt-3">
        <h2 className="beranda-judul">{t("judul")}</h2>
        <p className="text-xs text-muted-foreground">{t("ringkas", { count: tugas.length, value: formatIDR(total) })}</p>
      </div>
      <ul className="divide-y">
        {tugas.map((g) => {
          const lewat = g.keadaan === "TERLAMBAT";
          const tenang = g.keadaan === "DILAPORKAN" || g.keadaan === "LUNAS";
          return (
            <li key={g.id} className="space-y-2 px-4 py-3">
              <BarisToko href={g.bisaDibuka ? `/pwa/piutang/${g.storeId}` : null}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-tight">{g.storeName}</span>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs",
                      lewat ? "font-semibold text-destructive" : "text-muted-foreground",
                    )}
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {g.tenggatTeks
                      ? lewat
                        ? t("lewat", { date: g.tenggatTeks })
                        : t("tenggat", { date: g.tenggatTeks })
                      : t("tanpaTenggat")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-base font-bold tabular-nums">{formatIDR(g.totalSisa)}</span>
                {g.bisaDibuka && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("bukaToko")} />
                )}
              </BarisToko>

              <ul className="space-y-0.5 pl-12 text-sm">
                {g.faktur.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular-nums">{t("fakturBaris", { no: f.invoiceNo, value: formatIDR(f.sisa) })}</span>
                    {f.keadaan === "klaim" && <span className="text-xs text-primary">{t("fakturDilaporkan")}</span>}
                    {f.keadaan === "lunas" && (
                      <span className="text-xs text-emerald-700 dark:text-emerald-400">{t("fakturLunas")}</span>
                    )}
                  </li>
                ))}
              </ul>

              {g.note && <p className="pl-12 text-sm text-muted-foreground">{t("catatan", { note: g.note })}</p>}
              {tenang && (
                <p
                  className={cn(
                    "ml-12 rounded-lg px-3 py-2 text-sm leading-relaxed",
                    g.keadaan === "LUNAS"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-primary/15 text-foreground",
                  )}
                >
                  {td(`keadaan_${g.keadaan}`)}
                </p>
              )}

              <div className="pl-12">
                <Button
                  variant={tenang ? "outline" : "default"}
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    setBuka(g);
                    setHasil("");
                    setGalat(null);
                  }}
                >
                  {t("tandai")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Sheet open={buka !== null} onOpenChange={(o) => !o && !pending && setBuka(null)}>
        <SheetContent side="bottom" className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-0 p-0">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{t("lembarJudul")}</SheetTitle>
            <SheetDescription>{t("lembarIsi", { toko: buka?.storeName ?? "" })}</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 overflow-y-auto p-4">
            <Label htmlFor="tugas-hasil">{t("hasilLabel")}</Label>
            <Textarea
              id="tugas-hasil"
              value={hasil}
              onChange={(e) => {
                setHasil(e.target.value);
                setGalat(null);
              }}
              placeholder={t("hasilPlaceholder")}
              rows={3}
              aria-invalid={galat !== null}
              aria-describedby={galat ? "tugas-hasil-galat" : undefined}
            />
            {galat && (
              <p id="tugas-hasil-galat" className="text-sm text-destructive">
                {galat}
              </p>
            )}
          </div>
          <SheetFooter className="flex-row gap-2 border-t pt-3">
            <Button variant="outline" className="h-12 flex-1" disabled={pending} onClick={() => setBuka(null)}>
              {t("batal")}
            </Button>
            <Button className="h-12 flex-1" disabled={pending || !hasil.trim()} onClick={simpan}>
              {t("simpan")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** Kepala baris tugas: tautan ke tagihan toko bila terbuka untuknya, selain itu baris biasa. */
function BarisToko({ href, children }: { href: string | null; children: ReactNode }) {
  const kelas = "flex min-h-12 items-center gap-3";
  return href ? (
    <Link href={href} className={kelas}>
      {children}
    </Link>
  ) : (
    <div className={kelas}>{children}</div>
  );
}
