"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Banknote, Loader2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { TanggalInput } from "@/components/ui/tanggal-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dinamis } from "@/lib/i18n/dinamis";
import type { PelunasanToko, PembayaranToko, TagihanSiklus } from "@/lib/konsinyasi/queries";
import type { CaraBayarToko } from "@/lib/konsinyasi/writer";
import { batalkanPembayaranTokoAction, catatPembayaranTokoAction } from "@/app/actions/konsinyasi";
import { bacaJumlah, jumlahDalamSisa, rapikanJumlah, tulisJumlah, tulisRupiah } from "./jumlah-bayar";

/**
 * Tanpa tanda — tandanya ditulis di depan baris (− potongan, + beban). Sen
 * ditulis kalau ada: tagihan konsinyasi bisa berpecahan sen, dan sisa 40 sen
 * yang tampil sebagai "Rp 0" tidak bisa dimengerti siapa pun.
 */
const rupiah = tulisRupiah;
const uang = (n: number) => `${Math.round(n * 100) < 0 ? "−" : ""}${rupiah(n)}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const hariIniWib = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

/** Disalin dari `CARA_BAYAR_TOKO` (penulis) — modul itu tidak boleh diimpor nilainya ke peramban. */
const CARA_BAYAR: CaraBayarToko[] = ["transfer", "tunai", "giro"];

/**
 * Ringkasan tagihan siklus ke toko: laku resmi − potongan promo ditanggung
 * Elorae + beban barang hilang ke toko, lalu pelunasannya oleh toko. Sebelum
 * dikunci hanya potongan promo yang sudah ada (dihitung langsung dari nota SPG).
 */
export function TagihanKonsiCard({
  cycleId,
  tagihan,
  pelunasan,
  bolehCatatBayar,
}: {
  cycleId: string;
  tagihan: TagihanSiklus;
  pelunasan: PelunasanToko;
  bolehCatatBayar: boolean;
}) {
  const t = useTranslations("konsinyasi.tagihan");
  const tk = dinamis(useTranslations("konsinyasi"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const promoBerubah = tagihan.beku && Math.round(tagihan.promoEloraeSekarang) !== Math.round(tagihan.promoElorae);

  const [catatTerbuka, setCatatTerbuka] = useState(false);
  const [jumlah, setJumlah] = useState("");
  const [tgl, setTgl] = useState(hariIniWib());
  const [cara, setCara] = useState<CaraBayarToko>("transfer");
  const [catatan, setCatatan] = useState("");

  const [batal, setBatal] = useState<PembayaranToko | null>(null);
  const [alasan, setAlasan] = useState("");

  const sisa = pelunasan.sisa ?? 0;
  const nilaiJumlah = bacaJumlah(jumlah);
  const jumlahSah = jumlahDalamSisa(nilaiJumlah, sisa);
  const melebihiSisa = nilaiJumlah > 0 && !jumlahSah;

  const jalankan = (fn: () => Promise<{ ok: boolean; kode?: string }>, pesan: string, bersih: () => void) => {
    startTransition(async () => {
      try {
        const hasil = await fn();
        if (hasil.ok) {
          toast.success(pesan);
          bersih();
          router.refresh();
        } else {
          toast.error(tk(`err${hasil.kode}`));
        }
      } catch {
        toast.error(tk("errGAGAL"));
      }
    });
  };

  const bukaCatat = () => {
    setJumlah("");
    setTgl(hariIniWib());
    setCara("transfer");
    setCatatan("");
    setCatatTerbuka(true);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="max-w-xl space-y-2 text-sm">
          <Baris label={t("sold")}>
            {tagihan.lakuResmi === null ? <Redup>{t("notLocked")}</Redup> : uang(tagihan.lakuResmi)}
          </Baris>
          <Baris label={t("promo")} keterangan={tagihan.beku ? t("promoFrozen") : t("promoLive")}>
            {tagihan.promoElorae === 0 ? rupiah(0) : `${tagihan.promoElorae > 0 ? "−" : "+"} ${rupiah(tagihan.promoElorae)}`}
          </Baris>
          <Baris label={t("loss")}>
            {tagihan.bebanHilang === null ? (
              <Redup>{t("atLock")}</Redup>
            ) : tagihan.bebanHilang === 0 ? (
              rupiah(0)
            ) : (
              `+ ${rupiah(tagihan.bebanHilang)}`
            )}
          </Baris>
          <Baris label={t("total")} tebal className="border-t pt-2">
            {tagihan.total === null ? <Redup>{t("totalAfterLock")}</Redup> : uang(tagihan.total)}
          </Baris>
          {tagihan.beku && (
            <>
              <Baris label={t("paid")}>{pelunasan.dibayar === 0 ? rupiah(0) : `− ${rupiah(pelunasan.dibayar)}`}</Baris>
              <Baris label={t("remaining")} tebal className="border-t pt-2">
                {pelunasan.lunas ? <StatusPill tone="settled">{t("settled")}</StatusPill> : uang(sisa)}
              </Baris>
            </>
          )}
        </dl>

        {promoBerubah && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{t("promoChanged", { value: uang(tagihan.promoEloraeSekarang) })}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("storeShare")}</p>

        {tagihan.beku && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{t("paymentsTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("paymentsHint")}</p>
              </div>
              {!pelunasan.lunas &&
                (bolehCatatBayar ? (
                  <Button size="sm" disabled={pending} onClick={bukaCatat}>
                    <Banknote className="mr-1.5 h-4 w-4" />
                    {t("recordPayment")}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("financeOnly")}</span>
                ))}
            </div>

            {pelunasan.pembayaran.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {pelunasan.pembayaran.map((p) => {
                  const dibatalkan = p.dibatalkanPada !== null;
                  return (
                    <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className={cn("font-medium tabular-nums", dibatalkan && "text-muted-foreground line-through")}>
                          {rupiah(p.jumlah)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {tanggal(p.tanggal)} · {tk(`tagihan.method_${p.cara}`)}
                          </span>
                        </p>
                        {p.catatan && <p className="text-xs text-muted-foreground">{p.catatan}</p>}
                        <p className="text-xs text-muted-foreground">
                          {t("recordedBy", { name: p.dicatatOleh ?? "—", date: tanggal(p.dicatatPada) })}
                        </p>
                        {dibatalkan && (
                          <p className="text-xs text-destructive">
                            {t("cancelledBy", {
                              name: p.dibatalkanOleh ?? "—",
                              date: tanggal(p.dibatalkanPada as string),
                              reason: p.alasanBatal ?? "—",
                            })}
                          </p>
                        )}
                      </div>
                      {!dibatalkan && bolehCatatBayar && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          disabled={pending}
                          onClick={() => {
                            setAlasan("");
                            setBatal(p);
                          }}
                        >
                          <X className="mr-1 h-4 w-4" />
                          {t("cancelPayment")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={catatTerbuka} onOpenChange={(o) => !pending && setCatatTerbuka(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("recordTitle")}</DialogTitle>
            <DialogDescription>{t("recordBody", { value: uang(sisa) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bt-jumlah">{t("amount")}</Label>
              <div className="flex gap-2">
                <Input
                  id="bt-jumlah"
                  inputMode="decimal"
                  value={jumlah}
                  placeholder="0"
                  onChange={(e) => setJumlah(rapikanJumlah(e.target.value))}
                />
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setJumlah(tulisJumlah(sisa))}>
                  {t("fillRemaining")}
                </Button>
              </div>
              {melebihiSisa && <p className="text-xs text-destructive">{t("overRemaining")}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bt-tgl">{t("date")}</Label>
                <TanggalInput id="bt-tgl" value={tgl} max={hariIniWib()} required onChange={(e) => setTgl(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bt-cara">{t("method")}</Label>
                <Select value={cara} onValueChange={(v) => setCara(v as CaraBayarToko)}>
                  <SelectTrigger id="bt-cara">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARA_BAYAR.map((c) => (
                      <SelectItem key={c} value={c}>
                        {tk(`tagihan.method_${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-catatan">{t("note")}</Label>
              <Textarea id="bt-catatan" rows={2} value={catatan} placeholder={t("notePlaceholder")} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setCatatTerbuka(false)}>
              {t("close")}
            </Button>
            <Button
              disabled={pending || !jumlahSah || !tgl}
              onClick={() =>
                jalankan(
                  () => catatPembayaranTokoAction({ cycleId, jumlah: nilaiJumlah, tanggal: tgl, cara, catatan }),
                  t("okRecorded"),
                  () => setCatatTerbuka(false),
                )
              }
            >
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batal !== null} onOpenChange={(o) => !o && !pending && setBatal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>
              {batal && t("cancelBody", { value: rupiah(batal.jumlah), date: tanggal(batal.tanggal) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bt-alasan">{t("cancelReason")}</Label>
            <Textarea id="bt-alasan" rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setBatal(null)}>
              {t("close")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !alasan.trim()}
              onClick={() =>
                batal &&
                jalankan(() => batalkanPembayaranTokoAction(batal.id, alasan), t("okCancelled"), () => setBatal(null))
              }
            >
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t("cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Baris({
  label,
  keterangan,
  tebal,
  className,
  children,
}: {
  label: string;
  keterangan?: string;
  tebal?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn(tebal ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {keterangan && <span className="block text-xs font-normal text-muted-foreground">{keterangan}</span>}
      </dt>
      <dd className={cn("shrink-0 text-right tabular-nums", tebal && "text-base font-semibold")}>{children}</dd>
    </div>
  );
}

function Redup({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-normal text-muted-foreground">{children}</span>;
}
