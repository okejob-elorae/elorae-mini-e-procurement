"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { bayarTerminAction, bayarTerminBanyakAction } from "@/app/actions/kreatif-termin";
import { jumlahUang, rupiahTeks } from "@/lib/creative/angka-konten";
import { bayarSebelumTayang } from "@/lib/creative/termin-aturan";
import type { BarisTermin } from "@/lib/creative/termin-queries";

type Props = {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  /** Satu termin (Bayar) atau beberapa (Bayar yang dipilih — satu transfer, satu tanggal). */
  termin: readonly BarisTermin[];
  hariIni: string;
  onSelesai: () => void;
};

const nama = (b: BarisTermin) => (b.handle ? `@${b.handle}` : b.kolNama);

/**
 * Bayar termin: tanggal bayar (hari WIB, tidak boleh di depan), bukti transfer
 * (opsional), nomor bukti potong (opsional, satu termin ber-PPh). Yang
 * ditransfer adalah NETO; PPh disetor Elorae. Rekening tujuan hanya tampil
 * tersamar — isi lengkapnya dibuka keuangan dari profil KOL.
 */
export function DialogBayarTermin({ open, onOpenChange, termin, hariIni, onSelesai }: Props) {
  const t = useTranslations("kreatifRuang");
  const [tanggal, setTanggal] = useState(hariIni);
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [nomor, setNomor] = useState("");
  const [catatan, setCatatan] = useState("");
  const [setujuAwal, setSetujuAwal] = useState(false);
  const [menyimpan, mulai] = useTransition();
  const satu = termin.length === 1 ? termin[0] : null;
  const neto = jumlahUang(termin.map((b) => b.neto));
  const pph = jumlahUang(termin.map((b) => b.pph));
  const bruto = jumlahUang(termin.map((b) => b.bruto));
  const tanggalSalah = !tanggal || tanggal > hariIni;
  const tanpaData = termin.filter((b) => b.jenisPajak !== "TIDAK_DIPOTONG" && !b.dataPajakLengkap);
  // Satu termin: baris rekening di atas sudah menyebut rekening kosong — kotak peringatan tidak mengulanginya.
  const tanpaRekening = satu ? [] : termin.filter((b) => !b.rekening.last4);
  // Termin yang menunggu tayang (mis. Pelunasan) boleh dibayar lebih awal, tetapi
  // harus dikonfirmasi — bukan larangan (keputusan sementara 2026-10-08).
  const sebelumTayang = termin.filter(bayarSebelumTayang);
  const perluSetuju = sebelumTayang.length > 0 && !setujuAwal;

  const simpan = () =>
    mulai(async () => {
      const bukti = foto?.url && !foto.berkas ? foto.url : null;
      const r = satu
        ? await bayarTerminAction({ terminId: satu.id, tanggal, buktiTransferUrl: bukti, nomorBuktiPotong: nomor || null, catatan: catatan || undefined })
        : await bayarTerminBanyakAction({ terminIds: termin.map((b) => b.id), tanggal, buktiTransferUrl: bukti });
      if (!r.ok) {
        const baris = "terminId" in r && r.terminId ? termin.find((b) => b.id === r.terminId) : undefined;
        const pesan = t(`termin.err.${r.kode}`);
        toast.error(baris ? t("termin.errBaris", { kol: nama(baris), label: baris.label, pesan }) : pesan);
        return;
      }
      if ("perpindahan" in r) {
        const maju = r.perpindahan.length;
        toast.success(maju > 0 ? t("termin.okBanyakMaju", { n: r.jumlah, m: maju }) : t("termin.okBanyak", { n: r.jumlah }));
      } else if (r.tahap) {
        toast.success(t("termin.okMaju", { tahap: t(`tahap.${r.tahap.ke}`) }));
      } else {
        toast.success(t("termin.ok"));
      }
      setFoto(null);
      setNomor("");
      setCatatan("");
      onSelesai();
    });

  return (
    <Dialog open={open} onOpenChange={(v) => !menyimpan && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{satu ? t("termin.dialog.judulSatu", { label: satu.label }) : t("termin.dialog.judulBanyak", { n: termin.length })}</DialogTitle>
          <DialogDescription>
            {satu ? `${nama(satu)} · ${satu.docNo}` : t("termin.dialog.deskBanyak")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t("termin.kolom.bruto")}</dt>
              <dd className="font-medium tabular-nums">{rupiahTeks(bruto)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("termin.kolom.pph")}</dt>
              <dd className="font-medium tabular-nums">{rupiahTeks(pph)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("termin.dialog.transfer")}</dt>
              <dd className="font-semibold tabular-nums">{rupiahTeks(neto)}</dd>
            </div>
          </dl>

          {satu ? (
            <p className="text-sm">
              {satu.rekening.last4
                ? t("termin.dialog.rekening", { bank: satu.rekening.bank ?? t("termin.dialog.bank"), last4: satu.rekening.last4 })
                : t("termin.dialog.rekeningKosong")}
              {satu.grossUp ? <span className="block text-xs text-muted-foreground">{t("termin.dialog.grossUp")}</span> : null}
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
              {termin.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {nama(b)} · {b.label}
                  </span>
                  <span className="shrink-0 tabular-nums">{rupiahTeks(b.neto)}</span>
                </li>
              ))}
            </ul>
          )}

          {tanpaData.length > 0 || tanpaRekening.length > 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {tanpaRekening.length > 0 ? t("termin.dialog.peringatanRekening") : t("termin.dialog.peringatanPajak")}
            </p>
          ) : null}

          {sebelumTayang.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {satu
                  ? t("termin.dialog.sebelumTayang", { label: satu.label, n: satu.hariSesudah })
                  : t("termin.dialog.sebelumTayangBanyak", { n: sebelumTayang.length })}
              </p>
              <div className="flex items-start gap-2">
                <Checkbox id="bayar-termin-setuju-awal" checked={setujuAwal} onCheckedChange={(v) => setSetujuAwal(v === true)} className="mt-0.5" />
                <Label htmlFor="bayar-termin-setuju-awal" className="text-sm font-normal leading-snug">
                  {t("termin.dialog.setujuAwal")}
                </Label>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="bayar-termin-tanggal">{t("termin.dialog.tanggal")}</Label>
            <TanggalInput id="bayar-termin-tanggal" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
            {tanggalSalah && tanggal ? <p className="text-xs text-destructive">{t("termin.err.TANGGAL_DEPAN")}</p> : null}
          </div>

          <UnggahFoto
            label={t("termin.dialog.bukti")}
            petunjuk={t("termin.dialog.buktiPetunjuk")}
            nilai={foto}
            onChange={setFoto}
            disabled={menyimpan}
          />

          {satu && satu.pph > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="bayar-termin-bupot">{t("termin.dialog.nomorBukti")}</Label>
              <Input id="bayar-termin-bupot" value={nomor} maxLength={60} onChange={(e) => setNomor(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("termin.dialog.nomorBuktiPetunjuk")}</p>
            </div>
          ) : null}

          {satu ? (
            <div className="space-y-1.5">
              <Label htmlFor="bayar-termin-catatan">{t("termin.dialog.catatan")}</Label>
              <Textarea id="bayar-termin-catatan" rows={2} maxLength={1000} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          ) : null}
        </div>

        {perluSetuju ? (
          <p className="text-right text-xs text-muted-foreground" id="bayar-termin-alasan">
            {t("termin.dialog.centangDulu")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
            {t("termin.dialog.batal")}
          </Button>
          <Button
            onClick={simpan}
            disabled={menyimpan || tanggalSalah || termin.length === 0 || perluSetuju}
            aria-describedby={perluSetuju ? "bayar-termin-alasan" : undefined}
          >
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("termin.dialog.simpan", { neto: rupiahTeks(neto) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
