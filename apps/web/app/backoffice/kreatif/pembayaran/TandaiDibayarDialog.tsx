"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { catatPembayaranBanyakAction } from "@/app/actions/kreatif-bayar";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import { ringkasDialogBayar, type StatusDialogBayar } from "@/lib/creative/bayar-aturan";
import type { BarisBayar } from "@/lib/creative/bayar-queries";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  /** SEMUA kolaborasi yang dipilih, dari halaman mana pun. */
  dipilih: readonly BarisBayar[];
  hariIni: string;
  onSelesai: () => void;
};

const PILIHAN: readonly StatusDialogBayar[] = ["LUNAS", "SEBAGIAN", "BELUM"];

const nama = (b: BarisBayar) => (b.handle ? `@${b.handle}` : b.kolNama);

/**
 * "Tandai dibayar" untuk banyak kolaborasi sekaligus. Ringkasan dan pemeriksaan
 * per baris memakai aturan yang sama dengan penulisnya (`ringkasDialogBayar` →
 * `rencanaPembayaran`), jadi tombol Simpan tidak pernah mengirim isian yang
 * pasti ditolak. "Dibayar sebagian" meminta jumlah PER BARIS (perbaikan bug
 * KOL Manager yang tidak bisa memasukkan nominal).
 */
export function TandaiDibayarDialog({ open, onOpenChange, dipilih, hariIni, onSelesai }: Props) {
  const t = useTranslations("kreatifRuang");
  const [status, setStatus] = useState<StatusDialogBayar>("LUNAS");
  const [tanggal, setTanggal] = useState(hariIni);
  const [teksJumlah, setTeksJumlah] = useState<Record<string, string>>({});
  const [menyimpan, mulaiSimpan] = useTransition();

  // Jumlah yang sudah dicatat jadi isian awal baris "sebagian".
  const teksBaris = (b: BarisBayar) => teksJumlah[b.id] ?? (b.payStatus === "SEBAGIAN" && b.dibayar > 0 ? angkaTitik(b.dibayar) : "");
  const jumlahPerBaris = Object.fromEntries(dipilih.map((b) => [b.id, bacaAngka(teksBaris(b))]));
  const ringkas = ringkasDialogBayar(dipilih, status, jumlahPerBaris, hariIni);
  const tanggalSalah = status !== "BELUM" && (!tanggal || tanggal > hariIni);
  const galatPertama = dipilih.find((b) => ringkas.galat[b.id]);
  const bolehSimpan = dipilih.length > 0 && !galatPertama && !tanggalSalah && !menyimpan;

  const simpan = () =>
    mulaiSimpan(async () => {
      const r = await catatPembayaranBanyakAction({
        items: dipilih.map((b) => ({ kolaborasiId: b.id, jumlah: status === "SEBAGIAN" ? (jumlahPerBaris[b.id] ?? null) : null })),
        status,
        tanggal: status === "BELUM" ? null : tanggal,
      });
      if (!r.ok) {
        const pesan = t(`errBayar.${r.kode}`);
        const baris = "kolaborasiId" in r && r.kolaborasiId ? dipilih.find((b) => b.id === r.kolaborasiId) : undefined;
        toast.error(baris ? t("pembayaran.errBaris", { docNo: baris.docNo, pesan }) : pesan);
        return;
      }
      const maju = r.perpindahan.filter((p) => p.ke === "DIBAYAR").length;
      if (r.berubah === 0) toast(t("pembayaran.okTanpa"));
      else if (maju > 0) toast.success(t("pembayaran.okMaju", { n: r.berubah, m: maju }));
      else toast.success(t("pembayaran.ok", { n: r.berubah }));
      setTeksJumlah({});
      onSelesai();
    });

  const tandaPerubahan = ringkas.tambahan > 0 ? "+" : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !menyimpan && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pembayaran.dialog.judul")}</DialogTitle>
          <DialogDescription className="tabular-nums">
            {t("pembayaran.dialog.ringkas", { n: ringkas.jumlah, fee: rupiahTeks(ringkas.totalFee) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("pembayaran.dialog.status")}</p>
            <div role="radiogroup" aria-label={t("pembayaran.dialog.status")} className="flex flex-col gap-1.5">
              {PILIHAN.map((p) => (
                <Button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={status === p}
                  variant={status === p ? "secondary" : "outline"}
                  className={cn("justify-start", status === p && "ring-1 ring-foreground/30")}
                  onClick={() => setStatus(p)}
                >
                  <span
                    aria-hidden
                    className={cn("h-3.5 w-3.5 shrink-0 rounded-full border border-foreground/50", status === p && "border-[4px] border-foreground")}
                  />
                  {t(`pembayaran.dialog.${p}`)}
                </Button>
              ))}
            </div>
          </div>

          {status !== "BELUM" ? (
            <div className="space-y-1.5">
              <Label htmlFor="tanggal-bayar">{t("pembayaran.dialog.tanggal")}</Label>
              <TanggalInput id="tanggal-bayar" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
            </div>
          ) : null}

          {status === "SEBAGIAN" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("pembayaran.dialog.jumlahJudul")}</p>
              <p className="text-xs text-muted-foreground">{t("pembayaran.dialog.jumlahPetunjuk")}</p>
              <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {dipilih.map((b) => {
                  const galat = ringkas.galat[b.id];
                  const idIsian = `jumlah-${b.id}`;
                  return (
                    <li key={b.id} className="grid grid-cols-[1fr_9rem] items-start gap-2">
                      <div className="min-w-0 pt-1.5">
                        <p className="truncate text-sm font-medium">{nama(b)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{t("pembayaran.dialog.dariFee", { fee: rupiahTeks(b.fee) })}</p>
                      </div>
                      <div className="space-y-1">
                        <Input
                          id={idIsian}
                          inputMode="decimal"
                          value={teksBaris(b)}
                          onChange={(e) => setTeksJumlah((lama) => ({ ...lama, [b.id]: e.target.value }))}
                          aria-label={t("pembayaran.dialog.jumlahAria", { nama: nama(b) })}
                          aria-invalid={Boolean(galat && teksBaris(b))}
                          className="text-right tabular-nums"
                        />
                        {galat && teksBaris(b) ? <p className="text-xs text-destructive">{t(`errBayar.${galat}`)}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums">
            <p>{t("pembayaran.dialog.sesudah", { jumlah: rupiahTeks(ringkas.dibayarSesudah) })}</p>
            <p className="text-muted-foreground">{t("pembayaran.dialog.perubahan", { jumlah: `${tandaPerubahan}${rupiahTeks(ringkas.tambahan)}` })}</p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {galatPertama ? (
            <p className="text-xs text-destructive sm:mr-auto">
              {t("pembayaran.dialog.barisSalah", { nama: nama(galatPertama), pesan: t(`errBayar.${ringkas.galat[galatPertama.id]}`) })}
            </p>
          ) : tanggalSalah ? (
            <p className="text-xs text-destructive sm:mr-auto">{t(tanggal ? "errBayar.TANGGAL_DEPAN" : "errBayar.TANGGAL_TIDAK_VALID")}</p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
            {t("pembayaran.dialog.batal")}
          </Button>
          <Button onClick={simpan} disabled={!bolehSimpan}>
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {menyimpan ? t("pembayaran.dialog.menyimpan") : t("pembayaran.dialog.simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
